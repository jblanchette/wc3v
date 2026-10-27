/*
 * start-locations.test.js — pure unit tests for reading a map script's
 * start locations (LUAJASSFile.findStartLocations).
 *
 * Covers:
 *   1. World Editor JASS, one call per line
 *   2. Lua, one call per line
 *   3. Minified Lua: the whole script on one line, among other calls
 *   4. Optimised JASS: a space between the sign and the number
 *
 * Run: `node tests/start-locations.test.js`
 */

const assert = require('assert');
const LUAJASSFile = require('../lib/parsers/LUAJASSFile');

const { findStartLocations } = LUAJASSFile;

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

console.log('[findStartLocations]');

check('World Editor JASS', () => {
  const script = [
    'function config takes nothing returns nothing',
    '    call SetPlayers( 2 )',
    '    call DefineStartLocation( 0, -2176.0, -4672.0 )',
    '    call DefineStartLocation( 1, 2176.0, 4672.0 )',
    'endfunction'
  ].join('\r\n');

  assert.deepStrictEqual(findStartLocations(script), {
    0: { x: -2176, y: -4672 },
    1: { x: 2176, y: 4672 }
  });
});

check('Lua', () => {
  const script = [
    'function config()',
    '    SetPlayers(2)',
    '    DefineStartLocation(0, -3840.0, -3968.0)',
    '    DefineStartLocation(1, 3840.0, 3264.0)',
    'end'
  ].join('\n');

  assert.deepStrictEqual(findStartLocations(script), {
    0: { x: -3840, y: -3968 },
    1: { x: 3840, y: 3264 }
  });
});

check('minified Lua: one line, other calls around the start locations', () => {
  const script = "a['x.lua']=function(_ENV,...)local M={}M.f=function(N,O)BlzFrameSetVisible(N,O)end;" +
    'function config()SetMapName("TRIGSTR_001")SetPlayers(2)SetTeams(2)' +
    'DefineStartLocation(0,-3904.0,3328.0)DefineStartLocation(1,3904.0,-3840.0)' +
    'InitCustomPlayerSlots()end;return M end';

  assert.deepStrictEqual(findStartLocations(script), {
    0: { x: -3904, y: 3328 },
    1: { x: 3904, y: -3840 }
  });
});

check('optimised JASS: a space after the sign', () => {
  const script = 'call DefineStartLocation(0, - 1280.0, 256.0)\n' +
    'call DefineStartLocation(1, 5376.0, - 8448.0)\n';

  assert.deepStrictEqual(findStartLocations(script), {
    0: { x: -1280, y: 256 },
    1: { x: 5376, y: -8448 }
  });
});

check('no start locations', () => {
  assert.deepStrictEqual(findStartLocations('function main()\nend'), {});
});

console.log('');
if (failures) {
  console.log(`FAILED — ${failures} check(s)`);
  process.exit(1);
} else {
  console.log('OK — all checks passed');
}
