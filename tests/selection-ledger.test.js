/*
 * selection-ledger.test.js — pure unit tests for SelectionLedger.
 *
 * Covers:
 *   1. alive sightings and SelectSubgroup types
 *   2. the game's own deselect of a unit that died (exact death)
 *   3. deaths bounded by a group recall, a whole-selection deselect and a
 *      group assign that leave a handle out
 *   4. the peer rule, and a hidden unit that comes back
 *   5. handle ownership between players, enemy clicks as sightings
 *   6. last order per handle
 *
 * Run: `node tests/selection-ledger.test.js`
 */

const assert = require('assert');
const SelectionLedger = require('../lib/SelectionLedger');

let failures = 0;
function check (label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${label}`);
    console.log(`    ${err.message}`);
  }
}

const SELECT = 1, DESELECT = 2;
const u = (a, b) => ({ itemId1: a, itemId2: b });
const A = u(100, 1000), B = u(101, 1010), C = u(102, 1020), D = u(103, 1030), E = u(104, 1040);
const key = (x) => `${x.itemId1}/${x.itemId2}`;

const handleOf = (ledger, playerId, x) => ledger.players.get(playerId).handles.get(key(x));

console.log('[sightings]');

check('every list names live units; first/last follow them', () => {
  const L = new SelectionLedger();
  L.selectionChange(1, 1000, SELECT, [A, B]);
  L.selectionChange(1, 5000, DESELECT, [A, B]);
  L.selectionChange(1, 5000, SELECT, [C]);
  L.assignGroup(1, 9000, 1, [A, C]);
  L.resolve();
  const a = handleOf(L, 1, A);
  assert.strictEqual(a.first, 1000);
  assert.strictEqual(a.last, 9000);
  assert.strictEqual(a.counter, 1000);
  assert.strictEqual(a.death, null);
});

check('SelectSubgroup records the type of the handle, with each change of form', () => {
  const L = new SelectionLedger();
  L.selectionChange(1, 1000, SELECT, [A]);
  L.selectSubgroup(1, 1000, 'edoc', 100, 1000);
  L.selectSubgroup(1, 2000, 'edoc', 100, 1000);
  L.selectSubgroup(1, 3000, 'edcm', 100, 1000);
  L.resolve();
  assert.deepStrictEqual(handleOf(L, 1, A).types.map(x => x.type), ['edoc', 'edcm']);
});

console.log('[deaths]');

check('a deselect with nothing selected after it, never listed again: died then', () => {
  const L = new SelectionLedger();
  L.selectionChange(1, 1000, SELECT, [A, B, C]);
  L.selectionChange(1, 4000, DESELECT, [B]);
  L.resolve();
  assert.deepStrictEqual(handleOf(L, 1, B).death, { at: 4000, from: 4000, kind: 'deselected' });
  assert.strictEqual(handleOf(L, 1, A).death, null);
});

check('the same deselect of a unit listed again later is no death (shift-click, gold mine)', () => {
  const L = new SelectionLedger();
  L.selectionChange(1, 1000, SELECT, [A, B]);
  L.selectionChange(1, 4000, DESELECT, [B]);
  L.selectionChange(1, 9000, SELECT, [B]);
  L.resolve();
  assert.strictEqual(handleOf(L, 1, B).death, null);
});

check('a deselect followed by a select is a new selection, no death', () => {
  const L = new SelectionLedger();
  L.selectionChange(1, 1000, SELECT, [A]);
  L.selectionChange(1, 4000, DESELECT, [A]);
  L.selectionChange(1, 4000, SELECT, [B]);
  L.resolve();
  assert.strictEqual(handleOf(L, 1, A).death, null);
});

check('a group recall whose PreSubselection list leaves a member out bounds its death', () => {
  const L = new SelectionLedger();
  L.selectionChange(1, 1000, SELECT, [A, B, C]);
  L.assignGroup(1, 1000, 1, [A, B, C]);
  L.selectionChange(1, 2000, DESELECT, [A, B, C]);
  L.selectionChange(1, 2000, SELECT, [D]);
  L.preSubselection(1, 8000, 100, 1000);
  L.preSubselection(1, 8000, 102, 1020);
  L.selectGroup(1, 8000, 1);
  L.resolve();
  assert.deepStrictEqual(handleOf(L, 1, B).death, { at: 8000, from: 2000, kind: 'hotkey' });
  assert.strictEqual(handleOf(L, 1, A).death, null);
});

check('without PreSubselection, the deselect after a recall lists who is really in it', () => {
  const L = new SelectionLedger();
  L.selectionChange(1, 1000, SELECT, [A, B, C]);
  L.assignGroup(1, 1000, 1, [A, B, C]);
  L.selectionChange(1, 2000, DESELECT, [A, B, C]);
  L.selectionChange(1, 2000, SELECT, [D]);
  L.selectGroup(1, 6000, 1);
  L.selectionChange(1, 9000, DESELECT, [A, C]);
  L.selectionChange(1, 9000, SELECT, [D]);
  L.resolve();
  assert.deepStrictEqual(handleOf(L, 1, B).death, { at: 9000, from: 2000, kind: 'deselect' });
});

check('a group assigned from a known selection that leaves a member out bounds its death', () => {
  const L = new SelectionLedger();
  L.selectionChange(1, 1000, SELECT, [A, B]);
  L.assignGroup(1, 7000, 2, [A]);
  L.resolve();
  assert.deepStrictEqual(handleOf(L, 1, B).death, { at: 7000, from: 1000, kind: 'assign' });
});

check('peers: a later full list naming most of its last companions but not it', () => {
  const L = new SelectionLedger();
  L.selectionChange(1, 1000, SELECT, [A, B, C, D]);
  L.selectionChange(1, 2000, DESELECT, [A, B, C, D]);
  L.selectionChange(1, 2000, SELECT, [E]);
  // much later the player box-selects the army again: A is not in it
  L.selectionChange(1, 30000, DESELECT, [E]);
  L.selectionChange(1, 30000, SELECT, [B, C, D]);
  L.resolve();
  assert.deepStrictEqual(handleOf(L, 1, A).death, { at: 30000, from: 2000, kind: 'peers' });
});

check('a shift-add naming some companions is no full list for the peer rule', () => {
  const L = new SelectionLedger();
  L.selectionChange(1, 1000, SELECT, [A, B, C]);
  L.selectionChange(1, 2000, DESELECT, [A, B, C]);
  L.selectionChange(1, 2000, SELECT, [E]);
  L.selectionChange(1, 3000, SELECT, [B, C]);
  L.resolve();
  assert.strictEqual(handleOf(L, 1, A).death, null);
});

console.log('[owners and orders]');

check('a unit the enemy clicks belongs to its owner, and the click shows it alive', () => {
  const L = new SelectionLedger();
  L.selectionChange(1, 1000, SELECT, [A, B]);
  L.assignGroup(1, 1000, 1, [A, B]);
  L.selectionChange(1, 2000, DESELECT, [B]);         // alone: looks like a death...
  L.selectionChange(2, 5000, SELECT, [B]);           // ...but player 2 clicks it later
  L.selectSubgroup(2, 5000, 'hfoo', 101, 1010);
  L.resolve();
  assert.ok(!L.players.get(2).handles.has(key(B)));
  const b = handleOf(L, 1, B);
  assert.strictEqual(b.last, 5000);
  assert.strictEqual(b.death, null);
  assert.deepStrictEqual(b.types.map(x => x.type), []);
});

check('an attack aimed at a unit counts as a sighting of it', () => {
  const L = new SelectionLedger();
  L.selectionChange(1, 1000, SELECT, [A, B]);
  L.selectionChange(1, 2000, DESELECT, [A]);
  L.selectionChange(2, 3000, SELECT, [C, D]);
  L.order(2, 6000, 0xD000F, 100, 1000, true);
  L.resolve();
  assert.strictEqual(handleOf(L, 1, A).last, 6000);
  assert.strictEqual(handleOf(L, 1, A).death, null);
});

check('the last order of the selection is kept per handle, with its work flag', () => {
  const L = new SelectionLedger();
  L.selectionChange(1, 1000, SELECT, [A, B]);
  L.order(1, 1500, 0xD0012);
  L.selectionChange(1, 2000, DESELECT, [A, B]);
  L.selectionChange(1, 2000, SELECT, [B]);
  L.order(1, 2500, 0xD0003, null, null, false, true);
  L.resolve();
  assert.strictEqual(handleOf(L, 1, A).lastOrder.order, 0xD0012);
  assert.strictEqual(handleOf(L, 1, B).lastOrder.work, true);
});

check('object ids that name no unit are ignored', () => {
  const L = new SelectionLedger();
  L.preSubselection(1, 1000, 4294967295, 4294967295);
  L.selectSubgroup(1, 1000, 'hfoo', -1, -1);
  L.resolve();
  assert.ok(!L.players.get(1) || L.players.get(1).handles.size === 0);
});

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall passed');
