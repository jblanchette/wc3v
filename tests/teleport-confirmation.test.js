/*
 * teleport-confirmation.test.js — fixture-based backtest of the
 * inference-layer teleport confirmation. Parses the kaho-happy replay
 * (the canonical phantom-TP fixture) and asserts the 2:12 stwp is
 * `rejected` while Kaho's four legitimate teleports settle at
 * `possible` or better.
 *
 * Adds happy-vs-grubby as a regression guard: zero teleports, zero
 * claims rejected.
 *
 * Adds three additional Hammerfall replays where the sweep tool
 * surfaced phantoms (same auto-grant + recent-non-stwp-purchase
 * pattern) and pins their `rejected` verdict so future strategy
 * tuning that breaks them shows up here.
 *
 * Run: `node tests/teleport-confirmation.test.js`
 */

const assert = require('assert');
const path = require('path');
const logManager = require('../helpers/logManager');
logManager.setTestMode();
logManager.setLogger('teleport-confirmation-test');

const { doParsing } = require('../wc3v');

function replayPath (name) {
  return path.join(__dirname, '..', 'replays', `${name}.w3g`);
}

async function parse (replayName) {
  return await doParsing(replayPath(replayName));
}

function teleportsByConfidence (player) {
  const out = { rejected: [], unlikely: [], possible: [], likely: [], confirmed: [] };
  for (const t of (player._teleportEvents || [])) {
    const c = t.inferenceConfidence || 'possible';
    if (out[c]) out[c].push(t);
  }
  return out;
}

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

(async () => {

  // ---------------------------------------------------------------------
  console.log('\n[1342775468_Kaho_Happy_Hammerfall] phantom 2:12 + 4 legit TPs');
  const kh = await parse('1342775468_Kaho_Happy_Hammerfall');

  check('Happy (P2): NO phantom stwp at 2:12 (Phase B kills it at the source)', () => {
    const p = kh.players[2];
    // Two acceptable outcomes:
    //   (a) Phase B succeeded: no teleport event near 2:12 exists at all
    //       (Rod was correctly attributed in dispatch, stwp claim never
    //       got created).
    //   (b) Phase A safety net caught it: a teleport claim was created
    //       at 2:12 and settled at 'rejected'.
    // We accept either; we fail if a stwp at 2:12 LANDED as
    // applied/possible/likely/confirmed.
    const around212 = (p._teleportEvents || [])
      .filter(t => t.abilityCode === 'stwp' && Math.abs(t.gameTime - 132231) < 5000);
    const acceptable = around212.every(t =>
      t.cancelled === true ||
      t.inferenceConfidence === 'rejected' ||
      t.inferenceConfidence === 'unlikely');
    assert.ok(acceptable,
      `expected no live stwp at ~2:12 on P2; found ${JSON.stringify(around212.map(t => ({ gt: t.gameTime, conf: t.inferenceConfidence, cancelled: t.cancelled })))}`);
  });

  check('Kaho (P1): all 4 teleports survive (NOT rejected/unlikely)', () => {
    const p = kh.players[1];
    const tps = teleportsByConfidence(p);
    assert.strictEqual(tps.rejected.length, 0,
      `Kaho's TPs should not be rejected; got ${tps.rejected.length}`);
    assert.strictEqual(tps.unlikely.length, 0,
      `Kaho's TPs should not be unlikely; got ${tps.unlikely.length}`);
    const totalKept = tps.possible.length + tps.likely.length + tps.confirmed.length;
    assert.strictEqual(totalKept, 4,
      `Expected 4 of Kaho's TPs kept, got ${totalKept}`);
  });

  check('Happy (P2): if a teleport claim exists for 2:12 it has rejection evidence (Phase A backup)', () => {
    const p = kh.players[2];
    const reg = p._claimRegistry;
    if (!reg) return;  // Phase B: claim may not exist
    const claims = [...reg.iterate()].filter(c =>
      c.subject.includes('teleport.stwp') &&
      c.payload && Math.abs((c.payload.gameTime || 0) - 132231) < 5000
    );
    if (claims.length === 0) return;  // Phase B prevented the claim — pass
    // If a claim exists, it must have settled in a non-applied state
    // with substantive evidence.
    const negEv = claims[0].evidence.filter(e => e.weight < 0);
    assert.ok(negEv.length >= 2,
      `phantom claim should have >=2 negative evidence signals; got ${negEv.length}: ${negEv.map(e => e.source).join(', ')}`);
  });

  check('Happy (P2): Rod of Necromancy IS attributed at 2:12', () => {
    const p = kh.players[2];
    const uses = (p.eventStream || []).filter(e =>
      e.key === 'itemUse' &&
      Math.abs((e.gameTime || 0) - 132231) < 1000);
    assert.ok(uses.length > 0, 'expected at least one itemUse near 2:12');
    const rodUse = uses.find(e => e.item && (e.item.itemId === 'rnec' || e.item.displayName === 'Rod of Necromancy'));
    assert.ok(rodUse, `expected Rod of Necromancy use at 2:12; got ${uses.map(e => e.item && e.item.displayName).join(', ')}`);
  });

  // ---------------------------------------------------------------------
  console.log('\n[happy-vs-grubby] regression guard — zero phantoms');
  const hvg = await parse('happy-vs-grubby');

  check('No player has any rejected/unlikely teleport', () => {
    for (const p of Object.values(hvg.players)) {
      if (parseInt(p.id) >= 24) continue;
      const tps = teleportsByConfidence(p);
      assert.strictEqual(tps.rejected.length, 0,
        `Player ${p.id}: expected 0 rejected, got ${tps.rejected.length}`);
      assert.strictEqual(tps.unlikely.length, 0,
        `Player ${p.id}: expected 0 unlikely, got ${tps.unlikely.length}`);
    }
  });

  // ---------------------------------------------------------------------
  console.log('\n[Hammerfall sweep] phantom-pattern fixtures');

  const phantomFixtures = [
    { name: '1862522924_Eer0_FoCuS_Hammerfall', playerId: 1, ability: 'stwp', approxGameTimeMs: 131000 },
    { name: '330861190_FoCuS_Happy_Hammerfall', playerId: 2, ability: 'stwp', approxGameTimeMs: 146000 },
    { name: '3205763865_FoCuS_Lyn_Hammerfall',  playerId: 1, ability: 'stwp', approxGameTimeMs: 273000 }
  ];

  for (const fx of phantomFixtures) {
    const data = await parse(fx.name);
    check(`${fx.name}: ${fx.ability} ~${Math.round(fx.approxGameTimeMs / 1000)}s → not live`, () => {
      const p = data.players[fx.playerId];
      assert.ok(p, `player ${fx.playerId} missing`);
      // Phase B: phantom shouldn't fire at all; Phase A: phantom may
      // fire but settle at rejected/unlikely. Both pass; what fails is
      // a live (applied / possible / likely / confirmed) phantom.
      const around = (p._teleportEvents || []).filter(t =>
        t.abilityCode === fx.ability &&
        Math.abs(t.gameTime - fx.approxGameTimeMs) < 30000
      );
      const live = around.find(t =>
        !t.cancelled &&
        t.inferenceConfidence !== 'rejected' &&
        t.inferenceConfidence !== 'unlikely');
      assert.ok(!live,
        `phantom ${fx.ability} should not be live; found ${JSON.stringify(around.map(t => ({ gt: t.gameTime, conf: t.inferenceConfidence, cancelled: t.cancelled })))}`);
    });
  }

  console.log('');
  if (failures) {
    console.log(`FAILED — ${failures} check(s)`);
    process.exit(1);
  } else {
    console.log('OK — all checks passed');
  }
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
