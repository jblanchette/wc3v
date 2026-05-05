/**
 * sync-manifest-fingerprints.js — copy `fingerprint` from each pro summary
 * into the matching replay entry in builds-manifest.json.
 *
 * Run AFTER `node tools/import-replays.js --regen-summaries` so the summaries
 * have fresh `fingerprint` fields. This tool patches the manifest in place
 * and leaves all other curated fields (description, strategyPoints, tags,
 * etc.) untouched.
 *
 * Usage:
 *   node tools/sync-manifest-fingerprints.js
 *   node tools/sync-manifest-fingerprints.js --dry-run
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const summariesDir = path.join(rootDir, 'client', 'data', 'summaries');
const manifestPath = path.join(rootDir, 'client', 'data', 'builds-manifest.json');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});
const dryRun = !!args['dry-run'];

function readSummaryFingerprint(replayId) {
  const p = path.join(summariesDir, `${replayId}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return j.fingerprint || null;
  } catch (e) {
    return null;
  }
}

function main() {
  console.log(`\n=== SYNC MANIFEST FINGERPRINTS${dryRun ? ' (DRY RUN)' : ''} ===\n`);

  if (!fs.existsSync(manifestPath)) {
    console.error(`Manifest not found: ${manifestPath}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  if (!Array.isArray(manifest.builds)) {
    console.error('Manifest has no builds[] — aborting.');
    process.exit(1);
  }

  let total = 0, updated = 0, missing = 0, unchanged = 0;
  for (const build of manifest.builds) {
    for (const replay of (build.replays || [])) {
      total++;
      if (!replay.replayId) { missing++; continue; }
      const fp = readSummaryFingerprint(replay.replayId);
      if (!fp) {
        console.log(`  no summary for ${replay.replayId}`);
        missing++;
        continue;
      }
      if (replay.fingerprint === fp) {
        unchanged++;
        continue;
      }
      replay.fingerprint = fp;
      updated++;
      console.log(`  ${replay.replayId} -> ${fp}`);
    }
  }

  if (!dryRun && updated > 0) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`\nWrote manifest with ${updated} updated entries.`);
  }
  console.log(`\nDone. total=${total} updated=${updated} unchanged=${unchanged} missing=${missing}\n`);
}

main();
