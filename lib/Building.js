const utils = require("../helpers/utils"),
      mappings = require("../helpers/mappings");

const Unit = require("./Unit");

// Spawn-position helper: ALWAYS the building center.
//
// Previously this returned the ground rally point when one was set, as a
// shortcut to skip simulating the worker's walk from building → rally.
// For the typical case (rally → own gold mine right next to TH) the
// shortcut is visually invisible. But when a player rallies elsewhere
// — Kaho's Tree of Eternity in 1342775468_Kaho_Happy_Hammerfall is
// rallied at (-3727.89, 3031.9), all the way across the map by Happy's
// gold mine — every worker trained from that building gets placed at
// the rally instead of at the TH. The user sees 7+ wisps clustered in
// the OPPONENT's base flickering in/out (lostState=possiblyLost from
// pathSilence) while none appear in the casting player's own base.
//
// Spawning at the building keeps the parser model honest: workers
// appear where they really spawn, and normal path tracking handles
// the walk to wherever they end up. CollisionWorld.resolvePosition()
// still snaps each worker to a nearby free tile so they don't pile up
// inside the building footprint.
function pickSpawnPositionForBuilding (building) {
  return { x: building.currentX, y: building.currentY };
}

const {
  abilityActions,
  abilityFlagNames,
  mapStartPositions,
  specialBuildings,
  itemAbilityData,
  tierBuildings,
  isWorkerUnit,
  WorkerRole,
  WorkerTask,
  getBuildTime,
  researchMeta,
  NEUTRAL_HIRE_BUILDINGS,
  itemSellingBuildings
} = mappings;

const BuildingStates = {
  created: 0,
  building: 1,
  unsummoned: 2,
  completed: 3
};

const Building = class extends Unit {

  constructor (eventTimer, itemId1, itemId2, knownItemId, isSpawnedAtStart = false) {
    super(eventTimer, itemId1, itemId2, knownItemId, isSpawnedAtStart);

    this.buildEvent = null;
    this.buildState = BuildingStates.created;
    this.buildProgress = 0;

    // construction lifecycle
    this.constructionEvent = null;
    this.constructionComplete = false;
    this.constructionStartTime = null;
    this.constructionEndTime = null;
    this.builderUnit = null;        // primary worker that built this
    this.builderWorkers = [];       // for Human: multiple peasants on same building

    this.itemStock = {};
    this.shopItemsSet = {};
    this.shopItemCooldowns = {};
  }

  startConstruction (buildTimeSeconds, onCompleteCb) {
    const self = this;
    this.buildState = BuildingStates.building;
    this.constructionStartTime = this.eventTimer.timer.gameTime;

    if (!buildTimeSeconds || buildTimeSeconds <= 0) {
      buildTimeSeconds = 60;
    }

    this.constructionEvent = this.eventTimer.addEvent(
      buildTimeSeconds * utils.SECONDS_TO_MS,
      () => {},
      (eventFinished) => {
        self.buildState = BuildingStates.completed;
        self.constructionComplete = true;
        self.constructionEndTime = self.eventTimer.timer.gameTime;

        if (onCompleteCb) {
          onCompleteCb(eventFinished);
        }
      }
    );
  }

  cancelConstruction () {
    if (this.constructionEvent) {
      this.eventTimer.cancelEvent(this.constructionEvent);
      this.constructionEvent = null;
    }
    this.buildState = BuildingStates.created;
  }

  // --- Training queue management ---

  queueUnit (itemId, unit) {
    const entry = {
      itemId: itemId,
      unit: unit,
      completed: false,
      trainingEvent: null
    };
    this.trainedUnits.push(entry);

    // if this is the only unit in queue, start training immediately
    if (this.getIncompleteCount() === 1) {
      this._startNextTraining();
    }

    return entry;
  }

  getIncompleteCount () {
    return this.trainedUnits.filter(u => !u.completed).length;
  }

  getActivelyTraining () {
    return this.trainedUnits.find(u => !u.completed && u.trainingEvent !== null);
  }

  getQueuedUnits () {
    return this.trainedUnits.filter(u => !u.completed && u.trainingEvent === null);
  }

  _startNextTraining () {
    const next = this.trainedUnits.find(u => !u.completed && u.trainingEvent === null);
    if (!next) return;

    const buildTimeSeconds = getBuildTime(next.itemId);
    const self = this;

    next.trainingEvent = this.eventTimer.addEvent(
      buildTimeSeconds * utils.SECONDS_TO_MS,
      () => {},
      (eventFinished) => {
        next.completed = true;
        if (next.unit) {
          next.unit.isTraining = false;
          next.unit.trainedTime = self.eventTimer.timer.gameTime;

          // Unit physically exists now — register with collision world and
          // re-position. Rally point may have changed during training; the
          // surroundings may also now be crowded by other completed units.
          const spawn = pickSpawnPositionForBuilding(self);
          next.unit.currentX = spawn.x;
          next.unit.currentY = spawn.y;
          if (next.unit._collisionWorld) {
            next.unit._collisionWorld.addUnit(next.unit);
          }
          next.unit.recordPosition();
        }
        // notify player to finalize supply/worker state
        if (next.unit && next.unit._onTrainingComplete) {
          next.unit._onTrainingComplete();
        }
        self._startNextTraining();
      }
    );
  }

  cancelQueuedUnit () {
    // cancel last queued (not yet training) unit first
    const queued = this.getQueuedUnits();
    if (queued.length > 0) {
      const last = queued[queued.length - 1];
      const idx = this.trainedUnits.indexOf(last);
      if (idx !== -1) this.trainedUnits.splice(idx, 1);
      return last;
    }
    // if no queued units, cancel the active training
    const active = this.getActivelyTraining();
    if (active) {
      if (active.trainingEvent) {
        this.eventTimer.cancelEvent(active.trainingEvent);
      }
      const idx = this.trainedUnits.indexOf(active);
      if (idx !== -1) this.trainedUnits.splice(idx, 1);
      return active;
    }
    return null;
  }

  upgradeBuilding (newItemId, player) {
    const self = this;
    const buildTiers = tierBuildings[player.race];
    const research = researchMeta[newItemId];

    if (research) {
      // This is a research/upgrade, not a building tier upgrade
      player.addResearch(newItemId, self);
      return;
    }

    // Emit tier upgrade event and update tier at initiation time (not completion)
    const tierPos = buildTiers ? buildTiers.indexOf(newItemId) : -1;
    if (tierPos > -1) {
      player.upgradeTier(newItemId);
    }

    const onBuildingTick = (gameTime, delta)  => {
      //console.logger("building tick.", self.displayName);
    };

    const onBuildingComplete = (eventFinished) => {
      // The upgrade history, exported so the viewer can render the base form
      // until the moment the upgrade completes (a hall that ends the game as a
      // Castle was a Town Hall for most of it). Mutating itemId alone made the
      // export carry only the FINAL form.
      if (!self.upgradeSteps) {
        self.upgradeSteps = [];
        self.initialItemId = self.itemId;
      }
      self.upgradeSteps.push({ itemId: newItemId, at: self.eventTimer.timer.gameTime });
      self.itemId = newItemId;
      self.setUnitMeta();
    };

    const buildTime = mappings.buildTimings[newItemId] || 50;
    this.moveInfo.timerEvent = this.eventTimer.addEvent(
      buildTime * utils.SECONDS_TO_MS,
      onBuildingTick.bind(this),
      onBuildingComplete.bind(this)
    );
  }

  initItemStock (itemId) {
    // setup the items stock since somebody bought it
    const itemData = itemAbilityData[itemId];
    const stockCount = itemData ? itemData.stockCount : 1;

    this.itemStock[itemId] = stockCount;
  }

  buyStockItem (itemId) {
    const self = this;
    const itemData = itemAbilityData[itemId];
    const stockReplenish = itemData ? itemData.stockReplenish : 15;

    const currentStock = this.itemStock[itemId];

    if (currentStock === undefined) {
      if (!this.shopItemsSet[itemId]) {
        this.shopItemsSet[itemId] = true;
        this.initItemStock(itemId);
      }
    }

    if (currentStock <= 0) {
      console.logger("WARNING - tried to buy item with no stock, not allowing");

      return false;
    }

    this.itemStock[itemId] -= 1;

    console.logger("buying stock replenish on item: ", itemId, stockReplenish);
    console.logger("stock left:", this.itemStock[itemId]);

    this.shopItemCooldowns[itemId] = this.eventTimer.addEvent(
      stockReplenish * utils.SECONDS_TO_MS, 
      () => { /* no-op */ },
      () => { self.addStockReplenish(itemId); }
    );

    return true;
  }

  addStockReplenish (itemId) {
    this.itemStock[itemId] += 1;
    this.shopItemCooldowns[itemId] = null;
  }

  static isTavern (fixedItemId) {
    return (fixedItemId === specialBuildings.Tavern);
  }

  static isNeutralShop (fixedItemId) {
    return (fixedItemId === specialBuildings.NeutralShop);
  }

  static isNeutralHireBuilding (fixedItemId) {
    return !!(NEUTRAL_HIRE_BUILDINGS[fixedItemId]);
  }

  // True for any building that sells items — drives buy-dispatch in
  // doAbilityNoTargetItemId. Distinct from isNeutralShop (which gates the
  // `player.neutralShopSelected` flag for selection-side bookkeeping) and
  // isNeutralHireBuilding (which dispatches mercenary hires). ngad and nmer
  // appear in BOTH isNeutralHireBuilding AND itemSellingBuildings — the
  // same focusUnit dispatches both item buys and unit hires depending on
  // the ability flags of the subsequent action.
  static isItemShop (fixedItemId) {
    return !!(itemSellingBuildings[fixedItemId]);
  }

  // True for neutral item shops (ngme / ngad / nmer) — these trigger the
  // `player.neutralShopSelected` flag because the player can't actually own
  // them and the selection group gets cleared on click. Player shops
  // (utom / ovln / eden / hvlt) dispatch through the normal focusUnit path
  // so they MUST NOT set neutralShopSelected — that would route them
  // through getNeutralShop which only resolves neutral world entries.
  static isNeutralItemShop (fixedItemId) {
    return !!(itemSellingBuildings[fixedItemId]) &&
           !!(NEUTRAL_HIRE_BUILDINGS[fixedItemId] || fixedItemId === specialBuildings.NeutralShop);
  }

  static doAbilityRightClickWithTargetAndObjectId (
    player,
    focusUnit,
    objectId1,
    objectId2,
    targetX,
    targetY
  ) {
    // check for ground clicks
    if (objectId1 === -1 && objectId2 === -1) {
      focusUnit.rallyPoint = {
        type: "ground",
        pt: {
          x: targetX,
          y: targetY
        },
        objectId1: null,
        objectId2: null
      };

      return;
    }

    // clicked on another unit
    focusUnit.rallyPoint = {
      type: "unit",
      pt: {
        x: targetX,
        y: targetY
      },
      objectId1: objectId1,
      objectId2: objectId2
    };

    if (!player.findUnitByObjectId(objectId1, objectId2)) {
      // unknown unit clicked as rally
      // probably a tree or goldmine, maybe a unit
      player.world.addUnknownObject(objectId1, objectId2);
    }
  }

  static doAbilityNoTargetItemArray (
    player,
    focusUnit,
    itemId,
    abilityFlags,
    unknownA,
    unknownB
  ) {
    console.logger("**JDEBUG[build]: running doAbilityNoTargetItemArray flags: ", abilityFlags);
    switch (abilityFlags) {
      case abilityFlagNames.CancelTrainOrResearch:
        console.logger("in building CancelTrainOrResearch for ", focusUnit.displayName);

        if (!focusUnit.trainedUnits.length) {
          // no record of training - building canceled itself while being made
          console.logger("focus unit building had no trained units, check building remove routine");

          // release any consumed workers when building is cancelled
          if (focusUnit.builderWorkers && focusUnit.builderWorkers.length) {
            focusUnit.builderWorkers.forEach(w => {
              w.releaseFromBuilding(player.eventTimer.timer.gameTime);
              w.closeBuildWindow(player.eventTimer.timer.gameTime);
              player._traceTask(w, w.primaryRole || WorkerTask.GOLD, 'buildCancelRelease');
            });
            focusUnit.builderWorkers = [];
          } else if (focusUnit.builderUnit && focusUnit.builderUnit.isConsumedByBuilding()) {
            focusUnit.builderUnit.releaseFromBuilding(player.eventTimer.timer.gameTime);
            focusUnit.builderUnit.closeBuildWindow(player.eventTimer.timer.gameTime);
            player._traceTask(focusUnit.builderUnit, focusUnit.builderUnit.primaryRole || WorkerTask.GOLD, 'buildCancelRelease');
          }
          // A worker still WALKING to a now-cancelled build (pre-arrival) is
          // referenced only by _pendingBuilder — close its window so it isn't
          // force-shown walking to a building that no longer exists.
          if (focusUnit._pendingBuilder && focusUnit._pendingBuilder.closeBuildWindow) {
            focusUnit._pendingBuilder.closeBuildWindow(player.eventTimer.timer.gameTime);
          }

          if (focusUnit.constructionEvent) {
            focusUnit.cancelConstruction();
          }

          const buildingRemoveIndex = player.units.findIndex(unit => {
            return unit.itemId === focusUnit.itemId &&
                   (utils.isEqualItemId(unit.itemId1, focusUnit.itemId1) &&
                    utils.isEqualItemId(unit.itemId2, focusUnit.itemId2))
          });

          if (buildingRemoveIndex === -1) {
            console.logger("WARNING - Could not find building to cancel: ", focusUnit.itemId);
            player.reduceParseConfidence('Major');
            return;
          }

          const removeBuilding = player.units[buildingRemoveIndex];
          console.logger(player.id, "removing canceled building:", removeBuilding.displayName);

          // Free the cells the building was stamping. Use the saved stamp
          // position rather than current — buildings under construction can
          // shift slightly between addPlayerBuilding and cancel.
          if (removeBuilding._collisionStampPos && player.world.collisionWorld) {
            const stamp = removeBuilding._collisionStampPos;
            player.world.collisionWorld.unstampBuilding(stamp.x, stamp.y, removeBuilding.itemId);
          }

          // remove from player units
          player.units.splice(buildingRemoveIndex, 1);

          // remove from world
          const worldUnits = player.world.playerData[player.id] && player.world.playerData[player.id].units;
          if (worldUnits) {
            const wi = worldUnits.indexOf(removeBuilding);
            if (wi !== -1) worldUnits.splice(wi, 1);
          }

          // retract addBuilding event if one was emitted
          if (removeBuilding._buildEventEmitted) {
            const ei = player.eventStream.findIndex(e =>
              e.key === 'addBuilding' &&
              e.building && e.building.itemId === removeBuilding.itemId &&
              e.building.objectId1 === removeBuilding.objectId1
            );
            if (ei !== -1) {
              const foodMade = (removeBuilding.balanceInfo && removeBuilding.balanceInfo.foodMade) || 0;
              player.supplyMax -= foodMade;
              player.eventStream.splice(ei, 1);
            }
          }
          return;
        }

        // cancel from training queue (removes last queued first, then active)
        const cancelled = focusUnit.cancelQueuedUnit();
        if (!cancelled) {
          console.logger("WARNING - Nothing to remove from building training list?");
          player.reduceParseConfidence('Major');
          return;
        }

        // find and clean up the corresponding player unit
        const cancelledUnit = cancelled.unit;
        if (cancelledUnit) {
          const unitRemoveIndex = player.units.indexOf(cancelledUnit);
          if (unitRemoveIndex !== -1) {
            // undo supply if it was deferred (isTraining units don't add supply, so nothing to undo)
            player.units.splice(unitRemoveIndex, 1);
            console.logger("Removed cancelled training unit: ", cancelledUnit.displayName);

            // remove the addUnit event from eventStream so cancelled units don't appear in build order
            const eventIndex = player.eventStream.findIndex(evt =>
              evt.key === 'addUnit' && evt.unit && evt.unit.uuid === cancelledUnit.uuid
            );
            if (eventIndex !== -1) {
              player.eventStream.splice(eventIndex, 1);
            }

            // decrement hero slot if cancelled unit was a hero
            if (cancelledUnit.meta && cancelledUnit.meta.hero) {
              player.heroSlotCount--;
            }
          }
        } else {
          // fallback: find by itemId match (legacy path)
          const unitRemoveIndex = player.units.findIndex(unit => {
            return unit.itemId === cancelled.itemId &&
                   unit.itemId1 === null &&
                   unit.objectId1 === null;
          });
          if (unitRemoveIndex !== -1) {
            const removedUnit = player.units[unitRemoveIndex];
            player.units.splice(unitRemoveIndex, 1);
            console.logger("Removed cancelled unit (legacy): ", cancelled.itemId);

            // remove the addUnit event from eventStream
            const eventIndex = player.eventStream.findIndex(evt =>
              evt.key === 'addUnit' && evt.unit && evt.unit.itemId === cancelled.itemId
            );
            if (eventIndex !== -1) {
              player.eventStream.splice(eventIndex, 1);
            }

            // decrement hero slot if cancelled unit was a hero
            if (removedUnit && removedUnit.meta && removedUnit.meta.hero) {
              player.heroSlotCount--;
            }
          }
        }
      break;
    }


    const abilityActionName = utils.findItemIdForObject(itemId, abilityActions);

    switch (abilityActionName) {
      case 'NEUpRoot': {
        const gameTime = player.eventTimer.timer.gameTime;
        focusUnit.isUprooted = true;
        // Ancient becomes a mobile unit: free its footprint cells and start
        // participating in dynamic unit-vs-unit collision.
        if (player.world.collisionWorld) {
          const stamp = focusUnit._collisionStampPos;
          if (stamp) {
            player.world.collisionWorld.unstampBuilding(stamp.x, stamp.y, focusUnit.itemId);
          }
          player.world.collisionWorld.addUnit(focusUnit);
        }
        focusUnit.uprootStream.push({
          gameTime,
          isUprooted: true,
          x: focusUnit.currentX,
          y: focusUnit.currentY
        });
        player.addEvent('uproot', {
          building: focusUnit.exportUnitReference()
        });
      }
      break;
      case 'NERoot': {
        const gameTime = player.eventTimer.timer.gameTime;
        focusUnit.isUprooted = false;
        // Re-stamp footprint at the current (possibly new) position. Remove
        // from dynamic tree before re-stamping so building self-stamp doesn't
        // get blocked by its own dynamic entry.
        if (player.world.collisionWorld) {
          player.world.collisionWorld.removeUnit(focusUnit);
          player.world.collisionWorld.stampBuilding(
            focusUnit.currentX, focusUnit.currentY, focusUnit.itemId
          );
          focusUnit._collisionStampPos = { x: focusUnit.currentX, y: focusUnit.currentY };
        }
        focusUnit.recordPosition();
        focusUnit.uprootStream.push({
          gameTime,
          isUprooted: false,
          x: focusUnit.currentX,
          y: focusUnit.currentY
        });
        player.addEvent('root', {
          building: focusUnit.exportUnitReference()
        });
      }
      break;
      default:
        player.reduceParseConfidence('Tiny');
      break;
    }

  }

  static doAbilityNoTargetItemId (
    player,
    focusUnit,
    itemId,
    abilityFlags,
    unknownA,
    unknownB
  ) {
    const unitInfo = mappings.getUnitInfo(itemId);
    switch (abilityFlags) {
      // learn skill
      case abilityFlagNames.LearnSkillOrTrain:
        console.logger(player.id, "Building is training a unit.", unitInfo.displayName);

        // building spawned a unit into world — use rally point if set
        let newUnit = new Unit(player.eventTimer, null, null, itemId, false);
        newUnit.isTraining = true;
        {
          const spawn = pickSpawnPositionForBuilding(focusUnit);
          newUnit.setSpawnPosition(spawn.x, spawn.y);
        }

        // check rally point for worker assignment (deferred until training completes)
        // note: acolytes (uaco) cannot harvest lumber — skip lumber rally for them
        if (isWorkerUnit(newUnit) && newUnit.itemId !== 'uaco') {
          const { rallyPoint } = focusUnit;
          if (rallyPoint && rallyPoint.type === 'unit') {
            const target = player.findUnitByObjectId(rallyPoint.objectId1, rallyPoint.objectId2)
              || player.world.findNeutralByObjectIds(rallyPoint.objectId1, rallyPoint.objectId2);
            newUnit._pendingRole = (target && target.isGoldmine) ? WorkerRole.GOLD : WorkerRole.LUMBER;
          }
        }

        focusUnit.queueUnit(itemId, newUnit);

        console.logger(player.id, "Making trained unit:", newUnit.displayName, itemId);
        player.addPlayerUnit(newUnit);
        player.unregisteredUnitCount++;
      break;

      // Train Units
      case abilityFlagNames.TrainUnit:
        console.logger("training...", unitInfo.displayName);

        if (researchMeta[itemId]) {
          player.addResearch(itemId, focusUnit);
        } else if (unitInfo && (unitInfo.isUnit || unitInfo.isBuilding)) {
          if (unitInfo.isBuilding) {
            // building upgraded itself
            console.logger("**JDEBUG[upgradeBuilding]: Building upgraded itself: ", unitInfo.displayName);
            focusUnit.upgradeBuilding(itemId, player);
          } else if (unitInfo.isUnit) {
            // building spawned a unit into world
            let newUnit = new Unit(player.eventTimer, null, null, itemId, false);

            // NOTE: for some unknown reason, TrainUnit actions
            //       can show up in a replay even when there
            //       was one previously issued - with no actions in between.
            //
            //       heroes are unique units, so we just prevent
            //       the command issued from doing anything,
            //       and wait for an actual CancelTrainOrResearch action

            if (unitInfo.meta.hero) {
              console.logger(1, "Making a hero.");

              const inTraining = focusUnit.trainedUnits.filter(unit => {
                return !unit.completed && unit.itemId === itemId;
              });

              if (inTraining.length) {
                // weird replay quirk that can sometimes happen...
                console.logger(1, "Stopping double hero train.");
                return;
              }

              player.setHeroSlot(newUnit);
            }

            newUnit.isTraining = true;

            {
              const spawn = pickSpawnPositionForBuilding(focusUnit);
              console.logger("New spawn unit position: ", spawn.x, spawn.y);
              newUnit.setSpawnPosition(spawn.x, spawn.y);
            }

            // check rally point for worker assignment (deferred until training completes)
            // note: acolytes (uaco) cannot harvest lumber — skip lumber rally for them
            if (isWorkerUnit(newUnit) && newUnit.itemId !== 'uaco') {
              const { rallyPoint } = focusUnit;
              if (rallyPoint && rallyPoint.type === 'unit') {
                const target = player.findUnitByObjectId(rallyPoint.objectId1, rallyPoint.objectId2)
                  || player.world.findNeutralByObjectIds(rallyPoint.objectId1, rallyPoint.objectId2);
                newUnit._pendingRole = (target && target.isGoldmine) ? WorkerRole.GOLD : WorkerRole.LUMBER;
              }
            }

            focusUnit.queueUnit(itemId, newUnit);

            player.addPlayerUnit(newUnit);
            player.unregisteredUnitCount++;
          }
        }
      break;

      case abilityFlagNames.CancelTrainOrResearch:
        if (unitInfo.isItem) {
          console.logger(player.id, "Hero bought an item: ", unitInfo.displayName);
          console.logger(player.id, "Item objectIds: ", unknownA, unknownB);

          let shopUnit, knownShopUnit;
          let rallyPoint = focusUnit.rallyPoint;

          if (rallyPoint && rallyPoint.type === "unit") {
            // Rally had been set to a specific unit, give the item directly.
            shopUnit = player.findUnitByObjectId(rallyPoint.objectId1, rallyPoint.objectId2);
            knownShopUnit = !!shopUnit;
          }

          // Fallback (rally was ground / no rally / rally pointed to a unit
          // that isn't a registered hero — e.g. a worker the player rallied
          // to before training their hero): find the closest hero. Without
          // this fallback, salve / dust / stim buys from a player shop with
          // a stale rally point are silently dropped.
          if (!shopUnit) {
            console.logger(player.id, "No known unit to give item to, try to find closest hero.");
            console.logger(player.id, "Shop position: ", focusUnit.currentX, focusUnit.currentY);

            const heroes = player.units.filter(unit => {
              return unit.meta && unit.meta.hero;
            });

            shopUnit = utils.closestToPoint(
              focusUnit.currentX,
              focusUnit.currentY,
              heroes
            );

            knownShopUnit = false;
          }

          if (shopUnit) {
            let shopBuilding;
            if (player.neutralShopSelected) {
              // doAbilityNoTargetItemId is a static method — `this` resolves
              // to the class, not an instance, so use player.world (the
              // pre-existing `this.world` bug silently broke every neutral-
              // shop buy before Phase 1 made the path actually reachable).
              const shopRef = player.world && player.world.getNeutralShop(player.neutralShop);
              if (shopRef) {
                let neutralUnit = null;
                if (player.world.findNeutralByObjectIds) {
                  neutralUnit = player.world.findNeutralByObjectIds(
                    shopRef.objectId1, shopRef.objectId2);
                }
                if (!neutralUnit && player.world.playerData) {
                  const neutralPlayer = player.world.playerData[mappings.NEUTRAL_PLAYER_ID];
                  if (neutralPlayer && Array.isArray(neutralPlayer.units)) {
                    neutralUnit = neutralPlayer.units.find(u =>
                      u.itemId === shopRef.itemId && u.currentX != null);
                  }
                }
                shopBuilding = neutralUnit || focusUnit;
              } else {
                shopBuilding = focusUnit;
              }
              if (!shopBuilding) {
                console.logger("WARNING - couldn't find neutral shop: ", player.neutralShop);
                player.reduceParseConfidence('Major');
                return;
              }
            } else {
              shopBuilding = focusUnit;
            }

            if (!shopBuilding || !shopBuilding.buyStockItem) {
              console.logger("CRITICAL - unable to find shop building to buy stock item."); 
              player.reduceParseConfidence('Critical');

              return;
            }

            const boughtItem = shopBuilding.buyStockItem(itemId);
            if (boughtItem) {
              console.logger(player.id, `Giving item ${unitInfo.displayName} to ${shopUnit.displayName}`);
              player.giveItem(shopUnit, itemId, knownShopUnit);

              const itemData = itemAbilityData[itemId];
              const shopName = shopBuilding.displayName;
              const heroName = shopUnit.displayName;
              const confidence = knownShopUnit ? 'high' : 'low';
              player.addEvent('itemPurchase', {
                item: { itemId, displayName: unitInfo.displayName },
                unit: shopUnit.exportUnitReference(),
                shop: shopName,
                shopItemId: shopBuilding.itemId,
                isNeutralShop: !!player.neutralShopSelected,
                goldCost: (itemData && itemData.goldCost) || 0,
                confidence,
                source: 'shop-known',
                actionText: `${heroName} buys ${unitInfo.displayName} from ${shopName}`
              });
            }
          } else {
            console.logger("WARNING - could not find shop unit to give item to.");
            player.reduceParseConfidence('Major');
          }
        
          return;
        }


        if (!focusUnit || !focusUnit.upgradeBuilding) {
          console.logger("WARNING - no focus unit to upgrade building for");
          player.reduceParseConfidence('Major');

          return;
        }
        
        focusUnit.upgradeBuilding(itemId, player);  
        console.logger(
          player.id, 
          "Building researched upgrade: ", 
          focusUnit.displayName,
          unitInfo.displayName
        );
        
      break;

      default:
        console.logger("No match for hero ability flag");
        console.logger("Hero name: ", focusUnit.displayName);
        console.logger("Unit info for itemId: ", unitInfo);

        player.reduceParseConfidence('Minor');
      break;
    }
  }

  exportUnit () {
    const base = super.exportUnit();
    // _pathingEntry is set by Player.addPlayerBuilding via CollisionWorld.
    // Initial-spawn buildings (town hall) skip stamping but still need
    // a footprint for the client — pull it directly from the manifest.
    let entry = this._pathingEntry;
    if (!entry) {
      const manifest = require('../helpers/buildingPathing.json');
      entry = manifest.buildings[this.itemId];
      if (!entry) {
        // Soft-fail: some single-player / scenario maps include neutral
        // unit IDs (e.g. `nbld` bandit lord) the mappings classify as
        // buildings without a pathing entry. Skip the footprint rather
        // than crash — the client renders these as a 1×1 placeholder.
        // The strict error stayed in place for normal melee buildings
        // via the require() at registration time.
        console.logger && console.logger(
          'Building.exportUnit: no pathing manifest entry for ' + this.itemId +
          ' (skipping footprint, treating as neutral/scenario)');
        entry = null;
      }
    }
    // Entry→footprint mapping shared with Unit.exportUnit (which handles
    // neutral buildings — fountains, goldmines, shops).
    base.footprint = Unit.footprintFromPathingEntry(entry);
    // Razed-building verdict (lib/RazedBuildingInference.js) — client-facing.
    if (this.razedState) base.razedState = this.razedState;
    return base;
  }
};

module.exports = Building;
