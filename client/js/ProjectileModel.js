/**
 * ProjectileModel — what is in the air right now, and where exactly.
 *
 * Replays record orders and positions. They do NOT record attacks: there is no
 * damage event, no hit event, no per-swing event anywhere in the .wc3v schema.
 * So every projectile here is synthesized, exactly as the attack animation
 * already is. The goal is not simulation — it is that someone who knows WC3
 * sees nothing wrong.
 *
 * The one thing we refuse to get wrong is the CADENCE. A unit must never appear
 * to fire faster than the game would let it. That is structural here rather
 * than a filter bolted on afterwards: launches are spaced exactly one attack
 * period apart, and the period comes from the engine's own unitweapons.slk. We
 * deliberately do NOT model attack-speed buffs, slows or stuns — those are
 * unknowable from a replay, so every unit fires at its base rate and no faster.
 *
 * ---------------------------------------------------------------------------
 * SEEK SAFETY is the hard constraint, same as UnitBehavior.
 *
 * The set of live projectiles is RECOMPUTED from gameTime every frame. There is
 * no spawn list, no despawn event, no lifetime bookkeeping and no integration.
 * Scrubbing backward therefore reproduces exactly what scrubbing forward
 * produced, and seeking is free. Anything that accumulates per frame — a real
 * missile update loop, a particle pool, `performance.now()` — would break this,
 * which is why none of it is here.
 *
 * A consequence worth stating: this module must never call
 * `behaviorWorld.resolve(t)` for any t other than the current frame. That memo
 * is a single slot keyed on exact gameTime and is shared with UnitModelRenderer;
 * resolving another time would corrupt the frame the renderer is drawing.
 * Sampling ONE unit's past position is fine and is what we do instead —
 * `UnitBehavior.sampleAt` is a pure binary search over an immutable path.
 *
 * UMD: window.ProjectileModel in the browser, module.exports in node — so
 * tools/projectile-check.js verifies THIS code rather than a reimplementation.
 */
(function (root, factory) {
  const mod = factory(
    (typeof require === 'function' && typeof module !== 'undefined')
      ? require('./UnitBehavior.js') : null,
    (typeof require === 'function' && typeof module !== 'undefined')
      ? require('./UnitProjectiles.js') : null
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.ProjectileModel = mod;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this),
   function (nodeUB, nodeUP) {
  'use strict';

  const UB = nodeUB || (typeof window !== 'undefined' ? window.UnitBehavior : null);
  const UP = nodeUP || (typeof window !== 'undefined' ? window.UnitProjectiles : null);

  // Frozen so the harness asserts against the same numbers the viewer runs.
  const C = Object.freeze({
    // A flight shorter than this reads as a pop rather than a shot — draw the
    // impact only. This is also what makes short-range "missile" units degrade
    // gracefully toward the `instant` look instead of flickering.
    MIN_VISIBLE_FLIGHT_MS: 60,
    // Hard ceiling on a single flight. Without it, a target sprinting away from
    // a slow artillery shell leaves a shell hanging on screen for seconds.
    MAX_FLIGHT_MS: 1500,
    IMPACT_MS: 220,          // impact puff lifetime
    MUZZLE_MS: 110,          // muzzle flash lifetime (instant weapons, and launches)

    // Pool ceilings. Exceeding them drops the OLDEST swings first, so what
    // survives is what just launched — the part a viewer is actually watching.
    MAX_BOLTS: 256,
    MAX_IMPACTS: 128,
    MAX_MUZZLES: 128,

    // Fallbacks when a unit has no UnitProjectiles entry. Real data covers 314
    // units; these keep an unknown/modded id from rendering nothing.
    DEFAULT_SPEED: 1200,
    DEFAULT_ARTILLERY_SPEED: 900,
    DEFAULT_ARC: 0.15,           // by far the most common real value (176 units)
    DEFAULT_ARTILLERY_ARC: 0.35,
    DEFAULT_LAUNCH_Z: 60,
    DEFAULT_IMPACT_Z: 60,

    // Splash radius when the weapon has none — sizes the impact puff.
    DEFAULT_IMPACT_RADIUS: 28
  });

  // Weapon types whose projectile crosses the map. `normal` is melee; `instant`
  // hits with no flight at all and gets a muzzle flash + impact instead.
  const TRAVELS = new Set(['missile', 'msplash', 'mbounce', 'mline', 'artillery', 'aline']);
  const ARTILLERY = new Set(['artillery', 'aline']);

  // ---------------------------------------------------------------------------
  // Swing clock
  //
  // This is shared with UnitModelRenderer._applyAttack so the bolt and the bow
  // can never disagree about when the shot goes off.
  //
  // It is an ABSOLUTE grid, deliberately. UnitBehavior derives a cadence from
  // `anchor = max(lastPathSampleTime, t - dwell)` with dwell capped at 2 s; both
  // terms slide with t, so once a unit has been engaged for two seconds the
  // phase pins to a constant (measured: a ranged unit frozen at clipFill 0.500
  // for 45 s, a melee unit at 1.000 for 24 s — the swing stops cycling). A grid
  // anchored to gameTime cannot do that, and it is just as seek-safe.
  //
  // The cost is that swings are not anchored to the moment a unit engaged. Since
  // real swing times are unknowable anyway, a steady grid is at least as honest,
  // and the per-uuid offset keeps a whole army from firing in lockstep.
  // ---------------------------------------------------------------------------

  /** Deterministic per-uuid offset in [0, cycle). Mirrors UnitModelRenderer._phaseOffset. */
  function phaseOffset (uuid, cycle) {
    let h = 0;
    const s = uuid || '';
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h) % Math.max(1, Math.round(cycle));
  }

  /**
   * The engine's attack period: max(cooldown, damagePoint), in seconds.
   *
   * Backswing is deliberately NOT included. In the engine a new swing starts
   * once the cooldown expires and the previous damage point has fired; the
   * backswing only gates accepting a new ORDER. UnitBehavior's swingPeriod adds
   * it, which stretches the period for units whose animation is longer than
   * their cooldown.
   */
  function attackPeriod (combat) {
    if (!combat) return 1;
    const cd = combat.cooldown || 0;
    const dp = combat.damagePoint || 0;
    return Math.max(cd, dp) || 1;
  }

  /**
   * Which swing is in progress at `gameTime`, and when it started.
   * Pure in (uuid, gameTime, combat).
   */
  function swingAt (uuid, gameTime, combat) {
    const periodMs = attackPeriod(combat) * 1000;
    const offset = phaseOffset(uuid, periodMs);
    const index = Math.floor((gameTime - offset) / periodMs);
    return { index, startMs: index * periodMs + offset, periodMs };
  }

  function swingStart (uuid, index, combat) {
    const periodMs = attackPeriod(combat) * 1000;
    return index * periodMs + phaseOffset(uuid, periodMs);
  }

  /**
   * Position within a fixed repeating cycle, 0..1, on the same absolute grid.
   * For anything that pulses on a flat period rather than an attack cooldown
   * (the Obsidian Statue's Replenish channel is the only one today).
   */
  function gridPhase (uuid, gameTime, periodMs) {
    if (!(periodMs > 0)) return 0;
    const off = phaseOffset(uuid, periodMs);
    return ((((gameTime - off) % periodMs) + periodMs) % periodMs) / periodMs;
  }

  /**
   * How far through its attack CLIP a unit is, 0..1.
   *
   * The engine time-warps the whole attack sequence so its duration equals
   * damagePoint + backswing, then holds `Stand Ready` for the rest of the
   * cooldown. That is what makes a ranged unit read as "fire, hold, fire"
   * against a melee unit's continuous swinging.
   */
  function clipFillAt (uuid, gameTime, combat) {
    const sw = swingAt(uuid, gameTime, combat);
    const windowMs = (((combat && combat.damagePoint) || 0) +
                      ((combat && combat.backswing) || 0)) * 1000;
    if (windowMs <= 0) return 1;
    const elapsed = gameTime - sw.startMs;
    return Math.max(0, Math.min(1, elapsed / windowMs));
  }

  // ---------------------------------------------------------------------------
  // Weapon / projectile spec resolution
  // ---------------------------------------------------------------------------

  function projectileEntry (itemId) {
    if (!UP || !UP.units || !itemId) return null;
    return UP.units[itemId] || UP.units[String(itemId).toLowerCase()] || null;
  }

  function isAir (meta) {
    const mt = meta && meta.moveType;
    return mt === 'fly';
  }

  /**
   * Where a unit is when it has no path sample — the same `spawnPosition ||
   * lastPosition` pair ClientUnit places units with, so a projectile launches
   * from and lands on exactly where the viewer drew the thing.
   */
  function staticPos (u) {
    const p = u && (u.spawnPosition || u.lastPosition);
    return p ? { x: p.x, y: p.y } : null;
  }

  /** "Abilities\\Weapons\\Arrow\\ArrowMissile.mdl" -> "arrowmissile" */
  function artNameOf (art) {
    if (!art) return null;
    const s = String(art).replace(/\\/g, '/');
    const base = s.slice(s.lastIndexOf('/') + 1);
    return base.replace(/\.(mdl|mdx)$/i, '').toLowerCase() || null;
  }

  /**
   * Resolve the weapon a shooter uses against a given target, and fold the
   * projectile data onto it.
   *
   * WC3 picks by "targets allowed", which we have not extracted. In practice a
   * unit's second weapon is its anti-air weapon in nearly every case that
   * matters (Rifleman, Gyrocopter, Mortar Team, Steam Tank all follow this), so
   * air targets take weapon 2 when one exists. Getting this wrong is visible:
   * a Mortar Team lobbing an arcing shell at a Gargoyle looks absurd.
   *
   * Returns null for melee, or when nothing should be drawn.
   */
  function specFor (shooterUnit, targetUnit) {
    const meta = (shooterUnit && shooterUnit.meta) || {};
    const combat = meta.combat;
    if (!combat) return null;

    const entry = projectileEntry(shooterUnit.itemId);
    const air = isAir(targetUnit && targetUnit.meta);

    let w = combat;
    let p = entry;
    if (air && combat.weapon2) {
      w = combat.weapon2;
      if (entry && entry.weapon2) p = entry.weapon2;
    }

    const wt = w.weaponType;
    if (wt === 'normal') return null;               // melee — no projectile
    const travels = TRAVELS.has(wt);
    const instant = wt === 'instant';
    if (!travels && !instant) return null;

    const artillery = ARTILLERY.has(wt);
    const geo = entry || {};

    return {
      travels,
      instant,
      artillery,
      speed: (p && p.speed) || (artillery ? C.DEFAULT_ARTILLERY_SPEED : C.DEFAULT_SPEED),
      arc: (p && p.arc != null) ? p.arc : (artillery ? C.DEFAULT_ARTILLERY_ARC : C.DEFAULT_ARC),
      // Artillery is converted to a fixed ground point at launch by the engine
      // and never homes, whatever the data says.
      homing: artillery ? 0 : ((p && p.homing != null) ? p.homing : 1),
      launchX: geo.launchX || 0,
      launchY: geo.launchY || 0,
      launchZ: geo.launchZ != null ? geo.launchZ : C.DEFAULT_LAUNCH_Z,
      impactZ: geo.impactZ != null ? geo.impactZ : C.DEFAULT_IMPACT_Z,
      impactRadius: (p && p.splash) || C.DEFAULT_IMPACT_RADIUS,
      // Lowercase basename of the missile model, which is the key the renderer's
      // per-missile sprite manifest uses ("arrowmissile", "glaivemissile", ...).
      // Null falls back to the generic streak.
      artName: artNameOf(p && p.art),
      attackType: w.attackType || 'normal',
      maxDamage: w.maxDamage || 0,
      damagePoint: w.damagePoint || combat.damagePoint || 0,
      combat
    };
  }

  // ---------------------------------------------------------------------------
  // Flight geometry
  // ---------------------------------------------------------------------------

  /**
   * Muzzle position in WORLD coordinates.
   *
   * The engine fires from a fixed numeric offset relative to unit origin and
   * facing — NOT from a bone attachment. launchY is FORWARD along facing and
   * launchX is LATERAL, which is unintuitive but is what the data means (most
   * ranged units have launchX = 0 and a nonzero launchY).
   */
  function muzzleOf (sx, sy, facing, spec, groundZ, flyHeight) {
    const cf = Math.cos(facing), sf = Math.sin(facing);
    const x = sx + spec.launchY * cf + spec.launchX * sf;
    const y = sy + spec.launchY * sf - spec.launchX * cf;
    return { x, y, z: groundZ(x, y) + (flyHeight || 0) + spec.launchZ };
  }

  /**
   * Height along the flight, and the slope at that point.
   *
   *   z(t) = zL + (zI - zL)·t + arc·D·4·t·(1 - t)
   *
   * `arc` is a dimensionless ratio: the parabola peaks at arc·D above the
   * straight chord, halfway along. arc = 0 gives a perfectly straight shot,
   * which is what most WC3 missiles use; 0.15 is the commonest real value.
   *
   * Note the speed budget is HORIZONTAL ONLY — a missile does not slow down at
   * the apex. That single detail is most of what makes an arc read as WC3
   * rather than as a lobbed ball.
   */
  function arcHeight (zL, zI, D, arc, t) {
    return zL + (zI - zL) * t + arc * D * 4 * t * (1 - t);
  }

  /** d(z)/d(horizontal distance) at t — used for the missile's pitch. */
  function arcSlope (zL, zI, D, arc, t) {
    if (D <= 0) return 0;
    return (zI - zL) / D + 4 * arc * (1 - 2 * t);
  }

  // ---------------------------------------------------------------------------
  // Collector
  // ---------------------------------------------------------------------------

  function blankBolt () {
    return {
      uuid: '', swing: 0, playerId: -1, teamId: -1,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, t: 0,
      attackType: 'normal', maxDamage: 0, len: 0, art: null
    };
  }
  function blankPuff () {
    return { uuid: '', swing: 0, x: 0, y: 0, z: 0, age: 0, radius: 0, attackType: 'normal' };
  }

  class Collector {
    /**
     * @param {object} opts
     *   unitsByUuid - Map<uuid, ClientUnit>. Built once at load; used to sample
     *                 a target's PAST position without touching the shared
     *                 behavior memo.
     *   groundZ     - (wx, wy) => terrain height. Defaults to flat, which is
     *                 what the headless harness uses.
     */
    constructor (opts) {
      opts = opts || {};
      this.unitsByUuid = opts.unitsByUuid || new Map();
      this.groundZ = opts.groundZ || (() => 0);

      // Pooled records, reused every frame. `length` on each array is the
      // authoritative count; entries past it are stale and must be ignored.
      this.bolts = [];
      this.impacts = [];
      this.muzzles = [];
      this._boltPool = [];
      this._impactPool = [];
      this._muzzlePool = [];
      this.dropped = 0;
    }

    setUnits (map) { this.unitsByUuid = map || new Map(); }

    _bolt () {
      const n = this.bolts.length;
      let b = this._boltPool[n];
      if (!b) b = this._boltPool[n] = blankBolt();
      this.bolts.push(b);
      return b;
    }
    _impact () {
      const n = this.impacts.length;
      let p = this._impactPool[n];
      if (!p) p = this._impactPool[n] = blankPuff();
      this.impacts.push(p);
      return p;
    }
    _muzzle () {
      const n = this.muzzles.length;
      let p = this._muzzlePool[n];
      if (!p) p = this._muzzlePool[n] = blankPuff();
      this.muzzles.push(p);
      return p;
    }

    /**
     * Recompute everything in the air at `gameTime`.
     *
     * @param {number} gameTime
     * @param {object} frame  the CURRENT behaviorWorld.resolve(gameTime) frame
     */
    collect (gameTime, frame) {
      this.bolts.length = 0;
      this.impacts.length = 0;
      this.muzzles.length = 0;
      this.dropped = 0;
      if (!frame || !UB) return this;

      for (const [uuid, d] of frame.byUuid) {
        if (d.state !== 'attack') continue;
        // A melee unit never fires anything. This is also a deliberate guard,
        // not just a fast path: UnitBehavior does not yet filter by "targets
        // allowed", so a ground-melee unit can be credited with attacking an
        // air unit. Falling through to the anti-air weapon 2 there would invent
        // a shot that could not happen.
        if (d.melee) continue;
        const shooter = this.unitsByUuid.get(uuid);
        if (!shooter) continue;
        const target = d.targetUuid ? this.unitsByUuid.get(d.targetUuid) : null;
        if (!target) continue;

        const spec = specFor(shooter, target);
        if (!spec) continue;

        this._emitFor(gameTime, uuid, d, shooter, target, spec);
      }
      return this;
    }

    _emitFor (gameTime, uuid, d, shooter, target, spec) {
      const combat = spec.combat;
      const periodMs = attackPeriod(combat) * 1000;
      const dpMs = spec.damagePoint * 1000;

      // How many swings back could still have something on screen. Bounded by
      // the longest possible flight plus the impact tail — in practice 1-3.
      const maxLifeMs = (spec.travels ? C.MAX_FLIGHT_MS : 0) + C.IMPACT_MS;
      const K = Math.min(4, Math.ceil(maxLifeMs / periodMs) + 1);

      const now = swingAt(uuid, gameTime, combat);

      for (let k = now.index; k >= now.index - K; k--) {
        const launchAt = swingStart(uuid, k, combat) + dpMs;
        if (launchAt > gameTime) continue;           // hasn't fired yet
        // Only fire for the engagement we can actually see. UnitBehavior's
        // acqTime marks when this unit engaged; a swing that predates it
        // belongs to a fight we have no evidence for.
        if (d.acqTime != null && launchAt < d.acqTime) continue;

        this._emitSwing(gameTime, uuid, k, launchAt, d, shooter, target, spec);
      }
    }

    _emitSwing (gameTime, uuid, k, launchAt, d, shooter, target, spec) {
      const gz = this.groundZ;

      // Positions at LAUNCH time, sampled straight off the immutable paths.
      // The fallback has to accept `lastPosition` as well as `spawnPosition`:
      // most BUILDINGS carry no path array and no spawnPosition, so a
      // spawnPosition-only fallback silently dropped every arrow aimed at a
      // tower or a town hall. Same pair ClientUnit and UnitBehavior use.
      const sp = UB.sampleAt(shooter.path, launchAt) || staticPos(shooter);
      const tp0 = UB.sampleAt(target.path, launchAt) || staticPos(target);
      if (!sp || !tp0) return;

      // The unit is aimed at its target at the damage point, so derive facing
      // from the geometry rather than the baked path facing (which lags, and is
      // whatever direction the unit last walked when it is standing still).
      const facing = Math.atan2(tp0.y - sp.y, tp0.x - sp.x);
      const shooterFly = (shooter.meta && shooter.meta.moveHeight) || 0;
      const targetFly = (target.meta && target.meta.moveHeight) || 0;

      const m = muzzleOf(sp.x, sp.y, facing, spec, gz, shooterFly);

      // --- instant weapons: no flight. Muzzle flash + a hit on the target. ---
      if (!spec.travels) {
        const age = gameTime - launchAt;
        if (age <= C.MUZZLE_MS) this._pushMuzzle(uuid, k, m, age / C.MUZZLE_MS, spec);
        if (age <= C.IMPACT_MS) {
          const tz = gz(tp0.x, tp0.y) + targetFly + spec.impactZ;
          this._pushImpact(uuid, k, tp0.x, tp0.y, tz, age / C.IMPACT_MS, spec);
        }
        return;
      }

      // --- travelling missile ---------------------------------------------
      //
      // Flight DURATION is fixed at launch from the launch geometry, but the
      // endpoint tracks the target while homing. The engine integrates position
      // per tick and re-steers, which is not seek-safe; this is the pure-function
      // equivalent. It costs a little physical accuracy — a homing bolt chasing
      // a fleeing target arrives "on time" rather than late — which is invisible
      // over the sub-second flights this actually covers, and buys determinism
      // and a known arrival time.
      // Measured from the MUZZLE, not the unit origin, so the fixed flight
      // duration and the per-frame interpolation agree about the same segment.
      const D0 = Math.hypot(tp0.x - m.x, tp0.y - m.y);
      let flightMs = (D0 / spec.speed) * 1000;
      if (flightMs > C.MAX_FLIGHT_MS) flightMs = C.MAX_FLIGHT_MS;

      const age = gameTime - launchAt;
      if (age > flightMs + C.IMPACT_MS) return;      // long gone

      // Where it is heading right now. A homing missile whose target has died
      // keeps flying and impacts on the corpse — that is what the engine does,
      // and despawning it instead is a very visible mistake.
      let aim = tp0;
      if (spec.homing) {
        aim = UB.sampleAt(target.path, gameTime) || tp0;
      }

      // Too short to read as a shot — treat it as a contact hit.
      if (flightMs < C.MIN_VISIBLE_FLIGHT_MS) {
        if (age <= C.IMPACT_MS) {
          const tz = gz(aim.x, aim.y) + targetFly + spec.impactZ;
          this._pushImpact(uuid, k, aim.x, aim.y, tz, age / C.IMPACT_MS, spec);
        }
        return;
      }

      const iz = gz(aim.x, aim.y) + targetFly + spec.impactZ;

      if (age >= flightMs) {
        // Landed. Impact puff for the tail of its life.
        this._pushImpact(uuid, k, aim.x, aim.y, iz, (age - flightMs) / C.IMPACT_MS, spec);
        return;
      }

      const t = age / flightMs;
      const D = Math.hypot(aim.x - m.x, aim.y - m.y);
      const x = m.x + (aim.x - m.x) * t;
      const y = m.y + (aim.y - m.y) * t;
      const z = arcHeight(m.z, iz, D, spec.arc, t);

      const b = this.bolts.length < C.MAX_BOLTS ? this._bolt() : null;
      if (!b) { this.dropped++; return; }
      b.uuid = uuid;
      b.swing = k;
      b.playerId = shooter._playerId != null ? shooter._playerId : -1;
      b.teamId = shooter._teamId != null ? shooter._teamId : -1;
      b.x = x; b.y = y; b.z = z;
      b.t = t;
      b.yaw = Math.atan2(aim.y - m.y, aim.x - m.x);
      b.pitch = Math.atan(arcSlope(m.z, iz, D, spec.arc, t));
      b.attackType = spec.attackType;
      b.maxDamage = spec.maxDamage;
      b.art = spec.artName;
      // Streak length scales with speed so a fast bolt reads as a fast bolt,
      // clamped so a Steam Tank shell isn't a stripe across the screen.
      b.len = Math.max(24, Math.min(90, spec.speed * 0.045));

      // A brief flash at the muzzle on the frame it leaves.
      if (age <= C.MUZZLE_MS) this._pushMuzzle(uuid, k, m, age / C.MUZZLE_MS, spec);
    }

    _pushImpact (uuid, k, x, y, z, age01, spec) {
      if (this.impacts.length >= C.MAX_IMPACTS) { this.dropped++; return; }
      const p = this._impact();
      p.uuid = uuid; p.swing = k;
      p.x = x; p.y = y; p.z = z;
      p.age = Math.max(0, Math.min(1, age01));
      p.radius = spec.impactRadius;
      p.attackType = spec.attackType;
    }

    _pushMuzzle (uuid, k, m, age01, spec) {
      if (this.muzzles.length >= C.MAX_MUZZLES) { this.dropped++; return; }
      const p = this._muzzle();
      p.uuid = uuid; p.swing = k;
      p.x = m.x; p.y = m.y; p.z = m.z;
      p.age = Math.max(0, Math.min(1, age01));
      p.radius = 18;
      p.attackType = spec.attackType;
    }
  }

  return {
    VERSION: 1,
    C,
    TRAVELS,
    ARTILLERY,
    phaseOffset,
    attackPeriod,
    swingAt,
    swingStart,
    gridPhase,
    clipFillAt,
    projectileEntry,
    specFor,
    muzzleOf,
    arcHeight,
    arcSlope,
    createCollector: (opts) => new Collector(opts)
  };
});
