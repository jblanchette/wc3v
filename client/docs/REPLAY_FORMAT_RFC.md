# RFC: Tracker Events for Warcraft III Replays

Warcraft 3 Replay files should contain important game information and enable this data to create modern community tools.

The replay file format served the game and the computers of its era well, focusing on small file formats at the cost of basic utiliy such as being able to rewind the replay.

Many players of all skill level and competition types rely on replays to learn and improve at the game, and we need to unlock the vast rich amount of data that is stored in these time capsules.


StarCraft II had the same problem.  Input-only replays, community tools hitting a wall.  In patch 2.0.8 (May 2013) Blizzard added `replay.tracker.events` alongside `replay.game.events`.  From their [announcement](https://news.blizzard.com/en-us/article/9669862/starcraft-ii-patch-2-0-8-replay-file-enhancements):

> "Replay analysis has proven so integral to the competitive StarCraft II experience over the years... replay analysis tools such as SC2Gears and GGTracker have become very popular within the community."

They open-sourced a reference parser ([s2protocol](https://github.com/Blizzard/s2protocol)) and worked directly with GGTracker on the new metrics.  The tracker stream carries ten event types: units born and died with attribution, construction started and finished, upgrades, ownership and type changes, periodic economy snapshots, and bounded position samples for combat units.  Units are correlated across events by a stable tag pair.  The encoding is versioned and self-describing - it has evolved for over a decade without breaking old parsers.

The result was the entire SC2 analysis ecosystem.  Heroes of the Storm got the same thing, same architecture, official parser at [heroprotocol](https://github.com/Blizzard/heroprotocol).

This is an established Blizzard engine pattern.  WC3 is the game in the family that needs it most - its replays are the most opaque (pure lockstep, zero state), and its item RNG makes that state the least recoverable.

## The proposal

Append one self-contained section to the `.w3g` file after the last existing compressed data block:

```
offset  size      field
0x00    4 bytes   magic       "W3TE"
0x04    4 bytes   version     uint32, starts at 1
0x08    4 bytes   flags       reserved, 0
0x0C    4 bytes   payloadLen  uint32
0x10    n bytes   payload     zlib-compressed record stream
        4 bytes   crc32       of the compressed payload
```

A trailer works here because existing parsers and clients locate replay content through the header's block count and offsets.  Bytes after that are invisible to every tool in the wild.  (A new record ID inside the existing stream would also work, but some parsers treat unknown record IDs as fatal - the trailer sidesteps that.)

Records inside the payload are length-prefixed and self-describing:

```
1 byte   eventType
2 bytes  recordLen
4 bytes  gameTime (ms on the simulation clock, matching TimeSlot accounting)
...      event fields
```

Unknown event types are skippable by construction.  Type identity uses the existing four-character codes (`hfoo`, `ckng`) the community already maps from game data.  Unit and item identity reuses the same `objectId1`/`objectId2` instance pairs that already appear in the command stream, so tracker events correlate directly with player actions in the same file.

### Version 1 events

| Event | Fields | What it actually fixes |
|-------|--------|------------------------|
| `ItemDropRolled` | itemTypeId, itemObjectId1/2, sourceUnitObjectId1/2, sourceUnitTypeId, x, y | Written when the engine resolves a drop roll.  This is the one piece of information that is provably unrecoverable from the current format.  Every WC3 replay tool shows "Unknown" here today. |
| `ItemPickedUp` | itemTypeId, itemObjectId1/2, unitObjectId1/2, ownerPlayerId | Covers pickups including tomes and runes consumed instantly on contact.  Removes the slot-ledger drift that breaks sell and trade attribution. |
| `UnitBorn` | unitTypeId, unitObjectId1/2, ownerPlayerId, x, y | Ground truth for training completion, summons, mercenaries, illusions.  Today these are inferred from selection patterns and missed entirely when a player never clicks the unit. |
| `UnitDied` | unitObjectId1/2, killerPlayerId, killerUnitObjectId1/2, x, y | Ground truth for kill counts, losses, camp clears, hero deaths.  Today every death is estimated. |
| `ConstructionStarted` / `ConstructionFinished` | buildingTypeId, buildingObjectId1/2, ownerPlayerId, x, y | Build orders that show when a building was *ready*, not just when it was *ordered*.  This is what SC2's UnitInit/UnitDone split enables. |

### Version 2 events

| Event | Fields | What it fixes |
|-------|--------|---------------|
| `HeroXP` | heroObjectId1/2, newXp, newLevel | Real level timing.  Useful for creep route analysis and the learning content new players ask for. |
| `ResearchFinished` | upgradeTypeId, level, playerId | When an upgrade actually completes vs when it was queued. |
| `UnitOwnerChanged` / `UnitTypeChanged` | unitObjectId1/2, newOwner / newTypeId | Charm, Possession, Druid forms, hero morphs without losing the unit's identity across the event. |
| `PlayerStats` (every 10s) | playerId, gold, lumber, goldMinedTotal, lumberHarvestedTotal, foodUsed, foodMax, upkeepTier | Economy curves and resource float over time.  This is the SC2 `SPlayerStatsEvent` equivalent and their most-used tracker event. |

Not included: continuous or high-frequency data like positions, HP ticks, or per-attack rolls.  SC2's design is the right model - discrete state transitions only.  WC3 needs even less of the positional stuff because movement intent is already in the command stream.

## Compatibility and size

Old parsers and old clients are unaffected - the trailer sits beyond what the header directs them to read.

This section is written from events the simulation already raises, so no gameplay code paths change and there is no desync surface.  It observes, it does not influence.

A competitive 1v1 game produces roughly 1,500-3,000 unit born/died events, tens of item and research events, and around 360 stats snapshots over 30 minutes.  That's 60-120 KB raw, under 30 KB compressed - against typical replay sizes of 0.5-2 MB.  Version 1 alone is much less than that.  SC2 has shipped tracker events for over a decade and nobody notices the size.

Nothing here is a live API.  Everything is written after the game ends and cannot affect a game in progress.  Every event describes something a full observer of the finished game could see - no hidden information, no chat, no account data.

## A request for what is being asked for

Priority order:

1. **`ItemDropRolled` + `ItemPickedUp` (Version 1, subset).**  These two events alone fix the single most-requested gap in WC3 replay tooling.  Item drops are provably unrecoverable from the current format without full re-simulation.  Every active WC3 tool - w3gjs, wc3stats, wc3v, W3Champions - shows "Unknown" here today.
2. **`UnitBorn`, `UnitDied`, `ConstructionStarted`, `ConstructionFinished` (Version 1, remainder).**  Removes the dependency on inferred build orders and estimated kill counts.
3. **Version 2 events** per the table above, after Version 1 is stable.
4. **A reference spec or format note.**  Two pages is sufficient.  The community will build the tooling quickly - the SC2 ecosystem had parsers within weeks of s2protocol shipping.

We can test against draft builds, review a spec before release, or contribute validation replays.  Contact: open an issue on w3gjs or wc3v.
