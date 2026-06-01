/**
 * CollisionResolver — per-frame visual collision pass.
 *
 * The parser snaps recorded position samples (every ~400ms + at A* nodes)
 * out of overlapping spots, but between samples the client interpolates
 * linearly. Two units interpolating along crossing paths CAN visually
 * overlap. This pass runs once per render frame, mutating each entry in
 * `unitDrawPositions` so no two unit circles overlap and no unit circle
 * intersects a building's drawn rectangle.
 *
 * Strict no-overlap guarantee:
 *   • Iterative relaxation with N passes (8 is enough for typical crowds).
 *   • Each pass: for every overlapping pair, push both halfway apart.
 *   • Buildings are treated as immovable axis-aligned rectangles.
 *   • Air units (flagged isAir) skip resolution entirely — they don't
 *     collide visually with ground units.
 *
 * Operates in CANVAS PIXELS (same coordinate space as drawX/drawY).
 * Mutates item.x and item.y in place; downstream draw code picks up the
 * resolved positions.
 */

(function () {
  const MAX_ITERATIONS = 8;
  const EPSILON = 0.5;        // sub-pixel slop — stop iterating when below
  const MIN_SEPARATION = 0;   // extra padding between unit circles (px)

  function resolveFrame (frameData) {
    const units = frameData.unitDrawPositions;
    const buildings = frameData.buildingPositions;
    if (!units || units.length < 1) return;

    // Per-unit collision radii — visualRadius is the VISIBLE outer disc
    // (halfIconSize + halo width), set in ClientUnit.renderUnit. Using bare
    // halfIconSize lets the player-colour halos overlap by ~12px at perfect
    // tangent. visualRadius makes the visible discs sit edge-to-edge.
    for (const u of units) {
      u._cr = (u.visualRadius || u.halfIconSize || 0);
      if (u._cr < 1) u._cr = 0;
    }

    // Pre-bucket: spatial hash for O(n) lookup.
    // Cell size = 2× the median radius. Cheap heuristic.
    let medR = 8;
    if (units.length > 4) {
      const sample = [];
      const step = Math.max(1, Math.floor(units.length / 32));
      for (let i = 0; i < units.length; i += step) sample.push(units[i]._cr);
      sample.sort((a, b) => a - b);
      medR = Math.max(8, sample[Math.floor(sample.length / 2)] || 8);
    }
    const cellSize = medR * 4;

    const keyOf = (x, y) => (Math.floor(x / cellSize) + ':' + Math.floor(y / cellSize));

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      let moved = 0;

      // (Re)build spatial hash each iteration — units have moved.
      const buckets = new Map();
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        if (u._cr === 0) continue;
        const k = keyOf(u.x, u.y);
        let arr = buckets.get(k);
        if (!arr) { arr = []; buckets.set(k, arr); }
        arr.push(i);
      }

      // Unit↔unit pass
      for (let i = 0; i < units.length; i++) {
        const a = units[i];
        if (a._cr === 0) continue;

        const cx = Math.floor(a.x / cellSize);
        const cy = Math.floor(a.y / cellSize);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const arr = buckets.get((cx + dx) + ':' + (cy + dy));
            if (!arr) continue;
            for (const j of arr) {
              if (j <= i) continue;  // each pair once
              const b = units[j];
              if (b._cr === 0) continue;
              const ex = b.x - a.x;
              const ey = b.y - a.y;
              const minDist = a._cr + b._cr + MIN_SEPARATION;
              const distSq = ex * ex + ey * ey;
              if (distSq >= minDist * minDist) continue;

              let dist = Math.sqrt(distSq);
              let nx, ny;
              if (dist < EPSILON) {
                // Co-incident — push along a deterministic axis to break the tie.
                const tieAngle = ((i * 13 + j * 7) % 360) * Math.PI / 180;
                nx = Math.cos(tieAngle);
                ny = Math.sin(tieAngle);
                dist = 0;
              } else {
                nx = ex / dist;
                ny = ey / dist;
              }
              const push = (minDist - dist) / 2;
              a.x -= nx * push;
              a.y -= ny * push;
              b.x += nx * push;
              b.y += ny * push;
              moved++;
            }
          }
        }
      }

      // Unit↔building pass: push units out of building rectangles by the
      // shortest axis. Buildings don't move.
      //
      // Inflation = (u._cr - INSIDE_TOLERANCE). The server's snap already
      // places units so their disc clears building cells; we only push here
      // when the unit's DISC actually overlaps the rect by more than a few
      // pixels of slop. Without this tolerance, an at-rest unit at the
      // server-snapped position oscillates every frame because the resolver
      // inflates by full radius while the server inflates by edge-sample.
      const INSIDE_TOLERANCE = 2;  // px — match server's snap step (~16 WU * 0.125 px/WU)
      if (buildings && buildings.length) {
        for (const u of units) {
          if (u._cr === 0) continue;
          const effR = Math.max(0, u._cr - INSIDE_TOLERANCE);
          for (const bld of buildings) {
            const halfW = bld.halfWidth != null ? bld.halfWidth : bld.halfSize;
            const halfH = bld.halfHeight != null ? bld.halfHeight : bld.halfSize;
            const minX = bld.x - halfW - effR;
            const maxX = bld.x + halfW + effR;
            const minY = bld.y - halfH - effR;
            const maxY = bld.y + halfH + effR;
            if (u.x <= minX || u.x >= maxX || u.y <= minY || u.y >= maxY) continue;

            // Inside the inflated rectangle — push out along whichever axis
            // requires the smaller displacement.
            const dxLeft  = u.x - minX;
            const dxRight = maxX - u.x;
            const dyTop   = u.y - minY;
            const dyBot   = maxY - u.y;
            const minD = Math.min(dxLeft, dxRight, dyTop, dyBot);
            if (minD === dxLeft)       u.x = minX;
            else if (minD === dxRight) u.x = maxX;
            else if (minD === dyTop)   u.y = minY;
            else                       u.y = maxY;
            moved++;
          }
        }
      }

      if (moved === 0) break;
    }
  }

  window.CollisionResolver = { resolveFrame };
})();
