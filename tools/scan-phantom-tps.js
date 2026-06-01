/*
 * scan-phantom-tps — sweep already-parsed .wc3v.gz files in
 * client/replays/ and print every teleport claim with its confidence
 * and evidence breakdown.
 *
 * Useful for:
 *   1. Initial fixture bucketing — categorising replays into
 *      must-keep / must-reject buckets for tests/fixtures/teleport/.
 *   2. Regression monitoring — after a strategy tweak, sweep the full
 *      replay set and diff the verdict distribution.
 *   3. Investigation — given a teleport that looks wrong, dump the
 *      evidence to figure out which strategies fired.
 *
 * Usage:
 *   node tools/scan-phantom-tps.js                  # sweep all replays
 *   node tools/scan-phantom-tps.js --filter=PATTERN # only replays
 *                                                   # matching substring
 *   node tools/scan-phantom-tps.js --confidence=rejected   # only rejected
 *   node tools/scan-phantom-tps.js --replay=NAME    # one specific replay
 *
 * Does NOT re-parse — reads the already-written .wc3v.gz output. Run
 * `node wc3v.js --replay=NAME` first to refresh.
 */

const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

const REPLAY_DIR = path.join(__dirname, '..', 'client', 'replays');

function parseArgs () {
  const out = {};
  for (const a of process.argv.slice(2)) {
    if (!a.startsWith('--')) continue;
    const [k, v] = a.substring(2).split('=');
    out[k] = v == null ? true : v;
  }
  return out;
}

function formatTime (ms) {
  const totalSec = Math.floor((ms || 0) / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function loadReplay (filename) {
  const buf = fs.readFileSync(path.join(REPLAY_DIR, filename));
  return JSON.parse(zlib.gunzipSync(buf).toString());
}

function listReplays (filterPattern) {
  const files = fs.readdirSync(REPLAY_DIR)
    .filter(f => f.endsWith('.wc3v.gz'));
  if (!filterPattern) return files;
  const needle = String(filterPattern).toLowerCase();
  return files.filter(f => f.toLowerCase().includes(needle));
}

function main () {
  const args = parseArgs();
  const confFilter = args.confidence || null;

  let files;
  if (args.replay) {
    files = [args.replay.endsWith('.wc3v.gz') ? args.replay : `${args.replay}.wc3v.gz`];
  } else {
    files = listReplays(args.filter);
  }
  if (!files.length) {
    console.log('No replays matched.');
    process.exit(0);
  }

  let totalTeleports = 0;
  let totalRejected = 0;
  let totalLikely = 0;
  let totalConfirmed = 0;
  let totalPossible = 0;

  for (const f of files.sort()) {
    let data;
    try {
      data = loadReplay(f);
    } catch (e) {
      console.log(`  [skip] ${f}: ${e.message}`);
      continue;
    }
    const playerEntries = [];
    for (const [pid, p] of Object.entries(data.players || {})) {
      if (p.isNeutralPlayer) continue;
      const tps = p.teleportEvents || [];
      if (!tps.length) continue;
      const meta = (data.replay && data.replay.players && data.replay.players[pid]) || {};
      const rows = [];
      for (const tp of tps) {
        const conf = tp.inferenceConfidence || 'unknown';
        if (confFilter && conf !== confFilter) continue;
        totalTeleports++;
        if (conf === 'rejected')   totalRejected++;
        if (conf === 'unlikely')   totalRejected++;
        if (conf === 'possible')   totalPossible++;
        if (conf === 'likely')     totalLikely++;
        if (conf === 'confirmed')  totalConfirmed++;
        rows.push({ tp, conf, pid, name: meta.name || `p${pid}` });
      }
      if (rows.length) playerEntries.push(...rows);
    }
    if (!playerEntries.length) continue;
    console.log(`\n${f}`);
    for (const { tp, conf, name } of playerEntries) {
      const cast = formatTime(tp.gameTime);
      const orig = tp.origin    ? `(${Math.round(tp.origin.x)},${Math.round(tp.origin.y)})` : '?';
      const dest = tp.destination ? `(${Math.round(tp.destination.x)},${Math.round(tp.destination.y)})` : '?';
      const flag = (conf === 'rejected' || conf === 'unlikely') ? '✗' : '✓';
      console.log(`  ${flag} ${name.padEnd(20)} ${tp.abilityCode.padEnd(5)} ${cast.padStart(5)}  ` +
                  `${orig} → ${dest}  [${conf}]`);
      const negative = (tp.evidenceSummary || []).filter(e => e.weight < 0);
      const positive = (tp.evidenceSummary || []).filter(e => e.weight > 0);
      for (const e of negative) {
        console.log(`        ${e.weight.toFixed(2)}  ${e.source}`);
      }
      if (conf === 'possible' && positive.length === 0 && negative.length === 0) {
        console.log(`        (no evidence emitted)`);
      }
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Replays scanned: ${files.length}`);
  console.log(`Total teleports: ${totalTeleports}`);
  console.log(`  confirmed:     ${totalConfirmed}`);
  console.log(`  likely:        ${totalLikely}`);
  console.log(`  possible:      ${totalPossible}`);
  console.log(`  unlikely/rej:  ${totalRejected}`);
}

main();
