// IndexedDB-backed store + UI for the user's locally-parsed replays.
//
// Storage shape:
//   db: 'wc3v'            object store: 'replays' (keyPath: 'id')
//   record: { id, parsedJson, uploadedAt, race, mapName, durationMs,
//             players: [{slot, name, race}], originalFilename,
//             // Optional fields added in the reference-replay feature:
//             isReference, referenceLabel, referencePlayerSlot, cachedSummary,
//             // Cached compare result on regular game replays:
//             lastCompare: { grade, score, proKey, proPlayerName, ts },
//             // Optional user-authored card metadata (only on references —
//             // a reference graduates from the compact rail to a "Your
//             // Builds" card on the homepage; this blob holds the editable
//             // pieces of that card):
//             userBuild: { name, description, strategyPoints[], tags[],
//                          matchups[], edited } }
//
// A "reference" replay is a game the user wants to use as a comparison
// anchor (e.g. a Happy ladder game) — it shows up in the compare chooser
// alongside curated builds and is never graded itself.
//
// Quota: keep most-recent N replays (FIFO eviction). Each parsed replay is
// ~700 KB JSON; 25 replays ≈ 17 MB, well under IndexedDB browser limits.

const MyReplays = class {
  constructor () {
    this.dbName = 'wc3v';
    this.storeName = 'replays';
    this.version = 1;
    this.maxEntries = 25;
    this._dbPromise = null;
  }

  _openDb () {
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.version);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('uploadedAt', 'uploadedAt');
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
    return this._dbPromise;
  }

  async _tx (mode, work) {
    const db = await this._openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, mode);
      const store = tx.objectStore(this.storeName);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      Promise.resolve(work(store)).then(v => { result = v; }).catch(reject);
    });
  }

  async put (record) {
    if (!record || !record.id) throw new Error('record must have id');
    if (!record.uploadedAt) record.uploadedAt = Date.now();
    await this._tx('readwrite', store => new Promise((res, rej) => {
      const r = store.put(record);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    }));
    await this._evictOverflow();
    return record;
  }

  async get (id) {
    return this._tx('readonly', store => new Promise((res, rej) => {
      const r = store.get(id);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    }));
  }

  // List records as lightweight summaries (no parsedJson). The full record
  // including parsedJson is fetched per-card via this.get(id) when needed.
  //
  //   options.limit — return at most N records (after sorting)
  //   options.sort  — 'newest' (default) | 'oldest' | 'race' | 'map'
  //   options.filter — 'all' (default) | 'games' | 'references'
  async list (options = {}) {
    const direction = options.sort === 'oldest' ? 'next' : 'prev';
    const all = await this._tx('readonly', store => new Promise((res, rej) => {
      const idx = store.index('uploadedAt');
      const out = [];
      const req = idx.openCursor(null, direction);
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const v = cursor.value;
          out.push({
            id: v.id,
            uploadedAt: v.uploadedAt,
            race: v.race,
            mapName: v.mapName,
            durationMs: v.durationMs,
            players: v.players,
            originalFilename: v.originalFilename,
            userSlot: v.userSlot ?? null,
            lastCompare: v.lastCompare || null,
            isReference: !!v.isReference,
            referenceLabel: v.referenceLabel || null,
            referencePlayerSlot: v.referencePlayerSlot || null,
            // userBuild rides along on references so the homepage Your Builds
            // section can render its cards from the lightweight list result;
            // the heavy cachedSummary stays on the full record (fetched lazily
            // at render time when the card actually needs to draw).
            userBuild: v.userBuild || null
          });
          cursor.continue();
        } else res(out);
      };
      req.onerror = () => rej(req.error);
    }));

    // Secondary in-memory sort for race/map. Race ordering: H, O, E, U, R.
    if (options.sort === 'race') {
      const order = { H: 0, O: 1, E: 2, U: 3, R: 4 };
      all.sort((a, b) => (order[a.race] ?? 9) - (order[b.race] ?? 9) || (b.uploadedAt - a.uploadedAt));
    } else if (options.sort === 'map') {
      all.sort((a, b) => String(a.mapName || '').localeCompare(String(b.mapName || '')) || (b.uploadedAt - a.uploadedAt));
    }

    let filtered = all;
    if (options.filter === 'games') filtered = all.filter(r => !r.isReference);
    else if (options.filter === 'references') filtered = all.filter(r => r.isReference);

    if (typeof options.limit === 'number' && options.limit > 0) {
      return filtered.slice(0, options.limit);
    }
    return filtered;
  }

  // Stable signature for a parsed replay. Two distinct games on the same
  // map with the same players AND the exact same duration is vanishingly
  // rare in practice; identical .w3g files always match. Used by
  // findDuplicateReference() to keep the same replay from becoming two
  // cards on the homepage.
  static _referenceFingerprint (record) {
    if (!record) return '';
    const map = String(record.mapName || '').toLowerCase().trim();
    const dur = Math.round((record.durationMs || 0) / 1000);
    const players = (record.players || [])
      .filter(p => p && typeof p.slot === 'number' && p.slot < 24)
      .map(p => `${p.slot}:${(p.race || '').toUpperCase()}:${(p.name || '').toLowerCase().trim()}`)
      .sort()
      .join(';');
    return `${map}|${dur}|${players}`;
  }

  // Find an existing reference whose content matches `record`. Skips the
  // candidate's own id so re-promoting an unflagged-then-reflagged record
  // still works. Returns the other record (lightweight list shape) or null.
  async findDuplicateReference (record) {
    const target = MyReplays._referenceFingerprint(record);
    if (!target) return null;
    const refs = await this.list({ filter: 'references' });
    for (const r of refs) {
      if (r.id === record.id) continue;
      if (MyReplays._referenceFingerprint(r) === target) return r;
    }
    return null;
  }

  // Toggle a record's reference state. Both players in a reference replay
  // are pros (it's a pro-vs-pro game), so the matcher indexes both slots
  // separately at lookup time — we don't need the user to nominate one as
  // "the" pro. Computes and caches a summary the first time a record is
  // flagged so the matcher can score it against future uploads. Returns
  // the updated record. Also clears any cached lastCompare since
  // references aren't graded — their role is anchor, not subject.
  async setReferenceState (id, opts = {}) {
    const record = await this.get(id);
    if (!record) return null;
    if (opts.isReference) {
      record.isReference = true;
      record.referenceLabel = opts.referenceLabel || record.referenceLabel || null;
      if (opts.referencePlayerSlot != null) {
        record.referencePlayerSlot = opts.referencePlayerSlot;
      }
      // Compute cachedSummary if missing — uses the same builder
      // CompareInline runs on bootstrap, so the shape matches the
      // server-baked /data/summaries/*.json format the matcher already
      // knows how to score against. If this fails (e.g. the page hasn't
      // finished loading SummaryExtract yet), the matcher's loadIndex has
      // a lazy-recovery path that recomputes on demand.
      if (!record.cachedSummary && window.CompareInline && window.CompareInline.buildUserSummary) {
        try {
          if (window.CompareInline.ensureMapFoldersManifest) {
            await window.CompareInline.ensureMapFoldersManifest();
          }
          record.cachedSummary = window.CompareInline.buildUserSummary(record);
        } catch (e) {
          console.warn('[MyReplays] failed to compute cachedSummary:', e);
        }
      }
      // Seed an editable userBuild blob the first time a record graduates
      // to a reference. The blob powers the Your Builds card on the
      // homepage; subsequent edits flow through setUserBuild() and flip
      // edited=true so we don't overwrite user authoring on re-promote.
      if (!record.userBuild || !record.userBuild.edited) {
        record.userBuild = seedUserBuild(record);
      }
      // References are anchors, not subjects — nuke any stale grade.
      record.lastCompare = null;
    } else {
      record.isReference = false;
      record.referenceLabel = null;
      // Keep userBuild on the record across an unflag/reflag cycle so an
      // edited card name doesn't get lost — re-promotion respects the
      // edited flag in the seed-or-keep branch above.
    }
    await this.put(record);
    return record;
  }

  // Merge user-edited card metadata onto a record's userBuild blob. Caller
  // passes the changed fields only (e.g. { name: 'New name' }); the rest
  // of the blob is preserved. Marks edited=true so future re-promotions
  // don't reseed the auto-derived defaults over user authoring.
  async setUserBuild (id, partial) {
    const record = await this.get(id);
    if (!record) return null;
    const seed = record.userBuild || seedUserBuild(record);
    record.userBuild = {
      ...seed,
      ...partial,
      // Coerce array fields back to arrays even if the caller passed
      // `undefined` (the spread above would leave the seed value alone, but
      // an explicit `null`/non-array would corrupt the shape).
      strategyPoints: Array.isArray((partial && partial.strategyPoints) ?? seed.strategyPoints)
        ? ((partial && partial.strategyPoints) ?? seed.strategyPoints)
        : [],
      tags: Array.isArray((partial && partial.tags) ?? seed.tags)
        ? ((partial && partial.tags) ?? seed.tags)
        : [],
      matchups: Array.isArray((partial && partial.matchups) ?? seed.matchups)
        ? ((partial && partial.matchups) ?? seed.matchups)
        : [],
      edited: true
    };
    await this.put(record);
    return record;
  }

  async remove (id) {
    return this._tx('readwrite', store => new Promise((res, rej) => {
      const r = store.delete(id);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    }));
  }

  async _evictOverflow () {
    const all = await this.list();
    if (all.length <= this.maxEntries) return;
    const stale = all.slice(this.maxEntries);
    for (const r of stale) {
      await this.remove(r.id);
    }
  }

  // Render a list of cards into a container element. Returns the rendered
  // count plus the total available (for "View all (N)" link logic).
  //
  //   options.limit — render at most N (rail caps at 5)
  //   options.sort  — see list()
  //   options.viewerPath — base URL for Watch buttons
  //   options.emptyEl — external empty-state element to toggle
  async renderPanel (containerEl, options = {}) {
    if (!containerEl) return { rendered: 0, total: 0 };

    // Always fetch the full filtered list to know the total; then slice for
    // the cap. options.filter passes through to list() — 'all' (default) /
    // 'games' / 'references'.
    const all = await this.list({ sort: options.sort, filter: options.filter });
    const records = (typeof options.limit === 'number') ? all.slice(0, options.limit) : all;
    const total = all.length;

    containerEl.innerHTML = '';

    const emptyEl = options.emptyEl || document.getElementById('my-replays-empty');
    if (emptyEl) emptyEl.hidden = total > 0;

    if (!total) {
      if (!emptyEl) {
        const empty = document.createElement('div');
        empty.className = 'my-replays-empty';
        empty.textContent = options.emptyText || 'No replays yet — drop a .w3g file to add one.';
        containerEl.appendChild(empty);
      }
      return { rendered: 0, total: 0 };
    }

    for (const r of records) {
      containerEl.appendChild(this._renderCard(r, options));
    }
    return { rendered: records.length, total };
  }

  // Broadcast-style replay card. Race banner backdrop + map thumbnail +
  // matchup header + timing pills + grade badge + actions.
  //
  // Reference replays (record.isReference === true) render with a "Reference"
  // pill instead of a grade badge, swap the Compare CTA for an unflag toggle,
  // and gain the .rep-card-reference modifier so CSS can highlight them.
  _renderCard (record, options) {
    const card = document.createElement('article');
    const refCls = record.isReference ? ' rep-card-reference' : '';
    card.className = `rep-card race-${record.race || 'R'}${refCls}`;
    card.dataset.id = record.id;
    if (record.isReference) card.dataset.reference = '1';

    const userPlayer = pickUserPlayer(record);
    const oppPlayer = pickOpponent(record, userPlayer);
    const userRace = (userPlayer && userPlayer.race) || record.race || 'R';
    const oppRace = (oppPlayer && oppPlayer.race) || 'R';

    // Timing pills + archetype come from the parsed JSON. Fallback gracefully
    // when fields are missing (older records).
    const stats = extractCardStats(record, userPlayer);
    const archetypeLabel = prettyArchetype(stats.archetype);

    const mapDir = canonicalMapDir(record.mapName);
    const mapDisplay = cleanMapName(record.mapName || 'Unknown');
    const ageStr = formatTimeAgo(record.uploadedAt);
    const durStr = record.durationMs ? formatDuration(record.durationMs) : '';

    // Cached compare result — populated when the user has run a compare.
    // No badge rendered until lastCompare exists; the prominent "Compare to
    // a pro" button in the action row is the obvious next action.
    const lastCompare = record.lastCompare || null;

    // Heroes from the parsed replay — up to 3 in pick order.
    const heroes = extractHeroes(record, userPlayer);

    // Use the gridmap.jpg as the map thumbnail; an onerror handler below
    // hides the <img> so the gradient banner shows through alone.
    const mapSrc = mapDir ? `/maps/${encodeURIComponent(mapDir)}/gridmap.jpg` : '';
    const bannerSrc = `/assets/race-banners/${userRace}.jpg`;

    card.innerHTML = `
      <div class="rep-card-bg" aria-hidden="true">
        <div class="rep-card-banner" style="background-image: url('${escapeAttr(bannerSrc)}')"></div>
        ${mapSrc ? `<img class="rep-card-map" src="${escapeAttr(mapSrc)}" alt="" loading="lazy"
                       onerror="this.classList.add('rep-card-map-failed')"/>` : ''}
        <div class="rep-card-bg-tint"></div>
      </div>

      <div class="rep-card-fg">
        <header class="rep-card-head">
          <div class="rep-card-races">
            <span class="rep-card-race-badge race-${userRace}">${RACE_LABEL[userRace] || userRace}</span>
            <span class="rep-card-vs">vs</span>
            <span class="rep-card-race-badge race-${oppRace} rep-card-opp">${RACE_LABEL[oppRace] || oppRace}</span>
          </div>
          ${record.isReference
            ? `<span class="rep-card-reference-badge" title="In your pro builds grid — not graded itself">★ Pro replay</span>`
            : (lastCompare
              ? `<span class="rep-card-grade-badge ${gradeClass(lastCompare.grade)}" title="Last compare: ${lastCompare.score}/100${lastCompare.proPlayerName ? ' vs ' + escapeAttr(lastCompare.proPlayerName) : ''}">${escapeHtml(lastCompare.grade)}</span>`
              : '')}
        </header>

        <div class="rep-card-meta">
          <div class="rep-card-players">
            <strong>${safePlayerName((userPlayer && PlayerNames.canonical(userPlayer.name)) || 'You')}</strong>
            <span class="rep-card-vs-text">vs</span>
            <span>${safePlayerName((oppPlayer && PlayerNames.canonical(oppPlayer.name)) || 'Opponent')}</span>
          </div>
          <div class="rep-card-map-line">${escapeHtml(mapDisplay)} · ${escapeHtml(durStr)} · ${escapeHtml(ageStr)}</div>
        </div>

        <div class="rep-card-heroes" aria-label="Hero pick order">
          ${heroes.map(h => `<img class="rep-card-hero" src="/assets/wc3icons/${escapeAttr(h.itemId)}.jpg" alt="${escapeAttr(h.name || '')}" title="${escapeAttr(h.name || '')}" onerror="this.classList.add('rep-card-hero-failed')"/>`).join('')}
        </div>

        <div class="rep-card-build">
          ${archetypeLabel ? `<span class="rep-card-build-label">${escapeHtml(archetypeLabel)}</span>` : ''}
          <span class="rep-card-timings">
            ${stats.tier2 ? `<span class="rep-tp">T2 ${fmtTime(stats.tier2)}</span>` : ''}
            ${stats.tier3 ? `<span class="rep-tp">T3 ${fmtTime(stats.tier3)}</span>` : ''}
            ${stats.heroL3 ? `<span class="rep-tp">Hero L3 ${fmtTime(stats.heroL3)}</span>` : ''}
            ${stats.expansion
              ? `<span class="rep-tp rep-tp-expo">Expo ${fmtTime(stats.expansion)}</span>`
              : '<span class="rep-tp rep-tp-no">No expo</span>'}
          </span>
        </div>

        <footer class="rep-card-actions">
          <a class="rep-card-btn rep-card-btn-primary" data-action="watch" href="${(options.viewerPath || '/viewer')}?local=${encodeURIComponent(record.id)}">Watch</a>
          ${record.isReference
            ? `<button class="rep-card-btn rep-card-btn-unref" data-action="unmark-reference" type="button" title="Remove from pro builds — this replay returns to your replays as a regular game">Move back to my replays</button>`
            : `<button class="rep-card-btn rep-card-btn-compare" data-action="compare" type="button" aria-expanded="false">Compare to a pro</button>
               <button class="rep-card-btn rep-card-btn-mark-ref" data-action="mark-reference" type="button" title="Add this replay to the Pro Builds grid so it can be used as a comparison anchor">Promote to pro replay</button>`}
          <button class="rep-card-btn rep-card-btn-icon" data-action="remove" type="button" title="Remove from your library" aria-label="Remove">×</button>
        </footer>
      </div>
    `;

    // Wire actions.
    const compareBtn = card.querySelector('[data-action="compare"]');
    if (compareBtn) compareBtn.addEventListener('click', () => this._openCompareDrawer(card, record));
    const markBtn = card.querySelector('[data-action="mark-reference"]');
    if (markBtn) markBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleReference(card, record, true);
    });
    const unmarkBtn = card.querySelector('[data-action="unmark-reference"]');
    if (unmarkBtn) unmarkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleReference(card, record, false);
    });
    card.querySelector('[data-action="remove"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this._enterDeleteConfirm(card, record);
    });
    // Clicking the grade badge re-opens the cached comparison.
    const gradeBadge = card.querySelector('.rep-card-grade-badge');
    if (gradeBadge && lastCompare) {
      gradeBadge.addEventListener('click', () => this._openCompareDrawer(card, record));
      gradeBadge.style.cursor = 'pointer';
    }

    // Lazy hydrate: the lightweight record from list() doesn't include
    // parsedJson, so timing pills + heroes initially render empty/blank.
    // After the card lands in the DOM, fetch the full record and update
    // the rows in place. Cheap because IDB get is local + per-card.
    if (!record.parsedJson) {
      Promise.resolve().then(async () => {
        try {
          const full = await this.get(record.id);
          if (!full || !full.parsedJson) return;
          const fullStats = extractCardStats(full, userPlayer);
          const fullArch = prettyArchetype(fullStats.archetype);
          const fullHeroes = extractHeroes(full, userPlayer);

          // Heroes row.
          const heroesEl = card.querySelector('.rep-card-heroes');
          if (heroesEl) {
            heroesEl.innerHTML = fullHeroes.map(h =>
              `<img class="rep-card-hero" src="/assets/wc3icons/${escapeAttr(h.itemId)}.jpg" alt="${escapeAttr(h.name || '')}" title="${escapeAttr(h.name || '')}" onerror="this.classList.add('rep-card-hero-failed')"/>`
            ).join('');
          }

          // Build/timings row.
          const buildEl = card.querySelector('.rep-card-build');
          if (buildEl) {
            buildEl.innerHTML = `
              ${fullArch ? `<span class="rep-card-build-label">${escapeHtml(fullArch)}</span>` : ''}
              <span class="rep-card-timings">
                ${fullStats.tier2 ? `<span class="rep-tp">T2 ${fmtTime(fullStats.tier2)}</span>` : ''}
                ${fullStats.tier3 ? `<span class="rep-tp">T3 ${fmtTime(fullStats.tier3)}</span>` : ''}
                ${fullStats.heroL3 ? `<span class="rep-tp">Hero L3 ${fmtTime(fullStats.heroL3)}</span>` : ''}
                ${fullStats.expansion
                  ? `<span class="rep-tp rep-tp-expo">Expo ${fmtTime(fullStats.expansion)}</span>`
                  : '<span class="rep-tp rep-tp-no">No expo</span>'}
              </span>
            `;
          }
        } catch (e) { /* leave the placeholder pills */ }
      });
    }

    return card;
  }

  // Flip a record between "reference" and "your game" state. Re-renders the
  // card by dispatching the my-replays-changed event so the panel host can
  // refresh the list (which also bursts any matcher index that has it
  // cached). Optimistic UI: badge + button update first, then IDB write.
  //
  // Promote path is dedup-guarded: if an identical replay is already in
  // the user's pro builds, we surface a friendly inline note on the card
  // instead of silently creating a second card.
  async _toggleReference (cardEl, record, makeReference) {
    try {
      if (makeReference) {
        const existing = await this.findDuplicateReference(record);
        if (existing) {
          this._showAlreadyPromotedMessage(cardEl, record, existing);
          return;
        }
      }
      const updated = await this.setReferenceState(record.id, makeReference
        ? { isReference: true, referencePlayerSlot: record.userSlot || record.referencePlayerSlot }
        : { isReference: false });
      if (!updated) return;
      // Notify panel host so it re-renders + the matcher invalidates its index.
      try {
        document.dispatchEvent(new CustomEvent('wc3v:my-replays-changed', {
          detail: { changedId: record.id, isReference: !!updated.isReference }
        }));
      } catch {}
    } catch (e) {
      console.warn('[MyReplays] toggle reference failed:', e);
    }
  }

  // Replace the actions row with a brief info bar explaining the promote
  // was skipped because an identical replay is already in pro builds.
  // Mirrors the delete-confirm in-place pattern so it feels native to the
  // card; auto-dismisses after a few seconds in case the user walks away.
  _showAlreadyPromotedMessage (cardEl, record, existing) {
    const actionsEl = cardEl.querySelector('.rep-card-actions');
    if (!actionsEl || cardEl.dataset.infoMsg === '1') return;
    cardEl.dataset.infoMsg = '1';
    const originalHtml = actionsEl.innerHTML;
    actionsEl.classList.add('rep-card-actions-info');

    const label = (existing && existing.userBuild && existing.userBuild.name)
      || (existing && existing.referenceLabel)
      || 'a pro replay';

    actionsEl.innerHTML = `
      <span class="rep-card-info-msg">Already in your pro builds — “${escapeHtml(label)}”.</span>
      <button class="rep-card-btn rep-card-btn-cancel" type="button" data-info="ok">OK</button>
    `;

    const restore = () => {
      if (cardEl.dataset.infoMsg !== '1') return;
      actionsEl.classList.remove('rep-card-actions-info');
      actionsEl.innerHTML = originalHtml;
      cardEl.dataset.infoMsg = '';
      // innerHTML wipes listeners — re-bind the original action buttons.
      const cmp = actionsEl.querySelector('[data-action="compare"]');
      if (cmp) cmp.addEventListener('click', () => this._openCompareDrawer(cardEl, record));
      const mk = actionsEl.querySelector('[data-action="mark-reference"]');
      if (mk) mk.addEventListener('click', (e) => { e.stopPropagation(); this._toggleReference(cardEl, record, true); });
      const um = actionsEl.querySelector('[data-action="unmark-reference"]');
      if (um) um.addEventListener('click', (e) => { e.stopPropagation(); this._toggleReference(cardEl, record, false); });
      const rm = actionsEl.querySelector('[data-action="remove"]');
      if (rm) rm.addEventListener('click', (e) => { e.stopPropagation(); this._enterDeleteConfirm(cardEl, record); });
      document.removeEventListener('keydown', escHandler);
      clearTimeout(autoTimer);
    };
    const escHandler = (e) => { if (e.key === 'Escape') restore(); };
    document.addEventListener('keydown', escHandler);
    actionsEl.querySelector('[data-info="ok"]').addEventListener('click', restore);
    const autoTimer = setTimeout(restore, 5000);
  }

  // Two-step delete confirm: replace the actions row with a confirm bar
  // in-place. Cancel restores the row; Confirm removes the record + card.
  _enterDeleteConfirm (cardEl, record) {
    if (cardEl.dataset.confirming === '1') return;
    cardEl.dataset.confirming = '1';
    const actionsEl = cardEl.querySelector('.rep-card-actions');
    if (!actionsEl) return;
    const originalHtml = actionsEl.innerHTML;
    actionsEl.classList.add('rep-card-actions-confirming');
    actionsEl.innerHTML = `
      <button class="rep-card-btn rep-card-btn-cancel" type="button" data-confirm="cancel">← Cancel</button>
      <span class="rep-card-confirm-msg">Delete this replay?</span>
      <button class="rep-card-btn rep-card-btn-danger" type="button" data-confirm="delete">Delete</button>
    `;

    const restore = () => {
      actionsEl.classList.remove('rep-card-actions-confirming');
      actionsEl.innerHTML = originalHtml;
      cardEl.dataset.confirming = '';
      // Re-wire the original buttons (innerHTML wipes listeners).
      const cmp = actionsEl.querySelector('[data-action="compare"]');
      if (cmp) cmp.addEventListener('click', () => this._openCompareDrawer(cardEl, record));
      const mk = actionsEl.querySelector('[data-action="mark-reference"]');
      if (mk) mk.addEventListener('click', (e) => { e.stopPropagation(); this._toggleReference(cardEl, record, true); });
      const um = actionsEl.querySelector('[data-action="unmark-reference"]');
      if (um) um.addEventListener('click', (e) => { e.stopPropagation(); this._toggleReference(cardEl, record, false); });
      actionsEl.querySelector('[data-action="remove"]').addEventListener('click', (e) => {
        e.stopPropagation();
        this._enterDeleteConfirm(cardEl, record);
      });
      document.removeEventListener('keydown', escHandler);
    };

    const escHandler = (e) => { if (e.key === 'Escape') restore(); };
    document.addEventListener('keydown', escHandler);

    actionsEl.querySelector('[data-confirm="cancel"]').addEventListener('click', restore);
    actionsEl.querySelector('[data-confirm="delete"]').addEventListener('click', async () => {
      document.removeEventListener('keydown', escHandler);
      cardEl.classList.add('rep-card-removing');
      // Brief fade before removing from DOM.
      await new Promise(r => setTimeout(r, 160));
      await this.remove(record.id);
      cardEl.remove();
      // Re-toggle empty state if list is now empty.
      const remaining = await this.list();
      const emptyEl = document.getElementById('my-replays-empty');
      if (emptyEl) emptyEl.hidden = remaining.length > 0;
      // Optional: notify other surfaces of a change.
      try { document.dispatchEvent(new CustomEvent('wc3v:my-replays-changed', { detail: { removedId: record.id } })); } catch {}
    });
  }

  // Open the compare experience in the global side-drawer (overlay), not
  // inline beneath the card. The drawer hosts the CompareInline subsystem.
  async _openCompareDrawer (cardEl, record) {
    // Drawer DOM lives in client/index.html at body level.
    const drawer = document.getElementById('compare-drawer');
    const backdrop = document.getElementById('compare-drawer-backdrop');
    const body = document.getElementById('compare-drawer-body');
    const foot = document.getElementById('compare-drawer-foot');
    if (!drawer || !body) return;

    // Reset and re-create CompareInline each time so the drawer body is
    // fresh and reflects whichever card was clicked.
    body.innerHTML = '';
    if (foot) foot.innerHTML = '';
    drawer.hidden = false;
    if (backdrop) backdrop.hidden = false;
    // Force a paint before adding the open class so the scale/fade-in
    // transition actually animates instead of snapping to its end state.
    requestAnimationFrame(() => {
      drawer.classList.add('compare-drawer-open');
      if (backdrop) backdrop.classList.add('compare-drawer-open');
    });
    document.body.classList.add('compare-drawer-active');

    // Wire close handlers (idempotent — re-add on each open).
    const close = () => this._closeCompareDrawer();
    const closeBtn = document.getElementById('compare-drawer-close');
    if (closeBtn) closeBtn.onclick = close;
    if (backdrop) backdrop.onclick = close;
    document.addEventListener('keydown', this._drawerEscHandler = (e) => {
      if (e.key === 'Escape') close();
    });

    if (typeof window.CompareInline !== 'function') {
      body.innerHTML = '<div class="ci-empty">CompareInline subsystem not loaded.</div>';
      return;
    }

    // The `record` from list() is the lightweight summary (no parsedJson)
    // because pulling 25 full replays at panel-render time would be wasteful.
    // CompareInline needs parsedJson to derive the user summary, so fetch
    // the full record now.
    const fullRecord = await this.get(record.id);
    if (!fullRecord || !fullRecord.parsedJson) {
      body.innerHTML = '<div class="ci-error">Failed to load this replay\'s data — try removing and re-uploading.</div>';
      return;
    }

    // Build a callback that the CompareInline can fire when a comparison
    // produces a result, so we can cache the grade on the record + update
    // the badge on the card.
    const inline = new window.CompareInline(body, fullRecord, this, {
      onResult: async (report, proEntry, proKey) => {
        try {
          const updated = { ...fullRecord,
            lastCompare: {
              grade: report.overall.grade,
              score: report.overall.score,
              proKey: proKey || null,
              proReplayId: proEntry && proEntry.replayId,
              proPlayerName: proEntry && proEntry.playerName,
              ts: Date.now()
            }
          };
          await this.put(updated);
          // Update card badge in place.
          const badge = cardEl.querySelector('.rep-card-grade-badge');
          if (badge) {
            badge.textContent = report.overall.grade;
            badge.dataset.empty = 'false';
            badge.className = `rep-card-grade-badge ${gradeClass(report.overall.grade)}`;
            badge.title = 'Last compare: ' + report.overall.score + '/100';
            badge.style.cursor = 'pointer';
          }
        } catch (e) {
          console.warn('[MyReplays] failed to cache lastCompare:', e);
        }
      },
      // Title bar was removed in favor of inline meta — onTitleChange is
      // now a no-op so existing CompareInline calls don't have to branch.
      onTitleChange: () => {}
    });
    await inline.bootstrap();
  }

  _closeCompareDrawer () {
    const drawer = document.getElementById('compare-drawer');
    const backdrop = document.getElementById('compare-drawer-backdrop');
    if (drawer) {
      drawer.classList.remove('compare-drawer-open');
      drawer.hidden = true;
    }
    if (backdrop) {
      backdrop.classList.remove('compare-drawer-open');
      backdrop.hidden = true;
    }
    document.body.classList.remove('compare-drawer-active');
    if (this._drawerEscHandler) {
      document.removeEventListener('keydown', this._drawerEscHandler);
      this._drawerEscHandler = null;
    }
  }
};

// ===== File-local helpers (broadcast card renderer) =====

const RACE_LABEL = { H: 'HU', O: 'ORC', E: 'NE', U: 'UD', R: '?' };

// Aliases into the shared Security helpers (see client/js/Security.js).
const escapeAttr = Security.escapeAttr;

const fmtTime = (ms) => {
  if (!ms || ms <= 0) return '';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
};

const prettyArchetype = (a) => ({
  'fast-expand': 'Fast Expand',
  '1-base-t2':   '1-base T2',
  'tower-rush':  'Tower Rush',
  'tech':        'Fast Tech',
  'unknown':     ''   // hide label entirely if unclassified
}[a] || '');

const gradeClass = (grade) => {
  if (!grade || grade === 'N/A' || grade === '—') return 'grade-NA';
  return 'grade-' + String(grade).replace('+', 'plus').replace('-', 'minus');
};

// Pick the user's player slot from an IDB record. Order of preference:
//   1. record.userSlot — chosen explicitly by the user via PlayerPicker.
//   2. record.race — the legacy auto-pick from the upload pipeline.
//   3. First non-neutral player < slot 24.
const pickUserPlayer = (record) => {
  const all = (record.players || []).filter(p => p && typeof p.slot === 'number' && p.slot < 24);
  if (!all.length) return null;
  if (record.userSlot != null) {
    const bySlot = all.find(p => String(p.slot) === String(record.userSlot));
    if (bySlot) return bySlot;
  }
  const byRace = all.find(p => p.race === record.race);
  return byRace || all[0];
};

const pickOpponent = (record, userPlayer) => {
  const all = (record.players || []).filter(p => p && typeof p.slot === 'number' && p.slot < 24);
  if (!userPlayer) return all[0] || null;
  return all.find(p => p.slot !== userPlayer.slot) || null;
};

// Extract timing + archetype from parsedJson for the user's slot. Walks
// the eventStream + tierStream the way generate-summary.js does.
const extractCardStats = (record, userPlayer) => {
  const out = { tier2: null, tier3: null, heroL3: null, expansion: null, archetype: 'unknown' };
  const parsed = record.parsedJson;
  if (!parsed || !userPlayer) return out;
  const slot = String(userPlayer.slot);
  const p = parsed.players && parsed.players[slot];
  if (!p) return out;

  const tierStream = p.tierStream || [];
  for (const t of tierStream) {
    if (t.tier === 2 && out.tier2 === null) out.tier2 = t.gameTime;
    if (t.tier === 3 && out.tier3 === null) out.tier3 = t.gameTime;
  }
  const eventStream = p.eventStream || [];
  for (const ev of eventStream) {
    if (ev.isExpansion && out.expansion === null) out.expansion = ev.gameTime;
    if (ev.key === 'heroLevel' && ev.level === 3 && out.heroL3 === null) out.heroL3 = ev.gameTime;
  }

  // Lightweight archetype classifier (mirrors generate-summary.js / CompareInline).
  const SIX_MIN = 360_000, EIGHT_MIN = 480_000, TWO_MIN = 120_000;
  if (out.expansion !== null) {
    if (out.tier2 === null || out.expansion < out.tier2 || (out.expansion - out.tier2) < TWO_MIN) {
      out.archetype = 'fast-expand';
    }
  }
  if (out.archetype === 'unknown' && out.tier2 !== null && out.tier2 < SIX_MIN
      && (out.expansion === null || out.expansion > EIGHT_MIN)) {
    out.archetype = '1-base-t2';
  }
  return out;
};

// Resolve a raw replay map name to the canonical client/maps/{name}/ dir.
// Mirrors helpers/mappings.js mapDataByFile lookup behavior — but we don't
// have access to that file from the browser, so use a permissive heuristic
// that works for our existing map directory naming.
// Hero pick order: walk the eventStream for hero unit additions.
// Mirrors scripts/generate-summary.js logic. Returns up to 3 heroes
// sorted by gameTime ascending (= pick order). Empty array on missing
// parsedJson (the lazy-hydrate path picks them up later).
const extractHeroes = (record, userPlayer) => {
  if (!record.parsedJson || !userPlayer) return [];
  const slot = String(userPlayer.slot);
  const stream = ((record.parsedJson.players || {})[slot] || {}).eventStream || [];
  const out = [];
  const seen = new Set();
  for (const ev of stream) {
    if (out.length >= 3) break;
    // Tavern heroes are emitted as 'makeTavernHero', not 'addUnit'.
    const isHeroEvent = ev.unit && ev.unit.itemId && (
      (ev.key === 'addUnit' && ev.unit.isHero) ||
      ev.key === 'makeTavernHero'
    );
    if (isHeroEvent) {
      if (seen.has(ev.unit.itemId)) continue;
      seen.add(ev.unit.itemId);
      out.push({ itemId: ev.unit.itemId, name: ev.unit.displayName, gameTimeMs: ev.gameTime });
    }
  }
  return out;
};

const canonicalMapDir = (rawMapName) => {
  if (!rawMapName) return null;
  // Strip path + extension.
  let n = String(rawMapName).split(/[\\/]/).pop().replace(/\.(w3x|w3m)$/i, '');
  // Strip W3C numbered prefix: "1075_w3c_251104_0950_Tidehunters_v1.2" → "Tidehunters_v1.2"
  n = n.replace(/^\d+_w3c_\d+_\d+_/i, '');
  // Strip "(2)" map slot prefix if present.
  n = n.replace(/^\(\d+\)\s*/, '');
  return n;
};

const cleanMapName = (rawMapName) => {
  const dir = canonicalMapDir(rawMapName) || rawMapName || '';
  return String(dir)
    .replace(/_v[\d._-]+$/, '')   // strip version suffix
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
};

const escapeHtml = Security.escapeHtml;
// safePlayerName: extra defense for replay-derived player/hero names —
// strip control/bidi chars and cap length so a name like "WC3V
// SECURITY: visit attacker.com" can't pretend to be UI copy.
const safePlayerName = (s) => Security.escapeHtml(Security.sanitizeUserText(s, { maxLen: 40 }));

const formatDuration = (ms) => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `${m}:${ss}`;
};

const formatTimeAgo = (ts) => {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};

// ===== Your Builds adapter — reference record → buildCard() props =====

// Default name for a freshly-promoted reference. References are pro
// replays the user uploaded — naming them by who-played-whom-where is
// the most informative default ("Happy vs Moon — Turtle Rock S2").
// Falls back to matchup + hero opener, then to a generic label.
const defaultUserBuildName = (record) => {
  const slot = pickReferenceSlot(record);
  const ps = pickPlayerSummary(record, slot);
  const opp = pickOpponentSummary(record, slot);

  // Try to assemble player-vs-player + map. Names come from
  // cachedSummary (extracted at promote time) and fall back to the
  // record's player roster.
  let userName = (ps && ps.name) || '';
  let oppName = (opp && opp.name) || '';
  if (!userName) {
    const u = pickUserPlayer(record);
    if (u) userName = u.name || '';
  }
  if (!oppName) {
    const u = pickUserPlayer(record);
    const o = pickOpponent(record, u);
    if (o) oppName = o.name || '';
  }
  // Show the official pro names (PlayerNames.js).
  userName = PlayerNames.canonical(userName);
  oppName = PlayerNames.canonical(oppName);
  // Map: prefer the cleaned summary map; fall back to the record's
  // raw mapName (cleaned) or the canonical map dir.
  const mapName = (record.cachedSummary && record.cachedSummary.map)
    || cleanMapName(record.mapName)
    || '';

  if (userName && oppName && mapName) return `${userName} vs ${oppName} — ${mapName}`;
  if (userName && oppName) return `${userName} vs ${oppName}`;

  // Fall back to matchup + hero, then bare label.
  const heroName = ps && ps.heroOpener && ps.heroOpener.name ? ps.heroOpener.name : '';
  const matchup = derivePrimaryMatchup(record, slot);
  if (matchup && heroName) return `${matchup} ${heroName}`;
  if (matchup) return `${matchup} reference`;
  return 'Reference replay';
};

// Choose which player-slot in the cachedSummary we treat as the build's
// author. References can be pro-vs-pro (no canonical user slot), so we
// fall back through a few options. The chosen slot drives matchups, hero
// opener, and key-unit derivation.
const pickReferenceSlot = (record) => {
  if (record.referencePlayerSlot != null) return String(record.referencePlayerSlot);
  if (record.userSlot != null) return String(record.userSlot);
  const summary = record.cachedSummary;
  if (summary && summary.players) {
    const slots = Object.keys(summary.players);
    if (slots.length) return slots[0];
  }
  const userPlayer = pickUserPlayer(record);
  if (userPlayer) return String(userPlayer.slot);
  return null;
};

const pickPlayerSummary = (record, slot) => {
  if (!record.cachedSummary || !record.cachedSummary.players || slot == null) return null;
  return record.cachedSummary.players[String(slot)] || null;
};

const pickOpponentSummary = (record, slot) => {
  if (!record.cachedSummary || !record.cachedSummary.players) return null;
  const players = record.cachedSummary.players;
  const keys = Object.keys(players);
  for (const k of keys) {
    if (String(k) !== String(slot)) return players[k];
  }
  return null;
};

const derivePrimaryMatchup = (record, slot) => {
  const me = pickPlayerSummary(record, slot);
  const opp = pickOpponentSummary(record, slot);
  if (me && opp && me.race && opp.race) return `${me.race}v${opp.race}`;
  // Fall back to record.players.
  const all = (record.players || []).filter(p => p && typeof p.slot === 'number' && p.slot < 24);
  if (all.length >= 2) {
    const meP = all.find(p => String(p.slot) === String(slot)) || all[0];
    const oppP = all.find(p => p.slot !== meP.slot) || all[1];
    if (meP && oppP && meP.race && oppP.race) return `${meP.race}v${oppP.race}`;
  }
  return '';
};

// Build the editable defaults for a new reference. cachedSummary may be
// absent on first call (we seed lazily); the user can edit name/etc later
// regardless. matchups[] is auto-derived only — the user doesn't author it.
const seedUserBuild = (record) => {
  const slot = pickReferenceSlot(record);
  const matchup = derivePrimaryMatchup(record, slot);
  return {
    name: defaultUserBuildName(record),
    description: '',
    strategyPoints: [],
    tags: [],
    matchups: matchup ? [matchup] : [],
    edited: false
  };
};

// Adapter: convert an IDB reference record (with cachedSummary populated)
// into the same prop shape the homepage's curated buildCard() expects.
// Returns null if the record can't be rendered as a card (e.g. the
// summary wasn't computed yet — the caller should retry after lazy-load).
//
// Race + matchups + heroes + key units + upgrades all come from the
// summary; the editable bits (name/description/strategy/tags) come from
// userBuild. The single replay entry is local-only: { _isLocal: true,
// href: /viewer?local=ID } so the buildCard renderer points the View
// button at the IDB-backed viewer path instead of a server replay id.
const buildCardPropsFromRecord = (record) => {
  if (!record) return null;
  const summary = record.cachedSummary;
  const slot = pickReferenceSlot(record);
  const ps = pickPlayerSummary(record, slot);
  const opp = pickOpponentSummary(record, slot);
  const ub = record.userBuild || seedUserBuild(record);

  const race = (ps && ps.race) || record.race || 'R';
  const userName = (ps && ps.name) || (() => {
    const p = pickUserPlayer(record);
    return p ? p.name : '';
  })();
  const oppName = (opp && opp.name) || (() => {
    const u = pickUserPlayer(record);
    const o = pickOpponent(record, u);
    return o ? o.name : '';
  })();

  // Hero IDs in pick order. heroOpener gives us the first one with high
  // confidence; heroBuilds (if extracted) extends it with later picks.
  const heroIds = [];
  const seenHero = new Set();
  if (ps && ps.heroOpener && ps.heroOpener.itemId) {
    heroIds.push(ps.heroOpener.itemId);
    seenHero.add(ps.heroOpener.itemId);
  }
  if (ps && Array.isArray(ps.heroBuilds)) {
    const ordered = [...ps.heroBuilds].sort((a, b) =>
      (a.spawnTimeMs ?? Infinity) - (b.spawnTimeMs ?? Infinity)
    );
    for (const h of ordered) {
      if (heroIds.length >= 3) break;
      if (h && h.itemId && !seenHero.has(h.itemId)) {
        heroIds.push(h.itemId);
        seenHero.add(h.itemId);
      }
    }
  }

  // heroSkills: { heroItemId: { abilityId: finalLevel } }. Derived from
  // each hero's skillOrder by taking the max skillLevel observed per
  // ability. The buildCard renders dim/ult/level pips based on this map.
  const heroSkills = {};
  if (ps && Array.isArray(ps.heroBuilds)) {
    for (const h of ps.heroBuilds) {
      if (!h || !h.itemId || !Array.isArray(h.skillOrder)) continue;
      const levels = {};
      for (const s of h.skillOrder) {
        if (!s || !s.abilityId) continue;
        const cur = levels[s.abilityId] || 0;
        if (s.skillLevel > cur) levels[s.abilityId] = s.skillLevel;
      }
      heroSkills[h.itemId] = levels;
    }
  }

  // Key units: top-N produced units by tier. Mirrors the curated card's
  // intent of showing what army the build leans on. Drop tier-2 → tier-3
  // duplicates so the row stays readable.
  const keyUnits = [];
  const seenKu = new Set();
  const pushUnits = (arr) => {
    for (const u of (arr || [])) {
      if (keyUnits.length >= 6) break;
      const id = u && u.itemId;
      if (!id || seenKu.has(id)) continue;
      seenKu.add(id);
      keyUnits.push(id);
    }
  };
  if (ps) {
    pushUnits(ps.t3Units);
    pushUnits(ps.t2Units);
  }

  // coreUpgrades: highest-level researched per itemId. Lets buildCard's
  // upgrade row populate from coreUpgrades when summary lookup fails (and
  // for our user-build, it always will — there's no entry in summaryMap).
  const coreUpgrades = [];
  if (ps && Array.isArray(ps.researched)) {
    const best = {};
    for (const r of ps.researched) {
      if (!r || !r.itemId) continue;
      if ((r.level || 0) > (best[r.itemId] || 0)) best[r.itemId] = r.level || 0;
    }
    for (const id of Object.keys(best)) coreUpgrades.push(id);
  }

  // tierProgression: synthesize from the tier composition fields so the
  // buildCard's expansion-detection branch (checks if expo building
  // appears in any tier's buildings) still works for user builds.
  const tierProgression = (ps && (ps.t2Buildings || ps.t3Buildings))
    ? {
        t1: { buildings: [], units: [] },
        t2: { buildings: (ps.t2Buildings || []).map(b => b.itemId).filter(Boolean),
              units:     (ps.t2Units || []).map(u => u.itemId).filter(Boolean) },
        t3: { buildings: (ps.t3Buildings || []).map(b => b.itemId).filter(Boolean),
              units:     (ps.t3Units || []).map(u => u.itemId).filter(Boolean) }
      }
    : null;

  // Local-only "replay" entry. _isLocal flips buildCard onto the local
  // /viewer?local= path; map/playerName flow through to the same chips
  // pro replays use, so the strip looks identical apart from the badge.
  const mapDisplay = (summary && summary.map) || cleanMapName(record.mapName) || '';
  const replays = [{
    _isLocal: true,
    replayId: '_local_' + record.id,
    playerSlot: slot != null ? String(slot) : '1',
    playerName: PlayerNames.canonical(userName) || 'You',
    opponentName: PlayerNames.canonical(oppName),
    map: mapDisplay,
    href: '/viewer?local=' + encodeURIComponent(record.id)
  }];

  return {
    id: 'userBuild::' + record.id,
    _localId: record.id,
    _isUserBuild: true,
    name: ub.name || defaultUserBuildName(record),
    description: ub.description || '',
    strategyPoints: Array.isArray(ub.strategyPoints) ? ub.strategyPoints : [],
    tags: Array.isArray(ub.tags) ? ub.tags : [],
    race,
    matchups: Array.isArray(ub.matchups) && ub.matchups.length ? ub.matchups : [],
    heroItemIds: heroIds,
    heroItemId: heroIds[0] || null,
    heroSkills,
    keyUnits,
    coreUpgrades,
    tierProgression,
    replays
  };
};

if (typeof window !== 'undefined') {
  window.MyReplays = MyReplays;
  // Static helpers exposed for the homepage's Your Builds renderer.
  window.MyReplays.buildCardPropsFromRecord = buildCardPropsFromRecord;
  window.MyReplays.seedUserBuild = seedUserBuild;
}
