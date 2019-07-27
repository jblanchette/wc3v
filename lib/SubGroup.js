const utils = require("../helpers/utils");

const SubGroup = class {
	constructor (numberUnits, units, hasUnregisteredUnit = false) {
		this.numberUnits = numberUnits;
		this.units = units;
		this.hasUnregisteredUnit = hasUnregisteredUnit;

		const badUnit = units.find(unit => {
			return unit.itemId1 === null || unit.itemId2 === null;
		})

		if (badUnit) {
			console.logger("bad subgroup: ", units);

			throw new Error("bad subgroup made");
		}
	}

	deselect (otherGroup) {
		// todo: update the unit selected property

		console.logger("current units: ", this.units);
		console.logger("deselecting other group: ", otherGroup.units);

		const startLen = this.units.length;
		this.units = this.units.filter(unit => {
			const unitInOtherGroup = otherGroup.units.find(otherUnit => {
				return utils.isEqualUnitItemId(unit, otherUnit);
			});

			// when the unit is *not* in the other group
			// we keep it (return true)
			return (unitInOtherGroup === null || unitInOtherGroup === undefined);
		});

		const endLen = this.units.length;

		console.logger("units after deselect: ", this.units);

		if (startLen === endLen) {
			console.logger("error - deselect did nothing?");
			//throw new Error("deslect error");	
		}

		this.numberUnits = this.units.length;
	}

	mergeGroups (otherGroup) {
		this.numberUnits += otherGroup.numberUnits;
		this.units = this.units.concat(otherGroup.units);

		if (this.numberUnits !== this.units.length) {
			throw new Error("bad selection length?");
		}

		console.logger("added to units: ", this.units);
		console.logger("selection size: ", this.units.length);
	}

	addUnit (itemId1, itemId2) {
		this.numberUnits += 1;

		if (itemId1 === null || itemId2 === null) {
			console.logger("error, added null itemId1 to sel");

			throw new Error("wut");
		}

		this.units.push({
			itemId1: itemId1,
			itemId2: itemId2
		});
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
