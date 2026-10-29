/*
 * multi-building-train.test.js — which train orders Player queues in every
 * selected building of the same type (Player._trainsInEachBuilding), on
 * hand-built players (no replay needed).
 *
 * Covers:
 *   1. a plain unit is trained in each selected building
 *   2. heroes, researches and building upgrades are not
 *   3. Night Elf trains in the first building only
 *
 * Run: `node tests/multi-building-train.test.js`
 */

const assert = require('assert');
const logManager = require('../helpers/logManager');
logManager.setTestMode(true);
logManager.setProductionMode(true);
logManager.setLogger('multi-building-train-test');

const EventTimer = require('../lib/EventTimer');
const Player = require('../lib/Player');
const { abilityFlagNames } = require('../helpers/mappings');

let failures = 0;
function check (label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${label}`);
    console.log(`    ${err.stack.split('\n').slice(0, 3).join('\n    ')}`);
  }
}

// race flags as the replay's player slots give them
const HUMAN = 65, ORC = 66, NIGHT_ELF = 68, UNDEAD = 72;

const makePlayer = (raceFlag) =>
  new Player(1, { teamId: 0, raceFlag }, { map: {} }, new EventTimer(), {}, false);

const TRAIN = abilityFlagNames.TrainUnit;

console.log('[_trainsInEachBuilding]');

check('a plain unit is trained in each selected building', () => {
  assert.strictEqual(makePlayer(HUMAN)._trainsInEachBuilding('hrif', TRAIN), true);
  assert.strictEqual(makePlayer(ORC)._trainsInEachBuilding('ogru', TRAIN), true);
  assert.strictEqual(makePlayer(UNDEAD)._trainsInEachBuilding('ugho', TRAIN), true);
});

check('heroes, researches and upgrades are not', () => {
  const human = makePlayer(HUMAN);
  assert.strictEqual(human._trainsInEachBuilding('Hamg', TRAIN), false);   // Archmage
  assert.strictEqual(human._trainsInEachBuilding('Rhde', TRAIN), false);   // Defend
  assert.strictEqual(human._trainsInEachBuilding('hkee', TRAIN), false);   // Keep
});

check('Night Elf trains in the first building only', () => {
  const elf = makePlayer(NIGHT_ELF);
  assert.strictEqual(elf.race, 'E');
  assert.strictEqual(elf._trainsInEachBuilding('edoc', TRAIN), false);
  assert.strictEqual(elf._trainsInEachBuilding('earc', TRAIN), false);
});

console.log('');
if (failures) {
  console.log(`FAILED — ${failures} check(s)`);
  process.exit(1);
} else {
  console.log('OK — all checks passed');
}
