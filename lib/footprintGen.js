// Pre-compute deterministic footprint stamp positions for a hero's path.
// Run once at parse time; result is serialized into the .wc3v file so each
// replay always renders the exact same stamps regardless of when/how the
// client iterates the path data.
//
// Each stamp:
//   { x, y, yaw, gameTime, side }
//     x, y       — WC3 world coordinates (with lateral L/R offset already applied)
//     yaw        — Y-axis rotation expected by the client's Euler('YXZ')
//                  matches what the client used to compute on-the-fly:
//                  yaw = atan2(dx_world, -dy_world)
//     gameTime   — game time the hero passed this point (linearly interp'd
//                  along the edge between two path waypoints)
//     side       — +1 / -1 for which foot (consistent across rebuilds)

const FOOT_SPACING       = 180;        // world units between stamps
const FOOT_LATERAL       = 20;         // perpendicular offset from path centerline

// Same gap rules the client uses (kept in sync with ClientUnit.isPathGap).
// Stamps are not emitted across gaps; the running L/R counter continues.
const PATH_MIN_TIME_GAP  = 5 * 1000;
const PATH_MIN_GAP_DIST  = 1500;
const PATH_MAX_TIME_GAP  = 300 * 1000;
const PATH_MAX_GAP_DIST  = 500;
const PATH_IDLE_GAP_TIME = 10 * 1000;

function isGap (a, b) {
  if (!a || !b) return false;
  if (b.isJump) return true;
  const dt = b.gameTime - a.gameTime;
  if (dt > PATH_IDLE_GAP_TIME) return true;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > PATH_MIN_GAP_DIST && dt < PATH_MIN_TIME_GAP) return true;
  if (dist > PATH_MAX_GAP_DIST && dt > PATH_MAX_TIME_GAP) return true;
  return false;
}

function generateFootprints (path) {
  if (!path || path.length < 2) return [];

  const out = [];
  let stampIdx = 0;
  let carry = 0;          // distance carried over from previous edge
  let segmentStart = true;

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (!a || !b) continue;
    if (isNaN(a.x) || isNaN(a.y) || isNaN(b.x) || isNaN(b.y)) continue;

    if (segmentStart) {
      carry = 0;
      segmentStart = false;
    }

    if (isGap(a, b)) {
      segmentStart = true;
      continue;
    }

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (segLen <= 0) continue;

    const dirX = dx / segLen;
    const dirY = dy / segLen;
    // Match client yaw formula: atan2(three_x, three_z) = atan2(dx_world, -dy_world)
    const yaw = Math.atan2(dx, -dy);

    let walked = -carry;
    while (walked + FOOT_SPACING <= segLen) {
      walked += FOOT_SPACING;
      const sign = (stampIdx % 2 === 0) ? 1 : -1;
      // Perpendicular in world coords (CCW 90°): (-dy, dx). Apply L/R sign.
      const perpX = -dirY * FOOT_LATERAL * sign;
      const perpY =  dirX * FOOT_LATERAL * sign;

      const px = a.x + dirX * walked + perpX;
      const py = a.y + dirY * walked + perpY;
      const tInEdge = walked / segLen;
      const stampGT = a.gameTime + (b.gameTime - a.gameTime) * tInEdge;

      out.push({
        x: px,
        y: py,
        yaw: yaw,
        gameTime: stampGT,
        side: sign
      });
      stampIdx++;
    }
    carry = segLen - walked;
  }

  return out;
}

module.exports = {
  generateFootprints,
  FOOT_SPACING,
  FOOT_LATERAL
};
