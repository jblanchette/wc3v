# Dependency security decisions

Why each advisory was fixed the way it was, so the next person does not have to
re-derive it — and so the ones that are *deliberately* left open are visibly
deliberate rather than ignored.

Baseline: 20 open Dependabot alerts (1 critical, 9 high, 9 moderate, 1 low).
After this pass: **`npm audit` reports 0 vulnerabilities**; one Rust advisory is
upstream-blocked and dismissed with a reason (below).

The question that drove every decision was **does this code reach a user, and
can it be reached by untrusted input** — not the severity label. The parser runs
**client-side in the browser on user-uploaded `.w3g` files**
(`client/js/vendor/wc3v-parser.bundle.js`), so anything bundled into it is
attacker-reachable in a way build tooling is not.

---

## Fixed

### protobufjs — critical RCE + 10 more (11 of the 20 alerts)

`w3gjs` decodes Reforged player metadata (battleTag, clan, portrait) with
protobufjs, and **that runs in the browser bundle on untrusted replay bytes**.
This was the one genuinely exposed advisory: several of the findings are about
*decoding* (prototype injection in generated constructors, unbounded recursion,
overlong UTF-8), not just about loading untrusted `.proto` files.

`w3gjs` is pinned to `3.0.0` and resolved protobufjs 7.5.4, so the fix is an
npm `overrides` entry to `^7.6.5` (the first patched release). The `Type`/`Field`
API w3gjs uses is unchanged across 7.x. Rationale is duplicated in
`package.json` under `overridesRationale` so it is visible at the pin.

### image-size — 2 high, "no fix available"

Removed. It was a **dead `require`** in `lib/PathFinder.js` — imported as
`sizeOf` and never called. Both advisories had no patched version, so deleting
the unused dependency was the only fix available, and the correct one.

### image-js — 1 high (jpeg-js) + 1 moderate (@babel/runtime)

Removed. Referenced nowhere in the repo outside `package.json`.

### crypto-browserify / elliptic / browserify-sign / create-ecdh — 4 low

Removed. `elliptic` has **no fix** (6.6.1 is both the latest release and the
flagged version; npm's suggested "fix" is a *downgrade* of crypto-browserify).
It was reachable only as an esbuild alias for `crypto` in the parser bundle —
and nothing in the bundled code imports `crypto` at all, so the alias was
removed along with the dependency. Verified: the bundle builds, and
`tools/verify-bundle-parity.js` still passes.

If a future dependency needs `crypto` in the browser bundle, the build will fail
loudly with an unresolved import — re-add the alias then, deliberately.

### d3-color — 1 high, ReDoS, and it was shipping to users

The parser pulled in **all of d3** for exactly one function —
`_d3.scaleLinear`, used by `GameScaler` — which dragged `d3-color` into the
browser bundle. The ReDoS is in colour *string* parsing, which the parser never
does, so it was not exploitable. But d3 v5 pins `d3-color` 1.4.1 and the patched
3.1.0 is ESM-only and incompatible, so there was no upgrade path, and
`CLAUDE.md` correctly forbids moving off D3 v5.

Replaced with `lib/linearScale.js`: a ~40-line `scaleLinear` used **only by the
parser**. The viewer still loads D3 v5 from the CDN and injects it into its own
`GameScaler` (`client/js/app.js`) — that path is untouched, exactly as the D3 v5
rule requires.

**This was gated on byte-identical output, and the gate earned its keep.** The
first two attempts were algebraically correct and still changed exported unit
coordinates, which cascaded into battle boxes and order target uuids:

1. d3's `bimap` **swaps the endpoints** when the domain descends
   (`if (d1 < d0) ...`). Same line, different operation order, different last
   bits — and WC3's inverted y axis takes that branch constantly.
2. d3's `interpolateNumber` evaluates `a * (1 - t) + b * t`, **not** the
   identical-on-paper `a + (b - a) * t`.

`lib/linearScale.js` mirrors both. Verified byte-identical across 19 replays on
8 different maps via `tools/diff-wc3v.js`, so no reparse or replay redeploy was
needed. Bonus: the parser bundle shrank **1602 KB → 1333 KB (−17%)** for every
visitor.

---

## Open, deliberately

### glib `GHSA-wrw7-89jp-8q8g` (moderate, Rust) — upstream-blocked, not shipped

`desktop/src-tauri/Cargo.lock` resolves glib 0.18.5. Patched is 0.20.0, which
**cannot be selected**: `tauri 2.11.5` → `gtk 0.18.2` → `glib ^0.18`. Both
`tauri 2.11.5` and `gtk 0.18.2` are already the newest published versions, and
the gtk3 crate is **unmaintained upstream** ("use gtk4 instead"), so `glib ^0.18`
will not move. There is no upgrade path short of Tauri migrating off gtk3.

It is also not in anything we ship: gtk/glib is the **Linux** webview backend,
and `tools/deploy-desktop.js` publishes only the Windows NSIS installer
(`WC3V_<version>_x64-setup.exe`).

Dismissed as `not_used`. `bundle.targets` has since been narrowed from
`["nsis", "deb", "appimage"]` to `["nsis"]`, so the config now declares only what
is actually released (CI is `windows-latest` and collects solely from
`bundle/nsis/`, so the Linux formats were never built anywhere).

**That narrowing is config honesty, NOT a security fix — do not read it as one.**
`bundle.targets` chooses which installer formats get packaged; it does not
change the dependency graph. Cargo still resolves Tauri's
`cfg(target_os = "linux")` dependencies into `Cargo.lock`, so glib is still
there and Dependabot will still see it. Verified after the change.

**What would make it relevant again:** publishing any Linux artifact. At that
point this code really does compile and ship, so re-open the alert and either
accept the risk explicitly or wait for Tauri to migrate off gtk3.

---

## Re-checking

```
npm audit                                   # expect: 0 vulnerabilities
node tools/verify-bundle-parity.js --replay=R
node tools/diff-wc3v.js <before>.gz <after>.gz   # after any PathFinder/scale change
gh api repos/jblanchette/wc3v/dependabot/alerts --paginate \
  -q '.[] | select(.state=="open") | "\(.security_advisory.severity)\t\(.dependency.package.name)"'
```

**If you touch `lib/linearScale.js`, the diff gate is not optional.** It is the
only thing standing between a "harmless refactor" and silently moving every unit
coordinate in every exported replay.
