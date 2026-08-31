/**
 * test-backfill-1v1.js — the "only parse 1v1 games" gate in
 * desktop/src-frontend/js/backfill.js.
 *
 * Usage:
 *   node tools/test-backfill-1v1.js               synthetic + 120 real replays
 *   node tools/test-backfill-1v1.js --corpus=all  synthetic + every replay in replays/
 *   node tools/test-backfill-1v1.js --corpus=0    synthetic only
 *
 * Same harness idiom as test-backfill-catchup.js: the engine takes every
 * dependency by injection, so the gate can be driven against fakes. What this
 * pins down:
 *   • filter on: every 1v1 parses, everything else is counted and skipped
 *   • filter off: byte-for-byte today's behaviour — every game parses and the
 *     peek is never even called
 *   • a peek that fails or answers nothing falls through to the full parse;
 *     the filter must never drop a game it could not classify
 *   • already-stored games are skipped before the peek, so they never pay it
 *   • a filtered game is not marked failed and reports its chip as done
 *   • an engine built without the filter deps behaves as filter-off
 *
 * The corpus pass then runs the same gate over real .w3g files with the real
 * header peek (tools/lib/replay-peek.js — the same playersFromSlots +
 * computeGameMode the app's bundle uses; tools/peek-mode-check.js proves the
 * two verdicts agree with the full parse). It asserts the invariant rather
 * than a number: parsed = the 1v1s plus the unclassifiable, skipped = the
 * rest, nothing lost — and prints the measured skip rate.
 */

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'desktop', 'src-frontend', 'js', 'backfill.js');
const sandbox = { window: {}, performance: { now: () => Date.now() } };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: SRC });
const createBackfill = sandbox.window.createBackfill;
assert.ok(createBackfill, 'backfill.js should publish window.createBackfill');

const args = {};
process.argv.slice(2).forEach((raw) => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

// opts: scan (replay list), modes (file_name → gameMode), only1v1,
//       stored (keys), peekFailOn (regex), noFilterDeps
const harness = (opts = {}) => {
  const parsed = [];
  const peeked = [];
  const failuresSaved = [];
  const progress = [];
  const stored = new Set(opts.stored || []);
  let statusLine = '';

  const deps = {
    invoke: async (cmd, a) => {
      if (cmd === 'scan_all') return opts.scan;
      if (cmd === 'list_parse_failures') return [];
      if (cmd === 'replay_key') {
        return { key: 'key:' + a.path, modifiedMs: 0 };
      }
      if (cmd === 'save_parse_failure') { failuresSaved.push(a.key); return null; }
      return null;
    },
    log: () => {},
    makeWorker: () => ({ terminate () {} }),
    parseOn: async (_w, p) => { parsed.push(p); return { fake: true }; },
    persistSummary: async () => ({}),
    isCurrent: (key) => stored.has(key),
    status: (t) => { statusLine = t; },
    onIdleChange: () => {}
  };
  if (!opts.noFilterDeps) {
    deps.only1v1 = async () => !!opts.only1v1;
    deps.peekOn = async (_w, p) => {
      const name = p.split(/[\\/]/).pop();
      peeked.push(name);
      if (opts.peekFailOn && opts.peekFailOn.test(name)) throw new Error('bad header');
      if (opts.peekOn) return opts.peekOn(p);
      return { gameMode: (opts.modes && opts.modes[name]) || '1v1' };
    };
  }

  return { deps, parsed, peeked, failuresSaved, progress,
    get status () { return statusLine; },
    hooks: { onProgress: (file, phase) => progress.push(`${file}:${phase}`) } };
};

const scanOf = (names) => ({
  replays: names.map((n) => ({ path: `C:\\r\\${n}`, file_name: n, interesting: true }))
});

const settle = () => new Promise(r => setImmediate(r));
const runToIdle = async (bf) => {
  for (let i = 0; i < 20000 && bf.running; i++) await settle();
  assert.ok(!bf.running, 'run should reach idle');
};

(async () => {
  const MODES = {
    'a.w3g': '1v1', 'b.w3g': '2v2', 'c.w3g': '1v1', 'd.w3g': 'ffa',
    'e.w3g': 'custom', 'f.w3g': '4v4', 'g.w3g': '1v1'
  };
  const NAMES = Object.keys(MODES);

  // ── Filter on: every 1v1 kept, everything else dropped and counted ─────
  {
    const h = harness({ scan: scanOf(NAMES), modes: MODES, only1v1: true });
    const bf = createBackfill(h.deps);
    await bf.start({ onProgress: h.hooks.onProgress });
    await runToIdle(bf);

    const parsedNames = h.parsed.map(p => p.split(/[\\/]/).pop()).sort();
    assert.deepStrictEqual(parsedNames, ['a.w3g', 'c.w3g', 'g.w3g'],
      'exactly the 1v1s parse');
    assert.strictEqual(h.failuresSaved.length, 0,
      'a filtered game is not a failure');
    // Every file resolves its chip, filtered ones included.
    for (const n of NAMES) {
      assert.ok(h.progress.includes(`${n}:done`), `${n} reported done`);
    }
    assert.ok(/4 not 1v1/.test(h.status),
      `the skip count is surfaced, not silent (got "${h.status}")`);
  }

  // ── Filter off: today's behaviour exactly, peek never called ───────────
  {
    const h = harness({ scan: scanOf(NAMES), modes: MODES, only1v1: false });
    const bf = createBackfill(h.deps);
    await bf.start({});
    await runToIdle(bf);

    assert.strictEqual(h.parsed.length, NAMES.length, 'everything parses');
    assert.strictEqual(h.peeked.length, 0, 'and nothing paid for a peek');
    assert.ok(!/not 1v1/.test(h.status), 'no filter talk when the filter is off');
  }

  // ── A failed or empty peek falls through to the full parse ─────────────
  {
    const h = harness({
      scan: scanOf(['a.w3g', 'b.w3g', 'x.w3g']),
      modes: { 'a.w3g': '1v1', 'b.w3g': '2v2' },
      only1v1: true,
      peekFailOn: /x\.w3g/
    });
    const bf = createBackfill(h.deps);
    await bf.start({});
    await runToIdle(bf);

    const parsedNames = h.parsed.map(p => p.split(/[\\/]/).pop()).sort();
    assert.deepStrictEqual(parsedNames, ['a.w3g', 'x.w3g'],
      'the unclassifiable replay parses rather than being dropped');
  }
  {
    // A peek that succeeds but has no gameMode at all.
    const h = harness({
      scan: scanOf(['a.w3g']),
      only1v1: true,
      peekOn: () => ({ players: [] })
    });
    const bf = createBackfill(h.deps);
    await bf.start({});
    await runToIdle(bf);
    assert.strictEqual(h.parsed.length, 1, 'no verdict means parse, not drop');
  }

  // ── Already-stored games are skipped before the peek ───────────────────
  {
    const h = harness({
      scan: scanOf(NAMES), modes: MODES, only1v1: true,
      stored: ['key:C:\\r\\b.w3g', 'key:C:\\r\\a.w3g']
    });
    const bf = createBackfill(h.deps);
    await bf.start({});
    await runToIdle(bf);

    assert.ok(!h.peeked.includes('a.w3g') && !h.peeked.includes('b.w3g'),
      'stored games never pay for a peek');
    const parsedNames = h.parsed.map(p => p.split(/[\\/]/).pop()).sort();
    assert.deepStrictEqual(parsedNames, ['c.w3g', 'g.w3g'],
      'the stored 1v1 stays stored, the rest of the 1v1s parse');
  }

  // ── No filter deps at all: filter-off behaviour ────────────────────────
  {
    const h = harness({ scan: scanOf(NAMES), noFilterDeps: true });
    const bf = createBackfill(h.deps);
    await bf.start({});
    await runToIdle(bf);
    assert.strictEqual(h.parsed.length, NAMES.length,
      'an engine built without the filter deps reads everything');
  }

  console.log('test-backfill-1v1: synthetic assertions passed');

  // ── The corpus pass: the same gate over real replays ───────────────────
  const corpusArg = args.corpus === undefined ? '120' : String(args.corpus);
  const corpusLimit = corpusArg === 'all' ? Infinity : Number(corpusArg);
  if (!corpusLimit) return;

  const W3G_DIR = path.join(__dirname, '..', 'replays');
  if (!fs.existsSync(W3G_DIR)) {
    console.log('  (no replays/ directory; corpus pass skipped)');
    return;
  }
  const { peekReplay } = require('./lib/replay-peek');

  let files = fs.readdirSync(W3G_DIR).filter(f => /\.(w3g|nwg)$/i.test(f));
  if (files.length > corpusLimit) files = files.slice(0, corpusLimit);

  const modeOf = new Map();      // file → gameMode, or null when unclassifiable
  const t0 = Date.now();
  for (const f of files) {
    const r = await peekReplay(path.join(W3G_DIR, f));
    modeOf.set(f, r.ok ? r.gameMode : null);
  }
  const peekMs = Date.now() - t0;

  const h = harness({
    scan: scanOf(files),
    only1v1: true,
    peekOn: (p) => {
      const mode = modeOf.get(p.split(/[\\/]/).pop());
      if (mode === null) throw new Error('peek failed');
      return { gameMode: mode };
    }
  });
  const bf = createBackfill(h.deps);
  await bf.start({});
  await runToIdle(bf);

  const parsedSet = new Set(h.parsed.map(p => p.split(/[\\/]/).pop()));
  const tally = {};
  let kept1v1 = 0, dropped = 0, failedOpen = 0;
  for (const [f, mode] of modeOf) {
    tally[mode || 'unreadable'] = (tally[mode || 'unreadable'] || 0) + 1;
    if (mode === '1v1') {
      assert.ok(parsedSet.has(f), `1v1 replay dropped by the gate: ${f}`);
      kept1v1++;
    } else if (mode === null) {
      assert.ok(parsedSet.has(f), `unclassifiable replay dropped: ${f}`);
      failedOpen++;
    } else {
      assert.ok(!parsedSet.has(f), `non-1v1 replay parsed anyway: ${f} (${mode})`);
      dropped++;
    }
  }
  assert.strictEqual(parsedSet.size, kept1v1 + failedOpen,
    'nothing parsed outside the kept sets');

  console.log(`test-backfill-1v1: corpus pass over ${files.length} real replays ` +
    `(${Math.round(peekMs / files.length)}ms per peek)`);
  console.log(`  kept ${kept1v1} 1v1` +
    (failedOpen ? ` + ${failedOpen} unclassifiable (fail open)` : '') +
    `, skipped ${dropped} (${(100 * dropped / files.length).toFixed(1)}%)`);
  console.log('  modes seen: ' +
    Object.entries(tally).map(([m, n]) => `${m}=${n}`).join(' '));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
