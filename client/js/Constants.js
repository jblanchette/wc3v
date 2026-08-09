const domMap = {
  "mapInputFieldId": "input-map-file",
  "playerListId": "player-list",
  "unitListId": "unit-list",
  "unitInfoId": "unit-info"
};

window.colorMap = {
  "black": "#000000",
  "buildingOutline": "#00FF00",
  "unitPath": "#00FFFF"
};

const ScrubStates = {
  stopped: 0,
  paused: 1,
  playing: 2,
  finished: 3
};

const TeamColorList = [
  "#FF0000",
  "#0042FF",
  "#1CE6B9",
  "#FFFC01"
];

// Per-battle-category colors for the scrubber chevrons and the battle report.
// Purposely brighter than the team colors so battles read as "annotation" not
// as ownership.
window.BattleCategoryColor = {
  'harass':           '#FFD166',   // soft yellow — opportunistic
  'skirmish':         '#06D6A0',   // green — small contact
  'engagement':       '#118AB2',   // blue — standard mid-game clash
  'pitched-battle':   '#EF476F',   // red — the big one
  'base-defense':     '#7B68EE',   // purple — defenders
  'expansion-fight':  '#FF8C42',   // orange — expansion-flavored
  'tower-dive':       '#C03221',   // deep red — dive
  'creep-fight':      '#9AA0A6',   // grey — PvE
  'unknown-combat':   '#888888'    // grey — debug-only
};

const ViewModes = {
  gameplay: 0,
  buildOrder: 1
};

const BuildView = {
  live: 0,
  static: 1
};

const LayoutMode = {
  gameplay: 'gameplay',
  staticBuildOrder: 'static-bo',
  liveBuildOrder: 'live-bo',
  mobileBuildOrder: 'mobile-bo'
};

const RaceTheme = {
  'O': {
    key: 'orc',
    bg:       'rgba(255, 68, 68, 0.06)',
    bgGrad:   'linear-gradient(135deg, rgba(255,68,68,0.10) 0%, rgba(15,25,35,0.95) 100%)',
    border:   '#FF4444',
    accent:   '#FF6B6B',
    text:     '#FFB3B3',
    tierLabel:'#FF8888',
    muted:    'rgba(255,68,68,0.35)',
    rowBuilding: 'rgba(255, 50, 50, 0.18)',
    rowUnit:     'rgba(255, 170, 50, 0.14)',
    rowHero:     'rgba(255, 215, 0, 0.16)'
  },
  'H': {
    key: 'human',
    bg:       'rgba(68, 136, 255, 0.06)',
    bgGrad:   'linear-gradient(135deg, rgba(68,136,255,0.10) 0%, rgba(15,25,35,0.95) 100%)',
    border:   '#4488FF',
    accent:   '#6BA3FF',
    text:     '#B3D1FF',
    tierLabel:'#88B8FF',
    muted:    'rgba(68,136,255,0.35)',
    rowBuilding: 'rgba(50, 120, 255, 0.18)',
    rowUnit:     'rgba(100, 200, 255, 0.14)',
    rowHero:     'rgba(255, 215, 0, 0.16)'
  },
  'U': {
    key: 'undead',
    bg:       'rgba(170, 102, 255, 0.06)',
    bgGrad:   'linear-gradient(135deg, rgba(170,102,255,0.10) 0%, rgba(15,25,35,0.95) 100%)',
    border:   '#AA66FF',
    accent:   '#C490FF',
    text:     '#D9B3FF',
    tierLabel:'#BB88FF',
    muted:    'rgba(170,102,255,0.35)',
    rowBuilding: 'rgba(160, 80, 255, 0.18)',
    rowUnit:     'rgba(80, 180, 220, 0.14)',
    rowHero:     'rgba(255, 215, 0, 0.16)'
  },
  'E': {
    key: 'nightelf',
    bg:       'rgba(68, 221, 136, 0.06)',
    bgGrad:   'linear-gradient(135deg, rgba(68,221,136,0.10) 0%, rgba(15,25,35,0.95) 100%)',
    border:   '#44DD88',
    accent:   '#6BE8A6',
    text:     '#B3FFD9',
    tierLabel:'#88EEBB',
    muted:    'rgba(68,221,136,0.35)',
    rowBuilding: 'rgba(40, 200, 120, 0.18)',
    rowUnit:     'rgba(160, 220, 50, 0.14)',
    rowHero:     'rgba(255, 215, 0, 0.16)'
  }
};

// ARMOR_TYPES, ATTACK_TYPES, DAMAGE_MATRIX and ARMOR_MATRIX_KEY used to live
// here. They moved to CombatTables.js, which viewer.html loads immediately
// before this file, so every consumer still reads them as bare globals.
//
// They left because the desktop app draws the Match Summary's Unit Roster and
// Damage Matchup from them, and this file is the viewer's enum vocabulary —
// LayoutMode, ScrubStates, TeamColorList, RaceTheme. Shipping all of that to
// get four lookup tables was the wrong trade.

const formatGameTime = (gameTime) => {
  const timerDate = new Date(Math.round(gameTime * 1000) / 1000);
  const gameSecondsPrefix = timerDate.getUTCSeconds() < 10 ? '0' : '';

  return `${timerDate.getUTCMinutes()}:${gameSecondsPrefix}${timerDate.getUTCSeconds()}`;
};

////
// Short name lookups for canvas nameplates
////

const HeroShortNames = {
  'Hamg': 'AM',
  'Hblm': 'BMage',
  'Hmkg': 'MK',
  'Hpal': 'Pala',
  'Ekee': 'KotG',
  'Emoo': 'PotM',
  'Edem': 'DH',
  'Ewar': 'Warden',
  'Obla': 'Blade',
  'Ofar': 'FS',
  'Oshd': 'SH',
  'Otch': 'TC',
  'Udea': 'DK',
  'Udre': 'DL',
  'Ucrl': 'CL',
  'Ulic': 'Lich',
  'Npbm': 'Panda',
  'Nbrn': 'DR',
  'Nngs': 'Naga',
  'Nplh': 'PL',
  'Nbst': 'Beast',
  'Ntin': 'Tinker',
  'Nfir': 'FL',
  'Nalc': 'Alch'
};

const UnitShortNames = {
  'ucry': 'Fiend',
  'uobs': 'Statue',
  'umtw': 'Wagon',
  'ufro': 'F. Wyrm',
  'ospw': 'S. Walker',
  'ospm': 'S. Walker',
  'okod': 'Kodo',
  'edoc': 'DotC',
  'edot': 'DotT',
  'emtg': 'M. Giant',
  'ehpr': 'Hippo Rider',
  'hgyr': 'Gyro',
  'hgry': 'Gryphon',
  'hspt': 'Breaker',
  'hdhw': 'D. Hawk',
  'hmtt': 'Siege',
  'hrtt': 'Siege',
  'otbr': 'Batrider',
  'otbk': 'Berserker',
  'ohun': 'Headhunter',
  'odoc': 'Doc',
  'uske': 'Skeleton'
};

function getShortName (itemId, displayName) {
  if (HeroShortNames[itemId]) return HeroShortNames[itemId];
  if (UnitShortNames[itemId]) return UnitShortNames[itemId];
  return displayName;
}
