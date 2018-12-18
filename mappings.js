const w3gMappings = require("./node_modules/w3gjs/lib/mappings");

const {
	buildings,
	units
} = w3gMappings;

const unitMetaData = {
	'opeo': {
		'displayName': 'Peon',
		'hero': false,
		'worker': true,
		'permanent': true
	},
	'uaco ': {
		'displayName': 'Acolyte',
		'hero': false,
		'worker': true,
		'permanent': true
	},
	'ewsp ': {
		'displayName': 'Wisp',
		'hero': false,
		'worker': true,
		'permanent': true
	},
	'hpea': {
		'displayName': 'Peasent',
		'hero': false,
		'worker': true,
		'permanent': true
	},
	'Hamg': {
		'displayName': 'Archmage',
		'hero': true,
		'worker': false,
		'permanent': true
	},
  'Hblm': {
		'displayName': 'Blood Mage',
		'hero': true,
		'worker': false,
		'permanent': true
	},
  'Hmkg': {
		'displayName':'Mountain King',
		'hero': true,
		'worker': false,
		'permanent': true
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
		'permanent': true
	},
  'Ekee': {
		'displayName':'Keeper of the Grove',
		'hero': true,
		'worker': false,
		'permanent': true
	},
  'Emoo': {
		'displayName':'Priestess of the Moon',
		'hero': true,
		'worker': false,
		'permanent': true
	},
  'Edem': {
		'displayName':'Demon Hunter',
		'hero': true,
		'worker': false,
		'permanent': true
	},
  'Oshd': {
		'displayName':'Shadow Hunter',
		'hero': true,
		'worker': false,
		'permanent': true
	},
  'Obla': {
		'displayName':'Blademaster',
		'hero': true,
		'worker': false,
		'permanent': true
	},
  'Ofar': {
		'displayName':'Far Seer',
		'hero': true,
		'worker': false,
		'permanent': true
  },
  'Otch': {
		'displayName':'Tauren Chieftain',
		'hero': true,
		'worker': false,
		'permanent': true
  },
  'Ucrl': {
		'displayName':'Crypt Lord',
		'hero': true,
		'worker': false,
		'permanent': true
  },
  'Udea': {
		'displayName':'Death Knight',
		'hero': true,
		'worker': false,
		'permanent': true
  },
  'Udre': {
		'displayName':'Dread Lord',
		'hero': true,
		'worker': false,
		'permanent': true
  },
  'Ulic': {
		'displayName':'Lich',
		'hero': true,
		'worker': false,
		'permanent': true
  },
  'Npbm': {
		'displayName':'Pandaren Brewmaster',
		'hero': true,
		'worker': false,
		'permanent': true
  },
  'Nbrn': {
		'displayName':'Dark Ranger',
		'hero': true,
		'worker': false,
		'permanent': true
  },
  'Nngs': {
		'displayName':'Naga Sea Witch',
		'hero': true,
		'worker': false,
		'permanent': true
  },
  'Nplh': {
		'displayName':'Pit Lord',
		'hero': true,
		'worker': false,
		'permanent': true
  },
  'Nbst': {
		'displayName':'Beastmaster',
		'hero': true,
		'worker': false,
		'permanent': true
  },
  'Ntin': {
		'displayName':'Goblin Tinker',
		'hero': true,
		'worker': false,
		'permanent': true
  },
  'Nfir': {
		'displayName':'FireLord',
		'hero': true,
		'worker': false,
		'permanent': true
  },
  'Nalc': {
		'displayName':'Goblin Alchemist',
		'hero': true,
		'worker': false,
		'permanent': true
  }
};

const heroes = Object.keys(unitMetaData).reduce((acc, key) => {
	let item = unitMetaData[key];
	if (item.hero) {
		acc[key] = `u_${item.displayName}`;
	}

	return acc;
}, {});

const abilityActions = {
	'RightClick': [3, 0, 13, 0]
};

const mapStartPositions = {
	'EchoIsles': {
		'0': { x: -5184.0, y: 2944.0 },
		'1': { x: 4672.0, y: 2944.0 }
	}
};

const getUnitInfo = (itemId) => {
	const inBuildingList = !!(buildings[itemId]);
	const inUnitList = !!(units[itemId]);
	const inHeroList = !!(heroes[itemId]);
	const isBuildingUpgrade = (inUnitList && itemId.startsWith("b"));

	const isBuilding = (inBuildingList || isBuildingUpgrade);
	const isHero = (inHeroList);
	const isUnit = (inUnitList || isHero && !isBuilding);

	let displayName = "Unknown";
	if (isBuilding) {
		displayName = buildings[itemId];
	} else if (isUnit) {
		displayName = units[itemId] || heroes[itemId];
	}

	let meta = unitMetaData[itemId] || {
		hero: false,
		worker: false,
		permanent: isBuilding
	};

	return {
		displayName: displayName,
		isBuilding: isBuilding,
		isUnit: isUnit,
		meta: meta
	};
}

module.exports = {
	getUnitInfo: getUnitInfo,
	buildings: buildings,
	units: units,
	unitMetaData: unitMetaData,
	abilityActions: abilityActions,
	mapStartPositions: mapStartPositions
};