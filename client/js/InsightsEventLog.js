/**
 * InsightsEventLog — the panel half of the unified event system.
 *
 * Lives as the "Events" tab in the BottomPanel and renders the FULL match as a
 * scrollable, filterable log: every normalized EventModel row (high- and low-
 * signal) interleaved with battle markers, time-sorted. It reuses the exact
 * `ev-` row markup the right-edge feed uses (EventModel.buildRowEl), so the
 * canvas feed and this panel read as one consistent system.
 *
 * Every row carries a category + tags, so the filter bar can show/hide by
 * category today and gain finer filters later with no markup change.
 *
 * Rows are click-to-seek; the row nearest the current playback time is
 * highlighted and scrolled into view as the replay advances.
 */

const InsightsEventLog = class {

  constructor (viewer) {
    this.viewer = viewer;
    this.model = null;
    this.rows = [];              // combined { gameTime, category, el, kind }
    this.battles = [];

    this.containerEl = null;
    this.filterBarEl = null;
    this.listEl = null;

    this.activeFilters = new Set();   // empty = show all
    this._built = false;
    this._lastSyncTime = -1;
    this._activeEl = null;
  }

  setModel (model) { this.model = model; this._built = false; }

  // Raw mapData.battles — we keep only ones with real losses, same gate the
  // battle report uses.
  setBattles (battles) {
    this.battles = (battles || []).filter(b => b && b.summary && b.summary.hasLosses);
    this._built = false;
  }

  setContainer (el) {
    this.containerEl = el;
    this.containerEl.classList.add('ev-log');

    this.filterBarEl = document.createElement('div');
    this.filterBarEl.className = 'ev-filterbar';
    this.containerEl.appendChild(this.filterBarEl);

    this.listEl = document.createElement('div');
    this.listEl.className = 'ev-log-list';
    this.containerEl.appendChild(this.listEl);

    this._built = false;
  }

  // ---------------------------------------------------------------------------

  build () {
    if (!this.listEl || this._built) return;
    if (!this.model) return;

    this.rows = [];
    this.listEl.innerHTML = '';

    const combined = [];

    // Event rows.
    for (const ev of this.model.events) {
      const el = window.EventModel.buildRowEl(ev, {
        showTime: true,
        seekable: true,
        onSeek: (t) => this._seek(t)
      });
      combined.push({ gameTime: ev.gameTime, category: ev.category, el, kind: 'event' });
    }

    // Battle marker rows.
    for (const b of this.battles) {
      const el = this._buildBattleRow(b);
      combined.push({
        gameTime: b.startTime || 0,
        category: 'combat',
        el,
        kind: 'battle',
        battleId: b.id
      });
    }

    combined.sort((a, b) => a.gameTime - b.gameTime);
    const frag = document.createDocumentFragment();
    for (const r of combined) frag.appendChild(r.el);
    this.listEl.appendChild(frag);
    this.rows = combined;

    this._buildFilterBar();
    this._applyFilters();
    this._built = true;
  }

  _buildFilterBar () {
    if (!this.filterBarEl) return;
    this.filterBarEl.innerHTML = '';

    // Categories actually present, in a stable order.
    const order = ['combat', 'progression', 'economy', 'logistics', 'scouting'];
    const present = new Set(this.rows.map(r => r.category));
    const cats = order.filter(c => present.has(c));

    const labelOf = window.EventModel.CATEGORY_LABEL || {};
    const colorOf = window.EventModel.CATEGORY_COLOR || {};

    for (const cat of cats) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'ev-filter ev-filter-' + cat;
      chip.dataset.cat = cat;
      chip.textContent = labelOf[cat] || cat;
      chip.style.setProperty('--ev-cat-color', colorOf[cat] || '#888');
      chip.addEventListener('click', () => this._toggleFilter(cat, chip));
      this.filterBarEl.appendChild(chip);
    }
  }

  _toggleFilter (cat, chip) {
    if (this.activeFilters.has(cat)) {
      this.activeFilters.delete(cat);
      chip.classList.remove('ev-filter-on');
    } else {
      this.activeFilters.add(cat);
      chip.classList.add('ev-filter-on');
    }
    this._applyFilters();
  }

  _applyFilters () {
    const all = this.activeFilters.size === 0;
    for (const r of this.rows) {
      const show = all || this.activeFilters.has(r.category);
      r.el.classList.toggle('ev-row-hidden', !show);
    }
  }

  // Battle marker — compact ev-row variant. Per-unit loss detail still lives in
  // the richer "Battles" tab; here we surface the trade at a glance.
  _buildBattleRow (battle) {
    const s = battle.summary;
    const type = s.engagementType || 'skirmish';
    const TYPE_LABELS = {
      campClear: 'Camp Clear', creepJack: 'Creep Jack', baseRaid: 'Base Raid',
      defense: 'Defense', heroSnipe: 'Hero Snipe', wipe: 'Wipe',
      harass: 'Harass', skirmish: 'Skirmish'
    };

    const row = document.createElement('div');
    row.className = 'ev-row ev-cat-combat ev-battle ev-seekable';
    row.dataset.category = 'combat';
    row.dataset.tags = 'combat battle loss' + (s.hasHeroDeath ? ' hero-death' : '');
    row.dataset.battleId = battle.id;

    const iconWrap = document.createElement('span');
    iconWrap.className = 'ev-icon ev-icon-empty ev-icon-battle';
    iconWrap.textContent = '⚔';
    row.appendChild(iconWrap);

    const main = document.createElement('div');
    main.className = 'ev-main';

    const line1 = document.createElement('div');
    line1.className = 'ev-line1';
    const title = document.createElement('span');
    title.className = 'ev-title';
    title.textContent = TYPE_LABELS[type] || type;
    line1.appendChild(title);
    if (s.hasHeroDeath) {
      const hd = document.createElement('span');
      hd.className = 'ev-tag ev-tag-herodeath';
      hd.textContent = '★ hero down';
      line1.appendChild(hd);
    }
    main.appendChild(line1);

    // Losses summary + participant swatches.
    const line2 = document.createElement('div');
    line2.className = 'ev-line2';

    let totalLost = 0, food = 0;
    const swatches = [];
    for (const p of Object.values(s.perPlayer)) {
      const lost = (p.definite.count || 0) + (p.estimated.count || 0);
      totalLost += lost;
      food += (p.definite.food || 0) + (p.estimated.food || 0);
      if (lost > 0) swatches.push(p.playerColor || '#888');
    }

    const sw = document.createElement('span');
    sw.className = 'ev-battle-swatches';
    for (const c of swatches) {
      const dot = document.createElement('span');
      dot.className = 'ev-swatch';
      dot.style.background = c;
      sw.appendChild(dot);
    }
    line2.appendChild(sw);

    const meta = document.createElement('span');
    meta.className = 'ev-meta';
    meta.textContent = `✕${totalLost} lost · ${food} food`;
    line2.appendChild(meta);

    const time = document.createElement('span');
    time.className = 'ev-time';
    time.textContent = (typeof formatGameTime === 'function')
      ? formatGameTime(battle.startTime || 0)
      : Math.round((battle.startTime || 0) / 1000) + 's';
    line2.appendChild(time);

    main.appendChild(line2);
    row.appendChild(main);

    row.addEventListener('click', () => this._seek(battle.startTime || 0));
    return row;
  }

  _seek (gameTime) {
    if (this.viewer && typeof this.viewer.seekToGameTime === 'function') {
      this.viewer.seekToGameTime(gameTime);
    } else if (this.viewer && typeof this.viewer.seek === 'function') {
      this.viewer.seek(gameTime);
    }
  }

  // Highlight + reveal the row nearest the current playback time.
  sync (gameTime) {
    if (!this._built || !this.rows.length) return;
    if (Math.abs(gameTime - this._lastSyncTime) < 250) return;
    this._lastSyncTime = gameTime;

    // Last row at-or-before now.
    let target = null;
    for (const r of this.rows) {
      if (r.el.classList.contains('ev-row-hidden')) continue;
      if (r.gameTime > gameTime) break;
      target = r;
    }

    if (this._activeEl) this._activeEl.classList.remove('ev-row-active');
    if (target) {
      target.el.classList.add('ev-row-active');
      this._activeEl = target.el;
    } else {
      this._activeEl = null;
    }
  }
};

window.InsightsEventLog = InsightsEventLog;
