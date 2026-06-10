//
// build-match.js — score how well a parsed replay executes a manifest build.
//
// Pure + reusable: feed it parsed .wc3v data + a builds-manifest entry (the one
// with `tierProgression`) and it grades the followed player's execution against
// the build's KNOWN plan — hero opener, tier-1/2/3 buildings & units, tier
// timing windows, tech order, macro cleanliness, watchability. This is the
// engine the hybrid replay-sourcing workflow uses: drop a pile of replays, rank
// each per build, surface the single best teaching replay.
//
// It measures "does this replay EXECUTE this build", NOT "is the player a pro".
// A clean low-ELO execution scores higher than a messy pro improvisation.
//
// Consumed by tools/score-build-match.js (CLI) and the curation flow.
//
'use strict';

const SECOND = 1000, MINUTE = 60 * 1000;

// Parse a "5:30-6:00" (or "5:30") timing window to {minMs, maxMs} or null.
function parseTimingWindow (timing) {
  if (!timing || typeof timing !== 'string') return null;
  const parts = timing.split('-').map(s => s.trim()).filter(Boolean);
  const toMs = (mmss) => {
    const m = /^(\d+):(\d{1,2})$/.exec(mmss);
    if (!m) return null;
    return (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * SECOND;
  };
  const a = toMs(parts[0]);
  if (a == null) return null;
  const b = parts[1] != null ? toMs(parts[1]) : a;
  return { minMs: a, maxMs: (b == null ? a : b) };
}

// Followed player's eventStream (data.players is keyed by player id/slot).
function playerData (data, slot) {
  const players = (data && data.players) || {};
  return players[slot] || players[String(slot)] || null;
}

function nonNeutralSlots (data) {
  const players = (data && data.players) || {};
  return Object.keys(players).filter(k => players[k] && !players[k].isNeutralPlayer);
}

function firstHeroId (stream) {
  let best = null;
  for (const e of stream) {
    if (e && e.key === 'addUnit' && e.unit && e.unit.isHero) {
      if (!best || e.gameTime < best.gameTime) best = e;
    }
  }
  return best ? best.unit.itemId : null;
}

// Earliest gameTime each building itemId first appears (addBuilding).
function buildingFirstTimes (stream) {
  const out = {};
  for (const e of stream) {
    if (e && e.key === 'addBuilding' && e.building && e.building.itemId) {
      const id = e.building.itemId;
      if (out[id] == null || e.gameTime < out[id]) out[id] = e.gameTime;
    }
  }
  return out;
}

// Earliest gameTime each trained (non-summon, non-illusion) unit itemId appears.
function unitFirstTimes (stream) {
  const out = {};
  for (const e of stream) {
    if (e && e.key === 'addUnit' && e.unit && e.unit.itemId && !e.unit.isSummon && !e.unit.isIllusion) {
      const id = e.unit.itemId;
      if (out[id] == null || e.gameTime < out[id]) out[id] = e.gameTime;
    }
  }
  return out;
}

// gameTime the player reached a given tier (2 or 3) from tierStream, or null.
function tierTimeMs (pdata, tier) {
  const ts = (pdata && pdata.tierStream) || [];
  let best = null;
  for (const t of ts) {
    if (t && t.tier >= tier && (best == null || t.gameTime < best)) best = t.gameTime;
  }
  return best;
}

// First appearance of any unit/building that REQUIRES this tier (per the build's
// own tier plan). A tier-N unit can't exist before tier N, so this is a reliable
// "at tier N by" signal — immune to the tierStream/selectSubgroup mis-detection
// that fires ~3 min early on W3C/FLO replays. Returns null if no marker appeared.
function markerTierTime (build, bt, ut, tier) {
  const tp = (build.tierProgression || {})['t' + tier] || {};
  let earliest = null;
  const take = (t) => { if (t != null && (earliest == null || t < earliest)) earliest = t; };
  for (const id of (tp.buildings || [])) take(bt[id]);
  for (const id of (tp.units || [])) take(ut[id]);
  return earliest;
}

// Reconcile the tierStream time with the marker (first tier-requiring unit)
// time. The tierStream is the parser's best tier-reached estimate; trust it
// EXCEPT for the one impossible case (stream LATER than a tier unit, which
// means a tier-N unit existed before tier N was "reached" — the stream is then
// wrong/late, so use the marker). A stream EARLIER than the first tier unit is
// normal (reach the tier, then build units) — trust it, but flag a large gap
// for human review (could be a real fast-tech OR mis-detection — we can't tell
// without ground truth). Returns { ms, source, diverge: bool }.
function reconcileTierTime (streamMs, markerMs) {
  if (streamMs == null && markerMs == null) return { ms: null, source: 'none', diverge: false };
  if (streamMs == null) return { ms: markerMs, source: 'marker', diverge: false };
  if (markerMs == null) return { ms: streamMs, source: 'stream', diverge: false };
  if (streamMs > markerMs) return { ms: markerMs, source: 'marker-clamped', diverge: true };
  return { ms: streamMs, source: 'stream', diverge: (markerMs - streamMs) > 150 * SECOND };
}

function maxTierReached (pdata) {
  const ts = (pdata && pdata.tierStream) || [];
  let m = 1;
  for (const t of ts) if (t && t.tier > m) m = t.tier;
  return m;
}

function gameLengthMs (data) {
  let max = 0;
  for (const k of nonNeutralSlots(data)) {
    const s = (data.players[k].eventStream) || [];
    for (const e of s) if (e && e.gameTime > max) max = e.gameTime;
  }
  return max;
}

function peakHeroLevel (stream, heroItemId) {
  const want = heroItemId ? String(heroItemId).toLowerCase() : null;
  let lvl = 0;
  for (const e of stream) {
    if (e && e.key === 'HeroLevel' &&
        (!want || (e.unit && String(e.unit.itemId).toLowerCase() === want))) {
      if (e.newLevel > lvl) lvl = e.newLevel;
    }
  }
  return lvl;
}

// Graded closeness of `t` to a window: 1.0 inside, decaying to 0 over ~90s slack.
function windowScore (t, win) {
  if (t == null) return 0;
  if (!win) return t > 0 ? 0.6 : 0;            // no expected window → presence credit only
  if (t >= win.minMs && t <= win.maxMs) return 1;
  const SLACK = 90 * SECOND;
  const d = (t < win.minMs) ? (win.minMs - t) : (t - win.maxMs);
  return Math.max(0, 1 - d / SLACK);
}

// Fraction of expected itemIds present (optionally requiring "early" = before
// cutoffMs). Returns 0..1; an empty expected list scores 1 (nothing to miss).
function coverage (expectedIds, firstTimes, cutoffMs) {
  if (!expectedIds || !expectedIds.length) return 1;
  let hit = 0;
  for (const id of expectedIds) {
    const t = firstTimes[id];
    if (t != null && (cutoffMs == null || t <= cutoffMs)) hit++;
  }
  return hit / expectedIds.length;
}

// ── The score ────────────────────────────────────────────────────────────
// Weighted 0..100. Each dimension reports raw 0..1 + its weighted points so a
// human (and the curation ranker) can see WHY a replay scored what it did.
const WEIGHTS = {
  hero: 18,          // opened with the build's hero
  t1: 14,            // tier-1 buildings + core unit present early
  t2: 22,            // tier-2 timing window + buildings/units
  t3: 14,            // tier-3 timing window + buildings/units (prorated if game ended pre-T3)
  techOrder: 8,      // tiers in order, sane spacing
  macro: 16,         // hero creeped (leveled), tier progress, watchable length
  watchability: 8,   // length 8-22 min, reached at least T2
};

function scoreBuildMatch (data, build, slot) {
  const pdata = playerData(data, slot);
  const notes = [];
  if (!pdata) return { score: 0, breakdown: {}, notes: ['player slot not found'], slot, valid: false };

  const stream = pdata.eventStream || [];
  const tp = build.tierProgression || {};
  const bt = buildingFirstTimes(stream);
  const ut = unitFirstTimes(stream);

  const fmtT = (ms) => ms == null ? '—' : (Math.floor(ms / MINUTE) + ':' + String(Math.round((ms % MINUTE) / SECOND)).padStart(2, '0'));
  const streamT2 = tierTimeMs(pdata, 2), streamT3 = tierTimeMs(pdata, 3);
  const t2Rec = reconcileTierTime(streamT2, markerTierTime(build, bt, ut, 2));
  const t3Rec = reconcileTierTime(streamT3, markerTierTime(build, bt, ut, 3));
  const t2Time = t2Rec.ms, t3Time = t3Rec.ms;
  if (t2Rec.diverge) notes.push(`T2: tierStream=${fmtT(streamT2)} vs first T2-unit ~${fmtT(markerTierTime(build, bt, ut, 2))} (fast-tech or detection — verify)`);
  if (t3Rec.diverge) notes.push(`T3: tierStream=${fmtT(streamT3)} vs first T3-unit ~${fmtT(markerTierTime(build, bt, ut, 3))} (fast-tech or detection — verify)`);
  const t2Win = parseTimingWindow(tp.t2 && tp.t2.timing);
  const t3Win = parseTimingWindow(tp.t3 && tp.t3.timing);
  const lenMs = gameLengthMs(data);

  // race sanity: the build's race should match the player's
  const raceMatch = !build.race || !pdata.race || (build.race === pdata.race);

  // hero (WC3 hero itemIds are capitalized — Udea/Ulic/Hmkg — but manifest
  // entries are sometimes lowercased, so compare case-insensitively)
  const fh = firstHeroId(stream);
  const sameHero = (a, b) => a && b && String(a).toLowerCase() === String(b).toLowerCase();
  let heroRaw = 0;
  if (sameHero(fh, build.heroItemId)) heroRaw = 1;
  else if (fh) heroRaw = 0.35;                  // made A hero, just not the build's opener
  if (build.heroItemId && !sameHero(fh, build.heroItemId)) {
    notes.push(`hero opener ${fh || 'none'} != build ${build.heroItemId}`);
  }

  // tier-1: buildings (before T2 if known) + core units
  const t1Cut = t2Time || (5.5 * MINUTE);
  const t1bld = coverage((tp.t1 && tp.t1.buildings) || [], bt, t1Cut);
  const t1unit = coverage((tp.t1 && tp.t1.units) || [], ut, null);
  const t1Raw = 0.7 * t1bld + 0.3 * t1unit;

  // tier-2: timing window (graded) + coverage
  const t2cov = 0.5 * coverage((tp.t2 && tp.t2.buildings) || [], bt, null) +
                0.5 * coverage((tp.t2 && tp.t2.units) || [], ut, null);
  const t2Raw = 0.55 * windowScore(t2Time, t2Win) + 0.45 * t2cov;
  if (t2Time == null) notes.push('never reached Tier 2');

  // tier-3: prorate — if the game (or this build) legitimately ends before T3,
  // don't punish. Credit reaching T3 in-window + coverage; if no T3 expected,
  // neutral 0.7.
  let t3Raw;
  const expectsT3 = !!(tp.t3 && (tp.t3.timing || (tp.t3.buildings || []).length || (tp.t3.units || []).length));
  if (!expectsT3) {
    t3Raw = 0.7;
  } else if (t3Time == null) {
    // reached only T2 — partial credit if the game was short (a clean T2 game)
    t3Raw = lenMs < 11 * MINUTE ? 0.45 : 0.1;
    notes.push('never reached Tier 3');
  } else {
    const t3cov = 0.5 * coverage((tp.t3 && tp.t3.buildings) || [], bt, null) +
                  0.5 * coverage((tp.t3 && tp.t3.units) || [], ut, null);
    t3Raw = 0.55 * windowScore(t3Time, t3Win) + 0.45 * t3cov;
  }

  // tech order: T2 before T3, T2 not absurdly fast/slow. Don't penalize ordering
  // when the tier data is already flagged suspect (parser/manifest noise) — the
  // suspect note already carries that signal and harsh double-penalty distorts
  // the ranking.
  let techRaw = 1;
  const tierDiverge = t2Rec.diverge || t3Rec.diverge;
  if (!tierDiverge && t2Time != null && t3Time != null && t3Time < t2Time) { techRaw = 0; notes.push('T3 before T2 (data anomaly)'); }
  if (!tierDiverge && t2Time != null && t2Time < 2 * MINUTE) { techRaw *= 0.4; notes.push('T2 implausibly fast'); }

  // macro: hero creeped (leveled up) + tier progress + reasonable game shape
  const heroLvl = peakHeroLevel(stream, build.heroItemId);
  const heroLeveled = Math.min(1, heroLvl / 3);            // reaching ~L3+ = full
  const tierProg = Math.min(1, (maxTierReached(pdata) - 1) / 2);
  const macroRaw = 0.5 * heroLeveled + 0.5 * tierProg;
  if (heroLvl < 2) notes.push(`hero only reached level ${heroLvl}`);

  // watchability
  const lenMin = lenMs / MINUTE;
  const lenOk = (lenMin >= 8 && lenMin <= 22) ? 1 : (lenMin < 8 ? Math.max(0, lenMin / 8) : Math.max(0, 1 - (lenMin - 22) / 18));
  const watchRaw = 0.6 * lenOk + 0.4 * (t2Time != null ? 1 : 0);

  const dims = {
    hero: heroRaw, t1: t1Raw, t2: t2Raw, t3: t3Raw,
    techOrder: techRaw, macro: macroRaw, watchability: watchRaw,
  };
  let score = 0;
  const breakdown = {};
  for (const k of Object.keys(WEIGHTS)) {
    const pts = dims[k] * WEIGHTS[k];
    breakdown[k] = { raw: +dims[k].toFixed(3), weight: WEIGHTS[k], points: +pts.toFixed(1) };
    score += pts;
  }
  // race mismatch is disqualifying for a build-match
  if (!raceMatch) { score *= 0.15; notes.push(`race ${pdata.race} != build race ${build.race}`); }

  return {
    score: +score.toFixed(1),
    breakdown,
    notes,
    slot,
    valid: raceMatch,
    facts: {
      race: pdata.race, hero: fh, heroLevel: heroLvl,
      t2: t2Time, t3: t3Time, lengthMs: lenMs, maxTier: maxTierReached(pdata),
    },
  };
}

// Pick the player slot that best executes the build (race + hero + score).
// Returns { slot, result } for the best non-neutral player, or null.
function bestSlotForBuild (data, build) {
  let best = null;
  for (const slot of nonNeutralSlots(data)) {
    const r = scoreBuildMatch(data, build, slot);
    if (!best || r.score > best.result.score) best = { slot, result: r };
  }
  return best;
}

module.exports = {
  scoreBuildMatch,
  bestSlotForBuild,
  parseTimingWindow,
  WEIGHTS,
  // exposed for tests / reuse
  _internals: { firstHeroId, buildingFirstTimes, unitFirstTimes, tierTimeMs, gameLengthMs, peakHeroLevel },
};
