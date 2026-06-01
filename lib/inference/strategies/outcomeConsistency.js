/*
 * outcomeConsistency — for a teleport claim with grabbedUnitUuids, check
 * whether those units' post-apply movement actually starts from the
 * destination. If grabbed units kept walking from the origin in the
 * seconds after apply, the TP either didn't fire or didn't grab them.
 *
 * Conservative: needs explicit path-data presence on the grabbed unit
 * with a sample shortly after apply. If no path data, emits nothing.
 */

const POST_APPLY_SAMPLE_MS = 4000;
const DEST_RADIUS          = 1200;

module.exports = {
  name:     'outcomeConsistency',
  subjects: ['teleport'],
  phase:    'look-ahead',

  score (claim, ctx) {
    const payload = claim.payload || {};
    const cast = payload.gameTime;
    const dest = payload.destination;
    const channelMs = payload.channelMs || 0;
    const grabbedUuids = payload.grabbedUnitUuids || [];
    if (cast == null || !dest || !grabbedUuids.length) return null;

    const player = ctx.player;
    if (!player || !player.units) return null;

    const applyTime = cast + channelMs;
    const sampleEnd = applyTime + POST_APPLY_SAMPLE_MS;

    let support = 0;
    let refute  = 0;
    const refDetails = [];

    for (const uuid of grabbedUuids) {
      const u = player.units.find(x => x.uuid === uuid);
      if (!u || !Array.isArray(u.path)) continue;
      // Find first path sample strictly after apply.
      let sample = null;
      for (const p of u.path) {
        if (p.gameTime == null) continue;
        if (p.gameTime < applyTime) continue;
        if (p.gameTime > sampleEnd) break;
        sample = p;
        break;
      }
      if (!sample) continue;
      const d = Math.hypot((sample.x || 0) - dest.x, (sample.y || 0) - dest.y);
      if (d <= DEST_RADIUS) {
        support++;
        refDetails.push({ uuid, verdict: 'at-destination', d });
      } else {
        refute++;
        refDetails.push({ uuid, verdict: 'not-at-destination', d });
      }
    }

    if (!support && !refute) return null;
    // Need >= 2 grabbed-unit samples to score — single-sample verdicts
    // are too noisy (a unit that moved out of DEST_RADIUS in the first
    // 4s window can refute a real TP).
    const sample = support + refute;
    if (sample < 2) return null;
    const net = support - refute;
    // Path data is corrupted by the parse-time _applyTeleport (Phase A
    // limitation — Phase B will defer). That makes this strategy
    // circular: it tends to confirm what we already applied. Cap weight
    // to ±0.1 so it can nudge but never decide. Will be re-enabled at
    // full strength after Phase B.
    const weight = (net / sample) * 0.1;
    return {
      kind: weight >= 0 ? 'observation' : 'contradiction',
      weight,
      ref: { gameTime: applyTime },
      detail: { rule: 'outcomeConsistency', support, refute, details: refDetails }
    };
  }
};
