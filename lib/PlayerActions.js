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
			console.logger("checking backfill?");
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

		console.logger("possible list before len: ", player.possibleSelectList.length);
		player.possibleSelectList = player.possibleSelectList.filter(possibleUnit => {
			const removedUnit = backfillUnits.find(backfillUnit => {
				if (utils.isEqualItemId(backfillUnit.itemId1, possibleUnit.itemId1) &&
					  utils.isEqualItemId(backfillUnit.itemId2, possibleUnit.itemId2)) {

						console.logger("adding backfill...");
						possibleUnit.backfill.push({
							action: "moveTo",
							target: {
								x: targetX,
								y: targetY
							},
							gameTime: gameTime
						});

						// filter out of the backfill unit list now that we've found the unit
						return true;
				}

				// keep searching for the unit to backfill
				return false;
			});

			return removedUnit ? false : true;
		});

		console.logger("possible list end len: ", player.possibleSelectList.length);
	}

	static destroyUnit (
		player,
		destroyedUnit
	) {
		console.logger("player destroying unit", destroyedUnit.displayName, destroyedUnit.uuid);
		destroyedUnit.printUnit();

		console.logger("destroy:", destroyedUnit.itemId1, destroyedUnit.itemId2);

		//console.logger("before remove destroyed");
		//player.printUnits();

		player.units = player.units.filter(unit => {
			if (destroyedUnit.uuid === unit.uuid) {
				console.logger("found unit to remove from player");

				unit.printUnit();
			}

			return !(destroyedUnit.uuid === unit.uuid);
		});

		//console.logger("after remove destroyed");
		//player.printUnits();

		player.possibleSelectList = player.possibleSelectList.filter(possibleUnit => {
			const unit = { itemId1: possibleUnit.itemId1, itemId2: possibleUnit.itemId2 };

			if (utils.isEqualUnitItemId(destroyedUnit, unit)) {
				console.logger("found possible select to remove");
			}

			return !utils.isEqualUnitItemId(destroyedUnit, unit);
		});

		//console.logger("raw selection units before: ", player.selection.units);
		//player.printSelectionUnits();

		const selectionStartLen = player.selection.units.length;
		player.selection.units = player.selection.units.filter(unit => {
			return !utils.isEqualUnitItemId(unit, destroyedUnit);
		});

		if (selectionStartLen !== player.selection.units.length) {
			player.selection.hasDestroyedSummon = true;
		}

		//console.logger("raw selection units after: ", player.selection.units);
		//player.printSelectionUnits();

		console.logger("destroying groups before:");
		player.printAllGroups();

		Object.keys(player.groupSelections).forEach(groupId => {
			if (!player.groupSelections[groupId]) {
				console.logger("no group for: ", groupId);
			}
			
			const group = player.groupSelections[groupId];

			const groupStartLen = group.units.length;
			group.units = group.units.filter(unit => {
				return !utils.isEqualUnitItemId(unit, destroyedUnit);
			});

			console.logger("raw group:", groupId, group.units);

			if (groupStartLen !== group.units.length) {
				group.hasDestroyedSummon = true;

				console.logger("adding to destroyed units:", destroyedUnit.uuid);
				group.destroyedUnits.push(destroyedUnit);
			}
		});

		console.logger("destroying groups after:");
		player.printAllGroups();
	}

	static handleSummonDestroy (
		player,
		summonUnit,
		snapshot
	) {
		return () => {
			console.logger("-----------------------------------------------------");
			console.logger("starting destroy handler");

			player.printUnits();

			if (summonUnit.itemId1 === null && summonUnit.objectId1 === null) {			
				summonUnit.printUnit();

				console.logger("summonUnit summonDuration: ", summonUnit.summonDuration);

				const currentTime = player.eventTimer.timer.gameTime;
				const targetSpawnTime = currentTime - (summonUnit.summonDuration * utils.SECONDS_TO_MS);

				console.logger("target summon spawn time:", targetSpawnTime);

				const currentSnapshot = player.getUnitSnapshot();
				const freshUnits = currentSnapshot.units.filter(unit => {
					if (unit.isRegistered) {
						return false;
					}

					if (unit.itemId !== summonUnit.itemId) {
						return false;
					}

					const inOtherGroup = snapshot.units.find(snapUnit => {
						return utils.isEqualUnitItemId(unit, snapUnit);
					});

					return (inOtherGroup === null || inOtherGroup === undefined);
				});

				console.logger("freshUnits: ", freshUnits);

				const timeBuffer = (summonUnit.summonDuration * utils.SECONDS_TO_MS);
				const timeCandidates = freshUnits.sort((a, b) => {
					return (a.spawnTime - targetSpawnTime) -
					       (b.spawnTime - targetSpawnTime);
				})
				.filter(unit => {
					return Math.abs(unit.spawnTime - targetSpawnTime) < timeBuffer;
				});

				console.logger("timeCandidates:", timeCandidates);

				if (timeCandidates.length) {
					const choice = timeCandidates[0];

					console.logger("choice: ", choice);

					summonUnit.itemId1 = choice.itemId1;
					summonUnit.itemId2 = choice.itemId2;

					PlayerActions.destroyUnit(player, summonUnit);
					return;
				} else if (timeCandidates.length === 0) {
					console.logger("no candidates... assume this unit never did anything");
				} else {
					player.printUnits();
					throw new Error("oh noes");
				}
			}

			PlayerActions.destroyUnit(player, summonUnit);
		}
	}

	static checkUnitBackfill (
		player,
		backfillUnit
	) {
		console.logger("checking backfill: ", backfillUnit.displayName);
		player.possibleSelectList = player.possibleSelectList.filter(possibleUnit => {
			if (utils.isEqualUnitItemId(backfillUnit, possibleUnit)) {
				const { backfill } = possibleUnit;

				console.logger("found backfill data for unit.");
				backfillUnit.performBackfill(backfill);

				return false; // remove from list
			}

			return true;
		});
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
			console.logger("only one unit exists, reg it");

			let existingUnit = existingUnits[0];
			existingUnit.registerUnit(fixedItemId, objectId1, objectId2);
			existingUnit.registerItemIds(itemId1, itemId2);

			PlayerActions.checkUnitBackfill(player, existingUnit);
		} else if (existingUnits.length > 1) {

			// multiple units found
			// if we found a hero, check illusions
			// if we found a non-hero unit, register

			console.logger("multi unit exists, reg it");

			existingUnits.forEach(eu => {
				eu.printUnit();
			});

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

			if (unregisteredUnit.isUnit || unregisteredUnit.isBuilding) {
				console.logger("found unregistered unit to register");
				unregisteredUnit.printUnit();

				unregisteredUnit.registerUnit(fixedItemId, objectId1, objectId2);
				unregisteredUnit.registerItemIds(itemId1, itemId2);
				unregisteredUnit.spawning = false;
				unregisteredUnit.selected = true;
				PlayerActions.checkUnitBackfill(player, unregisteredUnit);

				console.logger("unit after register");
				unregisteredUnit.printUnit();
			} else {
				console.logger("ERROR - did nothing????");

				throw new Error("did nothing?");
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

			PlayerActions.setSelectionByItemId(player, itemId1, itemId2);

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

				PlayerActions.setSelectionByItemId(player, itemId1, itemId2);

				return;
			}

			existingUnit.registerUnit(fixedItemId, objectId1, objectId2);
			existingUnit.registerItemIds(itemId1, itemId2);

			PlayerActions.checkUnitBackfill(player, existingUnit);
			PlayerActions.setSelectionByItemId(player, itemId1, itemId2);
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

				player.addPlayerUnit(newUnit);
				player.unregisteredUnitCount++;

				PlayerActions.checkUnitBackfill(player, newUnit);
				PlayerActions.setSelectionByItemId(player, itemId1, itemId2);
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

		PlayerActions.setSelectionByItemId(player, itemId1, itemId2);

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
		newlyRegisteredUnit,
		fixedItemId,
		itemId1,
		itemId2,
		objectId1,
		objectId2
	) {


		const badlyDestroyedUnitIndex = player.selection.destroyedUnits.findIndex(dunit => {
			return (dunit.objectId1 === objectId1 &&
				      dunit.objectId2 === objectId2);
		});
		const badlyDestroyedUnit = player.selection.destroyedUnits[badlyDestroyedUnitIndex];

		if (badlyDestroyedUnit) {
			console.logger("WARNING - found badlyDestroyedUnit");
			badlyDestroyedUnit.printUnit();

			const unregSwitchUnit = player.findUnregisteredUnitByItemId(fixedItemId);

			if (unregSwitchUnit) {
				console.logger("detected badly switched unit... reg with old values.");
				unregSwitchUnit.registerItemIds(badlyDestroyedUnit.itemId1, badlyDestroyedUnit.itemId2);
				unregSwitchUnit.registerUnit(fixedItemId, badlyDestroyedUnit.objectId1, badlyDestroyedUnit.objectId2);
				console.logger("adding unregSwitchUnit to selection...");
				
				player.selection.addUnit(
					unregSwitchUnit.itemId1,
					unregSwitchUnit.itemId2
				);

				PlayerActions.destroyUnit(player, badlyDestroyedUnit);

				console.logger("removing index: ", badlyDestroyedUnitIndex, "len: ", player.selection.destroyedUnits.length);
				player.selection.destroyedUnits.splice(badlyDestroyedUnitIndex, 1);
				console.logger("end len: ", player.selection.destroyedUnits.length);

				PlayerActions.setSelectionByItemId(
					player, 
					unregSwitchUnit.itemId1,
					unregSwitchUnit.itemId2
				);

				return;
			} else {
				console.logger("WARNING - unable to find unreg itemId for badlyDestroyedUnit");
			}
		}



		const unitInfo = mappings.getUnitInfo(fixedItemId);
		const switchedUnit = player.findUnitByObjectId(objectId1, objectId2);

		if (switchedUnit && switchedUnit.isRegistered) {
			console.logger("jeff5.1 potential");

			if (!utils.isItemIdInList(player.selection.units, switchedUnit.itemId1, switchedUnit.itemId2)) {
				console.logger("jeff5.2 - detected bad switch");

				player.selection.units = [];
				player.selection.addUnit(switchedUnit.itemId1, switchedUnit.itemId2);

				PlayerActions.setSelectionByItemId(
					player, 
					switchedUnit.itemId1,
					switchedUnit.itemId2
				);

				return;
			} else {
				console.logger("jeff5.3 in group");
			}
		}

		let finalSwitchedUnit;

		const { setFromHotkey, hasDestroyedSummon } = player.selection;

		if (switchedUnit) {
			console.logger("found tab switch by objectId, switching to: ", switchedUnit.displayName);

			switchedUnit.printUnit();
			player.printSelectionUnits();

			console.logger("1Registering objectIds to unit: ", objectId1, objectId2);
			switchedUnit.registerObjectIds(objectId1, objectId2);
			finalSwitchedUnit = switchedUnit;
		} else {
			console.logger("WARNING: unable to find tab switch unit by objectId.");
			console.logger("now looking for unreg: ", itemId1, itemId2);

			const switchUnitByItemIds = player.findUnregisteredUnitByItemIds(itemId1, itemId2);
			if (switchUnitByItemIds && switchUnitByItemIds.itemId === fixedItemId) {
				console.logger("found switch unit to register: ", switchUnitByItemIds.displayName);
				console.logger("2Registering objectIds to unit: ", objectId1, objectId2);
				switchUnitByItemIds.registerUnit(fixedItemId, objectId1, objectId2);
				finalSwitchedUnit = switchUnitByItemIds;
			} else {
				console.logger("ERROR: could not find unreg unit by itemId.");

				// todo: probably can still regeister unreg units here

				if (newlyRegisteredUnit) {
					console.logger("has newly reg unit - ");

					if (!newlyRegisteredUnit.printUnit) {
						console.logger("weird new unit: ", newlyRegisteredUnit);
					}

					newlyRegisteredUnit.printUnit();
				} else {
					console.logger("no newly reg units");
				}

				if (!newlyRegisteredUnit) {
					// try to find a unit by itemId

					const switchUnitByItemId = player.findUnregisteredUnitByItemId(fixedItemId);

					if (switchUnitByItemId) {
						console.logger("found unit by itemId, reg objectIds");

						let detectedUnregistered = false;
						if (switchUnitByItemId.itemId1 === null) {
							console.logger("detected a unit that was unreg.");

							if (player.selection.units.length === 1) {
								const selectionUnit = player.selection.units[0];
								const existingBadUnit = player.findUnit(selectionUnit.itemId1, selectionUnit.itemId2);

								if (existingBadUnit) {
									console.logger("*** detected bad existing unit, unregister itemId1-2 pair");
									existingBadUnit.unregisterItemIds();
									existingBadUnit.unregisterObjectIds();
								}

								console.logger("setting only unit in group to itemId1-2 pair", selectionUnit);
								detectedUnregistered = true;
								switchUnitByItemId.registerItemIds(selectionUnit.itemId1, selectionUnit.itemId2);
							}
						}

						const possibleSelectItems = player.selection.units.filter(rawUnit => {
							if (player.findUnit(rawUnit.itemId1, rawUnit.itemId2)) {
								console.logger("exisiting unit: ", rawUnit);
								return false;
							}

							console.logger("comping: ", rawUnit.itemId1, rawUnit.itemId2, "-", itemId1, itemId2);
							return !utils.isEqualUnitItemId(rawUnit, {itemId1, itemId2});
						});

						console.logger("possible select items: ", possibleSelectItems);

						if (!detectedUnregistered) {
							if (!possibleSelectItems.length) {
								player.printSelectionUnits();
								player.printUnits();

								const firstUnreg = player.getFirstUnregisteredUnit();

								if (firstUnreg) {
									console.logger("Assignign first unreg unit", firstUnreg);
									switchUnitByItemId.registerItemIds(firstUnreg.itemId1, firstUnreg.itemId1);
									switchUnitByItemId.registerObjectIds(objectId1, objectId2);
									return;
								}

								console.logger("WARNING - couldn't handle this selection");
								return;
							}

							if (possibleSelectItems.length === 1) {
								const newItem = possibleSelectItems[0];

								console.logger("found only one unknown itemId in selection: ", newItem);
								switchUnitByItemId.registerItemIds(newItem.itemId1, newItem.itemId2);
							} else {
								const newItem = possibleSelectItems[0];

								console.logger(
									"WARNING -found multi one unknown itemId in selection:", 
									newItem.itemId1,
									newItem.itemId2
								);

								switchUnitByItemId.registerItemIds(newItem.itemId1, newItem.itemId2);
							}
						}

						switchUnitByItemId.registerUnit(fixedItemId, objectId1, objectId2);
						switchUnitByItemId.printUnit();

						finalSwitchedUnit = switchUnitByItemId;
					} else {
						player.printUnits();
						player.printSelectionUnits();

						console.logger("unit info: ", unitInfo);
						console.logger("possibly dead: ", player.possiblyDeadUnits);

						const badUnit = player.findUnitByItemId(fixedItemId);
						if (badUnit) {
							console.logger("found bad unit");
							badUnit.printUnit();

							badUnit.unregisterObjectIds();
							badUnit.registerObjectIds(objectId1, objectId2);
							finalSwitchedUnit = badUnit;
						} else {
							throw new Error("unable to find tab switch permanent unit.");	
						}
					}
				} else {
					// register our newly registered unit 
					console.logger("have a newly reg unit, assign it as final");
					newlyRegisteredUnit.printUnit();

					finalSwitchedUnit = newlyRegisteredUnit;	
				}
				
				player.printSelectionUnits();
				player.printUnits();

				if (!finalSwitchedUnit) {
					throw new Error("here bad");
				}
				
			}
		}

		PlayerActions.setSelectionByItemId(
			player, 
			finalSwitchedUnit.itemId1,
			finalSwitchedUnit.itemId2
		);

		return;
	}

	static setSelectionByItemId (player, itemId1, itemId2, mustFind = false) {
		console.logger("set selection to:", itemId1, itemId2);

		const targetUnit = { itemId1, itemId2 };
		const unitSelectionIndex = player.selection.units.findIndex(selectionUnit => {
			return utils.isEqualItemId(selectionUnit.itemId1, targetUnit.itemId1) &&
						 utils.isEqualItemId(selectionUnit.itemId2, targetUnit.itemId2)
		});

		// move the selection to the 0 position in the selection list
		console.logger("setting selected unit index: ", unitSelectionIndex);

		if (unitSelectionIndex === -1) {
			console.logger("bad unit ids: ", itemId1, itemId2);

			console.logger("dead units: ", player.possiblyDeadUnits);

			console.logger("raw sel: ", player.selection);

			throw new Error("unable to find unit to set selection");
		}

		player.selection.setSelectionIndex(unitSelectionIndex);
		player.printSelectionUnits();
	}
};

module.exports = PlayerActions;
