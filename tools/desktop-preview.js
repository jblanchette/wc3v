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
 *
 * --stale=N degrades the first N games so the schema-upgrade paths render. See
 * the comment at the call site: they alternate between "stored before v4" and
 * "stored under v4 but the dominance gate refused it", which need different
 * words and only one of which is fixable by re-reading.
 *
 * --w3c tags every name and fakes a live W3Champions match, which is the only
 * way to see the scout card without queuing for a real game.
 *
 * Then open desktop/preview/preview.html in a browser.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SummaryExtract = require('../client/js/SummaryExtract');
const MomentsExtract = require('../client/js/MomentsExtract');
const SeriesExtract = require('../client/js/SeriesExtract');

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

// Mirror of desktop/src-frontend/js/store.js buildSummary. Duplicated rather
// than shared because that one is a browser module that reads window globals;
// keeping this tool free of a DOM shim is worth twenty lines.
const buildSummary = (out, key, playedAt) => {
  const rawMap = (out.replay && out.replay.metadata && out.replay.metadata.map &&
    out.replay.metadata.map.mapName) || '';
  const durationMs = (out.replay && out.replay.subheader &&
    out.replay.subheader.replayLengthMS) || 0;
  const worldNeutralGroups = (out.world && out.world.neutralGroups) || null;
  const summary = {
    key,
    schemaVersion: 4,
    savedAt: Date.now(),
    playedAt,
    patchVersion: (out.replay && out.replay.subheader && out.replay.subheader.version) || null,
    map: rawMap.split(/[\\/]/).pop(),
    mapRaw: rawMap,
    gameMode: out.gameMode || null,
    winner: out.winner || null,
    durationMs,
    neutralCamps: SummaryExtract.extractNeutralCamps(worldNeutralGroups),
    moments: MomentsExtract.extractMoments(out),
    // Schema v4. Only replays re-parsed since the dominance engine landed
    // carry a series, so a chunk of client/replays yields null here and
    // exercises the desktop's "no dominance for this game" path for free.
    dominance: SeriesExtract.extractDominance(out),
    resources: SeriesExtract.extractResources(out),
    players: {}
  };
  const combat = MomentsExtract.extractCombat(out);
  for (const slot of Object.keys(out.players || {})) {
    const pd = out.players[slot];
    const rpd = out.replay && out.replay.players && out.replay.players[slot];
    if (!pd || !rpd || pd.isNeutralPlayer) continue;
    if (rpd.teamId >= 1000) continue;
    summary.players[slot] = SummaryExtract.extractPlayerSummary(pd, rpd, durationMs, worldNeutralGroups);
    summary.players[slot].teamId = rpd.teamId;
    summary.players[slot].combat = combat[slot] || null;
  }
  return summary;
};

const wanted = parseInt(args.games, 10) || 12;
// --match=<substring> pins the sample to particular replays. The corpus is
// overwhelmingly 1v1 and sorted so the numeric ladder filenames come first, so
// without this the team games and the custom-mode replays are unreachable
// without asking for hundreds of games. `--match=gso` is a 3v3.
const matcher = typeof args.match === 'string' ? args.match.toLowerCase() : null;
const files = fs.readdirSync(REPLAY_DIR)
  .filter(f => f.endsWith('.wc3v.gz'))
  .filter(f => !matcher || f.toLowerCase().includes(matcher))
  .slice(0, wanted);
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
  teams: [
    { players: [{ battleTag: me, race: W3C_RACE[raceByName.get(me)] ?? 1, oldMmr: 1804 }] },
    { players: [{ battleTag: foe[0], race: W3C_RACE[raceByName.get(foe[0])] ?? 2, oldMmr: 1877 }] }
  ]
} : null;

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>WC3V — preview</title></head>
<body>
<script>
// ── Tauri IPC stub ─────────────────────────────────────────────────────────
// Generated by tools/desktop-preview.js. Everything the app reads is answered
// from summaries built out of real parsed replays.
const STORE = ${JSON.stringify(store)};
const ONGOING = ${JSON.stringify(ongoing)};
const b64 = (s) => { const bin = atob(s); const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };

// Tells app.js to publish its views on window.__WC3V_VIEWS__. The preview
// cannot run a real parse (there are no .w3g files behind these summaries), so
// anything driven BY a parse — the first-boot catch-up chips — has to be driven
// by hand from the console or an automated check.
window.__WC3V_PREVIEW__ = true;

window.__TAURI__ = {
  core: {
    invoke: async (cmd, args) => {
      switch (cmd) {
        case 'init': return { roots: [
          { path: 'X', replay_count: 3128 }, { path: 'Y', replay_count: 999 }
        ], map_cache_dir: 'X' };
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
const previewFile = path.join(PREVIEW_DIR, 'preview.html');
fs.writeFileSync(previewFile, html);
// Left behind by every run before this one, when the preview lived in dist.
fs.rmSync(path.join(DIST, 'preview.html'), { force: true });
console.log('');
console.log(`preview:   ${path.relative(ROOT, previewFile)}`);
console.log(`games:     ${Object.keys(store).length}`);
console.log(`you:       ${me}`);
if (ongoing) console.log(`scout:     live match vs ${foe[0]}`);
