/**
 * Independent correctness check for the skinned-glTF exporter.
 *
 * Computes the Stand-pose deformed vertices TWO independent ways and compares:
 *   (A) ENGINE truth — straight from the MDX, using war3-model's node-matrix
 *       formula  world = parent x T(pivot+animT) R(animR) S(animS) T(-pivot),
 *       then  skinned = (1/n) Σ nodeWorld[ObjectId] · vertex   (Z-up).
 *   (B) glTF skinning — from the exported .glb, standard glTF math
 *       skinned = Σ w · jointWorld · inverseBind · vertex      (Y-up via wrapper).
 * Engine result is rotated Z-up->Y-up and compared to (B). Agreement proves the
 * export reproduces the engine. Both sides use LINEAR interpolation (matching the
 * exporter), so this validates the data plumbing, not Hermite fidelity.
 *
 * Usage:
 *   node tools/check-skinning.js --unit=footman
 *   node tools/check-skinning.js --file=path.mdx --glb=client/assets/models/units/footman.glb
 */
const fs = require('fs');
const path = require('path');
const { parseMDX } = require('war3-model');
const { mat4, vec3 } = require('gl-matrix');
const { stripMDXChunks, pickSequences } = require('./lib/mdx-skin');

const UNITS_DIR = path.join(__dirname, 'map-data', 'units');
const OUT_DIR = path.join(__dirname, '..', 'client', 'assets', 'models', 'units');

function findUnitMdx (name) {
  const target = name.toLowerCase() + '.mdx'; let found = null;
  (function walk (d) { if (found || !fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (found) return; const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.name.toLowerCase() === target) found = f; } })(UNITS_DIR);
  return found;
}

// Per-sequence linear interpolation matching war3-model: only keys inside the
// sequence [from,to] drive the node; none → null (default rest); before first /
// after last in-range key, hold that key. Ignores Hermite tangents (so does the
// exporter), so this validates the data pipeline, not curve fidelity.
function interpTrack (track, frame, n, from, to) {
  if (!track || typeof track === 'number' || !track.Keys || !track.Keys.length) return null;
  const k = track.Keys.filter(kf => kf.Frame >= from && kf.Frame <= to);
  if (!k.length) return null;
  if (frame <= k[0].Frame) return Array.from(k[0].Vector).slice(0, n);
  if (frame >= k[k.length - 1].Frame) return Array.from(k[k.length - 1].Vector).slice(0, n);
  for (let i = 0; i < k.length - 1; i++) {
    if (frame >= k[i].Frame && frame <= k[i + 1].Frame) {
      const t = (frame - k[i].Frame) / ((k[i + 1].Frame - k[i].Frame) || 1);
      const out = []; for (let c = 0; c < n; c++) out.push(k[i].Vector[c] + (k[i + 1].Vector[c] - k[i].Vector[c]) * t);
      if (n === 4) { const m = Math.hypot(out[0], out[1], out[2], out[3]) || 1; for (let c = 0; c < 4; c++) out[c] /= m; }
      return out;
    }
  }
  return Array.from(k[0].Vector).slice(0, n);
}

// (A) Engine node world matrices at an MDX frame within Stand [from,to] (Z-up).
function engineWorlds (mdx, frame, from, to) {
  const nodes = (mdx.Nodes || []).filter(Boolean);
  const byId = {}; nodes.forEach(n => { byId[n.ObjectId] = n; });
  const worlds = {};
  function build (n) {
    if (worlds[n.ObjectId]) return worlds[n.ObjectId];
    const T = interpTrack(n.Translation, frame, 3, from, to) || [0, 0, 0];
    const R = interpTrack(n.Rotation, frame, 4, from, to) || [0, 0, 0, 1];
    const S = interpTrack(n.Scaling, frame, 3, from, to) || [1, 1, 1];
    const local = mat4.create();
    mat4.fromRotationTranslationScaleOrigin(local, R, T, S, Array.from(n.PivotPoint || [0, 0, 0]));
    let world;
    if (n.Parent != null && byId[n.Parent]) world = mat4.multiply(mat4.create(), build(byId[n.Parent]), local);
    else world = local;
    worlds[n.ObjectId] = world; return world;
  }
  nodes.forEach(build);
  return worlds;
}

function engineSkinGeoset (g, worlds) {
  const nv = g.Vertices.length / 3; const out = new Float32Array(nv * 3); const tmp = vec3.create();
  for (let v = 0; v < nv; v++) {
    const group = g.Groups[g.VertexGroup[v]] || [0];
    const p = [g.Vertices[v * 3], g.Vertices[v * 3 + 1], g.Vertices[v * 3 + 2]];
    let sx = 0, sy = 0, sz = 0;
    for (const objId of group) { vec3.transformMat4(tmp, p, worlds[objId]); sx += tmp[0]; sy += tmp[1]; sz += tmp[2]; }
    out[v * 3] = sx / group.length; out[v * 3 + 1] = sy / group.length; out[v * 3 + 2] = sz / group.length;
  }
  return out;
}

// --- GLB parsing (matches client/js/GLBLoader.js parseSkinned data path) ---
function parseGLB (file) {
  const ab = new Uint8Array(fs.readFileSync(file)).buffer;
  const dv = new DataView(ab);
  const jsonLen = dv.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 20, jsonLen)));
  const binOff = 20 + jsonLen;
  const bin = ab.slice(binOff + 8, binOff + 8 + dv.getUint32(binOff, true));
  const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
  const TC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const read = (i) => {
    const a = gltf.accessors[i], bv = gltf.bufferViews[a.bufferView], TA = COMP[a.componentType], c = TC[a.type];
    const elemBytes = c * TA.BYTES_PER_ELEMENT;
    const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const stride = bv.byteStride || elemBytes;
    if (stride === elemBytes) return new TA(bin.slice(base, base + a.count * elemBytes));
    const out = new TA(a.count * c);
    for (let e = 0; e < a.count; e++) { const o = base + e * stride; out.set(new TA(bin.slice(o, o + elemBytes)), e * c); }
    return out;
  };
  return { gltf, read };
}

// (B) glTF skinning of one primitive at clip time tau (seconds) -> Y-up verts.
function gltfSkinPrimitive (gltf, read, prim, skin, animClip, tau) {
  // Node local transforms (apply animation overrides at tau).
  const overrides = {}; // nodeIndex -> {T?,R?,S?}
  if (animClip) {
    for (const ch of animClip.channels) {
      const s = animClip.samplers[ch.sampler];
      const times = read(s.input); const vals = read(s.output);
      const n = ch.target.path === 'rotation' ? 4 : 3;
      // linear interp at tau
      let val;
      if (tau <= times[0]) val = Array.from(vals.slice(0, n));
      else if (tau >= times[times.length - 1]) val = Array.from(vals.slice((times.length - 1) * n, times.length * n));
      else { let i = 0; while (times[i + 1] < tau) i++; const t = (tau - times[i]) / ((times[i + 1] - times[i]) || 1); val = []; for (let c = 0; c < n; c++) val.push(vals[i * n + c] + (vals[(i + 1) * n + c] - vals[i * n + c]) * t); if (n === 4) { const m = Math.hypot(val[0], val[1], val[2], val[3]) || 1; for (let c = 0; c < 4; c++) val[c] /= m; } }
      overrides[ch.target.node] = overrides[ch.target.node] || {};
      overrides[ch.target.node][ch.target.path] = val;
    }
  }
  // parent map
  const parent = {}; gltf.nodes.forEach((n, i) => { if (n.children) n.children.forEach(c => { parent[c] = i; }); });
  const worldCache = {};
  function world (i) {
    if (worldCache[i]) return worldCache[i];
    const n = gltf.nodes[i]; const ov = overrides[i] || {};
    const T = ov.translation || n.translation || [0, 0, 0];
    const R = ov.rotation || n.rotation || [0, 0, 0, 1];
    const S = ov.scale || n.scale || [1, 1, 1];
    const local = mat4.fromRotationTranslationScale(mat4.create(), R, T, S);
    const w = parent[i] !== undefined ? mat4.multiply(mat4.create(), world(parent[i]), local) : local;
    worldCache[i] = w; return w;
  }
  const ibm = read(skin.inverseBindMatrices);
  const jointWorlds = skin.joints.map(ji => world(ji));
  const skinMats = skin.joints.map((ji, j) => {
    const inv = mat4.fromValues.apply(null, Array.from(ibm.slice(j * 16, j * 16 + 16)));
    return mat4.multiply(mat4.create(), jointWorlds[j], inv);
  });

  const pos = read(prim.attributes.POSITION);
  const ji = read(prim.attributes.JOINTS_0);
  const jw = read(prim.attributes.WEIGHTS_0);
  const nv = pos.length / 3; const out = new Float32Array(nv * 3); const tmp = vec3.create();
  for (let v = 0; v < nv; v++) {
    const p = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
    let sx = 0, sy = 0, sz = 0;
    for (let k = 0; k < 4; k++) {
      const w = jw[v * 4 + k]; if (w === 0) continue;
      const jIdx = ji[v * 4 + k];
      const m = skinMats[jIdx];
      if (!m) throw new Error('bad joint index ' + jIdx + ' (skinMats len=' + skinMats.length + ', skin.joints len=' + skin.joints.length + ') at vertex ' + v + ' slot ' + k);
      vec3.transformMat4(tmp, p, m);
      sx += tmp[0] * w; sy += tmp[1] * w; sz += tmp[2] * w;
    }
    out[v * 3] = sx; out[v * 3 + 1] = sy; out[v * 3 + 2] = sz;
  }
  return out;
}

function bbox (verts) {
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < verts.length; i += 3) for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], verts[i + c]); mx[c] = Math.max(mx[c], verts[i + c]); }
  return { size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
}

function main () {
  const args = process.argv.slice(2);
  const get = k => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=').slice(1).join('=') : null; };
  const unit = get('unit');
  let mdxFile = get('file') || (unit && findUnitMdx(unit));
  let glbFile = get('glb') || (unit && path.join(OUT_DIR, unit + '.glb'));
  if (!mdxFile || !glbFile) { console.error('Need --unit=NAME (or --file= and --glb=)'); process.exit(1); }

  const category = get('clip') || 'idle'; // idle|walk|attack|death
  const mdx = parseMDX(stripMDXChunks(new Uint8Array(fs.readFileSync(mdxFile)).buffer, ['LITE']));
  const { gltf, read } = parseGLB(glbFile);
  const skin = gltf.skins[0];
  const animClip = (gltf.animations || []).find(a => a.name === category) || (gltf.animations || [])[0];

  // Engine-side sequence for this clip category.
  const seq = pickSequences(mdx)[category];
  if (!seq || !animClip) { console.log('no "' + category + '" clip — skipped'); return; }
  const start = seq.Interval[0], end = seq.Interval[1];
  console.log('Comparing engine vs glTF skinning for ' + category + ' = "' + seq.Name + '" [' + start + '..' + end + ']');

  // glTF prims align 1:1 with MDX geosets (export iterates geosets in order).
  const meshNodeIdx = gltf.nodes.findIndex(n => n.mesh !== undefined && n.skin !== undefined);
  const prims = gltf.meshes[gltf.nodes[meshNodeIdx].mesh].primitives;

  const samples = [0, 0.5, 1.0]; // fractions through the clip
  let worstAll = 0;
  for (const frac of samples) {
    const frame = start + (end - start) * frac;
    const tau = (frame - start) / 1000;
    const worlds = engineWorlds(mdx, frame, start, end);
    let worst = 0, count = 0;
    for (const prim of prims) {
      const gi = prim.extras && prim.extras.geosetId; // exporter-tagged source geoset
      if (gi === undefined) { console.log('  (skip prim with no geosetId tag)'); continue; }
      const eng = engineSkinGeoset(mdx.Geosets[gi], worlds);    // Z-up
      const glb = gltfSkinPrimitive(gltf, read, prim, skin, animClip, tau); // Y-up
      for (let v = 0; v < eng.length; v += 3) {
        // engine Z-up -> Y-up: (x,y,z) -> (x, z, -y)
        const ex = eng[v], ey = eng[v + 2], ez = -eng[v + 1];
        const d = Math.hypot(glb[v] - ex, glb[v + 1] - ey, glb[v + 2] - ez);
        if (d > worst) worst = d; count++;
      }
    }
    worstAll = Math.max(worstAll, worst);
    const bb = bbox(gltfSkinPrimitive(gltf, read, prims[0], skin, animClip, tau));
    console.log('  t=' + frac.toFixed(2) + ' (frame ' + frame.toFixed(0) + '): max vertex deviation = ' +
      worst.toFixed(4) + ' wu   [geoset0 bbox ' + bb.size.map(x => x.toFixed(0)).join('x') + ']');
  }

  const TOL = 1.0; // world units; both sides linear, so should be ~0 (float + boundary keys)
  if (worstAll <= TOL) console.log('PASS — export reproduces the engine (max dev ' + worstAll.toFixed(4) + ' <= ' + TOL + ' wu)');
  else { console.log('FAIL — max deviation ' + worstAll.toFixed(4) + ' wu exceeds ' + TOL + ' wu'); process.exit(1); }
}

main();
