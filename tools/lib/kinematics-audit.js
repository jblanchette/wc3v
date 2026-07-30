//
// kinematics-audit.js — the KinematicResim output validation from
// `inspect-replay.js --show=kinematics`, as a requireable module for
// fidelity-report.js. Same rules, same tolerance — ported, not reinvented.
//
// Proves the re-simulated path obeys the engine: between consecutive in-run
// samples the IMPLIED SPEED must never exceed the unit's base move speed (the
// guarantee that removes "jumps"). Idle gaps (>10s) and explicit JUMP samples
// (blink/teleport/revive) are legitimately exempt.
//
const SPEED_TOL = 1.08;          // allow 8% over base (sample rounding / diagonal A*)

// Same gap rule as client ClientUnit.isPathGap / lib/KinematicResim: a gap is a
// genuine discontinuity (teleport / long idle / impossible recorded hop) that
// both the resim and the client snap across — exclude it from the speed check.
const isGap = (a, b) => {
  if (b.isJump) return true;
  const dt = b.gameTime - a.gameTime;
  if (dt > 10000) return true;
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  if (dist > 1500 && dt < 5000) return true;
  if (dist > 500 && dt > 300000) return true;
  return false;
};

/**
 * Audit every non-neutral player's non-building unit paths.
 * Returns {
 *   units, pairs, speedViolations, unitsWithoutFacing, worstRatio,
 *   worst: [{name, itemId, viol, maxSpeed, baseSpeed}]   // violators only
 * }
 */
function audit (data) {
  let units = 0, pairs = 0, speedViolations = 0, noFacing = 0, worstRatio = 0;
  const worst = [];

  for (const [pid, pdata] of Object.entries(data.players || {})) {
    if (!pdata || pdata.isNeutralPlayer) continue;

    const list = (pdata.units || []).filter(u => !u.isBuilding && u.path && u.path.length > 1);
    for (const u of list) {
      units++;
      const p = u.path;
      const baseSpeed = (u.meta && u.meta.movespeed > 0) ? u.meta.movespeed : 250;
      const cap = baseSpeed * SPEED_TOL;
      let viol = 0, maxSpeed = 0, hasFacing = false;
      for (let i = 1; i < p.length; i++) {
        if (p[i].facing != null) hasFacing = true;
        if (isGap(p[i - 1], p[i])) continue;                   // skip genuine discontinuities
        const dt = (p[i].gameTime - p[i - 1].gameTime) / 1000;
        if (dt <= 0) continue;
        const dist = Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
        const speed = dist / dt;
        pairs++;
        if (speed > maxSpeed) maxSpeed = speed;
        if (speed > cap) { viol++; speedViolations++; }
      }
      if (!hasFacing) noFacing++;
      if (maxSpeed / baseSpeed > worstRatio) worstRatio = maxSpeed / baseSpeed;
      if (viol > 0) worst.push({ name: u.displayName, itemId: u.itemId, playerId: pid, viol, maxSpeed, baseSpeed });
    }
  }

  worst.sort((a, b) => b.viol - a.viol);
  return { units, pairs, speedViolations, unitsWithoutFacing: noFacing, worstRatio, worst };
}

module.exports = { audit, isGap, SPEED_TOL };
