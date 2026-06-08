//
// walkthrough-evidence.test.js — hard gate: every NEW-PLAYER walkthrough's
// claims must be backed by replay-only evidence (creep route, level honesty,
// step times, decisive fight). Run: `node tests/walkthrough-evidence.test.js`.
//
// This is the regression guard for the "route to level 3" bug — a creep step
// that framed a 2-second walk-through instead of the real clearing fight, and
// claimed a level the hero never reached. The rules live in
// tools/lib/walkthrough-rules.js (shared with tools/validate-walkthrough.js).
//
'use strict';

const assert = require('assert');
const rules = require('../tools/lib/walkthrough-rules.js');

function runTests () {
  const targets = rules.newPlayerTargets();
  assert(targets.length > 0, 'expected at least one new-player replay target');

  let pass = 0;
  for (const t of targets) {
    const raw = rules.loadReplay(t.replayId);
    assert(raw, `replay not found: ${t.replayId}`);
    const res = rules.evaluate(raw, t.playerSlot, null);
    assert(!res.error, `${t.replayId}: ${res.error}`);
    for (const r of res.rules) {
      assert(r.pass, `${t.replayId} [${t.buildId}] — ${r.name}: ${r.why}`);
    }
    pass++;
    console.log(`  ✓ ${t.replayId} [${t.buildId}] follow=${res.followId} reachedL${res.reachedLevel} route=${res.route.camps.length}camp(s)`);
  }
  console.log(`\nwalkthrough-evidence: ${pass}/${targets.length} new-player replays pass all rules`);
}

try {
  runTests();
  console.log('PASS');
  process.exit(0);
} catch (e) {
  console.error('\nFAIL:', e.message);
  process.exit(1);
}
