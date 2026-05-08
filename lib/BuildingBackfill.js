const mappings = require("../helpers/mappings");
const Building = require("./Building");

const { TECH_TREE_REQUIREMENTS, BUILDING_TIER_REQUIREMENTS, getUnitInfo } = mappings;

class BuildingBackfill {
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

      const raceReqs = TECH_TREE_REQUIREMENTS[player.race];
      if (!raceReqs) {
        return;
      }

      // collect building itemIds that have addBuilding events (not just in units list)
      const buildingIdsWithEvents = new Set();
      player.eventStream.forEach(e => {
        if (e.key === 'addBuilding' && e.building) {
          buildingIdsWithEvents.add(e.building.itemId);
        }
      });

      // scan units for missing prerequisite buildings
      const alreadyInferred = new Set();

      player.units.forEach(unit => {
        if (unit.isBuilding) return;

        const reqs = raceReqs[unit.itemId];
        if (!reqs) return;

        reqs.forEach(reqBuildingId => {
          if (buildingIdsWithEvents.has(reqBuildingId) || alreadyInferred.has(reqBuildingId)) {
            return;
          }

          // find earliest event referencing this unit type to determine timing
          const firstUnitEvent = player.eventStream.find(e =>
            (e.key === 'addUnit' || e.key === 'trainUnit') &&
            e.unit && e.unit.itemId === unit.itemId
          );

          // estimate when the building must have been placed:
          // it needs to be complete before the unit could start training
          // so: inferredTime = firstUnitTime - buildingBuildTime - unitTrainTime
          const buildingBuildTime = (mappings.getBuildTime(reqBuildingId) || 60) * 1000;
          const unitTrainTime = (mappings.getBuildTime(unit.itemId) || 30) * 1000;
          let inferredTime = firstUnitEvent
            ? Math.max(0, firstUnitEvent.gameTime - buildingBuildTime - unitTrainTime)
            : 0;

          // tier-aware floor: a building like Ancient of Wind (eaow) requires tier 2.
          // It can't have been started before the tier upgrade completed, so push the
          // inferred time forward to at least tierTime. Without this guard the backfill
          // would happily place an eaow at gameTime ~0 because the requiring unit
          // (e.g. Hippogryph) was never actually trained — and the build order panel
          // would then render a tier-2 building inside the tier-1 column.
          const tierReqs = BUILDING_TIER_REQUIREMENTS[player.race];
          const requiredTier = tierReqs && tierReqs[reqBuildingId];
          if (requiredTier && requiredTier > 1 && player.tierStream) {
            const tierEvent = player.tierStream.find(t => t.tier === requiredTier);
            if (tierEvent) {
              inferredTime = Math.max(inferredTime, tierEvent.gameTime);
            } else {
              // Tier upgrade itself wasn't detected — refuse to backfill rather than
              // emit a misleading early event. The validator will surface the gap.
              return;
            }
          }

          // use existing building from units list if present, otherwise create synthetic
          let building = player.units.find(u => u.isBuilding && u.itemId === reqBuildingId);
          if (!building) {
            building = new Building(player.eventTimer, null, null, reqBuildingId, false);
            player.units.push(building);
          }
          building.isInferred = true;

          // estimate position for buildings that have no coordinates
          if (building.currentX === 0 && building.currentY === 0) {
            player.estimateBuildingPosition(building);
          }
          buildingIdsWithEvents.add(reqBuildingId);
          alreadyInferred.add(reqBuildingId);

          // update supply if this is a food-providing building
          const foodMade = (building.balanceInfo && building.balanceInfo.foodMade) || 0;
          if (foodMade > 0) {
            player.supplyMax += foodMade;
          }

          // interpolate worker/supply data from nearest event
          const nearestEvent = this._findNearestEvent(player.eventStream, inferredTime);
          const workers = nearestEvent ? { ...nearestEvent.workers } : {
            onGold: 0, onLumber: 0, onBuild: 0, totalWorkers: 0
          };

          // build the event
          const buildingRef = building.exportUnitReference();
          buildingRef.isInferred = true;

          const syntheticEvent = {
            key: 'addBuilding',
            gameTime: inferredTime,
            supplyUsed: Math.min(nearestEvent ? nearestEvent.supplyUsed : 0, 100),
            supplyMax: Math.min((nearestEvent ? nearestEvent.supplyMax : 0) + foodMade, 100),
            workers,
            building: buildingRef,
            isExpansion: false,
            isInferred: true
          };

          // insert at correct chronological position
          const insertIdx = this._findInsertIndex(player.eventStream, inferredTime);
          player.eventStream.splice(insertIdx, 0, syntheticEvent);

          this.results.push({
            player: playerId,
            buildingId: reqBuildingId,
            displayName: building.displayName,
            gameTime: inferredTime
          });
        });
      });
    });

    return this.results;
  }

  _findNearestEvent (eventStream, gameTime) {
    let nearest = null;
    let minDist = Infinity;

    for (const event of eventStream) {
      const dist = Math.abs(event.gameTime - gameTime);
      if (dist < minDist) {
        minDist = dist;
        nearest = event;
      }
    }

    return nearest;
  }

  _findInsertIndex (eventStream, gameTime) {
    for (let i = 0; i < eventStream.length; i++) {
      if (eventStream[i].gameTime > gameTime) {
        return i;
      }
    }
    return eventStream.length;
  }
}

module.exports = BuildingBackfill;
