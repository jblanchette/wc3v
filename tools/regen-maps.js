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

//
// per-palette-code color mapping
// key: 4-char palette code (e.g., "Ldrt") → hex color
// suffix meanings: drt=dirt, grs=grass, rck/rok=rock, drg=dark grass,
//   dro=dark rock, grd=ground, snw=snow, ice=ice, vin=vines,
//   san=sand, btl=brick tile, gsb=grass blend, etc.
//

const PALETTE_COLORS = {
  // Lordaeron Summer (L)
  Ldrt: '#9a8050', Ldro: '#7a6848', Ldrg: '#558030', Lrok: '#707060',
  Lgrs: '#348020', Lgrd: '#6a8838',

  // Village (V)
  Vdrt: '#9a8858', Vdrr: '#8a7850', Vcrp: '#6a8838', Vcbp: '#588030',
  Vstp: '#8a8a70', Vgrs: '#389028', Vrck: '#787868', Vgrt: '#6a8838',

  // Lordaeron Fall (F)
  Fdrt: '#8a7838', Fdro: '#7a6830', Fdrg: '#687828', Frok: '#787058',
  Fgrs: '#687828', Fgrd: '#788030',

  // Village Fall (X)
  Xdrt: '#8a7838', Xdtr: '#7a6830', Xblm: '#685848', Xbtl: '#787058',
  Xsqd: '#8a8068', Xrtl: '#786050', Xgsb: '#6a7830', Xhdg: '#587028',
  Xwmb: '#7a6848',

  // Lordaeron Winter (W)
  Wdrt: '#98a0a8', Wdro: '#889098', Wsng: '#c8d0d8', Wrok: '#788088',
  Wgrs: '#a8b8c0', Wsnw: '#d8e0e8',

  // Northrend (N)
  Ndrt: '#98a0a0', Ndrd: '#889090', Nrck: '#788080', Ngrs: '#98b0b0',
  Nice: '#b8d0e0', Nsnw: '#d0e0e8', Nsnr: '#c0d0d8',

  // Icecrown (I)
  Idrt: '#90a0a8', Idtr: '#8098a8', Idki: '#587080', Iice: '#b0c8d8',
  Isnw: '#c8d8e0', Ibkb: '#506070', Irbk: '#587078', Itbk: '#607880',
  Ibsq: '#687888',

  // Ashenvale (A)
  Adrt: '#405838', Adrd: '#304830', Agrs: '#1e5830', Arck: '#505848',
  Agrd: '#406838', Avin: '#204828', Adrg: '#204820', Alvd: '#305830',

  // Felwood (C)
  Cdrt: '#404830', Cdrd: '#303828', Cgrs: '#304820', Cpos: '#402838',
  Cvin: '#204020', Clvg: '#304820',

  // Barrens (B)
  Bdrt: '#a09058', Bdrh: '#908048', Bdrr: '#988850', Bdrg: '#788038',
  Bdsr: '#b0a070', Bdsd: '#a89868', Bflr: '#806830', Bgrr: '#8a8848',

  // Dungeon (D)
  Ddrt: '#484848', Dgrs: '#384838',

  // Underground (G)
  Gbrk: '#484840',

  // Cityscape (K)
  Ksmb: '#686878',

  // Dalaran Ruins (J)
  Jdrt: '#585070', Jdtr: '#504868', Jblm: '#484060', Jbtl: '#605878',
  Jsqd: '#686080', Jrtl: '#585070', Jgsb: '#485848', Jhdg: '#385030',
  Jwmb: '#605070',

  // Sunken Ruins (Y)
  Ydrt: '#386068', Ydtr: '#305860', Yblm: '#284850', Ybtl: '#385858',
  Ysqd: '#406068', Yrtl: '#385860', Ygsb: '#285840', Yhdg: '#284838',
  Ywmb: '#385058',

  // Ruins (Z)
  Zdrt: '#586848', Zdtr: '#485840', Zdrg: '#486038', Zbks: '#686850',
  Zsan: '#9a9068', Zbkl: '#585848', Ztil: '#686858', Zgrs: '#486848',
  Zvin: '#385830',

  // Dalaran (Q) — warm autumn-toned, not purple
  Qdrt: '#807050', Qdrr: '#706040', Qcrp: '#685848', Qcbp: '#586840',
  Qstp: '#787868', Qgrs: '#588040', Qrck: '#686858', Qgrt: '#688040',

  // Outland (O)
  Odrt: '#684030', Odtr: '#583828', Osmb: '#584038', Ofst: '#485028',
  Olgb: '#586830', Ofsl: '#384020', Oaby: '#382828', Orok: '#585048'
};

// fallback: derive a reasonable color from palette prefix when exact code not found
function getFallbackColor (palette, suffix) {
  // try same suffix from a known prefix
  const knownPrefixes = ['L', 'W', 'A', 'B', 'J', 'Y', 'Z', 'Q', 'F', 'X', 'V', 'N', 'I', 'C', 'O'];
  for (const p of knownPrefixes) {
    const key = p + suffix;
    if (PALETTE_COLORS[key]) return PALETTE_COLORS[key];
  }
  return null;
}

const TILESET_NAMES = {
  'L': 'Lordaeron Summer', 'V': 'Village', 'F': 'Lordaeron Fall', 'X': 'Village Fall',
  'W': 'Lordaeron Winter', 'N': 'Northrend', 'I': 'Icecrown', 'A': 'Ashenvale',
  'C': 'Felwood', 'B': 'Barrens', 'D': 'Dungeon', 'G': 'Underground',
  'K': 'Cityscape', 'J': 'Dalaran Ruins', 'Y': 'Sunken Ruins',
  'Z': 'Ruins', 'Q': 'Dalaran', 'O': 'Outland', 'c': 'Custom/Mixed'
};

// Per-tileset minimap colors tuned to match WC3's actual minimap feel
// ground = grass/vegetation, accent = dirt/rock/paths, water varies by theme
const { TILESET_EXTRAS, DEFAULT_EXTRAS } = require('../helpers/tilesetColors');

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

  // Simplified ground colors: each palette code maps to either
  // the tileset's primary ground or accent color for clean, solid regions.
  // Suffix categorization: grs/grd/grr/gsb/hdg/vin/drg/lvd/lvg/crp/cbp/fst/fsl/lgb = green/vegetated
  // Everything else (drt/dro/drr/rok/rck/san/btl/sqd/blm/etc.) = accent/path
  const greenSuffixes = new Set([
    'grs', 'grd', 'grr', 'gsb', 'hdg', 'vin', 'drg', 'lvd', 'lvg',
    'crp', 'cbp', 'fst', 'fsl', 'lgb', 'grt', 'pos'
  ]);

  const paletteColorCache = {};
  terrainFile.tilePalettes.forEach((code, idx) => {
    const suffix = code.substring(1);
    const isVegetation = greenSuffixes.has(suffix);
    paletteColorCache[idx] = hexToRgb(isVegetation ? extras.ground : extras.accent);
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

  // --- Pass 1: Paint ground from W3E terrain grid (coarse, solid color blocks) ---
  // Each W3E tile covers ~4x4 WPM tiles, so blocks are 4*tileSize pixels = solid regions
  const terrainRows = tileGrid.length;      // height+1 vertices
  const terrainCols = tileGrid[0] ? tileGrid[0].length : 0;  // width+1 vertices
  const terrainCellRows = terrainRows - 1;  // actual cell count
  const terrainCellCols = terrainCols - 1;
  const wpmRows = grid.length;
  const wpmCols = grid[0] ? grid[0].length : 0;
  const terrainBlockW = (wpmCols * tileSize) / terrainCellCols;
  const terrainBlockH = (wpmRows * tileSize) / terrainCellRows;

  // Boundary margins: skip painting terrain for tiles outside the playable area
  // W3E rows are bottom-to-top (row 0 = bottom), margins are [left, right, bottom, top]
  const margins = output.info.gridSize.margins;
  const { playable, full } = output.info.gridSize;
  const marginBottom = margins ? margins[2] : Math.floor((full[1] - playable[1]) / 2);
  const marginTop = margins ? margins[3] : Math.ceil((full[1] - playable[1]) / 2);
  const marginLeft = margins ? margins[0] : Math.floor((full[0] - playable[0]) / 2);
  const marginRight = margins ? margins[1] : Math.ceil((full[0] - playable[0]) / 2);

  for (let row = 0; row < terrainCellRows; row++) {
    // Skip boundary rows (W3E row 0 = bottom, so marginBottom skips first rows)
    if (row < marginBottom || row >= terrainCellRows - marginTop) continue;
    const drawY = (terrainCellRows - 1 - row) * terrainBlockH;
    for (let col = 0; col < terrainCellCols; col++) {
      if (col < marginLeft || col >= terrainCellCols - marginRight) continue;
      const tile = tileGrid[row][col];
      const rgb = (tile && paletteColorCache[tile.paletteIndex]) || [74, 104, 56];
      ctx.fillStyle = rgbToHex(rgb[0], rgb[1], rgb[2]);
      ctx.fillRect(col * terrainBlockW, drawY, terrainBlockW + 0.5, terrainBlockH + 0.5);
    }
  }

  // --- Pass 2: Overlay water + cliffs from WPM (finer resolution) ---
  let rCol = wpmRows - 1;

  for (let col = 0; col < wpmRows; col++) {
    for (let row = 0; row < wpmCols; row++) {
      const data = grid[col][row];
      const { NoWater, NoWalk, NoFly, NoBuild } = data;
      const drawX = row * tileSize;
      const drawY = rCol * tileSize;

      if (NoWalk && NoFly) {
        const noise = tileHash(col, row) * 0.2 - 0.1;
        const cr = Math.max(0, Math.min(255, Math.round(cliffRgb[0] * (1 + noise))));
        const cg = Math.max(0, Math.min(255, Math.round(cliffRgb[1] * (1 + noise))));
        const cb = Math.max(0, Math.min(255, Math.round(cliffRgb[2] * (1 + noise))));
        ctx.fillStyle = rgbToHex(cr, cg, cb);
        ctx.fillRect(drawX, drawY, tileSize, tileSize);
      } else if (!NoWater && NoWalk) {
        // deep water: has water + can't walk
        ctx.fillStyle = extras.water;
        ctx.fillRect(drawX, drawY, tileSize, tileSize);
      } else if (!NoWater && !NoWalk) {
        // shallow/buildable water: has water but CAN walk (beach/shore)
        ctx.fillStyle = extras.shallowwater;
        ctx.fillRect(drawX, drawY, tileSize, tileSize);
      }
      // walkable ground: terrain already painted in pass 1
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

  const buffer = canvas.toBuffer('image/png');

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
