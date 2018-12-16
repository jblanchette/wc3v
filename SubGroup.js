const utils = require("./utils");

const SubGroup = class {
	constructor (numberUnits, units) {
		this.numberUnits = numberUnits;
		this.units = units;
	}

	deselect (otherGroup) {
		this.numberUnits -= otherGroup.numberUnits;

		this.units = this.units.filter(unit => {
			const unitInOtherGroup = otherGroup.units.find(otherUnit => {
				return utils.isEqualItemId(unit.itemId1, otherUnit.itemId1) &&
				       utils.isEqualItemId(unit.itemId2, otherUnit.itemId2);
			});

			// when the unit is *not* in the other group
			// we keep it (return true)
			return (unitInOtherGroup === null);
		});
	}

	mergeGroups (otherGroup) {
		this.numberUnits += otherGroup.numberUnits;
		this.units = this.units.concat(otherGroup.units);
	}
};

module.exports = SubGroup;