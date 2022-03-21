const ReplayParser = require('./node_modules/w3gjs/dist/lib/parsers/ReplayParser').default;

const utils = require("./helpers/utils"),
      logManager = require("./helpers/logManager"),
      PlayerManager = require("./lib/PlayerManager");

const fs = require('fs');

const doParsing = async (file) => {
  let actionCount = 0;
  let globalTime = 0;

  let playerManager = new PlayerManager();

  const buffer = fs.readFileSync(file);
  const parser = new ReplayParser();

  parser.on("basic_replay_information", (info) => {
    playerManager.setMetaData(info.metadata);
  });

  parser.on("gamedatablock", (block) => {
    const commandBlocks = block.commandBlocks || [];
    
    if (block.timeIncrement) {
      globalTime += block.timeIncrement;
      playerManager.processTick(globalTime);
    }

    commandBlocks.forEach((actionBlock) => {
      // check each block to see if we've found a new playerId
      playerManager.checkCreatePlayer(actionBlock);

      // handle each action in the block
      const actions = actionBlock.actions || [];
      actions.forEach(action => {
        actionCount++;

        // all action itemIds must be fixed due to parser bug
        action = utils.fixBrokenActionFormat(action);

        playerManager.handleAction(actionBlock, action);
      });

    });
  });

  const replay = await parser.parse(buffer);

  return {
    replay,
    players: playerManager.players,
    world: playerManager.world
  };
};

const parseReplays = async (options) => {
  const { paths, hashes, jsonPadding, isProduction, inTestMode } = options;

  if (isProduction) {
    logManager.setTestMode(true);
    logManager.setProductionMode(true);
  }

  const file = paths.shift();
  logManager.setLogger(file, true);

  if (!isProduction) {
    logManager.getLogger().init();
  }

  const result = await doParsing(file).then(result => {    
    try {
        const { replay, players, world } = result;

        // write our output wc3v file
        const replayHash = hashes && hashes[0] || null;
        utils.writeOutput(file, replayHash, replay, players, world, jsonPadding);
   
        // re-enable all logging
        logManager.setDisabledState(false);

        if (options.inTestMode) {
          console.log("TEST PASSED: ", file);
        }

        return { 
          passed: true, 
          error: null, 
          wc3vOutput: {
            replayHash,
            ...replay
          }
        };
      
    } catch (e) {
      console.log("error parsing replay: ", file);
      console.log(e);
        
      return { passed: false, error: e.message, wc3vOutput: null };
    }
  });

  if (inTestMode) {
    if (paths.length) {
      await parseReplays(options);
    }
  }
  
  return [ result ];
};

const main = async () => {
  const options = utils.readCliArgs(process.argv);
  
  await parseReplays(options);
};

module.exports = {
  parseReplays
};

const isCLI = !module.parent;

if (isCLI) {
  main();
}
