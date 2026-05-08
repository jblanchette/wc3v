# Marketing Assets

Shot list for the WC3V site, README, and social previews. Capture once, reference everywhere.

## Conventions

- **Final assets live in [client/assets/](../client/assets/)** so they're served by the site. Source/raw captures (full-res PNGs, OBS recordings) live here in `marketing/raw/`.
- Filenames are lowercase, kebab-case, no spaces.
- Dimensions are target output. Capture at 2× where possible, downscale on export.
- For GIFs: keep under ~6 MB. ~12 fps, ~6–8 sec loop, palette-optimized (gifski / ezgif).
- For looping demos on-page: prefer `.webm` (VP9) over `.gif` — smaller, smoother, lazier-decoded. README needs `.gif` (GitHub doesn't autoplay video).

## Required assets

Status legend: ✅ done · ⚠️ done but could be improved · ⬜ still needed

| Status | File | Used by | Target path | Format | Notes |
|---|---|---|---|---|---|
| ✅ | **hero** | [README.md](../README.md) hero | `marketing/hero.gif` | gif, 900×506, 8 sec, 2.7 MB | Cut from `raw/hero-source.mp4` @ 45–53s. Split-view 3D map of Moon vs Egg on Autumn Leaves with both build orders. |
| ✅ | **wc3v-beta-preview** | [client/about.html:57](../client/about.html#L57) hero video | `client/assets/wc3v-beta-preview.webm` | webm, 1280×720, 1:41, 5.2 MB | Silent VP9, full demo from `raw/hero-source.mp4`. **Fixes broken about page.** |
| ✅ | **viewer-3d** | README + about.html section | `marketing/viewer-3d.png` | png, 1280×720, 605 KB | Frame from source @ 47s. 3D split-view map. |
| ✅ | **build-order-panel** | README + docs/DESIGN.md | `marketing/build-order-panel.png` | png, 420×720, 226 KB | Cropped from source @ 75s — both BO columns side-by-side with tiers, expansion banner. |
| ⚠️ | **match-summary** | README features section | `marketing/match-summary.png` | png, 1280×720, 238 KB | Frame from source @ 95s — Match Summary modal on Upgrades tab. Useful but not what was originally planned for "compare-grades". |
| ✅ | **og-preview** | [client/index.html:19](../client/index.html#L19) Open Graph + Twitter card | `client/assets/og-preview.png` | png, 1200×630, 256 KB | Composed by [build-og.js](build-og.js): WC3V logo + tagline + viewer & compare-grades thumbnails. Re-run `node marketing/build-og.js` to regenerate. |
| ✅ | **homepage** | README features section | `marketing/homepage.png` | png, 1280×720, 395 KB | Frame from `raw/hero-source.mp4` @ 1s — build cards (DK Fiend, BM Wind Rider, etc.), race filter, upload zone. |
| ✅ | **compare-flow** | README compare section | `marketing/compare-flow.gif` | gif, 900×506, 8 sec, 1.7 MB | Cut from `raw/compare-flow-source.mp4` @ 1–9s. Modal opens with Grade B, shows letter grades A/A+/A+ and findings. |
| ✅ | **compare-grades** | README still + social | `marketing/compare-grades.png` | png, 1280×720, 197 KB | Frame from compare-flow source @ 5s. Macro/Production/Item Economy/Idle Resources letter grades with findings. |

## Optional / nice-to-have

| File | Used by | Notes |
|---|---|---|
| `marketing/replay-library.png` | README replays page mention | Screenshot of [client/replays.html](../client/replays.html) with several user replays loaded. |
| `marketing/build-card.png` | Social shareable | Single build card from homepage cropped, showing matchup chips + tier path. |
| `marketing/race-quad.png` | About page / pitch decks | 4-up of the four race hero portraits used on [client/about.html](../client/about.html). |
| `marketing/architecture.svg` | docs/DESIGN.md | Hand-drawn flow: `.w3g` → parser → `.wc3v.gz` → viewer / compare. |

## Capture setup

**Browser:** Chrome at 1280×720 or 1600×1000 (set window size with DevTools device toolbar > Responsive > custom).

**For viewer captures:**
- Use a clean replay — `happy-vs-grubby` is the canonical demo (good action, mid length, 3D-renderable map).
- Hide the dev cache-buster query strings if possible (they don't show but caches can flash).
- Make sure the [Tos banner](../client/js/TosBanner.js) is dismissed in localStorage so it doesn't appear in shots.
- For 3D shots: let the [BroadcastCamera](../client/js/BroadcastCamera.js) settle before capturing — first 1–2 sec can be jumpy.

**For homepage captures:**
- Clear unrelated user replays from IndexedDB or use an incognito window so "My Replays" shows the empty/onboarding state cleanly.
- Pick a moment where the matchup chips include all four races for visual balance.

**Recording:**
- GIFs: OBS → mp4 → ffmpeg → gifski. Or screencast directly via [LICEcap](https://www.cockos.com/licecap/) for quick captures.
- Stills: Chrome DevTools full-page screenshot (Cmd/Ctrl+Shift+P → "Capture full size screenshot") for portrait BO panel; window screenshot for the rest.

## After capture

1. Drop final assets in the paths shown in the table above.
2. Update [README.md](../README.md) to reference the new assets and remove the outdated `wc3v-demo.gif` link at the repo root.
3. Decide whether to keep the legacy `wc3v-demo.gif`, `day-at-gnoll-wood.png`, `feature-build-order.jpg` for historical reference or delete. Currently kept; not referenced by docs.

## Source files

Raw screen recordings live in `marketing/raw/` (gitignored). Currently:

- `raw/hero-source.mp4` — 1280×720 @ 25fps, 1:41, 8.4 MB. Source for `hero.gif`, `viewer-3d.png`, `build-order-panel.png`, `match-summary.png`, and `client/assets/wc3v-beta-preview.webm`. Re-cut clips with:

  ```bash
  FFMPEG=node_modules/ffmpeg-static/ffmpeg.exe
  # different hero clip range:
  "$FFMPEG" -ss <start> -t <duration> -i marketing/raw/hero-source.mp4 \
    -vf "fps=15,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5" \
    -loop 0 -y marketing/hero.gif
  # different still:
  "$FFMPEG" -ss <time-in-sec> -i marketing/raw/hero-source.mp4 -frames:v 1 -update 1 -y marketing/some-still.png
  ```

## Legacy assets (not currently referenced)

- `marketing/day-at-gnoll-wood.png` — Dec 2020. Pre-3D viewer screenshot.
- `marketing/feature-build-order.jpg` — Mar 2022. Old build order panel.
- `wc3v-demo.gif` (repo root) — original happy-vs-grubby demo. Currently the only thing in the README.
- `bake-crop.png`, `bake-crops.png`, `bake-native.png`, `bake-preview.png`, `example-client-v7.png`, `unit-path.png` (repo root) — dev artifacts, not marketing. Safe to remove or move into a `marketing/raw/` folder if you want to keep them.
