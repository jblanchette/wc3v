/**
 * measure-summary-v4.js — what schema v4 costs a stored summary.
 *
 * The desktop keeps one gzipped summary per game and nothing else (ROADMAP
 * §1), so every field added to it is paid for thousands of times over. v4 adds
 * the dominance and resource time series, which are by far the largest things
 * in the file, and "a few KB" was the retention decision the whole design rests
 * on. This measures whether that still holds rather than assuming it.
 *
 * Also reports dominance availability across the corpus, which is the honest
 * answer to "how often will the gauge actually appear".
 *
 * Usage:
 *   node tools/measure-summary-v4.js
 *   node tools/measure-summary-v4.js --games=60
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SummaryExtract = require('../client/js/SummaryExtract');
const MomentsExtract = require('../client/js/MomentsExtract');
const SeriesExtract = require('../client/js/SeriesExtract');

const ROOT = path.resolve(__dirname, '..');
const REPLAY_DIR = path.join(ROOT, 'client', 'replays');

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
}

const wanted = parseInt(args.games, 10) || 40;
const files = fs.readdirSync(REPLAY_DIR)
  .filter(f => f.endsWith('.wc3v.gz'))
  .slice(0, wanted);

const gz = (o) => zlib.gzipSync(JSON.stringify(o)).length;
const kb = (n) => (n / 1024).toFixed(1);

let v3Total = 0;
let v4Total = 0;
let domAvailable = 0;
let resAvailable = 0;
let worstDelta = { file: null, delta: 0 };
const rows = [];

for (const file of files) {
  const out = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(REPLAY_DIR, file))));
  const durationMs = (out.replay && out.replay.subheader && out.replay.subheader.replayLengthMS) || 0;
  const worldNeutralGroups = (out.world && out.world.neutralGroups) || null;

  const base = {
    key: 'x', schemaVersion: 4, savedAt: 0, playedAt: 0,
    gameMode: out.gameMode || null, winner: out.winner || null, durationMs,
    neutralCamps: SummaryExtract.extractNeutralCamps(worldNeutralGroups),
    moments: MomentsExtract.extractMoments(out),
    players: {}
  };
  const combat = MomentsExtract.extractCombat(out);
  for (const slot of Object.keys(out.players || {})) {
    const pd = out.players[slot];
    const rpd = out.replay && out.replay.players && out.replay.players[slot];
    if (!pd || !rpd || pd.isNeutralPlayer) continue;
    if (rpd.teamId >= 1000) continue;
    base.players[slot] = SummaryExtract.extractPlayerSummary(pd, rpd, durationMs, worldNeutralGroups);
    base.players[slot].teamId = rpd.teamId;
    base.players[slot].combat = combat[slot] || null;
  }

  const dominance = SeriesExtract.extractDominance(out);
  const resources = SeriesExtract.extractResources(out);
  const v4 = Object.assign({}, base, { dominance, resources });

  const a = gz(base);
  const b = gz(v4);
  v3Total += a;
  v4Total += b;
  if (dominance) domAvailable++;
  if (resources) resAvailable++;
  if (b - a > worstDelta.delta) worstDelta = { file, delta: b - a };

  rows.push({ file, a, b, dom: !!dominance, res: !!resources });
}

rows.sort((x, y) => (y.b - y.a) - (x.b - x.a));

console.log('');
console.log(`Measured ${files.length} replays from client/replays.`);
console.log('');
console.log('Largest v4 additions (gzipped):');
for (const r of rows.slice(0, 8)) {
  console.log(`  ${(kb(r.b - r.a) + ' KB').padStart(9)}  ` +
    `${kb(r.a)} → ${kb(r.b)} KB  ` +
    `${r.dom ? 'dom' : '   '} ${r.res ? 'res' : '   '}  ${r.file}`);
}
console.log('');
console.log(`  v3 mean:   ${kb(v3Total / files.length)} KB`);
console.log(`  v4 mean:   ${kb(v4Total / files.length)} KB`);
console.log(`  added:     ${kb((v4Total - v3Total) / files.length)} KB per game ` +
  `(+${Math.round(((v4Total / v3Total) - 1) * 100)}%)`);
console.log(`  worst:     +${kb(worstDelta.delta)} KB (${worstDelta.file})`);
console.log('');
console.log(`  dominance available: ${domAvailable}/${files.length} ` +
  `(${Math.round((domAvailable / files.length) * 100)}%)`);
console.log(`  resources available: ${resAvailable}/${files.length} ` +
  `(${Math.round((resAvailable / files.length) * 100)}%)`);
console.log('');
console.log(`  3,072 games at the v4 mean: ${(v4Total / files.length * 3072 / 1024 / 1024).toFixed(0)} MB`);
console.log('');
