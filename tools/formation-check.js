//
// formation-check.js — validates the combat-formation resolver
// (lib/CombatFormation.js) two ways:
//
//   1. SYNTHETIC (default): drives resolveFormation with hand-built armies and
//      asserts the geometry the engine should produce — ranged behind melee,
//      each unit at its attack range, concave wings, focus-fire clamping,
//      determinism. Fast, no replay needed.
//
//   2. REPLAY (--replay=NAME): re-parses a replay with --formation-trace and
//      summarises the captured per-order formation context: how many attack
//      orders formed up, the stop-vs-range error for ranged units, and how
//      often ranged units ended behind the melee line.
//
// Usage:
//   node tools/formation-check.js
//   node tools/formation-check.js --replay=1499624326_Ugly_TH000_Hammerfall
//
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const { resolveFormation, resolveSurround, buildingShape, classifyRole } = require('../lib/CombatFormation');
const { getEffectiveRange } = require('../helpers/effectiveRange');

const args = {};
process.argv.slice(2).forEach(r => {
  const [f, ...v] = r.replace(/^--/, '').split('=');
  args[f] = v.join('=') || true;
});

// --- tiny test harness -----------------------------------------------------

let pass = 0, fail = 0;
function check (name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? '  — ' + detail : ''}`); }
}

// A no-research player (range research bonuses = 0).
const PLAYER = { researchLevels: {} };

let _uid = 0;
function mkUnit (itemId, x, y, collisionSize = 16) {
  return {
    itemId, currentX: x, currentY: y, uuid: `u${itemId}-${_uid++}`,
    isBuilding: false, balanceInfo: { collisionSize }
  };
}
function mkEnemy (x, y) {
  return { itemId: 'hfoo', currentX: x, currentY: y, uuid: `e-${_uid++}`, isBuilding: false };
}

function dist (a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// --- synthetic scenarios ---------------------------------------------------

function synthetic () {
  console.log('SYNTHETIC geometry tests\n');

  // Army to the LEFT (around x=0), enemy front to the RIGHT at (1000,0).
  // Mixed: 4 footmen (melee 90), 4 riflemen (ranged 400), 2 sorceress (600).
  const focus = { x: 1000, y: 0 };
  const enemies = [mkEnemy(1000, -60), mkEnemy(1000, 60), mkEnemy(1040, 0)];

  const footmen = [];
  for (let i = 0; i < 4; i++) footmen.push(mkUnit('hfoo', -40 + i * 20, -60 + i * 40));
  const rifles = [];
  for (let i = 0; i < 4; i++) rifles.push(mkUnit('hrif', -10 + i * 20, -60 + i * 40));
  const sorcs = [mkUnit('hsor', 0, -20), mkUnit('hsor', 0, 20)];
  const army = [...footmen, ...rifles, ...sorcs];

  const slots = resolveFormation(army, focus, enemies, PLAYER);

  check('every attacking unit gets a slot', slots.size === army.length,
    `got ${slots.size}/${army.length}`);

  // Stop distance ≈ attack range for the rank centre (wings pull in via the
  // concave, so allow generous slack and check the rank minimum/centre).
  const stopOf = u => dist(slots.get(u), focus);
  const meleeStops = footmen.map(stopOf);
  const rifleStops = rifles.map(stopOf);
  const sorcStops = sorcs.map(stopOf);

  const near = (v, t, tol) => Math.abs(v - t) <= tol;
  check('melee settle near melee range (~90, floored to 64)',
    meleeStops.every(s => s >= 60 && s <= 130),
    `stops=${meleeStops.map(Math.round)}`);
  check('riflemen settle near 400 (concave-adjusted)',
    rifleStops.every(s => s >= 260 && s <= 410),
    `stops=${rifleStops.map(Math.round)}`);
  check('sorceress settle near 600 (concave-adjusted)',
    sorcStops.every(s => s >= 460 && s <= 610),
    `stops=${sorcStops.map(Math.round)}`);

  // Ranged behind melee: every ranged unit is farther from the enemy along the
  // approach axis than every melee unit. Approach axis here is +x toward enemy,
  // so "behind" = smaller x.
  const maxRangedX = Math.max(...rifles.concat(sorcs).map(u => slots.get(u).x));
  const minMeleeX = Math.min(...footmen.map(u => slots.get(u).x));
  check('ranged rank sits behind the melee line',
    maxRangedX < minMeleeX,
    `maxRangedX=${Math.round(maxRangedX)} minMeleeX=${Math.round(minMeleeX)}`);

  check('sorceress (600) sit behind riflemen (400)',
    Math.max(...sorcs.map(u => slots.get(u).x)) < Math.min(...rifles.map(u => slots.get(u).x)),
    `sorcX=${sorcs.map(u => Math.round(slots.get(u).x))} rifleX=${rifles.map(u => Math.round(slots.get(u).x))}`);

  // Concave: within the rifle rank, the wings (extreme lateral / y) are pulled
  // CLOSER to the enemy (larger x) than the rank centre.
  const rifleByLateral = rifles.slice().sort((a, b) => slots.get(a).y - slots.get(b).y);
  const centreX = slots.get(rifleByLateral[Math.floor(rifleByLateral.length / 2)]).x;
  const wingX = slots.get(rifleByLateral[0]).x;
  check('concave: rifle wings curve toward the enemy', wingX > centreX,
    `wingX=${Math.round(wingX)} centreX=${Math.round(centreX)}`);

  // No two units share a coordinate.
  const coords = [...slots.values()].map(s => `${s.x.toFixed(1)},${s.y.toFixed(1)}`);
  check('no two units occupy the same coordinate',
    new Set(coords).size === coords.length);

  // Determinism: same inputs (shuffled order) → same slot positions per unit.
  const shuffled = army.slice().reverse();
  const slots2 = resolveFormation(shuffled, focus, enemies, PLAYER);
  let identical = true;
  for (const u of army) {
    const a = slots.get(u), b = slots2.get(u);
    if (!b || Math.abs(a.x - b.x) > 1e-6 || Math.abs(a.y - b.y) > 1e-6) { identical = false; break; }
  }
  check('deterministic regardless of input ordering', identical);

  // Focus-fire: many attackers vs ONE enemy → rank half-width clamps so they
  // bunch around the target instead of fanning wider than the natural spread.
  const enemy1 = [mkEnemy(1000, 0)];
  const mob = [];
  for (let i = 0; i < 8; i++) mob.push(mkUnit('hrif', -200 + i * 50, -300 + i * 80));
  const fSlots = resolveFormation(mob, focus, enemy1, PLAYER);
  const latSpread = (() => {
    const ys = [...fSlots.values()].map(s => s.y);
    return Math.max(...ys) - Math.min(...ys);
  })();
  // Natural spread for 8 units at 64u spacing = 7*64 = 448. Focus-fire clamps
  // to ~ (enemyHalfWidth 0 + margin 96) * 2 = 192.
  check('focus-fire clamps the rank width vs a lone target',
    latSpread <= 260,
    `lateral spread=${Math.round(latSpread)} (natural would be ~448)`);

  // A single ranged unit just stops at its range, dead ahead.
  const solo = [mkUnit('hrif', 0, 0)];
  const sSlots = resolveFormation(solo, focus, enemies, PLAYER);
  check('single ranged unit stops at its attack range',
    near(dist(sSlots.get(solo[0]), focus), 400, 8),
    `stop=${Math.round(dist(sSlots.get(solo[0]), focus))}`);

  // Empty enemies + attack-on-unit fallback still produces range stops.
  const fb = resolveFormation([mkUnit('hrif', 0, 0)], focus, [], PLAYER);
  check('range stop still applied with no enemy context',
    fb.size === 1 && near(dist(fb.get([...fb.keys()][0]), focus), 400, 8));

  console.log(`\nSYNTHETIC: ${pass} passed, ${fail} failed\n`);
}

// --- surround synthetic scenarios ------------------------------------------

function surroundSynthetic () {
  console.log('SURROUND geometry tests\n');

  // Chebyshev margin of a slot beyond a rect footprint (negative = inside).
  const rectMargin = (slot, shape) =>
    Math.max(Math.abs(slot.x - shape.x) - shape.halfW, Math.abs(slot.y - shape.y) - shape.halfH);
  const sectorsCovered = (slots, shape, deg) => {
    const seen = new Set();
    for (const s of slots.values()) {
      const a = Math.atan2(s.y - shape.y, s.x - shape.x);
      seen.add(Math.floor(((a + Math.PI) / (2 * Math.PI)) * (360 / deg)) % (360 / deg));
    }
    return seen.size * deg;
  };
  const minPairDist = (slots) => {
    const pts = [...slots.values()];
    let min = Infinity;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        min = Math.min(min, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
      }
    }
    return min;
  };
  const open = () => true;

  // 20 grunts approach a town hall footprint (12x12 cells = 192u half-extent)
  // from the east. WC3 packs the near side first and wraps as slots fill.
  const townHall = { x: 0, y: 0, halfW: 192, halfH: 192, kind: 'rect' };
  const grunts = [];
  for (let i = 0; i < 20; i++) grunts.push(mkUnit('ogru', 700 + (i % 5) * 60, -240 + Math.floor(i / 5) * 120, 31));
  const th = resolveSurround(grunts, townHall, PLAYER, open);

  check('20 grunts vs town hall: everyone gets a slot',
    th.slots.size === 20 && th.unassigned.length === 0,
    `slots=${th.slots.size} unassigned=${th.unassigned.length}`);
  check('every slot is outside the footprint',
    [...th.slots.values()].every(s => rectMargin(s, townHall) > 0),
    `worst margin=${Math.round(Math.min(...[...th.slots.values()].map(s => rectMargin(s, townHall))))}`);
  check('slots wrap the building (>=210 degrees of coverage)',
    sectorsCovered(th.slots, townHall, 30) >= 210,
    `coverage=${sectorsCovered(th.slots, townHall, 30)}deg`);
  check('no slot pile-ups (min pairwise distance >= 40u)',
    minPairDist(th.slots) >= 40,
    `min=${Math.round(minPairDist(th.slots))}`);

  const thShuffled = resolveSurround(grunts.slice().reverse(), townHall, PLAYER, open);
  let same = true;
  for (const u of grunts) {
    const a = th.slots.get(u), b = thShuffled.slots.get(u);
    if (!b || Math.abs(a.x - b.x) > 1e-6 || Math.abs(a.y - b.y) > 1e-6) { same = false; break; }
  }
  check('surround is deterministic regardless of input ordering', same);

  // 20 grunts vs a farm (4x4 cells = 64u half-extent): the inner ring fills
  // completely (full wrap) and the overflow stands on an outer ring.
  const farm = { x: 0, y: 0, halfW: 64, halfH: 64, kind: 'rect' };
  const grunts2 = [];
  for (let i = 0; i < 20; i++) grunts2.push(mkUnit('ogru', 500 + (i % 5) * 60, -240 + Math.floor(i / 5) * 120, 31));
  const fm = resolveSurround(grunts2, farm, PLAYER, open);
  check('20 grunts vs farm: everyone gets a slot', fm.slots.size === 20);
  check('farm is fully surrounded (360 degrees, 30-degree sectors)',
    sectorsCovered(fm.slots, farm, 30) === 360,
    `coverage=${sectorsCovered(fm.slots, farm, 30)}deg`);
  const margins = [...fm.slots.values()].map(s => rectMargin(s, farm)).sort((a, b) => a - b);
  check('overflow grunts stand on an outer ring',
    margins[margins.length - 1] > margins[0] + 60,
    `inner=${Math.round(margins[0])} outer=${Math.round(margins[margins.length - 1])}`);

  // A wall blocks everything east of x=120: no slots there, everyone still
  // assigned on the open sides.
  const walled = resolveSurround(grunts2, farm, PLAYER, (x, y) => x <= 120);
  check('walled side generates no slots there',
    [...walled.slots.values()].every(s => s.x <= 120),
    `worst x=${Math.round(Math.max(...[...walled.slots.values()].map(s => s.x)))}`);
  check('walled side: everyone still assigned', walled.slots.size === 20,
    `slots=${walled.slots.size}`);

  // 5 riflemen (range 400) siege a tower (4x4 = 64u) from the east: a one-
  // sided arc at edge + range, never inside, never on the far side.
  const tower = { x: 0, y: 0, halfW: 64, halfH: 64, kind: 'rect' };
  const rifles = [];
  for (let i = 0; i < 5; i++) rifles.push(mkUnit('hrif', 600, -120 + i * 60));
  const tw = resolveSurround(rifles, tower, PLAYER, open);
  const stops = rifles.map(u => Math.hypot(tw.slots.get(u).x, tw.slots.get(u).y));
  check('ranged siege: stops at edge distance + range',
    stops.every(s => s >= 448 && s <= 512),
    `stops=${stops.map(Math.round)}`);
  check('ranged siege: army side only (east)',
    rifles.every(u => tw.slots.get(u).x > 0));

  // 8 grunts mob a lone footman: an inner ring of ~6 forms and the rest wait
  // on an outer ring — the WC3 surround, not a 8-wide stack.
  const foot = { x: 0, y: 0, radius: 16, kind: 'circle' };
  const mob = [];
  for (let i = 0; i < 8; i++) mob.push(mkUnit('ogru', 300 + (i % 4) * 50, -80 + Math.floor(i / 4) * 80, 31));
  const ring = resolveSurround(mob, foot, PLAYER, open);
  const ringDists = [...ring.slots.values()].map(s => Math.hypot(s.x, s.y)).sort((a, b) => a - b);
  check('melee ring on a unit: everyone slotted', ring.slots.size === 8);
  check('inner ring is tight (first slots hug the target)',
    ringDists[0] <= 80, `nearest=${Math.round(ringDists[0])}`);
  check('overflow melee wait on an outer ring',
    ringDists[ringDists.length - 1] > ringDists[0] + 50,
    `inner=${Math.round(ringDists[0])} outer=${Math.round(ringDists[ringDists.length - 1])}`);

  console.log(`\nSURROUND: running total ${pass} passed, ${fail} failed\n`);
}

// --- replay summary --------------------------------------------------------

function readWc3v (name) {
  const gz = path.join(__dirname, '..', 'client', 'replays', `${name}.wc3v.gz`);
  if (!fs.existsSync(gz)) throw new Error(`output not found: ${gz}`);
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8'));
}

function replaySummary (name) {
  console.log(`REPLAY formation summary: ${name}\n`);
  console.log('  parsing with --formation-trace ...');
  execSync(`node wc3v.js --replay=${name} --formation-trace`, { stdio: 'ignore' });

  const data = readWc3v(name);
  const players = Array.isArray(data.players)
    ? data.players
    : Object.values(data.players || {});

  let orders = 0, formedRanged = 0;
  const stopErrs = [];          // ranged stop-vs-range error
  let rangedBehindMelee = 0, mixedOrders = 0;
  let applied = 0, emptyPath = 0;   // dispatch: slots applied vs already-at-slot
  let retried = 0, fellBack = 0, heldAtSlot = 0;   // anti-freeze dispatch outcomes
  const perItem = new Map();        // itemId -> { n, range, stops:[] }
  const perPlayer = [];

  for (const p of players) {
    if (p.formApply) {
      applied += p.formApply.applied || 0; emptyPath += p.formApply.emptyPath || 0;
      retried += p.formApply.retried || 0; fellBack += p.formApply.fellBack || 0;
      heldAtSlot += p.formApply.heldAtSlot || 0;
    }
    const trace = p.formationTrace || [];
    if (p.race != null) {
      perPlayer.push({ race: p.race, orders: trace.length, apply: p.formApply ? p.formApply.applied : 0 });
    }
    for (const t of trace) {
      for (const u of t.units) {
        let e = perItem.get(u.itemId);
        if (!e) { e = { n: 0, range: u.range, stops: [] }; perItem.set(u.itemId, e); }
        e.n++; e.stops.push(u.stop);
      }
    }
    for (const t of trace) {
      orders++;
      const ranged = t.units.filter(u => u.role === 'ranged');
      const melee = t.units.filter(u => u.role === 'melee');
      if (ranged.length) formedRanged++;
      for (const u of ranged) stopErrs.push(u.stopErr);
      if (ranged.length && melee.length) {
        mixedOrders++;
        // ranged stop should exceed melee stop (farther from focus = behind)
        const minRanged = Math.min(...ranged.map(u => u.stop));
        const maxMelee = Math.max(...melee.map(u => u.stop));
        if (minRanged > maxMelee) rangedBehindMelee++;
      }
    }
  }

  const med = a => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const abs = stopErrs.map(Math.abs);

  console.log(`  slot dispatches (applied)       : ${applied}`);
  console.log(`  ...empty-route dispatches       : ${emptyPath}` +
    (applied ? `  (${Math.round(100 * emptyPath / applied)}%)` : ''));
  // Every empty-route dispatch resolves to held (genuinely at the slot), a
  // short line-of-sight hop (the remainder), a retried perimeter slot, or a
  // plain-move fallback. A silent freeze is structurally impossible in
  // dispatchToSlot; these counters are how a regression would show.
  console.log(`  ...held at slot                 : ${heldAtSlot}`);
  console.log(`  ...retried another slot         : ${retried}`);
  console.log(`  ...fell back to plain move      : ${fellBack}`);
  console.log(`  attack orders with a formation : ${orders}`);
  console.log(`  orders that included ranged     : ${formedRanged}`);
  console.log(`  ranged stop-vs-range |err|      : median=${Math.round(med(abs))}u  n=${abs.length}`);
  console.log(`  mixed melee+ranged orders       : ${mixedOrders}`);
  console.log(`  ...with ranged behind melee     : ${rangedBehindMelee}/${mixedOrders}` +
    (mixedOrders ? `  (${Math.round(100 * rangedBehindMelee / mixedOrders)}%)` : ''));
  console.log('');

  const ok = orders > 0 && (mixedOrders === 0 || rangedBehindMelee / mixedOrders >= 0.95)
    && (!abs.length || med(abs) <= 120);
  console.log('');
  console.log('  per player:');
  for (const pp of perPlayer) console.log(`    race=${pp.race}  formationOrders=${pp.orders}  slotDispatches=${pp.apply}`);
  console.log('');
  console.log('  per unit type (itemId  n  range  medianStop):');
  const rows = [...perItem.entries()].sort((a, b) => b[1].n - a[1].n);
  for (const [id, e] of rows) {
    console.log(`    ${id.padEnd(6)} n=${String(e.n).padStart(4)}  range=${String(e.range).padStart(4)}  medStop=${Math.round(med(e.stops))}`);
  }
  console.log('');

  console.log(ok ? 'REPLAY CHECK: PASS' : 'REPLAY CHECK: review needed');
  return ok;
}

// --- main ------------------------------------------------------------------

synthetic();
surroundSynthetic();
let replayOk = true;
if (args.replay) {
  try { replayOk = replaySummary(String(args.replay)); }
  catch (e) { console.log('REPLAY ERROR:', e.message); replayOk = false; }
}

process.exit((fail === 0 && replayOk) ? 0 : 1);
