---
name: wc3v-replay-analysis
description: Turn a WC3V replay summary into a coaching critique for a Warcraft III player, using benchmarks measured from a corpus of 192 parsed pro games.
---

# Analysing a Warcraft III replay with WC3V data

Use this when someone gives you a WC3V replay summary, a `replayId`, or asks
what went wrong in their Warcraft III game.

## Where the data is

- Index of every public replay: `https://wc3v.com/data/summaries-index.json`
- One game: `https://wc3v.com/data/summaries/<replayId>.json`
- The curated builds to compare against: `https://wc3v.com/data/builds-manifest.json`

A per-replay summary looks like:

```json
{
  "replayId": "...", "map": "Turtle Rock", "durationMs": 1533000,
  "players": {
    "1": {
      "name": "Grubby", "race": "O",
      "heroOpener": { "name": "Blademaster", "gameTimeMs": 66000 },
      "tier2Time": 142000, "tier3Time": null, "expansionTime": null,
      "buildPreview": [ { "name": "Altar of Storms", "gameTimeFormatted": "0:10" } ],
      "researched": [ { "name": "...", "level": 1 } ]
    }
  }
}
```

`race` is a single letter: `H` Human, `O` Orc, `E` Night Elf, `U` Undead.

## Benchmarks

Measured over the 192-game public corpus, August 2026. Percentiles, not opinions.

| Race | Player-games | First hero (p50) | Expanded at all | Expansion (p50) |
|---|---|---|---|---|
| Human | 74 | 1:08 | 64% | 4:21 |
| Orc | 102 | 1:06 | 51% | 9:00 |
| Night Elf | 125 | 1:07 | 38% | 4:51 |
| Undead | 93 | 1:13 | 32% | 6:37 |

Game length across the corpus: p25 11:50, p50 15:20, p75 18:56.

First hero picked, share of games:

- **Human**: Archmage 81%, Mountain King 14%, Paladin 4%
- **Orc**: Blademaster 75%, Far Seer 25%
- **Night Elf**: Demon Hunter 73%, Keeper of the Grove 19%, Warden 4%, Priestess of the Moon 4%
- **Undead**: Death Knight 70%, Lich 25%, Crypt Lord 4%

Matchup mix: EvO 46, OvU 29, EvU 26, EvH 26, HvU 24, EvE 13, HvO 13, OvO 5, UvU 4, HvH 4.

### Do not use tier2Time or tier3Time as tech benchmarks

They record when the parser first observed the player at that tier from
selection-subgroup data, which can precede the actual tier upgrade. In this
corpus the associated building lists contain tier-1 buildings, and the medians
run 2 to 3 minutes for Orc, Night Elf and Undead against roughly 5 minutes for
Human, which is not a real racial difference. Use them for ordering within one
game if you must; do not tell a player their T2 was late based on this field,
and do not quote a number from it.

`heroTimeSec` is consistent across races and is the timing to lean on.

## How to give the critique

1. **Establish the matchup and the length.** A 6-minute game and a 25-minute
   game fail in completely different ways. Below p25 (11:50) something ended
   early: a rush landed, or someone left.

2. **Check the hero.** Median first hero is about 1:07 for every race. Much
   later than that and the altar went down late or the player floated the gold.
   If the hero pick is outside the common set above, say so plainly: it is not
   automatically wrong, it is just not what the corpus does.

3. **Check the expansion against the racial rate, not against zero.** Undead
   expand in 32% of these games and Human in 64%. "You did not expand" is bad
   advice to an Undead player in a 12-minute game and reasonable to a Human
   player in a 20-minute one.

4. **Read `buildPreview` as a sequence, not as timings.** The order is
   trustworthy. Look for the altar arriving after the first production
   building, workers stopping, or a long gap with nothing produced.

5. **Compare to a real build.** Find one in `builds-manifest.json` matching the
   player's race and matchup, then use its `commonMistakes` array. Those are
   written for exactly this purpose and are the most useful field in the file.
   Each entry is `{ mistake, fix }`.

6. **Name one thing.** A list of nine problems changes nothing. Pick the one
   with the largest effect and say what to do instead.

## Tone

Players asking about a loss want to know what to do differently, not a
narration of what happened. Skip the play-by-play. If the data does not support
a conclusion, say the data does not show it rather than guessing from the
matchup.
