const mappings = require("../helpers/mappings");
const Building = require("./Building");

const { getBuildTime } = mappings;

const SUPPLY_BUILDING_IDS = {
  'H': 'hhou',
  'O': 'otrb',
  'E': 'emow',
  'U': 'uzig'
};

// food provided by starting town hall (from UnitBalance)
const INITIAL_HALL_FOOD = {
  'H': 12,
  'O': 11,
  'E': 10,
  'U': 10
};

// food provided per supply building
const FOOD_PER_SUPPLY = {
  'H': 6,
  'O': 10,
  'E': 10,
  'U': 10
};

// UD ziggurats can be upgraded to towers — they were originally supply buildings
const UPGRADED_SUPPLY_VARIANTS = {
  'uzg1': 'uzig',  // Spirit Tower
  'uzg2': 'uzig'   // Nerubian Tower
};

class SupplyBuildingBackfill {
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

      if (parseInt(playerId) >= 24) {
        return;
      }

      const supplyBuildingId = SUPPLY_BUILDING_IDS[player.race];
      if (!supplyBuildingId) {
        return;
      }

      // count supply buildings in units list (including upgraded variants)
      const supplyBuildingsInUnits = player.units.filter(u =>
        u.isBuilding && (
          u.itemId === supplyBuildingId ||
          UPGRADED_SUPPLY_VARIANTS[u.itemId] === supplyBuildingId
        )
      );

      // count supply building events already in eventStream
      const supplyBuildingEvents = player.eventStream.filter(e =>
        e.key === 'addBuilding' && e.building && (
          e.building.itemId === supplyBuildingId ||
          UPGRADED_SUPPLY_VARIANTS[e.building.itemId] === supplyBuildingId
        )
      );

      // use building attempts as ground truth when available — includes cancelled/replaced
      // builds that the player commanded but our engine filtered out
      const attempts = (player._buildingAttempts || []).filter(a =>
        a.itemId === supplyBuildingId
      );
      const totalAttempted = attempts.length;
      const confirmedOrPending = attempts.filter(a => a.status !== 'replaced').length;

      // best estimate of how many supply buildings really existed:
      // max of units list count vs non-replaced attempt count
      const bestEstimate = Math.max(supplyBuildingsInUnits.length, confirmedOrPending);
      const missingCount = bestEstimate - supplyBuildingEvents.length;

      if (missingCount <= 0) {
        return;
      }

      console.logger(`SupplyBuildingBackfill: player ${playerId} — ${supplyBuildingEvents.length} events, ${supplyBuildingsInUnits.length} in units, ${totalAttempted} attempted (${confirmedOrPending} non-replaced) → ${missingCount} missing`);

      // find buildings in units that don't have a corresponding event
      const eventBuildingUuids = new Set();
      supplyBuildingEvents.forEach(e => {
        if (e.building && (e.building.objectId1 != null || e.building.itemId1 != null)) {
          // track by objectId pair or itemId pair for matching
          const key = e.building.objectId1 != null
            ? `obj:${e.building.objectId1}:${e.building.objectId2}`
            : `item:${e.building.itemId1}:${e.building.itemId2}`;
          eventBuildingUuids.add(key);
        }
      });

      // buildings without events
      const buildingsWithoutEvents = supplyBuildingsInUnits.filter(b => {
        if (b._buildEventEmitted) return false;
        const objKey = b.objectId1 != null ? `obj:${b.objectId1}:${b.objectId2}` : null;
        const itemKey = b.itemId1 != null ? `item:${b.itemId1}:${b.itemId2}` : null;
        return (!objKey || !eventBuildingUuids.has(objKey)) &&
               (!itemKey || !eventBuildingUuids.has(itemKey));
      });

      // infer timing for each missing building
      const buildTimeMs = (getBuildTime(supplyBuildingId) || 60) * 1000;
      const timings = this._inferTimings(player, buildingsWithoutEvents.length, buildTimeMs);

      buildingsWithoutEvents.forEach((building, i) => {
        const inferredTime = timings[i] || 0;

        building.isInferred = true;

        const nearestEvent = this._findNearestEvent(player.eventStream, inferredTime);
        const workers = nearestEvent ? { ...nearestEvent.workers } : {
          onGold: 0, onLumber: 0, onBuild: 0, totalWorkers: 0
        };

        const foodMade = (building.balanceInfo && building.balanceInfo.foodMade) || 0;

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

        const insertIdx = this._findInsertIndex(player.eventStream, inferredTime);
        player.eventStream.splice(insertIdx, 0, syntheticEvent);

        console.logger(`  inferred supply building: ${building.displayName} (${supplyBuildingId}) at gameTime=${inferredTime}`);

        this.results.push({
          player: playerId,
          buildingId: supplyBuildingId,
          displayName: building.displayName,
          gameTime: inferredTime
        });
      });
    });

    return this.results;
  }

  /**
   * Walk through events tracking cumulative food demand vs known supply.
   * When demand exceeds known supply, a supply building must have completed
   * by that point — infer its construction start at (eventTime - buildTime).
   */
  _inferTimings (player, missingCount, buildTimeMs) {
    const supplyBuildingId = SUPPLY_BUILDING_IDS[player.race];
    const foodPerSupply = FOOD_PER_SUPPLY[player.race];
    const initialFood = INITIAL_HALL_FOOD[player.race];

    // collect timestamps of known (non-inferred) food-providing buildings
    const knownFoodEvents = [];

    for (const event of player.eventStream) {
      if (event.key !== 'addBuilding' || !event.building || event.isInferred) continue;

      const bid = event.building.itemId;
      if (bid === supplyBuildingId || UPGRADED_SUPPLY_VARIANTS[bid] === supplyBuildingId) {
        knownFoodEvents.push({ gameTime: event.gameTime, food: foodPerSupply });
      } else if (event.building.foodMade > 0) {
        // expansion halls or other food providers
        knownFoodEvents.push({ gameTime: event.gameTime, food: event.building.foodMade });
      }
    }

    knownFoodEvents.sort((a, b) => a.gameTime - b.gameTime);

    let knownSupplyMax = initialFood;
    let knownIdx = 0;
    const timings = [];

    // starting food = first event's supplyUsed (accounts for starting workers)
    let foodCommitted = 0;
    if (player.eventStream.length > 0) {
      foodCommitted = player.eventStream[0].supplyUsed || 0;
    }

    for (const event of player.eventStream) {
      // advance known supply as we pass their timestamps
      while (knownIdx < knownFoodEvents.length &&
             knownFoodEvents[knownIdx].gameTime <= event.gameTime) {
        knownSupplyMax += knownFoodEvents[knownIdx].food;
        knownIdx++;
      }

      // accumulate food demand from unit additions
      if (event.key === 'addUnit' && event.unit) {
        foodCommitted += event.unit.foodUsed || 0;
      }

      // infer supply buildings when demand exceeds known supply
      while (foodCommitted > knownSupplyMax && timings.length < missingCount) {
        let inferredTime = Math.max(0, event.gameTime - buildTimeMs);
        const minTime = timings.length > 0 ? timings[timings.length - 1] + 1000 : 0;
        timings.push(Math.max(inferredTime, minTime));
        knownSupplyMax += foodPerSupply;
      }

      if (timings.length >= missingCount) break;
    }

    // the first supply building is always built alongside the first production buildings
    // (Altar+Farm, Barracks+Burrow, etc.) — cap its timing to the first building cluster
    if (timings.length > 0) {
      const firstBuilding = player.eventStream.find(e =>
        e.key === 'addBuilding' && !e.isInferred
      );
      if (firstBuilding && timings[0] > firstBuilding.gameTime) {
        timings[0] = firstBuilding.gameTime;
      }
    }

    // fallback: distribute remaining across game timeline
    while (timings.length < missingCount) {
      const lastEvent = player.eventStream[player.eventStream.length - 1];
      const gameLength = lastEvent ? lastEvent.gameTime : 0;
      const lastTiming = timings.length > 0 ? timings[timings.length - 1] : 0;
      const remaining = missingCount - timings.length;
      const interval = remaining > 0 ? (gameLength - lastTiming) / (remaining + 1) : 60000;
      timings.push(lastTiming + interval);
    }

    return timings;
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

module.exports = SupplyBuildingBackfill;
