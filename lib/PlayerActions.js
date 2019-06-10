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

	static selectSubGroupWithNoKnownsUnregistered (
		unregisteredUnit,
		player,
		fixedItemId, 
		itemId1, 
		itemId2,
		objectId1,
		objectId2
	) {
		console.log("selectSubgroup 2");
		console.log("item ids: ", itemId1, itemId2);
		// re-assign the objectIds1-2 / itemIds1-2
		// because we're now certain for at least this unit

		let existingUnits = player.units.filter(unit => {
			return unit.itemId === fixedItemId &&
						 unit.objectId1 === null;
		});

		// only one of these units is known to exist
		// so we know to update it
		if (existingUnits.length === 1) {
		
			let existingUnit = existingUnits[0];
			existingUnit.registerObjectIds(objectId1, objectId2);
			existingUnit.registerItemIds(itemId1, itemId2);
		
		} else if (existingUnits.length > 1) {

			// multiple units found
			// if we found a hero, check illusions
			// if we found a non-hero unit, register

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

			if (unregisteredUnit.isUnit) {
				console.log("trying to register unit.");

				let unregisteredWorker = player.units.find(unit => {
					return unit.objectId1 == null &&
								 unit.itemId === fixedItemId;
				});

				if (unregisteredWorker) {
					console.log("registering unit: ", itemId1, itemId2);
					unregisteredWorker.registerUnit(fixedItemId, objectId1, objectId2);
					unregisteredWorker.registerItemIds(itemId1, itemId2);
					unregisteredWorker.spawning = false;
					unregisteredWorker.selected = true;
				}
			}

		} else {
			console.log("WARNING: registering unit with unknown fixedItemId: ", fixedItemId);
			unregisteredUnit.registerUnit(fixedItemId, objectId1, objectId2);
			unregisteredUnit.registerItemIds(itemId1, itemId2);
			unregisteredUnit.spawning = false;
			unregisteredUnit.selected = true;

			console.log("Unreg unit name: ", unregisteredUnit.displayName);

			player.unregisteredUnitCount--;
		}
		
		player.assignKnownUnits();
		player.updatingSubgroup = false;
	}

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
			// subGroup 2
			PlayerActions.selectSubGroupWithNoKnownsUnregistered(
				unregisteredUnit,
				player,
				fixedItemId, 
				itemId1, 
				itemId2,
				objectId1,
				objectId2
			);

			return;
		}

		console.log("selectSubgroup 3");
		console.log("Filter fixedItemId: ", fixedItemId);

		const unitInfo = mappings.getUnitInfo(fixedItemId);

		let existingUnits = player.units.filter(unit => {
			return unit.itemId === fixedItemId;
		});

		console.log("existing unit count: ", existingUnits.length);

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

					console.log("all units: ", player.units.map(pUnit => pUnit.displayName));

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

		if (unit.isRegistered) {
			console.log("not registering already registered unit...");

			return;
		}

		unit.registerUnit(fixedItemId, objectId1, objectId2);
		unit.registerItemIds(itemId1, itemId2);
		unit.spawning = false;
		unit.selected = true;

		player.updatingSubgroup = false;
		player.assignKnownUnits();
	}
};

module.exports = PlayerActions;