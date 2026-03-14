const ReplayParser = require('./node_modules/w3gjs/dist/lib/parsers/ReplayParser').default;

const utils = require("./helpers/utils"),
      logManager = require("./helpers/logManager"),
      PlayerManager = require("./lib/PlayerManager");

const config = require("./config/config");
const ReplayValidator = require("./lib/ReplayValidator");
const fs = require('fs');
const path = require('path');

const doParsing = async (file) => {
  let actionCount = 0;
  let globalTime = 0;

  // enable worker tracer if configured
  if (config.debugWorkers) {
    logManager.getTracer().enable();
  }

  let playerManager = new PlayerManager();

  const buffer = fs.readFileSync(file);
  const parser = new ReplayParser();

  let replayMeta = null;

  parser.on("basic_replay_information", (info) => {
    replayMeta = info;
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

        // normalize w3gjs v3 action format to v2 field names
        action = utils.normalizeAction(action);
        // all action itemIds must be fixed due to parser bug
        action = utils.fixBrokenActionFormat(action);

        playerManager.handleAction(actionBlock, action);
      });

    });
  });

  let replay;
  try {
    replay = await parser.parse(buffer);
  } catch (e) {
    // w3gjs can crash on unsupported actions (e.g. FLO/W3C replays with newer action types)
    // game data was already processed via events — use the stored metadata
    if (replayMeta) {
      console.error(`w3gjs parse error (using partial data): ${e.message}`);
      console.error(e.stack);
      replay = replayMeta;
    } else {
      throw e;
    }
  }

  // post-process: update worker assignments with final per-unit primaryRole
  Object.values(playerManager.players).forEach(player => {
    if (player.postProcessWorkerAssignments) {
      player.postProcessWorkerAssignments();
    }
  });

  // post-parse: backfill missing buildings inferred from tech tree
  const BuildingBackfill = require('./lib/BuildingBackfill');
  const backfill = new BuildingBackfill(playerManager.players);
  const backfillResults = backfill.run();

  if (backfillResults.length) {
    console.logger(`Building backfill: inferred ${backfillResults.length} missing building(s)`);
    backfillResults.forEach(r => {
      console.logger(`  Player ${r.player}: ${r.displayName} (${r.buildingId})`);
    });
  }

  // post-parse: backfill missing supply buildings (farms/burrows/zigs/moonwells)
  const SupplyBuildingBackfill = require('./lib/SupplyBuildingBackfill');
  const supplyBackfill = new SupplyBuildingBackfill(playerManager.players);
  const supplyResults = supplyBackfill.run();

  if (supplyResults.length) {
    console.logger(`Supply building backfill: inferred ${supplyResults.length} missing supply building(s)`);
    supplyResults.forEach(r => {
      console.logger(`  Player ${r.player}: ${r.displayName} (${r.buildingId}) at ~${Math.floor(r.gameTime / 60000)}:${String(Math.floor((r.gameTime % 60000) / 1000)).padStart(2, '0')}`);
    });
  }

  // post-parse validation: detect contradictions in parsed data
  const validator = new ReplayValidator(playerManager.players);
  const validation = validator.validate();

  if (validation.warnings.length) {
    console.logger(`Replay validation: ${validation.warnings.length} warning(s)`);
    validation.warnings.forEach(w => {
      console.logger(`  [${w.type}] Player ${w.player}: ${w.details}`);
    });
  }

  // output action type summary when debug is enabled
  if (config.debugActions) {
    const actionSummary = playerManager.getActionSummary();
    console.log("\n\n=== ACTION TYPE SUMMARY ===");
    console.log("\nHandled action types:");
    Object.entries(actionSummary.handled).sort((a, b) => b[1] - a[1]).forEach(([name, count]) => {
      console.log(`  ${name}: ${count}`);
    });

    if (Object.keys(actionSummary.unhandled).length) {
      console.log("\nUnhandled (named but no handler):");
      Object.entries(actionSummary.unhandled).sort((a, b) => b[1] - a[1]).forEach(([name, count]) => {
        console.log(`  ${name}: ${count}`);
      });
    } else {
      console.log("\nNo unhandled named actions.");
    }

    if (actionSummary.unknown.length) {
      console.log(`\nUnknown action IDs (${actionSummary.unknown.length} total):`);
      const idCounts = {};
      actionSummary.unknown.forEach(u => {
        idCounts[u.hexId] = (idCounts[u.hexId] || 0) + 1;
      });
      Object.entries(idCounts).sort((a, b) => b[1] - a[1]).forEach(([hexId, count]) => {
        console.log(`  ${hexId}: ${count} occurrences`);
      });
    } else {
      console.log("\nNo unknown action IDs.");
    }
    console.log("===========================\n");
  }

  // output worker trace if enabled
  if (config.debugWorkers) {
    const tracer = logManager.getTracer();
    tracer.printSummary();
    const tracePath = path.join(__dirname, 'client', 'logs', 'worker-trace.json');
    tracer.writeToFile(tracePath);
    console.log(`Worker trace written to ${tracePath}`);
  }

  return {
    replay,
    players: playerManager.players,
    world: playerManager.world,
    validation
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
        const { replay, players, world, validation } = result;

        // write our output wc3v file
        const replayHash = hashes && hashes[0] || null;
        utils.writeOutput(file, replayHash, replay, players, world, jsonPadding, validation);

        // re-enable all logging
        logManager.setDisabledState(false);

        if (options.inTestMode) {
          console.log("TEST PASSED: ", file);
        }

        // extract per-player confidence + supply stats for tooling
        const playerStats = {};
        Object.keys(players).forEach(pid => {
          const p = players[pid];
          if (!p || parseInt(pid) >= 24) return;
          const supplyBuildingEvents = (p.eventStream || []).filter(e =>
            e.key === 'addBuilding' && e.isInferred
          ).length;
          playerStats[pid] = {
            name: p.playerName || p.playerId,
            race: p.race,
            parseConfidence: p.parseConfidence,
            supplyBumps: (p._supplyBumps || []).length,
            inferredBuildings: supplyBuildingEvents
          };
        });

        return {
          passed: true,
          error: null,
          playerStats,
          validation,
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
  doParsing,
  parseReplays
};

const isCLI = !module.parent;

if (isCLI) {
  main();
}
