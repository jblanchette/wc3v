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
// The measurement itself lives in tools/lib/behavior-metrics.js (shared with
// fidelity-report.js); this file is presentation + pass/fail only.
//
// Usage:
//   node tools/behavior-check.js --replay=NAME [--step=250] [--from=MM:SS] [--to=MM:SS]
//   node tools/behavior-check.js --all [--limit=8]
//
const fs = require('fs');

const BM = require('./lib/behavior-metrics.js');

const args = {};
process.argv.slice(2).forEach(r => {
  const [f, ...v] = r.replace(/^--/, '').split('=');
  args[f] = v.join('=') || true;
});

let pass = 0, fail = 0;
function check (name, cond, detail) {
  if (cond) { pass++; console.log(`    ✓ ${name}`); }
  else { fail++; console.log(`    ✗ ${name}${detail ? '  — ' + detail : ''}`); }
}

function parseClock (s) {
  if (s == null) return null;
  const m = String(s).match(/^(\d+):(\d+)$/);
  if (m) return (+m[1] * 60 + +m[2]) * 1000;
  return +s;
}

function runReplay (name) {
  const data = BM.loadReplay(name);
  const M = BM.measure(data, {
    step: +(args.step || 250),
    from: parseClock(args.from),
    to: parseClock(args.to)
  });

  const V = M.violations;
  const pct = (n, d) => d ? ((n / d) * 100).toFixed(1) + '%' : '—';

  console.log(`\n  ${name}`);
  console.log(`  window ${(M.times.first / 1000 / 60).toFixed(1)}–${(M.times.last / 1000 / 60).toFixed(1)} min` +
    `  step=${M.step}ms  ticks=${M.times.count}  actors=${M.actors}`);
  console.log(`\n  INVARIANTS`);
  check('attack with no resolved target', V.attackNoTarget === 0, `${V.attackNoTarget}`);
  check('attack with target dead at t', V.attackTargetDead === 0, `${V.attackTargetDead}`);
  check('attack with target out of reach', V.attackOutOfReach === 0, `${V.attackOutOfReach}`);
  check('attack while moving', V.attackWhileMoving === 0, `${V.attackWhileMoving}`);
  check('attack with no corroboration source', V.attackNoCorroboration === 0, `${V.attackNoCorroboration}`);
  check('creep attacking outside its own range', V.creepOutOfRange === 0, `${V.creepOutOfRange}`);
  check('forward-vs-reverse decision mismatch (seek safety)', M.mismatch === 0, `${M.mismatch}/${M.times.count} ticks`);

  console.log(`\n  STATE MIX  (${M.frames} unit-frames)`);
  console.log(`    walk ${pct(M.walk, M.frames)}   attack ${pct(M.attack, M.frames)}` +
    `   cast ${pct(M.cast, M.frames)}   idle ${pct(M.idle, M.frames)}`);
  console.log(`    legacy attack frames (stationary AND in a battle window): ${M.legacyAttackFrames}`);
  console.log(`    ...of which the new rule finds NO target  -> AIR SWINGS REMOVED: ${M.airSwings}` +
    ` (${pct(M.airSwings, M.legacyAttackFrames)} of all legacy swings)`);
  console.log(`    corroborated-but-no-target frames (all sources): ${M.suppressed}`);
  console.log(`    corroboration: battle ${M.bySource.battle || 0}  order ${M.bySource.order || 0}` +
    `  camp ${M.bySource.camp || 0}  summon ${M.bySource.summon || 0}`);

  // The false-negative side. Every invariant above catches the viewer attacking
  // when it should not; this is the count of the opposite — a unit standing idle
  // with a valid, living, targetable enemy inside its real acquisition radius.
  // Not an invariant (it is a pressure gauge, not a proof of error), but it is
  // the number that moves when units stop looking frozen in fights.
  console.log(`\n  MISSED ATTACKS  (idle with a targetable enemy inside real acquire range)`);
  console.log(`    ${M.missedAttack} frames  (${M.missedPerMin.toFixed(0)}/game-min, ` +
    `${pct(M.missedAttack, M.idle)} of all idle frames)`);
  const mr = Object.entries(M.missedByReason).sort((a, b) => b[1] - a[1]);
  if (mr.length) console.log('    by idle reason: ' + mr.map(([k, v]) => `${k} ${v}`).join('  '));
  const ir = Object.entries(M.idleReasons).sort((a, b) => b[1] - a[1]);
  if (ir.length) console.log('    all idle reasons: ' + ir.map(([k, v]) => `${k} ${v}`).join('  '));

  console.log(`\n  FLIPS`);
  console.log(`    state transitions per unit-minute: ${(M.totalFlips / M.unitCount / M.durMin).toFixed(2)}`);

  return {
    ok: fail === 0,
    attackPct: M.frames ? M.attack / M.frames : 0,
    legacyPct: M.legacyStationaryFrames ? M.legacyAttackFrames / M.legacyStationaryFrames : 0,
    legacyAttackFrames: M.legacyAttackFrames,
    airSwings: M.airSwings
  };
}

// --- main -------------------------------------------------------------------
let names = [];
if (args.all) {
  names = fs.readdirSync(BM.REPLAY_DIR).filter(f => f.endsWith('.wc3v.gz'))
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
