const utils = require("../helpers/utils"),
      mappings = require("../helpers/mappings");

const Unit = require("./Unit"),
			PlayerActions = require("./PlayerActions");

const { 
	abilityActions,
	abilityFlagNames,
	mapStartPositions,
	specialBuildings,
	itemAbilityData
} = mappings;

const Hero = class extends Unit {
	constructor (eventTimer, itemId1, itemId2, knownItemId, isSpawnedAtStart = false) {
		super(eventTimer, itemId1, itemId2, knownItemId, isSpawnedAtStart);

		this.isIllusion = false;

		
	}

	static doAbilityRightClickWithTargetAndObjectId (
		player,
		focusUnit,
		objectId1,
		objectId2,
		targetX,
		targetY
	) {
		console.logger(player.id, "hero clicked on an object:", focusUnit.displayName);
		let droppedItem = player.world.findDroppedItem(objectId1, objectId2);

		if (droppedItem) {
			console.logger(player.id, "Found a dropped item in the world: ", droppedItem.displayName);

			focusUnit.tradeItem(droppedItem);
			player.world.removeDroppedItem(objectId1, objectId2);
		} else {
			// add unknown object to world track list
			console.logger(player.id, "Added unknown object / potential item to world.", objectId1, objectId2);
			player.world.addUnknownObject(objectId1, objectId2);
		}
	}

	static castSummon (
		player,
		focusUnit
	) {
		const spellData = focusUnit.getSkillForType("summon");

		let { 
			skillKey,
			summonCount, 
			summonItemId, 
			summonDuration,
			summonUnique
		} = spellData;

		if (Array.isArray(summonItemId)) {
			const levelSlot = spellData.level - 1;
			summonItemId = summonItemId[levelSlot];
		}

		console.logger("called castSummon", skillKey);
		
		if (summonUnique) {
			console.logger("checking for unique summons...");

			const existingSummons = focusUnit.spells[skillKey];
			const existingSummonIds = existingSummons && Object.keys(existingSummons);

			if (existingSummonIds && existingSummonIds.length) {
				existingSummonIds.forEach(uuid => {
					const item = existingSummons[uuid];
					const { unit, snapshot } = item;

					console.logger("destroying existing uniq summon...", uuid);
					
					delete existingSummons[uuid];
					PlayerActions.handleSummonDestroy(
						player,
						unit,
						snapshot
					);
				});
			} else {
				console.logger("no uniq summon exists");
			}
		}

		player.printUnits();
		const snapshot = player.getUnitSnapshot();

		for (let i = 0; i < summonCount; i++) {
			const summonUnit = new Unit(player.eventTimer, null, null, summonItemId, false, summonDuration);
				
			summonUnit.setSummonDestroyHandler(PlayerActions.handleSummonDestroy(
				player,
				summonUnit,
				snapshot
			));
	
			if (summonUnique) {
				if (!focusUnit.spells[skillKey]) {
					focusUnit.spells[skillKey] = {};
				} 

				focusUnit.spells[skillKey][summonUnit.uuid] = {
					unit: summonUnit,
					snapshot: player.getUnitSnapshot()
				};
			}

			player.addPlayerUnit(summonUnit);
			player.unregisteredUnitCount++;
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
			case 'CastSummonSkillNoTarget':
				console.logger("Unit called summon skill: ", focusUnit.displayName);
				Hero.castSummon(player, focusUnit);
			break;

			case 'HeroItem1':
			case 'HeroItem2':
			case 'HeroItem3':
			case 'HeroItem4':
			case 'HeroItem5':
			case 'HeroItem6':
				let itemSlot = abilityActionName.substring(abilityActionName.length - 1);

				console.logger(player.id, "Used item slot: ", itemSlot);
				let heroItem = focusUnit.items[itemSlot];

				if (!heroItem) {
					console.logger("Used item but hero had null item slot.", focusUnit.displayName);

					const heroItems = focusUnit.getItemList();
					console.logger("Possible items: ", heroItems.map(item => { return item.item.displayName; }));

					return;
				}
					
				console.logger(player.id, "Item used: ", heroItem.displayName);
				const itemData = itemAbilityData[heroItem.itemId];

				if (itemData) {
					console.logger("found item data: ", itemData);

					if (itemData.ability !== 0x10) {
						console.logger("detected wrong item ability type...");

						focusUnit.printUnit();
					}

					if (heroItem.onCooldown) {
						console.logger("WARNING - detected item on cooldown... not using");
						return;
					}

					switch (itemData.type) {
						case "summon":
							const { 
								uses,
								summonCount, 
								summonItemId, 
								summonDuration 
							} = itemData;
							const snapshot = player.getUnitSnapshot();
							
							for (let i = 0; i < summonCount; i++) {
								const newUnit = new Unit(player.eventTimer, null, null, summonItemId, false, summonDuration);
								console.logger("summoning unit: ", newUnit.displayName, newUnit.uuid);

								newUnit.setSummonDestroyHandler(PlayerActions.handleSummonDestroy(
									player,
									newUnit,
									snapshot
								));

								player.addPlayerUnit(newUnit);
							}

							PlayerActions.setItemCooldown(player, heroItem);
						break;
					}

					if (heroItem.expires) {
						console.logger("used an expiring item, checking uses:", heroItem.displayName, heroItem.uuid, heroItem.usesLeft);
						heroItem.usesLeft -= 1;

						console.logger("item uses left: ", heroItem.usesLeft);

						if (heroItem.usesLeft <= 0) {
							console.logger("used last charge of item, removing from slot:", itemSlot);

							focusUnit.setItemSlot(itemSlot, null);
						}
					}

				}

			break;

			case 'SummonElemental':
				console.logger("summon elemental was cast");
				Hero.castSummon(player, focusUnit);
			break;

			default:
				console.logger("Unknown hero ability with no target.");
				console.logger("Hero: ", focusUnit.displayName);
				console.logger("Item ID: ", itemId);
				console.logger("Ability flags: ", abilityFlags);
				console.logger("***************************");
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
				if (!spell) {
					console.logger(`Unable to find spell for: ${itemId}`);
					return;
				}

				if (!focusUnit.learnedSkills[itemId]) {
					// learning first level
					spell.level = 1;

					focusUnit.learnedSkills[itemId] = spell;
					console.logger("%% Learned spell: ", spell);
				} else {
					focusUnit.learnedSkills[itemId].level++;
					console.logger("Leveled up skill: ", focusUnit.learnedSkills[itemId]);
				}

				focusUnit.knownLevel++;

				console.logger(player.id, "Hero leveled up: ", focusUnit.displayName, focusUnit.knownLevel);
			break;

			default:
				console.logger("No match for hero ability flag");
				console.logger("Hero name: ", focusUnit.displayName);
				console.logger("Unit info for itemId: ", unitInfo);
			break;	
		}

	}
};

module.exports = Hero;
