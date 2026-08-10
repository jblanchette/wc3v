/**
 * validate-engine-truth.js — score the viewer's reconstruction against
 * hand-authored observations of the REAL game engine playing the same replay.
 *
 * Ground truth comes from watching WC3 (Reforged) play the replay back —
 * see docs/ENGINE_TRUTH_CAPTURE.md for the capture protocol. Fixtures live in
 * client/data/engine-truth/<replay-id>.json and must NEVER be authored from
 * parser output (that would be circular); the only exception is a fixture
 * whose meta._circular flag is set, which marks a harness selftest that
 * fidelity-report deliberately ignores.
 *
 * What is scored is what the VIEWER would show: the world is built through
 * the same UnitBehavior module the browser loads, so a fixture failure means
 * a user-visible mistake, not just a data quirk.
 *
 * Observation types:
 *   unitPosition  { t, who:{player, unitType}, pos:{x,y}, tolerance? }
 *   death         { t:"MM:SS..MM:SS", who:{player, unitType, count?}, near?:{x,y,r} }
 *   engagement    { from, to, area:{x,y,r}, attacking:[{player, unitType, count?}] }
 *   noCombat      { from, to, who:{player}, area:{x,y,r} }
 *   campClear     { match:{totalLevel, units[]}, clearedAt:"MM:SS..MM:SS", by? }
 *   cluster       { t, who:{player, unitType?}, area:{x,y,r}, count }
 *                 — N units inside the radius at t, attack state irrelevant.
 *                 The surround assert: "18 of 20 grunts within 300u of the farm".
 *   notIdle       { from, to, who:{player, unitType?}, area?:{x,y,r}, maxIdlePct? }
 *                 — matching units' idle share over the window stays under
 *                 maxIdlePct (default 25). The freeze catcher for designed
 *                 scenarios: blocked attackers must keep pathing, not stand.
 *
 * Comparators (counts): true/false, 123, ">=N", "<=N", ">N", "<N", "==N", "A..B".
 * Times: "MM:SS", raw ms, or "A..B" ranges of either. campClear ranges should
 * span ≥20s — derived camp times jitter ±10s across re-parses.
 *
 * meta.source: "capture" (default; expectations from watching Reforged) or
 * "designed-map" — a scenario map built for the purpose, where truth comes
 * from the map design itself plus one watch of the recording. Both are
 * legitimately non-circular and both are COUNTED by fidelity-report; only
 * meta._circular selftests are skipped.
 *
 * Usage:
 *   node tools/validate-engine-truth.js --replay=ID [--verbose] [--threshold=0.8]
 *   node tools/validate-engine-truth.js --fixture=PATH [--verbose]
 */

const fs = require('fs');
const path = require('path');

const BM = require('./lib/behavior-metrics.js');
const UB = BM.UB;

const TRUTH_DIR = path.join(__dirname, '..', 'client', 'data', 'engine-truth');
const DEFAULT_POS_TOLERANCE = 320;   // wu, ≈ 2.5 tiles
const SAMPLE_STEP_MS = 500;          // engagement / noCombat window sampling
const AMBIGUITY_FACTOR = 1.5;

// --- token parsing ----------------------------------------------------------

function parseTime (v) {
  if (typeof v === 'number') return v;
  const m = String(v).trim().match(/^(\d+):(\d{1,2})$/);
  if (m) return (+m[1] * 60 + +m[2]) * 1000;
  const n = Number(v);
  if (!Number.isNaN(n)) return n;
  throw new Error(`bad time token: ${JSON.stringify(v)}`);
}

function parseTimeRange (v) {
  const s = String(v).trim();
  const m = s.match(/^(.+?)\.\.(.+)$/);
  if (m) return { lo: parseTime(m[1]), hi: parseTime(m[2]) };
  const t = parseTime(v);
  return { lo: t, hi: t };
}

// count comparator — same grammar as validate-camp-credit.js
function checkCount (actual, expected) {
  if (expected == null) expected = '>=1';
  if (typeof expected === 'boolean') {
    return { pass: !!actual === expected, why: `${actual} (want ${expected})` };
  }
  if (typeof expected === 'number') {
    return { pass: actual === expected, why: `${actual} (want ==${expected})` };
  }
  const s = String(expected).trim();
  const num = Number(actual);
  let m;
  if ((m = s.match(/^(>=|<=|==|>|<)\s*(-?\d+(?:\.\d+)?)$/))) {
    const t = parseFloat(m[2]);
    const ops = { '>=': num >= t, '<=': num <= t, '==': num === t, '>': num > t, '<': num < t };
    return { pass: ops[m[1]], why: `${actual} (want ${s})` };
  }
  if ((m = s.match(/^(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)$/))) {
    const lo = parseFloat(m[1]), hi = parseFloat(m[2]);
    return { pass: num >= lo && num <= hi, why: `${actual} (want ${lo}..${hi})` };
  }
  return { pass: String(actual) === s, why: `${actual} (want ${s})` };
}

// --- unit resolution --------------------------------------------------------

function typeMatches (u, unitType) {
  if (!unitType) return true;
  const want = String(unitType).toLowerCase();
  return (u.displayName || '').toLowerCase() === want ||
         (u.itemId || '').toLowerCase() === want;
}

function playerUnits (data, player) {
  const p = (data.players || {})[String(player)];
  return (p && p.units) || [];
}

// Units of the given player+type alive at t (fixtures never know uuids).
function aliveCandidates (data, who, t) {
  return playerUnits(data, who.player).filter(u => {
    if (!u.path || !u.path.length || u.isBuilding) return false;
    if (!typeMatches(u, who.unitType || who.heroName)) return false;
    if (UB.readyTimeOf(u) > t) return false;
    const death = UB.deathStartOf(u);
    if (death != null && death <= t) return false;
    return true;
  });
}

const dist2d = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

// --- evaluators (each returns { pass, blatant, why, ambiguous? }) -----------

function evalUnitPosition (data, obs) {
  const t = parseTime(obs.t);
  const tol = obs.tolerance || DEFAULT_POS_TOLERANCE;
  const cands = aliveCandidates(data, obs.who || {}, t);
  if (!cands.length) {
    return { pass: false, blatant: true, why: `no living ${obs.who && obs.who.unitType} for p${obs.who && obs.who.player} at ${obs.t}` };
  }
  const ranked = cands.map(u => {
    const s = UB.sampleAt(u.path, t);
    return { u, d: s ? dist2d(s.x, s.y, obs.pos.x, obs.pos.y) : Infinity };
  }).sort((a, b) => a.d - b.d);
  const best = ranked[0];
  const ambiguous = ranked.filter(r => r.d <= tol * AMBIGUITY_FACTOR).length;
  return {
    pass: best.d <= tol,
    blatant: best.d > tol * 2,
    ambiguous: ambiguous > 1 ? ambiguous : undefined,
    posErr: Math.round(best.d),
    why: `closest ${best.u.displayName || best.u.itemId} at ${Math.round(best.d)}u (tol ${tol}u${ambiguous > 1 ? `, ${ambiguous} candidates — tighten who/pos` : ''})`
  };
}

function evalDeath (data, obs) {
  const { lo, hi } = parseTimeRange(obs.t);
  const who = obs.who || {};
  let count = 0;
  for (const u of playerUnits(data, who.player)) {
    if (u.isBuilding || !typeMatches(u, who.unitType)) continue;
    const death = UB.deathStartOf(u);
    if (death == null || death < lo || death > hi) continue;
    if (obs.near && u.path && u.path.length) {
      const s = UB.sampleAt(u.path, death);
      if (!s || dist2d(s.x, s.y, obs.near.x, obs.near.y) > (obs.near.r || 800)) continue;
    }
    count++;
  }
  const res = checkCount(count, who.count);
  return { pass: res.pass, blatant: false, why: `deaths in window: ${res.why}` };
}

// Shared window sampler: per tick, attack-state decisions inside an area.
function attackFramesInArea (world, from, to, area, filterFn) {
  const hits = [];
  for (let t = from; t <= to; t += SAMPLE_STEP_MS) {
    const frame = world.resolve(t);
    const tickHits = [];
    for (const l of frame.live) {
      const d = frame.byUuid.get(l.uuid);
      if (!d || d.state !== 'attack') continue;
      if (area && dist2d(d.x, d.y, area.x, area.y) > (area.r || 900)) continue;
      if (filterFn && !filterFn(l)) continue;
      tickHits.push(l);
    }
    if (tickHits.length) hits.push({ t, units: tickHits });
  }
  return hits;
}

function evalEngagement (data, world, obs) {
  const from = parseTime(obs.from), to = parseTime(obs.to);
  const parts = [];
  let pass = true;
  for (const a of (obs.attacking || [])) {
    const hits = attackFramesInArea(world, from, to, obs.area, l =>
      l.u._playerId === Number(a.player) && typeMatches(l.u, a.unitType));
    const maxSimultaneous = hits.reduce((m, h) => Math.max(m, h.units.length), 0);
    const res = checkCount(maxSimultaneous, a.count);
    if (!res.pass) pass = false;
    parts.push(`p${a.player} ${a.unitType || 'any'}: max ${res.why}`);
  }
  // an engagement failure = the viewer SUPPRESSED real combat (over-suppression)
  return { pass, blatant: false, why: parts.join('; ') };
}

function evalNoCombat (data, world, obs) {
  const from = parseTime(obs.from), to = parseTime(obs.to);
  const who = obs.who || {};
  const hits = attackFramesInArea(world, from, to, obs.area, l =>
    (who.player == null || l.u._playerId === Number(who.player)) &&
    typeMatches(l.u, who.unitType));
  const offenders = [...new Set(hits.flatMap(h => h.units.map(l => l.u.displayName || l.u.itemId)))];
  return {
    pass: hits.length === 0,
    blatant: hits.length > 0,   // phantom combat — the headline mistake
    why: hits.length === 0 ? 'no attack frames (correct)'
      : `${hits.length} PHANTOM attack tick(s): ${offenders.slice(0, 4).join(', ')} first at ${Math.round(hits[0].t / 1000)}s`
  };
}

// N units of a player (optionally a type) inside an area at one instant —
// position only, no attack-state requirement. This is the assert engagement
// cannot express: a surround is proven by WHERE the units stand.
function evalCluster (data, obs) {
  const t = parseTime(obs.t);
  const who = obs.who || {};
  const area = obs.area || {};
  let count = 0;
  for (const u of playerUnits(data, who.player)) {
    if (u.isBuilding || !u.path || !u.path.length) continue;
    if (who.unitType && !typeMatches(u, who.unitType)) continue;
    if (UB.readyTimeOf(u) > t) continue;
    const death = UB.deathStartOf(u);
    if (death != null && death <= t) continue;
    const s = UB.sampleAt(u.path, t);
    if (!s) continue;
    if (dist2d(s.x, s.y, area.x, area.y) > (area.r || 300)) continue;
    count++;
  }
  const res = checkCount(count, obs.count);
  return { pass: res.pass, blatant: false, why: `units within ${area.r || 300}u: ${res.why}` };
}

// Matching units must stay busy through the window: idle decisions under
// maxIdlePct of their sampled frames. The designed-scenario freeze catcher.
function evalNotIdle (data, world, obs) {
  const from = parseTime(obs.from), to = parseTime(obs.to);
  const who = obs.who || {};
  const area = obs.area || null;
  let idle = 0, total = 0;
  for (let t = from; t <= to; t += SAMPLE_STEP_MS) {
    const frame = world.resolve(t);
    for (const l of frame.live) {
      if (l.u.isBuilding) continue;
      if (who.player != null && l.u._playerId !== Number(who.player)) continue;
      if (who.unitType && !typeMatches(l.u, who.unitType)) continue;
      if (area && dist2d(l.x, l.y, area.x, area.y) > (area.r || 900)) continue;
      const d = frame.byUuid.get(l.uuid);
      if (!d) continue;
      total++;
      if (d.state === 'idle') idle++;
    }
  }
  const maxIdlePct = obs.maxIdlePct != null ? obs.maxIdlePct : 25;
  const pct = total ? (100 * idle / total) : 0;
  return {
    pass: total > 0 && pct <= maxIdlePct,
    blatant: false,
    why: total
      ? `${pct.toFixed(1)}% idle frames over ${total} samples (max ${maxIdlePct}%)`
      : 'no matching unit-frames in window'
  };
}

// same level + unit-name subset match as validate-camp-credit.js
function findCamp (groups, match) {
  const want = (match.units || []).slice().sort();
  return Object.values(groups).find(g => {
    if (match.totalLevel != null && g.totalLevel !== match.totalLevel) return false;
    if (!want.length) return true;
    const have = (g.units || []).map(u => u.displayName).sort();
    return want.every(w => have.includes(w));
  });
}

function evalCampClear (data, obs) {
  const groups = (data.world && data.world.neutralGroups) || {};
  const g = findCamp(groups, obs.match || {});
  if (!g) return { pass: false, blatant: false, why: `no camp matches ${JSON.stringify(obs.match)}` };
  const cleared = g.clearedTime != null ? g.clearedTime
    : (g.settledClear && g.settledClear.gameTime);
  if (cleared == null) return { pass: false, blatant: false, why: 'camp never marked cleared' };
  const { lo, hi } = parseTimeRange(obs.clearedAt);
  let pass = cleared >= lo && cleared <= hi;
  let why = `cleared at ${Math.round(cleared / 1000)}s (want ${Math.round(lo / 1000)}–${Math.round(hi / 1000)}s)`;
  if (pass && obs.by != null) {
    const credit = (g.playerCredit || {})[String(obs.by)];
    if (!credit || !credit.credited) { pass = false; why += `; p${obs.by} NOT credited`; }
    else why += `; p${obs.by} credited`;
  }
  return { pass, blatant: false, why };
}

// --- scoring ----------------------------------------------------------------

/**
 * Score a fixture against a loaded .wc3v. Returns:
 * { total, passed, blatant, categories: {type: {total, passed}},
 *   posErr: {median, p90} | null, details: [{type, pass, blatant, why, ...}] }
 */
function score (data, fixture) {
  const world = BM.createWorld(data);
  const categories = {};
  const details = [];
  const posErrs = [];
  let blatant = 0;

  for (const obs of (fixture.observations || [])) {
    let r;
    try {
      switch (obs.type) {
        case 'unitPosition': r = evalUnitPosition(data, obs); break;
        case 'death': r = evalDeath(data, obs); break;
        case 'engagement': r = evalEngagement(data, world, obs); break;
        case 'noCombat': r = evalNoCombat(data, world, obs); break;
        case 'campClear': r = evalCampClear(data, obs); break;
        case 'cluster': r = evalCluster(data, obs); break;
        case 'notIdle': r = evalNotIdle(data, world, obs); break;
        default: r = { pass: false, blatant: false, why: `unknown type ${obs.type}` };
      }
    } catch (e) {
      r = { pass: false, blatant: false, why: `eval error: ${e.message}` };
    }
    const cat = categories[obs.type] = categories[obs.type] || { total: 0, passed: 0 };
    cat.total++;
    if (r.pass) cat.passed++;
    if (r.blatant) blatant++;
    if (r.posErr != null) posErrs.push(r.posErr);
    details.push(Object.assign({ type: obs.type, note: obs.note }, r));
  }

  posErrs.sort((a, b) => a - b);
  const pctl = (q) => posErrs.length ? posErrs[Math.min(posErrs.length - 1, Math.floor(q * posErrs.length))] : null;

  return {
    total: details.length,
    passed: details.filter(d => d.pass).length,
    blatant,
    categories,
    posErr: posErrs.length ? { median: pctl(0.5), p90: pctl(0.9), samples: posErrs.length } : null,
    details
  };
}

module.exports = { score, findCamp, checkCount, parseTime, parseTimeRange, TRUTH_DIR };

// --- CLI --------------------------------------------------------------------

if (require.main === module) {
  const args = {};
  process.argv.slice(2).forEach(raw => {
    const [flag, ...rest] = raw.replace(/^--/, '').split('=');
    args[flag] = rest.join('=') || true;
  });

  let fixtureFile;
  if (args.fixture) fixtureFile = path.resolve(String(args.fixture));
  else if (args.replay) fixtureFile = path.join(TRUTH_DIR, `${args.replay}.json`);
  else {
    console.error('usage: node tools/validate-engine-truth.js --replay=ID | --fixture=PATH [--verbose] [--threshold=0.8]');
    process.exit(2);
  }
  if (!fs.existsSync(fixtureFile)) {
    console.error(`no fixture: ${fixtureFile}`);
    process.exit(2);
  }

  const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
  const id = fixture.replayId || args.replay;
  const data = BM.loadReplay(id);
  const result = score(data, fixture);

  console.log(`\nengine-truth: ${id}${fixture.meta && fixture.meta._circular ? '  [CIRCULAR SELFTEST — proves harness, not fidelity]' : ''}`);
  console.log(`  ${result.passed}/${result.total} checks passed   blatant failures: ${result.blatant}`);
  for (const [cat, v] of Object.entries(result.categories)) {
    console.log(`  ${cat.padEnd(14)} ${v.passed}/${v.total}`);
  }
  if (result.posErr) {
    console.log(`  position error median=${result.posErr.median}u p90=${result.posErr.p90}u (${result.posErr.samples} samples)`);
  }
  if (args.verbose) {
    console.log('');
    result.details.forEach((d, i) => {
      console.log(`  ${d.pass ? '✓' : '✗'} #${i + 1} ${d.type}${d.blatant && !d.pass ? ' [BLATANT]' : ''} — ${d.why}${d.note ? `   (${d.note})` : ''}`);
    });
  }

  const passRate = result.total ? result.passed / result.total : 1;
  if (args.threshold && passRate < parseFloat(args.threshold)) {
    console.log(`\nFAIL: pass rate ${(100 * passRate).toFixed(1)}% below threshold`);
    process.exit(1);
  }
}
