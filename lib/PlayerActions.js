const path = require("path");

const utils = require("../helpers/utils"),
      mappings = require("../helpers/mappings");

const Unit = require("./Unit"),
			Building = require("./Building");

const SubGroup = require("./SubGroup");

const { 
	abilityActions,
	abilityFlagNames,
	mapStartPositions,
	commonMapNames,
	specialBuildings
} = mappings;

const PlayerActions = class {

	static setItemCooldown (player, item) {
		item.setCooldownState(true);

		player.eventTimer.addEvent(
			item.cooldown * utils.SECONDS_TO_MS,
			() => { /* no-op */ },
			() => { item.setCooldownState(false); }
		);
	}

	static moveSelectedUnits (
		player,
		targetX,
		targetY
	) {
		const units = player.getSelectionUnits();

		if (!player.startingPosition) {
			PlayerActions.findStartPosition(player, targetX, targetY);
		}

		// check if we have unregistered units that need actions backfilled
		if (units.length !== player.selection.units.length) {
			PlayerActions.backfillMoveSelection(player, targetX, targetY);
		}

		// move our registered units normally
		units.forEach(unit => {
			unit.moveTo(targetX, targetY);
		});
	}

	// guess the players starting position
	// based on the closest one to their first movement

	static findStartPosition (player, targetX, targetY) {
		const { mapName } = player.gameData;
		const baseMapName = path.basename(mapName).toLowerCase();

		let startPositions;

		if (mapStartPositions[baseMapName]) {
			startPositions = mapStartPositions[baseMapName];
		} else {
			// auto detect the map name from common names for the map
			// TODO: probably move this into setup / init
			
			const commonMapName = Object.keys(commonMapNames).find(mapItem => {
	      if (baseMapName.indexOf(mapItem) !== -1) {
	        return mapItem;
	      }
    	});

    	startPositions = mapStartPositions[commonMapNames[commonMapName]];
		}
			
		if (!startPositions) {
			console.error("unrecognized map: unable to register start positions", baseMapName);
		}

		let positions = Object.keys(startPositions).map(spotId => {
			const startPosition = startPositions[spotId];
			const { x, y } = startPosition;

			return {
				startPosition: startPosition,
				distance: utils.distance(
					targetX, targetY,
					x, y
				)
			};
		});

		positions.sort((a, b) => {
			return a.distance - b.distance;
		});

		const winner = positions[0];
		player.startingPosition = winner.startPosition;

		player.units.forEach(unit => {
			unit.currentX = winner.startPosition.x;
			unit.currentY = winner.startPosition.y;
		});

	}

	static backfillMoveSelection (
		player,
		targetX,
		targetY
	) {
		const { gameTime } = player.eventTimer.timer;
		let backfillUnits = player.getSelectionUnits(true);

		player.possibleSelectList.forEach(possibleUnit => {
			backfillUnits.filter(backfillUnit => {
				if (utils.isEqualItemId(backfillUnit.itemId1, possibleUnit.itemId1) &&
					  utils.isEqualItemId(backfillUnit.itemId2, possibleUnit.itemId2)) {

						possibleUnit.backfill.push({
							action: "moveTo",
							target: {
								x: targetX,
								y: targetY
							},
							gameTime: gameTime
						});

						// filter out of the backfill unit list now that we've found the unit
						return false;
				}

				// keep searching for the unit to backfill
				return true;
			});
		});
	}

	static destroyUnit (
		player,
		destroyedUnit
	) {
		console.logger("player destroying unit", destroyedUnit.displayName, destroyedUnit.uuid);
		destroyedUnit.printUnit();

		console.logger("before remove destroyed");
		player.printUnits();

		player.units = player.units.filter(unit => {
			if (destroyedUnit.uuid === unit.uuid) {
				console.logger("found unit to remove from player");

				unit.printUnit();
			}

			return !(destroyedUnit.uuid === unit.uuid);
		});

		console.logger("after remove destroyed");
		player.printUnits();

		player.possibleSelectList = player.possibleSelectList.filter(possibleUnit => {
			const unit = { itemId1: possibleUnit.itemId1, itemId2: possibleUnit.itemId2 };

			if (utils.isEqualUnitItemId(destroyedUnit, unit)) {
				console.logger("found possible select to remove");
			}

			return !utils.isEqualUnitItemId(destroyedUnit, unit);
		});
	}

	static checkUnitBackfill (
		player,
		backfillUnit
	) {
		console.logger("checking backfill: ", backfillUnit.displayName);
		console.logger("poss len: ", player.possibleSelectList.length);
		player.possibleSelectList = player.possibleSelectList.filter(possibleUnit => {
			if (utils.isEqualUnitItemId(backfillUnit, possibleUnit)) {
				const { backfill } = possibleUnit;

				console.logger("found backfill...", possibleUnit.itemId1, possibleUnit.itemId2);
				backfillUnit.performBackfill(backfill);

				return false; // remove from list
			}

			return true;
		});

		console.logger("poss len after: ", player.possibleSelectList.length);
	}	

	static selectSubGroupWithNoKnownsUnregistered (
		unregisteredUnit,
		player,
		fixedItemId, 
		itemId1, 
		itemId2,
		objectId1,
		objectId2
	) {
		console.logger("selectSubgroup 2");
		console.logger("item ids: ", itemId1, itemId2);
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
			existingUnit.registerUnit(fixedItemId, objectId1, objectId2);
			existingUnit.registerItemIds(itemId1, itemId2);

			PlayerActions.checkUnitBackfill(player, existingUnit);
		} else if (existingUnits.length > 1) {

			// multiple units found
			// if we found a hero, check illusions
			// if we found a non-hero unit, register

			if (unregisteredUnit.meta.hero) {

				console.logger("Trying to register a hero unit: ", unregisteredUnit);

				let heroUnits = player.units.filter(unit => {
					return (
						unit.itemId === fixedItemId &&
						unit.isIllusion === unregisteredUnit.isIllusion
					);
				});

				console.logger("hero unit check: ", heroUnits);
				throw new Error("stop here");
			}

			if (unregisteredUnit.isUnit) {
				console.logger("found unregistered unit to register");
				unregisteredUnit.printUnit();

				unregisteredUnit.registerUnit(fixedItemId, objectId1, objectId2);
				unregisteredUnit.registerItemIds(itemId1, itemId2);
				unregisteredUnit.spawning = false;
				unregisteredUnit.selected = true;
				PlayerActions.checkUnitBackfill(player, unregisteredUnit);

				console.logger("unit after register");
				unregisteredUnit.printUnit();
			}

		} else {
			console.logger("WARNING: registering unit with unknown fixedItemId: ", fixedItemId);
			
			unregisteredUnit.registerUnit(fixedItemId, objectId1, objectId2);
			unregisteredUnit.registerItemIds(itemId1, itemId2);
			unregisteredUnit.spawning = false;
			unregisteredUnit.selected = true;

			PlayerActions.checkUnitBackfill(player, unregisteredUnit);

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
		console.logger("selectSubgroup 1");
		// look for a unit by the itemId to maybe register
		let unregisteredUnit = player.findUnregisteredUnitByItemId(fixedItemId);

		if (unregisteredUnit) {
			// subGroup 2
			console.logger("found unreg unit at:", fixedItemId);

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

		console.logger("selectSubgroup 3");
		console.logger("Filter fixedItemId: ", fixedItemId);

		const unitInfo = mappings.getUnitInfo(fixedItemId);

		let existingUnits = player.units.filter(unit => {
			return unit.itemId === fixedItemId;
		});

		console.logger("existing unit count: ", existingUnits.length);

		const heroIllusionCheck = (unitInfo.meta.hero && existingUnits.length > 1);

		// only one of these units is known to exist
		// so we know to update it
		if (existingUnits.length === 1 || heroIllusionCheck) {
			if (heroIllusionCheck) {
				console.logger("Using new hero illusion check.");
			}

			let existingUnit = existingUnits[0];
			console.logger("updating known unit: ", existingUnit.displayName);

			if (existingUnit.meta.hero) {
				console.logger("Illusion of hero detected.");
					
				let newUnit = new Unit(player.eventTimer, null, null, fixedItemId, false);
				newUnit.registerUnit(fixedItemId, objectId1, objectId2);
				newUnit.registerItemIds(itemId1, itemId2);

				newUnit.isIllusion = true;

				PlayerActions.checkUnitBackfill(player, newUnit);

				player.addPlayerUnit(newUnit);
				player.unregisteredUnitCount++;

				console.logger("existing:");
				existingUnit.printUnit();

				console.logger("new");
				newUnit.printUnit();

				return;
			}

			existingUnit.registerUnit(fixedItemId, objectId1, objectId2);
			existingUnit.registerItemIds(itemId1, itemId2);

			PlayerActions.checkUnitBackfill(player, existingUnit);
		} else {
			// possibly spawned unit was selected?
			const possibleUnit = mappings.getUnitInfo(fixedItemId);
			if (possibleUnit.isUnit) {
				console.logger(1, "Selected a spawned unit", possibleUnit.displayName);

				if (possibleUnit.meta.hero) {
					console.logger("for some reason a hero is bad here?");

					player.printUnits();

					throw new Error("here");
				}

				console.logger("creating new unit: ", possibleUnit.displayName);
				let newUnit = new Unit(player.eventTimer, null, null, fixedItemId, false);

				newUnit.registerItemIds(itemId1, itemId2);
				newUnit.registerUnit(fixedItemId, objectId1, objectId2);

				PlayerActions.checkUnitBackfill(player, newUnit);

				player.addPlayerUnit(newUnit);
				player.unregisteredUnitCount++;

				player.printSelectionUnits();
			} else if (fixedItemId === specialBuildings.tavern) {
				console.logger("selected a tavern building");

				let building = new Building(this.eventTimer, null, null, fixedItemId, false);
				building.registerUnit(fixedItemId, objectId1, objectId2);

				// set the tavern to a unique position to avoid false positives on other checks
				building.currentX = -1.11;
				building.currentY = 1.11;

				PlayerActions.checkUnitBackfill(player, building);

				player.addPlayerBuilding(building);
				
			
			} else {
				console.logger("^^^^ Unknown action performed: ", fixedItemId);
				console.logger("Possible unit: ", possibleUnit);

				player.printUnits();
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
		console.logger("Registering unit: ", fixedItemId);
		console.logger("new itemIds: ", itemId1, itemId2);
		console.logger("new objIds: ", objectId1, objectId2);

		if (unit.isRegistered) {
			console.logger("not registering already registered unit...");

			unit.printUnit();

			if (unit.objectId1 !== objectId1 || unit.objectId2 !== objectId2) {
				console.logger("error? objectid not same?");

				unit.printUnit();

				throw new Error("here 7");
			}

			player.possibleSelectList = player.possibleSelectList.filter(selectionUnit => {
				const foundSelectionUnit = (
					utils.isEqualItemId(selectionUnit.itemId1, itemId1) &&
					utils.isEqualItemId(selectionUnit.itemId2, itemId2)
				);

				return !foundSelectionUnit;
			});

			return;
		}

		unit.registerUnit(fixedItemId, objectId1, objectId2);
		unit.registerItemIds(itemId1, itemId2);
		unit.spawning = false;
		unit.selected = true;

		PlayerActions.checkUnitBackfill(player, unit);

		player.updatingSubgroup = false;
		player.assignKnownUnits();
	}

	static registerTabSwitch (
		player,
		firstGroupUnit,
		newlyRegisteredUnits,
		fixedItemId,
		itemId1,
		itemId2,
		objectId1,
		objectId2
	) {
		const unitInfo = mappings.getUnitInfo(fixedItemId);
		const switchedUnit = player.findUnitByObjectId(objectId1, objectId2);

		let finalSwitchedUnit;

		if (switchedUnit) {
			console.logger("found tab switch by objectId, switching to: ", switchedUnit.displayName);

			switchedUnit.printUnit();

			player.printSelectionUnits();

			console.logger("1Registering objectIds to unit: ", objectId1, objectId2);
			switchedUnit.registerObjectIds(objectId1, objectId2);
			finalSwitchedUnit = switchedUnit;
		} else {
			console.logger("WARNING: unable to find tab switch unit by objectId. looking for: ", itemId1, itemId2);

			const switchUnitByItemIds = player.findUnregisteredUnitByItemIds(itemId1, itemId2);
			if (switchUnitByItemIds && switchUnitByItemIds.itemId === fixedItemId) {
				console.logger("found switch unit to register: ", switchUnitByItemIds.displayName);
				console.logger("2Registering objectIds to unit: ", objectId1, objectId2);
				switchUnitByItemIds.registerUnit(fixedItemId, objectId1, objectId2);
				finalSwitchedUnit = switchUnitByItemIds;
			} else {
				console.logger("ERROR: could not find unreg unit by itemId.");

				// todo: probably can still regeister unreg units here

				if (newlyRegisteredUnits.length > 1) {
					console.logger("WARNING: multiple newly registered units");
				}

				if (!newlyRegisteredUnits.length) {
					// try to find a unit by itemId

					const switchUnitByItemId = player.findUnregisteredUnitByItemId(fixedItemId);

					if (switchUnitByItemId) {
						console.logger("found unit by itemId, reg objectIds");

						switchUnitByItemId.registerUnit(fixedItemId, objectId1, objectId2);
						switchUnitByItemId.printUnit();

						finalSwitchedUnit = switchUnitByItemId;
					} else {
						player.printUnits();
						player.printSelectionUnits();

						console.logger("test unit: ", player.findUnitByObjectId(objectId1, objectId2));

						console.logger("unit info: ", unitInfo);
						throw new Error("unable to find tab switch permanent unit.");	
					}
				} else {
					// register our newly registered unit 
					finalSwitchedUnit = newlyRegisteredUnits[0];	
				}
				

				if (!finalSwitchedUnit) {
					throw new Error("here bad");
				}
				
				player.printSelectionUnits();
				player.printUnits();

			}
		}

		let unitSelectionIndex = player.selection.units.findIndex(selectionUnit => {
			return utils.isEqualItemId(selectionUnit.itemId1, finalSwitchedUnit.itemId1) &&
						 utils.isEqualItemId(selectionUnit.itemId2, finalSwitchedUnit.itemId2)
		});

		if (unitSelectionIndex === -1) {
			console.logger("WARNING: did not find unit selection index in current selection");
			finalSwitchedUnit.printUnit();
			player.printSelectionUnits();

			console.logger("switching selection to be just this unit");
			finalSwitchedUnit.registerUnit(fixedItemId, objectId1, objectId2);
				
			PlayerActions.checkUnitBackfill(player, finalSwitchedUnit);
			return;			
		}

		// move the selection to the 0 position in the selection list
		console.logger("swapping: ", unitSelectionIndex, 0);

		player.printSelectionUnits();

		if (unitSelectionIndex === 0) {
			const knownUnitsBeyondFirst = player.selection.units.filter((kunit, ind) => {
				if (ind === 0) {
					// always remove first focus unit for test
					return false;
				}

				return kunit.objectId1 && kunit.objectId2;
			});

			if (knownUnitsBeyondFirst.length) {
				console.logger("known units beyond first: ", knownUnitsBeyondFirst);

				console.logger("trying to tab switch with first unit index????");

				player.printSelectionUnits();
				throw new Error("here bad tab");
			} else {
				return; // no-op
			}
		}

		player.selection.swapUnitPosition(unitSelectionIndex, 0);

	}
};

module.exports = PlayerActions;
