/*
 * BattleDetector — post-parse pass that turns combat-intent signals + opposing-
 * unit proximity windows into "battles". Output is deterministic, non-recursive,
 * non-overlapping, with anti-rapid-merge cooldown.
 *
 * Pipeline:
 *   Pass A   — collect player combatSignals + synthesize cross-team proximity signals
 *   Pass B   — single-sweep clustering (NOT DBSCAN; see _cluster)
 *   Pass C   — tracker-box computation (time-varying bbox that follows the action)
 *   Pass D   — categorization (incl. creep-jack collapse)
 *   Pass E   — possiblyDead unit-outcome inference (Phase 4)
 *
 * Determinism strategy:
 *   - All iteration is over sorted arrays.
 *   - playerManager.players is enumerated by integer id ascending.
 *   - Each player's units are walked in their existing insertion order (stable).
 *   - Sorting comparators are TOTAL on the keys used (no NaN, no ties unresolved).
 *   - No Date.now / Math.random.
 *
 * Cost note: the proximity scan dominates. We cheaply early-out when one side
 * has no live combat units in a tick window, and rebuild the rbush per tick
 * rather than per unit.
 */

const rbush = require("rbush");
const CombatSignalTracker = require("./CombatSignalTracker");
const C = require("./battleConstants");
const { NEUTRAL_PLAYER_ID } = require("../helpers/mappings");

const { SIGNAL_KINDS } = CombatSignalTracker;

const ALMOST_INFINITY = 1e15;

// Predicate copy of NeutralGroup.isCombatUnit. Workers/illusions/non-units are
// not "fighters" for clustering purposes. Uprooted ancients DO count.
const isCombatUnit = (unit) => {
  if (!unit) return false;
  if (!unit.isRegistered) return false;
  if (unit.isIllusion) return false;
  if (unit.meta && unit.meta.worker) return false;
  if (unit.isUnit) return true;
  if (unit.isBuilding && unit.isUprooted) return true;
  return false;
};

// Interpolate a unit's position at gameTime via its `path` array. Returns null
// if the unit had no sample within ±tolMs of gameTime (i.e. it wasn't really
// "alive on the field" then). isJump segments cause us to return null at the
// crossing — a teleport shouldn't stretch a tracker box across the map.
const interpolatePosition = (unit, gameTime, tolMs) => {
  const path = unit && unit.path;
  if (!path || !path.length) return null;

  // Binary search for the first path entry with gameTime >= queried gameTime.
  let lo = 0, hi = path.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (path[mid].gameTime < gameTime) lo = mid + 1;
    else hi = mid;
  }

  const after = path[lo];
  const before = lo > 0 ? path[lo - 1] : null;

  // Exact / before-first-sample case.
  if (after.gameTime === gameTime) return { x: after.x, y: after.y };
  if (!before) {
    // queried time predates the first sample — only count if first sample
    // is within tolerance.
    if (after.gameTime - gameTime <= tolMs) return { x: after.x, y: after.y };
    return null;
  }
  // queried time after last sample — only count if within tolerance.
  if (gameTime > path[path.length - 1].gameTime) {
    const last = path[path.length - 1];
    if (gameTime - last.gameTime <= tolMs) return { x: last.x, y: last.y };
    return null;
  }

  // A teleport between before and after — the unit wasn't really at any
  // intermediate position. Return the closer-in-time endpoint within tol.
  if (after.isJump) {
    if (gameTime - before.gameTime <= tolMs) return { x: before.x, y: before.y };
    if (after.gameTime - gameTime <= tolMs)  return { x: after.x,  y: after.y  };
    return null;
  }

  const span = after.gameTime - before.gameTime;
  if (span <= 0) return { x: after.x, y: after.y };
  const t = (gameTime - before.gameTime) / span;
  return {
    x: before.x + (after.x - before.x) * t,
    y: before.y + (after.y - before.y) * t
  };
};

// Last path sample at-or-before gameTime, with no tolerance — used for
// participant fallback inside finalization.
const lastSampleAtOrBefore = (unit, gameTime) => {
  const path = unit && unit.path;
  if (!path || !path.length) return null;
  let lo = 0, hi = path.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (path[mid].gameTime <= gameTime) lo = mid;
    else hi = mid - 1;
  }
  return path[lo].gameTime <= gameTime ? path[lo] : null;
};

const dist2 = (ax, ay, bx, by) => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};

const BattleDetector = class {
  constructor (playerManager, options = {}) {
    this.playerManager = playerManager;
    this.world = playerManager && playerManager.world;
    this.options = options;
    // Map bounds for clipping tracker boxes. The detector doesn't strictly
    // need them — bbox math is fine without — but we clip on export.
    this.mapBounds = (options.mapBounds) || null;
    this._nextClusterId = 0;
  }

  run () {
    const battles = [];
    const stats = { totalBattles: 0, totalSignals: 0, byCategory: {}, byPlayer: {} };

    if (!this.playerManager) {
      return { battles, stats };
    }

    // PASS A — assemble + synthesize signals.
    const signals = this._collectSignals();
    stats.totalSignals = signals.length;
    if (signals.length === 0) {
      return { battles, stats };
    }

    // PASS B — single-sweep cluster (non-recursive, non-overlapping).
    const clusters = this._cluster(signals);

    // PASS C/D — finalize each cluster (tracker box, participants, categorize).
    const categorized = [];
    for (const cluster of clusters) {
      const battle = this._finalizeCluster(cluster);
      if (!battle) continue;
      categorized.push(battle);
    }

    // Creep-jack collapse: a creep-fight cluster that temporally overlaps a
    // multi-team cluster inside the same camp bounds is folded into the
    // multi-team cluster (flag + campUuid) and dropped from output.
    const finalBattles = this._collapseCreepJacks(categorized);

    // Assign final stable ids in chronological order.
    finalBattles.forEach((b, i) => {
      b.id = `battle-${String(i).padStart(4, '0')}`;
    });

    // PASS E — possiblyDead inference per battle.
    for (const battle of finalBattles) {
      battle.unitOutcomes = this._inferUnitOutcomes(battle);
    }

    // Stats.
    stats.totalBattles = finalBattles.length;
    for (const b of finalBattles) {
      stats.byCategory[b.category] = (stats.byCategory[b.category] || 0) + 1;
      for (const p of b.participants) {
        const pkey = String(p.playerId);
        stats.byPlayer[pkey] = (stats.byPlayer[pkey] || 0) + 1;
      }
    }

    return { battles: finalBattles, stats };
  }

  // ---------------------------------------------------------------------------
  // PASS A — signal collection + proximity synthesis
  // ---------------------------------------------------------------------------

  _collectSignals () {
    const all = [];

    // Real player signals (finalize() stable-sorts each player's list).
    const playerIds = this._playerIdsSorted();
    for (const pid of playerIds) {
      const player = this.playerManager.players[pid];
      if (!player || !player.combatSignals) continue;
      if (this._isNeutral(pid)) continue;
      player.combatSignals.finalize();
      for (const s of player.combatSignals.signals) {
        all.push(s);
      }
    }

    // Synthetic proximity signals (cross-team unit pairs in range).
    const proximity = this._synthesizeProximitySignals();
    for (const s of proximity) all.push(s);

    all.sort(CombatSignalTracker.compareSignals);
    return all;
  }

  _isNeutral (pid) {
    // Real players have id < 24; neutrals (NEUTRAL_PLAYER_ID = 1042) and
    // other harness ids sit above that. We also explicitly check the constant.
    if (pid == null) return true;
    if (Number(pid) === NEUTRAL_PLAYER_ID) return true;
    if (Number(pid) >= 24) return true;
    return false;
  }

  _playerIdsSorted () {
    return Object.keys(this.playerManager.players)
      .map(k => Number(k))
      .filter(n => Number.isFinite(n))
      .sort((a, b) => a - b);
  }

  // Cross-team unit-pair proximity scan. Time complexity is bounded by
  // (matchDurationMs / PROXIMITY_SAMPLE_MS) * (combatUnits²) but we early-out
  // when one team has zero combat units in a tick, which is most of early game.
  _synthesizeProximitySignals () {
    const out = [];

    const allCombatUnits = this._collectCombatUnits();
    if (allCombatUnits.length < 2) return out;

    // Group by team for cross-team pairing.
    const unitsByTeam = new Map();
    for (const u of allCombatUnits) {
      const tid = u._ownerTeamId == null ? -1 : u._ownerTeamId;
      if (!unitsByTeam.has(tid)) unitsByTeam.set(tid, []);
      unitsByTeam.get(tid).push(u);
    }
    if (unitsByTeam.size < 2) return out;

    // Compute scan window. min/max sample time bounded by union of unit
    // spawn-time (first path entry) and last path entry.
    let minStart = Infinity, maxEnd = -Infinity;
    for (const u of allCombatUnits) {
      const path = u.unit.path;
      if (!path || !path.length) continue;
      if (path[0].gameTime < minStart) minStart = path[0].gameTime;
      if (path[path.length - 1].gameTime > maxEnd) maxEnd = path[path.length - 1].gameTime;
    }
    if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd) || maxEnd <= minStart) return out;

    const sortedTeams = [...unitsByTeam.keys()].sort((a, b) => a - b);
    const pairKeysLastEmit = new Map();
    const debounce = C.PROXIMITY_DEBOUNCE_MS;
    const radius = C.PROXIMITY_RADIUS;
    const radius2 = radius * radius;
    const overlapMs = C.PROXIMITY_MIN_OVERLAP_MS;
    const sampleMs = C.PROXIMITY_SAMPLE_MS;

    // Per-pair sustain tracker so we only emit after MIN_OVERLAP_MS continuous.
    const pairSustain = new Map();    // "uuidA|uuidB" → { firstTick, lastTick, lastEmit }

    for (let t = minStart; t <= maxEnd; t += sampleMs) {
      // Build positions per team at this tick.
      const teamPositions = new Map();
      for (const tid of sortedTeams) {
        const arr = [];
        const teamUnits = unitsByTeam.get(tid);
        for (const cu of teamUnits) {
          const pos = interpolatePosition(cu.unit, t, sampleMs);
          if (!pos) continue;
          arr.push({ x: pos.x, y: pos.y, uuid: cu.unit.uuid, ref: cu });
        }
        // stable order for determinism
        arr.sort((a, b) => a.uuid < b.uuid ? -1 : a.uuid > b.uuid ? 1 : 0);
        teamPositions.set(tid, arr);
      }

      // Skip tick if any team has zero combat units present.
      let anyEmpty = false;
      for (const tid of sortedTeams) {
        if (teamPositions.get(tid).length === 0) { anyEmpty = true; break; }
      }
      if (anyEmpty) continue;

      // For each unordered team pair, run rbush(query) of side A against side B.
      for (let i = 0; i < sortedTeams.length; i++) {
        const tA = sortedTeams[i];
        const A = teamPositions.get(tA);
        if (!A.length) continue;
        for (let j = i + 1; j < sortedTeams.length; j++) {
          const tB = sortedTeams[j];
          const B = teamPositions.get(tB);
          if (!B.length) continue;

          // Build rbush of B at this tick.
          const tree = new rbush();
          tree.load(B.map(p => ({
            minX: p.x - radius, minY: p.y - radius,
            maxX: p.x + radius, maxY: p.y + radius,
            _ref: p
          })));

          for (const a of A) {
            const hits = tree.search({
              minX: a.x, minY: a.y, maxX: a.x, maxY: a.y
            });
            for (const h of hits) {
              const b = h._ref;
              if (dist2(a.x, a.y, b.x, b.y) > radius2) continue;
              // canonicalize pair key by sorted uuids
              const k = a.uuid < b.uuid ? `${a.uuid}|${b.uuid}` : `${b.uuid}|${a.uuid}`;
              let sus = pairSustain.get(k);
              if (!sus || (t - sus.lastTick) > sampleMs * 2) {
                // (re)start sustain window — allow one missing sample
                sus = { firstTick: t, lastTick: t, lastEmit: -ALMOST_INFINITY,
                        midPlayerA: a.ref.ownerPlayerId, midTeamA: tA,
                        midPlayerB: b.ref.ownerPlayerId, midTeamB: tB };
                pairSustain.set(k, sus);
              } else {
                sus.lastTick = t;
              }

              if ((t - sus.firstTick) >= overlapMs && (t - sus.lastEmit) >= debounce) {
                // Emit one proximity signal at the midpoint.
                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2;
                const mid = Math.round((sus.firstTick + t) / 2);
                // Two signals — one attributed to each side. This keeps
                // participant aggregation honest without inventing a
                // synthetic "owner" for a proximity event.
                out.push({
                  gameTime: mid,
                  playerId: sus.midPlayerA,
                  actorTeamId: sus.midTeamA,
                  actorUnitUuid: a.uuid,
                  actorUnitItemId: a.ref.unit.itemId,
                  isHero: !!(a.ref.unit.meta && a.ref.unit.meta.hero),
                  isCombatActor: true,
                  selectionCount: 0,
                  kind: SIGNAL_KINDS.PROXIMITY,
                  targetX: mx, targetY: my,
                  targetPlayerId: sus.midPlayerB,
                  targetTeamId: sus.midTeamB,
                  targetUnitUuid: b.uuid,
                  targetIsBuilding: !!(b.ref.unit.isBuilding),
                  spellAbilityId: null,
                  hostile: true,
                  _synthetic: true
                });
                sus.lastEmit = t;
              }
            }
          }
        }
      }
    }

    return out;
  }

  _collectCombatUnits () {
    // Returns [{ unit, ownerPlayerId, ownerTeamId }, ...] across all non-neutral
    // players. Each unit retains its `path` so the proximity scan can
    // interpolate.
    const out = [];
    const ids = this._playerIdsSorted();
    for (const pid of ids) {
      if (this._isNeutral(pid)) continue;
      const player = this.playerManager.players[pid];
      if (!player || !player.units) continue;
      for (const u of player.units) {
        if (!isCombatUnit(u)) continue;
        if (!u.path || u.path.length === 0) continue;
        // Mirror team id onto the unit for fast lookup in the scan loop.
        const entry = { unit: u, ownerPlayerId: pid, ownerTeamId: player.teamId };
        // small back-ref for proximity emit
        u._ownerTeamId = player.teamId;
        out.push(entry);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // PASS B — single-sweep clustering (deterministic, non-overlapping)
  // ---------------------------------------------------------------------------

  _cluster (signals) {
    const closed = [];
    const open = [];

    const finalizeOpen = (cluster) => {
      // Compact centroid from final running averages.
      closed.push(cluster);
    };

    for (const s of signals) {
      // Close any open clusters that have gone stale.
      for (let k = open.length - 1; k >= 0; k--) {
        if (s.gameTime - open[k].lastSignalTime > C.SIGNAL_MERGE_TIME_MS) {
          finalizeOpen(open[k]);
          open.splice(k, 1);
        }
      }

      // 1) which open clusters could absorb s?
      const candidates = [];
      for (const c of open) {
        if (s.gameTime - c.lastSignalTime > C.SIGNAL_MERGE_TIME_MS) continue;
        const d2 = dist2(s.targetX, s.targetY, c.centroidX, c.centroidY);
        if (d2 > C.SIGNAL_MERGE_DIST * C.SIGNAL_MERGE_DIST) continue;
        candidates.push({ cluster: c, d2 });
      }

      if (candidates.length) {
        // 2) deterministic pick: earliest startTime, then nearest centroid,
        // then lowest cluster id. Total order ⇒ no ambiguity.
        candidates.sort((A, B) => {
          if (A.cluster.startTime !== B.cluster.startTime) return A.cluster.startTime - B.cluster.startTime;
          if (A.d2 !== B.d2) return A.d2 - B.d2;
          return A.cluster.id - B.cluster.id;
        });
        this._addSignalToCluster(candidates[0].cluster, s);
        continue;
      }

      // 3) cooldown shadow — a closed battle still "owns" its region for
      // POST_BATTLE_COOLDOWN_MS. Attach s to it as a tail signal (does NOT
      // extend duration or bbox; preserved for downstream context).
      const shadow = this._findCooldownShadow(closed, s);
      if (shadow) {
        shadow.tailSignals.push(s);
        continue;
      }

      // 4) open a new cluster.
      open.push(this._newCluster(s));
    }

    for (const c of open) finalizeOpen(c);
    return closed;
  }

  _findCooldownShadow (closed, signal) {
    // Walk from newest closed cluster backwards — most-recent shadow wins.
    for (let i = closed.length - 1; i >= 0; i--) {
      const b = closed[i];
      if (signal.gameTime - b.endTime > C.POST_BATTLE_COOLDOWN_MS) return null;
      // Use the final centroid as the proxy for "this cluster's region".
      const d2 = dist2(signal.targetX, signal.targetY, b.centroidX, b.centroidY);
      if (d2 <= C.SIGNAL_MERGE_DIST * C.SIGNAL_MERGE_DIST) return b;
    }
    return null;
  }

  _newCluster (signal) {
    const id = this._nextClusterId++;
    return {
      id,
      startTime:       signal.gameTime,
      endTime:         signal.gameTime,
      lastSignalTime:  signal.gameTime,
      centroidX:       signal.targetX,
      centroidY:       signal.targetY,
      signals:         [signal],
      tailSignals:     [],
      // running stats for incremental centroid
      _sumX:           signal.targetX,
      _sumY:           signal.targetY,
      _count:          1,
      // hostile-signal accounting for filter
      _hostileSignals: signal.hostile ? 1 : 0
    };
  }

  _addSignalToCluster (cluster, signal) {
    cluster.signals.push(signal);
    cluster.endTime        = Math.max(cluster.endTime, signal.gameTime);
    cluster.lastSignalTime = Math.max(cluster.lastSignalTime, signal.gameTime);
    cluster._sumX += signal.targetX;
    cluster._sumY += signal.targetY;
    cluster._count++;
    cluster.centroidX = cluster._sumX / cluster._count;
    cluster.centroidY = cluster._sumY / cluster._count;
    if (signal.hostile) cluster._hostileSignals++;
  }

  // ---------------------------------------------------------------------------
  // PASS C/D — finalize cluster: tracker box, participants, category
  // ---------------------------------------------------------------------------

  _finalizeCluster (cluster) {
    const durationMs = cluster.endTime - cluster.startTime;
    // Require BOTH minimums — pure-spam 3-signal-in-300ms blips were leaking
    // through the earlier AND-gate. A real engagement always has *some*
    // duration even if signal-rare (proximity ticks every PROXIMITY_SAMPLE_MS).
    if (durationMs < C.MIN_BATTLE_DURATION_MS || cluster.signals.length < C.MIN_SIGNAL_COUNT) {
      return null;
    }

    // Distinct participants by playerId/teamId.
    const participantUuids = new Set();
    const participantsByPlayer = new Map();
    let initiator = null;

    for (const s of cluster.signals) {
      if (s.actorUnitUuid) participantUuids.add(s.actorUnitUuid);
      if (s.targetUnitUuid) participantUuids.add(s.targetUnitUuid);

      // Actor side aggregation. Skip neutral-side signals (defensive — should
      // never fire since the collector excludes neutrals).
      if (s.playerId == null) continue;
      let p = participantsByPlayer.get(s.playerId);
      if (!p) {
        p = {
          playerId: s.playerId,
          teamId: s.actorTeamId,
          unitUuids: new Set(),
          signalCount: 0,
          firstSeen: s.gameTime,
          lastSeen: s.gameTime,
          hostileCount: 0
        };
        participantsByPlayer.set(s.playerId, p);
      }
      if (s.actorUnitUuid) p.unitUuids.add(s.actorUnitUuid);
      p.signalCount++;
      if (s.gameTime < p.firstSeen) p.firstSeen = s.gameTime;
      if (s.gameTime > p.lastSeen) p.lastSeen = s.gameTime;
      if (s.hostile) p.hostileCount++;

      if (s.hostile && initiator == null) initiator = s.playerId;

      // Target side — count as participant too if it's a real player.
      // Neutral / non-player targets are filtered: creep right-clicks already
      // flow through NeutralGroup, so adding 1042 as a "participant" would
      // pollute the roster and stats.byPlayer.
      if (s.targetPlayerId != null && !this._isNeutral(s.targetPlayerId)) {
        let tp = participantsByPlayer.get(s.targetPlayerId);
        if (!tp) {
          tp = {
            playerId: s.targetPlayerId,
            teamId: s.targetTeamId,
            unitUuids: new Set(),
            signalCount: 0,
            firstSeen: s.gameTime,
            lastSeen: s.gameTime,
            hostileCount: 0
          };
          participantsByPlayer.set(s.targetPlayerId, tp);
        }
        if (s.targetUnitUuid) tp.unitUuids.add(s.targetUnitUuid);
        if (s.gameTime < tp.firstSeen) tp.firstSeen = s.gameTime;
        if (s.gameTime > tp.lastSeen) tp.lastSeen = s.gameTime;
      }
    }

    // Drop clusters that never produced ANY hostile signal — they were all
    // self-buffs (Bloodlust on idle, etc.). The MIN_HOSTILE gate.
    if (cluster._hostileSignals === 0) return null;

    // Tracker box construction.
    const trackerBox = this._buildTrackerBox(cluster, [...participantUuids]);
    if (trackerBox.length === 0) return null;
    const outerBbox = this._outerBboxFromTracker(trackerBox);

    // Distinct teams across hostile-emitting participants only.
    const teamSet = new Set();
    for (const p of participantsByPlayer.values()) {
      if (p.teamId != null) teamSet.add(p.teamId);
    }

    // Flags.
    const flags = this._computeFlags(cluster);

    // Stable participant ordering by playerId.
    const participants = [...participantsByPlayer.values()]
      .sort((a, b) => a.playerId - b.playerId)
      .map(p => ({
        playerId: p.playerId,
        teamId: p.teamId,
        side: this._sideForTeam(p.teamId, teamSet),
        unitUuids: [...p.unitUuids].sort(),
        signalCount: p.signalCount,
        firstSeen: p.firstSeen,
        lastSeen: p.lastSeen,
        role: (p.playerId === initiator) ? 'initiator' : 'participant'
      }));

    const battle = {
      id: null,   // assigned later in chronological order
      startTime: cluster.startTime,
      endTime: cluster.endTime,
      durationMs,
      category: null,         // filled in next
      flags,
      creepJack: false,
      campUuid: null,
      startingPlayerId: initiator,
      participants,
      trackerBox,
      outerBbox,
      signals: cluster.signals.slice(),
      tailSignals: cluster.tailSignals.slice(),
      _teamSet: teamSet,
      _participantUuids: [...participantUuids],
      _rawSignalCount: cluster.signals.length,
      _hostileSignals: cluster._hostileSignals
    };

    battle.category = this._categorize(battle);
    return battle;
  }

  _buildTrackerBox (cluster, participantUuids) {
    // Resolve participant uuid → unit instance (one-time per cluster).
    const uuidToUnit = this._buildUuidIndex(participantUuids);

    const samples = [];
    const dt = C.TRACK_SAMPLE_MS;
    const tol = dt * 2;
    let lastBox = null;
    for (let t = cluster.startTime; t <= cluster.endTime; t += dt) {
      const positions = [];
      for (const uuid of participantUuids) {
        const u = uuidToUnit.get(uuid);
        if (!u) continue;
        const pos = interpolatePosition(u, t, tol);
        if (pos) positions.push(pos);
      }
      // Signal targets close to this tick contribute to the box.
      for (const s of cluster.signals) {
        if (Math.abs(s.gameTime - t) <= dt) {
          positions.push({ x: s.targetX, y: s.targetY });
        }
      }
      if (positions.length < 2) {
        // Carry the previous box rather than dropping the sample so the
        // client doesn't see a gap. If we have no prior box yet, skip.
        if (lastBox) samples.push({ gameTime: t, ...lastBox });
        continue;
      }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of positions) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      minX -= C.TRACK_PADDING; minY -= C.TRACK_PADDING;
      maxX += C.TRACK_PADDING; maxY += C.TRACK_PADDING;
      lastBox = { minX, minY, maxX, maxY };
      samples.push({ gameTime: t, minX, minY, maxX, maxY });
    }

    // Always include an endTime sample (covers the case where loop step
    // overshoots the endTime by < dt).
    if (samples.length && samples[samples.length - 1].gameTime < cluster.endTime) {
      const tail = samples[samples.length - 1];
      samples.push({
        gameTime: cluster.endTime,
        minX: tail.minX, minY: tail.minY,
        maxX: tail.maxX, maxY: tail.maxY
      });
    }

    // Collapse consecutive identical samples to shrink output.
    const collapsed = [];
    for (const s of samples) {
      const last = collapsed[collapsed.length - 1];
      if (last &&
          last.minX === s.minX && last.minY === s.minY &&
          last.maxX === s.maxX && last.maxY === s.maxY) {
        last.gameTime = s.gameTime;  // extend coverage to here without duplicating
        continue;
      }
      collapsed.push({ ...s });
    }
    return collapsed;
  }

  _outerBboxFromTracker (trackerBox) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of trackerBox) {
      if (s.minX < minX) minX = s.minX;
      if (s.minY < minY) minY = s.minY;
      if (s.maxX > maxX) maxX = s.maxX;
      if (s.maxY > maxY) maxY = s.maxY;
    }
    return { minX, minY, maxX, maxY };
  }

  _buildUuidIndex (uuids) {
    const idx = new Map();
    const target = new Set(uuids);
    const ids = this._playerIdsSorted();
    for (const pid of ids) {
      const p = this.playerManager.players[pid];
      if (!p || !p.units) continue;
      for (const u of p.units) {
        if (target.has(u.uuid)) idx.set(u.uuid, u);
      }
    }
    return idx;
  }

  _computeFlags (cluster) {
    let involvesHero = false, hasSummons = false, hasItemUse = false;
    let hasSpellCasts = false, involvesAir = false;
    for (const s of cluster.signals) {
      if (s.isHero) involvesHero = true;
      if (s.kind === SIGNAL_KINDS.SPELL_TARGET_UNIT ||
          s.kind === SIGNAL_KINDS.SPELL_TARGET_GROUND ||
          s.kind === SIGNAL_KINDS.SPELL_NO_TARGET) {
        hasSpellCasts = true;
      }
    }
    return { involvesHero, involvesAir, hasSummons, hasItemUse, hasSpellCasts };
  }

  _sideForTeam (teamId, teamSet) {
    // Stable mapping: lowest teamId → 'A', next → 'B', etc. Used by the
    // client only as a display hint.
    const sorted = [...teamSet].sort((a, b) => a - b);
    const idx = sorted.indexOf(teamId);
    if (idx < 0) return null;
    return String.fromCharCode(65 + idx);
  }

  _categorize (battle) {
    const teamCount = battle._teamSet.size;

    // 1) creep-fight — single-team (no opposing real player team) AND positions
    // inside a neutral group bound.
    if (teamCount <= 1) {
      const campHit = this._findContainingCamp(battle.outerBbox);
      if (campHit) {
        battle.campUuid = campHit.uuid;
        return 'creep-fight';
      }
      // Single team + no camp → almost certainly stray signals. Return a
      // unknown-combat label so it's visible in inspect-replay for debugging.
      return 'unknown-combat';
    }

    const bx = (battle.outerBbox.minX + battle.outerBbox.maxX) / 2;
    const by = (battle.outerBbox.minY + battle.outerBbox.maxY) / 2;

    // 2) base-defense
    for (const p of battle.participants) {
      const owner = this.playerManager.players[p.playerId];
      if (!owner || !owner.startingPosition) continue;
      const d2 = dist2(bx, by, owner.startingPosition.x, owner.startingPosition.y);
      if (d2 <= C.BASE_DEFENSE_RADIUS * C.BASE_DEFENSE_RADIUS) {
        if (this._signalsNearDefensiveBldg(battle, owner)) return 'tower-dive';
        return 'base-defense';
      }
    }

    // 3) expansion-fight
    const expansionHit = this._anyExpansionTownHallNearby(battle, bx, by);
    if (expansionHit) {
      if (this._signalsNearDefensiveBldg(battle, expansionHit.owner)) return 'tower-dive';
      return 'expansion-fight';
    }

    // 4) pitched-battle vs engagement vs harass vs skirmish
    if (battle.durationMs >= C.PITCHED_MIN_DURATION_MS &&
        battle._participantUuids.length >= C.PITCHED_MIN_PARTICIPANTS) {
      return 'pitched-battle';
    }
    if (battle.durationMs >= C.ENGAGEMENT_MIN_DURATION_MS) {
      return 'engagement';
    }
    const aggregateActors = battle._participantUuids.length;
    if (battle.durationMs < C.HARASS_MAX_DURATION_MS && aggregateActors <= C.HARASS_MAX_ACTORS) {
      return 'harass';
    }
    return 'skirmish';
  }

  _findContainingCamp (bbox) {
    if (!this.world || !this.world.neutralGroups) return null;
    const cx = (bbox.minX + bbox.maxX) / 2;
    const cy = (bbox.minY + bbox.maxY) / 2;
    // Stable order: sort camp uuids ascending.
    const uuids = Object.keys(this.world.neutralGroups).sort();
    for (const u of uuids) {
      const g = this.world.neutralGroups[u];
      if (!g) continue;
      const b = g.engagedBounds || g.bounds;
      if (!b) continue;
      if (cx >= b.minX && cx <= b.maxX && cy >= b.minY && cy <= b.maxY) {
        return g;
      }
    }
    return null;
  }

  _anyExpansionTownHallNearby (battle, bx, by) {
    const ids = this._playerIdsSorted();
    for (const pid of ids) {
      if (this._isNeutral(pid)) continue;
      const player = this.playerManager.players[pid];
      if (!player || !player.units || !player.startingPosition) continue;
      for (const u of player.units) {
        if (!u.isBuilding) continue;
        if (!C.EXPANSION_BUILDING_IDS.has(u.itemId)) continue;
        // Skip the player's start townhall.
        const dxStart = u.currentX - player.startingPosition.x;
        const dyStart = u.currentY - player.startingPosition.y;
        if ((dxStart * dxStart + dyStart * dyStart) < 1000 * 1000) continue;
        const d2 = dist2(bx, by, u.currentX, u.currentY);
        if (d2 <= C.EXPANSION_DEFENSE_RADIUS * C.EXPANSION_DEFENSE_RADIUS) {
          return { townHall: u, owner: player };
        }
      }
    }
    return null;
  }

  _signalsNearDefensiveBldg (battle, defenderPlayer) {
    if (!defenderPlayer || !defenderPlayer.units) return false;
    const towers = defenderPlayer.units.filter(u =>
      u.isBuilding && C.DEFENSIVE_BUILDING_IDS.has(u.itemId)
    );
    if (!towers.length) return false;
    const r2 = C.TOWER_DIVE_BUILDING_DIST * C.TOWER_DIVE_BUILDING_DIST;
    for (const s of battle.signals) {
      if (!s.hostile) continue;
      for (const t of towers) {
        if (dist2(s.targetX, s.targetY, t.currentX, t.currentY) <= r2) return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Creep-jack collapse
  // ---------------------------------------------------------------------------

  _collapseCreepJacks (battles) {
    // For each creep-fight battle, check whether a multi-team battle overlaps
    // its time range with bbox center inside the same camp bounds. If so,
    // fold (add flag + campUuid to the multi-team battle) and drop the
    // creep-fight from the output.
    const sorted = [...battles].sort((a, b) => a.startTime - b.startTime);
    const drop = new Set();

    for (let i = 0; i < sorted.length; i++) {
      const cb = sorted[i];
      if (cb.category !== 'creep-fight') continue;
      // Look for an overlapping multi-team battle anywhere in the array.
      for (let j = 0; j < sorted.length; j++) {
        if (i === j) continue;
        const ob = sorted[j];
        if (ob.category === 'creep-fight') continue;
        if (drop.has(ob)) continue;
        // Time overlap.
        if (ob.endTime < cb.startTime || ob.startTime > cb.endTime) continue;
        // Spatial: ob center inside cb's bbox.
        const ox = (ob.outerBbox.minX + ob.outerBbox.maxX) / 2;
        const oy = (ob.outerBbox.minY + ob.outerBbox.maxY) / 2;
        if (ox < cb.outerBbox.minX || ox > cb.outerBbox.maxX) continue;
        if (oy < cb.outerBbox.minY || oy > cb.outerBbox.maxY) continue;
        // Fold.
        ob.creepJack = true;
        ob.campUuid  = cb.campUuid;
        ob.flags = { ...ob.flags, creepJack: true };
        drop.add(cb);
        break;
      }
    }

    return sorted.filter(b => !drop.has(b));
  }

  // ---------------------------------------------------------------------------
  // PASS E — possiblyDead inference
  // ---------------------------------------------------------------------------

  _inferUnitOutcomes (battle) {
    const outcomes = [];
    const uuidToUnit = this._buildUuidIndex(battle._participantUuids);
    const grace = C.PD_TAIL_GRACE_MS;
    const quiet = C.PD_QUIET_AFTER_MS;

    for (const uuid of battle._participantUuids) {
      const u = uuidToUnit.get(uuid);
      if (!u) continue;
      if (u.isBuilding) continue;
      if (u.isIllusion) continue;

      // Summons that expired naturally — `expired`.
      if (u.summonDuration && u.destroyed && u.destroyedAt != null) {
        outcomes.push({
          unitUuid: uuid,
          status: 'expired',
          lastSeenTime: u.destroyedAt,
          confidence: 'medium'
        });
        continue;
      }

      // Loaded into transport just before stale → `possiblyLoaded`.
      // Walk loadEvents looking for a load entry within [endTime-3000, endTime+1000].
      const loaded = this._wasRecentlyLoaded(u, battle);
      if (loaded) {
        outcomes.push({
          unitUuid: uuid,
          status: 'possiblyLoaded',
          lastSeenTime: loaded.gameTime,
          confidence: 'medium'
        });
        continue;
      }

      // Path-staleness test.
      const lastSample = u.path && u.path.length ? u.path[u.path.length - 1] : null;
      if (!lastSample) continue;
      const before = lastSampleAtOrBefore(u, battle.endTime + grace);
      if (!before) continue;

      const goneAfter = lastSample.gameTime < battle.endTime + grace
                     && (lastSample.gameTime < battle.endTime ||
                         lastSample.gameTime === before.gameTime);

      if (!goneAfter) {
        outcomes.push({ unitUuid: uuid, status: 'alive', lastSeenTime: lastSample.gameTime, confidence: 'low' });
        continue;
      }

      // Confirm no later samples within `quiet`.
      const tail = u.path[u.path.length - 1];
      if (tail.gameTime > battle.endTime + quiet) {
        outcomes.push({ unitUuid: uuid, status: 'alive', lastSeenTime: tail.gameTime, confidence: 'low' });
        continue;
      }

      const isCombat = isCombatUnit(u);
      const isHero = !!(u.meta && u.meta.hero);
      const insideBbox =
        tail.x >= battle.outerBbox.minX && tail.x <= battle.outerBbox.maxX &&
        tail.y >= battle.outerBbox.minY && tail.y <= battle.outerBbox.maxY;
      const confidence = (isCombat && !isHero && insideBbox) ? 'medium' : 'low';

      outcomes.push({
        unitUuid: uuid,
        status: 'possiblyDead',
        lastSeenTime: tail.gameTime,
        confidence
      });
    }

    return outcomes;
  }

  _wasRecentlyLoaded (unit, battle) {
    // Scan transports (any player) for a load event referencing this unit's
    // uuid/itemId in a narrow window around battle.endTime.
    const lo = battle.endTime - 3000;
    const hi = battle.endTime + 1000;
    const ids = this._playerIdsSorted();
    for (const pid of ids) {
      const p = this.playerManager.players[pid];
      if (!p || !p.units) continue;
      for (const t of p.units) {
        if (!t.isTransport || !t.loadEvents || !t.loadEvents.length) continue;
        for (const ev of t.loadEvents) {
          if (ev.action !== 'load') continue;
          if (ev.gameTime < lo || ev.gameTime > hi) continue;
          if (ev.unitId === unit.uuid) return ev;
        }
      }
    }
    return null;
  }
};

module.exports = BattleDetector;
