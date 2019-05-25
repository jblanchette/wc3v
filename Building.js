const utils = require("./utils"),
      mappings = require("./mappings");

const { 
	abilityActions,
	abilityFlagNames,
	mapStartPositions,
	specialBuildings
} = mappings;

const Building = class {
	constructor () {

	}

	static isTavern (fixedItemId) {
		return (fixedItemId === specialBuildings.tavern);
	}
};

module.exports = Building;