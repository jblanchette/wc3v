(function () {
// AdvancedComparePicker — modal UI for browsing the full pro replay
// library. Filters by race, matchup, opener, tournament. Returns the
// selected pro entry to a callback.
//
// Used by CompareInline when the user clicks "Advanced search". Built as a
// modal overlay so it can stack above the homepage without disturbing the
// inline compare panel.

const AdvancedComparePicker = class {
  constructor ({ matcher, userSummary, userSlot, onPick }) {
    this.matcher = matcher;
    this.userSummary = userSummary;
    this.userSlot = userSlot;
    this.onPick = onPick;
    this.entries = [];
    this.modalEl = null;
    this.filters = { race: 'all', matchup: 'all', opener: 'all', tournament: 'all' };
  }

  async open () {
    this.entries = await this.matcher.loadIndex();
    this._render();
  }

  close () {
    if (this.modalEl) this.modalEl.remove();
    this.modalEl = null;
  }

  _render () {
    if (this.modalEl) this.modalEl.remove();
    const userRace = this.userSummary && this.userSummary.players && this.userSummary.players[this.userSlot] && this.userSummary.players[this.userSlot].race;

    const races = unique(this.entries.map(e => e.buildRace).filter(Boolean));
    const matchups = unique(this.entries.flatMap(e => e.buildMatchups || []));
    const openers = unique(this.entries.map(e => e.buildOpener).filter(Boolean));
    const tournaments = unique(this.entries.map(e => e.tournament).filter(Boolean));

    // Default the race filter to the user's race, since that's the most
    // common case. They can widen.
    if (this.filters.race === 'all' && userRace && races.includes(userRace)) {
      this.filters.race = userRace;
    }

    const m = document.createElement('div');
    m.className = 'acp-modal';
    m.innerHTML = `
      <div class="acp-backdrop"></div>
      <div class="acp-card" role="dialog" aria-modal="true" aria-labelledby="acp-title">
        <div class="acp-head">
          <h2 class="acp-title" id="acp-title">Browse pro replays</h2>
          <button class="acp-close" type="button" aria-label="Close">×</button>
        </div>
        <div class="acp-filters">
          ${this._filterChips('race', 'Race', ['all', ...races])}
          ${this._filterChips('matchup', 'Matchup', ['all', ...matchups])}
          ${this._filterChips('opener', 'Opener', ['all', ...openers])}
          ${tournaments.length ? this._filterChips('tournament', 'Tournament', ['all', ...tournaments]) : ''}
        </div>
        <div class="acp-results" id="acp-results"></div>
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

    // Esc to close.
    const onKey = (e) => { if (e.key === 'Escape') { this.close(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
  }

  _filterChips (dim, label, values) {
    const chips = values.map(v => {
      const active = this.filters[dim] === v;
      const display = v === 'all' ? 'All' : v;
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
      if (this.filters.race !== 'all' && e.buildRace !== this.filters.race) return false;
      if (this.filters.matchup !== 'all' && !(e.buildMatchups || []).includes(this.filters.matchup)) return false;
      if (this.filters.opener !== 'all' && e.buildOpener !== this.filters.opener) return false;
      if (this.filters.tournament !== 'all' && e.tournament !== this.filters.tournament) return false;
      return true;
    });

    const out = this.modalEl.querySelector('#acp-results');
    if (!results.length) {
      out.innerHTML = `<div class="acp-empty">No pro replays match these filters.</div>`;
      return;
    }
    out.innerHTML = results.map(e => `
      <div class="acp-result" data-replay-id="${escapeHtml(e.replayId)}" data-slot="${escapeHtml(e.playerSlot)}">
        <div class="acp-result-icon race-${escapeHtml(e.buildRace || '?')}">${escapeHtml(e.buildRace || '?')}</div>
        <div class="acp-result-body">
          <div class="acp-result-name">${escapeHtml(e.playerName || '?')} <span class="acp-result-vs">vs ${escapeHtml(e.opponentName || '?')}</span></div>
          <div class="acp-result-meta">${escapeHtml(e.buildName || '')} · ${escapeHtml(e.map || '')}${e.stage ? ' · ' + escapeHtml(e.stage) : ''}</div>
        </div>
        <button class="acp-result-pick" type="button">Compare</button>
      </div>
    `).join('');

    out.querySelectorAll('.acp-result').forEach(row => {
      const pick = row.querySelector('.acp-result-pick');
      pick.addEventListener('click', () => {
        const id = row.dataset.replayId;
        const slot = row.dataset.slot;
        const entry = this.entries.find(e => e.replayId === id && String(e.playerSlot) === String(slot));
        if (entry) {
          this.close();
          if (typeof this.onPick === 'function') this.onPick(entry);
        }
      });
    });
  }
};

const unique = (arr) => Array.from(new Set(arr));
// Alias into client/js/Security.js — single source of truth for HTML escaping.
const escapeHtml = Security.escapeHtml;

if (typeof window !== 'undefined') window.AdvancedComparePicker = AdvancedComparePicker;
})();
