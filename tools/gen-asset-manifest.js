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
const EXTRA_FILES = ['data/builds-manifest.json', 'data/builds-cards.json'];

// The page list lives in tools/seo/pages.js — one registry, shared with
// gen-seo.js. It used to be a hardcoded array here, which made this file the
// de-facto page registry and meant a new page silently missed either the cache
// busting or the sitemap depending on which list someone remembered to edit.
// It includes the generated client/builds/*.html pages, which exist by the time
// this runs (gen-seo comes earlier in render.yaml's buildCommand).
const { HTML_FILES } = require('./seo/pages');

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
  const isCheck = process.argv.includes('--check');
  const dryRun = process.argv.includes('--dry-run') || isCheck;

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
  // commit/branch come from Render's build environment. They make
  // /asset-manifest.json a deploy stamp you can curl: "which commit is actually
  // live, and when was it built". Worth the two lines — diagnosing a stale
  // deploy by comparing file contents against git is slow and ambiguous, and we
  // had to do exactly that on 2026-08-11 when changed files stopped publishing
  // while newly added ones went out.
  const manifest = {
    bundleVersion,
    generatedAt: new Date().toISOString(),
    commit: process.env.RENDER_GIT_COMMIT || null,
    branch: process.env.RENDER_GIT_BRANCH || null,
    files: perFile
  };
  const manifestPath = path.join(CLIENT, 'asset-manifest.json');
  if (!dryRun) fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  // ── 3. rewrite HTML cache busters ────────────────────────────────────────
  let rewrites = 0;
  // Local js/css references the rewrite could not reach. See the note on the
  // [\w.-] class below: a skip here is silent and permanent, so it is
  // collected and reported rather than left to be discovered in a browser.
  const skipped = [];
  for (const name of HTML_FILES) {
    const p = path.join(CLIENT, name);
    if (!fs.existsSync(p)) continue;
    let html = fs.readFileSync(p, 'utf8');
    const before = html;

    // a) <script src="js/...js"> / <link href="[/]css/...css"> — with or
    //    without an existing ?v=… — normalise to ?v=<per-file hash>. Handles
    //    both index.html's "css/main.css" and viewer.html's "/css/main.css"
    //    (the leading-slash <link> that replaced viewer's old @import).
    //    Per-file (not bundleVersion): a one-line change to one JS file used
    //    to bust every JS/CSS URL for every repeat visitor; now only the
    //    changed file gets a new URL. bundleVersion is the fallback for
    //    anything referenced but not hashed.
    //    The existing-buster class is [\w.-], NOT [\w.]. A hyphen used to make
    //    the whole tag unmatchable rather than just the buster: `?v=dl-5a`
    //    matched as far as `?v=dl`, then the closing quote did not match `-`,
    //    the optional group backtracked to empty, and the tag was skipped in
    //    silence. That file then shipped with a FROZEN buster under the
    //    `immutable` one-year Cache-Control on /js/*, so no later change to it
    //    would ever have reached a repeat visitor. Shipped that way on
    //    download.html for months.
    const verFor = (file) => perFile['/' + file.replace(/^\.{0,2}\//, '')] || bundleVersion;
    html = html.replace(
      /((?:src|href)=")((?:\.{0,2}\/)?(?:js|css)\/[^"?]+\.(?:js|css))(?:\?v=[\w.-]+)?(")/g,
      (_m, pre, file, post) => `${pre}${file}?v=${verFor(file)}${post}`
    );

    //    Belt and braces, because the failure above was invisible: any local
    //    js/css reference left carrying something other than its own hash is
    //    one the rewrite could not reach. Report it rather than ship it.
    for (const m of html.matchAll(/(?:src|href)="((?:\.{0,2}\/)?(?:js|css)\/[^"?]+\.(?:js|css))(\?v=([^"]*))?"/g)) {
      const want = verFor(m[1]);
      if (m[3] !== want) skipped.push(name + ': ' + m[1] + ' kept ?v=' + (m[3] === undefined ? '(none)' : m[3]) + ', expected ' + want);
    }

    // b) viewer.html dev cache buster — between the marker comments. The
    //    committed source leaves `_assetVersion = null` so dev falls back to
    //    Date.now(); here we pin it to the deploy hash.
    html = html.replace(
      /(\/\* @asset-version-begin \*\/)[\s\S]*?(\/\* @asset-version-end \*\/)/,
      (_m, begin, end) => `${begin} const _assetVersion = '${bundleVersion}'; ${end}`
    );

    // c) index.html: window.__WC3V_ASSET_VERSION__ marker. Lets the homepage
    //    JS cache-bust /data/builds-cards.json (its fetch URL is in JS, so the
    //    src/href rewrite in (a) can't reach it). Separate from (b) — that one
    //    is viewer.html's `const _assetVersion`.
    html = html.replace(
      /(\/\* @wc3v-asset-version-begin \*\/)[\s\S]*?(\/\* @wc3v-asset-version-end \*\/)/,
      (_m, begin, end) => `${begin} window.__WC3V_ASSET_VERSION__ = '${bundleVersion}'; ${end}`
    );

    // d) viewer.html: the 50+ /js/* files are appended from JS (the ordered-
    //    async loader), so rewrite (a) can't reach their URLs. Emit the
    //    per-file hash map between the markers; the committed source keeps
    //    `_assetHashes = null` so dev falls back to the Date.now() buster.
    const jsCssHashes = {};
    for (const [url, h] of Object.entries(perFile)) {
      if (url.startsWith('/js/') || url.startsWith('/css/')) jsCssHashes[url] = h;
    }
    html = html.replace(
      /(\/\* @asset-hashes-begin \*\/)[\s\S]*?(\/\* @asset-hashes-end \*\/)/,
      (_m, begin, end) => `${begin} const _assetHashes = ${JSON.stringify(jsCssHashes)}; ${end}`
    );

    if (html !== before) {
      if (!dryRun) fs.writeFileSync(p, html);
      rewrites++;
    }
  }

  console.log(`asset-manifest: bundleVersion=${bundleVersion}${dryRun ? ' (dry run — nothing written)' : ''}`);
  console.log(`  ${files.length} files hashed → ${path.relative(ROOT, manifestPath)}`);
  console.log(`  ${rewrites} HTML file(s) ${dryRun ? 'would be' : ''} rewritten`);
  for (const s of skipped) console.error('  UNBUSTED  ' + s);

  // --check has to FAIL on drift, or it is a gate that never gates.
  //
  // It exited 0 while reporting "4 HTML file(s) would be rewritten" right up
  // until Aug 2026, which is how commit 7b8ce92 shipped a changed
  // SummaryBuild.js while the committed HTML still pointed at the previous
  // file's hash. The server had the new file; every browser holding the old
  // one under that unchanged ?v= had no reason to ask for it again.
  //
  // --dry-run stays silent-and-zero: it is for looking, not for gating.
  if (isCheck && rewrites > 0) {
    console.error(`
${rewrites} HTML file(s) are out of date. Run \`npm run gen-manifest\` and commit the result.`);
    process.exit(1);
  }

  // A reference the rewrite could not reach ships with whatever buster is
  // hardcoded, forever, behind a one-year immutable Cache-Control. That is
  // worse than being out of date, so it fails the build rather than --check
  // alone.
  if (skipped.length && !dryRun) {
    console.error(`
${skipped.length} js/css reference(s) did not get a content hash. A hand-written
?v= that the rewrite cannot parse freezes that URL under the immutable
Cache-Control on /js/* and /css/*, so later changes never reach a repeat
visitor. Remove the hand-written buster and let this tool set it.`);
    process.exit(1);
  }
}

main();
