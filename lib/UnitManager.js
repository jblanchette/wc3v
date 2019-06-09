const config = require("../config/config");
const Player = require("./Player"),
      World = require("./World"),
      EventTimer = require("./EventTimer");

const ActionBlock = require("./ActionBlock");
const ActionBlockNames = ActionBlock.ActionBlockNames;

// Turn on verbose debugging - or player specific verbose debugging
const debugActions = config.debugActions;
const debugPlayer = config.debugPlayer;

const UnitManager = class {
	constructor () {
		this.meta = null;
		this.players = {};
		this.eventTimer = new EventTimer();
		this.world = new World(this.eventTimer);
	}

	setMetaData (meta) {

		meta.playerSlotRecords.forEach(slot => {
			// fix night elf race from the dumb N to E
			if (slot.raceFlag === 'N') {
				slot.raceFlag = 'E';
			}
		});

		this.meta = meta;
	}

	makePlayer (id) {
		let playerSlot = this.meta.playerSlotRecords.find(slot => {	
			return slot.playerId === id;
		});

		let player = new Player(id, playerSlot, this.eventTimer, this.world);
		this.players[id] = player;
	}

	checkCreatePlayer (actionBlock) {
		const playerId = actionBlock.playerId;

		if (!this.players[playerId]) {
			this.makePlayer(playerId);
		}
	}

	processTick (gameTime) {
		this.eventTimer.process(gameTime);
	}

	handleAction (actionBlock, action) {
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
			console.log(`Game Timer: ${this.eventTimer.timer.gameTime}`);
			console.log("====================================");
		}

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