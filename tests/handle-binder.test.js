/*
 * handle-binder.test.js — pure unit tests for HandleBinder.
 *
 * Covers:
 *   1. ties the simulation made are kept when the lists agree, dropped when
 *      the lists name another type, and give way to the creation order
 *   2. units are aligned to handles in creation order, typed handles only
 *      take their type (or a form of it)
 *   3. no unit is tied to a handle that existed before the unit could have,
 *      by its own first sighting or by a later-allocated handle's (madeBy)
 *   4. the counter → creation time fit is monotone
 *
 * Run: `node tests/handle-binder.test.js`
 */

const assert = require('assert');
const HandleBinder = require('../lib/HandleBinder');

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

const unit = (id, type, born, handle = null, forms = [type], earliest = born) =>
  ({ id, type, born, earliest, handle, forms: new Set(forms) });
const handle = (key, first, types = []) => ({
  key, counter: Number(key.split('/')[1]), first, types: types.map(type => ({ t: first, type }))
});
const handles = (...hs) => new Map(hs.map(h => [h.key, h]));

console.log('[ties the simulation made]');

check('a tie whose handle the lists typed the same is kept', () => {
  const ties = HandleBinder.bind([unit(1, 'hfoo', 1000, '5/500')], handles(handle('5/500', 2000, ['hfoo'])));
  assert.strictEqual(ties.get(1), '5/500');
});

check('a tie whose handle the lists typed otherwise is dropped and redone', () => {
  const ties = HandleBinder.bind(
    [unit(1, 'hrif', 1000, '5/500')],
    handles(handle('5/500', 2000, ['hfoo']), handle('6/600', 3000, ['hrif'])));
  assert.strictEqual(ties.get(1), '6/600');
});

check('a form of the unit counts as its type', () => {
  const ties = HandleBinder.bind([unit(1, 'edoc', 1000, '5/500')], handles(handle('5/500', 2000, ['edcm'])));
  assert.strictEqual(ties.get(1), '5/500');
});

check('a simulation tie out of creation order gives way to two in order', () => {
  // WC3V tied the unit trained first to the later handle
  const us = [unit(1, 'hrif', 10000, '2/200'), unit(2, 'hrif', 30000, '1/100')];
  const hs = handles(handle('1/100', 40000, ['hrif']), handle('2/200', 40000, ['hrif']));
  const ties = HandleBinder.bind(us, hs);
  assert.strictEqual(ties.get(1), '1/100');
  assert.strictEqual(ties.get(2), '2/200');
});

console.log('[alignment]');

check('untied units take unclaimed handles in creation order', () => {
  const us = [unit(1, 'hrif', 10000), unit(2, 'hrif', 30000), unit(3, 'hrif', 50000)];
  const hs = handles(handle('7/900', 60000), handle('8/700', 60000), handle('9/800', 60000));
  const ties = HandleBinder.bind(us, hs);
  assert.strictEqual(ties.get(1), '8/700');
  assert.strictEqual(ties.get(2), '9/800');
  assert.strictEqual(ties.get(3), '7/900');
});

check('a typed handle only takes a unit of its type', () => {
  const us = [unit(1, 'hfoo', 10000), unit(2, 'hrif', 12000)];
  const hs = handles(handle('1/100', 20000, ['hrif']), handle('2/200', 20000));
  const ties = HandleBinder.bind(us, hs);
  assert.strictEqual(ties.get(2), '1/100');
  assert.strictEqual(ties.get(1), undefined);   // order: hfoo was made first, its handle would sort first
});

check('no unit is tied to a handle listed long before the unit was trained', () => {
  const ties = HandleBinder.bind([unit(1, 'hfoo', 200000)], handles(handle('1/100', 20000)));
  assert.strictEqual(ties.size, 0);
});

check('a handle allocated before one already listed cannot be a unit made after that', () => {
  const madeBy = (counter) => (counter <= 500 ? 15000 : Infinity);
  const ties = HandleBinder.bind([unit(1, 'hfoo', 90000)], handles(handle('1/100', 100000)), [], madeBy);
  assert.strictEqual(ties.size, 0);
});

check('a unit may come out before WC3V\'s training time (its queue held refused orders)', () => {
  const madeBy = () => 40000;
  const ties = HandleBinder.bind([unit(1, 'hfoo', 90000, null, ['hfoo'], 30000)],
    handles(handle('1/100', 100000)), [], madeBy);
  assert.strictEqual(ties.get(1), '1/100');
});

check('with anchors, the creation time the counter implies picks among handles', () => {
  const anchors = [{ counter: 1000, born: 10000 }, { counter: 2000, born: 20000 }, { counter: 3000, born: 30000 }];
  const us = [unit(1, 'hfoo', 20000)];
  const hs = handles(handle('1/1000', 40000), handle('2/2000', 40000), handle('3/3000', 40000));
  const ties = HandleBinder.bind(us, hs, anchors);
  assert.strictEqual(ties.get(1), '2/2000');
});

console.log('[counter clock]');

check('the fit is monotone and interpolates', () => {
  const fit = HandleBinder.counterClock([
    { counter: 100, born: 1000 }, { counter: 200, born: 3000 }, { counter: 300, born: 2000 },
    { counter: 400, born: 4000 }
  ]);
  assert.ok(fit(100) <= fit(200) && fit(200) <= fit(300) && fit(300) <= fit(400));
  assert.ok(Math.abs(fit(350) - (fit(300) + fit(400)) / 2) < 1e-6);
  assert.strictEqual(fit(50), fit(100));
});

check('too few anchors: no fit', () => {
  assert.strictEqual(HandleBinder.counterClock([{ counter: 1, born: 1 }]), null);
});

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall passed');
