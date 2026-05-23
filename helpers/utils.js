const fs = require('fs'),
      path = require('path'),
      zlib = require('zlib');

const config = require('../config/config');

const logManager = require("./logManager");

////
// check if two [itemId] lists are equal
////
const isEqualItemId = (itemIdA, itemIdB) => {
	if (itemIdA === null && itemIdB === null) {
		return true;
	} else if (itemIdA === null || itemIdB === null) {
		return false;
	}

	// plain number comparison (w3gjs v3 readNetTag returns uint32)
	if (typeof itemIdA === 'number' && typeof itemIdB === 'number') {
		return itemIdA === itemIdB;
	}

	// mismatched types — never equal
	if (typeof itemIdA !== typeof itemIdB) {
		return false;
	}

	// array/buffer comparison (w3gjs readFourCC returns [uint8, uint8, uint8, uint8])
	if (itemIdA.length !== itemIdB.length) {
		return false;
	}
	for (let i = 0; i < itemIdA.length; i++) {
		if (itemIdA[i] !== itemIdB[i]) {
			return false;
		}
	}

	return true;
};


////
// helper to check if two given Unit's have equal itemId1 / itemId2 lists
////

const isEqualUnitItemId = (unitA, unitB) => {
  if (!unitA || !unitB) {
    return false;
  }
  
  return isEqualItemId(unitA.itemId1, unitB.itemId1) &&
         isEqualItemId(unitA.itemId2, unitB.itemId2);
};

////
// helper to check if a given unit is in a list
////

const isUnitInList = (data, unit) => {
  return data.find(item => {
    const listUnit = { itemId1: item.itemId1, itemId2: item.itemId2 };

    return isEqualUnitItemId(unit, listUnit);
  });
}

////
// helper to check if a given itemId is in a list
////

const isItemIdInList = (data, itemId1, itemId2) => {
  const unit = { itemId1, itemId2 };

  return isUnitInList(data, unit);
}

////
// the replay parsing engine returns the itemId (string) backwards
////

const fixItemId = (itemId) => {
  // TODO: new version of parser doesn't have this bug anymore, remove this
	return itemId;
};

//
// parser library incorrectly formats itemIds and
// it seems this will not ever change for unknown reasons
//
/**
 * Normalize w3gjs v3 action format to the v2 format expected by our code.
 * v3 changes: orderId→itemId, target→targetX/Y, object→objectId1/2,
 * units→actions, unit/item→objectId/itemObjectId (0x13).
 */
const normalizeAction = (action) => {
  // v3: orderId replaces itemId for ability actions (0x10-0x14)
  if (action.orderId !== undefined && action.itemId === undefined) {
    action.itemId = action.orderId;
    delete action.orderId;
  }

  // v3: target is [x, y] instead of targetX, targetY
  if (Array.isArray(action.target)) {
    action.targetX = action.target[0];
    action.targetY = action.target[1];
    delete action.target;
  }

  // v3: object is [id1, id2] instead of objectId1, objectId2
  if (Array.isArray(action.object) && action.objectId1 === undefined) {
    action.objectId1 = action.object[0];
    action.objectId2 = action.object[1];
    delete action.object;
  }

  // v3 action 0x13: unit→objectId1/2, item→itemObjectId1/2
  if (Array.isArray(action.unit) && action.objectId1 === undefined) {
    action.objectId1 = action.unit[0];
    action.objectId2 = action.unit[1];
    delete action.unit;
  }
  if (Array.isArray(action.item) && action.itemObjectId1 === undefined) {
    action.itemObjectId1 = action.item[0];
    action.itemObjectId2 = action.item[1];
    delete action.item;
  }

  // v3 action 0x14: orderId1→itemId1, orderId2→itemId2, targetA→targetAX/Y, targetB→targetBX/Y
  if (action.orderId1 !== undefined) {
    action.itemId1 = action.orderId1;
    delete action.orderId1;
  }
  if (action.orderId2 !== undefined) {
    action.itemId2 = action.orderId2;
    delete action.orderId2;
  }
  if (Array.isArray(action.targetA)) {
    action.targetAX = action.targetA[0];
    action.targetAY = action.targetA[1];
    delete action.targetA;
  }
  if (Array.isArray(action.targetB)) {
    action.targetBX = action.targetB[0];
    action.targetBY = action.targetB[1];
    delete action.targetB;
  }

  // v3: units is [[id1, id2], ...] instead of actions: [{itemId1, itemId2}, ...]
  if (Array.isArray(action.units) && action.actions === undefined) {
    action.actions = action.units.map(pair => ({
      itemId1: pair[0],
      itemId2: pair[1]
    }));
    delete action.units;
  }

  return action;
};

const fixBrokenActionFormat = (action) => {
  if (action && action.itemId) {
    const { itemId } = action;

    if (Array.isArray(itemId)) {
      const itemValue = itemId[3];

      if (itemValue >= 0x41 && itemValue <= 0x7A) {
        action.itemId = itemId.map(e => String.fromCharCode(parseInt(e, 10))).reverse().join('');
      }
    }
  }

  return action;
};

const unpackItemId = (obj, optKey = 'itemId') => {
  return obj[optKey];
};

const RaceFlagMapping = {
  65: 'H',
  66: 'O',
  68: 'E',
  72: 'U'
};

const getRaceFromFlag = (raceFlag) => {
  return RaceFlagMapping[raceFlag] || 'R';
};

////
// helper function for matching [itemId] lists to [abilityId] lists 
// of a given focusObject
////

const findItemIdForObject = (itemId, focusObject) => {
	return Object.keys(focusObject).find(abilityKey => {
			const abilityItemId = focusObject[abilityKey];

			return isEqualItemId(itemId, abilityItemId);
	});
};


const getDecimalPortion = (num) => {
  return Math.abs(num) - Math.floor(num);
};

////
// distance between p (x,y) and q (x,y)
////

const distance = (pX, pY, qX, qY) => {
	return Math.sqrt(
		Math.pow(qX - pX, 2) +
		Math.pow(qY - pY, 2)
	);
};

////
// finds the unit closest to a given point from a list of units
// and and optional filter function
////

const closestToPoint = (x, y, units, filterFn) => {
	if (filterFn) {
		units = units.filter(filterFn);
	}

	let positions = units.map(unit => {
		return {
			unit: unit,
			distance: distance(
				x, y,
				unit.currentX, unit.currentY
			)
		};
	});

	positions.sort((a, b) => {
		return a.distance - b.distance;
	});

	const winner = positions[0];
	return winner && winner.unit || null;
};

////
// generate random int up to max val
////

const getRandomInt = (max) => {
  return Math.floor(Math.random() * Math.floor(max));
};

////
// uuid gen - from https://stackoverflow.com/questions/105034/create-guid-uuid-in-javascript
////
const uuidv4 = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};


////
// optimized findIndex with lambda filter and optional start index
////

const findIndexFrom = (arr, fn, start = 0, gameTime = 0) => {
  start = Math.max(0, start);

  for (let i = start; i < arr.length; i++) {
    const curNode = arr[i];
    const nextNode = (i < arr.length - 1) ? arr[i + 1] : null;

    if (fn(curNode, nextNode, gameTime)) {
      return i;
    }
  }

  return -1;
};

////
//
////

const StandardStreamSearch = (record, nextRecord, gameTime) => {
  // is the gameTime before the next record in the sequence
  let isBeforeNextStep;    

  if (!nextRecord) {
    // there is no next record, so this one is always our last valid one
    isBeforeNextStep = true;
  } else {
    isBeforeNextStep = (gameTime < nextRecord.gameTime);
  }

  if (gameTime >= record.gameTime && isBeforeNextStep) {
    return record;
  }
};

const calculateExperienceGains = (world, wc3vPlayers) => {
  const groups = Object.values(world.neutralGroups).sort((a, b) => {
    return a.claimTime - b.claimTime;
  }).reverse();

  groups.forEach(neutralGroup => {
    neutralGroup.calculateClaims();

    if (!neutralGroup.claimers) {
      return;
    }

    if (!neutralGroup.isClaimed()) {
      return;
    }

    Object.keys(neutralGroup.claimers).forEach(claimTeamId => {
      const claim = neutralGroup.claimers[claimTeamId];
      const neutralCampUnits = neutralGroup.units;

      const claimPlayers =  Object.keys(claim.players).reduce((acc, playerId) => {
        const wc3vPlayer = wc3vPlayers[playerId];
        const claimPlayer = claim.players[playerId];

        if (+wc3vPlayer.teamId !== +neutralGroup.claimOwnerId) {
          // do not credit players who are not on the claiming team
          return acc;
        }

        const hasHeroInGroup = claimPlayer.units.find(unit => {
          return unit.meta.hero;
        });

        if (!hasHeroInGroup) {
          const allHeroes = wc3vPlayer.units.filter(unit => {
            // has to be a hero that isn't an illusion and 
            // was alive before the camp was taken

            return unit.meta.hero && !unit.isIllusion && unit.spawnTime <= neutralGroup.claimTime;
          });

          const record = {
            tier: wc3vPlayer.tier,
            campUnits: allHeroes
          };
          
          acc.push(record);
          return acc;
        }

        const tierIndex = findIndexFrom(
          wc3vPlayer.tierStream, 
          StandardStreamSearch, 
          0,
          claim.timeClaimed
        );

        const tierRecord = wc3vPlayer.tierStream[tierIndex];
        const playerTier = tierRecord && tierRecord.tier || 1;

        const record = {
          tier: playerTier,
          campUnits: claimPlayer.units
        };
        
        acc.push(record);
        return acc;
      }, []);

      // 
      // determine how much experience each claiming players units shoould get
      // for each unit in the camp
      //

      neutralCampUnits.forEach(neutralCampUnit => {
        if (neutralCampUnit.isFountain) {
          // no xp credit for fountains

          return;
        }

        claimPlayers.forEach(player => {
          const { tier, campUnits } = player;

          const heroes = campUnits.filter(unit => {
            return unit.meta.hero && !unit.isIllusion;
          });

          ////
          // turn our list of hero Unit records
          // into a report back of their level at the given time
          ////
          const heroClaimRecords = heroes.reduce((acc, hero) => {
            const { levelStream, uuid, xpTotal, displayName } = hero;

            const levelIndex = findIndexFrom(
              levelStream, 
              StandardStreamSearch, 
              0,
              claim.timeClaimed
            );

            const levelRecord = (levelIndex !== -1) ? levelStream[levelIndex] : { newLevel: 1 };
            const playerRecord = {
              tier,
              level: levelRecord.newLevel,
              heroCount: heroes.length
            };

            const xpGained = neutralGroup.experienceGivenForUnit(neutralCampUnit, playerRecord);
            const heroExperienceRecord = {
              uuid,
              xpGained,
              displayName,
              gameTime: neutralGroup.claimTime
            };

            // add record to hero stream
            hero.xpStream.push(heroExperienceRecord);

            acc.push(heroExperienceRecord);
            return acc;
          }, []);

          neutralGroup.heroClaimRecords = neutralGroup.heroClaimRecords.concat(heroClaimRecords);
        
        // loop for each hero that was seen claiming the camp
        });
      
      // loop for each neutral in the camp
      });

      const heroStats = {};
      neutralGroup.heroClaimRecords.forEach(record => {
        const { uuid, xpGained, startingXp, xpTotal, displayName } = record;

        if (!heroStats[uuid]) {
          heroStats[uuid] = {
            displayName,
            total: 0
          };
        }

        heroStats[uuid].total += xpGained;
      });

      neutralGroup.heroStats = heroStats;

    // loop for each claimer in the group
    });
  
  // loop for each neutral group
  });
};

const assignCampOrder = (world, wc3vPlayers) => {

  const teamList = Object.values(wc3vPlayers).reduce((acc, player) => {
    if (!acc.includes(player.teamId)) {
      acc.push(player.teamId);
    }

    return acc;
  }, []);

  //
  // assign per-team ordering. each team gets its own sequential numbering
  // for every camp they participated in (cleared or contested).
  // stored in camp.teamOrders = { [teamId]: orderNumber }
  //
  teamList.forEach(teamId => {
    // include any camp where this team has timeClaimed > 0
    const orderedCamps = Object.values(world.neutralGroups)
      .filter(camp => {
        if (!camp.claimers) return false;
        const teamClaim = camp.claimers[teamId];
        return teamClaim && teamClaim.timeClaimed > 0;
      })
      .sort((a, b) => {
        return a.claimTime - b.claimTime;
      });

    const heroMap = {};

    orderedCamps.forEach((camp, ind) => {
      // per-team order stored in teamOrders map
      if (!camp.teamOrders) camp.teamOrders = {};
      camp.teamOrders[teamId] = (ind + 1);

      // also set camp.order to the owner's order for backward compat
      if (+camp.claimOwnerId === +teamId) {
        camp.order = (ind + 1);
      }

      camp.xpSnapshot = camp.xpSnapshot || {};

      if (!camp.heroStats) {
        return;
      }

      Object.keys(camp.heroStats).forEach(uuid => {
        const hero = camp.heroStats[uuid];

        if (!heroMap[uuid]) {
          heroMap[uuid] = 0;
        }

        camp.xpSnapshot[uuid] = heroMap[uuid];
        heroMap[uuid] += hero.total;
      });
    });
  });
}

////
// write wc3v output to file
////

// Categorize a game by its non-neutral player/team shape. STRICT: only exact
// equal-team shapes get a clean label; anything off-pattern is 'custom'. The
// client mirrors this exactly (Wc3vViewer.getGameMode, UploadManager fallback);
// keep all three in sync.
const computeGameMode = (playersMap) => {
  const humans = Object.values(playersMap || {}).filter(p => p && !p.isNeutralPlayer);
  const n = humans.length;
  if (n < 2) return 'custom';

  const byTeam = {};
  humans.forEach(p => { byTeam[p.teamId] = (byTeam[p.teamId] || 0) + 1; });
  const counts = Object.values(byTeam);
  const teamCount = counts.length;

  if (n === 2 && teamCount === 2) return '1v1';
  if (teamCount === 2 && counts[0] === counts[1]) {
    return ({ 2: '2v2', 3: '3v3', 4: '4v4' })[counts[0]] || 'custom';
  }
  if (n >= 3 && teamCount === n) return 'ffa';
  return 'custom';
};

// Battle export helper — strips intermediate underscored fields and caps the
// signal array to keep .wc3v size reasonable. Tail signals (attached during
// cooldown) are pruned first; primary signals are preserved.
const MAX_EXPORT_SIGNALS_PER_BATTLE = 400;
const serializeBattles = (battles) => {
  if (!Array.isArray(battles)) return [];
  return battles.map(b => {
    const sigs = (b.signals || []).slice(-MAX_EXPORT_SIGNALS_PER_BATTLE);
    return {
      id: b.id,
      startTime: b.startTime,
      endTime: b.endTime,
      durationMs: b.durationMs,
      category: b.category,
      flags: b.flags,
      creepJack: !!b.creepJack,
      campUuid: b.campUuid || null,
      startingPlayerId: b.startingPlayerId,
      participants: b.participants,
      trackerBox: b.trackerBox,
      outerBbox: b.outerBbox,
      signals: sigs.map(s => ({
        gameTime: s.gameTime,
        playerId: s.playerId,
        kind: s.kind,
        x: s.targetX,
        y: s.targetY,
        actorUuid: s.actorUnitUuid || null,
        targetUuid: s.targetUnitUuid || null,
        spellAbilityId: s.spellAbilityId || null,
        hostile: !!s.hostile
      })),
      unitOutcomes: b.unitOutcomes || [],
      unitTrips: (b.unitTrips || []).map(t => ({
        unitUuid: t.unitUuid,
        tag: t.tag,
        destination: t.destination,
        destinationKind: t.destinationKind,
        destinationOwnerId: t.destinationOwnerId == null ? null : t.destinationOwnerId,
        departedAt: t.departedAt,
        arrivedAt: t.arrivedAt,
        confidence: t.confidence,
        ...(t.campUuid ? { campUuid: t.campUuid } : {}),
        ...(t.reengageBattleId ? { reengageBattleId: t.reengageBattleId } : {})
      }))
    };
  });
};

// Pure assembly: produces the .wc3v output object. No filesystem I/O.
// Mutates `replay` (strips gameData, replaces replay.players); same as the
// pre-refactor writeOutput behavior — kept identical so callers see no change.
const buildOutputObject = (replay, wc3vPlayers, world, validation = null) => {
  const savedPlayers = replay.metadata.slotRecords;
  delete replay.players;

  replay.players = savedPlayers.reduce((acc, player) => {
    const { playerId, raceFlag, slotStatus } = player; 

    if (player && player.teamId === 24) {
      console.logger("not adding player on team 24 cause its bugged or who knkows waht");
      return acc;
    }

    const record = replay.metadata.playerRecords.find(playerRecord => {
      return playerRecord.playerId === playerId;
    });

    const wc3vRecord = wc3vPlayers[playerId];

    if (slotStatus !== 2) {
      console.logger("slot is not status 2 so not player", player, wc3vRecord, playerId);
      return acc;
    }

    if (record && record.playerName == 'Blizzard') {
      return acc;
    }

    acc[playerId] = {
      name: record && record.playerName || `Unknown ${playerId}`,
      raceDetected: wc3vRecord && wc3vRecord.race || 'R',
      teamId: player && player.teamId
    };

    return acc;
  }, {});

  calculateExperienceGains(world, wc3vPlayers);
  assignCampOrder(world, wc3vPlayers);

  // remove neutral groups at player starting positions
  // WC3 removes creeps at occupied spawn locations; the map file has them for all slots
  const SPAWN_CAMP_DISTANCE = 1500;
  const playerSpawns = Object.values(wc3vPlayers)
    .map(p => p.startingPosition)
    .filter(Boolean);

  const removedSpawnCampUuids = new Set();

  if (playerSpawns.length) {
    const groupKeys = Object.keys(world.neutralGroups);
    groupKeys.forEach(key => {
      const group = world.neutralGroups[key];
      const { bounds } = group;
      const campCenterX = (bounds.minX + bounds.maxX) / 2;
      const campCenterY = (bounds.minY + bounds.maxY) / 2;

      const nearSpawn = playerSpawns.some(sp => {
        return distance(campCenterX, campCenterY, sp.x, sp.y) < SPAWN_CAMP_DISTANCE;
      });

      if (nearSpawn) {
        removedSpawnCampUuids.add(group.uuid);
        delete world.neutralGroups[key];
      }
    });

    // also remove neutral units belonging to deleted spawn camps
    if (removedSpawnCampUuids.size) {
      const neutralPlayer = Object.values(wc3vPlayers).find(p => p.isNeutralPlayer);
      if (neutralPlayer) {
        neutralPlayer.units = neutralPlayer.units.filter(
          unit => !removedSpawnCampUuids.has(unit.neutralGroupId)
        );
      }
    }
  }

  const output = {
    players: Object.keys(wc3vPlayers).reduce((acc, playerId) => {
    	const player = wc3vPlayers[playerId];

      if (!player.units.length) {
        console.logger("no units for player: ", playerId);

        return acc;
      }

      const slot = savedPlayers.find(slot => {
        return slot.playerId === playerId;
      });

      if (slot && slot.slotStatus !== 2) {
        console.log("jdebug slot is not status 2 so not player", playerId, slot);
        return acc;
      }

      const {
        teamId,
        race,
        parseConfidence,
        startingPosition,
        units,
        eventStream,
        selectionStream,
        tierStream,
        researchStream,
        isNeutralPlayer,
        _buildingAttempts,
        _supplyBumps
      } = player;

    	acc[playerId] = {
        teamId,
        parseConfidence,
        race,
        startingPosition,
        eventStream: eventStream.filter(event => {
          // filter ghost summon events (castSummon units that were never registered)
          if (event.key === 'addUnit' && event.unit && event.unit.itemId === null) {
            return false;
          }
          return true;
        }),
        selectionStream: selectionStream.map(item => {
          return {
            gameTime: item.gameTime,
            selection: {
              units: item.selection.units
            }
          }
        }),
        tierStream,
        researchStream,
        ...(player.itemStream ? { itemStream: player.itemStream } : {}),
        ...(player.apmData ? { apmData: player.apmData } : {}),
        ...(player.moveTrace ? { moveTrace: player.moveTrace } : {}),
        ...(player._mvStats ? { mvStats: player._mvStats } : {}),
        // Structured teleport events (TP Scroll, Mass Teleport, Blink, etc.).
        // See lib/Player.js _applyTeleport and helpers/teleportAbilities.js.
        // Clients render banner notifications + glow rings + arrival flashes
        // off this list. Empty array for players who never teleported.
        teleportEvents: (player._teleportEvents || []).map(t => ({
          gameTime: t.gameTime,
          appliedAt: t.appliedAt,
          abilityCode: t.abilityCode,
          abilityKind: t.abilityKind,
          abilityDisplayName: t.abilityDisplayName,
          abilityIcon: t.abilityIcon,
          channelMs: t.channelMs,
          invulnerable: t.invulnerable,
          cancellable: t.cancellable,
          cancelled: t.cancelled,
          cancelReason: t.cancelReason,
          casterUuid: t.casterUuid,
          casterItemId: t.caster && t.caster.itemId,
          origin: t.origin,
          destination: t.destination,
          destBuildingUuid: t.destBuildingUuid,
          destBuildingItemId: t.destBuildingItemId,
          destBuildingDisplayName: t.destBuildingDisplayName,
          grabbedUnitUuids: t.grabbedUnitUuids,
          grabbedUnitItemIds: t.grabbedUnitItemIds,
          grabbedCount: t.grabbedCount
        })),
        isNeutralPlayer,
    		units: units.map(unit => unit.exportUnit()).concat(
          (player.destroyedSummons || [])
            .filter(unit => unit.itemId1 !== null || unit.objectId1 !== null)
            .map(unit => {
              const exported = unit.exportUnit();
              exported.destroyedAt = unit.destroyedAt;
              exported.isSummon = true;
              return exported;
            })
        ),
        buildingAttempts: (_buildingAttempts || []).map(a => ({
          itemId: a.itemId,
          displayName: a.displayName,
          gameTime: a.gameTime,
          x: a.x,
          y: a.y,
          status: a.status
        })),
        supplyBumps: (_supplyBumps || []).map(b => ({
          gameTime: b.gameTime,
          supplyUsed: b.supplyUsed,
          previousMax: b.previousMax,
          newMax: b.newMax,
          triggerEvent: b.triggerEvent
        })),
        ...(player._baseGrid ? { baseGrid: player._baseGrid } : {}),
        ...(player._baseSnapshots && player._baseSnapshots.length
          ? { baseSnapshots: player._baseSnapshots }
          : {}),
        // Per-player battle summary — small mirror of world.battles for clients
        // that show a "Player X was in N battles" widget without loading the
        // whole battles array. Built from the same world.battles source.
        battleParticipation: (world.battles || [])
          .filter(b => b.participants.some(p => String(p.playerId) === String(playerId)))
          .map(b => {
            const self = b.participants.find(p => String(p.playerId) === String(playerId));
            return {
              battleId: b.id,
              startTime: b.startTime,
              endTime: b.endTime,
              category: b.category,
              side: self && self.side,
              role: self && self.role
            };
          })
    	};

    	return acc;
    }, {}),

    world: {
      neutralGroups: Object.keys(world.neutralGroups).reduce((acc, neutralGroupKey) => {
        acc[neutralGroupKey] = world.neutralGroups[neutralGroupKey].exportGroup();
        return acc;
      }, {})
    },
    // Serialized battles + summary stats from BattleDetector (post-validation
    // pass in wc3v.js). Strip the internal underscored fields and cap per-
    // battle signal arrays to keep .wc3v file size sane.
    battles: serializeBattles(world.battles),
    battleStats: world.battleStats || { totalBattles: 0, totalSignals: 0, byCategory: {}, byPlayer: {} },
    replay: (() => {
      // strip raw decompressed replay binary — client never uses it
      delete replay.metadata.gameData;
      return replay;
    })(),
    ...((() => {
      // include validation block whenever the validator ran. Keeps the issue
      // counts and confidence consistent with the warning list — inspect-replay
      // shows both, so dropping warnings while keeping counts would be confusing.
      if (!validation) return {};
      const warnings = validation.warnings || [];
      const errors = validation.errors || [];
      if (!warnings.length && !errors.length && !validation.playerConfidence) return {};
      return {
        validation: {
          warnings,
          errors,
          playerConfidence: validation.playerConfidence,
          playerIssues: validation.playerIssues
        }
      };
    })())
  };

  // Categorize the game from the players actually emitted (unit-less players
  // already dropped above — matches what the viewer renders).
  output.gameMode = computeGameMode(output.players);

  return output;
};

const writeOutput = (filename, fileHash, replay, wc3vPlayers, world, jsonPadding = 0, validation = null) => {
  const output = buildOutputObject(replay, wc3vPlayers, world, validation);

  try {
    let baseFile = fileHash || path.basename(filename);
    if (baseFile.endsWith('.w3g')) {
      baseFile = baseFile.substring(0, baseFile.length - 4);
    }

  	const outputPath = `${__dirname}/../client/replays/${baseFile}.wc3v`;
    fs.writeFileSync(outputPath, JSON.stringify(output, null, jsonPadding));
    console.logger("created wc3v file: ", outputPath);

    const gzip = zlib.createGzip();
    const inputFile = fs.createReadStream(outputPath);
    const outputFile = fs.createWriteStream(`${outputPath}.gz`);
    console.logger("writing wc3v gzipped file: ", `${outputPath}.gz`);
    
    inputFile.pipe(gzip)
      .on('error', (e) => {
        console.logger("file write error for: ", outputPath, e);
      })
      .pipe(outputFile)
      .on('error', (e) => {
        console.logger("file write error for: ", outputPath, e);
      })
      .on('finish', () => {
        // run post-write validation on the gz file
        try {
          const { validateReplay } = require('../tools/validate-output');
          const result = validateReplay(`${outputPath}.gz`);
          if (result.errors.length) {
            console.log(`\nValidation FAILED for ${path.basename(outputPath)}.gz:`);
            result.errors.forEach(e => console.log(`  ERROR: ${e}`));
          }
          if (result.warnings.length) {
            console.log(`\nValidation warnings for ${path.basename(outputPath)}.gz:`);
            result.warnings.forEach(w => console.log(`  WARN: ${w}`));
          }
        } catch (e) {
          // validation is advisory, don't block on errors
        }

        if (config.debugOutput) {
          console.log("debug: keeping uncompressed wc3v at", outputPath);
        } else {
          console.logger("erasing non zipped wc3v file");
          fs.unlinkSync(outputPath);
        }
      });

  } catch (e) {
    console.logger("file write error: ", e);
  }
};

const getManifestReplayIds = () => {
  const manifestPath = path.join(__dirname, '..', 'client', 'data', 'builds-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const ids = new Set();
  for (const build of manifest.builds) {
    for (const r of (build.replays || [])) {
      if (r.replayId) ids.add(r.replayId);
    }
  }
  return [...ids].sort();
};

const readCliArgs = (argv) => {
	const userArgs = process.argv.slice(2);

	console.log("user args: ", userArgs);

	let options = {
		paths: [],
    jsonPadding: 0
	};

	userArgs.forEach(rawArg => {
		const parts = rawArg.split("=");
		const flag = parts[0].substring(2);
		const val = parts[1];

		switch (flag) {
			case "replay":
				options.paths.push(`./replays/${val}.w3g`);
			break;

			case "debug-player":
				console.log("setting debug player to: ", val);
				config.debugPlayer = val;
			break;

      case "pretty-print":
        options.jsonPadding = 4;
      break;

      case "debug":
        config.debugOutput = true;
        options.jsonPadding = 4;
      break;

      case "move-trace":
        config.moveTrace = true;
      break;

      case "prod":
        logManager.setTestMode();
      break;

      case "promaps":
        config.debugPlayer = null;
        logManager.setTestMode();

        options.inTestMode = true;
        options.paths = getManifestReplayIds().map(id => `./replays/${id}.w3g`);
      break;

      case "test":
        config.debugPlayer = null;
        logManager.setTestMode();

        const regressionMaps = ['amazonia', 'battleground', 'gnollwood', 'lastrefuge', 'northernisles', 'twistedmeadows5'];
        const testMaps = [...getManifestReplayIds(), ...regressionMaps];

        options.inTestMode = true;
        options.paths = testMaps.map(mapName => `./replays/${mapName}.w3g`);
      break;
		};
	});

	return options;
};

module.exports = {
	fixItemId,
	isEqualItemId,
  isEqualUnitItemId,
  isUnitInList,
  isItemIdInList,
	findItemIdForObject,
  getDecimalPortion,
	distance,
	closestToPoint,
	getRandomInt,
	uuidv4,
	getManifestReplayIds,
	readCliArgs,
	writeOutput,
	buildOutputObject,
	computeGameMode,

  findIndexFrom,
  StandardStreamSearch,
  unpackItemId,
  getRaceFromFlag,
  fixBrokenActionFormat,
  normalizeAction,

	// constants
	MS_TO_SECONDS: 0.001,
	SECONDS_TO_MS: 1000
};
