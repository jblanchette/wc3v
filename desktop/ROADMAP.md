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
to completion so the real parse rate is still unmeasured. The UI is also
still the diagnostic spike — §5 is untouched.

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
| Parser determinism | `tools/check-determinism.js` — 0 differing leaves over N runs |
| Bundle matches source | `tools/verify-bundle-parity.js` — 0 shapes unique to the bundle |
| Parser speedups are safe | `tools/diff-wc3v.js --events` — no build-order/tier/economy event changed |

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
- [ ] Point a real OBS Browser Source at it. Transparency, reconnect
      behaviour and text sizes on stream are unverified until then.

### 4. Overlay + OBS — the streamer feature
Nothing exists yet. This is the #1 target audience and is entirely unbuilt.

- [ ] `overlay.html` — transparent background, read-only, SSE-driven.
- [ ] Loopback HTTP server on `127.0.0.1`: random port, per-install token in
      the URL, read-only endpoints, no CORS, no write path. OBS Browser Source
      is a separate Chromium process and cannot read the app's state any other
      way.
- [ ] "Copy OBS Browser Source URL" button, size presets, a few themes.
- [ ] Panels: last-game verdict, build order, key timings, session W/L, streak.
- [ ] Player-facing variant in a normal window for a second monitor.

### 5. UI and visual design — currently a diagnostic spike
`desktop/src-frontend/` is deliberately plain: three columns, a log, no design.
It was built to prove the pipeline, not to be seen.

- [ ] Full visual pass. Use the `wc3v-design-architect` agent.
- [ ] Follow the established art direction: **earthy, carved, muted. No neon
      glow, no saturated primaries.** "Restrained modern" has been explicitly
      rejected before — see the WC3 art-direction note in project memory.
- [ ] Respect the existing UI rules: no font below 0.8rem, no icon below 36px,
      no single-edge border accents, no ellipsis truncation.
- [ ] **Never render filesystem paths.** Folders are "Replay folder 1/2" and
      the map cache is "local app data". Paths contain the user's account name
      and this window is aimed at streamers. Paths are kept out of the DOM too,
      not just off screen — list rows carry an index.
- [ ] Consider sharing CSS tokens with the web client rather than a second
      design system.

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
| `tools/verify-bundle-parity.js` | Node source vs committed browser bundle. Catches stale bundles and dynamic-require breakage. |
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
