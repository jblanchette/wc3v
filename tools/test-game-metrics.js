/**
 * test-game-metrics.js — assertions for client/js/GameMetrics.js and the
 * per-race baseline it feeds.
 *
 * Usage: node tools/test-game-metrics.js
 *
 * The dominance mean is the part worth testing hardest. The stored series is
 * not on a fixed grid, so a plain average of the samples is wrong by an amount
 * that grows with how eventful the game was, and nothing about the output looks
 * broken when it happens. Two of the cases below fail under a naive mean.
 */

const assert = require('node:assert');
const GM = require('../client/js/GameMetrics.js');
const PA = require('../client/js/ProfileAggregate.js');

const near = (actual, expected, tol, what) =>
  assert.ok(Math.abs(actual - expected) <= tol,
    `${what}: expected ~${expected}, got ${actual}`);

// ── A summary, shaped like the store writes one ─────────────────────────────

const seat = (over) => Object.assign({
  name: 'Me', race: 'O', teamId: 0,
  tier2Time: 300000, tier3Time: null,
  expansionTime: null, firstTowerTime: null,
  economyTrack: [
    { gameTimeMs: 240000, totalWorkers: 12 },
    { gameTimeMs: 270000, totalWorkers: 14 },
    { gameTimeMs: 300000, totalWorkers: 15 },
    { gameTimeMs: 330000, totalWorkers: 17 }
  ],
  apm: { rawAverage: 200, effectiveAverage: 160 },
  combat: { heroKills: [{ t: 1 }, { t: 2 }], heroDeaths: [{ t: 3 }], wipesFor: 0, wipesAgainst: 0 }
}, over || {});

const mkGame = (over) => Object.assign({
  key: 'k1',
  gameMode: '1v1',
  durationMs: 900000,
  players: { 1: seat(), 2: seat({ name: 'Them', race: 'H', teamId: 1 }) }
}, over || {});

// ── Dominance: time-weighted, not sample-weighted ───────────────────────────

// Ten minutes at 40, then a step to 90 held for one minute. The honest answer
// is close to 45. A plain mean over these four samples gives 65, because the
// pre/post pair around the step counts as much as the ten minutes before it.
const stepped = mkGame({
  dominance: {
    version: 3,
    players: {
      1: { t: [0, 600000, 600000, 660000], score: [40, 40, 90, 90], events: [] },
      2: { t: [0, 600000, 600000, 660000], score: [60, 60, 10, 10], events: [] }
    }
  }
});
const m1 = GM.forSeat(stepped, 1);
near(m1.dominanceAvg, 44.5, 0.6, 'dominanceAvg over a step');
assert.ok(m1.dominanceAvg < 50,
  'a player who was behind for ten of eleven minutes came out above even');
assert.strictEqual(m1.dominancePeak, 90);
near(m1.dominanceControl, 60 / 660, 0.01, 'time spent ahead');

// The two seats of a 1v1 must still sum to 100 after the weighting.
const m2 = GM.forSeat(stepped, 2);
near(m1.dominanceAvg + m2.dominanceAvg, 100, 0.2, 'the two seats no longer sum to 100');

// A crossing is interpolated, not rounded to whichever end got sampled. Even
// ramp from 0 to 100 over ten minutes: exactly half the game spent ahead.
const ramp = mkGame({
  dominance: { version: 3, players: { 1: { t: [0, 600000], score: [0, 100], events: [] } } }
});
near(GM.forSeat(ramp, 1).dominanceControl, 0.5, 0.01, 'crossing not interpolated');
near(GM.forSeat(ramp, 1).dominanceAvg, 50, 0.1, 'ramp mean');

// ── Dominance refuses where it means nothing ────────────────────────────────

// A team game splits 100 across every seat, so a 3v3 sits near 16 against an
// even line it can never reach. Refuse rather than report six losing players.
const team = mkGame({
  gameMode: '3v3',
  dominance: { version: 3, players: { 1: { t: [0, 600000], score: [16, 18], events: [] } } }
});
assert.strictEqual(GM.forSeat(team, 1).dominanceAvg, null, 'dominance reported for a team game');
assert.strictEqual(GM.dominanceUsable(team), false);

// A summary written before schema v4 has no block at all, which is not the same
// as a game where nobody led.
assert.strictEqual(GM.forSeat(mkGame(), 1).dominanceAvg, null, 'invented a dominance number');

// ── The rest of the seat ────────────────────────────────────────────────────

const m = GM.forSeat(mkGame(), 1);
assert.strictEqual(m.heroKills, 2);
assert.strictEqual(m.heroDeaths, 1);
assert.strictEqual(m.heroNet, 1);
assert.strictEqual(m.apmEffective, 160);
assert.strictEqual(m.t2, 300000);
assert.strictEqual(m.expansionMade, false);

// The last economy sample at or before 5:00, not the nearest and not the next.
assert.strictEqual(m.workersAt5m, 15, 'workersAt5m took the wrong sample');

// No combat block is null, never zero. A v2 summary saying "0 hero kills" is a
// claim about the game that nobody made.
const noCombat = mkGame({ players: { 1: seat({ combat: null }) } });
assert.strictEqual(GM.forSeat(noCombat, 1).heroKills, null, 'zeroed a missing combat block');
assert.strictEqual(GM.forSeat(mkGame(), 9), null, 'returned metrics for a seat that does not exist');

// ── Formatting: one sign convention, in one place ───────────────────────────

assert.strictEqual(GM.format('heroKills', null), '—');
assert.strictEqual(GM.formatDelta('heroKills', 2, null), '—');
assert.strictEqual(GM.formatDelta('heroKills', 2, 1), '+1');
// Medians of an even sample land on a half. Rounding that to +1 is a lie about
// a number the user can check.
assert.strictEqual(GM.formatDelta('heroKills', 2, 1.5), '+0.5');
assert.strictEqual(GM.formatDelta('apmEffective', 74, 111), '−37');
assert.strictEqual(GM.formatDelta('apmEffective', 74, 74), '0');

// APM is never banded: the number says how fast somebody's hands moved, and
// faster hands are not automatically better play.
assert.strictEqual(GM.band('apmEffective', 300, 100), null, 'APM was banded');
assert.strictEqual(GM.band('heroKills', 3, 1), 'good');
assert.strictEqual(GM.band('heroKills', 0, 1), 'poor');
assert.strictEqual(GM.band('heroKills', 1, null), null, 'banded against a missing baseline');

console.log('GameMetrics: all assertions passed');

// ── raceBaseline: the people you played, not you ────────────────────────────

const corpus = [];
for (let i = 0; i < 20; i++) {
  corpus.push({
    key: `g${i}`,
    gameMode: '1v1',
    playedAt: 1600000000000 + i * 86400000,
    durationMs: 900000,
    players: {
      // You are Orc and average 300 effective APM.
      1: seat({ name: 'Me', race: 'O', apm: { rawAverage: 380, effectiveAverage: 300 } }),
      // The Humans you face average 100.
      2: seat({ name: `Them${i}`, race: 'H', teamId: 1, apm: { rawAverage: 130, effectiveAverage: 100 } })
    }
  });
}

const human = PA.raceBaseline(corpus, 'H', { excludeName: 'Me' });
assert.ok(human, 'raceBaseline refused a 20-seat sample');
assert.strictEqual(human.source, 'local');
assert.strictEqual(human.seats, 20);
assert.strictEqual(human.apmEffective.median, 100);

// Your own seats must not be in your own benchmark. Without the exclusion an
// Orc baseline built from this corpus is 100% you, and the delta is always 0.
const orc = PA.raceBaseline(corpus, 'O', { excludeName: 'Me' });
assert.strictEqual(orc, null, 'the user\'s own seats were counted as the race sample');
const orcUnfiltered = PA.raceBaseline(corpus, 'O', {});
assert.strictEqual(orcUnfiltered.apmEffective.median, 300,
  'test corpus does not actually exercise the exclusion');

// Below MIN_RACE_N it refuses, so the caller falls back to the shipped sample
// rather than quoting a median of four.
const thin = PA.raceBaseline(corpus.slice(0, 5), 'H', { excludeName: 'Me' });
assert.strictEqual(thin, null, 'raceBaseline made a claim below MIN_RACE_N');

// The game being looked at is never inside its own benchmark.
const excluded = PA.raceBaseline(corpus, 'H', { excludeName: 'Me', excludeKey: 'g0' });
assert.strictEqual(excluded.seats, 19, 'excludeKey did not drop the reviewed game');

// A TEAM seat must never be measured against a 1v1 sample. The sample itself
// filters to 1v1, but the game under review can still be a 3v3, and the report
// rendered one at 102 APM as "−462.5" against the professional Orc median.
// Callers gate on gameMode; this asserts the sample they would reach is the
// 1v1 one, so the gate is the only thing standing between the two.
const teamSeat = GM.forSeat({
  gameMode: '3v3', durationMs: 900000,
  players: { 1: seat({ name: 'A', race: 'H', apm: { rawAverage: 120, effectiveAverage: 102 } }) }
}, 1);
assert.strictEqual(teamSeat.dominanceAvg, null, 'dominance survived a team game');
assert.strictEqual(teamSeat.apmEffective, 102, 'APM is mode-independent and should survive');

// Team seats are a different measurement and must not be averaged in.
const mixed = corpus.concat([{
  key: 'team1', gameMode: '3v3', durationMs: 900000,
  players: { 1: seat({ name: 'A', race: 'H', apm: { rawAverage: 9, effectiveAverage: 9 } }) }
}]);
assert.strictEqual(PA.raceBaseline(mixed, 'H', { excludeName: 'Me' }).seats, 20,
  'a team seat leaked into the 1v1 race baseline');

// gameView carries the comparison set through to the baseline and the trend.
const gv = PA.gameView(corpus[0], PA.normName('Me'));
assert.strictEqual(gv.heroKills, 2);
assert.strictEqual(gv.apmEffective, 300);
assert.strictEqual(gv.workersAt5m, 15);
const base = PA.baseline(corpus, 'Me', { excludeKey: 'g0' });
assert.strictEqual(base.heroKills.median, 2);
assert.strictEqual(base.apmEffective.median, 300);
assert.strictEqual(base.dominanceAvg.n, 0, 'claimed a dominance baseline with no series');

console.log('raceBaseline: all assertions passed');
