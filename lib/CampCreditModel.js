//
// CampCreditModel — the creep-camp "clearing work" model, in one place.
//
// A replay records no creep deaths, so when a camp died is ESTIMATED: players
// accrue clearing work while their fighters are at the camp, and the camp is
// cleared the moment cumulative work reaches what the camp needs. This module
// owns that estimate. lib/NeutralGroup.js calls it during the parse;
// tools/camp-clear-audit.js calls it with swept constants to tune it against
// ground truth. They share this file precisely so the harness can never grade
// a model that differs from the one that ships.
//
// Self-contained (no requires) so it stays cheap in the browser parser bundle,
// matching lib/SettlementClear.js.
//
// The input is one camp's `perPlayerEvents` — the normalized per-player
// interaction log NeutralGroup builds, where each event carries the acting
// player, the zone the actor stood in ('in-camp' | 'creep-pull' | 'out') and
// whether a hero/combat unit was involved.
//

//
// WHAT THE CONSTANTS MEAN
//
// The model measures work in milliseconds of "effective fighting time", and a
// camp needs PER_LEVEL_MS per point of total creep level. Two rules keep the
// estimate honest, both learned from measured failures:
//
//   1. Work never accrues faster than the clock. Nothing kills a camp faster
//      than real time, so a fight that lasted 20s can never do 29s of work.
//      Anything about heroes clearing faster belongs in PER_LEVEL_MS, not in a
//      time multiplier greater than 1.
//   2. Clicking is not killing. A right-click on a creep is evidence of a
//      fight, so it seeds a little work — but pros click constantly, and an
//      uncapped per-click bonus lets click-spam clear a camp in seconds. The
//      total click-derived contribution is therefore capped.
//
const DEFAULTS = {
  // Clearing work the camp needs, per creep level.
  //
  // NOT CALIBRATED, DELIBERATELY. tools/camp-clear-audit.js can grade WHEN a
  // camp cleared, because the replay proves creeps were alive at specific
  // moments. It cannot grade WHETHER a camp cleared, because nothing in the
  // replay distinguishes "poked the camp and left" from "killed the camp" —
  // there is no creep-death record and no item-pickup signal (measured: zero
  // interact-item events in the corpus). Every metric in the harness therefore
  // improves monotonically as this value falls, all the way down to absurd
  // values that clear a camp the instant anyone hits it. That is the metric
  // running out of information, not evidence for a low value.
  //
  // So this is pinned to the effective requirement that shipped before this
  // pass — the old model used 2400/level against work inflated by a 1.20 hero
  // factor, i.e. 2000/level of real work — which keeps every behaviour change
  // in this pass attributable to the structural fixes below, each of which the
  // harness CAN measure. Move it only with ground truth (creep deaths from a
  // 1:1 re-sim, or hero XP/level-up timing), never on the audit's error alone.
  PER_LEVEL_MS:          2000,
  FOUNTAIN_FACTOR:       1.75, // fountain-of-health camps take longer

  PULL_TIME_WEIGHT:      0.65, // creep-pull time counts at 65% of in-camp time
  INTERACTION_BOOST_MS:  650,  // each direct creep interaction seeds this work
  INTERACTION_BOOST_CAP: 0.25, // ...but clicks may supply at most this fraction
                               //    of a camp's requirement (rule 2 above)
  REQUIRE_IN_ZONE_BOOST: true, // only clicks issued from at/near the camp seed
                               //    work — you can legally order an attack from
                               //    across the map, but you are not fighting yet

  // Presence is not clearing. Standing near a camp — even with a hero, even for
  // minutes — kills nothing; the only evidence in the replay that a team is
  // actually FIGHTING a camp is that it clicked the camp's creeps. Time-derived
  // work therefore counts only while a creep click by that team is within this
  // window. Without it, camps were "cleared" by armies that merely walked past
  // repeatedly, minutes after the last shot was fired at them.
  INTERACTION_WINDOW_MS: 20000,

  MAX_SEGMENT_GAP_MS:    12000, // gap between a player's events that still counts
                                //    as continuous presence
  MAX_CREDIT_PER_EVENT_MS: 10000, // and the most one gap may credit

  // Enemy teams do not clear a camp together. When two armies collide at a
  // camp, each is mostly fighting the other; pooling their time into one
  // completion bar cleared contested camps at roughly twice the true rate.
  // Work is accumulated per TEAM (allies share) and the camp is cleared by the
  // first team whose own work completes it.
  PER_TEAM_POOLS:        true,

  // PROOF OF LIFE. A right-click only resolves to a live neutral, so a creep
  // click is proof that creep was alive at that moment. The work estimate is an
  // estimate; this is a fact, and a fact outranks an estimate. The clear is
  // therefore never reported earlier than the last click a hero/combat unit
  // landed on the camp from within the leash.
  //
  // Restricted to in-zone fighters on purpose: an attack ordered from across
  // the map is a legal order that resolves to a live creep but is not a fight,
  // and out-of-zone clicks are also where mis-resolved targets concentrate.
  //
  // This was the user-visible bug — camps going empty while the fight was still
  // on screen. It is not a tuning constant and should not be turned off.
  CLAMP_TO_PROOF_OF_LIFE: true,

  // Fallback when the requirement estimate runs high: heroes fought here, did
  // most of the work, and left. The last SUBSTANTIAL engagement is then the
  // clear. A brief walk-through is not substantial, so it cannot push it later.
  ENGAGEMENT_GAP_MS:     20000, // gap that splits one engagement from the next
  SUBSTANTIAL_FRACTION:  0.10,  // an engagement doing >=10% of the requirement
  MIN_CLEAR_FRACTION:    0.50   // total substantial work >=50% => it was cleared
};

const cfgOf = (overrides) => Object.assign({}, DEFAULTS, overrides || {});

//
// Clearing work a camp requires, in ms of effective fighting time.
//
const requiredMsFor = (camp, overrides) => {
  const cfg = cfgOf(overrides);
  return cfg.PER_LEVEL_MS * (camp.totalLevel || 1) *
    (camp.hasFountain ? cfg.FOUNTAIN_FACTOR : 1);
};

//
// One player's chronological clearing-work chunks. Each chunk is the
// incremental work between two consecutive events, timestamped at its end
// event so chunks from all players can be merged and gated by the camp's
// shared completion state.
//
// `boostMs` is tracked separately from time-derived work so the caller can cap
// the click-derived share (rule 2) without re-deriving it.
//
const workChunks = (events, overrides) => {
  const cfg = cfgOf(overrides);
  const chunks = [];

  // Times this player actually engaged the camp's creeps. Time-derived work is
  // only credited near one of these — see INTERACTION_WINDOW_MS.
  const clickTimes = [];
  for (const e of events) {
    if (e.stage !== 'interact-creep') continue;
    if (cfg.REQUIRE_IN_ZONE_BOOST && e.zone === 'out') continue;
    clickTimes.push(e.gameTime);
  }
  const nearAClick = (t) => {
    if (!(cfg.INTERACTION_WINDOW_MS > 0)) return true;
    for (let k = 0; k < clickTimes.length; k++) {
      if (Math.abs(clickTimes[k] - t) <= cfg.INTERACTION_WINDOW_MS) return true;
    }
    return false;
  };

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    let zoneWork = 0;
    let heroActive = !!(e.hasHero || e.hasCombatUnit);

    if (i > 0) {
      const prev = events[i - 1];
      const dt = e.gameTime - prev.gameTime;
      if (prev.zone !== 'out' && dt > 0 && dt <= cfg.MAX_SEGMENT_GAP_MS &&
          nearAClick(prev.gameTime)) {
        const capped = Math.min(dt, cfg.MAX_CREDIT_PER_EVENT_MS);
        if (prev.zone === 'in-camp') zoneWork = capped;
        else if (prev.zone === 'creep-pull') zoneWork = capped * cfg.PULL_TIME_WEIGHT;
      }
      if (prev.hasHero || prev.hasCombatUnit) heroActive = true;
    }

    // A creep click seeds work only when the clicker was actually at the camp.
    // Ordering an attack from across the map is a legal order and resolves to a
    // live creep, but no fighting has happened yet.
    const boostEligible = (e.stage === 'interact-creep') &&
      (!cfg.REQUIRE_IN_ZONE_BOOST || e.zone !== 'out');
    const boostMs = boostEligible ? cfg.INTERACTION_BOOST_MS : 0;

    // Only heroes / combat units clear camps. A worker scouting or
    // right-clicking a creep does NO clearing work — without this gate its
    // mere presence would fill the camp bar and set a wrong clear time.
    const effectiveMs = zoneWork + boostMs;
    if (effectiveMs > 0 && heroActive) {
      chunks.push({
        gameTime: e.gameTime,
        playerId: e.playerId,
        teamId: (e.teamId != null ? e.teamId : null),
        effectiveMs,
        boostMs
      });
    }
  }

  return chunks;
};

//
// Every player's chunks for one camp, merged chronologically, with the
// click-derived share capped (rule 2). The cap is applied per team so one
// team's click-spam cannot be lent to another.
//
const mergedChunks = (perPlayerEvents, requiredMs, overrides) => {
  const cfg = cfgOf(overrides);

  const byPlayer = {};
  (perPlayerEvents || []).forEach(e => {
    (byPlayer[e.playerId] = byPlayer[e.playerId] || []).push(e);
  });

  const chunks = [];
  Object.keys(byPlayer).forEach(pid => {
    const evs = byPlayer[pid].slice().sort((a, b) => a.gameTime - b.gameTime);
    workChunks(evs, cfg).forEach(c => chunks.push(c));
  });
  chunks.sort((a, b) => a.gameTime - b.gameTime);

  // cap click-derived work per team
  const boostBudget = requiredMs * cfg.INTERACTION_BOOST_CAP;
  const spent = {};
  chunks.forEach(c => {
    if (!(c.boostMs > 0)) return;
    const key = String(c.teamId);
    const used = spent[key] || 0;
    const allowed = Math.max(0, Math.min(c.boostMs, boostBudget - used));
    if (allowed < c.boostMs) {
      c.effectiveMs -= (c.boostMs - allowed);
      c.boostMs = allowed;
    }
    spent[key] = used + allowed;
  });

  return chunks.filter(c => c.effectiveMs > 0);
};

//
// Estimate when a camp was cleared.
//
//  (1) cumulative clearing work reaches the requirement — per team when
//      PER_TEAM_POOLS is on, so enemies meeting at a camp do not co-clear it; OR
//  (2) the last SUBSTANTIAL engagement ends, once enough substantial work was
//      done overall (our requirement estimate ran high — the heroes fought it
//      and moved on).
//
// Returns { clearedTime, requiredMs, chunks } — chunks are the merged, capped
// work chunks so the caller can attribute contribution without redoing it.
//
const estimateClear = (camp, overrides) => {
  const cfg = cfgOf(overrides);
  const requiredMs = requiredMsFor(camp, cfg);
  const chunks = mergedChunks(camp.perPlayerEvents, requiredMs, cfg);

  const result = { clearedTime: null, requiredMs, chunks };

  // Last moment a creep of this camp was PROVEN alive (see CLAMP_TO_PROOF_OF_LIFE).
  let proofOfLife = null;
  if (cfg.CLAMP_TO_PROOF_OF_LIFE) {
    (camp.perPlayerEvents || []).forEach(e => {
      if (e.stage !== 'interact-creep') return;
      if (e.zone === 'out') return;
      if (!(e.hasHero || e.hasCombatUnit)) return;
      if (proofOfLife == null || e.gameTime > proofOfLife) proofOfLife = e.gameTime;
    });
  }
  const applyProof = (t) => (proofOfLife != null && t != null && t < proofOfLife)
    ? proofOfLife : t;

  if (!chunks.length) return result;

  // (1) cumulative work completes the camp
  const running = {};
  for (let i = 0; i < chunks.length; i++) {
    const key = cfg.PER_TEAM_POOLS ? String(chunks[i].teamId) : 'all';
    running[key] = (running[key] || 0) + chunks[i].effectiveMs;
    if (running[key] >= requiredMs) {
      result.clearedTime = applyProof(chunks[i].gameTime);
      return result;
    }
  }

  // (2) the last substantial engagement
  const engagements = [];
  let cur = null;
  chunks.forEach(c => {
    if (cur && (c.gameTime - cur.endT) <= cfg.ENGAGEMENT_GAP_MS) {
      cur.endT = c.gameTime;
      cur.work += c.effectiveMs;
    } else {
      cur = { startT: c.gameTime, endT: c.gameTime, work: c.effectiveMs };
      engagements.push(cur);
    }
  });

  const substantial = engagements.filter(e => e.work >= requiredMs * cfg.SUBSTANTIAL_FRACTION);
  const totalSub = substantial.reduce((s, e) => s + e.work, 0);
  if (substantial.length && totalSub >= requiredMs * cfg.MIN_CLEAR_FRACTION) {
    result.clearedTime = applyProof(substantial[substantial.length - 1].endT);
  }

  return result;
};

module.exports = { DEFAULTS, cfgOf, requiredMsFor, workChunks, mergedChunks, estimateClear };
