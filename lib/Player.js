const utils = require("../helpers/utils"),
      mappings = require("../helpers/mappings");

const { 
	abilityActions,
	abilityFlagNames,
	mapStartPositions,
	specialBuildings,
	buildingUpgrades
} = mappings;

const Unit = require("./Unit"),
			Hero = require("./Hero"),
			Building = require("./Building"),
			Item = require("./Item"),
      SubGroup = require("./SubGroup"),
      PlayerActions = require("./PlayerActions");

const SelectModes = {
	select: 1,
	deselect: 2
};

const Player = class {
	constructor (id, playerSlot, gameData, eventTimer, world) {
		this.id = id;
		this.gameData = gameData;
		this.playerSlot = playerSlot;
		this.teamId = playerSlot.teamId;
		this.race = playerSlot.raceFlag;

		this.eventTimer = eventTimer;
		this.world = world;

		this.units = [];
		this.setupInitialUnits();

		this.removedBuildings = [];

		this.startingPosition = null;
		this.updatingSubgroup = false;
		this.lastChangeGroupTime = null;
		this.selection = null;
		this.groupSelections = {};

		this.heroSlotCount = 0;

		this.buildMenuOpen = false;
		this.tavernSelected = false;

		this.itemMoveSelected = false;
		this.itemMoveObject = null;

		this.possibleRegisterItem = null;
		this.possibleSelectList = [];

		this.possiblyDeadUnits = [];

		this.knownObjectIds = {
			'worker': null,
			'townhall': null
		};
	}

	setupInitialUnits () {
		const starterMap = {
			'O': {
				'townHallId': 'ogre',
				'workerCount': 5
			},
			'H': {
				'townHallId': 'htow',
				'workerCount': 5
			},
			'E': {
				'townHallId': 'etol',
				'workerCount': 5
			},
			'U': {
				'townHallId': 'unpl',
				'workerCount': 3,
				'workerSpecial': 'ugho'
			}
		};

		if (!starterMap[this.race]) {
			// person is random
			return;
		}

		const { townHallId, workerCount, workerSpecial } = starterMap[this.race];

		// add the town hall
		const townhall = new Building(
			this.eventTimer,
			null,
			null,
			townHallId,
			true
		);

		this.addPlayerBuilding(townhall);

		// add the workers
		for (let i = 0; i < workerCount; i++) {
			const worker = new Unit(
				this.eventTimer,
				null,
				null,
				mappings.workerForRace[this.race],
				true
			);

			this.addPlayerUnit(worker);
		}

		// workers + 1 town hall
		this.unregisteredUnitCount = (workerCount + 1);

		if (workerSpecial) {
			console.logger("giving player special worker: ", workerSpecial);

			const specialUnit = new Unit(
				this.eventTimer,
				null,
				null,
				workerSpecial,
				true
			);

			this.addPlayerUnit(specialUnit);
			this.unregisteredUnitCount += 1;
		}
	}

	getUnitSnapshot () {
		const unitList = this.units.map(unit => {
			const { itemId1, itemId2, isRegistered, spawnTime } = unit;

			if (itemId1 && itemId2) {
				return { 
					itemId1, 
					itemId2,
					spawnTime,
					isRegistered: isRegistered || (this.findUnit(itemId1, itemId2) ? true : false)
				};
			}

			return null;
		}).filter(unit => { return unit !== null; });

		const cleanPossibleList = this.possibleSelectList.map(punit => {
			const { itemId1, itemId2, spawnTime } = punit;
			return { itemId1, itemId2, spawnTime, isRegistered: false };
		});

		return {
			units: Array.from(unitList.concat(cleanPossibleList))
		};
	}

	ensureValidGroup (oldGroup, group) {
		console.logger("running ensureValidGroup");

		const self = this;
		if (!group.length) {
			return [];
		}

		const firstGroupItem = group[0];
		const firstGroupUnit = this.findUnit(firstGroupItem.itemId1, firstGroupItem.itemId2);

		if (!firstGroupUnit || !firstGroupUnit.isRegistered) {
			console.logger("warning: cant check group validity with unknown first unit.");
			return group;
		}

		const oldFirstItem = oldGroup[0];
		const oldFirstUnit = oldFirstItem && this.findUnit(oldFirstItem.itemId1, oldFirstItem.itemId2);

		let groupType;
		if (oldFirstUnit) {
			console.logger("unit group type from old selection");
			groupType = (oldFirstUnit.isBuilding && !oldFirstUnit.isUprooted) ? 0 : 1;
		} else {
			console.logger("unit group type from new selection");
			groupType = (firstGroupUnit.isBuilding && !firstGroupUnit.isUprooted) ? 0 : 1;
		}

		return group.filter(groupItem => {
			const { itemId1, itemId2 } = groupItem;
			const groupUnit = self.findUnit(itemId1, itemId2);

			if (groupUnit) {
				const checkType = (groupUnit.isBuilding && !groupUnit.isUprooted) ? 0 : 1;
				if (checkType !== groupType) {
					console.logger("removing unit of different type from group: ", groupItem);
				}

				if (checkType !== groupType) {
					return false; // filter this unit out
				}
			}

			return true;
		});
	}

	isPlayersRace (itemId) {
		let firstItemIdLetter = itemId[0].toUpperCase();

		return firstItemIdLetter === this.race;
	}

	findUnit (itemId1, itemId2) {
		const searchUnit = {
			itemId1: itemId1,
			itemId2: itemId2
		};

		const unitCheck = (unit) => {
			return utils.isEqualUnitItemId(unit, searchUnit);
		};

		const dupeCheckList = this.units.filter(unitCheck);

		if (dupeCheckList.length > 1 && itemId1 !== null) {
			console.logger("error - found multiple units with same itemId1-2", itemId1, itemId2, dupeCheckList.length);
			console.logger(dupeCheckList.forEach(unit => { unit.printUnit(); }));
			throw new Error("bad unit find");
		}

		return this.units.find(unitCheck);
	}

	findUnitByObjectId (objectId1, objectId2) {
		const dupeCheckList = this.units.filter(unit => {
			return unit.objectId1 === objectId1 &&
			       unit.objectId2 === objectId2;
		});

		if (dupeCheckList.length > 1) {
			console.logger("error - found multiple units with same objectId1-2");
			console.logger(dupeCheckList.forEach(unit => { unit.printUnit(); }));
			throw new Error("bad unit find by objectid");
		}

		return this.units.find(unit => {
			return unit.objectId1 === objectId1 &&
			       unit.objectId2 === objectId2;
		});
	}

	findUnitByItemId (fixedItemId) {
		return this.units.find(unit => {
			return unit.itemId === fixedItemId;
		});
	}

	findUnregisteredUnit () {
		return this.units.find(unit => {
			return unit.objectId1 === null;
		});
	}

	findUnregisteredBuilding () {
		return this.units.find(unit => {
			return unit.isBuilding && unit.itemId1 == null;
		});
	}

	findUnregisteredUnitByItemId (itemId) {
		const unitInfo = mappings.getUnitInfo(itemId);
		console.logger("findUnreg by itemId:", itemId, unitInfo);

		return this.units.find(unit => {
			const unitInfo = mappings.getUnitInfo(unit.itemId);
			const match = unit.itemId === itemId &&
			       (unit.itemId1 === null || unit.objectId1 === null);

			if (!match && unitInfo.meta.evolution) {
				const { meta } = unitInfo;
				const evolutionItemId = meta.evolution.itemId;

				return itemId === evolutionItemId &&
							(unit.itemId1 === null || unit.objectId2 === null);
			}

			if (false && !match) {
				console.logger("unit not a match", itemId, unit.itemId, unit.itemId1, unit.itemId2);
				console.logger("test info: ", 
					(unit.itemId === itemId)  ? "yes" : "no",
					(unit.itemId1 === null)   ? "yes" : "no",
					(unit.objectId1 === null) ? "yes" : "no"
				);
				unit.printUnit();

				console.logger("next unit ----");
			}

			return match;
		});
	}

	findUnregisteredUnitByItemIds (itemId1, itemId2) {
		return this.units.find(unit => {
			return utils.isEqualItemId(unit.itemId1, itemId1) && 
			       utils.isEqualItemId(unit.itemId2, unit.itemId2) &&
			       unit.objectId1 === null;
		});
	}

	findSwapUnitByItemId (itemId) {
		return null;
	}

	filterUnitByItemId (itemId) {
		return this.units.filter(unit => {
			return unit.itemId === itemId;
		});
	}

	getUnknownSelectionUnits () {
		return this.selection.units.filter(unit => {
			const { itemId1, itemId2 } = unit;
			return !this.findUnit(itemId1, itemId2);
		});
	}
		

	addPlayerUnit (unit) {

		if (unit.itemId1 && unit.itemId2) {
			const hasItemIdPair = this.units.find(sunit => {
				return utils.isEqualUnitItemId(sunit, unit);
			});

			if (hasItemIdPair) {
				console.logger("found unit with existing itemId pair");
				hasItemIdPair.printUnit();

				throw new Error("bad unit item id");
			}
		}

		this.units.push(unit);
	}

	addPlayerBuilding (unit) {
		let existingBuilding = this.units.find(playerUnit => {
			return playerUnit.isBuilding &&						 
			       playerUnit.currentX === unit.currentX &&
			       playerUnit.currentY === unit.currentY;
		});

		if (!Building.isTavern(unit.itemId) && existingBuilding) {
			console.logger("!! found existing building already.");
			console.logger(existingBuilding.displayName);

			// TODO: figure out what to do here - maybe the building died and got re-built?
		}

		this.units.push(unit);
	}

	giveItem (unit, itemId, knownOwner = true, isSpawnedAtStart = false, itemSlot = null) {
		const itemSlotId = itemSlot ? itemSlot : unit.getNextItemSlot();		

		// safety check
		unit.checkDestroyed();

		const newItem = new Item(unit.eventTimer, null, null, itemId, isSpawnedAtStart);
		newItem.knownOwner = knownOwner;
		newItem.itemSlotId = itemSlotId;
		unit.items[itemSlotId] = newItem;

		console.logger(`put hero ${unit.displayName} item ${newItem.displayName} in slot ${itemSlotId}`);

		return newItem;
	}

	removePlayerBuilding (unit) {
		let isRegistered = false;

		const { 
			currentX,
			currentY
		} = unit;

		console.logger("Trying to remove building: ", unit.displayName);
		let removeIndex = this.units.findIndex(removeUnit => {
			return removeUnit.currentX === currentX &&
						 removeUnit.currentY === currentY;
		});

		const removedBuilding = this.units[removeIndex];
		if (removedBuilding) {
			console.logger("removing building. index: ", removeIndex);
			console.logger("units before: ", this.units.map(unit => unit.displayName));
			this.removedBuildings.push(removedBuilding);
			this.units.splice(removeIndex, 1);
			console.logger("units after: ", this.units.map(unit => unit.displayName));
		}
	}

	getSelectionUnits (onlyUnregistered = false) {
		const self = this;
		if (!this.selection) {
			console.logger("no selection, return empty");
			return [];
		}

		return this.selection.units.reduce((acc, unitItem) => {
			const { itemId1, itemId2 } = unitItem;
			const unit = self.findUnit(itemId1, itemId2);

			if (!onlyUnregistered && unit) {
				// acc the registered Unit
				acc.push(unit);
			} else if (onlyUnregistered) {
				// acc the raw { itemId1, itemId2 }
				acc.push(unitItem);
			}

			return acc;
		}, []);
	}

	getSelectedUnit () {
		const { selectionIndex } = this.selection;
		const rawUnit = this.selection.units[selectionIndex];

		console.logger("getting selection unit: ", selectionIndex, rawUnit);

		if (!rawUnit) {
			console.logger("raw selection: ", this.selection.units);
			console.logger("WARNING - unable to find unit at selection index");

			return null;
		}

		const { itemId1, itemId2 } = rawUnit;
		return this.findUnit(itemId1, itemId2) || null;
	}

	toggleUpdateSubgroup (action) {
		// auto-gen war3 message was triggered
		this.updatingSubgroup = true;

		// sort of hack to see if we can avoid sameblock detection problems
		this.lastChangeGroupTime = null;
	}

	assignKnownUnits () {
		let self = this;
		let knownObjectIds = this.knownObjectIds;

		const shouldCheckAssignments = Object.keys(knownObjectIds).some(key => {
			return knownObjectIds[key] === null;
		});

		if (!shouldCheckAssignments) {
			return;
		}

		this.units.forEach(unit => {
			if (!unit.isSpawnedAtStart || unit.objectId1 === null) {
				return;
			}

			if (!knownObjectIds.worker && unit.meta.worker) {
				knownObjectIds.worker = unit.objectId1;
			} else if (!knownObjectIds.townhall && unit.isBuilding) {
				knownObjectIds.townhall = unit.objectId1;
			}
		});
	}

	guessUnitType (objectId) {
		const knownObjectIds = this.knownObjectIds;
		const threshold = 6;

		let bestGuess = Object.keys(knownObjectIds).find(key => {
			const knownId = knownObjectIds[key];
			if (knownId === null) {
				return false;
			}

			return Math.abs(knownId - objectId) <= threshold;
		});

		return bestGuess || null;
	}

	setHeroSlot (heroUnit) {
		this.heroSlotCount++;
		
		const nextHeroSlot = this.heroSlotCount;
		heroUnit.heroSlot = nextHeroSlot;

		if (nextHeroSlot === 1) {
			console.logger(this.id, "Gave first hero a TP item.");
			this.giveItem(heroUnit, 'stwp', true, true);
		}

		return heroUnit;
	}


	clearKnownPossibleUnits () {
		console.logger("clearing poss:", this.possibleSelectList.length);
		this.possibleSelectList = this.possibleSelectList.filter(unit => {
			return !this.findUnit(unit.itemId1, unit.itemId1);
		});
		console.logger("after clearing poss:", this.possibleSelectList.length);
	}

	//
	// Called during `selectSubgroup` when unregistered units
	// are known to exist.  The `itemId` is only known for
	// one unit - the first in the selection group.  So
	// we limit the amount of registerable units to 1
	//
	// important note - selection groups are not sorted
	// in such a way that the SelectSubgroup action unit
	// will always be first in the group

	assignPossibleSelectGroup (itemId, objectId1, objectId2) {
		let self = this;
		let doneSearching = false;

		const { selectionIndex, units } = this.selection;

		const knownUnitByObjectIds = this.findUnitByObjectId(objectId1, objectId2);
		if (knownUnitByObjectIds && knownUnitByObjectIds.isRegistered) {
			return null;
		}

		const potentialUnits = units.filter(selectionUnit => {
			const { itemId1, itemId2 } = selectionUnit;
			const unit = self.findUnit(itemId1, itemId2);

			if (!unit) {
				return false;
			}

			return unit.itemId === itemId &&
				unit.objectId1 === null &&
				unit.objectId2 === null;
		});

		if (potentialUnits.length === 1) {
			const potentialUnit = potentialUnits[0];
			console.logger("jeff punit", potentialUnit);
			const punit = this.findUnit(potentialUnit.itemId1, potentialUnit.itemId2);

			if (punit) {
				const { itemId1, itemId2 } = potentialUnit;
				const backfillData = this.possibleSelectList.find(psUnit => {
					return utils.isEqualItemId(psUnit, potentialUnit);
				});

				if (backfillData) {
					console.logger("found backfill for punit");
					punit.performBackfill(backfillData.backfill);	
				}
				
				punit.registerItemIds(itemId1, itemId2);
				punit.printUnit();

				self.unregisteredUnitCount--;
				return punit;
			}
		}
		
		let foundPlayerUnit;
		const selectionUnit = units[selectionIndex];
		console.logger("checking assign possible, raw: ", selectionUnit);

		this.clearKnownPossibleUnits();

		self.possibleSelectList.find(selectItem => {
			if (utils.isEqualUnitItemId(selectItem, selectionUnit)) {
				foundPlayerUnit = self.units.find(playerUnit => {
					return playerUnit.itemId === itemId && // same unit as selection
					       playerUnit.itemId1 === null;
				});

				if (foundPlayerUnit) {
					const { itemId1, itemId2, backfill } = selectItem;

					if (this.findUnit(itemId1, itemId2)) {
						foundPlayerUnit = null;
						return false;
					}
					
					console.logger("found unit to reg:", itemId1, itemId2);
					foundPlayerUnit.performBackfill(backfill);
					foundPlayerUnit.registerItemIds(itemId1, itemId2);
					
					console.logger("found unit from assign possible:");
					foundPlayerUnit.printUnit();

					return true;
				}
			}

			return false;
		});

		return foundPlayerUnit || null;
	}

	checkItemAssignments (hero, checkSlot, objectId1, objectId2) {
		const heroItemId = hero.itemId;
		const currentItem = hero.items[checkSlot];

		console.logger("Checking item assignments: ", hero.displayName, checkSlot);

		let heroes = this.units.filter(unit => {
			return unit.meta.hero;
		});

		let swapItem;
		heroes.forEach(hero => {
			const heroItems = hero.getItemList();

			heroItems.forEach(heroItem => {
				const { item, slot } = heroItem;

				if (hero.itemId !== heroItemId ||
				   (hero.itemId === heroItemId && slot !== checkSlot)) {
					console.logger("Checking other item: ", item);

					if (item.objectId1 === objectId1 &&
						  item.objectId2 === objectId2) {
						swapItem = {
							hero: hero,
							slot: slot,
							item: item
						};
					}
				}
			});
		});

		if (swapItem) {
			const { hero, item, slot } = swapItem;
			console.logger(this.id, "Found an item to swap: ", hero.displayName, slot, item.displayName);
		}

	}

	selectSubgroup (action) {
		const self = this;
		const { itemId, objectId1, objectId2 } = action;
		const fixedItemId = utils.fixItemId(itemId);

		// special tavern edge case
		if (Building.isTavern(fixedItemId)) {
			this.tavernSelected = true;
			this.selection.setSelectionIndex(0);

			console.logger("tavern selected, early exit");
			return; // do nothing for neutral building
		} else if (this.tavernSelected) {
			this.tavernSelected = false;
		}

		let firstGroupItem = this.selection.units[0];

		if (!firstGroupItem) {
			console.logger("Empty selection during selectSubgroup.");
			const focusUnit = this.findUnitByObjectId(objectId1, objectId2);

			if (focusUnit) {
				console.logger("swapping selection for found focus unit: ", focusUnit.displayName);

				// do a kind of hacky thing - 
				// where we detect that our selection group was empty,
				// but we found a unit registered with the objectId1-2 pair.
				// switch to that focus unit artifically

				this.selection.units = [{
					itemId1: focusUnit.itemId1,
					itemId2: focusUnit.itemId1,
					backfill: []
				}];

				firstGroupItem = {
					itemId1: focusUnit.itemId1,
					itemId2: focusUnit.itemId2
				};
			} else {
				console.logger("no focus unit...");

				const otherPlayerUnit = this.world.findKnownUnitByItemAndObjectId(
					this.id,
					fixedItemId, 
					objectId1,
					objectId2
				);

				if (otherPlayerUnit) {
					console.logger("found other player focus unit...", otherPlayerUnit.displayName);

					// do nothing, we found other players unit selected
					return;
				}

				const unregisteredUnit = this.findUnregisteredUnitByItemId(fixedItemId);

				if (unregisteredUnit) {
					console.logger("player has a unreg unit with same itemId");
					unregisteredUnit.printUnit();
				}
			}
		}

		if (!firstGroupItem) {
			console.logger("select subgroup error");
			this.printSelectionUnits();
			this.printUnits();

			return;
			//throw new Error("Unable to find first group item");
		}

		const {itemId1, itemId2} = firstGroupItem;

		if (this.race === "R") {
			console.logger("random race detected, changing to what we see.");
			this.race = fixedItemId.substring(0, 1).toUpperCase();

			console.logger("new race: ", this.race);

			// redo the initial setup
			this.setupInitialUnits();
		}

		if (this.world.findKnownUnitByItemAndObjectId(
			this.id,
			fixedItemId, 
			objectId1, 
			objectId2)
		) {
			console.logger("clicked other persons known unit, exit method", this.id, fixedItemId);

			return;
		}

		if (!this.isPlayersRace(fixedItemId) && !this.findUnitByItemId(fixedItemId) && !this.tavernSelected) {
			console.logger("Early exit. wrong race.");

			const badUnitInfo = mappings.getUnitInfo(fixedItemId);
			console.logger("player race: ", this.race, "bad unit: ", badUnitInfo);

			if (this.tavernSelected) {
				console.logger("tavern is sel");
			}

			return;
		}

		const { numberUnits, units } = this.selection;
		const unknownUnits = units.filter(unit => {
			const { itemId1, itemId2 } = unit;
			return !this.findUnit(itemId1, itemId2);
		});

		console.logger("unknown unit len: ", unknownUnits.length);
		
		if (units.length > 1 && unknownUnits.length === units.length) {
			console.logger("WARNING - unable to register unit in multi-unit group with no knowns.");

			console.logger("unknown units: ", unknownUnits.length, "sel len: ", units.length)
			this.printSelectionUnits();
		} 
		
		console.logger("about to assignPossibleSelectGroup");
		const newlyRegisteredUnit = this.assignPossibleSelectGroup(fixedItemId, objectId1, objectId2);	
		
		console.logger("about to check firstGroupUnit");
		const firstGroupUnit = this.findUnit(itemId1, itemId2);

		if (firstGroupUnit) {
			console.logger("first unit is: ", firstGroupUnit.displayName, firstGroupUnit.itemId);
			firstGroupUnit.printUnit();
			console.logger("first is reg: ", firstGroupUnit.isRegistered ? "yes" : "no");
		} else {
			console.logger("nothing for first group unit at:", itemId1, itemId2);
			console.logger("new reg unit:", newlyRegisteredUnit);
		}

		

		const knownUnitByObjectIds = this.findUnitByObjectId(objectId1, objectId2);

		if (!knownUnitByObjectIds) {
			console.logger("no unit known by objectIds:", objectId1, objectId2);
		}

		if (firstGroupUnit && knownUnitByObjectIds) {
			console.logger("both first group unit and knownUnitByObjectIds");

			if (firstGroupUnit.uuid === knownUnitByObjectIds.uuid) {
				console.logger("same uuid for first and knownUnitByObjectIds");

				this.selection.setSelectionIndex(0);
				return;
			}
		}

		// could not find registered unit by itemId1-2
		// we didn't register any new units from possible select group
		if (!firstGroupUnit && !knownUnitByObjectIds && !newlyRegisteredUnit) {
			console.logger("no first group unit, no newly reg. call select sub group with no knowns");
			PlayerActions.selectSubGroupWithNoKnowns(
				this,
				fixedItemId,
				itemId1, 
				itemId2,
				objectId1,
				objectId2
			);
		} else {
			console.logger("is firstGroupUnit found for tab check:", firstGroupUnit ? "yes" : "no");

			const notSameFirstUnitCheck = firstGroupUnit && fixedItemId !== firstGroupUnit.itemId;

			const objectMismatchCheck = firstGroupUnit && firstGroupUnit.objectId1 &&
				(firstGroupUnit.objectId1 !== objectId1 || firstGroupUnit.objectId2 !== objectId2) &&
				(firstGroupUnit.objectId1 !== null);

			if (objectMismatchCheck) {
				console.logger("obj mismatch, printing unit", objectId1, objectId2);
				firstGroupUnit.printUnit();
			}

			// checks if the unit object is in our selection group
			const objectInGroup = !firstGroupUnit && this.selection.units.find(sUnit => {
				return self.findUnit(sUnit.itemId1, sUnit.itemId2);
			});

			// some units can 'evolve' - changing their `itemId` property
			// e.g peasant <-> militia
			const unitHasEvolution = firstGroupUnit && firstGroupUnit.evolution && 
				firstGroupUnit.evolution.itemId === fixedItemId;

			const hasBuildingUpgrade = firstGroupUnit && buildingUpgrades[firstGroupUnit.itemId];
			if (hasBuildingUpgrade && hasBuildingUpgrade === fixedItemId) {
				console.logger("building upgrade detected:", hasBuildingUpgrade);

				firstGroupUnit.itemId = fixedItemId;
				return;
			} else {
				if (hasBuildingUpgrade && hasBuildingUpgrade !== fixedItemId) {
					console.logger("Has building upgrade but not equal???");
				}

				console.logger("no building upgrade found", firstGroupUnit && firstGroupUnit.itemId, fixedItemId);
			}

			if (knownUnitByObjectIds || (!unitHasEvolution && 
				(notSameFirstUnitCheck || objectMismatchCheck || objectInGroup))
			) {
				console.logger("jeff doing tab switch",
					unitHasEvolution ? "unit has evo" : "unit has no evo",
					notSameFirstUnitCheck ? "not same first unit" : "same first unit",
					objectMismatchCheck ? "object mismatch" : "not object mismatch",
					knownUnitByObjectIds ? "known unit by objectIds" : "not known by objIds"
				);

				this.printSelectionUnits();

				if (knownUnitByObjectIds && !knownUnitByObjectIds.meta.hero) {
					console.logger("already known unit by objectIds");
					knownUnitByObjectIds.printUnit();

					if (knownUnitByObjectIds.itemId1 !== null && !utils.isUnitInList(this.selection.units, knownUnitByObjectIds)) {
						
						if (utils.isUnitInList(this.possiblyDeadUnits, knownUnitByObjectIds)) {
							console.logger("calling unregister objectIds because we found a possibly dead unit");
							knownUnitByObjectIds.unregisterObjectIds();
						} else {
							console.logger("*** not in possibly ded units?");

							if (this.selection.units.length === 1) {
								console.logger("only one unit in group, so just unregister...");
								knownUnitByObjectIds.unregisterObjectIds();
								knownUnitByObjectIds.unregisterItemIds();
							}
						}
					}
				}

				PlayerActions.registerTabSwitch(
					this,
					firstGroupUnit,
					newlyRegisteredUnit,
					fixedItemId,
					itemId1, // the itemId1-2 of the first unit in the selection
					itemId2,
					objectId1,
					objectId2
				);

				return;
			}

			// did not tab switch units - move on to registering our focus unit
			const isRegisteredStr = firstGroupUnit.isRegistered ? "yes" : "no";

			console.logger("calling registerSubGroupFocusUnit, is reg:", isRegisteredStr);
			PlayerActions.registerSubGroupFocusUnit(
				this,
				firstGroupUnit,
				fixedItemId,
				itemId1, 
				itemId2,
				objectId1,
				objectId2
			);
				
		}
	}

	changeSelection (action) {
		const self = this;
		const subActions = action.actions;
    const selectMode = action.selectMode;
    const numberUnits = action.numberUnits;

    // check if changeSelection occurs at same game time
    let sameChangeBlock = false;
    const { gameTime } = this.eventTimer.timer;

    if (!this.lastChangeGroupTime) {
    	this.lastChangeGroupTime = gameTime;
    	sameChangeBlock = false;

    	console.logger("set last change time: ", gameTime);
    } else {
    	sameChangeBlock = (this.lastChangeGroupTime === gameTime);
    	this.lastChangeGroupTime = gameTime;
    }

    let hasUnregisteredUnitFlag = false;
    let subGroup = new SubGroup(numberUnits, subActions);

    if (selectMode === SelectModes.deselect) {
    	// de-selected unit

    	console.logger("before deselect len: ", this.selection.units.length);
    	console.logger("before raw: ", this.selection.units);
    	const beforeLen = this.selection.units.length;
    	this.selection.deselect(subGroup);

    	const diff = beforeLen - numberUnits;

    	if (this.selection.units.length !== diff) {
    		console.logger("jeff diff not match: ", diff);
    	}
    	
    	console.logger("after deselect len: ", this.selection.units.length);
    	console.logger("after raw: ", this.selection.units);

    	this.printSelectionUnits();
    	return;
    }

    if (sameChangeBlock) {
    	console.logger("changeSelection occured same gameTime as last");

    	if (this.selection.units.length > 0) {
    		const unknownSelectionUnits = this.getUnknownSelectionUnits();

    		if (unknownSelectionUnits.length) {
    			console.logger("JEFF - selection not empty when sameChangeBlock");
    			console.logger("unknown sel len: ", unknownSelectionUnits.length);
    			console.logger("unknown raw: ", unknownSelectionUnits);

    			let badSubGroup = new SubGroup(unknownSelectionUnits.length, unknownSelectionUnits);

    			this.selection.deselect(badSubGroup);

    			console.logger("after bad deselect len: ", this.selection.units.length);
    			console.logger("after badraw: ", this.selection.units);

    			//throw new Error("Unable to fully clear selection in same block");
    		}
    		
    	}
    }

  	// register first-time selected units
  	subActions.forEach(subAction => {
  		const {itemId1, itemId2} = subAction;
  		let unit = self.findUnit(itemId1, itemId2);
  		
  		if (unit) {
  			unit.setAliveFlags();
  			return;
  		}
		  
  		if (self.world.findPossibleUnitByItemIds(self.id, itemId1, itemId2)) {
  			console.log("unit already owned by other player", itemId1, itemId2);
  			return;
  		}

		  const inPossibleList = self.possibleSelectList.find(punit => {
		  	return utils.isEqualUnitItemId(punit, {
		  		itemId1: itemId1,
		  		itemId2: itemId2
		  	});
		  });

		  if (!inPossibleList) {
		  	// unit is currently unknown
		  	console.logger("adding to possibleSelectList:", itemId1, itemId2);

		  	self.possibleSelectList.push({
					itemId1: itemId1,
					itemId2: itemId2,
					spawnTime: self.eventTimer.timer.gameTime,
					backfill: []
				});
		  }

			hasUnregisteredUnitFlag = true;
  	});

  	if (this.selection === null) {
  		// no sub-group yet.  assign our newly selected one
  		console.logger("assigned first selection");
  		this.selection = subGroup;	
  	} else {
  		// merge our existing selection with the new SubGroup
  		console.logger("merged groups");
  		this.selection.mergeGroups(subGroup);
  	}

  	console.logger("selection len after sel: ", this.selection.units.length);
    console.logger("raw: ", this.selection.units);

    this.printSelectionUnits();

    if (sameChangeBlock) {
    	if (this.selection.units.length !== numberUnits) {
    		console.logger("Change in same block had different number of units than selection");

    		this.selection.units.forEach(unit => {
    			const inGoodGroup = subGroup.units.find(sunit => {
    				return utils.isEqualUnitItemId(sunit, unit);
    			});
    			
    			if (!inGoodGroup) {
    				if (!utils.isUnitInList(this.possiblyDeadUnits, unit)) {
    					console.logger("adding possibly dead unit:", unit.itemId1, unit.itemId2);
    					this.possiblyDeadUnits.push(unit);	
    				}
    			}
    		});
    	}
    }

  	if (hasUnregisteredUnitFlag) {
  		this.selection.hasUnregisteredUnit = true;
  	}
	}

	useAbilityNoTarget (action) {
		const isItemArray = Array.isArray(action.itemId);
		const itemId = isItemArray ?
			action.itemId : utils.fixItemId(action.itemId);
		const {
			abilityFlags,
			unknownA,
			unknownB
		} = action;
		
		const unitInfo = mappings.getUnitInfo(itemId);
		let selectedUnits = this.getSelectionUnits();

		console.logger("ability selection");
		this.printSelectionUnits();

		if (!selectedUnits.length) {
			// no registered units in selection

			if (unitInfo.isBuilding) {
				// we found a building that hasn't been registered yet
				const firstSelectionItem = this.selection.units[0];
				let maybeBuilding = this.findUnregisteredUnitByItemIds(
					firstSelectionItem.itemId1, 
					firstSelectionItem.itemId2
				);

				// TODO: might be able to figure out which unit did the action
				//       based on the action it-self.  might also just
				//       log some kind of Unit.actionBacklog to process after they do register?

				if (maybeBuilding) {
					console.logger("existing maybe building: ", maybeBuilding);
				} else {
					console.logger("no existing building");
				}
			} else {
				console.logger("not building? ", unitInfo);
			}

			this.printSelectionUnits();
		}

		if (selectedUnits.length) {
			// registered unit used ability 
			const firstUnit = this.getSelectedUnit();
			this.printSelectionUnits();

			if (!firstUnit) {
				// todo: backfill (hero?) action
				console.logger("WARNING - need to backfill action from unreg unit");
				return;
			}

			if (firstUnit.meta.hero) {
				console.logger("hero doing ability with no target");
				if (isItemArray) {
					Hero.doAbilityNoTargetItemArray(
						this,
						firstUnit,
						itemId,
						abilityFlags,
						unknownA,
						unknownB
					);
				} else {
					Hero.doAbilityNoTargetItemId(
						this,
						firstUnit,
						itemId,
						abilityFlags,
						unknownA,
						unknownB
					);
				}
			}

			if (firstUnit.isBuilding || unitInfo.isItem) {
				if (isItemArray) {
					Building.doAbilityNoTargetItemArray(
						this,
						firstUnit,
						itemId,
						abilityFlags,
						unknownA,
						unknownB
					);
				} else {
					Building.doAbilityNoTargetItemId(
						this,
						firstUnit,
						itemId,
						abilityFlags,
						unknownA,
						unknownB
					);	
				}
			}

			return;
		}
		
		switch (abilityFlags) {
			// learn skill
			case abilityFlagNames.Summon:
				if (this.tavernSelected) {
					let newTavernHero = new Unit(this.eventTimer, null, null, itemId, false);
					this.setHeroSlot(newTavernHero);

					console.logger(this.id, "Creating tavern hero: ", unitInfo.displayName);
					this.addPlayerUnit(newTavernHero);
					this.unregisteredUnitCount++;
				}
			break;

			default:
				console.logger("WARNING: no ability found");
			break;
		}
	} 

	useAbilityWithTargetAndObjectId (action) {
		const isItemArray = Array.isArray(action.itemId);
		const { 
			targetX, 
			targetY,
			objectId1,
			objectId2
		} = action;

		let units = this.getSelectionUnits();
		const firstUnit = this.getSelectedUnit();

		console.logger("ability selection");
		this.printSelectionUnits();

		if (!firstUnit) {
			
			// todo: fix this?
			//console.error("Trying to use ability without registered selected unit.");
			//this.selection.printGroup();

			console.logger("error? no first unit in UseAbilityWithTargetAndObjectId");
			console.logger("raw: ", this.selection.units);
			return;
		}

		const abilityActionName = utils.findItemIdForObject(action.itemId, abilityActions);
		switch (abilityActionName) {
			case 'EatTree':
				console.logger("NE Building eating a tree"); // yum
			break;
			case 'UnsummonBuilding':
				console.logger("Detected unsummon");
				let possibleBuilding = utils.closestToPoint(targetX, targetY, this.units, (unit) => {
					return unit.isBuilding;
				});

				if (possibleBuilding) {
					console.logger("Found unsummon building: ", possibleBuilding.displayName);

					this.removePlayerBuilding(possibleBuilding);
				}
			break;
			case 'CastSkillTarget':
				console.logger("Casting target skill at point.");
				console.logger("Unit casting: ", firstUnit.displayName);

				if (firstUnit.meta.hero) {
					console.logger("Hero CastSkillTarget spell.");
					let skill = firstUnit.getSkillForType("pointTarget");

					if (!skill) {
						console.logger("Couldnt find pointTarget skill for unit: ", firstUnit);
						return;
					}

					console.logger("Casting point target skill: ", skill);
				}
			break;
			case 'CastSkillObject':
				console.logger("casting skill on object target.");
				console.logger("Unit casting: ", firstUnit.displayName);

				if (firstUnit.meta.hero) {
					console.logger("Hero CastSkillObject spell.");
					let skill = firstUnit.getSkillForType("objectTarget");

					if (!skill) {
						console.logger("Couldnt find objectTarget skill for unit: ", firstUnit);
						return;
					}
					
					console.logger("Casting object target skill: ", skill);
				}
			break;
			case 'MoveCommand':
				// todo: move without attacking eventually 
				//       once attacking is a thing

				PlayerActions.moveSelectedUnits(this, targetX, targetY);
			break;
			case 'AttackCommand':
				// todo: move with attacking eventually 
				//       once attacking is a thing

				PlayerActions.moveSelectedUnits(this, targetX, targetY);
			break;
			case 'RightClick':
				if (firstUnit && firstUnit.isBuilding) {

					console.logger("Building.doAbilityRightClickWithTargetAndObjectId")
					Building.doAbilityRightClickWithTargetAndObjectId(
						this,
						firstUnit,
						objectId1,
						objectId2,
						targetX,
						targetY
					);
					
				} else if (firstUnit && firstUnit.meta.hero) {


					if (objectId1 === -1 && objectId2 === -1) {
						// TODO: rally point and ability on ground here
						console.logger("moving hero fronted unit group from ground right click");

						PlayerActions.moveSelectedUnits(this, targetX, targetY);
						return;
					}

					Hero.doAbilityRightClickWithTargetAndObjectId(
						this,
						firstUnit,
						objectId1,
						objectId2,
						targetX,
						targetY
					);

				} else if (firstUnit && firstUnit.isUnit) {
					console.logger("normal unit right click");
					PlayerActions.moveSelectedUnits(this, targetX, targetY);
				} else {
					console.logger(this.id, "At bottom of right click.");
					firstUnit.printUnit();
				}
				
			break;
			case 'HeroRevive':
				console.logger("reviving hero!", objectId1, objectId2);
				const targetHero = this.findUnitByObjectId(objectId1, objectId2);

				if (targetHero) {
					console.logger("reviving: ", targetHero.displayName);

					console.logger("building spot: ", firstUnit.currentX, firstUnit.currentY);
					// TODO: track that hero died / revived
					targetHero.printUnit();
					targetHero.reviveAtSpot(firstUnit.currentX, firstUnit.currentY);
				}

			break;
			case 'HeroMoveItem1':
			case 'HeroMoveItem2':
			case 'HeroMoveItem3':
			case 'HeroMoveItem4':
			case 'HeroMoveItem5':
			case 'HeroMoveItem6':
				const itemSlot = abilityActionName.substring(abilityActionName.length - 1);
				const heroItems = firstUnit.getItemList();
				const itemCount = heroItems.length;
				console.logger(this.id, "Hero moving item: ", firstUnit.displayName, "Dest slot:", itemSlot);

				firstUnit.printUnit();

				const knownItem = heroItems.find(heroSlot => {
					const { item } = heroSlot;

					return (item.objectId1 === objectId1 &&
								  item.objectId2 === objectId2) ||
								 (item.knownItemX === targetX &&
								  item.knownItemY === targetY);
				});

				if (itemCount === 1) {
					const slotItem = heroItems[0];

					slotItem.item.registerKnownItem(objectId1, objectId2, targetX, targetY);
					this.world.clearKnownItem(objectId1, objectId2);

					// empty old slot
					firstUnit.setItemSlot(slotItem.slot, null);
					// move item into new slot
					firstUnit.setItemSlot(itemSlot, slotItem.item);

					console.logger(this.id, `${firstUnit.displayName} moved only item ${slotItem.item.displayName} to slot ${itemSlot}`);
					slotItem.item.printUnit();
				} else {
					let destinationItem = firstUnit.items[itemSlot];

					if (destinationItem) {
						// we have an item to swap places with
						// try to figure out what that item is

						console.logger(this.id, `${firstUnit.displayName} moving item ${destinationItem.displayName} in slot ${itemSlot}`);

						let swapCandidates = heroItems.filter(heroItem => {
							return heroItem.slot !== itemSlot;
						});

						if (swapCandidates.length === 1) {
							const swapSlot = swapCandidates[0];
							const swapItem = swapSlot.item;

							console.logger(this.id, "Swapping with only other item: ", swapItem.displayName);
							swapItem.registerKnownItem(objectId1, objectId2, targetX, targetY);
							this.world.clearKnownItem(objectId1, objectId2);

							// move item that is being swapped
							firstUnit.setItemSlot(swapSlot.slot, destinationItem);
							// swap our item into place
							firstUnit.setItemSlot(itemSlot, swapItem);
						}
					} else {
						// no item in the desintation item slot, move ours and clear our the old slot

						console.logger(this.id, "Hero has nothing to swap item with, just put it in place. Slot moved: ", itemSlot);

						if (knownItem) {
							console.logger(this.id, "Known item being swapped: ", knownItem.item.displayName);
							console.logger("current known slot: ", knownItem.slot, "Moving to slot: ", itemSlot);
									
							this.world.clearKnownItem(objectId1, objectId2);

							firstUnit.setItemSlot(knownItem.slot, null);
							firstUnit.setItemSlot(itemSlot, knownItem.item);

							console.logger(this.id, `Put item ${knownItem.item.displayName} into slot ${itemSlot}`);							
						} else {
							console.logger(this.id, "Did not find known item to move, checking possible...");

							const unknownWorldObject = this.world.findUnknownObject(objectId1, objectId2);
							if (unknownWorldObject) {
								console.logger("!! found an unknown world item registered to this objectIds pair");

								// backfill this item into our hero

								const givenItem = this.giveItem(firstUnit, 'Jwid', false, false, itemSlot);
								givenItem.registerKnownItem(objectId1, objectId2, targetX, targetY);

								givenItem.printUnit();
								return;
							}

							let unregisteredSwapItem = heroItems.find(heroItem => {
								const item = heroItem.item;

								return heroItem.slot !== itemSlot &&
											 (item.objectId1 === objectId1 && item.objectId2 === objectId2) ||
											 (item.knownItemX === targetX && item.knownItemY === targetY);
							});

							console.logger(this.id, "Looking for item registered with action objectId");

							if (unregisteredSwapItem) {
								console.logger(this.id, "Found potential unregistered item to assign swap to: ", unregisteredSwapItem.item.displayName);
								unregisteredSwapItem.item.registerKnownItem(objectId1, objectId2, targetX, targetY);
								this.world.clearKnownItem(objectId1, objectId2);

								firstUnit.setItemSlot(unregisteredSwapItem.slot, null);
								firstUnit.setItemSlot(itemSlot, unregisteredSwapItem);

								console.logger(this.id, `Put item ${unregisteredSwapItem.item.displayName} into slot ${itemSlot}`);							
							} else {
								console.logger(this.id, "Unable to find unregistered item in slot: ", itemSlot);
								
								let unregisteredItems = heroItems.filter(heroItem => {
									return heroItem.item.objectId1 === null ||
									       heroItem.item.knownItemX === null;
								});

								if (unregisteredItems.length === 1) {
									console.logger("only found one unregistered item, so lets move it");

									const swapSlot = unregisteredItems[0];
									const swapItem = swapSlot.item;

									swapItem.registerKnownItem(objectId1, objectId2, targetX, targetY);
									this.world.clearKnownItem(objectId1, objectId2);

									firstUnit.setItemSlot(swapSlot.slot, null);
									firstUnit.setItemSlot(itemSlot, swapItem);

									console.logger(this.id, `Put item ${swapItem.displayName} into slot ${itemSlot}`);							
								} else {
									console.logger("%% more than one unregistered item?");

									// note: for some reason the game sets non-integer values
									//       on items that were bought at player shops,
									//       so we use this to help guide our unreg choices.
									const itemFromShop = utils.getDecimalPortion(targetX) !== 0;

									console.logger("is moved item from shop?", itemFromShop ? "yes" : "no");
									console.logger("targetX: ", targetX, "decimal: ", utils.getDecimalPortion(targetX));

									const swapSlot = unregisteredItems.find(slot => {
										const { item } = slot;

										const isFromShop = !item.isSpawnedAtStart;
										return (itemFromShop === isFromShop);
									});

									if (swapSlot) {
										console.logger("found swappable slot");
										
										const { item, slot } = swapSlot;
										item.printUnit();

										item.registerKnownItem(objectId1, objectId2, targetX, targetY);
										this.world.clearKnownItem(objectId1, objectId2);

										firstUnit.setItemSlot(slot, null);
										firstUnit.setItemSlot(itemSlot, item);

										console.logger(`Put item ${item.displayName} into slot ${slot}`);
									}
								}

							}
						}

					}

				}

			break;

			default:
				console.logger("unknown action");
			break;
		}
	}

	useAbilityWithTarget (action) {
		const self = this;
		const { targetX, targetY, itemId } = action;
		const isItemArray = Array.isArray(action.itemId);
		const fixedItemId = utils.fixItemId(itemId);
		const selectionUnits = this.getSelectionUnits();
		
		let firstUnit = this.getSelectedUnit();
		const unitInfo = mappings.getUnitInfo(fixedItemId);

		console.logger("ability selection");
		this.printSelectionUnits();

		console.logger("ability unitInfo: ", unitInfo);

		if (isItemArray) {
			console.logger("Use ability with target item array.");

			const abilityActionName = utils.findItemIdForObject(itemId, abilityActions);
			console.logger("maybe action name: ", abilityActionName);

			switch (abilityActionName) {
				case 'NERoot':
					console.logger("building rooted.");
				break;

				case 'SummonTreants':
					console.logger("summon treant detected");
					Hero.castSummon(this, firstUnit);
				break;

				default:
					console.logger("unable to find unit ability");
				break;
			}

			return;
		} else {
			console.logger("ability not item arraay");

			console.logger("menu open: ", (this.buildMenuOpen) ? "is open" : "is closed");
			console.logger("first unit is: ", firstUnit && firstUnit.displayName);
			console.logger("selection is: ", selectionUnits.map(sunit => sunit.displayName));
			console.logger("raw selection: ", this.selection);
			console.logger("raw selection: ", this.selection.units);

			if (!firstUnit || this.selection.hasUnregisteredUnit) {
				console.logger("Unregistered unit used ability. Check if worker building.");
				const possibleBuilding = mappings.getUnitInfo(fixedItemId);

				if (this.buildMenuOpen && possibleBuilding.isBuilding) {
					console.logger("Found a possible building: ", possibleBuilding.displayName);

					let workerUnits = this.filterUnitByItemId(mappings.workerForRace[this.race]);

					console.logger("worker units: ", workerUnits.map(wunit => {
						return `itemId1: ${wunit.itemId1} id2: ${wunit.itemId2}`;
					}));
				}
			}

			const workerInGroup = selectionUnits.find(sunit => {
				return sunit.meta.worker;
			});

			if (workerInGroup) {
				console.logger("has worker in group");
			}

			if (workerInGroup) {

				const closestWorker = utils.closestToPoint(targetX, targetY, selectionUnits, (sunit => {
					return sunit.meta.worker;
				}));

				if (!utils.isEqualUnitItemId(firstUnit, closestWorker)) {
					console.logger("jeff2");
					firstUnit = closestWorker;
				}

				

				const startingPosition = {
					x: targetX,
					y: targetY
				};

				let building = new Building(this.eventTimer, null, null, fixedItemId, false);
				building.registerUnit(fixedItemId, null, null);
				building.currentX = targetX;
				building.currentY = targetY;

				PlayerActions.checkUnitBackfill(this, building);

				const playerInstance = this;
				console.logger("moving unit to build:", building.itemId, building.displayName, targetX, targetY);
				console.logger("builder unit:", firstUnit.displayName);

				firstUnit.moveToBuild(building, (eventFinished) => {
					console.logger("building callback:", building.itemId);

					if (!eventFinished) {
						
						const distanceLeft = utils.distance(
							building.currentX, building.currentY,
							firstUnit.currentX, firstUnit.currentY
						);

						console.logger("JEFF");
						console.logger("unit dist from building spot: ", distanceLeft, );

						const { gameTime } = playerInstance.eventTimer.timer;

						const gameTimeBuffer = gameTime > 200000 ? 5.5 : 1;
						const maxDistanceBuffer = (2500 * gameTimeBuffer);

						if (distanceLeft > maxDistanceBuffer) {
							console.logger("max distance buff: ", maxDistanceBuffer);
							console.logger("building move event was cancelled before build. builder: ", firstUnit.displayName);
							console.logger("stopped building: ", building.displayName, building.itemId);

							return;
						}
					}

					console.logger(playerInstance.id, "unit finished moving to building, now building: ", building.displayName);

					playerInstance.addPlayerBuilding(building);
					building.startConstruction();

					playerInstance.printUnits();
				});

				// toggle OFF the build menu since we just used it in an action
				console.logger(this.id, "*** setting build menu CLOSED");
				this.buildMenuOpen = false;

				return;
			}

			if (unitInfo.isBuilding) {
				console.logger("WARNING: building did an action we didn't register");
			} else {
				throw new Error("here 3");	
			}
		}
	}

	chooseBuilding (action) {
		console.logger(this.id, "*** setting build menu OPEN");
		this.buildMenuOpen = true;
	}

	assignGroupHotkey (action) {
		const { 
			groupNumber, 
			numberUnits,
			actions
		} = action;

		console.logger("setting group: ", groupNumber);

		console.logger("before set: ", this.selection.units);

		if (actions.length >= 2) {
			let shouldSwapHeroes = false;
			for (let i = 0; i < 2; i++) {
				const { itemId1, itemId2 } = actions[i];
				const unit = this.findUnit(itemId1, itemId2);

				if (unit && unit.meta.hero) {
					shouldSwapHeroes = true;
				} else {
					shouldSwapHeroes = false;
				}
			}

			if (shouldSwapHeroes) {
				console.logger("Swapping first two heroes in hotkey group");
				const oldFirst = actions[0];

				actions[0] = actions[1];
				actions[1] = oldFirst;
			}
		}

		const oldSelection = this.selection;
		const newGroup = new SubGroup(numberUnits, actions);
		newGroup.setFromHotkey = true;

		const newSelection = new SubGroup(numberUnits, actions);
		newSelection.setFromHotkey = true;

		this.groupSelections[groupNumber] = newGroup;
		this.selection = newSelection;

		// ensure the groups have no bugged members in them 
		// sometimes for whatever reason the game includes a building in
		// the 'assign group hotkey' action groups

		this.selection.units = this.ensureValidGroup(oldSelection.units, this.selection.units);
		this.groupSelections[groupNumber].units = this.ensureValidGroup(
			oldSelection.units, 
			this.groupSelections[groupNumber].units
		);


		console.logger("selection units: ", this.selection.units);

		this.printAllGroups();
	}

	selectGroupHotkey (action) {
		const { groupNumber } = action;

		console.logger("selecting group: ", groupNumber);
		if (this.groupSelections[groupNumber]) {
			// todo: add group deselectAll
			const { 
				numberUnits, 
				units,
				hasUnregisteredUnit,
				hasDestroyedSummon,
				destroyedUnits
			} = this.groupSelections[groupNumber];

			let groupCopy = new SubGroup(numberUnits, units, hasUnregisteredUnit);
			this.selection = groupCopy;

			this.selection.hasDestroyedSummon = hasDestroyedSummon;
			this.selection.destroyedUnits = destroyedUnits;
			this.selection.setFromHotkey = true;

			if (this.selection.numberUnits === 0) {
				console.error("%% Error group: ", this.selection);
				throw new Error("Selectected a group hotkey with zero units.");
			}

			console.logger("selected group: ", groupNumber, groupCopy.units);

			this.printAllGroups();
		} else {
			console.error("selected group that didnt exist?");
		}
		
	}

	giveOrDropItem (action ) {
		console.logger("=========================== %%%%%% giveOrDropItem: ", action);
		
		const {
			abilityFlags,
			itemId,
			targetX,
			targetY,
			objectId1,
			objectId2,
			itemObjectId1,
			itemObjectId2
		} = action;

		let selection = this.getSelectionUnits();
		let firstUnit = this.getSelectedUnit();

		if (firstUnit) {
			console.logger(this.id, "Unit giveOrDropItem");

			const heroItems = firstUnit.getItemList();
			const knownItem = heroItems.find(heroItem => {
				const item = heroItem.item;
				return item.objectId1 === itemObjectId1 &&
							 item.objectId2 === itemObjectId2 &&
							 item.objectId1 !== null;
			});

			if (objectId1 === -1 && objectId2 === -1) {
				console.logger("Gave item to ground!");

				if (knownItem) { 
					console.logger("put known item on ground.");
					this.world.droppedItems.push(knownItem.item);
					firstUnit.items[knownItem.slot] = null;
					firstUnit.droppedItems.push(knownItem);
				} else {
					console.logger("Need to find potential item to put down.");
					let potentialItem = heroItems.find(heroItem => {
						const item = heroItem.item;
						return item.objectId1 === null;
					});

					if (potentialItem) {
						console.logger("Dropping potential item: ", potentialItem.item.displayName);

						// todo: track maybeSwapItem here
						potentialItem.item.registerObjectIds(itemObjectId1, itemObjectId2);
						firstUnit.items[potentialItem.slot] = null;

						this.world.droppedItems.push(potentialItem.item);
						firstUnit.droppedItems.push(potentialItem);

						console.logger(this.id, "Dropped items: ", this.world.droppedItems.length);
					} else {
						console.error("No potential items to drop.");
					}
				}

			} else {
				const targetHero = this.findUnitByObjectId(objectId1, objectId2);

				if (targetHero) {
					if (knownItem) {
						firstUnit.items[knownItem.slot] = null;
						firstUnit.droppedItems.push(knownItem);
						targetHero.tradeItem(knownItem.item);

						console.logger(this.id, `Hero ${firstUnit.displayName} gave known item to ${targetHero.displayName}`);	
						
					} else {
						// unkown item being traded
						const unknownWorldUnit = this.world.findUnknownObject(objectId1, objectId2);
						const potentialItem = heroItems.find(heroItem => {
							return heroItem.item.objectId1 === null;
						});

						if (potentialItem) {
							potentialItem.item.registerKnownItem(itemObjectId1, itemObjectId2, targetX, targetY);

							firstUnit.droppedItems.push(potentialItem);
							firstUnit.items[potentialItem.slot] = null;
							targetHero.tradeItem(potentialItem.item);

							console.logger(this.id, `Hero ${firstUnit.displayName} gave unknown item ${potentialItem.item.displayName} to ${targetHero.displayName}`);	
						} else {
							console.logger("Trading hero: ", firstUnit.displayName, "Target: ", targetHero.displayName);
							
							let unknownObject = this.world.findUnknownObject(itemObjectId1, itemObjectId2);
							if (unknownObject) {
								console.logger(this.id, "Found a world item to register.");

								let newUnknownItem = new Item(this.eventTimer, null, null, 'Jwid', false);
								newUnknownItem.registerKnownItem(itemObjectId1, itemObjectId2, targetX, targetY);

								console.logger(this.id, "Gave hero item but had to make new unknown item.");
								targetHero.tradeItem(newUnknownItem);

								this.world.clearKnownItem(itemObjectId1, itemObjectId2);
							} else {

								let newUnknownItem = new Item(this.eventTimer, null, null, 'Jwid', false);
								newUnknownItem.registerKnownItem(itemObjectId1, itemObjectId2, targetX, targetY);
								newUnknownItem.meta.isItem = true;

								console.logger(this.id, "Gave hero item but had to make new unknown item.");
								targetHero.tradeItem(newUnknownItem);
							}
						}
					}
				} else {
					// can't find hero that is getting item
				}
			}
		}

	}

	useAbilityTwoTargets (action) {
		const { itemId2 } = action;
		const fixedItemId2 = utils.fixItemId(itemId2);

		const unitInfo = mappings.getUnitInfo(fixedItemId2);

		console.logger("itemId2 info: ", unitInfo);

		console.logger("ability selection");
		this.printSelectionUnits();
	}

	//
	// debugging method
	//
	printUnits () {
		console.logger("player units for id: ", this.id);

		const sortedUnits = this.units.sort((a, b) => {
			const aName = a.displayName.toUpperCase();
			const bName = b.displayName.toUpperCase();

			if (aName < bName) {
				return -1;
			}

			if (aName > bName) {
				return 1;
			}

			return 0;
		});

		console.logger(sortedUnits.map(unit => {
			return `${unit.displayName} - [${unit.objectId1}, ${unit.objectId2}] ${unit.itemId1}, ${unit.itemId2}`;
		}));
	}

	//
	// debugging method
	//
	printAllGroups () {
		console.logger("all groups: ");
		const self = this;

		Object.keys(this.groupSelections).forEach(key => {
			let group = this.groupSelections[key];

			console.logger(key, "units: ", group.units.map(gunit => {
				const playerUnit = self.findUnit(gunit.itemId1, gunit.itemId2);

				const displayName = playerUnit ? playerUnit.displayName : "Unregistered";

				return gunit.itemId1 + "," + gunit.itemId2 + " - " + displayName;
			}));

			console.logger("meta: ", 
				group.setFromHotkey ? "set from hotkey" : "not set from hotkey",
				group.hasDestroyedSummon ? "has destroyed summon" : "no destroyed units");
		});
	}

	//
	// debugging method
	//
	printSelectionUnits () {
		const self = this;
		console.logger("selection index: ", this.selection.selectionIndex);
		console.logger("current selection units: ", this.selection.units.map(gunit => {
			const playerUnit = self.findUnit(gunit.itemId1, gunit.itemId2);

			if (!playerUnit) {
				return `${gunit.itemId1}, ${gunit.itemId2} - Unregistered`;
			}

			const {
				itemId1,
				itemId2,
				objectId1,
				objectId2,
				displayName
			} = playerUnit;

			return `${itemId1}, ${itemId2} [${objectId1}, ${objectId2}] - ${displayName}`;
		}));
	}
};

module.exports = Player;
