const ActionBlock = require("./ActionBlock");
const ActionBlockNames = ActionBlock.ActionBlockNames;

const UnitManager = class {
	constructor () {
		this.players = {};
	}

	makePlayer (id) {
		const player = {
			id: id,
			units: {}
		};

		this.players[id] = player;
	}

	checkCreatePlayer (actionBlock) {
		const playerId = actionBlock.playerId;

		if (!this.players[playerId]) {
			this.makePlayer(playerId);
		}
	}

	handleAction (actionBlock, action) {
		const actionName = ActionBlockNames[action.actionId];
		const player = this.players[actionBlock.playerId];

		console.log("Running: ", actionName);
		console.log("Action: ", action);

    switch (actionName) {
      case "UseAbilityWithTarget":
        console.log("Player: ", player);
        console.log("action: ", action);
      break;
    }
	}
};

module.exports = UnitManager;