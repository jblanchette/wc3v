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

		console.log("set unit spawned: ", this.isSpawnedAtStart, this.displayName);
	}

	printUnit () {
		const self = this;
		console.log("unit data:");
		console.log("display name: ", this.displayName);
		console.log("itemId:       ", this.itemId);
		console.log("itemid1:      ", this.itemId1);
		console.log("itemid2:      ", this.itemId2);
		console.log("objectid1:    ", this.objectId1);
		console.log("objectid2:    ", this.objectId2);

		const itemNameList = this.getItemList().map(slot => {
			return slot.item.displayName;
		});

		console.log("items:        ", itemNameList);
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
			console.log("found bad one A");
			//throw new Error("here 2");
		}

		if (utils.isEqualItemId(this.itemId2, badB)) {
			console.log("found bad one B");
			//throw new Error("here 2");
		}

		if (utils.isEqualItemId(this.itemId1, badC)) {
			console.log("found bad one C");
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
			console.log("setting fully registered unit");
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
		// don't include timer class
		history.timerEvent = null;

		this.moveHistory.push(history);
	}

	recordPosition () {
		this.path.push({
			x: this.currentX,
			y: this.currentY
		});
	}

	moveToBuild (building, onComplete) {
		if (this.state === "walking") {
			// we detected the unit had been walking
			// and the player cancelled the action by 
			// sending another move command.

			console.log("stopping walking event before moveToBuild", this.state);
			console.log("move info: ", this.moveInfo);

			this.eventTimer.cancelEvent(this.moveInfo.timerEvent);

			if (this.moveInfo.onCompleteExtra) {
				this.moveInfo.onCompleteExtra(false);
			}

			this.state = "idle";
		}

		console.log("calling moveTo from build");
		this.moveTo(building.currentX, building.currentY, onComplete);
	}

	moveTo (targetX, targetY, onCompleteExtra = null) {
		if (this.state === "walking") {
			// we detected the unit had been walking
			// and the player cancelled the action by 
			// sending another move command.

			console.log("stopping walking event before moveTo");
			this.eventTimer.cancelEvent(this.moveInfo.timerEvent);

			if (this.moveInfo.onCompleteExtra) {
				this.moveInfo.onCompleteExtra(false);
			}
		}

		this.state = "walking";

		const pathDistance = utils.distance(
			this.currentX, this.currentY,
			targetX, targetY
		);

		const pathTime = (pathDistance / this.meta.movespeed);

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

		if (pathTime > 3) {
			console.log("*** unit is walking long path time: ", pathTime);
		}

		console.log("adding timer event for move");
		this.moveInfo.timerEvent = this.eventTimer.addEvent(
			pathTime * utils.SECONDS_TO_MS, 
			this.moveOnTick.bind(this), 
			this.moveOnComplete.bind(this)
		);

		if (this.isSpawnedAtStart && !this.path.length) {
			// until we add spawn position detection,
			// make spawned units first move just auto go to their spot
			console.log("moving spawned unit to spot", targetX, targetY);

			this.currentX = targetX;
			this.currentY = targetY;

			console.log("calling cancel event for spawn at start / no path");
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

		console.log("move on complete. ", this.moveInfo);
		console.log("ending position: ", this.currentX, this.currentY);
		this.state = "idle";

		this.recordPosition();
		this.recordMoveHistory();

		if (onCompleteExtra) {
			console.log("runnning on complete extra");
			onCompleteExtra(eventFinished);
		}

		this.clearMoveInfo();
	}
};

module.exports = Unit;
