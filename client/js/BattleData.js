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

    // Flatten participants[].unitUuids into a deduped uuid list per battle.
    // The server stripped this on export (only participants per player are
    // serialized), but the unit-spotlight wants a flat membership test —
    // computed once here, O(1) per-frame Set membership in app.js.
    for (const b of battles) {
      const seen = new Set();
      const flat = [];
      for (const p of (b.participants || [])) {
        for (const uuid of (p.unitUuids || [])) {
          if (seen.has(uuid)) continue;
          seen.add(uuid);
          flat.push(uuid);
        }
      }
      b._participantUuids = flat;
    }

    for (const b of battles) {
      b._tpIn  = 0;
      b._tpOut = 0;
      b._tpInUnits  = 0;
      b._tpOutUnits = 0;
      for (const tp of allTeleports) {
        if (tp.cancelled) continue;
        // Inference gate: skip teleports the parser flagged as low-
        // confidence phantoms. Anything below 'possible' (i.e. unlikely
        // / rejected) is excluded from battle TP-in/TP-out counts so a
        // phantom doesn't appear as a real banner chip.
        if (tp.inferenceConfidence === 'rejected' ||
            tp.inferenceConfidence === 'unlikely') continue;
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

    // Phase 6 — battle-scoped item activity. Flatten purchases / uses /
    // sells across all non-neutral players, then per battle count those
    // whose buyer hero participated AND whose gameTime falls within the
    // battle window. The banner shows compact chips ('🛒 N', '💊 N',
    // '💰 N') in the same column as the existing TP chips so a glance
    // tells you "Grubby Healing-Salve'd x3 during this Lvl-3 hippo fight".
    const allItemPurchases = [];
    const allItemUses = [];
    const allItemSells = [];
    if (mapData && mapData.players) {
      for (const [pid, p] of Object.entries(mapData.players)) {
        if (p.isNeutralPlayer) continue;
        for (const ev of (p.eventStream || [])) {
          if (ev.key === 'itemPurchase' && ev.item && ev.item.itemId !== 'Jwid') {
            allItemPurchases.push({ ...ev, _playerId: pid });
          } else if (ev.key === 'itemUse' && ev.item && ev.item.itemId
                     && ev.source !== 'use-no-slot') {
            allItemUses.push({ ...ev, _playerId: pid });
          } else if (ev.key === 'sellItem' && ev.item) {
            allItemSells.push({ ...ev, _playerId: pid });
          }
        }
      }
    }

    // Pre-build a participant uuid lookup per battle (cheap O(1) check).
    for (const b of battles) {
      b._itemsBoughtDuring = 0;
      b._itemsUsedDuring = 0;
      b._itemsSoldDuring = 0;
      const partSet = new Set(b._participantUuids || []);
      const heroFor = (ev) => ev.unit && (ev.unit.uuid || ev.unit.itemId);
      const inWindow = (t) => t >= b.startTime - 1000 && t <= b.endTime + 1000;

      for (const ev of allItemPurchases) {
        if (!inWindow(ev.gameTime)) continue;
        const h = heroFor(ev);
        if (!h || !partSet.has(h)) continue;
        b._itemsBoughtDuring += 1;
      }
      for (const ev of allItemUses) {
        if (!inWindow(ev.gameTime)) continue;
        const h = heroFor(ev);
        if (!h || !partSet.has(h)) continue;
        b._itemsUsedDuring += 1;
      }
      for (const ev of allItemSells) {
        if (!inWindow(ev.gameTime)) continue;
        const h = heroFor(ev);
        if (!h || !partSet.has(h)) continue;
        b._itemsSoldDuring += 1;
      }
    }

    // Window during which a battle is considered "active" for overlay purposes.
    // Slight pre-roll opens the window just before the first signal; the
    // post-roll lets it linger briefly so a battle doesn't snap out of
    // existence at endTime. Read by the scrubber chevrons and the camera.
    const PREROLL_MS  = 500;
    const POSTROLL_MS = 4000;

    // Memoized on gameTime: called several times per frame (the viewer's
    // active-participant refresh, BroadcastCamera._activeBattleBbox), and each
    // call scanned from index 0 and allocated a fresh array. Same gameTime in
    // the same frame now costs one Map-free comparison.
    let _aaTime = NaN;
    let _aaOut = [];
    const activeAt = (gameTime) => {
      if (gameTime === _aaTime) return _aaOut;
      const out = [];
      for (const b of battles) {
        if (b.startTime - PREROLL_MS > gameTime) break;       // sorted by startTime
        if (b.endTime + POSTROLL_MS < gameTime) continue;     // ended too long ago
        out.push(b);
      }
      _aaTime = gameTime;
      _aaOut = out;
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
