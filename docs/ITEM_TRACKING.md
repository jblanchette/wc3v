# Item / Shop / Inventory Tracking

The most-asked-for, hardest-to-deliver feature in a WC3 replay tool.
This document captures everything wc3v has learned about how items
work inside the game engine *and* what the `.w3g` replay format hides
from us, so future contributors don't have to re-discover any of it.

If you've ever wondered why our build-order panel says
"Unknown consumable" instead of "Lesser Clarity Potion" on a creep-camp
pickup — keep reading. The answer is "Blizzard's PRNG is opaque" and it
is not a bug we can fix without a replay-format change.

---

## TL;DR for new contributors

1. The replay carries **commands**, not **outcomes**. Heroes don't
   announce "I picked up a Pendant of Mana." The hero issues a
   right-click on a ground item with an integer objectId. The game
   then resolves what that objectId points to — and we don't get to
   listen to that resolution.

2. Anything **rolled by the game engine after the action fires** is
   invisible to us. Specifically: creep-camp item drops (the roll
   happens at unit death), random item pools (`Y{class}I{level}`
   refs in droppedItemSets), and shop slot assignment.

3. We compensate with five strategies — direct observation,
   deferred inference, post-parse reconciliation, drop-table pool
   surfacing, and provenance tagging. Each event carries a
   `source` + `confidence` so downstream consumers can decide
   whether to trust it.

4. Tomes, runes, and gold/lumber bags are **not items** for our
   purposes — they're consumed on pickup and never enter inventory.
   Treat them as effects, not slot residents.

---

## 1. What the replay actually contains

The `.w3g` action stream is roughly:

```
PlayerID  Tick  ActionCode  Payload
   1       42      0x10       [HeroAbility][AbilityID]
   1       43      0x13       [orderId][targetIod1][targetIod2]
   2       45      0x16       [select 1 unit: objectId1, objectId2]
```

For items, the action codes that matter are:

| Code | Name (per w3gjs)              | What it represents |
|------|-------------------------------|--------------------|
| 0x10 | `UnitBuildingAbility…NoParams` | Hero clicks an item slot ability (e.g. Use Healing Salve from slot 2) |
| 0x11 | `UnitBuildingAbility…TargetPosition` | Item used at a ground point (Sentry Ward, Goblin Land Mine) |
| 0x12 | `UnitBuildingAbility…TargetPositionObjectId` | Item used on a unit, or right-click on a unit |
| 0x13 | `GiveItemToUnit` | Hero traded an item, dropped to a unit, or sold to a shop |
| 0x14 | `CancelTrainOrResearch` | Shop hire / buy slot (the "training" the shop is doing IS the item creation) |
| 0x16 | `SelectSubgroup` | Selection — used downstream to attribute the next ability action |

The order codes within these actions are the second layer of detail:

| Order bytes (little-endian itemId field) | Meaning |
|------------------------------------------|---------|
| `[40, 0, 13, 0]`                         | HeroItem1 (use the item in slot 1) |
| `[41, 0, 13, 0]`                         | HeroItem2 |
| `[42…45, 0, 13, 0]`                      | HeroItem3-6 |
| `[34, 0, 13, 0]`                         | HeroMoveItem1 (drag slot 1 to a different slot) |
| `[35…39, 0, 13, 0]`                      | HeroMoveItem2-6 |
| `[3, 0, 13, 0]`                          | RightClick (universal — pickup, attack, walk-to) |
| `[33, 0, 13, 0]`                         | DropItem (drop on ground or sell to shop) |
| `[55, 0, 13, 0]`                         | `ARev` — Goblin Lab Reveal ability |

The dispatch tables live in `helpers/mappings.js` (`abilityActions`).
**Don't add a new ability-code byte signature without confirming
it against a recorded fixture replay.**

---

## 2. What the replay leaves out (the hard limits)

### 2a. Creep-camp drops: the RNG opacity

When a creep dies and drops an item, the **game engine** does the
following at death-tick on every client:

1. Look up the dying unit's `droppedItemSets` (from the map's
   `war3mapUnits.doo` file — we parse this and ship it as
   `client/maps/{name}/neutralBuildings.json.gz` after rolling in
   `tools/regen-unit-cache.js`).
2. Each "set" is an independent roll. A set might be
   `[{itemId: cnob, chance: 50}, {itemId: stwp, chance: 30}]` — meaning
   50% chance Circlet of Nobility, 30% chance Scroll of Town Portal,
   20% chance no drop.
3. Some sets reference random pools: e.g. `YjI3` = "Random Lv3
   Permanent". The engine then re-rolls inside that pool.
4. Whatever item is selected gets spawned on the ground with a fresh
   objectId.

**None of this rolling happens on the replay timeline.** The replay
records only "objectId X exists on the ground at position (a, b) now."
We never see "the game rolled cnob and it's at objectId X."

When the hero later picks the item up via a RightClick action, the
replay just says "RightClick on objectId X." We know X is a ground item
because of the position, but we don't know its itemId until the player
later does something that re-references X with its itemId attached —
typically dropping the item on the ground (which carries the iod) or
trading it to another hero.

**Consequence:** for a pickup followed by immediate consumption (the
classic "kill creep camp, walk hero through pile of items, hero picks
up a Healing Salve and uses it 90 seconds later"), the replay shows:

```
T=120s: RightClick on objectId 0x2A1 at position (1200, 800)  ← pickup, item id unknown
T=210s: HeroItem3 ability used by hero                        ← which item? unknown
T=210s: targeted at hero himself
```

We *can* surface "this pickup came from a camp with the following
drop pool" — that's what `mappings.resolveDropItem()` does. But we
cannot surface "Healing Salve was picked up here." That requires
mirroring Blizzard's RNG, which is the topic of the next document.

### 2b. Shop slot assignment

When a hero buys from a shop, the action says "shop produced item I
on tick T." It does NOT say "into slot S." The game looks at the
hero's inventory, finds the first empty slot, and drops it there.

We replicate this with `getNextItemSlot(hero)` — but if the hero has
moved items around since the last buy, our slot assignment can drift
from the game's. This is why `HeroInventory.add()` returns a
`displaced` flag and reduces parse confidence when it has to overwrite
a slot.

### 2c. Sells without a prior drop chain

To sell an item, the player right-click-drags it onto a shop. The
replay records this as action 0x13 (GiveItemToUnit) with the shop as
target. We know which hero is selecting (from prior selection state),
which shop is targeted (from the iod), and the slot the drag came
from. We **do not get** the itemId — only the hero's slot index.

This means a sell-back's itemId comes from our slot-tracking ledger.
If we've drifted (see 2b above), we sell-back the wrong itemId.
Confidence ceiling: `medium`.

### 2d. Tomes, runes, gold/lumber bags

These are "items" in the WC3 editor sense but never enter inventory.
The replay action looks identical to a pickup, but the game
immediately consumes the item and applies its effect. We tag these in
`itemAbilityData` with `category: 'tome'` and skip slot tracking.

The categories you'll see in the data file:

- `tome` — stat tomes, runes (consumed on pickup, no slot)
- `consumable` — salves, scrolls, dust (slot, charges, decrement on use)
- `permanent` — circlets, pendants, orbs (slot, no charges)
- `charged-permanent` — Periapt of Vitality etc. (slot, charges, passive)
- `purchasable` — neutral-shop hires (mercenaries, not items)
- `campaign` — story-mode items, not used in melee

---

## 3. The five compensation strategies

### 3.1 Direct observation (the easy case)

If the action says "Hero buys X from Goblin Merchant" — that's a
direct observation. Confidence: `high`. Source: `shop-known`.

We get this for:
- Shop purchases (action 0x14, CancelTrainOrResearch on a shop)
- Item uses with a known slot itemId (action 0x10/0x11/0x12 + HeroItemN)
- Drops onto the ground where the iod is published (action 0x13)
- Trades between heroes when the iod survives the round trip

### 3.2 Deferred inference (Phase A + B)

For creep-drop pickups (the action looks like a vanilla right-click on
a ground unit), we run a two-phase detector:

**Phase A — buffer candidates.** Every right-click on a non-hero
non-building ground objectId in a position that's within a creep
camp's known kill radius gets buffered in
`player._pendingInferredPickups` with `confidence: low`,
`source: pickup-inferred`.

**Phase B — post-parse validation.** After the action stream
completes, we walk every player's later events looking for drops,
sells, or trades that reference the buffered iod. When we find one,
we retroactively emit a `pickupItem` event for the original action
with `confidence: high`, `source: pickup-confirmed`.

If Phase B never matches the iod, the candidate stays as
`pickup-inferred` (low confidence). This is the honest answer for
"hero picked up something we can't identify."

### 3.3 Post-parse reconciliation (the inferred-from-uses path)

When the use stream contains "Healing Salve used at T=300s" but the
purchase stream has no Healing Salve buy before T=300s, we synthesize
a back-dated purchase: `source: inferred-from-uses`, `confidence: low`,
`gameTime: T - 0`. The build-order panel renders this with an
`[INFERRED]` chip so the user knows it wasn't observed directly.

Constraints on the reconciliation:
- Skip `category: permanent` and `category: tome` (those don't
  decrement charges, so use-count doesn't bound purchase-count).
- Skip items without a `goldCost` (refuses to fabricate a purchase
  with unknown economics).
- Cap at 5 inferred purchases per hero per item (anything more
  suggests our parser is drifting, not that the hero shopped invisibly).

### 3.4 Drop-table pool surfacing

When a pickup gets stuck at `pickup-inferred` (we know it happened, we
don't know what dropped), we look up the nearest creep camp's
`droppedItemSets` and surface the **candidate pool** as
`possibleItems[]` on the pickup event. The viewer can then render
"Pendant of Mana / Circlet of Nobility / Ring of Regeneration"
instead of "Unknown."

This is generated by `Player._resolveCampDropsForPosition()` and
backed by `helpers/dropTables.json` (283 items, 22 random pools, all
sourced from CASC `Units/itemdata.slk`).

### 3.5 Drift correction (the stwp→stel example)

Every player starts with a Scroll of Town Portal in slot 1. If we
later observe the hero "using" slot 1 to target a non-town-hall
object, that's not stwp — stwp only targets allied town halls.

In `Player.useAbilityWithTargetAndObjectId()` we check the target
type at use-time and, if it doesn't match stwp's contract,
reclassify slot 1 as `stel` (Staff of Teleportation, a single-unit
teleport). The reclassification emits a synthetic `itemPurchase`
with `source: reclassification-backfill` so the BO panel timeline
shows the inferred purchase inline at the correct game-time.

This is how the `1342775468_Kaho_Happy_Hammerfall` reference replay
correctly shows Kaho's `stel` uses despite the original parser
labelling them as `stwp` casts.

---

## 4. The unified ledger (`itemEvent`)

Every slot mutation flows through `HeroInventory` (`lib/HeroInventory.js`),
which emits a unified `itemEvent` record alongside the legacy event
type. The shape:

```
{
  key: 'itemEvent',
  gameTime,
  action: 'add' | 'remove',  // currently — may grow to 'use' | 'sell' | 'reclassify' etc.
  source,                     // see VALID_SOURCES in tests/item-tracking-comprehensive.test.js
  confidence,                 // 'high' | 'medium' | 'low'
  actionText,
  item: { itemId, displayName, ... },
  unit: { uuid, displayName, ... },
  slot,
  acquiredAt,                 // for `add`: when the item entered inventory
  knownObjectId,              // { id1, id2 } if we have a confirmed iod
  // For 'remove':
  reason: 'use-consumed' | 'drop' | 'trade-out' | 'sell' | 'expired'
}
```

Legacy events (`itemPurchase`, `itemUse`, `dropItem`, `pickupItem`,
`sellItem`) continue to fire **alongside** the ledger — we never
remove an event shape because downstream consumers (BattleData,
SummaryExtract, BO panel, validator, archived `.wc3v` files) still
read them.

If you add a new emit site, emit BOTH the legacy event AND the
unified ledger entry. The `_emitItemEvent` helper inside
HeroInventory is the canonical wrapper.

---

## 5. Source + confidence enum (the contract)

Every item-related event carries a `source` and `confidence`. The
test suite (`tests/item-tracking-comprehensive.test.js`) asserts both
fields stay within the enum. Adding a new source value means:

1. Add it to `VALID_SOURCES` in that test file.
2. Add a row to the table below.
3. Document the parser invariant that justifies the new tag (e.g.
   "this fires only when action X with payload Y is observed").

| Source                       | Confidence | Origin |
|------------------------------|------------|--------|
| `startup-grant`              | high       | Every hero spawns with one item per `setHeroSlot()` (usually stwp). The grant is implicit, never an action. |
| `shop-known`                 | high       | Shop buy directly observed via action 0x14. |
| `shop-inferred`              | medium     | Buy reconstructed from a later use that the parser saw at a shop building's iod. |
| `ground-pickup`              | high       | Hero right-clicked a ground item whose iod we already have in `world.droppedItems`. |
| `pickup-confirmed`           | high       | Phase B: deferred pickup that a later drop/sell event referenced by iod. |
| `pickup-inferred`            | low        | Phase A buffered, Phase B never matched. itemId unknown — `possibleItems[]` carries the candidate pool. |
| `creep-drop`                 | medium     | Backfilled when a camp drops an item we can identify (e.g. fixed-itemId drop set, no random roll). |
| `trade`                      | high       | Hero-to-hero item handoff with both iod's confirmed. |
| `reclassification-backfill`  | low        | In-stream drift correction (e.g. stwp→stel when target isn't a town hall). |
| `inferred-from-uses`         | low        | Post-parse reconciliation: more uses observed than purchases, fabricated a synthetic buy. |
| `use-no-slot`                | low        | itemUse action fired but the matching slot was empty — honest fallback that says "something happened, I don't know what." |

`confidence: high` means: I observed this directly in the action
stream, with no ambiguity. The BO panel renders these cleanly with no
chip.

`confidence: medium` means: I inferred this from corroborating
evidence elsewhere in the stream. Renders with a soft `[UNCERTAIN]`
chip.

`confidence: low` means: I'm guessing, and the user should treat
this as "probably happened" rather than "definitely happened." Renders
with an `[INFERRED]` chip.

---

## 6. Test coverage

Two files protect this subsystem:

1. **`tests/item-tracking.test.js`** — the Phase 10 smoke test.
   Locks four headline regressions (Kaho stwp→stel, spre uses, Goblin
   Merchant visibility, unified ledger). Do not modify; deletions to
   this file make a PR obviously wrong.

2. **`tests/item-tracking-comprehensive.test.js`** — the full
   regression suite. Five sections (A action-shape, B mappings,
   C ledger invariants, D fixture replays, E pro-corpus sanity)
   covering every code path Phases 1-9 added. Skips gracefully when
   a fixture isn't present or is too small to have meaningful events
   (legacy single-player recordings).

Run both with:

```
node tests/item-tracking.test.js
node tests/item-tracking-comprehensive.test.js
```

---

## 7. Things you should NOT do

- **Don't hardcode itemId expectations on random-drop pickups.** The
  game rolls them client-side; asserting "Pendant of Mana dropped from
  the first camp" is replay-specific and will break with a different
  RNG seed.

- **Don't add a new `source` value without updating
  `VALID_SOURCES`.** The test suite will catch it, but only after
  someone notices. Save the cycle.

- **Don't trust `confidence: low` events for analytics aggregation.**
  Battle-banner item chips, validator severity, and homepage stats
  should weight by confidence. The `BattleData` already does this.

- **Don't add Single-Player fixture replays to this suite.** They're
  corrupted by `GameCache` actions — see
  `docs/PHASE0_FIXTURES.md` for the recording protocol.

- **Don't backfill purchases for permanent or tome items.** The
  `inferred-from-uses` path skips these by design (no use-count
  evidence to anchor on).

- **Don't mutate `Unit.items[]` directly.** Always go through
  `HeroInventory.add/remove/reclassify`. Direct mutation bypasses the
  ledger AND the parse-confidence reducer.

---

## 8. Where to look next

- **`lib/HeroInventory.js`** — the ledger module. All slot ops route here.
- **`lib/Player.js`** ~2500-3700 — action dispatch for HeroItem,
  RightClick, GiveItemToUnit, SelectGroundItem, plus the Phase A
  buffer + Phase B drain + reconciliation engine.
- **`lib/Building.js`** — shop buy dispatch (`isItemShop`,
  `isNeutralItemShop`), neutral-building ability events.
- **`lib/Item.js`** — Item class with provenance fields (source,
  confidence, acquiredAt, lastModifiedAt, knownObjectId).
- **`helpers/mappings.js`** — `itemSellingBuildings`, `itemAbilityData`
  (uses/category/goldCost), `getItemDisplayName`, `resolveDropItem`.
- **`helpers/dropTables.json`** — generated from CASC itemdata.slk by
  `tools/parse-drop-tables.js`. 283 items, 22 pools, all with
  friendly display names.
- **`helpers/teleportAbilities.js`** — the registry of every teleport
  ability + the four-category system (town-portal, single-unit, mass,
  blink).
- **`client/js/BuildOrderRenderer.js`** ~1230-1300 — UI rendering of
  `itemPurchase`, `itemUse`, `pickupItem`, `sellItem` cards with
  inferred/uncertain chip handling.

---

## 9. The PRNG question (separate document)

The bnet replay viewer shows correct items for creep-drop pickups.
That means Blizzard's client either:

  (a) re-runs the game simulation with a known RNG seed, in step with
      the action stream, OR
  (b) records the resolved itemId in the replay file in a place we're
      not reading.

If (a), wc3v could in principle mirror Blizzard's PRNG and recover
the same itemIds. If (b), we just need to find the right offset.

This is the subject of `docs/PRNG_AND_REPLAY_FORMAT.md` (next).
