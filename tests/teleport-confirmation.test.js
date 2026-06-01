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

  check('Happy (P2): stwp 2:12 settles at rejected', () => {
    const p = kh.players[2];
    const tps = teleportsByConfidence(p);
    const phantom = tps.rejected.find(t => t.abilityCode === 'stwp');
    assert.ok(phantom, `expected a rejected stwp on P2, got ${JSON.stringify(Object.keys(tps).map(k => [k, tps[k].length]))}`);
    // Hard-coded gameTime check — Happy's phantom is at 2:12 (132231ms).
    assert.ok(Math.abs(phantom.gameTime - 132231) < 500,
      `rejected stwp should be ~2:12, got ${phantom.gameTime}ms`);
    assert.strictEqual(phantom.cancelled, true);
  });

  check('Happy (P2): only ONE teleport, rejected', () => {
    const p = kh.players[2];
    assert.strictEqual((p._teleportEvents || []).length, 1);
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

  check('Happy (P2): phantom claim has multiple negative evidence signals', () => {
    const p = kh.players[2];
    const reg = p._claimRegistry;
    assert.ok(reg, 'expected ClaimRegistry on player');
    const claims = [...reg.iterate()].filter(c => c.subject.includes('teleport.stwp'));
    assert.strictEqual(claims.length, 1);
    const negEv = claims[0].evidence.filter(e => e.weight < 0);
    assert.ok(negEv.length >= 3,
      `phantom should have >=3 negative evidence signals; got ${negEv.length}: ${negEv.map(e => e.source).join(', ')}`);
    // Required signals — these are the ones we expect to fire for this
    // exact replay; if any disappears, a strategy regression has shipped.
    const sources = new Set(negEv.map(e => e.source));
    assert.ok(sources.has('inventoryProvenance'),
      'inventoryProvenance must fire (startup-grant in early game)');
    assert.ok(sources.has('recentPurchaseContradiction'),
      'recentPurchaseContradiction must fire (rnec purchased 2.57s prior)');
    assert.ok(sources.has('eventCorrelation'),
      'eventCorrelation must fire (skeleton spawn at 2:12 = Rod use signature)');
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
    check(`${fx.name}: ${fx.ability} ~${Math.round(fx.approxGameTimeMs / 1000)}s → rejected`, () => {
      const p = data.players[fx.playerId];
      assert.ok(p, `player ${fx.playerId} missing`);
      const tps = teleportsByConfidence(p);
      const match = tps.rejected.find(t =>
        t.abilityCode === fx.ability &&
        Math.abs(t.gameTime - fx.approxGameTimeMs) < 30000
      );
      assert.ok(match,
        `expected rejected ${fx.ability} near ${fx.approxGameTimeMs}ms; rejected=${tps.rejected.map(t => `${t.abilityCode}@${t.gameTime}`).join(',')}`);
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
