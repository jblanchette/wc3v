---
title: "Download WC3V Desktop | WC3V"
url: https://wc3v.com/download
description: "Download the WC3V desktop app for Windows. Check the version and checksum, read the disclosures, and get the installer straight from our CDN."
updated: 2026-08-12
---

# Download WC3V for Windows

The desktop app watches your replays folder. When a game ends, the report is already there: the result, who was ahead and when, both builds, the whole economy. Every moment opens the 3D viewer at that second.

Latest release

## Loading…

`irm https://wc3v.com/install.ps1 | iex` [Or download the installer](#)

Paste into PowerShell. Windows shows no warning on this path, and the script checks the download against the published SHA-256 before it installs anything.

``

Couldn't reach the update server just now, so the version and checksum above are missing. The install command still works: it reads the same manifest directly and will tell you what it found.

[View source on GitHub](https://github.com/jblanchette/wc3v) ![The WC3V desktop report: victory header beside the dominance chart, the timeline of the game's moments, and both players' armies side by side](https://wc3v.com/assets/press/report-overview.webp) ![The Build tab: hero cards with skills and items, and both players' build orders interleaved as one timeline](https://wc3v.com/assets/press/report-build.webp) ![The Economy tab: APM over time, action breakdown, trade balance and food charts for both players](https://wc3v.com/assets/press/report-economy.webp) ![A 3v3 team game report showing tier progression and unit rosters for all six players](https://wc3v.com/assets/press/report-team.webp) Release notes

Windows 10/11, 64-bit SHA-256 ``

## Details

- **The installer is not code-signed.** A signed build needs a certificate the project doesn't have. Download it in a browser and SmartScreen says "Windows protected your PC": choose **More info**, then **Run anyway**. The install command avoids that screen because a file fetched by PowerShell is never tagged as a browser download.

- **Check it yourself.** [Read install.ps1](https://wc3v.com/install.ps1) before you run it, and compare the SHA-256 above against the file. That is what the script does on your behalf, and it will refuse to install on a mismatch.

- **Smart App Control blocks it.** If you're on a clean Windows 11 install with Smart App Control on, unsigned apps are refused outright and neither path will work. The [browser viewer](https://wc3v.com/viewer) needs no install.

- **Installs for you only.** It goes in your user folder, asks for no administrator rights, and updates itself from inside the app. Remove it from Add or remove programs.

- **Windows 10 and 11, 64-bit.** No macOS or Linux build yet.

- **Built in the open.** Every release is compiled from the public repository by GitHub Actions. [Read the source or build it yourself](https://github.com/jblanchette/wc3v), GPLv3.

- **Privacy.** The app reads replays on your machine and transfers no data, with two exceptions you control: opening a game in the wc3v.com viewer, and the opt-in W3Champions ladder lookup (off by default). See the [privacy policy](https://wc3v.com/privacy).

- **No warranty.** See the [Terms of Service](https://wc3v.com/terms).

[View source on GitHub](https://github.com/jblanchette/wc3v) [Back to WC3V](https://wc3v.com/)
