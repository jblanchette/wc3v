/**
 * Range-modifying research upgrades. Hand-maintained table — covers the
 * standard melee-WC3 range upgrades only; extend as needed.
 *
 * Schema per entry:
 *   { displayName, applies: [unit itemIds], delta: WU }
 *
 * Per-player range state is reconstructed from the player's research event
 * stream (lib/Player.addResearch); see helpers/effectiveRange.js for the
 * lookup used at action-dispatch time.
 *
 * Sources verified against UnitWeapons.slk via tools/extract-unit-ranges.js
 * (e.g. Rifleman base 400, Long Rifles +200 → effective 600 — matches
 * WC3 tooltip text).
 */

const RANGE_UPGRADES = {
  // Human — Long Rifles, riflemen only
  'Rhri': { displayName: 'Long Rifles',     applies: ['hrif'],        delta: 200 },

  // Night Elf — Marksmanship, archers only
  'Remk': { displayName: 'Marksmanship',    applies: ['earc'],        delta: 100 },

  // (Orc and Undead have no native range-extender upgrade — Headhunters
  // / Crypt Fiends get other stat boosts instead.)
};

module.exports = { RANGE_UPGRADES };
