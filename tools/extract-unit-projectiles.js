/**
 * Extract per-unit PROJECTILE data from the raw WC3 game tables →
 * helpers/unitProjectiles.json + client/js/UnitProjectiles.js
 *
 * This is the missing half of helpers/unitCombat.json. That file has the attack
 * CADENCE (cooldown / damagePoint / backswing / range / weaponType); this one has
 * what the projectile does once it leaves the muzzle — speed, arc, homing, and
 * the launch/impact offsets. Together they're everything the 3D viewer needs to
 * fire a convincing missile.
 *
 * WHY A SEPARATE FILE, AND NOT unitCombat.json
 * --------------------------------------------
 * helpers/mappings.js folds unitCombat.json into `meta.combat` at PARSE time, so
 * the values are baked into every .wc3v. Adding fields there would mean
 * re-parsing the whole replay corpus before the client could see them. Emitting a
 * standalone client table sidesteps that entirely — same pattern as
 * tools/parse-ability-data.js → client/js/HeroAbilityStats.js.
 *
 * SOURCES (all already extracted under tools/map-data/units/)
 * ----------------------------------------------------------
 *   {race}unitfunc.txt   INI, [itemId] blocks. The projectile fields are marked
 *                        slk="Profile" in unitmetadata.slk, which means they live
 *                        in these profile files and NOT in any .slk:
 *                          Missileart    (ua1m/ua2m)  model path
 *                          Missilespeed  (ua1z/ua2z)  world units / second
 *                          Missilearc    (uma1/uma2)  ratio — peak = arc x distance
 *                          MissileHoming (umh1/umh2)  bool
 *   unitweaponsfunc.txt  INI. launchX / launchY — the muzzle offset. launchY is
 *                        FORWARD along facing, launchX is LATERAL. (Unintuitive,
 *                        but it matches the engine: most ranged units have
 *                        launchX=0 and a nonzero launchY.)
 *   unitweaponsskin.txt  INI. launchZ (muzzle height) and impactZ (the height on
 *                        the target that a missile strikes).
 *   unitweapons.slk      Farea1/Farea2 — full-damage splash radius, used to size
 *                        the impact effect.
 *
 * FORMAT TRAPS, ALL LOAD-BEARING
 * ------------------------------
 *   1. Multi-weapon values are COMMA-JOINED into a single key, weapon1 first:
 *        Missilespeed=2500,900
 *        Missileart=…\SteamTankImpact.mdl,…\RocketMissile.mdl
 *      This is the same quirk HiveWE works around by synthesising `missileart2`
 *      columns (src/base/map/map.ixx).
 *   2. Key case is inconsistent — both `MissileHoming` and `Missilehoming` occur.
 *      All key matching here is case-insensitive.
 *   3. Reforged `:hd` variants (launchZ:hd, Missileart:hd, projectileVisOffsetX:hd)
 *      are SKIPPED. The viewer renders Classic SD.
 *
 * HOMING DEFAULT
 * --------------
 * Only 167 of 346 units carry an explicit MissileHoming; unitmetadata.slk has no
 * default column, so the file can't tell us. We default homing ON for travelling
 * missile types (in game an Archer's arrow visibly tracks a moving target) and
 * force it OFF for artillery, which the engine converts to a fixed ground point
 * at launch and never homes. An explicit field always wins.
 *
 * OUTPUT SCHEMA
 * -------------
 *   { "version": 1,
 *     "units": {
 *       "<itemId>": {
 *         "speed": N,          // wu/sec; absent = nothing travels
 *         "arc": N,            // ratio, peak height = arc * initial 2D distance
 *         "homing": 0 | 1,
 *         "instant": 1,        // present INSTEAD of speed/arc/homing on `instant`
 *                              // weapons — muzzle flash + impact, no flight
 *         "art": "Abilities\\Weapons\\…",   // for a future real-missile-art pass
 *         "launchX": N, "launchY": N, "launchZ": N,
 *         "impactZ": N,
 *         "splash": N,         // full-damage AoE radius, sizes the impact puff
 *         "weapon2": { … }     // only when it genuinely differs from weapon 1
 *       } } }
 *
 * Re-run after a new CASC extraction. Commit both outputs. No parser rebuild and
 * no replay re-parse are needed — nothing here touches the .wc3v schema.
 *
 * Usage: node tools/extract-unit-projectiles.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { parseSLK } = require('../helpers/slkParser');

const UNITS_DIR   = path.join(__dirname, 'map-data', 'units');
const OUTPUT_JSON = path.join(__dirname, '..', 'helpers', 'unitProjectiles.json');
const OUTPUT_JS   = path.join(__dirname, '..', 'client', 'js', 'UnitProjectiles.js');

// Campaign first, so a real ladder/neutral unit always overrides a campaign
// duplicate of the same itemId.
const FUNC_FILES = [
  'campaignunitfunc.txt',
  'humanunitfunc.txt',
  'orcunitfunc.txt',
  'undeadunitfunc.txt',
  'nightelfunitfunc.txt',
  'neutralunitfunc.txt'
];

// Weapon types whose projectile physically travels across the map.
const TRAVELS = new Set(['missile', 'msplash', 'mbounce', 'mline', 'artillery', 'aline']);
const ARTILLERY = new Set(['artillery', 'aline']);

// `instant` hits with no flight at all (Rifleman, Dryad) — the engine spawns the
// missile art at the target and plays only its Death animation. Those units get
// NO speed, but they DO need launch/impact geometry: the muzzle flash goes at
// launchX/Y/Z and the hit goes at impactZ. Dropping them entirely (an earlier
// version of this tool did) leaves a Rifleman with no visual at all.
const NO_FLIGHT = new Set(['instant']);

// ── INI reading ────────────────────────────────────────────────────────────
//
// Returns { itemId: { lowercasedKey: rawValue } }. `:hd` keys are dropped here
// so no downstream code has to remember to skip them.
function readINI (file) {
  const full = path.join(UNITS_DIR, file);
  if (!fs.existsSync(full)) return {};
  const out = {};
  let cur = null;
  for (const raw of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '/') continue;
    if (line[0] === '[') {
      const id = line.slice(1, line.indexOf(']'));
      cur = out[id] || (out[id] = {});
      continue;
    }
    if (!cur) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (key.includes(':')) continue;          // :hd / :custom variants — SD only
    cur[key.toLowerCase()] = line.slice(eq + 1).trim();
  }
  return out;
}

// Split a possibly comma-joined "weapon1,weapon2" value. Always returns a
// 2-element array; index 1 falls back to index 0, which is what the engine does
// when attack 2 has no art of its own.
function pair (v) {
  if (v == null) return [null, null];
  const parts = String(v).split(',').map(s => s.trim());
  const a = parts[0] || null;
  const b = (parts.length > 1 && parts[1]) ? parts[1] : a;
  return [a, b];
}

function num (v) {
  if (v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function round (v, d) {
  return v == null ? null : +v.toFixed(d);
}

// ── load every source ──────────────────────────────────────────────────────
const funcs = {};
const perFileCounts = {};
for (const f of FUNC_FILES) {
  const ini = readINI(f);
  let n = 0;
  for (const id in ini) {
    if (ini[id].missileart == null && ini[id].missilespeed == null) continue;
    funcs[id] = Object.assign(funcs[id] || {}, ini[id]);
    n++;
  }
  perFileCounts[f] = n;
}

const weaponFunc = readINI('unitweaponsfunc.txt');   // launchX / launchY
const weaponSkin = readINI('unitweaponsskin.txt');   // launchZ / impactZ

// unitweapons.slk: weapon type (decides whether a missile travels at all) and
// the splash radius that sizes the impact effect.
const slk = parseSLK(path.join(UNITS_DIR, 'unitweapons.slk'));
const weaponRows = {};
for (const row of slk.rows) {
  if (row.unitWeaponID) weaponRows[row.unitWeaponID] = row;
}

// ── build ──────────────────────────────────────────────────────────────────
function weaponTypeOf (row, s) {
  const v = row && row['weapTp' + s];
  if (typeof v !== 'string') return null;
  const t = v.trim().toLowerCase();
  return (!t || t === '_' || t === '-') ? null : t;
}

function buildWeapon (fn, row, idx) {
  const s = String(idx + 1);
  const wt = weaponTypeOf(row, s);
  const flies = !wt || TRAVELS.has(wt);
  if (!flies && !NO_FLIGHT.has(wt)) return null;   // melee and everything else

  const speed = num(pair(fn.missilespeed)[idx]);
  const art   = pair(fn.missileart)[idx];
  // No speed and no art means this weapon simply has no projectile, whatever
  // the weapon type column claims.
  if (speed == null && !art) return null;

  const arc = num(pair(fn.missilearc)[idx]);
  const homingRaw = num(pair(fn.missilehoming)[idx]);
  const homing = homingRaw != null
    ? (homingRaw ? 1 : 0)
    : (wt && ARTILLERY.has(wt) ? 0 : 1);       // see HOMING DEFAULT above

  const w = {};
  // An `instant` weapon carries a Missilespeed in the data (Rifleman says 1900)
  // but nothing ever travels, so the speed is dropped rather than left to
  // mislead a consumer into drawing a bolt. `art` is kept — for instant weapons
  // it IS the impact model.
  if (flies && speed != null) w.speed = Math.round(speed);
  if (flies && arc != null)   w.arc = round(arc, 3);
  if (flies) w.homing = homing;
  else w.instant = 1;
  if (art) w.art = art;

  const splash = num(row && row['Farea' + s]);
  if (splash != null && splash > 0) w.splash = Math.round(splash);

  return w;
}

const units = {};
let kept = 0, withSecond = 0, noGeometry = 0;

for (const id in funcs) {
  const fn = funcs[id];
  const row = weaponRows[id];

  const w1 = buildWeapon(fn, row, 0);
  if (!w1) continue;

  // Snapshot BEFORE the per-unit geometry is merged in below — `entry` aliases
  // `w1`, so comparing against it afterwards would see launchX/impactZ and
  // report every second weapon as distinct.
  const w1json = JSON.stringify(w1);
  const entry = w1;

  // Muzzle + impact geometry is per-UNIT, not per-weapon.
  const wf = weaponFunc[id] || {};
  const ws = weaponSkin[id] || {};
  const lx = num(wf.launchx), ly = num(wf.launchy);
  const lz = num(ws.launchz), iz = num(ws.impactz);
  if (lx) entry.launchX = Math.round(lx);       // 0 is the default; omit it
  if (ly) entry.launchY = Math.round(ly);
  if (lz) entry.launchZ = Math.round(lz);
  if (iz) entry.impactZ = Math.round(iz);
  if (lz == null && iz == null) noGeometry++;

  const w2 = buildWeapon(fn, row, 1);
  // Only record weapon2 when it actually differs — most units repeat weapon 1.
  // Both objects come out of buildWeapon in the same key order, so comparing
  // the serialisations is sound.
  if (w2 && JSON.stringify(w2) !== w1json) {
    entry.weapon2 = w2;
    withSecond++;
  }

  units[id] = entry;
  kept++;
}

// ── write ──────────────────────────────────────────────────────────────────
const out = { version: 1, units };
fs.writeFileSync(OUTPUT_JSON, JSON.stringify(out, null, 2));

const stamp = new Date().toISOString().slice(0, 10);
const js =
`/**
 * UnitProjectiles.js — per-unit missile speed / arc / homing / launch offsets,
 * generated from the WC3 CASC game files by tools/extract-unit-projectiles.js.
 * DO NOT EDIT BY HAND — re-run the tool to regenerate.
 *
 * Generated: ${stamp}
 * Sources:   ${FUNC_FILES.join(', ')}, unitweaponsfunc.txt, unitweaponsskin.txt, unitweapons.slk
 *
 * Companion to meta.combat (helpers/unitCombat.json), which carries the attack
 * CADENCE. This carries what happens after the muzzle. Consumed by
 * client/js/ProjectileModel.js; see that file for the flight math.
 *
 * Per unit (keyed by itemId, exact case as in the game files):
 *   { speed,            // world units / second, horizontal only
 *     arc,              // ratio; peak height = arc * initial 2D distance
 *     homing,           // 1 = re-reads the target position, 0 = fixed point
 *     art,              // MDX path, unused today — for a future real-art pass
 *     launchX,          // LATERAL muzzle offset  (omitted when 0)
 *     launchY,          // FORWARD muzzle offset  (omitted when 0)
 *     launchZ,          // muzzle height above the unit's ground/fly plane
 *     impactZ,          // strike height on the target
 *     splash,           // full-damage AoE radius, sizes the impact effect
 *     weapon2 }         // only when the second weapon genuinely differs
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.UnitProjectiles = mod;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';
  return ${JSON.stringify(out, null, 2)};
});
`;
fs.writeFileSync(OUTPUT_JS, js);

// ── report ─────────────────────────────────────────────────────────────────
const kb = p => (fs.statSync(p).size / 1024).toFixed(1) + ' KB';
console.log('Wrote:');
console.log('  ' + path.relative(process.cwd(), OUTPUT_JSON) + '  (' + kb(OUTPUT_JSON) + ')');
console.log('  ' + path.relative(process.cwd(), OUTPUT_JS) + '  (' + kb(OUTPUT_JS) + ')');
console.log('');
console.log('  units with a travelling projectile: ' + kept);
console.log('  ...with a distinct second weapon:   ' + withSecond);
console.log('  ...missing launchZ AND impactZ:     ' + noGeometry + ' (fall back to a mid-body default)');
console.log('  distinct missile models:            ' +
  new Set(Object.values(units).flatMap(u => [u.art, u.weapon2 && u.weapon2.art]).filter(Boolean)).size);
console.log('');
console.log('  per source file: ' +
  FUNC_FILES.map(f => f.replace('unitfunc.txt', '') + '=' + perFileCounts[f]).join('  '));
console.log('');
// Spot-check row: a plain archer, an instant weapon, artillery, a hero caster,
// and a siege engine with two genuinely different weapons.
for (const id of ['earc', 'hrif', 'hgyr', 'hmtm', 'ocat', 'umtw', 'Hamg', 'hmtt']) {
  console.log('  ' + id.padEnd(5) + ' ' + (units[id] ? JSON.stringify(units[id]) : '— no entry —'));
}
