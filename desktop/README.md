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
game aggregated over time. Library is everybody else's last game. Stream is any
of them rendered for viewers.** One data model, four renderers. The tab is
called Home, because the column also shows the game you are about to play when
W3Champions says there is one.

The Library is a deliberate change to that sentence, which used to name three
screens. Watching and studying other people's replays is most of how this game
is consumed, and until that tab existed one of them opened a report that
apologised for itself: no result claimed, no comparison, and your build card
first even though neither seat was yours. Home and Library mount the SAME
renderer (`js/game-report-view.js`); passing `seat: null` selects its symmetric
presentation, where there is no "you" and the result is one player beating
another.

The numbers are one shared module too. `client/js/GameMetrics.js` turns a
stored summary and a seat into scalars, so the window, the post-game
notification and the OBS overlay cannot disagree about how a game went. There
is no module that writes a sentence about how somebody played; there used to be
(`GameReport.js`) and it was deleted.

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
  you, and **optional W3Champions ladder lookups** (`w3c.rs` refuses every
  request unless its opt-in marker file exists, allows one host, sends GET only,
  and transmits nothing about your games).

  The binary's default is still OFF, and that is what "default" means here: the
  marker file has to exist before a single request is made. The first-run screen
  PROPOSES turning it on, with the box checked and what it sends stated on the
  same screen, because an opt-in nobody is ever shown is an opt-in nobody gets.
  Skipping that screen writes no marker and lookups stay off. The checkbox goes
  through `set_w3c_enabled` like Settings does; it is not a second source of
  truth.
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
(parse store and corpus), `identity`, `games-view` (the feed), `library-view`
(everybody else's games), `profile-view`, `stream-view`, `settings-view`,
`first-run`, `replay-index` (content key to file), `backfill`, `game-tags`
(the tag sidecar), `overlay-state`, `w3c` (ladder client) and `scout` (the live
match poller).

**The report is `js/game-report-view.js`**, mounted by both Home and the
Library. It was ~490 lines inside `games-view.js`, which was right while one
screen could show a game. `render(host, summary, opts)` returns a handle whose
`destroy()` releases the chart, and `seat: null` selects its symmetric
presentation. `js/ui-bits.js` holds the pieces both screens build out of,
including the ONE copy of the icon CDN base and its id whitelist.

The report's graphics come from `build-card`, a pure builder, plus
`dominance-panel` and `economy-panel`, which mount the viewer's OWN widgets
(`DominanceChart`, `ResourceCharts`) rather than redrawing them — see "Charts"
below — and `chart-panel`, which wraps those two plus a `CompareCharts` army
plot into one slot with three toggle chips.

**Numbers come from `client/js/GameMetrics.js`**, which turns a stored summary
and a seat into scalars: dominance, hero kills, effective APM and the timings.
Everything that used to derive its own at the point of use reads it, which is
why "workers at 5:00" no longer has three implementations. Dominance is
TIME-weighted, because the stored series is not on a fixed grid and a plain
mean over its samples over-weights the seconds around every hero death.

**The stored-summary shape is `client/js/SummaryBuild.js`**, shared by
`store.js` and the preview harness, which used to carry a hand-copied duplicate
with the version number in only one of them.

Each parsed game persists as one gzipped summary under
`<app_data>/replays/<size>-<xxh3>.summary.json.gz`, single-digit KB per game,
keyed by content so the same game re-opened or found under a second path loads
from the store instead of re-parsing. Full parses are deliberately not stored.
The raw `.w3g` is the source of truth and full viewing re-parses on demand.

The summary is `SummaryExtract`'s per-player shape plus five things that have to
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

Per-player **`build`**, schema v5, is what `client/js/BuildOrderData.js` derives
from the event stream: per-tier production and the closing snapshot (supply,
workers, gold and lumber spent, upgrades, every unit made with its count and its
attack and armor types). Schema v5 also widens `neutralCamps` with claim state,
owner, route order, the creeps in each camp and per-hero XP.

**`build` is stored rather than re-derived, and that was the whole decision.**
The obvious alternative was a second extractor inside `SummaryExtract`. It is
wrong because `BuildOrderData.buildTierSnapshots` accumulates gold over the
class's OWN synthesised event list — tier upgrades with cost overrides, hero
training, worker assignment — not over the raw stream. Reimplementing that is
reimplementing the class, and the two answers diverge the first time either is
edited. So the class is dual-runtime (it guards `window.wc3v`, `PlayerNames` and
`RaceLabels`, and ships none of them) and runs at parse time. Measured cost of
v5: **+2.4 KB gzipped per game**, about 34 MB for the 3,072-replay history
(`node tools/measure-summary-v5.js`).

Three things `BuildOrderData` produces are deliberately dropped: `tiers` and
`snapshots`, by far the heaviest and only useful to the viewer's live panel,
which has the full parse in hand; and `production`, which is redundant with
`finalSnapshot.army`.

**All five are extract-at-parse-time-or-never.** Bump `SCHEMA_VERSION` in
`client/js/SummaryBuild.js` before adding anything with that property, and make
sure it is current before the backfill runs.

**A schema bump only reaches the history if the backfill can see it.** The
backfill skips a replay on `store.isCurrent(key)` — stored AND under the current
schema — not on `store.has(key)`. It used to skip on presence, which meant every
summary written before a bump stayed at the old version forever and the only way
to upgrade one was the per-game "Re-read" button. `store.staleCount` is how many
are behind.

Two things a summary deliberately does NOT carry. **Tags** live in a sidecar at
`<app_data>/labels.json`, keyed by the same content key, because a re-parse
rebuilds the summary and a schema bump re-parses everything: tags are the only
thing in the store a person typed and a format upgrade must not eat them. And
the **casting scoreboard** is live state in `localStorage`, not a record of a
game, because a series score needs ordered games and a running total that free
tags cannot express.

## The game report

Seven tabs. **Six of them are not this app's code.**

`client/js/MatchSummaryView.js` draws Overview, Army, Economy, Upgrades, Creeps
and Charts, and it is the same renderer the site's viewer mounts in its Match
Summary modal. It knows about neither app: it takes a model, an `icon(itemId)`
resolver and an `asset(file)` resolver, and returns DOM. `js/summary-model.js`
turns a stored summary into that model; `client/js/MatchSummary.js` does the
same job on the viewer's side from live parse objects.

Neither app draws a tab. This is the mount-seam rule from **Charts** below,
applied to a whole screen instead of one widget: if this app grows its own
version of a tab, the two products have begun telling different stories about
one game.

The seventh tab, **Build**, is the only one with no equivalent on the site: the
per-player build cards and the build order in the order it happened. Buildings
by tier and the upgrade/merc timeline used to live there and are gone, because
the Army, Upgrades and Economy tabs are those sections drawn from the same data.

What differs from the viewer, and why:

- **Colour is the warm race ramp, not in-game player colours.** The token layer
  forbids saturated colour on warm surfaces, and a stored summary has no
  player-colour field: schema v5 drops it rather than letting the two apps
  disagree. `colorOf` is injected, so neither app forks the renderer.
- **Dominance on Overview is the scrubbable panel**, not the viewer's static
  plot. The viewer draws it progressively because it has playback of its own; a
  finished game has nothing left to spoil, so here dragging replays the momentum
  and a double-click opens the viewer at that moment. This is why the chart
  panel's Dominance chip is gone — two dominance plots on one screen is a
  question about which of them is right.
- **The head-to-head parts drop out above two seats.** The Damage Matchup and
  the APM ghost line are about "the opponent", which is not a thing in a 2v2.
  Everything per-player still renders.

### A store behind the schema

A summary written under an older schema is missing blocks only a full parse can
produce, so it cannot be upgraded in place. Two rules, and the second is the one
that is easy to get wrong.

**The app migrates itself.** If `store.staleCount` is non-zero after the corpus
loads, `app.js` `startMigration()` runs the full backfill in the background,
newest first, reporting to the `#migrate` strip under the app bar. Nothing is
behind a button. The backfill engine needs no special mode for this: it already
walks every replay and skips whatever `store.isCurrent(key)` calls current, so a
run re-reads exactly the stale games.

**A stale game renders the reason and NOTHING else.** Not a partial report. The
old data is enough to draw build cards and a build order, and doing so produces
a screen that looks complete while silently omitting the unit roster, the creep
route, the upgrades and every chart — indistinguishable from a game where none
of that happened. `game-report-view.js` returns early on a null model: the
verdict band (none of which comes from the missing block) plus one line and a
re-read button.

Both of these were shipped wrong once. The boot catch-up was gated on an **empty**
corpus, so on a machine with history it never ran; the backfill skipped on
presence rather than freshness, so the Settings button would not have helped
either; and the re-read offer was a hint at the foot of a scroller. The result
was an update that looked like it had done nothing. **On any future schema bump,
check what somebody with an existing corpus sees on first launch.**

## Charts

The rule is **do not redraw a chart the viewer already has**. Dominance is the
viewer's own `DominanceChart`, copied into `js/vendor` by
`tools/build-desktop-client.js` and styled by `client/css/dominance.css` — the
same stylesheet the viewer loads, split out of `main.css` for exactly this
reason. `js/dominance-panel.js` mounts it from a stored summary and owns no
drawing code. If it starts drawing a line, the mount seam has leaked.

It takes data rather than a viewer: a `setPlayers()` array, ignoring the
constructor argument, so the desktop passes null. What the desktop added to it
is small and benefits both products: a published `GEOMETRY` so a pointer
position can be mapped back to a game time, `scoresAt(t)` so the numbers can be
shown beside the plot, a compensating `scaleX` on the momentum dots so a
full-width chart draws circles instead of lozenges, and `setStart()`.

**Resources is NOT the viewer's `ResourceCharts`, deliberately.** That class
stacks food, gold lost and lumber lost, one line per player each. Measured over
80 games (`node tools/analyse-resource-series.js`):

| series | flat head (median) | worst | the two lines differ by |
|---|---|---|---|
| food used | 1% | 4% | 9% |
| gold lost | 27% | 77% | 39% |
| lumber lost | 43% | 100% | 57% |

So gold lost draws a flat floor for a quarter of the game, lumber lost for
nearly half and sometimes for all of it, and food draws four lines (used and cap
per player) of which the two that matter trace each other. A cumulative loss
curve only ever climbs, and "who is winning the trades" is the gap between two
of them — the one thing a reader has to do arithmetic to get.

`js/economy-panel.js` draws the difference instead: **trade balance**, their
cumulative losses minus yours, filled back to a zero midline, plus **food**
against the cap as a band rather than a fourth line. Both come from
`CompareCharts`, the shared pure-SVG factory, which is where a derivation with
no viewer class to borrow belongs — the same reason Army has always been there.
`ResourceCharts` is no longer shipped to the desktop.

**Every mode trims its own flat lead-in** and labels the axis with the second it
actually starts, so a plot beginning at 9:40 never reads as a game that began
late. `CompareCharts.firstChangeMs()` finds it for the SVG factories;
`DominanceChart.firstMoveT()` for dominance, where the score eases out of an
even 50/50 over the engine's 150s early ramp. Anything mapping a pointer back to
a time must go through the drawn span, not the element width — the plot no
longer starts at 0:00 and it never started at the left edge.

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

## Library, tags and casting

**The Library** lists games where no seat is yours, which is the whole rule: it
covers a downloaded pro replay, a game you observed and a friend's replay you
were sent, without any of them needing to be marked. With no identity set,
nothing is yours, so the Library would be your entire history; it shows empty and
says why instead.

"Open a replay…" takes a FILE and registers the folder that holds it, then scans
that folder. Registering rather than reading directly is not a detail:
`read_replay` canonicalises its argument and refuses anything outside a
registered root, and that refusal is the reason the webview has no
arbitrary-filesystem primitive. A "just read this one path" command would hand it
one.

**Tags** are free text, deliberately. A schema for tournaments needs rounds,
brackets, formats and a series model, and every one of those is a guess about how
somebody runs their event. They live in `<app_data>/labels.json` keyed by content
key, edited from the report header and filtered on in the Library. Two Tauri
commands, `read_tags` and `write_tags`, with the same key validation the parse
store uses and the same temp-file-and-rename write.

**Casting is a second overlay page**, `/cast`, with its own renderer
(`overlay/cast-render.js`) and its own stylesheet. The player overlay is one
person's session said as "you", revealed after a game. A broadcast is two
strangers said as neither, held up for a whole series. Bending one into the other
would have meant a mode flag threaded through every module in
`overlay-render.js`, and every OBS source already pointed at that file.

It draws three things: an event line with the two players and a running score, a
free-text format badge, and a symmetric stat bar. The stat bar has **no deltas
and no baselines**, because every baseline this app has is built out of one
person's history and on a broadcast neither player is that person. The scoreboard
is live state typed in Stream → Casting, held in `localStorage` so it survives a
restart mid-series, and it is never a record of a game.

Both pages are under the same token gate and both are asserted so in
`overlay.rs`'s tests. The `every_overlay_route_requires_the_token` test passed
for the whole of the build that added `/cast` without ever looking at it, which
is why the assertion is now explicit.

## First run

One screen, once, on a machine with no `setup-done` marker: replay folder, your
player name, W3Champions, and read-my-history. Every row is skippable and every
control also lives in Settings, so nothing here is a decision anybody is stuck
with.

A marker FILE rather than `localStorage`, for the same reason the W3Champions
opt-in is one: clearing the webview's storage is a normal thing to do while
debugging and should not put a setup screen in front of somebody who has been
using the app for months. A failed marker write is logged rather than swallowed,
because the symptom is the screen coming back every launch.

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
the numeric ladder filenames first), and `--setup` (shows the first-run screen,
which otherwise only appears on a machine that has never run the app).

The harness stubs the tag sidecar in memory and seeds two tags, so the Library's
filter and the casting badge have something to match without typing first.

The preview cannot run a real parse, because there are no `.w3g` files behind
its summaries. Anything driven by a parse has to be driven by hand: set
`window.__WC3V_PREVIEW__` (the harness does) and `app.js` publishes
`window.__WC3V_VIEWS__` so the views are reachable from the console.

## The fold rule

**On the game report, `.report-body` is the only element allowed to scroll.**
Not the window, not `document.body`, not `.detail-col`. The verdict band above
it is fixed. This is the one invariant that has broken repeatedly and silently,
so it is checked mechanically rather than by eye, at **900x600** and
**1280x820**, with the feed drawer open and closed.

Since the Library landed there are **two** `.detail-col`s in the document, one
per screen, and only one of them is on screen at a time. Query them all and skip
the hidden one (`offsetParent === null`) rather than `querySelector`, or the
audit silently measures whichever comes first in the markup. That is also the
class of bug the Library shipped with for one build: a global
`.detail-col { grid-row: 3 }`, written for Home's three-row grid, put the
Library's report under its list instead of beside it. Placement rules are scoped
to `.view-games` now.

```js
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const bad = [];
  for (const row of document.querySelectorAll('.qn-chip')) {
    row.click(); await sleep(50);
    // Every tab, and inside Charts every chart mode.
    for (const tab of document.querySelectorAll('.ms-tabs .ms-tab')) {
      tab.click(); await sleep(50);
      const modes = [...document.querySelectorAll('.cp-seg .seg-btn')];
      for (const step of (modes.length ? modes : [null])) {
        if (step) { step.click(); await sleep(50); }
        const doc = document.documentElement;
        const cols = [...document.querySelectorAll('.detail-col')]
          .filter(c => c.offsetParent !== null);
        if (doc.scrollHeight > doc.clientHeight + 1) bad.push('page @' + tab.textContent);
        if (document.body.scrollHeight > document.body.clientHeight + 1) bad.push('body @' + tab.textContent);
        for (const col of cols) {
          if (col.scrollHeight > col.clientHeight + 1) bad.push('detail-col @' + tab.textContent);
        }
      }
    }
  }
  return [...new Set(bad)];
})()
```

Pass is `[]`. The inner loop covers every tab and, inside Charts, every chart
mode — which matters: Resources is the tallest by roughly 150px, and Creeps is
the tallest tab. Also worth a second sweep for clipped or overflowing elements
anywhere outside a `.scroll` container, since `overflow: hidden` hides a fold
bug just as effectively as a scrollbar shows one.

Note the audit drives `.ms-tabs .ms-tab`, not the old chart chips. A game the
shared renderer cannot draw (a summary stored before schema v5) has **no tab
strip at all** and shows the Build view alone, so `querySelectorAll` returning
nothing there is correct rather than a broken selector.

Games differ in ways that change the report's shape, so audit **every** game
rather than one: whether you were in it (no read line and no benchmark readout
if not), which chart modes have data, and whether the compact team-game path
fires.

The corpus is overwhelmingly 1v1 and the preview harness samples it in filename
order, so **the team-game path is not in the default sample**. Audit it
explicitly — `node tools/desktop-preview.js --games=1 --match=gso` is the one
3v3 in `client/replays`.

To drive any of this from a script, Chrome needs a debug port the MCP tools can
attach to, on its own profile so it does not fight a running browser:

```powershell
Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList `
  '--remote-debugging-port=9222', "--user-data-dir=$env:TEMP\wc3v-debug-profile", `
  '--no-first-run', 'about:blank'
```

Set the viewport with the emulation override rather than by resizing the window
— a window resize is clamped by the real display and silently gives you a
different size than the one you audited at.

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
- **`itemPurchases` has no category and never will**, because adding one is a
  schema bump plus a re-parse of every stored game. Whether an item is kept or
  spent comes from `js/item-classes.js`, generated out of `helpers/mappings.js`
  (`itemAbilityData.category`, with `dropTables.json` `class` as the fallback)
  by `tools/build-item-classes.js`. Re-run it and commit the output after any
  change to either source; an id it does not list counts as kept.
- **A grading constant that has not been run over the corpus is a guess.** Every
  first-pass threshold in the old `GameReport.js` was too eager in the same
  direction, and that whole module is gone now: see the 0.8.0 changelog for why
  a per-race average of dominance or APM is not a benchmark either.
  The unit test asserts shape and will pass with meaningless labels.
- **Anything borrowed from the viewer was drawn against the viewer's geometry.**
  Squeezing a chart to fit here has clipped it before, and `line-height: 1`
  alone reads as overflow to the fold audit.
- **`cargo` is not on PATH in fresh shells.** It is in `%USERPROFILE%\.cargo\bin`.
