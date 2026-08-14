/**
 * BattleReportRenderer — the persistent Battles panel: a collapsible list in
 * the DOM (a BottomPanel tab) accumulating every battle with losses,
 * click-to-seek.
 *
 * It is also the ONE place that decides what a fight means. collectSides() and
 * computeVerdict() are public because the on-canvas callout consumes them too:
 * setBattles() builds a finished model per battle and hands it to
 * EventModel.addBattles, which turns each fight into a `battleResult` event so
 * it surfaces in the action feed as an ordinary card. That split is deliberate
 * — the feed card and the panel can never disagree about who won a fight,
 * because they read one computation.
 *
 * Source data: world.battles[*].summary (see lib/BattleSummary.js).
 */

(function () {
  // Engagement-type chip labels.
  const TYPE_LABELS = {
    campClear: 'Camp',
    creepJack: 'Creep Jack',
    baseRaid:  'Base Raid',
    defense:   'Defense',
    heroSnipe: 'Hero Snipe',
    wipe:      'Wipe',
    harass:    'Harass',
    skirmish:  'Skirmish'
  };

  // Plain-language descriptions — surfaced as chip tooltips and in the legend
  // so a spectator who has never seen these terms can still follow along.
  const TYPE_DESC = {
    campClear: 'Cleared a neutral creep camp',
    creepJack: 'Caught the enemy while they were creeping',
    baseRaid:  'Fight in/around a base — buildings were involved',
    defense:   'Held off an attack on the base',
    heroSnipe: 'A hero went down — usually a game-swinging moment',
    wipe:      'One side lost their whole army (5+ units)',
    harass:    'A quick poke — little was committed',
    skirmish:  'An open-field army clash'
  };

  // Verdict tuning. A fight is a trade; the side that lost less "wins" it.
  // Hero deaths barely register in gold terms but swing games, so we weight
  // each one heavily when scoring the trade.
  const HERO_DEATH_VALUE = 350;   // gold-equivalent swing of losing a hero
  const DECISIVE_RATIO   = 0.40;  // winner lost <=40% of loser's value
  const FAVORABLE_RATIO  = 0.72;  // winner lost <=72% of loser's value
  const WEIGHT_LG = 800;          // total trade value that reads as a big fight
  const WEIGHT_MD = 250;

  // Trip indicator descriptors. icon uses inline SVG so we don't need yet
  // more asset files; emoji fallback for terseness in cramped layouts.
  const TRIP_DESCRIPTORS = [
    { key: 'fountain', title: 'Fountain heal/mana', icon: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 3l3 5h-2v4h-2V8H9l3-5zm-5 13h10l-2 5H9l-2-5z" fill="#5ECCFF"/></svg>' },
    { key: 'shop',     title: 'Shop visit',          icon: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 8h16l-1 12H5L4 8zm3-3a3 3 0 0 1 6 0v3h-2V5a1 1 0 0 0-2 0v3H7V5zm6 0a3 3 0 0 1 6 0v3h-2V5a1 1 0 0 0-2 0v3h-2V5z" fill="#FFD43B"/></svg>' },
    { key: 'moonwell', title: 'Moonwell',            icon: '<svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="8" fill="none" stroke="#A0E0FF" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="#A0E0FF"/></svg>' },
    { key: 'base',     title: 'Returned to base',    icon: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M3 11l9-7 9 7v9H3v-9z" fill="#8AE890"/></svg>' },
    { key: 'expansion',title: 'To/from expansion',   icon: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 2l3 6 6 1-4 5 1 6-6-3-6 3 1-6-4-5 6-1 3-6z" fill="#FFB347"/></svg>' },
    { key: 'disengage',title: 'Disengaged / fled',   icon: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M14 5l-7 7 7 7v-4h5v-6h-5V5z" fill="#B0B0B0"/></svg>' },
    { key: 'reengage', title: 'Re-engaged',          icon: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 4a8 8 0 1 1-7.5 5.2l2 .8A6 6 0 1 0 12 6V3l5 4-5 4V4z" fill="#FF8AAB"/></svg>' }
  ];

  function formatTime (ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return m + ':' + (r < 10 ? '0' + r : r);
  }

  // Thousands separator. Resource totals in a fight run to four digits and
  // "1150g" reads as noise next to "1,150g".
  function fmtNum (n) {
    const v = Math.round(n || 0);
    return v >= 1000 ? v.toLocaleString('en-US') : String(v);
  }

  class BattleReportRenderer {
    constructor (viewer) {
      this.viewer = viewer;
      this._battles = [];
      this._listEl = null;
      this._panelBuilt = false;
      this._lastPanelGameTime = -1;
    }

    // Container the panel will render its battle list inside. Provided by
    // BottomPanel as a tab content element.
    setContainer (containerEl) {
      this._listEl = containerEl;
      this._listEl.classList.add('brp-list');
      this._panelBuilt = false;
    }

    // Called by app.js once world data is loaded.
    setBattles (battles) {
      this._battles = (battles || []).filter(b => b && b.summary && b.summary.hasLosses);
      this._panelBuilt = false;
      this._metaCache = new Map();
    }

    // --------------------------------------------------------------
    // Persistent panel
    // --------------------------------------------------------------

    buildPanel () {
      if (!this._listEl || this._panelBuilt) return;
      this._listEl.innerHTML = '';

      if (!this._battles.length) {
        const empty = document.createElement('div');
        empty.className = 'brp-empty';
        empty.textContent = 'No battles with losses were detected in this game.';
        this._listEl.appendChild(empty);
        this._panelBuilt = true;
        return;
      }

      // Match-wide scoreboard first — "who is winning the fight trade".
      const sb = this._buildScoreboard();
      if (sb) this._listEl.appendChild(sb);

      // Reference key for the jargon — collapsed by default.
      this._listEl.appendChild(this._buildLegend());

      // One card per fight.
      for (const battle of this._battles) {
        this._listEl.appendChild(this._buildFightRow(battle));
      }
      this._panelBuilt = true;
    }

    // ----- player identity --------------------------------------------------

    // Resolve a parser playerId to display metadata (canonical name, race,
    // colour, race-icon id). Cached; falls back gracefully if the viewer
    // hasn't wired players yet.
    _playerMeta (playerId) {
      const key = String(playerId);
      if (!this._metaCache) this._metaCache = new Map();
      if (this._metaCache.has(key)) return this._metaCache.get(key);

      let meta = {
        name: 'Player ' + key, race: null, color: '#888',
        raceLabel: '', accent: '#888', raceIconId: '', isNeutral: false
      };
      const players = (this.viewer && this.viewer.players) || [];
      const cp = players.find(p => String(p.playerId) === key);
      if (cp) {
        let nm = cp.displayName || ('Player ' + key);
        if (typeof PlayerNames !== 'undefined' && PlayerNames.canonical) nm = PlayerNames.canonical(nm);
        if (typeof Security !== 'undefined' && Security.sanitizeUserText) nm = Security.sanitizeUserText(nm);
        const rl = (typeof RaceLabels !== 'undefined' && RaceLabels[cp.race]) || null;
        const starters = (window.BuildOrderData && BuildOrderData.CONFIG &&
                          BuildOrderData.CONFIG.raceStarterIcons) || {};
        meta = {
          name: nm || ('Player ' + key),
          race: cp.race,
          color: cp.playerColor || '#888',
          raceLabel: (rl && rl.label) || cp.race || '',
          accent: (rl && rl.accent) || cp.playerColor || '#888',
          raceIconId: starters[cp.race] || '',
          isNeutral: !!cp.isNeutralPlayer
        };
      }
      this._metaCache.set(key, meta);
      return meta;
    }

    // ----- trade model ------------------------------------------------------

    // Build the two (or more) sides of a fight from battle.participants —
    // the FULL roster, including a player who lost nothing — and fold in
    // each side's losses from summary.perPlayer. This is what lets us show a
    // real head-to-head trade and name the winner; perPlayer alone only ever
    // lists the side(s) that took losses.
    // Public: EventModel.addBattles builds its feed cards from this, so the
    // action feed and the Battles tab can never disagree about a fight.
    collectSides (battle) {
      const summary = battle.summary || {};
      const perPlayer = summary.perPlayer || {};
      const recs = new Map();

      const ensureRec = (pid, teamId) => {
        const k = String(pid);
        let r = recs.get(k);
        if (!r) {
          r = {
            playerId: k, teamId: (teamId != null ? teamId : null),
            meta: this._playerMeta(pid), role: 'participant',
            loss: { count: 0, gold: 0, lumber: 0, food: 0, heroes: 0 },
            units: [], heroNames: []
          };
          recs.set(k, r);
        }
        if (r.teamId == null && teamId != null) r.teamId = teamId;
        return r;
      };

      for (const part of (battle.participants || [])) {
        const r = ensureRec(part.playerId, part.teamId);
        if (part.role === 'initiator') r.role = 'initiator';
      }
      for (const [pid, pp] of Object.entries(perPlayer)) {
        const r = ensureRec(pid, pp.teamId);
        const d = pp.definite || {}, e = pp.estimated || {};
        r.loss.count  += (d.count || 0) + (e.count || 0);
        r.loss.gold   += (d.gold || 0) + (e.gold || 0);
        r.loss.lumber += (d.lumber || 0) + (e.lumber || 0);
        r.loss.food   += (d.food || 0) + (e.food || 0);
        r.loss.heroes += (pp.heroDeaths || []).length;
        for (const u of (d.units || [])) r.units.push({ ...u, estimated: false });
        for (const u of (e.units || [])) r.units.push({ ...u, estimated: true });
        for (const h of (pp.heroDeaths || [])) r.heroNames.push(h.displayName);
      }

      // Drop neutral combatants (creeps) — they aren't a "side" in the trade.
      const live = [...recs.values()].filter(r => !(r.meta && r.meta.isNeutral));
      if (!live.length) return [];

      // Group players into sides by team (fallback: each player is their own).
      const groups = new Map();
      for (const r of live) {
        const gkey = (r.teamId != null) ? ('T' + r.teamId) : ('P' + r.playerId);
        let g = groups.get(gkey);
        if (!g) {
          g = {
            key: gkey, teamId: r.teamId, players: [],
            loss: { count: 0, gold: 0, lumber: 0, food: 0, heroes: 0 },
            units: [], heroNames: []
          };
          groups.set(gkey, g);
        }
        g.players.push(r);
        g.loss.count += r.loss.count; g.loss.gold += r.loss.gold;
        g.loss.lumber += r.loss.lumber; g.loss.food += r.loss.food;
        g.loss.heroes += r.loss.heroes;
        for (const u of r.units) g.units.push(u);
        for (const h of r.heroNames) g.heroNames.push(h);
      }

      const sides = [...groups.values()];
      for (const s of sides) {
        s.value = s.loss.gold + s.loss.lumber + s.loss.heroes * HERO_DEATH_VALUE;
        s.name = s.players.map(p => p.meta.name).join(' / ');
        s.color = s.players[0].meta.color;
      }
      sides.sort((a, b) => {
        const ta = a.teamId == null ? 9999 : a.teamId;
        const tb = b.teamId == null ? 9999 : b.teamId;
        if (ta !== tb) return ta - tb;
        return a.players[0].playerId > b.players[0].playerId ? 1 : -1;
      });
      return sides;
    }

    // Reduce a fight's sides to an outcome verdict. The side that lost less
    // value wins; how lopsided decides decisive / favorable / even.
    computeVerdict (sides) {
      if (!sides.length) return null;
      if (sides.length === 1) return { kind: 'solo', side: sides[0] };

      const sorted = sides.slice().sort((a, b) => a.value - b.value);
      const winner = sorted[0];
      const loser = sorted[sorted.length - 1];
      const wv = winner.value, lv = loser.value;

      let tier, label;
      if (wv === 0 && lv === 0) { tier = 'even'; label = 'No losses'; }
      else if (wv === 0)        { tier = 'decisive'; label = 'Clean win'; }
      else {
        const ratio = wv / lv;
        if (ratio <= DECISIVE_RATIO)       { tier = 'decisive'; label = 'Decisive'; }
        else if (ratio <= FAVORABLE_RATIO) { tier = 'favorable'; label = 'Favorable'; }
        else                               { tier = 'even'; label = 'Even trade'; }
      }
      return {
        kind: 'trade', winner, loser, tier, label,
        margin: Math.max(0, lv - wv),
        heroSwing: loser.loss.heroes > 0
      };
    }

    // ----- fight card -------------------------------------------------------

    _buildFightRow (battle) {
      const summary = battle.summary;
      const type = summary.engagementType || 'skirmish';
      const sides = this.collectSides(battle);
      const verdict = this.computeVerdict(sides);
      const totalVal = sides.reduce((a, s) => a + s.value, 0);

      const row = document.createElement('div');
      row.className = 'brp-fight brp-type-' + type;
      if (summary.hasHeroDeath) row.classList.add('brp-has-hero');
      if (verdict) row.classList.add('brp-w-' + (verdict.tier || verdict.kind));
      row.classList.add(totalVal >= WEIGHT_LG ? 'brp-wt-lg'
                      : totalVal >= WEIGHT_MD ? 'brp-wt-md' : 'brp-wt-sm');
      row.dataset.battleId = battle.id;

      // Header — type chip (with tooltip) · start time · duration.
      const head = document.createElement('div');
      head.className = 'brp-fh';
      const chip = document.createElement('span');
      chip.className = 'brp-chip brp-chip-' + type;
      chip.textContent = TYPE_LABELS[type] || type;
      chip.title = TYPE_DESC[type] || '';
      head.appendChild(chip);
      const time = document.createElement('span');
      time.className = 'brp-fh-time';
      time.textContent = formatTime(battle.startTime);
      head.appendChild(time);
      const dur = document.createElement('span');
      dur.className = 'brp-fh-dur';
      dur.textContent = Math.round((summary.durationMs || 0) / 1000) + 's';
      head.appendChild(dur);
      row.appendChild(head);

      // Head-to-head sides, stacked.
      const winnerKey = (verdict && verdict.kind === 'trade' && verdict.tier !== 'even')
        ? verdict.winner.key : null;
      const arena = document.createElement('div');
      arena.className = 'brp-arena';
      sides.forEach((side, i) => {
        if (i > 0) {
          const vs = document.createElement('div');
          vs.className = 'brp-vs';
          vs.textContent = 'vs';
          arena.appendChild(vs);
        }
        arena.appendChild(this._buildSideCell(side, side.key === winnerKey,
                                              summary.trips || {}));
      });
      row.appendChild(arena);

      // Outcome verdict.
      row.appendChild(this._buildVerdictBar(verdict, type));

      row.addEventListener('click', () => {
        if (this.viewer && typeof this.viewer.seekToGameTime === 'function') {
          this.viewer.seekToGameTime(battle.startTime);
        } else if (this.viewer && typeof this.viewer.seek === 'function') {
          this.viewer.seek(battle.startTime);
        }
      });
      return row;
    }

    _buildSideCell (side, isWinner, trips) {
      const meta0 = side.players[0].meta;
      const cell = document.createElement('div');
      cell.className = 'brp-side' + (isWinner ? ' brp-side-win' : '');
      cell.style.setProperty('--brp-side-color', side.color || '#888');

      // Identity line: colour chip · name · race tag · (WON) ........ losses.
      const top = document.createElement('div');
      top.className = 'brp-side-top';

      const id = document.createElement('div');
      id.className = 'brp-side-id';

      const sw = document.createElement('span');
      sw.className = 'brp-side-swatch';
      sw.style.background = side.color || '#888';
      id.appendChild(sw);

      const name = document.createElement('span');
      name.className = 'brp-side-name';
      name.textContent = side.name;
      id.appendChild(name);

      if (meta0.raceLabel) {
        const rl = document.createElement('span');
        rl.className = 'brp-side-racelbl';
        rl.textContent = meta0.raceLabel;
        id.appendChild(rl);
      }
      if (isWinner) {
        const won = document.createElement('span');
        won.className = 'brp-side-wontag';
        won.textContent = 'WON';
        id.appendChild(won);
      }
      top.appendChild(id);

      const loss = document.createElement('span');
      loss.className = 'brp-side-loss';
      if (side.loss.count > 0) {
        const n = document.createElement('strong');
        n.textContent = 'lost ' + side.loss.count;
        loss.appendChild(n);
        const val = document.createElement('span');
        val.className = 'brp-side-cost';
        val.textContent = side.loss.gold + 'g'
          + (side.loss.lumber > 0 ? ' ' + side.loss.lumber + 'l' : '');
        loss.appendChild(val);
      } else {
        loss.classList.add('brp-side-loss-none');
        loss.textContent = 'no losses';
      }
      top.appendChild(loss);
      cell.appendChild(top);

      // Hero deaths called out — they swing games.
      if (side.heroNames.length) {
        const hd = document.createElement('div');
        hd.className = 'brp-side-hero';
        hd.textContent = '☠ ' + side.heroNames.join(', ') + ' down';
        cell.appendChild(hd);
      }

      // Lost-unit icons + behavioural trips share one detail row.
      const pTrips = {};
      let anyTrip = false;
      for (const p of side.players) {
        const t = trips[p.playerId];
        if (!t) continue;
        for (const k in t) { pTrips[k] = (pTrips[k] || 0) + t[k]; if (t[k]) anyTrip = true; }
      }

      if (side.units.length || anyTrip) {
        const detail = document.createElement('div');
        detail.className = 'brp-side-detail';
        for (const u of side.units) detail.appendChild(this._unitIconChip(u, u.estimated));
        if (anyTrip) {
          for (const d of TRIP_DESCRIPTORS) {
            const n = pTrips[d.key];
            if (!n) continue;
            const t = document.createElement('span');
            t.className = 'brp-trip';
            t.title = d.title + (n > 1 ? ' × ' + n : '');
            t.innerHTML = d.icon + (n > 1 ? '<i>' + n + '</i>' : '');
            detail.appendChild(t);
          }
        }
        cell.appendChild(detail);
      }

      return cell;
    }

    _buildVerdictBar (verdict, type) {
      const bar = document.createElement('div');
      bar.className = 'brp-verdict';
      if (!verdict) { bar.classList.add('brp-v-even'); bar.textContent = '—'; return bar; }

      if (verdict.kind === 'solo') {
        const s = verdict.side;
        let text, tier;
        if (type === 'campClear')      { text = s.name + ' cleared a camp'; tier = 'good'; }
        else if (type === 'creepJack') { text = s.name + ' got creep-jacked'; tier = 'bad'; }
        else if (s.loss.count === 0)   { text = s.name + ' — no losses'; tier = 'good'; }
        else                           { text = s.name + ' lost ' + s.loss.count; tier = 'bad'; }
        bar.classList.add(tier === 'good' ? 'brp-v-good' : 'brp-v-bad');
        const lbl = document.createElement('span');
        lbl.className = 'brp-v-label';
        lbl.textContent = text;
        bar.appendChild(lbl);
        return bar;
      }

      bar.classList.add('brp-v-' + verdict.tier);
      if (verdict.tier === 'even') {
        const lbl = document.createElement('span');
        lbl.className = 'brp-v-label';
        lbl.textContent = (verdict.label === 'No losses') ? 'No losses' : '≈ Even trade';
        bar.appendChild(lbl);
        return bar;
      }

      const arrow = document.createElement('span');
      arrow.className = 'brp-v-arrow';
      arrow.textContent = '▸';
      bar.appendChild(arrow);

      const sw = document.createElement('span');
      sw.className = 'brp-v-swatch';
      sw.style.background = verdict.winner.color || '#888';
      bar.appendChild(sw);

      const lbl = document.createElement('span');
      lbl.className = 'brp-v-label';
      lbl.textContent = (verdict.heroSwing ? '☠ ' : '') + verdict.label + ' — ' + verdict.winner.name;
      bar.appendChild(lbl);

      if (verdict.margin > 0) {
        const m = document.createElement('span');
        m.className = 'brp-v-margin';
        m.textContent = '+' + verdict.margin;
        m.title = 'Net resource value lead (gold + lumber; hero deaths weighted)';
        bar.appendChild(m);
      }
      return bar;
    }

    // ----- match-wide scoreboard -------------------------------------------

    _buildScoreboard () {
      // Aggregate every fight into per-team totals.
      const teams = new Map();
      let evenCount = 0;
      for (const battle of this._battles) {
        const sides = this.collectSides(battle);
        const verdict = this.computeVerdict(sides);
        for (const s of sides) {
          let t = teams.get(s.key);
          if (!t) {
            t = { key: s.key, name: s.name, color: s.color,
                  raceLabel: s.players[0].meta.raceLabel,
                  raceIconId: s.players[0].meta.raceIconId,
                  gold: 0, units: 0, heroes: 0, won: 0 };
            teams.set(s.key, t);
          }
          // Real resources for display; hero weighting only ever drives the
          // win tally (via _computeVerdict) — never the gold number we print.
          t.gold += s.loss.gold + s.loss.lumber;
          t.units += s.loss.count;
          t.heroes += s.loss.heroes;
        }
        if (verdict && verdict.kind === 'trade') {
          if (verdict.tier === 'even') evenCount++;
          else {
            const w = teams.get(verdict.winner.key);
            if (w) w.won++;
          }
        }
      }

      const list = [...teams.values()];
      if (!list.length) return null;

      const box = document.createElement('div');
      box.className = 'brp-scoreboard';

      const hd = document.createElement('div');
      hd.className = 'brp-sb-head';
      const title = document.createElement('span');
      title.className = 'brp-sb-title';
      title.textContent = 'Fight Trade';
      hd.appendChild(title);
      const count = document.createElement('span');
      count.className = 'brp-sb-count';
      count.textContent = this._battles.length + (this._battles.length === 1 ? ' battle' : ' battles');
      hd.appendChild(count);
      box.appendChild(hd);

      const maxVal = Math.max(1, ...list.map(t => t.gold));
      for (const t of list) {
        const rowEl = document.createElement('div');
        rowEl.className = 'brp-sb-row';

        const sw = document.createElement('span');
        sw.className = 'brp-sb-swatch';
        sw.style.background = t.color || '#888';
        rowEl.appendChild(sw);

        const nm = document.createElement('span');
        nm.className = 'brp-sb-name';
        nm.textContent = t.name + (t.raceLabel ? ' (' + t.raceLabel + ')' : '');
        rowEl.appendChild(nm);

        const stat = document.createElement('span');
        stat.className = 'brp-sb-stat';
        stat.textContent = 'lost ' + t.gold + 'g · ' + t.units + ' units'
          + (t.heroes ? ' · ' + t.heroes + ' ☠' : '');
        rowEl.appendChild(stat);

        const won = document.createElement('span');
        won.className = 'brp-sb-won';
        won.textContent = t.won + ' won';
        rowEl.appendChild(won);

        const track = document.createElement('div');
        track.className = 'brp-sb-track';
        const fill = document.createElement('div');
        fill.className = 'brp-sb-fill';
        fill.style.width = Math.round((t.gold / maxVal) * 100) + '%';
        track.appendChild(fill);
        rowEl.appendChild(track);

        box.appendChild(rowEl);
      }

      // Lead line — whoever lost the least leads the trade (2-team case).
      if (list.length === 2) {
        const a = list[0], b = list[1];
        const leader = a.gold <= b.gold ? a : b;
        const trailer = leader === a ? b : a;
        const lead = trailer.gold - leader.gold;
        const verdict = document.createElement('div');
        verdict.className = 'brp-sb-verdict';
        verdict.textContent = lead === 0
          ? 'Dead even on the fight trade so far'
          : leader.name + ' leads the trade  +' + lead + 'g';
        box.appendChild(verdict);
      }

      return box;
    }

    // ----- legend -----------------------------------------------------------

    _buildLegend () {
      const det = document.createElement('details');
      det.className = 'brp-legend';
      const sum = document.createElement('summary');
      sum.textContent = 'What do these mean?';
      det.appendChild(sum);

      const types = document.createElement('div');
      types.className = 'brp-legend-grid';
      for (const key of Object.keys(TYPE_LABELS)) {
        const item = document.createElement('div');
        item.className = 'brp-legend-item';
        const chip = document.createElement('span');
        chip.className = 'brp-chip brp-chip-' + key;
        chip.textContent = TYPE_LABELS[key];
        item.appendChild(chip);
        const desc = document.createElement('span');
        desc.className = 'brp-legend-desc';
        desc.textContent = TYPE_DESC[key] || '';
        item.appendChild(desc);
        types.appendChild(item);
      }
      det.appendChild(types);

      const tripHd = document.createElement('div');
      tripHd.className = 'brp-legend-sub';
      tripHd.textContent = 'During-fight movement';
      det.appendChild(tripHd);

      const tg = document.createElement('div');
      tg.className = 'brp-legend-grid';
      for (const d of TRIP_DESCRIPTORS) {
        const item = document.createElement('div');
        item.className = 'brp-legend-item';
        const ic = document.createElement('span');
        ic.className = 'brp-legend-trip';
        ic.innerHTML = d.icon;
        item.appendChild(ic);
        const desc = document.createElement('span');
        desc.className = 'brp-legend-desc';
        desc.textContent = d.title;
        item.appendChild(desc);
        tg.appendChild(item);
      }
      det.appendChild(tg);

      return det;
    }

    _unitIconChip (unit, estimated) {
      const w = document.createElement('span');
      w.className = 'brp-uic';
      if (estimated) w.classList.add('brp-uic-est');
      if (unit.isHero) w.classList.add('brp-uic-hero');
      const img = document.createElement('img');
      img.src = '/assets/wc3icons/' + unit.itemId + '.jpg';
      img.alt = unit.displayName;
      img.title = (unit.isHero ? '★ ' : '') + unit.count + '× ' + unit.displayName +
                  (estimated ? ' (likely)' : '');
      img.onerror = function () { this.style.display = 'none'; };
      w.appendChild(img);
      if (unit.count > 1) {
        const c = document.createElement('i');
        c.className = 'brp-uic-n';
        c.textContent = unit.count;
        w.appendChild(c);
      }
      return w;
    }

    // Highlight the row whose battle is currently active.
    syncPanel (gameTime) {
      if (!this._listEl) return;
      if (gameTime === this._lastPanelGameTime) return;
      // Wall-clock throttle. A game-time gate fires every frame once playback
      // is fast enough that one frame advances past the threshold — and this
      // path does a querySelectorAll plus a scrollIntoView, which forces
      // layout. A scrub still syncs immediately.
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const seeked = Math.abs(gameTime - this._lastPanelGameTime) > 2000;
      if (!seeked && (now - (this._lastPanelWall || 0)) < 250) return;
      this._lastPanelWall = now;
      this._lastPanelGameTime = gameTime;
      let activeId = null;
      for (const b of this._battles) {
        if (gameTime >= b.startTime - 1000 && gameTime <= b.endTime + 6000) {
          activeId = String(b.id);
          break;
        }
      }
      const rows = this._listEl.querySelectorAll('.brp-fight');
      let activeEl = null;
      rows.forEach(r => {
        if (r.dataset.battleId === activeId) {
          r.classList.add('brp-active');
          activeEl = r;
        } else {
          r.classList.remove('brp-active');
        }
      });
      if (activeEl && typeof activeEl.scrollIntoView === 'function') {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  window.BattleReportRenderer = BattleReportRenderer;
})();
