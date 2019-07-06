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
    unitManager.setMetaData(this.gameMetaDataDecoded.meta, this.meta);
    hasParsedMeta = true;
  }

  globalTime += timeSlotBlock.timeIncrement;
  unitManager.processTick(globalTime);

  timeSlotBlock.actions.forEach(actionBlock => {
    unitManager.checkCreatePlayer(actionBlock);

  	ActionBlockList.parse(actionBlock.actions).forEach(action => {
      actionCount++;

      unitManager.handleAction(actionBlock, action);
  	});

    this.processCommandDataBlock(actionBlock);
  });
};

const parseReplays = (paths) => {
  paths.forEach(file => {
    unitManager = new UnitManager();
    hasParsedMeta = false;
    
    logManager.setLogger(file, true);

    try {
      const replay = Parser.parse(file);
      let players = unitManager.players;

      // write our output wc3v file
      utils.writeOutput(file, replay, players);

      // re-enable all logging
      logManager.setDisabledState(false);

      Object.keys(players).forEach(playerId => {
        console.logger("************************************");
        console.logger(`Inspecting player: ${playerId}`);

        const player = players[playerId];
        const { units, unregisteredUnitCount, removedBuildings } = player;

        console.logger(`Unit count: ${units.length}`);
        console.logger(`Unregistered units: ${unregisteredUnitCount}`);

        if (removedBuildings.length) {
          console.logger("Showing removed buildings:");
          removedBuildings.forEach(building => {
            console.logger("(removed)", building.displayName);
          });
          console.logger("------------------------------------");
        }
        console.logger("************************************");
      });

    } catch (e) {
      console.log("error parsing replay: ", file);
      console.log("error: ", e);

      return;
    }
  });

  console.logger("wc3v completed.  enjoy!");
};

const main = () => {
  const options = utils.readCliArgs(process.argv);
  
  parseReplays(options.paths);
};

// main entry point
main();
//process.exit();
