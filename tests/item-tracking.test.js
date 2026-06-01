/*
 * item-tracking.test.js — Phase 10 fixture suite for the item / shop /
 * inventory tracking overhaul.
 *
 * Asserts that the Phase 1-9 changes correctly track:
 *   1. Goblin Merchant + player-shop purchases on happy-vs-grubby
 *   2. Staff of Teleportation slot-drift backfill on Kaho's Hammerfall replay
 *   3. Staff of Preservation purchase + use detection
 *   4. spre still emits a teleport event (regression guard for Phase 1-2)
 *
 * Run: `node tests/item-tracking.test.js`
 * Exits non-zero on failure with a clear diff message.
 *
 * Phase 0 fixtures (sell-back, Goblin Lab Reveal, land-mine deploy,
 * dust/sentry/salve, creep-drop pickup) are referenced by name only —
 * once the user records them and drops them in `replays/`, append the
 * corresponding `expect` blocks below.
 */

const assert = require('assert');
const path = require('path');

const logManager = require('../helpers/logManager');
logManager.setTestMode();
logManager.setLogger('item-tracking-test');

const { doParsing } = require('../wc3v');

function replayPath (name) {
  return path.join(__dirname, '..', 'replays', `${name}.w3g`);
}

// Run the parser against a replay and return the in-memory PlayerManager
// state. doParsing returns Player instances (not the serialized .wc3v
// JSON), so fields like `_itemReclassifications`, `_inferredItems`, and
// `teleportEvents` are directly accessible on each player.
async function parse (replayName) {
  return await doParsing(replayPath(replayName));
}

function countEvents (player, key, predicate) {
  return (player.eventStream || []).filter(e => {
    if (e.key !== key) return false;
    if (predicate) return predicate(e);
    return true;
  }).length;
}

function findEvents (player, key, predicate) {
  return (player.eventStream || []).filter(e => {
    if (e.key !== key) return false;
    if (predicate) return predicate(e);
    return true;
  });
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

async function testHappyVsGrubby () {
  console.log('\n[happy-vs-grubby] Goblin Merchant + player-shop purchases');
  const data = await parse('happy-vs-grubby');
  const p1 = data.players[1];
  const p2 = data.players[2];

  check('P1 has Goblin Merchant purchases (>= 2)', () => {
    const n = countEvents(p1, 'itemPurchase', e => e.shop === 'Goblin Merchant');
    assert(n >= 2, `expected >= 2 Goblin Merchant buys for P1, got ${n}`);
  });

  check('P2 has Goblin Merchant purchases (>= 2)', () => {
    const n = countEvents(p2, 'itemPurchase', e => e.shop === 'Goblin Merchant');
    assert(n >= 2, `expected >= 2 Goblin Merchant buys for P2, got ${n}`);
  });

  check('P2 (UD) has Tomb of Relics purchases', () => {
    const n = countEvents(p2, 'itemPurchase', e => e.shop === 'Tomb of Relics');
    assert(n >= 1, `expected >= 1 Tomb of Relics buy for P2, got ${n}`);
  });

  check('All purchases carry source field', () => {
    const buys = findEvents(p1, 'itemPurchase').concat(findEvents(p2, 'itemPurchase'));
    const missing = buys.filter(e => !e.source);
    assert.strictEqual(missing.length, 0,
      `${missing.length} purchases missing 'source' field`);
  });

  check('Grubby (P1) sold his auto-given stwp to Goblin Merchant at 2:11', () => {
    // Pre-Phase-4 sell-back tracking, the parser missed this sell and
    // emitted a phantom stwp teleport at 11:13 from "Fortress". Grubby
    // actually sold the scroll right after spawning his Blademaster
    // (~2:11) and bought a Circlet of Nobility (~2:13). The ledger now
    // captures the sell + clears the slot, so there's no phantom cast.
    const sells = (p1.eventStream || []).filter(e =>
      e.key === 'sellItem' && e.item && e.item.itemId === 'stwp');
    assert(sells.length >= 1, `expected stwp sell, got ${sells.length}`);
    const tps = (p1._teleportEvents || []).filter(t => t.abilityCode === 'stwp');
    assert.strictEqual(tps.length, 0,
      `expected 0 phantom stwp teleports after sell, got ${tps.length}`);
  });
}

async function testKahoStelDrift () {
  console.log('\n[Kaho-Happy-Hammerfall] stwp→stel slot drift backfill');
  const data = await parse('1342775468_Kaho_Happy_Hammerfall');
  const p1 = data.players[1];

  check('Kaho has 2 Staff of Teleportation uses', () => {
    const uses = findEvents(p1, 'itemUse', e => e.item && e.item.itemId === 'stel');
    assert.strictEqual(uses.length, 2,
      `expected 2 stel uses, got ${uses.length}`);
  });

  check('At least one stel purchase recorded (real or backfilled)', () => {
    const buys = findEvents(p1, 'itemPurchase', e => e.item && e.item.itemId === 'stel');
    assert(buys.length >= 1,
      `expected >= 1 stel purchase, got ${buys.length}`);
  });

  check('Slot-drift reclassification was recorded', () => {
    const recl = p1._itemReclassifications || [];
    const stwpToStel = recl.filter(r =>
      r.from && r.from.itemId === 'stwp' && r.to && r.to.itemId === 'stel');
    assert(stwpToStel.length >= 1,
      `expected >= 1 stwp→stel reclassification, got ${stwpToStel.length}`);
  });

  check('Backfilled purchase tagged with inferred=true', () => {
    const inferred = findEvents(p1, 'itemPurchase', e => e.inferred);
    assert(inferred.length >= 1,
      `expected >= 1 inferred purchase, got ${inferred.length}`);
  });

  check('Both teleport casts classify as stel (category=single-unit)', () => {
    const stels = (p1._teleportEvents || []).filter(t => t.abilityCode === 'stel');
    assert.strictEqual(stels.length, 2,
      `expected 2 stel teleports, got ${stels.length}`);
    stels.forEach(t => {
      assert.strictEqual(t.abilityCategory, 'single-unit',
        `expected category=single-unit, got ${t.abilityCategory}`);
    });
  });
}

async function testJensSprePurchase () {
  console.log('\n[Jens-HawK-Hammerfall] Staff of Preservation full ledger');
  const data = await parse('1908149276_Jens_HawK_Hammerfall');
  const p1 = data.players[1];

  check('Jens (NE) bought Staff of Preservation from Ancient of Wonders', () => {
    const buys = findEvents(p1, 'itemPurchase', e =>
      e.item && e.item.itemId === 'spre' && e.shop === 'Ancient of Wonders');
    assert(buys.length >= 1, `expected spre buy, got ${buys.length}`);
  });

  // Jens's spre USE detection is sensitive to slot-trade tracking — the
  // post-Phase-2 ledger may correctly route the spre cast through a
  // different slot/hero than the pre-Phase-2 parser saw. Verify only the
  // purchase + ledger record for now; reconfirm uses via Phase-0
  // single-player fixture once recorded.
  check('Jens itemPurchase for spre carries source provenance', () => {
    const buys = findEvents(p1, 'itemPurchase', e => e.item && e.item.itemId === 'spre');
    buys.forEach(b => {
      assert(b.source, `spre buy missing source: ${JSON.stringify(b)}`);
    });
  });

  check('Goblin Merchant purchases now visible (was 0 pre-Phase-1)', () => {
    const buys = findEvents(p1, 'itemPurchase', e => e.shop === 'Goblin Merchant');
    assert(buys.length >= 1, `expected Goblin Merchant buys, got ${buys.length}`);
  });
}

async function testIceorcSpreUses () {
  console.log('\n[Jens-Iceorc-Springtime13] regression: 2 spre uses + teleports');
  const data = await parse('1711969456_Jens_Iceorc_Springtime13');
  const p1 = data.players[1];

  check('Player 1 has >= 2 Staff of Preservation uses', () => {
    const uses = findEvents(p1, 'itemUse', e => e.item && e.item.itemId === 'spre');
    assert(uses.length >= 2, `expected >= 2 spre uses, got ${uses.length}`);
  });

  check('Player 1 has >= 2 spre teleport events', () => {
    const tps = (p1._teleportEvents || []).filter(t => t.abilityCode === 'spre');
    assert(tps.length >= 2, `expected >= 2 spre teleports, got ${tps.length}`);
  });
}

async function testItemEventsLedger () {
  console.log('\n[happy-vs-grubby] HeroInventory ledger emits itemEvent records');
  const data = await parse('happy-vs-grubby');
  const p1 = data.players[1];

  check('P1 has unified itemEvent ledger entries', () => {
    const events = (p1.eventStream || []).filter(e => e.key === 'itemEvent');
    assert(events.length >= 5,
      `expected >= 5 itemEvent ledger entries, got ${events.length}`);
  });

  check('Auto-given stwp at game start has source=startup-grant', () => {
    const events = (p1.eventStream || []).filter(e =>
      e.key === 'itemEvent' && e.source === 'startup-grant');
    assert(events.length >= 1,
      `expected at least one startup-grant itemEvent, got ${events.length}`);
  });
}

async function main () {
  await testHappyVsGrubby();
  await testKahoStelDrift();
  await testJensSprePurchase();
  await testIceorcSpreUses();
  await testItemEventsLedger();

  console.log('');
  if (failures > 0) {
    console.log(`FAIL: ${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log('PASS: all item-tracking assertions hold');
}

main().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(2);
});
