const w3gMappings = require("./node_modules/w3gjs/lib/mappings");

const {
	buildings,
	units
} = w3gMappings;

const heroes = {
  'Hamg': 'Archmage',
  'Hblm': 'Blood Mage',
  'Hmkg': 'Mountain King',
  'Hpal': 'Paladin',
  'Ewar': 'Warden',
  'Ekee': 'Keeper of the Grove',
  'Emoo': 'Priestess of the Moon',
  'Edem': 'Demon Hunter',
  'Oshd': 'Shadow Hunter',
  'Obla': 'Blademaster',
  'Ofar': 'Far Seer',
  'Otch': 'Tauren Chieftain',
  'Ucrl': 'Crypt Lord',
  'Udea': 'Death Knight',
  'Udre': 'Dread Lord',
  'Ulic': 'Lich',
  'Npbm': 'Pandaren Brewmaster',
  'Nbrn': 'Dark Ranger',
  'Nngs': 'Naga Sea Witch',
  'Nplh': 'Pit Lord',
  'Nbst': 'Beastmaster',
  'Ntin': 'Goblin Tinker',
  'Nfir': 'FireLord',
  'Nalc': 'Goblin Alchemist'
};

const unitTypes = {
	'oepo': {
		'displayName': 'Peon',
		'worker': true,
		'permanent': true
	},
	'uaco ': {
		'displayName': 'Acolyte',
		'worker': true,
		'permanent': true
	},
	'ewsp ': {
		'displayName': 'Wisp',
		'worker': true,
		'permanent': true
	},
	'hpea': {
		'displayName': 'Peasent',
		'worker': true,
		'permanent': true
	}
}

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

	return {
		displayName: displayName,
		isBuilding: isBuilding,
		isUnit: isUnit
	};
}

module.exports = {
	getUnitInfo: getUnitInfo,
	buildings: buildings,
	units: units,
	unitTypes: unitTypes,
	abilityActions: abilityActions,
	mapStartPositions: mapStartPositions
};