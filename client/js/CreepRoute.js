/**
 * CreepRoute.js — evidence-based "which camps did this hero actually creep, in
 * order, on the way to its level" — derived ONLY from parsed replay data.
 *
 * Replaces the old app.js inline logic that keyed off `playerCredit.measured.
 * windowStart` (the hero's FIRST poke / zone-entry). That was wrong: a hero can
 * clip a camp's zone for ~2s minutes before the camp is actually cleared, and
 * the tour would frame that walk-through instead of the real fight. Concrete
 * failure (1364826411, UD p2): camp "Murloc Flesheater" windowStart=2:36 but
 * clearedTime=11:56 with ONE in-camp hero hit — a 9-minute gap.
 *
 * The fix: a camp counts as "creeped by this hero" only when the followed
 * player's HERO has a DENSE RUN of in-camp creep interactions ending near the
 * camp's clearedTime. The seek anchor (`fightStartMs`) is the start of that run,
 * NOT windowStart — so the camera lands on the actual clearing fight.
 *
 * buildCreepRoute(neutralGroups, followedPlayerId, heroItemId, opts)
 *   neutralGroups : the .wc3v `world.neutralGroups` object (uuid -> camp)
 *   followedPlayerId : the player whose hero we're following
 *   heroItemId : that player's first hero itemId (e.g. 'Udea'); unused for the
 *     hit filter (hits already carry hasHero) but kept for future per-hero work
 *   opts = { reachedLevel, levelTimeMs }
 *     reachedLevel : the hero's actual peak level (number)
 *     levelTimeMs(level) -> ms | Infinity : when the hero first reached `level`
 *       (the caller owns the event stream; level logic stays in one place)
 *   -> { targetLevel, reachedLevel, camps: [{ uuid, wx, wy, rWorld,
 *         fightStartMs, clearMs, label, levelStr, iconId, boundsRect,
 *         heroHits, confidence }] }
 *
 * Returns camps:[] (the caller falls back to "follow the hero") when the hero
 * barely creeped. UMD: window.CreepRoute in the browser, module.exports in node.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.CreepRoute = mod;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  // Tuned against the corpus (see plan): good clears had 5-7 in-camp hero hits
  // in a tight window ending at the clear; walk-through pokes had 0-1 with a
  // multi-minute gap to the clear. Frozen so the validator imports the same
  // numbers it asserts against (no drift between viewer and test).
  const THRESHOLDS = Object.freeze({
    MIN_INCAMP_HERO_HITS: 3,      // a real clear, not a poke
    HIT_RUN_WINDOW_MS: 25000,     // the dense fight cluster spans at most this
    CLEAR_PROXIMITY_MS: 20000,    // the hero's last clearing hit must be this close to clearedTime
    POST_CLEAR_TOL_MS: 5000,      // ignore hits more than this past clearedTime (later revisits)
    MIN_CONFIDENCE: 0.60,         // per-player credit confidence floor
    MAX_CAMPS: 12
  });

  // Hero creep interactions for `pid` at this camp, sorted ascending by
  // gameTime. Ground-truth "the hero swung at this camp's creeps" — both
  // 'in-camp' (melee, fighting from inside) and 'creep-pull' (ranged heroes
  // like Archmage / Priestess attack from the leash edge, never standing
  // inside). NOT mere presence/zone-entry — only stage 'interact-creep'.
  function heroCreepHits (group, pid) {
    const evs = (group && Array.isArray(group.perPlayerEvents)) ? group.perPlayerEvents : [];
    const key = String(pid);
    const out = [];
    for (const e of evs) {
      if (!e) continue;
      if (String(e.playerId) !== key) continue;
      if (e.stage !== 'interact-creep') continue;
      if (!e.hasHero) continue;
      if (e.zone !== 'in-camp' && e.zone !== 'creep-pull') continue;
      out.push(Number(e.gameTime) || 0);
    }
    out.sort((a, b) => a - b);
    return out;
  }

  // The dense run of clearing hits ending at/near the clear, or null. Only hits
  // up to clearedTime (+ a small overkill tolerance) count — interactions
  // minutes AFTER the clear are a later revisit of the same spot, not this
  // clear (the bug: a hero re-fought near a long-cleared camp's location).
  // Take the trailing cluster (within HIT_RUN_WINDOW_MS of the last clearing
  // hit) and require that last hit within CLEAR_PROXIMITY_MS of clearedTime.
  // Rejects the lone-early-poke pattern AND the post-clear-revisit pattern.
  function denseRunNearClear (hits, clearMs) {
    if (!hits.length || clearMs == null) return null;
    const upto = hits.filter(t => t <= clearMs + THRESHOLDS.POST_CLEAR_TOL_MS);
    if (!upto.length) return null;
    const last = upto[upto.length - 1];
    // hero stopped interacting well before the camp died → not the hero's clear
    if (clearMs - last > THRESHOLDS.CLEAR_PROXIMITY_MS) return null;
    const runStartFloor = last - THRESHOLDS.HIT_RUN_WINDOW_MS;
    const run = upto.filter(t => t >= runStartFloor && t <= last);
    if (run.length < THRESHOLDS.MIN_INCAMP_HERO_HITS) return null;
    return { count: run.length, startMs: run[0], endMs: last };
  }

  // Same geometry/label/icon the viewer used before (app.js ~1840-1851) so the
  // ring and chip render identically.
  function campGeometry (g) {
    const b = g.bounds;
    const wx = (b.minX + b.maxX) / 2, wy = (b.minY + b.maxY) / 2;
    const rWorld = Math.max(220, Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2 + 130);
    const big = (Array.isArray(g.units) && g.units[0] && g.units[0].displayName) || null;
    const label = big ? (big.charAt(0).toUpperCase() + big.slice(1) + ' camp') : 'Creep camp';
    const iconId = (Array.isArray(g.units) && g.units[0] && typeof g.units[0].itemId === 'string') ? g.units[0].itemId : null;
    return {
      wx, wy, rWorld, label, iconId,
      levelStr: g.totalLevel ? ('lvl ' + g.totalLevel) : '',
      boundsRect: { minX: wx - rWorld, maxX: wx + rWorld, minY: wy - rWorld, maxY: wy + rWorld }
    };
  }

  function buildCreepRoute (neutralGroups, followedPlayerId, heroItemId, opts) {
    opts = opts || {};
    const reachedLevel = Math.max(0, Number(opts.reachedLevel) || 0);
    const levelTimeMs = (typeof opts.levelTimeMs === 'function') ? opts.levelTimeMs : (() => Infinity);
    const empty = { targetLevel: null, reachedLevel, camps: [] };
    if (!neutralGroups || followedPlayerId == null) return empty;

    // "to level N": cap at 3 (the classic spike) but never claim past the peak
    // the hero actually reached. The gate time is when the hero hit that level.
    const targetLevel = Math.min(3, reachedLevel);
    if (targetLevel < 1) return empty;
    const gateMs = levelTimeMs(targetLevel);   // finite (the hero reached targetLevel)

    const camps = [];
    for (const k of Object.keys(neutralGroups)) {
      const g = neutralGroups[k];
      if (!g || !g.bounds) continue;
      if (g.clearedTime == null) continue;                       // never fully cleared
      const pc = g.playerCredit && g.playerCredit[String(followedPlayerId)];
      if (!pc || !pc.credited) continue;                         // credit model: this player cleared it, hero present
      if (Number(pc.confidence) < THRESHOLDS.MIN_CONFIDENCE) continue;

      const hits = heroCreepHits(g, followedPlayerId);
      if (hits.length < THRESHOLDS.MIN_INCAMP_HERO_HITS) continue;
      const run = denseRunNearClear(hits, Number(g.clearedTime));
      if (!run) continue;                                        // lone poke / walk-through — excluded

      const clearMs = Math.round(Number(g.clearedTime));
      if (gateMs !== Infinity && clearMs > gateMs) continue;     // cleared after the hero was already at targetLevel

      const geo = campGeometry(g);
      camps.push({
        uuid: g.uuid || k,
        wx: geo.wx, wy: geo.wy, rWorld: geo.rWorld,
        fightStartMs: Math.max(0, Math.round(run.startMs)),
        clearMs: Math.max(0, Math.max(clearMs, Math.round(run.startMs) + 1000)),
        label: geo.label, levelStr: geo.levelStr, iconId: geo.iconId,
        boundsRect: geo.boundsRect,
        heroHits: run.count,
        confidence: Number(pc.confidence) || 0
      });
    }

    // Order by the actual fight time so the tour moves forward through the game.
    camps.sort((a, b) => a.fightStartMs - b.fightStartMs);
    if (camps.length > THRESHOLDS.MAX_CAMPS) camps.length = THRESHOLDS.MAX_CAMPS;
    if (!camps.length) return empty;
    return { targetLevel, reachedLevel, camps };
  }

  return { buildCreepRoute, heroCreepHits, denseRunNearClear, THRESHOLDS };
});
