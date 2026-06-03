(function () {
// AdvancedComparePicker — modal UI for browsing the full pro replay
// library. Filters by source, race, matchup, opener, tournament. Returns
// the selected pro entry to a callback.
//
// Two modes:
//   - Compare mode: opened from the compare drawer with userSummary +
//     userSlot. Action button reads "Compare", picking starts a compare
//     against the user's own replay.
//   - Browse mode: opened from the homepage filter bar with no user
//     summary. Action button reads "Watch", picking navigates to the
//     viewer for the selected replay.
//
// Visual layout matches the map-grouped chooser inside the compare
// drawer (`_chooserMapGroupedHtml` in CompareInline) — same map
// thumbnail at the group header, same opponent race icon per row.

const AdvancedComparePicker = class {
  // {
  //   matcher, onPick,           required
  //   userSummary, userSlot,     optional — present in compare mode
  //   actionLabel,               optional — defaults: 'Compare' (compare mode) / 'Watch' (browse mode)
  //   title                      optional — modal title
  // }
  constructor ({ matcher, userSummary = null, userSlot = null, onPick, actionLabel = null, title = null }) {
    this.matcher = matcher;
    this.userSummary = userSummary;
    this.userSlot = userSlot;
    this.onPick = onPick;
    this.actionLabel = actionLabel || (userSummary ? 'Compare' : 'Watch');
    this.title = title || 'Browse pro replays';
    this.entries = [];
    this.modalEl = null;
    // 'source' is new this iteration — scopes the pool to curated vs
    // user-uploaded pros. Hidden from the UI when the user has zero
    // uploads (the row's chips would be redundant).
    this.filters = { source: 'all', race: 'all', matchup: 'all', opener: 'all', tournament: 'all' };
  }

  async open () {
    this.entries = await this.matcher.loadIndex();
    // Best-effort: warm the map-folders manifest so resolveMap() can
    // produce gridmap thumbnails. Same lazy-recovery pattern other
    // surfaces use; failure just means rows render without thumbnails.
    if (window.CompareInline && typeof window.CompareInline.ensureMapFoldersManifest === 'function') {
      try { await window.CompareInline.ensureMapFoldersManifest(); } catch {}
    }
    this._render();
  }

  close () {
    if (this.modalEl) this.modalEl.remove();
    this.modalEl = null;
    if (this._onKey) { document.removeEventListener('keydown', this._onKey); this._onKey = null; }
  }

  _render () {
    if (this.modalEl) this.modalEl.remove();
    const userRace = this.userSummary
      && this.userSummary.players
      && this.userSummary.players[this.userSlot]
      && this.userSummary.players[this.userSlot].race;

    const races = unique(this.entries.map(e => e.buildRace).filter(Boolean));
    const matchups = unique(this.entries.flatMap(e => e.buildMatchups || []));
    const openers = unique(this.entries.map(e => e.buildOpener).filter(Boolean));
    const tournaments = unique(this.entries.map(e => e.tournament).filter(Boolean));
    const hasUserReferences = this.entries.some(e => e.isUserReference);

    // Default the race filter to the user's race in compare mode (most
    // useful default). Browse mode skips this — the user might be
    // browsing any race.
    if (this.userSummary && this.filters.race === 'all' && userRace && races.includes(userRace)) {
      this.filters.race = userRace;
    }

    // Source filter chips — fixed labels (not derived from data values).
    const sourceLabels = { all: 'All', curated: 'Curated', mine: 'Added by you' };

    const m = document.createElement('div');
    m.className = 'acp-modal';
    m.innerHTML = `
      <div class="acp-backdrop"></div>
      <div class="acp-card" role="dialog" aria-modal="true" aria-labelledby="acp-title">
        <div class="acp-head">
          <h2 class="acp-title" id="acp-title">${escapeHtml(this.title)}</h2>
          <button class="acp-close" type="button" aria-label="Close">×</button>
        </div>
        <div class="acp-filters">
          ${hasUserReferences ? this._filterChips('source', 'Source', ['all', 'curated', 'mine'], sourceLabels) : ''}
          ${this._filterChips('race', 'Race', ['all', ...races])}
          ${this._filterChips('matchup', 'Matchup', ['all', ...matchups])}
          ${openers.length ? this._filterChips('opener', 'Opener', ['all', ...openers]) : ''}
          ${tournaments.length ? this._filterChips('tournament', 'Tournament', ['all', ...tournaments]) : ''}
        </div>
        <div class="acp-results acp-results-grouped" id="acp-results"></div>
      </div>
    `;
    document.body.appendChild(m);
    this.modalEl = m;

    m.querySelector('.acp-close').addEventListener('click', () => this.close());
    m.querySelector('.acp-backdrop').addEventListener('click', () => this.close());
    m.querySelectorAll('.acp-filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const dim = chip.dataset.dim;
        const val = chip.dataset.val;
        this.filters[dim] = val;
        this._refreshFilterChips();
        this._renderResults();
      });
    });

    this._renderResults();

    // Esc to close. Stored on the instance and removed in close() on EVERY
    // close path (button/backdrop/row/Esc) — the old inline handler only
    // detached on the Esc path, leaking a listener per open via other paths.
    if (this._onKey) document.removeEventListener('keydown', this._onKey);
    this._onKey = (e) => { if (e.key === 'Escape') this.close(); };
    document.addEventListener('keydown', this._onKey);
  }

  // labelMap: optional { value: displayLabel } override. Without it the
  // chip's display label is the raw value (capitalized 'All' for the
  // sentinel). With it, e.g. { mine: 'Added by you' } so chip text can
  // diverge from the internal value.
  _filterChips (dim, label, values, labelMap = null) {
    const chips = values.map(v => {
      const active = this.filters[dim] === v;
      const display = labelMap && labelMap[v] ? labelMap[v] : (v === 'all' ? 'All' : v);
      return `<button class="acp-filter-chip ${active ? 'acp-filter-chip-active' : ''}" data-dim="${dim}" data-val="${escapeHtml(v)}">${escapeHtml(display)}</button>`;
    }).join('');
    return `
      <div class="acp-filter-row">
        <div class="acp-filter-label">${escapeHtml(label)}</div>
        <div class="acp-filter-chips">${chips}</div>
      </div>
    `;
  }

  _refreshFilterChips () {
    if (!this.modalEl) return;
    this.modalEl.querySelectorAll('.acp-filter-chip').forEach(chip => {
      const dim = chip.dataset.dim;
      const val = chip.dataset.val;
      chip.classList.toggle('acp-filter-chip-active', this.filters[dim] === val);
    });
  }

  _renderResults () {
    const results = this.entries.filter(e => {
      // Source filter runs first — the cheapest predicate, and the one
      // most likely to dramatically narrow the pool.
      if (this.filters.source === 'curated' && e.isUserReference) return false;
      if (this.filters.source === 'mine' && !e.isUserReference) return false;
      if (this.filters.race !== 'all' && e.buildRace !== this.filters.race) return false;
      if (this.filters.matchup !== 'all' && !(e.buildMatchups || []).includes(this.filters.matchup)) return false;
      if (this.filters.opener !== 'all' && e.buildOpener !== this.filters.opener) return false;
      if (this.filters.tournament !== 'all' && e.tournament !== this.filters.tournament) return false;
      return true;
    });

    const out = this.modalEl.querySelector('#acp-results');
    if (!results.length) {
      // Tailored empty state when the user filtered to "Added by you" and
      // came up empty — direct them to the action that creates one.
      const msg = this.filters.source === 'mine'
        ? `You haven't uploaded any pro replays yet — promote one from <strong>Your replays</strong> on the homepage.`
        : 'No pro replays match these filters.';
      out.innerHTML = `<div class="acp-empty">${msg}</div>`;
      return;
    }

    out.innerHTML = this._mapGroupedHtml(results);

    out.querySelectorAll('.acp-result-row').forEach(row => {
      const action = row.querySelector('.acp-result-action');
      action.addEventListener('click', (e) => {
        e.preventDefault();
        const id = row.dataset.replayId;
        const slot = row.dataset.slot;
        const entry = this.entries.find(en => en.replayId === id && String(en.playerSlot) === String(slot));
        if (entry) {
          this.close();
          if (typeof this.onPick === 'function') this.onPick(entry);
        }
      });
    });
  }

  // Group results by NORMALIZED map name, then sort each group by player
  // name. Header carries the map's gridmap.jpg as a 56×40 thumbnail —
  // same convention as `_chooserMapGroupedHtml` in CompareInline.
  _mapGroupedHtml (results) {
    const resolveMap = (window.CompareInline && window.CompareInline.resolveMap)
      || ((raw) => ({ displayName: raw || 'Unknown map', folderName: null, iconUrl: null }));
    const raceIconUrl = (window.CompareInline && window.CompareInline.raceIconUrl)
      || ((race) => race ? `/assets/wc3icons/${race}.jpg` : '');
    const RACE_LONG = (window.CompareInline && window.CompareInline.RACE_LONG)
      || { H: 'Human', O: 'Orc', E: 'Night Elf', U: 'Undead', R: 'Random' };

    // Build the groups.
    const groups = new Map();
    for (const e of results) {
      const map = resolveMap(e.map);
      const key = map.displayName || 'Unknown map';
      if (!groups.has(key)) groups.set(key, { displayName: key, iconUrl: map.iconUrl, items: [] });
      groups.get(key).items.push(e);
    }
    const sorted = Array.from(groups.values())
      .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));

    return sorted.map(group => {
      const headerIcon = group.iconUrl
        ? `<img class="ci-chooser-mapgroup-icon" src="${escapeAttr(group.iconUrl)}" alt="" loading="lazy" onerror="this.classList.add('ci-chooser-mapgroup-icon-fail')"/>`
        : '<span class="ci-chooser-mapgroup-icon ci-chooser-mapgroup-icon-fail" aria-hidden="true"></span>';
      const items = group.items.slice().sort((a, b) =>
        String(a.playerName || '').localeCompare(String(b.playerName || ''), undefined, { sensitivity: 'base' })
      );
      const rows = items.map(e => this._rowHtml(e, raceIconUrl, RACE_LONG)).join('');
      return `
        <section class="ci-chooser-mapgroup">
          <header class="ci-chooser-mapgroup-head">
            ${headerIcon}
            <div class="ci-chooser-mapgroup-meta">
              <div class="ci-chooser-mapgroup-name">${escapeHtml(group.displayName)}</div>
              <div class="ci-chooser-mapgroup-count">${items.length} ${items.length === 1 ? 'replay' : 'replays'}</div>
            </div>
          </header>
          <div class="ci-chooser-mapgroup-list acp-result-list">${rows}</div>
        </section>
      `;
    }).join('');
  }

  // One row per entry. For per-slot duplicates (1v1 user upload → two
  // entries under the same map), the opponent race icon + name make
  // each row distinct: row A shows "Happy vs [NE icon] Moon" and
  // row B shows "Moon vs [UD icon] Happy".
  _rowHtml (e, raceIconUrl, RACE_LONG) {
    const oppRace = e.opponentRace
      || (e.buildMatchups && e.buildMatchups[0] && e.buildMatchups[0].length === 3
            ? e.buildMatchups[0].charAt(2)
            : null);
    const oppLabel = oppRace ? (RACE_LONG[oppRace] || oppRace) : 'unknown';
    const oppIconUrl = oppRace ? raceIconUrl(oppRace) : '';
    const oppIcon = oppIconUrl
      ? `<img class="ci-chooser-opt-vs-icon race-${escapeAttr(oppRace)}" src="${escapeAttr(oppIconUrl)}" alt="vs ${escapeAttr(oppLabel)}" title="vs ${escapeAttr(oppLabel)}" onerror="this.classList.add('ci-chooser-opt-vs-icon-fail')"/>`
      : `<span class="ci-chooser-opt-vs-icon ci-chooser-opt-vs-icon-fail" title="vs unknown race" aria-hidden="true"></span>`;
    const refStar = e.isUserReference
      ? `<span class="acp-result-mine" title="Pro replay you uploaded">★ Yours</span>`
      : '';
    const buildTag = e.buildName
      ? `<span class="acp-result-build">${escapeHtml(e.buildName)}</span>`
      : '';
    const tournamentTag = e.tournament
      ? `<span class="acp-result-tournament">${escapeHtml(e.tournament)}</span>`
      : '';
    const stageTag = e.stage
      ? `<span class="acp-result-stage">${escapeHtml(e.stage)}</span>`
      : '';

    return `
      <div class="acp-result-row" data-replay-id="${escapeAttr(e.replayId)}" data-slot="${escapeAttr(e.playerSlot)}">
        <div class="acp-result-vs">
          <span class="acp-result-vs-label" aria-hidden="true">vs</span>
          ${oppIcon}
        </div>
        <div class="acp-result-identity">
          <div class="acp-result-name">
            <span class="acp-result-player">${escapeHtml(e.playerName || '?')}</span>
            <span class="acp-result-vs-text">vs</span>
            <span class="acp-result-opponent">${escapeHtml(e.opponentName || '?')}</span>
            ${refStar}
          </div>
          <div class="acp-result-meta">
            ${buildTag}
            ${tournamentTag}
            ${stageTag}
          </div>
        </div>
        <button class="acp-result-action" type="button">${escapeHtml(this.actionLabel)}</button>
      </div>
    `;
  }
};

const unique = (arr) => Array.from(new Set(arr));
// Aliases into client/js/Security.js — single source of truth for HTML escaping.
const escapeHtml = Security.escapeHtml;
const escapeAttr = Security.escapeAttr;

if (typeof window !== 'undefined') window.AdvancedComparePicker = AdvancedComparePicker;
})();
