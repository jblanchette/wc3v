//
// CreepGuardSim — reconstructs camp creep aggro, chase and leash-back.
//
// WHY THIS IS NOT INVENTED MOTION
//
// A replay records orders and selections, never positions. Everything the
// viewer draws between two orders is already simulation — that is what the
// whole movement simulator does for player units. Creep guard behaviour is the
// same kind of reconstruction, and an easier one, because it is deterministic
// engine behaviour rather than a human decision:
//
//   1. Creeps stand at their spawn point (their guard position) until an enemy
//      enters acquisition range.
//   2. On acquisition they move to attack the nearest enemy.
//   3. They will not chase beyond `creepGuardReturnDistance` from their guard
//      position — the leash.
//   4. Past the leash, or with the target gone, they walk back and resume
//      guarding. (In the real game they also regenerate to full HP on the way
//      back. We have no HP, so that part is not modelled.)
//   5. Camps never wander to other camps. The leash circle is hard.
//
// The leash constant is resolved per replay (map constants when present, the
// documented WC3 default otherwise) and surfaced with its source, exactly as
// the camp-credit model already does — see helpers/mappings.resolveCampLeash.
//
// WHAT IS ESTIMATED, AND SAID SO
//
//   - Acquisition range is a documented WC3 default, not a per-map value.
//   - Enemy positions come from the player-unit simulation, so creep motion is
//     only as good as the paths that provoked it.
//   - We have no creep deaths, so creeps stop moving at the camp's estimated
//     clearedTime and are never animated after it.
//   - Damage, HP and death order are not modelled at all. This produces where
//     a creep WAS, not how the fight went.
//
// Runs as a post-parse pass (alongside DeathInference / HideInference) so it
// can see finished player paths, and bakes samples into each creep's exported
// `path`. Every consumer — viewer, battle detector, anchor audit — then sees
// one consistent answer instead of each inventing its own.
//
// The hard invariant is checkable and is checked: no creep sample may ever lie
// further than the leash from its spawn. tools/creep-leash-check.js asserts it
// across the corpus.
//

const { resolveCampLeash } = require("../helpers/mappings");

//
// WC3 default acquisition range. Creeps engage an enemy that comes within this
// of them. Not recorded in the replay and not per-unit in our data, so it is a
// documented approximation, surfaced like the leash rather than hidden.
//
const ACQUISITION_RANGE = 500;

// Once chasing, a creep keeps its target until the target leaves this larger
// radius. Without hysteresis a target hovering exactly at the acquisition
// boundary makes the creep stutter between chase and return every tick.
const DEACQUIRE_RANGE = 700;

// Fixed simulation step. Fine enough that a 350 wu/s creep moves <90wu per
// tick, coarse enough to stay cheap over a whole corpus.
const SIM_STEP_MS = 250;

// Path-sample decimation. The client interpolates between samples, so emitting
// one per sim step would bloat the export for no visible gain.
const SAMPLE_MIN_INTERVAL_MS = 500;
const SAMPLE_MIN_MOVE_WU = 24;

// Close enough to the guard spot to call it home and stop emitting samples.
const ARRIVE_EPSILON_WU = 16;

// Melee creeps have no `range` worth standing off at; keep them out of the
// target's centre so they don't visually overlap the unit they attack.
const MIN_STANDOFF_WU = 96;

// A player unit whose last path sample is older than this is not treated as
// present. Mirrors the client's STALE_POSITION_MS ghost filter: a unit parked
// forever only LOOKS present, and creeps must not aggro a ghost.
const STALE_POSITION_MS = 45000;

// How long creeps keep simulating after the last enemy left, so the walk home
// is actually drawn rather than snapping.
const RETURN_TAIL_MS = 12000;

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

//
// Monotonic cursor over one unit's exported path, sampled at increasing times.
// Linear interpolation between samples; holds the last sample for a while, then
// reports the unit as absent (see STALE_POSITION_MS).
//
class PathCursor {
  constructor (unit) {
    this.unit = unit;
    this.path = (unit.path || []).filter(p => p && p.x != null && p.y != null);
    this.i = 0;
    this.first = this.path.length ? this.path[0].gameTime : null;
    this.last = this.path.length ? this.path[this.path.length - 1].gameTime : null;
  }

  // Rewind to the start. The cursor only ever scans FORWARD, so it must be
  // reset between camps: camps are simulated in uuid order, not time order, and
  // a cursor left at 15:00 by one camp would report that late position for a
  // camp whose fight happened at 4:00.
  reset () {
    this.i = 0;
  }

  // Position at t, or null when the unit is not credibly present.
  at (t) {
    if (!this.path.length) return null;
    if (t < this.first) return null;
    if (t > this.last + STALE_POSITION_MS) return null;

    const { unit } = this;
    if (unit.destroyedAt != null && t >= unit.destroyedAt) return null;

    while (this.i < this.path.length - 1 && this.path[this.i + 1].gameTime <= t) {
      this.i++;
    }
    const a = this.path[this.i];
    const b = this.path[this.i + 1];
    if (!b || t <= a.gameTime) return { x: a.x, y: a.y };

    const span = b.gameTime - a.gameTime;
    if (span <= 0) return { x: b.x, y: b.y };
    const f = Math.max(0, Math.min(1, (t - a.gameTime) / span));
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }
}

const CreepGuardSim = class {
  constructor (world, wc3vPlayers) {
    this.world = world;
    this.players = Object.values(wc3vPlayers || {});
    this.stats = {
      camps: 0, campsSimulated: 0, creepsMoved: 0,
      samples: 0, leash: null, leashSource: null
    };
  }

  run () {
    const world = this.world;
    if (!world || !world.neutralGroups) return this.stats;

    const leashInfo = (world.campLeash && world.campLeash.distance > 0)
      ? world.campLeash
      : resolveCampLeash(null);
    const leash = leashInfo.distance;
    this.stats.leash = leash;
    this.stats.leashSource = leashInfo.source;

    // Every mobile player unit is a potential aggro source. Buildings are
    // excluded: creeps do attack them, but a building inside a camp only
    // happens once the camp is already cleared (see SettlementClear), and a
    // static target cannot pull a creep anywhere it would not already go.
    const threats = [];
    this.players.forEach(p => {
      if (!p || p.isNeutralPlayer) return;
      if (Number(p.id) >= 24) return;               // observer / custom slots
      (p.units || []).forEach(u => {
        if (!u || u.isBuilding) return;
        if (!u.path || u.path.length === 0) return;
        threats.push(new PathCursor(u));
      });
    });
    if (!threats.length) return this.stats;

    // Deterministic order — this runs in the exported output, and the corpus
    // is checked by tools/check-determinism.js.
    const camps = Object.values(world.neutralGroups)
      .slice()
      .sort((a, b) => String(a.uuid).localeCompare(String(b.uuid)));

    camps.forEach(camp => {
      this.stats.camps++;
      if (this._simulateCamp(camp, threats, leash)) this.stats.campsSimulated++;
    });

    return this.stats;
  }

  //
  // Window during which this camp's creeps can possibly move: from the first
  // moment a threat is close enough to acquire, until the camp is cleared (its
  // creeps are dead) or the threats have been gone long enough to have walked
  // home. Returns null when nothing ever came near.
  //
  _threatWindow (camp, threats, leash) {
    const b = camp.unitBounds || camp.bounds;
    if (!b) return null;

    // Anything beyond leash + acquisition of the camp box can never matter.
    const reach = leash + ACQUISITION_RANGE;
    const box = {
      minX: b.minX - reach, maxX: b.maxX + reach,
      minY: b.minY - reach, maxY: b.maxY + reach
    };

    let firstT = Infinity;
    let lastT = -Infinity;
    threats.forEach(tc => {
      for (const p of tc.path) {
        if (p.x < box.minX || p.x > box.maxX || p.y < box.minY || p.y > box.maxY) continue;
        if (p.gameTime < firstT) firstT = p.gameTime;
        if (p.gameTime > lastT) lastT = p.gameTime;
      }
    });
    if (!isFinite(firstT)) return null;

    let end = lastT + RETURN_TAIL_MS;
    // Creeps are dead after the camp is cleared — never animate a corpse.
    if (camp.clearedTime != null) end = Math.min(end, camp.clearedTime);
    if (end <= firstT) return null;

    return { start: firstT, end };
  }

  _simulateCamp (camp, threats, leash) {
    const window = this._threatWindow(camp, threats, leash);
    if (!window) return false;

    const creeps = (camp.units || [])
      .filter(u => u && u.isUnit && !u.isFountain &&
        u.currentX != null && u.currentY != null)
      .slice()
      .sort((a, b) => String(a.uuid).localeCompare(String(b.uuid)));
    if (!creeps.length) return false;

    // Per-creep state. `guard` is the spawn point and never changes — the leash
    // is measured from it, which is what makes the invariant checkable.
    const sims = creeps.map(creep => {
      const range = (creep.meta && creep.meta.combat && creep.meta.combat.range) || 0;
      return {
        creep,
        guard: { x: creep.currentX, y: creep.currentY },
        x: creep.currentX,
        y: creep.currentY,
        mode: 'guard',                       // guard | chase | return
        speed: (typeof creep.effectiveMovespeed === 'function')
          ? creep.effectiveMovespeed()
          : ((creep.meta && creep.meta.movespeed) || 250),
        standoff: Math.max(MIN_STANDOFF_WU, range),
        lastSampleT: null,
        lastSampleX: creep.currentX,
        lastSampleY: creep.currentY,
        moved: false
      };
    });

    const dtSec = SIM_STEP_MS / 1000;
    let anyMoved = false;

    threats.forEach(tc => tc.reset());

    for (let t = window.start; t <= window.end; t += SIM_STEP_MS) {
      // Resolve every threat position once per step, not once per creep.
      const positions = [];
      for (const tc of threats) {
        const p = tc.at(t);
        if (p) positions.push(p);
      }

      // A WC3 creep camp defends as a group: pull one troll and the whole camp
      // comes. So the camp acquires if ANY of its creeps has an enemy in range,
      // and then every creep engages — each still choosing its own nearest
      // target and still leashed to its OWN spawn point, which is what keeps
      // the back rank from piling onto the front.
      let campAggro = false;
      for (const s of sims) {
        const r = (s.mode === 'chase') ? DEACQUIRE_RANGE : ACQUISITION_RANGE;
        for (const p of positions) {
          if (dist(s.x, s.y, p.x, p.y) <= r) { campAggro = true; break; }
        }
        if (campAggro) break;
      }

      for (const s of sims) {
        // ── target selection ────────────────────────────────────────────
        // Once the camp is roused, a creep will move toward the nearest enemy
        // even if that enemy is beyond its own acquisition range — it is
        // joining the fight, not acquiring independently. The leash clamp below
        // is what stops this from becoming a camp-wide charge across the map.
        let target = null;
        let bestD = Infinity;
        if (campAggro) {
          for (const p of positions) {
            const d = dist(s.x, s.y, p.x, p.y);
            if (d < bestD) { bestD = d; target = p; }
          }
        }

        // ── mode transitions ────────────────────────────────────────────
        const leashUsed = dist(s.x, s.y, s.guard.x, s.guard.y);
        if (s.mode === 'chase' && (!target || leashUsed >= leash)) {
          s.mode = 'return';
        } else if (s.mode !== 'return' && target) {
          s.mode = 'chase';
        } else if (s.mode === 'return') {
          // Committed to walking home — ignore targets until back on station,
          // which is exactly how a leashed WC3 creep behaves.
          if (dist(s.x, s.y, s.guard.x, s.guard.y) <= ARRIVE_EPSILON_WU) s.mode = 'guard';
        }

        // ── desired position ────────────────────────────────────────────
        let goal;
        if (s.mode === 'chase' && target) {
          const d = bestD;
          if (d <= s.standoff) goal = { x: s.x, y: s.y };     // in range, hold
          else {
            const f = (d - s.standoff) / d;
            goal = { x: s.x + (target.x - s.x) * f, y: s.y + (target.y - s.y) * f };
          }
        } else if (s.mode === 'return') {
          goal = { x: s.guard.x, y: s.guard.y };
        } else {
          goal = { x: s.x, y: s.y };
        }

        // ── step toward the goal, then clamp to the leash circle ─────────
        const gd = dist(s.x, s.y, goal.x, goal.y);
        if (gd > 0.5) {
          const step = Math.min(gd, s.speed * dtSec);
          s.x += (goal.x - s.x) * (step / gd);
          s.y += (goal.y - s.y) * (step / gd);
        }

        // Hard invariant: never further than the leash from the guard spot.
        const fromGuard = dist(s.x, s.y, s.guard.x, s.guard.y);
        if (fromGuard > leash) {
          const f = leash / fromGuard;
          s.x = s.guard.x + (s.x - s.guard.x) * f;
          s.y = s.guard.y + (s.y - s.guard.y) * f;
        }

        // ── emit a decimated path sample ────────────────────────────────
        const movedEnough = dist(s.x, s.y, s.lastSampleX, s.lastSampleY) >= SAMPLE_MIN_MOVE_WU;
        const dueForSample = s.lastSampleT == null ||
          (t - s.lastSampleT) >= SAMPLE_MIN_INTERVAL_MS;
        if (movedEnough && dueForSample) {
          this._emit(s, t);
          anyMoved = true;
        }
      }
    }

    // Land every creep back on its guard spot at the end of the window so a
    // camp that was pulled and survived is not left frozen mid-stride.
    sims.forEach(s => {
      if (!s.moved) return;
      if (dist(s.lastSampleX, s.lastSampleY, s.guard.x, s.guard.y) <= ARRIVE_EPSILON_WU) return;
      s.x = s.guard.x;
      s.y = s.guard.y;
      this._emit(s, window.end);
    });

    return anyMoved;
  }

  _emit (s, t) {
    if (!s.moved) {
      // First movement sample: stamp the guard position at the moment the
      // creep started moving, so the client interpolates from where it stood
      // rather than from its single spawn sample at t=0.
      s.creep.path.push({
        x: +s.guard.x.toFixed(2), y: +s.guard.y.toFixed(2),
        gameTime: Math.round(Math.max(0, t - SIM_STEP_MS)), isJump: false
      });
      this.stats.samples++;
      s.moved = true;
      this.stats.creepsMoved++;
    }
    s.creep.path.push({
      x: +s.x.toFixed(2), y: +s.y.toFixed(2),
      gameTime: Math.round(t), isJump: false
    });
    s.lastSampleT = t;
    s.lastSampleX = s.x;
    s.lastSampleY = s.y;
    this.stats.samples++;
  }
};

module.exports = CreepGuardSim;
module.exports.ACQUISITION_RANGE = ACQUISITION_RANGE;
