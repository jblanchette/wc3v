/**
 * lifecycle-sim.js — the desktop app's idle → live → post lifecycle.
 *
 * Usage: node tools/lifecycle-sim.js [--verbose]
 *
 * There was no test for any of this, which is how it stayed broken. The only
 * state-machine test in the repo was watcher.rs's, and tools/overlay-shots.js
 * walks the phases by handing the renderer four hand-built payloads — it never
 * runs a transition. So the bug everyone could see (the app dropping to idle
 * between games, then jumping back onto a match that had already finished) had
 * nothing that could catch it.
 *
 * This drives the real js/scout.js and js/match-phase.js against a scripted tape
 * of ladder answers and a fake clock. No browser, no network, no timers.
 *
 * What this pins down:
 *   • a lookup FAILURE moves nothing — not the card, not the miss counter
 *   • one clean "no match" does not end a game; two in a row do
 *   • a replay landing ends the match, and the ladder handing that same match
 *     back afterwards is ignored
 *   • a genuinely new match id still starts a new game
 *   • the phase never returns to idle once anything has been seen
 *   • a replay that cannot be parsed still ends the match
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const VERBOSE = process.argv.includes('--verbose');

const SRC = path.join(__dirname, '..', 'desktop', 'src-frontend', 'js');

// ── Harness ─────────────────────────────────────────────────────────────────

// The modules are browser IIFEs. They publish onto `window` and, since this
// change, also onto `module.exports` so they can be required directly — but the
// sandbox is what lets the clock be replaced, which is the whole point here.
const load = (file, sandbox) => {
  const p = path.join(SRC, file);
  vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: p });
};

/** A world with a clock nothing advances except this harness. */
const makeWorld = () => {
  let clock = 0;
  let seq = 0;
  const timers = new Map();
  const EPOCH = 1755000000000;

  const sandbox = {
    window: {},
    module: undefined,
    console,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { fn, at: clock + (ms || 0) });
      return id;
    },
    clearTimeout: (id) => { timers.delete(id); },
    Date: class extends Date {
      constructor (...args) { super(...(args.length ? args : [EPOCH + clock])); }
      static now () { return EPOCH + clock; }
    }
  };
  vm.createContext(sandbox);
  load('match-phase.js', sandbox);
  load('scout.js', sandbox);

  // Run the next scheduled poll and wait for it to finish. Returns false when
  // nothing is scheduled, which is itself a fact worth asserting.
  const step = async () => {
    let pick = null;
    for (const [id, t] of timers) {
      if (!pick || t.at < pick[1].at) pick = [id, t];
    }
    if (!pick) return false;
    timers.delete(pick[0]);
    clock = pick[1].at;
    await pick[1].fn();
    return true;
  };

  return { sandbox, step, now: () => clock };
};

/**
 * A scout wired to a scripted tape, with the phase owner behind it exactly as
 * app.js wires them.
 *
 * `tape` is what w3c.ongoing answers, one entry per call. Running off the end
 * repeats the last entry, so a scenario can end with "and then it stays like
 * that" without padding.
 */
const rig = (tape) => {
  const world = makeWorld();
  const { createMatchPhase } = world.sandbox.window;
  const { createScout } = world.sandbox.window;

  const phases = [];      // every phase the owner settled on, in order
  const announced = [];   // every onMatch payload, in order
  let cursor = 0;

  const phase = createMatchPhase({ log: () => {} });
  phase.subscribe((snap) => {
    if (!phases.length || phases[phases.length - 1] !== snap.phase) phases.push(snap.phase);
  });

  const scout = createScout({
    w3c: {
      enabled: true,
      isTag: (n) => /#\d+$/.test(String(n || '')),
      async ongoing () {
        const at = Math.min(cursor, tape.length - 1);
        cursor += 1;
        const answer = tape[at];
        if (VERBOSE) console.log(`  t+${world.now()}ms  ladder → ${answer.state}${answer.match ? ' ' + answer.match.id : ''}`);
        return answer;
      },
      async stats () { return { mmr: 1800, rank: 42, games: 100, wins: 55, losses: 45 }; }
    },
    // Empty on purpose: bookOn returns null without touching ProfileAggregate,
    // and the book is not what this test is about.
    store: { corpus: [] },
    log: () => {},
    identityName: () => 'Me#1234',
    watched: async () => true,
    onMatch: (match, ladder, book) => {
      announced.push(match ? match.id : null);
      if (match) phase.setLive(match, ladder, book);
      else phase.clearLive();
    },
    onLadder: () => {}
  });

  return { world, phase, scout, phases, announced, calls: () => cursor };
};

const matchOf = (id) => ({
  state: 'live',
  match: {
    id,
    map: 'TurtleRock_v2.0',
    mode: 1,
    startedAt: null,
    me: { tag: 'Me#1234', name: 'Me', race: 'H' },
    opponents: [{ tag: 'Them#5678', name: 'Them', race: 'O' }]
  }
});
const NONE = { state: 'none', match: null };
const UNKNOWN = { state: 'unknown', match: null };

// ── Scenarios ───────────────────────────────────────────────────────────────

const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

scenario('a lookup failure moves nothing', async () => {
  const r = rig([matchOf('A'), UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN]);
  r.phase.seedGame();
  await r.scout.start();                       // tape[0] → live A
  for (let i = 0; i < 4; i++) await r.world.step();

  assert.deepStrictEqual(r.phases, ['idle', 'post', 'live'],
    'seeding rests in post, then the match goes live and stays there');
  assert.deepStrictEqual(r.announced, ['A'],
    'four failed lookups must not announce anything');
  assert.strictEqual(r.scout.liveMatch && r.scout.liveMatch.id, 'A',
    'the live match survives every failure');
});

scenario('one clean miss holds, two end the match', async () => {
  const r = rig([matchOf('A'), NONE, NONE]);
  r.phase.seedGame();
  await r.scout.start();

  await r.world.step();                        // first NONE
  assert.strictEqual(r.phase.phase, 'live',
    'a single "no match" is not a game ending');
  assert.deepStrictEqual(r.announced, ['A']);

  await r.world.step();                        // second NONE
  assert.strictEqual(r.phase.phase, 'post',
    'two in a row is a disconnect, and the card comes down');
  assert.deepStrictEqual(r.announced, ['A', null]);
});

scenario('an unknown between two misses resets the count', async () => {
  const r = rig([matchOf('A'), NONE, UNKNOWN, NONE]);
  r.phase.seedGame();
  await r.scout.start();
  await r.world.step();                        // NONE   → 1 miss
  await r.world.step();                        // UNKNOWN → holds, no clear
  assert.strictEqual(r.phase.phase, 'live');
  await r.world.step();                        // NONE   → 2nd consecutive
  assert.strictEqual(r.phase.phase, 'post',
    'two DEFINITE misses either side of a timeout still end it');
});

// The bug the user reported, in full.
scenario('the ladder cannot hand back a match whose replay already landed', async () => {
  const r = rig([matchOf('A'), matchOf('A'), matchOf('A'), matchOf('A')]);
  r.phase.seedGame();
  await r.scout.start();
  assert.strictEqual(r.phase.phase, 'live');

  // A replay lands. This is what app.js does, in this order.
  r.scout.dismiss('A');
  r.phase.gameLanded();
  assert.strictEqual(r.phase.phase, 'post');
  assert.deepStrictEqual(r.announced, ['A', null]);

  // The ladder keeps serving the finished match for a while afterwards. Every
  // one of these polls used to re-latch it and throw the report column onto a
  // scouting panel for the game the user had just finished reading about.
  for (let i = 0; i < 3; i++) await r.world.step();
  assert.strictEqual(r.phase.phase, 'post',
    'a finished match must not come back');
  assert.deepStrictEqual(r.announced, ['A', null],
    'and it must not be announced again');
  assert.strictEqual(r.scout.liveMatch, null);
});

scenario('a genuinely new match still starts', async () => {
  const r = rig([matchOf('A'), matchOf('A'), matchOf('B'), matchOf('B')]);
  r.phase.seedGame();
  await r.scout.start();
  r.scout.dismiss('A');
  r.phase.gameLanded();

  await r.world.step();                        // stale A → ignored
  assert.deepStrictEqual(r.announced, ['A', null]);

  await r.world.step();                        // B → a real new game
  assert.strictEqual(r.phase.phase, 'live');
  assert.deepStrictEqual(r.announced, ['A', null, 'B']);

  await r.world.step();                        // B again → already drawn
  assert.deepStrictEqual(r.announced, ['A', null, 'B'],
    'the same match must not be re-announced on every poll');
});

scenario('idle is unreachable once anything has been seen', async () => {
  const r = rig([NONE, NONE, NONE, NONE]);
  r.phase.seedGame();                          // a stored game is on screen
  await r.scout.start();
  for (let i = 0; i < 3; i++) await r.world.step();

  assert.strictEqual(r.phase.phase, 'post',
    'between games the app holds the previous one');
  assert.ok(!r.phases.slice(1).includes('idle'),
    `never back to idle, got ${r.phases.join(' → ')}`);
});

scenario('a fresh install with nothing to show does start idle', async () => {
  const r = rig([NONE, NONE]);
  await r.scout.start();                       // no seedGame: nothing on disk
  await r.world.step();
  assert.strictEqual(r.phase.phase, 'idle',
    'idle is a real state — it just means "nothing has ever happened"');
});

scenario('a replay that cannot be parsed still ends the match', async () => {
  const r = rig([matchOf('A'), matchOf('A')]);
  r.phase.seedGame();
  await r.scout.start();
  assert.strictEqual(r.phase.phase, 'live');

  // app.js's failure path.
  r.scout.dismiss('A');
  r.phase.parseFailed('game.w3g could not be read');
  assert.strictEqual(r.phase.phase, 'post',
    'the app used to sit in live forever on a bad file');
  assert.ok(r.phase.note, 'and it says why rather than showing an empty screen');

  await r.world.step();
  assert.strictEqual(r.phase.phase, 'post', 'and the stale match does not revive it');
});

scenario('the poll interval follows what the tick actually found', async () => {
  const r = rig([matchOf('A'), matchOf('A')]);
  await r.scout.start();
  // start() awaits its tick before scheduling, so the interval is the LIVE one.
  // It used to schedule off the pre-tick state and always pick 20s, mid-game.
  const before = r.world.now();
  await r.world.step();
  assert.strictEqual(r.world.now() - before, 60000,
    `a live match polls at 60s, got ${r.world.now() - before}ms`);
});

scenario('switching the feature off does not blacklist the live match', async () => {
  const r = rig([matchOf('A'), matchOf('A')]);
  r.phase.seedGame();
  await r.scout.start();
  r.scout.stop();
  assert.strictEqual(r.phase.phase, 'post');

  // Back on, same match still running. `stop` must not have recorded A as
  // finished, or the match would be invisible for the rest of the session.
  await r.scout.start();
  assert.strictEqual(r.phase.phase, 'live', 'the match comes back');
  assert.deepStrictEqual(r.announced, ['A', null, 'A']);
});

// ── Run ─────────────────────────────────────────────────────────────────────

(async () => {
  let failed = 0;
  for (const s of scenarios) {
    if (VERBOSE) console.log(`\n${s.name}`);
    try {
      await s.fn();
      console.log(`  ok   ${s.name}`);
    } catch (e) {
      failed += 1;
      console.log(`  FAIL ${s.name}`);
      console.log(`       ${e.message}`);
    }
  }
  console.log(`\n${scenarios.length - failed}/${scenarios.length} passed`);
  process.exit(failed ? 1 : 0);
})();
