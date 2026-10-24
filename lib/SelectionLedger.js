/**
 * SelectionLedger — what the replay's own selection lists say about each unit handle.
 *
 * A replay never says that a unit died. But the unit lists of selection actions
 * (ChangeSelection, PreSubselection, AssignGroupHotkey, SelectSubgroup) are written
 * by the game, not typed by the player, and the game drops dead units from
 * selections and control groups before it writes them. Per player and handle
 * (the objectId pair that names a unit in every action) that gives:
 *
 *   alive    every list that names a handle shows the unit alive at that moment;
 *            so does a click on it (an order targeting it, by anyone);
 *   died     a deselect the game made by itself — alone, with nothing selected
 *            next, of a handle that is never listed again — is the game taking a
 *            unit that just died out of the selection: the death time, exact;
 *   died     a list that should hold a handle and doesn't — the recall of a group
 *            it was in (PreSubselection lists the group as recalled), the
 *            whole-selection deselect of a selection it was in, a group assigned
 *            from a selection it was in, or a full list naming most of the units it
 *            was last listed with — bounds its death: after its last sighting,
 *            before that list. Unless it is listed again later: a unit loaded into
 *            a transport, burrowed or inside a gold mine leaves the lists too.
 *
 * Replays from the 2.0.x / 3.0 clients carry the PreSubselection lists, which
 * name the whole new selection on every selection change, hotkey recalls
 * included. Older ones only list units on mouse selections, so a player who
 * switches by hotkey gets far fewer full lists there.
 *
 * The second number of a handle is the game's object allocation counter: it
 * only grows, so handles also sort by creation (`counter`, used by HandleBinder).
 *
 * Usage: feed every selection action through the recording methods as the
 * replay is read, then resolve() once at the end. resolve() returns
 * Map<playerId, { handles: Map<key, handle> }>; a handle is
 *   { key, counter, first, last, lastKind, types: [{ t, type }], lastOrder,
 *     death: null | { at, from, kind } }
 * where a death happened in (from, at], from === at when it is exact.
 */

const SelectModes = {
  select: 1,
  deselect: 2
};

// Peer rule: a full list naming at least this share of the units a handle was
// last listed with (and at least MIN_PEERS of them), but not the handle itself.
const PEER_SHARE = 0.5;
const MIN_PEERS = 2;

const NO_OBJECT = 4294967295;

const handleKey = (objectId1, objectId2) => `${objectId1}/${objectId2}`;

const isRealHandle = (objectId1, objectId2) =>
  objectId1 != null && objectId2 != null &&
  objectId1 !== -1 && objectId2 !== -1 &&
  objectId1 !== NO_OBJECT && objectId2 !== NO_OBJECT;

const unitKeys = (units) => (units || [])
  .filter(u => u && isRealHandle(u.itemId1, u.itemId2))
  .map(u => handleKey(u.itemId1, u.itemId2));

class SelectionLedger {
  constructor () {
    this.log = [];
    this.players = null;
  }

  // ---- recording -------------------------------------------------------------

  // units: [{ itemId1, itemId2 }] as ChangeSelection carries them
  selectionChange (playerId, t, selectMode, units) {
    const kind = selectMode === SelectModes.deselect ? 'deselect' : 'select';
    this.log.push({ t, playerId, kind, keys: unitKeys(units) });
  }

  preSubselection (playerId, t, objectId1, objectId2) {
    if (!isRealHandle(objectId1, objectId2)) return;
    this.log.push({ t, playerId, kind: 'presub', keys: [handleKey(objectId1, objectId2)] });
  }

  assignGroup (playerId, t, group, units) {
    this.log.push({ t, playerId, kind: 'assign', group, keys: unitKeys(units) });
  }

  selectGroup (playerId, t, group) {
    this.log.push({ t, playerId, kind: 'hotkey', group, keys: [] });
  }

  selectSubgroup (playerId, t, type, objectId1, objectId2) {
    if (!isRealHandle(objectId1, objectId2)) return;
    this.log.push({ t, playerId, kind: 'subgroup', type, keys: [handleKey(objectId1, objectId2)] });
  }

  // Any order of the current selection; targetObject when it was aimed at a unit
  // (right-click or attack on it), which shows that unit there to be clicked.
  // work: an order that sends the units to harvest.
  order (playerId, t, orderId, objectId1 = null, objectId2 = null, aimedAtUnit = false, work = false) {
    const target = isRealHandle(objectId1, objectId2) ? handleKey(objectId1, objectId2) : null;
    this.log.push({ t, playerId, kind: 'order', order: orderId, target, aimedAtUnit, work, keys: [] });
  }

  // ---- resolving -------------------------------------------------------------

  resolve () {
    const players = new Map();
    const playerState = (id) => {
      let pl = players.get(id);
      if (!pl) {
        pl = {
          id,
          handles: new Map(),
          sel: new Set(),
          selKnown: true,           // a player starts with nothing selected
          groups: new Map(),
          misses: [],
          listings: [],
          targets: []
        };
        players.set(id, pl);
      }
      return pl;
    };

    // 1. the selection state machine, one tick (same player, same time) at a time
    const log = this.log;
    let i = 0;
    while (i < log.length) {
      const { t, playerId } = log[i];
      let j = i;
      while (j < log.length && log[j].t === t && log[j].playerId === playerId) j++;
      this._runTick(playerState(playerId), t, log.slice(i, j));
      i = j;
    }

    // 2. a handle belongs to one player; when others listed or targeted it,
    //    that still shows it alive
    this._settleOwners(players);

    // 3. per handle, how its life ends
    for (const pl of players.values()) this._resolveDeaths(pl);

    this.players = players;
    return players;
  }

  _handle (pl, k, t) {
    let h = pl.handles.get(k);
    if (!h) {
      const [objectId1, counter] = k.split('/').map(Number);
      h = {
        key: k, objectId1, counter,
        first: t, last: t, lastKind: null,
        types: [], lastOrder: null,
        seen: 0, multi: 0, listed: [],
        death: null
      };
      pl.handles.set(k, h);
    }
    return h;
  }

  _see (pl, k, t, kind) {
    const h = this._handle(pl, k, t);
    if (t >= h.last) {
      h.last = t;
      h.lastKind = kind;
    }
    h.seen++;
    return h;
  }

  // A full list the game wrote at time t: a whole selection or a whole group.
  _listing (pl, t, keys) {
    if (!keys.length) return;
    const idx = pl.listings.length;
    pl.listings.push({ t, keys });
    for (const k of keys) {
      const h = this._handle(pl, k, t);
      h.listed.push(idx);
      if (keys.length > 1) h.multi++;
    }
  }

  _miss (pl, keys, t, why) {
    for (const k of keys) pl.misses.push({ k, t, why });
  }

  _runTick (pl, t, tick) {
    let pre = null;
    let replaced = false;
    const selectFollows = (q) => tick.slice(q + 1).some(e => e.kind === 'select');

    for (let q = 0; q < tick.length; q++) {
      const e = tick[q];
      switch (e.kind) {
        case 'presub': {
          pre = pre || [];
          for (const k of e.keys) {
            if (!pre.includes(k)) pre.push(k);
            this._see(pl, k, t, 'presub');
          }
          break;
        }

        case 'deselect': {
          // With a select after it (or a PreSubselection list before it) the
          // player picked something else and the game listed the whole old
          // selection to drop it. Alone it is a shift-click — or the game taking
          // out a unit that died or was hidden.
          const replace = pre !== null || selectFollows(q);
          for (const k of e.keys) this._see(pl, k, t, replace ? 'deselect' : 'deselectAlone');
          if (!replace) {
            for (const k of e.keys) pl.sel.delete(k);
            break;
          }
          if (pl.selKnown) {
            const listed = new Set(e.keys);
            const kept = new Set(pre || []);
            this._miss(pl, [...pl.sel].filter(k => !listed.has(k) && !kept.has(k)), t, 'deselect');
          }
          this._listing(pl, t, e.keys);
          for (const k of e.keys) pl.sel.delete(k);
          if (!pre) {
            // the whole old selection is gone: what the select adds is all there is
            pl.sel = new Set();
            pl.selKnown = true;
          }
          replaced = true;
          break;
        }

        case 'select': {
          const wasEmpty = pl.selKnown && pl.sel.size === 0;
          for (const k of e.keys) {
            this._see(pl, k, t, 'select');
            pl.sel.add(k);
          }
          if (pre) {
            pl.sel = new Set([...pre, ...e.keys]);
            pl.selKnown = true;
            this._listing(pl, t, [...pl.sel]);
          } else if (replaced || wasEmpty) {
            // a new selection, not a shift-add: the list is all of it
            this._listing(pl, t, e.keys);
          }
          break;
        }

        case 'assign': {
          for (const k of e.keys) this._see(pl, k, t, 'assign');
          if (pl.selKnown) {
            const listed = new Set(e.keys);
            this._miss(pl, [...pl.sel].filter(k => !listed.has(k)), t, 'assign');
          }
          this._listing(pl, t, e.keys);
          pl.groups.set(e.group, new Set(e.keys));
          pl.sel = new Set(e.keys);
          pl.selKnown = true;
          break;
        }

        case 'hotkey': {
          const group = pl.groups.get(e.group);
          if (pre) {
            if (group) {
              const listed = new Set(pre);
              this._miss(pl, [...group].filter(k => !listed.has(k)), t, 'hotkey');
            }
            this._listing(pl, t, pre);
            pl.groups.set(e.group, new Set(pre));
            pl.sel = new Set(pre);
            pl.selKnown = true;
          } else {
            // no list: the selection is the group as last known, dead units and
            // all, until a whole-selection deselect lists who is really in it
            pl.sel = new Set(group || []);
            pl.selKnown = !!group;
          }
          break;
        }

        case 'subgroup': {
          for (const k of e.keys) {
            const h = this._see(pl, k, t, 'subgroup');
            const last = h.types[h.types.length - 1];
            if (!last || last.type !== e.type) h.types.push({ t, type: e.type });
          }
          break;
        }

        case 'order': {
          for (const k of pl.sel) {
            const h = pl.handles.get(k);
            if (h) h.lastOrder = { t, order: e.order, target: e.target, work: e.work };
          }
          if (e.target && e.aimedAtUnit) pl.targets.push({ t, k: e.target });
          break;
        }
      }
    }

    if (pre && !tick.some(e => e.kind === 'select' || e.kind === 'hotkey')) {
      // a PreSubselection list without a select after it (a subgroup picked out
      // of the selection) still names the whole new selection
      this._listing(pl, t, pre);
    }
  }

  _settleOwners (players) {
    const holders = new Map();
    for (const pl of players.values()) {
      for (const h of pl.handles.values()) {
        if (!holders.has(h.key)) holders.set(h.key, []);
        holders.get(h.key).push({ pl, h });
      }
    }

    // The owner lists it in multi-unit lists; others only ever click on it.
    const owned = new Map();
    for (const [k, list] of holders) {
      list.sort((a, b) => (b.h.multi - a.h.multi) || (b.h.seen - a.h.seen) || (a.h.first - b.h.first));
      const own = list[0].h;
      owned.set(k, own);
      for (const other of list.slice(1)) {
        this._seenBy(own, other.h.last, 'other');
        own.first = Math.min(own.first, other.h.first);
        other.pl.handles.delete(k);
      }
    }

    for (const pl of players.values()) {
      for (const { t, k } of pl.targets) {
        const h = owned.get(k);
        if (h) this._seenBy(h, t, 'target');
      }
    }
  }

  _seenBy (h, t, kind) {
    if (t > h.last) {
      h.last = t;
      h.lastKind = kind;
    }
  }

  _resolveDeaths (pl) {
    const missesBy = new Map();
    for (const m of pl.misses) {
      if (!missesBy.has(m.k)) missesBy.set(m.k, []);
      missesBy.get(m.k).push(m);
    }

    for (const h of pl.handles.values()) {
      h.death = null;

      // Sent to harvest: players take the workers out of the selection one
      // by one and never list them again while they work. Their lists end,
      // they don't die.
      if (h.lastOrder && h.lastOrder.work) continue;

      if (h.lastKind === 'deselectAlone') {
        h.death = { at: h.last, from: h.last, kind: 'deselected' };
        continue;
      }

      const miss = (missesBy.get(h.key) || []).find(m => m.t > h.last);
      let bound = miss ? { at: miss.t, kind: miss.why } : null;

      const peerAt = this._peerBound(pl, h);
      if (peerAt != null && (!bound || peerAt < bound.at)) bound = { at: peerAt, kind: 'peers' };

      if (bound) h.death = { at: bound.at, from: h.last, kind: bound.kind };
    }
  }

  // The first full list after h's last sighting that names most of the units h
  // was last listed with, but not h.
  _peerBound (pl, h) {
    let lastIdx = -1;
    for (let q = h.listed.length - 1; q >= 0; q--) {
      if (pl.listings[h.listed[q]].keys.length > 1) {
        lastIdx = h.listed[q];
        break;
      }
    }
    if (lastIdx < 0) return null;

    const peers = pl.listings[lastIdx].keys.filter(k => k !== h.key);
    if (peers.length < MIN_PEERS) return null;
    const need = Math.max(MIN_PEERS, Math.ceil(peers.length * PEER_SHARE));

    const counts = new Map();
    let best = null;
    for (const pk of peers) {
      const ph = pl.handles.get(pk);
      if (!ph) continue;
      for (const idx of ph.listed) {
        if (best !== null && idx >= best) break;
        if (idx <= lastIdx || pl.listings[idx].t <= h.last) continue;
        const c = (counts.get(idx) || 0) + 1;
        counts.set(idx, c);
        if (c >= need) best = idx;
      }
    }
    return best === null ? null : pl.listings[best].t;
  }
}

SelectionLedger.handleKey = handleKey;
SelectionLedger.isRealHandle = isRealHandle;
SelectionLedger.SelectModes = SelectModes;

module.exports = SelectionLedger;
