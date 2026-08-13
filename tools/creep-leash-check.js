/**
 * creep-leash-check.js — assert the hard invariants of simulated creep motion.
 *
 * lib/CreepGuardSim.js reconstructs camp creep aggro, chase and leash-back and
 * bakes the result into each creep's exported path. That reconstruction is only
 * legitimate if it obeys the rules of the thing it reconstructs, and those
 * rules are checkable, not a matter of taste:
 *
 *   1. LEASH        no creep sample may lie further than the creep leash from
 *                   that creep's spawn point. WC3 creeps guard a position and
 *                   never chase past creepGuardReturnDistance from it.
 *   2. DEAD IS DEAD no creep may move at or after its camp's clearedTime —
 *                   the camp's creeps are dead by then.
 *   3. NO WANDERING a creep belongs to exactly one camp and may not drift into
 *                   the footprint of a camp its own leash cannot reach. Camps
 *                   sitting closer together than one leash have overlapping
 *                   guard circles, so THAT overlap is map layout, not
 *                   misbehaviour, and is counted separately.
 *   4. MONOTONIC    path samples must be time-ordered, as every other consumer
 *                   (client interpolation, anchor audit) assumes.
 *
 * A violation is a bug in the simulation, not a tuning question, so this exits
 * non-zero. Read-only; it changes nothing.
 *
 * Usage:
 *   node tools/creep-leash-check.js                 — whole corpus
 *   node tools/creep-leash-check.js --replay=ID     — one replay, verbose
 *   node tools/creep-leash-check.js --limit=N
 *   node tools/creep-leash-check.js --verbose       — list every violation
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const { resolveCampLeash } = require('../helpers/mappings');

const REPLAYS_DIR = path.join(__dirname, '..', 'client', 'replays');
const NEUTRAL_PLAYER_ID = '1042';

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});
const VERBOSE = !!args.verbose || !!args.replay;

const fmt = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const loadReplay = (id) => {
  const base = path.join(REPLAYS_DIR, id);
  if (fs.existsSync(`${base}.wc3v`)) {
    return JSON.parse(fs.readFileSync(`${base}.wc3v`, 'utf8'));
  }
  if (fs.existsSync(`${base}.wc3v.gz`)) {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(`${base}.wc3v.gz`)).toString());
  }
  return null;
};

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// Shortest distance from a point to an axis-aligned box (0 when inside).
const distPointToAabb = (px, py, b) => {
  const dx = px < b.minX ? (b.minX - px) : (px > b.maxX ? px - b.maxX : 0);
  const dy = py < b.minY ? (b.minY - py) : (py > b.maxY ? py - b.maxY : 0);
  return Math.hypot(dx, dy);
};

// Tolerance for the clamp arithmetic + the 2-decimal rounding in the export.
const EPS_WU = 2;

// A creep further than this from its spawn at the end of its motion, on a camp
// that was never cleared, counts as stranded (see the STRANDED check below).
const STRANDED_WU = 200;

const checkReplay = (id, data) => {
  const out = {
    id, creeps: 0, movingCreeps: 0, samples: 0,
    leashViolations: [], postClearViolations: [],
    foreignCampViolations: [], orderViolations: [], stranded: [],
    adjacentCampOverlaps: 0
  };

  const world = data.world || {};
  const groups = world.neutralGroups || {};
  const leash = (world.campLeash && world.campLeash.distance > 0)
    ? world.campLeash.distance
    : resolveCampLeash(null).distance;
  out.leash = leash;

  const players = data.players || {};
  const neutral = players[NEUTRAL_PLAYER_ID];
  if (!neutral || !neutral.units) return out;

  // camp footprints, for the no-wandering check
  const campBoxes = Object.values(groups).map(g => ({
    uuid: g.uuid, b: g.unitBounds || g.bounds, clearedTime: g.clearedTime
  })).filter(c => c.b);

  // per-camp motion tally, so it is obvious WHICH camps came alive
  out.byCamp = {};

  neutral.units.forEach(u => {
    if (!u || !u.neutralGroupId) return;
    const camp = groups[u.neutralGroupId];
    if (!camp) return;
    out.creeps++;

    const tally = out.byCamp[camp.uuid] || (out.byCamp[camp.uuid] = {
      level: camp.totalLevel, clearedTime: camp.clearedTime,
      creeps: 0, moving: 0, maxLeash: 0, stranded: 0
    });
    tally.creeps++;

    const p = (u.path || []).filter(s => s && s.x != null && s.y != null);
    if (p.length <= 1) return;
    out.movingCreeps++;
    tally.moving++;
    out.samples += p.length;

    // Spawn = the FIRST sample. CreepGuardSim only ever appends, so sample 0
    // is the map-file spawn point the leash is measured from.
    const spawn = p[0];

    // STRANDED: a creep on a camp that was never cleared must end up back on
    // its guard post. Its creeps are alive at the end of the replay, so a
    // creep left standing in a field is a permanent visual artifact — a troll
    // parked in the open forever. (On a CLEARED camp the creeps are dead and
    // hidden, so where they stopped does not matter.)
    const last = p[p.length - 1];
    if (camp.clearedTime == null &&
        dist(last.x, last.y, spawn.x, spawn.y) > STRANDED_WU) {
      out.stranded.push({
        unit: u.displayName || u.itemId, campUuid: camp.uuid,
        gameTime: last.gameTime, distance: Math.round(dist(last.x, last.y, spawn.x, spawn.y))
      });
      tally.stranded++;
    }

    let prevT = -Infinity;
    p.forEach((s, i) => {
      const d = dist(s.x, s.y, spawn.x, spawn.y);
      if (d > tally.maxLeash) tally.maxLeash = d;
      if (d > leash + EPS_WU) {
        out.leashViolations.push({
          unit: u.displayName || u.itemId, campUuid: camp.uuid,
          gameTime: s.gameTime, distance: Math.round(d), leash
        });
      }
      if (camp.clearedTime != null && s.gameTime > camp.clearedTime && i > 0) {
        out.postClearViolations.push({
          unit: u.displayName || u.itemId, campUuid: camp.uuid,
          gameTime: s.gameTime, clearedTime: camp.clearedTime
        });
      }
      if (s.gameTime < prevT) {
        out.orderViolations.push({
          unit: u.displayName || u.itemId, gameTime: s.gameTime, prev: prevT
        });
      }
      prevT = s.gameTime;

      // Entered a DIFFERENT camp's footprint.
      //
      // This is only a violation when that footprint was out of reach to begin
      // with. Camps sitting closer together than one leash have geometrically
      // overlapping guard circles, so a creep defending its own spawn can stand
      // inside its neighbour's box without ever breaking its leash — that is
      // true in the real game too (pulling one camp into the next is a well
      // known way to die). Counting those would be grading map layout, not
      // behaviour, so they are reported separately as `adjacent`.
      for (const c of campBoxes) {
        if (c.uuid === camp.uuid) continue;
        if (s.x >= c.b.minX && s.x <= c.b.maxX && s.y >= c.b.minY && s.y <= c.b.maxY) {
          const reachable = distPointToAabb(spawn.x, spawn.y, c.b) <= leash;
          if (reachable) {
            out.adjacentCampOverlaps++;
          } else {
            out.foreignCampViolations.push({
              unit: u.displayName || u.itemId,
              from: camp.uuid, into: c.uuid, gameTime: s.gameTime
            });
          }
          break;
        }
      }
    });
  });

  return out;
};

// ── run ───────────────────────────────────────────────────────────────────
let ids;
if (args.replay) {
  ids = [String(args.replay)];
} else {
  ids = fs.readdirSync(REPLAYS_DIR)
    .filter(f => f.endsWith('.wc3v.gz'))
    .map(f => f.replace(/\.wc3v\.gz$/, ''))
    .sort();
  if (args.limit) ids = ids.slice(0, parseInt(args.limit, 10));
}

const totals = {
  replays: 0, creeps: 0, movingCreeps: 0, samples: 0,
  leash: 0, postClear: 0, foreign: 0, order: 0, adjacent: 0, stranded: 0, replaysWithViolations: 0
};

ids.forEach(id => {
  let data = null;
  try { data = loadReplay(id); } catch (e) { data = null; }
  if (!data) return;
  totals.replays++;

  const r = checkReplay(id, data);
  totals.creeps += r.creeps;
  totals.movingCreeps += r.movingCreeps;
  totals.samples += r.samples;

  const bad = r.leashViolations.length + r.postClearViolations.length +
    r.foreignCampViolations.length + r.orderViolations.length;
  totals.leash += r.leashViolations.length;
  totals.postClear += r.postClearViolations.length;
  totals.foreign += r.foreignCampViolations.length;
  totals.order += r.orderViolations.length;
  totals.adjacent += r.adjacentCampOverlaps;
  totals.stranded += r.stranded.length;
  if (bad) totals.replaysWithViolations++;

  if (VERBOSE && (bad || args.replay)) {
    console.log(`\n=== ${id} ===`);
    console.log(`  leash=${r.leash}  creeps=${r.creeps}  moving=${r.movingCreeps}  samples=${r.samples}`);
    Object.values(r.byCamp || {})
      .sort((a, b) => (a.clearedTime == null ? Infinity : a.clearedTime) -
                      (b.clearedTime == null ? Infinity : b.clearedTime))
      .forEach(c => {
        if (!c.moving && c.clearedTime == null) return;   // untouched camp, nothing to say
        console.log(`    Lv${String(c.level).padStart(2)}  cleared ${c.clearedTime != null ? fmt(c.clearedTime) : '—'}` +
          `  ${c.moving}/${c.creeps} creeps moved, furthest ${Math.round(c.maxLeash)}wu from spawn`);
      });
    r.leashViolations.slice(0, 10).forEach(v =>
      console.log(`  LEASH      ${v.unit} at ${fmt(v.gameTime)} is ${v.distance}wu from spawn (leash ${v.leash})`));
    r.postClearViolations.slice(0, 10).forEach(v =>
      console.log(`  POST-CLEAR ${v.unit} moved at ${fmt(v.gameTime)}, camp cleared ${fmt(v.clearedTime)}`));
    r.foreignCampViolations.slice(0, 10).forEach(v =>
      console.log(`  WANDERED   ${v.unit} entered another camp at ${fmt(v.gameTime)}`));
    r.orderViolations.slice(0, 10).forEach(v =>
      console.log(`  ORDER      ${v.unit} sample at ${v.gameTime} follows ${v.prev}`));
  }
});

console.log(`\n──────── CREEP LEASH CHECK ────────`);
console.log(`replays: ${totals.replays}`);
console.log(`creeps: ${totals.creeps} total, ${totals.movingCreeps} with simulated motion, ` +
  `${totals.samples} path samples`);
console.log('');
console.log(`  leash violations       : ${totals.leash}`);
console.log(`  post-clear movement    : ${totals.postClear}`);
console.log(`  wandered to other camp : ${totals.foreign}`);
console.log(`  out-of-order samples   : ${totals.order}`);
console.log('');
console.log(`  stranded (uncleared camp, creep not home at end): ${totals.stranded}`);
console.log('');
console.log(`  adjacent-camp overlap  : ${totals.adjacent} (not a violation — camps closer`);
console.log(`                           together than one leash have overlapping guard circles)`);

const failed = totals.leash + totals.postClear + totals.foreign + totals.order;
if (failed) {
  console.log(`\nFAIL: ${failed} invariant violation(s) across ${totals.replaysWithViolations} replay(s)`);
  process.exit(1);
}
console.log(`\nPASS: all simulated creep motion respects the leash, the clear, and its own camp.`);
process.exit(0);
