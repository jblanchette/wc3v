// Threshold for "near origin" — real gameplay positions are in the thousands,
// so anything within this radius of (0,0) is a default/unset position.
const NEAR_ZERO_THRESHOLD = 500;

function isNearZero (x, y) {
  return Math.abs(x) < NEAR_ZERO_THRESHOLD && Math.abs(y) < NEAR_ZERO_THRESHOLD;
}

class UnitPositionBackfill {
  constructor (players) {
    this.players = players;
    this.results = [];
  }

  run () {
    Object.keys(this.players).forEach(playerId => {
      const player = this.players[playerId];

      if (!player || !player.units || !player.units.length) {
        return;
      }

      // skip neutral/observer players
      if (parseInt(playerId) >= 24) {
        return;
      }

      const allUnits = player.units.concat(player.destroyedSummons || []);

      allUnits.forEach(unit => {
        // buildings are handled by estimateBuildingPosition
        if (unit.isBuilding) return;
        if (!this._needsBackfill(unit)) return;

        const pos = this._inferPosition(player, unit);
        if (pos) {
          // set spawnPosition
          unit.spawnPosition = { x: pos.x, y: pos.y };

          // if the unit is still near origin, move it to the inferred position
          if (isNearZero(unit.currentX, unit.currentY)) {
            unit.currentX = pos.x;
            unit.currentY = pos.y;
          }

          // fix path: strip all leading near-zero entries (movement from 0,0)
          // and replace with a single jump to the real spawn position
          if (unit.path && unit.path.length > 0) {
            const first = unit.path[0];
            if (isNearZero(first.x, first.y)) {
              // find the first path entry that's far enough from origin to be real
              const realIdx = unit.path.findIndex(p => !isNearZero(p.x, p.y));

              if (realIdx > 0) {
                // replace all near-zero entries with a jump to the real position
                const realEntry = unit.path[realIdx];
                unit.path.splice(0, realIdx, {
                  x: pos.x,
                  y: pos.y,
                  gameTime: first.gameTime,
                  isJump: true
                });
              } else if (realIdx === -1) {
                // entire path is near-zero — replace with single spawn entry
                unit.path = [{
                  x: pos.x,
                  y: pos.y,
                  gameTime: first.gameTime,
                  isJump: true
                }];
              } else {
                // first entry is already valid but was caught by spawnPosition check
                unit.path.unshift({
                  x: pos.x,
                  y: pos.y,
                  gameTime: first.gameTime,
                  isJump: true
                });
              }
            }
          }

          this.results.push({
            player: playerId,
            displayName: unit.displayName,
            itemId: unit.itemId,
            source: pos.source
          });
        }
      });
    });

    return this.results;
  }

  _needsBackfill (unit) {
    // no spawn position recorded — definitely needs backfill
    if (!unit.spawnPosition) return true;

    // spawn position is near origin — likely default/unset
    if (isNearZero(unit.spawnPosition.x, unit.spawnPosition.y)) return true;

    return false;
  }

  _inferPosition (player, unit) {
    // Priority 1: player starting position (most reliable general-purpose fallback)
    if (player.startingPosition) {
      return {
        x: player.startingPosition.x,
        y: player.startingPosition.y,
        source: 'startingPosition'
      };
    }

    // Priority 2: any allied unit/building with a valid position
    const validAlly = player.units.find(u =>
      u !== unit && !isNearZero(u.currentX, u.currentY)
    );
    if (validAlly) {
      return { x: validAlly.currentX, y: validAlly.currentY, source: 'alliedUnit' };
    }

    return null;
  }
}

module.exports = UnitPositionBackfill;
