#!/usr/bin/env node
//
// score-build-match.js — grade how well a replay executes a manifest build.
//
// Usage:
//   node tools/score-build-match.js --replay=NAME --build=BUILD_ID [--player=SLOT]
//   node tools/score-build-match.js --build=BUILD_ID            # rank the build's attached replays
//   node tools/score-build-match.js --build=BUILD_ID --corpus   # rank EVERY parsed replay for this build
//
// Reads parsed .wc3v from client/replays/. Auto-detects which player runs the
// build when --player is omitted. See tools/lib/build-match.js for the scoring.
//
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const bm = require('./lib/build-match.js');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

const replaysDir = path.join(__dirname, '..', 'client', 'replays');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'client', 'data', 'builds-manifest.json'), 'utf8'));
const builds = manifest.builds || manifest;

function loadReplay (id) {
  const base = path.join(replaysDir, id);
  if (fs.existsSync(base + '.wc3v')) return JSON.parse(fs.readFileSync(base + '.wc3v', 'utf8'));
  if (fs.existsSync(base + '.wc3v.gz')) return JSON.parse(zlib.gunzipSync(fs.readFileSync(base + '.wc3v.gz')).toString('utf8'));
  return null;
}

function fmt (ms) {
  if (ms == null) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function printResult (id, r) {
  const f = r.facts || {};
  console.log(`  ${String(r.score).padStart(5)}  ${id}  [p${r.slot} ${f.race || '?'} hero=${f.hero || '-'} L${f.heroLevel} T2=${fmt(f.t2)} T3=${fmt(f.t3)} len=${fmt(f.lengthMs)}]`);
  const b = r.breakdown || {};
  const parts = Object.keys(b).map(k => `${k}=${b[k].points}/${b[k].weight}`).join(' ');
  console.log(`         ${parts}`);
  if (r.notes && r.notes.length) console.log(`         notes: ${r.notes.join('; ')}`);
}

if (!args.build) {
  console.log('Usage: node tools/score-build-match.js --build=BUILD_ID [--replay=NAME] [--player=SLOT] [--corpus]');
  console.log('Builds:', builds.map(b => b.id).join(', '));
  process.exit(1);
}

const build = builds.find(b => b.id === args.build);
if (!build) { console.error('Unknown build:', args.build); process.exit(1); }
if (!build.tierProgression) { console.error(`Build "${build.id}" has no tierProgression to match against.`); process.exit(1); }

console.log(`=== Build: ${build.id} (${build.name}) — ${build.race} ${build.heroOpener || ''} ===`);
console.log(`    expected: T1 ${JSON.stringify((build.tierProgression.t1||{}).buildings||[])}  T2 ${(build.tierProgression.t2||{}).timing||'?'}  T3 ${(build.tierProgression.t3||{}).timing||'?'}`);
console.log('');

// Single replay
if (typeof args.replay === 'string') {
  const data = loadReplay(args.replay);
  if (!data) { console.error('Replay not found in client/replays:', args.replay); process.exit(1); }
  if (typeof args.player === 'string') {
    printResult(args.replay, bm.scoreBuildMatch(data, build, args.player));
  } else {
    const best = bm.bestSlotForBuild(data, build);
    if (!best) { console.log('  (no scorable player)'); process.exit(0); }
    printResult(args.replay, best.result);
  }
  process.exit(0);
}

// Rank a set of replays (the build's attached ones, or the whole corpus).
let ids;
if (args.corpus) {
  ids = fs.readdirSync(replaysDir)
    .filter(f => f.endsWith('.wc3v.gz') || f.endsWith('.wc3v'))
    .map(f => f.replace(/\.wc3v(\.gz)?$/, ''))
    .filter((v, i, a) => a.indexOf(v) === i);
  console.log(`Ranking ${ids.length} parsed replays in the corpus for this build...\n`);
} else {
  ids = (build.replays || []).map(r => r.replayId);
  console.log(`Ranking the build's ${ids.length} attached replays...\n`);
}

const scored = [];
for (const id of ids) {
  const data = loadReplay(id);
  if (!data) continue;
  const best = bm.bestSlotForBuild(data, build);
  if (best && best.result.valid) scored.push({ id, r: best.result });
}
scored.sort((a, b) => b.r.score - a.r.score);

const top = scored.slice(0, Number(args.top) || 20);
top.forEach(({ id, r }) => printResult(id, r));
if (!scored.length) console.log('  (no race-matching replays scored)');
console.log(`\n${scored.length} scored; best: ${scored.length ? scored[0].id + ' (' + scored[0].r.score + ')' : '—'}`);
