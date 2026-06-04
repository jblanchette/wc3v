/**
 * CombatFormation — deterministic, range-aware combat positioning.
 *
 * WC3 replays record only the player's CLICKED target, not where the engine
 * actually settles each unit. For melee that barely matters (they end up on
 * top of the target either way), but for RANGED units it is everything: the
 * engine stops an archer/rifle/sorceress at its attack range, behind the melee
 * line, on a concave that wraps the enemy and focus-fires. Walking those units
 * onto the clicked point (the old behaviour) is wrong and cascades into every
 * downstream position.
 *
 * This module reconstructs the stop position the engine WOULD pick, from data
 * we actually have at command time:
 *   - each unit's effective attack range (helpers/effectiveRange.js)
 *   - the live positions of the attackers and the nearby enemies
 *
 * It is a pure function of those inputs — no RNG, all tie-breaks by uuid — so
 * the same replay always reconstructs the same positions.
 *
 *   resolveFormation(units, target, enemies, player, opts) -> Map<unit,{x,y}>
 *
 * The caller (PlayerActions) pathfinds each unit to its slot; CollisionWorld
 * resolves any residual overlap via snap-to-free.
 */

const { getEffectiveRange } = require("../helpers/effectiveRange");

// --- tunables --------------------------------------------------------------

// A unit never shares the target's exact coordinate; melee clamp to this.
const MIN_STOP = 64;

// Units whose effective attack range differ by less than this share a "rank"
// (a lateral line at roughly the same standoff). Keeps riflemen on one line and
// sorceresses on another instead of everyone stringing along a single ray.
const RANK_BUCKET = 140;

// Lateral spacing between neighbours in a rank (world units). Roughly two
// footman collision diameters — tight enough to read as a line, loose enough
// not to fight the collision snapper.
const BASE_SPACING = 64;

// Concave depth: wings of a rank pull TOWARD the enemy by up to this fraction
// of the rank's standoff, forming the bowl that wraps the target. Capped in
// absolute units so a long-range rank doesn't curl into a horseshoe.
const CONCAVE_PULL_FRAC = 0.30;
const CONCAVE_PULL_MAX = 140;

// When attackers outnumber the enemy we focus-fire: clamp each rank's half
// width to the enemy's lateral extent plus this margin so fire converges on
// the target instead of fanning across empty ground.
const FOCUS_MARGIN = 96;

// Below this effective range a unit is "melee" — used only for reporting /
// classification; standoff itself is always the unit's real range.
const MELEE_MAX_RANGE = 150;

// --- small vector helpers --------------------------------------------------

function mean (arr, sel) {
  let s = 0, n = 0;
  for (const a of arr) { const v = sel(a); if (v == null) continue; s += v; n++; }
  return n ? s / n : 0;
}

// Classify a unit's combat role from its effective attack range. Exported for
// the validator and any UI that wants to label ranks.
function classifyRole (unit, player) {
  const range = getEffectiveRange(unit.itemId, player) || 0;
  let role;
  if (range <= 0) role = 'support';            // no weapon (worker slipped in)
  else if (range <= MELEE_MAX_RANGE) role = 'melee';
  else role = 'ranged';
  return { role, range };
}

// --- core ------------------------------------------------------------------

/**
 * units    : attacking units (Unit instances with currentX/currentY). Caller
 *            should pre-filter buildings/workers/positionless units out.
 * target   : { x, y } focus point — the enemy the army is attacking (ideally
 *            the nearest enemy to the army, i.e. the enemy front).
 * enemies  : array of enemy Unit instances near the engagement (may be empty;
 *            used for facing + width + focus-fire). currentX/currentY read.
 * player   : owning Player (for range research bonuses).
 * opts     : { } reserved.
 *
 * Returns Map<unit, { x, y }>. Units with no resolvable position are omitted
 * (caller falls back to its default move for those).
 */
function resolveFormation (units, target, enemies, player, opts = {}) {
  const slots = new Map();
  const list = (units || []).filter(u => u && u.currentX != null && u.currentY != null);
  if (!list.length || !target) return slots;

  // Army centroid → the side of the target our units occupy.
  const cx = mean(list, u => u.currentX);
  const cy = mean(list, u => u.currentY);

  // Approach axis f: unit vector from target toward the army. Units stand at
  // target + f * standoff. p is the perpendicular (lateral) axis.
  let fx = cx - target.x, fy = cy - target.y;
  let flen = Math.sqrt(fx * fx + fy * fy);
  if (flen > 1e-3) { fx /= flen; fy /= flen; }
  else {
    // Army sitting on the target — face it from the average enemy instead, or
    // fall back to +x so we still produce a deterministic spread.
    const ex = mean(enemies || [], e => e.currentX);
    const ey = mean(enemies || [], e => e.currentY);
    fx = target.x - ex; fy = target.y - ey;
    flen = Math.sqrt(fx * fx + fy * fy);
    if (flen > 1e-3) { fx /= flen; fy /= flen; } else { fx = 1; fy = 0; }
  }
  const px = -fy, py = fx;

  // Enemy lateral extent along p — how wide the enemy line is. Drives focus-
  // fire clamping (bunch up against a small enemy, spread against a wide one).
  let enemyHalfWidth = 0;
  const liveEnemies = (enemies || []).filter(e => e && e.currentX != null && e.currentY != null);
  for (const e of liveEnemies) {
    const lat = (e.currentX - target.x) * px + (e.currentY - target.y) * py;
    enemyHalfWidth = Math.max(enemyHalfWidth, Math.abs(lat));
  }

  // Rank by effective attack range ascending: melee first (smallest standoff),
  // ranged behind. Stable secondary sort by uuid for determinism.
  const measured = list.map(u => ({
    unit: u,
    range: Math.max(MIN_STOP, getEffectiveRange(u.itemId, player) || 0),
    // current lateral position, so we can preserve left/right order in a rank.
    lat: (u.currentX - target.x) * px + (u.currentY - target.y) * py
  }));
  measured.sort((a, b) => {
    if (a.range !== b.range) return a.range - b.range;
    const au = a.unit.uuid || '', bu = b.unit.uuid || '';
    return au < bu ? -1 : au > bu ? 1 : 0;
  });

  // Bucket into ranks of similar range.
  const ranks = [];
  let cur = null;
  for (const m of measured) {
    if (!cur || (m.range - cur.range0) > RANK_BUCKET) {
      cur = { range0: m.range, members: [] };
      ranks.push(cur);
    }
    cur.members.push(m);
  }

  // Do we outnumber the enemy? Then focus-fire: tighten each rank's width.
  const focusFire = liveEnemies.length > 0 && list.length > liveEnemies.length;

  for (const rank of ranks) {
    const members = rank.members;
    const n = members.length;

    // Standoff for this rank = the max real range among its members (so the
    // shortest-range unit in a mixed bucket can still reach from the line).
    let standoff = MIN_STOP;
    for (const m of members) standoff = Math.max(standoff, m.range);

    // Order members across the rank by their current lateral position so they
    // don't cross paths to reach slots. Tie-break uuid.
    members.sort((a, b) => {
      if (a.lat !== b.lat) return a.lat - b.lat;
      const au = a.unit.uuid || '', bu = b.unit.uuid || '';
      return au < bu ? -1 : au > bu ? 1 : 0;
    });

    // Lateral spacing. Under focus-fire, clamp the rank's half width to the
    // enemy extent (+margin) so units converge rather than fan out.
    let spacing = BASE_SPACING;
    if (n > 1 && focusFire) {
      const maxHalf = enemyHalfWidth + FOCUS_MARGIN;
      const naturalHalf = ((n - 1) / 2) * BASE_SPACING;
      if (naturalHalf > maxHalf) spacing = (maxHalf * 2) / (n - 1);
    }

    const halfWidth = ((n - 1) / 2) * spacing || 1;
    const pull = Math.min(standoff * CONCAVE_PULL_FRAC, CONCAVE_PULL_MAX);

    members.forEach((m, i) => {
      const lateral = (i - (n - 1) / 2) * spacing;
      // Concave: wings pull toward the enemy (smaller standoff) ∝ offset².
      const t = halfWidth > 0 ? (lateral / halfWidth) : 0;
      const d = standoff - pull * (t * t);
      slots.set(m.unit, {
        x: target.x + fx * d + px * lateral,
        y: target.y + fy * d + py * lateral
      });
    });
  }

  return slots;
}

module.exports = {
  resolveFormation,
  classifyRole,
  // exported for tests / tuning
  _constants: {
    MIN_STOP, RANK_BUCKET, BASE_SPACING, CONCAVE_PULL_FRAC,
    CONCAVE_PULL_MAX, FOCUS_MARGIN, MELEE_MAX_RANGE
  }
};
