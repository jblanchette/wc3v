/**
 * FacingInference — post-pass that bakes a turn-rate-integrated facing angle onto
 * every Unit's authoritative position stream (`Unit.path[]`), so the 3D viewer can
 * face units the way they actually moved and rotate them at a realistic turn rate.
 *
 * WC3 records no facing. We derive it deterministically: along each continuous path
 * segment the unit *wants* to face its travel direction; its *actual* facing rotates
 * toward that desired heading at the unit's turn rate (clamped per segment). Facing
 * holds across path gaps (idle / long pause) and snaps on jumps (blink/teleport).
 *
 * Written as `facing` (radians, world space: 0 = +X / east, CCW) on each path sample.
 * The client samples it (shortest-arc interpolation) like position — so it's seek-safe
 * (a pure function of the baked stream + gameTime, computed once here).
 *
 * Runs as a post-pass alongside DeathInference/HideInference in wc3v.js.
 */

const TWO_PI = Math.PI * 2;
const DEFAULT_TURN_RATE = 0.004;   // rad per ms (~230 deg/s); extra easing on sharp corners
const GAP_MS = 10 * 1000;          // >10s or isJump = discontinuity (matches client isPathGap)
const MOVE_EPS2 = 1;               // min squared world-dist to count a segment as movement

// Per-itemId turn-rate overrides (rad/ms) — add entries to tune specific units.
const TURN_RATE_OVERRIDES = {};

function angDiff (to, from) {
  let d = (to - from) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
}
function rotateToward (current, target, maxStep) {
  const d = angDiff(target, current);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}
function r4 (a) { return +a.toFixed(4); }

class FacingInference {
  constructor (playerManager) {
    this.playerManager = playerManager;
    this.stats = { units: 0, samples: 0 };
  }

  run () {
    const players = Object.values(this.playerManager.players || {});
    for (const player of players) {
      const units = (player.units || []).concat(player.destroyedSummons || []);
      for (const unit of units) {
        if (unit.isBuilding) continue;
        const path = unit.path;
        if (!path || !path.length) continue;
        this._bake(unit, path);
        this.stats.units++;
        this.stats.samples += path.length;
      }
    }
    return this.stats;
  }

  _bake (unit, path) {
    const turnRate = TURN_RATE_OVERRIDES[unit.itemId] || DEFAULT_TURN_RATE;
    const n = path.length;

    // Pass 1 — desired heading at each sample = the OUTGOING segment direction
    // (where the unit is about to go), so facing aligns with current movement.
    // A stationary tail (no outgoing movement) holds the last real direction.
    const desired = new Array(n);
    let last = null;
    for (let i = n - 1; i >= 0; i--) {
      if (i < n - 1) {
        const dx = path[i + 1].x - path[i].x, dy = path[i + 1].y - path[i].y;
        if (dx * dx + dy * dy > MOVE_EPS2) last = Math.atan2(dy, dx);
      }
      desired[i] = last;
    }
    let firstKnown = 0;
    for (let i = 0; i < n; i++) if (desired[i] != null) { firstKnown = desired[i]; break; }
    for (let i = 0; i < n; i++) if (desired[i] == null) desired[i] = firstKnown;

    // Pass 2 — integrate actual facing toward the desired heading at the turn rate
    // (snap across jumps). Continuous + forward → the baked stream is seek-safe.
    let facing = desired[0];
    path[0].facing = r4(facing);
    for (let i = 1; i < n; i++) {
      const dt = path[i].gameTime - path[i - 1].gameTime;
      const gap = path[i].isJump || dt > GAP_MS;
      facing = gap ? desired[i] : rotateToward(facing, desired[i], turnRate * Math.max(1, dt));
      path[i].facing = r4(facing);
    }
  }
}

module.exports = FacingInference;
