/**
 * Convert WC3 MDX model files to glTF 2.0 binary (.glb) for Three.js.
 *
 * Usage:
 *   node tools/convert-mdx-to-gltf.js --cliffs            Convert all cliff models
 *   node tools/convert-mdx-to-gltf.js --trees             Convert tree models for all tilesets
 *   node tools/convert-mdx-to-gltf.js --buildings          Convert all building models
 *   node tools/convert-mdx-to-gltf.js --list-buildings     Show building type→file mappings
 *   node tools/convert-mdx-to-gltf.js --file=path.mdx     Convert a single MDX file
 *   node tools/convert-mdx-to-gltf.js --list-trees        Show tree type→file mappings
 *
 * Input:  tools/map-data/doodads/ (extracted WC3 CASC data)
 *         tools/map-data/buildings/ (extracted building MDX files)
 * Output: tools/map-data/converted/ (glb files ready for client loading)
 *         client/assets/models/buildings/ (building glb files + manifest)
 */
const fs = require('fs');
const path = require('path');
const { parseMDX } = require('war3-model');
const { parseSLK } = require('../helpers/slkParser');

const { createCanvas, ImageData } = require('canvas');

const DOODADS_DIR = path.join(__dirname, 'map-data', 'doodads');
const BUILDINGS_DIR = path.join(__dirname, 'map-data', 'buildings');
const TEXTURES_DIR = path.join(__dirname, 'map-data', 'textures');
const OUTPUT_DIR = path.join(__dirname, 'map-data', 'converted');
const BUILDINGS_OUTPUT_DIR = path.join(__dirname, '..', 'client', 'assets', 'models', 'buildings');
const BUILDING_TEX_OUTPUT_DIR = path.join(__dirname, '..', 'client', 'assets', 'textures', 'buildings');

// --- glTF 2.0 binary writer ---

function buildGLB (meshData) {
  // meshData: { positions: Float32Array, normals: Float32Array, uvs: Float32Array, indices: Uint16Array|Uint32Array }
  const posCount = meshData.positions.length / 3;
  const useUint32 = meshData.indices.some(i => i > 65535);
  const idxComponentType = useUint32 ? 5125 : 5123; // UNSIGNED_INT or UNSIGNED_SHORT
  const idxBytes = useUint32
    ? new Uint32Array(meshData.indices).buffer
    : new Uint16Array(meshData.indices).buffer;

  const posBytes = new Float32Array(meshData.positions).buffer;
  const normBytes = new Float32Array(meshData.normals).buffer;
  const uvBytes = new Float32Array(meshData.uvs).buffer;

  // Compute bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < meshData.positions.length; i += 3) {
    const x = meshData.positions[i], y = meshData.positions[i + 1], z = meshData.positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  // Build buffer: indices | positions | normals | uvs (each 4-byte aligned)
  function align4 (n) { return (n + 3) & ~3; }
  const idxLen = align4(idxBytes.byteLength);
  const posLen = align4(posBytes.byteLength);
  const normLen = align4(normBytes.byteLength);
  const uvLen = align4(uvBytes.byteLength);
  const totalBufLen = idxLen + posLen + normLen + uvLen;

  const binBuf = new ArrayBuffer(totalBufLen);
  const binView = new Uint8Array(binBuf);
  binView.set(new Uint8Array(idxBytes), 0);
  binView.set(new Uint8Array(posBytes), idxLen);
  binView.set(new Uint8Array(normBytes), idxLen + posLen);
  binView.set(new Uint8Array(uvBytes), idxLen + posLen + normLen);

  const gltf = {
    asset: { version: '2.0', generator: 'wc3v-mdx-converter' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 1, NORMAL: 2, TEXCOORD_0: 3 },
        indices: 0,
        mode: 4 // TRIANGLES
      }]
    }],
    accessors: [
      { bufferView: 0, componentType: idxComponentType, count: meshData.indices.length, type: 'SCALAR' },
      { bufferView: 1, componentType: 5126, count: posCount, type: 'VEC3',
        min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
      { bufferView: 2, componentType: 5126, count: posCount, type: 'VEC3' },
      { bufferView: 3, componentType: 5126, count: posCount, type: 'VEC2' }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: idxBytes.byteLength },
      { buffer: 0, byteOffset: idxLen, byteLength: posBytes.byteLength },
      { buffer: 0, byteOffset: idxLen + posLen, byteLength: normBytes.byteLength },
      { buffer: 0, byteOffset: idxLen + posLen + normLen, byteLength: uvBytes.byteLength }
    ],
    buffers: [{ byteLength: totalBufLen }]
  };

  const jsonStr = JSON.stringify(gltf);
  const jsonBuf = Buffer.from(jsonStr, 'utf-8');
  const jsonPadLen = align4(jsonBuf.length);
  const jsonPadded = Buffer.alloc(jsonPadLen, 0x20); // pad with spaces
  jsonBuf.copy(jsonPadded);

  // GLB header (12 bytes) + JSON chunk (8 + jsonPadLen) + BIN chunk (8 + totalBufLen)
  const glbLen = 12 + 8 + jsonPadLen + 8 + totalBufLen;
  const glb = Buffer.alloc(glbLen);
  let off = 0;

  // GLB header
  glb.writeUInt32LE(0x46546C67, off); off += 4; // 'glTF'
  glb.writeUInt32LE(2, off); off += 4;           // version 2
  glb.writeUInt32LE(glbLen, off); off += 4;       // total length

  // JSON chunk
  glb.writeUInt32LE(jsonPadLen, off); off += 4;
  glb.writeUInt32LE(0x4E4F534A, off); off += 4; // 'JSON'
  jsonPadded.copy(glb, off); off += jsonPadLen;

  // BIN chunk
  glb.writeUInt32LE(totalBufLen, off); off += 4;
  glb.writeUInt32LE(0x004E4942, off); off += 4; // 'BIN\0'
  Buffer.from(binBuf).copy(glb, off);

  return glb;
}

// --- DDS decoder (for embedding building textures in GLBs) ---

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
    col2 = [Math.round((2*col0[0]+col1[0])/3), Math.round((2*col0[1]+col1[1])/3), Math.round((2*col0[2]+col1[2])/3)];
    col3 = [Math.round((col0[0]+2*col1[0])/3), Math.round((col0[1]+2*col1[1])/3), Math.round((col0[2]+2*col1[2])/3)];
  } else {
    col2 = [Math.round((col0[0]+col1[0])/2), Math.round((col0[1]+col1[1])/2), Math.round((col0[2]+col1[2])/2)];
    col3 = [0, 0, 0]; alpha3 = 0;
  }
  const palette = [col0, col1, col2, col3];
  for (let py = 0; py < 4; py++) { const yy = py0 + py; if (yy >= height) continue;
    for (let px = 0; px < 4; px++) { const xx = px0 + px; if (xx >= width) continue;
      const idx = (indices >>> ((py * 4 + px) * 2)) & 0x3, c = palette[idx], dst = (yy * width + xx) * 4;
      out[dst] = c[0]; out[dst+1] = c[1]; out[dst+2] = c[2];
      if (!dxt3or5) out[dst+3] = (idx === 3) ? alpha3 : 255;
    }
  }
}
function decodeDxt5AlphaBlock (data, offset, out, width, height, px0, py0) {
  const a0 = data[offset], a1 = data[offset + 1];
  const pal = new Array(8); pal[0] = a0; pal[1] = a1;
  if (a0 > a1) { for (let i = 1; i < 7; i++) pal[i+1] = Math.round(((7-i)*a0 + i*a1) / 7); }
  else { for (let i = 1; i < 5; i++) pal[i+1] = Math.round(((5-i)*a0 + i*a1) / 5); pal[6] = 0; pal[7] = 255; }
  const lo = data[offset+2] | (data[offset+3]<<8) | (data[offset+4]<<16);
  const hi = data[offset+5] | (data[offset+6]<<8) | (data[offset+7]<<16);
  for (let i = 0; i < 16; i++) {
    const py = i >> 2, px = i & 3, yy = py0 + py, xx = px0 + px;
    if (yy >= height || xx >= width) continue;
    const idx = i < 8 ? (lo >> (i*3)) & 7 : (hi >> ((i-8)*3)) & 7;
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
      for (let py = 0; py < 4; py++) { const yy = by + py; if (yy >= height) continue; const rowBytes = data.readUInt16LE(off + py * 2);
        for (let px = 0; px < 4; px++) { const xx = bx + px; if (xx >= width) continue; const a4 = (rowBytes >> (px * 4)) & 0xF; out[(yy * width + xx) * 4 + 3] = (a4 << 4) | a4; }
      } decodeDxt1Block(data, off + 8, out, width, height, bx, by, true); off += 16; }
    return { width, height, rgba: out };
  }
  if (rgbBitCount === 32) {
    for (let i = 0; i < width * height; i++) { const px = data.readUInt32LE(i * 4); out[i*4] = (px >> 16) & 0xFF; out[i*4+1] = (px >> 8) & 0xFF; out[i*4+2] = px & 0xFF; out[i*4+3] = (px >> 24) & 0xFF; }
    return { width, height, rgba: out };
  }
  throw new Error('unsupported DDS: ' + fourcc);
}

function ddsToPngBuffer (ddsPath) {
  const buf = fs.readFileSync(ddsPath);
  const { width, height, rgba } = decodeDds(buf);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas.toBuffer('image/png');
}

// Build DDS file index across buildings/ and textures/ directories
function buildDdsIndex () {
  const index = {};
  function walk (dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else if (entry.name.toLowerCase().endsWith('.dds')) {
        const baseName = entry.name.slice(0, -4).toLowerCase();
        if (!index[baseName] || dir.includes('buildings')) {
          index[baseName] = path.join(dir, entry.name);
        }
      }
    }
  }
  walk(BUILDINGS_DIR);
  walk(TEXTURES_DIR);
  return index;
}

// --- Multi-primitive GLB builder (per-geoset materials + embedded textures) ---

function buildBuildingGLB (geosets, pngBuffers) {
  // geosets: [{ positions, normals, uvs, indices, textureIndex }]
  // pngBuffers: [Buffer] — PNG image data, indexed by textureIndex

  function align4 (n) { return (n + 3) & ~3; }

  // Build binary buffer: all geometry + all embedded images
  const chunks = []; // { data: ArrayBuffer, offset: computed later }
  const bufferViews = [];
  const accessors = [];
  const primitives = [];
  const images = [];
  const textures = [];
  const materials = [];
  const samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }]; // LINEAR_MIPMAP_LINEAR

  let binOffset = 0;
  let accIdx = 0;
  let bvIdx = 0;

  // Create unique textures/materials for each PNG
  const texMaterialMap = {}; // textureIndex → materialIndex
  for (let ti = 0; ti < pngBuffers.length; ti++) {
    if (!pngBuffers[ti]) continue;
    const imgIdx = images.length;
    const imgBv = bvIdx++;
    const pngBuf = pngBuffers[ti];
    const pngLen = align4(pngBuf.length);

    bufferViews.push({ buffer: 0, byteOffset: binOffset, byteLength: pngBuf.length });
    binOffset += pngLen;
    chunks.push({ data: pngBuf, padLen: pngLen });

    images.push({ bufferView: imgBv, mimeType: 'image/png' });
    const texIdx = textures.length;
    textures.push({ source: imgIdx, sampler: 0 });
    const matIdx = materials.length;
    materials.push({
      pbrMetallicRoughness: {
        baseColorTexture: { index: texIdx },
        metallicFactor: 0,
        roughnessFactor: 0.9
      },
      doubleSided: true
    });
    texMaterialMap[ti] = matIdx;
  }

  // Add a fallback material for geosets without textures (team color etc)
  const fallbackMatIdx = materials.length;
  materials.push({
    pbrMetallicRoughness: { baseColorFactor: [0.85, 0.85, 0.85, 1.0], metallicFactor: 0, roughnessFactor: 0.9 },
    doubleSided: true
  });

  // Add geometry for each geoset
  for (const geo of geosets) {
    const posCount = geo.positions.length / 3;
    const useUint32 = geo.indices.some(i => i > 65535);
    const idxComponentType = useUint32 ? 5125 : 5123;
    const idxBuf = useUint32 ? Buffer.from(new Uint32Array(geo.indices).buffer) : Buffer.from(new Uint16Array(geo.indices).buffer);
    const posBuf = Buffer.from(new Float32Array(geo.positions).buffer);
    const normBuf = Buffer.from(new Float32Array(geo.normals).buffer);
    const uvBuf = Buffer.from(new Float32Array(geo.uvs).buffer);

    // Bounding box
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < geo.positions.length; i += 3) {
      const x = geo.positions[i], y = geo.positions[i+1], z = geo.positions[i+2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }

    const idxBvIdx = bvIdx++;
    const idxLen = align4(idxBuf.length);
    bufferViews.push({ buffer: 0, byteOffset: binOffset, byteLength: idxBuf.length });
    binOffset += idxLen;
    chunks.push({ data: idxBuf, padLen: idxLen });

    const posBvIdx = bvIdx++;
    const posLen = align4(posBuf.length);
    bufferViews.push({ buffer: 0, byteOffset: binOffset, byteLength: posBuf.length });
    binOffset += posLen;
    chunks.push({ data: posBuf, padLen: posLen });

    const normBvIdx = bvIdx++;
    const normLen = align4(normBuf.length);
    bufferViews.push({ buffer: 0, byteOffset: binOffset, byteLength: normBuf.length });
    binOffset += normLen;
    chunks.push({ data: normBuf, padLen: normLen });

    const uvBvIdx = bvIdx++;
    const uvLen = align4(uvBuf.length);
    bufferViews.push({ buffer: 0, byteOffset: binOffset, byteLength: uvBuf.length });
    binOffset += uvLen;
    chunks.push({ data: uvBuf, padLen: uvLen });

    const idxAccIdx = accIdx++;
    accessors.push({ bufferView: idxBvIdx, componentType: idxComponentType, count: geo.indices.length, type: 'SCALAR' });
    const posAccIdx = accIdx++;
    accessors.push({ bufferView: posBvIdx, componentType: 5126, count: posCount, type: 'VEC3', min: [minX, minY, minZ], max: [maxX, maxY, maxZ] });
    const normAccIdx = accIdx++;
    accessors.push({ bufferView: normBvIdx, componentType: 5126, count: posCount, type: 'VEC3' });
    const uvAccIdx = accIdx++;
    accessors.push({ bufferView: uvBvIdx, componentType: 5126, count: posCount, type: 'VEC2' });

    const matIdx = texMaterialMap[geo.textureIndex] !== undefined ? texMaterialMap[geo.textureIndex] : fallbackMatIdx;
    primitives.push({
      attributes: { POSITION: posAccIdx, NORMAL: normAccIdx, TEXCOORD_0: uvAccIdx },
      indices: idxAccIdx,
      material: matIdx,
      mode: 4
    });
  }

  const totalBufLen = binOffset;
  const gltf = {
    asset: { version: '2.0', generator: 'wc3v-building-converter' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: totalBufLen }],
    materials,
    textures: textures.length ? textures : undefined,
    images: images.length ? images : undefined,
    samplers: textures.length ? samplers : undefined
  };

  // Remove undefined keys
  Object.keys(gltf).forEach(k => { if (gltf[k] === undefined) delete gltf[k]; });

  const jsonStr = JSON.stringify(gltf);
  const jsonBuf = Buffer.from(jsonStr, 'utf-8');
  const jsonPadLen = align4(jsonBuf.length);
  const jsonPadded = Buffer.alloc(jsonPadLen, 0x20);
  jsonBuf.copy(jsonPadded);

  const glbLen = 12 + 8 + jsonPadLen + 8 + totalBufLen;
  const glb = Buffer.alloc(glbLen);
  let off = 0;
  glb.writeUInt32LE(0x46546C67, off); off += 4;
  glb.writeUInt32LE(2, off); off += 4;
  glb.writeUInt32LE(glbLen, off); off += 4;
  glb.writeUInt32LE(jsonPadLen, off); off += 4;
  glb.writeUInt32LE(0x4E4F534A, off); off += 4;
  jsonPadded.copy(glb, off); off += jsonPadLen;
  glb.writeUInt32LE(totalBufLen, off); off += 4;
  glb.writeUInt32LE(0x004E4942, off); off += 4;

  for (const chunk of chunks) {
    const src = Buffer.isBuffer(chunk.data) ? chunk.data : Buffer.from(chunk.data);
    src.copy(glb, off);
    off += chunk.padLen;
  }

  return glb;
}

// --- MDX → mesh data extraction ---

// Strip problematic chunks from MDX binary that war3-model can't parse
// (Reforged MDX files have extended LITE chunk fields the parser doesn't handle)
function stripMDXChunks (buffer, chunkNames) {
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  // MDX starts with 'MDLX' (4 bytes), then sequential chunks: keyword(4) + size(4) + data(size)
  if (view.getUint32(0, true) !== 0x584C444D) return buffer; // not MDLX

  const pieces = [];
  pieces.push(buffer.slice(0, 4)); // MDLX header
  let pos = 4;
  while (pos + 8 <= buffer.byteLength) {
    const keyword = String.fromCharCode(u8[pos], u8[pos + 1], u8[pos + 2], u8[pos + 3]);
    const chunkSize = view.getUint32(pos + 4, true);
    const chunkEnd = pos + 8 + chunkSize;
    if (chunkEnd > buffer.byteLength) break;

    if (!chunkNames.includes(keyword)) {
      pieces.push(buffer.slice(pos, chunkEnd));
    }
    pos = chunkEnd;
  }

  // Reassemble
  const totalLen = pieces.reduce((s, p) => s + p.byteLength, 0);
  const result = new ArrayBuffer(totalLen);
  const dst = new Uint8Array(result);
  let off = 0;
  for (const p of pieces) {
    dst.set(new Uint8Array(p), off);
    off += p.byteLength;
  }
  return result;
}

// Pick the ROOTED idle sequence whose geoset visibility defines the building's
// stationary form. Night Elf Ancients carry "...Alternate" (and "Morph")
// sequences for their UPROOTED walking-treant form; those expose a different
// geoset set (legs/face, extending below ground) and must never be chosen.
// A naive startsWith('stand work') matched "Stand Work Alternate" and baked the
// uprooted geometry — the cause of ancients rendering as crouched creatures.
// formTag: null for the base building, or 'first' | 'second' | 'third' for the
// upgraded forms (matching the SLK Animprops tags 'upgrade,first' etc. and the
// MDX sequences 'Stand [Work] Upgrade First/Second/Third').
function pickStandSequence (mdx, formTag) {
  if (!mdx.Sequences || !mdx.Sequences.length) return null;

  const candidates = mdx.Sequences.filter(s => {
    const n = s.Name.toLowerCase();
    if (!n.startsWith('stand') || n.includes('alternate') || n.includes('morph')) return false;
    if (formTag) return n.includes('upgrade ' + formTag);
    return !n.includes('upgrade');
  });
  if (!candidates.length) return null;

  // Prefer a rooted "Stand Work" idle (used by most non-ancient buildings),
  // otherwise the earliest matching "Stand" variant.
  const work = candidates.find(s => s.Name.toLowerCase().startsWith('stand work'));
  if (work) return work;
  return candidates.slice().sort((a, b) => a.Interval[0] - b.Interval[0])[0];
}

function pickRootedStandSequence (mdx) {
  return pickStandSequence(mdx, null);
}

// Alpha of one geoset during a sequence, evaluated the way the game does it
// (verified against HiveWE's calculate_sequence_extents / interpolate_keyframes,
// the compatibility implementation of the engine's own track windowing):
//
//   - only keys INSIDE the sequence interval count;
//   - keys present → the value at the sequence start is the first in-range key;
//   - NO keys inside the sequence → the track falls back to the GeosetAnim's
//     static alpha, which is 1 for these models.
//
// That last clause is the authoring convention the tier files rely on: a
// geoset hidden during a sequence carries an explicit 0-key at the sequence
// start, and the VISIBLE geosets of that sequence simply have no keys there
// (Farm body g1: keys at 0/60000/70000 and none inside Stand [61667,66667];
// Town Hall Keep body g15: no keys inside the two Upgrade First stands).
// Evaluating the track globally instead of per-sequence selects nothing at
// all for most stands — every geoset has an explicit 0 at some earlier frame.
function geosetVisibleInSequence (mdx, gi, seq) {
  const ga = (mdx.GeosetAnims || []).find(a => a.GeosetId === gi);
  if (!ga || ga.Alpha == null) return true;                 // no anim = visible
  if (typeof ga.Alpha === 'number') return ga.Alpha > 0.01; // static alpha
  const keys = ga.Alpha.Keys;
  if (!keys || !keys.length) return true;

  // A global-sequence alpha track loops on its own clock (pulsing effects,
  // texture flipbooks) independent of the animation — the geoset exists;
  // keep it if it is ever shown.
  if (ga.Alpha.GlobalSeqId != null) {
    return keys.some(k => k.Vector[0] > 0.01);
  }

  const [start, end] = [seq.Interval[0], seq.Interval[1]];
  const inRange = keys.filter(k => k.Frame >= start && k.Frame <= end);
  if (!inRange.length) return true;       // engine: static alpha fallback
  return inRange[0].Vector[0] > 0.01;     // engine: value at sequence start
}

// Which geosets are visible during the form's Stand sequence.
function getStandVisibleGeosets (mdx, formTag = null) {
  const seq = pickStandSequence(mdx, formTag);
  if (!seq) {
    if (!formTag) {
      console.log('  WARN: no rooted Stand sequence found — falling back to all structural geosets');
      return null;
    }
    return undefined;   // form does not exist in this MDX
  }

  const visible = new Set();
  for (let gi = 0; gi < mdx.Geosets.length; gi++) {
    if (geosetVisibleInSequence(mdx, gi, seq)) visible.add(gi);
  }
  return visible;
}

// mode: 'cliff' applies HiveWE's 90° CCW rotation + 1/128 scale.
//        'tree'  just converts Z-up (MDX) → Y-up (Three.js), no scale.
//        'building' same as tree but filters to Stand-visible geosets only.
function mdxToMeshData (mdxPath, mode) {
  const buf = fs.readFileSync(mdxPath);
  let ab = new Uint8Array(buf).buffer;
  // Strip LITE chunk — Reforged MDX has extended light fields war3-model can't parse
  ab = stripMDXChunks(ab, ['LITE']);
  const mdx = parseMDX(ab);

  if (!mdx.Geosets || mdx.Geosets.length === 0) {
    return null;
  }

  // For buildings, filter to only Stand-visible geosets
  let visibleSet = null;
  if (mode === 'building') {
    visibleSet = getStandVisibleGeosets(mdx);
  }

  // Select which geosets to include
  const geosets = [];
  for (let i = 0; i < mdx.Geosets.length; i++) {
    if (visibleSet && !visibleSet.has(i)) continue;
    // Skip tiny particle/effect planes (4 verts = single quad, usually a billboard)
    const nv = mdx.Geosets[i].Vertices.length / 3;
    if (mode === 'building' && nv <= 4) continue;
    geosets.push(mdx.Geosets[i]);
  }

  if (geosets.length === 0) {
    // Fallback: if no visible geosets found, include all structural ones (>4 verts)
    for (const g of mdx.Geosets) {
      if (g.Vertices.length / 3 > 4) geosets.push(g);
    }
  }

  if (geosets.length === 0) return null;

  // Merge selected geosets into a single mesh
  let totalVerts = 0, totalIndices = 0;
  for (const g of geosets) {
    totalVerts += g.Vertices.length / 3;
    totalIndices += g.Faces.length;
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const indices = totalVerts > 65535 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);

  let vOff = 0, iOff = 0, vBase = 0;
  for (const g of geosets) {
    const nv = g.Vertices.length / 3;

    for (let i = 0; i < nv; i++) {
      const sx = g.Vertices[i * 3 + 0];
      const sy = g.Vertices[i * 3 + 1];
      const sz = g.Vertices[i * 3 + 2];

      if (mode === 'cliff') {
        // HiveWE cliff vertex shader: rotate 90° CCW around Z then scale 1/128
        //   vec3(vPosition.y, -vPosition.x, vPosition.z) / 128.0
        positions[vOff * 3 + 0] = sy / 128;
        positions[vOff * 3 + 1] = -sx / 128;
        positions[vOff * 3 + 2] = sz / 128;
      } else {
        // Tree/doodad: MDX is Z-up, Three.js is Y-up.
        // Convert: (x, y, z) → (x, z, -y)
        positions[vOff * 3 + 0] = sx;
        positions[vOff * 3 + 1] = sz;
        positions[vOff * 3 + 2] = -sy;
      }

      const nx = g.Normals[i * 3 + 0];
      const ny = g.Normals[i * 3 + 1];
      const nz = g.Normals[i * 3 + 2];
      if (mode === 'cliff') {
        normals[vOff * 3 + 0] = ny;
        normals[vOff * 3 + 1] = -nx;
        normals[vOff * 3 + 2] = nz;
      } else {
        normals[vOff * 3 + 0] = nx;
        normals[vOff * 3 + 1] = nz;
        normals[vOff * 3 + 2] = -ny;
      }

      if (g.TVertices && g.TVertices[0]) {
        uvs[vOff * 2 + 0] = g.TVertices[0][i * 2 + 0];
        uvs[vOff * 2 + 1] = g.TVertices[0][i * 2 + 1];
      }
      vOff++;
    }

    for (let i = 0; i < g.Faces.length; i++) {
      indices[iOff++] = g.Faces[i] + vBase;
    }
    vBase += nv;
  }

  // Extract texture info for reference (not embedded in glTF since textures
  // are loaded separately based on cliff palette or tree type)
  const textures = (mdx.Textures || []).map(t => ({
    replaceableId: t.ReplaceableId,
    image: t.Image
  }));

  return { positions, normals, uvs, indices, textures };
}

// --- Convert functions ---

function convertFile (mdxPath, outPath, mode) {
  try {
    const mesh = mdxToMeshData(mdxPath, mode || 'tree');
    if (!mesh) {
      return false;
    }
    const glb = buildGLB(mesh);
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outPath, glb);
    return true;
  } catch (err) {
    console.log('  ERROR: ' + path.basename(mdxPath) + ' — ' + err.message.slice(0, 80));
    return false;
  }
}

function convertCliffs () {
  const cliffsDir = path.join(DOODADS_DIR, 'terrain', 'cliffs');
  const outDir = path.join(OUTPUT_DIR, 'cliffs');
  const files = fs.readdirSync(cliffsDir).filter(f => f.endsWith('.mdx'));

  console.log('Converting ' + files.length + ' cliff models...');
  let ok = 0, fail = 0;
  for (const f of files) {
    const outName = f.replace('.mdx', '.glb');
    if (convertFile(path.join(cliffsDir, f), path.join(outDir, outName), 'cliff')) {
      ok++;
    } else {
      fail++;
    }
  }
  console.log('Done: ' + ok + ' converted, ' + fail + ' skipped');
}

function parseINI (filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  const sections = {};
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      current = trimmed.slice(1, -1);
      sections[current] = sections[current] || {};
    } else if (current && trimmed.includes('=')) {
      const eq = trimmed.indexOf('=');
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      sections[current][key] = val;
    }
  }
  return sections;
}

function getTreeMappings () {
  // Merge DestructableData.slk + DestructableSkin.txt (same as HiveWE)
  const skinPath = path.join(__dirname, 'map-data', 'units', 'destructableskin.txt');
  const skin = parseINI(skinPath);

  const mappings = {};
  for (const [id, fields] of Object.entries(skin)) {
    if (!fields.file) continue;
    const filePath = fields.file.replace(/\\/g, '/').toLowerCase();
    const numVar = parseInt(fields.numVar || '1', 10);
    mappings[id] = { file: filePath, numVar };
  }

  // Also include non-destructible doodads (rocks, plants, props, structures)
  // from doodadskins.txt — same format, different source file
  const doodadSkinPath = path.join(DOODADS_DIR, 'doodadskins.txt');
  if (fs.existsSync(doodadSkinPath)) {
    const doodadSkin = parseINI(doodadSkinPath);
    for (const [id, fields] of Object.entries(doodadSkin)) {
      if (!fields.file || mappings[id]) continue; // don't override destructibles
      const filePath = fields.file.replace(/\\/g, '/').toLowerCase();
      const numVar = parseInt(fields.numVar || '1', 10);
      mappings[id] = { file: filePath, numVar };
    }
    console.log('  Added ' + Object.keys(doodadSkin).length + ' doodad types from doodadskins.txt');
  }

  return mappings;
}

function convertTrees () {
  const mappings = getTreeMappings();
  const outDir = path.join(OUTPUT_DIR, 'trees');

  let ok = 0, fail = 0, skip = 0;
  const ids = Object.keys(mappings);
  console.log('Found ' + ids.length + ' destructible/doodad types with file paths');

  for (const id of ids) {
    const { file, numVar } = mappings[id];
    const relPath = file.startsWith('doodads/') ? file.slice(8) : file;

    for (let v = 0; v < numVar; v++) {
      const mdxName = relPath + v + '.mdx';
      const mdxPath = path.join(DOODADS_DIR, mdxName);

      if (!fs.existsSync(mdxPath)) {
        if (v === 0) {
          const mdxPathNoVar = path.join(DOODADS_DIR, relPath + '.mdx');
          if (fs.existsSync(mdxPathNoVar)) {
            const outName = id.toLowerCase() + v + '.glb';
            if (convertFile(mdxPathNoVar, path.join(outDir, outName))) ok++;
            else fail++;
            continue;
          }
        }
        skip++;
        continue;
      }

      const outName = id.toLowerCase() + v + '.glb';
      if (convertFile(mdxPath, path.join(outDir, outName))) ok++;
      else fail++;
    }
  }
  console.log('Doodads: ' + ok + ' converted, ' + fail + ' failed, ' + skip + ' not found');
}

function listTrees () {
  const mappings = getTreeMappings();
  console.log('Destructible type → MDX file mappings (' + Object.keys(mappings).length + ' types):');
  for (const [id, { file, numVar }] of Object.entries(mappings).sort()) {
    const relPath = file.startsWith('doodads/') ? file.slice(8) : file;
    const mdxPath = path.join(DOODADS_DIR, relPath + '0.mdx');
    const exists = fs.existsSync(mdxPath);
    console.log('  ' + id + ': ' + file + ' (var=' + numVar + ')' + (exists ? '' : ' [MISSING]'));
  }
}

// --- Building functions ---

function getBuildingMappings () {
  const skinPath = path.join(__dirname, 'map-data', 'units', 'unitskin.txt');
  const skin = parseINI(skinPath);

  const mappings = {};
  for (const [id, fields] of Object.entries(skin)) {
    if (!fields.file) continue;
    const filePath = fields.file.replace(/\\/g, '/').toLowerCase();
    if (!filePath.startsWith('buildings/')) continue;
    mappings[id.toLowerCase()] = { file: filePath };
  }
  return mappings;
}

function findBuildingMDXFiles () {
  // Recursively find all .mdx files under BUILDINGS_DIR, skip portraits
  const results = [];
  function walk (dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name));
      } else if (entry.name.endsWith('.mdx') && !entry.name.includes('_portrait')) {
        results.push(path.join(dir, entry.name));
      }
    }
  }
  walk(BUILDINGS_DIR);
  return results;
}

// A layer's TextureID is usually a plain index, but it can also be an
// animation TRACK — the WC3 texture flipbook. Same defect class as the water
// elemental on the unit side: treating a track as "no texture" silently
// deleted the geoset. Resolve to the first key, the frame the model is
// authored to rest on.
function resolveLayerTextureId (layer) {
  const texId = layer.TextureID;
  if (typeof texId === 'number') return texId;
  const keys = texId && texId.Keys;
  if (!keys || !keys.length) return null;
  const v = keys[0].Vector;
  const first = Array.isArray(v) || ArrayBuffer.isView(v) ? v[0] : v;
  return (typeof first === 'number') ? first : null;
}

// Extract per-geoset building data with material/texture info for one FORM
// (base Stand, or an upgrade tier via formTag 'first'|'second'|'third').
// Returns null when the file yields nothing, undefined when the form does not
// exist in this MDX.
function mdxToBuildingGeosets (mdxPath, formTag = null) {
  const buf = fs.readFileSync(mdxPath);
  let ab = new Uint8Array(buf).buffer;
  ab = stripMDXChunks(ab, ['LITE']);
  const mdx = parseMDX(ab);
  if (!mdx.Geosets || !mdx.Geosets.length) return null;

  // Determine the form's Stand-visible geosets. `dropped` records every
  // deliberate deletion of form-visible geometry with its reason, so the
  // geometry audit can tell an intended drop from a silent one.
  const visibleSet = getStandVisibleGeosets(mdx, formTag);
  if (visibleSet === undefined) return undefined;
  const dropped = [];
  const selected = [];
  for (let i = 0; i < mdx.Geosets.length; i++) {
    if (visibleSet && !visibleSet.has(i)) continue;
    const nv = mdx.Geosets[i].Vertices.length / 3;
    if (nv <= 4) { dropped.push({ gi: i, nv, reason: 'particle-quad' }); continue; }
    selected.push(i);
  }
  if (selected.length === 0) {
    if (formTag) return undefined;   // upgrade sequence exists but shows nothing
    for (let i = 0; i < mdx.Geosets.length; i++) {
      if (mdx.Geosets[i].Vertices.length / 3 > 4) selected.push(i);
    }
  }
  if (selected.length === 0) return null;

  // Build per-geoset data with texture references
  const geosets = [];
  const exportedIndices = [];
  const textureRefs = []; // { blpPath, filterMode } indexed by textureIndex

  // Deduplicate textures
  const texMap = {}; // blpBaseName → textureIndex
  function getTextureIndex (blpPath, filterMode) {
    if (!blpPath) return -1;
    const base = path.basename(blpPath, path.extname(blpPath)).toLowerCase();
    if (texMap[base] !== undefined) return texMap[base];
    const idx = textureRefs.length;
    texMap[base] = idx;
    textureRefs.push({ blpPath, baseName: base, filterMode });
    return idx;
  }

  for (const gi of selected) {
    const g = mdx.Geosets[gi];
    const nv = g.Vertices.length / 3;

    // Find texture for this geoset via material chain.
    // WC3 materials have multiple layers composited together.
    // Layer[0] is often team color (replaceableId=1); the real diffuse
    // texture sits on layer[1]. Scan all layers to find the first real texture.
    const matId = g.MaterialID;
    let texIndex = -1;
    let filterMode = 0;
    let skipGeoset = false;
    if (matId !== undefined && mdx.Materials && mdx.Materials[matId]) {
      const mat = mdx.Materials[matId];
      for (const layer of mat.Layers) {
        const texId = resolveLayerTextureId(layer);
        if (texId == null || !mdx.Textures || !mdx.Textures[texId]) continue;
        const tex = mdx.Textures[texId];
        if (tex.ReplaceableId === 0 && tex.Image) {
          const imgLower = tex.Image.toLowerCase();
          // Skip ubersplats (ground decals), weather, and particle effect
          // textures. Base.blp / HumanBase.blp must NOT be here: they are the
          // buildings' FOUNDATION geometry — dropping them took 224u off the
          // Great Hall and left it shorter than a Farm.
          if (imgLower.includes('splats') || imgLower.includes('weather') ||
              imgLower.includes('clouds') || imgLower.includes('shockwave') ||
              imgLower.includes('deathsmug') || imgLower.includes('dust') ||
              imgLower.includes('star5') || imgLower.includes('star2_') ||
              imgLower.includes('glow')) {
            skipGeoset = true;
            break;
          }
          filterMode = layer.FilterMode || 0;
          texIndex = getTextureIndex(tex.Image, filterMode);
          break; // found a real texture, stop searching layers
        }
      }
    }
    if (skipGeoset) { dropped.push({ gi, nv, reason: 'fx-texture' }); continue; }

    // Convert geometry (Z-up → Y-up, same as tree mode)
    const positions = new Float32Array(nv * 3);
    const normals = new Float32Array(nv * 3);
    const uvs = new Float32Array(nv * 2);

    for (let i = 0; i < nv; i++) {
      const sx = g.Vertices[i * 3], sy = g.Vertices[i * 3 + 1], sz = g.Vertices[i * 3 + 2];
      positions[i * 3] = sx; positions[i * 3 + 1] = sz; positions[i * 3 + 2] = -sy;

      const nx = g.Normals[i * 3], ny = g.Normals[i * 3 + 1], nz = g.Normals[i * 3 + 2];
      normals[i * 3] = nx; normals[i * 3 + 1] = nz; normals[i * 3 + 2] = -ny;

      if (g.TVertices && g.TVertices[0]) {
        uvs[i * 2] = g.TVertices[0][i * 2];
        uvs[i * 2 + 1] = g.TVertices[0][i * 2 + 1];
      }
    }

    const indices = g.Faces.length > 65535
      ? new Uint32Array(g.Faces)
      : new Uint16Array(g.Faces);

    geosets.push({ positions, normals, uvs, indices, textureIndex: texIndex, filterMode });
    exportedIndices.push(gi);
  }

  // Which source geosets actually made it out — two forms with the same
  // signature are byte-equivalent and share one GLB.
  return { geosets, textureRefs, dropped, signature: exportedIndices.join(',') };
}

// Animprops from the race unitfunc files: the SLK's required-animation-names
// field, e.g. hkee → 'upgrade,first', hcas → 'upgrade,second'. This is the
// engine's own itemId → upgrade-form mapping — the reason a Keep plays the
// Town Hall MDX's 'Stand Upgrade First' geometry.
function getBuildingAnimProps () {
  const unitsDir = path.join(__dirname, 'map-data', 'units');
  const tags = {};
  for (const f of fs.readdirSync(unitsDir)) {
    if (!f.endsWith('unitfunc.txt')) continue;
    const ini = parseINI(path.join(unitsDir, f));
    for (const [id, fields] of Object.entries(ini)) {
      const props = fields.animprops || fields.Animprops;
      if (!props) continue;
      const parts = String(props).toLowerCase().split(',').map(s => s.trim());
      const at = parts.indexOf('upgrade');
      if (at !== -1 && ['first', 'second', 'third'].includes(parts[at + 1])) {
        tags[id.toLowerCase()] = parts[at + 1];
      }
    }
  }
  return tags;
}

function convertBuildings () {
  const mappings = getBuildingMappings();
  const mdxFiles = findBuildingMDXFiles();
  const ddsIndex = buildDdsIndex();

  if (!fs.existsSync(BUILDINGS_OUTPUT_DIR)) fs.mkdirSync(BUILDINGS_OUTPUT_DIR, { recursive: true });
  if (!fs.existsSync(BUILDING_TEX_OUTPUT_DIR)) fs.mkdirSync(BUILDING_TEX_OUTPUT_DIR, { recursive: true });

  const modelMap = {};
  for (const mdxPath of mdxFiles) {
    const folderName = path.basename(path.dirname(mdxPath)).toLowerCase();
    modelMap[folderName] = mdxPath;
  }

  console.log('Found ' + mdxFiles.length + ' building MDX files');
  console.log('Found ' + Object.keys(mappings).length + ' building type codes in unitskin.txt');
  console.log('DDS index: ' + Object.keys(ddsIndex).length + ' texture files');

  let ok = 0, fail = 0, texConverted = 0, tierGlbs = 0;
  const textureReport = {};
  // modelForms[folderName] = { base: name, first?: name, second?: name, third?: name }
  // A form identical to the base (same exported geoset signature) reuses the
  // base GLB — most buildings have no upgrade sequences at all.
  const modelForms = {};

  const FORM_DEFS = [
    { suffix: '', tag: null },
    { suffix: '_upgrade1', tag: 'first' },
    { suffix: '_upgrade2', tag: 'second' },
    { suffix: '_upgrade3', tag: 'third' }
  ];

  for (const [folderName, mdxPath] of Object.entries(modelMap)) {
    const forms = {};
    let baseSignature = null;

    for (const form of FORM_DEFS) {
      const modelName = folderName + form.suffix;
      try {
        const result = mdxToBuildingGeosets(mdxPath, form.tag);
        if (result === undefined) continue;   // this MDX has no such form
        if (!result || !result.geosets.length) {
          if (!form.tag) { console.log('  SKIP (no geosets): ' + folderName); fail++; }
          continue;
        }
        if (!form.tag) {
          baseSignature = result.signature;
        } else if (result.signature === baseSignature) {
          forms[form.tag] = folderName;       // same geometry — share the base GLB
          continue;
        }

        // Convert referenced DDS textures to PNG and embed in GLB
        const pngBuffers = [];
        for (const texRef of result.textureRefs) {
          const ddsPath = ddsIndex[texRef.baseName];
          if (ddsPath) {
            try {
              pngBuffers.push(ddsToPngBuffer(ddsPath));
              texConverted++;
            } catch (e) {
              pngBuffers.push(null);
            }
          } else {
            pngBuffers.push(null);
          }
        }

        textureReport[modelName] = result.textureRefs.map(t => ({
          image: t.blpPath, baseName: t.baseName,
          found: !!ddsIndex[t.baseName]
        }));

        const glb = buildBuildingGLB(result.geosets, pngBuffers);
        fs.writeFileSync(path.join(BUILDINGS_OUTPUT_DIR, modelName + '.glb'), glb);
        if (form.tag) { forms[form.tag] = modelName; tierGlbs++; }
        else { forms.base = folderName; ok++; }
      } catch (err) {
        console.log('  ERROR: ' + modelName + ' — ' + err.message.slice(0, 120));
        if (!form.tag) fail++;
      }
    }
    modelForms[folderName] = forms;
  }
  console.log('Buildings: ' + ok + ' converted, ' + fail + ' skipped, ' +
    tierGlbs + ' upgrade-tier GLBs, ' + texConverted + ' textures embedded');

  // Build the type-code → { model, scale } manifest.
  //
  // `scale` is written as 1 here and filled in by tools/patch-model-scale.js from
  // helpers/modelScale.json, exactly like the unit manifest. Buildings used to be
  // a bare type-code → name string with no scale at all, which was accidentally
  // right for 169 of 197 types and wrong for the rest — most visibly the Tree of
  // Life / Ages / Eternity, which share one MDX and differ ONLY by modelScale
  // (1.0 / 1.15 / 1.3), so all three rendered identically.
  // Tier resolution: the SLK Animprops tag (hkee → 'upgrade,first') picks the
  // upgrade-form GLB exported from the shared MDX. Before this, hkee/hcas
  // rendered byte-identical to htow, ostr/ofrt to ogre, and all four human
  // towers shared one model, while the real tier geometry sat unexported in
  // the same file's 'Stand Upgrade First/Second' sequences.
  const animProps = getBuildingAnimProps();
  const manifest = {};
  let tierMapped = 0;
  for (const [typeCode, { file }] of Object.entries(mappings)) {
    // file = 'buildings/other/goldmine/goldmine'
    // Extract the folder name (second-to-last path segment)
    const parts = file.split('/');
    const modelName = parts.length >= 3 ? parts[parts.length - 2] : parts[parts.length - 1];
    if (!modelMap[modelName]) continue;
    const forms = modelForms[modelName] || {};
    const tag = animProps[typeCode];
    let model = modelName;
    if (tag && forms[tag]) {
      model = forms[tag];
      if (model !== modelName) tierMapped++;
    }
    manifest[typeCode] = { model, scale: 1 };
  }
  console.log('Tier mapping: ' + tierMapped + ' type codes use an upgrade-form GLB');

  const manifestPath = path.join(BUILDINGS_OUTPUT_DIR, 'building-models.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('Manifest: ' + Object.keys(manifest).length + ' type codes → ' +
    new Set(Object.values(manifest).map(v => v.model)).size + ' unique models');
  console.log('  scale=1 placeholder — run: node tools/patch-model-scale.js');
  console.log('Wrote: ' + manifestPath);

  // Write texture report for the texture conversion step
  const texReportPath = path.join(BUILDINGS_OUTPUT_DIR, 'building-texture-report.json');
  fs.writeFileSync(texReportPath, JSON.stringify(textureReport, null, 2));
  console.log('Texture report: ' + texReportPath);
}

function listBuildings () {
  const mappings = getBuildingMappings();
  const mdxFiles = findBuildingMDXFiles();
  const modelMap = {};
  for (const mdxPath of mdxFiles) {
    const folderName = path.basename(path.dirname(mdxPath)).toLowerCase();
    modelMap[folderName] = true;
  }

  console.log('Building type→file mappings (' + Object.keys(mappings).length + ' types):');
  for (const [id, { file }] of Object.entries(mappings).sort()) {
    const parts = file.split('/');
    const modelName = parts.length >= 3 ? parts[parts.length - 2] : parts[parts.length - 1];
    const exists = !!modelMap[modelName];
    console.log('  ' + id + ': ' + file + (exists ? '' : ' [MISSING MDX]'));
  }
}

// Reused by tools/audit-model-geometry.js --buildings (grades MDX-visible
// verts against the exported GLBs) and any form-selection debugging.
module.exports = {
  pickStandSequence,
  geosetVisibleInSequence,
  getStandVisibleGeosets,
  getBuildingAnimProps,
  getBuildingMappings,
  findBuildingMDXFiles,
  mdxToBuildingGeosets,
  resolveLayerTextureId,
  stripMDXChunks,
  BUILDINGS_DIR,
  BUILDINGS_OUTPUT_DIR
};

// --- Main ---
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--cliffs')) {
    convertCliffs();
  } else if (args.includes('--trees')) {
    convertTrees();
  } else if (args.includes('--buildings')) {
    convertBuildings();
  } else if (args.includes('--list-trees')) {
    listTrees();
  } else if (args.includes('--list-buildings')) {
    listBuildings();
  } else if (args.some(a => a.startsWith('--file='))) {
    const filePath = args.find(a => a.startsWith('--file=')).split('=')[1];
    const outPath = filePath.replace('.mdx', '.glb');
    convertFile(filePath, outPath);
    console.log('Wrote: ' + outPath);
  } else {
    console.log('Convert all (cliffs + trees + buildings)...');
    convertCliffs();
    convertTrees();
    convertBuildings();
  }
}
