// Smoke-test the browser parser bundle against the Node parser. Runs the
// bundle in a minimal browser-shim Node context, parses a known replay, and
// compares output against the canonical client/replays/{id}.wc3v.gz.
//
// Usage: node tools/test-parser-bundle.js [replayName]

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const REPLAY = process.argv[2] || '1342775468_Kaho_Happy_Hammerfall';

const BUNDLE = path.resolve(ROOT, 'client/js/vendor/wc3v-parser.bundle.js');
const REPLAY_W3G = path.resolve(ROOT, 'replays', `${REPLAY}.w3g`);
const REPLAY_WC3V = path.resolve(ROOT, 'client/replays', `${REPLAY}.wc3v.gz`);
const MAPS_ROOT = path.resolve(ROOT, 'client/maps');

if (!fs.existsSync(BUNDLE)) {
  console.error('Bundle not found. Run `npm run build:parser` first.');
  process.exit(1);
}

// Build a minimal "window/browser" sandbox to load the bundle into. The
// bundle expects fetch + window globals.
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  queueMicrotask,
  TextEncoder,
  TextDecoder,
  Uint8Array,
  Buffer, // hand-off so internal Buffer.from(arrayBuffer) works
  globalThis: null,
  window: {}
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

// Emulate fetch by reading from the local filesystem under MAPS_ROOT. The
// real loader now fetches /maps/...; old/client/maps/... path also handled
// for backward-compat with older bundles.
sandbox.fetch = async (url) => {
  const m = url.match(/^\/(?:client\/)?maps\/([^/]+)\/(wpm|doo|unit)\.json(\.gz)?$/);
  if (!m) return { ok: false, status: 404, json: async () => null, arrayBuffer: async () => new ArrayBuffer(0) };
  const dir = decodeURIComponent(m[1]);
  const which = m[2];
  const wantGz = !!m[3];

  const tryFiles = wantGz ? [`${which}.json.gz`, `${which}.json`] : [`${which}.json`, `${which}.json.gz`];

  for (const fname of tryFiles) {
    const fpath = path.join(MAPS_ROOT, dir, fname);
    if (!fs.existsSync(fpath)) continue;
    const buf = fs.readFileSync(fpath);
    // Serve gzipped bytes verbatim when the URL asked for .gz; the loader
    // will inflate via pako. Plain .json paths get the decompressed bytes.
    const out = (fname.endsWith('.gz') && wantGz) ? buf
      : (fname.endsWith('.gz') ? zlib.gunzipSync(buf) : buf);
    const ab = out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => ab,
      json: async () => JSON.parse(out.toString('utf8'))
    };
  }
  return { ok: false, status: 404, json: async () => null, arrayBuffer: async () => new ArrayBuffer(0) };
};

const bundleSrc = fs.readFileSync(BUNDLE, 'utf8');
vm.createContext(sandbox);
vm.runInContext(bundleSrc, sandbox);

const Wc3vParser = sandbox.window.Wc3vParser || sandbox.Wc3vParser;
if (!Wc3vParser || typeof Wc3vParser.parseToWc3v !== 'function') {
  console.error('Wc3vParser not exposed by bundle');
  console.error('sandbox.window keys:', Object.keys(sandbox.window));
  console.error('sandbox keys with Wc3v:', Object.keys(sandbox).filter(k => k.toLowerCase().includes('wc3v')));
  process.exit(1);
}

const main = async () => {
  console.log(`Parsing ${REPLAY}.w3g via the bundle...`);
  const t0 = Date.now();
  const buffer = fs.readFileSync(REPLAY_W3G);
  const parsed = await Wc3vParser.parseToWc3v(buffer);
  const t1 = Date.now();
  console.log(`Bundle parse: ${t1 - t0}ms`);

  // Compare against the canonical Node-parsed output (UUID-stripped).
  if (!fs.existsSync(REPLAY_WC3V)) {
    console.warn('No canonical .wc3v.gz to compare against. Bundle parse succeeded.');
    return;
  }
  const canonical = JSON.parse(zlib.gunzipSync(fs.readFileSync(REPLAY_WC3V)).toString('utf8'));

  // Browser mode skips the W3E tileset read by design (see doParsing's
  // skipTerrainRead option). That makes baseGrid colors fall back to the
  // default palette. Strip those four fields before comparison.
  const stripVolatile = (o) => JSON.stringify(o)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID')
    .replace(/"(ground|cliff|water|shallowWater|tree)Color":"[^"]*"/g, '"$1Color":"X"')
    .replace(/"treeStroke":"[^"]*"/g, '"treeStroke":"X"')
    // Path-separator normalization differs by platform (Windows CLI keeps
    // backslashes; browser uses path-browserify which forces "/"). Both are
    // valid; collapse to compare semantics.
    .replace(/\\\\/g, '/');
  const a = stripVolatile(canonical);
  const b = stripVolatile(parsed);

  console.log(`Canonical length: ${a.length}`);
  console.log(`Bundle length:    ${b.length}`);
  console.log(`Identical:        ${a === b}`);
  if (a !== b) {
    // Find first diff to help debugging
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    console.log(`First diff at offset ${i}:`);
    console.log(`  canonical: ${JSON.stringify(a.slice(Math.max(0, i - 40), i + 60))}`);
    console.log(`  bundle:    ${JSON.stringify(b.slice(Math.max(0, i - 40), i + 60))}`);
    process.exit(1);
  }
  console.log('OK: browser bundle output matches Node CLI output (UUID-stripped).');
};

main().catch(e => {
  console.error('Test failed:', e.message);
  console.error(e.stack);
  process.exit(1);
});
