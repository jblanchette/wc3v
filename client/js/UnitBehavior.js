/**
 * UnitBehavior — the single authority for what a unit is DOING at a given time.
 *
 * Replaces the animation-state decisions that were scattered through
 * UnitModelRenderer. The governing rule, and the reason this file exists:
 *
 *     A unit standing still beats a unit attacking nothing.
 *
 * Replays do not record attacks. They record orders and positions. Everything
 * else is inference, so the old renderer inferred generously: a unit played its
 * attack animation if it was stationary and appeared anywhere in a detected
 * battle's participant list -- for the WHOLE battle window (measured up to 49
 * seconds), with no target, no range test, and no check that an enemy was even
 * nearby. A second rule added any stationary unit within ~822 units of a
 * "disturbed" creep camp, and camps stay disturbed from first contact until
 * cleared (measured up to 10.7 minutes; 10 of 101 camps never clear at all).
 * The result was armies swinging at empty air for minutes.
 *
 * Here, an attack requires TWO independent things to be true:
 *   1. GEOMETRY    -- a specific living hostile is actually within reach, and
 *                     for melee, has been in contact long enough to swing at.
 *   2. CORROBORATION -- the replay has some reason to believe a fight is
 *                     happening here (battle window, a recent attack order, or
 *                     a disturbed camp).
 * Missing either one means idle. Not "attack anyway" -- idle.
 *
 * ---------------------------------------------------------------------------
 * SEEK SAFETY is the hard constraint on everything below.
 *
 * Scrubbing backward must reproduce exactly the pose scrubbing forward did, so
 * every function here is a pure function of (gameTime, immutable replay data).
 * That rules out the obvious implementations of two things:
 *   - hysteresis, which normally needs frame-to-frame memory. Solved by making
 *     the test symmetric in time (see isMoving).
 *   - turn-toward-target, which normally integrates rotation per frame. Solved
 *     by deriving the turn's start time from the data (see facingFor).
 * This module also never touches ClientUnit.recordIndexes -- it binary-searches
 * paths itself, because that shared forward-only cursor is exactly the kind of
 * hidden history that makes seeking non-idempotent.
 *
 * UMD: window.UnitBehavior in the browser, module.exports in node -- so the
 * verification harness runs THIS code rather than a reimplementation of it.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.UnitBehavior = mod;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  // Frozen so the harness asserts against the same numbers the viewer runs.
  // Changing a tunable has to be a deliberate edit in both places.
  const C = Object.freeze({
    // --- movement -----------------------------------------------------------
    // KinematicResim emits path samples adaptively, up to 400ms apart on
    // straights. A ±300ms half-window guarantees the speed estimate never rests
    // on a single degenerate segment.
    SPEED_SMOOTH_MS: 300,
    MOVE_ON_WU_S: 55,        // clearly walking (~20% of the slowest unit's speed)
    MOVE_OFF_WU_S: 20,       // clearly not walking
    MOVE_HYST_MS: 500,       // half-width of the symmetric hysteresis window

    // --- target resolution --------------------------------------------------
    // Unbought tavern heroes sit parked at the tavern forever AND appear in
    // battle participant sets -- measured as 3 of 10 "in range" hits at
    // distance 0. Without this gate the new logic invents targets that are
    // worse than the bug it replaces.
    STALE_POSITION_MS: 45000,
    MELEE_TOL: 48,           // slop on range+rA+rB; tight, melee must be touching
    RANGED_TOL: 64,          // = CombatFormation MIN_STOP; the server parks ranged at exactly `range`
    MELEE_CONTACT_MS: 400,   // contact must hold this long before a melee swing
    ORDER_WINDOW_MS: 6000,   // how long a combatOrderTime licenses an attack

    // --- facing / awareness -------------------------------------------------
    ACQ_TICK_MS: 125,        // absolute-grid backward scan step (frame-rate independent)
    ACQ_LOOKBACK_TICKS: 16,  // 2s lookback
    AWARE_MULT: 1.6,         // "idle but watching" radius, approximating the missing `acquire`
    AWARE_FLOOR: 500,
    TURN_RAD_PER_FRAME_CAP: 0.2,  // mirrors KinematicResim
    WC3_FRAME_MS: 30,             // mirrors KinematicResim

    MAX_TARGET_RADIUS: 176   // largest observed collisionSize; sizes the hash query
  });

  // --- path gap rule: identical to ClientUnit.isPathGap / KinematicResim -----
  const PATH_MIN_TIME_GAP = 5 * 1000;
  const PATH_MIN_GAP_DIST = 1500;
  const PATH_MAX_TIME_GAP = 300 * 1000;
  const PATH_MAX_GAP_DIST = 500;
  const PATH_IDLE_GAP_TIME = 10 * 1000;

  function isPathGap (a, b) {
    if (!a || !b) return false;
    if (b.isJump) return true;
    const dt = b.gameTime - a.gameTime;
    if (dt > PATH_IDLE_GAP_TIME) return true;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > PATH_MIN_GAP_DIST && dt < PATH_MIN_TIME_GAP) return true;
    if (dist > PATH_MAX_GAP_DIST && dt > PATH_MAX_TIME_GAP) return true;
    return false;
  }

  /** Last index with path[i].gameTime <= t, or -1. Binary search — no cursor. */
  function pathIndexAt (path, t) {
    if (!path || !path.length || t < path[0].gameTime) return -1;
    let lo = 0, hi = path.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (path[mid].gameTime <= t) { best = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return best;
  }

  /**
   * Position/facing at t. `ageMs` is how stale the underlying sample is, which
   * is what exposes parked ghosts.
   */
  function sampleAt (path, t) {
    const i = pathIndexAt(path, t);
    if (i < 0) return null;
    const a = path[i], b = path[i + 1];
    const out = { x: a.x, y: a.y, facing: a.facing, index: i, sampleTime: a.gameTime, ageMs: t - a.gameTime };
    if (!b || t >= b.gameTime || isPathGap(a, b)) return out;
    const dt = b.gameTime - a.gameTime;
    const f = dt > 0 ? Math.min(1, Math.max(0, (t - a.gameTime) / dt)) : 0;
    out.x = a.x + (b.x - a.x) * f;
    out.y = a.y + (b.y - a.y) * f;
    if (a.facing != null && b.facing != null) {
      let d = b.facing - a.facing;
      if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
      out.facing = a.facing + d * f;
    }
    return out;
  }

  /**
   * Speed of the path segment containing t, in world units/sec.
   *
   * Reads the segment directly instead of finite-differencing two interpolated
   * positions. The old estimator sampled getInterpolatedPosition(t) against
   * (t-100) while reusing the cursor resolved for t, so it clamped at the
   * segment start and reported either whole-segment displacement (up to 4x
   * inflated) or ~0 near a boundary -- which is what dropped walking units into
   * idle mid-stride.
   */
  function segmentSpeed (path, i) {
    if (i < 0 || !path || !path[i]) return 0;
    const a = path[i], b = path[i + 1];
    if (!b || isPathGap(a, b)) return 0;   // end of a run => stopped
    const dt = (b.gameTime - a.gameTime) / 1000;
    if (dt <= 0) return 0;
    return Math.hypot(b.x - a.x, b.y - a.y) / dt;
  }

  /** Time-weighted mean segment speed over [t-W, t+W]. */
  function smoothedSpeed (path, t) {
    if (!path || !path.length) return 0;
    const W = C.SPEED_SMOOTH_MS;
    const lo = t - W, hi = t + W;
    let i = pathIndexAt(path, lo);
    if (i < 0) i = 0;
    let acc = 0, wsum = 0;
    for (; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      if (a.gameTime > hi) break;
      const s = Math.max(lo, a.gameTime), e = Math.min(hi, b.gameTime);
      const w = e - s;
      if (w <= 0) continue;
      acc += segmentSpeed(path, i) * w;
      wsum += w;
    }
    if (wsum > 0) return acc / wsum;
    return segmentSpeed(path, pathIndexAt(path, t));
  }

  /**
   * Deterministic hysteresis, no frame history.
   *
   * "t is moving iff it is above the low threshold AND its above-low region
   * touches an above-high peak within ±MOVE_HYST_MS." Morphological
   * reconstruction rather than a latch -- symmetric in time, so scrubbing
   * backward gives the identical answer, which is the whole requirement. A
   * frame-to-frame latch could never satisfy it.
   */
  function isMoving (path, t) {
    if (smoothedSpeed(path, t) <= C.MOVE_OFF_WU_S) return false;
    const step = C.ACQ_TICK_MS;
    for (let s = t - C.MOVE_HYST_MS; s <= t + C.MOVE_HYST_MS; s += step) {
      if (smoothedSpeed(path, s) > C.MOVE_ON_WU_S) return true;
    }
    return false;
  }

  // weaponType is the engine's own melee/ranged answer. It disagrees with a
  // `range <= 150` test on only 4 of 609 units, and handles the long-reach Naga
  // heroes correctly. (CombatFormation.classifyRole still uses the range test;
  // changing it would move server-side formation positions and force a reparse.)
  function isMelee (meta) {
    const wt = meta && meta.combat && meta.combat.weaponType;
    return wt === 'normal';
  }

  function readyTimeOf (u) {
    return (u.readyTime != null) ? u.readyTime : u.spawnTime;
  }

  function deathStartOf (u) {
    if (u.destroyedAt != null) return u.destroyedAt;
    if (u.lostState && u.lostState.state === 'lost') return u.lostState.since;
    return null;
  }

  function angDiff (to, from) {
    let d = to - from;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function rotateClamped (from, to, budget) {
    const d = angDiff(to, from);
    return from + Math.max(-budget, Math.min(budget, d));
  }

  // ---------------------------------------------------------------------------

  class World {
    /**
     * @param {object} opts
     *   units   - flat array of unit-like records, each tagged with _playerId,
     *             _teamId, _isNeutral. Includes buildings (target-only).
     *   battles - mapData.battles
     *   camps   - mapData.world.neutralGroups
     */
    constructor (opts) {
      this.units = (opts && opts.units) || [];
      this.battles = (opts && opts.battles) || [];
      this.camps = (opts && opts.camps) || {};
      this._memoTime = NaN;
      this._memoFrame = null;
      this._grid = new Map();
    }

    setUnits (units) { this.units = units || []; this._memoTime = NaN; }

    /** Memoized on the exact gameTime, so every consumer shares one frame. */
    resolve (gameTime) {
      if (gameTime === this._memoTime && this._memoFrame) return this._memoFrame;
      this._memoFrame = this._build(gameTime);
      this._memoTime = gameTime;
      return this._memoFrame;
    }

    // -- internals ------------------------------------------------------------

    _campPhase (camp, t) {
      const engagedAt = camp.firstInteractionTime;
      if (engagedAt == null || t < engagedAt) return 'pristine';
      let clearedAt = camp.clearedTime;
      // CLAIM_CLEARED === 2 (NeutralGroup ClaimStates.cleared) — must match
      // UnitModelRenderer's CLAIM_CLEARED, or camps disagree about being cleared.
      if (clearedAt == null && camp.claimState === 2) {
        clearedAt = (camp.settledClear && camp.settledClear.gameTime != null)
          ? camp.settledClear.gameTime
          : (camp.claimTime != null ? camp.claimTime : engagedAt);
      }
      return (clearedAt != null && t >= clearedAt) ? 'cleared' : 'disturbed';
    }

    _battleSetAt (t) {
      const set = new Set();
      for (const b of this.battles) {
        if (t < b.startTime || t > b.endTime || !b.participants) continue;
        for (const p of b.participants) {
          const us = p.unitUuids || [];
          for (let i = 0; i < us.length; i++) set.add(us[i]);
        }
      }
      return set;
    }

    _hasRecentOrder (u, t) {
      const times = u.combatOrderTimes;
      if (!times || !times.length) return false;
      for (let i = times.length - 1; i >= 0; i--) {
        const dt = t - times[i];
        if (dt < 0) continue;
        if (dt <= C.ORDER_WINDOW_MS) return true;
        return false;   // sorted; anything earlier is further away
      }
      return false;
    }

    _build (t) {
      const live = [];
      const inBattle = this._battleSetAt(t);

      for (const u of this.units) {
        const ready = readyTimeOf(u);
        if (ready != null && t < ready) continue;
        const d = deathStartOf(u);
        if (d != null && t >= d) continue;                 // corpse: not a target
        if (u._isLoadedAt && u._isLoadedAt(t)) continue;    // inside a transport

        const isCamp = u.neutralGroupId != null;
        let x, y, sampleTime, ageMs, facing;
        const s = sampleAt(u.path, t);
        if (s) {
          x = s.x; y = s.y; sampleTime = s.sampleTime; ageMs = s.ageMs; facing = s.facing;
        } else if (isCamp && u.spawnPosition) {
          // Camp creeps have single-sample paths by construction (ClientUnit
          // never advances neutral players' path cursor), so they legitimately
          // have no interpolated position. Their spawn point IS their position.
          x = u.spawnPosition.x; y = u.spawnPosition.y;
          sampleTime = 0; ageMs = 0; facing = null;
        } else continue;

        // Staleness gate — the ghost filter. Camp creeps are exempt: they are
        // static by design, not abandoned. This is the ONLY exemption.
        if (!isCamp && ageMs > C.STALE_POSITION_MS) continue;

        live.push({
          u, uuid: u.uuid, x, y, facing, sampleTime,
          r: u.collisionSize || 0,
          teamId: u._teamId,
          isNeutral: !!u._isNeutral,
          isCamp,
          targetOnly: !!u.isBuilding
        });
      }

      // Spatial hash, integer keys (same 128wu cell as the separation pass).
      const CELL = 128;
      const grid = this._grid;
      grid.clear();
      for (let i = 0; i < live.length; i++) {
        const k = (Math.floor(live[i].x / CELL) + 32768) * 65536 + (Math.floor(live[i].y / CELL) + 32768);
        let b = grid.get(k); if (!b) grid.set(k, b = []); b.push(i);
      }
      const query = (x, y, radius, out) => {
        out.length = 0;
        const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
        const span = Math.ceil(radius / CELL);
        for (let ay = gy - span; ay <= gy + span; ay++) {
          for (let ax = gx - span; ax <= gx + span; ax++) {
            const b = grid.get((ax + 32768) * 65536 + (ay + 32768));
            if (b) for (let j = 0; j < b.length; j++) out.push(b[j]);
          }
        }
        return out;
      };

      const byUuid = new Map();
      const campsEngaged = new Set();
      const stats = { walk: 0, attack: 0, idle: 0, suppressedNoTarget: 0, bySource: { battle: 0, order: 0, camp: 0 } };
      const scratch = [];

      for (const a of live) {
        if (a.targetOnly) continue;   // buildings are targets, not actors

        const meta = a.u.meta || {};
        const combat = meta.combat;

        // --- WALK wins over everything: you cannot swing while walking.
        if (!a.isCamp && isMoving(a.u.path, t)) {
          const spd = smoothedSpeed(a.u.path, t);
          const base = meta.movespeed || 270;
          byUuid.set(a.uuid, {
            uuid: a.uuid, state: 'walk', x: a.x, y: a.y,
            facing: a.facing, bakedFacing: a.facing, speed: spd,
            strideScale: Math.max(0.45, Math.min(1.8, spd / base)),
            melee: isMelee(meta), targetUuid: null, reason: 'moving'
          });
          stats.walk++;
          continue;
        }

        const emitIdle = (reason, aim) => {
          let facing = a.facing;
          if (aim) facing = this._facingFor(a, aim, t);
          byUuid.set(a.uuid, {
            uuid: a.uuid, state: 'idle', x: a.x, y: a.y,
            facing, bakedFacing: a.facing, speed: 0, strideScale: 1,
            melee: isMelee(meta), targetUuid: null,
            aimUuid: aim ? aim.uuid : null, reason
          });
          stats.idle++;
        };

        if (!combat) { emitIdle('no-weapon', null); continue; }

        // --- CORROBORATION (cheap; evaluated before the spatial query) -------
        let src = null;
        if (inBattle.has(a.uuid)) src = 'battle';
        else if (this._hasRecentOrder(a.u, t)) src = 'order';
        else if (a.isCamp) {
          const camp = this.camps[a.u.neutralGroupId];
          if (camp && this._campPhase(camp, t) === 'disturbed') src = 'camp';
        }

        const melee = isMelee(meta);
        const reach0 = (combat.range || 0) + a.r + C.MAX_TARGET_RADIUS +
          (melee ? C.MELEE_TOL : C.RANGED_TOL);

        // --- GEOMETRY: find the nearest valid hostile actually in reach ------
        let best = null, bestD = Infinity;
        const idxs = query(a.x, a.y, reach0, scratch);
        for (let n = 0; n < idxs.length; n++) {
          const c = live[idxs[n]];
          if (c === a) continue;
          // Hostility: neutral creeps are hostile to players and vice versa;
          // players are hostile to different teams. Creeps never fight creeps.
          if (a.isCamp ? c.isNeutral : (c.teamId === a.teamId)) continue;
          const reach = (combat.range || 0) + a.r + c.r + (melee ? C.MELEE_TOL : C.RANGED_TOL);
          const d = Math.hypot(c.x - a.x, c.y - a.y);
          if (d > reach) continue;
          // Deterministic tie-break: nearest, then lowest uuid. Never iteration order.
          if (d < bestD || (d === bestD && best && c.uuid < best.uuid)) { best = c; bestD = d; }
        }

        if (!src) {
          // No reason to believe a fight is happening — but still turn to watch
          // a nearby threat, which is what a unit on guard actually looks like.
          emitIdle('no-corroboration', best);
          continue;
        }

        if (!best) {
          const aim = this._nearestThreat(a, live, query, scratch,
            Math.max((combat.range || 0) * C.AWARE_MULT, C.AWARE_FLOOR));
          emitIdle('no-target', aim);
          stats.suppressedNoTarget++;
          continue;
        }

        // Melee needs SUSTAINED contact: a target sprinting past is not
        // something a stationary unit gets to swing at.
        const dwell = this._contactDwell(a, best, t);
        if (melee && dwell < C.MELEE_CONTACT_MS) { emitIdle('no-contact', best); continue; }

        const period = Math.max(combat.cooldown || 0,
          (combat.damagePoint || 0) + (combat.backswing || 0)) || 1;
        const anchor = Math.max(a.sampleTime, t - dwell);
        const phase = (((t - anchor) / 1000) % period + period) % period;
        const swingWindow = ((combat.damagePoint || 0) + (combat.backswing || 0)) || period;

        byUuid.set(a.uuid, {
          uuid: a.uuid, state: 'attack', x: a.x, y: a.y,
          facing: this._facingFor(a, best, t), bakedFacing: a.facing,
          speed: 0, strideScale: 1, melee,
          targetUuid: best.uuid, targetX: best.x, targetY: best.y, targetDist: bestD,
          swingPeriod: period, swingPhase: phase,
          clipFill: Math.min(1, phase / swingWindow),
          acqTime: anchor, reason: src
        });
        stats.attack++;
        stats.bySource[src]++;
        if (a.isCamp) campsEngaged.add(a.u.neutralGroupId);
      }

      return { gameTime: t, byUuid, live, inBattle, campsEngaged, stats };
    }

    _nearestThreat (a, live, query, scratch, radius) {
      let best = null, bestD = Infinity;
      const idxs = query(a.x, a.y, radius, scratch);
      for (let n = 0; n < idxs.length; n++) {
        const c = live[idxs[n]];
        if (c === a || c.targetOnly) continue;
        if (a.isCamp ? c.isNeutral : (c.teamId === a.teamId)) continue;
        const d = Math.hypot(c.x - a.x, c.y - a.y);
        if (d > radius) continue;
        if (d < bestD || (d === bestD && best && c.uuid < best.uuid)) { best = c; bestD = d; }
      }
      return best;
    }

    /**
     * How long `a` and `c` have continuously been in reach, sampled on an
     * ABSOLUTE time grid so the answer never depends on frame rate or on how
     * playback arrived at t. Doubles as the facing-acquisition anchor.
     */
    _contactDwell (a, c, t) {
      const Q = C.ACQ_TICK_MS, K = C.ACQ_LOOKBACK_TICKS;
      const meta = a.u.meta || {};
      const combat = meta.combat || {};
      const melee = isMelee(meta);
      const reach = (combat.range || 0) + a.r + c.r + (melee ? C.MELEE_TOL : C.RANGED_TOL);
      const tq = Math.floor(t / Q) * Q;
      for (let j = 1; j <= K; j++) {
        const s = tq - j * Q;
        if (s < 0) return j * Q;
        const pa = a.isCamp ? a : sampleAt(a.u.path, s);
        const pc = c.isCamp ? c : sampleAt(c.u.path, s);
        if (!pa || !pc) return j * Q;
        if (Math.hypot(pc.x - pa.x, pc.y - pa.y) > reach) return j * Q;
      }
      return K * Q;
    }

    /**
     * Turn-rate-limited facing toward a target, with ZERO integration.
     *
     * The turn's start is derived from data (whichever is later: when the unit
     * stopped, or when the pair came into contact), so facing is a pure function
     * of t. At the walk->attack boundary the budget is 0, so facing equals the
     * walking facing and there is no pop.
     */
    _facingFor (a, target, t) {
      const base = (a.facing != null) ? a.facing : Math.atan2(target.y - a.y, target.x - a.x);
      const meta = a.u.meta || {};
      const ratePerMs = Math.min(meta.turnRate != null ? meta.turnRate : 0.6,
        C.TURN_RAD_PER_FRAME_CAP) / C.WC3_FRAME_MS;
      const anchor = Math.max(a.sampleTime, t - this._contactDwell(a, target, t));
      const budget = Math.min(Math.PI, ratePerMs * Math.max(0, t - anchor));
      const desired = Math.atan2(target.y - a.y, target.x - a.x);
      return rotateClamped(base, desired, budget);
    }
  }

  return {
    VERSION: 1,
    C,
    isPathGap,
    pathIndexAt,
    sampleAt,
    segmentSpeed,
    smoothedSpeed,
    isMoving,
    isMelee,
    readyTimeOf,
    deathStartOf,
    angDiff,
    rotateClamped,
    createWorld: (opts) => new World(opts)
  };
});
