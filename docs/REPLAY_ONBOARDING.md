# Pro Tournament Replay Onboarding

How to add tournament replays to the curated pro replay library that backs the homepage build cards.

## Overview

Each entry in [client/data/builds-manifest.json](../client/data/builds-manifest.json) describes a build (race + hero opener + key units) and carries a `replays[]` list of pro games that demonstrate it. The homepage groups replays under their matching build cards, and the tournament filter is driven by [client/data/tournaments.json](../client/data/tournaments.json).

The manifest is the single source of truth. [helpers/utils.js](../helpers/utils.js) exposes `getManifestReplayIds()`, which is used by:

- `node wc3v.js --promaps` — batch-parse every manifest replay
- `node wc3v.js --test` — same plus regression maps
- `node tools/reparse-builds.js` — re-parse after parser changes

If a `.w3g.gz` is on disk but not in the manifest, it's an orphan. If it's in the manifest but missing on disk, the tooling will flag it.

## Acquiring replay packs

Source replays live in `./replays/` (raw `.w3g`). Parsed output goes to `./client/replays/` (compressed `.wc3v.gz`).

Where to find pro packs:

- **Back2Warcraft** — back2warcraft.com tournament pages and YouTube VOD descriptions usually link the pack
- **wcreplays.com** — search by tournament name
- **Liquipedia Warcraft** — match brackets often link individual replays
- **W3Champions** — ladder games (numeric `matchId_p1_p2_map.w3g` naming)
- **Dolphin / NetEase WGL / WPL** — tournament-specific sites for Chinese events

### Filename hygiene

`add-replay.js` warns on filenames containing spaces or characters outside `[a-zA-Z0-9_\-.]`. Rename before dropping in:

```bash
mv "./replays/B Cup S22 Final Game1.w3g" "./replays/bcup-s22-final-g1.w3g"
```

W3C replays follow `{matchId}_{player1}_{player2}_{mapname}.w3g` — they're already clean. Player names in filenames may differ from in-game tags (e.g. `moosangsung#1804` parses as `Sok`); the tool strips `#suffix` from manifest templates.

## The happy path

```bash
# 1. Drop .w3g files into ./replays/

# 2. Scan + parse + summarize new files in one shot
node tools/add-replay.js --all

# 3. Review printed summaries — manifest entry templates are pre-filled

# 4. Edit client/data/builds-manifest.json — paste templates into the matching
#    build's replays[] array, fill outcome + notes

# 5. Verify
node tools/add-replay.js --manifest-check
node tools/reparse-builds.js --dry-run
```

Step 2 prints map, players, races, matchup, heroes, tier timings, and event counts per replay, plus a JSON template ready to paste into the manifest.

## CLI reference — `tools/add-replay.js`

| Flag | Effect |
|---|---|
| `--scan` | List unprocessed `.w3g` files (sorted by mtime, newest first) |
| `--parse` | Parse all new replays |
| `--parse --replay=NAME` | Parse one replay by id (filename without `.w3g`) |
| `--summary` | Summarize parsed replays with manifest entry templates |
| `--summary --replay=NAME` | Summary for a single replay |
| `--all` | `--scan` + `--parse` + `--summary` |
| `--manifest-check` | Cross-reference manifest IDs vs files on disk |

Related tools:

- `node tools/reparse-builds.js [--dry-run] [--debug]` — re-parse every manifest replay (use after server-side parser changes so clients see updated data)
- `node inspect-replay.js --replay=NAME --show=summary` — inspect parsed replay data without opening the viewer
- `node wc3v.js --replay=NAME --debug` — keep the uncompressed `.wc3v` JSON alongside the `.gz` for parser dev

## Manifest structure

A build entry in [client/data/builds-manifest.json](../client/data/builds-manifest.json):

```json
{
  "id": "udo-dk-fast-fiend",
  "name": "DK Fiend Standard",
  "race": "U",
  "matchups": ["UvO", "UvH", "UvU"],
  "heroOpener": "Death Knight",
  "heroItemIds": ["udea", "ulic"],
  "keyUnits": ["ucry"],
  "tierProgression": { ... },
  "replays": [ ... ]
}
```

A replay entry inside `replays[]`:

```json
{
  "replayId": "1342775468_Kaho_Happy_Hammerfall",
  "playerSlot": "2",
  "playerName": "Happy",
  "opponentName": "Kaho",
  "map": "Hammerfall",
  "outcome": "win",
  "notes": "Clutch DK level 6 sustains the front line",
  "tournamentId": "dolphin-wsl-s2",
  "stage": "Quarterfinals",
  "round": "Game 1",
  "fingerprint": "Hammerfall|791|aurorahappy#2668,kaho#31819"
}
```

Required fields are filled by the template generator. You typically only edit `outcome`, `notes`, `tournamentId`, `stage`, and `round`. The `fingerprint` is generated and used for de-duplication; do not edit it by hand.

## Build matching guide

For each replay, find the build whose `race` + `heroItemIds` (hero opener) + `keyUnits` + `matchups` line up with what the player did. Match clues:

- Hero opener — the first hero trained tells you which build
- Key units — Fiends vs Ghouls, Riflemen vs Footmen, Bears vs Talons
- Matchup code — `UvO`, `HvN`, etc.

One replay typically maps to **two builds**: one entry per player's perspective. Add both, with `playerSlot` and `playerName`/`opponentName` reflecting that player's POV.

Cross-reference [client/data/replay-wishlist.json](../client/data/replay-wishlist.json) — it lists builds still waiting for replays and what to look for. **Remove a wishlist entry once the build it points to has at least one replay.**

## Adding a new tournament

Append a stub to [client/data/tournaments.json](../client/data/tournaments.json):

```json
{
  "id": "bcup-s22",
  "name": "B Cup Season 22",
  "shortName": "B Cup S22",
  "date": "2026-04-01",
  "endDate": "2026-04-15",
  "organizer": "Back2Warcraft",
  "tier": 2,
  "region": "EU",
  "mapPool": ["Autumn Leaves", "Hammerfall", "..."],
  "url": "https://back2warcraft.com/..."
}
```

Use the `id` as the `tournamentId` on each manifest replay entry. The homepage tournament filter reads this file directly.

## Known pitfalls

- **W3C / FLO replays don't emit action 0x10** — tier upgrades, training commands, and research arrive via different paths. Tier detection is patched in [lib/Player.js](../lib/Player.js) `selectSubgroup()`. Most W3C replays parse fine; some still crash early in `w3gjs` (known limitation).
- **Don't Read/Grep `.wc3v` files directly** — they're 1M+ lines of JSON. Use `node inspect-replay.js` instead.
- **Don't use `node -e` one-liners to parse replay JSON** — make a proper script under `tools/` if you need bespoke inspection.
- **Don't auto-start the dev server** to verify visually — the user runs the server locally; ask if you need it.
- **UD lumber is on ghouls, not workers** — when reading worker counts, sum `workers.onLumber + workers.ghoulsOnLumber` for Undead.

## Verification checklist

After adding replays:

- [ ] `node tools/add-replay.js --manifest-check` — no orphans, no missing files
- [ ] `node tools/reparse-builds.js --dry-run` — every replay listed with its source path
- [ ] `node inspect-replay.js --replay=NEW_ID --show=summary` — spot-check 2–3 new replays parse cleanly
- [ ] Open the homepage in the dev server and confirm new replays appear under the right build cards and the tournament filter

## Key files

| File | Role |
|---|---|
| [client/data/builds-manifest.json](../client/data/builds-manifest.json) | Source of truth: builds + replay references |
| [client/data/tournaments.json](../client/data/tournaments.json) | Tournament metadata for homepage filter |
| [client/data/replay-wishlist.json](../client/data/replay-wishlist.json) | Builds still needing replays |
| [tools/add-replay.js](../tools/add-replay.js) | Onboarding CLI: scan, parse, summary, manifest-check |
| [tools/reparse-builds.js](../tools/reparse-builds.js) | Batch re-parse every manifest replay |
| [helpers/utils.js](../helpers/utils.js) | `getManifestReplayIds()` — shared helper |
| [inspect-replay.js](../inspect-replay.js) | CLI to query parsed replay data |
