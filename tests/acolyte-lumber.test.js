const assert = require('assert');
const path = require('path');

// initialize logging (console.logger must exist before parsing)
const logManager = require('../helpers/logManager');
logManager.setTestMode();
logManager.setLogger('acolyte-lumber-test');

const { doParsing } = require('../wc3v');
const { WORKER_IDS, WorkerRole, GHOUL_ID } = require('../helpers/mappings');

const REPLAY_PATH = path.join(__dirname, '..', 'replays', 'happy-vs-grubby.w3g');

async function runTests () {
  console.log('=== Acolyte Lumber Bug Tests ===\n');
  console.log('Parsing happy-vs-grubby.w3g ...');
  const { players } = await doParsing(REPLAY_PATH);

  // Find the Undead player (Happy)
  let udPlayer = null;
  let orcPlayer = null;
  for (const id of Object.keys(players)) {
    const p = players[id];
    if (!p || p.isNeutralPlayer) continue;
    if (p.race === 'U') udPlayer = p;
    if (p.race === 'O') orcPlayer = p;
  }

  assert(udPlayer, 'Expected an Undead player in this replay');
  assert(orcPlayer, 'Expected an Orc player in this replay');

  // ================================================================
  // TEST 1: Acolytes must NEVER have assignTarget = 'lumber'
  // ================================================================
  console.log('\nTest 1: Acolytes must never be assigned to lumber');

  const acolyteEvents = udPlayer.eventStream.filter(e =>
    e.key === 'addUnit' && e.unit && e.unit.itemId === 'uaco'
  );

  assert(acolyteEvents.length > 0, 'Expected at least 1 acolyte addUnit event');
  console.log(`  Found ${acolyteEvents.length} acolyte events`);

  for (const event of acolyteEvents) {
    const { unit } = event;
    assert.notStrictEqual(unit.assignTarget, WorkerRole.LUMBER,
      `Acolyte at t=${event.gameTime} has assignTarget='lumber' — ` +
      `acolytes CANNOT harvest lumber in WC3`);
    console.log(`    t=${event.gameTime} Acolyte -> ${unit.assignTarget} ✓`);
  }

  // ================================================================
  // TEST 2: Only ghouls should have assignTarget = 'lumber' for UD
  // ================================================================
  console.log('\nTest 2: Only ghouls should be lumber workers for Undead');

  const udWorkerEvents = udPlayer.eventStream.filter(e =>
    e.key === 'addUnit' && e.unit && WORKER_IDS.has(e.unit.itemId)
  );

  for (const event of udWorkerEvents) {
    const { unit } = event;
    if (unit.assignTarget === WorkerRole.LUMBER) {
      assert.strictEqual(unit.itemId, GHOUL_ID,
        `Non-ghoul UD unit ${unit.displayName} (${unit.itemId}) at t=${event.gameTime} ` +
        `has assignTarget='lumber' — only ghouls can harvest lumber`);
    }
  }
  console.log('  All UD lumber workers are ghouls ✓');

  // ================================================================
  // TEST 3: Ghouls default to lumber role
  // ================================================================
  console.log('\nTest 3: Ghouls should default to lumber');

  const ghoulEvents = udPlayer.eventStream.filter(e =>
    e.key === 'addUnit' && e.unit && e.unit.itemId === GHOUL_ID
  );

  assert(ghoulEvents.length > 0, 'Expected at least 1 ghoul event for UD player');

  for (const event of ghoulEvents) {
    assert.strictEqual(event.unit.assignTarget, WorkerRole.LUMBER,
      `Ghoul at t=${event.gameTime} has assignTarget='${event.unit.assignTarget}', expected 'lumber'`);
  }
  console.log(`  All ${ghoulEvents.length} ghouls assigned to lumber ✓`);

  // ================================================================
  // TEST 4: Worker counts for UD should have ghoulsOnLumber, NOT acolytes on lumber
  // ================================================================
  console.log('\nTest 4: UD worker counts snapshot consistency');

  for (const event of udPlayer.eventStream) {
    const w = event.workers;
    if (!w) continue;

    // For undead, onLumber should be 0 (acolytes can't go to lumber)
    // Ghouls are tracked separately in ghoulsOnLumber
    // If onLumber > 0 for UD, it means an acolyte was incorrectly assigned
    assert.strictEqual(w.onLumber, 0,
      `UD player has workers.onLumber=${w.onLumber} at t=${event.gameTime} key=${event.key} — ` +
      `acolytes cannot harvest lumber, should be 0`);
  }
  console.log('  UD workers.onLumber is always 0 ✓');

  // ================================================================
  // TEST 5: Orc peons CAN go to lumber (sanity check — not a bug)
  // ================================================================
  console.log('\nTest 5: Orc peons can be assigned to lumber (sanity)');

  let orcLumberCount = 0;
  for (const event of orcPlayer.eventStream) {
    const w = event.workers;
    if (!w) continue;
    if (w.onLumber > 0) orcLumberCount++;
  }
  assert(orcLumberCount > 0,
    'Expected Orc to have some workers on lumber in a real game');
  console.log(`  Orc has ${orcLumberCount} events with workers.onLumber > 0 ✓`);

  console.log('\n=== ALL ACOLYTE LUMBER TESTS PASSED ===');
}

runTests().catch(err => {
  console.error('\n=== TEST FAILED ===');
  console.error(err.message);
  process.exit(1);
});
