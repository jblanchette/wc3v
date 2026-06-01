const mappings = require("../helpers/mappings");

const {
  tierBuildings,
  buildingUpgrades,
  BUILDING_TIER_REQUIREMENTS
} = mappings;

// Known units that require specific tech tiers to produce.
// These are units that CANNOT exist without the player having upgraded.
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

const SUPPLY_BUILDING_IDS = {
  'H': 'hhou',
  'O': 'otrb',
  'E': 'emow',
  'U': 'uzig'
};

const UPGRADED_SUPPLY_VARIANTS = {
  'uzg1': 'uzig',
  'uzg2': 'uzig'
};

// Severity → confidence-score deduction. Critical issues alone
// can drop a player below the verbose-warning threshold (0.85)
// configured in reparse-builds.js.
const SEVERITY_DEDUCTION = {
  critical: 0.20,
  major:    0.05,
  minor:    0.01,
  info:     0.002
};

// One issue can have multiple instances on the same player; cap the per-issue
// deduction so e.g. ten near-duplicate buildings don't single-handedly tank
// the score. The total per-player deduction is also clamped to [0,1].
const PER_ISSUE_CAP = {
  critical: 0.40,
  major:    0.20,
  minor:    0.05,
  info:     0.01
};

// Two addBuilding events for the same itemId within this window with no
// distinguishing object/position info are flagged as a duplicate.
const NEAR_DUP_BUILDING_WINDOW_MS = 2000;

class ReplayValidator {
  constructor (players) {
    this.players = players;
    this.warnings = [];
    this.errors = [];
    this.corrections = [];
    // per-player issue tally → confidence score
    this._playerIssues = {};
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

      this._playerIssues[playerId] = { critical: 0, major: 0, minor: 0, info: 0 };

      this._checkTierVsBuildings(player, playerId);
      this._checkBuildingTierRequirements(player, playerId);
      this._checkTierVsUnits(player, playerId);
      this._checkDuplicateBuildings(player, playerId);
      this._checkWorkerSanity(player, playerId);
      this._checkSupplyBuildings(player, playerId);
      this._checkItemConsistency(player, playerId);
      this._checkInferenceClaims(player, playerId);
    });

    // attach validation confidence onto each player so it propagates into
    // the .wc3v output (alongside the existing parseConfidence).
    Object.keys(this._playerIssues).forEach(pid => {
      const player = this.players[pid];
      if (!player) return;
      player.validationConfidence = this._computeConfidence(this._playerIssues[pid]);
      player.validationIssues = this._playerIssues[pid];
    });

    return {
      warnings: this.warnings,
      errors: this.errors,
      corrections: this.corrections,
      playerIssues: this._playerIssues,
      playerConfidence: Object.keys(this._playerIssues).reduce((acc, pid) => {
        acc[pid] = this._computeConfidence(this._playerIssues[pid]);
        return acc;
      }, {})
    };
  }

  _record (entry) {
    const severity = entry.severity || 'minor';
    this.warnings.push(entry);
    if (entry.player != null && this._playerIssues[entry.player]) {
      this._playerIssues[entry.player][severity] =
        (this._playerIssues[entry.player][severity] || 0) + 1;
    }
  }

  _computeConfidence (issues) {
    let deduction = 0;
    Object.keys(SEVERITY_DEDUCTION).forEach(sev => {
      const count = issues[sev] || 0;
      const raw = count * SEVERITY_DEDUCTION[sev];
      const capped = Math.min(raw, PER_ISSUE_CAP[sev]);
      deduction += capped;
    });
    return Math.max(0, Math.min(1, 1 - deduction));
  }

  _maxDetectedTier (player) {
    if (player.tier && player.tier > 1) return player.tier;
    if (player.tierStream && player.tierStream.length) {
      return Math.max(...player.tierStream.map(t => t.tier));
    }
    return 1;
  }

  /**
   * Check if player has tier buildings but no corresponding tier events.
   * Most reliable check — if a building's itemId is a tier building,
   * the player MUST have reached that tier.
   */
  _checkTierVsBuildings (player, playerId) {
    const buildTiers = tierBuildings[player.race];
    if (!buildTiers) return;

    const maxTier = this._maxDetectedTier(player);

    // Check all units (buildings are tracked as units with isBuilding)
    player.units.forEach(unit => {
      const tierPos = buildTiers.indexOf(unit.itemId);
      if (tierPos > -1) {
        const impliedTier = tierPos + 2;
        if (maxTier < impliedTier) {
          this._record({
            type: 'TIER_BUILDING_MISMATCH',
            player: playerId,
            severity: 'major',
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
              this._record({
                type: 'TIER_UPGRADE_MISMATCH',
                player: playerId,
                severity: 'major',
                details: `Building upgraded from ${fromId} to ${toId} (tier ${impliedTier2}) but max detected tier is ${maxTier}`
              });
            }
          }
        }
      }
    });
  }

  /**
   * Check that production buildings with tier prerequisites (Ancient of Wind,
   * Workshop, Slaughterhouse, etc.) appear in the eventStream *after* the
   * tier upgrade that unlocks them. This is the test that catches the
   * "Ancient of Wind in tier 1" bug — even if the player has the building,
   * if its addBuilding event predates the tier upgrade the build order panel
   * will render it in the wrong column.
   */
  _checkBuildingTierRequirements (player, playerId) {
    const tierReqs = BUILDING_TIER_REQUIREMENTS[player.race];
    if (!tierReqs) return;
    if (!player.eventStream) return;

    // Build a quick lookup: tier → earliest gameTime for that tier upgrade.
    const tierTimes = { 1: 0 };
    (player.tierStream || []).forEach(t => {
      if (tierTimes[t.tier] == null || t.gameTime < tierTimes[t.tier]) {
        tierTimes[t.tier] = t.gameTime;
      }
    });

    player.eventStream.forEach(event => {
      if (event.key !== 'addBuilding' || !event.building) return;
      const itemId = event.building.itemId;
      const requiredTier = tierReqs[itemId];
      if (!requiredTier || requiredTier === 1) return;

      const tierTime = tierTimes[requiredTier];

      if (tierTime == null) {
        // Building requires a tier the player never reached — strong contradiction.
        // Critical because a tier-2 production building literally cannot exist
        // without the player having upgraded; the panel will render it in T1
        // and mislead viewers about the build order.
        this._record({
          type: 'BUILDING_BEFORE_TIER',
          player: playerId,
          severity: 'critical',
          details: `${event.building.displayName || itemId} (requires tier ${requiredTier}) at ${this._formatTime(event.gameTime)} but no tier ${requiredTier} event detected${event.isInferred ? ' [INFERRED — backfill bug]' : ''}`
        });
        return;
      }

      if (event.gameTime < tierTime) {
        this._record({
          type: 'BUILDING_BEFORE_TIER',
          player: playerId,
          severity: 'critical',
          details: `${event.building.displayName || itemId} appears at ${this._formatTime(event.gameTime)} but tier ${requiredTier} was reached at ${this._formatTime(tierTime)}${event.isInferred ? ' [INFERRED — backfill bug]' : ''}`
        });
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

    const maxTier = this._maxDetectedTier(player);

    const playerItemIds = new Set(player.units.map(u => u.itemId));

    for (const [requiredTier, unitIds] of Object.entries(raceTiers)) {
      const tier = parseInt(requiredTier);
      if (maxTier >= tier) continue;

      for (const unitId of unitIds) {
        if (playerItemIds.has(unitId)) {
          const unitInfo = mappings.getUnitInfo(unitId);
          this._record({
            type: 'TIER_UNIT_MISMATCH',
            player: playerId,
            severity: 'minor',
            details: `Player has ${unitInfo.displayName || unitId} (requires tier ${tier}) but max detected tier is ${maxTier}`
          });
        }
      }
    }
  }

  /**
   * Detect duplicate addBuilding events for the same building instance.
   * The post-parse dedup pass on Player handles the obvious cases, but if
   * any get through (e.g. across very short windows or with subtly different
   * fields) we want to call them out — three "Altar of Elders" events at
   * 0:03 is a parse glitch, not a real build.
   */
  _checkDuplicateBuildings (player, playerId) {
    if (!player.eventStream) return;

    const buildingEvents = player.eventStream
      .map((e, idx) => ({ e, idx }))
      .filter(({ e }) => e.key === 'addBuilding' && e.building);

    let duplicateCount = 0;

    for (let i = 0; i < buildingEvents.length; i++) {
      const a = buildingEvents[i].e;
      for (let j = i + 1; j < buildingEvents.length; j++) {
        const b = buildingEvents[j].e;
        if (a.building.itemId !== b.building.itemId) continue;
        if (Math.abs(b.gameTime - a.gameTime) > NEAR_DUP_BUILDING_WINDOW_MS) continue;

        const aHasObj = a.building.objectId1 != null;
        const bHasObj = b.building.objectId1 != null;
        const sameObj = aHasObj && bHasObj &&
          a.building.objectId1 === b.building.objectId1 &&
          a.building.objectId2 === b.building.objectId2;
        const distinctObj = aHasObj && bHasObj && !sameObj;
        if (distinctObj) continue;

        const aHasPos = a.building.currentX != null && a.building.currentX !== 0;
        const bHasPos = b.building.currentX != null && b.building.currentX !== 0;
        const samePos = aHasPos && bHasPos &&
          a.building.currentX === b.building.currentX &&
          a.building.currentY === b.building.currentY;
        const distinctPos = aHasPos && bHasPos && !samePos;
        if (distinctPos) continue;

        duplicateCount++;
        this._record({
          type: 'DUPLICATE_BUILDING',
          player: playerId,
          severity: 'major',
          details: `Duplicate ${a.building.displayName || a.building.itemId} events at ${this._formatTime(a.gameTime)} and ${this._formatTime(b.gameTime)} (Δ=${b.gameTime - a.gameTime}ms)`
        });
      }
    }

    if (duplicateCount > 0) {
      // Note: the warnings already have detail; this is a tally for tooling.
      this.corrections.push({
        type: 'DUPLICATE_BUILDING_TALLY',
        player: playerId,
        details: `${duplicateCount} duplicate addBuilding pair(s) detected — investigate dedup pass`
      });
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
      this._record({
        type: 'MISSING_WORKER_DATA',
        player: playerId,
        severity: 'minor',
        details: `Player has ${player.units.length} units but no worker tracking data in eventStream`
      });
    }
  }

  _checkSupplyBuildings (player, playerId) {
    const supplyBuildingId = SUPPLY_BUILDING_IDS[player.race];
    if (!supplyBuildingId) return;

    const supplyBuildingsInUnits = player.units.filter(u =>
      u.isBuilding && (
        u.itemId === supplyBuildingId ||
        UPGRADED_SUPPLY_VARIANTS[u.itemId] === supplyBuildingId
      )
    ).length;

    const supplyBuildingEvents = player.eventStream.filter(e =>
      e.key === 'addBuilding' && e.building && (
        e.building.itemId === supplyBuildingId ||
        UPGRADED_SUPPLY_VARIANTS[e.building.itemId] === supplyBuildingId
      )
    ).length;

    // After SupplyBuildingBackfill runs, units count and event count should
    // match. If they don't, the backfill couldn't reconcile — that's worth
    // flagging because it means the player's supply timeline is incomplete.
    // Successful backfills (events created, supply bumps applied and resolved)
    // intentionally produce no warning here.
    if (supplyBuildingsInUnits > supplyBuildingEvents) {
      this._record({
        type: 'MISSING_SUPPLY_BUILDING',
        player: playerId,
        severity: 'minor',
        details: `Player has ${supplyBuildingsInUnits} ${supplyBuildingId} in units but only ${supplyBuildingEvents} addBuilding events (${supplyBuildingsInUnits - supplyBuildingEvents} missing — backfill could not reconcile)`
      });
    }
  }

  // Phase 9 — item-ledger consistency. Counts purchases + pickups vs.
  // uses + drops + sells for each consumable itemId per player. Surfaces:
  //   - ITEM_USES_EXCEED_PURCHASES (info) — more uses than acquisitions,
  //     indicates the parser missed a purchase/pickup somewhere.
  //   - ITEM_SLOT_DRIFT (minor) — slot tracking diverged from reality and
  //     HeroInventory.reclassify had to backfill (e.g. stwp→stel).
  //   - ITEM_INFERRED_PURCHASE (info) — post-parse reconciliation
  //     synthesised a missing purchase.
  //   - ITEM_SLOT_COLLISION (minor) — Phase 2 ledger detected a slot
  //     uniqueness violation (two different items in the same slot).
  _checkItemConsistency (player, playerId) {
    if (!player.eventStream || !player.eventStream.length) return;

    // Slot reclassifications (stwp → stel etc.)
    const reclassifications = player._itemReclassifications || [];
    reclassifications.forEach(r => {
      const fromId = (r.from && r.from.itemId) || '?';
      const toId = (r.to && r.to.itemId) || '?';
      this._record({
        type: 'ITEM_SLOT_DRIFT',
        player: playerId,
        severity: 'minor',
        details: `Slot reclassified ${fromId} → ${toId} at ${this._formatTime(r.gameTime)}: ${r.reason}`
      });
    });

    // Slot uniqueness collisions caught at HeroInventory.add time.
    const drifts = player._itemSlotDrift || [];
    drifts.forEach(d => {
      const prev = (d.previous && d.previous.itemId) || '?';
      const inc  = (d.incoming && d.incoming.itemId) || '?';
      this._record({
        type: 'ITEM_SLOT_COLLISION',
        player: playerId,
        severity: 'minor',
        details: `Slot ${d.slot} overwritten ${prev} → ${inc} at ${this._formatTime(d.gameTime)} (${d.reason})`
      });
    });

    // Post-parse reconciliation findings (use-count > purchase-count).
    const inferred = player._inferredItems || [];
    inferred.forEach(i => {
      const countStr = (i.count && i.count > 1) ? ` (×${i.count} inferred)` : '';
      this._record({
        type: 'ITEM_INFERRED_PURCHASE',
        player: playerId,
        severity: 'info',
        details: `${i.displayName} (${i.itemId})${countStr}: ${i.reason}`
      });
    });

    // Live in/out tally — separately flag use vs purchase imbalances that
    // weren't caught by the reconciliation pass (e.g. tomes or permanent
    // items the reconciler skipped — info-severity so the score barely
    // moves, but the warning is visible for review).
    const counts = {};
    player.eventStream.forEach(ev => {
      if (ev.key === 'itemPurchase' || ev.key === 'pickupItem') {
        const id = ev.item && ev.item.itemId;
        if (!id || id === 'Jwid') return;
        if (!counts[id]) counts[id] = { in: 0, out: 0, name: ev.item.displayName };
        counts[id].in++;
      } else if (ev.key === 'itemUse' || ev.key === 'sellItem') {
        const id = ev.item && (ev.item.knownItemId || ev.item.itemId);
        if (!id || id === 'Jwid') return;
        if (!counts[id]) counts[id] = { in: 0, out: 0, name: ev.item && ev.item.displayName };
        counts[id].out++;
      }
    });
    Object.keys(counts).forEach(id => {
      const c = counts[id];
      if (c.out > c.in) {
        this._record({
          type: 'ITEM_USES_EXCEED_PURCHASES',
          player: playerId,
          severity: 'info',
          details: `${c.name || id}: observed ${c.out} uses but only ${c.in} purchases/pickups (delta ${c.out - c.in})`
        });
      }
    });
  }

  _formatTime (ms) {
    const totalSec = Math.floor((ms || 0) / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // Inference-layer warnings. Surfaces:
  //   - TELEPORT_REJECTED (minor) — a teleport claim was downgraded
  //     to 'rejected' / 'unlikely' by post-parse passes. Evidence is
  //     attached to the record's _teleportEvents entry for explanation.
  //   - TELEPORT_LOW_CONFIDENCE (info) — claim settled at 'possible'
  //     (no strong evidence either way). Parser default; no action.
  //   - INFERENCE_NONCONVERGENT (minor) — fixpoint hit cap without
  //     stabilising. Should never happen in practice; if it does,
  //     evidence weights are oscillating and need attention.
  _checkInferenceClaims (player, playerId) {
    const reg = player._claimRegistry;
    if (!reg || !reg.iterate) return;
    for (const claim of reg.iterate()) {
      const parts = claim.subject.split('.');
      if (parts[1] !== 'teleport') continue;
      const payload = claim.payload || {};
      const tStr = payload.gameTime != null
        ? this._formatTime(payload.gameTime)
        : '?';
      const ability = (claim.value && claim.value.abilityCode) || '?';
      if (claim.confidence === 'rejected' || claim.confidence === 'unlikely') {
        const evSummary = (claim.evidence || [])
          .filter(e => e.weight < 0)
          .map(e => `${e.source}=${e.weight.toFixed(2)}`)
          .join(', ');
        this._record({
          type: 'TELEPORT_REJECTED',
          player: playerId,
          severity: 'minor',
          details: `${ability} at ${tStr} → ${claim.confidence} (${evSummary || 'no negative evidence'})`
        });
      } else if (claim.confidence === 'possible') {
        this._record({
          type: 'TELEPORT_LOW_CONFIDENCE',
          player: playerId,
          severity: 'info',
          details: `${ability} at ${tStr} → possible (no strong evidence either way)`
        });
      }
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
module.exports.SEVERITY_DEDUCTION = SEVERITY_DEDUCTION;
