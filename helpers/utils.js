const isEqualItemId = (itemId1, itemId2) => {
	let isEqual = false;

	if (itemId1 === null && itemId2 === null) {
		return true;
	} else if (itemId1 === null || itemId2 === null) {
		return false;
	}

	for (let i = 0; i < itemId1.length; i++) {
		if (itemId1[i] !== itemId2[i]) {
			return false;
		}
	}

	return true;
};

const fixItemId = (itemId) => {
	if (Array.isArray(itemId)) {
		return itemId;
	}
	
	return itemId.split("").reverse().join("");
};

const findItemIdForObject = (itemId, focusObject) => {
	return Object.keys(focusObject).find(abilityKey => {
			const abilityItemId = focusObject[abilityKey];

			return isEqualItemId(itemId, abilityItemId);
	});
};

const distance = (pX, pY, qX, qY) => { 
	return Math.sqrt(
		Math.pow(qX - pX, 2) +
		Math.pow(qY - pY, 2)
	);
};

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

	console.log("closest check: ", positions.map(p => {
		return `${p.unit.displayName} - dist: ${p.distance}`;
	}));

	const winner = positions[0];
	return winner && winner.unit || null;
};

const getRandomInt = (max) => {
  return Math.floor(Math.random() * Math.floor(max));
};

// from https://stackoverflow.com/questions/105034/create-guid-uuid-in-javascript
const uuidv4 = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

module.exports = {
	fixItemId: fixItemId,
	isEqualItemId: isEqualItemId,
	findItemIdForObject: findItemIdForObject,
	distance: distance,
	closestToPoint: closestToPoint,
	getRandomInt: getRandomInt,
	uuidv4: uuidv4,

	// constants
	MS_TO_SECONDS: 0.001,
	SECONDS_TO_MS: 1000
};