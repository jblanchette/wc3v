const w3gMappings = require("./node_modules/w3gjs/lib/mappings");

const buildings = w3gMappings.buildings;
const units = w3gMappings.units;

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

module.exports = {
	buildings: buildings,
	units: units,
	unitTypes: unitTypes,
	abilityActions: abilityActions,
	mapStartPositions: mapStartPositions
};