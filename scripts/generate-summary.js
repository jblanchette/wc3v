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

// Tower itemIds per race, used by firstTowerTime detection.
const TOWER_IDS = {
  'hgtw': true, 'hgt1': true, 'hgt2': true, 'hwtw': true, // Human (guard, cannon, arcane)
  'owtw': true, // Orc (watch tower)
  'unpl': true, // UD (nerubian tower)
  'etrp': true, 'etol': true  // NE (ancient protector — etol is also town hall)
};

// Sample economyTrack every 30s of game time. Cheaper than per-event.
const ECONOMY_SAMPLE_INTERVAL_MS = 30 * 1000;
const ECONOMY_MAX_DURATION_MS = 30 * 60 * 1000; // cap at 30min

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
  const { eventStream = [], tierStream = [], researchStream = [] } = playerData;
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

  // economyTrack: sampled supply + worker snapshots every 30s of game time.
  // Built by walking eventStream — each event has supplyUsed/supplyMax and a
  // workers struct, so we just snapshot the most recent one at each tick.
  const economyTrack = [];
  let nextSampleAt = 0;
  let lastSnapshot = null;
  for (const ev of eventStream) {
    if (typeof ev.gameTime !== 'number') continue;
    if (typeof ev.supplyUsed === 'number') {
      lastSnapshot = {
        gameTimeMs: ev.gameTime,
        supplyUsed: ev.supplyUsed,
        supplyMax: ev.supplyMax || 0,
        workersOnGold: ev.workers ? (ev.workers.onGold || 0) : 0,
        workersOnLumber: ev.workers ? ((ev.workers.onLumber || 0) + (ev.workers.ghoulsOnLumber || 0)) : 0,
        totalWorkers: ev.workers ? (ev.workers.totalWorkers || 0) : 0
      };
    }
    while (lastSnapshot && ev.gameTime >= nextSampleAt && nextSampleAt <= ECONOMY_MAX_DURATION_MS) {
      economyTrack.push({ ...lastSnapshot, gameTimeMs: nextSampleAt });
      nextSampleAt += ECONOMY_SAMPLE_INTERVAL_MS;
    }
  }

  // First-of-X milestone timings.
  let firstTowerTime = null;
  let firstUnitTime = null;
  for (const ev of eventStream) {
    if (firstTowerTime === null && ev.key === 'addBuilding' && ev.building && TOWER_IDS[ev.building.itemId]) {
      firstTowerTime = ev.gameTime;
    }
    if (firstUnitTime === null && ev.key === 'addUnit' && ev.unit && !ev.unit.isHero
        && !WORKER_IDS[ev.unit.itemId] && !ev.unit.isSummon && !SUMMON_UNIT_IDS[ev.unit.itemId]) {
      firstUnitTime = ev.gameTime;
    }
    if (firstTowerTime !== null && firstUnitTime !== null) break;
  }

  // Hero level milestones — eventStream emits 'heroLevel' for level-ups.
  let firstHeroLevel2Time = null;
  let firstHeroLevel3Time = null;
  for (const ev of eventStream) {
    if (ev.key !== 'heroLevel') continue;
    if (firstHeroLevel2Time === null && ev.level === 2) firstHeroLevel2Time = ev.gameTime;
    if (firstHeroLevel3Time === null && ev.level === 3) firstHeroLevel3Time = ev.gameTime;
    if (firstHeroLevel2Time !== null && firstHeroLevel3Time !== null) break;
  }

  // Research/upgrades: dedupe by itemId keeping highest level
  const researchedMap = {};
  for (const r of researchStream) {
    if (!researchedMap[r.itemId] || r.level > researchedMap[r.itemId].level) {
      researchedMap[r.itemId] = {
        itemId:            r.itemId,
        name:              r.displayName,
        level:             r.level,
        category:          r.category,
        icon:              r.icon,
        gameTimeMs:        r.gameTime,
        gameTimeFormatted: formatMs(r.gameTime)
      };
    }
  }
  const researched = Object.values(researchedMap);

  // Archetype classifier: coarse heuristic on first ~6:00 of the build.
  // Used by the compare page to filter pro picker and to make build-adherence
  // scoring meaningful (only compare same-archetype replays).
  const archetype = classifyArchetype({
    tier2Time,
    expansionTime,
    firstTowerTime,
    eventStream,
    race
  });

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
    firstTowerTime,
    firstTowerTimeFormatted: firstTowerTime !== null ? formatMs(firstTowerTime) : null,
    firstUnitTime,
    firstUnitTimeFormatted: firstUnitTime !== null ? formatMs(firstUnitTime) : null,
    firstHeroLevel2Time,
    firstHeroLevel2TimeFormatted: firstHeroLevel2Time !== null ? formatMs(firstHeroLevel2Time) : null,
    firstHeroLevel3Time,
    firstHeroLevel3TimeFormatted: firstHeroLevel3Time !== null ? formatMs(firstHeroLevel3Time) : null,
    archetype,
    economyTrack,
    buildPreview,
    t2Buildings,
    t2Units: resolveUnitNames(t2Units),
    t3Buildings,
    t3Units: resolveUnitNames(t3Units),
    researched
  };
}

// Classify a build into a coarse archetype. Used by the compare picker and
// by build-adherence scoring (only meaningful within an archetype).
//
// Categories:
//   fast-expand  — expansion building before T2, OR within 2:00 of T2
//   tower-rush   — first tower before 4:00 (close to opp base; we approximate
//                  with raw timing since we don't track positions in summary)
//   1-base-t2    — T2 before 6:00 AND no expansion in first 8:00
//   tech         — caster hero opener AND 2+ tech buildings before T2
//   unknown      — fallback
function classifyArchetype ({ tier2Time, expansionTime, firstTowerTime, eventStream, race }) {
  const SIX_MIN = 6 * 60 * 1000;
  const EIGHT_MIN = 8 * 60 * 1000;
  const FOUR_MIN = 4 * 60 * 1000;
  const TWO_MIN = 2 * 60 * 1000;

  // Tower rush: first tower in first 4:00.
  if (firstTowerTime !== null && firstTowerTime < FOUR_MIN) {
    return 'tower-rush';
  }
  // Fast expand: expansion before T2 reached, or expansion within 2:00 of T2.
  if (expansionTime !== null) {
    if (tier2Time === null) return 'fast-expand';
    if (expansionTime < tier2Time) return 'fast-expand';
    if (expansionTime - tier2Time < TWO_MIN) return 'fast-expand';
  }
  // 1-base T2: T2 before 6:00, no expansion in first 8:00.
  if (tier2Time !== null && tier2Time < SIX_MIN
      && (expansionTime === null || expansionTime > EIGHT_MIN)) {
    return '1-base-t2';
  }
  return 'unknown';
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
