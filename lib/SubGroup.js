const utils = require("../helpers/utils");

const SubGroup = class {
	constructor (numberUnits, units, hasUnregisteredUnit = false) {
		this.numberUnits = numberUnits;
		this.units = units;
		this.hasUnregisteredUnit = hasUnregisteredUnit;
	}

	deselect (otherGroup) {
		// todo: update the unit selected property

		this.units = this.units.filter(unit => {
			const unitInOtherGroup = otherGroup.units.find(otherUnit => {
				return utils.isEqualItemId(unit.itemId1, otherUnit.itemId1) &&
				       utils.isEqualItemId(unit.itemId2, otherUnit.itemId2);
			});

			if (unitInOtherGroup) {
				console.log("removing from group: ", unit);
			}

			// when the unit is *not* in the other group
			// we keep it (return true)
			return (unitInOtherGroup === null || unitInOtherGroup === undefined);
		});

		this.numberUnits -= otherGroup.numberUnits;
	}

	mergeGroups (otherGroup) {
		this.numberUnits += otherGroup.numberUnits;
		this.units = this.units.concat(otherGroup.units);
	}

	// debug method
	printGroup () {
		console.error("Num Units: ", this.numberUnits);
		console.error("Has Unreg Units: ", this.hasUnregisteredUnit);
		console.error("Units: ");

		if (!this.units.length) {
			console.error("Empty unit list.");
		}

		this.units.forEach(badUnit => {
			console.error(badUnit);
		});
	}
};

module.exports = SubGroup;