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

This is ROADMAP checklist item 3, and it is the only test that needs the *old*
build. Do it before anything else, because everything after this assumes 0.3.0.

1. Install `WC3V_0.2.0_x64-setup.exe`, launch it.
2. **Settings → Check for updates.**
   - Expect: `version 0.3.0 is available`, and the button relabels itself to
     **Install 0.3.0**.
   - If it says *"updates are not configured for this build"* — the endpoint is
     missing from the binary. Wrong build.
   - If it errors — read the reason in the drawer. A DNS or 404 failure means
     the manifest is not reachable; check `https://cdn.wc3v.com/desktop/latest.json`
     in a browser.
3. Click **Install 0.3.0**.
   - Expect: the NSIS installer runs. There may be a UAC prompt and a brief
     progress window.
   - **This step has never been walked and the app's own wording may be wrong.**
     It says *"installed 0.3.0 — restart to apply"*, but the Windows installer
     may close the app itself rather than waiting to be restarted. Record what
     actually happens — whether the app exits on its own, whether it relaunches,
     and whether the tray icon is left behind.
4. Reopen the app. **Settings → Check for updates** should now say
   **up to date**, and the window should look different (see §B).

*Record: did the update land, and what did the app do while it was landing.*

---

## B. The window itself — the riskiest change

`decorations: false` makes the app bar the window's title bar. A browser
preview cannot test any of this, which is why it is high on the list.

5. **Look at the top of the window.**
   - Expect: ONE bar — dark navy, `WC3V` at the left with a blue **3**, then
     Games / Profile / Stream / Settings, then your name and the minimise /
     maximise / close buttons.
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

## C. Your games

12. **Games tab.** Expect a feed grouped by day, newest first, each row with a
    verdict plaque (W / L / ·), the opponent, the matchup, map and duration.
13. Click a game. The right column should show the verdict, **Open in viewer**,
    a timings strip, key moments with Watch buttons, head-to-head if you have
    played them before, and **both build orders with icons**.
    - The icons come from `cdn.wc3v.com`. If they are empty carved squares,
      either you are offline or the CSP is wrong — check the browser console
      equivalent in the drawer, and say so.
14. **Type an opponent's name** into the search box above the feed.
    - Expect: the count above the feed changes from `N parsed` to `X of N`, and
      only their games remain.
    - Try a map name too — it matches the name **as shown**, so "Echo" works.
15. Click **Wins**, then **Losses**.
    - Expect: only that result. Every plaque should read the same letter.
16. Click a race chip (**HU / OC / UD / NE**).
    - Expect: only games where *you* played that race, once your name is set.
17. Type nonsense into the search box.
    - Expect: *"No games match. Try a different name, or clear the filters."*
      — NOT the "nothing parsed yet" message. Those are different situations
      and must not look the same.
18. Clear the filters (the ✕ in the search box) and **scroll the feed to the
    bottom**.
    - Expect: more rows load as you approach the end. It renders 120 at a time,
      so a big history should still open instantly.

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
    - Expect: your default browser opens `127.0.0.1`, shows a WC3V card, and
      then opens wc3v.com and loads the game in the 3D viewer.
    - You may have to allow a popup, or click the button on the loopback page.
      That is by design — `window.open` without a click is blocked.
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

## H. Profile and coaching

37. **Profile tab** (leave the box blank for your own).
38. Expect: your record, then **What the games say** — plain sentences, every
    one carrying its n. If a claim looks wrong, it is worth more than any
    layout bug; write down the sentence.
39. Scroll to **Over time**.
    - With **under ~40 games** you will see "then / now" numbers with the n at
      each end and no chart. That is intentional — two points joined by a line
      look like a trend while being two averages.
    - With more, expect three small plots: win rate, Tier 2, workers at 5:00.
      Hover any point for its dates and sample size.
    - Sanity check: does the "now" number match how you have actually been
      playing? This is the claim most able to be confidently wrong.
40. Type an **opponent's name** into the box → their profile, built from your
    own games against them.

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

## What to write down

Straight into `desktop/ROADMAP.md`, in the register it already uses:

- **§B** — snap, resize, drag, close-to-tray. The undecorated-window verdict.
- **§D 21** — transparency in a real OBS. Checklist item 2.
- **§A** — the upgrade, and exactly what it did to the running app.
- **§E 28** — seconds from the game ending to the overlay updating.
- **§I 45** — the measured seconds per replay. Checklist item 4.

And anything that was *wrong* rather than broken: a verdict the wrong way
round, a coaching claim that does not match how you play, a moment described in
a way you would not describe it. Those are worth more than layout bugs.
