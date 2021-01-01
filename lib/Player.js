const utils = require("../helpers/utils"),
      mappings = require("../helpers/mappings");

const { 
  abilityActions,
  abilityFlagNames,
  mapStartPositions,
  specialBuildings,
  buildingUpgrades
} = mappings;

const Unit = require("./Unit"),
      Hero = require("./Hero"),
      Building = require("./Building"),
      Item = require("./Item"),
      SubGroup = require("./SubGroup"),
      PlayerActions = require("./PlayerActions");

const SelectModes = {
  select: 1,
  deselect: 2
};

const Player = class {
  constructor (id, playerSlot, gameData, eventTimer, world) {
    this.id = id;
    this.gameData = gameData;
    this.playerSlot = playerSlot;
    this.teamId = playerSlot.teamId;
    this.race = utils.getRaceFromFlag(playerSlot.raceFlag);

    this.eventTimer = eventTimer;
    this.world = world;

    this.units = [];

    this.removedBuildings = [];

    this.startingPosition = null;
    this.updatingSubgroup = false;
    this.lastChangeGroupTime = null;
    this.selection = null;
    this.lastSelectedGroupNumber = null;
    this.groupSelections = {};

    this.heroSlotCount = 0;

    this.buildMenuOpen = false;

    this.tavernSelected = false;
    this.neutralShopSelected = false;
    this.neutralShop = {
      itemId: null,
      objectId1: null,
      objectId2: null
    };

    this.itemMoveSelected = false;
    this.itemMoveObject = null;

    this.possibleRegisterItem = null;
    this.possibleSelectList = [];

    this.possiblyDeadUnits = [];

    this.knownObjectIds = {
      'worker': null,
      'townhall': null
    };

    // export event data for viewing clients
    this.eventStream = [];
    
    // group selection export data for viewing clients
    this.lastSelectionId = null;
    this.selectionStream = [];
    this.groupStream = [];

    // special tracker flag denoting how 'confidient' we are
    // that this player was parsed correctly

    this.parseConfidence = 1;
  }

  setupInitialUnits () {
    const starterMap = {
      'O': {
        'townHallId': 'ogre',
        'workerCount': 5
      },
      'H': {
        'townHallId': 'htow',
        'workerCount': 5
      },
      'E': {
        'townHallId': 'etol',
        'workerCount': 5
      },
      'U': {
        'townHallId': 'unpl',
        'workerCount': 3,
        'workerSpecial': 'ugho'
      }
    };

    if (!starterMap[this.race]) {
      // person is random
      return;
    }

    const { townHallId, workerCount, workerSpecial } = starterMap[this.race];

    // add the town hall
    const townhall = new Building(
      this.eventTimer,
      null,
      null,
      townHallId,
      true
    );

    this.addPlayerBuilding(townhall);

    // add the workers
    for (let i = 0; i < workerCount; i++) {
      const worker = new Unit(this.eventTimer, null, null, mappings.workerForRace[this.race], true);

      this.addPlayerUnit(worker);
    }

    // workers + 1 town hall
    this.unregisteredUnitCount = (workerCount + 1);

    // some races have a 'special' other unit, like Undead ghoul
    if (workerSpecial) {
      const specialUnit = new Unit(this.eventTimer, null, null, workerSpecial, true);

      this.addPlayerUnit(specialUnit);
      this.unregisteredUnitCount += 1;
    }
  }

  addEvent (key, item) {
    const eventItem = {
      key,
      gameTime: this.eventTimer.timer.gameTime,
      ...item
    };

    this.eventStream.push(eventItem);
  }

  recordSelection () {
    const { selection } = this;
    if (this.lastSelectionId === selection.groupId) {
      return;
    }

    this.lastSelectionId = selection.groupId;
    const selectionItem = {
      selection: selection.exportReference(),
      gameTime: this.eventTimer.timer.gameTime
    };

    this.selectionStream.push(selectionItem);
  }

  recordGroups () {
    const groupData = Object.keys(this.groupSelections).reduce((acc, groupNumber) => {
      const selection = this.groupSelections[groupNumber];
      const item = {
        groupNumber,
        selection: selection.exportReference()
      };
      
      acc[groupNumber] = item;
      return acc;
    }, {});

    const { lastSelectedGroupNumber } = this;
    const groupItem = {
      lastSelectedGroupNumber,
      gameTime: this.eventTimer.timer.gameTime,
      groups: groupData
    };
    
    this.groupStream.push(groupItem);
  }

  reduceParseConfidence (amountType) {
    let amount;

    switch (amountType) {
      case 'Critical':
        amount = 0.005;
      break;
      case 'Major':
        amount = 0.0025;
      break;
      case 'Minor':
        amount = 0.0010;
      break;
      case 'Tiny':
        amount = 0.00025;
      break;
      default:
        amount = 0.00001;
      break;
    }

    this.parseConfidence -= amount;
    console.logger(`WARNING - reducing parseconfidence by ${amount} - now at ${this.parseConfidence}`);
  }

  //
  // Unit snapshots are used when trying to determine which summoned unit
  // should be destroyed when the unit hasn't been fully registered.
  // One is taken when a summoned unit is created and compared to at death.
  //
  getUnitSnapshot () {
    const unitList = this.units.map(unit => {
      const { itemId1, itemId2, isRegistered, spawnTime } = unit;

      if (itemId1 && itemId2) {
        return { 
          itemId1, 
          itemId2,
          spawnTime,
          isRegistered: isRegistered || (this.findUnit(itemId1, itemId2) ? true : false)
        };
      }

      return null;
    }).filter(unit => { return unit !== null; });

    const cleanPossibleList = this.possibleSelectList.map(punit => {
      const { itemId1, itemId2, spawnTime } = punit;
      return { itemId1, itemId2, spawnTime, isRegistered: false };
    });

    return {
      units: Array.from(unitList.concat(cleanPossibleList))
    };
  }

  //
  // Ensure a group has valid unit types, wc3 doesn't allow building / non-building mixes
  // but replay files sometimes have invalid units in groups (wc3 probably also ignores them)
  //
  ensureValidGroup (oldGroup, group) {
    const self = this;
    if (!group.length) {
      return [];
    }

    const firstGroupItem = group[0];
    const firstGroupUnit = this.findUnit(firstGroupItem.itemId1, firstGroupItem.itemId2);

    if (!firstGroupUnit || !firstGroupUnit.isRegistered) {
      return group;
    }

    const oldFirstItem = oldGroup[0];
    const oldFirstUnit = oldFirstItem && this.findUnit(oldFirstItem.itemId1, oldFirstItem.itemId2);

    let groupType;
    if (oldFirstUnit) {
      // get the groupType from the old selection
      groupType = (oldFirstUnit.isBuilding && !oldFirstUnit.isUprooted) ? 0 : 1;
    } else {
      // get the group type from new selection
      groupType = (firstGroupUnit.isBuilding && !firstGroupUnit.isUprooted) ? 0 : 1;
    }

    return group.filter(groupItem => {
      const { itemId1, itemId2 } = groupItem;
      const groupUnit = self.findUnit(itemId1, itemId2);

      if (groupUnit) {
        const checkType = (groupUnit.isBuilding && !groupUnit.isUprooted) ? 0 : 1;
        if (checkType !== groupType) {
          console.logger("removing unit of different type from group: ", groupItem);
        }

        if (checkType !== groupType) {
          return false; // filter this unit out
        }
      }

      return true;
    });
  }

  //
  // find the first instance of an unregistered unit from the players selection
  //
  getFirstUnregisteredUnitFromSelection () {
    return this.selection.units.find(unit => {
      return !this.findUnit(unit.itemId1, unit.itemId2);
    });
  }

  //
  // Wc3 itemIds start with the letter of the race,
  // which can sometimes be N for neutral
  //
  isPlayersRace (itemId) {
    let firstItemIdLetter = itemId[0].toUpperCase();

    return firstItemIdLetter === this.race;
  }

  //
  // find a players unit by itemId1-2 pair
  //
  findUnit (itemId1, itemId2) {
    const searchUnit = {
      itemId1: itemId1,
      itemId2: itemId2
    };

    const unitCheck = (unit) => {
      return utils.isEqualUnitItemId(unit, searchUnit);
    };

    // do error checking
    const dupeCheckList = this.units.filter(unitCheck);
    if (dupeCheckList.length > 1 && itemId1 !== null) {
      console.logger("error - found multiple units with same itemId1-2", itemId1, itemId2, dupeCheckList.length);
      console.logger(dupeCheckList.forEach(unit => { unit.printUnit(); }));

      let keeperUnit = false;

      console.logger("units before filter: ", this.units.length);
      this.units = this.units.filter(unit => {
        if (utils.isEqualUnitItemId(unit, searchUnit)) {
          if (!keeperUnit) {
            keeperUnit = true;

            return true;
          } else {
            return false;
          }
        }
        
        return true;
      });

      console.logger("bad units filtered out");
      this.reduceParseConfidence('Minor');
    }

    return this.units.find(unitCheck);
  }

  //
  // find a players unit by objectId1-2 pair
  //
  findUnitByObjectId (objectId1, objectId2) {
    const dupeCheckList = this.units.filter(unit => {
      return unit.objectId1 === objectId1 &&
             unit.objectId2 === objectId2;
    });

    if (dupeCheckList.length > 1) {
      console.logger("error - found multiple units with same objectId1-2");
      console.logger(dupeCheckList.forEach(unit => { unit.printUnit(); }));
      //throw new Error("bad unit find by objectid");
    }

    return this.units.find(unit => {
      return unit.objectId1 === objectId1 &&
             unit.objectId2 === objectId2;
    });
  }

  //
  // find first player unit by itemId
  //
  findUnitByItemId (fixedItemId) {
    return this.units.find(unit => {
      return unit.itemId === fixedItemId;
    });
  }

  //
  // find first unregistered player unit
  //
  findUnregisteredUnit () {
    return this.units.find(unit => {
      return unit.objectId1 === null;
    });
  }

  //
  // find first unregistered player unit
  //
  findUnregisteredBuilding () {
    return this.units.find(unit => {
      return unit.isBuilding && unit.itemId1 == null;
    });
  }

  //
  // find first unregistered player unit by itemId
  // also checks against possible unit evolutions
  //
  findUnregisteredUnitByItemId (itemId) {
    const unitInfo = mappings.getUnitInfo(itemId);
    console.logger("findUnreg by itemId:", itemId, unitInfo);

    return this.units.find(unit => {
      const unitInfo = mappings.getUnitInfo(unit.itemId);
      const match = unit.itemId === itemId &&
             (unit.itemId1 === null || unit.objectId1 === null);

      if (!match && unitInfo.meta.evolution) {
        const { meta } = unitInfo;
        const evolutionItemId = meta.evolution.itemId;

        return itemId === evolutionItemId &&
              (unit.itemId1 === null || unit.objectId2 === null);
      }

      return match;
    });
  }

  //
  // find first unregistered player unit by itemId1-2 pair
  //
  findUnregisteredUnitByItemIds (itemId1, itemId2) {
    return this.units.find(unit => {
      return utils.isEqualItemId(unit.itemId1, itemId1) && 
             utils.isEqualItemId(unit.itemId2, unit.itemId2) &&
             unit.objectId1 === null;
    });
  }

  // 
  // get all units of a given itemId
  //
  getUnitsByItemId (itemId) {
    return this.units.filter(unit => {
      return unit.itemId === itemId;
    });
  }

  //
  // get unregistered units from the players selection
  //
  getUnknownSelectionUnits () {
    return this.selection.units.filter(unit => {
      const { itemId1, itemId2 } = unit;
      return !this.findUnit(itemId1, itemId2);
    });
  }

  //
  // Add a player unit
  //
  addPlayerUnit (unit) {
    // error checking
    if (unit.itemId1 && unit.itemId2) {
      const hasItemIdPair = this.units.find(sunit => {
        return utils.isEqualUnitItemId(sunit, unit);
      });

      if (hasItemIdPair) {
        console.logger("found unit with existing itemId pair");
        hasItemIdPair.printUnit();

        throw new Error("bad unit item id");
      }
    }

    // todo: move this to Hero or something
    // assign a heroes spells
    unit.spellList = unit.meta.hero 
      ? Hero.getAbilitiesForHero(unit.itemId) : null;
    

    // add the unit to the player and the world
    this.units.push(unit);
    this.world.addPlayerUnit(this.id, unit);


  }

  //
  // Add a player building
  //
  addPlayerBuilding (unit) {
    // error checking
    let existingBuilding = this.units.find(playerUnit => {
      return playerUnit.isBuilding &&            
             playerUnit.currentX === unit.currentX &&
             playerUnit.currentY === unit.currentY;
    });

    if (!Building.isTavern(unit.itemId) && existingBuilding) {
      console.logger("!! found existing building already.");
      console.logger(existingBuilding.displayName);

      // TODO: figure out what to do here - maybe the building died and got re-built?
    }

    // add the building to the player and the world
    this.units.push(unit);
    this.world.addPlayerUnit(this.id, unit);
  }

  //
  // gives an item to a unit
  //
  giveItem (unit, itemId, knownOwner = true, isSpawnedAtStart = false, itemSlot = null) {
    const itemSlotId = itemSlot ? itemSlot : unit.getNextItemSlot();    

    // safety check
    unit.checkDestroyed();

    const newItem = new Item(unit.eventTimer, null, null, itemId, isSpawnedAtStart);
    newItem.knownOwner = knownOwner;
    newItem.itemSlotId = itemSlotId;
    unit.items[itemSlotId] = newItem;

    console.logger(`put hero ${unit.displayName} item ${newItem.displayName} in slot ${itemSlotId}`);

    return newItem;
  }

  //
  // remove a player building.  used for unsummon building
  //
  removePlayerBuilding (unit) {
    let isRegistered = false;

    const { 
      currentX,
      currentY
    } = unit;

    console.logger("Trying to remove building: ", unit.displayName);
    let removeIndex = this.units.findIndex(removeUnit => {
      return removeUnit.currentX === currentX &&
             removeUnit.currentY === currentY;
    });

    const removedBuilding = this.units[removeIndex];
    if (removedBuilding) {
      console.logger("removing building. index: ", removeIndex);
      console.logger("units before: ", this.units.map(unit => unit.displayName));
      this.removedBuildings.push(removedBuilding);
      this.units.splice(removeIndex, 1);
      console.logger("units after: ", this.units.map(unit => unit.displayName));
    }
  }

  //
  // get the units in a players selection that are known.
  // optionally we can get only unregistered units in the selction
  //
  getSelectionUnits (onlyUnregistered = false) {
    const self = this;
    if (!this.selection) {
      console.logger("no selection, return empty");
      return [];
    }

    return this.selection.units.reduce((acc, unitItem) => {
      const { itemId1, itemId2 } = unitItem;
      const unit = self.findUnit(itemId1, itemId2);

      if (!onlyUnregistered && unit) {
        // acc the registered Unit
        acc.push(unit);
      } else if (onlyUnregistered) {
        // acc the raw { itemId1, itemId2 }
        acc.push(unitItem);
      }

      return acc;
    }, []);
  }

  //
  // get the currently selected unit from a players seleciton
  // based on the tracked selectionIndex 
  //
  getSelectedUnit () {
    const { selectionIndex } = this.selection;
    const rawUnit = this.selection.units[selectionIndex];

    console.logger("getting selection unit: ", selectionIndex, rawUnit);

    if (!rawUnit) {
      console.logger("raw selection: ", this.selection.units);
      console.logger("WARNING - unable to find unit at selection index");

      return null;
    }

    const { itemId1, itemId2 } = rawUnit;
    return this.findUnit(itemId1, itemId2) || null;
  }

  //
  // ActionBlock method
  // auto-generated by the game during selection update events
  // used by engine to infer information about same-block updates.
  //
  updateSubgroup (action) {
    // auto-gen war3 message was triggered
    this.updatingSubgroup = true;

    // sort of hack to see if we can avoid sameblock detection problems
    this.lastChangeGroupTime = null;
    this.recordSelection();
  }

  //
  // routine to update worker and townhall units known object ids
  // as they become known.
  //
  assignKnownUnits () {
    let self = this;
    let knownObjectIds = this.knownObjectIds;

    const shouldCheckAssignments = Object.keys(knownObjectIds).some(key => {
      return knownObjectIds[key] === null;
    });

    if (!shouldCheckAssignments) {
      return;
    }

    this.units.forEach(unit => {
      if (!unit.isSpawnedAtStart || unit.objectId1 === null) {
        return;
      }

      if (!knownObjectIds.worker && unit.meta.worker) {
        knownObjectIds.worker = unit.objectId1;
      } else if (!knownObjectIds.townhall && unit.isBuilding) {
        knownObjectIds.townhall = unit.objectId1;
      }
    });
  }

  //
  // helper routine to try and guess an object type based on knownObjectIds
  //
  guessUnitType (objectId) {
    const knownObjectIds = this.knownObjectIds;
    const threshold = 6;

    let bestGuess = Object.keys(knownObjectIds).find(key => {
      const knownId = knownObjectIds[key];
      if (knownId === null) {
        return false;
      }

      return Math.abs(knownId - objectId) <= threshold;
    });

    return bestGuess || null;
  }

  //
  // helper routine to set the hero slot and 
  // mutate the hero unit setting its known slot.
  // wc3 allows players up to 3 heroes, the first is given a TP scroll
  //
  setHeroSlot (heroUnit) {
    this.heroSlotCount++;
    
    const nextHeroSlot = this.heroSlotCount;
    heroUnit.heroSlot = nextHeroSlot;

    if (nextHeroSlot === 1) {
      console.logger(this.id, "Gave first hero a TP item.");
      this.giveItem(heroUnit, 'stwp', true, true);
    }

    return heroUnit;
  }

  //
  // clear our units that have become registered from possibleSelectList
  //
  clearKnownPossibleUnits () {
    this.possibleSelectList = this.possibleSelectList.filter(unit => {
      return !this.findUnit(unit.itemId1, unit.itemId1);
    });
  }

  //
  // Called during `selectSubgroup` when unregistered units
  // are known to exist.  The `itemId` is only known for
  // one unit - the first in the selection group.  So
  // we limit the amount of registerable units to 1
  //
  // important note - selection groups are not sorted
  // in such a way that the SelectSubgroup action unit
  // will always be first in the group
  //
  assignPossibleSelectGroup (itemId, objectId1, objectId2) {
    let self = this;
    let doneSearching = false;

    const { selectionIndex, units } = this.selection;

    const knownUnitByObjectIds = this.findUnitByObjectId(objectId1, objectId2);
    if (knownUnitByObjectIds && knownUnitByObjectIds.isRegistered) {
      return null;
    }

    // see if we have a potential matching unit of itemId1-2
    // pair _without_ an object1-2 pair.

    const potentialUnregisteredSelectionUnits = units.filter(selectionUnit => {
      const { itemId1, itemId2 } = selectionUnit;
      const unit = self.findUnit(itemId1, itemId2);

      if (!unit) {
        return false;
      }

      return unit.itemId === itemId &&
        unit.objectId1 === null &&
        unit.objectId2 === null;
    });

    if (potentialUnregisteredSelectionUnits.length === 1) {
      const potentialUnit = potentialUnregisteredSelectionUnits[0];
      const punit = this.findUnit(potentialUnit.itemId1, potentialUnit.itemId2);

      if (punit) {
        //
        // we found a potential unit, check backfill + register itemId1-2 pair
        //
        const { itemId1, itemId2 } = potentialUnit;
        const backfillData = this.possibleSelectList.find(psUnit => {
          return utils.isEqualItemId(psUnit, potentialUnit);
        });

        if (backfillData) {
          punit.performBackfill(backfillData.backfill); 
        }
        
        punit.registerItemIds(itemId1, itemId2);
        self.unregisteredUnitCount--;

        // return back our found unit
        return punit;
      }
    }
    
    let foundPlayerUnit;
    const selectionUnit = units[selectionIndex];

    // remove already known units from possible list
    this.clearKnownPossibleUnits();

    //
    // find an unregistered unit in the possibleSelectList that
    // matches the itemId1-2 pair of our selectionUnit,
    //
    self.possibleSelectList.find(selectItem => {
      if (utils.isEqualUnitItemId(selectItem, selectionUnit)) {
        foundPlayerUnit = self.units.find(playerUnit => {
          return playerUnit.itemId === itemId && // same unit as selection
                 playerUnit.itemId1 === null;
        });

        if (foundPlayerUnit) {
          const { itemId1, itemId2, backfill } = selectItem;

          // make sure we don't already know about this unit
          if (this.findUnit(itemId1, itemId2)) {
            // reset our search results
            foundPlayerUnit = null;
            return false;
          }
          
          // we found a unit to register, check backfill
          foundPlayerUnit.performBackfill(backfill);
          foundPlayerUnit.registerItemIds(itemId1, itemId2);

          // end our search
          return true;
        }
      }

      // keep searching
      return false;
    });

    return foundPlayerUnit || null;
  }

  //
  // perform initial checks in selectSubgroup action
  // to see if we should early out before handling it
  // due to tavern, shop, or other player unit checks
  //
  checkForSelectSubgroupEarlyExit (action) {
    const self = this;
    const { itemId, objectId1, objectId2 } = action;
    const fixedItemId = utils.fixItemId(itemId);

    // special tavern edge case
    if (Building.isTavern(fixedItemId)) {
      this.tavernSelected = true;
      this.selection.clearGroup();

      return true; // do nothing for neutral building
    } else if (this.tavernSelected) {
      this.tavernSelected = false;
    }

    if (Building.isNeutralShop(fixedItemId)) {
      this.neutralShopSelected = true;
      this.selection.clearGroup();

      // add neutral shop ref
      this.world.addNeutralShop(fixedItemId, objectId1, objectId2);
      return true;
    } else if (this.neutralShopSelected) {
      this.neutralShopSelected = false;
    }

    if (this.world.findKnownUnitByItemAndObjectId(
      this.id,
      fixedItemId, 
      objectId1, 
      objectId2)
    ) {
      
      // clicked on another players unit, return out
      return true;
    }

    if (!this.isPlayersRace(fixedItemId) && 
        !this.findUnitByItemId(fixedItemId) && 
        !this.tavernSelected) {

      // player clicked on a unit from a race not their own,
      // exit out
      
      return true;
    }

    return false;
  }

  //
  // ActionBlock method
  // select or deselect a subgroup. registers units when possible.
  //
  // method performs additional side-effects:
  //  * toggle tavern / neutral shop flag
  //  * re-initialize players of Random race after detection

  selectSubgroup (action) {
    const self = this;
    const { itemId, objectId1, objectId2 } = action;
    const fixedItemId = utils.fixItemId(itemId);

    // check if we haven't detected a random players race yet
    if (this.race === "R") {
      console.logger("detected a random race for player:", this.playerId, this.race);
      this.race = fixedItemId.substring(0, 1).toUpperCase();
      console.logger(`random race detected, setting to ${this.race}`);

      // redo the initial setup
      this.setupInitialUnits();
    }

    const shouldEarlyExit = this.checkForSelectSubgroupEarlyExit(action);
    if (shouldEarlyExit) {
      return;
    }

    let firstGroupItem = this.selection.units[0];
    if (!firstGroupItem) {
      const focusUnit = this.findUnitByObjectId(objectId1, objectId2);

      if (focusUnit) {
        // do a kind of hacky thing - 
        // where we detect that our selection group was empty,
        // but we found a unit registered with the objectId1-2 pair.
        // switch to that focus unit artifically

        this.reduceParseConfidence('Minor');

        console.logger("WARNING - swapping selection for found focus unit: ", focusUnit.displayName);
        this.selection.clearGroup();
        this.selection.addUnit(focusUnit.itemId1, focusUnit.itemId2);
        firstGroupItem = this.selection.units[0];
      }
    }

    if (!firstGroupItem) {
      console.logger("WARNING - Player.selectSubgroup: unable to find firstGroupItem");
      this.printSelectionUnits();
      this.printUnits();

      // for some reason there was no unit in the selection unit list
      // mark a Major parse confidence reduction.

      this.reduceParseConfidence('Major');
      return;
    }

    const {itemId1, itemId2} = firstGroupItem;

    const { numberUnits, units } = this.selection;
    const unknownUnits = units.filter(unit => {
      const { itemId1, itemId2 } = unit;
      return !this.findUnit(itemId1, itemId2);
    });
    
    // run assignPossibleSelectGroup and see if we've got a fresh registered unit
    const newlyRegisteredUnit = this.assignPossibleSelectGroup(fixedItemId, objectId1, objectId2);  
    
    // see if we have a known unit for the first selection item
    const firstGroupUnit = this.findUnit(itemId1, itemId2);
    // see if we have a known unit for the action objectId1-2 pair
    const knownUnitByObjectIds = this.findUnitByObjectId(objectId1, objectId2);

    // precondition for an early exit: first unit is equal to by objectId-12 of action
    if (firstGroupUnit && 
        knownUnitByObjectIds &&
        firstGroupUnit.uuid === knownUnitByObjectIds.uuid) {
      
      // see if this known unit has evolved, upgraded, or morphed
      if (fixedItemId !== firstGroupUnit.itemId) {
        // update the units itemId reference since we're confident about it
        firstGroupUnit.itemId = fixedItemId;
      }

      // we're confident our selected unit is the first in the group
      this.selection.setSelectionIndex(0);
      return;
    }

    // could not find registered unit by itemId1-2
    // we didn't register any new units from possible select group
    if (!firstGroupUnit && !knownUnitByObjectIds && !newlyRegisteredUnit) {
      PlayerActions.selectSubGroupWithNoKnowns(
        this,
        fixedItemId,
        itemId1, 
        itemId2,
        objectId1,
        objectId2
      );
    } else {
      
      // see if we missed the unit because it was a building that upgraded
      const hasBuildingUpgrade = firstGroupUnit && buildingUpgrades[firstGroupUnit.itemId];
      if (hasBuildingUpgrade && hasBuildingUpgrade === fixedItemId) {
        firstGroupUnit.itemId = fixedItemId;
        return;
      }

      const notSameFirstUnitCheck = firstGroupUnit && fixedItemId !== firstGroupUnit.itemId;
      const objectMismatchCheck = firstGroupUnit && firstGroupUnit.objectId1 &&
        (firstGroupUnit.objectId1 !== objectId1 || firstGroupUnit.objectId2 !== objectId2) &&
        (firstGroupUnit.objectId1 !== null);

      // checks if the unit object is in our selection group
      const objectInGroup = !firstGroupUnit && this.selection.units.find(sUnit => {
        return self.findUnit(sUnit.itemId1, sUnit.itemId2);
      });

      // some units can 'evolve' - changing their `itemId` property
      // e.g peasant <-> militia
      const unitHasEvolution = firstGroupUnit && firstGroupUnit.evolution && 
        firstGroupUnit.evolution.itemId === fixedItemId;

      if (knownUnitByObjectIds || (!unitHasEvolution && 
        (notSameFirstUnitCheck || objectMismatchCheck || objectInGroup))
      ) {

        if (knownUnitByObjectIds && !knownUnitByObjectIds.meta.hero) {
          if (knownUnitByObjectIds.itemId1 !== null && 
             !utils.isUnitInList(this.selection.units, knownUnitByObjectIds)) {
            if (utils.isUnitInList(this.possiblyDeadUnits, knownUnitByObjectIds)) {
              //
              // we have a known unit by this objectId1-2 pair but for whatever
              // reason that unit's itemId1-2 pair isn't in our current selection.
              // if that unit lands in our possibleDeadUnit list, unregister them
              // and mark a Major confidence reduction
              //
              this.reduceParseConfidence('Major');

              console.logger("WARNING - unregistering unit due to possiblyDeadUnits hit.");
              knownUnitByObjectIds.printUnit();

              knownUnitByObjectIds.unregisterObjectIds();
              knownUnitByObjectIds.unregisterItemIds();
            } else {
              if (this.selection.units.length === 1) {
                //
                // we have a known unit by this objectId1-2 pair but for whatever
                // reason that unit's itemId1-2 pair isn't in our current selection.
                // because we only have one thing in the selection, we're pretty sure
                // this unit was registered incorrectly so unregister
                // and mark a Major confidence reduction
                //
                
                this.reduceParseConfidence('Major');

                console.logger("WARNING - unregistering unit due to possiblyDeadUnits hit.");
                knownUnitByObjectIds.printUnit();

                knownUnitByObjectIds.unregisterObjectIds();
                knownUnitByObjectIds.unregisterItemIds();
              }
            }
          }
        }

        // perform a tab-switch
        PlayerActions.registerTabSwitch(
          this,
          firstGroupUnit,
          newlyRegisteredUnit,
          fixedItemId,
          itemId1, // the itemId1-2 of the first unit in the selection
          itemId2,
          objectId1,
          objectId2
        );

        return;
      }

      // did not tab switch units - move on to registering our focus unit
      PlayerActions.registerSubGroupFocusUnit(
        this,
        firstGroupUnit,
        fixedItemId,
        itemId1, 
        itemId2,
        objectId1,
        objectId2
      );
        
    }
  }

  //
  // ActionBlock method
  // change selection has two modes: select and deselect
  // besides handling those actions in our SubGroup selection,
  // we also detect "same-block updates", which can be used
  // to make assumptions about the selection unit state
  //

  changeSelection (action) {
    const self = this;
    const subActions = action.actions;
    const selectMode = action.selectMode;
    const numberUnits = action.numberUnits;

    // check if changeSelection occurs at same game time
    let sameChangeBlock = false;
    const { gameTime } = this.eventTimer.timer;

    if (!this.lastChangeGroupTime) {
      // last change time hasn't been set, not same block
      this.lastChangeGroupTime = gameTime;
      sameChangeBlock = false;
    } else {
      // check if we've done a "same-block" update and update our time ref
      sameChangeBlock = (this.lastChangeGroupTime === gameTime);
      this.lastChangeGroupTime = gameTime;
    }

    let hasUnregisteredUnitFlag = false;
    let subGroup = new SubGroup(numberUnits, subActions);

    if (selectMode === SelectModes.deselect) {
      // de-selected unit
      this.selection.deselect(subGroup);
      return;
    }

    if (sameChangeBlock  &&
        this.selection.units.length > 0) {
      // check if there are unknown units in our selection
      const unknownSelectionUnits = this.getUnknownSelectionUnits();
      if (unknownSelectionUnits.length) {
        // we found unknown units in our same-block selection, clear out
        // those bad units and mark a tiny confidence reduction

        let badSubGroup = new SubGroup(unknownSelectionUnits.length, unknownSelectionUnits);
        this.selection.deselect(badSubGroup);

        this.reduceParseConfidence('Tiny');
      }
    }

    // register first-time selected units
    subActions.forEach(subAction => {
      const {itemId1, itemId2} = subAction;
      let unit = self.findUnit(itemId1, itemId2);
      
      if (unit) {
        // already known unit
        unit.setAliveFlags();
        return;
      }
      
      if (self.world.findPossibleUnitByItemIds(self.id, itemId1, itemId2)) {
        // unit owned by other player
        return;
      }

      const inPossibleList = self.possibleSelectList.find(punit => {
        return utils.isEqualUnitItemId(punit, {
          itemId1: itemId1,
          itemId2: itemId2
        });
      });

      if (!utils.isUnitInList(self.possibleSelectList, { itemId1, itemId2 })) {
        // unit is currently unknown, add it to our possibleSelectList
        const newPossibleUnit = {
          itemId1: itemId1,
          itemId2: itemId2,
          spawnTime: self.eventTimer.timer.gameTime,
          backfill: []
        };

        self.possibleSelectList.push(newPossibleUnit);
        self.world.addPlayerPossibleUnit(self.id, newPossibleUnit);
      }

      hasUnregisteredUnitFlag = true;
    });

    if (this.selection === null) {
      // no sub-group yet.  assign our newly selected one
      this.selection = subGroup;  
    } else {
      // merge our existing selection with the new SubGroup
      this.selection.mergeGroups(subGroup);
    }

    if (sameChangeBlock) {
      if (this.selection.units.length !== numberUnits) {
        // change in same block had different number of units than selection
        // there is a chance we've detected some possibly dead units

        this.selection.units.forEach(unit => {
          const inGoodGroup = subGroup.units.find(sunit => {
            return utils.isEqualUnitItemId(sunit, unit);
          });
          
          if (!inGoodGroup &&
              !utils.isUnitInList(this.possiblyDeadUnits, unit)) {
            console.logger("WARNING - adding possibly dead unit:", unit.itemId1, unit.itemId2);
            this.possiblyDeadUnits.push(unit);  
          }
        });
      }
    }

    if (hasUnregisteredUnitFlag) {
      this.selection.hasUnregisteredUnit = true;
    }
  }

  //
  // ActionBlock method
  // use an ability that has no target
  // can be either an 4-item itemId array or a 4-char itemId string
  //
  useAbilityNoTarget (action) {
    const isItemArray = Array.isArray(action.itemId);
    const itemId = isItemArray ?
      action.itemId : utils.fixItemId(action.itemId);
    const {
      abilityFlags,
      unknownA,
      unknownB
    } = action;
    
    const unitInfo = mappings.getUnitInfo(itemId);
    let selectedUnits = this.getSelectionUnits();


    if (!selectedUnits.length) {
      // no registered units in selection

      if (unitInfo.isBuilding) {
        // we found a building that hasn't been registered yet
        const firstSelectionItem = this.selection.units[0];
        let maybeBuilding = this.findUnregisteredUnitByItemIds(
          firstSelectionItem.itemId1, 
          firstSelectionItem.itemId2
        );

        // TODO: might be able to figure out which unit did the action
        //       based on the action it-self.  might also just
        //       log some kind of Unit.actionBacklog to process after they do register?

        this.reduceParseConfidence('Tiny');
      }

      this.printSelectionUnits();
    }

    if (selectedUnits.length) {
      // registered unit used ability 
      const firstUnit = this.getSelectedUnit();
      this.printSelectionUnits();

      if (!firstUnit) {
        // todo: backfill (hero?) action
        console.logger("WARNING - need to backfill action from unreg unit");

        this.reduceParseConfidence('Minor');
        return;
      }

      if (firstUnit.meta.hero) {
        isItemArray ?
          Hero.doAbilityNoTargetItemArray(
            this,
            firstUnit,
            itemId,
            abilityFlags,
            unknownA,
            unknownB
          ) :
          Hero.doAbilityNoTargetItemId(
            this,
            firstUnit,
            itemId,
            abilityFlags,
            unknownA,
            unknownB
          );
      }

      if (firstUnit.isBuilding || unitInfo.isItem) {
        isItemArray ?
          Building.doAbilityNoTargetItemArray(
            this,
            firstUnit,
            itemId,
            abilityFlags,
            unknownA,
            unknownB
          ) :
          Building.doAbilityNoTargetItemId(
            this,
            firstUnit,
            itemId,
            abilityFlags,
            unknownA,
            unknownB
          );  
      }

      return;
    }
    
    switch (abilityFlags) {
      // learn skill
      case abilityFlagNames.Summon:
        if (this.tavernSelected) {
          let newTavernHero = new Unit(this.eventTimer, null, null, itemId, false);
          this.setHeroSlot(newTavernHero);

          console.logger(this.id, "Creating tavern hero: ", unitInfo.displayName);
          this.addPlayerUnit(newTavernHero);
          this.unregisteredUnitCount++;

          this.addEvent('makeTavernHero', {
            unit: newTavernHero.exportUnitReference() 
          });
        }
      break;

      default:
        console.logger("WARNING: no ability found");
        this.reduceParseConfidence('Tiny');
      break;
    }
  } 

  useAbilityWithTargetAndObjectId (action) {
    const isItemArray = Array.isArray(action.itemId);
    const { 
      targetX, 
      targetY,
      objectId1,
      objectId2
    } = action;

    let units = this.getSelectionUnits();
    const firstUnit = this.getSelectedUnit();

    console.logger("ability selection");
    this.printSelectionUnits();

    if (!firstUnit) {
      console.logger("WARNING - no first unit in UseAbilityWithTargetAndObjectId");
      
      this.reduceParseConfidence('Major');
      return;
    }

    const abilityActionName = utils.findItemIdForObject(action.itemId, abilityActions);
    switch (abilityActionName) {
      case 'EatTree':
        console.logger("NE Building eating a tree"); // yum
        this.addEvent('buildingAbility', { ability: 'EatTree', unit: firstUnit.exportUnitReference() });
      break;
      case 'UnsummonBuilding':
        console.logger("Detected building unsummon");
        let possibleBuilding = utils.closestToPoint(targetX, targetY, this.units, (unit) => {
          return unit.isBuilding;
        });

        if (possibleBuilding) {
          console.logger("Found building to unsummon: ", possibleBuilding.displayName);

          this.removePlayerBuilding(possibleBuilding);
          this.addEvent('buildingAbility', { ability: 'unsummon', unit: possibleBuilding.exportUnitReference() });
        } else {
          console.logger("WARNING - unable to find building to unsummon.");
          this.reduceParseConfidence('Major');
        }
      break;
      case 'CastSkillTarget':
        if (firstUnit.meta.hero) {
          let skill = firstUnit.getSkillForType("pointTarget");
          if (!skill) {
            console.logger("WARNING - couldnt find pointTarget skill for unit: ", firstUnit.displayName);
            this.reduceParseConfidence('Tiny');
            return;
          }

          console.logger(firstUnit.displayName, "casting point target skill:", skill);
          this.addEvent('abilityCast', { 
            type: 'useAbilityWithTargetAndObjectId',
            ability: skill,
            unit: firstUnit.exportUnitReference() 
          });
        }
      break;
      case 'CastSkillObject':
        if (firstUnit.meta.hero) {
          let skill = firstUnit.getSkillForType("objectTarget");

          if (!skill) {
            console.logger("WARNING - couldnt find objectTarget skill for unit: ", firstUnit.displayName);
            this.reduceParseConfidence('Tiny');
            return;
          }
          
          this.addEvent('abilityCast', { 
            type: 'useAbilityWithTargetAndObjectId',
            ability: skill,
            unit: firstUnit.exportUnitReference() 
          });
          console.logger(firstUnit.displayName, "casting object target skill: ", skill);
        }
      break;
      case 'MoveCommand':
        // todo: move without attacking eventually 
        //       once attacking is a thing

        PlayerActions.moveSelectedUnits(this, targetX, targetY);
      break;
      case 'AttackCommand':
        // todo: move with attacking eventually 
        //       once attacking is a thing

        PlayerActions.moveSelectedUnits(this, targetX, targetY);
      break;
      case 'RightClick':
        if (firstUnit && firstUnit.isBuilding) {
          Building.doAbilityRightClickWithTargetAndObjectId(
            this,
            firstUnit,
            objectId1,
            objectId2,
            targetX,
            targetY
          );
        } else if (firstUnit && firstUnit.meta.hero) {
          // when objectId1-2 is -1, it means the ground was clicked
          if (objectId1 === 4294967295 && objectId2 === 4294967295) {
            // TODO: rally point and ability on ground here
            console.logger("moving hero fronted unit group from ground right click");

            PlayerActions.moveSelectedUnits(this, targetX, targetY);
            return;
          }

          Hero.doAbilityRightClickWithTargetAndObjectId(
            this,
            firstUnit,
            objectId1,
            objectId2,
            targetX,
            targetY
          );

          // after doing interaction also move the units
          PlayerActions.moveSelectedUnits(this, targetX, targetY);
        } else if (firstUnit && firstUnit.isUnit) {
          PlayerActions.moveSelectedUnits(this, targetX, targetY);
        } else {
          // made it down here with no action
          this.reduceParseConfidence('Tiny');
        }
        
      break;
      case 'HeroRevive':
        console.logger("reviving hero!", objectId1, objectId2);
        const targetHero = this.findUnitByObjectId(objectId1, objectId2);

        if (targetHero) {
          console.logger("reviving: ", targetHero.displayName);
          console.logger("at building spot: ", firstUnit.currentX, firstUnit.currentY);
          
          // TODO: track that hero died / revived
          targetHero.printUnit();
          targetHero.reviveAtSpot(this.world, firstUnit.currentX, firstUnit.currentY);

          this.addEvent('heroRevive', { 
            spot: {
              x: firstUnit.currentX,
              y: firstUnit.currentY
            },
            unit: firstUnit.exportUnitReference() 
          });
        }
      break;
      case 'HeroMoveItem1':
      case 'HeroMoveItem2':
      case 'HeroMoveItem3':
      case 'HeroMoveItem4':
      case 'HeroMoveItem5':
      case 'HeroMoveItem6':
        // try to move hero item
        Hero.doMoveItem(
          this,
          firstUnit,
          action.itemId,
          objectId1,
          objectId2,
          targetX,
          targetY
        );
      break;

      case 'Gather':
        // TODO implement if this really is gather
      break;

      default:
        console.logger("WARNING - performed unknown action");
        
        if (!abilityActionName && action.itemId[1] === 0) {
          console.logger("uk action itemId was: ", abilityActionName, action.itemId);
        }

        this.reduceParseConfidence('Tiny');
      break;
    }
  }

  //
  // ActionBlock method
  // use ability with target position
  // can be a 4-
  //
  useAbilityWithTarget (action) {
    const self = this;
    const { targetX, targetY, itemId } = action;
    const isItemArray = Array.isArray(action.itemId);
    const fixedItemId = utils.fixItemId(itemId);
    const selectionUnits = this.getSelectionUnits();
    
    let firstUnit = this.getSelectedUnit();
    const unitInfo = mappings.getUnitInfo(fixedItemId);

    if (isItemArray) {
      const abilityActionName = utils.findItemIdForObject(itemId, abilityActions);
      switch (abilityActionName) {
        case 'NERoot':
          // todo: add to event log
          console.logger("building rooted.");
        break;

        case 'SummonTreants':
          // todo: add to event log
          console.logger("summon treant detected");
          Hero.castSummon(this, firstUnit);
        break;

        default:
          console.logger("WARNING - unable to find unit ability");
          this.reduceParseConfidence('Tiny');
        break;
      }

      return;
    }

    const workerInGroup = selectionUnits.find(sunit => {
      return sunit.meta.worker;
    });

    if (workerInGroup) {
      const closestWorker = utils.closestToPoint(targetX, targetY, selectionUnits, (sunit => {
        return sunit.meta.worker;
      }));

      if (!utils.isEqualUnitItemId(firstUnit, closestWorker)) {
        firstUnit = closestWorker;
      }

      const startingPosition = {
        x: targetX,
        y: targetY
      };

      // note: we don't add the building to the players units until the callback
      let building = new Building(this.eventTimer, null, null, fixedItemId, false);
      building.registerUnit(fixedItemId, null, null);
      building.currentX = targetX;
      building.currentY = targetY;

      PlayerActions.checkUnitBackfill(this, building);

      const playerInstance = this;

      console.logger("unit is building: ", building.displayName, firstUnit.uuid);
      firstUnit.moveToBuild(this.world, building, (eventFinished) => {
        console.logger("unit moveToBuild event handler: ", firstUnit.uuid, eventFinished);

        if (!eventFinished) {
          //
          // if the event was marked as not fully finished,
          // do some distance checks to see if the worker got
          // to the right place to build
          //          
          const distanceLeft = utils.distance(
            building.currentX, building.currentY,
            firstUnit.currentX, firstUnit.currentY
          );

          const { gameTime } = playerInstance.eventTimer.timer;

          // once the game gets deep enough stop trying these distance checks
          const gameTimeBuffer = gameTime > 200000 ? 5.5 : 1;
          const maxDistanceBuffer = (2500 * gameTimeBuffer);

          if (distanceLeft > maxDistanceBuffer) {
            console.logger("WARNING - building move event was cancelled before build. builder: ", firstUnit.displayName);
            console.logger("stopped building: ", building.displayName, building.itemId);

            // not always a bad thing, but because it's uncertain we reduce a tiny amount
            this.reduceParseConfidence('Tiny');
            return;
          }
        }

        console.logger(playerInstance.id, "unit finished moving to building, now building: ", building.displayName);

        playerInstance.addPlayerBuilding(building);
        building.startConstruction();
      });

      // toggle OFF the build menu since we just used it in an action
      this.buildMenuOpen = false;
      return;
    }

    if (unitInfo.isBuilding) {
      console.logger("WARNING: building did an action we didn't register");
      this.reduceParseConfidence('Minor');
    } else {
      // not sure how or why we got here
      this.reduceParseConfidence('Major');  
    }
  }

  //
  // ActionBlock method
  // simple callback to note worker building menu is open
  //
  chooseBuilding (action) {
    this.buildMenuOpen = true;
  }

  //
  // ActionBlock method
  // called to assign a group to a given hotkey
  // the game provides the itemId1-2 pairs of the units in a group
  //
  assignGroupHotkey (action) {
    const { 
      groupNumber, 
      numberUnits,
      actions
    } = action;

    //
    // DEV NOTE - for weird and unknown wc3 reasons the first two heroes
    //            in the hotkey group are switched in position order.
    //            this can be handled by the engine with tab-switch checks,
    //            but it *SEEMS* to consistently always screw this up, so fix it.
    //
    if (actions.length >= 2) {
      let shouldSwapHeroes = false;
      for (let i = 0; i < 2; i++) {
        const { itemId1, itemId2 } = actions[i];
        const unit = this.findUnit(itemId1, itemId2);

        if (unit && unit.meta.hero) {
          shouldSwapHeroes = true;
        } else {
          shouldSwapHeroes = false;
        }
      }

      if (shouldSwapHeroes) {
        console.logger("WARNING - Swapping first two heroes in hotkey group");
        const oldFirst = actions[0];

        actions[0] = actions[1];
        actions[1] = oldFirst;
      }
    }

    const oldSelection = this.selection;
    const newGroup = new SubGroup(numberUnits, actions);
    const newSelection = new SubGroup(numberUnits, actions);

    // set flags on our group and selection
    newGroup.setFromHotkey = true;
    newSelection.setFromHotkey = true;

    // set the new group and selection
    this.groupSelections[groupNumber] = newGroup;
    this.selection = newSelection;

    // ensure the groups have no bugged members in them 
    // sometimes for whatever reason the game includes a building in
    // the 'assign group hotkey' action groups

    this.selection.units = this.ensureValidGroup(oldSelection.units, this.selection.units);
    this.groupSelections[groupNumber].units = this.ensureValidGroup(
      oldSelection.units, 
      this.groupSelections[groupNumber].units
    );

    this.lastSelectedGroupNumber = groupNumber;
    this.recordGroups();
  }

  //
  // ActionBlock method
  // called to assign a given group at the known hotkey as our selection.
  // unfortunately does not provide the units it expects to select,
  // so we are potentially able to set the selection to a stale / invalid
  // group of units that maybe died, were unsummoned, or were wrongly assigned.
  //

  selectGroupHotkey (action) {
    const { groupNumber } = action;

    if (this.groupSelections[groupNumber]) {
      // todo: add group deselectAll
      const { 
        numberUnits, 
        units,
        hasUnregisteredUnit,
        hasDestroyedSummon,
        destroyedUnits
      } = this.groupSelections[groupNumber];

      let groupCopy = new SubGroup(numberUnits, units, hasUnregisteredUnit);
      this.selection = groupCopy;

      // set our selection flags
      this.selection.hasDestroyedSummon = hasDestroyedSummon;
      this.selection.destroyedUnits = destroyedUnits;
      this.selection.setFromHotkey = true;

      this.lastSelectedGroupNumber = groupNumber;

      if (this.selection.numberUnits === 0) {
        // selection group had no units?
        this.reduceParseConfidence('Major');
      }
    } else {
      console.error("WARNING -selected group that didnt exist");
      this.reduceParseConfidence('Major');
    }
  }

  //
  // ActionBlock method
  // give or drop an item to a target X,Y and objectId1-2 pair
  // lot of uncertainty involved here
  //
  giveOrDropItem (action ) {
    const {
      abilityFlags,
      itemId,
      targetX,
      targetY,
      objectId1,
      objectId2,
      itemObjectId1,
      itemObjectId2
    } = action;

    let selection = this.getSelectionUnits();
    let firstUnit = this.getSelectedUnit();

    if (!firstUnit) {
      this.reduceParseConfidence('Major');
      return;
    }

    const heroItems = firstUnit.getItemList();
    const knownItem = heroItems.find(heroItem => {
      const item = heroItem.item;
      return item.objectId1 === itemObjectId1 &&
             item.objectId2 === itemObjectId2 &&
             item.objectId1 !== null;
    });

    // objectId1-2 pair of -1 means item on ground
    if (objectId1 === -1 && objectId2 === -1) {
      if (knownItem) { 
        console.logger("put known item on ground.");
        this.world.droppedItems.push(knownItem.item);
        firstUnit.items[knownItem.slot] = null;
        firstUnit.droppedItems.push(knownItem);

        this.addEvent('dropItem', { 
          type: 'knownItem',
          slot: knownItem.slot,
          item: knownItem.item.exportItemReference()
        });

        return;
      }

      // look for potential item to put on ground
      let potentialItem = heroItems.find(heroItem => {
        const item = heroItem.item;
        return item.objectId1 === null;
      });

      if (potentialItem) {
        console.logger("Dropping potential item: ", potentialItem.item.displayName);

        // todo: track maybeSwapItem here
        potentialItem.item.registerObjectIds(itemObjectId1, itemObjectId2);
        firstUnit.items[potentialItem.slot] = null;

        this.world.droppedItems.push(potentialItem.item);
        firstUnit.droppedItems.push(potentialItem);

        this.addEvent('dropItem', { 
          type: 'potentialItem',
          slot: potentialItem.slot,
          item: potentialItem.item.exportItemReference()
        });
      } else {
        console.logger("ERROR - No potential items to drop.");
        this.reduceParseConfidence('Minor');
      }
    
      return;
    }

    //
    // try to find a hero to give/drop item to
    //

    const targetHero = this.findUnitByObjectId(objectId1, objectId2);
    if (!targetHero) {
      // can't find hero that is getting item
      this.reduceParseConfidence('Major');
      return;
    }

    // known item and known target hero, give the item over
    if (knownItem) {
      firstUnit.items[knownItem.slot] = null;
      firstUnit.droppedItems.push(knownItem);
      targetHero.tradeItem(knownItem.item);

      this.addEvent('dropItem', { 
        type: 'knownItem',
        slot: knownItem.slot,
        item: knownItem.item.exportItemReference()
      });

      console.logger(this.id, `Hero ${firstUnit.displayName} gave known item to ${targetHero.displayName}`);  
      return;
    }

    // unkown item being traded, look for potential unknown item from units item list
    const unknownWorldUnit = this.world.findUnknownObject(objectId1, objectId2);
    const potentialUnregisteredItem = heroItems.find(heroItem => {
      return heroItem.item.objectId1 === null;
    });

    if (potentialUnregisteredItem) {
      const { slot, item } = potentialUnregisteredItem;
      potentialUnregisteredItem.item.registerKnownItem(itemObjectId1, itemObjectId2, targetX, targetY);

      firstUnit.droppedItems.push(potentialUnregisteredItem);
      firstUnit.items[slot] = null;
      targetHero.tradeItem(item);

      console.logger(this.id,
        `Hero ${firstUnit.displayName} gave unknown item ${potentialUnregisteredItem.item.displayName}
        to ${targetHero.displayName}`); 
      
      this.addEvent('dropItem', {
        type: 'potentialUnregisteredItem',
        slot: potentialUnregisteredItem.slot,
        item: potentialUnregisteredItem.item.exportItemReference()
      });

      return;
    }
    
    // try and find an unknown object from the world
    let unknownObject = this.world.findUnknownObject(itemObjectId1, itemObjectId2);
    if (unknownObject) {
      console.logger(this.id, "Found a world item to register.");

      let newUnknownItem = new Item(this.eventTimer, null, null, 'Jwid', false);
      newUnknownItem.registerKnownItem(itemObjectId1, itemObjectId2, targetX, targetY);

      console.logger(this.id, "WARNING - Gave hero item but had to make new unknown item.");
      this.reduceParseConfidence('Minor');
      targetHero.tradeItem(newUnknownItem);

      this.world.clearKnownItem(itemObjectId1, itemObjectId2);
      return;
    }

    // nothing to do but make a new unknown item and give it over
    let newUnknownItem = new Item(this.eventTimer, null, null, 'Jwid', false);
    newUnknownItem.registerKnownItem(itemObjectId1, itemObjectId2, targetX, targetY);
    newUnknownItem.meta.isItem = true;

    console.logger(this.id, "WARNING - Gave hero item but had to make new unknown item.");
    this.reduceParseConfidence('Minor');
    targetHero.tradeItem(newUnknownItem); 
  }

  //
  // ActionBlock method
  // dunno wat this does
  //
  useAbilityTwoTargets (action) {
    const { itemId2 } = action;
    const fixedItemId2 = utils.fixItemId(itemId2);

    const unitInfo = mappings.getUnitInfo(fixedItemId2);
    console.logger("itemId2 info: ", unitInfo);

    console.logger("current selection:");
    this.printSelectionUnits();

    // we don't handle it so...
    this.reduceParseConfidence('Minor');
  }

  //
  // debugging method
  //
  printUnits () {
    console.logger("player units for id: ", this.id);

    const sortedUnits = this.units.sort((a, b) => {
      const aName = a.displayName.toUpperCase();
      const bName = b.displayName.toUpperCase();

      if (aName < bName) {
        return -1;
      }

      if (aName > bName) {
        return 1;
      }

      return 0;
    });

    console.logger(sortedUnits.map(unit => {
      return `${unit.displayName} - [${unit.objectId1}, ${unit.objectId2}] ${unit.itemId1}, ${unit.itemId2}`;
    }));
  }

  //
  // debugging method
  //
  printAllGroups () {
    console.logger("all groups: ");
    const self = this;

    Object.keys(this.groupSelections).forEach(key => {
      let group = this.groupSelections[key];

      console.logger(key, "units: ", group.units.map(gunit => {
        const playerUnit = self.findUnit(gunit.itemId1, gunit.itemId2);

        const displayName = playerUnit ? playerUnit.displayName : "Unregistered";

        return gunit.itemId1 + "," + gunit.itemId2 + " - " + displayName;
      }));

      console.logger("meta: ", 
        group.setFromHotkey ? "set from hotkey" : "not set from hotkey",
        group.hasDestroyedSummon ? "has destroyed summon" : "no destroyed units");
    });
  }

  //
  // debugging method
  //
  printSelectionUnits () {
    const self = this;
    console.logger("selection index: ", this.selection.selectionIndex);
    console.logger("current selection units: ", this.selection.units.map(gunit => {
      const playerUnit = self.findUnit(gunit.itemId1, gunit.itemId2);

      if (!playerUnit) {
        return `${gunit.itemId1}, ${gunit.itemId2} - Unregistered`;
      }

      const {
        itemId1,
        itemId2,
        objectId1,
        objectId2,
        displayName
      } = playerUnit;

      return `${itemId1}, ${itemId2} [${objectId1}, ${objectId2}] - ${displayName}`;
    }));
  }
};

module.exports = Player;
