const ReplayParser = require('./node_modules/w3gjs/dist/lib/parsers/ReplayParser').default;

const utils = require("./helpers/utils"),
      logManager = require("./helpers/logManager"),
      PlayerManager = require("./lib/PlayerManager");

const config = require("./config/config");
const ReplayValidator = require("./lib/ReplayValidator");
const TERRAINFile = require("./lib/parsers/TERRAINFile");
const { TILESET_EXTRAS, DEFAULT_EXTRAS } = require("./helpers/tilesetColors");
const fs = require('fs');
const path = require('path');

// input: Buffer (raw .w3g bytes) or string (filesystem path)
// options:
//   - mapDataCache: { [mapName]: { wpm, doo, unit } } — pre-loaded JSON cache
//     for browser use, skips fs map reads. Falls back to fs path when absent.
//   - skipTerrainRead: boolean — true on browser; skips the optional W3E read
//     and falls back to DEFAULT_EXTRAS for tileset color (cosmetic only).
//   - onProgress: ({ phase, percent, gameTimeMs?, durationMs?, detail? })
//     called repeatedly during parse. Throttled internally to ~10/sec so
//     callers can drive a UI progress bar without taking over the loop.
//     phase ∈ { 'metadata', 'parsing', 'postprocess', 'done' }
const doParsing = async (input, options = {}) => {
  let actionCount = 0;
  let globalTime = 0;

  // enable worker tracer if configured
  if (config.debugWorkers) {
    logManager.getTracer().enable();
  }

  let playerManager = new PlayerManager();

  const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  const parser = new ReplayParser();

  let replayMeta = null;
  let durationMs = 0;

  // Progress throttling: gamedatablock fires many times per sec; coalesce
  // to ~10 updates/sec to keep the UI smooth without spamming the callback.
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  let lastProgressAt = 0;
  const emitProgress = (phase, percent, extra = {}) => {
    if (!onProgress) return;
    const now = Date.now();
    // Always emit phase transitions and the 'done'/100% case.
    if (phase !== 'parsing' || now - lastProgressAt >= 100) {
      lastProgressAt = now;
      try { onProgress({ phase, percent: Math.max(0, Math.min(100, percent)), ...extra }); } catch (e) { /* swallow */ }
    }
  };

  parser.on("basic_replay_information", (info) => {
    replayMeta = info;
    durationMs = (info && info.subheader && info.subheader.replayLengthMS) || 0;
    emitProgress('metadata', 10, { durationMs });
    playerManager.setMetaData(info.metadata, options);
  });

  parser.on("gamedatablock", (block) => {
    const commandBlocks = block.commandBlocks || [];

    if (block.timeIncrement) {
      globalTime += block.timeIncrement;
      playerManager.processTick(globalTime);
      // 10..85% allocated to the gamedatablock pass. Map global game-time
      // progress within that range. Falls back to 50% if duration unknown.
      if (durationMs > 0) {
        const ratio = Math.min(1, globalTime / durationMs);
        emitProgress('parsing', 10 + ratio * 75, { gameTimeMs: globalTime, durationMs });
      } else {
        emitProgress('parsing', 50, { gameTimeMs: globalTime });
      }
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

  emitProgress('postprocess', 86, { detail: 'workers' });

  // post-process: update worker assignments with final per-unit primaryRole
  Object.values(playerManager.players).forEach(player => {
    if (player.postProcessWorkerAssignments) {
      player.postProcessWorkerAssignments();
    }
  });

  // post-process: build item stream summary per player
  Object.values(playerManager.players).forEach(player => {
    if (player.buildItemStream) {
      player.buildItemStream();
    }
  });

  // post-process: build APM data per player
  Object.values(playerManager.players).forEach(player => {
    if (parseInt(player.id) >= 24) return;
    if (player.buildApmData) {
      player.buildApmData();
    }
  });

  // post-process: validate and correct transport cargo loadEvents
  Object.values(playerManager.players).forEach(player => {
    if (parseInt(player.id) >= 24) return;
    player.units.filter(u => u.isTransport && u.loadEvents && u.loadEvents.length).forEach(transport => {
      const MAX_CARGO = 8;
      const loaded = new Set();
      const cleaned = [];

      transport.loadEvents.forEach(evt => {
        if (evt.action === 'load') {
          if (loaded.has(evt.unitId)) return;  // duplicate load
          if (loaded.size >= MAX_CARGO) {
            // Over capacity — insert synthetic unload-all before this load
            loaded.forEach(uid => {
              const existing = cleaned.find(e => e.unitId === uid && e.action === 'load');
              cleaned.push({
                gameTime: evt.gameTime - 1,
                action: 'unload',
                unitId: uid,
                unitName: existing ? existing.unitName : '?',
                unitItemId: existing ? existing.unitItemId : '?'
              });
            });
            loaded.clear();
          }
          loaded.add(evt.unitId);
          cleaned.push(evt);
        } else if (evt.action === 'unload') {
          loaded.delete(evt.unitId);
          cleaned.push(evt);
        }
      });

      if (cleaned.length !== transport.loadEvents.length) {
        console.logger(`Transport ${transport.displayName}: corrected ${transport.loadEvents.length} -> ${cleaned.length} loadEvents`);
      }
      transport.loadEvents = cleaned;
    });
  });

  emitProgress('postprocess', 88, { detail: 'building backfill' });

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

  // post-parse: fix any remaining buildings with missing positions
  Object.values(playerManager.players).forEach(player => {
    if (parseInt(player.id) >= 24) return;  // skip neutral
    player.units.filter(u => u.isBuilding).forEach(building => {
      player.estimateBuildingPosition(building);
    });
  });

  // post-parse: backfill units with missing positions (must run after building position fixup)
  const UnitPositionBackfill = require('./lib/UnitPositionBackfill');
  const unitPosBackfill = new UnitPositionBackfill(playerManager.players);
  const unitPosResults = unitPosBackfill.run();

  if (unitPosResults.length) {
    console.logger(`Unit position backfill: fixed ${unitPosResults.length} unit(s)`);
    unitPosResults.forEach(r => {
      console.logger(`  Player ${r.player}: ${r.displayName} (${r.itemId}) via ${r.source}`);
    });
  }

  // post-parse: remove overlapping same-type buildings (destroyed-and-rebuilt or missed cancellation)
  Object.values(playerManager.players).forEach(player => {
    if (parseInt(player.id) >= 24) return;
    const buildings = player.units.filter(u => u.isBuilding);
    const toRemove = new Set();

    for (let i = 0; i < buildings.length; i++) {
      for (let j = i + 1; j < buildings.length; j++) {
        const a = buildings[i], b = buildings[j];
        if (a.itemId !== b.itemId) continue;

        const dist = utils.distance(a.currentX, a.currentY, b.currentX, b.currentY);
        const colA = (a.balanceInfo && a.balanceInfo.collisionSize) || 72;
        const colB = (b.balanceInfo && b.balanceInfo.collisionSize) || 72;
        const minSpacing = colA + colB;

        if (dist < minSpacing) {
          // keep the later one (higher spawnTime), remove the earlier
          const older = a.spawnTime <= b.spawnTime ? a : b;
          toRemove.add(older);
          console.logger(`Building dedup: removing overlapping ${older.displayName} at (${older.currentX},${older.currentY})`);
        }
      }
    }

    if (toRemove.size > 0) {
      player.units = player.units.filter(u => !toRemove.has(u));

      // also remove corresponding addBuilding events from eventStream
      const removedIds = new Set([...toRemove].map(u =>
        `${u.objectId1},${u.objectId2},${u.currentX},${u.currentY}`
      ));
      player.eventStream = player.eventStream.filter(evt => {
        if (evt.key !== 'addBuilding' || !evt.building) return true;
        const b = evt.building;
        const id = `${b.objectId1},${b.objectId2},${b.currentX},${b.currentY}`;
        return !removedIds.has(id);
      });
    }
  });

  // post-parse: deduplicate eventStream entries across all event types
  Object.values(playerManager.players).forEach(player => {
    if (parseInt(player.id) >= 24) return;
    if (player.deduplicateEventStream) {
      player.deduplicateEventStream();
    }
  });

  emitProgress('postprocess', 92, { detail: 'building dedup' });

  // post-parse: extract compact base grid from WPM for each player
  const wpmGrid = playerManager.world.gridData && playerManager.world.gridData.wpm
    ? playerManager.world.gridData.wpm.grid
    : null;

  if (wpmGrid) {
    const wpmRows = wpmGrid.length;
    const wpmCols = wpmGrid[0].length;
    const wpmOriginX = wpmGrid[0][0].x;
    const wpmOriginY = wpmGrid[0][0].y;
    const BASE_GRID_PADDING = 8; // WPM cells of padding around buildings

    // read tileset colors for base viewer rendering
    let tilesetExtras = DEFAULT_EXTRAS;
    const mapData = playerManager.world.gridData && playerManager.world.gridData.mapData;
    // mapData.name comes from the replay header (attacker-controlled on uploads).
    // Whitelist safe chars and verify resolved path stays inside mapdata/.
    // Browser path skips this entirely (cosmetic — base-grid color falls back).
    const SAFE_MAP_NAME = /^[A-Za-z0-9_\-. ]+$/;
    if (!options.skipTerrainRead && mapData && mapData.name && SAFE_MAP_NAME.test(mapData.name)) {
      const mapdataRoot = path.resolve(__dirname, 'mapdata');
      const w3ePath = path.resolve(mapdataRoot, mapData.name, 'war3map.w3e');
      if (w3ePath.startsWith(mapdataRoot + path.sep) && fs.existsSync(w3ePath)) {
        try {
          const terrainFile = new TERRAINFile(w3ePath);
          tilesetExtras = TILESET_EXTRAS[terrainFile.tileset] || DEFAULT_EXTRAS;
        } catch (e) {
          // fallback to default if W3E read fails
        }
      }
    }

    // get doo grid for tree filtering
    const dooGrid = playerManager.world.gridData && playerManager.world.gridData.doo
      ? playerManager.world.gridData.doo.grid
      : null;

    Object.values(playerManager.players).forEach(player => {
      if (parseInt(player.id) >= 24) return;

      const buildings = player.units.filter(u => u.isBuilding);
      if (!buildings.length || !player.startingPosition) return;

      // only include buildings near the starting position (main base)
      const BASE_RADIUS = 2000; // game units from starting position
      const baseBuildings = buildings.filter(b => {
        return utils.distance(b.currentX, b.currentY,
          player.startingPosition.x, player.startingPosition.y) < BASE_RADIUS;
      });
      if (!baseBuildings.length) return;

      // compute bounding box of main base buildings in WPM cell indices
      let minRow = Infinity, maxRow = -Infinity;
      let minCol = Infinity, maxCol = -Infinity;

      baseBuildings.forEach(b => {
        const col = Math.round((b.currentX - wpmOriginX) / 32);
        const row = Math.round((wpmOriginY - b.currentY) / 32);
        const halfCells = 8; // ~2 tiles of building radius
        minRow = Math.min(minRow, row - halfCells);
        maxRow = Math.max(maxRow, row + halfCells);
        minCol = Math.min(minCol, col - halfCells);
        maxCol = Math.max(maxCol, col + halfCells);
      });

      // add padding and clamp
      minRow = Math.max(0, minRow - BASE_GRID_PADDING);
      maxRow = Math.min(wpmRows - 1, maxRow + BASE_GRID_PADDING);
      minCol = Math.max(0, minCol - BASE_GRID_PADDING);
      maxCol = Math.min(wpmCols - 1, maxCol + BASE_GRID_PADDING);

      // extract subgrid as compact integers:
      // 0=blocked, 1=walkable(noBuild), 2=buildable, 3=water, 4=shallowWater
      const rows = [];
      for (let r = minRow; r <= maxRow; r++) {
        const row = [];
        for (let c = minCol; c <= maxCol; c++) {
          const cell = wpmGrid[r][c];
          let val;
          if (cell.NoWalk && cell.NoFly) val = 0;          // blocked cliff/void
          else if (!cell.NoWater && cell.NoWalk) val = 3;   // deep water
          else if (!cell.NoWater && !cell.NoWalk) val = 4;  // shallow water
          else if (!cell.NoBuild && !cell.NoWalk) val = 2;  // buildable
          else val = 1;                                      // walkable path
          row.push(val);
        }
        rows.push(row);
      }

      // filter trees within baseGrid bounds
      const gridOriginX = wpmOriginX + minCol * 32;
      const gridOriginY = wpmOriginY - minRow * 32;
      const gridWidth = (maxCol - minCol + 1) * 32;
      const gridHeight = (maxRow - minRow + 1) * 32;
      let baseTrees = [];

      if (dooGrid) {
        dooGrid.forEach(item => {
          if (!item.flags || !item.flags.visible) return;
          if (item.life === 0) return;

          const tx = parseFloat(item.position.x);
          const ty = parseFloat(item.position.y);

          // check if tree is within baseGrid bounds
          if (tx < gridOriginX || tx > gridOriginX + gridWidth) return;
          if (ty > gridOriginY || ty < gridOriginY - gridHeight) return;

          baseTrees.push({
            x: Math.round(tx),
            y: Math.round(ty),
            s: Math.round((item.scale ? item.scale[0] : 1) * 100) / 100
          });
        });
      }

      player._baseGrid = {
        originX: gridOriginX,
        originY: gridOriginY,
        cellSize: 32,
        cols: maxCol - minCol + 1,
        rows: maxRow - minRow + 1,
        cells: rows,
        groundColor: tilesetExtras.ground,
        cliffColor: tilesetExtras.cliff,
        waterColor: tilesetExtras.water,
        shallowWaterColor: tilesetExtras.shallowwater,
        treeColor: tilesetExtras.trees,
        trees: baseTrees
      };
    });
  }

  // post-parse: capture final base snapshot for each player
  const SNAPSHOT_BASE_RADIUS = 2000;
  Object.values(playerManager.players).forEach(player => {
    if (parseInt(player.id) >= 24) return;
    if (!player.startingPosition) return;

    const sx = player.startingPosition.x;
    const sy = player.startingPosition.y;

    const buildings = player.units
      .filter(u => u.isBuilding && u.currentX !== 0 && u.currentY !== 0 &&
        utils.distance(u.currentX, u.currentY, sx, sy) < SNAPSHOT_BASE_RADIUS)
      .map(u => ({
        itemId: u.itemId,
        displayName: u.displayName,
        x: u.currentX,
        y: u.currentY,
        collisionSize: (u.balanceInfo && u.balanceInfo.collisionSize) || 0,
        isInferred: u.isInferred || false
      }));

    if (buildings.length) {
      player._baseSnapshots = player._baseSnapshots || [];
      player._baseSnapshots.push({
        label: 'Final',
        tier: player.tier,
        gameTime: globalTime,
        buildings: buildings
      });
    }
  });

  emitProgress('postprocess', 96, { detail: 'validation' });

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

  emitProgress('done', 100);

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

        // log pathfinding stats (after logging re-enabled)
        world.pathFinder.logCacheStats();

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
          // collect this player's validation issues from the validator output
          const playerWarnings = (validation && validation.warnings || [])
            .filter(w => String(w.player) === String(pid));
          playerStats[pid] = {
            name: p.playerName || p.playerId,
            race: p.race,
            parseConfidence: p.parseConfidence,
            validationConfidence: p.validationConfidence,
            issueCounts: p.validationIssues || { critical: 0, major: 0, minor: 0, info: 0 },
            warnings: playerWarnings,
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

// CLI detection. `require.main === module` is true only when this file was
// invoked directly via `node wc3v.js`. Bundlers (esbuild, etc.) leave
// require.main undefined, so the bundled browser path skips main().
const isCLI = typeof require !== 'undefined' && require.main === module;

if (isCLI) {
  main();
}
