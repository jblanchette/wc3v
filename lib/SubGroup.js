const utils = require("../helpers/utils");

const SubGroup = class {
	constructor (numberUnits, units, hasUnregisteredUnit = false) {
		this.numberUnits = numberUnits;
		this.units = units;
		this.hasUnregisteredUnit = hasUnregisteredUnit;
	}

	deselect (otherGroup) {
		// todo: update the unit selected property

		console.logger("current units: ", this.units);
		console.logger("deselecting other group: ", otherGroup.units);

		this.units = this.units.filter(unit => {
			const unitInOtherGroup = otherGroup.units.find(otherUnit => {
				return utils.isEqualItemId(unit.itemId1, otherUnit.itemId1) &&
				       utils.isEqualItemId(unit.itemId2, otherUnit.itemId2);
			});

			// when the unit is *not* in the other group
			// we keep it (return true)
			return (unitInOtherGroup === null || unitInOtherGroup === undefined);
		});

		console.logger("units after deselect: ", this.units);

		this.numberUnits -= otherGroup.numberUnits;
	}

	mergeGroups (otherGroup) {
		this.numberUnits += otherGroup.numberUnits;
		this.units = this.units.concat(otherGroup.units);

		console.logger("added to units: ", this.units);
	}

	swapUnitPosition (source, destination) {
		let unitA = this.units[source];
		let unitB = this.units[destination];

		if (!unitA || !unitB) {
			throw new Error("unable to swap unit position");
		}

		this.units[source] = unitB;
		this.units[destination] = unitA;
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
