# WC3V Desktop: changelog

Nothing here is a public release. The app does not launch until 1.0.0; these
builds go to R2 so the existing install can update itself. See `README.md`.

## 0.7.4 — 6 Aug 2026

Resources stops drawing two staircases and a flat floor.

Measured first, over 80 games (`node tools/analyse-resource-series.js`): gold
lost is flat for a median **27%** of the x-axis and lumber lost for **43%** —
the entire game at worst — while the two food lines sit **9%** apart and trace
each other. Three of those stacked in a landscape window is three skinny strips
where nothing happens for the first third.

- **Trade balance replaces both loss curves.** One line: their cumulative losses
  minus yours, filled back to a zero midline, moss above and rust below. Two
  monotonic climbs cannot show who is winning the trades — that is the gap
  between them, which is the one thing a reader has to do arithmetic to get. So
  plot the difference. The headline number sits above it (`−670 · peak −1,770`).
- **Food is drawn against its cap, not beside it.** The cap is a stepped band
  behind the used line instead of a second dashed line per player. Four lines
  became two and a background. Square corners on the band, because supply
  arrives in whole buildings and a diagonal between two levels claims a moment
  that never happened.
- **Every chart mode trims its flat lead-in** and labels the axis with the
  second it really starts. Dominance eases out of an even 50/50 over the
  engine's 150s ramp; Army is cumulative production, so it is 0 until the first
  unit. Worst game in the sample trimmed **9:40** of dead axis. Everything that
  maps a pointer back to a time — the dominance scrub, all three double-click
  seeks — now goes through the drawn span rather than assuming the plot starts
  at 0:00.
- **Axes that a person would have chosen.** The balance axis was labelled
  `+1173 / +587 / −586 / −1173`, two of which are the same number rounded in
  opposite directions, and the negative signs were clipped off the left of the
  viewBox so they read as positive. Now `+2k / +1k / −1k / −2k`. The food axis
  was rounding a 100-supply game up to a 200 ceiling and drawing the whole curve
  in the bottom half; the cap is the ceiling by construction, so it is the axis.
- **Aspect authored for the box it gets.** A 1200x200 viewBox in a half-width
  column renders 70px tall — 6:1, the same skinny strip this pass exists to
  kill. 560x200 lands at 2.75:1 at the 405–594px these columns actually measure,
  and keeping the viewBox near the rendered width keeps the axis type at its
  authored size instead of scaling it to 9px.
- `ResourceCharts.js` is no longer shipped to the desktop. The mount-seam rule
  was never "mount the viewer's class whatever it draws" — it is "do not redraw
  a chart the viewer has", and a loss curve and its difference are not the same
  chart. The new plots live in `CompareCharts`, the shared factory, next to Army
  for the same reason: a derivation with no viewer class to borrow.

Render-side only: no schema change, no re-parse.

## 0.7.3 — 6 Aug 2026

Density, and an end to the wall of potions.

Measured at 1280x820. A 3v3 report went from 857px of content in a 547px body
to 545 — the whole thing above the fold. A 1v1 went from 1849 to 1208.

- **A chart mode that cannot draw gets no chip.** `DominanceSeries` refuses team
  games by construction, and the panel was still offering a greyed Dominance tab
  on every 2v2 and 3v3 — a control whose only outcome is a sentence saying there
  is no chart. Only modes with something to say get a chip now, and the head
  disappears entirely when that leaves one. A game where nothing can be drawn
  keeps all three, because that is where the explanation lives.
- **Resources draws three across instead of three down.** Stacked, the panel was
  258px and gave each series a 1200x56 box — 21:1, where every curve flattens
  into a line near the floor. Side by side it is 148px and each plot has a shape
  a curve can be read in. Below 720px wide it goes back to the viewer's stack.
- **Compact build cards lost their section labels.** HEROES and UNITS above two
  rows of art that could not be anything else, 38px a card, 228px across a 3v3.
  Compact columns are 11rem too, so six seats sit on one row rather than five
  and an orphan.
- **The build-order list runs in columns.** A row is 131px of content and it was
  being given a 610px column, so twenty of them ran 800px. 400 now, with no name
  wrapped — 13rem is measured against "Troll Headhunter/Berserker", the longest
  name the parser produces here.

- **The Bought row stacks.** Repeat purchases collapse to one icon carrying an
  ×N pip. Across the preview corpus that is 202 purchases drawn as 91 chips;
  the worst single card went from 41 icons to 7. Nothing is lost — the count
  was always the fact, and it now fits on one line.
- **Bought splits kept from spent.** Claws, orbs and boots read left of a
  hairline in purchase order; potions, scrolls and tomes read right of it by
  volume. The split comes from `js/item-classes.js`, generated out of
  `helpers/mappings.js` by `tools/build-item-classes.js` — an item the table has
  never heard of counts as kept.
- **Past ten distinct items the row folds** into a `+N` chip that expands in
  place. Nothing is dropped without being counted.
- **Mercs stack the same way.** Six batriders is one decision repeated.
- **The spacing scale is three quarters of what it was.** `--sp-*` is overridden
  for the desktop in `app.css`, not in the shared `tokens.css`: this is a fixed
  window with an absolute fold, where the web client is a page that scrolls.
  Body leading drops to 1.35 and the app bar to 48px.
- **No type or art got smaller.** `--fs-min` is still the floor and identity
  icons are still 36px. Hero portraits came down from 56 to 48, which is not a
  floor.
- The build card's section-label gutter is 5.0rem, measured rather than
  guessed: "UPGRADES" renders 73.2px, so 80px clears it by 7. It had been 5.6.

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
