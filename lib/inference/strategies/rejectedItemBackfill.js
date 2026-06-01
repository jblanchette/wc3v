/*
 * rejectedItemBackfill — runs in the commit-prep phase. For any
 * teleport claim that has settled at `rejected` or `unlikely`, propose
 * a new itemUse claim attributing the slot click to the most-recently-
 * acquired non-stwp item in the hero's tracked inventory.
 *
 * Per the plan: backfill only commits when the proposed itemUse claim
 * itself scores `likely` or better. Here we just propose the claim;
 * the fixpoint pass (we trigger one more round implicitly by adding a
 * dirty claim) settles its confidence using the other strategies.
 *
 * The kaho-happy 2:12 case: rejected stwp teleport → backfill proposes
 * itemUse(rnec) which gets confirmed by `eventCorrelation` (skeleton
 * spawn) and `recentPurchaseContradiction` flipped sign (rnec WAS the
 * recent purchase, so the contradiction now refutes the OLD claim and
 * supports the NEW one).
 */

const { CONFIDENCE_INDEX } = require('../Claim');

module.exports = {
  name:     'rejectedItemBackfill',
  subjects: ['teleport'],
  phase:    'commit-prep',

  score (claim, ctx) {
    // Only run for failed teleport claims.
    if (CONFIDENCE_INDEX[claim.confidence] > CONFIDENCE_INDEX.unlikely) return null;

    const payload = claim.payload || {};
    const player  = ctx.player;
    if (!player) return null;
    const cast = payload.gameTime;
    if (cast == null) return null;

    // Find the hero this claim was about.
    const caster = (player.units || []).find(u => u.uuid === payload.casterUuid);
    if (!caster || !caster.items) return null;

    // Pick the best non-stwp candidate from the hero's tracked items at
    // the time of the cast. We look at the live items[] for simplicity
    // — strategies running in the same registry haven't mutated state.
    let best = null;
    for (const k of Object.keys(caster.items)) {
      const it = caster.items[k];
      if (!it) continue;
      if (it.itemId === 'stwp') continue;
      // Need a usable item (charges left if expires, or any active item).
      if (it.expires && (it.usesLeft || 0) <= 0) continue;
      // Strongly prefer items acquired close to the cast time.
      const acquired = it.acquiredAt != null ? it.acquiredAt : 0;
      const recency = Math.max(0, cast - acquired);
      const score = -recency + ((it.source === 'shop-known') ? 5000
                              : (it.source === 'shop-inferred') ? 2500
                              : 0);
      if (!best || score > best.score) {
        best = { item: it, slot: k, source: it.source, score };
      }
    }
    if (!best) return null;

    // Propose a fresh itemUse claim. Adding it to the registry from a
    // strategy is a bit unusual — `score` normally returns evidence only.
    // The orchestrator handles the claim addition before any evidence
    // returned by other commit-prep strategies fires. To do that
    // cleanly we attach the proposal to the existing claim's payload
    // and let the commit pass on Player consume it.
    //
    // (Alternative would be to expose registry.addClaim to strategies;
    // we keep the API tight here and just decorate the rejected claim.)
    claim.payload = claim.payload || {};
    claim.payload.proposedBackfill = {
      itemId:   best.item.itemId,
      slot:     best.slot,
      itemSource: best.source,
      acquiredAt: best.item.acquiredAt,
      displayName: best.item.displayName
    };

    // Emit a neutral evidence entry so the audit trail shows the
    // backfill ran.
    return {
      kind: 'observation',
      weight: 0,
      ref: { gameTime: cast },
      detail: {
        rule: 'rejectedItemBackfill',
        proposed: claim.payload.proposedBackfill
      }
    };
  }
};
