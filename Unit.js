const mappings = require("./mappings");
const utils = require("./utils");

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
	constructor (itemId1, itemId2, knownItemId, isSpawnedAtStart = false ) {
		this.itemId1 = itemId1;
		this.itemId2 = itemId2;

		this.objectId1 = null;
		this.objectId2 = null;

		this.itemId = knownItemId || null;

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

		this.path = [];
		this.state = null;

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

		this.learnedSkills = {};
		this.knownLevel = 0;

		// item stuff
		this.knownOwner = false;
		this.knownItemX = null;
		this.knownItemY = null;

		// set unit info + meta
		this.setUnitMeta();
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

		this.hasBeenInGroup = true;
	}

	registerObjectIds (objectId1, objectId2) {
		this.objectId1 = objectId1;
		this.objectId2 = objectId2;

		this.isSpawnedAtStart = this.objectId1 === this.objectId2;

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

		this.isSpawnedAtStart = this.objectId1 === this.objectId2;

		this.setUnitMeta();
		this.hasBeenInGroup = true;
	}

	upgradeBuilding (newItemId) {
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

		let newItem = new Unit(null, null, itemId, false);
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

	moveTo (targetX, targetY) {
		this.state = "walking";

		this.path.push({
			x: targetX,
			y: targetY
		});

		this.currentX = targetX;
		this.currentY = targetY;
	}
};

module.exports = Unit;