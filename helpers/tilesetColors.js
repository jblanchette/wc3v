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

// Per-palette-code color mapping: W3E 4-char ground texture codes → hex colors
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

function getFallbackPaletteColor (palette, suffix) {
  const knownPrefixes = ['L', 'W', 'A', 'B', 'J', 'Y', 'Z', 'Q', 'F', 'X', 'V', 'N', 'I', 'C', 'O'];
  for (const p of knownPrefixes) {
    const key = p + suffix;
    if (PALETTE_COLORS[key]) return PALETTE_COLORS[key];
  }
  return null;
}

module.exports = { TILESET_EXTRAS, DEFAULT_EXTRAS, PALETTE_COLORS, getFallbackPaletteColor };
