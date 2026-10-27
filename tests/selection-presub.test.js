/*
 * selection-presub.test.js — how Player reads PreSubselection lists into its
 * selection, on hand-built actions (no replay needed).
 *
 * Covers:
 *   1. a click (deselect then select in one tick) takes the list as the
 *      whole new selection
 *   2. a shift-add keeps the units already selected and adds the listed ones
 *   3. a shift-added unit deselected again leaves the rest selected
 *
 * Run: `node tests/selection-presub.test.js`
 */

const assert = require('assert');
const logManager = require('../helpers/logManager');
logManager.setTestMode(true);
logManager.setProductionMode(true);
logManager.setLogger('selection-presub-test');

const EventTimer = require('../lib/EventTimer');
const Player = require('../lib/Player');

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

// handles: a Ziggurat, a ghoul, two acolytes
const ZIG = [ 100, 900 ], GHOUL = [ 200, 901 ], ACO1 = [ 300, 902 ], ACO2 = [ 400, 903 ];

function makePlayer () {
  const world = {
    findPossibleUnitByItemIds: () => null,
    addPlayerPossibleUnit: () => {}
  };
  const eventTimer = new EventTimer();
  const player = new Player(1, { teamId: 0, raceFlag: 8 }, { map: {} }, eventTimer, world, false);

  return {
    player,
    at: (gameTime) => { eventTimer.timer.gameTime = gameTime; },
    pre: (...units) => units.forEach(([ a, b ]) => player.preSubselection({ objectId1: a, objectId2: b })),
    sel: (selectMode, ...units) => player.changeSelection({
      selectMode,
      numberUnits: units.length,
      actions: units.map(([ a, b ]) => ({ itemId1: a, itemId2: b }))
    }),
    selected: () => player.selection.units.map(u => u.itemId1).sort((a, b) => a - b)
  };
}

console.log('[PreSubselection and the selection]');

check('a click takes the list as the whole selection', () => {
  const p = makePlayer();
  p.at(1000); p.pre(ACO1, ACO2); p.sel(SELECT, ACO1, ACO2);
  p.at(2000); p.pre(GHOUL); p.sel(DESELECT, ACO1, ACO2); p.sel(SELECT, GHOUL);
  assert.deepStrictEqual(p.selected(), [ 200 ]);
});

check('a shift-add keeps the units already selected', () => {
  const p = makePlayer();
  p.at(1000); p.pre(ZIG); p.sel(SELECT, ZIG);
  // shift-click on a ghoul: the list names only the ghoul
  p.at(2000); p.pre(GHOUL); p.sel(SELECT, GHOUL);
  assert.deepStrictEqual(p.selected(), [ 100, 200 ]);
});

check('a shift-drag over selected and new units adds the new ones', () => {
  const p = makePlayer();
  p.at(1000); p.pre(ZIG, ACO1); p.sel(DESELECT, GHOUL); p.sel(SELECT, ZIG, ACO1);
  // the box covers ACO1 (selected already) and ACO2 (new); only ACO2 is in the select
  p.at(2000); p.pre(ACO1, ACO2); p.sel(SELECT, ACO2);
  assert.deepStrictEqual(p.selected(), [ 100, 300, 400 ]);
});

check('deselecting the shift-added unit leaves the rest selected', () => {
  const p = makePlayer();
  p.at(1000); p.pre(ZIG); p.sel(SELECT, ZIG);
  p.at(2000); p.pre(GHOUL); p.sel(SELECT, GHOUL);
  // a click on the Ziggurat's portrait: the list names it, the ghoul is deselected
  p.at(3000); p.pre(ZIG); p.sel(DESELECT, GHOUL);
  assert.deepStrictEqual(p.selected(), [ 100 ]);
});

console.log('');
if (failures) {
  console.log(`FAILED — ${failures} check(s)`);
  process.exit(1);
} else {
  console.log('OK — all checks passed');
}
