const W3GReplay = require('./node_modules/w3gjs');
const { ActionBlockList } = require('./node_modules/w3gjs/parsers/actions');
const Parser = new W3GReplay();

const utils = require("./helpers/utils"),
      logManager = require("./helpers/logManager"),
      UnitManager = require("./lib/UnitManager");

let unitManager;
let actionCount = 0;
let hasParsedMeta = false;

let globalTime = 0;

W3GReplay.prototype.processTimeSlot = function (timeSlotBlock) {
  if (!hasParsedMeta) {
    unitManager.setMetaData(this.gameMetaDataDecoded.meta);
    hasParsedMeta = true;
  }

  if (this.leaveEvents.length) {
    console.log("###");
    console.log("Found leave event:", this.leaveEvents);
    console.log("###");
  }

  globalTime += timeSlotBlock.timeIncrement;
  unitManager.processTick(globalTime);

  timeSlotBlock.actions.forEach(actionBlock => {
  	// try {
      unitManager.checkCreatePlayer(actionBlock);

	  	ActionBlockList.parse(actionBlock.actions).forEach(action => {
        actionCount++;

        // console.log("================================");
        // console.log(`Action ${actionCount} Player ${actionBlock.playerId}`);
        // console.log("================================");

        unitManager.handleAction(actionBlock, action);
	  	});
  	// } catch (ex) {
   //  	console.error(ex);
  	// }

    this.processCommandDataBlock(actionBlock);
  });
};

const parseReplays = (paths) => {
  paths.forEach(file => {
    unitManager = new UnitManager();
    hasParsedMeta = false;
    
    logManager.setLogger(file);

    const logger = logManager.getLogger();

    console.logger.info('test jeff ez');
    return;

    const replay = Parser.parse(file);
    let players = unitManager.players;

    utils.writeOutput(file, replay, players);

    Object.keys(players).forEach(playerId => {
      console.log("************************************");
      console.log(`Inspecting player: ${playerId}`);

      const player = players[playerId];
      const { units, unregisteredUnitCount, removedBuildings } = player;

      console.log(`Unit count: ${units.length}`);
      console.log(`Unregistered units: ${unregisteredUnitCount}`);

      if (removedBuildings.length) {
        console.log("Showing removed buildings:");
        removedBuildings.forEach(building => {
          console.log("(removed)", building.displayName);
        });
        console.log("------------------------------------");
      }
      console.log("************************************");
    });
  });
};

const main = () => {
  const options = utils.readCliArgs(process.argv);
  
  parseReplays(options.paths);
};

// main entry point
main();
//process.exit();
