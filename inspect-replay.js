/**
 * inspect-replay.js — Query parsed replay data for debugging.
 *
 * Usage:
 *   node inspect-replay.js --replay=happy-vs-grubby [options]
 *
 * Options:
 *   --replay=NAME       Replay name (looks in client/replays/NAME.wc3v.gz or .wc3v)
 *   --player=ID         Filter to a specific player ID (e.g. 1, 2)
 *   --show=SECTION      What to display (comma-separated). Options:
 *                          players    - player names, races, team IDs
 *                          events     - eventStream entries (addUnit, addBuilding, etc.)
 *                          expansions - only addBuilding events flagged as expansions
 *                          units      - exported unit list with flags
 *                          combatdata - per-unit-type attack timing (cooldown/damage point/backswing/range)
 *                          paths      - unit movement paths with groupId data
 *                          footprints - per-hero pre-baked footprint stamp counts (trail render)
 *                          positions  - position-stream health (density, gaps, integrity)
 *                          kinematics - KinematicResim validation: move-speed cap + facing coverage
 *                          pathdump   - full per-node coord+facing trace (with --search)
 *                          workers    - worker snapshots from events
 *                          tiers      - tier transition data
 *                          validation - validator severity/confidence + warnings
 *                          supply     - supply building analysis + confidence
 *                          items      - item purchases, uses, and summary
 *                          mercs      - mercenary hires and tavern hero purchases
 *                          summary    - compact build order overview
 *                          camps      - neutral creep camp claim data
 *                          camps-debug - camp progressive timeline + interval details
 *                          camps-credit - per-player credit, confidence, evidence (Project C)
 *                          battles    - detected combat battles with category + tracker box bounds
 *                          battles-debug - one battle's full signal list + tracker samples (needs --battle=ID)
 *                          teleports  - structured teleport events (TP Scroll, Mass Teleport, Blink, Staff)
 *                          dominance  - per-player dominance score series + momentum events
 *                          basegrid   - base pathing grid data (from WPM)
 *                          all        - everything
 *   --filter=KEY        Filter events by key (e.g. addUnit, addBuilding, HeroLevel)
 *   --limit=N           Limit output to N entries per section (default: 50)
 *   --search=TEXT       Search events/units by displayName (case-insensitive)
 *
 * Examples:
 *   node inspect-replay.js --replay=happy-vs-grubby --show=players
 *   node inspect-replay.js --replay=happy-vs-grubby --show=events --player=1 --limit=20
 *   node inspect-replay.js --replay=happy-vs-grubby --show=units --search=skeleton
 *   node inspect-replay.js --replay=happy-vs-grubby --show=workers --player=1
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

if (!args.replay) {
  console.log('Usage: node inspect-replay.js --replay=NAME [--show=SECTION] [--player=ID] [--limit=N]');
  console.log('Run with --help for full options.');
  process.exit(1);
}

// Load replay data
const replayName = args.replay;
const basePath = path.join(__dirname, 'client', 'replays', replayName);
let data;

try {
  // prefer uncompressed (from --debug runs)
  if (fs.existsSync(`${basePath}.wc3v`)) {
    data = JSON.parse(fs.readFileSync(`${basePath}.wc3v`, 'utf8'));
    console.log(`Loaded: ${basePath}.wc3v (uncompressed)\n`);
  } else if (fs.existsSync(`${basePath}.wc3v.gz`)) {
    const gz = fs.readFileSync(`${basePath}.wc3v.gz`);
    data = JSON.parse(zlib.gunzipSync(gz).toString());
    console.log(`Loaded: ${basePath}.wc3v.gz\n`);
  } else {
    console.error(`Not found: ${basePath}.wc3v(.gz)`);
    process.exit(1);
  }
} catch (e) {
  console.error('Error loading replay:', e.message);
  process.exit(1);
}

const limit = parseInt(args.limit) || 50;
const showSections = (args.show || 'summary').split(',');
const showAll = showSections.includes('all');
const filterKey = args.filter || null;
const searchText = args.search ? args.search.toLowerCase() : null;
const filterPlayer = args.player || null;

function formatTime (ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getPlayers () {
  const replayPlayers = data.replay ? data.replay.players : {};
  const gamePlayers = data.players || {};
  const result = [];

  for (const [pid, pdata] of Object.entries(gamePlayers)) {
    const meta = replayPlayers[pid] || {};
    result.push({
      id: pid,
      name: meta.name || '??',
      race: pdata.race || meta.raceDetected || '?',
      teamId: pdata.teamId,
      isNeutral: pdata.isNeutralPlayer || false,
      eventCount: (pdata.eventStream || []).length,
      unitCount: (pdata.units || []).length,
      tierCount: (pdata.tierStream || []).length
    });
  }

  return result;
}

function shouldIncludePlayer (pid) {
  return !filterPlayer || pid === filterPlayer;
}

// --- Players ---
if (showAll || showSections.includes('players')) {
  console.log('=== PLAYERS ===');
  const players = getPlayers();
  players.forEach(p => {
    console.log(`  [${p.id}] ${p.name} (${p.race}) team=${p.teamId} neutral=${p.isNeutral} events=${p.eventCount} units=${p.unitCount}`);
  });
  if (data.winner) {
    console.log(`  Winner: player ${data.winner.playerId} (team ${data.winner.teamId}) via ${data.winner.method} [${data.winner.confidence}]`);
  } else {
    console.log('  Winner: unknown (no leave records — replay parsed before winner capture)');
  }
  console.log('');
}

// --- Events ---
if (showAll || showSections.includes('events')) {
  console.log('=== EVENTS ===');
  for (const [pid, pdata] of Object.entries(data.players || {})) {
    if (!shouldIncludePlayer(pid)) continue;
    if (pdata.isNeutralPlayer) continue;

    const meta = (data.replay && data.replay.players[pid]) || {};
    console.log(`\n  Player ${pid}: ${meta.name || '??'} (${pdata.race})`);

    let events = pdata.eventStream || [];
    if (filterKey) events = events.filter(e => e.key === filterKey);
    if (searchText) {
      events = events.filter(e => {
        const name = e.displayName || (e.unit && e.unit.displayName) || (e.building && e.building.displayName) || '';
        return name.toLowerCase().includes(searchText);
      });
    }

    events.slice(0, limit).forEach((e, i) => {
      const time = formatTime(e.gameTime || 0);
      const w = e.workers || {};
      const wStr = `g=${w.onGold||0} l=${w.onLumber||0} b=${w.onBuild||0} gh=${w.ghoulsOnLumber||0}`;

      if (e.key === 'addUnit' && e.unit) {
        const u = e.unit;
        const flags = [
          u.isSummon && 'SUMMON',
          u.isIllusion && 'ILLUSION',
          u.isHero && 'HERO',
          u.isTraining && 'TRAINING'
        ].filter(Boolean).join(',') || '-';
        console.log(`    [${time}] ${e.key}: ${u.displayName} (${u.itemId}) flags=[${flags}] food=${u.foodUsed||0} | workers: ${wStr}`);
      } else if (e.key === 'addBuilding' && e.building) {
        const b = e.building;
        const expoTag = e.isExpansion ? ' [EXPANSION]' : '';
        const inferTag = e.isInferred ? ' [INFERRED]' : '';
        console.log(`    [${time}] ${e.key}: ${b.displayName} (${b.itemId}) gold=${b.goldCost||0} lum=${b.lumberCost||0} food+${b.foodMade||0}${expoTag}${inferTag} | workers: ${wStr}`);
      } else if (e.key === 'HeroLevel') {
        const slLen = (e.spellList || []).length;
        const lsLen = e.learnedSkills ? Object.keys(e.learnedSkills).length : 0;
        console.log(`    [${time}] ${e.key}: ${(e.unit||{}).displayName} -> Lv${e.newLevel} spell=${(e.spell||{}).displayName||'?'} (spellList=${slLen} learned=${lsLen})`);
      } else if (e.key === 'research') {
        const bName = e.building ? ` @ ${e.building.displayName}` : '';
        console.log(`    [${time}] research: ${e.displayName} Lv${e.level} [${e.category}] gold=${e.goldCost||0} lum=${e.lumberCost||0}${bName} | workers: ${wStr}`);
      } else if (e.key === 'uproot' || e.key === 'root') {
        const b = e.building || {};
        console.log(`    [${time}] ${e.key.toUpperCase()}: ${b.displayName||'?'} (${b.itemId||'?'})`);
      } else {
        const name = (e.unit && e.unit.displayName) || (e.building && e.building.displayName) || '';
        console.log(`    [${time}] ${e.key}${name ? ': ' + name : ''} | workers: ${wStr}`);
      }
    });

    if (events.length > limit) {
      console.log(`    ... (${events.length - limit} more, use --limit to see more)`);
    }
  }
  console.log('');
}

// --- Expansions ---
if (showAll || showSections.includes('expansions')) {
  console.log('=== EXPANSIONS ===');
  let found = 0;
  for (const [pid, pdata] of Object.entries(data.players || {})) {
    if (!shouldIncludePlayer(pid)) continue;
    if (pdata.isNeutralPlayer) continue;

    const meta = (data.replay && data.replay.players[pid]) || {};
    const expansions = (pdata.eventStream || []).filter(e => e.key === 'addBuilding' && e.isExpansion);
    if (!expansions.length) continue;

    found++;
    console.log(`\n  Player ${pid}: ${meta.name || '??'} (${pdata.race})`);
    expansions.forEach(e => {
      const b = e.building;
      const time = formatTime(e.gameTime || 0);
      const w = e.workers || {};
      const wStr = `g=${w.onGold||0} l=${w.onLumber||0} b=${w.onBuild||0}`;
      console.log(`    [${time}] EXPANSION: ${b.displayName} (${b.itemId}) gold=${b.goldCost||0} lum=${b.lumberCost||0} | workers: ${wStr}`);
    });
  }
  if (!found) console.log('  (no expansions detected in this replay)');
  console.log('');
}

// --- Units ---
if (showAll || showSections.includes('units')) {
  console.log('=== UNITS ===');
  for (const [pid, pdata] of Object.entries(data.players || {})) {
    if (!shouldIncludePlayer(pid)) continue;
    if (pdata.isNeutralPlayer) continue;

    const meta = (data.replay && data.replay.players[pid]) || {};
    console.log(`\n  Player ${pid}: ${meta.name || '??'} (${pdata.race})`);

    let units = pdata.units || [];
    if (searchText) {
      units = units.filter(u => (u.displayName || '').toLowerCase().includes(searchText));
    }

    units.slice(0, limit).forEach(u => {
      const flags = [
        u.isHero && 'HERO',
        u.isSummon && 'SUMMON',
        u.isIllusion && 'ILLUSION',
        u.isBuilding && 'BUILDING',
        u.isUnit && 'UNIT'
      ].filter(Boolean).join(',');
      console.log(`    ${u.displayName} (${u.itemId}) [${flags}] gold=${u.goldCost||0} lum=${u.lumberCost||0} food=${u.foodUsed||0}`);
    });

    if (units.length > limit) {
      console.log(`    ... (${units.length - limit} more)`);
    }
  }
  console.log('');
}

// --- Combat / attack-timing data (SLK → meta.combat, see extract-unit-combat.js) ---
if (showAll || showSections.includes('combatdata')) {
  console.log('=== COMBAT DATA (attack timing) ===');
  console.log('  (cd=cooldown  dmgpt=damage point  bsw=backswing  rng=range, all seconds/wu)');
  for (const [pid, pdata] of Object.entries(data.players || {})) {
    if (!shouldIncludePlayer(pid)) continue;
    if (pdata.isNeutralPlayer) continue;

    const meta = (data.replay && data.replay.players[pid]) || {};
    console.log(`\n  Player ${pid}: ${meta.name || '??'} (${pdata.race})`);

    let units = pdata.units || [];
    if (searchText) units = units.filter(u => (u.displayName || '').toLowerCase().includes(searchText));

    const seen = new Set();          // one line per unit TYPE (itemId), not per instance
    units.forEach(u => {
      if (seen.has(u.itemId)) return;
      seen.add(u.itemId);
      const c = u.meta && u.meta.combat;
      if (!c) return;                // non-combatants (workers, most buildings)
      const w2 = c.weapon2 ? `  +2nd(${c.weapon2.weaponType || '?'} rng=${c.weapon2.range})` : '';
      console.log(`    ${u.displayName} (${u.itemId})  cd=${c.cooldown} dmgpt=${c.damagePoint} bsw=${c.backswing} rng=${c.range} ${c.weaponType || '?'}/${c.attackType || '?'} dmg=${c.minDamage}-${c.maxDamage}${w2}`);
    });
    if (seen.size === 0) console.log('    (no unit combat data — re-parse the replay to populate meta.combat)');
  }
  console.log('');
}

// --- Paths (movement + groupId) ---
if (showAll || showSections.includes('paths')) {
  console.log('=== UNIT PATHS ===');
  for (const [pid, pdata] of Object.entries(data.players || {})) {
    if (!shouldIncludePlayer(pid)) continue;
    if (pdata.isNeutralPlayer) continue;

    const meta = (data.replay && data.replay.players[pid]) || {};
    console.log(`\n  Player ${pid}: ${meta.name || '??'} (${pdata.race})`);

    let units = pdata.units || [];
    // only show units with paths (skip buildings)
    units = units.filter(u => u.path && u.path.length > 0 && !u.isBuilding);
    if (searchText) {
      units = units.filter(u => (u.displayName || '').toLowerCase().includes(searchText));
    }

    units.slice(0, limit).forEach(u => {
      const groupMoves = u.path.filter(p => p.groupId);
      const soloMoves = u.path.filter(p => !p.groupId && !p.isJump);
      const jumps = u.path.filter(p => p.isJump);
      console.log(`    ${u.displayName} (${u.itemId}) path=${u.path.length} group=${groupMoves.length} solo=${soloMoves.length} jumps=${jumps.length}`);

      if (groupMoves.length > 0) {
        const sample = groupMoves.slice(0, 3);
        sample.forEach(p => {
          console.log(`      [${formatTime(p.gameTime)}] pos=(${p.x}, ${p.y}) groupId=${p.groupId}`);
        });
        if (groupMoves.length > 3) console.log(`      ... (${groupMoves.length - 3} more group moves)`);
      }
    });
  }
  console.log('');
}

// --- Path dump (full coordinate trace + building footprints) ---
// Diagnostic for "unit walks through a building" bugs: dumps every path node
// (x,y,time,flags) for units matching --search, plus all building positions
// and walk-footprint dims so you can see whether a recorded path crosses a
// building's blocked cells (parser routing bug) vs a client-side spline cut.
if (showSections.includes('pathdump')) {
  console.log('=== PATH DUMP ===');
  for (const [pid, pdata] of Object.entries(data.players || {})) {
    if (!shouldIncludePlayer(pid)) continue;

    const meta = (data.replay && data.replay.players[pid]) || {};
    console.log(`\n  Player ${pid}: ${meta.name || '??'} (${pdata.race})`);

    let units = (pdata.units || []);
    if (searchText) {
      units = units.filter(u => (u.displayName || '').toLowerCase().includes(searchText));
    }

    // Buildings first — show position + footprint so paths can be checked.
    const buildings = units.filter(u => u.isBuilding);
    if (buildings.length) {
      console.log(`    -- buildings (pos + walk footprint) --`);
      buildings.forEach(b => {
        const p = b.lastPosition || b.spawnPosition || {};
        const fp = b.footprint || {};
        const fpStr = fp.widthTiles != null
          ? `walk=${fp.widthTiles}x${fp.heightTiles}tiles off=(${fp.offsetX||0},${fp.offsetY||0})`
          : 'no footprint';
        console.log(`      ${(b.displayName||'').padEnd(18)}(${b.itemId}) pos=(${Math.round(p.x||0)},${Math.round(p.y||0)}) ${fpStr}`);
      });
    }

    const moveUnits = units.filter(u => !u.isBuilding && u.path && u.path.length);
    moveUnits.slice(0, limit).forEach(u => {
      const bw = (u.buildWindows || []).map(w => `${formatTime(w.start)}-${w.end==null?'open':formatTime(w.end)}`).join(',');
      console.log(`    -- ${u.displayName} (${u.itemId}) uuid=${(u.uuid||'').slice(0,8)} role=${u.primaryRole||'-'} conf=${u.harvestConfident?'Y':'n'} nodes=${u.path.length}${bw?` build=[${bw}]`:''} --`);
      u.path.forEach(p => {
        const facing = (p.facing != null) ? ` ${Math.round(p.facing * 180 / Math.PI)}°` : '';
        const tags = [p.isJump && 'JUMP', p.wasSnapped && 'snap', p.groupId && `g${p.groupId}`].filter(Boolean).join(' ');
        console.log(`        [${formatTime(p.gameTime)}] (${Math.round(p.x)},${Math.round(p.y)})${facing}${tags ? ' ' + tags : ''}`);
      });
    });
  }
  console.log('');
}

// --- Footprints (hero trail pre-bake diagnostic) ---
if (showAll || showSections.includes('footprints')) {
  console.log('=== HERO FOOTPRINTS ===');
  for (const [pid, pdata] of Object.entries(data.players || {})) {
    if (!shouldIncludePlayer(pid)) continue;
    if (pdata.isNeutralPlayer) continue;

    const meta = (data.replay && data.replay.players[pid]) || {};
    console.log(`\n  Player ${pid}: ${meta.name || '??'} (${pdata.race})`);

    const heroes = (pdata.units || []).filter(u => u.meta && u.meta.hero && !u.isIllusion);
    if (!heroes.length) {
      console.log('    (no hero units)');
      continue;
    }
    heroes.forEach(u => {
      const pathLen = (u.path || []).length;
      let status;
      if (!('footprints' in u)) {
        status = '!! MISSING footprints key';
      } else if (!Array.isArray(u.footprints)) {
        status = `!! footprints not array (${typeof u.footprints})`;
      } else if (u.footprints.length === 0) {
        status = 'footprints=[] (empty — path too short / all gaps)';
      } else {
        status = `footprints=${u.footprints.length}`;
      }
      console.log(`    ${u.displayName} (${u.itemId}) uuid=${u.uuid} path=${pathLen} ${status}`);
    });
  }
  console.log('');
}

// --- Position-stream health (Project A diagnostic) ---
if (showAll || showSections.includes('positions')) {
  console.log('=== POSITION STREAM HEALTH ===');
  for (const [pid, pdata] of Object.entries(data.players || {})) {
    if (!shouldIncludePlayer(pid)) continue;
    if (pdata.isNeutralPlayer) continue;

    const meta = (data.replay && data.replay.players[pid]) || {};
    console.log(`\n  Player ${pid}: ${meta.name || '??'} (${pdata.race})`);

    let units = (pdata.units || []).filter(u => u.path && u.path.length > 1 && !u.isBuilding);
    if (searchText) {
      units = units.filter(u => (u.displayName || '').toLowerCase().includes(searchText));
    }

    units.slice(0, limit).forEach(u => {
      const p = u.path;
      let maxGap = 0;       // largest non-jump temporal gap (ms)
      let nonMono = 0;      // gameTime went backwards
      let nan = 0;          // NaN coords
      let jumps = 0;
      for (let i = 0; i < p.length; i++) {
        if (isNaN(p[i].x) || isNaN(p[i].y)) nan++;
        if (p[i].isJump) { jumps++; continue; }
        if (i > 0) {
          const dt = p[i].gameTime - p[i - 1].gameTime;
          if (dt < 0) nonMono++;
          else if (!p[i - 1].isJump && dt > maxGap) maxGap = dt;
        }
      }
      const span = p[p.length - 1].gameTime - p[0].gameTime;
      const flags = [];
      if (nan) flags.push(`NaN=${nan}`);
      if (nonMono) flags.push(`NON-MONOTONIC=${nonMono}`);
      console.log(
        `    ${u.displayName} (${u.itemId}) samples=${p.length} ` +
        `span=${formatTime(p[0].gameTime)}->${formatTime(p[p.length - 1].gameTime)} ` +
        `maxGap=${(maxGap / 1000).toFixed(2)}s jumps=${jumps}` +
        (flags.length ? `  !! ${flags.join(' ')}` : '')
      );
    });
  }
  console.log('');
}

// --- Kinematics audit (KinematicResim output validation) ---
// Proves the re-simulated path obeys the engine: between consecutive in-run
// samples the IMPLIED SPEED must never exceed the unit's base move speed (the
// guarantee that removes "jumps"). Reports per-player violation counts + the
// worst offenders, and confirms facing is baked. Idle gaps (>10s) and explicit
// JUMP samples (blink/teleport/revive) are legitimately exempt.
if (showAll || showSections.includes('kinematics')) {
  console.log('=== KINEMATICS (move-speed cap + facing) ===');
  const SPEED_TOL = 1.08;          // allow 8% over base (sample rounding / diagonal A*)
  // Same gap rule as client ClientUnit.isPathGap / lib/KinematicResim: a gap is a
  // genuine discontinuity (teleport / long idle / impossible recorded hop) that
  // both the resim and the client snap across — exclude it from the speed check.
  const isGap = (a, b) => {
    if (b.isJump) return true;
    const dt = b.gameTime - a.gameTime;
    if (dt > 10000) return true;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    if (dist > 1500 && dt < 5000) return true;
    if (dist > 500 && dt > 300000) return true;
    return false;
  };
  for (const [pid, pdata] of Object.entries(data.players || {})) {
    if (!shouldIncludePlayer(pid)) continue;
    if (pdata.isNeutralPlayer) continue;

    const meta = (data.replay && data.replay.players[pid]) || {};
    console.log(`\n  Player ${pid}: ${meta.name || '??'} (${pdata.race})`);

    let units = (pdata.units || []).filter(u => !u.isBuilding && u.path && u.path.length > 1);
    if (searchText) units = units.filter(u => (u.displayName || '').toLowerCase().includes(searchText));

    let totViol = 0, totPairs = 0, noFacing = 0, worst = [];
    units.forEach(u => {
      const p = u.path;
      const baseSpeed = (u.meta && u.meta.movespeed > 0) ? u.meta.movespeed : 250;
      const cap = baseSpeed * SPEED_TOL;
      let viol = 0, maxSpeed = 0, hasFacing = false;
      for (let i = 1; i < p.length; i++) {
        if (p[i].facing != null) hasFacing = true;
        if (isGap(p[i - 1], p[i])) continue;                   // skip genuine discontinuities
        const dt = (p[i].gameTime - p[i - 1].gameTime) / 1000;
        if (dt <= 0) continue;
        const dist = Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
        const speed = dist / dt;
        totPairs++;
        if (speed > maxSpeed) maxSpeed = speed;
        if (speed > cap) { viol++; totViol++; }
      }
      if (!hasFacing) noFacing++;
      if (viol > 0) worst.push({ name: u.displayName, itemId: u.itemId, viol, maxSpeed, baseSpeed });
    });

    worst.sort((a, b) => b.viol - a.viol);
    console.log(`    units=${units.length} pairs=${totPairs} speedViolations=${totViol} unitsWithoutFacing=${noFacing}`);
    worst.slice(0, limit).forEach(w => {
      console.log(`      !! ${(w.name || '').padEnd(14)}(${w.itemId}) violations=${w.viol} ` +
        `maxSpeed=${Math.round(w.maxSpeed)} base=${w.baseSpeed}`);
    });
  }
  console.log('');
}

// --- Lost-state / idle audit ---
// Per-unit DeathInference verdict + last position + distance from the player's
// start, so we can see which combat units linger as 'idle'/'possiblyLost' and
// whether they sit in the base. Use with --search to focus (e.g. --search=fiend).
if (showAll || showSections.includes('loststate')) {
  console.log('=== LOST STATE (DeathInference) ===');
  for (const [pid, pdata] of Object.entries(data.players || {})) {
    if (!shouldIncludePlayer(pid)) continue;
    if (pdata.isNeutralPlayer) continue;

    const meta = (data.replay && data.replay.players[pid]) || {};
    const start = pdata.startingPosition || { x: 0, y: 0 };
    console.log(`\n  Player ${pid}: ${meta.name || '??'} (${pdata.race})  start=(${Math.round(start.x)},${Math.round(start.y)})`);

    let units = (pdata.units || []).filter(u => !u.isBuilding);
    if (searchText) units = units.filter(u => (u.displayName || '').toLowerCase().includes(searchText));

    // Tally by state for a quick overview.
    const tally = {};
    units.forEach(u => { const s = (u.lostState && u.lostState.state) || 'none'; tally[s] = (tally[s] || 0) + 1; });
    console.log(`    states: ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join('  ')}`);

    units.slice(0, limit).forEach(u => {
      const ls = u.lostState || {};
      const last = (u.path && u.path.length) ? u.path[u.path.length - 1] : null;
      const dist = last ? Math.round(Math.hypot(last.x - start.x, last.y - start.y)) : -1;
      const worker = (u.meta && u.meta.worker) ? ' [worker]' : '';
      const role = u.primaryRole ? ` role=${u.primaryRole}` : '';
      const cot = (u.combatOrderTimes && u.combatOrderTimes.length) ? ` combatOrders=${u.combatOrderTimes.length}` : '';
      console.log(
        `    ${(u.displayName || '').padEnd(12)}(${u.itemId}) ${(ls.state || 'none').padEnd(12)} ` +
        `src=${(ls.source || '-').padEnd(11)} conf=${String(ls.confidence != null ? ls.confidence : '-').padStart(3)} ` +
        `lastPos=${last ? `(${Math.round(last.x)},${Math.round(last.y)})@${formatTime(last.gameTime)}` : 'none'} ` +
        `distFromStart=${dist}${worker}${role}${cot}`
      );
    });
  }
  console.log('');
}

// --- Workers ---
if (showAll || showSections.includes('workers')) {
  console.log('=== WORKER SNAPSHOTS ===');
  for (const [pid, pdata] of Object.entries(data.players || {})) {
    if (!shouldIncludePlayer(pid)) continue;
    if (pdata.isNeutralPlayer) continue;

    const meta = (data.replay && data.replay.players[pid]) || {};
    console.log(`\n  Player ${pid}: ${meta.name || '??'} (${pdata.race})`);

    const events = (pdata.eventStream || []).filter(e => e.workers);
    const workerEvents = [];
    let prevW = null;

    events.forEach(e => {
      const w = e.workers;
      const wKey = `${w.onGold},${w.onLumber},${w.onBuild},${w.ghoulsOnLumber||0}`;
      if (prevW !== wKey) {
        workerEvents.push(e);
        prevW = wKey;
      }
    });

    workerEvents.slice(0, limit).forEach(e => {
      const time = formatTime(e.gameTime || 0);
      const w = e.workers;
      const name = (e.unit && e.unit.displayName) || (e.building && e.building.displayName) || '';
      console.log(`    [${time}] ${e.key}${name ? ' ' + name : ''} => gold=${w.onGold||0} lumber=${w.onLumber||0} build=${w.onBuild||0} ghouls=${w.ghoulsOnLumber||0} total=${w.totalWorkers||0}`);
    });
  }
  console.log('');
}

// --- Tiers ---
if (showAll || showSections.includes('tiers')) {
  console.log('=== TIERS ===');
  for (const [pid, pdata] of Object.entries(data.players || {})) {
    if (!shouldIncludePlayer(pid)) continue;
    if (pdata.isNeutralPlayer) continue;

    const meta = (data.replay && data.replay.players[pid]) || {};
    console.log(`  Player ${pid}: ${meta.name || '??'} (${pdata.race})`);
    (pdata.tierStream || []).forEach(t => {
      console.log(`    Tier ${t.tier} at ${formatTime(t.gameTime)}`);
    });
  }
  console.log('');
}

if (showAll || showSections.includes('validation')) {
  console.log('=== VALIDATION ===');
  if (!data.validation) {
    console.log('  (no validation block — replay parsed clean or pre-validator format)');
  } else {
    const v = data.validation;
    if (v.playerConfidence) {
      console.log('  Validation confidence:');
      Object.entries(v.playerConfidence).forEach(([pid, conf]) => {
        if (!shouldIncludePlayer(pid)) return;
        const issues = (v.playerIssues && v.playerIssues[pid]) || {};
        const breakdown = ['critical', 'major', 'minor', 'info']
          .map(s => `${s}=${issues[s] || 0}`)
          .join(' ');
        console.log(`    P${pid}: ${conf.toFixed(3)}  [${breakdown}]`);
      });
    }
    const warnings = v.warnings || [];
    const filteredWarnings = filterPlayer
      ? warnings.filter(w => String(w.player) === String(filterPlayer))
      : warnings;
    if (filteredWarnings.length) {
      console.log(`  Warnings (${filteredWarnings.length}):`);
      filteredWarnings.forEach(w => {
        const sev = (w.severity || 'minor').toUpperCase();
        console.log(`    P${w.player} [${sev}] [${w.type}]: ${w.details}`);
      });
    } else {
      console.log('  (no warnings)');
    }
    if (v.errors && v.errors.length) {
      console.log(`  Errors (${v.errors.length}):`);
      v.errors.forEach(e => console.log(`    [${e.type}] ${e.details}`));
    }
  }
  console.log('');
}

// --- Items ---
if (showAll || showSections.includes('items')) {
  console.log('=== ITEMS ===');
  for (const [pid, pdata] of Object.entries(data.players || {})) {
    if (!shouldIncludePlayer(pid)) continue;
    if (pdata.isNeutralPlayer) continue;

    const meta = (data.replay && data.replay.players[pid]) || {};
    console.log(`\n  Player ${pid}: ${meta.name || '??'} (${pdata.race})`);

    const events = pdata.eventStream || [];
    const purchases = events.filter(e => e.key === 'itemPurchase');
    const uses = events.filter(e => e.key === 'itemUse');
    const pickups = events.filter(e => e.key === 'pickupItem');
    const sells = events.filter(e => e.key === 'sellItem');
    const drops = events.filter(e => e.key === 'dropItem');

    console.log(`    Purchases: ${purchases.length}`);
    purchases.slice(0, limit).forEach(e => {
      const tags = [];
      if (e.confidence === 'low') tags.push('UNCERTAIN');
      else if (e.confidence === 'medium') tags.push('PARTIAL');
      if (e.source === 'reclassification-backfill') tags.push('INFERRED-RECLASS');
      else if (e.source === 'inferred-from-uses') tags.push('INFERRED-USES');
      const tagStr = tags.length ? ` [${tags.join(',')}]` : '';
      const gold = e.goldCost ? ` (${e.goldCost}g)` : '';
      const shop = e.shop ? ` from ${e.shop}` : '';
      console.log(`      ${formatTime(e.gameTime)} ${e.item.displayName}${gold}${shop}${tagStr}`);
    });

    console.log(`    Uses: ${uses.length}`);
    uses.slice(0, limit).forEach(e => {
      const itemName = (e.item && e.item.displayName) || (e.item && e.item.knownItemId) || '?';
      const cat = e.category ? ` [${e.category}]` : '';
      const noslot = e.source === 'use-no-slot' ? ' [USE-NO-SLOT]' : '';
      console.log(`      ${formatTime(e.gameTime)} ${itemName}${cat}${noslot}`);
    });

    console.log(`    Pickups: ${pickups.length}`);
    pickups.slice(0, limit).forEach(e => {
      const itemName = (e.item && e.item.displayName) || '?';
      const camp = e.campUuid ? ` from camp ${String(e.campUuid).slice(0, 8)}` : '';
      const random = e.isRandomDrop ? ' [RANDOM]' : '';
      console.log(`      ${formatTime(e.gameTime)} ${itemName}${camp}${random}`);
    });

    console.log(`    Sells: ${sells.length}`);
    sells.slice(0, limit).forEach(e => {
      const itemName = (e.item && e.item.displayName) || '?';
      const refund = e.goldRefunded ? ` +${e.goldRefunded}g` : '';
      const shop = e.shop ? ` to ${e.shop}` : '';
      console.log(`      ${formatTime(e.gameTime)} ${itemName}${shop}${refund}`);
    });

    console.log(`    Drops/Trades: ${drops.length}`);
    drops.slice(0, limit).forEach(e => {
      const itemName = (e.item && e.item.displayName) || '?';
      const target = e.targetHero ? ` -> ${e.targetHero.displayName}` : ' (ground)';
      console.log(`      ${formatTime(e.gameTime)} ${itemName} [${e.type}]${target}`);
    });

    if (pdata.itemStream) {
      console.log(`    Summary:`);
      (pdata.itemStream.purchases || []).forEach(p => {
        console.log(`      Bought: ${p.displayName} x${p.count} (${p.goldSpent}g total)`);
      });
      (pdata.itemStream.uses || []).forEach(u => {
        console.log(`      Used: ${u.displayName} x${u.count}`);
      });
    }

    if (pdata.inferredItems && pdata.inferredItems.length) {
      console.log(`    Inferred from use-count imbalance: ${pdata.inferredItems.length}`);
      pdata.inferredItems.slice(0, limit).forEach(i => {
        console.log(`      ${i.displayName} (${i.itemId}) — ${i.reason}`);
      });
    }
    if (pdata.itemReclassifications && pdata.itemReclassifications.length) {
      console.log(`    Slot reclassifications: ${pdata.itemReclassifications.length}`);
      pdata.itemReclassifications.slice(0, limit).forEach(r => {
        const fromName = r.from ? r.from.itemId : '?';
        const toName = r.to ? r.to.itemId : '?';
        console.log(`      ${formatTime(r.gameTime)} ${fromName} -> ${toName} (${r.reason})`);
      });
    }
  }
  console.log('');
}

// --- Mercenaries ---
if (showAll || showSections.includes('mercs')) {
  console.log('=== MERCENARIES ===');
  for (const [pid, pdata] of Object.entries(data.players || {})) {
    if (!shouldIncludePlayer(pid)) continue;
    if (pdata.isNeutralPlayer) continue;

    const meta = (data.replay && data.replay.players[pid]) || {};
    console.log(`\n  Player ${pid}: ${meta.name || '??'} (${pdata.race})`);

    const events = pdata.eventStream || [];
    const mercHires = events.filter(e => e.key === 'hireMercenary');
    const tavernHires = events.filter(e => e.key === 'makeTavernHero');

    console.log(`    Mercenary Hires: ${mercHires.length}`);
    mercHires.slice(0, limit).forEach(e => {
      const gold = e.goldCost ? ` (${e.goldCost}g` + (e.lumberCost ? `/${e.lumberCost}l` : '') + ')' : '';
      console.log(`      ${formatTime(e.gameTime)} ${e.unit.displayName}${gold} from ${e.building || '?'}`);
    });

    console.log(`    Tavern Heroes: ${tavernHires.length}`);
    tavernHires.slice(0, limit).forEach(e => {
      const gold = e.goldCost ? ` (${e.goldCost}g)` : '';
      console.log(`      ${formatTime(e.gameTime)} ${e.unit.displayName}${gold}`);
    });
  }
  console.log('');
}

// --- Supply Analysis ---
if (showAll || showSections.includes('supply')) {
  console.log('=== SUPPLY ANALYSIS ===');
  const supplyIds = { 'H': 'hhou', 'O': 'otrb', 'E': 'emow', 'U': 'uzig' };
  const supplyNames = { 'hhou': 'Farm', 'otrb': 'Burrow', 'emow': 'Moon Well', 'uzig': 'Ziggurat' };
  const upgradedVariants = { 'uzg1': 'uzig', 'uzg2': 'uzig' };

  for (const [pid, pdata] of Object.entries(data.players || {})) {
    if (!shouldIncludePlayer(pid)) continue;
    if (pdata.isNeutralPlayer) continue;

    const meta = (data.replay && data.replay.players[pid]) || {};
    console.log(`\n  Player ${pid}: ${meta.name || '??'} (${pdata.race})`);
    console.log(`    Parse confidence: ${pdata.parseConfidence != null ? pdata.parseConfidence.toFixed(4) : 'N/A'}`);

    const events = pdata.eventStream || [];
    const buildings = events.filter(e => e.key === 'addBuilding');
    const inferred = buildings.filter(e => e.isInferred);
    console.log(`    Buildings: ${buildings.length} events (${inferred.length} inferred)`);

    const sid = supplyIds[pdata.race];
    if (sid) {
      const supplyEvents = buildings.filter(e => e.building && (
        e.building.itemId === sid || upgradedVariants[e.building.itemId] === sid
      ));
      const supplyUnits = (pdata.units || []).filter(u => u.isBuilding && (
        u.itemId === sid || upgradedVariants[u.itemId] === sid
      ));
      const inferredSupply = supplyEvents.filter(e => e.isInferred);
      console.log(`    ${supplyNames[sid] || sid}: ${supplyEvents.length} events (${inferredSupply.length} inferred) / ${supplyUnits.length} in units`);

      supplyEvents.forEach(e => {
        const time = formatTime(e.gameTime || 0);
        const tag = e.isInferred ? ' [INFERRED]' : '';
        console.log(`      [${time}] ${e.building.displayName}${tag}`);
      });

      // show building attempts for supply buildings
      const attempts = (pdata.buildingAttempts || []).filter(a => a.itemId === sid);
      if (attempts.length) {
        const confirmed = attempts.filter(a => a.status === 'confirmed').length;
        const cancelled = attempts.filter(a => a.status === 'cancelled').length;
        const replaced = attempts.filter(a => a.status === 'replaced').length;
        const pending = attempts.filter(a => a.status === 'pending').length;
        console.log(`    Build commands: ${attempts.length} total (${confirmed} confirmed, ${cancelled} cancelled, ${replaced} replaced, ${pending} pending)`);
      }
    }

    // show supply bumps
    const bumps = pdata.supplyBumps || [];
    if (bumps.length) {
      console.log(`    Supply bumps: ${bumps.length}`);
      bumps.forEach(b => {
        const time = formatTime(b.gameTime || 0);
        console.log(`      [${time}] used=${b.supplyUsed} max ${b.previousMax}→${b.newMax} (${b.triggerEvent})`);
      });
    }

    // show validation warnings if present
    if (data.validation && data.validation.warnings) {
      const playerWarnings = data.validation.warnings.filter(w => String(w.player) === String(pid));
      if (playerWarnings.length) {
        const conf = data.validation.playerConfidence && data.validation.playerConfidence[pid];
        const confStr = conf != null ? ` (validation confidence ${conf.toFixed(3)})` : '';
        console.log(`    Validation warnings${confStr}:`);
        playerWarnings.forEach(w => {
          const sev = (w.severity || 'minor').toUpperCase();
          console.log(`      [${sev}] [${w.type}] ${w.details}`);
        });
      }
    }
  }
  console.log('');
}

// --- Summary ---
if (showAll || showSections.includes('summary')) {
  console.log('=== BUILD ORDER SUMMARY ===');
  for (const [pid, pdata] of Object.entries(data.players || {})) {
    if (!shouldIncludePlayer(pid)) continue;
    if (pdata.isNeutralPlayer) continue;

    const meta = (data.replay && data.replay.players[pid]) || {};
    console.log(`\n  Player ${pid}: ${meta.name || '??'} (${pdata.race})`);

    const events = pdata.eventStream || [];
    const buildings = events.filter(e => e.key === 'addBuilding').map(e => e.building).filter(Boolean);
    const units = events.filter(e => e.key === 'addUnit').map(e => e.unit).filter(Boolean);
    const heroes = units.filter(u => u.isHero);
    const summons = units.filter(u => u.isSummon);
    const nonSummons = units.filter(u => !u.isSummon && !u.isHero && !u.isIllusion);

    console.log(`    Buildings: ${buildings.map(b => b.displayName).join(', ')}`);
    console.log(`    Heroes: ${heroes.map(h => h.displayName).join(', ') || 'none'}`);
    console.log(`    Units (trained): ${nonSummons.map(u => u.displayName).join(', ') || 'none'}`);
    if (summons.length) {
      console.log(`    Summons (flagged): ${summons.map(u => `${u.displayName}(${u.itemId})`).join(', ')}`);
    }

    // find units that SHOULD be summons but aren't flagged
    const knownSummons = { 'uske':1, 'hwat':1, 'hwt2':1, 'hwt3':1, 'efon':1, 'osw1':1, 'osw2':1, 'osw3':1, 'ucs1':1 };
    const unflaggedSummons = units.filter(u => !u.isSummon && knownSummons[u.itemId]);
    if (unflaggedSummons.length) {
      console.log(`    !! UNFLAGGED SUMMONS: ${unflaggedSummons.map(u => `${u.displayName}(${u.itemId}) isSummon=${u.isSummon}`).join(', ')}`);
    }

    // worker snapshot at first event
    const firstWithWorkers = events.find(e => e.workers);
    if (firstWithWorkers) {
      const w = firstWithWorkers.workers;
      console.log(`    Initial workers: gold=${w.onGold||0} lumber=${w.onLumber||0} build=${w.onBuild||0} ghouls=${w.ghoulsOnLumber||0}`);
    }
  }
  console.log('');
}

// --- Scouts ---
if (showAll || showSections.includes('scouts')) {
  console.log('=== SCOUTS ===');
  for (const [pid, pdata] of Object.entries(data.players || {})) {
    if (!shouldIncludePlayer(pid)) continue;
    if (pdata.isNeutralPlayer) continue;

    const meta = (data.replay && data.replay.players[pid]) || {};
    const units = pdata.units || [];
    const scoutUnits = units.filter(u => u.scoutInfo);

    if (!scoutUnits.length) {
      console.log(`\n  Player ${pid}: ${meta.name || '??'} (${pdata.race}) — no scouts`);
      continue;
    }

    console.log(`\n  Player ${pid}: ${meta.name || '??'} (${pdata.race}) — ${scoutUnits.length} scout(s)`);
    scoutUnits.forEach(u => {
      const si = u.scoutInfo;
      const time = formatTime(si.gameTime);
      const pos = si.position ? `(${si.position.x}, ${si.position.y})` : '(?)';
      const pathLen = (u.path || []).length;
      const lastPath = pathLen > 0 ? u.path[pathLen - 1] : null;
      const lastPathStr = lastPath ? `last path: (${lastPath.x}, ${lastPath.y}) @ ${formatTime(lastPath.gameTime)}` : 'no path records';
      console.log(`    ${u.displayName} (${u.itemId}) ${si.isLumberScout ? '[LUMBER SCOUT]' : '[SCOUT]'} @ ${time} → ${pos}`);
      console.log(`      path records: ${pathLen}, ${lastPathStr}`);
      if (u.destroyedAt) console.log(`      destroyed at: ${formatTime(u.destroyedAt)}`);
      if (u.destroyedByBuilding) console.log(`      destroyedByBuilding: true`);
      if (u.sacrificed) console.log(`      sacrificed: true`);
      // show last 5 path records to trace movement
      const lastPaths = (u.path || []).slice(-5);
      if (lastPaths.length) {
        console.log(`      last path records:`);
        lastPaths.forEach(p => console.log(`        (${p.x}, ${p.y}) @ ${formatTime(p.gameTime)}${p.isJump ? ' [JUMP]' : ''}`));
      }
      // show spawnPosition and lastPosition for debugging
      const sp = u.spawnPosition;
      const lp = u.lastPosition;
      if (sp) console.log(`      spawnPosition: (${sp.x}, ${sp.y})`);
      if (lp) console.log(`      lastPosition: (${lp.x}, ${lp.y})`);
    });
  }
  console.log('');
}

// --- Camps (neutral creep camps + settlement-clear status) ---
if (showAll || showSections.includes('camps')) {
  console.log('=== CREEP CAMPS ===');
  const groups = (data.world && data.world.neutralGroups) || {};
  const keys = Object.keys(groups);
  if (!keys.length) {
    console.log('  (no neutral camp data — map cache may lack unit.json.gz)\n');
  }

  const CLAIM_STATE = { 0: 'untouched', 1: 'contested', 2: 'cleared', 3: 'partial' };
  const playerName = (pid) => {
    const meta = (data.replay && data.replay.players && data.replay.players[pid]) || {};
    return meta.name || `Player ${pid}`;
  };

  // sort by clearedTime (uncleared last), so the camp order reads like the game
  const sorted = keys.map(k => groups[k]).sort((a, b) => {
    const at = a.clearedTime == null ? Infinity : a.clearedTime;
    const bt = b.clearedTime == null ? Infinity : b.clearedTime;
    return at - bt;
  });

  let settledCount = 0;
  sorted.forEach(g => {
    const b = g.unitBounds || g.bounds || {};
    const cx = Math.round(((b.minX || 0) + (b.maxX || 0)) / 2);
    const cy = Math.round(((b.minY || 0) + (b.maxY || 0)) / 2);
    const cleared = g.clearedTime != null ? formatTime(g.clearedTime) : '—';
    const state = CLAIM_STATE[g.claimState] || g.claimState;
    const gm = g.guardsGoldMine ? ' [GOLD MINE]' : '';
    const big = (g.units && g.units[0] && g.units[0].displayName) || 'Creep camp';

    console.log(`\n  ${big} (lvl ${g.totalLevel}) @ (${cx},${cy})${gm}`);
    console.log(`    state=${state} owner-team=${g.claimOwnerId != null ? g.claimOwnerId : '—'} cleared=${cleared}`);

    if (g.settledClear) {
      settledCount++;
      const sc = g.settledClear;
      console.log(`    *** SETTLED CLEAR: ${playerName(sc.playerId)} (team ${sc.teamId}) ` +
        `built ${sc.buildingName} (${sc.buildingItemId})${sc.isExpansion ? ' [EXPANSION]' : ''} ` +
        `@ ${formatTime(sc.gameTime)}`);
      console.log(`        reason: ${sc.reason}`);
    }

    const pc = g.playerCredit || {};
    Object.keys(pc).forEach(pid => {
      const c = pc[pid];
      const m = c.measured || {};
      const tags = [
        c.credited ? 'CREDITED' : 'not-credited',
        c.uncertain ? 'UNCERTAIN' : null,
        c.settled ? 'SETTLED' : null
      ].filter(Boolean).join(' ');
      console.log(`      - ${playerName(pid)}: ${tags} ` +
        `share=${Math.round((m.contributionShare || 0) * 100)}% conf=${Math.round((c.confidence || 0) * 100)}%`);
    });
  });

  console.log(`\n  camps=${keys.length} settled=${settledCount} ` +
    `guarding-gold-mine=${sorted.filter(g => g.guardsGoldMine).length}\n`);
}

// --- Base Grid ---
if (showAll || showSections.includes('basegrid')) {
  console.log('=== BASE GRID ===');
  for (const [pid, pdata] of Object.entries(data.players || {})) {
    if (!shouldIncludePlayer(pid)) continue;
    if (pdata.isNeutralPlayer) continue;

    const bg = pdata.baseGrid;
    if (!bg) {
      console.log(`  Player ${pid}: no baseGrid data`);
      continue;
    }

    const dataBytes = JSON.stringify(bg.cells).length;
    console.log(`  Player ${pid}: ${bg.cols}x${bg.rows} cells (${dataBytes} bytes)`);
    console.log(`    origin: (${bg.originX}, ${bg.originY}) cellSize: ${bg.cellSize}`);

    // count cell types
    const counts = [0, 0, 0, 0, 0];
    bg.cells.forEach(row => row.forEach(v => { if (v >= 0 && v <= 4) counts[v]++; }));
    const labels = ['blocked', 'walkable', 'buildable', 'deepWater', 'shallowWater'];
    const parts = labels.map((l, i) => `${l}=${counts[i]}`).filter((_, i) => counts[i] > 0);
    console.log(`    cells: ${parts.join(', ')}`);
  }
  console.log('');
}

// --- APM ---
if (showAll || showSections.includes('apm')) {
  console.log('=== APM (Actions Per Minute) ===');
  for (const [pid, pdata] of Object.entries(data.players || {})) {
    if (!shouldIncludePlayer(pid)) continue;
    if (pdata.isNeutralPlayer) continue;

    const apm = pdata.apmData;
    if (!apm) {
      console.log(`  Player ${pid}: no APM data (replay may need re-parsing)`);
      continue;
    }

    const durationMin = Math.ceil(apm.matchDurationMs / 60000);
    console.log(`  Player ${pid} (${pdata.race}) — ${durationMin} minute match`);
    console.log(`    Raw APM:       avg=${apm.raw.average}  peak=${apm.raw.peak}  total=${apm.raw.total}`);
    console.log(`    Effective APM: avg=${apm.effective.average}  peak=${apm.effective.peak}  total=${apm.effective.total}`);

    // category breakdown
    const cats = Object.entries(apm.categories).sort((a, b) => b[1] - a[1]);
    console.log(`    Categories: ${cats.map(([k, v]) => `${k}=${v}`).join(', ')}`);

    // per-minute sparkline
    if (apm.raw.perMinute && apm.raw.perMinute.length) {
      const bars = '▁▂▃▄▅▆▇█';
      const max = apm.raw.peak || 1;
      const sparkRaw = apm.raw.perMinute.map(v => bars[Math.min(Math.floor((v / max) * 8), 8)]).join('');
      const sparkEff = apm.effective.perMinute.map(v => bars[Math.min(Math.floor((v / max) * 8), 8)]).join('');
      console.log(`    Raw APM/min:       ${sparkRaw}`);
      console.log(`    Effective APM/min: ${sparkEff}`);
    }
    console.log('');
  }
}

if (showAll || showSections.includes('camps')) {
  console.log('=== Neutral Creep Camps ===');
  const groups = (data.world && data.world.neutralGroups) || {};
  const stateNames = { 0: 'untouched', 1: 'contested', 2: 'cleared', 3: 'partial' };

  const groupList = Object.values(groups).sort((a, b) => {
    return (a.claimTime || Infinity) - (b.claimTime || Infinity);
  });

  const limited = groupList.slice(0, limit);
  console.log(`  Total camps: ${groupList.length} (showing ${limited.length})`);

  const stateCounts = groupList.reduce((acc, g) => {
    const name = stateNames[g.claimState] || 'unknown';
    acc[name] = (acc[name] || 0) + 1;
    return acc;
  }, {});
  console.log(`  States: ${Object.entries(stateCounts).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log('');

  limited.forEach((g, i) => {
    const state = stateNames[g.claimState] || 'unknown';
    const units = (g.units || []).map(u => `${u.displayName}(Lv${u.balanceInfo.level})`).join(', ');
    const timeStr = g.claimTime ? formatTime(g.claimTime) : 'N/A';
    const completion = g.completionEstimate != null ? `${Math.round(g.completionEstimate * 100)}%` : 'N/A';

    console.log(`  Camp ${i + 1}: Lv${g.totalLevel} [${state}] order=${g.order || '-'} time=${timeStr} completion=${completion} uncontested=${g.uncontested || false}`);
    console.log(`    Units: ${units}`);

    // contributions
    if (g.contributions && Object.keys(g.contributions).length) {
      const contribs = Object.entries(g.contributions).map(([tid, pct]) => `team${tid}=${Math.round(pct * 100)}%`);
      console.log(`    Contributions: ${contribs.join(', ')}`);
    }

    // presence intervals
    if (g.presenceIntervals && g.presenceIntervals.length) {
      const intervals = g.presenceIntervals.map(iv => {
        const enter = formatTime(iv.enterTime);
        const exit = iv.exitTime ? formatTime(iv.exitTime) : '?';
        return `[${enter}-${exit} team${iv.teamId} p${iv.playerId} ${iv.unitCount}u${iv.hasHero ? ' hero' : ''}]`;
      });
      console.log(`    Intervals: ${intervals.join(' ')}`);
    }

    // XP records
    if (g.heroClaimRecords && g.heroClaimRecords.length) {
      const xpStr = g.heroClaimRecords.map(r => `${r.displayName}+${r.xpGained}xp`).join(', ');
      console.log(`    XP: ${xpStr}`);
    }

    console.log('');
  });
}

if (showSections.includes('camps-debug')) {
  console.log('=== Neutral Creep Camps — Debug Timeline ===');
  const groups = (data.world && data.world.neutralGroups) || {};
  const stateNames = { 0: 'untouched', 1: 'contested', 2: 'cleared', 3: 'partial' };

  const groupList = Object.values(groups).sort((a, b) => {
    const at = a.progressTimeline && a.progressTimeline.length ? a.progressTimeline[0].gameTime : Infinity;
    const bt = b.progressTimeline && b.progressTimeline.length ? b.progressTimeline[0].gameTime : Infinity;
    return at - bt;
  });

  const limited = groupList.slice(0, limit);

  limited.forEach((g, i) => {
    const state = stateNames[g.claimState] || 'unknown';
    const tl = g.progressTimeline || [];
    const unitNames = (g.units || []).map(u => u.displayName).join(', ');

    const teamOrderStr = g.teamOrders ? Object.entries(g.teamOrders).map(([t, o]) => `t${t}=#${o}`).join(' ') : '';
    console.log(`  Camp ${i + 1}: Lv${g.totalLevel} [${state}] order=${g.order || '-'} owner=team${g.claimOwnerId} teamOrders=[${teamOrderStr}]`);
    console.log(`    Units: ${unitNames}`);

    // bounds comparison
    if (g.unitBounds) {
      const ub = g.unitBounds;
      const pb = g.bounds;
      const ubSize = `${Math.round(ub.maxX - ub.minX)}x${Math.round(ub.maxY - ub.minY)}`;
      const pbSize = `${Math.round(pb.maxX - pb.minX)}x${Math.round(pb.maxY - pb.minY)}`;
      console.log(`    unitBounds: ${ubSize} at (${Math.round(ub.minX)},${Math.round(ub.minY)})  paddedBounds: ${pbSize}`);
    }

    // claimers summary
    if (g.claimers) {
      Object.entries(g.claimers).forEach(([tid, c]) => {
        const unitList = c.players ? Object.values(c.players).reduce((arr, p) => {
          return arr.concat((p.units || []).map(u => (u.displayName || u.itemId) + (u.isHero ? '*' : '')));
        }, []) : [];
        console.log(`    team${tid}: timeClaimed=${Math.round(c.timeClaimed)}ms units=[${unitList.join(', ')}]`);
      });
    }

    // presence intervals
    if (g.presenceIntervals && g.presenceIntervals.length) {
      console.log(`    Intervals (${g.presenceIntervals.length}):`);
      g.presenceIntervals.slice(0, 10).forEach(iv => {
        console.log(`      [${formatTime(iv.enterTime)}-${formatTime(iv.exitTime)} team${iv.teamId} p${iv.playerId} ${iv.unitCount}u${iv.hasHero ? ' HERO' : ''}]`);
      });
      if (g.presenceIntervals.length > 10) {
        console.log(`      ... +${g.presenceIntervals.length - 10} more`);
      }
    }

    // progress timeline
    console.log(`    Timeline (${tl.length} entries):`);
    tl.slice(0, 8).forEach(s => {
      const maxP = Math.max(...Object.values(s.teams));
      const teamStr = Object.entries(s.teams).map(([t, v]) => `t${t}=${(v * 100).toFixed(0)}%`).join(' ');
      console.log(`      ${formatTime(s.gameTime)} max=${(maxP * 100).toFixed(0)}% ${teamStr}`);
    });
    if (tl.length > 8) {
      const last = tl[tl.length - 1];
      const lastMax = Math.max(...Object.values(last.teams));
      console.log(`      ... +${tl.length - 8} more → ${formatTime(last.gameTime)} max=${(lastMax * 100).toFixed(0)}%`);
    }

    console.log('');
  });
}

// --- Per-player camp credit (Project C) ---
if (showSections.includes('camps-credit')) {
  console.log('=== Neutral Creep Camps — Per-Player Credit ===');
  const groups = (data.world && data.world.neutralGroups) || {};
  const groupList = Object.values(groups).sort((a, b) => {
    const at = a.firstInteractionTime != null ? a.firstInteractionTime : Infinity;
    const bt = b.firstInteractionTime != null ? b.firstInteractionTime : Infinity;
    return at - bt;
  }).slice(0, limit);

  groupList.forEach((g, i) => {
    const pc = g.playerCredit || {};
    const pids = Object.keys(pc);
    const unitNames = (g.units || []).map(u => u.displayName).join(', ');
    const clearedStr = (g.clearedTime != null) ? formatTime(g.clearedTime) : 'not cleared';
    console.log(`\n  Camp ${i + 1}: Lv${g.totalLevel} [${g.creditModel || '?'}] ` +
      `cleared=${clearedStr} leash=${g.leashDistance || '?'}(${g.leashSource || '?'}) ` +
      `events=${(g.perPlayerEvents || []).length}`);
    console.log(`    Units: ${unitNames}`);

    if (!pids.length) { console.log('    (no per-player events)'); return; }

    pids.forEach(pid => {
      const p = pc[pid];
      const meta = (data.replay && data.replay.players[pid]) || {};
      const m = p.measured || {};
      const tag = p.credited ? 'CREDITED' : 'NOT credited';
      const unc = p.uncertain ? ` [UNCERTAIN conf=${p.confidence}]` : ` conf=${p.confidence}`;
      console.log(`    p${pid} ${meta.name || ''} (team${p.teamId}): ${tag}${unc}`);
      const win = (m.windowStart != null && m.windowEnd != null)
        ? `${formatTime(m.windowStart)}-${formatTime(m.windowEnd)}` : '-';
      console.log(`      cleared ${Math.round((m.contributionShare || 0) * 100)}% of camp ` +
        `(${((m.contributionMs || 0) / 1000).toFixed(1)}s work) · ~${m.estimatedXp || 0} XP · ` +
        `interactions=${m.interactionCount} items=${m.itemInteractions} · engaged ${win}` +
        `${m.onlyAfterClear ? ' · ONLY AFTER CLEAR' : ''}`);
      (p.criteria || []).forEach(c => {
        console.log(`        [${c.pass ? 'x' : ' '}] ${c.label}: ${c.measured}${c.unit || ''} / ${c.required}${c.unit || ''}`);
      });
      if (p.whyNot) console.log(`      WHY NOT: ${p.whyNot}`);
      if (p.confidenceReasons && p.confidenceReasons.length) {
        console.log(`      uncertainty: ${p.confidenceReasons.join('; ')}`);
      }
    });
    console.log(`    creditTimeline: ${(g.playerCreditTimeline || []).length} snapshots`);
  });
  console.log('');
}

// === Battles ================================================================
// Detected combat battles from BattleDetector. Each battle has a time interval,
// outer bbox, time-varying tracker box, signal list, participants, category +
// flags, and possiblyDead unit outcomes.
if (showAll || showSections.includes('battles')) {
  const battles = data.battles || [];
  console.log(`\n=== Battles (${battles.length}) ===`);
  battles.forEach((b) => {
    const start = formatTime(b.startTime);
    const end   = formatTime(b.endTime);
    const dur   = (b.durationMs / 1000).toFixed(1);
    const pids  = b.participants.map(p => `p${p.playerId}(${p.role})`).join(',');
    const cj    = b.creepJack ? ` ★creep-jack camp=${(b.campUuid || '').slice(0, 8)}` : '';
    const obb   = b.outerBbox;
    const bbox  = obb
      ? `[${Math.round(obb.minX)},${Math.round(obb.minY)}]→[${Math.round(obb.maxX)},${Math.round(obb.maxY)}]`
      : '-';
    console.log(`  ${b.id}  ${b.category.padEnd(15)}  ${start}–${end} (${dur}s)  ` +
      `signals=${b.signals.length}  participants=${pids}  bbox=${bbox}${cj}`);
    if (b.unitOutcomes && b.unitOutcomes.length) {
      const counts = b.unitOutcomes.reduce((acc, o) => { acc[o.status] = (acc[o.status]||0)+1; return acc; }, {});
      const parts = Object.entries(counts).map(([k,v]) => `${k}=${v}`).join(' ');
      console.log(`              outcomes: ${parts}`);
    }
    if (b.unitTrips && b.unitTrips.length) {
      const tripCounts = b.unitTrips.reduce((acc, t) => { acc[t.tag] = (acc[t.tag]||0)+1; return acc; }, {});
      const tripParts = Object.entries(tripCounts).map(([k,v]) => `${k}=${v}`).join(' ');
      console.log(`              trips: ${tripParts}`);
    }
  });
  const stats = data.battleStats || {};
  console.log(`\nBy category: ${JSON.stringify(stats.byCategory || {})}`);
  console.log(`By player:   ${JSON.stringify(stats.byPlayer   || {})}`);
  console.log(`Total signals consumed: ${stats.totalSignals}`);
  console.log('');
}

// Deep-dive on one battle: full signal log + tracker-box samples. Use to tune
// constants in lib/battleConstants.js or diagnose a mis-categorization.
if (showSections.includes('battles-debug')) {
  const battles = data.battles || [];
  const wanted = args.battle;
  if (!wanted) {
    console.log('battles-debug requires --battle=ID (e.g. --battle=battle-0003)');
  } else {
    const b = battles.find(x => x.id === wanted);
    if (!b) {
      console.log(`battles-debug: no battle with id "${wanted}". Available:`,
        battles.map(x => x.id).slice(0, 20).join(', '));
    } else {
      console.log(`\n=== ${b.id} (${b.category}) ===`);
      console.log(`time: ${formatTime(b.startTime)} → ${formatTime(b.endTime)}  (${(b.durationMs/1000).toFixed(1)}s)`);
      console.log(`outer bbox: [${Math.round(b.outerBbox.minX)},${Math.round(b.outerBbox.minY)}]→[${Math.round(b.outerBbox.maxX)},${Math.round(b.outerBbox.maxY)}]`);
      console.log(`flags: ${JSON.stringify(b.flags)}  creepJack=${b.creepJack}  camp=${b.campUuid || '-'}`);
      console.log(`participants:`);
      b.participants.forEach(p => {
        console.log(`  side ${p.side}  p${p.playerId} (team ${p.teamId}) — ${p.role}, ${p.signalCount} signals, ${p.unitUuids.length} units`);
      });
      console.log(`\nsignals (${b.signals.length}):`);
      b.signals.forEach(s => {
        const sp = s.spellAbilityId ? ` spell=${s.spellAbilityId}` : '';
        const tgt = s.targetUuid ? ` →${s.targetUuid.slice(0,8)}` : '';
        console.log(`  ${formatTime(s.gameTime).padStart(7)}  p${s.playerId}  ${s.kind.padEnd(28)}  @(${Math.round(s.x)},${Math.round(s.y)})${tgt}${sp}`);
      });
      console.log(`\ntracker box samples (${b.trackerBox.length}, first 8 + last 4):`);
      const first = b.trackerBox.slice(0, 8);
      const last  = b.trackerBox.length > 12 ? b.trackerBox.slice(-4) : [];
      first.concat(last).forEach(s => {
        console.log(`  ${formatTime(s.gameTime).padStart(7)}  [${Math.round(s.minX)},${Math.round(s.minY)}]→[${Math.round(s.maxX)},${Math.round(s.maxY)}]`);
      });
      console.log(`\nunit outcomes:`);
      (b.unitOutcomes || []).forEach(o => {
        console.log(`  ${o.unitUuid.slice(0,8)}  ${o.status.padEnd(15)} conf=${o.confidence}  lastSeen=${formatTime(o.lastSeenTime)}`);
      });
      if (b.unitTrips && b.unitTrips.length) {
        console.log(`\nunit trips (macro engine):`);
        b.unitTrips.forEach(t => {
          const dep = formatTime(t.departedAt);
          const arr = t.arrivedAt != null ? formatTime(t.arrivedAt) : '   ?  ';
          const dest = t.destination
            ? `@(${Math.round(t.destination.x)},${Math.round(t.destination.y)})`
            : '';
          const extra = t.reengageBattleId ? ` reengage=${t.reengageBattleId}` : '';
          console.log(`  ${t.unitUuid.slice(0,8)}  ${t.tag.padEnd(22)} conf=${t.confidence}  ${dep}→${arr}  ${dest}${extra}`);
        });
      }
      console.log('');
    }
  }
}

// === Teleports ==============================================================
// Structured teleport events (TP Scroll, Mass Teleport, Blink, Staff). Each
// row shows cast → apply time, caster, origin/destination, grabbed count, and
// cancellation status if any. Useful for verifying isJump path samples land
// at the right spot.
if (showAll || showSections.includes('teleports')) {
  console.log(`\n=== Teleports ===`);
  const pids = Object.keys(data.players || {}).sort((a, b) => Number(a) - Number(b));
  let total = 0;
  for (const pid of pids) {
    const p = data.players[pid];
    if (p.isNeutralPlayer) continue;
    const tps = p.teleportEvents || [];
    if (!tps.length) continue;
    console.log(`\n  Player ${pid}: ${tps.length} teleport(s)`);
    tps.forEach(t => {
      const cast = formatTime(t.gameTime);
      const app  = (t.appliedAt != null) ? formatTime(t.appliedAt) : '    ?   ';
      const dest = t.destination
        ? `(${Math.round(t.destination.x)},${Math.round(t.destination.y)})`
        : '?';
      const orig = t.origin
        ? `(${Math.round(t.origin.x)},${Math.round(t.origin.y)})`
        : '?';
      const inv   = t.invulnerable ? '⛨' : ' ';
      const can   = t.cancellable ? '⤬' : ' ';
      const tag   = t.cancelled ? `CANCELLED(${t.cancelReason})` : 'applied';
      const grabbed = t.grabbedCount ? ` grabbed=${t.grabbedCount}` : '';
      const bldg  = t.destBuildingDisplayName ? ` → ${t.destBuildingDisplayName}` : '';
      const conf  = t.inferenceConfidence ? ` [conf=${t.inferenceConfidence}]` : '';
      console.log(`    ${t.abilityCode.padEnd(5)} ${inv}${can}  cast=${cast} apply=${app}  ` +
                  `${orig} → ${dest}${bldg}${grabbed}  ${tag}${conf}`);
      if (t.evidenceSummary && t.evidenceSummary.length) {
        t.evidenceSummary.forEach(e => {
          const w = (e.weight >= 0 ? '+' : '') + e.weight.toFixed(2);
          console.log(`        ${w}  ${e.source}  ${JSON.stringify(e.detail || {}).slice(0, 120)}`);
        });
      }
      total++;
    });
  }
  if (total === 0) console.log('  (no teleports detected)');
  console.log('');
}

// === Dominance =============================================================
// Per-player dominance score series (lib/DominanceSeries.js). Shows the meta
// gate, score checkpoints, min/max, and the confident momentum events that
// drove the swings.
if (showAll || showSections.includes('dominance')) {
  console.log(`\n=== Dominance ===`);
  const meta = data.dominance;
  if (!meta) {
    console.log('  (no dominance block — replay parsed before the feature existed; re-run node wc3v.js)');
  } else if (!meta.available) {
    console.log(`  version=${meta.version} available=false`);
    console.log(`  reason: ${meta.reason}`);
  } else {
    console.log(`  version=${meta.version} available=true components=` +
      Object.keys(meta.componentsUsed || {}).filter(k => meta.componentsUsed[k]).join(','));

    const pids = Object.keys(data.players || {}).sort((a, b) => Number(a) - Number(b));
    for (const pid of pids) {
      if (!shouldIncludePlayer(pid)) continue;
      const p = data.players[pid];
      if (p.isNeutralPlayer || !p.dominanceSeries) continue;
      const { samples, events } = p.dominanceSeries;
      if (!samples.length) continue;

      const endT = samples[samples.length - 1].t;
      const scoreAt = (ms) => {
        let best = samples[0];
        for (const s of samples) { if (s.t <= ms) best = s; else break; }
        return best.score.toFixed(1);
      };
      let min = samples[0], max = samples[0];
      for (const s of samples) {
        if (s.score < min.score) min = s;
        if (s.score > max.score) max = s;
      }

      console.log(`\n  Player ${pid}: ${samples.length} samples, ${events.length} momentum event(s)`);
      const checkpoints = [0, 120000, 300000, 600000, endT]
        .filter((t, i, arr) => t <= endT && arr.indexOf(t) === i);
      console.log('    score @ ' + checkpoints
        .map(t => `${formatTime(t)}=${scoreAt(t)}`).join('  '));
      console.log(`    min=${min.score.toFixed(1)} @ ${formatTime(min.t)}   ` +
                  `max=${max.score.toFixed(1)} @ ${formatTime(max.t)}`);

      const shown = events.slice(0, limit);
      shown.forEach(e => {
        const sign = e.delta >= 0 ? '+' : '';
        const battle = e.battleId != null ? ` battle=${e.battleId}` : '';
        console.log(`    ${formatTime(e.t).padStart(6)}  ${e.kind.padEnd(12)} ${sign}${e.delta}${battle}`);
      });
      if (events.length > shown.length) {
        console.log(`    ... ${events.length - shown.length} more (raise --limit)`);
      }
    }
  }
  console.log('');
}

// === Claims ================================================================
// Inference-layer claims dump. Every claim built by Pass 0 (emit) and
// scored through passes 1-4. Useful when debugging why a teleport
// settled at a given confidence, or when adding new strategies and
// verifying their evidence lands on the right claims.
if (showAll || showSections.includes('claims')) {
  console.log(`\n=== Claims ===`);
  const pids = Object.keys(data.players || {}).sort((a, b) => Number(a) - Number(b));
  let total = 0;
  for (const pid of pids) {
    if (!shouldIncludePlayer(pid)) continue;
    const p = data.players[pid];
    if (p.isNeutralPlayer) continue;
    const claims = p.claims || [];
    if (!claims.length) continue;
    console.log(`\n  Player ${pid}: ${claims.length} claim(s)`);
    for (const c of claims) {
      const t = (c.payload && c.payload.gameTime != null)
        ? formatTime(c.payload.gameTime)
        : '?';
      const val = c.value ? JSON.stringify(c.value).slice(0, 80) : '';
      console.log(`    [${c.confidence.padEnd(9)}] ${c.subject} @ ${t}  ${val}`);
      for (const e of (c.evidence || [])) {
        const w = (e.weight >= 0 ? '+' : '') + e.weight.toFixed(2);
        const detail = JSON.stringify(e.detail || {}).slice(0, 100);
        console.log(`        ${w}  ${e.source.padEnd(28)} ${detail}`);
      }
      for (const h of (c.history || []).slice(1)) {     // skip 'created' entry
        console.log(`        history: pass=${h.pass} ${h.from || '-'}→${h.confidence} (${h.source || h.note || ''})`);
      }
      total++;
    }
  }
  if (total === 0) console.log('  (no claims tracked — only teleport-class events use the inference layer in Phase A)');
  console.log('');
}
