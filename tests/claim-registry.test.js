/*
 * claim-registry.test.js — pure unit tests for the inference primitives.
 *
 * Covers:
 *   1. Claim / Evidence factory validation
 *   2. ClaimRegistry add / merge / lookup / bestForSubject
 *   3. Reverse-dependency cascade marks dependents dirty when an upstream
 *      claim's confidence changes
 *   4. scoreToConfidence respects thresholds
 *   5. Fixpoint behavior: dirty drains, dependents re-evaluate, history
 *      tracks each rung transition
 *
 * Run: `node tests/claim-registry.test.js`
 */

const assert = require('assert');
const Claim = require('../lib/inference/Claim');
const ClaimRegistry = require('../lib/inference/ClaimRegistry');

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

console.log('[Claim factories]');

check('makeClaim requires id, subject, predicate', () => {
  assert.throws(() => Claim.makeClaim({}), /required/);
});

check('makeClaim rejects unknown predicate', () => {
  assert.throws(() => Claim.makeClaim({
    id: 'a', subject: 'p1.x', predicate: 'unknown'
  }), /invalid predicate/);
});

check('makeClaim rejects unknown confidence', () => {
  assert.throws(() => Claim.makeClaim({
    id: 'a', subject: 'p1.x', predicate: 'is', confidence: 'bogus'
  }), /invalid confidence/);
});

check('makeClaim defaults confidence to possible + tracks createdAt history', () => {
  const c = Claim.makeClaim({ id: 'a', subject: 'p1.x', predicate: 'is' });
  assert.strictEqual(c.confidence, 'possible');
  assert.strictEqual(c.history.length, 1);
  assert.strictEqual(c.history[0].confidence, 'possible');
});

check('makeEvidence clamps weight to [-1, +1]', () => {
  assert.strictEqual(Claim.makeEvidence({ kind: 'observation', weight: 2 }).weight, 1);
  assert.strictEqual(Claim.makeEvidence({ kind: 'observation', weight: -5 }).weight, -1);
});

check('makeEvidence rejects unknown kind', () => {
  assert.throws(() => Claim.makeEvidence({ kind: 'imaginary', weight: 0 }), /invalid kind/);
});

check('compareConfidence: confirmed > likely > possible > unlikely > rejected', () => {
  assert.ok(Claim.compareConfidence('confirmed', 'likely') > 0);
  assert.ok(Claim.compareConfidence('possible', 'rejected') > 0);
  assert.strictEqual(Claim.compareConfidence('possible', 'possible'), 0);
});

check('scoreToConfidence rounds with default thresholds', () => {
  assert.strictEqual(Claim.scoreToConfidence(0.9, null), 'confirmed');
  assert.strictEqual(Claim.scoreToConfidence(0.6, null), 'likely');
  assert.strictEqual(Claim.scoreToConfidence(0.1, null), 'possible');
  assert.strictEqual(Claim.scoreToConfidence(-0.3, null), 'unlikely');
  assert.strictEqual(Claim.scoreToConfidence(-0.9, null), 'rejected');
});

check('aggregateScore clamps to [-1, +1]', () => {
  const ev = [
    Claim.makeEvidence({ kind: 'observation', weight: 0.6 }),
    Claim.makeEvidence({ kind: 'observation', weight: 0.7 })
  ];
  assert.strictEqual(Claim.aggregateScore(ev), 1);
});

console.log('\n[ClaimRegistry]');

check('addClaim stores + indexes by subject', () => {
  const r = new ClaimRegistry();
  r.addClaim({ id: 'c1', subject: 'p1.teleport.stwp', predicate: 'occurred' });
  assert.strictEqual(r.size(), 1);
  assert.deepStrictEqual(
    r.findClaimsBySubject('p1.teleport.stwp').map(c => c.id),
    ['c1']
  );
});

check('addClaim re-add merges evidence + dependencies', () => {
  const r = new ClaimRegistry();
  r.addClaim({
    id: 'c1', subject: 'p1.x', predicate: 'is',
    evidence: [Claim.makeEvidence({ kind: 'observation', weight: 0.2 })]
  });
  r.addClaim({
    id: 'c1', subject: 'p1.x', predicate: 'is',
    evidence: [Claim.makeEvidence({ kind: 'observation', weight: 0.3 })],
    dependencies: ['c0']
  });
  const c = r.getClaim('c1');
  assert.strictEqual(c.evidence.length, 2);
  assert.deepStrictEqual(c.dependencies, ['c0']);
});

check('reverse-dependency: updating upstream marks dependent dirty', () => {
  const r = new ClaimRegistry();
  r.addClaim({ id: 'upstream', subject: 'p1.a', predicate: 'is' });
  r.addClaim({ id: 'downstream', subject: 'p1.b', predicate: 'is', dependencies: ['upstream'] });
  r.takeDirty();   // drain initial-add dirty
  r.addEvidence('upstream', { kind: 'contradiction', weight: -0.9 });
  r.recomputeConfidence('upstream', null, { pass: 1 });
  const dirty = r.takeDirty();
  assert.ok(dirty.has('downstream'),
    `downstream should be dirty after upstream confidence change, got: ${[...dirty]}`);
});

check('recomputeConfidence updates label + appends history on change', () => {
  const r = new ClaimRegistry();
  r.addClaim({
    id: 'c1', subject: 'p1.teleport.stwp', predicate: 'occurred',
    evidence: [Claim.makeEvidence({ kind: 'contradiction', weight: -0.9 })]
  });
  const before = r.getClaim('c1').history.length;
  r.recomputeConfidence('c1', null, { pass: 2, source: 'test' });
  const c = r.getClaim('c1');
  assert.strictEqual(c.confidence, 'rejected');
  assert.strictEqual(c.history.length, before + 1);
  assert.strictEqual(c.history[before].from, 'possible');
  assert.strictEqual(c.history[before].confidence, 'rejected');
});

check('recomputeConfidence no-op when label unchanged appends NO history', () => {
  const r = new ClaimRegistry();
  r.addClaim({ id: 'c1', subject: 'p1.x', predicate: 'is' });   // possible @0
  const before = r.getClaim('c1').history.length;
  r.recomputeConfidence('c1', null, { pass: 2 });               // still possible
  assert.strictEqual(r.getClaim('c1').history.length, before);
});

check('bestForSubject picks highest confidence claim', () => {
  const r = new ClaimRegistry();
  r.addClaim({
    id: 'a', subject: 'p1.slot.1.item', predicate: 'is', value: { itemId: 'stwp' },
    evidence: [Claim.makeEvidence({ kind: 'observation', weight: -0.6 })]
  });
  r.addClaim({
    id: 'b', subject: 'p1.slot.1.item', predicate: 'is', value: { itemId: 'rnec' },
    evidence: [Claim.makeEvidence({ kind: 'observation', weight: 0.9 })]
  });
  r.recomputeConfidence('a', null);
  r.recomputeConfidence('b', null);
  const best = r.bestForSubject('p1.slot.1.item');
  assert.strictEqual(best.id, 'b');
  assert.strictEqual(best.confidence, 'confirmed');
});

check('toJSON omits recordRef but keeps payload + evidence + history', () => {
  const r = new ClaimRegistry();
  r.addClaim({
    id: 'c1', subject: 'p1.teleport.stwp', predicate: 'occurred',
    payload: { gameTime: 132231, recordRef: { huge: 'object' }, itemSource: 'startup-grant' }
  });
  const out = r.toJSON();
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].payload.gameTime, 132231);
  assert.strictEqual(out[0].payload.itemSource, 'startup-grant');
  assert.strictEqual(out[0].payload.recordRef, undefined);
});

console.log('');
if (failures) {
  console.log(`FAILED — ${failures} check(s)`);
  process.exit(1);
} else {
  console.log('OK — all checks passed');
}
