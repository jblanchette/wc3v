/**
 * Write each unit's REAL WC3 model scale into the 3D model manifest
 * (client/assets/models/units/unit-models.json).
 *
 * Render size = (MDX intrinsic geometry) × modelScale.
 *
 * Our GLBs bake the MDX geometry at scale 1 (convert-mdx-to-gltf-skinned.js batch
 * mode passes scale=1) and UnitModelRenderer applies the manifest `scale` at
 * runtime, so the manifest value IS `modelScale` — nothing else.
 *
 * This tool used to compute `scale × modelScale`, where `scale` is the SELECTION
 * CIRCLE size (usca vs ussc — see tools/extract-model-scale.js for the full trap).
 * That double-counted: a Kodo came out 2.25× too big, an Abomination 2.1×. The
 * symptom was that the tail of the roster rendered absurdly large, which was then
 * papered over with an invented exponential compression curve and seventeen
 * hand-tuned overrides. Both are gone. There is no fudge layer here any more: if
 * a unit looks wrong, the fix is in the data or in the model, not in this file.
 *
 * Reads helpers/modelScale.json (run tools/extract-model-scale.js first).
 *
 * Idempotent. Re-run after every `convert-mdx-to-gltf-skinned.js --all`, which
 * resets every manifest scale to 1. No replay re-parse needed — scale is a
 * client-side render concern only.
 */

const fs = require('fs');
const path = require('path');

const SCALE_PATH    = path.join(__dirname, '..', 'helpers', 'modelScale.json');
const MANIFEST_PATH = path.join(__dirname, '..', 'client', 'assets', 'models', 'units', 'unit-models.json');
const MODELS_DIR    = path.join(__dirname, '..', 'client', 'assets', 'models', 'units');
const BLDG_MANIFEST = path.join(__dirname, '..', 'client', 'assets', 'models', 'buildings', 'building-models.json');
const BLDG_DIR      = path.join(__dirname, '..', 'client', 'assets', 'models', 'buildings');

if (!fs.existsSync(SCALE_PATH)) {
  console.error('Missing ' + SCALE_PATH + ' — run: node tools/extract-model-scale.js');
  process.exit(1);
}

const scaleData = JSON.parse(fs.readFileSync(SCALE_PATH, 'utf-8'));
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));

// GLB height, so the report can show what the numbers mean on screen. glTF stores
// POSITION min/max per accessor, so no vertex decode. MDX is Z-up → height is Z.
const heightCache = {};
function glbHeight (model) {
  if (model in heightCache) return heightCache[model];
  const file = path.join(MODELS_DIR, model + '.glb');
  let h = null;
  if (fs.existsSync(file)) {
    const buf = fs.readFileSync(file);
    if (buf.readUInt32LE(0) === 0x46546c67) {
      const json = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));
      const accs = json.accessors || [];
      let lo = Infinity, hi = -Infinity;
      for (const mesh of json.meshes || []) {
        for (const prim of mesh.primitives || []) {
          const ai = prim.attributes && prim.attributes.POSITION;
          const a = ai == null ? null : accs[ai];
          if (!a || !a.min || !a.max) continue;
          if (a.min[2] < lo) lo = a.min[2];
          if (a.max[2] > hi) hi = a.max[2];
        }
      }
      if (hi > lo) h = hi - lo;
    }
  }
  heightCache[model] = h;
  return h;
}

const FOOTMAN_H = glbHeight('footman') || 102;

let changed = 0, missing = 0, defaulted = 0;
const missingIds = [];
const moved = [];

for (const [id, spec] of Object.entries(manifest)) {
  const entry = scaleData.units[id];
  if (!entry) {
    // No skin entry at all. Report it rather than silently shipping 1.0 — a unit
    // absent from unitskin.txt means the extraction is stale or the id is wrong.
    missing++;
    missingIds.push(id);
    continue;
  }
  if (entry.modelScaleDefaulted) defaulted++;
  const finalScale = entry.modelScale;
  if (spec.scale !== finalScale) {
    const h = glbHeight(spec.model);
    moved.push({
      id,
      model: spec.model,
      from: spec.scale,
      to: finalScale,
      wasFoot: h ? +((h * spec.scale) / FOOTMAN_H).toFixed(2) : null,
      nowFoot: h ? +((h * finalScale) / FOOTMAN_H).toFixed(2) : null
    });
    changed++;
    spec.scale = finalScale;
  }
}

fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

console.log('Patched ' + MANIFEST_PATH);
console.log('  entries: ' + Object.keys(manifest).length +
  ', updated: ' + changed +
  ', game data omits modelScale (defaulted to 1): ' + defaulted +
  ', NO skin entry: ' + missing);

if (missingIds.length) {
  console.log('\n  ⚠ no unitskin.txt entry — left at their previous scale:');
  console.log('      ' + missingIds.join(' '));
}

if (moved.length) {
  const shrunk = moved.filter(m => m.wasFoot != null && m.nowFoot < m.wasFoot)
    .sort((a, b) => (b.wasFoot - b.nowFoot) - (a.wasFoot - a.nowFoot));
  const grew = moved.filter(m => m.wasFoot != null && m.nowFoot > m.wasFoot)
    .sort((a, b) => (b.nowFoot - b.wasFoot) - (a.nowFoot - a.wasFoot));
  const fmt = r => '    ' + r.id.padEnd(6) + r.model.padEnd(28) +
    String(r.from).padStart(6) + ' -> ' + String(r.to).padEnd(6) +
    '  (' + r.wasFoot + 'x -> ' + r.nowFoot + 'x footman)';
  if (shrunk.length) {
    console.log('\n  biggest reductions (' + shrunk.length + ' total):');
    shrunk.slice(0, 15).forEach(r => console.log(fmt(r)));
  }
  if (grew.length) {
    console.log('\n  biggest increases (' + grew.length + ' total):');
    grew.slice(0, 15).forEach(r => console.log(fmt(r)));
  }
}

const samples = ['hfoo', 'okod', 'ewsp', 'hpea', 'Hpal', 'Hamg', 'ogru', 'uabo', 'ucry', 'hwat'];
console.log('\n  samples:');
for (const id of samples) {
  const s = manifest[id];
  if (!s) continue;
  const h = glbHeight(s.model);
  const vs = h ? ((h * s.scale) / FOOTMAN_H).toFixed(2) + 'x footman' : 'no GLB';
  console.log('    ' + id.padEnd(6) + s.model.padEnd(24) + 'scale=' + String(s.scale).padEnd(7) + vs);
}

// ── Buildings ──────────────────────────────────────────────────────────────
// Same source, same field. Buildings shipped with no scale at all, which was
// silently right for the 169 types whose modelScale is 1 and silently wrong for
// the rest — most visibly the three Tree of Life tiers, which share one MDX and
// are distinguished ONLY by modelScale.
if (!fs.existsSync(BLDG_MANIFEST)) {
  console.log('\n  building manifest not present — skipped');
} else {
  const bldg = JSON.parse(fs.readFileSync(BLDG_MANIFEST, 'utf-8'));
  let bChanged = 0, bMissing = 0, bScaled = 0;
  const bMissingIds = [];
  const bMoved = [];
  for (const [id, val] of Object.entries(bldg)) {
    // Tolerate the legacy `typeCode -> "modelName"` string shape so this tool is
    // safe to run against a manifest produced before the format change.
    const spec = (typeof val === 'string') ? { model: val, scale: 1 } : val;
    const entry = scaleData.units[id];
    if (!entry) { bMissing++; bMissingIds.push(id); bldg[id] = spec; continue; }
    const next = entry.modelScale;
    if (spec.scale !== next) { bMoved.push({ id, model: spec.model, from: spec.scale, to: next }); bChanged++; }
    if (next !== 1) bScaled++;
    spec.scale = next;
    bldg[id] = spec;
  }
  fs.writeFileSync(BLDG_MANIFEST, JSON.stringify(bldg, null, 2));
  console.log('\nPatched ' + BLDG_MANIFEST);
  console.log('  entries: ' + Object.keys(bldg).length + ', updated: ' + bChanged +
    ', non-unit scale (!= 1): ' + bScaled + ', NO skin entry: ' + bMissing);
  if (bMissingIds.length) {
    console.log('  ⚠ no unitskin.txt entry: ' + bMissingIds.join(' '));
  }
  if (bMoved.length) {
    console.log('  changed:');
    for (const r of bMoved) {
      console.log('    ' + r.id.padEnd(6) + r.model.padEnd(26) + r.from + ' -> ' + r.to);
    }
  }
}
