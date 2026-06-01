/*
 * crossPlayerSighting — if an opponent unit had line-of-sight on the
 * casting hero AT THE ORIGIN during the channel window, that's strong
 * refutation of a real TP. (For instant teleports — stel, blink — no
 * channel window exists; this strategy simply emits no evidence.)
 *
 * Window: strictly POST-APPLY (applyTime+500 to applyTime+5000). The
 * channel window itself is uninformative — the caster IS at origin
 * during channel (channeling), so opponent presence at origin during
 * channel doesn't refute TP. After apply, a real TP-er is gone; an
 * opponent unit still at origin observing isn't a strong refute by
 * itself, but combined with action-locality / event-correlation it
 * helps tip the score for phantom TPs that left the hero at origin.
 *
 * Doesn't fire for instant TPs (channelMs == 0).
 */

const SIGHT_RADIUS = 800;         // tighter: must be close enough to plausibly see

module.exports = {
  name:     'crossPlayerSighting',
  subjects: ['teleport'],
  phase:    'cross-player',

  score (claim, ctx) {
    const payload = claim.payload || {};
    const cast = payload.gameTime;
    const origin = payload.origin;
    const channelMs = payload.channelMs || 0;
    if (cast == null || !origin || channelMs <= 0) return null;
    const others = ctx.otherPlayers || [];
    if (!others.length) return null;

    const applyTime   = cast + channelMs;
    const windowStart = applyTime + 500;
    const windowEnd   = applyTime + 5000;

    for (const opp of others) {
      // Scan opponent units' paths.
      if (Array.isArray(opp.units)) {
        for (const u of opp.units) {
          if (!Array.isArray(u.path)) continue;
          for (const p of u.path) {
            if (p.gameTime == null) continue;
            if (p.gameTime < windowStart) continue;
            if (p.gameTime > windowEnd) break;
            const d = Math.hypot((p.x || 0) - origin.x, (p.y || 0) - origin.y);
            if (d <= SIGHT_RADIUS) {
              return {
                kind: 'contradiction',
                weight: -0.2,
                ref: { gameTime: p.gameTime },
                detail: {
                  rule: 'crossPlayerSighting',
                  opponentPlayer: opp.id,
                  unitItemId: u.itemId,
                  distance: d,
                  observedAt: { x: p.x, y: p.y },
                  note: 'opponent unit at origin position AFTER apply — caster may not have actually moved'
                }
              };
            }
          }
        }
      }
    }
    return null;
  }
};
