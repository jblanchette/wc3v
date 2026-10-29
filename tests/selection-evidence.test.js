/*
 * selection-evidence.test.js — SelectionEvidence on a hand-built ledger and
 * players (no replay needed).
 *
 * Covers:
 *   1. a trained unit is tied to its handle and gets the death the lists show
 *   2. a trained unit the lists never show is flagged selectionUnlisted
 *   3. a handle the lists type as an army unit nobody took becomes a unit
 *   4. a foreign handle (only ever clicked alone) is not bound or added
 *   5. a handle Player.bindHandlesByCreationOrder gave the wrong unit goes to
 *      the unit the lists fit, not to both
 *
 * Run: `node tests/selection-evidence.test.js`
 */

const assert = require('assert');
const logManager = require('../helpers/logManager');
logManager.setTestMode(true);
logManager.setProductionMode(true);
logManager.setLogger('selection-evidence-test');

const EventTimer = require('../lib/EventTimer');
const Unit = require('../lib/Unit');
const SelectionLedger = require('../lib/SelectionLedger');
const SelectionEvidence = require('../lib/SelectionEvidence');

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

const SELECT = 1, DESELECT = 2;
const u = (a, b) => ({ itemId1: a, itemId2: b });

function setup () {
  const eventTimer = new EventTimer();
  const trained = (type, t) => {
    const unit = new Unit(eventTimer, null, null, type, false);
    unit.spawnTime = t - 20000;
    unit.trainedTime = t;
    return unit;
  };
  const footman = trained('hfoo', 60000);
  const phantom = trained('hfoo', 90000);
  const player = { id: 1, units: [footman, phantom], eventTimer, startingPosition: { x: 0, y: 0 } };

  const L = new SelectionLedger();
  // the footman's handle, listed with the hero, then the game deselects it as it dies
  L.selectionChange(1, 70000, SELECT, [u(10, 1000), u(11, 2000)]);
  L.selectSubgroup(1, 70000, 'Hpal', 10, 1000);
  L.order(1, 71000, 0xD0003);
  L.selectionChange(1, 150000, DESELECT, [u(11, 2000)]);
  // a mercenary nobody trained, selected with the hero
  L.selectionChange(1, 200000, DESELECT, [u(10, 1000)]);
  L.selectionChange(1, 200000, SELECT, [u(10, 1000), u(12, 9000)]);
  L.selectSubgroup(1, 200000, 'nftb', 12, 9000);
  // an enemy unit, clicked on alone
  L.selectionChange(1, 210000, DESELECT, [u(10, 1000), u(12, 9000)]);
  L.selectionChange(1, 210000, SELECT, [u(13, 9500)]);
  L.selectSubgroup(1, 210000, 'hkni', 13, 9500);

  const hero = new Unit(eventTimer, '10', '1000', 'Hpal', false);
  hero.spawnTime = 0;
  hero.trainedTime = 0;
  player.units.unshift(hero);

  const pm = { selectionLedger: L, players: { 1: player } };
  const stats = new SelectionEvidence(pm).run();
  return { player, footman, phantom, hero, stats };
}

console.log('[SelectionEvidence]');

check('the trained unit gets its handle and the death the lists show', () => {
  const { footman } = setup();
  assert.ok(footman.selectionLife);
  assert.strictEqual(footman.selectionLife.handle, '11/2000');
  assert.deepStrictEqual(footman.selectionLife.death, { at: 150000, from: 150000, kind: 'deselected' });
});

check('a trained unit the lists never show is flagged unlisted', () => {
  const { phantom } = setup();
  assert.strictEqual(phantom.selectionLife, undefined);
  assert.strictEqual(phantom.selectionUnlisted, true);
});

check('a typed army handle nobody took becomes a unit, an enemy click does not', () => {
  const { player, stats } = setup();
  const added = player.units.filter(x => x.fromSelectionLists);
  assert.strictEqual(stats.added, 1);
  assert.strictEqual(added.length, 1);
  assert.strictEqual(added[0].itemId, 'nftb');
  assert.strictEqual(added[0].trainedTime, 200000);
  assert.strictEqual(added[0].selectionLife.handle, '12/9000');
});

check('a creation-order binding is no hint: the handle goes to the unit that fits', () => {
  const eventTimer = new EventTimer();
  const trained = (type, t) => {
    const unit = new Unit(eventTimer, null, null, type, false);
    unit.spawnTime = t - 20000;
    unit.trainedTime = t;
    return unit;
  };
  const early = trained('hfoo', 60000);
  // trained long after the handle was first listed, yet bound to it by
  // creation order during the simulation (config.handleOrderBinding)
  const late = trained('hfoo', 120000);
  late.registerItemIds('20', '2000');
  late.boundByCreationOrder = true;
  const player = { id: 1, units: [early, late], eventTimer, startingPosition: { x: 0, y: 0 } };

  const L = new SelectionLedger();
  L.selectionChange(1, 70000, SELECT, [u(10, 1000), u(20, 2000)]);
  L.selectSubgroup(1, 70000, 'Hpal', 10, 1000);
  L.order(1, 71000, 0xD0003);

  new SelectionEvidence({ selectionLedger: L, players: { 1: player } }).run();
  assert.strictEqual(early.selectionLife && early.selectionLife.handle, '20/2000');
  assert.strictEqual(late.selectionLife, undefined);
});

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall passed');
