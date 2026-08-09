/**
 * measure-summary-v5.js — what schema v5 costs a stored summary.
 *
 * Same question tools/measure-summary-v4.js asked, and for the same reason: the
 * desktop keeps one gzipped summary per game and nothing else (desktop/README.md
 * §1), so every field is paid for thousands of times over.
 *
 * v5 adds the per-player `build` block — what BuildOrderData derives from the
 * event stream (per-tier production and the closing snapshot) — and widens the
 * camp records the Creeps tab is drawn from. The block is stored rather than
 * re-derived so the desktop's report and the viewer's Match Summary read the
 * same numbers out of the same class instead of two extractors drifting apart.
 *
 * Three things BuildOrderData produces are deliberately NOT stored: `tiers` and
 * `snapshots` (by far the heaviest, and they serve the viewer's live panel) and
 * `production` (redundant with finalSnapshot.army). This measures the block that
 * IS, and validates that what the screen cannot be drawn without is actually in
 * it: unit counts with combat types, the closing economy, and hero skills.
 *
 * Usage:
 *   node tools/measure-summary-v5.js
 *   node tools/measure-summary-v5.js --games=60
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SummaryBuild = require('../client/js/SummaryBuild');
const BuildOrderData = require('../client/js/BuildOrderData');

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

// Strip the v5 additions back off a built summary, so the two sizes come from
// one code path rather than from a hand-maintained copy of the v4 builder that
// would quietly stop matching the real one.
//
// Two additions: the per-player `build` block, and the widened camp records
// (claim state, owner, route order, the creeps themselves and the hero XP)
// that the Creeps tab is drawn from. v4 kept only the four fields below.
const withoutV5 = (summary) => {
  const copy = Object.assign({}, summary, {
    schemaVersion: 4,
    players: {},
    neutralCamps: (summary.neutralCamps || []).map(c => ({
      groupId: c.groupId,
      totalLevel: c.totalLevel,
      bounds: c.bounds,
      hasFountain: c.hasFountain
    }))
  });
  for (const slot of Object.keys(summary.players)) {
    const p = Object.assign({}, summary.players[slot]);
    delete p.build;
    copy.players[slot] = p;
  }
  return copy;
};

let v4Total = 0;
let v5Total = 0;
let seats = 0;
let withBuild = 0;
// The three facts the screen cannot be drawn without.
let withTypedUnits = 0;   // finalSnapshot.army carrying attack/armor types
let withEconomy = 0;      // finalSnapshot.economy.goldSpent
let withHeroSkills = 0;   // tierProduction.heroes[].learnedSkills
let worstDelta = { file: null, delta: 0 };
// Camps, which the Creeps tab is drawn from.
let totalCamps = 0;
let gamesWithClaims = 0;
let gamesWithCreeps = 0;
let gamesWithCampXp = 0;
const rows = [];

for (const file of files) {
  const out = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(REPLAY_DIR, file))));
  const v5 = SummaryBuild.buildSummary(out, 'x', 0);
  const v4 = withoutV5(v5);

  const camps = v5.neutralCamps || [];
  if (camps.some(c => c.claimState === 2 && c.claimOwnerTeamId !== null)) gamesWithClaims++;
  if (camps.some(c => (c.units || []).length)) gamesWithCreeps++;
  if (camps.some(c => (c.heroXp || []).length)) gamesWithCampXp++;
  totalCamps += camps.length;

  const a = gz(v4);
  const b = gz(v5);
  v4Total += a;
  v5Total += b;
  if (b - a > worstDelta.delta) worstDelta = { file, delta: b - a };

  for (const slot of Object.keys(v5.players)) {
    seats++;
    const build = v5.players[slot].build;
    if (!build) continue;
    withBuild++;

    const units = (build.finalSnapshot && build.finalSnapshot.army) || [];
    if (units.some(u => u.count > 0 && (u.attackType || u.armorType))) withTypedUnits++;

    const eco = build.finalSnapshot && build.finalSnapshot.economy;
    if (eco && eco.goldSpent > 0) withEconomy++;

    const heroes = (build.tierProduction && build.tierProduction.heroes) || [];
    if (heroes.some(h => h.learnedSkills && Object.keys(h.learnedSkills).length)) withHeroSkills++;
  }

  rows.push({ file, a, b });
}

const pct = (n) => `${Math.round((n / seats) * 100)}%`;

console.log('');
console.log(`Measured ${files.length} replays from client/replays.`);
console.log(`SCHEMA_VERSION reported by SummaryBuild: ${SummaryBuild.SCHEMA_VERSION}`);
console.log(`BuildOrderData loaded in Node: ${typeof BuildOrderData === 'function' ? 'yes' : 'NO'}`);
console.log('');
console.log('Largest v5 additions (gzipped):');
rows.sort((x, y) => (y.b - y.a) - (x.b - x.a));
for (const r of rows.slice(0, 8)) {
  console.log(`  ${(kb(r.b - r.a) + ' KB').padStart(9)}  ` +
    `${kb(r.a)} → ${kb(r.b)} KB  ${r.file}`);
}
console.log('');
console.log(`  v4 mean:   ${kb(v4Total / files.length)} KB`);
console.log(`  v5 mean:   ${kb(v5Total / files.length)} KB`);
console.log(`  added:     ${kb((v5Total - v4Total) / files.length)} KB per game ` +
  `(+${Math.round(((v5Total / v4Total) - 1) * 100)}%)`);
console.log(`  worst:     +${kb(worstDelta.delta)} KB (${worstDelta.file})`);
console.log('');
console.log(`  seats measured:      ${seats}`);
console.log(`  build block present: ${withBuild} (${pct(withBuild)})`);
console.log(`  typed unit counts:   ${withTypedUnits} (${pct(withTypedUnits)})   Unit Roster + Damage Matchup`);
console.log(`  closing economy:     ${withEconomy} (${pct(withEconomy)})   Match Stats gold/lumber spent`);
console.log(`  hero skills:         ${withHeroSkills} (${pct(withHeroSkills)})   Overview hero spell grids`);
console.log('');
const gpct = (n) => `${Math.round((n / files.length) * 100)}%`;
console.log(`  camps stored:        ${totalCamps} (${(totalCamps / files.length).toFixed(1)} per game)`);
console.log(`  with a claim owner:  ${gamesWithClaims} games (${gpct(gamesWithClaims)})   Creep Route + Creep Score`);
console.log(`  with creep rosters:  ${gamesWithCreeps} games (${gpct(gamesWithCreeps)})   camp icons`);
console.log(`  with hero camp XP:   ${gamesWithCampXp} games (${gpct(gamesWithCampXp)})   Hero XP from Creeps`);
console.log('');
console.log(`  3,072 games at the v5 mean: ${(v5Total / files.length * 3072 / 1024 / 1024).toFixed(0)} MB`);
console.log('');
