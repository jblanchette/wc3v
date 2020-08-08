const W3GReplay = require('./node_modules/w3gjs');
const { ActionBlockList } = require('./node_modules/w3gjs/dist/lib/parsers/actions');
const Parser = new W3GReplay();

const utils = require("./helpers/utils"),
      logManager = require("./helpers/logManager"),
      PlayerManager = require("./lib/PlayerManager");

const fs = require('fs');

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
  const { paths, hashes, jsonPadding, isProduction } = options;

  if (isProduction) {
    logManager.setTestMode(true);
    logManager.setProductionMode(true);
  }

  const results = paths.map((file, ind) => {
    playerManager = new PlayerManager();
    logManager.setLogger(file, true);

    if (!isProduction) {
      logManager.getLogger().init();
    }
    
    globalTime = 0;
    actionCount = 0;

    try {

      let replay;

      try {
        replay = Parser.parse(file);
      } catch (e) {
        if (e.message === "missing-map-data") {
          throw e;
        }

        console.log("normal parse failed: ", e.message);
        console.log("trying backup replay type");
        replay = Parser.parse(file, 'netease');
      }


      let players = playerManager.players;

      // write our output wc3v file
      const replayHash = hashes && hashes[ind] || null;
      utils.writeOutput(file, replayHash, replay, players, jsonPadding);

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

      return { passed: true, error: null };
    } catch (e) {
      if (options.inTestMode) {
        console.log("TEST FAILED: ", file);
        console.log(e);

        return { passed: false, error: e.message };
      } else {
        console.log("error parsing replay: ", file);
        console.log(e);
        
        return { passed: false, error: e.message };
      }

      return { passed: true, error: null };
    }
  });

  return results;
};

const main = () => {
  const options = utils.readCliArgs(process.argv);
  
  parseReplays(options);
};

module.exports = {
  parseReplays
};

const isCLI = !module.parent;

if (isCLI) {
  main();
}
