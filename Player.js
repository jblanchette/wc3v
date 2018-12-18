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
		this.startingPosition = mapStartPositions['EchoIsles'][this.teamId];

		this.units = [];
		this.updatingSubgroup = false;
		this.selection = null;
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
			return unit.objectId === null;
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

		let firstGroupUnit = this.findUnit(itemId1, itemId2);
		
		if (!firstGroupUnit) {
			// assign this unit to an unregistered unit
			firstGroupUnit = this.findUnregisteredUnit();
		}

		if (!firstGroupUnit) {
			throw new Error("Unable to find unit for group selection.");
		}

		firstGroupUnit.registerUnit(itemId, objectId1, objectId2);

		firstGroupUnit.spawning = false;
		firstGroupUnit.selected = true;

		this.updatingSubgroup = false;
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

		// todo: implement
	} 

	useAbilityWithTargetAndObjectId (action) {
		// console.log("% player.useAbilityWithTargetAndObjectId");
		// console.log("Action: ", action);

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

		// { actionId: 17,
		//   abilityFlags: 4,
		//   itemId: 'tlao',
		//   unknownA: -1,
		//   unknownB: -1,
		//   targetX: -5664,
		//   targetY: 3104 }

		console.log("%%%%%%%");
		console.log("%%%%%%%");
		console.log("%%%%%%%");
		console.log("%%%%%%%");
		console.log("%%%%%%%");
		console.log("ActioN: ", action);
		console.log("%%%%%%%");
	}
};

module.exports = Player;