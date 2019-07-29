const config = require("../config/config");
const Player = require("./Player"),
      World = require("./World"),
      EventTimer = require("./EventTimer");

const logManager = require("../helpers/logManager");

const ActionBlock = require("./ActionBlock");
const ActionBlockNames = ActionBlock.ActionBlockNames;

const PlayerManager = class {
	constructor () {
		this.meta = null;

		this.players = {};
		this.eventTimer = new EventTimer();
		this.world = new World(this.eventTimer);

    this.lastActions = {};
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

		let player = new Player(id, playerSlot, this.meta, this.eventTimer, this.world);
		this.players[id] = player;
    this.world.addPlayerData(player);
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
			console.logger(action);
			throw new Error("unknown action name");
		}

    const logEnabledForPlayer = (config.debugPlayer === null || player.id === config.debugPlayer);

    // enable or disable all logging based on debugPlayer setting
    logManager.setDisabledState(!logEnabledForPlayer);

		if (config.debugActions) {
      const { gameTime } = this.eventTimer.timer;
      const timerDate = new Date(Math.round(gameTime * 1000) / 1000);

			console.logger("========================================================================");
			console.logger(`ActionName: ${actionName} PID: ${player.id}`);
			console.logger(`Action:`, action);
			console.logger(`Game Timer: ${gameTime}`);
      console.logger(`Game Clock: ${timerDate.getUTCMinutes()}:${timerDate.getUTCSeconds()}`);
			console.logger("========================================================================");
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
     	case "AssignGroupHotkey":
     		player.assignGroupHotkey(action);
     	break;
     	case "SelectGroupHotkey":
     		player.selectGroupHotkey(action);
     	break;
     	case "GiveOrDropItem":
     		player.giveOrDropItem(action);
     	break;
     	case "UseAbilityTwoTargets":
     		player.useAbilityTwoTargets(action);
     	break;
    }
	}
};

module.exports = PlayerManager;
