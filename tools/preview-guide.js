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
// Same trick for HeroAbilityStats — ReplayGuide's spike step looks it up via
// `typeof HeroAbilityStats !== 'undefined'` first, then falls back to require.
global.HeroAbilityStats = require('../client/js/HeroAbilityStats.js');
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
    // Level-3 spike payload — show each side's picks + the looked-up stats
    // entry so we can sanity-check the doubled-up detection / icon resolution.
    if (s.spike) {
      const fmtPicks = (row) => (row.picks || []).map(p =>
        `${p.displayName || p.spellItemId} L${p.level}${p.isSpike ? ' ★' : ''}`).join(' → ');
      console.log(`     Spike:`);
      console.log(`       Followed:  ${s.spike.followed.heroName} Lv${s.spike.followed.level} @ ${fmtT(s.spike.followed.levelAtMs)}  ${fmtPicks(s.spike.followed)}`);
      if (s.spike.opp) {
        console.log(`       Opp:       ${s.spike.opp.heroName} Lv${s.spike.opp.level} @ ${fmtT(s.spike.opp.levelAtMs)}  ${fmtPicks(s.spike.opp)}`);
      }
      console.log(`       Doubled:   followed=${s.spike.doubledSpellId || '(none)'}, opp=${s.spike.oppDoubledSpellId || '(none)'}`);
      if (s.spike.stats) {
        const st = s.spike.stats;
        const summarize = (label, arr) => {
          if (!Array.isArray(arr) || arr.length < 2) return null;
          if (arr[0] == null || arr[1] == null) return null;   // SLK omitted the field at one of the levels
          if (arr[0] === arr[1]) return null;
          return `${label} ${arr[0]}→${arr[1]}`;
        };
        const changed = ['manaCost', 'cooldown', 'duration', 'durationHero', 'area', 'castRange']
          .map(k => summarize(k, st[k])).filter(Boolean);
        const uberTip = st.ubertipNumbers && st.ubertipNumbers[0] && st.ubertipNumbers[1]
          ? `ubertip L1=[${st.ubertipNumbers[0].join(',')}] L2=[${st.ubertipNumbers[1].join(',')}]`
          : '(no ubertips)';
        // Per-spell Data field changes (the hand-labelled ones from
        // INTERNAL_ID_LABELS in parse-ability-data.js).
        if (st.data && st.dataMeta) {
          for (const letter of Object.keys(st.dataMeta)) {
            const meta = st.dataMeta[letter];
            const arr = st.data[letter];
            if (!meta || !meta.label || !Array.isArray(arr) || arr.length < 2) continue;
            if (arr[0] == null || arr[1] == null || arr[0] === arr[1]) continue;
            changed.push(`${meta.label} ${arr[0]}→${arr[1]} [${meta.format || 'flat'}]`);
          }
        }
        console.log(`       Stats:     ${st.name} — ${changed.length ? changed.join(', ') : 'no SLK fields differ L1→L2'}; ${uberTip}`);
        if (Array.isArray(st.summons) && st.summons.length >= 2) {
          const a = st.summons[0], b = st.summons[1];
          const sumLine = [];
          if (a.hp != null && b.hp != null && a.hp !== b.hp) sumLine.push(`HP ${a.hp}→${b.hp}`);
          if (a.damageAvg != null && b.damageAvg != null && a.damageAvg !== b.damageAvg) sumLine.push(`dmg ${a.damageMin}-${a.damageMax}→${b.damageMin}-${b.damageMax}`);
          if (a.armor !== b.armor) sumLine.push(`armor ${a.armor}→${b.armor}`);
          const aAbs = new Set(a.abilities || []);
          const gains = (b.abilities || []).filter(x => !aAbs.has(x));
          if (gains.length) sumLine.push(`gains [${gains.join(', ')}]`);
          console.log(`       Summons:   ${a.unitId}→${b.unitId}: ${sumLine.length ? sumLine.join(', ') : 'no stat changes'}`);
        }
      } else {
        console.log(`       Stats:     (no table — generic fallback)`);
      }
    }
  });
}
console.log('');
