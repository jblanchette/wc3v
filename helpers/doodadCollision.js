/**
 * Doodad collision radii (world units, multiplied by per-instance scale).
 *
 * WC3 doodads (trees, rocks, gates, neutral structures) block units. The
 * authoritative source per-doodad is `DoodadMetaData.slk`'s `pathTex` column
 * referencing a TGA — but the radii are small and well-known, so we hardcode
 * the common ~30 types and use a category-prefix heuristic for the long tail.
 *
 * Effective collision radius = baseRadius × doodad.scale[0]
 * (WC3 doodad scale is always uniform; we only consume x).
 *
 * Doodad type IDs are 4 chars: char 0 = tileset code (L/V/F/W/N/A/C/B/...),
 * char 1 = category (T = tree, R = rock, O = log/ornament, etc.).
 *
 * Returns 0 for non-colliding doodads (decorative shrubs, flowers, ground
 * splats). Callers should skip stamping when radius === 0.
 */

const DOODAD_RADIUS = {
  // --- Trees (32 WU radius = 1 pathing cell at scale=1) ---
  // Lordaeron Summer/Fall/Winter, Ashenvale, Felwood, Barrens, Village, etc.
  'LTlt': 32, 'LTtw': 32, 'LTtg': 32, 'LTbs': 32,
  'WTst': 32, 'WTtw': 32,
  'FTtw': 32, 'FTtg': 32,
  'NTtw': 32, 'NTtg': 32, 'NTtc': 32,
  'ATtr': 32, 'ATtw': 32,
  'CTtr': 32, 'CTlt': 32,
  'BTtw': 32, 'BTtc': 32,
  'VTlt': 32, 'XTlt': 32,
  'YTab': 32, 'YTpb': 32, 'YTpc': 32,
  'OTip': 32,
  'ITtw': 32,
  'JTct': 32, 'KTtw': 32,
  'ZTtw': 32,
  'GTrs': 32, 'DTsh': 32,

  // --- Logs (a bit longer than trees but still 1-cell collision) ---
  'AOlg': 32, 'LOlg': 32,

  // --- Rocks & boulders ---
  'LRrk': 32, 'LRrc': 48, 'ARrk': 32,
  'BRrk': 32, 'YRrk': 32, 'WRrk': 32, 'NRrk': 32,
  'CRrk': 32, 'FRrk': 32, 'GRrk': 32,

  // --- Gates (block ~2x1 area) ---
  'DTg5': 64, 'DTg6': 64, 'DTg7': 64,
  'YOgt': 64,
  'LOgt': 64, 'AOgt': 64,

  // --- Neutral buildings (rare here — usually arrive via unit.json,
  //     not doo.json — but include for safety) ---
  'ngol': 144,    // gold mine: 5×5 tile footprint, but radius ~144 covers it
  'ntav': 96,     // tavern
  'nmrk': 96,     // marketplace
  'nmer': 96,     // mercenary camp
  'ngme': 96,     // goblin merchant
  'nfoh': 64,     // fountain of health
  'nmoo': 64,     // fountain of mana
};

/**
 * Resolve a doodad's effective collision radius.
 *
 * @param {string} doodadType - 4-char doodad type ID.
 * @param {number} [scale=1] - Per-instance uniform scale.
 * @returns {number} Effective collision radius in world units, or 0 if non-colliding.
 */
function resolveDoodadRadius (doodadType, scale) {
  if (!doodadType) return 0;
  const s = scale > 0 ? scale : 1;
  if (DOODAD_RADIUS[doodadType] != null) {
    return DOODAD_RADIUS[doodadType] * s;
  }
  // Heuristic by category char (position 1 in 4-char ID):
  //   T = tree, R = rock → default 32 WU.
  // Everything else: assume decorative (no collision).
  const cat = doodadType.charAt(1);
  if (cat === 'T' || cat === 'R') return 32 * s;
  return 0;
}

module.exports = {
  DOODAD_RADIUS,
  resolveDoodadRadius
};
