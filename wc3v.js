const W3GReplay = require('./node_modules/w3gjs');
const { ActionBlockList } = require('./node_modules/w3gjs/dist/lib/parsers/actions');
const Parser = new W3GReplay();

const utils = require("./helpers/utils"),
      logManager = require("./helpers/logManager"),
      PlayerManager = require("./lib/PlayerManager");

let playerManager;
let actionCount = 0;
let globalTime = 0;


Parser.on('gamemetadata', (gameMetaData) => {
  playerManager.setMetaData(gameMetaData);
});

Parser.on('timeslotblock', (timeSlotBlock) => {
  globalTime += timeSlotBlock.timeIncrement;
  playerManager.processTick(globalTime);

  timeSlotBlock.actions.forEach(actionBlock => {
    playerManager.checkCreatePlayer(actionBlock);

  	ActionBlockList.parse(actionBlock.actions).forEach(action => {
      actionCount++;

      playerManager.handleAction(actionBlock, action);
  	});
  });
});

const parseReplays = (paths) => {
  paths.forEach(file => {
    playerManager = new PlayerManager();
    
    logManager.setLogger(file, true);

    try {
      const replay = Parser.parse(file);
      let players = playerManager.players;

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
