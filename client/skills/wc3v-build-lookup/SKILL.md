---
name: wc3v-build-lookup
description: Find a Warcraft III build order for a race, matchup and skill level from the WC3V library, and explain how to execute it.
---

# Finding and explaining a Warcraft III build order

Use this when someone asks what to build as a race, how to play a matchup, or
wants a build order to learn.

## Where the data is

`https://wc3v.com/data/builds-manifest.json` — one file, 16 curated builds.
Every build also has a page at `https://wc3v.com/builds/<id>` and a Markdown
twin at `https://wc3v.com/builds/<id>.md`, which is usually the faster read.

The index of all of them: `https://wc3v.com/builds.md`.

## The fields that matter

```json
{
  "id": "ne-dh-fast-bear",
  "name": "DH Standard",
  "race": "E",
  "matchups": ["EvU", "EvO", "EvH"],
  "level": "improving",
  "difficulty": "medium",
  "heroOpener": "Demon Hunter",
  "description": "...",
  "strategyPoints": ["..."],
  "beginnerNotes": ["..."],
  "commonMistakes": [{ "mistake": "...", "fix": "..." }],
  "prerequisites": ["..."],
  "tierProgression": { "t1": { "buildings": [], "units": [], "goal": "" } },
  "heroSkills": { "edem": { "AEmb": 3 } },
  "coreUpgrades": ["Reoc"],
  "replays": [{ "replayId": "...", "playerSlot": "1", "playerName": "..." }]
}
```

- `race` is one letter: `H` Human, `O` Orc, `E` Night Elf, `U` Undead.
- `matchups` are `<your race>v<their race>`, so `EvU` is Night Elf against Undead.
- `level` is `new`, `improving` or `pro`. This is the single most important
  filter and the one people skip. A `pro` build handed to a new player is worse
  than no answer: it assumes creep routes and hero micro they do not have yet.
- `tierProgression.t1/t2/t3` hold `buildings` and `units` as raw four-letter
  Warcraft III itemIds plus a plain-language `goal`. Quote the `goal`; the
  itemIds are only useful if you can resolve them, and the generated
  `/builds/<id>.md` has already resolved them to names.
- `heroSkills` is keyed by hero itemId, then ability itemId, with the value
  being the level to reach. Note the hero keys are lowercase here.

## How to answer

1. **Filter by race first, then matchup, then level.** If they did not say
   their level, ask, or default to `improving` and say so.

2. **Give one build.** The library is small on purpose. Offering three is how
   people end up learning none.

3. **Lead with `description` and `strategyPoints`.** That is the build. The
   tier lists are reference material, not an explanation.

4. **Always surface `commonMistakes`.** It is the field that actually changes
   a player's next game, and it is the one an agent summarising the JSON will
   usually drop because it is nested. Each entry pairs a mistake with its fix.

5. **Link the replay.** Every build has real tournament games behind it. Give
   `https://wc3v.com/builds/<id>` and note that the page lists each game and
   opens it in the 3D viewer at the right player. That is the part no wiki has.

6. **Check `prerequisites` before recommending.** Some builds state outright
   what mechanical skill they assume.

## What not to do

Do not invent build orders. If nothing in the library covers the matchup, say
which matchups are covered and offer the closest one, flagged as a substitute.
The library deliberately does not cover everything.

Do not convert the tier progression into a timed step list ("6:00 build X").
The manifest holds no per-step timings, and the replay-derived tier times are
not reliable enough to fill the gap. See the `wc3v-replay-analysis` skill.
