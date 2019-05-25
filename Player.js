const utils = require("./utils"),
      mappings = require("./mappings");

const { 
	abilityActions,
	abilityFlagNames,
	mapStartPositions,
	specialBuildings
} = mappings;

const Unit = require("./Unit"),
			Hero = require("./Hero"),
			Building = require("./Building"),
      SubGroup = require("./SubGroup"),
      PlayerActions = require("./PlayerActions");

const SelectModes = {
	select: 1,
	deselect: 2
};

const Player = class {
	constructor (id, playerSlot, world) {
		this.id = id;
		this.playerSlot = playerSlot;
		this.teamId = playerSlot.teamId;
		this.race = playerSlot.raceFlag;

		this.world = world;

		switch (this.race) {
			case 'O':
				this.units = [
					new Unit(null, null, 'opeo', true),
					new Unit(null, null, 'opeo', true),
					new Unit(null, null, 'opeo', true),
					new Unit(null, null, 'opeo', true),
					new Unit(null, null, 'opeo', true),
					new Unit(null, null, 'ogre', true)
				];

				this.unregisteredUnitCount = 6;
			break;
			case 'H':
				this.units = [
					new Unit(null, null, 'hpea', true),
					new Unit(null, null, 'hpea', true),
					new Unit(null, null, 'hpea', true),
					new Unit(null, null, 'hpea', true),
					new Unit(null, null, 'hpea', true),
					new Unit(null, null, 'ogre', true)
				];

				this.unregisteredUnitCount = 6;
			break;
			case 'E':
				this.units = [
					new Unit(null, null, 'ewsp', true),
					new Unit(null, null, 'ewsp', true),
					new Unit(null, null, 'ewsp', true),
					new Unit(null, null, 'ewsp', true),
					new Unit(null, null, 'ewsp', true),
					new Unit(null, null, 'ogre', true)
				];

				this.unregisteredUnitCount = 6;
			break;
			case 'U':
				this.units = [
					new Unit(null, null, 'uaco', true),
					new Unit(null, null, 'uaco', true),
					new Unit(null, null, 'uaco', true),
					new Unit(null, null, 'unpl', true)
				];

				this.unregisteredUnitCount = 4;
			break;
			default:
				this.units = [];
			break;
		};

		this.startingPosition = null;
		this.updatingSubgroup = false;
		this.selection = null;
		this.groupSelections = {};

		this.heroSlotCount = 0;

		this.buildMenuOpen = false;
		this.tavernSelected = false;

		this.itemMoveSelected = false;
		this.itemMoveObject = null;

		this.possibleRegisterItem = null;
		this.possibleSelectList = [];

		this.knownObjectIds = {
			'worker': null,
			'townhall': null
		};

		this.debugRegister = [];

		this.debugCount = 0;
	}

	isPlayersRace (itemId) {
		let firstItemIdLetter = itemId[0].toUpperCase();

		return firstItemIdLetter === this.race;
	}

	findUnit (itemId1, itemId2) {
		return this.units.find(unit => {
			return utils.isEqualItemId(unit.itemId1, itemId1) && 
			       utils.isEqualItemId(unit.itemId2, unit.itemId2);
		});
	}

	findUnitByObjectId (objectId1, objectId2) {
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
		return this.units.find(unit => {
			return unit.itemId === itemId &&
			       (unit.itemId1 === null || unit.objectId1 === null);
		});
	}

	findUnregisteredUnitByItemIds (itemId1, itemId2) {
		return null;
	}

	findSwapUnitByItemId (itemId) {
		return null;
	}

	getSelectionUnits () {
		const self = this;
		if (!this.selection) {
			return [];
		}

		return this.selection.units.reduce((acc, unitItem) => {
			const { itemId1, itemId2 } = unitItem;
			const unit = self.findUnit(itemId1, itemId2);

			if (unit) {
				acc.push(unit);
			}

			return acc;
		}, []);
	}

	toggleUpdateSubgroup (action) {
		// auto-gen war3 message was triggered
		this.updatingSubgroup = true;
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

	registerKnownItem (unit, item) {

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
			console.log(this.id, "Gave first hero a TP item.");
			heroUnit.giveItem('stwp');
		}

		return heroUnit;
	}

	//
	// Called during `selectSubgroup` when unregistered units
	// are known to exist.  The `itemId` is only known for
	// one unit - the first in the selection group.  So
	// we limit the amount of registerable units to 1
	//

	assignPossibleSelectGroup (itemId) {
		let self = this;
		const selectionUnits = this.selection.units;

		return selectionUnits.reduce((registeredUnitsAcc, selectionUnit) => {
			self.possibleSelectList.some(selectItem => {
				const { itemId1, itemId2 } = selectItem;

				const foundSelectionUnit = (
					utils.isEqualItemId(selectionUnit.itemId1, itemId1) &&
					utils.isEqualItemId(selectionUnit.itemId2, itemId2)
				);

				if (foundSelectionUnit) {
					let foundPlayerUnit = self.units.find(playerUnit => {
						return playerUnit.itemId === itemId && // same unit as selection
						       playerUnit.itemId1 === null;
					});

					if (foundPlayerUnit) {
						foundPlayerUnit.registerItemIds(itemId1, itemId2);
						self.unregisteredUnitCount--;

						registeredUnitsAcc.push(foundPlayerUnit);
						self.debugRegister.push(foundPlayerUnit.displayName);

						return;
					}
				}

				return;
			});

			return registeredUnitsAcc;
		}, []);
	}

	checkItemAssignments (hero, checkSlot, objectId1, objectId2) {
		const heroItemId = hero.itemId;
		const currentItem = hero.items[checkSlot];

		console.log("Checking item assignments: ", hero.displayName, checkSlot);

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
					console.log("Checking other item: ", item);

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
			console.log(this.id, "Found an item to swap: ", hero.displayName, slot, item.displayName);
		}

	}

	selectSubgroup (action) {
		const { itemId, objectId1, objectId2 } = action;
		const firstGroupItem = this.selection.units[0];

		if (!firstGroupItem) {
			console.error("Empty selection during selectSubgroup.");
			this.selection.printGroup();
		}

		const {itemId1, itemId2} = firstGroupItem;
		const fixedItemId = utils.fixItemId(itemId);

		if (Building.isTavern(fixedItemId)) {
			this.tavernSelected = true;
			return;
		} else if (this.tavernSelected) {
			this.tavernSelected = false;
		}

		if (!this.isPlayersRace(fixedItemId) && !this.findUnitByItemId(fixedItemId)) {
			console.log("Early exit. wrong race.");
			return;
		}

		let newlyRegisteredUnits = this.assignPossibleSelectGroup(fixedItemId);
		let firstGroupUnit = this.findUnit(itemId1, itemId2);

		// could not find registered unit by itemId1-2
		// we didn't register any new units from possible select group
		if (!firstGroupUnit && !newlyRegisteredUnits.length) {
			PlayerActions.selectSubGroupWithNoKnowns(
				this,
				fixedItemId,
				itemId1, 
				itemId2,
				objectId1,
				objectId2
			);
		} else {
			console.log("selectSubgroup 4");

			if (firstGroupUnit) {
				PlayerActions.registerSubGroupFocusUnit(
					this,
					firstGroupUnit,
					fixedItemId,
					itemId1, 
					itemId2,
					objectId1,
					objectId2
				);
			} else {
				console.log("didn't find a first group unit");
				throw new Error("stop");
			}
		}
	}

	changeSelection (action) {
		const self = this;
		const subActions = action.actions;
    const selectMode = action.selectMode;
    const numberUnits = action.numberUnits;

    let hasUnregisteredUnitFlag = false;
    let subGroup = new SubGroup(numberUnits, subActions);

    if (selectMode === SelectModes.deselect) {
    	// de-selected unit
    	this.selection.deselect(subGroup);

    	return;
    }

  	// register first-time selected units
  	subActions.forEach(subAction => {
  		const {itemId1, itemId2} = subAction;
  		let unit = self.findUnit(itemId1, itemId2);
  		
  		if (unit) {
  			unit.setAliveFlags();
  			return;
  		}
		  
		  // we can't know for sure
			// that this unit needs to be made or registered yet
			self.possibleSelectList.push({
				itemId1: itemId1,
				itemId2: itemId2
			});

			hasUnregisteredUnitFlag = true;
  	});

  	if (this.selection === null) {
  		// no sub-group yet.  assign our newly selected one
  		this.selection = subGroup;	
  	} else {
  		// merge our selected sub groups
  		this.selection.mergeGroups(subGroup);
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

		if (selectedUnits.length) {
			let firstUnit = selectedUnits[0];

			if (firstUnit.meta.hero) {
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
		}
		
		switch (abilityFlags) {
			// learn skill
			case abilityFlagNames.Summon:
				if (this.tavernSelected) {
					let newTavernHero = new Unit(null, null, itemId, false);
					this.setHeroSlot(newTavernHero);

					console.log(this.id, "Creating tavern hero: ", unitInfo.displayName);
					this.units.push(newTavernHero);
					this.unregisteredUnitCount++;
				}
			break;
		}
		

		if (this.possibleRegisterItem) {
			// todo: is this needed?

			console.log("%%% unit called an ability that might be unreg.", itemId);

			// note: we also have the possible reg item itemId
			//       to use to verify the possible reg item is valid

			// let targetItemId = null;
			// let targetUnitInfo = mappings.getUnitInfo(itemId);

			// if (targetUnitInfo.isUnit) {
			// 	// ability is making a unit
			// 	const meta = targetUnitInfo.meta;
			// 	if (meta.hero) {
			// 		// alter of storms
			// 		targetItemId = "oalt";
			// 	}
			// }

			// if (targetItemId) {
			// 	// found a target to try and assign
			// 	let possibleUnit = this.UnregisteredUnitByItemId(targetItemId);

			// 	if (possibleUnit) {
			// 		const { itemId, objectId1, objectId2 } = this.possibleRegisterItem;

			// 		if (utils.fixItemId(itemId) === possibleUnit.itemId) {
			// 			// note: maybe use this?
			// 		}

			// 		// TOOD: maybe swap object ids around here?

			// 		possibleUnit.registerObjectIds(objectId1, objectId2);
			// 		this.unregisteredUnitCount--;
			// 	}
			// }
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
		let firstUnit = units[0];

		if (!firstUnit) {
			console.error("Trying to use ability without selected unit.");
			this.selection.printGroup();
			
			return;
		}

		const abilityActionName = utils.findItemIdForObject(action.itemId, abilityActions);
		switch (abilityActionName) {
			case 'CastSkillTarget':
				console.log("Casting target skill at point.");
				console.log("Unit casting: ", firstUnit.displayName);

				if (firstUnit.meta.hero) {
					console.log("Hero CastSkillTarget spell.");
					let skill = firstUnit.getSkillForType("pointTarget");

					if (!skill) {
						console.log("Couldnt find pointTarget skill for unit: ", firstUnit);
						return;
					}

					console.log("Casting point target skill: ", skill);
				}
			break;
			case 'CastSkillObject':
				console.log("casting skill on object target.");
				console.log("Unit casting: ", firstUnit.displayName);

				if (firstUnit.meta.hero) {
					console.log("Hero CastSkillObject spell.");
					let skill = firstUnit.getSkillForType("objectTarget");

					if (!skill) {
						console.log("Couldnt find objectTarget skill for unit: ", firstUnit);
						return;
					}
					
					console.log("Casting object target skill: ", skill);
				}
			break;
			case 'RightClick':
				if (firstUnit && firstUnit.isBuilding) {

					Building.doAbilityRightClickWithTargetAndObjectId(
						this,
						firstUnit,
						objectId1,
						objectId2,
						targetX,
						targetY
					);
					
				} else if (firstUnit && firstUnit.meta.hero) {

					Hero.doAbilityRightClickWithTargetAndObjectId(
						this,
						firstUnit,
						objectId1,
						objectId2,
						targetX,
						targetY
					);

				} else if (firstUnit && firstUnit.isUnit) {
					// moving non-hero units
					units.forEach(unit => {
						unit.moveTo(targetX, targetY);
					});
				} else {
					console.log(this.id, "At bottom of right click.");
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
				console.log(this.id, "Hero moving item: ", firstUnit.displayName);

				const knownItem = heroItems.find(heroItem => {
					const item = heroItem.item;

					return (item.objectId1 === objectId1 &&
								  item.objectId2 === objectId2) ||
								 (item.knownItemX === targetX &&
								  item.knownItemY === targetY);
				});

				if (itemCount === 1) {
					const slotItem = heroItems[0];

					slotItem.item.registerObjectIds(objectId1, objectId2);
					slotItem.item.registerKnownItem(targetX, targetY);
					this.world.clearKnownItem(objectId1, objectId2);

					firstUnit.items[slotItem.slot] = null;
					firstUnit.items[itemSlot] = slotItem.item;

					console.log(this.id, `${firstUnit.displayName} moved only item ${slotItem.item.displayName} to slot ${itemSlot}`);
				} else {
					let destinationItem = firstUnit.items[itemSlot];

					if (destinationItem) {
						// we have an item to swap places with
						// try to figure out what that item is

						console.log(this.id, `${firstUnit.displayName} moving item ${destinationItem.displayName} in slot ${itemSlot}`);

						let swapCandidates = heroItems.filter(heroItem => {
							return heroItem.slot !== itemSlot;
						});

						if (swapCandidates.length === 1) {
							const swapSlot = swapCandidates[0];
							const swapItem = swapSlot.item;

							console.log(this.id, "Swapping with only other item: ", swapItem.displayName);

							swapItem.registerObjectIds(objectId1, objectId2);
							swapItem.registerKnownItem(targetX, targetY);
							this.world.clearKnownItem(objectId1, objectId2);

							firstUnit.items[swapSlot.slot] = destinationItem;
							firstUnit.items[itemSlot] = swapItem;

						}
					} else {
						console.log(this.id, "Hero has nothing to swap item with, just put it in place. Slot moved: ", itemSlot);

						if (knownItem) {
							console.log(this.id, "Found known swap item: ", knownItem.item.displayName);

							console.log("known slot: ", knownItem.slot, "Moving slot: ", itemSlot);

							firstUnit.items[knownItem.slot] = null;
							firstUnit.items[itemSlot] = knownItem.item;
							this.world.clearKnownItem(objectId1, objectId2);

							console.log(this.id, `Put item ${knownItem.item.displayName} into slot ${itemSlot}`);							
						} else {
							console.log(this.id, "Not a known item.");

							let unregisteredSwapItem = heroItems.find(heroItem => {
								const item = heroItem.item;

								return heroItem.slot !== itemSlot &&
											 item.knownItemX === targetX &&
											 item.knownItemY === targetY;
							});

							console.log(this.id, "Looking for item registered with action objectId");

							if (unregisteredSwapItem) {
								console.log(this.id, "Found potential unregistered item to assign swap to: ", unregisteredSwapItem.item.displayName);	

								unregisteredSwapItem.item.registerObjectIds(objectId1, objectId2);
								unregisteredSwapItem.item.registerKnownItem(targetX, targetY);
								this.world.clearKnownItem(objectId1, objectId2);

								firstUnit.items[unregisteredSwapItem.slot] = null;
								firstUnit.items[itemSlot] = unregisteredSwapItem.item;

								console.log(this.id, `Put item ${unregisteredSwapItem.item.displayName} into slot ${itemSlot}`);							
							} else {
								console.error(this.id, "Unable to find unregistered item?");
								

								let unregisteredItems = heroItems.filter(heroItem => {
									return heroItem.item.objectId1 === null ||
									       heroItem.item.knownItemX === null;
								});

								if (unregisteredItems.length === 1) {
									const swapSlot = unregisteredItems[0];
									const swapItem = swapSlot.item;

									swapItem.registerObjectIds(objectId1, objectId2);
									swapItem.registerKnownItem(targetX, targetY);
									this.world.clearKnownItem(objectId1, objectId2);

									firstUnit.items[swapSlot.slot] = null;
									firstUnit.items[itemSlot] = swapItem;

									console.log(this.id, `Put item ${swapItem.displayName} into slot ${itemSlot}`);							
								} else {
									console.error("%% more than one unregistered item?");
								}

							}
						}

					}

				}

			break;
		}
	}

	useAbilityWithTarget (action) {
		const { targetX, targetY, itemId } = action;
		const isItemArray = Array.isArray(action.itemId);
		const fixedItemId = utils.fixItemId(itemId);

		const selectionUnits = this.getSelectionUnits();
		let firstUnit = selectionUnits[0];

		if (isItemArray) {
			console.log("Use ability with target item array.");
			return;
		} else {
			if (!firstUnit && this.selection.hasUnregisteredUnit) {
				console.log("Unregistered unit used ability. Maybe worker?");
				console.log("Selection: ", this.selection);

				let maybeUnits = this.units.find(unit => {
					return unit.itemId === fixedItemId;
				});

				console.log("Maybe units: ", fixedItemId,  maybeUnits);

				throw new Error("stop here.");
			}

			if (this.buildMenuOpen && firstUnit.meta.worker) {
				
				const startingPosition = {
					x: targetX,
					y: targetY
				};

				let building = new Unit(null, null, fixedItemId, false);
				building.registerUnit(fixedItemId, null, null);
				building.currentX = targetX;
				building.currentY = targetY;

				this.unregisteredUnitCount++;
				this.units.push(building);
			}
		}
	}

	chooseBuilding (action) {
		this.buildMenuOpen = true;
	}

	assignGroupHotkey (action) {
		const { 
			groupNumber, 
			numberUnits,
			actions
		} = action;

		this.groupSelections[groupNumber] = new SubGroup(numberUnits, actions);
	}

	selectGroupHotkey (action) {
		const { groupNumber } = action;

		if (this.groupSelections[groupNumber]) {
			// todo: add group deselectAll
			const { 
				numberUnits, 
				units,
				hasUnregisteredUnit
			} = this.groupSelections[groupNumber];

			let groupCopy = new SubGroup(numberUnits, units, hasUnregisteredUnit);
			this.selection = groupCopy;

			if (this.selection.numberUnits === 0) {
				console.error("%% Error group: ", this.selection);
				throw new Error("Selectected a group hotkey with zero units.");
			}
		} else {
			console.error("selected group that didnt exist?");
		}
		
	}

	giveOrDropItem (action ) {
		// console.log("=========================== %%%%%% giveOrDropItem: ", action);
		
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
		let firstUnit = selection[0];

		if (firstUnit) {
			console.log(this.id, "Unit giveOrDropItem");

			const heroItems = firstUnit.getItemList();
			const knownItem = heroItems.find(heroItem => {
				const item = heroItem.item;
				return item.objectId1 === itemObjectId1 &&
							 item.objectId2 === itemObjectId2;
			});

			if (objectId1 === -1 && objectId2 === -1) {
				console.log("Gave item to ground!");

				if (knownItem) { 
					console.log("put known item on ground.");
					this.world.droppedItems.push(knownItem.item);
					firstUnit.items[knownItem.slot] = null;
					firstUnit.droppedItems.push(knownItem);
				} else {
					console.log("Need to find potential item to put down.");
					let potentialItem = heroItems.find(heroItem => {
						const item = heroItem.item;
						return item.objectId1 === null;
					});

					if (potentialItem) {
						console.log("Dropping potential item: ", potentialItem.item.displayName);

						// todo: track maybeSwapItem here
						potentialItem.item.registerObjectIds(itemObjectId1, itemObjectId2);
						firstUnit.items[potentialItem.slot] = null;
						this.world.droppedItems.push(potentialItem.item);

						firstUnit.droppedItems.push(potentialItem);

						console.log(this.id, "Dropped items: ", this.world.droppedItems.length);
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

						console.log(this.id, `Hero ${firstUnit.displayName} gave known item to ${targetHero.displayName}`);	
						
					} else {
						// unkown item being traded
						const unknownWorldUnit = this.world.findUnknownObject(objectId1, objectId2);
						const potentialItem = heroItems.find(heroItem => {
							return heroItem.item.objectId1 === null;
						});

						if (potentialItem) {
							potentialItem.item.registerObjectIds(itemObjectId1, itemObjectId2);

							firstUnit.droppedItems.push(potentialItem);
							firstUnit.items[potentialItem.slot] = null;
							targetHero.tradeItem(potentialItem.item);

							console.log(this.id, `Hero ${firstUnit.displayName} gave unknown item ${potentialItem.item.displayName} to ${targetHero.displayName}`);	
						} else {
							console.log("Trading hero: ", firstUnit.displayName, "Target: ", targetHero.displayName);
							
							let unknownObject = this.world.findUnknownObject(itemObjectId1, itemObjectId2);
							if (unknownObject) {
								console.log(this.id, "Found a world item to register.");
								unknownObject.meta.isItem = true;
								targetHero.tradeItem(unknownObject);

								this.world.clearKnownItem(itemObjectId1, itemObjectId2);
							} else {

								let newUnknownItem = new Unit(null, null, null, false);
								newUnknownItem.registerObjectIds(itemObjectId1, itemObjectId2);
								newUnknownItem.meta.isItem = true;

								console.log(this.id, "Gave hero item but had to make new unknown item.");
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
};

module.exports = Player;