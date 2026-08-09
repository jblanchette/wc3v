/**
 * Extract each missile's own art as a small PNG, so a ranged attack looks like
 * the thing that unit actually fires instead of one generic streak.
 *
 * WHY TEXTURES AND NOT MODELS
 * ---------------------------
 * `node tools/survey-missile-models.js --referenced` measured the 79 missile
 * models real units fire. Only 3 are pure geometry; 39 are geometry mixed with
 * particles, 32 are particle-only, 5 are a single tiny quad. Crucially, the most
 * common ones are NOT meshes:
 *
 *   ArrowMissile  (13 units, incl. the Archer)  = ONE 4-vertex quad + a ribbon
 *   AxeMissile    (14 units)                    = ONE 12-vertex quad
 *   HunterMissile (5 units)                     = ONE 16-vertex quad
 *
 * A WC3 arrow is a textured billboard in the real engine too. So converting
 * meshes would be the wrong tool — what carries the identity is the TEXTURE, and
 * every missile has one whether or not it has geometry. Pulling just the texture
 * covers all 79 instead of the 42 with usable meshes, costs a few KB each, and
 * drops straight into the existing InstancedMesh renderer.
 *
 * TEXTURE SELECTION
 * -----------------
 * Largest geoset → its MaterialID → the layer with the LOWEST FilterMode → that
 * layer's TextureID. Filter modes run None(0), Transparent(1), Blend(2),
 * Additive(3), AddAlpha(4); the low ones are the body, the high ones are glow
 * and ribbons. Picking the lowest gets the arrow rather than its trail.
 * Models with no geoset at all (FrostWyrm, SteamTank) fall back to their first
 * particle emitter's texture, which IS the visible effect for those.
 *
 * Usage:
 *   node tools/build-missile-textures.js --src=<abilities dir>
 *   node tools/build-missile-textures.js --src=... --dry-run
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { parseMDX } = require('war3-model');
const { createCanvas, ImageData } = require('canvas');
const { stripMDXChunks } = require('./lib/mdx-skin');
const { decodeDds, buildDdsIndex } = require('./lib/dds');

const args = {};
process.argv.slice(2).forEach(r => {
  const [f, ...v] = r.replace(/^--/, '').split('=');
  args[f] = v.join('=') || true;
});

const SRC = path.resolve(args.src || path.join(__dirname, 'map-data', 'abilities'));
const TEXTURES_DIR = path.join(__dirname, 'map-data', 'textures');
const REPLACEABLE_DIR = path.join(__dirname, 'map-data', 'replaceabletextures');
const OUT_DIR = path.join(__dirname, '..', 'client', 'assets', 'models', 'missiles');

// Output cell size. Missile textures are tiny in game; 64px is plenty for a
// sprite that renders ~40px on screen at the closest useful zoom.
const CELL = 64;

// ── the models real units actually fire ──────────────────────────────────────
function referenced () {
  const proj = require(path.join(__dirname, '..', 'helpers', 'unitProjectiles.json'));
  const set = new Map();   // lowercase basename -> original art path
  const add = a => {
    if (!a) return;
    const base = path.basename(String(a).replace(/\\/g, '/')).replace(/\.mdl$/i, '').toLowerCase();
    if (!set.has(base)) set.set(base, a);
  };
  for (const id in proj.units) {
    add(proj.units[id].art);
    if (proj.units[id].weapon2) add(proj.units[id].weapon2.art);
  }
  return set;
}

function walkMdx (dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkMdx(full, out);
    else if (/\.mdx$/i.test(e.name)) out.push(full);
  }
  return out;
}

/** The texture that carries this missile's identity. See TEXTURE SELECTION. */
function primaryTexture (m) {
  const textures = m.Textures || [];
  const materials = m.Materials || [];
  const usable = tid => {
    const t = textures[tid];
    // ReplaceableId != 0 is team colour / team glow — a flat tint, not art.
    return t && t.Image && !t.ReplaceableId;
  };

  const geosets = (m.Geosets || []).slice().sort(
    (a, b) => ((b.Vertices || []).length) - ((a.Vertices || []).length));

  for (const g of geosets) {
    const mat = materials[g.MaterialID];
    if (!mat || !mat.Layers || !mat.Layers.length) continue;
    const layers = mat.Layers.slice().sort(
      (a, b) => (a.FilterMode || 0) - (b.FilterMode || 0));
    for (const l of layers) {
      if (usable(l.TextureID)) {
        return { image: textures[l.TextureID].Image, filterMode: l.FilterMode || 0 };
      }
    }
  }

  // No geoset: a particle-only missile. Those are ALWAYS additive glows in game,
  // so say so regardless of what the emitter's own filter mode claims.
  for (const e of (m.ParticleEmitters2 || [])) {
    if (usable(e.TextureID)) return { image: textures[e.TextureID].Image, filterMode: 3 };
  }
  for (let i = 0; i < textures.length; i++) {
    if (usable(i)) return { image: textures[i].Image, filterMode: 3 };
  }
  return null;
}

/**
 * Which way round is this missile's art?
 *
 * The renderer draws a bolt with its quad's local +X along the direction of
 * travel, so the art has to be baked with the business end pointing +X. That is
 * NOT a safe guess — ArrowMissile's quad maps model +X (the tip) to v≈0, i.e.
 * its long axis runs vertically up the texture with the point at the TOP. Baking
 * it unrotated would fly every arrow sideways.
 *
 * The model states the answer, so read it: correlate each vertex's model-space X
 * (the travel axis) against its U and V, and take whichever axis tracks it.
 * Returns one of 'none' | 'flipX' | 'cw' | 'ccw'.
 */
function orientationOf (geoset) {
  const V = geoset && geoset.Vertices;
  const T = geoset && geoset.TVertices && geoset.TVertices[0];
  const n = V ? V.length / 3 : 0;
  if (!T || n < 3) return 'none';

  let sx = 0, su = 0, sv = 0;
  for (let i = 0; i < n; i++) { sx += V[i * 3]; su += T[i * 2]; sv += T[i * 2 + 1]; }
  const mx = sx / n, mu = su / n, mv = sv / n;

  let covU = 0, covV = 0;
  for (let i = 0; i < n; i++) {
    const dx = V[i * 3] - mx;
    covU += dx * (T[i * 2] - mu);
    covV += dx * (T[i * 2 + 1] - mv);
  }
  if (Math.abs(covU) >= Math.abs(covV)) return covU >= 0 ? 'none' : 'flipX';
  // V is the long axis. v grows DOWNWARD in image space, so "tip at low v" means
  // the tip is at the top → rotate clockwise to bring the top edge to the right.
  return covV < 0 ? 'cw' : 'ccw';
}

/** The rectangle of the texture the geoset actually maps onto, in UV space. */
function uvBounds (geoset) {
  const T = geoset && geoset.TVertices && geoset.TVertices[0];
  const n = geoset && geoset.Vertices ? geoset.Vertices.length / 3 : 0;
  if (!T || n < 3) return null;
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const u = T[i * 2], v = T[i * 2 + 1];
    if (u < u0) u0 = u; if (u > u1) u1 = u;
    if (v < v0) v0 = v; if (v > v1) v1 = v;
  }
  const cl = x => Math.max(0, Math.min(1, x));
  u0 = cl(u0); v0 = cl(v0); u1 = cl(u1); v1 = cl(v1);
  if (u1 - u0 < 0.01 || v1 - v0 < 0.01) return null;   // degenerate

  // A bounding box only isolates the sprite when the geometry's UV islands sit
  // together. AxeMissile's 12 verts are scattered across the troll BODY sheet
  // (u 0.21-0.59, v 0.01-0.95), so its box swallows a third of a troll and bakes
  // to a meaningless colour patch. Flag that shape: a LARGE but PARTIAL region.
  // A dedicated sprite (ArrowMissile) covers essentially the whole texture and
  // is not partial, so it is correctly spared.
  const area = (u1 - u0) * (v1 - v0);
  const partial = u0 > 0.02 || v0 > 0.02 || u1 < 0.98 || v1 < 0.98;
  return { u0, v0, u1, v1, unreliable: partial && area > 0.2 };
}

/**
 * Decode, take only the region this missile actually uses, trim to visible
 * pixels, orient so +X is travel, and fit into a square cell.
 *
 * The UV crop is load-bearing, not a nicety. Several missiles are UV-mapped onto
 * a whole UNIT SKIN sheet rather than a dedicated sprite — AxeMissile lives on
 * the troll body texture, HunterMissile on the Headhunter's. Baking the full
 * image there gives you a 64px thumbnail of a troll instead of a spear. The
 * alpha trim afterwards handles the opposite case: a small sprite floating in a
 * mostly-empty sheet, which without it renders as a speck.
 */
function toCell (ddsPath, orient, uv) {
  const { width, height, rgba } = decodeDds(fs.readFileSync(ddsPath));

  // Search window = the geoset's UV rect (whole image when there is no geoset).
  const wx0 = uv ? Math.floor(uv.u0 * (width - 1)) : 0;
  const wx1 = uv ? Math.ceil(uv.u1 * (width - 1)) : width - 1;
  const wy0 = uv ? Math.floor(uv.v0 * (height - 1)) : 0;
  const wy1 = uv ? Math.ceil(uv.v1 * (height - 1)) : height - 1;

  let minX = wx1 + 1, minY = wy1 + 1, maxX = -1, maxY = -1;
  for (let y = wy0; y <= wy1; y++) {
    for (let x = wx0; x <= wx1; x++) {
      if (rgba[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) { minX = wx0; minY = wy0; maxX = wx1; maxY = wy1; }
  const cw = maxX - minX + 1, ch = maxY - minY + 1;

  const src = createCanvas(width, height);
  src.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);

  // Crop first, so the rotation below works on tight content.
  const crop = createCanvas(cw, ch);
  crop.getContext('2d').drawImage(src, minX, minY, cw, ch, 0, 0, cw, ch);

  // Apply the orientation; a 90 degree turn swaps the dimensions.
  const rotated = (orient === 'cw' || orient === 'ccw');
  const ow = rotated ? ch : cw, oh = rotated ? cw : ch;
  const oriented = createCanvas(ow, oh);
  const octx = oriented.getContext('2d');
  if (orient === 'cw') { octx.translate(ch, 0); octx.rotate(Math.PI / 2); }
  else if (orient === 'ccw') { octx.translate(0, cw); octx.rotate(-Math.PI / 2); }
  else if (orient === 'flipX') { octx.translate(cw, 0); octx.scale(-1, 1); }
  octx.drawImage(crop, 0, 0);

  const out = createCanvas(CELL, CELL);
  const ctx = out.getContext('2d');
  // Preserve aspect ratio inside the cell — a stretched arrow reads as a blob.
  const scale = Math.min(CELL / ow, CELL / oh);
  const dw = Math.max(1, Math.round(ow * scale)), dh = Math.max(1, Math.round(oh * scale));
  ctx.drawImage(oriented, 0, 0, ow, oh, (CELL - dw) / 2, (CELL - dh) / 2, dw, dh);
  return { buffer: out.toBuffer('image/png'), cropW: ow, cropH: oh, orient };
}

/**
 * Render the missile's actual mesh to a sprite, UV-mapped, seen from the side.
 *
 * This is the answer for models whose UV islands are scattered across a shared
 * unit skin (Glaive, Mortar, Meat Wagon, Demolisher, Axe...). Cropping their UV
 * bounding box bakes a patch of troll or siege-engine hide; rasterising the
 * triangles bakes the missile.
 *
 * Projection is orthographic, with X — the travel axis the engine orients
 * missiles along — as the horizontal. The vertical is whichever of Y or Z the
 * model is actually WIDER in, chosen per model rather than fixed: a glaive's
 * disc lies in the X-Y plane, so projecting X-Z would catch it edge-on and bake
 * a 10:1 sliver instead of a blade. No z-buffer — these are near-flat objects of
 * a few dozen vertices, and overdraw takes the last write.
 */
function rasterizeGeoset (geoset, tex, cell) {
  const V = geoset.Vertices, T = geoset.TVertices && geoset.TVertices[0], F = geoset.Faces;
  if (!V || !T || !F || F.length < 3) return null;

  const n = V.length / 3;
  let x0 = Infinity, x1 = -Infinity;
  let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = V[i * 3], y = V[i * 3 + 1], z = V[i * 3 + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  // Face the flatter side of the model toward the camera.
  const useY = (y1 - y0) > (z1 - z0);
  const vIdx = useY ? 1 : 2;
  const v0 = useY ? y0 : z0, v1 = useY ? y1 : z1;

  const spanX = x1 - x0, spanZ = v1 - v0;
  if (!(spanX > 0) || !(spanZ > 0)) return null;

  // Fit the silhouette into the cell, preserving proportions.
  const scale = Math.min((cell - 2) / spanX, (cell - 2) / spanZ);
  const dw = Math.max(1, Math.round(spanX * scale)), dh = Math.max(1, Math.round(spanZ * scale));
  const ox = (cell - dw) / 2, oy = (cell - dh) / 2;
  const px = i => ox + (V[i * 3] - x0) * scale;
  // +Z (or +Y) is up in MDX, +y is down in an image.
  const py = i => oy + (v1 - V[i * 3 + vIdx]) * scale;

  const out = new Uint8ClampedArray(cell * cell * 4);
  const sample = (u, v) => {
    const sx = Math.max(0, Math.min(tex.width - 1, Math.round(u * (tex.width - 1))));
    const sy = Math.max(0, Math.min(tex.height - 1, Math.round(v * (tex.height - 1))));
    return (sy * tex.width + sx) * 4;
  };

  for (let f = 0; f + 2 < F.length; f += 3) {
    const a = F[f], b = F[f + 1], c = F[f + 2];
    const ax = px(a), ay = py(a), bx = px(b), by = py(b), cx2 = px(c), cy2 = py(c);
    const den = (by - cy2) * (ax - cx2) + (cx2 - bx) * (ay - cy2);
    if (Math.abs(den) < 1e-9) continue;

    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx2)));
    const maxX = Math.min(cell - 1, Math.ceil(Math.max(ax, bx, cx2)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy2)));
    const maxY = Math.min(cell - 1, Math.ceil(Math.max(ay, by, cy2)));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const cxp = x + 0.5, cyp = y + 0.5;
        const w0 = ((by - cy2) * (cxp - cx2) + (cx2 - bx) * (cyp - cy2)) / den;
        const w1 = ((cy2 - ay) * (cxp - cx2) + (ax - cx2) * (cyp - cy2)) / den;
        const w2 = 1 - w0 - w1;
        if (w0 < -0.002 || w1 < -0.002 || w2 < -0.002) continue;
        const u = w0 * T[a * 2] + w1 * T[b * 2] + w2 * T[c * 2];
        const v = w0 * T[a * 2 + 1] + w1 * T[b * 2 + 1] + w2 * T[c * 2 + 1];
        const si = sample(u, v);
        if (tex.rgba[si + 3] < 8) continue;          // transparent texel
        const di = (y * cell + x) * 4;
        out[di] = tex.rgba[si]; out[di + 1] = tex.rgba[si + 1];
        out[di + 2] = tex.rgba[si + 2]; out[di + 3] = tex.rgba[si + 3];
      }
    }
  }

  let any = false;
  for (let i = 3; i < out.length; i += 4) if (out[i] > 8) { any = true; break; }
  if (!any) return null;

  const canvas = createCanvas(cell, cell);
  canvas.getContext('2d').putImageData(new ImageData(out, cell, cell), 0, 0);
  return { buffer: canvas.toBuffer('image/png'), aspect: +(spanX / spanZ).toFixed(3) };
}

// ── main ─────────────────────────────────────────────────────────────────────
const refs = referenced();
const files = walkMdx(SRC, []).filter(f =>
  refs.has(path.basename(f, path.extname(f)).toLowerCase()));

if (!files.length) {
  console.log('No referenced missile .mdx found under ' + SRC);
  console.log('Run `node tools/list-casc-extractions.js` (section 7) for the extraction step.');
  process.exit(1);
}

const ddsIndex = buildDdsIndex([SRC, TEXTURES_DIR, REPLACEABLE_DIR]);

if (!args['dry-run']) fs.mkdirSync(OUT_DIR, { recursive: true });

const manifest = {};
const missing = [];
let wrote = 0, bytes = 0;

for (const file of files.sort()) {
  const name = path.basename(file, path.extname(file)).toLowerCase();
  const buf = fs.readFileSync(file);
  const m = parseMDX(stripMDXChunks(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), ['LITE']));

  const pick = primaryTexture(m);
  if (!pick) { missing.push([name, 'no usable texture in model']); continue; }
  const texPath = pick.image;

  const base = path.basename(texPath.replace(/\\/g, '/')).replace(/\.(blp|dds|tga)$/i, '').toLowerCase();
  const dds = ddsIndex[base];
  if (!dds) { missing.push([name, 'texture not on disk: ' + texPath]); continue; }

  const primary = (m.Geosets || []).slice().sort(
    (a, b) => (b.Vertices || []).length - (a.Vertices || []).length)[0];
  const orient = orientationOf(primary);
  const uv = uvBounds(primary);

  let png = null, aspect = 1, how = 'crop';

  // Scattered UV islands on a shared unit skin: crop is useless, so draw the
  // actual mesh instead. Rasterising is strictly more faithful — it just needs
  // real geometry, which these have by definition.
  if (uv && uv.unreliable) {
    let texImg;
    try { texImg = decodeDds(fs.readFileSync(dds)); }
    catch (e) { missing.push([name, 'decode failed: ' + e.message]); continue; }
    const r = rasterizeGeoset(primary, texImg, CELL);
    if (!r) { missing.push([name, 'UV region unusable and mesh rasterise produced nothing']); continue; }
    png = r.buffer; aspect = r.aspect; how = 'mesh';
  } else {
    let cell;
    try { cell = toCell(dds, orient, uv); }
    catch (e) { missing.push([name, 'decode failed: ' + e.message]); continue; }
    png = cell.buffer;
    // Aspect AFTER orientation (length along travel : width across it), so the
    // renderer can draw a long thin arrow long and thin rather than forcing
    // every missile into a square.
    aspect = +(cell.cropW / cell.cropH).toFixed(3);
  }

  manifest[name] = {
    aspect,
    orient: how === 'mesh' ? 'mesh' : orient,
    // How the engine draws this layer, so the viewer matches: solid art gets
    // alpha blending (an arrow is an object), glows get additive.
    blend: pick.filterMode >= 2 ? 'add' : 'alpha',
    tex: base,
    how
  };

  if (!args['dry-run']) fs.writeFileSync(path.join(OUT_DIR, name + '.png'), png);
  wrote++;
  bytes += png.length;
}

if (!args['dry-run']) {
  fs.writeFileSync(path.join(OUT_DIR, 'missile-textures.json'),
    JSON.stringify({ version: 1, cell: CELL, missiles: manifest }, null, 2));
}

console.log((args['dry-run'] ? '[dry run] ' : '') +
  `${wrote} missile textures (${(bytes / 1024).toFixed(0)} KB total, ${CELL}px cells)`);
if (!args['dry-run']) console.log('  → ' + path.relative(process.cwd(), OUT_DIR));
if (missing.length) {
  console.log('\n  UNRESOLVED (' + missing.length + ') — these keep the generic streak sprite:');
  for (const [n, why] of missing) console.log('    ' + n.padEnd(30) + why);
}
console.log('\n  Deploy with: node tools/deploy-assets.js --only=models');
