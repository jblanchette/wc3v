/**
 * verify-bundle-parity.js — Prove the browser parser bundle produces the same
 * output as the Node parser source.
 *
 * Why this exists: the desktop app (and the site's upload path) parse replays
 * with client/js/vendor/wc3v-parser.bundle.js, an esbuild of lib/ + helpers/ +
 * wc3v.js with fs/os/zlib shims. If that bundle ever drifts from the source it
 * was built from, uploaded replays silently disagree with server-parsed ones.
 * This is the gate that catches it.
 *
 * The parser has small known non-determinism (pathfinding / camp claim). A raw
 * node-vs-bundle diff would therefore report noise. So we run the NODE path
 * TWICE first to establish a baseline of self-disagreement, then compare the
 * bundle against it. Parity holds when the bundle's differences are a subset of
 * that baseline.
 *
 * Usage:
 *   node tools/verify-bundle-parity.js --replay=NAME
 *   node tools/verify-bundle-parity.js --replay=NAME --verbose
 *
 * Options:
 *   --replay=NAME   Replay basename in replays/ (with or without .w3g)
 *   --verbose       Print every differing path, not just the summary
 *   --limit=N       Max differing paths to print (default 40)
 *
 * Exit code 0 = parity holds, 1 = bundle drift detected.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

if (!args.replay) {
  console.log('Usage: node tools/verify-bundle-parity.js --replay=NAME [--verbose] [--limit=N]');
  process.exit(1);
}

const PRINT_LIMIT = parseInt(args.limit, 10) || 40;

// ── Locate the replay ───────────────────────────────────────────────────────

const resolveReplayPath = (name) => {
  const base = name.endsWith('.w3g') ? name : `${name}.w3g`;
  const candidates = [
    path.resolve(ROOT, 'replays', base),
    path.resolve(ROOT, base),
    path.resolve(base)
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
};

const replayPath = resolveReplayPath(args.replay);
if (!replayPath) {
  console.error(`Replay not found: ${args.replay} (looked in replays/)`);
  process.exit(1);
}

// ── Disk-backed map data loader ─────────────────────────────────────────────
// Mirrors client/js/parser/browserMapLoader.js but reads client/maps/ off disk
// instead of fetching. This is the same shape the desktop app will inject.

const MAPS_ROOT = path.resolve(ROOT, 'client', 'maps');

const readGzJson = (file) => {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
  } catch (e) {
    return null;
  }
};

const readPlainJson = (file) => {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
};

const loadMapCache = (mapDataName) => {
  const base = path.join(MAPS_ROOT, mapDataName);
  const wpm = readGzJson(path.join(base, 'wpm.json.gz')) || readPlainJson(path.join(base, 'wpm.json'));
  const doo = readGzJson(path.join(base, 'doo.json.gz')) || readPlainJson(path.join(base, 'doo.json'));
  const unit = readGzJson(path.join(base, 'unit.json.gz')) || readPlainJson(path.join(base, 'unit.json'));
  if (!wpm || !doo) return null;
  return { wpm, doo, unit: unit || { units: [] } };
};

const diskMapDataLoader = {
  async fetchCache (mapDataName) {
    return loadMapCache(mapDataName);
  }
};

// ── Path A: parse via the Node source ───────────────────────────────────────

const parseViaNode = async (buffer) => {
  // Match the bundle's environment exactly. client/js/parser/shims.js installs
  // a no-op console.logger because the browser never runs the CLI's
  // logManager.setLogger()/init() path. Do the same here, or the comparison
  // measures logging setup rather than parser output.
  if (typeof console.logger !== 'function') console.logger = () => {};

  // Require lazily and fresh each call so module-level parser state (loggers,
  // pathfinder caches) does not leak between the two baseline runs.
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(path.join(ROOT, 'lib')) ||
        k.startsWith(path.join(ROOT, 'helpers')) ||
        k === path.join(ROOT, 'wc3v.js')) {
      delete require.cache[k];
    }
  }
  const wc3v = require(path.join(ROOT, 'wc3v.js'));
  const utils = require(path.join(ROOT, 'helpers', 'utils.js'));
  const { mapDataByFile } = require(path.join(ROOT, 'helpers', 'mappings.js'));

  const mapDataName = await resolveMapName(buffer, mapDataByFile);
  const cache = loadMapCache(mapDataName);
  if (!cache) throw new Error(`Map cache missing for ${mapDataName}`);

  const r = await wc3v.doParsing(buffer, {
    mapDataCache: { [mapDataName]: cache },
    skipTerrainRead: true,
    // --fast exercises the profile-only path (straight lines instead of A*).
    // Not used for parity runs; this harness doubles as the "parse once and
    // dump JSON" tool for benchmarking and diffing.
    skipPathfinding: !!args.fast
  });
  return utils.buildOutputObject(r.replay, r.players, r.world, r.validation);
};

// Peek the map name the same way parserEntry.resolveMapDataName does, so both
// paths select an identical map cache.
const resolveMapName = async (buffer, mapDataByFile) => {
  const ReplayParser = require(path.join(ROOT, 'node_modules', 'w3gjs', 'dist', 'lib', 'parsers', 'ReplayParser')).default;
  const DONE = Symbol('done');
  const peeker = new ReplayParser();
  let info = null;
  peeker.on('basic_replay_information', (i) => { info = i; throw DONE; });
  try { await peeker.parse(buffer); } catch (e) { if (e !== DONE) throw e; }

  if (!info || !info.metadata || !info.metadata.map) {
    throw new Error('Replay header missing map data');
  }
  let mapName = info.metadata.map.mapName.split('\\').join('/');
  mapName = path.basename(mapName).toLowerCase().trim().replace(/ /g, '');
  const stripped = (mapName.match(/^\d+_w3c_\d+_\d+_(.+)$/) || [])[1] || mapName;

  if (mapDataByFile[mapName]) return mapDataByFile[mapName].name;
  for (const key of Object.keys(mapDataByFile)) {
    const search = mapDataByFile[key].name.toLowerCase();
    if (mapName.indexOf(search) !== -1) return mapDataByFile[key].name;
    if (stripped !== mapName && stripped.indexOf(search) !== -1) return mapDataByFile[key].name;
    const baseSearch = search.replace(/[_-]v[\d._-]+$/, '');
    const baseMap = stripped.replace('.w3x', '').replace(/[_-]v[\d._-]+$/, '');
    if (baseSearch.length > 3 && baseMap === baseSearch) return mapDataByFile[key].name;
  }
  throw new Error(`Map not in library: ${info.metadata.map.mapName}`);
};

// ── Path B: parse via the committed browser bundle ──────────────────────────

const parseViaBundle = async (buffer) => {
  const bundlePath = path.resolve(ROOT, 'client', 'js', 'vendor', 'wc3v-parser.bundle.js');
  if (!fs.existsSync(bundlePath)) {
    throw new Error('Parser bundle not built. Run: npm run build:parser');
  }
  const code = fs.readFileSync(bundlePath, 'utf8');
  // The bundle is an IIFE assigning `var Wc3vParser`, then a trailing window
  // attach line. Evaluate it in a function scope and hand back the global.
  const factory = new Function(`${code}\n;return Wc3vParser;`);
  const parser = factory();
  if (!parser || typeof parser.parseToWc3v !== 'function') {
    throw new Error('Bundle did not expose parseToWc3v');
  }
  return parser.parseToWc3v(buffer, {
    mapDataLoader: diskMapDataLoader,
    // Mirror the Node side: with --fast BOTH parsers run profile mode, so a
    // fast-parity run proves the bundle actually forwards skipPathfinding
    // (it used to drop unknown options silently — a fast node vs a slow
    // bundle would light up every unit path).
    skipPathfinding: !!args.fast
  });
};

// ── Structural diff ─────────────────────────────────────────────────────────

// Collect dotted paths whose leaf values differ. Numbers compared exactly —
// the point is to detect drift, not to be lenient about it.
const collectDiffs = (a, b, prefix = '', out = [], depth = 0) => {
  if (depth > 40) return out;
  if (a === b) return out;

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
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (!(k in a)) { out.push(`${prefix}.${k} [missing in A]`); continue; }
      if (!(k in b)) { out.push(`${prefix}.${k} [missing in B]`); continue; }
      collectDiffs(a[k], b[k], `${prefix}.${k}`, out, depth + 1);
    }
    return out;
  }

  out.push(`${prefix} [${JSON.stringify(a)}≠${JSON.stringify(b)}]`);
  return out;
};

// Reduce a concrete path to a shape key so incidental key noise groups
// together:
//   players.1.units[37].x                → players.#.units[].x
//   world.neutralGroups.ef7238ea-…-df85  → world.neutralGroups.<uuid>
//
// The UUID collapse matters: neutral-group ids are generated fresh on every
// parse, so without it each run's ids look like distinct shapes and every
// group is falsely reported as bundle-only drift.
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const shapeOf = (p) => p
  .split(' [')[0]
  .replace(UUID_RE, '<uuid>')
  .replace(/\[\d+\]/g, '[]')
  .replace(/\.\d+(?=\.|$)/g, '.#');

// ── Main ────────────────────────────────────────────────────────────────────

// Each parse runs in its OWN child process and writes its result to a temp
// file. This is not optional rigour: the parser keeps module-level state
// (pathfinder caches, loggers, claim registries), so two parses in one
// process contaminate each other and inflate the "non-determinism" baseline
// to the point where real drift is invisible.
const parseInChild = (mode, outFile) => {
  execFileSync(
    process.execPath,
    [__filename, `--replay=${args.replay}`, `--_worker=${mode}`, `--_out=${outFile}`],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 1 << 28 }
  );
  return JSON.parse(fs.readFileSync(outFile, 'utf8'));
};

// Worker mode: parse once, serialise, exit. Never diffs.
if (args._worker) {
  (async () => {
    const buffer = fs.readFileSync(replayPath);
    const out = args._worker === 'bundle'
      ? await parseViaBundle(buffer)
      : await parseViaNode(buffer);
    fs.writeFileSync(args._out, JSON.stringify(out));
  })().catch(e => {
    process.stderr.write(`worker(${args._worker}) failed: ${e.stack || e.message}\n`);
    process.exit(1);
  });
  return;
}

const main = async () => {
  const buffer = fs.readFileSync(replayPath);
  console.log(`Replay:  ${path.relative(ROOT, replayPath)}  (${(buffer.length / 1024).toFixed(0)} KB)\n`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wc3v-parity-'));

  // Sample the Node path several times. Some replays are heavily
  // non-deterministic (hundreds of varying output shapes), and two samples
  // cannot enumerate that set — unsampled shapes then masquerade as bundle
  // drift. Union the shapes across every baseline pair instead.
  const N = Math.max(2, parseInt(args.baseline, 10) || 3);
  const nodeRuns = [];
  for (let i = 0; i < N; i++) {
    console.log(`Run ${i + 1}/${N + 1}  node source (baseline ${i + 1})...`);
    nodeRuns.push(parseInChild('node', path.join(tmp, `a${i}.json`)));
  }
  console.log(`Run ${N + 1}/${N + 1}  browser bundle...`);
  const b = parseInChild('bundle', path.join(tmp, 'b.json'));

  const baselineShapes = new Set();
  let baselineLeafMax = 0;
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const d = collectDiffs(nodeRuns[i], nodeRuns[j], 'root');
      baselineLeafMax = Math.max(baselineLeafMax, d.length);
      d.forEach(x => baselineShapes.add(shapeOf(x)));
    }
  }

  // Compare the bundle against every baseline sample and keep only shapes
  // that drift against ALL of them — a shape matching any Node run is, by
  // definition, within the Node path's own range of outputs.
  const perRun = nodeRuns.map(a => new Set(collectDiffs(a, b, 'root').map(shapeOf)));
  const bundleShapes = [...perRun.reduce((acc, s) => {
    return new Set([...acc].filter(x => s.has(x)));
  })];
  const bundle = collectDiffs(nodeRuns[0], b, 'root');
  const baseline = { length: baselineLeafMax };
  let novel = bundleShapes.filter(s => !baselineShapes.has(s));

  // Known platform difference, not bundle drift. PlayerManager.setMetaData
  // rewrites the map path's backslashes to forward slashes only when
  // path.sep === '/'. The bundle uses path-browserify, whose sep is always
  // '/', so it always rewrites — matching Node on Linux, which is what
  // production runs. Only a Windows Node baseline disagrees, so this is
  // expected here and nowhere else.
  if (path.sep === '\\') {
    const before = novel.length;
    novel = novel.filter(s => s !== 'root.replay.metadata.map.mapName');
    if (novel.length !== before) {
      console.log('Ignoring 1 known Windows-only platform difference:');
      console.log('  root.replay.metadata.map.mapName — path separator');
      console.log('  (bundle matches Node-on-Linux, i.e. production)\n');
    }
  }

  console.log('\n─────────────────────────────────────────────');
  console.log(`node vs node  (non-determinism baseline, ${N} runs): worst pair ${baseline.length} leaves, ${baselineShapes.size} shapes`);
  console.log(`node vs bundle                                    : ${bundle.length} leaves, ${bundleShapes.length} shapes drifting vs ALL runs`);
  console.log(`shapes unique to the bundle                       : ${novel.length}`);
  console.log('─────────────────────────────────────────────\n');

  if (args.verbose && baseline.length) {
    console.log('Baseline (known non-deterministic) shapes:');
    [...baselineShapes].slice(0, PRINT_LIMIT).forEach(s => console.log(`  ~ ${s}`));
    console.log('');
  }

  if (novel.length === 0) {
    console.log('PARITY HOLDS — the bundle differs from the Node source only in');
    console.log('places the Node source already disagrees with itself.');
    process.exit(0);
  }

  console.log('BUNDLE DRIFT — these output shapes differ only in the bundle:');
  const novelSet = new Set(novel);
  const samples = new Map();
  for (const d of bundle) {
    const s = shapeOf(d);
    if (novelSet.has(s) && !samples.has(s)) samples.set(s, d);
  }
  novel.slice(0, PRINT_LIMIT).forEach(s => {
    console.log(`  ! ${s}`);
    const ex = samples.get(s);
    if (ex && ex !== s) console.log(`      A→B  ${ex.slice(0, 220)}`);
  });
  if (novel.length > PRINT_LIMIT) console.log(`  ... and ${novel.length - PRINT_LIMIT} more`);
  console.log('\nLikely cause: the committed bundle is stale. Run: npm run build:parser');
  process.exit(1);
};

main().catch(e => {
  console.error(`\nFAILED: ${e.message}`);
  if (args.verbose) console.error(e.stack);
  process.exit(1);
});
