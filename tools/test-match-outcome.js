/**
 * test-match-outcome.js — helpers/utils.computeWinner, on hand-built replays.
 *
 * The corpus grader is tools/winloss-audit.js: it runs the same function over
 * every locally parsed game that came from the crawl and checks the verdict
 * against warcraft3.info's own record. That is the evidence the decoding is
 * right. This is the other half — the cases the corpus does not contain, and
 * the rule that matters more than any of them:
 *
 *   A verdict is only published when the replay actually says. No last-leaver
 *   guess, no "the client that saved this file won". Both of those shipped,
 *   and in a replay saved by the person who LOST, both name the loser — which
 *   is a defeat reported as a victory to the one person who knows better.
 *
 * Usage: node tools/test-match-outcome.js
 */

'use strict';

const assert = require('node:assert');
const utils = require('../helpers/utils.js');

// A replay as computeWinner reads one: slot records for the shape, leave
// blocks for the outcome. `seats` is [teamId, ...] by playerId order from 1.
const mkReplay = (seats, leaves, extraSlots = []) => ({
  subheader: { version: 10100 },
  metadata: {
    slotRecords: [
      ...seats.map((teamId, i) => ({ playerId: i + 1, slotStatus: 2, computerFlag: 0, teamId })),
      ...extraSlots
    ]
  },
  leaveEvents: leaves
});

const leave = (playerId, result, reason = '01000000') =>
  ({ playerId, reason, result, gameTimeMs: 600000 });

// The neutral player and an observer, which every real replay carries and
// neither of which is a seat.
const NEUTRAL = { playerId: 1042, slotStatus: 2, computerFlag: 0, teamId: 1046 };
const OBSERVER = { playerId: 24, slotStatus: 2, computerFlag: 0, teamId: 24 };

// ── The result code is the signal ───────────────────────────────────────────
{
  const w = utils.computeWinner(
    mkReplay([0, 1], [leave(2, '07000000'), leave(1, '09000000')], [NEUTRAL, OBSERVER]),
    { 1: { teamId: 0 }, 2: { teamId: 1 } });
  assert.ok(w, 'a seat saying 09 is a verdict');
  assert.strictEqual(w.teamId, 0);
  assert.strictEqual(w.playerId, 1);
  assert.strictEqual(w.method, 'seatFlag');
  assert.strictEqual(w.confidence, 'high');
}

// Reason adds nothing. 09 under any reason is still a win; the corpus carries
// reason=09 result=09 and reason=07 result=07 as a second encoding.
{
  const w = utils.computeWinner(
    mkReplay([0, 1], [leave(2, '07000000', '07000000'), leave(1, '09000000', '09000000')]),
    { 1: { teamId: 0 }, 2: { teamId: 1 } });
  assert.strictEqual(w.teamId, 0, 'the second encoding reads the same way');
}

// ── The two rules that shipped wrong ────────────────────────────────────────
//
// reason 0x0C is "connection closed by the LOCAL game": it marks whose client
// wrote the file. In a self-saved replay that is always the person reading it.
{
  const w = utils.computeWinner(
    mkReplay([0, 1], [leave(1, '07000000', '0c000000'), leave(2, '07000000')]),
    { 1: { teamId: 0 }, 2: { teamId: 1 } });
  assert.strictEqual(w, null,
    'reason 0c is who saved the replay, not who won — it must decide nothing');
}

// The last leaver. True in the WINNER's copy of a ladder game and false in the
// loser's, where their own leave block is last because their client stopped
// recording when they left.
{
  const w = utils.computeWinner(
    mkReplay([0, 1], [leave(1, '01000000'), leave(2, '01000000')]),
    { 1: { teamId: 0 }, 2: { teamId: 1 } });
  assert.strictEqual(w, null, 'two disconnects say nothing; leaving last is not winning');
}

// ── Disagreement is not a result ────────────────────────────────────────────
{
  const w = utils.computeWinner(
    mkReplay([0, 1], [leave(1, '09000000'), leave(2, '09000000')]),
    { 1: { teamId: 0 }, 2: { teamId: 1 } });
  assert.strictEqual(w, null, 'two teams both claiming a win is not a verdict');
}
{
  // One seat on a team says it won and its team-mate says it lost.
  const w = utils.computeWinner(
    mkReplay([0, 0, 1, 1],
      [leave(1, '09000000'), leave(2, '07000000'), leave(3, '07000000'), leave(4, '07000000')]),
    {});
  assert.strictEqual(w, null, 'a contradiction inside the winning team is not a verdict');
}

// ── Elimination, when nobody claimed ────────────────────────────────────────
{
  const w = utils.computeWinner(
    mkReplay([0, 1], [leave(2, '07000000')], [NEUTRAL]),
    { 1: { teamId: 0 }, 2: { teamId: 1 } });
  assert.ok(w, 'the only seat that spoke said it lost, so the other team won');
  assert.strictEqual(w.teamId, 0);
  assert.strictEqual(w.method, 'elimination');
  assert.strictEqual(w.confidence, 'medium');
}
{
  // A 2v2 where only ONE of the losing seats left. The other might still have
  // been playing, so this is not elimination.
  const w = utils.computeWinner(
    mkReplay([0, 0, 1, 1], [leave(3, '07000000')]),
    {});
  assert.strictEqual(w, null,
    'a team is only beaten when every seat it held is accounted for');
}

// ── Team games ──────────────────────────────────────────────────────────────
{
  const w = utils.computeWinner(
    mkReplay([0, 0, 1, 1],
      [leave(1, '07000000'), leave(2, '07000000'), leave(3, '09000000')],
      [NEUTRAL]),
    { 1: { teamId: 0 }, 2: { teamId: 0 }, 3: { teamId: 1 }, 4: { teamId: 1 } });
  assert.ok(w, 'a 2v2 has a result');
  assert.strictEqual(w.teamId, 1);
  assert.deepStrictEqual(w.playerIds, [3, 4],
    'both seats on the winning team are named, not just the one that spoke');
}

// ── Neither the neutral player nor an observer is a seat ────────────────────
{
  // The Neutral Player sits on team 1046 in every replay. Counting it as a
  // participant made computeGameMode answer 'ffa' for 973 of the 975 games in
  // the reference corpus, which is what made the desktop's "only parse 1v1
  // games" switch drop somebody's entire history.
  const slots = [
    { playerId: 1, slotStatus: 2, computerFlag: 0, teamId: 0 },
    { playerId: 2, slotStatus: 2, computerFlag: 0, teamId: 1 },
    NEUTRAL, OBSERVER
  ];
  const shape = utils.playersFromSlots(slots, 10100);
  assert.deepStrictEqual(Object.keys(shape), ['1', '2'],
    'only the two humans are seats');
  assert.strictEqual(utils.computeGameMode(shape), '1v1');

  // An observer's own leave block is about the observer.
  const w = utils.computeWinner(
    { subheader: { version: 10100 }, metadata: { slotRecords: slots },
      leaveEvents: [leave(24, '09000000'), leave(1, '07000000'), leave(2, '09000000')] },
    { 1: { teamId: 0 }, 2: { teamId: 1 } });
  assert.strictEqual(w.teamId, 1, "an observer's 09 does not win anybody the game");
}

// ── Nothing to read ─────────────────────────────────────────────────────────
{
  assert.strictEqual(
    utils.computeWinner(mkReplay([0, 1], []), {}), null,
    'no leave blocks means unknown');
  assert.strictEqual(utils.computeWinner({}, {}), null, 'an empty replay is unknown');
}

console.log('match-outcome: all assertions passed');
