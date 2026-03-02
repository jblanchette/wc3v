const assert = require('assert');
const path = require('path');

// initialize logging (console.logger must exist before parsing)
const logManager = require('../helpers/logManager');
logManager.setTestMode();
logManager.setLogger('worker-assignment-test');

const { doParsing } = require('../wc3v');
const { WORKER_IDS, WorkerRole, GHOUL_ID } = require('../helpers/mappings');

const REPLAY_PATH = path.join(__dirname, '..', 'replays', 'happy-vs-grubby.w3g');

const VALID_TARGETS = new Set([WorkerRole.GOLD, WorkerRole.LUMBER]);

async function runTests () {
  console.log('Parsing happy-vs-grubby.w3g ...');
  const { players } = await doParsing(REPLAY_PATH);

  const playerIds = Object.keys(players);
  assert(playerIds.length >= 2, `Expected at least 2 players, got ${playerIds.length}`);

  let totalWorkerEvents = 0;
  let goldCount = 0;
  let lumberCount = 0;
  const ghoulEvents = [];

  for (const playerId of playerIds) {
    const player = players[playerId];
    if (!player || player.isNeutralPlayer) continue;

    const { eventStream, race } = player;
    console.log(`\nPlayer ${playerId} (race: ${race}): ${eventStream.length} events`);

    // --- Sanity checks on every event's workers snapshot ---
    for (const event of eventStream) {
      const w = event.workers;
      if (!w) continue;

      assert(w.onGold >= 0,
        `Negative onGold (${w.onGold}) at t=${event.gameTime} key=${event.key}`);
      assert(w.onLumber >= 0,
        `Negative onLumber (${w.onLumber}) at t=${event.gameTime} key=${event.key}`);
      assert(w.onBuild >= 0,
        `Negative onBuild (${w.onBuild}) at t=${event.gameTime} key=${event.key}`);
      assert(w.totalWorkers >= 0,
        `Negative totalWorkers (${w.totalWorkers}) at t=${event.gameTime} key=${event.key}`);

      const assignedSum = w.onGold + w.onLumber + w.onBuild;
      assert(assignedSum <= w.totalWorkers,
        `Assigned workers (${assignedSum}) > total (${w.totalWorkers}) at t=${event.gameTime} key=${event.key}`);

      assert(w.totalWorkers <= 50,
        `Unreasonable totalWorkers (${w.totalWorkers}) at t=${event.gameTime} key=${event.key}`);
    }

    // --- Worker addUnit event checks ---
    const workerEvents = eventStream.filter(e =>
      e.key === 'addUnit' && e.unit && WORKER_IDS.has(e.unit.itemId)
    );

    console.log(`  Worker addUnit events: ${workerEvents.length}`);

    for (const event of workerEvents) {
      const { unit } = event;
      totalWorkerEvents++;

      // 1. Every worker event must have an assignTarget
      assert(
        unit.assignTarget !== undefined && unit.assignTarget !== null,
        `Missing assignTarget: ${unit.displayName} (${unit.itemId}) at t=${event.gameTime}`
      );

      // 2. assignTarget must be a valid WorkerRole value
      assert(
        VALID_TARGETS.has(unit.assignTarget),
        `Invalid assignTarget "${unit.assignTarget}": ${unit.displayName} at t=${event.gameTime}`
      );

      // 3. Every worker event must have a uuid
      assert(
        unit.uuid,
        `Missing uuid: ${unit.displayName} (${unit.itemId}) at t=${event.gameTime}`
      );

      // Track distribution
      if (unit.assignTarget === WorkerRole.GOLD) goldCount++;
      if (unit.assignTarget === WorkerRole.LUMBER) lumberCount++;

      if (unit.itemId === GHOUL_ID) {
        ghoulEvents.push(event);
      }

      console.log(`    t=${event.gameTime} ${unit.displayName} -> ${unit.assignTarget}`);
    }

    // --- Verify workerCounts getter works ---
    const counts = player.workerCounts;
    assert(counts !== undefined, `workerCounts should be defined for player ${playerId}`);
    assert(typeof counts.onGold === 'number', 'onGold should be a number');
    assert(typeof counts.totalWorkers === 'number', 'totalWorkers should be a number');
    assert(counts.onGold >= 0, `Final onGold should be >= 0, got ${counts.onGold}`);
    assert(counts.totalWorkers >= 0, `Final totalWorkers should be >= 0, got ${counts.totalWorkers}`);
    console.log(`  Final workerCounts: gold=${counts.onGold} lumber=${counts.onLumber} build=${counts.onBuild} total=${counts.totalWorkers} ghouls=${counts.ghoulsOnLumber}`);
  }

  console.log(`\n--- Summary ---`);
  console.log(`Total worker events: ${totalWorkerEvents}`);
  console.log(`  Gold: ${goldCount}, Lumber: ${lumberCount}`);
  console.log(`  Ghoul events: ${ghoulEvents.length}`);

  // 4. Must have some worker events
  assert(totalWorkerEvents > 0, 'Expected at least 1 worker addUnit event');

  // 5. Not all gold — some workers go to lumber in any real game
  assert(lumberCount > 0,
    `Expected at least 1 lumber worker, got all ${totalWorkerEvents} on gold`);

  // 6. All ghouls must be lumber
  for (const event of ghoulEvents) {
    assert.strictEqual(event.unit.assignTarget, WorkerRole.LUMBER,
      `Ghoul at t=${event.gameTime} has "${event.unit.assignTarget}", expected "${WorkerRole.LUMBER}"`);
  }

  // 7. This is UD vs Orc, must have at least 1 ghoul
  assert(ghoulEvents.length > 0, 'Expected at least 1 ghoul in UD vs Orc replay');

  console.log('\n=== ALL TESTS PASSED ===');
}

runTests().catch(err => {
  console.error('\n=== TEST FAILED ===');
  console.error(err.message);
  process.exit(1);
});
