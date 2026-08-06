# WC3V Desktop: status and remaining work

Handoff document. Written Aug 2026, after Phase 0.

**Read `desktop/README.md` first** for the design invariants and architecture.
They are not optional, and several are the whole reason the project is viable.
`desktop/RELEASING.md` covers building, shipping and updating.
`desktop/TESTING.md` is the manual pass: every check only a human can do, in the
order that wastes the least time. Its results belong back in this file.

Run it with `npm run desktop`. Build an installer with `npm run desktop:build`.

---

## Honest status

**The core premise is proven.** On 3 Aug 2026 a real 1v1 was played with the app
open. It was detected, parsed, stored and pushed to the overlay without anyone
touching anything, and a real browser rendered the verdict live. That was the one
thing this whole project rested on.

Still unmet by reality: no OBS has rendered the overlay, and CEF transparency
specifically is the unknown. No upgrade has been taken. The backfill has never
run to completion, so the real parse rate is still unmeasured.

**An update can now actually be published.** 0.2.0 is live at
`https://cdn.wc3v.com/desktop/latest.json` and the endpoint no longer points at
`wc3v.net`, which does not resolve at all, so every update check used to be a DNS
failure. That was worse than this document previously recorded. 0.3.0 is the
first build that can be taken as an upgrade by an install in the field, which is
what finally makes checklist item 3 walkable.

**The UI is no longer the spike.** §5 is built: the window is a feed of your
games with a report per game covering the verdict, timings, key moments,
head-to-head and both build orders, and folders, backfill and the log have moved
to Settings and a collapsible Activity drawer. §4 gained selectable panels, an
in-window preview and a test game. §12 gained Next game. What has not
happened is a full pass through the real app. Everything below was verified
against real replay data in `tools/desktop-preview.js`, which stubs Tauri IPC but
runs the app's own modules, CSS and renderers unmodified.

### What is verified, and how

| Thing | Evidence |
|---|---|
| Parser runs unmodified in WebView2 | parsed a real 475 KB replay in 12.3 s in the app window |
| Replay discovery | found 4,875 files across 2 Battle.net account folders |
| Dedupe | 4,875 → 4,127 unique; the 748 were the nested duplicate tree + `LastReplay.w3g` |
| Scan performance | 230 ms to list on screen, 162 ms warm repeat (`cargo test --release -- --ignored --nocapture`) |
| Watcher mechanics | 7 tests in `watcher.rs` drive the real loop against simulated progressive writes: debounce, content dedupe, stale-cache invalidation, all three `LastReplay.w3g` orderings |
| `LastReplay.w3g` differs from its autosave | checked against the real corpus: no autosave even *shares its size*, so content-hash dedupe can never collapse it. The watcher holds it for a 30 s grace window instead |
| Parse persistence | summaries stored per content key, re-opened games load from store instead of re-parsing |
| Profile aggregation | `node tools/test-profile-aggregate.js`: records from both seats, matchup buckets, timing splits, statement min-n guards |
| Overlay server | `overlay::tests`: token required on every route, GET-only, SSE delivers published state to an already-connected client |
| Overlay in a real browser | a connected Chrome tab updated to the correct verdict and build order with no refresh, via EventSource auto-reconnect, after the app restarted under it |
| Identity detection | `node tools/detect-identity.js` on the reference 3,598-replay folder: owner in 100% of 40 sampled, runner-up 68% |
| Parser determinism | `tools/check-determinism.js`: 0 differing leaves over N runs |
| Bundle matches source | `tools/verify-bundle-parity.js`: 0 shapes unique to the bundle |
| Parser speedups are safe | `tools/diff-wc3v.js --events`: no build-order/tier/economy event changed |
| Key moments are real moments | `node tools/moments-report.js --replay=NAME` over several pro games. The ranked list matches the actual shape of each game: hero snipes, the wipe that ended it, the expansion |
| Moments fit the summary budget | 1.2–3.8 KB of raw JSON per game, well under a KB gzipped |
| The UI renders against real data | `tools/desktop-preview.js` builds summaries from `client/replays/*.wc3v.gz` and runs the app's real modules in a browser. Feed, report, moments, profile, settings and the overlay preview all render with zero console errors |
| **Browsers block wc3v.com → 127.0.0.1** | measured against the live loopback server from an `https://wc3v.com` tab: `fetch` hangs pending and never settles, an iframe ends `net::ERR_ABORTED`. This is why the handoff starts on the loopback origin (§10) |
| Overlay stays self-contained after the split | `overlay::tests::overlay_page_has_its_css_and_renderer_inlined`: placeholders replaced, no external `<script src>` or `<link>` |
| Handoff routes are safe | `overlay::tests`: token required, bytes served verbatim, unknown ids 404, pending replays capped |
| The site half of the handoff is deployed | `https://wc3v.com/handoff` returns 200 and serves the launcher page (shipped in `1f9c308`) |
| Map data is publicly reachable | `https://cdn.wc3v.com/maps/EchoIsles/wpm.json.gz` returns 200, which is what unblocked §7 |
| Feed filters | driven in the preview against 12 real games: text → 2/12, Orc → 9/12, Wins → 4/12 with every tile reading `win` |
| Trend guards refuse thin windows | `tools/test-profile-aggregate.js`: a 22-game corpus, ample overall with 2 games at one end, produces no trend statement |
| Toast wording | `overlayState.toastFor` run over real stored summaries: "Victory vs orange#14823 / Springtime · 17:20 · all time 2–0 / 16:07 You killed 2 heroes" |
| An update can actually be published | `tools/deploy-desktop.js` uploaded 0.2.0 to R2 and fetched the manifest and installer back |
| W3Champions path allowlist | `w3c::tests`, 4 tests: scheme-relative paths, `..`, backslashes, control characters and absurd lengths are all refused before a socket opens |
| Next game renders and reads the local book | `tools/desktop-preview.js --w3c` fakes an ongoing match against a real opponent from the sample. The panel drew "1877 MMR · #138 · +73 on you", a 3–1 head-to-head, an opener bar chart, tier 2 at 2:46 against your own 2:42, and the full list of games against them |

### What has NEVER been tested

- **The watcher firing on a real game.** Its mechanics are under test with
  simulated writes (see checklist 0), and no game has been played with the app
  open. The whole premise, "finish a game, it just appears", is unverified until
  that happens. In particular, whether 1.5 s `SETTLE` and the 30 s
  `LAST_REPLAY_GRACE` match how the real game writes.
- Anything on Linux or SteamOS. Never compiled or run there. WebKitGTK is a
  different engine from WebView2 and is the single biggest portability unknown.
- Any behaviour over a long session, across sleep/wake, or with the game running.
- **The overlay inside a real OBS.** The server and SSE flow are tested over raw
  sockets, and no OBS Browser Source has ever rendered the page.
- **The rebuilt UI inside the real app window.** Every screen has been driven in
  a browser against real replay summaries, never once through Tauri itself.
- **The undecorated window.** `decorations: false` is the one part of the brand
  pass a browser preview cannot check. What needs looking at is Aero Snap, the
  resize border and drag from the app bar. If any of those are broken, the
  fallback is to put `decorations` back and drop the app's own bar. Decide by
  testing rather than by argument.
- **The post-game toast against a real game.** The wording was checked against
  real stored summaries. No Windows notification has actually been raised.
- **The viewer handoff end to end** (§10). Both halves exist and each was checked
  alone. The joined-up path needs the site deployed and the app rebuilt. The site
  half is live and returns 200 at `https://wc3v.com/handoff`.
- **Next game against a real W3Champions queue** (§12). The panel, the poll
  loop and the local book have only run against a stubbed match. Nobody has
  confirmed that `ongoing/{battleTag}` populates early enough in a real queue to
  be worth looking at during the loading screen.

---

## What this app is, in one sentence

**Last game is the product. Coach is Last game aggregated over time. Stream is
Last game rendered for viewers.** One data model, three renderers.

This sentence exists because the app had three co-equal tabs serving three
different audiences, which reads as three apps sharing a window. It is also the
lesson every comparable tool teaches the hard way. Sc2gears' own postmortem lists
"so many features that many users didn't understand" as a cause of death, and
Blitz's 2026 reviews say expanding scope made the core feel deprioritised.
**Anything that does not answer to that sentence does not go in.**

The three questions (§5) still hold. They are what the sentence is made of. What
changed is that they are no longer three independent products.

### What the field does, and what we took from it (Aug 2026)

Surveyed: W3Champions and W3Booster, Hearthstone Deck Tracker and HSReplay,
Porofessor, Blitz, OP.GG, Mobalytics, Tracker.gg and Overwolf, CaptureAge, the
AoE2 and SC2 replay ecosystems (SC2ReplayStats, Spawning Tool, the dead
Sc2gears), chess.com and Lichess Game Review, ballchasing.com, SCCT,
LeagueBroadcast, AoE4World's overlay, FACEIT and Tapit widgets, and the
WC3-specific tools (WC3AI, wc3stats, war3observer, WC3StreamerOverlay).

**Adopted, and why:**

- **The post-game report is a narrated review rather than a dashboard**
  (chess.com). A verdict, five named grades, and the two or three things to
  actually fix, each seekable in the viewer. Built: `client/js/GameReport.js`.
- **Benchmark against yourself first** (Blitz), and the bracket above you later.
  SC2ReplayStats' Training Center is the single most-cited reason people paid for
  it. Built: `ProfileAggregate.baseline()`, rolling last-20 same-matchup medians.
- **Calibrate the labels against real data** (chess.com retuned "Blunder" because
  a label that fires constantly stops meaning anything). Done: the first
  thresholds fired "you lost the big fight" on 31% of seats over the 334-game
  corpus, which is near-tautological, since somebody loses every decisive fight.
  See "Calibrating the review" below.
- **Many small single-purpose overlay panels, each with its own URL.** SCCT ships
  8, Tapit ships 10, and streamers compose two or three. Built: per-panel Copy
  URL with a suggested source size.
- **The post-game reveal** (SC2ReplayStats), fixing its top complaint by making
  the hold configurable, and **showing the last game on first load** so the
  source can be positioned without playing a match (AoE4World).
- **Say the OBS gotchas in the UI rather than the docs.** "Shutdown source when
  not visible" must be OFF or the live connection dies with the scene.
- **Post-game is a feature.** LeagueBroadcast was killed by Vanguard,
  war3observer's own advice is "restart both programs", and WC3StreamerOverlay
  needs a packet sniffer. We read a file the game already wrote, so there is no
  anti-cheat surface, and nothing on screen can help anyone snipe a live game.
  That sentence is in the Stream tab.
- **Pre-game opponent scouting from a public ladder API** (Porofessor's whole
  hook, and the one thing W3Champions makes possible without touching the game).
  Built: §12.

**Deliberately not adopted:**

- **Live in-game telemetry**, meaning hero levels, items and resources of the
  running game. That is W3Booster's lane, it needs memory reading, and it is the
  exact fragility every dead tool in this survey died of.
- **Nightbot `$(urlfetch)` commands.** Nightbot fetches server-side and cannot
  reach 127.0.0.1. Site-side or nothing.
- **Twitch predictions, a Discord bot, a Twitch extension.** All need OAuth or a
  server. Not desktop work.
- **LAN binding for two-PC streaming.** `overlay.rs` binds 127.0.0.1 only, that
  property is tested, and it is load-bearing. Not worth trading.

## What 1.0 means

Not a feeling, and not "when the version numbers look untidy". Old builds are
pruned with one command (`RELEASING.md` §3b) and that is unrelated to readiness.
1.0 is when the things this document admits are unverified stop being unverified:

- [ ] An OBS Browser Source has rendered the overlay, transparently, on a real
      stream (checklist 2).
- [ ] The backfill has run to completion and the measured seconds-per-replay is
      written down (checklist 4).
- [ ] The undecorated window has a verdict: snap, resize and drag confirmed
      working, or `decorations` put back.
- [ ] A real game has driven the toast, the overlay and the viewer handoff end to
      end in one sitting.
- [ ] Next game has fired on a real W3Champions queue, early enough to read
      before the loading screen ends.
- [ ] Linux is either working (§8) or explicitly declared out of scope. Listing a
      target in a config file is not support.
- [ ] The channel is split, so a build made mid-work cannot become somebody
      else's update (`RELEASING.md` §1).

Until then `0.x` is honest. Semver already reserves it for exactly this, so the
numbers cost nothing. Spend them freely: a version that does not increase is a
version whose update path cannot be tested.

## Checklist

### The things only a human can do

1. ~~Play one real game with the app open~~ **DONE 3 Aug 2026, it worked.**
   See §0.
2. **Point a real OBS Browser Source at the overlay** (§4). The page and the
   live-update path are verified in real Chrome, where a connected tab updated to
   "Victory" with no refresh via EventSource auto-reconnect. OBS runs its own CEF
   build and *transparency* specifically is still unverified.
3. ~~Take one real upgrade~~ **DONE 5 Aug 2026, it worked.** 0.2.0 was installed
   from the NSIS installer, found 0.3.0 through
   `https://cdn.wc3v.com/desktop/latest.json`, installed it, and afterwards
   reported "up to date". The signing key, the manifest, the R2 hosting and the
   version comparison are all proven end to end rather than assumed.
   - What this does not prove: that anyone would ever find the update. It sat
     behind a button on the Settings screen and nothing checked on its own. See
     §6.
4. **Run the backfill once** (§2) for the real end-to-end rate. It also settles
   profile identity permanently as a side effect.
   - **Do this only on a build carrying schema v4** (§11, §11a). Four blocks —
     `moments`, per-player `combat`, `dominance` and `resources` — come out of
     the full parse and cannot be recovered from a stored summary, so a backfill
     run on an older build means 3,000 games that each need re-parsing to get
     them. v4 is in as of Aug 2026 and costs 1.7 KB gzipped a game. Check
     `SCHEMA_VERSION` in `store.js` before starting the run rather than after.
5. **Queue one real ladder game with W3Champions lookups on** (§12) and watch
   whether Next game appears while the loading screen is still up. That is
   the only thing that tells you whether the feature is worth having.

---

### 0. Verify the premise, first
Everything below is wasted effort if the watcher does not fire.

- [x] **PASSED, 3 Aug 2026.** A real 1v1 was played with the app open.
      `Replay_2026_08_03_1400.w3g` (137 KB) was detected, auto-parsed, its
      summary persisted (`137081-a68ebbf238065ebf`) and published to the overlay
      about 34 s after the game wrote. Both the autosave and `LastReplay.w3g`
      were written and collapsed to a single detection. The premise holds.
      - Note: for this game the two files were byte-identical, so content dedupe
        caught it and the grace window was not exercised in anger. The earlier
        corpus finding of differing sizes came from a stale `LastReplay.w3g` left
        over from an older game. Both paths are covered by tests, and only the
        identical case has been seen live.
      - Bug this surfaced: the overlay showed "Game over" instead of "Victory".
        The winner was parsed (`reason0c`, high confidence), and the app had
        simply never worked out which seat was the user, because it only tried at
        boot when the store was empty. Fixed in `7ed0ef7`.
- [x] Confirm the debounce is right. *Mechanism verified*: `watcher.rs` tests
      write progressively with gaps shorter than the settle window and assert
      exactly one announcement carrying the final size. Whether the 1.5 s `SETTLE`
      value matches the real game's write cadence still needs the real-game pass
      above.
- [x] Confirm `LastReplay.w3g` and the `Autosaved\Multiplayer\Replay_*.w3g` copy
      of the same game produce exactly one `replay-detected`.
      **Finding from the real corpus: the two are not byte-identical, and no
      autosave even shares LastReplay's size, so hash dedupe could never collapse
      them and every game would have announced twice.** Fixed: a settled
      `LastReplay.w3g` is held for `LAST_REPLAY_GRACE` (30 s), any other
      announcement inside the window cancels it, and a lone one, which happens
      with autosaving off, announces when the window expires. All three orderings
      tested.
- [x] Check behaviour when the game is mid-write and the app starts.
      *Simulated*: a file partially written before watcher start announces once,
      with the final size, after writes stop. Also fixed along the way:
      overwriting a watched file, which `LastReplay.w3g` does every game, now
      invalidates its cached hash and size entry. The stale cache both
      double-announced new games and could swallow one whose content matched a
      stale hash.

### 11. The review layer: BUILT (Aug 2026)

The narrated read of a game: what happened, how it compares with your own normal
game, and what to fix. This is the flagship, per the identity sentence above.

- [x] **Schema v3, the `combat` block.** Per seat: every hero kill and death
      (time, hero, level, `likely` when inferred, `toCreeps`), wipes for and
      against, and the biggest single trade. Like `moments`, it comes out of
      `world.battles`, which **exists only in a full parse**, so it is extracted
      at parse time or never. `MomentsExtract.extractCombat()`, called from
      `store.js buildSummary`.
      - Moments is a capped, importance-ranked highlight reel of 24 max. The
        ledger is the complete count the grades are computed from. Deriving one
        from the other would silently under-count every game with more than 24
        beats.
      - **This is why v3 had to land before the backfill runs.** A summary stored
        without it can only be fixed by re-parsing that replay.
      - Pre-v3 games still show their moments and offer a quiet "Re-read"
        underneath. Only a pre-v2 game, with no moments at all, gets the old
        full-panel upgrade prompt. Hiding real moments behind an upgrade notice
        helps nobody.
- [x] **`client/js/GameReport.js`**: dual-runtime, no DOM, no fs, same contract as
      SummaryExtract and ProfileAggregate, so the site's upload flow can reuse it.
      `grade(summary, slot, baseline)` returns a headline, five pillar grades
      (Economy / Army / Hero / Map control / Mechanics), up to three named
      mistakes, up to two highlights, and the benchmark strip.
      - Each pillar is **a base score plus penalties rather than a blend** of
        sub-scores. Blending pulls every game toward whatever constant the
        "nothing went wrong" term carries. The first version did that and
        compressed Economy into a 54–62 band with no spread left to read.
      - A pillar with no usable signal scores `null` and says why. Nothing is
        invented.
- [x] **`ProfileAggregate.baseline(games, name, opts)`**: rolling last-20 medians
      for the same matchup, falling back to all games below n=5 and reporting
      which scope it used. `excludeKey` keeps the game under review out of its own
      baseline.
- [x] **The Review tab**, first and default in the report frame. Grades as values
      with their note, and **no radar**, because a polygon is unreadable at 900px
      and in a screenshot. Then the benchmark strip, then "What to fix" and "What
      went right", every cue with a Watch button into the viewer at that second. A
      cue with no time gets no button rather than a dead one.
- [x] **One wording source, three renderers.** The headline is computed once in
      `overlay-state.js` (`readFor`) and appears in the window, the post-game
      toast and the OBS overlay. The overlay only ever grades the user's own seat.
      Judging a stranger's game it is merely displaying would be indefensible.

#### Calibrating the review

Thresholds are calibrated against the real corpus rather than guessed. The check
is "how often does each label fire over `client/replays/*.wc3v.gz`". A label that
fires on most games means nothing, and one that never fires is dead weight.
Findings from the first pass, all fixed:

| Symptom | Cause | Fix |
|---|---|---|
| `lostFight` fired on 31% of seats | 700g threshold; every game has one decisive trade and somebody loses it | 1200g |
| Mechanics pinned at 100 for 20% of seats | absolute APM anchor topped out at 70 | 40–320 |
| Map control pinned at 100 for 11% | camp anchor capped at 6 by 12:00 | 0–10 |
| Hero blamed in 43% of headlines | expected-level curve reached ~7.75 by 25 min | shallower, capped at 6 |
| Economy median 44, so the typical game read as below its own average | every supply-cap sample penalised, and being at the cap briefly is just how WC3 is played | one sample of grace |

After: no label above 17%, none at 0%, every pillar's median within a few points
of 50 with real spread either side. **Re-run this after touching any constant.**
`tools/test-game-report.js` asserts the shape, and only a corpus pass tells you
whether the labels still mean anything.

### 11a. The charts layer: BUILT (Aug 2026)

The report draws the **viewer's own** chart widgets rather than lookalikes. This
is the same argument the overlay split settled: a second implementation of an
instrument is a second thing that can disagree with the first about the same
game.

- [x] **`client/js/SeriesExtract.js`**, dual-runtime, same contract as
      SummaryExtract / MomentsExtract / GameReport. Packs `dominanceSeries` and
      `resourceSeries` into a stored summary as **parallel arrays** and unpacks
      them back into the shape the widgets take.
      - Arrays rather than arrays-of-objects because these are by far the
        largest thing in a summary: `{"t":600000,"score":52.4}` is 26 bytes
        where `600000,52.4` is 11. A 40-minute game is ~240 samples per player
        per series.
      - Dominance stores `t` explicitly — its samples are **not** on a fixed
        grid, because DominanceSeries emits pre/post pairs around momentum
        events so a hero death reads as a step rather than a slope. Resources
        are on a 10s grid, verified rather than assumed: a ragged series falls
        back to explicit timestamps instead of silently mis-timing every chart.
      - Dropped on purpose: the dominance `str`/`mom`/`c{}` component
        breakdown (nothing renders it) and `foodLost` (nothing charts it).
- [x] **`client/css/dominance.css`**: the gauge, the dominance chart and the
      resource charts, split out of `main.css` and loaded by `viewer.html`,
      `dominance-lab.html` and the desktop app. Every other page that loads
      `main.css` got 674 lines lighter, since none of them ever mounted these.
- [x] **`js/dominance-panel.js` and `js/economy-panel.js`** mount the widgets
      from a summary and own no drawing code. Both classes already took data
      rather than a viewer; what they gained is small and helps both products:
      - `GEOMETRY` published on `DominanceChart` and `ResourceCharts`, so a
        consumer can map a pointer position back to a game time without
        hardcoding the margins. Getting that wrong puts every seek a minute or
        two early, which reads as the data being wrong.
      - `DominanceChart.scoresAt(t)`, interpolated per player. The class owns
        the samples, so a consumer showing the numbers beside the plot should
        not carry its own copy of the lerp. This is what replaced the gauge.
      - `spec.iconBase` on `DominanceBar.mount` also landed, with an error
        fallback to the colour-only tile. The gauge was cut from the desktop
        afterwards; the seam and the fallback are still an improvement to the
        viewer, which is unchanged in behaviour.
      - `DominanceChart._fitDots()`: `preserveAspectRatio="none"` is what lets
        the plot fill any width, and it stretches the momentum dots with it. In
        a 320px insights panel that is a 1.26x squash nobody notices; at full
        report width it is nearly 4x and the dots read as lozenges. A
        ResizeObserver writes a compensating `scaleX`.
- [x] **Scrubbing.** There is no playback in a post-game report, so the chart
      draws the whole game, opens at the end, and dragging it replays the
      momentum through the cursor and the readout. Leaving without a drag puts
      it back at the end, because a readout left at 14:20 because that is where
      the pointer exited is reporting the wrong result for the game.
      Double-click opens the real viewer at that second.
      - Fixed while testing: `setPointerCapture` throws `NotFoundError` for a
        pointer id the browser is not tracking, and with the capture call ahead
        of the seek that throw took the whole click with it. Seek first.

### 1. Persist parses: DONE (summaries rather than full parses)

- [x] Retention decision: the full `.wc3v` is **not** persisted, because 3,072 of
      them is gigabytes. What survives is one gzipped `SummaryExtract` summary per
      unique game (`<app_data>/replays/<key>.summary.json.gz`, a few KB), the same
      per-player shape the site's compare modal and pro summaries use, which is
      exactly what the profile layer (§3) aggregates. The raw `.w3g` stays the
      source of truth and full viewing re-parses on demand.
- [x] Keys are `<size>-<xxh3>`, computed by the `replay_key` command at parse
      time. The scan's lazy `<size>-u` keys are not used, because they mutate the
      first time another file collides on size, and a store key must never change.
      Hashing at parse time is noise next to the parse itself.
- [x] Skip re-parsing anything already stored. `run()` checks the key first and
      renders from the store (`showSummary`). Content-keyed, so the same game
      under a second path also hits.
- [x] Rust commands: `save_parse` (atomic temp+rename, strict key charset),
      `read_parse`, `list_parses`. All async, because Defender scans new files on
      write and a sync command would hold Tauri's main thread.
- [x] **Schema v4 adds `dominance` and `resources`**, see §11a. Same rule again:
      `lib/DominanceSeries.js` and `lib/ResourceSeries.js` run inside
      `utils.buildOutputObject`, so their output exists only in a full parse.
      Packed as parallel arrays by `client/js/SeriesExtract.js`. Measured
      **+1.7 KB gzipped per game** (`node tools/measure-summary-v4.js`), which
      is 26 MB across the whole 3,072-game history — well inside the retention
      decision this design rests on.
- [x] **Schema v3 adds per-player `combat`**, see §11. Same rule as `moments` and
      the same reason: `world.battles` exists only in a full parse. **Must be
      current before the backfill runs.**
- [x] **Schema v2 adds `moments`**, the ranked big beats of the game
      (`client/js/MomentsExtract.js`). This is the one thing in the summary that
      cannot be recovered later, because fights live in `world.battles`, which
      only exists in a full parse, and `SummaryExtract` never touched it. So it is
      extracted at parse time while the parse is still in hand. Measured cost:
      1.2–3.8 KB of raw JSON, under a KB gzipped.
      - A game stored under v1 renders its timings and offers a **"Find moments"**
        button that re-reads that single replay, rather than showing an empty list
        that reads as "nothing happened".
      - `store.persistSummary` replaces a corpus entry on re-parse instead of
        appending. A duplicate would inflate every profile record it feeds.
- Note for §3 and §2: two *different encodings* of the same game, LastReplay
  versus its autosave, have different keys, so the store can hold both if one is
  clicked manually. The profile layer should dedupe by the summary fingerprint of
  map, duration and sorted names, like the site does.

### 2. Backfill engine: BUILT, unmeasured
3,072 playable replays exist locally, going back to Feb 2020. User decision on
record: **parse everything, in the background, resumable.** The engine lives in
`desktop/src-frontend/js/backfill.js`, behind the "Parse all replays" button in
Settings.

- [x] Queue with persisted progress so it survives restarts. **The store is the
      progress**: queue = cross-root deduped scan (`scan_all`) minus stored
      summary keys minus `.failed.json` markers. No queue file exists to drift or
      corrupt, and pause/restart resumes by construction. Failure markers stop
      known-bad replays retrying every run, and "Retry N failed" clears them,
      which is the recovery path after seeding more maps.
- [x] **2 low-priority workers.** No WC3-process detection, per the decision.
      Newest-first order so recent games power the profile immediately.
      `LastReplay.w3g` is excluded, because it is a second encoding of a game
      whose autosave is already queued and would double-count in the profile.
- [x] `skipPathfinding: true`. **Found and fixed en route: the bundle entry
      (`parserEntry.js`) silently dropped unknown options, so the fast mode never
      reached `doParsing` from the browser or desktop path at all.** Now
      forwarded, and `verify-bundle-parity.js --fast` runs both parsers in profile
      mode. Parity holds, which proves the passthrough end to end. Bundle rebuilt.
- [x] Progress UI honest about remaining time: no ETA until ≥5 parses have
      actually been measured, then a median-based estimate labelled "(rough)".
- [ ] Measure the real end-to-end rate. Needs a real run on the real machine. The
      completion log line prints the measured s/replay end-to-end figure. Quote
      nothing until it has printed once.

### 3. Profile and coaching layer: BUILT (spike render)
Built on SummaryExtract summaries, as required. No new extractor.

- [x] `client/js/ProfileAggregate.js`: pure data, dual-runtime. One function is
      the whole model. `buildProfile(games, name)`, because a profile is just a
      name, so "my profile" and opponent lookup are the same code path. Buckets:
      race, matchup, map, opponent, patch (subheader version), plus
      playedAt-ordered recent form. Tested with
      `node tools/test-profile-aggregate.js` over a synthetic corpus, asserting
      records from both seats and the statement guards.
- [x] Derived insights: openings by matchup with win rates, T2 timing
      distribution in wins versus losses (overall and per matchup), map win rates,
      expansion habit with expand and no-expand records, workers-at-5:00 split
      from economyTrack.
- [x] Coach panel: `statements()` emits plain sentences, every one carrying its n,
      with hard minimum-sample guards. A claim below minimum n is not made at all.
      Rendered as text in the result panel; §5 owns design.
- [x] Manual opponent lookup: type a name, with autocomplete over every name in
      the corpus, and get their profile from local history. No APIs, no scraping.
- [x] **Identity detection**, which every verdict in the app depends on. Nothing
      in the .w3g format marks the saving seat. The owner is in *every* replay in
      their own folder while opponents appear once or twice.
      `Wc3vParser.peekPlayers()` reads names from the replay header only, about
      50 ms with no game parse, and the app samples 40 autosaved replays spread
      across the whole history. Measured on the reference folder: owner 100% of
      40, second place 68%.
      - Autosaved only. The Replays root also holds downloaded games the user was
        never in.
      - Auto-detection is provisional. An explicit pick is confirmed and is never
        overridden. The picker lists real candidate names as buttons and is always
        visible, so a wrong guess is one click to fix.
      - `node tools/detect-identity.js --dir=<Replays>` runs the same algorithm
        standalone to check a folder without launching the app.
      - **This got shipped wrong once.** Detection ran over the parsed store,
        which held one game on a fresh install, and a prefilled text box then
        committed the arbitrary first name, so the app decided the user was their
        opponent and reported a loss as "Victory". Frequency over the corpus is
        the signal, and a single game cannot distinguish the seats at all.
- Summary schema additions for this: `playedAt` (replay file mtime, which is when
  the game was played, where `savedAt` is when the backfill reached it) and
  `patchVersion`. Results exist only for 1v1, since `winner` is 1v1-only. Team
  games count toward games and maps but carry no result.
- [x] **Trend over time.** Everything above answers "what are you like". This
      answers "what are you like now", which a lifetime average is structurally
      incapable of doing, because a habit fixed months ago still carries every
      game played before it was fixed. `trend()` buckets into windows of 20 games
      rather than calendar weeks, since 40 games one week and 2 the next would
      otherwise plot as two equally trustworthy points, and `trendDelta()`
      compares first against last.
      - Tiled from the most recent game backwards, so the newest window is always
        full. Tiling forwards leaves the remainder at the recent end, where a
        3-game window fails every sample guard, which would silence the trend for
        any corpus whose size is not a multiple of 20.
      - The guard is per-end rather than overall. A player with 300 lifetime games
        can still have a 3-game window, and "your T2 is 40s faster (n=3)" is worse
        than saying nothing. `tools/test-profile-aggregate.js` asserts exactly this
        with a 22-game corpus: ample overall, thin at one end.
      - Rendered as three separate small plots rather than one with two y-axes.
        Win rate is a percentage and T2 is a duration, and sharing an axis invents
        a relationship out of the scaling. Below three points there is no plot at
        all, only a then/now readout carrying the n at each end, because two points
        joined by a line look like a trend while being two averages with a slope
        drawn between them.
- [x] Feed search and filters over player names and the map as shown, plus result
      and race, and the feed appends a page at a time as it is scrolled. Filtering
      lives in `store.filterCorpus`, because "which games" is a question about the
      store and the feed renders what it is handed. "No games match those filters"
      is a distinct state from "No games yet".
- [ ] Corpus load reads every summary through IPC one at a time. Raw-bytes
      responses now, so it is bytes-cheap, and still about 3k invokes. Fine at
      current scale. Revisit if profile open ever feels slow.

### 4. Overlay and OBS: BUILT, never shown in a real OBS
- [x] `overlay.html`: transparent background (opaque in `?view=panel`),
      read-only, SSE-driven, self-contained with no external requests. Themes
      `?theme=carved|slate`, `?scale=N`. Served embedded from the binary.
- [x] Loopback server (`overlay.rs`), hand-rolled on std::net. About 200 auditable
      lines with no HTTP dependency. 127.0.0.1 only, per-install token on every
      route, GET only, three routes (`/overlay`, `/events` SSE, `/state`), no
      CORS, no write path. Port persists across restarts so the OBS URL survives,
      and the token persists per install. Tested over real sockets
      (`overlay::tests`), including an SSE-registration race the test caught:
      greeting and registration now happen under the clients lock so a concurrent
      publish cannot be missed.
- [x] **Post-game notification.** The window is behind Warcraft while you play, so
      the app has to be the one that speaks: a toast with the result, the map, the
      all-time record against that opponent and the single biggest moment. Fires
      only for a watcher-detected game, since wiring it to the parse path
      generally would mean one toast per replay in a backfill, thousands of them.
      Off via a Settings toggle. The OS permission is asked for at the first real
      notification rather than on the settings screen, where a prompt has no
      context to justify it.
      - Wording comes from `overlay-state.js` (`toastFor`), where the seat is
        already known, so the toast, the app and the broadcast can never describe
        the same game differently.
      - Its "biggest moment" is read off the importance-ranked list directly
        rather than off `momentsFor()`, which re-sorts its top five into time
        order for the overlay, so `[0]` there is the earliest of the five.
- [x] "Copy OBS Browser Source URL" button, clipboard only. The URL carries the
      token and this window may be on camera, so it is never rendered or logged.
      Suggested source size logged with it.
- [x] Panels: last-game verdict, build order (first 12), key timings (opener, T2,
      expand, tower), session W/L, streak. Session counts only watcher-detected
      live games, so clicking through history never touches the on-stream score.
      Verdicts are scored from the profile name's seat, set by the "This is me"
      button and auto-detected from the corpus otherwise.
- [x] Player-facing variant: "Open player view" opens `?view=panel` in the default
      browser, for a second monitor.
- [x] **Split into three files**, `overlay/{shell.html,overlay.css,
      overlay-render.js}`, stitched back into one self-contained document by
      `overlay.rs` at request time. The point is that the Stream screen's preview
      renders from the *same* css and renderer, because a preview drawn by
      separate code is a preview that can lie. A test asserts the seam.
- [x] **Selectable panels**: `session,verdict,h2h,moments,build` via a `modules=`
      param, so the OBS URL carries its own config and survives a scene copy.
      Unknown names are dropped rather than fatal, so an older pasted URL keeps
      working. The UI refuses to leave zero panels on.
- [x] **Head to head**: "all time vs <opponent> 3–2", counted over the whole
      stored history. Nothing else on a stream can show this, because it was
      learned from the streamer's own games.
- [x] **Key moments ticker**: the top 5 beats with timestamps, phrased in
      `overlay-state.js` where the seat is known, so the app and the broadcast
      never word the same fight differently.
- [x] **Live preview and "Send a test game to OBS"** on the Stream screen. The
      preview sits on a transparency checkerboard, because a preview on a solid
      panel hides exactly the mistake it exists to catch, and the fake game is
      labelled *on the overlay itself*, because an unlabelled fake result on a live
      stream would be indefensible.
- [x] **Per-panel URLs.** Every panel is also a source in its own right, with its
      own Copy URL button and a stated suggested size. Streamers compose two or
      three small placed sources far more often than they use one tall card. No
      server work was needed: `?modules=session` was already a single-panel URL,
      so this is a Stream-screen affordance plus compact CSS. The composed URL is
      untouched by copying a single panel.
- [x] **Post-game reveal** (`?reveal=<seconds>`): the card slides in when a game
      lands, holds, and hides again. Off by default, because an overlay that
      vanishes unannounced is a bug report. An absent param means always on, so
      every URL already pasted into OBS behaves exactly as before.
      - "A new game" is detected by `game.gameId`, the content key, rather than by
        the timestamp. Every publish carries a fresh `updatedAt`, so a reconnect or
        an identity change would otherwise re-trigger the reveal.
      - On a fresh load the last game reveals once and then hides. That is
        deliberate, since it is the only way to position the source in OBS without
        playing a match, and it makes the mode reload-safe, so OBS's "refresh when
        scene becomes active" is a non-event.
      - Hidden means transparent rather than removed. The card keeps its layout so
        the streamer's placement does not shift when it comes back.
- [x] **The OBS gotcha is in the UI**, next to the URL, rather than in a document
      nobody opens: "Shutdown source when not visible" must be OFF, because it
      unloads the page and drops the SSE connection whenever the scene is not
      live. Refresh-on-activate is safe because the page bootstraps its whole
      state on load, and the Aug 2026 copy pass dropped that line from the screen
      since nobody has to do anything about it.
- [x] **Why this is safe on a stream** is stated on the Stream screen. Every other
      WC3 overlay reads the game's memory or sniffs its packets. This one reads a
      finished replay, so nothing on screen can help a sniper.
- [ ] Point a real OBS Browser Source at it. Transparency, reconnect behaviour,
      **and the reveal animation** are unverified until then.

### 5. UI and visual design: BUILT, then FOCUSED (Aug 2026)

**What this app is for**, the sentence every screen answers to. WC3V watches the
replays Warcraft III already saves and answers three questions, in order of how
often they are asked:

1. **What just happened?** The instant post-game report, every game.
2. **Am I getting better?** Coach, trends, records, weekly.
3. **Who is this?** The book on every opponent you have faced, whenever a
   familiar name appears. Also Next game (§12), which answers it *before*
   the game rather than after.

…and puts it on stream for the people watching. Each tab is one of those
questions and nothing else earns a tab. The tabs are **Home / Coach / Stream**,
and Settings is a sheet behind the gear rather than a screen. The `data-view`
ids stay `games`/`profile`, since renaming internals buys nothing.

**The first tab was called "Last game" and that was wrong.** The label lied the
moment you clicked a game from March, and it lies harder now that the column can
show the *next* game. Home is the honest name for a screen that is a feed plus
whichever game you are looking at.

**The fold rule (absolute):** no view scrolls as a whole. The frame of every
screen fits the window at the 900×600 minimum, and anything long lives in a
designated `.scroll` container. Verified by an automated audit (TESTING.md
appendix) over every one of the 40 preview games, every report tab, both column
modes and all four screens, at both 900×600 and 1280×820. Before any of this,
the game report stacked ~2,400px against a ~700px viewport and Profile was a
term paper.

- The report is a fixed frame and one scrolling tab body: verdict band, game
  strip, grade rail, tab strip. Tabs are **Review**, **Story**, **Build** and
  **Economy**, and the active one is remembered across game selections.
- **Heroes and Economy existed in the data all along.** `heroBuilds` carries skill
  order with ability icon ids and final items, and `economyTrack` /
  `combatUnitsTrack` are chart-shaped 30s series. The charts are drawn by the
  site's own `CompareCharts` factory (now in SHARED_JS) with battle markers from
  the stored moments. Games with a player count other than 2 chart the viewed seat
  alone (`omitPro`) rather than inventing a duel.
- **Coach is a dashboard** rather than a column: fixed head band (name, record,
  form chip, lookup), a 3-up trends band, then statements beside a seg-switched
  records table, each cell scrolling internally. Every player name in the app,
  across the report header, the record chip, build titles and most-faced rows,
  is a `.name-link` that opens that player in Coach.
- **Race marks are original heraldic SVGs** (`race-icons.js`: keep, axe, crescent,
  skull, die, ring), single-path, currentColor, tinted by the `--race-warm-*`
  ramp. Deliberately not the game's art: the wc3icons set is extracted Blizzard
  artwork, kept only where identity demands it, on unit, ability and item icons.
  The two-letter chips remain as the no-JS fallback. `RaceIcons.mark()` is the one
  builder, shared by the feed, the report, the game strip and Next game.
- The Blizzard trademark disclaimer the site carries in three places now exists in
  the desktop too, pinned at the foot of Settings.

The original reframing stands: the window is **a feed of your games** rather than
a file browser.

- [x] Games feed grouped by day, newest first, built from the stored summaries.
      Each row: verdict plaque, opponent, matchup, map, duration.
- [x] Game report: verdict, **Open in viewer** as the primary action, timings
      strip, **key moments** with per-moment Watch buttons, head-to-head against
      that opponent from local history, both build orders.
      - "Open in viewer" sits with the game header rather than in the moments
        list. It was in the list first, which put it behind two early returns (no
        moments, or a pre-v2 summary), and since every already-stored game is v1,
        that meant no existing game could be opened in the viewer at all. Watching
        the game is an action on the game, and jumping to a moment is the
        refinement.
- [x] Profile screen rendered as panels and tables instead of a `<pre>`. Settings
      owns folders, history parsing, startup, updates and ladder lookups. The log
      is a collapsed Activity drawer.
- [x] Shares `client/css/tokens.css` with the web client, copied in by
      `tools/build-desktop-client.js`, so there is one design system rather than
      two. Only the warm ink ramp is new, because tokens.css has no text colours
      tuned for brown.
- [x] **Brand pass (Aug 2026): navy chrome over warm content.** The app was warm
      end to end and carried three unrelated brand expressions: an indigo-V OS
      icon, a gold `WC3V` text bar, and no mark at all on the overlay. It now
      reproduces the sandwich wc3v.com already is, with the site's navy chrome
      wrapping a warm carved body.
      - The app bar is navy (`--bg`/`--border`/`--text`) and carries the canonical
        wordmark, `WC<span>3</span>V`, weight 900, the "3" in `--accent`,
        identical to `.site-wordmark` in `client/css/main.css`. **The rule is
        written at the top of `app.css`: navy stops at `main`.**
      - **The window is undecorated** and the app bar is the title bar. With the
        native one left on, Windows drew a second header directly above it.
        Caption controls call the window's ordinary close, which `main.rs` already
        turns into hide-to-tray, so that behaviour is still defined in exactly one
        place.
      - Build orders carry the site's real icon art, fetched from
        `cdn.wc3v.com/assets/wc3icons/` with the CSP widened to that one host, for
        images only. **The site's `.bo-*` instrument itself cannot be ported**,
        because it renders from the full event stream and the desktop stores only
        summaries. The summaries do carry `itemId`, which is what made the icons
        possible.
      - Race chips were tinted with tokens.css's saturated in-game
        `--race-H/O/E/U`, in a stylesheet whose own header forbids saturated
        colour. Same hues, pulled into the `--dom-*` family.
      - Golds reconciled: `--accent` and `--gold` are navy-chrome only, and every
        warm surface uses `--dom-gold`.
      - Checkboxes were the platform's near-white square on a carved panel,
        because `accent-color` only tints the checked fill. Now drawn.
      - Added what did not exist: `:focus-visible` rings (the one UA ring the app
        had was being removed), `prefers-reduced-motion`, feed skeletons, and a
        real first-run card instead of a grey line in the rail.
      - The overlay gained the same wordmark, quietly, and its `slate` theme now
        overrides `--win` and `--loss`. It was leaving carved moss and rust on a
        cool grey panel, the one combination that theme exists to avoid.
- [x] Art direction held: earthy, carved, muted. Depth comes from a hard dark
      outline, a 1px struck highlight and inset shadow. No glow anywhere.
- [x] UI rules held: nothing below 0.8rem, no icon below 36px, no single-edge
      accents (the verdict is a plaque rather than a stripe), no ellipsis
      truncation.
- [x] **No filesystem path is rendered, or in the DOM.** Folders are "Replay
      folder 1/2", the map cache is "local app data", and the rows carry an index
      that the click handler closes over.
- [x] **Failures of a clicked action are visible where the user is looking.** They
      used to go only to `log()`, meaning into the Activity drawer, which is
      collapsed by default, so a primary action that failed looked like a dead
      button. `failed()` now puts the reason in the status bar in red and opens
      the drawer.
- [x] **Home redesign (Aug 2026).** The report column was 56% furniture at
      1280×820 and 74% at 900×600, where the verdict band and the timings panel
      *grew* as the window shrank because both wrapped. The scrolling tab body
      came out at 34px, or 3px with a live match on screen. Six tabs, and you
      could see one row of one of them.
      - **The timings panel is gone and the game strip replaced it**
        (`js/game-strip.js`). Four rows in 82px: your lane, a fight axis, their
        lane, a time ruler. Each lane carries a workers area from `economyTrack`
        and ticks for T2, T3, expansion and first tower. The axis carries one
        mark per fight, scaled by gold swing and coloured by who came out ahead.
        Everything the 157px panel listed is here, positioned in time.
      - **Every mark opens the viewer at that second**, through the existing
        `onWatch` path. That handoff has existed for a while and was buried
        behind per-row Watch buttons inside a scroller nobody could see.
      - **The grade rail moved into the frame.** Five pillars, five cut wells,
        above the tab strip. They are the one thing on the screen no website
        could produce and they were small grey text inside the scroller. The
        reasoning stayed in Review, one row per pillar.
      - **The verdict word dropped to `--fs-h2`**, which is what stopped the head
        wrapping to two rows at the 612px a 900px window gives. The meta line
        lost `1v1`, the datetime and APM, and gained the opener and the 5:00
        worker count from the dead timings panel.
      - **Tabs went 6 to 4.** Heroes and Builds were one question asked twice and
        merged into **Build**. Head to head was three facts behind a tab that
        appeared and disappeared per game; the record chip keeps the number and
        opens their book in Coach.
      - **Story gained a map** (`js/game-map.js`): creep camps as rings sized by
        level, both start positions, and every fight carrying coordinates. It
        sits beside the moments rather than above them, and a game with fewer
        than three coordinates gets no map at all.
      - **The rail went 27rem to 22rem**, lost its heading band, and rows went
        68px to 52px with a plain divider instead of a bordered card. Games on
        screen at 900×600 went 3 to 7.5.
      - **Settings became a sheet over the current screen.** Inlining six panels
        onto Home would have cost 300px of a 507px budget permanently, for
        controls nobody reads twice. Every id is unchanged, so
        `settings-view.js` needed no edit.
      - Measured after, at 900×600 with a live match up: frame 427px → 325px,
        tab body 34px → 149px.
      - **Two things the plan assumed that the data does not support.** A stored
        summary has no per-player camp-clear record, so the map cannot say who
        cleared what, and only 126 of 402 moments across the preview corpus
        carry coordinates. The map draws camps as terrain and locates the fights
        it can.

- [x] **Charts pass (Aug 2026): the report draws the viewer's own instruments.**
      Home carried one chart drawn specially for it (the game strip) and two
      drawn by the compare-modal factory, while the viewer had a dominance
      gauge, a dominance chart and three resource charts that the desktop could
      not show at all — because the series behind them exist only in a full
      parse and the store keeps summaries.
      - **Schema v4** adds `dominance` and `resources` (§11a). Measured cost
        **+1.7 KB gzipped per game**, 26 MB for the whole 3,072-game history,
        against a v3 mean of 6.8 KB. `node tools/measure-summary-v4.js`.
        Dominance was available on 60/60 of the sampled corpus.
      - **`client/css/dominance.css`**, 674 lines split out of `main.css`, is
        now loaded by `viewer.html`, `dominance-lab.html` and the desktop app.
        Same reason overlay.css was split: a second copy is a copy that drifts.
        Only those two pages ever mounted these widgets, so every other page
        that loads `main.css` got 674 lines lighter.
      - **The report frame lost its timeline band entirely.** The game strip
        (114px) moved to **Full details**, whole, where its per-fight seek
        buttons sit above the event list they belong to. The dominance gauge
        took its place for one revision at 58px and was then cut as well: it is
        chrome built for a game being watched live under a match header, and the
        only thing it added over the plot in Story was the pair of numbers,
        which now ride the chart's own title row. `DominanceBar.js` is not
        shipped to the desktop. Frame: 310px → **166px** (221 with a grade
        rail), tab body 252px → **470px**.
      - **Tabs went 4 to 4, but different ones: Story / Build / Economy / Full
        details.** Review is gone: its five grades had been in the frame since
        the Home redesign, so the tab was restating what was above it. Its
        benchmarks survived as tiles.
      - **Story is the default and is a dashboard**, not a narrative. Dominance
        chart, then every number the game produced as a tile — hero K/D, wipes,
        biggest swing, the four benchmarks against your own median, peak army,
        peak workers, T3, first tower. No prose, and no map: the map drew camps
        as terrain and located 126 of 402 moments, which is a picture of the map
        rather than of the game. `js/game-map.js` deleted.
      - **Build is the site's `.site-build-card`** (`js/build-card.js`): heroes
        with their skill grid and levels, key units, upgrades with levels, and
        the timings that define the build. It was a hero-card stack plus a
        16-row chronological list per player — about two screens of column for
        something the site fits in a card. The list moved to Full details.
      - **Economy is the viewer's `ResourceCharts`** (food, gold lost, lumber
        lost) plus army size. The standalone workers chart is gone: the game
        strip already drew both players' worker curves as its lane backgrounds.
      - **The rail is gone.** A quick nav of the last 8 games in a 63px band,
        and everything else behind a toggle that drops the full feed down over
        the report. Not a modal — nothing is disabled, and the same click closes
        it. The report is full width at every size.
      - **`Open in WC3V Viewer` is a reserved control**: `.btn-viewer`, one
        class, one place, carrying the canonical wordmark. It is the only navy
        allowed below `main`, deliberately — it is a piece of the site sitting
        inside the app, which is what it does when you press it.
      - **Measured after**, at 1280x820: report frame 310px → 166px (221 with a
        grade rail), tab body 252px → 478px. Fold audit clean: 40 games x 4
        tabs x 2 window sizes, plus both column modes, the drawer open, Coach,
        Stream and the Settings sheet. Zero offenders, zero console errors.
      - **The fold audit was passing a report whose default tab scrolled.** It
        skips anything inside `.scroll`, and `.report-body` is one, so Story
        overflowing by 189px at 900x600 was invisible to it. TESTING.md now
        carries a second snippet that measures the body directly, with a table
        of what each tab is allowed to do. **Story is held to zero at both
        sizes** — it is the default tab and the dashboard has to be on screen at
        once. What it cost to get there:
        - Peak workers, tier 3 and first tower dropped as tiles (they are Build
          chips and game-strip ticks; the grid went to two rows without them).
        - Tile columns 9.5rem → 6rem, so eight tiles are one row at 900px.
        - Benchmark sub-lines went from "14s later than usual" to `+14s`. At
          104px that sentence was three wrapped lines and grid row-stretch put
          100px on every tile in the row. The full wording is on the tooltip.
        - "Workers 5:00" → "Workers". It was the ONE label that wrapped, and
          because grid stretches a row to its tallest cell it cost 19px on all
          seven tiles.
        - A `max-height: 700px` block that gives back leading, padding and
          control height. Nothing removed, no type smaller.
      - **Two more measured-not-guessed fixes in the same pass.** The army chart
        was rendering **336px tall** at 1280 — CompareCharts defaults to a
        720x200 viewBox and the holder scales it at `width:100%; height:auto`,
        so a wide column blew up both the height and the 12px axis text (to
        20px). Authored at 1200x200 it is ~200px with its type at the intended
        size. And Economy's four charts went side by side above 1000px, which
        took it from 40/40 scrolling to **0/40 at 1280x820**.
      - Build still scrolls on content-heavy games (three heroes, eight units,
        upgrades and mercs is genuinely a lot), but its section labels moved
        beside their rows rather than above them, which was 60px of pure
        furniture per card, and unit names moved beside their icons rather than
        under them, which was another 139px.
      - **Two real bugs this surfaced.** `.detail-col`'s "fixed frame" was a
        five-row grid template ending in `1fr`; any missing band (no grade rail
        on a game you were not in) put the scroller in an `auto` row and the
        whole column grew. It is flex now, keyed on `.scroll`. And
        `heroBuilds` carries a Blademaster's Mirror Image illusions as extra
        level-1 heroes — the hero-card stack hid them down a scroller, and a
        card put four Blademasters side by side. Deduped by itemId at render
        (`build-card.js`), because every summary already stored has them.

- [x] **Copy pass (Aug 2026).** Every screen lost its explanatory paragraphs.
      Settings had four `lead` paragraphs and eight `hint` blocks describing what
      its own checkboxes did. Stream had roughly 300 words of instructions beside
      controls that were already labelled. What survives is anything that prevents
      a real mistake: the access token warning, the one OBS source setting that
      breaks live updates, the privacy line, and the suggested source size. Roughly
      70% of on-screen prose is gone and no control lost its label.
      - The same pass went through the source comments and these documents. The
        register is plainer, and no fact was dropped.
- [ ] Drive it once through the real Tauri window rather than the preview.
      **Re-opened by the Aug 2026 restructure**, since every screen changed shape,
      and again by the copy pass.
- Note: `node tools/desktop-preview.js` writes `desktop/preview/preview.html`,
  which runs the real frontend against summaries built from real replays. That is
  how the UI is iterated on without launching the app. `--w3c` adds a stubbed
  live match so Next game renders.

### 10. Open in the viewer: BUILT, not yet joined up
Clicking a moment opens the game in the real 3D viewer on wc3v.com, seeked to
that second. No upload, no account. The replay goes from this process to the
browser over loopback.

- [x] `?at=<ms|m:ss>` on the viewer (`client/js/app.js`, `_maybeSeekFromUrl`),
      applied at the end of `setup()` where the scrubber, chapters and cameras all
      exist. **The param is `at` rather than `t`**, because `?t=` is already the
      dev cache-buster on script and replay fetches.
- [x] Fixed en route: the scrubber's battle markers set `gameTime` directly
      instead of calling `seekToGameTime`, so clicking one moved the scrubber
      without resyncing unit state. Battle Report rows never had this bug.
- [x] **The handoff mechanism was chosen by measurement rather than by guessing.**
      Three candidates, two impossible. From an `https://wc3v.com` tab against the
      live loopback server, a direct `fetch` hangs pending forever and an iframe
      ends in `net::ERR_ABORTED`. Chrome gates public to private network access,
      so the browser has to start on the loopback origin.
- [x] `open_in_viewer` (Rust) reads the replay scoped to registered roots, stages
      it in memory, and opens `http://127.0.0.1:PORT/open?...` in the default
      browser. Staging happens in-process from a Tauri command, so the HTTP
      surface is still read-only.
- [x] `desktop/src-frontend/handoff.html`, the launcher. Fetches the bytes
      same-origin and pushes them to `https://wc3v.com/handoff` with
      `postMessage`, which is private to public, allowed, and needs no CORS.
      **One button, and nothing opens a window on its own.**
      - This was got wrong first. The page tried `window.open` automatically on
        load and kept the button as a fallback. On a freshly-opened loopback origin
        the browser has no engagement history to make an exception for, so the
        automatic attempt was blocked *every single time*. It never once
        succeeded. All it did was raise Chrome's blocked-pop-up indicator and leave
        the page explaining away a warning it had caused itself. The fallback was
        doing 100% of the work.
      - The click is not a confirmation step to be optimised away. It is the only
        thing that makes `window.open` legal, so it is the mechanism.
      - The staged bytes are checked before the button is enabled, so an expired
        replay fails on this page rather than opening the site and stranding it
        waiting for bytes that never arrive.
- [x] `client/handoff.html`, the landing pad. Receives the bytes, parses them with
      the existing `UploadManager`, stores them in `MyReplays`, then redirects to
      `/viewer?local=<id>&at=<ms>`. Remembers the desktop's content key to local
      id in localStorage, so the second moment you click on the same game skips
      the handoff and the re-parse entirely.
- [x] Staged replays expire after 10 minutes and are capped at 4. Deliberately not
      single-use: the launcher is a page a user can reload, and a dead link on
      refresh buys nothing the id does not already.
- [x] **The launcher URL is one short opaque parameter**, `…/open?h=<16 hex>`. It
      used to be `…/open?token=<32 hex>&h=h1&key=<content key>&at=<ms>`, long
      enough to look alarming in an address bar, which is what prompted the
      change. The length was the least of it:
      - **It put the permanent overlay token into browser history**, on every
        single "open in viewer", forever. That token also reads `/overlay`,
        `/state` and `/events`. Nothing needed it there.
      - **The handoff ids were a counter**: `h1`, `h2`, `h3`. Trivially walkable,
        and safe only because the token happened to gate the route too.

      Now the staged id is the credential: 64 unpredictable bits, dead after ten
      minutes, unlocking exactly one replay and nothing else. `at` and `key` come
      back as response headers on `/handoff` instead of riding in the URL, since
      the server already had both. **The token never enters the browser at all.**
      - `/open` is deliberately left ungated. It is a static document holding no
        token, no replay and no state. Gating it would mean an expired link
        returned a bare `404 no such handoff` instead of the page that explains
        what happened, which was a regression caught while writing this.
- [ ] Walk it end to end once the site is deployed and the app rebuilt.
- [ ] `render.yaml` needs no route for `/handoff`, since Render serves
      extensionless HTML already, the same as `/welcome`. Confirm on the first
      deploy.

### 6. Shell polish: BUILT
The app is something a person installs and runs rather than a dev loop. Entry
points are `npm run desktop` and `npm run desktop:build`, and the release and
update process is documented in `desktop/RELEASING.md`.

- [x] Tray icon: left-click or "Open WC3V" restores the window, and "Quit" is the
      only thing that exits.
- [x] Minimise to tray plus background parsing with no window. Closing the window
      hides it, since the whole point is to keep watching while you play.
- [x] Run on startup (`tauri-plugin-autostart`), toggled in-app. Launching via the
      OS passes `--autostart` and opens straight to the tray. The UI re-reads the
      real OS state after every toggle rather than trusting the click.
- [x] First-run flow: the ladder map pool, 48 folders and about 50 MB, is bundled
      into the installer and seeded into the map cache on first launch, so a fresh
      install parses ladder games offline immediately. Existing cache files are
      never overwritten. Folder discovery already ran at boot, and the manual
      picker covers anything it misses.
- [x] Auto-update (`tauri-plugin-updater`): signed packages, public key compiled
      into the binary, private key at `~/.tauri/wc3v-updater.key`, gitignored by
      pattern. **Back it up. Losing it ends updates for every existing install.**
      Builds made without an endpoint report "updates not configured" rather than
      implying they are current.
- [x] Endpoint points at `https://cdn.wc3v.com/desktop/latest.json` and **one
      upgrade has been walked end to end**, 0.2.0 → 0.3.0 on 5 Aug 2026.
- **0.7.0 published 6 Aug 2026** (the charts pass, §11a). Manifest and installer
  verified live. Note for whoever takes it: this is the **schema v4** build, so
  every game already in the store shows Story without a dominance chart and
  offers "Re-read this game" until it is re-parsed. That is the on-demand
  upgrade path working, not a fault. The tiles are all still there, because the
  combat ledger they read from is v3.
- [x] **The app checks on its own.** The upgrade worked, and it sat behind a
      button on the Settings screen. Nobody opens a settings screen to ask whether
      their replay parser is current, so an update nobody hears about is an update
      nobody takes. Now: a quiet check at launch and every six hours, because this
      process is meant to live in the tray for days and "at launch" alone would
      mean a machine that never reboots never hears anything. Plus a small accent
      chip in the app bar when there is one, the release notes shown next to the
      Install button, and a Settings toggle.
      - **It does not patch itself, deliberately.** The one thing this app must
        never do is close the window, raise UAC and steal focus while a game is
        being played, which is exactly what a background installer does, and this
        app runs in the tray precisely so it is there during games. Checking is
        automatic. Applying is a decision.
      - A failed quiet check is silent. A laptop that woke without a network would
        otherwise force the Activity drawer open on a red line about something the
        user never asked for.
      - The chip is accent-coloured rather than `--warn` or `--bad`, and does not
        pulse. Nothing is wrong, there is simply a newer version, and something
        blinking in the corner of a screen that stays open for days is an
        imposition.

### 7. Map data: DONE (lazy download)
Parsing needs per-map files. Measured: **318.8 MB** for all 202 maps, about
1.7 MB median each. An earlier figure of 137 MB in the plan was wrong, from a bad
`xargs`/`du` measurement.

- [x] Ladder pool ships in the installer and seeds on first run (§6): 48 folders,
      49.8 MB, covering every version variant of the competitive 1v1 maps. This
      removes the manual seeding step for normal use.
- [x] The missing-map case is handled in the UI. The error carries `mapDataName`
      and `rawMapName` and is reported as a named missing map rather than a
      mystery failure. The backfill records it as a failure marker and "Retry
      failed" re-runs those after more maps arrive.
- [x] **The "hosting decision" this was blocked on had already been made.**
      `https://cdn.wc3v.com/maps/<Map>/wpm.json.gz` returns 200 today, from the R2
      bucket `tools/deploy-assets.js` publishes to, which `render.yaml` already
      redirects `/maps/*` at. Nothing needed deciding and the block was stale.
      `fetch_map` (Rust) pulls the three parse files on a cache miss,
      `loadMapCache()` retries once, and the bundled ladder pool still means the
      common case never leaves the machine.
      - **The one trap, and it decides the HTTP client:** those objects are stored
        with `Content-Encoding: gzip`, so a client that transparently decompresses
        hands back plain JSON that then gets written under a `.gz` name and fails
        to inflate at parse time. `reqwest` is pulled in with **no**
        `gzip`/`deflate`/`brotli`/`zstd` feature for exactly this reason, because
        the bytes off the wire are the file. It was already in the tree via
        tauri-plugin-updater, so this cost no new dependency.
      - This is the first outbound request the app makes for game data, so the
        Settings copy no longer claims nothing is ever sent anywhere. It now says
        what is true: replays never leave the machine, and map data and
        build-order icons come from the CDN.
- [ ] "Download the current ladder pool" button to pre-warm. No longer blocked,
      just unbuilt.

### 12. W3Champions lookups: SCOUT CARD BUILT, off by default

The one thing this app can do that no purely-local tool can. W3Champions
publishes a **public, unauthenticated** REST API, and
`GET /api/matches/ongoing/{battleTag}` returns the match you are playing **right
now**: opponent, race, MMR, rank, map. That is pre-game opponent scouting with no
memory reading, no packet sniffing and no anti-cheat surface, which is the single
biggest behavioural upgrade available to this app. It turns WC3V from a thing you
look at afterwards into a thing that is open while you play.

Also useful: `/api/players/{tag}/game-mode-stats` (MMR, rank, **quantile**),
`mmr-rp-timeline`, `game-length-stats`,
`/api/player-stats/{tag}/race-on-map-versus-race` and `hero-on-map-versus-race`,
`/api/matches/search` (a full ladder history, so a first-launch backfill of
RESULTS), and `/api/players/{tag}/aka` (alt accounts).

- [x] **`src-tauri/src/w3c.rs`.** Four properties enforced in the binary rather
      than documented in a README: it fails closed unless the opt-in marker file
      exists; one host, built here from an **allowlisted path**, where the webview
      passes a path and never a URL; GET only, redirects refused; and a failure is
      an error the UI renders as "no online data".
      - The path check refuses `//evil.example/...`, `..`, backslashes, control
        characters and absurd lengths. A scheme-relative path would sail past a
        naive prefix check and reach another host entirely, which would defeat the
        whole point of taking a path instead of a URL. Four tests cover exactly
        this.
      - **Chosen over a webview `fetch`** so the CSP in `tauri.conf.json` stays as
        it is. Widening `connect-src` would put runtime network access inside the
        webview permanently, for one feature.
      - `reqwest` was already in the tree, and **still no compression features**
        (see the trap list; enabling gzip anywhere corrupts the map cache).
- [x] Settings panel with the disclosure, and the folders panel's privacy copy
      names this as the only other thing that can leave the machine. The checkbox
      re-reads the real state from Rust after every change rather than trusting
      the click, the same as autostart.
- [x] **`js/w3c.js`**, the frontend client. Every call resolves to null on any
      failure, so a shape nobody has seen before reads as "no online data". Two
      lookups: `ongoing(tag)` and `stats(tag)`. `game-mode-stats` returns one row
      per mode and race, and this takes the busiest 1v1 row rather than looking
      for a particular race id, which has moved before. A 404 on an ongoing match
      is the normal state, so it is silent. Anything else is logged once per
      session.
- [x] **Next game** (`js/scout.js` polls, `games-view.js` draws). It is question
      3, "who is this", answered before the game rather than after, so it does
      not belong on Stream.
      - **It shipped first as a band pinned above both columns and that was
        wrong.** It cost 77px of the fold budget whenever it was up, squeezing
        the report to 3px of scroller, and it read as an announcement floating
        over the app rather than a part of it. Now a live match gives the report
        column a `Next game | Last game` switch and takes the whole column. None
        of it exists when no match is running, which is nearly always, so the
        fold budget is untouched in the normal case. That property is the reason
        it was ever a band.
      - Shows opponent, race glyph, MMR, ladder rank and the MMR gap; the map,
        your own record on it and their recent form; your head-to-head. Then
        three cells from `ProfileAggregate.buildProfile`: their opener in this
        exact matchup as bars, their median tier 2 against yours, how often they
        expand. Then every game the two of you have played, which is the one
        scroller on the screen.
      - Opening on Next game latches once per `match.id`, the same rule the
        overlay's reveal uses. A re-poll cannot yank the column away from
        somebody who chose to look at last night's game.
      - Somebody you have never played reads "First time against them" and the
        three cells say "Not enough games", which is itself the useful answer.
      - The ladder is looked up by full battle tag. A stored summary carries
        whatever the replay wrote, so the book is looked up by tag first and by
        bare name second.
      - Polls every 20 s while idle, drops to 60 s once a match is up, and skips
        entirely while the window is hidden to the tray. A watcher-detected
        replay clears it, because that game is over and the report underneath is
        the better thing to look at.
      - An identity with no `#number` cannot be looked up at all. Settings says
        so rather than leaving the panel silently empty forever.
      - `scout.js` renders nothing. It polls, reads the corpus and calls
        `onMatch`, so there is one place that draws a live match.
- [ ] Confirm on a real queue that `ongoing` populates early enough to read during
      the loading screen. Everything above has only run against a stub.
- [ ] MMR/rank/quantile chip in the Coach head band. `w3c.stats()` already returns
      exactly this shape.
- [ ] Results overlay from `/api/matches/search` for games whose winner the parser
      could not read. **Decorate in memory at corpus load and never persist into a
      summary.** Summaries stay pure replay-derived facts.
- [ ] Opponent tags, Porofessor-style short labels like "Fast expo", "never T3",
      "on a 5-loss streak", derived locally, with `aka` for smurfs.
- **Rule for every consumer**: the API is undocumented and unversioned, so a shape
  mismatch or a timeout must render exactly as "switched off". No feature may have
  a W3C-only failure state.

### 8. Linux / SteamOS
- [ ] Build and run there at all.
- [ ] Verify the parser bundle works under WebKitGTK.
- [ ] Wine/Proton prefix detection, with candidates already in `wc3_data_dirs()`.
      The manual folder picker is the fallback and must work.
- [ ] AppImage and Flatpak packaging.

### 9. Housekeeping
- [x] **The updater pointed at a domain the project does not use.** It was worse
      than recorded: `wc3v.net` does not resolve at all, so every "Check for
      updates" was a DNS failure rather than a no-op. Now
      `https://cdn.wc3v.com/desktop/latest.json`, published by the new
      `tools/deploy-desktop.js` (rclone to R2, same remote as `deploy-assets.js`).
      The installer is deliberately not committed, because 15 MB of binary does
      not belong in an open-source git history.
      - That script also enforces what `RELEASING.md` could only ask for. It
        refuses to publish when the `.sig` is missing, since an unsigned build
        looks entirely successful and then cannot be served as an update. It
        refuses a version that is not newer than what is live. It uploads the
        installer before the manifest so clients are never pointed at a 404, and
        fetches both back to confirm.
      - Trap for the next person: `rclone copyto` probes for the bucket and falls
        back to `CreateBucket`, which an R2 token scoped to object read/write
        denies, so the upload dies with a misleading "AccessDenied: CreateBucket".
        `--s3-no-check-bucket` is not optional.
- [x] `tools/desktop-preview.js` now writes `desktop/preview/preview.html`, outside
      `dist`. It used to land inside `frontendDist`, one stray bare
      `cargo tauri build` away from shipping a 150 KB page of fake games to users.
- [ ] Wire `tools/verify-bundle-parity.js` into CI. It is what caught the dead
      inference layer, and a stale bundle is otherwise invisible.
- [ ] `tests/flo-replay.test.js` fails, missing the fixture
      `replays/happy-vs-kaho-turtle-rock.w3g`. Pre-existing and unrelated.
- [ ] 17 Dependabot vulnerabilities on the repo, 1 critical and 7 high.
- [ ] Consider re-parsing and redeploying `client/replays/*.wc3v.gz`. They were
      produced before the determinism and pathfinding fixes.

---

## Tools built during Phase 0

Run any of these with no args for usage.

| Tool | Purpose |
|---|---|
| `tools/detect-identity.js` | Who owns a replay folder, from headers only. `--dir=<Replays>`. Same algorithm the app uses, runnable without launching it. |
| `tools/moments-report.js` | The ranked key moments of a parsed replay, phrased from a chosen seat. `--replay=NAME [--seat=ID] [--all]`. **This is how the ranking gets judged.** Run it on a game you remember, and if the fight you actually recall is missing, the ranking is wrong rather than the UI. |
| `tools/desktop-preview.js` | Writes `desktop/preview/preview.html`: the real desktop frontend, stubbed Tauri IPC, summaries built from real parsed replays. Iterate on the UI in a browser without building the app. Run `build-desktop-client.js` first. `--games=N`, and use 40+ to exercise the trend windows. `--w3c` fakes a live ladder match so Next game renders. |
| `tools/deploy-desktop.js` | Publishes a built installer and `latest.json` to R2. Refuses an unsigned or non-newer build, uploads the installer before the manifest, verifies both afterwards. `--notes="…"` required, `--dry-run` to preview. |
| `tools/test-profile-aggregate.js` | Profile and coach assertions over a synthetic corpus, including the identity tie-refusal guards. |
| `tools/test-game-report.js` | Review-layer assertions: pillar ranges, mistake ranking and capping, benchmark direction, and graceful degradation with no baseline, no combat ledger, or a missing seat. Asserts the *shape*; only a corpus pass tells you the thresholds still mean anything (§11). |
| `tools/verify-bundle-parity.js` | Node source versus committed browser bundle. Catches stale bundles and dynamic-require breakage. `--fast` also proves `skipPathfinding` is forwarded. |
| `tools/check-determinism.js` | Parses N times in clean processes. Must report 0 differing leaves. |
| `tools/diff-wc3v.js` | Structural diff of two parses. `--events` compares build orders as multisets. **Use this to judge any parser change**, not the raw leaf count. |
| `tools/path-quality.js` | Unit-path geometry compare. Answers "did paths get worse" when a big diff is expected. |
| `tools/profile-parse.js` | CPU-profile a parse, rank by self time. |
| `tools/bench-replay-scan.js` | Where scan time goes: walk, stat, hash. |
| `cargo test --release -- --ignored --nocapture` | Real scan benchmark against the machine's own replay folders. |

## Traps that have already bitten this project

- **A raw output diff is not a regression.** Equal-cost A\* ties resolve
  differently, so a harmless change produces 600k+ differing leaves. Index-based
  diffing also cascades, since one inserted event makes every later index look
  wrong. Use `diff-wc3v.js --events`.
- **Debug builds lie about performance.** Hashing was 7.4x slower in debug than
  release, 58 s versus 7.8 s. Measure both before optimising.
- **Dynamic `require()` silently vanishes from the parser bundle**, and the `fs`
  stub makes directory scans no-op. This left the entire inference layer dead on
  the live site. Any plugin-style loading must be a static list of literal
  requires.
- **Tauri runs sync commands on the main thread.** A slow one freezes the window.
  Make it `async` and use `spawn_blocking`.
- **Tauri v2 does not expose `window.__TAURI__`** unless `withGlobalTauri` is
  true, and core plugin commands need explicit capability grants.
- **Rebuild the parser bundle** after any `lib/` or `helpers/` change
  (`npm run build:parser`) or uploads silently use the old parser.
- **Never enable reqwest's `gzip` feature.** The CDN stores `.json.gz` with
  `Content-Encoding: gzip`, so a transparently-decompressing client hands back
  plain JSON, which then gets written under a `.gz` name and fails to inflate at
  parse time. That is a corrupt map cache that looks like a parser bug. Same for
  `deflate`, `brotli` and `zstd`. The bytes off the wire are the file.
- **`rclone copyto` to R2 needs `--s3-no-check-bucket`.** Without it rclone probes
  for the bucket and falls back to `CreateBucket`, which an object-scoped R2 token
  denies, and the error it prints is "AccessDenied: CreateBucket", which reads as
  a credentials problem.
- **A grading constant that has not been run over the corpus is a guess.** Every
  first-pass threshold in `GameReport.js` was wrong in the same direction: too
  eager. "You lost the big fight" fired on 31% of seats because every game has a
  decisive trade and somebody loses it. Run the corpus pass (§11) after touching
  any constant. The unit test asserts the shape and will happily pass with
  meaningless labels.
- **`moments` is capped at 24 by importance and the `combat` ledger is not.**
  Deriving kill and death counts from `moments` silently under-counts any game
  with more than 24 beats, and at most one moment is emitted per battle. Read
  `players[slot].combat` for counts and `moments` for the highlight reel.
- **`momentsFor()` returns its top five in TIME order, not importance order.**
  Reading `[0]` off it to get "the biggest moment" silently gives the earliest of
  the five. Sort `summary.moments` by `importance` yourself.
- **`accent-color` does not style an unchecked checkbox.** It tints the checked
  fill only, and the empty box stays the platform's near-white square, which on a
  dark panel is the loudest thing on screen.
- **Editing an `include_str!`'d file while a build runs ships the OLD one.**
  `overlay.rs` compiles `handoff.html`, `shell.html`, `overlay.css` and
  `overlay-render.js` into the binary. Edit one after the Rust compile has run and
  NSIS still packages happily, and the installer is newer than every source file
  while silently containing the previous version of a page. **A timestamp cannot
  detect this**, because the installer's mtime is when it was packaged rather than
  when its strings were compiled. `tools/deploy-desktop.js` now checks each
  embedded file is present byte-for-byte in the binary and refuses to publish
  otherwise. It has already caught this once for real.
- **`window.open` on a loopback page is blocked 100% of the time**, not
  occasionally. A page opened seconds ago on `127.0.0.1:PORT` has no engagement
  history for the browser to make an exception for. Anything that must open a
  window there needs a real click, and an "attempt it and fall back to a button"
  design is just the button plus a pop-up warning.
- **A W3Champions name without a `#number` is not a ladder identity.** Next game
  keys off `ongoing/{battleTag}`, and a replay saved outside W3Champions carries
  a bare name that the API has nothing to say about. The feature looks broken
  rather than inapplicable unless the UI says which one it is.
- **A stored summary has no per-player camp-clear record.** `neutralCamps` is
  terrain with bounds and a level, and nothing says who took which. Only 126 of
  402 moments across the 40-game preview corpus carry coordinates at all. Any
  map that colours camps by owner is inventing it.
- **The report frame used to grow as the window shrank.** The verdict head and
  the timings panel both wrapped at 612px, so the "fixed" frame took 74% of the
  column at the minimum size and 56% at 1280. If a band in that frame can wrap,
  it is not a fixed band, and the audit will not catch it because wrapping is
  not overflow.
