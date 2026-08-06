# WC3V Desktop: the manual pass

Everything a person has to check by hand, in the order that wastes the least
time. `desktop/ROADMAP.md` is the source of truth for status, so **record what
happens here back into it**, including the failures. A checklist that only ever
records successes is not evidence of anything.

Roughly 45 minutes end to end, plus one real game.

Two things to have open: this document, and the app's **Activity drawer**
(bottom bar → "ACTIVITY"). Most of what the app knows is in there.

> **Before you start:** if this window will be on camera, note that the OBS URL
> carries an access token. The app never displays it and sends it straight to
> the clipboard. Do not paste it anywhere visible on stream.

---

## A. The upgrade, first, because it is destructive

ROADMAP checklist item 3, and the only test that needs an *older* build.

**The manual half is done: 0.2.0 → 0.3.0 was walked on 5 Aug 2026 and worked.**
What is left is whether anyone would ever have found out there was an update,
which is what 0.4.0 changes.

1. Install the older installer, launch it.
2. **Wait, and look at the app bar.** Do not go to Settings.
   - Expect on 0.4.0 and later: within a few seconds of launch, a small blue
     **Update to 0.x.y** chip appears to the left of your name.
   - It should not blink and it should not be red. Nothing is wrong.
   - If it never appears, either the check failed (the Activity drawer stays
     quiet by design, so try Settings → Check for updates to see the reason) or
     `Check for updates automatically` is off.
3. **Click the chip.** It should jump to Settings with the Install button
   focused and the release notes for that version shown under it.
4. Click **Install 0.x.y**.
   - Expect: the NSIS installer runs. There may be a UAC prompt and a brief
     progress window.
   - **The app's own wording here may be wrong.** It says *"installed, restart to
     apply"*, and the Windows installer may close the app itself rather than
     waiting. Record what actually happens: whether the app exits on its own,
     whether it relaunches, and whether the tray icon is left behind.
5. Reopen. The chip should be gone and **Check for updates** should say
   **up to date**.
6. Turn **Check for updates automatically** off, restart the app, and confirm no
   chip appears and nothing is logged.

*Record: whether the chip showed up on its own, and what the installer did to the
running app.*

---

## B. The window itself, the riskiest change

`decorations: false` makes the app bar the window's title bar. A browser preview
cannot test any of this, which is why it is high on the list.

5. **Look at the top of the window.**
   - Expect one bar, dark navy, `WC3V` at the left with a blue **3**, then
     **Home / Coach / Stream** (three tabs, no Settings tab), then your name, a
     **gear** for Settings which should highlight while the sheet is open, and
     the minimise / maximise / close buttons.
   - Fail: a second, Windows-drawn title bar sitting above it. That means
     `decorations` did not take.
6. **Drag the window** by an empty part of the bar. It should move.
7. **Double-click** an empty part of the bar. It should maximise, and again to
   restore.
8. **Drag the window to the top edge of the screen**, and try `Win`+`←`.
   - Expect: Aero Snap works normally.
   - **This is the one most likely to be broken by an undecorated window.** If
     snap or the resize border is gone, say so. The fallback of putting
     decorations back and dropping the app's own bar is written up in ROADMAP §5.
9. **Drag each window edge and corner** to resize. All eight should work.
10. Click **✕**.
    - Expect: the window disappears, the app keeps running, the tray icon stays.
      It must not quit, since the whole point is to keep watching while you play.
    - Reopen from the tray (left-click the icon, or right-click → Open WC3V).
11. Right-click the tray icon → **Quit**. That, and only that, should exit.
    Relaunch it afterwards.

*Record: snap, resize, drag, and whether close-to-tray held.*

---

## C. Home and the game report

12. **Home tab.** Expect a 63px band across the top: an **All games** toggle
    carrying the count, then the last few games as chips (verdict plaque, race
    glyphs, opponent). The report takes the whole width underneath. There is no
    rail.
    - **Click a chip.** It opens that game. This is the common move and it must
      never need the drawer.
    - **Click All games.** The full feed should drop **down over the report**,
      not beside it and not as a modal — the report is still there underneath,
      and nothing behind it is disabled. Expect a search box, W/L and race
      filters on one row, then the feed grouped by day with a verdict plaque,
      opponent, race glyphs, map and duration per row. Hover a row for its exact
      time.
    - **Close it three ways**: the toggle again, `Escape`, and a click on the
      report underneath. Picking a game also closes it — a drawer left up over
      the game you just asked for makes the click look like it did nothing.
    - The quick-nav chips follow the filter. Filter to losses and the chips
      should be losses.
13. Click a game. **The right column must not scroll as a whole**, which is the
    fold rule. Expect a fixed frame in this order: verdict and opponent, whose
    name is a link into Coach, an all-time record chip once you have >=2 games
    against them (clicking it opens their book), **Open in WC3V Viewer** on the
    same row; a meta line of map, duration, opener, archetype and workers at
    5:00; **the one-line read**; **the grade rail**; then a tab strip of
    **Story / Build / Economy / Full details**. Only the tab body scrolls.
    - **There is no timeline band in the frame.** The game strip is in Full
      details and the dominance gauge was cut. If a chart appears above the
      grade rail, something has been put back.
    - Click the one-line read. It should take you to Story.
    - A game you were not in has no grade rail and the verdict says "You were
      not in this game". That is correct, and the frame must still not scroll
      with a band missing.
    - At 1280x820 the frame should be about 166px, 221px with a grade rail, and
      the tab body about 470px. It was 310/252 before the charts pass.

13a. **Open in WC3V Viewer.** It is the only navy control below the app bar and
    the only one carrying the wordmark, with the "3" in accent blue. That is
    deliberate and reserved: if anything else in the app looks like it, that is
    a bug. Clicking it opens the game in the real viewer.

13b. **The grade rail**, five cells in the frame: Economy, Army, Hero, Map
    control, Mechanics. Green for good, rust for poor, and hovering a cell gives
    the note.

13c. **Story tab**, the default. The dominance chart, then a grid of tiles.
    - The chart's title row reads `DOMINANCE · 50 = even` on the left and the
      two scores on the right, each in its player's line colour, followed by
      **final**. Own seat first, always.
    - A game whose summary predates schema v4 has no chart, and Story offers a
      **Re-read this game** button. A game under v4 whose dominance gate refused
      the replay has no chart and says so with no button, because re-reading it
      would refuse it again. Those two states must not be confused.
    - **Drag across the chart.** The scores must change as you move and the
      **final** should become a clock. Let go outside the chart and it returns
      to the final score — a readout left at 14:20 is reporting the wrong result
      for the game. Arrow keys step 10s, shift-arrow a minute, Home and End
      jump.
    - **Double-click the chart.** The viewer should open at that second.
    - **The event dots must be round**, not lozenges. They are circles in a
      stretched viewBox and a ResizeObserver compensates; if they are stretched,
      `_fitDots` is not firing.
    - Tiles: hero K/D, wipes, biggest swing, then the four benchmarks (tier 2,
      expansion, workers @5:00, effective APM) each carrying the gap to your own
      median, then peak army, peak workers, tier 3, first tower. A tile with no
      data reads "—" and says why, and a tile with no baseline carries no
      comparison rather than an invented one.
    - **The benchmarks have to survive a straight face.** Open three games you
      actually remember. If a game you lost to a hero snipe reads as an economy
      problem, the grade thresholds are wrong; record it and re-run the corpus
      pass (ROADMAP §11).
    - There is no map here and no moments list. Both moved or went; see 15.

14. **Build tab**: one card per player, the same shape as a build card on
    wc3v.com. Heroes with their final level on the portrait and their skills as
    icons carrying the level reached, then key units with names, then upgrades
    with levels, then chips for T2, T3, tower and expansion.
    - **Count the heroes.** You cannot have two of the same hero in Warcraft III,
      so two identical portraits is a bug. `heroBuilds` carries Mirror Image
      illusions as extra level-1 heroes and `build-card.js` dedupes them.
    - Hover an icon and the tooltip names the skill, unit, upgrade or item.
    - Icons come from `cdn.wc3v.com`. Empty carved squares mean offline or CSP,
      so say so.

15. **Economy tab**: the viewer's own three resource charts — food, gold lost,
    lumber lost — each carrying its peak in the title, with a legend saying
    which line is whose. Then army size with fights as dashed orange verticals.
    - **There is no workers chart.** That is deliberate: the game strip in Full
      details already draws both players' worker curves.
    - Double-click a resource chart to open the viewer at that second.
    - In a non-1v1, expect one line per chart rather than an invented duel.

15a. **Full details tab**: the game strip first (your lane, a fight axis, their
    lane, a time ruler, every mark opening the viewer at that second), then the
    events list with a Watch on every row, then build order, buildings by tier,
    upgrades and mercenaries, and items — each per player, own seat first.
    - This is the one tab allowed to be long. You arrive here intending to
      scroll.
    - **Click a mark on the strip.** The viewer should open at that second.
    - A game with no fights still draws both lanes, the ticks and the ruler.

16. **Type an opponent's name** into the search box above the feed.
    - Expect: the count beside the search box changes from `N parsed` to
      `X of N`, and only their games remain.
    - Try a map name too. It matches the name **as shown**, so "Echo" works.
17. Click **Wins**, then **Losses**, then a race glyph.
    - Expect: only that result, then only games where *you* played that race.
18. Type nonsense into the search box.
    - Expect: *"No games match those filters."*, and not the "No games yet."
      message.
    - Then clear the filters and **scroll the feed to the bottom**. More rows load
      as you approach the end, 120 at a time.

18a. **Settings is a sheet now, not a screen.** Click the gear.
    - Expect: a panel slides over the right of the window, Home stays visible
      behind it, and the gear lights up.
    - `Escape` closes it and focus returns to the gear. So does clicking the
      gear again, and the ✕ in the sheet.
    - The trademark line stays pinned at the foot while the panels scroll.

---

## C2. Next game (W3Champions)

New. Off until you switch it on, and it needs a ladder identity.

19. **Settings → W3Champions → Look up ladder data.** Tick it.
    - If your name has no `#number`, the panel says so. That is the whole reason
      nothing else will happen, and it is not a bug.
    - Leave it off and confirm nothing appears at any point below.
20. **Queue for a ladder game on W3Champions** and go back to Home while the
    loading screen is up.
    - Expect within ~20 s: the report column grows a **Next game | Last game**
      switch at the top and opens on **Next game**.
    - Next game shows: **LIVE · vs &lt;opponent&gt;** with their race glyph,
      their MMR, ladder rank and the MMR gap; the map, your own record on it and
      their recent form; your head-to-head; then three cells reading their
      opener in this exact matchup as bars, their tier 2 against yours, and how
      often they expand. Under that, every game you have played against them.
    - A player you have never faced reads **First time against them**, and the
      three cells say "Not enough games." That is correct, not a missing lookup.
    - Click their name. It should open them in Coach.
    - Click **Last game**. The column returns to the selected game and stays
      there; it must not snap back to Next game on the next poll.
    - Click one of the games in the list. It should switch to Last game and open
      that game.
21. **Finish the game.** The switch and the panel should disappear as the replay
    lands, and the report takes over.
22. **Pull the network** (or turn the setting off mid-queue). The panel should
    vanish and nothing should turn red. A W3Champions failure has to read as
    "no online data", never as a broken screen.
23. Minimise to the tray for a few minutes with the setting on, then reopen.
    Nothing should have polled while hidden, and it should catch up on the next
    tick.

*Record: how long from queue-pop to the panel appearing, and whether the habits
match the player you actually know.*

**Without a real queue:** `node tools/desktop-preview.js --games=40 --w3c` fakes
a live match against a real opponent from the sample, which is enough to check
the layout and the fold rule.

---

## D. OBS

Full walkthrough below in §OBS. The checks:

24. **Stream tab.** The preview at the top sits on a grey checkerboard. That is
    deliberate: it is what transparency looks like, and a preview on a solid
    panel would hide exactly the mistake this exists to catch.
25. Set up the Browser Source (§OBS), then click **Send a test game to OBS**.
    - Expect: the overlay appears in OBS within a second or two, **with a visible
      "preview, not a real game" strip**. It must be impossible to mistake for a
      real result.
26. **The transparency check. This is checklist item 2 and has never been done.**
    Put a colourful scene behind the overlay in OBS.
    - Expect: only the card is visible. No black box around it.
    - Fail: a black or white rectangle. Record it. OBS runs its own CEF build and
      this is the specific thing nobody has verified.
27. Toggle panels off and on in **Panels**. The preview updates immediately and
    OBS does not, because the URL carries the choice, so re-copy and re-paste to
    change what OBS shows. Confirm the app refuses to leave you with zero.
28. Try **Slate** under Look. Verdict colours should shift cool along with the
    panel. If Victory is still moss green on cool grey, that is the bug that was
    supposed to be fixed.
29. **Restart the app** with the OBS source still running.
    - Expect: the source reconnects on its own within a few seconds and shows the
      current state. No refresh, no touching OBS.
30. Click **Back to the real game** so the fake result is off the stream.
31. Click **Open the player view**, an ordinary opaque window for a second
    monitor.
32. **Per-panel sources.** Click **Copy URL** on the *Head to head* row and paste
    it into a second Browser Source at the suggested size.
    - Expect: only that one panel, correctly sized. The main composed source must
      be unchanged, since copying one panel never alters the other URL.
33. **Post-game reveal.** Tick *Only after a game* under Look, pick 15s, re-copy
    the main URL and re-paste it into OBS.
    - Expect on load: the card appears, which is the deliberate "position it
      without playing a match" behaviour, then slides out after the hold.
    - Then click **Send a test game to OBS**. It should slide back in, hold, and
      leave again.
    - **Now hit Refresh on the Browser Source mid-hold.** It must come back and
      behave identically. A reveal that only works on a cold load is broken,
      because OBS refreshes sources on scene activation.
    - Check the animation itself on a real stream. It should read as calm at
      broadcast distance. If it draws the eye away from the game, say so.

---

## E. A real game, the whole premise

34. With WC3V running, window open or in the tray, **play a 1v1**.
35. When it ends, expect, in order and without touching anything:
    - a **Windows notification** within ~30 s: `Victory vs <name>` or `Defeat vs
      <name>`, then the map, duration, your all-time record against them, and the
      biggest moment of the game.
      - **Never fired before.** Windows may ask for notification permission the
        first time. If nothing appears, check Windows Settings → Notifications →
        WC3V before assuming the app is at fault.
    - the **overlay in OBS** updates to that result, no refresh.
    - the **session score** in the app bar becomes 1–0 or 0–1.
    - the app **switches to Home** and opens that game.
36. Check the verdict is the right way round. If it says Victory when you lost,
    the app has the wrong seat, so click your name in the app bar and fix it.
    This exact bug shipped once.
37. Play a second game and confirm the session score and streak accumulate.
38. Now click through some **old** games in the feed.
    - Expect: the session score does not move and the overlay does not change.
      Browsing history must never touch what is on stream.

*Record: how long from the game ending to the overlay updating.*

---

## F. Open in the viewer

Both halves of this exist and each was checked alone. The joined-up path has
never been walked.

39. Open a game and click **Open in viewer**.
    - Expect: your default browser opens a small WC3V card on `127.0.0.1` saying
      **Ready to open**, with one button.
    - **Look at the address bar.** It should read
      `http://127.0.0.1:<port>/open?h=<16 characters>` and nothing else. If you
      see `token=`, `key=` or `at=` in there, you are running a build older than
      0.5.0, and that URL was writing the overlay's permanent token into browser
      history on every use.
    - Click it. wc3v.com opens and loads the game in the 3D viewer.
    - **Expect no pop-up warning of any kind.** The page opens nothing by itself,
      so a blocked-pop-up indicator in the address bar means something
      auto-opened and is a bug.
    - Leave that tab for ten minutes, then reload it. Expect the friendly *"That
      replay is no longer staged"* card rather than a bare `404`.
40. Back in the app, click **Watch** on a key moment.
    - Expect: the viewer opens at that moment rather than at the start.
    - Expect: the second time is much faster, because the browser remembers the
      game and skips the re-parse entirely.
41. Try it on a game you have never opened. First load takes a few seconds while
    the replay is parsed in the browser.

---

## G. Maps it has never seen

New in 0.3.0. Before this, a game on a non-ladder map simply failed.

42. Open a replay on a **custom or older map**, anything outside the current
    ladder pool.
    - Expect, in the Activity drawer: `downloading map data for "<map>"…`, then
      the game parses normally.
    - If the map genuinely has no published data, expect a named failure
      (`no local map data for "<map>"`) rather than a mystery.
43. To force it: quit WC3V, delete one map folder from
    `%APPDATA%\com.wc3v.desktop\maps\`, relaunch, open a game on that map.
    - Expect: it downloads and parses. Nothing should look different from a map
      that was already there.

---

## H. Coach

44. **Coach tab**, leaving the box blank for your own. **Nothing on this screen
    scrolls except the two lower cells.** Head band, trends band and both panels
    all fit the window. If the view itself scrolls, that is a fold-rule bug.
45. Expect: your name, record and form chip across the top, then **Over time** as
    one band of three (win rate, Tier 2, workers at 5:00), then **What the games
    say** beside a switchable records table (Matchups / Maps / Most faced). Every
    claim carries its n. If one looks wrong it is worth more than any layout bug,
    so write down the sentence.
46. **Over time**, specifically:
    - Under ~40 games you get "then / now" numbers with the n at each end and no
      chart. Intentional: two points joined by a line look like a trend while
      being two averages.
    - With more, three small plots. Hover a point for its dates and sample size.
    - Sanity check: does the "now" number match how you have actually been
      playing? This is the claim most able to be confidently wrong.
47. In **Most faced**, click a player's name. Coach re-renders on them and the
    lookup box mirrors the name. The same works from the report, where the
    opponent's name in the verdict line, the h2h heading and the build-order
    column titles are all doors to their book.

---

## I. The backfill

Do this last. It runs for a long time and makes everything else better.

48. **Settings → Parse all replays.**
49. Expect: a progress bar above the feed, no ETA until at least 5 games have
    been measured, and then one labelled "(rough)".
50. Let it run. Games should appear in the feed as they finish.
51. **Quit and relaunch mid-run.** Press Parse all replays again.
    - Expect: it picks up where it stopped rather than from the beginning.
52. When it finishes, the drawer prints the **measured seconds per replay**.
    **This number has never been observed, so write it down.** It is the one
    figure in the ROADMAP that is still a guess.
53. If any failed, **Retry failed**. With §G in place, map-missing failures
    should now clear.
54. Re-check Coach. With the full corpus the trend plots and coaching statements
    are finally on real data.

---

## OBS: setting up the Browser Source

Once. It survives restarts, because the port and token persist.

1. In WC3V: **Stream** tab → **Copy OBS Browser Source URL**.
2. In OBS: **Sources** → **+** → **Browser** → name it `WC3V` → OK.
3. In the properties dialog:
   - **URL**: paste. Clear the default `https://obsproject.com/browser-source`
     first.
   - **Width** `460`, **Height** `640`. This is the size the app suggests and
     logs. The overlay is capped at 27rem wide and grows downward.
   - **Uncheck "Shutdown source when not visible."** Leave it on and OBS kills the
     connection every time you switch scenes, so the overlay goes stale exactly
     when you are not looking at it.
   - Leave **Custom CSS** at its default. It already sets a transparent
     background, which is what makes the overlay float over your scene.
   - Leave "Refresh browser when scene becomes active" off. It is not needed,
     since the page reconnects on its own.
4. OK, then drag it where you want it in the scene.
5. **Send a test game to OBS** to place and size it before you ever play.

**Changing panels, theme or size** rewrites the URL, so re-copy it and paste it
into the source's properties again. That is deliberate: the URL carries its own
configuration, so a scene collection can be copied to another machine and keep
working.

**If nothing appears:** right-click the source → Interact. A blank page means the
token or port is wrong, so re-copy the URL from the app. "Waiting for a game"
means it is connected and working and you simply have no game yet.

---

## Appendix: the fold audit

The fold rule is that no view scrolls as a whole and only `.scroll` containers
scroll. It gets checked mechanically rather than by eye. Build the preview
(`node tools/build-desktop-client.js && node tools/desktop-preview.js --games=40
--w3c`), open `desktop/preview/preview.html`, size the viewport to **900×600**
and then **1280×820**, and on every view and every report tab, with a game
selected and the drawer closed, run:

```js
(() => {
  const bad = [];
  for (const el of document.querySelectorAll('body, body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (el.closest('.scroll')) continue;
    if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) {
      bad.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60) });
    }
  }
  return bad;
})()
```

Pass = `[]` everywhere. An element that clips via `overflow: hidden` reports too,
deliberately: clipped content is a fold bug as much as a scrollbar is.

### The second check: does the tab body actually scroll

**The snippet above skips anything inside `.scroll`, so it passes a report whose
default tab is scrolling.** It did, for a while: Story overflowed its scroller by
189px at 900x600 and the audit was green. Run this as well, with the drawer open
so `#feed .game` is there to loop over:

```js
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const per = {};
  for (const row of document.querySelectorAll('#feed .game')) {
    row.click(); await sleep(25);
    for (const tab of document.querySelectorAll('.report-tabs .seg-btn')) {
      tab.click(); await sleep(25);
      const b = document.querySelector('.report-body');
      const over = b.scrollHeight - b.clientHeight;
      const k = tab.textContent;
      per[k] = per[k] || { n: 0, scrolls: 0, worst: 0 };
      per[k].n++;
      if (over > 1) { per[k].scrolls++; per[k].worst = Math.max(per[k].worst, over); }
    }
  }
  return per;
})()
```

What each tab is allowed to do, at **both** window sizes, with a live match up
(the worst case — the mode switch costs another 38px):

| tab | 900x600 | 1280x820 |
|---|---|---|
| **Story** | **0 scrolls. Never. Any number here is a bug.** | **0 scrolls** |
| Economy | scrolls (four charts) | 0 scrolls |
| Build | scrolls on content-heavy games | scrolls on ~half |
| Full details | scrolls, by design | scrolls, by design |

Story is the app's default tab and the whole dashboard has to be on screen at
once, so it is held strictly. The others are content tabs and `.scroll` is doing
its job. Full details is the one tab you arrive at intending to scroll.

Pass `--w3c` so the Next game mode is reachable during the audit. Run the audit
in both modes.

The report frame changes shape per game, so audit **every game**, not one. The
snippet above is cheap enough to run in a loop over `#feed .game` with every tab
clicked. Games differ in whether they have a grade rail (none when you were not
in the game), whether Story has a dominance chart (none when the gate refused
the replay or the summary predates schema v4), and whether the strip has fights.

Open the feed drawer first, so `#feed .game` is on screen to loop over. Audit
the drawer OPEN as well: it covers the report rather than replacing it, and both
are laid out at once.

Last clean run: 5 Aug 2026, after the charts pass. Both sizes, all 40 preview
games, every report tab on every game, both column modes, the feed drawer open,
plus Coach, Stream and the Settings sheet. **160 checks per size, zero
offenders, zero console errors — and Story 0/40 scrolls at both sizes.**

Measured at 1280×820, after the charts pass:

| | Home redesign | charts pass |
|---|---|---|
| report frame | 310px | 166px (221 with a grade rail) |
| report tab body | 252px | 470px |
| frame timeline band | 114px (game strip) | none — strip moved to Full details |
| feed | 22rem rail, always up | 63px quick nav + drawer |

Measured at 900×600 after the Home redesign, kept for reference: tab body
34px → 149px, feed rows on screen 3 → 7.5, frame 427px → 325px.

**Two things the audit caught that eyes did not**, both worth re-checking after
any frame change:

- Squeezing the dominance gauge to `--dom-bar-h: 46px` clipped its internals on
  all 160 checks. That gauge has since been cut from the desktop entirely, but
  the lesson stands for anything borrowed from the viewer: it was drawn against
  the viewer's own geometry and type metrics, and `line-height: 1` alone reads
  as overflow to this audit.
- `.detail-col` was a five-row grid template ending in `1fr`. Any missing band
  put the scroller in an `auto` row and the whole column grew. It is flex now,
  keyed on `.scroll`, so it does not care how many bands a game has.

Note when driving this yourself: the preview's auto-detected identity is
whichever name appears most often in the sample, and the feed tiles show the
opponent, so clicking the first tile usually lands on a game that seat is not in,
where the grade rail and the benchmark tiles correctly do not exist. Search the
feed for the identity name and click through until the verdict reads Victory or
Defeat before auditing the report tabs.

---

## What to write down

Straight into `desktop/ROADMAP.md`, in the register it already uses:

- **§B**: snap, resize, drag, close-to-tray. The undecorated-window verdict.
- **§C2 20**: whether Next game fires on a real queue, and how fast.
- **§D 26**: transparency in a real OBS. Checklist item 2.
- **§A 4**: exactly what the installer did to the running app. Whether the
  upgrade *works* is already answered: 0.2.0 → 0.3.0, 5 Aug 2026.
- **§E 35**: seconds from the game ending to the overlay updating.
- **§I 52**: the measured seconds per replay. Checklist item 4.

And anything that was *wrong* rather than broken: a verdict the wrong way round,
a coaching claim that does not match how you play, a moment described in a way
you would not describe it. Those are worth more than layout bugs.
