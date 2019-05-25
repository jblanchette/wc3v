const utils = require("./utils"),
      mappings = require("./mappings");

const Unit = require("./Unit");

const { 
	abilityActions,
	abilityFlagNames,
	mapStartPositions,
	specialBuildings
} = mappings;

const PlayerActions = class {
	static selectSubGroupWithNoKnowns (
		player,
		fixedItemId, 
		itemId1, 
		itemId2,
		objectId1,
		objectId2
	) {
		console.log("selectSubgroup 1");
		// look for a unit by the itemId to maybe register
		let unregisteredUnit = player.findUnregisteredUnitByItemId(fixedItemId);
		if (unregisteredUnit) {
			console.log("selectSubgroup 2");
			// re-assign the objectIds1-2 / itemIds1-2
			// because we're now certain for at least this unit

			let existingUnits = player.units.filter(unit => {
				return unit.itemId === fixedItemId;
			});

			// only one of these units is known to exist
			// so we know to update it
			if (existingUnits.length === 1) {
				let existingUnit = existingUnits[0];
				existingUnit.registerObjectIds(objectId1, objectId2);
			} else {
				unregisteredUnit.registerUnit(fixedItemId, objectId1, objectId2);
				unregisteredUnit.registerItemIds(itemId1, itemId2);

				if (unregisteredUnit.meta.hero && unregisteredUnit.knownLevel === 0) {
					console.log(
						player.id, 
						'Registered unit 1', 
						unregisteredUnit.displayName,
						unregisteredUnit.knownLevel
					);
					console.log(action);
					console.log("*************************");
				}

				unregisteredUnit.spawning = false;
				unregisteredUnit.selected = true;

				player.unregisteredUnitCount--;
			}
			
			player.assignKnownUnits();
			player.updatingSubgroup = false;
		} else {
			console.log("selectSubgroup 3");
			let existingUnits = player.units.filter(unit => {
				return unit.itemId === fixedItemId;
			});

			// only one of these units is known to exist
			// so we know to update it
			if (existingUnits.length === 1) {
				let existingUnit = existingUnits[0];
				console.log("updating known unit: ", existingUnit.displayName);

				if (existingUnit.meta.hero) {
					console.log("Possible illusion of hero detected.");
					return;
				}

				existingUnit.registerObjectIds(objectId1, objectId2);
				existingUnit.registerItemIds(itemId1, itemId2);
			} else {
				// possibly spawned unit was selected?
				let possibleUnit = mappings.getUnitInfo(fixedItemId);
				if (possibleUnit.isUnit) {
					console.log(1, "Selected a spawned unit", possibleUnit.displayName);

					let newUnit = new Unit(null, null, fixedItemId, false);
					newUnit.registerObjectIds(objectId1, objectId2);
					newUnit.registerItemIds(itemId1, itemId2);

					player.units.push(newUnit);

					player.unregisteredUnitCount++;
				} else {
					console.log("^^^^ Unknown action performed: ", fixedItemId);
					console.log("Possible unit: ", possibleUnit);
				}
			}
		}
	}
 
	static registerSubGroupFocusUnit (
		player, 
		unit, 
		fixedItemId, 
		itemId1, 
		itemId2,
		objectId1,
		objectId2
	) {
		console.log("Registering unit: ", fixedItemId);
		unit.registerUnit(fixedItemId, objectId1, objectId2);
		unit.registerItemIds(itemId1, itemId2);
		unit.spawning = false;
		unit.selected = true;

		player.updatingSubgroup = false;
		player.assignKnownUnits();
	}
};

module.exports = PlayerActions;