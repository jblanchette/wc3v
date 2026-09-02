---
title: "WC3V Desktop for Windows | WC3V"
url: https://wc3v.com/download
description: "A free Windows app that reviews your Warcraft III games for you. It watches your replay folder, reads each game on your own PC, and has the report ready before you have alt-tabbed. Includes an OBS overlay."
updated: 2026-09-02
---

WC3V Desktop · free · Windows 10 and 11

# It reviews your Warcraft III games for you.

Leave it running. Every game you finish is read on your own PC and laid out before you have alt-tabbed.

`irm https://wc3v.com/install.ps1 | iex` **Loading…**

## How it works

**1. It watches your replay folder** Reforged, classic and W3Champions. **2. It reads each game here** On your machine, in seconds. **3. The report is waiting** Any moment opens in the 3D viewer.

## Safe to run

- **Never touches the game.** No injection, no memory reading, no input automation.

- **Nothing leaves your PC.** No upload, no account. One anonymous usage count, off in Settings.

- **One local socket.** The overlay binds `127.0.0.1`, token-gated, GET only.

- **Open source.** GPLv3, the [`desktop/` folder on GitHub](https://github.com/jblanchette/wc3v/tree/master/desktop).

## The whole game, laid out

![The WC3V setup screen on its third step: one large card reading This is you with the player's name and the town halls of the races they play, smaller cards for the other names in their recent games, and a W3Champions switch](https://wc3v.com/assets/press/app-setup.webp) ![The WC3V desktop app's Home tab: a strip of recently parsed games along the top and a status bar reading Watching for new games](https://wc3v.com/assets/press/app-home.webp) ![The Overview tab: victory header, dominance chart, moments timeline, and both players' unit rosters and match stats](https://wc3v.com/assets/press/report-overview.webp) ![The Build tab: hero cards with skills and items for both players, above their build orders interleaved as one timeline](https://wc3v.com/assets/press/report-build.webp) ![The Economy tab: APM over time, an action breakdown, trade balance and food charts for both players](https://wc3v.com/assets/press/report-economy.webp) ![A 3v3 team game report showing tier progression and unit rosters for all six players](https://wc3v.com/assets/press/report-team.webp)

Four steps, once. It finds your replay folders, works out which player you are from your own recent games, and says what stays on your machine before anything else.

[ Source on GitHub ](https://github.com/jblanchette/wc3v/tree/master/desktop)

Open source, GPLv3. The app is the `desktop/` folder of the [wc3v repository](https://github.com/jblanchette/wc3v), a Rust shell around the same parser the website runs. Read it, build it yourself, or file an issue.

## On stream

![The WC3V stream overlay card after a game: a Victory header, the map and length, hero portraits with levels, and both armies with counts](https://wc3v.com/assets/press/overlay-card.webp)

- **Nobody can snipe you through it.** The app never sees a live game.

- **One URL into an OBS Browser Source.** Your panels, four themes, and a casting page for broadcasts.

## Install

- Version Loading…

- Installs to Your user folder, no admin

- SHA-256 `—`

### Common questions

**Windows doesn't recognise the app.** The build is not code-signed. A paid certificate runs about $120 a year and would still not silence Windows, since it dropped instant trust for those in 2024. The Microsoft Store would silence it, and that route is closed to us: the app ships Blizzard's icon art, and Microsoft owns Blizzard. The install command gets past the warning another way. SmartScreen fires on the Mark of the Web, a tag browsers write onto files they download, and PowerShell does not write it. On a clean Windows 11 machine with Smart App Control switched on, unsigned apps are refused whatever you do.

**What does the command run?** [install.ps1](https://wc3v.com/install.ps1), which you can read first. It fetches the release manifest, downloads the installer, compares its SHA-256 against the one above and runs it. No elevation, no registry writes of its own, and the script itself sends nothing anywhere (we count how many times it is downloaded, and that is all). A hash that does not match aborts the install.

**Can I get banned for it?** It reads `.w3g` files Warcraft III has already finished writing, and does nothing else. No injection, no memory reading, no packet inspection, no input automation, and nothing drawn over the game. It cannot see or touch a match in progress, which is also why the overlay is safe on a live stream. Four outbound requests exist, all named in Settings and none carrying anything about you or your games: icon art and map data from `cdn.wc3v.com`; the W3Champions lookup, which stays off until you turn it on; and an anonymous usage count, which is on and which Settings can switch off. The count is the event name, the app version and the OS family, with no identifier of any kind, and the server keeps no IP address. See the [privacy policy](https://wc3v.com/privacy).

**Mac or Linux?** Not yet, Windows 10 and 11 64-bit only. The [browser viewer](https://wc3v.com/viewer) runs anywhere and needs no install. Uninstall from Add or remove programs.
