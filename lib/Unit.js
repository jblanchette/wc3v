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
		this.knownLevel = 0;

		this.spells = {};

		// item stuff
		this.knownOwner = false;
		this.knownItemX = null;
		this.knownItemY = null;

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

		this.recordPosition();
	}

	startSummonTimer () {
		console.logger("starting summon timer:", this.uuid, this.displayName);

		if (this.summonEvent) {
			console.logger("error - already has summon event?");
			throw new Error("summon called twice");
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
		console.logger("summon on complete:", this.uuid, this.displayName);

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
			throw new Error("tried to assign to destroyed unit");
		}
	}

	unregisterObjectIds () {
		console.logger("unregister objectIds:", this.objectId1, this.objectId2);

		this.objectId1 = null;
		this.objectId2 = null;

		this.isRegistered = false;
	}

	unregisterItemIds () {
		console.logger("unregister itemIds:", this.itemId1, this.itemId2);

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

		console.logger("objid reg:", objectId1, objectId2);

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

		console.logger("objid reg:", objectId1, objectId2);

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
			console.logger("setting fully registered unit", this.uuid);
			console.logger("unit reg:", this.itemId1, this.itemId2, this.objectId1, this.objectId2);
			console.logger("unit reg objectIds:", this.objectId1, this.objectId2);
			this.isRegistered = true;
		}
	}

	getNextItemSlot () {
		let itemSlotId = Object.keys(this.items).find(key => {
			return this.items[key] === null;
		});

		if (itemSlotId === -1) {
			console.error("Unable to find item slot for unit. ", self.displayName, itemId);
			throw new Error("Unable to slot item.");

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

		console.logger("trading hero item: ", item.displayName);

		if (item) {
			// item cooldowns reset when you trade items
			console.logger("reset item cooldown state from trade");
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
		console.logger("learned skills: ", this.learnedSkills);
		
		let skillKey = Object.keys(this.learnedSkills).find(key => {
			let learnedSkill = this.learnedSkills[key];

			return learnedSkill.type === skillType;
		});

		return skillKey && {...mappings.heroAbilities[skillKey], skillKey: skillKey} || null;
	}

	recordMoveHistory () {
		let history = this.moveInfo;
		// remove non-data properties

		if (!history.timerEvent) {
			console.logger("ERROR: missing timer event");
			this.printUnit();
		}

		const { 
			startTime, 
			endTime, 
			runLength,
			completed,
			cancelled
		} = history.timerEvent;

		delete history.timerEvent;
		delete history.onCompleteExtra;

		history.timerData = {
			startTime, 
			endTime, 
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
			y: +this.currentY.toFixed(2)
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

	reviveAtSpot (targetX, targetY) {
		this.currentX = targetX;
		this.currentY = targetY;

		if (this.moveInfo.timerEvent) {
			// stop all moving
			this.eventTimer.cancelEvent(this.moveInfo.timerEvent);
			this.clearMoveInfo();
		}

		// start a moveTo that should just finish instantly
		this.moveTo(targetX, targetY);
	}

	moveToBuild (building, onComplete) {
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

		this.moveTo(building.currentX, building.currentY, onComplete);
	}

	moveTo (targetX, targetY, onCompleteExtra = null) {
		if (this.state === "walking") {
			// we detected the unit had been walking
			// and the player cancelled the action by 
			// sending another move command.

			this.eventTimer.cancelEvent(this.moveInfo.timerEvent);
			this.clearMoveInfo();
		}

		this.state = "walking";

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

		console.logger("unit move info - time:", pathTime, "dist:", pathDistance);

		this.moveInfo.timerEvent = this.eventTimer.addEvent(
			pathTime * utils.SECONDS_TO_MS, 
			this.moveOnTick.bind(this), 
			this.moveOnComplete.bind(this)
		);

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

	moveOnComplete (eventFinished) {
		const { targetX, targetY, timerEvent, onCompleteExtra } = this.moveInfo;
		this.state = "idle";

		if (eventFinished) {
			this.currentX	= targetX;
			this.currentY = targetY;
		}

		this.recordPosition();
		this.recordMoveHistory();

		if (onCompleteExtra) {
			onCompleteExtra(eventFinished);
		}
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
			lastPosition:  { x: self.currentX, y: self.currentY },
			spawnTime:     self.spawnTime,
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
