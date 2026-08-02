/**
 * path-quality.js — Compare unit-path geometry between two parsed .wc3v files.
 *
 * A* returns an optimal-COST path, but when several paths tie on cost the one
 * returned depends on expansion order — so a heuristic change can leave every
 * path the same length while changing its shape. "The output diff is huge" is
 * therefore not evidence of a regression, and "it's faster" is not evidence of
 * correctness. This measures whether the paths actually got better or worse.
 *
 * Metrics, per unit path (after PathFinder's smooth + densify):
 *   travelled   summed segment length — how far the unit is made to walk
 *   direct      straight-line start→end distance
 *   detour      travelled / direct; 1.0 is a perfect straight line
 *
 * Ground truth: a WC3 unit crossing open terrain walks a straight line, so
 * LOWER detour is closer to the engine. Total travelled distance dropping
 * means units stop taking scenic routes.
 *
 * Usage:
 *   node tools/path-quality.js A.json B.json
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (files.length !== 2) {
  console.log('Usage: node tools/path-quality.js A.json B.json');
  process.exit(1);
}

const load = (f) => {
  let buf = fs.readFileSync(f);
  if (f.endsWith('.gz')) buf = zlib.gunzipSync(buf);
  return JSON.parse(buf.toString('utf8'));
};

const dist = (a, b) => Math.hypot((b.x || 0) - (a.x || 0), (b.y || 0) - (a.y || 0));

// One record per unit path, keyed by unit uuid so the two files line up even
// if unit ordering changed.
const measure = (root) => {
  const out = new Map();
  for (const p of Object.values(root.players || {})) {
    for (const u of p.units || []) {
      const pts = u.path || [];
      if (pts.length < 2) continue;

      // Split into runs: consecutive points form one movement; a large time
      // gap means the unit stopped and later moved again, and the straight
      // line between two separate orders is not a meaningful "direct".
      let travelled = 0;
      let direct = 0;
      let runStart = pts[0];
      for (let i = 1; i < pts.length; i++) {
        const gap = (pts[i].gameTime || 0) - (pts[i - 1].gameTime || 0);
        if (gap > 2000) {
          direct += dist(runStart, pts[i - 1]);
          runStart = pts[i];
          continue;
        }
        travelled += dist(pts[i - 1], pts[i]);
      }
      direct += dist(runStart, pts[pts.length - 1]);

      out.set(u.uuid, { travelled, direct, points: pts.length });
    }
  }
  return out;
};

const sum = (m, k) => [...m.values()].reduce((a, v) => a + v[k], 0);

const main = () => {
  const A = measure(load(files[0]));
  const B = measure(load(files[1]));

  // uuids are a deterministic creation-order sequence, so the same unit gets
  // the same id in both files as long as the parse order is unchanged.
  const shared = [...A.keys()].filter(k => B.has(k));

  const aT = sum(A, 'travelled'), bT = sum(B, 'travelled');
  const aD = sum(A, 'direct'), bD = sum(B, 'direct');
  const aP = sum(A, 'points'), bP = sum(B, 'points');

  const pct = (a, b) => (a === 0 ? 0 : (100 * (b - a) / a));

  console.log(`${path.basename(files[0])}  →  ${path.basename(files[1])}`);
  console.log(`unit paths: A ${A.size}  B ${B.size}  (shared ${shared.length})\n`);

  console.log('                        A            B         change');
  console.log('  ' + '-'.repeat(56));
  console.log(`  travelled   ${(aT / 1000).toFixed(1).padStart(10)}k ${(bT / 1000).toFixed(1).padStart(11)}k ${pct(aT, bT).toFixed(1).padStart(11)}%`);
  console.log(`  direct      ${(aD / 1000).toFixed(1).padStart(10)}k ${(bD / 1000).toFixed(1).padStart(11)}k ${pct(aD, bD).toFixed(1).padStart(11)}%`);
  console.log(`  detour      ${(aT / aD).toFixed(4).padStart(10)}  ${(bT / bD).toFixed(4).padStart(11)}  ${pct(aT / aD, bT / bD).toFixed(1).padStart(11)}%`);
  console.log(`  points      ${String(aP).padStart(10)}  ${String(bP).padStart(11)}  ${pct(aP, bP).toFixed(1).padStart(11)}%`);

  // Per-unit verdict on the shared set — a net average can hide a change that
  // helps some units and hurts others.
  let better = 0, worse = 0, same = 0;
  for (const k of shared) {
    const a = A.get(k), b = B.get(k);
    const d = b.travelled - a.travelled;
    if (Math.abs(d) < 1) same++;
    else if (d < 0) better++;
    else worse++;
  }
  console.log(`\n  per-unit travelled distance:`);
  console.log(`    shorter (better) ${better}`);
  console.log(`    longer  (worse)  ${worse}`);
  console.log(`    unchanged        ${same}`);
};

main();
