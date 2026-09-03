/**
 * tools/winloss-audit.js — grade the match-outcome verdict against
 * warcraft3.info's own recorded winner.
 *
 * The crawl corpus is the only ground truth this project has for who actually
 * won a game. `crawl/crawl-manifest.jsonl` carries the site's `winner` (a team
 * number matching that record's `players[].team`) and its weaker
 * `detectedWinner`; `crawl/ingest-log.jsonl` links each source record to the
 * replayId used as the local filename. So for every locally parsed game that
 * came from the crawl we can ask the only question that matters: does
 * helpers/utils.computeWinner name the same person?
 *
 * It grades the LIVE function rather than the verdict frozen into the stored
 * .wc3v, by re-running `computeWinner` over that file's `replay` block (which
 * carries the leave records and the slot records, everything the function
 * reads). So a change to the outcome logic is graded in seconds without
 * re-parsing 650 replays, and the harness cannot drift from the shipping code.
 *
 *   node tools/winloss-audit.js                 grade against the recorded winner
 *   node tools/winloss-audit.js --detected      also use the site's own detector
 *   node tools/winloss-audit.js --table         derive the leave-code table
 *   node tools/winloss-audit.js --wrong         list only disagreements
 *   node tools/winloss-audit.js --list          list every graded game
 *   node tools/winloss-audit.js --limit=N
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const utils = require('../helpers/utils.js');

const ROOT = path.join(__dirname, '..');
const arg = (k, d) => {
  const hit = process.argv.find(a => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const flag = (k) => process.argv.includes(`--${k}`);
const USE_DETECTED = flag('detected');

const readJsonl = (file, onRow) => {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { onRow(JSON.parse(t)); } catch (e) { /* partial write at the tail */ }
  }
};

// sourceId → the site's record for that replay.
const manifest = new Map();
const manifestFiles = [path.join(ROOT, 'crawl', 'crawl-manifest.jsonl')];
const dlDir = path.join(ROOT, 'crawl', 'download');
if (fs.existsSync(dlDir)) {
  for (const f of fs.readdirSync(dlDir)) {
    if (f.endsWith('.jsonl')) manifestFiles.push(path.join(dlDir, f));
  }
}
for (const f of manifestFiles) {
  readJsonl(f, row => { if (row && row.sourceId != null) manifest.set(row.sourceId, row); });
}

// replayId (the local filename base) → sourceId
const idOf = new Map();
readJsonl(path.join(ROOT, 'crawl', 'ingest-log.jsonl'), row => {
  if (row && row.replayId && row.sourceId != null) idOf.set(row.replayId, row.sourceId);
});

// warcraft3.info handles carry the battletag; a parsed name may not. Compare on
// the part before '#' as well, so "Moon" matches "Moon#35134".
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
const keysOf = (s) => { const n = norm(s); return [n, n.split('#')[0]]; };
const sameName = (a, b) => {
  const B = keysOf(b);
  return keysOf(a).some(x => B.indexOf(x) !== -1);
};

const repDir = path.join(ROOT, 'client', 'replays');
const limit = +arg('limit', 0);

const stats = {};
const table = {};   // "reason=.. result=.." -> { won, lost }
const rows = [];
let matched = 0;

for (const f of fs.readdirSync(repDir).filter(x => x.endsWith('.wc3v.gz'))) {
  if (limit && matched >= limit) break;
  const sourceId = idOf.get(f.replace(/\.wc3v\.gz$/, ''));
  if (sourceId == null) continue;
  const rec = manifest.get(sourceId);
  if (!rec || !Array.isArray(rec.players)) continue;
  const truthTeam = rec.winner != null ? rec.winner : (USE_DETECTED ? rec.detectedWinner : null);
  if (truthTeam == null) continue;

  let data;
  try {
    data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(repDir, f))));
  } catch (e) { continue; }
  if (!data.replay) continue;

  const truthWinners = rec.players.filter(p => p.team === truthTeam).map(p => p.handle);
  if (!truthWinners.length) continue;
  matched++;

  // Names live on replay.players; data.players is the simulator's block and
  // carries no name at all.
  const named = (data.replay && data.replay.players) || {};

  // The seat-level table, which is where the decoding of the result codes
  // comes from in the first place.
  for (const s of utils.seatOutcomes(data.replay)) {
    const nm = named[s.playerId] && named[s.playerId].name;
    if (!nm || !rec.players.some(p => sameName(p.handle, nm))) continue;
    const k = `reason=${s.reason} result=${s.result}`;
    const b = table[k] || (table[k] = { won: 0, lost: 0 });
    if (truthWinners.some(w => sameName(w, nm))) b.won++; else b.lost++;
  }

  const w = utils.computeWinner(data.replay, data.players || {});
  const method = w ? w.method : 'none';
  const bucket = stats[method] || (stats[method] = { n: 0, right: 0, wrong: 0, unmatched: 0 });
  bucket.n++;

  let verdict = 'unresolved';
  let said = null;
  if (w) {
    // Every seat the verdict puts on the winning team, so a team game grades
    // as one answer rather than one per player.
    const saidNames = (w.playerIds && w.playerIds.length ? w.playerIds : [w.playerId])
      .map(pid => named[pid] && named[pid].name)
      .filter(Boolean);
    said = saidNames.join(',') || String(w.playerId);
    const known = saidNames.filter(n => rec.players.some(p => sameName(p.handle, n)));
    if (!known.length) { verdict = 'name-unmatched'; bucket.unmatched++; }
    else if (known.some(n => truthWinners.some(t => sameName(t, n)))) { verdict = 'correct'; bucket.right++; }
    else { verdict = 'WRONG'; bucket.wrong++; }
  }
  rows.push({ base: f.replace(/\.wc3v\.gz$/, ''), method, conf: w && w.confidence, verdict, said,
    truth: truthWinners.join(','), mode: data.gameMode });
}

if (flag('table')) {
  console.log('=== leave-block (reason,result) → outcome, from ground truth ===\n');
  console.log('pair'.padEnd(38) + 'won'.padEnd(7) + 'lost');
  Object.entries(table)
    .sort((a, b) => (b[1].won + b[1].lost) - (a[1].won + a[1].lost))
    .forEach(([k, v]) => console.log(k.padEnd(38) + String(v.won).padEnd(7) + v.lost));
  console.log('');
}

let show = rows;
if (flag('wrong')) show = show.filter(r => r.verdict === 'WRONG');
if (flag('list') || flag('wrong')) {
  for (const r of show) {
    console.log(`${r.verdict.padEnd(14)} ${String(r.method).padEnd(12)}${String(r.conf).padEnd(8)}` +
      `said=${String(r.said).padEnd(24)} truth=${r.truth.padEnd(24)} ${r.base}`);
  }
  console.log('');
}

console.log('=== win/loss audit ===');
console.log(`graded: ${matched} game(s)${USE_DETECTED ? ", incl. the site's own detector" : ''}\n`);
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('method', 14) + pad('n', 7) + pad('correct', 9) + pad('wrong', 7) + pad('accuracy', 10) + 'name-unmatched');
for (const [m, b] of Object.entries(stats).sort((a, b) => b[1].n - a[1].n)) {
  const g = b.right + b.wrong;
  console.log(pad(m, 14) + pad(b.n, 7) + pad(b.right, 9) + pad(b.wrong, 7) +
    pad(g ? `${(100 * b.right / g).toFixed(1)}%` : '—', 10) + b.unmatched);
}
const tot = Object.values(stats).reduce(
  (a, b) => ({ right: a.right + b.right, wrong: a.wrong + b.wrong }), { right: 0, wrong: 0 });
const g = tot.right + tot.wrong;
const unresolved = rows.filter(r => r.method === 'none').length;
console.log(`\noverall: ${tot.right}/${g} = ${g ? (100 * tot.right / g).toFixed(1) : '—'}%` +
  `   unresolved (no verdict published): ${unresolved} of ${matched}`);
if (tot.wrong) {
  console.log('\nA wrong verdict is the bug this file exists to catch. Run --wrong.');
  // Only the human-entered `winner` is authoritative. `detectedWinner` is the
  // site's own detection and is a port of the w3gjs rule this code replaces,
  // so a disagreement under --detected is evidence about the oracle as much as
  // about us: both of the two it flags are games where the replay's own leave
  // blocks say result=09 for one seat and result=07 for the other, which is
  // not ambiguous. Failing the build on those would pin us to the old bug.
  if (!USE_DETECTED) process.exitCode = 1;
}
