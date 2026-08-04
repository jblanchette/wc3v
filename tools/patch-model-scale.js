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

// ── Per-itemId scale OVERRIDES (final render scale, wins over the formula) ──
// The unitskin `scale × modelScale:sd` derivation is right for most units but
// visibly off for some (heroes + a few large/neutral models render too big or
// too small — the baked GLB geometry already encodes part of the size, and raised
// weapons/mounts inflate it). These are the ground-truth values tuned visually in
// client/model-scale-calibration.html (open it, drag the per-unit scale, hit
// "Export changed", paste the JSON here). Keyed by itemId; an entry here replaces
// the computed scale entirely. Re-run this tool after editing, then deploy models.
// Values are the FINAL render scale (vsFoot = resulting height ÷ footman, from
// tools/audit-model-scale.js). The `scale × modelScale:sd` formula reproduces WC3
// SD literally, but those values read too large in the viewer for combat units +
// heroes (raised weapons/mounts/antlers also inflate the model bbox). These are a
// conservative first pass tuned from the bbox audit + WC3 proportions — NOT crushed
// (attachment-heavy models keep headroom). Easy to nudge per-unit. Giant creeps
// (dragons, giants, ships) and already-reasonable heroes (Paladin/MK/Lich) are left
// on the formula. itemId variants that share a model can be added as needed.
const SCALE_OVERRIDES = {
  // —— Undead —— (user: "fiends very large", "death knight a bit bigger")
  ucry: 1.10, ucrm: 1.10,   // Crypt Fiend       2.37x → 1.57x
  uabo: 1.15,               // Abomination       3.14x → 1.92x
  // Obsidian Statue / Destroyer share one two-form GLB, so audit-model-scale
  // reports the COMBINED bbox for both (5.55x / 3.96x) — the real per-form
  // heights are 230.5 and 205.3 world units, i.e. 4.03x and 2.57x a footman.
  // These bring them into the same band as the other large Undead units above.
  uobs: 0.88,               // Obsidian Statue   4.03x → 2.00x
  ubsp: 1.05,               // Destroyer         2.57x → 2.11x
  Udea: 1.25,               // Death Knight      2.80x → 1.94x
  Udre: 1.15,               // Dread Lord        2.54x → 1.95x
  Ucrl: 1.40,               // Crypt Lord (big)  2.86x → 2.17x
  // —— Orc ——
  Obla: 1.00,               // Blademaster       2.39x → 1.91x
  Ofar: 1.20,               // Far Seer (mount)  3.80x → 2.28x
  Otch: 1.30,               // Tauren Chief (big)4.36x → 2.59x
  // —— Human ——
  Hamg: 1.05,               // Archmage          2.30x → 1.62x
  Hblm: 1.10,               // Blood Mage        2.14x → 1.57x
  // —— Night Elf ——
  Edem: 1.10,               // Demon Hunter      2.31x → 1.71x
  Ekee: 1.35,               // Keeper (antlers)  5.06x → 3.04x
  Emoo: 1.35,               // Priestess (mount) 3.30x → 2.03x
  Ewar: 1.05               // Warden            2.44x → 1.71x
};

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

// ── GLB bounding box, so the compression below works on RENDERED height ──
// Same read as tools/audit-model-scale.js: glTF stores POSITION min/max per
// accessor, so no vertex decoding. MDX is Z-up, so height is the Z extent.
function glbHeight (model) {
  const file = path.join(__dirname, '..', 'client', 'assets', 'models', 'units', model + '.glb');
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) return null;
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
  return hi > lo ? hi - lo : null;
}

// Footman is the reference unit: its rendered height is 1.00x by definition.
const FOOTMAN_H = glbHeight('footman') || 102;

// ── Oversize compression ────────────────────────────────────────────────────
// WC3's `scale x modelScale` reproduces SD literally, but a large chunk of the
// roster then renders absurdly big in this viewer: measured 175 of 665 models
// over 3x a footman and 53 over 5x, topping out at 11.7x (battleships) with
// creeps like the Dragon Sea Turtle at 9.0x and even the Keeper of the Grove —
// a playable hero — at 9.4x. The raised weapons / wings / mounts that inflate a
// model's bbox are exactly what the formula does not account for.
//
// Rather than hand-tune hundreds of entries, compress the tail: anything above
// SOFT keeps its ORDER (bigger things stay bigger) but is pulled asymptotically
// toward HARD. A dragon still dwarfs a footman; it just no longer fills the map.
//
//   2.0x -> 2.00   3.0x -> 2.40   5.0x -> 2.84   9.0x -> 3.13   11.7x -> 3.17
//
// Explicit SCALE_OVERRIDES are never touched — those are visually tuned truth.
const SOFT = 2.0;    // below this, left exactly as the formula computed
const HARD = 3.2;    // asymptote: nothing renders taller than this
const KNEE = 2.5;    // how fast the tail flattens
function compress (vsFoot) {
  if (!(vsFoot > SOFT)) return null;
  return SOFT + (HARD - SOFT) * (1 - Math.exp(-(vsFoot - SOFT) / KNEE));
}

let changed = 0, missing = 0, overridden = 0, compressed = 0;
const compressedRows = [];
const samples = ['hfoo', 'okod', 'ewsp', 'hpea', 'Hpal', 'Hmkg', 'ogru', 'uabo', 'edot'];
for (const [id, spec] of Object.entries(manifest)) {
  let finalScale;
  if (id in SCALE_OVERRIDES) {
    finalScale = +Number(SCALE_OVERRIDES[id]).toFixed(3);
    overridden++;
  } else {
    const s = skin[id];
    if (!s) { missing++; continue; }
    // Base Art-Scaling Value. Our GLBs are the SD models, so prefer the SD-specific
    // `scale:sd` (many NEUTRAL creeps store their size ONLY here — reading plain
    // `scale` defaulted them to 1.0 and undersized every such creep), then the
    // unsplit `scale`, then `scale:hd`.
    const baseScale  = num(s['scale:sd'], num(s.scale, num(s['scale:hd'], 1)));
    // Prefer the SD model-scale tweak; fall back to the unsplit `modelScale`.
    const modelScale = num(s['modelScale:sd'], num(s.modelScale, 1));
    finalScale = +(baseScale * modelScale).toFixed(3);

    // Pull the oversize tail in. Only for formula-derived scales — an explicit
    // override is a decision someone made by looking at it.
    const h = glbHeight(spec.model);
    if (h) {
      const vsFoot = (h * finalScale) / FOOTMAN_H;
      const target = compress(vsFoot);
      if (target != null) {
        const next = +(finalScale * (target / vsFoot)).toFixed(3);
        if (next !== finalScale) {
          compressedRows.push({ id, model: spec.model, from: +vsFoot.toFixed(2), to: +target.toFixed(2) });
          finalScale = next;
          compressed++;
        }
      }
    }
  }
  if (spec.scale !== finalScale) changed++;
  spec.scale = finalScale;
}

fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
console.log('Patched ' + MANIFEST_PATH);
console.log('  entries: ' + Object.keys(manifest).length + ', updated: ' + changed +
  ', overrides applied: ' + overridden + ', no skin entry: ' + missing +
  ', oversize compressed: ' + compressed);
if (compressedRows.length) {
  compressedRows.sort((a, b) => b.from - a.from);
  console.log('\n  biggest reductions (vsFoot):');
  for (const r of compressedRows.slice(0, 12)) {
    console.log('    ' + r.id.padEnd(6) + r.model.padEnd(26) + r.from + 'x -> ' + r.to + 'x');
  }
}
for (const id of samples) {
  if (manifest[id]) console.log('  ' + id + ' (' + manifest[id].model + '): scale=' + manifest[id].scale);
}
