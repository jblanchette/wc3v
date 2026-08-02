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

const main = () => {
  const A = load(files[0]);
  const B = load(files[1]);

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
