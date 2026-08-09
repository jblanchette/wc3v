/**
 * KinematicResim — post-pass that rewrites every Unit's authoritative position
 * stream (`Unit.path[]`) into a PHYSICALLY-VALID position + facing stream that
 * obeys WC3's real movement model (move speed, turn rate, propulsion window).
 *
 * Replaces lib/FacingInference.js (which only baked a `facing` angle while the
 * body still slid along straight A* segments and snapped around corners). This
 * pass solves two things at once:
 *
 *   1) MOVEMENT JUMPS — the recorded stream occasionally implies a unit moved
 *      faster/further than the engine allows (repath spam, A* re-anchoring,
 *      collision snap). A speed-capped simulator structurally cannot reproduce
 *      such a hop, so it disappears. Genuine discontinuities (blink / teleport /
 *      revive) survive ONLY via the explicit `isJump` flag.
 *
 *   2) TURNING — units now turn at their real angular rate and pivot in place on
 *      sharp reversals (WC3's propulsion window), instead of facing one way while
 *      sliding another. Facing and body move together.
 *
 * MODEL — a PURSUIT CONTROLLER run at a fixed 30 ms step (WC3's sim frame), in
 * RECORDED time:
 *   • The recorded path is a "ghost" target: ghost(t) = the recorded position at
 *     time t (linear between recorded samples). The ghost itself never exceeds
 *     move speed (it was recorded at move speed), so on straights the unit tracks
 *     it exactly.
 *   • Each frame the unit rotates its facing toward the ghost at min(turnRate,0.2)
 *     rad/frame, and advances toward the ghost at moveSpeed·dt — but ONLY while
 *     the heading error is within the unit's propulsion window; beyond it the unit
 *     pivots in place (no forward motion). At a sharp corner the unit therefore
 *     lags, rounds it, then catches up — exactly like WC3.
 *
 * WHY recorded time (not free physics time): the output stays on the replay clock,
 * so it is monotonic and never desyncs battle/death cues, while the turn rate is
 * still applied in real seconds (exact). Position differs from the raw click track
 * during turns — which is the whole point (the replay records where the player
 * clicked, not where the unit actually was).
 *
 * Output is a pure function of the recorded path + per-unit SLK stats + the fixed
 * step, so the baked stream is seek-safe (computed once here, sampled by gameTime
 * on the client exactly like position/facing already are).
 *
 * Runs as a post-pass in wc3v.js (after Death/Hide inference so those still see
 * the raw recorded path; this is the final path transform before serialization).
 */

const TWO_PI = Math.PI * 2;

// WC3 sim + turn model (mirrors the constants lib/FacingInference.js used).
const WC3_FRAME_MS = 30;                 // internal sim frame (~33 fps)
const MAX_TURN_RAD_PER_FRAME = 0.2;      // engine clamp on applied rotation / frame (~382 deg/s)
const DT_S = WC3_FRAME_MS / 1000;        // seconds per frame

// Fallbacks when a unit has no SLK movement data.
const DEFAULT_MOVESPEED = 250;           // world units / sec
const DEFAULT_TURN_RATE = 0.6;           // raw SLK rad/frame (foot-soldier-ish; capped below)
const DEFAULT_PROP_WINDOW_DEG = 60;      // foot units; degrees of heading error allowed while moving

// Path-gap rule — IDENTICAL to client ClientUnit.isPathGap so server and client
// segment the stream the same way (a gap = a genuine discontinuity: teleport,
// long idle, or impossible hop). Runs are simulated independently between gaps.
const PATH_MIN_TIME_GAP = 5 * 1000;
const PATH_MIN_GAP_DIST = 1500;
const PATH_MAX_TIME_GAP = 300 * 1000;
const PATH_MAX_GAP_DIST = 500;
const PATH_IDLE_GAP_TIME = 10 * 1000;

function isPathGap (a, b) {
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
function r2 (a) { return +a.toFixed(2); }

class KinematicResim {
  constructor (playerManager) {
    this.playerManager = playerManager;
    this.stats = { units: 0, inSamples: 0, outSamples: 0, runs: 0, jumpsPreserved: 0, violationsRemoved: 0 };
  }

  run () {
    const players = Object.values(this.playerManager.players || {});
    for (const player of players) {
      const units = (player.units || []).concat(player.destroyedSummons || []);
      for (const unit of units) {
        if (unit.isBuilding) continue;            // buildings don't move (parity with FacingInference)
        const path = unit.path;
        if (!path || path.length < 1) continue;
        this.stats.units++;
        this.stats.inSamples += path.length;
        unit.path = this._resimUnit(unit, path);
        this.stats.outSamples += unit.path.length;
      }
    }
    return this.stats;
  }

  // Per-unit SLK movement params, with safe fallbacks.
  _params (unit) {
    const meta = unit.meta || {};
    const moveSpeed = (meta.movespeed > 0) ? meta.movespeed : DEFAULT_MOVESPEED;
    const rawTurn = (meta.turnRate > 0) ? meta.turnRate : DEFAULT_TURN_RATE;
    const turnStep = Math.min(rawTurn, MAX_TURN_RAD_PER_FRAME);        // rad applied per frame
    const propDeg = (meta.propWindow != null) ? meta.propWindow : DEFAULT_PROP_WINDOW_DEG;
    const propWin = propDeg * Math.PI / 180;                          // heading error allowed while moving
    return { moveSpeed, turnStep, propWin };
  }

  _resimUnit (unit, path) {
    const p = this._params(unit);
    const n = path.length;

    // Single non-moving sample (spawn-only) — keep as-is, give it a neutral facing.
    if (n === 1) {
      const s = path[0];
      return [{ x: r2(s.x), y: r2(s.y), gameTime: Math.round(s.gameTime), facing: 0, isJump: !!s.isJump }];
    }

    // Partition into continuous runs at gaps/jumps (a run = [start, end] indices).
    const runs = [];
    let start = 0;
    for (let i = 1; i < n; i++) {
      if (isPathGap(path[i - 1], path[i])) { runs.push([start, i - 1]); start = i; }
    }
    runs.push([start, n - 1]);

    const out = [];
    let facing = null;             // carried across runs (a unit keeps its facing while idle)
    let lastEmitTime = -Infinity;

    for (const [a, b] of runs) {
      this.stats.runs++;
      // First sample of the run anchors position; preserve a genuine teleport flag
      // so the client snaps (no trail line) across it.
      const head = path[a];
      const runIsJump = !!head.isJump;
      if (runIsJump) this.stats.jumpsPreserved++;

      // Initial facing for the run: keep the carried facing; if none yet, aim at
      // the run's first travelled direction.
      if (facing == null) facing = this._firstHeading(path, a, b);

      // A run that is a single sample (an isolated point between two gaps): emit it.
      if (a === b) {
        facing = facing != null ? facing : 0;
        lastEmitTime = this._emit(out, head.x, head.y, head.gameTime, facing, runIsJump, lastEmitTime);
        continue;
      }

      // Emit the run's anchor sample.
      lastEmitTime = this._emit(out, head.x, head.y, head.gameTime, facing, runIsJump, lastEmitTime);

      // Pursuit-integrate the run in recorded time.
      let pos = { x: head.x, y: head.y };
      let gi = a;                                   // ghost segment index (advances monotonically)
      const t0 = head.gameTime;
      const tEnd = path[b].gameTime;
      let lastFacingEmit = facing;
      let lastPos = { x: pos.x, y: pos.y };

      for (let t = t0 + WC3_FRAME_MS; t < tEnd; t += WC3_FRAME_MS) {
        // Advance ghost segment so path[gi].gameTime <= t <= path[gi+1].gameTime.
        while (gi < b && path[gi + 1].gameTime <= t) gi++;
        const target = this._ghost(path, gi, b, t);

        const dx = target.x - pos.x, dy = target.y - pos.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 1e-3) {
          const desired = Math.atan2(dy, dx);
          facing = rotateToward(facing, desired, p.turnStep);
          // Move toward the ghost only once roughly aligned (propulsion window);
          // otherwise pivot in place this frame.
          if (Math.abs(angDiff(desired, facing)) <= p.propWin) {
            const step = Math.min(p.moveSpeed * DT_S, dist);
            pos.x += (dx / dist) * step;
            pos.y += (dy / dist) * step;
          }
        }

        // Adaptive emission — keep straights COARSE (the client interpolates them
        // exactly) and only densify through turns/pivots, where the trajectory
        // shape actually matters. Triggers: a meaningful facing change (~3.4°), a
        // distance fallback, or a max temporal gap (~legacy cadence). Plus the run
        // endpoint below. This keeps output size near the raw stream's.
        const movedSq = (pos.x - lastPos.x) ** 2 + (pos.y - lastPos.y) ** 2;
        const turned = Math.abs(angDiff(facing, lastFacingEmit));
        if (turned >= 0.06 || movedSq >= 96 * 96 || (t - lastEmitTime) >= 400) {
          lastEmitTime = this._emit(out, pos.x, pos.y, t, facing, false, lastEmitTime);
          lastFacingEmit = facing; lastPos = { x: pos.x, y: pos.y };
        }
      }

      // Final sample: emit the unit's ACTUAL simulated position at the run's end
      // time. We deliberately do NOT hard-snap to the recorded endpoint — if the
      // unit was still turning it is legitimately short of it, and forcing it onto
      // the recorded point in the same frame would re-introduce a speed-cap
      // violation (a visible jump). Runs are always separated by a gap, and the
      // next run re-anchors to its own recorded head; the client snaps across
      // gaps, so there is no interpolated jump regardless.
      lastEmitTime = this._emit(out, pos.x, pos.y, tEnd, facing, false, lastEmitTime);
    }

    return out;
  }

  // Linear ghost target at recorded time t within segment [gi, gi+1] (clamped).
  _ghost (path, gi, b, t) {
    const A = path[gi];
    if (gi >= b) return { x: path[b].x, y: path[b].y };
    const B = path[gi + 1];
    const span = B.gameTime - A.gameTime;
    if (span <= 0) return { x: B.x, y: B.y };
    const f = Math.min(1, Math.max(0, (t - A.gameTime) / span));
    return { x: A.x + (B.x - A.x) * f, y: A.y + (B.y - A.y) * f };
  }

  // First non-trivial travel direction in a run (for a unit's initial facing).
  _firstHeading (path, a, b) {
    const A = path[a];
    for (let i = a + 1; i <= b; i++) {
      const dx = path[i].x - A.x, dy = path[i].y - A.y;
      if (dx * dx + dy * dy > 1) return Math.atan2(dy, dx);
    }
    return 0;
  }

  // Emit a sample with a monotonic, de-duplicated time. Returns the emitted time.
  _emit (out, x, y, gameTime, facing, isJump, lastEmitTime) {
    let gt = Math.round(gameTime);
    if (gt <= lastEmitTime) gt = lastEmitTime + 1;       // strictly increasing (client binary-searches)
    const rec = { x: r2(x), y: r2(y), gameTime: gt, facing: r4(facing) };
    if (isJump) rec.isJump = true;
    out.push(rec);
    return gt;
  }
}

module.exports = KinematicResim;
// The shared path-gap rule (identical to client ClientUnit.isPathGap).
// Exported so passes that read/edit raw paths (lib/AnchorCorrection.js)
// segment the stream exactly the way the resim will.
module.exports.isPathGap = isPathGap;
