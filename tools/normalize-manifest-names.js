#!/usr/bin/env node
// normalize-manifest-names.js — make playerName / opponentName in
// client/data/builds-manifest.json reflect the official pro name
// (PlayerNames.js) of whoever actually played that replay slot.
//
// For replays we have a summary for (client/data/summaries/{replayId}.json),
// the name is re-derived from the summary's player roster — that's the
// authoritative source and survives later alias-map changes. For replays
// without a summary, the stored value is just run through
// PlayerNames.canonical().
//
// Usage:
//   node tools/normalize-manifest-names.js            # rewrite in place
//   node tools/normalize-manifest-names.js --dry-run  # report only, no write

const fs = require('fs');
const path = require('path');
const PlayerNames = require('../client/js/PlayerNames.js');

const MANIFEST = path.join(__dirname, '..', 'client', 'data', 'builds-manifest.json');
const SUMMARY_DIR = path.join(__dirname, '..', 'client', 'data', 'summaries');
const dryRun = process.argv.includes('--dry-run');

// Lazily-loaded { replayId -> { players: { slot: {name,...} } } }.
const summaryCache = new Map();
function loadSummary (replayId) {
  if (!replayId || /[\\/]/.test(replayId)) return null;
  if (summaryCache.has(replayId)) return summaryCache.get(replayId);
  let summary = null;
  try {
    summary = JSON.parse(fs.readFileSync(path.join(SUMMARY_DIR, replayId + '.json'), 'utf8'));
  } catch (e) { summary = null; }
  summaryCache.set(replayId, summary);
  return summary;
}

// Resolve (canonical playerName, canonical opponentName) for a manifest
// replay entry, preferring the summary roster when available.
function resolveNames (r) {
  const summary = loadSummary(r.replayId);
  if (summary && summary.players) {
    const slots = Object.keys(summary.players).filter(s => summary.players[s] && !summary.players[s].isNeutralPlayer);
    const mySlot = String(r.playerSlot != null ? r.playerSlot : (slots[0] || ''));
    const oppSlot = slots.find(s => s !== mySlot);
    const mine = summary.players[mySlot] && summary.players[mySlot].name;
    const opp = oppSlot != null ? (summary.players[oppSlot] && summary.players[oppSlot].name) : null;
    return {
      playerName: mine ? PlayerNames.canonical(mine) : PlayerNames.canonical(r.playerName),
      opponentName: opp ? PlayerNames.canonical(opp) : PlayerNames.canonical(r.opponentName),
      source: 'summary'
    };
  }
  return {
    playerName: PlayerNames.canonical(r.playerName),
    opponentName: PlayerNames.canonical(r.opponentName),
    source: 'alias'
  };
}

const raw = fs.readFileSync(MANIFEST, 'utf8');
const manifest = JSON.parse(raw);

const changes = [];
let touched = 0;

for (const build of (manifest.builds || [])) {
  for (const r of (build.replays || [])) {
    const resolved = resolveNames(r);
    for (const field of ['playerName', 'opponentName']) {
      const before = r[field];
      const after = resolved[field];
      // Don't blow away a non-empty name with an empty one (e.g. summary
      // missing the opponent slot for a weird record).
      if (!after && before) continue;
      if (typeof after === 'string' && after !== before) {
        changes.push(`${build.id} · ${r.replayId || '?'} · ${field}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}  (${resolved.source})`);
        r[field] = after;
        touched++;
      }
    }
  }
}

if (!changes.length) {
  console.log('builds-manifest.json: all player names already canonical — nothing to do.');
  process.exit(0);
}

console.log(`${changes.length} name field${changes.length === 1 ? '' : 's'} ${dryRun ? 'would be ' : ''}rewritten:`);
for (const c of changes) console.log('  ' + c);

if (dryRun) {
  console.log('\n(dry run — no file written)');
  process.exit(0);
}

fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`\nWrote ${MANIFEST} (${touched} field${touched === 1 ? '' : 's'} updated).`);
