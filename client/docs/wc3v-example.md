# `.wc3v` Example Walkthrough — `happy-vs-grubby`

A guided tour of a real `.wc3v` file so you can see what the parser actually produces. All values quoted below come from the example: **[happy-vs-grubby.wc3v.gz](happy-vs-grubby.wc3v.gz)** — Happy (UD) vs FollowGrubby (Orc) on Concealed Hill, ~14 minutes.

For the full type definitions see **[wc3v-schema.json](wc3v-schema.json)** (JSON Schema draft 2020-12). For deeper context on how each field is computed see **[DESIGN.md](DESIGN.md)**.

## Files in this folder

| File | Size | What it's for |
|---|---|---|
| [`happy-vs-grubby.wc3v.gz`](happy-vs-grubby.wc3v.gz) | ~1.1 MB | The real, complete output of the parser. Gunzip to ~30 MB of JSON. |
| [`wc3v-example.json`](wc3v-example.json) | ~280 KB | Pretty-printed **trimmed** excerpt of the same file. Repeated arrays (`eventStream`, `units`, `path`, etc.) are capped at a handful of entries each so you can scroll, grep, and read it in an editor without crashing it. Truncated arrays are tagged with `{ __truncated: true, originalLength, keptCount }` sentinel objects so you can see what was dropped. The neutral-player aggregate (id `1042`) is omitted entirely. |

## Quick recipes

### View the file with `inspect-replay.js`
Don't `cat` or `grep` the raw `.wc3v` — it's tens of thousands of lines. Use the inspect tool, which decompresses on demand and pretty-prints what you ask for:

```bash
# High-level build order summary
node inspect-replay.js --replay=happy-vs-grubby --show=summary

# Player 2's research stream (Happy's UD upgrades)
node inspect-replay.js --replay=happy-vs-grubby --show=events --player=2 --filter=research

# Every Blademaster reference across the file
node inspect-replay.js --replay=happy-vs-grubby --show=units --search=Blademaster

# Tier transitions for both players
node inspect-replay.js --replay=happy-vs-grubby --show=tiers
```

Sections: `players`, `events`, `workers`, `units`, `tiers`, `expansions`, `summary`, `all`.

### Decompress for direct inspection

```bash
gunzip -k docs/happy-vs-grubby.wc3v.gz
# → docs/happy-vs-grubby.wc3v   (~30 MB)
```

Or pipe through `jq`:

```bash
gunzip -c docs/happy-vs-grubby.wc3v.gz | jq '.players["2"].tierStream'
gunzip -c docs/happy-vs-grubby.wc3v.gz | jq '.players["2"].apmData.raw.peak'
gunzip -c docs/happy-vs-grubby.wc3v.gz | jq '.world.neutralGroups | keys | length'
```

### Validate against the schema

```bash
npm i -g ajv-cli
gunzip -c docs/happy-vs-grubby.wc3v.gz \
  | ajv validate -s docs/wc3v-schema.json --strict=false
```

## Top-level shape

```js
{
  players:    { "1": PlayerData, "2": PlayerData, "1042": PlayerData /* neutral */ },
  world:      { neutralGroups: { "<uuid>": NeutralGroup, … } },
  replay:     ReplayMetadata,
  validation: ValidationResult   // optional — present only if issues detected
}
```

Three top-level keys are required (`players`, `world`, `replay`); `validation` is added when the parser raises any tier or worker-count warnings.

## `players` — keyed by player ID (string)

Real player IDs are usually `"1"` and `"2"`. ID `"1042"` is a synthetic **neutral player** that owns map creeps and shop units; treat it as bookkeeping, not a real opponent. In the example file:

| ID | Race | Final tier | Heroes | Events | Units |
|---|---|---|---|---|---|
| `1` (FollowGrubby) | Orc | T3 | Blademaster, Shadow Hunter | 106 | 42 |
| `2` (Happy-) | Undead | T3 | Death Knight, Lich | 142 | 58 |
| `1042` (Neutral) | Orc | T1 | — | 94 | 94 |

### Each player has these keys

```js
{
  teamId, parseConfidence, race, startingPosition,
  eventStream, selectionStream, tierStream, researchStream, itemStream,
  apmData,
  isNeutralPlayer,
  units, buildingAttempts, supplyBumps,
  baseGrid, baseSnapshots
}
```

#### `eventStream` — chronological game events

Every meaningful action that affects the build order. Each entry is normalized: `key` (event type), `gameTime` in ms, plus a snapshot of supply and worker counts at that instant.

```json
{
  "key": "addUnit",
  "gameTime": 993,
  "supplyUsed": 5,
  "supplyMax": 11,
  "workers": {
    "onGold": 5, "onLumber": 0, "onBuild": 0,
    "totalWorkers": 5, "consumedByBuildings": 0
  },
  "unit": { /* full Unit object — see below */ }
}
```

Common `key` values: `addUnit`, `addBuilding`, `research`, `tierUpgrade`, `expansion`, `heroLevel`, `workerAssign`, `itemBuy`. The full union is in the schema.

> **UD note:** `workers.onLumber` is **always 0** for Undead. Lumber is harvested by ghouls tracked in `workers.ghoulsOnLumber`. Total lumber workers = `onLumber + ghoulsOnLumber`.

A research event carries an embedded `building` reference for the producer:

```json
{
  "key": "research",
  "gameTime": 390700,
  "itemId": "Robs",
  "level": 1,
  "displayName": "Berserker Strength",
  "category": "ability",
  "icon": "btnberserk",
  "goldCost": 50,
  "lumberCost": 150,
  "building": { "displayName": "Barracks", "itemId": "obar", … }
}
```

#### `tierStream` — tier transitions

Short, ordered list. Tier 1 always at game start, then T2/T3 as upgrades complete:

```json
[
  { "gameTime": 507,    "tier": 1, "position": null },
  { "gameTime": 155541, "tier": 2, "position": { "x": -2304, "y": -4736 } },
  { "gameTime": 480339, "tier": 3, "position": { "x": -2304, "y": -4736 } }
]
```

#### `researchStream` — completed upgrades only

Distinct from `eventStream.research` events: this stream is the deduped list of finished upgrades by `(itemId, level)`, used by the UI to render upgrade icons.

#### `apmData` — actions per minute, raw and effective

```json
{
  "raw":       { "total": 9666, "average": 644, "peak": 843,  "perMinute": [641, 688, …] },
  "effective": { "total": 8300, "average": 553, "peak": 773,  "perMinute": [547, 612, …] },
  "categories": { "select": 7712, "build": 40, "move": 1750, "ui": 29, "ability": 110, "cancel": 38, "item": 16 },
  "matchDurationMs": 864928
}
```

`raw` includes spam selections; `effective` filters out duplicate select/click bursts within a small window, which is what most analytics should use.

#### `units` — every unit and building this player owned

Each unit is a rich object. Workers are slim; heroes carry `levelStream`, `xpStream`, `spellList`, and `items`. Crucial fields:

| Field | Notes |
|---|---|
| `uuid` | Stable within this file; do not assume cross-replay stability. |
| `itemId` | Race-specific 4-char unit type code (e.g. `Udea` = Death Knight). Source of truth for type identity. |
| `itemId1`/`itemId2` | Per-instance type halves. `itemId1+itemId2` together = unit type. |
| `objectId1`/`objectId2` | Per-instance instance ID. `objectId1+objectId2` = the specific unit. **Don't confuse with itemId.** |
| `level`, `levelStream`, `xpStream` | Heroes only; empty for non-heroes. |
| `path` | Polyline of positions over time, sampled at game ticks. |
| `footprints` | Sub-tick orientation samples — used by the 3D viewer to interpolate facing. |
| `meta.hero`, `meta.worker`, `meta.permanent` | Quick boolean flags pre-resolved from `mappings.js`. |
| `isInferred` | True when the unit was reconstructed (no explicit creation event in the replay). |
| `buildMechanic` | `consumed_temporary` (Orc peon), `consumed_permanent` (NE wisp on ancient), `summoner` (UD acolyte), `builder` (HU peasant), or `null`. |

#### `baseSnapshots` — buildings present at each tier transition

Lightweight derived data — used by the analyzer to compare your base layout to a pro at the same tier:

```json
{
  "label": "Tier 1",
  "tier": 1,
  "gameTime": 155541,
  "buildings": [
    { "itemId": "ogre", "displayName": "Great Hall", "x": -2304, "y": -4736, "collisionSize": 176, "isInferred": false },
    …
  ]
}
```

#### `parseConfidence` — number 0..1

How sure the parser is about this player's data. `1` means no warnings; lower values indicate the parser had to infer state (e.g., units appeared without explicit creation events). Use this to gate analytics — don't grade a player whose confidence is below ~0.7.

## `world.neutralGroups` — neutral creep camps

**Keyed by UUID, not array.** Iterate with `Object.values(world.neutralGroups)`:

```json
{
  "d514e6a7-95a5-4137-bf78-495913a8d3a8": {
    "uuid": "d514e6a7-…",
    "bounds": { "minX": 553.13, "minY": -3548.31, "maxX": 1512.62, "maxY": -2777.76 },
    "totalLevel": 12,
    "claimOwnerId": 0,
    "claimState": 1,
    "claimTime": 613301,
    "units": [
      { "displayName": "Ogre Magi", "itemId": "nomg", "balanceInfo": { "level": 5 },
        "droppedItemSets": [ { "itemId": "will", "chance": 34, "displayName": "Wand of Illusion", "isRandom": false }, … ] },
      …
    ],
    "claimers": {
      "0": { /* per-faction interaction record: who attacked, what hero was here, time spent in camp */ }
    }
  },
  …
}
```

`claimState` values: `0` = untouched, `1` = engaged, `2` = cleared. `claimers` is keyed by team ID and tracks XP distribution + arrivals — the analyzer uses this to score creep efficiency.

## `replay` — w3gjs metadata passthrough

Map info, player records, and slot assignments come from the w3gjs parser unchanged. Useful keys:

```js
replay.metadata.map.mapName            // "Maps/FrozenThrone//Community/(2)ConcealedHill.w3x"
replay.metadata.map.creator            // host (often the recording player)
replay.metadata.playerCount            // 2
replay.metadata.playerRecords[]        // [{ playerId, playerName }]
replay.metadata.slotRecords[]          // [{ playerId, color, raceFlag, teamId, … }]
replay.subheader.replayLengthMS        // total game time
```

`replay.header` is mostly format bookkeeping (block counts, decompressed size) — not interesting for analytics.

## `validation` — optional warnings

Only present when something looked off during parsing. The example file has clean data:

```json
{
  "warnings": [],
  "errors": [],
  "playerConfidence": { "1": 1, "2": 1 },
  "playerIssues": {
    "1": { "critical": 0, "major": 0, "minor": 0, "info": 0 },
    "2": { "critical": 0, "major": 0, "minor": 0, "info": 0 }
  }
}
```

Look for `warnings: [ "TIER_BUILDING_MISMATCH", … ]`-style entries when you're debugging a flaky parse. See [`lib/ReplayValidator.js`](../lib/ReplayValidator.js) for the full set of codes.

## Things to look for in this specific replay

If you're using this file to learn the format, here are the most informative bits:

- **Both players hit T3** (`tierStream.length === 3`) — full tier progression.
- **Player 2 (Happy)** has 12 flagged summoned skeletons + 3 unflagged ones — useful for testing summon-detection logic. See `units[].isSummon` and the `summonUnitIds` safety net in `client/js/BuildOrderData.js`.
- **Player 1's research stream** includes `Berserker Strength` at 6:30 game time — a `category: "ability"` upgrade with an embedded `building` reference.
- **`world.neutralGroups`** has 17 camps; the first entry (`d514…`) is a level-12 camp with item drops including `will` (Wand of Illusion, 34% chance) — good test data for drop-table parsing.
- **`apmData.effective`** for Happy peaks at 773 — realistic high-pro APM.
- **`baseSnapshots`** captures 7 buildings for player 2 at T1, more at T2, and a `Final` snapshot — useful as fixtures for tier-aware layout comparison code.
- **Neither player expanded** — `eventStream.filter(e => e.key === 'expansion').length === 0`. Use a different replay if you need expansion fixtures.

## Updating this example

```bash
# Re-parse from the .w3g (kept under replays/happy-vs-grubby.w3g):
node wc3v.js --replay=happy-vs-grubby --debug

# That writes:
#   client/replays/happy-vs-grubby.wc3v.gz   ← copy to docs/
#   client/replays/happy-vs-grubby.wc3v      ← uncompressed for inspection

# Refresh the docs copy:
cp client/replays/happy-vs-grubby.wc3v.gz docs/happy-vs-grubby.wc3v.gz

# Regenerate the trimmed example: see the script in docs/wc3v-example.md history,
# or hand-edit the cap values and rerun the inline node script.
```

If you're adding a new field to the parser, run `node wc3v.js --replay=happy-vs-grubby --debug` against this replay first — it exercises both UD and Orc code paths, has heroes that level multiple times, has expansions, and has a clean validation result, so any new diff in the output is signal.
