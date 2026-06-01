/**
 * Extract per-unit attack range from war3.w3mod\Units\UnitWeapons.slk
 * → helpers/unitRanges.json.
 *
 * Output schema:
 *   {
 *     "version": 1,
 *     "ranges": { "<itemId>": { "range": N, "minRange": N|0, "acquire": N } }
 *   }
 *
 * `range` is `rangeN1` from the SLK — the unit's primary weapon range in
 * world units. Buildings with `weapsOn = 0` (no weapon) are skipped.
 * Re-run after a new SLK extraction; commit the JSON.
 */

const fs = require('fs');
const path = require('path');
const { parseSLK } = require('../helpers/slkParser');

const SLK_PATH    = path.join(__dirname, 'map-data', 'units', 'unitweapons.slk');
const OUTPUT_PATH = path.join(__dirname, '..', 'helpers', 'unitRanges.json');

const slk = parseSLK(SLK_PATH);
const ranges = {};
let kept = 0, skipped = 0;
for (const row of slk.rows) {
  const id = row.unitWeaponID;
  if (!id) continue;
  // weapsOn === 0 means the unit has no attack weapon at all.
  if (row.weapsOn === 0 || row.weapsOn === '0') { skipped++; continue; }
  const range = +row.rangeN1;
  if (!Number.isFinite(range) || range <= 0) { skipped++; continue; }
  const minRange = (row.minRange === '-' || row.minRange == null) ? 0 : (+row.minRange || 0);
  const acquire  = +row.acquire || range;
  ranges[id] = {
    range: Math.round(range),
    minRange: Math.round(minRange),
    acquire: Math.round(acquire)
  };
  kept++;
}

const out = { version: 1, ranges };
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(out));
const sizeKB = (fs.statSync(OUTPUT_PATH).size / 1024).toFixed(1);
console.log('Wrote ' + OUTPUT_PATH);
console.log('  units kept: ' + kept + ', skipped (no weapon / no range): ' + skipped);
console.log('  size: ' + sizeKB + ' KB');
console.log('  sample (hrif Rifleman): ' + JSON.stringify(ranges.hrif));
console.log('  sample (ear Archer):    ' + JSON.stringify(ranges.earc));
console.log('  sample (hfoo Footman):  ' + JSON.stringify(ranges.hfoo));
