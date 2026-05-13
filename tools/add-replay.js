/**
 * add-replay.js — Scan, parse, and summarize new pro replays.
 *
 * Usage:
 *   node tools/add-replay.js --scan              List unprocessed .w3g files
 *   node tools/add-replay.js --parse             Parse all new replays
 *   node tools/add-replay.js --parse --replay=X  Parse one specific replay
 *   node tools/add-replay.js --summary           Summarize parsed replays (with manifest templates)
 *   node tools/add-replay.js --all               Scan + parse + summarize
 *   node tools/add-replay.js --manifest-check    Cross-ref manifest vs actual files
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const replaysDir = path.join(__dirname, '..', 'replays');
const outputDir = path.join(__dirname, '..', 'client', 'replays');

const { getManifestReplayIds } = require('../helpers/utils');
const PlayerNames = require('../client/js/PlayerNames.js');

// --- arg parsing ---

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

const wantScan = args.scan || args.all;
const wantParse = args.parse || args.all;
const wantSummary = args.summary || args.all;
const wantManifestCheck = args['manifest-check'];
const singleReplay = args.replay || null;

if (!wantScan && !wantParse && !wantSummary && !wantManifestCheck) {
  console.log('Usage: node tools/add-replay.js --scan | --parse | --summary | --all | --manifest-check');
  console.log('  --replay=NAME   Target a specific replay (with --parse or --summary)');
  process.exit(0);
}

// --- helpers ---

function getAllW3gIds() {
  return fs.readdirSync(replaysDir)
    .filter(f => f.endsWith('.w3g'))
    .map(f => path.basename(f, '.w3g'));
}

function getAllW3gByDate() {
  return fs.readdirSync(replaysDir)
    .filter(f => f.endsWith('.w3g'))
    .map(f => {
      const stat = fs.statSync(path.join(replaysDir, f));
      return { id: path.basename(f, '.w3g'), mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function getAllParsedIds() {
  return fs.readdirSync(outputDir)
    .filter(f => f.endsWith('.wc3v.gz'))
    .map(f => path.basename(f, '.wc3v.gz'));
}

function checkFilename(id) {
  const problems = [];
  if (/\s/.test(id)) problems.push('contains spaces');
  if (/[^a-zA-Z0-9_\-.]/.test(id)) problems.push('has special characters');
  return problems;
}

function formatGameTime(ms) {
  const totalSec = Math.floor((ms || 0) / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
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

function getMatchupString(races) {
  const raceOrder = { H: 0, O: 1, E: 2, U: 3 };
  const sorted = [...races].sort((a, b) => (raceOrder[a] || 9) - (raceOrder[b] || 9));
  return sorted.join('v');
}

function cleanMapName(rawMap) {
  if (!rawMap) return '??';
  // strip W3C path prefix like "Maps/W3Champions\54_w3c_251104_0950_"
  let name = rawMap.replace(/^.*[/\\]/, '');
  // strip W3C numeric prefix (e.g., "54_w3c_251104_0950_")
  name = name.replace(/^\d+_w3c_\d+_\d+_/, '');
  // strip .w3x extension
  name = name.replace(/\.w3x$/i, '');
  return name || rawMap;
}

// --- scan ---

function scanNewReplays() {
  const allByDate = getAllW3gByDate();
  const parsedIds = new Set(getAllParsedIds());
  const manifestIds = new Set(getManifestReplayIds());

  // sort by date, find unprocessed non-test replays
  const newReplays = [];
  const skippedTest = [];

  for (const { id, mtime } of allByDate) {
    if (parsedIds.has(id)) continue;
    if (id.startsWith('test-') || id.startsWith('bad') || id === 'w3c-test') {
      skippedTest.push(id);
      continue;
    }
    newReplays.push({ id, mtime });
  }

  if (newReplays.length === 0) {
    console.log('No unprocessed pro replays found.');
    if (skippedTest.length) console.log(`  (${skippedTest.length} test replays skipped)`);
    console.log('');
  } else {
    console.log(`Found ${newReplays.length} unprocessed replay(s) (newest first):\n`);
    for (const { id, mtime } of newReplays) {
      const date = new Date(mtime).toLocaleDateString();
      const problems = checkFilename(id);
      const inManifest = manifestIds.has(id) ? ' [in manifest]' : '';
      console.log(`  ${id}  (${date})${inManifest}`);
      if (problems.length) {
        const safe = id.replace(/\s+/g, '').replace(/[^a-zA-Z0-9_\-.]/g, '_');
        console.log(`    WARNING: filename ${problems.join(', ')}`);
        console.log(`    Suggested: mv "./replays/${id}.w3g" "./replays/${safe}.w3g"`);
      }
    }
    if (skippedTest.length) console.log(`\n  (${skippedTest.length} test replays skipped)`);
    console.log('');
  }

  return newReplays.map(r => r.id);
}

// --- parse ---

async function parseNewReplays(replayIds) {
  if (replayIds.length === 0) {
    console.log('Nothing to parse.\n');
    return [];
  }

  const { parseReplays } = require('../wc3v');
  const config = require('../config/config');
  const logManager = require('../helpers/logManager');

  config.debugPlayer = null;
  logManager.setTestMode();

  const results = [];

  for (const id of replayIds) {
    const problems = checkFilename(id);
    if (problems.length) {
      console.log(`\n  SKIP: "${id}" — filename ${problems.join(', ')}. Rename first.`);
      results.push({ id, passed: false, error: 'bad filename' });
      continue;
    }

    console.log(`\n--- Parsing: ${id} ---`);
    try {
      const res = await parseReplays({
        paths: [`./replays/${id}.w3g`],
        hashes: [null],
        jsonPadding: 0,
        isProduction: true,
        inTestMode: false
      });

      const r = res[0];
      if (r && r.passed) {
        console.log(`  OK`);
        results.push({ id, passed: true });
      } else {
        console.log(`  FAILED: ${r ? r.error : 'unknown'}`);
        results.push({ id, passed: false, error: r ? r.error : 'unknown' });
      }
    } catch (e) {
      console.log(`  ERROR: ${e.message}`);
      results.push({ id, passed: false, error: e.message });
    }
  }

  const passed = results.filter(r => r.passed).length;
  console.log(`\nParsed: ${passed}/${replayIds.length} OK\n`);
  return results;
}

// --- summary ---

function printSummary(replayIds) {
  const manifestIds = new Set(getManifestReplayIds());

  for (const id of replayIds) {
    const data = loadParsedReplay(id);
    if (!data) {
      console.log(`\n=== ${id} === (not parsed yet)`);
      continue;
    }

    const inManifest = manifestIds.has(id);
    console.log(`\n=== ${id} ===${inManifest ? ' [IN MANIFEST]' : ''}`);

    // map name
    const rawMap = data.replay && data.replay.metadata && data.replay.metadata.map
      ? data.replay.metadata.map.mapName || '??'
      : '??';
    const mapName = cleanMapName(rawMap);
    console.log(`  Map: ${mapName}`);

    // players
    const playerEntries = Object.entries(data.players || {}).filter(([, p]) => !p.isNeutralPlayer);
    const races = [];

    for (const [pid, pdata] of playerEntries) {
      const meta = (data.replay && data.replay.players && data.replay.players[pid]) || {};
      const rawName = meta.name || '??';
      const proName = PlayerNames.canonical(rawName);
      // Show "rawHandle → OfficialName" when they differ so onboarding makes
      // the alias mapping visible (PlayerNames.js is the source of truth).
      const name = (proName && proName !== rawName) ? `${rawName} → ${proName}` : rawName;
      const race = pdata.race || meta.raceDetected || '?';
      races.push(race);

      const events = pdata.eventStream || [];
      const eventCount = events.length;

      // heroes
      const heroes = events
        .filter(e => e.key === 'addUnit' && e.unit && e.unit.isHero)
        .map(e => e.unit.displayName);
      const uniqueHeroes = [...new Set(heroes)];

      // tiers
      const tiers = (pdata.tierStream || [])
        .map(t => `T${t.tier}@${formatGameTime(t.gameTime)}`)
        .join(', ');

      console.log(`  Player ${pid}: ${name} (${race}) — ${eventCount} events — Heroes: [${uniqueHeroes.join(', ')}] — Tiers: [${tiers}]`);
    }

    const matchup = getMatchupString(races);
    console.log(`  Matchup: ${matchup}`);

    // manifest templates for each player
    if (!inManifest) {
      console.log(`\n  Manifest templates:`);
      for (const [pid] of playerEntries) {
        const meta = (data.replay && data.replay.players && data.replay.players[pid]) || {};
        const name = PlayerNames.canonical(meta.name || '??');
        const otherEntry = playerEntries.find(([p]) => p !== pid);
        const opMeta = otherEntry ? ((data.replay && data.replay.players && data.replay.players[otherEntry[0]]) || {}) : {};
        const opponent = PlayerNames.canonical(opMeta.name || '??');

        const template = {
          replayId: id,
          playerSlot: pid,
          playerName: name,
          opponentName: opponent,
          map: mapName,
          outcome: '',
          notes: ''
        };
        console.log(`    ${JSON.stringify(template)}`);
      }
    }
  }
  console.log('');
}

// --- manifest check ---

function manifestCheck() {
  const manifestIds = getManifestReplayIds();
  const parsedIds = new Set(getAllParsedIds());
  const w3gIds = new Set(getAllW3gIds());

  console.log('=== MANIFEST CHECK ===\n');
  console.log(`Manifest replays: ${manifestIds.length}`);

  const missingW3g = manifestIds.filter(id => !w3gIds.has(id));
  const missingParsed = manifestIds.filter(id => !parsedIds.has(id));

  if (missingW3g.length) {
    console.log(`\nMissing .w3g source (${missingW3g.length}):`);
    missingW3g.forEach(id => console.log(`  - ${id}`));
  }

  if (missingParsed.length) {
    console.log(`\nMissing .wc3v.gz output (${missingParsed.length}):`);
    missingParsed.forEach(id => console.log(`  - ${id}`));
  }

  // parsed but not in manifest
  const allParsed = getAllParsedIds();
  const manifestSet = new Set(manifestIds);
  const unlisted = allParsed.filter(id => !manifestSet.has(id) && !id.startsWith('test') && !id.startsWith('w3c-test'));
  if (unlisted.length) {
    console.log(`\nParsed but not in manifest (${unlisted.length}):`);
    unlisted.forEach(id => console.log(`  - ${id}`));
  }

  // Skill-band integrity: every curated build needs a valid `level` (the band
  // the homepage band-switch filters on) and `difficulty` pill value.
  const bandIssues = checkBuildBands();

  if (!missingW3g.length && !missingParsed.length && !unlisted.length && !bandIssues) {
    console.log('  All clear!');
  }
  console.log('');
}

// Validate `level` / `difficulty` (and optional `alsoShownIn`) on every build
// in builds-manifest.json. Returns the number of problems found.
function checkBuildBands() {
  const VALID_LEVELS = new Set(['new', 'improving', 'pro']);
  const VALID_DIFFS  = new Set(['easy', 'medium', 'hard']);
  const manifestPath = path.join(__dirname, '..', 'client', 'data', 'builds-manifest.json');
  let builds;
  try { builds = (JSON.parse(fs.readFileSync(manifestPath, 'utf8')).builds) || []; }
  catch (e) { console.log(`\n⚠  Could not read builds-manifest.json: ${e.message}`); return 1; }

  const problems = [];
  const warnings = [];
  const byBand = { new: 0, improving: 0, pro: 0 }; // effective membership (level OR alsoShownIn)
  const isStrArr = (v) => Array.isArray(v) && v.every(s => typeof s === 'string' && s.trim());
  const inBand = (b, band) => b.level === band || (Array.isArray(b.alsoShownIn) && b.alsoShownIn.includes(band));
  for (const b of builds) {
    const id = b.id || '(no id)';
    if (!VALID_LEVELS.has(b.level)) problems.push(`${id}: level "${b.level}" — must be new | improving | pro`);
    for (const band of ['new', 'improving', 'pro']) if (inBand(b, band)) byBand[band]++;
    if (!VALID_DIFFS.has(b.difficulty)) problems.push(`${id}: difficulty "${b.difficulty}" — must be easy | medium | hard`);
    if (b.alsoShownIn !== undefined) {
      if (!Array.isArray(b.alsoShownIn)) problems.push(`${id}: alsoShownIn must be an array`);
      else {
        for (const x of b.alsoShownIn) {
          if (!VALID_LEVELS.has(x)) problems.push(`${id}: alsoShownIn has invalid band "${x}"`);
          if (x === b.level) problems.push(`${id}: alsoShownIn lists its own band "${x}"`);
        }
      }
    }
    // Optional learner teaching fields — validate shape if present.
    if (b.beginnerNotes !== undefined && !isStrArr(b.beginnerNotes)) problems.push(`${id}: beginnerNotes must be an array of non-empty strings`);
    if (b.prerequisites !== undefined && !isStrArr(b.prerequisites)) problems.push(`${id}: prerequisites must be an array of non-empty strings`);
    if (b.commonMistakes !== undefined) {
      if (!Array.isArray(b.commonMistakes)) problems.push(`${id}: commonMistakes must be an array`);
      else b.commonMistakes.forEach((m, i) => {
        if (!m || typeof m !== 'object' || typeof m.mistake !== 'string' || typeof m.fix !== 'string') {
          problems.push(`${id}: commonMistakes[${i}] must be { mistake: string, fix: string }`);
        }
      });
    }
    if (b.recommendedReplayId !== undefined) {
      if (typeof b.recommendedReplayId !== 'string') problems.push(`${id}: recommendedReplayId must be a string`);
      else if (!(b.replays || []).some(r => r.replayId === b.recommendedReplayId)) {
        problems.push(`${id}: recommendedReplayId "${b.recommendedReplayId}" is not in this build's replays[]`);
      }
    }
    // Coverage warning (not a hard failure): anything that appears in the New
    // band (by level or via alsoShownIn) but has no beginner guidance renders a
    // bare learner card.
    if (inBand(b, 'new') && !(Array.isArray(b.beginnerNotes) && b.beginnerNotes.length)) {
      warnings.push(`${id}: appears in the New band but has no beginnerNotes (run: node tools/seed-starter-content.js)`);
    }
  }
  for (const band of ['new', 'improving', 'pro']) {
    if (!byBand[band]) problems.push(`band "${band}" has no builds`);
  }

  if (problems.length) {
    console.log(`\nBand issues (${problems.length}):`);
    problems.forEach(p => console.log(`  - ${p}`));
    console.log(`  (level/difficulty: node tools/backfill-levels.js · starter content: node tools/seed-starter-content.js)`);
  }
  if (warnings.length) {
    console.log(`\nBand warnings (${warnings.length}):`);
    warnings.forEach(w => console.log(`  - ${w}`));
  }
  console.log(`\nBand membership (incl. alsoShownIn): new=${byBand.new}  improving=${byBand.improving}  pro=${byBand.pro}`);
  return problems.length;
}

// --- main ---

async function main() {
  let targetIds = [];

  if (singleReplay) {
    targetIds = [singleReplay];
  }

  if (wantScan) {
    const newIds = scanNewReplays();
    if (!singleReplay) targetIds = newIds;
  }

  if (wantParse) {
    const toParse = singleReplay ? [singleReplay] : targetIds;
    await parseNewReplays(toParse);
  }

  if (wantSummary) {
    const toSummarize = singleReplay ? [singleReplay] : targetIds;
    // if no scan was done, summarize all parsed replays that aren't in manifest
    if (!wantScan && !singleReplay) {
      const parsedIds = getAllParsedIds();
      const manifestSet = new Set(getManifestReplayIds());
      const unlisted = parsedIds.filter(id => !manifestSet.has(id) && !id.startsWith('test') && !id.startsWith('w3c-test'));
      printSummary(unlisted);
    } else {
      printSummary(toSummarize);
    }
  }

  if (wantManifestCheck) {
    manifestCheck();
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
