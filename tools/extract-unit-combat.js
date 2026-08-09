/**
 * Extract per-unit COMBAT / ATTACK-TIMING data from the raw WC3 SLK tables →
 * helpers/unitCombat.json. This is the data needed to synthesize a physically
 * correct attack cadence in the 3D viewer (a unit swings on its real cooldown,
 * with damage landing at the animation damage point).
 *
 * Source (already on disk under tools/map-data/units/, extracted from CASC):
 *   - unitweapons.slk : per-unit weapon rows. Relevant columns:
 *       weapsOn (X5)  which weapons are enabled (0 none / 1 / 2 / 3 both)
 *       acquire (X6)  ACQUISITION RANGE (wu) — how far a unit notices a target
 *                     and starts attacking on its own. Footman 500.
 *       minRange(X7)  minimum range (siege units cannot hit inside this)
 *       castpt  (X8)  cast point           — sec, attack/cast start → action
 *       castbsw (X9)  cast backswing       — sec, action → animation end
 *       targs1  (X10) TARGETING MASK — comma list (ground,air,structure,ward,…).
 *                     A ground-only melee weapon can never hit a flyer.
 *       rangeN1 (X11) attack range (wu)
 *       RngBuff1(X13) range buffer — how far past `acquire` a unit will pursue
 *                     before giving up (the leash). Footman 250.
 *       atkType1(X14) attack type          — normal/pierce/siege/magic/hero/chaos/spells
 *       weapTp1 (X15) weapon type          — normal/missile/instant/artillery/…
 *       cool1   (X16) attack cooldown      — sec between swings (the cadence)
 *       dice1/sides1/dmgplus1              — base damage roll
 *       mindmg1 (X22) / maxdmg1 (X24)      — resolved damage bounds
 *       dmgpt1  (X25) DAMAGE POINT         — sec from swing start → damage lands
 *       backSw1 (X26) attack backswing     — sec from damage → swing recovery end
 *     (…and the *2 columns for a second weapon, when present.)
 *
 * Timing note: `cool1`, `dmgpt1`, `backSw1`, `castpt`, `castbsw` are all in
 * SECONDS (WC3 animation time). The viewer normalises `dmgpt1` against the
 * attack clip duration (from unit-models.json) to place the damage frame, and
 * restarts the swing every `cool1` while a unit is in an inferred battle.
 *
 * Output schema (raw game values — consumers convert as needed):
 *   {
 *     "version": 2,
 *     "units": {
 *       "<itemId>": {
 *         "cooldown": N, "damagePoint": N, "backswing": N,
 *         "range": N, "weaponType": "normal", "attackType": "normal",
 *         "minDamage": N, "maxDamage": N,
 *         "acquire": N, "rangeBuffer": N, "minRange": N,
 *         "targets": ["ground","structure",…], "weaponsOn": N,
 *         "castPoint": N, "castBackswing": N,
 *         // present only when the unit has a real second weapon:
 *         "weapon2": { "cooldown": N, "damagePoint": N, "backswing": N, "range": N,
 *                      "weaponType": "…", "attackType": "…", "minDamage": N, "maxDamage": N }
 *       }
 *     }
 *   }
 *
 * Re-run after a new SLK extraction; commit the JSON; then `npm run build:parser`.
 */

const fs = require('fs');
const path = require('path');
const { parseSLK } = require('../helpers/slkParser');

const WEAPONS_PATH = path.join(__dirname, 'map-data', 'units', 'unitweapons.slk');
const OUTPUT_PATH  = path.join(__dirname, '..', 'helpers', 'unitCombat.json');

// Coerce an SLK cell to a finite number, else null. Non-attacking rows store '-'
// (a string after quote-stripping), which becomes null.
function num (v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// Coerce an SLK cell to a clean lowercase enum string, else null. '_' / '-' are
// the SLK "empty" sentinels.
function str (v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s === '_' || s === '-') return null;
  return s.toLowerCase();
}

// Round to `d` decimals, dropping trailing zeros, or null.
function round (v, d) {
  if (v == null) return null;
  return +v.toFixed(d);
}

// Targeting mask: a comma-separated list of what this weapon may attack, e.g.
// "ground,structure,debris,item,ward". This is the engine's own answer to "can a
// grunt hit a gargoyle" (it cannot — no `air`), which the viewer previously had
// no way to know.
function targets (v) {
  const s = str(v);
  if (!s) return null;
  const list = s.split(',').map(t => t.trim()).filter(Boolean);
  return list.length ? list : null;
}

// Build one weapon descriptor from an SLK row given the column suffix ('1'|'2').
// Returns null when the weapon is effectively absent (no cooldown and no damage).
function weapon (row, s) {
  const cooldown    = num(row['cool' + s]);
  const damagePoint = num(row['dmgpt' + s]);
  const backswing   = num(row['backSw' + s]);
  const range       = num(row['rangeN' + s]);
  const minDamage   = num(row['mindmg' + s]);
  const maxDamage   = num(row['maxdmg' + s]);
  const weaponType  = str(row['weapTp' + s]);
  const attackType  = str(row['atkType' + s]);
  const rangeBuffer = num(row['RngBuff' + s]);
  const targs       = targets(row['targs' + s]);

  // A row without a cooldown and without damage isn't a real weapon (e.g. the
  // "none" weapon type placeholder on non-combat units).
  if ((cooldown == null || cooldown <= 0) && (maxDamage == null || maxDamage <= 0)) {
    return null;
  }

  const w = {};
  if (cooldown != null)    w.cooldown = round(cooldown, 3);
  if (damagePoint != null) w.damagePoint = round(damagePoint, 3);
  if (backswing != null)   w.backswing = round(backswing, 3);
  if (range != null)       w.range = Math.round(range);
  if (weaponType)          w.weaponType = weaponType;
  if (attackType)          w.attackType = attackType;
  if (minDamage != null)   w.minDamage = Math.round(minDamage);
  if (maxDamage != null)   w.maxDamage = Math.round(maxDamage);
  if (rangeBuffer != null) w.rangeBuffer = Math.round(rangeBuffer);
  if (targs)               w.targets = targs;
  return w;
}

const weapons = parseSLK(WEAPONS_PATH);

const units = {};
let kept = 0, skipped = 0;
for (const row of weapons.rows) {
  const id = row.unitWeaponID;
  if (!id) continue;

  const w1 = weapon(row, '1');
  if (!w1) { skipped++; continue; }        // no primary weapon → not a combatant

  const entry = w1;                        // weapon 1 fields sit at the top level

  // Cast point / backswing are per-unit (not per-weapon) — used for spell/cast
  // animation timing, kept alongside the primary weapon.
  const castPoint     = num(row.castpt);
  const castBackswing = num(row.castbsw);
  if (castPoint != null)     entry.castPoint = round(castPoint, 3);
  if (castBackswing != null) entry.castBackswing = round(castBackswing, 3);

  // Per-UNIT acquisition fields. `acquire` is the radius inside which the engine
  // makes a unit pick a target and attack with no player order at all, which is
  // most of what "units should be fighting here" means in a replay.
  const acquire  = num(row.acquire);
  const minRange = num(row.minRange);
  const weapsOn  = num(row.weapsOn);
  if (acquire != null)  entry.acquire = Math.round(acquire);
  if (minRange != null) entry.minRange = Math.round(minRange);
  // 0 none / 1 weapon1 / 2 weapon2 / 3 both. NOTE this does NOT mean "auto-
  // attacks": the Obsidian Statue is weapsOn 1 and still never swings unless
  // ordered, because Replenish autocast outranks it. That stays an explicit set
  // in UnitBehavior — no SLK field encodes it.
  if (weapsOn != null)  entry.weaponsOn = weapsOn;

  const w2 = weapon(row, '2');
  if (w2) entry.weapon2 = w2;

  units[id] = entry;
  kept++;
}

const out = { version: 2, units };
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(out));
const sizeKB = (fs.statSync(OUTPUT_PATH).size / 1024).toFixed(1);
console.log('Wrote ' + OUTPUT_PATH);
console.log('  units kept: ' + kept + ', skipped (no weapon): ' + skipped);
console.log('  size: ' + sizeKB + ' KB');
for (const id of ['hfoo', 'earc', 'ogru', 'ugho', 'hkni', 'hrif', 'Hpal', 'okod', 'hmtm']) {
  console.log('  ' + id + ': ' + JSON.stringify(units[id]));
}
