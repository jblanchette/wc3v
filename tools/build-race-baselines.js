#!/usr/bin/env node
/**
 * build-race-baselines.js — the shipped "how the race is played" sample.
 *
 * The desktop compares a game three ways: the number itself, the gap to your
 * own recent games, and the gap to the race. The first two come out of your own
 * history. The third cannot, until you have one: a fresh install knows nothing
 * about Orc, and a column reading "—" on the day somebody opens the app for the
 * first time is the column doing nothing.
 *
 * So there is a fallback, generated here from the repo's own replay corpus and
 * committed. ProfileAggregate.raceBaseline takes over as soon as the local
 * history has MIN_RACE_N seats of a race, and the UI always says which of the
 * two it is showing. A shipped number is never presented as if it came from the
 * user's own games.
 *
 * Reads client/replays/*.wc3v.gz, which are already-parsed outputs, so this does
 * not run the parser. Games with no dominance block still contribute their APM
 * and hero kills: the sample sizes are per metric for exactly that reason.
 *
 *   node tools/build-race-baselines.js
 *   node tools/build-race-baselines.js --out=path.json --verbose
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

require('../client/js/SummaryExtract');
require('../client/js/MomentsExtract');
require('../client/js/SeriesExtract');
const SummaryBuild = require('../client/js/SummaryBuild');
const GameMetrics = require('../client/js/GameMetrics');

const ROOT = path.resolve(__dirname, '..');
const REPLAY_DIR = path.join(ROOT, 'client', 'replays');
// A generated .js file rather than a .json one fetched at boot, the same shape
// tools/build-item-classes.js writes. Three reasons, all found the hard way:
// the preview harness runs from file:// where fetch is blocked outright, an
// async load means the first report can render before the table arrives, and a
// 3 KB table does not need a network request to reach a local page.
const DEFAULT_OUT = path.join(ROOT, 'desktop', 'src-frontend', 'js', 'race-baseline-data.js');

const args = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
}

const RACES = ['H', 'O', 'E', 'U'];
const RACE_NAME = { H: 'Human', O: 'Orc', E: 'Night Elf', U: 'Undead' };

// The three the report compares, plus the timings a later screen may want. Each
// is collected independently so one missing block does not cost the others.
const KEYS = ['dominanceAvg', 'apmEffective', 'heroKills', 't2', 'expansion', 'workersAt5m'];

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// Quartiles as well as the median, because a median alone cannot say whether a
// player is unusual or merely not average. Nothing renders them yet; they cost
// nothing to carry and re-running this over a corpus is the expensive part.
const quartile = (xs, q) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
};

const round1 = (x) => (x === null ? null : Math.round(x * 10) / 10);

if (!fs.existsSync(REPLAY_DIR)) {
  console.error(`No replay corpus at ${path.relative(ROOT, REPLAY_DIR)}`);
  process.exit(1);
}

const files = fs.readdirSync(REPLAY_DIR).filter(f => f.endsWith('.wc3v.gz')).sort();
if (!files.length) {
  console.error(`No .wc3v.gz files in ${path.relative(ROOT, REPLAY_DIR)}`);
  process.exit(1);
}

const samples = {};
for (const r of RACES) {
  samples[r] = {};
  for (const k of KEYS) samples[r][k] = [];
}

let games = 0;
let seats = 0;
let skippedMode = 0;
let derivedOther = 0;
let failed = 0;

for (const file of files) {
  let out;
  try {
    out = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(REPLAY_DIR, file))));
  } catch (err) {
    failed++;
    if (args.verbose) console.error(`  skip ${file}: ${err.message}`);
    continue;
  }

  let summary;
  try {
    summary = SummaryBuild.buildSummary(out, file, null);
  } catch (err) {
    failed++;
    if (args.verbose) console.error(`  skip ${file}: ${err.message}`);
    continue;
  }

  // 132 of the 334 replays in this corpus were parsed before computeGameMode
  // existed and carry no gameMode at all, which silently threw away 40% of the
  // sample. Two seats on two teams is the 1v1 branch of computeGameMode, and
  // SummaryBuild has already dropped neutrals and AI, so this is the same test
  // on the same inputs rather than a looser guess.
  if (!summary.gameMode) {
    const slots = Object.keys(summary.players);
    const teams = new Set(slots.map(s => summary.players[s].teamId));
    if (slots.length === 2 && teams.size === 2) summary.gameMode = '1v1';
    else { derivedOther++; }
  }

  // 1v1 only. Dominance is a share of 100 split across every seat in the game,
  // so a 3v3 seat is not the same measurement and averaging the two together
  // would drag every race toward a number no duel can produce.
  if (summary.gameMode !== '1v1') { skippedMode++; continue; }
  games++;

  for (const slot of Object.keys(summary.players)) {
    const race = summary.players[slot].race;
    if (!samples[race]) continue;   // Random resolves to a real race; anything else is not a race
    const m = GameMetrics.forSeat(summary, slot);
    if (!m) continue;
    seats++;
    for (const k of KEYS) {
      if (m[k] !== null && m[k] !== undefined) samples[race][k].push(m[k]);
    }
  }
}

const races = {};
for (const r of RACES) {
  const stat = (k) => {
    const xs = samples[r][k];
    return {
      median: round1(median(xs)),
      p25: round1(quartile(xs, 0.25)),
      p75: round1(quartile(xs, 0.75)),
      n: xs.length
    };
  };
  const entry = { seats: samples[r].apmEffective.length };
  for (const k of KEYS) entry[k] = stat(k);
  races[r] = entry;
}

const payload = {
  // A shipped sample has to say where it came from, so nobody has to guess
  // whether it is the user's history or the repo's.
  source: 'baked',
  label: 'ladder sample',
  corpus: 'client/replays',
  games,
  seats,
  generatedBy: 'tools/build-race-baselines.js',
  races
};

const outPath = args.out ? path.resolve(ROOT, args.out) : DEFAULT_OUT;
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const file = `// GENERATED by tools/build-race-baselines.js — do not edit by hand.
//
// The cold-start half of the "vs the Orcs you have played" column. A fresh
// install has no history to compare against, and an empty column is a column
// doing nothing.
//
// This is a PROFESSIONAL sample: ${games} 1v1 games from the repo's own replay
// corpus, ${seats} seats. Effective APM runs several hundred here against a
// ladder player's double digits, which is why every surface that shows it must
// say where it came from. js/race-baselines.js resolves the local source first
// and only falls back to this, and RaceBaselines.label() names which was used.
//
// Regenerate with: node tools/build-race-baselines.js

(function () {
  'use strict';
  window.RaceBaselineData = ${JSON.stringify(payload, null, 2)};
})();
`;
fs.writeFileSync(outPath, file);

console.log(`replays:   ${files.length} read, ${games} 1v1, ${skippedMode} other modes, ${failed} unreadable`);
if (derivedOther) console.log(`           ${derivedOther} had no gameMode and were not two seats on two teams`);
console.log(`seats:     ${seats}`);
for (const r of RACES) {
  const e = races[r];
  const cell = (k) => (e[k].median === null ? '—' : `${e[k].median} (n=${e[k].n})`);
  console.log(`  ${RACE_NAME[r].padEnd(10)} dominance ${cell('dominanceAvg').padEnd(16)} ` +
    `apm ${cell('apmEffective').padEnd(16)} hero kills ${cell('heroKills')}`);
}
console.log(`wrote:     ${path.relative(ROOT, outPath)} (${fs.statSync(outPath).size} bytes)`);

// A race with no dominance sample at all means the corpus predates the engine
// and the fallback column will be empty on a fresh install. Worth saying out
// loud rather than discovering it in the UI.
const noDom = RACES.filter(r => !races[r].dominanceAvg.n);
if (noDom.length) {
  console.log(`\nNOTE: no dominance samples for ${noDom.map(r => RACE_NAME[r]).join(', ')}.`);
  console.log('Re-parse client/replays with a build that carries DominanceSeries.');
}
