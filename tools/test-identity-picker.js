/**
 * test-identity-picker.js is the pure half of
 * desktop/src-frontend/js/identity-picker.js.
 *
 * Usage: node tools/test-identity-picker.js
 *
 * The picker turns the seats named in the newest replay headers into cards,
 * and a typed name into matches. Both are plain functions on
 * window.IdentityPicker, so they run here without a DOM.
 *
 * What this pins down:
 *   • one card per player however the name was cased, races folded in,
 *     ordered by how many of the recent games they were in
 *   • the game count is distinct files, so a name seen twice in one replay
 *     (a header quirk) counts once
 *   • "jeef" finds "Jeef#1496": the part before the #tag matches whole, then
 *     a prefix, then anywhere inside, exact first, each name once
 *   • an empty query matches nothing
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'desktop', 'src-frontend', 'js', 'identity-picker.js');
const sandbox = { window: { UIBits: { node: () => ({}), raceMark: () => ({}) } }, document: {}, setTimeout };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: SRC });
const picker = sandbox.window.IdentityPicker;
assert.ok(picker && picker.summarise && picker.matchNames, 'identity-picker.js should publish window.IdentityPicker');
// Values come out of the vm's own realm with its own Array prototype, which
// deepStrictEqual treats as a different type. Flatten to this realm first.
const plain = (x) => JSON.parse(JSON.stringify(x));
const summarise = (seats) => plain(picker.summarise(seats));
const matchNames = (q, names) => plain(picker.matchNames(q, names));

// ── summarise ──────────────────────────────────────────────────────────────
{
  const seats = [
    { name: 'Jeef#1496', race: 'H', fileName: 'a.w3g', playedAt: 300 },
    { name: 'Happy#2777', race: 'U', fileName: 'a.w3g', playedAt: 300 },
    { name: 'JEEF#1496', race: 'O', fileName: 'b.w3g', playedAt: 200 },
    { name: 'Grubby#1234', race: 'O', fileName: 'b.w3g', playedAt: 200 },
    { name: 'Jeef#1496', race: 'H', fileName: 'c.w3g', playedAt: 100 },
    { name: 'Jeef#1496', race: 'H', fileName: 'c.w3g', playedAt: 100 },   // twice in one header
    { name: 'Happy#2777', race: 'U', fileName: 'c.w3g', playedAt: 100 },
    { name: '', race: 'H', fileName: 'c.w3g', playedAt: 100 }
  ];
  const s = summarise(seats);
  assert.strictEqual(s.total, 3, 'three distinct games');
  assert.deepStrictEqual(s.rows.map(r => r.name), ['Jeef#1496', 'Happy#2777', 'Grubby#1234'],
    'ordered by games, first spelling kept');
  assert.strictEqual(s.rows[0].games, 3, 'a duplicate seat in one header counts once');
  assert.deepStrictEqual(s.rows[0].races, ['H', 'O'], 'races folded, in first-seen order');
  assert.strictEqual(s.rows[0].lastAt, 300);
  assert.strictEqual(s.rows[1].games, 2);
  assert.deepStrictEqual(summarise([]), { total: 0, rows: [] });
}

// ── matchNames ─────────────────────────────────────────────────────────────
{
  const names = ['Jeef#1496', 'Happy#2777', 'jeefy#1', 'NotJeef#9', 'Jeef#1496', 'Grubby#1234', 'Jeef'];
  assert.deepStrictEqual(matchNames('jeef', names), ['Jeef', 'Jeef#1496', 'jeefy#1', 'NotJeef#9'],
    'exact, then the base name, then prefix, then anywhere; each once');
  assert.deepStrictEqual(matchNames('JEEF#1496', names), ['Jeef#1496', 'Jeef'],
    'a full tag is exact first, case blind; the untagged base name follows');
  assert.deepStrictEqual(matchNames('jeef#9', names), ['Jeef#1496', 'Jeef', 'NotJeef#9'],
    'a wrong tag still finds the base name first; the substring hit trails');
  assert.deepStrictEqual(matchNames('ubby', names), ['Grubby#1234'], 'anywhere inside');
  assert.deepStrictEqual(matchNames('', names), [], 'nothing typed, nothing matched');
  assert.deepStrictEqual(matchNames('zzz', names), [], 'no match is an empty list, not an error');
  assert.deepStrictEqual(matchNames('x', null), []);
}

console.log('test-identity-picker: all assertions passed');
