/*
  Regenerate map images from already-extracted mapdata.
  Uses the same drawing logic as data-tool.js but skips MPQ extraction.

  Usage:
    node tools/regen-maps.js                          # all maps
    node tools/regen-maps.js --map=NorthernIsles      # single map
    node tools/regen-maps.js --dry-run                # just show tilesets
    node tools/regen-maps.js --terrain-size=4096      # downscale terrain.jpg to NxN before encode
    node tools/regen-maps.js --terrain-quality=0.85   # JPEG quality (0..1, default 0.92)
*/

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const UNITFile = require("../lib/parsers/UNITFile");
const INFOFile = require("../lib/parsers/INFOFile");
const TERRAINFile = require("../lib/parsers/TERRAINFile");
const { getUnitInfo } = require("../helpers/mappings");
const { renderMinimap } = require("../helpers/minimapRenderer");
const { neutralBuildingEntry } = require("./lib/neutral-buildings");

const { createCanvas, loadImage } = require("canvas");

const TERRAIN_TEX_DIR = "client/assets/terrain";

const MAPDATA_DIR = "mapdata";
const CLIENT_MAPS_DIR = "client/maps";

// Optional overrides set from CLI in main().
// terrainSize: if non-null, downscale the native bake to NxN before JPEG encode.
// terrainQuality: JPEG quality 0..1 for terrain.jpg.
let terrainSize = null;
let terrainQuality = 0.92;

const TILESET_NAMES = {
  'L': 'Lordaeron Summer', 'V': 'Village', 'F': 'Lordaeron Fall', 'X': 'Village Fall',
  'W': 'Lordaeron Winter', 'N': 'Northrend', 'I': 'Icecrown', 'A': 'Ashenvale',
  'C': 'Felwood', 'B': 'Barrens', 'D': 'Dungeon', 'G': 'Underground',
  'K': 'Cityscape', 'J': 'Dalaran Ruins', 'Y': 'Sunken Ruins',
  'Z': 'Ruins', 'Q': 'Dalaran', 'O': 'Outland', 'c': 'Custom/Mixed'
};

const { TILESET_EXTRAS, DEFAULT_EXTRAS, PALETTE_COLORS, getFallbackPaletteColor } = require('../helpers/tilesetColors');

function hexToRgb (hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

// ---------------------------------------------------------------------------
// Terrain texture bake
//
// Composes a single high-resolution terrain image for a map by tiling each
// real WC3 ground texture (pre-extracted into client/assets/terrain/{T}/{code}.png)
// across the map and bilinearly blending adjacent tile types so boundaries are
// smooth gradients instead of hard lines. Output: client/maps/{name}/terrain.jpg
//
// The 3D mesh later samples this single texture with simple (col, row) UVs.
// No atlas, no shader splat blending, no per-tile rotation hacks needed —
// the texture is pre-blended and just gets stretched onto the heightmap mesh.
// ---------------------------------------------------------------------------
async function loadPaletteImages (codes) {
  const out = new Map();
  for (const code of codes) {
    // Each palette code's first character is its tileset (e.g. Fgrd → F/)
    const codeChar = code.charAt(0);
    const p = `${TERRAIN_TEX_DIR}/${codeChar}/${code}.png`;
    if (!fs.existsSync(p)) {
      // Missing texture — create a solid-color fallback from PALETTE_COLORS
      // so tiles are never silently black
      const hex = PALETTE_COLORS[code] || getFallbackPaletteColor(code, code.substring(1));
      if (hex) {
        console.log(`    warning: missing texture ${p}, using flat color ${hex}`);
      } else {
        console.error(`    ERROR: missing texture ${p} and no palette color for ${code} — using magenta`);
      }
      const fallbackHex = hex || '#FF00FF';
      const rgb = hexToRgb(fallbackHex);
      // 128x64 canvas (width=2x height) so extended atlas detection works
      const fc = createCanvas(128, 64);
      const fctx = fc.getContext('2d');
      fctx.fillStyle = fallbackHex;
      fctx.fillRect(0, 0, 128, 64);
      out.set(code, fc);
      continue;
    }
    try {
      const img = await loadImage(p);
      out.set(code, img);
    } catch (err) {
      console.error(`    ERROR: failed to load ${p}: ${err.message}`);
      out.set(code, null);
    }
  }
  return out;
}

async function bakeTerrainTexture (terrainFile, clientMapDir) {
  const tileGrid = terrainFile.tileGrid;
  const rows = tileGrid.length;     // corner rows (nTilesY + 1)
  const cols = tileGrid[0] ? tileGrid[0].length : 0;
  if (!cols || !rows) return null;

  const tilesetChar = terrainFile.tileset;
  const palettes = terrainFile.tilePalettes;
  const nPalettes = palettes.length;

  // Load full 512×256 atlas PNGs per palette.
  const images = await loadPaletteImages(palettes);

  // Extract sub-tile layers from each atlas (HiveWE ground_texture.ixx).
  // 512×256 = extended mode: two 4×4 grids of sub-tiles.
  //   Layers 0-15  (left half):  transition shapes WITH alpha
  //   Layers 16-31 (right half): variation textures, fully opaque
  // Grid index: row * 4 + col (row-major).
  const atlasLayers = new Map();  // palette code → { layers[], tileSize }
  for (let p = 0; p < nPalettes; p++) {
    const code = palettes[p];
    const img = images.get(code);
    if (!img) continue;

    const extended = (img.width === img.height * 2);
    const tileSize = Math.floor(img.height / 4);
    const layers = [];

    // Left half: layers 0-15 (transition shapes with alpha)
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const lc = createCanvas(tileSize, tileSize);
        lc.getContext('2d').drawImage(img, col * tileSize, row * tileSize, tileSize, tileSize, 0, 0, tileSize, tileSize);
        layers.push(lc.getContext('2d').getImageData(0, 0, tileSize, tileSize));
      }
    }
    // Right half: layers 16-31 (variation textures, opaque)
    if (extended) {
      const halfW = Math.floor(img.width / 2);
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) {
          const lc = createCanvas(tileSize, tileSize);
          lc.getContext('2d').drawImage(img, halfW + col * tileSize, row * tileSize, tileSize, tileSize, 0, 0, tileSize, tileSize);
          layers.push(lc.getContext('2d').getImageData(0, 0, tileSize, tileSize));
        }
      }
    }
    atlasLayers.set(code, { layers, tileSize, extended });
  }

  // Output at tileSize px per tile (1:1 with atlas sub-tiles).
  const firstAtlas = atlasLayers.values().next().value;
  const T = firstAtlas ? firstAtlas.tileSize : 64;
  const nTilesX = cols - 1;
  const nTilesY = rows - 1;
  const outW = nTilesX * T;
  const outH = nTilesY * T;
  const canvas = createCanvas(outW, outH);
  const ctx = canvas.getContext('2d');
  const outImg = ctx.createImageData(outW, outH);
  const out = outImg.data;

  // Sample a sub-tile layer at pixel (px, py) within a tile.
  // HiveWE: UV = vec2(vPosition.x, 1 - vPosition.y). V=0 at north (top of
  // tile), V=1 at south (bottom). OpenGL V=0 = first stored row = top of
  // sub-tile image. In our bake, py=0 = top of tile = north. So py maps
  // directly to sub-tile row — no flip needed.
  function sampleLayer (layerImg, tileSize, px, py) {
    const tx = Math.min(Math.floor(px * tileSize / T), tileSize - 1);
    const ty = Math.min(Math.floor(py * tileSize / T), tileSize - 1);
    const idx = (ty * tileSize + tx) * 4;
    return [layerImg.data[idx], layerImg.data[idx + 1], layerImg.data[idx + 2], layerImg.data[idx + 3]];
  }

  // Variation layer selection (HiveWE get_tile_variation).
  function getVariationLayer (atlas, variation) {
    if (atlas.extended) {
      return (variation <= 15) ? 16 + variation : (variation === 16) ? 15 : 0;
    }
    return 0;
  }

  // Build cliff-to-ground texture mapping (HiveWE real_tile_texture).
  // Cliff palettes have a groundTile field in clifftypes.slk. When a corner
  // is near a cliff or ramp, its ground texture is overridden.
  const cliffPalettes = terrainFile.cliffPalettes || [];
  const CLIFF_GROUND_MAP = {};  // cliff palette index → ground palette index
  // Parse clifftypes.slk for groundTile mapping
  const cliffSlkPath = path.join(__dirname, 'map-data', 'terrainart', 'clifftypes.slk');
  if (fs.existsSync(cliffSlkPath)) {
    const slkText = fs.readFileSync(cliffSlkPath, 'utf8');
    const lines = slkText.split(/\r?\n/);
    let curRow = 0, cliffId = '', groundTile = '';
    for (const line of lines) {
      if (!line.startsWith('C;')) continue;
      const parts = line.split(';');
      let x = null, y = null, k = null;
      for (const p of parts) {
        if (p[0] === 'X') x = parseInt(p.slice(1));
        if (p[0] === 'Y') y = parseInt(p.slice(1));
        if (p[0] === 'K') k = p.slice(1).replace(/^"|"$/g, '');
      }
      if (y != null) { curRow = y; cliffId = ''; groundTile = ''; }
      if (x === 1 && k) cliffId = k;
      if (x === 7 && k) groundTile = k;
      if (cliffId && groundTile) {
        const ci = cliffPalettes.indexOf(cliffId);
        const gi = palettes.indexOf(groundTile);
        if (ci >= 0 && gi >= 0) CLIFF_GROUND_MAP[ci] = gi;
        cliffId = ''; groundTile = '';
      }
    }
  }

  // HiveWE terrain.ixx:1448 — corner_cliff[bl] is true when bl's layer
  // differs from br, tl, or tr of the tile whose BL corner is at (c, r).
  // bl=ci(c,r), br=ci(c+1,r), tl=ci(c,r+1), tr=ci(c+1,r+1).
  const cornerCliff = new Uint8Array(rows * cols);
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const blLayer = tileGrid[r][c].layer;
      const brLayer = tileGrid[r][c + 1].layer;
      const tlLayer = tileGrid[r + 1][c].layer;
      const trLayer = tileGrid[r + 1][c + 1].layer;
      if (blLayer !== brLayer || blLayer !== tlLayer || blLayer !== trLayer) {
        cornerCliff[r * cols + c] = 1;
      }
    }
  }

  // HiveWE terrain.ixx:736-767 — real_tile_texture per corner.
  // Checks self + LEFT + DOWN + DOWN-LEFT for cliff/romp flags.
  // "We only need to check ourselves, to the left, bottom-left and bottom"
  const realTexture = new Uint8Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tile = tileGrid[r][c];
      const idx = r * cols + c;
      let hasCliff = cornerCliff[idx] === 1;
      // LEFT (c-1)
      if (c > 0) hasCliff = hasCliff || cornerCliff[idx - 1] === 1;
      // DOWN (r-1) — r-1 = south in W3E coords
      if (r > 0) hasCliff = hasCliff || cornerCliff[(r - 1) * cols + c] === 1;
      // DOWN-LEFT
      if (c > 0 && r > 0) hasCliff = hasCliff || cornerCliff[(r - 1) * cols + (c - 1)] === 1;

      if (hasCliff && !tile.isRamp) {
        let ct = tile.cliffTexture;
        if (ct === 15) ct = 1;  // HiveWE: "Number 15 seems to be something"
        realTexture[idx] = CLIFF_GROUND_MAP[ct] !== undefined
          ? CLIFF_GROUND_MAP[ct] : tile.paletteIndex;
      } else {
        realTexture[idx] = tile.paletteIndex;
      }
    }
  }

  // Terrain compositing per tile (HiveWE algorithm):
  // 1. Sort + deduplicate corner textures ascending (low priority first)
  // 2. Lowest = base, uses variation layer (right half, opaque)
  // 3. Higher textures use corner mask (==) → left-half layer (has alpha)
  // 4. Composite: highest drawn first, lower layers mixed where alpha < 1
  for (let r = 0; r < nTilesY; r++) {
    const dstYBase = (nTilesY - 1 - r) * T;
    for (let c = 0; c < nTilesX; c++) {
      const dstXBase = c * T;

      // Use real_tile_texture (cliff-overridden) palette indices
      const blPal = realTexture[r * cols + c];
      const brPal = realTexture[r * cols + (c + 1)];
      const tlPal = realTexture[(r + 1) * cols + c];
      const trPal = realTexture[(r + 1) * cols + (c + 1)];
      const variation = tileGrid[r][c].variation;

      // Sort + deduplicate ascending
      const sorted = [...new Set([blPal, brPal, tlPal, trPal])]
        .filter(p => p < nPalettes)
        .sort((a, b) => a - b);
      if (!sorted.length) continue;

      // Build layer stack
      const stack = [];
      // Base (lowest) — variation layer from right half (opaque)
      const baseAtlas = atlasLayers.get(palettes[sorted[0]]);
      if (baseAtlas) {
        stack.push({ atlas: baseAtlas, layerIdx: getVariationLayer(baseAtlas, variation) });
      }
      // Overlays (higher priority) — corner mask from left half (has alpha).
      // HiveWE uses exact match (==) for corner mask encoding.
      for (let k = 1; k < sorted.length; k++) {
        const texId = sorted[k];
        const atlas = atlasLayers.get(palettes[texId]);
        if (!atlas) continue;
        const mask = ((brPal === texId ? 1 : 0)) |
                     ((blPal === texId ? 1 : 0) << 1) |
                     ((trPal === texId ? 1 : 0) << 2) |
                     ((tlPal === texId ? 1 : 0) << 3);
        if (mask === 0) continue;
        stack.push({ atlas, layerIdx: mask });
      }

      for (let py = 0; py < T; py++) {
        for (let px = 0; px < T; px++) {
          const outIdx = ((dstYBase + py) * outW + (dstXBase + px)) * 4;
          // HiveWE terrain.frag compositing: start with highest layer,
          // then mix lower layers where the accumulated result is transparent.
          //   color = sample(highest)
          //   color = mix(next_lower, color, color.a)
          //   ...repeat down to base
          // This preserves higher layers where opaque, fills gaps with lower.
          let cR = 0, cG = 0, cB = 0, cA = 0;
          for (let s = stack.length - 1; s >= 0; s--) {
            const { atlas, layerIdx } = stack[s];
            const layer = atlas.layers[layerIdx];
            if (!layer) continue;
            const [sR, sG, sB, sA] = sampleLayer(layer, atlas.tileSize, px, py);
            // mix(lower, current, current.a): keep current where opaque,
            // blend in lower where current is transparent
            const ca = cA / 255;
            cR = Math.round(sR * (1 - ca) + cR * ca);
            cG = Math.round(sG * (1 - ca) + cG * ca);
            cB = Math.round(sB * (1 - ca) + cB * ca);
            cA = Math.min(255, Math.round(sA * (1 - ca) + cA));
          }
          out[outIdx] = cR; out[outIdx + 1] = cG; out[outIdx + 2] = cB;
          out[outIdx + 3] = 255;
        }
      }
    }
  }

  ctx.putImageData(outImg, 0, 0);

  let encodeCanvas = canvas;
  let finalW = outW, finalH = outH;
  if (terrainSize && terrainSize !== outW) {
    const dst = createCanvas(terrainSize, terrainSize);
    const dctx = dst.getContext('2d');
    dctx.imageSmoothingEnabled = true;
    dctx.imageSmoothingQuality = 'high';
    dctx.drawImage(canvas, 0, 0, outW, outH, 0, 0, terrainSize, terrainSize);
    encodeCanvas = dst;
    finalW = finalH = terrainSize;
  }
  const buf = encodeCanvas.toBuffer('image/jpeg', { quality: terrainQuality });

  if (!fs.existsSync(clientMapDir)) {
    fs.mkdirSync(clientMapDir, { recursive: true });
  }

  fs.writeFileSync(`${clientMapDir}/terrain.jpg`, buf);
  const usedTextures = palettes.filter(c => images.get(c)).length;
  const sizeNote = (finalW !== outW) ? ` → ${finalW}x${finalH}` : '';
  console.log(`    baked terrain ${outW}x${outH}${sizeNote} px q=${terrainQuality} (${usedTextures}/${nPalettes} textures, ${(buf.length/1024).toFixed(0)} KB)`);
  return { width: finalW, height: finalH, codes: palettes, usedTextures };
}

// Minimap render entry point. Prefers war3mapMap.blp (the literal image WC3
// displays in-game) from the extracted mapdata folder; falls back to a
// HiveWE-style synthesis from the W3E grid when the BLP is missing. Trees
// and neutral building icons are layered on top by the client, not baked.
async function drawBackgroundMap (mapdataDir, terrainFile) {
  return renderMinimap(mapdataDir, terrainFile);
}


async function regenMap(mapName, dryRun) {
  const mapDataDir = `${MAPDATA_DIR}/${mapName}`;
  const clientMapDir = `${CLIENT_MAPS_DIR}/${mapName}`;

  if (!fs.existsSync(`${mapDataDir}/war3map.w3e`)) {
    console.log(`  SKIP ${mapName} - no war3map.w3e`);
    return null;
  }

  const terrainFile = new TERRAINFile(`${mapDataDir}/war3map.w3e`);
  const tileset = terrainFile.tileset;
  const themeName = TILESET_NAMES[tileset] || 'Unknown';

  console.log(`  ${mapName}: tileset=${tileset} (${themeName})`);

  if (dryRun) return { tileset, themeName };

  const infoFile = new INFOFile(`${mapDataDir}/war3map.w3i`);

  const output = { ...infoFile };
  output.info.gridSize.full = [terrainFile.map.width, terrainFile.map.height];
  // margins from W3I camera complements (now saved by INFOFile parser)
  if (infoFile.info.gridSize.margins) {
    output.info.gridSize.margins = infoFile.info.gridSize.margins;
  }
  output.info.bounds.map = [
    [terrainFile.map.offset.x, terrainFile.map.offset.x + (terrainFile.map.width * 128)],
    [terrainFile.map.offset.y + (terrainFile.map.height * 128), terrainFile.map.offset.y]
  ];
  output.info.name = mapName;

  const extras = TILESET_EXTRAS[tileset] || DEFAULT_EXTRAS;
  output.info.tileset = tileset;
  output.info.treeColor = extras.trees;
  output.info.treeStroke = extras.treeStroke;

  // Bake multi-layer composited terrain texture (used by 3D renderer)
  await bakeTerrainTexture(terrainFile, clientMapDir);

  const canvas = await drawBackgroundMap(mapDataDir, terrainFile);

  // Extract neutral building positions for the client overlay JSON.
  let neutralBuildings = [];
  const unitFilePath = `${mapDataDir}/war3mapUnits.doo`;
  if (fs.existsSync(unitFilePath)) {
    try {
      const unitFile = new UNITFile(unitFilePath);
      if (unitFile.units) {
        unitFile.units.forEach(rawUnit => {
          const info = getUnitInfo(rawUnit.type);
          if (info.isGoldmine || info.isFountain || info.isInteractiveShop) {
            neutralBuildings.push(neutralBuildingEntry(rawUnit, info));
          }
        });
      }
    } catch (err) {
      console.log(`    warning: could not parse war3mapUnits.doo: ${err.message}`);
    }
  }

  const buffer = canvas.toBuffer('image/jpeg', { quality: 0.92 });

  if (!fs.existsSync(clientMapDir)) {
    fs.mkdirSync(clientMapDir, { recursive: true });
  }

  fs.writeFileSync(`${clientMapDir}/map.jpg`, buffer);
  fs.writeFileSync(`${clientMapDir}/gridmap.jpg`, buffer);

  // Export per-corner W3E data for the 3D terrain renderer.
  //
  // Binary format v5 (variable-length header, little-endian):
  //   uint32 magic        = 0x57334831   ('W3H1')
  //   uint32 version      = 5
  //   uint32 cols
  //   uint32 rows
  //   uint32 numPalettes
  //   char[4 * numPalettes] paletteCodes  — each entry is a 4-char ASCII
  //                                          code (e.g. 'Lgrs', 'Ldrt').
  //   uint32 numCliffPalettes
  //   char[4 * numCliffPalettes] cliffPaletteCodes  — e.g. 'CLdi', 'CLgr'
  //   (padding to 2-byte alignment for int16 arrays)
  // Followed by eight contiguous arrays of length cols*rows:
  //   int16[] groundHeight (raw W3E, baseline 0x2000)
  //   int16[] waterLevel   (raw W3E, baseline 0x2000)
  //   uint8[] flags        (0x10 ramp, 0x20 blight, 0x40 hasWater, 0x80 boundary)
  //   uint8[] layer        (0..15, layer==2 is "ground zero")
  //   uint8[] rgb          (3 bytes per corner = R, G, B palette color)
  //   uint8[] paletteIdx   (1 byte per corner = index into the palette table above)
  //   uint8[] cliffTexIdx  (1 byte per corner = index into cliff palette table)
  //   uint8[] variation    (1 byte per corner = ground texture variation 0..15)
  {
    const cols = terrainFile.tileGrid[0] ? terrainFile.tileGrid[0].length : 0;
    const rows = terrainFile.tileGrid.length;
    const total = cols * rows;
    const numPalettes = terrainFile.tilePalettes.length;
    const numCliffPalettes = terrainFile.cliffPalettes ? terrainFile.cliffPalettes.length : 0;

    // Header: fixed 20 bytes + ground palette table + cliff palette header/table,
    // padded up to 2-byte alignment for the int16 arrays that follow.
    const headerFixed = 20;
    const paletteTableBytes = numPalettes * 4;
    const cliffHeaderBytes = 4 + numCliffPalettes * 4; // uint32 count + codes
    let headerBytes = headerFixed + paletteTableBytes + cliffHeaderBytes;
    if (headerBytes % 2 !== 0) headerBytes++; // align
    const arraysBytes = total * 12; // 2+2+1+1+3+1+1+1
    const buf = Buffer.alloc(headerBytes + arraysBytes);
    let p = 0;
    buf.writeUInt32LE(0x57334831, p); p += 4;  // magic 'W3H1'
    buf.writeUInt32LE(5, p); p += 4;           // version 5
    buf.writeUInt32LE(cols, p); p += 4;
    buf.writeUInt32LE(rows, p); p += 4;
    buf.writeUInt32LE(numPalettes, p); p += 4;
    // Ground palette codes (ASCII, 4 chars each, e.g. 'Lgrs')
    for (let i = 0; i < numPalettes; i++) {
      const code = terrainFile.tilePalettes[i] || '    ';
      buf.write(code.substring(0, 4).padEnd(4, ' '), p, 4, 'ascii');
      p += 4;
    }
    // Cliff palette codes (e.g. 'CLdi', 'CLgr')
    buf.writeUInt32LE(numCliffPalettes, p); p += 4;
    for (let i = 0; i < numCliffPalettes; i++) {
      const code = terrainFile.cliffPalettes[i] || '    ';
      buf.write(code.substring(0, 4).padEnd(4, ' '), p, 4, 'ascii');
      p += 4;
    }

    // per-array offsets (all after the header)
    const groundOff    = headerBytes;
    const waterOff     = groundOff + total * 2;
    const flagsOff     = waterOff  + total * 2;
    const layerOff     = flagsOff  + total * 1;
    const rgbOff       = layerOff  + total * 1;
    const palIdxOff    = rgbOff    + total * 3;
    const cliffTexOff  = palIdxOff + total * 1;
    const variationOff = cliffTexOff + total * 1;

    // Build palette RGB cache identical to drawBackgroundMap so colors match.
    const tilesetCode = terrainFile.tileset;
    const extras = TILESET_EXTRAS[tilesetCode] || DEFAULT_EXTRAS;
    const greenSuffixes = new Set([
      'grs', 'grd', 'grr', 'gsb', 'hdg', 'vin', 'drg', 'lvd', 'lvg',
      'crp', 'cbp', 'fst', 'fsl', 'lgb', 'grt', 'pos'
    ]);
    const paletteRgbCache = {};
    terrainFile.tilePalettes.forEach((code, idx) => {
      if (PALETTE_COLORS[code]) {
        paletteRgbCache[idx] = hexToRgb(PALETTE_COLORS[code]);
      } else {
        const fallback = getFallbackPaletteColor(code, code.substring(1));
        if (fallback) {
          paletteRgbCache[idx] = hexToRgb(fallback);
        } else {
          const suffix = code.substring(1);
          paletteRgbCache[idx] = hexToRgb(greenSuffixes.has(suffix) ? extras.ground : extras.accent);
        }
      }
    });

    let minLayer = Infinity, maxLayer = -Infinity;
    let hasWaterCount = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const t = terrainFile.tileGrid[r][c] || {};
        const gh = t.groundHeight != null ? t.groundHeight : 0x2000;
        const wl = t.waterLevel != null ? t.waterLevel : 0;
        const fl = t.flags != null ? t.flags : 0;
        const ly = t.layer != null ? t.layer : 2;
        buf.writeInt16LE(gh, groundOff + idx * 2);
        buf.writeInt16LE(wl, waterOff + idx * 2);
        buf.writeUInt8(fl & 0xFF, flagsOff + idx);
        buf.writeUInt8(ly & 0x0F, layerOff + idx);

        const palIdx = (t.paletteIndex != null && t.paletteIndex < numPalettes)
          ? t.paletteIndex
          : (t.paletteIndex != null ? t.paletteIndex % Math.max(1, numPalettes) : 0);
        const rgb = paletteRgbCache[palIdx] || [74, 104, 56];
        buf.writeUInt8(rgb[0], rgbOff + idx * 3 + 0);
        buf.writeUInt8(rgb[1], rgbOff + idx * 3 + 1);
        buf.writeUInt8(rgb[2], rgbOff + idx * 3 + 2);
        buf.writeUInt8(palIdx & 0xFF, palIdxOff + idx);

        const ct = t.cliffTexture != null ? t.cliffTexture : 0;
        buf.writeUInt8(ct & 0x0F, cliffTexOff + idx);
        const vr = t.variation != null ? t.variation : 0;
        buf.writeUInt8(vr & 0x0F, variationOff + idx);

        if (ly < minLayer) minLayer = ly;
        if (ly > maxLayer) maxLayer = ly;
        if (t.hasWater) hasWaterCount++;
      }
    }
    if (!isFinite(minLayer)) minLayer = 2;
    if (!isFinite(maxLayer)) maxLayer = 2;

    const heightsOutPath = `${clientMapDir}/heights.bin`;
    fs.writeFileSync(heightsOutPath, buf);
    const heightsGz = zlib.gzipSync(buf);
    fs.writeFileSync(`${heightsOutPath}.gz`, heightsGz);
    try { fs.unlinkSync(heightsOutPath); } catch (e) { /* ignore */ }
    const palList = terrainFile.tilePalettes.slice(0, numPalettes).join(',');
    const cliffPalList = terrainFile.cliffPalettes ? terrainFile.cliffPalettes.join(',') : '';
    console.log(`    wrote heights ${cols}x${rows} v5 (layers ${minLayer}..${maxLayer}, water tiles ${hasWaterCount}, palettes [${palList}], cliff palettes [${cliffPalList}])`);
  }

  // write neutralBuildings.json.gz for client
  if (neutralBuildings.length > 0) {
    const nbPath = `${clientMapDir}/neutralBuildings.json`;
    fs.writeFileSync(nbPath, JSON.stringify(neutralBuildings), 'utf-8');
    const gzipped = zlib.gzipSync(fs.readFileSync(nbPath));
    fs.writeFileSync(`${nbPath}.gz`, gzipped);
    try { fs.unlinkSync(nbPath); } catch (e) { /* ignore */ }
    console.log(`    wrote ${neutralBuildings.length} neutral buildings`);
  }

  return { tileset, themeName, info: output.info };
}

async function main() {
  const args = process.argv.slice(2);
  let targetMap = null;
  let dryRun = false;

  let skipExisting = false;

  args.forEach(arg => {
    if (arg.startsWith('--map=')) targetMap = arg.split('=')[1];
    if (arg === '--dry-run') dryRun = true;
    if (arg.startsWith('--terrain-size=')) terrainSize = parseInt(arg.split('=')[1], 10);
    if (arg.startsWith('--terrain-quality=')) terrainQuality = parseFloat(arg.split('=')[1]);
    // Only (re)generate maps that don't already have heights.bin.gz — used
    // after a bulk data-tool extraction to fill in just the new maps without
    // re-baking the already-good ones.
    if (arg === '--skip-existing') skipExisting = true;
  });

  let maps = targetMap
    ? [targetMap]
    : fs.readdirSync(MAPDATA_DIR).filter(f => {
        const stat = fs.statSync(`${MAPDATA_DIR}/${f}`);
        return stat.isDirectory();
      });

  if (skipExisting && !targetMap) {
    const before = maps.length;
    maps = maps.filter(m => !fs.existsSync(`${CLIENT_MAPS_DIR}/${m}/heights.bin.gz`));
    console.log(`--skip-existing: ${before - maps.length} already have heights.bin.gz, ${maps.length} to process`);
  }

  console.log(`\nRegenerating map images (${maps.length} maps)${dryRun ? ' [DRY RUN]' : ''}...\n`);

  const tilesetCounts = {};
  let success = 0;

  for (const mapName of maps) {
    try {
      const result = await regenMap(mapName, dryRun);
      if (result) {
        tilesetCounts[result.tileset] = (tilesetCounts[result.tileset] || 0) + 1;
        success++;
      }
    } catch (err) {
      console.log(`  FAIL ${mapName}: ${err.message}`);
    }
  }

  console.log(`\nDone: ${success}/${maps.length} maps processed`);
  console.log('\nTileset distribution:');
  Object.entries(tilesetCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([key, count]) => {
      console.log(`  ${key} (${TILESET_NAMES[key] || '?'}): ${count} maps`);
    });
}

main().catch(err => { console.error(err); process.exit(1); });
