/**
 * capture-plan.js — plan a ground-truth capture session against real WC3.
 *
 * Read-only over the parsed .wc3v. Emits an ordered checklist of game-clock
 * marks worth observing while Reforged plays the replay back (protocol:
 * docs/ENGINE_TRUTH_CAPTURE.md), prioritised for the two fidelity targets:
 * phantom combat and position drift.
 *
 * Mark sources:
 *   battles      start / mid / end of each detected battle (creepJack and
 *                camp-adjacent battles flagged — melee-heavy moments)
 *   camp clears  parser's clearedTime per camp (verify the REAL clear time)
 *   phantom traps  battles where the behavior authority suppresses more
 *                attack frames than it grants — if the real game ALSO shows
 *                fighting there, we are over-suppressing; if it shows none,
 *                the suppression is correct
 *   positions    evenly spaced hero-position sampling marks
 *
 * --out=PATH writes a fixture SKELETON: observation stubs with windows/areas
 * to look at, but every EXPECTED value left as "VERIFY:..." — never parser
 * output (that would make the fixture circular and worthless). Refuses to
 * overwrite an existing file.
 *
 * Usage:
 *   node tools/capture-plan.js --replay=ID
 *   node tools/capture-plan.js --replay=ID --out=client/data/engine-truth/ID.json
 */

const fs = require('fs');
const path = require('path');

const BM = require('./lib/behavior-metrics.js');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

if (!args.replay) {
  console.error('usage: node tools/capture-plan.js --replay=ID [--out=client/data/engine-truth/ID.json]');
  process.exit(2);
}

const data = BM.loadReplay(args.replay);
const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
const duration = (data.replay && data.replay.duration) || 900000;

const battles = data.battles || [];
const groups = (data.world && data.world.neutralGroups) || {};

// outerBbox is a single {minX,minY,maxX,maxY}; trackerBox is an ARRAY of
// per-tick box samples — fall back to the sample closest to mid-battle.
const boxCenter = (b) => {
  let box = b.outerBbox;
  if (!box && Array.isArray(b.trackerBox) && b.trackerBox.length) {
    const mid = (b.startTime + b.endTime) / 2;
    box = b.trackerBox.reduce((best, s) =>
      Math.abs(s.gameTime - mid) < Math.abs(best.gameTime - mid) ? s : best);
  }
  if (!box || box.minX == null) return null;
  return { x: Math.round((box.minX + box.maxX) / 2), y: Math.round((box.minY + box.maxY) / 2) };
};

// --- phantom-trap scoring: sample each battle window through the SAME
// behavior world the viewer uses; suppression >> attack marks the windows
// where phantom combat / over-suppression questions live.
const world = BM.createWorld(data);
const battleInfo = battles.map(b => {
  const span = Math.max(1, b.endTime - b.startTime);
  const stepCount = 9;
  let attack = 0, suppressed = 0;
  for (let i = 0; i < stepCount; i++) {
    const frame = world.resolve(b.startTime + (span * i / (stepCount - 1)));
    attack += frame.stats.attack;
    suppressed += frame.stats.suppressedNoTarget;
  }
  const units = (b.participants || []).reduce((a, p) => a + ((p.unitUuids || []).length), 0);
  return { b, center: boxCenter(b), units, attack, suppressed, trap: suppressed > attack };
});

// --- assemble marks ---------------------------------------------------------
const marks = [];

for (const bi of battleInfo) {
  const { b } = bi;
  const tag = `${b.id != null ? b.id : 'battle-?'}${b.creepJack ? ' CREEPJACK' : ''}${b.campUuid ? ' @camp' : ''}`;
  const at = bi.center ? ` near (${bi.center.x},${bi.center.y})` : '';
  marks.push({ t: b.startTime, what: `${tag} STARTS${at} — who opens the fight? which units swing first?` });
  marks.push({
    t: b.startTime + (b.endTime - b.startTime) / 2,
    what: `${tag} MID (${bi.units} tracked units)${bi.trap ? '  ⚠ PHANTOM TRAP: viewer suppresses more swings than it shows — is the real fight still going here?' : ''} — note who is attacking whom`
  });
  marks.push({ t: b.endTime, what: `${tag} ENDS — survivors? who retreats where?` });
}

for (const g of Object.values(groups)) {
  if (g.clearedTime == null) continue;
  const names = [...new Set((g.units || []).map(u => u.displayName))].join(', ');
  const pos = g.bounds ? ` @ (${Math.round((g.bounds.minX + g.bounds.maxX) / 2)},${Math.round((g.bounds.minY + g.bounds.maxY) / 2)})` : '';
  marks.push({ t: g.clearedTime, what: `camp clear (parser says ${fmt(g.clearedTime)}): ${names} lvl ${g.totalLevel}${pos} — note the REAL clear moment and who did it` });
}

// hero position sampling marks, evenly spaced through the match
const heroes = [];
for (const [pid, p] of Object.entries(data.players || {})) {
  if (!p || p.isNeutralPlayer) continue;
  for (const u of (p.units || [])) {
    if (u.meta && u.meta.hero && u.path && u.path.length) heroes.push(`p${pid} ${u.displayName}`);
  }
}
const POS_MARKS = 5;
for (let i = 1; i <= POS_MARKS; i++) {
  const t = Math.round(duration * i / (POS_MARKS + 1));
  marks.push({ t, what: `POSITION SAMPLE — freeze both clocks, note where each hero is (${heroes.slice(0, 4).join(', ')})` });
}

marks.sort((a, b) => a.t - b.t);

console.log(`\ncapture plan: ${args.replay} (${fmt(duration)} long, ${battles.length} battles, ${Object.values(groups).filter(g => g.clearedTime != null).length} camp clears)`);
console.log(`protocol: docs/ENGINE_TRUTH_CAPTURE.md — play 4–8×, drop to 1× ~15s before each mark\n`);
for (const m of marks) console.log(`  ${fmt(m.t).padStart(6)}  ${m.what}`);

// --- skeleton ---------------------------------------------------------------
if (args.out) {
  const outPath = path.resolve(String(args.out));
  if (fs.existsSync(outPath)) {
    console.error(`\nrefusing to overwrite existing fixture: ${outPath}`);
    process.exit(1);
  }
  const stubs = [];
  for (const bi of battleInfo) {
    const { b } = bi;
    if (!bi.center) continue;
    stubs.push({
      type: 'engagement',
      from: fmt(b.startTime), to: fmt(b.endTime),
      area: { x: bi.center.x, y: bi.center.y, r: 900 },
      attacking: [{ player: 'VERIFY: player id', unitType: 'VERIFY: type or delete', count: 'VERIFY: e.g. >=2' }],
      note: `VERIFY: ${b.id != null ? b.id : 'battle-?'} — record who was really attacking. If the real game showed NO combat here, change this to a noCombat observation instead.`
    });
  }
  for (const g of Object.values(groups)) {
    if (g.clearedTime == null) continue;
    stubs.push({
      type: 'campClear',
      match: { totalLevel: g.totalLevel, units: [...new Set((g.units || []).map(u => u.displayName))] },
      clearedAt: 'VERIFY: MM:SS..MM:SS (use a ≥20s window around the REAL clear you watched)',
      by: 'VERIFY: player id, or delete',
      note: 'VERIFY: watched clear time — do NOT copy the parser time from the checklist'
    });
  }
  for (let i = 1; i <= POS_MARKS; i++) {
    const t = Math.round(duration * i / (POS_MARKS + 1));
    stubs.push({
      type: 'unitPosition',
      t: fmt(t),
      who: { player: 'VERIFY: player id', unitType: 'VERIFY: e.g. hero name' },
      pos: { x: 'VERIFY: world x read off the viewer AFTER confirming on the game screenshot', y: 'VERIFY' },
      tolerance: 320,
      note: 'VERIFY: from the paired screenshots at this mark'
    });
  }
  stubs.push({
    type: 'noCombat',
    from: 'VERIFY: MM:SS', to: 'VERIFY: MM:SS',
    who: { player: 'VERIFY: player id' },
    area: { x: 'VERIFY', y: 'VERIFY', r: 900 },
    note: 'VERIFY: a window where the REAL game showed an idle army — the highest-value phantom-combat check. Add one per quiet stretch you observed.'
  });

  const skeleton = {
    replayId: args.replay,
    meta: {
      _README: 'GROUND TRUTH ONLY: every VERIFY field must be filled from watching WC3 play this replay (docs/ENGINE_TRUTH_CAPTURE.md). Never copy parser/viewer values into expectations — that makes the fixture circular and worthless. Windows/areas were pre-filled as places to LOOK, from the capture plan.',
      capturedOn: 'VERIFY: YYYY-MM-DD',
      wc3Build: 'VERIFY: e.g. 2.0.x',
      speedUsed: 'VERIFY: e.g. 1x-8x',
      clockOffsetMs: 0,
      author: 'VERIFY'
    },
    observations: stubs
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(skeleton, null, 2) + '\n');
  console.log(`\nskeleton written: ${outPath} (${stubs.length} stubs — delete the ones you didn't observe)`);
}
