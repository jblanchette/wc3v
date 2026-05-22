/**
 * deploy-replays.js — Sync parsed replays to R2 (cdn.wc3v.com).
 *
 * The static site on Render only serves HTML/JS/CSS. Anything under
 * /replays/* gets a 301 redirect to https://cdn.wc3v.com/replays/* (see
 * render.yaml), which is backed by the Cloudflare R2 bucket `wc3v-cdn`.
 * That means after a reparse regenerates local .wc3v.gz files, viewers see
 * no change until those files are uploaded to R2. This script is that step.
 *
 * IMPORTANT — what the CDN actually serves:
 *   The client fetches `/replays/<name>.wc3v` (UNCOMPRESSED — app.js loadFile),
 *   and the CDN serves the R2 object at that exact key. It does NOT decompress
 *   a .wc3v.gz on the fly. So the object that must be fresh in R2 is the
 *   uncompressed `<name>.wc3v`, not `<name>.wc3v.gz`.
 *
 *   Local parser output is `<name>.wc3v.gz` (the uncompressed `.wc3v` is a
 *   debug-only artifact). So this script decompresses each .wc3v.gz into a
 *   temp staging dir and uploads the resulting `.wc3v` to R2.
 *
 *   (An earlier version of this script uploaded `.wc3v.gz` only — those
 *   objects exist in the bucket but are never read by the client. Harmless,
 *   but don't rely on them.)
 *
 * Usage:
 *   node tools/deploy-replays.js              — sync all replays to R2
 *   node tools/deploy-replays.js --dry-run    — preview transfers without uploading
 *   node tools/deploy-replays.js --replay=ID  — sync a single replay
 *   node tools/deploy-replays.js --manifest   — sync only replays referenced by builds-manifest.json
 *   node tools/deploy-replays.js --force      — re-upload even if size+mtime match
 *
 * Requires: rclone configured with an `r2` remote pointing at the
 * Cloudflare R2 endpoint that owns `wc3v-cdn`. (Check `rclone listremotes`.)
 *
 * Notes:
 *   - We use `rclone copy`, not `sync` — never deletes anything in R2 even
 *     if it's missing locally. Replays are write-once-ish; deletion should
 *     be a deliberate manual step, not a side effect of this script.
 *   - Every upload sets Cache-Control: public, max-age=300, must-revalidate.
 *     5 minutes is short enough that a viewer reload after a fresh deploy
 *     gets the new data, and ETag/304 keeps revalidation cheap.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const REMOTE = 'r2:wc3v-cdn/replays';
const LOCAL_DIR = path.join(__dirname, '..', 'client', 'replays');
const MANIFEST_PATH = path.join(__dirname, '..', 'client', 'data', 'builds-manifest.json');
const CACHE_CONTROL = 'public, max-age=300, must-revalidate';

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

const isDryRun = !!args['dry-run'];
const singleReplay = args.replay && args.replay !== true ? args.replay : null;
const manifestOnly = !!args.manifest;
const isForce = !!args.force;

// Sanity: rclone exists and the r2 remote is configured.
function checkRclone () {
  const which = spawnSync('rclone', ['version'], { encoding: 'utf8' });
  if (which.status !== 0) {
    console.error('rclone not found in PATH. Install it and run `rclone config` to set up the `r2` remote.');
    process.exit(1);
  }
  const remotes = spawnSync('rclone', ['listremotes'], { encoding: 'utf8' });
  if (!remotes.stdout || !remotes.stdout.split('\n').includes('r2:')) {
    console.error('rclone has no `r2:` remote configured. Run `rclone config` and add a Cloudflare R2 S3 remote named `r2`.');
    process.exit(1);
  }
}

function getManifestReplayIds () {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  const ids = new Set();
  for (const build of manifest.builds || []) {
    for (const r of build.replays || []) {
      if (r.replayId) ids.add(r.replayId);
    }
  }
  return ids;
}

// Resolve which replay base-names (no extension) to deploy.
function selectReplayIds () {
  const onDisk = fs.readdirSync(LOCAL_DIR)
    .filter(f => f.endsWith('.wc3v.gz'))
    .map(f => f.slice(0, -'.wc3v.gz'.length));
  const onDiskSet = new Set(onDisk);

  if (singleReplay) {
    if (!onDiskSet.has(singleReplay)) {
      console.error(`No local file: ${path.join(LOCAL_DIR, singleReplay + '.wc3v.gz')}`);
      process.exit(1);
    }
    return [singleReplay];
  }
  if (manifestOnly) {
    const ids = getManifestReplayIds();
    if (!ids.size) {
      console.error('Manifest had no replay IDs. Aborting.');
      process.exit(1);
    }
    const selected = [...ids].filter(id => onDiskSet.has(id));
    const missing = [...ids].filter(id => !onDiskSet.has(id));
    console.log(`Manifest filter: ${selected.length}/${ids.size} replay(s) present locally`);
    if (missing.length) console.log(`  (not on disk, skipped: ${missing.join(', ')})`);
    return selected;
  }
  return onDisk;
}

function main () {
  checkRclone();

  if (!fs.existsSync(LOCAL_DIR)) {
    console.error(`Local replays directory not found: ${LOCAL_DIR}`);
    process.exit(1);
  }

  const ids = selectReplayIds();
  if (!ids.length) {
    console.error('No replays selected to deploy.');
    process.exit(1);
  }

  console.log(`Selected: ${ids.length} replay(s)`);
  console.log(`Remote: ${REMOTE}`);
  if (isDryRun) console.log('(dry run — no upload)');

  // Decompress each .wc3v.gz into a temp staging dir as .wc3v — that uncompressed
  // object is what the CDN serves. Staging is removed in the finally block.
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'wc3v-deploy-'));
  let exitCode = 0;
  try {
    console.log(`\nDecompressing ${ids.length} file(s) to staging…`);
    let done = 0;
    for (const id of ids) {
      const gz = path.join(LOCAL_DIR, `${id}.wc3v.gz`);
      const out = path.join(staging, `${id}.wc3v`);
      fs.writeFileSync(out, zlib.gunzipSync(fs.readFileSync(gz)));
      done++;
      if (done % 50 === 0 || done === ids.length) {
        console.log(`  ${done}/${ids.length}`);
      }
    }

    const cmd = [
      'copy',
      staging,
      REMOTE,
      '--include', '*.wc3v',
      '--header-upload', `Cache-Control: ${CACHE_CONTROL}`,
      '--progress',
      '--stats-one-line',
      '--stats=2s',
      '--transfers=8',
      '--checkers=16'
    ];
    if (isDryRun) cmd.push('--dry-run');
    // Staged files always have a fresh mtime, so rclone re-uploads them by
    // default; --ignore-times is only needed to also refresh metadata
    // (Cache-Control) on bytes-identical objects.
    if (isForce) cmd.push('--ignore-times');

    console.log(`\n+ rclone ${cmd.join(' ')}\n`);

    const res = spawnSync('rclone', cmd, { stdio: 'inherit' });
    if (res.status !== 0) {
      console.error(`\nrclone exited with status ${res.status}`);
      exitCode = res.status || 1;
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }

  if (exitCode !== 0) process.exit(exitCode);
  console.log(`\nDeploy complete${isDryRun ? ' (dry run)' : ''}.`);
}

main();
