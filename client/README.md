# WC3V web client

The browser side of [WC3V](../README.md). A multi-page site (homepage, replay viewer, replay library, about, community) built without modules or a build step — scripts loaded directly via `<script>` tags, third-party libs from CDN, everything hangs off `window`.

## Pages

| Page | Purpose |
|---|---|
| [index.html](index.html) | Homepage — pro build library + your replay rail with inline compare-to-pro |
| [viewer.html](viewer.html) | Interactive replay viewer (3D terrain, build order panel, scrubber) |
| [replays.html](replays.html) | Full library of your locally-stored replays |
| [about.html](about.html) | Marketing / feature overview |
| [community.html](community.html) | Curated WC3 community links |
| [builds.html](builds.html), [compare.html](compare.html) | Redirect to homepage (features absorbed into home UI) |

[SiteNav.js](js/SiteNav.js) renders the shared header on every page.

## Architecture

Coordinator pattern. [Wc3vViewer](js/app.js) (in `app.js`) is the main class that owns the canvas/3D scene, scrubber, build order, and players. It delegates to focused subsystem classes — pass dependencies explicitly via constructor or viewer reference, no module imports.

### Replay viewer subsystems

| Subsystem | Role |
|---|---|
| [ThreeMapRenderer](js/ThreeMapRenderer.js) | WebGL terrain renderer (Three.js heightmap, lighting) |
| [MapRenderer](js/MapRenderer.js) | Stateless 2D canvas overlay (units, trees, neutral camps, gold mines) |
| [GLBLoader](js/GLBLoader.js) | Binary glTF loader for terrain/building meshes |
| [PathTrailRenderer3D](js/PathTrailRenderer3D.js) | Hero movement trails in 3D |
| [FogOfWar](js/FogOfWar.js) | 3D fog mask for non-playable map edges |
| [BroadcastCamera](js/BroadcastCamera.js) | Auto-camera modes (action focus, building focus) |
| [GameScaler](js/GameScaler.js) | Zoom and coordinate transforms |
| [TimeScrubber](js/TimeScrubber.js) | Playback control (play/pause/speed/seek) |
| [ChapterMarkers](js/ChapterMarkers.js) | Named event markers on the timeline |
| [TimelineSpline](js/TimelineSpline.js) | Timeline playhead spline |
| [BuildOrderData](js/BuildOrderData.js) | Pure data pipeline: event extraction, grouping, tier bucketing |
| [BuildOrderRenderer](js/BuildOrderRenderer.js) | DOM rendering for the BO panel + live highlight |
| [ClientPlayer](js/ClientPlayer.js) | Per-player state (units, buildings, tier, hero) |
| [ClientUnit](js/ClientUnit.js) | Per-unit state + canvas drawing |
| [Drawing](js/Drawing.js) | Static canvas helpers (drawUnit, drawBoxedLevel, drawImageCircle) |
| [FloatingText](js/FloatingText.js) | On-map damage/heal/cast text |
| [BuildingHoverLabel](js/BuildingHoverLabel.js), [BuildingInfoTooltip](js/BuildingInfoTooltip.js) | Building hover + tooltip with production grid |
| [BuildingProgressBar](js/BuildingProgressBar.js) | Construction progress bar |
| [BuildingPlacementViewer](js/BuildingPlacementViewer.js) | Visualizes building placement decisions |
| [BuildingSplats](js/BuildingSplats.js) | Building footprint decals |
| [UnitsProductionPanel](js/UnitsProductionPanel.js) | Side panel showing unit production by building |
| [MinimapPip](js/MinimapPip.js) | Mini position indicators |
| [MatchHeader](js/MatchHeader.js), [MatchSummary](js/MatchSummary.js) | Match info header + end-game summary modal |
| [GameDisplayBox](js/GameDisplayBox.js) | Hover-info box (disabled in live BO mode — CSS scaling breaks coords) |

### Upload + parsing (in-browser)

| Subsystem | Role |
|---|---|
| [vendor/wc3v-parser.bundle.js](js/vendor/wc3v-parser.bundle.js) | Browserified Node parser (built by [tools/build-parser-bundle.js](../tools/build-parser-bundle.js)) |
| [parser-worker.js](js/parser-worker.js) | Web Worker stub for off-thread parsing |
| [UploadManager](js/UploadManager.js) | Drop-file orchestration: validate → parse → persist |
| [MyReplays](js/MyReplays.js) | IndexedDB store for parsed replays (FIFO eviction by quota) |
| [SummaryExtract](js/SummaryExtract.js) | Lightweight summary extraction for fast comparison matching |

User replays live in IndexedDB only — never uploaded.

### Compare-to-pro

| Subsystem | Role |
|---|---|
| [ReplayAnalyzer](js/ReplayAnalyzer.js) | Scoring engine: macro / production / item economy / idle resources letter grades + findings |
| [CompareMatcher](js/CompareMatcher.js) | Auto-selects the closest pro replay (race, matchup, opener, archetype, map, length) |
| [CompareInline](js/CompareInline.js) | Inline compare UX rendered into My Replays cards |
| [CompareCharts](js/CompareCharts.js) | SVG chart factories (supply curves, worker counts) |
| [AdvancedComparePicker](js/AdvancedComparePicker.js) | Modal for manual pro-replay override |
| [CompareView](js/CompareView.js) | Historical compare modal structure |
| [PlayerPicker](js/PlayerPicker.js) | Pick which player slot in the user's replay to compare |

### Site infra

| Subsystem | Role |
|---|---|
| [SiteNav](js/SiteNav.js) | Shared header/nav across all pages |
| [Security](js/Security.js) | HTML-escape + Unicode sanitization for replay-derived strings (player names, hero names, map names) |
| [TosBanner](js/TosBanner.js) | Privacy / ToS acknowledgment overlay |
| [Constants](js/Constants.js) | Shared enums (`LayoutMode`, `ScrubStates`), `formatGameTime()`, color maps |
| [Helpers](js/Helpers.js) | Misc utilities |

## Layout modes

The viewer has three layout modes, switched via CSS class on `#app` (use `applyLayoutMode()`):

| Mode | CSS class | What it shows |
|---|---|---|
| Gameplay | `layout-mode-gameplay` | Map + player status (default) |
| Static BO | `layout-mode-static-bo` | Build order panel only |
| Live BO | `layout-mode-live-bo` | BO synced to playback time, canvas CSS-scaled, click-to-seek |

CSS Grid on `#content` drives the layout per mode. See [css/main.css](css/main.css) for the grid rules.

## Build order panel

- **Data pipeline** (no DOM): [BuildOrderData.js](js/BuildOrderData.js) extracts events from the player's `eventStream`, groups consecutive same-type events, buckets by tier, and emits supply-indexed snapshots.
- **Rendering** (no D3 SVG, all DOM): [BuildOrderRenderer.js](js/BuildOrderRenderer.js) handles row types: `building`, `unit`, `hero`, `heroLevel`, `tierUpgrade`, `workerAssign`, `expansion`, `attackUpgrade`, `defenseUpgrade`, `research`, `snapshot`.
- **CSS**: all classes use `bo-` prefix. Responsive widths via `.bo-wide`, `.bo-medium`, `.bo-narrow`.
- **Live highlight**: BO row syncing in live mode is driven by `gameTime` ticks from the scrubber.

## Data files

| Path | Contents |
|---|---|
| [data/builds-manifest.json](data/builds-manifest.json) | 16 curated builds + 221 pro replay refs (source of truth) |
| [data/tournaments.json](data/tournaments.json) | 12 tournaments with metadata |
| [data/replay-wishlist.json](data/replay-wishlist.json) | Builds still needing replays |
| [data/summaries/](data/summaries/) | Lightweight summary JSON per replay (lazy-loaded for compare matching) |
| [data/unit-balance-lite.json](data/unit-balance-lite.json) | Subset of unit balance for client lookups |
| [data/map-folders.json](data/map-folders.json) | Map → tournament associations |
| `replays/*.wc3v.gz` | Pre-parsed pro replays (gzip JSON, ~600–900 KB each) — gitignored, served from CDN in production |
| `maps/{Name}/` | Per-map cache: `map.jpg`, `gridmap.jpg`, `pathing.json.gz`, `neutralBuildings.json.gz` — gitignored, auto-generated |

## Rules of thumb

- **No build tools.** Scripts loaded via `<script>` tags in [index.html](index.html), [viewer.html](viewer.html), etc. Order matters — no module system.
- **CDN libs only.** D3 v5, RBush v2, Three.js v0.160 from CDN. Don't upgrade or import differently.
- **Coordinator pattern.** Subsystems hang off `window`. Pass deps via constructor or viewer reference. Don't reach across the system.
- **Canvas in `requestAnimationFrame`.** Don't block the paint with synchronous heavy work.
- **`bo-` prefix for build order CSS.** Don't mix with the rest.
- **Icons live under [assets/wc3icons/](assets/wc3icons/) and are gitignored.** Don't commit them.
- **3D assets ([assets/terrain/](assets/terrain/), [assets/models/](assets/models/), [assets/textures/](assets/textures/))** are gitignored — generated by tools.

## Running locally

```bash
cd client && npx http-server
```

Open the printed URL. The dev cache-buster query string (`?t=Date.now()`) on each script forces fresh loads in [viewer.html](viewer.html) — convenient during iteration, harmless in production.

## Reference

- [Drawing diagram](docs/client-drawing-diagram.jpg) — original spatial-indexing / unit-grouping concept (RBush)
- [Application performance profile](application-profile.png) — early profiling snapshot
