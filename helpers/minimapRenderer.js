// Game-accurate 2D minimap renderer for client/maps/{name}/map.jpg.
//
// Two paths:
//   1. BLP-first: decode war3mapMap.blp from the extracted mapdata folder.
//      This IS the image WC3 itself displays as the minimap during play, so
//      it matches the game by definition. Upscaled to FINAL_SIZE with
//      bilinear filtering.
//
//   2. Synthesis fallback: reimplement HiveWE's minimap algorithm
//      (HiveWE/src/base/terrain.ixx:859-897) when the BLP is missing or
//      decode fails. Reads the W3E grid via TERRAINFile.
//
// The output is just terrain. Trees, neutral building icons, camp rings,
// and player route polylines are layered on top by client code
// (CompareInline._renderCreepsCanvas).

const fs = require('fs');
const path = require('path');
const { createCanvas, ImageData } = require('canvas');
const { decodeBLP, getBLPImageData } = require('war3-model');

const { PALETTE_COLORS, getFallbackPaletteColor } = require('./tilesetColors');
const { WATER_OFFSETS, DEFAULT_WATER_OFFSET } = require('./waterOffsets');

const FINAL_SIZE = 1024;

// HiveWE constants (terrain.ixx:879-895). Cliff: uniform neutral gray for
// every cliff corner regardless of cliff height. Water: additive blend on
// top of the underlying terrain color, two depth tiers.
const CLIFF_GRAY     = [128, 128, 128];
const SHALLOW_MULT   = 0.75;
const SHALLOW_ADD    = [0, 0, 48];
const DEEP_MULT      = 0.5625;
const DEEP_ADD       = [0, 0, 80];
const DEEP_THRESHOLD = 0.5;

function clamp255 (v) { return Math.max(0, Math.min(255, Math.round(v))); }

function hexToRgb (hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ];
}

function blankCanvas () {
  const c = createCanvas(FINAL_SIZE, FINAL_SIZE);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0a0d10';
  ctx.fillRect(0, 0, FINAL_SIZE, FINAL_SIZE);
  return c;
}

function upscale (small) {
  const out = createCanvas(FINAL_SIZE, FINAL_SIZE);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, small.width, small.height, 0, 0, FINAL_SIZE, FINAL_SIZE);
  return out;
}

// BLP path. war3-model's decodeBLP needs a real ArrayBuffer, not a Node Buffer.
function renderFromBlp (blpPath) {
  const buf = fs.readFileSync(blpPath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const blp = decodeBLP(ab);
  const img = getBLPImageData(blp, 0); // mip 0 = full res
  const small = createCanvas(blp.width, blp.height);
  const data = new Uint8ClampedArray(img.data.buffer
    ? img.data.buffer.slice(0)
    : img.data);
  small.getContext('2d').putImageData(
    new ImageData(data, blp.width, blp.height), 0, 0
  );
  return upscale(small);
}

// Synthesis path — HiveWE algorithm.
function renderFromTerrain (terrainFile) {
  const grid = terrainFile.tileGrid;
  const rows = grid.length;
  const cols = (rows > 0 && grid[0]) ? grid[0].length : 0;
  if (!cols || !rows) return blankCanvas();

  const palettes = terrainFile.tilePalettes;
  const tileset = terrainFile.tileset;
  const waterOffset = (WATER_OFFSETS[tileset] !== undefined)
    ? WATER_OFFSETS[tileset]
    : DEFAULT_WATER_OFFSET;

  // 1. Per-cell cliff flag. A cell (r,c) is "cliff" iff its 4 surrounding
  //    corners don't all share the same layer height. The cell index is
  //    valid for r in [0..rows-2], c in [0..cols-2]; everything else stays 0.
  const cellCliff = new Uint8Array(rows * cols);
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = grid[r][c].layer;
      const b = grid[r][c + 1].layer;
      const d = grid[r + 1][c].layer;
      const e = grid[r + 1][c + 1].layer;
      if (a !== b || a !== d || a !== e) cellCliff[r * cols + c] = 1;
    }
  }

  // 2. Resolve color per palette index once. Falls back through the
  //    suffix-matched cross-tileset table, then a default greenish ground.
  const paletteRgb = palettes.map((code) => {
    const hex = PALETTE_COLORS[code]
      || getFallbackPaletteColor(code, code ? code.slice(1) : '')
      || '#4a6838';
    return hexToRgb(hex);
  });
  const fallbackRgb = [74, 104, 56];

  // 3. Per-corner pass.
  const native = new Uint8ClampedArray(rows * cols * 4);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const tile = grid[j][i];
      const here = j * cols + i;

      // Base color from this corner's ground palette index. Tile records
      // can have an out-of-range index (rare) — wrap defensively.
      let base = fallbackRgb;
      if (palettes.length > 0) {
        const idx = (tile.paletteIndex < palettes.length)
          ? tile.paletteIndex
          : tile.paletteIndex % palettes.length;
        base = paletteRgb[idx] || fallbackRgb;
      }
      let r = base[0], g = base[1], b = base[2];

      // Cliff override: any of the 4 cells touching this corner has a
      // cliff flag → gray, full stop. (HiveWE terrain.ixx:871)
      if (
        (cellCliff[here])                                    // cell at this corner
        || (i > 0           && cellCliff[here - 1])          // cell to the left
        || (j > 0           && cellCliff[here - cols])       // cell below
        || (i > 0 && j > 0  && cellCliff[here - cols - 1])   // cell down-left
      ) {
        r = CLIFF_GRAY[0]; g = CLIFF_GRAY[1]; b = CLIFF_GRAY[2];
      } else if (tile.hasWater) {
        // Water additive blend, two tiers. (HiveWE terrain.ixx:879)
        // Heights are in W3E "world units" — see TERRAINFile.js docstring.
        const wg = ((tile.groundHeight - 0x2000) + (tile.layer - 2) * 0x0200) / 4;
        const ww = (tile.waterLevel - 0x2000) / 4 - 89.6 + waterOffset * 128;
        if (ww > wg) {
          const deep = (ww - wg) > DEEP_THRESHOLD;
          const m = deep ? DEEP_MULT : SHALLOW_MULT;
          const a = deep ? DEEP_ADD  : SHALLOW_ADD;
          r = clamp255(r * m + a[0]);
          g = clamp255(g * m + a[1]);
          b = clamp255(b * m + a[2]);
        }
      }

      // Y-flip when writing: W3E corner row 0 is south, image row 0 is north.
      const o = ((rows - 1 - j) * cols + i) * 4;
      native[o]     = r;
      native[o + 1] = g;
      native[o + 2] = b;
      native[o + 3] = 255;
    }
  }

  const small = createCanvas(cols, rows);
  small.getContext('2d').putImageData(new ImageData(native, cols, rows), 0, 0);
  return upscale(small);
}

async function renderMinimap (mapdataDir, terrainFile) {
  const blpPath = path.join(mapdataDir, 'war3mapMap.blp');
  if (fs.existsSync(blpPath)) {
    try {
      return renderFromBlp(blpPath);
    } catch (err) {
      console.log(`    minimap: BLP decode failed (${err.message}), falling back to synthesis`);
    }
  }
  return renderFromTerrain(terrainFile);
}

module.exports = { renderMinimap, FINAL_SIZE };
