# WC3V Desktop — status and remaining work

Handoff document. Written Aug 2026, after Phase 0.

**Read `desktop/README.md` first** for the design invariants and architecture.
They are not optional — several are the whole reason the project is viable.
`desktop/RELEASING.md` covers building, shipping and updating.

Run it with `npm run desktop`. Build an installer with `npm run desktop:build`.

---

## Honest status

**The core premise is proven.** On 3 Aug 2026 a real 1v1 was played with the
app open: it was detected, parsed, stored and pushed to the overlay without
anyone touching anything, and a real browser rendered the verdict live. That
was the one thing this whole project rested on.

Still unmet by reality: no OBS has rendered the overlay (transparency in
CEF specifically), no upgrade has been taken, and the backfill has never run
to completion so the real parse rate is still unmeasured.

**The UI is no longer the spike.** §5 is built: the window is a feed of your
games with a detail card per game (verdict, timings, key moments, head-to-head,
both build orders), and folders/backfill/log have moved to Settings and a
collapsible Activity drawer. §4 gained selectable panels, an in-window preview
and a test game. What has NOT happened is a full pass through the real app —
everything below was verified against real replay data in
`tools/desktop-preview.js`, which stubs Tauri IPC but runs the app's own
modules, CSS and renderers unmodified.

### What is verified, and how

| Thing | Evidence |
|---|---|
| Parser runs unmodified in WebView2 | parsed a real 475 KB replay in 12.3 s in the app window |
| Replay discovery | found 4,875 files across 2 Battle.net account folders |
| Dedupe | 4,875 → 4,127 unique; the 748 were the nested duplicate tree + `LastReplay.w3g` |
| Scan performance | 230 ms to list on screen, 162 ms warm repeat (`cargo test --release -- --ignored --nocapture`) |
| Watcher mechanics | 7 tests in `watcher.rs` drive the real loop against simulated progressive writes: debounce, content dedupe, stale-cache invalidation, all three `LastReplay.w3g` orderings |
| `LastReplay.w3g` ≠ its autosave | checked against the real corpus: no autosave even *shares its size*, so content-hash dedupe can never collapse it (the watcher holds it for a 30 s grace window instead) |
| Parse persistence | summaries stored per content key, re-opened games load from store instead of re-parsing |
| Profile aggregation | `node tools/test-profile-aggregate.js` — records from both seats, matchup buckets, timing splits, statement min-n guards |
| Overlay server | `overlay::tests` — token required on every route, GET-only, SSE delivers published state to an already-connected client |
| Overlay in a real browser | connected Chrome tab updated to the correct verdict and build order with no refresh, via EventSource auto-reconnect, after the app restarted under it |
| Identity detection | `node tools/detect-identity.js` on the reference 3,598-replay folder — owner in 100% of 40 sampled, runner-up 68% |
| Parser determinism | `tools/check-determinism.js` — 0 differing leaves over N runs |
| Bundle matches source | `tools/verify-bundle-parity.js` — 0 shapes unique to the bundle |
| Parser speedups are safe | `tools/diff-wc3v.js --events` — no build-order/tier/economy event changed |
| Key moments are real moments | `node tools/moments-report.js --replay=NAME` over several pro games — the ranked list matches the actual shape of each game (hero snipes, the wipe that ended it, the expansion) |
| Moments fit the summary budget | 1.2–3.8 KB of raw JSON per game, well under a KB gzipped |
| The UI renders against real data | `tools/desktop-preview.js` builds summaries from `client/replays/*.wc3v.gz` and runs the app's real modules in a browser; feed, detail, moments, profile, settings and the overlay preview all render with zero console errors |
| **Browsers block wc3v.com → 127.0.0.1** | measured against the live loopback server from an `https://wc3v.com` tab: `fetch` hangs pending and never settles, an iframe ends `net::ERR_ABORTED`. This is why the handoff starts on the loopback origin (§10) |
| Overlay stays self-contained after the split | `overlay::tests::overlay_page_has_its_css_and_renderer_inlined` — placeholders replaced, no external `<script src>` or `<link>` |
| Handoff routes are safe | `overlay::tests` — token required, bytes served verbatim, unknown ids 404, pending replays capped |

### What has NEVER been tested

- **The watcher firing on a real game.** Its mechanics are now under test with
  simulated writes (see checklist 0), but no game has been played with the app
  open. The whole premise ("finish a game, it just appears") is unverified
  until that happens — in particular whether 1.5 s `SETTLE` and the 30 s
  `LAST_REPLAY_GRACE` match how the real game writes.
- Anything on Linux or SteamOS. Never compiled or run there. WebKitGTK is a
  different engine from WebView2 and is the single biggest portability unknown.
- Any behaviour over a long session, across sleep/wake, or with the game running.
- **The overlay inside a real OBS.** The server and SSE flow are tested over
  raw sockets, but no OBS Browser Source has ever rendered the page.
- **The rebuilt UI inside the real app window.** Every screen has been driven in
  a browser against real replay summaries, but not once through Tauri itself.
- **The viewer handoff end to end** (§10). Both halves exist and each was
  checked alone; the joined-up path needs the site deployed and the app rebuilt.

---

## Checklist

### The things only a human can do

1. ~~Play one real game with the app open~~ — **DONE 3 Aug 2026, it worked.**
   See §0.
2. **Point a real OBS Browser Source at the overlay** (§4). The page and the
   live-update path are now verified in real Chrome (connected tab updated to
   "Victory" with no refresh, via EventSource auto-reconnect), but OBS runs
   its own CEF build and *transparency* specifically is still unverified.
3. **Take one real upgrade** (§6). Install N-1, publish N, confirm it lands.
   Needs the endpoint to exist first.
4. **Run the backfill once** (§2) for the real end-to-end rate — and it also
   settles profile identity permanently as a side effect.

---

### 0. Verify the premise — DO THIS FIRST
Everything below is wasted effort if the watcher does not fire.

- [x] **PASSED, 3 Aug 2026.** A real 1v1 was played with the app open:
      `Replay_2026_08_03_1400.w3g` (137 KB) was detected, auto-parsed, its
      summary persisted (`137081-a68ebbf238065ebf`) and published to the
      overlay ~34 s after the game wrote. Both the autosave and
      `LastReplay.w3g` were written and collapsed to a single detection.
      The premise holds.
      - Note: for THIS game the two files were byte-identical, so content
        dedupe caught it and the grace window was not exercised in anger.
        The earlier corpus finding (differing sizes) came from a stale
        `LastReplay.w3g` left over from an older game. Both paths are
        covered by tests; only the identical case has been seen live.
      - Bug this surfaced: the overlay showed "Game over" instead of
        "Victory". The winner WAS parsed (`reason0c`, high confidence) — the
        app had simply never worked out which seat was the user, because it
        only tried at boot when the store was empty. Fixed in `7ed0ef7`.
- [x] Confirm the debounce is right. *Mechanism verified*: `watcher.rs` tests
      write progressively with gaps shorter than the settle window and assert
      exactly one announcement carrying the final size. Whether the 1.5 s
      `SETTLE` value matches the real game's write cadence still needs the
      real-game pass above.
- [x] Confirm `LastReplay.w3g` and the `Autosaved\Multiplayer\Replay_*.w3g`
      copy of the SAME game produce exactly one `replay-detected`.
      **Finding (real corpus): the two are NOT byte-identical — no autosave
      even shares LastReplay's size — so hash dedupe could never collapse them
      and every game would have announced twice.** Fixed: a settled
      `LastReplay.w3g` is held for `LAST_REPLAY_GRACE` (30 s); any other
      announcement inside the window cancels it, and a lone one (autosaving
      off) announces when the window expires. All three orderings tested.
- [x] Check behaviour when the game is mid-write and the app starts.
      *Simulated*: a file partially written before watcher start announces
      once, with the final size, after writes stop. Also fixed along the way:
      overwriting a watched file (which `LastReplay.w3g` does every game) now
      invalidates its cached hash and size entry — the stale cache both
      double-announced new games and could swallow one whose content matched
      a stale hash.

### 1. Persist parses — DONE (summaries, not full parses)

- [x] Retention decision: the full `.wc3v` is **not** persisted — 3,072 of
      them is gigabytes. What survives is one gzipped `SummaryExtract` summary
      per unique game (`<app_data>/replays/<key>.summary.json.gz`, a few KB),
      the same per-player shape the site's compare modal and pro summaries
      use, which is exactly what the profile layer (§3) aggregates. The raw
      `.w3g` stays the source of truth; full viewing re-parses on demand.
- [x] Keys are `<size>-<xxh3>`, computed by the `replay_key` command at parse
      time. The scan's lazy `<size>-u` keys are NOT used — they mutate the
      first time another file collides on size, and a store key must never
      change. Hashing at parse time is noise next to the parse itself.
- [x] Skip re-parsing anything already stored — `run()` checks the key first
      and renders from the store (`showSummary`). Content-keyed, so the same
      game under a second path also hits.
- [x] Rust commands: `save_parse` (atomic temp+rename, strict key charset),
      `read_parse`, `list_parses`. All async — Defender scans new files on
      write, and a sync command would hold Tauri's main thread.
- [x] **Schema v2 adds `moments`** — the ranked big beats of the game
      (`client/js/MomentsExtract.js`). This is the one thing in the summary
      that cannot be recovered later: fights live in `world.battles`, which
      only exists in a full parse, and `SummaryExtract` never touched it. So it
      is extracted at parse time, while the parse is still in hand. Measured
      cost: 1.2–3.8 KB of raw JSON, under a KB gzipped.
      - A game stored under v1 renders its timings and offers a **"Find
        moments"** button that re-reads that single replay, rather than showing
        an empty list that reads as "nothing happened".
      - `store.persistSummary` REPLACES a corpus entry on re-parse instead of
        appending — a duplicate would inflate every profile record it feeds.
- Note for §3/§2: two *different encodings* of the same game (LastReplay vs
  its autosave) have different keys, so the store can hold both if one is
  clicked manually. The profile layer should dedupe by the summary
  fingerprint (map + duration + sorted names), like the site does.

### 2. Backfill engine — BUILT, unmeasured
3,072 playable replays exist locally, going back to Feb 2020. User decision on
record: **parse everything, in the background, resumable.**
Engine lives in `desktop/src-frontend/js/backfill.js`; "Parse all replays"
button in the left column.

- [x] Queue with persisted progress so it survives restarts. **The store IS
      the progress**: queue = cross-root deduped scan (`scan_all`) minus
      stored summary keys minus `.failed.json` markers. No queue file to
      drift or corrupt; pause/restart resumes by construction. Failure
      markers stop known-bad replays retrying every run; "Retry N failed"
      clears them (the recovery path after seeding more maps).
- [x] **2 low-priority workers.** No WC3-process detection, per the decision.
      Newest-first order so recent games power the profile immediately.
      `LastReplay.w3g` is excluded — it is a second encoding of a game whose
      autosave is already queued, and would double-count in the profile.
- [x] `skipPathfinding: true`. **Found and fixed en route: the bundle entry
      (`parserEntry.js`) silently dropped unknown options, so the fast mode
      never reached `doParsing` from the browser/desktop path at all.**
      Now forwarded, and `verify-bundle-parity.js --fast` runs BOTH parsers
      in profile mode — parity holds, which proves the passthrough end to
      end. Bundle rebuilt.
- [x] Progress UI honest about remaining time: no ETA until ≥5 parses have
      actually been measured, then a median-based estimate labelled "(rough)".
- [ ] Measure the real end-to-end rate — needs a real run on the real
      machine. The completion log line prints the measured s/replay
      end-to-end figure; quote nothing until it has printed once.

### 3. Profile / coaching layer — BUILT (spike render)
Built on SummaryExtract summaries, as required — no new extractor.

- [x] `client/js/ProfileAggregate.js` — pure data, dual-runtime. One function
      is the whole model: `buildProfile(games, name)` — a profile is just a
      name, so "my profile" and opponent lookup are the same code path.
      Buckets: race, matchup, map, opponent, patch (subheader version), plus
      playedAt-ordered recent form. Tested: `node tools/test-profile-aggregate.js`
      (synthetic corpus, asserts records from both seats + statement guards).
- [x] Derived insights: openings by matchup with win rates, T2 timing
      distribution in wins vs losses (overall and per matchup), map win
      rates, expansion habit + expand/no-expand records, workers-at-5:00
      split from economyTrack.
- [x] Coach panel: `statements()` emits plain sentences, every one carrying
      its n, with hard minimum-sample guards (a claim below minimum n is not
      made at all). Rendered as text in the result panel — §5 owns design.
- [x] Manual opponent lookup: type a name (autocomplete over every name in
      the corpus) → their profile from local history. No APIs, no scraping.
- [x] **Identity detection** — which player is "you", which every verdict
      depends on. Nothing in the .w3g format marks the saving seat, but the
      owner is in *every* replay in their own folder while opponents appear
      once or twice. `Wc3vParser.peekPlayers()` reads names from the replay
      HEADER only (~50 ms, no game parse), and the app samples 40 autosaved
      replays spread across the whole history. Measured on the reference
      folder: owner 100% of 40, second place 68%.
      - Autosaved only — the Replays root also holds downloaded games the
        user was never in.
      - Auto-detection is provisional; an explicit pick is confirmed and is
        never overridden. The picker lists real candidate names as buttons
        and is always visible, so a wrong guess is one click to fix.
      - `node tools/detect-identity.js --dir=<Replays>` runs the same
        algorithm standalone to check a folder without launching the app.
      - **This got shipped wrong once**: detection ran over the parsed store
        (one game on a fresh install) and a prefilled text box then committed
        the arbitrary first name, so the app decided the user was their
        opponent and reported a loss as "Victory". Frequency over the corpus
        is the signal; a single game cannot distinguish the seats at all.
- Summary schema additions for this: `playedAt` (replay file mtime — when the
  game was PLAYED; `savedAt` is when the backfill reached it) and
  `patchVersion`. Results exist only for 1v1 (`winner` is 1v1-only);
  team games count toward games/maps but carry no result.
- [ ] Corpus load reads every summary through IPC one at a time (raw-bytes
      responses now, so it is bytes-cheap, but still ~3k invokes). Fine at
      current scale; revisit if profile open ever feels slow.

### 4. Overlay + OBS — BUILT, never shown in a real OBS
- [x] `overlay.html` — transparent background (opaque in `?view=panel`),
      read-only, SSE-driven, self-contained (no external requests). Themes
      `?theme=carved|slate`, `?scale=N`. Served embedded from the binary.
- [x] Loopback server (`overlay.rs`): hand-rolled on std::net — ~200
      auditable lines, no HTTP dependency. 127.0.0.1 only, per-install token
      on every route, GET only, three routes (`/overlay`, `/events` SSE,
      `/state`), no CORS, no write path. Port persists across restarts so
      the OBS URL survives; token persists per install. Tested over real
      sockets (`overlay::tests`), including an SSE-registration race the
      test caught: greeting and registration now happen under the clients
      lock so a concurrent publish cannot be missed.
- [x] "Copy OBS Browser Source URL" button (clipboard only — the URL carries
      the token and this window may be on camera; it is never rendered or
      logged). Suggested source size logged with it.
- [x] Panels: last-game verdict, build order (first 12), key timings
      (opener/T2/expand/tower), session W/L, streak. Session counts ONLY
      watcher-detected live games — clicking through history never touches
      the on-stream score. Verdicts are scored from the profile name's seat
      ("This is me" button sets it; auto-detected from the corpus otherwise).
- [x] Player-facing variant: "Open player view" opens `?view=panel` in the
      default browser (second monitor).
- [x] **Split into three files** — `overlay/{shell.html,overlay.css,
      overlay-render.js}`, stitched back into one self-contained document by
      `overlay.rs` at request time. The point is that the Stream screen's
      preview renders from the *same* css and renderer; a preview drawn by
      separate code is a preview that can lie. A test asserts the seam.
- [x] **Selectable panels**: `session,verdict,h2h,moments,build` via a
      `modules=` param, so the OBS URL carries its own config and survives a
      scene copy. Unknown names are dropped, not fatal — an older pasted URL
      keeps working. The UI refuses to leave zero panels on.
- [x] **Head to head**: "all time vs <opponent> 3–2", counted over the whole
      stored history. Nothing else on a stream can show this, because it was
      learned from the streamer's own games.
- [x] **Key moments ticker**: the top 5 beats with timestamps, phrased in
      `overlay-state.js` where the seat is known, so the app and the broadcast
      never word the same fight differently.
- [x] **Live preview + "Send a test game to OBS"** on the Stream screen. The
      preview sits on a transparency checkerboard (a preview on a solid panel
      hides exactly the mistake it exists to catch), and the fake game is
      labelled *on the overlay itself* — an unlabelled fake result on a live
      stream would be indefensible.
- [ ] Point a real OBS Browser Source at it. Transparency, reconnect
      behaviour and text sizes on stream are unverified until then.

### 5. UI and visual design — BUILT
The window is **a feed of your games**, not a file browser. That reframing is
the whole change: the app used to open on the machinery (folders, scan buttons,
a log) instead of on the thing anyone installed it for.

- [x] Games feed grouped by day, newest first, built from the stored summaries.
      Each row: verdict plaque, opponent, matchup, map, duration.
- [x] Game detail: verdict, **Open in viewer** as the primary action, timings
      strip, **key moments** with per-moment Watch buttons, head-to-head
      against that opponent from local history, both build orders.
      - "Open in viewer" sits with the game header, not in the moments list.
        It was in the list first, which put it behind two early returns (no
        moments, or a pre-v2 summary) — and since every already-stored game is
        v1, that meant no existing game could be opened in the viewer at all.
        Watching the game is an action on the GAME; jumping to a moment is the
        refinement.
- [x] Profile screen rendered as panels and tables instead of a `<pre>`.
      Settings screen owns folders, history parsing, startup and updates.
      The log is a collapsed Activity drawer.
- [x] Shares `client/css/tokens.css` with the web client (copied in by
      `tools/build-desktop-client.js`) — one design system, not two. The
      desktop sits in the WARM half of it: `--vc-*` rails and `--dom-*`
      carved accents, never the site's navy chrome. Only the warm ink ramp is
      new, because tokens.css has no text colours tuned for brown.
- [x] Art direction held: earthy, carved, muted. Depth comes from a hard dark
      outline, a 1px struck highlight and inset shadow. No glow anywhere.
- [x] UI rules held: nothing below 0.8rem, no icon below 36px, no single-edge
      accents (the verdict is a plaque, not a stripe), no ellipsis truncation.
- [x] **No filesystem path is rendered, or in the DOM.** Folders are "Replay
      folder 1/2", the map cache is "local app data", and the rows carry an
      index that the click handler closes over.
- [x] **Failures of a clicked action are visible where the user is looking.**
      They used to go only to `log()`, i.e. into the Activity drawer, which is
      collapsed by default — so a primary action that failed looked like a dead
      button. `failed()` now puts the reason in the status bar in red AND opens
      the drawer.
- [ ] Drive it once through the real Tauri window rather than the preview.
- Note: `node tools/desktop-preview.js` writes `desktop/dist/preview.html`,
  which runs the real frontend against summaries built from real replays.
  That is how the UI is iterated on without launching the app.

### 10. Open in the viewer — BUILT, not yet joined up
Clicking a moment opens the game in the real 3D viewer on wc3v.com, seeked to
that second. No upload, no account: the replay goes from this process to the
browser over loopback.

- [x] `?at=<ms|m:ss>` on the viewer (`client/js/app.js`, `_maybeSeekFromUrl`),
      applied at the end of `setup()` where the scrubber, chapters and cameras
      all exist. **The param is `at`, not `t`** — `?t=` is already the dev
      cache-buster on script and replay fetches.
- [x] Fixed en route: the scrubber's battle markers set `gameTime` directly
      instead of calling `seekToGameTime`, so clicking one moved the scrubber
      without resyncing unit state. Battle Report rows never had this bug.
- [x] **The handoff mechanism was chosen by measurement, not by guessing.**
      Three candidates; two are impossible. From an `https://wc3v.com` tab
      against the live loopback server: a direct `fetch` hangs pending forever,
      and an iframe ends in `net::ERR_ABORTED`. Chrome gates public → private
      network access. So the browser must START on the loopback origin.
- [x] `open_in_viewer` (Rust) reads the replay scoped to registered roots,
      stages it in memory, and opens `http://127.0.0.1:PORT/open?...` in the
      default browser. Staging happens in-process from a Tauri command — the
      HTTP surface is still read-only.
- [x] `desktop/src-frontend/handoff.html` — the launcher. Fetches the bytes
      same-origin and pushes them to `https://wc3v.com/handoff` with
      `postMessage` (private → public, allowed, and no CORS needed). One click,
      because `window.open` without a user gesture is popup-blocked; it is
      attempted automatically first and the button is the fallback.
- [x] `client/handoff.html` — the landing pad. Receives the bytes, parses them
      with the existing `UploadManager`, stores them in `MyReplays`, then
      redirects to `/viewer?local=<id>&at=<ms>`. Remembers the desktop's content
      key → local id in localStorage, so the second moment you click on the same
      game skips the handoff and the re-parse entirely.
- [x] Staged replays expire after 10 minutes and are capped at 4. Deliberately
      NOT single-use: the launcher is a page a user can reload, and a dead link
      on refresh buys nothing the token does not already.
- [ ] Walk it end to end once the site is deployed and the app rebuilt.
- [ ] `render.yaml` needs no route for `/handoff` (Render serves extensionless
      HTML already, same as `/welcome`) — confirm on the first deploy.

### 6. Shell polish — BUILT
The app is now something a person installs and runs, not a dev loop.
Entry points are `npm run desktop` / `npm run desktop:build`; the release and
update process is documented in `desktop/RELEASING.md`.

- [x] Tray icon: left-click or "Open WC3V" restores the window, "Quit" is the
      only thing that exits.
- [x] Minimise to tray + background parsing with no window. Closing the
      window hides it — the whole point is to keep watching while you play.
- [x] Run on startup (`tauri-plugin-autostart`), toggled in-app. Launching
      via the OS passes `--autostart` and opens straight to the tray. The UI
      re-reads the real OS state after every toggle rather than trusting the
      click.
- [x] First-run flow: the ladder map pool (48 folders, ~50 MB) is bundled
      into the installer and seeded into the map cache on first launch, so a
      fresh install parses ladder games offline immediately. Existing cache
      files are never overwritten. Folder discovery already ran at boot; the
      manual picker covers anything it misses.
- [x] Auto-update (`tauri-plugin-updater`): signed packages, public key
      compiled into the binary, private key at `~/.tauri/wc3v-updater.key`
      (gitignored by pattern — **back it up; losing it ends updates for
      every existing install**). Builds made without an endpoint report
      "updates not configured" rather than implying they are current.
- [ ] Point `plugins.updater.endpoints` at a real URL and walk one upgrade
      end to end (install N-1, take the update). Currently
      `https://wc3v.net/desktop/latest.json`, which does not exist yet.

### 7. Map data
Parsing needs per-map files. Measured: **318.8 MB** for all 202 maps,
~1.7 MB median each (an earlier figure of 137 MB in the plan was wrong — bad
`xargs`/`du` measurement).

- [x] Ladder pool ships in the installer and seeds on first run (§6) — 48
      folders, 49.8 MB, covering every version variant of the competitive 1v1
      maps. This removes the manual seeding step for normal use.
- [x] Missing-map case is already handled in the UI: the error carries
      `mapDataName` / `rawMapName` and is reported as a named missing map,
      not a mystery failure. The backfill records it as a failure marker and
      "Retry failed" re-runs those after more maps arrive.
- [ ] **Blocked on a hosting decision.** Lazy per-map download needs a public
      URL for map parse data; today it is only served from the web client's
      own origin (`/maps/<name>/…` via the Vercel rewrite), and the desktop
      app makes no outbound requests at all. Decide where map data lives
      before building the fetch path.
- [ ] "Download the current ladder pool" button to pre-warm (same blocker).

### 8. Linux / SteamOS
- [ ] Build and run there at all.
- [ ] Verify the parser bundle works under WebKitGTK.
- [ ] Wine/Proton prefix detection (candidates already in `wc3_data_dirs()`);
      the manual folder picker is the fallback and must work.
- [ ] AppImage + Flatpak packaging.

### 9. Housekeeping
- [ ] **The updater points at a domain the project does not use.**
      `tauri.conf.json` and `RELEASING.md` say `wc3v.net`; the site and CDN are
      `wc3v.com` (`render.yaml`). An update endpoint on a domain that serves
      nothing is a silent no-op for every install, so decide which is intended
      and make them agree before shipping an installer.
- [ ] Wire `tools/verify-bundle-parity.js` into CI. It is what caught the dead
      inference layer, and a stale bundle is otherwise invisible.
- [ ] `tests/flo-replay.test.js` fails — missing fixture
      `replays/happy-vs-kaho-turtle-rock.w3g`. Pre-existing, unrelated.
- [ ] 17 Dependabot vulnerabilities on the repo (1 critical, 7 high).
- [ ] Consider re-parsing and redeploying `client/replays/*.wc3v.gz`; they were
      produced before the determinism and pathfinding fixes.

---

## Tools built during Phase 0

Run any of these with no args for usage.

| Tool | Purpose |
|---|---|
| `tools/detect-identity.js` | Who owns a replay folder, from headers only. `--dir=<Replays>`. Same algorithm the app uses, runnable without launching it. |
| `tools/moments-report.js` | The ranked key moments of a parsed replay, phrased from a chosen seat. `--replay=NAME [--seat=ID] [--all]`. **This is how the ranking gets judged** — run it on a game you remember; if the fight you actually recall is missing, the ranking is wrong, not the UI. |
| `tools/desktop-preview.js` | Writes `desktop/dist/preview.html`: the real desktop frontend, stubbed Tauri IPC, summaries built from real parsed replays. Iterate on the UI in a browser without building the app. Run `build-desktop-client.js` first. |
| `tools/test-profile-aggregate.js` | Profile/coach assertions over a synthetic corpus, including the identity tie-refusal guards. |
| `tools/verify-bundle-parity.js` | Node source vs committed browser bundle. Catches stale bundles and dynamic-require breakage. `--fast` also proves `skipPathfinding` is forwarded. |
| `tools/check-determinism.js` | Parses N times in clean processes; must report 0 differing leaves. |
| `tools/diff-wc3v.js` | Structural diff of two parses. `--events` compares build orders as multisets — **use this to judge any parser change**, not the raw leaf count. |
| `tools/path-quality.js` | Unit-path geometry compare. Answers "did paths get worse" when a big diff is expected. |
| `tools/profile-parse.js` | CPU-profile a parse, rank by self time. |
| `tools/bench-replay-scan.js` | Where scan time goes (walk/stat/hash). |
| `cargo test --release -- --ignored --nocapture` | Real scan benchmark against the machine's own replay folders. |

## Traps that have already bitten this project

- **A raw output diff is not a regression.** Equal-cost A\* ties resolve
  differently, so a harmless change produces 600k+ differing leaves. Index-based
  diffing also cascades: one inserted event makes every later index look wrong.
  Use `diff-wc3v.js --events`.
- **Debug builds lie about performance.** Hashing was 7.4x slower in debug than
  release (58 s vs 7.8 s). Measure both before optimising.
- **Dynamic `require()` silently vanishes from the parser bundle**, and the
  `fs` stub makes directory scans no-op. This left the entire inference layer
  dead on the live site. Any plugin-style loading must be a static list of
  literal requires.
- **Tauri runs sync commands on the main thread.** A slow one freezes the
  window. Make it `async` and use `spawn_blocking`.
- **Tauri v2 does not expose `window.__TAURI__`** unless `withGlobalTauri` is
  true, and core plugin commands need explicit capability grants.
- **Rebuild the parser bundle** after any `lib/` or `helpers/` change
  (`npm run build:parser`) or uploads silently use the old parser.
