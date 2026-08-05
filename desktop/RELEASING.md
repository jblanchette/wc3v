# Releasing WC3V Desktop

How a build gets from this repo to a user's machine, and how that machine
later updates itself.

---

## Who runs what

| | Command | Needs |
|---|---|---|
| **A user** | double-click the installer | nothing |
| **You, testing** | `npm run desktop` | Rust + Tauri CLI |
| **You, shipping** | `npm run desktop:build` | Rust + Tauri CLI + the signing key |

A user never sees Rust, cargo, node or a terminal. If a step in this document
ever leaks into their experience, that is the bug.

---

## One-time setup (developer machine)

```sh
# Rust, MSVC toolchain on Windows: https://rustup.rs
cargo install tauri-cli --version "^2.0" --locked
npm install
# Publishing only: rclone with an `r2:` remote (same one deploy-assets.js uses)
rclone config
```

On Windows, `cargo` lands in `%USERPROFILE%\.cargo\bin`. If a fresh terminal
cannot find it:

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
```

---

## Everyday development

```sh
npm run desktop
```

Assembles `desktop/dist`, stages the ladder map set into the installer
resources, and launches the app with hot-reload on the frontend. Rust changes
trigger a rebuild.

```sh
npm run desktop:test
```

Profile-aggregation assertions plus the Rust suite (watcher, overlay server,
scan).

---

## Cutting a release

### 1. Bump the version

`desktop/src-tauri/tauri.conf.json` → `"version"`. This is the single source
of truth: the installer, the binary and the update manifest all read from it.
Semver, and it must be strictly greater than the last release or clients will
not take the update.

**Bump on every build you publish, including throwaway ones.** There is no
"dev version" that can be reused: an equal version means no client is ever
offered the update, so the update path stops being exercised the moment you
stop incrementing. `0.x` already means unstable under semver, so the numbers
are cheap — spend them.

**Before anyone but you installs this, split the channel.** Every build
currently publishes to `desktop/latest.json`, which is *the* release channel.
That is harmless while you are the only install, and becomes a problem the
first time someone else has the app: a mid-work build silently becomes their
update. A `desktop/dev/latest.json` with the app's endpoint pointed at it
until 1.0 is the fix, and it is not worth building before there is a second
install.

### 2. Build

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content "$env:USERPROFILE\.tauri\wc3v-updater.key" -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npm run desktop:build
```

**Pass the key's CONTENTS, not its path.** `TAURI_SIGNING_PRIVATE_KEY_PATH`
is advertised in the CLI's own help text but was ignored by this version —
the build ran all the way to the end and then failed with "A public key has
been found, but no private key", after producing an unsigned installer. Set
`TAURI_SIGNING_PRIVATE_KEY` to the file contents as above.

Artifacts land in `desktop/src-tauri/target/release/bundle/`:

- `nsis/WC3V_<version>_x64-setup.exe` — the Windows installer users download
- `nsis/WC3V_<version>_x64-setup.exe.sig` — its signature, for the updater

Both must be present. If you only see the `.exe`, the signing variables were
not set and **that build cannot be served as an update.**

Verified: the installer is ~15 MB and carries all 144 bundled map files
(NSIS/LZMA compresses the gzipped JSON well, so the payload is much smaller
than the 50 MB staged on disk).

### 3. Publish

```sh
node tools/deploy-desktop.js --notes="What changed, in one or two plain sentences."
```

That is the whole step. The script reads the version from `tauri.conf.json`,
refuses to publish if the `.sig` is missing (an unsigned build is not servable
as an update, and nothing else in the pipeline checks), refuses a version that
is not newer than what is already published, writes `latest.json` with the
signature inlined, uploads the installer *before* the manifest — so clients are
never pointed at a URL that 404s — and then fetches both back to confirm they
are live.

Add `--dry-run` to see exactly what it would upload.

Everything lands in the Cloudflare R2 bucket that already serves maps, replays
and assets (`r2:wc3v-cdn/desktop/`, public at `https://cdn.wc3v.com/desktop/`),
which is the URL in `tauri.conf.json` under `plugins.updater.endpoints`. The
installer is deliberately **not** committed — 15 MB of binary does not belong in
an open-source git history, and this script is the only path from a local build
to users.

Requires `rclone` with an `r2:` remote configured, the same one
`tools/deploy-assets.js` uses.

### 3b. Clearing out old builds

```sh
node tools/deploy-desktop.js --prune            # keep only what latest.json points at
node tools/deploy-desktop.js --prune --keep=3   # keep the three newest
node tools/deploy-desktop.js --prune --dry-run
```

**This is safe at any time, including with real installs in the field.** An
installed 0.2.0 does not need the 0.2.0 installer in order to update — it needs
`latest.json` and the *newest* installer. Old ones matter only to somebody
deliberately installing an old version.

The live version is read from `latest.json`, not from `tauri.conf.json` (which
may already be bumped for the next build), and is never deleted. If the
manifest cannot be read, nothing is deleted at all — pruning blind is how you
remove the installer every client is being pointed at.

Local build artifacts pile up too, at roughly 15 MB each in
`desktop/src-tauri/target/release/bundle/nsis/`. That directory is gitignored
and nothing reads it after a publish; delete it whenever.

### 4. Verify before announcing

The script proves the manifest and installer are reachable. It cannot prove the
upgrade works. Install the *previous* version, launch it, and confirm it offers
the update and applies it. An update path is only real once it has been walked.

---

## How updating works for the user

The app checks the endpoint, compares versions, and only accepts a package
whose signature verifies against the public key compiled into the binary
(`plugins.updater.pubkey`). A tampered or unsigned package is refused — which
is the entire reason the private key matters.

**The private key is not in this repo and must never be.** It lives at
`~/.tauri/wc3v-updater.key` and is gitignored by pattern. Lose it and you
cannot ship updates to existing installs ever again; they would each need a
manual reinstall of a build carrying a new public key. Back it up somewhere
that is not this machine.

---

## Bundled map data

Parsing a replay needs that map's parse data. `--bundle-maps=ladder` (what
both npm scripts use) stages the competitive 1v1 pool — 48 folders, ~50 MB —
into the installer, and the app seeds its cache from there on first run. So a
fresh install parses ladder games immediately, offline.

A replay on a map outside that set reports the map as missing rather than
failing mysteriously. Fetching those on demand is ROADMAP §7 and needs a
decision about where map data is hosted; there is no download path today.

`--bundle-maps=all` exists but is 318 MB and is not a shippable installer.

---

## Platform status

Windows is the only tested target. `deb`/`appimage` are configured but have
never been built or run — see ROADMAP §8. Do not announce Linux support on
the basis that the target is listed in a config file.
