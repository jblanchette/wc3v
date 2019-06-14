const utils = require("../helpers/utils"),
      mappings = require("../helpers/mappings");

const Unit = require("./Unit")

const { 
	abilityActions,
	abilityFlagNames,
	mapStartPositions,
	specialBuildings
} = mappings;

const BuildingStates = {
	created: 0,
	building: 1,
	unsummoned: 2,
	completed: 3
};

const Building = class extends Unit {

	constructor (eventTimer, itemId1, itemId2, knownItemId, isSpawnedAtStart = false) {
		super(eventTimer, itemId1, itemId2, knownItemId, isSpawnedAtStart);

		this.buildEvent = null;
		this.buildState = BuildingStates.created;
		this.buildProgress = 0;
	}

	startConstruction () {
		this.buildState = BuildingStates.building;
	}

	buildOnTick (gameTime, delta) {

	}

	buildOnComplete () {
		
	}

	upgradeBuilding (newItemId) {
		const self = this;

		const onBuildingTick = (gameTime, delta)  => {
			console.log("building tick.");
		};

		const onBuildingComplete = (eventFinished) => {
			console.log("building upgrade complete, setting itemId: ", newItemId);
			self.itemId = newItemId;
			self.setUnitMeta();
		};

		const buildTime = mappings.buildTimings[newItemId] || 50;

		console.log("starting building upgrade:", newItemId, "build time: ", buildTime);
		this.moveInfo.timerEvent = this.eventTimer.addEvent(
			buildTime * utils.SECONDS_TO_MS, 
			onBuildingTick.bind(this),
			onBuildingComplete.bind(this)
		);
	}

	static isTavern (fixedItemId) {
		return (fixedItemId === specialBuildings.tavern);
	}

	static doAbilityRightClickWithTargetAndObjectId (
		player,
		focusUnit,
		objectId1,
		objectId2,
		targetX,
		targetY
	) {
		// check for ground clicks
		if (objectId1 === -1 && objectId2 === -1) {
			focusUnit.rallyPoint = {
				type: "ground",
				pt: {
					x: targetX,
					y: targetY
				},
				objectId1: null,
				objectId2: null
			};

			return;
		}

		// clicked on another unit
		focusUnit.rallyPoint = {
			type: "unit",
			pt: {
				x: targetX,
				y: targetY
			},
			objectId1: objectId1,
			objectId2: objectId2
		};

		if (!player.findUnitByObjectId(objectId1, objectId2)) {
			// unknown unit clicked as rally
			// probably a tree or goldmine, maybe a unit
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
		console.log("Building ability no target.");

		switch (abilityFlags) {
			case abilityFlagNames.CancelTrainOrResearch:
				// TODO: support a backlog queue of trained units
				//       we probably just need to remove the 'last added'
				//       from list for most cases

				if (!focusUnit.trainedUnits.length) {								
					// buildings that have no record of training a unit
					// should mean this building canceled itself while
					// it was being made.

					const buildingRemoveIndex = player.units.findIndex(unit => {
						return unit.itemId === focusUnit.itemId &&
									 (utils.isEqualItemId(unit.itemId1, focusUnit.itemId1) &&
									  utils.isEqualItemId(unit.itemId2, focusUnit.itemId2))
					});

					if (buildingRemoveIndex === -1) {
						console.error("Could not find building to cancel: ", focusUnit.itemId);
						return;
					}

					const removeBuilding = player.units[buildingRemoveIndex];
					console.log(player.id, "Removing canceled building: ", removeBuilding.displayName);

					player.units.splice(buildingRemoveIndex, 1);
					player.unregisteredUnitCount--;

					return;
				}

				const removeIndex = focusUnit.trainedUnits.findIndex(unit => {
					return !unit.completed;
				});
				const removeItem = focusUnit.trainedUnits[removeIndex];

				if (!removeItem) {
					console.error("Nothing to remove from training list?");
					console.log("Building: ", firstUnit);
					return;
				}

				const unitRemoveIndex = player.units.findIndex(unit => {
					return unit.itemId === removeItem.itemId &&
					       unit.itemId1 === null &&
					       unit.objectId1 === null;
				});

				if (unitRemoveIndex === -1) {
					// note: this is okay sometimes it seems.
					return;
				}

				const removeUnit = player.units[unitRemoveIndex];
				console.log("Removing non-finished unit: ", removeUnit.displayName);

				player.units.splice(unitRemoveIndex, 1);
				player.unregisteredUnitCount--;
			break;
		}


		const abilityActionName = utils.findItemIdForObject(itemId, abilityActions);

		switch (abilityActionName) {
			case 'NEUpRoot':
				console.log("building uprooted.");

				focusUnit.isUprooted = true;
			break;
			case 'NERoot':
				console.log("building rooted.");

				focusUnit.isUprooted = false;
			break;
			default:
				console.log("unable to find ability action name for building ability");
			break;
		}

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
				console.log(player.id, "Building is training a unit.", unitInfo.displayName);

				// building spawned a unit into world
				let newUnit = new Unit(player.eventTimer, null, null, itemId, false);
				focusUnit.trainedUnits.push({
					itemId: itemId,
					completed: false
				});

				console.log(player.id, "Making trained unit: ", newUnit.displayName);	

				player.addPlayerUnit(newUnit);
				player.unregisteredUnitCount++;
			break;

			// Train Units
			case abilityFlagNames.TrainUnit:
				if (unitInfo && unitInfo.isUnit) {
					if (unitInfo.isBuilding) {
						// building upgraded itself

						console.log("Building upgraded itself: ", unitInfo.displayName);
						focusUnit.upgradeBuilding(itemId);
					} else if (unitInfo.isUnit) {
						// building spawned a unit into world
						let newUnit = new Unit(player.eventTimer, null, null, itemId, false);

						// NOTE: for some unknown reason, TrainUnit actions
						//       can show up in a replay even when there
						//       was one previously issued - with no actions in between.
						//       
						//       heroes are unique units, so we just prevent
						//       the command issued from doing anything,
						//       and wait for an actual CancelTrainOrResearch action

						if (unitInfo.meta.hero) {
							console.log(1, "Making a hero.");

							const inTraining = focusUnit.trainedUnits.filter(unit => {
								return !unit.completed && unit.itemId === itemId;
							});

							if (inTraining.length) {
								console.log(1, "Stopping double hero train.");
								return;	
							}
							
							player.setHeroSlot(newUnit);
						}

						focusUnit.trainedUnits.push({
							itemId: itemId,
							completed: false
						});

						console.log(player.id, "Making trained unit: ", newUnit.displayName);		
						player.addPlayerUnit(newUnit);
						player.unregisteredUnitCount++;
					}
				}
			break;

			case abilityFlagNames.CancelTrainOrResearch:
				if (unitInfo.isItem) {
					console.log(player.id, "Hero bought an item: ", unitInfo.displayName);
					console.log(player.id, "Item objectIds: ", unknownA, unknownB);

					let rallyPoint = focusUnit.rallyPoint;
					if (rallyPoint && rallyPoint.type === "unit") {							
						let shopUnit = player.findUnitByObjectId(rallyPoint.objectId1, rallyPoint.objectId2);

						shopUnit.giveItem(itemId);
						console.log(player.id, "Shop has known unit rally, giving item: ", shopUnit.displayName );
					} else {
						console.log(player.id, "No known unit to give item to, try to find closest hero.");
						console.log(player.id, "Shop position: ", focusUnit.currentX, focusUnit.currentY);

						let heroes = player.units.filter(unit => {
							return unit.meta.hero;
						});

						let closestHero = utils.closestToPoint(
							focusUnit.currentX, 
							focusUnit.currentY,
							heroes
						);

						console.log(player.id, `Giving item ${unitInfo.displayName} to ${closestHero.displayName}`);
						closestHero.giveItem(itemId, false);
					}
				} else {
					focusUnit.upgradeBuilding(itemId);	
					console.log(
						player.id, 
						"Building researched upgrade: ", 
						focusUnit.displayName,
						unitInfo.displayName
					);
				}
			break;

			default:
				console.log("No match for hero ability flag");
				console.log("Hero name: ", focusUnit.displayName);
				console.log("Unit info for itemId: ", unitInfo);
			break;
		}
	}
};

module.exports = Building;
