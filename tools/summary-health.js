/**
 * summary-health.js — find shipped replay summaries that parsed to nothing,
 * and say WHY.
 *
 * A `.wc3v.gz` in client/replays/ with fewer than two players is a summary the
 * viewer cannot render: no seats, no build orders, and computeGameMode answers
 * 'custom' for the empty map, so the match header calls a 1v1 a custom game.
 * Nothing errors — it is valid JSON of a game with nobody in it — which is how
 * these sat in the shipped corpus unnoticed.
 *
 * The cause is almost never the summary. It is `replay.parseTruncated`, and
 * overwhelmingly `reason: 'missing-map-data'`: the replay names a map that
 * helpers/mapResolver cannot resolve to anything in client/maps, so the whole
 * game-data pass is skipped and the export has a header and nothing else.
 * Re-parsing such a replay produces the same empty file, which is why this
 * reports the missing MAPS rather than just the broken replays. Import those
 * and the replays fix themselves.
 *
 * `--fix` re-parses only the ones whose map DOES resolve, since those are the
 * only ones a re-parse can help. Nothing is deleted: a replay that still comes
 * back empty keeps the file it had.
 *
 * Usage:
 *   node tools/summary-health.js
 *   node tools/summary-health.js --verbose
 *   node tools/summary-health.js --maps          just the missing map list
 *   node tools/summary-health.js --fix [--limit=N]
 *
 * Exit 1 when anything is still broken.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const mapResolver = require('../helpers/mapResolver');
const { mapDataByFile } = require('../helpers/mappings');

const ROOT = path.resolve(__dirname, '..');
const WC3V_DIR = path.join(ROOT, 'client', 'replays');
const W3G_DIR = path.join(ROOT, 'replays');

const args = {};
process.argv.slice(2).forEach((raw) => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});
const doFix = !!args.fix;
const verbose = !!args.verbose;
const mapsOnly = !!args.maps;
const limit = Number(args.limit || 0);

/** The bare map file name, as the resolver wants it. */
const mapFileOf = (raw) => String(raw || '').split(/[\\/]/).pop() || '';

const inspect = (name) => {
  const gz = path.join(WC3V_DIR, name + '.wc3v.gz');
  let json;
  try {
    json = JSON.parse(zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8'));
  } catch (e) {
    return { name, unreadable: (e && e.message) || String(e), broken: true };
  }

  const players = (json && json.players) || {};
  const real = Object.values(players).filter((p) => p && !p.isNeutralPlayer);
  const replay = (json && json.replay) || {};
  const truncated = replay.parseTruncated || null;
  const rawMap = (replay.metadata && replay.metadata.map && replay.metadata.map.mapName) || null;

  let resolved = null;
  if (rawMap) {
    try { resolved = mapResolver.resolveMapDataName(rawMap, mapDataByFile); } catch (e) { resolved = null; }
  }

  // How much of the game the parse actually reached. A summary can carry its
  // players and still be missing the entire match: the header names them, and
  // a throw in an action handler ends the game-data pass right there. Counting
  // players alone called exactly that case healthy.
  const lenMs = (truncated && truncated.replayLengthMs) || 0;
  const gotMs = truncated ? Math.max(0, lenMs - (truncated.missingMs || 0)) : null;
  const coverage = (truncated && lenMs) ? gotMs / lenMs : 1;

  return {
    name,
    players: real.length,
    gameMode: json && json.gameMode,
    truncated: !!truncated,
    coverage,
    reason: truncated && truncated.reason,
    rawMap,
    mapFile: mapFileOf(rawMap),
    resolved,
    hasSource: fs.existsSync(path.join(W3G_DIR, name + '.w3g')),
    // A dev fixture, not shipped content. Same primary signal gen-seo uses to
    // keep them out of the public replay index: real tournament games are
    // <digits>_<player>_<player>_<map>. gen-seo ORs that with "two raced
    // players and five minutes", which cannot help here — a summary that
    // parsed to nothing has no players to count.
    isFixture: !/^\d{6,}_/.test(name),
    broken: real.length < 2
  };
};

const names = fs.readdirSync(WC3V_DIR)
  .filter((f) => f.endsWith('.wc3v.gz'))
  .map((f) => f.replace(/\.wc3v\.gz$/, ''));

const rows = names.map(inspect);
const fixtures = rows.filter((r) => r.isFixture);
const real = rows.filter((r) => !r.isFixture);
const bad = real.filter((r) => r.broken);

// Group the broken ones by the map they could not resolve.
const byMap = new Map();
const otherReason = [];
for (const r of bad) {
  if (r.resolved || !r.mapFile) { otherReason.push(r); continue; }
  if (!byMap.has(r.mapFile)) byMap.set(r.mapFile, []);
  byMap.get(r.mapFile).push(r);
}
const missingMaps = [...byMap.entries()].sort((a, b) => b[1].length - a[1].length);

if (mapsOnly) {
  for (const [m] of missingMaps) console.log(m);
  process.exit(missingMaps.length ? 1 : 0);
}

console.log('summary-health: ' + real.length + ' shipped summaries (' + fixtures.length + ' dev fixtures ignored)');
console.log('  unusable (under 2 players): ' + bad.length);
console.log('  of those, blocked on a map that does not resolve: ' + (bad.length - otherReason.length));
console.log('  distinct maps missing: ' + missingMaps.length);

if (missingMaps.length) {
  console.log('\nImport these maps and the replays under each fix themselves:');
  for (const [m, rs] of missingMaps) {
    console.log('  ' + String(rs.length).padStart(4) + '  ' + m);
    if (verbose) for (const r of rs) console.log('          ' + r.name);
  }
}

// Summaries that DO have players but stop early. Ranked by how much of the
// game is missing, because a parse that died at 0:00 and one that died in the
// last minute are not the same problem.
const cut = real
  .filter((r) => !r.broken && r.truncated && r.coverage < 0.995)
  .sort((a, b) => a.coverage - b.coverage);

if (cut.length) {
  console.log('\nParsed but cut short (' + cut.length + '), worst first:');
  for (const r of cut.slice(0, verbose ? cut.length : 15)) {
    console.log('  ' + (Math.round(r.coverage * 1000) / 10 + '%').padStart(7) +
                ' of the game  ' + String(r.reason || '').slice(0, 44).padEnd(46) + r.name);
  }
  if (!verbose && cut.length > 15) console.log('  ... ' + (cut.length - 15) + ' more, --verbose for all');
}

if (otherReason.length) {
  console.log('\nBroken for another reason (' + otherReason.length + '):');
  for (const r of otherReason) {
    console.log('  ' + (r.unreadable ? 'unreadable' : (r.reason || 'no parseTruncated') + ', ' + r.players + ' players') +
                '  ' + r.name);
  }
}

if (!bad.length) process.exit(0);

if (!doFix) {
  const retryable = otherReason.filter((r) => r.hasSource && !r.unreadable);
  console.log('\n' + retryable.length + ' could be re-parsed here (their map resolves): --fix to try');
  process.exit(1);
}

// ── fix ──────────────────────────────────────────────────────────────────
// Straight through wc3v.js, the same path that produced every other file in
// this directory. Deliberately NOT generate-summary --all, which writes a
// different shape and drops the fingerprint the manifest keys on.
const fixable = otherReason.filter((r) => r.hasSource && !r.unreadable).slice(0, limit || undefined);
if (!fixable.length) {
  console.log('\nNothing to re-parse: every broken summary is waiting on a map.');
  process.exit(1);
}

console.log('\nre-parsing ' + fixable.length + ' replay(s)');
const stillBad = [];
let fixed = 0;
for (const r of fixable) {
  process.stdout.write('  ' + r.name.slice(0, 56).padEnd(58));
  const run = spawnSync(process.execPath, ['wc3v.js', '--replay=' + r.name], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28
  });
  if (run.status !== 0) {
    console.log('parse FAILED');
    if (verbose) console.log((run.stderr || '').split('\n').slice(-4).join('\n'));
    stillBad.push(r.name);
    continue;
  }
  const after = inspect(r.name);
  if (after.broken) {
    console.log('still ' + after.players + ' players (' + (after.reason || 'no reason given') + ')');
    stillBad.push(r.name);
  } else {
    console.log('ok  ' + after.players + ' players, ' + after.gameMode);
    fixed++;
  }
}

console.log('\nfixed ' + fixed + ', still unusable ' + stillBad.length);
for (const n of stillBad) console.log('   ' + n);
process.exit(stillBad.length ? 1 : 0);
