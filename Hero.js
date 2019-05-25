const utils = require("./utils"),
      mappings = require("./mappings");

const Unit = require("./Unit");

const { 
	abilityActions,
	abilityFlagNames,
	mapStartPositions,
	specialBuildings
} = mappings;

const Hero = class extends Unit {
	static doAbilityRightClickWithTargetAndObjectId (
		player,
		focusUnit,
		objectId1,
		objectId2,
		targetX,
		targetY
	) {

		if (objectId1 === -1 && objectId2 === -1) {
			console.log(player.id, "moving unit(s)");
			player.units.forEach(unit => {
				unit.moveTo(targetX, targetY);
			});

			return;
		}
		
		console.log(player.id, "hero clicked on an object.");
		let droppedItem = player.world.findDroppedItem(objectId1, objectId2);

		if (droppedItem) {
			console.log(player.id, "Found a dropped item in the world: ", droppedItem.displayName);

			focusUnit.tradeItem(droppedItem);
			player.world.removeDroppedItem(objectId1, objectId2);
		} else {
			// add unknown object to world track list
			console.log(player.id, "Added unknown object to world.");
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
		const abilityActionName = utils.findItemIdForObject(itemId, abilityActions);

		switch (abilityActionName) {
			case 'CastSummonSkill':
				console.log("Unit called summon skill: ", focusUnit.displayName);

				let skill = focusUnit.getSkillForType("summon");
				console.log("Skill: ", skill);

				if (!skill) {
					console.error("Cound not find skill.", focusUnit);
					return;
				}

				const {summonCount, summonItemId } = skill;
				for (let i = 0; i < summonCount; i++) {
					console.log("Making unit: ", i, summonItemId);

					let summonUnit = new Unit(null, null, summonItemId, false);
					
					player.units.push(summonUnit);
					player.unregisteredUnitCount++;
				}
			break;

			case 'HeroItem1':
			case 'HeroItem2':
			case 'HeroItem3':
			case 'HeroItem4':
			case 'HeroItem5':
			case 'HeroItem6':
				let itemSlot = abilityActionName.substring(abilityActionName.length - 1);

				console.log(player.id, "Used item slot: ", itemSlot);
				let heroItem = focusUnit.items[itemSlot];

				if (!heroItem) {
					console.log("Used item but hero had null item slot.");

					const heroItems = focusUnit.getItemList();

					console.log("Possible items: ", heroItems.map(item => { return item.item.displayName; }));

				} else if (heroItem &&
					heroItem.objectId1 === unknownA &&
					heroItem.objectId2 === unknownB) {
					
					console.log(player.id, "Item used: ", heroItem.displayName);
				} else {
					console.log(player.id, "Item object mismatch. Item in wrong slot:", heroItem.displayName);
				}
			break;

			default:
				console.log("Unknown hero ability with no target.");
				console.log("Hero: ", focusUnit.displayName);
				console.log("Item ID: ", itemId);
				console.log("Action: ", action);
				console.log("***************************");
			break;
		};
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
				let spell = mappings.heroAbilities[itemId];
				if (!focusUnit.learnedSkills[itemId]) {
					// learning first level
					spell.level = 1;

					focusUnit.learnedSkills[itemId] = spell;
					console.log("%% Learned spell: ", spell);
				} else {
					focusUnit.learnedSkills[itemId].level++;
					console.log("Leveled up skill: ", focusUnit.learnedSkills[itemId]);
				}

				focusUnit.knownLevel++;

				console.log(player.id, "Hero leveled up: ", focusUnit.displayName, focusUnit.knownLevel);
			break;

			default:
				console.log("No match for hero ability flag");
				console.log("Hero name: ", focusUnit.displayName);
				console.log("Unit info for itemId: ", unitInfo);
			break;	
		}

	}
};

module.exports = Hero;