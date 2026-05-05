/**
 * Convert WC3 doodad DDS textures to PNG and generate a texture manifest
 * for the 3D renderer.
 *
 * Usage:
 *   node tools/convert-doodad-textures.js           # convert all + generate manifest
 *   node tools/convert-doodad-textures.js --list     # list what would be converted
 *
 * Input:  tools/map-data/replaceabletextures/ (tree textures from CASC)
 *         tools/map-data/textures/            (doodad textures from CASC)
 * Output: client/assets/textures/trees/*.png
 *         client/assets/textures/doodads/*.png
 *         client/assets/textures/doodad-textures.json
 */
const fs = require('fs');
const path = require('path');
const { createCanvas, ImageData } = require('canvas');
const { parseMDX } = require('war3-model');

const MAPDATA_DIR = path.join(__dirname, 'map-data');
const REPLACEABLE_DIR = path.join(MAPDATA_DIR, 'replaceabletextures');
const TEXTURES_DIR = path.join(MAPDATA_DIR, 'textures');
const DOODADS_DIR = path.join(MAPDATA_DIR, 'doodads');
const OUTPUT_BASE = path.join(__dirname, '..', 'client', 'assets', 'textures');

// Strip problematic chunks from MDX binary that war3-model can't parse
function stripMDXChunks (buffer, chunkNames) {
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  if (view.getUint32(0, true) !== 0x584C444D) return buffer;
  const pieces = [buffer.slice(0, 4)];
  let pos = 4;
  while (pos + 8 <= buffer.byteLength) {
    const keyword = String.fromCharCode(u8[pos], u8[pos + 1], u8[pos + 2], u8[pos + 3]);
    const chunkSize = view.getUint32(pos + 4, true);
    const chunkEnd = pos + 8 + chunkSize;
    if (chunkEnd > buffer.byteLength) break;
    if (!chunkNames.includes(keyword)) pieces.push(buffer.slice(pos, chunkEnd));
    pos = chunkEnd;
  }
  const totalLen = pieces.reduce((s, p) => s + p.byteLength, 0);
  const result = new ArrayBuffer(totalLen);
  const dst = new Uint8Array(result);
  let off = 0;
  for (const p of pieces) { dst.set(new Uint8Array(p), off); off += p.byteLength; }
  return result;
}

// ---------------------------------------------------------------------------
// DDS / DXT decoder (from convert-terrain-dds.js)
// ---------------------------------------------------------------------------

function readDdsHeader (buf) {
  if (buf.length < 128) throw new Error('file too small to be DDS');
  const magic = buf.toString('ascii', 0, 4);
  if (magic !== 'DDS ') throw new Error('bad DDS magic: ' + magic);
  return {
    width: buf.readUInt32LE(16),
    height: buf.readUInt32LE(12),
    fourcc: buf.toString('ascii', 84, 88),
    rgbBitCount: buf.readUInt32LE(88)
  };
}

function rgb565to888 (c) {
  const r = (c >> 11) & 0x1F;
  const g = (c >>  5) & 0x3F;
  const b =  c        & 0x1F;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

function decodeDxt1Block (data, offset, out, width, height, px0, py0, dxt3or5) {
  const c0 = data.readUInt16LE(offset);
  const c1 = data.readUInt16LE(offset + 2);
  const indices = data.readUInt32LE(offset + 4);
  const col0 = rgb565to888(c0);
  const col1 = rgb565to888(c1);
  let col2, col3, alpha3 = 255;
  if (c0 > c1 || dxt3or5) {
    col2 = [Math.round((2*col0[0]+col1[0])/3), Math.round((2*col0[1]+col1[1])/3), Math.round((2*col0[2]+col1[2])/3)];
    col3 = [Math.round((col0[0]+2*col1[0])/3), Math.round((col0[1]+2*col1[1])/3), Math.round((col0[2]+2*col1[2])/3)];
  } else {
    col2 = [Math.round((col0[0]+col1[0])/2), Math.round((col0[1]+col1[1])/2), Math.round((col0[2]+col1[2])/2)];
    col3 = [0, 0, 0]; alpha3 = 0;
  }
  const palette = [col0, col1, col2, col3];
  for (let py = 0; py < 4; py++) {
    const yy = py0 + py;
    if (yy >= height) continue;
    for (let px = 0; px < 4; px++) {
      const xx = px0 + px;
      if (xx >= width) continue;
      const idx = (indices >>> ((py * 4 + px) * 2)) & 0x3;
      const c = palette[idx];
      const dst = (yy * width + xx) * 4;
      out[dst] = c[0]; out[dst+1] = c[1]; out[dst+2] = c[2];
      if (!dxt3or5) out[dst+3] = (idx === 3) ? alpha3 : 255;
    }
  }
}

function decodeDxt5AlphaBlock (data, offset, out, width, height, px0, py0) {
  const a0 = data[offset], a1 = data[offset + 1];
  const pal = new Array(8);
  pal[0] = a0; pal[1] = a1;
  if (a0 > a1) {
    for (let i = 1; i < 7; i++) pal[i+1] = Math.round(((7-i)*a0 + i*a1) / 7);
  } else {
    for (let i = 1; i < 5; i++) pal[i+1] = Math.round(((5-i)*a0 + i*a1) / 5);
    pal[6] = 0; pal[7] = 255;
  }
  const lo = data[offset+2] | (data[offset+3]<<8) | (data[offset+4]<<16);
  const hi = data[offset+5] | (data[offset+6]<<8) | (data[offset+7]<<16);
  for (let i = 0; i < 16; i++) {
    const py = i >> 2, px = i & 3;
    const yy = py0 + py, xx = px0 + px;
    if (yy >= height || xx >= width) continue;
    const idx = i < 8 ? (lo >> (i*3)) & 7 : (hi >> ((i-8)*3)) & 7;
    out[(yy * width + xx) * 4 + 3] = pal[idx];
  }
}

function decodeDds (buf) {
  const hdr = readDdsHeader(buf);
  const { width, height, fourcc } = hdr;
  const out = new Uint8ClampedArray(width * height * 4);
  const data = buf.slice(128);

  if (fourcc === 'DXT1') {
    let off = 0;
    for (let by = 0; by < height; by += 4)
      for (let bx = 0; bx < width; bx += 4) {
        decodeDxt1Block(data, off, out, width, height, bx, by, false); off += 8;
      }
    return { width, height, rgba: out };
  }
  if (fourcc === 'DXT5') {
    let off = 0;
    for (let by = 0; by < height; by += 4)
      for (let bx = 0; bx < width; bx += 4) {
        decodeDxt5AlphaBlock(data, off, out, width, height, bx, by);
        decodeDxt1Block(data, off + 8, out, width, height, bx, by, true);
        off += 16;
      }
    return { width, height, rgba: out };
  }
  if (fourcc === 'DXT3') {
    let off = 0;
    for (let by = 0; by < height; by += 4)
      for (let bx = 0; bx < width; bx += 4) {
        // DXT3 alpha: 8 bytes of 4-bit values
        for (let py = 0; py < 4; py++) {
          const yy = by + py; if (yy >= height) continue;
          const rowBytes = data.readUInt16LE(off + py * 2);
          for (let px = 0; px < 4; px++) {
            const xx = bx + px; if (xx >= width) continue;
            const a4 = (rowBytes >> (px * 4)) & 0xF;
            out[(yy * width + xx) * 4 + 3] = (a4 << 4) | a4;
          }
        }
        decodeDxt1Block(data, off + 8, out, width, height, bx, by, true);
        off += 16;
      }
    return { width, height, rgba: out };
  }
  // Uncompressed 32-bit BGRA
  if (hdr.rgbBitCount === 32) {
    for (let i = 0; i < width * height; i++) {
      const px = data.readUInt32LE(i * 4);
      out[i*4]   = (px >> 16) & 0xFF;
      out[i*4+1] = (px >>  8) & 0xFF;
      out[i*4+2] =  px        & 0xFF;
      out[i*4+3] = (px >> 24) & 0xFF;
    }
    return { width, height, rgba: out };
  }
  throw new Error('unsupported DDS format: ' + fourcc);
}

function ddsToPng (ddsPath, pngPath) {
  const buf = fs.readFileSync(ddsPath);
  const { width, height, rgba } = decodeDds(buf);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  const dir = path.dirname(pngPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(pngPath, canvas.toBuffer('image/png'));
  return { width, height };
}

// ---------------------------------------------------------------------------
// Replaceable texture ID → tileset → DDS file mapping
// ---------------------------------------------------------------------------

// ReplaceableId → { tileset: ddsFilename } within replaceabletextures/
const REPLACEABLE_TREE_MAP = {
  31: {
    default: 'lordaerontree/lordaeronsummertree.dds',
    L: 'lordaerontree/lordaeronsummertree.dds',
    V: 'lordaerontree/lordaeronsummertree.dds',
    F: 'lordaerontree/lordaeronfalltree.dds',
    X: 'lordaerontree/lordaeronfalltree.dds',
    W: 'lordaerontree/lordaeronwintertree.dds',
    N: 'lordaerontree/lordaeronsnowtree.dds',
    I: 'lordaerontree/lordaeronsnowtree.dds',
    K: 'lordaerontree/lordaeronsummertree.dds',
    Q: 'lordaerontree/lordaeronfalltree.dds',
    J: 'lordaerontree/lordaeronfalltree.dds'
  },
  32: {
    default: 'ashenvaletree/ashentree.dds',
    A: 'ashenvaletree/ashentree.dds',
    C: 'ashenvaletree/felwoodtree.dds',
    I: 'ashenvaletree/ice_tree.dds'
  },
  33: {
    default: 'barrenstree/barrenstree.dds',
    B: 'barrenstree/barrenstree.dds'
  },
  34: {
    default: 'northrendtree/northtree.dds',
    N: 'northrendtree/northtree.dds',
    W: 'northrendtree/northtree.dds'
  },
  35: {
    default: 'mushroom/mushroomtree.dds',
    C: 'mushroom/mushroomtree.dds',
    G: 'undergroundtree/undermushroomtree.dds',
    D: 'undergroundtree/undermushroomtree.dds'
  },
  36: {
    default: 'ruinstree/ruinstree.dds',
    Z: 'ruinstree/ruinstree.dds',
    Y: 'ruinstree/ruinstree.dds'
  },
  37: {
    default: 'outlandmushroomtree/mushroomtree.dds',
    O: 'outlandmushroomtree/mushroomtree.dds'
  }
};

// ---------------------------------------------------------------------------
// Scan MDX files to build model type → texture mapping
// ---------------------------------------------------------------------------

function scanMdxTextures () {
  const modelTextures = {};
  const skinPath = path.join(MAPDATA_DIR, 'units', 'destructableskin.txt');

  // Parse destructableskin.txt for type → MDX path mapping
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
        sections[current][trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
      }
    }
    return sections;
  }

  if (!fs.existsSync(skinPath)) {
    console.warn('destructableskin.txt not found, scanning MDX files directly');
  }

  // Scan all MDX files in doodads/ for texture references
  function scanDir (dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { scanDir(full); continue; }
      if (!entry.name.endsWith('.mdx') || entry.name.endsWith('d.mdx') || entry.name.endsWith('s.mdx')) continue;
      try {
        const buf = fs.readFileSync(full);
        let ab = new Uint8Array(buf).buffer;
        // Strip LITE chunk — Reforged MDX files have extended light data war3-model can't parse
        ab = stripMDXChunks(ab, ['LITE']);
        const mdx = parseMDX(ab);
        if (!mdx.Textures || !mdx.Textures.length) return;
        const tex = mdx.Textures[0];
        const filterMode = (mdx.Materials && mdx.Materials[0] && mdx.Materials[0].Layers)
          ? mdx.Materials[0].Layers[0].FilterMode : 0;

        // Extract the model type code from the filename
        // E.g. "lordaerontree0.mdx" → look up the 4-char doodad code from skin.txt
        // For now, store by relative path for cross-referencing
        const relPath = path.relative(DOODADS_DIR, full).replace(/\\/g, '/').toLowerCase();
        const info = {
          replaceableId: tex.ReplaceableId || 0,
          image: (tex.Image || '').replace(/\\/g, '/'),
          filterMode
        };
        modelTextures[relPath] = info;
      } catch (e) { /* skip */ }
    }
  }

  scanDir(DOODADS_DIR);

  // Build doodad type code → texture info from BOTH skin files:
  // - destructableskin.txt (trees, destructible objects)
  // - doodadskins.txt (rocks, plants, props, structures, etc.)
  const typeTextures = {};

  function addFromSkinFile (skinFilePath) {
    if (!fs.existsSync(skinFilePath)) return 0;
    const skin = parseINI(skinFilePath);
    let added = 0;
    for (const [id, fields] of Object.entries(skin)) {
      if (!fields.file) continue;
      const filePath = fields.file.replace(/\\/g, '/').toLowerCase();
      const relPath = filePath.startsWith('doodads/') ? filePath.slice(8) : filePath;
      // Find a matching MDX scan result — try with variation 0, then without
      const info = modelTextures[relPath + '0.mdx'] || modelTextures[relPath + '.mdx'];
      if (info && !typeTextures[id.toLowerCase()]) {
        typeTextures[id.toLowerCase()] = info;
        added++;
      }
    }
    return added;
  }

  const destructibleCount = addFromSkinFile(skinPath);
  const doodadSkinPath = path.join(DOODADS_DIR, 'doodadskins.txt');
  const doodadCount = addFromSkinFile(doodadSkinPath);
  console.log('  Type textures: ' + destructibleCount + ' from destructableskin.txt, ' + doodadCount + ' from doodadskins.txt');

  return { modelTextures, typeTextures };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function run () {
  const args = process.argv.slice(2);
  const listOnly = args.includes('--list');

  // Step 1: Convert tree textures (replaceable)
  console.log('=== Tree Textures (Replaceable) ===');
  const treeOutputDir = path.join(OUTPUT_BASE, 'trees');
  const convertedTrees = {}; // ddsRelPath → pngRelPath

  for (const [id, tilesets] of Object.entries(REPLACEABLE_TREE_MAP)) {
    const seen = new Set();
    for (const [tileset, ddsFile] of Object.entries(tilesets)) {
      if (seen.has(ddsFile)) continue;
      seen.add(ddsFile);
      const ddsPath = path.join(REPLACEABLE_DIR, ddsFile);
      const pngName = path.basename(ddsFile, '.dds') + '.png';
      const pngPath = path.join(treeOutputDir, pngName);
      const pngRel = 'trees/' + pngName;

      if (!fs.existsSync(ddsPath)) {
        console.log('  SKIP (not found): ' + ddsFile);
        continue;
      }
      convertedTrees[ddsFile] = pngRel;
      if (listOnly) {
        console.log('  ' + ddsFile + ' → ' + pngRel);
      } else {
        try {
          const { width, height } = ddsToPng(ddsPath, pngPath);
          console.log('  ' + ddsFile + ' → ' + pngRel + ' (' + width + 'x' + height + ')');
        } catch (e) {
          console.log('  ERROR: ' + ddsFile + ' — ' + e.message);
        }
      }
    }
  }

  // Step 2: Convert direct doodad textures
  console.log('\n=== Doodad Textures (Direct) ===');
  const doodadOutputDir = path.join(OUTPUT_BASE, 'doodads');
  const convertedDoodads = {}; // normalized blp path → pngRelPath

  // Collect which texture files are actually referenced by MDX models
  const { typeTextures } = scanMdxTextures();
  const referencedDirectTextures = new Set();
  for (const info of Object.values(typeTextures)) {
    if (info.replaceableId === 0 && info.image) {
      referencedDirectTextures.add(info.image.toLowerCase());
    }
  }

  // Convert referenced textures from MDX scan
  for (const texPath of referencedDirectTextures) {
    const baseName = path.basename(texPath, path.extname(texPath)).toLowerCase();
    const ddsPath = path.join(TEXTURES_DIR, baseName + '.dds');
    if (!fs.existsSync(ddsPath)) continue;

    const pngName = baseName + '.png';
    const pngPath = path.join(doodadOutputDir, pngName);
    const pngRel = 'doodads/' + pngName;

    convertedDoodads[texPath] = pngRel;
    if (listOnly) {
      console.log('  ' + baseName + '.dds → ' + pngRel);
    } else {
      try {
        const { width, height } = ddsToPng(ddsPath, pngPath);
        console.log('  ' + baseName + '.dds → ' + pngRel + ' (' + width + 'x' + height + ')');
      } catch (e) {
        console.log('  ERROR: ' + baseName + '.dds — ' + e.message);
      }
    }
  }

  // Also convert commonly-needed doodad textures (rocks, plants, structures)
  // that may not be in the destructible skin scan
  const EXTRA_TEXTURES = [
    'lordsnatural', 'lordsrockwall', 'ashennatural', 'ashenrocks',
    'ashenvalenatural', 'ashenstructures', 'barrensnatural', 'barrensnatural02',
    'barrensnatural03', 'barrensdoodads', 'barrensdoodads2',
    'felwoodnatural', 'felwoodrocks', 'felwoodstructures',
    'northrendnatural02', 'northrendnatural03', 'northrendstructures',
    'dungeonnatural', 'dungeonrocks', 'undergroundnatural', 'undergroundrocks',
    'doodads0', 'ruinsdoodads0', 'ruinsdoodads1', 'ruinsnatural', 'ruinsvines',
    'ruinswalls', 'ruins_plantlife', 'ruins_rock', 'ruins_rubble',
    'icecrowndoodads0', 'icecrowndoodads1', 'icecrownwalls',
    'outlanddoodads', 'villagedoodad0', 'villagedoodad1',
    'citynatural', 'citystructures', 'dalaranbuildings'
  ];
  for (const baseName of EXTRA_TEXTURES) {
    const ddsPath = path.join(TEXTURES_DIR, baseName + '.dds');
    if (!fs.existsSync(ddsPath)) continue;
    const pngName = baseName + '.png';
    const pngPath = path.join(doodadOutputDir, pngName);
    const pngRel = 'doodads/' + pngName;
    if (convertedDoodads['textures/' + baseName + '.blp']) continue; // already done
    convertedDoodads['textures/' + baseName + '.blp'] = pngRel;
    if (listOnly) {
      console.log('  [extra] ' + baseName + '.dds → ' + pngRel);
    } else {
      try {
        const { width, height } = ddsToPng(ddsPath, pngPath);
        console.log('  [extra] ' + baseName + '.dds → ' + pngRel + ' (' + width + 'x' + height + ')');
      } catch (e) {
        console.log('  ERROR: ' + baseName + '.dds — ' + e.message);
      }
    }
  }

  // Step 3: Generate manifest
  console.log('\n=== Generating Manifest ===');

  // Build replaceable texture mapping: id → tileset → png path
  const replaceable = {};
  for (const [id, tilesets] of Object.entries(REPLACEABLE_TREE_MAP)) {
    replaceable[id] = {};
    for (const [tileset, ddsFile] of Object.entries(tilesets)) {
      if (convertedTrees[ddsFile]) {
        replaceable[id][tileset] = convertedTrees[ddsFile];
      }
    }
  }

  // Build direct texture mapping: blp path → png path
  const direct = {};
  for (const [texPath, pngRel] of Object.entries(convertedDoodads)) {
    direct[texPath] = pngRel;
  }

  // Build model type → texture info
  const modelTextureMap = {};
  for (const [typeCode, info] of Object.entries(typeTextures)) {
    modelTextureMap[typeCode] = {
      replaceableId: info.replaceableId,
      image: info.image || null,
      filterMode: info.filterMode
    };
  }

  const manifest = { replaceable, direct, modelTextures: modelTextureMap };
  const manifestPath = path.join(OUTPUT_BASE, 'doodad-textures.json');

  if (!listOnly) {
    if (!fs.existsSync(OUTPUT_BASE)) fs.mkdirSync(OUTPUT_BASE, { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log('  Wrote ' + manifestPath);
    console.log('  ' + Object.keys(replaceable).length + ' replaceable IDs');
    console.log('  ' + Object.keys(direct).length + ' direct textures');
    console.log('  ' + Object.keys(modelTextureMap).length + ' model type mappings');
  } else {
    console.log('  Would write manifest with:');
    console.log('    ' + Object.keys(replaceable).length + ' replaceable IDs');
    console.log('    ' + Object.keys(direct).length + ' direct textures');
    console.log('    ' + Object.keys(modelTextureMap).length + ' model type mappings');
  }
}

run();
