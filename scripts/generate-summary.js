/**
 * generate-summary.js — Extract compact summary data from .wc3v.gz replay files.
 *
 * Usage:
 *   node scripts/generate-summary.js --replay=happy-vs-grubby
 *   node scripts/generate-summary.js --all   (processes all named replays)
 *
 * Output: client/data/summaries/{replayId}.json
 *
 * The per-player extraction logic lives in helpers/summaryExtract.js so the
 * browser side (CompareInline.js) can build the same shape from an uploaded
 * replay at runtime. Adding fields there surfaces them in both pipelines.
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// Shared with the browser: client/js/SummaryExtract.js is loaded via a
// <script> tag and exposes the same API on window.SummaryExtract. Node
// requires the canonical copy directly here so changes flow to both.
const {
  extractPlayerSummary, extractNeutralCamps,
  resolveMapFolder, slimMapInfo, formatMs
} = require('../client/js/SummaryExtract');
const { mapDataByFile } = require('../helpers/mappings');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

function parseMapDisplay(rawPath) {
  let name = rawPath.replace(/\\/g, '/').split('/').pop()
    .replace(/\.(w3x|w3m)$/i, '');
  name = name.replace(/^\(\d+\)\s*/, '');   // strip "(2) " prefix
  name = name.replace(/^w3c_/, '');          // strip "w3c_" prefix
  name = name.replace(/_v[\d.-]+$/, '');     // strip "_v2-0" suffix
  name = name.replace(/[_]/g, ' ');
  name = name.replace(/([a-z])([A-Z])/g, '$1 $2'); // camelCase → spaces
  name = name.replace(/\s+/g, ' ').trim();
  return name;
}

function loadReplay(replayId) {
  const basePath = path.join(__dirname, '..', 'client', 'replays', replayId);
  if (fs.existsSync(`${basePath}.wc3v`)) {
    return JSON.parse(fs.readFileSync(`${basePath}.wc3v`, 'utf8'));
  } else if (fs.existsSync(`${basePath}.wc3v.gz`)) {
    const gz = fs.readFileSync(`${basePath}.wc3v.gz`);
    return JSON.parse(zlib.gunzipSync(gz).toString());
  }
  return null;
}

function generateSummary(replayId) {
  const data = loadReplay(replayId);
  if (!data) {
    console.error(`ERROR: Could not load replay "${replayId}"`);
    return null;
  }

  const { replay, players, world } = data;
  const durationMs   = replay.subheader.replayLengthMS;
  const replayPlayers = replay.players || {};
  const worldNeutralGroups = (world && world.neutralGroups) || null;
  const rawMapName = replay.metadata.map.mapName;
  const mapInfo = slimMapInfo(resolveMapFolder(rawMapName, mapDataByFile));

  const summary = {
    replayId,
    map:               parseMapDisplay(rawMapName),
    mapRaw:            rawMapName,
    mapInfo,
    durationMs,
    durationFormatted: formatMs(durationMs),
    neutralCamps:      extractNeutralCamps(worldNeutralGroups),
    players:           {}
  };

  for (const playerId of Object.keys(players)) {
    const pd  = players[playerId];
    const rpd = replayPlayers[playerId];
    if (!rpd) continue;
    if (pd.isNeutralPlayer) continue;
    if (rpd.teamId >= 1000) continue; // skip AI/neutral teams
    summary.players[playerId] = extractPlayerSummary(pd, rpd, durationMs, worldNeutralGroups);
  }

  return summary;
}

// Browser-loadable manifest: a slim copy of mapDataByFile so the
// CompareInline modal can run the same `resolveMapFolder` logic at runtime
// for user-uploaded replays. Written as a side effect of `--all`.
function writeMapFoldersManifest() {
  const slim = {};
  for (const key of Object.keys(mapDataByFile)) {
    slim[key] = slimMapInfo(mapDataByFile[key]);
  }
  const outPath = path.join(__dirname, '..', 'client', 'data', 'map-folders.json');
  fs.writeFileSync(outPath, JSON.stringify(slim, null, 2));
  console.log(`Manifest: ${outPath} (${Object.keys(slim).length} maps)`);
}

function writeSummary(replayId) {
  const summary = generateSummary(replayId);
  if (!summary) return;

  const outDir  = path.join(__dirname, '..', 'client', 'data', 'summaries');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.join(outDir, `${replayId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`Written: ${outPath}`);
  const displayPlayers = Object.values(summary.players)
    .map(p => `${p.name}(${p.race})`).join(' vs ');
  console.log(`  ${displayPlayers} — ${summary.map} — ${summary.durationFormatted}`);
}

// ── Entry point ──────────────────────────────────────────────────────────────

if (args.all) {
  const replaysDir = path.join(__dirname, '..', 'client', 'replays');
  const files = fs.readdirSync(replaysDir)
    .filter(f => f.endsWith('.wc3v.gz'))
    .map(f => f.replace('.wc3v.gz', ''))
    .filter(id => !/^[a-f0-9]{32}$/.test(id)); // skip hash-named files
  console.log(`Processing ${files.length} named replays...\n`);
  let ok = 0, fail = 0;
  for (const replayId of files) {
    try { writeSummary(replayId); ok++; }
    catch (err) { console.error(`FAILED ${replayId}: ${err.message}`); fail++; }
  }
  writeMapFoldersManifest();
  console.log(`\nDone. ${ok} written, ${fail} failed.`);
} else if (args.replay) {
  writeSummary(args.replay);
} else {
  console.log('Usage: node scripts/generate-summary.js --replay=NAME');
  console.log('       node scripts/generate-summary.js --all');
  process.exit(1);
}
