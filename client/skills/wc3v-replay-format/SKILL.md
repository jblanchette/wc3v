---
name: wc3v-replay-format
description: Parse or interpret a Warcraft III .w3g replay or a WC3V .wc3v JSON file, including the identity and worker-tracking rules that are easy to get wrong.
---

# Working with Warcraft III replay data

Use this when someone is parsing `.w3g` files, reading WC3V's `.wc3v` JSON, or
building tooling on Warcraft III replay data.

## References

- Format notes: `https://wc3v.com/docs/REPLAY_FORMAT_RFC.md`
- JSON Schema for the parsed output: `https://wc3v.com/docs/wc3v-schema.json`
- A worked example: `https://wc3v.com/docs/wc3v-example.json`
- Source (GPLv3): `https://github.com/jblanchette/wc3v`

## The two rules that cause the most bugs

**1. Type and instance are different pairs of ids.**

`itemId1 + itemId2` identifies a unit *type* (what kind of thing it is).
`objectId1 + objectId2` identifies a unit *instance* (which particular one).

Mixing them is the classic error. Counting distinct `itemId` pairs gives you
the number of unit types built, not the number of units. Tracking a specific
Blademaster across the game requires the `objectId` pair; the `itemId` pair is
shared by every Blademaster in the replay.

**2. Undead lumber workers are tracked separately.**

`workers.onLumber` is always 0 for Undead. Ghouls harvesting lumber live in
`workers.ghoulsOnLumber`. Any lumber-worker count for an Undead player must add
both:

```
lumberWorkers = workers.onLumber + (workers.ghoulsOnLumber || 0)
```

Reporting `onLumber` alone will tell you an Undead player mined no lumber all
game, which is never true.

## Other things worth knowing

**Unit lifecycle.** Units go unregistered → spawned → registered → active →
dead. Registration happens when the unit first appears in a *selection* action,
so a unit can exist in the game before the parser knows about it. Do not assume
a unit exists before its first selection.

**Race build mechanics differ, and it changes worker accounting.** Orc and
Night Elf consume the worker into the building. Undead acolytes start a summon
and walk away free. Human peasants work on-site and can be pulled off. A worker
model that assumes one behaviour will miscount three races.

**Worker tracking is post-processed.** It is computed after the full replay is
parsed, not maintained live. Mid-parse worker state is not meaningful.

**Timings are milliseconds** in the raw output (`gameTimeMs`), with a
preformatted `gameTimeFormatted` alongside for display.

**Tier times are inferred, not read.** `tier2Time` and `tier3Time` come from
selection-subgroup tier detection and can precede the actual tier upgrade. They
are not a reliable tech benchmark. See the `wc3v-replay-analysis` skill.

## Getting parsed data without parsing anything

If you only need the data, WC3V already publishes it:

- `https://wc3v.com/data/summaries-index.json` — 192 parsed pro games
- `https://wc3v.com/data/summaries/<replayId>.json` — one game in full

That is usually the right answer. Parsing `.w3g` yourself is only necessary for
replays that are not in the corpus.

## Privacy

Replays a visitor drops on wc3v.com are parsed in the browser and never
uploaded. If you are building something in the same space, note that this is a
deliberate property of the design and not an accident of hosting.
