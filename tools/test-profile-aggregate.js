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
