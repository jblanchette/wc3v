/**
 * Dump water color data from water.slk per tileset.
 * Usage: node tools/dump-water-colors.js
 *
 * Extracts shallow/deep min/max RGBA values used by HiveWE's water shader.
 */
const path = require('path');
const { parseSLK } = require('../helpers/slkParser');

const waterSlk = parseSLK(path.join(__dirname, 'map-data', 'terrainart', 'water.slk'));

console.log('Water.slk columns:', waterSlk.headers.join(', '));
console.log('');

const tilesets = ['L', 'F', 'W', 'N', 'A', 'D', 'C', 'B', 'Y', 'X', 'V', 'Q', 'G', 'Z', 'I', 'O', 'K', 'J'];

for (const ts of tilesets) {
  const row = waterSlk.byId(ts + 'Sha');
  if (!row) { console.log(ts + 'Sha: NOT FOUND'); continue; }

  // Look for smin/smax/dmin/dmax color fields by checking column names
  const smin = { a: row.Smin_A, r: row.Smin_R, g: row.Smin_G, b: row.Smin_B };
  const smax = { a: row.Smax_A, r: row.Smax_R, g: row.Smax_G, b: row.Smax_B };
  const dmin = { a: row.Dmin_A, r: row.Dmin_R, g: row.Dmin_G, b: row.Dmin_B };
  const dmax = { a: row.Dmax_A, r: row.Dmax_R, g: row.Dmax_G, b: row.Dmax_B };

  // If named columns don't exist, try to find by common patterns
  const hasNamedCols = smin.r !== undefined;

  if (hasNamedCols) {
    console.log(ts + 'Sha:');
    console.log('  shallow_min: RGBA(' + smin.r + ',' + smin.g + ',' + smin.b + ',' + smin.a + ')');
    console.log('  shallow_max: RGBA(' + smax.r + ',' + smax.g + ',' + smax.b + ',' + smax.a + ')');
    console.log('  deep_min:    RGBA(' + dmin.r + ',' + dmin.g + ',' + dmin.b + ',' + dmin.a + ')');
    console.log('  deep_max:    RGBA(' + dmax.r + ',' + dmax.g + ',' + dmax.b + ',' + dmax.a + ')');
  } else {
    // Dump all fields to identify the color columns
    console.log(ts + 'Sha: (no named color cols, dumping all values)');
    for (const [k, v] of Object.entries(row)) {
      console.log('  ' + k + ': ' + v);
    }
    break; // only dump one to see the pattern
  }
}
