// Per-tileset minimap colors tuned to match WC3's actual minimap feel
// ground = grass/vegetation, accent = dirt/rock/paths, water varies by theme

const TILESET_EXTRAS = {
  // Lordaeron Summer — bright green, warm brown dirt, standard blue water
  'L': { water: '#0a2070', shallowwater: '#1838a0', trees: '#064006', cliff: '#383020', ground: '#48862a', accent: '#7a7040' },
  // Village — similar to Lordaeron but slightly warmer
  'V': { water: '#0a2070', shallowwater: '#1838a0', trees: '#064006', cliff: '#383020', ground: '#48862a', accent: '#807848' },
  // Lordaeron Fall — warm olive/amber, orange-brown, darker water
  'F': { water: '#081858', shallowwater: '#103080', trees: '#28400a', cliff: '#302818', ground: '#6a8030', accent: '#8a6830' },
  // Village Fall — autumnal, warm tones
  'X': { water: '#081858', shallowwater: '#103080', trees: '#28400a', cliff: '#302818', ground: '#687830', accent: '#886838' },
  // Lordaeron Winter — pale blue-white, icy water
  'W': { water: '#0a2868', shallowwater: '#1840a0', trees: '#1a3830', cliff: '#404858', ground: '#a8b8c0', accent: '#8898a8' },
  // Northrend — cold gray-blue, snowy
  'N': { water: '#0a2868', shallowwater: '#1840a0', trees: '#1a4030', cliff: '#384050', ground: '#90a8b0', accent: '#7888a0' },
  // Icecrown — deep icy blue, glacial
  'I': { water: '#0a1850', shallowwater: '#183070', trees: '#143828', cliff: '#283848', ground: '#88a0b8', accent: '#607088' },
  // Ashenvale — deep dark greens, mystical
  'A': { water: '#061050', shallowwater: '#0a2080', trees: '#062810', cliff: '#1a1810', ground: '#1a5028', accent: '#385030' },
  // Felwood — corrupted dark green/purple
  'C': { water: '#08104a', shallowwater: '#101870', trees: '#10200a', cliff: '#1a1810', ground: '#2a4018', accent: '#38382a' },
  // Barrens — warm tan/sandy, dry feel, warmer water
  'B': { water: '#0a2060', shallowwater: '#183888', trees: '#385018', cliff: '#403020', ground: '#88943a', accent: '#a09058' },
  // Dungeon — dark stone
  'D': { water: '#081048', shallowwater: '#101868', trees: '#1a2a1a', cliff: '#181818', ground: '#384838', accent: '#484848' },
  // Underground — very dark
  'G': { water: '#081048', shallowwater: '#101868', trees: '#142014', cliff: '#101010', ground: '#283020', accent: '#383830' },
  // Cityscape — stone/slate tones
  'K': { water: '#081858', shallowwater: '#103080', trees: '#1a2a1a', cliff: '#202028', ground: '#505060', accent: '#606068' },
  // Dalaran Ruins — purple-gray
  'J': { water: '#0a1060', shallowwater: '#182088', trees: '#1a2028', cliff: '#201830', ground: '#484068', accent: '#504870' },
  // Sunken Ruins — teal/aqua, murky
  'Y': { water: '#041838', shallowwater: '#0a2860', trees: '#062828', cliff: '#101828', ground: '#285040', accent: '#305050' },
  // Ruins — mossy stone, warm green-gray
  'Z': { water: '#0a1858', shallowwater: '#142880', trees: '#103018', cliff: '#282818', ground: '#486040', accent: '#585848' },
  // Dalaran — warm autumn, golden-brown
  'Q': { water: '#0a1858', shallowwater: '#142880', trees: '#284018', cliff: '#281810', ground: '#588038', accent: '#787048' },
  // Outland — alien red/burnt orange
  'O': { water: '#0a1848', shallowwater: '#142068', trees: '#283818', cliff: '#281810', ground: '#504828', accent: '#684030' }
};

const DEFAULT_EXTRAS = { water: '#0a2070', shallowwater: '#1838a0', trees: '#064006', cliff: '#383020', ground: '#48862a', accent: '#7a7040' };

module.exports = { TILESET_EXTRAS, DEFAULT_EXTRAS };
