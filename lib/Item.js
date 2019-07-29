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

const Item = class extends Unit {

  constructor (eventTimer, itemId1, itemId2, knownItemId, isSpawnedAtStart = false) {
    super(eventTimer, itemId1, itemId2, knownItemId, isSpawnedAtStart);

    this.knownOwner = false;

    this.itemSlotId = null;
    this.knownItemX = null;
    this.knownItemY = null;

    this.expires = false;
    this.usesLeft = 0;

    this.cooldown = 0;
    this.onCooldown = false;

    const itemData = knownItemId && itemAbilityData[knownItemId];
    if (itemData) {
      const { uses, cooldown } = itemData;

      this.cooldown = cooldown;

      if (uses) {
        this.expires = true;
        this.usesLeft = uses;
      }
    }
  }

  setCooldownState (state) {
    this.onCooldown = state;
  }

  setSlot (slot) {
    this.itemSlotId = slot;
  }

  registerKnownItem (objectId1, objectId2, targetX, targetY) {
    this.registerObjectIds(objectId1, objectId2);

    this.knownItemX = targetX;
    this.knownItemY = targetY;
  }

};

module.exports = Item;
