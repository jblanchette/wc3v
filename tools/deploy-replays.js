/**
 * deploy-replays.js — Sync parsed replays to R2 (cdn.wc3v.com).
 *
 * The static site on Render only serves HTML/JS/CSS. Anything under
 * /replays/* gets a 301 redirect to https://cdn.wc3v.com/replays/* (see
 * render.yaml), which is backed by the Cloudflare R2 bucket `wc3v-cdn`.
 * That means after `node tools/reparse-builds.js` regenerates local
 * .wc3v.gz files, viewers see no change until those files are uploaded
 * to R2. This script is the upload step.
 *
 * Usage:
 *   node tools/deploy-replays.js              — sync all .wc3v.gz to R2
 *   node tools/deploy-replays.js --dry-run    — preview transfers without uploading
 *   node tools/deploy-replays.js --replay=ID  — sync a single replay (.wc3v.gz)
 *   node tools/deploy-replays.js --manifest   — sync only replays referenced by builds-manifest.json
 *
 * Requires: rclone configured with an `r2` remote pointing at the
 * Cloudflare R2 endpoint that owns `wc3v-cdn`. (Check `rclone listremotes`.)
 *
 * Notes:
 *   - We use `rclone copy`, not `sync` — never deletes anything in R2 even
 *     if it's missing locally. Replays are write-once-ish; deletion should
 *     be a deliberate manual step, not a side effect of this script.
 *   - Only *.wc3v.gz is uploaded. Uncompressed *.wc3v debug files stay local.
 *   - rclone skips files whose size+mtime already match the destination, so
 *     re-running after a partial reparse only uploads the changed files.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REMOTE = 'r2:wc3v-cdn/replays';
const LOCAL_DIR = path.join(__dirname, '..', 'client', 'replays');
const MANIFEST_PATH = path.join(__dirname, '..', 'client', 'data', 'builds-manifest.json');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

const isDryRun = !!args['dry-run'];
const singleReplay = args.replay && args.replay !== true ? args.replay : null;
const manifestOnly = !!args.manifest;

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

function buildIncludeArgs () {
  if (singleReplay) {
    return ['--include', `${singleReplay}.wc3v.gz`];
  }
  if (manifestOnly) {
    const ids = getManifestReplayIds();
    if (!ids.size) {
      console.error('Manifest had no replay IDs. Aborting.');
      process.exit(1);
    }
    const includeArgs = [];
    for (const id of ids) {
      includeArgs.push('--include', `${id}.wc3v.gz`);
    }
    console.log(`Manifest filter: ${ids.size} replay(s) selected`);
    return includeArgs;
  }
  return ['--include', '*.wc3v.gz'];
}

function main () {
  checkRclone();

  if (!fs.existsSync(LOCAL_DIR)) {
    console.error(`Local replays directory not found: ${LOCAL_DIR}`);
    process.exit(1);
  }

  const localCount = fs.readdirSync(LOCAL_DIR).filter(f => f.endsWith('.wc3v.gz')).length;
  console.log(`Local: ${localCount} .wc3v.gz file(s) in ${LOCAL_DIR}`);
  console.log(`Remote: ${REMOTE}`);
  if (isDryRun) console.log('(dry run — no upload)');

  const cmd = [
    'copy',
    LOCAL_DIR,
    REMOTE,
    ...buildIncludeArgs(),
    '--progress',
    '--stats-one-line',
    '--stats=2s',
    '--transfers=8',
    '--checkers=16'
  ];
  if (isDryRun) cmd.push('--dry-run');

  console.log(`\n+ rclone ${cmd.join(' ')}\n`);

  const res = spawnSync('rclone', cmd, { stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`\nrclone exited with status ${res.status}`);
    process.exit(res.status || 1);
  }
  console.log(`\nDeploy complete${isDryRun ? ' (dry run)' : ''}.`);
}

main();
