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

const MAP_OUTPUT_DIR = "mapdata";

const CLIENT_OUTPUT_DIR = "../client/maps";

const CLIENT_GAMEDATA_DIR = "../client/js";

//
// tileset color themes
// keyed by first character of W3E tile palette codes
//


//
// per-palette-code color mapping (W3E ground texture codes → hex colors)
//

// Per-tileset rendering colors (water, trees, cliffs, ground/accent for terrain palette)
const TILESET_EXTRAS = {
  'L': { water: '#0a2070', shallowwater: '#1838a0', trees: '#064006', cliff: '#383020', ground: '#48862a', accent: '#7a7040' },
  'V': { water: '#0a2070', shallowwater: '#1838a0', trees: '#064006', cliff: '#383020', ground: '#48862a', accent: '#807848' },
  'F': { water: '#081858', shallowwater: '#103080', trees: '#28400a', cliff: '#302818', ground: '#6a8030', accent: '#8a6830' },
  'X': { water: '#081858', shallowwater: '#103080', trees: '#28400a', cliff: '#302818', ground: '#687830', accent: '#886838' },
  'W': { water: '#0a2868', shallowwater: '#1840a0', trees: '#1a3830', cliff: '#404858', ground: '#a8b8c0', accent: '#8898a8' },
  'N': { water: '#0a2868', shallowwater: '#1840a0', trees: '#1a4030', cliff: '#384050', ground: '#90a8b0', accent: '#7888a0' },
  'I': { water: '#0a1850', shallowwater: '#183070', trees: '#143828', cliff: '#283848', ground: '#88a0b8', accent: '#607088' },
  'A': { water: '#061050', shallowwater: '#0a2080', trees: '#062810', cliff: '#1a1810', ground: '#1a5028', accent: '#385030' },
  'C': { water: '#08104a', shallowwater: '#101870', trees: '#10200a', cliff: '#1a1810', ground: '#2a4018', accent: '#38382a' },
  'B': { water: '#0a2060', shallowwater: '#183888', trees: '#385018', cliff: '#403020', ground: '#88943a', accent: '#a09058' },
  'D': { water: '#081048', shallowwater: '#101868', trees: '#1a2a1a', cliff: '#181818', ground: '#384838', accent: '#484848' },
  'G': { water: '#081048', shallowwater: '#101868', trees: '#142014', cliff: '#101010', ground: '#283020', accent: '#383830' },
  'K': { water: '#081858', shallowwater: '#103080', trees: '#1a2a1a', cliff: '#202028', ground: '#505060', accent: '#606068' },
  'J': { water: '#0a1060', shallowwater: '#182088', trees: '#1a2028', cliff: '#201830', ground: '#484068', accent: '#504870' },
  'Y': { water: '#041838', shallowwater: '#0a2860', trees: '#062828', cliff: '#101828', ground: '#285040', accent: '#305050' },
  'Z': { water: '#0a1858', shallowwater: '#142880', trees: '#103018', cliff: '#282818', ground: '#486040', accent: '#585848' },
  'Q': { water: '#0a1858', shallowwater: '#142880', trees: '#284018', cliff: '#281810', ground: '#588038', accent: '#787048' },
  'O': { water: '#0a1848', shallowwater: '#142068', trees: '#283818', cliff: '#281810', ground: '#504828', accent: '#684030' }
};

const DEFAULT_EXTRAS = { water: '#0a2070', shallowwater: '#1838a0', trees: '#064006', cliff: '#383020', ground: '#48862a', accent: '#7a7040' };

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
      const name = map.substring(mapPrefix.length, map.length - 4);
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

async function readMapFile(mapFilePath, mapPrefix = 'w3c_') {
  const mpq = await MPQ.open(`/stormjs/${mapFilePath}`, 'r');

  // get rid of the prefix and filename suffix
  const prefixLen = mapFilePath.startsWith(mapPrefix) ? mapPrefix.length : 0;
  const normalizedMapName = mapFilePath.substring(prefixLen, mapFilePath.length - 4);

  // make our map output directory if we need to
  const outputDirectory = `../${MAP_OUTPUT_DIR}/${normalizedMapName}`;

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
            y: rawUnit.position[1]
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

  // build a color lookup for this map's palettes (as RGB arrays for noise variation)
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

  // black background
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, gameScaler.fullMapImage.width, gameScaler.fullMapImage.height);

  // use full-map scales for the background image (not the camera-cropped scales)
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

  // --- Pass 1: Paint ground from W3E terrain grid (coarse, solid color blocks) ---
  const terrainRows = tileGrid.length;
  const terrainCols = tileGrid[0] ? tileGrid[0].length : 0;
  const terrainCellRows = terrainRows - 1;
  const terrainCellCols = terrainCols - 1;
  const terrainBlockW = (wpmCols * tileSize) / terrainCellCols;
  const terrainBlockH = (wpmRows * tileSize) / terrainCellRows;

  // Boundary margins: skip painting terrain for tiles outside the playable area
  const margins = output.info.gridSize.margins;
  const { playable, full } = output.info.gridSize;
  const marginBottom = margins ? margins[2] : Math.floor((full[1] - playable[1]) / 2);
  const marginTop = margins ? margins[3] : Math.ceil((full[1] - playable[1]) / 2);
  const marginLeft = margins ? margins[0] : Math.floor((full[0] - playable[0]) / 2);
  const marginRight = margins ? margins[1] : Math.ceil((full[0] - playable[0]) / 2);

  for (let row = 0; row < terrainCellRows; row++) {
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
      } else if (!NoWater && !NoBuild) {
        ctx.fillStyle = extras.water;
        ctx.fillRect(drawX, drawY, tileSize, tileSize);
      } else if (!NoWater && NoBuild) {
        ctx.fillStyle = extras.shallowwater;
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
