/**
 * Parse WC3 building pathing TGAs into helpers/buildingPathing.json.
 *
 * Reads:
 *   tools/map-data/units/unitdata.slk           — itemId → pathTex mapping
 *   tools/map-data/buildings/_pathing-tgas/*.tga — extracted pathing textures
 *
 * Writes:
 *   helpers/buildingPathing.json
 *
 * Output schema:
 *   {
 *     "version": 1,
 *     "buildings": {
 *       "<itemId>": {
 *         "widthCells": N, "heightCells": M,
 *         "widthTiles": N/4, "heightTiles": M/4,
 *         "blockedWalk":  "<base64 row-major top-down bitmap>",
 *         "blockedBuild": "<base64>",
 *         "blockedFly":   "<base64>",
 *         "sourceTex":    "PathTextures\\10x10Simple.tga"
 *         // or for fallback entries:
 *         "fallback":     true,
 *         "fallbackReason": "missing TGA: ..."
 *       }
 *     }
 *   }
 *
 * Usage:
 *   node tools/parse-building-pathing.js
 *   node tools/parse-building-pathing.js --list   # list unique textures only
 *   node tools/parse-building-pathing.js --verify <itemId>  # ASCII-dump one bitmap
 */

const fs = require('fs');
const path = require('path');
const { parseSLK } = require('../helpers/slkParser');

const UNITDATA_PATH = path.join(__dirname, 'map-data', 'units', 'unitdata.slk');
const TGA_DIR = path.join(__dirname, 'map-data', 'buildings', '_pathing-tgas');
const OUTPUT_PATH = path.join(__dirname, '..', 'helpers', 'buildingPathing.json');

// ---------------------------------------------------------------------------
// TGA decoder (uncompressed type 2, RLE type 10; 24/32 bpp; respects origin)
// ---------------------------------------------------------------------------

function decodeTGA (buf) {
  if (buf.length < 18) throw new Error('TGA too short');
  const header = {
    idLength:    buf[0],
    cmapType:    buf[1],
    imageType:   buf[2],
    width:       buf.readUInt16LE(12),
    height:      buf.readUInt16LE(14),
    bpp:         buf[16],
    imageDesc:   buf[17]
  };
  if (header.imageType !== 2 && header.imageType !== 10) {
    throw new Error('unsupported TGA imageType: ' + header.imageType);
  }
  if (header.bpp !== 24 && header.bpp !== 32) {
    throw new Error('unsupported TGA bpp: ' + header.bpp);
  }
  const bytesPerPx = header.bpp / 8;
  const w = header.width, h = header.height;
  const pxStart = 18 + header.idLength + (header.cmapType ? 0 : 0); // colormap unsupported

  // Decode pixel array into BGR(A) buffer.
  const pixels = Buffer.alloc(w * h * bytesPerPx);

  if (header.imageType === 2) {
    buf.copy(pixels, 0, pxStart, pxStart + pixels.length);
  } else {
    // RLE
    let src = pxStart;
    let dst = 0;
    const totalBytes = pixels.length;
    while (dst < totalBytes) {
      const packet = buf[src++];
      const count = (packet & 0x7F) + 1;
      if (packet & 0x80) {
        // RLE packet: repeat next pixel count times
        for (let i = 0; i < count; i++) {
          buf.copy(pixels, dst, src, src + bytesPerPx);
          dst += bytesPerPx;
        }
        src += bytesPerPx;
      } else {
        // Raw packet: count pixels follow
        const bytes = count * bytesPerPx;
        buf.copy(pixels, dst, src, src + bytes);
        dst += bytes;
        src += bytes;
      }
    }
  }

  // Origin: imageDesc bit 5 = top-down. WC3 pathing.tgas are typically
  // bottom-up (bit 5 clear), so we flip Y to deliver row-major top-down.
  const topDown = (header.imageDesc & 0x20) !== 0;

  // Output channels as Uint8Arrays of length w*h (row-major top-down).
  const r = new Uint8Array(w * h);
  const g = new Uint8Array(w * h);
  const b = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const srcY = topDown ? y : (h - 1 - y);
    for (let x = 0; x < w; x++) {
      const srcIdx = (srcY * w + x) * bytesPerPx;
      const dstIdx = y * w + x;
      // TGA pixel order is BGR(A)
      b[dstIdx] = pixels[srcIdx];
      g[dstIdx] = pixels[srcIdx + 1];
      r[dstIdx] = pixels[srcIdx + 2];
    }
  }

  return { width: w, height: h, r, g, b };
}

// ---------------------------------------------------------------------------
// Bit packing
// ---------------------------------------------------------------------------

function channelToBits (channel, threshold = 64) {
  // Pack one bit per cell (1 = blocked, 0 = free) into a Uint8Array.
  const n = channel.length;
  const bytes = Math.ceil(n / 8);
  const out = new Uint8Array(bytes);
  for (let i = 0; i < n; i++) {
    if (channel[i] > threshold) {
      out[i >> 3] |= (1 << (i & 7));
    }
  }
  return Buffer.from(out).toString('base64');
}

// Bounding box of the >threshold cells. Returns null if the channel is empty.
// {minX, minY, maxX, maxY, width, height, centerOffsetX, centerOffsetY}
// where centerOffset is the bbox center relative to the bitmap center
// (in cells; 0,0 = centered).
function channelBbox (channel, w, h, threshold = 64) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (channel[y * w + x] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const bboxCenterX = (minX + maxX + 1) / 2;
  const bboxCenterY = (minY + maxY + 1) / 2;
  return {
    minX, minY, maxX, maxY, width, height,
    centerOffsetX: bboxCenterX - w / 2,
    centerOffsetY: bboxCenterY - h / 2
  };
}

// ---------------------------------------------------------------------------
// Verify / dump helper
// ---------------------------------------------------------------------------

function dumpBitmap (b64, w, h) {
  const raw = Buffer.from(b64, 'base64');
  const lines = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const bit = (raw[idx >> 3] >> (idx & 7)) & 1;
      row += bit ? '█' : '·';
    }
    lines.push(row);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function run () {
  const args = process.argv.slice(2);
  const flags = {
    list:    args.includes('--list'),
    verify:  args.indexOf('--verify')
  };

  // 1. Parse unitdata.slk → itemId → pathTex (and collisionSize for fallbacks).
  const unitSLK = parseSLK(UNITDATA_PATH);
  const itemIdToPathTex = {};
  for (const row of unitSLK.rows) {
    const id = row.unitID;
    const tex = row.pathTex;
    if (!id || !tex || tex === '_' || tex === '') continue;
    itemIdToPathTex[id] = tex;
  }

  const uniqueTexs = Array.from(new Set(Object.values(itemIdToPathTex))).sort();

  if (flags.list) {
    console.log('Unique pathing textures (' + uniqueTexs.length + '):');
    for (const t of uniqueTexs) console.log('  ' + t);
    console.log('\nBuilding count: ' + Object.keys(itemIdToPathTex).length);
    return;
  }

  // 2. Decode each unique TGA. Hard-fail on the first missing/broken file —
  //    the manifest is required, not optional, and there is no fallback.
  const texCache = {};
  const missingTexs = [];
  for (const tex of uniqueTexs) {
    const fname = tex.replace(/^PathTextures[\\/]/i, '');
    const tgaPath = path.join(TGA_DIR, fname);
    if (!fs.existsSync(tgaPath)) {
      missingTexs.push(tex);
      continue;
    }
    try {
      const buf = fs.readFileSync(tgaPath);
      const img = decodeTGA(buf);
      const walkBbox = channelBbox(img.r, img.width, img.height);
      texCache[tex] = {
        widthCells:  img.width,
        heightCells: img.height,
        walkB64:     channelToBits(img.r),
        buildB64:    channelToBits(img.g),
        flyB64:      channelToBits(img.b),
        walkBbox:    walkBbox  // null if no walk-block cells
      };
    } catch (err) {
      console.error('FATAL: failed to decode ' + tex + ': ' + err.message);
      process.exit(1);
    }
  }
  if (missingTexs.length) {
    console.error('FATAL: missing ' + missingTexs.length + ' pathing TGAs in ' + TGA_DIR);
    for (const t of missingTexs) console.error('  ' + t);
    console.error('Extract them from CASC (war3.w3mod\\PathTextures\\) — see tools/list-casc-extractions.js section 6.');
    process.exit(1);
  }

  // 3. Build per-itemId manifest. We store both the full bitmap dimensions
  //    (for static stamping) AND the walk-block bounding box (for client
  //    rendering — units stop at the walk-block edge, not the TGA edge).
  const buildings = {};
  for (const itemId of Object.keys(itemIdToPathTex)) {
    const tex = itemIdToPathTex[itemId];
    const decoded = texCache[tex];
    const wb = decoded.walkBbox;
    buildings[itemId] = {
      widthCells:  decoded.widthCells,
      heightCells: decoded.heightCells,
      widthTiles:  decoded.widthCells / 4,
      heightTiles: decoded.heightCells / 4,
      blockedWalk:  decoded.walkB64,
      blockedBuild: decoded.buildB64,
      blockedFly:   decoded.flyB64,
      sourceTex:    tex,
      // Walk-block bbox — clients render the building at this size so units
      // never visually overlap the rendered box.
      walkBbox: wb ? {
        widthCells:  wb.width,
        heightCells: wb.height,
        widthTiles:  wb.width / 4,
        heightTiles: wb.height / 4,
        // World-unit offset from building center to walk-bbox center.
        offsetX:     wb.centerOffsetX * 32,
        offsetY:     wb.centerOffsetY * 32
      } : null
    };
  }

  // 4. --verify <itemId>: dump that entry visually before writing.
  if (flags.verify >= 0) {
    const target = args[flags.verify + 1];
    const entry = buildings[target];
    if (!entry) {
      console.error('No entry for itemId: ' + target);
      process.exit(1);
    }
    console.log('Building: ' + target + '  (' + entry.widthCells + 'x' + entry.heightCells +
                ' cells = ' + entry.widthTiles + 'x' + entry.heightTiles + ' tiles)');
    console.log('Source:  ' + entry.sourceTex + (entry.fallback ? '  [FALLBACK]' : ''));
    console.log('blockedWalk:');
    console.log(dumpBitmap(entry.blockedWalk, entry.widthCells, entry.heightCells));
    return;
  }

  // 5. Write manifest.
  const manifest = { version: 1, buildings };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(manifest));
  const sizeKB = (fs.statSync(OUTPUT_PATH).size / 1024).toFixed(1);

  console.log('Wrote ' + OUTPUT_PATH);
  console.log('  Buildings: ' + Object.keys(buildings).length);
  console.log('  Textures decoded: ' + uniqueTexs.length + ' / ' + uniqueTexs.length);
  console.log('  Manifest size: ' + sizeKB + ' KB');
}

if (require.main === module) {
  run();
}

module.exports = { decodeTGA, channelToBits, dumpBitmap };
