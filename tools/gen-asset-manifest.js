// gen-asset-manifest.js — content-hash the client's JS/CSS so they can be
// served with `Cache-Control: immutable` (see render.yaml).
//
// What it does:
//   1. SHA256-hashes every client/js/**.js and client/css/**.css (+ the
//      builds manifest) and computes one `bundleVersion` covering all of them.
//   2. Writes client/asset-manifest.json (the record; also used by a future
//      CI staleness check, mirroring tools/build-parser-bundle.js).
//   3. Rewrites the `?v=...` query strings in client/*.html and the dev cache
//      buster in viewer.html to that bundleVersion.
//
// Run it as the Render build step (`buildCommand: node tools/gen-asset-manifest.js`)
// so the rewrite lands in the deployed output without dirtying the committed
// HTML — the committed files keep dev-friendly fallbacks (`?v=2`, `Date.now()`).
// You can also run it locally before a manual deploy; it's idempotent.
//
// NOTE: uses only Node built-ins so it needs no `npm install` on Render.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const CLIENT = path.resolve(ROOT, 'client');

const HASH_DIRS = ['js', 'css'];
const EXTRA_FILES = ['data/builds-manifest.json'];
const HTML_FILES = [
  'index.html', 'viewer.html', 'replays.html',
  'about.html', 'community.html', 'terms.html', 'privacy.html'
];

function sha10 (buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
}

function walkFiles (dir, exts) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkFiles(full, exts));
    else if (exts.some(e => ent.name.endsWith(e))) out.push(full);
  }
  return out;
}

function relUrl (absPath) {
  return '/' + path.relative(CLIENT, absPath).split(path.sep).join('/');
}

function main () {
  const dryRun = process.argv.includes('--dry-run') || process.argv.includes('--check');

  // ── 1. hash everything ───────────────────────────────────────────────────
  const files = [];
  for (const d of HASH_DIRS) {
    files.push(...walkFiles(path.join(CLIENT, d), ['.js', '.css']));
  }
  for (const f of EXTRA_FILES) {
    const p = path.join(CLIENT, f);
    if (fs.existsSync(p)) files.push(p);
  }
  files.sort();

  const perFile = {};
  const combined = crypto.createHash('sha256');
  for (const f of files) {
    const buf = fs.readFileSync(f);
    const url = relUrl(f);
    const h = sha10(buf);
    perFile[url] = h;
    combined.update(url);
    combined.update(h);
  }
  const bundleVersion = combined.digest('hex').slice(0, 10);

  // ── 2. write the manifest ────────────────────────────────────────────────
  const manifest = {
    bundleVersion,
    generatedAt: new Date().toISOString(),
    files: perFile
  };
  const manifestPath = path.join(CLIENT, 'asset-manifest.json');
  if (!dryRun) fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  // ── 3. rewrite HTML cache busters ────────────────────────────────────────
  let rewrites = 0;
  for (const name of HTML_FILES) {
    const p = path.join(CLIENT, name);
    if (!fs.existsSync(p)) continue;
    let html = fs.readFileSync(p, 'utf8');
    const before = html;

    // a) <script src="js/...js"> / <link href="css/...css"> — with or without
    //    an existing ?v=… — normalise to ?v=<bundleVersion>.
    html = html.replace(
      /((?:src|href)=")((?:\.{0,2}\/)?(?:js|css)\/[^"?]+\.(?:js|css))(?:\?v=[\w.]+)?(")/g,
      (_m, pre, file, post) => `${pre}${file}?v=${bundleVersion}${post}`
    );

    // b) viewer.html: @import "/css/main.css?v=…"
    html = html.replace(
      /(@import\s+"\/css\/main\.css)(?:\?v=[\w.]+)?(")/g,
      (_m, pre, post) => `${pre}?v=${bundleVersion}${post}`
    );

    // c) viewer.html dev cache buster — between the marker comments. The
    //    committed source leaves `_assetVersion = null` so dev falls back to
    //    Date.now(); here we pin it to the deploy hash.
    html = html.replace(
      /(\/\* @asset-version-begin \*\/)[\s\S]*?(\/\* @asset-version-end \*\/)/,
      (_m, begin, end) => `${begin} const _assetVersion = '${bundleVersion}'; ${end}`
    );

    if (html !== before) {
      if (!dryRun) fs.writeFileSync(p, html);
      rewrites++;
    }
  }

  console.log(`asset-manifest: bundleVersion=${bundleVersion}${dryRun ? ' (dry run — nothing written)' : ''}`);
  console.log(`  ${files.length} files hashed → ${path.relative(ROOT, manifestPath)}`);
  console.log(`  ${rewrites} HTML file(s) ${dryRun ? 'would be' : ''} rewritten`);
}

main();
