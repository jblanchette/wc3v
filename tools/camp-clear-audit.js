/**
 * camp-clear-audit.js — grade (and tune) the estimated creep-camp clear time
 * against ground truth derivable from the replay itself.
 *
 * The replay format records no creep deaths, so `clearedTime` is an estimate
 * (lib/CampCreditModel.js). But the replay does pin it from both sides.
 *
 * LOWER BOUND — PROOF OF LIFE (hard).
 *   PlayerActions raises a camp 'interact-creep' event only when a right-click
 *   resolves to a live neutral carrying a neutralGroupId. You cannot issue an
 *   order against a dead creep, so such a click at time T proves a creep in
 *   that camp was ALIVE at T:
 *
 *       clearedTime >= last proof of life
 *
 *   The audit uses only clicks issued BY a hero/combat unit FROM within the
 *   creep leash. Ordering an attack from across the map is legal but is not
 *   evidence of a fight, and restricting to in-zone fighters keeps the bound
 *   robust to any residual target mis-resolution.
 *
 * UPPER BOUND — the fight ends (soft) and the settle bound (hard).
 *   A camp cannot still be dying long after all activity there stopped, so
 *   clearedTime should not exceed the end of the engagement that contains the
 *   last proof of life (plus a grace window). And a building placed on a camp
 *   proves it was clear before that moment (lib/SettlementClear.js).
 *
 * Grading each camp against the bracket [lo, hi] makes the metric TWO-SIDED,
 * which matters: clearing every camp at the end of the game would satisfy the
 * proof-of-life bound perfectly while being useless.
 *
 * HONEST LIMITS (stated, not hidden):
 *   - A camp with a Fountain of Health/Mana can be right-clicked forever and
 *     the export does not record WHICH neutral was targeted, so proof of life
 *     there is ambiguous. Those camps are excluded from the headline; see
 *     --fountains.
 *   - `hi` is a soft bound built from observed activity, not from the game. A
 *     camp genuinely finished off after a lull will read as "late".
 *   - Camps nobody ever clicked cannot be graded at all, in either direction.
 *   - The audit reads exported data. It changes nothing.
 *
 * Usage:
 *   node tools/camp-clear-audit.js                  — fleet report (shipped values)
 *   node tools/camp-clear-audit.js --replay=ID      — per-camp detail
 *   node tools/camp-clear-audit.js --sweep          — compare model variants
 *   node tools/camp-clear-audit.js --grid=PER_LEVEL_MS
 *   node tools/camp-clear-audit.js --limit=N        — cap processed replays
 *   node tools/camp-clear-audit.js --top=N          — worst-offender list size
 *   node tools/camp-clear-audit.js --fountains      — include fountain camps
 *   node tools/camp-clear-audit.js --json           — machine-readable
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// The SHIPPING model and the SHIPPING settle clamp. Sweeping re-runs this exact
// code with different constants over the exported event log, so a tuning result
// is never a result for a model that differs from the parser's.
const CampCreditModel = require('../lib/CampCreditModel');
const SettlementClear = require('../lib/SettlementClear');

const REPLAYS_DIR = path.join(__dirname, '..', 'client', 'replays');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

const TOP_N = args.top ? parseInt(args.top, 10) : 15;
const SHOW_FOUNTAINS = !!args.fountains;
const AS_JSON = !!args.json;

// Grace allowed past the end of observed camp activity before a clear counts as
// late. Camp events are sparse (they come from orders, not ticks), so the last
// recorded activity slightly precedes the real end of the fight.
const LATE_GRACE_MS = 15000;

// Gap that splits one camp engagement from the next. Mirrors
// CampCreditModel.DEFAULTS.ENGAGEMENT_GAP_MS.
const ENGAGEMENT_GAP_MS = 20000;

// "Heavily engaged" — a camp a fighter clicked this many times over at least
// this long. Used only as a labelled PROXY for "this camp was surely killed",
// to keep a sweep from winning by refusing to clear anything.
const HEAVY_PROOF_CLICKS = 8;
const HEAVY_ENGAGE_MS = 15000;

const fmt = (ms) => {
  if (ms == null) return '—';
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
const pctl = (sorted, p) => {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i];
};
const mean = (xs) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;

const loadReplay = (id) => {
  const base = path.join(REPLAYS_DIR, id);
  if (fs.existsSync(`${base}.wc3v`)) {
    return JSON.parse(fs.readFileSync(`${base}.wc3v`, 'utf8'));
  }
  if (fs.existsSync(`${base}.wc3v.gz`)) {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(`${base}.wc3v.gz`)).toString());
  }
  return null;
};

// A click that is evidence of FIGHTING this camp: issued by a hero or combat
// unit standing within the creep leash of it.
const isFightProof = (e) =>
  e.stage === 'interact-creep' && e.zone !== 'out' && !!(e.hasHero || e.hasCombatUnit);

// Contiguous run of camp activity containing time t.
const runAround = (events, t) => {
  if (!events.length || t == null) return null;
  const runs = [];
  let cur = null;
  events.forEach(e => {
    if (cur && (e.gameTime - cur.endT) <= ENGAGEMENT_GAP_MS) {
      cur.endT = e.gameTime;
    } else {
      cur = { startT: e.gameTime, endT: e.gameTime };
      runs.push(cur);
    }
  });
  return runs.find(r => t >= r.startT && t <= r.endT) || null;
};

//
// Everything about a camp that does NOT depend on the model config, extracted
// once so a sweep can re-score thousands of variants cheaply.
//
const campRecord = (camp, replayId) => {
  const events = (camp.perPlayerEvents || []).slice().sort((a, b) => a.gameTime - b.gameTime);
  const engaged = events.filter(e => e.zone !== 'out');
  const proofs = events.filter(isFightProof);
  const anyClicks = events.filter(e => e.stage === 'interact-creep');

  const lo = proofs.length ? proofs[proofs.length - 1].gameTime : null;
  const run = runAround(engaged, lo);
  const hi = run ? run.endT + LATE_GRACE_MS : null;

  return {
    replay: replayId,
    uuid: camp.uuid,
    totalLevel: camp.totalLevel || 0,
    hasFountain: !!camp.hasFountain,
    unitNames: (camp.units || []).map(u => u.displayName),
    // model inputs, kept so a sweep can recompute clearedTime offline
    perPlayerEvents: events,
    settleTime: (camp.settledClear && camp.settledClear.gameTime != null)
      ? camp.settledClear.gameTime : null,
    // shipped answer
    shippedClearedTime: (camp.clearedTime != null) ? camp.clearedTime : null,
    // ground-truth bracket
    lo,
    hi,
    engStart: run ? run.startT : null,
    engEnd: run ? run.endT : null,
    proofCount: proofs.length,
    // Looting a creep drop would prove creeps DIED here — items only exist once
    // something drops them — which would be the ideal anti-degenerate anchor.
    // MEASURED: the corpus contains ZERO interact-item events, because
    // Player.selectGroundItem never fires on these replays (see
    // docs/PHASE0_FIXTURES.md). The check is kept so it lights up if that is
    // ever fixed, but today it grades nothing and must not be read as a pass.
    lootedAt: (() => {
      const it = events.filter(e => e.stage === 'interact-item');
      return it.length ? it[0].gameTime : null;
    })(),
    clickCount: anyClicks.length,
    clickSpanMs: anyClicks.length
      ? (anyClicks[anyClicks.length - 1].gameTime - anyClicks[0].gameTime) : 0
  };
};

//
// Grade one camp's clear time against its bracket.
//
// `error` is scored only over camps the model DID clear, so that a model which
// simply refuses to clear anything cannot win by defaulting. The anti-degenerate
// anchor is `settleMiss`: a building standing on a camp proves it was cleared,
// so leaving such a camp uncleared is a hard, unambiguous failure. Read the two
// together — error alone and settleMiss alone are each gameable, the pair is not.
const grade = (rec, clearedTime) => {
  const gradable = rec.lo != null && rec.hi != null;
  if (!gradable) return { gradable: false };

  // A camp with a settle building was definitely cleared; anything else that
  // never clears may simply never have been cleared, which is not an error.
  if (clearedTime == null) {
    return {
      gradable: true, neverCleared: true, scored: false,
      early: 0, late: 0, error: 0,
      settleMiss: rec.settleTime != null,
      lootMiss: rec.lootedAt != null
    };
  }
  const early = Math.max(0, rec.lo - clearedTime);
  const late = Math.max(0, clearedTime - rec.hi);
  const settleViolation = (rec.settleTime != null && clearedTime > rec.settleTime)
    ? clearedTime - rec.settleTime : 0;
  return {
    gradable: true, neverCleared: false, scored: true,
    early, late, error: early + late, settleViolation,
    settleMiss: false, lootMiss: false
  };
};

//
// Re-run the shipping model over a camp's exported events with `overrides`,
// applying the same settle clamp the parser applies.
//
const recompute = (rec, overrides) => {
  const est = CampCreditModel.estimateClear({
    totalLevel: rec.totalLevel,
    hasFountain: rec.hasFountain,
    perPlayerEvents: rec.perPlayerEvents
  }, overrides);

  let cleared = est.clearedTime;
  if (rec.settleTime != null) {
    cleared = SettlementClear.clampToSettle(
      { perPlayerEvents: rec.perPlayerEvents }, rec.settleTime, cleared);
  }
  return cleared;
};

//
// Aggregate score over all gradable camps.
//
const score = (records, clearedTimeFor) => {
  const graded = [];
  records.forEach(rec => {
    const g = grade(rec, clearedTimeFor(rec));
    if (g.gradable) graded.push(Object.assign({ rec }, g));
  });

  const scored = graded.filter(g => g.scored);
  const errs = scored.map(g => g.error).sort((a, b) => a - b);
  const earlies = scored.filter(g => g.early > 0);
  const lates = scored.filter(g => g.late > 0);
  const never = graded.filter(g => g.neverCleared);

  const settleCamps = graded.filter(g => g.rec.settleTime != null);
  const settleMisses = settleCamps.filter(g => g.settleMiss);
  const lootCamps = graded.filter(g => g.rec.lootedAt != null);
  const lootMisses = lootCamps.filter(g => g.lootMiss);

  // PROXY, not ground truth. With no loot signal available, the check on a
  // model that simply refuses to clear camps is: a camp a fighter hit many
  // times over a sustained window was almost certainly killed. Players do
  // abandon camps, so a nonzero rate here is expected — it is the TREND across
  // a sweep that matters, not the absolute number.
  const heavy = graded.filter(g => g.rec.proofCount >= HEAVY_PROOF_CLICKS &&
    g.rec.lo != null && g.rec.engStart != null &&
    (g.rec.lo - g.rec.engStart) >= HEAVY_ENGAGE_MS);
  const heavyUncleared = heavy.filter(g => g.neverCleared);

  return {
    n: graded.length,
    scoredN: scored.length,
    graded,
    earlyCount: earlies.length,
    lateCount: lates.length,
    neverCount: never.length,
    earlyRate: scored.length ? earlies.length / scored.length : 0,
    lateRate: scored.length ? lates.length / scored.length : 0,
    meanError: mean(errs),
    medianError: pctl(errs, 50),
    p90Error: pctl(errs, 90),
    meanEarly: mean(earlies.map(g => g.early)),
    meanLate: mean(lates.map(g => g.late)),
    settleViolations: scored.filter(g => g.settleViolation > 0).length,
    settleTotal: settleCamps.length,
    settleMisses: settleMisses.length,
    lootTotal: lootCamps.length,
    lootMisses: lootMisses.length,
    heavyTotal: heavy.length,
    heavyUncleared: heavyUncleared.length
  };
};

// ── gather ────────────────────────────────────────────────────────────────
let ids;
if (args.replay) {
  ids = [String(args.replay)];
} else {
  ids = fs.readdirSync(REPLAYS_DIR)
    .filter(f => f.endsWith('.wc3v.gz'))
    .map(f => f.replace(/\.wc3v\.gz$/, ''))
    .sort();

  // Replays whose source .w3g is gone cannot be reparsed, so they keep whatever
  // parser produced them. Grading a model change against stale exports mixes
  // two parsers' output; --reparsed restricts to the last reparse-all run.
  if (args.reparsed) {
    const reportPath = path.join(__dirname, '.reparse-report.json');
    if (!fs.existsSync(reportPath)) {
      console.error('--reparsed: no tools/.reparse-report.json — run tools/reparse-all.js first');
      process.exit(2);
    }
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const rows = report.results || report.replays || [];
    const ok = new Set(rows.filter(r => r && (r.status === 'ok' || r.ok))
      .map(r => r.name || r.id || r.replay));
    ids = ids.filter(id => ok.has(id));
  }

  if (args.limit) ids = ids.slice(0, parseInt(args.limit, 10));
}

const records = [];
let failed = 0;
let replayCount = 0;
ids.forEach(id => {
  let data = null;
  try { data = loadReplay(id); } catch (e) { data = null; }
  if (!data) { failed++; return; }
  replayCount++;
  const groups = (data.world && data.world.neutralGroups) || {};
  Object.values(groups).forEach(c => records.push(campRecord(c, id)));
});

const headline = records.filter(r => SHOW_FOUNTAINS || !r.hasFountain);
const fountainCount = records.filter(r => r.hasFountain).length;

// ── sweep modes ───────────────────────────────────────────────────────────
const reportLine = (label, s) =>
  `${label.padEnd(34)} err ${secs(s.meanError).padStart(7)} mean ${secs(s.medianError).padStart(6)} med  |  ` +
  `early ${String(s.earlyCount).padStart(4)} (${(s.earlyRate * 100).toFixed(1).padStart(4)}%) ` +
  `avg ${secs(s.meanEarly).padStart(6)}  |  ` +
  `late ${String(s.lateCount).padStart(3)} (${(s.lateRate * 100).toFixed(1).padStart(4)}%) ` +
  `avg ${secs(s.meanLate).padStart(6)}  |  ` +
  `heavy-uncleared ${String(s.heavyUncleared).padStart(3)}/${String(s.heavyTotal).padStart(4)}  |  ` +
  `uncleared ${String(s.neverCount).padStart(4)}`;

if (args.sweep || args.grid) {
  const D = CampCreditModel.DEFAULTS;
  console.log(`\n=== Camp clear model sweep — ${replayCount} replays, ` +
    `${headline.length} camps (${headline.filter(r => r.lo != null && r.hi != null).length} gradable) ===\n`);
  console.log(`shipped   = the clearedTime baked into the exported .wc3v`);
  console.log(`defaults  = re-running lib/CampCreditModel.js over the same events\n`);

  console.log(reportLine('shipped (exported)', score(headline, r => r.shippedClearedTime)));
  console.log(reportLine('defaults (current lib)', score(headline, r => recompute(r, {}))));
  console.log('');

  if (args.grid) {
    const key = String(args.grid);
    const ranges = {
      PER_LEVEL_MS: [800, 1200, 1600, 2000, 2400, 2900, 3400, 4000, 4600, 5400, 6200],
      INTERACTION_BOOST_MS: [0, 200, 400, 650, 900],
      INTERACTION_BOOST_CAP: [0, 0.1, 0.25, 0.4, 0.6, 1.0],
      PULL_TIME_WEIGHT: [0.3, 0.5, 0.65, 0.8, 1.0],
      MAX_SEGMENT_GAP_MS: [6000, 9000, 12000, 16000],
      SUBSTANTIAL_FRACTION: [0.05, 0.10, 0.20, 0.35],
      MIN_CLEAR_FRACTION: [0.3, 0.5, 0.7, 0.9]
    };
    const values = ranges[key];
    if (!values) {
      console.error(`--grid: unknown key "${key}". Known: ${Object.keys(ranges).join(', ')}`);
      process.exit(2);
    }
    values.forEach(v => {
      const s = score(headline, r => recompute(r, { [key]: v }));
      console.log(reportLine(`${key}=${v}${v === D[key] ? ' (default)' : ''}`, s));
    });
  } else {
    // one change at a time, then the combination — so each is attributable
    const variants = [
      ['no per-team pools', { PER_TEAM_POOLS: false }],
      ['no in-zone gate on clicks', { REQUIRE_IN_ZONE_BOOST: false }],
      ['uncapped click boost', { INTERACTION_BOOST_CAP: 1.0 }],
      ['no click boost at all', { INTERACTION_BOOST_MS: 0 }],
      ['no proof-of-life clamp', { CLAMP_TO_PROOF_OF_LIFE: false }],
      ['no interaction window', { INTERACTION_WINDOW_MS: 0 }],
      // Faithful reproduction of the model that shipped before this pass. The
      // old code multiplied all work by HERO_BOOST_FACTOR 1.20 against a
      // requirement of 2400/level; that is identical to unscaled work against
      // 2400/1.20 = 2000/level, so the legacy behaviour is exactly recoverable
      // here. Running this against a replay exported by the OLD parser should
      // reproduce its clearedTime — which is how the refactor was verified.
      ['pre-fix model (legacy equivalent)', {
        PER_TEAM_POOLS: false, REQUIRE_IN_ZONE_BOOST: false,
        INTERACTION_BOOST_CAP: 1.0, PER_LEVEL_MS: 2000,
        INTERACTION_WINDOW_MS: 0, CLAMP_TO_PROOF_OF_LIFE: false
      }]
    ];
    variants.forEach(([label, ov]) => console.log(reportLine(label, score(headline, r => recompute(r, ov)))));
  }
  console.log('');
  process.exit(0);
}

// ── shipped-value report ──────────────────────────────────────────────────
const s = score(headline, r => r.shippedClearedTime);

if (AS_JSON) {
  console.log(JSON.stringify({
    replays: replayCount, camps: records.length, gradable: s.n,
    meanErrorMs: s.meanError, medianErrorMs: s.medianError, p90ErrorMs: s.p90Error,
    earlyCount: s.earlyCount, earlyRate: s.earlyRate, meanEarlyMs: s.meanEarly,
    lateCount: s.lateCount, lateRate: s.lateRate, meanLateMs: s.meanLate,
    neverCleared: s.neverCount, settleViolations: s.settleViolations
  }, null, 2));
  process.exit(0);
}

if (args.replay) {
  console.log(`\n=== Camp clear audit — ${ids[0]} ===\n`);
  records
    .slice()
    .sort((a, b) => (a.shippedClearedTime == null ? Infinity : a.shippedClearedTime) -
                    (b.shippedClearedTime == null ? Infinity : b.shippedClearedTime))
    .forEach((r, i) => {
      const g = grade(r, r.shippedClearedTime);
      const verdict = !g.gradable ? 'ungradable'
        : g.neverCleared ? 'NEVER CLEARED'
        : g.early > 0 ? 'EARLY' : g.late > 0 ? 'LATE' : 'ok';
      console.log(`  Camp ${i + 1}: Lv${r.totalLevel} ${verdict}${r.hasFountain ? ' [fountain]' : ''}`);
      console.log(`    ${r.unitNames.join(', ')}`);
      console.log(`    cleared=${fmt(r.shippedClearedTime)}   ` +
        `bracket=[${fmt(r.lo)} .. ${fmt(r.hi)}]   activity=${fmt(r.engStart)}–${fmt(r.engEnd)}`);
      console.log(`    proof of life: ${r.proofCount} in-zone fighter clicks ` +
        `(${r.clickCount} creep clicks total over ${secs(r.clickSpanMs)})`);
      if (g.gradable && g.early > 0) {
        console.log(`    >> EARLY by ${secs(g.early)} — a fighter was still hitting creeps at ${fmt(r.lo)}`);
      }
      if (g.gradable && g.late > 0) {
        console.log(`    >> LATE by ${secs(g.late)} — all camp activity ended at ${fmt(r.engEnd)}`);
      }
      if (r.settleTime != null) {
        console.log(`    settled by building at ${fmt(r.settleTime)}` +
          (g.settleViolation > 0 ? `  >> VIOLATION` : ''));
      }
      console.log('');
    });
}

console.log(`──────── CAMP CLEAR AUDIT ────────`);
console.log(`replays: ${replayCount}${failed ? ` (${failed} unreadable)` : ''}`);
console.log(`camps: ${records.length} total, ${s.n} gradable` +
  (SHOW_FOUNTAINS ? '' : ` (${fountainCount} fountain camps excluded)`));
console.log('');
console.log(`ERROR vs the [proof-of-life .. end-of-fight] bracket`);
console.log(`  mean ${secs(s.meanError)}   median ${secs(s.medianError)}   p90 ${secs(s.p90Error)}`);
console.log('');
console.log(`  TOO EARLY (creeps provably alive after the declared clear)`);
console.log(`    ${s.earlyCount}/${s.n} camps (${(s.earlyRate * 100).toFixed(1)}%), avg ${secs(s.meanEarly)}`);
console.log(`  TOO LATE (declared clear long after all camp activity stopped)`);
console.log(`    ${s.lateCount}/${s.n} camps (${(s.lateRate * 100).toFixed(1)}%), avg ${secs(s.meanLate)}`);
console.log(`  NEVER CLEARED despite a real fight: ${s.neverCount}`);
console.log(`  SETTLE-BOUND violations (cleared after a building went up): ${s.settleViolations}`);

// A camp fight is bounded in time. A camp fed hundreds of creep clicks spread
// over many minutes is receiving clicks aimed at something else — the
// right-click target resolved to the wrong neutral, injecting fake work.
const suspect = records.filter(r => r.clickCount >= 50 && r.clickSpanMs > 300000);
const suspectClicks = suspect.reduce((a, r) => a + r.clickCount, 0);
const allClicks = records.reduce((a, r) => a + r.clickCount, 0);
console.log('');
console.log(`TARGET RESOLUTION  camps fed implausible click volumes (>=50 clicks over >5min)`);
console.log(`  suspect camps: ${suspect.length}/${records.length}` +
  `  carrying ${suspectClicks}/${allClicks} of all creep clicks ` +
  `(${allClicks ? (suspectClicks / allClicks * 100).toFixed(1) : '0.0'}%)`);

if (!args.replay && s.earlyCount) {
  console.log(`\n──────── WORST (top ${TOP_N} by error) ────────`);
  s.graded
    .filter(g => g.error > 0)
    .sort((a, b) => b.error - a.error)
    .slice(0, TOP_N)
    .forEach(g => {
      const kind = g.neverCleared ? 'never' : (g.early > 0 ? 'early' : 'late ');
      console.log(`  ${secs(g.error).padStart(8)} ${kind}  Lv${String(g.rec.totalLevel).padStart(2)}  ` +
        `cleared ${fmt(g.rec.shippedClearedTime)}  bracket [${fmt(g.rec.lo)}..${fmt(g.rec.hi)}]  ${g.rec.replay}`);
    });
}

process.exit(0);
