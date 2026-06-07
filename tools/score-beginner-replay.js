#!/usr/bin/env node
//
// score-beginner-replay.js — rank parsed replays by how emulatable a given
// build is for a NEW player. Built for the builds-library onboarding: a
// beginner template should show the simple plan (e.g. UD: Ghouls mine lumber,
// the army is Crypt Fiends) and NOT a pro-only habit (an early Ghoul opening /
// Ghoul micro in fights). Scores from parsed .wc3v data — no playing required.
//
// Usage:
//   node tools/score-beginner-replay.js                       # default: UD DK fiend, scan all replays
//   node tools/score-beginner-replay.js --race=U --hero=udea  # explicit
//   node tools/score-beginner-replay.js --replay=NAME         # score one replay (both players)
//   node tools/score-beginner-replay.js --top=15              # show N best
//
// Scoring is for the UD DK-fiend template right now (the only one wired up).
// Higher score = better beginner template. The metrics are printed alongside
// the score so a human can sanity-check the pick.
//
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

const WANT_RACE = (typeof args.race === 'string') ? args.race : 'U';
const WANT_HERO = (typeof args.hero === 'string') ? args.hero : 'udea';   // Death Knight
const TOP = Number(args.top) || 12;

const GHOUL = 'ugho', FIEND = 'ucry';
const EARLY_MS = 7 * 60 * 1000;   // "early" = before 7:00 (the Ghoul-opening window)

const replaysDir = path.join(__dirname, '..', 'client', 'replays');

function loadReplay(file) {
  let buf = fs.readFileSync(file);
  if (file.endsWith('.gz')) buf = zlib.gunzipSync(buf);
  return JSON.parse(buf.toString('utf8'));
}

function fmt(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// First hero itemId trained by a player (chronological addUnit isHero).
function firstHeroId(stream) {
  const h = stream.filter(e => e && e.key === 'addUnit' && e.unit && e.unit.isHero)
    .sort((a, b) => a.gameTime - b.gameTime)[0];
  return h ? h.unit.itemId : null;
}

// Count addUnit events for a given itemId.
function countTrained(stream, itemId) {
  return stream.filter(e => e && e.key === 'addUnit' && e.unit && e.unit.itemId === itemId).length;
}

// Peak ghoulsOnLumber, and the value reached by `byMs`.
function lumberGhouls(stream, byMs) {
  let peak = 0, atTime = 0;
  for (const e of stream) {
    const g = e && e.workers && Number(e.workers.ghoulsOnLumber);
    if (!g && g !== 0) continue;
    if (g > peak) peak = g;
    if (e.gameTime <= byMs && g > atTime) atTime = g;
  }
  return { peak, atTime };
}

// Time the player reached tier 2, or Infinity.
function tier2Ms(stream) {
  let best = Infinity;
  for (const e of stream) {
    if (e && e.key === 'tierUpgrade' && e.building && Number(e.building.tierTarget) === 2 && e.gameTime < best) best = e.gameTime;
  }
  return best;
}

// Ghoul (and total) combat losses for a player across all battles, split by
// early/late. Reads battle.summary.perPlayer[pid] unit loss lists.
function ghoulCombatLosses(battles, pid) {
  let ghoulEarly = 0, ghoulTotal = 0, totalUnits = 0;
  const key = String(pid);
  for (const b of battles) {
    const sum = b && b.summary;
    if (!sum || !sum.perPlayer) continue;
    const pp = sum.perPlayer[key] || sum.perPlayer[Number(key)];
    if (!pp) continue;
    const isEarly = (b.startTime || 0) < EARLY_MS;
    for (const bucket of ['definite', 'estimated']) {
      for (const u of ((pp[bucket] && pp[bucket].units) || [])) {
        totalUnits += u.count || 0;
        if (u.itemId === GHOUL) {
          ghoulTotal += u.count || 0;
          if (isEarly) ghoulEarly += u.count || 0;
        }
      }
    }
  }
  return { ghoulEarly, ghoulTotal, totalUnits };
}

function gameEndMs(stream) {
  let t = 0;
  for (const e of stream) if (e && typeof e.gameTime === 'number' && e.gameTime > t) t = e.gameTime;
  return t;
}

// Score one player's game as a beginner DK-fiend template. Returns null if the
// player isn't running the build at all (wrong race / hero / no fiends).
function scorePlayer(raw, pid, p, nameById) {
  const stream = Array.isArray(p.eventStream) ? p.eventStream : [];
  if (p.race !== WANT_RACE) return null;
  const fh = firstHeroId(stream);   // hero itemIds are capitalised (Udea), compare loosely
  if (!fh || fh.toLowerCase() !== WANT_HERO.toLowerCase()) return null;

  const fiends = countTrained(stream, FIEND);
  if (fiends < 3) return null;                       // not actually a fiend game

  const battles = Array.isArray(raw.battles) ? raw.battles : [];
  const { ghoulEarly, ghoulTotal, totalUnits } = ghoulCombatLosses(battles, pid);
  const { peak: lumberPeak, atTime: lumberAt6 } = lumberGhouls(stream, 6 * 60 * 1000);
  const t2 = tier2Ms(stream);
  const end = gameEndMs(stream);

  // ── Score ──────────────────────────────────────────────────────────────
  // Reward the simple macro shape; penalise the pro-only Ghoul opening.
  let score = 0;
  const reasons = [];

  // Ghouls actually mining lumber by 6:00 (the build's whole economy).
  if (lumberAt6 >= 3) { score += 25; reasons.push(`+25 ${lumberAt6} ghouls on lumber by 6:00`); }
  else if (lumberAt6 >= 1) { score += 10; reasons.push(`+10 only ${lumberAt6} ghoul(s) on lumber by 6:00`); }
  else reasons.push(`+0 no ghouls on lumber by 6:00 (roaming/aggressive)`);

  // Penalise early Ghoul combat deaths hard — that's the pro Ghoul opening /
  // risky Ghoul creeping a new player can't pull off.
  if (ghoulEarly === 0) { score += 30; reasons.push(`+30 no early ghoul combat losses`); }
  else { score -= ghoulEarly * 12; reasons.push(`-${ghoulEarly * 12} ${ghoulEarly} ghoul(s) died in early fights`); }

  // A few late ghoul losses are fine; many means ghouls were in the army.
  if (ghoulTotal <= 2) { score += 10; reasons.push(`+10 ghouls stayed out of fights (${ghoulTotal} total lost)`); }
  else { score -= (ghoulTotal - 2) * 4; reasons.push(`-${(ghoulTotal - 2) * 4} ${ghoulTotal} ghouls lost in fights total`); }

  // A real fiend army on screen.
  if (fiends >= 6) { score += 20; reasons.push(`+20 ${fiends} fiends produced`); }
  else { score += fiends * 2; reasons.push(`+${fiends * 2} only ${fiends} fiends produced`); }

  // Clean, watchable game length: long enough to show the plan, not a cheese
  // or a 40-minute slog.
  const mins = end / 60000;
  if (mins >= 8 && mins <= 18) { score += 15; reasons.push(`+15 game length ${fmt(end)} (watchable)`); }
  else if (mins < 6) { score -= 15; reasons.push(`-15 game too short (${fmt(end)}) — likely cheese/blowout`); }
  else reasons.push(`+0 game length ${fmt(end)}`);

  // Reached T2 (the build's tech goal) at a sane time.
  if (t2 !== Infinity && t2 <= 7 * 60 * 1000) { score += 10; reasons.push(`+10 T2 at ${fmt(t2)}`); }
  else if (t2 !== Infinity) { score += 4; reasons.push(`+4 T2 late at ${fmt(t2)}`); }
  else { score -= 10; reasons.push(`-10 never reached T2`); }

  return {
    score, reasons,
    name: nameById[pid] || ('Player ' + pid),
    pid,
    race: p.race,
    fiends, ghoulEarly, ghoulTotal, lumberPeak, lumberAt6, t2, end
  };
}

function namesFor(raw) {
  const nameById = {};
  for (const r of ((raw.replay && raw.replay.metadata && raw.replay.metadata.playerRecords) || [])) {
    if (r && r.playerId != null) nameById[String(r.playerId)] = r.playerName || ('Player ' + r.playerId);
  }
  return nameById;
}

function scoreReplayFile(file) {
  let raw;
  try { raw = loadReplay(file); } catch (e) { return []; }
  const nameById = namesFor(raw);
  const out = [];
  for (const [pid, p] of Object.entries(raw.players || {})) {
    if (!p || p.isNeutralPlayer) continue;
    const r = scorePlayer(raw, pid, p, nameById);
    if (r) {
      // opponent name for context
      const opp = Object.entries(raw.players || {}).find(([id, q]) => id !== pid && q && !q.isNeutralPlayer);
      r.opponent = opp ? (nameById[opp[0]] || ('Player ' + opp[0])) : '?';
      r.oppRace = opp ? opp[1].race : '?';
      r.file = path.basename(file).replace(/\.wc3v(\.gz)?$/, '');
      out.push(r);
    }
  }
  return out;
}

// ── Run ────────────────────────────────────────────────────────────────────
let files;
if (typeof args.replay === 'string') {
  const cands = [
    path.join(replaysDir, args.replay + '.wc3v'),
    path.join(replaysDir, args.replay + '.wc3v.gz'),
    path.resolve(args.replay)
  ];
  const f = cands.find(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
  if (!f) { console.error('Replay not found: ' + args.replay); process.exit(1); }
  files = [f];
} else {
  files = fs.readdirSync(replaysDir).filter(f => f.endsWith('.wc3v.gz') || f.endsWith('.wc3v'))
    .map(f => path.join(replaysDir, f));
}

console.log(`\nScoring ${files.length} replay file(s) for: race=${WANT_RACE} hero=${WANT_HERO} (DK fiend beginner template)\n`);

let all = [];
for (const f of files) all = all.concat(scoreReplayFile(f));
all.sort((a, b) => b.score - a.score);

if (!all.length) { console.log('No qualifying DK-fiend games found.'); process.exit(0); }

const show = all.slice(0, TOP);
show.forEach((r, i) => {
  console.log(`${String(i + 1).padStart(2)}. [score ${String(r.score).padStart(3)}] ${r.name} (U) vs ${r.opponent} (${r.oppRace}) — ${r.file}`);
  console.log(`    fiends=${r.fiends}  ghoulsLost(early/total)=${r.ghoulEarly}/${r.ghoulTotal}  lumberGhouls(peak/by6:00)=${r.lumberPeak}/${r.lumberAt6}  T2=${r.t2 === Infinity ? '—' : fmt(r.t2)}  len=${fmt(r.end)}`);
  if (args.why) console.log('    ' + r.reasons.join('\n    '));
});
console.log(`\n(${all.length} qualifying games total; showing top ${show.length}. Add --why for score breakdown, --replay=NAME to score one.)\n`);
