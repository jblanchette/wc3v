const w3gMappings = require("../node_modules/w3gjs/dist/lib/mappings");
const unitBalanceMap = require("./UnitBalance.json").output;
const researchMeta = require("./researchMeta.json");
const spellOrderIds = require("./spellOrderIds.json");
// Per-unit movement data (base move speed, turn rate, propulsion window) extracted
// from the raw SLK tables by tools/extract-unit-movement.js. Keyed by itemId.
const unitMovementMap = require("./unitMovement.json").units;

const mapConfiguration = require("./mapConfiguration");

let {
	units,
    buildings,
    items,
    abilityToHero
} = w3gMappings;

const extraUnits = {
	'AOsf': 'Feral Spirit',
	'uske': 'Skeleton Warrior',
  'ucs1': 'Carrion Beetle (lvl 1)',
  'ucs2': 'Carrion Beetle (lvl 2)',
  'ucs3': 'Carrion Beetle (lvl 3)',
  'ucs4': 'Carrion Beetle (lvl 4)',
  'osw1': 'Spirit Wolf (lvl 1)',
  'osw2': 'Spirit Wolf (lvl 2)',
  'osw3': 'Spirit Wolf (lvl 3)',
  'hwat': 'Elemental (lvl 1)',
  'hwt2': 'Elemental (lvl 2)',
  'hwt3': 'Elemental (lvl 3)',
  'efon': 'Treant',
  'ntrs': 'Sea Turtle',
  'nmrl': 'Murloc Tide Runner',
  'nkot': 'Kobol Tunneler',
  'ngst': 'Rock Golem',
  'uktn': 'Kelthuzad Necro'
};

const extraItems = {
    'Jwid': 'Unknown Item'
};

Object.keys(extraUnits).forEach(key => {
	units[key] = extraUnits[key];
});

Object.keys(extraItems).forEach(key => {
    items[key] = extraItems[key];
});

const abilityActions = {
  'RightClick': [ 3, 0, 13, 0 ],
  'AttackCommand': [ 15, 0, 13, 0 ],
  'MoveCommand': [ 18, 0, 13, 0 ],
  'CastSkillObject': [ -105, 0, 13, 0 ],
  'CastSkillTarget': [ 154, 0, 13, 0 ],
  'CastSummonSkill': [ 158, 0, 13, 0 ],
  'CastSummonSkillNoTarget': [ 74, 2, 13, 0 ],
  'UnsummonBuilding': [ -14, 0, 13, 0 ],
  'HeroItem1': [ 40, 0, 13, 0 ],
  'HeroItem2': [ 41, 0, 13, 0 ],
  'HeroItem3': [ 42, 0, 13, 0 ],
  'HeroItem4': [ 43, 0, 13, 0 ],
  'HeroItem5': [ 44, 0, 13, 0 ],
  'HeroItem6': [ 45, 0, 13, 0 ],
  'HeroMoveItem1': [ 34, 0, 13, 0 ],
  'HeroMoveItem2': [ 35, 0, 13, 0 ],
  'HeroMoveItem3': [ 36, 0, 13, 0 ],
  'HeroMoveItem4': [ 37, 0, 13, 0 ],
  'HeroMoveItem5': [ 38, 0, 13, 0 ],
  'HeroMoveItem6': [ 39, 0, 13, 0 ],
  'HeroRevive': [ 59, 0, 13, 0 ],
  'NERoot': [ 197, 0, 13, 0 ],
  'NEUpRoot': [ 198, 0, 13, 0 ],
  'EatTree': [ -78, 0, 13, 0 ],
  'SummonElemental': [ 129, 0, 13, 0 ],
  'SummonTreants': [ 208, 0, 13, 0 ],
  'DeathCoil': [ 254, 0, 13, 0 ],
  'HarvestLumber': [ 116, 108, 84, 76 ],
  'TeleportScroll': [ 40, 0, 13, 0 ],
  'TransportLoadUnit': [ 72, 0, 13, 0 ],
  'TransportPickUp': [ 78, 0, 13, 0 ],
  'TransportUnload': [ 80, 0, 13, 0 ],
  'TransportW3C': [ 79, 0, 13, 0 ],
};


const mapStartPositions = Object.keys(mapConfiguration.maps).reduce((acc, mapKey) => {
  acc[mapKey] = mapConfiguration.maps[mapKey].startingPositions;

  return acc;
}, {});

const commonMapNames = {
  'w3c_EchoIsles.w3x':         '(2)echoisles.w3x',
  'w3c_Battleground.w3x':      '(8)battleground_lv.w3x',
  'w3c_TwistedMeadows.w3x':    '(4)twistedmeadows.w3x',
  'w3c_UpperKingdom.w3x':      '(6)upperkingdom.w3x',
  'w3c_GnollWood.w3x':         '(6)gnollwood.w3x',
  'w3c_ConcealedHill.w3x':     '(2)concealedhill.w3x',
  'w3c_NorthernIsles.w3x':     '(2)northernisles.w3x',
  'w3c_TerenasStand_LV.w3x':   '(2)terenasstand_LV.w3x',
  'w3c_SynergyBigPaved.w3x':   '(4)synergybigpaved.w3x',
  'w3c_Friends.w3x':           '(8)friends.w3x',
  'w3c_Amazonia.w3x':          '(2)amazonia.w3x',
  'w3c_LastRefuge.w3x':        '(2)lastrefuge.w3x',
  'w3c_Guardians.w3x':         '(6)guardians.w3x',
  'w3c_Monsoon_LV.w3x':        '(6)monsoon_LV.w3x',
  'w3c_BloodstoneMesa_LV.w3x': '(6)bloodstonemesa_lv.w3x'
};

const mapDataByFile = Object.keys(mapConfiguration.maps).reduce((acc, mapKey) => {
  const item = { ...mapConfiguration.maps[mapKey].info };

  acc[mapKey] = item;
  return acc;
}, {});

const abilityFlagNames = {
  'CancelTrainOrResearch': 64, // 0x40
  'LearnSkillOrTrain': 66,     // 0x42
  'Summon': 68,                // 0x44
  'TrainUnit': 70              // 0x46
};

const itemAbilityData = {
    // --- Active items (charges / cooldown abilities) ---
    'rnec': {
      'ability': 0x10,
      'type': 'summon',
      'category': 'active',
      'uses': 4,
      'stockCount': 1,
      'stockReplenish': 60,
      'cooldown': 22,
      'summonCount': 2,
      'summonItemId': 'uske',
      'summonDuration': 65,
      'goldCost': 175
    },
    'stwp': {
      'ability': 0x12,
      'category': 'consumable',
      'uses': 1,
      'goldCost': 350
    },
    'AHwe': {
      'ability': 0x10,
      'type': 'summon',
      'category': 'active',
      'summonCount': 1,
      'summonItemId': ['hwat', 'hwt2', 'hwt3'],
      'summonDuration': 60
    },
    'wswd': { 'category': 'active', 'uses': 3, 'goldCost': 200 },
    'whwd': { 'category': 'active', 'uses': 2, 'goldCost': 200 },
    'wlsd': { 'category': 'active', 'uses': 3, 'goldCost': 150 },
    'wcyc': { 'category': 'active', 'uses': 3, 'goldCost': 200 },
    'wneg': { 'category': 'active', 'uses': 3, 'goldCost': 200 },
    'woms': { 'category': 'active', 'uses': 3, 'goldCost': 200 },
    'wshs': { 'category': 'active', 'uses': 2, 'goldCost': 75 },
    'sneg': { 'category': 'active', 'uses': 1, 'goldCost': 200 },
    'stel': { 'category': 'active', 'uses': 2, 'goldCost': 150 },
    'ssil': { 'category': 'active', 'uses': 1, 'goldCost': 200 },
    'ssan': { 'category': 'active', 'uses': 2, 'goldCost': 250 },
    'will': { 'category': 'active', 'uses': 2, 'goldCost': 200 },
    'fgun': { 'category': 'active', 'uses': 3, 'goldCost': 75 },
    'stre': { 'category': 'active', 'uses': 2, 'goldCost': 200 },
    'dsum': { 'category': 'active', 'uses': 4, 'goldCost': 200 },
    'spre': { 'category': 'active', 'uses': 2, 'goldCost': 250 },

    // --- Consumable items (single-use potions / scrolls) ---
    'phea': { 'category': 'consumable', 'uses': 1, 'goldCost': 150 },
    'pman': { 'category': 'consumable', 'uses': 1, 'goldCost': 200 },
    'pghe': { 'category': 'consumable', 'uses': 1, 'goldCost': 400 },
    'pgma': { 'category': 'consumable', 'uses': 1, 'goldCost': 400 },
    'pinv': { 'category': 'consumable', 'uses': 1, 'goldCost': 100 },
    'pgin': { 'category': 'consumable', 'uses': 1, 'goldCost': 200 },
    'pnvl': { 'category': 'consumable', 'uses': 1, 'goldCost': 150 },
    'pnvu': { 'category': 'consumable', 'uses': 1, 'goldCost': 250 },
    'pspd': { 'category': 'consumable', 'uses': 1, 'goldCost': 50 },
    'pres': { 'category': 'consumable', 'uses': 1, 'goldCost': 350 },
    'pdiv': { 'category': 'consumable', 'uses': 1, 'goldCost': 200 },
    'pams': { 'category': 'consumable', 'uses': 1, 'goldCost': 100 },
    'vamp': { 'category': 'consumable', 'uses': 1, 'goldCost': 150 },
    'shea': { 'category': 'consumable', 'uses': 1, 'goldCost': 100 },
    'sman': { 'category': 'consumable', 'uses': 1, 'goldCost': 150 },
    'spro': { 'category': 'consumable', 'uses': 1, 'goldCost': 150 },
    'shas': { 'category': 'consumable', 'uses': 1, 'goldCost': 50 },
    'dust': { 'category': 'consumable', 'uses': 2, 'goldCost': 75 },
    'sreg': { 'category': 'consumable', 'uses': 1, 'goldCost': 100 },
    'hlst': { 'category': 'consumable', 'uses': 1, 'goldCost': 300 },
    'mnst': { 'category': 'consumable', 'uses': 1, 'goldCost': 350 },
    'hslv': { 'category': 'consumable', 'uses': 3, 'goldCost': 100 },
    'pclr': { 'category': 'consumable', 'uses': 1, 'goldCost': 60 },
    'plcl': { 'category': 'consumable', 'uses': 1, 'goldCost': 40 },
    'pomn': { 'category': 'consumable', 'uses': 1, 'goldCost': 150 },
    'moon': { 'category': 'consumable', 'uses': 1, 'goldCost': 50 },
    'infs': { 'category': 'consumable', 'uses': 1, 'goldCost': 250 },
    'sand': { 'category': 'consumable', 'uses': 1, 'goldCost': 200 },
    'srrc': { 'category': 'consumable', 'uses': 1, 'goldCost': 350 },
    'sror': { 'category': 'consumable', 'uses': 1, 'goldCost': 150 },
    'lure': { 'category': 'consumable', 'uses': 1, 'goldCost': 100 },
    'skul': { 'category': 'consumable', 'uses': 1, 'goldCost': 50 },
    'amrc': { 'category': 'consumable', 'uses': 3, 'goldCost': 200 },
    'gobm': { 'category': 'consumable', 'uses': 3, 'goldCost': 200 },
    'ankh': { 'category': 'consumable', 'uses': 1, 'goldCost': 500 },

    // --- Tomes (consumed immediately on pickup, never in inventory) ---
    'tdex': { 'category': 'tome' },
    'texp': { 'category': 'tome' },
    'tint': { 'category': 'tome' },
    'tkno': { 'category': 'tome' },
    'tstr': { 'category': 'tome' },
    'tpow': { 'category': 'tome' },
    'tgxp': { 'category': 'tome' },
    'tst2': { 'category': 'tome' },
    'tin2': { 'category': 'tome' },
    'tdx2': { 'category': 'tome' },
    'tret': { 'category': 'tome' },
    'manh': { 'category': 'tome' },
    'gold': { 'category': 'tome' },
    'lmbr': { 'category': 'tome' },

    // --- Permanent items (stat/passive, stay in inventory) ---
    'ofir': { 'category': 'permanent', 'goldCost': 375 },
    'ofro': { 'category': 'permanent', 'goldCost': 375 },
    'olig': { 'category': 'permanent', 'goldCost': 375 },
    'oli2': { 'category': 'permanent', 'goldCost': 375 },
    'oven': { 'category': 'permanent', 'goldCost': 325 },
    'odef': { 'category': 'permanent', 'goldCost': 375 },
    'ocor': { 'category': 'permanent', 'goldCost': 375 },
    'oslo': { 'category': 'permanent', 'goldCost': 325 },
    'bspd': { 'category': 'permanent', 'goldCost': 250 },
    'clsd': { 'category': 'permanent', 'goldCost': 100 },
    'rlif': { 'category': 'permanent', 'goldCost': 175 },
    'rwiz': { 'category': 'permanent', 'goldCost': 325 },
    'gcel': { 'category': 'permanent', 'goldCost': 150 },
    'gemt': { 'category': 'permanent', 'goldCost': 300 },
    'mcri': { 'category': 'permanent', 'goldCost': 50 },
    'spsh': { 'category': 'permanent', 'goldCost': 400 },
    'crys': { 'category': 'permanent', 'goldCost': 400 }
};

const workerForRace = {
    'O': 'opeo',
    'U': 'uaco',
    'E': 'ewsp',
    'H': 'hpea'
};

// Worker state constants
const WorkerRole = Object.freeze({ GOLD: 'gold', LUMBER: 'lumber' });

const WorkerTask = Object.freeze({
  GOLD: 'gold', LUMBER: 'lumber', BUILD: 'build',
  BURROW: 'burrow', REPAIR: 'repair', MILITIA: 'militia', IDLE: 'idle'
});

const GHOUL_ID  = 'ugho';
const BURROW_ID = 'otr';

const WORKER_IDS = new Set(['opeo', 'hpea', 'ewsp', 'uaco', GHOUL_ID]);

// NE buildings that permanently destroy the wisp on construction complete
const ANCIENT_BUILDING_IDS = new Set([
  'eaoe', // Ancient of Lore
  'eaom', // Ancient of War
  'eaow', // Ancient of Wind
  'eden', // Ancient of Wonders
  'etrp', // Ancient Protector
  'etol', // Tree of Life
  'etoa', // Tree of Ages
  'etoe', // Tree of Eternity
]);

// How each race's workers interact with buildings during construction
const BuildMechanic = Object.freeze({
  CONSUMED_PERMANENT:  'consumed_permanent',   // NE ancient: wisp destroyed forever
  CONSUMED_TEMPORARY:  'consumed_temporary',   // NE non-ancient / Orc: consumed, released on complete
  SUMMONER:            'summoner',             // Undead: acolyte starts summon, walks away free
  BUILDER:             'builder'               // Human: peasant works on-site, can be pulled away
});

// Look up a spell from the replay's orderId bytes (hero or unit ability)
// Returns { abilityId, displayName, toggle, isUnitSpell, isFormToggle, icon } or null
// toggle is null for regular casts, 'on'/'off' for autocast/toggle abilities
// icon is the WC3 FourCC code for the icon file (unit abilities only)
const lookupSpellFromOrderId = (itemIdBytes) => {
  if (!Array.isArray(itemIdBytes)) return null;
  const key = itemIdBytes.join(',');
  const raw = spellOrderIds[key];
  if (!raw) return null;

  const colonIdx = raw.indexOf(':');
  const abilityId = colonIdx >= 0 ? raw.substring(0, colonIdx) : raw;
  const toggle = colonIdx >= 0 ? raw.substring(colonIdx + 1) : null;

  const ability = heroAbilities[abilityId] || unitAbilities[abilityId];
  const isUnitSpell = !heroAbilities[abilityId] && !!unitAbilities[abilityId];
  return {
    abilityId,
    displayName: ability ? ability.displayName : abilityId,
    toggle,
    isUnitSpell,
    isFormToggle: !!(ability && ability.isFormToggle),
    icon: (ability && ability.icon) || null
  };
};

const raceBuildMechanic = (race, buildingItemId) => {
  switch (race) {
    case 'E':
      return ANCIENT_BUILDING_IDS.has(buildingItemId)
        ? BuildMechanic.CONSUMED_PERMANENT
        : BuildMechanic.CONSUMED_TEMPORARY;
    case 'O': return BuildMechanic.CONSUMED_TEMPORARY;
    case 'U': return BuildMechanic.SUMMONER;
    case 'H': return BuildMechanic.BUILDER;
    default:  return BuildMechanic.BUILDER;
  }
};

const getBuildTime = (itemId) => {
  if (buildTimings[itemId]) return buildTimings[itemId];
  const balance = unitBalanceMap[itemId];
  if (balance && balance.buildTime) return balance.buildTime;
  return 60; // safe default
};

const isWorkerUnit = (unit) =>
  (unit.meta && unit.meta.worker) || unit.itemId === GHOUL_ID;

const defaultWorkerRole = (unit) =>
  unit.itemId === GHOUL_ID ? WorkerRole.LUMBER : WorkerRole.GOLD;

const unitMetaData = {
    'uobs': {
        'displayName': 'Obsidian Statue',
        'hero': false,
        'worker': false,
        'permanent': true,
        'playerShop': false,
        'race': 'H',
        'movespeed': 190,
        'evolution': {
            'itemId': 'ubsp',
            'time': 45
        } 
    },
	'opeo': {
		'displayName': 'Peon',
		'hero': false,
		'worker': true,
		'permanent': true,
        'playerShop': false,
        'race': 'O',
        'movespeed': 190
	},
	'uaco': {
		'displayName': 'Acolyte',
		'hero': false,
		'worker': true,
		'permanent': true,
        'playerShop': false,
        'race': 'U',
        'movespeed': 235
	},
	'ewsp': {
		'displayName': 'Wisp',
		'hero': false,
		'worker': true,
		'permanent': true,
        'playerShop': false,
        'race': 'E',
        'movespeed': 270
	},
	'hpea': {
		'displayName': 'Peasent',
		'hero': false,
		'worker': true,
		'permanent': true,
        'playerShop': false,
        'race': 'H',
        'movespeed': 190,
        'evolution': {
            'itemId': 'hmil',
            'time': 45
        }
	},
    'hmil': {
        'displayName': 'Militia',
        'hero': false,
        'worker': true,
        'permanent': true,
        'playerShop': false,
        'race': 'H',
        'movespeed': 190
    },
	'Hamg': {
		'displayName': 'Archmage',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
	},
  'Hblm': {
		'displayName': 'Blood Mage',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
	},
  'Hmkg': {
		'displayName':'Mountain King',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
	},
  'Hpal': {
		'displayName':'Paladin',
		'hero': true,
		'worker': false,
		'permanent': true
	},
  'Ewar': {
		'displayName':'Warden',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
	},
  'Ekee': {
		'displayName':'Keeper of the Grove',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
	},
  'Emoo': {
		'displayName':'Priestess of the Moon',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
	},
  'Edem': {
		'displayName':'Demon Hunter',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
	},
  'Oshd': {
		'displayName':'Shadow Hunter',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
	},
  'Obla': {
		'displayName':'Blademaster',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
	},
  'Ofar': {
		'displayName':'Far Seer',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
  },
  'Otch': {
		'displayName':'Tauren Chieftain',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
  },
  'Ucrl': {
		'displayName':'Crypt Lord',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
  },
  'Udea': {
		'displayName':'Death Knight',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false,
        'movespeed': 300
  },
  'Udre': {
		'displayName':'Dread Lord',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
  },
  'Ulic': {
		'displayName':'Lich',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
  },
  'Npbm': {
		'displayName':'Pandaren Brewmaster',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
  },
  'Nbrn': {
		'displayName':'Dark Ranger',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
  },
  'Nngs': {
		'displayName':'Naga Sea Witch',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
  },
  'Nplh': {
		'displayName':'Pit Lord',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
  },
  'Nbst': {
		'displayName':'Beastmaster',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
  },
  'Ntin': {
		'displayName':'Goblin Tinker',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
  },
  'Nfir': {
		'displayName':'FireLord',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
  },
  'Nalc': {
		'displayName':'Goblin Alchemist',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
  }
};

const allItemIds = {
    'AEah': 'Thorns Aura',
    'AEar': 'Trueshot',
    'AEbl': 'Blink',
    'AEer': 'Entangling Roots',
    'AEev': 'Evasion',
    'AEfk': 'Fan of Knives',
    'AEfn': 'Force of Nature',
    'AEim': 'Immolation',
    'AEmb': 'Mana Burn',
    'AEme': 'Metamorphosis',
    'AEsf': 'Starfall',
    'AEsh': 'Shadow Strike',
    'AEst': 'Scout',
    'AEsv': 'Vengence',
    'AEtq': 'Tranquility',
    'AHab': 'Brilliance Aura',
    'AHad': 'Devotion Aura',
    'AHav': 'Avatar',
    'AHbh': 'Bash',
    'AHbn': 'Banish',
    'AHbz': 'Blizzard',
    'AHdr': 'Siphon Mana',
    'AHds': 'Divine Shield',
    'AHfa': 'Searing Arrows',
    'AHfs': 'Flame Strike',
    'AHhb': 'Holy Light',
    'AHmt': 'Mass Teleport',
    'AHpx': 'Summon Phoenix',
    'AHre': 'Resurrection',
    'AHtb': 'Storm Bolt',
    'AHtc': 'Thunder Clap',
    'AHwe': 'Summon Water Elemental',
    'AOae': 'Endurance Aura',
    'AOcl': 'Chain Lightning',
    'AOcr': 'Critical Strike',
    'AOeq': 'Earthquake',
    'AOfs': 'Far Sight',
    'AOhw': 'Healing Wave',
    'AOhx': 'Hex',
    'AOmi': 'Mirror Image',
    'AOre': 'Reincarnation',
    'AOsf': 'Feral Spirit',
    'AOsh': 'Shockwave',
    'AOsw': 'Serpent Ward',
    'AOvd': 'Big Bad Voodoo',
    'AOwk': 'Wind Walk',
    'AOws': 'War Stomp',
    'AOww': 'Blade Storm',
    'AUan': 'Animate Dead',
    'AUau': 'Unholy Aura',
    'AUav': 'Vampiric Aura',
    'ucs1': 'Carrion Beetles',
    'AUcs': 'Carrion Swarm',
    'AUdc': 'Death Coil',
    'AUdd': 'Death and Decay',
    'AUdp': 'Death Pact',
    'AUdr': 'Dark Ritual',
    'AUfn': 'Frost Nova',
    'AUfu': 'Frost Armor',
    'AUim': 'Impale',
    'AUin': 'Inferno',
    'AUls': 'Locust Swarm',
    'AUsl': 'Sleep',
    'AUts': 'Spiked Carapace',
    'AUfa': 'Frost Armor',
    'AUcb': 'Carrion Beetles',
    'ANbf': 'Breath of Fire',
    'ANdb': 'Drunken Brawler',
    'ANdh': 'Drunken Haze',
    'ANef': 'Storm Earth and Fire',
    'ANdr': 'Life Drain',
    'ANsi': 'Silence',
    'ANba': 'Black Arrow',
    'ANch': 'Charm',
    'ANms': 'Mana Shield',
    'ANfa': 'Frost Arrows',
    'ANfl': 'Forked Lightning',
    'ANto': 'Tornado',
    'ANrf': 'Rain of Fire',
    'ANca': 'Cleaving Attack',
    'ANht': 'Howl of Terror',
    'ANdo': 'Doom',
    'ANsg': 'Summon Bear',
    'ANsq': 'Summon Quilbeast',
    'ANsw': 'Summon Hawk',
    'ANst': 'Stampede',
    'ANeg': 'Engineering Upgrade',
    'ANcs': 'Cluster Rockets',
    'ANc1': 'Cluster Rockets',
    'ANc2': 'Cluster Rockets',
    'ANc3': 'Cluster Rockets',
    'ANsy': 'Pocket Factory',
    'ANs1': 'Pocket Factory',
    'ANs2': 'Pocket Factory',
    'ANs3': 'Pocket Factory',
    'ANrg': 'Robo-Goblin',
    'ANg1': 'Robo-Goblin',
    'ANg2': 'Robo-Goblin',
    'ANg3': 'Robo-Goblin',
    'ANic': 'Incinerate',
    'ANia': 'Incinerate',
    'ANso': 'Soul Burn',
    'ANlm': 'Summon Lava Spawn',
    'ANvc': 'Volcano',
    'ANhs': 'Healing Spray',
    'ANab': 'Acid Bomb',
    'ANcr': 'Chemical Rage',
    'ANtm': 'Transmute',
    'eaoe': 'Ancient of Lore',
    'eaom': 'Ancient of War',
    'eaow': 'Ancient of Wind',
    'earc': 'Archer',
    'eate': 'Altar of Elders',
    'ebal': 'Ballista',
    'Ecen': 'Cenarius',
    'echm': 'Chimeara',
    'edcm': 'Druid of the Claw (Metamophed)',
    'Edem': 'Demon Hunter',
    'eden': 'Ancient of Wonders',
    'Edmm': 'Demon Hunter (Metamophed)',
    'edo': 'Hunter\'s Hall',
    'edoc': 'Druid of the Claw',
    'edol': 'Bear Den',
    'edos': 'Chimaera Roost',
    'edot': 'Druid of the Talon',
    'edry': 'Dryad',
    'edtm': 'Druid of the Talon (Metamophed)',
    'Eevi': 'Illidan',
    'Eevm': 'Illidan Demon',
    'efdr': 'Faerie Dragon',
    'efon': 'Ent',
    'egol': 'Entangled Gold Mine',
    'ehip': 'Hippogryph',
    'ehpr': 'Hippogryph Rider',
    'Ekee': 'Keeper of the Grove',
    'Emoo': 'Priestess of the Moon',
    'emow': 'Moon Well',
    'emtg': 'Mountain Giant',
    'esen': 'Huntress',
    'eshd': 'Shandris',
    'etoa': 'Tree of Ages',
    'etoe': 'Tree of Eternity',
    'etol': 'Tree of Life',
    'etrp': 'Ancient Protector',
    'Ewar': 'Warden',
    'Ewrd': 'Maiev',
    'ewsp': 'Wisp',
    'halt': 'Altar of Kings',
    'Hamg': 'Archmage',
    'harm': 'Workshop',
    'hars': 'Arcane Sanctum',
    'hatw': 'Arcane Tower',
    'hbar': 'Barracks',
    'hbep': 'Blood Elf Priest',
    'hbes': 'Blood Elf Sorceress',
    'hbla': 'Blacksmith',
    'Hblm': 'Blood Mage',
    'hcas': 'Castle',
    'hcth': 'High Elf Footman',
    'hctw': 'Cannon Tower',
    'hdhw': 'Dragonhawk Rider',
    'hfoo': 'Footman',
    'hgra': 'Aviary',
    'hgry': 'Gryphon Rider',
    'hgtw': 'Guard Tower',
    'hgyr': 'Flying Machine',
    'hhes': 'High Elf Swordman',
    'hhou': 'House',
    'Hjai': 'Jaina',
    'Hkal': 'Kael\'thas',
    'hkee': 'Keep',
    'hkni': 'Knight',
    'Hlgr': 'Garithos',
    'hlum': 'Lumber Mill',
    'Hmbr': 'Muradin',
    'hmil': 'Militia',
    'Hmkg': 'Mountain King',
    'hmpr': 'Priest',
    'hmtm': 'Mortar',
    'hmtt': 'Siege Engine',
    'Hpal': 'Paladin',
    'hpea': 'Peasant',
    'hrif': 'Rifleman',
    'hrtt': 'Siege Engine (Rocket)',
    'hsor': 'Sorceress',
    'hspt': 'Spell Breaker',
    'htow': 'Town Hall',
    'htws': 'Church',
    'hvlt': 'Arcane Vault',
    'Hvsh': 'Lady Vashj',
    'Hvwd': 'Sylvanus',
    'hwtw': 'Watch Tower',
    'nbal': 'Doomgaurd',
    'Nbbc': 'Chaos Blademaster',
    'ncap': 'Corrupt Protector',
    'ncaw': 'Corrup Ancient of War',
    'nchg': 'Chaos Grunt',
    'nchr': 'Chaos Raider',
    'nchw': 'Chaos Warlock',
    'nck': 'Chaos Kodo Beast',
    'ncmw': 'Corrupt Moon Well',
    'ncpn': 'Chaos Peon',
    'nctl': 'Corrupt Tree of Life',
    'ndmg': 'Demon Gate',
    'nefm': 'High Elf Farm',
    'negf': 'High Elf Earth',
    'negm': 'High Elf Sky',
    'negt': 'High Elf Guard Tower',
    'negt': 'High Elf Tower',
    'nenc': 'Corrupt Treant',
    'nenp': 'Poison Treant',
    'nepl': 'Plauge Treant',
    'nfel': 'Felhound',
    'nfr': 'Furbolg Tracker',
    'nfre': 'Furbolg Elder',
    'nfrg': 'Furbolg Champion',
    'nfrl': 'Furbolg',
    'nfrs': 'Furbolg Shaman',
    'ngsp': 'Sapper',
    'nhea': 'High Elf Archer',
    'nhe': 'High Elf Barracks',
    'nhew': 'Blood Elf Peasant',
    'nhyc': 'Dragon Turtle',
    'ninf': 'Infernal',
    'nmpe': 'Mur\'gul Slave',
    'nmyr': 'Myrmidon',
    'nnad': 'Altar of the Depths',
    'nnfm': 'Coral Bed',
    'Nngs': 'Naga Sorceress',
    'nnmg': 'Mur\'gul Reaver',
    'nnrg': 'Naga Royal Guard',
    'nnsa': 'Shrine of Azshara',
    'nnsg': 'Naga Spawning Grounds',
    'nnsw': 'Naga Siren',
    'nntg': 'Tidal Guardian',
    'nntt': 'Temple of Tides',
    'nomg': 'Ogre Magi',
    'npgf': 'Pig Farm',
    'Npld': 'Pit Lord',
    'nrwm': 'Orc Dragonrider',
    'nsat': 'Trickster',
    'nsfp': 'Forest Troll Shadow Priest',
    'nska': 'Skeleton Archer',
    'nskf': 'Burning Archer',
    'nskg': 'Giant Skeleton Warrior',
    'nskm': 'Skeletal Marksman',
    'nsnp': 'Snap Dragon',
    'nsth': 'Hellcaller',
    'nstl': 'Soulstealer',
    'nsts': 'Shadowdancer',
    'nsty': 'Satyr',
    'nw2w': 'Warcraft II Warlock',
    'nwgs': 'Couatl',
    'nws1': 'Dragon Hawk',
    'nzep': 'Zepplin',
    'oalt': 'Altar of Storms',
    'oang': 'Guardian',
    'obar': 'Orc Barracks',
    'obea': 'Beastiary',
    'Obla': 'Blademaster',
    'ocat': 'Catapult',
    'ocbw': 'Chaos Burrow',
    'odoc': 'Troll Witch Doctor',
    'Ofar': 'Far Seer',
    'ofor': 'Forge',
    'ofrt': 'Fortress',
    'ogre': 'Great Hall',
    'Ogrh': 'Grom Hellscream',
    'ogru': 'Grunt',
    'ohun': 'Troll Headhunter',
    'okod': 'Kodo Beast',
    'opeo': 'Peon',
    'Opgh': 'Chaos Grom Hellscream',
    'orai': 'Raider',
    'Oshd': 'Shadow Hunter',
    'oshm': 'Shaman',
    'osld': 'Spirit Lodge',
    'ospm': 'Spirit Walker (Metamophed)',
    'ospw': 'Spirit Walker',
    'ostr': 'Stronghold',
    'otau': 'Tauren',
    'otbk': 'Troll Berserker',
    'otbr': 'Troll Batrider',
    'Otch': 'Tauren Chieftain',
    'Othr': 'Thrall',
    'otr': 'Burrow',
    'otto': 'Tauren Totem',
    'ovln': 'Voodoo Lounge',
    'owtw': 'Orc Watch Tower',
    'owyv': 'Wyvern',
    'Rec': 'Upgrade Corrosive Breath',
    'Redc': 'Upgrade Druid of the Claw',
    'Redt': 'Upgrade Druid of the Talon',
    'Ree': 'Upgrade Mark of the Claw',
    'Reec': 'Upgrade Mark of the Talon',
    'Rehs': 'Upgrade Hardened Skin',
    'Reht': 'Upgrade Hippogryph Taming',
    'Rei': 'Upgrade Improved Bows',
    'Rema': 'Upgrade Moon Armor',
    'Remg': 'Upgrade Moon Glaive',
    'Remk': 'Upgrade Marksmanship',
    'Ren': 'Upgrade Nature\'s Blessing',
    'Repd': 'Upgrade Vorpal Blades',
    'Rerh': 'Upgrade Reinforced Hides',
    'Rers': 'Upgrade Resistant Skin',
    'Resc': 'Upgrade Sentinel',
    'Resi': 'Upgrade Abolish Magic',
    'Resm': 'Upgrade Strength of the Moon',
    'Resw': 'Upgrade Strength of the Wild',
    'Reuv': 'Upgrade Ultravision',
    'Rews': 'Upgrade Well Sprint',
    'Rhaa': 'Upgrade ARTILLERY',
    'Rhac': 'Upgrade Masonry',
    'Rhan': 'Upgrade Animal War Training',
    'Rhar': 'Upgrade Plating',
    'Rhcd': 'Upgrade Cloud',
    'Rhde': 'Upgrade Defend',
    'Rhfc': 'Upgrade Flak Cannons',
    'Rhfs': 'Upgrade Fragmentation Shards',
    'Rhg': 'Upgrade Flying Machine Bombs',
    'Rhh': 'Upgrade Storm Hammers',
    'Rhla': 'Upgrade Leather Armor',
    'Rhlh': 'Upgrade Lumber Harvesting',
    'Rhme': 'Upgrade Melee Weapons',
    'Rhmi': 'Upgrade GOLD',
    'Rhpt': 'Upgrade Priest Training',
    'Rhra': 'Upgrade Ranged Weapons',
    'Rhri': 'Upgrade Long Rifles',
    'Rhrt': 'Upgrade Barrage',
    'Rhse': 'Upgrade Magic Sentry',
    'Rhsr': 'Upgrade Flare',
    'Rhss': 'Upgrade Control Magic',
    'Rhst': 'Upgrade Sorceress Training',
    'Rnam': 'Upgrade Naga Armor',
    'Rnat': 'Upgrade Naga Attack',
    'Rnen': 'Upgrade Naga Ensnare',
    'Rnsi': 'Upgrade Naga Abolish Magic',
    'Rnsw': 'Upgrade Siren',
    'Roaa': 'Upgrade Orc Artillery',
    'Roar': 'Upgrade Unit Armor',
    'Robf': 'Upgrade Burning Oil',
    'Robk': 'Upgrade Berserker Upgrade',
    'Robs': 'Upgrade Berserker Strength',
    'Roch': 'Upgrade Chaos',
    'Roen': 'Upgrade Ensnare',
    'Rolf': 'Upgrade Liquid Fire',
    'Rome': 'Upgrade Melee Weapons',
    'Ropg': 'Upgrade Pillage',
    'Rora': 'Upgrade Ranged Weapons',
    'Ror': 'Upgrade Reinforced Defenses',
    'Rosp': 'Upgrade Spiked Barricades',
    'Rost': 'Upgrade Shaman Training',
    'Rotr': 'Upgrade Troll Regeneration',
    'Rovs': 'Upgrade Envenomed Spears',
    'Rowd': 'Upgrade Witch Doctor Training',
    'Rows': 'Upgrade Pulverize',
    'Rowt': 'Upgrade Spirit Walker Training',
    'Rua': 'Upgrade ABOM',
    'Ruac': 'Upgrade Cannibalize',
    'Ruar': 'Upgrade Unholy Armor',
    'Ruax': 'Upgrade ABOM_EXPL',
    'Ruba': 'Upgrade Banshee Training',
    'Rubu': 'Upgrade Burrow',
    'Rucr': 'Upgrade Creature Carapace',
    'Ruex': 'Upgrade Exhume Corpses',
    'Ruf': 'Upgrade Freezing Breath',
    'Rugf': 'Upgrade Ghoul Frenzy',
    'Rume': 'Upgrade Unholy Strength',
    'Rump': 'Upgrade MEAT_WAGON',
    'Rune': 'Upgrade Necromancer Training',
    'Rupc': 'Upgrade Disease Cloud',
    'Rura': 'Upgrade Creature Attack',
    'Rurs': 'Upgrade SACRIFICE',
    'Rusf': 'Upgrade Stone Form',
    'Rusl': 'Upgrade Skeletal Longevity',
    'Rusm': 'Upgrade Skeletal Mastery',
    'Rusp': 'Upgrade Destroyer Form',
    'Ruw': 'Upgrade We',
    'Rwdm': 'Upgrade War Drums Damage Increase',
    'uabo': 'Abomination',
    'uaco': 'Acolyte',
    'uaod': 'Altar of Darkness',
    'uar': 'Undead Barge',
    'uban': 'Banshee',
    'ubon': 'Boneyard',
    'ubsp': 'Destroyer',
    'Ucrl': 'Crypt Lord',
    'ucry': 'Crypt Fiend',
    'Udea': 'Death Knight',
    'Udre': 'Dread Lord',
    'Udth': 'Detheroc',
    'ufro': 'Frost Wyrm',
    'ugar': 'Gargoyle',
    'ugho': 'Ghoul',
    'ugol': 'Haunted Gold Mine',
    'ugrm': 'Gargoyle (Stone)',
    'ugrv': 'Graveyard',
    'ugsp': 'Gargoyle Spire',
    'Ulic': 'Lich',
    'Umal': 'Malganis',
    'umtw': 'Meat Wagon',
    'unec': 'Necromancer',
    'unp1': 'Halls of the Dead',
    'unp2': 'Black Citadel',
    'unpl': 'Necropolis',
    'uobs': 'Obsidian Statue',
    'usap': 'Sacrificial Pit',
    'usep': 'Crypt',
    'ushd': 'Shade',
    'uske': 'Skeleton Warrior',
    'uslh': 'Slaughterhouse',
    'Utic': 'Tichondrius',
    'utod': 'Temple of the Damned',
    'utom': 'Tomb of Relics',
    'uzg1': 'Spirit Tower',
    'uzg2': 'Nerubian Tower',
    'uzig': 'Ziggurat',
    //# Others
    'nskf': 'Burning Archer',
    'nws1': 'Dragon Hawk',
    'nban': 'Bandit',
    'nrog': 'Rogue',
    'nenf': 'Enforcer',
    'nass': 'Assassin',
    'nbdk': 'Black Drake',
    'nrdk': 'Red Dragon Whelp',
    'nbdr': 'Black Dragon Whelp',
    'nrdr': 'Red Drake',
    'nbwm': 'Black Dragon',
    'nrwm': 'Red Dragon',
    'nadr': 'Blue Dragon',
    'nadw': 'Blue Dragon Whelp',
    'nadk': 'Blue Drake',
    'nbzd': 'Bronze Dragon',
    'nbzk': 'Bronze Drake',
    'nbzw': 'Bronze Dragon Whelp',
    'ngrd': 'Green Dragon',
    'ngdk': 'Green Drake',
    'ngrw': 'Green Dragon Whelp',
    'ncea': 'Centaur Archer',
    'ncen': 'Centaur Outrunner',
    'ncer': 'Centaur Drudge',
    'ndth': 'Dark Troll High Priest',
    'ndtp': 'Dark Troll Shadow Priest',
    'ndt': 'Dark Troll Berserker',
    'ndtw': 'Dark Troll WarLord',
    'ndtr': 'Dark Troll',
    'ndtt': 'Dark Troll Trapper',
    'nfsh': 'Forest Troll High Priest',
    'nfsp': 'Forest Troll Shadow Priest',
    'nftr': 'Forest Troll',
    'nft': 'Forest Troll Berserker',
    'nftt': 'Forest Troll Trapper',
    'nftk': 'Forest Troll WarLord',
    'ngrk': 'Mud Golem',
    'ngir': 'Goblin Shredder',
    'nfrs': 'Furbolg Shaman',
    'ngna': 'Gnoll Poacher',
    'ngns': 'Gnoll Assassin',
    'ngno': 'Gnoll',
    'ngn': 'Gnoll Brute',
    'ngnw': 'Gnoll Warden',
    'ngnv': 'Gnoll Overseer',
    'ngsp': 'Goblin Sapper',
    'nhrr': 'Harpy Rogue',
    'nhrw': 'Harpy Windwitch',
    'nits': 'Ice Troll Berserker',
    'nitt': 'Ice Troll Trapper',
    'nko': 'Kobold',
    'nkog': 'Kobold Geomancer',
    'nthl': 'Thunder Lizard',
    'nmfs': 'Murloc Flesheater',
    'nmrr': 'Murloc Huntsman',
    'now': 'Wildkin',
    'nrzm': 'Razormane Medicine Man',
    'nnwa': 'Nerubian Warrior',
    'nnwl': 'Nerubian Webspinner',
    'nogr': 'Ogre Warrior',
    'nogm': 'Ogre Mauler',
    'nogl': 'Ogre Lord',
    'nomg': 'Ogre Magi',
    'nrvs': 'Frost Revenant',
    'nslf': 'Sludge Flinger',
    'nsts': 'Satyr Shadowdancer',
    'nstl': 'Satyr Soulstealer',
    'nzep': 'Goblin Zeppelin',
    'ntrt': 'Giant Sea Turtle',
    'nlds': 'Makrura Deepseer',
    'nlsn': 'Makrura Snapper',
    'nmsn': 'Mur\'gul Snarecaster',
    'nsc': 'Spider Crab Shorecrawler',
    'nbot': 'Transport Ship',
    'nsc2': 'Spider Crab Limbripper',
    'nsc3': 'Spider Crab Behemoth',
    'nbdm': 'Blue Dragonspawn Meddler',
    'nmgw': 'Magnataur Warrior',
    'nan': 'Barbed Arachnathid',
    'nanm': 'Barbed Arachnathid',
    'nfps': 'Polar Furbolg Shaman',
    'nmgv': 'Magic Vault',
    'nit': 'Icy Treasure Box',
    'npfl': 'Fel Beast',
    'ndrd': 'Draenei Darkslayer',
    'ndrm': 'Draenei Disciple',
    'nvdw': 'Voidwalker',
    'nvdg': 'Greater Voidwalker',
    'nnht': 'Nether Dragon Hatchling',
    'nndk': 'Nether Drake',
    'nndr': 'Nether Dragon',
    //# real items
    'LTlt': 'Tree',
    'nmer': 'Merchant',
    'ntav': 'Tavern',
    'ngol': 'Goldmine',
    'ngme': 'Goblin Merchant',
    'nmrk': 'Mercenary Camp',
    'ngad': 'Goblin Laboratory',
    'nmr0': 'Mercenary Camp', 'nmr2': 'Mercenary Camp', 'nmr4': 'Mercenary Camp',
    'nmr6': 'Mercenary Camp', 'nmr8': 'Mercenary Camp', 'nmra': 'Mercenary Camp',
    'nmrc': 'Mercenary Camp', 'nmre': 'Mercenary Camp',
    'amrc': 'Amulet of Recall',
    'ankh': 'Ankh of Reincarnation',
    'belv': 'Boots of Quel\'Thalas +6',
    'bgst': 'Belt of Giant Strength +6',
    'bspd': 'Boots of Speed',
    'ccmd': 'Scepter of Mastery',
    'ciri': 'Robe of the Magi +6',
    'ckng': 'Crown of Kings +5',
    'clsd': 'Cloak of Shadows',
    'crys': 'Crystal Ball',
    'desc': 'Kelen\'s Dagger of Escape',
    'gemt': 'Gem of True Seeing',
    'gobm': 'Goblin Land Mines',
    'gsou': 'Soul Gem',
    'guvi': 'Glyph of Ultravision',
    'gfor': 'Glyph of Fortification',
    'soul': 'Soul',
    'mdp': 'Medusa Pebble',
    'rag1': 'Slippers of Agility +3',
    'rat3': 'Claws of Attack +3',
    'rin1': 'Mantle of Intelligence +3',
    'rde1': 'Ring of Protection +2',
    'rde2': 'Ring of Protection +3',
    'rde3': 'Ring of Protection +4',
    'rhth': 'Khadgar\'s Gem of Health',
    'rst1': 'Gauntlets of Ogre Strength +3',
    'ofir': 'Orb of Fire',
    'ofro': 'Orb of Frost',
    'olig': 'Orb of Lightning',
    'oli2': 'Orb of Lightning',
    'oven': 'Orb of Venom',
    'odef': 'Orb of Darkness',
    'ocor': 'Orb of Corruption',
    'pdiv': 'Potion of Divinity',
    'phea': 'Potion of Healing',
    'pghe': 'Potion of Greater Healing',
    'pinv': 'Potion of Invisibility',
    'pgin': 'Potion of Greater Invisibility',
    'pman': 'Potion of Mana',
    'pgma': 'Potion of Greater Mana',
    'pnvu': 'Potion of Invulnerability',
    'pnvl': 'Potion of Lesser Invulnerability',
    'pres': 'Potion of Restoration',
    'pspd': 'Potion of Speed',
    'rlif': 'Ring of Regeneration',
    'rwiz': 'Sobi Mask',
    'sfog': 'Horn of the Clouds',
    'shea': 'Scroll of Healing',
    'sman': 'Scroll of Mana',
    'spro': 'Scroll of Protection',
    'sres': 'Scroll of Restoration',
    'ssil': 'Staff of Silence',
    'stwp': 'Scroll of Town Portal',
    'tels': 'Goblin Night Scope',
    'tdex': 'Tome of Agility',
    'texp': 'Tome of Experience',
    'tint': 'Tome of Intelligence',
    'tkno': 'Tome of Power',
    'tstr': 'Tome of Strength',
    'ward': 'Warsong Battle Drums',
    'will': 'Wand of Illusion',
    'wneg': 'Wand of Negation',
    'rdis': 'Rune of Dispel Magic',
    'rwat': 'Rune of the Watcher',
    'fgrd': 'Red Drake Egg',
    'fgrg': 'Stone Token',
    'fgdg': 'Demonic Figurine',
    'fgfh': 'Spiked Collar',
    'fgsk': 'Book of the Dead',
    'engs': 'Enchanted Gemstone',
    'k3m1': 'Mooncrystal',
    'modt': 'Mask of Death',
    'sand': 'Scroll of Animate Dead',
    'srrc': 'Scroll of Resurrection',
    'sror': 'Scroll of the Beast',
    'infs': 'Inferno Stone',
    'shar': 'Ice Shard',
    'wild': 'Amulet of the Wild',
    'wswd': 'Sentry Wards',
    'whwd': 'Healing Wards',
    'wlsd': 'Wand of Lightning Shield',
    'wcyc': 'Wand of the Wind',
    'rnec': 'Rod of Necromancy',
    'pams': 'Anti-magic Potion',
    'clfm': 'Cloak of Flames',
    'evtl': 'Talisman of Evasion',
    'nspi': 'Necklace of Spell Immunity',
    'lhst': 'The Lion Horn of Stormwind',
    'kpin': 'Khadgar\'s Pipe of Insight',
    'sbch': 'Scourge Bone Chimes',
    'afac': 'Alleria\'s Flute of Accuracy',
    'ajen': 'Ancient Janggo of Endurance',
    'lgdh': 'Legion Doom-Horn',
    'hcun': 'Hood of Cunning',
    'mcou': 'Medallion of Courage',
    'hval': 'Helm of Valor',
    'cno': 'Circlet of Nobility',
    'prvt': 'Periapt of Vitality',
    'tgxp': 'Tome of Greater Experience',
    'mnst': 'Mana Stone',
    'hlst': 'Health Stone',
    'tpow': 'Tome of Knowledge',
    'tst2': 'Tome of Strength +2',
    'tin2': 'Tome of Intelligence +2',
    'tdx2': 'Tome of Agility +2',
    'rde0': 'Ring of Protection +1',
    'rde4': 'Ring of Protection +5',
    'rat6': 'Claws of Attack +6',
    'rat9': 'Claws of Attack +9',
    'ratc': 'Claws of Attack +12',
    'ratf': 'Claws of Attack +15',
    'manh': 'Manual of Health',
    'pmna': 'Pendant of Mana',
    'penr': 'Pendant of Energy',
    'gcel': 'Gloves of Haste',
    'totw': 'Talisman of the Wild',
    'phlt': 'Phat Lewt',
    'gopr': 'Glyph of Purification',
    'ches': 'Cheese',
    'mlst': 'Maul of Strength',
    'rnsp': 'Ring of Superiority',
    'brag': 'Bracer of Agility',
    'sksh': 'Skull Shield',
    'vddl': 'Voodoo Doll',
    'sprn': 'Spider Ring',
    'tmmt': 'Totem of Might',
    'anfg': 'Ancient Figurine',
    'lnrn': 'Lion\'s Ring',
    'iwbr': 'Ironwood Branch',
    'jdrn': 'Jade Ring',
    'drph': 'Druid Pouch',
    'hslv': 'Healing Salve',
    'pclr': 'Clarity Potion',
    'plcl': 'Lesser Clarity Potion',
    'rej1': 'Minor Replenishment Potion',
    'rej2': 'Lesser Replenishment Potion',
    'rej3': 'Replenishment Potion',
    'rej4': 'Greater Replenishment Potion',
    'rej5': 'Lesser Scroll of Replenishment',
    'rej6': 'Greater Scroll of Replenishment',
    'sreg': 'Scroll of Regeneration',
    'gold': 'Gold Coins',
    'lmbr': 'Bundle of Lumber',
    'fgun': 'Flare Gun',
    'pomn': 'Potion of Omniscience',
    'gomn': 'Glyph of Omniscience',
    'wneu': 'Wand of Neutralization',
    'silk': 'Spider Silk Broach',
    'lure': 'Monster Lure',
    'skul': 'Sacrificial Skull',
    'moon': 'Moonstone',
    'brac': 'Runed Bracers',
    'vamp': 'Vampiric Potion',
    'woms': 'Wand of Mana Stealing',
    'tcas': 'Tiny Castle',
    'tgrh': 'Tiny Great Hall',
    'tsct': 'Ivory Tower',
    'wshs': 'Wand of Shadowsight',
    'tret': 'Tome of Retraining',
    'sneg': 'Staff of Negation',
    'stel': 'Staff of Teleportation',
    'spre': 'Staff of Preservation',
    'mcri': 'Mechanical Critter',
    'spsh': 'Amulet of Spell Shield',
    'sbok': 'Spell Book',
    'ssan': 'Staff of Sanctuary',
    'shas': 'Scroll of Speed',
    'dust': 'Dust of Appearance',
    'oslo': 'Orb of Slow',
    'dsum': 'Diamond of Summoning',
    'sor1': 'Shadow Orb +1',
    'sor2': 'Shadow Orb +2',
    'sor3': 'Shadow Orb +3',
    'sor4': 'Shadow Orb +4',
    'sor5': 'Shadow Orb +5',
    'sor6': 'Shadow Orb +6',
    'sor7': 'Shadow Orb +7',
    'sor8': 'Shadow Orb +8',
    'sor9': 'Shadow Orb +9',
    'sora': 'Shadow Orb +10',
    'sorf': 'Shadow Orb Fragment',
    'fwss': 'Frost Wyrm Skull Shield',
    'ram1': 'Ring of the Archmagi',
    'ram2': 'Ring of the Archmagi',
    'ram3': 'Ring of the Archmagi',
    'ram4': 'Ring of the Archmagi',
    'shtm': 'Shamanic Totem',
    'shwd': 'Shimmerweed',
    'btst': 'Battle Standard',
    'skrt': 'Skeletal Artifact',
    'thle': 'Thunder Lizard Egg',
    'sclp': 'Secret Level Powerup',
    'gldo': 'Orb of Kil\'jaeden',
    'tbsm': 'Tiny Blacksmith',
    'tfar': 'Tiny Farm',
    'tlum': 'Tiny Lumber Mill',
    'tbar': 'Tiny Barracks',
    'tbak': 'Tiny Altar of Kings',
    'mgtk': 'Magic Key Chain',
    'stre': 'Staff of Reanimation',
    'horl': 'Sacred Relic',
    'hbth': 'Helm of Battlethirst',
    'blba': 'Bladebane Armor',
    'rugt': 'Runed Gauntlets',
    'frhg': 'Firehand Gauntlets',
    'gvsm': 'Gloves of Spell Mastery',
    'crdt': 'Crown of the DeathLord',
    'arsc': 'Arcane Scroll',
    'scul': 'Scroll of the Unholy Legion',
    'tmsc': 'Tome of Sacrifices',
    'dts': 'Drek\'thar\'s Spellbook',
    'grsl': 'Grimoire of Souls',
    'arsh': 'Arcanite Shield',
    'shdt': 'Shield of the DeathLord',
    'shhn': 'Shield of Honor',
    'shen': 'Enchanted Shield',
    'thdm': 'Thunderlizard Diamond',
    'stpg': 'Clockwork Penguin',
    'shrs': 'Shimmerglaze Roast',
    'bfhr': 'Bloodfeather\'s Heart',
    'cosl': 'Celestial Orb of Souls',
    'shcw': 'Shaman Claws',
    'srbd': 'Searing Blade',
    'frgd': 'Frostguard',
    'envl': 'Enchanted Vial',
    'rump': 'Rusty Mining Pick',
    'mort': 'Mogrin\'s Report',
    'srtl': 'Serathil',
    'stwa': 'Sturdy War Axe',
    'klmm': 'Killmaim',
    'rots': 'Scepter of the Sea',
    'axas': 'Ancestral Staff',
    'mnsf': 'Mindstaff',
    'schl': 'Scepter of Healing',
    'asbl': 'Assassin\'s Blade',
    'kgal': 'Keg of Ale',
    'dphe': 'Thunder Phoenix Egg',
    'dkfw': 'Keg of Thunderwater',
    'dth': 'Thunderbloom Bul',
    //# extra heros
    'Npbm': 'Pandaren Brewmaster',
    'Nbrn': 'Dark Ranger',
    'Nngs': 'Naga Sea Witch',
    'Nplh': 'Pit Lord',
    'Nbst': 'Beastmaster',
    'Ntin': 'Goblin Tinker',
    'Nfir': 'FireLord',
    'Nalc': 'Goblin Alchemist'
    //# extra hero abilities
};

const heroAbilities = {
    'AHbz': { 'displayName': 'Blizzard'},
    'AHwe': { 
     'displayName': 'Summon Water Elemental',
     'type': 'summon',
     'summonCount': 1,
     'summonItemId': ['hwat', 'hwt2', 'hwt3'],
     'summonDuration': 60
    },
    'AHab': { 'displayName': 'Brilliance Aura'},
    'AHmt': { 'displayName': 'Mass Teleport'},
    'AHtb': { 'displayName': 'Storm Bolt'},
    'AHtc': { 'displayName': 'Thunder Clap'},
    'AHbh': { 'displayName': 'Bash'},
    'AHav': { 'displayName': 'Avatar'},
    'AHhb': { 'displayName': 'Holy Light'},
    'AHds': { 'displayName': 'Divine Shield'},
    'AHad': { 'displayName': 'Devotion Aura'},
    'AHre': { 'displayName': 'Resurrection'},
    'AHdr': { 'displayName': 'Siphon Mana'},
    'AHfs': { 'displayName': 'Flame Strike'},
    'AHbn': { 'displayName': 'Banish'},
    'AHpx': { 'displayName': 'Summon Phoenix'},
    'AEmb': { 'displayName': 'Mana Burn'},
    'AEim': { 'displayName': 'Immolation'},
    'AEev': { 'displayName': 'Evasion'},
    'AEme': { 'displayName': 'Metamorphosis'},
    'AEer': { 'displayName': 'Entangling Roots'},
    'AEfn': { 
        'displayName': 'Force of Nature',
        'type': 'summon',
        'summonCount': 2,
        'summonItemId': 'efon',
        'summonDuration': 60
    },
    'AEah': { 'displayName': 'Thorns Aura'},
    'AEtq': { 'displayName': 'Tranquility'},
    'AEst': { 'displayName': 'Scout'},
    'AHfa': { 'displayName': 'Searing Arrows'},
    'AEar': { 'displayName': 'Trueshot Aura'},
    'AEsf': { 'displayName': 'Starfall'},
    'AEbl': { 'displayName': 'Blink'},
    'AEfk': { 'displayName': 'Fan of Knives'},
    'AEsh': { 'displayName': 'Shadow Strike'},
    'AEsv': { 'displayName': 'Spirit of Vengeance'},
    'AOwk': { 'displayName': 'Wind Walk'},
    'AOmi': { 'displayName': 'Mirror Image'},
    'AOcr': { 'displayName': 'Critical Strike'},
    'AOww': { 'displayName': 'Bladestorm'},
    'AOcl': { 
    	'displayName': 'Chain Lighting',
    	'type': 'objectTarget'
    },
    'AOfs': { 
    	'displayName': 'Far Sight',
    	'type': 'pointTarget'
    },
    'AOsf': { 
        'displayName': 'Feral Spirit',
        'type': 'summon',
        'summonCount': 2,
        'summonDuration': 60,
        'summonUnique': true,
        'summonItemId': ['osw1', 'osw2', 'osw3']
    },
    'AOeq': { 'displayName': 'Earth Quake'},
    'AOsh': { 'displayName': 'Shockwave'},
    'AOae': { 'displayName': 'Endurance Aura'},
    'AOws': { 'displayName': 'War Stomp', 'type': 'summon', 'summonCount': 0, 'summonItemId': 'none'},
    'AOre': { 'displayName': 'Reincarnation'},
    'AOhw': { 'displayName': 'Healing Wave'},
    'AOhx': { 'displayName': 'Hex'},
    'AOsw': { 'displayName': 'Serpent Ward'},
    'AOvd': { 'displayName': 'Big Bad Voodoo'},
    'AUdc': { 'displayName': 'Death Coil'},
    'AUdp': { 'displayName': 'Death Pact'},
    'AUau': { 'displayName': 'Unholy Aura'},
    'AUan': { 'displayName': 'Animate Dead'},
    'AUcs': { 'displayName': 'Carrion Swarm'},
    'AUsl': { 'displayName': 'Sleep'},
    'AUav': { 'displayName': 'Vampiric Aura'},
    'AUin': { 'displayName': 'Inferno'},
    'AUfn': { 'displayName': 'Frost Nova'},
    'AUfa': { 'displayName': 'Frost Armor'},
    'AUfu': { 'displayName': 'Frost Armor', isAutocast: true },
    'AUdr': { 'displayName': 'Dark Ritual'},
    'AUdd': { 'displayName': 'Death and Decay'},
    'AUim': { 'displayName': 'Impale'},
    'AUts': { 'displayName': 'Spiked Carapace'},
    'AUcb': { 
      'displayName': 'Carrion Beetles',
      'type': 'summon',
      'summonCount': 2,
      'summonItemId': ['ucs1', 'ucs1', 'ucs1'],
      'summonDuration': 60
    },
    'AUls': { 'displayName': 'Locust Swarm'},
    'ANbf': { 'displayName': 'Breath of Fire'},
    'ANdb': { 'displayName': 'Drunken Brawler'},
    'ANdh': { 'displayName': 'Drunken Haze'},
    'ANef': { 'displayName': 'Storm Earth and Fire'},
    'ANdr': { 'displayName': 'Life Drain'},
    'ANsi': { 'displayName': 'Silence'},
    'ANba': { 'displayName': 'Black Arrow'},
    'ANch': { 'displayName': 'Charm'},
    'ANms': { 'displayName': 'Mana Shield'},
    'ANfa': { 'displayName': 'Frost Arrows'},
    'ANfl': { 'displayName': 'Forked Lightning'},
    'ANto': { 'displayName': 'Tornado'},
    'ANrf': { 'displayName': 'Rain of Fire'},
    'ANca': { 'displayName': 'Cleaving Attack'},
    'ANht': { 'displayName': 'Howl of Terror'},
    'ANdo': { 'displayName': 'Doom'},
    'ANsg': { 'displayName': 'Summon Bear'},
    'ANsq': { 'displayName': 'Summon Quilbeast'},
    'ANsw': { 'displayName': 'Summon Hawk'},
    'ANst': { 'displayName': 'Stampede'},
    'ANeg': { 'displayName': 'Engineering Upgrade'},
    'ANcs': { 'displayName': 'Cluster Rockets'},
    'ANc1': { 'displayName': 'Cluster Rockets 1'},
    'ANc2': { 'displayName': 'Cluster Rockets 2'},
    'ANc3': { 'displayName': 'Cluster Rockets 3'},
    'ANsy': { 'displayName': 'Pocket Factory'},
    'ANs1': { 'displayName': 'Pocket Factory 1'},
    'ANs2': { 'displayName': 'Pocket Factory 2'},
    'ANs3': { 'displayName': 'Pocket Factory 3'},
    'ANrg': { 'displayName': 'Robo-Goblin'},
    'ANg1': { 'displayName': 'Robo-Goblin 1'},
    'ANg2': { 'displayName': 'Robo-Goblin 2'},
    'ANg3': { 'displayName': 'Robo-Goblin 3'},
    'ANic': { 'displayName': 'Incinerate'},
    'ANia': { 'displayName': 'Incinerate'},
    'ANso': { 'displayName': 'Soul Burn'},
    'ANlm': { 'displayName': 'Summon Lava Spawn'},
    'ANvc': { 'displayName': 'Volcano'},
    'ANhs': { 'displayName': 'Healing Spray'},
    'ANab': { 'displayName': 'Acid Bomb'},
    'ANcr': { 'displayName': 'Chemical Rage'},
    'ANtm': { 'displayName': 'Transmute'}
};

// Heroes with level-variant or autocast-duplicate ability IDs in abilityToHero.
// Maps hero itemId → the 4 canonical spell IDs (in skill bar order).
// getAbilitiesForHero() uses this to return only the real spells.
const heroCanonicalSpells = {
  'Ntin': ['ANeg', 'ANcs', 'ANsy', 'ANrg'],  // Goblin Tinker (has ANc1-3, ANs1-3, ANg1-3 variants)
  'Nfir': ['ANic', 'ANso', 'ANlm', 'ANvc'],  // FireLord (ANia = autocast Incinerate duplicate)
  'Ulic': ['AUfn', 'AUfa', 'AUdr', 'AUdd']   // Lich (AUfu = autocast Frost Armor duplicate)
};

// Maps variant/autocast ability IDs → their canonical base ID.
// Used so skill-learn events with variant IDs resolve correctly.
const spellVariantToBase = {};
(function buildVariantMap () {
  // Tinker level variants
  const tinkerVariants = {
    'ANc1': 'ANcs', 'ANc2': 'ANcs', 'ANc3': 'ANcs',  // Cluster Rockets
    'ANs1': 'ANsy', 'ANs2': 'ANsy', 'ANs3': 'ANsy',  // Pocket Factory
    'ANg1': 'ANrg', 'ANg2': 'ANrg', 'ANg3': 'ANrg'   // Robo-Goblin
  };
  // Autocast duplicates
  const autocastDupes = {
    'ANia': 'ANic',  // Firelord Incinerate autocast
    'AUfu': 'AUfa'   // Lich Frost Armor autocast
  };
  Object.assign(spellVariantToBase, tinkerVariants, autocastDupes);
})();

// Non-hero unit abilities (Priest, Shaman, Sorceress, Druid, etc.)
// Keyed by U-prefixed codes to avoid collision with heroAbilities.
// icon = real WC3 FourCC code matching /assets/wc3icons/{icon}.jpg
const unitAbilities = {
  // ── Human ──
  'Uhea': { displayName: 'Heal', isAutocast: true, icon: 'Ahea' },
  'Uifr': { displayName: 'Inner Fire', isAutocast: true, icon: 'Ainf' },
  'Udis': { displayName: 'Dispel Magic', icon: 'Adis' },
  'Uslo': { displayName: 'Slow', isAutocast: true, icon: 'Aslo' },
  'Upol': { displayName: 'Polymorph', icon: 'Aply' },
  'Uinv': { displayName: 'Invisibility', icon: 'Aivs' },
  'Usps': { displayName: 'Spell Steal', isAutocast: true, icon: 'Asps' },
  'Ucmg': { displayName: 'Control Magic', icon: 'Acmg' },
  'Ufla': { displayName: 'Flare', icon: 'Afla' },
  'Udef': { displayName: 'Defend', isFormToggle: true, icon: 'Adef' },

  // ── Orc ──
  'Ublu': { displayName: 'Bloodlust', isAutocast: true, icon: 'Ablo' },
  'Upur': { displayName: 'Purge', icon: 'Aprg' },
  'Ulsh': { displayName: 'Lightning Shield', icon: 'Alsh' },
  'Uhww': { displayName: 'Healing Ward', icon: 'Ahwd' },
  'Ustt': { displayName: 'Stasis Trap', icon: 'Asta' },
  'Usey': { displayName: 'Sentry Ward', icon: 'Aeye' },
  'Uspl': { displayName: 'Spirit Link', icon: 'Aspl' },
  'Udec': { displayName: 'Disenchant', icon: 'Adch' },
  'Uasp': { displayName: 'Ancestral Spirit', icon: 'Aast' },
  'Ueth': { displayName: 'Ethereal Form', isFormToggle: true, icon: 'Aetf' },
  'Ucor': { displayName: 'Corporeal Form', isFormToggle: true, icon: 'Acor' },
  'Uens': { displayName: 'Ensnare', isAutocast: true, icon: 'Aens' },
  'Udev': { displayName: 'Devour', icon: 'Adev' },
  'Uber': { displayName: 'Berserk', icon: 'Absk' },

  // ── Night Elf ──
  'Uroa': { displayName: 'Roar', icon: 'Aroa' },
  'Urej': { displayName: 'Rejuvenation', icon: 'Arej' },
  'Ubrf': { displayName: 'Bear Form', isFormToggle: true, icon: 'Abrf' },
  'Uffi': { displayName: 'Faerie Fire', isAutocast: true, icon: 'Afae' },
  'Ucyc': { displayName: 'Cyclone', icon: 'Acyc' },
  'Urvf': { displayName: 'Raven Form', isFormToggle: true, icon: 'Arav' },
  'Uadp': { displayName: 'Abolish Magic', isAutocast: true, icon: 'Aadm' },
  'Utau': { displayName: 'Taunt', icon: 'Atau' },
  'Usen': { displayName: 'Sentinel', icon: 'Aesn' },
  'Udet': { displayName: 'Detonate', icon: 'Adtn' },

  // ── Undead ──
  'Ursd': { displayName: 'Raise Dead', isAutocast: true, icon: 'Arai' },
  'Uufr': { displayName: 'Unholy Frenzy', icon: 'Auhf' },
  'Ucrp': { displayName: 'Cripple', icon: 'Acri' },
  'Ucrs': { displayName: 'Curse', isAutocast: true, icon: 'Acrs' },
  'Uams': { displayName: 'Anti-magic Shell', icon: 'Aams' },
  'Upos': { displayName: 'Possession', icon: 'Apos' },
  'Uweb': { displayName: 'Web', isAutocast: true, icon: 'Aweb' },
  'Ustn': { displayName: 'Stone Form', isFormToggle: true, icon: 'Astn' },
  'Udvm': { displayName: 'Devour Magic', icon: 'Advm' },
  'Uabs': { displayName: 'Absorb Mana', icon: 'Aabs' },
  'Urlf': { displayName: 'Replenish Life', isAutocast: true, icon: 'Arpl' },
  'Urlm': { displayName: 'Replenish Mana', isAutocast: true, icon: 'Arpm' },

  // ── Neutral building abilities ──
  // Reveal (Goblin Laboratory) — ground-target paid scout reveal. Confirmed
  // via goblab-suite.w3g fixture: action 0x11 with orderId bytes 55,0,13,0,
  // targetX/Y at the revealed location. Pre-fix this had no spellOrderIds
  // entry → useAbilityWithTarget's default branch silently dropped it.
  'ARev': { displayName: 'Reveal', icon: 'Aspy', isNeutralBuildingAbility: true }
};

const tierBuildings = {
  'U': ['unp1', 'unp2'],
  'O': ['ostr', 'ofrt'],
  'E': ['etoa', 'etoe'],
  'H': ['hkee', 'hcas']
};

const specialBuildings = {
    'Tree': 'LTlt',
    'Merchant': 'nmer',
    'Tavern': 'ntav',
    'Goldmine':'ngol',
    'NeutralShop': 'ngme',
    'MercenaryCamp': 'nmrk',
    'GoblinLaboratory': 'ngad',
    'playerShops': {
        'U': 'utom',
        'O': 'ovln',
        'E': 'eden',
        'H': 'hvlt'
    }
};

const interactiveShops = {
  'nmer': 'Merchant',
  'ntav': 'Tavern',
  'ngme': 'Goblin Merchant',
  'ngad': 'Goblin Laboratory',
  'nmrk': 'Mercenary Camp'
};

// Neutral buildings that players can hire units from (merc camps, goblin lab, merchants)
// Includes level-specific merc camp variants used on different maps
const NEUTRAL_HIRE_BUILDINGS = {
  'nmrk': 'Mercenary Camp',
  'ngad': 'Goblin Laboratory',
  'nmer': 'Merchant',
  // Merc camp level variants
  'nmr0': 'Mercenary Camp', 'nmr2': 'Mercenary Camp', 'nmr4': 'Mercenary Camp',
  'nmr6': 'Mercenary Camp', 'nmr8': 'Mercenary Camp', 'nmra': 'Mercenary Camp',
  'nmrc': 'Mercenary Camp', 'nmre': 'Mercenary Camp'
};

const critters = {
  'nshe': 'Sheep',
  'nfro': 'Frog',
  'nech': 'Chicken'
};

const fountains = {
  'nfoh': 'Fountain Of Health',
  'nmoo': 'Fountain Of Mana'
};

const playerShopBuildings = {
  'utom': 'Undead Shop',
  'ovln': 'Orc Shop',
  'eden': 'Night Elf Shop',
  'hvlt': 'Human Shop'
};

// Every building that can sell items to a player, regardless of whether the
// game also treats it as a hire-building (nmer/ngad sell BOTH units and
// items). Prior to this flag the buy-dispatch was gated on
// `player.neutralShopSelected`, which only fires for ngme — so Goblin Lab
// and Merchant item purchases (Staff of Teleportation, Tome of Retraining,
// Goblin Land Mines, etc.) were silently dropped from the event stream.
// Used by Building.isItemShop() and the buy-action dispatch in
// lib/Building.js.
const itemSellingBuildings = {
  // Neutral shops
  'ngme': 'Goblin Merchant',
  'ngad': 'Goblin Laboratory',
  'nmer': 'Merchant',
  // Player-owned race shops
  'utom': 'Tomb of Relics',          // UD
  'ovln': 'Voodoo Lounge',           // ORC
  'eden': 'Ancient of Wonders',      // NE
  'hvlt': 'Arcane Vault'             // HU
};

let specialBuildingList = { ...specialBuildings };
delete specialBuildingList.playerShops;

const specialBuildingsByItemId = Object.keys(specialBuildingList).reduce((acc, displayName) => {
  const itemId = specialBuildings[displayName];
  acc[itemId] = displayName;
  return acc;
}, {});

specialBuildingList = {
  ...specialBuildingsByItemId,
  ...playerShopBuildings
};

const buildingUpgrades = {
    // Undead: Necropolis -> Halls of the Dead -> Black Citadel
    'unp1': 'unpl',
    'unpl': 'unp2',
    // Human: Town Hall -> Keep -> Castle
    'htow': 'hkee',
    'hkee': 'hcas',
    // Orc: Great Hall -> Stronghold -> Fortress
    'ogre': 'ostr',
    'ostr': 'ofrt',
    // Night Elf: Tree of Life -> Tree of Ages -> Tree of Eternity
    'etol': 'etoa',
    'etoa': 'etoe',
    // Undead: Ziggurat -> Spirit Tower or Nerubian Tower
    'uzig': ['uzg1', 'uzg2'],
    // Human: Arcane Tower / Cannon Tower / Guard Tower from Scout Tower
    'hwtw': ['hatw', 'hctw', 'hgtw']
};

// building / resrach timings in seconds

const buildTimings = {
    'orge': 150,
    'ostr': 140,

    'unp1': 140,
    'unp2': 140,

    'hkee': 140,
    'hcas': 140,

    'etoa': 140,
    'etoe': 140
};

// research upgrade costs and timings
// format: { gold: [lvl1, lvl2, lvl3], lumber: [lvl1, lvl2, lvl3], time: [lvl1, lvl2, lvl3] }
const researchCosts = {
    // Human - attack / armor
    'Rhme': { gold: [100, 175, 250], lumber: [50, 100, 150], time: [60, 75, 90] },     // Melee Weapons
    'Rhra': { gold: [100, 175, 250], lumber: [50, 100, 150], time: [60, 75, 90] },     // Ranged Weapons
    'Rhar': { gold: [125, 175, 225], lumber: [75, 125, 175], time: [60, 75, 90] },     // Plating
    'Rhla': { gold: [100, 150, 200], lumber: [100, 150, 200], time: [60, 75, 90] },    // Leather Armor
    'Rhac': { gold: [100, 175, 250], lumber: [50, 100, 150], time: [60, 75, 90] },     // Masonry
    // Human - unit upgrades
    'Rhlh': { gold: [0, 0], lumber: [100, 100], time: [60, 75] },                       // Lumber Harvesting
    'Rhde': { gold: [150], lumber: [75], time: [45] },                                   // Defend
    'Rhpt': { gold: [100], lumber: [50], time: [30] },                                   // Priest Training
    'Rhst': { gold: [100], lumber: [50], time: [30] },                                   // Sorceress Training
    'Rhss': { gold: [75], lumber: [75], time: [45] },                                    // Control Magic
    'Rhfc': { gold: [100], lumber: [150], time: [40] },                                  // Flak Cannons
    'Rhfs': { gold: [50], lumber: [100], time: [60] },                                   // Fragmentation Shards
    'Rhse': { gold: [50], lumber: [50], time: [30] },                                    // Magic Sentry
    'Rhan': { gold: [150], lumber: [75], time: [40] },                                   // Animal War Training
    'Rhri': { gold: [75], lumber: [125], time: [40] },                                   // Long Rifles
    'Rhcd': { gold: [50], lumber: [100], time: [30] },                                   // Cloud
    'Rhrt': { gold: [50], lumber: [150], time: [60] },                                   // Barrage
    'Rhsr': { gold: [50], lumber: [50], time: [30] },                                    // Flare
    'Rhh':  { gold: [100], lumber: [75], time: [40] },                                   // Storm Hammers
    'Rhg':  { gold: [150], lumber: [100], time: [35] },                                  // Flying Machine Bombs

    // Orc - attack / armor
    'Rome': { gold: [100, 175, 250], lumber: [50, 100, 150], time: [60, 75, 90] },     // Melee Weapons
    'Rora': { gold: [100, 175, 250], lumber: [50, 100, 150], time: [60, 75, 90] },     // Ranged Weapons
    'Roar': { gold: [150, 225, 300], lumber: [75, 125, 175], time: [60, 75, 90] },     // Unit Armor
    // Orc - unit upgrades
    'Ropg': { gold: [75], lumber: [25], time: [45] },                                    // Pillage
    'Roen': { gold: [50], lumber: [75], time: [40] },                                    // Ensnare
    'Robk': { gold: [75], lumber: [0], time: [40] },                                     // Berserker Upgrade
    'Robs': { gold: [50], lumber: [150], time: [60] },                                   // Berserker Strength
    'Rotr': { gold: [100], lumber: [0], time: [60] },                                    // Troll Regeneration
    'Rost': { gold: [100], lumber: [50], time: [30] },                                   // Shaman Training
    'Rowd': { gold: [100], lumber: [50], time: [30] },                                   // Witch Doctor Training
    'Rowt': { gold: [100], lumber: [50], time: [30] },                                   // Spirit Walker Training
    'Rosp': { gold: [25], lumber: [75], time: [40] },                                    // Spiked Barricades
    'Ror':  { gold: [75], lumber: [175], time: [60] },                                   // Reinforced Defenses
    'Robf': { gold: [50], lumber: [150], time: [60] },                                   // Burning Oil
    'Rolf': { gold: [75], lumber: [125], time: [60] },                                   // Liquid Fire
    'Rows': { gold: [150], lumber: [0], time: [60] },                                    // Pulverize
    'Rovs': { gold: [100], lumber: [150], time: [40] },                                  // Envenomed Spears

    // Night Elf - attack / armor
    'Resm': { gold: [100, 175, 250], lumber: [50, 100, 150], time: [60, 75, 90] },     // Strength of the Moon
    'Resw': { gold: [100, 175, 250], lumber: [50, 100, 150], time: [60, 75, 90] },     // Strength of the Wild
    'Rema': { gold: [150, 225, 300], lumber: [75, 125, 175], time: [60, 75, 90] },     // Moon Armor
    'Rerh': { gold: [150, 225, 300], lumber: [75, 125, 175], time: [60, 75, 90] },     // Reinforced Hides
    // Night Elf - unit upgrades
    'Rei':  { gold: [50, 100], lumber: [100, 175], time: [60, 75] },                    // Improved Bows
    'Remk': { gold: [100], lumber: [175], time: [60] },                                  // Marksmanship
    'Remg': { gold: [100], lumber: [150], time: [40] },                                  // Moon Glaive
    'Repd': { gold: [100], lumber: [75], time: [40] },                                   // Vorpal Blades
    'Redc': { gold: [100], lumber: [50], time: [30] },                                   // Druid of the Claw
    'Redt': { gold: [100], lumber: [50], time: [30] },                                   // Druid of the Talon
    'Resi': { gold: [50], lumber: [50], time: [30] },                                    // Abolish Magic
    'Reht': { gold: [75], lumber: [50], time: [30] },                                    // Hippogryph Taming
    'Ren':  { gold: [150], lumber: [200], time: [60] },                                  // Nature's Blessing
    'Reuv': { gold: [50], lumber: [50], time: [30] },                                    // Ultravision
    'Rews': { gold: [75], lumber: [0], time: [30] },                                     // Well Sprint

    // Undead - attack / armor
    'Rume': { gold: [125, 175, 225], lumber: [50, 100, 150], time: [60, 75, 90] },     // Unholy Strength
    'Rura': { gold: [100, 150, 200], lumber: [75, 125, 175], time: [60, 75, 90] },     // Creature Attack
    'Ruar': { gold: [125, 175, 225], lumber: [50, 100, 150], time: [60, 75, 90] },     // Unholy Armor
    'Rucr': { gold: [150, 225, 300], lumber: [75, 125, 175], time: [60, 75, 90] },     // Creature Carapace
    // Undead - unit upgrades
    'Ruac': { gold: [0], lumber: [0], time: [30] },                                      // Cannibalize
    'Rugf': { gold: [100], lumber: [150], time: [60] },                                  // Ghoul Frenzy
    'Rune': { gold: [100], lumber: [50], time: [30] },                                   // Necromancer Training
    'Ruba': { gold: [100], lumber: [50], time: [30] },                                   // Banshee Training
    'Rubu': { gold: [75], lumber: [75], time: [40] },                                    // Burrow
    'Ruex': { gold: [75], lumber: [0], time: [30] },                                     // Exhume Corpses
    'Rusf': { gold: [100], lumber: [150], time: [60] },                                  // Stone Form
    'Rusp': { gold: [75], lumber: [150], time: [60] },                                   // Destroyer Form
    'Rusl': { gold: [100], lumber: [75], time: [40] },                                   // Skeletal Longevity
    'Ruf':  { gold: [50], lumber: [200], time: [60] },                                   // Freezing Breath
};

// unit and building costs: { gold, lumber, food, foodProvided }
// generated from UnitBalance.json with overrides for tier upgrades and heroes
const unitCosts = Object.keys(unitBalanceMap).reduce((acc, id) => {
    const entry = unitBalanceMap[id];
    acc[id] = {
        gold: entry.goldCost || 0,
        lumber: entry.lumberCost || 0,
        food: entry.foodUsed || 0,
        foodProvided: entry.foodMade || 0
    };
    return acc;
}, {});

// tier building upgrade costs - UnitBalance has cumulative costs, we need upgrade-only
// Human: Town Hall (385g/205l) -> Keep -> Castle
unitCosts['hkee'] = { gold: 320, lumber: 210, food: 0, foodProvided: 0 };
unitCosts['hcas'] = { gold: 320, lumber: 210, food: 0, foodProvided: 0 };
// Orc: Great Hall (385g/185l) -> Stronghold -> Fortress
unitCosts['ostr'] = { gold: 315, lumber: 190, food: 0, foodProvided: 0 };
unitCosts['ofrt'] = { gold: 325, lumber: 190, food: 0, foodProvided: 0 };
// Undead: Necropolis (225g/0l) -> Halls of the Dead -> Black Citadel
unitCosts['unp1'] = { gold: 320, lumber: 210, food: 0, foodProvided: 0 };
unitCosts['unp2'] = { gold: 325, lumber: 230, food: 0, foodProvided: 0 };
// Night Elf: Tree of Life (340g/185l) -> Tree of Ages -> Tree of Eternity
unitCosts['etoa'] = { gold: 320, lumber: 180, food: 0, foodProvided: 0 };
unitCosts['etoe'] = { gold: 330, lumber: 200, food: 0, foodProvided: 0 };

// tower upgrade costs - also cumulative in UnitBalance
// Human: Scout Tower (30g/20l) -> Guard/Cannon/Arcane Tower
unitCosts['hgtw'] = { gold: 70, lumber: 50, food: 0, foodProvided: 0 };
unitCosts['hctw'] = { gold: 120, lumber: 100, food: 0, foodProvided: 0 };
unitCosts['hatw'] = { gold: 70, lumber: 50, food: 0, foodProvided: 0 };
// Undead: Ziggurat (150g/50l) -> Spirit Tower / Nerubian Tower
unitCosts['uzg1'] = { gold: 145, lumber: 40, food: 0, foodProvided: 0 };
unitCosts['uzg2'] = { gold: 100, lumber: 20, food: 0, foodProvided: 0 };

// heroes cost 0 gold/lumber to initially summon (UnitBalance has revive costs)
Object.keys(unitMetaData).forEach(id => {
    if (unitMetaData[id].hero && unitCosts[id]) {
        unitCosts[id].gold = 0;
        unitCosts[id].lumber = 0;
    }
});

// missing from UnitBalance
unitCosts['orbr'] = { gold: 160, lumber: 40, food: 0, foodProvided: 10 };

const heroes = Object.keys(unitMetaData).reduce((acc, key) => {
	let item = unitMetaData[key];
	if (item.hero) {
		acc[key] = `u_${item.displayName}`;
	}

	return acc;
}, {});

Object.keys(unitBalanceMap).forEach(unitId => {
  const unit = unitBalanceMap[unitId];

  if (!units[unitId] && !heroes[unitId] && unit.level) {
    units[unitId] = unit.displayName;
  }
});

const getUnitInfo = (itemId) => {
	const inBuildingList = !!(buildings[itemId]);
  const inSpecialBuildingList = !!(specialBuildingList[itemId]);
	const inUnitList = !!(units[itemId]);
	const inHeroList = !!(heroes[itemId]);
  const inItemList = !!(items[itemId]);
  const inCritterList = !!(critters[itemId]);
  const inFountainList = !!(fountains[itemId]);

  const isCritter = (inCritterList);
  const isFountain = (inFountainList);
  const isPlayerShop = !!(playerShopBuildings[itemId]);
  const isInteractiveShop = isPlayerShop || !!(interactiveShops[itemId]);
  // True for any building that can sell items — covers neutral shops
  // (ngme), hybrid hire+shop buildings (ngad, nmer), and player-owned race
  // shops. Drives the buy-dispatch path in lib/Building.js.
  const isItemShop = !!(itemSellingBuildings[itemId]);
  const isGoldmine = (itemId == 'ngol');

	const isBuildingUpgrade = (inUnitList && units[itemId].startsWith("b"));
	const isBuilding = (
    inBuildingList || 
    isBuildingUpgrade || 
    inSpecialBuildingList ||
    inFountainList
  );

	const isHero = (inHeroList);
  const isResearch = (inUnitList && units[itemId] && units[itemId].startsWith("Upgrade"));
	const isUnit = (inUnitList || isHero || isCritter && !isBuilding);
  const isItem = (inItemList);
  
  const isKnownId = !!(allItemIds[itemId]);

	let displayName = `Unknown (${itemId})`;

	if (isBuilding) {
		displayName = isBuildingUpgrade ? units[itemId] : buildings[itemId];

    if (!displayName) {
      // Prefer the canonical name in allItemIds ('Goblin Merchant',
      // 'Goblin Laboratory', etc.) over specialBuildingList's reverse-key
      // lookup, which would otherwise label ngme as "NeutralShop" and ngol
      // as "Goldmine" instead of the in-game display names players know.
      displayName = allItemIds[itemId] || specialBuildingList[itemId] || fountains[itemId];
    }

	} else if (isUnit) {
		displayName = units[itemId] || heroes[itemId] || critters[itemId];
  } else if (isItem) {
    // Prefer the curated `items` map (covers most melee items) but fall
    // back to the CASC dropTables dump for items that exist in WC3 data
    // but aren't in our hand-maintained list (campaign items, the
    // occasional melee item like war2 / Warsong Battle Drums (Kodo)).
    displayName = items[itemId];
    if (!displayName && dropTablesData && dropTablesData.items && dropTablesData.items[itemId]) {
      displayName = dropTablesData.items[itemId].displayName;
    }
	} else if (isKnownId) {
    displayName = allItemIds[itemId];
  }

	if (displayName.startsWith("u_") || 
      displayName.startsWith("b_") ||
      displayName.startsWith("i_")) {
		displayName = displayName.substring(2);
	}

	let meta = unitMetaData[itemId] || {
		hero: false,
		worker: false,
		permanent: isBuilding,
    playerShop: isPlayerShop,
    evolution: null,
    movespeed: 200 // default unknown ms
	};

  // Overlay real SLK movement data (move speed / turn rate / propulsion window)
  // onto a CLONE of meta — never mutate the shared unitMetaData entry. Real `spd`
  // wins over the hand-table/200 placeholder so Unit.effectiveMovespeed() and
  // FacingInference get accurate per-unit values. turnRate is the raw SLK value
  // (rad per WC3 frame); FacingInference converts it to rad/ms.
  const movement = unitMovementMap[itemId];
  if (movement) {
    meta = Object.assign({}, meta);
    if (movement.moveSpeed) meta.movespeed = movement.moveSpeed;
    if (movement.turnRate != null) meta.turnRate = movement.turnRate;
    if (movement.propWindow != null) meta.propWindow = movement.propWindow;
    if (movement.moveType) meta.moveType = movement.moveType;
  }

  const balanceInfo = unitBalanceMap[itemId] || {};

	return {
		displayName,
    isKnownId,
		isBuilding,
		isUnit,
    isItem,
    isResearch,
    isFountain,
    isCritter,
    isInteractiveShop,
    isPlayerShop,
    isItemShop,
    isGoldmine,
		meta,
    balanceInfo
	};
};

// Tech tree: unit itemId → required building itemIds (production + prerequisites)
// Does NOT include tier hall requirements (handled separately by TIER_REQUIRED_UNITS in ReplayValidator)
const TECH_TREE_REQUIREMENTS = {
  'U': {
    'ugho': ['usep'],              // Ghoul → Crypt
    'ucry': ['usep', 'ugrv'],     // Crypt Fiend → Crypt + Graveyard
    'ugar': ['usep', 'ugrv'],     // Gargoyle → Crypt + Graveyard
    'uabo': ['uslh'],             // Abomination → Slaughterhouse
    'uobs': ['uslh'],             // Obsidian Statue → Slaughterhouse
    'ubsp': ['uslh'],             // Destroyer (upgraded statue) → Slaughterhouse
    'umtw': ['uslh', 'ugrv'],    // Meat Wagon → Slaughterhouse + Graveyard
    'unec': ['utod'],             // Necromancer → Temple of the Damned
    'uban': ['utod'],             // Banshee → Temple of the Damned
    'ufro': ['ubon'],             // Frost Wyrm → Boneyard
  },
  'O': {
    'ogru': ['obar'],             // Grunt → Barracks
    'ohun': ['obar'],             // Headhunter → Barracks
    'otbk': ['obar'],             // Berserker → Barracks
    'ocat': ['obar', 'ofor'],    // Demolisher → Barracks + War Mill
    'otau': ['obar'],             // Tauren → Barracks
    'orai': ['obea'],             // Raider → Bestiary
    'okod': ['obea'],             // Kodo Beast → Bestiary
    'owyv': ['obea'],             // Wind Rider → Bestiary
    'otbr': ['obea'],             // Troll Batrider → Bestiary
    'oshm': ['osld'],             // Shaman → Spirit Lodge
    'odoc': ['osld'],             // Witch Doctor → Spirit Lodge
    'ospw': ['osld'],             // Spirit Walker → Spirit Lodge
  },
  'H': {
    'hfoo': ['hbar'],             // Footman → Barracks
    'hrif': ['hbar'],             // Rifleman → Barracks
    'hkni': ['hbar'],             // Knight → Barracks
    'hmtm': ['harm'],             // Mortar Team → Workshop
    'hmtt': ['harm'],             // Siege Engine → Workshop
    'hgyr': ['harm'],             // Gyrocopter → Workshop
    'hgry': ['hgra'],             // Gryphon Rider → Gryphon Aviary
    'hmpr': ['hars'],             // Priest → Arcane Sanctum
    'hsor': ['hars'],             // Sorceress → Arcane Sanctum
    'hspt': ['hars'],             // Spell Breaker → Arcane Sanctum
  },
  'E': {
    // WC3 ancients: eaom=War, eaoe=Lore, eaow=Wind. (The previous mapping had
    // eaow/eaoe/eaol — comments and itemIds were swapped.)
    'earc': ['eaom'],             // Archer → Ancient of War
    'esen': ['eaom'],             // Huntress → Ancient of War
    'ebal': ['eaom'],             // Glaive Thrower → Ancient of War
    'edoc': ['eaoe'],             // Druid of the Claw → Ancient of Lore
    'edry': ['eaoe'],             // Dryad → Ancient of Lore
    'emtg': ['eaoe'],             // Mountain Giant → Ancient of Lore
    'edot': ['eaow'],             // Druid of the Talon → Ancient of Wind
    'efdr': ['eaow'],             // Faerie Dragon → Ancient of Wind
    'ehip': ['eaow'],             // Hippogryph → Ancient of Wind
    'echm': ['edos'],             // Chimera → Chimera Roost
  }
};

// Building → minimum tier required to construct it.
// Used by BuildingBackfill (so an inferred T2/T3 building doesn't land at gameTime 0)
// and by ReplayValidator (so a real T2/T3 building before its tier upgrade is flagged).
// Tier 1 buildings are omitted (everyone has tier 1 from the start).
const BUILDING_TIER_REQUIREMENTS = {
  'E': {
    'eaoe': 2,    // Ancient of Lore — needs Tree of Ages
    'eaow': 2,    // Ancient of Wind — needs Tree of Ages
    'edos': 3     // Chimera Roost — needs Tree of Eternity
  },
  'O': {
    'osld': 2,    // Spirit Lodge — needs Stronghold
    'obea': 2,    // Beastiary — needs Stronghold
    'otto': 2     // Tauren Totem — needs Stronghold (the Tauren *unit* needs Fortress, but the building itself only needs T2)
  },
  'H': {
    'harm': 2,    // Workshop — needs Keep
    'hars': 2,    // Arcane Sanctum — needs Keep
    'hgra': 3     // Gryphon Aviary — needs Castle
  },
  'U': {
    'utod': 2,    // Temple of the Damned — needs Halls of the Dead
    'uslh': 2,    // Slaughterhouse — needs Halls of the Dead
    'ubon': 3     // Boneyard — needs Black Citadel
  }
};

// WC3 random item class IDs: Y{class}I{level}
// class: i=Any, j=Permanent, k=Charged, o=Powerup
const RANDOM_ITEM_CLASSES = {
  'i': 'Any',
  'j': 'Permanent',
  'k': 'Charged',
  'o': 'Powerup'
};

// Pre-computed random-item pools generated from CASC itemdata.slk by
// tools/parse-drop-tables.js. Lets us expand a "Random Lv2 Permanent"
// drop reference into its actual candidate items.
let dropTablesData = null;
try {
  dropTablesData = require('./dropTables.json');
} catch (e) {
  // dropTables.json is optional — if absent, resolveDropItem falls back
  // to the simple "Random Lv{N} {Class}" label. Run
  // `node tools/parse-drop-tables.js` to generate.
}

/**
 * Resolve a dropped item ID to a display name + (for random refs) pool.
 * Handles known items (allItemIds / w3gMappings.items) and WC3 random
 * item patterns (Y{class}I{level}).
 *
 * For random refs, when dropTables.json is loaded, the returned object
 * includes a `pool: [{itemId, displayName}, ...]` field listing every
 * candidate item the game could have rolled for that ref. This lets the
 * client show users "the item that dropped was one of: Pendant of Mana,
 * Periapt of Vitality, Ring of Protection +1, ..." even though the
 * replay doesn't say which specific item.
 */
// Fallback display-name lookup that walks all known sources. Used by
// resolveDropItem AND any other call-site that needs a friendly item
// name. The dropTables CASC dump is the most exhaustive — campaign
// items (Horn of Cenarius, Heart of Aszune, etc.) and a handful of
// melee items (Warsong Drums, Engraved Scale, etc.) are only there.
function getItemDisplayName (itemId) {
  if (!itemId) return null;
  if (allItemIds[itemId]) return allItemIds[itemId];
  if (items[itemId]) return items[itemId];
  if (dropTablesData && dropTablesData.items && dropTablesData.items[itemId]) {
    return dropTablesData.items[itemId].displayName;
  }
  return null;
}

function resolveDropItem (itemId) {
  if (!itemId) return { itemId, displayName: 'Unknown', isRandom: true };

  const knownName = getItemDisplayName(itemId);
  if (knownName) {
    return { itemId, displayName: knownName, isRandom: false };
  }

  // decode WC3 random item pattern: Y{class}I{level}
  if (itemId.length === 4 && itemId[0] === 'Y' && itemId[2] === 'I') {
    const itemClass = RANDOM_ITEM_CLASSES[itemId[1]] || 'Random';
    const level = itemId[3];
    const result = { itemId, displayName: `Random Lv${level} ${itemClass}`, isRandom: true };
    if (dropTablesData && dropTablesData.pools && dropTablesData.pools[itemId]) {
      result.pool = dropTablesData.pools[itemId].map(poolItemId => ({
        itemId: poolItemId,
        displayName: getItemDisplayName(poolItemId) || poolItemId
      }));
    }
    return result;
  }

  return { itemId, displayName: itemId, isRandom: true };
}

//
// Creep camp leash / guard-return distance.
//
// HONEST LIMITATION: the per-camp creep guard/leash distance is NOT recorded
// in the replay, and is NOT present in the melee map files we parse —
// war3mapUnits.doo only carries a camp flag (targetAcquisition === -2), and
// war3mapMisc.txt (gameplay-constant overrides) is absent from every melee map
// in this project. The real leash is a WC3 engine value. We therefore use one
// documented default and surface `leashSource` to the UI so it can state
// whether the in-camp vs creep-pull boundary is map-exact or a standard
// default — we never present the boundary as more precise than it is.
//
// ~1000u beyond the camp's tight unit bounds matches the commonly observed
// melee creep aggro/return radius. Tunable via Project C's evidence harness.
//
const CREEP_GUARD_RETURN_DISTANCE = 1000;

//
// Resolve the effective creep leash for a parsed map. If a (future/custom) map
// supplied gameplay-constant overrides — extracted by lib/parsers/MiscFile and
// surfaced as `gameConstants.creepGuardReturnDistance` — prefer that exact
// value; otherwise fall back to the documented WC3 default.
//
function resolveCampLeash (gameConstants) {
  const v = gameConstants && gameConstants.creepGuardReturnDistance;
  if (typeof v === 'number' && isFinite(v) && v > 0) {
    return { distance: v, source: 'mapConstants' };
  }
  return { distance: CREEP_GUARD_RETURN_DISTANCE, source: 'wc3Default' };
}

/*
 * Combat-spell whitelists for BattleDetector signal emission.
 *
 * `spell-target-unit` is whitelist-independent — a spell that resolves to an
 * enemy unit is always combat (you can't Heal an enemy). These sets gate the
 * weaker forms:
 *
 *   combatSpellsGroundTarget — for `useAbilityWithTarget` (point-targeted).
 *     Includes AoE damage (Blizzard, Carrion Swarm), AoE control (Earthquake),
 *     and battlefield-redeploy (Mass Teleport).
 *
 *   combatSpellsNoTarget — for `useAbilityNoTarget` cast by a combat actor.
 *     Includes ult buffs, summons, and emergency abilities only used in fights.
 *
 * Conservative initial lists. Expanding is a corpus-driven tuning task —
 * over-inclusion produces false-positive battles (e.g. Heal-a-friend during
 * idle would spuriously open a battle if added here). New additions should
 * cite the replay+timestamp where they were observed and judged "combat".
 *
 * Source of ability ids: spellOrderIds.json values (e.g. 'AHbz' = Blizzard).
 */
const combatSpellsGroundTarget = new Set([
  // Hero AoE / battlefield
  'AHbz',   // Archmage — Blizzard
  'AHfa',   // Archmage — Flame Strike (variant)
  'AHmt',   // Archmage — Mass Teleport (combat redeploy)
  'AOsh',   // Tauren Chieftain — Shockwave
  'AOeq',   // Tauren Chieftain — Earthquake (siege)
  'AUcs',   // Death Knight — Carrion Swarm (chain-AoE damage)
  'AUdp',   // Death Knight — Death and Decay (target-ground AoE)
  'AUin',   // Dreadlord — Inferno (target-ground summon-bomb)
  'ANcs',   // Tinker — Cluster Rockets
  'ANvc',   // Firelord — Volcano
  'ANfl',   // Firelord — Soul Burn / Fire variants
  // Unit ground-target combat spells
  'Ufla',   // Sorceress — Flame Strike (Polymorph variant?)
]);

const combatSpellsNoTarget = new Set([
  // Hero self/aoe combat abilities
  'AOws',   // Tauren Chieftain — War Stomp
  'AOww',   // Blademaster — Wind Walk
  'AOmi',   // Blademaster — Mirror Image
  'AHav',   // Archmage — Brilliance Aura? No — AHav is Avatar (Mountain King ult)
  'AHre',   // Paladin — Resurrection (post-fight recovery)
  'AUls',   // Crypt Lord — Locust Swarm (ult)
  'AUan',   // Death Knight — Animate Dead (ult)
  'ANic',   // Pandaren Brewmaster — Drunken Brawler / Storm Earth Fire?
  // Wisp Detonate (target-unit but no target id resolved cleanly in some paths)
  'Udet',
]);

const combatSpellHelpers = Object.freeze({
  isCombatGroundSpell (abilityId) {
    return !!abilityId && combatSpellsGroundTarget.has(abilityId);
  },
  isCombatNoTargetSpell (abilityId) {
    return !!abilityId && combatSpellsNoTarget.has(abilityId);
  }
});

/*
 * Illusion-creating hero abilities. An illusion is a *copy of the caster*, so
 * the spawned unit's itemId is the caster's own hero itemId (it wears the same
 * icon/model) — we just flag it isIllusion. `imagesByLevel` is DataA from
 * helpers/heroAbilityStats.json (images summoned per ability level); the parser
 * picks the entry for the hero's learned skill level (defaults to level 1 when
 * the skill level isn't tracked). `durationMs` is the spell's image lifetime.
 *
 * NOTE: the replay format does NOT record illusion movement/orders (commands go
 * to the controlling player's selection, not per-illusion), so spawned images
 * are anchored at the cast location for their lifetime. The goal is to make the
 * spell legible and the illusion clearly marked — not to simulate image pathing.
 */
const illusionAbilities = {
  'AOmi': { displayName: 'Mirror Image', imagesByLevel: [1, 2, 3], durationMs: 60 * 1000 }  // Blademaster
};

const illusionHelpers = Object.freeze({
  isIllusionAbility (abilityId) {
    return !!abilityId && Object.prototype.hasOwnProperty.call(illusionAbilities, abilityId);
  },
  // images for a given ability + learned level (1-based). Clamps to range.
  imageCountFor (abilityId, level) {
    const cfg = illusionAbilities[abilityId];
    if (!cfg) return 0;
    const lvl = Math.max(1, Math.min(level | 0 || 1, cfg.imagesByLevel.length));
    return cfg.imagesByLevel[lvl - 1] || 1;
  }
});

module.exports = {
	getUnitInfo,
	buildings,
  buildingUpgrades,
	units,
	unitMetaData,
  specialBuildings,
	heroAbilities,
	abilityActions,
	abilityFlagNames,
  workerForRace,
	mapStartPositions,
  mapDataByFile,
  commonMapNames,
  buildTimings,
  researchCosts,
  unitCosts,
  itemAbilityData,
  abilityToHero,
  heroCanonicalSpells,
  spellVariantToBase,
  tierBuildings,

  WorkerRole,
  WorkerTask,
  GHOUL_ID,
  BURROW_ID,
  WORKER_IDS,
  isWorkerUnit,
  defaultWorkerRole,

  ANCIENT_BUILDING_IDS,
  BuildMechanic,
  raceBuildMechanic,
  getBuildTime,

  researchMeta,
  spellOrderIds,
  lookupSpellFromOrderId,
  unitAbilities,

  combatSpellsGroundTarget,
  combatSpellsNoTarget,
  combatSpellHelpers,
  illusionAbilities,
  illusionHelpers,
  ...require('./teleportAbilities'),

  TECH_TREE_REQUIREMENTS,
  BUILDING_TIER_REQUIREMENTS,
  NEUTRAL_HIRE_BUILDINGS,
  itemSellingBuildings,
  playerShopBuildings,

  resolveDropItem,
  getItemDisplayName,

  CREEP_GUARD_RETURN_DISTANCE,
  resolveCampLeash,

  NEUTRAL_PLAYER_ID: 1042,
  NEUTRAL_PLAYER_SLOT: 1044,
  NEUTRAL_PLAYER_TEAM: 1046
};
