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
	return itemId.split("").reverse().join("");
};

const findItemIdForObject = (itemId, focusObject) => {
	return Object.keys(focusObject).find(abilityKey => {
			const abilityItemId = focusObject[abilityKey];

			return isEqualItemId(itemId, abilityItemId);
	});
};

module.exports = {
	fixItemId: fixItemId,
	isEqualItemId: isEqualItemId,
	findItemIdForObject: findItemIdForObject
};