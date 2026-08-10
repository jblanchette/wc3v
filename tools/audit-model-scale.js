/**
 * audit-model-scale.js — read-only diagnostic for the 3D unit model sizes.
 *
 * The 3D viewer renders each unit at `GLB_geometry × spec.scale` mapped 1:1 into
 * world units (UnitModelRenderer: w.scale.setScalar(spec.scale)). So the rendered
 * size is fully determined by (a) the baked GLB geometry and (b) the manifest
 * `scale`. WC3 does the same (loads the MDX, applies its art scale), so if a unit
 * looks wrong the lever is `spec.scale`.
 *
 * This tool reads each GLB's POSITION bounds directly from the glTF accessor
 * min/max (no full decode), reports the MODEL's intrinsic world size and its
 * RENDERED size (× scale), and normalizes against the footman.
 *
 * `scale` should equal the game's Art Scaling Value and nothing else. The
 * selection scale is printed alongside ONLY so the two stay visibly distinct —
 * multiplying them together is the bug this whole pass exists to undo. See
 * tools/extract-model-scale.js.
 *
 * A row whose manifest scale disagrees with the game's modelScale is flagged: it
 * means the manifest is stale (re-run tools/patch-model-scale.js, which a full
 * `--all` re-export always requires).
 *
 * Usage:
 *   node tools/audit-model-scale.js                 (full table, sorted by rendered height)
 *   node tools/audit-model-scale.js --ids=ucry,Udea,nogr,hfoo
 *   node tools/audit-model-scale.js --buildings     (buildings instead of units)
 *   node tools/audit-model-scale.js --stale         (only rows disagreeing with game data)
 */

const fs = require('fs');
const path = require('path');

const MODELS_DIR   = path.join(__dirname, '..', 'client', 'assets', 'models', 'units');
const MANIFEST     = path.join(MODELS_DIR, 'unit-models.json');
const BLDG_DIR     = path.join(__dirname, '..', 'client', 'assets', 'models', 'buildings');
const BLDG_MANIFEST = path.join(BLDG_DIR, 'building-models.json');
const SCALE_PATH   = path.join(__dirname, '..', 'helpers', 'modelScale.json');

const args = {};
process.argv.slice(2).forEach(r => { const [f, ...v] = r.replace(/^--/, '').split('='); args[f] = v.join('=') || true; });

// ── GLB → model-space bounding box (union of POSITION accessor min/max) ──
// glTF stores per-accessor min/max for POSITION, so we never decode vertices.
// Our GLBs are baked at scale 1 with only a Z-up→Y-up rotation on the wrapper
// (no scale), so the accessor extents equal world extents (axes relabeled).
//
// Two-form GLBs (obsidianstatue: statue ⇄ Destroyer) carry BOTH forms' geometry
// in one mesh, tagged per-primitive via extras.form ('base'/'alternate'/'both').
// A blind union over-reports both forms — the statue's "height" would include
// the Destroyer's wingspan. Bucket the bounds per form instead; callers pick the
// bucket matching the manifest spec's `form` (untagged prims count for both).
function glbBounds (file, yUp = false) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) return null;           // 'glTF'
  // first chunk = JSON
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  const accs = json.accessors || [];
  const mkBox = () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], found: false });
  const boxes = { base: mkBox(), alternate: mkBox() };
  let twoForm = false;
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const ai = prim.attributes && prim.attributes.POSITION;
      if (ai == null) continue;
      const a = accs[ai];
      if (!a || !a.min || !a.max) continue;
      const form = (prim.extras && prim.extras.form) || 'both';
      if (form !== 'both') twoForm = true;
      for (const key of (form === 'both' ? ['base', 'alternate'] : [form])) {
        const box = boxes[key];
        if (!box) continue;
        box.found = true;
        for (let k = 0; k < 3; k++) {
          if (a.min[k] < box.min[k]) box.min[k] = a.min[k];
          if (a.max[k] > box.max[k]) box.max[k] = a.max[k];
        }
      }
    }
  }
  const finish = (box) => {
    if (!box.found) return null;
    const ext = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
    if (yUp) {
      // Building GLBs bake the Z-up → Y-up swap into the vertices (single
      // untransformed node): vertical extent = Y, footprint = X/Z. Reading
      // ext[2] as height here reported footprint depth for every building.
      return { height: ext[1], footX: ext[0], footY: ext[2], radius: 0.5 * Math.hypot(ext[0], ext[2]) };
    }
    // Unit GLBs keep Z-up vertices under a rotated root node: height = Z.
    return { height: ext[2], footX: ext[0], footY: ext[1], radius: 0.5 * Math.hypot(ext[0], ext[1]) };
  };
  const base = finish(boxes.base);
  if (!base) return null;
  return { base, alternate: twoForm ? finish(boxes.alternate) : null, twoForm };
}

const auditBuildings = !!args.buildings;
const staleOnly = !!args.stale;

if (!fs.existsSync(SCALE_PATH)) {
  console.error('Missing ' + SCALE_PATH + ' — run: node tools/extract-model-scale.js');
  process.exit(1);
}
// Read the extracted game data, not unitskin.txt directly. One parse of the trap
// field is enough for this repo.
const gameScale = JSON.parse(fs.readFileSync(SCALE_PATH, 'utf-8')).units;

const MODEL_ROOT = auditBuildings ? BLDG_DIR : MODELS_DIR;
const rawManifest = JSON.parse(fs.readFileSync(auditBuildings ? BLDG_MANIFEST : MANIFEST, 'utf-8'));
// The building manifest was `itemId -> "name"` before it carried scale.
const manifest = {};
for (const [id, v] of Object.entries(rawManifest)) {
  manifest[id] = (typeof v === 'string') ? { model: v, scale: 1 } : v;
}

// Cache bounds per model file (many itemIds share a model). `form` selects the
// two-form bucket the manifest spec renders ('alternate' for ubsp; base default).
const boundsCache = {};
function boundsFor (model, form) {
  if (!(model in boundsCache)) {
    const file = path.join(MODEL_ROOT, model + '.glb');
    let b = null;
    try { b = fs.existsSync(file) ? glbBounds(file, auditBuildings) : null; } catch (e) { b = null; }
    boundsCache[model] = b;
  }
  const b = boundsCache[model];
  if (!b) return null;
  return (form === 'alternate' && b.alternate) ? b.alternate : b.base;
}

const wantIds = args.ids ? String(args.ids).split(',').map(s => s.trim()) : null;

const rows = [];
const noData = [];
for (const [id, spec] of Object.entries(manifest)) {
  if (wantIds && !wantIds.includes(id)) continue;
  if (!spec.model) continue;
  const b = boundsFor(spec.model, spec.form);
  if (!b) continue;
  const g = gameScale[id];
  // Never silently treat a missing skin entry as scale 1 — say so.
  if (!g) noData.push(id);
  const stale = g && Math.abs((spec.scale || 1) - g.modelScale) > 1e-4;
  if (staleOnly && !stale) continue;
  rows.push({
    id, model: spec.model + (spec.form ? ':' + spec.form : ''),
    scale: spec.scale,                                            // manifest scale in use
    mdxH: b.height, mdxR: b.radius,
    renderedH: b.height * spec.scale,
    renderedR: b.radius * spec.scale,
    gameScale: g ? g.modelScale : null,
    selScale: g ? g.selectionScale : null,
    defaulted: !!(g && g.modelScaleDefaulted),
    noData: !g,
    stale
  });
}

// Footman reference (the user-confirmed-correct unit). In buildings mode the
// footman lives in the UNIT manifest/dir — load it from there so vsFoot still
// answers the question that matters: how big is this next to a footman?
let footH = null;
{
  const foot = rows.find(r => r.id === 'hfoo');
  if (foot) footH = foot.renderedH;
  else {
    try {
      const um = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'));
      if (um.hfoo && um.hfoo.model) {
        const b = glbBounds(path.join(MODELS_DIR, um.hfoo.model + '.glb'), false);
        if (b) footH = b.base.height * (um.hfoo.scale || 1);
      }
    } catch (e) { /* no reference available */ }
  }
}

let list = rows;
if (args.sort === 'ratio') list.sort((a, b) => (b.renderedH) - (a.renderedH));
else list.sort((a, b) => b.renderedH - a.renderedH);

console.log('itemId  model                         curScale  mdxH  rendH  vsFoot   game.modelScale  selScale  flag');
console.log('─'.repeat(108));
for (const r of list) {
  const ratio = footH ? (r.renderedH / footH) : 0;
  const flag = r.noData ? 'NO SKIN ENTRY' : (r.stale ? 'STALE' : (r.defaulted ? 'game omits (=1)' : ''));
  console.log(
    r.id.padEnd(7) +
    r.model.slice(0, 28).padEnd(30) +
    String(r.scale).padStart(7) + '  ' +
    String(Math.round(r.mdxH)).padStart(5) + ' ' +
    String(Math.round(r.renderedH)).padStart(6) + '  ' +
    (ratio ? ratio.toFixed(2) + 'x' : '  -  ').padStart(6) + '   ' +
    (r.gameScale != null ? r.gameScale.toFixed(3) : '  -  ').padStart(13) + '   ' +
    (r.selScale != null ? r.selScale.toFixed(2) : ' - ').padStart(7) + '  ' + flag
  );
}
console.log('─'.repeat(108));
console.log(`models=${rows.length}  footmanRenderedHeight=${footH ? Math.round(footH) : '?'} (=1.00x reference)`);
console.log('vsFoot = rendered model height ÷ footman. curScale = manifest scale actually applied by the viewer.');
console.log('game.modelScale = Art Scaling Value (the ONLY render multiplier).');
console.log('selScale = Art SELECTION Scale — selection-circle size, never geometry. Do not multiply them.');

const staleRows = rows.filter(r => r.stale);
if (staleRows.length) {
  console.log('\n⚠ ' + staleRows.length + ' manifest scale(s) disagree with game data — run: node tools/patch-model-scale.js');
}
if (noData.length) {
  console.log('\n⚠ ' + noData.length + ' id(s) have NO unitskin.txt entry (scale is whatever the manifest last held, not game truth):');
  console.log('   ' + noData.join(' '));
}
