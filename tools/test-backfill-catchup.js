/**
 * test-backfill-catchup.js — the first-boot catch-up path in
 * desktop/src-frontend/js/backfill.js.
 *
 * Usage: node tools/test-backfill-catchup.js
 *
 * The catch-up cannot be exercised in tools/desktop-preview.js: that harness
 * stubs the IPC bridge but has no .w3g files behind its summaries, so nothing
 * can actually parse. The engine takes every dependency by injection though,
 * so the queueing, the limit, the dedupe and the progress reporting can all be
 * driven here against fakes.
 *
 * What this pins down:
 *   • a limited run takes the NEWEST N and nothing more
 *   • LastReplay.w3g never enters the queue, at any limit
 *   • already-stored games are skipped rather than re-parsed
 *   • a known-bad key is skipped without being retried
 *   • onQueue/onProgress report every file exactly once
 *   • one replay failing does not stop the rest of the run
 *   • an unlimited run is unchanged by any of the above
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The module is a browser IIFE hanging itself off `window`.
const SRC = path.join(__dirname, '..', 'desktop', 'src-frontend', 'js', 'backfill.js');
const sandbox = { window: {}, performance: { now: () => Date.now() } };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: SRC });
const createBackfill = sandbox.window.createBackfill;
assert.ok(createBackfill, 'backfill.js should publish window.createBackfill');

// Newest first, which is the order the real scan returns.
const scanOf = (n) => ({
  replays: Array.from({ length: n }, (_, i) => ({
    path: `C:\\r\\game${i}.w3g`, file_name: `game${i}.w3g`, interesting: true
  }))
});

const harness = (opts = {}) => {
  const parsed = [];
  const progress = [];
  let queued = null;
  const stored = new Set(opts.stored || []);

  const deps = {
    invoke: async (cmd, args) => {
      if (cmd === 'scan_all') return opts.scan || scanOf(25);
      if (cmd === 'list_parse_failures') return opts.failures || [];
      if (cmd === 'replay_key') {
        // Content key derived from the path, the way the real command does.
        const n = /game(\d+)\.w3g/.exec(args.path)[1];
        return { key: `key${n}`, modifiedMs: 1700000000000 - Number(n) * 1000 };
      }
      if (cmd === 'save_parse_failure') return null;
      return null;
    },
    log: () => {},
    makeWorker: () => ({ terminate () {} }),
    parseOn: async (_w, p) => {
      if (opts.failOn && opts.failOn.test(p)) throw new Error('bad replay');
      parsed.push(p);
      return { fake: true };
    },
    persistSummary: async () => ({}),
    isStored: (key) => stored.has(key),
    status: () => {},
    onIdleChange: () => {}
  };

  return { deps, parsed, progress, get queued () { return queued; },
    hooks: {
      onQueue: (files) => { queued = files; },
      onProgress: (file, phase) => progress.push(`${file}:${phase}`)
    } };
};

const settle = () => new Promise(r => setImmediate(r));
const runToIdle = async (bf) => {
  for (let i = 0; i < 5000 && bf.running; i++) await settle();
  assert.ok(!bf.running, 'run should reach idle');
};

(async () => {
  // ── The limit is honoured, newest first ────────────────────────────────
  {
    const h = harness();
    const bf = createBackfill(h.deps);
    await bf.catchUp(10, h.hooks);
    await runToIdle(bf);

    assert.strictEqual(h.parsed.length, 10, 'a limit of 10 parses exactly 10');
    assert.deepStrictEqual(h.queued.length, 10, 'onQueue reports the capped queue');
    assert.strictEqual(h.queued[0], 'game0.w3g', 'newest first');
    assert.strictEqual(h.queued[9], 'game9.w3g', 'and stops at the tenth');
    assert.ok(!h.parsed.some(p => /game1[0-9]/.test(p)), 'nothing past the limit is touched');

    // Every queued file reports going in and coming out, once each.
    for (let i = 0; i < 10; i++) {
      assert.ok(h.progress.includes(`game${i}.w3g:parsing`), `game${i} reported parsing`);
      assert.ok(h.progress.includes(`game${i}.w3g:done`), `game${i} reported done`);
    }
    assert.strictEqual(h.progress.filter(p => p.endsWith(':done')).length, 10,
      'no file reports done twice');
  }

  // ── LastReplay.w3g is never queued ─────────────────────────────────────
  {
    const scan = scanOf(4);
    scan.replays.unshift({ path: 'C:\\r\\LastReplay.w3g', file_name: 'LastReplay.w3g', interesting: true });
    const h = harness({ scan });
    const bf = createBackfill(h.deps);
    await bf.catchUp(3, h.hooks);
    await runToIdle(bf);

    assert.ok(!h.queued.some(f => /lastreplay/i.test(f)),
      'LastReplay is filtered BEFORE the limit, not counted against it');
    assert.deepStrictEqual(h.queued, ['game0.w3g', 'game1.w3g', 'game2.w3g']);
  }

  // ── Already stored, and known bad, are both skipped ────────────────────
  {
    const h = harness({ stored: ['key0', 'key1'], failures: ['key2'] });
    const bf = createBackfill(h.deps);
    await bf.catchUp(5, h.hooks);
    await runToIdle(bf);

    assert.strictEqual(h.parsed.length, 2, 'only the two unseen replays parse');
    assert.ok(!h.parsed.some(p => /game[012]\.w3g/.test(p)), 'stored and failed keys skipped');
    // A skip still resolves its chip, or the quick nav would spin forever.
    assert.ok(h.progress.includes('game0.w3g:done'), 'a skipped file still reports done');
    assert.ok(h.progress.includes('game2.w3g:done'), 'a known-bad file still reports done');
  }

  // ── One bad replay does not stop the run ───────────────────────────────
  {
    const h = harness({ failOn: /game2\.w3g/ });
    const bf = createBackfill(h.deps);
    await bf.catchUp(5, h.hooks);
    await runToIdle(bf);

    assert.strictEqual(h.parsed.length, 4, 'the other four still parse');
    assert.ok(h.progress.includes('game2.w3g:failed'), 'the failure is reported as failed');
    assert.ok(!h.progress.includes('game2.w3g:done'), 'and not also as done');
  }

  // ── An unlimited run is the old behaviour ──────────────────────────────
  {
    const h = harness({ scan: scanOf(25) });
    const bf = createBackfill(h.deps);
    await bf.toggle();
    await runToIdle(bf);

    assert.strictEqual(h.parsed.length, 25, 'no limit means the whole scan');
    assert.strictEqual(h.queued, null, 'and no per-file reporting was asked for');
  }

  console.log('test-backfill-catchup: all assertions passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
