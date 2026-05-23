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

    // PASS F — macro / trip detection. Three internal passes:
    //   F.1 candidate trips per (battle, unit)  — done inside _finalizeCluster
    //       so the tracker box can already exclude tripping unit positions.
    //   F.2 cross-battle context (re-engagement linking, died-en-route).
    //   F.3 confidence filter + max-trips-per-unit cap.
    this._pass2_refineTripsContext(finalBattles);
    for (const battle of finalBattles) {
      battle.unitTrips = this._pass3_filterTrips(battle.unitTrips);
    }

    // PASS E — possiblyDead inference per battle (trip-aware now: units that
    // confirmed-arrived at a heal/shop/base destination are NOT possibly dead).
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

    // PASS F.1 — candidate trips per participant. Done BEFORE the tracker box
    // so we can exclude tripping unit positions from the box samples (this is
    // the fix for "box follows lone grunt to the fountain off-screen"). Pass 2
    // and Pass 3 (cross-battle context + confidence filter) run later, after
    // all clusters exist.
    const uuidList = [...participantUuids];
    const candidateTrips = this._pass1_detectCandidateTrips(cluster, uuidList);

    // Build a uuid → departedAt map for the tracker box to consult.
    const tripDepartedByUuid = new Map();
    for (const t of candidateTrips) {
      if (t.departedAt != null) tripDepartedByUuid.set(t.unitUuid, t.departedAt);
    }

    // Tracker box construction — excludes tripping unit positions after their
    // individual departedAt time.
    const trackerBox = this._buildTrackerBox(cluster, uuidList, tripDepartedByUuid);
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
      unitTrips: candidateTrips,  // refined by Pass 2/3 after all clusters exist
      _teamSet: teamSet,
      _participantUuids: [...participantUuids],
      _rawSignalCount: cluster.signals.length,
      _hostileSignals: cluster._hostileSignals
    };

    battle.category = this._categorize(battle);
    return battle;
  }

  _buildTrackerBox (cluster, participantUuids, tripDepartedByUuid) {
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
        // Trip exclusion: once a unit has departed for a trip, its later
        // positions don't grow the battle box. The grunt walking to the
        // fountain stops dragging the camera off-screen.
        if (tripDepartedByUuid && tripDepartedByUuid.has(uuid)) {
          const departedAt = tripDepartedByUuid.get(uuid);
          if (t > departedAt) continue;
        }
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
  // PASS F — Macro / trip detection
  //
  // A "trip" = a participant unit leaves the battle for a recognizable WC3
  // destination (fountain heal, shop, moonwell, base, expansion). Used for
  //   (a) tracker-box exclusion (the box stops following the tripping unit)
  //   (b) banner display (e.g. "1 → 💧 fountain")
  //   (c) refining the possiblyDead pass — a unit that confirmably arrived at
  //       a fountain is alive, not dead, even if its path goes quiet there.
  //
  // Three passes:
  //   F.1 — _pass1_detectCandidateTrips (per-cluster, runs inside _finalizeCluster
  //         so the tracker box can use the results immediately).
  //   F.2 — _pass2_refineTripsContext (cross-battle: re-engage linking).
  //   F.3 — _pass3_filterTrips (per-battle confidence filter + per-unit cap).
  // ---------------------------------------------------------------------------

  _pass1_detectCandidateTrips (cluster, participantUuids) {
    const uuidToUnit = this._buildUuidIndex(participantUuids);
    const trips = [];

    for (const uuid of participantUuids) {
      const unit = uuidToUnit.get(uuid);
      if (!unit) continue;
      if (unit.isBuilding) continue;     // buildings don't trip
      if (unit.isIllusion) continue;
      if (unit.meta && unit.meta.worker) continue;   // workers retreating to base is noise

      const trip = this._detectTripForUnit(cluster, unit, uuid);
      if (trip) trips.push(trip);
    }

    return trips;
  }

  // Find the unit's last in-battle engagement (signal or fallback path
  // sample), then walk path forward looking for arrival at a known destination.
  // Returns one trip object or null. Cap of one trip per unit per cluster at
  // pass 1; yo-yo collapse happens later.
  _detectTripForUnit (cluster, unit, uuid) {
    const lastEng = this._findLastEngagement(cluster, unit, uuid);
    if (!lastEng) return null;

    // Must have been engaged a meaningful amount of time before leaving counts
    // as a trip — otherwise pre-engagement positioning gets tagged.
    if (lastEng.time - cluster.startTime < C.TRIP_MID_BATTLE_GRACE_MS) {
      // unit only briefly involved; still check for a trip if it left
      // immediately afterward (a probe peel-off is a real macro pattern).
    }

    const walkEnd = cluster.endTime + C.TRIP_LOOKAHEAD_MS;
    const path = unit.path || [];

    let departedAt = null;
    let departedFrom = null;
    const depD2 = C.TRIP_DEPARTURE_DISTANCE * C.TRIP_DEPARTURE_DISTANCE;
    const dstD2 = C.TRIP_DESTINATION_DISTANCE * C.TRIP_DESTINATION_DISTANCE;
    const baseD2 = C.TRIP_BASE_DISTANCE * C.TRIP_BASE_DISTANCE;

    // Walk path forward from last engagement. Linear scan — paths are small
    // (~hundreds of samples) and we early-out on arrival.
    for (const sample of path) {
      if (sample.gameTime <= lastEng.time) continue;
      if (sample.gameTime > walkEnd) break;
      if (sample.isJump) continue;   // teleport doesn't constitute a trip

      const dxFromEng = sample.x - lastEng.position.x;
      const dyFromEng = sample.y - lastEng.position.y;
      const d2FromEng = dxFromEng * dxFromEng + dyFromEng * dyFromEng;

      if (departedAt == null) {
        if (d2FromEng > depD2) {
          departedAt = sample.gameTime;
          departedFrom = { x: lastEng.position.x, y: lastEng.position.y };
        }
        continue;
      }

      // Departed; look for arrival at a known destination.
      const arrival = this._checkTripArrival(sample, unit, dstD2, baseD2);
      if (arrival) {
        return {
          unitUuid: uuid,
          tag: arrival.tag,
          destination: { x: arrival.x, y: arrival.y },
          destinationKind: arrival.kind,
          destinationOwnerId: arrival.ownerId == null ? null : arrival.ownerId,
          ...(arrival.campUuid ? { campUuid: arrival.campUuid } : {}),
          departedAt,
          arrivedAt: sample.gameTime,
          confidence: 'high'
        };
      }
    }

    // Departed but never arrived at a known destination within the window.
    if (departedAt != null) {
      return {
        unitUuid: uuid,
        tag: 'trip-disengage',
        destination: null,
        destinationKind: null,
        destinationOwnerId: null,
        departedAt,
        arrivedAt: null,
        confidence: 'low'
      };
    }

    return null;
  }

  // Last gameTime+position where the unit was meaningfully engaged in the
  // cluster. Prefer real signals (actor or target); fall back to last
  // in-window path sample.
  _findLastEngagement (cluster, unit, uuid) {
    let bestTime = -Infinity;
    let bestPos = null;
    for (const s of cluster.signals) {
      if (s.actorUnitUuid === uuid || s.targetUnitUuid === uuid) {
        if (s.gameTime > bestTime) {
          bestTime = s.gameTime;
          // Actor signals: actual cast position is more interesting than
          // target. We use the signal's target XY because that's where the
          // interaction landed, which is closer to the unit at the time.
          bestPos = { x: s.targetX, y: s.targetY };
        }
      }
    }
    if (bestTime !== -Infinity && bestPos) return { time: bestTime, position: bestPos };

    // Fallback: last path sample inside [startTime, endTime].
    const path = unit.path || [];
    let fbTime = null, fbPos = null;
    for (const p of path) {
      if (p.gameTime < cluster.startTime) continue;
      if (p.gameTime > cluster.endTime) break;
      fbTime = p.gameTime;
      fbPos = { x: p.x, y: p.y };
    }
    if (fbTime != null) return { time: fbTime, position: fbPos };

    return null;
  }

  // Check whether `sample` is close enough to a trip destination to count as
  // arrived. Order matters — fountains/moonwells are more specific than base.
  _checkTripArrival (sample, unit, dstD2, baseD2) {
    const ownerId = unit._registryOwnerPlayerId;

    // Fountains and shops embedded in neutral camps. The parser exports
    // group.units WITHOUT per-unit positions (see NeutralGroup.exportGroup —
    // unit x/y are unset), but group.bounds has the camp bbox. Use the bbox
    // center as the "destination point" — it's accurate enough for arrival
    // detection (a fountain camp footprint is ~1000 game units).
    if (this.world && this.world.neutralGroups) {
      const groupUuids = Object.keys(this.world.neutralGroups).sort();
      for (const gu of groupUuids) {
        const group = this.world.neutralGroups[gu];
        if (!group || !group.units || !group.bounds) continue;
        const cx = (group.bounds.minX + group.bounds.maxX) / 2;
        const cy = (group.bounds.minY + group.bounds.maxY) / 2;
        const dx = sample.x - cx;
        const dy = sample.y - cy;
        if (dx * dx + dy * dy > dstD2) continue;

        // Inside the camp bbox — determine destination kind by scanning
        // the camp's units for a fountain / shop itemId.
        let hit = null;
        for (const ngUnit of group.units) {
          if (C.TRIP_FOUNTAIN_HEAL_IDS.has(ngUnit.itemId)) { hit = 'trip-fountain-heal'; break; }
          if (C.TRIP_FOUNTAIN_MANA_IDS.has(ngUnit.itemId)) { hit = 'trip-fountain-mana'; break; }
          if (C.TRIP_SHOP_IDS.has(ngUnit.itemId))          { hit = 'trip-shop';          break; }
        }
        if (hit) {
          const kind = hit.replace('trip-', '');
          return { tag: hit, x: cx, y: cy, kind, ownerId: null, campUuid: group.uuid };
        }
      }
    }

    // Own moonwell / town halls. Skip if we don't know the owner.
    if (ownerId == null) return null;
    const ownerPlayer = this.playerManager.players[ownerId];
    if (!ownerPlayer || !ownerPlayer.units) return null;

    for (const b of ownerPlayer.units) {
      if (!b.isBuilding) continue;
      if (b.destroyed) continue;
      if (b.currentX == null || b.currentY == null) continue;
      const dx = sample.x - b.currentX;
      const dy = sample.y - b.currentY;
      const d2 = dx * dx + dy * dy;

      if (C.TRIP_MOONWELL_IDS.has(b.itemId) && d2 <= dstD2) {
        return { tag: 'trip-moonwell', x: b.currentX, y: b.currentY, kind: 'moonwell', ownerId };
      }

      if (C.EXPANSION_BUILDING_IDS.has(b.itemId) && d2 <= baseD2) {
        const sp = ownerPlayer.startingPosition;
        let isStart = false;
        if (sp) {
          const sdx = b.currentX - sp.x;
          const sdy = b.currentY - sp.y;
          isStart = (sdx * sdx + sdy * sdy) < (1000 * 1000);
        }
        return {
          tag: isStart ? 'trip-base-return' : 'trip-expansion',
          x: b.currentX, y: b.currentY,
          kind: isStart ? 'base' : 'expansion',
          ownerId
        };
      }
    }

    return null;
  }

  // PASS F.2 — cross-battle context. Two effects:
  //   - If a tripping unit shows up in a later battle within TRIP_REENGAGE_MAX_MS,
  //     re-tag the trip as 'trip-reengage' (the unit didn't go heal, it
  //     redeployed). Useful because Pass 1 sees a unit moving away but doesn't
  //     yet know it's about to fight again.
  //   - Stamp 'diedEnRoute: true' on trips for units the next pass marks as
  //     possiblyDead with a lastSeenTime before arrivedAt.
  _pass2_refineTripsContext (battles) {
    // Build a uuid → sorted list of battle indices it participates in.
    const byUuid = new Map();
    for (let i = 0; i < battles.length; i++) {
      for (const u of battles[i]._participantUuids) {
        if (!byUuid.has(u)) byUuid.set(u, []);
        byUuid.get(u).push(i);
      }
    }
    // Already in chronological order (battles is sorted by startTime).

    for (let i = 0; i < battles.length; i++) {
      const battle = battles[i];
      if (!battle.unitTrips || !battle.unitTrips.length) continue;

      for (const trip of battle.unitTrips) {
        const list = byUuid.get(trip.unitUuid) || [];
        // Find first later battle this unit is in.
        for (const j of list) {
          if (j <= i) continue;
          const other = battles[j];
          if (other.startTime <= trip.departedAt) continue;
          const gap = other.startTime - trip.departedAt;
          if (gap > C.TRIP_REENGAGE_MAX_MS) break;
          trip.tag = 'trip-reengage';
          trip.destinationKind = 'reengage';
          trip.reengageBattleId = other.id;
          trip.confidence = 'high';
          // Keep departedAt/arrivedAt — arrivedAt for a re-engage is the
          // moment they re-enter the next battle.
          trip.arrivedAt = other.startTime;
          break;
        }
      }
    }
  }

  // PASS F.3 — per-battle confidence + per-unit cap.
  //   - Drop 'low'-confidence trips when a 'high' exists for the same unit.
  //   - Cap to TRIP_MAX_PER_UNIT_PER_BATTLE.
  //   - Collapse yo-yo trips (same destinationKind within TRIP_YOYO_COLLAPSE_MS).
  _pass3_filterTrips (trips) {
    if (!trips || !trips.length) return [];

    const byUuid = new Map();
    for (const t of trips) {
      if (!byUuid.has(t.unitUuid)) byUuid.set(t.unitUuid, []);
      byUuid.get(t.unitUuid).push(t);
    }

    const out = [];
    const uuids = [...byUuid.keys()].sort();
    for (const uuid of uuids) {
      let list = byUuid.get(uuid);
      // Drop low-confidence trips if a high exists.
      if (list.some(t => t.confidence === 'high')) {
        list = list.filter(t => t.confidence === 'high');
      }
      // Yo-yo collapse: trips to same kind within YOYO_COLLAPSE_MS become one.
      list.sort((a, b) => a.departedAt - b.departedAt);
      const collapsed = [];
      for (const t of list) {
        const last = collapsed[collapsed.length - 1];
        if (last && last.destinationKind === t.destinationKind &&
            (t.departedAt - last.departedAt) < C.TRIP_YOYO_COLLAPSE_MS) {
          // Extend coverage of `last` to include this round-trip
          if (t.arrivedAt != null) last.arrivedAt = t.arrivedAt;
          continue;
        }
        collapsed.push({ ...t });
      }
      // Cap per unit.
      out.push(...collapsed.slice(0, C.TRIP_MAX_PER_UNIT_PER_BATTLE));
    }

    // Stable sort: by departedAt then unitUuid.
    out.sort((a, b) => {
      if (a.departedAt !== b.departedAt) return a.departedAt - b.departedAt;
      return a.unitUuid < b.unitUuid ? -1 : a.unitUuid > b.unitUuid ? 1 : 0;
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // PASS E — possiblyDead inference
  // ---------------------------------------------------------------------------

  _inferUnitOutcomes (battle) {
    const outcomes = [];
    const uuidToUnit = this._buildUuidIndex(battle._participantUuids);
    const grace = C.PD_TAIL_GRACE_MS;
    const quiet = C.PD_QUIET_AFTER_MS;

    // Trip-aware: units that confirmed-arrived at a heal/shop/base/etc. are
    // alive, not possibly dead, even if their path goes quiet at the
    // destination. Reengages are also alive (they fought in another battle).
    const aliveByTrip = new Set(
      (battle.unitTrips || [])
        .filter(t => t.confidence === 'high'
                  && t.tag !== 'trip-disengage'
                  && t.tag !== 'trip-reengage'
                  && t.arrivedAt != null)
        .map(t => t.unitUuid)
    );
    const reengaged = new Set(
      (battle.unitTrips || [])
        .filter(t => t.tag === 'trip-reengage')
        .map(t => t.unitUuid)
    );

    for (const uuid of battle._participantUuids) {
      const u = uuidToUnit.get(uuid);
      if (!u) continue;
      if (u.isBuilding) continue;
      if (u.isIllusion) continue;

      // Trip-aware short-circuit: if Pass F confirmed this unit arrived at a
      // heal/shop/base/expansion destination, they're alive at that spot.
      // Re-engagers fought in another battle — also alive.
      if (aliveByTrip.has(uuid) || reengaged.has(uuid)) {
        outcomes.push({
          unitUuid: uuid,
          status: 'alive',
          lastSeenTime: battle.endTime,
          confidence: 'medium'
        });
        continue;
      }

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
