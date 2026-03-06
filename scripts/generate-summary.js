/**
 * generate-summary.js — Extract compact summary data from .wc3v.gz replay files.
 *
 * Usage:
 *   node scripts/generate-summary.js --replay=happy-vs-grubby
 *   node scripts/generate-summary.js --all   (processes all named replays)
 *
 * Output: client/data/summaries/{replayId}.json
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// Mirror BuildOrderData.CONFIG sets — keep in sync if those change
const SUMMON_UNIT_IDS = {
  'uske': true, 'hwat': true, 'hwt2': true, 'hwt3': true,
  'efon': true, 'osw1': true, 'osw2': true, 'osw3': true, 'ucs1': true
};
const WORKER_IDS = { 'opeo': true, 'hpea': true, 'ewsp': true, 'uaco': true, 'ugho': true };

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

function formatMs(ms) {
  const mins  = Math.floor(ms / 60000);
  const secs  = Math.floor((ms % 60000) / 1000);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

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

function extractPlayerSummary(playerData, replayPlayerData) {
  const { eventStream = [], tierStream = [] } = playerData;
  const race = playerData.race || replayPlayerData.raceDetected;

  // Hero opener: first addUnit event with isHero
  let heroOpener = null;
  for (const event of eventStream) {
    if (event.key === 'addUnit' && event.unit && event.unit.isHero) {
      heroOpener = {
        name:               event.unit.displayName,
        itemId:             event.unit.itemId || '',
        gameTimeMs:         event.gameTime,
        gameTimeFormatted:  formatMs(event.gameTime)
      };
      break;
    }
  }

  // Tier timings
  let tier2Time = null, tier3Time = null;
  for (const t of tierStream) {
    if (t.tier === 2 && tier2Time === null) tier2Time = t.gameTime;
    if (t.tier === 3 && tier3Time === null) tier3Time = t.gameTime;
  }

  // First expansion building
  let expansionTime = null;
  for (const event of eventStream) {
    if (event.isExpansion) { expansionTime = event.gameTime; break; }
  }

  // Build preview: first 20 meaningful events (skip workers, summons, heroLevels)
  const buildPreview = [];
  for (const event of eventStream) {
    if (buildPreview.length >= 20) break;
    const { key, gameTime, unit, building, isExpansion } = event;

    if (key === 'addBuilding' && building) {
      buildPreview.push({
        type:              isExpansion ? 'expansion' : 'building',
        name:              building.displayName,
        itemId:            building.itemId || '',
        gameTimeMs:        gameTime,
        gameTimeFormatted: formatMs(gameTime)
      });
    } else if (key === 'addUnit' && unit) {
      if (WORKER_IDS[unit.itemId]) continue;
      if (unit.isSummon || SUMMON_UNIT_IDS[unit.itemId]) continue;
      buildPreview.push({
        type:              unit.isHero ? 'hero' : 'unit',
        name:              unit.displayName,
        itemId:            unit.itemId || '',
        gameTimeMs:        gameTime,
        gameTimeFormatted: formatMs(gameTime)
      });
    }
  }

  // T2/T3 phase breakdown — buildings and unique unit types per tier phase
  const t2Buildings = [];
  const t2Units = new Set();
  const t3Buildings = [];
  const t3Units = new Set();
  const t2BuildingIds = new Set();
  const t3BuildingIds = new Set();

  for (const event of eventStream) {
    const { key, gameTime, unit, building } = event;
    const inT2 = tier2Time !== null && gameTime >= tier2Time && (tier3Time === null || gameTime < tier3Time);
    const inT3 = tier3Time !== null && gameTime >= tier3Time;

    if (key === 'addBuilding' && building && building.itemId) {
      if (inT2 && !t2BuildingIds.has(building.itemId)) {
        t2BuildingIds.add(building.itemId);
        t2Buildings.push({ name: building.displayName, itemId: building.itemId });
      } else if (inT3 && !t3BuildingIds.has(building.itemId)) {
        t3BuildingIds.add(building.itemId);
        t3Buildings.push({ name: building.displayName, itemId: building.itemId });
      }
    } else if (key === 'addUnit' && unit && unit.itemId) {
      if (WORKER_IDS[unit.itemId]) continue;
      if (unit.isSummon || SUMMON_UNIT_IDS[unit.itemId]) continue;
      if (inT2 && !t2Units.has(unit.itemId)) {
        t2Units.add(unit.itemId);
      } else if (inT3 && !t3Units.has(unit.itemId)) {
        t3Units.add(unit.itemId);
      }
    }
  }

  // Convert unit sets to arrays with names from buildPreview or eventStream
  function resolveUnitNames(unitIdSet) {
    const result = [];
    for (const itemId of unitIdSet) {
      // Find the display name from any event in eventStream
      let name = itemId;
      for (const ev of eventStream) {
        if (ev.key === 'addUnit' && ev.unit && ev.unit.itemId === itemId) {
          name = ev.unit.displayName;
          break;
        }
      }
      result.push({ name, itemId });
    }
    return result;
  }

  return {
    name:                   replayPlayerData.name,
    race,
    heroOpener,
    tier2Time,
    tier2TimeFormatted:     tier2Time !== null ? formatMs(tier2Time) : null,
    tier3Time,
    tier3TimeFormatted:     tier3Time !== null ? formatMs(tier3Time) : null,
    expansionTime,
    expansionTimeFormatted: expansionTime !== null ? formatMs(expansionTime) : null,
    buildPreview,
    t2Buildings,
    t2Units: resolveUnitNames(t2Units),
    t3Buildings,
    t3Units: resolveUnitNames(t3Units)
  };
}

function generateSummary(replayId) {
  const data = loadReplay(replayId);
  if (!data) {
    console.error(`ERROR: Could not load replay "${replayId}"`);
    return null;
  }

  const { replay, players } = data;
  const durationMs   = replay.subheader.replayLengthMS;
  const replayPlayers = replay.players || {};

  const summary = {
    replayId,
    map:               parseMapDisplay(replay.metadata.map.mapName),
    mapRaw:            replay.metadata.map.mapName,
    durationMs,
    durationFormatted: formatMs(durationMs),
    players:           {}
  };

  for (const playerId of Object.keys(players)) {
    const pd  = players[playerId];
    const rpd = replayPlayers[playerId];
    if (!rpd) continue;
    if (pd.isNeutralPlayer) continue;
    if (rpd.teamId >= 1000) continue; // skip AI/neutral teams
    summary.players[playerId] = extractPlayerSummary(pd, rpd);
  }

  return summary;
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
  console.log(`\nDone. ${ok} written, ${fail} failed.`);
} else if (args.replay) {
  writeSummary(args.replay);
} else {
  console.log('Usage: node scripts/generate-summary.js --replay=NAME');
  console.log('       node scripts/generate-summary.js --all');
  process.exit(1);
}
