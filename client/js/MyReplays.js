// IndexedDB-backed store + UI for the user's locally-parsed replays.
//
// Storage shape:
//   db: 'wc3v'            object store: 'replays' (keyPath: 'id')
//   record: { id, parsedJson, uploadedAt, race, mapName, durationMs,
//             players: [{slot, name, race}], originalFilename }
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
            lastCompare: v.lastCompare || null
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

    if (typeof options.limit === 'number' && options.limit > 0) {
      return all.slice(0, options.limit);
    }
    return all;
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

    // Always fetch the full list to know the total; then slice for the cap.
    const all = await this.list({ sort: options.sort });
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
  _renderCard (record, options) {
    const card = document.createElement('article');
    card.className = `rep-card race-${record.race || 'R'}`;
    card.dataset.id = record.id;

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
          ${lastCompare
            ? `<span class="rep-card-grade-badge ${gradeClass(lastCompare.grade)}" title="Last compare: ${lastCompare.score}/100${lastCompare.proPlayerName ? ' vs ' + escapeAttr(lastCompare.proPlayerName) : ''}">${escapeHtml(lastCompare.grade)}</span>`
            : ''}
        </header>

        <div class="rep-card-meta">
          <div class="rep-card-players">
            <strong>${safePlayerName((userPlayer && userPlayer.name) || 'You')}</strong>
            <span class="rep-card-vs-text">vs</span>
            <span>${safePlayerName((oppPlayer && oppPlayer.name) || 'Opponent')}</span>
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
          <button class="rep-card-btn rep-card-btn-compare" data-action="compare" type="button" aria-expanded="false">Compare to a pro</button>
          <button class="rep-card-btn rep-card-btn-icon" data-action="remove" type="button" title="Remove from your library" aria-label="Remove">×</button>
        </footer>
      </div>
    `;

    // Wire actions.
    card.querySelector('[data-action="compare"]').addEventListener('click', () => {
      this._openCompareDrawer(card, record);
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
      actionsEl.querySelector('[data-action="compare"]').addEventListener('click', () => this._openCompareDrawer(cardEl, record));
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
    const eyebrow = document.getElementById('compare-drawer-eyebrow');
    const title = document.getElementById('compare-drawer-title');
    if (!drawer || !body) return;

    eyebrow.textContent = 'Compare';
    title.textContent = 'Loading…';

    // Reset and re-create CompareInline each time so the drawer body is
    // fresh and reflects whichever card was clicked.
    body.innerHTML = '';
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
      onResult: async (report, proEntry) => {
        try {
          const updated = { ...fullRecord,
            lastCompare: {
              grade: report.overall.grade,
              score: report.overall.score,
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
      onTitleChange: (text, eyebrowText) => {
        title.textContent = text;
        if (eyebrowText) eyebrow.textContent = eyebrowText;
      }
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

if (typeof window !== 'undefined') {
  window.MyReplays = MyReplays;
}
