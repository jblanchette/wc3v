/**
 * diagnose-auto-camera.js — Why did the AUTO broadcast camera not frame anything?
 *
 * Checks the inputs BroadcastCamera gates on at match start:
 *   - gameMode / isNonOneVsOne  (split + intrusion are 1v1-only)
 *   - per-player startingPosition (the base anchor used before any army exists)
 *   - start separation vs SPLIT_ENTER_DISTANCE
 *   - when each player's first HERO appears (ACTION_FOCUS returns null until then)
 *   - when each player's first non-worker mobile unit appears (force anchor)
 *
 * Usage:
 *   node tools/diagnose-auto-camera.js --replay=NAME
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
  console.log('Usage: node tools/diagnose-auto-camera.js --replay=NAME');
  process.exit(1);
}

const basePath = path.join(__dirname, '..', 'client', 'replays', args.replay);
let data;
if (fs.existsSync(`${basePath}.wc3v`)) {
  data = JSON.parse(fs.readFileSync(`${basePath}.wc3v`, 'utf8'));
} else if (fs.existsSync(`${basePath}.wc3v.gz`)) {
  data = JSON.parse(zlib.gunzipSync(fs.readFileSync(`${basePath}.wc3v.gz`)).toString());
} else {
  console.error(`Not found: ${basePath}.wc3v(.gz)`);
  process.exit(1);
}

// Mirrors client/js/app.js getGameMode() fallback + helpers/utils.js computeGameMode.
function computeGameMode (mapData) {
  if (mapData && typeof mapData.gameMode === 'string') return { mode: mapData.gameMode, source: 'parser field' };
  const pmap = (mapData && mapData.players) || {};
  const humans = Object.values(pmap).filter(p => p && !p.isNeutralPlayer);
  const n = humans.length;
  if (n < 2) return { mode: 'custom', source: 'recomputed' };
  const byTeam = {};
  humans.forEach(p => { byTeam[p.teamId] = (byTeam[p.teamId] || 0) + 1; });
  const counts = Object.values(byTeam);
  const tc = counts.length;
  if (n === 2 && tc === 2) return { mode: '1v1', source: 'recomputed' };
  if (tc === 2 && counts[0] === counts[1]) {
    return { mode: ({ 2: '2v2', 3: '3v3', 4: '4v4' })[counts[0]] || 'custom', source: 'recomputed' };
  }
  if (n >= 3 && tc === n) return { mode: 'ffa', source: 'recomputed' };
  return { mode: 'custom', source: 'recomputed' };
}

const SPLIT_ENTER_DISTANCE = 3200;

const { mode, source } = computeGameMode(data);
console.log(`\n=== AUTO CAMERA INPUTS: ${args.replay} ===\n`);
console.log(`gameMode        : ${mode}  (${source})`);
console.log(`isNonOneVsOne() : ${mode !== '1v1'}   ${mode !== '1v1' ? '<-- split + intrusion DISABLED' : ''}`);
console.log(`mapData.gameMode field present: ${typeof data.gameMode === 'string' ? `yes ("${data.gameMode}")` : 'NO (legacy file, recomputed)'}`);

const humans = Object.entries(data.players || {}).filter(([, p]) => p && !p.isNeutralPlayer);

console.log(`\n--- startingPosition (base anchor) ---`);
const pts = [];
for (const [pid, p] of humans) {
  const sp = p.startingPosition;
  const name = (data.replay && data.replay.players && data.replay.players[pid] && data.replay.players[pid].name) || pid;
  if (!sp || sp.x == null || isNaN(sp.x)) {
    console.log(`  [${pid}] ${name}: MISSING  <-- baseAnchor() returns null, no split possible`);
  } else {
    console.log(`  [${pid}] ${name}: (${Math.round(sp.x)}, ${Math.round(sp.y)})`);
    pts.push({ pid, name, x: sp.x, y: sp.y });
  }
}

if (pts.length >= 2) {
  const dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y;
  const sep = Math.hypot(dx, dy);
  console.log(`\n  base separation : ${Math.round(sep)}  (SPLIT_ENTER_DISTANCE=${SPLIT_ENTER_DISTANCE})`);
  console.log(`  separation gate : ${sep > SPLIT_ENTER_DISTANCE ? 'PASS' : 'FAIL <-- too close to ever split'}`);
} else {
  console.log(`\n  <2 usable starting positions -> _computeAnchors gives <2 anchors -> split gate FAILS`);
}

// First hero / first mobile non-worker per player. ACTION_FOCUS clusters HEROES
// only: with zero heroes on the map it returns null and the camera never moves.
console.log(`\n--- first framable actor per player ---`);
for (const [pid, p] of humans) {
  const name = (data.replay && data.replay.players && data.replay.players[pid] && data.replay.players[pid].name) || pid;
  let firstHero = Infinity, firstHeroName = null;
  let firstMobile = Infinity, firstMobileName = null;
  for (const u of (p.units || [])) {
    const meta = u.meta || {};
    const t = u.spawnTime != null ? u.spawnTime
      : (u.firstSeen != null ? u.firstSeen
        : (u.readyTime != null ? u.readyTime : null));
    if (t == null) continue;
    if (meta.hero && t < firstHero) { firstHero = t; firstHeroName = u.displayName; }
    if (!meta.hero && !meta.worker && !u.isBuilding && t < firstMobile) {
      firstMobile = t; firstMobileName = u.displayName;
    }
  }
  const fmt = (ms) => ms === Infinity ? 'never' : `${(ms / 1000).toFixed(1)}s`;
  console.log(`  [${pid}] ${name}: first hero=${fmt(firstHero)} (${firstHeroName || '-'})  first mobile non-worker=${fmt(firstMobile)} (${firstMobileName || '-'})`);
}

// _clusterHeroes() has NO time gating: it takes every hero whose currentX is
// non-null, and ClientUnit seeds currentX from spawnPosition at CONSTRUCTION.
// So at gameTime 0 the camera already "sees" every hero of the match at the
// place it will eventually appear — including tavern heroes, which spawn at a
// neutral building near the map centre.
const CLUSTER_MERGE_DISTANCE = 2500;
const heroPts = [];
for (const [pid, p] of humans) {
  for (const u of (p.units || [])) {
    if (!(u.meta && u.meta.hero)) continue;
    const pos = u.spawnPosition || u.lastPosition;   // ClientUnit initialPos
    if (!pos || pos.x == null) continue;
    heroPts.push({
      pid, name: u.displayName, x: pos.x, y: pos.y,
      // ClientUnit.js:142 — readyTime = constructionStartTime || trainedTime || spawnTime
      readyTime: u.constructionStartTime || u.trainedTime || u.spawnTime,
      spawnTime: u.spawnTime,
      destroyedAt: u.destroyedAt
    });
  }
}

console.log(`\n--- hero spawn positions + client readyTime ---`);
for (const h of heroPts) {
  const rt = h.readyTime != null ? (h.readyTime / 1000).toFixed(1) + 's' : 'MISSING';
  console.log(`  [${h.pid}] ${h.name.padEnd(20)} spawnPos=(${Math.round(h.x)}, ${Math.round(h.y)})  readyTime=${rt}`);
}

// Reproduce BroadcastCamera._clusterHeroes at a given time.
//   gated=false -> current code (currentX non-null only; currentX is seeded from
//                  spawnPosition at CONSTRUCTION, so every hero counts from t=0)
//   gated=true  -> proposed fix (also require readyTime <= t < destroyedAt)
function clusterAt (t, gated) {
  const live = heroPts.filter(h => {
    if (!gated) return true;
    if (h.readyTime != null && t < h.readyTime) return false;
    if (h.destroyedAt != null && t >= h.destroyedAt) return false;
    return true;
  });
  const parent = live.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      if (Math.hypot(live[i].x - live[j].x, live[i].y - live[j].y) < CLUSTER_MERGE_DISTANCE) {
        parent[find(i)] = find(j);
      }
    }
  }
  const groups = {};
  live.forEach((h, i) => { const r = find(i); (groups[r] || (groups[r] = [])).push(h); });
  return Object.values(groups).map(g => ({
    ids: new Set(g.map(h => h.pid)),
    cx: g.reduce((s, h) => s + h.x, 0) / g.length,
    cy: g.reduce((s, h) => s + h.y, 0) / g.length,
    names: g.map(h => h.name)
  }));
}

for (const gated of [false, true]) {
  console.log(`\n--- _clusterHeroes() at t=0 :: ${gated ? 'WITH readyTime gate (fix)' : 'CURRENT CODE (no time gate)'} ---`);
  const cs = clusterAt(0, gated);
  if (!cs.length) console.log('  (no live heroes)');
  let engaged = false;
  for (const c of cs) {
    const cross = c.ids.size > 1;
    if (cross) engaged = true;
    console.log(`  centroid=(${Math.round(c.cx)}, ${Math.round(c.cy)}) players={${[...c.ids].join(',')}}` +
      `${cross ? '  <-- CROSS-PLAYER "ENGAGEMENT"' : ''}  :: ${c.names.join(', ')}`);
  }
  console.log(`  _hasEngagedCluster() = ${engaged}`);
  if (engaged) {
    console.log(`    -> _evaluateAutoSplit() returns FALSE: SPLIT NEVER ENTERS`);
    console.log(`    -> _actionFocus() takes the engagement branch: frames a PHANTOM fight`);
  } else if (!cs.length) {
    console.log(`    -> _actionFocus() returns null (no heroes yet); split is free to enter`);
  } else {
    console.log(`    -> _actionFocus() frames ALL heroes: bbox spans both bases -> MAP CENTRE`);
  }
}

// Battles starting early suppress split entry (SPLIT_ENTER_LOOKAHEAD_MS = 6000).
const battles = (data.world && data.world.battles) || data.battles || null;
if (battles && battles.length) {
  const early = battles.filter(b => b.startTime < 60000);
  console.log(`\n--- battles in first 60s (suppress split entry within 6s lookahead) ---`);
  if (!early.length) console.log('  none');
  for (const b of early.slice(0, 10)) {
    console.log(`  ${(b.startTime / 1000).toFixed(1)}s  ${b.category || '?'}`);
  }
}

console.log('');
