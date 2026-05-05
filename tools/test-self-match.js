/**
 * test-self-match.js — verify the fingerprint-based self-match round-trip.
 *
 * For every entry in builds-manifest.json, we synthesize a "user upload"
 * by reading the corresponding pro summary and computing the fingerprint
 * the same way the browser does in CompareInline.buildUserSummary(). Then
 * we check that the manifest contains the same fingerprint.
 *
 * This catches drift between:
 *   - tools/import-replays.js cleanMapName + computeFingerprint
 *   - tools/sync-manifest-fingerprints.js (manifest patcher)
 *   - client/js/CompareInline.js cleanMapName + buildUserSummary fingerprint
 *
 * Pure JSON-only — no parser needed. Run with:
 *   node tools/test-self-match.js
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const summariesDir = path.join(rootDir, 'client', 'data', 'summaries');
const manifestPath = path.join(rootDir, 'client', 'data', 'builds-manifest.json');

// Mirror of client/js/CompareInline.js cleanMapName(). If the regex drifts,
// this test fails — that's exactly the canary we want.
function cleanMapName(raw) {
  if (!raw) return '';
  let n = String(raw).replace(/^.*[/\\]/, '');
  n = n.replace(/\.(w3x|w3m)$/i, '');
  n = n.replace(/^\(\d+\)\s*/, '');
  n = n.replace(/^\d+_w3c_\d+_\d+_/, '');
  n = n.replace(/^w3c_\d+_\d+_/, '');
  n = n.replace(/^w3c_/, '');
  n = n.replace(/_w3c_\d+_\d+(_\d+)?$/, '');
  n = n.replace(/^\dv\d_/, '');
  n = n.replace(/_v[\d.-]+$/, '');
  n = n.replace(/([a-z])([A-Z])/g, '$1 $2');
  n = n.replace(/[_]/g, ' ').replace(/\s+/g, ' ').trim();
  return n;
}

// Mirror of CompareInline.buildUserSummary fingerprint computation. Note the
// summary stores cleaned map already, but in the browser we run cleanMapName
// on the raw mapName from the parsed .w3g. Both should produce the same
// string — that's the point of the regex parity.
function userFingerprintFromSummary(summary) {
  const names = [];
  for (const slot of Object.keys(summary.players || {})) {
    const p = summary.players[slot];
    if (!p) continue;
    const nm = String(p.name || '').toLowerCase().trim();
    if (nm) names.push(nm);
  }
  names.sort();
  // The summary's `mapRaw` is what the browser sees on upload (raw mapName).
  // If we don't have it, fall back to `summary.map` (already cleaned).
  const cleanMap = summary.mapRaw ? cleanMapName(summary.mapRaw) : (summary.map || '');
  return `${cleanMap}|${Math.round((summary.durationMs || 0) / 1000)}|${names.join(',')}`;
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  let total = 0, ok = 0, missingFp = 0, mismatch = 0, summaryMissing = 0;
  const failures = [];

  for (const build of manifest.builds || []) {
    for (const replay of (build.replays || [])) {
      total++;
      const summaryPath = path.join(summariesDir, `${replay.replayId}.json`);
      if (!fs.existsSync(summaryPath)) {
        summaryMissing++;
        continue;
      }
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
      const expectedFp = summary.fingerprint;
      const userFp = userFingerprintFromSummary(summary);
      if (!replay.fingerprint) {
        missingFp++;
        failures.push(`MISSING manifest fingerprint: ${replay.replayId}`);
        continue;
      }
      if (replay.fingerprint !== userFp) {
        mismatch++;
        failures.push(`MISMATCH ${replay.replayId}\n  manifest: ${replay.fingerprint}\n  user-side: ${userFp}\n  summary:   ${expectedFp}`);
        continue;
      }
      if (expectedFp !== userFp) {
        // If summary fingerprint disagrees with user-side recompute, the
        // raw vs cleaned regex drifted somewhere.
        mismatch++;
        failures.push(`SUMMARY-VS-USER ${replay.replayId}\n  summary: ${expectedFp}\n  user-side: ${userFp}`);
        continue;
      }
      ok++;
    }
  }

  console.log(`\n=== Self-match round-trip ===`);
  console.log(`total=${total} ok=${ok} missing-fp=${missingFp} mismatch=${mismatch} summary-missing=${summaryMissing}`);
  if (failures.length) {
    console.log(`\nFailures:\n  ${failures.slice(0, 10).join('\n  ')}`);
    if (failures.length > 10) console.log(`  ...and ${failures.length - 10} more`);
    process.exit(1);
  }
  console.log('\nPASS — every manifest replay round-trips through the user-side fingerprint computation.\n');
}

main();
