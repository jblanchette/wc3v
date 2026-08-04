//
// behavior-metrics.js — the measurement core of tools/behavior-check.js,
// extracted so other harnesses (fidelity-report, validate-engine-truth) can
// score the SAME UnitBehavior module the viewer loads without duplicating the
// world construction or the invariant sweep.
//
// Pure: no console output, no process.exit. The CLI (behavior-check.js) owns
// all printing and pass/fail presentation.
//
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const UB = require('../../client/js/UnitBehavior.js');

const REPLAY_DIR = path.join(__dirname, '..', '..', 'client', 'replays');

function loadReplay (name) {
  const gz = path.join(REPLAY_DIR, name.endsWith('.wc3v.gz') ? name : name + '.wc3v.gz');
  if (!fs.existsSync(gz)) throw new Error('no such replay: ' + gz);
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8'));
}

/**
 * Flatten the replay into the tagged unit records World expects. Buildings are
 * included as target-only actors — a footman hitting a Stronghold is a real
 * attack, and excluding buildings would make those units swing at nothing.
 */
function buildUnits (data) {
  const out = [];
  const players = data.players || {};
  for (const pid in players) {
    const p = players[pid];
    if (!p || !Array.isArray(p.units)) continue;
    const teamId = (p.teamId != null) ? p.teamId : (p.isNeutralPlayer ? 1046 : Number(pid));
    for (const u of p.units) {
      if (!u || !u.uuid) continue;
      u._playerId = Number(pid);
      u._teamId = teamId;
      u._isNeutral = !!p.isNeutralPlayer;
      out.push(u);
    }
  }
  return out;
}

function createWorld (data, units) {
  return UB.createWorld({
    units: units || buildUnits(data),
    battles: data.battles || [],
    camps: (data.world && data.world.neutralGroups) || {}
  });
}

// The rule the behavior authority replaced: stationary AND anywhere in an
// active battle window.
function legacyAttackSet (data, t) {
  const set = new Set();
  for (const b of (data.battles || [])) {
    if (t < b.startTime || t > b.endTime || !b.participants) continue;
    for (const p of b.participants) for (const uu of (p.unitUuids || [])) set.add(uu);
  }
  return set;
}

/**
 * Step a sampling clock over the replay and measure the behavior authority:
 * invariant violations, state mix, legacy-rule comparison (air swings), flip
 * rate, and forward-vs-reverse determinism.
 *
 * opts: { step=250, from=0, to=null (defaults to replay duration) }
 */
function measure (data, opts) {
  opts = opts || {};
  const units = buildUnits(data);
  const world = createWorld(data, units);

  const step = +(opts.step || 250);
  const from = (opts.from != null) ? +opts.from : 0;
  const end = (opts.to != null) ? +opts.to
    : (data.replay && data.replay.duration) || 900000;

  const times = [];
  for (let t = from; t <= end; t += step) times.push(t);

  const V = {
    attackNoTarget: 0, attackTargetDead: 0, attackOutOfReach: 0,
    attackWhileMoving: 0, attackNoCorroboration: 0, attackStale: 0,
    meleeShortDwell: 0, creepOutOfRange: 0, facingOverBudget: 0
  };
  let frames = 0, walk = 0, attack = 0, cast = 0, idle = 0, suppressed = 0;
  const bySource = { battle: 0, order: 0, camp: 0 };
  let legacyAttackFrames = 0, legacyStationaryFrames = 0, airSwings = 0;
  const flips = new Map();   // uuid -> transitions
  const lastState = new Map();
  const hashes = [];

  const byUuidLive = (frame) => {
    const m = new Map();
    for (const l of frame.live) m.set(l.uuid, l);
    return m;
  };

  for (const t of times) {
    const frame = world.resolve(t);
    const liveMap = byUuidLive(frame);
    const legacy = legacyAttackSet(data, t);
    let h = 0;

    for (const [uuid, d] of frame.byUuid) {
      frames++;
      if (d.state === 'walk') walk++;
      else if (d.state === 'attack') attack++;
      // 'cast' is a support channel (statue Replenish), deliberately NOT folded
      // into `attack` — the attack invariants below must keep measuring real
      // swings only, or a channelling statue would mask a genuine air swing.
      else if (d.state === 'cast') cast++;
      else idle++;

      // cheap order-independent hash for the determinism check
      let s = uuid.length + d.state.charCodeAt(0) * 7 +
        Math.round((d.facing || 0) * 1000) + (d.targetUuid ? d.targetUuid.length * 13 : 0);
      h = (h + s) | 0;

      // Legacy comparison, on the SAME denominator as the new rule: the old
      // renderer played an attack whenever a unit was stationary and appeared
      // in an active battle's participant list. Counting those frames directly
      // against the new rule's is what shows how much swinging was at air.
      if (d.state !== 'walk') {
        legacyStationaryFrames++;
        if (legacy.has(uuid)) {
          legacyAttackFrames++;
          // Would the old rule have swung here while the new rule found no
          // target? That frame was a unit hitting nothing.
          if (d.state !== 'attack') airSwings++;
        }
      }

      if (d.state === 'attack') {
        bySource[d.reason] = (bySource[d.reason] || 0) + 1;
        if (!d.targetUuid) V.attackNoTarget++;
        else {
          const tgt = liveMap.get(d.targetUuid);
          if (!tgt) V.attackTargetDead++;
          else {
            const actor = liveMap.get(uuid);
            const combat = (actor.u.meta && actor.u.meta.combat) || {};
            const melee = UB.isMelee(actor.u.meta);
            const reach = (combat.range || 0) + actor.r + tgt.r +
              (melee ? UB.C.MELEE_TOL : UB.C.RANGED_TOL);
            const dist = Math.hypot(tgt.x - actor.x, tgt.y - actor.y);
            if (dist > reach + 1e-6) V.attackOutOfReach++;
            if (actor.isCamp && dist > reach + 1e-6) V.creepOutOfRange++;
            if (melee && dist > actor.r + tgt.r + (combat.range || 0) + UB.C.MELEE_TOL + 1e-6) {
              V.meleeShortDwell++;
            }
          }
        }
        if (!d.reason || !['battle', 'order', 'camp'].includes(d.reason)) V.attackNoCorroboration++;
      }
      if (d.state === 'attack' && d.speed > 0) V.attackWhileMoving++;

      const prev = lastState.get(uuid);
      if (prev && prev !== d.state) flips.set(uuid, (flips.get(uuid) || 0) + 1);
      lastState.set(uuid, d.state);
    }
    suppressed += frame.stats.suppressedNoTarget;
    hashes.push(h);
  }

  // --- seek safety: same timestamps, reverse order, must be identical --------
  const world2 = createWorld(data, units);
  let mismatch = 0;
  for (let i = times.length - 1; i >= 0; i--) {
    const frame = world2.resolve(times[i]);
    let h = 0;
    for (const [uuid, d] of frame.byUuid) {
      h = (h + (uuid.length + d.state.charCodeAt(0) * 7 +
        Math.round((d.facing || 0) * 1000) + (d.targetUuid ? d.targetUuid.length * 13 : 0))) | 0;
    }
    if (h !== hashes[i]) mismatch++;
  }

  const durMin = ((times[times.length - 1] - times[0]) / 60000) || 1;
  const totalFlips = [...flips.values()].reduce((a, b) => a + b, 0);
  const unitCount = lastState.size || 1;

  return {
    step,
    times: { first: times[0], last: times[times.length - 1], count: times.length },
    actors: units.length,
    violations: V,
    mismatch,
    frames, walk, attack, cast, idle, suppressed,
    bySource,
    legacyAttackFrames, legacyStationaryFrames, airSwings,
    totalFlips, unitCount, durMin,
    flipsPerUnitMinute: totalFlips / unitCount / durMin
  };
}

module.exports = { UB, REPLAY_DIR, loadReplay, buildUnits, createWorld, legacyAttackSet, measure };
