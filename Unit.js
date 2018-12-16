const Unit = class {
	constructor (itemId1, itemId2, startingPosition) {
		this.itemId1 = itemId1;
		this.itemId2 = itemId2;

		this.objectId = null;

		this.abilityFlags = null;
		this.spawning = true;

		this.selected = false;

		this.currentX = startingPosition.x;
		this.currentY = startingPosition.y;

		this.path = [{ x: this.currentX, y: this.currentY }];
		this.state = null;
	}

	assignObjectId (objectId) {
		this.objectId = objectId;
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