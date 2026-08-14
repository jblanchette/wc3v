# Visual Layer Hierarchy

Single source of truth for **what renders where** in the wc3v client. Read this
before adding any new overlay, tooltip, popup, action indicator, or chrome
element — and update it when you do.

## Why this exists

Multiple canvases AND DOM siblings live inside `#map-container`. Stacking is
controlled by **CSS z-index**, not DOM order — so changing the HTML alone
won't reorder layers. We have already shipped one regression where the
teleport-scroll banner got covered by unit nameplates because both rendered on
canvases whose z-indices put nameplates on top.

## Canvas layers

Stacked back → front by CSS z-index inside `#canvas-group`:

| z-index | Element            | Layer name        | What lives here                                                                                       |
| ------- | ------------------ | ----------------- | ----------------------------------------------------------------------------------------------------- |
| 0       | `#three-canvas`    | **L1 TERRAIN**    | 3D mesh, cliffs, doodads (trees, rocks), building 3D models                                           |
| 1       | `#main-canvas`     | **L2 LEGACY**     | Unused; kept for backward-compat with older render paths                                              |
| 2       | `#utility-canvas`  | **L3 MAP OVERLAYS** | Map grid, neutral building icons, creep camp rings + their bg, tree icons                             |
| 3       | `#player-canvas`   | **L4 UNITS + NAMEPLATES** | Unit icons, hero portraits, death FX, 2D selection markers, base nameplates, unit nameplates (`renderAllNameplates`), unit nameplate bars, floating text |
| 4       | `#action-canvas`   | **L5 ACTION INDICATORS** | Teleport cinematics (channel ring, destination mirror, INCOMING label, dashed trail, arrival flash), post-battle callouts. Future: hero level-up burst, scout ping |

**Not in this stack:** `#hud-charts-canvas` (the match graphs HUD) is a
*sibling* of `#canvas-group`, not a member of it — see the DOM table below.
WC3-style selection hoops around selected units are drawn IN the 3D scene by
`UnitModelRenderer` (an `InstancedMesh` at `renderOrder` 4), not on any 2D
canvas; the `#player-canvas` markers above are only the fallback for units 3D
didn't draw.

**Rule:** L5 ACTION INDICATORS is the topmost canvas. Anything that conveys
a deliberate **player action moment** (TP, ult cast, ping, level-up at a
glance) belongs here, not below the nameplates.

## `#gameplay-area` column siblings (above `#map-container`)

| z-index | Element         | Purpose                                                                 |
| ------- | --------------- | ----------------------------------------------------------------------- |
| 3       | `.dom-bar`      | Dominance gauge, between `#match-header` and `#gameplay-row`. Needs an explicit z-index so its downward drop-shadow paints over `#main-wrapper` (`position:absolute; z-index:1`) rather than being covered by it. Its KO plate/glyphs escape the bar's box upward at local z 5-7. |

## DOM siblings over the canvases (inside `#map-container`)

| z-index | Element                  | Purpose                                                          |
| ------- | ------------------------ | ---------------------------------------------------------------- |
| 2       | `#main-wrapper`          | Wraps `#canvas-group` and creates a stacking context for it. Bumped 1→2 so it outranks `#player-status-wrapper` (z 1). |
| 2       | `.time-scrubber-tracker` | White dot indicating playback position (inside scrubber-bar)     |
| 3       | `.battle-marker`         | Coloured chevrons over the scrubber for detected battles         |
| 5       | `.minimap-pip`           | Small minimap in the bottom-right corner (inside main-wrapper)   |
| 6       | `#hud-charts-canvas`     | Match graphs HUD (dominance + food), bottom-centre of `#main-wrapper`, 10px above the scrubber. **Sized in REAL CSS PIXELS × DPR**, not the map's logical space, and deliberately a SIBLING of `#canvas-group` — inside it, it would inherit the live-mode transform and the `object-fit: contain` letterbox. |
| 18      | (former battle panel)    | Removed — kept as a marker so future panels avoid this slot      |
| 20      | `.corner-stack`          | Bottom-left insights panel / bottom-right minimap stack. Outranks the HUD, so it wins if a narrow viewport makes them meet; the HUD hides itself below 360px. |
| 20      | `.camera-toolbar`        | AUTO / SPLIT / P1 / P2 / FREE buttons in the upper-right         |
| 60      | `#scrubber-bar`          | Bottom playback bar + its popups (speed picker, settings, zoom). Must beat the canvas group. |
| 100     | Match header             | Top-of-map match info bar                                        |
| 1000+   | Modals                   | Match summary modal, full-screen dialogs                         |

## Stacking-context rule (the subtle gotcha)

**`position: absolute` alone does NOT create a stacking context.** Only
`position: absolute` PLUS an explicit `z-index` (or one of: opacity < 1,
transform, filter, isolation, mix-blend-mode, will-change for any of those)
creates one.

When a positioned ancestor does NOT establish a stacking context, the
z-indexes of its descendants **leak up** and compete with the ancestor's
own siblings.

Concretely: `#main-wrapper` is `position: absolute` and originally had no
z-index. `#canvas-group` inside it has z 50. That z 50 was leaking up to
compete at the `#map-container` level — beating `#scrubber-bar` at z 10
and burying its popups behind the canvas.

**Fix:** any positioned container that has children with high z-indexes
should set its own explicit z-index to create a stacking context. We added
a z-index to `#main-wrapper` for this reason (now 2 — see the table above).

If you add a new wrapper that contains z-indexed children, set an explicit
`z-index` on the wrapper — even a low value works. The point is to create
the stacking context, not to compete vertically.

Reserved corner zones (always grep CSS for `position: absolute` corner offsets before placing anything here):

- **Upper-right** — `.camera-toolbar` (`top: 0.5rem; right: 0.5rem; z 20`). Do not overlap.
- **Upper-left** — `#map-name-overlay` and the "SPLIT VIEW" label.
- **Lower-right** — `.minimap-pip` (`bottom: 0.75rem; right: 0.75rem; z 5`) inside `#bottom-right-stack` (`bottom: 10px; right: 12px; z 20`). Do not overlap.
- **Lower-left** — `#bottom-left-stack` / `#insights-panel` (`bottom: 10px; left: 10px; z 20`, 320px wide). Do not overlap. (This used to be documented as "the only consistently clear corner"; it has not been since the Insights panel landed there.)
- **Bottom-centre** — `#hud-charts-canvas` (`bottom: 10px`, centred, 600×96, z 6). Do not overlap.

There is no clear corner left. New floating chrome either joins one of the two
corner stacks or earns its place by displacing something.

## Render-order rules (within a single canvas)

Even with CSS z-index pinning canvas order, the **order of `draw*` calls inside
the same canvas determines what wins for that bitmap.**

### `#player-canvas` (z 3) draw sequence per frame

1. `player.preRender()` — frame-data prep
2. `player.resolveUnitPositions()` — collision + engagement
3. `player.render()` — unit icons, building icons, death FX
4. `ClientPlayer.drawDeathFxQueue()` — global death FX
5. `ClientPlayer.renderSelectionMarkers()` — 2D selection rings (fallback only)
6. `baseNameplateRenderer.render()` — base name labels
7. `ClientPlayer.renderAllNameplates()` — hero/unit nameplates (last over units)
8. `eventFeed.renderPips()` — caster pips for the action feed (very last)

**Rule:** Floating text and nameplates render last within `#player-canvas`.
This is fine because L5 ACTION CANVAS sits above the whole thing anyway.

### `#utility-canvas` (z 2) draw sequence per frame

1. `mapRenderer.renderMapGrid()`
2. `mapRenderer.renderNeutralGroups()` — creep camp rings
3. `mapRenderer.renderNeutralBuildings()` — fountain/shop icons

**Rule:** Map overlays go before gameplay overlays.

### `#action-canvas` (z 4) draw sequence per frame

1. `teleportFx.render()` — channel ring + destination mirror + banner + flash + trail
2. `battleCallout.render()` — post-battle verdict/loss callout

**Ordering note that matters:** `battleCallout.render()` is called from
`Wc3vViewer.render()` *after* `ClientPlayer.renderAllNameplates()`, even though
it draws on a different canvas. Its placement solver queries
`frameData.nameplateTree`, which is cleared at the top of the frame and only
populated by `renderAllNameplates` — querying it any earlier returns nothing,
and the callout would go back to covering whatever it landed on. (The two
canvases share one logical coordinate space, and `actionCtx` sits outside the
`ctx`/`playerCtx`/`utilityCtx` save/restore pair, so the late call is safe.)

Future additions to this canvas (level-up burst, scout ping, etc.) should
render either before or after these depending on priority — the same
draw-order rule applies within the canvas.

### `#hud-charts-canvas` (z 6, DOM sibling) per frame

Drawn by `HudCharts.render()` from the top of `Wc3vViewer.render()`, before the
split-screen bail, so one call site covers both render paths. It owns its whole
canvas, so there is no intra-canvas ordering to respect. Its static series live
in two offscreen bitmaps rebuilt only on resize; a frame is `clearRect` + two
`drawImage` + a clip + a couple of `fillRect`/`fillText`.

## Choosing a layer for a new visual

| If your visual is...                                            | Use         |
| --------------------------------------------------------------- | ----------- |
| Static terrain feature (cliff, doodad)                          | L1 TERRAIN  |
| Map info overlay (grid, camp ring, tree icon)                   | L3 MAP OVERLAYS |
| A unit, a unit's icon, a unit's name label                      | L4 UNITS    |
| **Deliberate action moment** (TP, ult cast, ping, fight callout)| L5 ACTION   |
| Attached to a 3D unit and should move with it in world space    | The 3D scene — an `InstancedMesh` pool in `UnitModelRenderer`, like the ring/shadow/selection pools. Not a canvas. |
| Screen-fixed chrome that must be crisp at real CSS pixel sizes  | Its own DOM canvas outside `#canvas-group`, like `#hud-charts-canvas`. The five map canvases are in the map image's logical space and letterbox; text on them needs an `sx` correction to stay legible (see `BaseNameplateRenderer`). |
| Static info chrome (toolbar, scrubber, minimap)                 | DOM 5-20    |
| Hover-only floating info (tooltip, hero stats card)             | DOM 50-99   |
| Full-screen dialog                                              | DOM 1000+   |

If you find yourself wanting to draw "above the nameplates but below the
camera toolbar" — that's L5 ACTION CANVAS. Add it there.

## Past regressions to learn from

- **TP banner buried under nameplates** (2026-05): drew on `#utility-canvas`
  (z 2) but nameplates draw on `#player-canvas` (z 3). Fixed by adding
  `#action-canvas` at z 4 and moving TP overlays there.
- **Battle info panel landed on the camera toolbar** (2026-05): placed at
  `top: 0.75rem; right: 0.75rem` on top of `.camera-toolbar` at `top: 0.5rem;
  right: 0.5rem`. Fixed by moving to lower-right — then collided with the
  minimap pip there. Fixed for real by removing the panel and folding its
  content into the canvas battle banner.
- **Scrubber popups buried behind canvases** (2026-05): `#canvas-group`'s
  z-index 50 was leaking out of `#main-wrapper` (which had no stacking
  context) and outranking `#scrubber-bar` at z 10. Speed picker, settings
  menu, and zoom slider appeared *behind* the action-canvas overlay. Fixed
  by giving `#main-wrapper` an explicit z-index 1 (creates stacking context;
  contains its children's z values) and bumping `#scrubber-bar` to z 60 as
  defensive cover. **Lesson:** positioned wrappers must declare their own
  z-index when they contain z-indexed children — see "Stacking-context rule".
- **Post-battle callout was unreadable, and this doc said the wrong canvas**
  (2026-08): the banner drew at a hardcoded `12px` in `#action-canvas`'s
  LOGICAL space (the map image, 1568–2240px) which is then CSS-downscaled with
  `object-fit: contain` — landing at roughly 4–6 CSS px on screen, a ~3×
  violation of the project's 12.8px floor. This doc had also gone stale and
  still listed it on `#utility-canvas`. Fixed by extracting `BattleCallout`,
  deriving every dimension from `F = SCREEN_FONT_PX × canvasMetrics().sx` the
  way `BaseNameplateRenderer` already did, and correcting the tables here.
  **Lesson:** a size constant on any of the five map canvases is a size in map
  pixels, not screen pixels, and needs the `sx` correction to be legible.
- **Lich didn't teleport with the casting DK** (2026-05): a different kind of
  bug (game-mechanic exclusion, not z-index) but worth noting the pattern:
  visual contradictions between what we draw and what should happen often
  surface real engine bugs.

## Maintenance

Update this doc whenever you:

- Add a new canvas
- Reassign a z-index on an existing canvas or DOM sibling
- Add a new corner-anchored DOM overlay
- Discover and fix a layer regression (add a bullet under "Past regressions")
