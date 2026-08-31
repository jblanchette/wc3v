---
title: "Privacy Policy | WC3V"
url: https://wc3v.com/privacy
description: "Privacy policy for WC3V. Replays are parsed in your browser and never uploaded. Anonymous usage counts only: no cookies, no IDs, no IP addresses stored."
updated: 2026-08-31
---

# Privacy Policy

What data WC3V touches, what it doesn't, and where it lives.

Effective: August 31, 2026

**Short version:** Your replay files never leave your browser. We don't have user accounts, don't set cookies, and don't sell anything because there's nothing to sell. The only measurement we do is anonymous usage counts with no identifiers of any kind (section 2a), which is why this site has no cookie banner. WC3V is a static site hosted in the United States.

## 1. Replays stay on your device

When you load a `.w3g` file into WC3V, it is parsed locally in your browser using a JavaScript parser bundle. **The replay file is never uploaded to our servers.** Parsed metadata (player names, race, build timeline, map, units, etc.) may be stored in your browser's local storage and IndexedDB so you can revisit your replay library without re-uploading. That data lives on your device and you can clear it at any time by clearing your browser's site data for wc3v.com.

## 2. What we don't collect

- No user accounts, no email addresses, no passwords.

- No cookies, no tracking pixels, no third-party advertising, no behavioral profiling, no fingerprinting.

- No analytics IDs. Nothing is stored in or read from your browser for measurement, and we cannot tell two of your visits apart.

- No replay file uploads.

- No personal identifying information beyond what your browser sends to any web server (IP address, user agent — see below).

## 2a. Anonymous usage counts

We count how the site and the desktop app are used, in aggregate, so we know what is worth building. Here is the complete list of what a count contains:

- **The event name** — a page was viewed, a replay was parsed in the browser, the install command was copied, the installer script was downloaded, the desktop app started, or the desktop app parsed a newly finished game.

- **The page path** — for example `/builds`. The query string is stripped before sending, so a replay id or search term is never included.

- **The referring site's hostname** — for example `www.google.com`, never the full URL.

- **For the desktop app:** its version number and OS family (for example `0.10.0` and `win`).

- **A country code** — derived at our CDN's edge from your IP address in memory. The IP address itself is not stored.

That is the whole record. No IP address, no user agent, no cookie, no device ID, no generated ID of any kind is stored with it. The result is anonymous aggregate data: it is not personal data under the GDPR, the UK GDPR, or the CCPA, and no consent prompt is required for it anywhere. It also stores nothing on your device and reads nothing from it, so the ePrivacy cookie rules don't apply to it either.

We honor opt-out signals anyway: if your browser sends **Do Not Track** or **Global Privacy Control**, the site sends no usage events at all. The desktop app has its own switch (Settings, then Usage counter).

## 3. What our server sees

When you visit WC3V, our hosting provider's web server receives standard HTTP request information so it can serve pages: your IP address, the URL you requested, your user agent string, the referring URL, and a timestamp. This is standard for any website on the internet. These access logs are kept briefly for operational and security purposes (typically a few days to a few weeks at the host level) and are not combined with any other data.

## 4. Local storage on your device

WC3V uses your browser's storage APIs to keep things working between visits:

- **IndexedDB** — your parsed replay library (the `.wc3v` JSON output of replays you've loaded).

- **localStorage** — small UI preferences (e.g. layout mode, terms acknowledgment, dismissed banners).

None of this is sent to us. Clear it any time via your browser's site-data controls.

## 4a. The WC3V desktop app

The desktop app (downloadable from [wc3v.com/download.html](https://wc3v.com/download)) watches your Warcraft III replay folders and parses every game **on your machine**. Replays and the reports built from them are stored locally and are never uploaded. The app makes network requests in exactly four cases:

- **Update checks** — it polls our CDN for a newer version, which reveals your IP address and the request the same way any web server sees one.

- **Game art** — unit and item icons are fetched from our CDN by their game ID; no information about your games is attached.

- **Anonymous usage ping, on by default** — when the app starts, and when it parses a newly finished game, it sends the event name, its version number, and the OS family to wc3v.com. That is the entire message: nothing about you, your games, your account names, or your machine is attached, and the server stores no IP address with it (see section 2a). Turn it off any time under Settings, then Usage counter.

- **Optional, off by default:** the W3Champions ladder lookup queries the public W3Champions API with a player's battle tag while a match is running. "Open in WC3V Viewer" opens the wc3v.com viewer in your browser; the replay data itself is served to that page over loopback (127.0.0.1) and still never leaves your machine. Both only happen when you turn them on or click them.

Nothing else leaves your machine. There is no account and nothing that identifies you.

## 5. Third-party content loaded by your browser

Some pages load JavaScript libraries from public CDNs so you don't have to download them from us:

- [cdnjs (Cloudflare)](https://cdnjs.cloudflare.com/) — D3.js

- [unpkg](https://unpkg.com/) — RBush

- [jsDelivr](https://www.jsdelivr.com/) — Three.js

When your browser fetches these files, those CDNs see your IP address and a request URL the same way any web server would. They are subject to their own privacy policies.

## 6. Cookies

WC3V sets no cookies of its own: none for tracking, none for analytics, none for advertising. The usage counts in section 2a work without cookies and without storing anything in your browser. That is why the site shows no cookie consent banner: under the EU ePrivacy rules a banner is required for storing or reading information on your device, and we don't. The hosting provider may set minimal technical cookies for security or load balancing, which are exempt as strictly necessary.

## 7. Children's privacy

WC3V is intended for a general audience and is not directed at children under 13. We don't knowingly collect personal information from children.

## 8. Your choices

- **Clear local data:** Clear site data for wc3v.com in your browser settings to remove your replay library and preferences.

- **Stop using the site:** Closing the tab is a complete privacy reset on our end — we have nothing about you to delete.

- **Opt out of usage counts:** Turn on Do Not Track or Global Privacy Control in your browser and the site sends no usage events. In the desktop app, use the switch under Settings, then Usage counter. There is no data-deletion request to make because nothing we store can be connected to you.

- **Block CDNs:** If you don't want third-party CDNs to see your IP, use a browser extension or VPN of your choice.

## 9. Changes

If this policy changes, the effective date at the top of this page will be updated. Material changes will be called out in the site footer or release notes.

## 10. Contact

Questions or concerns: open an issue on [GitHub](https://github.com/jblanchette/wc3v/issues).

[Back to WC3V](https://wc3v.com/) [Terms of Service](https://wc3v.com/terms)
