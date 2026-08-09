//
// spin-check.js — measures units that rotate on the spot without moving.
//
// The bug this exists for: ranged units in the viewer visibly spin in place,
// sometimes through full revolutions, while their position never changes. WC3
// units do not do this — a unit only turns to face something it has acquired,
// at its turn rate, and it keeps facing it.
//
// This harness runs the SAME client/js/UnitBehavior.js the viewer runs, steps a
// clock at render-ish granularity, and for every unit that is STATIONARY across
// a pair of ticks measures how far its emitted facing moved. It then attributes
// the movement:
//
//   targetFlip  — d.targetUuid / d.aimUuid changed between the two ticks. This
//                 is the acquire/un-acquire churn: argmin-distance target
//                 selection flipping between two enemies at nearly equal range.
//   baseSwing   — the target held, but the underlying path facing (bakedFacing)
//                 moved. That is the resim's facing, not the aim logic.
//   aimSwing    — target and base both held, so the turn budget itself moved
//                 the facing (contact-dwell quantization).
//
// A "spin" is a run of consecutive stationary ticks whose facing keeps turning
// the same way and accumulates past a threshold — that's what reads as a unit
// pirouetting rather than tracking something.
//
// Usage:
//   node tools/spin-check.js --replay=NAME [--step=100] [--from=MM:SS] [--to=MM:SS]
//   node tools/spin-check.js --all [--limit=10] [--step=100]
//   node tools/spin-check.js --replay=NAME --worst=15    # per-unit offender list
//
const fs = require('fs');
const path = require('path');

const BM = require('./lib/behavior-metrics.js');
const UB = BM.UB;

const args = {};
process.argv.slice(2).forEach(r => {
  const [f, ...v] = r.replace(/^--/, '').split('=');
  args[f] = v.join('=') || true;
});

// A stationary unit whose facing moves more than this between consecutive ticks
// is turning faster than any WC3 unit can (cap is 0.2 rad per 30ms frame).
const SPIN_RATE_CAP = UB.C.TURN_RAD_PER_FRAME_CAP / UB.C.WC3_FRAME_MS;  // rad/ms

// Accumulated same-direction rotation, in radians, that counts as "a spin".
const SPIN_ACCUM_RAD = Math.PI * 1.5;

function parseClock (s) {
  if (s == null) return null;
  const m = String(s).match(/^(\d+):(\d+)$/);
  if (m) return (+m[1] * 60 + +m[2]) * 1000;
  return +s;
}

function fmtClock (ms) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function measureSpin (data, opts) {
  const units = BM.buildUnits(data);
  const world = BM.createWorld(data, units);
  const metaByUuid = new Map(units.map(u => [u.uuid, u]));

  const step = +(opts.step || 100);
  const from = (opts.from != null) ? +opts.from : 0;
  const end = (opts.to != null) ? +opts.to
    : (data.replay && data.replay.duration) || 900000;

  const prev = new Map();          // uuid -> { facing, target, base, x, y, t }
  const run = new Map();           // uuid -> { dir, accum, startT }
  const perUnit = new Map();       // uuid -> stats

  let statTicks = 0;               // stationary unit-ticks examined
  let overCap = 0;                 // turned faster than the engine turn rate
  const cause = { targetFlip: 0, baseSwing: 0, aimSwing: 0 };
  const overCapCause = { targetFlip: 0, baseSwing: 0, aimSwing: 0 };
  const mags = { hair: 0, mild: 0, whip: 0, worst: 0 };
  const byReason = new Map();      // "state/reason" -> over-cap count
  const spins = [];                // completed spin runs

  const bump = (uuid) => {
    let s = perUnit.get(uuid);
    if (!s) {
      const u = metaByUuid.get(uuid);
      const meta = (u && u.meta) || {};
      s = {
        uuid,
        name: (u && (u.displayName || u.itemId)) || uuid,
        itemId: (u && u.itemId) || '?',
        melee: UB.isMelee(meta),
        range: (meta.combat && meta.combat.range) || 0,
        ticks: 0, overCap: 0, totalTurn: 0, spins: 0, maxSpin: 0
      };
      perUnit.set(uuid, s);
    }
    return s;
  };

  for (let t = from; t <= end; t += step) {
    const frame = world.resolve(t);
    for (const [uuid, d] of frame.byUuid) {
      const p = prev.get(uuid);
      const cur = {
        facing: d.facing, base: d.bakedFacing,
        target: d.targetUuid || d.aimUuid || null,
        x: d.x, y: d.y, t, state: d.state, reason: d.reason
      };
      prev.set(uuid, cur);
      if (!p || p.t !== t - step) { run.delete(uuid); continue; }

      // Stationary means BOTH ticks placed the unit at (effectively) the same
      // spot. A walking unit is allowed to turn — that's steering, not a spin.
      const moved = Math.hypot(cur.x - p.x, cur.y - p.y);
      if (moved > 1 || d.state === 'walk' || p.state === 'walk') { run.delete(uuid); continue; }
      if (cur.facing == null || p.facing == null) { run.delete(uuid); continue; }

      const delta = UB.angDiff(cur.facing, p.facing);   // signed, normalized
      const mag = Math.abs(delta);
      const s = bump(uuid);
      s.ticks++;
      s.totalTurn += mag;
      statTicks++;

      let why;
      if (cur.target !== p.target) why = 'targetFlip';
      else if (cur.base != null && p.base != null &&
               Math.abs(UB.angDiff(cur.base, p.base)) > 1e-9) why = 'baseSwing';
      else why = 'aimSwing';
      if (mag > 1e-9) cause[why]++;

      if (mag > SPIN_RATE_CAP * step + 1e-6) {
        overCap++; s.overCap++; overCapCause[why]++;
        // How badly over? A hair past the cap is grid quantization and invisible;
        // a half-turn in one tick is the whip that reads as broken.
        const over = mag / (SPIN_RATE_CAP * step);
        if (over < 1.5) mags.hair++;
        else if (over < 3) mags.mild++;
        else mags.whip++;
        mags.worst = Math.max(mags.worst, mag);
        const key = `${d.state}/${d.reason}`;
        byReason.set(key, (byReason.get(key) || 0) + 1);
      }

      // Same-direction accumulation.
      const dir = delta > 1e-6 ? 1 : (delta < -1e-6 ? -1 : 0);
      let r = run.get(uuid);
      if (dir === 0) { run.delete(uuid); continue; }
      if (!r || r.dir !== dir) r = { dir, accum: 0, startT: p.t };
      r.accum += mag;
      run.set(uuid, r);
      if (r.accum >= SPIN_ACCUM_RAD) {
        s.spins++;
        s.maxSpin = Math.max(s.maxSpin, r.accum);
        spins.push({
          uuid, name: s.name, at: r.startT, rad: r.accum, why,
          state: d.state, reason: d.reason, base: cur.base == null ? 'null' : 'set'
        });
        run.delete(uuid);
      }
    }
  }

  return { step, from, end, statTicks, overCap, cause, overCapCause, mags, byReason, spins, perUnit };
}

function report (name, M) {
  const pct = (n, d) => d ? ((n / d) * 100).toFixed(2) + '%' : '—';
  console.log(`\n  ${name}`);
  console.log(`  window ${fmtClock(M.from)}–${fmtClock(M.end)}  step=${M.step}ms` +
    `  stationary unit-ticks=${M.statTicks}`);

  console.log(`\n  ROTATION WHILE STANDING STILL`);
  console.log(`    over engine turn cap      ${String(M.overCap).padStart(8)}  ${pct(M.overCap, M.statTicks)}`);
  console.log(`      ...caused by target flip${String(M.overCapCause.targetFlip).padStart(8)}  ${pct(M.overCapCause.targetFlip, M.overCap)}`);
  console.log(`      ...caused by base swing ${String(M.overCapCause.baseSwing).padStart(8)}  ${pct(M.overCapCause.baseSwing, M.overCap)}`);
  console.log(`      ...caused by aim budget ${String(M.overCapCause.aimSwing).padStart(8)}  ${pct(M.overCapCause.aimSwing, M.overCap)}`);
  console.log(`    any turn, by cause        target=${M.cause.targetFlip} base=${M.cause.baseSwing} aim=${M.cause.aimSwing}`);
  console.log(`    severity  hair(<1.5x)=${M.mags.hair}  mild(<3x)=${M.mags.mild}  whip(>=3x)=${M.mags.whip}` +
    `  worst=${(M.mags.worst / Math.PI).toFixed(2)}π`);
  const reasons = [...M.byReason.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`    over-cap by state/reason  ${reasons.map(([k, v]) => `${k}=${v}`).join('  ')}`);

  console.log(`\n  SPINS (>= ${(SPIN_ACCUM_RAD / Math.PI).toFixed(1)}π same-direction, on the spot)`);
  console.log(`    total                     ${M.spins.length}`);

  const worst = +(args.worst || 0);
  if (worst > 0) {
    const rows = [...M.perUnit.values()]
      .filter(s => s.overCap > 0 || s.spins > 0)
      .sort((a, b) => (b.spins - a.spins) || (b.overCap - a.overCap))
      .slice(0, worst);
    if (rows.length) {
      console.log(`\n  WORST OFFENDERS`);
      console.log(`    ${'unit'.padEnd(22)} ${'kind'.padEnd(8)} ${'range'.padStart(5)} ${'ticks'.padStart(6)} ${'overCap'.padStart(8)} ${'spins'.padStart(6)}`);
      for (const s of rows) {
        console.log(`    ${String(s.name).slice(0, 22).padEnd(22)} ` +
          `${(s.melee ? 'melee' : 'ranged').padEnd(8)} ${String(s.range).padStart(5)} ` +
          `${String(s.ticks).padStart(6)} ${String(s.overCap).padStart(8)} ${String(s.spins).padStart(6)}`);
      }
    }
  }

  if (M.spins.length && args.spins) {
    console.log(`\n  SPIN EVENTS`);
    for (const sp of M.spins.slice(0, 40)) {
      console.log(`    ${fmtClock(sp.at)}  ${String(sp.name).slice(0, 22).padEnd(22)} ` +
        `${(sp.rad / Math.PI).toFixed(2)}π  ${sp.why.padEnd(11)} ` +
        `${String(sp.state).padEnd(7)} ${String(sp.reason).padEnd(18)} base=${sp.base}`);
    }
  }

  // Split melee vs ranged — the report claims ranged units are the visible
  // offenders, so show whether the numbers agree.
  let mT = 0, mO = 0, rT = 0, rO = 0;
  for (const s of M.perUnit.values()) {
    if (s.melee) { mT += s.ticks; mO += s.overCap; } else { rT += s.ticks; rO += s.overCap; }
  }
  console.log(`\n  MELEE vs RANGED (over-cap rate)`);
  console.log(`    melee  ${pct(mO, mT)}  (${mO}/${mT})`);
  console.log(`    ranged ${pct(rO, rT)}  (${rO}/${rT})`);
}

function main () {
  const step = +(args.step || 100);
  const from = parseClock(args.from);
  const to = parseClock(args.to);

  let names;
  if (args.all) {
    names = fs.readdirSync(BM.REPLAY_DIR)
      .filter(f => f.endsWith('.wc3v.gz'))
      .slice(0, +(args.limit || 10));
  } else if (args.replay) {
    names = [args.replay];
  } else {
    console.log('usage: node tools/spin-check.js --replay=NAME [--step=100] [--worst=15] [--spins]');
    console.log('       node tools/spin-check.js --all [--limit=10]');
    process.exit(1);
  }

  const totals = { statTicks: 0, overCap: 0, spins: 0 };
  for (const n of names) {
    let data;
    try { data = BM.loadReplay(n.replace(/\.wc3v\.gz$/, '')); }
    catch (e) { console.log(`  ${n}: ${e.message}`); continue; }
    const M = measureSpin(data, { step, from, to });
    report(path.basename(n, '.wc3v.gz'), M);
    totals.statTicks += M.statTicks;
    totals.overCap += M.overCap;
    totals.spins += M.spins.length;
  }

  if (names.length > 1) {
    const pct = (n, d) => d ? ((n / d) * 100).toFixed(2) + '%' : '—';
    console.log(`\n  ═══ TOTAL over ${names.length} replays ═══`);
    console.log(`    stationary unit-ticks  ${totals.statTicks}`);
    console.log(`    over turn cap          ${totals.overCap}  ${pct(totals.overCap, totals.statTicks)}`);
    console.log(`    spins                  ${totals.spins}`);
  }
  console.log('');
}

main();
