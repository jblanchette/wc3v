/**
 * test-release-policy.js is the pure half of
 * desktop/src-frontend/js/release-policy.js.
 *
 * Usage: node tools/test-release-policy.js
 *
 * What this pins down:
 *   • version comparison is numeric per segment ("1.0.10" is newer than "1.0.9")
 *   • a version below `minimum` must update; equal or above does not; no
 *     policy, no minimum, or an unparseable minimum never forces anything
 *   • a setup marker older than `onboard_from` must re-onboard; a marker
 *     that is not a version (the old "1") counts as older than anything; a
 *     machine never set up (null) is left to the ordinary first run
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'desktop', 'src-frontend', 'js', 'release-policy.js');
const sandbox = { window: {}, setTimeout };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: SRC });
const { cmpVersion, mustUpdate, mustOnboard } = sandbox.window.ReleasePolicy;
assert.ok(cmpVersion && mustUpdate && mustOnboard, 'release-policy.js should publish window.ReleasePolicy');

assert.strictEqual(cmpVersion('1.0.10', '1.0.9'), 1, 'numeric, not lexical');
assert.strictEqual(cmpVersion('1.0.9', '1.0.10'), -1);
assert.strictEqual(cmpVersion('1.0', '1.0.0'), 0, 'missing segments are zero');
assert.strictEqual(cmpVersion('2', '1.9.9'), 1);
assert.strictEqual(cmpVersion('1', '1.0.0'), 0);

assert.strictEqual(mustUpdate({ minimum: '1.0.10' }, '1.0.9'), true);
assert.strictEqual(mustUpdate({ minimum: '1.0.10' }, '1.0.10'), false, 'equal is allowed');
assert.strictEqual(mustUpdate({ minimum: '1.0.10' }, '1.1.0'), false);
assert.strictEqual(mustUpdate({ minimum: null }, '1.0.9'), false, 'no minimum');
assert.strictEqual(mustUpdate(null, '1.0.9'), false, 'no policy');
assert.strictEqual(mustUpdate({ minimum: 'soon' }, '1.0.9'), false, 'garbage never forces');
assert.strictEqual(mustUpdate({ minimum: '1.0.10' }, 'preview'), false, 'an unversioned build is never forced');

assert.strictEqual(mustOnboard({ onboard_from: '1.0.10' }, '1.0.9'), true);
assert.strictEqual(mustOnboard({ onboard_from: '1.0.10' }, '1.0.10'), false, 'set up on it is fine');
assert.strictEqual(mustOnboard({ onboard_from: '1.0.10' }, '1.0.11'), false);
assert.strictEqual(mustOnboard({ onboard_from: '1.0.10' }, '1'), true, 'the old "1" marker is older than anything');
assert.strictEqual(mustOnboard({ onboard_from: '1.0.10' }, null), false, 'never set up is the ordinary first run');
assert.strictEqual(mustOnboard({ onboard_from: null }, '1'), false, 'no onboard_from');
assert.strictEqual(mustOnboard(null, '1'), false);

console.log('test-release-policy: all assertions passed');
