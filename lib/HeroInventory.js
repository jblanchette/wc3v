/*
 * HeroInventory — centralized inventory ledger for hero items.
 *
 * Previously every code path that touched a hero's items[] slot wrote
 * directly (`unit.items[slot] = newItem`), with no provenance tracking,
 * no slot-uniqueness check, and no consistent charge maintenance. The
 * targeted-item-use path even deliberately skipped slot maintenance
 * (Player.js:2671-2675 pre-Phase-3) to tolerate untracked rebuys.
 *
 * This module centralizes those operations. Every add / remove /
 * reclassify / decrementCharges call:
 *   1. mutates the slot via the existing Unit.items[N] storage (so existing
 *      consumers still work);
 *   2. tags the Item with provenance (source / confidence / acquiredAt);
 *   3. emits a unified `itemEvent` record onto the player's eventStream
 *      alongside any legacy event the caller emits (additive — never
 *      replaces `itemPurchase` / `itemUse` / `dropItem`);
 *   4. records slot-uniqueness violations on `player._itemSlotDrift` and
 *      reduces parse confidence accordingly.
 *
 * The module exports pure functions taking (player, hero, ...) — it does
 * NOT hold any internal state of its own. That keeps it composable with
 * the existing static-method-on-Building / instance-method-on-Player
 * patterns elsewhere in the parser.
 */

const Item = require("./Item");
const mappings = require("../helpers/mappings");

const { itemAbilityData } = mappings;

const VALID_SOURCES = Object.freeze({
  'startup-grant': true,
  'shop-known': true,
  'shop-inferred': true,
  'creep-drop': true,
  'pickup': true,
  'trade': true,
  'reclassification-backfill': true,
  'inferred-from-uses': true,
  'use-no-slot': true
});

const VALID_CONFIDENCE = Object.freeze({ 'high': true, 'medium': true, 'low': true });

const VALID_REMOVE_REASONS = Object.freeze({
  'use-consumed': true,
  'drop': true,
  'trade-out': true,
  'sell': true,
  'expired': true,
  'reclassify': true
});

// Emit a record onto the player's _itemEvents array (Phase 7 will export
// this as `itemEvents[]`). The record is also pushed to the eventStream
// as a key='itemEvent' record so downstream consumers can subscribe to a
// single stream.
function _emit (player, record) {
  if (!player) return;
  if (!player._itemEvents) player._itemEvents = [];
  player._itemEvents.push(record);
  if (typeof player.addEvent === 'function') {
    player.addEvent('itemEvent', record);
  }
}

function _now (player) {
  return (player && player.eventTimer && player.eventTimer.timer)
    ? player.eventTimer.timer.gameTime
    : 0;
}

function _itemRef (item) {
  if (!item) return null;
  if (typeof item.exportItemReference === 'function') {
    return item.exportItemReference();
  }
  return { itemId: item.itemId, displayName: item.displayName };
}

function _unitRef (hero) {
  if (!hero) return null;
  if (typeof hero.exportUnitReference === 'function') {
    return hero.exportUnitReference();
  }
  return { itemId: hero.itemId, displayName: hero.displayName };
}

// add(player, hero, item, opts)
//   opts = { slot?, source, confidence, knownObjectId?, acquiredAt?, actionText?, shop? }
//
// Returns { slot, item, displaced } where `displaced` is the prior item if
// the chosen slot was non-null with a different itemId (slot-uniqueness
// violation — reduces parse confidence + records on player._itemSlotDrift).
function add (player, hero, item, opts) {
  if (!hero || !item) return { slot: null, item: null, displaced: null };
  opts = opts || {};
  const source = opts.source || 'shop-known';
  const confidence = opts.confidence || 'high';
  if (!VALID_SOURCES[source]) {
    console.logger && console.logger('HeroInventory.add: unknown source:', source);
  }
  if (!VALID_CONFIDENCE[confidence]) {
    console.logger && console.logger('HeroInventory.add: unknown confidence:', confidence);
  }

  const now = (opts.acquiredAt != null) ? opts.acquiredAt : _now(player);

  // Stamp provenance on the Item itself (also exported via exportItemReference).
  item.source = source;
  item.confidence = confidence;
  item.acquiredAt = now;
  item.lastModifiedAt = now;
  if (opts.knownObjectId) item.knownObjectId = opts.knownObjectId;

  // Pick slot.
  let slot = opts.slot;
  if (slot == null) {
    if (typeof hero.getNextItemSlot === 'function') {
      slot = hero.getNextItemSlot();
    }
  }
  if (slot == null) {
    // Inventory full — caller should treat this as displaced. We don't
    // overwrite an arbitrary slot; let the caller decide.
    return { slot: null, item, displaced: null };
  }

  let displaced = null;
  if (hero.items && hero.items[slot] && hero.items[slot].itemId !== item.itemId) {
    displaced = hero.items[slot];
    if (!player._itemSlotDrift) player._itemSlotDrift = [];
    player._itemSlotDrift.push({
      gameTime: now,
      hero: _unitRef(hero),
      slot,
      previous: _itemRef(displaced),
      incoming: _itemRef(item),
      reason: 'slot-collision-on-add',
      source
    });
    // Slot-uniqueness violations are diagnostic — reduce parse confidence
    // so the validator can surface this. The original Item replacement
    // proceeds (matches pre-Phase-2 behavior).
    if (typeof player.reduceParseConfidence === 'function') {
      const sev = (displaced.itemId && item.itemId &&
                   displaced.itemId !== 'Jwid' && item.itemId !== 'Jwid')
        ? 'Minor' : 'Major';
      player.reduceParseConfidence(sev);
    }
  }

  item.itemSlotId = slot;
  if (typeof hero.setItemSlot === 'function') {
    hero.setItemSlot(slot, item);
  } else if (hero.items) {
    hero.items[slot] = item;
  }

  _emit(player, {
    action: 'add',
    gameTime: now,
    source,
    confidence,
    actionText: opts.actionText || null,
    item: _itemRef(item),
    unit: _unitRef(hero),
    shop: opts.shop || null,
    slot,
    displaced: displaced ? _itemRef(displaced) : null
  });

  return { slot, item, displaced };
}

// remove(player, hero, slot, reason, opts)
function remove (player, hero, slot, reason, opts) {
  opts = opts || {};
  if (!VALID_REMOVE_REASONS[reason]) {
    console.logger && console.logger('HeroInventory.remove: unknown reason:', reason);
  }
  if (!hero || !hero.items) return null;
  const item = hero.items[slot];
  if (!item) return null;

  const now = _now(player);
  item.lastModifiedAt = now;

  if (typeof hero.setItemSlot === 'function') {
    hero.setItemSlot(slot, null);
  } else {
    hero.items[slot] = null;
  }

  _emit(player, {
    action: 'remove',
    gameTime: now,
    reason,
    item: _itemRef(item),
    unit: _unitRef(hero),
    slot,
    target: opts.target || null,
    refund: opts.refund || null
  });

  return item;
}

// decrementCharges(player, hero, slot) — no-op when item has expires === false.
// Returns the new usesLeft (or null if no-op). When usesLeft reaches 0, calls
// remove(..., 'use-consumed') automatically.
function decrementCharges (player, hero, slot) {
  if (!hero || !hero.items) return null;
  const item = hero.items[slot];
  if (!item || !item.expires) return null;

  item.usesLeft = Math.max(0, (item.usesLeft || 0) - 1);
  item.lastModifiedAt = _now(player);

  if (item.usesLeft <= 0) {
    remove(player, hero, slot, 'use-consumed');
  }
  return item.usesLeft;
}

// reclassify(player, hero, slot, newItemId, opts)
//   opts = { reason, actionText?, shop?, confidence? }
//
// Replaces the slot's item with a new Item built from newItemId. The new
// item gets source='reclassification-backfill' and confidence='low' by
// default — overridable via opts. Records the reclassification on
// player._itemReclassifications (mirrors supplyBumps pattern). Emits a
// synthetic itemPurchase event at the current gameTime so the BO panel
// timeline shows the inferred purchase inline.
function reclassify (player, hero, slot, newItemId, opts) {
  opts = opts || {};
  if (!hero || !player) return null;

  const now = _now(player);
  const oldItem = hero.items ? hero.items[slot] : null;

  // Build the new Item (charges, displayName etc. resolved through the
  // existing Item constructor).
  const eventTimer = (hero && hero.eventTimer) || (player && player.eventTimer);
  const newItem = new Item(eventTimer, null, null, newItemId, false);
  const confidence = opts.confidence || 'low';
  newItem.source = 'reclassification-backfill';
  newItem.confidence = confidence;
  newItem.acquiredAt = now;
  newItem.lastModifiedAt = now;
  newItem.knownOwner = true;
  newItem.itemSlotId = slot;

  if (typeof hero.setItemSlot === 'function') {
    hero.setItemSlot(slot, newItem);
  } else if (hero.items) {
    hero.items[slot] = newItem;
  }

  if (!player._itemReclassifications) player._itemReclassifications = [];
  player._itemReclassifications.push({
    gameTime: now,
    hero: _unitRef(hero),
    slot,
    from: oldItem ? _itemRef(oldItem) : null,
    to: _itemRef(newItem),
    reason: opts.reason || 'unspecified',
    confidence
  });

  // Synthetic itemPurchase so the BO panel + battle banner + summary
  // extractors all see the implied buy. Tagged source so the renderer
  // can show an [INFERRED] chip.
  const itemData = itemAbilityData[newItemId];
  const goldCost = (itemData && itemData.goldCost) || 0;
  const heroName = (hero && hero.displayName) || 'hero';
  const itemName = (newItem && newItem.displayName) || newItemId;
  const shopName = opts.shop || 'inferred shop';
  const actionText = opts.actionText ||
    `Backfill: ${heroName} appears to have ${itemName} (${opts.reason || 'reclassified'})`;

  if (typeof player.addEvent === 'function') {
    player.addEvent('itemPurchase', {
      item: { itemId: newItemId, displayName: itemName },
      unit: _unitRef(hero),
      shop: shopName,
      shopItemId: null,
      isNeutralShop: false,
      goldCost,
      confidence,
      source: 'reclassification-backfill',
      actionText,
      inferred: true
    });
  }

  _emit(player, {
    action: 'reclassify',
    gameTime: now,
    source: 'reclassification-backfill',
    confidence,
    actionText,
    item: _itemRef(newItem),
    unit: _unitRef(hero),
    slot,
    from: oldItem ? _itemRef(oldItem) : null,
    reason: opts.reason || 'unspecified'
  });

  return newItem;
}

// Pick the best inventory item to attribute a use-no-slot fallback to.
// The game places shop-bought items into slots in an order our parser
// can't reliably predict (per-shop layout, hero loadout etc.), so when
// an itemUse action targets slot N and N is empty in our model, we
// search the hero's other items for one with charges left that could
// plausibly be the real item.
//
// Heuristic preference order (most → least likely):
//   1. Single shop-bought item with usesLeft > 0 (unambiguous)
//   2. Most-recently-acquired shop-bought item with usesLeft > 0
//   3. Most-recently-acquired item of any source with usesLeft > 0
// Returns null if no candidate exists — caller should fall back to
// emitting an unknown-consumable record.
//
// Returns { slot, item } so the caller can also decrement the chosen
// slot's charges through the ledger.
function findBackfillItem (hero) {
  if (!hero || !hero.items) return null;
  const candidates = [];
  for (const slotKey of Object.keys(hero.items)) {
    const it = hero.items[slotKey];
    if (!it) continue;
    if (it.expires && (it.usesLeft || 0) <= 0) continue;
    candidates.push({ slot: slotKey, item: it });
  }
  if (!candidates.length) return null;

  const shopBought = candidates.filter(c =>
    c.item.source === 'shop-known' || c.item.source === 'shop-inferred');
  const pool = shopBought.length ? shopBought : candidates;

  return pool.reduce((best, c) =>
    (!best || (c.item.acquiredAt || 0) > (best.item.acquiredAt || 0)) ? c : best,
    null);
}

module.exports = {
  add,
  remove,
  decrementCharges,
  reclassify,
  findBackfillItem,
  VALID_SOURCES,
  VALID_CONFIDENCE,
  VALID_REMOVE_REASONS
};
