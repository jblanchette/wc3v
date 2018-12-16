const isEqualItemId = (itemId1, itemId2) => {
	let isEqual = false;

	for (let i = 0; i < itemId1.length; i++) {
		if (itemId1[i] !== itemId2[i]) {
			return false;
		}
	}

	return true;
};

module.exports = {
	isEqualItemId: isEqualItemId
}