const path = require("path");

const utils = require("../helpers/utils"),
      mappings = require("../helpers/mappings");

const Unit = require("./Unit"),
      Building = require("./Building");

const SubGroup = require("./SubGroup");

const { 
  abilityActions,
  abilityFlagNames,
  mapStartPositions,
  commonMapNames,
  specialBuildings
} = mappings;

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

    const groups = units.reduce((acc, unit) => {
      const { currentX, currentY } = unit;
      if (currentX == null || currentY == null) {
        return acc;
      }

      const posStr = `${currentX}-${currentY}`;

      if (!acc[posStr]) {
        // setup group entry and find the path once

        acc[posStr] = {
          groupUnits: [],
          walkInfo: world.pathFinder.findPath(
            currentX, currentY, 
            targetX, targetY
          ),
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

    const { neutralGroupTree, neutralGroups } = player.world;

    Object.values(groups).forEach(group => {
      const { walkInfo, groupUnits, startBox, endBox } = group;

      const startingBox = neutralGroupTree.search(startBox);
      const endingBox = neutralGroupTree.search(endBox);

      if (!startingBox[0] && endingBox[0]) {
        const endingGroup = neutralGroups[endingBox[0].uuid];
        if (endingGroup) {
          endingGroup.addLocationEvent(player, 'entered');
        }
      } else if (startingBox[0] && endingBox[0]) {
        const endingGroup = neutralGroups[endingBox[0].uuid];
        if (endingGroup) {
          endingGroup.addLocationEvent(player, 'within');
        }
      } else if (startingBox[0] && !endingBox[0]) {
        const startingGroup = neutralGroups[startingBox[0].uuid];
        if (startingGroup) {
          startingGroup.addLocationEvent(player, 'exited');
        }
      }

      groupUnits.forEach(unit => {
        unit.moveTo(world, walkInfo, targetX, targetY);
      });
    });
  }

  // guess the players starting position
  // based on the closest one to their first movement

  static findStartPosition (player, targetX, targetY) {
    const { mapName } = player.gameData.map;
    const baseMapName = path.basename(mapName).toLowerCase();

    let startPositions;

    if (mapStartPositions[baseMapName]) {
      startPositions = mapStartPositions[baseMapName];
    } else {
      // auto detect the map name from common names for the map
      // TODO: probably move this into setup / init
      
      const commonMapName = Object.keys(commonMapNames).find(mapItem => {
        if (baseMapName.indexOf(mapItem) !== -1) {
          return mapItem;
        }
      });

      startPositions = mapStartPositions[commonMapNames[commonMapName]];
    }
      
    if (!startPositions) {
      console.error("unrecognized map: unable to register start positions", baseMapName);
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
          neutralGroup.addPlayerEvent(player, player.getSelectionUnits());
        }
      }

      if (foundUnit.isBuilding) {
        console.logger(`unit ${focusUnit.displayName} interacted with building ${foundUnit.displayName}`);
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
        console.logger("WARNING - Illusion of hero detected.");

        player.printUnits();
          
        let newUnit = new Unit(player.eventTimer, null, null, fixedItemId, false);
        newUnit.registerUnit(fixedItemId, objectId1, objectId2);
        newUnit.registerItemIds(itemId1, itemId2);

        newUnit.isIllusion = true;

        PlayerActions.checkUnitBackfill(player, newUnit);

        player.addPlayerUnit(newUnit);
        player.unregisteredUnitCount++;

        PlayerActions.setSelectionByItemId(player, itemId1, itemId2);
        return;
      }

      existingUnit.registerUnit(fixedItemId, objectId1, objectId2);
      existingUnit.registerItemIds(itemId1, itemId2);

      PlayerActions.checkUnitBackfill(player, existingUnit);
      PlayerActions.setSelectionByItemId(player, itemId1, itemId2);
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
      } else if (fixedItemId === specialBuildings.Tavern) {
        let building = new Building(this.eventTimer, null, null, fixedItemId, false);
        building.registerUnit(fixedItemId, objectId1, objectId2);

        // set the tavern to a unique position to avoid false positives on other checks
        building.currentX = -1.11;
        building.currentY = 1.11;

        PlayerActions.checkUnitBackfill(player, building);
        player.addPlayerBuilding(building);
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
