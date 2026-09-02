# TODO

## Engine

- Starting positions from the map's JASS scripts instead of movement heuristics.
- Unit pathing on the real pathing grid (`lib/PathFinder.js` walks straight lines).
- Backfill: retroactive timings for abilities and items, and export to the right record streams.
- Duplicate and corrupt actions from laggy games.
- Some W3Champions and FLO replays crash early inside `w3gjs`.
- `ReplayValidator.correctTierMismatches()` exists and is not wired in.

## Client

- Malformed `.w3g` uploads show a generic failure.
- Some maps render flat when their textures are missing.
- Mobile: the viewer is desktop-first.
- A shared `?local=ID` link should offer the reader's own copy when they have the same replay.

## Pro library

- Builds in `client/data/replay-wishlist.json` still lack a representative pro game.
- Battle.net's download folder uses hash filenames; `tools/data-tool.js` cannot read those maps yet.

## Compare

- Scoring weights are heuristic and want a calibration pass.
- Skill build divergence on the Heroes tab is visual only.

## Desktop

- Mac and Linux builds.
- Lazy map download for maps outside the bundled ladder pool.
