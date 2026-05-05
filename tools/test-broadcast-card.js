// Smoke test for the new broadcast-style replay card. Renders a card from a
// real parsed-replay record and verifies the resulting HTML contains every
// expected piece (race banner, map thumbnail src, timing pills, grade
// badge placeholder, action buttons). Catches regressions in
// MyReplays._renderCard() without needing a real browser.

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const vm = require('vm');

const ROOT = process.cwd();
const REPLAY_ID = '1342775468_Kaho_Happy_Hammerfall';
const REPLAY_W3G = path.join(ROOT, 'replays', `${REPLAY_ID}.w3g`);

// Lightweight DOM stub. Just enough so MyReplays' createElement / innerHTML
// path produces an inspectable HTML string.
const buildEl = (tag) => {
  const el = {
    tagName: tag.toUpperCase(),
    className: '',
    dataset: {},
    style: {},
    _innerHTML: '',
    _children: [],
    addEventListener: () => {},
    setAttribute: function (k, v) { this[k] = v; },
    removeAttribute: function (k) { delete this[k]; },
    hasAttribute: function (k) { return k in this; },
    appendChild: function (c) { this._children.push(c); },
    remove: () => {},
    querySelector: function (sel) {
      // Not a real selector engine — just enough to satisfy event listener lookups.
      return { addEventListener: () => {}, style: {}, dataset: {} };
    },
    querySelectorAll: () => [],
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    get innerHTML () { return this._innerHTML; },
    set innerHTML (v) { this._innerHTML = v; }
  };
  return el;
};

const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  setImmediate, queueMicrotask, TextEncoder, TextDecoder, Uint8Array, Buffer,
  crypto: { getRandomValues: (a) => { const b = require('crypto').randomBytes(a.length); for (let i = 0; i < a.length; i++) a[i] = b[i]; return a; } },
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  globalThis: null, window: {},
  document: {
    createElement: buildEl,
    getElementById: () => null,
    body: { appendChild: () => {} }
  },
  indexedDB: { open: () => ({}) },
  fetch: async () => ({ ok: false })
};
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'client/js/MyReplays.js'), 'utf8'), sandbox);

const my = new sandbox.window.MyReplays();

// Construct a record the way the upload pipeline would.
const parseToWc3v = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'client/replays', `${REPLAY_ID}.wc3v.gz`))).toString('utf8'));

const record = {
  id: 'abc1234567',
  uploadedAt: Date.now() - 28 * 60 * 1000,  // 28m ago
  race: 'U',
  mapName: 'Maps/W3Champions\\5185_w3c_251104_0950_Hammerfall.w3x',
  durationMs: 791200,
  players: Object.keys(parseToWc3v.players).map(slot => ({
    slot: parseInt(slot, 10),
    name: (parseToWc3v.replay.players[slot] || {}).name || `P${slot}`,
    race: parseToWc3v.players[slot].race
  })),
  parsedJson: parseToWc3v,
  originalFilename: REPLAY_ID + '.w3g'
};

const card = my._renderCard(record, { viewerPath: '/viewer' });
const html = card._innerHTML;

console.log('--- card class:', card.className);
console.log('--- card data-id:', card.dataset.id);
console.log();
console.log('--- HTML output (first 2KB):');
console.log(html.slice(0, 2000));
console.log();
console.log('--- HTML output (length):', html.length);
console.log();

const checks = [
  ['race-U class', /class="rep-card race-U"|class=\"rep-card race-U\"/.test(card.className) || /race-U/.test(card.className)],
  ['banner backdrop image', /rep-card-banner.*\/assets\/race-banners\/U\.jpg/.test(html)],
  ['map thumbnail', /rep-card-map.*\/maps\/Hammerfall.*gridmap\.jpg/.test(html)],
  ['user race badge UD', /rep-card-race-badge race-U[^-]/.test(html) && />UD</.test(html)],
  ['opponent race badge', /rep-card-race-badge.*rep-card-opp/.test(html)],
  // Grade badge: ABSENT when no lastCompare (rail-v2 contract). The badge only
  // appears after the user has compared the replay at least once.
  ['no grade badge when ungraded', !/rep-card-grade-badge/.test(html)],
  ['heroes row present', /rep-card-heroes/.test(html)],
  ['T2 timing pill', /rep-tp">T2 \d+:\d{2}/.test(html)],
  ['archetype label or none', /rep-card-build-label|rep-card-timings/.test(html)],
  ['Watch button (anchor)', /data-action="watch"/.test(html) && /\?local=abc1234567/.test(html)],
  ['Compare button', /data-action="compare"/.test(html)],
  ['Remove icon button', /data-action="remove"/.test(html)],
  ['No expo or expo pill', /rep-tp-expo|rep-tp-no/.test(html)]
];

let pass = 0, fail = 0;
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'OK ' : 'FAIL'}  ${label}`);
  if (ok) pass++; else fail++;
}
console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail > 0) process.exit(1);
console.log('\nOK: broadcast card renders all expected pieces.');
