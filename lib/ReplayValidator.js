const mappings = require("../helpers/mappings");

const { tierBuildings, buildingUpgrades } = mappings;

// Known units that require specific tech tiers to produce
// These are units that CANNOT exist without the player having upgraded
const TIER_REQUIRED_UNITS = {
  'E': {
    2: ['edry', 'edoc', 'emtg', 'edot', 'ehip'],  // Dryad, DotC, MG, DotT, Hippogryph
    3: ['echm']                                       // Chimaera
  },
  'U': {
    2: ['unec', 'uban', 'uabo', 'uobs'],             // Necro, Banshee, Abomination, Obsidian Statue
    3: ['ufro', 'ubsp']                               // Frost Wyrm, Destroyer
  },
  'O': {
    2: ['oshm', 'odoc', 'orai'],                      // Shaman, Witch Doctor, Raider
    3: ['otau', 'owyv']                               // Tauren, Wind Rider
  },
  'H': {
    2: ['hmpr', 'hsor', 'hgyr'],                      // Priest, Sorceress, Mortar Team
    3: ['hkni', 'hgry', 'hspt']                       // Knight, Gryphon Rider, Spell Breaker
  }
};

class ReplayValidator {
  constructor (players) {
    this.players = players;
    this.warnings = [];
    this.errors = [];
    this.corrections = [];
  }

  validate () {
    Object.keys(this.players).forEach(playerId => {
      const player = this.players[playerId];

      if (!player || !player.units || !player.units.length) {
        return;
      }

      // skip neutral/observer players (IDs 24+)
      if (parseInt(playerId) >= 24) {
        return;
      }

      this._checkTierVsBuildings(player, playerId);
      this._checkTierVsUnits(player, playerId);
      this._checkWorkerSanity(player, playerId);
    });

    return {
      warnings: this.warnings,
      errors: this.errors,
      corrections: this.corrections
    };
  }

  /**
   * Check if player has tier buildings but no corresponding tier events.
   * Most reliable check — if a building's itemId is a tier building,
   * the player MUST have reached that tier.
   */
  _checkTierVsBuildings (player, playerId) {
    const buildTiers = tierBuildings[player.race];
    if (!buildTiers) return;

    const maxTier = player.tier || (player.tierStream && player.tierStream.length
      ? Math.max(...player.tierStream.map(t => t.tier))
      : 1);

    // Check all units (buildings are tracked as units with isBuilding)
    player.units.forEach(unit => {
      const tierPos = buildTiers.indexOf(unit.itemId);
      if (tierPos > -1) {
        const impliedTier = tierPos + 2;
        if (maxTier < impliedTier) {
          this.warnings.push({
            type: 'TIER_BUILDING_MISMATCH',
            player: playerId,
            severity: 'high',
            details: `Player has ${unit.displayName || unit.itemId} (tier ${impliedTier} building) but max detected tier is ${maxTier}`
          });
        }
      }

      // Also check via buildingUpgrades — if itemId is the "after" of an upgrade
      const upgradeEntries = Object.entries(buildingUpgrades);
      for (const [fromId, toId] of upgradeEntries) {
        if (unit.itemId === toId) {
          const tierPos2 = buildTiers.indexOf(toId);
          if (tierPos2 > -1) {
            const impliedTier2 = tierPos2 + 2;
            if (maxTier < impliedTier2) {
              this.warnings.push({
                type: 'TIER_UPGRADE_MISMATCH',
                player: playerId,
                severity: 'high',
                details: `Building upgraded from ${fromId} to ${toId} (tier ${impliedTier2}) but max detected tier is ${maxTier}`
              });
            }
          }
        }
      }
    });
  }

  /**
   * Check if player has units that require a higher tier than detected.
   * Secondary check — uses known unit-tier mappings.
   */
  _checkTierVsUnits (player, playerId) {
    const raceTiers = TIER_REQUIRED_UNITS[player.race];
    if (!raceTiers) return;

    const maxTier = player.tier || (player.tierStream && player.tierStream.length
      ? Math.max(...player.tierStream.map(t => t.tier))
      : 1);

    const playerItemIds = new Set(player.units.map(u => u.itemId));

    for (const [requiredTier, unitIds] of Object.entries(raceTiers)) {
      const tier = parseInt(requiredTier);
      if (maxTier >= tier) continue;

      for (const unitId of unitIds) {
        if (playerItemIds.has(unitId)) {
          const unitInfo = mappings.getUnitInfo(unitId);
          this.warnings.push({
            type: 'TIER_UNIT_MISMATCH',
            player: playerId,
            severity: 'medium',
            details: `Player has ${unitInfo.displayName || unitId} (requires tier ${tier}) but max detected tier is ${maxTier}`
          });
        }
      }
    }
  }

  /**
   * Check worker sanity — if player has units/buildings but no workers tracked.
   */
  _checkWorkerSanity (player, playerId) {
    if (!player.eventStream || !player.eventStream.length) return;

    // Check if any event has worker data
    const hasWorkerData = player.eventStream.some(e =>
      e.workers && (e.workers.totalWorkers > 0 || e.workers.onGold > 0)
    );

    if (!hasWorkerData && player.units.length > 3) {
      this.warnings.push({
        type: 'MISSING_WORKER_DATA',
        player: playerId,
        severity: 'low',
        details: `Player has ${player.units.length} units but no worker tracking data in eventStream`
      });
    }
  }

  /**
   * Attempt to correct tier mismatches by inferring tier events
   * from building evidence.
   */
  correctTierMismatches (player, playerId) {
    const buildTiers = tierBuildings[player.race];
    if (!buildTiers) return;

    const maxTier = player.tier || 1;

    for (let i = 0; i < buildTiers.length; i++) {
      const tierBuildingId = buildTiers[i];
      const impliedTier = i + 2;

      if (maxTier >= impliedTier) continue;

      // Find the building in the player's units
      const tierUnit = player.units.find(u => u.itemId === tierBuildingId);
      if (!tierUnit) continue;

      // Estimate the game time from the first selection of this building
      // or fallback to a reasonable estimate
      let estimatedTime = null;

      if (player.selectionStream) {
        const selectionWithBuilding = player.selectionStream.find(s =>
          s.units && s.units.some(su =>
            su.itemId === tierBuildingId ||
            (su.itemId1 && mappings.getUnitInfo(
              String.fromCharCode(su.itemId1 >> 16 & 0xFF, su.itemId1 >> 8 & 0xFF, su.itemId1 & 0xFF)
            ))
          )
        );
        if (selectionWithBuilding) {
          estimatedTime = selectionWithBuilding.gameTime;
        }
      }

      if (!estimatedTime && player.eventStream) {
        // Use midpoint of game as rough estimate
        const lastEvent = player.eventStream[player.eventStream.length - 1];
        estimatedTime = lastEvent ? Math.floor(lastEvent.gameTime / 2) : 300000;
      }

      if (estimatedTime) {
        player.tierStream.push({
          gameTime: estimatedTime,
          tier: impliedTier
        });
        player.tier = impliedTier;

        this.corrections.push({
          type: 'TIER_CORRECTED',
          player: playerId,
          details: `Inserted tier ${impliedTier} event at ~${Math.floor(estimatedTime / 60000)}:${String(Math.floor((estimatedTime % 60000) / 1000)).padStart(2, '0')} based on ${tierBuildingId} building evidence`
        });
      }
    }

    // Sort tierStream by gameTime after corrections
    if (player.tierStream) {
      player.tierStream.sort((a, b) => a.gameTime - b.gameTime);
    }
  }
}

module.exports = ReplayValidator;
