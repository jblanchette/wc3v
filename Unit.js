const mappings = require("./mappings");
const utils = require("./utils");

const Unit = class {
	constructor (itemId1, itemId2, knownItemId, isSpawnedAtStart = false ) {
		this.itemId1 = itemId1;
		this.itemId2 = itemId2;

		this.objectId1 = null;
		this.objectId2 = null;

		this.itemId = knownItemId || null;

		const spawnedAtStartCheck = (itemId1 !== null) && utils.isEqualItemId(itemId1, itemId2);
		this.isSpawnedAtStart = isSpawnedAtStart || spawnedAtStartCheck;

		this.displayName = null;
		this.isBuilding = false;
		this.isUnit = false;

		// non-selectable things on the map
		// like trees
		
		this.hasBeenInGroup = false;

		this.abilityFlags = null;
		this.spawning = true;

		this.selected = false;

		this.currentX = 0;
		this.currentY = 0;

		this.path = [];
		this.state = null;

		this.setUnitMeta();
	}

	setUnitMeta () {
		const { 
			displayName, 
			isBuilding, 
			isUnit,
			meta
		} = mappings.getUnitInfo(this.itemId);

		this.displayName = displayName;
		this.isBuilding = isBuilding;
		this.isUnit = isUnit;
		this.meta = meta;
	}

	registerItemIds (itemId1, itemId2) {
		this.itemId1 = itemId1;
		this.itemId2 = itemId2;

		this.hasBeenInGroup = true;
	}

	registerObjectIds (objectId1, objectId2) {
		this.objectId1 = objectId1;
		this.objectId2 = objectId2;

		this.hasBeenInGroup = true;
	}

	registerUnit (itemId, objectId1, objectId2) {
		this.itemId = itemId;
		this.objectId1 = objectId1;
		this.objectId2 = objectId2;

		this.setUnitMeta();

		this.hasBeenInGroup = true;
	}

	spawn () {
		this.spawning = false;
	}

	select () {
		this.selected = true;
	}

	deselect () {
		this.selected = false;
	}

	moveTo (targetX, targetY) {
		this.state = "walking";

		this.path.push({
			x: targetX,
			y: targetY
		});

		this.currentX = targetX;
		this.currentY = targetY;
	}
};

module.exports = Unit;