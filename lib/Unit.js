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
		this.eventTimer = eventTimer;
		this.itemId1 = itemId1;
		this.itemId2 = itemId2;

		this.objectId1 = null;
		this.objectId2 = null;

		this.itemId = knownItemId || null;

		const spawnedAtStartCheck = (itemId1 !== null) && utils.isEqualItemId(itemId1, itemId2);
		this.isSpawnedAtStart = isSpawnedAtStart || spawnedAtStartCheck;

		this.summonDuration = summonDuration;

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

		// item stuff
		this.knownOwner = false;
		this.knownItemX = null;
		this.knownItemY = null;

		// set unit info + meta
		this.setUnitMeta();
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

	registerItemIds (itemId1, itemId2) {
		this.itemId1 = itemId1;
		this.itemId2 = itemId2;

		const badA = [-34, -107, 0, 0];
		const badB = [ 96, -123, 0, 0 ];
		const badC = [ 67, 65, 0, 0 ];

		if (utils.isEqualItemId(this.itemId2, badA)) {
			console.logger("found bad one A");
			//throw new Error("here 2");
		}

		if (utils.isEqualItemId(this.itemId2, badB)) {
			console.logger("found bad one B");
			//throw new Error("here 2");
		}

		if (utils.isEqualItemId(this.itemId1, badC)) {
			console.logger("found bad one C");
			//throw new Error("here 2");
		}


		this.hasBeenInGroup = true;
	}

	registerObjectIds (objectId1, objectId2) {
		this.objectId1 = objectId1;
		this.objectId2 = objectId2;

		if (this.objectId1 === this.objectId2 &&
			  !this.isSpawnedAtStart) {
			this.isSpawnedAtStart = true;
		}

		this.hasBeenInGroup = true;
	}

	registerKnownItem (x, y) {
		this.knownItemX = x;
		this.knownItemY = y;
	}

	registerUnit (itemId, objectId1, objectId2) {
		this.itemId = itemId;
		this.objectId1 = objectId1;
		this.objectId2 = objectId2;

		if (this.objectId1 === this.objectId2 &&
			  !this.isSpawnedAtStart) {
			this.isSpawnedAtStart = true;
		}

		this.setUnitMeta();
		this.hasBeenInGroup = true;

		if (this.objectId1 && this.objectId2) {
			console.logger("setting fully registered unit");
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

	giveItem (itemId, knownOwner = true) {
		const itemSlotId = this.getNextItemSlot();		

		let newItem = new Unit(this.eventTimer, null, null, itemId, false);
		newItem.knownOwner = knownOwner;
		
		this.items[itemSlotId] = newItem;
	}

	tradeItem (item) {
		const itemSlotId = this.getNextItemSlot();

		this.items[itemSlotId] = item;
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

		return skillKey && mappings.heroAbilities[skillKey] || null;
	}

	recordMoveHistory () {
		let history = this.moveInfo;
		// remove non-data properties

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
				self.currentX = x;
				self.currentY = y;
			}
		});
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
		console.logger(`unit moveTo called.  ${this.displayName} current pos: (${this.currentX}, ${this.currentY})`);
		console.logger(`moving to: (${targetX}, ${targetY})`);

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
			path:          self.path,
			moveHistory:   self.moveHistory,
			meta:          self.meta,

			items: self.getItemList().map(slot => {
				return slot.item.displayName;
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
		console.logger(" * itemId:       ", this.itemId);
		console.logger(" * itemid1:      ", this.itemId1);
		console.logger(" * itemid2:      ", this.itemId2);
		console.logger(" * objectid1:    ", this.objectId1);
		console.logger(" * objectid2:    ", this.objectId2);

		console.logger(" * path len:     ", this.path.length);

		const itemNameList = this.getItemList().map(slot => {
			return slot.item.displayName;
		});

		console.logger("items:        ", itemNameList);
		console.logger("-----------------------------------------------------");
	}
};

module.exports = Unit;
