// Default-water height offsets per tileset.
//
// Used only by the synthesis fallback in helpers/minimapRenderer.js when
// war3mapMap.blp is unavailable. The BLP-decoded path never reads these.
//
// Values seeded from tools/map-data/terrainart/water.slk column "height" for
// each tileset's default *Sha (shallow) water row. WC3's actual minimap
// formula folds this into the per-corner water-plane height:
//
//   waterWorldY = (waterLevel - 0x2000) / 4 - 89.6 + WATER_OFFSETS[T] * 128
//
// (HiveWE terrain.ixx line ~879). The deep/shallow blend constants are the
// same regardless of tileset; only the threshold shifts.

const WATER_OFFSETS = {
  L: -0.7,  // Lordaeron Summer
  V: -0.7,  // Village
  F: -0.7,  // Lordaeron Fall
  X: -0.7,  // Village Fall
  W: -0.7,  // Lordaeron Winter
  N: -0.7,  // Northrend
  I: -0.7,  // Icecrown Glacier
  A: -0.6,  // Ashenvale
  C: -0.7,  // Felwood
  B: -0.7,  // Barrens
  D: -0.75, // Dungeon
  G: -0.75, // Underground
  K: -0.7,  // Cityscape
  J: -0.6,  // Dalaran Ruins
  Y: -0.4,  // Sunken Ruins
  Z: -0.6,  // Ruins
  Q: -0.7,  // Dalaran
  O: -0.5   // Outland
};

const DEFAULT_WATER_OFFSET = -0.7;

module.exports = { WATER_OFFSETS, DEFAULT_WATER_OFFSET };
