/**
 * One-off: Apply Dolphin WSL S2 replay entries to builds-manifest.json
 * Fixes player names, map names, and attaches stage/round metadata.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const outputDir = path.join(__dirname, '..', 'client', 'replays');
const manifestPath = path.join(__dirname, '..', 'client', 'data', 'builds-manifest.json');

// ── Player name aliases (in-game → pro name) ───────────────
const PLAYER_ALIASES = {
  'AuroraHappy': 'Happy',
  'aurorahappy': 'Happy',
  'Medusa': 'Life',
  'medusa': 'Life',
  'orange': 'Eer0',
  'noname': 'Fortitude',
  'moosangsung': 'Sok',
  'Lianpia': 'Lyn',
  'lianpia': 'Lyn',
  'KAHO': 'Kaho',
};

function proName(name) {
  const cleaned = (name || '').replace(/#\d+$/, '');
  return PLAYER_ALIASES[cleaned] || cleaned;
}

// ── Map name cleaning ───────────────────────────────────────
function cleanMap(rawMap) {
  if (!rawMap) return '??';
  let name = rawMap.replace(/^.*[/\\]/, '');
  name = name.replace(/^\(\d+\)\s*/, '');
  // strip W3C prefixes
  name = name.replace(/^\d+_w3c_\d+_\d+_/, '');
  name = name.replace(/^1v1_/, '');
  name = name.replace(/_w3c_\d+_\d+_\d+$/, '');
  name = name.replace(/\.(w3x|w3m)$/i, '');
  // clean up version and formatting
  name = name.replace(/_/g, ' ');
  name = name.replace(/([a-z])([A-Z])/g, '$1 $2');
  // clean version formatting: "v1.6" stays, "v2.2" stays
  name = name.replace(/\s+/g, ' ').trim();
  // strip "dwsl" suffix from some maps
  name = name.replace(/\s+dwsl$/i, '');
  // strip "w3c" if it ended up at the start
  name = name.replace(/^w3c\s+/i, '');
  // strip date fragments like "250622 1057"
  name = name.replace(/\d{6}\s+\d{4}\s+/g, '');
  return name;
}

// ── Stage/round data from the prep script ───────────────────
// Reconstructed from the raw match table
const rawMatches = [
  { date: '2026-03-19', map: 'Springtime',       p1: 'LabyRinth',  p2: 'ColorFul' },
  { date: '2026-02-08', map: 'Springtime',       p1: 'Life',       p2: 'Happy' },
  { date: '2026-02-08', map: 'Echo Isles',       p1: 'Happy',      p2: 'Life' },
  { date: '2026-02-08', map: 'Shattered Exile',  p1: 'Happy',      p2: 'Life' },
  { date: '2026-02-08', map: 'Last Refuge',      p1: 'Life',       p2: 'Happy' },
  { date: '2026-02-08', map: 'Turtle Rock',      p1: 'Life',       p2: 'Happy' },
  { date: '2026-02-08', map: 'Hammerfall',        p1: 'FoCuS',      p2: 'Eer0' },
  { date: '2026-02-08', map: 'Turtle Rock',      p1: 'FoCuS',      p2: 'Eer0' },
  { date: '2026-02-08', map: 'Shattered Exile',  p1: 'Eer0',       p2: 'FoCuS' },
  { date: '2026-02-08', map: 'Tidehunters',      p1: 'Eer0',       p2: 'FoCuS' },
  { date: '2026-02-08', map: 'Autumn Leaves',    p1: 'Eer0',       p2: 'Life' },
  { date: '2026-02-08', map: 'Shattered Exile',  p1: 'Life',       p2: 'Eer0' },
  { date: '2026-02-08', map: 'Turtle Rock',      p1: 'Eer0',       p2: 'Life' },
  { date: '2026-02-08', map: 'Autumn Leaves',    p1: 'FoCuS',      p2: 'Happy' },
  { date: '2026-02-08', map: 'Springtime',       p1: 'FoCuS',      p2: 'Happy' },
  { date: '2026-02-08', map: 'Turtle Rock',      p1: 'FoCuS',      p2: 'Happy' },
  { date: '2026-02-07', map: 'Shattered Exile',  p1: 'FoCuS',      p2: 'Happy' },
  { date: '2026-02-07', map: 'Autumn Leaves',    p1: 'Fortitude',  p2: 'Life' },
  { date: '2026-02-07', map: 'Turtle Rock',      p1: 'Life',       p2: 'Fortitude' },
  { date: '2026-02-07', map: 'Springtime',       p1: 'Fortitude',  p2: 'Life' },
  { date: '2026-02-07', map: 'Tidehunters',      p1: 'Life',       p2: 'Fortitude' },
  { date: '2026-02-07', map: 'Twisted Meadows',  p1: 'Life',       p2: 'Fortitude' },
  { date: '2026-02-07', map: 'Autumn Leaves',    p1: 'FoCuS',      p2: 'Lyn' },
  { date: '2026-02-07', map: 'Twisted Meadows',  p1: 'FoCuS',      p2: 'Lyn' },
  { date: '2026-02-07', map: 'Echo Isles',       p1: 'FoCuS',      p2: 'Lyn' },
  { date: '2026-02-07', map: 'Turtle Rock',      p1: 'FoCuS',      p2: 'Lyn' },
  { date: '2026-02-07', map: 'Hammerfall',        p1: 'FoCuS',      p2: 'Lyn' },
  { date: '2026-02-07', map: 'Turtle Rock',      p1: 'Kaho',       p2: 'Happy' },
  { date: '2026-02-07', map: 'Last Refuge',      p1: 'Kaho',       p2: 'Happy' },
  { date: '2026-02-07', map: 'Echo Isles',       p1: 'Happy',      p2: 'Kaho' },
  { date: '2026-02-07', map: 'Springtime',       p1: 'Kaho',       p2: 'Happy' },
  { date: '2026-02-07', map: 'Hammerfall',        p1: 'Kaho',       p2: 'Happy' },
  { date: '2026-02-06', map: 'Last Refuge',      p1: 'LabyRinth',  p2: 'ColorFul' },
  { date: '2026-02-06', map: 'Autumn Leaves',    p1: 'Sok',        p2: 'Fortitude' },
  { date: '2026-02-05', map: 'Echo Isles',       p1: 'ColorFul',   p2: 'LabyRinth' },
  { date: '2026-02-05', map: 'Twisted Meadows',  p1: 'LabyRinth',  p2: 'ColorFul' },
  { date: '2026-02-05', map: 'Autumn Leaves',    p1: 'ColorFul',   p2: 'LabyRinth' },
  { date: '2026-02-05', map: 'Tidehunters',      p1: 'Sok',        p2: 'Fortitude' },
  { date: '2026-02-05', map: 'Twisted Meadows',  p1: 'Sok',        p2: 'Fortitude' },
  { date: '2026-02-05', map: 'Hammerfall',        p1: 'Fortitude',  p2: 'Sok' },
  { date: '2026-02-05', map: 'Tidehunters',      p1: 'FoCuS',      p2: 'LawLiet' },
  { date: '2026-02-05', map: 'Springtime',       p1: 'FoCuS',      p2: 'LawLiet' },
  { date: '2026-02-05', map: 'Autumn Leaves',    p1: 'FoCuS',      p2: 'LawLiet' },
  { date: '2026-02-05', map: 'Springtime',       p1: 'Kaho',       p2: 'Moon' },
  { date: '2026-02-05', map: 'Hammerfall',        p1: 'Kaho',       p2: 'Moon' },
  { date: '2026-02-05', map: 'Turtle Rock',      p1: 'Kaho',       p2: 'Moon' },
  { date: '2026-02-04', map: 'Autumn Leaves',    p1: 'Moon',       p2: 'Kaho' },
];

// Group into series for game numbering
function seriesKey(m) {
  return [m.p1, m.p2].sort().join('_');
}

const seriesMap = {};
for (const m of rawMatches) {
  const key = seriesKey(m);
  if (!seriesMap[key]) seriesMap[key] = [];
  seriesMap[key].push(m);
}

// Reverse to chronological, assign game numbers
for (const matches of Object.values(seriesMap)) {
  matches.reverse();
  matches.forEach((m, i) => { m.gameNum = i + 1; });
}

function inferStage(match) {
  if (match.date === '2026-03-19') return 'Grand Final';
  if (match.date <= '2026-02-06') return 'Group Stage';
  if (match.date === '2026-02-07') return 'Quarterfinals';
  const key = seriesKey(match);
  if (key === 'Happy_Life' || key === 'Life_Happy') return 'Final';
  return 'Semifinals';
}

// Build lookup: seriesKey + mapNorm → match (consuming used ones for dedup)
const allTableMatches = Object.values(seriesMap).flat();
const matchTracker = {};
for (const m of allTableMatches) {
  const mapNorm = m.map.replace(/\s*v[\d.]+\s*$/i, '').toLowerCase().replace(/[^a-z]/g, '');
  const key = `${seriesKey(m)}_${mapNorm}`;
  if (!matchTracker[key]) matchTracker[key] = [];
  matchTracker[key].push(m);
}

// Cache: replayId → table match (so both players in a game get the same match)
const replayMatchCache = {};

function findTableMatch(proP1, proP2, cleanedMap, replayId) {
  if (replayMatchCache[replayId]) return replayMatchCache[replayId];

  const mapNorm = cleanedMap.replace(/\s*v[\d.]+\s*$/i, '').toLowerCase().replace(/[^a-z]/g, '');
  const key = `${[proP1, proP2].sort().join('_')}_${mapNorm}`;
  const candidates = matchTracker[key];
  if (candidates && candidates.length) {
    const match = candidates.shift();
    replayMatchCache[replayId] = match;
    return match;
  }
  return null;
}

// ── Build matching ──────────────────────────────────────────
const { matchBuild: _matchBuild, WORKER_IDS, SUMMON_IDS: SUMMON_UNIT_IDS } = require('../helpers/buildMatcher');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
const builds = manifest.builds;

function loadParsedReplay(id) {
  const gzPath = path.join(outputDir, `${id}.wc3v.gz`);
  if (fs.existsSync(gzPath)) {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(gzPath)).toString());
  }
  return null;
}

// ── Find Dolphin WSL replay files ───────────────────────────
const knownPlayers = ['FoCuS','Happy','Life','Eer0','Kaho','Moon','Lyn','LawLiet','Sok','Fortitude','LabyRinth','ColorFul'];
const dolphinFiles = fs.readdirSync(path.join(__dirname, '..', 'replays'))
  .filter(f => f.endsWith('.w3g'))
  .filter(f => {
    const parts = path.basename(f, '.w3g').split('_');
    if (parts.length < 4) return false;
    return [parts[1], parts[2]].every(p => knownPlayers.includes(p));
  })
  .map(f => path.basename(f, '.w3g'));

// ── Process all replays ─────────────────────────────────────
const buildAdditions = {}; // buildId → array of entries to add
let skipped = 0;

for (const id of dolphinFiles) {
  const data = loadParsedReplay(id);
  if (!data) { skipped++; continue; }

  const playerEntries = Object.entries(data.players || {}).filter(([, p]) => !p.isNeutralPlayer);
  const rawMapName = data.replay.metadata.map.mapName;
  const mapName = cleanMap(rawMapName);

  for (const [pid, pdata] of playerEntries) {
    const pmeta = (data.replay && data.replay.players && data.replay.players[pid]) || {};
    const rawName = (pmeta.name || '??').replace(/#\d+$/, '');
    const playerName = proName(rawName);
    const race = pdata.race || pmeta.raceDetected || '?';

    // Hero opener
    let heroItemId = null;
    const events = pdata.eventStream || [];
    for (const ev of events) {
      if (ev.key === 'addUnit' && ev.unit && ev.unit.isHero) {
        heroItemId = ev.unit.itemId;
        break;
      }
    }

    // Match build using weighted hybrid detection
    const build = _matchBuild(race, heroItemId, events, pdata.tierStream || [], builds);
    if (!build) continue;

    // Find opponent
    const otherPlayer = playerEntries.find(([p]) => p !== pid);
    const opMeta = otherPlayer ? ((data.replay.players[otherPlayer[0]]) || {}) : {};
    const opponentName = proName((opMeta.name || '??').replace(/#\d+$/, ''));

    // Find table match for stage/round
    const tableMatch = findTableMatch(playerName, opponentName, mapName, id);

    const entry = {
      replayId: id,
      playerSlot: pid,
      playerName: playerName,
      opponentName: opponentName,
      map: mapName,
      outcome: '',
      notes: '',
      tournamentId: 'dolphin-wsl-s2',
      stage: tableMatch ? inferStage(tableMatch) : '',
      round: tableMatch ? `Game ${tableMatch.gameNum}` : ''
    };

    if (!buildAdditions[build.id]) buildAdditions[build.id] = [];
    buildAdditions[build.id].push(entry);
  }
}

// ── Apply to manifest ───────────────────────────────────────
let totalAdded = 0;
for (const build of manifest.builds) {
  const additions = buildAdditions[build.id];
  if (!additions || !additions.length) continue;

  if (!build.replays) build.replays = [];

  // Check for duplicates (same replayId + playerSlot)
  const existingKeys = new Set(build.replays.map(r => `${r.replayId}_${r.playerSlot}`));
  const newEntries = additions.filter(a => !existingKeys.has(`${a.replayId}_${a.playerSlot}`));

  build.replays.push(...newEntries);
  totalAdded += newEntries.length;
  console.log(`  ${build.id}: +${newEntries.length} replays (total: ${build.replays.length})`);
}

// Write updated manifest
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

console.log(`\nDone. Added ${totalAdded} replay entries across ${Object.keys(buildAdditions).length} builds.`);
if (skipped) console.log(`Skipped ${skipped} unparsed replays.`);
