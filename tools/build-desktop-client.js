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
 *   node tools/build-desktop-client.js --bundle-maps=ladder
 *   node tools/build-desktop-client.js --seed-maps=EchoIsles22,TurtleRock20
 *
 * Options:
 *   --bundle-maps=SET  Stage per-map parse data into desktop/src-tauri/resources
 *                      so the INSTALLER carries it and a freshly installed app
 *                      parses those maps with no extra steps. `ladder` (the
 *                      competitive 1v1 pool, ~25 MB), `all` (318 MB — too big
 *                      for a real installer), or a comma-separated list.
 *   --seed-maps=LIST   Dev convenience: copy straight into THIS machine's app
 *                      data cache instead. Same value forms as above.
 *
 * Only the three files the parser needs are copied (wpm/doo/unit), never the
 * multi-megabyte terrain.jpg used by the 3D renderer.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'desktop', 'src-frontend');
const DIST = path.join(ROOT, 'desktop', 'dist');
const BUNDLE = path.join(ROOT, 'client', 'js', 'vendor', 'wc3v-parser.bundle.js');
// Dual-runtime (no DOM, no fs) shared modules. The desktop app persists one
// summary per parsed game and aggregates them into profiles; shipping the
// client's copies keeps a single source of truth, same as the parser bundle.
// Load order matters in the browser (index.html loads them in this order).
// SummaryExtract and MomentsExtract have no dependency on each other, on
// purpose, so neither can break the other. The two that DO have dependencies
// resolve them lazily per call rather than at load, so a wrong tag order fails
// loudly on first use instead of baking a null in at parse time.
const SHARED_JS = [
  'SummaryExtract.js',
  'MomentsExtract.js',
  // Packs the dominance and resource time series into a stored summary, and
  // unpacks them back into the shape the viewer widget below expects.
  'SeriesExtract.js',
  // The viewer's own build-order derivation: production, per-tier production
  // and the closing snapshot (supply, workers, gold and lumber spent, upgrades,
  // every unit made with its count and its attack/armor types).
  //
  // Shipped as of schema v5 because the desktop's game report IS the viewer's
  // Match Summary screen, and the alternative was a second extractor inside
  // SummaryExtract reimplementing the grouping and the cost accumulation. That
  // is two implementations of "what did this player build", and two answers the
  // first time either one is edited. Same mount-seam rule as DominanceChart
  // below, applied to data instead of to drawing.
  //
  // SummaryBuild calls it at parse time and stores the result; nothing in the
  // desktop re-derives it. It reaches for three viewer globals (window.wc3v,
  // PlayerNames, RaceLabels) and every one of them is guarded, so it runs
  // headless here and in Node.
  'BuildOrderData.js',
  // The stored-summary shape and SCHEMA_VERSION, calling the extractors above.
  // This was two hand-copied duplicates, one in the app's store.js and one in
  // tools/desktop-preview.js, which is two schemas wearing one version number.
  // Loads after all of them.
  'SummaryBuild.js',
  // One stored summary and one seat, as scalars: dominance, hero kills, APM and
  // the timings. Everything that used to derive its own numbers at the point of
  // use reads this instead, which is why "workers at 5:00" no longer has three
  // implementations. ProfileAggregate depends on it, so it loads first.
  'GameMetrics.js',
  'ProfileAggregate.js',
  // Pure SVG-string chart factories (no DOM) — the desktop's economy/army
  // charts are the same code the site's compare modal draws with.
  'CompareCharts.js',
  // The viewer's OWN dominance chart, not a lookalike. Mounted from data rather
  // than from a viewer: it takes a setPlayers() array and ignores the
  // constructor argument, so the desktop passes null.
  //
  // Two siblings are deliberately NOT here.
  //
  // `DominanceBar.js`: the tug-of-war gauge was in the report frame for one
  // revision and was cut. 58px of chrome with its own chassis and impact-FX
  // engine, designed for a game being watched live under a match header, where
  // the only thing a finished-game report wanted was the pair of numbers. Those
  // are a readout on the chart's title row now.
  //
  // `ResourceCharts.js`: it stacks food, gold lost and lumber lost, one line
  // per player each. Measured over 80 games
  // (`node tools/analyse-resource-series.js`), gold lost is flat for a median
  // 27% of the x-axis and lumber lost for 43% — the entire game at worst — and
  // the two food lines sit 9% apart, tracing each other. The desktop draws the
  // difference of the loss curves and food against its cap instead, both from
  // the shared CompareCharts factory. The rule was never "mount the viewer's
  // class whatever it draws"; it is "do not redraw a chart the viewer has".
  'DominanceChart.js',
  // Attack types, armor types and the TFT damage matrix. Split out of
  // Constants.js, which is the viewer's enum vocabulary (LayoutMode,
  // ScrubStates, TeamColorList) and has no business in an app with no canvas.
  'CombatTables.js',
  // The Match Summary screen itself: six tab renderers, no app inside them.
  // The viewer mounts it through client/js/MatchSummary.js and this app through
  // js/game-report-view.js, each supplying its own adapter, icon resolver and
  // colour function. Depends on CombatTables above.
  //
  // This is the same rule as DominanceChart, applied to a whole screen: if this
  // app ever starts drawing its own version of a tab, the seam has leaked and
  // the two products have begun telling different stories about one game.
  'MatchSummaryView.js'
].map(f => path.join(ROOT, 'client', 'js', f));

// Which map a replay was played on. Generated by `npm run build:parser` from
// helpers/mapResolver.js, the same file the parser bundle resolves with, so
// this app can never disagree with the parse it is displaying. SummaryExtract
// reaches for it lazily, so the tag order below is not load-bearing.
SHARED_JS.unshift(path.join(ROOT, 'client', 'js', 'vendor', 'MapResolver.js'));

// The site's design token layer. The desktop app is styled from the SAME
// tokens as the web client rather than growing a second design system —
// the desktop's own css/ sheets consume these and define nothing themselves.
const TOKENS_CSS = path.join(ROOT, 'client', 'css', 'tokens.css');

// The stylesheet for the three widgets above, split out of main.css for
// exactly this reason. Copying the rules into app.css instead would be a
// second copy of 674 lines of chrome, and it would drift.
const DOMINANCE_CSS = path.join(ROOT, 'client', 'css', 'dominance.css');

// The Match Summary screen's layout, split out of main.css for exactly the same
// reason: this app renders that screen from MatchSummaryView.js, and a second
// copy of ~970 lines of layout is a second copy that drifts.
const MATCH_SUMMARY_CSS = path.join(ROOT, 'client', 'css', 'match-summary.css');

// The site's favicons, so the window and the tab it came from carry the same
// mark. Deliberately NOT client/assets/wc3icons/ — that is 7.5 MB of jpgs that
// LZMA cannot compress, and the app fetches those from the CDN instead.
const BRAND_FILES = ['favicon-16x16.png', 'favicon-32x32.png']
  .map(f => path.join(ROOT, 'client', f));

const MAPS = path.join(ROOT, 'client', 'maps');

// Only these are needed to PARSE a replay. terrain.jpg / heights.bin.gz /
// gridmap.jpg belong to the 3D renderer, which the desktop app does not ship.
const PARSE_FILES = ['wpm.json.gz', 'doo.json.gz', 'unit.json.gz'];

// Staged into the installer by --bundle-maps. Tauri copies this whole tree as
// a bundled resource; the app seeds its map cache from it on first run.
const RESOURCE_MAPS = path.join(ROOT, 'desktop', 'src-tauri', 'resources', 'maps');

// The competitive 1v1 pool, as BASE names — matched by prefix so every
// version and season variant a folder ships under (AutumnLeaves,
// AutumnLeaves_v2.0, AutumnLeaves_S2_v2.0…) is picked up automatically. A
// replay can be on any of them, so they all have to be present.
//
// All 202 maps is 318 MB, which is not an installer. This set covers the
// games a ladder player actually produces; anything outside it still parses,
// it just needs the map fetched first.
const LADDER_MAP_PREFIXES = [
  'Amazonia', 'AutumnLeaves', 'ConcealedHill', 'EchoIsles', 'Hammerfall',
  'LastRefuge', 'NorthernIsles', 'SecretValley', 'ShatteredExile',
  'Springtime', 'TerenasStand', 'Tidehunters', 'TurtleRock', 'TwistedMeadows'
];

// Folder naming is inconsistent across the corpus (dashes, dots, spaces,
// case), so compare on a squashed form rather than the raw name.
const normFolder = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

const resolveLadderSet = (available) => {
  const prefixes = LADDER_MAP_PREFIXES.map(normFolder);
  return available.filter(name => {
    const n = normFolder(name);
    return prefixes.some(p => n.startsWith(p));
  });
};

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

// The installer's ladder set, frozen from a full checkout. CI has no
// client/maps (parse caches live on the CDN, not in git), so the set cannot
// be resolved from local directories there — it is resolved HERE on a machine
// that has them, committed, and fetched from cdn.wc3v.com in CI.
// Regenerate after adding a ladder map: --write-map-manifest.
const MAP_MANIFEST = path.join(ROOT, 'desktop', 'installer-maps.json');
const CDN_MAPS = 'https://cdn.wc3v.com/maps';

const fetchTo = (url, dest) => new Promise((resolve, reject) => {
  const https = require('https');
  const zlib = require('zlib');
  // The caches are stored gzipped with Content-Encoding: gzip metadata, and
  // the edge DECOMPRESSES for clients that do not advertise gzip — the first
  // version of this download turned a 50 MB map set into 1.8 GB of plain
  // JSON in .gz clothing. Advertise gzip so the stored bytes pass through,
  // and re-compress if the edge sent identity anyway.
  https.get(url, { headers: { 'accept-encoding': 'gzip' } }, (res) => {
    if (res.statusCode !== 200) {
      res.resume();
      return reject(new Error(`${res.statusCode} ${url}`));
    }
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      let buf = Buffer.concat(chunks);
      const gzipped = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
      if (dest.endsWith('.gz') && !gzipped) buf = zlib.gzipSync(buf);
      fs.writeFile(dest, buf, (e) => e ? reject(e) : resolve());
    });
    res.on('error', reject);
  }).on('error', reject);
});

// Download the manifest's maps from the CDN into client/maps. Only what is
// missing; a checkout that already has them fetches nothing.
const fetchMaps = async () => {
  if (!fs.existsSync(MAP_MANIFEST)) {
    console.error('No desktop/installer-maps.json. Run --write-map-manifest on a machine with client/maps.');
    process.exit(1);
  }
  const names = JSON.parse(fs.readFileSync(MAP_MANIFEST, 'utf8'));
  let fetched = 0;
  for (const name of names) {
    const dir = path.join(MAPS, name);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of PARSE_FILES) {
      const dest = path.join(dir, f);
      if (fs.existsSync(dest)) continue;
      try {
        await fetchTo(`${CDN_MAPS}/${encodeURIComponent(name)}/${f}`, dest);
        fetched++;
      } catch (e) {
        // unit.json.gz is required for parses to resolve; the other two some
        // maps legitimately lack. Only a missing unit file is fatal.
        fs.rmSync(dest, { force: true });
        if (f === 'unit.json.gz') {
          console.error(`fetch-maps: ${e.message} — the installer set needs this file.`);
          process.exit(1);
        }
      }
    }
  }
  console.log(`fetch-maps: ${names.length} maps ensured, ${fetched} files downloaded`);
};

// Copy the parse-data files for a set of maps into `target`. Returns stats.
const copyMapSet = (list, target, label) => {
  if (!fs.existsSync(MAPS)) {
    console.log('client/maps not present — skipping map copy');
    return null;
  }
  const available = fs.readdirSync(MAPS).filter(n =>
    fs.statSync(path.join(MAPS, n)).isDirectory());

  const wanted = (list === 'all' || list === true) ? available
    : list === 'ladder' ? resolveLadderSet(available)
    : String(list).split(',').map(s => s.trim()).filter(Boolean);

  fs.mkdirSync(target, { recursive: true });

  let copied = 0, bytes = 0;
  const missing = [];
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

  console.log(`${label}: ${copied} maps, ${(bytes / 1024 / 1024).toFixed(1)} MB (parse data only)`);
  // `ladder` lists naming variants that not every checkout has; only surface
  // misses for an explicit user-supplied list, where a typo matters.
  if (missing.length && list !== 'ladder' && list !== 'all' && list !== true) {
    console.log(`${' '.repeat(label.length)}  not found in client/maps: ${missing.join(', ')}`);
  }
  return { copied, bytes };
};

// Stage into the installer payload. Cleared first so a shrinking set never
// leaves stale maps inflating every future installer.
const bundleMaps = (list) => {
  fs.rmSync(RESOURCE_MAPS, { recursive: true, force: true });
  const r = copyMapSet(list, RESOURCE_MAPS, 'installer maps');
  if (r && r.bytes > 120 * 1024 * 1024) {
    console.log('           WARNING: that is a very large installer payload.');
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
  for (const src of SHARED_JS) {
    if (!fs.existsSync(src)) {
      console.error(`Shared module missing: ${path.relative(ROOT, src)}`);
      process.exit(1);
    }
    fs.copyFileSync(src, path.join(vendorDir, path.basename(src)));
  }

  const cssVendorDir = path.join(DIST, 'css', 'vendor');
  fs.mkdirSync(cssVendorDir, { recursive: true });
  fs.copyFileSync(TOKENS_CSS, path.join(cssVendorDir, 'tokens.css'));
  if (!fs.existsSync(DOMINANCE_CSS)) {
    console.error(`Shared stylesheet missing: ${path.relative(ROOT, DOMINANCE_CSS)}`);
    process.exit(1);
  }
  fs.copyFileSync(DOMINANCE_CSS, path.join(cssVendorDir, 'dominance.css'));
  if (!fs.existsSync(MATCH_SUMMARY_CSS)) {
    console.error(`Shared stylesheet missing: ${path.relative(ROOT, MATCH_SUMMARY_CSS)}`);
    process.exit(1);
  }
  fs.copyFileSync(MATCH_SUMMARY_CSS, path.join(cssVendorDir, 'match-summary.css'));

  for (const src of BRAND_FILES) {
    if (!fs.existsSync(src)) {
      console.error(`Brand asset missing: ${path.relative(ROOT, src)}`);
      process.exit(1);
    }
    fs.copyFileSync(src, path.join(DIST, path.basename(src)));
  }

  const size = fs.statSync(path.join(vendorDir, 'wc3v-parser.bundle.js')).size;
  console.log(`dist:      ${path.relative(ROOT, DIST)}`);
  console.log(`parser:    ${(size / 1024).toFixed(0)} KB`);
  console.log(`shared:    ${SHARED_JS.map(f => path.basename(f)).join(', ')} + tokens.css + favicons`);

  if (args['bundle-maps']) bundleMaps(args['bundle-maps']);
  if (args['seed-maps']) copyMapSet(args['seed-maps'], appMapCacheDir(), 'map cache');
  if (!args['bundle-maps'] && !args['seed-maps']) {
    console.log('maps:      none staged (--bundle-maps=ladder for an installer)');
  }
};

// Freeze the ladder set a full checkout resolves into the committed manifest
// CI fetches from. Not part of main(): it is run when the set changes, not on
// every build.
if (args['write-map-manifest']) {
  const available = fs.existsSync(MAPS)
    ? fs.readdirSync(MAPS).filter(n => fs.statSync(path.join(MAPS, n)).isDirectory())
    : [];
  const set = resolveLadderSet(available).sort();
  if (!set.length) {
    console.error('client/maps resolved an empty ladder set — nothing written.');
    process.exit(1);
  }
  fs.writeFileSync(MAP_MANIFEST, JSON.stringify(set, null, 2) + '\n');
  console.log(`wrote ${path.relative(ROOT, MAP_MANIFEST)}: ${set.length} maps`);
  process.exit(0);
}

if (args['fetch-maps']) {
  fetchMaps().then(() => main());
} else {
  main();
}
