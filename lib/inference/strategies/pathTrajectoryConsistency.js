/*
 * pathTrajectoryConsistency — looks at the caster's recent movement
 * pattern before the alleged TP and scores how consistent it is with
 * intentional teleport casting.
 *
 * Heuristics:
 *   - Hero freshly trained (< ~60s since spawn) and casting an
 *     auto-grant TP at minute 2: extremely unusual; weak refutation.
 *   - Hero in motion (path delta in last 5s > 200u) and away from
 *     opposing units: typical "kite to corner then TP" pattern;
 *     weak support.
 *   - Hero stationary and at home base: ambiguous; no evidence.
 *
 * This strategy intentionally produces only small-magnitude evidence
 * (|weight| ≤ 0.2). It's a corroborating signal, not the decider.
 */

const FRESH_HERO_AGE_MS = 60000;
const PRE_CAST_PATH_MS  = 5000;
const MIN_MOVE_DELTA    = 200;     // game-units of movement to count as "in motion"

module.exports = {
  name:     'pathTrajectoryConsistency',
  subjects: ['teleport'],
  phase:    'look-behind',

  score (claim, ctx) {
    const payload = claim.payload || {};
    const player  = ctx.player;
    if (!player) return null;
    const cast = payload.gameTime;
    if (cast == null) return null;

    const caster = findUnitByUuid(player, payload.casterUuid);
    if (!caster) return null;

    const evidence = [];

    // Heuristic 1: hero age. spawnedAt is set in Unit when the unit
    // becomes active. For freshly-trained heroes we have a recent
    // training-complete event we can use; fall back to first selection.
    const spawnedAt = caster.spawnedAt != null ? caster.spawnedAt
                    : caster.trainedAt != null ? caster.trainedAt
                    : null;
    if (spawnedAt != null) {
      const age = cast - spawnedAt;
      if (age >= 0 && age < FRESH_HERO_AGE_MS) {
        evidence.push({
          kind: 'observation',
          weight: -0.15,
          ref: { gameTime: spawnedAt },
          detail: {
            rule: 'pathTrajectoryConsistency',
            verdict: 'fresh-hero',
            ageMs: age
          }
        });
      }
    }

    // Heuristic 2: pre-cast path delta. Sample the caster's path within
    // [cast-PRE_CAST_PATH_MS, cast] and measure total displacement.
    if (Array.isArray(caster.path) && caster.path.length > 1) {
      let moved = 0;
      let prev = null;
      for (const p of caster.path) {
        if (p.gameTime == null) continue;
        if (p.gameTime < (cast - PRE_CAST_PATH_MS)) { prev = p; continue; }
        if (p.gameTime > cast) break;
        if (prev) {
          moved += Math.hypot((p.x || 0) - (prev.x || 0), (p.y || 0) - (prev.y || 0));
        }
        prev = p;
      }
      if (moved > MIN_MOVE_DELTA) {
        evidence.push({
          kind: 'observation',
          weight: +0.1,
          ref: { gameTime: cast - PRE_CAST_PATH_MS },
          detail: {
            rule: 'pathTrajectoryConsistency',
            verdict: 'in-motion-pre-cast',
            movedUnits: moved
          }
        });
      }
    }

    return evidence.length ? evidence : null;
  }
};

function findUnitByUuid (player, uuid) {
  if (!uuid || !player || !player.units) return null;
  for (const u of player.units) {
    if (u.uuid === uuid) return u;
  }
  return null;
}
