const fs = require('fs'),
      path = require('path');

const config = require('../config/config');

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
	if (Array.isArray(itemId)) {
		return itemId;
	}
	
	return itemId.split("").reverse().join("");
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

const writeOutput = (filename, replay, players) => {

  const savedPlayers = replay.players;

  delete replay.players;

  replay.players = savedPlayers.reduce((acc, player) => {
    const { id } = player;

    acc[id] = player;
    return acc;
  }, {});

  const output = {
    players: Object.keys(players).reduce((acc, playerId) => {
    	const player = players[playerId];

      if (!player.units.length) {
        return acc;
      }

    	acc[playerId] = {
        startingPosition: player.startingPosition,
    		units: player.units.map(unit => unit.exportUnit())
    	};

    	return acc;
    }, {}),
    replay: replay
  };

  try {
  	const outputPath = `./client/replays/${path.basename(filename)}.wc3v`;
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 4));
    console.logger("created wc3v file: ", outputPath);
  } catch (e) {
    console.logger("file write error: ", e);
  }
};

const readCliArgs = (argv) => {
	const userArgs = process.argv.slice(2);

	console.log("user args: ", userArgs);

	let options = {
		paths: []
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

      case "test":
        config.debugPlayer = 1000000; // hack to turn off all logs for now
        const testMaps = [
          'happy-vs-grubby',
          'happy-vs-lucifer',
          'cash-vs-foggy',
          'foggy-vs-cash-2',
          'crow-vs-john',
          'chae-vs-hawk',
          'test-hero-revive',
          'test-hero-revive-2',
          'test-ch-movement',
          'test-ei-movement',
          'test-tavern-revive-2',
          'soin-vs-chae',
          'joker-vs-lil',
          'bnet-ud-vs-orc-2',
        ];

        options.inTestMode = true;
        options.paths = testMaps.map(mapName => {
          return `./replays/${mapName}.w3g`;
        })
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

	// constants
	MS_TO_SECONDS: 0.001,
	SECONDS_TO_MS: 1000
};
