const SubGroup = class {
	constructor (numberUnits, units) {
		this.numberUnits = numberUnits;
		this.units = units;
	}

	mergeGroups (otherGroup) {
		this.numberUnits += otherGroup.numberUnits;
		this.units = this.units.concat(otherGroup.units);
	}
};

module.exports = SubGroup;