/**
 * Generate the list of WC3 game files to extract from CASC using Ladik's CASC Viewer.
 * Usage: node tools/list-casc-extractions.js
 *
 * Opens the WC3 installation at C:\Program Files (x86)\Warcraft III\ with CascView.
 * Navigate to the listed paths and extract them to the output directories shown.
 */
const path = require('path');
const { parseSLK } = require('../helpers/slkParser');

// Parse Cliffs.slk from HiveWE to get cliff IDs and variation counts
const cliffsSLK = parseSLK(path.join(__dirname, '..', '..', 'HiveWE', 'data', 'warcraft', 'Cliffs.slk'));

console.log('=== WC3 CASC Extraction Guide ===');
console.log('');
console.log('Open Ladik\'s CASC Viewer with:');
console.log('  C:\\Program Files (x86)\\Warcraft III\\');
console.log('');

// --- Cliff Models ---
console.log('=== 1. CLIFF MODELS ===');
console.log('Extract entire folder:');
console.log('  FROM: war3.w3mod\\Doodads\\Terrain\\Cliffs\\');
console.log('  TO:   client/assets/models/cliffs/');
console.log('');
console.log('Individual cliff files (' + cliffsSLK.rows.length + ' types):');
let cliffFileCount = 0;
for (const row of cliffsSLK.rows) {
  const id = row.cliffID;
  const maxVar = row.variations || 0;
  for (let v = 0; v <= maxVar; v++) {
    console.log('  Doodads\\Terrain\\Cliffs\\Cliffs' + id + v + '.mdx');
    cliffFileCount++;
  }
}
console.log('Total cliff files: ' + cliffFileCount);

// --- Cliff Transition Models ---
console.log('');
console.log('=== 2. CLIFF TRANSITIONS (optional) ===');
console.log('Extract entire folder:');
console.log('  FROM: war3.w3mod\\Doodads\\Terrain\\CliffTrans\\');
console.log('  TO:   client/assets/models/clifftrans/');

// --- Doodad Metadata ---
console.log('');
console.log('=== 3. DOODAD METADATA ===');
console.log('Extract these SLK files:');
console.log('  FROM: war3.w3mod\\Doodads\\Doodads.slk');
console.log('  FROM: war3.w3mod\\Doodads\\DoodadMetaData.slk');
console.log('  TO:   tools/map-data/doodads/');

// --- Tree Models (per tileset) ---
console.log('');
console.log('=== 4. TREE/DOODAD MODELS ===');
console.log('Extract these folders (each tileset\'s doodads):');
const tilesets = [
  ['LordaeronSummer', 'L'], ['LordaeronFall', 'F'], ['LordaeronWinter', 'W'],
  ['Northrend', 'N'], ['Ashenvale', 'A'], ['Felwood', 'C'],
  ['Barrens', 'B'], ['Village', 'V'], ['VillageFall', 'X'],
  ['Dalaran', 'Q'], ['DalaranRuins', 'J'], ['Dungeon', 'D'],
  ['Underground', 'G'], ['Cityscape', 'K'], ['SunkenRuins', 'Y'],
  ['Ruins', 'Z'], ['Icecrown', 'I'], ['Outland', 'O']
];
for (const [name, code] of tilesets) {
  console.log('  war3.w3mod\\Doodads\\' + name + '\\   → client/assets/models/doodads/' + code + '/');
}

// --- Textures for doodads ---
console.log('');
console.log('=== 5. DOODAD TEXTURES ===');
console.log('Tree/doodad models reference BLP textures. Extract:');
console.log('  war3.w3mod\\Textures\\   → client/assets/textures/');
console.log('  (Or extract specific textures after analyzing MDX references)');

// --- Building Pathing Textures ---
//
// WC3 buildings use shared "pathing" TGAs from war3.w3mod\PathTextures\.
// Each pixel in a pathing texture = 1 WPM cell (32 world units). The red
// channel marks cells that block walking; green = unbuildable but walkable;
// blue = no-fly. This is the same source the WC3 engine uses, so it gives
// us the exact buildable footprint per building (entrances, notches, etc.).
//
// unitdata.slk's `pathTex` column maps each building itemId → texture filename.
// We list the UNIQUE texture filenames here (~29 files) — much smaller surface
// than per-building extraction. tools/parse-building-pathing.js reads the
// extracted TGAs + unitdata.slk to build helpers/buildingPathing.json.
console.log('');
console.log('=== 6. BUILDING PATHING TEXTURES ===');
console.log('Source of truth for building footprints. ~29 shared TGAs.');
console.log('');
const unitDataPath = path.join(__dirname, 'map-data', 'units', 'unitdata.slk');
let pathingSection = '';
try {
  const unitSLK = parseSLK(unitDataPath);
  const pathTexById = {};
  for (const row of unitSLK.rows) {
    const id = row.unitID;
    const tex = row.pathTex;
    if (!id || !tex || tex === '_' || tex === '') continue;
    pathTexById[id] = tex;
  }
  const uniqueTexs = Array.from(new Set(Object.values(pathTexById))).sort();
  console.log('  FROM: war3.w3mod\\' + (uniqueTexs[0] ? uniqueTexs[0].split('\\')[0] : 'PathTextures') + '\\');
  console.log('  TO:   tools/map-data/buildings/_pathing-tgas/');
  console.log('');
  console.log('  (CascView path may differ — search for "*Simple.tga" / "*Solid.tga"');
  console.log('   in the war3.w3mod tree. Reforged installs may also have these as');
  console.log('   DDS — prefer TGA when offered.)');
  console.log('');
  console.log('  Required texture filenames (' + uniqueTexs.length + ' unique, referenced by ' +
              Object.keys(pathTexById).length + ' building itemIds):');
  for (const tex of uniqueTexs) {
    console.log('    ' + tex);
  }
  console.log('');
  console.log('  Also extract (verification only — pathTex column drives the manifest):');
  console.log('    war3.w3mod\\Units\\UnitData.slk');
  console.log('    → tools/map-data/units/unitdata.slk  (already extracted)');
} catch (err) {
  console.log('  [unable to parse ' + unitDataPath + ']');
  console.log('  ' + err.message);
  console.log('  Run extraction #6 manually: grab everything under war3.w3mod\\PathTextures\\');
}

// --- Missile / projectile models ---
//
// The viewer currently draws every ranged attack as one generic streak sprite,
// generated procedurally in client/js/ProjectileRenderer3D.js. All the BEHAVIOUR
// is already real per-unit data (speed, arc, homing, muzzle offsets, extracted
// by tools/extract-unit-projectiles.js) — only the model is generic.
//
// Extracting these swaps the generic sprite for each unit's real missile. The
// paths below come straight from the `art` field of helpers/unitProjectiles.json,
// so this list is derived, never hand-typed.
//
// TWO THINGS TO KNOW BEFORE DOING THIS WORK:
//   1. Many WC3 missiles are ParticleEmitter2 / RibbonEmitter only, with no solid
//      geometry at all — those convert to an EMPTY glTF, exactly like the water
//      elemental and wisp did during the unit batch. Expect a real fraction of
//      this list to need the sprite fallback regardless.
//   2. The game data is inconsistently cased (`abilities\weapons\huntermissile`
//      is lowercase while its neighbours are not). R2 is case-sensitive and the
//      resulting 404s only show up in the DevTools Issues tab — normalise the
//      output filenames to lowercase on conversion.
console.log('');
console.log('=== 7. MISSILE / PROJECTILE MODELS (optional — art upgrade) ===');
const projPath = path.join(__dirname, '..', 'helpers', 'unitProjectiles.json');
try {
  const proj = require(projPath);
  const arts = new Set();
  for (const id in proj.units) {
    const u = proj.units[id];
    if (u.art) arts.add(u.art);
    if (u.weapon2 && u.weapon2.art) arts.add(u.weapon2.art);
  }
  const sorted = [...arts].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  console.log('Extract these ' + sorted.length + ' models (referenced by ' +
              Object.keys(proj.units).length + ' units):');
  console.log('  FROM: war3.w3mod\\Abilities\\Weapons\\   (and \\Abilities\\Spells\\ for a few)');
  console.log('  TO:   tools/map-data/abilities/weapons/');
  console.log('');
  console.log('  NOTE: the data says .mdl; CASC stores .mdx. Extract the .mdx.');
  console.log('');
  for (const a of sorted) console.log('    ' + a.replace(/\.mdl$/i, '.mdx'));
  console.log('');
  console.log('  Their BLP textures are referenced from inside each MDX, so run');
  console.log('  `node tools/inspect-mdx.js --file=<extracted.mdx>` afterwards to list');
  console.log('  what else to pull from war3.w3mod\\Textures\\.');
} catch (err) {
  console.log('  [run `node tools/extract-unit-projectiles.js` first — ' + err.message + ']');
}

console.log('');
console.log('=== SUMMARY ===');
console.log('Start with #1 (cliffs) and #3 (metadata) — those are needed first.');
console.log('Then #4 (trees) for the tileset your test map uses (L = LordaeronSummer).');
console.log('#6 (pathing) is required for accurate building footprints (Phase 1 of collision work).');
