/*
  Regenerate map images from already-extracted mapdata.
  Uses the same drawing logic as data-tool.js but skips MPQ extraction.

  Usage:
    node tools/regen-maps.js                    # all maps
    node tools/regen-maps.js --map=NorthernIsles  # single map
    node tools/regen-maps.js --dry-run          # just show tilesets
*/

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const WPMFile = require("../lib/parsers/WPMFile");
const DOOFile = require("../lib/parsers/DOOFile");
const UNITFile = require("../lib/parsers/UNITFile");
const INFOFile = require("../lib/parsers/INFOFile");
const TERRAINFile = require("../lib/parsers/TERRAINFile");
const GameScaler = require("../client/js/GameScaler");
const { getUnitInfo } = require("../helpers/mappings");

const { createCanvas } = require("canvas");
const d3 = require("d3");

const MAPDATA_DIR = "mapdata";
const CLIENT_MAPS_DIR = "client/maps";

const TILESET_NAMES = {
  'L': 'Lordaeron Summer', 'V': 'Village', 'F': 'Lordaeron Fall', 'X': 'Village Fall',
  'W': 'Lordaeron Winter', 'N': 'Northrend', 'I': 'Icecrown', 'A': 'Ashenvale',
  'C': 'Felwood', 'B': 'Barrens', 'D': 'Dungeon', 'G': 'Underground',
  'K': 'Cityscape', 'J': 'Dalaran Ruins', 'Y': 'Sunken Ruins',
  'Z': 'Ruins', 'Q': 'Dalaran', 'O': 'Outland', 'c': 'Custom/Mixed'
};

const { TILESET_EXTRAS, DEFAULT_EXTRAS, PALETTE_COLORS, getFallbackPaletteColor } = require('../helpers/tilesetColors');

// helper to parse hex color and apply brightness variation
function hexToRgb (hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function rgbToHex (r, g, b) {
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// simple seeded pseudo-random for deterministic tile noise
function tileHash (col, row) {
  let h = (col * 374761393 + row * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) & 0xFF) / 255.0;
}

function drawBackgroundMap(output, wpm, doo, terrainFile) {
  const gameScaler = new GameScaler();
  gameScaler.addDependency('_d3', d3);
  gameScaler.setup(output.info);

  const canvas = createCanvas(gameScaler.fullMapImage.width, gameScaler.fullMapImage.height);
  const ctx = canvas.getContext('2d');

  const { grid } = wpm;
  const dooGrid = doo.grid;
  const tileSize = gameScaler.pixelsPerTile;
  const tileGrid = terrainFile.tileGrid;
  const tileset = terrainFile.tileset;
  const extras = TILESET_EXTRAS[tileset] || DEFAULT_EXTRAS;

  // Per-palette colors: use actual PALETTE_COLORS when available,
  // fall back to tileset ground/accent based on suffix categorization
  const greenSuffixes = new Set([
    'grs', 'grd', 'grr', 'gsb', 'hdg', 'vin', 'drg', 'lvd', 'lvg',
    'crp', 'cbp', 'fst', 'fsl', 'lgb', 'grt', 'pos'
  ]);

  const paletteColorCache = {};
  terrainFile.tilePalettes.forEach((code, idx) => {
    if (PALETTE_COLORS[code]) {
      paletteColorCache[idx] = hexToRgb(PALETTE_COLORS[code]);
    } else {
      const fallback = getFallbackPaletteColor(code, code.substring(1));
      if (fallback) {
        paletteColorCache[idx] = hexToRgb(fallback);
      } else {
        const suffix = code.substring(1);
        const isVegetation = greenSuffixes.has(suffix);
        paletteColorCache[idx] = hexToRgb(isVegetation ? extras.ground : extras.accent);
      }
    }
  });

  const cliffRgb = hexToRgb(extras.cliff || '#181810');

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, gameScaler.fullMapImage.width, gameScaler.fullMapImage.height);

  const fullMiddleX = gameScaler.fullMapImage.width / 2;
  const fullMiddleY = gameScaler.fullMapImage.height / 2;
  const fullXScale = d3.scaleLinear()
    .domain(gameScaler.mapExtent.x)
    .range([-(fullMiddleX), fullMiddleX]);
  const fullYScale = d3.scaleLinear()
    .domain(gameScaler.mapExtent.y)
    .range([-(fullMiddleY), fullMiddleY]);

  // --- Pass 1: Paint ground from W3E terrain grid with sub-tile noise ---
  const terrainRows = tileGrid.length;
  const terrainCols = tileGrid[0] ? tileGrid[0].length : 0;
  const terrainCellRows = terrainRows - 1;
  const terrainCellCols = terrainCols - 1;
  const wpmRows = grid.length;
  const wpmCols = grid[0] ? grid[0].length : 0;
  const terrainBlockW = (wpmCols * tileSize) / terrainCellCols;
  const terrainBlockH = (wpmRows * tileSize) / terrainCellRows;

  // Boundary margins
  const margins = output.info.gridSize.margins;
  const { playable, full } = output.info.gridSize;
  const marginBottom = margins ? margins[2] : Math.floor((full[1] - playable[1]) / 2);
  const marginTop = margins ? margins[3] : Math.ceil((full[1] - playable[1]) / 2);
  const marginLeft = margins ? margins[0] : Math.floor((full[0] - playable[0]) / 2);
  const marginRight = margins ? margins[1] : Math.ceil((full[0] - playable[0]) / 2);

  // sub-block size for intra-tile noise (4x4 sub-blocks per terrain cell)
  const subBlockW = Math.max(1, Math.floor(terrainBlockW / 4));
  const subBlockH = Math.max(1, Math.floor(terrainBlockH / 4));

  for (let row = 0; row < terrainCellRows; row++) {
    if (row < marginBottom || row >= terrainCellRows - marginTop) continue;
    const drawY = (terrainCellRows - 1 - row) * terrainBlockH;
    for (let col = 0; col < terrainCellCols; col++) {
      if (col < marginLeft || col >= terrainCellCols - marginRight) continue;
      const tile = tileGrid[row][col];
      const effectiveIdx = tile ? (tile.paletteIndex < terrainFile.tilePalettes.length
        ? tile.paletteIndex : tile.paletteIndex % terrainFile.tilePalettes.length) : 0;
      const rgb = paletteColorCache[effectiveIdx] || [74, 104, 56];
      const baseX = col * terrainBlockW;

      // paint sub-blocks with noise variation
      for (let sy = 0; sy < terrainBlockH; sy += subBlockH) {
        for (let sx = 0; sx < terrainBlockW; sx += subBlockW) {
          const noise = tileHash(col * 4 + Math.floor(sx / subBlockW), row * 4 + Math.floor(sy / subBlockH));
          const factor = 1 + (noise * 0.16 - 0.08);
          const nr = Math.max(0, Math.min(255, Math.round(rgb[0] * factor)));
          const ng = Math.max(0, Math.min(255, Math.round(rgb[1] * factor)));
          const nb = Math.max(0, Math.min(255, Math.round(rgb[2] * factor)));
          ctx.fillStyle = rgbToHex(nr, ng, nb);
          ctx.fillRect(baseX + sx, drawY + sy, subBlockW + 0.5, subBlockH + 0.5);
        }
      }
    }
  }

  // --- Pass 1.5: Edge blending between different terrain types ---
  for (let row = marginBottom; row < terrainCellRows - marginTop; row++) {
    const drawY = (terrainCellRows - 1 - row) * terrainBlockH;
    for (let col = marginLeft; col < terrainCellCols - marginRight; col++) {
      const tile = tileGrid[row][col];
      const myIdx = tile ? (tile.paletteIndex < terrainFile.tilePalettes.length
        ? tile.paletteIndex : tile.paletteIndex % terrainFile.tilePalettes.length) : 0;
      const myRgb = paletteColorCache[myIdx] || [74, 104, 56];
      const baseX = col * terrainBlockW;
      const blendW = Math.max(1, Math.round(terrainBlockW * 0.15));
      const blendH = Math.max(1, Math.round(terrainBlockH * 0.15));

      // blend right edge
      if (col + 1 < terrainCellCols - marginRight) {
        const rightTile = tileGrid[row][col + 1];
        const rightIdx = rightTile ? (rightTile.paletteIndex < terrainFile.tilePalettes.length
          ? rightTile.paletteIndex : rightTile.paletteIndex % terrainFile.tilePalettes.length) : 0;
        if (rightIdx !== myIdx) {
          const rightRgb = paletteColorCache[rightIdx] || [74, 104, 56];
          for (let sy = 0; sy < terrainBlockH; sy += 2) {
            const n = tileHash(col * 100 + sy, row * 100);
            const mixR = Math.max(0, Math.min(255, Math.round((myRgb[0] + rightRgb[0]) / 2 + (n * 10 - 5))));
            const mixG = Math.max(0, Math.min(255, Math.round((myRgb[1] + rightRgb[1]) / 2 + (n * 10 - 5))));
            const mixB = Math.max(0, Math.min(255, Math.round((myRgb[2] + rightRgb[2]) / 2 + (n * 10 - 5))));
            ctx.fillStyle = rgbToHex(mixR, mixG, mixB);
            ctx.fillRect(baseX + terrainBlockW - blendW, drawY + sy, blendW * 2, 2);
          }
        }
      }

      // blend bottom edge (visually — W3E row+1 is above in draw coords)
      if (row + 1 < terrainCellRows - marginTop) {
        const belowTile = tileGrid[row + 1][col];
        const belowIdx = belowTile ? (belowTile.paletteIndex < terrainFile.tilePalettes.length
          ? belowTile.paletteIndex : belowTile.paletteIndex % terrainFile.tilePalettes.length) : 0;
        if (belowIdx !== myIdx) {
          const belowRgb = paletteColorCache[belowIdx] || [74, 104, 56];
          for (let sx = 0; sx < terrainBlockW; sx += 2) {
            const n = tileHash(row * 100 + sx, col * 100);
            const mixR = Math.max(0, Math.min(255, Math.round((myRgb[0] + belowRgb[0]) / 2 + (n * 10 - 5))));
            const mixG = Math.max(0, Math.min(255, Math.round((myRgb[1] + belowRgb[1]) / 2 + (n * 10 - 5))));
            const mixB = Math.max(0, Math.min(255, Math.round((myRgb[2] + belowRgb[2]) / 2 + (n * 10 - 5))));
            ctx.fillStyle = rgbToHex(mixR, mixG, mixB);
            ctx.fillRect(baseX + sx, drawY - blendH, 2, blendH * 2);
          }
        }
      }
    }
  }

  // --- Pass 2: Water depth + cliffs using W3E height data + WPM flags ---
  // Build a water-depth map from W3E terrain heights.
  // Each W3E tile maps to ~4x4 WPM tiles; we interpolate depth at WPM resolution.
  const waterRgb = hexToRgb(extras.water);
  const shallowRgb = hexToRgb(extras.shallowwater);
  // shore color: blend between ground and shallow water for the beach/transition zone
  const groundRgb = hexToRgb(extras.ground);
  const shoreRgb = [
    Math.round((groundRgb[0] + shallowRgb[0]) / 2),
    Math.round((groundRgb[1] + shallowRgb[1]) / 2),
    Math.round((groundRgb[2] + shallowRgb[2]) / 2)
  ];

  // compute water depth at each W3E vertex: depth = waterLevel - groundHeight
  // positive depth = underwater, 0 or negative = above water
  let minDepth = Infinity, maxDepth = -Infinity;
  const depthGrid = [];
  for (let row = 0; row < terrainRows; row++) {
    const depthRow = [];
    for (let col = 0; col < terrainCols; col++) {
      const tile = tileGrid[row][col];
      if (tile && tile.waterLevel != null && tile.groundHeight != null) {
        const depth = tile.waterLevel - tile.groundHeight;
        depthRow.push(depth);
        if (depth > 0) {
          if (depth < minDepth) minDepth = depth;
          if (depth > maxDepth) maxDepth = depth;
        }
      } else {
        depthRow.push(0);
      }
    }
    depthGrid.push(depthRow);
  }
  const depthRange = maxDepth > minDepth ? maxDepth - minDepth : 1;

  // bilinear interpolation of depth at a fractional W3E position
  function sampleDepth (fRow, fCol) {
    const r0 = Math.floor(fRow), c0 = Math.floor(fCol);
    const r1 = Math.min(r0 + 1, terrainRows - 1), c1 = Math.min(c0 + 1, terrainCols - 1);
    const fr = fRow - r0, fc = fCol - c0;
    const d00 = depthGrid[r0] ? (depthGrid[r0][c0] || 0) : 0;
    const d01 = depthGrid[r0] ? (depthGrid[r0][c1] || 0) : 0;
    const d10 = depthGrid[r1] ? (depthGrid[r1][c0] || 0) : 0;
    const d11 = depthGrid[r1] ? (depthGrid[r1][c1] || 0) : 0;
    return d00 * (1 - fr) * (1 - fc) + d01 * (1 - fr) * fc + d10 * fr * (1 - fc) + d11 * fr * fc;
  }

  // count how many of 8 neighbors are water for shoreline detection
  function countWaterNeighbors (wpmCol, wpmRow) {
    let water = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = wpmCol + dr, c = wpmRow + dc;
        if (r >= 0 && r < wpmRows && c >= 0 && c < wpmCols) {
          if (!grid[r][c].NoWater) water++;
        }
      }
    }
    return water;
  }

  let rCol = wpmRows - 1;

  for (let col = 0; col < wpmRows; col++) {
    for (let row = 0; row < wpmCols; row++) {
      const data = grid[col][row];
      const { NoWater, NoWalk, NoFly } = data;
      const drawX = row * tileSize;
      const drawY = rCol * tileSize;

      if (NoWalk && NoFly) {
        // cliffs
        const noise = tileHash(col, row) * 0.24 - 0.12;
        const cr = Math.max(0, Math.min(255, Math.round(cliffRgb[0] * (1 + noise))));
        const cg = Math.max(0, Math.min(255, Math.round(cliffRgb[1] * (1 + noise))));
        const cb = Math.max(0, Math.min(255, Math.round(cliffRgb[2] * (1 + noise))));
        ctx.fillStyle = rgbToHex(cr, cg, cb);
        ctx.fillRect(drawX, drawY, tileSize, tileSize);
      } else if (!NoWater) {
        // water tile — use depth-based color gradient
        // map WPM coords to W3E fractional position for depth lookup
        const terrainFRow = (col / wpmRows) * terrainCellRows;
        const terrainFCol = (row / wpmCols) * terrainCellCols;
        const depth = sampleDepth(terrainFRow, terrainFCol);

        // normalize depth to 0..1 range
        const depthNorm = depth > 0 ? Math.min(1, (depth - minDepth) / depthRange) : 0;

        // 4-stop gradient: shore → shallow → medium → deep
        let r, g, b;
        const noise = tileHash(col * 3, row * 3) * 0.08 - 0.04;

        if (depthNorm < 0.15) {
          // shore/very shallow — blend shore to shallow
          const t = depthNorm / 0.15;
          r = Math.round(shoreRgb[0] * (1 - t) + shallowRgb[0] * t);
          g = Math.round(shoreRgb[1] * (1 - t) + shallowRgb[1] * t);
          b = Math.round(shoreRgb[2] * (1 - t) + shallowRgb[2] * t);
        } else if (depthNorm < 0.5) {
          // shallow to medium
          const t = (depthNorm - 0.15) / 0.35;
          r = Math.round(shallowRgb[0] * (1 - t) + waterRgb[0] * t);
          g = Math.round(shallowRgb[1] * (1 - t) + waterRgb[1] * t);
          b = Math.round(shallowRgb[2] * (1 - t) + waterRgb[2] * t);
        } else {
          // medium to deep — darken further
          const t = (depthNorm - 0.5) / 0.5;
          r = Math.round(waterRgb[0] * (1 - t * 0.3));
          g = Math.round(waterRgb[1] * (1 - t * 0.3));
          b = Math.round(waterRgb[2] * (1 - t * 0.3));
        }

        r = Math.max(0, Math.min(255, Math.round(r * (1 + noise))));
        g = Math.max(0, Math.min(255, Math.round(g * (1 + noise))));
        b = Math.max(0, Math.min(255, Math.round(b * (1 + noise))));
        ctx.fillStyle = rgbToHex(r, g, b);
        ctx.fillRect(drawX, drawY, tileSize, tileSize);
      } else if (NoWater) {
        // ground tile — check if near water for shoreline blending
        const waterNeighbors = countWaterNeighbors(col, row);
        if (waterNeighbors > 0) {
          // shoreline fringe: partially tint toward shore color
          const fringeT = Math.min(1, waterNeighbors / 6);
          const noise = tileHash(col * 7, row * 7) * 0.1 - 0.05;
          // read existing ground color from canvas and blend toward shore
          ctx.globalAlpha = fringeT * 0.35;
          const sr = Math.max(0, Math.min(255, Math.round(shoreRgb[0] * (1 + noise))));
          const sg = Math.max(0, Math.min(255, Math.round(shoreRgb[1] * (1 + noise))));
          const sb = Math.max(0, Math.min(255, Math.round(shoreRgb[2] * (1 + noise))));
          ctx.fillStyle = rgbToHex(sr, sg, sb);
          ctx.fillRect(drawX, drawY, tileSize, tileSize);
          ctx.globalAlpha = 1.0;
        }
      }
    }
    rCol--;
  }

  // Trees are rendered separately on the client from doo.json data,
  // allowing per-building tree clearing in the base viewer.

  return { canvas, fullXScale, fullYScale, fullMiddleX, fullMiddleY };
}

function drawNeutralBuildingsOnMap (ctx, neutralBuildings, fullXScale, fullYScale, fullMiddleX, fullMiddleY) {
  neutralBuildings.forEach(nb => {
    const drawX = fullXScale(nb.x) + fullMiddleX;
    const drawY = fullYScale(nb.y) + fullMiddleY;

    if (nb.type === 'ngol') {
      // gold mine: yellow diamond
      ctx.fillStyle = '#d4a017';
      ctx.strokeStyle = '#8a6a10';
      ctx.lineWidth = 1.5;
      const size = 8;
      ctx.beginPath();
      ctx.moveTo(drawX, drawY - size);
      ctx.lineTo(drawX + size, drawY);
      ctx.lineTo(drawX, drawY + size);
      ctx.lineTo(drawX - size, drawY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  });
}

function regenMap(mapName, dryRun) {
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
  const doo = new DOOFile(`${mapDataDir}/war3map.doo`);

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

  const wpm = new WPMFile(`${mapDataDir}/war3map.wpm`, output.info);

  const extras = TILESET_EXTRAS[tileset] || DEFAULT_EXTRAS;
  output.info.tileset = tileset;
  output.info.treeColor = extras.trees;
  output.info.treeStroke = extras.treeStroke;

  const { canvas, fullXScale, fullYScale, fullMiddleX, fullMiddleY } = drawBackgroundMap(output, wpm, doo, terrainFile);
  const ctx = canvas.getContext('2d');

  // extract and draw neutral buildings if war3mapUnits.doo exists
  let neutralBuildings = [];
  const unitFilePath = `${mapDataDir}/war3mapUnits.doo`;
  if (fs.existsSync(unitFilePath)) {
    try {
      const unitFile = new UNITFile(unitFilePath);
      if (unitFile.units) {
        unitFile.units.forEach(rawUnit => {
          const info = getUnitInfo(rawUnit.type);
          if (info.isGoldmine || info.isFountain || info.isInteractiveShop) {
            const entry = { type: rawUnit.type, x: rawUnit.position[0], y: rawUnit.position[1] };
            if (info.isGoldmine && rawUnit.gold > 0) entry.gold = rawUnit.gold;
            neutralBuildings.push(entry);
          }
        });
      }
    } catch (err) {
      console.log(`    warning: could not parse war3mapUnits.doo: ${err.message}`);
    }
  }

  if (neutralBuildings.length > 0) {
    drawNeutralBuildingsOnMap(ctx, neutralBuildings, fullXScale, fullYScale, fullMiddleX, fullMiddleY);
  }

  const buffer = canvas.toBuffer('image/jpeg', { quality: 0.75 });

  if (!fs.existsSync(clientMapDir)) {
    fs.mkdirSync(clientMapDir, { recursive: true });
  }

  fs.writeFileSync(`${clientMapDir}/map.jpg`, buffer);
  fs.writeFileSync(`${clientMapDir}/gridmap.jpg`, buffer);

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

function main() {
  const args = process.argv.slice(2);
  let targetMap = null;
  let dryRun = false;

  args.forEach(arg => {
    if (arg.startsWith('--map=')) targetMap = arg.split('=')[1];
    if (arg === '--dry-run') dryRun = true;
  });

  const maps = targetMap
    ? [targetMap]
    : fs.readdirSync(MAPDATA_DIR).filter(f => {
        const stat = fs.statSync(`${MAPDATA_DIR}/${f}`);
        return stat.isDirectory();
      });

  console.log(`\nRegenerating map images (${maps.length} maps)${dryRun ? ' [DRY RUN]' : ''}...\n`);

  const tilesetCounts = {};
  let success = 0;

  maps.forEach(mapName => {
    try {
      const result = regenMap(mapName, dryRun);
      if (result) {
        tilesetCounts[result.tileset] = (tilesetCounts[result.tileset] || 0) + 1;
        success++;
      }
    } catch (err) {
      console.log(`  FAIL ${mapName}: ${err.message}`);
    }
  });

  console.log(`\nDone: ${success}/${maps.length} maps processed`);
  console.log('\nTileset distribution:');
  Object.entries(tilesetCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([key, count]) => {
      console.log(`  ${key} (${TILESET_NAMES[key] || '?'}): ${count} maps`);
    });
}

main();
