# Client Optimization Backlog (deferred items)

Provenance: a multi-agent audit of the whole client (hardening / performance /
code-health / three.js), with every finding adversarially verified. The
**crash, leak, code-health, XSS, and listener-teardown** fixes were applied
directly (see git log). This file lists the items that were **intentionally NOT
auto-applied** because they are behavior-affecting refactors that want
profiling + manual testing, or product decisions. Line numbers are from the
audit snapshot — re-verify before editing.

---

## A. Performance refactors (verified, behavior-affecting → profile first)

These are real but were left out of the safe sweep because each changes runtime
behavior or data-structure lifetime and deserves a before/after profile.

### A1. Per-frame work in the render loop (highest value)
The `mainLoop` runs every animation frame; anything here multiplies by FPS.
- **BroadcastCamera.js:762-772** — per-frame `O(units)` scans for cluster
  scoring + bounds, every frame. Cache per-tick; recompute only when the unit
  set / positions change.
- **BattleRenderer.js:243-322** — ~20 `ctx.measureText()` calls per active
  battle per frame. Measure once on banner content change, cache the widths.
- **BattleRenderer.js:473-526** — `_raceForPlayerId` does a linear
  `players.find()` per trip per frame. Build a `playerId → race` map once.
- **ClientUnit.js:906-934** — per-unit object + array allocation in `renderUnit`
  every frame. Hoist scratch objects / reuse arrays.
- **ClientPlayer.js:773-824** — `O(n²)` `unitDrawPositions.find()` inside
  per-frame `forEach`. Index by id into a Map first.
- **TeleportFx.js:283-289** — per-frame radial gradient + array/Map allocations
  while a TP is active. Build the gradient once per teleport, reuse.
- **TeleportFx.js:174-195** — `_grabbedUnitPos` is `O(players × units)` per
  grabbed unit, per frame during channel. Precompute a position lookup.
- **ThreeMapRenderer.js:1055-1057,1429-1430,1552-1555** — `performance.now()`
  recomputed several times per frame + water `uTime` allocation. Compute the
  timestamp once per `render()` and thread it through.
- **ThreeMapRenderer.js:2228-2273** — `updatePlayerBuildings` loops all
  buildings every frame, each re-scanning the full `uprootStream`. Precompute an
  uproot index keyed by building; only touch changed buildings.
- **ThreeMapRenderer.js:1863-1864** — per-frame `Set`/`Matrix4` allocation +
  `O(buildings × trees)` scan in `clearTreesAroundPoint`. Hoist the Matrix4;
  spatially bucket trees.
- **app.js:2028-2032** — `O(n²)` union-find / ring-merge over highlight points
  **every frame** during the guided walkthrough. Merge once when the step's
  highlight set changes, not per frame.

### A2. Recompute-on-render (cache the result)
- **BuildOrderRenderer.js:763-764** + **BuildOrderData.js:194-198, 391-398** —
  `processBuildOrderData` re-runs the full pipeline for every player on every
  render, with nested `O(n²)` scans inside. Memoize per (replay, player); the
  inputs don't change between renders.
- **UnitsProductionPanel.js:301-471** — full `O(units)` recompute + sorts on
  every non-small time step. Cache + invalidate on actual roster change.
- **BattleData.js:114-140** — per-battle item-activity counting is
  `O(battles × events)`, recomputed fully. Compute once in the pipeline.

### A3. Allocation / caching hygiene
- **Drawing.js:5-14** — cargo icon cache is unbounded and never cleared across
  replay loads (slow growth). Clear on reset or cap with an LRU.
- **Helpers.js:33-54** — `closestToPoint` allocates + full-sorts to find a
  single minimum. Replace with a single linear min-scan (`O(n)` no alloc).
- **parserEntry.js:48-59** — `resolveMapDataName` full `O(n)` scan with
  per-iteration regex/string alloc. Precompile the regex; build a name index.
- **browserMapLoader.js:56-60** — duplicate `fetch()` of the same cache file on
  the gz→plain fallback. Reuse the first response / dedupe the request.

### A4. Layout thrash (forced reflow)
- **BuildingInfoTooltip.js:111-119** — `_position()` reads
  `getBoundingClientRect()` + `offsetWidth/offsetHeight` after style writes on
  **every mousemove** over a building → synchronous reflow per move. Measure the
  tooltip + canvas rect once on `show()`, reuse for reposition arithmetic.
- **TimelineSpline.js:110-133** — `getBoundingClientRect` per anchor each
  recompute. Batch the reads.
- **ChapterMarkers.js:364-401** — creates+removes a tooltip node per hover and
  forces reflow. Reuse one persistent tooltip node.

### A5. Bigger refactor (highest risk — terrain correctness)
- **ThreeMapRenderer.js:548-743** — `setupTerrain` builds geometry via plain-JS
  `Array.push()` then converts, producing large transient allocations on the
  main thread at load. Build directly into pre-sized `Float32Array`s. **Touches
  terrain geometry → regression-test every tileset's heights/cliffs before
  shipping.**
- **ThreeMapRenderer.js:2369-2411** — `renderBaseSnapshot` resizes the live
  renderer twice and toggles all instances per call (main-thread hitch). Render
  the snapshot off the live renderer or batch the resize.
- **ThreeMapRenderer.js:1988-2008** — `setupNeutralBuildingModels` clones a
  `Group` per instance with no dispose / no instancing. Move to InstancedMesh
  (also helps the dispose() path just added).

---

## B. three.js ESM migration (product decision — currently works)

**Status: not a bug.** `viewer.html:18` loads three **r160** via the legacy
global build (`three@0.160.0/build/three.min.js`). r160 deprecates and slates
`build/three.js` / `build/three.min.js` for removal — so the pinned version
works today, but three **cannot be upgraded past r160** with the current
`<script>` tag.

**Why it wasn't auto-migrated:** a naive `window.THREE = THREE` ESM shim would
break the current bootstrap. The viewer loads all `/js/*` via a synchronous
`document.write` loop (`viewer.html:83`) that runs *before* any deferred
`type="module"` shim — so subsystem classes (which read the global `THREE` at
evaluation time) would see `undefined`. Migrating also violates the standing
"no bundler / CDN globals" project rule, so it's a deliberate choice, not a sweep.

**If/when you upgrade three, the real path:**
1. Add an import map in `viewer.html` `<head>` (before the loader):
   `{"imports": {"three": "https://cdn.jsdelivr.net/npm/three@<ver>/build/three.module.js"}}`.
2. Add a single `<script type="module">` shim that does
   `import * as THREE from 'three'; window.THREE = THREE;` **and** gates the rest
   of bootstrap on it — i.e. move the `/js/*` loader so it runs *after* the shim
   resolves (e.g. dynamic-import the loader, or fire a `three-ready` event the
   `document.write` block waits on). This ordering is the crux; without it the
   ~194 `THREE.*` references across ThreeMapRenderer / GLBLoader /
   PathTrailRenderer3D / FogOfWar / MinimapPip / BuildingProgressBar /
   BuildingSplats throw `ReferenceError` at load.
3. The project's GLBLoader is hand-rolled and imports **zero** `three/addons`
   (no GLTFLoader/OrbitControls jsm), so no addon import-map entries are needed —
   don't copy boilerplate that adds them.
4. Audit for APIs deprecated since r160 at the same time.

Risk: high (touches load order for the whole viewer). Do it as its own change
with full smoke-testing, not bundled with anything else.

---

## C. Deferred hardening/cleanup (low value or refactor risk)

- **GLBLoader.js:117-135** — GLB `THREE.Texture`/blob resources can leak on
  parse-failure paths (a Texture is built eagerly per image even if no material
  references it). Fix = build textures lazily in `resolveMaterial`, or
  traverse-and-dispose unused textures before `return group`. Left out because
  it's in the GLB parse hot path — verify building/doodad rendering after.
- **BuildOrderRenderer.js:930** — per-row live-seek click listeners are added
  per render in live mode. Not a true leak (rows are detached on re-render, so
  listeners are GC'd), but a delegated single `#bo-columns` handler is cleaner.
  Deferred as cosmetic.
- **MapRenderer.js:479-526 / 537** — `renderNeutralBuildings` /
  `renderMapGrid` are **parked implementations** behind an early `return` (3D
  handles them now). Not dead code to delete — left intact in case they're
  re-enabled. Remove only if you've decided the 2D path is gone for good.
- **Drawing.js:473-490** — `assignDrawSlot` hero-slot offset map looks
  copy-pasted (diagram shows slot `5`, map has `4`; slot `4` duplicates slot
  `2`'s x-offset). Needs the intended multi-hero layout confirmed before
  touching — it positions hero icons.
