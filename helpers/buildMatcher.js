/**
 * buildMatcher.js — Shared build detection logic.
 *
 * Uses weighted hybrid scoring: T1 units (before tier 2) count 2x,
 * T2+ units count 1x. Ghouls are in WORKER_IDS and excluded from scoring.
 * Hero opener must match (mandatory). Build with highest weighted keyUnit
 * overlap wins.
 */

const SUMMON_IDS = {
  'uske': true, 'hwat': true, 'hwt2': true, 'hwt3': true,
  'efon': true, 'osw1': true, 'osw2': true, 'osw3': true, 'ucs1': true
};

const WORKER_IDS = {
  'opeo': true, 'hpea': true, 'ewsp': true, 'uaco': true, 'ugho': true
};

/**
 * Match a player's game to the best-fitting build definition.
 *
 * @param {string} race - Single-letter race code (H/O/E/U)
 * @param {string} heroItemId - First hero's itemId (may be capitalized)
 * @param {Array} eventStream - Player's eventStream from parsed replay
 * @param {Array} tierStream - Player's tierStream from parsed replay
 * @param {Array} builds - Array of build objects from builds-manifest.json
 * @returns {object|null} The best matching build, or null
 */
function matchBuild(race, heroItemId, eventStream, tierStream, builds) {
  const candidates = builds.filter(b => b.race === race);
  if (!candidates.length) return null;

  const t2Time = ((tierStream || []).find(t => t.tier === 2) || {}).gameTime || Infinity;

  // Build weighted unit scores from eventStream
  const unitScores = {}; // itemId (lowercase) → weighted score
  for (const ev of eventStream) {
    if (ev.key !== 'addUnit' || !ev.unit) continue;
    if (ev.unit.isHero) continue;
    const id = ev.unit.itemId;
    if (!id) continue;
    if (WORKER_IDS[id] || SUMMON_IDS[id]) continue;

    const weight = ev.gameTime < t2Time ? 2 : 1;
    const key = id.toLowerCase();
    unitScores[key] = (unitScores[key] || 0) + weight;
  }

  let bestMatch = null;
  let bestScore = 0;

  for (const build of candidates) {
    const buildHero = (build.heroItemIds && build.heroItemIds[0]) || build.heroItemId;
    if (!buildHero || !heroItemId) continue;
    if (buildHero.toLowerCase() !== heroItemId.toLowerCase()) continue;

    // Hero match base score
    let score = 3;

    // Weighted keyUnit overlap
    for (const ku of (build.keyUnits || [])) {
      score += unitScores[ku.toLowerCase()] || 0;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = build;
    }
  }

  return bestMatch;
}

module.exports = { matchBuild, SUMMON_IDS, WORKER_IDS };
