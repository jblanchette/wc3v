/**
 * test-profile-aggregate.js — synthetic-corpus sanity checks for
 * client/js/ProfileAggregate.js (the desktop profile/coach layer).
 *
 * Usage: node tools/test-profile-aggregate.js
 *
 * Builds 30 fake 1v1 summaries with known results and asserts the aggregate
 * arithmetic: records from both seats, matchup buckets, timing splits, and
 * that coach statements respect their minimum sample sizes.
 */

const assert = require('node:assert');
const PA = require('../client/js/ProfileAggregate.js');

const mkGame = (i, { win, map = 'Echo Isles', opener = 'Blademaster', t2 }) => ({
  key: `k${i}`,
  playedAt: 1600000000000 + i * 86400000,
  patchVersion: 32,
  map,
  gameMode: '1v1',
  winner: { teamId: win ? 0 : 1, playerId: win ? 1 : 2, method: 'result09', confidence: 'high' },
  durationMs: 900000,
  players: {
    1: {
      name: 'Me', race: 'O', teamId: 0,
      heroOpener: { name: opener },
      tier2Time: t2, tier3Time: null,
      expansionTime: i % 4 === 0 ? 480000 : null,
      firstTowerTime: null, buildPreview: [],
      economyTrack: [{ gameTimeMs: 240000, totalWorkers: win ? 17 : 13,
        supplyUsed: 30, supplyMax: 40, workersOnGold: 10, workersOnLumber: 5 }],
      apm: null
    },
    2: {
      name: `Them${i % 5}`, race: 'H', teamId: 1,
      heroOpener: { name: 'Archmage' },
      tier2Time: 300000, tier3Time: null,
      expansionTime: null, firstTowerTime: null,
      buildPreview: [], economyTrack: [], apm: null
    }
  }
});

// 30 games: Me wins whenever i % 3 !== 0 (20 wins, 10 losses), and T2 is a
// full minute later in the losses so the timing-split statement must fire.
const games = [];
for (let i = 0; i < 30; i++) {
  games.push(mkGame(i, { win: i % 3 !== 0, t2: i % 3 !== 0 ? 260000 : 320000 }));
}

// Primary-name detection: the seat that is in every game.
const primary = PA.detectPrimaryName(games);
assert.strictEqual(primary.name, 'Me');
assert.strictEqual(primary.games, 30);

// A single game gives every player one appearance, and nothing in the .w3g
// format says which seat saved it — so detection must REFUSE rather than
// coin-flip. Guessing here silently reports every Victory as a Defeat half
// the time, which is exactly what shipped before this guard.
assert.strictEqual(PA.detectPrimaryName(games.slice(0, 1)), null,
  'detectPrimaryName guessed an identity from a single game');
assert.strictEqual(PA.detectPrimaryName([]), null);

// Two games against the SAME opponent is still a tie — refuse.
const sameOpp = [mkGame(0, { win: true }), mkGame(5, { win: false })];
assert.strictEqual(PA.detectPrimaryName(sameOpp), null,
  'detectPrimaryName guessed when user and opponent were tied');

// Three games against two different opponents breaks the tie.
const varied = [mkGame(0, { win: true }), mkGame(1, { win: true }), mkGame(2, { win: false })];
assert.strictEqual(PA.detectPrimaryName(varied).name, 'Me');

// Single-game view orients correctly and is case-insensitive.
const v = PA.gameView(games[1], PA.normName('ME'));
assert.strictEqual(v.result, 'win');
assert.strictEqual(v.matchup, 'OvH');
assert.strictEqual(v.opponent.name, 'Them1');

// Profile from the user's seat.
const p = PA.buildProfile(games, 'me');
assert.strictEqual(p.games, 30);
assert.strictEqual(p.wins, 20);
assert.strictEqual(p.losses, 10);
assert.strictEqual(p.winRate, 67);

const ovh = p.matchups.find(m => m.matchup === 'OvH');
assert.ok(ovh, 'OvH matchup bucket missing');
assert.strictEqual(ovh.games, 30);

// The engineered timing split must be visible and produce a coach statement.
assert.ok(p.timings.t2.winMedian < p.timings.t2.lossMedian, 't2 split inverted');
assert.ok(p.statements.some(s => s.topic === 'timing'), 'timing statement missing');
assert.ok(p.statements.some(s => s.topic === 'record'), 'record statement missing');

// Opponent lookup is the same function from the other seat: Them0 plays
// games 0,5,10,15,20,25; Me wins 4 of those, so Them0's record is 2-4.
const opp = PA.buildProfile(games, 'them0');
assert.strictEqual(opp.games, 6);
assert.strictEqual(opp.wins, 2);
assert.strictEqual(opp.losses, 4);

// Below-minimum samples must NOT produce per-matchup claims: 3 games only.
const tiny = PA.buildProfile(games.slice(0, 3), 'me');
assert.ok(!tiny.statements.some(s => s.topic === 'matchup'),
  'matchup statement fired below MIN_MATCHUP');
assert.ok(!tiny.statements.some(s => s.topic === 'timing'),
  'timing statement fired below MIN_SPLIT');

console.log('ProfileAggregate: all assertions passed');

// ── Trend over time ─────────────────────────────────────────────────────────
//
// A drifting corpus: the player gets measurably better. 45 games — enough for
// windows of 20 plus a short remainder, which is the normal case and the one
// the window tiling has to get right.
const drift = [];
for (let i = 0; i < 45; i++) {
  const late = i >= 25;
  drift.push(mkGame(i, {
    // Early: loses 2 in 3. Late: wins 2 in 3.
    win: late ? (i % 3 !== 0) : (i % 3 === 0),
    // Early T2 5:20, late T2 4:10 — a 70s improvement, well over the 15s floor.
    t2: late ? 250000 : 320000
  }));
}
const dp = PA.buildProfile(drift, 'me');

// The newest window must be FULL. Tiling forwards would leave the remainder
// here, and a 5-game recent window fails every sample guard — which would
// silence the trend for any corpus whose size is not a multiple of the window.
assert.ok(dp.trend.length >= 2, 'trend produced fewer than 2 windows');
const newest = dp.trend[dp.trend.length - 1];
assert.strictEqual(newest.games, 20, 'newest trend window is not full');
assert.strictEqual(dp.trend[0].games, 5, 'the short window is not the oldest');
assert.strictEqual(dp.trend.reduce((n, w) => n + w.games, 0), 45,
  'trend windows do not account for every game');

// The delta must skip the short leading window rather than compare 5 games
// against 20.
assert.strictEqual(dp.trendDelta.t2.fromN, 20, 'trendDelta used the short window');
assert.ok(dp.trendDelta.t2.delta < 0, 'T2 improvement not detected');
assert.ok(dp.trendDelta.winRate.delta > 0, 'win-rate improvement not detected');
assert.ok(dp.statements.some(s => s.topic === 'trend'), 'trend statement missing');

// ── The guard that matters: a thin END must refuse the claim ────────────────
//
// 22 games — a full 20-game window plus 2. Overall n is ample, but one end of
// the comparison has 2 games, and "your T2 is a minute faster (n=2)" is worse
// than saying nothing. This is the assertion that stops "enough games overall"
// being mistaken for "enough games at each end".
const thinEnd = [];
for (let i = 0; i < 22; i++) {
  thinEnd.push(mkGame(i, { win: i >= 20, t2: i >= 20 ? 250000 : 320000 }));
}
const tp = PA.buildProfile(thinEnd, 'me');
assert.strictEqual(tp.trend.length, 2, 'expected a short window plus a full one');
assert.strictEqual(tp.trend[0].games, 2);
assert.ok(tp.trendDelta, 'trendDelta missing with two windows');
assert.ok(tp.trendDelta.t2.fromN < 8, 'test corpus does not exercise the guard');
assert.ok(!tp.statements.some(s => s.topic === 'trend'),
  'trend statement fired with a below-minimum window at one end');

// One window is not a trend.
const oneWindow = PA.buildProfile(drift.slice(0, 12), 'me');
assert.strictEqual(oneWindow.trendDelta, null,
  'trendDelta claimed a change from a single window');

console.log('ProfileAggregate: trend assertions passed');

// ── Several accounts are one player ─────────────────────────────────────────
//
// A main, a smurf, a second region. gameView, buildProfile and baseline all
// take a LIST of names now, and a game is yours if any of them is in it. The
// arithmetic has to be the same as if every game had been played on one name.
{
  const alt = [];
  for (let i = 0; i < 30; i++) {
    const g = mkGame(i, { win: i % 3 !== 0, t2: 260000 });
    // Half the history moves to a second account, seat and result untouched.
    if (i % 2 === 0) g.players[1].name = 'Me#2222';
    alt.push(g);
  }

  const one = PA.buildProfile(alt, 'Me');
  const both = PA.buildProfile(alt, ['Me', 'Me#2222']);
  assert.strictEqual(one.games, 15, 'one name sees only its own half');
  assert.strictEqual(both.games, 30, 'both names see the whole history');
  assert.strictEqual(both.wins + both.losses, 30, 'every game scored once');

  // A game from either account resolves to the same seat and the same verdict.
  const onAlt = alt.find(g => g.players[1].name === 'Me#2222');
  assert.strictEqual(PA.gameView(onAlt, 'me'), null, 'the other name is not this seat');
  const v = PA.gameView(onAlt, ['Me', 'Me#2222']);
  assert.ok(v && v.slot === '1', 'the alt account resolves to the same seat');

  // And the race baseline must not count your own second account as
  // "other people playing this race".
  const rb = PA.raceBaseline(alt, 'O', { excludeName: ['Me', 'Me#2222'] });
  assert.ok(!rb || !rb.n, 'a second account of yours leaked into the race baseline');

  console.log('ProfileAggregate: multi-account assertions passed');
}

// ── A result for every mode, from the winning TEAM ──────────────────────────
//
// The verdict used to be 1v1-only and matched on a single playerId, so a 2v2
// had no result and would have called the winner's team-mate a loser.
{
  const team = {
    key: 'team1',
    playedAt: 1600000000000,
    map: 'Turtle Rock',
    gameMode: '2v2',
    winner: { teamId: 1, playerId: 3, playerIds: [3, 4], method: 'seatFlag', confidence: 'high' },
    durationMs: 900000,
    players: {
      1: { name: 'A', race: 'O', teamId: 0, economyTrack: [] },
      2: { name: 'B', race: 'H', teamId: 0, economyTrack: [] },
      3: { name: 'C', race: 'U', teamId: 1, economyTrack: [] },
      4: { name: 'D', race: 'E', teamId: 1, economyTrack: [] }
    }
  };
  assert.strictEqual(PA.gameView(team, 'c').result, 'win', 'the named winner won');
  assert.strictEqual(PA.gameView(team, 'd').result, 'win', "so did the winner's team-mate");
  assert.strictEqual(PA.gameView(team, 'a').result, 'loss', 'the other team lost');
  assert.strictEqual(PA.gameView(team, 'b').result, 'loss');

  // A summary written before playerIds existed still resolves, off the team.
  const legacy = JSON.parse(JSON.stringify(team));
  delete legacy.winner.playerIds;
  assert.strictEqual(PA.gameView(legacy, 'd').result, 'win',
    'an older summary falls back to the winning team id');

  // No verdict is UNKNOWN, never a loss.
  const unknown = JSON.parse(JSON.stringify(team));
  unknown.winner = null;
  assert.strictEqual(PA.gameView(unknown, 'a').result, null,
    'a game with no verdict must not read as a defeat');

  console.log('ProfileAggregate: team-result assertions passed');
}
