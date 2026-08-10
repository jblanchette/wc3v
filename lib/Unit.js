const mappings = require("../helpers/mappings");
const utils = require("../helpers/utils");
const logManager = require("../helpers/logManager");
const config = require("../config/config");
const { generateFootprints } = require("./footprintGen");
const buildingPathingManifest = require("../helpers/buildingPathing.json");

// Maps a buildingPathing.json entry to the client-facing footprint shape.
// Shared by Building.exportUnit (player buildings, walk-stamp aware) and
// Unit.exportUnit below (neutral buildings — fountains, goldmines, shops —
// are plain Units, never Building instances, but the client's renderBuilding
// requires a footprint on everything flagged isBuilding).
function footprintFromPathingEntry (entry) {
  if (!entry) {
    // No pathing entry (scenario-map oddities) — 1×1 placeholder.
    return { widthTiles: 1, heightTiles: 1, offsetX: 0, offsetY: 0 };
  }
  // Render footprint = walk-block bbox (the area units actually can't
  // enter). Smaller than the full TGA dimensions in most cases.
  const wb = entry.walkBbox;
  if (wb) {
    return {
      widthTiles:  wb.widthTiles,
      heightTiles: wb.heightTiles,
      offsetX:     wb.offsetX,
      offsetY:     wb.offsetY
    };
  }
  // No walk-block cells at all (rare — e.g. waygate). Full TGA bounds.
  return {
    widthTiles:  entry.widthCells / 4,
    heightTiles: entry.heightCells / 4,
    offsetX:     0,
    offsetY:     0
  };
}

const MovementStates = {
  IDLE: "idle",
  WALKING: "walking",
  BUILDING: "building"
};

//
// Position data streams (kept deliberately separate, see CLAUDE.md):
//   - command stream : raw player actions            -> Player.eventStream
//   - route stream   : the A* polyline for a leg     -> Unit.walkPath (ephemeral)
//   - position stream: where the unit actually was   -> Unit.path  (authoritative)
//
// `path` is the authoritative "where was this unit at time T" record. Each A*
// route node already produces a path sample at node-arrival time; moveOnTick
// additionally interpolates currentX/currentY *continuously* along the current
// segment and emits intra-segment samples at this temporal cadence so the
// stream is complete for long/slow segments (footprints, client interpolation,
// camp proximity all read it). The per-segment lerp is exact: each leg is a
// single straight hop between two densified walkable A* nodes.
//
// Cadence is set above a typical densified node duration (~256ms for a 64u hop
// at speed 250) so normal node-arrival samples already satisfy it and we only
// emit *extra* samples on genuinely long/slow legs — bounding the worst-case
// temporal gap during continuous movement without bloating every replay.
//
const POSITION_SAMPLE_MS = 400;

/*

TODO - now that we have units, buildings, items, ect.
       mapped it will be good to break out the not shared bits
       
       likely subclasses -
        * PlayerUnit / EnemyUnit
        * Building
        * Item
        * PlayerShop / MapShop
        * Tavern
*/

const Unit = class {
  constructor (eventTimer, itemId1, itemId2, knownItemId, isSpawnedAtStart = false, summonDuration = null ) {
    this.uuid = utils.uuidv4();
    this.primaryRole = null;
    this.currentTask = null;
    this.roleHistory = [];
    // Form-morph timeline for units whose itemId changes mid-game (Obsidian
    // Statue ⇄ Destroyer, peasant ⇄ militia). `itemId` alone only ever holds
    // the CURRENT/final form, which would make the whole replay render in the
    // end state; the client resolves the form at a given gameTime from this.
    // Entries: { gameTime, itemId }. Empty for units that never morph.
    this.morphHistory = [];
    // True once we OBSERVE an explicit harvest command for this worker (a
    // RightClick on a gold mine or a HarvestLumber order) — as opposed to the
    // spawn-time default role. The viewer only animates/shows workers it is
    // confident are actually harvesting; an uncertain worker (e.g. a ghoul left
    // on rally with no order) stays false and is hidden. Sticky once set.
    this.harvestConfident = false;
    this.eventTimer = eventTimer;
    this.itemId1 = itemId1;
    this.itemId2 = itemId2;

    this.objectId1 = null;
    this.objectId2 = null;

    this.itemId = knownItemId || null;

    this.spawnTime = eventTimer.timer.gameTime;
    this.spawnPosition = null;

    const spawnedAtStartCheck = (itemId1 !== null) && utils.isEqualItemId(itemId1, itemId2);
    this.isSpawnedAtStart = isSpawnedAtStart || spawnedAtStartCheck;

    this.summonEvent = null;  
    this.summonDestroyHandler = null;
    this.summonDuration = summonDuration;

    this.destroyed = false;
    this.destroyedAt = null;
    this.sacrificed = false;         // true if unit was consumed by an ability (detonate, sacrifice, etc.)
    this.scoutInfo = null;           // set when unit is detected scouting outside base

    // training queue state
    this.isTraining = false;            // true while unit is being trained/queued
    this.trainedTime = null;            // gameTime when training completed (null if not trained)
    this._pendingRole = null;           // worker role to assign when training completes
    this._onTrainingComplete = null;    // callback set by Player for supply/role finalization

    // building consumption state
    this.consumedByBuilding = null;     // ref to Building if worker is consumed
    this.buildMechanic = null;          // BuildMechanic enum value
    this.destroyedByBuilding = false;   // true if NE wisp permanently consumed by ancient

    // Build windows: [{start, end}] gameTimes during which this worker is a
    // VISIBLE builder (walking to the site + summoning/constructing on-site).
    // The viewer un-hides the worker during these so an acolyte summoning a
    // building, or a peasant building one, isn't decluttered away. For consumed
    // mechanics (orc peon / NE wisp inside the building) the window ends at
    // ARRIVAL — after that the worker is inside/destroyed and not visible.
    this.buildWindows = [];
    this._openBuildWindow = null;       // the currently-open {start,end:null} object, or null

    // item drop table (neutral creeps only, from war3mapUnits.doo)
    // - droppedItemSets: flat list of every candidate item across all sets
    // - droppedItemSetGroups: [[set1 items], [set2 items], ...] preserving
    //   the per-set independence (each set rolls one item by chance)
    this.droppedItemSets = [];
    this.droppedItemSetGroups = [];

    this.displayName = null;
    this.isBuilding = false;
    this.isUnit = false;
    this.isItem = false;

    // non-selectable things on the map
    // like trees
    
    this.hasBeenInGroup = false;
    this.isRegistered = false;

    this.abilityFlags = null;
    this.spawning = true;

    this.selected = false;

    this.currentX = 0;
    this.currentY = 0;

    this.stuckCounter = 0;

    this.neutralGroupId = null;

    // init and clear move info
    this.clearMoveInfo();

    this.path = [];
    this.moveHistory = [];
    this.state = MovementStates.IDLE;
    this.currentGroupId = null;

    this.isIllusion = false;

    // building stuff
    this.rallyPoint = {
      type: null,
      pt: null,
      objectId1: null,
      objectId2: null
    };

    this.trainedUnits = [];
    this.soldItems = {};

    // hero stuff
    this.heroSlot = 0;
    this.items = {
      1: null,
      2: null,
      3: null,
      4: null,
      5: null,
      6: null
    };

    this.droppedItems = [];
    this.tradedItems = [];

    this.learnedSkills = {};
    this.spells = {};

    this.isIllusion = false;
    this.knownLevel = 0;

    this.levelStream = [];
    this.xpStream = [];

    this.isUprooted = false;
    this.uprootStream = [];

    // item stuff
    this.knownOwner = false;
    this.knownItemX = null;
    this.knownItemY = null;

    // export data streams

    // set unit info + meta
    this.setUnitMeta();

    if (this.summonDuration) {
      console.logger("Created summon unit:", this.displayName, "duration:", summonDuration, "uuid:", this.uuid);

      this.startSummonTimer();
    }

    console.logger("spawned unit: ", this.uuid, this.spawnPosition, this.displayName);
  }

  // confident: set true only from observed harvest commands (RightClick gold
  // mine / HarvestLumber). The spawn-time default and training fall-through pass
  // false. harvestConfident is sticky-true so a worker that ever demonstrably
  // harvested stays a "known harvester" for the viewer's visibility gate.
  setWorkerRole (role, gameTime, confident = false) {
    const oldRole = this.primaryRole;
    const oldTask = this.currentTask;

    if (confident) this.harvestConfident = true;

    if (role !== this.primaryRole) {
      this.primaryRole = role;
      this.roleHistory.push({ gameTime, role });
    }
    this.currentTask = role;

    if (config.debugWorkers) {
      const tracer = logManager.getTracer();
      if (oldRole !== this.primaryRole) {
        tracer.traceWorkerMutation({
          gameTime, playerId: null,
          unitUuid: this.uuid, unitName: this.displayName,
          field: 'primaryRole', oldValue: oldRole, newValue: this.primaryRole,
          caller: 'setWorkerRole'
        });
      }
      if (oldTask !== this.currentTask) {
        tracer.traceWorkerMutation({
          gameTime, playerId: null,
          unitUuid: this.uuid, unitName: this.displayName,
          field: 'currentTask', oldValue: oldTask, newValue: this.currentTask,
          caller: 'setWorkerRole'
        });
      }
    }
  }

  // --- Building consumption helpers ---

  isConsumedByBuilding () {
    return this.consumedByBuilding !== null;
  }

  consumeForBuilding (building, mechanic) {
    this.consumedByBuilding = building;
    this.buildMechanic = mechanic;
  }

  releaseFromBuilding (gameTime) {
    this.consumedByBuilding = null;
    this.buildMechanic = null;
    this.currentTask = this.primaryRole || 'gold';
  }

  // --- Build-window tracking (viewer un-hides a worker while it builds) ---
  // The window object is pushed into buildWindows immediately (end=null) and
  // closed in place, so a window still open at replay end exports as ongoing.
  // Both helpers are idempotent — the moveToBuild callback can fire repeatedly.
  openBuildWindow (gameTime) {
    if (this._openBuildWindow) return;
    const w = { start: gameTime, end: null };
    this._openBuildWindow = w;
    this.buildWindows.push(w);
  }

  closeBuildWindow (gameTime) {
    if (!this._openBuildWindow) return;
    this._openBuildWindow.end = gameTime;
    this._openBuildWindow = null;
  }

  clearMoveInfo () {
    this.moveInfo = {
      timerEvent: null,
      timeElapsed: 0,
      distance: 0,
      startX: 0,
      startY: 0,
      targetX: 0,
      targetY: 0,
      xDirection: 0,
      yDirection: 0,
      pathDistance: 0,
      pathTime: 0,
      xVelocity: 0,
      yVelocity: 0,
      onCompleteCallback: null
    };
  }

  setSpawnPosition (x, y) {
    this.currentX = x;
    this.currentY = y;

    this.spawnPosition = { x, y };

    // Register with the collision world UNLESS this unit is still training
    // (it doesn't physically exist yet — Building._startNextTraining adds it
    // when training completes). Also skipped for buildings (stamped statically
    // by Player.addPlayerBuilding), air units, and items.
    if (this._collisionWorld && !this.isTraining) {
      this._collisionWorld.addUnit(this);
    }

    this.recordPosition();
  }

  // Mark the unit as having teleported (TP scroll, Mass Teleport, Blink, etc.).
  // Snaps currentX/Y and emits an isJump=true path sample so downstream code
  // (tracker box, proximity scan, trip detection) treats the segment as a
  // discontinuous jump rather than smooth movement.
  //
  // Carefully clears any in-flight walk plan: there's a scheduled EventTimer
  // event whose onComplete reads `this.walkPath.length`. We cancel that event
  // first, then reset walkPath to an empty array (NOT null) so any other
  // length-reads survive a teleport that interrupts movement.
  teleportTo (x, y) {
    if (this.destroyed) return;
    if (this.moveInfo && this.moveInfo.timerEvent) {
      this.eventTimer.cancelEvent(this.moveInfo.timerEvent);
    }
    this.walkPath = [];
    this.moveInfo = null;
    this.currentX = x;
    this.currentY = y;
    this.recordPosition(true);   // isJump=true
  }

  setNeutralGroupId (groupId) {
    this.neutralGroupId = groupId;
  }

  startSummonTimer () {
    if (this.summonEvent) {
      console.logger("ERROR - summon already has summon event?");
      
      return;
    }

    this.summonEvent = this.eventTimer.addEvent(
      this.summonDuration * utils.SECONDS_TO_MS, 
      this.summonOnTick.bind(this),
      this.summonOnComplete.bind(this)
    );
  }

  setSummonDestroyHandler (destroyHandler) {
    this.summonDestroyHandler = destroyHandler;
  }

  summonOnTick (gameTime, delta) {
    // no-op
  }

  summonOnComplete (eventFinished) {
    this.destroyed = true;
    this.summonDestroyHandler();
  }

  setAliveFlags () {
    this.spawning = false;
  }

  setUnitMeta () {
    const { 
      displayName, 
      isBuilding, 
      isUnit,
      isItem,
      isFountain,
      isCritter,
      isInteractiveShop,
      isPlayerShop,
      isGoldmine,
      meta,
      balanceInfo
    } = mappings.getUnitInfo(this.itemId);

    this.displayName = displayName;
    this.isBuilding = isBuilding;
    this.isUnit = isUnit;
    this.isItem = isItem;
    this.isFountain = isFountain;
    this.isCritter = isCritter;
    this.isInteractiveShop = isInteractiveShop;
    this.isPlayerShop = isPlayerShop;
    this.isGoldmine = isGoldmine;
    this.isMercenary = false;

    // Transport state
    const TRANSPORT_UNIT_IDS = { 'nzep': true, 'nbot': true, 'okod': true };
    this.isTransport = !!TRANSPORT_UNIT_IDS[this.itemId];
    this.cargo = [];
    this.loadedInto = null;
    this.loadEvents = [];

    this.meta = meta;
    this.balanceInfo = balanceInfo;
  }

  //
  // Change a unit's form mid-game (Obsidian Statue ⇄ Destroyer, peasant ⇄
  // militia). Assigning `itemId` on its own is NOT enough — displayName, meta,
  // combat/movement tables and balanceInfo all key off it, and a unit that
  // skips setUnitMeta() keeps reporting the old form's name, speed and attack.
  //
  // setUnitMeta() rebuilds identity from scratch, so transport/mercenary state
  // (which it also resets) is carried across explicitly — a morph is not a
  // re-registration and must not drop cargo.
  //
  // Returns true when the form actually changed.
  //
  morphTo (itemId, gameTime) {
    this.checkDestroyed();
    if (!itemId || itemId === this.itemId) return false;

    const carried = {
      isMercenary: this.isMercenary,
      cargo: this.cargo,
      loadedInto: this.loadedInto,
      loadEvents: this.loadEvents
    };

    const fromItemId = this.itemId;
    const fromDisplayName = this.displayName;
    this.itemId = itemId;
    this.setUnitMeta();

    this.isMercenary = carried.isMercenary;
    this.cargo = carried.cargo;
    this.loadedInto = carried.loadedInto;
    this.loadEvents = carried.loadEvents;

    // Each entry is self-describing — both sides of the change, id AND name —
    // so the client can reconstruct the unit's identity at any game time. The
    // exported `itemId`/`displayName` are only ever the FINAL form, and without
    // the names here a statue would be labelled "Destroyer" from the first
    // frame of the replay, long before it morphs.
    const at = gameTime != null ? gameTime : this.eventTimer.timer.gameTime;
    this.morphHistory.push({
      gameTime: at,
      itemId,
      displayName: this.displayName,
      from: fromItemId,
      fromDisplayName
    });

    console.logger("unit morphed:", this.uuid, "->", itemId, this.displayName, "@", at);
    return true;
  }

  checkDestroyed () {
    if (this.destroyed) {
      console.logger("ERROR - tried to assign to destroyed unit");
    }
  }

  unregisterObjectIds () {
    // Notify world registry BEFORE we null the ids — registry lookup keys
    // off the current (objectId1, objectId2). bindToWorld may not have been
    // called (e.g. unknownObjects path in World.addUnknownObject) — guard.
    if (this._registryWorld && this.objectId1 != null && this.objectId2 != null) {
      this._registryWorld.unregisterUnit(this);
    }

    // Remove from dynamic collision tree if present. Idempotent.
    if (this._collisionWorld) {
      this._collisionWorld.removeUnit(this);
    }

    this.objectId1 = null;
    this.objectId2 = null;

    this.isRegistered = false;
  }

  // Optional binding for cross-player unit lookups. Owning Player calls this
  // from addPlayerUnit/addPlayerBuilding so subsequent registerObjectIds()
  // mirrors the unit into world.unitRegistry. Idempotent.
  bindToWorld (world, ownerPlayerId, ownerTeamId) {
    if (!world) return;
    this._registryWorld = world;
    this._registryOwnerPlayerId = ownerPlayerId;
    this._registryOwnerTeamId = (ownerTeamId == null ? null : ownerTeamId);
    // Hand the unit a reference to the collision world so recordPosition()
    // can snap-to-free and the lifecycle hooks below can register/unregister.
    this._collisionWorld = world.collisionWorld || null;
    // If ids are already set, register immediately (some paths set ids before
    // the Player wires up addPlayerUnit — e.g. early-registered buildings).
    if (this.objectId1 != null && this.objectId2 != null) {
      world.registerUnit(this, ownerPlayerId, this._registryOwnerTeamId);
    }
  }

  unregisterItemIds () {
    this.itemId1 = null;
    this.itemId2 = null;

    this.isRegistered = false;
  }

  registerItemIds (itemId1, itemId2) {
    this.checkDestroyed();

    this.itemId1 = itemId1;
    this.itemId2 = itemId2;

    this.hasBeenInGroup = true;
    this.checkRegistered();
  }

  registerObjectIds (objectId1, objectId2) {
    this.checkDestroyed();

    this.objectId1 = objectId1;
    this.objectId2 = objectId2;

    if (this.objectId1 === this.objectId2 &&
        !this.isSpawnedAtStart) {
      this.isSpawnedAtStart = true;
    }

    this.hasBeenInGroup = true;
    this.checkRegistered();

    // Mirror into the cross-player registry if this unit was bound to a Player.
    if (this._registryWorld) {
      this._registryWorld.registerUnit(
        this, this._registryOwnerPlayerId, this._registryOwnerTeamId
      );
    }
  }

  registerKnownItem (x, y) {
    this.checkDestroyed();

    this.knownItemX = x;
    this.knownItemY = y;
  }

  registerUnit (itemId, objectId1, objectId2) {
    this.checkDestroyed();

    this.itemId = itemId;
    this.objectId1 = objectId1;
    this.objectId2 = objectId2;

    if (this.objectId1 === this.objectId2 &&
        !this.isSpawnedAtStart) {
      this.isSpawnedAtStart = true;
    }

    this.setUnitMeta();
    this.hasBeenInGroup = true;

    this.checkRegistered();

    // Mirror into the cross-player registry if this unit was bound to a Player.
    if (this._registryWorld) {
      this._registryWorld.registerUnit(
        this, this._registryOwnerPlayerId, this._registryOwnerTeamId
      );
    }
  }

  checkRegistered () {
    if (this.isRegistered) {
      return;
    }
    
    if (this.objectId1 && this.objectId2 && this.itemId1 && this.itemId2) {
      this.isRegistered = true;
    }
  }

  getNextItemSlot () {
    let itemSlotId = Object.keys(this.items).find(key => {
      return this.items[key] === null;
    });

    if (itemSlotId === -1) {
      console.logger("Unable to find item slot for unit. ", self.displayName, itemId);
      return;
    }

    return itemSlotId;
  }

  setItemSlot (slot, item) {
    if (item) {
      item.setSlot(slot);
    }

    this.items[slot] = item;
  }

  tradeItem (item) {
    this.checkDestroyed();

    if (item) {
      // item cooldowns reset when you trade items
      item.setCooldownState(false);
    }

    this.setItemSlot(this.getNextItemSlot(), item);
    item.knownOwner = true;
  }

  getItemList () {
    let knownItems = Object.keys(this.items).filter(key => {
      return this.items[key] !== null;
    });

    return knownItems.map(key => {
      return {
        slot: key,
        item: this.items[key]
      };
    });
  }

  // Phase B: return slotted items AND any pending (un-slotted) items.
  // Used by sell-back resolution where a player can sell the auto-grant
  // before its slot has been observed empirically. Pending entries have
  // slot=null and a pending=true marker. Callers that need a stable
  // {slot} field should keep using getItemList(); only those that
  // explicitly handle slot=null should call this variant.
  getItemListWithPending () {
    const out = this.getItemList();
    if (Array.isArray(this._pendingItems) && this._pendingItems.length) {
      for (const it of this._pendingItems) {
        out.push({ slot: null, item: it, pending: true });
      }
    }
    return out;
  }

  spawn () {
    this.spawning = false;
  }

  select () {
    this.selected = true;
  }

  deselect () {
    this.selected = false;
  }

  getSkillForType (skillType) {
    let skillKey = Object.keys(this.learnedSkills).find(key => {
      let learnedSkill = this.learnedSkills[key];

      return learnedSkill.type === skillType;
    });

    if (!skillKey) return null;

    return {
      ...mappings.heroAbilities[skillKey],
      level: this.learnedSkills[skillKey].level,
      skillKey: skillKey
    };
  }

  recordMoveHistory () {
    let history = this.moveInfo;

    const { 
      startTime, 
      endTime, 
      runLength,
      completed,
      cancelled
    } = history.timerEvent;

    //delete history.timerEvent;
    //delete history.onCompleteCallback;

    history.timerData = {
      startTime, 
      endTime: endTime | 0, 
      runLength,
      completed,
      cancelled
    };

    // tigthen float precision
    Object.keys(history).forEach((key) => {
      if (typeof history[key] !== 'number') {
        return;
      }

      history[key] = +history[key].toFixed(2);
    });

    this.moveHistory.push(history);
  }

  // atGameTime: when provided, the sample is stamped with the deterministic
  // physics walk-clock time (command time + cumulativeDistance/speed) instead
  // of the EventTimer's process time. EventTimer.onComplete fires LATE on
  // sparse replay ticks, so using process time made every hop's dt too long
  // (~20% uniform "floaty" slowness). The physics clock makes each recorded
  // segment's speed exactly the unit's movespeed. Kept monotonic per unit.
  recordPosition (isJump = false, atGameTime = null) {
    let gt = (atGameTime != null) ? atGameTime : this.eventTimer.timer.gameTime;
    if (this._lastRecordedTime != null && gt < this._lastRecordedTime) {
      gt = this._lastRecordedTime;
    }
    this._lastRecordedTime = gt;

    // Snap-to-free: ensure no two units share the same coordinate. Jumps
    // (teleport, blink, revive) are intentional discontinuities — skip snap.
    // Buildings/air units never enter the dynamic tree, so resolvePosition
    // is a no-op for them (collisionEntry === null path).
    let snapped = false;
    if (this._collisionWorld && !isJump && this._collisionEntry) {
      const resolved = this._collisionWorld.resolvePosition(this, this.currentX, this.currentY);
      if (resolved.snapped) {
        this.currentX = resolved.x;
        this.currentY = resolved.y;
        snapped = true;
      }
      this._collisionWorld.moveUnit(this, this.currentX, this.currentY);
    }

    const record = {
      x: +this.currentX.toFixed(2),
      y: +this.currentY.toFixed(2),
      gameTime: Math.round(gt),
      isJump: isJump
    };
    if (snapped) record.wasSnapped = true;
    if (this.currentGroupId) record.groupId = this.currentGroupId;
    this.path.push(record);
  }

  performBackfill (backfill) {
    const self = this;

    console.logger("performing backfill for", this.displayName, "length: ", backfill.length, this.meta);



    // TODO: simulate with timers
    backfill.forEach((action, index) => {
      const { target } = action;
      const { x, y } = target;

      self.path.push({
        x: x,
        y: y,
        isJump: false
      });

      // TODO: remove after we simulate
      if (index === (backfill.length - 1)) {
        console.logger(`setting last backfill pos: (${x}, ${y})`);
        self.currentX = x;
        self.currentY = y;
      }
    });
  }

  reviveAtSpot (world, targetX, targetY) {
    console.logger("calling reviveAtSpot: ", this.displayName, targetX, targetY);

    this.currentX = targetX;
    this.currentY = targetY;

    if (this.moveInfo.timerEvent) {
      // stop all moving
      this.eventTimer.cancelEvent(this.moveInfo.timerEvent);
    }

    // record jump move
    this.recordPosition(true);
  }

  setState (state) {
    this.state = state;
  }

  /**
   * Record a COMBAT-RELEVANT order on this unit.
   *
   * The replay's only surviving record of intent used to be `path[]` plus a
   * workers-only `combatOrderTimes`. That left the viewer re-deriving every
   * attack purely from geometry, and it is why an army standing in a fight the
   * BattleDetector did not cluster renders as idle.
   *
   * Deliberately NOT recorded: plain `move` and smart-clicks onto empty ground.
   * The path already says where the unit went, and a high-APM player issues
   * thousands of them — recording all of them would balloon the .wc3v for no
   * behavioural information.
   *
   *   kind — 'attack' | 'attackground' | 'attackonce' | 'patrol'
   *          | 'holdposition' | 'stop'
   *   opts — { x, y, targetUuid }
   *
   * Debounced at ORDER_DEBOUNCE_MS per (unit, kind): players spam-click during
   * fights and every click is the same intent.
   */
  recordOrder (gameTime, kind, opts) {
    if (!kind) return;
    if (!this.orders) this.orders = [];
    const last = this.orders[this.orders.length - 1];
    if (last && last.kind === kind && (gameTime - last.t) < Unit.ORDER_DEBOUNCE_MS) {
      // Same intent, still fresh — refresh the target rather than appending.
      if (opts && opts.targetUuid) last.targetUuid = opts.targetUuid;
      return;
    }
    if (this.orders.length >= Unit.MAX_ORDERS) return;
    const entry = { t: gameTime, kind };
    if (opts) {
      if (Number.isFinite(opts.x)) entry.x = Math.round(opts.x);
      if (Number.isFinite(opts.y)) entry.y = Math.round(opts.y);
      if (opts.targetUuid) entry.targetUuid = opts.targetUuid;
    }
    this.orders.push(entry);
  }

  checkStateForMove () {
    if (this.state === MovementStates.IDLE) {
      return;
    }

    console.logger("cancel move event for unit:", this.uuid, "state: ", this.state);
    // we detected the unit had been walking
    // and the player cancelled the action by
    // sending another move command.

    if (this.moveInfo.timerEvent) {
      if (this.moveInfo.onCompleteCallback) {
        this.moveInfo.onCompleteCallback(false);
      }

      this.eventTimer.cancelEvent(this.moveInfo.timerEvent);
    }
  }

  moveToBuild (world, building, onComplete) {
    const { currentX, currentY } = building;
    const walkInfo = world.pathFinder.findPath(
      this.currentX, this.currentY,
      currentX, currentY
    );

    // cancel any existing movement before clearing (must read timerEvent before clearMoveInfo resets it)
    if (this.moveInfo.timerEvent) {
      this.eventTimer.cancelEvent(this.moveInfo.timerEvent);
    }

    this.clearMoveInfo();

    const { isDifferentSpot, walkPath } = walkInfo;

    this.setState(MovementStates.BUILDING);

    if (!walkPath.length) {
      // No path found (unit already at target, or pathfinder can't route there).
      // The build command was valid (the game accepted it), so finalize immediately.
      // This matches moveTo() behavior for empty paths.
      if (onComplete) {
        onComplete(true);
      }
      return;
    }

    this.walkPath = walkPath;
    this.moveOnStart(onComplete);
  }

  moveTo (world, walkInfo, targetX, targetY, onCompleteCallback = null, updateState = null) {
    this.checkStateForMove();

    if (updateState) {
      // change our state after checking for previous events to clear
      this.state = updateState;
    }

    // remember the commanded final destination + when this real repath was
    // issued, so the command layer can merge/debounce inconsequential repeat
    // clicks (battle spam) instead of springing the unit on every one.
    this._moveTarget = { x: targetX, y: targetY };
    this._lastRepathTime = this.eventTimer.timer.gameTime;

    const { isDifferentSpot, walkPath } = walkInfo;

    if (walkPath.length) {
      this.stuckCounter = 0;
      this.walkPath = walkPath;
      this.moveOnStart(onCompleteCallback);
    } else {
      this.walkPath = [];

      console.logger("WARN - no path found, current: ", 
        this.currentX, this.currentY, "target:", targetX, targetY);

      if (onCompleteCallback) {
        onCompleteCallback(true);
      }
    }
  }

  moveOnStart (onCompleteCallback = null, isLegChain = false) {
    if (!this.walkPath.length) {
      return;
    }

    this.state = MovementStates.WALKING;

    //
    // Anchor a deterministic walk clock at the START of a fresh walk (a new
    // move command), NOT when chaining to the next densified node. Recorded
    // sample times then derive from (commandTime + cumulativeDist/speed) so
    // the whole multi-node route is one contiguous constant-speed timeline,
    // immune to sparse/late EventTimer ticks. (Chained legs keep the clock.)
    //
    if (!isLegChain || this._walkClock == null) {
      this._walkClock = this.eventTimer.timer.gameTime;
      if (this._lastRecordedTime != null && this._walkClock < this._lastRecordedTime) {
        this._walkClock = this._lastRecordedTime;
      }
      this._walkDist = 0;
      // anchor the route's start point at the exact command time
      this.recordPosition(false, this._walkClock);
    }

    const pathNode = this.walkPath.shift();

    const targetX = pathNode.x;
    const targetY = pathNode.y;

    if (pathNode.weight === 0) {
      console.log("WARN - about to move a unit into a blocked space.", this.displayName, this.uuid);
    }

    const pathDistance = utils.distance(
      this.currentX, this.currentY,
      targetX, targetY
    );

    const ms = this.effectiveMovespeed();

    // time = distance / speed
    // time (seconds) = units / units per second
    const pathTime = (pathDistance / ms);

    this.moveInfo = {
      timerEvent: null,
      timeElapsed: 0,
      distance: 0,
      startX: this.currentX,
      startY: this.currentY,
      targetX: targetX,
      targetY: targetY,
      xDirection: (targetX > this.currentX) ? 1 : -1,
      yDirection: (targetY > this.currentY) ? 1 : -1,
      pathDistance: pathDistance,
      pathTime: pathTime,
      xVelocity: (Math.abs(targetX - this.currentX) / pathTime),
      yVelocity: (Math.abs(targetY - this.currentY) / pathTime),
      onCompleteCallback: onCompleteCallback,
      // deterministic physics window for THIS leg (ms), contiguous across legs
      legStartTime: this._walkClock + ((this._walkDist / ms) * 1000),
      legMs: pathTime * 1000
    };

    this.moveInfo.timerEvent = this.eventTimer.addEvent(
      pathTime * utils.SECONDS_TO_MS, // how long it takes to finish the event in ms
      this.moveOnTick.bind(this),
      (eventFinished) => {
        this.moveOnEventComplete(eventFinished, this.walkPath.length);
      }
    );

    // reset the intra-segment sampling clock for this leg
    this._lastPosSampleTime = this.eventTimer.timer.gameTime;

    if (this.isSpawnedAtStart && !this.path.length && !this.meta.hero) {
      this.currentX = targetX;
      this.currentY = targetY;

      console.logger("Cancelling event for unit spawned at start. ", this.uuid);
      this.eventTimer.cancelEvent(this.moveInfo.timerEvent);
    }
  }

  //
  // Single seam for the unit's current movement speed (world units / sec).
  //
  // meta.movespeed is the unit's real WC3 base speed (SLK `spd`, merged in
  // helpers/mappings.js getUnitInfo from helpers/unitMovement.json); the 250
  // fallback only applies to the handful of itemIds with no movement data.
  //
  // Honest limitation: WC3 movespeed modifiers (haste/slow auras, items,
  // unholy/endurance aura, etc.) are NOT recorded in the replay as state, so
  // we cannot know them precisely. Base speed is the correct, non-fabricated
  // baseline. A future movespeedModifierStream can adjust the return value
  // here without touching the simulator; downstream confidence scoring is
  // responsible for down-weighting certainty when speed modifiers may apply.
  //
  effectiveMovespeed (/* gameTime */) {
    return (this.meta && this.meta.movespeed) || 250;
  }

  //
  // Called every EventTimer tick while a move leg is in flight. Interpolates
  // currentX/currentY linearly along the current straight A* segment by the
  // fraction of the leg's duration elapsed, so any consumer reading
  // currentX/currentY mid-move (camp proximity, etc.) sees the true position.
  // Emits an intra-segment position sample at POSITION_SAMPLE_MS cadence.
  //
  moveOnTick (gameTime, delta) {
    const mi = this.moveInfo;
    if (!mi || !mi.timerEvent) {
      return;
    }

    const ev = mi.timerEvent;
    const run = ev.runLength;

    let frac = (run > 0) ? ((gameTime - ev.startTime) / run) : 1;
    if (frac < 0) frac = 0;
    else if (frac > 1) frac = 1;

    this.currentX = mi.startX + ((mi.targetX - mi.startX) * frac);
    this.currentY = mi.startY + ((mi.targetY - mi.startY) * frac);

    if (this._lastPosSampleTime == null) {
      this._lastPosSampleTime = ev.startTime;
    }

    if ((gameTime - this._lastPosSampleTime) >= POSITION_SAMPLE_MS) {
      this._lastPosSampleTime = gameTime;
      // stamp with the deterministic physics time for this fraction of the
      // leg (not the late EventTimer process time) so recorded speed == ms
      this.recordPosition(false, mi.legStartTime + (frac * mi.legMs));
    }
  }

  moveOnEventComplete (eventFinished, pathLength) {
    const mi = this.moveInfo;
    const {
      targetX,
      targetY,
      onCompleteCallback
    } = mi;

    if (eventFinished === false) {
      //
      // Leg interrupted before arrival (redirect via checkStateForMove,
      // reviveAtSpot, moveToBuild, or the spawned-at-start optimization).
      // The unit did NOT reach the node target — keep the interpolated
      // position set by the last moveOnTick and record the real interrupt
      // spot at its deterministic physics time. Do NOT auto-continue the
      // stale walkPath and do NOT invoke onCompleteCallback — the canceller
      // (e.g. checkStateForMove) already handled it. Next fresh moveOnStart
      // re-anchors the walk clock.
      //
      const ev = mi.timerEvent;
      let frac = (ev && ev.runLength > 0)
        ? ((this.eventTimer.timer.gameTime - ev.startTime) / ev.runLength) : 0;
      if (frac < 0) frac = 0; else if (frac > 1) frac = 1;
      if (this._walkDist != null) this._walkDist += (mi.pathDistance * frac);
      this.recordPosition(false, mi.legStartTime + (frac * mi.legMs));
      this.state = MovementStates.IDLE;
      this._moveTarget = null;

      return;
    }

    // natural arrival — snap exactly to the node target at its exact
    // deterministic completion time (immune to the late detecting tick)
    this.currentX = targetX;
    this.currentY = targetY;
    if (this._walkDist != null) this._walkDist += mi.pathDistance;
    this.recordPosition(false, mi.legStartTime + mi.legMs);

    if (pathLength >= 1) {
      // more nodes left — continue to the next segment, KEEPING the walk
      // clock so the multi-node route stays one contiguous constant-speed
      // timeline (no per-node micro-pauses).
      this.moveOnStart(onCompleteCallback, true);

      return;
    }

    // nothing left in the path — back to idle
    this.state = MovementStates.IDLE;
    this._moveTarget = null;

    console.logger("checking unit on complete callback: ", this.uuid);
    if (onCompleteCallback) {
      console.logger("running unit on complete callback: ", this.uuid, eventFinished);
      onCompleteCallback(eventFinished);
    }
  }

  //
  // 
  //

  exportUnitReference () {
    const self = this;

    return {
      displayName:   self.displayName,
      itemId:        self.itemId,

      // TODO: why export these?
      itemId1:       self.itemId1 && self.itemId1.toString(),
      itemId2:       self.itemId2 && self.itemId2.toString(),
      objectId1:     self.objectId1,
      objectId2:     self.objectId2,
      // TODO
      isRegistered:  self.isRegistered,
      isUnit:        self.isUnit,
      isBuilding:    self.isBuilding,
      isIllusion:    self.isIllusion,
      isHero:        self.meta.hero,
      isSummon:      (self.summonDuration && self.summonDuration > 0) ? true : false,
      isMercenary:   !!self.isMercenary,
      isPlayerShop:  !!self.isPlayerShop,
      level:         self.knownLevel,
      lastPosition:  { x: self.currentX, y: self.currentY },
      goldCost:      (self.balanceInfo && self.balanceInfo.goldCost) || 0,
      lumberCost:    (self.balanceInfo && self.balanceInfo.lumberCost) || 0,
      foodUsed:      (self.balanceInfo && self.balanceInfo.foodUsed) || (self.meta && self.meta.hero ? 5 : 0),
      foodMade:      (self.balanceInfo && self.balanceInfo.foodMade) || 0,
      buildTime:     (self.balanceInfo && self.balanceInfo.buildTime) || 0,
      armorType:     (self.balanceInfo && self.balanceInfo.armorType) || null,
      attackType:    (self.balanceInfo && self.balanceInfo.attackType) || null,
      collisionSize: (self.balanceInfo && self.balanceInfo.collisionSize) || 0,
      uuid:          self.uuid,
      assignTarget:  self.primaryRole,
      roleHistory:   self.roleHistory,
      // Only present for units that actually changed form — keeps the export
      // clean for the ~99% of units that never morph.
      ...(self.morphHistory && self.morphHistory.length
        ? { morphHistory: self.morphHistory }
        : {}),
      isTraining:    self.isTraining,
      isConsumedByBuilding: self.isConsumedByBuilding(),
      destroyedByBuilding:  self.destroyedByBuilding,
      buildMechanic: self.buildMechanic,
      ...(self.sacrificed ? { sacrificed: true } : {}),
      ...(self.destroyedAt ? { destroyedAt: self.destroyedAt } : {}),
      ...(self.scoutInfo ? { scoutInfo: self.scoutInfo } : {}),
    };
  }

  //
  // used to export cleand unit JSON data
  //

  exportUnit () {
    const self = this;

    return {
      uuid:           self.uuid,
      displayName:    self.displayName,
      itemId:         self.itemId,
      itemId1:        self.itemId1 && self.itemId1.toString(),
      itemId2:        self.itemId2 && self.itemId2.toString(),
      objectId1:      self.objectId1,
      objectId2:      self.objectId2,
      isRegistered:   self.isRegistered,
      isUnit:         self.isUnit,
      isBuilding:     self.isBuilding,
      isIllusion:     self.isIllusion,
      level:          self.knownLevel,
      levelStream:    self.levelStream,
      xpStream:       self.xpStream,
      spellList:      self.spellList,
      lastPosition:   { x: self.currentX, y: self.currentY },
      spawnTime:      self.spawnTime,
      trainedTime:    self.trainedTime,
      spawnPosition:  self.spawnPosition,
      path:           self.path,
      // Pre-pass: deterministic footstep stamps for hero trail rendering.
      // Computed once at parse time so the client always renders identically.
      ...(self.meta && self.meta.hero ? { footprints: generateFootprints(self.path) } : {}),
      // `moveHistory` is deliberately NOT exported. It has been empty in every
      // unit of every parsed replay (verified: 0 of 215 units carry an entry) —
      // recordMoveHistory exists but nothing on the live path calls it — so it
      // was a key per unit costing bytes and implying a record that isn't there.
      // ClientUnit._computeInitialActivityTime still guards for it.
      // Form-morph timeline (statue → Destroyer). THIS is the copy the client
      // reads — ClientUnit is built from exportUnit, not exportUnitReference —
      // and without it the viewer renders the final form for the whole replay.
      // Omitted entirely for the units that never morph, which is nearly all.
      ...(self.morphHistory && self.morphHistory.length
        ? { morphHistory: self.morphHistory }
        : {}),
      neutralGroupId: self.neutralGroupId,
      collisionSize:  (self.balanceInfo && self.balanceInfo.collisionSize) || 0,
      // Neutral buildings (fountain, goldmine, shop, tavern...) reach the
      // client through this base exporter — renderBuilding hard-requires a
      // footprint on anything isBuilding. Building.exportUnit overrides this
      // with its walk-stamp-aware version for player buildings.
      ...(self.isBuilding
        ? { footprint: footprintFromPathingEntry(buildingPathingManifest.buildings[self.itemId]) }
        : {}),
      // Tier/branch upgrade history (hall tiers, tower and ziggurat upgrades):
      // itemId above is the FINAL form; these are the completion times that
      // let the viewer window each form's model.
      ...(self.isBuilding && self.upgradeSteps && self.upgradeSteps.length
        ? { upgradeSteps: self.upgradeSteps, initialItemId: self.initialItemId }
        : {}),
      isInferred:     self.isInferred || false,
      lostState:      self.lostState || null,
      hiddenStream:   self.hiddenStream || null,
      // Combat-relevant order stream — see Unit.recordOrder. This is the intent
      // record the viewer never had: attack / attack-ground / attack-once /
      // patrol / hold / stop, with the resolved enemy uuid when the player
      // clicked directly on one.
      ...(self.orders && self.orders.length ? { orders: self.orders } : {}),
      // gameTimes at which this unit received an attack/attack-move order.
      // Only retained for workers (used by the client to surface a worker
      // that was pulled to fight, e.g. an acolyte defending the base).
      // DERIVED from `orders` now; kept as its own field because the client's
      // worker-declutter uses a different (12s) window than the attack license.
      ...(self.combatOrderTimes && self.combatOrderTimes.length
        ? { combatOrderTimes: self.combatOrderTimes } : {}),
      // A living summon. exportUnitReference has always set this, but exportUnit
      // — the copy ClientUnit is actually built from — only ever got it via the
      // destroyedSummons concat in helpers/utils.js, so a summon was unflagged
      // for its whole life. Four client modules carry hardcoded id sets to work
      // around that.
      ...(self.summonDuration > 0
        ? {
          isSummon: true,
          summonDuration: self.summonDuration,
          // Who cast it and when. A summon spawns already aggressive in WC3, so
          // the caster's combat context at that moment is what the viewer needs
          // to know the summon is in the fight.
          ...(self.summonedByUuid ? { summonedBy: self.summonedByUuid } : {}),
          ...(self.summonTime != null ? { summonTime: self.summonTime } : {})
        }
        : {}),
      // gameTimes at which a worker was ordered to repair THIS building. Only
      // ever set on buildings, and only for human peasants — peons and wisps can
      // repair in game, but the parser does not yet distinguish their
      // right-click on an own building from the other things it can mean.
      ...(self.repairOrderTimes && self.repairOrderTimes.length
        ? { repairOrderTimes: self.repairOrderTimes } : {}),
      // Assigned harvest role ('gold' | 'lumber' | null). Lets the client treat
      // a lumber GHOUL (meta.worker is false, but it harvests) as a harvester
      // for declutter — hidden while chopping, shown when pulled to fight.
      ...(self.primaryRole ? { primaryRole: self.primaryRole } : {}),
      // True only when an explicit harvest command was observed (not the spawn
      // default). The 3D viewer hides workers it isn't confident are harvesting
      // (e.g. a freshly-trained ghoul left idle on rally next to its building).
      ...(self.harvestConfident ? { harvestConfident: true } : {}),
      // Time windows (gameTime ms) when this worker is a VISIBLE builder
      // (walking to / summoning / constructing). The viewer un-hides it then.
      ...(self.buildWindows && self.buildWindows.length ? { buildWindows: self.buildWindows } : {}),
      meta:           self.meta,

      items: self.getItemList().map(heroSlot => {
        const { item, slot } = heroSlot;

        const {
          itemId,
          displayName,
          knownItemX,
          knownItemY,
          objectId1,
          objectId2,
          // Item lifecycle + provenance (Phase 2 ledger). Including these
          // lets the client render charge counters on inventory slots and
          // show provenance hints on hover (e.g. "Picked up from creep
          // camp" vs "Bought from Goblin Merchant").
          expires,
          usesLeft,
          onCooldown,
          knownItemId,
          source,
          confidence,
          acquiredAt,
          lastModifiedAt,
          knownObjectId
        } = item;

        return {
          slot: slot,
          itemId,
          displayName,
          knownItemX,
          knownItemY,
          objectId1,
          objectId2,
          expires,
          usesLeft,
          onCooldown,
          knownItemId,
          source,
          confidence,
          acquiredAt,
          lastModifiedAt,
          knownObjectId
        };
      }),

      // Building construction timing
      ...(self.constructionStartTime ? { constructionStartTime: self.constructionStartTime } : {}),

      ...(self.uprootStream && self.uprootStream.length ? { uprootStream: self.uprootStream } : {}),

      // Transport data
      ...(self.isTransport ? { isTransport: true, loadEvents: self.loadEvents } : {}),
      ...(self.loadedInto ? { loadedInto: self.loadedInto } : {}),
      ...(self.isMercenary ? { isMercenary: true } : {}),
      ...(self.sacrificed ? { sacrificed: true } : {}),
      ...(self.destroyedAt ? { destroyedAt: self.destroyedAt } : {}),
      ...(self.destroyedByBuilding ? { destroyedByBuilding: true } : {}),
      ...(self.scoutInfo ? { scoutInfo: self.scoutInfo } : {}),
    };
  }

  //
  // debugging method
  //

  printUnit () {
    const self = this;
    console.logger("-----------------------------------------------------");
    console.logger("printing unit data:");
    console.logger(" * display name: ", this.displayName);
    console.logger(" * uuid:         ", this.uuid);
    console.logger(" * itemId:       ", this.itemId);
    console.logger(" * itemId1:      ", this.itemId1);
    console.logger(" * itemId2:      ", this.itemId2);
    console.logger(" * objectId1:    ", this.objectId1);
    console.logger(" * objectId2:    ", this.objectId2);
    console.logger(" * registered:   ", this.isRegistered ? "yes" : "no");

    console.logger(" * path len:     ", this.path.length);
    console.logger(" * spawnAtStart: ", this.isSpawnedAtStart ? "yes" : "no");

    if (this.isItem) {
      console.logger("* item slot:   ", this.itemSlotId);
      console.logger("* item x:   ", this.knownItemX);
      console.logger("* item y:   ", this.knownItemY);
    } else {
      const itemNameList = this.getItemList().map(heroSlot => {
        const { item, slot } = heroSlot;

        return `[${slot}] - ${item.displayName}`;
      });
      console.logger("items:        ", itemNameList);
    }

    
    console.logger("-----------------------------------------------------");
  }
};

// Shared with Building.exportUnit — single source for the entry→footprint mapping.
Unit.footprintFromPathingEntry = footprintFromPathingEntry;

// Order-stream bounds. The debounce matches the one `combatOrderTimes` has used
// since it was added; the cap is a runaway guard, not an expected limit (a 30
// minute game with a very busy player lands in the low hundreds per unit).
Unit.ORDER_DEBOUNCE_MS = 1000;
Unit.MAX_ORDERS = 2000;

module.exports = Unit;
