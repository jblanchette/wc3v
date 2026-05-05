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
    this.matcher = new window.CompareMatcher();
    this.userSummary = null;          // built lazily from parsedJson
    this.userSlot = null;             // string; first non-neutral slot
    this.candidates = [];             // [{ entry, score }]
    this.currentProEntry = null;
    this.currentReport = null;
    this.selfMatchEntry = null;       // pro entry whose fingerprint == userSummary's
    this.isSelfMatch = false;         // true while currentProEntry === selfMatchEntry
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
      // Build summary-shaped object from the parsedJson once.
      this.userSummary = buildUserSummary(this.userRecord);
      this.userSlot = pickUserSlot(this.userSummary, this.userRecord);
      if (!this.userSlot) {
        this._renderEmpty('Couldn\'t find your player slot in this replay.');
        return;
      }
      this.candidates = await this.matcher.rankCandidates(this.userSummary, this.userSlot, { limit: 8 });
      // Detect self-match (re-upload of a pro replay) ahead of autoPick so we
      // can render a different label and snap the grade to 100.
      this.selfMatchEntry = await this.matcher.findByFingerprint(this.userSummary);
      const auto = await this.matcher.autoPick(this.userSummary, this.userSlot);
      if (auto) {
        await this._compareWith(auto);
      } else if (this.candidates.length) {
        // No auto-pick, but candidates exist — render with the top candidate
        // selected so the user sees something useful right away. The
        // checklist will explain what doesn't match.
        await this._compareWith(this.candidates[0].entry);
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
    // the card grade badge).
    if (this.onResult) {
      try { this.onResult(report, proEntry); } catch (e) { /* host owns errors */ }
    }
    if (this.onTitleChange) {
      const mu = (proEntry.buildMatchups && proEntry.buildMatchups[0]) || '';
      this.onTitleChange(`vs ${proEntry.playerName}${mu ? ' · ' + mu : ''}`, `Grade: ${report.overall.grade}`);
    }
  }

  // ===== Rendering =====

  _renderLoading (msg) {
    this.rootEl.innerHTML = `
      <div class="ci-loading">
        <div class="ci-spinner"></div>
        <div class="ci-loading-text">${escapeHtml(msg || 'Looking for a pro to compare…')}</div>
      </div>
    `;
  }

  _renderError (msg) {
    this.rootEl.innerHTML = `<div class="ci-error">${escapeHtml(msg)}</div>`;
  }

  _renderEmpty (msg) {
    this.rootEl.innerHTML = `<div class="ci-empty">${escapeHtml(msg)}</div>`;
  }

  _renderNoCandidates () {
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

  // Broadcast-style report. Sections (top → bottom):
  //   1. Identity bar (pro card + "Watch my replay" CTA)
  //   2. Compatibility checklist
  //   3. Overall grade + 5 grade tiles with "?" tooltips
  //   4. Side-by-side hero comparison
  //   5. Side-by-side build order preview (first ~20 events)
  //   6. Economy chart (supply + workers, you vs pro)
  //   7. Switcher chips + advanced search
  _renderReport (report, proEntry, proSummary) {
    const u = this.userSummary.players[this.userSlot] || {};
    const proPlayers = (proSummary && proSummary.players) || {};
    const p = proPlayers[String(proEntry.playerSlot)] || {};
    const pTrack = p.economyTrack || [];
    const pPreview = p.buildPreview || [];

    const overallGradeClass = window.ReplayAnalyzer.gradeClass(report.overall.grade);
    const isAuto = this.candidates.length && this.candidates[0].entry === proEntry && !report.selfMatch;
    const isFreshUpload = document.body.dataset.freshUpload === '1';
    const isSelfMatch = !!report.selfMatch;
    const userRecordId = this.userRecord && this.userRecord.id;
    // Overall grade is "N/A" when every category was unavailable (e.g., the
    // user picked a different-matchup pro). We don't want to show a giant
    // empty "N/A 0/100" card — replace with a "Why no grade?" explanation.
    const overallUnavailable = !report.overall || report.overall.grade === 'N/A' || (report.overall.score === 0 && Object.values(report.categories || {}).every(c => !c.available));

    // ---- Compatibility checklist ----
    const checklistHtml = (report.compatibility || []).map(c => `
      <div class="ci-check ci-check-${c.status}">
        <span class="ci-check-icon">${CHECK_ICON[c.status] || '·'}</span>
        <span class="ci-check-label">${escapeHtml(c.label)}</span>
        <span class="ci-check-detail">${escapeHtml(c.detail || '')}</span>
      </div>
    `).join('');

    // ---- Grade tiles with tooltips ----
    const TILE_INFO = {
      macro: 'Worker count and supply usage every 30s vs pro. Improve: queue workers continuously and don\'t get supply-blocked.',
      tech: 'Tier-2 / Tier-3 / Hero-level timings vs pro (60–90s tolerance). Improve: don\'t sit on resources at tier-up time.',
      expansion: 'When you took your second town hall vs pro. Only scored when both played the same map.',
      buildAdherence: 'How closely your first 20 buildings/units match the pro\'s order (longest common subsequence).',
      production: 'Number of combat units produced in the first 10 minutes vs pro.'
    };
    const categoryOrder = ['macro', 'tech', 'expansion', 'buildAdherence', 'production'];
    const categoryLabels = {
      macro: 'Macro', tech: 'Tech', expansion: 'Expansion',
      buildAdherence: 'Build Adherence', production: 'Production'
    };
    // Map ReplayAnalyzer's terse `reason` strings to user-friendly explanations
    // ("not graded — different matchup" instead of "different matchups").
    const REASON_PRETTY = {
      'different matchups': 'Different matchup, the pro played a different race composition, so timings can\'t be compared apples-to-apples.',
      'different maps': 'Different maps, expansion timing depends on the map, so we skip this when maps differ.',
      'pro did not expand': 'The pro never expanded in this replay, so there\'s nothing to compare against.',
      'no economy data': 'Economy data missing from one or both replays.',
      'overlapping time too short': 'The replays barely overlap in length, can\'t sample the economy fairly.',
      'no overlapping samples': 'No overlapping economy samples to compare.',
      'no tech timings to compare': 'The pro never reached the tier or hero level we measure.',
      'no build preview': 'Build order data missing from one or both replays.',
      'pro produced no units in window': 'Pro built no combat units in the first 10 minutes, nothing to score against.',
      'archetype-degraded': 'Different archetypes, used a relaxed set-overlap score (penalised).',
      'Game ended too early to compare meaningfully': 'Your replay ended too early to compare meaningfully against the pro\'s game length.'
    };
    const tilesHtml = categoryOrder.map(k => {
      const cat = report.categories[k];
      if (!cat) return '';
      const findings = (cat.findings || []).map(f =>
        `<li class="ci-finding ci-finding-${f.severity}">${escapeHtml(f.text)}</li>`
      ).join('');
      const cls = cat.available ? 'ci-tile-on' : 'ci-tile-off';
      const grade = cat.available ? cat.grade : 'Not graded';
      const gradeCls = cat.available ? window.ReplayAnalyzer.gradeClass(grade) : 'grade-NA';
      const prettyReason = cat.reason ? (REASON_PRETTY[cat.reason] || cat.reason) : 'Data unavailable for this category.';
      return `
        <div class="ci-tile ${cls}">
          <div class="ci-tile-head">
            <div class="ci-tile-label">${categoryLabels[k]}<span class="ci-tile-info" title="${escapeAttr(TILE_INFO[k] || '')}">?</span></div>
            <div class="ci-tile-grade ${gradeCls}">${escapeHtml(grade)}</div>
          </div>
          ${cat.available
            ? `<div class="ci-tile-score">${cat.score}/100</div>`
            : `<div class="ci-tile-reason">${escapeHtml(prettyReason)}</div>`}
          ${findings ? `<ul class="ci-findings">${findings}</ul>` : ''}
        </div>
      `;
    }).join('');

    // ---- Side-by-side hero card ----
    const heroCardHtml = (label, player) => {
      const h = player.heroOpener || null;
      if (!h) return `<div class="ci-hero-card ci-hero-empty"><div class="ci-side-label">${escapeHtml(label)}</div><div class="ci-hero-none">No hero</div></div>`;
      const ic = iconUrl(h.itemId);
      return `
        <div class="ci-hero-card">
          <div class="ci-side-label">${escapeHtml(label)}</div>
          <div class="ci-hero-body">
            <img class="ci-hero-portrait" src="${escapeAttr(ic)}" alt="${escapeAttr(h.name || '')}" loading="lazy"
                 onerror="this.style.visibility='hidden'"/>
            <div class="ci-hero-meta">
              <div class="ci-hero-name">${escapeHtml(h.name || 'Unknown')}</div>
              <div class="ci-hero-time">first at ${escapeHtml(window.ReplayAnalyzer.formatMs(h.gameTimeMs || 0))}</div>
            </div>
          </div>
        </div>
      `;
    };
    const heroSection = `
      <section class="ci-section ci-section-hero">
        <h3 class="ci-section-title">Hero opener</h3>
        <div class="ci-vs-grid">
          ${heroCardHtml(`You — ${escapeHtml(u.name || '')}`, u)}
          ${heroCardHtml(`Pro — ${escapeHtml(p.name || proEntry.playerName || '')}`, p)}
        </div>
      </section>
    `;

    // ---- Side-by-side build order preview ----
    const userPreview = (u.buildPreview || []).slice(0, 20);
    const proPreview = (pPreview || []).slice(0, 20);
    // Shared item id sets so each row can light up if the other side built it too.
    const userIds = new Set(userPreview.map(b => b.itemId));
    const proIds  = new Set(proPreview.map(b => b.itemId));
    const renderBoTrack = (rows, otherIds) => rows.map(r => {
      const ic = iconUrl(r.itemId);
      const cls = otherIds.has(r.itemId) ? 'ci-bo-row ci-bo-row-match' : 'ci-bo-row ci-bo-row-miss';
      const typeBadge = r.type === 'expansion' ? '<span class="ci-bo-badge ci-bo-badge-expo">EXPO</span>'
        : r.type === 'hero' ? '<span class="ci-bo-badge ci-bo-badge-hero">HERO</span>' : '';
      return `
        <div class="${cls}">
          <img class="ci-bo-icon" src="${escapeAttr(ic)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/>
          <div class="ci-bo-name">${escapeHtml(r.name || '')}${typeBadge}</div>
          <div class="ci-bo-time">${escapeHtml(window.ReplayAnalyzer.formatMs(r.gameTimeMs || 0))}</div>
        </div>
      `;
    }).join('') || '<div class="ci-bo-empty">No build data.</div>';

    const buildSection = `
      <section class="ci-section ci-section-build">
        <h3 class="ci-section-title">Build order — first 20 events</h3>
        <div class="ci-vs-grid">
          <div class="ci-bo-track">
            <div class="ci-side-label">You — ${escapeHtml(u.name || '')}</div>
            <div class="ci-bo-rows">${renderBoTrack(userPreview, proIds)}</div>
          </div>
          <div class="ci-bo-track">
            <div class="ci-side-label">Pro — ${escapeHtml(p.name || proEntry.playerName || '')}</div>
            <div class="ci-bo-rows">${renderBoTrack(proPreview, userIds)}</div>
          </div>
        </div>
        <div class="ci-bo-legend">
          <span class="ci-bo-legend-pip ci-bo-legend-match"></span> in both builds
          &nbsp;&nbsp;
          <span class="ci-bo-legend-pip ci-bo-legend-miss"></span> only on this side
        </div>
      </section>
    `;

    // ---- Economy chart ----
    const econSvg = renderEconomyChart(u.economyTrack || [], pTrack || []);
    const econSection = econSvg ? `
      <section class="ci-section ci-section-econ">
        <h3 class="ci-section-title">Economy over time</h3>
        ${econSvg}
        <div class="ci-econ-legend">
          <span class="ci-econ-pip ci-econ-pip-you"></span> Your supply &nbsp;
          <span class="ci-econ-pip ci-econ-pip-pro"></span> Pro supply &nbsp;
          <span class="ci-econ-pip ci-econ-pip-you-w"></span> Your workers &nbsp;
          <span class="ci-econ-pip ci-econ-pip-pro-w"></span> Pro workers
        </div>
      </section>
    ` : '';

    // ---- Switcher chips ----
    const top = this.candidates.slice(0, 4);
    const chipsHtml = top.map(c => {
      const e = c.entry;
      const isCurrent = e.replayId === proEntry.replayId && String(e.playerSlot) === String(proEntry.playerSlot);
      return `
        <button class="ci-chip ${isCurrent ? 'ci-chip-active' : ''}" data-replay-id="${escapeAttr(e.replayId)}" data-slot="${escapeAttr(e.playerSlot)}">
          <span class="ci-chip-race race-${escapeAttr(e.buildRace || '?')}">${escapeHtml(e.buildRace || '?')}</span>
          <span class="ci-chip-name">${escapeHtml(e.playerName || '?')}</span>
          <span class="ci-chip-mu">${escapeHtml((e.buildMatchups && e.buildMatchups[0]) || '')}</span>
        </button>
      `;
    }).join('');

    // ---- Identity bar (top) with prominent side-by-side Watch CTAs ----
    const proLabel = isSelfMatch ? 'Same replay (self-match)'
                   : isAuto ? 'Auto-matched pro'
                   : 'Comparing to pro';
    const watchProUrl = `/viewer?r=${encodeURIComponent(proEntry.replayId)}&player=${encodeURIComponent(proEntry.playerSlot)}&buildId=${encodeURIComponent(proEntry.buildId || '')}`;
    const watchMineUrl = userRecordId ? `/viewer?local=${encodeURIComponent(userRecordId)}` : '';
    const freshHeadline = isFreshUpload
      ? `<div class="ci-fresh-headline">Your replay is ready — here\'s how it stacks up.</div>`
      : '';

    // Overall grade region: a real card when graded, OR a "No overall
    // grade" panel that explains why. The panel surfaces the actual
    // top-level warnings from the analyzer so the user knows whether to
    // try a different pro, switch player, or accept the mismatch.
    const warnHtml = (report.warnings && report.warnings.length)
      ? `<ul class="ci-no-grade-list">${report.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>`
      : '';
    const gradeRegion = overallUnavailable ? `
      <div class="ci-no-grade">
        <div class="ci-no-grade-head">No overall grade</div>
        <div class="ci-no-grade-body">
          None of the five scoring categories had comparable data between your replay and this pro. The top reasons:
        </div>
        ${warnHtml}
        <div class="ci-no-grade-foot">
          Each tile below shows the specific reason it couldn\'t be scored. Try a different pro from the chips at the bottom, or use Advanced search to filter by matchup, race, or map.
        </div>
      </div>
    ` : `
      <div class="ci-grade-card">
        <div class="ci-grade-letter ${overallGradeClass}">${escapeHtml(report.overall.grade)}</div>
        <div class="ci-grade-score">${report.overall.score}/100</div>
      </div>
    `;

    const watchButtons = `
      <div class="ci-watch-row">
        ${watchMineUrl ? `<a class="ci-watch-cta ci-watch-mine" href="${escapeAttr(watchMineUrl)}">▶ Watch my replay</a>` : ''}
        <a class="ci-watch-cta ci-watch-pro" href="${escapeAttr(watchProUrl)}" target="_blank" rel="noopener">▶ Watch pro replay ↗</a>
      </div>
    `;

    // ---- Slot-card row (the "You're comparing as ..." selector) ----
    // One real button per non-neutral player in the user's replay. The active
    // card is highlighted; clicking another card swaps the user identity
    // directly (no separate modal — that flow is still available via
    // _switchPlayer() with no arg).
    const RACE_NAME = { H: 'Human', O: 'Orc', E: 'Night Elf', U: 'Undead', R: 'Random' };
    const RACE_BADGE = { H: 'HU', O: 'ORC', E: 'NE', U: 'UD', R: '?' };
    const slotCards = (window.PlayerPicker && typeof window.PlayerPicker.buildCards === 'function')
      ? window.PlayerPicker.buildCards(this.userRecord && this.userRecord.parsedJson)
      : [];
    const slotRowHtml = slotCards.length ? `
      <div class="ci-slot-row" aria-label="Pick which player in this replay is you">
        <div class="ci-slot-row-head">
          <span class="ci-slot-row-title">Your player</span>
          ${slotCards.length > 1 ? '<span class="ci-slot-row-hint">Click another to switch.</span>' : ''}
        </div>
        ${slotCards.map(c => {
          const isActive = String(c.slot) === String(this.userSlot);
          const portrait = c.heroItemId ? iconUrl(c.heroItemId) : '';
          return `
            <button
              class="ci-slot-card ${isActive ? 'ci-slot-card-active' : ''}"
              type="button"
              data-slot="${escapeAttr(c.slot)}"
              ${isActive ? 'aria-pressed="true"' : ''}
            >
              <div class="ci-slot-portrait-wrap">
                ${portrait
                  ? `<img class="ci-slot-portrait" src="${escapeAttr(portrait)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/>`
                  : '<div class="ci-slot-portrait"></div>'}
                <span class="ci-slot-race-badge race-${escapeAttr(c.race || 'R')}">${escapeHtml(RACE_BADGE[c.race] || c.race || '?')}</span>
              </div>
              <div class="ci-slot-body">
                <div class="ci-slot-name">${escapeHtml(c.name || ('Slot ' + c.slot))}</div>
                <div class="ci-slot-meta">${escapeHtml(RACE_NAME[c.race] || c.race || 'Unknown')}${c.heroName ? ' · ' + escapeHtml(c.heroName) : ''}</div>
                <span class="ci-slot-pill ${isActive ? 'ci-slot-pill-active' : 'ci-slot-pill-pick'}">${isActive ? 'Selected' : 'Pick this player'}</span>
              </div>
            </button>
          `;
        }).join('')}
      </div>
    ` : '';

    // Pro card: "AUTO-MATCHED PRO" / "SAME REPLAY" / "COMPARING TO PRO"
    // gets a real banner header (uppercase eyebrow on a colored stripe)
    // sitting on top of a bordered card containing the pro's name, matchup,
    // build name, and stage. Reads as a labeled section, not a span.
    const proLabelClass = isSelfMatch ? 'ci-pro-banner-self'
                       : isAuto ? 'ci-pro-banner-auto'
                       : 'ci-pro-banner-manual';
    const proMeta = [
      (proEntry.buildMatchups && proEntry.buildMatchups[0]) || '',
      proEntry.buildName || '',
      proEntry.stage || ''
    ].filter(Boolean).map(escapeHtml).join(' &middot; ');
    const proCard = `
      <section class="ci-pro-card">
        <header class="ci-pro-banner ${proLabelClass}">
          <span class="ci-pro-banner-text">${escapeHtml(proLabel)}</span>
        </header>
        <div class="ci-pro-card-body">
          <div class="ci-pro-name">${escapeHtml(proEntry.playerName || '?')}</div>
          ${proMeta ? `<div class="ci-pro-meta">${proMeta}</div>` : ''}
        </div>
      </section>
    `;

    const headerHtml = `
      ${slotRowHtml}
      ${freshHeadline}
      <div class="ci-header">
        ${proCard}
        ${gradeRegion}
      </div>
      ${watchButtons}
    `;

    this.rootEl.innerHTML = `
      ${headerHtml}
      <div class="ci-checklist" aria-label="Compatibility checklist">${checklistHtml}</div>
      <div class="ci-tiles">${tilesHtml}</div>
      ${heroSection}
      ${buildSection}
      ${econSection}
      <div class="ci-switcher">
        <div class="ci-switcher-label">Switch pro:</div>
        <div class="ci-chips">${chipsHtml}</div>
        <button class="ci-advanced-btn" type="button">Advanced search…</button>
      </div>
    `;

    // Wire chip clicks.
    this.rootEl.querySelectorAll('.ci-chip').forEach(chip => {
      chip.addEventListener('click', async () => {
        const id = chip.dataset.replayId;
        const slot = chip.dataset.slot;
        const candidate = this.candidates.find(c => c.entry.replayId === id && String(c.entry.playerSlot) === String(slot));
        if (candidate) await this._compareWith(candidate.entry);
      });
    });
    // Wire advanced button.
    const advBtn = this.rootEl.querySelector('.ci-advanced-btn');
    if (advBtn) advBtn.addEventListener('click', () => this._openAdvanced());
    // Wire slot-card click → direct switch to that player (no modal).
    this.rootEl.querySelectorAll('.ci-slot-card[data-slot]').forEach(card => {
      if (card.classList.contains('ci-slot-card-active')) return;
      card.addEventListener('click', () => this._switchPlayer(card.dataset.slot));
    });
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
    score: 100, grade: 'A+', findings: [], available: true, _selfMatch: true
  });
  return {
    overall: { score: 100, grade: 'A+' },
    categories: {
      macro:          matchTile('Macro'),
      tech:           matchTile('Tech'),
      expansion:      matchTile('Expansion'),
      buildAdherence: matchTile('Build Adherence'),
      production:     matchTile('Production')
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

// Aliases into client/js/Security.js — shared escape helpers.
const escapeHtml = Security.escapeHtml;
const escapeAttr = Security.escapeAttr;

const iconUrl = (itemId) => itemId ? `/assets/wc3icons/${encodeURIComponent(itemId)}.jpg` : '';

// Render a small SVG line chart of supply + worker counts over time, you vs
// pro. Inputs are economyTrack arrays of {gameTimeMs, supplyUsed, totalWorkers}
// at 30s samples. Returns '' when there's nothing meaningful to draw.
const renderEconomyChart = (uTrack, pTrack) => {
  if (!uTrack || !pTrack || !uTrack.length || !pTrack.length) return '';
  const W = 720, H = 220, padL = 36, padR = 16, padT = 16, padB = 28;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const maxT = Math.max(
    uTrack[uTrack.length - 1].gameTimeMs || 0,
    pTrack[pTrack.length - 1].gameTimeMs || 0
  );
  if (maxT <= 0) return '';
  const all = uTrack.concat(pTrack);
  const maxSupply = Math.max(20, ...all.map(s => s.supplyUsed || 0));
  const maxWorkers = Math.max(10, ...all.map(s => s.totalWorkers || 0));
  const yMax = Math.max(maxSupply, maxWorkers, 20);

  const xFor = (t) => padL + (t / maxT) * innerW;
  const yFor = (v) => padT + innerH - (v / yMax) * innerH;

  const buildPath = (track, key) => {
    const pts = track.map(s => `${xFor(s.gameTimeMs || 0).toFixed(1)},${yFor(s[key] || 0).toFixed(1)}`);
    if (!pts.length) return '';
    return 'M' + pts.join(' L');
  };

  // Time gridlines every 2 minutes.
  const gridX = [];
  for (let t = 0; t <= maxT; t += 120000) {
    const x = xFor(t);
    const m = Math.floor(t / 60000);
    gridX.push(`<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + innerH}" class="ci-econ-grid"/>` +
               `<text x="${x}" y="${padT + innerH + 14}" text-anchor="middle" class="ci-econ-axis">${m}:00</text>`);
  }
  // Y gridlines every 25% of yMax.
  const gridY = [];
  for (let i = 0; i <= 4; i++) {
    const v = (yMax * i / 4);
    const y = yFor(v);
    gridY.push(`<line x1="${padL}" y1="${y}" x2="${padL + innerW}" y2="${y}" class="ci-econ-grid"/>` +
               `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" class="ci-econ-axis">${Math.round(v)}</text>`);
  }

  return `
    <svg class="ci-econ-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Economy chart">
      ${gridX.join('')}
      ${gridY.join('')}
      <path d="${buildPath(uTrack, 'totalWorkers')}" class="ci-econ-line ci-econ-you-w"/>
      <path d="${buildPath(pTrack, 'totalWorkers')}" class="ci-econ-line ci-econ-pro-w"/>
      <path d="${buildPath(uTrack, 'supplyUsed')}" class="ci-econ-line ci-econ-you"/>
      <path d="${buildPath(pTrack, 'supplyUsed')}" class="ci-econ-line ci-econ-pro"/>
    </svg>
  `;
};

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

// Mirror of CompareView._buildUserSummary, scoped here so this subsystem
// is self-contained. Builds a summary-shaped object from the parsed
// .wc3v JSON stored in IndexedDB.
const buildUserSummary = (record) => {
  const full = record.parsedJson;
  if (!full) return null;
  const cleanMap = cleanMapName((full.replay && full.replay.metadata && full.replay.metadata.map && full.replay.metadata.map.mapName) || '');
  const durationMs = (full.replay && full.replay.subheader && full.replay.subheader.replayLengthMS) || 0;
  const summary = {
    replayId: record.id,
    map: cleanMap,
    durationMs,
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
    summary.players[slot] = derivePlayerSummary(p, replayP);
    const nm = String(replayP.name || '').toLowerCase().trim();
    if (nm) fpNames.push(nm);
  }
  fpNames.sort();
  summary.fingerprint = `${cleanMap}|${Math.round(durationMs / 1000)}|${fpNames.join(',')}`;
  return summary;
};

const TOWER_IDS = { hgtw: 1, hgt1: 1, hgt2: 1, hwtw: 1, owtw: 1, unpl: 1, etrp: 1, etol: 1 };
const WORKER_IDS = { opeo: 1, hpea: 1, ewsp: 1, uaco: 1, ugho: 1 };
const SUMMON_UNIT_IDS = { uske: 1, hwat: 1, hwt2: 1, hwt3: 1, efon: 1, osw1: 1, osw2: 1, osw3: 1, ucs1: 1 };
// Tier-2/3 buildings — drop from buildPreview if they appear before that
// tier upgrade time (parser leakage / phantom events).
const T2_BUILDING_IDS = { eaow: 1, osld: 1, obea: 1, utod: 1, usep: 1, uslh: 1, hars: 1, hwtw: 1 };
const T3_BUILDING_IDS = { edos: 1, otrb: 1, ubon: 1, hgra: 1 };

const heroRaceFromItemId = (itemId) => {
  if (!itemId) return null;
  const c = String(itemId).charAt(0);
  if (c === 'H') return 'H';
  if (c === 'O') return 'O';
  if (c === 'E') return 'E';
  if (c === 'U') return 'U';
  if (c === 'N') return 'N';
  return null;
};

const derivePlayerSummary = (playerData, replayPlayerData) => {
  const eventStream = playerData.eventStream || [];
  const tierStream = playerData.tierStream || [];
  const race = playerData.race || replayPlayerData.raceDetected;

  let tier2Time = null, tier3Time = null;
  for (const t of tierStream) {
    if (t.tier === 2 && tier2Time === null) tier2Time = t.gameTime;
    if (t.tier === 3 && tier3Time === null) tier3Time = t.gameTime;
  }

  let heroOpener = null;
  for (const ev of eventStream) {
    // Tavern heroes ride a separate 'makeTavernHero' event, not 'addUnit'.
    const isHeroEvent = ev.unit && (
      (ev.key === 'addUnit' && ev.unit.isHero) ||
      ev.key === 'makeTavernHero'
    );
    if (!isHeroEvent) continue;
    const heroRace = heroRaceFromItemId(ev.unit.itemId);
    // Skip race-mismatched heroes (parser leakage).
    if (heroRace && heroRace !== 'N' && race && heroRace !== race) continue;
    heroOpener = { name: ev.unit.displayName, itemId: ev.unit.itemId, gameTimeMs: ev.gameTime };
    break;
  }
  let expansionTime = null;
  for (const ev of eventStream) {
    if (ev.isExpansion) { expansionTime = ev.gameTime; break; }
  }
  let firstTowerTime = null, firstUnitTime = null;
  let firstHeroLevel2Time = null, firstHeroLevel3Time = null;
  for (const ev of eventStream) {
    if (firstTowerTime === null && ev.key === 'addBuilding' && ev.building && TOWER_IDS[ev.building.itemId]) firstTowerTime = ev.gameTime;
    if (firstUnitTime === null && ev.key === 'addUnit' && ev.unit && !ev.unit.isHero
        && !WORKER_IDS[ev.unit.itemId] && !ev.unit.isSummon && !SUMMON_UNIT_IDS[ev.unit.itemId]) firstUnitTime = ev.gameTime;
    if (ev.key === 'heroLevel') {
      if (firstHeroLevel2Time === null && ev.level === 2) firstHeroLevel2Time = ev.gameTime;
      if (firstHeroLevel3Time === null && ev.level === 3) firstHeroLevel3Time = ev.gameTime;
    }
  }
  const economyTrack = [];
  let nextSampleAt = 0, lastSnap = null;
  for (const ev of eventStream) {
    if (typeof ev.gameTime !== 'number') continue;
    if (typeof ev.supplyUsed === 'number') {
      lastSnap = {
        gameTimeMs: ev.gameTime, supplyUsed: ev.supplyUsed, supplyMax: ev.supplyMax || 0,
        workersOnGold: ev.workers ? (ev.workers.onGold || 0) : 0,
        workersOnLumber: ev.workers ? ((ev.workers.onLumber || 0) + (ev.workers.ghoulsOnLumber || 0)) : 0,
        totalWorkers: ev.workers ? (ev.workers.totalWorkers || 0) : 0
      };
    }
    while (lastSnap && ev.gameTime >= nextSampleAt && nextSampleAt <= 30 * 60 * 1000) {
      economyTrack.push({ ...lastSnap, gameTimeMs: nextSampleAt });
      nextSampleAt += 30 * 1000;
    }
  }
  const buildPreview = [];
  for (const ev of eventStream) {
    if (buildPreview.length >= 20) break;
    if (ev.key === 'addBuilding' && ev.building) {
      const id = ev.building.itemId || '';
      if (T2_BUILDING_IDS[id] && (tier2Time === null || ev.gameTime < tier2Time)) continue;
      if (T3_BUILDING_IDS[id] && (tier3Time === null || ev.gameTime < tier3Time)) continue;
      buildPreview.push({ type: ev.isExpansion ? 'expansion' : 'building', name: ev.building.displayName, itemId: id, gameTimeMs: ev.gameTime });
    } else if (ev.key === 'addUnit' && ev.unit) {
      if (WORKER_IDS[ev.unit.itemId]) continue;
      if (ev.unit.isSummon || SUMMON_UNIT_IDS[ev.unit.itemId]) continue;
      if (ev.unit.isHero) {
        const heroRace = heroRaceFromItemId(ev.unit.itemId);
        if (heroRace && heroRace !== 'N' && race && heroRace !== race) continue;
      }
      buildPreview.push({ type: ev.unit.isHero ? 'hero' : 'unit', name: ev.unit.displayName, itemId: ev.unit.itemId || '', gameTimeMs: ev.gameTime });
    }
  }
  const SIX_MIN = 6 * 60 * 1000, EIGHT_MIN = 8 * 60 * 1000, FOUR_MIN = 4 * 60 * 1000, TWO_MIN = 2 * 60 * 1000;
  let archetype = 'unknown';
  if (firstTowerTime !== null && firstTowerTime < FOUR_MIN) archetype = 'tower-rush';
  else if (expansionTime !== null) {
    if (tier2Time === null) archetype = 'fast-expand';
    else if (expansionTime < tier2Time) archetype = 'fast-expand';
    else if (expansionTime - tier2Time < TWO_MIN) archetype = 'fast-expand';
  }
  if (archetype === 'unknown' && tier2Time !== null && tier2Time < SIX_MIN
      && (expansionTime === null || expansionTime > EIGHT_MIN)) archetype = '1-base-t2';

  return {
    name: replayPlayerData.name, race, heroOpener,
    tier2Time, tier3Time, expansionTime,
    firstTowerTime, firstUnitTime, firstHeroLevel2Time, firstHeroLevel3Time,
    archetype, economyTrack, buildPreview
  };
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

if (typeof window !== 'undefined') window.CompareInline = CompareInline;
})();
