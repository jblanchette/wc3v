/**
 * Patch the per-unit `scale` field in the 3D model manifest
 * (client/assets/models/units/unit-models.json) with each unit's REAL WC3 model
 * size, so rendered models match their in-game scale — a kodo dwarfs a footman,
 * a wisp is small, etc.
 *
 * WC3 on-screen model size = (MDX intrinsic geometry) × `scale` × `modelScale`.
 * Our GLBs bake the MDX geometry at scale 1 (see tools/convert-mdx-to-gltf-skinned.js,
 * batch mode passes scale=1), and UnitModelRenderer applies the manifest `scale`
 * at runtime (`inst.scale = spec.scale || 1` → `w.scale.setScalar(inst.scale)`),
 * so writing `scale × modelScale` here reproduces WC3's exact sizing.
 *
 * Source: tools/map-data/units/unitskin.txt (INI-style `[itemId] / key=value`):
 *   - `scale`          : Art Scaling Value (primary model multiplier; e.g. kodo 2.25)
 *   - `modelScale:sd`  : SD secondary fine-tune (our GLBs come from the SD models —
 *                        the converter prefers `file`/`file:sd`). Falls back to the
 *                        unsplit `modelScale`, then 1.
 *
 * `scaleBull` (bulletin/decal scale) and `legacy*` (pre-Reforged) are NOT used.
 *
 * Idempotent — re-run after a new skin extraction or manifest regen, then deploy
 * the assets. No replay re-parse needed (scale is client-side render only).
 */

const fs = require('fs');
const path = require('path');

const SKIN_PATH     = path.join(__dirname, 'map-data', 'units', 'unitskin.txt');
const MANIFEST_PATH = path.join(__dirname, '..', 'client', 'assets', 'models', 'units', 'unit-models.json');

// Minimal INI parser: `[block]` headers + `key=value` lines (mirrors the parser
// in convert-mdx-to-gltf-skinned.js — slkParser can't read the .txt skin file).
function parseINI (file) {
  const sections = {};
  let current = null;
  for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('[') && t.endsWith(']')) { current = t.slice(1, -1); sections[current] = sections[current] || {}; }
    else if (current && t.includes('=')) { const eq = t.indexOf('='); sections[current][t.slice(0, eq).trim()] = t.slice(eq + 1).trim(); }
  }
  return sections;
}

function num (v, dflt) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
}

const skin = parseINI(SKIN_PATH);
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));

let changed = 0, missing = 0;
const samples = ['hfoo', 'okod', 'ewsp', 'hpea', 'Hpal', 'Hmkg', 'ogru', 'uabo', 'edot'];
for (const [id, spec] of Object.entries(manifest)) {
  const s = skin[id];
  if (!s) { missing++; continue; }
  const baseScale  = num(s.scale, 1);
  // Prefer the SD model-scale tweak (our GLBs are the SD models); fall back to
  // the unsplit `modelScale`, then no tweak.
  const modelScale = num(s['modelScale:sd'], num(s.modelScale, 1));
  const finalScale = +(baseScale * modelScale).toFixed(3);
  if (spec.scale !== finalScale) changed++;
  spec.scale = finalScale;
}

fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
console.log('Patched ' + MANIFEST_PATH);
console.log('  entries: ' + Object.keys(manifest).length + ', updated: ' + changed + ', no skin entry: ' + missing);
for (const id of samples) {
  if (manifest[id]) console.log('  ' + id + ' (' + manifest[id].model + '): scale=' + manifest[id].scale);
}
