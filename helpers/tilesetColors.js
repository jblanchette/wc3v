// Per-tileset minimap colors tuned to match WC3's actual minimap feel
// ground = grass/vegetation, accent = dirt/rock/paths, water varies by theme

const TILESET_EXTRAS = {
  // Lordaeron Summer — matched to in-game Concealed Hill reference
  'L': { water: '#2a5090', shallowwater: '#9a8060', trees: '#1a5820', cliff: '#5a4a34', ground: '#57a032', accent: '#c0a070' },
  // Village — similar to Lordaeron but slightly warmer
  'V': { water: '#2a5090', shallowwater: '#9a8060', trees: '#1a5820', cliff: '#5a4a34', ground: '#57a032', accent: '#c0a070' },
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

// Per-palette-code color mapping: W3E 4-char ground texture codes → hex colors.
// Auto-computed from actual WC3 texture atlases (right-half variation averages).
const PALETTE_COLORS = {
  // Lordaeron Summer (L)
  Ldrt: '#8c6435', Ldro: '#865f33', Ldrg: '#706727', Lrok: '#856c5d',
  Lgrs: '#266f18', Lgrd: '#13570f',
  // Village (V)
  Vdrt: '#4a4724', Vdrr: '#3c3e1d', Vcrp: '#2a3217', Vcbp: '#282214',
  Vstp: '#3c3421', Vgrs: '#2c3712', Vrck: '#606543', Vgrt: '#154311',
  // Lordaeron Fall (F)
  Fdrt: '#6d5430', Fdro: '#694e2d', Fdrg: '#6a501e', Frok: '#876b5b',
  Fgrs: '#6d4c14', Fgrd: '#5e4012',
  // Village Fall (X)
  Xdrt: '#46412a', Xdtr: '#393722', Xblm: '#1e1014', Xbtl: '#7e7071',
  Xsqd: '#4c3247', Xrtl: '#726561', Xgsb: '#1b4110', Xhdg: '#061c04',
  Xwmb: '#727171',
  // Lordaeron Winter (W)
  Wdrt: '#494b3b', Wdro: '#45483a', Wsng: '#475143', Wrok: '#5b4f42',
  Wgrs: '#274641', Wsnw: '#b8c9db',
  // Northrend (N)
  Ndrt: '#243d35', Ndrd: '#162d25', Nrck: '#154043', Ngrs: '#14514d',
  Nice: '#559ab1', Nsnw: '#b5c8db', Nsnr: '#829cb0',
  // Icecrown (I)
  Idrt: '#18282c', Idtr: '#101c1f', Idki: '#0d5e6a', Iice: '#58b7cb',
  Isnw: '#96d1e3', Ibkb: '#081214', Irbk: '#172e32', Itbk: '#063136',
  Ibsq: '#081415',
  // Ashenvale (A)
  Adrt: '#404119', Adrd: '#282e0e', Agrs: '#2b5413', Arck: '#697044',
  Agrd: '#253e13', Avin: '#193914', Adrg: '#203007', Alvd: '#1b2b16',
  // Felwood (C)
  Cdrt: '#283731', Cdrd: '#1d2c24', Cgrs: '#173a20', Cpos: '#145807',
  Cvin: '#15301f', Clvg: '#11291e', Crck: '#082d19',
  // Barrens (B)
  Bdrt: '#523521', Bdrh: '#382314', Bdrr: '#3f2218', Bdrg: '#341f0b',
  Bdsr: '#80522e', Bdsd: '#683f20', Bflr: '#3b1e16', Bgrr: '#70430e',
  // Dungeon (D)
  Ddrt: '#3e1914', Dgrs: '#290e0c', Dbrk: '#391313', Ddkr: '#280e0c',
  Dlav: '#9c1e03', Dlvc: '#8b0e01', Drds: '#380e0a', Dsqd: '#3e2725',
  // Underground (G)
  Gbrk: '#1b2a29', Gdkr: '#09140d', Gdrt: '#142522', Ggrs: '#131413',
  Glav: '#28767e', Glvc: '#1a6568', Grds: '#111814', Gsqd: '#252c21',
  // Cityscape (K)
  Ksmb: '#4c170a', Kdkt: '#1e0a0a', Kdrt: '#611909', Kdtr: '#3b1205',
  Kfsl: '#682e12', Kfst: '#1d0601', Klgb: '#2e0807', Ksqt: '#0d0202',
  // Dalaran Ruins (J)
  Jdrt: '#353223', Jdtr: '#242415', Jblm: '#140c0d', Jbtl: '#2c2524',
  Jsqd: '#23141f', Jrtl: '#1f1b18', Jgsb: '#212815', Jhdg: '#0d1209',
  Jwmb: '#2f2f2f',
  // Sunken Ruins (Y)
  Ydrt: '#4a4724', Ydtr: '#3c3e1d', Yblm: '#19140d', Ybtl: '#796d5c',
  Ysqd: '#6f5e45', Yrtl: '#514a40', Ygsb: '#154311', Yhdg: '#051c03',
  Ywmb: '#76706b',
  // Ruins (Z)
  Zdrt: '#696937', Zdtr: '#41401b', Zdrg: '#354718', Zbks: '#232911',
  Zsan: '#616036', Zbkl: '#7c7e42', Ztil: '#375527', Zgrs: '#13570e',
  Zvin: '#002000',
  // Dalaran (Q)
  Qdrt: '#484427', Qdrr: '#3a3a1f', Qcrp: '#313112', Qcbp: '#261f12',
  Qstp: '#363126', Qgrs: '#35280e', Qrck: '#675845', Qgrt: '#59380b',
  // Outland (O)
  Odrt: '#611909', Odtr: '#682e12', Osmb: '#361204', Ofst: '#5d1a0a',
  Olgb: '#1d0601', Ofsl: '#6d3418', Oaby: '#000000', Orok: '#160201',
  // Cliff ground tiles — c{tileset}c{variant} codes used at cliff bases.
  // Colors derived from each tileset's cliff/rock tones in TILESET_EXTRAS.
  cLc1: '#5a4a34', cLc2: '#4d4030',
  cVc1: '#5a4a34',
  cFc1: '#302818', cFc2: '#3a3020',
  cXc1: '#302818', cXc2: '#3a3020',
  cWc1: '#404858', cWc2: '#4a5060',
  cNc2: '#384050',
  cIc1: '#283848',
  cAc1: '#1a1810',
  cCc1: '#1a1810',
  cBc1: '#403020', cBc2: '#4a3828',
  cKc1: '#202028', cKc2: '#282830',
  cJc1: '#201830', cJc2: '#281838',
  cYc1: '#101828', cYc2: '#182030',
  cZc1: '#282818', cZc2: '#303020',
  cQc1: '#281810',
  cOc1: '#281810'
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
