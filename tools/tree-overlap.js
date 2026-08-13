/**
 * tree-overlap.js — do units stand inside rendered trees?
 *
 * "Units look stuck in the trees" is a mismatch between two independent
 * models of where a tree is:
 *
 *   PATHING  lib/PathFinder.js inserts each doodad as the box
 *            [x, x+128] x [y-128, y] and marks overlapping grid cells blocked.
 *   RENDER   client/js/ThreeMapRenderer.js draws a canopy sphere of radius
 *            LEAF_R (130) * 1.05 * doodad.scale, CENTRED on (x, y).
 *
 * The render centres on the doodad; the pathing box treats the doodad position
 * as a corner. So the blocked region sits (+64, -64) off the canopy, and the
 * canopy is wider than the box besides. Cells that are legally walkable to the
 * simulation are underneath a drawn tree.
 *
 * This measures that: for every path sample of every matching unit, how far is
 * the nearest tree centre, is the sample inside the drawn canopy, and would the
 * current pathing box have blocked it.
 *
 * Read-only. Reads the exported .wc3v and the map's doo.json.gz.
 *
 * Usage:
 *   node tools/tree-overlap.js --replay=NAME
 *   node tools/tree-overlap.js --replay=NAME --player=1 --search=militia
 *   node tools/tree-overlap.js --replay=NAME --at=3:00 --window=90
 *   node tools/tree-overlap.js --replay=NAME --worst=20
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
  console.error('Usage: node tools/tree-overlap.js --replay=NAME [--player=ID] [--search=TEXT] [--at=M:SS --window=SEC] [--worst=N]');
  process.exit(1);
}

// Keep these in sync with their sources; they are the whole point of the tool.
const LEAF_R = 130;          // ThreeMapRenderer.setupDoodads
const LEAF_XZ_SCALE = 1.05;  // leafGeo.scale(1.05, 0.88, 1.05)
const PATH_BOX = 128;        // PathFinder tree box edge

const CANOPY_R = LEAF_R * LEAF_XZ_SCALE;

const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
const parseAt = (v) => {
  if (v == null || v === true) return null;
  const s = String(v);
  if (s.includes(':')) {
    const [m, sec] = s.split(':');
    return (parseInt(m, 10) * 60 + parseFloat(sec)) * 1000;
  }
  return parseFloat(s) * 1000;
};

const readJsonMaybeGz = (base) => {
  if (fs.existsSync(base)) return JSON.parse(fs.readFileSync(base, 'utf8'));
  if (fs.existsSync(`${base}.gz`)) {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(`${base}.gz`)).toString());
  }
  return null;
};

const ROOT = path.join(__dirname, '..');
const replayBase = path.join(ROOT, 'client', 'replays', args.replay);
const data = readJsonMaybeGz(`${replayBase}.wc3v`);
if (!data) { console.error(`not found: ${replayBase}.wc3v(.gz)`); process.exit(1); }

// --- resolve the map's doodad file ------------------------------------------
const mapName = (data.replay && data.replay.metadata && data.replay.metadata.map &&
                 data.replay.metadata.map.mapName) || '';
const mapDir = path.join(ROOT, 'client', 'maps');
const wanted = path.basename(String(mapName)).replace(/\.w3[xm]$/i, '')
  .replace(/[^a-z0-9]/gi, '').toLowerCase();

let dooDir = null;
for (const d of fs.readdirSync(mapDir)) {
  if (!fs.statSync(path.join(mapDir, d)).isDirectory()) continue;
  const norm = d.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (norm === wanted || wanted.includes(norm) || norm.includes(wanted)) {
    if (fs.existsSync(path.join(mapDir, d, 'doo.json.gz')) ||
        fs.existsSync(path.join(mapDir, d, 'doo.json'))) { dooDir = d; break; }
  }
}
if (!dooDir && args.map) dooDir = String(args.map);
if (!dooDir) {
  console.error(`could not resolve a map dir with doo.json for map "${mapName}". Pass --map=DIRNAME.`);
  process.exit(1);
}

const dooRaw = readJsonMaybeGz(path.join(mapDir, dooDir, 'doo.json'));
const doodads = Array.isArray(dooRaw) ? dooRaw : (dooRaw && dooRaw.grid) || [];
// Same tree filter the renderer uses — only drawn doodads can look wrong.
const isTree = (t) => typeof t === 'string' && t.length === 4 && t[1] === 'T';
const trees = doodads
  .filter(d => isTree(d.type) && d.position)
  .map(d => ({
    x: parseFloat(d.position.x),
    y: parseFloat(d.position.y),
    s: (d.scale && d.scale[0]) || 1
  }));

console.log(`\n=== TREE OVERLAP (${args.replay}) ===`);
console.log(`  map dir      ${dooDir}  (${doodads.length} doodads, ${trees.length} trees)`);
console.log(`  canopy R     ${CANOPY_R.toFixed(0)}wu x doodad scale   (ThreeMapRenderer)`);
console.log(`  pathing box  [x, x+${PATH_BOX}] x [y-${PATH_BOX}, y]   (PathFinder)\n`);

// Coarse uniform-grid index over tree centres; canopies are small so one
// bucket of 256wu plus its 8 neighbours always covers the search radius.
const CELL = 256;
const buckets = new Map();
const key = (cx, cy) => `${cx}|${cy}`;
trees.forEach(t => {
  const k = key(Math.floor(t.x / CELL), Math.floor(t.y / CELL));
  if (!buckets.has(k)) buckets.set(k, []);
  buckets.get(k).push(t);
});

const nearestTree = (x, y) => {
  const bx = Math.floor(x / CELL), by = Math.floor(y / CELL);
  let best = null, bestD = Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const list = buckets.get(key(bx + dx, by + dy));
      if (!list) continue;
      for (const t of list) {
        const d = Math.hypot(t.x - x, t.y - y);
        if (d < bestD) { bestD = d; best = t; }
      }
    }
  }
  return best ? { tree: best, dist: bestD } : null;
};

// Would PathFinder's box have blocked this point for that tree? Mirrors
// config.centredTreeBlocks so the report describes the parse that actually ran.
const cfg = require('../config/config');
const CENTRED = !!cfg.centredTreeBlocks;
const inPathBox = (t, x, y) => CENTRED
  ? (Math.abs(x - t.x) <= PATH_BOX / 2 && Math.abs(y - t.y) <= PATH_BOX / 2)
  : (x >= t.x && x <= t.x + PATH_BOX && y <= t.y && y >= t.y - PATH_BOX);

// The metric that actually tracks "that looks wrong": a unit standing inside
// the tile the tree itself occupies (trunk + immediate base), as opposed to
// merely under the canopy's overhang. Canopy overlap alone over-counts — a
// lumber harvester standing beside a tree is CORRECT and WC3 canopies do
// overhang walkable ground, so a unit at ~110wu reads fine on screen. A unit
// at 10-50wu is standing in the trunk.
const TILE_R = PATH_BOX / 2;

const AT = parseAt(args.at);
const WINDOW = args.window ? parseFloat(args.window) * 1000 : 30000;
const searchText = args.search && args.search !== true
  ? String(args.search).toLowerCase() : null;

let totalSamples = 0, inCanopy = 0, inCanopyAndWalkable = 0, inTile = 0;
const offenders = [];

for (const [pid, pdata] of Object.entries(data.players || {})) {
  if (args.player != null && args.player !== true && String(args.player) !== String(pid)) continue;
  if (pdata.isNeutralPlayer) continue;

  let units = (pdata.units || []).filter(u => !u.isBuilding && u.path && u.path.length);
  if (searchText) {
    units = units.filter(u => (u.displayName || '').toLowerCase().includes(searchText));
  }

  units.forEach(u => {
    let unitInCanopy = 0, unitInTile = 0, unitSamples = 0, worst = null;
    u.path.forEach(p => {
      if (AT != null && Math.abs(p.gameTime - AT) > WINDOW) return;
      unitSamples++; totalSamples++;
      const near = nearestTree(p.x, p.y);
      if (!near) return;
      const r = CANOPY_R * near.tree.s;
      if (near.dist > r) return;
      inCanopy++; unitInCanopy++;
      const blocked = inPathBox(near.tree, p.x, p.y);
      if (!blocked) inCanopyAndWalkable++;
      if (near.dist <= TILE_R * near.tree.s) { inTile++; unitInTile++; }
      if (!worst || near.dist < worst.dist) {
        worst = { dist: near.dist, r, blocked, t: p.gameTime, x: p.x, y: p.y, tree: near.tree };
      }
    });
    if (unitInCanopy > 0) {
      offenders.push({
        pid, name: u.displayName, itemId: u.itemId,
        uuid: (u.uuid || '').slice(0, 8),
        inCanopy: unitInCanopy, inTile: unitInTile, samples: unitSamples,
        pct: 100 * unitInTile / Math.max(1, unitSamples),
        worst
      });
    }
  });
}

const pct = (n, d) => d ? `${(100 * n / d).toFixed(1)}%` : 'n/a';
console.log(`  path samples examined         ${totalSamples}`);
console.log(`  samples drawn inside a canopy ${inCanopy} (${pct(inCanopy, totalSamples)})`);
console.log(`    of those, on a cell PathFinder considers walkable: ` +
  `${inCanopyAndWalkable} (${pct(inCanopyAndWalkable, inCanopy)})`);
console.log(`  samples INSIDE THE TREE'S OWN TILE  ${inTile} (${pct(inTile, totalSamples)})   <-- the real defect`);
console.log(`    (canopy overlap alone over-counts: harvesters stand beside trees,`);
console.log(`     and WC3 canopies overhang walkable ground, so ~110wu reads fine.`);
console.log(`     Inside the TILE means standing in the trunk, which never does.)\n`);

offenders.sort((a, b) => b.pct - a.pct);
const withTile = offenders.filter(o => o.inTile > 0);
const limit = Number(args.worst) || 15;
if (withTile.length) {
  console.log(`  worst units (${withTile.length} standing inside a tree tile):`);
  withTile.slice(0, limit).forEach(o => {
    const w = o.worst;
    console.log(`    p${o.pid} ${String(o.name).padEnd(18)} ${o.uuid}  ` +
      `inTile ${o.inTile}/${o.samples} (${o.pct.toFixed(0)}%)  canopy ${o.inCanopy}`);
    if (w) {
      console.log(`         closest: [${fmt(w.t)}] unit(${Math.round(w.x)},${Math.round(w.y)}) ` +
        `tree(${Math.round(w.tree.x)},${Math.round(w.tree.y)}) d=${Math.round(w.dist)}wu ` +
        `canopyR=${Math.round(w.r)} pathBlocked=${w.blocked ? 'yes' : 'NO'}`);
    }
  });
} else {
  console.log('  no unit sample falls inside a drawn canopy.');
}
console.log('');
