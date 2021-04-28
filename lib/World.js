const utils = require("../helpers/utils"),
      PathFinder = require("./PathFinder");

const Unit = require("./Unit");

const World = class {
  constructor (eventTimer) {
    this.droppedItems = [];
    this.unknownObjects = [];
    this.eventTimer = eventTimer;

    this.playerData = {};
    this.neutralShops = [];

    this.neutralGroups = [];

    this.gridData = null;
  }

  setNeutralGroups (neutralGroups) {
    this.neutralGroups = neutralGroups;
  }

  setGridData (gridData) {
    this.pathFinder = new PathFinder();
    this.pathFinder.setup(gridData);
  }

  addNeutralShop (itemId, objectId1, objectId2) {
    const shopObject = { itemId, objectId1, objectId2 };

    if (!this.neutralShops.find(shop => { 
      return shop.objectId1 === objectId1 && shop.objectId2 === objectId2; })) {
      this.neutralShops.push(shopObject);
    }
  }

  getNeutralShop (shopData) {
    const { objectId1, objectId2 } = shopData;

    return this.neutralShops.find(shop => { 
      return shop.objectId1 === objectId1 && shop.objectId2 === objectId2; 
    });
  }

  addPlayerData (player) {
    const { id, units, possibleSelectList } = player;

    this.playerData[id] = {
      id: id,
      units: Array.from(units),
      possibleSelectList: Array.from(possibleSelectList)
    };
  }

  addPlayerUnit (id, unit) {
    if (!this.playerData[id]) {
      console.logger("warning - no player data for: ", id);
      console.logger("player data: ", this.playerData);
      return;
    }

    this.playerData[id].units.push(unit);
  }

  addPlayerPossibleUnit (id, unit) {
    if (!this.playerData[id]) {
      console.logger("warning - no player data for: ", id);
      return;
    }

    this.playerData[id].possibleSelectList.push(unit);
  }

  getOtherPlayerData (playerId) {
    return Object.values(this.playerData).filter(player => {
      return player.id !== playerId;
    });
  }

  findKnownUnitByItemAndObjectId (playerId, itemId, objectId1, objectId2) {
    return this.getOtherPlayerData(playerId).find(player => {
      return player.units.find(unit => {
        const foundUnit = unit.itemId === itemId &&
          unit.objectId1 === objectId1 &&
          unit.objectId2 === objectId2;

        return foundUnit;
      });
    });
  }

  findPossibleUnitByItemIds (playerId, itemId1, itemId2) {
    const targetUnit = { itemId1, itemId2 };
    
    return this.getOtherPlayerData(playerId).find(player => {
      return player.possibleSelectList.find(possibleUnit => {
        return utils.isEqualUnitItemId(
          targetUnit,
          possibleUnit
        );
      });
    });
  }

  findUnknownObject (objectId1, objectId2) {
    return this.unknownObjects.find(item => {
      return item.objectId1 === objectId1 &&
             item.objectId2 === objectId2;
    });
  }

  findDroppedItem (objectId1, objectId2) {
    return this.droppedItems.find(item => {
      return item.objectId1 === objectId1 &&
             item.objectId2 === objectId2;
    });
  }

  removeDroppedItem (objectId1, objectId2) {
    return this.droppedItems.filter(item => {
      return item.objectId1 === objectId1 &&
             item.objectId2 === objectId2;
    });
  }

  removeUnknownObject (objectId1, objectId2) {
    return this.unknownObjects.filter(item => {
      return item.objectId1 === objectId1 &&
             item.objectId2 === objectId2;
    });
  }

  clearKnownItem (objectId1, objectId2) {
    this.removeDroppedItem(objectId1, objectId2);
    this.removeUnknownObject(objectId1, objectId2);
  }

  addUnknownObject (objectId1, objectId2) {
    let worldKnownItem = this.findUnknownObject(objectId1, objectId2);

    if (!worldKnownItem) {
      console.logger("Adding unknown object to world.");
      let unknownUnit = new Unit(this.eventTimer, null, null, null, false);
      unknownUnit.registerObjectIds(objectId1, objectId2);

      this.unknownObjects.push(unknownUnit);
    }
  }
};

module.exports = World;
