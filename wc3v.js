const path = 'replays/test-square.w3g'; // path to your .w3g replay file
const W3GReplay = require('./node_modules/w3gjs');
const { ActionBlockList } = require('./node_modules/w3gjs/parsers/actions');
const Parser = new W3GReplay();

const UnitManager = require("./UnitManager");
const unitManager = new UnitManager();

W3GReplay.prototype.processTimeSlot = function (timeSlotBlock) {
  timeSlotBlock.actions.forEach(actionBlock => {
  	try {
      unitManager.checkCreatePlayer(actionBlock);

	  	ActionBlockList.parse(actionBlock.actions).forEach(action => {
        unitManager.handleAction(actionBlock, action);
	  	});
  	} catch (ex) {
    	console.error(ex)
  	}

    this.processCommandDataBlock(actionBlock);
  });
};

const replay = Parser.parse(path);
console.log("done");