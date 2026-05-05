/**
 * Convert WC3 building DDS textures to PNG and generate a texture manifest.
 *
 * Usage:
 *   node tools/convert-building-textures.js           # convert all + generate manifest
 *   node tools/convert-building-textures.js --list     # list what would be converted
 *
 * Input:  tools/map-data/buildings/ (co-located DDS textures from CASC)
 *         tools/map-data/textures/  (shared textures from CASC)
 *         client/assets/models/buildings/building-texture-report.json
 * Output: client/assets/textures/buildings/*.png
 *         client/assets/textures/building-textures.json
 */
const fs = require('fs');
const path = require('path');
const { createCanvas, ImageData } = require('canvas');

const BUILDINGS_DIR = path.join(__dirname, 'map-data', 'buildings');
const TEXTURES_DIR = path.join(__dirname, 'map-data', 'textures');
const OUTPUT_DIR = path.join(__dirname, '..', 'client', 'assets', 'textures', 'buildings');
const REPORT_PATH = path.join(__dirname, '..', 'client', 'assets', 'models', 'buildings', 'building-texture-report.json');

// ---------------------------------------------------------------------------
// DDS / DXT decoder (same as convert-doodad-textures.js)
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
// Build DDS lookup index
// ---------------------------------------------------------------------------

function buildDdsIndex () {
  const index = {}; // lowercase basename (no ext) → full path

  function walk (dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name));
      } else if (entry.name.toLowerCase().endsWith('.dds')) {
        const baseName = entry.name.slice(0, -4).toLowerCase();
        // Prefer co-located building textures over shared textures
        if (!index[baseName] || dir.includes('buildings')) {
          index[baseName] = path.join(dir, entry.name);
        }
      }
    }
  }

  // Index co-located building textures first, then shared textures
  walk(BUILDINGS_DIR);
  walk(TEXTURES_DIR);
  return index;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function run () {
  const args = process.argv.slice(2);
  const listOnly = args.includes('--list');

  if (!fs.existsSync(REPORT_PATH)) {
    console.error('Building texture report not found. Run convert-mdx-to-gltf.js --buildings first.');
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf-8'));
  const ddsIndex = buildDdsIndex();

  console.log('DDS index: ' + Object.keys(ddsIndex).length + ' files');
  console.log('Building models: ' + Object.keys(report).length);

  if (!listOnly && !fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // For each building model, find its primary texture (first with replaceableId=0 and image)
  // and convert the DDS to PNG
  const manifest = {}; // modelName → png filename (without extension)
  let ok = 0, missing = 0;

  for (const [modelName, textures] of Object.entries(report)) {
    // Find the primary diffuse texture — skip team-color (replaceableId=1),
    // particle effects, and weather textures
    const primary = textures.find(t => {
      if (t.replaceableId !== 0) return false;
      if (!t.image) return false;
      const img = t.image.toLowerCase();
      // Skip effect/particle textures that aren't useful as primary diffuse
      if (img.includes('weather/') || img.includes('replaceabletextures/')) return false;
      return true;
    });

    if (!primary) {
      // No primary texture — model uses only team color or particles
      continue;
    }

    // Extract basename from BLP path: "Buildings\Human\TownHall\TownHallCastleKeep.blp" → "townhallcastlekeep"
    const blpBaseName = path.basename(primary.image, path.extname(primary.image)).toLowerCase();

    // Look up in DDS index
    const ddsPath = ddsIndex[blpBaseName];
    if (!ddsPath) {
      if (listOnly) console.log('  MISSING: ' + modelName + ' → ' + blpBaseName + '.dds');
      missing++;
      continue;
    }

    const pngName = modelName + '.png';
    const pngPath = path.join(OUTPUT_DIR, pngName);

    if (listOnly) {
      console.log('  ' + modelName + ' → ' + blpBaseName + '.dds → ' + pngName);
    } else {
      try {
        const { width, height } = ddsToPng(ddsPath, pngPath);
        console.log('  ' + modelName + ' → ' + pngName + ' (' + width + 'x' + height + ')');
      } catch (e) {
        console.log('  ERROR: ' + modelName + ' — ' + e.message);
        missing++;
        continue;
      }
    }

    manifest[modelName] = modelName; // pngName without .png extension
    ok++;
  }

  // Write manifest
  const manifestPath = path.join(OUTPUT_DIR, 'building-textures.json');
  if (!listOnly) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log('\nManifest: ' + manifestPath);
  }
  console.log('Converted: ' + ok + ', missing DDS: ' + missing);
}

run();
