const utils = require("../helpers/utils"),
      mappings = require("../helpers/mappings");

const Unit = require("./Unit"),
			PlayerActions = require("./PlayerActions");

const { 
	abilityActions,
	abilityFlagNames,
	mapStartPositions,
	specialBuildings,
	itemAbilityData,
	abilityToHero
} = mappings;

const Hero = class extends Unit {
	constructor (eventTimer, itemId1, itemId2, knownItemId, isSpawnedAtStart = false) {
		super(eventTimer, itemId1, itemId2, knownItemId, isSpawnedAtStart);
	}

	static getAbilitiesForHero (heroItemId) {
		return Object.keys(abilityToHero).filter(spellItemId => {
			const heroId = abilityToHero[spellItemId];

			return heroId === heroItemId;
		});
	}

	static addLevelEvent (unit, newSkill, spellId) {
		const levelEvent = {
			gameTime: unit.eventTimer.timer.gameTime,
			position: { x: unit.currentX.toFixed(2), y: unit.currentY.toFixed(2) },
			newSkill: { displayName: newSkill.displayName, level: newSkill.level },
			oldLevel: unit.knownLevel,
			newLevel: (unit.knownLevel + 1),
			learnedSkills: JSON.parse(JSON.stringify(unit.learnedSkills)),
			slot: unit.spellList.indexOf(spellId)
		};

		unit.levelStream.push(levelEvent);
	}

	static doMoveItem (
		player,
		firstUnit,
		itemId,
		objectId1,
		objectId2,
		targetX,
		targetY
	) {
		const abilityActionName = utils.findItemIdForObject(itemId, abilityActions);
		const itemSlot = abilityActionName.substring(abilityActionName.length - 1);
		const heroItems = firstUnit.getItemList();
		const itemCount = heroItems.length;

		console.logger(player.id, "Hero moving item: ", firstUnit.displayName, "Dest slot:", itemSlot);
		firstUnit.printUnit();

		const knownItem = heroItems.find(heroSlot => {
			const { item } = heroSlot;

			return (item.objectId1 === objectId1 &&
						  item.objectId2 === objectId2) ||
						 (item.knownItemX === targetX &&
						  item.knownItemY === targetY);
		});

		if (itemCount === 1) {
			const slotItem = heroItems[0];

			slotItem.item.registerKnownItem(objectId1, objectId2, targetX, targetY);
			player.world.clearKnownItem(objectId1, objectId2);

			// empty old slot
			firstUnit.setItemSlot(slotItem.slot, null);
			// move item into new slot
			firstUnit.setItemSlot(itemSlot, slotItem.item);

			console.logger(this.id, `${firstUnit.displayName} moved only item ${slotItem.item.displayName} to slot ${itemSlot}`);
			slotItem.item.printUnit();
			return;

		}

		let destinationItem = firstUnit.items[itemSlot];
		if (destinationItem) {
			// we have an item to swap places with
			// try to figure out what that item is

			console.logger(player.id, `${firstUnit.displayName} moving item ${destinationItem.displayName} in slot ${itemSlot}`);
			let swapCandidates = heroItems.filter(heroItem => {
				return heroItem.slot !== itemSlot;
			});

			if (swapCandidates.length === 1) {
				const swapSlot = swapCandidates[0];
				const swapItem = swapSlot.item;

				console.logger(this.id, "Swapping with only other item: ", swapItem.displayName);
				swapItem.registerKnownItem(objectId1, objectId2, targetX, targetY);
				player.world.clearKnownItem(objectId1, objectId2);

				// move item that is being swapped
				firstUnit.setItemSlot(swapSlot.slot, destinationItem);
				// swap our item into place
				firstUnit.setItemSlot(itemSlot, swapItem);
			}

			return;
		}

		// no item in the desintation item slot, move ours and clear our the old slot

		console.logger(player.id, "Hero has nothing to swap item with, just put it in place. Slot moved: ", itemSlot);
		if (knownItem) {
			console.logger(player.id, "Known item being swapped: ", knownItem.item.displayName);
			console.logger("current known slot: ", knownItem.slot, "Moving to slot: ", itemSlot);
					
			player.world.clearKnownItem(objectId1, objectId2);

			firstUnit.setItemSlot(knownItem.slot, null);
			firstUnit.setItemSlot(itemSlot, knownItem.item);

			console.logger(this.id, `Put item ${knownItem.item.displayName} into slot ${itemSlot}`);
			return;

		}

		console.logger(this.id, "Did not find known item to move, checking possible...");
		const unknownWorldObject = player.world.findUnknownObject(objectId1, objectId2);
		if (unknownWorldObject) {
			// backfill this item into our hero
			const givenItem = player.giveItem(firstUnit, 'Jwid', false, false, itemSlot);
			givenItem.registerKnownItem(objectId1, objectId2, targetX, targetY);

			givenItem.printUnit();
			return;
		}

		let unregisteredSwapItem = heroItems.find(heroItem => {
			const item = heroItem.item;

			return heroItem.slot !== itemSlot &&
						 (item.objectId1 === objectId1 && item.objectId2 === objectId2) ||
						 (item.knownItemX === targetX && item.knownItemY === targetY);
		});

		if (unregisteredSwapItem) {
			console.logger(player.id, "Found potential unregistered item to assign swap to: ", unregisteredSwapItem.item.displayName);
			unregisteredSwapItem.item.registerKnownItem(objectId1, objectId2, targetX, targetY);
			player.world.clearKnownItem(objectId1, objectId2);

			firstUnit.setItemSlot(unregisteredSwapItem.slot, null);
			firstUnit.setItemSlot(itemSlot, unregisteredSwapItem);

			// mark that we weren't confident about the item swap
			player.reduceParseConfidence('Minor');

			console.logger(player.id, `Put item ${unregisteredSwapItem.item.displayName} into slot ${itemSlot}`);
			return;						
		}

		console.logger(player.id, "Unable to find unregistered item in slot: ", itemSlot);
		let unregisteredItems = heroItems.filter(heroItem => {
			return heroItem.item.objectId1 === null ||
			       heroItem.item.knownItemX === null;
		});

		if (unregisteredItems.length === 1) {
			console.logger("only found one unregistered item, so lets move it");

			const swapSlot = unregisteredItems[0];
			const swapItem = swapSlot.item;

			swapItem.registerKnownItem(objectId1, objectId2, targetX, targetY);
			player.world.clearKnownItem(objectId1, objectId2);

			firstUnit.setItemSlot(swapSlot.slot, null);
			firstUnit.setItemSlot(itemSlot, swapItem);

			console.logger(player.id, `Put item ${swapItem.displayName} into slot ${itemSlot}`);
			return;					
		}

		//
		// more than one unregistered item, try swapping
		//

		// note: for some reason the game sets non-integer values
		//       on items that were bought at player shops,
		//       so we use this to help guide our unreg choices.
		const itemFromShop = utils.getDecimalPortion(targetX) !== 0;
		const swapSlot = unregisteredItems.find(slot => {
			const { item } = slot;

			const isFromShop = !item.isSpawnedAtStart;
			return (itemFromShop === isFromShop);
		});

		if (swapSlot) {
			const { item, slot } = swapSlot;
			item.printUnit();

			item.registerKnownItem(objectId1, objectId2, targetX, targetY);
			player.world.clearKnownItem(objectId1, objectId2);

			firstUnit.setItemSlot(slot, null);
			firstUnit.setItemSlot(itemSlot, item);

			// mark that we weren't confident about the item swap
			player.reduceParseConfidence('Minor');
			console.logger(`Put item ${item.displayName} into slot ${slot}`);
			return;
		}
			
		// mark that we couldn't find a valid swap spot for the item
		player.reduceParseConfidence('Major');
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

		if (!focusUnit) {
			console.logger("CRITICAL - unable to find hero for castSummon spell");	
			player.reduceParseConfidence('Critical');
			return;
		}

		const spellData = focusUnit.getSkillForType("summon");

		if (!spellData) {
			console.logger("no mapped summon spell for unit: ", focusUnit.displayName);

			player.reduceParseConfidence('Tiny');
			return;
		}

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
					PlayerActions.handleSummonDestroy(
						player,
						unit,
						snapshot
					)();
					
					delete existingSummons[uuid];
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

				Hero.addLevelEvent(focusUnit, spell, itemId);
				player.addEvent('HeroLevel', {
					unit: focusUnit.exportUnitReference(),
					spell: spell,
					oldLevel: focusUnit.knownLevel,
					newLevel: (focusUnit.knownLevel + 1)
				});

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
