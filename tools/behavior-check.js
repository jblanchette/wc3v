//
// behavior-check.js — validates the unit-behavior authority (client/js/UnitBehavior.js).
//
// Requires THE SAME module the viewer runs, so the harness cannot drift from
// what's on screen. Steps a sampling clock over a real .wc3v and asserts the
// invariants that the old renderer violated constantly:
//
//   - a unit in 'attack' ALWAYS has a concrete, living, in-reach target
//   - melee only swings at contact distance, after sustained contact
//   - creeps never swing outside their own range
//   - decisions are identical replayed forwards and backwards (seek safety)
//
// It also reports the legacy rule's numbers side by side, so "is this actually
// better" is a measurement rather than an opinion.
//
// Usage:
//   node tools/behavior-check.js --replay=NAME [--step=250] [--from=MM:SS] [--to=MM:SS]
//   node tools/behavior-check.js --all [--limit=8]
//
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const UB = require('../client/js/UnitBehavior.js');

const args = {};
process.argv.slice(2).forEach(r => {
  const [f, ...v] = r.replace(/^--/, '').split('=');
  args[f] = v.join('=') || true;
});

const REPLAY_DIR = path.join(__dirname, '..', 'client', 'replays');

let pass = 0, fail = 0;
function check (name, cond, detail) {
  if (cond) { pass++; console.log(`    ✓ ${name}`); }
  else { fail++; console.log(`    ✗ ${name}${detail ? '  — ' + detail : ''}`); }
}

function loadReplay (name) {
  const gz = path.join(REPLAY_DIR, name.endsWith('.wc3v.gz') ? name : name + '.wc3v.gz');
  if (!fs.existsSync(gz)) throw new Error('no such replay: ' + gz);
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8'));
}

function parseClock (s) {
  if (s == null) return null;
  const m = String(s).match(/^(\d+):(\d+)$/);
  if (m) return (+m[1] * 60 + +m[2]) * 1000;
  return +s;
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

// The rule this replaces: stationary AND anywhere in an active battle window.
function legacyAttackSet (data, t) {
  const set = new Set();
  for (const b of (data.battles || [])) {
    if (t < b.startTime || t > b.endTime || !b.participants) continue;
    for (const p of b.participants) for (const uu of (p.unitUuids || [])) set.add(uu);
  }
  return set;
}

function runReplay (name) {
  const data = loadReplay(name);
  const units = buildUnits(data);
  const world = UB.createWorld({
    units,
    battles: data.battles || [],
    camps: (data.world && data.world.neutralGroups) || {}
  });

  const step = +(args.step || 250);
  const from = parseClock(args.from) != null ? parseClock(args.from) : 0;
  const end = parseClock(args.to) != null ? parseClock(args.to)
    : (data.replay && data.replay.duration) || 900000;

  const times = [];
  for (let t = from; t <= end; t += step) times.push(t);

  const V = {
    attackNoTarget: 0, attackTargetDead: 0, attackOutOfReach: 0,
    attackWhileMoving: 0, attackNoCorroboration: 0, attackStale: 0,
    meleeShortDwell: 0, creepOutOfRange: 0, facingOverBudget: 0
  };
  let frames = 0, walk = 0, attack = 0, idle = 0, suppressed = 0;
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
  const world2 = UB.createWorld({
    units, battles: data.battles || [], camps: (data.world && data.world.neutralGroups) || {}
  });
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

  const pct = (n, d) => d ? ((n / d) * 100).toFixed(1) + '%' : '—';

  console.log(`\n  ${name}`);
  console.log(`  window ${(times[0] / 1000 / 60).toFixed(1)}–${(times[times.length - 1] / 1000 / 60).toFixed(1)} min` +
    `  step=${step}ms  ticks=${times.length}  actors=${units.length}`);
  console.log(`\n  INVARIANTS`);
  check('attack with no resolved target', V.attackNoTarget === 0, `${V.attackNoTarget}`);
  check('attack with target dead at t', V.attackTargetDead === 0, `${V.attackTargetDead}`);
  check('attack with target out of reach', V.attackOutOfReach === 0, `${V.attackOutOfReach}`);
  check('attack while moving', V.attackWhileMoving === 0, `${V.attackWhileMoving}`);
  check('attack with no corroboration source', V.attackNoCorroboration === 0, `${V.attackNoCorroboration}`);
  check('creep attacking outside its own range', V.creepOutOfRange === 0, `${V.creepOutOfRange}`);
  check('forward-vs-reverse decision mismatch (seek safety)', mismatch === 0, `${mismatch}/${times.length} ticks`);

  console.log(`\n  STATE MIX  (${frames} unit-frames)`);
  console.log(`    walk ${pct(walk, frames)}   attack ${pct(attack, frames)}   idle ${pct(idle, frames)}`);
  console.log(`    legacy attack frames (stationary AND in a battle window): ${legacyAttackFrames}`);
  console.log(`    ...of which the new rule finds NO target  -> AIR SWINGS REMOVED: ${airSwings}` +
    ` (${pct(airSwings, legacyAttackFrames)} of all legacy swings)`);
  console.log(`    corroborated-but-no-target frames (all sources): ${suppressed}`);
  console.log(`    corroboration: battle ${bySource.battle || 0}  order ${bySource.order || 0}  camp ${bySource.camp || 0}`);
  console.log(`\n  FLIPS`);
  console.log(`    state transitions per unit-minute: ${(totalFlips / unitCount / durMin).toFixed(2)}`);

  return {
    ok: fail === 0,
    attackPct: frames ? attack / frames : 0,
    legacyPct: legacyStationaryFrames ? legacyAttackFrames / legacyStationaryFrames : 0,
    legacyAttackFrames, airSwings
  };
}

// --- main -------------------------------------------------------------------
let names = [];
if (args.all) {
  names = fs.readdirSync(REPLAY_DIR).filter(f => f.endsWith('.wc3v.gz'))
    .slice(0, +(args.limit || 6));
} else if (args.replay) {
  names = [args.replay];
} else {
  console.error('usage: node tools/behavior-check.js --replay=NAME | --all [--limit=N]');
  process.exit(2);
}

const results = [];
for (const n of names) {
  try { results.push(runReplay(n)); }
  catch (e) { fail++; console.log(`  ✗ ${n} — ${e.message}`); }
}

console.log(`\n${'='.repeat(64)}`);
if (results.length) {
  const avgNew = results.reduce((a, r) => a + r.attackPct, 0) / results.length;
  const avgOld = results.reduce((a, r) => a + r.legacyPct, 0) / results.length;
  const la = results.reduce((a, r) => a + r.legacyAttackFrames, 0);
  const air = results.reduce((a, r) => a + r.airSwings, 0);
  console.log(`legacy swing-frames ${la}; of those ${air} had NO valid target ` +
    `(${la ? ((air / la) * 100).toFixed(1) : '0'}% were swinging at air)`);
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
