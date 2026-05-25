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
| 2       | `#utility-canvas`  | **L3 MAP OVERLAYS** | Map grid, neutral building icons, creep camp rings + their bg, tree icons, battle box + battle banner |
| 3       | `#player-canvas`   | **L4 UNITS + NAMEPLATES** | Unit icons, hero portraits, death FX, base nameplates, unit nameplates (`renderAllNameplates`), unit nameplate bars, floating text |
| 4       | `#action-canvas`   | **L5 ACTION INDICATORS** | Teleport cinematics (channel ring, destination mirror, INCOMING label, dashed trail, arrival flash). Future: hero level-up burst, scout ping, "BIG EVENT" callouts |

**Rule:** L5 ACTION INDICATORS is the topmost canvas. Anything that conveys
a deliberate **player action moment** (TP, ult cast, ping, level-up at a
glance) belongs here, not below the nameplates.

## DOM siblings over the canvases (inside `#map-container`)

| z-index | Element                  | Purpose                                                          |
| ------- | ------------------------ | ---------------------------------------------------------------- |
| 2       | `.time-scrubber-tracker` | The white dot indicating playback position on the scrubber       |
| 3       | `.battle-marker`         | Coloured chevrons over the scrubber for detected battles         |
| 5       | `.minimap-pip`           | Small minimap in the bottom-right corner                         |
| 18      | (former battle panel)    | Removed — kept as a marker so future panels avoid this slot      |
| 20      | `.camera-toolbar`        | AUTO / SPLIT / P1 / P2 / FREE buttons in the upper-right         |
| 50-99   | Floating tooltips        | Camp info panel, hero stats hover cards, build-order tooltips    |
| 100     | Match header             | Top-of-map match info bar                                        |
| 1000+   | Modals                   | Match summary modal, full-screen dialogs                         |

Reserved corner zones (always grep CSS for `position: absolute` corner offsets before placing anything here):

- **Upper-right** — `.camera-toolbar` (`top: 0.5rem; right: 0.5rem; z 20`). Do not overlap.
- **Upper-left** — `#map-name-overlay` and the "SPLIT VIEW" label.
- **Lower-right** — `.minimap-pip` (`bottom: 0.75rem; right: 0.75rem; z 5`). Do not overlap.
- **Lower-left** — the only consistently clear corner for new floating overlays.

## Render-order rules (within a single canvas)

Even with CSS z-index pinning canvas order, the **order of `draw*` calls inside
the same canvas determines what wins for that bitmap.**

### `#player-canvas` (z 3) draw sequence per frame

1. `player.preRender()` — frame-data prep
2. `player.resolveUnitPositions()` — collision + engagement
3. `player.render()` — unit icons, building icons, death FX
4. `ClientPlayer.drawDeathFxQueue()` — global death FX
5. `baseNameplateRenderer.render()` — base name labels
6. `ClientPlayer.renderAllNameplates()` — hero/unit nameplates (last over units)
7. `floatingText.render()` — "ITEM CONSUMED", XP, level-up flash (very last)

**Rule:** Floating text and nameplates render last within `#player-canvas`.
This is fine because L5 ACTION CANVAS sits above the whole thing anyway.

### `#utility-canvas` (z 2) draw sequence per frame

1. `mapRenderer.renderMapGrid()`
2. `mapRenderer.renderNeutralGroups()` — creep camp rings
3. `mapRenderer.renderNeutralBuildings()` — fountain/shop icons
4. `battleRenderer.render()` — battle box + banner

**Rule:** Map overlays go before gameplay overlays. Battle/territory rings go
last so they sit on top of camp/building chrome on this canvas.

### `#action-canvas` (z 4) draw sequence per frame

1. `teleportFx.render()` — channel ring + destination mirror + banner + flash + trail

Future additions to this canvas (level-up burst, scout ping, etc.) should
render either before or after `teleportFx.render()` depending on priority —
the same draw-order rule applies within the canvas.

## Choosing a layer for a new visual

| If your visual is...                                            | Use         |
| --------------------------------------------------------------- | ----------- |
| Static terrain feature (cliff, doodad)                          | L1 TERRAIN  |
| Map info overlay (grid, camp ring, tree icon, battle box)       | L3 MAP OVERLAYS |
| A unit, a unit's icon, a unit's name label                      | L4 UNITS    |
| **Deliberate action moment** (TP, ult cast, ping)               | L5 ACTION   |
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
