/**
 * deploy-desktop.js — Publish a desktop installer + update manifest to R2.
 *
 * Companion to tools/deploy-assets.js and tools/deploy-replays.js, same
 * rclone `r2:` remote, same bucket (`wc3v-cdn`, served at cdn.wc3v.com).
 *
 * R2 layout ("r2:wc3v-cdn/desktop/"):
 *   latest.json                  - the manifest tauri-plugin-updater polls
 *   WC3V_<version>_x64-setup.exe - the installer clients download
 *   WC3V_<version>_x64-setup.exe.sig - kept for the record; the updater reads
 *                                  the signature out of latest.json, not this
 *
 * The installer is NOT committed to git — it is 15 MB of binary in an
 * open-source repo. This script is the only path from a local build to users.
 *
 * Cache-Control:
 *   - the versioned .exe  -> immutable, 1y. The filename carries the version,
 *     so a given URL's bytes never change.
 *   - latest.json         -> 5 min, must-revalidate. This is the polling
 *     target; a long TTL would mean users sit on a stale version for hours
 *     after a release.
 *
 * Refuses to publish a build with no minisign updater signature, a version that
 * is not newer than what is already live, or a binary older than the source it
 * was built from.
 *
 * Note that "signature" throughout this file means the MINISIGN updater
 * signature, which is what tauri-plugin-updater verifies. The installer itself
 * is not Authenticode-signed: SignPath Foundation declined the project in
 * August 2026 and no certificate replaced it. First-time installs go through
 * client/install.ps1 instead, which sidesteps SmartScreen by not being a
 * browser download and checks the sha256 this script publishes below.
 *
 * Usage:
 *   node tools/deploy-desktop.js --notes="What changed, in a sentence."
 *   node tools/deploy-desktop.js --notes="..." --dry-run   - preview, no upload
 *   node tools/deploy-desktop.js --notes="..." --skip-verify
 *   node tools/deploy-desktop.js --notes="..." --installer=path\to\signed.exe
 *   node tools/deploy-desktop.js --prune [--keep=N]        - delete old builds
 *
 * --installer is unused in the current release flow, and is kept because it is
 * the only correct way to publish an Authenticode-signed build should the
 * project ever get a certificate. Authenticode CHANGES THE BYTES, so the
 * updater .sig generated at build time no longer verifies — this flag stages
 * the signed exe under the canonical bundle name and regenerates the .sig
 * against it with `tauri signer sign`, which needs TAURI_SIGNING_PRIVATE_KEY in
 * the environment. Everything downstream (sha256, manifest, upload) then reads
 * the signed file like any other build.
 *
 * Pruning is safe at any time, including with real installs in the field: an
 * installed 0.2.0 does not need the 0.2.0 installer to update itself, only
 * latest.json and the NEWEST one. Old installers matter solely to somebody
 * deliberately installing an old version.
 *
 * Requires: rclone with an `r2:` remote, and a build produced by
 * `npm run desktop:build` WITH the signing variables set (see desktop/README.md).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CONF = path.join(ROOT, 'desktop/src-tauri/tauri.conf.json');
const BUNDLE = path.join(ROOT, 'desktop/src-tauri/target/release/bundle/nsis');
const STAGE = path.join(ROOT, 'desktop/src-tauri/target/release/bundle/deploy');
const REMOTE = 'r2:wc3v-cdn/desktop';
const PUBLIC = 'https://cdn.wc3v.com/desktop';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const MANIFEST_TTL = 'public, max-age=300, must-revalidate';

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});
const isDryRun = !!args['dry-run'];

function die (msg) {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

/**
 * Everything that ends up INSIDE the binary. `desktop/dist` is excluded —
 * it is generated from src-frontend by build-desktop-client.js, so checking it
 * would just compare a copy against itself.
 */
const SOURCE_PATHS = [
  'desktop/src-frontend',
  'desktop/src-tauri/src',
  'desktop/src-tauri/Cargo.toml',
  'desktop/src-tauri/tauri.conf.json',
  'desktop/src-tauri/capabilities'
].map(p => path.join(ROOT, p));

/** Newest mtime under a file or directory, recursively. */
function newestMtime (target) {
  let newest = 0;
  const walk = (p) => {
    let st;
    try { st = fs.statSync(p); } catch (_) { return; }
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(p)) walk(path.join(p, name));
    } else if (st.mtimeMs > newest) {
      newest = st.mtimeMs;
      newestFile = p;
    }
  };
  walk(target);
  return newest;
}
let newestFile = null;

/**
 * Refuse to publish a build older than the source it claims to be built from.
 *
 * Catches "you edited something and forgot to rebuild at all". It does NOT
 * catch an edit made *during* a build — see checkEmbeddedFiles below for why
 * a timestamp cannot.
 */
function checkNotStale (exePath) {
  const built = fs.statSync(exePath).mtimeMs;
  let newest = 0;
  newestFile = null;
  let culprit = null;
  for (const p of SOURCE_PATHS) {
    const m = newestMtime(p);
    if (m > newest) { newest = m; culprit = newestFile; }
  }
  if (newest > built) {
    die('The installer is OLDER than the source it was built from.\n' +
        `  installer: ${new Date(built).toISOString()}\n` +
        `  source:    ${new Date(newest).toISOString()}  ${path.relative(ROOT, culprit)}\n\n` +
        'Run `npm run desktop:build` again.');
  }
}

/**
 * Verify every file `overlay.rs` embeds with `include_str!` is in the binary
 * VERBATIM, byte for byte.
 *
 * A timestamp cannot answer this. The installer's mtime is when NSIS packaged
 * it; the Rust object that carries these strings was compiled minutes earlier.
 * Edit an embedded file in between and you get an installer that is newer than
 * every source file and still contains the previous version of a page.
 *
 * That is not hypothetical — it happened on 5 Aug 2026 with handoff.html, and
 * the only thing that caught it was grepping the binary for a string that
 * should have been there. This is that grep, done properly and every time.
 *
 * The list is read out of overlay.rs rather than hardcoded, so a new embed is
 * covered the moment someone adds one.
 */
function checkEmbeddedFiles () {
  const overlayRs = path.join(ROOT, 'desktop/src-tauri/src/overlay.rs');
  const src = fs.readFileSync(overlayRs, 'utf8');
  const embeds = [...src.matchAll(/include_str!\(\s*"([^"]+)"\s*\)/g)].map(m => m[1]);
  if (!embeds.length) {
    die(`No include_str! found in ${path.relative(ROOT, overlayRs)}. This check ` +
        'reads the embed list from that file; if the embeds moved, update it.');
  }

  const exe = fs.readFileSync(path.join(ROOT, 'desktop/src-tauri/target/release/wc3v-desktop.exe'));
  const stale = [];
  for (const rel of embeds) {
    // include_str! paths are relative to the file doing the including.
    const file = path.resolve(path.dirname(overlayRs), rel);
    if (!fs.existsSync(file)) die(`overlay.rs embeds a file that does not exist: ${rel}`);
    if (!exe.includes(fs.readFileSync(file))) stale.push(path.relative(ROOT, file));
  }
  if (stale.length) {
    die('The binary does not contain the current version of:\n' +
        stale.map(f => `  ${f}`).join('\n') + '\n\n' +
        'These are compiled in with include_str!, so editing one after the Rust\n' +
        'compile has already run produces a build that looks entirely fine and\n' +
        'silently ships the previous version. Run `npm run desktop:build` again.');
  }
  console.log(`  embedded:  ${embeds.length} file(s) verified byte-for-byte`);
}

function checkRclone () {
  const v = spawnSync('rclone', ['version'], { encoding: 'utf8' });
  if (v.status !== 0) {
    die('rclone not found in PATH. Install it and run `rclone config` to set up the `r2` remote.');
  }
  const remotes = spawnSync('rclone', ['listremotes'], { encoding: 'utf8' });
  if (!remotes.stdout || !remotes.stdout.split('\n').includes('r2:')) {
    die('rclone has no `r2:` remote. Run `rclone config` and add a Cloudflare R2 S3 remote named `r2`.');
  }
}

/**
 * Fetch a URL, resolving to { status, body } — or null if the host is
 * unreachable. HEAD for the installer: it is 15 MB and all we want is the
 * status code.
 */
function fetchUrl (url, method) {
  return new Promise(resolve => {
    const req = https.request(url, { method: method || 'GET' }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}
const get = url => fetchUrl(url, 'GET');
const head = url => fetchUrl(url, 'HEAD');

/** Semver compare, enough for x.y.z. Returns >0 if a is newer than b. */
function cmpVersion (a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

function copyTo (localFile, remoteFile, headers) {
  const cmd = ['copyto', localFile, `${REMOTE}/${remoteFile}`];
  for (const h of headers) cmd.push('--header-upload', h);
  // Without this, rclone probes for the bucket and falls back to CreateBucket
  // when the probe is refused — which an R2 token scoped to object read/write
  // denies, so the upload dies with a misleading "AccessDenied: CreateBucket".
  cmd.push('--s3-no-check-bucket');
  cmd.push('--progress', '--stats-one-line', '--stats=2s');
  if (isDryRun) cmd.push('--dry-run');
  console.log(`\n+ rclone ${cmd.join(' ')}`);
  const res = spawnSync('rclone', cmd, { stdio: 'inherit' });
  if (res.status !== 0) die(`rclone exited with status ${res.status}`);
}

/**
 * Delete published installers, keeping the live one.
 *
 * The version in latest.json is the authority for what "live" means — NOT
 * tauri.conf.json, which may already have been bumped for the next build. If
 * the manifest cannot be read, nothing is deleted: pruning blind is how you
 * remove the installer every client is being pointed at.
 */
async function prune () {
  checkRclone();

  const keep = Math.max(1, parseInt(args.keep, 10) || 1);
  const manifest = await get(`${PUBLIC}/latest.json`);
  if (!manifest || manifest.status !== 200) {
    die(`Could not read ${PUBLIC}/latest.json (got ` +
        `${manifest ? manifest.status : 'no response'}). Refusing to delete anything ` +
        'without knowing which version is live.');
  }
  let live;
  try { live = JSON.parse(manifest.body).version; } catch (_) { /* below */ }
  if (!live) die('latest.json is unreadable. Refusing to delete anything.');

  const ls = spawnSync('rclone', ['lsf', REMOTE, '--s3-no-check-bucket'], { encoding: 'utf8' });
  if (ls.status !== 0) die(`rclone lsf failed: ${ls.stderr || ls.status}`);

  const versions = new Set();
  for (const name of ls.stdout.split('\n')) {
    const m = name.match(/^WC3V_(\d+\.\d+\.\d+)_x64-setup\.exe$/);
    if (m) versions.add(m[1]);
  }
  if (!versions.has(live)) {
    die(`latest.json publishes ${live}, but no installer for it is in the bucket.\n` +
        'That is a broken channel, not a cleanup job. Fix it before pruning.');
  }

  // Newest first, then keep the top N — but the live version is kept no matter
  // where it sorts, because deleting it breaks every client immediately.
  const ordered = [...versions].sort((a, b) => cmpVersion(b, a));
  const keeping = new Set([live, ...ordered.slice(0, keep)]);
  const doomed = ordered.filter(v => !keeping.has(v));

  console.log(`  live:      ${live}`);
  console.log(`  published: ${ordered.join(', ')}`);
  console.log(`  keeping:   ${[...keeping].sort((a, b) => cmpVersion(b, a)).join(', ')}`);
  if (!doomed.length) {
    console.log('\nNothing to prune.');
    return;
  }
  console.log(`  deleting:  ${doomed.join(', ')}`);
  if (isDryRun) {
    console.log('\n(dry run — nothing deleted)');
    return;
  }

  for (const v of doomed) {
    for (const suffix of ['', '.sig']) {
      const file = `WC3V_${v}_x64-setup.exe${suffix}`;
      const res = spawnSync('rclone',
        ['deletefile', `${REMOTE}/${file}`, '--s3-no-check-bucket'],
        { stdio: 'inherit' });
      if (res.status !== 0) die(`Failed to delete ${file}`);
      console.log(`  deleted ${file}`);
    }
  }
  console.log(`\nPruned ${doomed.length} version(s). ${live} is still live.`);
}

async function main () {
  if (args.prune) return prune();

  // The notes reach users in the update dialog. An auto-generated placeholder
  // would be worse than no release at all, so this is required rather than
  // defaulted.
  const notes = typeof args.notes === 'string' ? args.notes.trim() : '';
  if (!notes) {
    die('Missing --notes="...". These are shown to every user in the update\n' +
        'prompt, so they have to be written, not generated.');
  }

  checkRclone();

  // tauri.conf.json is the single source of truth for the version — the
  // installer, the binary and this manifest all have to agree.
  const conf = JSON.parse(fs.readFileSync(CONF, 'utf8'));
  const version = conf.version;
  const exeName = `WC3V_${version}_x64-setup.exe`;
  const exePath = path.join(BUNDLE, exeName);
  const sigPath = `${exePath}.sig`;

  console.log(`WC3V desktop ${version}`);

  // Stage an externally Authenticode-signed installer, then re-sign the updater
  // signature against ITS bytes. Without the re-sign every existing install
  // would reject the update as tampered, because the .sig on disk describes the
  // unsigned build. Unused today (the project has no certificate), kept because
  // it is the only correct way to publish one if that changes.
  if (typeof args.installer === 'string') {
    const src = path.resolve(args.installer);
    if (!fs.existsSync(src)) die(`--installer file not found:\n  ${src}`);
    if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
      die('--installer needs TAURI_SIGNING_PRIVATE_KEY in the environment to\n' +
          'regenerate the updater signature against the signed bytes.\n' +
          'See desktop/README.md "Releasing".');
    }
    fs.mkdirSync(BUNDLE, { recursive: true });
    if (src !== exePath) fs.copyFileSync(src, exePath);
    console.log(`  staged signed installer from:\n    ${src}`);
    const resign = spawnSync('cargo', ['tauri', 'signer', 'sign', exePath],
      { stdio: 'inherit', shell: true });
    if (resign.status !== 0) {
      die('`cargo tauri signer sign` failed — the updater signature was not\n' +
          'regenerated, so this build must not be published.');
    }
  }

  if (!fs.existsSync(exePath)) {
    die(`No installer for ${version} at:\n  ${exePath}\n\n` +
        'Run `npm run desktop:build` first (see desktop/README.md).');
  }
  // The README warns about this in prose and nothing has ever enforced it:
  // an unsigned build looks completely successful and then cannot be served
  // as an update, because clients refuse a package whose signature does not
  // verify against the pubkey compiled into the binary they are running.
  if (!fs.existsSync(sigPath)) {
    die(`Installer exists but ${exeName}.sig does NOT:\n  ${sigPath}\n\n` +
        'That build was made without TAURI_SIGNING_PRIVATE_KEY and cannot be\n' +
        'served as an update. Set the key (its CONTENTS, not its path) and\n' +
        'rebuild — see desktop/README.md.');
  }

  checkNotStale(exePath);
  checkEmbeddedFiles();

  // A manifest whose version is not strictly greater than what is already
  // published is a no-op at best and a downgrade prompt at worst.
  const existing = await get(`${PUBLIC}/latest.json`);
  if (existing && existing.status === 200) {
    let published = null;
    try { published = JSON.parse(existing.body).version; } catch (_) { /* malformed; treat as none */ }
    if (published) {
      if (cmpVersion(version, published) <= 0) {
        die(`${PUBLIC}/latest.json already publishes ${published}.\n` +
            `${version} is not newer, so no client would take it. Bump\n` +
            'desktop/src-tauri/tauri.conf.json and rebuild.');
      }
      console.log(`  currently published: ${published} → publishing ${version}`);
    }
  } else if (existing && existing.status === 404) {
    console.log('  currently published: nothing (first release)');
  } else {
    console.log('  currently published: could not be checked (offline?)');
  }

  const signature = fs.readFileSync(sigPath, 'utf8').trim();
  // SHA-256 of the installer, published alongside the Tauri updater signature.
  // The signature only lets the updater verify a package — it's not something
  // a human can check by hand. sha256 is: something download.html can show
  // and a user can verify with `certutil -hashfile` / `shasum` themselves.
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(exePath)).digest('hex');
  const manifest = {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: {
      'windows-x86_64': {
        signature,
        sha256,
        url: `${PUBLIC}/${exeName}`
      }
    }
  };

  fs.mkdirSync(STAGE, { recursive: true });
  const manifestPath = path.join(STAGE, 'latest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  const sizeMb = (fs.statSync(exePath).size / (1024 * 1024)).toFixed(1);
  console.log(`  installer: ${exeName} (${sizeMb} MB)`);
  console.log(`  signature: ${signature.slice(0, 24)}… (${signature.length} chars)`);
  console.log(`  sha256:    ${sha256}`);
  if (isDryRun) console.log('\n(dry run — no upload)');

  // Installer first. If the manifest went up first and the upload of the exe
  // then failed, every client would be pointed at a URL that 404s.
  copyTo(exePath, exeName, [`Cache-Control: ${IMMUTABLE}`]);
  copyTo(sigPath, `${exeName}.sig`, [`Cache-Control: ${IMMUTABLE}`]);
  copyTo(manifestPath, 'latest.json', [
    `Cache-Control: ${MANIFEST_TTL}`,
    'Content-Type: application/json'
  ]);

  if (isDryRun) {
    console.log('\nDry run complete. Nothing was uploaded.');
    return;
  }

  if (args['skip-verify']) {
    console.log('\nUploaded. Verification skipped (--skip-verify).');
    return;
  }

  // An update path is only real once it has been walked. This walks the first
  // two steps of it: the manifest is reachable and says what we just wrote,
  // and the URL it points at actually serves something.
  console.log('\nVerifying…');
  const check = await get(`${PUBLIC}/latest.json`);
  if (!check || check.status !== 200) {
    die(`Uploaded, but ${PUBLIC}/latest.json did not come back 200 ` +
        `(got ${check ? check.status : 'no response'}). Check the bucket's public access.`);
  }
  let served = null;
  try { served = JSON.parse(check.body); } catch (_) { /* handled below */ }
  if (!served || served.version !== version) {
    die(`Uploaded, but ${PUBLIC}/latest.json serves ` +
        `${served ? served.version : 'unparseable JSON'} rather than ${version}. ` +
        'It may still be cached — retry in a few minutes.');
  }
  const exe = await head(served.platforms['windows-x86_64'].url);
  if (!exe || exe.status !== 200) {
    die(`Manifest is live, but the installer URL it points at returned ` +
        `${exe ? exe.status : 'no response'}:\n  ${served.platforms['windows-x86_64'].url}`);
  }

  console.log(`\nPublished ${version}. Manifest and installer are both live.`);
  console.log('Now install the PREVIOUS version and confirm it offers this one —');
  console.log('an update path is only real once it has been walked.');
}

main();
