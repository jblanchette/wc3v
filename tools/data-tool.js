/*
  Data tool for the automatic extraction of needed information for wc3v to parse maps.

  Focused on supporting all of the maps in a given W3Champions folder.
*/


const fs = require('fs');
const os = require("os");
const path = require("path");
const zlib = require('zlib');

const WPMFile = require("../lib/parsers/WPMFile"),
      DOOFile = require("../lib/parsers/DOOFile"),
      UNITFile = require("../lib/parsers/UNITFile"),
      LISTFile = require("../lib/parsers/LISTFile"),
      LUAJASSFile = require("../lib/parsers/LUAJASSFile"),
      INFOFile = require("../lib/parsers/INFOFile"),
      TERRAINFile = require("../lib/parsers/TERRAINFile");

const mappings = require("../helpers/mappings.js");
const { getUnitInfo } = mappings;

const sjs = require('@wowserhq/stormjs');
const { FS, MPQ } = sjs;

const war3model = require('war3-model');
const { decodeBLP, getBLPImageData } = war3model;

const GameScaler = require("../client/js/GameScaler");

const { createCanvas } = require("canvas");

const d3 = require("d3");
const rbush = require("rbush");

//
// constants
//

const MAP_OUTPUT_DIR = path.join(__dirname, '..', 'mapdata');

const CLIENT_OUTPUT_DIR = path.join(__dirname, '..', 'client', 'maps');

const CLIENT_GAMEDATA_DIR = path.join(__dirname, '..', 'client', 'js');

//
// tileset color themes
// keyed by first character of W3E tile palette codes
//


//
// per-palette-code color mapping (W3E ground texture codes → hex colors)
//

const { TILESET_EXTRAS, DEFAULT_EXTRAS, PALETTE_COLORS, getFallbackPaletteColor } = require('../helpers/tilesetColors');

function hexToRgb (hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function rgbToHex (r, g, b) {
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function tileHash (col, row) {
  let h = (col * 374761393 + row * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) & 0xFF) / 255.0;
}

//
// main entry code
//

async function main() {
  // parse CLI args
  const args = process.argv.slice(2);
  let version = 'v11';
  let sourcePath = null;
  let listOnly = false;
  let mapPrefix = 'w3c_';

  args.forEach(arg => {
    if (arg.startsWith('--version=')) version = arg.split('=')[1];
    if (arg.startsWith('--source=')) sourcePath = arg.split('=')[1];
    if (arg === '--list') listOnly = true;
    if (arg.startsWith('--prefix=')) mapPrefix = arg.split('=')[1];
  });

  FS.mkdir('/stormjs');

  const homedir = require('os').homedir();

  // support custom source path or default W3Champions path
  const mapDirectoryPathPosix = sourcePath
    ? path.relative(process.cwd(), sourcePath).replace(/\\/g, '/')
    : `../../../Documents/Warcraft III/Maps/W3Champions/${version}`;

  console.log(`Map source: ${mapDirectoryPathPosix}`);
  console.log(`Map prefix: "${mapPrefix}" (strip from filename for map name)`);

  // mount our map folder to stormjs
  FS.mount(FS.filesystems.NODEFS, { root: mapDirectoryPathPosix }, '/stormjs');

  // read all the maps in
  const maps = FS.readdir('./stormjs').filter(m => m !== '.' && m !== '..' && m.endsWith('.w3x'));

  if (listOnly) {
    console.log(`\nFound ${maps.length} maps:`);
    maps.forEach((map, i) => {
      const name = normalizeW3xFilename(map);
      console.log(`  ${i + 1}. ${name} (${map})`);
    });
    return;
  }

  for (let i = 0; i < maps.length; i++) {
    const map = maps[i];

    try {
      console.log(`reading map: ${map} (${(i+1)}/${maps.length})`);
      await readMapFile(map, mapPrefix);
    } catch (err) {
      console.log("failed on map: ", map);
      console.log(err);
    }
  }

  console.log("finished data extraction");
};

/**
 * Normalize a W3C .w3x filename to a clean map name for output directory.
 * Handles multiple naming patterns:
 *   Old:  {num}_w3c_{date}_{time}_{MapName}.w3x  → MapName
 *   New:  1v1_{MapName}_{ver}_w3c_{date}_{time}_{hash}.w3x  → MapName_{ver}
 *   S13:  w3c_s13_{MapName}.w3x  → MapName
 *   S13x: w3c_s13.1_{MapName}.w3x  → MapName
 *   Plain: w3c_{MapName}.w3x  → MapName
 */
function normalizeW3xFilename(filename) {
  let name = filename.replace(/\.w3x$/i, '');

  // Pattern: 1v1_{MapName}_{ver}_w3c_{date}_{time}_{hash}
  const newPattern = name.match(/^1v1_(.+?)_w3c_\d+_\d+_\d+$/);
  if (newPattern) return newPattern[1];

  // Pattern: {num}_w3c_{date}_{time}_{MapName}
  const oldPattern = name.match(/^\d+_w3c_\d+_\d+_(.+)$/);
  if (oldPattern) return oldPattern[1];

  // Pattern: w3c_s13.x_{MapName} or w3c_s13_{MapName}
  const s13Pattern = name.match(/^w3c_s\d+(?:\.\d+)?_(.+)$/);
  if (s13Pattern) return s13Pattern[1];

  // Pattern: w3c_{MapName}
  if (name.startsWith('w3c_')) return name.substring(4);

  return name;
}

async function readMapFile(mapFilePath, mapPrefix = 'w3c_') {
  const mpq = await MPQ.open(`/stormjs/${mapFilePath}`, 'r');

  const normalizedMapName = normalizeW3xFilename(mapFilePath);

  // make our map output directory if we need to
  const outputDirectory = path.join(MAP_OUTPUT_DIR, normalizedMapName);

  if (!fs.existsSync(outputDirectory)){
    console.log("making map output directory: ", outputDirectory);
    fs.mkdirSync(outputDirectory);
  }

  // all maps must have these files
  const extractedFiles = [
    '(listfile)', 
    'war3map.w3i', 
    'war3map.doo', 
    'war3map.wpm', 
    'war3mapUnits.doo',
    'war3map.w3e',
    'war3mapMap.blp'
  ];

  // maps must have at least one of these files
  const optionalFiles = ['war3map.lua', 'war3map.j'];

  // flag for which parser to use between jass/lua
  let isLuaMap = false;

  extractedFiles.forEach(extractedFile => {
    try {
      const file = mpq.openFile(extractedFile);
      const data = file.read();

      const filePath = `${outputDirectory}/${extractedFile}`;

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      fs.appendFileSync(filePath, Buffer.from(data));

      // Clean up
      file.close();
    } catch (err) {
      console.log("error extracing file: ", extractedFile, "error: ", err);
    }
  });
  
  const listFile = new LISTFile(`${outputDirectory}/(listfile)`);

  optionalFiles.forEach(optionalFile => {
    const hasFile = listFile.files.some(listItem => {
      return listItem == optionalFile;
    });

    if (hasFile) {
      isLuaMap = optionalFile.endsWith("lua");

      try {
        const file = mpq.openFile(optionalFile);
        const data = file.read();

        const filePath = `${outputDirectory}/${optionalFile}`;

        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }

        fs.appendFileSync(filePath, Buffer.from(data));

        // Clean up
        file.close();
      } catch (err) {
        console.log("error extracing file: ", optionalFile, "error: ", err);
      }
    }
  });

  mpq.close();
  await parseMapData(normalizedMapName, mapFilePath, outputDirectory, isLuaMap);
};

async function parseMapData(normalizedMapName, mapFilePath, outputDirectory, isLuaMap) {
  const doo = new DOOFile(`${outputDirectory}/war3map.doo`);

  if (!fs.existsSync(`${CLIENT_OUTPUT_DIR}/${normalizedMapName}`)){
    console.log("making map output directory: ", `${CLIENT_OUTPUT_DIR}/${normalizedMapName}`);
    fs.mkdirSync(`${CLIENT_OUTPUT_DIR}/${normalizedMapName}`);
  }

  //
  // parse and write the client data files as json used by the web client
  //

  doo.write(`${CLIENT_OUTPUT_DIR}/${normalizedMapName}/doo.json`);
  zipGameFile(`${CLIENT_OUTPUT_DIR}/${normalizedMapName}/doo.json`);

  // extract neutral buildings (gold mines, shops, fountains) from war3mapUnits.doo
  try {
    const unitFile = new UNITFile(`${outputDirectory}/war3mapUnits.doo`);
    const neutralBuildings = [];

    if (unitFile.units) {
      unitFile.units.forEach(rawUnit => {
        const info = getUnitInfo(rawUnit.type);
        if (info.isGoldmine || info.isFountain || info.isInteractiveShop) {
          const entry = {
            type: rawUnit.type,
            x: rawUnit.position[0],
            y: rawUnit.position[1],
            rotation: rawUnit.rotation,
            scale: rawUnit.scale,
            variation: rawUnit.variation
          };
          if (info.isGoldmine && rawUnit.gold > 0) {
            entry.gold = rawUnit.gold;
          }
          neutralBuildings.push(entry);
        }
      });
    }

    if (neutralBuildings.length > 0) {
      const nbPath = `${CLIENT_OUTPUT_DIR}/${normalizedMapName}/neutralBuildings.json`;
      fs.writeFileSync(nbPath, JSON.stringify(neutralBuildings), 'utf-8');
      zipGameFile(nbPath);
      console.log(`  wrote ${neutralBuildings.length} neutral buildings for ${normalizedMapName}`);
    }
  } catch (err) {
    console.log(`  warning: could not extract neutral buildings for ${normalizedMapName}: ${err.message}`);
  }

  // //
  // // convert the blp map file
  // //

  // let blp = decodeBLP(new Uint8Array(fs.readFileSync(`${outputDirectory}/war3mapMap.blp`)).buffer);
  // let imageData = getBLPImageData(blp, 0);
  // let png = new PNG({width: blp.width, height: blp.height, inputHasAlpha: true});

  // png.data = Buffer.from(imageData.data.buffer);

  // fs.writeFileSync(`${CLIENT_OUTPUT_DIR}/${normalizedMapName}/map.png`, PNG.sync.write(png));

  // // clean up the png
  // fs.unlinkSync(`${CLIENT_OUTPUT_DIR}/${normalizedMapName}/map.png`);

  //
  // parse game files and create configs and game data
  //

  const scriptFileName = isLuaMap ? 'war3map.lua' : 'war3map.j';
  const luaJassFile = new LUAJASSFile(`${outputDirectory}/${scriptFileName}`);

  const infoFile = new INFOFile(`${outputDirectory}/war3map.w3i`);
  const terrainFile = new TERRAINFile(`${outputDirectory}/war3map.w3e`);

  const output = { ...infoFile };

  output.info.gridSize.full = [ terrainFile.map.width, terrainFile.map.height ];

  if (infoFile.info.gridSize.margins) {
    output.info.gridSize.margins = infoFile.info.gridSize.margins;
  }

  const halfGridWidth = terrainFile.map.width / 2;
  const halfGridHeight = terrainFile.map.height / 2;

  // the algorithm for how the game determines the bounds for the `map` took
  // me absolutely forever to figure out... but now that we parse TERRAINFile
  // we can use the map offset, map height and width, and this algorithm to 
  // accurately determine what the bounds are 
  //

  output.info.bounds.map = [
    [ terrainFile.map.offset.x, terrainFile.map.offset.x + (terrainFile.map.width * 128) ],
    [ terrainFile.map.offset.y + (terrainFile.map.height * 128), terrainFile.map.offset.y ]
  ];

  output.startingPositions = luaJassFile.startingPositions;
  output.info.name = normalizedMapName;

  // now process teh WPM since it needs the map data info

  const wpm = new WPMFile(`${outputDirectory}/war3map.wpm`, output.info);
  wpm.write(`${CLIENT_OUTPUT_DIR}/${normalizedMapName}/wpm.json`);
  zipGameFile(`${CLIENT_OUTPUT_DIR}/${normalizedMapName}/wpm.json`);

  //
  // resize and convert to png
  //

  // store tileset info for client tree rendering
  const tileset = terrainFile.tileset;
  const extras = TILESET_EXTRAS[tileset] || DEFAULT_EXTRAS;
  output.info.tileset = tileset;
  output.info.treeColor = extras.trees;
  output.info.treeStroke = extras.treeStroke;

  const canvas = drawBackgroundMap(output, wpm, doo, terrainFile);
  const buffer = canvas.toBuffer('image/png');

  fs.writeFileSync(`${CLIENT_OUTPUT_DIR}/${normalizedMapName}/map.jpg`, buffer);
  fs.writeFileSync(`${CLIENT_OUTPUT_DIR}/${normalizedMapName}/gridmap.jpg`, buffer);

  // read in and parse the current config file
  const mapConfig = readMapConfiguration();

  // update our map entry
  mapConfig.maps[mapFilePath] = output;

  // write the new config file
  writeMapConfiguration(mapConfig);

  const gameData = readGameData();

  gameData.maps[mapFilePath] = output.info;
  writeGameData(gameData);
};

function drawBackgroundMap (output, wpm, doo, terrainFile) {

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

  // Per-palette colors: use actual PALETTE_COLORS when available
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
    .range([ -(fullMiddleX), fullMiddleX ]);
  const fullYScale = d3.scaleLinear()
    .domain(gameScaler.mapExtent.y)
    .range([ -(fullMiddleY), fullMiddleY ]);

  const wpmRows = grid.length;
  const wpmCols = grid[0] ? grid[0].length : 0;

  // --- Pass 1: Paint ground from W3E terrain grid with sub-tile noise ---
  const terrainRows = tileGrid.length;
  const terrainCols = tileGrid[0] ? tileGrid[0].length : 0;
  const terrainCellRows = terrainRows - 1;
  const terrainCellCols = terrainCols - 1;
  const terrainBlockW = (wpmCols * tileSize) / terrainCellCols;
  const terrainBlockH = (wpmRows * tileSize) / terrainCellRows;

  const margins = output.info.gridSize.margins;
  const { playable, full } = output.info.gridSize;
  const marginBottom = margins ? margins[2] : Math.floor((full[1] - playable[1]) / 2);
  const marginTop = margins ? margins[3] : Math.ceil((full[1] - playable[1]) / 2);
  const marginLeft = margins ? margins[0] : Math.floor((full[0] - playable[0]) / 2);
  const marginRight = margins ? margins[1] : Math.ceil((full[0] - playable[0]) / 2);

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

  // --- Pass 2: Overlay water + cliffs from WPM (finer resolution) ---
  let rCol = wpmRows - 1;

  for (let col = 0; col < wpmRows; col++) {
    for (let row = 0; row < wpmCols; row++) {
      const data = grid[col][row];
      const { NoWater, NoWalk, NoFly, NoBuild } = data;
      const drawX = row * tileSize;
      const drawY = rCol * tileSize;

      if (NoWalk && NoFly) {
        const noise = tileHash(col, row) * 0.24 - 0.12;
        const cr = Math.max(0, Math.min(255, Math.round(cliffRgb[0] * (1 + noise))));
        const cg = Math.max(0, Math.min(255, Math.round(cliffRgb[1] * (1 + noise))));
        const cb = Math.max(0, Math.min(255, Math.round(cliffRgb[2] * (1 + noise))));
        ctx.fillStyle = rgbToHex(cr, cg, cb);
        ctx.fillRect(drawX, drawY, tileSize, tileSize);
      } else if (!NoWater && NoWalk) {
        const wNoise = tileHash(col * 3, row * 3) * 0.1 - 0.05;
        const wRgb = hexToRgb(extras.water);
        const wr = Math.max(0, Math.min(255, Math.round(wRgb[0] * (1 + wNoise))));
        const wg = Math.max(0, Math.min(255, Math.round(wRgb[1] * (1 + wNoise))));
        const wb = Math.max(0, Math.min(255, Math.round(wRgb[2] * (1 + wNoise))));
        ctx.fillStyle = rgbToHex(wr, wg, wb);
        ctx.fillRect(drawX, drawY, tileSize, tileSize);
      } else if (!NoWater && !NoWalk) {
        const swNoise = tileHash(col * 5, row * 5) * 0.1 - 0.05;
        const swRgb = hexToRgb(extras.shallowwater);
        const sr = Math.max(0, Math.min(255, Math.round(swRgb[0] * (1 + swNoise))));
        const sg = Math.max(0, Math.min(255, Math.round(swRgb[1] * (1 + swNoise))));
        const sb = Math.max(0, Math.min(255, Math.round(swRgb[2] * (1 + swNoise))));
        ctx.fillStyle = rgbToHex(sr, sg, sb);
        ctx.fillRect(drawX, drawY, tileSize, tileSize);
      }
    }
    rCol--;
  }

  // --- Trees ---
  const mapRangeX = gameScaler.mapExtent.x[1] - gameScaler.mapExtent.x[0];
  const mapRangeY = gameScaler.mapExtent.y[0] - gameScaler.mapExtent.y[1];

  dooGrid.forEach((item) => {
    if (!item.flags.visible) return;
    if (item.life === 0) return;

    const x = parseFloat(item.position.x);
    const y = parseFloat(item.position.y);

    // Check tile + neighbors: if majority are unwalkable cliffs/void, skip
    const wpmCol = Math.floor((x - gameScaler.mapExtent.x[0]) / mapRangeX * wpmCols);
    const wpmRow = Math.floor((y - gameScaler.mapExtent.y[1]) / mapRangeY * wpmRows);
    if (wpmRow < 0 || wpmRow >= wpmRows || wpmCol < 0 || wpmCol >= wpmCols) return;

    let unwalkable = 0;
    let total = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = wpmRow + dr, c = wpmCol + dc;
        if (r >= 0 && r < wpmRows && c >= 0 && c < wpmCols) {
          total++;
          if (grid[r][c].NoWalk && grid[r][c].NoFly) unwalkable++;
        }
      }
    }
    if (unwalkable > total / 2) return;

    const treeX = fullXScale(x) + fullMiddleX;
    const treeY = fullYScale(y) + fullMiddleY;

    const sizeNoise = 1 + (tileHash(Math.round(x), Math.round(y)) * 0.2 - 0.1);
    const size = Math.max(3, 10 * item.scale[0] * sizeNoise);
    const halfSize = size / 2;

    ctx.fillStyle = extras.trees;
    ctx.fillRect(treeX - halfSize, treeY - halfSize, size, size);
  });

  return canvas;
};

function zipGameFile (outputPath) {
  const gzip = zlib.createGzip();
  const inputFile = fs.createReadStream(outputPath);
  const outputFile = fs.createWriteStream(`${outputPath}.gz`, { autoClose: true });

  inputFile.pipe(gzip)
    .on('error', (e) => {
      console.log("file write error for: ", outputPath, e);
    })
    .pipe(outputFile)
    .on('error', (e) => {
      console.log("file write error for: ", outputPath, e);
    })
    .on('finish', () => {
      try {
        fs.unlinkSync(outputPath);
      } catch (e) {
        // do nothing
      }
    });
};

function readMapConfiguration() {
  const rawData = fs.readFileSync(`${__dirname}/../helpers/mapConfiguration.json`);

  return JSON.parse(rawData);
};

function writeMapConfiguration(mapConfig) {
  fs.writeFileSync(
      `${__dirname}/../helpers/mapConfiguration.json`, JSON.stringify(mapConfig) , 'utf-8');
};

function readGameData() {
  const rawData = fs.readFileSync(`${CLIENT_GAMEDATA_DIR}/gameData.json`);

  return JSON.parse(rawData);
};

function writeGameData(gameData) {
  const rawJsonStr = JSON.stringify(gameData);
  const output = `const gameData = ${rawJsonStr};

  window.gameData = gameData;
  `;

  fs.writeFileSync(
    `${CLIENT_GAMEDATA_DIR}/gameData.json`, rawJsonStr, 'utf-8');

  fs.writeFileSync(
    `${CLIENT_GAMEDATA_DIR}/gameData.js`, output, 'utf-8');
};


// entry point
main();
