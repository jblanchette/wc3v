# WC3V Desktop

Watches your Warcraft III replay folders, parses each game locally the moment
it finishes, and drives an OBS-ready overlay. Public since 1.0.0 at
[wc3v.com/download](https://wc3v.com/download); `CHANGELOG.md` is the version
history.

The window is a feed of your games. You finish a match, alt-tab, and the read
is already done: did I win, what did they do, where did the game turn.
Clicking a moment opens it in the 3D viewer on wc3v.com at that second.

Every screen answers to one sentence. **Last game is the product. Coach is
Last game aggregated over time. Library is everybody else's last game. Stream
is any of them rendered for viewers.** One data model, four renderers. The tab
is called Home because the column also shows the game you are about to play
when W3Champions says there is one.

Home and Library mount the same report renderer (`js/game-report-view.js`);
`seat: null` selects the symmetric presentation with no "you". The numbers are
one shared module too: `client/js/GameMetrics.js` turns a stored summary and a
seat into scalars, so the window, the notification and the overlay cannot
disagree about how a game went. There is no module that writes a sentence
about how somebody played.

## Design invariants

Enforced in code, so the app can never be mistaken for a cheat and stays
auditable.

- Only ever **reads `.w3g` files the game already wrote**. No process injection, no memory reading, no packet inspection, no input automation. That is also why the overlay is safe on a live stream: it cannot leak a game in progress because it never sees one.
- **No live in-game state.** The replay written at match end is the only data source.
- **Your replays never leave this machine.** No upload, no account. The only thing sent is an anonymous usage count (event name, version, OS family), with an off switch in Settings.
- **Nothing dials out unless you switch it on.** The one socket the binary opens by itself is the overlay's loopback listener: 127.0.0.1 only, token-gated, GET only, read-only routes, all enforced in `overlay.rs`. The outbound exceptions are icon art and map data from `cdn.wc3v.com`, the usage count, and optional W3Champions lookups. `w3c.rs` refuses every request unless its opt-in marker file exists; the first-run screen proposes turning it on with the box checked and what it sends stated on the same screen.
- **No overlay drawn over the game.** Output is an OBS Browser Source and an ordinary window.
- **The webview gets no arbitrary-filesystem primitive.** `read_replay` and `read_map_file` canonicalise their argument and refuse anything outside a registered replay root or the local map cache. Store commands accept only a `<size>-<hash>` key of digits, hex and a dash.
- No accounts, no paywall. GPLv3, same as the parser.

## Architecture

There is **no parser in this app**. The browser parser bundle
(`client/js/vendor/wc3v-parser.bundle.js`) runs unmodified in a Web Worker
inside the Tauri webview, so there is one parser with one behaviour, verified
by `tools/verify-bundle-parity.js`.

```
Rust  ── discovery / folders / watching / scoped reads / hashing / parse store / overlay server
  │
  ├─ Tauri IPC ──► webview ── parser Web Worker ──► .wc3v
  │                   ▲  │             │
  │                   │  └ summaries ──┴──► profile / coach (ProfileAggregate)
  │                   └── map data ◄───┘   (the worker cannot reach IPC; the
  │                                         mapDataLoader bounces to main)
  ├─ 127.0.0.1 SSE ──► OBS Browser Source / player view (overlay/)
  └─ 127.0.0.1 ────► default browser ──postMessage──► wc3v.com viewer
```

The frontend is a coordinator (`js/app.js`) plus one module per concern:
`store` (parse store and corpus), `folders` (the replay folder tree),
`identity`, `games-view` (the feed), `library-view`, `profile-view`,
`stream-view`, `settings-view`, `first-run`, `replay-index` (content key to
file), `backfill`, `game-tags`, `overlay-state`, `w3c` and `scout`.
`js/ui-bits.js` holds the pieces both screens build out of, including the one
copy of the icon CDN base and its id whitelist.

### The stored summary

Each parsed game persists as one gzipped summary under
`<app_data>/replays/<size>-<xxh3>.summary.json.gz`, a few KB, keyed by
content. Full parses are not stored; the `.w3g` is the source of truth and a
report re-reads the game from disk when it opens. The corpus held in memory
is a projection (`store.slimForCorpus`, an allowlist), which is what keeps a
4,000-game history at 60 MB instead of 336; `tools/test-corpus-slim.js`
proves the projection answers every question the feed and Coach ask.

The shape is `client/js/SummaryBuild.js`, shared with the preview harness.
Beyond `SummaryExtract`'s per-player block it carries what exists only in a
full parse: `moments` (ranked, capped at 24), per-player `combat` (the
complete kill and death ledger; deriving counts from `moments` under-counts),
`dominance` and `resources` (time series from `lib/DominanceSeries.js` and
`lib/ResourceSeries.js`), per-player `build` (what `BuildOrderData` derives,
stored rather than re-derived because re-implementing that class is how the
two answers drift), and `mapInfo` (bounds, so camps and routes can be placed).

**Bump `SCHEMA_VERSION` before adding anything with that property.** A summary
written under an older schema cannot be upgraded in place. The app migrates
itself: when `store.staleCount` is non-zero after the corpus loads, `app.js`
runs the full backfill in the background under the `#migrate` strip, newest
first. The backfill skips on `store.isCurrent(key)` (stored AND current), not
on presence. A stale game renders the reason and a re-read button, never a
partial report. On any schema bump, check what somebody with an existing
corpus sees on first launch; both halves of this have shipped wrong before.

Two things a summary deliberately does not carry. **Tags** live in
`<app_data>/labels.json`, keyed by content key, because a re-parse rebuilds
the summary and a format upgrade must not eat the only thing a person typed.
**Which folder a game came from** lives in `<app_data>/sources.json` for the
same reason, and because a summary never carries a path.

## Replay folders

People sort replays into folders to label them. Every directory that directly
holds a `.w3g` file is a folder in the app, drawn as a tree under the root it
was found in: the game's own `Autosaved\Multiplayer` and `Autosaved\Custom`
next to whatever the person made. Each row can be switched off, renamed or
removed, on the first-run screen and again in Settings. `js/folders.js` draws
both; `src-tauri/src/folders.rs` owns the config and discovery.

What a person sees by default is one row per root with the total under it.
"Look inside" opens the root into its parts, listed flat: the files sitting
directly in the root as a row of their own ("In Replays itself") beside each
subfolder, labelled by its path below the root. Every row's switch is that
row's own files and nothing cascades; the root's switch is the sum
(indeterminate when mixed) and flips all of them. That is what makes "skip
the loose files, keep Autosaved › Multiplayer" two switches side by side.
"Newest 5" on a part lists its newest files as a table read off each
header (`folder_recent` for the listing, `peekPlayers` for players, map and
length), with a "Read these games now" button that runs the catch-up engine
over just those files (`backfill.start({ limit, only })`).

Nothing here touches the disk. A label is a label, off means the scanner
skips the files directly inside (subfolders keep their own switch, and the UI
cascades a switch downward), and remove means the app stops looking there.
Removed folders and hand-added roots persist in `<app_data>/folders.json`;
"Look again" in Settings restores every removal. Before this existed a folder
added by hand vanished on restart and was never watched.

A root is a directory the app may read under (`ensure_within` checks every
scoped read against the root list). A folder is a finer grain inside a root
that only decides what the scanner and watcher look at, so a game from a
folder that is off can still open in the viewer. Changing anything restarts
the watcher: `watcher::start` replaces the running loop rather than refusing
a second start.

Folder names never carry a path. A discovered root is "Replays" ("Replays 2"
for a second account); subfolders and manual roots take their directory
name, which is the label the person chose when they made it. The feed and
the Library filter by folder, and the report header shows the game's folder
beside its tags. Games parsed before `sources.json` existed are matched to
their files at boot by size, then hash (`resolve_sources`), the same trick
the scan uses.

Verified layout, because the obvious guess is wrong (there is no
`Documents\Warcraft III\Replays`):

```
Documents\Warcraft III\BattleNet\<accountId>\Replays\
  ├── *.w3g                  saved or downloaded
  └── Autosaved\
      ├── Custom\
      └── Multiplayer\       ladder, the bulk
```

`<accountId>` is per Battle.net account and there is usually more than one,
so all of `BattleNet\*` is enumerated. Dedupe is by content hash: a nested
duplicate tree exists in the wild and `LastReplay.w3g` is not byte-identical
to its autosave.

## The game report

Four tabs, three of them not this app's code. `client/js/MatchSummaryView.js`
draws Overview, Army and Economy, the same renderer the site's viewer mounts;
`js/summary-model.js` turns a stored summary into its model. Neither app
draws a tab of its own: if this app grows its own version of one, the two
products have begun telling different stories about one game. **Build** is
the exception, the per-player build cards and one interleaved build order.

The frame is one row (`.report-tabbar`): tabs left, Open in WC3V Viewer right,
nothing else fixed above the scroller. The Overview header leads the ov-band
beside the dominance plot; a team game drops the plot and the header leads.
The band is three cells: dominance, the result and its numbers, and the creep
routes on a fixed 176px map. Two things about it are load-bearing: a trailing
`1fr` row absorbs the map's surplus height in one place, and the route legend
goes two-column at four seats or more.

Rules found by walking every tab with a DOM auditor, each worth 40 to 200px of
nothing: nothing stretches to its neighbour (`align-items: start`); the unit
roster is a grid, not a wrapping flex; the tier bars are one grid; matrix
header icons sit above their label. Contested camps are read off
`claimState`, never re-derived from the two players' camp lists.

What differs from the viewer: colour is the warm race ramp, not player
colours (a summary carries none); dominance is the scrubbable panel, since a
finished game has nothing to spoil; the head-to-head parts drop out above two
seats.

## Charts

**Do not redraw a chart the viewer already has.** Dominance is the viewer's
own `DominanceChart`, styled by the viewer's own `dominance.css`, mounted by
`js/dominance-panel.js`, which owns no drawing code. Resources is not
`ResourceCharts`, deliberately: measured over 80 games its cumulative-loss
lines draw a flat floor for a quarter to half of every game, so
`js/economy-panel.js` draws the difference (trade balance around a zero line)
and food against the cap as a band, both from the shared `CompareCharts`
factory. Every mode trims its flat lead-in and labels the axis with the second
it starts, and anything mapping a pointer back to a time goes through the
drawn span, not the element width. `js/chart-panel.js` puts the modes behind
one set of chips; its `destroy()` releases every mode it built.

## Library, tags and casting

The Library lists games where no seat is yours, which covers a downloaded pro
replay, an observed game and a friend's replay without marking any of them.
With no identity set nothing is yours, so it shows empty and says why.
"Open a replay…" takes a file and registers its folder through the same
`add_root` as Settings, because `read_replay` refuses anything outside a
registered root and a "just read this path" command would hand the webview
the primitive it must not have.

Tags are free text, on purpose: a tournament schema would guess at how
somebody runs their event. Two commands, `read_tags` and `write_tags`, with
the store's key validation and a temp-file-and-rename write.

Casting is a second overlay page, `/cast`, with its own renderer and
stylesheet: an event line with a running score, a format badge, and a
symmetric stat bar with no deltas and no baselines, because every baseline
this app has is one person's history. The scoreboard is live state in
`localStorage`, never a record of a game. Both pages sit under the same token
gate, asserted explicitly in `overlay.rs`'s tests.

## First run

One panel, once, on a machine with no `setup-done` marker, four steps under
a rail (`js/first-run.js`): Welcome, Folders, You, History. There is no
Skip. Step 1 states what stays on the machine and needs the privacy policy
and terms box ticked; `accept_terms` writes the two pages' effective dates
to `<app_data>/terms-accepted`, and the Privacy Policy and Terms links open
in the browser through `open_site_page`, an allow-list of exactly those two.
Every other step has a working default and every control also lives in
Settings. Marker files rather than `localStorage`, because clearing the
webview's storage is a normal debugging move and should not put a setup
screen in front of somebody who has used the app for months.

Step 3 is `js/identity-picker.js`: the newest ten replays on disk are read
header-only (`peekPlayers`, which now carries each seat's race) and every
name in them is a card with its races (the town hall icons off the CDN) and
how many of those games it was in. A name in 80% or more of them and clear
of the second gets one big card, "Most likely you", put in place as an
unconfirmed guess, with the other names small under it. "None of these are
me" opens a search over every name the app has seen, where "jeef" finds
"Jeef#1496" (`IdentityPicker.matchNames`: exact, then the part before the
tag, then prefix, then anywhere). The same component sits in the "You"
popover in the app bar, so changing your mind later looks exactly like
choosing the first time. `tools/test-identity-picker.js` pins the folding
and the matching.

Step 4 is one choice: only new games from here on, or also read the
replays on disk in the background. A 500+ replay library adds the 1v1
filter, pre-checked.

## Opening a moment in the viewer

Browsers block a public page from reaching 127.0.0.1 (measured: a `fetch`
from wc3v.com to the loopback server hangs forever, an iframe aborts). So the
browser starts on the loopback origin, where reading the replay is
same-origin, and pushes it out to the site:

```
app ──open_in_viewer──► 127.0.0.1/open ──postMessage(bytes)──► wc3v.com/handoff
                        (handoff.html)                          parses locally → MyReplays
                                                                → viewer?local=<id>&at=<ms>
```

It costs one click, because `window.open` without a gesture is popup-blocked.
The site remembers the mapping, so a second moment from the same game skips
the handoff.

The overlay is authored as `overlay/shell.html`, `overlay.css` and
`overlay-render.js`, stitched into one document by `overlay.rs`, so the Stream
screen's preview renders from exactly what OBS loads. **Panel names are
permanent**: `shell.html` filters `modules=` against `ALL_MODULES`, and
renaming one blanks a panel in a scene somebody built months ago. The port is
fixed (`HOME_PORT`) and every port this install previously served is bound
too, so a URL already in OBS keeps working; `overlay_info` reports `orphaned`
for the one case where a re-copy is needed.

## The lifecycle

`js/match-phase.js` owns `idle | live | post` and is the only thing that may
change it. Two rules: **`unknown` is not `none`** (only the server answering
produces `none`, and only two consecutive `none`s take a live card down), and
**a finished match cannot come back** (the ladder keeps serving a match for
about 20 s after its replay lands, so `scout.dismiss(id)` refuses to re-latch
it). Idle is a one-way door: once anything has been seen the resting state is
`post`, holding the previous game. `node tools/lifecycle-sim.js` drives the
real `scout.js` and `match-phase.js` against a scripted tape on a fake clock,
and runs in `npm run desktop:test`.

## Running it

```sh
npm run desktop         # run it
npm run desktop:build   # produce the installer
npm run desktop:test    # profile assertions, backfill, lifecycle, Rust suite
```

One-time setup: Rust (MSVC toolchain on Windows) and `cargo install tauri-cli
--version "^2.0" --locked`. `cargo` is in `%USERPROFILE%\.cargo\bin` if a
fresh terminal cannot find it.

Run `npm run build:parser` first if you changed `lib/` or `helpers/`, or the
app silently uses the old parser. Both desktop scripts assemble `desktop/dist`
from `src-frontend/` and the committed parser bundle, and stage the ladder map
pool into the installer. **`desktop/dist/` is build output**; editing it loses
the edit.

Installed, the app lives in the tray; closing the window keeps it watching.
Only one copy runs at a time, and the lock does not distinguish a dev build
from an installed one: **quit the tray copy before `npm run desktop`**, or the
dev build exits and the installed window pops up instead.

## Iterating on the UI

`tools/desktop-preview.js` renders the real frontend against real summaries
from `client/replays/*.wc3v.gz` with a stubbed IPC bridge.

```sh
node tools/build-desktop-client.js && node tools/desktop-preview.js --games=40 --w3c
```

Open `desktop/preview/preview.html`. Flags: `--games=N`, `--me="Name#1234"`,
`--w3c` (fakes a live match), `--stale=N` (degrades summaries so the upgrade
paths are reachable), `--match=<substr>` (`--match=gso` is the one 3v3),
`--setup` (shows the first-run screen), `--out=NAME`, and `--mix=audit` (the
standing audit corpus). The harness stubs tags and the folder tree in memory,
so filters and the report chips have something to match.

The preview cannot parse, so `app.js` publishes `window.__WC3V_VIEWS__` there:
`gamesView`, `store`, `backfill`, `catchUpOnRecentGames`, `overlayState`,
`matchPhase`, `streamView`. `overlayState.previewState()` is what OBS is being
sent.

## The fold rule

**On the game report, `.report-body` is the only element allowed to scroll.**
Not the window, not `document.body`, not `.detail-col`. Checked mechanically
at **900x600** and **1280x820**, feed drawer open and closed:

```sh
node tools/desktop-preview.js --mix=audit --out=preview-mix.html --me="Jeef#1496"
node tools/report-shots.js --pages=preview-mix.html --audit-only
```

`report-shots.js` walks every game, every tab and every chart mode at both
sizes; a non-empty audit exits 1. Two `.detail-col`s exist since the Library
landed, so anything querying one must skip the hidden one
(`offsetParent === null`). Audit every game, not one: the frame changes shape
with whether you were in it, which chart modes have data, and whether the team
game path fires, and the team game is not in the default sample.

## Releasing

Users install from `wc3v.com/download` with one PowerShell line. That is the
only path the page hands out: a browser download picks up the Mark of the Web
and walks into SmartScreen, and cannot check the checksum.

**The version lives in `desktop/src-tauri/tauri.conf.json`.** `Cargo.toml`,
`Cargo.lock` and the CHANGELOG heading are copies, kept in step by
`node tools/version-check.js` (`--set=x.y.z` bumps all of them and stubs the
changelog, `--stamp-date` dates the heading, `--fix` pulls the copies back).
The build runs the check before it compiles.

```powershell
node tools/version-check.js --set=1.0.9
# write the CHANGELOG entry, then
node tools/version-check.js --stamp-date
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content "$env:USERPROFILE\.tauri\wc3v-updater.key" -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npm run desktop:build
node tools/deploy-desktop.js --dry-run --notes="..."
node tools/deploy-desktop.js --notes="What changed, plainly."
```

Pass the key's contents, not its path: `TAURI_SIGNING_PRIVATE_KEY_PATH` is
ignored by this version and yields an unsigned installer. Artifacts land in
`src-tauri/target/release/bundle/nsis/` as `WC3V_<version>_x64-setup.exe`
plus a `.sig`; both must exist. `deploy-desktop.js` refuses a missing `.sig`
or a version not newer than what is published, uploads the installer before
the manifest, fetches both back, and runs `version-check.js --release`, which
also reads the version out of the compiled binary. Everything lands in
`r2:wc3v-cdn/desktop/`, public at `https://cdn.wc3v.com/desktop/`, and
`latest.json` there is the release channel. Installers are never committed.

### Retiring a version, and asking for setup again

`latest.json` carries two optional fields the updater ignores and the app
reads at boot (`js/release-policy.js`, `release_policy` in `main.rs`):
`minimum`, the oldest version allowed to run, and `onboard_from`, the
version everyone set up before must redo setup on. `deploy-desktop.js
--require-update` sets `minimum` to the version being published and
`--reonboard` sets `onboard_from` to it; `--minimum=x.y.z` and
`--onboard-from=x.y.z` set either explicitly; with no flag both are carried
forward from the manifest already published, so an ordinary release keeps
the last policy.

Below `minimum` the app shows `#update-sheet` over everything: one button
that installs through the updater, then one that restarts. Set up before
`onboard_from` (the marker written by `mark_setup_done` carries the version
since 1.0.10; the old "1" reads as older than anything) and the first-run
screen comes back with the current settings in its boxes. Offline is no
policy: the fetch has a six-second timeout and a failure blocks nothing,
because a switch that bricked the app on a bad connection would be the wrong
kind. Builds before 1.0.10 never read the fields and cannot be forced; they
get the ordinary update offer. `tools/test-release-policy.js` pins the two
rules. `--must-update` and `--reonboard` on the preview harness show both
screens.

### There is no code signing

SignPath declined the project (Aug 2026). Paid signing would not silence
SmartScreen (EV lost instant trust in 2024) and the Microsoft Store would mean
submitting Blizzard-derived art to Microsoft, who own Blizzard. So
`client/install.ps1` is the answer: `Invoke-WebRequest` does not write the
Mark of the Web, and the script checks the installer against the `sha256` in
`latest.json` before running it. NSIS installs per-user with no UAC prompt.
Smart App Control still blocks unsigned binaries, and the download page says
so. The script is ASCII only: Windows PowerShell 5.1 reads a BOM-less file as
ANSI and one em dash broke it. `render.yaml` forces `text/plain` on it
because Render types `.ps1` as octet-stream.

## Traps that have already bitten this

- **Tauri runs sync commands on the main thread.** Make a slow one `async` and use `spawn_blocking`.
- **Tauri v2 does not expose `window.__TAURI__`** unless `withGlobalTauri` is true, and plugin commands need explicit capability grants.
- **Byte-returning commands use `tauri::ipc::Response`**, not `Vec<u8>`.
- **Editing an `include_str!`'d file while a build runs ships the old one.** `overlay.rs` compiles the handoff and overlay files into the binary.
- **Rebuild the parser bundle** after any `lib/` or `helpers/` change. `tools/verify-bundle-parity.js --fast` proves option passthrough.
- **`rclone copyto` to R2 needs `--s3-no-check-bucket`**, or an object-scoped token fails with "AccessDenied: CreateBucket".
- **Never enable reqwest's `gzip` feature.** The CDN stores `.json.gz` with `Content-Encoding: gzip`; a transparently decompressing client writes plain JSON under a `.gz` name.
- **`LastReplay.w3g` is not byte-identical to its autosave.** The watcher holds it for a 30 s grace window; the backfill filters it out.
- **`heroBuilds` carries Mirror Image illusions as extra level-1 heroes.** Go through `BuildCard.heroesOf`.
- **`itemPurchases` has no category.** Kept versus spent comes from `js/item-classes.js`, generated from `helpers/mappings.js` by `tools/build-item-classes.js`.
- **A grading constant that has not been run over the corpus is a guess.** Every first-pass threshold in the deleted `GameReport.js` was too eager in the same direction.
- **Anything borrowed from the viewer was drawn against the viewer's geometry.** `line-height: 1` alone reads as overflow to the fold audit.
- **Folder paths are compared as registered, not canonicalised.** The tree, the exclusion set and the scan all build from the same walk of the same root string; a `\\?\`-prefixed canonical path matches none of them.
