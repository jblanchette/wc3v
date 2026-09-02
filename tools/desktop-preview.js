/**
 * desktop-preview.js — render the desktop UI in an ordinary browser.
 *
 * The desktop frontend needs Tauri for everything it reads, so looking at it
 * used to mean building and launching the app. This writes a `preview.html`
 * that stubs the Tauri IPC with summaries built from real parsed replays in
 * client/replays, so the feed, the game detail, the moments list and the
 * profile all render against real data.
 *
 * The stub answers `read_parse` with genuinely gzipped bytes, so the app's own
 * store.js runs unmodified: gunzip, schema check, corpus sort. You are looking
 * at the real code path.
 *
 * Usage:
 *   node tools/build-desktop-client.js && node tools/desktop-preview.js
 *   node tools/desktop-preview.js --games=8 --me="SooooK#31962"
 *   node tools/desktop-preview.js --games=40 --w3c
 *   node tools/desktop-preview.js --games=40 --stale=4
 *   node tools/desktop-preview.js --mix=audit --out=preview-mix.html
 *   node tools/desktop-preview.js --setup
 *
 * --mix=sub[:count],sub[:count],... builds the page from BUCKETS instead of
 * the first N files: each substring picks `count` matching replays (default
 * 1), concatenated in the order written. This is how one page gets a 3v3, a
 * 4v4, a busy 1v1 and a sparse fixture at once — a single --match can only
 * narrow, never mix. `--mix=audit` is the standing audit corpus; the preset
 * lives below and in desktop/README.md.
 *
 * --out=NAME writes desktop/preview/NAME instead of preview.html, so several
 * pages (the audit matrix) can coexist. Basename only — a subdirectory would
 * break the ../dist rebase.
 *
 * --stale=N degrades the first N games so the schema-upgrade paths render. See
 * the comment at the call site: they alternate between "stored before v4" and
 * "stored under v4 but the dominance gate refused it", which need different
 * words and only one of which is fixable by re-reading.
 *
 * --w3c tags every name and fakes a live W3Champions match, which is the only
 * way to see the scout card without queuing for a real game.
 *
 * --setup shows the first-run screen, which otherwise only appears on a machine
 * that has never run the app.
 *
 * Then open desktop/preview/preview.html in a browser.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SummaryExtract = require('../client/js/SummaryExtract');
const MomentsExtract = require('../client/js/MomentsExtract');
const SeriesExtract = require('../client/js/SeriesExtract');
const SummaryBuild = require('../client/js/SummaryBuild');
// The map bounds table SummaryBuild stamps `mapInfo` from. The browser gets it
// from a <script>-time fetch; here it is a require, so preview summaries carry
// the same field a real parse would and the creep-route map draws on real
// terrain instead of its self-scaled fallback.
globalThis.__mapFoldersManifest = require('../client/data/map-folders.json');

const ROOT = path.resolve(__dirname, '..');
const REPLAY_DIR = path.join(ROOT, 'client', 'replays');
const DIST = path.join(ROOT, 'desktop', 'dist');

// Written BESIDE dist, never into it. tauri.conf.json bundles the whole of
// `frontendDist`, so a preview page living in dist is a 150 KB page of fake
// games one stray `cargo tauri build` away from shipping to users.
const PREVIEW_DIR = path.join(ROOT, 'desktop', 'preview');

// The preview loads the real app's own files out of dist, so every `./` in the
// markup it borrows has to become a path relative to PREVIEW_DIR.
const rebase = (s) => s.replace(/(src|href)="\.\//g, '$1="../dist/');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

if (!fs.existsSync(DIST)) {
  console.error('desktop/dist does not exist. Run: node tools/build-desktop-client.js');
  process.exit(1);
}

// The summary shape is SummaryBuild's, the same module the app calls. This tool
// carried a hand-copied duplicate of it, which meant the harness could build a
// summary the app would never write. Only replays re-parsed since the dominance
// engine landed carry a series, so a chunk of client/replays yields null there
// and exercises the "no dominance for this game" path for free.
const buildSummary = SummaryBuild.buildSummary;

const wanted = parseInt(args.games, 10) || 12;
// --match=<substring> pins the sample to particular replays. The corpus is
// overwhelmingly 1v1 and sorted so the numeric ladder filenames come first, so
// without this the team games and the custom-mode replays are unreachable
// without asking for hundreds of games. `--match=gso` is a 3v3.
const matcher = typeof args.match === 'string' ? args.match.toLowerCase() : null;

// The standing audit corpus: every data shape the report has to survive, on
// one page. gso is the only rich team game in the corpus (6 seats with
// dominance/resources/APM/build); test-4v4 is 8 seats with none of that;
// the two ladder buckets carry the personal-1v1 paths; the two fixtures are
// genuinely thin (short, sparse moments). Frozen in desktop/README.md — a
// layout change is audited against THIS page, not against whatever twelve
// games the directory happens to start with.
const MIX_PRESETS = {
  audit: 'gso:1,test-4v4:1,happy-vs-grubby:1,Springtime13:2,EchoIsles22:1,hide-test:1,sellback-test:1'
};

const allFiles = fs.readdirSync(REPLAY_DIR).filter(f => f.endsWith('.wc3v.gz'));

let files;
if (typeof args.mix === 'string') {
  // Buckets, not a filter: each `sub[:count]` takes the first `count` matches
  // not already picked, in the order written, so the feed order is the bucket
  // order. --match and --games make no sense alongside it.
  if (matcher) {
    console.error('--mix and --match are exclusive: mix IS a list of matches.');
    process.exit(1);
  }
  const spec = MIX_PRESETS[args.mix] || args.mix;
  files = [];
  for (const bucket of spec.split(',')) {
    const [sub, countRaw] = bucket.trim().split(':');
    const count = parseInt(countRaw, 10) || 1;
    const hits = allFiles.filter(f =>
      f.toLowerCase().includes(sub.toLowerCase()) && !files.includes(f))
      .slice(0, count);
    // An empty bucket is how an audit page silently loses its 3v3. Loud.
    if (hits.length < count) {
      console.warn(`  mix bucket "${bucket.trim()}": wanted ${count}, found ${hits.length}`);
    }
    files.push(...hits);
  }
} else {
  files = allFiles
    .filter(f => !matcher || f.toLowerCase().includes(matcher))
    .slice(0, wanted);
}
if (!files.length) {
  console.error(`No parsed replays in ${path.relative(ROOT, REPLAY_DIR)}`);
  process.exit(1);
}

const store = {};   // key -> base64 gzipped summary JSON
const nameCounts = new Map();
const raceByName = new Map();
let day = Date.now();

// --w3c gives every player a ladder-style battle tag, because the scout card
// has nothing to ask the ladder about without one. Most of the sample already
// carries a tag, so this only fills in the ones that do not.
const tagged = (name) => {
  if (/#\d+$/.test(name)) return name;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 9000;
  return `${name}#${1000 + h}`;
};

const staleCount = parseInt(args.stale, 10) || 0;
let staled = 0;

for (const file of files) {
  let out;
  try {
    out = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(REPLAY_DIR, file))).toString());
  } catch (e) {
    console.log(`  skipped ${file}: ${e.message}`);
    continue;
  }
  // Spread the fake play times over recent days so the feed's day grouping,
  // "Today"/"Yesterday" headers and newest-first ordering all get exercised.
  day -= Math.round((2 + Math.random() * 20) * 3600 * 1000);
  const size = fs.statSync(path.join(REPLAY_DIR, file)).size;
  const key = `${size}-${Buffer.from(file).toString('hex').slice(0, 16)}`;
  const summary = buildSummary(out, key, day);
  if (args.w3c) {
    for (const p of Object.values(summary.players)) p.name = tagged(p.name);
  }

  // --stale=N degrades the first N games so the schema-upgrade paths are
  // reachable without an old store. This matters more than it looks: after a
  // v4 build lands, EVERY game already on a user's disk is in one of these
  // states, and they are the first thing that person sees.
  //
  // Two states, two different answers, and confusing them is the bug:
  //   pre-v4 (odd index) — the block never existed. Re-reading fixes it, so
  //                        the panel offers the button.
  //   gate refused (even) — stored under v4 with a null block, because
  //                        DominanceSeries declined the replay. Re-reading it
  //                        declines again, so it gets a statement and NO
  //                        button.
  if (staleCount > 0 && staled < staleCount) {
    if (staled % 2 === 0) {
      summary.dominance = null;
      summary.resources = null;
    } else {
      summary.schemaVersion = 3;
      delete summary.dominance;
      delete summary.resources;
      // A real pre-v5 summary has no build block either — and that absence
      // is what makes the report drop its tabs. Leaving it in rendered the
      // full summary under a v3 stamp, so the no-tab path was unreachable
      // from this harness.
      for (const p of Object.values(summary.players)) delete p.build;
    }
    staled++;
  }

  store[key] = zlib.gzipSync(JSON.stringify(summary)).toString('base64');
  for (const p of Object.values(summary.players)) {
    nameCounts.set(p.name, (nameCounts.get(p.name) || 0) + 1);
    if (p.race) raceByName.set(p.name, p.race);
  }
  console.log(`  ${file} → ${(store[key].length / 1024).toFixed(1)} KB, ` +
    `${summary.moments.length} moments`);
}

// Whoever appears most often stands in for "you" — the same signal the real
// identity detection uses, which is what makes the verdicts orient correctly.
const me = (typeof args.me === 'string' && args.me) ||
  [...nameCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

// A stand-in live match for the scout card, built from a real opponent in the
// sample so the local book beside it has something to say. Off unless --w3c.
const W3C_RACE = { R: 0, H: 1, O: 2, E: 4, U: 8 };
const foe = [...nameCounts.entries()]
  .filter(([n]) => n !== me)
  .sort((a, b) => b[1] - a[1])[0];

const ongoing = (args.w3c && foe) ? {
  id: 'preview-ongoing',
  gameMode: 1,
  mapName: 'Echo Isles',
  // Nine minutes ago, so the overlay's live clock is exercised. Without a
  // startTime the card degrades to no clock, which is the correct behaviour
  // and also hides the whole feature from anyone looking at the preview.
  //
  // Stamped when the page is WRITTEN, not when it is opened, so a preview left
  // open overnight reads as a very long game. That is the honest cost of a
  // static harness and it is what --w3c is for.
  startTime: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
  teams: [
    { players: [{ battleTag: me, race: W3C_RACE[raceByName.get(me)] ?? 1, oldMmr: 1804 }] },
    { players: [{ battleTag: foe[0], race: W3C_RACE[raceByName.get(foe[0])] ?? 2, oldMmr: 1877 }] }
  ]
} : null;

// Two seeded tags, so the Library's filter and the casting badge have
// something real to match without anybody typing first.
const previewTags = {};
{
  const keys = Object.keys(store);
  if (keys[0]) previewTags[keys[0]] = ['grand final'];
  if (keys[2]) previewTags[keys[2]] = ['random hero', 'showmatch'];
}

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>WC3V — preview</title></head>
<body>
<script>
// ── Tauri IPC stub ─────────────────────────────────────────────────────────
// Generated by tools/desktop-preview.js. Everything the app reads is answered
// from summaries built out of real parsed replays.
const STORE = ${JSON.stringify(store)};
const ONGOING = ${JSON.stringify(ongoing)};
const PREVIEW_TAGS = ${JSON.stringify(previewTags)};
const b64 = (s) => { const bin = atob(s); const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };

// Tells app.js to publish its views on window.__WC3V_VIEWS__. The preview
// cannot run a real parse (there are no .w3g files behind these summaries), so
// anything driven BY a parse — the first-boot catch-up chips — has to be driven
// by hand from the console or an automated check.
window.__WC3V_PREVIEW__ = true;

// The tag sidecar, in memory. Seeded with a couple so the Library filter and
// the casting badge have something to match on a fresh preview.
var TAGS = PREVIEW_TAGS;
var SHOW_SETUP = ${JSON.stringify(!!args.setup)};

// The replay folder tree (js/folders.js). Two roots, the game's own two
// Autosaved folders, and the kind of folders people make by hand. Paths are
// fake and never rendered; labels are.
var FOLDERS = [
  { path: 'X', root: 'X', depth: 0, name: 'Replays', label: 'Replays', custom_label: false,
    enabled: true, direct_count: 14, total_count: 3128, manual: false },
  { path: 'X/Autosaved/Custom', root: 'X', depth: 2, name: 'Custom', label: 'Custom', custom_label: false,
    enabled: false, direct_count: 412, total_count: 412, manual: false },
  { path: 'X/Autosaved/Multiplayer', root: 'X', depth: 2, name: 'Multiplayer', label: 'Multiplayer', custom_label: false,
    enabled: true, direct_count: 2611, total_count: 2611, manual: false },
  { path: 'X/Ladder practice', root: 'X', depth: 1, name: 'Ladder practice', label: 'Ladder practice', custom_label: false,
    enabled: true, direct_count: 58, total_count: 58, manual: false },
  { path: 'X/vs Happy', root: 'X', depth: 1, name: 'vs Happy', label: 'Study: Happy', custom_label: true,
    enabled: true, direct_count: 33, total_count: 33, manual: false },
  { path: 'Y', root: 'Y', depth: 0, name: 'Replays', label: 'Replays 2', custom_label: false,
    enabled: true, direct_count: 0, total_count: 999, manual: false },
  { path: 'Y/Autosaved/Multiplayer', root: 'Y', depth: 2, name: 'Multiplayer', label: 'Multiplayer', custom_label: false,
    enabled: true, direct_count: 999, total_count: 999, manual: false },
  { path: 'Z', root: 'Z', depth: 0, name: 'Downloads', label: 'Downloads', custom_label: false,
    enabled: true, direct_count: 7, total_count: 7, manual: true }
];

window.__TAURI__ = {
  core: {
    invoke: async (cmd, args) => {
      switch (cmd) {
        case 'init': return { roots: [
          { path: 'X', replay_count: 3128 }, { path: 'Y', replay_count: 999 }
        ], map_cache_dir: 'X' };
        // The folder tree, as the real app would find it on a machine with
        // two accounts and a couple of hand-made folders. Held in memory so
        // rename / switch off / remove all work on the page; nothing persists.
        case 'list_folders': return FOLDERS.filter(f => !f.removed).map(f => ({ ...f }));
        case 'set_folder_label': {
          const f = FOLDERS.find(x => x.path === args.path);
          if (f) {
            const label = String(args.label || '').trim();
            f.custom_label = !!label;
            f.label = label || f.name;
          }
          return FOLDERS.filter(x => !x.removed).map(x => ({ ...x }));
        }
        case 'set_folder_enabled': {
          const f = FOLDERS.find(x => x.path === args.path);
          if (f) f.enabled = !!args.enabled;
          return FOLDERS.filter(x => !x.removed).map(x => ({ ...x }));
        }
        case 'remove_folder': {
          const f = FOLDERS.find(x => x.path === args.path);
          if (f) f.removed = true;
          return FOLDERS.filter(x => !x.removed).map(x => ({ ...x }));
        }
        case 'restore_folders':
          for (const f of FOLDERS) f.removed = false;
          return FOLDERS.filter(x => !x.removed).map(x => ({ ...x }));
        case 'add_root':
          throw 'adding a folder needs the real app (this is the UI preview)';
        // Every stored game is placed in a folder, round-robin over the ones
        // that hold replays, so the folder filter and the report chip have
        // something to show.
        case 'game_sources':
        case 'resolve_sources': {
          const dirs = {};
          const holders = FOLDERS.filter(f => f.direct_count > 0);
          Object.keys(STORE).forEach((k, i) => { dirs[k] = holders[i % holders.length].path; });
          return dirs;
        }
        case 'record_sources': return (args.entries || []).length;
        case 'list_parses': return Object.keys(STORE);
        case 'list_parse_failures': return [];
        case 'read_parse': return b64(STORE[args.key]);
        case 'scan_replays': return { replays: [], stats: { files_seen: 4875, walk_ms: 180 } };
        // One stand-in file per stored game, sized to match its content key, so
        // replay-index.js resolves key → path exactly as it does for real. Any
        // stub that returned [] would make every Watch / Open-in-viewer click
        // dead-end at "file not found", which is not what those buttons do.
        case 'scan_all': return { replays: Object.keys(STORE).map((k, i) => ({
          path: 'PREVIEW-' + i, file_name: 'Replay_' + i + '.w3g',
          size: Number(k.split('-')[0]), modified_ms: 0, key: k,
          interesting: true, autosaved: true
        })) };
        case 'replay_key': {
          const i = Number(String(args.path).replace('PREVIEW-', ''));
          return { key: Object.keys(STORE)[i], modifiedMs: 0 };
        }
        // Deliberately refuses, with the reason. The real command hands the
        // replay to the browser, which a stubbed page cannot do — saying so is
        // more useful than pretending it worked.
        case 'open_in_viewer':
          throw 'the viewer handoff needs the real app (this is the UI preview)';
        // Tags live in a real file in the real app. In here they live for as
        // long as the page does, which is enough to drive the Library filter,
        // the report's tag strip and the casting badge.
        case 'read_tags': return JSON.stringify(TAGS);
        case 'write_tags': TAGS = JSON.parse(args.json); return null;
        // The first-run screen. Off by default here, because the preview is for
        // looking at the app rather than at its setup; --setup turns it on.
        // The preview is the frontend only, so it says so rather than naming a
        // build number it is not running.
        case 'app_version': return 'preview';
        case 'setup_done': return !SHOW_SETUP;
        case 'mark_setup_done': SHOW_SETUP = false; return null;
        case 'start_watching': return 2;
        case 'get_autostart': return false;
        case 'publish_overlay_state': return null;
        case 'overlay_info': return { url: 'http://127.0.0.1:0/overlay?token=preview' };
        case 'check_for_update': return { status: 'unconfigured' };
        // W3Champions lookups are off unless the preview was built with
        // --w3c. Off is the real default, and a preview that answered these
        // by default would make an opt-in feature look like it ships on.
        case 'w3c_enabled': return ONGOING !== null;
        case 'set_w3c_enabled': return !!(args && args.enabled);
        case 'w3c_lookup': {
          if (!ONGOING) throw 'online lookups are off';
          const p = String(args.path);
          if (p.indexOf('/api/matches/ongoing/') === 0) return JSON.stringify(ONGOING);
          if (p.indexOf('/game-mode-stats') !== -1) {
            return JSON.stringify([{ gameMode: 1, race: 0, games: 412, wins: 231,
              losses: 181, mmr: 1877, rank: 138, quantile: 0.93 }]);
          }
          throw 'not found on W3Champions';
        }
        default: throw new Error('preview stub: no ' + cmd);
      }
    }
  },
  event: { listen: async () => (() => {}) },
  dialog: { open: async () => null },
  // The app drives its own title bar (decorations are off), so it asks for the
  // window on load. A browser tab has no window to minimise — the controls are
  // rendered so the chrome can be judged, and say so when clicked.
  window: {
    getCurrentWindow: () => ({
      isVisible: async () => !document.hidden,
      minimize: async () => console.log('preview: minimize (no window here)'),
      toggleMaximize: async () => console.log('preview: maximize (no window here)'),
      close: async () => console.log('preview: close-to-tray (no window here)')
    })
  }
};
// The app asks identity for a confirmed name; pre-answer it so the preview
// opens with verdicts already oriented instead of the picker.
localStorage.setItem('wc3v-user-name', ${JSON.stringify(me)});
localStorage.setItem('wc3v-user-name-confirmed', '1');
</script>
${rebase(fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')
  .replace(/^[\s\S]*?<body>/, '')
  .replace(/<\/body>[\s\S]*$/, ''))}
${
  // The preview page owns <head>, so the real page's stylesheet links are
  // re-emitted into the body (browsers accept this). Carried through by
  // reading them rather than listing them here — hardcoding the list is how
  // the preview ended up missing overlay.css and silently rendering the
  // Stream screen unstyled.
  rebase((fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')
    .match(/<link rel="stylesheet"[^>]*>/g) || []).join('\n'))
}
</body></html>
`;

fs.mkdirSync(PREVIEW_DIR, { recursive: true });
// basename() is the subdirectory guard: the ../dist rebase only holds for a
// file directly inside PREVIEW_DIR.
const previewFile = path.join(PREVIEW_DIR,
  path.basename(typeof args.out === 'string' ? args.out : 'preview.html'));
fs.writeFileSync(previewFile, html);
// Left behind by every run before this one, when the preview lived in dist.
fs.rmSync(path.join(DIST, 'preview.html'), { force: true });
console.log('');
console.log(`preview:   ${path.relative(ROOT, previewFile)}`);
console.log(`games:     ${Object.keys(store).length}`);
console.log(`you:       ${me}`);
if (ongoing) console.log(`scout:     live match vs ${foe[0]}`);
