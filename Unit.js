const mappings = require("./mappings");
const utils = require("./utils");

const Unit = class {
	constructor (itemId1, itemId2, startingPosition) {
		this.itemId1 = itemId1;
		this.itemId2 = itemId2;

		this.itemId = null;
		this.displayName = null;

		this.isSpawnedAtStart = utils.isEqualItemId(itemId1, itemId2);
		this.isBuilding = false;
		this.isUnit = false;

		// non-selectable things on the map
		// like trees
		
		this.hasBeenInGroup = false;

		this.abilityFlags = null;
		this.spawning = true;

		this.selected = false;

		this.currentX = startingPosition.x;
		this.currentY = startingPosition.y;

		this.path = [{ x: this.currentX, y: this.currentY }];
		this.state = null;
	}

	registerUnit (itemId, objectId1, objectId2) {
		// not sure why yet, but itemId's are reversed?
		itemId = itemId.split("").reverse().join("");

		this.itemId = itemId;
		this.objectId1 = objectId1;
		this.objectId2 = objectId2;

		const { 
			displayName, 
			isBuilding, 
			isUnit 
		} = mappings.getUnitInfo(itemId);

		console.log("Register results: ", itemId, isBuilding, isUnit);

		this.displayName = displayName;
		this.isBuilding = isBuilding;
		this.isUnit = isUnit;
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

		console.log("# moved: ", targetX, targetY);
	}
};

module.exports = Unit;