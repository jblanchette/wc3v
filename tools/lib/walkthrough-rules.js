/**
 * walkthrough-rules.js — shared, pure rule engine that validates a guided
 * walkthrough against REPLAY-ONLY evidence. Consumed by both the iterator tool
 * (tools/validate-walkthrough.js) and the hard test gate
 * (tests/walkthrough-evidence.test.js) so the rules live in exactly one place.
 *
 * Every rule answers "does this walkthrough claim actually exist in the replay
 * data?" — no heuristics about what SHOULD have happened, only what did.
 */
'use strict';

const fs = require('fs');
const os = require('os');   // eslint-disable-line no-unused-vars
const path = require('path');
const zlib = require('zlib');

// ReplayGuide reads window.PlayerNames / HeroAbilityStats when present; expose
// them as globals (same trick as tools/preview-guide.js) before requiring it.
global.PlayerNames = global.PlayerNames || require('../../client/js/PlayerNames.js');
global.HeroAbilityStats = global.HeroAbilityStats || require('../../client/js/HeroAbilityStats.js');
const ReplayGuide = require('../../client/js/ReplayGuide.js');
const CreepRoute = require('../../client/js/CreepRoute.js');

const REPLAYS_DIR = path.join(__dirname, '..', '..', 'client', 'replays');
const MANIFEST_PATH = path.join(__dirname, '..', '..', 'client', 'data', 'builds-manifest.json');
const T = CreepRoute.THRESHOLDS;

// ── Loading ──────────────────────────────────────────────────────────────
function loadReplay (idOrPath) {
  const cands = [
    path.join(REPLAYS_DIR, idOrPath + '.wc3v'),
    path.join(REPLAYS_DIR, idOrPath + '.wc3v.gz'),
    path.resolve(idOrPath)
  ];
  const file = cands.find(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
  if (!file) return null;
  let buf = fs.readFileSync(file);
  if (file.endsWith('.gz')) buf = zlib.gunzipSync(buf);
  return JSON.parse(buf.toString('utf8'));
}

// Every NEW-PLAYER target: {buildId, replayId, playerSlot} for builds tagged
// level:"new" in the manifest (deduped by replayId+slot).
function newPlayerTargets () {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const out = [];
  const seen = new Set();
  for (const b of (manifest.builds || [])) {
    if (b.level !== 'new') continue;
    for (const r of (b.replays || [])) {
      if (!r || !r.replayId) continue;
      const key = r.replayId + '#' + r.playerSlot;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ buildId: b.id, replayId: r.replayId, playerSlot: String(r.playerSlot) });
    }
  }
  return out;
}

// ── Replay helpers ─────────────────────────────────────────────────────────
function nameMap (raw) {
  const m = {};
  const recs = (raw.replay && raw.replay.metadata && raw.replay.metadata.playerRecords) || [];
  for (const r of recs) if (r && r.playerId != null) m[String(r.playerId)] = r.playerName || ('Player ' + r.playerId);
  return m;
}

function asGuidePlayer (id, p, nameById) {
  return { name: nameById[id] || ('Player ' + id), race: p.race, eventStream: p.eventStream, buildingAttempts: p.buildingAttempts };
}

// Non-neutral players keyed by id-string, in id order.
function realPlayers (raw) {
  return Object.entries(raw.players || {})
    .filter(([id, p]) => p && !p.isNeutralPlayer && Array.isArray(p.eventStream) && p.eventStream.length);
}

function firstHeroId (stream) {
  const h = (stream || []).filter(e => e && e.key === 'addUnit' && e.unit && e.unit.isHero)
    .sort((a, b) => a.gameTime - b.gameTime)[0];
  return h ? h.unit.itemId : null;
}

// { reachedLevel, levelTimeMs(level) } for a hero, from its HeroLevel events.
function heroLevelTimeFns (stream, heroItemId) {
  const lv = (stream || []).filter(e => e && e.key === 'HeroLevel' && e.unit && (heroItemId == null || e.unit.itemId === heroItemId))
    .map(e => ({ t: e.gameTime, n: Number(e.newLevel != null ? e.newLevel : e.level) || 0 }));
  const reachedLevel = lv.reduce((mx, e) => Math.max(mx, e.n), 0);
  const levelTimeMs = (level) => {
    let best = Infinity;
    for (const e of lv) if (e.n >= level && e.t < best) best = e.t;
    return best;
  };
  return { reachedLevel, levelTimeMs };
}

// All gameTimes for a given eventStream key (sorted).
function eventTimesByKey (stream, keyPred) {
  return (stream || []).filter(e => e && keyPred(e)).map(e => Number(e.gameTime) || 0).sort((a, b) => a - b);
}
function anyWithin (times, t, tol) { return times.some(x => Math.abs(x - t) <= tol); }

// ── The rule set ─────────────────────────────────────────────────────────
// Each rule: { name, pass, why }. `why` is human-readable (failure reason or a
// short confirmation). All evidence is re-derived from `raw` independently of
// CreepRoute's own output where possible (cross-check, not circular trust).
function runRules (raw, followId, oppId, guide, route, fns, heroId) {
  const fStream = raw.players[followId].eventStream;
  const ng = (raw.world && raw.world.neutralGroups) || {};
  const rules = [];
  const add = (name, pass, why) => rules.push({ name, pass: !!pass, why: why || '' });
  const fmt = (ms) => ms == null || ms === Infinity ? '--' : Math.floor(ms / 60000) + ':' + String(Math.round(ms / 1000) % 60).padStart(2, '0');

  const heroStep = guide.steps.find(s => s.key === 'hero') || null;
  const targetLevel = route.targetLevel;

  // R1 — every route camp has independent in-camp hero-hit evidence + a dense
  // run ending near the clear + is credited. Re-derived from perPlayerEvents.
  {
    let bad = null;
    for (const c of route.camps) {
      const g = ng[c.uuid];
      if (!g) { bad = `${c.label}: camp uuid not found in neutralGroups`; break; }
      const pc = g.playerCredit && g.playerCredit[followId];
      if (!pc || !pc.credited) { bad = `${c.label}: not credited`; break; }
      const hits = CreepRoute.heroCreepHits(g, followId);
      if (hits.length < T.MIN_INCAMP_HERO_HITS) { bad = `${c.label}: only ${hits.length} in-camp hero hits (<${T.MIN_INCAMP_HERO_HITS})`; break; }
      const run = CreepRoute.denseRunNearClear(hits, Number(g.clearedTime));
      if (!run) { bad = `${c.label}: no dense hero-hit run near clearedTime ${fmt(g.clearedTime)}`; break; }
    }
    add('R1 route-camp-evidence', !bad, bad || `${route.camps.length} camp(s), each with a real in-camp hero clear`);
  }

  // R2 — every route camp cleared at/before the hero reached targetLevel.
  {
    const gate = targetLevel ? fns.levelTimeMs(targetLevel) : Infinity;
    const bad = route.camps.find(c => gate !== Infinity && c.clearMs > gate);
    add('R2 level-gating', !bad, bad ? `${bad.label} cleared ${fmt(bad.clearMs)} after L${targetLevel} @ ${fmt(gate)}` : `all camps cleared by L${targetLevel} @ ${fmt(gate)}`);
  }

  // R3 — the creep step's claim is backed by replay evidence: it never claims a
  // level the hero didn't reach, AND the evidence route is non-empty and reaches
  // the claimed level. An empty route under a "creep to level N" step means the
  // hero leveled WITHOUT credited camp clears — not a creep-route story (and, for
  // a new-player template, a re-pick signal).
  {
    const claimsL3 = !!(heroStep && /level 3/i.test(heroStep.title + ' ' + heroStep.action));
    let pass = true, why = 'no hero step';
    if (heroStep) {
      if (claimsL3 && fns.reachedLevel < 3) { pass = false; why = `claims level 3 but hero only reached L${fns.reachedLevel}`; }
      else if (route.camps.length === 0) { pass = false; why = 'creep step present but evidence route is empty (no credited camp clears)'; }
      else if (heroStep.targetLevel !== targetLevel) { pass = false; why = `step targetLevel ${heroStep.targetLevel} != evidence route ${targetLevel}`; }
      else { why = `route reaches L${targetLevel} with ${route.camps.length} camp(s); hero reached L${fns.reachedLevel}`; }
    }
    add('R3 creep-claim-backed', pass, why);
  }

  // R4 — no route camp matches the lone-poke pattern (credited but no real
  // hero clear). This is the direct guard against the Murloc-2:36 failure.
  {
    let bad = null;
    for (const c of route.camps) {
      const g = ng[c.uuid];
      const hits = g ? CreepRoute.heroCreepHits(g, followId) : [];
      const firstHit = hits.length ? hits[0] : null;
      const gap = (firstHit != null && g && g.clearedTime != null) ? (g.clearedTime - firstHit) : 0;
      if (hits.length < T.MIN_INCAMP_HERO_HITS) { bad = `${c.label}: ${hits.length} hits`; break; }
      if (gap > T.MAX_POKE_TO_CLEAR_GAP_MS && !CreepRoute.denseRunNearClear(hits, Number(g.clearedTime))) {
        bad = `${c.label}: ${fmt(gap)} poke→clear gap with no dense run`; break;
      }
    }
    add('R4 no-lone-poke', !bad, bad || 'no walk-through/poke camps in the route');
  }

  // R5 — the seek anchor is the real fight time (inside the dense run), not an
  // early windowStart far before it.
  {
    let bad = null;
    for (const c of route.camps) {
      const g = ng[c.uuid];
      const hits = g ? CreepRoute.heroCreepHits(g, followId) : [];
      const run = g ? CreepRoute.denseRunNearClear(hits, Number(g.clearedTime)) : null;
      if (!run) { bad = `${c.label}: no run`; break; }
      if (c.fightStartMs < run.startMs - 1 || c.fightStartMs > run.endMs + 1) {
        bad = `${c.label}: fightStart ${fmt(c.fightStartMs)} outside run [${fmt(run.startMs)}..${fmt(run.endMs)}]`; break;
      }
    }
    add('R5 seek-is-fight-time', !bad, bad || 'every camp seeks to its real fight window');
  }

  // R6 — steps that name a specific replay event have that event present.
  {
    const tierTimes = (tier) => eventTimesByKey(fStream, e => e.key === 'tierUpgrade' && e.building && Number(e.building.tierTarget) === tier);
    const researchTimes = eventTimesByKey(fStream, e => e.key === 'research');
    const expTimes = eventTimesByKey(fStream, e => e.key === 'addBuilding' && e.isExpansion === true);
    const itemTimes = eventTimesByKey(fStream, e => e.key === 'itemPurchase' || e.key === 'pickupItem');
    const tpTimes = eventTimesByKey(fStream, e => e.key === 'teleport');
    const checks = [];
    for (const s of guide.steps) {
      const t = s.gameTimeMs;
      if (s.key === 'tier2') checks.push(['tier2', anyWithin(tierTimes(2), t, 1500)]);
      else if (s.key === 'tier3') checks.push(['tier3', anyWithin(tierTimes(3), t, 1500)]);
      else if (s.key === 'upgrade') checks.push(['upgrade', anyWithin(researchTimes, t, 1500)]);
      else if (s.key === 'expansion') checks.push(['expansion', anyWithin(expTimes, t, 1500)]);
      else if (s.key === 'heroItems') checks.push(['heroItems', anyWithin(itemTimes, t, 2000) || (s.list && s.list.length > 0)]);
      else if (s.key === 'teleport') checks.push(['teleport', anyWithin(tpTimes, t, 2000)]);
    }
    const bad = checks.find(c => !c[1]);
    add('R6 step-times-real', !bad, bad ? `${bad[0]} step time has no matching replay event` : `${checks.length} event-bound step(s) verified`);
  }

  // R7 — a decisive-fight step references a real battle with BOTH players.
  {
    const battleStep = guide.steps.find(s => s.key === 'battle');
    if (!battleStep) { add('R7 decisive-fight-real', true, 'no battle step (ok)'); }
    else {
      const battles = Array.isArray(raw.battles) ? raw.battles : [];
      const match = battles.find(b => Math.abs((b.startTime || 0) - battleStep.gameTimeMs) <= 1500
        && (b.participants || []).some(p => String(p.playerId) === String(followId))
        && (b.participants || []).some(p => String(p.playerId) === String(oppId)));
      add('R7 decisive-fight-real', !!match, match ? `battle @ ${fmt(battleStep.gameTimeMs)} has both players` : `no battle at ${fmt(battleStep.gameTimeMs)} involving both players`);
    }
  }

  return rules;
}

// Build the guide + route for a replay/player and run all rules.
// followId defaults to playerSlot; oppId = the other non-neutral player.
function evaluate (raw, followId, oppId) {
  const players = realPlayers(raw);
  if (players.length < 2) return { error: 'need 2 non-neutral players', rules: [] };
  followId = String(followId != null ? followId : players[0][0]);
  if (oppId == null) { const o = players.find(([id]) => id !== followId); oppId = o ? o[0] : null; }
  oppId = oppId == null ? null : String(oppId);

  const nameById = nameMap(raw);
  const fp = raw.players[followId], op = oppId != null ? raw.players[oppId] : null;
  if (!fp) return { error: `no player ${followId}`, rules: [] };

  const followed = asGuidePlayer(followId, fp, nameById);
  const opp = op ? asGuidePlayer(oppId, op, nameById) : null;
  const guide = ReplayGuide.buildGuide(followed, opp, { battles: raw.battles, followedId: followId, oppId });

  const heroId = firstHeroId(fp.eventStream);
  const fns = heroLevelTimeFns(fp.eventStream, heroId);
  const route = CreepRoute.buildCreepRoute((raw.world && raw.world.neutralGroups) || {}, followId, heroId, fns);

  const rules = runRules(raw, followId, oppId, guide, route, fns, heroId);
  return { followId, oppId, heroId, reachedLevel: fns.reachedLevel, targetLevel: route.targetLevel, guide, route, rules };
}

// Total game length (ms) = latest event across all players.
function gameLengthMs (raw) {
  let t = 0;
  for (const pid of Object.keys(raw.players || {})) {
    const p = raw.players[pid];
    if (!p || !Array.isArray(p.eventStream)) continue;
    for (const e of p.eventStream) if (e && typeof e.gameTime === 'number' && e.gameTime > t) t = e.gameTime;
  }
  return t;
}

// STRICT beginner-template gate (the user's "do not allow replays that don't
// meet strict criteria"). Replay-only evidence; returns { pass, reasons[],
// score, ... }. Universal criteria for all races, plus race-specific behavior
// add-ons (UD: Ghouls mine lumber, never fight). A replay passes ONLY if
// reasons is empty.
function strictBeginnerGate (raw, followId) {
  const reasons = [];
  const ev = evaluate(raw, followId, null);
  if (ev.error) return { pass: false, reasons: [ev.error], score: -1 };

  // 1. Walkthrough must be honest/evidence-backed (all rules pass).
  for (const r of ev.rules) if (!r.pass) reasons.push(`FAIL ${r.name}: ${r.why}`);

  // 2. The lesson must actually happen: the hero creeps to level 3 with >= 2
  //    credited camp clears (evidence route).
  if (ev.route.targetLevel !== 3) reasons.push(`hero route not to level 3 (targetLevel ${ev.route.targetLevel}, reached L${ev.reachedLevel})`);
  if (ev.route.camps.length < 2) reasons.push(`only ${ev.route.camps.length} evidence creep camp(s) (<2)`);

  // 3. Watchable, non-cheese length.
  const lenMin = gameLengthMs(raw) / 60000;
  if (lenMin < 8 || lenMin > 22) reasons.push(`game length ${lenMin.toFixed(1)}min (want 8-22)`);

  // 4. Race-specific behavior. UD: Ghouls on lumber, no Ghoul deaths in early
  //    PvP fights (a beginner can't micro Ghouls in a fight).
  const p = raw.players[followId];
  if (p && p.race === 'U') {
    let lumber6 = 0;
    for (const e of (p.eventStream || [])) {
      const g = e && e.workers && Number(e.workers.ghoulsOnLumber);
      if (g >= 0 && e.gameTime <= 360000 && g > lumber6) lumber6 = g;
    }
    if (lumber6 < 3) reasons.push(`only ${lumber6} Ghouls on lumber by 6:00 (<3)`);
    let ghoulEarly = 0;
    for (const b of (raw.battles || [])) {
      const s = b.summary;
      if (!s || !s.perPlayer || b.creepJack || b.campUuid) continue;
      if ((b.startTime || 0) >= 420000) continue;
      const pp = s.perPlayer[followId] || s.perPlayer[Number(followId)];
      if (!pp) continue;
      for (const bk of ['definite', 'estimated']) for (const u of ((pp[bk] && pp[bk].units) || [])) if (u.itemId === 'ugho') ghoulEarly += u.count || 0;
    }
    if (ghoulEarly > 0) reasons.push(`${ghoulEarly} Ghoul(s) died in early PvP fights`);
  }

  const pass = reasons.length === 0;
  const score = (pass ? 100 : 0) + ev.route.camps.length * 5;   // rank passers by creep depth
  return { pass, reasons, score, route: ev.route, reachedLevel: ev.reachedLevel, lengthMin: Math.round(lenMin), guide: ev.guide };
}

module.exports = {
  loadReplay, newPlayerTargets, asGuidePlayer, realPlayers,
  firstHeroId, heroLevelTimeFns, evaluate, runRules, gameLengthMs, strictBeginnerGate, THRESHOLDS: T
};
