/**
 * AnchorExtract — positional anchors from the replay's own click stream.
 *
 * When a player attack-clicks / right-clicks / casts on an ENEMY unit, the
 * action carries both the target's object id and the click coordinates. The
 * cursor was over the target's model, so the point is the target's true
 * position at that instant. The parser resolves the identity into a combat
 * signal (targetUnitUuid) but has never used the coordinate to place the
 * target. This module turns those signals into anchors:
 *
 *   { subjectUuid, gameTime, x, y, r, source }
 *
 * Reads player.combatSignals PRE-export-cap, so it sees orphan-cluster and
 * tail-pruned signals the offline audit (tools/anchor-audit.js) cannot.
 * Synthetic 'proximity' signals are path-derived and never anchors; they are
 * excluded by the kind whitelist (and don't exist yet at extraction time in
 * the wc3v.js pass order anyway).
 *
 * HOLDOUT SPLIT — the adoption-gate contract with tools/anchor-audit.js:
 * anchors hash by (subjectUuid, gameTime); the correction pass consumes only
 * EVEN-parity anchors, the audit's --holdout measures only ODD-parity ones.
 * Both sides MUST use the hash below (the audit requires it from here), so
 * the grade is never taken on anchors the fix consumed.
 *
 * Deterministic: signal order comes from CombatSignalTracker.finalize()'s
 * total-order sort; extraction sorts again on (gameTime, subject, x, y).
 */

const CLICK_KINDS = new Set(['attack-unit', 'right-click-enemy', 'spell-target-unit']);

// The click allowance: selection-circle slop + collisionSize. Measured by the
// audit's sensitivity set; 128 is the headline radius the gate ran at.
const ANCHOR_RADIUS = 128;

// FNV-1a + avalanche. FNV's raw low bit is a linear XOR of input low bits
// (the multiplier is odd) and splits far from 50/50 on short structured
// strings — the avalanche is REQUIRED, not decorative.
function anchorHash (subjectUuid, gameTime) {
  const str = `${subjectUuid}:${gameTime}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x9E3779B1) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

// Odd parity = held out (never consumed by correction; measured by the audit).
function isHoldoutKey (subjectUuid, gameTime) {
  return (anchorHash(subjectUuid, gameTime) & 1) === 1;
}

/**
 * Extract every click anchor from every player's combat signals.
 * Returns a flat array sorted by (gameTime, subjectUuid, x, y), deduped on
 * (subject, time, point). No parity filtering here — consumers decide.
 */
function extract (playerManager) {
  const anchors = [];
  const seen = new Set();

  for (const player of Object.values(playerManager.players || {})) {
    if (!player || !player.combatSignals) continue;
    const signals = player.combatSignals.finalize();
    for (const s of signals) {
      if (!CLICK_KINDS.has(s.kind)) continue;
      if (!s.targetUnitUuid) continue;
      if (s.targetX == null || s.targetY == null) continue;
      const key = `${s.targetUnitUuid}|${s.gameTime}|${s.targetX}|${s.targetY}`;
      if (seen.has(key)) continue;
      seen.add(key);
      anchors.push({
        subjectUuid: s.targetUnitUuid,
        gameTime: s.gameTime,
        x: s.targetX,
        y: s.targetY,
        r: ANCHOR_RADIUS,
        source: s.kind
      });
    }
  }

  anchors.sort((a, b) =>
    a.gameTime - b.gameTime ||
    (a.subjectUuid < b.subjectUuid ? -1 : a.subjectUuid > b.subjectUuid ? 1 : 0) ||
    a.x - b.x || a.y - b.y);
  return anchors;
}

module.exports = { extract, anchorHash, isHoldoutKey, CLICK_KINDS, ANCHOR_RADIUS };
