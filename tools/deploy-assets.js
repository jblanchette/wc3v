/**
 * deploy-assets.js — Sync static game assets + map caches to R2 (cdn.wc3v.com).
 *
 * Companion to tools/deploy-replays.js. The Render static site 301-redirects
 * /assets/* and /maps/* to https://cdn.wc3v.com/... (Cloudflare R2 bucket
 * `wc3v-cdn`), so anything regenerated locally (icons, GLB models, terrain
 * textures, per-map JPG/JSON caches via tools/regen-maps.js etc.) only reaches
 * viewers after it's uploaded here.
 *
 * R2 bucket layout ("r2:wc3v-cdn/"):
 *   replays/   - parsed .wc3v.gz                    (deploy-replays.js)
 *   assets/    - wc3icons/, models/, textures/, terrain/   (this script)
 *   maps/      - <map>/{map,gridmap,terrain}.jpg, .json.gz caches, heights.bin.gz  (this script)
 *
 * Cache-Control strategy (set at upload time - R2 stores it as object metadata):
 *   - assets/models, assets/textures, assets/terrain, assets/wc3icons,
 *     per-map heights.bin.gz   ->  immutable, 1y. These never change for a
 *     given model / icon / map. A redesign would ship under a new path.
 *   - per-map .jpg and .json.gz caches   ->  must-revalidate, 1 day. These DO
 *     change when a map is re-imported (rare) - short enough that a re-import
 *     lands within a day, cheap to revalidate via ETag the rest of the time.
 *
 * Usage:
 *   node tools/deploy-assets.js                - sync everything
 *   node tools/deploy-assets.js --dry-run      - preview transfers, no upload
 *   node tools/deploy-assets.js --only=icons   - one group: icons|models|textures|terrain|maps-immutable|maps-mutable
 *   node tools/deploy-assets.js --force        - re-upload even if size+mtime match (use after changing Cache-Control)
 *
 * Requires: rclone with an `r2:` remote (same as deploy-replays.js).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CLIENT = path.join(ROOT, 'client');
const IMMUTABLE = 'public, max-age=31536000, immutable';
const MUTABLE_1D = 'public, max-age=86400, must-revalidate';

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});
const isDryRun = !!args['dry-run'];
const isForce = !!args.force;
const only = (args.only && args.only !== true) ? String(args.only) : null;

// Each group: a local dir, a remote prefix, an optional include filter, and a
// Cache-Control header. rclone copy (never sync) — uploads only, never deletes.
const GROUPS = [
  { name: 'icons',          localDir: path.join(CLIENT, 'assets/wc3icons'),  remote: 'r2:wc3v-cdn/assets/wc3icons',  include: null,                       cache: IMMUTABLE },
  { name: 'models',         localDir: path.join(CLIENT, 'assets/models'),    remote: 'r2:wc3v-cdn/assets/models',    include: null,                       cache: IMMUTABLE },
  { name: 'textures',       localDir: path.join(CLIENT, 'assets/textures'),  remote: 'r2:wc3v-cdn/assets/textures',  include: null,                       cache: IMMUTABLE },
  { name: 'terrain',        localDir: path.join(CLIENT, 'assets/terrain'),   remote: 'r2:wc3v-cdn/assets/terrain',   include: null,                       cache: IMMUTABLE },
  // Maps split into two passes over the same dir tree, by file kind.
  { name: 'maps-immutable', localDir: path.join(CLIENT, 'maps'),             remote: 'r2:wc3v-cdn/maps',             include: ['*/heights.bin.gz'],       cache: IMMUTABLE },
  { name: 'maps-mutable',   localDir: path.join(CLIENT, 'maps'),             remote: 'r2:wc3v-cdn/maps',             include: ['*/*.jpg', '*/*.json.gz'], cache: MUTABLE_1D }
];

function checkRclone () {
  const v = spawnSync('rclone', ['version'], { encoding: 'utf8' });
  if (v.status !== 0) {
    console.error('rclone not found in PATH. Install it and run `rclone config` to set up the `r2` remote.');
    process.exit(1);
  }
  const remotes = spawnSync('rclone', ['listremotes'], { encoding: 'utf8' });
  if (!remotes.stdout || !remotes.stdout.split('\n').includes('r2:')) {
    console.error('rclone has no `r2:` remote. Run `rclone config` and add a Cloudflare R2 S3 remote named `r2`.');
    process.exit(1);
  }
}

function runGroup (g) {
  if (!fs.existsSync(g.localDir)) {
    console.warn(`[${g.name}] local dir missing, skipping: ${g.localDir}`);
    return;
  }
  const cmd = ['copy', g.localDir, g.remote];
  for (const inc of (g.include || [])) cmd.push('--include', inc);
  cmd.push(
    '--header-upload', `Cache-Control: ${g.cache}`,
    '--progress', '--stats-one-line', '--stats=2s',
    '--transfers=16', '--checkers=32'
  );
  if (isDryRun) cmd.push('--dry-run');
  if (isForce) cmd.push('--ignore-times');
  console.log(`\n[${g.name}] Cache-Control: ${g.cache}`);
  console.log(`+ rclone ${cmd.join(' ')}`);
  const res = spawnSync('rclone', cmd, { stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`[${g.name}] rclone exited with status ${res.status}`);
    process.exit(res.status || 1);
  }
}

function main () {
  checkRclone();
  const groups = only ? GROUPS.filter(g => g.name === only) : GROUPS;
  if (!groups.length) {
    console.error(`Unknown --only=${only}. Valid: ${GROUPS.map(g => g.name).join(', ')}`);
    process.exit(1);
  }
  if (isDryRun) console.log('(dry run — no upload)');
  for (const g of groups) runGroup(g);
  console.log(`\nAsset deploy complete${isDryRun ? ' (dry run)' : ''}.`);
}

main();
