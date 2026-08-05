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
     **Last game / Coach / Stream** (three tabs, no Settings tab), then your
     name, a **gear** for Settings which should highlight while the Settings view
     is open, and the minimise / maximise / close buttons.
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

## C. The game report ("Last game")

12. **Last game tab.** Expect a feed grouped by day, newest first, each row with
    a verdict plaque (W / L / ·), the opponent, race **glyphs** in the matchup
    chip (keep / axe / crescent / skull, our own marks rather than game art), map
    and duration.
13. Click a game. **The right column must not scroll as a whole**, which is the
    fold rule. Expect a fixed frame: verdict and opponent, whose name is a link
    that lands you in Coach on them, an all-time record chip once you have ≥2
    games against them, **Open in viewer** on the same row, a meta line carrying
    the archetype and APM, **the one-line read under it**, a single-row timings
    strip, then a tab strip of **Review / Story / Heroes / Economy / Builds**
    plus **Head to head** when it exists. Only the tab body scrolls.
    - Click the one-line read. It should take you to the Review tab.
    - A game you were not in has no Review tab at all, and the verdict says
      "You were not in this game". That is correct.
13a. **Review tab**, the default. Expect five grades (Economy, Army, Hero, Map
    control, Mechanics), each a number with a short note under it, green for good
    and rust for poor. Then a benchmark strip ("tier 2 · 2:41 · you usually
    2:21"), then **What to fix** and, when there is one, **What went right**,
    each line with a time and a **Watch** button.
    - **The read has to survive a straight face.** Open three games you actually
      remember and read the headline and the mistakes aloud. If it blames economy
      in a game you lost to a hero snipe, the thresholds are wrong. Record it and
      re-run the corpus pass (ROADMAP §11).
    - Click a **Watch** button. The viewer should open at that second.
    - A mistake line with no time carries no Watch button. Correct.
    - The bottom line states what the grades are measured against ("your own
      recent games in this matchup"). On a fresh install with no history it
      should say it is using general anchors instead. It must never claim a
      comparison that does not exist.
14. **Heroes tab**: each hero with its portrait, final level, the skill order and
    final items as real icon rows. Hover an icon and the tooltip names the skill
    or item and when.
    - Icons come from `cdn.wc3v.com`. Empty carved squares mean offline or CSP,
      so say so.
15. **Economy tab**: two charts (workers, army size), you in gold, opponent in
    lapis, fights as dashed orange verticals. Under them, upgrades and mercs as
    icon strips. In a non-1v1, expect one line per chart rather than an invented
    duel.
16. **Type an opponent's name** into the search box above the feed.
    - Expect: the count above the feed changes from `N parsed` to `X of N`, and
      only their games remain.
    - Try a map name too. It matches the name **as shown**, so "Echo" works.
17. Click **Wins**, then **Losses**, then a race glyph.
    - Expect: only that result, then only games where *you* played that race.
18. Type nonsense into the search box.
    - Expect: *"No games match those filters."*, and not the "No games yet."
      message.
    - Then clear the filters and **scroll the feed to the bottom**. More rows load
      as you approach the end, 120 at a time.

---

## C2. The scout card (W3Champions)

New. Off until you switch it on, and it needs a ladder identity.

19. **Settings → W3Champions → Look up ladder data.** Tick it.
    - If your name has no `#number`, the panel says so. That is the whole reason
      nothing else will happen, and it is not a bug.
    - Leave it off and confirm nothing appears at any point below.
20. **Queue for a ladder game on W3Champions** and go back to Last game while the
    loading screen is up.
    - Expect within ~20 s: a band above the feed reading **LIVE · vs
      &lt;opponent&gt;** with their race glyph, their MMR and rank, the map, and
      underneath it your own record against them plus one or two habits ("Opens
      Blademaster in 4 of 6").
    - A player you have never faced reads **First time against them**. That is
      correct, not a missing lookup.
    - Click their name. It should open them in Coach.
21. **Finish the game.** The card should disappear as the replay lands and the
    report takes over.
22. **Pull the network** (or turn the setting off mid-queue). The card should
    vanish and nothing should turn red. A W3Champions failure has to read as
    "no online data", never as a broken screen.
23. Minimise to the tray for a few minutes with the setting on, then reopen.
    Nothing should have polled while hidden, and the card should catch up on the
    next tick.

*Record: how long from queue-pop to the card appearing, and whether the habits
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
    - the app **switches to Last game** and opens that game.
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

Pass `--w3c` so the scout card is on screen during the audit. It adds a row above
both columns, and the fold budget has to hold with it there.

Last clean run: 5 Aug 2026, both sizes, all four views, all **six** report tabs
(Review, Story, Heroes, Economy, Builds, Head to head), plus the rebuilt Stream
and Settings panels and the scout card. Zero console errors.

Known squeeze, and it passes deliberately: at exactly 900×600 with the scout card
up, the report's scrolling tab body comes out around 34px. The frame still fits,
which is what the rule says, and during a live match the card is the thing being
read while the report below is last game's. Any window taller than the minimum
gets the space back. If that trade stops feeling right, the timings panel is the
155px to go after.

Note when driving this yourself: the preview's auto-detected identity is
whichever name appears most often in the sample, and the feed tiles show the
opponent, so clicking the first tile usually lands on a game that seat is not in,
where the Review tab correctly does not exist. Click through until the verdict
reads Victory or Defeat before auditing the report tabs.

---

## What to write down

Straight into `desktop/ROADMAP.md`, in the register it already uses:

- **§B**: snap, resize, drag, close-to-tray. The undecorated-window verdict.
- **§C2 20**: whether the scout card fires on a real queue, and how fast.
- **§D 26**: transparency in a real OBS. Checklist item 2.
- **§A 4**: exactly what the installer did to the running app. Whether the
  upgrade *works* is already answered: 0.2.0 → 0.3.0, 5 Aug 2026.
- **§E 35**: seconds from the game ending to the overlay updating.
- **§I 52**: the measured seconds per replay. Checklist item 4.

And anything that was *wrong* rather than broken: a verdict the wrong way round,
a coaching claim that does not match how you play, a moment described in a way
you would not describe it. Those are worth more than layout bugs.
