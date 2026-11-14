/*
 * death-inference-selection.test.js — pure unit tests for what DeathInference
 * makes of the selection lists (unit.selectionLife, selectionUnlisted), on
 * hand-made units; no replay needed.
 *
 * Run: `node tests/death-inference-selection.test.js`
 */

const assert = require('assert');
const DeathInference = require('../lib/DeathInference');

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

const GAME_END = 600000;

// a unit as DeathInference reads it; `end` keeps the game running to GAME_END
function unit (itemId, extra = {}) {
  return {
    uuid: `${itemId}-${Math.random()}`,
    itemId,
    meta: { worker: ['hpea', 'opeo', 'uaco', 'ewsp'].includes(itemId), hero: false },
    spawnTime: 10000,
    trainedTime: 25000,
    path: [{ x: 0, y: 0, gameTime: 25000 }],
    ...extra
  };
}

function run (units, battles = []) {
  const clock = unit('hfoo', { path: [{ x: 0, y: 0, gameTime: GAME_END }], selectionLife: { last: GAME_END, recallsListed: true } });
  const pm = { players: { 1: { id: 1, units: [clock, ...units] } }, world: { battles } };
  new DeathInference(pm).run();
  return units.map(u => u.lostState);
}

const life = (last, lastKind, extra = {}) => ({ handle: '1/1', recallsListed: true, first: 30000, last, lastKind, death: null, ...extra });

console.log('[workers]');

check('a worker last seen as an enemy target and never listed again died there', () => {
  const [ls] = run([unit('hpea', { selectionLife: life(300000, 'target') })]);
  assert.strictEqual(ls.state, 'possiblyLost');
  assert.strictEqual(ls.since, 300000);
  assert.strictEqual(ls.source, 'selection');
});

check('not when its owner aimed the order, nor when the lists name it later', () => {
  const [own, seen] = run([
    unit('hpea', { selectionLife: life(300000, 'ownTarget') }),
    unit('hpea', { selectionLife: life(300000, 'presub') })
  ]);
  assert.notStrictEqual(own.state, 'possiblyLost');
  assert.notStrictEqual(seen.state, 'possiblyLost');
});

check('not in the last seconds of the game: the replay may stop before the list that shows it', () => {
  const [ls] = run([unit('hpea', { selectionLife: life(GAME_END - 10000, 'target') })]);
  assert.notStrictEqual(ls.state, 'possiblyLost');
});

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
