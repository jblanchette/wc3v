/*
 * actionLocality — for a teleport claim, scan player actions issued
 * AFTER the alleged cast-apply and compute whether their targets
 * cluster nearer origin or destination.
 *
 * Look-ahead window is not a fixed timer — it extends until the hero's
 * next "anchor" event (next stwp cast, hero death, item slot reset, or
 * replay end). Within that window we collect explicit X/Y targets from
 * the player's actions and compute the centroid weighted by how soon
 * each action happened after apply (closer-in-time = higher weight).
 *
 * If centroid is within `DEST_RADIUS` of destination → support TP.
 * If centroid is within `ORIGIN_RADIUS` of origin    → refute  TP.
 * Otherwise → no evidence (ambiguous).
 *
 * The radii are intentionally generous (~1500u) since post-TP players
 * spread out from the destination, not stay glued to it.
 */

const DEST_RADIUS    = 1800;
const ORIGIN_RADIUS  = 1500;
const MIN_ACTIONS    = 2;          // need this many post-cast actions to score
const MAX_LOOKAHEAD_MS = 90000;    // hard cap (90s) so a hero that goes idle
                                   // doesn't sweep the whole replay

module.exports = {
  name:     'actionLocality',
  subjects: ['teleport'],
  phase:    'look-ahead',

  score (claim, ctx) {
    const payload = claim.payload || {};
    const player  = ctx.player;
    if (!player) return null;
    const cast = payload.gameTime;
    const origin = payload.origin;
    const dest = payload.destination;
    if (cast == null || !origin || !dest) return null;
    const channelMs = payload.channelMs || 0;
    const applyTime = cast + channelMs;

    // Collect post-apply actions with explicit targets. The PlayerActions
    // path attaches a `targetPosition` field on emitted itemUse,
    // spellCast, attackMove, etc. Plus the raw moveTrace (when enabled)
    // gives authoritative move targets.
    const targets = collectTargets(player, applyTime, applyTime + MAX_LOOKAHEAD_MS);
    if (targets.length < MIN_ACTIONS) return null;

    // Weight by recency: earlier-after-apply gets full weight, decaying
    // linearly to 0 at MAX_LOOKAHEAD_MS.
    let sumX = 0, sumY = 0, sumW = 0;
    for (const t of targets) {
      const dt = t.gameTime - applyTime;
      const w = Math.max(0, 1 - (dt / MAX_LOOKAHEAD_MS));
      sumX += t.x * w;
      sumY += t.y * w;
      sumW += w;
    }
    if (sumW <= 0) return null;
    const cx = sumX / sumW;
    const cy = sumY / sumW;

    const dOrigin = Math.hypot(cx - origin.x, cy - origin.y);
    const dDest   = Math.hypot(cx - dest.x,   cy - dest.y);

    // Decide which bucket dominates.
    if (dDest < DEST_RADIUS && dDest < dOrigin) {
      // Centroid clusters at destination — supports the TP.
      const closeness = 1 - (dDest / DEST_RADIUS);
      return {
        kind: 'observation',
        weight: +0.4 * Math.max(0.25, closeness),
        ref:    { gameTime: applyTime },
        detail: {
          rule: 'actionLocality',
          centroid: { x: cx, y: cy },
          dDest, dOrigin, samples: targets.length,
          verdict: 'cluster-at-destination'
        }
      };
    }
    if (dOrigin < ORIGIN_RADIUS && dOrigin < dDest) {
      const closeness = 1 - (dOrigin / ORIGIN_RADIUS);
      return {
        kind: 'contradiction',
        weight: -0.5 * Math.max(0.25, closeness),
        ref:    { gameTime: applyTime },
        detail: {
          rule: 'actionLocality',
          centroid: { x: cx, y: cy },
          dDest, dOrigin, samples: targets.length,
          verdict: 'cluster-at-origin'
        }
      };
    }

    // Ambiguous — emit a small, signed-by-which-is-closer hint so the
    // fixpoint doesn't ignore the centroid entirely.
    const closerToDest = dDest < dOrigin;
    return {
      kind: 'observation',
      weight: (closerToDest ? +0.1 : -0.1),
      ref: { gameTime: applyTime },
      detail: {
        rule: 'actionLocality',
        centroid: { x: cx, y: cy },
        dDest, dOrigin, samples: targets.length,
        verdict: closerToDest ? 'lean-destination' : 'lean-origin'
      }
    };
  }
};

// Gather targets in (windowStart, windowEnd] from event stream + moveTrace.
// Each entry is { gameTime, x, y, source }.
//
// CRITICAL: filter to events involving the casting unit. The player's
// army keeps issuing commands across the map regardless of where the
// hero is; using all-player events makes the centroid meaningless. The
// hero's own subsequent commands (and per-unit moveTrace) are the
// directly attributable signal.
function collectTargets (player, casterUuid, windowStart, windowEnd) {
  const out = [];
  if (player.eventStream) {
    for (const ev of player.eventStream) {
      if (ev.gameTime == null) continue;
      if (ev.gameTime <= windowStart) continue;
      if (ev.gameTime >  windowEnd)   break;
      // Only events explicitly attributed to the caster.
      const evUuid = ev.unit && ev.unit.uuid;
      if (casterUuid && evUuid && evUuid !== casterUuid) continue;
      // Skip events with no unit attribution (selection-stream noise).
      if (casterUuid && !evUuid) continue;
      const pos = extractTargetPos(ev);
      if (pos) out.push({ gameTime: ev.gameTime, x: pos.x, y: pos.y, source: ev.key });
    }
  }
  if (player.moveTrace && Array.isArray(player.moveTrace)) {
    for (const m of player.moveTrace) {
      if (m.gameTime == null) continue;
      if (m.gameTime <= windowStart) continue;
      if (m.gameTime >  windowEnd)   break;
      if (m.targetX == null || m.targetY == null) continue;
      // moveTrace entries carry unit uuids when --move-trace was enabled.
      // Without per-unit filtering we'd re-introduce the army-centroid bug.
      if (casterUuid && m.unitUuids && m.unitUuids.length &&
          !m.unitUuids.includes(casterUuid)) continue;
      out.push({ gameTime: m.gameTime, x: m.targetX, y: m.targetY, source: 'moveTrace' });
    }
  }
  return out;
}

function extractTargetPos (ev) {
  if (!ev) return null;
  // Common shapes the event stream emits.
  if (ev.targetPosition && ev.targetPosition.x != null) {
    return { x: ev.targetPosition.x, y: ev.targetPosition.y };
  }
  if (ev.target && ev.target.x != null && ev.target.y != null) {
    return { x: ev.target.x, y: ev.target.y };
  }
  if (ev.x != null && ev.y != null) {
    return { x: ev.x, y: ev.y };
  }
  // Spell casts: spell target unit position (if exported on the event).
  if (ev.targetUnit && ev.targetUnit.x != null) {
    return { x: ev.targetUnit.x, y: ev.targetUnit.y };
  }
  return null;
}
