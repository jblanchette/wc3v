const mappings = require("../helpers/mappings");
const utils = require("../helpers/utils");

/*

TODO - now that we have units, buildings, items, ect.
       mapped it will be good to break out the not shared bits
       
       likely subclasses -
        * PlayerUnit / EnemyUnit
        * Building
        * Item
        * PlayerShop / MapShop
        * Tavern
*/

const Unit = class {
  constructor (eventTimer, itemId1, itemId2, knownItemId, isSpawnedAtStart = false, summonDuration = null ) {
    this.uuid = utils.uuidv4();
    this.eventTimer = eventTimer;
    this.itemId1 = itemId1;
    this.itemId2 = itemId2;

    this.objectId1 = null;
    this.objectId2 = null;

    this.itemId = knownItemId || null;

    this.spawnTime = eventTimer.timer.gameTime;
    this.spawnPosition = null;

    const spawnedAtStartCheck = (itemId1 !== null) && utils.isEqualItemId(itemId1, itemId2);
    this.isSpawnedAtStart = isSpawnedAtStart || spawnedAtStartCheck;

    this.summonEvent = null;  
    this.summonDestroyHandler = null;
    this.summonDuration = summonDuration;

    this.destroyed = false;

    this.displayName = null;
    this.isBuilding = false;
    this.isUnit = false;
    this.isItem = false;

    // non-selectable things on the map
    // like trees
    
    this.hasBeenInGroup = false;
    this.isRegistered = false;

    this.abilityFlags = null;
    this.spawning = true;

    this.selected = false;

    this.currentX = 0;
    this.currentY = 0;

    // init and clear move info
    this.clearMoveInfo();

    this.path = [];
    this.moveHistory = [];
    this.state = null;

    this.isIllusion = false;

    // building stuff
    this.rallyPoint = {
      type: null,
      pt: null,
      objectId1: null,
      objectId2: null
    };

    this.trainedUnits = [];
    this.soldItems = {};

    // hero stuff
    this.heroSlot = 0;
    this.items = {
      1: null,
      2: null,
      3: null,
      4: null,
      5: null,
      6: null
    };

    this.droppedItems = [];
    this.tradedItems = [];

    this.learnedSkills = {};
    this.spells = {};

    this.isIllusion = false;
    this.knownLevel = 0;

    this.levelStream = [];

    // item stuff
    this.knownOwner = false;
    this.knownItemX = null;
    this.knownItemY = null;

    // export data streams

    // set unit info + meta
    this.setUnitMeta();

    if (this.summonDuration) {
      console.logger("Created summon unit:", this.displayName, "duration:", summonDuration, "uuid:", this.uuid);

      this.startSummonTimer();
    }
  }

  clearMoveInfo () {
    this.moveInfo = {
      timerEvent: null,
      timeElapsed: 0,
      distance: 0,
      startX: 0,
      startY: 0,
      targetX: 0,
      targetY: 0,
      xDirection: 0,
      yDirection: 0,
      pathDistance: 0,
      pathTime: 0,
      xVelocity: 0,
      yVelocity: 0,
      onCompleteExtra: null
    };
  }

  setSpawnPosition (x, y) {
    this.currentX = x;
    this.currentY = y;

    this.spawnPosition = { x, y };

    this.recordPosition();
  }

  startSummonTimer () {
    if (this.summonEvent) {
      console.logger("ERROR - summon already has summon event?");
      
      return;
    }

    this.summonEvent = this.eventTimer.addEvent(
      this.summonDuration * utils.SECONDS_TO_MS, 
      this.summonOnTick.bind(this),
      this.summonOnComplete.bind(this)
    );
  }

  setSummonDestroyHandler (destroyHandler) {
    this.summonDestroyHandler = destroyHandler;
  }

  summonOnTick (gameTime, delta) {
    // no-op
  }

  summonOnComplete (eventFinished) {
    this.destroyed = true;
    this.summonDestroyHandler();
  }

  setAliveFlags () {
    this.spawning = false;
  }

  setUnitMeta () {
    const { 
      displayName, 
      isBuilding, 
      isUnit,
      isItem,
      meta
    } = mappings.getUnitInfo(this.itemId);

    this.displayName = displayName;
    this.isBuilding = isBuilding;
    this.isUnit = isUnit;
    this.isItem = isItem;

    this.meta = meta;
  }

  checkDestroyed () {
    if (this.destroyed) {
      console.logger("ERROR - tried to assign to destroyed unit");
    }
  }

  unregisterObjectIds () {
    this.objectId1 = null;
    this.objectId2 = null;

    this.isRegistered = false;
  }

  unregisterItemIds () {
    this.itemId1 = null;
    this.itemId2 = null;

    this.isRegistered = false;
  }

  registerItemIds (itemId1, itemId2) {
    this.checkDestroyed();

    this.itemId1 = itemId1;
    this.itemId2 = itemId2;

    this.hasBeenInGroup = true;
    this.checkRegistered();
  }

  registerObjectIds (objectId1, objectId2) {
    this.checkDestroyed();

    this.objectId1 = objectId1;
    this.objectId2 = objectId2;

    if (this.objectId1 === this.objectId2 &&
        !this.isSpawnedAtStart) {
      this.isSpawnedAtStart = true;
    }

    this.hasBeenInGroup = true;
    this.checkRegistered();
  }

  registerKnownItem (x, y) {
    this.checkDestroyed();

    this.knownItemX = x;
    this.knownItemY = y;
  }

  registerUnit (itemId, objectId1, objectId2) {
    this.checkDestroyed();

    this.itemId = itemId;
    this.objectId1 = objectId1;
    this.objectId2 = objectId2;

    if (this.objectId1 === this.objectId2 &&
        !this.isSpawnedAtStart) {
      this.isSpawnedAtStart = true;
    }

    this.setUnitMeta();
    this.hasBeenInGroup = true;

    this.checkRegistered();
  }

  checkRegistered () {
    if (this.isRegistered) {
      return;
    }
    
    if (this.objectId1 && this.objectId2 && this.itemId1 && this.itemId2) {
      this.isRegistered = true;
    }
  }

  getNextItemSlot () {
    let itemSlotId = Object.keys(this.items).find(key => {
      return this.items[key] === null;
    });

    if (itemSlotId === -1) {
      console.log("Unable to find item slot for unit. ", self.displayName, itemId);
      return;
    }

    return itemSlotId;
  }

  setItemSlot (slot, item) {
    if (item) {
      item.setSlot(slot);
    }

    this.items[slot] = item;
  }

  tradeItem (item) {
    this.checkDestroyed();

    if (item) {
      // item cooldowns reset when you trade items
      item.setCooldownState(false);
    }

    this.setItemSlot(this.getNextItemSlot(), item);
    item.knownOwner = true;
  }

  getItemList () {
    let knownItems = Object.keys(this.items).filter(key => {
      return this.items[key] !== null;
    });

    return knownItems.map(key => {
      return {
        slot: key,
        item: this.items[key]
      };
    });
  }

  spawn () {
    this.spawning = false;
  }

  select () {
    this.selected = true;
  }

  deselect () {
    this.selected = false;
  }

  getSkillForType (skillType) {
    let skillKey = Object.keys(this.learnedSkills).find(key => {
      let learnedSkill = this.learnedSkills[key];

      return learnedSkill.type === skillType;
    });

    return skillKey && {...mappings.heroAbilities[skillKey], skillKey: skillKey} || null;
  }

  recordMoveHistory () {
    let history = this.moveInfo;

    const { 
      startTime, 
      endTime, 
      runLength,
      completed,
      cancelled
    } = history.timerEvent;

    //delete history.timerEvent;
    //delete history.onCompleteExtra;

    history.timerData = {
      startTime, 
      endTime: endTime | 0, 
      runLength,
      completed,
      cancelled
    };

    // tigthen float precision
    Object.keys(history).forEach((key) => {
      if (typeof history[key] !== 'number') {
        return;
      }

      history[key] = +history[key].toFixed(2);
    });

    this.moveHistory.push(history);
  }

  recordPosition () {
    this.path.push({
      x: +this.currentX.toFixed(2),
      y: +this.currentY.toFixed(2),
      gameTime: this.eventTimer.timer.gameTime
    });
  }

  recordMidwayPosition (x, y) {
    this.path.push({
      x: +x.toFixed(2),
      y: +y.toFixed(2),
      gameTime: this.eventTimer.timer.gameTime
    });
  }

  performBackfill (backfill) {
    const self = this;

    console.logger("performing backfill for", this.displayName);

    // TODO: simulate with timers
    backfill.forEach((action, index) => {
      const { target } = action;
      const { x, y } = target;

      self.path.push({
        x: x,
        y: y
      });

      // TODO: remove after we simulate
      if (index === (backfill.length - 1)) {
        console.logger(`setting last backfill pos: (${x}, ${y})`);

        self.currentX = x;
        self.currentY = y;
      }
    });
  }

  reviveAtSpot (world, targetX, targetY) {
    console.logger("calling reviveAtSpot: ", this.uuid);

    this.currentX = targetX;
    this.currentY = targetY;

    if (this.moveInfo.timerEvent) {
      // stop all moving
      this.eventTimer.cancelEvent(this.moveInfo.timerEvent);
    }

    // start a moveTo that should just finish instantly
    this.moveTo(world, targetX, targetY);
  }

  moveToBuild (world, building, onComplete) {
    if (this.state === "walking") {
      // we detected the unit had been walking
      // and the player cancelled the action by 
      // sending another move command.

      this.eventTimer.cancelEvent(this.moveInfo.timerEvent);

      if (this.moveInfo.onCompleteExtra) {
        this.moveInfo.onCompleteExtra(false);
      }

      this.state = "idle";
    }

    this.moveTo(world, building.currentX, building.currentY, onComplete);
  }

  moveTo (world, targetX, targetY, onCompleteExtra = null) {
    if (this.state === "walking") {
      // we detected the unit had been walking
      // and the player cancelled the action by 
      // sending another move command.

      if (this.moveInfo.timerEvent) {
        this.eventTimer.cancelEvent(this.moveInfo.timerEvent);
      } else {
        console.logger("broken walk cancel: ", this.displayName, this.uuid);
        throw new Error("asdf");
      }
    }

    console.logger("unit move to: ", targetX, targetY);

    const walkPath = world.pathFinder.findPath(
      this.currentX, this.currentY, 
      targetX, targetY
    );

    const usePathFinding = true;

    if (!usePathFinding) {
      this.walkPath = [{x: targetX, y: targetY}];
      this.moveOnStart(onCompleteExtra);
      return;
    }

    if (walkPath.length) {
      this.walkPath = walkPath;
      this.moveOnStart(onCompleteExtra);
    }
  }

  moveOnStart (onCompleteExtra = null) {
    if (!this.walkPath.length) {
      return;
    }

    this.state = "walking";

    const pathNode = this.walkPath.shift();

    const targetX = pathNode.x;
    const targetY = pathNode.y;

    this.recordMidwayPosition(targetX, targetY);

    const pathDistance = utils.distance(
      this.currentX, this.currentY,
      targetX, targetY
    );

    const ms = (this.meta.movespeed || 250);
    const pathTime = (pathDistance / ms);

    this.moveInfo = {
      timerEvent: null,
      timeElapsed: 0,
      distance: 0,
      startX: this.currentX,
      startY: this.currentY,
      targetX: targetX,
      targetY: targetY,
      xDirection: (targetX > this.currentX) ? 1 : -1,
      yDirection: (targetY > this.currentY) ? 1 : -1,
      pathDistance: pathDistance,
      pathTime: pathTime,
      xVelocity: (Math.abs(targetX - this.currentX) / pathTime),
      yVelocity: (Math.abs(targetY - this.currentY) / pathTime),
      onCompleteExtra: onCompleteExtra
    };

    this.moveInfo.timerEvent = this.eventTimer.addEvent(
      pathTime * utils.SECONDS_TO_MS, 
      this.moveOnTick.bind(this), 
      this.walkPath.length > 1
        ? this.moveOnPathComplete.bind(this)
        : this.moveOnComplete.bind(this)
    );

    //this.recordMoveHistory();

    if (this.isSpawnedAtStart && !this.path.length) {
      
      this.currentX = targetX;
      this.currentY = targetY;

      this.eventTimer.cancelEvent(this.moveInfo.timerEvent);
    }
  }

  moveOnTick (gameTime, delta) {
    const secondsPassed = (delta * utils.MS_TO_SECONDS);
    const {
      xDirection,
      yDirection,
      xVelocity,
      yVelocity
    } = this.moveInfo;

    // direction vector * velocity * time delta

    const xDelta = (xDirection * xVelocity * secondsPassed);
    const yDelta = (yDirection * yVelocity * secondsPassed);
    
    // set the time and distance
    this.moveInfo.timeElapsed += secondsPassed;
    this.moveInfo.distance += utils.distance(
      this.currentX, this.currentY,
      (this.currentX + xDelta), (this.currentY + yDelta)
    );

    // update the postion
    this.currentX += xDelta;
    this.currentY += yDelta;
  }

  moveOnPathComplete(eventFinished) {
    if (this.moveInfo.timerEvent) {
      this.recordPosition();
      this.recordMoveHistory();
    }

    this.moveOnStart(this.moveInfo.onCompleteExtra);
  }

  moveOnComplete (eventFinished) {
    const { targetX, targetY, timerEvent, onCompleteExtra } = this.moveInfo;
    this.state = "idle";

    if (eventFinished) {
      this.currentX = targetX;
      this.currentY = targetY;
    }

    if (this.moveInfo.timerEvent) {
      this.recordPosition();
      this.recordMoveHistory();
    }

    if (onCompleteExtra) {
      onCompleteExtra(eventFinished);
    }
  }
  
  //
  // 
  //

  exportUnitReference () {
    const self = this;

    return {
      displayName:   self.displayName,
      itemId:        self.itemId,
      itemId1:       self.itemId1 && self.itemId1.toString(),
      itemId2:       self.itemId2 && self.itemId2.toString(),
      objectId1:     self.objectId1,
      objectId2:     self.objectId2,
      isRegistered:  self.isRegistered,
      isUnit:        self.isUnit,
      isBuilding:    self.isBuilding,
      isIllusion:    self.isIllusion,
      level:         self.knownLevel,
      lastPosition:  { x: self.currentX, y: self.currentY },
    };
  }

  //
  // used to export cleand unit JSON data
  //

  exportUnit () {
    const self = this;

    return {
      displayName:   self.displayName,
      itemId:        self.itemId,
      itemId1:       self.itemId1 && self.itemId1.toString(),
      itemId2:       self.itemId2 && self.itemId2.toString(),
      objectId1:     self.objectId1,
      objectId2:     self.objectId2,
      isRegistered:  self.isRegistered,
      isUnit:        self.isUnit,
      isBuilding:    self.isBuilding,
      isIllusion:    self.isIllusion,
      level:         self.knownLevel,
      levelStream:   self.levelStream,
      spellList:     self.spellList,
      lastPosition:  { x: self.currentX, y: self.currentY },
      spawnTime:     self.spawnTime,
      spawnPosition: self.spawnPosition,
      path:          self.path,
      moveHistory:   self.moveHistory,
      meta:          self.meta,

      items: self.getItemList().map(heroSlot => {
        const { item, slot } = heroSlot;

        const { 
          itemId, 
          displayName, 
          knownItemX, 
          knownItemY, 
          objectId1, 
          objectId2
        } = item;

        return {
          slot: slot,
          itemId, 
          displayName, 
          knownItemX, 
          knownItemY, 
          objectId1, 
          objectId2
        };
      }),
    };
  }

  //
  // debugging method
  //

  printUnit () {
    const self = this;
    console.logger("-----------------------------------------------------");
    console.logger("printing unit data:");
    console.logger(" * display name: ", this.displayName);
    console.logger(" * uuid:         ", this.uuid);
    console.logger(" * itemId:       ", this.itemId);
    console.logger(" * itemId1:      ", this.itemId1);
    console.logger(" * itemId2:      ", this.itemId2);
    console.logger(" * objectId1:    ", this.objectId1);
    console.logger(" * objectId2:    ", this.objectId2);
    console.logger(" * registered:   ", this.isRegistered ? "yes" : "no");

    console.logger(" * path len:     ", this.path.length);
    console.logger(" * spawnAtStart: ", this.isSpawnedAtStart ? "yes" : "no");

    if (this.isItem) {
      console.logger("* item slot:   ", this.itemSlotId);
      console.logger("* item x:   ", this.knownItemX);
      console.logger("* item y:   ", this.knownItemY);
    } else {
      const itemNameList = this.getItemList().map(heroSlot => {
        const { item, slot } = heroSlot;

        return `[${slot}] - ${item.displayName}`;
      });
      console.logger("items:        ", itemNameList);
    }

    
    console.logger("-----------------------------------------------------");
  }
};

module.exports = Unit;
