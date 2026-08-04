# WC3V Desktop

Watches your Warcraft III replay folders, parses each game locally the moment it
finishes, and (eventually) drives an OBS-ready overlay.

**Status: functional.** Discovery, scanning, watching, local parsing, summary
persistence, the backfill engine, the profile/coach layer, the OBS overlay, the
games UI and the "open this moment in the viewer" handoff are all built. A real
game has been detected and parsed end to end; a real OBS has not yet rendered
the overlay. See `ROADMAP.md`.

The window is **a feed of your games**. You finish a match, alt-tab, and the
read is already done: did I win, what did they do, and where did the game turn.
Clicking a moment opens it in the 3D viewer on wc3v.com at that second.

## Design invariants

These are enforced in code, not just documented. They exist so the app can never
be mistaken for a cheat and stays trivially auditable.

- Only ever **reads `.w3g` files the game already wrote**. No process injection,
  no memory reading, no packet inspection, no input automation.
- **No live in-game state.** WC3 writes the replay at match end; that is the only
  data source that exists.
- **No outbound network calls at runtime.** Nothing dials out. The one socket
  in the binary is the overlay's loopback **listener** — 127.0.0.1 only,
  token-gated, GET-only, read-only routes (`overlay.rs` enforces all four
  properties). OBS Browser Source is a separate Chromium process; this is the
  only offline, read-only bridge to it. "Open in the viewer" opens the user's
  browser and hands the replay over on loopback — the app itself still makes
  no outbound request, and nothing is uploaded to a server. (Map data is
  fetched only when the user explicitly asks.)
- **No overlay drawn over the game.** Output is an OBS Browser Source and an
  ordinary window. Nothing is composited onto the game.
- **The webview gets no arbitrary-filesystem primitive.** `read_replay` and
  `read_map_file` canonicalise their argument and refuse anything outside a
  registered replay root or the local map cache. The parse store commands
  (`save_parse` / `read_parse`) accept only a `<size>-<hash>` key — digits,
  hex and a dash — so no path fragment can ever reach them.
- No accounts, no telemetry, no paywall. GPLv3, same as the parser.

## Architecture

There is **no parser in this app**. The existing browser parser bundle
(`client/js/vendor/wc3v-parser.bundle.js`) runs unmodified in a Web Worker
inside the Tauri webview — one parser, one behaviour, verified by
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

The frontend is a coordinator (`js/app.js`) plus one module per concern:
`store` (parse store + corpus), `identity`, `games-view` (feed + detail),
`profile-view`, `stream-view`, `settings-view`, `replay-index` (content key →
file), `backfill`, `overlay-state`.

Each parsed game persists as one gzipped summary under
`<app_data>/replays/<size>-<xxh3>.summary.json.gz` — single-digit KB per game,
keyed by content so the same game re-opened (or found under a second path)
loads from the store instead of re-parsing. Full parses are deliberately not
stored; the raw `.w3g` is the source of truth and full viewing re-parses on
demand. The summary is `SummaryExtract`'s per-player shape plus **`moments`**
(`MomentsExtract`) — the ranked big beats of the game, which have to be
extracted at parse time because fights live in `world.battles` and that exists
only in a full parse.

## Opening a moment in the viewer

Clicking a moment opens the real 3D viewer on wc3v.com, seeked to that second
(`?local=<id>&at=<ms>`). The route it takes is not the obvious one, and the
obvious one is impossible:

**Browsers block a public page from reaching 127.0.0.1.** Measured against the
live loopback server from an `https://wc3v.com` tab: a `fetch` hangs pending
and never settles, an iframe ends in `net::ERR_ABORTED`. So the site cannot
pull the replay from the app, and the app cannot embed the site to push it.

Instead the browser **starts** on the loopback origin, where reading the replay
is same-origin and unremarkable, and pushes it out to the site:

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
`overlay.rs`. That split exists so the Stream screen's live preview renders
from the same css and renderer the Browser Source loads — a preview drawn by
separate code is a preview that can lie.

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

## Running it

**Users** double-click an installer and never see a terminal. **You**, from
the repo root:

```sh
npm run desktop         # run it
npm run desktop:build   # produce the installer
npm run desktop:test    # profile assertions + Rust suite
```

One-time: Rust (MSVC toolchain on Windows) and `cargo install tauri-cli
--version "^2.0" --locked`. If a fresh terminal cannot find `cargo`, it is in
`%USERPROFILE%\.cargo\bin`.

Run `npm run build:parser` first if you changed `lib/` or `helpers/` —
otherwise the app silently uses the old parser.

Both desktop scripts assemble `desktop/dist` (frontend + committed parser
bundle) and stage the ladder map pool into the installer, so a fresh install
parses ladder games offline with no extra steps. Cutting and shipping a
release, including how updates are signed and served: **`RELEASING.md`**.

Once installed, the app lives in the tray: closing the window keeps it
watching for replays, and it can start with the OS.
