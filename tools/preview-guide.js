#!/usr/bin/env node
//
// preview-guide.js — print the auto-generated "guided walkthrough" steps for a
// replay, so you can eyeball the commentary quality without the viewer UI.
// (Phase A QA tool for the guided-walkthrough feature — see the plan / memory.)
//
// Usage:
//   node tools/preview-guide.js --replay=happy-vs-grubby                # all non-neutral players
//   node tools/preview-guide.js --replay=happy-vs-grubby --player=2     # follow playerId 2
//   node tools/preview-guide.js --replay=path/to/file.wc3v.gz           # literal path also works
//
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
// ReplayGuide reads window.PlayerNames when present (browser); expose it as a
// global here so the preview shows the same official pro names the UI does.
global.PlayerNames = require('../client/js/PlayerNames.js');
const ReplayGuide = require('../client/js/ReplayGuide.js');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

const name = args.replay;
if (!name || name === true) {
  console.log('Usage: node tools/preview-guide.js --replay=NAME [--player=ID]');
  process.exit(1);
}

const candidates = [
  path.join(__dirname, '..', 'client', 'replays', name + '.wc3v'),
  path.join(__dirname, '..', 'client', 'replays', name + '.wc3v.gz'),
  path.resolve(name),
];
const file = candidates.find(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
if (!file) { console.error('Replay not found. Tried:\n  ' + candidates.join('\n  ')); process.exit(1); }

let buf = fs.readFileSync(file);
if (file.endsWith('.gz')) buf = zlib.gunzipSync(buf);
const raw = JSON.parse(buf.toString('utf8'));

// Player names from the replay metadata; players keyed by playerId-string.
const nameById = {};
for (const r of ((raw.replay && raw.replay.metadata && raw.replay.metadata.playerRecords) || [])) {
  if (r && r.playerId != null) nameById[String(r.playerId)] = r.playerName || ('Player ' + r.playerId);
}
const entries = Object.entries(raw.players || {})
  .filter(([id, p]) => p && !p.isNeutralPlayer && Array.isArray(p.eventStream) && p.eventStream.length);
if (entries.length < 2) { console.error('Need 2 non-neutral players with event data; found ' + entries.length); process.exit(1); }

function asGuidePlayer(id, p) { return { name: nameById[id] || ('Player ' + id), race: p.race, eventStream: p.eventStream, buildingAttempts: p.buildingAttempts }; }

const want = (args.player != null && args.player !== true) ? [String(args.player)] : entries.map(([id]) => id);
const fmtT = (ms) => { const s = Math.round((ms || 0) / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

const mapName = (raw.replay && raw.replay.metadata && raw.replay.metadata.map && raw.replay.metadata.map.mapName) || '';
console.log(`\n=== ${path.basename(file)}  (${mapName.replace(/^.*\//, '').replace(/\.w3x$/i, '')}) ===`);

for (const followId of want) {
  const fe = entries.find(([id]) => id === followId);
  if (!fe) { console.error(`No non-neutral player with id ${followId}`); continue; }
  const oe = entries.find(([id]) => id !== followId);
  const followed = asGuidePlayer(fe[0], fe[1]);
  const opp = asGuidePlayer(oe[0], oe[1]);
  const guide = ReplayGuide.buildGuide(followed, opp);
  console.log(`\n--- Following ${guide.followedName} (${guide.followedRace}) vs ${guide.oppName} (${guide.oppRace}) — ${guide.steps.length} steps, game ${fmtT(guide.gameLengthMs)} ---`);
  if (guide.intro) {
    console.log(`\n  INTRO:`);
    console.log(`     ${guide.intro}`);
  }
  guide.steps.forEach((s, i) => {
    console.log(`\n  ${i + 1}. [${fmtT(s.gameTimeMs)} · ${s.title}${s.iconId ? ' · icon=' + s.iconId : ''}]`);
    console.log(`     ${guide.followedName}: ${s.action}`);
    if (Array.isArray(s.list) && s.list.length) {
      s.list.forEach((it, j) => console.log(`        ${j + 1}. ${it.label}${it.count > 1 ? ' ×' + it.count : ''}  (${fmtT(it.timeMs)})${it.kind && it.kind !== 'unit' ? ' [' + it.kind + ']' : ''}`));
    }
    if (s.contrast) console.log(`     ${guide.oppName}: ${s.contrast}`);
    if (s.why)      console.log(`     Why:       ${s.why}`);
    if (s.takeaway) console.log(`     Takeaway:  ${s.takeaway}`);
    if (s.focus && s.focus.kind && s.focus.kind !== 'map') {
      console.log(`     Focus:     ${s.focus.kind} (${s.focus.player})${s.focus.highlight ? ' → ' + s.focus.highlight.join(', ') : ''}`);
    }
  });
}
console.log('');
