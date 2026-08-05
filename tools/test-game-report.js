/**
 * test-game-report.js — synthetic assertions for client/js/GameReport.js
 * (the per-game review: pillar grades, named mistakes, highlights,
 * benchmarks) and ProfileAggregate.baseline().
 *
 * Usage: node tools/test-game-report.js
 */

const assert = require('node:assert');
const PA = require('../client/js/ProfileAggregate.js');
const GR = require('../client/js/GameReport.js');

// ── Synthetic summaries ───────────────────────────────────────────────────────

const MIN = 60 * 1000;

// A normal game for "Me": T2 at 4:20, 20 workers at 5:00, expansion at 8:00.
const mkGame = (i, over) => {
  const o = over || {};
  const t2 = o.t2 !== undefined ? o.t2 : 260000;
  const duration = o.duration || 15 * MIN;
  const economyTrack = o.economyTrack || [
    { gameTimeMs: 2 * MIN, totalWorkers: 12, supplyUsed: 20, supplyMax: 30, workersOnGold: 8, workersOnLumber: 4 },
    { gameTimeMs: 4.5 * MIN, totalWorkers: o.w5 !== undefined ? o.w5 : 20, supplyUsed: 32, supplyMax: 50, workersOnGold: 12, workersOnLumber: 6 }
  ];
  // Combat units appear steadily unless a stall is requested.
  const combatUnitsTrack = [];
  for (let t = 0; t <= Math.min(duration, 30 * MIN); t += 30 * 1000) {
    let count = Math.floor(t / MIN);
    if (o.stallFrom !== undefined && t >= o.stallFrom) {
      count = Math.min(count, Math.floor(o.stallFrom / MIN));
      if (o.stallUntil !== undefined && t >= o.stallUntil) {
        count = Math.floor(o.stallFrom / MIN) + Math.floor((t - o.stallUntil) / MIN);
      }
    }
    combatUnitsTrack.push({ gameTimeMs: t, count });
  }
  return {
    key: `k${i}`,
    schemaVersion: 3,
    playedAt: 1600000000000 + i * 86400000,
    patchVersion: 32,
    map: 'Echo Isles',
    gameMode: '1v1',
    winner: { teamId: o.win === false ? 1 : 0, playerId: o.win === false ? 2 : 1, method: 'result09', confidence: 'high' },
    durationMs: duration,
    players: {
      1: {
        name: 'Me', race: 'O', teamId: 0,
        heroOpener: { name: 'Blademaster' },
        tier2Time: t2, tier3Time: null,
        expansionTime: o.expansion !== undefined ? o.expansion : 8 * MIN,
        firstTowerTime: null,
        buildPreview: [],
        economyTrack,
        combatUnitsTrack,
        heroBuilds: o.heroBuilds || [
          { name: 'Blademaster', itemId: 'Obla', spawnTimeMs: 50000, finalLevel: 4, camps: [
            { gameTimeMs: 2 * MIN }, { gameTimeMs: 4 * MIN }, { gameTimeMs: 7 * MIN }
          ] }
        ],
        apm: { rawAverage: 120, effectiveAverage: o.eapm !== undefined ? o.eapm : 60, effectivePerMinute: [], categories: {} },
        combat: o.combat !== undefined ? o.combat : {
          heroKills: [], heroDeaths: [], wipesFor: 0, wipesAgainst: 0, biggestSwing: null
        }
      },
      2: {
        name: 'Them', race: 'H', teamId: 1,
        heroOpener: { name: 'Archmage' },
        tier2Time: 300000, tier3Time: null, expansionTime: null, firstTowerTime: null,
        buildPreview: [], economyTrack: [], combatUnitsTrack: [], heroBuilds: [],
        apm: null, combat: null
      }
    }
  };
};

// A 12-game history: consistent T2 ~4:20, 20 workers, expands 2/3 of the time.
const history = [];
for (let i = 0; i < 12; i++) {
  history.push(mkGame(i, { expansion: i % 3 === 2 ? undefined : 8 * MIN }));
}

// ── baseline() ────────────────────────────────────────────────────────────────

const base = PA.baseline(history, 'me', { matchup: 'OvH' });
assert.strictEqual(base.scope, 'matchup');
assert.strictEqual(base.t2.median, 260000);
assert.strictEqual(base.workersAt5m.median, 20);
assert.ok(base.expansionRate > 50, 'expansion habit should register');

// Thin matchup falls back to all games and says so.
const thin = PA.baseline(history, 'me', { matchup: 'OvU' });
assert.strictEqual(thin.scope, 'all', 'thin matchup must fall back to all games');

// The reviewed game must be excludable from its own baseline.
const skewed = history.concat([mkGame(99, { t2: 900000 })]);
const excl = PA.baseline(skewed, 'me', { matchup: 'OvH', excludeKey: 'k99' });
assert.strictEqual(excl.t2.median, 260000, 'excludeKey failed — the game graded itself');

// ── grade(): a normal game grades near the middle with no mistakes ───────────

const normal = GR.grade(mkGame(50), '1', base);
assert.strictEqual(normal.result, 'win');
assert.strictEqual(normal.grades.length, 5);
for (const g of normal.grades) {
  assert.ok(g.score === null || (g.score >= 0 && g.score <= 100), `${g.key} out of range`);
  assert.ok(g.note && g.note.length, `${g.key} has no note`);
}
const econ = normal.grades.find(g => g.key === 'economy');
assert.ok(econ.score >= 40 && econ.score <= 65, `normal economy graded ${econ.score}, expected ~50`);
assert.strictEqual(normal.mistakes.length, 0,
  `a normal game flagged mistakes: ${normal.mistakes.map(m => m.kind).join(',')}`);

// ── Named mistakes fire with timestamps ───────────────────────────────────────

// Late T2 (6:20 vs 4:20 median) + worker deficit (15 vs 20).
const sloppy = GR.grade(mkGame(51, { t2: 380000, w5: 15 }), '1', base);
const kinds = sloppy.mistakes.map(m => m.kind);
assert.ok(kinds.includes('lateT2'), `lateT2 missing from ${kinds}`);
assert.ok(kinds.includes('workerDeficit'), `workerDeficit missing from ${kinds}`);
const lateT2 = sloppy.mistakes.find(m => m.kind === 'lateT2');
assert.strictEqual(lateT2.t, 380000, 'lateT2 must carry the seekable time');
assert.ok(lateT2.text.includes('your median'), 'mistake text must name the benchmark');

// Hero lost to creeps outranks everything and carries its time.
const creeped = GR.grade(mkGame(52, {
  combat: {
    heroKills: [],
    heroDeaths: [{ t: 7 * MIN, tf: '7:00', itemId: 'Obla', name: 'Blademaster', level: 3, toCreeps: true }],
    wipesFor: 0, wipesAgainst: 0, biggestSwing: null
  }
}), '1', base);
assert.strictEqual(creeped.mistakes[0].kind, 'creepDeath');
assert.strictEqual(creeped.mistakes[0].t, 7 * MIN);

// At most three mistakes survive, ranked.
const disaster = GR.grade(mkGame(53, {
  t2: 380000, w5: 15, expansion: undefined, duration: 20 * MIN,
  stallFrom: 6 * MIN,
  combat: {
    heroKills: [],
    heroDeaths: [
      { t: 7 * MIN, tf: '7:00', itemId: 'Obla', name: 'Blademaster', level: 3, toCreeps: true },
      { t: 12 * MIN, tf: '12:00', itemId: 'Otch', name: 'Tauren Chieftain', level: 2 }
    ],
    wipesFor: 0, wipesAgainst: 2,
    biggestSwing: { t: 12 * MIN, tf: '12:00', swing: 1200, won: false }
  }
}), '1', base);
assert.strictEqual(disaster.mistakes.length, 3, 'mistakes must cap at three');
assert.strictEqual(disaster.mistakes[0].kind, 'creepDeath', 'ranking must hold');
const army = disaster.grades.find(g => g.key === 'army');
assert.ok(army.score < 40, `two wipes + lost fight graded army ${army.score}`);

// ── Highlights fire on the good side ─────────────────────────────────────────

const heroic = GR.grade(mkGame(54, {
  combat: {
    heroKills: [
      { t: 8 * MIN, tf: '8:00', itemId: 'Hamg', name: 'Archmage', level: 3 },
      { t: 11 * MIN, tf: '11:00', itemId: 'Hmkg', name: 'Mountain King', level: 2 }
    ],
    heroDeaths: [], wipesFor: 1, wipesAgainst: 0,
    biggestSwing: { t: 11 * MIN, tf: '11:00', swing: 1500, won: true }
  }
}), '1', base);
assert.ok(heroic.highlights.length >= 1 && heroic.highlights.length <= 2);
assert.ok(heroic.highlights.some(h => h.kind === 'wonFight'));

// A swing UNDER the threshold must stay quiet — the constant is calibrated
// against the real corpus (a 700g trigger fired on 31% of seats, which is
// near-tautological), so a test that passed at any threshold would not be
// testing the calibration at all.
const smallSwing = GR.grade(mkGame(59, {
  combat: {
    heroKills: [], heroDeaths: [], wipesFor: 0, wipesAgainst: 0,
    biggestSwing: { t: 9 * MIN, tf: '9:00', swing: 400, won: false }
  }
}), '1', base);
assert.ok(!smallSwing.mistakes.some(m => m.kind === 'lostFight'),
  'a small trade must not be reported as losing the big fight');
const heroG = heroic.grades.find(g => g.key === 'hero');
assert.ok(heroG.score > 60, `2-0 hero trade graded ${heroG.score}`);

// ── Benchmarks colour correctly and APM stays neutral ─────────────────────────

const b = sloppy.benchmarks.find(x => x.key === 't2');
assert.strictEqual(b.dir, 'behind', 'late T2 must read behind');
const bw = sloppy.benchmarks.find(x => x.key === 'workersAt5m');
assert.strictEqual(bw.dir, 'behind');
const fast = GR.grade(mkGame(55, { t2: 180000 }), '1', base);
assert.strictEqual(fast.benchmarks.find(x => x.key === 't2').dir, 'ahead');
assert.strictEqual(normal.benchmarks.find(x => x.key === 'apmEffective').dir, null,
  'APM must not claim a direction');

// ── Degradation: no baseline, no combat, missing seat ─────────────────────────

const noBase = GR.grade(mkGame(56, { t2: 380000, w5: 15 }), '1', null);
assert.ok(noBase.grades.every(g => g.score === null || (g.score >= 0 && g.score <= 100)));
assert.ok(!noBase.mistakes.some(m => m.kind === 'lateT2'),
  'benchmark mistakes must not fire without a baseline');
assert.strictEqual(noBase.baselineScope, null);

const preV3 = mkGame(57, { combat: null });
const gradedPreV3 = GR.grade(preV3, '1', base);
assert.ok(gradedPreV3.grades.find(g => g.key === 'hero').score !== undefined,
  'pre-v3 summary must still grade');
assert.ok(!gradedPreV3.mistakes.some(m => ['creepDeath', 'heroDeficit', 'lostFight'].includes(m.kind)),
  'fight mistakes must not fire without the combat ledger');

assert.strictEqual(GR.grade(mkGame(58), '9', base), null, 'missing seat must return null');

// Headline is always a sentence.
for (const r of [normal, sloppy, disaster, heroic, noBase]) {
  assert.ok(r.headline && r.headline.length > 5, 'headline missing');
}

console.log('test-game-report: all assertions passed');
console.log(`  normal game     → ${normal.headline} [${normal.grades.map(g => `${g.key}:${g.score}`).join(' ')}]`);
console.log(`  sloppy game     → ${sloppy.headline}`);
console.log(`    mistakes: ${sloppy.mistakes.map(m => `${m.tf ?? '—'} ${m.text}`).join(' | ')}`);
console.log(`  disaster game   → ${disaster.headline}`);
console.log(`    mistakes: ${disaster.mistakes.map(m => `${m.tf ?? '—'} ${m.text}`).join(' | ')}`);
console.log(`  heroic game     → ${heroic.headline}`);
console.log(`    highlights: ${heroic.highlights.map(h => `${h.tf} ${h.text}`).join(' | ')}`);
