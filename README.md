# WC3V

**W**ar**c**raft **3** Replay **V**iewer

Parse Warcraft III `.w3g` replay files into rich JSON data and view them as an interactive birds-eye replay in the browser.

![Happy vs Grubby showmatch on Concealed Hill](/wc3v-demo.gif)

## Features

- **Game Simulation** — reconstructs unit movement, building construction, and combat from raw player inputs
- **Build Order Timeline** — supply-indexed event timeline with tier snapshots, research tracking, and composition breakdowns
- **3 Layout Modes** — gameplay (animated map), static build order, and live build order synced to playback
- **Map Rendering** — tileset-aware terrain colors, neutral buildings, trees, and grid overlay for 80+ maps
- **Neutral Creep Camps** — camp claiming, XP attribution per hero, combat progression timelines, item drops
- **Worker Tracking** — race-specific mechanics (Orc peon consumption, NE wisp sacrifice, UD ghoul lumber, Human builders)
- **Hero Tracking** — levels, skill builds, inventory, revives, floating action text on the map
- **Research & Upgrades** — attack/defense/ability upgrades with icons, costs, and timing
- **Expansion Detection** — identifies town hall placements at new gold mines
- **Transport Tracking** — Zeppelin load/unload events
- **Parse Confidence** — quantified reliability score (0-1) indicating data quality per player
- **Replay Validation** — detects tier contradictions, missing supply buildings, and data inconsistencies
- **W3C / FLO Support** — handles W3Champions and FLO replay formats alongside standard Battle.net replays
- **Replay Upload** — upload `.w3g` files directly through the browser viewer
- **Curated Build Guides** — 20 build order guides with matchup filtering and tier progression breakdowns

## Quick Start

**Prerequisites:** [Node.js](https://nodejs.org/) 18+

### Parse a replay

```bash
node wc3v.js --replay=happy-vs-grubby
```

Place `.w3g` replay files in the `replays/` directory. The parser outputs compressed `.wc3v.gz` JSON to `client/replays/`.

### Debug mode

Keep the uncompressed `.wc3v` file alongside the `.gz` for inspection:

```bash
node wc3v.js --replay=happy-vs-grubby --debug
```

### Inspect parsed data

Query replay data from the command line without opening the viewer:

```bash
node inspect-replay.js --replay=happy-vs-grubby --show=summary
node inspect-replay.js --replay=happy-vs-grubby --show=events --player=1 --filter=research
node inspect-replay.js --replay=happy-vs-grubby --show=units --search=Blademaster
```

Available sections: `players`, `events`, `workers`, `units`, `tiers`, `expansions`, `summary`, `all`

### Run the viewer

```bash
cd client
npx http-server
```

Open the printed URL in your browser. To display WC3 icons, extract them from the game files using [war3observer](https://github.com/warlockbrawl/war3observer) and place them in `client/assets/wc3icons/`.

## Output Format (.wc3v)

The parser produces `.wc3v` files — JSON documents containing the full simulated game state:

| Section | Description |
|---------|-------------|
| `players` | Per-player data: event stream, unit list, tier/research streams, worker counts, APM, base grid |
| `world` | Neutral creep camps with claim state, XP distribution, and combat timelines |
| `replay` | Replay metadata: map name, player names, game settings, slot records |
| `validation` | Optional data quality warnings (tier mismatches, missing data) |

**Full schema:** [`docs/wc3v-schema.json`](docs/wc3v-schema.json) (JSON Schema draft 2020-12)

**Example output:** [`docs/happy-vs-grubby.w3g.wc3v`](docs/happy-vs-grubby.w3g.wc3v)

## Architecture

```
.w3g replay file
      |
      v
  wc3v.js (Node.js parser)
  - w3gjs decodes replay actions
  - Game engine simulates unit movement, building, combat
  - Post-processing: worker tracking, backfilling, validation
      |
      v
  .wc3v.gz (compressed JSON)
      |
      v
  Client viewer (browser)
  - D3.js v5 + Canvas + HTML/CSS
  - Coordinator pattern: Wc3vViewer delegates to subsystems
  - MapRenderer, BuildOrderRenderer, TimeScrubber, FloatingText
```

See [docs/DESIGN.md](docs/DESIGN.md) for a deep dive into replay parsing, unit tracking, and simulation mechanics.

## Tools

| Tool | Description |
|------|-------------|
| `inspect-replay.js` | Query parsed replay data from the CLI (events, units, workers, tiers) |
| `tools/data-tool.js` | Extract map terrain, trees, and neutral buildings from `.w3x` map files |
| `tools/add-replay.js` | Replay onboarding pipeline: scan, parse, generate summary, update manifest |
| `tools/regen-maps.js` | Regenerate map images from extracted map data |
| `tools/parse-upgrade-data.js` | Generate `researchMeta.json` from WC3 game data files |

## Testing

Run the parser against the test replay suite:

```bash
node wc3v.js --test
```

This parses all replays in `replays/` and verifies they produce valid output without fatal errors.

## Credits

Replay parsing powered by:
- [w3gjs](https://github.com/PBug90/w3gjs) — W3G replay file parser

Replay format documentation:
- [w3g_format.txt](https://github.com/scopatz/w3g/blob/master/w3g_format.txt)

Icon extraction:
- [war3observer](https://github.com/warlockbrawl/war3observer)

## License

[GNU General Public License v3.0](LICENSE.md)

---

All code, assets, names, and concepts are used for educational purposes only and have no commercial or retail usage. All copyright and trademark are respective to their original owners.

All software learned from public sources and from rightfully owned copies of the game. For educational use only.
