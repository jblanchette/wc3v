/*
  Convert WC3 terrain .dds files to PNGs for the 3D terrain renderer.

  Reads the authoritative tileID → filename mapping from
    tools/map-data/terrainart/terrain.slk
  and writes one PNG per ground-tile palette code into
    client/assets/terrain/{TilesetChar}/{TileID}.png

  Usage:
    node tools/convert-terrain-dds.js                 # all tilesets
    node tools/convert-terrain-dds.js --tileset=L     # one tileset only
    node tools/convert-terrain-dds.js --list          # print SLK mapping, no write

  Pure JS DXT1/DXT3/DXT5 decoder, no extra dependencies beyond node-canvas
  (already in package.json).
*/

const fs = require('fs');
const path = require('path');
const { createCanvas, ImageData } = require('canvas');

const MAPDATA_DIR = path.join(__dirname, 'map-data');
const TERRAINART_DIR = path.join(MAPDATA_DIR, 'terrainart');
const SLK_PATH = path.join(TERRAINART_DIR, 'terrain.slk');
const CLIFF_SLK_PATH = path.join(TERRAINART_DIR, 'clifftypes.slk');
const OUTPUT_DIR = path.join(__dirname, '..', 'client', 'assets', 'terrain');

// ---------------------------------------------------------------------------
// SLK parser
// ---------------------------------------------------------------------------
// SYLK format. Cells are records like:
//   C;X1;Y6;K"Lgrs"
//   C;X4;K"Lords_Grass"
// Y appears on the first cell of a row; subsequent cells inherit the current
// row index. Likewise X is per-cell. K is the value (string with quotes or
// number).

function parseSlk (text) {
  const lines = text.split(/\r?\n/);
  const rowsByIdx = new Map();
  let curRow = 0;

  for (const line of lines) {
    if (!line.startsWith('C;')) continue;
    const parts = line.split(';');
    let x = null, y = null, k = null;
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      if (p[0] === 'X') x = parseInt(p.slice(1), 10);
      else if (p[0] === 'Y') y = parseInt(p.slice(1), 10);
      else if (p[0] === 'K') {
        let v = p.slice(1);
        if (v[0] === '"') v = v.slice(1, v.endsWith('"') ? -1 : v.length);
        k = v;
      }
    }
    if (y != null) curRow = y;
    if (x == null || k == null) continue;
    if (!rowsByIdx.has(curRow)) rowsByIdx.set(curRow, {});
    rowsByIdx.get(curRow)[x] = k;
  }
  // Return rows as an array sorted by row index.
  return [...rowsByIdx.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([idx, cols]) => ({ row: idx, ...cols }));
}

// ---------------------------------------------------------------------------
// DDS / DXT decoder
// ---------------------------------------------------------------------------
// DDS header is 128 bytes:
//   bytes 0..3   = magic "DDS "
//   bytes 4..7   = header size (124)
//   bytes 12..15 = height
//   bytes 16..19 = width
//   bytes 76..79 = pixel format size (32)
//   bytes 80..83 = pixel format flags (DDPF_FOURCC = 0x4)
//   bytes 84..87 = FourCC ("DXT1", "DXT3", "DXT5", or 0 for uncompressed)
// We support DXT1, DXT3, DXT5, and uncompressed BGRA (RGB bitmask flags).

function readDdsHeader (buf) {
  if (buf.length < 128) throw new Error('file too small to be DDS');
  const magic = buf.toString('ascii', 0, 4);
  if (magic !== 'DDS ') throw new Error('bad DDS magic: ' + magic);
  const height = buf.readUInt32LE(12);
  const width = buf.readUInt32LE(16);
  const pfFlags = buf.readUInt32LE(80);
  const fourcc = buf.toString('ascii', 84, 88);
  const rgbBitCount = buf.readUInt32LE(88);
  const rMask = buf.readUInt32LE(92);
  const gMask = buf.readUInt32LE(96);
  const bMask = buf.readUInt32LE(100);
  const aMask = buf.readUInt32LE(104);
  return { width, height, pfFlags, fourcc, rgbBitCount, rMask, gMask, bMask, aMask };
}

// RGB565 → [R, G, B] (8-bit each)
function rgb565to888 (c) {
  const r = (c >> 11) & 0x1F;
  const g = (c >>  5) & 0x3F;
  const b =  c        & 0x1F;
  return [
    (r << 3) | (r >> 2),
    (g << 2) | (g >> 4),
    (b << 3) | (b >> 2)
  ];
}

// Decode a single 4×4 DXT1 colour block at `offset`. Writes RGBA into `out`
// at pixel (px0, py0) of an image with `width` columns. `dxt3or5` = true
// means the block came from the colour half of a DXT3/DXT5 block, in which
// case the punch-through transparency rule of DXT1 is disabled (alpha comes
// from the alpha block instead).
function decodeDxt1Block (data, offset, out, width, height, px0, py0, dxt3or5) {
  const c0 = data.readUInt16LE(offset);
  const c1 = data.readUInt16LE(offset + 2);
  const indices = data.readUInt32LE(offset + 4);

  const col0 = rgb565to888(c0);
  const col1 = rgb565to888(c1);
  let col2, col3;
  let alpha3 = 255;
  if (c0 > c1 || dxt3or5) {
    col2 = [
      Math.round((2 * col0[0] + col1[0]) / 3),
      Math.round((2 * col0[1] + col1[1]) / 3),
      Math.round((2 * col0[2] + col1[2]) / 3)
    ];
    col3 = [
      Math.round((col0[0] + 2 * col1[0]) / 3),
      Math.round((col0[1] + 2 * col1[1]) / 3),
      Math.round((col0[2] + 2 * col1[2]) / 3)
    ];
  } else {
    col2 = [
      Math.round((col0[0] + col1[0]) / 2),
      Math.round((col0[1] + col1[1]) / 2),
      Math.round((col0[2] + col1[2]) / 2)
    ];
    col3 = [0, 0, 0];
    alpha3 = 0; // 1-bit punch-through
  }
  const palette = [col0, col1, col2, col3];

  for (let py = 0; py < 4; py++) {
    const yy = py0 + py;
    if (yy >= height) continue;
    for (let px = 0; px < 4; px++) {
      const xx = px0 + px;
      if (xx >= width) continue;
      const i = (py * 4 + px) * 2;
      const idx = (indices >>> i) & 0x3;
      const c = palette[idx];
      const dst = (yy * width + xx) * 4;
      out[dst]     = c[0];
      out[dst + 1] = c[1];
      out[dst + 2] = c[2];
      // For DXT3/DXT5, the alpha block already wrote the alpha value —
      // don't overwrite it. For DXT1, handle punch-through transparency.
      if (!dxt3or5) {
        out[dst + 3] = (idx === 3) ? alpha3 : 255;
      }
    }
  }
}

// DXT3 alpha block is 8 bytes of 4-bit alpha values, one per texel.
function decodeDxt3AlphaBlock (data, offset, out, width, height, px0, py0) {
  for (let py = 0; py < 4; py++) {
    const yy = py0 + py;
    if (yy >= height) continue;
    const rowBytes = data.readUInt16LE(offset + py * 2);
    for (let px = 0; px < 4; px++) {
      const xx = px0 + px;
      if (xx >= width) continue;
      const a4 = (rowBytes >> (px * 4)) & 0xF;
      const dst = (yy * width + xx) * 4;
      out[dst + 3] = (a4 << 4) | a4;
    }
  }
}

// DXT5 alpha block is 8 bytes: 2 alpha endpoints + 16 3-bit indices.
function decodeDxt5AlphaBlock (data, offset, out, width, height, px0, py0) {
  const a0 = data[offset];
  const a1 = data[offset + 1];
  const palette = new Array(8);
  palette[0] = a0;
  palette[1] = a1;
  if (a0 > a1) {
    for (let i = 1; i < 7; i++) {
      palette[i + 1] = Math.round(((7 - i) * a0 + i * a1) / 7);
    }
  } else {
    for (let i = 1; i < 5; i++) {
      palette[i + 1] = Math.round(((5 - i) * a0 + i * a1) / 5);
    }
    palette[6] = 0;
    palette[7] = 255;
  }
  // 6 bytes of 3-bit indices = 48 bits = 16 texels
  // Read as two 24-bit halves
  const lo = data[offset + 2] | (data[offset + 3] << 8) | (data[offset + 4] << 16);
  const hi = data[offset + 5] | (data[offset + 6] << 8) | (data[offset + 7] << 16);
  for (let i = 0; i < 16; i++) {
    const py = i >> 2;
    const px = i & 3;
    const yy = py0 + py;
    const xx = px0 + px;
    if (yy >= height || xx >= width) continue;
    let idx;
    if (i < 8) idx = (lo >> (i * 3)) & 0x7;
    else idx = (hi >> ((i - 8) * 3)) & 0x7;
    const dst = (yy * width + xx) * 4;
    out[dst + 3] = palette[idx];
  }
}

function decodeDds (buf) {
  const hdr = readDdsHeader(buf);
  const { width, height, fourcc, rgbBitCount, rMask, gMask, bMask, aMask } = hdr;
  const out = new Uint8ClampedArray(width * height * 4);
  const data = buf.slice(128);

  if (fourcc === 'DXT1') {
    let off = 0;
    for (let by = 0; by < height; by += 4) {
      for (let bx = 0; bx < width; bx += 4) {
        decodeDxt1Block(data, off, out, width, height, bx, by, false);
        off += 8;
      }
    }
    return { width, height, rgba: out, format: 'DXT1' };
  }
  if (fourcc === 'DXT3') {
    let off = 0;
    for (let by = 0; by < height; by += 4) {
      for (let bx = 0; bx < width; bx += 4) {
        decodeDxt3AlphaBlock(data, off, out, width, height, bx, by);
        decodeDxt1Block(data, off + 8, out, width, height, bx, by, true);
        off += 16;
      }
    }
    return { width, height, rgba: out, format: 'DXT3' };
  }
  if (fourcc === 'DXT5') {
    let off = 0;
    for (let by = 0; by < height; by += 4) {
      for (let bx = 0; bx < width; bx += 4) {
        decodeDxt5AlphaBlock(data, off, out, width, height, bx, by);
        decodeDxt1Block(data, off + 8, out, width, height, bx, by, true);
        off += 16;
      }
    }
    return { width, height, rgba: out, format: 'DXT5' };
  }
  // Uncompressed BGRA / BGR. Most WC3 terrain doesn't use these but we
  // handle the common 32-bit BGRA case for safety.
  if (rgbBitCount === 32) {
    const bytesPerPixel = 4;
    for (let i = 0; i < width * height; i++) {
      const src = i * bytesPerPixel;
      const px = data.readUInt32LE(src);
      const r = (rMask ? (px & rMask) >>> 0 : 0);
      const g = (gMask ? (px & gMask) >>> 0 : 0);
      const b = (bMask ? (px & bMask) >>> 0 : 0);
      const a = (aMask ? (px & aMask) >>> 0 : 0xFF);
      // We don't bother shifting — assume standard ARGB/BGRA layout.
      out[i * 4]     = (px >> 16) & 0xFF;
      out[i * 4 + 1] = (px >>  8) & 0xFF;
      out[i * 4 + 2] = (px      ) & 0xFF;
      out[i * 4 + 3] = (px >> 24) & 0xFF;
    }
    return { width, height, rgba: out, format: 'BGRA32' };
  }
  throw new Error(`unsupported DDS format: fourcc='${fourcc}' bpp=${rgbBitCount}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function ensureDir (p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// Resolve an SLK `dir` like "TerrainArt\LordaeronSummer" + filename like
// "Lords_Grass" to an absolute path on disk. The folder names on disk are
// lowercase ('terrainart/lordaeronsummer/lords_grass.dds').
function resolveDdsPath (slkDir, slkFile) {
  // strip leading "TerrainArt\" since we're already inside terrainart/
  const subdir = slkDir.replace(/^TerrainArt[\\/]/i, '').toLowerCase();
  const file = slkFile.toLowerCase() + '.dds';
  return path.join(TERRAINART_DIR, subdir, file);
}

function isGroundTileId (tileID) {
  // Ground tiles are a 4-char alphanumeric code where the first char is the
  // tileset letter (uppercase or a known custom). Cliff entries start with
  // 'c' followed by tile-set/cliff-set codes (e.g. 'cLc1', 'cLg1').
  return typeof tileID === 'string'
    && tileID.length === 4
    && /^[A-Z]/.test(tileID);
}

function main () {
  const args = process.argv.slice(2);
  let onlyTileset = null;
  let listOnly = false;
  for (const a of args) {
    if (a.startsWith('--tileset=')) onlyTileset = a.split('=')[1];
    if (a === '--list') listOnly = true;
  }

  if (!fs.existsSync(SLK_PATH)) {
    console.error(`SLK not found: ${SLK_PATH}`);
    process.exit(1);
  }
  const slkText = fs.readFileSync(SLK_PATH, 'utf8');
  const rows = parseSlk(slkText);

  // Filter to ground-tile rows where columns X1 (tileID), X3 (dir), X4 (file) all exist.
  const tiles = rows
    .map(r => ({ tileID: r[1], dir: r[3], file: r[4], comment: r[5] }))
    .filter(t => t.tileID && t.dir && t.file && isGroundTileId(t.tileID));

  console.log(`SLK parsed: ${rows.length} rows, ${tiles.length} ground tiles`);

  if (listOnly) {
    for (const t of tiles) {
      console.log(`  ${t.tileID}  ${t.dir}\\${t.file}  (${t.comment || ''})`);
    }
    return;
  }

  let success = 0, missing = 0, failed = 0;
  const formatsSeen = {};
  for (const t of tiles) {
    const tilesetChar = t.tileID[0];
    if (onlyTileset && tilesetChar !== onlyTileset) continue;

    const ddsPath = resolveDdsPath(t.dir, t.file);
    if (!fs.existsSync(ddsPath)) {
      console.log(`  MISSING ${t.tileID}: ${ddsPath}`);
      missing++;
      continue;
    }

    try {
      const buf = fs.readFileSync(ddsPath);
      const { width, height, rgba, format } = decodeDds(buf);
      formatsSeen[format] = (formatsSeen[format] || 0) + 1;

      // Output the full atlas (512×256 for ground tiles). The 3D renderer
      // uses per-tile UVs to address specific 64×64 sub-regions based on
      // the W3E variation nibble, so it needs the complete atlas.
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      const imageData = new ImageData(rgba, width, height);
      ctx.putImageData(imageData, 0, 0);

      const outDir = path.join(OUTPUT_DIR, tilesetChar);
      ensureDir(outDir);
      const outPath = path.join(outDir, `${t.tileID}.png`);
      fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
      success++;
      if (success % 20 === 0) console.log(`  …${success} converted`);
    } catch (err) {
      console.log(`  FAIL ${t.tileID}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nGround tiles: ${success} converted, ${missing} missing, ${failed} failed`);
  console.log('Formats seen:', formatsSeen);

  // --- Cliff textures from clifftypes.slk ---
  if (!fs.existsSync(CLIFF_SLK_PATH)) {
    console.log('\nNo clifftypes.slk found, skipping cliff textures');
    return;
  }
  const cliffSlkText = fs.readFileSync(CLIFF_SLK_PATH, 'utf8');
  const cliffRows = parseSlk(cliffSlkText);
  // Cliff SLK columns: X1=cliffID, X4=texDir, X5=texFile
  const cliffTiles = cliffRows
    .map(r => ({ cliffID: r[1], dir: r[4], file: r[5] }))
    .filter(t => t.cliffID && t.dir && t.file && t.cliffID.length === 4);

  console.log(`\nCliff SLK: ${cliffRows.length} rows, ${cliffTiles.length} cliff types`);

  if (listOnly) {
    for (const t of cliffTiles) {
      console.log(`  ${t.cliffID}  ${t.dir}\\${t.file}`);
    }
    return;
  }

  let cliffSuccess = 0, cliffMissing = 0, cliffFailed = 0;
  const cliffOutDir = path.join(OUTPUT_DIR, 'cliff');
  ensureDir(cliffOutDir);
  for (const t of cliffTiles) {
    const ddsPath = resolveDdsPath(t.dir, t.file);
    if (!fs.existsSync(ddsPath)) {
      console.log(`  MISSING cliff ${t.cliffID}: ${ddsPath}`);
      cliffMissing++;
      continue;
    }
    try {
      const buf = fs.readFileSync(ddsPath);
      const { width, height, rgba, format } = decodeDds(buf);
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      const imageData = new ImageData(rgba, width, height);
      ctx.putImageData(imageData, 0, 0);
      const outPath = path.join(cliffOutDir, `${t.cliffID}.png`);
      fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
      cliffSuccess++;
    } catch (err) {
      console.log(`  FAIL cliff ${t.cliffID}: ${err.message}`);
      cliffFailed++;
    }
  }
  console.log(`Cliff textures: ${cliffSuccess} converted, ${cliffMissing} missing, ${cliffFailed} failed`);
}

main();
