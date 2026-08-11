---
title: "Privacy Policy | WC3V"
url: https://wc3v.com/privacy
description: "Privacy policy for WC3V. Replays are parsed in your browser and never uploaded. We don't sell your data because we don't have any."
updated: 2026-08-11
---

# Privacy Policy

What data WC3V touches, what it doesn't, and where it lives.

Effective: May 6, 2026

**Short version:** Your replay files never leave your browser. We don't have user accounts, don't run analytics, and don't sell anything because there's nothing to sell. WC3V is a static site hosted in the United States.

## 1. Replays stay on your device

When you load a `.w3g` file into WC3V, it is parsed locally in your browser using a JavaScript parser bundle. **The replay file is never uploaded to our servers.** Parsed metadata (player names, race, build timeline, map, units, etc.) may be stored in your browser's local storage and IndexedDB so you can revisit your replay library without re-uploading. That data lives on your device and you can clear it at any time by clearing your browser's site data for wc3v.com.

## 2. What we don't collect

- No user accounts, no email addresses, no passwords.

- No tracking pixels, no third-party advertising, no behavioral analytics.

- No replay file uploads.

- No personal identifying information beyond what your browser sends to any web server (IP address, user agent — see below).

## 3. What our server sees

When you visit WC3V, our hosting provider's web server receives standard HTTP request information so it can serve pages: your IP address, the URL you requested, your user agent string, the referring URL, and a timestamp. This is standard for any website on the internet. These access logs are kept briefly for operational and security purposes (typically a few days to a few weeks at the host level) and are not combined with any other data.

## 4. Local storage on your device

WC3V uses your browser's storage APIs to keep things working between visits:

- **IndexedDB** — your parsed replay library (the `.wc3v` JSON output of replays you've loaded).

- **localStorage** — small UI preferences (e.g. layout mode, terms acknowledgment, dismissed banners).

None of this is sent to us. Clear it any time via your browser's site-data controls.

## 4a. The WC3V desktop app

The desktop app (downloadable from [wc3v.com/download.html](https://wc3v.com/download)) watches your Warcraft III replay folders and parses every game **on your machine**. Replays and the reports built from them are stored locally and are never uploaded. The app makes network requests in exactly three cases:

- **Update checks** — it polls our CDN for a newer version, which reveals your IP address and the request the same way any web server sees one.

- **Game art** — unit and item icons are fetched from our CDN by their game ID; no information about your games is attached.

- **Optional, off by default:** the W3Champions ladder lookup queries the public W3Champions API with a player's battle tag while a match is running. "Open in WC3V Viewer" opens the wc3v.com viewer in your browser; the replay data itself is served to that page over loopback (127.0.0.1) and still never leaves your machine. Both only happen when you turn them on or click them.

Nothing else leaves your machine. There is no telemetry, no analytics, and no account.

## 5. Third-party content loaded by your browser

Some pages load JavaScript libraries from public CDNs so you don't have to download them from us:

- [cdnjs (Cloudflare)](https://cdnjs.cloudflare.com/) — D3.js

- [unpkg](https://unpkg.com/) — RBush

- [jsDelivr](https://www.jsdelivr.com/) — Three.js

When your browser fetches these files, those CDNs see your IP address and a request URL the same way any web server would. They are subject to their own privacy policies.

## 6. Cookies

WC3V does not set tracking cookies. The hosting provider may set minimal technical cookies for security or load-balancing; we don't use any analytics or advertising cookies.

## 7. Children's privacy

WC3V is intended for a general audience and is not directed at children under 13. We don't knowingly collect personal information from children.

## 8. Your choices

- **Clear local data:** Clear site data for wc3v.com in your browser settings to remove your replay library and preferences.

- **Stop using the site:** Closing the tab is a complete privacy reset on our end — we have nothing about you to delete.

- **Block CDNs:** If you don't want third-party CDNs to see your IP, use a browser extension or VPN of your choice.

## 9. Changes

If this policy changes, the effective date at the top of this page will be updated. Material changes will be called out in the site footer or release notes.

## 10. Contact

Questions or concerns: open an issue on [GitHub](https://github.com/jblanchette/wc3v/issues).

[Back to WC3V](https://wc3v.com/) [Terms of Service](https://wc3v.com/terms)
