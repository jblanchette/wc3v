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
 * Usage:
 *   node tools/deploy-desktop.js --notes="What changed, in a sentence."
 *   node tools/deploy-desktop.js --notes="..." --dry-run   - preview, no upload
 *   node tools/deploy-desktop.js --notes="..." --skip-verify
 *
 * Requires: rclone with an `r2:` remote, and a build produced by
 * `npm run desktop:build` WITH the signing variables set (see RELEASING.md).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
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

async function main () {
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

  if (!fs.existsSync(exePath)) {
    die(`No installer for ${version} at:\n  ${exePath}\n\n` +
        'Run `npm run desktop:build` first (see desktop/RELEASING.md).');
  }
  // RELEASING.md warns about this in prose and nothing has ever enforced it:
  // an unsigned build looks completely successful and then cannot be served
  // as an update, because clients refuse a package whose signature does not
  // verify against the pubkey compiled into the binary they are running.
  if (!fs.existsSync(sigPath)) {
    die(`Installer exists but ${exeName}.sig does NOT:\n  ${sigPath}\n\n` +
        'That build was made without TAURI_SIGNING_PRIVATE_KEY and cannot be\n' +
        'served as an update. Set the key (its CONTENTS, not its path) and\n' +
        'rebuild — see desktop/RELEASING.md.');
  }

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
  const manifest = {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: {
      'windows-x86_64': {
        signature,
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
