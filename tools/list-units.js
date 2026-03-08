const d = require('../helpers/UnitBalance.json').output;
Object.entries(d).forEach(([k, v]) => {
  if (v.armorType === 'fort' || v.armorType === 'hero') return;
  console.log(k, v.displayName, v.armorType);
});
