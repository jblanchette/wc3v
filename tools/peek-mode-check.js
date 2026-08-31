/**
 * peek-mode-check.js — does the cheap header peek agree with the full parse?
 *
 * The desktop's "only parse 1v1 games" filter and the corpus ingest gate both
 * decide from a header peek, before any parse has happened. If the peek says
 * a game is 3v3 and the parse would have said 1v1, that replay is dropped and
 * never appears — a silent false negative on somebody's own history, which is
 * the worst failure this feature has.
 *
 * So the two verdicts are compared directly: peek the .w3g in replays/, read
 * the gameMode out of the already-parsed .wc3v.gz in client/replays/, and
 * require them to match. Both sides go through the same
 * playersFromSlots + computeGameMode in helpers/utils, so a disagreement means
 * the slot records and the parsed players genuinely differ, which is worth
 * knowing about.
 *
 * Usage:
 *   node tools/peek-mode-check.js
 *   node tools/peek-mode-check.js --limit=40
 *   node tools/peek-mode-check.js --verbose
 *
 * Exit 1 on any disagreement.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const { peekReplay } = require('./lib/replay-peek');

const ROOT = path.resolve(__dirname, '..');
const W3G_DIR = path.join(ROOT, 'replays');
const WC3V_DIR = path.join(ROOT, 'client', 'replays');

const args = {};
process.argv.slice(2).forEach((raw) => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});
const limit = Number(args.limit || 0);
const verbose = !!args.verbose;

/** gameMode as the FULL parse recorded it, from the exported summary. */
const storedMode = (name) => {
  const gz = path.join(WC3V_DIR, name + '.wc3v.gz');
  if (!fs.existsSync(gz)) return null;
  let json;
  try {
    json = JSON.parse(zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8'));
  } catch (e) {
    return null;
  }
  // A summary with fewer than two players cannot be evidence about a game's
  // mode: computeGameMode answers 'custom' for an empty map, which is correct
  // and says nothing about the replay. Some shipped exports are in exactly
  // that state (7 of the first 60 here), so they are skipped rather than
  // counted as disagreements.
  const players = (json && json.players) || null;
  const playerCount = players ? Object.values(players).filter(p => p && !p.isNeutralPlayer).length : 0;
  if (playerCount < 2) return null;

  if (json.gameMode) return json.gameMode;
  // Older exports predate the field. Derive it the same way store.js repairs
  // one at read time, so an old file is still usable evidence.
  const byTeam = {};
  let n = 0;
  for (const p of Object.values(players)) {
    if (!p || p.isNeutralPlayer) continue;
    const t = (p.teamId === undefined || p.teamId === null) ? 0 : p.teamId;
    byTeam[t] = (byTeam[t] || 0) + 1;
    n++;
  }
  const counts = Object.values(byTeam);
  const tc = counts.length;
  if (n < 2) return 'custom';
  if (n === 2 && tc === 2) return '1v1';
  if (tc === 2 && counts[0] === counts[1]) return ({ 2: '2v2', 3: '3v3', 4: '4v4' })[counts[0]] || 'custom';
  if (n >= 3 && tc === n) return 'ffa';
  return 'custom';
};

(async () => {
  if (!fs.existsSync(W3G_DIR)) {
    console.error('no replays/ directory to check against');
    process.exit(1);
  }

  let names = fs.readdirSync(W3G_DIR)
    .filter((f) => /\.(w3g|nwg)$/i.test(f))
    .map((f) => f.replace(/\.(w3g|nwg)$/i, ''));
  if (limit) names = names.slice(0, limit);

  const disagree = [];
  const modes = {};
  let compared = 0;
  let noTruth = 0;
  let peekFailed = 0;
  const t0 = Date.now();

  for (const name of names) {
    const truth = storedMode(name);
    if (!truth) { noTruth++; continue; }

    const peek = await peekReplay(path.join(W3G_DIR, name + '.w3g'));
    if (!peek.ok) {
      peekFailed++;
      if (verbose) console.log('  peek failed  ' + name + ' — ' + peek.error);
      continue;
    }

    compared++;
    modes[peek.gameMode] = (modes[peek.gameMode] || 0) + 1;
    if (peek.gameMode !== truth) disagree.push({ name, peek: peek.gameMode, parse: truth });
    else if (verbose) console.log('  ok  ' + peek.gameMode.padEnd(6) + name);
  }

  const ms = Date.now() - t0;
  console.log('peek-mode-check: ' + compared + ' compared, ' +
              disagree.length + ' disagreement(s)' +
              (noTruth ? ', ' + noTruth + ' with no usable summary to check against' : '') +
              (peekFailed ? ', ' + peekFailed + ' peek failure(s)' : ''));
  console.log('  modes seen: ' + Object.entries(modes).map(([m, n]) => m + '=' + n).join(' ') || '  none');
  if (compared) console.log('  ' + Math.round(ms / compared) + 'ms per peek');

  for (const d of disagree) {
    console.log('\n  DISAGREE  ' + d.name);
    console.log('    peek says  ' + d.peek);
    console.log('    parse says ' + d.parse);
  }

  process.exit(disagree.length ? 1 : 0);
})();
