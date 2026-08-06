# WC3V Desktop: changelog

Nothing here is a public release. The app does not launch until 1.0.0; these
builds go to R2 so the existing install can update itself. See `README.md`.

## 0.7.2 — 6 Aug 2026

The report became one screen.

- **No tabs.** Story and Build merged. The report is the verdict band, then one
  panel holding the chart, a build card per seat, and the per-player record.
  `.report-body` is the only element allowed to scroll.
- **The stat tile grid is gone.** Six bordered cells of six different kinds of
  number read as a dashboard rather than as a reading of a game. Its comparative
  half survives as rows in the verdict band: tier 2, expansion, workers and APM
  against your own rolling median.
- **The Story timeline is gone**, three days after it was built. Right answer to
  "Story doesn't tell a story", wrong thing to sit above the builds.
- **Team games get an abbreviated form.** Past two players the build cards go
  compact and the per-player record is not rendered at all.
- **Team games no longer break the frame.** The verdict band's build strips
  stacked one row per player, so a 3v3 was a 296px band beside a 103px verdict
  column. The strips are gone entirely now that the real cards are on the same
  screen.
- **Dominance refuses team games** instead of drawing nonsense. `DominanceSeries`
  splits 100 points across everyone in the game, so in a 3v3 the six shares sit
  around 16 and nobody can reach the "50 = even" line the chart is built around.
- **First-boot catch-up.** A fresh install reads its ten newest replays at
  launch, with progress chips in the quick-nav band, instead of showing an empty
  feed until you find a button in Settings.
- Fixed: `Open in WC3V Viewer` had never been flush right, because the rule
  pushing it named `.btn-primary` and the button is `.btn-viewer`.
- Fixed: heroes appeared among the units on build cards, because `t2Units` and
  `t3Units` include a hero trained inside that tier.
- Fixed: `MomentsExtract.phrase` worded the same beat two ways, "Your Tier 2"
  against "Moon: Tier 2".
- Added `tools/test-backfill-catchup.js` to the `desktop:test` suite.

## 0.7.1 — 6 Aug 2026

The report redesign.

- Four tabs became two: Story and Build. Economy and Full details deleted.
- **One chart panel with three chips** (Dominance, Resources, Army) replacing a
  chart in Story and two more on a separate tab. `js/chart-panel.js` wraps the
  existing mount panels and owns no drawing code.
- **The five-pillar grade rail was deleted**, not moved. Economy, Army, Hero,
  Map control and Mechanics as bare integers against a rolling median is not
  something an integer can convey. `GameReport` still supplies the headline and
  the benchmarks.
- The game strip was deleted with `js/game-strip.js`.
- `js/build-card.js` gained a `Bought` section and exported `heroesOf`/`keyUnits`.
- Render-side only: no schema change, no re-parse.

## 0.7.0 — 6 Aug 2026

The charts pass.

- **Schema v4** adds `dominance` and `resources` to the stored summary, packed
  by `client/js/SeriesExtract.js`. Measured cost **+1.7 KB gzipped per game**.
  Like `moments` (v2) and `combat` (v3), these are extract-at-parse-time-or-never,
  so every game stored before this build offers "Re-read this game" until it is
  re-parsed.
- The report mounts **the viewer's own chart classes** (`DominanceChart`,
  `ResourceCharts`) rather than lookalikes.
- `client/css/dominance.css` split out of `main.css`, shared by the viewer, the
  dominance lab and the desktop.

## 0.3.0 — 5 Aug 2026

- First walked upgrade: 0.2.0 → 0.3.0 installed and updated end to end.
- The window became a feed of your games.

## 0.2.0 — 5 Aug 2026

- First build published to R2 through `tools/deploy-desktop.js`, with the
  manifest and installer fetched back to confirm.
- Auto-update plumbing: signed packages, public key compiled into the binary,
  private key at `~/.tauri/wc3v-updater.key`. **Back that key up. Losing it ends
  updates for every existing install.**
