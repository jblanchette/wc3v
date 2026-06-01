const utils = require("../helpers/utils"),
      mappings = require("../helpers/mappings"),
      { getBuildingWpmFootprint } = require("../helpers/buildingFootprints");

const {
  abilityActions,
  abilityFlagNames,
  mapStartPositions,
  specialBuildings,
  buildingUpgrades,
  tierBuildings,
  isWorkerUnit,
  defaultWorkerRole,
  WorkerRole,
  WorkerTask,
  GHOUL_ID,
  BURROW_ID,
  WORKER_IDS,
  BuildMechanic,
  raceBuildMechanic,
  getBuildTime,
  researchMeta,
  lookupSpellFromOrderId,
  NEUTRAL_HIRE_BUILDINGS,
  combatSpellHelpers,
  teleportAbilities,
  itemAbilityData
} = mappings;

const Unit = require("./Unit"),
      Hero = require("./Hero"),
      Building = require("./Building"),
      Item = require("./Item"),
      SubGroup = require("./SubGroup"),
      PlayerActions = require("./PlayerActions"),
      CombatSignalTracker = require("./CombatSignalTracker");

const {
  findHomeTownHall: _findHomeTownHall,
  TOWN_HALL_IDS
} = require("../helpers/teleportAbilities");
const HeroInventory = require("./HeroInventory");

const { SIGNAL_KINDS } = CombatSignalTracker;

const logManager = require("../helpers/logManager");
const config = require("../config/config");

const SelectModes = {
  select: 1,
  deselect: 2
};

// Expansion detection: building IDs that indicate a new base/gold mine
const EXPANSION_BUILDING_IDS = {
  'H': new Set(['htow']),   // Town Hall (upgrades are same building, not new placements)
  'O': new Set(['ogre']),   // Great Hall
  'E': new Set(['etol']),   // Tree of Life (uproot doesn't re-place a new building)
  'U': new Set(['unpl', 'ugol'])    // Necropolis or Haunted Gold Mine (haunting a mine IS the expansion for UD)
};
const EXPANSION_DISTANCE_THRESHOLD = 2500; // WC3 coord units from starting position
const SCOUT_DISTANCE_THRESHOLD = 2000;    // WC3 coord units — worker sent outside base area
const SCOUT_TIME_CUTOFF = 240000;         // 4 minutes — no scouts detected after this

// Building footprint helpers live in helpers/buildingFootprints.js so tools
// (parse-building-pathing.js) and the parser bundle share one source.

const Player = class {
  constructor (id, playerSlot, gameData, eventTimer, world, isNeutralPlayer) {
    this.id = id;
    this.isNeutralPlayer = isNeutralPlayer;
    this.gameData = gameData;
    this.gameDataMap = gameData && gameData.map || {};
    this.playerSlot = playerSlot;
    this.teamId = playerSlot ? playerSlot.teamId : 0;
    this.race = playerSlot ? utils.getRaceFromFlag(playerSlot.raceFlag) : 'R';

    this.eventTimer = eventTimer;
    this.world = world;

    this.units = [];
    this.destroyedSummons = [];

    this.removedBuildings = [];

    this.startingPosition = null;
    this._expansionBuildingCounts = {};  // { itemId: count } — fallback when startingPosition unavailable
    this._expansionPositions = [];      // [{x, y}] — dedup UD ugol+unpl at same expansion
    this._scoutedUnits = new Set();     // unit UUIDs that have already emitted a scout event
    this.updatingSubgroup = false;
    this.lastChangeGroupTime = null;
    this.selection = null;
    this.lastSelectedGroupNumber = null;
    this.groupSelections = {};

    this.heroSlotCount = 0;

    this.buildMenuOpen = false;

    this.tavernSelected = false;
    this.neutralShopSelected = false;
    this.neutralShop = {
      itemId: null,
      objectId1: null,
      objectId2: null
    };
    this.neutralHireBuildingSelected = false;
    this.neutralHireBuilding = null;

    this.itemMoveSelected = false;
    this.itemMoveObject = null;

    this.possibleRegisterItem = null;
    this.possibleSelectList = [];

    this.possiblyDeadUnits = [];

    this.knownObjectIds = {
      'worker': null,
      'townhall': null
    };

    // export event data for viewing clients
    this.eventStream = [];

    // Inference layer: claim registry. Populated by _applyTeleport (and
    // future claim-aware dispatchers); consumed by lib/inference/passes
    // post-parse to confirm/reject low-confidence events.
    const ClaimRegistry = require("./inference/ClaimRegistry");
    this._claimRegistry = new ClaimRegistry();
    
    // group selection export data for viewing clients
    this.lastSelectionId = null;
    this.selectionStream = [];
    this.groupStream = [];

    this._moveGroupCounter = 0;

    this.tierStream = [];
    this.tier = 0;
    this._baseSnapshots = [];

    this.researchLevels = {};
    this.researchStream = [];
    this.itemStream = null;
    this.apmData = null;

    // raw action log for APM computation (post-processed by buildApmData)
    this._rawActions = [];

    // tracks which abilities have autocast enabled per abilityId
    this.autocastState = {};

    // supply tracking
    this.supplyUsed = 0;
    this.supplyMax = 0;
    this._supplyBumps = [];
    this._buildingAttempts = [];

    // Combat-intent signal collector. Pushed to during action handling, then
    // consumed by BattleDetector after parse. Intermediate — not exported.
    this.combatSignals = new CombatSignalTracker(id);

    // Worker counts are derived on-demand via this.workerCounts
    // (computed from per-unit primaryRole and currentTask)

    // start at zero and upgrade to 1 so we have a record of it
    this.upgradeTier();

    // special tracker flag denoting how 'confidient' we are
    // that this player was parsed correctly

    this.parseConfidence = 1;
  }

  //
  // Compute worker assignment counts on-demand from per-unit state.
  // Single source of truth — replaces manual workerState/ghoulState counters.
  //
  get workerCounts () {
    let onGold = 0, onLumber = 0, onBuild = 0, totalWorkers = 0;
    let ghoulsOnLumber = 0, totalGhouls = 0;
    let consumedByBuildings = 0;

    for (const unit of this.units) {
      if (!isWorkerUnit(unit)) continue;
      // skip units still in training queue
      if (unit.isTraining) continue;
      // skip permanently destroyed wisps
      if (unit.destroyedByBuilding) continue;
      // skip consumed NE wisps (primaryRole nulled on consumption)
      if (unit.primaryRole === null && unit.currentTask === null) continue;

      if (unit.itemId === GHOUL_ID) {
        totalGhouls++;
        if (unit.currentTask === WorkerTask.LUMBER || unit.primaryRole === WorkerRole.LUMBER) {
          ghoulsOnLumber++;
        }
        continue; // ghouls tracked separately from regular workers
      }

      if (!unit.meta.worker) continue;
      totalWorkers++;

      // workers consumed by buildings count as onBuild
      if (unit.isConsumedByBuilding()) {
        onBuild++;
        consumedByBuildings++;
        continue;
      }

      switch (unit.currentTask) {
        case WorkerTask.GOLD: onGold++; break;
        case WorkerTask.LUMBER: onLumber++; break;
        case WorkerTask.BUILD: onBuild++; break;
        default:
          // BURROW/REPAIR/MILITIA/null: count toward primaryRole
          if (unit.primaryRole === WorkerRole.LUMBER) onLumber++;
          else onGold++;
          break;
      }
    }

    return { onGold, onLumber, onBuild, totalWorkers, ghoulsOnLumber, totalGhouls, consumedByBuildings };
  }

  initWorkerState () {
    // Per-unit roles are set by defaultWorkerRole() in addPlayerUnit().
    // All standard workers start on GOLD; ghouls start on LUMBER.
    // Reassignment happens when HarvestLumber / goldmine commands fire.
  }

  _traceTask (unit, newTask, caller) {
    if (!config.debugWorkers) return;
    logManager.getTracer().traceWorkerMutation({
      gameTime: this.eventTimer.timer.gameTime,
      playerId: this.id,
      unitUuid: unit.uuid,
      unitName: unit.displayName,
      field: 'currentTask',
      oldValue: unit.currentTask,
      newValue: newTask,
      caller
    });
  }

  setupInitialUnits () {
    const starterMap = {
      'O': {
        'townHallId': 'ogre',
        'workerCount': 5
      },
      'H': {
        'townHallId': 'htow',
        'workerCount': 5
      },
      'E': {
        'townHallId': 'etol',
        'workerCount': 5
      },
      'U': {
        'townHallId': 'unpl',
        'workerCount': 3,
        'workerSpecial': GHOUL_ID
      }
    };

    if (!starterMap[this.race]) {
      // person is random
      return;
    }

    const { townHallId, workerCount, workerSpecial } = starterMap[this.race];

    // add the town hall
    const townhall = new Building(
      this.eventTimer,
      null,
      null,
      townHallId,
      true
    );

    this.addPlayerBuilding(townhall, true);

    // add the workers
    for (let i = 0; i < workerCount; i++) {
      const worker = new Unit(this.eventTimer, null, null, mappings.workerForRace[this.race], true);

      this.addPlayerUnit(worker, true);
    }

    // workers + 1 town hall
    this.unregisteredUnitCount = (workerCount + 1);

    // some races have a 'special' other unit, like Undead ghoul
    if (workerSpecial) {
      const specialUnit = new Unit(this.eventTimer, null, null, workerSpecial, true);

      this.addPlayerUnit(specialUnit, true);
      this.unregisteredUnitCount += 1;
    }

    // initialize worker state based on race defaults
    this.initWorkerState();
  }

  nextMoveGroupId () {
    return ++this._moveGroupCounter;
  }

  addEvent (key, item) {
    const counts = this.workerCounts;
    const workers = {
      onGold: counts.onGold,
      onLumber: counts.onLumber,
      onBuild: counts.onBuild,
      totalWorkers: counts.totalWorkers,
      consumedByBuildings: counts.consumedByBuildings
    };

    if (this.race === 'U') {
      workers.ghoulsOnLumber = counts.ghoulsOnLumber;
    }

    if (config.debugWorkers) {
      logManager.getTracer().traceSnapshot({
        gameTime: this.eventTimer.timer.gameTime,
        playerId: this.id,
        counts: { ...counts }
      });
    }

    // safety net: if supplyUsed exceeds supplyMax, we missed supply buildings
    // (common in W3C replays where build actions are lost)
    if (this.supplyUsed > this.supplyMax) {
      const previousMax = this.supplyMax;
      this.supplyMax = Math.min(100, Math.ceil(this.supplyUsed / 10) * 10);

      // only record bump and reduce confidence when max actually changed
      // (once at 100 cap, every event would re-trigger without this guard)
      if (this.supplyMax !== previousMax) {
        this._supplyBumps.push({
          gameTime: this.eventTimer.timer.gameTime,
          supplyUsed: this.supplyUsed,
          previousMax,
          newMax: this.supplyMax,
          triggerEvent: key
        });

        console.logger(`WARNING - supply safety net: supplyUsed=${this.supplyUsed} > supplyMax=${previousMax}, bumped to ${this.supplyMax}`);
        this.reduceParseConfidence('Minor');
      }
    }

    const eventItem = {
      key,
      gameTime: this.eventTimer.timer.gameTime,
      supplyUsed: Math.min(this.supplyUsed, 100),
      supplyMax: Math.min(this.supplyMax, 100),
      workers,
      ...item
    };

    this.eventStream.push(eventItem);
  }

  // Emit a combat-intent signal for BattleDetector. The `partial` object
  // carries call-site specifics (kind, targetX/Y, target ids/uuid, hostile,
  // spellAbilityId). This helper fills in actor context (gameTime, playerId,
  // teamId, actor unit derivation) so action handlers stay terse.
  //
  // `focusUnit` is optional; when present we derive isHero/isCombatActor/etc.
  // from it.
  recordCombatSignal (focusUnit, partial) {
    if (!partial || !partial.kind) return;
    const focusMeta = focusUnit && focusUnit.meta;
    const isWorker = !!(focusMeta && focusMeta.worker);
    const isHero = !!(focusMeta && focusMeta.hero);
    const isIllusion = !!(focusUnit && focusUnit.isIllusion);
    // mirrors NeutralGroup.isCombatUnit shape: non-worker, non-illusion,
    // either a unit OR an uprooted ancient. Buildings auto-attacking from a
    // base are not "actors" — they're picked up by proximity in Phase 2.
    const isCombatActor = !isWorker && !isIllusion && !!focusUnit && (
      focusUnit.isUnit || (focusUnit.isBuilding && focusUnit.isUprooted)
    );

    const signal = {
      gameTime: this.eventTimer.timer.gameTime,
      playerId: this.id,
      actorTeamId: this.teamId,
      actorUnitUuid: focusUnit ? focusUnit.uuid : null,
      actorUnitItemId: focusUnit ? focusUnit.itemId : null,
      isHero,
      isCombatActor,
      selectionCount: (this.selection && this.selection.units)
        ? this.selection.units.length : 0,
      // Defaults that callers can override via `partial`.
      targetPlayerId: null,
      targetTeamId: null,
      targetUnitUuid: null,
      targetIsBuilding: false,
      spellAbilityId: null,
      hostile: false,
      ...partial
    };

    this.combatSignals.record(signal);
  }

  // Spell-signal classifier shared by the CastSkillTarget / default-spell
  // branches of useAbilityWithTargetAndObjectId and by useAbilityWithTarget.
  // Picks SPELL_TARGET_UNIT when the target is a resolved enemy; otherwise
  // SPELL_TARGET_GROUND if the spell is on the combat-ground whitelist.
  // Off-whitelist ally-targeted / self-cast spells emit no signal — proximity
  // in BattleDetector picks up the fight if there is one.
  _emitSpellSignal (focusUnit, spellInfo, objectId1, objectId2, targetX, targetY) {
    if (!spellInfo) return;
    const abilityId = spellInfo.abilityId;
    const groundClick =
      (objectId1 == null || objectId1 === -1 || objectId1 === 4294967295) &&
      (objectId2 == null || objectId2 === -1 || objectId2 === 4294967295);

    if (!groundClick) {
      const enemyHit = this.world.findEnemyByObjectIds(objectId1, objectId2, this.id, this.teamId);
      if (enemyHit) {
        this.recordCombatSignal(focusUnit, {
          kind: SIGNAL_KINDS.SPELL_TARGET_UNIT,
          targetX, targetY,
          targetPlayerId: enemyHit.ownerPlayerId,
          targetTeamId: enemyHit.ownerTeamId,
          targetUnitUuid: enemyHit.unit && enemyHit.unit.uuid,
          targetIsBuilding: !!(enemyHit.unit && enemyHit.unit.isBuilding),
          spellAbilityId: abilityId,
          hostile: true
        });
        return;
      }
      // Targeted at ally/self/neutral — no signal. Proximity will catch it
      // if the cast happens inside a fight.
      return;
    }

    if (combatSpellHelpers && combatSpellHelpers.isCombatGroundSpell(abilityId)) {
      this.recordCombatSignal(focusUnit, {
        kind: SIGNAL_KINDS.SPELL_TARGET_GROUND,
        targetX, targetY,
        spellAbilityId: abilityId,
        hostile: true
      });
    }
  }

  // Central teleport handler. Called from every action handler that detects a
  // teleport-class ability (Town Portal Scroll, Mass Teleport, Blink, Staff
  // of Teleportation). Captures origin/destination, enumerates grabbed units,
  // schedules the channel apply via EventTimer, and emits the structured
  // teleport event + combat signals for the clustering sweep.
  //
  //   ability       — entry from teleportAbilities registry
  //   caster        — Unit instance (the hero casting / item bearer)
  //   destX, destY  — target ground point (allied building's position, or
  //                   resolved AEbl ground target)
  //   destBuilding  — optional resolved building Unit (when target was a
  //                   building); recorded for attribution / banner display
  _applyTeleport (ability, caster, destX, destY, destBuilding, itemMeta) {
    if (!ability || !caster) return;
    if (destX == null || destY == null) return;
    if (caster.currentX == null || caster.currentY == null) return;

    const castTime = this.eventTimer.timer.gameTime;
    const originX = caster.currentX;
    const originY = caster.currentY;

    // Enumerate grabbed units. WC3 TP Scroll / Mass Teleport pulls the caster
    // PLUS all friendly units within grabRadius, INCLUDING other heroes —
    // user feedback caught the bug: a Lich 265u from the casting Death Knight
    // was being left behind. Excludes: the caster (already TP'ing), buildings,
    // summons, illusions, destroyed.
    const grabbed = [];
    if (ability.grabsAlliedUnits && ability.grabRadius > 0) {
      const r2 = ability.grabRadius * ability.grabRadius;
      for (const u of this.units) {
        if (u === caster) continue;
        if (u.isBuilding) continue;
        if (u.isIllusion) continue;
        if (u.destroyed) continue;
        if (u.summonDuration && u.summonDuration > 0) continue;
        if (u.currentX == null || u.currentY == null) continue;
        const dx = u.currentX - originX;
        const dy = u.currentY - originY;
        if (dx * dx + dy * dy <= r2) grabbed.push(u);
      }
    }

    // Build the structured teleport record. Stored on Player for export and
    // emitted into eventStream in cast / arrival phases.
    if (!this._teleportEvents) this._teleportEvents = [];
    const record = {
      gameTime: castTime,
      abilityCode: ability.code,
      abilityKind: ability.kind,
      abilityCategory: ability.category || null,
      abilityDisplayName: ability.displayName,
      abilityIcon: ability.icon || null,
      invulnerable: !!ability.invulnerable,
      cancellable: !!ability.cancellable,
      channelMs: ability.channelMs,
      caster: caster.exportUnitReference(),
      casterUuid: caster.uuid,
      origin: { x: +originX.toFixed(2), y: +originY.toFixed(2) },
      destination: { x: +(+destX).toFixed(2), y: +(+destY).toFixed(2) },
      destBuildingUuid: destBuilding ? destBuilding.uuid : null,
      destBuildingItemId: destBuilding ? destBuilding.itemId : null,
      destBuildingDisplayName: destBuilding ? destBuilding.displayName : null,
      grabbedUnitUuids: grabbed.map(u => u.uuid),
      grabbedUnitItemIds: grabbed.map(u => u.itemId),
      grabbedCount: grabbed.length,
      cancelled: false,
      cancelReason: null,
      appliedAt: null
    };
    this._teleportEvents.push(record);

    // Combat signal: cast at origin. Marks the moment / position; clustering
    // sweep groups it with nearby combat signals if any.
    this.recordCombatSignal(caster, {
      kind: SIGNAL_KINDS.TELEPORT_CAST,
      targetX: originX,
      targetY: originY,
      spellAbilityId: ability.code,
      hostile: false
    });

    // Phase-tagged eventStream entry for the cast.
    this.addEvent('teleport', { teleport: { ...record, _phase: 'cast' } });

    const self = this;
    const apply = () => {
      const applyTime = self.eventTimer.timer.gameTime;

      // Cancel detection — only for cancellable abilities. Invulnerable +
      // uncancellable TPs (Town Portal Scroll, Blink) always apply.
      if (ability.cancellable && !ability.invulnerable) {
        if (caster.destroyed) {
          record.cancelled = true;
          record.cancelReason = 'caster-destroyed';
          return;
        }
        // If the caster has moved meaningfully from the origin during the
        // channel, the cast was probably interrupted (stun/silence/displacement).
        const dx = caster.currentX - originX;
        const dy = caster.currentY - originY;
        if ((dx * dx + dy * dy) > (300 * 300)) {
          record.cancelled = true;
          record.cancelReason = 'caster-moved';
          self.addEvent('teleport', { teleport: { ...record, _phase: 'cancelled' } });
          return;
        }
      }

      // Apply: snap caster + each surviving grabbed unit's path to the
      // destination with isJump=true.
      caster.teleportTo(destX, destY);
      for (const u of grabbed) {
        if (u.destroyed) continue;          // grabbed unit died during channel
        u.teleportTo(destX, destY);
      }

      record.appliedAt = applyTime;

      // Arrival signal at destination. Non-hostile by default; if the
      // destination is near opposing units the clustering sweep / proximity
      // scan will draw the battle attachment.
      self.recordCombatSignal(caster, {
        kind: SIGNAL_KINDS.TELEPORT_ARRIVAL,
        targetX: destX,
        targetY: destY,
        spellAbilityId: ability.code,
        hostile: false
      });
      self.addEvent('teleport', { teleport: { ...record, _phase: 'arrival' } });
    };

    if (ability.channelMs > 0) {
      // Schedule the apply for cast time + channel ms via EventTimer.
      // onTick MUST be a function (EventTimer.process calls it every tick
      // until endTime — passing null would crash the parser on the first tick).
      this.eventTimer.addEvent(ability.channelMs, () => {}, () => apply());
    } else {
      apply();   // instant (Blink)
    }

    // Inference layer: register a Claim for this teleport so post-parse
    // passes can confirm or reject it. Parse-time behaviour above is
    // preserved (we still emit teleportScroll, schedule the apply, etc.)
    // — Player.commitClaims() patches event/record state when the claim
    // settles below `likely`. See lib/inference/.
    if (!this._claimRegistry) {
      const ClaimRegistry = require("./inference/ClaimRegistry");
      this._claimRegistry = new ClaimRegistry();
    }
    // Uniform subject type for every teleport-class ability. Category
    // (town-portal / single-unit / mass / blink) lives in `value` so
    // strategies can discriminate. Keeping one type means a single set
    // of strategies + thresholds applies across the family.
    const claimId = `p${this.id}.teleport@${Math.round(castTime)}.${ability.code}`;
    this._claimRegistry.addClaim({
      id: claimId,
      subject: `p${this.id}.teleport.${ability.code}@${Math.round(castTime)}`,
      predicate: 'occurred',
      value: {
        abilityCode: ability.code,
        category: ability.category || null,
        kind: ability.kind || null,
        destBuildingItemId: record.destBuildingItemId,
        destBuildingUuid: record.destBuildingUuid
      },
      source: 'dispatch',
      confidence: 'possible',
      createdAt: { pass: 0, gameTime: castTime },
      payload: {
        gameTime: castTime,
        channelMs: ability.channelMs,
        origin: { x: originX, y: originY },
        destination: { x: destX, y: destY },
        casterUuid: caster.uuid,
        itemSource: itemMeta && itemMeta.source ? itemMeta.source : null,
        itemSlot:   itemMeta && itemMeta.slot != null ? itemMeta.slot : null,
        itemId:     ability.code,
        grabbedUnitUuids: record.grabbedUnitUuids ? record.grabbedUnitUuids.slice() : [],
        recordRef: record,        // shared ref so commit can patch in place
        eventStreamRefs: []       // commitClaims pushes streamed event refs here
      }
    });
    // Stash the claim id on the record so the event-emit step below can
    // backlink — used by commitClaims to find the events to patch.
    record._claimId = claimId;
  }

  //
  // Check whether two eventStream entries represent the same logical event.
  // Used by deduplicateEventStream() to identify duplicates.
  //
  _isSameEvent (a, b) {
    const ref = (evt, field) => evt[field] || {};

    switch (a.key) {
      case 'addBuilding': {
        const ab = ref(a, 'building'), bb = ref(b, 'building');
        if (!ab.itemId || ab.itemId !== bb.itemId) return false;
        // same objectId pair → same instance
        if (ab.objectId1 != null && ab.objectId1 === bb.objectId1 &&
            ab.objectId2 != null && ab.objectId2 === bb.objectId2) return true;
        // same real position → same instance
        if (ab.currentX != null && ab.currentX !== 0 &&
            ab.currentX === bb.currentX && ab.currentY === bb.currentY) return true;
        // exact same gameTime, same itemId, no distinguishing info on at
        // least one side → treat as duplicate. The dedup loop only calls us
        // when a.gameTime === b.gameTime, so two real placements of the
        // same building at the literal same millisecond is implausible —
        // it's the parser emitting the same logical placement twice with
        // partial fields on one side.
        const aHasObj = ab.objectId1 != null && ab.objectId2 != null;
        const bHasObj = bb.objectId1 != null && bb.objectId2 != null;
        const aHasPos = ab.currentX != null && ab.currentX !== 0;
        const bHasPos = bb.currentX != null && bb.currentX !== 0;
        const aIdent = aHasObj || aHasPos;
        const bIdent = bHasObj || bHasPos;
        if (!aIdent || !bIdent) return true;
        return false;
      }
      case 'addUnit': {
        const au = ref(a, 'unit'), bu = ref(b, 'unit');
        if (au.itemId && au.itemId === bu.itemId) {
          if (au.objectId1 != null && au.objectId1 === bu.objectId1 &&
              au.objectId2 != null && au.objectId2 === bu.objectId2) return true;
        }
        return false;
      }
      case 'tierUpgrade': {
        const at = ref(a, 'building'), bt = ref(b, 'building');
        return at.itemId && at.itemId === bt.itemId;
      }
      case 'research':
        return a.itemId === b.itemId && a.level === b.level;
      case 'scout': {
        const as = ref(a, 'unit'), bs = ref(b, 'unit');
        return as.itemId && as.itemId === bs.itemId;
      }
      default:
        // same key + same gameTime is sufficient for simple events
        return true;
    }
  }

  //
  // Remove duplicate events from eventStream (post-parse cleanup).
  // Two events are duplicates if they have the same key, same gameTime
  // (or near-same — see _isNearDuplicateBuilding), and pass the
  // _isSameEvent identity check.
  //
  deduplicateEventStream () {
    const dominated = new Set();
    for (let i = 0; i < this.eventStream.length; i++) {
      if (dominated.has(i)) continue;
      const a = this.eventStream[i];
      for (let j = i + 1; j < this.eventStream.length; j++) {
        if (dominated.has(j)) continue;
        const b = this.eventStream[j];
        if (a.key !== b.key) continue;

        if (a.gameTime === b.gameTime) {
          if (this._isSameEvent(a, b)) {
            dominated.add(j);
            console.logger(`EventStream dedup: removed duplicate ${b.key} at t=${b.gameTime}`);
          }
          continue;
        }

        // Near-duplicate building events: same itemId, no positional disambiguation,
        // close gameTime. The replay parser sometimes emits the same building twice
        // when a worker's moveToBuild fires across action types — we only want one
        // event per logical placement.
        if (a.key === 'addBuilding' && this._isNearDuplicateBuilding(a, b)) {
          dominated.add(j);
          console.logger(`EventStream dedup: removed near-duplicate addBuilding ${b.building && b.building.itemId} (Δt=${b.gameTime - a.gameTime}ms)`);
        }
      }
    }
    if (dominated.size > 0) {
      this.eventStream = this.eventStream.filter((_, i) => !dominated.has(i));
    }
  }

  //
  // Same itemId, neither has both an objectId pair *and* a real position
  // (so we can't actually distinguish them), and the gameTimes are within
  // a tight window. Two real placements of the same building type would
  // realistically be many seconds apart and would have distinct positions.
  //
  _isNearDuplicateBuilding (a, b) {
    const ab = a.building, bb = b.building;
    if (!ab || !bb) return false;
    if (ab.itemId !== bb.itemId) return false;

    const NEAR_DUP_WINDOW_MS = 2000;
    if (Math.abs(b.gameTime - a.gameTime) > NEAR_DUP_WINDOW_MS) return false;

    // If both have distinct objectId pairs, treat as different instances.
    const aHasObj = ab.objectId1 != null && ab.objectId2 != null;
    const bHasObj = bb.objectId1 != null && bb.objectId2 != null;
    if (aHasObj && bHasObj &&
        (ab.objectId1 !== bb.objectId1 || ab.objectId2 !== bb.objectId2)) {
      return false;
    }

    // If both have distinct real positions, treat as different instances.
    const aHasPos = ab.currentX != null && (ab.currentX !== 0 || ab.currentY !== 0);
    const bHasPos = bb.currentX != null && (bb.currentX !== 0 || bb.currentY !== 0);
    if (aHasPos && bHasPos &&
        (ab.currentX !== bb.currentX || ab.currentY !== bb.currentY)) {
      return false;
    }

    return true;
  }

  recordSelection () {
    const { selection } = this;

    if (!selection) {
      console.logger("JDEBUG happened here");
      return;
    }

    if (this.lastSelectionId === selection.groupId) {
      return;
    }

    this.lastSelectionId = selection.groupId;
    const selectionItem = {
      selection: selection.exportReference(),
      gameTime: this.eventTimer.timer.gameTime
    };

    this.selectionStream.push(selectionItem);
  }

  _snapshotBase () {
    const BASE_RADIUS = 2000;
    if (!this.startingPosition) return [];

    const sx = this.startingPosition.x;
    const sy = this.startingPosition.y;

    return this.units
      .filter(u => u.isBuilding && u.currentX !== 0 && u.currentY !== 0 &&
        utils.distance(u.currentX, u.currentY, sx, sy) < BASE_RADIUS)
      .map(u => ({
        itemId: u.itemId,
        displayName: u.displayName,
        x: u.currentX,
        y: u.currentY,
        collisionSize: (u.balanceInfo && u.balanceInfo.collisionSize) || 0,
        isInferred: u.isInferred || false
      }));
  }

  upgradeTier (itemId) {
    const nextTier = this.tier + 1;

    // max tier is 3 (Fortress/Black Citadel/Tree of Eternity/Castle)
    if (nextTier > 3) {
      console.logger("not upgrading tier above 3, ignoring: ", nextTier);
      return;
    }

    const eventItem = {
      gameTime: this.eventTimer.timer.gameTime,
      tier: nextTier,
      position: this.startingPosition ?
        { x: this.startingPosition.x, y: this.startingPosition.y } : null
    };

    const lastItem = this.tierStream[this.tierStream.length - 1];
    // Dedup guard: skip if same tier transition fires again too quickly
    // Only apply between tier 2+ transitions (tier 1→2 is always valid since tier 1 is synthetic at t=0)
    if (lastItem && lastItem.tier >= 2) {
      const tierDelta = (eventItem.gameTime - lastItem.gameTime);
      if (tierDelta < 130000) { // small buffer but pretty much everything is 140 seconds
        console.logger("not adding tier event because of time delta too small: ", eventItem.gameTime, lastItem.gameTime, tierDelta);
        return;
      }
    }

    // snapshot base layout at current tier before upgrading
    if (this.tier >= 1 && itemId) {
      this._baseSnapshots.push({
        label: `Tier ${this.tier}`,
        tier: this.tier,
        gameTime: this.eventTimer.timer.gameTime,
        buildings: this._snapshotBase()
      });
    }

    this.tier = nextTier;
    this.tierStream.push(eventItem);
    console.logger(`player ${this.id} is now upgraded to Tier ${this.tier}`);

    // Emit tier upgrade to eventStream for build order display
    if (itemId) {
      const info = mappings.getUnitInfo(itemId);
      const costs = mappings.unitCosts[itemId];

      this.addEvent('tierUpgrade', {
        building: {
          displayName: info.displayName || itemId,
          itemId: itemId,
          goldCost: (costs && costs.gold) || 0,
          lumberCost: (costs && costs.lumber) || 0,
          foodUsed: 0,
          foodMade: 0,
          tierTarget: nextTier,
          buildTime: mappings.getBuildTime(itemId)
        }
      });
    }
  }

  addResearch (itemId, building) {
    const meta = researchMeta[itemId];
    if (!meta) return;

    const currentLevel = this.researchLevels[itemId] || 0;
    if (currentLevel >= meta.maxLevel) {
      console.logger(`player ${this.id} already at max level for ${itemId}`);
      return;
    }

    const level = currentLevel + 1;
    this.researchLevels[itemId] = level;

    const goldCost = (meta.gold && meta.gold[currentLevel]) || 0;
    const lumberCost = (meta.lumber && meta.lumber[currentLevel]) || 0;

    const researchEvent = {
      itemId,
      level,
      displayName: meta.name,
      category: meta.category,
      icon: meta.icons[currentLevel] || meta.icons[0] || '',
      goldCost,
      lumberCost,
      building: building ? building.exportUnitReference() : null
    };

    this.researchStream.push({
      gameTime: this.eventTimer.timer.gameTime,
      ...researchEvent
    });

    this.addEvent('research', researchEvent);
    console.logger(`player ${this.id} researching ${meta.name} level ${level}`);
  }

  handleAutocastToggle (focusUnit, spellInfo) {
    const isOn = spellInfo.toggle === 'on';
    this.autocastState[spellInfo.abilityId] = isOn;

    this.addEvent('autocastToggle', {
      unit: focusUnit.exportUnitReference(),
      spellName: spellInfo.displayName,
      spellItemId: spellInfo.abilityId,
      icon: spellInfo.icon,
      state: spellInfo.toggle,
      isUnitSpell: !focusUnit.meta.hero
    });

    console.logger(`player ${this.id} autocast ${spellInfo.toggle}: ${spellInfo.displayName}`);
  }

  recordGroups () {
    const groupData = Object.keys(this.groupSelections).reduce((acc, groupNumber) => {
      const selection = this.groupSelections[groupNumber];
      const item = {
        groupNumber,
        selection: selection.exportReference()
      };
      
      acc[groupNumber] = item;
      return acc;
    }, {});

    const { lastSelectedGroupNumber } = this;
    const groupItem = {
      lastSelectedGroupNumber,
      gameTime: this.eventTimer.timer.gameTime,
      groups: groupData
    };
    
    this.groupStream.push(groupItem);
  }

  reduceParseConfidence (amountType) {
    let amount;

    switch (amountType) {
      case 'Critical':
        amount = 0.005;
      break;
      case 'Major':
        amount = 0.0025;
      break;
      case 'Minor':
        amount = 0.0010;
      break;
      case 'Tiny':
        amount = 0.00025;
      break;
      default:
        amount = 0.00001;
      break;
    }

    this.parseConfidence -= amount;
    console.logger(`WARNING - reducing parseconfidence by ${amount} - now at ${this.parseConfidence}`);
  }

  //
  // Unit snapshots are used when trying to determine which summoned unit
  // should be destroyed when the unit hasn't been fully registered.
  // One is taken when a summoned unit is created and compared to at death.
  //
  getUnitSnapshot () {
    const unitList = this.units.map(unit => {
      const { itemId1, itemId2, isRegistered, spawnTime } = unit;

      if (itemId1 && itemId2) {
        return { 
          itemId1, 
          itemId2,
          spawnTime,
          isRegistered: isRegistered || (this.findUnit(itemId1, itemId2) ? true : false)
        };
      }

      return null;
    }).filter(unit => { return unit !== null; });

    const cleanPossibleList = this.possibleSelectList.map(punit => {
      const { itemId1, itemId2, spawnTime } = punit;
      return { itemId1, itemId2, spawnTime, isRegistered: false };
    });

    return {
      units: Array.from(unitList.concat(cleanPossibleList))
    };
  }

  //
  // Ensure a group has valid unit types, wc3 doesn't allow building / non-building mixes
  // but replay files sometimes have invalid units in groups (wc3 probably also ignores them)
  //
  ensureValidGroup (oldGroup, group) {
    const self = this;
    if (!group.length) {
      return [];
    }

    const firstGroupItem = group[0];
    const firstGroupUnit = this.findUnit(firstGroupItem.itemId1, firstGroupItem.itemId2);

    if (!firstGroupUnit || !firstGroupUnit.isRegistered) {
      return group;
    }

    const oldFirstItem = oldGroup[0];
    const oldFirstUnit = oldFirstItem && this.findUnit(oldFirstItem.itemId1, oldFirstItem.itemId2);

    let groupType;
    if (oldFirstUnit) {
      // get the groupType from the old selection
      groupType = (oldFirstUnit.isBuilding && !oldFirstUnit.isUprooted) ? 0 : 1;
    } else {
      // get the group type from new selection
      groupType = (firstGroupUnit.isBuilding && !firstGroupUnit.isUprooted) ? 0 : 1;
    }

    return group.filter(groupItem => {
      const { itemId1, itemId2 } = groupItem;
      const groupUnit = self.findUnit(itemId1, itemId2);

      if (groupUnit) {
        const checkType = (groupUnit.isBuilding && !groupUnit.isUprooted) ? 0 : 1;
        if (checkType !== groupType) {
          console.logger("removing unit of different type from group: ", groupItem);
        }

        if (checkType !== groupType) {
          return false; // filter this unit out
        }
      }

      return true;
    });
  }

  //
  // find the first instance of an unregistered unit from the players selection
  //
  getFirstUnregisteredUnitFromSelection () {
    return this.selection.units.find(unit => {
      return !this.findUnit(unit.itemId1, unit.itemId2);
    });
  }

  //
  // Wc3 itemIds start with the letter of the race,
  // which can sometimes be N for neutral
  //
  isPlayersRace (itemId) {
    let firstItemIdLetter = itemId[0].toUpperCase();

    return firstItemIdLetter === this.race;
  }

  //
  // find a players unit by itemId1-2 pair
  //
  findUnit (itemId1, itemId2) {
    const searchUnit = {
      itemId1: itemId1,
      itemId2: itemId2
    };

    const unitCheck = (unit) => {
      return utils.isEqualUnitItemId(unit, searchUnit);
    };

    // do error checking
    const dupeCheckList = this.units.filter(unitCheck);
    if (dupeCheckList.length > 1 && itemId1 !== null) {
      console.logger("error - found multiple units with same itemId1-2", itemId1, itemId2, dupeCheckList.length);
      console.logger(dupeCheckList.forEach(unit => { unit.printUnit(); }));

      let keeperUnit = false;

      console.logger("units before filter: ", this.units.length);
      this.units = this.units.filter(unit => {
        if (utils.isEqualUnitItemId(unit, searchUnit)) {
          if (!keeperUnit) {
            keeperUnit = true;

            return true;
          } else {
            return false;
          }
        }
        
        return true;
      });

      console.logger("bad units filtered out");
      this.reduceParseConfidence('Minor');
    }

    return this.units.find(unitCheck);
  }

  //
  // find a players unit by objectId1-2 pair
  //
  findUnitByObjectId (objectId1, objectId2) {
    const dupeCheckList = this.units.filter(unit => {
      return unit.objectId1 === objectId1 &&
             unit.objectId2 === objectId2;
    });

    if (dupeCheckList.length > 1) {
      console.logger("error - found multiple units with same objectId1-2");
      console.logger(dupeCheckList.forEach(unit => { unit.printUnit(); }));
      //throw new Error("bad unit find by objectid");
    }

    return this.units.find(unit => {
      return unit.objectId1 === objectId1 &&
             unit.objectId2 === objectId2;
    });
  }

  //
  // find first player unit by itemId
  //
  findUnitByItemId (fixedItemId) {
    return this.units.find(unit => {
      return unit.itemId === fixedItemId;
    });
  }

  //
  // find first unregistered player unit
  //
  findUnregisteredUnit () {
    return this.units.find(unit => {
      return unit.objectId1 === null;
    });
  }

  //
  // find first unregistered player unit
  //
  findUnregisteredBuilding () {
    return this.units.find(unit => {
      return unit.isBuilding && unit.itemId1 == null;
    });
  }

  //
  // find first unregistered player unit by itemId
  // also checks against possible unit evolutions
  //
  findBuildingAtPosition (itemId, x, y) {
    return this.units.find(unit =>
      unit.isBuilding &&
      unit.itemId === itemId &&
      unit.objectId1 === null &&
      unit.currentX === x &&
      unit.currentY === y
    );
  }

  findUnregisteredUnitByItemId (itemId) {
    const unitInfo = mappings.getUnitInfo(itemId);
    console.logger("findUnreg by itemId:", itemId, unitInfo);

    return this.units.find(unit => {
      const unitInfo = mappings.getUnitInfo(unit.itemId);
      const match = unit.itemId === itemId &&
             (unit.itemId1 === null || unit.objectId1 === null);

      if (!match && unitInfo.meta.evolution) {
        const { meta } = unitInfo;
        const evolutionItemId = meta.evolution.itemId;

        return itemId === evolutionItemId &&
              (unit.itemId1 === null || unit.objectId2 === null);
      }

      return match;
    });
  }

  //
  // find first unregistered player unit by itemId1-2 pair
  //
  findUnregisteredUnitByItemIds (itemId1, itemId2) {
    return this.units.find(unit => {
      return utils.isEqualItemId(unit.itemId1, itemId1) && 
             utils.isEqualItemId(unit.itemId2, unit.itemId2) &&
             unit.objectId1 === null;
    });
  }

  // 
  // get all units of a given itemId
  //
  getUnitsByItemId (itemId) {
    return this.units.filter(unit => {
      return unit.itemId === itemId;
    });
  }

  //
  // get unregistered units from the players selection
  //
  getUnknownSelectionUnits () {
    return this.selection.units.filter(unit => {
      const { itemId1, itemId2 } = unit;
      return !this.findUnit(itemId1, itemId2);
    });
  }

  //
  // Add a player unit
  //
  addPlayerUnit (unit, ignoreEvent = false) {
    // error checking
    if (unit.itemId1 && unit.itemId2) {
      const hasItemIdPair = this.units.find(sunit => {
        return utils.isEqualUnitItemId(sunit, unit);
      });

      if (hasItemIdPair) {
        console.logger("found unit with existing itemId pair");
        hasItemIdPair.printUnit();

        throw new Error("bad unit item id");
      }
    }

    // todo: move this to Hero or something
    // assign a heroes spells
    unit.spellList = unit.meta.hero 
      ? Hero.getAbilitiesForHero(unit.itemId) : null;

    unit.spellList = unit.spellList ? unit.spellList.filter(itemId => {
      const spellInfo = mappings.getUnitInfo(itemId);

      return spellInfo.isKnownId;
    }) : null;

    // add the unit to the player and the world
    this.units.push(unit);
    this.world.addPlayerUnit(this.id, unit);

    // Mirror this unit into the cross-player registry so BattleDetector
    // can resolve enemy targets. Idempotent; auto-registers if ids are set.
    unit.bindToWorld(this.world, this.id, this.teamId);

    const foodUsed = (unit.balanceInfo && unit.balanceInfo.foodUsed) || 0;
    const foodMade = (unit.balanceInfo && unit.balanceInfo.foodMade) || 0;

    if (unit.isTraining) {
      // deferred supply: training units don't count toward supply until complete
      // foodMade still counts immediately (e.g., supply buildings under construction)
      this.supplyMax += foodMade;

      // set up callback for when training finishes
      const playerInstance = this;
      unit._onTrainingComplete = () => {
        playerInstance.supplyUsed += foodUsed;

        // now apply worker role that was deferred
        if (isWorkerUnit(unit)) {
          const role = unit._pendingRole || defaultWorkerRole(unit);
          const { gameTime } = playerInstance.eventTimer.timer;
          unit.setWorkerRole(role, gameTime);
        }
      };
    } else {
      // immediate supply tracking (spawned-at-start units, non-trained units)
      this.supplyUsed += foodUsed;
      this.supplyMax += foodMade;

      // set per-unit worker state (primaryRole + currentTask)
      if (isWorkerUnit(unit)) {
        const role = defaultWorkerRole(unit);
        const { gameTime } = this.eventTimer.timer;
        unit.setWorkerRole(role, gameTime);
      }
    }

    if (ignoreEvent) {
      return;
    }

    this.addEvent('addUnit', { unit: unit.exportUnitReference() });
  }

  //
  // Add a player building
  //
  addPlayerBuilding (unit, ignoreEvent = false) {
    // error checking

    console.logger("*** building player building: ", unit.displayName, unit.currentX, unit.currentY);

    // check if building was pre-registered in units list (early registration for selection tracking)
    const alreadyInUnits = this.units.includes(unit);

    if (alreadyInUnits) {
      // moveToBuild callback can fire multiple times when a worker walk is interrupted;
      // only emit the building event once per building instance
      if (unit._buildEventEmitted) {
        console.logger("skipping duplicate building event for:", unit.displayName, unit.uuid);
        return;
      }
    } else {
      const hasRealPosition = unit.currentX !== 0 || unit.currentY !== 0;
      let existingBuilding = null;

      if (hasRealPosition) {
        existingBuilding = this.units.find(playerUnit => {
          return playerUnit.isBuilding &&
                 playerUnit.currentX === unit.currentX &&
                 playerUnit.currentY === unit.currentY;
        });
        if (existingBuilding) {
          console.logger("building dedup: position match", unit.displayName, `at (${unit.currentX},${unit.currentY})`);
        }
      } else {
        console.logger("building dedup: skipping position check for (0,0) building:", unit.displayName, unit.itemId);
      }

      if (!existingBuilding && unit.objectId1 != null && unit.objectId2 != null) {
        existingBuilding = this.units.find(playerUnit => {
          return playerUnit.isBuilding &&
                 playerUnit.objectId1 === unit.objectId1 &&
                 playerUnit.objectId2 === unit.objectId2;
        });
        if (existingBuilding) {
          console.logger("building dedup: objectId match", unit.displayName, `obj(${unit.objectId1},${unit.objectId2})`);
        }
      }

      if (!Building.isTavern(unit.itemId) && existingBuilding) {
        console.logger("!! found existing building already:", existingBuilding.displayName);
        return;
      }

      this.units.push(unit);
      this.world.addPlayerUnit(this.id, unit);

      // Mirror into cross-player registry (battle-detector enemy lookup).
      unit.bindToWorld(this.world, this.id, this.teamId);
    }

    // update supply tracking (only food-providing buildings have foodMade > 0)
    const foodMade = (unit.balanceInfo && unit.balanceInfo.foodMade) || 0;
    this.supplyMax += foodMade;

    // ensure building has a valid position before emitting events
    this.estimateBuildingPosition(unit);

    if (ignoreEvent) {
      return;
    }

    // Stamp the building's per-cell pathing.tga bitmap onto the static
    // pathing grid via CollisionWorld. No fallback — manifest is required.
    // (Skipped for initial buildings — their footprints are already baked
    // into the WPM pathing data shipped with each map.)
    if (unit.currentX && unit.currentY && this.world.collisionWorld) {
      const entry = this.world.collisionWorld.stampBuilding(
        unit.currentX, unit.currentY, unit.itemId
      );
      unit._pathingEntry = entry;
      unit._collisionStampPos = { x: unit.currentX, y: unit.currentY };
    }

    unit._buildEventEmitted = true;

    // Detect if this building represents an expansion to a new gold mine
    const raceExpIds = EXPANSION_BUILDING_IDS[this.race];
    let isExpansion = false;

    if (raceExpIds && raceExpIds.has(unit.itemId)) {
      const prevCount = this._expansionBuildingCounts[unit.itemId] || 0;
      this._expansionBuildingCounts[unit.itemId] = prevCount + 1;

      if (this.startingPosition) {
        isExpansion = utils.distance(
          unit.currentX, unit.currentY,
          this.startingPosition.x, this.startingPosition.y
        ) > EXPANSION_DISTANCE_THRESHOLD;
      } else {
        // Fallback (no map position data): second+ placement = expansion for all races
        isExpansion = (prevCount >= 1);
      }

      // Dedup: UD can haunt a gold mine AND build a necropolis at the same expansion.
      // Only count the first building at each location as an expansion.
      if (isExpansion && unit.currentX != null) {
        const DEDUP_THRESHOLD = 1500;
        const nearExisting = this._expansionPositions.some(pos =>
          utils.distance(unit.currentX, unit.currentY, pos.x, pos.y) < DEDUP_THRESHOLD
        );
        if (nearExisting) {
          isExpansion = false;
        } else {
          this._expansionPositions.push({ x: unit.currentX, y: unit.currentY });
        }
      }
    }

    console.logger("** adding building event", this.uuid, unit.displayName, isExpansion ? "(EXPANSION)" : "");
    this.addEvent('addBuilding', {
      building: unit.exportUnitReference(),
      isExpansion
    });
  }

  //
  // Detect when a worker is sent outside the base area (scouting).
  // Fires once per unit. Uses the move/ability target coordinates.
  //
  // opts.distanceThreshold — override the default distance (e.g. building-placement
  //   uses the larger expansion threshold so near-base ancients don't tag).
  //
  checkScoutDetection (unit, targetX, targetY, opts = {}) {
    if (!this.startingPosition) return;
    if (!isWorkerUnit(unit)) return;
    if (this._scoutedUnits.has(unit.uuid)) return;

    // only detect scouts in the early game window
    if (this.eventTimer.timer.gameTime > SCOUT_TIME_CUTOFF) return;

    const dist = utils.distance(
      this.startingPosition.x, this.startingPosition.y,
      targetX, targetY
    );

    const threshold = opts.distanceThreshold || SCOUT_DISTANCE_THRESHOLD;
    if (dist < threshold) return;

    this._scoutedUnits.add(unit.uuid);

    const isWisp = unit.itemId === 'ewsp';
    const isLumberScout = isWisp && unit.primaryRole === WorkerRole.LUMBER;

    // tag the unit itself so the client can render it differently
    unit.scoutInfo = {
      gameTime: this.eventTimer.timer.gameTime,
      isLumberScout,
      position: { x: targetX, y: targetY }
    };

    this.addEvent('scout', {
      unit: unit.exportUnitReference(),
      targetPosition: { x: targetX, y: targetY },
      distanceFromBase: Math.round(dist),
      isLumberScout,
      race: this.race
    });
  }

  //
  // Estimate a reasonable position for a building that has no coordinates.
  // Used for buildings discovered through selection (not build commands)
  // and for inferred buildings from tech-tree backfill.
  //
  estimateBuildingPosition (building) {
    // already has a real position
    if (building.currentX !== 0 || building.currentY !== 0) {
      return;
    }

    // Special case: Haunted Gold Mine → use nearest neutral gold mine
    if (building.itemId === 'ugol') {
      const neutralData = this.world.playerData[mappings.NEUTRAL_PLAYER_ID];
      if (neutralData) {
        const goldMines = neutralData.units.filter(u => u.itemId === 'ngol');
        if (goldMines.length > 0) {
          const refX = this.startingPosition ? this.startingPosition.x : 0;
          const refY = this.startingPosition ? this.startingPosition.y : 0;
          const closest = utils.closestToPoint(refX, refY, goldMines);
          if (closest) {
            building.currentX = closest.currentX;
            building.currentY = closest.currentY;
            console.logger("estimated ugol position from nearest gold mine:", building.currentX, building.currentY);
            return;
          }
        }
      }
    }

    // Try WPM-aware placement: find an unoccupied buildable spot near the base
    const wpmGrid = this.world.gridData && this.world.gridData.wpm
      ? this.world.gridData.wpm.grid
      : null;

    if (wpmGrid && this.startingPosition) {
      const pos = this._findBuildablePosition(wpmGrid, building);
      if (pos) {
        building.currentX = pos.x;
        building.currentY = pos.y;
        console.logger("estimated building position via WPM:", building.displayName, pos.x, pos.y);
        return;
      }
    }

    // Fallback: use player's starting position
    if (this.startingPosition) {
      building.currentX = this.startingPosition.x;
      building.currentY = this.startingPosition.y;
      console.logger("estimated building position from starting position:", building.displayName, building.currentX, building.currentY);
      return;
    }

    // Last resort: find any building with a valid position
    const validBuilding = this.units.find(u =>
      u.isBuilding && (u.currentX !== 0 || u.currentY !== 0)
    );
    if (validBuilding) {
      building.currentX = validBuilding.currentX;
      building.currentY = validBuilding.currentY;
      console.logger("estimated building position from nearby building:", building.displayName, building.currentX, building.currentY);
    }
  }

  _findBuildablePosition (wpmGrid, building) {
    const originX = wpmGrid[0][0].x;
    const originY = wpmGrid[0][0].y;
    const rows = wpmGrid.length;
    const cols = wpmGrid[0].length;
    // footprint in WPM cells (32 units each) — from pathing.tga manifest
    const footprint = getBuildingWpmFootprint(building.itemId);
    const halfFoot = Math.floor(footprint / 2);

    // build occupied cell set from existing buildings
    const occupied = new Set();
    this.units.filter(u => u.isBuilding && (u.currentX !== 0 || u.currentY !== 0)).forEach(b => {
      const bCol = Math.round((b.currentX - originX) / 32);
      const bRow = Math.round((originY - b.currentY) / 32);
      const bFoot = getBuildingWpmFootprint(b.itemId);
      const bHalf = Math.floor(bFoot / 2);
      for (let r = bRow - bHalf; r < bRow + bHalf; r++) {
        for (let c = bCol - bHalf; c < bCol + bHalf; c++) {
          occupied.add(r * 10000 + c);
        }
      }
    });

    const startCol = Math.round((this.startingPosition.x - originX) / 32);
    const startRow = Math.round((originY - this.startingPosition.y) / 32);

    const canPlace = (cr, cc) => {
      for (let r = cr - halfFoot; r < cr + halfFoot; r++) {
        for (let c = cc - halfFoot; c < cc + halfFoot; c++) {
          if (r < 0 || r >= rows || c < 0 || c >= cols) return false;
          if (occupied.has(r * 10000 + c)) return false;
          const cell = wpmGrid[r][c];
          if (cell.NoBuild || cell.NoWalk) return false;
        }
      }
      return true;
    };

    // spiral outward in 4-cell (1 tile) steps
    const step = 4;
    for (let dist = 0; dist < 30; dist++) {
      for (let dx = -dist; dx <= dist; dx++) {
        for (let dy = -dist; dy <= dist; dy++) {
          if (Math.abs(dx) !== dist && Math.abs(dy) !== dist) continue;
          const cr = startRow + dy * step;
          const cc = startCol + dx * step;
          if (canPlace(cr, cc)) {
            return { x: originX + cc * 32, y: originY - cr * 32 };
          }
        }
      }
    }
    return null;
  }

  //
  // gives an item to a unit
  //
  giveItem (unit, itemId, knownOwner = true, isSpawnedAtStart = false, itemSlot = null) {
    // safety check
    unit.checkDestroyed();

    const newItem = new Item(unit.eventTimer, null, null, itemId, isSpawnedAtStart);
    newItem.knownOwner = knownOwner;

    // Route through the HeroInventory ledger so provenance is recorded,
    // slot-uniqueness violations are detected, and a unified itemEvent
    // fires alongside any caller-emitted legacy event (itemPurchase,
    // hireMercenary, etc.). The legacy direct-assignment behavior is
    // preserved via add() returning the slot it picked.
    const source = isSpawnedAtStart
      ? 'startup-grant'
      : knownOwner ? 'shop-known' : 'shop-inferred';
    const confidence = knownOwner ? 'high' : 'low';
    const result = HeroInventory.add(this, unit, newItem, {
      slot: itemSlot != null ? itemSlot : undefined,
      source,
      confidence
    });

    console.logger(`put hero ${unit.displayName} item ${newItem.displayName} in slot ${result.slot}`);

    return newItem;
  }

  //
  // remove a player building.  used for unsummon building
  //
  removePlayerBuilding (unit) {
    let isRegistered = false;

    const { 
      currentX,
      currentY
    } = unit;

    console.logger("Trying to remove building: ", unit.displayName);
    let removeIndex = this.units.findIndex(removeUnit => {
      return removeUnit.currentX === currentX &&
             removeUnit.currentY === currentY;
    });

    const removedBuilding = this.units[removeIndex];
    if (removedBuilding) {
      console.logger("removing building. index: ", removeIndex);
      console.logger("units before: ", this.units.map(unit => unit.displayName));
      this.removedBuildings.push(removedBuilding);
      this.units.splice(removeIndex, 1);
      console.logger("units after: ", this.units.map(unit => unit.displayName));
    }
  }

  //
  // get the units in a players selection that are known.
  // optionally we can get only unregistered units in the selction
  //
  getSelectionUnits (onlyUnregistered = false) {
    const self = this;
    if (!this.selection) {
      console.logger("no selection, return empty");
      return [];
    }

    return this.selection.units.reduce((acc, unitItem) => {
      const { itemId1, itemId2 } = unitItem;
      const unit = self.findUnit(itemId1, itemId2);

      if (!onlyUnregistered && unit) {
        // acc the registered Unit
        acc.push(unit);
      } else if (onlyUnregistered) {
        // acc the raw { itemId1, itemId2 }
        acc.push(unitItem);
      }

      return acc;
    }, []);
  }

  //
  // get the currently selected unit from a players seleciton
  // based on the tracked selectionIndex 
  //
  getSelectedUnit () {
    const { selectionIndex } = this.selection;
    const rawUnit = this.selection.units[selectionIndex];

    console.logger("getting selection unit: ", selectionIndex, rawUnit);

    if (!rawUnit) {
      console.logger("raw selection: ", this.selection.units);
      console.logger("WARNING - unable to find unit at selection index");

      return null;
    }

    const { itemId1, itemId2 } = rawUnit;
    return this.findUnit(itemId1, itemId2) || null;
  }

  //
  // ActionBlock method
  // auto-generated by the game during selection update events
  // used by engine to infer information about same-block updates.
  //
  updateSubgroup (action) {
    // auto-gen war3 message was triggered
    this.updatingSubgroup = true;

    // sort of hack to see if we can avoid sameblock detection problems
    this.lastChangeGroupTime = null;
    this.recordSelection();
  }

  //
  // routine to update worker and townhall units known object ids
  // as they become known.
  //
  assignKnownUnits () {
    let self = this;
    let knownObjectIds = this.knownObjectIds;

    const shouldCheckAssignments = Object.keys(knownObjectIds).some(key => {
      return knownObjectIds[key] === null;
    });

    if (!shouldCheckAssignments) {
      return;
    }

    this.units.forEach(unit => {
      if (!unit.isSpawnedAtStart || unit.objectId1 === null) {
        return;
      }

      if (!knownObjectIds.worker && unit.meta.worker) {
        knownObjectIds.worker = unit.objectId1;
      } else if (!knownObjectIds.townhall && unit.isBuilding) {
        knownObjectIds.townhall = unit.objectId1;
      }
    });
  }

  //
  // helper routine to try and guess an object type based on knownObjectIds
  //
  guessUnitType (objectId) {
    const knownObjectIds = this.knownObjectIds;
    const threshold = 6;

    let bestGuess = Object.keys(knownObjectIds).find(key => {
      const knownId = knownObjectIds[key];
      if (knownId === null) {
        return false;
      }

      return Math.abs(knownId - objectId) <= threshold;
    });

    return bestGuess || null;
  }

  //
  // helper routine to set the hero slot and 
  // mutate the hero unit setting its known slot.
  // wc3 allows players up to 3 heroes, the first is given a TP scroll
  //
  setHeroSlot (heroUnit) {
    this.heroSlotCount++;
    
    const nextHeroSlot = this.heroSlotCount;
    heroUnit.heroSlot = nextHeroSlot;

    if (nextHeroSlot === 1) {
      console.logger(this.id, "Gave first hero a TP item.");
      this.giveItem(heroUnit, 'stwp', true, true);
    }

    return heroUnit;
  }

  //
  // clear our units that have become registered from possibleSelectList
  //
  clearKnownPossibleUnits () {
    this.possibleSelectList = this.possibleSelectList.filter(unit => {
      return !this.findUnit(unit.itemId1, unit.itemId1);
    });
  }

  //
  // Called during `selectSubgroup` when unregistered units
  // are known to exist.  The `itemId` is only known for
  // one unit - the first in the selection group.  So
  // we limit the amount of registerable units to 1
  //
  // important note - selection groups are not sorted
  // in such a way that the SelectSubgroup action unit
  // will always be first in the group
  //
  assignPossibleSelectGroup (itemId, objectId1, objectId2) {
    let self = this;
    let doneSearching = false;

    const { selectionIndex, units } = this.selection;

    const knownUnitByObjectIds = this.findUnitByObjectId(objectId1, objectId2);
    if (knownUnitByObjectIds && knownUnitByObjectIds.isRegistered) {
      return null;
    }

    // see if we have a potential matching unit of itemId1-2
    // pair _without_ an object1-2 pair.

    const potentialUnregisteredSelectionUnits = units.filter(selectionUnit => {
      const { itemId1, itemId2 } = selectionUnit;
      const unit = self.findUnit(itemId1, itemId2);

      if (!unit) {
        return false;
      }

      return unit.itemId === itemId &&
        unit.objectId1 === null &&
        unit.objectId2 === null;
    });

    if (potentialUnregisteredSelectionUnits.length === 1) {
      const potentialUnit = potentialUnregisteredSelectionUnits[0];
      const punit = this.findUnit(potentialUnit.itemId1, potentialUnit.itemId2);

      if (punit) {
        //
        // we found a potential unit, check backfill + register itemId1-2 pair
        //
        const { itemId1, itemId2 } = potentialUnit;
        const backfillData = this.possibleSelectList.find(psUnit => {
          return utils.isEqualItemId(psUnit, potentialUnit);
        });

        if (backfillData) {
          punit.performBackfill(backfillData.backfill); 
        }
        
        punit.registerItemIds(itemId1, itemId2);
        self.unregisteredUnitCount--;

        // return back our found unit
        return punit;
      }
    }
    
    let foundPlayerUnit;
    const selectionUnit = units[selectionIndex];

    // remove already known units from possible list
    this.clearKnownPossibleUnits();

    //
    // find an unregistered unit in the possibleSelectList that
    // matches the itemId1-2 pair of our selectionUnit,
    //
    self.possibleSelectList.find(selectItem => {
      if (utils.isEqualUnitItemId(selectItem, selectionUnit)) {
        foundPlayerUnit = self.units.find(playerUnit => {
          return playerUnit.itemId === itemId && // same unit as selection
                 playerUnit.itemId1 === null;
        });

        if (foundPlayerUnit) {
          const { itemId1, itemId2, backfill } = selectItem;

          // make sure we don't already know about this unit
          if (this.findUnit(itemId1, itemId2)) {
            // reset our search results
            foundPlayerUnit = null;
            return false;
          }
          
          // we found a unit to register, check backfill
          foundPlayerUnit.performBackfill(backfill);
          foundPlayerUnit.registerItemIds(itemId1, itemId2);

          // end our search
          return true;
        }
      }

      // keep searching
      return false;
    });

    return foundPlayerUnit || null;
  }

  //
  // perform initial checks in selectSubgroup action
  // to see if we should early out before handling it
  // due to tavern, shop, or other player unit checks
  //
  checkForSelectSubgroupEarlyExit (action) {
    const self = this;
    const { itemId, objectId1, objectId2 } = action;
    const fixedItemId = utils.fixItemId(itemId);

    // special tavern edge case
    if (Building.isTavern(fixedItemId)) {
      console.logger("found tavern!");
      this.tavernSelected = true;
      this.selection.clearGroup();

      return true; // do nothing for neutral building
    } else if (this.tavernSelected) {
      this.tavernSelected = false;
    }

    // Neutral shop / hire-building selection. ngad and nmer fall into BOTH
    // buckets — same focusUnit dispatches item buys (CancelTrainOrResearch
    // bytecode path in Building.js) AND mercenary hires (next subgroup is
    // a non-player-race unit). We set both flags so either action routes
    // correctly. Also update `this.neutralShop` so getNeutralShop() can
    // resolve the building during buy dispatch — previously this object
    // was initialised at construction and never updated, which silently
    // dropped every neutral shop purchase. Player shops (utom/ovln/eden/
    // hvlt) deliberately NEVER set neutralShopSelected — they own the
    // focusUnit themselves and need the standard dispatch path.
    const isNeutralItemShop = Building.isNeutralItemShop(fixedItemId);
    const isHireBldg = Building.isNeutralHireBuilding(fixedItemId);
    if (isNeutralItemShop || isHireBldg) {
      if (isNeutralItemShop) {
        this.neutralShopSelected = true;
        this.neutralShop = { itemId: fixedItemId, objectId1, objectId2 };
      } else if (this.neutralShopSelected) {
        // We've moved to a hire-only building (nmrk merc camp etc.) — drop
        // the shop flag so subsequent buy actions don't try to resolve it.
        this.neutralShopSelected = false;
      }
      if (isHireBldg) {
        this.neutralHireBuildingSelected = true;
        this.neutralHireBuilding = { itemId: fixedItemId, objectId1, objectId2 };
      }
      this.selection.clearGroup();
      this.world.addNeutralShop(fixedItemId, objectId1, objectId2);
      if (isHireBldg) {
        console.logger(this.id, `Selected neutral hire building: ${fixedItemId}`);
      }
      return true;
    } else if (this.neutralShopSelected) {
      this.neutralShopSelected = false;
    }

    // When a neutral hire building was selected and next subgroup is a non-player-race unit,
    // this is the hired mercenary appearing in the player's control.
    // Keep the flag alive through intermediate player-race selections (e.g., DK selected between
    // clicking merc camp and the hired merc appearing).
    if (this.neutralHireBuildingSelected) {
      if (!this.isPlayersRace(fixedItemId) && !this.findUnitByItemId(fixedItemId)) {
        const unitInfo = mappings.getUnitInfo(fixedItemId);
        if ((unitInfo.isUnit || unitInfo.isKnownId) && !unitInfo.isBuilding) {
          const newUnit = new Unit(this.eventTimer, null, null, fixedItemId, false);
          newUnit.registerObjectIds(objectId1, objectId2);
          newUnit.isMercenary = true;

          // Set spawn position at the neutral building location
          const shopRef = this.neutralHireBuilding;
          let shopUnit = this.world.findNeutralByObjectIds(shopRef.objectId1, shopRef.objectId2);
          if (!shopUnit) {
            // Neutral building might not have objectIds registered yet — find by itemId + proximity
            const neutralPlayer = this.world.playerData[mappings.NEUTRAL_PLAYER_ID];
            if (neutralPlayer) {
              shopUnit = neutralPlayer.units.find(u => u.itemId === shopRef.itemId && u.currentX);
            }
          }
          if (shopUnit && shopUnit.currentX !== undefined) {
            newUnit.setSpawnPosition(shopUnit.currentX, shopUnit.currentY);
          }

          this.addPlayerUnit(newUnit);
          this.unregisteredUnitCount++;

          const buildingName = NEUTRAL_HIRE_BUILDINGS[this.neutralHireBuilding.itemId] || 'Neutral Building';
          console.logger(this.id, `Hired mercenary ${newUnit.displayName} from ${buildingName}`);

          this.addEvent('hireMercenary', {
            unit: newUnit.exportUnitReference(),
            building: buildingName,
            buildingItemId: this.neutralHireBuilding.itemId,
            goldCost: (unitInfo.balanceInfo && unitInfo.balanceInfo.goldCost) || 0,
            lumberCost: (unitInfo.balanceInfo && unitInfo.balanceInfo.lumberCost) || 0
          });

          this.neutralHireBuildingSelected = false;
          // Don't early exit — let selectSubgroup process the unit normally
          // so it gets into the selection and can receive commands
        } else {
          // Non-unit, non-player-race selection after merc camp — reset
          this.neutralHireBuildingSelected = false;
        }
      }
      // If isPlayersRace or findUnitByItemId matched, keep the flag alive
      // (player is selecting their own units while merc is being trained)
    }

    if (this.world.findKnownUnitByItemAndObjectId(
      this.id,
      fixedItemId,
      objectId1,
      objectId2)
    ) {

      // clicked on another players unit, return out
      return true;
    }

    if (!this.isPlayersRace(fixedItemId) &&
        !this.findUnitByItemId(fixedItemId) &&
        !this.tavernSelected &&
        !this.neutralHireBuildingSelected) {

      // player clicked on a unit from a race not their own,
      // exit out

      return true;
    }

    return false;
  }

  //
  // ActionBlock method
  // select or deselect a subgroup. registers units when possible.
  //
  // method performs additional side-effects:
  //  * toggle tavern / neutral shop flag
  //  * re-initialize players of Random race after detection

  selectSubgroup (action) {
    const self = this;
    const { itemId, objectId1, objectId2 } = action;
    const fixedItemId = utils.fixItemId(itemId);

    // check if we haven't detected a random players race yet
    if (this.race === "R") {
      const raceChar = fixedItemId.substring(0, 1).toUpperCase();
      const validRaces = ['H', 'O', 'E', 'U'];

      if (validRaces.includes(raceChar)) {
        console.logger("detected a random race for player:", this.playerId, this.race);
        this.race = raceChar;
        console.logger(`random race detected, setting to ${this.race}`);

        // redo the initial setup
        this.setupInitialUnits();
      }
    }

    const shouldEarlyExit = this.checkForSelectSubgroupEarlyExit(action);
    if (shouldEarlyExit) {
      console.logger("early exited from select subGroup");
      return;
    }

    // Detect transport unloads: if a unit in a transport's cargo gets selected, it was unloaded
    const selectedUnit = this.findUnitByObjectId(objectId1, objectId2);
    if (selectedUnit && selectedUnit.loadedInto) {
      const transport = this.units.find(u => u.uuid === selectedUnit.loadedInto);
      if (transport) {
        transport.cargo = transport.cargo.filter(id => id !== selectedUnit.uuid);
        selectedUnit.loadedInto = null;
        selectedUnit.currentX = transport.currentX;
        selectedUnit.currentY = transport.currentY;
        // Re-enter the world at the transport's position.
        if (this.world.collisionWorld) {
          this.world.collisionWorld.addUnit(selectedUnit);
        }
        selectedUnit.recordPosition(true);

        const gameTime = this.eventTimer.timer.gameTime;
        transport.loadEvents.push({
          gameTime,
          action: 'unload',
          unitId: selectedUnit.uuid,
          unitName: selectedUnit.displayName,
          unitItemId: selectedUnit.itemId
        });

        console.logger(this.id, `${selectedUnit.displayName} unloaded from ${transport.displayName} (selection detected)`);

        this.addEvent('transportUnload', {
          transport: transport.exportUnitReference(),
          passenger: selectedUnit.exportUnitReference()
        });
      }
    }

    let firstGroupItem = this.selection.units[0];
    if (!firstGroupItem) {
      const focusUnit = this.findUnitByObjectId(objectId1, objectId2);

      if (focusUnit) {
        // do a kind of hacky thing - 
        // where we detect that our selection group was empty,
        // but we found a unit registered with the objectId1-2 pair.
        // switch to that focus unit artifically

        this.reduceParseConfidence('Minor');

        console.logger("WARNING - swapping selection for found focus unit: ", focusUnit.displayName);
        this.selection.clearGroup();
        this.selection.addUnit(focusUnit.itemId1, focusUnit.itemId2);
        firstGroupItem = this.selection.units[0];
      }
    }

    if (!firstGroupItem) {
      console.logger("WARNING - Player.selectSubgroup: unable to find firstGroupItem");
      this.printSelectionUnits();
      this.printUnits();

      // for some reason there was no unit in the selection unit list
      // mark a Major parse confidence reduction.

      this.reduceParseConfidence('Major');
      return;
    }

    const {itemId1, itemId2} = firstGroupItem;

    const { numberUnits, units } = this.selection;
    const unknownUnits = units.filter(unit => {
      const { itemId1, itemId2 } = unit;
      return !this.findUnit(itemId1, itemId2);
    });
    
    // run assignPossibleSelectGroup and see if we've got a fresh registered unit
    const newlyRegisteredUnit = this.assignPossibleSelectGroup(fixedItemId, objectId1, objectId2);  
    
    // see if we have a known unit for the first selection item
    const firstGroupUnit = this.findUnit(itemId1, itemId2);
    // see if we have a known unit for the action objectId1-2 pair
    const knownUnitByObjectIds = this.findUnitByObjectId(objectId1, objectId2);

    // precondition for an early exit: first unit is equal to by objectId-12 of action
    if (firstGroupUnit && 
        knownUnitByObjectIds &&
        firstGroupUnit.uuid === knownUnitByObjectIds.uuid) {
      
      // see if this known unit has evolved, upgraded, or morphed
      if (fixedItemId !== firstGroupUnit.itemId) {
        // update the units itemId reference since we're confident about it
        firstGroupUnit.itemId = fixedItemId;

        // detect tier upgrades via selection (W3C replays lack action 0x10)
        // only fire if tier hasn't already been detected by the normal path
        const buildTiers = tierBuildings[this.race];
        if (buildTiers) {
          const tierPos = buildTiers.indexOf(fixedItemId);
          if (tierPos > -1 && this.tier < tierPos + 2) {
            this.upgradeTier(fixedItemId);
          }
        }
      }

      // we're confident our selected unit is the first in the group
      this.selection.setSelectionIndex(0);
      return;
    }

    // could not find registered unit by itemId1-2
    // we didn't register any new units from possible select group
    if (!firstGroupUnit && !knownUnitByObjectIds && !newlyRegisteredUnit) {
      PlayerActions.selectSubGroupWithNoKnowns(
        this,
        fixedItemId,
        itemId1,
        itemId2,
        objectId1,
        objectId2
      );
    } else {
      
      // see if we missed the unit because it was a building that upgraded
      const hasBuildingUpgrade = firstGroupUnit && buildingUpgrades[firstGroupUnit.itemId];
      const upgradeMatches = hasBuildingUpgrade && (
        Array.isArray(hasBuildingUpgrade)
          ? hasBuildingUpgrade.includes(fixedItemId)
          : hasBuildingUpgrade === fixedItemId
      );
      if (upgradeMatches) {
        firstGroupUnit.itemId = fixedItemId;

        // detect tier upgrades via selection (W3C replays lack action 0x10)
        // only fire if tier hasn't already been detected by the normal path
        const buildTiers = tierBuildings[this.race];
        if (buildTiers) {
          const tierPos = buildTiers.indexOf(fixedItemId);
          if (tierPos > -1 && this.tier < tierPos + 2) {
            this.upgradeTier(fixedItemId);
          }
        }
        return;
      }

      const notSameFirstUnitCheck = firstGroupUnit && fixedItemId !== firstGroupUnit.itemId;
      const objectMismatchCheck = firstGroupUnit && firstGroupUnit.objectId1 &&
        (firstGroupUnit.objectId1 !== objectId1 || firstGroupUnit.objectId2 !== objectId2) &&
        (firstGroupUnit.objectId1 !== null);

      // checks if the unit object is in our selection group
      const objectInGroup = !firstGroupUnit && this.selection.units.find(sUnit => {
        return self.findUnit(sUnit.itemId1, sUnit.itemId2);
      });

      // some units can 'evolve' - changing their `itemId` property
      // e.g peasant <-> militia
      const unitHasEvolution = firstGroupUnit && firstGroupUnit.evolution &&
        firstGroupUnit.evolution.itemId === fixedItemId;

      // track militia state changes for worker assignment
      if (unitHasEvolution && firstGroupUnit) {
        if (firstGroupUnit.itemId === 'hpea' && fixedItemId === 'hmil') {
          this._traceTask(firstGroupUnit, WorkerTask.MILITIA, 'militia');
          firstGroupUnit.currentTask = WorkerTask.MILITIA;
        } else if (firstGroupUnit.itemId === 'hmil' && fixedItemId === 'hpea') {
          this._traceTask(firstGroupUnit, firstGroupUnit.primaryRole || WorkerTask.GOLD, 'militiaRevert');
          firstGroupUnit.currentTask = firstGroupUnit.primaryRole || WorkerTask.GOLD;
        }
      }

      if (knownUnitByObjectIds || (!unitHasEvolution &&
        (notSameFirstUnitCheck || objectMismatchCheck || objectInGroup))
      ) {

        if (knownUnitByObjectIds && !knownUnitByObjectIds.meta.hero) {
          if (knownUnitByObjectIds.itemId1 !== null && 
             !utils.isUnitInList(this.selection.units, knownUnitByObjectIds)) {
            if (utils.isUnitInList(this.possiblyDeadUnits, knownUnitByObjectIds)) {
              //
              // we have a known unit by this objectId1-2 pair but for whatever
              // reason that unit's itemId1-2 pair isn't in our current selection.
              // if that unit lands in our possibleDeadUnit list, unregister them
              // and mark a Major confidence reduction
              //
              this.reduceParseConfidence('Major');

              console.logger("WARNING - unregistering unit due to possiblyDeadUnits hit.");
              knownUnitByObjectIds.printUnit();

              knownUnitByObjectIds.unregisterObjectIds();
              knownUnitByObjectIds.unregisterItemIds();
            } else {
              if (this.selection.units.length === 1) {
                //
                // we have a known unit by this objectId1-2 pair but for whatever
                // reason that unit's itemId1-2 pair isn't in our current selection.
                // because we only have one thing in the selection, we're pretty sure
                // this unit was registered incorrectly so unregister
                // and mark a Major confidence reduction
                //
                
                this.reduceParseConfidence('Major');

                console.logger("WARNING - unregistering unit due to possiblyDeadUnits hit.");
                knownUnitByObjectIds.printUnit();

                knownUnitByObjectIds.unregisterObjectIds();
                knownUnitByObjectIds.unregisterItemIds();
              }
            }
          }
        }

        // perform a tab-switch
        PlayerActions.registerTabSwitch(
          this,
          firstGroupUnit,
          newlyRegisteredUnit,
          fixedItemId,
          itemId1, // the itemId1-2 of the first unit in the selection
          itemId2,
          objectId1,
          objectId2
        );

        return;
      }

      // did not tab switch units - move on to registering our focus unit
      PlayerActions.registerSubGroupFocusUnit(
        this,
        firstGroupUnit,
        fixedItemId,
        itemId1, 
        itemId2,
        objectId1,
        objectId2
      );
        
    }
  }

  //
  // ActionBlock method
  // change selection has two modes: select and deselect
  // besides handling those actions in our SubGroup selection,
  // we also detect "same-block updates", which can be used
  // to make assumptions about the selection unit state
  //

  changeSelection (action) {
    const self = this;
    const subActions = action.actions;
    const selectMode = action.selectMode;
    const numberUnits = action.numberUnits;

    // check if changeSelection occurs at same game time
    let sameChangeBlock = false;
    const { gameTime } = this.eventTimer.timer;

    if (!this.lastChangeGroupTime) {
      // last change time hasn't been set, not same block
      this.lastChangeGroupTime = gameTime;
      sameChangeBlock = false;
    } else {
      // check if we've done a "same-block" update and update our time ref
      sameChangeBlock = (this.lastChangeGroupTime === gameTime);
      this.lastChangeGroupTime = gameTime;
    }

    let hasUnregisteredUnitFlag = false;
    let subGroup = new SubGroup(numberUnits, subActions);

    if (selectMode === SelectModes.deselect) {
      // de-selected unit — guard the case where a deselect arrives before
      // the player has ever made a selection (this.selection still null)
      if (this.selection) {
        this.selection.deselect(subGroup);
      }

      return;
    }

    if (sameChangeBlock && this.selection &&
        this.selection.units.length > 0) {
      // check if there are unknown units in our selection
      const unknownSelectionUnits = this.getUnknownSelectionUnits();
      if (unknownSelectionUnits.length) {
        // we found unknown units in our same-block selection, clear out
        // those bad units and mark a tiny confidence reduction

        let badSubGroup = new SubGroup(unknownSelectionUnits.length, unknownSelectionUnits);
        this.selection.deselect(badSubGroup);

        this.reduceParseConfidence('Tiny');
      }
    }

    // register first-time selected units
    subActions.forEach(subAction => {
      const {itemId1, itemId2} = subAction;
      let unit = self.findUnit(itemId1, itemId2);
      
      if (unit) {
        // already known unit
        unit.setAliveFlags();
        return;
      }
      
      if (self.world.findPossibleUnitByItemIds(self.id, itemId1, itemId2)) {
        // unit owned by other player
        return;
      }

      const inPossibleList = self.possibleSelectList.find(punit => {
        return utils.isEqualUnitItemId(punit, {
          itemId1: itemId1,
          itemId2: itemId2
        });
      });

      if (!utils.isUnitInList(self.possibleSelectList, { itemId1, itemId2 })) {
        // unit is currently unknown, add it to our possibleSelectList
        const newPossibleUnit = {
          itemId1: itemId1,
          itemId2: itemId2,
          spawnTime: self.eventTimer.timer.gameTime,
          backfill: []
        };

        self.possibleSelectList.push(newPossibleUnit);
        self.world.addPlayerPossibleUnit(self.id, newPossibleUnit);
      }

      hasUnregisteredUnitFlag = true;
    });

    if (this.selection === null || (!sameChangeBlock && selectMode === SelectModes.select)) {
      // first selection, or new selection replaces old (selectMode=1)
      this.selection = subGroup;
    } else {
      // same-block continuation (large selections split across multiple actions) — merge
      this.selection.mergeGroups(subGroup);
    }

    if (sameChangeBlock) {
      if (this.selection.units.length !== numberUnits) {
        // change in same block had different number of units than selection
        // there is a chance we've detected some possibly dead units

        this.selection.units.forEach(unit => {
          const inGoodGroup = subGroup.units.find(sunit => {
            return utils.isEqualUnitItemId(sunit, unit);
          });
          
          if (!inGoodGroup &&
              !utils.isUnitInList(this.possiblyDeadUnits, unit)) {
            console.logger("WARNING - adding possibly dead unit:", unit.itemId1, unit.itemId2);
            this.possiblyDeadUnits.push(unit);  
          }
        });
      }
    }

    if (hasUnregisteredUnitFlag) {
      this.selection.hasUnregisteredUnit = true;
    }
  }

  //
  // ActionBlock method
  // use an ability that has no target
  // can be either an 4-item itemId array or a 4-char itemId string
  //
  useAbilityNoTarget (action) {
    const isItemArray = Array.isArray(action.itemId);
    const itemId = isItemArray ?
      action.itemId : utils.fixItemId(action.itemId);
    const {
      abilityFlags,
      unknownA,
      unknownB
    } = action;
    
    const unitInfo = mappings.getUnitInfo(itemId);
    let selectedUnits = this.getSelectionUnits();

    console.logger("running useAbilityNoTarget", unitInfo);

    console.logger("has sel units: ", selectedUnits.length > 0 ? "yes" : "no");

    if (!selectedUnits.length) {
      // no registered units in selection
      if (unitInfo.isBuilding) {
        // we found a building that hasn't been registered yet
        const firstSelectionItem = this.selection.units[0];
        let maybeBuilding = this.findUnregisteredUnitByItemIds(
          firstSelectionItem.itemId1,
          firstSelectionItem.itemId2
        );

        // TODO: might be able to figure out which unit did the action
        //       based on the action it-self.  might also just
        //       log some kind of Unit.actionBacklog to process after they do register?

        this.reduceParseConfidence('Tiny');
      }

      // Neutral-shop buy: when a player selects a Goblin Merchant / Lab /
      // Merchant, `checkForSelectSubgroupEarlyExit` clears the selection
      // group (neutral buildings aren't "owned" by the player), so by the
      // time the buy action arrives `selectedUnits` is empty. Recover the
      // shop building from world.getNeutralShop and dispatch the buy on it
      // directly — without this every ngme / ngad / nmer purchase is
      // silently dropped (previously confirmed: 0 neutral-shop purchases
      // across 40 pro replays in the corpus).
      if (this.world && this.neutralShopSelected && unitInfo.isItem) {
        const shopRef = this.world.getNeutralShop(this.neutralShop);
        if (shopRef && shopRef.itemId) {
          // Reify the actual Building instance from the neutral player's
          // units list so we can dispatch through buyStockItem (the world
          // entry is just a {itemId, objectId1, objectId2} ref).
          let neutralUnit = null;
          if (typeof this.world.findNeutralByObjectIds === 'function') {
            neutralUnit = this.world.findNeutralByObjectIds(
              this.neutralShop.objectId1,
              this.neutralShop.objectId2
            );
          }
          if (!neutralUnit && this.world.playerData) {
            const neutralPlayer = this.world.playerData[mappings.NEUTRAL_PLAYER_ID];
            if (neutralPlayer && Array.isArray(neutralPlayer.units)) {
              neutralUnit = neutralPlayer.units.find(u =>
                u.itemId === this.neutralShop.itemId && u.currentX != null);
            }
          }
          if (neutralUnit) {
            Building.doAbilityNoTargetItemId(
              this,
              neutralUnit,
              itemId,
              abilityFlags,
              unknownA,
              unknownB
            );
            return;
          }
        }
      }

      this.printSelectionUnits();
    }

    if (selectedUnits.length) {
      // registered unit used ability
      const firstUnit = this.getSelectedUnit();
      this.printSelectionUnits();

      if (!firstUnit) {
        // todo: backfill (hero?) action
        console.logger("WARNING - need to backfill action from unreg unit");

        this.reduceParseConfidence('Minor');
        return;
      }

      if (firstUnit.meta.hero) {
        isItemArray ?
          Hero.doAbilityNoTargetItemArray(
            this,
            firstUnit,
            itemId,
            abilityFlags,
            unknownA,
            unknownB
          ) :
          Hero.doAbilityNoTargetItemId(
            this,
            firstUnit,
            itemId,
            abilityFlags,
            unknownA,
            unknownB
          );
      } else if (!firstUnit.isBuilding && isItemArray) {
        // Non-hero unit ability (Bloodlust, Bear Form, Defend, Roar, etc.)
        const spellInfo = lookupSpellFromOrderId(itemId);
        if (spellInfo) {
          if (spellInfo.isFormToggle) {
            this.addEvent('formToggle', {
              unit: firstUnit.exportUnitReference(),
              spellName: spellInfo.displayName,
              spellItemId: spellInfo.abilityId,
              icon: spellInfo.icon,
              state: spellInfo.toggle || 'on',
              isUnitSpell: true
            });
          } else if (spellInfo.toggle) {
            this.handleAutocastToggle(firstUnit, spellInfo);
          } else if (spellInfo.abilityId === 'Udet') {
            // Wisp Detonate: sacrifice the wisp
            firstUnit.sacrificed = true;
            firstUnit.destroyedAt = this.eventTimer.timer.gameTime;
            this.destroyedSummons.push(firstUnit);

            this.addEvent('spellCast', {
              unit: firstUnit.exportUnitReference(),
              spellName: spellInfo.displayName,
              spellItemId: spellInfo.abilityId,
              icon: spellInfo.icon,
              isUnitSpell: true,
              isSacrifice: true
            });

            // Detonate is always combat — emit at the wisp's last known
            // position before we destroy it. hostile because it AoE-purges
            // enemies and pops summons.
            this.recordCombatSignal(firstUnit, {
              kind: SIGNAL_KINDS.SPELL_NO_TARGET,
              targetX: firstUnit.currentX || 0,
              targetY: firstUnit.currentY || 0,
              spellAbilityId: 'Udet',
              hostile: true
            });

            PlayerActions.destroyUnit(this, firstUnit);
          } else {
            this.addEvent('spellCast', {
              unit: firstUnit.exportUnitReference(),
              spellName: spellInfo.displayName,
              spellItemId: spellInfo.abilityId,
              icon: spellInfo.icon,
              isUnitSpell: true
            });

            // Whitelist-gated no-target signal (War Stomp, Roar, etc.).
            if (combatSpellHelpers && combatSpellHelpers.isCombatNoTargetSpell(spellInfo.abilityId)) {
              this.recordCombatSignal(firstUnit, {
                kind: SIGNAL_KINDS.SPELL_NO_TARGET,
                targetX: firstUnit.currentX || 0,
                targetY: firstUnit.currentY || 0,
                spellAbilityId: spellInfo.abilityId,
                hostile: true
              });
            }
          }
        }
      }

      if (firstUnit.isBuilding || unitInfo.isItem) {
        console.logger("**JDEBUG[build]: first unit is a building, is it an item array? ", isItemArray ? "yes" : "no");

        isItemArray ?
          Building.doAbilityNoTargetItemArray(
            this,
            firstUnit,
            itemId,
            abilityFlags,
            unknownA,
            unknownB
          ) :
          Building.doAbilityNoTargetItemId(
            this,
            firstUnit,
            itemId,
            abilityFlags,
            unknownA,
            unknownB
          );
      }

      return;
    }

    console.logger("**JDEBUG[build]: at ability flags: ", abilityFlags);
    console.logger("is tav sel: ", this.tavernSelected);
    
    switch (abilityFlags) {
      // learn skill
      case abilityFlagNames.Summon:
        if (this.tavernSelected) {
          let newTavernHero = new Unit(this.eventTimer, null, null, itemId, false);
          this.setHeroSlot(newTavernHero);

          console.logger(this.id, "Creating tavern hero: ", unitInfo.displayName);
          this.addPlayerUnit(newTavernHero, true);
          this.unregisteredUnitCount++;

          // tavern heroes spawn at the player's base
          if (this.startingPosition) {
            newTavernHero.setSpawnPosition(this.startingPosition.x, this.startingPosition.y);
          }

          this.addEvent('makeTavernHero', {
            unit: newTavernHero.exportUnitReference(),
            building: 'Tavern',
            goldCost: (unitInfo.balanceInfo && unitInfo.balanceInfo.goldCost) || 0
          });

          this.tavernSelected = false;
        }
      break;

      default:
        console.logger("WARNING: no ability found");
        this.reduceParseConfidence('Tiny');
      break;
    }
  } 

  useAbilityWithTargetAndObjectId (action) {
    const isItemArray = Array.isArray(action.itemId);
    const { 
      targetX, 
      targetY,
      objectId1,
      objectId2
    } = action;

    let units = this.getSelectionUnits();
    const firstUnit = this.getSelectedUnit();

    console.logger("ability selection");
    this.printSelectionUnits();

    if (!firstUnit) {
      console.logger("WARNING - no first unit in UseAbilityWithTargetAndObjectId");
      
      this.reduceParseConfidence('Major');
      return;
    }

    const abilityActionName = utils.findItemIdForObject(action.itemId, abilityActions);

    // look up spell from order ID bytes
    const spellInfo = Array.isArray(action.itemId) ? lookupSpellFromOrderId(action.itemId) : null;

    switch (abilityActionName) {
      // Targeted item-slot use (action 0x12 dispatches as HeroItemN, because
      // the slot's order-id bytes collide with the legacy 'TeleportScroll'
      // map entry — findItemIdForObject iterates insertion order and
      // 'HeroItem1' wins). All targeted item uses funnel here; we identify
      // the actual item by inspecting the hero's inventory slot.
      //
      // We recognise EVERY teleport item registered in teleportAbilities:
      //   - stwp Scroll of Town Portal → group teleport to allied building
      //   - stel Staff of Teleportation → single-unit, target unit or ground
      //   - spre Staff of Preservation → single friendly unit → nearest TH
      //   - ssan Staff of Sanctuary → single friendly unit → nearest TH
      // The registry's `category` field drives the client visual (group TP
      // vs single-unit). Other targeted items (Dust of Appearance etc.) fall
      // through silently — Hero.doAbilityNoTargetItemArray already emits
      // itemUse for the no-target path.
      case 'HeroItem1':
      case 'HeroItem2':
      case 'HeroItem3':
      case 'HeroItem4':
      case 'HeroItem5':
      case 'HeroItem6': {
        const slot = Number(abilityActionName.slice(-1));
        let heroItem = firstUnit && firstUnit.items && firstUnit.items[slot];
        let tpAbility = heroItem && teleportAbilities && teleportAbilities[heroItem.itemId];

        // Diagnostic for slot-drift investigations (phantom TP detection).
        // Opt-in via `--debug-items`; pair with `--debug-player=N` to scope.
        if (config.debugItemDispatch &&
            (config.debugPlayer == null || String(config.debugPlayer) === String(this.id))) {
          const slotMap = {};
          if (firstUnit && firstUnit.items) {
            for (const k of Object.keys(firstUnit.items)) {
              const it = firstUnit.items[k];
              slotMap[k] = it ? `${it.itemId}(${it.source || '?'})` : null;
            }
          }
          const t = this.eventTimer && this.eventTimer.timer ? this.eventTimer.timer.gameTime : -1;
          console.log(`[itemDispatch] p${this.id} t=${t.toFixed(2)} path=0x12 slot=${slot} ` +
            `items[slot]=${heroItem ? heroItem.itemId : 'null'} target=(${targetX},${targetY}) ` +
            `objectId=(${objectId1},${objectId2}) hero=${firstUnit.displayName} slotMap=${JSON.stringify(slotMap)}`);
        }

        // Resolve the targeted unit/building from the action's objectIds first
        // — we need it both for routing the destination AND for disambiguating
        // the actual item when slot tracking has drifted.
        let targetUnit = this.findUnitByObjectId(objectId1, objectId2);
        if (!targetUnit && this.world && this.world.findUnitByObjectIds) {
          targetUnit = (this.world.findUnitByObjectIds(objectId1, objectId2) || {}).unit;
        }

        // Slot drift correction. The first hero is auto-given a stwp; if the
        // player later buys a Staff of Teleportation from a Goblin Lab and
        // the rebuy wasn't tracked (Phase 1 caught most cases but some can
        // still slip — selection-clear races, abnormal map shop stocks),
        // the slot still claims stwp. But Scroll of Town Portal can ONLY
        // target friendly town halls — any other target proves the slot is
        // lying. We route through HeroInventory.reclassify which emits a
        // synthetic itemPurchase tagged [INFERRED] so the BO panel shows
        // the implied buy at the use timestamp instead of leaving the user
        // wondering where the item came from.
        if (tpAbility && tpAbility.code === 'stwp') {
          const targetItemId = targetUnit && targetUnit.itemId;
          const isTownHallTarget = targetItemId && TOWN_HALL_IDS[targetItemId];
          if (!isTownHallTarget) {
            tpAbility = teleportAbilities['stel'];
            HeroInventory.reclassify(this, firstUnit, slot, 'stel', {
              reason: 'target-not-town-hall',
              actionText: `${firstUnit.displayName} appears to have a Staff of Teleportation (slot claimed Scroll of Town Portal but target wasn't a town hall)`,
              confidence: 'low'
            });
            heroItem = firstUnit.items[slot];
          }
        }

        if (heroItem && tpAbility) {
          // Resolve destination per ability category. stwp / AHmt-style
          // abilities target the building's exact position; stel can target
          // a unit OR ground (use whichever resolves); spre/ssan target a
          // friendly unit but teleport it to the nearest own town hall.
          let destX = targetX;
          let destY = targetY;
          let destBuilding = null;
          if (tpAbility.targetType === 'allied-building' && targetUnit) {
            destX = targetUnit.currentX;
            destY = targetUnit.currentY;
            destBuilding = targetUnit;
          } else if (tpAbility.category === 'single-unit' &&
                     (tpAbility.code === 'spre' || tpAbility.code === 'ssan')) {
            // Send-home staffs always resolve to the nearest own town hall.
            const homeTH = _findHomeTownHall(this, firstUnit);
            if (homeTH) {
              destX = homeTH.currentX;
              destY = homeTH.currentY;
              destBuilding = homeTH;
            }
          } else if (targetUnit && targetUnit.currentX != null) {
            destX = targetUnit.currentX;
            destY = targetUnit.currentY;
          }

          // Emit the legacy 'teleportScroll' event for stwp only (battle
          // banner + downstream code keys off it). Other teleport items use
          // the structured 'teleport' record produced by _applyTeleport plus
          // a generic 'teleportItem' marker so the BO panel can render the
          // single-unit teleport row with its own icon + label.
          if (tpAbility.code === 'stwp') {
            this.addEvent('teleportScroll', { unit: firstUnit.exportUnitReference() });
          } else {
            this.addEvent('teleportItem', {
              unit: firstUnit.exportUnitReference(),
              abilityCode: tpAbility.code,
              abilityDisplayName: tpAbility.displayName,
              category: tpAbility.category
            });
          }
          this.addEvent('itemUse', {
            item: {
              displayName: tpAbility.displayName,
              itemId: tpAbility.code,
              knownItemId: tpAbility.code
            },
            unit: firstUnit.exportUnitReference(),
            usesLeft: heroItem.expires ? (heroItem.usesLeft - 1) : null,
            category: 'consumable'
          });

          this._applyTeleport(tpAbility, firstUnit, destX, destY, destBuilding, {
            source: heroItem.source || null,
            slot,
            actionPath: '0x12'
          });

          // Decrement charges + clear exhausted slot through the inventory
          // ledger. Phase 1 tracks neutral-shop rebuys (Goblin Merchant /
          // Lab / Merchant), so the original justification for leaving the
          // slot untouched no longer applies — a follow-up teleport will
          // find the correctly-tracked replacement item in the slot
          // (whether explicit purchase or HeroInventory.reclassify backfill).
          HeroInventory.decrementCharges(this, firstUnit, slot);
        } else if (heroItem) {
          // Non-teleport targeted item (Dust of Appearance, Sentry Ward,
          // targeted Healing Salve, Goblin Land Mines, etc.). Previously
          // these fell through silently — now we emit itemUse + decrement
          // charges so battles can show a "💊 Dust" chip and the BO panel
          // can render the use row.
          const itemData = itemAbilityData[heroItem.itemId];
          const category = itemData ? (itemData.category || itemData.type || 'unknown') : 'unknown';
          this.addEvent('itemUse', {
            item: heroItem.exportItemReference(),
            unit: firstUnit.exportUnitReference(),
            usesLeft: heroItem.expires ? (heroItem.usesLeft - 1) : null,
            category,
            targetPosition: { x: targetX, y: targetY },
            targetUnit: targetUnit ? targetUnit.exportUnitReference() : null
          });
          HeroInventory.decrementCharges(this, firstUnit, slot);
        } else {
          // Slot empty in our model — emit an honest use-no-slot record.
          //
          // Why we don't backfill blindly: WC3's per-shop slot layout
          // doesn't match getNextItemSlot()'s lowest-empty-first heuristic
          // (per targeted-items.w3g — user bought hslv/plcl/shas and the
          // game placed them in a different slot order than the parser
          // assumed). Combined with untracked creep-drop pickups (slot 5/6
          // items "appear" with no action stream visibility), aggressive
          // backfill mis-attributes early use-no-slot events to items the
          // hero hasn't actually consumed yet, then has nothing left when
          // the real use fires. Honest "Unknown consumable" is better than
          // confident-wrong attribution. The validator's
          // ITEM_USES_EXCEED_PURCHASES warning surfaces these gaps.
          this.addEvent('itemUse', {
            item: { itemId: null, displayName: 'Unknown consumable', knownItemId: null },
            unit: firstUnit.exportUnitReference(),
            usesLeft: null,
            category: 'unknown',
            confidence: 'low',
            source: 'use-no-slot',
            targetPosition: { x: targetX, y: targetY },
            targetUnit: targetUnit ? targetUnit.exportUnitReference() : null
          });
          this.reduceParseConfidence('Tiny');
        }
      } break;
      case 'EatTree':
        console.logger("NE Building eating a tree"); // yum
        this.addEvent('buildingAbility', { ability: 'EatTree', unit: firstUnit.exportUnitReference() });
      break;
      case 'UnsummonBuilding':
        console.logger("Detected building unsummon");
        let possibleBuilding = utils.closestToPoint(targetX, targetY, this.units, (unit) => {
          return unit.isBuilding;
        });

        if (possibleBuilding) {
          console.logger("Found building to unsummon: ", possibleBuilding.displayName);

          this.removePlayerBuilding(possibleBuilding);
          this.addEvent('buildingAbility', { ability: 'unsummon', unit: possibleBuilding.exportUnitReference() });
        } else {
          console.logger("WARNING - unable to find building to unsummon.");
          this.reduceParseConfidence('Major');
        }
      break;
      // hero and unit abilities / skills
      case 'CastSkillTarget':
      case 'CastSkillObject':
      case 'DeathCoil':
        if (firstUnit.meta.hero) {
          PlayerActions.doAbilityWithTargetAndObjectId(
            this,
            firstUnit,
            objectId1,
            objectId2,
            targetX,
            targetY
          );

          this.addEvent('spellCast', {
            unit: firstUnit.exportUnitReference(),
            targetPosition: { x: targetX, y: targetY },
            spellName: spellInfo ? spellInfo.displayName : null,
            spellItemId: spellInfo ? spellInfo.abilityId : null,
            isAutocast: spellInfo ? !!this.autocastState[spellInfo.abilityId] : false
          });

          PlayerActions.moveSelectedUnits(this, targetX, targetY);

          this._emitSpellSignal(firstUnit, spellInfo, objectId1, objectId2, targetX, targetY);

          // Teleport-class hero spell? Mass Teleport (AHmt) targets a friendly
          // building and pulls the hero + non-hero allies within 800u. We
          // route the same way as Scroll of Town Portal — but with NO invuln
          // and cancel-detection on (a stun during the 3s channel stops it).
          if (spellInfo && teleportAbilities && teleportAbilities[spellInfo.abilityId]) {
            const tpAbility = teleportAbilities[spellInfo.abilityId];
            const targetBuilding = this.findUnitByObjectId(objectId1, objectId2)
              || (this.world && this.world.findUnitByObjectIds &&
                  (this.world.findUnitByObjectIds(objectId1, objectId2) || {}).unit);
            const tx = targetBuilding ? targetBuilding.currentX : targetX;
            const ty = targetBuilding ? targetBuilding.currentY : targetY;
            this._applyTeleport(tpAbility, firstUnit, tx, ty, targetBuilding);
          }
        } else if (spellInfo) {
          // Non-hero unit targeted spell (Heal, Polymorph, Purge, etc.)
          this.addEvent('spellCast', {
            unit: firstUnit.exportUnitReference(),
            targetPosition: { x: targetX, y: targetY },
            spellName: spellInfo.displayName,
            spellItemId: spellInfo.abilityId,
            icon: spellInfo.icon,
            isAutocast: !!this.autocastState[spellInfo.abilityId],
            isUnitSpell: true
          });

          PlayerActions.moveSelectedUnits(this, targetX, targetY);

          this._emitSpellSignal(firstUnit, spellInfo, objectId1, objectId2, targetX, targetY);
        }
      break;
      case 'MoveCommand':
        // pure point-move — the unit MUST reach the commanded X/Y (no
        // combat/harvest early-stop). The strict ground-truth metric.
        PlayerActions.moveSelectedUnits(this, targetX, targetY, { kind: 'move' });
      break;
      case 'AttackCommand':
      case 'RightClick':
        // Ground-item pickup via right-click. Confirmed via pick-trade-drop.w3g:
        // right-clicking a dropped item generates action 0x12 with RightClick
        // orderId and target objectId = the item's IDs.
        //
        // We use a two-phase A+B detector:
        //   A — IMMEDIATE: heuristic emission at right-click time. If target
        //       oids look item-like (oid1 !== oid2, signalling "not a
        //       neutral entity" — those use oid1 === oid2 — AND not a known
        //       unit), create a placeholder Item and emit pickupItem with
        //       confidence 'low' + source 'pickup-inferred'. This keeps the
        //       drop/trade/use chain coherent.
        //   B — POST-PARSE: _validateInferredPickups walks the event stream,
        //       checks each pickup-inferred against later drop/trade/sell/use
        //       events on the same oids. Confirmed → upgrade to confidence
        //       'medium'. Unconfirmed → false positive → remove event + clear
        //       placeholder from inventory.
        //
        // Restricted to HEROES — workers right-clicking gold mines etc. would
        // otherwise trip the heuristic.
        const isHeroPickup = firstUnit && firstUnit.meta && firstUnit.meta.hero;
        if (isHeroPickup && this.world &&
            objectId1 !== -1 && objectId2 !== -1) {

          // Path 1 — known dropped item (high confidence).
          const groundItem = this.world.findDroppedItem
            ? this.world.findDroppedItem(objectId1, objectId2)
            : null;
          if (groundItem) {
            HeroInventory.add(this, firstUnit, groundItem, {
              source: 'pickup',
              confidence: 'high',
              knownObjectId: { id1: objectId1, id2: objectId2 }
            });
            if (this.world.removeDroppedItem) {
              this.world.removeDroppedItem(objectId1, objectId2);
            }
            const campDrops = this._resolveCampDropsForPosition(targetX, targetY);
            this.addEvent('pickupItem', {
              item: groundItem.exportItemReference(),
              unit: firstUnit.exportUnitReference(),
              source: 'ground-pickup',
              confidence: 'high',
              actionText: `${firstUnit.displayName} picks up ${groundItem.displayName}`,
              ...(campDrops ? { campUuid: campDrops.campUuid, potentialItems: campDrops.potentialItems } : {})
            });
            PlayerActions.moveSelectedUnits(this, targetX, targetY, { kind: 'move' });
            break;
          }

          // Path 2 — Phase A (DEFERRED): record candidate pickup, do NOT
          // mutate inventory yet. Heroes attack-click creeps and other
          // unregistered units constantly; immediately materialising a
          // placeholder item per click trashes the inventory (a hero
          // attacking a creep camp easily fills all 6 slots with Jwid
          // placeholders, displacing real items). Instead, we buffer the
          // candidate and let Phase B (post-parse _validateInferredPickups)
          // confirm or discard based on whether a later drop/trade/sell
          // event references the same objectIds. Only confirmed candidates
          // get their pickupItem event emitted retroactively.
          const oidsAreEqual = (objectId1 === objectId2);
          let isKnownUnit = false;
          if (!oidsAreEqual) {
            if (this.world.findUnitByObjectIds &&
                this.world.findUnitByObjectIds(objectId1, objectId2)) {
              isKnownUnit = true;
            } else if (this.world.findNeutralByObjectIds &&
                       this.world.findNeutralByObjectIds(objectId1, objectId2)) {
              isKnownUnit = true;
            } else if (this.findUnitByObjectId(objectId1, objectId2)) {
              isKnownUnit = true;
            }
          }
          if (!oidsAreEqual && !isKnownUnit) {
            if (!this._pendingInferredPickups) this._pendingInferredPickups = [];
            this._pendingInferredPickups.push({
              gameTime: this.eventTimer.timer.gameTime,
              heroRef: firstUnit.exportUnitReference(),
              heroUuid: firstUnit.uuid,
              objectId1,
              objectId2,
              targetX,
              targetY
            });
            // Fall through to normal RightClick dispatch — if the click
            // was actually an attack-on-creep, the engagement logic still
            // needs to play out. If it was a pickup, the hero still
            // physically walked to the position; the inventory + event
            // are emitted retroactively in _validateInferredPickups.
          }
        }
        if (firstUnit && firstUnit.isBuilding) {
          Building.doAbilityRightClickWithTargetAndObjectId(
            this,
            firstUnit,
            objectId1,
            objectId2,
            targetX,
            targetY
          );
        } else if (firstUnit) {
          PlayerActions.doAbilityWithTargetAndObjectId(
            this,
            firstUnit,
            objectId1,
            objectId2,
            targetX,
            targetY
          );

          // after doing interaction also move the units. A right-click on
          // EMPTY GROUND is a pure move (must reach the point — strict, and
          // coalesce-eligible: this is the spam-click case in battles). A
          // right-click on a UNIT/object is a smart/attack order where the
          // unit may legitimately stop early (engage) — not coalesced, not
          // counted in strict accuracy.
          const groundClick =
            (objectId1 == null || objectId1 === -1) &&
            (objectId2 == null || objectId2 === -1);
          PlayerActions.moveSelectedUnits(this, targetX, targetY,
            { kind: groundClick ? 'move' : 'attack' });

          // Combat signal emission. A-move/attack-ground is always a combat
          // signal; right-click and attack-on-unit need cross-player target
          // resolution (own/neutral hits are handled by PlayerActions —
          // they're not battle signals).
          if (groundClick && abilityActionName === 'AttackCommand') {
            this.recordCombatSignal(firstUnit, {
              kind: SIGNAL_KINDS.ATTACK_GROUND,
              targetX, targetY,
              hostile: true
            });
          } else if (!groundClick) {
            const enemyHit = this.world.findEnemyByObjectIds(objectId1, objectId2, this.id, this.teamId);
            if (enemyHit) {
              const isBldg = !!(enemyHit.unit && enemyHit.unit.isBuilding);
              let kind;
              if (abilityActionName === 'AttackCommand') {
                kind = SIGNAL_KINDS.ATTACK_UNIT;
              } else {
                kind = isBldg ? SIGNAL_KINDS.RIGHT_CLICK_ENEMY_BLDG
                              : SIGNAL_KINDS.RIGHT_CLICK_ENEMY;
              }
              this.recordCombatSignal(firstUnit, {
                kind,
                targetX, targetY,
                targetPlayerId: enemyHit.ownerPlayerId,
                targetTeamId: enemyHit.ownerTeamId,
                targetUnitUuid: enemyHit.unit && enemyHit.unit.uuid,
                targetIsBuilding: isBldg,
                hostile: true
              });
            }
          }
        } else {
          // made it down here with no action
          this.reduceParseConfidence('Tiny');
        }
        
      break;
      case 'TransportLoadUnit':
      case 'TransportPickUp':
      case 'TransportW3C':
        // Transport load/unload — W3C uses single code, detect by target type
        const isGroundTarget = (objectId1 === 4294967295 || objectId1 === -1) &&
                               (objectId2 === 4294967295 || objectId2 === -1);
        if (isGroundTarget) {
          // Target is ground position — this is an unload
          if (firstUnit && firstUnit.isTransport) {
            this.handleTransportUnload(firstUnit, targetX, targetY);
          }
        } else {
          // Target is a unit — this is a load
          const loadTarget = this.findUnitByObjectId(objectId1, objectId2);
          if (firstUnit && firstUnit.isTransport && loadTarget) {
            this.handleTransportLoad(firstUnit, loadTarget, targetX, targetY);
          } else if (loadTarget && loadTarget.isTransport && firstUnit) {
            this.handleTransportLoad(loadTarget, firstUnit, targetX, targetY);
          } else {
            console.logger("Transport load - couldn't resolve transport/passenger pair");
            this.reduceParseConfidence('Tiny');
          }
        }
      break;
      case 'TransportUnload':
        // Non-W3C explicit unload (position target only, action 0x11)
        if (firstUnit && firstUnit.isTransport) {
          this.handleTransportUnload(firstUnit, targetX, targetY);
        } else {
          console.logger("Transport unload - firstUnit is not a transport");
          this.reduceParseConfidence('Tiny');
        }
      break;
      case 'HeroRevive':
        console.logger("reviving hero!", objectId1, objectId2);
        const targetHero = this.findUnitByObjectId(objectId1, objectId2);

        if (targetHero) {
          console.logger("reviving: ", targetHero.displayName);
          console.logger("at building spot: ", firstUnit.currentX, firstUnit.currentY);
          
          targetHero.printUnit();
          targetHero.reviveAtSpot(this.world, firstUnit.currentX, firstUnit.currentY);

          // hero gets new net tag after revive — clear old IDs so next
          // selection action can re-register with the new net tag
          targetHero.unregisterObjectIds();
          targetHero.unregisterItemIds();

          this.addEvent('heroRevive', { 
            spot: {
              x: firstUnit.currentX,
              y: firstUnit.currentY
            },
            unit: firstUnit.exportUnitReference() 
          });
        }
      break;
      case 'HeroMoveItem1':
      case 'HeroMoveItem2':
      case 'HeroMoveItem3':
      case 'HeroMoveItem4':
      case 'HeroMoveItem5':
      case 'HeroMoveItem6':
        // try to move hero item
        Hero.doMoveItem(
          this,
          firstUnit,
          action.itemId,
          objectId1,
          objectId2,
          targetX,
          targetY
        );
      break;

      case 'Gather':
        // TODO implement if this really is gather
      break;

      default:
        // check if this is a known spell that isn't in abilityActions
        if (spellInfo && firstUnit) {
          if (firstUnit.meta.hero) {
            PlayerActions.doAbilityWithTargetAndObjectId(
              this,
              firstUnit,
              objectId1,
              objectId2,
              targetX,
              targetY
            );

            this.addEvent('spellCast', {
              unit: firstUnit.exportUnitReference(),
              targetPosition: { x: targetX, y: targetY },
              spellName: spellInfo.displayName,
              spellItemId: spellInfo.abilityId,
              isAutocast: !!this.autocastState[spellInfo.abilityId]
            });
          } else {
            // Non-hero unit spell via unrecognized action code
            this.addEvent('spellCast', {
              unit: firstUnit.exportUnitReference(),
              targetPosition: { x: targetX, y: targetY },
              spellName: spellInfo.displayName,
              spellItemId: spellInfo.abilityId,
              icon: spellInfo.icon,
              isAutocast: !!this.autocastState[spellInfo.abilityId],
              isUnitSpell: true
            });
          }

          PlayerActions.moveSelectedUnits(this, targetX, targetY);

          this._emitSpellSignal(firstUnit, spellInfo, objectId1, objectId2, targetX, targetY);
        } else {
          console.logger("WARNING - performed unknown action");

          if (!abilityActionName && action.itemId[1] === 0) {
            console.logger("uk action itemId was: ", abilityActionName, action.itemId);
          }

          this.reduceParseConfidence('Tiny');
        }
      break;
    }
  }

  //
  // ActionBlock method
  // use ability with target position
  // can be a 4-
  //
  useAbilityWithTarget (action) {
    const self = this;
    const { targetX, targetY, itemId } = action;
    const isItemArray = Array.isArray(action.itemId);
    const fixedItemId = utils.fixItemId(itemId);
    const selectionUnits = this.getSelectionUnits();
    
    let firstUnit = this.getSelectedUnit();
    const unitInfo = mappings.getUnitInfo(fixedItemId);

    if (!this.startingPosition) {
      PlayerActions.findStartPosition(this, targetX, targetY);
    }

    if (isItemArray) {
      const abilityActionName = utils.findItemIdForObject(itemId, abilityActions);

      switch (abilityActionName) {
        // Action-0x11 HeroItem path: ground-targeted inventory item use.
        // Sentry Wards, Goblin Land Mines, Healing Salve cast on ground, etc.
        // Pre-fix this case did not exist — the action fell through to the
        // `default` spellInfoTarget lookup which fails for items, dropping
        // every ground-target item use. Now emits `itemUse` + decrements
        // charges through the same HeroInventory ledger as the targeted
        // unit path in useAbilityWithTargetAndObjectId.
        case 'HeroItem1':
        case 'HeroItem2':
        case 'HeroItem3':
        case 'HeroItem4':
        case 'HeroItem5':
        case 'HeroItem6': {
          const slot = Number(abilityActionName.slice(-1));
          const heroItem = firstUnit && firstUnit.items && firstUnit.items[slot];
          if (heroItem) {
            const itemData = mappings.itemAbilityData[heroItem.itemId];
            const category = itemData
              ? (itemData.category || itemData.type || 'unknown')
              : 'unknown';
            this.addEvent('itemUse', {
              item: heroItem.exportItemReference(),
              unit: firstUnit.exportUnitReference(),
              usesLeft: heroItem.expires ? (heroItem.usesLeft - 1) : null,
              category,
              targetPosition: { x: targetX, y: targetY }
            });
            HeroInventory.decrementCharges(this, firstUnit, slot);
          } else {
            // Slot empty — emit honest use-no-slot record. See the 0x12
            // path comment for why we deliberately don't backfill here.
            this.addEvent('itemUse', {
              item: { itemId: null, displayName: 'Unknown consumable', knownItemId: null },
              unit: firstUnit.exportUnitReference(),
              usesLeft: null,
              category: 'unknown',
              confidence: 'low',
              source: 'use-no-slot',
              targetPosition: { x: targetX, y: targetY }
            });
            this.reduceParseConfidence('Tiny');
          }
        } break;

        case 'NERoot': {
          console.logger("building rooted.");
          const gameTime = this.eventTimer.timer.gameTime;
          const ancients = (selectionUnits || []).filter(u =>
            u && u.isBuilding && u.isUprooted
          );
          const targets = ancients.length ? ancients : (firstUnit && firstUnit.isBuilding && firstUnit.isUprooted ? [firstUnit] : []);
          targets.forEach(unit => {
            unit.currentX = targetX;
            unit.currentY = targetY;
            unit.isUprooted = false;
            unit.recordPosition();
            unit.uprootStream.push({
              gameTime,
              isUprooted: false,
              x: targetX,
              y: targetY
            });
            this.addEvent('root', {
              building: unit.exportUnitReference()
            });
          });
        }
        break;

        case 'SummonTreants':
          // todo: add to event log
          console.logger("summon treant detected");
          Hero.castSummon(this, firstUnit);
        break;

        case 'TransportUnload':
        case 'TransportW3C':
          if (firstUnit && firstUnit.isTransport) {
            this.handleTransportUnload(firstUnit, targetX, targetY);
          } else {
            console.logger("Transport unload - firstUnit is not a transport");
            this.reduceParseConfidence('Tiny');
          }
        break;

        default:
          const spellInfoTarget = lookupSpellFromOrderId(itemId);
          const abilityMeta = spellInfoTarget && mappings.unitAbilities[spellInfoTarget.abilityId];
          const isNeutralBuildingAbility = !!(abilityMeta && abilityMeta.isNeutralBuildingAbility);

          // Neutral-building paid abilities (Goblin Lab Reveal etc.) cast
          // with NO selected unit — selecting a neutral shop clears the
          // selection group (see checkForSelectSubgroupEarlyExit), so by
          // the time the action lands `firstUnit` is undefined. Look up
          // the building from the neutral-shop ref and emit the event
          // attributed to it. Without this, every Reveal silently drops.
          if (isNeutralBuildingAbility && !firstUnit && this.neutralShopSelected && this.world) {
            const shopRef = this.world.getNeutralShop(this.neutralShop);
            if (shopRef) {
              let bldg = null;
              if (this.world.findNeutralByObjectIds) {
                bldg = this.world.findNeutralByObjectIds(shopRef.objectId1, shopRef.objectId2);
              }
              if (!bldg && this.world.playerData) {
                const np = this.world.playerData[mappings.NEUTRAL_PLAYER_ID];
                if (np && Array.isArray(np.units)) {
                  bldg = np.units.find(u =>
                    u.itemId === shopRef.itemId && u.currentX != null);
                }
              }
              if (bldg) {
                this.addEvent('neutralAbility', {
                  ability: spellInfoTarget.abilityId,
                  displayName: spellInfoTarget.displayName,
                  icon: spellInfoTarget.icon,
                  building: bldg.displayName,
                  buildingItemId: bldg.itemId,
                  targetPosition: { x: targetX, y: targetY }
                });
                return;
              }
            }
          }

          if (spellInfoTarget && firstUnit) {
            if (spellInfoTarget.toggle) {
              this.handleAutocastToggle(firstUnit, spellInfoTarget);
            } else if (isNeutralBuildingAbility) {
              // Neutral-building paid abilities (Goblin Lab Reveal etc.) —
              // semantically distinct from a hero/unit spell cast. Emit
              // `neutralAbility` when the focusUnit is the selected
              // neutral building (selection survived for some reason).
              this.addEvent('neutralAbility', {
                ability: spellInfoTarget.abilityId,
                displayName: spellInfoTarget.displayName,
                icon: spellInfoTarget.icon,
                building: firstUnit.displayName,
                buildingItemId: firstUnit.itemId,
                targetPosition: { x: targetX, y: targetY }
              });
            } else {
              this.addEvent('spellCast', {
                unit: firstUnit.exportUnitReference(),
                targetPosition: { x: targetX, y: targetY },
                spellName: spellInfoTarget.displayName,
                spellItemId: spellInfoTarget.abilityId,
                icon: spellInfoTarget.icon,
                isUnitSpell: !firstUnit.meta.hero
              });

              // Ground-targeted combat spell signal (e.g. Blizzard, Shockwave).
              // _emitSpellSignal will gate by combatSpellsGroundTarget whitelist
              // (groundClick path — no objectIds in action 0x11).
              this._emitSpellSignal(firstUnit, spellInfoTarget, -1, -1, targetX, targetY);

              // Teleport-class ground-targeted spell (Warden Blink). Instant —
              // _applyTeleport apply runs the same tick. Hero-only, no grab.
              if (teleportAbilities && teleportAbilities[spellInfoTarget.abilityId]) {
                this._applyTeleport(
                  teleportAbilities[spellInfoTarget.abilityId],
                  firstUnit,
                  targetX, targetY,
                  null   // no destination building (ground target)
                );
              }
            }
          } else {
            console.logger("WARNING - unable to find unit ability");
            this.reduceParseConfidence('Tiny');
          }
        break;
      }

      return;
    }

    const workerInGroup = selectionUnits.find(sunit => {
      return sunit.meta.worker;
    });

    if (workerInGroup) {
      const closestWorker = utils.closestToPoint(targetX, targetY, selectionUnits, (sunit => {
        return sunit.meta.worker;
      }));

      if (!utils.isEqualUnitItemId(firstUnit, closestWorker)) {
        firstUnit = closestWorker;
      }

      const startingPosition = {
        x: targetX,
        y: targetY
      };

      // skip duplicate build commands for the same building at the same spot
      const duplicateBuild = this.findBuildingAtPosition(fixedItemId, targetX, targetY);
      if (duplicateBuild) {
        this.buildMenuOpen = false;
        return;
      }

      // if the same worker already has a pending build of the same type (player re-issued
      // build command at a different spot), remove the old one and retract its event
      const pendingBuildIdx = this.units.findIndex(u =>
        u.isBuilding &&
        u.itemId === fixedItemId &&
        u.objectId1 === null &&
        u._pendingBuilder === firstUnit &&
        !u._buildEventEmitted
      );
      if (pendingBuildIdx !== -1) {
        const oldBuilding = this.units[pendingBuildIdx];
        console.logger("removing re-placed building:", oldBuilding.displayName, oldBuilding.currentX, oldBuilding.currentY);

        // mark the replaced attempt
        const replacedAttempt = this._buildingAttempts.find(a =>
          a.building === oldBuilding && a.status === 'pending'
        );
        if (replacedAttempt) replacedAttempt.status = 'replaced';
        this.units.splice(pendingBuildIdx, 1);
        const worldUnits = this.world.playerData[this.id] && this.world.playerData[this.id].units;
        if (worldUnits) {
          const wi = worldUnits.indexOf(oldBuilding);
          if (wi !== -1) worldUnits.splice(wi, 1);
        }

        // if the old building already emitted an addBuilding event, retract it
        if (oldBuilding._buildEventEmitted) {
          const ei = this.eventStream.findIndex(e =>
            e.key === 'addBuilding' &&
            e.building && e.building.itemId === fixedItemId &&
            e.building.objectId1 === oldBuilding.objectId1
          );
          if (ei !== -1) {
            // undo supply change from the retracted building
            const foodMade = (oldBuilding.balanceInfo && oldBuilding.balanceInfo.foodMade) || 0;
            this.supplyMax -= foodMade;
            this.eventStream.splice(ei, 1);
          }
        }
      }

      let building = new Building(this.eventTimer, null, null, fixedItemId, false);
      building.registerUnit(fixedItemId, null, null);
      building.currentX = targetX;
      building.currentY = targetY;

      // validate: reject extreme out-of-bounds coordinates
      const MAX_COORD = 32768;  // 256 tiles * 128 units/tile — larger than any standard map
      if (Math.abs(targetX) > MAX_COORD || Math.abs(targetY) > MAX_COORD) {
        console.logger("WARNING - building placed out of bounds:", building.displayName, targetX, targetY);
        this.estimateBuildingPosition(building);
      }

      building._pendingBuilder = firstUnit;

      PlayerActions.checkUnitBackfill(this, building);

      // track every build command issued, including ones that get cancelled or replaced
      this._buildingAttempts.push({
        itemId: fixedItemId,
        displayName: building.displayName,
        gameTime: this.eventTimer.timer.gameTime,
        x: targetX,
        y: targetY,
        building: building,
        status: 'pending'
      });

      // register building in units list immediately so selection tracking can find it
      // supply tracking and addBuilding event are deferred to the moveToBuild callback
      this.units.push(building);
      this.world.addPlayerUnit(this.id, building);
      building.bindToWorld(this.world, this.id, this.teamId);

      const playerInstance = this;

      console.logger("&&& moveToBuild:::unit is building: ", building.displayName, firstUnit.uuid);

      // track worker going to build (per-unit state only; aggregates are computed)
      this._traceTask(firstUnit, WorkerTask.BUILD, 'buildStart');
      firstUnit.currentTask = WorkerTask.BUILD;

      // worker walking to a far-away build site is a scout signal
      // (acolyte → far zig/haunted mine, peasant → forward tower, peon → forward burrow,
      // wisp → forward/expansion ancient — but NOT near-base ancients, so use the
      // larger expansion threshold here to filter out routine ancient placement).
      this.checkScoutDetection(firstUnit, targetX, targetY, {
        distanceThreshold: EXPANSION_DISTANCE_THRESHOLD
      });

      firstUnit.moveToBuild(this.world, building, (eventFinished, isCancelled = false) => {
        console.logger("unit moveToBuild event handler: ", firstUnit.uuid, eventFinished);

        const distanceLeft = utils.distance(
          building.currentX, building.currentY,
          firstUnit.currentX, firstUnit.currentY
        );

        console.logger(`### moveToBuild distance left: ${distanceLeft}`);

        if (!eventFinished) {
          //
          // if the event was marked as not fully finished,
          // do some distance checks to see if the worker got
          // to the right place to build
          //          
          const distanceLeft = utils.distance(
            building.currentX, building.currentY,
            firstUnit.currentX, firstUnit.currentY
          );

          const { gameTime } = playerInstance.eventTimer.timer;

          // once the game gets deep enough stop trying these distance checks
          const gameTimeBuffer = gameTime > 200000 ? 5.5 : 1;
          const maxDistanceBuffer = (2500 * gameTimeBuffer);

          console.logger(`### building check: distLeft: ${distanceLeft} maxBuff: ${maxDistanceBuffer}`);

          if (distanceLeft > maxDistanceBuffer) {
            console.logger("WARNING - building move event was cancelled before build. builder: ", firstUnit.displayName);
            console.logger("stopped building: ", building.displayName, building.itemId);

            // not always a bad thing, but because it's uncertain we reduce a tiny amount
            this.reduceParseConfidence('Tiny');

            // mark attempt as cancelled
            const cancelledAttempt = playerInstance._buildingAttempts.find(a =>
              a.building === building && a.status === 'pending'
            );
            if (cancelledAttempt) cancelledAttempt.status = 'cancelled';

            // worker build cancelled, return to primary role
            playerInstance._traceTask(firstUnit, firstUnit.primaryRole || WorkerTask.GOLD, 'buildCancel');
            firstUnit.currentTask = firstUnit.primaryRole || WorkerTask.GOLD;
            return;
          }
        }

        console.logger(playerInstance.id, "unit finished moving to building, now building: ", building.displayName);

        // mark attempt as confirmed
        const confirmedAttempt = playerInstance._buildingAttempts.find(a =>
          a.building === building && a.status === 'pending'
        );
        if (confirmedAttempt) confirmedAttempt.status = 'confirmed';

        const mechanic = raceBuildMechanic(playerInstance.race, fixedItemId);
        const buildTimeSeconds = getBuildTime(fixedItemId);

        building.buildMechanic = mechanic;
        building.builderUnit = firstUnit;

        switch (mechanic) {
          case BuildMechanic.CONSUMED_PERMANENT:
            // NE ancient: wisp is permanently consumed and destroyed
            firstUnit.consumeForBuilding(building, mechanic);
            firstUnit.destroyedByBuilding = true;
            firstUnit.destroyedAt = playerInstance.eventTimer.timer.gameTime;
            playerInstance._traceTask(firstUnit, null, 'wispConsumedPermanent');
            firstUnit.currentTask = null;
            firstUnit.primaryRole = null;
            // decrement supply (wisp is gone)
            const wispFood = (firstUnit.balanceInfo && firstUnit.balanceInfo.foodUsed) || 1;
            playerInstance.supplyUsed -= wispFood;
            building.startConstruction(buildTimeSeconds, null);
            break;

          case BuildMechanic.CONSUMED_TEMPORARY:
            // NE non-ancient or Orc: worker consumed during build, released on complete
            firstUnit.consumeForBuilding(building, mechanic);
            playerInstance._traceTask(firstUnit, WorkerTask.BUILD, 'workerConsumedTemp');
            firstUnit.currentTask = WorkerTask.BUILD;
            building.startConstruction(buildTimeSeconds, () => {
              firstUnit.releaseFromBuilding(playerInstance.eventTimer.timer.gameTime);
              playerInstance._traceTask(firstUnit, firstUnit.primaryRole || WorkerTask.GOLD, 'workerReleased');
            });
            break;

          case BuildMechanic.SUMMONER:
            // Undead: acolyte begins summoning, then is immediately free
            playerInstance._traceTask(firstUnit, firstUnit.primaryRole || WorkerTask.GOLD, 'acolyteSummon');
            firstUnit.currentTask = firstUnit.primaryRole || WorkerTask.GOLD;
            // acolyte is NOT consumed
            building.startConstruction(buildTimeSeconds, null);
            break;

          case BuildMechanic.BUILDER:
            // Human: peasant works on-site, can be pulled away
            firstUnit.consumeForBuilding(building, mechanic);
            building.builderWorkers.push(firstUnit);
            playerInstance._traceTask(firstUnit, WorkerTask.BUILD, 'peasantBuild');
            firstUnit.currentTask = WorkerTask.BUILD;
            building.startConstruction(buildTimeSeconds, () => {
              // release all peasants working on this building
              building.builderWorkers.forEach(w => {
                w.releaseFromBuilding(playerInstance.eventTimer.timer.gameTime);
                playerInstance._traceTask(w, w.primaryRole || WorkerTask.GOLD, 'peasantBuildDone');
              });
              building.builderWorkers = [];
            });
            break;
        }

        playerInstance.addPlayerBuilding(building);
      });

      // toggle OFF the build menu since we just used it in an action
      this.buildMenuOpen = false;
      return;
    }

    if (unitInfo.isBuilding) {
      console.logger("WARNING: building did an action we didn't register");
      this.reduceParseConfidence('Minor');
    } else {
      // not sure how or why we got here
      this.reduceParseConfidence('Major');  
    }
  }

  //
  // ActionBlock method
  // simple callback to note worker building menu is open
  //
  chooseBuilding (action) {
    this.buildMenuOpen = true;
  }

  //
  // ActionBlock method
  // called to assign a group to a given hotkey
  // the game provides the itemId1-2 pairs of the units in a group
  //
  assignGroupHotkey (action) {
    const { 
      groupNumber, 
      numberUnits,
      actions
    } = action;

    //
    // DEV NOTE - for weird and unknown wc3 reasons the first two heroes
    //            in the hotkey group are switched in position order.
    //            this can be handled by the engine with tab-switch checks,
    //            but it *SEEMS* to consistently always screw this up, so fix it.
    //
    if (actions.length >= 2) {
      let shouldSwapHeroes = false;
      for (let i = 0; i < 2; i++) {
        const { itemId1, itemId2 } = actions[i];
        const unit = this.findUnit(itemId1, itemId2);

        if (unit && unit.meta.hero) {
          shouldSwapHeroes = true;
        } else {
          shouldSwapHeroes = false;
        }
      }

      if (shouldSwapHeroes) {
        console.logger("WARNING - Swapping first two heroes in hotkey group");
        const oldFirst = actions[0];

        actions[0] = actions[1];
        actions[1] = oldFirst;
      }
    }

    const oldSelection = this.selection;
    const newGroup = new SubGroup(numberUnits, actions);
    const newSelection = new SubGroup(numberUnits, actions);

    // set flags on our group and selection
    newGroup.setFromHotkey = true;
    newSelection.setFromHotkey = true;

    // set the new group and selection
    this.groupSelections[groupNumber] = newGroup;
    this.selection = newSelection;

    // ensure the groups have no bugged members in them 
    // sometimes for whatever reason the game includes a building in
    // the 'assign group hotkey' action groups

    this.selection.units = this.ensureValidGroup(oldSelection.units, this.selection.units);
    this.groupSelections[groupNumber].units = this.ensureValidGroup(
      oldSelection.units, 
      this.groupSelections[groupNumber].units
    );

    this.lastSelectedGroupNumber = groupNumber;
    this.recordGroups();
  }

  //
  // ActionBlock method
  // called to assign a given group at the known hotkey as our selection.
  // unfortunately does not provide the units it expects to select,
  // so we are potentially able to set the selection to a stale / invalid
  // group of units that maybe died, were unsummoned, or were wrongly assigned.
  //

  selectGroupHotkey (action) {
    const { groupNumber } = action;

    if (this.groupSelections[groupNumber]) {
      // todo: add group deselectAll
      const { 
        numberUnits, 
        units,
        hasUnregisteredUnit,
        hasDestroyedSummon,
        destroyedUnits
      } = this.groupSelections[groupNumber];

      let groupCopy = new SubGroup(numberUnits, units, hasUnregisteredUnit);
      this.selection = groupCopy;

      // set our selection flags
      this.selection.hasDestroyedSummon = hasDestroyedSummon;
      this.selection.destroyedUnits = destroyedUnits;
      this.selection.setFromHotkey = true;

      this.lastSelectedGroupNumber = groupNumber;

      if (this.selection.numberUnits === 0) {
        // selection group had no units?
        this.reduceParseConfidence('Major');
      }
    } else {
      console.error("WARNING -selected group that didnt exist");
      this.reduceParseConfidence('Major');
    }
  }

  //
  // ActionBlock method
  // give or drop an item to a target X,Y and objectId1-2 pair
  // lot of uncertainty involved here
  //
  //
  // SelectGroundItemAction (id 28): a unit selected/picked up an item lying
  // on the ground. The replay action carries the item *instance* objectIds
  // but NO position and, for random creep drops, NO usable type. We honestly
  // record only the knowable facts: which player's unit, where it was (its
  // own accurate position — Project A), when, and the item type ONLY if the
  // action actually carries a resolvable itemId. Attribution is limited to
  // camps the unit is physically near, via the same neutral detection tree
  // used for location events.
  //
  // Given a position, look up the nearest creep camp via the world's
  // neutral-detection tree and aggregate all unique items that could
  // possibly have dropped from that camp's creeps (Approach C from the
  // creep-drop pickup design — when we can't observe the exact item, at
  // least narrow the candidate set to the camp's drop table).
  //
  // Returns { campUuid, potentialItems[] } where each potentialItem is
  // { itemId, displayName, chance, isRandom }. Returns null if no camp
  // is near the point or its drop tables are empty.
  //
  // The search box is widened to ±400 game units around the pickup to
  // catch items that scattered slightly outside the detection bbox.
  _resolveCampDropsForPosition (x, y) {
    if (!this.world || !this.world.neutralDetectionTree ||
        !this.world.neutralGroups || x == null || y == null) {
      return null;
    }
    const PAD = 400;
    const point = { minX: x - PAD, minY: y - PAD, maxX: x + PAD, maxY: y + PAD };
    const hits = this.world.neutralDetectionTree.search(point);
    if (!hits || !hits.length) return null;

    // Closest camp first — neutralDetectionTree results aren't sorted by
    // distance, so do it explicitly. Camp positions live on the
    // detection node; fall back to the group's units' average position.
    const dist2 = (h) => {
      const cx = (h.minX + h.maxX) / 2;
      const cy = (h.minY + h.maxY) / 2;
      return (cx - x) * (cx - x) + (cy - y) * (cy - y);
    };
    const sorted = hits.slice().sort((a, b) => dist2(a) - dist2(b));

    for (const hit of sorted) {
      const group = this.world.neutralGroups[hit.uuid];
      if (!group || !group.units) continue;
      const dropMap = {};
      group.units.forEach(u => {
        (u.droppedItemSets || []).forEach(d => {
          if (!d || !d.itemId) return;
          const existing = dropMap[d.itemId];
          if (!existing || (d.chance || 0) > (existing.chance || 0)) {
            // Resolve random-table refs (e.g. "YiI1" → "Random Lv1 Any")
            // and fixed-itemId drops via the canonical resolver. Without
            // this the BO panel / inspect output shows raw 4-char codes.
            // For random refs, also include the candidate pool from
            // dropTables.json so consumers can show the user the actual
            // list of items that could have dropped.
            const resolved = mappings.resolveDropItem(d.itemId);
            dropMap[d.itemId] = {
              itemId: d.itemId,
              displayName: (resolved && resolved.displayName) || d.displayName || d.itemId,
              chance: d.chance || 0,
              isRandom: !!(resolved && resolved.isRandom),
              ...(resolved && resolved.pool ? { pool: resolved.pool } : {})
            };
          }
        });
      });
      const drops = Object.values(dropMap);
      if (drops.length) {
        return { campUuid: hit.uuid, potentialItems: drops };
      }
    }
    return null;
  }

  selectGroundItem (action) {
    const world = this.world;
    if (!world || !world.neutralDetectionTree || !world.neutralGroups) {
      return;
    }

    const selectionUnits = this.getSelectionUnits();
    const actor = selectionUnits.find(u => u && u.currentX != null && u.isRegistered)
      || selectionUnits.find(u => u && u.currentX != null);
    if (!actor) {
      return;
    }

    const x = actor.currentX;
    const y = actor.currentY;
    if (x == null || y == null) {
      return;
    }

    const point = { minX: x, minY: y, maxX: x, maxY: y };
    const hits = world.neutralDetectionTree.search(point);
    if (!hits || !hits.length) {
      return;
    }

    // SelectGroundItemAction does not reliably carry the item type; pass it
    // through only when present so resolveDropItem can label it honestly
    // (otherwise it is recorded as an explicit "unknown / random drop").
    const rawItemId = action && action.itemId ? action.itemId : null;
    const itemId = rawItemId && typeof rawItemId === 'string' ? rawItemId : null;

    // Track the matched camp UUID so the pickup event can reference it
    // (lets the BO panel say "looted Pendant of Mana from L3 creep camp").
    let firstCampUuid = null;
    const seen = {};
    hits.forEach(hit => {
      if (!hit || seen[hit.uuid]) return;
      seen[hit.uuid] = true;
      if (!firstCampUuid) firstCampUuid = hit.uuid;
      const group = world.neutralGroups[hit.uuid];
      if (group && typeof group.addItemEvent === 'function') {
        group.addItemEvent(this, actor, x, y, rawItemId);
      }
    });

    // If the actor is a hero, materialize the picked-up item in their
    // inventory via the HeroInventory ledger so subsequent uses don't
    // appear as "no slot" backfills. Confidence is `high` when the action
    // carried the itemId, `low` when it didn't (random drop the action
    // payload doesn't disambiguate). Non-hero pickups (peons retrieving
    // items for trade) are not supported by WC3 melee; skip them.
    if (actor && actor.meta && actor.meta.hero && actor.items) {
      const isRandomDrop = !itemId;
      const pickupId = itemId || 'Jwid';
      const itemData = pickupId && itemAbilityData[pickupId];
      // Skip tomes — they consume on pickup (no inventory slot needed),
      // immediate effect should be modeled by a separate consumption
      // event, not a slot.add (which would leak a phantom slot entry).
      const isTome = itemData && (itemData.category === 'tome' || itemData.type === 'tome');
      const heroName = actor.displayName || 'hero';
      const itemDisplay = itemData && itemData.displayName
        || (itemId ? mappings.getUnitInfo(itemId).displayName : 'Unknown ground item');

      if (!isTome) {
        const newItem = new Item(actor.eventTimer, null, null, pickupId, false);
        newItem.knownOwner = true;
        HeroInventory.add(this, actor, newItem, {
          source: 'creep-drop',
          confidence: isRandomDrop ? 'low' : 'high',
          actionText: `${heroName} picks up ${itemDisplay}`,
          knownObjectId: action && (action.objectId1 != null || action.objectId2 != null)
            ? { id1: action.objectId1, id2: action.objectId2 } : null
        });
      }

      this.addEvent('pickupItem', {
        item: { itemId: pickupId, displayName: itemDisplay },
        unit: actor.exportUnitReference(),
        campUuid: firstCampUuid,
        isRandomDrop,
        position: { x, y },
        confidence: isRandomDrop ? 'low' : 'high',
        source: 'creep-drop',
        actionText: `${heroName} picks up ${itemDisplay}${firstCampUuid ? ' from creep camp' : ''}`
      });
    }
  }

  giveOrDropItem (action ) {
    const {
      abilityFlags,
      itemId,
      targetX,
      targetY,
      objectId1,
      objectId2,
      itemObjectId1,
      itemObjectId2
    } = action;

    let selection = this.getSelectionUnits();
    let firstUnit = this.getSelectedUnit();

    if (!firstUnit) {
      this.reduceParseConfidence('Major');
      return;
    }

    const heroItems = firstUnit.getItemList();
    const knownItem = heroItems.find(heroItem => {
      const item = heroItem.item;
      return item.objectId1 === itemObjectId1 &&
             item.objectId2 === itemObjectId2 &&
             item.objectId1 !== null;
    });

    // Sell-back detection. The action shape was confirmed via the
    // sellback-test.w3g fixture: dropItem on a shop building (own player
    // shop or neutral merchant) targets `objectId1/objectId2` = the
    // shop's IDs. When multiple un-bound items are in inventory (e.g. the
    // auto-given stwp + a newly-bought Healing Salve), `find()` would
    // latch onto the first match by slot order and mis-attribute the
    // sold item. We resolve which item by:
    //   1) explicit objectId match (`knownItem`), if any;
    //   2) most-recently-acquired shop-bought item (highest acquiredAt
    //      with source = shop-known / shop-inferred);
    //   3) most-recently-acquired item of any provenance.
    // The shop-target heuristic is much stronger than the previous
    // "first item with null objectId" because in the WC3 ladder the
    // player almost always sells what they JUST bought, not a stale
    // auto-grant they've been carrying for the whole game.
    if (objectId1 !== -1 && objectId2 !== -1 && this.world) {
      let targetBuilding = this.findUnitByObjectId(objectId1, objectId2);
      if (!targetBuilding && this.world.findNeutralByObjectIds) {
        targetBuilding = this.world.findNeutralByObjectIds(objectId1, objectId2);
      }
      // Neutral shops aren't always in the neutral player's units list with
      // the action's objectIds — but `world.neutralShops` IS populated on
      // selection (checkForSelectSubgroupEarlyExit calls addNeutralShop).
      // If we haven't found the building, check that registry by objectId
      // and reify the actual building from the neutral player's units.
      if (!targetBuilding && this.world.neutralShops) {
        const shopRef = this.world.neutralShops.find(s =>
          s.objectId1 === objectId1 && s.objectId2 === objectId2);
        if (shopRef && this.world.playerData) {
          const neutralPlayer = this.world.playerData[mappings.NEUTRAL_PLAYER_ID];
          if (neutralPlayer && Array.isArray(neutralPlayer.units)) {
            targetBuilding = neutralPlayer.units.find(u =>
              u.itemId === shopRef.itemId && u.currentX != null);
          }
        }
      }
      const isShop = targetBuilding && targetBuilding.isBuilding &&
        !!mappings.itemSellingBuildings[targetBuilding.itemId];

      if (isShop) {
        let sellSlot = knownItem || null;
        if (!sellSlot) {
          // Disambiguate among unregistered items: prefer the
          // most-recently-acquired shop-bought item, fall back to any
          // most-recent item.
          const candidates = heroItems.filter(h => h.item.objectId1 === null);
          if (candidates.length) {
            const shopBought = candidates.filter(h =>
              h.item.source === 'shop-known' || h.item.source === 'shop-inferred');
            const pool = shopBought.length ? shopBought : candidates;
            sellSlot = pool.reduce((best, h) =>
              (!best || (h.item.acquiredAt || 0) > (best.item.acquiredAt || 0)) ? h : best, null);
          }
        }

        if (sellSlot) {
          const sellItem = sellSlot.item;
          const itemData = itemAbilityData[sellItem.itemId];
          const goldRefunded = Math.floor(((itemData && itemData.goldCost) || 0) * 0.5);
          // Bind the item's objectIds before removing so a later trade /
          // pickup never re-matches an "unregistered" ghost of this item.
          if (sellItem.objectId1 === null && sellItem.registerObjectIds) {
            sellItem.registerObjectIds(itemObjectId1, itemObjectId2);
          }
          HeroInventory.remove(this, firstUnit, sellSlot.slot, 'sell', {
            target: { itemId: targetBuilding.itemId, displayName: targetBuilding.displayName },
            refund: goldRefunded
          });
          if (targetBuilding.soldItems) {
            targetBuilding.soldItems[sellItem.itemId] =
              (targetBuilding.soldItems[sellItem.itemId] || 0) + 1;
          }
          firstUnit.droppedItems.push(sellSlot);
          // Confidence reflects how sure we are which item was sold.
          // Slot match (knownItem) is 'high'; shop-bought disambiguation
          // is 'medium'; any-most-recent fallback is 'low'.
          const sellConfidence = knownItem ? 'high'
            : (sellItem.source === 'shop-known' || sellItem.source === 'shop-inferred') ? 'medium'
            : 'low';
          this.addEvent('sellItem', {
            item: sellItem.exportItemReference(),
            unit: firstUnit.exportUnitReference(),
            shop: targetBuilding.displayName,
            shopItemId: targetBuilding.itemId,
            goldRefunded,
            confidence: sellConfidence,
            source: 'shop-known',
            actionText: `${firstUnit.displayName} sells ${sellItem.displayName} to ${targetBuilding.displayName} for ${goldRefunded}g`
          });
          return;
        }
      }
    }

    // objectId1-2 pair of -1 means item on ground
    if (objectId1 === -1 && objectId2 === -1) {
      if (knownItem) { 
        console.logger("put known item on ground.");
        this.world.droppedItems.push(knownItem.item);
        firstUnit.items[knownItem.slot] = null;
        firstUnit.droppedItems.push(knownItem);

        this.addEvent('dropItem', {
          type: 'knownItem',
          slot: knownItem.slot,
          item: knownItem.item.exportItemReference(),
          unit: firstUnit.exportUnitReference()
        });

        return;
      }

      // Check whether the dropped item matches a buffered Phase-A inferred-
      // pickup candidate (creep drop, etc.). If so, we know the item is
      // NOT one of the hero's existing items — it's the creep-drop item
      // that the parser couldn't identify earlier. Materialize an Unknown
      // placeholder for it rather than binding to a hero's existing item
      // (which is what `potentialItem` would do, mis-attributing the drop).
      const matchingPending = this._pendingInferredPickups &&
        this._pendingInferredPickups.find(p =>
          p.objectId1 === itemObjectId1 && p.objectId2 === itemObjectId2);
      if (matchingPending) {
        const placeholder = new Item(this.eventTimer, null, null, 'Jwid', false);
        placeholder.registerKnownItem(itemObjectId1, itemObjectId2, targetX, targetY);
        this.world.droppedItems.push(placeholder);
        this.addEvent('dropItem', {
          type: 'potentialItem',
          slot: null,
          item: placeholder.exportItemReference(),
          unit: firstUnit.exportUnitReference()
        });
        return;
      }

      // look for potential item to put on ground
      let potentialItem = heroItems.find(heroItem => {
        const item = heroItem.item;
        return item.objectId1 === null;
      });

      if (potentialItem) {
        console.logger("Dropping potential item: ", potentialItem.item.displayName);

        // todo: track maybeSwapItem here
        potentialItem.item.registerObjectIds(itemObjectId1, itemObjectId2);
        firstUnit.items[potentialItem.slot] = null;

        this.world.droppedItems.push(potentialItem.item);
        firstUnit.droppedItems.push(potentialItem);

        this.addEvent('dropItem', {
          type: 'potentialItem',
          slot: potentialItem.slot,
          item: potentialItem.item.exportItemReference(),
          unit: firstUnit.exportUnitReference()
        });
      } else {
        console.logger("ERROR - No potential items to drop.");
        this.reduceParseConfidence('Minor');
      }

      return;
    }

    //
    // try to find a hero to give/drop item to
    //

    const targetHero = this.findUnitByObjectId(objectId1, objectId2);
    if (!targetHero) {
      // can't find hero that is getting item
      this.reduceParseConfidence('Major');
      return;
    }

    // known item and known target hero, give the item over
    if (knownItem) {
      firstUnit.items[knownItem.slot] = null;
      firstUnit.droppedItems.push(knownItem);
      targetHero.tradeItem(knownItem.item);

      this.addEvent('dropItem', {
        type: 'knownItem',
        slot: knownItem.slot,
        item: knownItem.item.exportItemReference(),
        unit: firstUnit.exportUnitReference(),
        targetHero: targetHero.exportUnitReference()
      });

      console.logger(this.id, `Hero ${firstUnit.displayName} gave known item to ${targetHero.displayName}`);  
      return;
    }

    // unkown item being traded, look for potential unknown item from units item list
    const unknownWorldUnit = this.world.findUnknownObject(objectId1, objectId2);
    const potentialUnregisteredItem = heroItems.find(heroItem => {
      return heroItem.item.objectId1 === null;
    });

    if (potentialUnregisteredItem) {
      const { slot, item } = potentialUnregisteredItem;
      potentialUnregisteredItem.item.registerKnownItem(itemObjectId1, itemObjectId2, targetX, targetY);

      firstUnit.droppedItems.push(potentialUnregisteredItem);
      firstUnit.items[slot] = null;
      targetHero.tradeItem(item);

      console.logger(this.id,
        `Hero ${firstUnit.displayName} gave unknown item ${potentialUnregisteredItem.item.displayName}
        to ${targetHero.displayName}`); 
      
      this.addEvent('dropItem', {
        type: 'potentialUnregisteredItem',
        slot: potentialUnregisteredItem.slot,
        item: potentialUnregisteredItem.item.exportItemReference(),
        unit: firstUnit.exportUnitReference(),
        targetHero: targetHero.exportUnitReference()
      });

      return;
    }
    
    // try and find an unknown object from the world
    let unknownObject = this.world.findUnknownObject(itemObjectId1, itemObjectId2);
    if (unknownObject) {
      console.logger(this.id, "Found a world item to register.");

      let newUnknownItem = new Item(this.eventTimer, null, null, 'Jwid', false);
      newUnknownItem.registerKnownItem(itemObjectId1, itemObjectId2, targetX, targetY);

      console.logger(this.id, "WARNING - Gave hero item but had to make new unknown item.");
      this.reduceParseConfidence('Minor');
      targetHero.tradeItem(newUnknownItem);

      this.world.clearKnownItem(itemObjectId1, itemObjectId2);
      return;
    }

    // nothing to do but make a new unknown item and give it over
    let newUnknownItem = new Item(this.eventTimer, null, null, 'Jwid', false);
    newUnknownItem.registerKnownItem(itemObjectId1, itemObjectId2, targetX, targetY);
    newUnknownItem.meta.isItem = true;

    console.logger(this.id, "WARNING - Gave hero item but had to make new unknown item.");
    this.reduceParseConfidence('Minor');
    targetHero.tradeItem(newUnknownItem); 
  }

  //
  // ActionBlock method
  // dunno wat this does
  //
  useAbilityTwoTargets (action) {
    const { itemId1, itemId2, targetAX, targetAY } = action;
    const fixedItemId2 = utils.fixItemId(itemId2);

    const abilityActionName1 = utils.findItemIdForObject(itemId1, abilityActions);
    const abilityActionName2 = utils.findItemIdForObject(itemId2, abilityActions);
    
    // temp

    if (abilityActionName1 == "RightClick" && abilityActionName2 == "HarvestLumber") {
      // unit is harvesting some lumber

      console.logger("moving unit to lumber harvest spot");

      // track workers being sent to lumber
      // note: acolytes (uaco) cannot harvest lumber — only ghouls can for undead
      const selectionUnits = this.getSelectionUnits();
      const workers = selectionUnits.filter(u => u.meta.worker && u.itemId !== 'uaco');
      const ghouls = selectionUnits.filter(u => u.itemId === GHOUL_ID);

      const { gameTime } = this.eventTimer.timer;

      // move regular workers to lumber (per-unit state; aggregates are computed)
      // this applies to peons, peasants, wisps — not acolytes
      workers.forEach(unit => {
        unit.setWorkerRole(WorkerRole.LUMBER, gameTime);
      });

      // track ghouls sent to lumber (per-unit state)
      ghouls.forEach(unit => {
        unit.setWorkerRole(WorkerRole.LUMBER, gameTime);
      });

      PlayerActions.moveSelectedUnits(this, targetAX, targetAY, { skipScoutDetection: true });

      // wisps lumbering far from base are the only meaningful "lumber scout" signal
      // (gives vision via the harvest beam). ghouls/peons/peasants going to far trees
      // are routine harvesting, not scouting — they'd false-positive without this filter.
      selectionUnits.forEach(unit => {
        if (unit.itemId === 'ewsp') {
          this.checkScoutDetection(unit, targetAX, targetAY);
        }
      });
    }

    console.logger("current selection:");
    this.printSelectionUnits();

    // we don't handle it so...
    this.reduceParseConfidence('Minor');
  }

  //
  // debugging method
  //
  printUnits () {
    console.logger("player units for id: ", this.id);

    const sortedUnits = this.units.sort((a, b) => {
      const aName = a.displayName.toUpperCase();
      const bName = b.displayName.toUpperCase();

      if (aName < bName) {
        return -1;
      }

      if (aName > bName) {
        return 1;
      }

      return 0;
    });

    console.logger(sortedUnits.map(unit => {
      return `${unit.displayName} - [${unit.objectId1}, ${unit.objectId2}] ${unit.itemId1}, ${unit.itemId2}`;
    }));
  }

  //
  // debugging method
  //
  printAllGroups () {
    console.logger("all groups: ");
    const self = this;

    Object.keys(this.groupSelections).forEach(key => {
      let group = this.groupSelections[key];

      console.logger(key, "units: ", group.units.map(gunit => {
        const playerUnit = self.findUnit(gunit.itemId1, gunit.itemId2);

        const displayName = playerUnit ? playerUnit.displayName : "Unregistered";

        return gunit.itemId1 + "," + gunit.itemId2 + " - " + displayName;
      }));

      console.logger("meta: ", 
        group.setFromHotkey ? "set from hotkey" : "not set from hotkey",
        group.hasDestroyedSummon ? "has destroyed summon" : "no destroyed units");
    });
  }

  //
  // debugging method
  //
  printSelectionUnits () {
    const self = this;
    // a player can act before ever making a selection — nothing to print
    if (!this.selection) { return; }
    console.logger("selection index: ", this.selection.selectionIndex);
    console.logger("current selection units: ", this.selection.units.map(gunit => {
      const playerUnit = self.findUnit(gunit.itemId1, gunit.itemId2);

      if (!playerUnit) {
        return `${gunit.itemId1}, ${gunit.itemId2} - Unregistered`;
      }

      const {
        itemId1,
        itemId2,
        objectId1,
        objectId2,
        displayName
      } = playerUnit;

      return `${itemId1}, ${itemId2} [${objectId1}, ${objectId2}] - ${displayName}`;
    }));
  }

  //
  // Inference commit: walk settled Claims and patch the eventStream /
  // _teleportEvents records to reflect each claim's final confidence.
  //
  // For v1 (Phase A) we keep parse-time effects intact (events emitted,
  // caster.teleportTo run inline) — commit-time work tags those records
  // with `inferenceConfidence` + `cancelled` so client renderers and
  // BattleData / TeleportFx can gate downstream FX. Path-data corruption
  // for rejected TPs is a known v1 limitation; Phase B will fully defer.
  //
  commitClaims () {
    const reg = this._claimRegistry;
    if (!reg) return { processed: 0 };
    const { CONFIDENCE_INDEX } = require("./inference/Claim");

    let processed = 0;
    for (const claim of reg.iterate()) {
      const parts = claim.subject.split('.');
      const type = parts[1];
      if (type !== 'teleport') continue;
      processed++;

      const payload = claim.payload || {};
      const conf = claim.confidence;
      const confIdx = CONFIDENCE_INDEX[conf];
      // 'possible' = no strong evidence either way; commit but tag for
      // UI badging. Only 'unlikely' / 'rejected' get cancelled — the
      // commit pass treats absence of contradiction as parser-trust.
      const isAcceptable = confIdx >= CONFIDENCE_INDEX.possible;

      // Patch the persistent _teleportEvents record (shared by client
      // TeleportFx + BattleData). Always stamp inferenceConfidence +
      // evidenceSummary so the validator and inspect-replay can explain
      // both rejections AND confirmations. Cancel only when below
      // 'possible' (unlikely / rejected).
      const rec = payload.recordRef;
      if (rec) {
        rec.inferenceConfidence = conf;
        rec.evidenceSummary = (claim.evidence || []).map(e => ({
          source: e.source, weight: e.weight, kind: e.kind,
          detail: e.detail
        }));
        if (!isAcceptable) {
          rec.cancelled = true;
          if (!rec.cancelReason) rec.cancelReason = 'inference-rejected';
        }
      }

      // Patch matching eventStream entries (teleportScroll, teleport,
      // itemUse) by gameTime + caster + ability. Cheap linear scan
      // bounded by event count; commit runs once per replay.
      const castTime = payload.gameTime;
      const heroUuid = payload.casterUuid;
      const ability  = payload.itemId;
      for (const ev of this.eventStream) {
        if (Math.abs((ev.gameTime || 0) - castTime) > 5000) continue;
        const sameHero = !heroUuid ||
          (ev.unit && ev.unit.uuid === heroUuid);
        if (!sameHero) continue;
        switch (ev.key) {
          case 'teleportScroll':
            ev.inferenceConfidence = conf;
            if (!isAcceptable) ev.cancelled = true;
            break;
          case 'teleport':
            if (ev.teleport) {
              ev.teleport.inferenceConfidence = conf;
              if (!isAcceptable) ev.teleport.cancelled = true;
            }
            break;
          case 'itemUse':
            // Mark uses of the alleged teleport item; backfill below
            // adds a fresh itemUse if a proposal exists.
            if (ev.item && ev.item.itemId === ability) {
              ev.inferenceConfidence = conf;
              if (!isAcceptable) {
                ev.cancelled = true;
                ev.cancelReason = 'inference-rejected';
              }
            }
            break;
        }
      }

      // Mark the spurious jump in caster path. Visual interpolation
      // hint for the client renderer until Phase B properly defers.
      if (!isAcceptable && rec && payload.casterUuid) {
        const caster = this.units && this.units.find(u => u.uuid === payload.casterUuid);
        if (caster && Array.isArray(caster.path)) {
          const applyTime = (payload.gameTime || 0) + (payload.channelMs || 0);
          for (const pt of caster.path) {
            if (!pt.isJump) continue;
            if (Math.abs((pt.gameTime || 0) - applyTime) <= 200) {
              pt.spurious = true;
              pt.spuriousReason = 'inference-rejected-teleport';
              break;
            }
          }
        }
      }

      // Backfill: if rejectedItemBackfill strategy attached a proposal,
      // materialize it as an itemUse claim and patch the eventStream
      // so the BO panel shows the inferred item use rather than nothing.
      if (!isAcceptable && payload.proposedBackfill) {
        const bf = payload.proposedBackfill;
        // Simple confidence rule: backfill only commits when the
        // teleport claim is rejected AND the proposal is unambiguous
        // (single non-stwp recent purchase). Per plan: "likely or better".
        // We score the proposal here as a single heuristic — sourced
        // from shop-known → likely; shop-inferred → possible; else don't backfill.
        const proposalConf =
          (bf.itemSource === 'shop-known')   ? 'likely'   :
          (bf.itemSource === 'shop-inferred')? 'possible' :
          'possible';
        if (proposalConf === 'likely') {
          this.addEvent('itemUse', {
            item: { itemId: bf.itemId, displayName: bf.displayName, knownItemId: bf.itemId },
            unit: { uuid: payload.casterUuid },
            usesLeft: null,
            category: 'consumable',
            confidence: 'low',
            source: 'inferred-from-rejected-teleport',
            inferenceConfidence: proposalConf,
            inferredFrom: claim.id,
            gameTime: castTime
          });
        } else {
          this.addEvent('itemUse', {
            item: { itemId: null, displayName: 'Unknown consumable', knownItemId: null },
            unit: { uuid: payload.casterUuid },
            usesLeft: null,
            category: 'unknown',
            confidence: 'low',
            source: 'use-no-slot',
            inferenceConfidence: proposalConf,
            inferredFrom: claim.id,
            gameTime: castTime
          });
        }
      }
    }
    return { processed };
  }

  //
  // Post-processing: update eventStream worker assignments
  // with per-unit primaryRole and roleHistory (set during replay parsing)
  //
  postProcessWorkerAssignments () {
    this.eventStream.forEach(event => {
      if (event.key !== 'addUnit' || !event.unit) return;
      if (!WORKER_IDS.has(event.unit.itemId)) return;
      const unit = this.units.find(u => u.uuid === event.unit.uuid);

      if (unit) {
        // use primaryRole if set, otherwise fall back to _pendingRole
        // (training may not have completed before replay ended)
        let role = unit.primaryRole || unit._pendingRole || defaultWorkerRole(unit);

        // safety: acolytes cannot harvest lumber — force back to gold
        if (unit.itemId === 'uaco' && role === WorkerRole.LUMBER) {
          role = WorkerRole.GOLD;
        }

        event.unit.assignTarget = role;
        event.unit.roleHistory = unit.roleHistory;
        // preserve isTraining from event time (exportUnitReference snapshot), don't overwrite
      } else {
        // unit was cancelled/removed during parsing — set fallback role
        event.unit.assignTarget = event.unit.assignTarget ||
          (event.unit.itemId === 'ugho' ? 'lumber' : 'gold');
      }
    });
  }

  handlePreSubselection (action) {
    const { objectId1, objectId2 } = action;
    if (!objectId1 || !objectId2) return;

    const firstUnit = this.getSelectedUnit();
    if (!firstUnit) return;

    // If a transport is selected and the objectId points to a cargo unit, this is an unload
    if (firstUnit && firstUnit.isTransport && firstUnit.cargo.length) {
      const passengerUuid = firstUnit.cargo.find(uuid => {
        const unit = this.units.find(u => u.uuid === uuid);
        return unit && unit.objectId1 === objectId1 && unit.objectId2 === objectId2;
      });

      if (passengerUuid) {
        const passenger = this.units.find(u => u.uuid === passengerUuid);
        if (passenger) {
          firstUnit.cargo = firstUnit.cargo.filter(id => id !== passengerUuid);
          passenger.loadedInto = null;
          passenger.currentX = firstUnit.currentX;
          passenger.currentY = firstUnit.currentY;
          // Re-enter the world at the transport's position.
          if (this.world.collisionWorld) {
            this.world.collisionWorld.addUnit(passenger);
          }
          passenger.recordPosition(true);

          const gameTime = this.eventTimer.timer.gameTime;
          firstUnit.loadEvents.push({
            gameTime,
            action: 'unload',
            unitId: passenger.uuid,
            unitName: passenger.displayName,
            unitItemId: passenger.itemId
          });

          console.logger(this.id, `${passenger.displayName} unloaded from ${firstUnit.displayName} (PreSubselection)`);

          this.addEvent('transportUnload', {
            transport: firstUnit.exportUnitReference(),
            passenger: passenger.exportUnitReference()
          });
        }
      }
    }
  }

  handleTransportLoad (transportUnit, passengerUnit, targetX, targetY) {
    const gameTime = this.eventTimer.timer.gameTime;
    const MAX_TRANSPORT_CARGO = 8;

    // Deduplicate: skip if this unit is already in cargo
    if (transportUnit.cargo.includes(passengerUnit.uuid)) {
      return;
    }

    // If the passenger thinks it's loaded into a different transport (or this one from a
    // previous trip), that means an unload was missed. Flush it from the old transport.
    if (passengerUnit.loadedInto) {
      const oldTransport = this.units.find(u => u.uuid === passengerUnit.loadedInto);
      if (oldTransport) {
        oldTransport.cargo = oldTransport.cargo.filter(id => id !== passengerUnit.uuid);
        oldTransport.loadEvents.push({
          gameTime,
          action: 'unload',
          unitId: passengerUnit.uuid,
          unitName: passengerUnit.displayName,
          unitItemId: passengerUnit.itemId
        });
        console.logger(this.id, `${passengerUnit.displayName} implicitly unloaded from ${oldTransport.displayName} (stale cargo)`);
      }
      passengerUnit.loadedInto = null;
    }

    // Capacity cap
    if (transportUnit.cargo.length >= MAX_TRANSPORT_CARGO) {
      console.logger(this.id, `Transport ${transportUnit.displayName} at capacity (${MAX_TRANSPORT_CARGO}), rejecting ${passengerUnit.displayName}`);
      return;
    }

    transportUnit.cargo.push(passengerUnit.uuid);
    passengerUnit.loadedInto = transportUnit.uuid;

    // Loaded passenger leaves the world — pull from dynamic collision tree.
    if (this.world.collisionWorld) {
      this.world.collisionWorld.removeUnit(passengerUnit);
    }

    transportUnit.loadEvents.push({
      gameTime,
      action: 'load',
      unitId: passengerUnit.uuid,
      unitName: passengerUnit.displayName,
      unitItemId: passengerUnit.itemId
    });

    console.logger(this.id, `${passengerUnit.displayName} loaded into ${transportUnit.displayName} (cargo: ${transportUnit.cargo.length})`);

    this.addEvent('transportLoad', {
      transport: transportUnit.exportUnitReference(),
      passenger: passengerUnit.exportUnitReference()
    });
  }

  handleTransportUnload (transportUnit, targetX, targetY) {
    const gameTime = this.eventTimer.timer.gameTime;

    // Unload all cargo at the target position
    const unloadedIds = [...transportUnit.cargo];
    transportUnit.cargo = [];

    unloadedIds.forEach(uuid => {
      const passenger = this.units.find(u => u.uuid === uuid);
      if (passenger) {
        passenger.loadedInto = null;
        passenger.currentX = targetX;
        passenger.currentY = targetY;
        passenger.recordPosition(true);

        transportUnit.loadEvents.push({
          gameTime,
          action: 'unload',
          unitId: passenger.uuid,
          unitName: passenger.displayName,
          unitItemId: passenger.itemId
        });

        console.logger(this.id, `${passenger.displayName} unloaded from ${transportUnit.displayName}`);

        this.addEvent('transportUnload', {
          transport: transportUnit.exportUnitReference(),
          passenger: passenger.exportUnitReference()
        });
      }
    });
  }

  buildItemStream () {
    const purchases = {};
    const uses = {};

    this.eventStream.forEach(event => {
      if (event.key === 'itemPurchase') {
        const id = event.item.itemId;
        if (!purchases[id]) {
          purchases[id] = {
            itemId: id,
            displayName: event.item.displayName,
            count: 0,
            goldSpent: 0,
            firstTime: event.gameTime
          };
        }
        purchases[id].count++;
        purchases[id].goldSpent += event.goldCost || 0;
      }

      if (event.key === 'itemUse') {
        const id = event.item.knownItemId || event.item.itemId;
        if (!uses[id]) {
          uses[id] = {
            itemId: id,
            displayName: event.item.displayName,
            count: 0
          };
        }
        uses[id].count++;
      }
    });

    this.itemStream = {
      purchases: Object.values(purchases),
      uses: Object.values(uses),
      itemEvents: (this._itemEvents || []).slice()
    };

    // Run inferred-pickup validation FIRST — it can remove events from
    // eventStream, so reconciliation should see the cleaned-up stream.
    this._validateInferredPickups();
    this._runItemReconciliation();
  }

  // Phase B of the A+B creep-drop pickup detector. Phase A buffers
  // candidate right-clicks into this._pendingInferredPickups without
  // touching inventory. Here we:
  //   1. Walk eventStream and collect every itemObjectId pair referenced
  //      in dropItem / sellItem events. These are PROOF that an item with
  //      those oids exists (the game wouldn't emit a drop/trade for a
  //      non-item).
  //   2. For each pending pickup, check if its target oids match the proof
  //      set. If yes — the right-click really WAS a pickup. Emit the
  //      pickupItem event retroactively (inserted into eventStream sorted
  //      by gameTime). False positives (attack-clicks on creeps etc.) are
  //      simply not emitted — inventory was never touched, so nothing to
  //      undo.
  _validateInferredPickups () {
    if (!this._pendingInferredPickups || !this._pendingInferredPickups.length) return;

    const oidKey = (a, b) => `${a}/${b}`;
    const provenItemOids = new Set();
    for (const ev of this.eventStream) {
      if (ev.key === 'dropItem' || ev.key === 'sellItem') {
        const it = ev.item;
        if (it && it.objectId1 != null && it.objectId2 != null) {
          provenItemOids.add(oidKey(it.objectId1, it.objectId2));
        }
      }
    }

    const confirmed = [];
    for (const cand of this._pendingInferredPickups) {
      const key = oidKey(cand.objectId1, cand.objectId2);
      if (!provenItemOids.has(key)) continue;
      // The right-click was a pickup. Emit retroactively.
      const placeholder = {
        displayName: 'Unknown Item',
        itemId: 'Jwid',
        knownItemId: 'Jwid',
        objectId1: cand.objectId1,
        objectId2: cand.objectId2,
        knownItemX: cand.targetX,
        knownItemY: cand.targetY,
        isRegistered: true,
        isUnit: false,
        isBuilding: false,
        isIllusion: false,
        level: 0,
        lastPosition: { x: cand.targetX, y: cand.targetY },
        source: 'pickup-confirmed',
        confidence: 'medium'
      };
      // Narrow the "Unknown Item" to a list of possible items based on
      // the nearest creep camp's drop table. Approach C from the design
      // brief — we don't know which item dropped, but the camp's drop
      // table tells us what it COULD be.
      const campDrops = this._resolveCampDropsForPosition(cand.targetX, cand.targetY);
      confirmed.push({
        key: 'pickupItem',
        gameTime: cand.gameTime,
        item: placeholder,
        unit: cand.heroRef,
        source: 'pickup-confirmed',
        confidence: 'medium',
        isRandomDrop: true,
        actionText: `${cand.heroRef && cand.heroRef.displayName} picks up an unknown ground item (inferred from later drop/trade)`,
        ...(campDrops ? { campUuid: campDrops.campUuid, potentialItems: campDrops.potentialItems } : {})
      });
    }

    if (confirmed.length) {
      // Splice each confirmed pickup into the eventStream at its gameTime
      // position. Sort the final stream by gameTime to keep ordering clean.
      this.eventStream = this.eventStream.concat(confirmed)
        .sort((a, b) => (a.gameTime || 0) - (b.gameTime || 0));
    }
  }

  // Post-parse reconciliation: when uses for a consumable itemId exceed
  // observed purchases + pickups + tradeIns, synthesize "phantom"
  // purchases tagged 'inferred-from-uses' so the BO panel timeline still
  // accounts for the missing acquisition events. These records go onto
  // `this._inferredItems` (NOT into eventStream — they have no clean
  // gameTime). ReplayValidator surfaces them as ITEM_INFERRED_PURCHASE
  // info-severity warnings.
  //
  // Permanent items (rings, orbs, etc.) and tomes are skipped — their use
  // semantics differ (equip-on-pickup, consumed-on-pickup respectively).
  _runItemReconciliation () {
    if (!this._inferredItems) this._inferredItems = [];

    const counts = {};
    this.eventStream.forEach(event => {
      if (event.key === 'itemPurchase' || event.key === 'pickupItem') {
        const id = event.item && event.item.itemId;
        if (!id || id === 'Jwid') return;
        if (!counts[id]) counts[id] = { in: 0, out: 0, displayName: event.item.displayName };
        counts[id].in++;
      } else if (event.key === 'itemUse' || event.key === 'dropItem' || event.key === 'sellItem') {
        const id = event.item && (event.item.knownItemId || event.item.itemId);
        if (!id || id === 'Jwid') return;
        if (!counts[id]) counts[id] = { in: 0, out: 0, displayName: event.item && event.item.displayName };
        counts[id].out++;
      }
    });

    Object.keys(counts).forEach(id => {
      const data = counts[id];
      if (data.out <= data.in) return;
      const itemData = itemAbilityData[id];
      if (!itemData) return;
      const category = itemData.category || itemData.type;
      // Skip categories where use vs. purchase imbalance is expected.
      if (category === 'permanent' || category === 'tome') return;
      const missing = data.out - data.in;
      const goldCost = itemData.goldCost || 0;
      // One consolidated record per itemId — `count` carries the delta so
      // downstream renderers can show "x3 inferred Rod of Necromancy" as a
      // single line instead of seven duplicate warnings.
      this._inferredItems.push({
        itemId: id,
        displayName: data.displayName,
        source: 'inferred-from-uses',
        confidence: 'low',
        goldCost,
        count: missing,
        observedUses: data.out,
        observedPurchases: data.in,
        reason: `Observed ${data.out} uses but only ${data.in} purchases/pickups`,
        playerId: this.id
      });
    });
  }

  recordAction (actionName, action, gameTime) {
    const category = this._classifyAction(actionName, action);
    this._rawActions.push({ gameTime, actionName, actionId: action.id, category });
  }

  _classifyAction (actionName, action) {
    switch (actionName) {
      case 'ChangeSelectionAction':
      case 'AssignGroupHotkeyAction':
      case 'SelectGroupHotkeyAction':
      case 'SelectSubgroupAction':
      case 'UpdateSubgroup':
        return 'select';

      case 'UnitBuildingAbilityActionNoParams': {
        const flags = action.abilityFlags;
        if (flags === 64) return 'cancel';
        if (flags === 66 || flags === 70) return 'build';
        if (flags === 68) return 'build';
        const itemId = action.itemId;
        const orderId0 = Array.isArray(itemId) ? itemId[0] : null;
        if (orderId0 !== null) {
          if (orderId0 >= 40 && orderId0 <= 45) return 'item';
          if (orderId0 >= 34 && orderId0 <= 39) return 'item';
        }
        return 'ability';
      }

      case 'UnitBuildingAbilityActionTargetPosition': {
        const itemId = action.itemId;
        const orderId0 = Array.isArray(itemId) ? itemId[0] : null;
        if (orderId0 === 18) return 'move';
        if (orderId0 === 15) return 'move';
        return 'ability';
      }

      case 'UnitBuildingAbilityActionTargetPositionTargetObjectId': {
        const itemId = action.itemId;
        const orderId0 = Array.isArray(itemId) ? itemId[0] : null;
        if (orderId0 === 3) return 'move';
        if (orderId0 === 15) return 'move';
        return 'ability';
      }

      case 'GiveItemToUnitAciton':
      case 'SelectGroundItemAction':
        return 'item';

      case 'UnitBuildingAbilityActionTwoTargetPositions':
        return 'ability';

      case 'ESCPressedAction':
      case 'RemoveUnitFromBuildingQueue':
      case 'CancelHeroRevival':
        return 'cancel';

      case 'EnterBuildingSubmenu':
      case 'ChooseHeroSkillSubmenu':
      case 'ArrowKeyAction':
        return 'ui';

      default:
        return 'ui';
    }
  }

  buildApmData () {
    if (!this._rawActions.length) {
      this.apmData = {
        raw: { total: 0, average: 0, perMinute: [], peak: 0 },
        effective: { total: 0, average: 0, perMinute: [], peak: 0 },
        categories: {},
        matchDurationMs: 0
      };
      return;
    }

    const matchDuration = this._rawActions[this._rawActions.length - 1].gameTime;
    const totalMinutes = Math.max(1, Math.ceil(matchDuration / 60000));

    const rawPerMinute = new Array(totalMinutes).fill(0);
    const effectivePerMinute = new Array(totalMinutes).fill(0);
    const categories = {};

    let lastAction = null;

    this._rawActions.forEach(action => {
      const minute = Math.min(Math.floor(action.gameTime / 60000), totalMinutes - 1);
      const cat = action.category;

      categories[cat] = (categories[cat] || 0) + 1;

      if (cat === 'ui') return;

      rawPerMinute[minute]++;

      const isDuplicate = lastAction &&
        action.actionName === lastAction.actionName &&
        action.category === lastAction.category &&
        (action.gameTime - lastAction.gameTime) < 300;

      if (!isDuplicate) {
        effectivePerMinute[minute]++;
      }
      lastAction = action;
    });

    const rawTotal = rawPerMinute.reduce((a, b) => a + b, 0);
    const effectiveTotal = effectivePerMinute.reduce((a, b) => a + b, 0);

    this.apmData = {
      raw: {
        total: rawTotal,
        average: Math.round(rawTotal / totalMinutes),
        perMinute: rawPerMinute,
        peak: Math.max(...rawPerMinute)
      },
      effective: {
        total: effectiveTotal,
        average: Math.round(effectiveTotal / totalMinutes),
        perMinute: effectivePerMinute,
        peak: Math.max(...effectivePerMinute)
      },
      categories,
      matchDurationMs: matchDuration
    };
  }
};

module.exports = Player;
