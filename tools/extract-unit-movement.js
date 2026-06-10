/**
 * Extract per-unit MOVEMENT data (base move speed, turn rate, propulsion window,
 * move type) from the raw WC3 SLK tables → helpers/unitMovement.json.
 *
 * Sources (already on disk under tools/map-data/units/, extracted from CASC):
 *   - unitbalance.slk : `spd` (base movement speed, world units/sec)
 *   - unitdata.slk    : `turnRate` (radians per WC3 internal frame, ~0..1),
 *                       `propWin` (propulsion window, DEGREES — the heading
 *                       error within which a unit moves while turning vs. must
 *                       pivot in place first), `movetp` (foot/horse/fly/hover/…)
 *
 * Output schema (raw game values — consumers convert as needed):
 *   {
 *     "version": 1,
 *     "units": {
 *       "<itemId>": { "moveSpeed": N, "turnRate": N, "propWindow": N, "moveType": "foot" }
 *     }
 *   }
 *
 * `turnRate` is stored RAW (the SLK 0..1 value); lib/FacingInference.js converts
 * it to rad/ms using the WC3 frame model (min(turnRate, 0.2) / 30ms ≈ 382 deg/s
 * cap). `moveSpeed` is merged onto `meta.movespeed` in helpers/mappings.js so
 * Unit.effectiveMovespeed() picks it up. Buildings / immovable units (spd '-',
 * turnRate '-') are skipped.
 *
 * Re-run after a new SLK extraction; commit the JSON; then `npm run build:parser`.
 */

const fs = require('fs');
const path = require('path');
const { parseSLK } = require('../helpers/slkParser');

const BALANCE_PATH = path.join(__dirname, 'map-data', 'units', 'unitbalance.slk');
const DATA_PATH    = path.join(__dirname, 'map-data', 'units', 'unitdata.slk');
const OUTPUT_PATH  = path.join(__dirname, '..', 'helpers', 'unitMovement.json');

// Coerce an SLK cell to a finite positive number, else null. Building/immovable
// rows store '-' (a string after quote-stripping), which becomes null.
function num (v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

const balance = parseSLK(BALANCE_PATH);
const data    = parseSLK(DATA_PATH);

// Index unitdata.slk by its id column (unitID) for joining against unitbalance.
const dataById = {};
for (const row of data.rows) {
  if (row.unitID) dataById[row.unitID] = row;
}

const units = {};
let kept = 0, skipped = 0;
for (const row of balance.rows) {
  const id = row.unitBalanceID;
  if (!id) continue;

  const d = dataById[id] || {};
  const moveSpeed  = num(row.spd);          // 0/'-' → null for buildings
  const turnRate   = num(d.turnRate);       // '-' → null for buildings
  const propWindow = num(d.propWin);        // degrees
  const moveType   = (typeof d.movetp === 'string' && d.movetp !== '_' && d.movetp !== '-')
    ? d.movetp : null;

  // Keep only things that actually move (or can turn). Skips buildings/items.
  if ((moveSpeed == null || moveSpeed <= 0) && (turnRate == null || turnRate <= 0)) {
    skipped++;
    continue;
  }

  const entry = {};
  if (moveSpeed != null && moveSpeed > 0) entry.moveSpeed = Math.round(moveSpeed);
  if (turnRate != null && turnRate > 0)   entry.turnRate = +turnRate.toFixed(3);
  if (propWindow != null)                 entry.propWindow = +propWindow.toFixed(1);
  if (moveType)                           entry.moveType = moveType;
  units[id] = entry;
  kept++;
}

const out = { version: 1, units };
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(out));
const sizeKB = (fs.statSync(OUTPUT_PATH).size / 1024).toFixed(1);
console.log('Wrote ' + OUTPUT_PATH);
console.log('  units kept: ' + kept + ', skipped (no movement): ' + skipped);
console.log('  size: ' + sizeKB + ' KB');
for (const id of ['hfoo', 'earc', 'ogru', 'ugho', 'hkni', 'hpea', 'Hpal', 'okod', 'ewsp']) {
  console.log('  ' + id + ': ' + JSON.stringify(units[id]));
}
