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

		this.startingPosition = mapStartPositions['EchoIsles'][this.teamId];

		this.units = [];
		this.updatingSubgroup = false;
		this.selection = null;

		this.buildMenuOpen = false;
		this.unregisteredBuildingCount = 0;

		this.possibleRegisterItem = null;
	}

	makeUnit (itemId1, itemId2) {
		let unit = new Unit(itemId1, itemId2, this.startingPosition);

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

	getSelectionUnits () {
		const self = this;
		if (!this.selection) {
			return [];
		}

		return this.selection.units.map(unitItem => {
			const { itemId1, itemId2 } = unitItem;
			
			return self.findUnit(itemId1, itemId2);
		});
	}

	toggleUpdateSubgroup (action) {
		// auto-gen war3 message was triggered
		this.updatingSubgroup = true;
	}

	selectSubgroup (action) {
		const { itemId, objectId1, objectId2 } = action;
		const firstGroupItem = this.selection.units[0];
		const {itemId1, itemId2} = firstGroupItem;

		console.log("Select subgroup finding unit:", itemId1, itemId2);
		let firstGroupUnit = this.findUnit(itemId1, itemId2);
		
		if (!firstGroupUnit) {
			// assign this unit to an unregistered unit
			console.log("@@ did not find unit, storing action for later.");
			console.log("@@ stored register ", action);

			this.possibleRegisterItem = action;
		} else {
			// we're certain about this unit being our selection
			firstGroupUnit.registerUnit(utils.fixItemId(itemId), objectId1, objectId2);

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
    			if (self.unregisteredBuildingCount > 0) {
    				// we can't know for sure
    				// that this unit needs to be made or registered yet

    				return;
    			}

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

    // console.log("ChangeSelection:");
    // subActions.forEach(subAction => {
    // 	console.log("Sub action: ", subAction);
    // });
	}

	useAbilityNoTarget (action) {
		// console.log("% player.useAbilityNoTarget");
		// console.log(action);
		const itemId = utils.fixItemId(action.itemId);

		if (this.possibleRegisterItem) {
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
				let possibleUnit = this.findUnregisteredUnitByItemId(targetItemId);

				if (possibleUnit) {
					const { itemId, objectId1, objectId2 } = this.possibleRegisterItem;

					if (utils.fixItemId(itemId) === possibleUnit.itemId) {
						// note: maybe use this?
					}

					possibleUnit.registerObjectIds(objectId1, objectId2);

					if (targetUnitInfo.isBuilding) {
						this.unregisteredBuildingCount -= 1;
					}
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
				let { targetX, targetY } = action;

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

			this.unregisteredBuildingCount += 1;
			this.units.push(building);
		}
	}

	chooseBuilding (action) {
		this.buildMenuOpen = true;
	}
};

module.exports = Player;