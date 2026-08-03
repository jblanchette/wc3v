/**
 * build-desktop-client.js — assemble desktop/dist for the Tauri app.
 *
 * The desktop frontend is the hand-written shell in desktop/src-frontend plus
 * the committed parser bundle from client/js/vendor. Nothing is downloaded and
 * nothing is transpiled — the same "no build tools" rule the web client
 * follows applies here.
 *
 * desktop/dist is generated and gitignored. Re-run after changing either
 * desktop/src-frontend or the parser bundle.
 *
 * Usage:
 *   node tools/build-desktop-client.js
 *   node tools/build-desktop-client.js --seed-maps=EchoIsles22,TurtleRock20
 *   node tools/build-desktop-client.js --seed-maps=all
 *
 * Options:
 *   --seed-maps=LIST  Copy per-map parse data into the local map cache so the
 *                     app works offline. Comma-separated map folder names as
 *                     found in client/maps/, or `all`. Only the three files
 *                     the parser needs are copied (wpm/doo/unit), never the
 *                     multi-megabyte terrain.jpg used by the 3D renderer.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'desktop', 'src-frontend');
const DIST = path.join(ROOT, 'desktop', 'dist');
const BUNDLE = path.join(ROOT, 'client', 'js', 'vendor', 'wc3v-parser.bundle.js');
// Dual-runtime (no DOM, no fs) per-player summary extractor. The desktop app
// persists one summary per parsed game; shipping the client's copy keeps it a
// single source of truth, same as the parser bundle.
const SUMMARY_EXTRACT = path.join(ROOT, 'client', 'js', 'SummaryExtract.js');
const MAPS = path.join(ROOT, 'client', 'maps');

// Only these are needed to PARSE a replay. terrain.jpg / heights.bin.gz /
// gridmap.jpg belong to the 3D renderer, which the desktop app does not ship.
const PARSE_FILES = ['wpm.json.gz', 'doo.json.gz', 'unit.json.gz'];

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
};

// Where the running app keeps its map cache. Must match app_data_dir() +
// "maps" in desktop/src-tauri/src/main.rs, or a seeded cache is invisible to
// the app. Identifier is com.wc3v.desktop.
const appMapCacheDir = () => {
  const id = 'com.wc3v.desktop';
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), id, 'maps');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', id, 'maps');
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), id, 'maps');
};

const seedMaps = (list) => {
  if (!fs.existsSync(MAPS)) {
    console.log('client/maps not present — skipping map seed');
    return;
  }
  const available = fs.readdirSync(MAPS).filter(n =>
    fs.statSync(path.join(MAPS, n)).isDirectory());

  const wanted = list === 'all' || list === true
    ? available
    : String(list).split(',').map(s => s.trim()).filter(Boolean);

  const target = appMapCacheDir();
  fs.mkdirSync(target, { recursive: true });

  let copied = 0, bytes = 0, missing = [];
  for (const name of wanted) {
    const from = path.join(MAPS, name);
    if (!available.includes(name)) { missing.push(name); continue; }
    const to = path.join(target, name);
    fs.mkdirSync(to, { recursive: true });
    for (const f of PARSE_FILES) {
      const src = path.join(from, f);
      if (!fs.existsSync(src)) continue;
      fs.copyFileSync(src, path.join(to, f));
      bytes += fs.statSync(src).size;
    }
    copied++;
  }

  console.log(`map cache: ${copied} maps → ${target}`);
  console.log(`           ${(bytes / 1024 / 1024).toFixed(1)} MB (parse data only)`);
  if (missing.length) {
    console.log(`           not found in client/maps: ${missing.join(', ')}`);
  }
};

const main = () => {
  if (!fs.existsSync(BUNDLE)) {
    console.error('Parser bundle missing. Run: npm run build:parser');
    process.exit(1);
  }

  fs.rmSync(DIST, { recursive: true, force: true });
  copyDir(SRC, DIST);

  const vendorDir = path.join(DIST, 'js', 'vendor');
  fs.mkdirSync(vendorDir, { recursive: true });
  fs.copyFileSync(BUNDLE, path.join(vendorDir, 'wc3v-parser.bundle.js'));
  fs.copyFileSync(SUMMARY_EXTRACT, path.join(vendorDir, 'SummaryExtract.js'));

  const size = fs.statSync(path.join(vendorDir, 'wc3v-parser.bundle.js')).size;
  console.log(`dist:      ${path.relative(ROOT, DIST)}`);
  console.log(`parser:    ${(size / 1024).toFixed(0)} KB`);
  console.log(`summary:   SummaryExtract.js (${(fs.statSync(SUMMARY_EXTRACT).size / 1024).toFixed(0)} KB)`);

  if (args['seed-maps']) seedMaps(args['seed-maps']);
  else console.log('map cache: not seeded (pass --seed-maps=all or a comma list)');
};

main();
