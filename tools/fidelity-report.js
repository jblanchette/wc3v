/**
 * fidelity-report.js — the viewer-vs-engine correctness scorecard.
 *
 * Aggregates every fidelity measurement we have into one per-replay report +
 * fleet rollup, so "did this change make the viewer more correct" is a paired
 * before/after diff rather than an opinion. Methodology follows
 * validate-dominance.js: fix mechanisms, re-run, compare distributions —
 * never fit individual replays.
 *
 * Dimensions (each reported raw — deliberately NO weighted composite):
 *   behavior     invariants + air-swing stats from tools/lib/behavior-metrics
 *                (runs the SAME UnitBehavior module the viewer loads)
 *   kinematics   KinematicResim speed-cap audit (tools/lib/kinematics-audit)
 *   movement     ground-truth move-target verify (tools/lib/move-verify);
 *                n/a unless the .wc3v was parsed with --move-trace
 *   engineTruth  hand-authored observations from real WC3 playback
 *                (client/data/engine-truth/<id>.json, scored by
 *                tools/validate-engine-truth.js); n/a until captured
 *
 * HEADLINE: "blatant mistakes per game-minute" — a count of concrete
 * wrongnesses (invariant frames, seek mismatches, speed violations, strict
 * moves that never arrived, engine-truth blatant failures). The composition
 * is printed so --diff always compares like with like.
 *
 * Usage:
 *   node tools/fidelity-report.js                      — all replays, human report
 *   node tools/fidelity-report.js --replay=ID          — single replay detail
 *   node tools/fidelity-report.js --limit=N            — cap processed replays
 *   node tools/fidelity-report.js --json               — machine-readable
 *   node tools/fidelity-report.js --diff=FILE.json     — paired comparison vs an earlier --json run
 *   node tools/fidelity-report.js --step=250           — behavior sampling step (ms)
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BM = require('./lib/behavior-metrics.js');
const MV = require('./lib/move-verify.js');
const KA = require('./lib/kinematics-audit.js');

const REPLAYS_DIR = path.join(__dirname, '..', 'client', 'replays');
const TRUTH_DIR = path.join(__dirname, '..', 'client', 'data', 'engine-truth');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

function loadReplay (basePath) {
  if (fs.existsSync(`${basePath}.wc3v`)) {
    return JSON.parse(fs.readFileSync(`${basePath}.wc3v`, 'utf8'));
  }
  if (fs.existsSync(`${basePath}.wc3v.gz`)) {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(`${basePath}.wc3v.gz`)).toString());
  }
  return null;
}

// The 6 per-frame invariants + the seek-safety mismatch, in display order.
const INVARIANT_KEYS = [
  'attackNoTarget', 'attackTargetDead', 'attackOutOfReach',
  'attackWhileMoving', 'attackNoCorroboration', 'creepOutOfRange'
];

function measureMovement (data) {
  // Pool every non-neutral player's verify buckets into one sample.
  const merged = {
    move: { cmds: 0, evaluable: 0, converged: 0, posErr: [], timeRatio: [], netSpeedRatio: [] },
    other: { cmds: 0, evaluable: 0, converged: 0, posErr: [], timeRatio: [], netSpeedRatio: [] }
  };
  let traced = false;
  for (const [pid, pdata] of Object.entries(data.players || {})) {
    if (!pdata || pdata.isNeutralPlayer) continue;
    const res = MV.verify(data, pid, {});
    if (!res) continue;
    traced = true;
    for (const k of ['move', 'other']) {
      const b = res.buckets[k], m = merged[k];
      m.cmds += b.cmds; m.evaluable += b.evaluable; m.converged += b.converged;
      m.posErr.push(...b.posErr);
      m.timeRatio.push(...b.timeRatio);
      m.netSpeedRatio.push(...b.netSpeedRatio);
    }
  }
  if (!traced) return null;
  return {
    move: MV.summarize(merged.move),
    other: MV.summarize(merged.other),
    strictNonConverged: merged.move.evaluable - merged.move.converged
  };
}

function loadTruthFixture (id) {
  const file = path.join(TRUTH_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
  // _circular fixtures are harness selftests derived from parser output —
  // scoring them would inflate the report with data that proves nothing.
  if (fixture.meta && fixture.meta._circular) return null;
  return fixture;
}

function measureReplay (id) {
  const data = loadReplay(path.join(REPLAYS_DIR, id));
  if (!data) return null;

  const behavior = BM.measure(data, { step: +(args.step || 250) });
  const kin = KA.audit(data);
  const movement = measureMovement(data);

  let truth = null;
  const fixture = loadTruthFixture(id);
  if (fixture) {
    const ET = require('./validate-engine-truth.js');
    truth = ET.score(data, fixture);
  }

  const durationMin = ((data.replay && data.replay.duration) || behavior.times.last || 60000) / 60000;

  const invariantFrames = INVARIANT_KEYS.reduce((a, k) => a + behavior.violations[k], 0);
  const terms = {
    behavior: invariantFrames + behavior.mismatch,
    kinematics: kin.speedViolations,
    movement: movement ? movement.strictNonConverged : null,   // null = not measured
    engineTruth: truth ? truth.blatant : null
  };
  const blatant = Object.values(terms).reduce((a, v) => a + (v || 0), 0);

  return {
    id,
    durationMin: +durationMin.toFixed(1),
    behavior: {
      invariants: INVARIANT_KEYS.map(k => behavior.violations[k]),
      mismatch: behavior.mismatch,
      frames: behavior.frames,
      attackPct: +(100 * behavior.attack / Math.max(1, behavior.frames)).toFixed(1),
      walkPct: +(100 * behavior.walk / Math.max(1, behavior.frames)).toFixed(1),
      airSwings: behavior.airSwings,
      legacyAttackFrames: behavior.legacyAttackFrames,
      airSwingPct: +(behavior.legacyAttackFrames
        ? (100 * behavior.airSwings / behavior.legacyAttackFrames) : 0).toFixed(1),
      suppressed: behavior.suppressed,
      bySource: behavior.bySource,
      flipsPerUnitMinute: +behavior.flipsPerUnitMinute.toFixed(2)
    },
    kinematics: {
      pairs: kin.pairs,
      speedViolations: kin.speedViolations,
      worstRatio: +kin.worstRatio.toFixed(2),
      unitsWithoutFacing: kin.unitsWithoutFacing
    },
    movement: movement && {
      strictCmds: movement.move ? movement.move.evaluable : 0,
      strictConvergencePct: movement.move ? +movement.move.convergencePct.toFixed(1) : null,
      strictNonConverged: movement.strictNonConverged,
      posErrMedian: movement.move ? Math.round(movement.move.posErrMedian) : null,
      posErrP90: movement.move ? Math.round(movement.move.posErrP90) : null,
      netSpeedMedian: movement.other ? +movement.other.netSpeedMedian.toFixed(2) : null,
      otherConvergencePct: movement.other ? +movement.other.convergencePct.toFixed(1) : null
    },
    engineTruth: truth,
    headline: {
      blatantPerMin: +(blatant / Math.max(0.1, durationMin)).toFixed(2),
      blatant,
      terms
    }
  };
}

// --- presentation -----------------------------------------------------------

function fmtTerms (terms) {
  return Object.entries(terms)
    .map(([k, v]) => `${k} ${v == null ? 'n/a' : v}`)
    .join(', ');
}

function printReplay (r) {
  const b = r.behavior, k = r.kinematics, m = r.movement, t = r.engineTruth;
  console.log(`\n── fidelity: ${r.id} ─ ${r.durationMin} min ${'─'.repeat(Math.max(1, 44 - r.id.length))}`);
  console.log(` behavior     invariants ${b.invariants.join('/')} seek ${b.mismatch}   airSwingsRemoved ${b.airSwings} (${b.airSwingPct}% of legacy)`);
  console.log(`              attack ${b.attackPct}%  walk ${b.walkPct}%  flips/unit-min ${b.flipsPerUnitMinute}  corroboration battle ${b.bySource.battle || 0} order ${b.bySource.order || 0} camp ${b.bySource.camp || 0}`);
  console.log(` kinematics   speed violations ${k.speedViolations} / ${k.pairs} segments (worst ${k.worstRatio}×)  noFacing ${k.unitsWithoutFacing}`);
  if (m) {
    console.log(` movement     strict conv ${m.strictConvergencePct == null ? 'n/a' : m.strictConvergencePct + '%'} (${m.strictCmds} cmds)  posErr med ${m.posErrMedian}u p90 ${m.posErrP90}u  netSpeed med ${m.netSpeedMedian}   [moveTrace ✓]`);
  } else {
    console.log(` movement     n/a — parse with: node wc3v.js --replay=${r.id} --move-trace`);
  }
  if (t) {
    console.log(` engineTruth  ${t.passed}/${t.total} checks  blatant ${t.blatant}  ${t.categories ? Object.entries(t.categories).map(([c, v]) => `${c} ${v.passed}/${v.total}`).join('  ') : ''}`);
  } else {
    console.log(` engineTruth  n/a (no fixture)`);
  }
  console.log(` HEADLINE     blatant mistakes: ${r.headline.blatantPerMin} / game-min   (terms: ${fmtTerms(r.headline.terms)})`);
}

function main () {
  const files = fs.readdirSync(REPLAYS_DIR)
    .filter(f => f.endsWith('.wc3v.gz'))
    .map(f => f.replace(/\.wc3v\.gz$/, ''))
    .filter(id => !args.replay || id === args.replay)
    .sort();
  const limit = parseInt(args.limit) || files.length;

  const perReplay = [];
  const errors = {};
  for (const id of files.slice(0, limit)) {
    try {
      const r = measureReplay(id);
      if (r) perReplay.push(r);
    } catch (e) {
      errors[id] = e.message;
    }
  }

  const n = perReplay.length;
  const vals = (fn) => perReplay.map(fn).filter(v => v != null && !Number.isNaN(v));
  const mean = (a) => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null;
  const median = (a) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;

  const withTrace = perReplay.filter(r => r.movement).length;
  const withTruth = perReplay.filter(r => r.engineTruth).length;
  const blatants = vals(r => r.headline.blatantPerMin);
  const worst = [...perReplay].sort((a, b) => b.headline.blatantPerMin - a.headline.blatantPerMin).slice(0, 5);

  const aggregate = {
    replays: n,
    errors,
    coverage: { withMoveTrace: withTrace, withEngineTruth: withTruth },
    blatantPerMin: { mean: mean(blatants), median: median(blatants) },
    invariantTotal: vals(r => r.behavior.invariants.reduce((a, b) => a + b, 0) + r.behavior.mismatch).reduce((a, b) => a + b, 0),
    airSwingPct: { mean: mean(vals(r => r.behavior.airSwingPct)) },
    flipsPerUnitMinute: { mean: mean(vals(r => r.behavior.flipsPerUnitMinute)) },
    speedViolationTotal: vals(r => r.kinematics.speedViolations).reduce((a, b) => a + b, 0),
    strictConvergencePct: { mean: mean(vals(r => r.movement && r.movement.strictConvergencePct)) },
    posErrMedian: { mean: mean(vals(r => r.movement && r.movement.posErrMedian)) },
    engineTruthPassPct: { mean: mean(vals(r => r.engineTruth && r.engineTruth.total
      ? +(100 * r.engineTruth.passed / r.engineTruth.total).toFixed(1) : null)) },
    worst5: worst.map(r => ({ id: r.id, blatantPerMin: r.headline.blatantPerMin, terms: r.headline.terms }))
  };

  if (args.json) {
    console.log(JSON.stringify({ perReplay, aggregate }, null, 2));
    return;
  }

  if (args.diff) {
    const prev = JSON.parse(fs.readFileSync(args.diff, 'utf8'));
    const prevById = new Map(prev.perReplay.map(r => [r.id, r]));
    const paired = perReplay.filter(r => prevById.has(r.id));
    let improved = 0, worsened = 0, sumDelta = 0;
    const rows = [];
    for (const r of paired) {
      const before = prevById.get(r.id);
      const d = +(r.headline.blatantPerMin - before.headline.blatantPerMin).toFixed(2);
      sumDelta += d;
      if (d < -0.05) improved++;        // fewer blatant mistakes = improvement
      else if (d > 0.05) worsened++;
      rows.push({ id: r.id, before: before.headline.blatantPerMin, after: r.headline.blatantPerMin, d });
    }
    rows.sort((a, b) => b.d - a.d);
    const dim = (label, get) => {
      const b = get(prev.aggregate), a = get(aggregate);
      if (b == null && a == null) return;
      console.log(`  ${label.padEnd(24)} ${b == null ? 'n/a' : b}  →  ${a == null ? 'n/a' : a}`);
    };
    console.log(`Paired diff vs ${args.diff} — ${paired.length} common replay(s)`);
    console.log(`  blatantPerMin mean delta: ${(sumDelta / Math.max(1, paired.length)).toFixed(3)}  (negative = better)`);
    console.log(`  improved: ${improved}   worsened: ${worsened}   ~flat: ${paired.length - improved - worsened}`);
    console.log(`\n  aggregate dimensions (before → after):`);
    dim('invariantTotal', a => a.invariantTotal);
    dim('speedViolationTotal', a => a.speedViolationTotal);
    dim('airSwingPct mean', a => a.airSwingPct && a.airSwingPct.mean);
    dim('flips/unit-min mean', a => a.flipsPerUnitMinute && a.flipsPerUnitMinute.mean);
    dim('strictConv% mean', a => a.strictConvergencePct && a.strictConvergencePct.mean);
    dim('posErrMedian mean', a => a.posErrMedian && a.posErrMedian.mean);
    dim('engineTruth pass% mean', a => a.engineTruthPassPct && a.engineTruthPassPct.mean);
    console.log('\n  5 most worsened:');
    rows.slice(0, 5).forEach(r => console.log(`    ${(r.d >= 0 ? '+' : '') + r.d}  ${r.before} → ${r.after}  ${r.id}`));
    console.log('  5 most improved:');
    rows.slice(-5).reverse().forEach(r => console.log(`    ${(r.d >= 0 ? '+' : '') + r.d}  ${r.before} → ${r.after}  ${r.id}`));
    return;
  }

  perReplay.forEach(printReplay);

  console.log(`\n${'='.repeat(64)}`);
  console.log(`FLEET — ${n} replay(s), ${withTrace} with moveTrace, ${withTruth} with engine-truth fixtures`);
  if (Object.keys(errors).length) console.log(`  errors: ${JSON.stringify(errors)}`);
  console.log(`  blatant/game-min   mean=${aggregate.blatantPerMin.mean}  median=${aggregate.blatantPerMin.median}`);
  console.log(`  invariant total    ${aggregate.invariantTotal}   speed-violation total ${aggregate.speedViolationTotal}`);
  console.log(`  airSwing% mean     ${aggregate.airSwingPct.mean}   flips/unit-min mean ${aggregate.flipsPerUnitMinute.mean}`);
  if (aggregate.strictConvergencePct.mean != null) {
    console.log(`  strict conv% mean  ${aggregate.strictConvergencePct.mean}   posErr median mean ${aggregate.posErrMedian.mean}u`);
  }
  if (aggregate.engineTruthPassPct.mean != null) {
    console.log(`  engineTruth pass%  ${aggregate.engineTruthPassPct.mean}`);
  }
  console.log(`  worst 5 by blatant/game-min:`);
  worst.forEach(r => console.log(`    ${String(r.headline.blatantPerMin).padStart(6)}  ${r.id}  (${fmtTerms(r.headline.terms)})`));
}

main();
