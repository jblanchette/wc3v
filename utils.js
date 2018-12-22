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
	const dx   = pX - qX;         
  const dy   = pY - qY;         

  return Math.sqrt( dx*dx + dy*dy ); 
};

const closestToPoint = (x, y, units) => {
	let positions = units.map(unit => {

		return {
			unit: unit,
			distance: distance(
				x, unit.currentX,
				y, unit.currentY
			)
		};
	});

	positions.sort(item => {
		return item.distance;
	});
	positions.reverse();

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