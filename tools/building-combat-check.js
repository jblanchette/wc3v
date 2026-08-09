//
// building-combat-check.js — is a building ever a live attack target?
//
// The bug this exists for: units attacking a building play no attack animation
// at all. UnitBehavior only emits 'attack' when it can resolve a concrete living
// hostile in reach, so if buildings are not in its live set, or fall out of it,
// every siege in the replay renders as an army standing politely around a town
// hall.
//
// Runs the SAME client/js/UnitBehavior.js the viewer runs and reports, per tick:
//   - how many buildings are in the live set vs how many exist and are built
//   - how many actors resolve a BUILDING as their attack target
//   - the same for units, as a control
//
// Usage:
//   node tools/building-combat-check.js --replay=NAME [--step=500]
//   node tools/building-combat-check.js --all [--limit=8]
//
const fs = require('fs');
const path = require('path');

const BM = require('./lib/behavior-metrics.js');
const UB = BM.UB;

const args = {};
process.argv.slice(2).forEach(r => {
  const [f, ...v] = r.replace(/^--/, '').split('=');
  args[f] = v.join('=') || true;
});

function fmtClock (ms) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function measure (data, opts) {
  const units = BM.buildUnits(data);
  const world = BM.createWorld(data, units);
  const byUuid = new Map(units.map(u => [u.uuid, u]));
  const buildings = units.filter(u => u.isBuilding);

  const step = +(opts.step || 500);
  const end = (data.replay && data.replay.duration) || 900000;

  let ticks = 0;
  let existSum = 0, liveSum = 0;          // buildings that exist / are in the live set
  let atkOnBuilding = 0, atkOnUnit = 0;   // resolved attack targets by kind
  const firstMiss = [];                   // buildings alive but absent from live
  const missBy = new Map();               // why they are absent
  const attackedBuildings = new Set();

  for (let t = 0; t <= end; t += step) {
    const frame = world.resolve(t);
    ticks++;

    const liveIds = new Set(frame.live.map(l => l.uuid));
    let exist = 0, live = 0;
    for (const b of buildings) {
      const ready = UB.readyTimeOf(b);
      const dead = UB.deathStartOf(b);
      if (ready != null && t < ready) continue;
      if (dead != null && t >= dead) continue;
      exist++;
      if (liveIds.has(b.uuid)) live++;
      else {
        // Why is a standing building not a target? Either the behavior world has
        // no position for it at all, or something upstream dropped it.
        const s = UB.sampleAt(b.path, t);
        const why = !b.path || !b.path.length ? 'no path'
          : (!s ? 'no sample at t (first sample is later)' : 'has sample, filtered');
        missBy.set(why, (missBy.get(why) || 0) + 1);
        if (firstMiss.length < 5) {
          firstMiss.push({ t, name: b.displayName || b.itemId, why });
        }
      }
    }
    existSum += exist; liveSum += live;

    for (const [, d] of frame.byUuid) {
      if (d.state !== 'attack' || !d.targetUuid) continue;
      const tgt = byUuid.get(d.targetUuid);
      if (tgt && tgt.isBuilding) { atkOnBuilding++; attackedBuildings.add(d.targetUuid); }
      else atkOnUnit++;
    }
  }

  return {
    step, end, ticks,
    buildings: buildings.length,
    existSum, liveSum,
    atkOnBuilding, atkOnUnit,
    attackedBuildings: attackedBuildings.size,
    maxR: units.reduce((m, u) => Math.max(m, u.collisionSize || 0), 0),
    firstMiss, missBy
  };
}

function report (name, M) {
  const pct = (n, d) => d ? ((n / d) * 100).toFixed(1) + '%' : '—';
  console.log(`\n  ${name}`);
  console.log(`  0:00–${fmtClock(M.end)}  step=${M.step}ms  buildings in replay=${M.buildings}`);
  console.log(`    building-ticks that EXIST (built, not destroyed)   ${M.existSum}`);
  console.log(`    ...of those, present in UnitBehavior's live set    ${M.liveSum}  ${pct(M.liveSum, M.existSum)}`);
  console.log(`    attack frames resolved onto a BUILDING             ${M.atkOnBuilding}`);
  console.log(`    attack frames resolved onto a UNIT   (control)     ${M.atkOnUnit}`);
  console.log(`    distinct buildings ever attacked                   ${M.attackedBuildings}`);
  // MAX_TARGET_RADIUS sizes the spatial-hash query. A target radius larger than
  // it is a silent false NEGATIVE — the building never enters the candidate set,
  // and no invariant catches a target that was never considered.
  const cap = UB.C.MAX_TARGET_RADIUS;
  console.log(`    largest building collisionSize                     ${M.maxR}` +
    (M.maxR > cap ? `  ✗ EXCEEDS MAX_TARGET_RADIUS (${cap})` : `  (cap ${cap} ok)`));
  if (M.missBy && M.missBy.size) {
    console.log(`    missing-from-live building-ticks, by reason:`);
    for (const [why, n] of [...M.missBy.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${String(n).padStart(8)}  ${why}`);
    }
  }
  if (M.firstMiss.length) {
    console.log(`    first buildings missing from live:`);
    for (const f of M.firstMiss) console.log(`      ${fmtClock(f.t)}  ${f.name} — ${f.why}`);
  }
  return M;
}

function main () {
  let names;
  if (args.all) {
    names = fs.readdirSync(BM.REPLAY_DIR)
      .filter(f => f.endsWith('.wc3v.gz'))
      .slice(0, +(args.limit || 8));
  } else if (args.replay) {
    names = [args.replay];
  } else {
    console.log('usage: node tools/building-combat-check.js --replay=NAME [--step=500]');
    console.log('       node tools/building-combat-check.js --all [--limit=8]');
    process.exit(1);
  }

  const tot = { existSum: 0, liveSum: 0, atkOnBuilding: 0, atkOnUnit: 0, attacked: 0 };
  for (const n of names) {
    let data;
    try { data = BM.loadReplay(n.replace(/\.wc3v\.gz$/, '')); }
    catch (e) { console.log(`  ${n}: ${e.message}`); continue; }
    const M = report(path.basename(n, '.wc3v.gz'), measure(data, { step: +(args.step || 500) }));
    tot.existSum += M.existSum; tot.liveSum += M.liveSum;
    tot.atkOnBuilding += M.atkOnBuilding; tot.atkOnUnit += M.atkOnUnit;
    tot.attacked += M.attackedBuildings;
  }

  if (names.length > 1) {
    const pct = (n, d) => d ? ((n / d) * 100).toFixed(1) + '%' : '—';
    console.log(`\n  ═══ TOTAL over ${names.length} replays ═══`);
    console.log(`    buildings live / exist        ${tot.liveSum}/${tot.existSum}  ${pct(tot.liveSum, tot.existSum)}`);
    console.log(`    attack frames on buildings    ${tot.atkOnBuilding}`);
    console.log(`    attack frames on units        ${tot.atkOnUnit}`);
    console.log(`    distinct buildings attacked   ${tot.attacked}`);
  }
  console.log('');
}

main();
