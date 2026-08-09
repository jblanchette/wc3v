//
// projectile-check.js — validates the projectile model (client/js/ProjectileModel.js).
//
// Requires THE SAME module the viewer runs, so the harness cannot drift from
// what's on screen — same contract as behavior-check.js, which it mirrors.
//
// Replays record no attacks at all, so every projectile is synthesized. That
// makes two properties the whole ballgame:
//
//   1. SEEK SAFETY — scrubbing backward must reproduce exactly what scrubbing
//      forward produced. The set of live projectiles is recomputed from
//      gameTime with no stored state, so this is checkable by simply walking
//      the clock both ways and comparing.
//   2. HONEST CADENCE — a unit must never appear to fire faster than the game
//      would let it, and must never fire at all if it can't (melee, no target,
//      before it engaged).
//
// Everything else is geometry, checked against the closed-form arc.
//
// Usage:
//   node tools/projectile-check.js --replay=NAME [--step=100] [--from=MM:SS] [--to=MM:SS]
//   node tools/projectile-check.js --all [--limit=6]
//
const fs = require('fs');

const BM = require('./lib/behavior-metrics.js');
const PM = require('../client/js/ProjectileModel.js');

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

function clock (ms) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function parseClock (s) {
  if (s == null) return null;
  const m = String(s).match(/^(\d+):(\d+)$/);
  if (m) return (+m[1] * 60 + +m[2]) * 1000;
  return +s;
}

// A projectile's identity is (shooter, swing index) — deterministic by
// construction. Position is folded in at 0.01wu so the comparison catches a
// geometry drift, not just a set-membership difference.
function boltKey (b) {
  return b.uuid + '#' + b.swing + '@' +
    Math.round(b.x * 100) + ',' + Math.round(b.y * 100) + ',' + Math.round(b.z * 100) +
    '|' + Math.round(b.yaw * 1000) + ',' + Math.round(b.pitch * 1000);
}
function puffKey (p) {
  return p.uuid + '#' + p.swing + '@' +
    Math.round(p.x * 100) + ',' + Math.round(p.y * 100) + '|' + Math.round(p.age * 1000);
}

function snapshot (col) {
  return [
    col.bolts.map(boltKey).sort().join(';'),
    col.impacts.map(puffKey).sort().join(';'),
    col.muzzles.map(puffKey).sort().join(';')
  ].join('||');
}

function runReplay (name) {
  const data = BM.loadReplay(name);
  const units = BM.buildUnits(data);
  const world = BM.createWorld(data, units);

  const byUuid = new Map();
  for (const u of units) byUuid.set(u.uuid, u);

  // Flat ground. Terrain height only shifts launch and impact Z by the same
  // amount the renderer will add back, and the harness has no terrain.
  const col = PM.createCollector({ unitsByUuid: byUuid });

  const step = +(args.step || 100);
  const from = parseClock(args.from) != null ? parseClock(args.from) : 0;
  const to = parseClock(args.to) != null ? parseClock(args.to)
    : ((data.replay && data.replay.duration) || 900000);

  const times = [];
  for (let t = from; t <= to; t += step) times.push(t);

  const V = {
    meleeFired: 0, noTarget: 0, beforeEngage: 0, tooFast: 0,
    badFlight: 0, badArc: 0, nanField: 0, instantTravelled: 0, dropped: 0
  };

  // uuid -> last launch time seen, for the cadence check
  const lastLaunch = new Map();
  const periodOf = new Map();
  let boltFrames = 0, impactFrames = 0, muzzleFrames = 0;
  let maxBolts = 0, maxImpacts = 0;
  const shooters = new Set();
  const forward = [];

  // --timeline: WHEN is anything actually on screen, and WHERE. The volume
  // numbers alone can't answer "I pressed play and saw nothing" — a mean of
  // 0.1 bolts/frame is either a broken model or a quiet replay, and only the
  // distribution over time tells you which.
  const wantTimeline = !!args.timeline;
  const windows = [];          // coalesced runs of ticks with something airborne
  const byArt = new Map();     // missile art name -> bolt-frames (null = generic streak)
  const byUnit = new Map();    // shooter itemId -> bolt-frames

  for (const t of times) {
    const frame = world.resolve(t);
    col.collect(t, frame);
    forward.push(snapshot(col));
    V.dropped += col.dropped;

    boltFrames += col.bolts.length;
    impactFrames += col.impacts.length;
    muzzleFrames += col.muzzles.length;
    maxBolts = Math.max(maxBolts, col.bolts.length);
    maxImpacts = Math.max(maxImpacts, col.impacts.length);

    if (wantTimeline && (col.bolts.length || col.impacts.length)) {
      const last = windows[windows.length - 1];
      // One quiet tick is still the same engagement; two ends it.
      const w = (last && t - last.end <= step * 2) ? last
        : (windows.push({ start: t, end: t, peak: 0, units: new Map(), x: 0, y: 0 }),
           windows[windows.length - 1]);
      w.end = t;
      w.peak = Math.max(w.peak, col.bolts.length + col.impacts.length);
      const anchor = col.bolts[0] || col.impacts[0];
      if (anchor) { w.x = Math.round(anchor.x); w.y = Math.round(anchor.y); }
      for (const b of col.bolts) {
        const u = byUuid.get(b.uuid);
        const id = (u && u.itemId) || '????';
        w.units.set(id, (w.units.get(id) || 0) + 1);
        byUnit.set(id, (byUnit.get(id) || 0) + 1);
        const art = b.art || '(generic streak)';
        byArt.set(art, (byArt.get(art) || 0) + 1);
      }
    }

    for (const b of col.bolts) {
      shooters.add(b.uuid);
      const d = frame.byUuid.get(b.uuid);
      if (!d) continue;
      if (d.melee) V.meleeFired++;
      if (!d.targetUuid) V.noTarget++;

      if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.z) ||
          !Number.isFinite(b.yaw) || !Number.isFinite(b.pitch)) V.nanField++;

      const shooter = byUuid.get(b.uuid);
      const combat = shooter && shooter.meta && shooter.meta.combat;
      if (!combat) continue;

      // The launch this bolt came from must postdate the engagement.
      const launchAt = PM.swingStart(b.uuid, b.swing, combat) +
        ((combat.damagePoint || 0) * 1000);
      if (d.acqTime != null && launchAt < d.acqTime - 1) V.beforeEngage++;

      // Cadence: consecutive swings from one unit are exactly one period apart.
      const period = PM.attackPeriod(combat) * 1000;
      periodOf.set(b.uuid, period);
      const prev = lastLaunch.get(b.uuid);
      if (prev != null && launchAt > prev) {
        const gap = launchAt - prev;
        // Allow a 1ms rounding slack; anything faster than a full period is a
        // unit firing quicker than the engine permits.
        if (gap < period - 1) V.tooFast++;
      }
      if (prev == null || launchAt > prev) lastLaunch.set(b.uuid, launchAt);

      // An `instant` weapon must never produce a travelling bolt.
      const target = byUuid.get(d.targetUuid);
      const spec = target ? PM.specFor(shooter, target) : null;
      if (spec && !spec.travels) V.instantTravelled++;

      // Flight must be inside the model's own bounds.
      if (b.t < -1e-9 || b.t > 1 + 1e-9) V.badFlight++;
    }
  }

  // Reverse pass — the seek-safety assertion.
  let mismatch = 0;
  for (let i = times.length - 1; i >= 0; i--) {
    const t = times[i];
    const frame = world.resolve(t);
    col.collect(t, frame);
    if (snapshot(col) !== forward[i]) mismatch++;
  }

  // Closed-form arc check, independent of the collector: at the midpoint the
  // bump must be exactly arc*D above the launch→impact chord.
  let arcErr = 0;
  for (const [zL, zI, D, arc] of [[60, 60, 800, 0.15], [66, 90, 500, 0.35], [70, 60, 1150, 0], [0, 0, 300, 0.3]]) {
    const mid = PM.arcHeight(zL, zI, D, arc, 0.5);
    const chord = (zL + zI) / 2;
    if (Math.abs((mid - chord) - arc * D) > 1e-6) arcErr++;
    if (Math.abs(PM.arcHeight(zL, zI, D, arc, 0) - zL) > 1e-9) arcErr++;
    if (Math.abs(PM.arcHeight(zL, zI, D, arc, 1) - zI) > 1e-9) arcErr++;
  }

  const durMin = (times[times.length - 1] - times[0]) / 60000 || 1;

  console.log(`\n  ${name}`);
  console.log(`  window ${(times[0] / 1000 / 60).toFixed(1)}–${(times[times.length - 1] / 1000 / 60).toFixed(1)} min` +
    `  step=${step}ms  ticks=${times.length}  shooters=${shooters.size}`);

  console.log(`\n  INVARIANTS`);
  check('melee unit fired a projectile', V.meleeFired === 0, `${V.meleeFired}`);
  check('projectile with no resolved target', V.noTarget === 0, `${V.noTarget}`);
  check('launch predates the engagement', V.beforeEngage === 0, `${V.beforeEngage}`);
  check('fired faster than the unit\'s attack period', V.tooFast === 0, `${V.tooFast}`);
  check('instant weapon produced a travelling bolt', V.instantTravelled === 0, `${V.instantTravelled}`);
  check('flight progress outside [0,1]', V.badFlight === 0, `${V.badFlight}`);
  check('NaN / non-finite position or orientation', V.nanField === 0, `${V.nanField}`);
  check('arc closed form (endpoints + midpoint peak)', arcErr === 0, `${arcErr} deviations`);
  check('forward-vs-reverse projectile mismatch (seek safety)', mismatch === 0,
    `${mismatch}/${times.length} ticks`);

  console.log(`\n  VOLUME`);
  console.log(`    bolts   ${(boltFrames / times.length).toFixed(2)} avg/frame, peak ${maxBolts}` +
    `   (pool ${PM.C.MAX_BOLTS})`);
  console.log(`    impacts ${(impactFrames / times.length).toFixed(2)} avg/frame, peak ${maxImpacts}`);
  console.log(`    muzzles ${(muzzleFrames / times.length).toFixed(2)} avg/frame`);
  console.log(`    distinct shooters: ${shooters.size}` +
    `   pool overflow drops: ${V.dropped}`);
  if (V.dropped > 0) {
    console.log(`    NOTE: ${V.dropped} records were dropped at the pool ceiling — not silent, but ` +
      `raise MAX_BOLTS if this is routine.`);
  }

  if (wantTimeline) {
    console.log(`\n  TIMELINE  (${windows.length} windows with something airborne)`);
    if (!windows.length) {
      console.log(`    nothing — UnitBehavior never resolved a ranged attack in this window`);
    }
    for (const w of windows) {
      const units = [...w.units.entries()].sort((a, b) => b[1] - a[1])
        .map(([id, n]) => `${id}×${n}`).join(' ');
      console.log(`    ${clock(w.start)}–${clock(w.end)}  ${String(Math.round((w.end - w.start) / 100) / 10).padStart(5)}s` +
        `  peak ${String(w.peak).padStart(2)}  @(${w.x},${w.y})  ${units || '(impacts only)'}`);
    }

    console.log(`\n  SHOOTERS  (bolt-frames by unit)`);
    for (const [id, n] of [...byUnit.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${id.padEnd(6)} ${n}`);
    }
    console.log(`\n  MISSILE ART  (bolt-frames by model; "generic streak" = no art resolved)`);
    for (const [art, n] of [...byArt.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${art.padEnd(28)} ${n}`);
    }
  }

  return { ok: fail === 0, boltsPerFrame: boltFrames / times.length, shooters: shooters.size, durMin };
}

// --- main -------------------------------------------------------------------
let names = [];
if (args.all) {
  names = fs.readdirSync(BM.REPLAY_DIR).filter(f => f.endsWith('.wc3v.gz'))
    .slice(0, +(args.limit || 6));
} else if (args.replay) {
  names = [args.replay];
} else {
  console.error('usage: node tools/projectile-check.js --replay=NAME | --all [--limit=N]');
  process.exit(2);
}

const results = [];
for (const n of names) {
  try { results.push(runReplay(n)); }
  catch (e) { fail++; console.log(`  ✗ ${n} — ${e.message}\n${e.stack}`); }
}

console.log(`\n${'='.repeat(64)}`);
if (results.length) {
  const avg = results.reduce((a, r) => a + r.boltsPerFrame, 0) / results.length;
  console.log(`mean bolts on screen: ${avg.toFixed(2)} per frame across ${results.length} replay(s)`);
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
