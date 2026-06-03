(function () {
// CompareInline — owns the inline compare experience for a single
// My Replays card. Renders inside the card's expand panel and orchestrates:
//   1. Build the user-summary on the fly from IndexedDB-stored parsedJson
//   2. Auto-pick a pro via CompareMatcher
//   3. Run ReplayAnalyzer to produce the report card
//   4. Render the diagnostic checklist (race ✓, matchup ✓, archetype ⚠ etc)
//   5. Render the overall grade + per-category tiles with findings
//   6. Render switcher chips for top-N candidates
//   7. Wire an "Advanced search" button that opens the full pro browser
//
// One instance per opened card panel. Held at cardEl._compareInline so
// re-toggling the panel doesn't redo the work.

const CompareInline = class {
  constructor (rootEl, userRecord, myReplays, options = {}) {
    this.rootEl = rootEl;
    this.userRecord = userRecord;     // {id, parsedJson, race, mapName, ...}
    this.myReplays = myReplays;
    // Pass the MyReplays instance so the matcher can fold IDB-flagged
    // reference replays into its candidate pool alongside curated builds.
    this.matcher = new window.CompareMatcher(myReplays);
    this.userSummary = null;          // built lazily from parsedJson
    this.userSlot = null;             // string; first non-neutral slot
    this.candidates = [];             // [{ entry, score }]
    this.currentProEntry = null;
    this.currentReport = null;
    this.selfMatchEntry = null;       // pro entry whose fingerprint == userSummary's
    this.isSelfMatch = false;         // true while currentProEntry === selfMatchEntry
    // matchConfidence:
    //   'auto'      — top candidate clears metadata (≥85) AND grades AND
    //                 has a matching build composition
    //   'graded'    — top graded non-divergent candidate, score < 85
    //   'divergent' — best graded candidate has the wrong build (no
    //                 same-build pro available in our library that grades)
    //   'low'       — nothing graded; showing closest metadata fallback
    //   'manual'    — user picked via chip / advanced search
    this.matchConfidence = null;
    this.topCandidateScore = 0;       // score of best candidate (for low-conf detail)
    this.uploadedProInfo = null;      // { proName, uploadedName } if user's slot
                                      // matches a known pro but fingerprint doesn't
    // Callbacks injected by the host (drawer, inline panel, etc).
    //   onResult(report, proEntry) — fires after a successful compare run
    //     so the host can cache the grade or update other UI.
    //   onTitleChange(title, eyebrow) — fires when the visible "Comparing
    //     to <pro>" header changes; used by the drawer to reflect the
    //     current pro in its own chrome.
    this.onResult = options.onResult || null;
    this.onTitleChange = options.onTitleChange || null;
  }

  async bootstrap () {
    this._renderLoading();
    try {
      // Cache the map-folders manifest before building the user summary so
      // mapInfo can be resolved deterministically (matches server-side).
      await ensureMapFoldersManifest();
      // Build summary-shaped object from the parsedJson once.
      this.userSummary = buildUserSummary(this.userRecord);
      this.userSlot = pickUserSlot(this.userSummary, this.userRecord);
      if (!this.userSlot) {
        this._renderEmpty('Couldn\'t find your player slot in this replay.');
        return;
      }
      // Generous limit so the chooser can show all curated race-relevant
      // entries plus the user's full reference library. The chooser's
      // option list already scrolls if too tall.
      this.candidates = await this.matcher.rankCandidates(this.userSummary, this.userSlot, { limit: 30 });
      this.topCandidateScore = (this.candidates[0] && this.candidates[0].score) || 0;
      // Detect self-match (re-upload of a pro replay) ahead of any other
      // pick so we can render a different label and snap the grade to 100.
      this.selfMatchEntry = await this.matcher.findByFingerprint(this.userSummary);
      // Detect uploaded-pro replay: user's selected slot is a known pro but
      // we don't have this exact game (no fingerprint match). Pro-vs-pro
      // comparisons against our library don't grade meaningfully.
      this.uploadedProInfo = this.selfMatchEntry
        ? null
        : await this.matcher.detectProInUpload(this.userSummary, this.userSlot);

      // Self-match short-circuits everything. Same .w3g content == 100/100.
      if (this.selfMatchEntry) {
        this.matchConfidence = 'auto';
        await this._compareWith(this.selfMatchEntry);
        return;
      }

      // Honor a stored user choice from a previous compare on this record.
      // proKey: 'none'                            → user explicitly opted out
      //         'manifest::<replayId>::<slot>'    → curated entry
      //         'local::<idbId>::<slot>'          → user's reference replay
      const storedKey = this.userRecord.lastCompare && this.userRecord.lastCompare.proKey;
      if (storedKey === 'none') {
        // User previously picked "Watch without grading" — reopen the
        // chooser so they can change their mind, but skip auto-pick.
        if (this.candidates.length) {
          this._renderChooser({ reason: 'previous-skip' });
        } else {
          this._renderNoCandidates();
        }
        return;
      }
      if (storedKey) {
        const stored = findEntryByProKey(storedKey, this.candidates);
        if (stored) {
          this.matchConfidence = 'manual';
          await this._compareWith(stored);
          return;
        }
        // Stored entry no longer in candidate pool (reference deleted, etc.)
        // — fall through to fresh auto-pick logic.
      }

      // No stored choice: try strict auto-pick. Returns non-null only when a
      // candidate is structurally exact (race + matchup + archetype + grades
      // + non-divergent; map allowed to differ).
      const exactPick = await this.matcher.autoPick(this.userSummary, this.userSlot);
      if (exactPick) {
        this.matchConfidence = 'auto';
        await this._compareWith(exactPick);
        return;
      }

      // Imperfect match: render the chooser. User explicitly picks a pro,
      // a reference, or "watch without grading."
      if (this.candidates.length) {
        this._renderChooser();
      } else {
        this._renderNoCandidates();
      }
    } catch (e) {
      console.error('[CompareInline] bootstrap failed:', e);
      this._renderError(e.message || String(e));
    }
  }

  async _compareWith (proEntry) {
    this.currentProEntry = proEntry;
    // Same content fingerprint = same .w3g. Skip the analyzer entirely and
    // render a synthetic perfect-match report so the user sees what they
    // expect (100/100 across the board).
    this.isSelfMatch = !!(this.selfMatchEntry &&
      this.selfMatchEntry.replayId === proEntry.replayId &&
      String(this.selfMatchEntry.playerSlot) === String(proEntry.playerSlot));

    this._renderLoading(`Comparing to ${proEntry.playerName}…`);
    if (this.onTitleChange) this.onTitleChange(`vs ${proEntry.playerName}`, 'Compare · Loading');

    const proSummary = await this.matcher.loadSummary(proEntry.replayId);
    if (!proSummary) {
      this._renderError(`Couldn't load pro summary: ${proEntry.replayId}`);
      return;
    }

    let report;
    if (this.isSelfMatch) {
      report = synthSelfMatchReport(this.userSummary, this.userSlot, proSummary, proEntry.playerSlot);
    } else {
      report = window.ReplayAnalyzer.compare({
        userSummary: this.userSummary,
        userSlot: this.userSlot,
        proSummary,
        proSlot: proEntry.playerSlot,
        proResult: 'unknown'
      });
    }
    this.currentReport = report;
    this.currentProSummary = proSummary;
    this._renderReport(report, proEntry, proSummary);

    // Notify host (drawer caches lastCompare on the IDB record + updates
    // the card grade badge). The third arg is the proKey — host writes
    // it into lastCompare so the next bootstrap can restore the choice.
    if (this.onResult) {
      try { this.onResult(report, proEntry, buildProKey(proEntry)); } catch (e) { /* host owns errors */ }
    }
    if (this.onTitleChange) {
      const mu = (proEntry.buildMatchups && proEntry.buildMatchups[0]) || '';
      this.onTitleChange(`vs ${proEntry.playerName}${mu ? ' · ' + mu : ''}`, `Grade: ${report.overall.grade}`);
    }
  }

  // ===== Rendering =====

  // Returns the sticky footer element next to rootEl (the drawer-foot region).
  // Returns null when CompareInline is hosted outside the drawer (defensive).
  _footEl () {
    const parent = this.rootEl && this.rootEl.parentElement;
    return parent ? parent.querySelector('.compare-drawer-foot') : null;
  }

  _clearFooter () {
    const foot = this._footEl();
    if (foot) foot.innerHTML = '';
  }

  _renderLoading (msg) {
    this._clearFooter();
    this.rootEl.innerHTML = `
      <div class="ci-loading">
        <div class="ci-spinner"></div>
        <div class="ci-loading-text">${escapeHtml(msg || 'Looking for a pro to compare…')}</div>
      </div>
    `;
  }

  _renderError (msg) {
    this._clearFooter();
    this.rootEl.innerHTML = `<div class="ci-error">${escapeHtml(msg)}</div>`;
  }

  _renderEmpty (msg) {
    this._clearFooter();
    this.rootEl.innerHTML = `<div class="ci-empty">${escapeHtml(msg)}</div>`;
  }

  _renderNoCandidates () {
    this._clearFooter();
    const u = this.userSummary.players[this.userSlot];
    const userMu = matchupString(this.userSummary, this.userSlot);
    this.rootEl.innerHTML = `
      <div class="ci-no-candidates">
        <div class="ci-headline">No pro replays match this game yet</div>
        <div class="ci-detail">
          Your replay (${escapeHtml(prettyArchetype(u.archetype))} as ${escapeHtml(u.race)}${userMu ? ', ' + escapeHtml(userMu) : ''}) doesn't have a counterpart in our library yet. We're constantly adding more — check back as we expand the pro library.
        </div>
        <button class="ci-advanced-btn" type="button">Browse all pro replays</button>
      </div>
    `;
    this.rootEl.querySelector('.ci-advanced-btn').addEventListener('click', () => this._openAdvanced());
  }

  // Forced-choice chooser shown when no curated build is a structural exact
  // match for the user's replay. Players were getting confused by loose
  // auto-picks ("but the build doesn't match my play!"); this view makes
  // the choice deliberate and explicit.
  //
  // Layout (top to bottom):
  //   1. Headline + reasoning ("we couldn't find an exact pro match…")
  //   2. Recommended card — the top-ranked candidate with a per-dimension
  //      "why" checklist (race ✓ matchup ✓ archetype ⚠ map ✗) so the user
  //      sees exactly which dimensions matched.
  //   3. Two columns:
  //        Your references — IDB records flagged isReference, scored same
  //                          way as curated. Empty state CTAs upload.
  //        Curated builds  — manifest-backed pros.
  //   4. "Watch without grading" — persists proKey='none' on the record so
  //      reopening the drawer skips auto-pick.
  _renderChooser (options = {}) {
    this._clearFooter();
    this._activeView = 'chooser';
    if (!this._chooserSort) this._chooserSort = 'match';
    const u = this.userSummary.players[this.userSlot] || {};
    const userMu = matchupString(this.userSummary, this.userSlot);

    // The recommended card always uses match-score order — it's "the
    // single best fit" by definition. The columns include EVERY candidate
    // (refs + curated) regardless of whether one is also the recommended;
    // otherwise a user uploading their first reference into a column with
    // no other competition would see it promoted to recommended and the
    // refs column would lie ("No references yet"). Slight redundancy
    // beats a misleading empty state.
    const top = this.candidates[0];
    const refs = sortChooserItems(this.candidates.filter(c => c.entry.isUserReference), this._chooserSort);
    const curated = sortChooserItems(this.candidates.filter(c => !c.entry.isUserReference), this._chooserSort);

    const previousSkipBanner = options.reason === 'previous-skip' ? `
      <div class="ci-chooser-prevbanner">
        You previously picked <strong>Watch without grading</strong> for this replay. Pick a comparison below to grade it, or close to keep it ungraded.
      </div>
    ` : '';

    const sortChip = (key, label) => `
      <button type="button"
              class="ci-chooser-sort-chip ${this._chooserSort === key ? 'ci-chooser-sort-chip-active' : ''}"
              data-sort="${escapeAttr(key)}"
              aria-pressed="${this._chooserSort === key ? 'true' : 'false'}">${escapeHtml(label)}</button>
    `;

    this.rootEl.innerHTML = `
      <div class="ci-chooser">
        <header class="ci-chooser-head">
          <h2 class="ci-chooser-title">Pick a comparison</h2>
          <p class="ci-chooser-sub">
            We didn't find a pro replay in our curated library that exactly matches your <strong>${escapeHtml(prettyArchetype(u.archetype))}</strong> ${escapeHtml(u.race || '?')}${userMu ? ' (' + escapeHtml(userMu) + ')' : ''} game. Pick the closest pro, use one of your reference replays, or skip grading.
          </p>
        </header>
        ${previousSkipBanner}
        ${top ? this._chooserRecommendedHtml(top) : ''}
        <div class="ci-chooser-sortbar" role="toolbar" aria-label="Sort options">
          <span class="ci-chooser-sort-label">Sort</span>
          ${sortChip('match', 'Best match')}
          ${sortChip('map', 'Map')}
          ${sortChip('pro', 'Pro name')}
        </div>
        <div class="ci-chooser-cols">
          ${this._chooserColumnHtml('Your references', refs, true)}
          ${this._chooserColumnHtml('Curated builds', curated, false)}
        </div>
        <div class="ci-chooser-foot">
          <button class="ci-chooser-skip" type="button" data-action="skip">
            Watch without grading
          </button>
          <span class="ci-chooser-skip-hint">Closes this drawer with no comparison saved. You can re-open it later.</span>
        </div>
      </div>
    `;

    // Wire option clicks (recommended card + each column item).
    this.rootEl.querySelectorAll('[data-pro-key]').forEach(el => {
      el.addEventListener('click', () => {
        const key = el.dataset.proKey;
        const entry = findEntryByProKey(key, this.candidates);
        if (!entry) return;
        this.matchConfidence = 'manual';
        this._compareWith(entry);
      });
    });
    const skipBtn = this.rootEl.querySelector('[data-action="skip"]');
    if (skipBtn) skipBtn.addEventListener('click', () => this._skipCompare());

    // Sort chip clicks — change state, re-render in place. Doesn't touch
    // candidates or the matcher; pure display sort.
    this.rootEl.querySelectorAll('.ci-chooser-sort-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        this._chooserSort = chip.dataset.sort;
        this._renderChooser(options);
      });
    });

    // Upload-reference button in the empty refs column. Same parser as
    // the homepage flow but auto-tags the result as a reference (we know
    // the user's intent because they clicked from the references column).
    const uploadBtn = this.rootEl.querySelector('[data-action="upload-reference"]');
    if (uploadBtn) uploadBtn.addEventListener('click', () => this._uploadReferenceFromChooser(uploadBtn));
  }

  // In-chooser shortcut for adding a reference replay — saves the user a
  // round trip back to the homepage. Picks file → parses → marks as
  // reference → re-bootstraps the chooser so the new entry appears.
  // Drives the existing #parse-overlay (z-index 9999, sits above the
  // compare drawer at 9001) so the user sees real parse progress instead
  // of a static "Saving…" button label.
  async _uploadReferenceFromChooser (btnEl) {
    if (!window.UploadManager || !this.myReplays) {
      alert('Upload subsystem not loaded. Refresh and try again.');
      return;
    }
    btnEl.disabled = true;
    const originalText = btnEl.textContent;
    btnEl.textContent = 'Pick a .w3g file…';
    const overlay = parseOverlayController();
    try {
      const uploader = new window.UploadManager({ myReplays: this.myReplays });
      // Show the parse overlay on the first progress event (which fires
      // after the user picks a file). Same pattern as the homepage flow.
      uploader.onProgress = (evt) => overlay.update(evt);
      const result = await uploader.pickAndParse();
      overlay.hide();
      if (!result) { btnEl.disabled = false; btnEl.textContent = originalText; return; }
      // No slot prompt — both players in a reference replay are pros and
      // the matcher will index both for future comparisons.
      await this.myReplays.setReferenceState(result.record.id, { isReference: true });
      try { document.dispatchEvent(new CustomEvent('wc3v:my-replays-changed', { detail: { addedId: result.record.id, asReference: true } })); } catch {}
      // Re-bootstrap so the new reference shows up in the candidate pool.
      this.matcher.invalidate();
      await this.bootstrap();
    } catch (e) {
      console.error('[CompareInline] reference upload failed:', e);
      overlay.hide();
      btnEl.disabled = false;
      btnEl.textContent = originalText;
      alert('Upload failed: ' + (e.message || e));
    }
  }

  // Recommended card — compact horizontal layout: race chip + name on the
  // left, hero icons + match-dimension chips on the right, single-line
  // check summary, CTA on the same row. Aim: ~80px tall total so the rest
  // of the chooser fits above the fold.
  _chooserRecommendedHtml (annotated) {
    const e = annotated.entry;
    const u = this.userSummary.players[this.userSlot] || {};
    const userMu = matchupString(this.userSummary, this.userSlot);
    const proKey = buildProKey(e);
    const refTag = e.isUserReference
      ? `<span class="ci-chooser-rec-tag ci-chooser-rec-tag-ref">★ Reference</span>`
      : `<span class="ci-chooser-rec-tag">Curated</span>`;
    const muLabel = (e.buildMatchups && e.buildMatchups[0]) || '';
    const buildLabel = e.buildName || '';
    const recMap = resolveMap(e.map);
    const mapLabel = recMap.displayName && recMap.displayName !== 'Unknown map' ? `· ${recMap.displayName}` : '';
    const opp = e.opponentName ? ` vs ${e.opponentName}` : '';
    const heroes = (e.heroItemIds || []).slice(0, 3);
    const heroPortraits = heroes.length
      ? `<span class="ci-chooser-rec-heroes" aria-label="Hero picks">
           ${heroes.map(h => `<img class="ci-chooser-rec-hero" src="${escapeAttr(iconUrl(h))}" alt="" loading="lazy" onerror="this.classList.add('ci-rec-hero-fail')"/>`).join('')}
         </span>`
      : '';
    const dotsHtml = chooserDimensionDots(e, u, userMu, this.userSummary, annotated);

    const proRaceIcon = RACE_ICON[e.buildRace]
      ? `<img class="ci-chooser-rec-race race-${escapeAttr(e.buildRace)}" src="${escapeAttr(raceIconUrl(e.buildRace))}" alt="${escapeAttr(RACE_LONG[e.buildRace] || e.buildRace)}" title="${escapeAttr(RACE_LONG[e.buildRace] || e.buildRace)}" onerror="this.classList.add('ci-chooser-rec-race-fail')"/>`
      : '<span class="ci-chooser-rec-race ci-chooser-rec-race-fail" aria-hidden="true"></span>';
    return `
      <button class="ci-chooser-rec race-${escapeAttr(e.buildRace || '?')}" data-pro-key="${escapeAttr(proKey)}" type="button">
        <div class="ci-chooser-rec-row">
          <span class="ci-chooser-rec-eyebrow">RECOMMENDED</span>
          ${proRaceIcon}
          <span class="ci-chooser-rec-meta">
            <span class="ci-chooser-rec-name">${ut(e.playerName || '?')}<span class="ci-chooser-rec-opp">${ut(opp)}</span></span>
            <span class="ci-chooser-rec-sub">${escapeHtml([muLabel, buildLabel].filter(Boolean).join(' · '))}${ut(mapLabel)}</span>
          </span>
          ${heroPortraits}
          <span class="ci-chooser-rec-dots" aria-label="Match summary">${dotsHtml}</span>
          ${refTag}
          <span class="ci-chooser-rec-cta">Compare to this →</span>
        </div>
      </button>
    `;
  }

  // One column of the chooser ("Your references" or "Curated builds").
  // Two render modes:
  //   - Flat (sort=match or sort=pro): one option row per item.
  //   - Map-grouped (sort=map): items grouped by map name, each group
  //     rendered with a 56×40 map header image + map name + count, then
  //     option rows under it (with hideMap=true so per-row map info is
  //     suppressed since the header already says it).
  _chooserColumnHtml (label, items, isRefColumn) {
    const colCls = isRefColumn ? 'ci-chooser-col ci-chooser-col-ref' : 'ci-chooser-col ci-chooser-col-curated';
    const headIcon = isRefColumn
      ? '<span class="ci-chooser-col-icon ci-chooser-col-icon-ref" aria-hidden="true">★</span>'
      : '<span class="ci-chooser-col-icon ci-chooser-col-icon-curated" aria-hidden="true">◆</span>';
    const head = `
      <header class="ci-chooser-col-head">
        ${headIcon}
        <span class="ci-chooser-col-label">${escapeHtml(label)}</span>
        <span class="ci-chooser-col-count">${items.length}</span>
      </header>
    `;
    if (!items.length) {
      const empty = isRefColumn
        ? `<div class="ci-chooser-col-empty ci-chooser-col-empty-ref">
             <div class="ci-chooser-col-empty-title">★ No reference replays yet</div>
             <div class="ci-chooser-col-empty-body">Drop a pro replay (e.g. a Happy or Moon ladder game) and we'll grade your future games against it.</div>
             <button class="ci-chooser-col-upload" type="button" data-action="upload-reference">＋ Upload reference replay</button>
           </div>`
        : `<div class="ci-chooser-col-empty">
             <div class="ci-chooser-col-empty-title">No curated builds for this matchup</div>
             <div class="ci-chooser-col-empty-body">We add new pros regularly. Try a reference replay below.</div>
           </div>`;
      return `<div class="${colCls}">${head}${empty}</div>`;
    }
    const body = this._chooserSort === 'map'
      ? this._chooserMapGroupedHtml(items)
      : `<div class="ci-chooser-col-list">${items.map(c => this._chooserOptionHtml(c)).join('')}</div>`;
    return `<div class="${colCls}">${head}${body}</div>`;
  }

  // Group items by NORMALIZED map name (so "Autumn Leaves v2.0" and
  // "AutumnLeaves_v2.0" merge into one "Autumn Leaves" group). Within
  // each group, sort by pro name. Header shows the map's gridmap.jpg as
  // a big (56×40) thumbnail.
  _chooserMapGroupedHtml (items) {
    const groups = new Map();
    for (const item of items) {
      const map = resolveMap(item.entry.map);
      const key = map.displayName || 'Unknown map';
      if (!groups.has(key)) groups.set(key, { displayName: key, iconUrl: map.iconUrl, items: [] });
      groups.get(key).items.push(item);
    }
    const sortedGroups = Array.from(groups.values())
      .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));
    return sortedGroups.map(group => {
      const sorted = group.items.slice().sort((a, b) =>
        String(a.entry.playerName || '').localeCompare(String(b.entry.playerName || ''), undefined, { sensitivity: 'base' })
      );
      const headerIcon = group.iconUrl
        ? `<img class="ci-chooser-mapgroup-icon" src="${escapeAttr(group.iconUrl)}" alt="" loading="lazy" onerror="this.classList.add('ci-chooser-mapgroup-icon-fail')"/>`
        : '<span class="ci-chooser-mapgroup-icon ci-chooser-mapgroup-icon-fail" aria-hidden="true"></span>';
      const rows = sorted.map(c => this._chooserOptionHtml(c, true)).join('');
      return `
        <section class="ci-chooser-mapgroup">
          <header class="ci-chooser-mapgroup-head">
            ${headerIcon}
            <div class="ci-chooser-mapgroup-meta">
              <div class="ci-chooser-mapgroup-name">${escapeHtml(group.displayName)}</div>
              <div class="ci-chooser-mapgroup-count">${sorted.length} ${sorted.length === 1 ? 'pro' : 'pros'}</div>
            </div>
          </header>
          <div class="ci-chooser-mapgroup-list">${rows}</div>
        </section>
      `;
    }).join('');
  }

  // Option row — single horizontal line, ~36px tall. The pro's own race
  // chip was dropped: it always matches the user's race for the entries
  // that should reasonably appear, and the dimension dots already say it
  // for those that don't. What's actually useful: the OPPONENT'S race
  // icon (visual recognition) and, when not in map-grouped mode, a small
  // map icon + name on the sub-line.
  //
  // hideMap: when true (set by the map-grouped renderer), drops the map
  // icon + name from the sub-line because the section header already
  // shows them. Sub-line then carries just the build name.
  _chooserOptionHtml (annotated, hideMap = false) {
    const e = annotated.entry;
    const proKey = buildProKey(e);
    const u = this.userSummary.players[this.userSlot] || {};
    const userMu = matchupString(this.userSummary, this.userSlot);
    const buildLabel = e.buildName || '';

    const dotsHtml = chooserDimensionDots(e, u, userMu, this.userSummary, annotated);
    const refStar = e.isUserReference
      ? `<span class="ci-chooser-opt-ref" title="Your reference replay">★</span>`
      : '';

    const oppRace = e.opponentRace || (e.buildMatchups && e.buildMatchups[0] && e.buildMatchups[0].length === 3 ? e.buildMatchups[0].charAt(2) : null);
    const oppLabel = oppRace ? (RACE_LONG[oppRace] || oppRace) : 'unknown';
    const oppIcon = oppRace && RACE_ICON[oppRace]
      ? `<img class="ci-chooser-opt-vs-icon race-${escapeAttr(oppRace)}" src="${escapeAttr(raceIconUrl(oppRace))}" alt="vs ${escapeAttr(oppLabel)}" title="Pro played vs ${escapeAttr(oppLabel)}" onerror="this.classList.add('ci-chooser-opt-vs-icon-fail')"/>`
      : `<span class="ci-chooser-opt-vs-icon ci-chooser-opt-vs-icon-fail" title="vs unknown race" aria-hidden="true"></span>`;
    const vsChip = `
      <span class="ci-chooser-opt-vs" aria-hidden="true">vs</span>
      ${oppIcon}
    `;

    let subContent;
    if (hideMap) {
      // In map-grouped mode the header already names the map. Sub-line
      // just shows the build label (or empty if none) so each row keeps
      // a consistent height.
      subContent = buildLabel ? escapeHtml(buildLabel) : '<span class="ci-chooser-opt-sub-empty">—</span>';
    } else {
      const map = resolveMap(e.map);
      const mapIcon = map.iconUrl
        ? `<img class="ci-chooser-opt-mapicon" src="${escapeAttr(map.iconUrl)}" alt="" loading="lazy" onerror="this.classList.add('ci-chooser-opt-mapicon-fail')"/>`
        : '';
      subContent = `
        ${mapIcon}
        <span class="ci-chooser-opt-mapname">${escapeHtml(map.displayName)}</span>
      `;
    }

    return `
      <button class="ci-chooser-opt" data-pro-key="${escapeAttr(proKey)}" type="button">
        ${vsChip}
        <span class="ci-chooser-opt-text">
          <span class="ci-chooser-opt-name">
            ${refStar}${ut(e.playerName || '?')}
            ${buildLabel && !hideMap ? `<span class="ci-chooser-opt-build">${escapeHtml(buildLabel)}</span>` : ''}
          </span>
          <span class="ci-chooser-opt-sub">${subContent}</span>
        </span>
        <span class="ci-chooser-opt-dots" aria-label="Match dimensions">${dotsHtml}</span>
        <span class="ci-chooser-opt-arrow" aria-hidden="true">→</span>
      </button>
    `;
  }

  // "Watch without grading" path — persist the user's intent and close the
  // drawer. The card's grade badge stays empty; reopening will land back on
  // the chooser thanks to the `proKey === 'none'` branch in bootstrap().
  async _skipCompare () {
    try {
      if (this.myReplays && this.userRecord) {
        const updated = await this.myReplays.get(this.userRecord.id);
        if (updated) {
          updated.lastCompare = {
            grade: null, score: null, proKey: 'none',
            proPlayerName: null, ts: Date.now()
          };
          await this.myReplays.put(updated);
        }
      }
    } catch (e) {
      console.warn('[CompareInline] skip-compare persist failed:', e);
    }
    // Use the global drawer close handler if present; otherwise just clear.
    const drawer = document.getElementById('compare-drawer');
    const closeBtn = document.getElementById('compare-drawer-close');
    if (drawer && closeBtn && typeof closeBtn.click === 'function') {
      closeBtn.click();
    } else {
      this._renderEmpty('No comparison set.');
    }
  }

  // Tabbed report. The header (slot row, pro card, overall grade, watch
  // CTAs) and switcher (chips + advanced) stay always-visible; the main
  // content area swaps between Overview / Build / Tech / Economy / Heroes
  // / Upgrades. Tabs are re-rendered on click rather than cached — cheap.
  _renderReport (report, proEntry, proSummary) {
    this._report = report;
    this._proEntry = proEntry;
    this._proSummary = proSummary;
    this._activeTab = 'overview';
    this._activeHeroIdx = 0;

    this.rootEl.innerHTML = `
      ${this._headerHtml()}
      ${this._tabsNavHtml()}
      <div class="ci-tab-content"></div>
    `;
    const foot = this._footEl();
    if (foot) foot.innerHTML = this._footerHtml();
    this._renderActiveTab();
    this._wireGlobal();
  }

  _setTab (tabId) {
    if (tabId === this._activeTab) return;
    this._activeTab = tabId;
    if (tabId === 'heroes') this._activeHeroIdx = 0;
    this.rootEl.querySelectorAll('.ci-tab').forEach(el => {
      el.classList.toggle('ci-tab-active', el.dataset.tab === tabId);
      el.setAttribute('aria-selected', el.dataset.tab === tabId ? 'true' : 'false');
    });
    this._renderActiveTab();
  }

  _renderActiveTab () {
    const el = this.rootEl.querySelector('.ci-tab-content');
    if (!el) return;
    el.innerHTML = this._tabHtml(this._activeTab);
    this._wireTab(this._activeTab);
  }

  _tabHtml (tabId) {
    switch (tabId) {
      case 'overview': return this._overviewHtml();
      case 'build':    return this._buildHtml();
      case 'tech':     return this._techHtml();
      case 'economy':  return this._economyHtml();
      case 'heroes':   return this._heroesHtml();
      case 'creeps':   return this._creepsHtml();
      case 'upgrades': return this._upgradesHtml();
      default:         return '';
    }
  }

  // ── Header (single inline row: slot picker + pro + grade) ──────────────
  _headerHtml () {
    const report = this._report;
    const proEntry = this._proEntry;
    const isSelfMatch = !!report.selfMatch;
    const conf = isSelfMatch ? 'self' : (this.matchConfidence || 'manual');
    const isFreshUpload = document.body.dataset.freshUpload === '1';
    const overallGradeClass = window.ReplayAnalyzer.gradeClass(report.overall.grade);
    const overallUnavailable = !report.overall || report.overall.grade === 'N/A'
      || (report.overall.score === 0 && Object.values(report.categories || {}).every(c => !c.available));

    const freshHeadline = isFreshUpload
      ? `<div class="ci-fresh-headline">Your replay is ready — here\'s how it stacks up.</div>`
      : '';

    const noticeHtml = this._headerNoticesHtml(conf);

    const proLabel = conf === 'self'      ? 'Same replay'
                   : conf === 'auto'      ? 'Auto-matched pro'
                   : conf === 'graded'    ? 'Best graded match'
                   : conf === 'divergent' ? 'Closest pro · Different build'
                   : conf === 'low'       ? 'Closest match · low confidence'
                   : 'Comparing to pro';
    const proLabelClass = conf === 'self'      ? 'ci-pro-pill-self'
                       : conf === 'auto'      ? 'ci-pro-pill-auto'
                       : conf === 'graded'    ? 'ci-pro-pill-graded'
                       : conf === 'divergent' ? 'ci-pro-pill-divergent'
                       : conf === 'low'       ? 'ci-pro-pill-lowconf'
                       : 'ci-pro-pill-manual';
    const proMetaParts = [
      (proEntry.buildMatchups && proEntry.buildMatchups[0]) || '',
      proEntry.buildName || ''
    ].filter(Boolean).map(escapeHtml);
    const proMeta = proMetaParts.length
      ? `<span class="ci-meta-pro-meta">${proMetaParts.join(' · ')}</span>`
      : '';

    const gradeRegion = overallUnavailable ? `
      <div class="ci-header-region ci-header-grade ci-header-grade-na" title="No overall grade — none of the scoring categories had comparable data.">
        <span class="ci-grade-letter ci-grade-na">N/A</span>
      </div>
    ` : `
      <div class="ci-header-region ci-header-grade">
        <span class="ci-grade-letter ${overallGradeClass}">${escapeHtml(report.overall.grade)}</span>
        <span class="ci-grade-score">${report.overall.score}/100</span>
      </div>
    `;

    // Always offer a way back to the chooser. Self-match is the only case
    // where re-picking doesn't make sense (the user can switch via slot
    // chips or close the drawer instead).
    const changeBtn = (conf === 'self' || !this.candidates.length)
      ? ''
      : `<button class="ci-header-change" type="button" data-action="open-chooser" title="Pick a different pro to compare against">Change pro</button>`;

    const headerRow = `
      <div class="ci-header-row">
        ${this._slotPickerRegionHtml()}
        <div class="ci-header-region ci-header-pro">
          <span class="ci-pro-pill ${proLabelClass}">${escapeHtml(proLabel)}</span>
          <span class="ci-meta-pro-name">${ut(proEntry.playerName || '?')}</span>
          ${proMeta}
          ${changeBtn}
        </div>
        ${gradeRegion}
      </div>
    `;

    return `
      ${freshHeadline}
      ${noticeHtml}
      ${headerRow}
    `;
  }

  // Slot picker region — sits inside the header row when more than one
  // player exists in the replay. Returns an empty string for single-player
  // replays so the row collapses to just pro + grade.
  _slotPickerRegionHtml () {
    const RACE_BADGE = { H: 'HU', O: 'ORC', E: 'NE', U: 'UD', R: '?' };
    const slotCards = (window.PlayerPicker && typeof window.PlayerPicker.buildCards === 'function')
      ? window.PlayerPicker.buildCards(this.userRecord && this.userRecord.parsedJson) : [];
    if (slotCards.length <= 1) return '';
    return `
      <div class="ci-header-region ci-header-slot" aria-label="Pick which player in this replay is you">
        <span class="ci-slot-chip-label">Compare as</span>
        <div class="ci-slot-chip-row">
          ${slotCards.map(c => {
            const isActive = String(c.slot) === String(this.userSlot);
            return `
              <button class="ci-slot-chip ${isActive ? 'ci-slot-chip-active' : ''}" type="button"
                      data-slot="${escapeAttr(c.slot)}" ${isActive ? 'aria-pressed="true"' : ''}>
                <span class="ci-slot-chip-race race-${escapeAttr(c.race || 'R')}">${escapeHtml(RACE_BADGE[c.race] || c.race || '?')}</span>
                <span class="ci-slot-chip-name">${escapeHtml(c.name || ('Slot ' + c.slot))}</span>
              </button>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // Renders contextual banners that explain why this comparison may not be
  // meaningful: low-confidence match (autoPick rejected), or uploaded-pro
  // detection (user uploaded a tournament replay we don't have indexed).
  _headerNoticesHtml (conf) {
    const notices = [];
    if (this.uploadedProInfo) {
      const { uploadedName } = this.uploadedProInfo;
      notices.push(`
        <div class="ci-notice ci-notice-pro-upload">
          <span class="ci-notice-icon" aria-hidden="true">★</span>
          <div class="ci-notice-body">
            <strong>Looks like a pro replay.</strong>
            Player <strong>${escapeHtml(uploadedName)}</strong> matches a pro in our library, but we don't have this exact game indexed. Comparing it against a different pro replay won't grade meaningfully — this tool is built to compare your play against pros, not pro vs. pro.
          </div>
        </div>
      `);
    }
    if (conf === 'graded') {
      notices.push(`
        <div class="ci-notice ci-notice-graded">
          <span class="ci-notice-icon" aria-hidden="true">✓</span>
          <div class="ci-notice-body">
            <strong>Showing the closest pro that grades.</strong>
            A higher-scored metadata match exists, but its game length doesn't overlap enough with yours to score categories. We picked the best pro that produces a real graded comparison. Use the chip strip to switch — the ✓ marks pros that will grade.
          </div>
        </div>
      `);
    }
    if (conf === 'low') {
      const score = this.topCandidateScore || 0;
      notices.push(`
        <div class="ci-notice ci-notice-lowconf">
          <span class="ci-notice-icon" aria-hidden="true">!</span>
          <div class="ci-notice-body">
            <strong>No confident pro match.</strong>
            The closest candidate scored ${score}/100 on race + matchup + map + archetype (need ≥ 85), and no candidate's game length overlaps enough with yours to grade. Switch pros below or use Advanced search.
          </div>
        </div>
      `);
    }
    // Composition divergence is the loudest signal — different signature
    // unit + low overlap means the comparison is fundamentally not measuring
    // build adherence. Surface it whether or not the match was auto-picked.
    // Copy varies: when conf='divergent' the matcher already tried and failed
    // to find a same-build pro, so don't tell the user to "switch pros".
    const guards = this._report && this._report.guards;
    if (guards && guards.compositionDivergent) {
      const c = guards.composition || {};
      const tail = (conf === 'divergent')
        ? `No pro in our library matches your build closely <em>and</em> has a comparable game length. We're showing the closest graded comparison; build-dependent categories are capped to reflect the mismatch.`
        : `Switch pros (or use Advanced search) for a closer build match.`;
      notices.push(`
        <div class="ci-notice ci-notice-divergent">
          <span class="ci-notice-icon" aria-hidden="true">⚠</span>
          <div class="ci-notice-body">
            <strong>Different army composition.</strong>
            You built mostly <strong>${escapeHtml(c.userSignatureName || '?')}</strong>; the pro built mostly <strong>${escapeHtml(c.proSignatureName || '?')}</strong>. Overall grade is capped at 70 because the comparison reflects your macro execution, not your build. ${tail}
          </div>
        </div>
      `);
    }
    return notices.join('');
  }

  // Sticky footer — switch-pro chips + watch CTAs. Always visible while a
  // report is rendered. Injected into #compare-drawer-foot, not rootEl.
  _footerHtml () {
    const proEntry = this._proEntry;
    const userRecordId = this.userRecord && this.userRecord.id;
    const watchProUrl = `/viewer?r=${encodeURIComponent(proEntry.replayId)}&player=${encodeURIComponent(proEntry.playerSlot)}&buildId=${encodeURIComponent(proEntry.buildId || '')}`;
    const watchMineUrl = userRecordId ? `/viewer?local=${encodeURIComponent(userRecordId)}` : '';
    const watchButtons = `
      <div class="ci-watch-row">
        ${watchMineUrl ? `<a class="ci-watch-cta ci-watch-mine" href="${escapeAttr(watchMineUrl)}">▶ Watch my replay</a>` : ''}
        <a class="ci-watch-cta ci-watch-pro" href="${escapeAttr(watchProUrl)}" target="_blank" rel="noopener">▶ Watch pro replay ↗</a>
      </div>
    `;
    return `${this._switcherHtml()}${watchButtons}`;
  }

  _tabsNavHtml () {
    const tabs = [
      { id: 'overview', label: 'Overview' },
      { id: 'build',    label: 'Build' },
      { id: 'tech',     label: 'Tech' },
      { id: 'economy',  label: 'Economy' },
      { id: 'heroes',   label: 'Heroes' },
      { id: 'creeps',   label: 'Creeps' },
      { id: 'upgrades', label: 'Upgrades' }
    ];
    return `
      <nav class="ci-tabs" role="tablist">
        ${tabs.map(t => `
          <button class="ci-tab ${t.id === this._activeTab ? 'ci-tab-active' : ''}"
                  role="tab" aria-selected="${t.id === this._activeTab ? 'true' : 'false'}"
                  data-tab="${escapeAttr(t.id)}">${escapeHtml(t.label)}</button>
        `).join('')}
      </nav>
    `;
  }

  _switcherHtml () {
    const proEntry = this._proEntry;
    const top = this.candidates.slice(0, 4);
    const chipsHtml = top.map(c => {
      const e = c.entry;
      const isCurrent = e.replayId === proEntry.replayId && String(e.playerSlot) === String(proEntry.playerSlot);
      // Two independent signals: ✓ (grades) and ≠ (build divergent). A pro
      // with both icons grades but with a wrong build; a pro with only ✓ is
      // the ideal target. No icon = won't grade.
      const gradedBadge = c.grades
        ? '<span class="ci-chip-graded" title="Game length overlaps enough to grade">✓</span>'
        : '';
      const divergentBadge = c.divergent
        ? '<span class="ci-chip-divergent" title="Different signature unit — build doesn\'t match yours">≠</span>'
        : '';
      const cls = c.grades && !c.divergent ? 'ci-chip-grades'
                : c.grades && c.divergent  ? 'ci-chip-grades ci-chip-build-mismatch'
                : 'ci-chip-no-grade';
      return `
        <button class="ci-chip ${isCurrent ? 'ci-chip-active' : ''} ${cls}" data-replay-id="${escapeAttr(e.replayId)}" data-slot="${escapeAttr(e.playerSlot)}">
          <span class="ci-chip-race race-${escapeAttr(e.buildRace || '?')}">${escapeHtml(e.buildRace || '?')}</span>
          <span class="ci-chip-name">${ut(e.playerName || '?')}</span>
          <span class="ci-chip-mu">${escapeHtml((e.buildMatchups && e.buildMatchups[0]) || '')}</span>
          ${gradedBadge}${divergentBadge}
        </button>
      `;
    }).join('');
    return `
      <div class="ci-switcher">
        <div class="ci-switcher-label">Switch pro:</div>
        <div class="ci-chips">${chipsHtml}</div>
        <button class="ci-advanced-btn" type="button">Advanced search…</button>
      </div>
    `;
  }

  // ── Tab: Overview ───────────────────────────────────────────────────────
  _overviewHtml () {
    const report = this._report;
    // Compatibility checklist (full version, not collapsed).
    const checklistHtml = (report.compatibility || []).map(c => `
      <div class="ci-check ci-check-${c.status}">
        <span class="ci-check-icon">${CHECK_ICON[c.status] || '·'}</span>
        <span class="ci-check-label">${escapeHtml(c.label)}</span>
        <span class="ci-check-detail">${escapeHtml(c.detail || '')}</span>
      </div>
    `).join('');

    // Split categories into graded and ungraded, then group ungraded by
    // shared reason so we don't repeat the same "Not graded because…" text
    // 9 times. Each ungraded group renders as one banner + a compact row
    // of category chips.
    const graded = [];
    const ungradedByReason = new Map();
    CATEGORY_ORDER.forEach(k => {
      const cat = report.categories[k];
      if (!cat) return;
      if (cat.available) {
        graded.push(k);
      } else {
        const reasonKey = cat.reason || '__no_reason__';
        if (!ungradedByReason.has(reasonKey)) ungradedByReason.set(reasonKey, []);
        ungradedByReason.get(reasonKey).push(k);
      }
    });

    const gradedTilesHtml = graded.map(k => this._tileHtml(k, report.categories[k])).join('');
    const ungradedHtml = Array.from(ungradedByReason.entries())
      .map(([reason, keys]) => this._ungradedGroupHtml(reason, keys))
      .join('');

    // "Top fixes" — collect warn-severity findings across categories,
    // weight by analyzer weight, take top 3, render as coaching cards.
    const fixes = this._topFixes(report, 3);
    const fixesHtml = this._topFixesHtml(fixes);

    return `
      <div class="ci-checklist" aria-label="Compatibility checklist">${checklistHtml}</div>
      ${gradedTilesHtml ? `<div class="ci-tiles">${gradedTilesHtml}</div>` : ''}
      ${ungradedHtml}
      ${fixesHtml}
    `;
  }

  _tileHtml (k, cat) {
    if (!cat) return '';
    const findings = (cat.findings || []).slice(0, 2).map(f =>
      `<li class="ci-finding ci-finding-${f.severity}">${escapeHtml(f.text)}</li>`
    ).join('');
    const grade = cat.grade;
    const gradeCls = window.ReplayAnalyzer.gradeClass(grade);
    const drillTab = TILE_TO_TAB[k];
    const drillBtn = drillTab ? `<button class="ci-tile-drill" data-target-tab="${escapeAttr(drillTab)}">View detail →</button>` : '';
    return `
      <div class="ci-tile ci-tile-on" data-cat="${escapeAttr(k)}">
        <div class="ci-tile-head">
          <div class="ci-tile-label">${escapeHtml(CATEGORY_LABELS[k] || k)}<span class="ci-tile-info" title="${escapeAttr(TILE_INFO[k] || '')}">?</span></div>
          <div class="ci-tile-grade ${gradeCls}">${escapeHtml(grade)}</div>
        </div>
        <div class="ci-tile-score">${cat.score}/100</div>
        ${findings ? `<ul class="ci-findings">${findings}</ul>` : ''}
        ${drillBtn}
      </div>
    `;
  }

  // Render one ungraded group: a single banner explaining the shared
  // reason, plus a compact row of category chips so the user still sees
  // which metrics were skipped.
  _ungradedGroupHtml (reasonKey, keys) {
    if (!keys.length) return '';
    const reason = reasonKey === '__no_reason__'
      ? 'Data unavailable for these categories.'
      : (REASON_PRETTY[reasonKey] || reasonKey);
    const chips = keys.map(k => `
      <span class="ci-ungraded-chip" title="${escapeAttr(TILE_INFO[k] || '')}">
        ${escapeHtml(CATEGORY_LABELS[k] || k)}
      </span>
    `).join('');
    const count = keys.length;
    return `
      <div class="ci-ungraded-group">
        <div class="ci-ungraded-head">
          <span class="ci-ungraded-badge">Not graded · ${count}</span>
          <span class="ci-ungraded-reason">${escapeHtml(reason)}</span>
        </div>
        <div class="ci-ungraded-chips">${chips}</div>
      </div>
    `;
  }

  // ── Tab: Build ──────────────────────────────────────────────────────────
  _buildHtml () {
    const u = this.userSummary.players[this.userSlot] || {};
    const p = (this._proSummary.players || {})[String(this._proEntry.playerSlot)] || {};
    const userPreview = (u.buildPreview || []).slice(0, 20);
    const proPreview = (p.buildPreview || []).slice(0, 20);
    const userIds = new Set(userPreview.map(b => b.itemId));
    const proIds = new Set(proPreview.map(b => b.itemId));
    const ba = this._report.categories.buildAdherence || {};
    const divPt = (ba.detail && ba.detail.divergencePoint) || null;

    const renderRows = (rows, otherIds, divIndex) => rows.map((r, i) => {
      const ic = iconUrl(r.itemId);
      const matchCls = otherIds.has(r.itemId) ? 'ci-bo-row-match' : 'ci-bo-row-miss';
      const divCls = (divIndex !== null && i === divIndex) ? ' ci-bo-row-divergence' : '';
      const typeBadge = r.type === 'expansion' ? '<span class="ci-bo-badge ci-bo-badge-expo">EXPO</span>'
        : r.type === 'hero' ? '<span class="ci-bo-badge ci-bo-badge-hero">HERO</span>' : '';
      return `
        <div class="ci-bo-row ${matchCls}${divCls}">
          <span class="ci-bo-index">${i + 1}</span>
          <img class="ci-bo-icon" src="${escapeAttr(ic)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/>
          <div class="ci-bo-name">${escapeHtml(r.name || '')}${typeBadge}</div>
          <div class="ci-bo-time">${escapeHtml(window.ReplayAnalyzer.formatMs(r.gameTimeMs || 0))}</div>
        </div>
      `;
    }).join('') || '<div class="ci-bo-empty">No build data.</div>';

    const divergenceBanner = divPt ? `
      <div class="ci-divergence-banner">
        <strong>Builds match through ${divPt.index} event${divPt.index === 1 ? '' : 's'}.</strong>
        Diverged at event ${divPt.index + 1} (${escapeHtml(window.ReplayAnalyzer.formatMs((divPt.userBuilding && divPt.userBuilding.gameTimeMs) || 0))}):
        you went <strong>${escapeHtml((divPt.userBuilding && divPt.userBuilding.name) || '?')}</strong>,
        pro went <strong>${escapeHtml((divPt.proBuilding && divPt.proBuilding.name) || '?')}</strong>.
      </div>
    ` : '';

    // Tier composition side-by-side.
    const compHtml = (label, list) => {
      if (!list || !list.length) return `<div class="ci-comp-empty">— none —</div>`;
      return `
        <div class="ci-comp-grid">
          ${list.map(it => `
            <div class="ci-comp-icon" title="${escapeAttr(it.name)}">
              <img src="${escapeAttr(iconUrl(it.itemId))}" alt="${escapeAttr(it.name)}" loading="lazy" onerror="this.style.visibility='hidden'"/>
            </div>
          `).join('')}
        </div>
      `;
    };
    const tierBlock = (tierLabel, userBuildings, userUnits, proBuildings, proUnits) => `
      <div class="ci-tier-block">
        <h4 class="ci-tier-block-title">${escapeHtml(tierLabel)}</h4>
        <div class="ci-vs-grid">
          <div class="ci-comp-side">
            <div class="ci-side-label">You · Buildings</div>
            ${compHtml('Buildings', userBuildings)}
            <div class="ci-side-label" style="margin-top:0.5rem">You · Units</div>
            ${compHtml('Units', userUnits)}
          </div>
          <div class="ci-comp-side">
            <div class="ci-side-label">Pro · Buildings</div>
            ${compHtml('Buildings', proBuildings)}
            <div class="ci-side-label" style="margin-top:0.5rem">Pro · Units</div>
            ${compHtml('Units', proUnits)}
          </div>
        </div>
      </div>
    `;

    return `
      <section class="ci-section">
        <h3 class="ci-section-title">Build order — first 20 events</h3>
        ${divergenceBanner}
        <div class="ci-vs-grid">
          <div class="ci-bo-track">
            <div class="ci-side-label">You — ${ut(PlayerNames.canonical(u.name) || '')}</div>
            <div class="ci-bo-rows">${renderRows(userPreview, proIds, divPt ? divPt.index : null)}</div>
          </div>
          <div class="ci-bo-track">
            <div class="ci-side-label">Pro — ${ut(PlayerNames.canonical(p.name) || this._proEntry.playerName || '')}</div>
            <div class="ci-bo-rows">${renderRows(proPreview, userIds, divPt ? divPt.index : null)}</div>
          </div>
        </div>
        <div class="ci-bo-legend">
          <span class="ci-bo-legend-pip ci-bo-legend-match"></span> in both builds &nbsp;&nbsp;
          <span class="ci-bo-legend-pip ci-bo-legend-miss"></span> only on this side
          ${divPt ? '&nbsp;&nbsp;<span class="ci-bo-legend-pip ci-bo-legend-div"></span> divergence' : ''}
        </div>
      </section>
      <section class="ci-section">
        <h3 class="ci-section-title">Tier composition</h3>
        ${tierBlock('Tier 2', u.t2Buildings || [], u.t2Units || [], p.t2Buildings || [], p.t2Units || [])}
        ${tierBlock('Tier 3', u.t3Buildings || [], u.t3Units || [], p.t3Buildings || [], p.t3Units || [])}
      </section>
    `;
  }

  // ── Tab: Tech ───────────────────────────────────────────────────────────
  _techHtml () {
    const u = this.userSummary.players[this.userSlot] || {};
    const p = (this._proSummary.players || {})[String(this._proEntry.playerSlot)] || {};
    const totalMs = Math.max(this.userSummary.durationMs || 0, this._proSummary.durationMs || 0);
    const RACE_ACCENT = { H: '#4eb6e0', O: '#d04848', E: '#5cb878', U: '#9b59b6', R: '#888' };
    const tierBars = `
      <div class="ci-tier-bars">
        ${window.CompareCharts.tierProgressionRow(`You (${u.race || '?'}) — ${ut(PlayerNames.canonical(u.name) || '')}`, u.tier2Time, u.tier3Time, totalMs, RACE_ACCENT[u.race])}
        ${window.CompareCharts.tierProgressionRow(`Pro (${p.race || '?'}) — ${ut(PlayerNames.canonical(p.name) || this._proEntry.playerName || '')}`, p.tier2Time, p.tier3Time, totalMs, RACE_ACCENT[p.race])}
        <div class="ci-tier-legend">
          <span class="ci-tier-legend-pip ci-tier-legend-t1"></span>T1
          <span class="ci-tier-legend-pip ci-tier-legend-t2"></span>T2
          <span class="ci-tier-legend-pip ci-tier-legend-t3"></span>T3
        </div>
      </div>
    `;

    // Key timings table (T2/T3/Hero L2/L3/L5/First Unit/First Tower/Expansion).
    const fmt = (ms) => ms != null ? window.ReplayAnalyzer.formatMs(ms) : '—';
    const deltaCell = (userMs, proMs) => {
      if (userMs == null || proMs == null) return '—';
      const d = (userMs - proMs) / 1000;
      const sign = d > 0 ? '+' : '−';
      const cls = Math.abs(d) < 30 ? 'ci-delta-good' : (d > 0 ? 'ci-delta-late' : 'ci-delta-early');
      return `<span class="${cls}">${sign}${Math.abs(d).toFixed(0)}s</span>`;
    };
    const rows = [
      ['Tier 2',          u.tier2Time,           p.tier2Time],
      ['Tier 3',          u.tier3Time,           p.tier3Time],
      ['Hero L2',         u.firstHeroLevel2Time, p.firstHeroLevel2Time],
      ['Hero L3',         u.firstHeroLevel3Time, p.firstHeroLevel3Time],
      ['Hero L5',         u.firstHeroLevel5Time, p.firstHeroLevel5Time],
      ['First combat unit', u.firstUnitTime,     p.firstUnitTime],
      ['First tower',     u.firstTowerTime,      p.firstTowerTime],
      ['Expansion',       u.expansionTime,       p.expansionTime]
    ];
    const tableRows = rows.map(([label, ut, pt]) => `
      <tr>
        <td>${escapeHtml(label)}</td>
        <td>${fmt(ut)}</td>
        <td>${fmt(pt)}</td>
        <td>${deltaCell(ut, pt)}</td>
      </tr>
    `).join('');

    return `
      <div class="ci-tech-grid">
        <section class="ci-section">
          <h3 class="ci-section-title">Tier progression</h3>
          ${tierBars}
        </section>
        <section class="ci-section">
          <h3 class="ci-section-title">Key timings</h3>
          <table class="ci-timings-table">
            <thead>
              <tr><th>Milestone</th><th>You</th><th>Pro</th><th>Delta</th></tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </section>
      </div>
    `;
  }

  // ── Tab: Economy ────────────────────────────────────────────────────────
  _economyHtml () {
    const u = this.userSummary.players[this.userSlot] || {};
    const p = (this._proSummary.players || {})[String(this._proEntry.playerSlot)] || {};
    const supplySvg  = window.CompareCharts.supplyChart(u.economyTrack, p.economyTrack);
    const workersSvg = window.CompareCharts.workersChart(u.economyTrack, p.economyTrack);
    const idleSvg    = window.CompareCharts.idleHeadroomChart(u.economyTrack, p.economyTrack);
    const combatSvg  = window.CompareCharts.combatUnitsChart(u.combatUnitsTrack, p.combatUnitsTrack);

    const lastU = (u.economyTrack && u.economyTrack[u.economyTrack.length - 1]) || {};
    const lastP = (p.economyTrack && p.economyTrack[p.economyTrack.length - 1]) || {};
    const finalRow = (label, uVal, pVal) => `
      <tr><td>${escapeHtml(label)}</td><td>${escapeHtml(String(uVal))}</td><td>${escapeHtml(String(pVal))}</td></tr>
    `;
    const finalTable = `
      <table class="ci-final-table">
        <thead><tr><th></th><th>You</th><th>Pro</th></tr></thead>
        <tbody>
          ${finalRow('Final supply used', lastU.supplyUsed || 0, lastP.supplyUsed || 0)}
          ${finalRow('Final supply max', lastU.supplyMax || 0, lastP.supplyMax || 0)}
          ${finalRow('Workers on gold', lastU.workersOnGold || 0, lastP.workersOnGold || 0)}
          ${finalRow('Workers on lumber', lastU.workersOnLumber || 0, lastP.workersOnLumber || 0)}
          ${finalRow('Total workers', lastU.totalWorkers || 0, lastP.totalWorkers || 0)}
        </tbody>
      </table>
    `;

    return `
      <div class="ci-economy-grid">
        <section class="ci-section">
          <h3 class="ci-section-title">Supply</h3>
          ${supplySvg || '<div class="ci-empty-mini">No supply data.</div>'}
          <div class="ci-chart-legend"><span class="ci-chart-pip ci-chart-pip-you"></span>You &nbsp;<span class="ci-chart-pip ci-chart-pip-pro"></span>Pro</div>
        </section>
        <section class="ci-section">
          <h3 class="ci-section-title">Workers</h3>
          ${workersSvg || '<div class="ci-empty-mini">No worker data.</div>'}
        </section>
        <section class="ci-section">
          <h3 class="ci-section-title">Idle supply headroom <small>— how much unused supply you sat on</small></h3>
          ${idleSvg || '<div class="ci-empty-mini">No data.</div>'}
        </section>
        <section class="ci-section">
          <h3 class="ci-section-title">Combat units over time</h3>
          ${combatSvg || '<div class="ci-empty-mini">No combat unit data.</div>'}
        </section>
        <section class="ci-section ci-economy-final">
          <h3 class="ci-section-title">Final economy snapshot</h3>
          ${finalTable}
        </section>
      </div>
    `;
  }

  // ── Tab: Heroes ─────────────────────────────────────────────────────────
  _heroesHtml () {
    const u = this.userSummary.players[this.userSlot] || {};
    const p = (this._proSummary.players || {})[String(this._proEntry.playerSlot)] || {};
    const userHeroes = u.heroBuilds || [];
    const proHeroes = p.heroBuilds || [];
    if (!userHeroes.length && !proHeroes.length) {
      return '<div class="ci-empty-mini">No hero data available.</div>';
    }
    // Pair heroes by itemId where possible; otherwise pair by index.
    const byId = (arr) => {
      const m = {};
      for (const h of arr) m[h.itemId] = h;
      return m;
    };
    const proById = byId(proHeroes);
    const seenPro = {};
    const pairs = [];
    for (const uh of userHeroes) {
      const ph = proById[uh.itemId];
      if (ph) { pairs.push({ user: uh, pro: ph }); seenPro[uh.itemId] = 1; }
      else pairs.push({ user: uh, pro: null });
    }
    for (const ph of proHeroes) {
      if (!seenPro[ph.itemId]) pairs.push({ user: null, pro: ph });
    }

    this._heroPairs = pairs;
    if (this._activeHeroIdx >= pairs.length) this._activeHeroIdx = 0;
    const activeIdx = this._activeHeroIdx;

    const subtabs = pairs.length > 1 ? this._heroSubtabsHtml(pairs, activeIdx) : '';
    const panel = this._heroPanelHtml(pairs[activeIdx]);
    return `
      ${subtabs}
      <div class="ci-hero-panel">${panel}</div>
    `;
  }

  // Portrait chip strip used to switch which hero's panel is visible.
  _heroSubtabsHtml (pairs, activeIdx) {
    return `
      <nav class="ci-hero-subtabs" role="tablist" aria-label="Heroes">
        ${pairs.map((pair, i) => {
          const ref = pair.user || pair.pro;
          const heroName = ref ? ref.name : 'Hero';
          const portrait = ref ? iconUrl(ref.itemId) : '';
          const userLvl = pair.user ? pair.user.finalLevel : 0;
          const proLvl = pair.pro ? pair.pro.finalLevel : 0;
          const isActive = i === activeIdx;
          return `
            <button class="ci-hero-chip ${isActive ? 'ci-hero-chip-active' : ''}" type="button"
                    role="tab" aria-selected="${isActive ? 'true' : 'false'}" data-hero-idx="${i}">
              <img class="ci-hero-chip-portrait" src="${escapeAttr(portrait)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/>
              <span class="ci-hero-chip-name">${escapeHtml(heroName)}</span>
              <span class="ci-hero-chip-levels">L${userLvl} · L${proLvl}</span>
            </button>
          `;
        }).join('')}
      </nav>
    `;
  }

  // Single-hero panel: skill build grid + level delta table + items grid.
  _heroPanelHtml (pair) {
    if (!pair) return '<div class="ci-empty-mini">No hero data.</div>';
    const ref = pair.user || pair.pro;
    const portrait = ref ? iconUrl(ref.itemId) : '';
    const heroName = ref ? ref.name : 'Hero';
    const userLevel = pair.user ? pair.user.finalLevel : 0;
    const proLevel = pair.pro ? pair.pro.finalLevel : 0;

    return `
      <section class="ci-hero-section">
        <header class="ci-hero-section-head">
          <img class="ci-hero-section-portrait" src="${escapeAttr(portrait)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/>
          <div class="ci-hero-section-meta">
            <div class="ci-hero-section-name">${escapeHtml(heroName)}</div>
            <div class="ci-hero-section-levels">You L${userLevel} · Pro L${proLevel}</div>
          </div>
        </header>
        <div class="ci-hero-block">
          <h4 class="ci-hero-block-title">Skill build</h4>
          ${this._skillBuildHtml(pair)}
        </div>
        <div class="ci-hero-bottom-row">
          <div class="ci-hero-block">
            <h4 class="ci-hero-block-title">Level milestones</h4>
            ${this._levelDeltaTableHtml(pair)}
          </div>
          <div class="ci-hero-block">
            <h4 class="ci-hero-block-title">Items</h4>
            ${this._heroItemsHtml(pair)}
          </div>
        </div>
      </section>
    `;
  }

  // Skill build: 4-row CSS grid (header, you, connector, pro).
  _skillBuildHtml (pair) {
    const userPicks = (pair.user && pair.user.skillOrder) || [];
    const proPicks = (pair.pro && pair.pro.skillOrder) || [];
    const limit = Math.max(userPicks.length, proPicks.length, 5);

    const skillCell = (pk, matchOther) => {
      if (!pk) {
        return `<div class="ci-skill2-cell ci-skill2-empty" aria-hidden="true"><div class="ci-skill2-icon-slot"></div><div class="ci-skill2-name">—</div></div>`;
      }
      const isUltimate = pk.skillLevel === 1 && (pk.heroLevel === 6 || pk.heroLevel === 10);
      const max = isUltimate ? 1 : 3;
      const pips = [];
      for (let r = 1; r <= max; r++) {
        pips.push(`<span class="ci-skill2-pip ${r <= pk.skillLevel ? 'ci-skill2-pip-on' : ''}"></span>`);
      }
      const cls = matchOther === true ? 'ci-skill2-match'
                 : matchOther === false ? 'ci-skill2-miss' : '';
      const ic = pk.abilityId ? iconUrl(pk.abilityId) : '';
      return `
        <div class="ci-skill2-cell ${cls}" title="${escapeAttr(pk.skillName)} L${pk.skillLevel} @ ${escapeAttr(pk.gameTimeFormatted || '')}">
          <div class="ci-skill2-icon-slot">
            ${ic ? `<img class="ci-skill2-icon" src="${escapeAttr(ic)}" alt="${escapeAttr(pk.skillName)}" loading="lazy" onerror="this.style.display='none'"/>` : ''}
            <div class="ci-skill2-rank">${pips.join('')}</div>
          </div>
          <div class="ci-skill2-name" title="${escapeAttr(pk.skillName)}">${escapeHtml(pk.skillName)}</div>
          <div class="ci-skill2-foot"><span class="ci-skill2-hl">L${pk.heroLevel}</span><span class="ci-skill2-time">${escapeHtml(pk.gameTimeFormatted || '')}</span></div>
        </div>
      `;
    };

    const headerCols = [];
    for (let i = 0; i < limit; i++) headerCols.push(`<div class="ci-skill2-head-col">Hero L${i + 1}</div>`);

    const userCells = [];
    const proCells = [];
    const connectors = [];
    for (let i = 0; i < limit; i++) {
      const a = userPicks[i] || null, b = proPicks[i] || null;
      const sameSkill = a && b && (a.abilityId ? a.abilityId === b.abilityId : a.skillName === b.skillName);
      userCells.push(skillCell(a, a && b ? sameSkill : null));
      proCells.push(skillCell(b, a && b ? sameSkill : null));
      if (!a || !b) {
        connectors.push(`<div class="ci-skill2-conn ci-skill2-conn-na"></div>`);
      } else {
        connectors.push(`<div class="ci-skill2-conn ${sameSkill ? 'ci-skill2-conn-match' : 'ci-skill2-conn-miss'}">${sameSkill ? '✓' : '✗'}</div>`);
      }
    }

    return `
      <div class="ci-skill2-grid" style="--ci-skill2-cols:${limit}">
        <div class="ci-skill2-side-label">&nbsp;</div>
        ${headerCols.join('')}
        <div class="ci-skill2-side-label">You</div>
        ${userCells.join('')}
        <div class="ci-skill2-side-label">&nbsp;</div>
        ${connectors.join('')}
        <div class="ci-skill2-side-label">Pro</div>
        ${proCells.join('')}
      </div>
    `;
  }

  // Level milestones: comparison table with per-level Δ between you and pro.
  _levelDeltaTableHtml (pair) {
    const userMs = {};
    const proMs = {};
    if (pair.user && Array.isArray(pair.user.levelMilestones)) {
      for (const m of pair.user.levelMilestones) userMs[m.level] = m.gameTimeMs;
    }
    if (pair.pro && Array.isArray(pair.pro.levelMilestones)) {
      for (const m of pair.pro.levelMilestones) proMs[m.level] = m.gameTimeMs;
    }
    const levels = Array.from(new Set([
      ...Object.keys(userMs).map(Number),
      ...Object.keys(proMs).map(Number)
    ])).sort((a, b) => a - b);
    if (!levels.length) return '<div class="ci-empty-mini">No level-ups recorded.</div>';

    const fmt = (ms) => {
      if (typeof ms !== 'number' || !isFinite(ms)) return '—';
      const total = Math.round(ms / 1000);
      const m = Math.floor(total / 60);
      const s = total % 60;
      return `${m}:${s.toString().padStart(2, '0')}`;
    };
    const fmtDelta = (deltaMs) => {
      const sign = deltaMs >= 0 ? '+' : '−';
      return `${sign}${fmt(Math.abs(deltaMs))}`;
    };

    const rows = levels.map(level => {
      const a = userMs[level];
      const b = proMs[level];
      let deltaCell = '<td class="ci-delta-na">—</td>';
      if (typeof a === 'number' && typeof b === 'number') {
        const d = a - b;
        const cls = d > 0 ? 'ci-delta-slower' : d < 0 ? 'ci-delta-faster' : '';
        deltaCell = `<td class="${cls}">${d === 0 ? '0:00' : fmtDelta(d)}</td>`;
      }
      return `
        <tr>
          <td class="ci-level-cell">L${level}</td>
          <td>${fmt(a)}</td>
          <td>${fmt(b)}</td>
          ${deltaCell}
        </tr>
      `;
    }).join('');

    return `
      <table class="ci-hero-levels">
        <thead>
          <tr><th>Level</th><th>You</th><th>Pro</th><th>Δ</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  // Items: fixed 6-slot inventory grid per side. Empty boxes for unused slots.
  // Shared items get a green outline, pro-only items get a gold outline so the
  // user can see what they're missing at a glance.
  _heroItemsHtml (pair) {
    const userItems = (pair.user && pair.user.items) || [];
    const proItems = (pair.pro && pair.pro.items) || [];
    const userIds = new Set(userItems.map(it => it.itemId));
    const proIds = new Set(proItems.map(it => it.itemId));
    const slotsPerRow = 6;
    const sideRowCount = (list) => Math.max(1, Math.ceil(list.length / slotsPerRow));
    const rowCount = Math.max(sideRowCount(userItems), sideRowCount(proItems));
    const totalSlots = rowCount * slotsPerRow;

    const cell = (it, otherSet, isProSide) => {
      if (!it) return '<div class="ci-hero-item-empty"></div>';
      const shared = otherSet.has(it.itemId);
      const proOnly = isProSide && !shared;
      const cls = shared ? 'ci-hero-item-shared'
                : proOnly ? 'ci-hero-item-pro-only' : '';
      return `<img class="ci-hero-item ${cls}" src="${escapeAttr(iconUrl(it.itemId))}" alt="${escapeAttr(it.name)}" title="${escapeAttr(it.name)}" loading="lazy" onerror="this.style.visibility='hidden'"/>`;
    };

    const renderRow = (label, list, otherSet, isProSide) => {
      const cells = [];
      for (let i = 0; i < totalSlots; i++) cells.push(cell(list[i], otherSet, isProSide));
      return `
        <div class="ci-hero-item-row">
          <div class="ci-side-label">${escapeHtml(label)}</div>
          <div class="ci-hero-items" style="--ci-item-cols:${slotsPerRow}">${cells.join('')}</div>
        </div>
      `;
    };

    return `
      <div class="ci-hero-items-wrap">
        ${renderRow('You', userItems, proIds, false)}
        ${renderRow('Pro', proItems, userIds, true)}
      </div>
    `;
  }

  _setHeroSubTab (idx) {
    if (idx === this._activeHeroIdx) return;
    this._activeHeroIdx = idx;
    // Toggle chip active class without re-rendering the strip (preserves
    // scroll position of the chip row when there are many heroes).
    this.rootEl.querySelectorAll('.ci-hero-chip').forEach(chip => {
      const active = String(chip.dataset.heroIdx) === String(idx);
      chip.classList.toggle('ci-hero-chip-active', active);
      chip.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const panel = this.rootEl.querySelector('.ci-hero-panel');
    if (panel && this._heroPairs && this._heroPairs[idx]) {
      panel.innerHTML = this._heroPanelHtml(this._heroPairs[idx]);
    }
  }

  // ── Tab: Upgrades ───────────────────────────────────────────────────────
  // Horizontal Gantt-style: one block per category (attack / defense /
  // ability). Inside each block, two stacked time tracks (You / Pro). Each
  // upgrade is an icon+name card placed at its game-time X coordinate.
  // Collisions (events within ~10% of width) stack vertically inside the
  // same track instead of overlapping.
  _upgradesHtml () {
    const u = this.userSummary.players[this.userSlot] || {};
    const p = (this._proSummary.players || {})[String(this._proEntry.playerSlot)] || {};
    const userU = u.upgradeTimeline || [];
    const proU = p.upgradeTimeline || [];
    const totalMs = Math.max(this.userSummary.durationMs || 0, this._proSummary.durationMs || 0, 60_000);

    const countByCat = (list) => {
      const c = { attack: 0, defense: 0, ability: 0 };
      for (const r of list) c[r.category] = (c[r.category] || 0) + 1;
      return c;
    };
    const uc = countByCat(userU);
    const pc = countByCat(proU);
    const totalsRow = `
      <div class="ci-upg2-totals">
        <span class="ci-upg2-total ci-upg2-total-attack"><span class="ci-upg2-dot"></span>Attack <strong>You ${uc.attack || 0}</strong> · <strong>Pro ${pc.attack || 0}</strong></span>
        <span class="ci-upg2-total ci-upg2-total-defense"><span class="ci-upg2-dot"></span>Defense <strong>You ${uc.defense || 0}</strong> · <strong>Pro ${pc.defense || 0}</strong></span>
        <span class="ci-upg2-total ci-upg2-total-ability"><span class="ci-upg2-dot"></span>Ability/Research <strong>You ${uc.ability || 0}</strong> · <strong>Pro ${pc.ability || 0}</strong></span>
      </div>
    `;

    const block = (catKey, label, userEvts, proEvts) => {
      if (!userEvts.length && !proEvts.length) {
        return `
          <section class="ci-upg2-block ci-upg2-${catKey}">
            <header class="ci-upg2-block-head"><span class="ci-upg2-cat-label">${escapeHtml(label)}</span></header>
            <div class="ci-empty-mini">Neither side researched anything in this category.</div>
          </section>
        `;
      }
      return `
        <section class="ci-upg2-block ci-upg2-${catKey}">
          <header class="ci-upg2-block-head"><span class="ci-upg2-cat-label">${escapeHtml(label)}</span></header>
          <div class="ci-upg2-track-wrap">
            <div class="ci-upg2-side-label">You</div>
            ${this._renderUpgradeTrack(userEvts, totalMs, catKey)}
            <div class="ci-upg2-side-label">Pro</div>
            ${this._renderUpgradeTrack(proEvts, totalMs, catKey)}
            <div class="ci-upg2-axis-spacer"></div>
            ${this._renderUpgradeAxis(totalMs)}
          </div>
        </section>
      `;
    };
    const filterCat = (list, cat) => list.filter(r => r.category === cat);
    const sectionsHtml = [
      block('attack',  'Attack upgrades',  filterCat(userU, 'attack'),  filterCat(proU, 'attack')),
      block('defense', 'Defense upgrades', filterCat(userU, 'defense'), filterCat(proU, 'defense')),
      block('ability', 'Ability / Research', filterCat(userU, 'ability'), filterCat(proU, 'ability'))
    ].join('');

    const findings = ((this._report.categories.upgrades || {}).findings || [])
      .map(f => `<li class="ci-finding ci-finding-${f.severity}">${escapeHtml(f.text)}</li>`).join('');
    const findingsHtml = findings ? `<section class="ci-section"><h3 class="ci-section-title">Findings</h3><ul class="ci-findings">${findings}</ul></section>` : '';

    return `
      <section class="ci-section">
        <h3 class="ci-section-title">Upgrades summary</h3>
        ${totalsRow}
      </section>
      ${sectionsHtml}
      ${findingsHtml}
    `;
  }

  // Place each upgrade as an absolutely-positioned card on a horizontal
  // time axis. Detect horizontal collision and stack onto a higher row so
  // labels never overlap.
  _renderUpgradeTrack (events, maxMs, catKey) {
    if (!events || !events.length) return '<div class="ci-upg2-track ci-upg2-track-empty">— none —</div>';
    const MIN_GAP_PCT = 12;
    const sorted = events.slice().sort((a, b) => a.gameTimeMs - b.gameTimeMs);
    const placed = [];
    for (const e of sorted) {
      const xPct = Math.max(0, Math.min(100, (e.gameTimeMs / maxMs) * 100));
      let row = 0;
      while (placed.some(p => p.row === row && Math.abs(p.xPct - xPct) < MIN_GAP_PCT)) row++;
      placed.push({ ev: e, xPct, row });
    }
    const maxRow = placed.reduce((m, p) => Math.max(m, p.row), 0);
    const trackHeight = 36 + maxRow * 34;
    const cards = placed.map(({ ev, xPct, row }) => {
      const ic = ev.icon ? `/assets/wc3icons/${encodeURIComponent(ev.icon)}.jpg`
              : ev.itemId ? iconUrl(ev.itemId) : '';
      const lvl = (ev.level && ev.level > 1) ? ` <span class="ci-upg2-lvl">L${ev.level}</span>` : '';
      return `
        <div class="ci-upg2-event" style="left:${xPct.toFixed(2)}%; top:${(row * 34).toFixed(0)}px;" title="${escapeAttr(ev.name)} ${ev.level > 1 ? 'L' + ev.level : ''} @ ${escapeAttr(ev.gameTimeFormatted || '')}">
          <span class="ci-upg2-event-pin"></span>
          <span class="ci-upg2-event-card">
            ${ic ? `<img class="ci-upg2-event-icon" src="${escapeAttr(ic)}" alt="" loading="lazy" onerror="this.style.display='none'"/>` : ''}
            <span class="ci-upg2-event-name">${escapeHtml(ev.name)}${lvl}</span>
            <span class="ci-upg2-event-time">${escapeHtml(ev.gameTimeFormatted || '')}</span>
          </span>
        </div>
      `;
    }).join('');
    return `<div class="ci-upg2-track ci-upg2-track-${catKey}" style="height:${trackHeight}px;"><div class="ci-upg2-track-line"></div>${cards}</div>`;
  }

  // Bottom axis with minute-tick labels.
  _renderUpgradeAxis (maxMs) {
    const ticks = [];
    const step = maxMs > 20 * 60_000 ? 4 : maxMs > 10 * 60_000 ? 2 : 1;
    for (let m = 0; m <= maxMs / 60_000; m += step) {
      const xPct = (m * 60_000 / maxMs) * 100;
      ticks.push(`<div class="ci-upg2-axis-tick" style="left:${xPct.toFixed(2)}%;">${m}:00</div>`);
    }
    return `<div class="ci-upg2-axis">${ticks.join('')}</div>`;
  }

  // ── Tab: Creeps ─────────────────────────────────────────────────────────
  // Map-based creep route comparison. Background = the existing
  // /maps/{folder}/map.jpg minimap; coordinates come from walkmap.json
  // (originX, originY, cellSize, rows, cols). Camps are drawn as numbered
  // dots with lines connecting them in clearing order. User route is one
  // color, pro route another. If maps differ, only the user's route is
  // shown with a warning.
  _creepsHtml () {
    const u = this.userSummary.players[this.userSlot] || {};
    const p = (this._proSummary.players || {})[String(this._proEntry.playerSlot)] || {};
    const userMapName = (this.userSummary.mapInfo && this.userSummary.mapInfo.name) || null;
    const proMapName  = (this._proSummary.mapInfo && this._proSummary.mapInfo.name) || null;
    const sameMap = !!(userMapName && proMapName && userMapName === proMapName);

    const userCamps = this._collectCamps(u);
    const proCamps = this._collectCamps(p);
    const userTotalXp = (u.heroBuilds || []).reduce((s, h) => s + (h.totalCreepXp || 0), 0);
    const proTotalXp = (p.heroBuilds || []).reduce((s, h) => s + (h.totalCreepXp || 0), 0);

    const warnHtml = sameMap ? '' : `
      <div class="ci-creeps-warn">
        Different maps — drawing your map only.
        Pro played on <strong>${escapeHtml(proMapName || 'unknown map')}</strong>.
      </div>
    `;

    const summaryHtml = `
      <section class="ci-section">
        <h3 class="ci-section-title">Creep route</h3>
        <div class="ci-creeps-summary">
          <span class="ci-creeps-stat ci-creeps-stat-you"><span class="ci-creeps-pip"></span>You — <strong>${userCamps.length}</strong> camps · <strong>${userTotalXp}</strong> XP</span>
          <span class="ci-creeps-stat ci-creeps-stat-pro"><span class="ci-creeps-pip"></span>Pro — <strong>${proCamps.length}</strong> camps · <strong>${proTotalXp}</strong> XP</span>
        </div>
        ${warnHtml}
      </section>
      <section class="ci-section">
        <div class="ci-creeps-canvas-wrap" data-same-map="${sameMap ? '1' : '0'}">
          <canvas class="ci-creeps-canvas" width="600" height="600" aria-label="Creep route map"></canvas>
          <div class="ci-creeps-loading">Loading map…</div>
        </div>
      </section>
      ${this._creepsListHtml(userCamps, proCamps, sameMap)}
    `;
    return summaryHtml;
  }

  _creepsListHtml (userCamps, proCamps, sameMap) {
    const fmt = (c, i) => `
      <li class="ci-camp2-item">
        <span class="ci-camp2-num">${i + 1}</span>
        <span class="ci-camp2-time">${escapeHtml(c.gameTimeFormatted || '')}</span>
        <span class="ci-camp2-lvl">camp lvl ${c.totalLevel || '?'}</span>
        <span class="ci-camp2-xp">+${c.xpGained} XP</span>
      </li>
    `;
    const userList = userCamps.length
      ? `<ol class="ci-camp2-list">${userCamps.map(fmt).join('')}</ol>`
      : `<div class="ci-empty-mini">No camps cleared.</div>`;
    const proList = proCamps.length
      ? `<ol class="ci-camp2-list">${proCamps.map(fmt).join('')}</ol>`
      : `<div class="ci-empty-mini">No camps cleared.</div>`;
    return `
      <section class="ci-section">
        <h3 class="ci-section-title">Camps cleared, in order</h3>
        <div class="ci-vs-grid">
          <div>
            <div class="ci-side-label ci-creeps-side-you">You</div>
            ${userList}
          </div>
          <div>
            <div class="ci-side-label ci-creeps-side-pro">Pro</div>
            ${proList}
          </div>
        </div>
      </section>
    `;
  }

  // Collect ordered, deduped camps for a player. A camp shared by two
  // heroes appears once (deduped by groupId), with the earliest claim time.
  _collectCamps (player) {
    const all = [];
    for (const h of (player.heroBuilds || [])) {
      for (const c of (h.camps || [])) {
        if (c && c.x != null && c.y != null) all.push(c);
      }
    }
    all.sort((a, b) => (a.gameTimeMs || 0) - (b.gameTimeMs || 0));
    const seen = {};
    const out = [];
    for (const c of all) {
      const key = c.groupId || `${c.x},${c.y}`;
      if (seen[key]) continue;
      seen[key] = 1;
      out.push(c);
    }
    return out;
  }

  // Async canvas paint for the Creeps tab.
  //
  // Mirrors what the in-replay viewer does, but on a flat 2D canvas:
  //   1. Background = /maps/{folder}/map.jpg (terrain palette)
  //   2. Trees rendered as small dark dots from doo.json (mirrors
  //      MapRenderer.renderMapTrees)
  //   3. Neutral buildings (gold mines, shops, fountains) rendered as wc3
  //      icons from neutralBuildings.json
  //   4. Every neutral group on the map gets a white outline circle, with
  //      radius = max(width, height)/2 + 4px (RING_PAD) computed from the
  //      screen-space AABB of the bounds rectangle's 4 projected corners
  //   5. Cleared camps overlay a small filled colored circle inside the ring
  //      with the order number, plus a polyline through all of them
  //
  // If mapInfo or the map.jpg can't be loaded, falls back to a self-scaled
  // bounding box derived from the camps themselves so something still renders.
  async _renderCreepsCanvas () {
    const wrap = this.rootEl.querySelector('.ci-creeps-canvas-wrap');
    if (!wrap) return;
    const canvas = wrap.querySelector('.ci-creeps-canvas');
    const loadingEl = wrap.querySelector('.ci-creeps-loading');
    const sameMap = wrap.dataset.sameMap === '1';

    const u = this.userSummary.players[this.userSlot] || {};
    const p = (this._proSummary.players || {})[String(this._proEntry.playerSlot)] || {};
    const userMapInfo = this.userSummary.mapInfo;
    const userCamps = this._collectCamps(u);
    const proCamps = sameMap ? this._collectCamps(p) : [];
    const allRings = this.userSummary.neutralCamps || [];

    // The summary's mapInfo.name IS the resolved client/maps/ folder.
    const mapFolder = userMapInfo && userMapInfo.name ? userMapInfo.name : null;

    // Parallel-load map background and neutral-building overlay data. Trees
    // are not overlaid: the minimap (BLP from .w3x or HiveWE-style synth)
    // already represents terrain the way the game does — adding tree dots
    // on top would double-render.
    let mapImg = null, neutrals = null;
    if (mapFolder) {
      [mapImg, neutrals] = await Promise.all([
        loadMapImage(mapFolder),
        loadNeutralBuildings(mapFolder)
      ]);
    }
    const neutralIcons = await ensureNeutralIcons();
    if (loadingEl) loadingEl.remove();

    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;

    // World→canvas transform. mapInfo.bounds.map is shaped
    // [[xMin, yMax], [xMax, yMin]] (top-left → bottom-right corners). Use
    // the map extent (full bg image), not the camera/playable extent — the
    // bg jpg covers the full extent.
    let w2c;
    if (userMapInfo && userMapInfo.bounds && userMapInfo.bounds.map) {
      const [[mxMin, myMax], [mxMax, myMin]] = userMapInfo.bounds.map;
      const worldW = mxMax - mxMin;
      const worldH = myMax - myMin;
      w2c = (wx, wy) => ({
        x: ((wx - mxMin) / worldW) * W,
        // WC3 +Y = north (up). Canvas +Y = down. Flip.
        y: ((myMax - wy) / worldH) * H
      });
    } else {
      // Fallback: bounding box of available points.
      const pts = [];
      if (u.startingPosition) pts.push(u.startingPosition);
      if (sameMap && p.startingPosition) pts.push(p.startingPosition);
      for (const c of userCamps) pts.push({ x: c.x, y: c.y });
      for (const c of proCamps)  pts.push({ x: c.x, y: c.y });
      for (const r of allRings)  if (r.bounds) pts.push({ x: (r.bounds.minX + r.bounds.maxX)/2, y: (r.bounds.minY + r.bounds.maxY)/2 });
      if (!pts.length) {
        canvas.style.display = 'none';
        wrap.insertAdjacentHTML('beforeend', '<div class="ci-empty-mini">No camp data to plot.</div>');
        return;
      }
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      const pad = 800;
      const xmin = Math.min(...xs) - pad, xmax = Math.max(...xs) + pad;
      const ymin = Math.min(...ys) - pad, ymax = Math.max(...ys) + pad;
      w2c = (wx, wy) => ({
        x: ((wx - xmin) / (xmax - xmin)) * W,
        y: ((ymax - wy) / (ymax - ymin)) * H
      });
    }

    // Background. Map.jpg covers the full mapExtent bounds, so a flat
    // drawImage to the canvas at 0,0 → W,H aligns with the world transform.
    if (mapImg) {
      ctx.drawImage(mapImg, 0, 0, W, H);
    } else {
      ctx.fillStyle = '#0a0d10';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#1d2228';
      for (let i = 1; i < 8; i++) {
        const v = (i / 8) * W;
        ctx.beginPath(); ctx.moveTo(v, 0); ctx.lineTo(v, H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, v); ctx.lineTo(W, v); ctx.stroke();
      }
    }

    // Neutral buildings (gold mines, shops, fountains). Lifted
    // from MapRenderer.renderNeutralBuildings — same icon sprites, same
    // size scheme (gold mines bigger).
    if (neutrals && neutrals.length) {
      const iconSize = (type) => type === 'ngol' ? 18 : 14;
      ctx.globalAlpha = 0.95;
      for (const nb of neutrals) {
        if (!nb || nb.x == null || nb.y == null) continue;
        const cp = w2c(nb.x, nb.y);
        const sz = iconSize(nb.type);
        const half = sz / 2;
        const icon = neutralIcons[nb.type];
        if (icon && icon.complete && icon.naturalWidth) {
          ctx.drawImage(icon, cp.x - half, cp.y - half, sz, sz);
        } else {
          // Fallback: colored square if icon failed to load.
          ctx.fillStyle = nb.type === 'ngol' ? '#d4a017' : '#9966cc';
          ctx.fillRect(cp.x - half, cp.y - half, sz, sz);
        }
      }
      ctx.globalAlpha = 1;
    }

    // Subtle vignette so route overlays read better. Applied AFTER the
    // terrain layers (background + trees + neutrals) so the route reads on
    // top, but BEFORE the camp rings/dots.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fillRect(0, 0, W, H);

    // Project a world-space bounds rectangle to screen-space center+radius.
    // Lifted from MapRenderer.renderNeutralGroups (lines 178–201).
    const RING_PAD = 4;
    const projectCamp = (b) => {
      const c1 = w2c(b.minX, b.minY), c2 = w2c(b.maxX, b.minY);
      const c3 = w2c(b.minX, b.maxY), c4 = w2c(b.maxX, b.maxY);
      const minPX = Math.min(c1.x, c2.x, c3.x, c4.x);
      const maxPX = Math.max(c1.x, c2.x, c3.x, c4.x);
      const minPY = Math.min(c1.y, c2.y, c3.y, c4.y);
      const maxPY = Math.max(c1.y, c2.y, c3.y, c4.y);
      return {
        cx: (minPX + maxPX) / 2,
        cy: (minPY + maxPY) / 2,
        radius: Math.max(maxPX - minPX, maxPY - minPY) / 2 + RING_PAD
      };
    };

    // Layer 1 — every camp on the map: white outline circle (untouched-camp
    // style from the viewer).
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.5;
    for (const ring of allRings) {
      if (!ring.bounds) continue;
      const { cx, cy, radius } = projectCamp(ring.bounds);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
      ctx.stroke();
    }

    // Helpers reused across both routes.
    const drawRoute = (camps, startPos, color) => {
      if (!camps.length && !startPos) return;

      // Connecting polyline through camp centers.
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
      ctx.shadowBlur = 3;
      ctx.beginPath();
      let first = true;
      if (startPos) {
        const sp = w2c(startPos.x, startPos.y);
        ctx.moveTo(sp.x, sp.y); first = false;
      }
      for (const c of camps) {
        const cp = w2c(c.x, c.y);
        if (first) { ctx.moveTo(cp.x, cp.y); first = false; }
        else       { ctx.lineTo(cp.x, cp.y); }
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Start marker — small square with white border.
      if (startPos) {
        const sp = w2c(startPos.x, startPos.y);
        ctx.fillStyle = color;
        ctx.fillRect(sp.x - 6, sp.y - 6, 12, 12);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(sp.x - 6, sp.y - 6, 12, 12);
      }

      // Order dots — small filled circle inside the camp ring with the
      // ordinal number on top.
      camps.forEach((c, i) => {
        const cp = w2c(c.x, c.y);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, 9, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = '#0a0d10';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#0a0d10';
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), cp.x, cp.y);
      });
    };

    // Pro first (under), user on top so user's route reads as primary.
    if (sameMap) drawRoute(proCamps, p.startingPosition, '#d4a23a');
    drawRoute(userCamps, u.startingPosition, '#5fa5cb');

    // Legend (top-left).
    const legend = [
      ['#5fa5cb', 'You'],
      sameMap ? ['#d4a23a', 'Pro'] : null
    ].filter(Boolean);
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let ly = 16;
    for (const [color, label] of legend) {
      ctx.fillStyle = color;
      ctx.fillRect(10, ly - 6, 14, 12);
      ctx.strokeStyle = '#0a0d10';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(10, ly - 6, 14, 12);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, 30, ly);
      ly += 20;
    }
  }

  // ── Wiring ──────────────────────────────────────────────────────────────
  _wireGlobal () {
    // Tab nav lives in rootEl (header).
    this.rootEl.querySelectorAll('.ci-tab').forEach(btn => {
      btn.addEventListener('click', () => this._setTab(btn.dataset.tab));
    });
    // Switcher chips and advanced button now live in the sticky footer
    // (sibling of rootEl), so query against the parent drawer.
    const drawer = this.rootEl.parentElement;
    if (drawer) {
      drawer.querySelectorAll('.ci-chip').forEach(chip => {
        chip.addEventListener('click', async () => {
          const id = chip.dataset.replayId;
          const slot = chip.dataset.slot;
          const candidate = this.candidates.find(c => c.entry.replayId === id && String(c.entry.playerSlot) === String(slot));
          if (candidate) {
            this.matchConfidence = 'manual';
            await this._compareWith(candidate.entry);
          }
        });
      });
      const advBtn = drawer.querySelector('.ci-advanced-btn');
      if (advBtn) advBtn.addEventListener('click', () => this._openAdvanced());
    }
    // Slot chips (compact picker, lives in rootEl).
    this.rootEl.querySelectorAll('.ci-slot-chip[data-slot]').forEach(chip => {
      if (chip.classList.contains('ci-slot-chip-active')) return;
      chip.addEventListener('click', () => this._switchPlayer(chip.dataset.slot));
    });
    // "Change pro" → re-render the chooser so users can pick a different
    // anchor without leaving the drawer.
    const changeBtn = this.rootEl.querySelector('[data-action="open-chooser"]');
    if (changeBtn) changeBtn.addEventListener('click', () => this._renderChooser());
  }

  _wireTab (tabId) {
    if (tabId === 'overview') {
      // Drill buttons jump to the relevant detail tab.
      this.rootEl.querySelectorAll('.ci-tile-drill').forEach(btn => {
        btn.addEventListener('click', () => this._setTab(btn.dataset.targetTab));
      });
    }
    if (tabId === 'creeps') {
      // Canvas paint is async (loads image + walkmap.json). Fire-and-forget.
      this._renderCreepsCanvas().catch(e => console.error('[Creeps] render failed:', e));
    }
    if (tabId === 'heroes') {
      this.rootEl.querySelectorAll('.ci-hero-chip[data-hero-idx]').forEach(chip => {
        chip.addEventListener('click', () => {
          const idx = parseInt(chip.dataset.heroIdx, 10);
          if (Number.isFinite(idx)) this._setHeroSubTab(idx);
        });
      });
    }
  }

  // Pick the top-N actionable findings across all categories.
  // Severity: 'warn' > 'info' > 'good'. Weight by category weight.
  // Returns full finding objects (with headline/text/metric/vizType/vizData)
  // tagged with their categoryKey.
  _topFixes (report, n) {
    const SEV_RANK = { warn: 3, info: 2, good: 0 };
    const W = {
      macro: 0.20, tech: 0.18, buildAdherence: 0.15, production: 0.10,
      expansion: 0.07, heroSkillBuild: 0.10, upgrades: 0.10, itemEconomy: 0.05, idleResources: 0.05
    };
    const collected = [];
    for (const k of Object.keys(report.categories || {})) {
      const cat = report.categories[k];
      if (!cat || !cat.available || !cat.findings) continue;
      for (const f of cat.findings) {
        const score = (SEV_RANK[f.severity] || 1) * (W[k] || 0.05) * 100;
        collected.push({ categoryKey: k, finding: f, _score: score });
      }
    }
    collected.sort((a, b) => b._score - a._score);
    return collected.slice(0, n);
  }

  // Render the Top Fixes panel as coaching cards. Each card has a numbered
  // badge, category label, action-verb headline, supporting detail, optional
  // metric pill on the right, and an optional inline sparkline (when the
  // finding carries vizType + vizData).
  _topFixesHtml (fixes) {
    if (!fixes || !fixes.length) return '';
    const cardHtml = (entry, i) => {
      const f = entry.finding || {};
      const sev = f.severity || 'info';
      const headline = f.headline || f.text || '';
      const detail = f.headline ? (f.text || '') : '';
      const cat = entry.categoryKey;
      const catLabel = CATEGORY_LABELS[cat] || cat;
      const metricHtml = f.metric && f.metric.label
        ? `<span class="ci-fix2-metric">${escapeHtml(f.metric.label)}</span>`
        : '';
      let sparkHtml = '';
      if (f.vizType && f.vizData && window.CompareCharts && window.CompareCharts.sparkline) {
        const seriesKey = f.vizType === 'workers'
          ? { user: 'userWorkers', pro: 'proWorkers' }
          : { user: 'userSupply',  pro: 'proSupply' };
        const series = (f.vizData || []).map(s => ({
          gameTimeMs: s.gameTimeMs,
          userValue: s[seriesKey.user] || 0,
          proValue:  s[seriesKey.pro]  || 0
        }));
        sparkHtml = `<div class="ci-fix2-spark">${window.CompareCharts.sparkline(series)}</div>`;
      }
      return `
        <article class="ci-fix2-card ci-fix2-${sev}" data-cat="${escapeAttr(cat)}">
          <div class="ci-fix2-badge">${i + 1}</div>
          <div class="ci-fix2-body">
            <div class="ci-fix2-cat">${escapeHtml(catLabel)}</div>
            <div class="ci-fix2-headline">${escapeHtml(headline)}</div>
            ${detail ? `<div class="ci-fix2-detail">${escapeHtml(detail)}</div>` : ''}
          </div>
          <div class="ci-fix2-aside">
            ${metricHtml}
            ${sparkHtml}
          </div>
        </article>
      `;
    };
    return `
      <section class="ci-section ci-section-fixes">
        <h3 class="ci-section-title">Top things to fix</h3>
        <div class="ci-fix2-list">
          ${fixes.map(cardHtml).join('')}
        </div>
      </section>
    `;
  }

  // Switch the user's identity (which player from their replay is being
  // analyzed). Persists `userSlot` + `race` on the IDB record and re-runs
  // bootstrap() so candidates + auto-pick + report all reflect the new
  // identity.
  //   - targetSlot (string): a specific slot from the replay; used by the
  //     direct slot-card click path.
  //   - omitted: opens PlayerPicker as a modal (kept for completeness).
  async _switchPlayer (targetSlot) {
    let chosen = targetSlot != null ? String(targetSlot) : null;
    let cards = [];
    try {
      cards = (window.PlayerPicker && typeof window.PlayerPicker.buildCards === 'function')
        ? window.PlayerPicker.buildCards(this.userRecord && this.userRecord.parsedJson)
        : [];
    } catch (e) { cards = []; }

    // Validate the direct target; if it's not a known slot, fall through
    // to the modal flow.
    if (chosen && !cards.find(c => String(c.slot) === chosen)) chosen = null;

    if (!chosen) {
      if (typeof window.PlayerPicker !== 'function') return;
      chosen = await window.PlayerPicker.open({
        parsed: this.userRecord.parsedJson,
        headline: 'Switch player',
        subhead: 'Pick which player in this replay should be compared against the pro.',
        currentSlot: this.userSlot,
        allowCancel: true
      });
    }
    if (!chosen || String(chosen) === String(this.userSlot)) return;
    // Persist on IDB so the card + future opens remember the choice.
    try {
      if (!cards.length && window.PlayerPicker && window.PlayerPicker.buildCards) {
        cards = window.PlayerPicker.buildCards(this.userRecord.parsedJson);
      }
      const meta = cards.find(c => String(c.slot) === String(chosen));
      const updated = { ...this.userRecord, userSlot: String(chosen), race: (meta && meta.race) || this.userRecord.race };
      if (this.myReplays && typeof this.myReplays.put === 'function') {
        await this.myReplays.put(updated);
      }
      this.userRecord = updated;
    } catch (e) { console.warn('[CompareInline] failed to persist userSlot:', e); }
    // Reset state and bootstrap again so the matcher re-ranks against the
    // newly chosen player's race/matchup/archetype.
    this.userSummary = null;
    this.userSlot = null;
    this.candidates = [];
    this.currentProEntry = null;
    this.currentReport = null;
    this.selfMatchEntry = null;
    this.isSelfMatch = false;
    await this.bootstrap();
  }

  async _openAdvanced () {
    if (typeof window.AdvancedComparePicker !== 'function') {
      alert('Advanced search not loaded.');
      return;
    }
    const picker = new window.AdvancedComparePicker({
      matcher: this.matcher,
      userSummary: this.userSummary,
      userSlot: this.userSlot,
      onPick: async (entry) => {
        // Inject the chosen entry into candidates if not already there so
        // the chip strip shows it.
        if (!this.candidates.find(c => c.entry.replayId === entry.replayId && String(c.entry.playerSlot) === String(entry.playerSlot))) {
          this.candidates.unshift({ entry, score: 100 });
        }
        this.matchConfidence = 'manual';
        await this._compareWith(entry);
      }
    });
    picker.open();
  }
};

// Build a perfect-match report when the user has re-uploaded a replay that
// already lives in our pro library. Skips the analyzer entirely. Mirrors
// the shape ReplayAnalyzer.compare() returns so the renderer is unchanged.
const synthSelfMatchReport = (userSummary, userSlot, proSummary, proSlot) => {
  const u = userSummary.players[String(userSlot)] || {};
  const p = proSummary.players[String(proSlot)] || {};
  const cleanedMap = (window.ReplayAnalyzer && window.ReplayAnalyzer.prettyMap)
    ? window.ReplayAnalyzer.prettyMap(userSummary.map) : userSummary.map;
  const matchTile = (label) => ({
    score: 100, grade: 'A+', findings: [], available: true, _selfMatch: true, detail: null
  });
  return {
    overall: { score: 100, grade: 'A+' },
    categories: {
      macro:          matchTile('Macro'),
      tech:           matchTile('Tech'),
      expansion:      matchTile('Expansion'),
      buildAdherence: matchTile('Build Adherence'),
      production:     matchTile('Production'),
      heroSkillBuild: matchTile('Hero Skill Build'),
      upgrades:       matchTile('Upgrades'),
      itemEconomy:    matchTile('Item Economy'),
      idleResources:  matchTile('Idle Resources')
    },
    guards: {
      durationOk: true, matchupCompatible: true, mapCompatible: true,
      archetypeCompatible: true, proWon: false, proResult: 'unknown'
    },
    compatibility: [
      { key: 'race', label: 'Same race', status: 'match', detail: `Both ${u.race || p.race || ''}` },
      { key: 'matchup', label: 'Same matchup', status: 'match', detail: `${u.race || ''}v${p.race || ''}` },
      { key: 'archetype', label: 'Same build archetype', status: 'match', detail: u.archetype || p.archetype || 'Same' },
      { key: 'map', label: 'Same map', status: 'match', detail: cleanedMap },
      { key: 'duration', label: 'Comparable game length', status: 'match', detail: 'Identical replay (re-uploaded)' }
    ],
    warnings: [],
    selfMatch: true,
    meta: {
      userPlayer: { slot: userSlot, name: u.name, race: u.race, archetype: u.archetype },
      proPlayer: { slot: proSlot, name: p.name, race: p.race, archetype: p.archetype },
      userMap: userSummary.map,
      proMap: proSummary.map,
      userDuration: userSummary.durationMs,
      proDuration: proSummary.durationMs
    }
  };
};

// ===== File-local helpers =====

const CHECK_ICON = {
  match:    '✓',
  partial:  '⚠',
  mismatch: '✗',
  unknown:  '?'
};

const RACE_LONG = { H: 'Human', O: 'Orc', E: 'Night Elf', U: 'Undead', R: 'Random' };
// Race building icons used everywhere in the codebase as the visual proxy
// for race. Sourced from /assets/wc3icons/{id}.jpg — already shipped, same
// files RACE_META in index.html points at.
const RACE_ICON = { H: 'htow', O: 'ogre', E: 'etol', U: 'unpl' };
const raceIconUrl = (race) => RACE_ICON[race] ? `/assets/wc3icons/${RACE_ICON[race]}.jpg` : '';

// Map normalization — single source of truth.
//
// The builds-manifest stores a wild mix of map name variants ("Autumn
// Leaves v2.0", "AutumnLeaves_v2.0", "1v1_EchoIsles_v2.2_w3c_..."), and
// the on-disk folder names mix dot/dash version conventions
// ("Arathor_v1.3" vs "AutumnLeaves_v2-0"). The /data/map-folders.json
// manifest (loaded by ensureMapFoldersManifest) IS the canonical mapping
// from folder name → metadata. We use it to:
//   - Resolve any raw map string to its actual folder (so the icon URL
//     points at a real file).
//   - Produce a single normalized display name (cleanMapName(folder)).
// Cached after first build because the manifest doesn't change at runtime.
let _mapResolveCache = null;
const buildMapResolveCache = () => {
  const manifest = (typeof window !== 'undefined' && window.__mapFoldersManifest) || null;
  if (!manifest) return null;
  // Indexed by normalized clean name → manifest entry.
  const byClean = new Map();
  for (const key of Object.keys(manifest)) {
    const entry = manifest[key];
    if (!entry || !entry.name) continue;
    const clean = cleanMapName(entry.name).toLowerCase();
    if (clean && !byClean.has(clean)) byClean.set(clean, entry);
  }
  return byClean;
};
const resolveMap = (rawName) => {
  if (!rawName) return { displayName: 'Unknown map', folderName: null, iconUrl: null };
  if (!_mapResolveCache) _mapResolveCache = buildMapResolveCache();
  const targetClean = cleanMapName(rawName).toLowerCase();
  let entry = null;
  if (_mapResolveCache && targetClean) {
    entry = _mapResolveCache.get(targetClean) || null;
    if (!entry) {
      // Fuzzy: substring in either direction (e.g. target="echoisles"
      // matches entry-clean="echoisles" with version stripped).
      for (const [k, v] of _mapResolveCache) {
        if (k && (targetClean.includes(k) || k.includes(targetClean))) {
          entry = v; break;
        }
      }
    }
  }
  const folderName = entry ? entry.name : null;
  const displayName = entry
    ? cleanMapName(entry.name)
    : cleanMapName(rawName) || 'Unknown map';
  const iconUrl = folderName
    ? `/maps/${encodeURIComponent(folderName)}/gridmap.jpg`
    : null;
  return { displayName, folderName, iconUrl };
};

// Tab dispatch: which detail tab does each Overview tile drill into?
const TILE_TO_TAB = {
  macro:          'economy',
  tech:           'tech',
  expansion:      'tech',
  buildAdherence: 'build',
  production:     'economy',
  heroSkillBuild: 'heroes',
  upgrades:       'upgrades',
  itemEconomy:    'heroes',
  idleResources:  'economy'
};

const CATEGORY_ORDER = [
  'macro', 'tech', 'expansion', 'buildAdherence', 'production',
  'heroSkillBuild', 'upgrades', 'itemEconomy', 'idleResources'
];

const CATEGORY_LABELS = {
  macro:          'Macro',
  tech:           'Tech',
  expansion:      'Expansion',
  buildAdherence: 'Build Adherence',
  production:     'Production',
  heroSkillBuild: 'Hero Skill Build',
  upgrades:       'Upgrades',
  itemEconomy:    'Item Economy',
  idleResources:  'Idle Resources'
};

const TILE_INFO = {
  macro:          'Worker count and supply usage every 30s vs pro. Improve: queue workers continuously and don\'t get supply-blocked.',
  tech:           'Tier-2 / Tier-3 / Hero-level timings vs pro (60–90s tolerance). Improve: don\'t sit on resources at tier-up time.',
  expansion:      'When you took your second town hall vs pro. Only scored when both played the same map.',
  buildAdherence: 'How closely your first 20 buildings/units match the pro\'s order (longest common subsequence).',
  production:     'Combat units produced over the 5–15 minute window vs pro. Pros keep production halls firing constantly.',
  heroSkillBuild: 'Hero ability learn order vs pro (same hero only). Pros pick a specific skill order per matchup.',
  upgrades:       'Attack / defense / ability research timings vs pro (90s tolerance). Pros are religious about upgrade timing.',
  itemEconomy:    'Hero items the pro bought that you didn\'t (boots, salves, talismans, scrolls). Item discipline is a hidden skill gap.',
  idleResources:  'Average unused supply headroom over the game. High = you built farms/houses but didn\'t train units = floating resources.'
};

const REASON_PRETTY = {
  'different matchups':              'Different matchup, the pro played a different race composition, so timings can\'t be compared apples-to-apples.',
  'different maps':                  'Different maps, expansion timing depends on the map, so we skip this when maps differ.',
  'pro did not expand':              'The pro never expanded in this replay, so there\'s nothing to compare against.',
  'no economy data':                 'Economy data missing from one or both replays.',
  'overlapping time too short':      'The replays barely overlap in length, can\'t sample the economy fairly.',
  'no overlapping samples':          'No overlapping economy samples to compare.',
  'no tech timings to compare':      'The pro never reached the tier or hero level we measure.',
  'no build preview':                'Build order data missing from one or both replays.',
  'pro produced no units in window': 'Pro built no combat units in the first 10 minutes, nothing to score against.',
  'archetype-degraded':              'Different archetypes, used a relaxed set-overlap score (penalised).',
  'hero data missing':               'Hero skill-order data missing from one or both replays.',
  'pro hero never leveled':          'The pro never leveled their hero in this replay.',
  'pro researched nothing':          'Pro got no upgrades in this replay — no benchmark to compare against.',
  'different races':                 'Different races, so the item shop catalog differs and a comparison would be misleading.',
  'neither side bought items':       'Neither side purchased items — nothing to compare.',
  'Game ended too early to compare meaningfully': 'Your replay ended too early to compare meaningfully against the pro\'s game length.'
};

// Aliases into client/js/Security.js — shared escape helpers.
const escapeHtml = Security.escapeHtml;
const escapeAttr = Security.escapeAttr;
// Untrusted replay free-text (player names, opponent labels, map names):
// sanitize (strip control/bidi/zero-width chars + length-cap) THEN escape, so a
// crafted name can't spoof UI via RTL-override / zero-width tricks. Hero/skill/
// item names come from first-party game data and only need plain escaping.
const ut = (s) => Security.escapeHtml(Security.sanitizeUserText(s, { maxLen: 48 }));

const iconUrl = (itemId) => itemId ? `/assets/wc3icons/${encodeURIComponent(itemId)}.jpg` : '';

const prettyArchetype = (a) => {
  const map = {
    'fast-expand': 'Fast Expand',
    '1-base-t2':   '1-base T2',
    'tower-rush':  'Tower Rush',
    'tech':        'Fast Tech',
    'unknown':     'Unclassified'
  };
  return map[a] || a || 'Unknown';
};

const matchupString = (summary, userSlot) => {
  if (!summary || !summary.players) return null;
  const user = summary.players[String(userSlot)];
  if (!user) return null;
  const opponents = Object.keys(summary.players)
    .filter(k => k !== String(userSlot))
    .map(k => summary.players[k])
    .filter(p => !p.isNeutralPlayer && p.race && p.race !== 'R');
  if (!opponents.length) return null;
  return `${user.race}v${opponents[0].race}`;
};

// Find the user's slot in the parsed replay. Order of preference:
//   1. record.userSlot — explicitly chosen by the user via PlayerPicker.
//   2. The first non-neutral slot < 24 in the record's players[] (legacy
//      auto-pick for old records that pre-date the picker).
//   3. The first non-neutral slot < 24 in the summary.players map.
const pickUserSlot = (summary, record) => {
  if (record && record.userSlot && summary.players && summary.players[String(record.userSlot)]) {
    return String(record.userSlot);
  }
  if (record && record.players && record.players.length) {
    const candidates = record.players.filter(p => p.slot < 24);
    if (candidates.length) return String(candidates[0].slot);
  }
  for (const k of Object.keys(summary.players || {})) {
    const p = summary.players[k];
    if (!p.isNeutralPlayer && parseInt(k) < 24) return k;
  }
  return null;
};

// Build a summary-shaped object from the parsed .wc3v JSON stored in
// IndexedDB. Per-player extraction is delegated to the shared module
// helpers/summaryExtract.js so the user summary matches the pro summary
// shape field-for-field — anything we add server-side surfaces here too.
const buildUserSummary = (record) => {
  const full = record.parsedJson;
  if (!full) return null;
  if (!window.SummaryExtract || typeof window.SummaryExtract.extractPlayerSummary !== 'function') {
    console.error('[CompareInline] SummaryExtract not loaded — cannot build user summary');
    return null;
  }
  const rawMap = (full.replay && full.replay.metadata && full.replay.metadata.map && full.replay.metadata.map.mapName) || '';
  const cleanMap = cleanMapName(rawMap);
  const durationMs = (full.replay && full.replay.subheader && full.replay.subheader.replayLengthMS) || 0;
  const worldNeutralGroups = (full.world && full.world.neutralGroups) || null;
  // mapInfo resolution uses the cached browser manifest. If the manifest
  // hasn't been loaded yet (first compare modal open), mapInfo stays null
  // and the Creeps tab falls back to its bounding-box renderer.
  const SE = window.SummaryExtract;
  const mapDataByFile = window.__mapFoldersManifest || null;
  const mapInfo = (SE && mapDataByFile)
    ? SE.slimMapInfo(SE.resolveMapFolder(rawMap, mapDataByFile))
    : null;
  const neutralCamps = SE ? SE.extractNeutralCamps(worldNeutralGroups) : [];
  const summary = {
    replayId: record.id,
    map: cleanMap,
    mapRaw: rawMap,
    mapInfo,
    durationMs,
    neutralCamps,
    fingerprint: null,
    players: {}
  };
  // Capture player names for the fingerprint (1v1 / 2v2 / FFA all sort the
  // full roster, so order doesn't matter).
  const fpNames = [];
  for (const slot of Object.keys(full.players || {})) {
    const p = full.players[slot];
    if (!p || p.isNeutralPlayer) continue;
    const replayP = (full.replay && full.replay.players && full.replay.players[slot]) || {};
    summary.players[slot] = window.SummaryExtract.extractPlayerSummary(p, replayP, durationMs, worldNeutralGroups);
    const nm = String(replayP.name || '').toLowerCase().trim();
    if (nm) fpNames.push(nm);
  }
  fpNames.sort();
  summary.fingerprint = `${cleanMap}|${Math.round(durationMs / 1000)}|${fpNames.join(',')}`;
  return summary;
};

// Lazy-load the map-folders manifest once per page. Stored on window so
// every CompareInline instance shares the same fetch.
const ensureMapFoldersManifest = async () => {
  if (window.__mapFoldersManifest) return window.__mapFoldersManifest;
  if (window.__mapFoldersManifestPromise) return window.__mapFoldersManifestPromise;
  window.__mapFoldersManifestPromise = (async () => {
    try {
      const r = await fetch('/data/map-folders.json');
      if (!r.ok) return null;
      const json = await r.json();
      window.__mapFoldersManifest = json;
      return json;
    } catch (e) {
      return null;
    }
  })();
  return window.__mapFoldersManifestPromise;
};

// Resolve a raw replay map name to the canonical client/maps/{folder}/ name.
// Mirrors MyReplays.canonicalMapDir — duplicated here to keep CompareInline
// self-contained. Strips W3C numbered prefix and slot prefix; keeps the
// version suffix because it's part of the actual folder name (e.g.
// "TurtleRock_v2.0").
const canonicalMapDir = (rawMapName) => {
  if (!rawMapName) return null;
  let n = String(rawMapName).split(/[\\/]/).pop().replace(/\.(w3x|w3m)$/i, '');
  n = n.replace(/^\d+_w3c_\d+_\d+_/i, '');
  n = n.replace(/^\(\d+\)\s*/, '');
  return n;
};

// ── Map-asset loaders for the Creeps tab ────────────────────────────────────
// Some maps ship only the gzipped variants (`doo.json.gz`,
// `neutralBuildings.json.gz`); others have both. Try uncompressed first
// (cheaper), fall back to gzipped via DecompressionStream.

const fetchMapJson = async (folder, file) => {
  const base = `/maps/${encodeURIComponent(folder)}/${file}`;
  try {
    const r = await fetch(base);
    if (r.ok) return await r.json();
  } catch (e) { /* fall through */ }
  try {
    const r = await fetch(base + '.gz');
    if (!r.ok) return null;
    if (typeof DecompressionStream !== 'function') return null;
    const stream = r.body.pipeThrough(new DecompressionStream('gzip'));
    const text = await new Response(stream).text();
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
};

const loadMapImage = (folder) => new Promise(resolve => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = `/maps/${encodeURIComponent(folder)}/map.jpg`;
});

const loadNeutralBuildings = async (folder) => {
  const data = await fetchMapJson(folder, 'neutralBuildings.json');
  if (!data) return null;
  return Array.isArray(data) ? data : (data.grid || data.neutrals || null);
};

// Preload neutral-building icon sprites once per page; reused across all
// CompareInline instances and Creeps-tab paints.
let _neutralIconsPromise = null;
const ensureNeutralIcons = () => {
  if (_neutralIconsPromise) return _neutralIconsPromise;
  const types = ['ngol', 'nfoh', 'nmoo', 'nmer', 'ntav', 'ngme', 'ngad', 'nmrk'];
  _neutralIconsPromise = Promise.all(types.map(type => new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve([type, img]);
    img.onerror = () => resolve([type, null]);
    img.src = `/assets/wc3icons/${type}.jpg`;
  }))).then(pairs => {
    const map = {};
    for (const [type, img] of pairs) if (img) map[type] = img;
    return map;
  });
  return _neutralIconsPromise;
};

// Stable key identifying a candidate "pro" the user can pick to compare
// against. Two flavors: curated manifest entries vs IDB-backed user
// references. Encoded as a string so it can live in lastCompare.proKey
// without needing a discriminator field. Read back via findEntryByProKey.
const buildProKey = (entry) => {
  if (!entry) return 'none';
  const slot = String(entry.playerSlot || '1');
  if (entry.replayId && entry.replayId.startsWith('local::')) {
    // entry.replayId already encodes the IDB id ('local::<idbId>'); append slot.
    return `${entry.replayId}::${slot}`;
  }
  return `manifest::${entry.replayId}::${slot}`;
};

// Resolve a stored proKey back to an entry in the candidate list. Returns
// null when the key is malformed, the candidate is no longer indexed, or
// the key is the sentinel 'none' (= explicit "watch without grading").
const findEntryByProKey = (key, candidates) => {
  if (!key || key === 'none') return null;
  const list = (candidates || []).map(c => c.entry);
  if (key.startsWith('manifest::')) {
    // 'manifest::<replayId>::<slot>' — slot is the trailing segment;
    // replayId may itself contain '::' (unlikely, but be safe).
    const lastColon = key.lastIndexOf('::');
    const replayId = key.slice('manifest::'.length, lastColon);
    const slot = key.slice(lastColon + 2);
    return list.find(e => e.replayId === replayId && String(e.playerSlot) === String(slot)) || null;
  }
  if (key.startsWith('local::')) {
    const lastColon = key.lastIndexOf('::');
    const replayId = key.slice(0, lastColon);
    const slot = key.slice(lastColon + 2);
    return list.find(e => e.replayId === replayId && String(e.playerSlot) === String(slot)) || null;
  }
  return null;
};

// Per-dimension compatibility checklist for the chooser's recommended card.
// Mirrors the shape of report.compatibility but doesn't require the analyzer
// to have run — built directly from the entry + user summary so we can
// render BEFORE the heavy compare() call. Status values: match / partial
// / mismatch / unknown (to match CHECK_ICON keys).
const chooserChecksHtml = (entry, userPlayer, userMu, userSummary, annotated) => {
  const checks = [];
  // Race
  checks.push({
    status: (entry.buildRace && entry.buildRace === userPlayer.race) ? 'match' : 'mismatch',
    label: 'Same race',
    detail: `${userPlayer.race || '?'} vs ${entry.buildRace || '?'}`
  });
  // Matchup
  const muMatch = userMu && (entry.buildMatchups || []).includes(userMu);
  checks.push({
    status: muMatch ? 'match' : 'mismatch',
    label: 'Same matchup',
    detail: muMatch ? userMu : (userMu ? `${userMu} vs ${(entry.buildMatchups || []).join('/') || 'unknown'}` : 'unknown matchup')
  });
  // Archetype (build)
  const expectedArch = entry.isUserReference ? entry.referenceArchetype : (
    entry.buildOpener === 'expand' ? 'fast-expand' :
    entry.buildOpener === 'fast-tech' ? 'tech' :
    entry.buildOpener === 'rush' ? '1-base-t2' :
    entry.buildOpener === 'standard' ? '1-base-t2' : null
  );
  const archMatch = userPlayer.archetype && userPlayer.archetype !== 'unknown' && expectedArch === userPlayer.archetype;
  checks.push({
    status: archMatch ? 'match' : (userPlayer.archetype === 'unknown' ? 'unknown' : 'partial'),
    label: 'Same build',
    detail: archMatch
      ? prettyArchetype(userPlayer.archetype)
      : (userPlayer.archetype === 'unknown'
          ? 'Couldn\'t classify your build'
          : `you: ${prettyArchetype(userPlayer.archetype)} · pro: ${expectedArch ? prettyArchetype(expectedArch) : 'unknown'}`)
  });
  // Map
  const userMap = (userSummary && userSummary.map) || '';
  const proMap = entry.map || '';
  const mapCanon = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const mapMatch = userMap && proMap && (mapCanon(userMap).includes(mapCanon(proMap)) || mapCanon(proMap).includes(mapCanon(userMap)));
  checks.push({
    status: mapMatch ? 'match' : 'partial',
    label: 'Same map',
    detail: mapMatch ? userMap : `you: ${userMap || '?'} · pro: ${proMap || '?'}`
  });
  // Duration / grade gate
  checks.push({
    status: annotated.grades ? 'match' : 'mismatch',
    label: 'Comparable game length',
    detail: annotated.grades
      ? 'Game lengths overlap — categories will grade'
      : 'Game lengths too different — categories won\'t grade'
  });
  return checks.map(c => `
    <div class="ci-chooser-check ci-chooser-check-${escapeAttr(c.status)}">
      <span class="ci-chooser-check-icon">${CHECK_ICON[c.status] || '·'}</span>
      <span class="ci-chooser-check-label">${escapeHtml(c.label)}</span>
      <span class="ci-chooser-check-detail">${escapeHtml(c.detail || '')}</span>
    </div>
  `).join('');
};

// In-chooser column sort. Sort orders:
//   'match' — score desc (default; matches the rank-candidates output)
//   'map'   — map name asc, then pro name asc
//   'pro'   — pro name asc, then map name asc
// Stable: ties fall through to the next dimension and finally to score
// to keep ordering deterministic across renders.
const sortChooserItems = (items, mode) => {
  const arr = items.slice();
  // Sort by NORMALIZED map name so "AutumnLeaves_v2.0" and
  // "Autumn Leaves v2.0" sort together.
  const mapKey = (c) => resolveMap(c.entry.map).displayName || '';
  const byMap = (a, b) => mapKey(a).localeCompare(mapKey(b), undefined, { sensitivity: 'base' });
  const byPro = (a, b) => String(a.entry.playerName || '').localeCompare(String(b.entry.playerName || ''), undefined, { sensitivity: 'base' });
  const byScore = (a, b) => (b.score || 0) - (a.score || 0);
  if (mode === 'map') {
    arr.sort((a, b) => byMap(a, b) || byPro(a, b) || byScore(a, b));
  } else if (mode === 'pro') {
    arr.sort((a, b) => byPro(a, b) || byMap(a, b) || byScore(a, b));
  }
  // 'match' mode is already the source order from rankCandidates.
  return arr;
};

// Lightweight controller for the page's #parse-overlay (defined in
// index.html / replays.html). Mirrors the inline showOverlay/updateOverlay
// /hideOverlay logic those pages use for the homepage upload flow, so the
// in-chooser reference upload gets the same parse progress UI without
// having to plumb the homepage's closures into here.
//
// The overlay's z-index (9999) already sits above the compare drawer
// (9001), so it correctly covers the chooser while parsing.
const PARSE_PHASE_LABEL = {
  reading: 'reading file', peek: 'reading replay header',
  fetch: 'loading map data', metadata: 'reading replay metadata',
  parsing: 'parsing replay events', postprocess: 'analyzing data',
  assemble: 'building output', storing: 'saving to your library',
  done: 'done'
};

const parseOverlayController = () => {
  const overlay = document.getElementById('parse-overlay');
  const title = document.getElementById('parse-overlay-title');
  const sub = document.getElementById('parse-overlay-sub');
  const progress = document.getElementById('parse-overlay-progress');
  const barFill = document.getElementById('parse-overlay-bar-fill');
  const phaseEl = document.getElementById('parse-overlay-phase');
  const percentEl = document.getElementById('parse-overlay-percent');
  const barRole = overlay ? overlay.querySelector('[role="progressbar"]') : null;

  const fmtMs = (ms) => {
    if (typeof ms !== 'number' || ms < 0) return null;
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  };

  const show = () => {
    if (!overlay) return;
    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    if (title) title.textContent = 'Parsing your reference replay…';
    if (sub) sub.textContent = 'This happens entirely in your browser. Nothing is uploaded.';
    if (barFill) barFill.style.width = '0%';
    if (phaseEl) phaseEl.textContent = 'starting…';
    if (percentEl) percentEl.textContent = '0%';
    if (progress) progress.textContent = '';
  };

  const update = (evt) => {
    if (!overlay) return;
    if (overlay.style.display === 'none' || overlay.style.display === '') show();
    if (!evt) return;
    const pct = typeof evt.percent === 'number' ? Math.round(evt.percent) : null;
    if (pct !== null) {
      if (barFill) barFill.style.width = pct + '%';
      if (percentEl) percentEl.textContent = pct + '%';
      if (barRole) barRole.setAttribute('aria-valuenow', String(pct));
    }
    if (evt.phase && phaseEl) {
      phaseEl.textContent = PARSE_PHASE_LABEL[evt.phase] || evt.phase;
    }
    let detail = '';
    if (evt.phase === 'parsing' && typeof evt.gameTimeMs === 'number' && typeof evt.durationMs === 'number' && evt.durationMs > 0) {
      detail = `${fmtMs(evt.gameTimeMs)} of ${fmtMs(evt.durationMs)}`;
    } else if (evt.detail) {
      detail = evt.detail;
    }
    if (progress) progress.textContent = detail;
  };

  const hide = () => {
    if (!overlay) return;
    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
  };

  return { show, update, hide };
};

// Compact dimension-pill match indicator for chooser rows. Replaces the
// old numeric "score" badge — the underlying scoring buckets coarsely
// (race=50, matchup=25, archetype=15, map=10), so every same-tier option
// landed on the same number and the rows looked indistinguishable.
//
// Five pills: race / matchup / build / map / grade.
//   green = match · grey = miss · amber = partial-or-unknown
// The build pill folds in the divergent flag (amber when build is
// different even if archetype tag matched). The grade pill folds in
// the analyzer duration gate (red-grey when game lengths don't overlap
// enough to score).
const chooserDimensionDots = (entry, userPlayer, userMu, userSummary, annotated) => {
  const dims = chooserDimensionStatus(entry, userPlayer, userMu, userSummary, annotated);
  return dims.map(d => `<span class="ci-chooser-dot ci-chooser-dot-${escapeAttr(d.status)}" title="${escapeAttr(d.title)}">${escapeHtml(d.label)}</span>`).join('');
};

const chooserDimensionStatus = (entry, userPlayer, userMu, userSummary, annotated) => {
  const out = [];
  // Race
  out.push({
    label: 'R',
    status: (entry.buildRace && entry.buildRace === userPlayer.race) ? 'on' : 'off',
    title: `Race ${entry.buildRace === userPlayer.race ? 'matches' : 'differs'}`
  });
  // Matchup
  const muMatch = userMu && (entry.buildMatchups || []).includes(userMu);
  out.push({
    label: 'MU',
    status: muMatch ? 'on' : 'off',
    title: `Matchup ${muMatch ? 'matches' : 'differs'}`
  });
  // Build / archetype — amber when annotated.divergent (different
  // signature unit even if archetype tag matched), green when both
  // archetype and signature align.
  const expectedArch = entry.isUserReference ? entry.referenceArchetype : (
    entry.buildOpener === 'expand' ? 'fast-expand' :
    entry.buildOpener === 'fast-tech' ? 'tech' :
    entry.buildOpener === 'rush' ? '1-base-t2' :
    entry.buildOpener === 'standard' ? '1-base-t2' : null
  );
  const archMatch = userPlayer.archetype && userPlayer.archetype !== 'unknown' && expectedArch === userPlayer.archetype;
  let buildStatus = 'off';
  let buildTitle = 'Different build';
  if (archMatch && (!annotated || !annotated.divergent)) {
    buildStatus = 'on'; buildTitle = 'Same build archetype';
  } else if (annotated && annotated.divergent) {
    buildStatus = 'unknown'; buildTitle = 'Different signature unit';
  } else if (userPlayer.archetype === 'unknown') {
    buildStatus = 'unknown'; buildTitle = 'Couldn\'t classify your build';
  }
  out.push({ label: 'B', status: buildStatus, title: buildTitle });
  // Map — compare resolved display names (both go through the same
  // map-folders manifest lookup so version variants and naming
  // conventions converge to one canonical string).
  const userMapDisplay = (userSummary && userSummary.map ? resolveMap(userSummary.map).displayName : '').toLowerCase();
  const entryMapDisplay = entry.map ? resolveMap(entry.map).displayName.toLowerCase() : '';
  const mapMatch = !!userMapDisplay && !!entryMapDisplay && userMapDisplay === entryMapDisplay;
  out.push({
    label: 'M',
    status: mapMatch ? 'on' : 'off',
    title: `Map ${mapMatch ? 'matches' : 'differs'}`
  });
  // Grade-ability (analyzer duration gate). Decoupled from the dimension
  // matches so the user sees both signals: a perfect race+matchup+build
  // match that won't grade still tells you what you'd be losing.
  if (annotated) {
    out.push({
      label: 'G',
      status: annotated.grades ? 'on' : 'off',
      title: annotated.grades
        ? 'Game lengths overlap — categories will grade'
        : 'Game lengths too different — categories won\'t grade'
    });
  }
  return out;
};

// Browser mirror of tools/import-replays.js cleanMapName(). Keep in sync.
const cleanMapName = (raw) => {
  if (!raw) return '';
  let n = String(raw).replace(/^.*[/\\]/, '');
  n = n.replace(/\.(w3x|w3m)$/i, '');
  n = n.replace(/^\(\d+\)\s*/, '');
  n = n.replace(/^\d+_w3c_\d+_\d+_/, '');
  n = n.replace(/^w3c_\d+_\d+_/, '');
  n = n.replace(/^w3c_/, '');
  n = n.replace(/_w3c_\d+_\d+(_\d+)?$/, '');
  n = n.replace(/^\dv\d_/, '');
  n = n.replace(/_v[\d.-]+$/, '');
  n = n.replace(/([a-z])([A-Z])/g, '$1 $2');
  n = n.replace(/[_]/g, ' ').replace(/\s+/g, ' ').trim();
  return n;
};

if (typeof window !== 'undefined') {
  window.CompareInline = CompareInline;
  // Expose the shared user-summary builder + map-folders bootstrap so other
  // subsystems (notably MyReplays.setReferenceState) can compute a summary
  // for a record without depending on private file-local closures here.
  window.CompareInline.buildUserSummary = buildUserSummary;
  window.CompareInline.ensureMapFoldersManifest = ensureMapFoldersManifest;
  // Map + race helpers used by AdvancedComparePicker so its result rows
  // match the map-grouped chooser inside the compare drawer (same map
  // thumbnail, same opponent race icon convention). Additive — existing
  // callers are unaffected.
  window.CompareInline.resolveMap = resolveMap;
  window.CompareInline.raceIconUrl = raceIconUrl;
  window.CompareInline.RACE_ICON = RACE_ICON;
  window.CompareInline.RACE_LONG = RACE_LONG;
}
})();
