# WC3V Desktop — the manual pass

Everything a person has to check by hand, in the order that wastes the least
time. `desktop/ROADMAP.md` is the source of truth for status; **record what
happens here back into it**, including the failures. A checklist that only ever
records successes is not evidence of anything.

Roughly 45 minutes end to end, plus one real game.

Two things to have open: this document, and the app's **Activity drawer**
(bottom bar → "ACTIVITY"). Most of what the app knows is in there.

> **Before you start:** if this window will be on camera, note that the OBS URL
> carries an access token. The app never displays it — it goes straight to the
> clipboard. Do not paste it anywhere visible on stream.

---

## A. The upgrade — do this first, it is destructive

ROADMAP checklist item 3, and the only test that needs an *older* build.

**The manual half is done: 0.2.0 → 0.3.0 was walked on 5 Aug 2026 and worked.**
What is left is whether anyone would ever have found out there was an update,
which is what 0.4.0 changes.

1. Install the older installer, launch it.
2. **Wait, and look at the app bar** — do not go to Settings.
   - Expect (0.4.0 and later): within a few seconds of launch, a small blue
     **Update to 0.x.y** chip appears to the left of your name.
   - It should not blink, and it should not be red. Nothing is wrong.
   - If it never appears: either the check failed (Activity drawer stays quiet
     by design, so try Settings → Check for updates to see the reason) or
     `Check for updates automatically` is off.
3. **Click the chip.** It should jump to Settings with the Install button
   focused, and the release notes for that version shown under it.
4. Click **Install 0.x.y**.
   - Expect: the NSIS installer runs. There may be a UAC prompt and a brief
     progress window.
   - **The app's own wording here may be wrong.** It says *"installed — restart
     to apply"*, but the Windows installer may close the app itself rather than
     waiting. Record what actually happens: whether the app exits on its own,
     whether it relaunches, and whether the tray icon is left behind.
5. Reopen. The chip should be gone and **Check for updates** should say
   **up to date**.
6. Turn **Check for updates automatically** off, restart the app, and confirm
   no chip appears and nothing is logged.

*Record: whether the chip showed up on its own, and what the installer did to
the running app.*

---

## B. The window itself — the riskiest change

`decorations: false` makes the app bar the window's title bar. A browser
preview cannot test any of this, which is why it is high on the list.

5. **Look at the top of the window.**
   - Expect: ONE bar — dark navy, `WC3V` at the left with a blue **3**, then
     **Last game / Coach / Stream** (three tabs, no Settings tab), then your
     name, a **gear** (that is Settings now — it should highlight while the
     Settings view is open), and the minimise / maximise / close buttons.
   - Fail: a second, Windows-drawn title bar sitting above it. That means
     `decorations` did not take.
6. **Drag the window** by an empty part of the bar. It should move.
7. **Double-click** an empty part of the bar. It should maximise, and again to
   restore.
8. **Drag the window to the top edge of the screen**, and try `Win`+`←`.
   - Expect: Aero Snap works normally.
   - **This is the one most likely to be broken by an undecorated window.** If
     snap or the resize border is gone, say so — the fallback (put decorations
     back and drop the app's own bar) is written up in ROADMAP §5.
9. **Drag each window edge and corner** to resize. All eight should work.
10. Click **✕**.
    - Expect: the window disappears, the app keeps running, the tray icon stays.
      It must NOT quit — the whole point is to keep watching while you play.
    - Reopen from the tray (left-click the icon, or right-click → Open WC3V).
11. Right-click the tray icon → **Quit**. That, and only that, should exit.
    Relaunch it afterwards.

*Record: snap, resize, drag, and whether close-to-tray held.*

---

## C. The game report ("Last game")

12. **Last game tab.** Expect a feed grouped by day, newest first, each row
    with a verdict plaque (W / L / ·), the opponent, race **glyphs** in the
    matchup chip (keep / axe / crescent / skull — our own marks, not game
    art), map and duration.
13. Click a game. **The right column must not scroll as a whole** — that is
    the fold rule. Expect a fixed frame: verdict + opponent (their name is a
    link — click it, you should land in Coach on them), an all-time record
    chip when you have ≥2 games against them, **Open in viewer** on the same
    row, a meta line carrying the archetype and APM, a single-row timings
    strip, then a tab strip: **Story / Heroes / Economy / Builds** (+ **Head
    to head** when it exists). Only the tab body scrolls.
14. **Heroes tab**: each hero with its portrait, final level, the skill order
    and final items as real icon rows. Hover an icon — the tooltip names the
    skill/item and when.
    - Icons come from `cdn.wc3v.com`. Empty carved squares = offline or CSP —
      say so.
15. **Economy tab**: two charts (workers, army size), you in gold, opponent in
    lapis, fights as dashed orange verticals. Under them, upgrades and mercs
    as icon strips. In a non-1v1, expect ONE line per chart, not an invented
    duel.
16. **Type an opponent's name** into the search box above the feed.
    - Expect: the count above the feed changes from `N parsed` to `X of N`, and
      only their games remain.
    - Try a map name too — it matches the name **as shown**, so "Echo" works.
17. Click **Wins**, then **Losses**, then a race glyph.
    - Expect: only that result / only games where *you* played that race.
18. Type nonsense into the search box.
    - Expect: *"No games match. Try a different name, or clear the filters."*
      — NOT the "nothing parsed yet" message.
    - Then clear the filters and **scroll the feed to the bottom** — more
      rows load as you approach the end (120 at a time).

---

## D. OBS

Full walkthrough below in §OBS. The checks:

19. **Stream tab.** The preview at the top sits on a grey checkerboard — that
    is deliberate, it is what transparency looks like. A preview on a solid
    panel would hide exactly the mistake this exists to catch.
20. Set up the Browser Source (§OBS), then click **Send a test game to OBS**.
    - Expect: the overlay appears in OBS within a second or two, **with a
      visible "preview — not a real game" strip**. It must be impossible to
      mistake for a real result.
21. **The transparency check — this is checklist item 2 and has never been
    done.** Put a colourful scene behind the overlay in OBS.
    - Expect: only the card is visible. No black box around it.
    - Fail: a black or white rectangle. Record it — OBS runs its own CEF build
      and this is the specific thing nobody has verified.
22. Toggle panels off and on in **Panels**. The preview updates immediately;
    OBS does *not* (the URL carries the choice, so re-copy and re-paste it to
    change what OBS shows). Confirm the app refuses to leave you with zero.
23. Try **Slate** under Look. Verdict colours should shift cool along with the
    panel — if Victory is still moss green on cool grey, that is the bug that
    was supposed to be fixed.
24. **Restart the app** with the OBS source still running.
    - Expect: the source reconnects on its own within a few seconds and shows
      the current state. No refresh, no touching OBS.
25. Click **Back to the real game** so the fake result is off the stream.
26. Click **Open the player view** — an ordinary opaque window for a second
    monitor.

---

## E. A real game — the whole premise

27. With WC3V running (window open or in the tray), **play a 1v1**.
28. When it ends, expect, in order and without touching anything:
    - a **Windows notification** within ~30 s: `Victory vs <name>` or
      `Defeat vs <name>`, then the map, duration, your all-time record against
      them, and the biggest moment of the game.
      - **Never fired before.** Windows may ask for notification permission the
        first time. If nothing appears, check Windows Settings →
        Notifications → WC3V before assuming the app is at fault.
    - the **overlay in OBS** updates to that result, no refresh.
    - the **session score** in the app bar becomes 1–0 or 0–1.
    - the app **switches to Games** and opens that game.
29. Check the verdict is the right way round. If it says Victory when you lost,
    the app has the wrong seat — click your name in the app bar and fix it.
    (This exact bug shipped once.)
30. Play a second game and confirm the session score and streak accumulate.
31. Now click through some **old** games in the feed.
    - Expect: the session score does NOT move, and the overlay does not change.
      Browsing history must never touch what is on stream.

*Record: how long from the game ending to the overlay updating.*

---

## F. Open in the viewer

Both halves of this exist and each was checked alone. The joined-up path has
never been walked.

32. Open a game and click **Open in viewer**.
    - Expect: your default browser opens a small WC3V card on `127.0.0.1`
      saying **Ready to open**, with one button.
    - **Look at the address bar.** It should read
      `http://127.0.0.1:<port>/open?h=<16 characters>` and nothing else. If you
      see `token=`, `key=` or `at=` in there, you are running a build older
      than 0.5.0 — that URL was writing the overlay's permanent token into
      browser history on every use.
    - Click it. wc3v.com opens and loads the game in the 3D viewer.
    - **Expect NO pop-up warning of any kind.** The page opens nothing by
      itself; a blocked-pop-up indicator in the address bar means something
      auto-opened and is a bug.
    - Leave that tab for ten minutes, then reload it. Expect the friendly
      *"That replay is no longer staged"* card — not a bare `404`.
33. Back in the app, click **Watch** on a key moment.
    - Expect: the viewer opens at that moment, not at the start.
    - Expect: the second time, it is **much faster** — the browser remembers the
      game and skips the re-parse entirely.
34. Try it on a game you have never opened. First load takes a few seconds
    (the replay is parsed in the browser).

---

## G. Maps it has never seen

New in 0.3.0. Before this, a game on a non-ladder map simply failed.

35. Open a replay on a **custom or older map** — anything outside the current
    ladder pool.
    - Expect, in the Activity drawer: `downloading map data for "<map>"…`, then
      the game parses normally.
    - If the map genuinely has no published data, expect a named failure
      (`no map data published for "<map>"`), not a mystery.
36. To force it: quit WC3V, delete one map folder from
    `%APPDATA%\com.wc3v.desktop\maps\`, relaunch, open a game on that map.
    - Expect: it downloads and parses. Nothing should be visibly different from
      a map that was already there.

---

## H. Coach

37. **Coach tab** (leave the box blank for your own). **Nothing on this
    screen scrolls except the two lower cells** — head band, trends band and
    both panels all fit the window. If the view itself scrolls, that is a
    fold-rule bug.
38. Expect: your name/record/form chip across the top, then **Over time** as
    one band of three (win rate, Tier 2, workers at 5:00), then **What the
    games say** beside a switchable records table (Matchups / Maps / Most
    faced). Every claim carries its n — if one looks wrong, it is worth more
    than any layout bug; write down the sentence.
39. **Over time**, specifically:
    - With **under ~40 games** you get "then / now" numbers with the n at
      each end and no chart. Intentional — two points joined by a line look
      like a trend while being two averages.
    - With more, three small plots; hover a point for its dates and sample
      size.
    - Sanity check: does the "now" number match how you have actually been
      playing? This is the claim most able to be confidently wrong.
40. In **Most faced**, click a player's name → Coach re-renders on them and
    the lookup box mirrors the name. The same works from the report: the
    opponent's name in the verdict line, the h2h heading and the build-order
    column titles are all doors to their book.

---

## I. The backfill

Do this last — it runs for a long time and makes everything else better.

41. **Settings → Parse all replays.**
42. Expect: a progress bar above the feed, no ETA until at least 5 games have
    actually been measured, and then one labelled "(rough)".
43. Let it run. Games should appear in the feed as they finish.
44. **Quit and relaunch mid-run.** Press Parse all replays again.
    - Expect: it picks up where it stopped, not from the beginning.
45. When it finishes, the drawer prints the **measured seconds per replay**.
    **This number has never been observed — write it down.** It is the one
    figure in the ROADMAP that is still a guess.
46. If any failed, **Retry failed** — with §G in place, map-missing failures
    should now clear.
47. Re-check the Profile: with the full corpus the trend plots and coaching
    statements are finally on real data.

---

## OBS — setting up the Browser Source

Once. It survives restarts, because the port and token persist.

1. In WC3V: **Stream** tab → **Copy OBS Browser Source URL**.
2. In OBS: **Sources** → **+** → **Browser** → name it `WC3V` → OK.
3. In the properties dialog:
   - **URL** — paste. (Clear the default `https://obsproject.com/browser-source`
     first.)
   - **Width** `460`, **Height** `640`. This is the size the app suggests and
     logs; the overlay is capped at 27rem wide and grows downward.
   - **Uncheck "Shutdown source when not visible."** Leave this on and OBS kills
     the connection every time you switch scenes, so the overlay goes stale
     exactly when you are not looking at it.
   - Leave **Custom CSS** at its default — it already sets a transparent
     background, which is what makes the overlay float over your scene.
   - Leave "Refresh browser when scene becomes active" off. It is not needed:
     the page reconnects on its own.
4. OK, then drag it where you want it in the scene.
5. **Send a test game to OBS** to place and size it before you ever play.

**Changing panels, theme or size** rewrites the URL, so re-copy it and paste it
into the source's properties again. That is deliberate — the URL carries its own
configuration, so a scene collection can be copied to another machine and keep
working.

**If nothing appears:** right-click the source → Interact. If the page is blank,
the token or port is wrong — re-copy the URL from the app. If you see "Waiting
for a game", it is connected and working; you just have no game yet.

---

## Appendix: the fold audit

The fold rule — no view scrolls as a whole; only `.scroll` containers scroll —
is checked mechanically, not by eye. Build the preview
(`node tools/build-desktop-client.js && node tools/desktop-preview.js
--games=40`), open `desktop/preview/preview.html`, size the viewport to
**900×600** and then **1280×820**, and on every view (and every report tab,
with a game selected and the drawer closed) run:

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

Pass = `[]` everywhere. An element that clips via `overflow: hidden` reports
too — deliberately: clipped content is a fold bug as much as a scrollbar is.
Last clean run: 5 Aug 2026, both sizes, all four views, all five report tabs.

---

## What to write down

Straight into `desktop/ROADMAP.md`, in the register it already uses:

- **§B** — snap, resize, drag, close-to-tray. The undecorated-window verdict.
- **§D 21** — transparency in a real OBS. Checklist item 2.
- **§A 4** — exactly what the installer did to the running app. (Whether the
  upgrade *works* is answered: 0.2.0 → 0.3.0, 5 Aug 2026.)
- **§E 28** — seconds from the game ending to the overlay updating.
- **§I 45** — the measured seconds per replay. Checklist item 4.

And anything that was *wrong* rather than broken: a verdict the wrong way
round, a coaching claim that does not match how you play, a moment described in
a way you would not describe it. Those are worth more than layout bugs.
