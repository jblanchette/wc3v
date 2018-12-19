const Player = require("./Player");

const ActionBlock = require("./ActionBlock");
const ActionBlockNames = ActionBlock.ActionBlockNames;

const debugActions = false;

const UnitManager = class {
	constructor () {
		this.meta = null;
		this.players = {};
	}

	setMetaData (meta) {
		this.meta = meta;
	}

	makePlayer (id) {
		let playerSlot = this.meta.playerSlotRecords.find(slot => {	
			return slot.playerId === id;
		});

		let player = new Player(id, playerSlot);
		this.players[id] = player;
	}

	checkCreatePlayer (actionBlock) {
		const playerId = actionBlock.playerId;

		if (!this.players[playerId]) {
			this.makePlayer(playerId);
		}
	}

	handleAction (actionBlock, action) {
		const self = this;
		const actionName = ActionBlockNames[action.actionId];
		const player = this.players[actionBlock.playerId];

		if (debugActions) {
			console.log("====================================");
			console.log(`ActionName: ${actionName}`);
			console.log(`Action:`, action);
			console.log("====================================");
		}

    switch (actionName) {
      case "ChangeSelection":
        player.changeSelection(action);
      break;

      case "UpdateSubgroup":
      	player.toggleUpdateSubgroup(action);
      break;

      case "SelectSubgroup":
      	player.selectSubgroup(action);
      break;

      case "UseAbilityNoTarget":
      	player.useAbilityNoTarget(action);
      break;	

      case "UseAbilityWithTarget":
      	player.useAbilityWithTarget(action);
      break;

      case "UseAbilityWithTargetAndObjectId":
      	player.useAbilityWithTargetAndObjectId(action);
     	break;

     	case "ChooseBuilding":
     		player.chooseBuilding(action);
     	break;
    }
	}
};

module.exports = UnitManager;