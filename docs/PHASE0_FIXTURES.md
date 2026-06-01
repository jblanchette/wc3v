# Phase 0 — Custom-Game fixture recordings

The item / shop / inventory tracking overhaul needs five fixture replays
to confirm action-code shapes for behaviors the corpus of pro replays
doesn't reliably cover.

## ⚠️ Recording mode matters — use Custom Game, not Single Player

**Do NOT use the "Single Player" mode** from the main menu. Single-player
saves emit malformed `GameCache` actions that w3gjs can't parse past —
this truncates the action stream and drops nearly every meaningful event
(buys, sells, item uses, pickups). First attempt at fixtures lost almost
every action this way; even with bounds-safety patches in `wc3v.js`,
single-player replays still capture only 3-9 events across multi-minute
sessions.

**Use "Custom Game"** (called "Local Area Network" / "Battle.net Custom"
depending on client) and add an **AI Computer opponent**. This produces
the same action stream format as ladder/W3C replays — the parser handles
these cleanly with the full corpus of action types and complete game
state.

In WC3 Reforged: Menu → Multiplayer → Custom Game → host a melee map →
add an AI opponent → start. The replay is saved in your normal Replays
folder. For Classic / TFT clients the path is similar (Multiplayer →
Local Area Network or Battle.net Custom Game).

For each fixture, please note the approximate game-time of the targeted
action so the implementer can grep the action log accurately.

## 1. `sellback-test.w3g` — Item sell-back to a shop

**Why we need it:** the parser has zero sell-back tracking today
(`Unit.soldItems = {}` is dead code). The Phase 4 skeleton currently
emits a `sellItem` event when a `giveOrDropItem` action targets a known
item-selling building, but the exact action shape needs confirmation.

**Recording steps:**
1. Start a single-player game on any melee map with a player shop (or
   spawn near a Goblin Merchant).
2. Train a hero, walk to your race's shop building (or a Goblin
   Merchant).
3. Buy any cheap item (e.g. Healing Salve, Scroll of Healing).
4. Immediately right-click-drag the item from your hero's inventory
   back onto the shop building — this is the sell action.
5. Save the replay as `sellback-test.w3g` and drop in `replays/`.
6. Note: approximate game-time of the sell (e.g. "0:45").

## 2. `goblab-reveal.w3g` — Goblin Lab Reveal ability

**Why we need it:** Goblin Lab's Reveal ability (paid scout reveal of a
small map area) is tactically meaningful but emits no event today.
Phase 5 will add a `neutralAbility` event for it once the action shape
is confirmed.

**Recording steps:**
1. Start a single-player game on a map with a Goblin Lab (Hammerfall,
   Turtle Rock, Twisted Meadows, etc.).
2. Train a hero (any race).
3. Walk to the Goblin Lab and click on it to take control.
4. Use the **Reveal** ability targeting a fog-of-war area on the map.
5. Optionally trigger a second Reveal so we capture cooldown behavior.
6. Save as `goblab-reveal.w3g`.
7. Note: approximate game-time of the Reveal cast.

## 3. `landmine-deploy.w3g` — Goblin Land Mines placement

**Why we need it:** `gobm` (Goblin Land Mines) is a charge-3 consumable
sold at Goblin Labs. Deploying mines from the hero's inventory is
captured by the new Phase 3 non-teleport-targeted-item dispatch, but we
want to add a `placeMine` event so the canvas can render mine markers.

**Recording steps:**
1. Start single-player on a map with a Goblin Lab.
2. Train a hero and walk to the Goblin Lab.
3. Buy 1× Goblin Land Mines.
4. Use the mines item three times in different locations on the ground.
5. Save as `landmine-deploy.w3g`.
6. Note: approximate game-times of each mine placement.

## 4. `dust-sentry-salve.w3g` — Targeted non-teleport items

**Why we need it:** pre-Phase-3, Dust of Appearance, Sentry Ward
placement, and targeted Healing Salve uses all fell through silently
in the targeted-item dispatch path (`Player.js:2677`). Phase 3 emits
`itemUse` events for these — fixture confirms the shapes and that the
items resolve from the correct hero slot.

**Recording steps:**
1. Start single-player against a hostile AI on a small map (any race).
2. Train two heroes (one to use the items, one as the salve target).
3. From the appropriate shop, buy:
   - Dust of Appearance
   - Sentry Ward
   - Healing Salve
4. Cast Dust of Appearance on an enemy unit.
5. Place a Sentry Ward on the ground.
6. Cast Healing Salve targeting your second hero.
7. Save as `dust-sentry-salve.w3g`.
8. Note: approximate game-times of each cast.

## 5. `creepdrop-pickup.w3g` — Ground item pickup from a creep camp

**Why we need it:** creep drops never become inventory items today
(`Player.selectGroundItem` only emits a camp-side `addItemEvent`).
Phase 4 adds the item to the hero via `HeroInventory.add` and emits a
`pickupItem` event — fixture confirms the action carries the item
ID we expect for both random and fixed drops.

**Recording steps:**
1. Start single-player on a melee map with creep camps that drop
   permanent items (any of: Echo Isles, Hammerfall, Turtle Rock).
2. Train a hero, level up, and walk to a creep camp that drops a
   known permanent item (e.g. Pendant of Mana, Periapt of Vitality).
3. Kill the camp and walk your hero over the dropped item to pick
   it up.
4. Optionally kill a second camp and pick up a random-roll item.
5. Save as `creepdrop-pickup.w3g`.
6. Note: which camps were killed + approximate pickup times.

---

## After recording

Drop the `.w3g` files in `replays/` and run:

```
node wc3v.js --replay=<name-without-extension> --debug 2>&1 | tee /tmp/parse.log
```

For each fixture, grep `/tmp/parse.log` for the noted timestamp window
and capture:
- the `actionId` (which event type the game emitted)
- `abilityFlags` (e.g. `64` for CancelTrainOrResearch / item-buy bytecode)
- `itemId` bytes
- `objectId1` / `objectId2`

Compare against the existing dispatch table in
`helpers/mappings.js:51-110` (`abilityActions`) and
`lib/PlayerActions.js`. Once shapes are confirmed, the corresponding
emit blocks in `Player.js` / `Building.js` can be tightened from
"detect candidate" to "emit definitive event", and a fixture-assertion
block can be appended to `tests/item-tracking.test.js` (see the
existing tests for the format).
