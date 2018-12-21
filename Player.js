const utils = require("./utils"),
      mappings = require("./mappings");

const { 
	abilityActions,
	abilityFlagNames,
	mapStartPositions,
	specialBuildings
} = mappings;

const Unit = require("./Unit"),
      SubGroup = require("./SubGroup");

const SelectModes = {
	select: 1,
	deselect: 2
};

const Player = class {
	constructor (id, playerSlot) {
		this.id = id;
		this.playerSlot = playerSlot;
		this.teamId = playerSlot.teamId;
		this.race = playerSlot.raceFlag;

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

		this.buildMenuOpen = false;
		this.tavernSelected = false;

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

	//
	// Called during `selectSubgroup` when unregistered units
	// are known to exist.  The `itemId` is only known for
	// one unit - the first in the selection group.  So
	// we limit the amount of registerable units to 1
	//

	assignPossibleSelectGroup (itemId) {
		let self = this;
		let registeredUnits = [];
		let hasFoundUnit = false;

		this.selection.units.forEach(selectionUnit => {
			if (hasFoundUnit) {
				return;
			}

			const foundUnit = self.possibleSelectList.find(selectItem => {
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

						registeredUnits.push(foundPlayerUnit);
						self.debugRegister.push(foundPlayerUnit.displayName);

						return true;
					} else {
						return false;
					}
				} else {
					return false;
				}
			});

			if (foundUnit) {
				hasFoundUnit = true;
			}
		});

		return registeredUnits;
	}

	selectSubgroup (action) {
		const { itemId, objectId1, objectId2 } = action;
		const firstGroupItem = this.selection.units[0];

		if (!firstGroupItem) {
			console.error("Empty selection during selectSubgroup.");
			console.error("Num Units: ", this.selection.numberUnits);
			console.error("Units: ");

			if (!this.selection.units.length) {
				console.error("Empty unit list.");
			}

			this.selection.units.forEach(badUnit => {
				console.error(badUnit);
			});
		}

		const {itemId1, itemId2} = firstGroupItem;
		const fixedItemId = utils.fixItemId(itemId);

		if (fixedItemId === specialBuildings.tavern) {
			this.tavernSelected = true;
			return;
		} else if (this.tavernSelected) {
			this.tavernSelected = false;
		}

		if (!this.isPlayersRace(fixedItemId)) {
			// do not take action when selecting other teams units
			// TODO: eventually support skills like possesion maybe?

			// NOTE: this does not work for mirror matches.
			//       we need to do additional 'guessing' for that.

			const hasExistingUnit = this.units.find(unit => {
				return unit.itemId === fixedItemId;
			});

			// if you don't have this hero in your list
			// of units, then we move on
			if (!hasExistingUnit) {
				return;
			}
		}

		let newlyRegisteredUnits = this.assignPossibleSelectGroup(fixedItemId);
		let firstGroupUnit = this.findUnit(itemId1, itemId2);

		// could not find registered unit by itemId1-2
		// we didn't register any new units from possible select group
		if (!firstGroupUnit && !newlyRegisteredUnits.length) {
			// look for a unit by the itemId to maybe register
			let unregisteredUnit = this.findUnregisteredUnitByItemId(fixedItemId);
			
			if (unregisteredUnit) {
				// re-assign the objectIds1-2 / itemIds1-2
				// because we're now certain for at least this unit

				let existingUnits = this.units.filter(unit => {
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
							this.id, 
							'Registered unit 1', 
							unregisteredUnit.displayName,
							unregisteredUnit.knownLevel
						);
						console.log(action);
						console.log("*************************");
					}

					unregisteredUnit.spawning = false;
					unregisteredUnit.selected = true;

					this.unregisteredUnitCount--;
				}
				
				this.assignKnownUnits();
				this.updatingSubgroup = false;
			} else {

				let existingUnits = this.units.filter(unit => {
					return unit.itemId === fixedItemId;
				});

				// only one of these units is known to exist
				// so we know to update it
				if (existingUnits.length === 1) {
					let existingUnit = existingUnits[0];
					existingUnit.registerObjectIds(objectId1, objectId2);
				} else {
					// possibly spawned unit was selected?
					let possibleUnit = mappings.getUnitInfo(fixedItemId);
					if (possibleUnit.isUnit) {
						console.log(1, "Selected a spawned unit", possibleUnit.displayName);

						let newUnit = new Unit(null, null, fixedItemId, false);
						this.units.push(newUnit);

						this.unregisteredUnitCount++;
					} else {
						console.log("^^^^ Unknown action performed: ", fixedItemId);
						console.log("Possible unit: ", possibleUnit);
					}
				}
			}
		} else {

			// if (firstGroupUnit) {
			// 	// we're certain about this unit being our selection
			// 	console.log("First unit before: ", firstGroupUnit.objectId1, firstGroupUnit.objectId2)
			// 	console.log("Changing to: ", objectId1, objectId2);

			// 	firstGroupUnit.registerUnit(fixedItemId, objectId1, objectId2);

			// 	if (firstGroupUnit.meta.hero && firstGroupUnit.knownLevel === 0) {
			// 		console.log(
			// 			this.id, 
			// 			'Registered unit 2', 
			// 			firstGroupUnit.displayName,
			// 			firstGroupUnit.knownLevel
			// 		);	

			// 		console.log(action);
			// 		console.log("*************************");
					
			// 	}

			// 	this.unregisteredUnitCount--;

			// 	this.assignKnownUnits();

			// 	firstGroupUnit.spawning = false;
			// 	firstGroupUnit.selected = true;

			// 	this.updatingSubgroup = false;
			// }
		}
	}

	changeSelection (action) {
		const self = this;
		const subActions = action.actions;
    const selectMode = action.selectMode;
    const numberUnits = action.numberUnits;

    let hasUnregisteredUnitFlag = false;
    let subGroup = new SubGroup(numberUnits, subActions);

    if (selectMode === SelectModes.select) {
    	// register first-time selected units
    	subActions.forEach(subAction => {
    		const {itemId1, itemId2} = subAction;
    		let unit = self.findUnit(itemId1, itemId2);
    		
    		if (!unit) {
  			  // we can't know for sure
  				// that this unit needs to be made or registered yet
  				self.possibleSelectList.push({
  					itemId1: itemId1,
  					itemId2: itemId2
  				});

    			hasUnregisteredUnitFlag = true;
    		} else {
    			unit.setAliveFlags();
    		}
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
    } else {
    	// de-selected unit
    	this.selection.deselect(subGroup);
    }
	}

	useAbilityNoTarget (action) {
		const isItemArray = Array.isArray(action.itemId);
		const itemId = isItemArray ?
			action.itemId : utils.fixItemId(action.itemId);
		const abilityFlags = action.abilityFlags;
		
		let selectedUnits = this.getSelectionUnits();

		if (selectedUnits.length) {
			let firstUnit = selectedUnits[0];

			if (isItemArray) {
				if (firstUnit.meta.hero) {
					const abilityActionName = utils.findItemIdForObject(itemId, abilityActions);

					switch (abilityActionName) {
						case 'CastSummonSkill':
							console.log("Unit called summon skill: ", firstUnit.displayName);

							let skill = firstUnit.getSkillForType("summon");
							console.log("Skill: ", skill);

							if (!skill) {
								console.error("Cound not find skill.", firstUnit);
								return;
							}

							const {summonCount, summonItemId } = skill;
							for (let i = 0; i < summonCount; i++) {
								console.log("Making unit: ", i, summonItemId);

								let summonUnit = new Unit(null, null, summonItemId, false);
								
								this.units.push(summonUnit);
								this.unregisteredUnitCount++;
							}
						break;

						default:
							// console.log("Unknown ability with no target.");
							// console.log("Item ID: ", itemId);
							// console.log("Action: ", action);
							// console.log("***************************");
						break;
					};
				} else if (firstUnit.isBuilding) {
					console.log("Building ability no target.");

					switch (abilityFlags) {
						case abilityFlagNames.CancelTrainOrResearch:
							// TODO: support a backlog queue of trained units
							//       we probably just need to remove the 'last added'
							//       from list for most cases

							const removeIndex = firstUnit.trainedUnits.findIndex(unit => {
								return !unit.completed;
							});
							const removeItem = firstUnit.trainedUnits[removeIndex];

							if (!removeItem) {
								console.error("Nothing to remove from training list?");
								return;
							}

							const unitRemoveIndex = this.units.findIndex(unit => {
								return unit.itemId === removeItem.itemId &&
								       unit.itemId1 === null &&
								       unit.objectId1 === null;
							});

							if (unitRemoveIndex === -1) {
								

								return;
							}

							const removeUnit = this.units[unitRemoveIndex];
							console.log("Removing non-finished unit: ", removeUnit.displayName);

							this.units.splice(unitRemoveIndex, 1);
							this.unregisteredUnitCount--;
						break;

						default:
							console.log("Building used unknown ability.");
						break;
					}
				}

				return;
			}

			// not an itemId array
			// we have a string itemId now
			let unitInfo = mappings.getUnitInfo(itemId);

			switch (abilityFlags) {
				// learn skill
				case abilityFlagNames.LearnSkillOrTrain:
					if (firstUnit.meta.hero) {
						let spell = mappings.heroAbilities[itemId];
						if (!firstUnit.learnedSkills[itemId]) {
							// learning first level
							spell.level = 1;

							firstUnit.learnedSkills[itemId] = spell;
							console.log("%% Learned spell: ", spell);
						} else {
							firstUnit.learnedSkills[itemId].level++;
							console.log("Leveled up skill: ", firstUnit.learnedSkills[itemId]);
						}

						firstUnit.knownLevel++;

						console.log(this.id, "Hero leveled up: ", firstUnit.displayName, firstUnit.knownLevel);
					} else if (firstUnit.isBuilding) {
						console.log("Building is training a unit.", unitInfo.displayName);

						// building spawned a unit into world
						let newUnit = new Unit(null, null, itemId, false);
						firstUnit.trainedUnits.push({
							itemId: itemId,
							completed: false
						});

						console.log("Adding trained unit to building: ", firstUnit.displayName);
						console.log("Making trained unit: ", newUnit.displayName);	

						this.units.push(newUnit);
						this.unregisteredUnitCount++;
					}
				break;

				case abilityFlagNames.TrainUnit:
					if (firstUnit.isBuilding) {
						console.log(1, "Train unit info: ", unitInfo);

						if (unitInfo && unitInfo.isUnit) {
							if (unitInfo.isBuilding) {
								// building upgraded itself

								console.log("Building upgraded itself: ", unitInfo.displayName);
								firstUnit.upgradeBuilding(itemId);
							} else if (unitInfo.isUnit) {
								// building spawned a unit into world
								let newUnit = new Unit(null, null, itemId, false);

								// NOTE: for some unknown reason, TrainUnit actions
								//       can show up in a replay even when there
								//       was one previously issued - with no actions in between.
								//       
								//       heroes are unique units, so we just prevent
								//       the command issued from doing anything,
								//       and wait for an actual CancelTrainOrResearch action

								if (unitInfo.meta.hero) {
									console.log(1, "Making a hero.");

									const inTraining = firstUnit.trainedUnits.filter(unit => {
										return !unit.completed && unit.itemId === itemId;
									});

									if (inTraining.length) {
										console.log(1, "Stopping double hero train.");
										return;	
									}
									
								}

								firstUnit.trainedUnits.push({
									itemId: itemId,
									completed: false
								});

								console.log("Adding trained unit to building: ", firstUnit.displayName);
								console.log("Making trained unit: ", newUnit.displayName);		
								this.units.push(newUnit);
								this.unregisteredUnitCount++;
							}
						}
					}
				break;
				case abilityFlagNames.CancelTrainOrResearch:
					firstUnit.upgradeBuilding(itemId);

					console.log("Building researched upgrade: ", unitInfo.displayName);
				break;
				default:
					console.log("No match for ability flag");
					console.log("Unit info for itemId: ", unitInfo);
				break;
			};
			
		} else {
			let unitInfo = mappings.getUnitInfo(itemId);
			switch (abilityFlags) {
				// learn skill
				case abilityFlagNames.Summon:
					if (this.tavernSelected) {
						let newTavernHero = new Unit(null, null, itemId, false);

						console.log(this.id, "Creating tavern hero: ", unitInfo.displayName);
						this.units.push(newTavernHero);
						this.unregisteredUnitCount++;
					}
				break;

				default:
					console.error("Empty selection, no match on ability.");
				break;
			}
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
		let units = this.getSelectionUnits();
		let firstUnit = units[0];

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
				let { 
					targetX, 
					targetY,
					objectId1,
					objectId2
				} = action;

				if (objectId1 === -1 && objectId2 === -1) {
					// clicked on ground
				} else {
					// clicked object directly

					let clickedUnit = this.units.find(unit => {
						return unit.objectId1 === objectId1 &&
									 unit.objectId2 === objectId2;
					});

					if (!clickedUnit) {
						let unitGuess = this.guessUnitType(objectId1);
						
						if (!unitGuess) {
							// todo: do something here, like maybe try to track
							//       trees / goldmines
						}
					}
				}
				
				units.forEach(unit => {
					unit.moveTo(targetX, targetY);
				});
			break;
		}
	}

	useAbilityWithTarget (action) {
		const selectionUnits = this.getSelectionUnits();
		let firstUnit = selectionUnits[0];

		if (!firstUnit && this.selection.hasUnregisteredUnit) {
			console.log("Unregistered unit used ability. Maybe worker?");
			

			console.log("Selection: ", this.selection);
			console.log("Selection units: ", selectionUnits);

			throw new Error("stop here.");
		}

		if (this.buildMenuOpen && firstUnit.meta.worker) {
			const { targetX, targetY, itemId } = action;
			const startingPosition = {
				x: targetX,
				y: targetY
			};

			let building = new Unit(null, null, startingPosition);
			building.registerUnit(utils.fixItemId(itemId), null, null);

			this.unregisteredUnitCount++;
			this.units.push(building);
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
	}
};

module.exports = Player;