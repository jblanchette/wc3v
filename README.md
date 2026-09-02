# WC3V

A replay viewer, build library and coach for Warcraft III. Drop a `.w3g` and
watch the game on a 3D map with both build orders, or compare your game to
the closest pro replay and get graded.

**Live: [wc3v.com](https://wc3v.com).** Replays are parsed in your browser and never uploaded.

![Split-view 3D map with side-by-side build orders](marketing/hero.gif)

## Desktop app

A free Windows app that watches your replay folders and reads each game the
moment it finishes: result, dominance over time, build orders, economy, and
an OBS overlay for streamers. Nothing leaves your machine.

**Get it: [wc3v.com/download](https://wc3v.com/download).** One PowerShell line installs it and it updates itself.

**Source: [desktop/](desktop/).** A Rust and Tauri shell around the same parser
the website runs. [desktop/README.md](desktop/README.md) covers the
architecture, the design invariants, how to run it and how to cut a release.
[desktop/CHANGELOG.md](desktop/CHANGELOG.md) is the version history.

```sh
npm run desktop         # run it from source
npm run desktop:build   # build the installer
npm run desktop:test    # tests
```

## What it does

- **Replay viewer.** Reconstructs unit movement, construction, hero levels, research and fights from raw inputs, on a 3D heightmap with a supply-indexed build order timeline. Scrub, rewind, auto-camera.
- **Build library.** Curated competitive builds for every race and matchup, each backed by pro replays you can watch. Three framings: New to WC3, Ladder, Pro.
- **Compare to a pro.** Auto-matched by race, matchup and opener. Letter grades for macro, production, item economy and idle resources, with timestamped findings and overlaid curves.
- **Guided walkthrough.** A 12-step coached run of any replay, camera and all.

## Run it locally

Node.js 18 or newer.

```sh
# 1. put .w3g files in ./replays/
node wc3v.js --replay=happy-vs-grubby      # writes client/replays/happy-vs-grubby.wc3v.gz
node wc3v.js --replay=happy-vs-grubby --debug   # also keeps the uncompressed JSON

# 2. serve the client
cd client && npx http-server
```

The viewer needs game data extracted from your own copy of Warcraft III
(icons, unit balance, maps). See [Data setup](#data-setup). The parser works
without it.

Inspect parsed output from the terminal instead of opening the JSON, which
runs to a million lines:

```sh
node inspect-replay.js --replay=happy-vs-grubby --show=summary
node inspect-replay.js --replay=happy-vs-grubby --show=events --player=1 --filter=research
node inspect-replay.js --replay=happy-vs-grubby --show=units --search=Blademaster
```

Sections: `players`, `events`, `workers`, `units`, `tiers`, `expansions`, `camps`, `summary`, `all`.

## How it fits together

```
.w3g ──► wc3v.js (Node parser)
           w3gjs decodes actions; the engine simulates units, buildings,
           workers, research, expansions, creep camps; ReplayValidator
           and confidence scoring run after
        ──► .wc3v.gz (JSON)
        ──► client/ (browser: Three.js terrain, build order panel,
                     compare engine)  or  desktop/ (Tauri app)

tools/build-parser-bundle.js browserifies the same parser into
client/js/vendor/wc3v-parser.bundle.js. The site and the desktop app both
run that bundle; rebuild it after any change to lib/ or helpers/.
```

[docs/DESIGN.md](docs/DESIGN.md) explains unit registration, backfilling and
the simulation. [client/README.md](client/README.md) maps the browser
subsystems.

## Output format

A `.wc3v` file is JSON with four sections: `players` (events, units, tiers,
research, workers, APM), `world` (creep camps, item drops, battles), `replay`
(map, names, settings) and `validation` (only when something was wrong).

- Schema: [docs/wc3v-schema.json](docs/wc3v-schema.json)
- Example: [docs/wc3v-example.json](docs/wc3v-example.json) (trimmed) and [docs/happy-vs-grubby.wc3v.gz](docs/happy-vs-grubby.wc3v.gz) (complete)
- Replay format notes and the tracker-events proposal: [docs/REPLAY_FORMAT_RFC.md](docs/REPLAY_FORMAT_RFC.md)

## Data setup

Game data is not in this repository. Extract it from your own install with
[Ladik's CASC Viewer](http://www.zezula.net/en/casc/main.html) and drop it in
the gitignored paths below.

| Put it at | What | From |
|---|---|---|
| `slk/UnitBalance.slk` | unit balance | `war3.w3mod/units/unitbalance.slk` |
| `tools/upgrade-data/upgradedata.slk` | upgrades | `war3.w3mod/units/upgradedata.slk` |
| `tools/upgrade-data/{race}upgradefunc.txt` | per-race upgrade scripts | one per race |
| `client/assets/wc3icons/*.jpg` | unit, building, ability icons | [war3observer](https://github.com/warlockbrawl/war3observer), BLP to JPG |
| `mapdata/{Map}/` | map extracts | `tools/data-tool.js --source=<w3x folder> --version=v11` |

Then:

```sh
cd slk && node slk.js && cd ..
cp slk/UnitBalance.json helpers/UnitBalance.json
node tools/add-attack-types.js
node tools/parse-upgrade-data.js        # only if researchMeta.json needs regenerating
```

3D assets (terrain textures, building and unit models) come from the
`tools/convert-*.js` scripts and land under `client/assets/`. Without them
the terrain renders flat-shaded.

## Tools

The ones you reach for most. Every script prints usage with `--help` or in
its header comment.

| Tool | Does |
|---|---|
| `inspect-replay.js` | query a parsed replay from the terminal |
| `tools/order-trace.js` | per-action telemetry, including orders the simulator dropped |
| `tools/data-tool.js` | extract maps from `.w3x` |
| `tools/add-replay.js` | bring a pro replay into the library |
| `tools/reparse-builds.js` | re-parse every library replay after a parser change |
| `tools/build-parser-bundle.js` | rebuild the browser parser |
| `tools/page-audit.js` | assert a site page's layout in a real browser |
| `tools/desktop-preview.js` | render the desktop UI against real data without Tauri |

## Tests

```sh
node wc3v.js --test       # regression replays plus the library
npm run desktop:test      # desktop
```

## Credits

[w3gjs](https://github.com/PBug90/w3gjs) decodes replays.
[w3g_format.txt](https://github.com/scopatz/w3g/blob/master/w3g_format.txt) documents the format.
[war3observer](https://github.com/warlockbrawl/war3observer) extracts icons.
[Three.js](https://threejs.org), [D3](https://d3js.org) and [RBush](https://github.com/mourner/rbush) on the client.

## License

[GPLv3](LICENSE.md). Warcraft III and its assets are trademarks of Blizzard
Entertainment. WC3V is a fan-made, non-commercial tool, not affiliated with
or endorsed by Blizzard.
