/**
 * moments-report.js — print the ranked "big moments" of a parsed replay.
 *
 * This is how MomentsExtract gets judged: run it on a game you remember and
 * read the list. If the fight you actually recall is not in it, the ranking is
 * wrong — not the UI built on top of it.
 *
 * Usage:
 *   node tools/moments-report.js --replay=NAME
 *   node tools/moments-report.js --replay=NAME --seat=2
 *   node tools/moments-report.js --replay=NAME --limit=40 --all
 *
 * Options:
 *   --replay=NAME   Looks in client/replays/NAME.wc3v(.gz), same as inspect-replay.js
 *   --seat=ID       Render the sentences from this player slot's point of view
 *   --limit=N       How many moments survive the cut (default 24)
 *   --all           Also list what was cut, so you can see what the ranking rejected
 *   --json          Emit the raw array instead of a table
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MomentsExtract = require('../client/js/MomentsExtract');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

if (!args.replay) {
  console.log('Usage: node tools/moments-report.js --replay=NAME [--seat=ID] [--limit=N] [--all] [--json]');
  process.exit(1);
}

const basePath = path.join(__dirname, '..', 'client', 'replays', args.replay);
let data;
try {
  if (fs.existsSync(`${basePath}.wc3v`)) {
    data = JSON.parse(fs.readFileSync(`${basePath}.wc3v`, 'utf8'));
  } else if (fs.existsSync(`${basePath}.wc3v.gz`)) {
    data = JSON.parse(zlib.gunzipSync(fs.readFileSync(`${basePath}.wc3v.gz`)).toString());
  } else {
    console.error(`Not found: ${basePath}.wc3v(.gz)`);
    process.exit(1);
  }
} catch (e) {
  console.error('Error loading replay:', e.message);
  process.exit(1);
}

const RACE = { O: 'Orc', H: 'Human', U: 'Undead', E: 'Night Elf', R: 'Random', N: 'Neutral' };
const slots = data.replay && data.replay.players ? data.replay.players : {};
const nameFor = (slot) => (slots[slot] && slots[slot].name) || `Player ${slot}`;

const limit = parseInt(args.limit, 10) || MomentsExtract.DEFAULT_LIMIT;
const seat = args.seat != null && args.seat !== true ? String(args.seat) : null;

// Battles are the whole point — say so loudly when a parse predates them
// rather than reporting a thin macro-only list as if it were the answer.
const battleCount = (data.battles || []).length;
const withLosses = (data.battles || []).filter(b => b.summary && b.summary.hasLosses).length;

console.log(`${args.replay}`);
console.log(`  map     ${(data.replay?.metadata?.map?.mapName || '?').split(/[\\/]/).pop()}`);
console.log(`  mode    ${data.gameMode || '?'}   winner: ${data.winner ? JSON.stringify(data.winner) : 'n/a'}`);
for (const slot of Object.keys(slots)) {
  console.log(`  slot ${slot}  ${nameFor(slot)} (${RACE[slots[slot].raceDetected] || slots[slot].raceDetected})` +
    (seat === slot ? '   <- seat' : ''));
}
console.log(`  battles ${battleCount} detected, ${withLosses} with losses`);
if (!battleCount) {
  console.log('  NOTE: no battles in this parse — fight moments are impossible.');
  console.log('        Re-parse with a current build before judging the ranking.');
}
console.log('');

const kept = MomentsExtract.extractMoments(data, { limit });

if (args.json) {
  console.log(JSON.stringify(kept, null, 2));
  process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`KEPT (${kept.length} of ${limit})`);
const row = (m) => `  ${pad(m.tf, 7)}${pad(m.importance, 5)}${pad(m.type, 17)}` +
  pad(m.swing ? `${m.swing}g` : '', 7) + MomentsExtract.phrase(m, seat, nameFor);

console.log(`  ${pad('time', 7)}${pad('imp', 5)}${pad('type', 17)}${pad('swing', 7)}sentence`);
for (const m of kept) console.log(row(m));

if (args.all) {
  // Re-run uncapped and diff, so "what got cut" is exactly what the cap dropped.
  const everything = MomentsExtract.extractMoments(data, { limit: 100000 });
  const keptKeys = new Set(kept.map(m => `${m.t}:${m.type}:${m.slot}`));
  const cut = everything.filter(m => !keptKeys.has(`${m.t}:${m.type}:${m.slot}`));
  console.log('');
  console.log(`CUT (${cut.length})`);
  for (const m of cut) console.log(row(m));
}
