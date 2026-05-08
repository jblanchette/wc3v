# TODO

Things left to finish, sorted by priority.

## wc3v engine

- read and parse JASS scripts from WC3 map files for starting position data (currently uses heuristics from player movement)
- unit pathing based on WC3 pathfinding (currently walking straight lines via `lib/PathFinder.js`)
- backfill action improvements:
  - simulate backfilled actions with retroactive timings (positions OK, ability/item events still rough)
  - ability, shop event, and item event support in backfill
  - export backfill actions to the correct record streams
- improved support for duplicate / corrupted / invalid actions (usually network-related)
- W3C / FLO replays that crash early in `w3gjs` parsing (some `happy-vs-life-*` and `happy-vs-kaho-*` files) — needs upstream fix or workaround
- wire `ReplayValidator.correctTierMismatches()` into the post-processing step (method exists but is unused)

## wc3v client

- player status window groups rendering and selection
- replay upload error handling for malformed `.w3g` files (currently shows generic failure)
- 3D terrain coverage gaps — some maps render flat or with palette-only colors when textures are missing
- mobile UX polish — viewer is desktop-first; homepage and compare modals need responsive passes
- `parser-worker.js` is currently a stub — true off-thread parsing not yet wired in
- `?local=ID` share-link UX is a one-shot overlay; should offer "load my own copy if I have one with the same fingerprint"

## Pro library / data

- replays in `client/data/replay-wishlist.json` still need backfilling (builds without representative pro games)
- some manifest replays don't have summaries in `client/data/summaries/` — `tools/sync-manifest-fingerprints.js` needs a sweep
- Hammerfall map missing from W3C v11 pool — needs manual addition
- Battle.net Download folder uses hash filenames (286 maps) — `tools/data-tool.js` doesn't yet support hash-named maps

## Compare engine

- scoring weights are heuristic — need a calibration pass against more user submissions
- `Heroes` tab doesn't yet score skill build divergence numerically (visual comparison only)
- per-tournament context for findings (e.g. "in the meta of WGL Summer '25, fast expand was favored")

## Social / community (long-term)

- support for replay commenting and timestamped notes
- shareable replay URLs that work across devices (would require a server)
- replay commentating support — synced VO + cursor

## Done (kept here for reference)

These were on the original TODO and have shipped:
- ✅ Build order panel redesign (supply-indexed, dark theme, esports style)
- ✅ Layout modes (gameplay / static-bo / live-bo)
- ✅ In-browser parsing (UploadManager + parser bundle)
- ✅ Worker tracking with race-specific mechanics
- ✅ Hero tracking with levels, skills, items, revives
- ✅ Research / upgrade tracking (90 upgrades)
- ✅ Expansion detection
- ✅ Replay validator
- ✅ 3D terrain rendering
- ✅ Compare-to-pro flow with letter grades
- ✅ My Replays library with IndexedDB storage
- ✅ Pro replay manifest with tournament filtering
