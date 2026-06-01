/*
 * recentPurchaseContradiction — a teleport claim that fires within
 * ~10 seconds of a *different-item* purchase by the same hero is
 * suspect. Players don't typically buy a Rod of Necromancy then
 * immediately burn their auto-granted TP scroll three seconds later.
 *
 * The window scales with the alleged item's reasonable use interval —
 * for stwp we look back 10s; future strategies for charged items can
 * use that item's cooldown.
 *
 * Refutation is strongest when the recent purchase is for an item
 * compatible with the alleged action (e.g. Rod of Necromancy + skeleton
 * spawn) — that's `eventCorrelation`'s job. Here we just flag the
 * temporal anomaly.
 */

const RECENT_PURCHASE_WINDOW_MS = 10000;
const STARTUP_GRANT_BOOST_MS = 30000;   // extra window when the alleged
                                        // item is the auto-grant — we're
                                        // more skeptical of using the
                                        // freebie right after buying real
                                        // items.

module.exports = {
  name:     'recentPurchaseContradiction',
  subjects: ['teleport'],
  phase:    'look-behind',

  score (claim, ctx) {
    const payload = claim.payload || {};
    const player  = ctx.player;
    const castTime = payload.gameTime;
    if (castTime == null) return null;
    if (!player || !player.eventStream) return null;

    const heroUuid = payload.casterUuid;
    const allegedItem = payload.itemId;
    const isStartupGrant = payload.itemSource === 'startup-grant';
    const window = RECENT_PURCHASE_WINDOW_MS +
      (isStartupGrant ? STARTUP_GRANT_BOOST_MS : 0);

    // Guard: if the player has *ever* bought (or picked up) a matching
    // item of the alleged type before the cast, the use is consistent
    // with normal play and we don't infer a phantom from co-occurring
    // unrelated purchases. The kaho-happy 2:12 case lacks this: his
    // first real stwp purchase is at 11:49, well after the alleged
    // 2:12 use. The LeonXIV case has it: stwp purchased at 11:11, used
    // at 12:31 — concurrent Tome of Retraining purchase doesn't refute.
    let hasMatchingPurchase = false;
    if (allegedItem) {
      for (const ev of player.eventStream) {
        if (ev.gameTime == null) continue;
        if (ev.gameTime > castTime) break;
        const isAcquisition = (ev.key === 'itemPurchase' || ev.key === 'pickupItem');
        if (!isAcquisition) continue;
        const id = ev.item && (ev.item.itemId || ev.item.knownItemId);
        if (id === allegedItem) { hasMatchingPurchase = true; break; }
      }
    }
    if (hasMatchingPurchase) return null;

    let recentPurchase = null;
    for (const ev of player.eventStream) {
      if (ev.key !== 'itemPurchase') continue;
      if (ev.gameTime == null) continue;
      if (ev.gameTime > castTime) break;   // events ordered by gameTime
      if ((castTime - ev.gameTime) > window) continue;
      const buyerUuid = ev.unit && ev.unit.uuid;
      // Same hero (when uuid present), or accept any purchase if uuid missing.
      if (heroUuid && buyerUuid && buyerUuid !== heroUuid) continue;
      // Different item — that's the contradiction signal.
      const purchasedId = ev.item && (ev.item.itemId || ev.item.knownItemId);
      if (purchasedId && allegedItem && purchasedId === allegedItem) continue;
      recentPurchase = { gameTime: ev.gameTime, item: purchasedId };
    }

    if (!recentPurchase) return null;

    const dt = (castTime - recentPurchase.gameTime) / 1000;
    // Closer in time = stronger refutation. -0.5 at 0s elapsed, -0.2 at
    // 10s. Auto-grant gets an extra -0.1 (we set isStartupGrant above).
    let weight = -0.5 + (dt / window) * 0.3;
    if (isStartupGrant) weight -= 0.1;
    if (weight < -0.6) weight = -0.6;

    return {
      kind:   'contradiction',
      weight,
      ref:    { gameTime: recentPurchase.gameTime },
      detail: {
        rule: 'recentPurchaseContradiction',
        purchasedItem: recentPurchase.item,
        deltaSeconds: dt,
        allegedItem
      }
    };
  }
};
