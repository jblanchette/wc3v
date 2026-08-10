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

// --- surround (building / lone-target sieges) ------------------------------

// Gap between a surround ring and the footprint edge (and between rings).
const SURROUND_GAP = 16;

// Minimum spacing between neighbouring surround slots along the perimeter.
const SURROUND_MIN_STRIDE = 48;

// How many concentric rings of melee slots to generate before overflow units
// fall back to a plain move toward the target.
const SURROUND_RINGS = 3;

/**
 * The rectangle units actually collide with, in world units. `walkBbox` is the
 * walk-block bounding box of the building's pathing TGA; its offsetX/offsetY
 * are ALREADY world-unit offsets from the building center to the bbox center
 * (parse-building-pathing.js multiplies by 32 at extraction), so they are
 * added raw — do not scale them again.
 */
function buildingShape (building, entry) {
  const wb = entry && entry.walkBbox;
  if (wb) {
    return {
      x: building.currentX + (wb.offsetX || 0),
      y: building.currentY + (wb.offsetY || 0),
      halfW: wb.widthCells * 16,
      halfH: wb.heightCells * 16,
      kind: 'rect'
    };
  }
  // No pathing entry (scenario-map oddities): a 6x6-cell placeholder.
  return { x: building.currentX, y: building.currentY, halfW: 96, halfH: 96, kind: 'rect' };
}

// Distance from the shape center to its edge along bearing theta.
function edgeDistance (shape, theta) {
  if (shape.kind === 'circle') return shape.radius;
  const c = Math.abs(Math.cos(theta)), s = Math.abs(Math.sin(theta));
  return Math.min(
    shape.halfW / Math.max(c, 1e-6),
    shape.halfH / Math.max(s, 1e-6),
    Math.hypot(shape.halfW, shape.halfH)
  );
}

// Point at arclength s (from the east-edge midpoint, counter-clockwise) on the
// rectangle of half-extents (hw, hh) centered at origin.
function rectPerimeterPoint (hw, hh, s) {
  const P = 4 * (hw + hh);
  s = ((s % P) + P) % P;
  if (s < hh)                return { x: hw, y: s };                       // east edge, up
  s -= hh;
  if (s < 2 * hw)            return { x: hw - s, y: hh };                  // north edge
  s -= 2 * hw;
  if (s < 2 * hh)            return { x: -hw, y: hh - s };                 // west edge
  s -= 2 * hh;
  if (s < 2 * hw)            return { x: -hw + s, y: -hh };                // south edge
  s -= 2 * hw;
  return { x: hw, y: -hh + s };                                           // east edge, up to start
}

function normAng (a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Claim the free surround candidate that best fits a unit approaching from
 * (fromX, fromY): inner rings before outer, then the smallest angular detour
 * from the unit's own bearing, ties by candidate index. Marks the winner
 * taken. Shared by the initial assignment and the dispatcher's arrival retry
 * (a unit that reached its slot but still cannot hit the target claims the
 * next slot under the same rule, so retries stay deterministic).
 */
function claimCandidate (candidates, fromX, fromY, shape) {
  const bearing = Math.atan2(fromY - shape.y, fromX - shape.x);
  let best = null, bestKey = Infinity;
  for (const c of candidates) {
    if (c.taken) continue;
    const key = c.ring * 100 + Math.abs(normAng(c.angle - bearing));
    if (key < bestKey - 1e-9 ||
        (Math.abs(key - bestKey) <= 1e-9 && best && c.index < best.index)) {
      best = c; bestKey = key;
    }
  }
  if (best) best.taken = true;
  return best;
}

/**
 * Surround positioning for a single target with real extent — an enemy
 * building (rect footprint) or a lone unit (circle). Melee take perimeter
 * slots ring by ring; ranged hold a one-sided arc on the army's side (WC3
 * ranged units do not wrap a target).
 *
 * units    : attacking units (currentX/currentY read; buildings/positionless
 *            filtered by the caller).
 * shape    : buildingShape() result, or { x, y, radius, kind:'circle' }.
 * player   : owning Player (range research bonuses).
 * walkTest : (x, y) => bool — true if the cell at that world position is
 *            walkable. Slots on blocked cells are never generated (partial
 *            rings against cliffs/trees, like the engine). Pass null to skip.
 *
 * Deterministic: candidates walk the perimeter from a fixed origin, units are
 * processed in (distance, uuid) order, ties on angular fit break by candidate
 * index. Returns { slots: Map<unit,{x,y}>, candidates, unassigned } — callers
 * that only want positions read .slots; the dispatcher uses candidates for
 * retry reassignment.
 */
function resolveSurround (units, shape, player, walkTest, opts = {}) {
  const slots = new Map();
  const list = (units || []).filter(u => u && u.currentX != null && u.currentY != null);
  if (!list.length || !shape) return { slots, candidates: [], unassigned: [] };

  const measured = list.map(u => {
    const range = getEffectiveRange(u.itemId, player) || 0;
    return {
      unit: u,
      range: Math.max(MIN_STOP, range),
      melee: range <= MELEE_MAX_RANGE,
      r: (u.balanceInfo && u.balanceInfo.collisionSize) || 16,
      dist: Math.hypot(u.currentX - shape.x, u.currentY - shape.y),
      bearing: Math.atan2(u.currentY - shape.y, u.currentX - shape.x)
    };
  });
  const melee = measured.filter(m => m.melee);
  const ranged = measured.filter(m => !m.melee);

  // --- melee: perimeter rings ---
  const candidates = [];
  if (melee.length) {
    const maxR = melee.reduce((m, u) => Math.max(m, u.r), 16);
    const stride = Math.max(2 * maxR, SURROUND_MIN_STRIDE);
    for (let k = 0; k < SURROUND_RINGS; k++) {
      const grow = SURROUND_GAP + maxR + k * (2 * maxR + SURROUND_GAP);
      if (shape.kind === 'circle') {
        const R = shape.radius + grow;
        const count = Math.max(1, Math.floor((2 * Math.PI * R) / stride));
        for (let i = 0; i < count; i++) {
          const ang = ((i + 0.5) / count) * 2 * Math.PI;
          const x = shape.x + Math.cos(ang) * R;
          const y = shape.y + Math.sin(ang) * R;
          if (walkTest && !walkTest(x, y)) continue;
          candidates.push({ x, y, angle: normAng(ang), ring: k, index: candidates.length, taken: false });
        }
      } else {
        const hw = shape.halfW + grow, hh = shape.halfH + grow;
        const P = 4 * (hw + hh);
        const count = Math.max(1, Math.floor(P / stride));
        for (let i = 0; i < count; i++) {
          const p = rectPerimeterPoint(hw, hh, ((i + 0.5) / count) * P);
          const x = shape.x + p.x, y = shape.y + p.y;
          if (walkTest && !walkTest(x, y)) continue;
          candidates.push({ x, y, angle: Math.atan2(p.y, p.x), ring: k, index: candidates.length, taken: false });
        }
      }
    }

    // Closest units claim first (they arrive first); each takes the free slot
    // with the best angular fit to its own approach, inner rings before outer.
    const order = melee.slice().sort((a, b) => {
      if (a.dist !== b.dist) return a.dist - b.dist;
      const au = a.unit.uuid || '', bu = b.unit.uuid || '';
      return au < bu ? -1 : au > bu ? 1 : 0;
    });
    for (const m of order) {
      const best = claimCandidate(candidates, m.unit.currentX, m.unit.currentY, shape);
      if (best) slots.set(m.unit, { x: best.x, y: best.y });
    }
  }

  // --- ranged: one-sided arc at attack range from the footprint edge ---
  if (ranged.length) {
    // Army side = centroid bearing over ALL attackers (melee included), so the
    // arc sits behind the melee mass rather than behind the ranged stragglers.
    let sx = 0, sy = 0;
    for (const m of measured) { sx += Math.cos(m.bearing); sy += Math.sin(m.bearing); }
    const thetaC = (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) ? 0 : Math.atan2(sy, sx);

    const order = ranged.slice().sort((a, b) => {
      if (a.range !== b.range) return a.range - b.range;
      const au = a.unit.uuid || '', bu = b.unit.uuid || '';
      return au < bu ? -1 : au > bu ? 1 : 0;
    });
    const n = order.length;
    const minRange = order[0].range;
    const angStep = BASE_SPACING / Math.max(64, edgeDistance(shape, thetaC) + minRange);
    order.forEach((m, i) => {
      const theta = thetaC + (i - (n - 1) / 2) * angStep;
      const d = edgeDistance(shape, theta) + m.range;
      slots.set(m.unit, {
        x: shape.x + Math.cos(theta) * d,
        y: shape.y + Math.sin(theta) * d
      });
    });
  }

  const unassigned = measured.filter(m => !slots.has(m.unit)).map(m => m.unit);
  return { slots, candidates, unassigned, shape };
}

module.exports = {
  resolveFormation,
  resolveSurround,
  buildingShape,
  claimCandidate,
  classifyRole,
  // exported for tests / tuning
  _constants: {
    MIN_STOP, RANK_BUCKET, BASE_SPACING, CONCAVE_PULL_FRAC,
    CONCAVE_PULL_MAX, FOCUS_MARGIN, MELEE_MAX_RANGE,
    SURROUND_GAP, SURROUND_MIN_STRIDE, SURROUND_RINGS
  }
};
