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
const INFOFile = require("../lib/parsers/INFOFile");
const TERRAINFile = require("../lib/parsers/TERRAINFile");
const GameScaler = require("../client/js/GameScaler");

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

// tree/water/cliff colors by tileset (not in per-tile data)
const TILESET_EXTRAS = {
  'L': { water: '#051459', shallowwater: '#0A27A6', trees: '#0a5a08', treeStroke: '#706030', cliff: '#282818' },
  'V': { water: '#051459', shallowwater: '#0A27A6', trees: '#0a5a08', treeStroke: '#706030', cliff: '#282818' },
  'F': { water: '#051459', shallowwater: '#0A27A6', trees: '#3a5a10', treeStroke: '#6a4a20', cliff: '#282010' },
  'X': { water: '#051459', shallowwater: '#0A27A6', trees: '#3a5a10', treeStroke: '#6a4a20', cliff: '#282010' },
  'W': { water: '#051459', shallowwater: '#0A27A6', trees: '#2a5040', treeStroke: '#5a7068', cliff: '#303840' },
  'N': { water: '#051459', shallowwater: '#0A27A6', trees: '#285a40', treeStroke: '#5a7a68', cliff: '#303840' },
  'I': { water: '#0a2060', shallowwater: '#1a3878', trees: '#204838', treeStroke: '#506860', cliff: '#283040' },
  'A': { water: '#051459', shallowwater: '#0A27A6', trees: '#0a3518', treeStroke: '#3a5a30', cliff: '#181810' },
  'C': { water: '#051459', shallowwater: '#0A27A6', trees: '#1a3010', treeStroke: '#4a3a4a', cliff: '#181810' },
  'B': { water: '#051459', shallowwater: '#0A27A6', trees: '#4a6820', treeStroke: '#807030', cliff: '#302818' },
  'D': { water: '#051459', shallowwater: '#0A27A6', trees: '#2a3a2a', treeStroke: '#484848', cliff: '#181818' },
  'G': { water: '#051459', shallowwater: '#0A27A6', trees: '#203020', treeStroke: '#404040', cliff: '#101010' },
  'K': { water: '#051459', shallowwater: '#0A27A6', trees: '#2a3a2a', treeStroke: '#505058', cliff: '#202028' },
  'J': { water: '#051459', shallowwater: '#0A27A6', trees: '#2a3038', treeStroke: '#484858', cliff: '#181828' },
  'Y': { water: '#041848', shallowwater: '#0a2880', trees: '#0a3838', treeStroke: '#2a5858', cliff: '#101828' },
  'Z': { water: '#051459', shallowwater: '#0A27A6', trees: '#1a4020', treeStroke: '#4a5a3a', cliff: '#202018' },
  'Q': { water: '#051459', shallowwater: '#0A27A6', trees: '#385820', treeStroke: '#605020', cliff: '#201810' },
  'O': { water: '#051459', shallowwater: '#0A27A6', trees: '#3a4820', treeStroke: '#604020', cliff: '#201810' }
};

const DEFAULT_EXTRAS = { water: '#051459', shallowwater: '#0A27A6', trees: '#013f01', treeStroke: '#906739', cliff: '#181810' };

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

  // build a color lookup for this map's palettes (as RGB arrays for noise variation)
  const paletteColorCache = {};
  terrainFile.tilePalettes.forEach((code, idx) => {
    let color = PALETTE_COLORS[code];
    if (!color) {
      color = getFallbackColor(code, code.substring(1));
    }
    if (!color) {
      color = '#4a6838';
    }
    paletteColorCache[idx] = hexToRgb(color);
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

  // WPM is ~4x resolution of W3E terrain grid
  const wpmToTerrainX = tileGrid[0] ? (tileGrid[0].length / grid[0].length) : 1;
  const wpmToTerrainY = tileGrid.length ? (tileGrid.length / grid.length) : 1;

  let rCol = grid.length - 1;

  for (let col = 0; col < grid.length; col++) {
    for (let row = 0; row < grid[col].length; row++) {
      const data = grid[col][row];
      const { NoWater, NoWalk, NoFly, NoBuild, Blight } = data;
      const drawX = row * tileSize;
      const drawY = rCol * tileSize;

      // unwalkable + unflyable = boundary/cliff — use tileset cliff color with noise
      if (NoWalk && NoFly) {
        const noise = tileHash(col, row) * 0.3 - 0.15; // ±15% brightness
        const cr = Math.max(0, Math.min(255, Math.round(cliffRgb[0] * (1 + noise))));
        const cg = Math.max(0, Math.min(255, Math.round(cliffRgb[1] * (1 + noise))));
        const cb = Math.max(0, Math.min(255, Math.round(cliffRgb[2] * (1 + noise))));
        ctx.fillStyle = rgbToHex(cr, cg, cb);
        ctx.fillRect(drawX, drawY, tileSize, tileSize);
        continue;
      }

      // water tiles
      if (!NoWater && !NoBuild) {
        ctx.fillStyle = extras.water;
        ctx.fillRect(drawX, drawY, tileSize, tileSize);
        continue;
      }
      if (!NoWater && NoBuild) {
        ctx.fillStyle = extras.shallowwater;
        ctx.fillRect(drawX, drawY, tileSize, tileSize);
        continue;
      }

      // ground tiles: look up the W3E terrain palette for this position
      const terrainCol = Math.min(Math.floor(col * wpmToTerrainY), tileGrid.length - 1);
      const terrainRow = Math.min(Math.floor(row * wpmToTerrainX), tileGrid[0].length - 1);
      const terrainTile = tileGrid[terrainCol] ? tileGrid[terrainCol][terrainRow] : null;

      let rgb;
      if (terrainTile && paletteColorCache[terrainTile.paletteIndex]) {
        rgb = paletteColorCache[terrainTile.paletteIndex];
      } else {
        rgb = [74, 104, 56]; // fallback green
      }

      // apply subtle per-tile brightness noise (±12%) to break up flat blocks
      const noise = tileHash(col, row) * 0.24 - 0.12;
      const r = Math.max(0, Math.min(255, Math.round(rgb[0] * (1 + noise))));
      const g = Math.max(0, Math.min(255, Math.round(rgb[1] * (1 + noise))));
      const b = Math.max(0, Math.min(255, Math.round(rgb[2] * (1 + noise))));
      ctx.fillStyle = rgbToHex(r, g, b);
      ctx.fillRect(drawX, drawY, tileSize, tileSize);
    }
    rCol--;
  }

  dooGrid.forEach((item) => {
    const x = parseFloat(item.position.x);
    const y = parseFloat(item.position.y);
    const treeX = fullXScale(x) + fullMiddleX;
    const treeY = fullYScale(y) + fullMiddleY;
    const scaledSize = 10 * item.scale[0];
    ctx.fillStyle = extras.trees;
    ctx.fillRect(treeX, treeY, scaledSize, scaledSize);
  });

  return canvas;
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

  const canvas = drawBackgroundMap(output, wpm, doo, terrainFile);
  const buffer = canvas.toBuffer('image/png');

  if (!fs.existsSync(clientMapDir)) {
    fs.mkdirSync(clientMapDir, { recursive: true });
  }

  fs.writeFileSync(`${clientMapDir}/map.jpg`, buffer);
  fs.writeFileSync(`${clientMapDir}/gridmap.jpg`, buffer);

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
