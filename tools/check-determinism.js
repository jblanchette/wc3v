/**
 * check-determinism.js — Measure how much of the parser's output is unstable
 * across identical runs.
 *
 * Parsing the same replay twice does not produce the same .wc3v. Some of that
 * is harmless: every Unit / EventTimer / NeutralGroup / SubGroup gets a random
 * uuidv4 (helpers/utils.js), and those ids are exported. That churn is
 * cosmetic — the ids are internal handles.
 *
 * The rest is not cosmetic. This tool separates the two so the real scale is
 * visible: it normalises every uuid-shaped value (and the paths keyed by one)
 * to a placeholder, then reports which output shapes still vary.
 *
 * Usage:
 *   node tools/check-determinism.js --replay=NAME [--runs=3] [--limit=40]
 *   node tools/check-determinism.js --replay=NAME --show-values
 *
 * Options:
 *   --replay=NAME    Replay basename in replays/
 *   --runs=N         Parses to compare (default 3)
 *   --limit=N        Max varying shapes to list (default 40)
 *   --show-values    Print an example differing value per shape
 *
 * Reuses the worker mode of tools/verify-bundle-parity.js to do each parse in
 * a clean child process — module-level parser state makes in-process repeats
 * meaningless.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PARITY_TOOL = path.join(__dirname, 'verify-bundle-parity.js');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

if (!args.replay) {
  console.log('Usage: node tools/check-determinism.js --replay=NAME [--runs=N] [--show-values]');
  process.exit(1);
}

const RUNS = Math.max(2, parseInt(args.runs, 10) || 3);
const LIMIT = parseInt(args.limit, 10) || 40;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// Replace uuid VALUES with a constant so id churn stops registering as a
// difference. Object keys that are uuids are also collapsed, which merges
// sibling entries — acceptable here because we only count varying shapes.
const normalise = (v) => {
  if (Array.isArray(v)) return v.map(normalise);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) {
      out[isUuid(k) ? '<uuid>' : k] = normalise(v[k]);
    }
    return out;
  }
  if (isUuid(v)) return '<uuid>';
  return v;
};

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

// Which top-level section a shape belongs to, for the rollup.
const sectionOf = (shape) => {
  const m = shape.match(/^root\.([a-zA-Z]+)/);
  return m ? m[1] : 'root';
};

const main = () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wc3v-determinism-'));
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    process.stdout.write(`parse ${i + 1}/${RUNS}... `);
    const out = path.join(tmp, `r${i}.json`);
    execFileSync(process.execPath,
      [PARITY_TOOL, `--replay=${args.replay}`, '--_worker=node', `--_out=${out}`],
      { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 1 << 28 });
    runs.push(JSON.parse(fs.readFileSync(out, 'utf8')));
    process.stdout.write('ok\n');
  }
  console.log('');

  // Raw (uuid churn included) vs normalised (uuid churn removed).
  const rawPairs = [];
  const normPairs = [];
  const normed = runs.map(normalise);
  for (let i = 0; i < RUNS; i++) {
    for (let j = i + 1; j < RUNS; j++) {
      rawPairs.push(collectDiffs(runs[i], runs[j], 'root'));
      normPairs.push(collectDiffs(normed[i], normed[j], 'root'));
    }
  }

  const rawLeaves = Math.max(...rawPairs.map(d => d.length));
  const normLeaves = Math.max(...normPairs.map(d => d.length));

  const shapeCounts = new Map();
  const sample = new Map();
  for (const d of normPairs) {
    for (const entry of d) {
      const s = shapeOf(entry);
      shapeCounts.set(s, (shapeCounts.get(s) || 0) + 1);
      if (!sample.has(s)) sample.set(s, entry);
    }
  }

  console.log('═════════════════════════════════════════════════════');
  console.log(`Replay: ${args.replay}   (${RUNS} parses, ${rawPairs.length} pairs)`);
  console.log('═════════════════════════════════════════════════════');
  console.log(`differing leaves, raw                : ${rawLeaves}`);
  console.log(`differing leaves, uuid churn removed : ${normLeaves}`);
  const cosmetic = rawLeaves ? (100 * (rawLeaves - normLeaves) / rawLeaves) : 0;
  console.log(`  → ${cosmetic.toFixed(1)}% of raw diff is cosmetic uuid churn`);
  console.log(`genuinely varying shapes             : ${shapeCounts.size}`);
  console.log('');

  if (shapeCounts.size === 0) {
    console.log('DETERMINISTIC once uuids are ignored.');
    return;
  }

  // Rollup by top-level section, so it's obvious what to go fix.
  const bySection = new Map();
  for (const s of shapeCounts.keys()) {
    const sec = sectionOf(s);
    bySection.set(sec, (bySection.get(sec) || 0) + 1);
  }
  console.log('Varying shapes by section:');
  [...bySection.entries()].sort((a, b) => b[1] - a[1])
    .forEach(([sec, n]) => console.log(`  ${String(n).padStart(4)}  ${sec}`));
  console.log('');

  console.log('Varying shapes (most frequently differing first):');
  [...shapeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, LIMIT)
    .forEach(([s, n]) => {
      console.log(`  ${String(n).padStart(3)}×  ${s}`);
      if (args['show-values']) {
        const ex = sample.get(s);
        if (ex) console.log(`         e.g. ${ex.slice(0, 200)}`);
      }
    });
  if (shapeCounts.size > LIMIT) console.log(`  ... and ${shapeCounts.size - LIMIT} more`);
};

main();
