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

  let downloadMode = false;
  let force = false;

  args.forEach(arg => {
    if (arg.startsWith('--version=')) version = arg.split('=')[1];
    if (arg.startsWith('--source=')) sourcePath = arg.split('=')[1];
    if (arg === '--list') listOnly = true;
    if (arg.startsWith('--prefix=')) mapPrefix = arg.split('=')[1];
    // Battle.net auto-download folder: maps live in per-hash subdirectories
    // (Maps/Download/<sha1>/<RealName>.w3x), not as flat files. Defaults the
    // source to the standard Battle.net Download path.
    if (arg === '--download') downloadMode = true;
    // Re-extract maps even if the client output folder already exists.
    if (arg === '--force') force = true;
  });

  FS.mkdir('/stormjs');

  const homedir = require('os').homedir();

  // support custom source path, the Battle.net Download folder, or the
  // default W3Champions path
  const defaultSource = downloadMode
    ? `../../../Documents/Warcraft III/Maps/Download`
    : `../../../Documents/Warcraft III/Maps/W3Champions/${version}`;
  const mapDirectoryPathPosix = sourcePath
    ? path.relative(process.cwd(), sourcePath).replace(/\\/g, '/')
    : defaultSource;

  console.log(`Map source: ${mapDirectoryPathPosix}${downloadMode ? ' (Battle.net Download — recursing per-hash subdirs)' : ''}`);
  console.log(`Map prefix: "${mapPrefix}" (strip from filename for map name)`);

  // mount our map folder to stormjs
  FS.mount(FS.filesystems.NODEFS, { root: mapDirectoryPathPosix }, '/stormjs');

  // Build the list of map paths (relative to the mount root). Flat .w3x for
  // W3Champions; one level of hash subdirectories for the Download folder.
  let maps;
  if (downloadMode) {
    maps = [];
    const entries = FS.readdir('./stormjs').filter(m => m !== '.' && m !== '..');
    for (const entry of entries) {
      let inner;
      try {
        inner = FS.readdir(`./stormjs/${entry}`);
      } catch (e) {
        continue; // not a directory (or unreadable) — skip
      }
      const w3x = inner.find(f => f.endsWith('.w3x'));
      if (w3x) maps.push(`${entry}/${w3x}`);
    }
  } else {
    maps = FS.readdir('./stormjs').filter(m => m !== '.' && m !== '..' && m.endsWith('.w3x'));
  }

  if (listOnly) {
    // De-dupe by normalized name so the Download folder's many duplicate
    // hashes of the same map don't drown the list.
    const seen = new Map();
    maps.forEach(map => {
      const name = normalizeW3xFilename(map);
      if (!seen.has(name)) seen.set(name, map);
    });
    console.log(`\nFound ${maps.length} .w3x files, ${seen.size} unique map names:`);
    let i = 1;
    for (const [name, map] of [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const exists = fs.existsSync(`${CLIENT_OUTPUT_DIR}/${name}`);
      console.log(`  ${i++}. ${name}${exists ? '  [already extracted]' : ''}  (${map})`);
    }
    return;
  }

  // Skip maps whose client output already exists (unless --force). Keeps
  // re-runs cheap and lets a long Download extraction resume after a crash.
  const seenNames = new Set();
  let processed = 0, skipped = 0, failed = 0;
  for (let i = 0; i < maps.length; i++) {
    const map = maps[i];
    const normName = normalizeW3xFilename(map);

    // De-dupe within this run (Download has many hashes of the same map).
    if (seenNames.has(normName)) { skipped++; continue; }
    seenNames.add(normName);

    if (!force && fs.existsSync(`${CLIENT_OUTPUT_DIR}/${normName}`)) {
      skipped++;
      continue;
    }

    try {
      console.log(`reading map: ${map} -> ${normName} (${(i+1)}/${maps.length})`);
      await readMapFile(map, mapPrefix);
      processed++;
    } catch (err) {
      failed++;
      console.log("failed on map: ", map);
      console.log(err && err.message ? err.message : err);
    }
  }
  console.log(`\nextraction summary: ${processed} processed, ${skipped} skipped, ${failed} failed`);

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
// Sanitize a derived map name so it is both filesystem-safe and matchable by
// the client resolver (parserEntry.resolveMapDataName). That resolver strips
// spaces from the replay's map name but NOT from our stored name, so a stored
// name with spaces could never match — strip them. Keep alnum, _ - . and '
// (existing maps like Kal'drassil rely on the apostrophe); drop anything else
// (parens, brackets, etc. — also rejected by browserMapLoader.SAFE_MAP_NAME).
function sanitizeMapName(name) {
  return name.replace(/\s+/g, '').replace(/[^A-Za-z0-9_\-.']/g, '').trim();
}

function normalizeW3xFilename(filename) {
  // Drop any directory part (Download maps arrive as "<hash>/<file>.w3x").
  let name = path.basename(filename).replace(/\.w3x$/i, '');

  // Battle.net / Blizzard ladder maps carry a leading "(N)" start-location
  // count, e.g. "(6)BloodstoneMesa_LV" → "BloodstoneMesa_LV".
  name = name.replace(/^\(\d+\)/, '');

  // Pattern: 1v1_{MapName}_{ver}_w3c_{date}_{time}_{hash}
  const newPattern = name.match(/^1v1_(.+?)_w3c_\d+_\d+_\d+$/);
  if (newPattern) return sanitizeMapName(newPattern[1]);

  // Pattern: {num}_w3c_{date}_{time}_{MapName}
  const oldPattern = name.match(/^\d+_w3c_\d+_\d+_(.+)$/);
  if (oldPattern) return sanitizeMapName(oldPattern[1]);

  // Pattern: w3c_s13.x_{MapName} or w3c_s13_{MapName}
  const s13Pattern = name.match(/^w3c_s\d+(?:\.\d+)?_(.+)$/);
  if (s13Pattern) return sanitizeMapName(s13Pattern[1]);

  // Pattern: w3c_{MapName}
  if (name.startsWith('w3c_')) return sanitizeMapName(name.substring(4));

  return sanitizeMapName(name);
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

  // Truly-optional files: extract if the map ships them, silent if absent.
  // war3mapMisc.txt = Gameplay Constants overrides (creep guard/leash, etc.).
  // Melee maps don't ship it; custom maps may — parsed later by MiscFile so
  // those maps get an exact creep leash instead of the WC3 default.
  const bonusFiles = ['war3mapMisc.txt'];
  bonusFiles.forEach(bonusFile => {
    const hasFile = listFile.files.some(listItem => listItem == bonusFile);
    if (!hasFile) {
      return;
    }
    try {
      const file = mpq.openFile(bonusFile);
      const data = file.read();
      const filePath = `${outputDirectory}/${bonusFile}`;
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      fs.appendFileSync(filePath, Buffer.from(data));
      file.close();
    } catch (err) {
      console.log("error extracting optional file: ", bonusFile, "error: ", err);
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
