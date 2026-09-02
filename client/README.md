# WC3V web client

The browser side of [WC3V](../README.md). Plain JS, no build step, no
modules: scripts load through `<script>` tags in order and every subsystem
hangs off `window`. D3 v5, RBush v2 and Three.js r160 come from CDN.

## Pages

| Page | Purpose |
|---|---|
| [index.html](index.html) | build library, your replays, inline compare |
| [viewer.html](viewer.html) | the replay viewer |
| [replays.html](replays.html) | every replay stored in this browser |
| [learn.html](learn.html) | build finder |
| [download.html](download.html) | the desktop app |
| [about.html](about.html), [community.html](community.html) | site pages |

[SiteNav.js](js/SiteNav.js) renders the shared header.

## Viewer

[Wc3vViewer](js/app.js) in `app.js` is the coordinator. It owns setup,
playback, layout switching and the render loop, and delegates everything else
to a subsystem class. New features go in a new class, with dependencies
passed in, not into `app.js`.

| Subsystem | Role |
|---|---|
| [ThreeMapRenderer](js/ThreeMapRenderer.js) | terrain, lighting, fog, 3D scene |
| [UnitModelRenderer](js/UnitModelRenderer.js) | skinned unit models, selection hoops, rings |
| [MapRenderer](js/MapRenderer.js) | 2D canvas: grid, camps, neutral buildings |
| [ClientPlayer](js/ClientPlayer.js), [ClientUnit](js/ClientUnit.js) | per-player and per-unit state |
| [UnitBehavior](js/UnitBehavior.js) | decides every animation state |
| [BroadcastCamera](js/BroadcastCamera.js), [AutoDirector](js/AutoDirector.js) | auto camera and time scale |
| [TimeScrubber](js/TimeScrubber.js) | play, pause, speed, seek |
| [BuildOrderData](js/BuildOrderData.js) | build order pipeline, no DOM |
| [BuildOrderRenderer](js/BuildOrderRenderer.js) | build order panel |
| [EventModel](js/EventModel.js), [EventFeed](js/EventFeed.js) | normalised events and the action feed |
| [MatchHeader](js/MatchHeader.js), [MatchSummaryView](js/MatchSummaryView.js) | header and end-of-game summary (shared with the desktop app) |
| [HudCharts](js/HudCharts.js) | dominance and food graphs |
| [ReplayGuide](js/ReplayGuide.js) | the guided walkthrough |

The canvas layer table lives on `#canvas-group` in [viewer.html](viewer.html).
Layout modes are CSS classes on `#app`, switched with `applyLayoutMode()`.
Build order CSS uses the `bo-` prefix.

## Parsing and storage

| Subsystem | Role |
|---|---|
| [vendor/wc3v-parser.bundle.js](js/vendor/wc3v-parser.bundle.js) | the Node parser, browserified by `tools/build-parser-bundle.js` |
| [UploadManager](js/UploadManager.js) | drop a file, validate, parse in a worker, persist |
| [MyReplays](js/MyReplays.js) | IndexedDB store with quota-aware eviction |
| [SummaryExtract](js/SummaryExtract.js), [SummaryBuild](js/SummaryBuild.js) | the stored summary shape (shared with the desktop app) |

Replays never leave the browser.

## Compare

| Subsystem | Role |
|---|---|
| [CompareMatcher](js/CompareMatcher.js) | picks the closest pro replay |
| [ReplayAnalyzer](js/ReplayAnalyzer.js) | grades and findings |
| [CompareCharts](js/CompareCharts.js) | SVG chart factories |
| [CompareInline](js/CompareInline.js), [AdvancedComparePicker](js/AdvancedComparePicker.js) | the compare UI |

## Data

| Path | Contents |
|---|---|
| [data/builds-manifest.json](data/builds-manifest.json) | builds and the pro replays behind them |
| [data/tournaments.json](data/tournaments.json) | tournament metadata |
| [data/map-folders.json](data/map-folders.json) | map names, bounds and folders |
| `data/summaries/` | one summary per library replay |
| `replays/*.wc3v.gz` | parsed library replays (gitignored, on the CDN in production) |
| `maps/{Name}/` | per-map cache (gitignored, generated) |
| `assets/` | icons, terrain, models (gitignored, extracted from the game) |

## Running

```sh
cd client && npx http-server
```

`node tools/page-audit.js --page=download.html --fit` drives a page in a real
browser and checks the fold, clipping, tabs and the readability floors.
