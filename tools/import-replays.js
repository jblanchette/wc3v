/**
 * import-replays.js — Folder-based replay import system.
 *
 * Drop .w3g files + an import.json into a folder, run this tool.
 * It handles: parsing, summary generation, tournament upsert,
 * build matching, and manifest entry template generation.
 *
 * Usage:
 *   node tools/import-replays.js                     Process replays/import/ folder
 *   node tools/import-replays.js --dry-run            Show what would happen, no writes
 *   node tools/import-replays.js --dir=path/to/dir    Use a different import folder
 *
 * Import folder structure:
 *   replays/import/
 *     import.json            <- metadata for this batch (optional)
 *     replay1.w3g
 *     replay2.w3g
 *
 * See replays/import/import.example.json for the metadata schema.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// --- paths ---

const rootDir = path.join(__dirname, '..');
const defaultImportDir = path.join(rootDir, 'replays', 'import');
const replaysDir = path.join(rootDir, 'replays');
const outputDir = path.join(rootDir, 'client', 'replays');
const summariesDir = path.join(rootDir, 'client', 'data', 'summaries');
const tournamentsPath = path.join(rootDir, 'client', 'data', 'tournaments.json');
const manifestPath = path.join(rootDir, 'client', 'data', 'builds-manifest.json');

// --- arg parsing ---

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

const dryRun = !!args['dry-run'];
const importDir = args.dir ? path.resolve(args.dir) : defaultImportDir;

// --- helpers ---

function formatGameTime(ms) {
  const totalSec = Math.floor((ms || 0) / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function cleanMapName(rawMap) {
  if (!rawMap) return '??';
  let name = rawMap.replace(/^.*[/\\]/, '');
  name = name.replace(/\.(w3x|w3m)$/i, '');
  // strip "(2)" player count prefix
  name = name.replace(/^\(\d+\)\s*/, '');
  // strip leading W3C variants:
  //   5185_w3c_251104_0950_Hammerfall   (newer, hash prefix)
  //   w3c_250622_1057_Turtle_Rock_v1.6  (older, bare w3c)
  name = name.replace(/^\d+_w3c_\d+_\d+_/, '');
  name = name.replace(/^w3c_\d+_\d+_/, '');
  name = name.replace(/^w3c_/, '');
  // strip trailing W3C suffix variants embedded after the real map name:
  //   1v1_Echo_Isles_v2.2_w3c_260125_1357_1051
  name = name.replace(/_w3c_\d+_\d+(_\d+)?$/, '');
  // strip leading "1v1" / "2v2" tournament naming prefix
  name = name.replace(/^\dv\d_/, '');
  // strip version suffix
  name = name.replace(/_v[\d.-]+$/, '');
  // camelCase to spaces
  name = name.replace(/([a-z])([A-Z])/g, '$1 $2');
  name = name.replace(/[_]/g, ' ').replace(/\s+/g, ' ').trim();
  return name || rawMap;
}

function getMatchupString(races) {
  const raceOrder = { H: 0, O: 1, E: 2, U: 3 };
  const sorted = [...races].sort((a, b) => (raceOrder[a] || 9) - (raceOrder[b] || 9));
  return sorted.join('v');
}

function loadParsedReplay(id) {
  const gzPath = path.join(outputDir, `${id}.wc3v.gz`);
  const plainPath = path.join(outputDir, `${id}.wc3v`);

  if (fs.existsSync(plainPath)) {
    return JSON.parse(fs.readFileSync(plainPath, 'utf8'));
  }
  if (fs.existsSync(gzPath)) {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(gzPath)).toString());
  }
  return null;
}

function checkFilename(id) {
  const problems = [];
  if (/\s/.test(id)) problems.push('contains spaces');
  if (/[^a-zA-Z0-9_\-.]/.test(id)) problems.push('has special characters');
  return problems;
}

// --- summary generation (mirrors scripts/generate-summary.js) ---

const SUMMON_UNIT_IDS = {
  'uske': true, 'hwat': true, 'hwt2': true, 'hwt3': true,
  'efon': true, 'osw1': true, 'osw2': true, 'osw3': true, 'ucs1': true
};
const WORKER_IDS = { 'opeo': true, 'hpea': true, 'ewsp': true, 'uaco': true, 'ugho': true };

// Tier-2 / tier-3 production/tech buildings. If one of these appears in a
// player's eventStream BEFORE their tier upgrade completes, it's a parser
// glitch (a phantom event from misattributed action data) and we drop it
// from the user-facing buildPreview.
const T2_BUILDING_IDS = {
  // NE
  'eaow': 2,  // Ancient of Wind  (tier 2)
  // Orc
  'osld': 2,  // Spirit Lodge
  'obea': 2,  // Beastiary
  // UD
  'utod': 2,  // Temple of the Damned
  'usep': 2,  // Sacrificial Pit
  'uslh': 2,  // Slaughterhouse
  // HU
  'hars': 2,  // Arcane Sanctum
  'hwtw': 2,  // Workshop
};
const T3_BUILDING_IDS = {
  'edos': 3,  // Chimera Roost
  'otrb': 3,  // Tauren Totem
  'ogre': 3,  // (no — ogre = orc townhall)
  'ubon': 3,  // Boneyard
  'utom': 3,  // Temple of the Damned (alt)
  'hgra': 3,  // Gryphon Aviary
};
delete T3_BUILDING_IDS['ogre']; // safety: ogre is the Great Hall not a tier-3 building

// Hero itemId race prefix → race code. Heroes with a race prefix that
// doesn't match the player's race are dropped (parser leakage from an
// allied/enemy hero into the wrong eventStream).
function heroRaceFromItemId(itemId) {
  if (!itemId) return null;
  const c = itemId.charAt(0);
  if (c === 'H') return 'H';
  if (c === 'O') return 'O';
  if (c === 'E') return 'E';
  if (c === 'U') return 'U';
  if (c === 'N') return 'N'; // neutral / mercenary; allowed for any race
  return null;
}

function extractPlayerSummary(playerData, replayPlayerData) {
  const { eventStream = [], tierStream = [], researchStream = [] } = playerData;
  const race = playerData.race || replayPlayerData.raceDetected;

  let heroOpener = null;
  for (const event of eventStream) {
    if (event.key !== 'addUnit' || !event.unit || !event.unit.isHero) continue;
    const heroRace = heroRaceFromItemId(event.unit.itemId);
    // Skip race-mismatched heroes (parser leakage) — Death Knight on a
    // Night Elf player, etc. Neutral mercenary heroes (N*) are OK.
    if (heroRace && heroRace !== 'N' && race && heroRace !== race) continue;
    heroOpener = {
      name: event.unit.displayName,
      itemId: event.unit.itemId || '',
      gameTimeMs: event.gameTime,
      gameTimeFormatted: formatGameTime(event.gameTime)
    };
    break;
  }

  let tier2Time = null, tier3Time = null;
  for (const t of tierStream) {
    if (t.tier === 2 && tier2Time === null) tier2Time = t.gameTime;
    if (t.tier === 3 && tier3Time === null) tier3Time = t.gameTime;
  }

  let expansionTime = null;
  for (const event of eventStream) {
    if (event.isExpansion) { expansionTime = event.gameTime; break; }
  }

  const buildPreview = [];
  for (const event of eventStream) {
    if (buildPreview.length >= 20) break;
    const { key, gameTime, unit, building, isExpansion } = event;
    if (key === 'addBuilding' && building) {
      const id = building.itemId || '';
      // Drop tier-locked buildings that appear before the player has reached
      // that tier — these are phantom events from the action-stream parser.
      if (T2_BUILDING_IDS[id] && (tier2Time === null || gameTime < tier2Time)) continue;
      if (T3_BUILDING_IDS[id] && (tier3Time === null || gameTime < tier3Time)) continue;
      buildPreview.push({
        type: isExpansion ? 'expansion' : 'building',
        name: building.displayName,
        itemId: id,
        gameTimeMs: gameTime,
        gameTimeFormatted: formatGameTime(gameTime)
      });
    } else if (key === 'addUnit' && unit) {
      if (WORKER_IDS[unit.itemId]) continue;
      if (unit.isSummon || SUMMON_UNIT_IDS[unit.itemId]) continue;
      // If this is a hero from a different race than the player's, it's a
      // misattributed event (allied/enemy hero leaking into this player's
      // stream). Drop it from the build preview so the side-by-side view
      // doesn't show "Death Knight" on a Night Elf player.
      if (unit.isHero) {
        const heroRace = heroRaceFromItemId(unit.itemId);
        if (heroRace && heroRace !== 'N' && race && heroRace !== race) continue;
      }
      buildPreview.push({
        type: unit.isHero ? 'hero' : 'unit',
        name: unit.displayName,
        itemId: unit.itemId || '',
        gameTimeMs: gameTime,
        gameTimeFormatted: formatGameTime(gameTime)
      });
    }
  }

  // T2/T3 phase breakdown
  const t2Buildings = [], t3Buildings = [];
  const t2Units = new Set(), t3Units = new Set();
  const t2BuildingIds = new Set(), t3BuildingIds = new Set();

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
      if (inT2) t2Units.add(unit.itemId);
      else if (inT3) t3Units.add(unit.itemId);
    }
  }

  function resolveUnitNames(unitIdSet) {
    const result = [];
    for (const itemId of unitIdSet) {
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

  const researchedMap = {};
  for (const r of researchStream) {
    if (!researchedMap[r.itemId] || r.level > researchedMap[r.itemId].level) {
      researchedMap[r.itemId] = {
        itemId: r.itemId,
        name: r.displayName,
        level: r.level,
        category: r.category,
        icon: r.icon,
        gameTimeMs: r.gameTime,
        gameTimeFormatted: formatGameTime(r.gameTime)
      };
    }
  }

  return {
    name: replayPlayerData.name,
    race,
    heroOpener,
    tier2Time,
    tier2TimeFormatted: tier2Time !== null ? formatGameTime(tier2Time) : null,
    tier3Time,
    tier3TimeFormatted: tier3Time !== null ? formatGameTime(tier3Time) : null,
    expansionTime,
    expansionTimeFormatted: expansionTime !== null ? formatGameTime(expansionTime) : null,
    buildPreview,
    t2Buildings,
    t2Units: resolveUnitNames(t2Units),
    t3Buildings,
    t3Units: resolveUnitNames(t3Units),
    researched: Object.values(researchedMap)
  };
}

function generateSummary(replayId, data) {
  const { replay, players } = data;
  const durationMs = replay.subheader.replayLengthMS;
  const replayPlayers = replay.players || {};

  const cleanMap = cleanMapName(replay.metadata.map.mapName);

  const summary = {
    replayId,
    map: cleanMap,
    mapRaw: replay.metadata.map.mapName,
    durationMs,
    durationFormatted: formatGameTime(durationMs),
    fingerprint: null,
    players: {}
  };

  for (const playerId of Object.keys(players)) {
    const pd = players[playerId];
    const rpd = replayPlayers[playerId];
    if (!rpd) continue;
    if (pd.isNeutralPlayer) continue;
    if (rpd.teamId >= 1000) continue;
    summary.players[playerId] = extractPlayerSummary(pd, rpd);
  }

  summary.fingerprint = computeFingerprint(cleanMap, durationMs, players, replayPlayers);

  return summary;
}

// Content fingerprint for self-match: same .w3g file should produce the same
// string regardless of how a user uploads or re-imports it. Bucket duration to
// the nearest second to swallow parser float jitter, sort player names so 1v1
// / 2v2 / FFA are roster-order-independent.
function computeFingerprint(cleanMap, durationMs, players, replayPlayers) {
  const names = [];
  for (const playerId of Object.keys(players)) {
    const pd = players[playerId];
    const rpd = replayPlayers[playerId];
    if (!rpd) continue;
    if (pd && pd.isNeutralPlayer) continue;
    if (rpd && rpd.teamId >= 1000) continue;
    const n = String((rpd && rpd.name) || '').toLowerCase().trim();
    if (n) names.push(n);
  }
  names.sort();
  const durSec = Math.round((durationMs || 0) / 1000);
  return `${cleanMap}|${durSec}|${names.join(',')}`;
}

function writeSummaryFile(replayId, data) {
  const summary = generateSummary(replayId, data);
  if (!summary) return null;

  if (!dryRun) {
    if (!fs.existsSync(summariesDir)) fs.mkdirSync(summariesDir, { recursive: true });
    const outPath = path.join(summariesDir, `${replayId}.json`);
    fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
    console.log(`  Summary: ${outPath}`);
  }

  return summary;
}

// --- build matching ---

const { matchBuild } = require('../helpers/buildMatcher');

function loadManifestBuilds() {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    return manifest.builds || [];
  } catch (e) {
    return [];
  }
}

// --- tournament upsert ---

function loadTournaments() {
  try {
    return JSON.parse(fs.readFileSync(tournamentsPath, 'utf-8'));
  } catch (e) {
    return { tournaments: [] };
  }
}

function upsertTournament(tournamentData) {
  if (!tournamentData || !tournamentData.id) return;

  const data = loadTournaments();
  const existing = data.tournaments.findIndex(t => t.id === tournamentData.id);

  if (existing >= 0) {
    // merge: update fields that are provided
    data.tournaments[existing] = { ...data.tournaments[existing], ...tournamentData };
    console.log(`  Tournament updated: ${tournamentData.id}`);
  } else {
    data.tournaments.push(tournamentData);
    console.log(`  Tournament added: ${tournamentData.id}`);
  }

  if (!dryRun) {
    fs.writeFileSync(tournamentsPath, JSON.stringify(data, null, 2) + '\n');
  }
}

// --- regen-summaries mode ---

// Reads every parsed replay in client/replays/*.wc3v.gz and rewrites the
// matching summary file in client/data/summaries/. Useful after fixing a
// summary-shaping bug or adding a new field (e.g., fingerprint) without
// re-importing the source .w3g files.
async function regenSummaries() {
  console.log(`\n=== REGEN SUMMARIES${dryRun ? ' (DRY RUN)' : ''} ===\n`);
  if (!fs.existsSync(outputDir)) {
    console.log(`No client/replays directory at ${outputDir}`);
    process.exit(1);
  }
  const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.wc3v.gz') || f.endsWith('.wc3v'));
  if (!files.length) {
    console.log('No parsed replays found in client/replays/.');
    process.exit(0);
  }

  let ok = 0, skipped = 0, failed = 0;
  for (const f of files) {
    const id = f.replace(/\.wc3v(\.gz)?$/, '');
    const onlyArg = args.only ? String(args.only) : null;
    if (onlyArg && id !== onlyArg) { skipped++; continue; }
    try {
      const data = loadParsedReplay(id);
      if (!data) { console.log(`  SKIP ${id} — couldn't load parsed data`); skipped++; continue; }
      const summary = generateSummary(id, data);
      if (!summary) { console.log(`  SKIP ${id} — generateSummary returned null`); skipped++; continue; }
      const outPath = path.join(summariesDir, `${id}.json`);
      if (dryRun) {
        console.log(`  [DRY] ${id}: map="${summary.map}" fp="${summary.fingerprint}"`);
      } else {
        if (!fs.existsSync(summariesDir)) fs.mkdirSync(summariesDir, { recursive: true });
        fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
        console.log(`  OK   ${id}: map="${summary.map}"`);
      }
      ok++;
    } catch (e) {
      console.log(`  FAIL ${id}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ok=${ok} skipped=${skipped} failed=${failed}\n`);
}

// --- main import flow ---

async function main() {
  // Branch into regen-summaries mode if asked.
  if (args['regen-summaries']) {
    return regenSummaries();
  }

  console.log(`\n=== REPLAY IMPORT${dryRun ? ' (DRY RUN)' : ''} ===\n`);
  console.log(`Import folder: ${importDir}\n`);

  // check import dir exists
  if (!fs.existsSync(importDir)) {
    console.log(`Import folder does not exist: ${importDir}`);
    console.log(`Create it and add .w3g files + optional import.json`);
    process.exit(1);
  }

  // find .w3g files
  const w3gFiles = fs.readdirSync(importDir).filter(f => f.endsWith('.w3g'));
  if (w3gFiles.length === 0) {
    console.log('No .w3g files found in import folder.');
    process.exit(0);
  }

  console.log(`Found ${w3gFiles.length} replay file(s):\n`);
  for (const f of w3gFiles) {
    const problems = checkFilename(path.basename(f, '.w3g'));
    console.log(`  ${f}${problems.length ? ` (WARNING: ${problems.join(', ')})` : ''}`);
  }
  console.log('');

  // load import.json metadata (optional)
  let importMeta = { tournament: null, replays: {} };
  const importJsonPath = path.join(importDir, 'import.json');
  if (fs.existsSync(importJsonPath)) {
    try {
      importMeta = JSON.parse(fs.readFileSync(importJsonPath, 'utf-8'));
      console.log(`Loaded import.json`);
      if (importMeta.tournament) {
        console.log(`  Tournament: ${importMeta.tournament.name} (${importMeta.tournament.id})`);
      }
      const metaCount = Object.keys(importMeta.replays || {}).length;
      if (metaCount) {
        console.log(`  Per-replay metadata: ${metaCount} entries`);
      }
    } catch (e) {
      console.log(`WARNING: Could not parse import.json: ${e.message}`);
      console.log('  Continuing without metadata.\n');
    }
  } else {
    console.log('No import.json found — importing without tournament metadata.\n');
  }
  console.log('');

  // validate filenames
  const validFiles = [];
  for (const f of w3gFiles) {
    const id = path.basename(f, '.w3g');
    const problems = checkFilename(id);
    if (problems.length) {
      console.log(`SKIP: "${f}" — filename ${problems.join(', ')}. Rename first.`);
      continue;
    }
    validFiles.push({ filename: f, id });
  }

  if (validFiles.length === 0) {
    console.log('\nNo valid replay files to process.');
    process.exit(1);
  }

  // upsert tournament if provided
  if (importMeta.tournament) {
    console.log('--- Tournament ---');
    upsertTournament(importMeta.tournament);
    console.log('');
  }

  // parse replays
  console.log('--- Parsing ---\n');

  const { parseReplays } = require('../wc3v');
  const config = require('../config/config');
  const logManager = require('../helpers/logManager');

  config.debugPlayer = null;
  logManager.setTestMode();

  const results = [];
  const builds = loadManifestBuilds();

  for (const { filename, id } of validFiles) {
    const srcPath = path.join(importDir, filename);

    if (dryRun) {
      console.log(`  [DRY RUN] Would parse: ${filename}`);
      results.push({ id, filename, dryRun: true });
      continue;
    }

    // copy .w3g to replays/ dir for the parser
    const destPath = path.join(replaysDir, filename);
    fs.copyFileSync(srcPath, destPath);

    console.log(`  Parsing: ${filename}`);
    try {
      const res = await parseReplays({
        paths: [`./replays/${filename}`],
        hashes: [null],
        jsonPadding: 0,
        isProduction: true,
        inTestMode: false
      });

      const r = res[0];
      if (r && r.passed) {
        console.log(`    OK`);

        // load parsed data for summary + analysis
        const data = loadParsedReplay(id);
        if (data) {
          // generate summary
          const summary = writeSummaryFile(id, data);

          // extract player info for manifest template
          const replayMeta = (importMeta.replays || {})[filename] || {};
          const playerEntries = Object.entries(data.players || {}).filter(([, p]) => !p.isNeutralPlayer);
          const races = [];
          const playerInfos = [];

          for (const [pid, pdata] of playerEntries) {
            const meta = (data.replay && data.replay.players && data.replay.players[pid]) || {};
            const name = (meta.name || '??').replace(/#\d+$/, '');
            const race = pdata.race || meta.raceDetected || '?';
            races.push(race);

            // hero opener
            let heroItemId = null;
            const events = pdata.eventStream || [];
            for (const ev of events) {
              if (ev.key === 'addUnit' && ev.unit && ev.unit.isHero) {
                heroItemId = ev.unit.itemId;
                break;
              }
            }

            // try to match a build using weighted hybrid detection
            const suggestedBuild = matchBuild(race, heroItemId, events, pdata.tierStream || [], builds);

            playerInfos.push({ pid, name, race, heroItemId, suggestedBuild });
          }

          results.push({
            id, filename, passed: true,
            mapName: cleanMapName(data.replay.metadata.map.mapName),
            matchup: getMatchupString(races),
            playerInfos,
            replayMeta,
            tournamentId: importMeta.tournament ? importMeta.tournament.id : null
          });
        } else {
          results.push({ id, filename, passed: true, parseOnly: true });
        }
      } else {
        console.log(`    FAILED: ${r ? r.error : 'unknown'}`);
        results.push({ id, filename, passed: false, error: r ? r.error : 'unknown' });
      }
    } catch (e) {
      console.log(`    ERROR: ${e.message}`);
      results.push({ id, filename, passed: false, error: e.message });
    }
  }

  // --- report ---

  const passed = results.filter(r => r.passed);
  const failed = results.filter(r => r.passed === false);

  console.log(`\n--- Results ---\n`);
  console.log(`  Parsed: ${passed.length}/${validFiles.length} OK`);
  if (failed.length) {
    console.log(`  Failed: ${failed.length}`);
    for (const f of failed) {
      console.log(`    ${f.filename}: ${f.error}`);
    }
  }

  // print manifest entry templates
  if (passed.length) {
    console.log(`\n--- Manifest Entry Templates ---\n`);
    console.log('Add these to builds-manifest.json under the appropriate build\'s "replays" array:\n');

    for (const result of passed) {
      if (result.dryRun || result.parseOnly) continue;
      if (!result.playerInfos) continue;

      console.log(`  === ${result.id} === (${result.matchup} on ${result.mapName})`);

      for (const player of result.playerInfos) {
        const otherPlayer = result.playerInfos.find(p => p.pid !== player.pid);
        const opponentName = otherPlayer ? otherPlayer.name : '??';

        // resolve outcome from import.json
        let outcome = '';
        if (result.replayMeta && result.replayMeta.outcome) {
          outcome = result.replayMeta.outcome[player.pid] || '';
        }

        const template = {
          replayId: result.id,
          playerSlot: player.pid,
          playerName: player.name,
          opponentName: opponentName,
          map: result.mapName,
          outcome: outcome,
          notes: (result.replayMeta && result.replayMeta.notes) || ''
        };

        // add tournament fields if present
        if (result.tournamentId) {
          template.tournamentId = result.tournamentId;
          template.stage = (result.replayMeta && result.replayMeta.stage) || '';
          template.round = (result.replayMeta && result.replayMeta.round) || '';
        }

        const suggestion = player.suggestedBuild
          ? ` --> suggested build: ${player.suggestedBuild.id}`
          : ' --> no build match';

        console.log(`\n    Player ${player.pid} (${player.name}, ${player.race})${suggestion}`);
        console.log(`    ${JSON.stringify(template, null, 2).split('\n').join('\n    ')}`);
      }
      console.log('');
    }
  }

  // move processed files out of import dir (unless dry run)
  if (!dryRun && passed.length) {
    console.log('--- Cleanup ---\n');
    for (const result of passed) {
      if (result.dryRun) continue;
      const srcPath = path.join(importDir, result.filename);
      if (fs.existsSync(srcPath)) {
        fs.unlinkSync(srcPath);
        console.log(`  Removed from import: ${result.filename} (copied to replays/)`);
      }
    }

    // remove import.json if all replays processed successfully
    if (failed.length === 0 && fs.existsSync(importJsonPath)) {
      fs.unlinkSync(importJsonPath);
      console.log(`  Removed: import.json`);
    }
  }

  console.log('\nDone.\n');
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
