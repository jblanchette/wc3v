const config = require("../config/config");
const Player = require("./Player"),
      World = require("./World");

const ActionBlock = require("./ActionBlock");
const ActionBlockNames = ActionBlock.ActionBlockNames;

// Turn on verbose debugging - or player specific verbose debugging
const debugActions = config.debugActions;
const debugPlayer = config.debugPlayer;

const UnitManager = class {
	constructor () {
		this.meta = null;
		this.players = {};
		this.world = new World();
	}

	setMetaData (meta) {
		this.meta = meta;
	}

	makePlayer (id) {
		let playerSlot = this.meta.playerSlotRecords.find(slot => {	
			return slot.playerId === id;
		});

		let player = new Player(id, playerSlot, this.world);
		this.players[id] = player;
	}

	checkCreatePlayer (actionBlock) {
		const playerId = actionBlock.playerId;

		if (!this.players[playerId]) {
			this.makePlayer(playerId);
		}
	}

	handleAction (gameTime, actionBlock, action) {
		const self = this;
		const actionName = ActionBlockNames[action.actionId];
		const player = this.players[actionBlock.playerId];

		if (!actionName) {
			console.log(action);
			throw new Error("unknown action name");
		}

		if (debugActions && (debugPlayer === null || player.id === debugPlayer)) {
			console.log("====================================");
			console.log(`ActionName: ${actionName} PID: ${player.id}`);
			console.log(`Action:`, action);
			console.log(`Game Timer: ${gameTime}`);
			console.log("====================================");
		}

		player.setGameTime(gameTime);

		// todo: roll this up. switch became unnessicary
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
     	case "AssingGroupHotkey":
     		player.assignGroupHotkey(action);
     	break;
     	case "SelectGroupHotkey":
     		player.selectGroupHotkey(action);
     	break;
     	case "GiveOrDropItem":
     		player.giveOrDropItem(action);
     	break;
    }
	}
};

module.exports = UnitManager;