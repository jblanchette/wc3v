# WC3V Desktop

Watches your Warcraft III replay folders, parses each game locally the moment it
finishes, and drives an OBS-ready overlay.

**Status: functional.** Discovery, scanning, watching, local parsing, summary
persistence, the backfill engine, the profile and coach layer, the OBS overlay,
the games UI, the W3Champions Next game panel and the "open this moment in the
viewer" handoff are all built. A real game has been detected and parsed end to
end. No real OBS has rendered the overlay yet. See `ROADMAP.md`.

The window is a feed of your games. You finish a match, alt-tab, and the read is
already done: did I win, what did they do, where did the game turn. Clicking a
moment opens it in the 3D viewer on wc3v.com at that second.

Every screen answers to one sentence. **Last game is the product. Coach is Last
game aggregated over time. Stream is Last game rendered for viewers.** One data
model, three renderers. The tab is called Home, because the column also shows
the game you are about to play when W3Champions says there is one. The per-game read comes from one shared module
(`client/js/GameReport.js`), so the window, the post-game notification and the
OBS overlay can never word the same game differently.

## Design invariants

Enforced in code rather than documented. They exist so the app can never be
mistaken for a cheat and stays trivially auditable.

- Only ever **reads `.w3g` files the game already wrote**. No process injection,
  no memory reading, no packet inspection, no input automation. That is also why
  the OBS overlay is safe on a live stream: it cannot leak the state of a game in
  progress, because it never sees one.
- **No live in-game state.** WC3 writes the replay at match end, and that file is
  the only data source that exists.
- **Your replays never leave this machine.** No upload, no account, no telemetry.
  Not switchable, not configurable, absent.
- **Nothing dials out unless you switch it on.** The one socket the binary opens
  by itself is the overlay's loopback listener, on 127.0.0.1 only, token-gated,
  GET-only, with read-only routes. `overlay.rs` enforces all four properties. An
  OBS Browser Source is a separate Chromium process, and this is the only
  offline read-only bridge to it. "Open in the viewer" opens the user's browser
  and hands the replay over on loopback, with no upload and no server. Three
  outbound exceptions exist, all disclosed in Settings: build-order icon art and
  per-map parse data from `cdn.wc3v.com`, neither of which carries anything about
  you, and **optional W3Champions ladder lookups, off by default** (`w3c.rs`
  refuses every request unless its opt-in marker file exists, allows one host,
  sends GET only, and transmits nothing about your games).
- **No overlay drawn over the game.** Output is an OBS Browser Source and an
  ordinary window. Nothing is composited onto the game.
- **The webview gets no arbitrary-filesystem primitive.** `read_replay` and
  `read_map_file` canonicalise their argument and refuse anything outside a
  registered replay root or the local map cache. The parse store commands
  (`save_parse` and `read_parse`) accept only a `<size>-<hash>` key of digits,
  hex and a dash, so no path fragment can reach them.
- No accounts, no telemetry, no paywall. GPLv3, same as the parser.

## Architecture

There is **no parser in this app**. The existing browser parser bundle
(`client/js/vendor/wc3v-parser.bundle.js`) runs unmodified in a Web Worker inside
the Tauri webview, so there is one parser with one behaviour, verified by
`tools/verify-bundle-parity.js`.

```
Rust  ── discovery / watching / scoped reads / hashing / parse store / overlay server
  │
  ├─ Tauri IPC ──► webview ── parser Web Worker ──► .wc3v
  │                   ▲  │             │
  │                   │  └ summaries ──┴──► profile / coach (ProfileAggregate)
  │                   └── map data ◄───┘   (worker can't reach IPC, so the
  │                                         injectable mapDataLoader bounces
  │                                         the request to the main thread)
  ├─ 127.0.0.1 SSE ──► OBS Browser Source / player view (overlay/)
  │     (webview publishes state; the server only relays it)
  └─ 127.0.0.1 ────► default browser ──postMessage──► wc3v.com viewer
        (handoff.html; see "Opening a moment" below)
```

The frontend is a coordinator (`js/app.js`) plus one module per concern: `store`
(parse store and corpus), `identity`, `games-view` (feed and report),
`profile-view`, `stream-view`, `settings-view`, `replay-index` (content key to
file), `backfill`, `overlay-state`, `w3c` (ladder client) and `scout` (the live
match poller). The report's graphics come from `build-card`, a pure builder,
plus `dominance-panel` and `economy-panel`, which mount the viewer's OWN widgets
(`DominanceChart`, `ResourceCharts`) rather than redrawing them — see "Charts"
below — and `chart-panel`, which wraps those two plus a `CompareCharts` army
plot into one slot with three toggle chips.

Each parsed game persists as one gzipped summary under
`<app_data>/replays/<size>-<xxh3>.summary.json.gz`, single-digit KB per game,
keyed by content so the same game re-opened or found under a second path loads
from the store instead of re-parsing. Full parses are deliberately not stored.
The raw `.w3g` is the source of truth and full viewing re-parses on demand.

The summary is `SummaryExtract`'s per-player shape plus four things that have to
be extracted at parse time, because they exist only in a full parse.
**`moments`** is the ranked highlight reel, capped at 24. Per-player
**`combat`** is the complete hero kill and death ledger, wipes and biggest
trade, added in schema v3 — the review layer grades from it, and deriving one
from the other under-counts, so don't. Both come out of `world.battles`.
**`dominance`** and **`resources`**, schema v4, are the time series
`lib/DominanceSeries.js` and `lib/ResourceSeries.js` produce inside
`utils.buildOutputObject`; `client/js/SeriesExtract.js` packs them as parallel
arrays and unpacks them for rendering. Measured cost of v4:
**+1.7 KB gzipped per game**, about 26 MB for the whole 3,072-replay history
(`node tools/measure-summary-v4.js`).

**All four are extract-at-parse-time-or-never.** Bump `SCHEMA_VERSION` in
`store.js` before adding anything with that property, and make sure it is
current before the backfill runs.

## Charts

The report draws the viewer's **own** chart widgets, not lookalikes.
`DominanceChart` and `ResourceCharts` are the classes `client/viewer.html`
mounts, copied into `js/vendor` by `tools/build-desktop-client.js` and styled by
`client/css/dominance.css` — the same stylesheet the viewer loads, split out of
`main.css` for exactly this reason. `js/dominance-panel.js` and
`js/economy-panel.js` mount them from a stored summary and own no drawing code.
If either starts drawing a line, the mount seam has leaked and the two products
have begun telling different stories about the same game.

Both take data rather than a viewer: they take `setPlayers()` arrays and ignore
their constructor argument, so the desktop passes null. What the desktop added
to them is small and benefits both products: a published `GEOMETRY` so a pointer
position can be mapped back to a game time, `scoresAt(t)` so the numbers can be
shown beside the plot, and a compensating `scaleX` on the momentum dots so a
full-width chart draws circles instead of lozenges.

`js/chart-panel.js` is the third layer and owns no drawing either. It puts the
two panels and a `CompareCharts` army plot behind one set of toggle chips, so
the three readings of a game share a slot instead of a chart and a whole tab.
Each mode is built on first use and kept — rebuilding `DominanceChart` on every
chip click would churn its ResizeObserver — and the panel's `destroy()` releases
every mode it built, including the ones parked behind another chip. Whoever
mounts it calls that; in `games-view.js` it is `dropChart()` at the top of
`renderDetail`.

**`DominanceBar`, the tug-of-war gauge, is deliberately not shipped here.** It
sat in the report frame for one revision: 58px of chrome with its own chassis,
its own identity caps and its own impact-FX engine, all designed for a game
being watched live under a match header. In a finished-game report the only
thing it added over the plot was the pair of numbers, and those are a readout on
the chart's title row now, costing no height at all. The gauge's rules are still
in `dominance.css`, because that file is the viewer's and the viewer still
mounts it.

There is no playback here, so the chart draws the whole game and is
**scrubbable**: dragging it replays the momentum through the cursor and the
readout, and a double-click opens the viewer at that second.

## Opening a moment in the viewer

Clicking a moment opens the real 3D viewer on wc3v.com, seeked to that second
(`?local=<id>&at=<ms>`). The route it takes is not the obvious one, because the
obvious one is impossible.

**Browsers block a public page from reaching 127.0.0.1.** Measured against the
live loopback server from an `https://wc3v.com` tab: a `fetch` hangs pending and
never settles, an iframe ends in `net::ERR_ABORTED`. The site cannot pull the
replay from the app, and the app cannot embed the site to push it.

Instead the browser starts on the loopback origin, where reading the replay is
same-origin and unremarkable, and pushes it out to the site:

```
app  ──open_in_viewer──►  127.0.0.1/open   ──postMessage(bytes)──►  wc3v.com/handoff
     (stages bytes)       (handoff.html)    (private → public, no CORS needed)
                                                       │
                                       parses locally (UploadManager) → MyReplays
                                                       ▼
                                        wc3v.com/viewer?local=<id>&at=<ms>
```

It costs one click, because `window.open` without a user gesture is
popup-blocked. The site remembers the mapping, so opening a second moment from
the same game skips both the handoff and the re-parse.

The overlay is authored as three files (`overlay/shell.html`, `overlay.css`,
`overlay-render.js`) and stitched into one self-contained document by
`overlay.rs`. That split exists so the Stream screen's live preview renders from
the same css and renderer the Browser Source loads. A preview drawn by separate
code is a preview that can lie.

## Replay folder layout

Verified against a real install, because the obvious guess is wrong. There is
**no** `Documents\Warcraft III\Replays`:

```
Documents\Warcraft III\BattleNet\<accountId>\Replays\
  ├── *.w3g                  manually saved / downloaded
  ├── my-games\
  └── Autosaved\
      ├── Custom\            custom games
      └── Multiplayer\       ladder + multiplayer  ← the bulk
```

`<accountId>` is per Battle.net account and there is usually more than one, with
`0` holding offline and local games, so all of `BattleNet\*` gets enumerated.
Reforged auto-saves every game as `Replay_YYYY_MM_DD_HHMM.w3g`, so nothing is
lost by default. Dedupe is by content hash, because a nested duplicate folder
tree exists in the wild and `LastReplay.w3g` is not byte-identical to its
autosave.

## Running it

Users double-click an installer and never see a terminal. You, from the repo
root:

```sh
npm run desktop         # run it
npm run desktop:build   # produce the installer
npm run desktop:test    # profile assertions + Rust suite
```

One-time setup: Rust (MSVC toolchain on Windows) and `cargo install tauri-cli
--version "^2.0" --locked`. If a fresh terminal cannot find `cargo`, it is in
`%USERPROFILE%\.cargo\bin`.

Run `npm run build:parser` first if you changed `lib/` or `helpers/`, or the app
silently uses the old parser.

Both desktop scripts assemble `desktop/dist` from the frontend and the committed
parser bundle, and stage the ladder map pool into the installer, so a fresh
install parses ladder games offline with no extra steps. Cutting and shipping a
release, including how updates are signed and served, is in **`RELEASING.md`**.

Once installed, the app lives in the tray. Closing the window keeps it watching
for replays, and it can start with the OS.
