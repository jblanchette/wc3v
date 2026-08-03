# WC3V Desktop — status and remaining work

Handoff document. Written Aug 2026, after Phase 0.

**Read `desktop/README.md` first** for the design invariants and architecture.
They are not optional — several are the whole reason the project is viable.

---

## Honest status

The parse pipeline is proven. **The product is not built.** A replay can be
found, deduped, and parsed locally — that is all. Nothing is saved, nothing is
shown to a streamer, and nothing has ever reacted to a real game.

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

---

## Checklist

### 0. Verify the premise — DO THIS FIRST
Everything below is wasted effort if the watcher does not fire.

- [ ] Launch the app, play one real game, confirm `replay-detected` fires and
      the replay auto-parses. Nothing in this project has been proven end to end
      until this passes. **This is the one item on this list only a human with
      the game installed can do.**
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

### 3. Profile / coaching layer — the actual product
Build on `client/js/SummaryExtract.js` (dual-runtime, no DOM, no fs — already
produces per-player summaries). Do not write a new extractor.

- [ ] `client/js/ProfileAggregate.js` — pure data, no DOM. Bucket by race,
      matchup, map, opponent, patch window.
- [ ] Derived insights: openings by matchup, timing distributions vs your own
      wins, map win rates, worker/supply habits.
- [ ] Coach panel turning the aggregate into plain statements.
- [ ] Manual opponent lookup (type a name → their profile from your local
      history). No APIs, no scraping — user decision.

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

### 6. Shell polish
- [ ] Tray icon (the `tray-icon` feature is already enabled in `Cargo.toml`
      but nothing uses it).
- [ ] Run on startup, minimise to tray, background parsing with no window.
- [ ] First-run flow: pick folders, seed the map cache.
- [ ] Auto-update.

### 7. Map data
Parsing needs per-map files. Measured: **318.8 MB** for all 202 maps,
~1.7 MB median each (an earlier figure of 137 MB in the plan was wrong — bad
`xargs`/`du` measurement).

- [ ] Lazy per-map download on first parse of that map, cached locally.
- [ ] "Download the current ladder pool" button to pre-warm.
- [ ] Handle the missing-map case gracefully in the UI (the error already
      carries `mapDataName` / `rawMapName`).
- [ ] Today the cache is seeded manually:
      `node tools/build-desktop-client.js --seed-maps=all`

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
