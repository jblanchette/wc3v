#!/usr/bin/env node
//
// pick-beginner-replays.js — for each NEW-PLAYER build, scan the whole parsed
// replay corpus and rank the replays that PASS the strict beginner gate
// (tools/lib/walkthrough-rules.js strictBeginnerGate): hero genuinely creeps to
// level 3 with >=2 credited camp clears, walkthrough is fully evidence-backed,
// watchable length, race-appropriate behavior (UD Ghouls on lumber, no Ghoul
// PvP deaths). Replay-only evidence — nothing about what SHOULD have happened.
//
// Usage:
//   node tools/pick-beginner-replays.js                 # all new-player builds
//   node tools/pick-beginner-replays.js --build=udo-dk-fast-fiend
//   node tools/pick-beginner-replays.js --top=15
//
'use strict';

const fs = require('fs');
const path = require('path');
const rules = require('./lib/walkthrough-rules.js');

const args = {};
process.argv.slice(2).forEach(raw => { const [f, ...r] = raw.replace(/^--/, '').split('='); args[f] = r.join('=') || true; });
const TOP = Number(args.top) || 10;

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'client', 'data', 'builds-manifest.json'), 'utf8'));
let newBuilds = manifest.builds.filter(b => b.level === 'new');
if (typeof args.build === 'string') newBuilds = newBuilds.filter(b => b.id === args.build);

// Corpus: every parsed replay on disk.
const replaysDir = path.join(__dirname, '..', 'client', 'replays');
const files = fs.readdirSync(replaysDir).filter(f => f.endsWith('.wc3v.gz') || f.endsWith('.wc3v'));

// Cache loaded replays (a build sweep reuses them across builds).
const cache = new Map();
function load (id) {
  if (cache.has(id)) return cache.get(id);
  let raw = null;
  try { raw = rules.loadReplay(id); } catch (e) { raw = null; }
  cache.set(id, raw);
  return raw;
}

const nameOf = (raw, pid) => {
  const recs = (raw.replay && raw.replay.metadata && raw.replay.metadata.playerRecords) || [];
  const r = recs.find(x => String(x.playerId) === String(pid));
  let n = (r && r.playerName) || ('P' + pid);
  if (typeof PlayerNames !== 'undefined' && PlayerNames.canonical) n = PlayerNames.canonical(n);
  return n;
};

for (const build of newBuilds) {
  const race = build.race;
  const heroId = String(build.heroItemId || '').toLowerCase();
  console.log(`\n=== ${build.id}  (race ${race}, hero ${build.heroItemId}) — strict beginner-gate passers ===`);
  const passers = [];
  for (const f of files) {
    const id = f.replace(/\.wc3v(\.gz)?$/, '');
    const raw = load(id);
    if (!raw) continue;
    for (const [pid, p] of rules.realPlayers(raw)) {
      if (p.race !== race) continue;
      const fh = rules.firstHeroId(p.eventStream);
      if (!fh || fh.toLowerCase() !== heroId) continue;
      let gate;
      try { gate = rules.strictBeginnerGate(raw, pid); } catch (e) { continue; }
      if (!gate.pass) continue;
      const opp = rules.realPlayers(raw).find(([oid]) => oid !== pid);
      passers.push({
        replayId: id, slot: pid, score: gate.score,
        name: nameOf(raw, pid), oppName: opp ? nameOf(raw, opp[0]) : '?',
        oppRace: opp ? opp[1].race : '?',
        camps: gate.route.camps.length, reached: gate.reachedLevel, lenMin: gate.lengthMin
      });
    }
  }
  passers.sort((a, b) => b.score - a.score || a.lenMin - b.lenMin);
  if (!passers.length) { console.log('  (no strict-gate passers in corpus!)'); continue; }
  passers.slice(0, TOP).forEach((p, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${p.replayId.padEnd(46)} slot${p.slot} ${p.name} vs ${p.oppName}(${p.oppRace})  route=${p.camps}camps reachedL${p.reached} ${p.lenMin}min`);
  });
  console.log(`  (${passers.length} passer(s) total)`);
}
console.log('');
