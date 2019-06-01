const Unit = require("./Unit");

const World = class {
	constructor () {
		this.droppedItems = [];
		this.unknownObjects = [];

		
	}

	findUnknownObject (objectId1, objectId2) {
		return this.unknownObjects.find(item => {
			return item.objectId1 === objectId1 &&
						 item.objectId2 === objectId2;
		});
	}

	findDroppedItem (objectId1, objectId2) {
		return this.droppedItems.find(item => {
			return item.objectId1 === objectId1 &&
						 item.objectId2 === objectId2;
		});
	}

	removeDroppedItem (objectId1, objectId2) {
		return this.droppedItems.filter(item => {
			return item.objectId1 === objectId1 &&
						 item.objectId2 === objectId2;
		});
	}

	removeUnknownObject (objectId1, objectId2) {
		return this.unknownObjects.filter(item => {
			return item.objectId1 === objectId1 &&
						 item.objectId2 === objectId2;
		});
	}

	clearKnownItem (objectId1, objectId2) {
		this.removeDroppedItem(objectId1, objectId2);
		this.removeUnknownObject(objectId1, objectId2);
	}

	addUnknownObject (objectId1, objectId2) {
		let worldKnownItem = this.findUnknownObject(objectId1, objectId2);

		if (!worldKnownItem) {
			console.log("Adding unknown object to world.");
			let unknownUnit = new Unit(null, null, null, false);
			unknownUnit.registerObjectIds(objectId1, objectId2);

			this.unknownObjects.push(unknownUnit);
		}
	}
};

module.exports = World;