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
      LISTFile = require("../lib/parsers/LISTFile"),
      LUAJASSFile = require("../lib/parsers/LUAJASSFile"),
      INFOFile = require("../lib/parsers/INFOFile"),
      TERRAINFile = require("../lib/parsers/TERRAINFile");

const mappings = require("../helpers/mappings.js");

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
// main entry code
//

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

  for (let i = 0; i < maps.length; i++) {
    const map = maps[i];

    if (map == "." || map == "..") {
      continue;
    }

    try {
      console.log(`reading map: ${map} (${(i+1)}/${maps.length})`);
      await readMapFile(map);
    } catch (err) {
      console.log("failed on map: ", map);
      console.log(err);
    }
  }

  console.log("finished data extraction");
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

  if (!fs.existsSync(`${CLIENT_OUTPUT_DIR}/${normalizedMapName}`)){
    console.log("making map output directory: ", `${CLIENT_OUTPUT_DIR}/${normalizedMapName}`);
    fs.mkdirSync(`${CLIENT_OUTPUT_DIR}/${normalizedMapName}`);
  }

  //
  // parse and write the client data files as json used by the web client
  //

  doo.write(`${CLIENT_OUTPUT_DIR}/${normalizedMapName}/doo.json`);
  zipGameFile(`${CLIENT_OUTPUT_DIR}/${normalizedMapName}/doo.json`);

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

  const canvas = drawBackgroundMap(output, wpm, doo);
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

function drawBackgroundMap (output, wpm, doo) {

  const gameScaler = new GameScaler();
  gameScaler.addDependency('_d3', d3);
  gameScaler.setup(output.info);

  const canvas = createCanvas(gameScaler.mapImage.width, gameScaler.mapImage.height);
  const ctx = canvas.getContext('2d');

  

  // setup

  const { grid } = wpm;
  const dooGrid = doo.grid;

  const dooTree = new rbush();

  const gridTileSize = 16;
  const treeSize = 8;

  // drawing

  const tileSize = gameScaler.pixelsPerTile;

  const colors = {
    'empty': '#000',
    'grass': '#2c6818',
    'water': '#051459',
    'shallowwater': '#0A27A6',
    'ground': '#906739',
    'trees': '#013f01'
  };

  // black background
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, gameScaler.mapImage.width, gameScaler.mapImage.height);

  const { xScale, yScale, middleX, middleY, } = gameScaler;

  let rCol = grid.length - 1;

  for (let col = 0; col < grid.length; col++) {
    for (let row = 0; row < grid[col].length; row++) {
      const data = grid[col][row];

      const { 
          NoWater, 
          NoWalk,
          NoFly,
          NoBuild,
          Blight
      } = data;

      const drawX = row * tileSize;
      const drawY = rCol * tileSize;

      // in game coords for tree map collisions
      const gridX = drawX;
      const gridY = drawY;

      const gridHitBox = {
        minX: gridX,
        minY: gridY,
        maxX: gridX + gridTileSize,
        maxY: gridY + gridTileSize
      };

      // const collisions = dooTree.search(gridHitBox);
      // if (collisions.length) {
      //   ctx.fillStyle = colors.trees;
      //   ctx.fillRect(drawX, drawY, tileSize, tileSize);

      //   continue;
      // }

      // const flagTable = {
      //   'NoWalk':  0x02,  // 1=no walk  , 0=walk ok
      //   'NoFly':   0x04,  // 1=no fly   , 0=fly ok
      //   'NoBuild': 0x08,  // 1=no build , 0=build ok

      //   'Blight':  0x20,  // 1=blight   , 0=normal
      //   'NoWater': 0x40,  // 1=no water , 0=water
      //   'Unknown': 0x80   // 1=unknown  , 0=normal
      // };

      // can't walk and can't fly
      if (NoWalk && NoFly) {
        ctx.fillStyle = colors.empty;
        ctx.fillRect(drawX, drawY, tileSize, tileSize);

        continue;
      }

      if (!NoWater && !NoBuild) {
        ctx.fillStyle = colors.water;
        ctx.fillRect(drawX, drawY, tileSize, tileSize);

        continue;
      }

      if (!NoWater && NoBuild) {
        ctx.fillStyle = colors.shallowwater;
        ctx.fillRect(drawX, drawY, tileSize, tileSize);

        continue;
      }

      // can walk and can build
      if (!NoWalk && !NoBuild) {
        ctx.fillStyle = colors.grass;
        ctx.fillRect(drawX, drawY, tileSize, tileSize);

        continue;
      }

      // can walk
      if (!NoWalk) {
        ctx.fillStyle = colors.ground;
        ctx.fillRect(drawX, drawY, tileSize, tileSize);

        continue;
      }

      // can't walk and can fly
      if (NoWalk && !NoFly) {
        ctx.fillStyle = colors.ground;
        ctx.fillRect(drawX, drawY, tileSize, tileSize);

        continue;
      }

      if (Blight) {
        ctx.fillStyle = colors.grass;
        ctx.fillRect(drawX, drawY, tileSize, tileSize);

        continue;
      }  
    }

    rCol--;
  }

  dooGrid.forEach((item, index) => {
    const x = parseFloat(item.position.x);
    const y = parseFloat(item.position.y);

    const newTree = {
      minX: xScale(x) + middleX,
      maxX: xScale(x) + middleX,

      minY: yScale(y) + middleY,
      maxY: yScale(y) + middleY
    };

    const scaledSize = 10 * item.scale[0];

    ctx.fillStyle = colors.trees;
    ctx.fillRect(newTree.minX, newTree.minY, scaledSize, scaledSize);
    
    //dooTree.insert(newTree);
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
