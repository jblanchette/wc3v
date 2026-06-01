/*
 * eventCorrelation — co-occurring events within a small window of the
 * alleged action that imply a different item was used.
 *
 * Concretely for the kaho-happy 2:12 case:
 *   - A Skeleton Warrior (uske) addUnit firing within ~1s of an
 *     alleged stwp use is a strong signal the hero actually used a
 *     Rod of Necromancy (which produces 2 skeletons from a corpse).
 *   - More broadly: every item with a distinctive game-state side
 *     effect (summon spawn, mana refund, dispelled buff, etc.) can be
 *     correlated here.
 *
 * The strategy emits NEGATIVE evidence against the alleged claim
 * (refuting the teleport) and is paired with `rejectedItemBackfill`
 * which uses the same correlation to PROPOSE the replacement item-use
 * claim. This file just refutes.
 */

const CORRELATION_WINDOW_MS = 1500;

// item code => spec. Each spec's `predicate(ev)` returns true when an
// event in the window is the distinctive side-effect of that item.
const ITEM_SIDE_EFFECTS = Object.freeze({
  // Rod of Necromancy: spawns 2 Skeleton Warriors (uske) within
  // ~half a second of cast.
  'rnec': {
    predicate (ev) {
      return ev.key === 'addUnit' && ev.unit && ev.unit.itemId === 'uske';
    },
    weight: -0.5
  },
  // Sacrificial Skull: spawns ~25 Skeleton Warriors over time. Same
  // detection but weaker per-event weight (skull spawns aren't typically
  // immediate enough to overlap with action-stream window).
  'sksl': {
    predicate (ev) {
      return ev.key === 'addUnit' && ev.unit && ev.unit.itemId === 'uske';
    },
    weight: -0.3
  }
});

module.exports = {
  name:     'eventCorrelation',
  subjects: ['teleport', 'itemUse'],
  phase:    'look-behind',

  score (claim, ctx) {
    const payload = claim.payload || {};
    const player  = ctx.player;
    const castTime = payload.gameTime;
    if (castTime == null) return null;
    if (!player || !player.eventStream) return null;
    const allegedItem = payload.itemId;
    // Don't run when the alleged item matches the correlated item — the
    // skeleton-spawn would then SUPPORT the claim, but that branch is
    // outside this strategy's scope.
    if (allegedItem === 'rnec' || allegedItem === 'sksl') return null;

    // Look at the alleged hero's just-bought items: any of them have a
    // side-effect that fired in the window?
    const heroUuid = payload.casterUuid;
    const correlatedItems = [];
    if (player._itemEvents) {
      for (const it of player._itemEvents) {
        if (it.action !== 'add') continue;
        if (it.gameTime == null) continue;
        if (it.gameTime > castTime) continue;
        // Only look back ~30 seconds for recently-acquired candidates.
        if ((castTime - it.gameTime) > 30000) continue;
        const unitUuid = it.unit && it.unit.uuid;
        if (heroUuid && unitUuid && unitUuid !== heroUuid) continue;
        const itemId = it.item && it.item.itemId;
        if (ITEM_SIDE_EFFECTS[itemId]) correlatedItems.push(itemId);
      }
    }
    if (!correlatedItems.length) return null;

    // For each candidate, scan the event stream for the matching
    // side-effect within ±CORRELATION_WINDOW_MS of the cast.
    const evidence = [];
    for (const itemCode of correlatedItems) {
      const spec = ITEM_SIDE_EFFECTS[itemCode];
      for (const ev of player.eventStream) {
        if (ev.gameTime == null) continue;
        if (Math.abs(ev.gameTime - castTime) > CORRELATION_WINDOW_MS) continue;
        if (!spec.predicate(ev)) continue;
        evidence.push({
          kind:   'correlation',
          weight: spec.weight,
          ref:    { gameTime: ev.gameTime },
          detail: { rule: 'eventCorrelation', candidate: itemCode, sideEffect: ev.key }
        });
        break;  // one correlated side-effect per item is enough
      }
    }
    return evidence.length ? evidence : null;
  }
};
