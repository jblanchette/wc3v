const utils = require("../helpers/utils"),
      mappings = require("../helpers/mappings");

const Unit = require("./Unit");

const { 
  abilityActions,
  abilityFlagNames,
  mapStartPositions,
  specialBuildings,
  itemAbilityData
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

    this.itemStock = {};
    this.shopItemsSet = {};
    this.shopItemCooldowns = {};
  }

  startConstruction () {
    this.buildState = BuildingStates.building;
  }

  buildOnTick (gameTime, delta) {

  }

  buildOnComplete () {
    
  }

  upgradeBuilding (newItemId) {
    const self = this;

    const onBuildingTick = (gameTime, delta)  => {
      //console.logger("building tick.", self.displayName);
    };

    const onBuildingComplete = (eventFinished) => {
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
    return (fixedItemId === specialBuildings.tavern);
  }

  static isNeutralShop (fixedItemId) {
    return (fixedItemId === specialBuildings.neutralShop);
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
    switch (abilityFlags) {
      case abilityFlagNames.CancelTrainOrResearch:
        // TODO: support a backlog queue of trained units
        //       we probably just need to remove the 'last added'
        //       from list for most cases

        if (!focusUnit.trainedUnits.length) {               
          // buildings that have no record of training a unit
          // should mean this building canceled itself while
          // it was being made.

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
          console.logger(player.id, "WARNING - would be removing canceled building: ", removeBuilding.displayName);
          player.reduceParseConfidence('Major');

          return;
        }

        const removeIndex = focusUnit.trainedUnits.findIndex(unit => {
          return !unit.completed;
        });
        const removeItem = focusUnit.trainedUnits[removeIndex];

        if (!removeItem) {
          console.logger("WARNING - Nothing to remove from building training list?");
          player.reduceParseConfidence('Major');
          return;
        }

        const unitRemoveIndex = player.units.findIndex(unit => {
          return unit.itemId === removeItem.itemId &&
                 unit.itemId1 === null &&
                 unit.objectId1 === null;
        });

        if (unitRemoveIndex === -1) {
          // note: this is okay sometimes it seems.
          return;
        }

        const removeUnit = player.units[unitRemoveIndex];
        console.logger("WARNING: should remove some non-finished unit: ", removeUnit.displayName);
        player.reduceParseConfidence('Major');
      break;
    }


    const abilityActionName = utils.findItemIdForObject(itemId, abilityActions);

    switch (abilityActionName) {
      case 'NEUpRoot':
        focusUnit.isUprooted = true;
      break;
      case 'NERoot':
        focusUnit.isUprooted = false;
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

        // building spawned a unit into world
        let newUnit = new Unit(player.eventTimer, null, null, itemId, false);
        focusUnit.trainedUnits.push({
          itemId: itemId,
          completed: false
        });

        // todo: make spawned unit move to rally point
        newUnit.setSpawnPosition(focusUnit.currentX, focusUnit.currentY);

        console.logger(player.id, "Making trained unit:", newUnit.displayName, itemId); 
        player.addPlayerUnit(newUnit);
        player.unregisteredUnitCount++;
      break;

      // Train Units
      case abilityFlagNames.TrainUnit:
        if (unitInfo && unitInfo.isUnit) {
          if (unitInfo.isBuilding) {
            // building upgraded itself

            console.logger("Building upgraded itself: ", unitInfo.displayName);
            focusUnit.upgradeBuilding(itemId);
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

            focusUnit.trainedUnits.push({
              itemId: itemId,
              completed: false
            });

            // todo: make spawned unit move to rally point
            newUnit.setSpawnPosition(focusUnit.currentX, focusUnit.currentY);
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
            // rally had been set to this unit, give it directly        
            shopUnit = player.findUnitByObjectId(rallyPoint.objectId1, rallyPoint.objectId2);
            knownShopUnit = true;
          } else {
            console.logger(player.id, "No known unit to give item to, try to find closest hero.");
            console.logger(player.id, "Shop position: ", focusUnit.currentX, focusUnit.currentY);

            // find closest hero to give shop item to, probably
            // todo: not accurate and might cause bugs

            const heroes = player.units.filter(unit => {
              return unit.meta.hero;
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
              shopBuilding = this.world.getNeutralShop(player.neutralShop);

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
            }
          } else {
            console.logger("WARNING - could not find shop unit to give item to.");
            player.reduceParseConfidence('Major');
          }
        } else {
          if (!focusUnit || !focusUnit.upgradeBuilding) {
            console.logger("WARNING - no focus unit to upgrade building for");
            player.reduceParseConfidence('Major');

            return;
          }
          
          focusUnit.upgradeBuilding(itemId);  
          console.logger(
            player.id, 
            "Building researched upgrade: ", 
            focusUnit.displayName,
            unitInfo.displayName
          );
        }
      break;

      default:
        console.logger("No match for hero ability flag");
        console.logger("Hero name: ", focusUnit.displayName);
        console.logger("Unit info for itemId: ", unitInfo);

        player.reduceParseConfidence('Minor');
      break;
    }
  }
};

module.exports = Building;
