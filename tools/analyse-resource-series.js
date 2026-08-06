/**
 * analyse-resource-series.js — is the Resources chart mostly empty?
 *
 * The desktop draws three stacked plots from `player.resourceSeries`: food used
 * (against the cap), gold lost and lumber lost. The complaint is that they read
 * as skinny wide strips with a bad axis, and that nothing happens for the first
 * chunk of every game.
 *
 * "Nothing happens" is measurable, so measure it before redesigning anything:
 *
 *   dead head   how far into the game the series is still at its opening value
 *   shape       how much of the y-range the series actually uses
 *   spread      whether the two players ever differ enough to be worth two lines
 *
 * Gold and lumber lost are CUMULATIVE, so they are flat 0 until the first thing
 * dies and monotonically non-decreasing after. Food is a real curve.
 *
 * Usage:
 *   node tools/analyse-resource-series.js
 *   node tools/analyse-resource-series.js --games=80
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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

const fmt = (ms) => {
  const t = Math.round(ms / 1000);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const pct = (n) => `${(n * 100).toFixed(0)}%`;

// The first sample index whose value differs from the opening value.
const firstMove = (series, key) => {
  const base = series[0][key] || 0;
  for (let i = 0; i < series.length; i++) {
    if ((series[i][key] || 0) !== base) return i;
  }
  return -1;
};

const SERIES = [
  { key: 'foodUsed', label: 'food used' },
  { key: 'goldLost', label: 'gold lost' },
  { key: 'lumberLost', label: 'lumber lost' }
];

const agg = {};
for (const s of SERIES) agg[s.key] = { deadFracs: [], finals: [], spreads: [] };
let games = 0;

for (const file of files) {
  let out;
  try {
    out = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(REPLAY_DIR, file))).toString());
  } catch (e) { continue; }

  const seats = Object.keys(out.players || {})
    .map(slot => out.players[slot])
    .filter(p => p && p.resourceSeries && p.resourceSeries.length > 2);
  if (seats.length < 2) continue;
  games++;

  const endT = seats[0].resourceSeries[seats[0].resourceSeries.length - 1].t || 1;

  for (const s of SERIES) {
    // Dead head across BOTH seats: the chart is shared, so it is only dead
    // while nobody has moved.
    const firsts = seats.map(p => firstMove(p.resourceSeries, s.key));
    const anyMoved = firsts.filter(i => i >= 0);
    const deadIdx = anyMoved.length ? Math.min(...anyMoved) : -1;
    const deadT = deadIdx < 0 ? endT : seats[0].resourceSeries[deadIdx].t;
    agg[s.key].deadFracs.push(deadT / endT);

    const finals = seats.map(p => p.resourceSeries[p.resourceSeries.length - 1][s.key] || 0);
    agg[s.key].finals.push(Math.max(...finals));
    const peak = Math.max(...finals, 1);
    agg[s.key].spreads.push(Math.abs(finals[0] - finals[1]) / peak);
  }
}

const median = (a) => {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

console.log('');
console.log(`${games} games with a resource series on both seats.`);
console.log('');
console.log('  series          dead head (median)   worst      final value (median)   two lines differ by');
for (const s of SERIES) {
  const a = agg[s.key];
  console.log(
    `  ${s.label.padEnd(14)}  ${pct(median(a.deadFracs)).padStart(10)}` +
    `${pct(Math.max(...a.deadFracs)).padStart(13)}` +
    `${String(median(a.finals)).padStart(21)}` +
    `${pct(median(a.spreads)).padStart(22)}`
  );
}
console.log('');
console.log('  dead head = fraction of the x-axis where NEITHER player has moved off');
console.log('              the opening value, so the plot is a flat line.');
console.log('');
