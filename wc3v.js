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

const parseReplays = (options) => {
  const { paths, jsonPadding } = options;

  paths.forEach(file => {
    playerManager = new PlayerManager();
    logManager.setLogger(file, true);

    globalTime = 0;
    actionCount = 0;

    try {
      const replay = Parser.parse(file);
      let players = playerManager.players;

      // write our output wc3v file
      utils.writeOutput(file, replay, players, jsonPadding);


      // re-enable all logging
      logManager.setDisabledState(false);

      Object.keys(players).forEach(playerId => {
        console.logger("************************************");
        console.logger(`Inspecting player: ${playerId}`);

        const player = players[playerId];
        const { units, unregisteredUnitCount, removedBuildings } = player;

        // console.log("cache stats: ", player.world.pathFinder.cacheHitCount,
        //  player.world.pathFinder.cacheMissCount);

        // const pathFindTotal = player.world.pathFinder.timers.reduce((acc, timer) => {
        //   acc += timer;

        //   return acc;
        // }, 0);

        // const pathFindAvg = pathFindTotal / player.world.pathFinder.timers.length;

        // console.log("pathfind tot time: ", pathFindTotal);
        // console.log("pathfind avg time: ", pathFindAvg.toFixed(2));

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

      if (options.inTestMode) {
        console.log("TEST PASSED: ", file);
      }
    } catch (e) {
      if (options.inTestMode) {
        console.log("TEST FAILED: ", file);
        console.log(e);
      } else {
        console.log("error parsing replay: ", file);
        console.log("error: ", e);
      }

      return;
    }
  });

  console.logger("wc3v completed.  enjoy!");
};

const main = () => {
  const options = utils.readCliArgs(process.argv);
  
  parseReplays(options);
};

module.exports = {
  parseReplays
};
