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

const { renderMinimap } = require('../helpers/minimapRenderer');

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

const { TILESET_EXTRAS, DEFAULT_EXTRAS } = require('../helpers/tilesetColors');

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

  const canvas = await drawBackgroundMap(outputDirectory, terrainFile);
  const buffer = canvas.toBuffer('image/jpeg', { quality: 0.92 });

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

// Minimap render entry point. Prefers war3mapMap.blp (the literal image WC3
// displays in-game) from the extracted mapdata folder; falls back to a
// HiveWE-style synthesis from the W3E grid when the BLP is missing. Trees
// and neutral building icons are layered on top by the client, not baked.
async function drawBackgroundMap (mapdataDir, terrainFile) {
  return renderMinimap(mapdataDir, terrainFile);
}

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
