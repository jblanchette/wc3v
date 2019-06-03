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
	constructor (eventTimer, itemId1, itemId2, knownItemId, isSpawnedAtStart = false ) {
		this.eventTimer = eventTimer;
		this.itemId1 = itemId1;
		this.itemId2 = itemId2;

		this.objectId1 = null;
		this.objectId2 = null;

		this.itemId = knownItemId || null;

		if (this.itemId === "Udea") {
			console.log("JEFF");
		}

		const spawnedAtStartCheck = (itemId1 !== null) && utils.isEqualItemId(itemId1, itemId2);
		this.isSpawnedAtStart = isSpawnedAtStart || spawnedAtStartCheck;

		this.displayName = null;
		this.isBuilding = false;
		this.isUnit = false;
		this.isItem = false;

		// non-selectable things on the map
		// like trees
		
		this.hasBeenInGroup = false;

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
		console.log("items:        ", this.getItemList());
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
			yVelocity: 0
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

		if (utils.isEqualItemId(this.itemId2, badA)) {
			console.log("found bad one A");
			//throw new Error("here 2");
		}

		if (utils.isEqualItemId(this.itemId2, badB)) {
			console.log("found bad one B");
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
		if (itemId === "Udea") {
			console.log("detected hero register");
		}

		this.itemId = itemId;
		this.objectId1 = objectId1;
		this.objectId2 = objectId2;

		if (this.objectId1 === this.objectId2 &&
			  !this.isSpawnedAtStart) {
			this.isSpawnedAtStart = true;
		}

		this.setUnitMeta();
		this.hasBeenInGroup = true;
	}

	upgradeBuilding (newItemId) {
		if (newItemId === "Udea") {
			console.log("detected hero register");
		}

		this.itemId = newItemId;

		this.setUnitMeta();
		this.hasBeenInGroup = true;
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

	moveTo (targetX, targetY) {
		if (this.state === "walking") {
			console.log("JEFF: detected unit already walking, cancelling.");
			this.eventTimer.cancelEvent(this.moveInfo.timerEvent);
		}

		this.state = "walking";

		const pathDistance = utils.distance(
			this.currentX, this.currentY,
			targetX, targetY
		);

		const pathTime = (pathDistance / this.meta.movespeed);

		console.log(
			"unit walking: ", this.displayName, 
			"d:", pathDistance, 
			"t: ", pathTime
		);

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
			yVelocity: (Math.abs(targetY - this.currentY) / pathTime)
		};

		if (this.isSpawnedAtStart && !this.path.length) {
			this.currentX = targetX;
			this.currentY = targetY;
			this.state = "idle";

			this.recordPosition();
			return;
		}

		this.moveInfo.timerEvent = this.eventTimer.addEvent(
			pathTime * utils.SECONDS_TO_MS, 
			this.moveOnTick.bind(this), 
			this.moveOnComplete.bind(this)
		);
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

		this.recordPosition();
	}

	moveOnComplete () {
		console.log("unit finished walking: ", this.displayName);
		this.state = "idle";

		// if we got to the complete event,
		// just set their position
		this.currentX = this.moveInfo.targetX;
		this.currentY = this.moveInfo.targetY;

		this.recordMoveHistory();
	}
};

module.exports = Unit;