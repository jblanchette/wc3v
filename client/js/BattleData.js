/*
 * BattleData — pure pipeline for the `battles` array shipped in .wc3v.
 *
 * Mirrors BuildOrderData's data/renderer split (zero DOM, zero canvas).
 * Sorts battles, indexes them by id, exposes activeAt(gameTime) for the
 * renderer/info-panel, and provides trackerBoxAt(battle, gameTime) which
 * linearly interpolates between the time-varying bbox samples produced by
 * the parser's BattleDetector.
 */
const BattleData = class {
  constructor () {}

  // Build the processed object once after .wc3v loads. Subsequent reads
  // (activeAt, trackerBoxAt) are O(log n) per call.
  processBattles (mapData) {
    const raw = (mapData && Array.isArray(mapData.battles)) ? mapData.battles : [];
    const battles = raw.slice().sort((a, b) => a.startTime - b.startTime);
    const byId = Object.create(null);
    for (const b of battles) byId[b.id] = b;

    // Pre-compute TP-in / TP-out counts for each battle. A TP is:
    //   TP-IN  if its destination lands inside the battle's outerBbox AND its
    //          arrival falls within [startTime, endTime + 4000].
    //   TP-OUT if its origin sits inside the outerBbox AND its cast falls
    //          within [startTime - 1000, endTime].
    // The banner renders compact chips: ⚡→N (in) and ⚡←N (out).
    const allTeleports = [];
    if (mapData && mapData.players) {
      for (const [pid, p] of Object.entries(mapData.players)) {
        if (p.isNeutralPlayer) continue;
        for (const tp of (p.teleportEvents || [])) {
          allTeleports.push({ ...tp, _playerId: pid });
        }
      }
    }
    const inBox = (x, y, b) => b && b.outerBbox &&
      x >= b.outerBbox.minX && x <= b.outerBbox.maxX &&
      y >= b.outerBbox.minY && y <= b.outerBbox.maxY;
    for (const b of battles) {
      b._tpIn  = 0;
      b._tpOut = 0;
      b._tpInUnits  = 0;
      b._tpOutUnits = 0;
      for (const tp of allTeleports) {
        if (tp.cancelled) continue;
        const applyT = tp.appliedAt != null ? tp.appliedAt : (tp.gameTime + tp.channelMs);
        // TP-IN
        if (tp.destination &&
            inBox(tp.destination.x, tp.destination.y, b) &&
            applyT >= b.startTime - 500 && applyT <= b.endTime + 4000) {
          b._tpIn += 1;
          b._tpInUnits += (tp.grabbedCount || 0) + 1;
        }
        // TP-OUT
        if (tp.origin &&
            inBox(tp.origin.x, tp.origin.y, b) &&
            tp.gameTime >= b.startTime - 1000 && tp.gameTime <= b.endTime) {
          b._tpOut += 1;
          b._tpOutUnits += (tp.grabbedCount || 0) + 1;
        }
      }
    }

    // Window during which a battle is considered "active" for overlay purposes.
    // Slight pre-roll fades the box in just before the first signal; the post-
    // roll lets the box linger briefly so a snap-disappear at endTime doesn't
    // look abrupt. Matches BattleRenderer's envelope.
    const PREROLL_MS  = 500;
    const POSTROLL_MS = 4000;

    const activeAt = (gameTime) => {
      const out = [];
      for (const b of battles) {
        if (b.startTime - PREROLL_MS > gameTime) break;       // sorted by startTime
        if (b.endTime + POSTROLL_MS < gameTime) continue;     // ended too long ago
        out.push(b);
      }
      return out;
    };

    const trackerBoxAt = (battle, gameTime) => {
      // BattleDetector emits a deduped tracker-box list; if collapse removed
      // intermediate samples that match a prior sample exactly, lerp is still
      // safe because the box is constant in those segments.
      if (!battle) return null;
      const samples = battle.trackerBox;
      if (!samples || !samples.length) return null;

      // Clamp before-first / after-last to the endpoint box (avoids null gap).
      const first = samples[0];
      const last  = samples[samples.length - 1];
      if (gameTime <= first.gameTime) return { minX:first.minX, minY:first.minY, maxX:first.maxX, maxY:first.maxY };
      if (gameTime >= last.gameTime)  return { minX:last.minX,  minY:last.minY,  maxX:last.maxX,  maxY:last.maxY  };

      // Binary search for the first sample with gameTime >= queried gameTime.
      let lo = 0, hi = samples.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (samples[mid].gameTime < gameTime) lo = mid + 1;
        else hi = mid;
      }
      const after  = samples[lo];
      const before = lo > 0 ? samples[lo - 1] : after;
      const span   = after.gameTime - before.gameTime;
      if (span <= 0) return { minX:after.minX, minY:after.minY, maxX:after.maxX, maxY:after.maxY };
      const t = (gameTime - before.gameTime) / span;
      return {
        minX: before.minX + (after.minX - before.minX) * t,
        minY: before.minY + (after.minY - before.minY) * t,
        maxX: before.maxX + (after.maxX - before.maxX) * t,
        maxY: before.maxY + (after.maxY - before.maxY) * t
      };
    };

    return {
      battles,
      byId,
      activeAt,
      trackerBoxAt,
      PREROLL_MS,
      POSTROLL_MS
    };
  }
};

window.BattleData = BattleData;
