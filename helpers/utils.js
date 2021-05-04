const fs = require('fs'),
      path = require('path'),
      zlib = require('zlib');

const config = require('../config/config');

const logManager = require("./logManager");

////
// check if two [itemId] lists are equal
////
const isEqualItemId = (itemIdA, itemIdB) => {
	let isEqual = false;

	if (itemIdA === null && itemIdB === null) {
		// both null
		return true;
	} else if (itemIdA === null || itemIdB === null) {
		// one is null and one isn't
		return false;
	}

	// check to ensure each position in the list is equal
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
const fixBrokenActionFormat = (action) => {
  if (action && action.itemId) {
    const { itemId } = action;
    
    const itemValue = itemId[3];

    if (itemValue >= 0x41 && itemValue <= 0x7A) { 
      action.itemId = itemId.map(e => String.fromCharCode(parseInt(e, 10))).reverse().join('');
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
// write wc3v output to file
////

const writeOutput = (filename, fileHash, replay, wc3vPlayers, world, jsonPadding = 0) => {

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


  Object.values(world.neutralGroups).forEach(neutralGroup => {
    neutralGroup.calculateClaims();
  });

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
        groupStream,
        isNeutralPlayer
      } = player;

    	acc[playerId] = {
        teamId,
        parseConfidence,
        race,
        startingPosition,
        eventStream,
        selectionStream,
        tierStream,
        groupStream,
        isNeutralPlayer,
    		units: units.map(unit => unit.exportUnit())
    	};

    	return acc;
    }, {}),

    world: {
      neutralGroups: world.neutralGroups
    },
    replay: replay
  };

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
        console.logger("erasing non zipped wc3v file");
        fs.unlinkSync(outputPath);
      });

  } catch (e) {
    console.logger("file write error: ", e);
  }
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

      case "prod":
        logManager.setTestMode();
      break;

      case "promaps":
        config.debugPlayer = null; // hack to turn off all logs for now
        logManager.setTestMode();

        const proMaps = [
          // pro mactches on site
          'happy-vs-grubby',
          'grubby-vs-thorzain',
          'cash-vs-foggy',
          'happy-vs-lucifer',
          'foggy-vs-cash-2',
          'terenas-stand-lv_sonik-vs-tgw',
          '2v2-synergy'
        ];

        options.inTestMode = true;
        options.paths = proMaps.map(mapName => {
          return `./replays/${mapName}.w3g`;
        });
      break;

      case "test":
        config.debugPlayer = null; // hack to turn off all logs for now
        logManager.setTestMode();

        const testMaps = [
          // pro mactches on site
          // 'happy-vs-grubby',
          // 'grubby-vs-thorzain',
          // 'cash-vs-foggy',
          // 'happy-vs-lucifer',
          // 'foggy-vs-cash-2',
          // 'terenas-stand-lv_sonik-vs-tgw',
          // '2v2-synergy',
          // standard maps
          'amazonia',
          'battleground',
          'mesa',
          // concealed hill and echo done by pro matches
          'gnollwood',
          'guardians',
          'lastrefuge',
          'monsoon',
          'northernisles',
          // synergy done by pro match
          'upperkingdom2',
          'twistedmeadows5'
        ];

        options.inTestMode = true;
        options.paths = testMaps.map(mapName => {
          return `./replays/${mapName}.w3g`;
        });
      break;
		};
	});

	return options;
};

module.exports = {
	fixItemId: fixItemId,
	isEqualItemId: isEqualItemId,
  isEqualUnitItemId: isEqualUnitItemId,
  isUnitInList: isUnitInList,
  isItemIdInList: isItemIdInList,
	findItemIdForObject: findItemIdForObject,
  getDecimalPortion: getDecimalPortion,
	distance: distance,
	closestToPoint: closestToPoint,
	getRandomInt: getRandomInt,
	uuidv4: uuidv4,
	readCliArgs: readCliArgs,
	writeOutput: writeOutput,

  unpackItemId,
  getRaceFromFlag,
  fixBrokenActionFormat,

	// constants
	MS_TO_SECONDS: 0.001,
	SECONDS_TO_MS: 1000
};
