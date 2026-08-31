/**
 * test-corpus-slim.js — the corpus projection must be lossless for everything
 * that reads a corpus entry.
 *
 * store.js keeps a SLIM copy of each summary in memory and re-reads the whole
 * game from disk when a report opens. That trade is only safe while the slim
 * shape still answers every question asked above the report, and the two
 * things doing the asking are GameMetrics.forSeat (every scalar the feed, the
 * grade rail and the compare rows show) and ProfileAggregate.gameView (what
 * Coach aggregates over).
 *
 * So both are run twice per stored game, once over the full summary and once
 * over the slim one, and the results must be identical. A field quietly
 * dropped from KEEP_PLAYER shows up here as a changed scalar rather than as a
 * blank column somebody notices months later.
 *
 * Reads the real parse store when there is one, and falls back to
 * client/replays/*.wc3v.gz otherwise, so it works on a machine that has never
 * run the desktop app.
 *
 * Usage:
 *   node tools/test-corpus-slim.js
 *   node tools/test-corpus-slim.js --limit=200
 *   node tools/test-corpus-slim.js --store=<dir>
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');

const args = {};
process.argv.slice(2).forEach((raw) => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});
const limit = Number(args.limit || 0);

// ── the modules under test, in their browser shape ───────────────────────
global.window = global.window || global;
require(path.join(ROOT, 'client/js/GameMetrics.js'));
require(path.join(ROOT, 'client/js/ProfileAggregate.js'));
const GameMetrics = global.window.GameMetrics || require(path.join(ROOT, 'client/js/GameMetrics.js'));
const ProfileAggregate = global.window.ProfileAggregate;

// ── the projection, lifted out of store.js ───────────────────────────────
// store.js is an IIFE built around Tauri's invoke and DecompressionStream, so
// it cannot be required here. The projection is read out of the source and
// evaluated, which keeps this test honest: it exercises the shipped text, and
// a rename or an edit to KEEP_PLAYER is picked up automatically rather than
// being duplicated into this file and left to drift.
const storeSrc = fs.readFileSync(path.join(ROOT, 'desktop/src-frontend/js/store.js'), 'utf8');
const grab = (startMarker, endMarker) => {
  const a = storeSrc.indexOf(startMarker);
  const b = storeSrc.indexOf(endMarker, a);
  if (a === -1 || b === -1) throw new Error('could not find ' + startMarker + ' in store.js');
  return storeSrc.slice(a, b);
};
const projectionSrc = grab('const KEEP_PLAYER = [', 'const persistSummary');
// eslint-disable-next-line no-new-func
const slimForCorpus = new Function(projectionSrc + '\nreturn slimForCorpus;')();

// ── the corpus to test against ───────────────────────────────────────────
const storeDir = args.store ||
  path.join(os.homedir(), 'AppData', 'Roaming', 'com.wc3v.desktop', 'replays');

let load;
let names;
if (fs.existsSync(storeDir)) {
  names = fs.readdirSync(storeDir).filter((f) => f.endsWith('.summary.json.gz'));
  load = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(storeDir, f))).toString('utf8'));
  console.log('corpus: ' + names.length + ' summaries from the parse store');
} else {
  const dir = path.join(ROOT, 'client', 'replays');
  names = fs.readdirSync(dir).filter((f) => f.endsWith('.wc3v.gz'));
  load = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString('utf8'));
  console.log('corpus: ' + names.length + ' exports from client/replays (no parse store on this machine)');
}
if (limit) names = names.slice(0, limit);

// ── compare ──────────────────────────────────────────────────────────────
const failures = [];
let games = 0;
let seats = 0;
let profiles = 0;
let fullBytes = 0;
let slimBytes = 0;

const j = (v) => JSON.stringify(v === undefined ? null : v);

for (const f of names) {
  let full;
  try { full = load(f); } catch (e) { continue; }
  if (!full || !full.players || !Object.keys(full.players).length) continue;

  const slim = slimForCorpus(full);
  games++;
  fullBytes += JSON.stringify(full).length;
  slimBytes += JSON.stringify(slim).length;

  for (const slot of Object.keys(full.players)) {
    seats++;
    const a = GameMetrics.forSeat(full, slot);
    const b = GameMetrics.forSeat(slim, slot);
    if (j(a) !== j(b)) {
      failures.push({ game: f, slot, what: 'GameMetrics.forSeat', full: j(a).slice(0, 200), slim: j(b).slice(0, 200) });
      continue;
    }

    // Coach, over a one-game corpus for this seat's name.
    const name = (full.players[slot] || {}).name;
    if (!name) continue;
    profiles++;
    const pa = ProfileAggregate.buildProfile([full], name);
    const pb = ProfileAggregate.buildProfile([slim], name);
    if (j(pa) !== j(pb)) {
      failures.push({ game: f, slot, what: 'ProfileAggregate.buildProfile for ' + name, full: '', slim: '' });
    }
  }
}

const mb = (b) => (b / 1024 / 1024).toFixed(1) + ' MB';
console.log('checked ' + games + ' games, ' + seats + ' seats, ' + profiles + ' profiles');
console.log('  JSON size  full ' + mb(fullBytes) + '  slim ' + mb(slimBytes) +
            '   (' + Math.round((1 - slimBytes / fullBytes) * 100) + '% smaller)');

if (!failures.length) {
  console.log('corpus-slim: identical on every seat and every profile');
  process.exit(0);
}

console.log('\ncorpus-slim: ' + failures.length + ' MISMATCH(es)');
for (const f of failures.slice(0, 10)) {
  console.log('\n  ' + f.what + '  slot ' + f.slot + '  ' + f.game);
  if (f.full) {
    console.log('    full: ' + f.full);
    console.log('    slim: ' + f.slim);
  }
}
process.exit(1);
