/**
 * Reparses all replays referenced by builds in the builds-manifest.json.
 *
 * Usage:
 *   node tools/reparse-builds.js            — reparse all build replays
 *   node tools/reparse-builds.js --dry-run   — list replays without parsing
 *   node tools/reparse-builds.js --debug     — reparse with debug output (keeps uncompressed .wc3v)
 */

const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, '..', 'client', 'data', 'builds-manifest.json');
const replaysDir = path.join(__dirname, '..', 'replays');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

// extract unique replayIds from all builds
const replayIds = new Set();
for (const build of manifest.builds) {
  if (build.replays && build.replays.length) {
    for (const r of build.replays) {
      if (r.replayId) {
        replayIds.add(r.replayId);
      }
    }
  }
}

const uniqueIds = [...replayIds].sort();

if (uniqueIds.length === 0) {
  console.log('No replays found in builds-manifest.json');
  process.exit(0);
}

const isDryRun = process.argv.includes('--dry-run');
const isDebug = process.argv.includes('--debug');

// check which replays have source .w3g files
const missing = [];
const available = [];

for (const id of uniqueIds) {
  const w3gPath = path.join(replaysDir, `${id}.w3g`);
  if (fs.existsSync(w3gPath)) {
    available.push(id);
  } else {
    missing.push(id);
  }
}

console.log(`Found ${uniqueIds.length} unique replay(s) across ${manifest.builds.length} builds`);
console.log(`  Available: ${available.length}`);
if (missing.length) {
  console.log(`  Missing .w3g: ${missing.length}`);
  missing.forEach(id => console.log(`    - ${id}`));
}
console.log('');

if (isDryRun) {
  console.log('Replays to parse:');
  available.forEach(id => console.log(`  ${id}`));
  process.exit(0);
}

if (available.length === 0) {
  console.log('No source .w3g files found to parse.');
  process.exit(1);
}

const { parseReplays } = require('../wc3v');
const config = require('../config/config');

async function main() {
  if (isDebug) {
    config.debugOutput = true;
  }

  let passed = 0;
  let failed = 0;
  const flagged = [];

  for (const id of available) {
    console.log(`\n--- Parsing: ${id} ---`);
    try {
      const results = await parseReplays({
        paths: [`./replays/${id}.w3g`],
        hashes: [null],
        jsonPadding: isDebug ? 4 : 0,
        isProduction: !isDebug,
        inTestMode: false
      });

      const result = results[0];
      if (result && result.passed) {
        console.log(`  OK: ${id}`);
        passed++;

        // display per-player confidence and supply stats
        if (result.playerStats) {
          Object.entries(result.playerStats).forEach(([pid, stats]) => {
            const conf = stats.parseConfidence != null ? stats.parseConfidence.toFixed(4) : '?';
            const flags = [];
            if (stats.supplyBumps > 0) flags.push(`${stats.supplyBumps} supply bumps`);
            if (stats.inferredBuildings > 0) flags.push(`${stats.inferredBuildings} inferred buildings`);
            const flagStr = flags.length ? ` [${flags.join(', ')}]` : '';
            console.log(`    P${pid} ${stats.name} (${stats.race}) confidence=${conf}${flagStr}`);
          });
        }

        // flag replays with supply issues or low confidence
        if (result.playerStats) {
          const issues = Object.entries(result.playerStats).filter(([, s]) =>
            s.supplyBumps > 0 || s.inferredBuildings > 0 || (s.parseConfidence != null && s.parseConfidence < 0.95)
          );
          if (issues.length) {
            flagged.push({ id, issues: issues.map(([pid, s]) => ({ pid, ...s })) });
          }
        }
      } else {
        console.log(`  FAILED: ${id} — ${result ? result.error : 'unknown error'}`);
        failed++;
      }
    } catch (e) {
      console.log(`  ERROR: ${id} — ${e.message}`);
      failed++;
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`  Passed: ${passed}/${available.length}`);
  if (failed) {
    console.log(`  Failed: ${failed}`);
  }

  if (flagged.length) {
    console.log(`\n=== FLAGGED REPLAYS (${flagged.length}) ===`);
    flagged.forEach(({ id, issues }) => {
      console.log(`  ${id}:`);
      issues.forEach(s => {
        const conf = s.parseConfidence != null ? s.parseConfidence.toFixed(4) : '?';
        const details = [];
        if (s.supplyBumps > 0) details.push(`${s.supplyBumps} supply bumps`);
        if (s.inferredBuildings > 0) details.push(`${s.inferredBuildings} inferred buildings`);
        if (s.parseConfidence != null && s.parseConfidence < 0.95) details.push(`low confidence`);
        console.log(`    P${s.pid} ${s.name} (${s.race}) confidence=${conf} — ${details.join(', ')}`);
      });
    });
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
