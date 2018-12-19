const utils = require("./utils"),
      mappings = require("./mappings");

const { abilityActions, mapStartPositions } = mappings;

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
					new Unit(null, null, 'ogre', true)
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

		this.buildMenuOpen = false;

		this.possibleRegisterItem = null;
		this.possibleSelectList = [];

		this.knownObjectIds = {
			'worker': null,
			'townhall': null
		};
	}

	makeUnit (itemId1, itemId2) {
		let unit = new Unit(itemId1, itemId2);

		this.units.push(unit);
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
			return unit.itemId === itemId;
		});
	}

	findUnregisteredUnitByItemIds (itemId1, itemId2) {
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
		console.log("Guessing a unit type from objectId: ", objectId);
		console.log("Known objects: ", this.knownObjectIds);
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

	assignPossibleSelectGroup (itemId) {
		let self = this;

		this.possibleSelectList = this.possibleSelectList.filter(selectItem => {
			const { itemId1, itemId2 } = selectItem;
			const isStarterUnit = utils.isEqualItemId(itemId1, itemId2);

			let foundPlayerUnit = self.units.find(playerUnit => {
				return playerUnit.itemId === itemId &&
							 playerUnit.itemId1 === null &&
				       playerUnit.isSpawnedAtStart === isStarterUnit;
			});

			if (foundPlayerUnit) {
				foundPlayerUnit.registerItemIds(itemId1, itemId2);
				self.unregisteredUnitCount -= 1;

				return false;
			} else {
				// keep in list, didn't find a match yet
				return true;
			}
		})
	}

	selectSubgroup (action) {
		const { itemId, objectId1, objectId2 } = action;
		const firstGroupItem = this.selection.units[0];
		const {itemId1, itemId2} = firstGroupItem;

		const fixedItemId = utils.fixItemId(itemId);
		const playerHasUnregisteredUnits = (this.unregisteredUnitCount > 0);

		if (playerHasUnregisteredUnits) {
			this.assignPossibleSelectGroup(fixedItemId);
		}

		let firstGroupUnit = this.findUnit(itemId1, itemId2);
		
		if (!firstGroupUnit && playerHasUnregisteredUnits) {
			let unregisteredUnit = this.findUnregisteredUnitByItemId(fixedItemId);
			
			if (unregisteredUnit) {
				unregisteredUnit.registerUnit(fixedItemId, objectId1, objectId2);
				
				this.unregisteredUnitCount -= 1;
				this.assignKnownUnits();

				unregisteredUnit.spawning = false;
				unregisteredUnit.selected = true;

				this.updatingSubgroup = false;
			} else {

				// todo: is this needed?
				console.log("@@ stored register ", unregisteredUnit);
				this.possibleRegisterItem = action;	
			}
		} else {
			// we're certain about this unit being our selection
			firstGroupUnit.registerUnit(fixedItemId, objectId1, objectId2);

			this.assignKnownUnits();

			firstGroupUnit.spawning = false;
			firstGroupUnit.selected = true;

			this.updatingSubgroup = false;
		}
	}

	changeSelection (action) {
		const self = this;
		const subActions = action.actions;
    const selectMode = action.selectMode;
    const numberUnits = action.numberUnits;

    let subGroup = new SubGroup(numberUnits, subActions);

    if (selectMode === SelectModes.select) {
    	// register first-time selected units
    	subActions.forEach(subAction => {
    		const {itemId1, itemId2} = subAction;
    		let unit = self.findUnit(itemId1, itemId2);
    		
    		if (!unit) {
    			const playerHasUnregisteredUnits = (self.unregisteredUnitCount > 0);
    			if (playerHasUnregisteredUnits) {
    				// we can't know for sure
    				// that this unit needs to be made or registered yet

    				this.possibleSelectList.push({
    					itemId1: itemId1,
    					itemId2: itemId2
    				});

    				return;
    			}

    			// todo: is this needed?
    			console.log("!! called make unit: ", itemId1, itemId2);
    			self.makeUnit(itemId1, itemId2);
    		}
    	});

    	if (this.selection === null) {
    		// no sub-group yet.  assign our newly selected one
    		this.selection = subGroup;	
    	} else {
    		// merge our selected sub groups
    		this.selection.mergeGroups(subGroup);
    	}	
    } else {
    	// de-selected unit
    	this.selection.deselect(subGroup);
    }
	}

	useAbilityNoTarget (action) {
		const itemId = utils.fixItemId(action.itemId);
		let selectedUnits = this.getSelectionUnits();

		if (selectedUnits) {
			let firstUnit = selectedUnits[0];

			if (firstUnit.isBuilding) {
				let spellInfo = mappings.getUnitInfo(itemId);

				if (spellInfo && spellInfo.isUnit) {
					console.log("%% spawned unit:", spellInfo.displayName);
					let newUnit = new Unit(null, null, itemId, false);
					
					this.units.push(newUnit);
					this.unregisteredUnitCount += 1;
				}
			}
		}

		if (this.possibleRegisterItem) {
			// todo: is this needed?
			
			console.log("%%% unit called an ability that might be unreg.", itemId);

			// note: we also have the possible reg item itemId
			//       to use to verify the possible reg item is valid

			let targetItemId = null;
			let targetUnitInfo = mappings.getUnitInfo(itemId);

			console.log("Target info: ", targetUnitInfo);

			if (targetUnitInfo.isUnit) {
				// ability is making a unit
				const meta = targetUnitInfo.meta;
				if (meta.hero) {
					// alter of storms
					targetItemId = "oalt";
				}
			}

			if (targetItemId) {
				// found a target to try and assign
				let possibleUnit = this.UnregisteredUnitByItemId(targetItemId);

				if (possibleUnit) {
					const { itemId, objectId1, objectId2 } = this.possibleRegisterItem;

					if (utils.fixItemId(itemId) === possibleUnit.itemId) {
						// note: maybe use this?
					}

					// TOOD: maybe swap object ids around here?

					possibleUnit.registerObjectIds(objectId1, objectId2);
					this.unregisteredUnitCount -= 1;
				}
			}
		}
	} 

	useAbilityWithTargetAndObjectId (action) {
		let units = this.getSelectionUnits();

		const abilityActionName = Object.keys(abilityActions).find(abilityKey => {
			const abilityItemId = abilityActions[abilityKey];

			return utils.isEqualItemId(action.itemId, abilityItemId);
		});

		switch (abilityActionName) {
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
						console.log("** Clicked a non-existing unit", objectId1, objectId2);
						let unitGuess = this.guessUnitType(objectId1);
						
						if (!unitGuess) {
							console.log("%%% clicked something not near known object ids");
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
		console.log("% Player.useAbilityWithTarget");

		const selectionUnits = this.getSelectionUnits();
		let firstUnit = selectionUnits[0];

		if (this.buildMenuOpen && firstUnit.meta.worker) {
			const { targetX, targetY, itemId } = action;
			const startingPosition = {
				x: targetX,
				y: targetY
			};

			let building = new Unit(null, null, startingPosition);
			building.registerUnit(utils.fixItemId(itemId), null, null);

			this.unregisteredUnitCount += 1;
			this.units.push(building);
		}
	}

	chooseBuilding (action) {
		this.buildMenuOpen = true;
	}
};

module.exports = Player;