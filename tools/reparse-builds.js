/**
 * reparse-builds.js — Reparse all pro replays referenced by builds-manifest.json.
 *
 * Run this after ANY server-side parser change (Hero.js, Player.js, mappings.js,
 * Building.js, etc.) to regenerate the .wc3v.gz files that the client reads.
 * The site only serves pre-parsed .wc3v.gz — if you don't reparse, clients will
 * still see old data regardless of code changes.
 *
 * Usage:
 *   node tools/reparse-builds.js              — reparse all build replays
 *   node tools/reparse-builds.js --dry-run    — list replays without parsing
 *   node tools/reparse-builds.js --debug      — reparse with debug output (keeps uncompressed .wc3v)
 *   node tools/reparse-builds.js --all        — also include replays not in builds-manifest
 *   node tools/reparse-builds.js --shard=2/6  — process only the 2nd of 6 round-robin
 *                                               slices (run N instances in parallel;
 *                                               each replay parse is an independent
 *                                               process so file-level sharding is safe)
 *
 * Source: reads replay IDs from client/data/builds-manifest.json
 * Input:  replays/{id}.w3g (raw replay files)
 * Output: client/replays/{id}.wc3v.gz (parsed JSON, gzipped)
 *
 * Reports per-player parse + validation confidence and prints a verbose
 * report for any replay where critical issues were detected or any player's
 * combined confidence dropped below LOW_CONFIDENCE_THRESHOLD.
 */

const fs = require('fs');
const path = require('path');

const LOW_CONFIDENCE_THRESHOLD = 0.85;

const manifestPath = path.join(__dirname, '..', 'client', 'data', 'builds-manifest.json');
const replaysDir = path.join(__dirname, '..', 'replays');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

const isAll = process.argv.includes('--all');

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

if (isAll) {
  // include every .w3g in replays/, not just manifest entries
  fs.readdirSync(replaysDir)
    .filter(f => f.endsWith('.w3g'))
    .forEach(f => {
      const id = path.basename(f, '.w3g');
      if (!id.startsWith('test-') && !id.startsWith('bad') && id !== 'w3c-test') {
        replayIds.add(id);
      }
    });
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

// --shard=K/N — keep only the K-th (1-based) round-robin slice of the
// available list so N instances can run in parallel.
const shardArg = (process.argv.find(a => a.startsWith('--shard=')) || '').replace('--shard=', '');
if (shardArg) {
  const m = /^(\d+)\/(\d+)$/.exec(shardArg);
  if (!m || +m[1] < 1 || +m[1] > +m[2]) {
    console.error(`Invalid --shard=${shardArg} (expected K/N with 1 <= K <= N)`);
    process.exit(1);
  }
  const shardK = +m[1], shardN = +m[2];
  const sliced = available.filter((_, i) => i % shardN === shardK - 1);
  console.log(`Shard ${shardK}/${shardN}: ${sliced.length} of ${available.length} replay(s)`);
  available.length = 0;
  available.push(...sliced);
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

function combinedConfidence (stats) {
  // multiply parser-internal confidence with validator confidence so a clean
  // parser run with a contradicting validator drops the score, and vice versa.
  // Clamp parseConfidence to [0,1] — Player.reduceParseConfidence can drive
  // it negative, which is meaningful as a flag but breaks the multiplication.
  const rawParse = stats.parseConfidence != null ? stats.parseConfidence : 1;
  const parseConf = Math.max(0, Math.min(1, rawParse));
  const validationConf = stats.validationConfidence != null ? stats.validationConfidence : 1;
  return parseConf * validationConf;
}

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
            const combined = combinedConfidence(stats);
            const parts = [
              `parse=${stats.parseConfidence != null ? stats.parseConfidence.toFixed(3) : '?'}`,
              `validation=${stats.validationConfidence != null ? stats.validationConfidence.toFixed(3) : '?'}`,
              `combined=${combined.toFixed(3)}`
            ];
            const ic = stats.issueCounts || {};
            const issueParts = [];
            if (ic.critical) issueParts.push(`${ic.critical}C`);
            if (ic.major)    issueParts.push(`${ic.major}M`);
            if (ic.minor)    issueParts.push(`${ic.minor}m`);
            if (ic.info)     issueParts.push(`${ic.info}i`);
            const issueStr = issueParts.length ? ` issues=[${issueParts.join('/')}]` : '';

            const flags = [];
            if (stats.supplyBumps > 0) flags.push(`${stats.supplyBumps} supply bumps`);
            if (stats.inferredBuildings > 0) flags.push(`${stats.inferredBuildings} inferred buildings`);
            const flagStr = flags.length ? ` [${flags.join(', ')}]` : '';

            console.log(`    P${pid} ${stats.name} (${stats.race}) ${parts.join(' ')}${issueStr}${flagStr}`);
          });
        }

        // flag replays with critical issues OR any player below threshold
        if (result.playerStats) {
          const issues = Object.entries(result.playerStats).filter(([, s]) => {
            const combined = combinedConfidence(s);
            const ic = s.issueCounts || {};
            return ic.critical > 0 ||
                   combined < LOW_CONFIDENCE_THRESHOLD ||
                   s.supplyBumps > 0 ||
                   s.inferredBuildings > 0;
          });
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
    console.log(`(threshold: combined confidence < ${LOW_CONFIDENCE_THRESHOLD}, or any critical issue)`);
    flagged.forEach(({ id, issues }) => {
      console.log(`\n  ${id}`);
      issues.forEach(s => {
        const combined = combinedConfidence(s);
        const ic = s.issueCounts || {};
        const reasons = [];
        if (ic.critical) reasons.push(`${ic.critical} critical`);
        if (ic.major)    reasons.push(`${ic.major} major`);
        if (combined < LOW_CONFIDENCE_THRESHOLD) reasons.push(`combined=${combined.toFixed(3)} below ${LOW_CONFIDENCE_THRESHOLD}`);
        if (s.supplyBumps > 0) reasons.push(`${s.supplyBumps} supply bumps`);
        if (s.inferredBuildings > 0) reasons.push(`${s.inferredBuildings} inferred buildings`);

        console.log(`    P${s.pid} ${s.name} (${s.race}) — ${reasons.join(', ')}`);

        // verbose validator output: print every critical/major warning
        const showLevels = new Set(['critical', 'major']);
        (s.warnings || [])
          .filter(w => showLevels.has(w.severity))
          .forEach(w => {
            console.log(`      [${w.severity.toUpperCase()}] ${w.type}: ${w.details}`);
          });
      });
    });

    // explicit critical-issue summary so it can't be missed in long output
    const withCritical = flagged.filter(f => f.issues.some(i => (i.issueCounts || {}).critical > 0));
    if (withCritical.length) {
      console.log(`\n!!! ${withCritical.length} replay(s) with CRITICAL validation issues !!!`);
      withCritical.forEach(({ id }) => console.log(`  - ${id}`));
      console.log('');
      console.log('These contradictions (e.g. tier-2 building before tier-2 upgrade) suggest');
      console.log('the parsed build order will be misleading. Investigate before publishing.');
    }
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
