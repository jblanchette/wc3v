const path = require("path");

const utils = require("../helpers/utils"),
      mappings = require("../helpers/mappings");

const { isWorkerUnit, WorkerRole, WorkerTask, BURROW_ID, BuildMechanic } = mappings;

const Unit = require("./Unit"),
      Building = require("./Building");

const SubGroup = require("./SubGroup");

const { 
  abilityActions,
  abilityFlagNames,
  mapStartPositions,
  commonMapNames,
  mapDataByFile,
  specialBuildings
} = mappings;

// Formation offset spacing (units). WC3 uses ~48-64 unit spacing for standard units.
const FORMATION_SPACING = 56;

// Compute ring offsets around a center point for formation movement.
// Returns array of {x, y} offsets. First position is center (0,0).
function computeFormationOffsets (count) {
  if (count <= 1) return [{ x: 0, y: 0 }];

  const offsets = [{ x: 0, y: 0 }];
  let placed = 1;
  let ring = 1;

  while (placed < count) {
    const ringCount = ring * 6; // hexagonal rings: 6, 12, 18...
    const radius = FORMATION_SPACING * ring;

    for (let i = 0; i < ringCount && placed < count; i++) {
      const angle = (2 * Math.PI * i) / ringCount;
      offsets.push({
        x: Math.round(radius * Math.cos(angle)),
        y: Math.round(radius * Math.sin(angle))
      });
      placed++;
    }
    ring++;
  }

  return offsets;
}

const PlayerActions = class {

  static setItemCooldown (player, item) {
    item.setCooldownState(true);

    player.eventTimer.addEvent(
      item.cooldown * utils.SECONDS_TO_MS,
      () => { /* no-op */ },
      () => { item.setCooldownState(false); }
    );
  }

  static moveSelectedUnits (
    player,
    targetX,
    targetY
  ) {
    const { world } = player;
    const units = player.getSelectionUnits();

    if (!player.startingPosition) {
      PlayerActions.findStartPosition(player, targetX, targetY);
    }

    // check if we have unregistered units that need actions backfilled
    if (units.length !== player.selection.units.length) {
      console.logger("checking backfill?");
      PlayerActions.backfillMoveSelection(player, targetX, targetY);
    }

    // move our registered units normally
    // units in the same position are moved as a 'group'
    // to avoid pathfinding the same route twice

    // fix units stuck at origin before pathfinding — snap to a nearby selected
    // unit's position (e.g., the hero that summoned them) or starting position
    units.forEach(unit => {
      if (unit.isBuilding) return;
      if (unit.currentX !== 0 || unit.currentY !== 0) return;
      if (unit.spawnPosition && (unit.spawnPosition.x !== 0 || unit.spawnPosition.y !== 0)) return;

      const nearby = units.find(u => u !== unit && (u.currentX !== 0 || u.currentY !== 0));
      if (nearby) {
        unit.setSpawnPosition(nearby.currentX, nearby.currentY);
      } else if (player.startingPosition) {
        unit.setSpawnPosition(player.startingPosition.x, player.startingPosition.y);
      }
    });

    const groups = units.reduce((acc, unit) => {
      const { currentX, currentY } = unit;
      if (currentX == null || currentY == null) {
        return acc;
      }

      // Transport/air units get their own group key to avoid sharing ground paths
      const posStr = unit.isTransport
        ? `air-${unit.uuid}`
        : `${currentX}-${currentY}`;

      if (!acc[posStr]) {
        // Air/transport units bypass ground pathfinder — fly direct with interpolated steps
        let walkInfo;
        if (unit.isTransport) {
          const dx = targetX - currentX;
          const dy = targetY - currentY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const stepSize = 64;  // same granularity as ground pathfinder grid cells
          const steps = Math.max(1, Math.ceil(dist / stepSize));
          const walkPath = [];
          for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            walkPath.push({ x: currentX + dx * t, y: currentY + dy * t, weight: 15 });
          }
          walkInfo = { isDifferentSpot: true, walkPath };
        } else {
          walkInfo = world.pathFinder.findPath(currentX, currentY, targetX, targetY);
        }

        acc[posStr] = {
          groupUnits: [],
          walkInfo,
          startBox: {
            minX: currentX,
            maxX: currentX,
            minY: currentY,
            maxY: currentY
          },
          endBox: {
            minX: targetX,
            maxX: targetX,
            minY: targetY,
            maxY: targetY
          }
        };
      }

      acc[posStr].groupUnits.push(unit);
      return acc;
    }, {});

    const { neutralDetectionTree, neutralGroups } = player.world;

    //
    // pick the closest camp when multiple tight-bounds match a point
    //
    const closestCamp = (hits, px, py) => {
      if (!hits.length) return null;
      if (hits.length === 1) return hits[0];

      let best = hits[0];
      let bestDist = Infinity;
      hits.forEach(hit => {
        const cx = (hit.minX + hit.maxX) / 2;
        const cy = (hit.minY + hit.maxY) / 2;
        const dx = px - cx;
        const dy = py - cy;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          best = hit;
        }
      });
      return best;
    };

    Object.values(groups).forEach(group => {
      const { walkInfo, groupUnits, startBox, endBox } = group;

      const startHits = neutralDetectionTree.search(startBox);
      const endHits = neutralDetectionTree.search(endBox);

      const startHit = closestCamp(startHits, startBox.minX, startBox.minY);
      const endHit = closestCamp(endHits, endBox.minX, endBox.minY);

      if (!startHit && endHit) {
        const endingGroup = neutralGroups[endHit.uuid];
        if (endingGroup) {
          endingGroup.addLocationEvent(player, 'entered');
        }
      } else if (startHit && endHit) {
        const endingGroup = neutralGroups[endHit.uuid];
        if (endingGroup) {
          endingGroup.addLocationEvent(player, 'within');
        }
      } else if (startHit && !endHit) {
        const startingGroup = neutralGroups[startHit.uuid];
        if (startingGroup) {
          startingGroup.addLocationEvent(player, 'exited');
        }
      }

      // tag units with shared groupId when moving as a group
      const groupId = groupUnits.length > 1 ? player.nextMoveGroupId() : null;

      if (groupUnits.length <= 1 || groupUnits[0].isTransport) {
        // single unit or air unit — use shared walkInfo directly
        groupUnits.forEach(unit => {
          unit.currentGroupId = groupId;
          unit.moveTo(world, walkInfo, targetX, targetY);
        });
      } else {
        // multiple ground units — apply formation offsets so they fan out
        const offsets = computeFormationOffsets(groupUnits.length);
        groupUnits.forEach((unit, idx) => {
          unit.currentGroupId = groupId;
          if (idx === 0) {
            // lead unit takes the original path
            unit.moveTo(world, walkInfo, targetX, targetY);
          } else {
            const offset = offsets[idx];
            const offsetTargetX = targetX + offset.x;
            const offsetTargetY = targetY + offset.y;
            let unitWalkInfo = world.pathFinder.findPath(
              unit.currentX, unit.currentY, offsetTargetX, offsetTargetY
            );
            // fall back to shared path if offset target produced empty path
            if (!unitWalkInfo.walkPath.length && walkInfo.walkPath.length) {
              unitWalkInfo = { isDifferentSpot: walkInfo.isDifferentSpot, walkPath: walkInfo.walkPath.slice() };
            }
            unit.moveTo(world, unitWalkInfo, offsetTargetX, offsetTargetY);
          }
        });
      }
    });

    // detect workers being sent outside the base area (scouting)
    units.forEach(unit => {
      if (isWorkerUnit(unit)) {
        player.checkScoutDetection(unit, targetX, targetY);
      }
    });
  }

  // guess the players starting position
  // based on the closest one to their first movement

  static findStartPosition (player, targetX, targetY) {
    const { mapName } = player.gameDataMap;
    let baseMapName = path.basename(mapName);

    baseMapName = baseMapName.trim();
    baseMapName = baseMapName.replace(new RegExp(' ', 'g'), "");

    // strip W3C numbered prefix pattern: "{num}_w3c_{date}_{time}_" → just the map name
    const w3cPrefixMatch = baseMapName.match(/^\d+_w3c_\d+_\d+_(.+)$/);
    const strippedMapName = w3cPrefixMatch ? w3cPrefixMatch[1] : baseMapName;

    let startPositions;

    if (mapStartPositions[baseMapName]) {
      startPositions = mapStartPositions[baseMapName];
    } else if (strippedMapName !== baseMapName && mapStartPositions[strippedMapName]) {
      startPositions = mapStartPositions[strippedMapName];
    } else {
      // auto detect the map name from common names for the map
      // TODO: probably move this into setup / init

      console.logger("auto detecting common map name from detected baseMapName: ", baseMapName);

      const searchTarget = strippedMapName.toLowerCase();

      const commonMapName = Object.keys(commonMapNames).find(mapKey => {
        const mapItemLower = commonMapNames[mapKey].toLowerCase();

        if (searchTarget.indexOf(mapItemLower) !== -1) {
          return mapKey;
        }
      });

      startPositions = mapStartPositions[commonMapName];

      // fallback: match against mapDataByFile names (handles versioned FLO/W3C filenames)
      if (!startPositions) {
        const mapDataKey = Object.keys(mapDataByFile).find(key => {
          const searchName = mapDataByFile[key].name.toLowerCase();
          if (searchTarget.indexOf(searchName) !== -1) {
            return true;
          }
          // try base name without version suffix
          const baseSearchName = searchName.replace(/[_-]v[\d._-]+$/, '');
          const baseTarget = searchTarget.replace('.w3x', '').replace(/[_-]v[\d._-]+$/, '');
          return baseSearchName.length > 3 && baseTarget === baseSearchName;
        });

        if (mapDataKey) {
          startPositions = mapStartPositions[mapDataKey];
        }
      }
      console.logger("auto detect result: ", commonMapName, "start pos: ", startPositions);
    }
      
    if (!startPositions) {
      console.error("unrecognized map: unable to register start positions", baseMapName);
      throw Error("unrecognized map");
    }

    let positions = Object.keys(startPositions).map(spotId => {
      const startPosition = startPositions[spotId];
      const { x, y } = startPosition;

      return {
        startPosition: startPosition,
        distance: utils.distance(
          targetX, targetY,
          x, y
        )
      };
    });

    positions.sort((a, b) => {
      return a.distance - b.distance;
    });

    const winner = positions[0];
    const { startPosition } = winner;
    const { x, y } = startPosition;

    player.startingPosition = startPosition;

    player.units.forEach(unit => {
      unit.setSpawnPosition(x, y);
    });
  }

  static backfillMoveSelection (
    player,
    targetX,
    targetY
  ) {
    const { gameTime } = player.eventTimer.timer;
    let backfillUnits = player.getSelectionUnits(true);

    player.possibleSelectList = player.possibleSelectList.filter(possibleUnit => {

      const removedUnit = backfillUnits.find(backfillUnit => {
        if (utils.isEqualItemId(backfillUnit.itemId1, possibleUnit.itemId1) &&
            utils.isEqualItemId(backfillUnit.itemId2, possibleUnit.itemId2)) {

            possibleUnit.backfill.push({
              action: "moveTo",
              target: {
                x: targetX,
                y: targetY
              },
              gameTime: gameTime
            });

            // filter out of the backfill unit list now that we've found the unit
            return true;
        }

        // keep searching for the unit to backfill
        return false;
      });

      return removedUnit ? false : true;
    });
  }

  static destroyUnit (
    player,
    destroyedUnit
  ) {
    // preserve destroyed summons for client playback
    if (destroyedUnit.summonDuration && destroyedUnit.summonDuration > 0) {
      destroyedUnit.destroyedAt = player.eventTimer.timer.gameTime;
      player.destroyedSummons.push(destroyedUnit);
    }

    player.units = player.units.filter(unit => {
      return !(destroyedUnit.uuid === unit.uuid);
    });

    player.possibleSelectList = player.possibleSelectList.filter(possibleUnit => {
      const unit = { itemId1: possibleUnit.itemId1, itemId2: possibleUnit.itemId2 };
      return !utils.isEqualUnitItemId(destroyedUnit, unit);
    });

    const selectionStartLen = player.selection.units.length;
    player.selection.units = player.selection.units.filter(unit => {
      return !utils.isEqualUnitItemId(unit, destroyedUnit);
    });

    if (selectionStartLen !== player.selection.units.length) {
      player.selection.hasDestroyedSummon = true;
    }

    Object.keys(player.groupSelections).forEach(groupId => {
      if (!player.groupSelections[groupId]) {
        return;
      }
      
      const group = player.groupSelections[groupId];
      const groupStartLen = group.units.length;
      group.units = group.units.filter(unit => {
        return !utils.isEqualUnitItemId(unit, destroyedUnit);
      });

      if (groupStartLen !== group.units.length) {
        group.hasDestroyedSummon = true;
        group.destroyedUnits.push(destroyedUnit);
      }
    });
  }

  static handleSummonDestroy (
    player,
    summonUnit,
    snapshot
  ) {
    return () => {
      if (summonUnit.itemId1 === null && summonUnit.objectId1 === null) {
        player.reduceParseConfidence('Major');

        const currentTime = player.eventTimer.timer.gameTime;
        const targetSpawnTime = currentTime - (summonUnit.summonDuration * utils.SECONDS_TO_MS);
        const currentSnapshot = player.getUnitSnapshot();

        const freshUnits = currentSnapshot.units.filter(unit => {
          if (unit.isRegistered) {
            return false;
          }

          if (unit.itemId !== summonUnit.itemId) {
            return false;
          }

          const inOtherGroup = snapshot.units.find(snapUnit => {
            return utils.isEqualUnitItemId(unit, snapUnit);
          });

          return (inOtherGroup === null || inOtherGroup === undefined);
        });

        const timeBuffer = (summonUnit.summonDuration * utils.SECONDS_TO_MS);
        const timeCandidates = freshUnits.sort((a, b) => {
          return (a.spawnTime - targetSpawnTime) -
                 (b.spawnTime - targetSpawnTime);
        })
        .filter(unit => {
          return Math.abs(unit.spawnTime - targetSpawnTime) < timeBuffer;
        });

        if (timeCandidates.length) {
          const choice = timeCandidates[0];

          summonUnit.itemId1 = choice.itemId1;
          summonUnit.itemId2 = choice.itemId2;

          PlayerActions.destroyUnit(player, summonUnit);
          return;
        } else if (timeCandidates.length === 0) {
          console.logger("WARNING - no unreg summon time candidates... assume this unit never did anything");

          player.reduceParseConfidence('Minor');
        } else {
          console.logger("CRITICAL - unable to find any units when destroying");
          player.reduceParseConfidence('Critical');
        }
      }

      PlayerActions.destroyUnit(player, summonUnit);
    }
  }

  static doAbilityWithTargetAndObjectId (
    player,
    focusUnit,
    objectId1,
    objectId2,
    targetX,
    targetY
  ) {

    if (objectId1 == 4294967295 && objectId2 == 4294967295) {
      // clicked ground
      console.logger(`unit ${focusUnit.displayName} clicked/casted/attacked on GROUND`);
      //focusUnit.clearMoveInfo();
      return;
    }

    if (objectId1 != objectId2) {
      console.logger(`unit ${focusUnit.displayName} clicked/casted/attacked other unit`);
      return;
    }

    let foundUnit = player.world.findNeutralByObjectIds(objectId1, objectId2);
    if (!foundUnit) {
      const potentialUnit = player.world.findPossibleNeutralUnitByPosition(targetX, targetY);
      if (potentialUnit) {
        console.logger(`registering neutral unit ${potentialUnit.displayName} to object ids [ ${objectId1}, ${objectId2}]`);
        potentialUnit.registerObjectIds(objectId1, objectId2);

        // reset ref for shared logic below
        foundUnit = potentialUnit;
      }
    }
      
    // found neutral unit always registered at this point
    if (foundUnit) {
      console.logger(`unit ${focusUnit.displayName} right clicked neutral ${foundUnit.displayName}`);

      if (foundUnit.neutralGroupId) {
        const neutralGroup = player.world.neutralGroups[foundUnit.neutralGroupId];

        if (neutralGroup) {
          neutralGroup.addPlayerEvent(player, player.getSelectionUnits(), focusUnit);
        }
      }

      // track workers being sent to gold mine (per-unit state; aggregates are computed)
      // note: only meta.worker units can mine gold (ghouls cannot)
      if (foundUnit.isGoldmine) {
        const { gameTime } = player.eventTimer.timer;
        const workers = player.getSelectionUnits().filter(u => u.meta.worker);
        workers.forEach(unit => {
          unit.setWorkerRole(WorkerRole.GOLD, gameTime);
        });
      }

      if (foundUnit.isBuilding) {
        console.logger(`unit ${focusUnit.displayName} interacted with building ${foundUnit.displayName}`);
      }
    }

    // check if target is player's own building (for burrow/repair detection)
    if (!foundUnit) {
      const ownUnit = player.findUnitByObjectId(objectId1, objectId2);
      if (ownUnit && ownUnit.isBuilding) {
        const selectedWorkers = player.getSelectionUnits().filter(u => isWorkerUnit(u));
        if (ownUnit.itemId === BURROW_ID) {
          // Orc peon entering burrow — temporary state, primaryRole unchanged
          selectedWorkers.forEach(unit => {
            player._traceTask(unit, WorkerTask.BURROW, 'burrow');
            unit.currentTask = WorkerTask.BURROW;
          });
        } else if (selectedWorkers.length > 0 && selectedWorkers[0].itemId === 'hpea') {
          if (ownUnit.buildState === 1 && ownUnit.builderWorkers) {
            // Human peasant joining building under construction
            selectedWorkers.forEach(unit => {
              if (!ownUnit.builderWorkers.includes(unit)) {
                unit.consumeForBuilding(ownUnit, BuildMechanic.BUILDER);
                ownUnit.builderWorkers.push(unit);
              }
              player._traceTask(unit, WorkerTask.BUILD, 'peasantJoinBuild');
              unit.currentTask = WorkerTask.BUILD;
            });
          } else {
            // Human peasant repairing building — temporary state, primaryRole unchanged
            selectedWorkers.forEach(unit => {
              player._traceTask(unit, WorkerTask.REPAIR, 'repair');
              unit.currentTask = WorkerTask.REPAIR;
            });
          }
        }
      }
    }

  }

  static checkUnitBackfill (
    player,
    backfillUnit
  ) {
    player.possibleSelectList = player.possibleSelectList.filter(possibleUnit => {
      if (utils.isEqualUnitItemId(backfillUnit, possibleUnit)) {
        const { backfill } = possibleUnit;

        backfillUnit.performBackfill(backfill);
        return false; // remove from list
      }

      return true;
    });
  } 

  static selectSubGroupWithNoKnownsUnregistered (
    unregisteredUnit,
    player,
    fixedItemId, 
    itemId1, 
    itemId2,
    objectId1,
    objectId2
  ) {
    // re-assign the objectIds1-2 / itemIds1-2
    // because we're now certain for at least this unit
    let existingUnits = player.units.filter(unit => {
      return unit.itemId === fixedItemId &&
             unit.objectId1 === null;
    });

    // only one of these units is known to exist
    // so we know to update it
    if (existingUnits.length === 1) {
      let existingUnit = existingUnits[0];
      existingUnit.registerUnit(fixedItemId, objectId1, objectId2);
      existingUnit.registerItemIds(itemId1, itemId2);

      PlayerActions.checkUnitBackfill(player, existingUnit);
    } else if (existingUnits.length > 1) {

      // multiple units found
      // if we found a hero, check illusions
      // if we found a non-hero unit, register

      existingUnits.forEach(eu => {
        eu.printUnit();
      });

      if (unregisteredUnit.meta.hero) {
        let heroUnits = player.units.filter(unit => {
          return (
            unit.itemId === fixedItemId &&
            unit.isIllusion === unregisteredUnit.isIllusion
          );
        });

        console.logger("CRITICAL - found unregistered hero unit with select sub and no knowns");
        player.reduceParseConfidence('Critical');
        return;
      }

      if (unregisteredUnit.isUnit || unregisteredUnit.isBuilding) {
        unregisteredUnit.registerUnit(fixedItemId, objectId1, objectId2);
        unregisteredUnit.registerItemIds(itemId1, itemId2);
        unregisteredUnit.spawning = false;
        unregisteredUnit.selected = true;
        PlayerActions.checkUnitBackfill(player, unregisteredUnit);
      } else {
        console.logger("CRITICAL - did nothing????");
        player.reduceParseConfidence('Critical');
        return;
      }

    } else {
      console.logger("WARNING: registering unit with unknown fixedItemId: ", fixedItemId);
      player.reduceParseConfidence('Major');

      unregisteredUnit.registerUnit(fixedItemId, objectId1, objectId2);
      unregisteredUnit.registerItemIds(itemId1, itemId2);
      unregisteredUnit.spawning = false;
      unregisteredUnit.selected = true;

      PlayerActions.checkUnitBackfill(player, unregisteredUnit);
      player.unregisteredUnitCount--;
    }
    
    player.assignKnownUnits();
    player.updatingSubgroup = false;
  }

  static selectSubGroupWithNoKnowns (
    player,
    fixedItemId, 
    itemId1, 
    itemId2,
    objectId1,
    objectId2
  ) {
    // look for a unit by the itemId to maybe register
    let unregisteredUnit = player.findUnregisteredUnitByItemId(fixedItemId);
    if (unregisteredUnit) {
      // subGroup 2
      PlayerActions.selectSubGroupWithNoKnownsUnregistered(
        unregisteredUnit,
        player,
        fixedItemId, 
        itemId1, 
        itemId2,
        objectId1,
        objectId2
      );

      PlayerActions.setSelectionByItemId(player, itemId1, itemId2);
      return;
    }

    const unitInfo = mappings.getUnitInfo(fixedItemId);
    let existingUnits = player.units.filter(unit => {
      return unit.itemId === fixedItemId;
    });

    const heroIllusionCheck = (unitInfo.meta.hero && existingUnits.length > 1);

    // only one of these units is known to exist
    // so we know to update it
    if (existingUnits.length === 1 || heroIllusionCheck) {
      let existingUnit = existingUnits[0];
      if (existingUnit.meta.hero) {
        if (heroIllusionCheck) {
          // multiple heroes of same type exist — this is a true illusion
          console.logger("WARNING - Illusion of hero detected.");

          player.printUnits();

          let newUnit = new Unit(player.eventTimer, null, null, fixedItemId, false);
          newUnit.registerUnit(fixedItemId, objectId1, objectId2);
          newUnit.registerItemIds(itemId1, itemId2);

          newUnit.isIllusion = true;

          // illusions spawn at the original hero's location
          const originalHero = existingUnits[0];
          if (originalHero.currentX !== 0 || originalHero.currentY !== 0) {
            newUnit.setSpawnPosition(originalHero.currentX, originalHero.currentY);
          }

          PlayerActions.checkUnitBackfill(player, newUnit);

          player.addPlayerUnit(newUnit);
          player.unregisteredUnitCount++;

          PlayerActions.setSelectionByItemId(player, itemId1, itemId2);
          return;
        }

        // single hero with changed net tag (revived hero gets new IDs) — re-register
        console.logger("Re-registering hero with new net tag:", existingUnit.displayName);
        existingUnit.registerUnit(fixedItemId, objectId1, objectId2);
        existingUnit.registerItemIds(itemId1, itemId2);

        PlayerActions.checkUnitBackfill(player, existingUnit);
        PlayerActions.setSelectionByItemId(player, itemId1, itemId2);
        return;
      }

      // if existing unit already has different objectIds, this is a distinct unit of the same type
      // (e.g., a second ziggurat) — create a new one instead of re-registering
      if (existingUnit.isRegistered &&
          (existingUnit.objectId1 !== objectId1 || existingUnit.objectId2 !== objectId2)) {
        if (unitInfo.isBuilding) {
          let building = new Building(player.eventTimer, null, null, fixedItemId, false);
          building.registerUnit(fixedItemId, objectId1, objectId2);
          building.registerItemIds(itemId1, itemId2);

          player.estimateBuildingPosition(building);
          PlayerActions.checkUnitBackfill(player, building);
          player.addPlayerBuilding(building);
          PlayerActions.setSelectionByItemId(player, itemId1, itemId2);
        } else {
          let newUnit = new Unit(player.eventTimer, null, null, fixedItemId, false);
          newUnit.registerUnit(fixedItemId, objectId1, objectId2);
          newUnit.registerItemIds(itemId1, itemId2);

          player.addPlayerUnit(newUnit);
          player.unregisteredUnitCount++;

          PlayerActions.checkUnitBackfill(player, newUnit);
          PlayerActions.setSelectionByItemId(player, itemId1, itemId2);
        }
      } else {
        existingUnit.registerUnit(fixedItemId, objectId1, objectId2);
        existingUnit.registerItemIds(itemId1, itemId2);

        PlayerActions.checkUnitBackfill(player, existingUnit);
        PlayerActions.setSelectionByItemId(player, itemId1, itemId2);
      }
    } else {
      // possibly spawned unit was selected?
      const possibleUnit = mappings.getUnitInfo(fixedItemId);
      if (possibleUnit.isUnit) {
        console.logger(1, "Selected a spawned unit", possibleUnit.displayName);

        if (possibleUnit.meta.hero) {
          console.logger("WARNING - for some reason a hero is bad here?");
          console.logger(`WARNING - existing unit length: ${existingUnits.length} illu check: ${heroIllusionCheck}`);
          console.logger(`WARNING - existing units: ${existingUnits}`);
          player.printUnits();

          player.reduceParseConfidence('Minor');
        }

        let newUnit = new Unit(player.eventTimer, null, null, fixedItemId, false);
        newUnit.registerItemIds(itemId1, itemId2);
        newUnit.registerUnit(fixedItemId, objectId1, objectId2);

        player.addPlayerUnit(newUnit);
        player.unregisteredUnitCount++;

        PlayerActions.checkUnitBackfill(player, newUnit);
        PlayerActions.setSelectionByItemId(player, itemId1, itemId2);
      } else if (possibleUnit.isBuilding) {
        let building = new Building(player.eventTimer, null, null, fixedItemId, false);
        building.registerUnit(fixedItemId, objectId1, objectId2);
        building.registerItemIds(itemId1, itemId2);

        if (fixedItemId === specialBuildings.Tavern) {
          // set the tavern to a unique position to avoid false positives on other checks
          building.currentX = -1.11;
          building.currentY = 1.11;
        } else {
          player.estimateBuildingPosition(building);
        }

        PlayerActions.checkUnitBackfill(player, building);
        player.addPlayerBuilding(building);
        PlayerActions.setSelectionByItemId(player, itemId1, itemId2);
      } else {
        console.logger("WARNING - Unknown action performed: ", fixedItemId);
        player.reduceParseConfidence('Minor');
      }
    }
  }
 
  static registerSubGroupFocusUnit (
    player, 
    unit, 
    fixedItemId, 
    itemId1, 
    itemId2,
    objectId1,
    objectId2
  ) {
    PlayerActions.setSelectionByItemId(player, itemId1, itemId2);

    if (unit.isRegistered) {
      if (unit.objectId1 !== objectId1 || unit.objectId2 !== objectId2) {
        // we tried to registered the wrong objectId1-2 pairs
        player.reduceParseConfidence('Critical');
        return;
      }

      player.possibleSelectList = player.possibleSelectList.filter(selectionUnit => {
        const foundSelectionUnit = (
          utils.isEqualItemId(selectionUnit.itemId1, itemId1) &&
          utils.isEqualItemId(selectionUnit.itemId2, itemId2)
        );

        return !foundSelectionUnit;
      });

      return;
    }

    unit.registerUnit(fixedItemId, objectId1, objectId2);
    unit.registerItemIds(itemId1, itemId2);
    unit.spawning = false;
    unit.selected = true;

    PlayerActions.checkUnitBackfill(player, unit);

    player.updatingSubgroup = false;
    player.assignKnownUnits();
  }

  static registerTabSwitch (
    player,
    firstGroupUnit,
    newlyRegisteredUnit,
    fixedItemId,
    itemId1,
    itemId2,
    objectId1,
    objectId2
  ) {
    const badlyDestroyedUnitIndex = player.selection.destroyedUnits.findIndex(dunit => {
      return (dunit.objectId1 === objectId1 &&
              dunit.objectId2 === objectId2);
    });
    const badlyDestroyedUnit = player.selection.destroyedUnits[badlyDestroyedUnitIndex];

    if (badlyDestroyedUnit) {
      console.logger("WARNING - found badlyDestroyedUnit");
      player.reduceParseConfidence('Minor');

      const unregSwitchUnit = player.findUnregisteredUnitByItemId(fixedItemId);
      if (unregSwitchUnit) {
        // detected badly switched unit... reg with old values
        unregSwitchUnit.registerItemIds(badlyDestroyedUnit.itemId1, badlyDestroyedUnit.itemId2);
        unregSwitchUnit.registerUnit(fixedItemId, badlyDestroyedUnit.objectId1, badlyDestroyedUnit.objectId2);
        
        // update selection artifically
        player.selection.addUnit(
          unregSwitchUnit.itemId1,
          unregSwitchUnit.itemId2
        );

        PlayerActions.destroyUnit(player, badlyDestroyedUnit);
        player.selection.setSelectionIndex(0);

        return;
      } else {
        console.logger("WARNING - unable to find unreg itemId for badlyDestroyedUnit");
        player.reduceParseConfidence('Major');
      }
    }

    const unitInfo = mappings.getUnitInfo(fixedItemId);
    const switchedUnit = player.findUnitByObjectId(objectId1, objectId2);

    if (switchedUnit && switchedUnit.isRegistered) {
      if (!utils.isItemIdInList(player.selection.units, switchedUnit.itemId1, switchedUnit.itemId2)) {
        
        // we switched to a known unit but it wasn't in the selection for some reason,
        // artifically assign it in the selection and reduce confidence
        player.selection.clearGroup();
        player.selection.addUnit(switchedUnit.itemId1, switchedUnit.itemId2);

        PlayerActions.setSelectionByItemId(
          player, 
          switchedUnit.itemId1,
          switchedUnit.itemId2
        );

        player.reduceParseConfidence('Major');
        return;
      }
    }

    let finalSwitchedUnit;
    const { setFromHotkey, hasDestroyedSummon } = player.selection;

    if (switchedUnit) {
      switchedUnit.registerObjectIds(objectId1, objectId2);
      finalSwitchedUnit = switchedUnit;
    } else {
      const switchUnitByItemIds = player.findUnregisteredUnitByItemIds(itemId1, itemId2);
      if (switchUnitByItemIds && switchUnitByItemIds.itemId === fixedItemId) {
        switchUnitByItemIds.registerUnit(fixedItemId, objectId1, objectId2);
        finalSwitchedUnit = switchUnitByItemIds;

        player.reduceParseConfidence('Minor');
      } else {

        if (!newlyRegisteredUnit) {
          // try to find a unit by itemId
          const switchUnitByItemId = player.findUnregisteredUnitByItemId(fixedItemId);

          if (switchUnitByItemId) {
            let detectedUnregistered = false;
            if (switchUnitByItemId.itemId1 === null &&
              player.selection.units.length === 1) {
              const selectionUnit = player.selection.units[0];
              const existingBadUnit = player.findUnit(selectionUnit.itemId1, selectionUnit.itemId2);

              if (existingBadUnit) {
                existingBadUnit.unregisterItemIds();
                existingBadUnit.unregisterObjectIds();
              }

              detectedUnregistered = true;
              switchUnitByItemId.registerItemIds(selectionUnit.itemId1, selectionUnit.itemId2);
            }

            const possibleSelectItems = player.selection.units.filter(rawUnit => {
              if (player.findUnit(rawUnit.itemId1, rawUnit.itemId2)) {
                return false;
              }

              return !utils.isEqualUnitItemId(rawUnit, {itemId1, itemId2});
            });

            if (!detectedUnregistered) {
              if (!possibleSelectItems.length) {
                player.printSelectionUnits();
                player.printUnits();

                const firstUnreg = player.getFirstUnregisteredUnitFromSelection();
                if (firstUnreg) {
                  switchUnitByItemId.registerItemIds(firstUnreg.itemId1, firstUnreg.itemId1);
                  switchUnitByItemId.registerObjectIds(objectId1, objectId2);
                  return;
                }

                console.logger("CRITICAL - couldn't handle this selection");
                player.reduceParseConfidence('Critical');
                return;
              }

              if (possibleSelectItems.length === 1) {
                const newItem = possibleSelectItems[0];
                switchUnitByItemId.registerItemIds(newItem.itemId1, newItem.itemId2);

                player.reduceParseConfidence('Minor');
              } else {
                const newItem = possibleSelectItems[0];

                console.logger(
                  "WARNING -found multi one unknown itemId in selection:", 
                  newItem.itemId1,
                  newItem.itemId2
                );

                player.reduceParseConfidence('Major');
                switchUnitByItemId.registerItemIds(newItem.itemId1, newItem.itemId2);
              }
            }

            switchUnitByItemId.registerUnit(fixedItemId, objectId1, objectId2);
            switchUnitByItemId.printUnit();

            finalSwitchedUnit = switchUnitByItemId;
          } else {
            const badUnit = player.findUnitByItemId(fixedItemId);
            if (badUnit) {
              // unregister this unit since we know it was wrong
              badUnit.unregisterObjectIds();
              badUnit.registerObjectIds(objectId1, objectId2);
              finalSwitchedUnit = badUnit;
            } else {
              if (unitInfo.meta.permanent) {
                console.logger("CRITICAL - unable to find tab switch permanent unit."); 
                player.reduceParseConfidence('Critical');
              } else {
                console.logger("WARNING - unable to find table switch non-perm unit");
                player.reduceParseConfidence('Major');
                return;
              }
            }
          }
        } else {
          // register our newly registered unit 
          finalSwitchedUnit = newlyRegisteredUnit;  
        }
        
        
      }
    }

    if (!finalSwitchedUnit) {
      console.logger("CRITICAL - unable to find tab switch final switch unit.");  
      player.reduceParseConfidence('Critical');
      return;
    }

    PlayerActions.setSelectionByItemId(
      player, 
      finalSwitchedUnit.itemId1,
      finalSwitchedUnit.itemId2
    );

    return;
  }

  static setSelectionByItemId (player, itemId1, itemId2, mustFind = false) {
    const targetUnit = { itemId1, itemId2 };
    const unitSelectionIndex = player.selection.units.findIndex(selectionUnit => {
      return utils.isEqualItemId(selectionUnit.itemId1, targetUnit.itemId1) &&
             utils.isEqualItemId(selectionUnit.itemId2, targetUnit.itemId2)
    });

    if (unitSelectionIndex === -1) {
      console.logger("CRITICAL - unable to find unit to set selection");
      player.reduceParseConfidence('Critial');
    }

    player.selection.setSelectionIndex(unitSelectionIndex);
    player.printSelectionUnits();
  }
};

module.exports = PlayerActions;
