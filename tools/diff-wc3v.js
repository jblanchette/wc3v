/**
 * diff-wc3v.js — Structurally compare two parsed .wc3v outputs.
 *
 * For answering "did this parser change alter the output, and where?" — the
 * question every optimisation has to survive. Reports differing leaves grouped
 * by output shape and rolled up by section, so a change that only nudges unit
 * paths is immediately distinguishable from one that moves battle verdicts.
 *
 * Usage:
 *   node tools/diff-wc3v.js A.json B.json
 *   node tools/diff-wc3v.js A.json B.json --top=30 --show-values
 *
 * Accepts plain .json, .wc3v, or gzipped .gz of either.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const args = {};
const files = [];
process.argv.slice(2).forEach(raw => {
  if (raw.startsWith('--')) {
    const [flag, ...rest] = raw.replace(/^--/, '').split('=');
    args[flag] = rest.join('=') || true;
  } else files.push(raw);
});

if (files.length !== 2) {
  console.log('Usage: node tools/diff-wc3v.js A.json B.json [--top=N] [--show-values]');
  process.exit(1);
}

const TOP = parseInt(args.top, 10) || 25;

const load = (f) => {
  let buf = fs.readFileSync(f);
  if (f.endsWith('.gz')) buf = zlib.gunzipSync(buf);
  return JSON.parse(buf.toString('utf8'));
};

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const collectDiffs = (a, b, prefix = '', out = [], depth = 0) => {
  if (depth > 40 || a === b) return out;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
  if (ta !== tb) { out.push(`${prefix} [type ${ta}≠${tb}]`); return out; }

  if (ta === 'array') {
    if (a.length !== b.length) out.push(`${prefix}.length [${a.length}≠${b.length}]`);
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) collectDiffs(a[i], b[i], `${prefix}[${i}]`, out, depth + 1);
    return out;
  }
  if (ta === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) { out.push(`${prefix}.${k} [missing in A]`); continue; }
      if (!(k in b)) { out.push(`${prefix}.${k} [missing in B]`); continue; }
      collectDiffs(a[k], b[k], `${prefix}.${k}`, out, depth + 1);
    }
    return out;
  }
  out.push(`${prefix} [${JSON.stringify(a)}≠${JSON.stringify(b)}]`);
  return out;
};

const shapeOf = (p) => p
  .split(' [')[0]
  .replace(UUID_RE, '<uuid>')
  .replace(/\[\d+\]/g, '[]')
  .replace(/\.\d+(?=\.|$)/g, '.#');

const sectionOf = (s) => (s.match(/^root\.([a-zA-Z]+)/) || [, 'root'])[1];

// Semantic comparison of the build-order event streams.
//
// Index-based diffing is misleading here: insert ONE event near the start and
// every later index shifts, so a single real change reports as hundreds of
// differing values. This compares event streams as multisets instead, which
// is what actually matters for build orders, tier timings and coaching claims.
const compareEvents = (A, B) => {
  const sigOf = (e) => {
    const name = (e.unit && e.unit.displayName) || (e.building && e.building.displayName) ||
                 e.displayName || e.itemId || '';
    return `${e.key}|${name}`;
  };

  console.log('build-order event streams (multiset, index-shift removed)\n');
  let totalAdded = 0, totalRemoved = 0, totalMatched = 0, unpairable = 0;
  const changedSigs = new Map();
  const shifts = [];

  for (const pid of Object.keys(A.players || {})) {
    const ea = (A.players[pid] || {}).eventStream || [];
    const eb = ((B.players || {})[pid] || {}).eventStream || [];
    if (!ea.length && !eb.length) continue;

    const bucket = (list) => {
      const m = new Map();
      list.forEach(e => {
        const s = sigOf(e);
        if (!m.has(s)) m.set(s, []);
        m.get(s).push(e.gameTime || 0);
      });
      for (const times of m.values()) times.sort((x, y) => x - y);
      return m;
    };

    const ba = bucket(ea), bb = bucket(eb);
    let added = 0, removed = 0, matched = 0;

    for (const s of new Set([...ba.keys(), ...bb.keys()])) {
      const ta = ba.get(s) || [], tb = bb.get(s) || [];
      const n = Math.min(ta.length, tb.length);
      matched += n;

      // Only measure timing drift where the bucket has the SAME count in both.
      // If an event was added or removed, pairing the i-th occurrence to the
      // i-th is misaligned from that point on and manufactures huge fake
      // shifts — which is exactly the artifact this whole mode exists to avoid.
      if (ta.length === tb.length) {
        for (let i = 0; i < n; i++) {
          const d = tb[i] - ta[i];
          if (d !== 0) shifts.push(Math.abs(d));
        }
      } else {
        unpairable += n;
      }

      if (tb.length !== ta.length) {
        const d = tb.length - ta.length;
        changedSigs.set(s, (changedSigs.get(s) || 0) + d);
      }
      if (tb.length > ta.length) added += tb.length - ta.length;
      if (ta.length > tb.length) removed += ta.length - tb.length;
    }

    totalAdded += added; totalRemoved += removed; totalMatched += matched;
    const flag = (added || removed) ? '  <-- differs' : '';
    console.log(`  player ${pid.padStart(4)}  events ${String(ea.length).padStart(4)} → ${String(eb.length).padStart(4)}` +
                `   matched ${String(matched).padStart(4)}  added ${added}  removed ${removed}${flag}`);
  }

  const pct = totalMatched ? (100 * (totalAdded + totalRemoved) / (totalMatched + totalAdded + totalRemoved)) : 0;
  console.log(`\n  matched ${totalMatched}   added ${totalAdded}   removed ${totalRemoved}   ` +
              `(${pct.toFixed(2)}% of events differ)`);

  const pairable = totalMatched - unpairable;
  console.log(`  cleanly pairable events: ${pairable} of ${totalMatched} ` +
              `(${unpairable} sit in buckets whose count changed, so their timing is not comparable)`);

  if (shifts.length) {
    shifts.sort((a, b) => a - b);
    const med = shifts[shifts.length >> 1];
    const p95 = shifts[Math.floor(shifts.length * 0.95)];
    console.log(`  of those, timing moved on ${shifts.length} ` +
                `(${(100 * shifts.length / Math.max(1, pairable)).toFixed(2)}%)` +
                `   median ${med} ms   p95 ${p95} ms   max ${shifts[shifts.length - 1]} ms`);
  } else {
    console.log(`  of those, EVERY event kept its exact timing.`);
  }

  if (changedSigs.size) {
    console.log('\n  event types whose COUNT changed (+added / -removed):');
    [...changedSigs.entries()]
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 20)
      .forEach(([sig, d]) => console.log(`    ${d > 0 ? '+' : ''}${d}  ${sig}`));
  }
};

const main = () => {
  const A = load(files[0]);
  const B = load(files[1]);

  if (args.events) return compareEvents(A, B);

  const diffs = collectDiffs(A, B, 'root');
  if (!diffs.length) {
    console.log('IDENTICAL — no differing values.');
    return;
  }

  const counts = new Map();
  const sample = new Map();
  for (const d of diffs) {
    const s = shapeOf(d);
    counts.set(s, (counts.get(s) || 0) + 1);
    if (!sample.has(s)) sample.set(s, d);
  }

  const bySection = new Map();
  for (const [s, n] of counts) {
    const sec = sectionOf(s);
    bySection.set(sec, (bySection.get(sec) || 0) + n);
  }

  console.log(`${path.basename(files[0])}  vs  ${path.basename(files[1])}`);
  console.log(`differing leaves: ${diffs.length}   distinct shapes: ${counts.size}\n`);

  console.log('by section:');
  [...bySection.entries()].sort((a, b) => b[1] - a[1])
    .forEach(([sec, n]) => console.log(`  ${String(n).padStart(8)}  ${sec}`));
  console.log('');

  console.log('shapes:');
  [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP)
    .forEach(([s, n]) => {
      console.log(`  ${String(n).padStart(8)}×  ${s}`);
      if (args['show-values']) console.log(`             ${sample.get(s).slice(0, 180)}`);
    });
  if (counts.size > TOP) console.log(`  … and ${counts.size - TOP} more shapes`);
};

main();
