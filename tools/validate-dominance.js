/**
 * validate-dominance.js — measure the dominance score against real outcomes.
 *
 * The eye-test harness: for every parsed 1v1 replay that carries BOTH a
 * dominance series and a winner verdict (leave-record capture in wc3v.js),
 * compute how well the score tracked the game's actual story, then aggregate.
 * This tool defines success for formula changes: fix mechanisms, re-run,
 * compare distributions — never fit individual games.
 *
 * Usage:
 *   node tools/validate-dominance.js                  — human-readable report
 *   node tools/validate-dominance.js --json           — machine-readable (for before/after diffs)
 *   node tools/validate-dominance.js --replay=ID      — single replay detail
 *   node tools/validate-dominance.js --limit=N        — cap processed replays
 *   node tools/validate-dominance.js --diff=FILE.json — paired per-game comparison
 *                                                       against an earlier --json run
 *
 * Per-game metrics (W(t) = winner's score, lerped between samples):
 *   winnerFinal            W at the last sample
 *   winnerFinalThirdMean   time-weighted mean of W over the final third
 *   leadFraction           fraction of game time with W > 50.5 (hysteresis eps)
 *   comebackDepth          max(0, 50 − min W)  — how far behind the winner was
 *   leadChanges            leader flips (new leader must reach 50.5)
 *   endgameSlope           W(end) − W(end − 180s)
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const REPLAYS_DIR = path.join(__dirname, '..', 'client', 'replays');
const EPS = 0.5;
const FINAL_WINDOW_MS = 180000;

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

function loadReplay (basePath) {
  if (fs.existsSync(`${basePath}.wc3v`)) {
    return JSON.parse(fs.readFileSync(`${basePath}.wc3v`, 'utf8'));
  }
  if (fs.existsSync(`${basePath}.wc3v.gz`)) {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(`${basePath}.wc3v.gz`)).toString());
  }
  return null;
}

function scoreAt (samples, t) {
  if (t <= samples[0].t) return samples[0].score;
  const last = samples[samples.length - 1];
  if (t >= last.t) return last.score;
  let lo = 0, hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  const a = samples[lo], b = samples[lo + 1];
  const span = b.t - a.t;
  return span <= 0 ? b.score : a.score + (b.score - a.score) * ((t - a.t) / span);
}

// Time-weighted mean of W over [from, to] via trapezoid on sample segments.
function meanOver (samples, from, to) {
  if (to <= from) return scoreAt(samples, to);
  let area = 0;
  let prevT = from, prevS = scoreAt(samples, from);
  for (const s of samples) {
    if (s.t <= from) continue;
    const t = Math.min(s.t, to);
    area += ((prevS + scoreAt(samples, t)) / 2) * (t - prevT);
    prevT = t; prevS = scoreAt(samples, t);
    if (s.t >= to) break;
  }
  if (prevT < to) area += prevS * (to - prevT);
  return area / (to - from);
}

// Fraction of [0, end] where W > 50 + EPS, with linear crossing interpolation.
function leadFraction (samples, end) {
  let leadMs = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    const span = b.t - a.t;
    if (span <= 0) continue;
    const aLead = a.score > 50 + EPS, bLead = b.score > 50 + EPS;
    if (aLead && bLead) leadMs += span;
    else if (aLead !== bLead) {
      const f = Math.abs(((50 + EPS) - a.score) / (b.score - a.score));
      leadMs += aLead ? span * f : span * (1 - f);
    }
  }
  return end > 0 ? leadMs / end : 0;
}

function leadChanges (samples) {
  let leader = 0; // 0 = none/even, 1 = winner, -1 = loser
  let changes = 0;
  for (const s of samples) {
    const now = s.score > 50 + EPS ? 1 : (s.score < 50 - EPS ? -1 : leader);
    if (now !== leader && leader !== 0) changes++;
    if (now !== 0) leader = now;
  }
  return changes;
}

function analyze (id, data) {
  if (data.gameMode !== '1v1') return { skip: 'not 1v1' };
  if (!data.dominance || !data.dominance.available) return { skip: 'dominance unavailable' };
  if (!data.winner || data.winner.playerId == null) return { skip: 'no winner' };

  const winnerP = data.players && data.players[data.winner.playerId];
  if (!winnerP || !winnerP.dominanceSeries || !winnerP.dominanceSeries.samples.length) {
    return { skip: 'winner has no series' };
  }
  const samples = winnerP.dominanceSeries.samples;
  const end = samples[samples.length - 1].t;

  let minW = 100;
  for (const s of samples) if (s.score < minW) minW = s.score;

  const names = {};
  const replayPlayers = (data.replay && data.replay.players) || {};
  for (const pid of Object.keys(data.players || {})) {
    if (data.players[pid].isNeutralPlayer) continue;
    names[pid] = (replayPlayers[pid] && replayPlayers[pid].name) || `p${pid}`;
  }

  return {
    id,
    winnerId: data.winner.playerId,
    winnerName: names[data.winner.playerId] || `p${data.winner.playerId}`,
    method: data.winner.method,
    players: names,
    version: winnerP.dominanceSeries.version,
    gameEndMs: end,
    winnerFinal: +samples[samples.length - 1].score.toFixed(1),
    winnerFinalThirdMean: +meanOver(samples, end * 2 / 3, end).toFixed(1),
    leadFraction: +leadFraction(samples, end).toFixed(3),
    comebackDepth: +Math.max(0, 50 - minW).toFixed(1),
    leadChanges: leadChanges(samples),
    endgameSlope: +(samples[samples.length - 1].score - scoreAt(samples, Math.max(0, end - FINAL_WINDOW_MS))).toFixed(1)
  };
}

function main () {
  const files = fs.readdirSync(REPLAYS_DIR)
    .filter(f => f.endsWith('.wc3v.gz'))
    .map(f => f.replace(/\.wc3v\.gz$/, ''))
    .filter(id => !args.replay || id === args.replay)
    .sort();
  const limit = parseInt(args.limit) || files.length;

  const perGame = [];
  const skipped = {};
  for (const id of files.slice(0, limit)) {
    let data;
    try { data = loadReplay(path.join(REPLAYS_DIR, id)); } catch (e) { skipped['load error'] = (skipped['load error'] || 0) + 1; continue; }
    if (!data) continue;
    const r = analyze(id, data);
    if (r.skip) { skipped[r.skip] = (skipped[r.skip] || 0) + 1; continue; }
    perGame.push(r);
  }

  perGame.sort((a, b) => a.winnerFinal - b.winnerFinal);

  const n = perGame.length;
  const mean = (key) => n ? +(perGame.reduce((acc, g) => acc + g[key], 0) / n).toFixed(2) : 0;
  const median = (key) => n ? perGame.map(g => g[key]).sort((a, b) => a - b)[Math.floor(n / 2)] : 0;
  const pct = (fn) => n ? +(100 * perGame.filter(fn).length / n).toFixed(1) : 0;

  const histogram = {};
  for (const g of perGame) {
    const bucket = `${Math.floor(g.winnerFinal / 10) * 10}-${Math.floor(g.winnerFinal / 10) * 10 + 9}`;
    histogram[bucket] = (histogram[bucket] || 0) + 1;
  }
  const byMethod = {};
  for (const g of perGame) byMethod[g.method] = (byMethod[g.method] || 0) + 1;

  const comebackCandidates = perGame.filter(g => g.winnerFinal >= 55);
  const deepestComeback = comebackCandidates.length
    ? comebackCandidates.reduce((a, b) => (b.comebackDepth > a.comebackDepth ? b : a))
    : null;
  const wireToWire = n
    ? [...perGame].sort((a, b) => (b.leadFraction - a.leadFraction) || (b.winnerFinal - a.winnerFinal))[0]
    : null;

  const aggregate = {
    games: n,
    skipped,
    version: n ? perGame[0].version : null,
    winnerFinal: { mean: mean('winnerFinal'), median: median('winnerFinal'), histogram },
    pctWinnerFinalOver55: pct(g => g.winnerFinal > 55),
    pctWinnerFinalOver60: pct(g => g.winnerFinal > 60),
    pctWinnerEndingBehind: pct(g => g.winnerFinal < 50),
    meanLeadFraction: mean('leadFraction'),
    meanFinalThird: mean('winnerFinalThirdMean'),
    meanEndgameSlope: mean('endgameSlope'),
    byMethod,
    worst10: perGame.slice(0, 10).map(g => ({
      id: g.id, winnerFinal: g.winnerFinal, winner: g.winnerName, method: g.method
    })),
    exemplars: {
      deepestComeback: deepestComeback && {
        id: deepestComeback.id, comebackDepth: deepestComeback.comebackDepth,
        winnerFinal: deepestComeback.winnerFinal, winner: deepestComeback.winnerName
      },
      wireToWire: wireToWire && {
        id: wireToWire.id, leadFraction: wireToWire.leadFraction,
        winnerFinal: wireToWire.winnerFinal, winner: wireToWire.winnerName
      }
    }
  };

  if (args.json) {
    console.log(JSON.stringify({ perGame, aggregate }, null, 2));
    return;
  }

  if (args.diff) {
    const prev = JSON.parse(fs.readFileSync(args.diff, 'utf8'));
    const prevById = new Map(prev.perGame.map(g => [g.id, g]));
    const paired = perGame.filter(g => prevById.has(g.id));
    let improved = 0, worsened = 0, sumDelta = 0;
    const rows = [];
    for (const g of paired) {
      const before = prevById.get(g.id);
      const d = +(g.winnerFinal - before.winnerFinal).toFixed(1);
      sumDelta += d;
      if (d > 0.5) improved++;
      else if (d < -0.5) worsened++;
      rows.push({ id: g.id, before: before.winnerFinal, after: g.winnerFinal, d });
    }
    rows.sort((a, b) => a.d - b.d);
    console.log(`Paired diff vs ${args.diff} — ${paired.length} common game(s)`);
    console.log(`  winnerFinal mean delta: ${(sumDelta / Math.max(1, paired.length)).toFixed(2)}`);
    console.log(`  improved (>+0.5): ${improved}   worsened (<-0.5): ${worsened}   ~flat: ${paired.length - improved - worsened}`);
    console.log('  5 most worsened:');
    rows.slice(0, 5).forEach(r => console.log(`    ${String(r.d).padStart(6)}  ${r.before} → ${r.after}  ${r.id}`));
    console.log('  5 most improved:');
    rows.slice(-5).reverse().forEach(r => console.log(`    +${r.d}  ${r.before} → ${r.after}  ${r.id}`));
    return;
  }

  console.log(`Dominance validation — ${n} game(s) with winner + series`);
  console.log(`  skipped: ${JSON.stringify(skipped)}`);
  console.log(`  formula version: ${aggregate.version}`);
  console.log('');
  console.log(`  winnerFinal      mean=${aggregate.winnerFinal.mean}  median=${aggregate.winnerFinal.median}`);
  console.log(`  histogram        ${Object.keys(histogram).sort((a, b) => parseInt(a) - parseInt(b)).map(k => `${k}:${histogram[k]}`).join('  ')}`);
  console.log(`  winner ends >55  ${aggregate.pctWinnerFinalOver55}%   >60  ${aggregate.pctWinnerFinalOver60}%   BEHIND (<50)  ${aggregate.pctWinnerEndingBehind}%`);
  console.log(`  leadFraction     mean=${aggregate.meanLeadFraction}`);
  console.log(`  finalThirdMean   mean=${aggregate.meanFinalThird}`);
  console.log(`  endgameSlope     mean=${aggregate.meanEndgameSlope}`);
  console.log(`  winner method    ${JSON.stringify(byMethod)}`);
  console.log('');
  console.log('  Worst 10 (winner ending lowest):');
  aggregate.worst10.forEach(g => {
    console.log(`    ${String(g.winnerFinal).padStart(5)}  ${g.id}  (${g.winner}, ${g.method})`);
  });
  console.log('');
  if (aggregate.exemplars.deepestComeback) {
    const c = aggregate.exemplars.deepestComeback;
    console.log(`  Deepest comeback: ${c.id} — ${c.winner} was down to ${(50 - c.comebackDepth).toFixed(1)}, won ending ${c.winnerFinal}`);
  }
  if (aggregate.exemplars.wireToWire) {
    const w = aggregate.exemplars.wireToWire;
    console.log(`  Wire-to-wire:     ${w.id} — ${w.winner} led ${(100 * w.leadFraction).toFixed(0)}% of the game, ended ${w.winnerFinal}`);
  }
}

main();
