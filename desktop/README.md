# WC3V Desktop

Watches your Warcraft III replay folders, parses each game locally the moment it
finishes, and (eventually) drives an OBS-ready overlay.

**Status: Phase 0 spike.** Discovery, scanning, watching and local parsing work.
The overlay, profile aggregation and coaching layers are not built yet.

## Design invariants

These are enforced in code, not just documented. They exist so the app can never
be mistaken for a cheat and stays trivially auditable.

- Only ever **reads `.w3g` files the game already wrote**. No process injection,
  no memory reading, no packet inspection, no input automation.
- **No live in-game state.** WC3 writes the replay at match end; that is the only
  data source that exists.
- **No outbound network calls at runtime.** Nothing in the Rust binary opens a
  socket. (Map data is fetched only when the user explicitly asks.)
- **No overlay drawn over the game.** Output is an OBS Browser Source and an
  ordinary window. Nothing is composited onto the game.
- **The webview gets no arbitrary-filesystem primitive.** `read_replay` and
  `read_map_file` canonicalise their argument and refuse anything outside a
  registered replay root or the local map cache.
- No accounts, no telemetry, no paywall. GPLv3, same as the parser.

## Architecture

There is **no parser in this app**. The existing browser parser bundle
(`client/js/vendor/wc3v-parser.bundle.js`) runs unmodified in a Web Worker
inside the Tauri webview — one parser, one behaviour, verified by
`tools/verify-bundle-parity.js`.

```
Rust  ── discovery / watching / scoped file reads / hashing
  │
  ├─ Tauri IPC ──► webview ── parser Web Worker ──► .wc3v
  │                   ▲                │
  │                   └── map data ────┘   (worker can't reach IPC, so the
  │                                         injectable mapDataLoader bounces
  │                                         the request to the main thread)
```

## Replay folder layout

Verified against a real install — the obvious guess is wrong. There is **no**
`Documents\Warcraft III\Replays`:

```
Documents\Warcraft III\BattleNet\<accountId>\Replays\
  ├── *.w3g                  manually saved / downloaded
  ├── my-games\
  └── Autosaved\
      ├── Custom\            custom games
      └── Multiplayer\       ladder + multiplayer  ← the bulk
```

`<accountId>` is per Battle.net account and there is usually more than one (`0`
holds offline/local games), so all of `BattleNet\*` is enumerated. Reforged
auto-saves every game as `Replay_YYYY_MM_DD_HHMM.w3g`, so nothing is lost by
default. Dedupe is by **content hash**, because a nested duplicate folder tree
exists in the wild and `LastReplay.w3g` is not byte-identical to its autosave.

## Building

Needs Rust (MSVC toolchain on Windows) and the Tauri CLI:

```sh
cargo install tauri-cli --version "^2.0" --locked
```

Then, from the repo root:

```sh
npm run build:parser                       # only if lib/ or helpers/ changed
node tools/build-desktop-client.js --seed-maps=all
cd desktop/src-tauri && cargo tauri dev
```

`build-desktop-client.js` assembles `desktop/dist` from `desktop/src-frontend`
plus the committed parser bundle. `--seed-maps` copies per-map parse data
(`wpm/doo/unit.json.gz` only — never the multi-megabyte `terrain.jpg`) into the
app's local map cache so parsing works offline. All 202 maps is 318.8 MB;
a single map is ~1.7 MB.

To build an installer: `cargo tauri build`.
