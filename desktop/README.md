# WC3V Desktop

Watches your Warcraft III replay folders, parses each game locally the moment it
finishes, and drives an OBS-ready overlay.

**Status: functional, and not launched.** Discovery, scanning, watching, local
parsing, summary persistence, the backfill engine, the profile and coach layer,
the OBS overlay, the games UI, the W3Champions Next game panel and the "open
this moment in the viewer" handoff are all built. A real game has been detected
and parsed end to end. No real OBS has rendered the overlay yet.

**Nothing about this app is public until 1.0.0.** Builds are published to R2 so
the one existing install can update itself, which is dogfooding rather than
shipping. `client/download.html` is written but deliberately not deployed, and
nothing on the site links to it. See "Releasing" below. Version history is in
`CHANGELOG.md`.

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
install parses ladder games offline with no extra steps.

Once installed, the app lives in the tray. Closing the window keeps it watching
for replays, and it can start with the OS.

**`desktop/src-frontend/` is the source. `desktop/dist/` is build output** and is
wiped and regenerated by `tools/build-desktop-client.js` on every run. Editing
`dist` loses the edit.

## Iterating on the UI

`tools/desktop-preview.js` renders the real frontend against real summaries
built from `client/replays/*.wc3v.gz`, with a stubbed Tauri IPC bridge. It is
how the UI gets worked on without launching Tauri.

```sh
node tools/build-desktop-client.js && node tools/desktop-preview.js --games=40 --w3c
```

Then open `desktop/preview/preview.html`. Flags: `--games=N`, `--me="Name#1234"`,
`--w3c` (fakes a live match so Next game renders), `--stale=N` (degrades the
first N summaries so the schema-upgrade paths are reachable), `--match=<substr>`
(pins the sample to particular replays — `--match=gso` is a 3v3, which is the
only way to reach a team game, since the corpus is overwhelmingly 1v1 and sorts
the numeric ladder filenames first).

The preview cannot run a real parse, because there are no `.w3g` files behind
its summaries. Anything driven by a parse has to be driven by hand: set
`window.__WC3V_PREVIEW__` (the harness does) and `app.js` publishes
`window.__WC3V_VIEWS__` so the views are reachable from the console.

## The fold rule

**On the game report, `.report-body` is the only element allowed to scroll.**
Not the window, not `document.body`, not `.detail-col`. The verdict band above
it is fixed. This is the one invariant that has broken repeatedly and silently,
so it is checked mechanically rather than by eye, at **900x600** and
**1280x820**, with the feed drawer open and closed:

```js
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const bad = [];
  for (const row of document.querySelectorAll('#feed .game')) {
    row.click(); await sleep(25);
    const doc = document.documentElement;
    const col = document.querySelector('.detail-col');
    if (doc.scrollHeight > doc.clientHeight + 1) bad.push('page scrolls');
    if (document.body.scrollHeight > document.body.clientHeight + 1) bad.push('body scrolls');
    if (col.scrollHeight > col.clientHeight + 1) bad.push('detail-col scrolls');
  }
  return [...new Set(bad)];
})()
```

Pass is `[]`. Run it once per chart mode as well: Resources is the tallest of
the three by roughly 150px. Also worth a second sweep for clipped or overflowing
elements anywhere outside a `.scroll` container, since `overflow: hidden` hides a
fold bug just as effectively as a scrollbar shows one.

Games differ in ways that change the report's shape, so audit **every** game
rather than one: whether you were in it (no read line and no benchmark readout
if not), which chart modes have data, and whether the compact team-game path
fires.

## Releasing

Users double-click an installer. There is no other distribution channel, and
until 1.0.0 there is no public one at all.

**The version lives in `desktop/src-tauri/tauri.conf.json` and nowhere else.**
The installer, the binary and the update manifest all read it. It must be
strictly greater than the last published version or no client is offered the
update. `src-tauri/Cargo.toml` carries a stale version that nothing reads.

```powershell
# 1. bump tauri.conf.json, then:
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content "$env:USERPROFILE\.tauri\wc3v-updater.key" -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npm run desktop:build
```

**Pass the key's contents, not its path.** `TAURI_SIGNING_PRIVATE_KEY_PATH` is
advertised in the CLI's help and is ignored by this version: the build runs to
completion, produces an unsigned installer, then fails with "A public key has
been found, but no private key". Artifacts land in
`src-tauri/target/release/bundle/nsis/` as `WC3V_<version>_x64-setup.exe` and a
`.sig` beside it. **Both must exist**, or the build cannot be served as an
update.

```sh
node tools/deploy-desktop.js --dry-run --notes="..."   # look first
node tools/deploy-desktop.js --notes="What changed, plainly."
```

The script reads the version from `tauri.conf.json`, refuses a missing `.sig`,
refuses a version that is not newer than what is published, uploads the
installer before the manifest so clients are never pointed at a 404, and fetches
both back to confirm. It needs `rclone` with an `r2:` remote.

**Installers are never committed.** 15 MB of binary does not belong in an
open-source history, and this script is the only path from a build to the CDN.

Everything lands in `r2:wc3v-cdn/desktop/`, public at
`https://cdn.wc3v.com/desktop/`, which is the endpoint in `tauri.conf.json`
under `plugins.updater.endpoints`. **Every build currently publishes to
`desktop/latest.json`, which is *the* release channel.** That is harmless while
there is one install on it. The moment anyone else has the app, split it: a
`desktop/dev/latest.json` with the app's endpoint pointed there until 1.0.0.

## Traps that have already bitten this

- **Tauri runs sync commands on the main thread.** A slow one freezes the
  window. Make it `async` and use `spawn_blocking`.
- **Tauri v2 does not expose `window.__TAURI__`** unless `withGlobalTauri` is
  true, and core plugin commands need explicit capability grants.
- **Byte-returning commands use `tauri::ipc::Response`**, not `Vec<u8>`, which
  would serialise as a JSON array of numbers.
- **Editing an `include_str!`'d file while a build runs ships the OLD one.**
  `overlay.rs` compiles `handoff.html`, `shell.html`, `overlay.css` and
  `overlay-render.js` into the binary.
- **Rebuild the parser bundle** after any `lib/` or `helpers/` change
  (`npm run build:parser`), or the app silently uses the old parser.
  `parserEntry.js` has silently dropped unknown parser options before;
  `tools/verify-bundle-parity.js --fast` proves the passthrough.
- **`rclone copyto` to R2 needs `--s3-no-check-bucket`.** Without it rclone
  probes for the bucket, falls back to `CreateBucket`, and an object-scoped token
  denies it — printing "AccessDenied: CreateBucket", which reads as a
  credentials problem.
- **Never enable reqwest's `gzip` feature** (or `deflate`, `brotli`, `zstd`).
  The CDN stores `.json.gz` with `Content-Encoding: gzip`, so a transparently
  decompressing client hands back plain JSON, which gets written under a `.gz`
  name and fails to inflate later. The bytes off the wire are the file.
- **`LastReplay.w3g` is not byte-identical to its autosave**, and no autosave
  even shares its size, so content-hash dedupe can never collapse the pair. The
  watcher holds it for a 30 s grace window instead, and the backfill filters it
  out of the queue entirely.
- **`moments` is capped at 24 by importance; the `combat` ledger is not.**
  Deriving kill and death counts from `moments` under-counts any busy game, and
  at most one moment is emitted per battle. Read `players[slot].combat` for
  counts and `moments` for the highlight reel.
- **`heroBuilds` carries Mirror Image illusions as extra level-1 heroes** with
  the real hero's own itemId, so a raw read draws four Blademasters. Always go
  through `BuildCard.heroesOf`. `t2Units`/`t3Units` likewise include a hero
  trained inside that tier, which is why `BuildCard.keyUnits` filters them.
- **A grading constant that has not been run over the corpus is a guess.** Every
  first-pass threshold in `GameReport.js` was too eager in the same direction.
  The unit test asserts shape and will pass with meaningless labels.
- **Anything borrowed from the viewer was drawn against the viewer's geometry.**
  Squeezing a chart to fit here has clipped it before, and `line-height: 1`
  alone reads as overflow to the fold audit.
- **`cargo` is not on PATH in fresh shells.** It is in `%USERPROFILE%\.cargo\bin`.
