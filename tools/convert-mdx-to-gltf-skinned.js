/**
 * Convert a WC3 unit MDX into a SKINNED, ANIMATED glTF binary (.glb) for Three.js.
 *
 * Unlike tools/convert-mdx-to-gltf.js (which bakes a single static bind-pose mesh
 * for buildings/trees), this exporter emits the bone skeleton + one animation clip
 * (the "Stand"/idle sequence) so units can animate via THREE.AnimationMixer.
 *
 * The skin math is verified against war3-model's own renderer (see memory
 * mdx-to-gltf-skinning.md):
 *   - Geoset.Groups[g] holds node ObjectIds; VertexGroup[v] indexes Groups; equal 1/n weights.
 *   - Node matrix = parent x [ T(pivot+animT) R(animR) S(animS) T(-pivot) ].
 *   - glTF joint: translation=(pivot-parentPivot)+animT, rotation=animR, scale=animS,
 *     inverseBindMatrix = translate(-pivot).
 *   - Coordinate fix (Z-up -> Y-up) lives on a wrapper root node, NOT per vertex.
 *
 * Usage:
 *   node tools/convert-mdx-to-gltf-skinned.js --unit=footman
 *   node tools/convert-mdx-to-gltf-skinned.js --file=path/to/foo.mdx --out=foo.glb
 *   node tools/convert-mdx-to-gltf-skinned.js --unit=ghoul --scale=0.9
 */
const fs = require('fs');
const path = require('path');
const { parseMDX } = require('war3-model');
const { Document, NodeIO } = require('@gltf-transform/core');
const { createCanvas, ImageData } = require('canvas');
const {
  stripMDXChunks, pickSequences, geosetVisibleDuringStand, geosetFormVisibility
} = require('./lib/mdx-skin');

const UNITS_DIR = path.join(__dirname, 'map-data', 'units');
const TEXTURES_DIR = path.join(__dirname, 'map-data', 'textures');
const OUTPUT_DIR = path.join(__dirname, '..', 'client', 'assets', 'models', 'units');

// Z-up (MDX) -> Y-up (Three.js): -90 deg about +X. Lives on the wrapper root node.
const ZUP_TO_YUP_QUAT = [-0.70710678, 0, 0, 0.70710678];

// ---------------------------------------------------------------------------
// MDX chunk strip + DDS decode — mirrored from tools/convert-mdx-to-gltf.js.
// (Kept local so the static tool's CLI main() doesn't run on require. Refactor
// into a shared module in Phase 1 when both exporters are permanent.)
// ---------------------------------------------------------------------------
function rgb565to888 (c) {
  const r = (c >> 11) & 0x1F, g = (c >> 5) & 0x3F, b = c & 0x1F;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}
function decodeDxt1Block (data, offset, out, width, height, px0, py0, dxt3or5) {
  const c0 = data.readUInt16LE(offset), c1 = data.readUInt16LE(offset + 2);
  const indices = data.readUInt32LE(offset + 4);
  const col0 = rgb565to888(c0), col1 = rgb565to888(c1);
  let col2, col3, alpha3 = 255;
  if (c0 > c1 || dxt3or5) {
    col2 = [Math.round((2 * col0[0] + col1[0]) / 3), Math.round((2 * col0[1] + col1[1]) / 3), Math.round((2 * col0[2] + col1[2]) / 3)];
    col3 = [Math.round((col0[0] + 2 * col1[0]) / 3), Math.round((col0[1] + 2 * col1[1]) / 3), Math.round((col0[2] + 2 * col1[2]) / 3)];
  } else {
    col2 = [Math.round((col0[0] + col1[0]) / 2), Math.round((col0[1] + col1[1]) / 2), Math.round((col0[2] + col1[2]) / 2)];
    col3 = [0, 0, 0]; alpha3 = 0;
  }
  const palette = [col0, col1, col2, col3];
  for (let py = 0; py < 4; py++) {
    const yy = py0 + py; if (yy >= height) continue;
    for (let px = 0; px < 4; px++) {
      const xx = px0 + px; if (xx >= width) continue;
      const idx = (indices >>> ((py * 4 + px) * 2)) & 0x3, c = palette[idx], dst = (yy * width + xx) * 4;
      out[dst] = c[0]; out[dst + 1] = c[1]; out[dst + 2] = c[2];
      if (!dxt3or5) out[dst + 3] = (idx === 3) ? alpha3 : 255;
    }
  }
}
function decodeDxt5AlphaBlock (data, offset, out, width, height, px0, py0) {
  const a0 = data[offset], a1 = data[offset + 1];
  const pal = new Array(8); pal[0] = a0; pal[1] = a1;
  if (a0 > a1) { for (let i = 1; i < 7; i++) pal[i + 1] = Math.round(((7 - i) * a0 + i * a1) / 7); }
  else { for (let i = 1; i < 5; i++) pal[i + 1] = Math.round(((5 - i) * a0 + i * a1) / 5); pal[6] = 0; pal[7] = 255; }
  const lo = data[offset + 2] | (data[offset + 3] << 8) | (data[offset + 4] << 16);
  const hi = data[offset + 5] | (data[offset + 6] << 8) | (data[offset + 7] << 16);
  for (let i = 0; i < 16; i++) {
    const py = i >> 2, px = i & 3, yy = py0 + py, xx = px0 + px;
    if (yy >= height || xx >= width) continue;
    const idx = i < 8 ? (lo >> (i * 3)) & 7 : (hi >> ((i - 8) * 3)) & 7;
    out[(yy * width + xx) * 4 + 3] = pal[idx];
  }
}
function decodeDds (buf) {
  if (buf.length < 128 || buf.toString('ascii', 0, 4) !== 'DDS ') throw new Error('bad DDS');
  const width = buf.readUInt32LE(16), height = buf.readUInt32LE(12);
  const fourcc = buf.toString('ascii', 84, 88), rgbBitCount = buf.readUInt32LE(88);
  const out = new Uint8ClampedArray(width * height * 4);
  const data = buf.slice(128);
  if (fourcc === 'DXT1') {
    let off = 0; for (let by = 0; by < height; by += 4) for (let bx = 0; bx < width; bx += 4) { decodeDxt1Block(data, off, out, width, height, bx, by, false); off += 8; }
    return { width, height, rgba: out };
  }
  if (fourcc === 'DXT5') {
    let off = 0; for (let by = 0; by < height; by += 4) for (let bx = 0; bx < width; bx += 4) { decodeDxt5AlphaBlock(data, off, out, width, height, bx, by); decodeDxt1Block(data, off + 8, out, width, height, bx, by, true); off += 16; }
    return { width, height, rgba: out };
  }
  if (fourcc === 'DXT3') {
    let off = 0; for (let by = 0; by < height; by += 4) for (let bx = 0; bx < width; bx += 4) {
      for (let py = 0; py < 4; py++) { const yy = by + py; if (yy >= height) continue; const rowBytes = data.readUInt16LE(off + py * 2); for (let px = 0; px < 4; px++) { const xx = bx + px; if (xx >= width) continue; const a4 = (rowBytes >> (px * 4)) & 0xF; out[(yy * width + xx) * 4 + 3] = (a4 << 4) | a4; } }
      decodeDxt1Block(data, off + 8, out, width, height, bx, by, true); off += 16;
    }
    return { width, height, rgba: out };
  }
  if (rgbBitCount === 32) {
    for (let i = 0; i < width * height; i++) { const px = data.readUInt32LE(i * 4); out[i * 4] = (px >> 16) & 0xFF; out[i * 4 + 1] = (px >> 8) & 0xFF; out[i * 4 + 2] = px & 0xFF; out[i * 4 + 3] = (px >> 24) & 0xFF; }
    return { width, height, rgba: out };
  }
  throw new Error('unsupported DDS: ' + fourcc);
}
function ddsToPngBuffer (ddsPath) {
  const { width, height, rgba } = decodeDds(fs.readFileSync(ddsPath));
  const canvas = createCanvas(width, height);
  canvas.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas.toBuffer('image/png');
}

// Index every .dds under units/ and textures/ by lowercase basename.
function buildDdsIndex () {
  const index = {};
  function walk (dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else if (entry.name.toLowerCase().endsWith('.dds')) {
        const base = entry.name.slice(0, -4).toLowerCase();
        if (!index[base]) index[base] = path.join(dir, entry.name);
      }
    }
  }
  walk(UNITS_DIR);
  walk(TEXTURES_DIR);
  return index;
}

// ---------------------------------------------------------------------------
// Animation helpers  (pickStandSequence + geoset visibility live in lib/mdx-skin.js)
// ---------------------------------------------------------------------------
// Window a node track to the Stand interval [start,end], matching war3-model's
// per-sequence evaluation: only keys INSIDE the interval drive the node; a node
// with no in-range keys stays at its default rest (returns null → no channel);
// before the first / after the last in-range key, WC3 HOLDS that key's value
// (not a clamp to out-of-interval keys). Returns {times,values} in clip seconds.
function windowTrack (track, comps, start, end) {
  if (!track || typeof track === 'number' || !track.Keys || !track.Keys.length) return null;
  const inRange = track.Keys.filter(k => k.Frame >= start && k.Frame <= end);
  if (!inRange.length) return null; // node at default rest during Stand

  const pts = inRange.map(k => ({ frame: k.Frame, v: Array.from(k.Vector).slice(0, comps) }));
  const firstV = pts[0].v.slice(), lastV = pts[pts.length - 1].v.slice();
  if (pts[0].frame > start) pts.unshift({ frame: start, v: firstV });             // hold first
  if (pts[pts.length - 1].frame < end) pts.push({ frame: end, v: lastV });        // hold last

  const times = new Float32Array(pts.length);
  const values = new Float32Array(pts.length * comps);
  for (let i = 0; i < pts.length; i++) {
    times[i] = (pts[i].frame - start) / 1000;
    for (let c = 0; c < comps; c++) values[i * comps + c] = pts[i].v[c];
  }
  return { times, values };
}

// ---------------------------------------------------------------------------
// Texture resolution (per-geoset, like the building tool)
// ---------------------------------------------------------------------------
// Is a texture a particle/shadow/ground-splat effect (NOT part of the idle body)?
// Match by directory + basename PREFIX (not loose substring) so unit names like
// "HeroShadowHunter.blp" aren't mistaken for the generic "Shadow.blp" plane.
function isEffectTexture (image) {
  const p = image.toLowerCase().replace(/\\/g, '/');
  if (p.includes('replaceabletextures/weather') || p.includes('/splats/') || p.includes('ubersplat')) return true;
  const base = path.basename(p, path.extname(p));
  if (base === 'shadow' || base === 'shadowflyer') return true;
  return /^(clouds?|dust\d|smoke|flare|shockwave|lightning|glow|star\d|splat)/.test(base);
}
// MDX FilterMode → glTF alpha mode + WC3 blend intent. None is opaque; Transparent
// is a hard alpha cutout (WC3/HiveWE discard at 0.75); everything else blends. The
// exact blend (straight alpha vs. additive vs. modulate) is preserved in the
// material's `wc3.filterMode` extra so the client can pick the Three.js blend mode.
//   0 None  1 Transparent  2 Blend  3 Additive  4 AddAlpha  5 Modulate  6 Modulate2x
function alphaModeFor (filterMode) {
  switch (filterMode) {
    case 1:  return { mode: 'MASK', cutoff: 0.75 };
    case 2:
    case 3:
    case 4:
    case 5:
    case 6:  return { mode: 'BLEND', cutoff: null };
    default: return { mode: 'OPAQUE', cutoff: null };
  }
}

// Resolve a geoset's material into the render semantics the exporter needs:
//   baseName      — diffuse texture basename (ReplaceableId 0), or null
//   replaceableId — 1 (team color) / 2 (team glow) → runtime player-tinted, no image
//   filterMode    — MDX layer FilterMode (blend intent)
//   unshaded      — layer is full-bright (ignores lighting) — common on SD units
//   twoSided      — layer is double-sided
//   skip          — geoset is a particle/shadow/effect plane → drop entirely
// Unlike the old resolver, team-color/glow geosets are KEPT (not dropped as
// "no diffuse") so units actually carry the player's colour like they do in game.
function resolveGeosetMaterial (mdx, geoset) {
  const mat = mdx.Materials && mdx.Materials[geoset.MaterialID];
  if (!mat || !mat.Layers) return { skip: false, baseName: null, replaceableId: 0, filterMode: 0 };
  let sawEffect = false;
  let diffuse = null;   // { baseName, filterMode, unshaded, twoSided } — first rid0 layer
  let team = 0;         // 1 (team color) / 2 (team glow), if any layer uses it
  // A WC3 material can stack layers: the classic team-colour geoset draws a flat
  // team-colour layer UNDER the unit texture (which is alpha-blended over it), so
  // the player's colour shows through the texture's transparent areas. Collect
  // both the diffuse texture AND the team replaceable so the client can composite
  // `mix(teamColor, texRGB, texAlpha)` — flat-tinting a textured geoset would lose
  // all the painted cloth/metal detail.
  for (const layer of mat.Layers) {
    const texId = layer.TextureID;
    if (typeof texId !== 'number') continue; // animated TextureID
    const tex = mdx.Textures && mdx.Textures[texId];
    if (!tex) continue;
    if (tex.ReplaceableId === 1) {           // team colour → runtime player tint
      if (!team) team = 1;
      continue;
    }
    if (tex.ReplaceableId === 2) {           // team glow → a radial-gradient sprite
      // whose alpha we don't have (per-player replaceable texture). Flat-tinting
      // the whole geoset yields a solid additive quad (a big colour rectangle),
      // so drop it like an effect plane. A subtle glow isn't worth that artifact.
      sawEffect = true;
      continue;
    }
    if (tex.ReplaceableId !== 0 || !tex.Image) continue; // other replaceable / empty
    if (isEffectTexture(tex.Image)) { sawEffect = true; continue; }
    const fm = (typeof layer.FilterMode === 'number') ? layer.FilterMode : 0;
    // Additive / AddAlpha / Modulate layers are glow/energy overlays (e.g. the
    // Obsidian Statue's floating rune wisps). In-game their alpha is animated so
    // they read as a subtle pulse; rendered static + full-bright they blow out to
    // harsh solid-white beams. We can't reproduce the animation, so drop them like
    // effect planes — only None/Transparent/Blend layers are real body geometry.
    if (fm >= 3) { sawEffect = true; continue; }
    if (!diffuse) {
      const shading = (typeof layer.Shading === 'number') ? layer.Shading : 0;
      diffuse = {
        baseName: path.basename(tex.Image, path.extname(tex.Image)).toLowerCase(),
        filterMode: fm,
        unshaded: (shading & 1) !== 0,   // LayerShading.Unshaded
        twoSided: (shading & 16) !== 0   // LayerShading.TwoSided
      };
    }
  }
  if (diffuse) {
    return { skip: false, baseName: diffuse.baseName, replaceableId: team,
             filterMode: diffuse.filterMode, unshaded: diffuse.unshaded, twoSided: diffuse.twoSided };
  }
  if (team) {
    // Pure team-colour/glow geoset (no diffuse) — a flat player-tinted overlay.
    return { skip: false, baseName: null, replaceableId: team, filterMode: 0, unshaded: false, twoSided: true };
  }
  // No usable layer. If the geoset's real texture was an effect, drop the geoset.
  return { skip: sawEffect, baseName: null, replaceableId: 0, filterMode: 0 };
}

// ---------------------------------------------------------------------------
// Build the skinned, animated glTF Document
// ---------------------------------------------------------------------------
function buildSkinnedDocument (mdx, ddsIndex, opts) {
  const warnings = [];
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('scene');
  doc.getRoot().setDefaultScene(scene);

  const scale = opts.scale || 1;
  const wrapper = doc.createNode('root').setRotation(ZUP_TO_YUP_QUAT).setScale([scale, scale, scale]);
  scene.addChild(wrapper);

  // --- Joints: every present node, indexed by ObjectId ---
  const nodes = (mdx.Nodes || []).filter(Boolean);
  const nodeByObjId = {};
  for (const n of nodes) nodeByObjId[n.ObjectId] = n;
  // Deterministic order by ObjectId.
  const ordered = nodes.slice().sort((a, b) => a.ObjectId - b.ObjectId);

  const jointNodeByObjId = {};
  const jointIndexByObjId = {};
  const jointNodes = [];
  ordered.forEach((n, i) => {
    const jn = doc.createNode(n.Name || ('node' + n.ObjectId));
    jointNodeByObjId[n.ObjectId] = jn;
    jointIndexByObjId[n.ObjectId] = i;
    jointNodes.push(jn);
  });

  const sequences = pickSequences(mdx);
  const idle = sequences.idle;
  const idleStart = idle ? idle.Interval[0] : 0;
  const idleEnd = idle ? idle.Interval[1] : 0;
  // Two-form model (statue ⇄ destroyer): both forms' geometry ships in one GLB,
  // tagged per-primitive, and the client shows one form at a time.
  const altIdle = sequences.idle_alt || null;

  // Rest = bind pose: local TRS = translate(pivot − parentPivot), identity rot/scale
  // (telescopes to translate(pivot)). Every clip animates from here. Wire parents.
  for (const n of ordered) {
    const jn = jointNodeByObjId[n.ObjectId];
    const pivot = Array.from(n.PivotPoint || [0, 0, 0]);
    const hasParent = n.Parent != null; // 0 is a valid ObjectId
    const parentPivot = hasParent && nodeByObjId[n.Parent]
      ? Array.from(nodeByObjId[n.Parent].PivotPoint || [0, 0, 0]) : [0, 0, 0];
    jn.setTranslation([pivot[0] - parentPivot[0], pivot[1] - parentPivot[1], pivot[2] - parentPivot[2]])
      .setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
    if (hasParent && jointNodeByObjId[n.Parent]) jointNodeByObjId[n.Parent].addChild(jn);
    else wrapper.addChild(jn);
  }

  // --- inverseBindMatrices: translate(-pivot) per joint, in skin.joints order ---
  const ibm = new Float32Array(ordered.length * 16);
  ordered.forEach((n, i) => {
    const p = n.PivotPoint || [0, 0, 0];
    const o = i * 16;
    ibm[o] = 1; ibm[o + 5] = 1; ibm[o + 10] = 1; ibm[o + 15] = 1;
    ibm[o + 12] = -p[0]; ibm[o + 13] = -p[1]; ibm[o + 14] = -p[2];
  });
  const ibmAcc = doc.createAccessor('ibm').setType('MAT4').setArray(ibm).setBuffer(buffer);

  // Omit skin.setSkeleton — it's optional; setting a non-common-root joint is a
  // spec error, and loaders compute the common root themselves.
  const skin = doc.createSkin('skeleton').setInverseBindMatrices(ibmAcc);
  jointNodes.forEach(jn => skin.addJoint(jn));

  // --- Mesh: one primitive per geoset, with skin attributes ---
  const mesh = doc.createMesh(mdx.Info && mdx.Info.Name || 'unit');
  const texCache = {}; // baseName -> Texture (shared across materials)
  const matCache = {}; // material key -> Material (filter mode / team color aware)
  let n4plus = 0, missingTex = 0, hidden = 0, hadHD = false, teamGeosets = 0;

  for (let gi = 0; gi < mdx.Geosets.length; gi++) {
    const g = mdx.Geosets[gi];
    const nv = g.Vertices.length / 3;
    if (nv === 0) continue;
    // Single-form: drop anything invisible during Stand (gore, blood, carry
    // props). Two-form: keep whatever either form's idle shows, and record
    // which form owns it so the client can toggle.
    let geosetForm = null;
    if (altIdle) {
      geosetForm = geosetFormVisibility(mdx, gi, idle, altIdle);
      if (!geosetForm) { hidden++; continue; }
    } else if (idle && !geosetVisibleDuringStand(mdx, gi, idleStart, idleEnd)) {
      hidden++; continue;
    }
    // Resolve WC3 material semantics. Drop only genuine effect planes
    // (matInfo.skip). Team-color/glow geosets (replaceableId 1/2) are KEPT and
    // rendered with a runtime player-tinted material; a geoset with neither a
    // diffuse texture nor a team replaceable has nothing to draw.
    const matInfo = resolveGeosetMaterial(mdx, g);
    if (matInfo.skip) { hidden++; continue; }
    if (!matInfo.baseName && !matInfo.replaceableId) { hidden++; continue; }

    const positions = new Float32Array(g.Vertices); // native Z-up
    const normals = new Float32Array(g.Normals);
    // glTF requires unit-length normals; some MDX verts have degenerate (~0) normals.
    for (let i = 0; i < normals.length; i += 3) {
      const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
      if (len > 1e-4) { normals[i] /= len; normals[i + 1] /= len; normals[i + 2] /= len; }
      else { normals[i] = 0; normals[i + 1] = 0; normals[i + 2] = 1; } // fallback up (Z-up)
    }
    const uvs = new Float32Array(nv * 2);
    if (g.TVertices && g.TVertices[0]) uvs.set(g.TVertices[0].subarray(0, nv * 2));

    const joints = new Uint16Array(nv * 4);
    const weights = new Float32Array(nv * 4);
    const isHD = (!g.Groups || !g.VertexGroup) && g.SkinWeights && g.SkinWeights.length >= nv * 8;
    if (!g.Groups || !g.VertexGroup) {
      if (!isHD) { warnings.push('geoset ' + gi + ' has no SD skin groups (skipped)'); continue; }
      hadHD = true;
    }
    for (let v = 0; v < nv; v++) {
      if (isHD) {
        // HD: 8 bytes/vertex = 4 bone ObjectIds + 4 weights (0-255). Renormalize.
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += g.SkinWeights[v * 8 + 4 + k];
        if (sum === 0) sum = 1;
        for (let k = 0; k < 4; k++) {
          const objId = g.SkinWeights[v * 8 + k];
          joints[v * 4 + k] = jointIndexByObjId[objId] != null ? jointIndexByObjId[objId] : 0;
          weights[v * 4 + k] = g.SkinWeights[v * 8 + 4 + k] / sum;
        }
        continue;
      }
      const group = g.Groups[g.VertexGroup[v]] || [0];
      const valid = Math.min(group.length, 4);
      if (group.length > 4) n4plus++;
      const w = 1 / valid;
      for (let k = 0; k < 4; k++) {
        if (k < valid) {
          joints[v * 4 + k] = jointIndexByObjId[group[k]] != null ? jointIndexByObjId[group[k]] : 0;
          weights[v * 4 + k] = w;
        }
      }
    }

    const idxArr = nv > 65535 ? new Uint32Array(g.Faces) : new Uint16Array(g.Faces);
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(normals).setBuffer(buffer))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uvs).setBuffer(buffer))
      .setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(joints).setBuffer(buffer))
      .setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(weights).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(idxArr).setBuffer(buffer));
    prim.setExtras({ geosetId: gi }); // source geoset (for tools/check-skinning.js)

    // Material: build/reuse a glTF material carrying the WC3 render semantics
    // (filter mode / unshaded / team-colour replaceable) as `extras.wc3` so the
    // client honours alpha, blend mode, unlit shading, and player tint.
    const team = matInfo.replaceableId || 0;
    const base = matInfo.baseName;
    const teamBlend = team && base;   // composite: team colour UNDER a unit texture
    // A composite team geoset fills its footprint (team colour where the texture
    // is transparent), so it renders OPAQUE and the client does the mix — the
    // diffuse layer's own blend mode would wrongly make the whole geoset see-through.
    const am = teamBlend ? { mode: 'OPAQUE', cutoff: null } : alphaModeFor(matInfo.filterMode || 0);
    const wc3 = {
      filterMode: matInfo.filterMode || 0,
      unshaded: !!matInfo.unshaded,
      replaceableId: team,
      teamBlend: !!teamBlend
    };
    if (team) teamGeosets++;

    let material;
    if (team && !base) {
      // Pure team colour/glow geoset: flat, no image; client sets player colour.
      const key = 'team' + team;
      if (matCache[key] === undefined) {
        matCache[key] = doc.createMaterial(key)
          .setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(1)
          .setDoubleSided(true).setAlphaMode(am.mode).setExtras(wc3);
      }
      material = matCache[key];
    } else {
      // Textured (optionally team-tinted) geoset.
      if (texCache[base] === undefined) {
        const ddsPath = ddsIndex[base];
        if (ddsPath) {
          const png = ddsToPngBuffer(ddsPath);
          texCache[base] = doc.createTexture(base).setImage(new Uint8Array(png)).setMimeType('image/png');
        } else { missingTex++; warnings.push('texture not found: ' + base); texCache[base] = null; }
      }
      const tex = texCache[base];
      if (tex) {
        const key = base + ':' + wc3.filterMode + ':' + (wc3.unshaded ? 1 : 0) + ':t' + team;
        if (matCache[key] === undefined) {
          const m = doc.createMaterial(key)
            .setBaseColorTexture(tex).setMetallicFactor(0).setRoughnessFactor(1)
            .setDoubleSided(true).setAlphaMode(am.mode).setExtras(wc3);
          if (am.cutoff != null) m.setAlphaCutoff(am.cutoff);
          matCache[key] = m;
        }
        material = matCache[key];
      }
    }
    if (material) prim.setMaterial(material);
    // Only tagged on two-form models — single-form GLBs stay byte-identical.
    if (geosetForm) prim.setExtras({ form: geosetForm });
    mesh.addPrimitive(prim);
  }

  // Skinned mesh node is a scene root with identity transform (its own transform
  // is ignored by glTF skinning). The bones live under `wrapper` (Z-up->Y-up +
  // scale), so deformation happens in Y-up space. CLIENT places a unit by moving
  // the wrapper / bone root — never the mesh node (that would double-transform).
  const meshNode = doc.createNode('mesh').setMesh(mesh).setSkin(skin);
  scene.addChild(meshNode);

  // --- Animation clips: one glTF animation per available canonical category,
  // named idle|walk|attack|death so the client looks them up directly. Each
  // windows every node's tracks to that sequence's interval (war3-model
  // per-sequence semantics via windowTrack). The skeleton/skin/mesh are shared. ---
  const clips = {};
  const CLIP_CATEGORIES = [
    'idle', 'walk', 'attack', 'death',
    // Two-form only; absent categories are skipped below.
    'idle_alt', 'walk_alt', 'attack_alt', 'death_alt', 'morph', 'morph_alt'
  ];
  for (const cat of CLIP_CATEGORIES) {
    const seq = sequences[cat];
    if (!seq) continue;
    const s = seq.Interval[0], e = seq.Interval[1];
    const animClip = doc.createAnimation(cat);
    let channels = 0;
    for (const n of ordered) {
      const jn = jointNodeByObjId[n.ObjectId];
      const pivot = Array.from(n.PivotPoint || [0, 0, 0]);
      const parentPivot = (n.Parent != null && nodeByObjId[n.Parent])
        ? Array.from(nodeByObjId[n.Parent].PivotPoint || [0, 0, 0]) : [0, 0, 0];
      const off = [pivot[0] - parentPivot[0], pivot[1] - parentPivot[1], pivot[2] - parentPivot[2]];
      const tw = windowTrack(n.Translation, 3, s, e);
      const rw = windowTrack(n.Rotation, 4, s, e);
      const sw = windowTrack(n.Scaling, 3, s, e);
      if (tw) {
        const out = new Float32Array(tw.values.length);
        for (let i = 0; i < tw.values.length; i += 3) { out[i] = off[0] + tw.values[i]; out[i + 1] = off[1] + tw.values[i + 1]; out[i + 2] = off[2] + tw.values[i + 2]; }
        addChannel(doc, animClip, buffer, jn, 'translation', tw.times, out, 'VEC3'); channels++;
      }
      if (rw) { addChannel(doc, animClip, buffer, jn, 'rotation', rw.times, rw.values, 'VEC4'); channels++; }
      if (sw) { addChannel(doc, animClip, buffer, jn, 'scale', sw.times, sw.values, 'VEC3'); channels++; }
    }
    if (!channels) { animClip.dispose(); continue; } // static sequence → no clip
    clips[cat] = { name: seq.Name, duration: +((e - s) / 1000).toFixed(3), loop: !seq.NonLooping };
  }

  if (n4plus) warnings.push(n4plus + ' vertices had >4 bone influences (truncated to 4)');
  if (!idle) warnings.push('no idle (Stand) sequence — exported static');
  if (hadHD) warnings.push('HD (SkinWeights) skin path used — verify visually');

  const exportedPrims = mesh.listPrimitives().length;
  return {
    doc,
    info: {
      joints: ordered.length,
      geosets: mdx.Geosets.length,
      hiddenGeosets: hidden,
      exportedGeosets: exportedPrims,
      teamGeosets,
      hd: hadHD,
      clips,
      stand: idle ? idle.Name : null,
      duration: idle ? (idleEnd - idleStart) / 1000 : 0,
      warnings
    }
  };
}

function addChannel (doc, anim, buffer, node, path_, times, values, outType) {
  const input = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer);
  const output = doc.createAccessor().setType(outType).setArray(values).setBuffer(buffer);
  const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
  const channel = doc.createAnimationChannel().setTargetNode(node).setTargetPath(path_).setSampler(sampler);
  anim.addSampler(sampler);
  anim.addChannel(channel);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function findUnitMdx (name) {
  const target = name.toLowerCase().replace(/\.mdx$/, '');
  let found = null;
  (function walk (dir) {
    if (found || !fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (found) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.toLowerCase() === target + '.mdx') found = full;
    }
  })(UNITS_DIR);
  return found;
}

function parseINI (filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  const sections = {}; let current = null;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('[') && t.endsWith(']')) { current = t.slice(1, -1); sections[current] = sections[current] || {}; }
    else if (current && t.includes('=')) { const eq = t.indexOf('='); sections[current][t.slice(0, eq).trim()] = t.slice(eq + 1).trim(); }
  }
  return sections;
}

// itemId -> { model, mdxPath } from unitskin.txt, units only (excludes buildings).
function getUnitMappings () {
  const skinPath = path.join(UNITS_DIR, 'unitskin.txt');
  if (!fs.existsSync(skinPath)) return {};
  const skin = parseINI(skinPath);
  const out = {};
  for (const [id, fields] of Object.entries(skin)) {
    // Reforged unitskin.txt uses `file:sd=`/`file:hd=` for units with split SD/HD
    // models (Death Knight, Demon Hunter, …); plain `file=` otherwise. Prefer SD.
    const fileVal = fields.file || fields['file:sd'];
    if (!fileVal) continue;
    const fp = fileVal.replace(/\\/g, '/');
    if (!/^units\//i.test(fp)) continue; // skip buildings/other
    const rel = fp.replace(/^units\//i, '');
    out[id] = { model: path.basename(rel).toLowerCase(), mdxPath: path.join(UNITS_DIR, rel + '.mdx') };
  }
  return out;
}

async function exportOne (file, scale, ddsIndex, outPath) {
  const ab = stripMDXChunks(new Uint8Array(fs.readFileSync(file)).buffer, ['LITE']);
  const mdx = parseMDX(ab);
  const { doc, info } = buildSkinnedDocument(mdx, ddsIndex, { scale });
  if (!info.exportedGeosets) throw new Error('no exportable geosets');
  if (!fs.existsSync(path.dirname(outPath))) fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const glb = await new NodeIO().writeBinary(doc);
  fs.writeFileSync(outPath, Buffer.from(glb));
  return { info, kb: glb.byteLength / 1024 };
}

// Batch-convert the whole unit roster → GLBs + unit-models.json manifest.
async function exportAll (ddsIndex) {
  const mappings = getUnitMappings();
  const byModel = {}; // mdxPath -> { model, itemIds[] }
  for (const [id, m] of Object.entries(mappings)) {
    (byModel[m.mdxPath] = byModel[m.mdxPath] || { model: m.model, itemIds: [] }).itemIds.push(id);
  }
  console.log('Roster: ' + Object.keys(mappings).length + ' itemIds → ' + Object.keys(byModel).length + ' unique models');

  const manifest = {}; const ok = [], failed = [], hd = [], noStand = [], noWalk = [], noAttack = []; const usedOut = {};
  for (const [mdxPath, m] of Object.entries(byModel)) {
    if (!fs.existsSync(mdxPath)) { failed.push(m.model + ': mdx missing'); continue; }
    let outName = m.model;
    if (usedOut[outName] && usedOut[outName] !== mdxPath) outName = m.model + '-' + path.basename(path.dirname(mdxPath));
    usedOut[outName] = mdxPath;
    try {
      const { info } = await exportOne(mdxPath, 1, ddsIndex, path.join(OUTPUT_DIR, outName + '.glb'));
      ok.push(outName);
      if (info.hd) hd.push(outName);
      if (!info.stand) noStand.push(outName);
      if (!info.clips.walk) noWalk.push(outName);
      if (!info.clips.attack) noAttack.push(outName);
      for (const id of m.itemIds) manifest[id] = { model: outName, scale: 1, clips: info.clips };
    } catch (e) { failed.push(m.model + ': ' + e.message.slice(0, 70)); }
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'unit-models.json'), JSON.stringify(manifest, null, 2));
  console.log('\n=== Batch summary ===');
  console.log(ok.length + ' converted, ' + failed.length + ' failed, ' + hd.length + ' HD');
  console.log('clip coverage: ' + (ok.length - noStand.length) + ' idle, ' + (ok.length - noWalk.length) + ' walk, ' + (ok.length - noAttack.length) + ' attack (of ' + ok.length + ')');
  if (failed.length) { console.log('\nFAILED (' + failed.length + '):'); failed.forEach(f => console.log('  ' + f)); }
  if (hd.length) console.log('\nHD models (verify): ' + hd.join(', '));
  if (noStand.length) console.log('\nno-Stand (static): ' + noStand.join(', '));
  console.log('\nManifest: ' + Object.keys(manifest).length + ' itemIds → ' + new Set(Object.values(manifest).map(v => v.model)).size + ' models');
  console.log('Wrote ' + path.join(OUTPUT_DIR, 'unit-models.json'));
}

async function main () {
  const args = process.argv.slice(2);
  const get = k => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=').slice(1).join('=') : null; };

  if (args.includes('--all')) { await exportAll(buildDdsIndex()); return; }

  let file = get('file');
  const unit = get('unit');
  if (!file && unit) file = findUnitMdx(unit);
  if (!file) { console.error('Provide --unit=NAME, --file=PATH, or --all'); process.exit(1); }
  if (!fs.existsSync(file)) { console.error('Not found: ' + file); process.exit(1); }

  const scale = parseFloat(get('scale')) || 1;
  const baseName = (unit || path.basename(file, '.mdx')).toLowerCase();
  const outPath = get('out') || path.join(OUTPUT_DIR, baseName + '.glb');

  console.log('Reading ' + file);
  const { info, kb } = await exportOne(file, scale, buildDdsIndex(), outPath);
  console.log('Wrote ' + outPath + '  (' + kb.toFixed(1) + ' KB)');
  const clipStr = Object.entries(info.clips).map(([c, v]) => c + '=' + v.name + '(' + v.duration + 's' + (v.loop ? '' : ',1shot') + ')').join(' ');
  console.log('  joints=' + info.joints + ' geosets=' + info.exportedGeosets + '/' + info.geosets +
    ' (hid ' + info.hiddenGeosets + ')  clips: ' + (clipStr || 'none'));
  for (const w of info.warnings) console.log('  WARN: ' + w);
}

main().catch(err => { console.error(err); process.exit(1); });
