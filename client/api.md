---
title: "Replay Data API | WC3V"
url: https://wc3v.com/api
description: "A free, read-only JSON API over 192 parsed Warcraft III tournament replays. No keys, no auth, no rate limits. OpenAPI 3.1 description included."
updated: 2026-08-31
---

# Replay Data API

192 parsed Warcraft III tournament games as JSON. Free, read-only, no keys and no sign-up.

Everything here is a static file served from the same origin as the site. There is no authentication, no rate limiting beyond ordinary CDN behaviour, and nothing to register for. Machine-readable description: [OpenAPI 3.1](https://wc3v.com/api/openapi.json).

## Endpoints

| Endpoint | What it is

| `GET /data/summaries-index.json` | One entry per replay: map, duration, matchup, and each player's race, first hero and timings. Start here.

| `GET /data/summaries/{replayId}.json` | One game in full, including the opening build sequence and everything researched.

### Example

```

curl https://wc3v.com/data/summaries-index.json

curl https://wc3v.com/data/summaries/2458063746_Eer0_FoCuS_Shattered-Exile.json

```

Races are single letters: `H` Human, `O` Orc, `E` Night Elf, `U` Undead. Matchups are two race letters joined by `v`, alphabetically ordered, so Night Elf against Undead is `EvU` regardless of who is asking.

## Read the field notes before you trust a timing

**Tier timings are inferred, not measured.** `tier2Sec` and `tier3Sec` record when the parser first observed a player at that tier from selection data, which can happen before the tier upgrade actually completes. Across this corpus the associated building lists contain tier-1 buildings, and the medians run 2 to 3 minutes for Orc, Night Elf and Undead against roughly 5 minutes for Human, which is not a real racial difference. Use them for ordering within a single game if you must, but do not present them as tech benchmarks. `heroTimeSec` is consistent across races and is the timing to rely on.

The index response carries a `fieldNotes` object saying this in machine-readable form. If you build on this data, read it.

## What is in the corpus

Tournament games from 12+ events, parsed by [WC3V's own parser](https://github.com/jblanchette/wc3v). Player names are the tournament handles recorded in the replay files themselves.

Parser test fixtures are excluded. The `client/data/summaries/` directory in the repository holds around 142 of them alongside the real games, and they are filtered out of the published index: including them would have been a false claim about the corpus, and it dragged the 25th-percentile game length down to 73 seconds.

No visitor data appears anywhere in this API. Replays dropped on the site are parsed in the browser and never uploaded, which is covered in the [privacy policy](https://wc3v.com/privacy).

## Stability

- Changes to documented fields are additive. New optional fields may appear at any time, so parse permissively.

- No documented field will be removed or change type without 90 days of notice.

- Notice appears here and in a `deprecations` array on the affected document.

- Fields not described in the OpenAPI document are not covered and may change without warning.

## What is deliberately not in the contract

Plenty of other JSON is reachable under `/data/`. It is public because the site is static, not because it is an API, and it is excluded on purpose:

| Path | Why not

| `/data/builds-manifest.json` | The curated build library. Its shape is coupled to how the homepage renders cards and changes with the design. Read the builds at [/builds](https://wc3v.com/builds) or as Markdown at `/builds/<id>.md` instead.

| `/data/builds-cards.json` | A render-time derivative, regenerated on every deploy.

| `/data/unit-balance-lite.json` | Derived from Blizzard's own game data and changes with WC3 patches. It powers tooltips; presenting it as "the WC3V API" would misrepresent whose data it is.

| `/data/fx-units.json`, `/data/map-folders.json` | Renderer internals.

| `/data/replay-wishlist.json` | An editorial to-do list.

| `/asset-manifest.json` | Deploy-internal content hashes.

## Other machine-readable entry points

- [/llms.txt](https://wc3v.com/llms.txt) — index of every page, for agents

- [/.well-known/agent-skills/index.json](https://wc3v.com/.well-known/agent-skills/index.json) — skills this site publishes

- [/.well-known/api-catalog](https://wc3v.com/.well-known/api-catalog) — RFC 9727 catalog

- Every page has a Markdown twin at the same URL with `.md` appended, and answers `Accept: text/markdown`

## Attribution and licence

The code is [GPLv3](https://github.com/jblanchette/wc3v/blob/master/LICENSE.md). If you build something on this data, a link back to [wc3v.com](https://wc3v.com/) is appreciated and not required.

Warcraft III and all related assets are trademarks of Blizzard Entertainment. WC3V is a fan-made, non-commercial tool and is not affiliated with or endorsed by Blizzard.
