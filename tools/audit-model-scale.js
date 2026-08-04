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
 * RENDERED size (× scale), normalizes against the footman (the user-confirmed
 * good reference), and prints the three candidate scale derivations from
 * unitskin.txt side by side so we can see what's driving an outlier.
 *
 * Usage:
 *   node tools/audit-model-scale.js                 (full table, sorted by rendered height)
 *   node tools/audit-model-scale.js --ids=ucry,Udea,nogr,hfoo
 *   node tools/audit-model-scale.js --sort=ratio    (sort by rendered/footman)
 *   node tools/audit-model-scale.js --outliers      (only the biggest/smallest vs collision)
 */

const fs = require('fs');
const path = require('path');

const MODELS_DIR   = path.join(__dirname, '..', 'client', 'assets', 'models', 'units');
const MANIFEST     = path.join(MODELS_DIR, 'unit-models.json');
const SKIN_PATH    = path.join(__dirname, 'map-data', 'units', 'unitskin.txt');

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
function glbBounds (file) {
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
    // MDX is Z-up: vertical extent = Z; horizontal footprint = X/Y.
    const ext = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
    return { height: ext[2], footX: ext[0], footY: ext[1], radius: 0.5 * Math.hypot(ext[0], ext[1]) };
  };
  const base = finish(boxes.base);
  if (!base) return null;
  return { base, alternate: twoForm ? finish(boxes.alternate) : null, twoForm };
}

// ── unitskin.txt (INI) raw scale fields ──
function parseINI (file) {
  const sections = {}; let cur = null;
  for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('[') && t.endsWith(']')) { cur = t.slice(1, -1); sections[cur] = sections[cur] || {}; }
    else if (cur && t.includes('=')) { const eq = t.indexOf('='); sections[cur][t.slice(0, eq).trim()] = t.slice(eq + 1).trim(); }
  }
  return sections;
}
function num (v, dflt) { const n = parseFloat(v); return Number.isFinite(n) ? n : dflt; }

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'));
const skin = parseINI(SKIN_PATH);

// Cache bounds per model file (many itemIds share a model). `form` selects the
// two-form bucket the manifest spec renders ('alternate' for ubsp; base default).
const boundsCache = {};
function boundsFor (model, form) {
  if (!(model in boundsCache)) {
    const file = path.join(MODELS_DIR, model + '.glb');
    let b = null;
    try { b = fs.existsSync(file) ? glbBounds(file) : null; } catch (e) { b = null; }
    boundsCache[model] = b;
  }
  const b = boundsCache[model];
  if (!b) return null;
  return (form === 'alternate' && b.alternate) ? b.alternate : b.base;
}

const wantIds = args.ids ? String(args.ids).split(',').map(s => s.trim()) : null;

const rows = [];
for (const [id, spec] of Object.entries(manifest)) {
  if (wantIds && !wantIds.includes(id)) continue;
  if (!spec.model) continue;
  const b = boundsFor(spec.model, spec.form);
  if (!b) continue;
  const s = skin[id] || {};
  const sScale = num(s['scale:sd'], num(s.scale, num(s['scale:hd'], null)));  // SD Art-Scaling
  const sMs    = num(s['modelScale:sd'], num(s.modelScale, null));
  rows.push({
    id, model: spec.model + (spec.form ? ':' + spec.form : ''),
    scale: spec.scale,                                            // current manifest scale
    mdxH: b.height, mdxR: b.radius,
    renderedH: b.height * spec.scale,
    renderedR: b.radius * spec.scale,
    collision: spec.collisionSize != null ? spec.collisionSize : null,
    fScale: sScale, fMs: sMs                                      // formula inputs
  });
}

// Footman reference (the user-confirmed-correct unit).
const foot = rows.find(r => r.id === 'hfoo') || (manifest.hfoo && boundsFor(manifest.hfoo.model)
  ? { renderedH: boundsFor(manifest.hfoo.model).height * manifest.hfoo.scale } : null);
const footH = foot ? foot.renderedH : null;

let list = rows;
if (args.sort === 'ratio') list.sort((a, b) => (b.renderedH) - (a.renderedH));
else list.sort((a, b) => b.renderedH - a.renderedH);

console.log('itemId  model                         curScale  mdxH  rendH  vsFoot   skin.scale  skin.msSD   (scale*ms)');
console.log('─'.repeat(104));
for (const r of list) {
  const ratio = footH ? (r.renderedH / footH) : 0;
  const combo = (r.fScale != null && r.fMs != null) ? (r.fScale * r.fMs) : null;
  console.log(
    r.id.padEnd(7) +
    r.model.slice(0, 28).padEnd(30) +
    String(r.scale).padStart(7) + '  ' +
    String(Math.round(r.mdxH)).padStart(5) + ' ' +
    String(Math.round(r.renderedH)).padStart(6) + '  ' +
    (ratio ? ratio.toFixed(2) + 'x' : '  -  ').padStart(6) + '   ' +
    (r.fScale != null ? r.fScale.toFixed(2) : ' - ').padStart(8) + '   ' +
    (r.fMs != null ? r.fMs.toFixed(2) : ' - ').padStart(7) + '   ' +
    (combo != null ? combo.toFixed(3) : ' - ').padStart(8)
  );
}
console.log('─'.repeat(104));
console.log(`models=${rows.length}  footmanRenderedHeight=${footH ? Math.round(footH) : '?'} (=1.00x reference)`);
console.log('vsFoot = rendered model height ÷ footman. curScale = manifest scale actually applied by the viewer.');
