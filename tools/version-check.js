/**
 * version-check.js — One version number, four places, checked mechanically.
 *
 * `desktop/src-tauri/tauri.conf.json` is the SOURCE OF TRUTH. Tauri builds the
 * installer filename, the PE version resource and `package_info().version`
 * from it, and tools/deploy-desktop.js writes latest.json from it. Everything
 * else is a copy that has to be kept in step BY HAND, which is the whole
 * problem this file exists to remove:
 *
 *   tauri.conf.json  "version"                 <- truth
 *   Cargo.toml       version                   <- copy
 *   Cargo.lock       [[package]] wc3v-desktop  <- copy (cargo writes it)
 *   CHANGELOG.md     top `## x.y.z — D Mon YYYY` heading
 *
 * The copies have drifted for most of the project's life. Cargo.toml said
 * 0.6.0 while the config said 0.7.4, and it said 1.0.2 while 1.0.3 was already
 * live on the CDN. Nothing broke, because nothing reads the Cargo version —
 * main.rs's `app_version` deliberately goes through `package_info()` and has a
 * comment explaining why the macro would lie. So the drift is invisible right
 * up until someone trusts the manifest, and by then it is a shipped bug.
 *
 * The CHANGELOG drifts the same way and matters more: 1.0.3 shipped with a
 * heading that had no date, the only released entry missing one.
 *
 * Usage:
 *   node tools/version-check.js              - do the copies agree? (exit 1 if not)
 *   node tools/version-check.js --release    - the deploy gate; see below
 *   node tools/version-check.js --fix        - rewrite the copies from tauri.conf.json
 *   node tools/version-check.js --set=1.0.4  - bump everything, stub the changelog
 *   node tools/version-check.js --stamp-date - date today's changelog heading
 *
 * `--release` is strictly more than `--check`, because a deploy can be wrong in
 * two ways a working tree cannot:
 *
 *   - the CHANGELOG's top heading must BE the version being shipped, and must
 *     carry a date. Mid-development a dateless heading is correct, so this is
 *     not checked outside a release.
 *   - the built binary's PE version resource must match. A timestamp cannot
 *     catch editing tauri.conf.json after the Rust compile ran; this reads the
 *     version out of the actual bytes, the same way checkEmbeddedFiles in
 *     deploy-desktop.js reads the embedded pages out of them.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONF = path.join(ROOT, 'desktop/src-tauri/tauri.conf.json');
const CARGO_TOML = path.join(ROOT, 'desktop/src-tauri/Cargo.toml');
const CARGO_LOCK = path.join(ROOT, 'desktop/src-tauri/Cargo.lock');
const CHANGELOG = path.join(ROOT, 'desktop/CHANGELOG.md');
const EXE = path.join(ROOT, 'desktop/src-tauri/target/release/wc3v-desktop.exe');

const CRATE = 'wc3v-desktop';

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

function die (msg) {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

const SEMVER = /^\d+\.\d+\.\d+$/;

/* ---------------------------------------------------------------- readers */

/**
 * The Cargo manifest version, which is the FIRST `version =` in `[package]`.
 * Scoped to that table on purpose: `version = "2"` appears a dozen times under
 * [dependencies], and a naive first-match would read tauri's.
 */
function readCargoToml () {
  const src = fs.readFileSync(CARGO_TOML, 'utf8');
  const pkg = src.match(/^\[package\]([\s\S]*?)(?=^\[)/m);
  if (!pkg) die(`No [package] table in ${path.relative(ROOT, CARGO_TOML)}.`);
  const m = pkg[1].match(/^version\s*=\s*"([^"]+)"/m);
  if (!m) die(`No version in the [package] table of ${path.relative(ROOT, CARGO_TOML)}.`);
  return m[1];
}

/** The locked version of our own crate, not of any dependency. */
function readCargoLock () {
  const src = fs.readFileSync(CARGO_LOCK, 'utf8');
  const m = src.match(new RegExp(`name = "${CRATE}"\\nversion = "([^"]+)"`));
  if (!m) die(`No [[package]] entry for ${CRATE} in ${path.relative(ROOT, CARGO_LOCK)}.`);
  return m[1];
}

function readConf () {
  const v = JSON.parse(fs.readFileSync(CONF, 'utf8')).version;
  if (!v || !SEMVER.test(v)) {
    die(`tauri.conf.json has no usable "version" (got ${JSON.stringify(v)}).\n` +
        'That file is the source of truth for every other version in the tree.');
  }
  return v;
}

/**
 * The top `## ...` heading of the changelog, split into version and date.
 * Accepts either dash between them; --stamp-date writes the em dash the rest
 * of the file uses, so nobody has to type one.
 */
function readChangelogHead () {
  const src = fs.readFileSync(CHANGELOG, 'utf8');
  const m = src.match(/^## (\d+\.\d+\.\d+)(?:[^\S\r\n]*[—-][^\S\r\n]*(.+?))?[^\S\r\n]*$/m);
  if (!m) die(`No \`## x.y.z\` heading found in ${path.relative(ROOT, CHANGELOG)}.`);
  return { version: m[1], date: m[2] || null, heading: m[0] };
}

/**
 * The version out of the compiled exe's VS_FIXEDFILEINFO.
 *
 * The struct is found by its signature 0xFEEF04BD, then file version is two
 * DWORDs at +8: HIWORD/LOWORD of the first are major/minor, of the second are
 * patch/build. Every match is collected rather than just the first, so an
 * unrelated blob that happens to carry those four bytes cannot fail the check
 * on its own.
 */
function readExeVersions (exePath) {
  const buf = fs.readFileSync(exePath);
  const sig = Buffer.from([0xBD, 0x04, 0xEF, 0xFE]);
  const found = [];
  let at = buf.indexOf(sig);
  while (at !== -1) {
    if (at + 16 <= buf.length) {
      const ms = buf.readUInt32LE(at + 8);
      const ls = buf.readUInt32LE(at + 12);
      found.push(`${ms >>> 16}.${ms & 0xffff}.${ls >>> 16}`);
    }
    at = buf.indexOf(sig, at + 4);
  }
  return found;
}

/* ---------------------------------------------------------------- writers */

function writeCargoToml (version) {
  const src = fs.readFileSync(CARGO_TOML, 'utf8');
  const pkg = src.match(/^\[package\]([\s\S]*?)(?=^\[)/m);
  const patched = pkg[1].replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`);
  fs.writeFileSync(CARGO_TOML, src.replace(pkg[1], patched));
}

/**
 * Written by hand rather than by shelling out to cargo. This is byte-for-byte
 * what cargo writes for a version bump, it needs no network and no toolchain,
 * and the check above re-reads it either way.
 */
function writeCargoLock (version) {
  const src = fs.readFileSync(CARGO_LOCK, 'utf8');
  fs.writeFileSync(CARGO_LOCK, src.replace(
    new RegExp(`(name = "${CRATE}"\\nversion = ")[^"]+(")`),
    `$1${version}$2`));
}

function writeConf (version) {
  const src = fs.readFileSync(CONF, 'utf8');
  const out = src.replace(/^(\s*"version"\s*:\s*)"[^"]+"/m, `$1"${version}"`);
  if (out === src) die('Could not rewrite "version" in tauri.conf.json.');
  fs.writeFileSync(CONF, out);
}

/** `16 Aug 2026` — the format every existing changelog heading already uses. */
function houseDate (d) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/* ----------------------------------------------------------------- modes */

function collect () {
  return {
    conf: readConf(),
    cargo: readCargoToml(),
    lock: readCargoLock()
  };
}

function report (v) {
  console.log(`  tauri.conf.json  ${v.conf}   (source of truth)`);
  console.log(`  Cargo.toml       ${v.cargo}`);
  console.log(`  Cargo.lock       ${v.lock}`);
}

function check () {
  const v = collect();
  report(v);
  const bad = [];
  if (v.cargo !== v.conf) bad.push(`  Cargo.toml says ${v.cargo}, tauri.conf.json says ${v.conf}`);
  if (v.lock !== v.conf) bad.push(`  Cargo.lock says ${v.lock}, tauri.conf.json says ${v.conf}`);
  if (bad.length) {
    die('Version mismatch:\n' + bad.join('\n') + '\n\n' +
        'tauri.conf.json is the source of truth. Run:\n' +
        '  node tools/version-check.js --fix');
  }
  return v.conf;
}

function fix () {
  const v = collect();
  if (v.cargo === v.conf && v.lock === v.conf) {
    console.log(`Already in step at ${v.conf}. Nothing to do.`);
    return;
  }
  if (v.cargo !== v.conf) {
    writeCargoToml(v.conf);
    console.log(`  Cargo.toml  ${v.cargo} -> ${v.conf}`);
  }
  if (v.lock !== v.conf) {
    writeCargoLock(v.conf);
    console.log(`  Cargo.lock  ${v.lock} -> ${v.conf}`);
  }
  console.log(`\nIn step at ${v.conf}.`);
}

/** Bump the source of truth, then pull the copies up to it. */
function set (version) {
  if (!SEMVER.test(version)) die(`--set needs a bare x.y.z version, got "${version}".`);
  const from = readConf();
  writeConf(version);
  writeCargoToml(version);
  writeCargoLock(version);
  console.log(`  tauri.conf.json  ${from} -> ${version}`);
  console.log(`  Cargo.toml       -> ${version}`);
  console.log(`  Cargo.lock       -> ${version}`);

  const head = readChangelogHead();
  if (head.version !== version) {
    const src = fs.readFileSync(CHANGELOG, 'utf8');
    const at = src.indexOf(`## ${head.version}`);
    fs.writeFileSync(CHANGELOG, `${src.slice(0, at)}## ${version}\n\n\n${src.slice(at)}`);
    console.log(`  CHANGELOG.md     stubbed \`## ${version}\``);
    console.log('\nWrite the entry, then date it with --stamp-date when you ship.');
  } else {
    console.log(`\nCHANGELOG.md already has \`## ${version}\`.`);
  }
  console.log('\nRebuild before deploying: npm run desktop:build');
}

/** Put today's date on the top heading, in the format the file already uses. */
function stampDate () {
  const head = readChangelogHead();
  if (head.date) {
    console.log(`Top entry is already dated: ${head.heading}`);
    return;
  }
  const dated = `## ${head.version} — ${houseDate(new Date())}`;
  const src = fs.readFileSync(CHANGELOG, 'utf8');
  fs.writeFileSync(CHANGELOG, src.replace(head.heading, dated));
  console.log(`  ${head.heading}  ->  ${dated}`);
}

/**
 * The deploy gate. Everything `check` does, plus the two things that can only
 * be wrong at release time.
 */
function release () {
  const version = check();

  const head = readChangelogHead();
  if (head.version !== version) {
    die(`Shipping ${version} but the top CHANGELOG entry is ${head.version}.\n\n` +
        'Users read these notes in the update prompt. Either write the entry\n' +
        `for ${version}, or you are deploying a version you did not mean to.`);
  }
  if (!head.date) {
    die(`The CHANGELOG entry for ${version} has no date:\n  ${head.heading}\n\n` +
        'Every released entry carries one. Run:\n' +
        '  node tools/version-check.js --stamp-date');
  }
  console.log(`  CHANGELOG.md     ${head.version} — ${head.date}`);

  if (!fs.existsSync(EXE)) {
    die(`No release binary at:\n  ${path.relative(ROOT, EXE)}\n\n` +
        'Run `npm run desktop:build` first.');
  }
  const inExe = readExeVersions(EXE);
  if (!inExe.length) {
    die(`Found no VS_FIXEDFILEINFO in ${path.relative(ROOT, EXE)}, so the version\n` +
        'it was compiled with cannot be read. That resource is generated by\n' +
        'tauri-build; if it is genuinely gone, this check needs rewriting.');
  }
  if (!inExe.includes(version)) {
    die(`The built binary is version ${inExe.join(', ')}, not ${version}.\n\n` +
        'tauri.conf.json was edited after the Rust compile ran, so the installer\n' +
        `about to be published as ${version} reports ${inExe[0]} to the updater and\n` +
        'in the UI. Run `npm run desktop:build` again.');
  }
  console.log(`  binary           ${version}   (PE version resource)`);
  console.log(`\n${version} is consistent everywhere.`);
}

/* ------------------------------------------------------------------ main */

if (args.fix) fix();
else if (typeof args.set === 'string') set(args.set);
else if (args['stamp-date']) stampDate();
else if (args.release) release();
else { check(); console.log('\nIn step.'); }
