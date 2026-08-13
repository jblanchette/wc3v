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

    // Distance quantum for choosing between candidate targets.
    //
    // Raw argmin over distance is a knife edge: two enemies at 412 and 418 units
    // swap the "nearest" slot every time either one takes a step, and the actor
    // re-aims at whichever won this frame. Measured as ~32% of all faster-than-
    // engine rotation, and it is worst for RANGED units because a 500-range
    // weapon has many candidates inside reach where a 100-range one has about
    // one. Quantizing the comparison means a challenger must be a clear bucket
    // closer to take the slot; inside a bucket the uuid tie-break is
    // time-invariant, so the same unit wins on every frame. Still a pure
    // function of the frame's geometry — no history, so still seek-safe.
    TARGET_BUCKET_WU: 256,

    // --- facing / awareness -------------------------------------------------
    ACQ_TICK_MS: 125,        // absolute-grid backward scan step (frame-rate independent)
    ACQ_LOOKBACK_TICKS: 16,  // 2s lookback
    // Fallback awareness radius, used ONLY when a unit's real `acquire` is
    // missing (a pre-v2 unitCombat.json, or a unit with no weapon row). The
    // engine's actual acquisition range now comes from unitweapons.slk via
    // acquireRange() — footman 500, archer 800, mortar 1150 — rather than this
    // one-size approximation.
    AWARE_MULT: 1.6,
    AWARE_FLOOR: 500,
    TURN_RAD_PER_FRAME_CAP: 0.2,  // mirrors KinematicResim
    WC3_FRAME_MS: 30,             // mirrors KinematicResim

    // Largest collisionSize in the game data; sizes the hash query so no valid
    // target can fall outside the candidate set. 196, not the 176 this used to
    // say — that was the largest radius seen back when buildings were being
    // filtered out of the live set entirely, so the biggest structures were
    // never sampled. Verified against helpers/UnitBalance.json (and the other
    // generated tables, which agree): the true maximum is 196.
    //
    // Too small here is a SILENT failure: the target never enters the candidate
    // set, so no reach check rejects it and no invariant notices it is gone.
    MAX_TARGET_RADIUS: 196,

    // --- support casters ----------------------------------------------------
    // Replenish Life / Mana (Arpl / Arpm): 700 radius, 1s cooldown, targets
    // friendly units. Straight from abilitydata.slk.
    REPLENISH_RADIUS: 700,
    REPLENISH_PERIOD_S: 1
  });

  // Units that carry a real weapon in the SLK but do not auto-acquire in game.
  // The Obsidian Statue is the melee-relevant one: with Replenish on autocast
  // (its default) it stands and channels, and only swings when the player
  // explicitly orders an attack. Treating its weapon like a grunt's made every
  // statue near a fight look like a combatant.
  const SUPPORT_CASTER_IDS = new Set(['uobs']);

  // How long each order kind licenses an attack, in ms. Frozen alongside C so
  // the harness asserts the same numbers the viewer runs.
  //
  // These are intent decay windows, not engine constants — the engine has no
  // such thing, an order simply stands until countermanded. They exist because
  // the replay does not record when an order ENDS, so a licence has to expire on
  // its own or a single attack click would corroborate the rest of the game.
  // Scaled by how specific the order is: clicking one enemy says more than
  // walking toward a place where enemies happen to be.
  const ORDER_WINDOWS = Object.freeze({
    attack:       12000,   // clicked a specific enemy
    attackonce:    8000,   // clicked one enemy, no pursuit after
    smartunit:    12000,   // right-clicked an enemy — in WC3 that IS an attack
    attackground: 10000,   // explicit a-move
    patrol:       10000,   // walks and engages
    smartground:   6000,   // walked near enemies; also what a retreat looks like
    // Call to Arms. Same reasoning as _summonCorroboration: the replay records
    // that a specific peasant was converted at a specific time, and the engine
    // guarantees what a militia then does — it is a combat unit that acquires
    // and attacks on its own, with no further order. Without this the militia
    // a player called into a fight stands motionless through it, which is
    // exactly what a peasant would NOT be doing. Bounded by the real 45s
    // militia duration, and countermanded by the 'stop' recorded on Back to
    // Work, so the licence can never outlive the form.
    militia:      45000
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
   * Position of a live-set entry at grid time s, for the dwell and turn scans.
   *
   * Camps keep their entry position outright (single-sample paths by
   * construction). Everything else is path-first with a static fallback for
   * buildings: path-first because an uprooted Ancient is a building with real
   * movement samples, and the fallback because most buildings have no path
   * array at all — measured 62.6% across 10 replays. Asking their path for a
   * position returned null, which pinned melee contact dwell at one tick
   * (every melee unit at a barracks idled on 'no-contact' forever) and starved
   * the facing integrator down to its per-bucket reset — the 8Hz, 45° facing
   * sawtooth on units parked at a building.
   */
  function targetPosAt (e, s) {
    if (e.isCamp) return e;
    return sampleAt(e.u.path, s) || (e.targetOnly ? e : null);
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

  /**
   * The engine's real acquisition radius (unitweapons.slk `acquire`), i.e. how
   * far a unit notices a hostile and starts attacking with no order at all.
   * Footman 500, Archer 800, Rifleman 600, Mortar Team 1150.
   *
   * This replaces the invented `range * 1.6, floor 500` approximation that used
   * to stand in for it. It is only used for AWARENESS (who a corroborated unit
   * keeps facing when nothing is in weapon reach) — a unit still has to be in
   * weapon reach to swing.
   */
  function acquireRange (meta) {
    const c = meta && meta.combat;
    if (c && c.acquire > 0) return c.acquire;
    // Pre-v2 unitCombat.json (or a unit with no acquire row): fall back to the
    // old approximation rather than dropping awareness entirely.
    const r = (c && c.range) || 0;
    return Math.max(r * C.AWARE_MULT, C.AWARE_FLOOR);
  }

  /**
   * Can `attacker`'s weapon legally target `cand`? This is the engine's own
   * answer (unitweapons.slk `targs1`), which the viewer previously had no access
   * to — so a ground-only melee unit could resolve an attack against a flyer and
   * animate swinging at something it cannot reach in game.
   *
   * Conservative on missing data: no targets list means "no opinion", not "no".
   */
  function canTarget (meta, cand) {
    const t = meta && meta.combat && meta.combat.targets;
    if (!t || !t.length) return true;
    const air = cand.isAir;
    if (cand.targetOnly) {
      // Buildings. `structure` is the mask entry; a weapon without it (e.g. the
      // ghoul's tree weapon) cannot hit one. The siege line (umtw/ocat/hmtm/
      // hctw) carries `wall` instead of `structure` in the shipped SLK and
      // demonstrably attacks buildings in game, so `wall` counts as a hit.
      return t.indexOf('structure') !== -1 || t.indexOf('wall') !== -1;
    }
    return t.indexOf(air ? 'air' : 'ground') !== -1;
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

  /**
   * Should `cand` at distance `candD` displace the incumbent `best`?
   *
   * The comparison is bucketed rather than exact — see C.TARGET_BUCKET_WU for
   * why. Inside a bucket the answer is the lowest uuid, which does not change
   * as units move, so the choice holds still frame to frame instead of
   * oscillating between two near-equidistant enemies.
   */
  function betterTarget (cand, candD, best, bestD) {
    if (!best) return true;
    const cb = Math.floor(candD / C.TARGET_BUCKET_WU);
    const bb = Math.floor(bestD / C.TARGET_BUCKET_WU);
    if (cb !== bb) return cb < bb;
    return cand.uuid < best.uuid;
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
      this._indexUnits();
    }

    setUnits (units) { this.units = units || []; this._memoTime = NaN; this._indexUnits(); }

    // uuid -> unit, so a summon can find the hero that cast it. Built once per
    // unit-set rather than per frame; the mapping is immutable for a replay.
    _indexUnits () {
      this._byUuid = new Map();
      for (const u of this.units) if (u && u.uuid) this._byUuid.set(u.uuid, u);
    }

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

    /**
     * The order in force at `t`, from the exported per-unit order stream.
     *
     * Before this stream existed, `combatOrderTimes` was written for WORKERS
     * ONLY, so the 'order' corroboration source was dead for every real combat
     * unit — measured as `order 0` across an eight-replay sweep. An army told in
     * plain terms to attack had no way to be seen as fighting unless the
     * BattleDetector happened to cluster it into a battle.
     *
     * Windows differ by how much the order actually claims:
     *   attack / attackonce  — the player clicked a specific enemy. Unambiguous.
     *   attackground / patrol — attack-move. Still explicit combat intent.
     *   smartunit             — right-clicked an enemy; in WC3 that attacks it.
     *   smartground           — walked toward a place near enemies. Weakest; it
     *                           is also how a retreat THROUGH a fight looks.
     *   holdposition          — stationary but engaging; holds until countermanded.
     *   stop                  — explicitly countermands. Not corroboration.
     *
     * Pure function of `t` — a binary search over an immutable array, no cursor.
     */
    _orderIndexAt (u, t) {
      const orders = u.orders;
      if (!orders || !orders.length) return -1;
      let lo = 0, hi = orders.length - 1, best = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (orders[mid].t <= t) { best = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return best;
    }

    _orderAt (u, t) {
      const i = this._orderIndexAt(u, t);
      if (i < 0) return null;
      const o = u.orders[i];
      // A stop cancels intent outright — no window, no attack license.
      if (o.kind === 'stop') return null;
      // Hold Position persists until something else is ordered, so it is licensed
      // right up to the next order rather than for a fixed window.
      if (o.kind === 'holdposition') return o;
      const window = ORDER_WINDOWS[o.kind];
      if (window == null) return null;
      return (t - o.t) <= window ? o : null;
    }

    /**
     * A summon inherits its caster's corroboration.
     *
     * WC3 summons spawn aggressive: they acquire and chase with no order. But a
     * summon has no path and no orders until the player selects it, so the
     * replay records nothing about it and the viewer animated it standing still
     * through the fight it was summoned into. The Rod of Necromancy skeletons
     * are the case that surfaced this — two of them appear mid-battle and just
     * stand there.
     *
     * This is inference from record, not invention: the replay says a specific
     * hero cast a summon at a specific time and place, and the engine guarantees
     * what the summon then does. The licence is bounded by the summon's own
     * lifetime so it cannot outlive the unit.
     */
    _summonCorroboration (u, t, inBattle) {
      if (!u.summonedBy || u.summonTime == null) return false;
      if (t < u.summonTime) return false;
      if (u.summonDuration > 0 && (t - u.summonTime) > u.summonDuration * 1000) return false;
      const caster = this._byUuid && this._byUuid.get(u.summonedBy);
      if (!caster) return false;
      if (inBattle.has(caster.uuid)) return true;
      return this._hasRecentOrder(caster, t) || !!this._orderAt(caster, t);
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
        // Neutral units OUTSIDE a creep camp are passive map furniture — the
        // tavern, merc/goblin shops, gold mines (invulnerable in WC3), and
        // wandering critters. They are reified at parse time when a player
        // interacts with them and may carry an UNSET (0,0) position, and the
        // hostility test below would treat them as valid enemy targets (they
        // share nobody's teamId). Measured failure: two Crypt Fiends + a Lich
        // at 6:40 in the Storm Bolt replay resolving attack -> "Tavern @ 0,0",
        // rendering as units shooting 180° away from their real fight at an
        // invisible target.
        //
        // Camp members STAY targetable — including the building-flagged guards
        // some maps use (brigand huts, battle golems): those are killable
        // creeps. The one exception is fountains (nfoh/nmoo, per
        // helpers/mappings.js `fountains`): guarded fountains live INSIDE
        // camps but are invulnerable in the engine, so they are never a valid
        // attack target.
        if (u._isNeutral && !isCamp) continue;
        if (u._isNeutral && (u.itemId === 'nfoh' || u.itemId === 'nmoo')) continue;
        // Things that do not move, and are therefore never "abandoned" — see the
        // staleness gate below.
        const isStatic = isCamp || !!u.isBuilding;
        let x, y, sampleTime, ageMs, facing;
        const s = sampleAt(u.path, t);
        if (s) {
          x = s.x; y = s.y; sampleTime = s.sampleTime; ageMs = s.ageMs; facing = s.facing;
        } else if (isStatic && (u.spawnPosition || u.lastPosition)) {
          // Camp creeps have single-sample paths by construction (ClientUnit
          // never advances neutral players' path cursor), so they legitimately
          // have no interpolated position. Their spawn point IS their position.
          //
          // Most BUILDINGS have no path array at all — measured at 25311 of the
          // 46876 standing-building ticks in one replay — so without this they
          // were invisible to combat even after the staleness exemption below.
          // `spawnPosition || lastPosition` is exactly the pair ClientUnit uses
          // to place a building on the map, so the behavior authority and the
          // renderer agree on where the thing is.
          const p = u.spawnPosition || u.lastPosition;
          x = p.x; y = p.y;
          sampleTime = 0; ageMs = 0; facing = null;
        } else continue;

        // Staleness gate — the ghost filter. It exists to catch units that are
        // parked forever and only LOOK present (an unbought tavern hero standing
        // at the tavern, showing up in battle participant sets at distance 0).
        // Anything static is exempt, because "its last position sample is old"
        // carries no information about it.
        //
        // Buildings used to fail this gate and it was why nothing ever animated
        // while attacking one. A building emits one path sample, at spawn, and
        // then never moves — so 45 seconds after it finishes it dropped out of
        // the live set entirely and stopped being a target. Measured at 96.8% of
        // all standing-building ticks in a 15-minute replay: a whole army could
        // be razing a town hall and every unit resolved "no target in reach",
        // which means idle, which means no swing, no projectile, nothing.
        if (!isStatic && ageMs > C.STALE_POSITION_MS) continue;

        live.push({
          u, uuid: u.uuid, x, y, facing, sampleTime,
          r: u.collisionSize || 0,
          teamId: u._teamId,
          isNeutral: !!u._isNeutral,
          isCamp,
          targetOnly: !!u.isBuilding,
          // Flyer? Decides whether a ground-only weapon may target it at all —
          // see canTarget. moveType is the SLK `movetp` from unitMovement.json.
          isAir: !!(u.meta && (u.meta.moveType === 'fly' || u.meta.moveType === 'hover'))
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
      const stats = { walk: 0, attack: 0, idle: 0, replenish: 0, suppressedNoTarget: 0, bySource: { battle: 0, order: 0, camp: 0, summon: 0 } };
      const scratch = [];

      for (const a of live) {
        if (a.targetOnly) continue;   // buildings are targets, not actors

        const meta = a.u.meta || {};
        const combat = meta.combat;

        // --- WALK wins over everything: you cannot swing while walking.
        // Camp creeps reach here too: lib/CreepGuardSim bakes their aggro,
        // chase and leash-back into path[], so a creep with real motion at t is
        // walking for the same reason any other unit is. Creeps that were never
        // pulled keep a single-sample path, where isMoving is false anyway.
        if (isMoving(a.u.path, t)) {
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

        // `aim` is who the unit keeps LOOKING at while it is not swinging —
        // typically the target it just lost reach on. It is passed only on
        // CORROBORATED paths, where the replay says this unit is in a fight.
        //
        // The uncorroborated case used to aim too ("a unit on guard", at the
        // nearest hostile in weapon reach) and it was the single largest source
        // of units pirouetting on the spot: nothing corroborates that aim, so it
        // is rotation invented from a target the unit was never shown to notice,
        // and for a 500-range weapon in a busy area the nearest hostile churns
        // every few frames as an army walks past. Camp creeps and archers
        // watching a march-by accounted for 14 of 19 measured spins in one
        // replay. A unit standing still beats a unit tracking nothing — the rule
        // that governs swinging governs turning.
        const emitIdle = (reason, aim) => {
          byUuid.set(a.uuid, {
            uuid: a.uuid, state: 'idle', x: a.x, y: a.y,
            facing: aim ? this._facingFor(a, aim, t) : a.facing,
            bakedFacing: a.facing, speed: 0, strideScale: 1,
            melee: isMelee(meta), targetUuid: null,
            aimUuid: aim ? aim.uuid : null, reason
          });
          stats.idle++;
        };

        if (!combat) { emitIdle('no-weapon', null); continue; }

        // --- CORROBORATION (cheap; evaluated before the spatial query) -------
        //
        // A 'stop' is NOT a veto. In WC3 it cancels the current order and the
        // unit drops to guard — where it still auto-acquires anything that walks
        // into range. So a stop must not silence the battle or camp sources.
        // Its whole effect is that _orderAt returns null once it is the latest
        // order, which correctly ends the previous order's licence early instead
        // of letting an attack click from ten seconds ago keep running.
        let src = null;
        const order = this._orderAt(a.u, t);
        if (order) src = 'order';
        else if (inBattle.has(a.uuid)) src = 'battle';
        else if (this._hasRecentOrder(a.u, t)) src = 'order';
        else if (a.isCamp) {
          const camp = this.camps[a.u.neutralGroupId];
          if (camp && this._campPhase(camp, t) === 'disturbed') src = 'camp';
        } else if (this._summonCorroboration(a.u, t, inBattle)) src = 'summon';

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
          // The engine's own targeting mask. A grunt cannot hit a gargoyle; a
          // ghoul's second weapon only targets trees. Without this the viewer
          // could resolve an attack it is not allowed to make and animate a
          // melee unit swinging at a flyer overhead.
          if (!canTarget(meta, c)) continue;
          const reach = (combat.range || 0) + a.r + c.r + (melee ? C.MELEE_TOL : C.RANGED_TOL);
          const d = Math.hypot(c.x - a.x, c.y - a.y);
          if (d > reach) continue;
          // Siege minimum range — a mortar team cannot fire at something inside
          // 250 units. Real SLK data (`minRange`), absent before this pass.
          if (combat.minRange > 0 && d < combat.minRange) continue;
          // Bucketed-nearest, then lowest uuid. Never iteration order, and never
          // a raw argmin — see betterTarget.
          if (betterTarget(c, d, best, bestD)) { best = c; bestD = d; }
        }

        // --- SUPPORT CASTERS: an explicit order, or it's channelling ---------
        // A statue in the middle of a fight is not fighting. It has a weapon,
        // but in game it stands and pulses Replenish unless the player right-
        // clicks an enemy, so 'battle'/'camp' corroboration is NOT enough here
        // — only a real attack order is.
        if (SUPPORT_CASTER_IDS.has(a.u.itemId) && src !== 'order') {
          const ally = this._replenishTarget(a, live, query, scratch);
          if (!ally) { emitIdle(src ? 'no-replenish-target' : 'no-corroboration', src ? best : null); continue; }

          // Replenish is an engine-driven autocast pulse — it is never recorded
          // in the replay, so this is SYNTHESIZED, not observed: a statue with a
          // friendly unit inside 700 is assumed to be channelling at it, which
          // is what one is doing for nearly all of its life. The statue's attack
          // and replenish share a single MDX clip ("Attack Spell"), so this
          // reuses the swing cadence and simply aims at the ally instead.
          const period = C.REPLENISH_PERIOD_S;
          const phase = (((t - a.sampleTime) / 1000) % period + period) % period;
          // State is 'cast', NOT 'attack'. They share a clip, but conflating
          // them would defeat the attack invariants (target/reach/corroboration)
          // that exist precisely to stop units animating at nothing.
          byUuid.set(a.uuid, {
            uuid: a.uuid, state: 'cast', x: a.x, y: a.y,
            facing: this._facingFor(a, ally, t), bakedFacing: a.facing,
            speed: 0, strideScale: 1, melee: false,
            targetUuid: ally.uuid, targetX: ally.x, targetY: ally.y,
            targetDist: Math.hypot(ally.x - a.x, ally.y - a.y),
            swingPeriod: period, swingPhase: phase,
            clipFill: Math.min(1, phase / period),
            acqTime: a.sampleTime, isSupportCast: true, reason: 'replenish'
          });
          stats.replenish++;
          continue;
        }

        if (!src) {
          // No reason to believe a fight is happening, so the unit does not
          // acquire and does not turn. It holds the facing the replay recorded.
          //
          // This used to aim at the nearest hostile in weapon reach — "a unit on
          // guard" — and it was by far the largest source of units pirouetting
          // on the spot. Nothing corroborates that aim, so it is synthesized
          // rotation invented from a target the unit was never shown to notice,
          // and for a 500-range weapon in a busy area the nearest hostile churns
          // constantly: measured as the reason behind 14 of 19 on-the-spot spins
          // in one replay, mostly camp creeps and archers watching an army walk
          // past. A unit standing still beats a unit tracking nothing — the same
          // rule that governs swinging governs turning.
          emitIdle('no-corroboration', null);
          continue;
        }

        if (!best) {
          // Corroborated, but nothing is in reach any more — usually the target
          // this unit was just swinging at stepped out of range. Keep watching
          // the nearest threat rather than snapping back to the baked facing:
          // dropping the aim here does not stop rotation, it just moves it to
          // the attack->idle boundary, where the model whips from the aimed
          // direction to the walking one in a single frame.
          const aim = this._nearestThreat(a, live, query, scratch, acquireRange(meta));
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

    /**
     * Nearest FRIENDLY unit a support caster would be channelling at — the
     * mirror of _nearestThreat. Buildings are skipped (Replenish targets units),
     * as are neutrals, so a statue parked by a shop doesn't pretend to heal it.
     */
    _replenishTarget (a, live, query, scratch) {
      const radius = C.REPLENISH_RADIUS;
      let best = null, bestD = Infinity;
      const idxs = query(a.x, a.y, radius, scratch);
      for (let n = 0; n < idxs.length; n++) {
        const c = live[idxs[n]];
        if (c === a || c.targetOnly || c.isNeutral) continue;
        if (c.teamId !== a.teamId) continue;
        const d = Math.hypot(c.x - a.x, c.y - a.y);
        if (d > radius) continue;
        if (betterTarget(c, d, best, bestD)) { best = c; bestD = d; }
      }
      return best;
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
        if (betterTarget(c, d, best, bestD)) { best = c; bestD = d; }
      }
      return best;
    }

    /**
     * How long `a` and `c` have continuously been within `radius` of each other,
     * sampled on an ABSOLUTE time grid so the answer never depends on frame rate
     * or on how playback arrived at t.
     *
     * `radius` defaults to `a`'s weapon reach, which is what the melee swing
     * gate needs. The facing code passes the much larger awareness radius
     * instead: anchoring a turn to weapon reach meant a pair grazing the reach
     * boundary at one past sample reset the turn, and the facing snapped back to
     * the baked direction and out again on the next tick.
     */
    _contactDwell (a, c, t, radius) {
      const Q = C.ACQ_TICK_MS, K = C.ACQ_LOOKBACK_TICKS;
      const meta = a.u.meta || {};
      const combat = meta.combat || {};
      const melee = isMelee(meta);
      const reach = (radius != null) ? radius
        : (combat.range || 0) + a.r + c.r + (melee ? C.MELEE_TOL : C.RANGED_TOL);
      const tq = Math.floor(t / Q) * Q;
      for (let j = 1; j <= K; j++) {
        const s = tq - j * Q;
        if (s < 0) return j * Q;
        const pa = targetPosAt(a, s);
        const pc = targetPosAt(c, s);
        if (!pa || !pc) return j * Q;
        if (Math.hypot(pc.x - pa.x, pc.y - pa.y) > reach) return j * Q;
      }
      return K * Q;
    }

    /**
     * Grid time at which this unit's current stand began — the most recent grid
     * step, scanning back, at which it was still moving. Anchors a turn so it
     * starts from the facing the unit stopped with.
     *
     * Deliberately NOT the last path-sample time, which is what the facing code
     * used to anchor to. A stationary unit still receives path samples, and each
     * arrival dragged that anchor forward, collapsing the turn window and
     * snapping the facing back toward the baked direction — then out again on
     * the next tick. It was the largest single source of on-the-spot whipping
     * that survived the turn-rate limit.
     *
     * Uses raw segment speed rather than isMoving(): this only needs "was it in
     * motion at that step", and isMoving's ±500ms reconstruction would cost ~9
     * path walks per step, per unit, per frame.
     */
    _standStart (a, tq) {
      const Q = C.ACQ_TICK_MS, K = C.ACQ_LOOKBACK_TICKS;
      const path = a.u.path;
      for (let j = 1; j <= K; j++) {
        const s = tq - j * Q;
        if (s < 0) return 0;
        if (segmentSpeed(path, pathIndexAt(path, s)) > C.MOVE_OFF_WU_S) return s;
      }
      return tq - K * Q;
    }

    /**
     * Turn-rate-limited facing toward a target.
     *
     * This used to be a single clamp: facing = rotateClamped(bakedFacing,
     * desired(t), rate × timeSinceContact). That bounds how far the facing can
     * sit from the BAKED facing, which is not the same thing as bounding how
     * fast it can turn — and it was the main source of units pirouetting on the
     * spot:
     *
     *   - timeSinceContact came off a 125ms-quantized backward scan, so the
     *     budget jumped in steps. A pair that grazed the reach boundary at one
     *     past sample collapsed the budget from π back to 0.83 rad, snapping the
     *     facing from the target back to the baked direction, then out again on
     *     the next tick.
     *   - once the budget passed π the clamp did nothing at all, so the facing
     *     WAS `desired`. Any change in `desired` — a target swap, or an enemy
     *     walking past at close range — moved the model instantly, through any
     *     angle, in one frame.
     *
     * So instead of clamping the endpoint, march the turn on the same absolute
     * 125ms grid the rest of this file uses, rotating at most the unit's turn
     * rate per step toward where the target was AT THAT STEP, then take one
     * partial step to land exactly on t. The emitted facing is then Lipschitz in
     * time with the engine's own turn rate as its constant: it physically cannot
     * spin, no matter what the target does.
     *
     * Still pure. The grid is absolute (frame-rate independent, and identical
     * scrubbing backward), the walk starts from data — the later of when the
     * unit stopped and the top of the lookback window — and the loop is bounded
     * by ACQ_LOOKBACK_TICKS. At the walk→attack boundary the window is empty, so
     * facing equals the walking facing and there is no pop.
     */
    _facingFor (a, target, t) {
      const meta = a.u.meta || {};
      const ratePerMs = Math.min(meta.turnRate != null ? meta.turnRate : 0.6,
        C.TURN_RAD_PER_FRAME_CAP) / C.WC3_FRAME_MS;

      const Q = C.ACQ_TICK_MS;
      const tq = Math.floor(t / Q) * Q;
      // The turn begins at the later of: when this unit stopped walking, and
      // when it could first have noticed this target.
      const noticed = tq - this._contactDwell(a, target, t,
        acquireRange(meta) + a.r + target.r);
      const start = Math.max(0, this._standStart(a, tq), noticed);
      const here = Math.atan2(target.y - a.y, target.x - a.x);

      // The actor is stationary on every path that reaches here (walking units
      // return earlier), so its own position is constant across the window and
      // only the target's motion needs sampling.
      const s0 = sampleAt(a.u.path, start);
      let f = (s0 && s0.facing != null) ? s0.facing
        : (a.facing != null ? a.facing : here);
      const stepBudget = ratePerMs * Q;
      for (let s = start + Q; s <= tq; s += Q) {
        const p = targetPosAt(target, s);
        if (!p) continue;
        const dx = p.x - a.x, dy = p.y - a.y;
        if (dx === 0 && dy === 0) continue;
        f = rotateClamped(f, Math.atan2(dy, dx), stepBudget);
      }
      return rotateClamped(f, here, ratePerMs * Math.max(0, t - tq));
    }
  }

  return {
    VERSION: 2,
    C,
    ORDER_WINDOWS,
    isPathGap,
    pathIndexAt,
    sampleAt,
    segmentSpeed,
    smoothedSpeed,
    isMoving,
    isMelee,
    // Exported so tools/lib/behavior-metrics.js grades against the same
    // acquisition radius and targeting mask the viewer decides with, instead of
    // a second copy that can drift.
    acquireRange,
    canTarget,
    readyTimeOf,
    deathStartOf,
    angDiff,
    rotateClamped,
    createWorld: (opts) => new World(opts)
  };
});
