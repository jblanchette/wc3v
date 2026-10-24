/**
 * SelectionEvidence — post-pass that turns the replay's selection lists into
 * per-unit life evidence, for DeathInference.
 *
 * PlayerManager records every selection action into a SelectionLedger while the
 * replay is read. Here the ledger is resolved (per handle: first and last time
 * the game listed it, and when it died if the lists show that), and each player's
 * units are tied to handles with HandleBinder: the ties WC3V made during the
 * simulation where the lists agree, the rest by creation order. Each tied unit
 * gets
 *
 *   unit.selectionLife = { handle, first, last, lastKind, death, lastOrder }
 *
 * which DeathInference reads: a death the lists show ends the unit there, and
 * a later sighting keeps it alive past what its path alone would say.
 */

const HandleBinder = require('./HandleBinder');
const { getUnitInfo, getBuildTime } = require('../helpers/mappings');

const isPlayerId = (id) => Number(id) >= 0 && Number(id) < 24;

class SelectionEvidence {
  constructor (playerManager) {
    this.playerManager = playerManager;
    this.stats = { handles: 0, units: 0, tied: 0, kept: 0, retied: 0, deaths: 0 };
  }

  run () {
    const ledger = this.playerManager.selectionLedger;
    if (!ledger) return this.stats;

    const resolved = ledger.resolve();
    const players = Object.values(this.playerManager.players || {})
      .filter(p => p && !p.isNeutralPlayer && isPlayerId(p.id));

    const anchors = this._anchors(players, resolved);
    this.madeBy = this._madeBy(resolved);

    for (const player of players) {
      const pl = resolved.get(Number(player.id));
      if (!pl) continue;
      this._bindPlayer(player, pl, anchors);
    }
    return this.stats;
  }

  _candidates (player) {
    return (player.units || []).filter(u => u && !u.isBuilding && !u.isIllusion && !u.isInferred);
  }

  _unitHandle (unit) {
    const { itemId1, itemId2 } = unit;
    if (itemId1 == null || itemId2 == null) return null;
    if (Number(itemId1) < 0) return null;            // retired by a recycled handle
    return `${itemId1}/${itemId2}`;
  }

  _born (unit) {
    if (unit.trainedTime != null) return unit.trainedTime;
    return unit.spawnTime || 0;
  }

  // A trained unit came out no earlier than its training time after the order
  // (the queue may have held it longer, or held orders the game refused).
  _earliest (unit) {
    if (unit.trainedTime == null) return unit.spawnTime || 0;
    const queued = unit.spawnTime != null ? unit.spawnTime + getBuildTime(unit.itemId) * 1000 : unit.trainedTime;
    return Math.min(queued, unit.trainedTime);
  }

  _forms (unit) {
    const forms = new Set([unit.itemId]);
    for (const m of (unit.morphHistory || [])) {
      if (m.from) forms.add(m.from);
      if (m.itemId) forms.add(m.itemId);
    }
    return forms;
  }

  // (counter, creation time) pairs from every player's ties that the lists
  // confirm (same type), for the counter → creation time fit.
  _anchors (players, resolved) {
    const anchors = [];
    for (const player of players) {
      const pl = resolved.get(Number(player.id));
      if (!pl) continue;
      for (const unit of this._candidates(player)) {
        const key = this._unitHandle(unit);
        const h = key && pl.handles.get(key);
        if (!h || !h.types.length) continue;
        const forms = this._forms(unit);
        if (!h.types.some(x => HandleBinder.formMatches({ forms }, x.type))) continue;
        anchors.push({ counter: h.counter, born: this._born(unit) });
      }
    }
    return anchors;
  }

  // Latest time a handle can have been made: handles are allocated in order, so
  // before the first sighting of any handle allocated after it (any player's).
  _madeBy (resolved) {
    const hs = [];
    for (const pl of resolved.values()) for (const h of pl.handles.values()) hs.push(h);
    hs.sort((a, b) => a.counter - b.counter);
    const counters = hs.map(h => h.counter);
    const by = new Array(hs.length);
    let m = Infinity;
    for (let i = hs.length - 1; i >= 0; i--) {
      m = Math.min(m, hs[i].first);
      by[i] = m;
    }
    return (counter) => {
      let lo = 0, hi = counters.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (counters[mid] >= counter) hi = mid; else lo = mid + 1;
      }
      return lo < counters.length ? by[lo] : Infinity;
    };
  }

  _bindPlayer (player, pl, anchors) {
    // handles a unit can be: not ones the game named as a building
    const handles = new Map();
    for (const [k, h] of pl.handles) {
      if (h.types.some(x => getUnitInfo(x.type).isBuilding)) continue;
      // Only the player's own units take orders, join control groups or get
      // box-selected with others; a unit only ever clicked on alone is someone
      // else's (an enemy, a creep, a shop).
      if (!h.orders && !h.grouped && !h.multi) continue;
      handles.set(k, h);
    }
    this.stats.handles += handles.size;

    const units = this._candidates(player);
    const entries = units.map((unit, id) => ({
      id,
      unit,
      type: unit.itemId,
      forms: this._forms(unit),
      born: this._born(unit),
      earliest: this._earliest(unit),
      worker: !!(unit.meta && unit.meta.worker),
      handle: this._unitHandle(unit)
    }));
    this.stats.units += entries.length;

    const ties = HandleBinder.bind(entries, handles, anchors, this.madeBy);

    for (const e of entries) {
      const key = ties.get(e.id);
      if (!key) {
        // The player's lists never show this unit. Its path, if any, came
        // from orders to a handle that belongs to another unit.
        e.unit.selectionUnlisted = true;
        continue;
      }
      const h = handles.get(key);
      this.stats.tied++;
      if (key === e.handle) this.stats.kept++;
      else this.stats.retied++;
      if (h.death) this.stats.deaths++;
      e.unit.selectionLife = {
        handle: key,
        first: h.first,
        last: h.last,
        lastKind: h.lastKind,
        death: h.death,
        lastOrder: h.lastOrder
      };
    }
  }
}

module.exports = SelectionEvidence;
