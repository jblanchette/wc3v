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
	console.log("unit 1: ", pX, pY, "unit 2: ", qX, qY);
	console.log("r: ", Math.hypot(Math.abs(qX - pX), Math.abs(qY - pY)));
	return Math.hypot(Math.abs(qX - pX), Math.abs(qY - pY)); 
};

const closestToPoint = (x, y, units, filterFn) => {
	if (filterFn) {
		units = units.filter(filterFn);
	}

	let positions = units.map(unit => {

		console.log(unit.displayName);
		return {
			unit: unit,
			distance: distance(
				x, y,
				unit.currentX, unit.currentY
			)
		};
	});

	positions.sort(item => {
		return item.distance;
	});

	const winner = positions[0];
	return winner && winner.unit || null;
};

module.exports = {
	fixItemId: fixItemId,
	isEqualItemId: isEqualItemId,
	findItemIdForObject: findItemIdForObject,
	distance: distance,
	closestToPoint: closestToPoint
};