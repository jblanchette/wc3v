/**
 * One-off: analyze all Dolphin WSL S2 parsed replays, match to builds,
 * and output ready-to-paste manifest entries.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const outputDir = path.join(__dirname, '..', 'client', 'replays');
const manifestPath = path.join(__dirname, '..', 'client', 'data', 'builds-manifest.json');
const importMetaPath = path.join(__dirname, '..', 'replays', 'import', 'import.json');

const SUMMON_UNIT_IDS = {
  'uske': true, 'hwat': true, 'hwt2': true, 'hwt3': true,
  'efon': true, 'osw1': true, 'osw2': true, 'osw3': true, 'ucs1': true
};
const WORKER_IDS = { 'opeo': true, 'hpea': true, 'ewsp': true, 'uaco': true, 'ugho': true };

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
const builds = manifest.builds;

// Load import.json for tournament metadata (may have been cleaned up)
let importMeta = { tournament: null, replays: {} };
// Try reading from the backup we know about
const tournamentId = 'dolphin-wsl-s2';

// Find all Dolphin WSL replay files
const dolphinFiles = fs.readdirSync(path.join(__dirname, '..', 'replays'))
  .filter(f => f.endsWith('.w3g'))
  .filter(f => {
    const parts = path.basename(f, '.w3g').split('_');
    if (parts.length < 4) return false;
    const players = [parts[1], parts[2]];
    const knownPlayers = ['FoCuS','Happy','Life','Eer0','Kaho','Moon','Lyn','LawLiet','Sok','Fortitude','LabyRinth','ColorFul'];
    return players.every(p => knownPlayers.includes(p));
  })
  .map(f => path.basename(f, '.w3g'));

// Read the import.json that was generated (it might still exist as part of tournaments.json)
// Actually let's reconstruct from the prep script's data
const stageMap = {};
try {
  // Try to load the original import.json if it still exists
  const raw = fs.readFileSync(path.join(__dirname, '..', 'replays', 'import', 'import.json'), 'utf-8');
  const data = JSON.parse(raw);
  for (const [filename, meta] of Object.entries(data.replays || {})) {
    const id = path.basename(filename, '.w3g');
    stageMap[id] = meta;
  }
} catch (e) {
  // import.json was cleaned up, we'll work without stage data
}

function loadParsedReplay(id) {
  const gzPath = path.join(outputDir, `${id}.wc3v.gz`);
  if (fs.existsSync(gzPath)) {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(gzPath)).toString());
  }
  return null;
}

function cleanMapName(rawMap) {
  if (!rawMap) return '??';
  let name = rawMap.replace(/^.*[/\\]/, '');
  name = name.replace(/^\(\d+\)\s*/, '');
  name = name.replace(/^\d+_w3c_\d+_\d+_/, '');
  name = name.replace(/\.(w3x|w3m)$/i, '');
  name = name.replace(/_v[\d.-]+$/, '');
  name = name.replace(/([a-z])([A-Z])/g, '$1 $2');
  name = name.replace(/[_]/g, ' ').replace(/\s+/g, ' ').trim();
  return name || rawMap;
}

function matchBuild(race, heroItemId, unitIds) {
  const candidates = builds.filter(b => b.race === race);
  let bestMatch = null;
  let bestScore = 0;

  for (const build of candidates) {
    let score = 0;
    const buildHero = build.heroItemIds ? build.heroItemIds[0] : build.heroItemId;
    if (buildHero && heroItemId && buildHero.toLowerCase() === heroItemId.toLowerCase()) {
      score += 3;
    } else {
      continue;
    }
    const buildUnits = build.keyUnits || [];
    const unitIdsLower = new Set([...unitIds].map(u => u.toLowerCase()));
    for (const ku of buildUnits) {
      if (unitIdsLower.has(ku.toLowerCase())) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = build;
    }
  }
  return bestMatch;
}

// ── Analyze all replays ─────────────────────────────────────

const buildEntries = {}; // buildId → array of replay entries
const unmatched = [];    // replays that didn't match any build

for (const id of dolphinFiles) {
  const data = loadParsedReplay(id);
  if (!data) {
    console.log(`SKIP: ${id} — not parsed`);
    continue;
  }

  const playerEntries = Object.entries(data.players || {}).filter(([, p]) => !p.isNeutralPlayer);
  const mapName = cleanMapName(data.replay.metadata.map.mapName);
  const meta = stageMap[id] || {};

  for (const [pid, pdata] of playerEntries) {
    const pmeta = (data.replay && data.replay.players && data.replay.players[pid]) || {};
    const name = (pmeta.name || '??').replace(/#\d+$/, '');
    const race = pdata.race || pmeta.raceDetected || '?';

    // Hero opener
    let heroItemId = null;
    let heroName = null;
    const events = pdata.eventStream || [];
    for (const ev of events) {
      if (ev.key === 'addUnit' && ev.unit && ev.unit.isHero) {
        heroItemId = ev.unit.itemId;
        heroName = ev.unit.displayName;
        break;
      }
    }

    // Key units
    const unitIds = new Set();
    for (const ev of events) {
      if (ev.key === 'addUnit' && ev.unit && !ev.unit.isHero) {
        if (WORKER_IDS[ev.unit.itemId]) continue;
        if (ev.unit.isSummon || SUMMON_UNIT_IDS[ev.unit.itemId]) continue;
        unitIds.add(ev.unit.itemId);
      }
    }

    const otherPlayer = playerEntries.find(([p]) => p !== pid);
    const opMeta = otherPlayer ? ((data.replay && data.replay.players && data.replay.players[otherPlayer[0]]) || {}) : {};
    const opponent = (opMeta.name || '??').replace(/#\d+$/, '');

    const build = matchBuild(race, heroItemId, unitIds);

    const entry = {
      replayId: id,
      playerSlot: pid,
      playerName: name,
      opponentName: opponent,
      map: mapName,
      outcome: '',
      notes: '',
      tournamentId: tournamentId,
      stage: meta.stage || '',
      round: meta.round || ''
    };

    if (build) {
      if (!buildEntries[build.id]) buildEntries[build.id] = [];
      buildEntries[build.id].push({ entry, race, heroName, playerName: name });
    } else {
      unmatched.push({ entry, race, heroItemId, heroName, unitIds: [...unitIds].slice(0, 5), playerName: name });
    }
  }
}

// ── Output ──────────────────────────────────────────────────

console.log('=== DOLPHIN WSL S2 — BUILD MATCHING RESULTS ===\n');

// Sort builds by match count
const sortedBuilds = Object.entries(buildEntries).sort((a, b) => b[1].length - a[1].length);

for (const [buildId, entries] of sortedBuilds) {
  const build = builds.find(b => b.id === buildId);
  console.log(`\n── ${build.name} (${buildId}) — ${entries.length} replays ──`);
  for (const { entry, heroName, playerName } of entries) {
    console.log(`  ${playerName} (${heroName}) vs ${entry.opponentName} — ${entry.map} [${entry.stage} ${entry.round}]`);
  }
}

if (unmatched.length) {
  console.log(`\n── UNMATCHED — ${unmatched.length} player-replays ──`);
  console.log('  (These players\' builds don\'t match any existing build in the manifest)\n');

  // Group by race+hero for visibility
  const groups = {};
  for (const u of unmatched) {
    const key = `${u.race}_${u.heroItemId || 'none'}`;
    if (!groups[key]) groups[key] = { race: u.race, heroItemId: u.heroItemId, heroName: u.heroName, entries: [] };
    groups[key].entries.push(u);
  }
  for (const [, g] of Object.entries(groups)) {
    console.log(`  ${g.race} ${g.heroName || '??'} (${g.heroItemId || '??'}) — ${g.entries.length} replays`);
    for (const u of g.entries.slice(0, 3)) {
      console.log(`    ${u.playerName} vs ${u.entry.opponentName} — ${u.entry.map} — units: [${u.unitIds.join(', ')}]`);
    }
    if (g.entries.length > 3) console.log(`    ... and ${g.entries.length - 3} more`);
  }
}

// ── Write combined JSON output ──────────────────────────────
const outputPath = path.join(__dirname, 'dolphin-manifest-entries.json');
const output = {};
for (const [buildId, entries] of sortedBuilds) {
  output[buildId] = entries.map(e => e.entry);
}
output._unmatched = unmatched.map(u => ({
  ...u.entry,
  _race: u.race,
  _heroItemId: u.heroItemId,
  _heroName: u.heroName,
  _units: u.unitIds
}));
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(`\nWrote ${outputPath}`);
console.log(`Total: ${Object.values(buildEntries).flat().length} matched + ${unmatched.length} unmatched = ${Object.values(buildEntries).flat().length + unmatched.length} player-replays from ${dolphinFiles.length} games`);
