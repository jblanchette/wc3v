/**
 * Effective attack range lookup. Combines:
 *   - base range from helpers/unitRanges.json (extracted from UnitWeapons.slk)
 *   - per-player research-bonus deltas from helpers/rangeUpgrades.js, applied
 *     against the player's research event timeline
 *
 * Usage:
 *   getBaseRange(itemId)                 // number | 0 (0 = no weapon / melee N/A)
 *   getEffectiveRange(itemId, player)    // base + bonus the player has researched
 *
 * Returns 0 for units with no attack (workers, transports without weapons).
 * Callers should fall back to a small melee-equivalent stop distance when 0.
 */

const unitRangesData = require('./unitRanges.json');
const { RANGE_UPGRADES } = require('./rangeUpgrades');

const RANGES = (unitRangesData && unitRangesData.ranges) || {};

function getBaseRange (itemId) {
  if (!itemId) return 0;
  const entry = RANGES[itemId];
  return entry ? entry.range : 0;
}

// Sums all range bonuses the player has researched that apply to this unit.
// Walks the player's researchStream (server-side Unit data); for the browser
// client, a player object with the same shape works equivalently.
function getPlayerRangeBonus (itemId, player) {
  if (!player || !itemId) return 0;
  const research = player.researchLevels || player.researchStream || null;
  if (!research) return 0;

  // researchLevels is the live server map { upgradeId: level }; if it's
  // present prefer it (cheap dict lookup). Otherwise walk researchStream
  // and look for the upgrade.
  let bonus = 0;
  for (const upgradeId in RANGE_UPGRADES) {
    const upgrade = RANGE_UPGRADES[upgradeId];
    if (!upgrade.applies.includes(itemId)) continue;
    let level = 0;
    if (research[upgradeId] != null) {
      level = research[upgradeId] | 0;
    } else if (Array.isArray(research)) {
      for (const r of research) {
        if (r && r.itemId === upgradeId) level = Math.max(level, r.level | 0);
      }
    }
    if (level > 0) bonus += upgrade.delta * level;
  }
  return bonus;
}

function getEffectiveRange (itemId, player) {
  return getBaseRange(itemId) + getPlayerRangeBonus(itemId, player);
}

module.exports = {
  getBaseRange,
  getPlayerRangeBonus,
  getEffectiveRange
};
