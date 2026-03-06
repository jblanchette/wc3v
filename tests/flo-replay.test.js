const assert = require('assert');
const path = require('path');

// initialize logging (console.logger must exist before parsing)
const logManager = require('../helpers/logManager');
logManager.setTestMode();
logManager.setLogger('flo-replay-test');

const { doParsing } = require('../wc3v');

const FLO_REPLAY_PATH = path.join(__dirname, '..', 'replays', 'happy-vs-kaho-turtle-rock.w3g');

async function runTests () {
  console.log('=== FLO/W3Champions Replay Format Tests ===\n');
  console.log('Parsing FLO replay: happy-vs-kaho-turtle-rock.w3g ...');
  const { players, replay } = await doParsing(FLO_REPLAY_PATH);

  // collect real (non-neutral) players
  const realPlayers = [];
  for (const id of Object.keys(players)) {
    const p = players[id];
    if (!p || p.isNeutralPlayer) continue;
    realPlayers.push(p);
  }

  // ================================================================
  // TEST 1: Exactly 2 non-neutral players created
  // ================================================================
  console.log('\nTest 1: Exactly 2 non-neutral players created from FLO replay');

  assert.strictEqual(realPlayers.length, 2,
    `Expected 2 real players, got ${realPlayers.length}. ` +
    `FLO replays have 17 lobby entries — spectators should not become players`);
  console.log('  2 real players found ✓');

  // ================================================================
  // TEST 2: Both players have detected race (not stuck on 'R')
  // ================================================================
  console.log('\nTest 2: Both players have detected race');

  const validRaces = ['H', 'O', 'E', 'U'];
  for (const p of realPlayers) {
    assert(validRaces.includes(p.race),
      `Player ${p.id} has race '${p.race}' — expected one of ${validRaces.join(',')}`);
    console.log(`  Player ${p.id}: race = ${p.race} ✓`);
  }

  // ================================================================
  // TEST 3: Players have different teamIds
  // ================================================================
  console.log('\nTest 3: Players have different teamIds');

  assert.notStrictEqual(realPlayers[0].teamId, realPlayers[1].teamId,
    `Both players have teamId=${realPlayers[0].teamId} — should be on different teams`);
  console.log(`  Player ${realPlayers[0].id}: team ${realPlayers[0].teamId}, ` +
    `Player ${realPlayers[1].id}: team ${realPlayers[1].teamId} ✓`);

  // ================================================================
  // TEST 4: Player names resolved from playerRecords
  // ================================================================
  console.log('\nTest 4: Player names resolved from metadata');

  const playerRecords = replay.metadata.playerRecords;
  const happyRecord = playerRecords.find(r => r.playerName && r.playerName.includes('Happy'));
  const kahoRecord = playerRecords.find(r => r.playerName && r.playerName.includes('KAHO'));

  assert(happyRecord, 'Expected to find Happy in playerRecords');
  assert(kahoRecord, 'Expected to find KAHO in playerRecords');
  console.log(`  Happy: ${happyRecord.playerName} ✓`);
  console.log(`  Kaho: ${kahoRecord.playerName} ✓`);

  // ================================================================
  // TEST 5: Both players have units (initial units were set up)
  // ================================================================
  console.log('\nTest 5: Both players have units');

  for (const p of realPlayers) {
    assert(p.units.length > 0,
      `Player ${p.id} (${p.race}) has 0 units — setupInitialUnits likely failed`);
    console.log(`  Player ${p.id} (${p.race}): ${p.units.length} units ✓`);
  }

  // ================================================================
  // TEST 6: Both players have eventStream entries
  // ================================================================
  console.log('\nTest 6: Both players have eventStream data');

  for (const p of realPlayers) {
    assert(p.eventStream.length > 0,
      `Player ${p.id} has empty eventStream`);
    console.log(`  Player ${p.id}: ${p.eventStream.length} events ✓`);
  }

  // ================================================================
  // TEST 7: Synthetic slotRecords were created
  // ================================================================
  console.log('\nTest 7: Synthetic slotRecords exist for both players');

  const slotRecords = replay.metadata.slotRecords;
  for (const p of realPlayers) {
    const slot = slotRecords.find(s => s.playerId === p.id);
    assert(slot, `No slotRecord found for player ${p.id}`);
    assert.strictEqual(slot.slotStatus, 2,
      `Player ${p.id} slotStatus is ${slot.slotStatus}, expected 2`);
    console.log(`  Player ${p.id}: slotRecord found, status=${slot.slotStatus} ✓`);
  }

  // ================================================================
  // TEST 8: Correct races — Happy is UD, Kaho is NE
  // ================================================================
  console.log('\nTest 8: Race detection accuracy');

  const happyPlayer = realPlayers.find(p => {
    const record = playerRecords.find(r => r.playerId === p.id);
    return record && record.playerName && record.playerName.includes('Happy');
  });
  const kahoPlayer = realPlayers.find(p => {
    const record = playerRecords.find(r => r.playerId === p.id);
    return record && record.playerName && record.playerName.includes('KAHO');
  });

  assert(happyPlayer, 'Could not find Happy player');
  assert(kahoPlayer, 'Could not find Kaho player');
  assert.strictEqual(happyPlayer.race, 'U',
    `Happy should be Undead (U), got '${happyPlayer.race}'`);
  assert.strictEqual(kahoPlayer.race, 'E',
    `Kaho should be Night Elf (E), got '${kahoPlayer.race}'`);
  console.log(`  Happy = ${happyPlayer.race} (Undead) ✓`);
  console.log(`  Kaho = ${kahoPlayer.race} (Night Elf) ✓`);

  // ================================================================
  // TEST 9: No spectator players created
  // ================================================================
  console.log('\nTest 9: No spectator playerIds leaked into players');

  const allPlayerIds = Object.keys(players).map(Number);
  const nonNeutralIds = allPlayerIds.filter(id => !players[id].isNeutralPlayer);

  // FLO lobby has IDs 1-15,24 but only 2 should be real players
  assert(nonNeutralIds.length <= 2,
    `Expected at most 2 non-neutral players, got ${nonNeutralIds.length}: [${nonNeutralIds}]`);
  console.log(`  Non-neutral player IDs: [${nonNeutralIds}] ✓`);

  console.log('\n=== ALL FLO REPLAY TESTS PASSED ===');
}

runTests().catch(err => {
  console.error('\n=== TEST FAILED ===');
  console.error(err.message);
  process.exit(1);
});
