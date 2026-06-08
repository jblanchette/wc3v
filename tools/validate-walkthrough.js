#!/usr/bin/env node
//
// validate-walkthrough.js — assert that every NEW-PLAYER walkthrough's claims
// are backed by replay-only evidence (creep route, level honesty, step times,
// decisive fight). Mirrors tools/validate-camp-credit.js: iterates, prints
// per-rule PASS/FAIL, exits nonzero on any failure (CI-friendly).
//
// Usage:
//   node tools/validate-walkthrough.js                       # sweep all new-player replays
//   node tools/validate-walkthrough.js --replay=NAME          # one replay
//   node tools/validate-walkthrough.js --replay=NAME --player=2
//   node tools/validate-walkthrough.js --verbose              # show passing rules too
//
'use strict';

const rules = require('./lib/walkthrough-rules.js');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});
const verbose = !!args.verbose;

// Targets: either an explicit --replay, or the full new-player sweep.
let targets;
if (typeof args.replay === 'string') {
  targets = [{ buildId: '(explicit)', replayId: args.replay, playerSlot: (args.player != null && args.player !== true) ? String(args.player) : null }];
} else {
  targets = rules.newPlayerTargets();
}

if (!targets.length) { console.log('No targets found.'); process.exit(0); }

console.log(`\nValidating walkthrough evidence for ${targets.length} new-player target(s)\n`);

let totalFail = 0, totalReplays = 0, failReplays = 0;
for (const tgt of targets) {
  const raw = rules.loadReplay(tgt.replayId);
  if (!raw) { console.log(`✗ ${tgt.replayId} — NOT FOUND`); totalFail++; failReplays++; continue; }
  totalReplays++;

  const res = rules.evaluate(raw, tgt.playerSlot, null);
  if (res.error) { console.log(`✗ ${tgt.replayId} — ${res.error}`); totalFail++; failReplays++; continue; }

  const fails = res.rules.filter(r => !r.pass);
  const mark = fails.length ? '✗' : '✓';
  const head = `${mark} ${tgt.replayId}  [${tgt.buildId}]  follow=${res.followId} hero=${res.heroId} reachedL${res.reachedLevel} route=${res.route.camps.length}camp(s)`;
  console.log(head);
  if (fails.length) failReplays++;
  for (const r of res.rules) {
    if (r.pass && !verbose) continue;
    console.log(`     ${r.pass ? '·' : '✗'} ${r.name}: ${r.why}`);
  }
  totalFail += fails.length;
}

console.log(`\n${'-'.repeat(60)}`);
console.log(`Replays: ${totalReplays} checked, ${failReplays} with failures. Rule failures: ${totalFail}.`);
console.log(totalFail ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(totalFail ? 1 : 0);
