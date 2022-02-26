/*
  Data tool for the automatic extraction of needed information for wc3v to parse maps.

  Focused on supporting all of the maps in a given W3Champions folder.
*/


const fs = require('fs');
const os = require("os");
const path = require("path");

const WPMFile = require("../lib/parsers/WPMFile"),
      DOOFile = require("../lib/parsers/DOOFile"),
      UNITFile = require("../lib/parsers/UNITFile"),
      LISTFile = require("../lib/parsers/LISTFile"),
      LUAJASSFile = require("../lib/parsers/LUAJASSFile"),
      INFOFile = require("../lib/parsers/INFOFile"),
      TERRAINFile = require("../lib/parsers/TERRAINFile");

const mappings = require("../helpers/mappings.js");
const MAP_OUTPUT_DIR = "mapdata";

const CLIENT_OUTPUT_DIR = "../client/maps";

const CLIENT_GAMEDATA_DIR = "../client/js";

const sjs = require('@wowserhq/stormjs');
const { FS, MPQ } = sjs;

const PNG = require('pngjs').PNG;
const war3model = require('war3-model');
const { decodeBLP, getBLPImageData } = war3model;

const { Image } = require('image-js');

async function main() {
  FS.mkdir('/stormjs');

  const homedir = require('os').homedir();
  const mapDirectoryPath = `${homedir}\\Documents\\Warcraft III\\Maps\\W3Champions\\v10`;
  // assumes wc3v is relative to `${homedir}/[some dir]/wc3v/tools`
  // change if you need to run this in a different place
  const mapDirectoryPathPosix = `../../../Documents/Warcraft III/Maps/W3Champions/v10`;

  // mount our w3c folder to stomjs
  FS.mount(FS.filesystems.NODEFS, { root: mapDirectoryPathPosix }, '/stormjs');

  // read all the maps in 
  const maps = FS.readdir('./stormjs');

  maps.forEach(async (map, i) => {
    if (map == "." || map == "..") {
      return;
    }

    try {
      await readMapFile(map);

      if (i == maps.length - 1) {
        console.log("finished data extraction");
      }
    } catch (err) {
      console.log("failed on map: ", map);
      console.log(err);
    }
  });
};

async function readMapFile(mapFilePath) {
  const mpq = await MPQ.open(`/stormjs/${mapFilePath}`, 'r');
  
  // get rid of the prefix and filename suffix
  const normalizedMapName = mapFilePath.substring(4, mapFilePath.length - 4);

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
  const unitFile = new UNITFile(`${outputDirectory}/war3mapUnits.doo`);

  if (!fs.existsSync(`${CLIENT_OUTPUT_DIR}/${normalizedMapName}`)){
    console.log("making map output directory: ", `${CLIENT_OUTPUT_DIR}/${normalizedMapName}`);
    fs.mkdirSync(`${CLIENT_OUTPUT_DIR}/${normalizedMapName}`);
  }

  //
  // parse and write the client data files as json used by the web client
  //

  doo.write(`${CLIENT_OUTPUT_DIR}/${normalizedMapName}/doo.json`);
  unitFile.write(`${CLIENT_OUTPUT_DIR}/${normalizedMapName}/wpm.json`)

  //
  // convert the blp map file
  //

  let blp = decodeBLP(new Uint8Array(fs.readFileSync(`${outputDirectory}/war3mapMap.blp`)).buffer);
  let imageData = getBLPImageData(blp, 0);
  let png = new PNG({width: blp.width, height: blp.height, inputHasAlpha: true});

  png.data = Buffer.from(imageData.data.buffer);

  fs.writeFileSync(`${CLIENT_OUTPUT_DIR}/${normalizedMapName}/map.png`, PNG.sync.write(png));

  //
  // resize and convert to png
  //

  let gridImage = await Image.load(`${CLIENT_OUTPUT_DIR}/${normalizedMapName}/map.png`);
  let mapJpg = gridImage.resize({ factor: 4 });

  mapJpg.save(`${CLIENT_OUTPUT_DIR}/${normalizedMapName}/map.jpg`);
  mapJpg.save(`${CLIENT_OUTPUT_DIR}/${normalizedMapName}/gridmap.jpg`);

  // clean up the png
  fs.unlinkSync(`${CLIENT_OUTPUT_DIR}/${normalizedMapName}/map.png`);

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
