/**
 * test-compare-units.js — small unit-style checks for the compare engine.
 * Doesn't need a parsed replay or browser DOM — just exercises the pure
 * scoring functions in ReplayAnalyzer.js with handcrafted minimal inputs.
 */

const path = require('path');
const ReplayAnalyzer = require(path.join(__dirname, '..', 'client', 'js', 'ReplayAnalyzer.js'));

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('OK  ', msg);
}

// ---- prettyMap regex parity ----
assert(ReplayAnalyzer.prettyMap('Maps/W3Champions/5185_w3c_251104_0950_Hammerfall.w3x') === 'Hammerfall',
  'prettyMap strips W3C hash prefix');
assert(ReplayAnalyzer.prettyMap('w3c_250622_1057_Turtle_Rock_v1.6.w3x') === 'Turtle Rock',
  'prettyMap strips bare w3c prefix and version suffix');
assert(ReplayAnalyzer.prettyMap('1v1_Echo_Isles_v2.2_w3c_260125_1357_1051.w3x') === 'Echo Isles',
  'prettyMap strips trailing w3c suffix and 1v1 prefix');
assert(ReplayAnalyzer.prettyMap('(2)EchoIsles.w3x') === 'Echo Isles',
  'prettyMap strips player-count prefix and de-camelCases');

// ---- sameMap on cleaned + raw ----
assert(ReplayAnalyzer.sameMap('Hammerfall', 'Maps/W3Champions/5185_w3c_251104_0950_Hammerfall.w3x'),
  'sameMap matches clean vs raw');
assert(!ReplayAnalyzer.sameMap('Echo Isles', 'Maps/W3Champions/5185_w3c_251104_0950_Hammerfall.w3x'),
  'sameMap rejects different maps');

// ---- Symmetric duration guard ----
const baseSummary = (durationMs, supplyU = 30, workersU = 15, race = 'U') => ({
  map: 'Hammerfall', mapRaw: 'Hammerfall', durationMs,
  players: {
    '1': {
      name: 'You', race,
      tier2Time: 180_000, tier3Time: null,
      firstHeroLevel2Time: 240_000, firstHeroLevel3Time: null,
      expansionTime: null, archetype: '1-base-t2',
      economyTrack: [
        { gameTimeMs: 30_000,  supplyUsed: supplyU,     totalWorkers: workersU },
        { gameTimeMs: 60_000,  supplyUsed: supplyU + 5, totalWorkers: workersU + 2 },
        { gameTimeMs: 90_000,  supplyUsed: supplyU + 8, totalWorkers: workersU + 4 }
      ],
      buildPreview: [
        { type: 'unit', name: 'Ghoul', itemId: 'ugho', gameTimeMs: 60_000 },
        { type: 'unit', name: 'Ghoul', itemId: 'ugho', gameTimeMs: 80_000 }
      ]
    },
    '2': { name: 'Pro', race, archetype: '1-base-t2', economyTrack: [], buildPreview: [] }
  }
});

const userShort = baseSummary(6 * 60_000);
const proLong   = baseSummary(13 * 60_000);
const userLong  = baseSummary(27 * 60_000);
const userMatch = baseSummary(13 * 60_000);

const longVsShort = ReplayAnalyzer.compare({
  userSummary: userLong, userSlot: '1',
  proSummary: proLong,  proSlot: '2'
});
// 27min vs 13min = 0.48 ratio — should fail durationOk now.
assert(longVsShort.overall.grade === 'N/A' || longVsShort.warnings.some(w => /shorter/.test(w) || /Game ended/.test(w)),
  'symmetric duration guard catches 27 vs 13 min mismatch');

const matchedDurations = ReplayAnalyzer.compare({
  userSummary: userMatch, userSlot: '1',
  proSummary: proLong,    proSlot: '2'
});
assert(matchedDurations.guards.durationOk === true,
  'durationOk passes when both replays are the same length');

// ---- Self-match-style: identical summaries should yield 100/100. ----
const u = baseSummary(13 * 60_000);
const fakeProSelf = JSON.parse(JSON.stringify(u));
const same = ReplayAnalyzer.compare({
  userSummary: u, userSlot: '1',
  proSummary: fakeProSelf, proSlot: '1'
});
// Macro/Tech/Build Adherence/Production should all be high (close to 100).
console.log('Self-similar score:', same.overall.score, same.overall.grade,
  'macro=', same.categories.macro.score,
  'tech=', same.categories.tech.score,
  'buildAdherence=', same.categories.buildAdherence.score,
  'production=', same.categories.production.score);
assert(same.overall.score >= 95, 'self-similar replays score >= 95 via analyzer');

console.log('\nAll unit checks passed.');
