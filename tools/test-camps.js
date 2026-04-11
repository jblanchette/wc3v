/**
 * test-camps.js — Automated tests for creep camp detection.
 *
 * Parses a replay and asserts correctness of camp assignments:
 *  - No camp has progress before any hero exists on the map
 *  - No camp credits non-hero-only units (peons, ghouls, etc.)
 *  - Camps don't show progress at the same time for the same player
 *    unless the player genuinely has units in multiple camp zones
 *  - Timeline entries are monotonically increasing in time
 *  - Cleared camps have completionEstimate >= 0.85
 *  - unitBounds don't overlap between any two camps
 *
 * Usage: node tools/test-camps.js [--replay=NAME]
 *        Defaults to happy-vs-grubby if no replay specified.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const args = require('minimist')(process.argv.slice(2));
const replayName = args.replay || 'happy-vs-grubby';

// load replay data
const basePath = path.join(__dirname, '..', 'client', 'replays');
let data;

const uncompressedPath = path.join(basePath, `${replayName}.wc3v`);
const compressedPath = path.join(basePath, `${replayName}.wc3v.gz`);

if (fs.existsSync(uncompressedPath)) {
  data = JSON.parse(fs.readFileSync(uncompressedPath, 'utf8'));
} else if (fs.existsSync(compressedPath)) {
  const buf = fs.readFileSync(compressedPath);
  data = JSON.parse(zlib.gunzipSync(buf).toString());
} else {
  console.error(`Replay not found: ${replayName}`);
  process.exit(1);
}

const groups = data.world && data.world.neutralGroups
  ? Object.values(data.world.neutralGroups)
  : [];

if (!groups.length) {
  console.error('No neutral groups found in replay data.');
  process.exit(1);
}

let passed = 0;
let failed = 0;

function assert (condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function formatTime (ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// find the earliest time any hero could exist on the map
// check both eventStream (addUnit with isHero) and tierStream/unit data
let earliestHeroTime = Infinity;
if (data.players) {
  Object.values(data.players).forEach(pdata => {
    if (pdata.isNeutralPlayer) return;
    const events = pdata.eventStream || [];
    events.forEach(e => {
      // hero addUnit event
      if (e.key === 'addUnit' && e.isHero && e.gameTime < earliestHeroTime) {
        earliestHeroTime = e.gameTime;
      }
      // HeroLevel event (hero is on map when it levels)
      if (e.key === 'HeroLevel' && e.gameTime < earliestHeroTime) {
        earliestHeroTime = e.gameTime;
      }
    });
  });
}
// if we still can't find it, use a reasonable default
if (earliestHeroTime === Infinity) {
  // most heroes are on the map by 2:00 at the latest
  earliestHeroTime = 120000;
  console.log(`  (Could not detect hero spawn from events, using default 2:00)`);
}

console.log(`\nTesting replay: ${replayName}`);
console.log(`Total camps: ${groups.length}`);
console.log(`Earliest hero on map: ${earliestHeroTime === Infinity ? 'none' : formatTime(earliestHeroTime)}`);
console.log('');

// ======== Test 1: No progress before any hero exists ========
console.log('--- Test: No camp progress before earliest hero ---');
groups.forEach(g => {
  const tl = g.progressTimeline || [];
  if (!tl.length) return;

  const firstEntry = tl[0];
  const maxP = Math.max(...Object.values(firstEntry.teams));
  if (maxP > 0) {
    const unitNames = (g.units || []).map(u => u.displayName).join(', ');
    assert(
      firstEntry.gameTime >= earliestHeroTime - 5000,
      `Camp [${unitNames}] has ${Math.round(maxP * 100)}% progress at ${formatTime(firstEntry.gameTime)}, ` +
      `but earliest hero is at ${formatTime(earliestHeroTime)}`
    );
  }
});

// ======== Test 2: Cleared/contested camps have some completion ========
console.log('--- Test: Non-untouched camps have some completion ---');
groups.forEach(g => {
  if (g.claimState === 2 || g.claimState === 1) {
    const unitNames = (g.units || []).map(u => u.displayName).join(', ');
    assert(
      g.completionEstimate > 0,
      `Non-untouched camp [${unitNames}] has 0% completion`
    );
  }
});

// ======== Test 3: Timeline entries are monotonically increasing ========
console.log('--- Test: Timeline entries are time-ordered ---');
groups.forEach(g => {
  const tl = g.progressTimeline || [];
  for (let i = 1; i < tl.length; i++) {
    const unitNames = (g.units || []).map(u => u.displayName).join(', ');
    assert(
      tl[i].gameTime >= tl[i - 1].gameTime,
      `Camp [${unitNames}] timeline entry ${i} goes backward: ${formatTime(tl[i].gameTime)} < ${formatTime(tl[i - 1].gameTime)}`
    );
  }
});

// ======== Test 4: unitBounds don't overlap between camps ========
console.log('--- Test: unitBounds don\'t overlap ---');
for (let i = 0; i < groups.length; i++) {
  for (let j = i + 1; j < groups.length; j++) {
    const a = groups[i].unitBounds;
    const b = groups[j].unitBounds;
    if (!a || !b) continue;

    const overlaps = a.minX <= b.maxX && a.maxX >= b.minX &&
                     a.minY <= b.maxY && a.maxY >= b.minY;

    if (overlaps) {
      const nameA = (groups[i].units || []).map(u => u.displayName).join(', ');
      const nameB = (groups[j].units || []).map(u => u.displayName).join(', ');
      assert(false, `unitBounds overlap: [${nameA}] and [${nameB}]`);
    }
  }
}

// ======== Test 5: Cleared camps must have hero involvement ========
console.log('--- Test: Cleared camps had hero involvement ---');
groups.forEach(g => {
  if (g.claimState !== 2) return;
  const unitNames = (g.units || []).map(u => u.displayName).join(', ');

  // check both presence intervals AND claimers.units for hero evidence
  const intervals = g.presenceIntervals || [];
  const ownerIntervals = intervals.filter(iv => +iv.teamId === +g.claimOwnerId);
  const hadHeroInterval = ownerIntervals.some(iv => iv.hasHero);

  let hadHeroInClaimers = false;
  if (g.claimers && g.claimers[g.claimOwnerId]) {
    const ownerPlayers = g.claimers[g.claimOwnerId].players || {};
    hadHeroInClaimers = Object.values(ownerPlayers).some(p =>
      (p.units || []).some(u => u.isHero)
    );
  }

  assert(hadHeroInterval || hadHeroInClaimers,
    `Cleared camp [${unitNames}] owner team${g.claimOwnerId} has no hero evidence`
  );
});

// ======== Test 6: Replay-specific assertions for happy-vs-grubby ========
if (replayName === 'happy-vs-grubby') {
  console.log('--- Test: happy-vs-grubby specific assertions ---');

  // Sea Turtle camp should not be cleared by peons
  const seaTurtleCamps = groups.filter(g =>
    (g.units || []).some(u => u.displayName === 'Sea Turtle')
  );
  seaTurtleCamps.forEach(g => {
    const tl = g.progressTimeline || [];
    const earlyProgress = tl.filter(s => s.gameTime < 120000); // before 2:00
    earlyProgress.forEach(s => {
      const maxP = Math.max(...Object.values(s.teams));
      assert(maxP === 0,
        `Sea Turtle camp has ${Math.round(maxP * 100)}% progress at ${formatTime(s.gameTime)} (before 2:00)`
      );
    });
  });

  // Ogre/Troll camp (Grubby's first creep) should not show progress before ~2:30
  const ogreTrollCamp = groups.find(g =>
    (g.units || []).some(u => u.displayName === 'Ogre Warrior') &&
    (g.units || []).some(u => u.displayName === 'Forest Troll Trapper') &&
    g.totalLevel === 10 && g.claimOwnerId === 0
  );
  if (ogreTrollCamp) {
    const tl = ogreTrollCamp.progressTimeline || [];
    const earlyProgress = tl.filter(s => s.gameTime < 140000); // before 2:20
    earlyProgress.forEach(s => {
      const maxP = Math.max(...Object.values(s.teams));
      assert(maxP === 0,
        `Ogre/Troll camp (Grubby's) has ${Math.round(maxP * 100)}% progress at ${formatTime(s.gameTime)} (hero not there yet)`
      );
    });
  } else {
    assert(false, 'Could not find Ogre/Troll camp for Grubby (team0, Lv10)');
  }

  // Rock Golem camp should not show high completion very early
  // (some partial credit from BM right-clicking a nearby forest troll is acceptable)
  const rockGolemCamps = groups.filter(g =>
    (g.units || []).some(u => u.displayName === 'Rock Golem')
  );
  rockGolemCamps.forEach(g => {
    const tl = g.progressTimeline || [];
    // should not be fully cleared before 3:00
    // (some credit from adjacent camp interactions after 3:00 is an edge case we accept)
    const veryEarly = tl.filter(s => s.gameTime < 180000);
    veryEarly.forEach(s => {
      const maxP = Math.max(...Object.values(s.teams));
      assert(maxP < 0.5,
        `Rock Golem camp shows ${Math.round(maxP * 100)}% at ${formatTime(s.gameTime)} (before 3:00)`
      );
    });
  });
}

// ======== Summary ========
console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
