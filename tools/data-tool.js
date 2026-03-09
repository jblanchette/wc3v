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

const DEFAULT_THEME = {
  grass: '#2c6818',
  ground: '#906739',
  water: '#051459',
  shallowwater: '#0A27A6',
  empty: '#000',
  trees: '#013f01',
  treeStroke: '#906739'
};

const TILESET_THEMES = {
  // Lordaeron Summer
  'L': { ...DEFAULT_THEME },
  // Village
  'V': {
    ...DEFAULT_THEME,
    grass: '#2e7a1e',
    ground: '#7a6a3a'
  },
  // Lordaeron Fall
  'F': {
    ...DEFAULT_THEME,
    grass: '#5a6a20',
    ground: '#7a5a2a',
    trees: '#3a5a10',
    treeStroke: '#6a4a20'
  },
  // Village Fall
  'X': {
    ...DEFAULT_THEME,
    grass: '#5a6a20',
    ground: '#7a5a2a',
    trees: '#3a5a10',
    treeStroke: '#6a4a20'
  },
  // Lordaeron Winter
  'W': {
    ...DEFAULT_THEME,
    grass: '#a0b0b8',
    ground: '#7a8a90',
    trees: '#2a5040',
    treeStroke: '#5a7068'
  },
  // Northrend
  'N': {
    ...DEFAULT_THEME,
    grass: '#b0c0c8',
    ground: '#8a98a0',
    trees: '#285a40',
    treeStroke: '#5a7a68'
  },
  // Icecrown
  'I': {
    ...DEFAULT_THEME,
    grass: '#c0d0d8',
    ground: '#90a0a8',
    water: '#0a2060',
    shallowwater: '#1a3878',
    trees: '#204838',
    treeStroke: '#506860'
  },
  // Ashenvale
  'A': {
    ...DEFAULT_THEME,
    grass: '#1a4828',
    ground: '#4a3a2a',
    trees: '#0a3518',
    treeStroke: '#3a5a30'
  },
  // Felwood
  'C': {
    ...DEFAULT_THEME,
    grass: '#283a18',
    ground: '#4a3040',
    trees: '#1a3010',
    treeStroke: '#4a3a4a'
  },
  // Barrens
  'B': {
    ...DEFAULT_THEME,
    grass: '#888040',
    ground: '#a09050',
    trees: '#4a6820',
    treeStroke: '#807030'
  },
  // Dungeon
  'D': {
    ...DEFAULT_THEME,
    grass: '#3a3a3a',
    ground: '#585858',
    trees: '#2a3a2a',
    treeStroke: '#484848'
  },
  // Underground
  'G': {
    ...DEFAULT_THEME,
    grass: '#303030',
    ground: '#505050',
    trees: '#203020',
    treeStroke: '#404040'
  },
  // Cityscape
  'K': {
    ...DEFAULT_THEME,
    grass: '#4a4a58',
    ground: '#686878',
    trees: '#2a3a2a',
    treeStroke: '#505058'
  },
  // Dalaran Ruins
  'J': {
    ...DEFAULT_THEME,
    grass: '#3a3858',
    ground: '#585068',
    trees: '#2a3038',
    treeStroke: '#484858'
  },
  // Sunken Ruins
  'Y': {
    ...DEFAULT_THEME,
    grass: '#1a4858',
    ground: '#3a5868',
    water: '#041848',
    shallowwater: '#0a2880',
    trees: '#0a3838',
    treeStroke: '#2a5858'
  },
  // Ruins (Lordaeron Ruins / generic ruins)
  'Z': {
    ...DEFAULT_THEME,
    grass: '#3a5a3a',
    ground: '#5a5a48',
    trees: '#1a4020',
    treeStroke: '#4a5a3a'
  },
  // Dalaran (Q variant)
  'Q': {
    ...DEFAULT_THEME,
    grass: '#3a4858',
    ground: '#585068',
    trees: '#2a3838',
    treeStroke: '#484858'
  },
  // Outland
  'O': {
    ...DEFAULT_THEME,
    grass: '#5a3828',
    ground: '#704830',
    trees: '#3a4820',
    treeStroke: '#604020'
  }
};

//
// per-palette-code color mapping (W3E ground texture codes → hex colors)
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
  // Dalaran (Q)
  Qdrt: '#807050', Qdrr: '#706040', Qcrp: '#685848', Qcbp: '#586840',
  Qstp: '#787868', Qgrs: '#588040', Qrck: '#686858', Qgrt: '#688040',
  // Outland (O)
  Odrt: '#684030', Odtr: '#583828', Osmb: '#584038', Ofst: '#485028',
  Olgb: '#586830', Ofsl: '#384020', Oaby: '#382828', Orok: '#585048'
};

function getFallbackColor (palette, suffix) {
  const knownPrefixes = ['L', 'W', 'A', 'B', 'J', 'Y', 'Z', 'Q', 'F', 'X', 'V', 'N', 'I', 'C', 'O'];
  for (const p of knownPrefixes) {
    if (PALETTE_COLORS[p + suffix]) return PALETTE_COLORS[p + suffix];
  }
  return null;
}

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

      // unwalkable + unflyable = boundary/cliff
      if (NoWalk && NoFly) {
        const noise = tileHash(col, row) * 0.3 - 0.15;
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
        rgb = [74, 104, 56];
      }

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
  const rawData = fs.readFileSync(`../mapdata/mapConfiguration.json`);

  return JSON.parse(rawData);
};

function writeMapConfiguration(mapConfig) {
  fs.writeFileSync(
      `../mapdata/mapConfiguration.json`, JSON.stringify(mapConfig) , 'utf-8');
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
