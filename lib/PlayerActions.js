const utils = require("../helpers/utils"),
      mappings = require("../helpers/mappings");

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
			}

			if (existingUnits.length > 1) {
				if (unregisteredUnit.meta.hero) {

					console.log("Trying to register a hero unit: ", unregisteredUnit);

					let heroUnits = player.units.filter(unit => {
						return (
							unit.itemId === fixedItemId &&
							unit.isIllusion === unregisteredUnit.isIllusion
						);
					});

					console.log("hero unit check: ", heroUnits);
					throw new Error("stop here");
				}
			}

			if (!existingUnits.length) {
				unregisteredUnit.registerUnit(fixedItemId, objectId1, objectId2);
				unregisteredUnit.registerItemIds(itemId1, itemId2);
				unregisteredUnit.spawning = false;
				unregisteredUnit.selected = true;

				player.unregisteredUnitCount--;
			}
			
			player.assignKnownUnits();
			player.updatingSubgroup = false;
		} else {
			console.log("selectSubgroup 3");
			console.log("Filter fixedItemId: ", fixedItemId);

			const unitInfo = mappings.getUnitInfo(fixedItemId);

			let existingUnits = player.units.filter(unit => {
				return unit.itemId === fixedItemId;
			});

			const heroIllusionCheck = (unitInfo.meta.hero && existingUnits.length > 1);

			// only one of these units is known to exist
			// so we know to update it
			if (existingUnits.length === 1 || heroIllusionCheck) {
				if (heroIllusionCheck) {
					console.log("Using new hero illusion check.");
				}

				let existingUnit = existingUnits[0];
				console.log("updating known unit: ", existingUnit.displayName);

				if (existingUnit.meta.hero) {
					console.log("Illusion of hero detected.");
						
					let newUnit = new Unit(player.eventTimer, null, null, fixedItemId, false);
					newUnit.registerObjectIds(objectId1, objectId2);
					newUnit.registerItemIds(itemId1, itemId2);

					newUnit.isIllusion = true;

					player.addPlayerUnit(newUnit);
					player.unregisteredUnitCount++;

					return;
				}

				existingUnit.registerObjectIds(objectId1, objectId2);
				existingUnit.registerItemIds(itemId1, itemId2);
			} else {
				// possibly spawned unit was selected?
				const possibleUnit = mappings.getUnitInfo(fixedItemId);
				if (possibleUnit.isUnit) {
					console.log(1, "Selected a spawned unit", possibleUnit.displayName);

					if (possibleUnit.meta.hero) {
						console.log("before exit: ", existingUnits.length);
						throw new Error("here");
					}

					let newUnit = new Unit(player.eventTimer, null, null, fixedItemId, false);
					newUnit.registerObjectIds(objectId1, objectId2);
					newUnit.registerItemIds(itemId1, itemId2);

					player.addPlayerUnit(newUnit);
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
		console.log("new itemIds: ", itemId1, itemId2);
		console.log("new objIds: ", objectId1, objectId2);

		unit.registerUnit(fixedItemId, objectId1, objectId2);
		unit.registerItemIds(itemId1, itemId2);
		unit.spawning = false;
		unit.selected = true;

		player.updatingSubgroup = false;
		player.assignKnownUnits();
	}
};

module.exports = PlayerActions;