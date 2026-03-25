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
 *                          paths      - unit movement paths with groupId data
 *                          workers    - worker snapshots from events
 *                          tiers      - tier transition data
 *                          supply     - supply building analysis + confidence
 *                          items      - item purchases, uses, and summary
 *                          mercs      - mercenary hires and tavern hero purchases
 *                          summary    - compact build order overview
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
    const drops = events.filter(e => e.key === 'dropItem');

    console.log(`    Purchases: ${purchases.length}`);
    purchases.slice(0, limit).forEach(e => {
      const conf = e.confidence === 'low' ? ' [UNCERTAIN]' : '';
      const gold = e.goldCost ? ` (${e.goldCost}g)` : '';
      const shop = e.shop ? ` from ${e.shop}` : '';
      console.log(`      ${formatTime(e.gameTime)} ${e.item.displayName}${gold}${shop}${conf}`);
    });

    console.log(`    Uses: ${uses.length}`);
    uses.slice(0, limit).forEach(e => {
      const itemName = (e.item && e.item.displayName) || (e.item && e.item.knownItemId) || '?';
      const cat = e.category ? ` [${e.category}]` : '';
      console.log(`      ${formatTime(e.gameTime)} ${itemName}${cat}`);
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
        console.log(`    Validation warnings:`);
        playerWarnings.forEach(w => {
          console.log(`      [${w.type}] ${w.details}`);
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
