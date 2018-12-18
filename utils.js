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

module.exports = {
	fixItemId: fixItemId,
	isEqualItemId: isEqualItemId
}