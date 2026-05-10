const _iconCache = {};

const HighlightModes = {
  'all': 0,
  'single': 1,
  'group': 2,
  'none': 3
};

////
// drawing sizes
////

const IconSizes = {
  'hero': 42,
  'secondaryHero': 38,
  'unit': 36,
  'worker': 32,
  'building': 16,
  'neutral': 22
};

const minimumUnitSize     = 20,
      minimumBuildingSize = 12,
      minimumHeroIconSize = 36;

const minFontSize         = 13,
      maxFontSize         = 18;

////
// WC3 building placement footprint in tiles.
// Primary lookup by itemId (handles race-specific exceptions like NE town halls).
// Fallback by collisionSize for unknown buildings.
////

const BUILDING_FOOTPRINT_BY_ID = {
  // 4x4 town halls (3.5 visual to reduce crowding on canvas)
  'htow': 3.5, 'hkee': 3.5, 'hcas': 3.5,   // Human
  'ogre': 3.5, 'ostr': 3.5, 'ofrt': 3.5,   // Orc
  'etol': 3.5, 'etoa': 3.5, 'etoe': 3.5,   // NE (collision=144 but footprint is 4x4!)
  'unpl': 3.5, 'unp1': 3.5, 'unp2': 3.5,   // UD

  // 3x3 production / tech buildings
  'halt': 3, 'hbar': 3, 'hbla': 3, 'harm': 3, 'hars': 3, 'hlum': 3,  // Human
  'oalt': 3, 'obar': 3, 'obea': 3, 'ofor': 3, 'oshy': 3, 'otto': 3, 'osld': 3, // Orc
  'eate': 3, 'eaow': 3, 'eaom': 3, 'eaoe': 3, 'edob': 3, 'eden': 3,  // NE
  'uaod': 3, 'usep': 3, 'ugrv': 3, 'utod': 3, 'uslh': 3, 'ugol': 3,  // UD

  // 2x2 small buildings
  'hhou': 2, 'hatw': 2, 'hwtw': 2, 'hvlt': 2,  // Human
  'otrb': 2, 'owtw': 2, 'ovln': 2,              // Orc
  'emow': 2, 'etrp': 2,                          // NE
  'uzig': 2, 'uzg1': 2, 'uzg2': 2, 'utom': 2,  // UD

  // Neutral
  'ngol': 2, 'ntav': 2, 'ngme': 2, 'nmer': 2, 'nmrk': 2,
};

function getBuildingFootprintTiles (itemId, collisionSize) {
  // exact itemId match first
  if (itemId && BUILDING_FOOTPRINT_BY_ID[itemId] !== undefined) {
    return BUILDING_FOOTPRINT_BY_ID[itemId];
  }
  // fallback by collisionSize
  if (!collisionSize) return 2;
  if (collisionSize <= 130) return 2;
  if (collisionSize <= 160) return 3;
  return 3.5;
}

////
// drawing constants
////

const buildingAlpha = 0.55;
const minNeighborDrawDistance = 20;
const pathDecayTime = 1000 * 20;

// Fade & death detection — tunables.
// Idle does NOT mean dead. Living units commonly stand still for tens of
// seconds (peons mining, heroes attacking, units defending), so we hold full
// opacity well past any normal idle window before we even start fading.
const IDLE_GRACE_MS = 30 * 1000;
// PROBABLY_GONE_MS: high-confidence "this unit is dead" threshold. Because
// the replay is fully parsed up front, we know there are no further records
// for this unit anywhere in the timeline — that lets us treat extended
// silence as a death signal instead of guessing each frame.
const PROBABLY_GONE_MS = 90 * 1000;
// One-shot death FX duration (game time). Kept in game time so it scales
// with playback speed and survives scrub-back automatically.
const DEATH_FX_DURATION_MS = 1500;
// Stale fade floor — a unit that is silent past IDLE_GRACE but not yet
// confidently dead fades to this alpha (per type) and holds.
const STALE_DECAY_FLOOR = { hero: 0.55, worker: 0.65, transport: 0.45, default: 0.55 };

// Path-gap detection — shared by ClientUnit.getInterpolatedPosition and
// PathTrailRenderer3D so both decide identically where the trail line breaks.
const PATH_MIN_TIME_GAP = 5 * 1000;     // small time delta
const PATH_MIN_GAP_DIST = 1500;         // large distance delta
const PATH_MAX_TIME_GAP = 300 * 1000;   // large time delta
const PATH_MAX_GAP_DIST = 500;          // small distance delta
const PATH_IDLE_GAP_TIME = 10 * 1000;   // any gap > 10s breaks the line

const isPathGap = (a, b) => {
  if (!a || !b) return false;
  if (b.isJump) return true;
  const dt = b.gameTime - a.gameTime;
  if (dt > PATH_IDLE_GAP_TIME) return true;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > PATH_MIN_GAP_DIST && dt < PATH_MIN_TIME_GAP) return true;
  if (dist > PATH_MAX_GAP_DIST && dt > PATH_MAX_TIME_GAP) return true;
  return false;
};

const ClientUnit = class {
  constructor (unitData, playerId, playerColor, isNeutralPlayer) {
    const dataFields = [
      "displayName", "itemId", "itemId1", "itemId2",
      "objectId1", "objectId2", "isRegistered", "isUnit",
      "isBuilding", "isIllusion", "level", "lastPosition",
      "path", "footprints", "meta", "items", "spawnTime", "trainedTime",
      "spawnPosition", "levelStream", "spellList",
      "neutralGroupId", "xpStream", "uuid",
      "collisionSize", "isInferred", "destroyedAt", "isSummon",
      "isTransport", "loadEvents", "loadedInto", "isMercenary",
      "destroyedByBuilding", "sacrificed", "scoutInfo",
      "constructionStartTime", "uprootStream"
    ];

    dataFields.forEach(field => {
      this[field] = unitData[field] || null;
    });

    // units in training shouldn't render until training completes
    // buildings shouldn't render until construction starts
    this.readyTime = this.constructionStartTime || this.trainedTime || this.spawnTime;

    // Build loaded-windows for units that get loaded into transports
    this._loadedWindows = this._buildLoadedWindows(unitData);

    // guard for units that weren't fully resolved server-side
    if (!this.meta) {
      this.meta = { hero: false, worker: false, permanent: this.isBuilding, playerShop: false, evolution: null, movespeed: 200 };
    }

    this.playerId = playerId;
    this.playerColor = playerColor;
    this.isNeutralPlayer = isNeutralPlayer;
    this.isNeutralGroupHidden = false;

    this.highlightMode = HighlightModes.all;

    this.setup();

    this.loaders = [];

    this.loaders.push(...this.loadIcon());

    if (this.meta.hero) {
      this.loaders.push(...this.loadSpellIcons());
    }

  }

  _buildLoadedWindows (unitData) {
    // If this unit is a transport, scan its loadEvents to build windows for each passenger
    // If this unit has loadedInto set, we need to check the transport's loadEvents
    // But we don't have cross-unit references in the constructor — so we build windows
    // from any transport's loadEvents that reference this unit's UUID
    // This is handled externally by ClientPlayer after all units are created
    return [];
  }

  _isLoadedAt (gameTime) {
    for (let i = 0; i < this._loadedWindows.length; i++) {
      const w = this._loadedWindows[i];
      if (gameTime >= w.loadTime && gameTime < w.unloadTime) return true;
    }
    return false;
  }

  _cargoCountAt (gameTime) {
    if (!this.loadEvents || !this.loadEvents.length) return 0;
    let count = 0;
    for (let i = 0; i < this.loadEvents.length; i++) {
      const evt = this.loadEvents[i];
      if (evt.gameTime > gameTime) break;
      if (evt.action === 'load') count++;
      else if (evt.action === 'unload') count = Math.max(0, count - 1);
    }
    return count;
  }

  _cargoItemIdsAt (gameTime) {
    if (!this.loadEvents || !this.loadEvents.length) return [];
    const loaded = [];
    for (let i = 0; i < this.loadEvents.length; i++) {
      const evt = this.loadEvents[i];
      if (evt.gameTime > gameTime) break;
      if (evt.action === 'load') {
        if (!loaded.find(u => u.unitId === evt.unitId)) {
          loaded.push({ unitId: evt.unitId, itemId: evt.unitItemId, name: evt.unitName });
        }
      } else if (evt.action === 'unload') {
        const idx = loaded.findIndex(u => u.unitId === evt.unitId);
        if (idx >= 0) loaded.splice(idx, 1);
      }
    }
    return loaded.slice(0, 8);
  }

  loadAsset (imgSrc, prop) {
    return new Promise((resolve, reject) => {
        
      const img = new Image();
      
      this[prop] = null;

      if (_iconCache[imgSrc]) {
        this[prop] = _iconCache[imgSrc];
        
        return resolve(true);
      }

      img.src = imgSrc;
      img.onload = () => {
        if (!_iconCache[imgSrc]) {
          _iconCache[imgSrc] = img;
        }

        this[prop] = img;
        return resolve(true);
      };

      img.onerror = (e) => {
        console.log("img error: ", imgSrc);
        return resolve(false);
      };
    });
  }

  setHighlightMode (mode) {
    this.highlightMode = mode;
  }

  loadIcon () {
    const imgSrc = `/assets/wc3icons/${this.itemId}.jpg`;
    return [ this.loadAsset(imgSrc, 'icon') ];
  }

  loadSpellIcons () {
    return this.spellList.map((spellId, index) => {
      const imgSrc = `/assets/wc3icons/${spellId}.jpg`;

      return this.loadAsset(imgSrc, `spell-${index}`);
    });
  }

  // Pre-compute the latest gameTime we have any positional / movement record
  // for this unit. Server `path` is normally the strongest signal; some units
  // also have moveHistory entries. We fall back to spawnTime so newly-spawned
  // units that haven't moved yet aren't immediately classified stale.
  _computeInitialActivityTime () {
    let t = this.spawnTime || 0;
    if (this.path && this.path.length) {
      const last = this.path[this.path.length - 1];
      if (last && typeof last.gameTime === 'number' && last.gameTime > t) {
        t = last.gameTime;
      }
    }
    if (this.moveHistory && this.moveHistory.length) {
      const last = this.moveHistory[this.moveHistory.length - 1];
      if (last && typeof last.gameTime === 'number' && last.gameTime > t) {
        t = last.gameTime;
      }
    }
    return t;
  }

  // ClientPlayer calls this during selection-stream enrichment to record any
  // gameTime where this unit (or a unit of the same type) was selected by the
  // owning player. Selection is a strong "still alive" signal — over-attributing
  // alive across instances of the same type is the safer error mode here.
  recordActivity (gameTime) {
    if (typeof gameTime !== 'number') return;
    if (this._lastActivityTime == null || gameTime > this._lastActivityTime) {
      this._lastActivityTime = gameTime;
    }
  }

  // Per-type stale fade floor — how dim a "silent but probably alive" unit
  // can get before we hold there. Heroes and workers stay more visible than
  // generic units because they're the most identity-critical icons on the map.
  _staleFadeFloor () {
    if (this.meta && this.meta.hero) return STALE_DECAY_FLOOR.hero;
    if (this.meta && this.meta.worker) return STALE_DECAY_FLOOR.worker;
    if (this.isTransport) return STALE_DECAY_FLOOR.transport;
    return STALE_DECAY_FLOOR.default;
  }

  // Death-FX label: short tag drawn above the icon when we're confident a
  // unit has died. Heroes get a louder label since they're the rare/expensive
  // ones a viewer most wants to notice.
  _deathFxLabel () {
    if (this.meta && this.meta.hero) return 'HERO DOWN';
    if (this.sacrificed) return 'SACRIFICED';
    if (this.destroyedAt) return 'EXPIRED';
    if (this.destroyedByBuilding) return 'CONSUMED';
    return 'LOST';
  }

  setup () {
    this.recordIndexes = {
      move: -1,
      level: -1,
      path: -1
    };

    this.decayLevel = 1;

    // Last gameTime we have *any* signal that this unit was alive: a path
    // record (movement / position update) or a move history entry. ClientPlayer
    // may bump this further when it cross-references the selection stream. Used
    // by update() to drive the fade + death-FX state machine. Null means we
    // don't track lifetime for this unit (neutrals, illusions, buildings, etc).
    this._lastActivityTime = this._computeInitialActivityTime();
    // gameTime when the one-shot death FX began (null when the FX is not
    // currently playing). Set once the unit transitions into "confirmed dead".
    this._deathFxStartTime = null;
    // Mirrors _deathFxStartTime != null for cheap reads in renderUnit().
    this._deathFxActive = false;

    this.fullName = this.getFullName();
    this.itemIdHash = this.itemId1 ?
      Helpers.makeItemIdHash(this.itemId1, this.itemId2) : `unregistered`;

    //
    // figure out initial position
    //
    if (this.spawnPosition) {
      const { x, y } = this.spawnPosition;

      this.currentX = x;
      this.currentY = y;
    } else {
      const { x, y } = this.lastPosition;

      this.currentX = x;
      this.currentY = y;
    }

    //
    // setup defaults for different unit / building types
    //

    if (this.isNeutralPlayer) {
      this.iconSize = IconSizes.neutral;
      this.minDecayLevel = 0.75;
      this.decayLevel = 0.75;

      return;
    }

    if (this.meta.hero) {
      this.iconSize = IconSizes.hero;
      this.minDecayLevel = 0.0;
    } else if (this.isBuilding) {
      this.iconSize = IconSizes.building;
      this.decayLevel = 0.475;
    } else if (this.meta.worker) {
      this.iconSize = IconSizes.worker;

      // don't fully decay workers, since they often idle
      this.minDecayLevel = 0.475;
    } else if (this.isTransport) {
      this.iconSize = IconSizes.hero;  // larger icon for transports — important gameplay element
      this.minDecayLevel = 0.3;
    } else {
      this.iconSize = IconSizes.unit;
      this.minDecayLevel = 0.0;
    }
  }

  getFullName () {
    const shortName = getShortName(this.itemId, this.displayName);

    if (!this.meta.hero) {
      return shortName;
    } else {
      if (this.isIllusion) {
        return `${shortName} (I)`;
      }

      const levelRecord = this.levelStream && this.levelStream[this.recordIndexes.level];
      const heroLevel = levelRecord ? levelRecord.newLevel : 1;

      return `${shortName} (${heroLevel})`;
    }
  }

  getHeroLevelRecord () {
    const levelRecord = this.levelStream && this.levelStream[this.recordIndexes.level];

    return levelRecord || null;
  }

  getCurrentMovePath (gameTime) {
    const { path } = this;

    const index = Helpers.findIndexFrom(
      path,
      Helpers.StandardStreamSearch,
      this.recordIndexes.path,
      gameTime
    );

    if (index === -1) {
      return null;
    }

    this.recordIndexes.path = index;

    // return back the new record
    return path[index];
  }

  // Smoothly interpolate the unit's world position at gameTime by lerping
  // between path[i] and path[i+1] using the time fraction. Uses a uniform
  // Catmull-Rom across path[i-1..i+2] when neither neighbor crosses a gap,
  // otherwise linear lerp; snaps on jumps/idles/teleports.
  // Relies on recordIndexes.path being maintained by getCurrentMovePath.
  getInterpolatedPosition (gameTime) {
    const path = this.path;
    const i = this.recordIndexes.path;
    if (i < 0 || !path || !path[i]) return null;

    const a = path[i];
    const b = path[i + 1];

    if (!b || gameTime >= b.gameTime || gameTime < a.gameTime) {
      return { x: a.x, y: a.y };
    }

    if (isPathGap(a, b)) {
      return { x: a.x, y: a.y };
    }

    const dt = b.gameTime - a.gameTime;
    const t = dt > 0 ? Math.min(1, Math.max(0, (gameTime - a.gameTime) / dt)) : 0;

    const p0 = path[i - 1];
    const p3 = path[i + 2];
    const canCR = p0 && p3 && !isPathGap(p0, a) && !isPathGap(b, p3);

    return canCR
      ? Helpers.catmullRomXY(p0, a, b, p3, t)
      : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  getCurrentLevelRecord (gameTime, verbose = false) {
    if (!this.meta.hero) {
      return;
    }

    const { levelStream } = this;

    const index = Helpers.findIndexFrom(
      levelStream, 
      Helpers.StandardStreamSearch, 
      this.recordIndexes.level,
      gameTime
    );

    if (index === -1) {
      return;
    }

    if (this.recordIndexes.level !== index) {
      this.recordIndexes.level = index;
      this.fullName = this.getFullName();
    }
  }

  hasDrawingNeighbor (units, x, y) {
    if (!units.length) {
      return false;
    }

    const ownerId = this.playerId;
    const neighbor = Helpers.closestToPoint(x, y, units, (unit) => {
      return unit.playerId === ownerId;
    });

    if (neighbor === null) {
      return false;
    }

    return neighbor.distance <= minNeighborDrawDistance ?
      neighbor : false;
  }

  jump (gameTime) {
    if (this.isBuilding) {
      return;
    }

    // reset unit
    this.resetDecay();
    this._scoutEnded = false;

    this.recordIndexes = {
      move: -1,
      level: -1,
      path: -1
    };

    this.fullName = this.getFullName();
  }

  resetDecay (index) {
    this.decayLevel = 1;
  }

  decay (dt = 1.0) {
    const amount = this.meta.hero ? 0.0015 : 0.0035;
    this.decayLevel = Math.max(this.minDecayLevel, this.decayLevel - (amount * dt));
  }

  update (gameTime, dt) {
    if (gameTime < this.readyTime) {
      // scrub-back before this unit even existed: clear any stale FX state
      this._deathFxStartTime = null;
      this._deathFxActive = false;
      this._destroyed = false;
      return;
    }

    // Definitive server-side death signals: summon expiry (destroyedAt) and
    // permanent wisp consumption (destroyedByBuilding). Both get the same FX
    // window so the visual is consistent with heuristic deaths below.
    if (this.destroyedAt && gameTime >= this.destroyedAt) {
      const fxAge = gameTime - this.destroyedAt;
      if (fxAge < DEATH_FX_DURATION_MS) {
        const floor = this._staleFadeFloor();
        this.decayLevel = Math.max(0, floor * (1 - fxAge / DEATH_FX_DURATION_MS));
        this._deathFxStartTime = this.destroyedAt;
        this._deathFxActive = true;
        this._destroyed = false;
        return;
      }
      this._destroyed = true;
      this._deathFxActive = false;
      return;
    }

    // Permanently consumed wisps (NE ancients) — old replays may lack
    // destroyedAt. The wisp's pre-summon life isn't tracked as a normal unit
    // here, so treat the flag as "always destroyed" (preserves prior behavior).
    if (this.destroyedByBuilding && !this.destroyedAt) {
      this._destroyed = true;
      this._deathFxActive = false;
      this._deathFxStartTime = null;
      return;
    }

    this._destroyed = false;

    // checks and updates current level record, setting this.fullName
    this.getCurrentLevelRecord(gameTime);

    // early exit for buildings — uprooted ancients need path interpolation
    if (this.isBuilding && !this.isUprootedAt(gameTime)) {
      return;
    }

    // Neutral creeps hold their setup() baseline (0.75). They don't get the
    // idle/death pipeline — neutral group visibility is managed by camp-level
    // hide rules and overlap fading in drawResolvedUnits.
    if (this.isNeutralPlayer) {
      this.decayLevel = 0.75;
      this._deathFxStartTime = null;
      this._deathFxActive = false;
      return;
    }

    // Illusions are never rendered; skip the lifetime/FX pipeline so we don't
    // queue death FX at a position that won't be drawn anyway.
    if (this.isIllusion) {
      this._deathFxStartTime = null;
      this._deathFxActive = false;
      return;
    }

    const currentMoveRecord = this.getCurrentMovePath(gameTime);

    // scout lifecycle: label persists for 30s of game time then ends
    // (matches the fade animation duration below). previously keyed on
    // currentMoveRecord.gameTime, which prematurely ended the label for
    // workers that kept moving (e.g. acolytes walking on to mine/haunt)
    // while leaving it stuck on for wisps that stopped at a tree.
    if (this.scoutInfo && !this._scoutEnded) {
      if (gameTime > this.scoutInfo.gameTime + 30000) {
        this._scoutEnded = true;
      }
    }

    const isActiveScout = this.scoutInfo && !this._scoutEnded && gameTime >= this.scoutInfo.gameTime;

    // Active scouts keep their existing 30s gradual-fade lifecycle. Skip the
    // generic fade/death pipeline so the scout label and minimum visibility
    // floor still drive their look.
    if (isActiveScout) {
      const lastMoveT = currentMoveRecord ? currentMoveRecord.gameTime : this.scoutInfo.gameTime;
      if ((gameTime - lastMoveT) > 2000) {
        const scoutAge = gameTime - this.scoutInfo.gameTime;
        const fadeProgress = Math.min(1, scoutAge / 30000);
        this.decayLevel = Math.max(0.6 - fadeProgress * 0.3, this.decayLevel);
      } else {
        this.resetDecay();
      }
      this._deathFxActive = false;
      return;
    }

    // Lifetime-aware fade. _lastActivityTime is the latest gameTime we have
    // any signal that this unit was alive (path / moveHistory / selection).
    // Replay is fully parsed up front, so silence past PROBABLY_GONE_MS is a
    // high-confidence death signal, not a guess.
    //
    // Workers and transports opt out of the death pipeline — they routinely
    // go silent for long stretches (peons mining gold, transports parked),
    // and their genuine "death" paths are already covered by the explicit
    // server signals above (consumed/destroyedByBuilding) or replay end.
    // They still get the gentle stale fade so they look settled in place.
    const skipDeathFx = !!(this.meta && this.meta.worker) || !!this.isTransport || !!this.isInferred;
    const lastActivity = this._lastActivityTime;
    if (lastActivity != null) {
      const silentFor = gameTime - lastActivity;
      const deathTime = lastActivity + PROBABLY_GONE_MS;

      // Past the FX window: snap-destroy and stop drawing.
      if (!skipDeathFx && gameTime >= deathTime + DEATH_FX_DURATION_MS) {
        this._destroyed = true;
        this._deathFxActive = false;
        return;
      }

      // Inside the death FX window: hold a fading ghost; renderUnit will
      // emit the FX entry while it draws this frame.
      if (!skipDeathFx && gameTime >= deathTime) {
        const fxAge = gameTime - deathTime;
        const fxProgress = fxAge / DEATH_FX_DURATION_MS;
        // ghost icon decays from the stale floor down to ~0 over the window
        const floor = this._staleFadeFloor();
        this.decayLevel = Math.max(0, floor * (1 - fxProgress));
        this._deathFxStartTime = deathTime;
        this._deathFxActive = true;
        return;
      }

      // Stale window: gentle fade toward the per-type floor, no further.
      if (silentFor > IDLE_GRACE_MS) {
        const floor = this._staleFadeFloor();
        const stalePhase = Math.min(1, (silentFor - IDLE_GRACE_MS) / (PROBABLY_GONE_MS - IDLE_GRACE_MS));
        const target = 1.0 - (1.0 - floor) * stalePhase;
        // never inflate alpha above current; never fall below floor
        this.decayLevel = Math.max(floor, Math.min(this.decayLevel, target));
        this._deathFxStartTime = null;
        this._deathFxActive = false;
        return;
      }
    }

    // Active or within grace window — fully visible.
    this._deathFxStartTime = null;
    this._deathFxActive = false;
    this.resetDecay();
  }

  renderBuilding (ctx, frameData, transform, xScale, yScale) {
    // 3D building models handle visual rendering now (ThreeMapRenderer).
    // Still track positions for worker-overlap hiding logic.
    const { x, y } = this.lastPosition;
    const _proj = wc3v.gameScaler.projectXY(x, y);
    const drawX = Math.round(_proj.x + wc3v.gameScaler.middleX);
    const drawY = Math.round(_proj.y + wc3v.gameScaler.middleY);
    const footprintTiles = getBuildingFootprintTiles(this.itemId, this.collisionSize);
    const halfIcon = Math.round(footprintTiles * 128 * wc3v.gameScaler.pxPerUnit / 2);

    frameData.buildingPositions.push({
      x: drawX,
      y: drawY,
      halfSize: halfIcon,
      playerId: this.playerId,
      displayName: this.displayName,
      itemId: this.itemId,
      playerColor: this.playerColor
    });
  }

  renderUnit (ctx, frameData, transform, gameTime, xScale, yScale, viewOptions) {
    if (this.highlightMode === HighlightModes.none) {
      return;
    }

    if (this.currentX == null || this.currentY == null) {
      return;
    }

    if (this.isNeutralPlayer && this.isNeutralGroupHidden) {
      return;
    }

    if (this.isIllusion) {
      return;
    }

    // Smoothly interpolate live position between path waypoints. Falls back
    // to a snap on jumps/teleports/idle gaps. recordIndexes.path is kept
    // current by getCurrentMovePath() during update().
    const interp = this.getInterpolatedPosition(gameTime);
    if (interp && !isNaN(interp.x)) {
      this.currentX = interp.x;
      this.currentY = interp.y;
    }
    const pathNode = this.path[this.recordIndexes.path];

    // Active scouts: override with scout target when path data is stale
    const isActiveScout = this.scoutInfo && !this._scoutEnded && gameTime >= this.scoutInfo.gameTime;
    if (isActiveScout && this.scoutInfo.position) {
      const pathAge = pathNode ? (gameTime - pathNode.gameTime) : Infinity;
      if (pathAge > 5000 || isNaN(this.currentX)) {
        this.currentX = this.scoutInfo.position.x;
        this.currentY = this.scoutInfo.position.y;
      }
    }

    if (isNaN(this.currentX) || isNaN(this.currentY)) {
      return;
    }

    const _projCur = wc3v.gameScaler.projectXY(this.currentX, this.currentY);
    let drawX = _projCur.x + wc3v.gameScaler.middleX;
    let drawY = _projCur.y + wc3v.gameScaler.middleY;

    // lumber scouts: snap to nearest tree so the wisp looks attached
    if (isActiveScout && this.scoutInfo.isLumberScout && wc3v._treeIndex) {
      const nearest = ClientUnit._findNearestTree(wc3v._treeIndex, drawX, drawY);
      if (nearest) {
        // position the wisp adjacent to the tree (offset by tree radius)
        const dx = drawX - nearest.x;
        const dy = drawY - nearest.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        drawX = nearest.x + (dx / dist) * (nearest.r + 4);
        drawY = nearest.y + (dy / dist) * (nearest.r + 4);
      }
    }

    // hide workers that overlap with same-player buildings (e.g. peasant constructing)
    // but never hide scouts — they need to stay visible at their position
    if (this.meta.worker && !this.scoutInfo && frameData.buildingPositions) {
      for (const bld of frameData.buildingPositions) {
        if (bld.playerId === this.playerId &&
            Math.abs(drawX - bld.x) < bld.halfSize &&
            Math.abs(drawY - bld.y) < bld.halfSize) {
          return;
        }
      }
    }

    const { unitDrawPositions, drawnUnits } = frameData;

    if (drawnUnits[this.uuid]) {
      return;
    }

    drawnUnits[this.uuid] = true;

    const minimumIconSize = this.meta.hero ?
      minimumHeroIconSize : minimumUnitSize;
    const baseIconSize = this._renderingUprooted ? IconSizes.unit : this.iconSize;
    const iconSize = Math.max(baseIconSize, minimumIconSize);

    const halfIconSize = iconSize / 2.5;
    
    const fontSize = Math.max(Math.min(halfIconSize, maxFontSize), minFontSize);

    // add unit to draw frame unit positions
    // Calculate current cargo for transports
    let cargoCount = 0;
    let cargoItems = null;
    if (this.isTransport) {
      const items = this._cargoItemIdsAt(gameTime);
      cargoCount = items.length;
      cargoItems = items.length ? items.map(c => c.itemId) : null;
    }

    const scoutLabel = isActiveScout ? 'SCOUT' : null;

    unitDrawPositions.push({
      uuid: this.uuid,
      itemId: this.itemId,
      fullName: this.fullName,
      playerId: this.playerId,
      playerColor: this.playerColor,
      icon: this.icon,
      iconSize: iconSize,
      halfIconSize: halfIconSize,
      fontSize: fontSize,
      decayLevel: this.decayLevel,
      isHero: this.meta.hero,
      isWorker: this.meta.worker,
      isNeutralPlayer: this.isNeutralPlayer,
      isMainHero: this.isMainHero,
      heroRank: this.heroRank,
      spawnTime: this.spawnTime,
      isTransport: !!this.isTransport,
      cargoCount: cargoCount,
      cargoItems: cargoItems,
      scoutLabel: scoutLabel,
      x: drawX,
      y: drawY,
      count: 1,
      drawSlots: []
    });

    // Death FX: queue a one-shot ring + label at the unit's last known
    // position while the FX window is active. Drawn after the unit pass so
    // the ring renders on top of the icon's resting alpha.
    if (this._deathFxActive && this._deathFxStartTime != null && frameData.deathFx) {
      frameData.deathFx.push({
        x: drawX,
        y: drawY,
        ageMs: gameTime - this._deathFxStartTime,
        durationMs: DEATH_FX_DURATION_MS,
        iconSize: iconSize,
        playerColor: this.playerColor,
        label: this._deathFxLabel(),
        isHero: !!(this.meta && this.meta.hero)
      });
    }
  }

  renderLevelPins (ctx, transform, gameTime, xScale, yScale, viewOptions, frameData) {
    const diamondSize = 22;
    const iconSize = 36;
    const proximityThreshold = diamondSize + 48;
    const unitPositions = frameData ? frameData.unitDrawPositions : [];

    this.levelStream.some(levelRecord => {
      if (gameTime < levelRecord.gameTime) {
        return true;
      }

      const { x, y } = levelRecord.position;

      const _projL = wc3v.gameScaler.projectXY(x, y);
      const drawX = _projL.x + wc3v.gameScaler.middleX;
      const drawY = _projL.y + wc3v.gameScaler.middleY;

      // fade pin when any unit is nearby
      const nearUnit = unitPositions.some(u =>
        Math.abs(u.x - drawX) < proximityThreshold + u.iconSize / 2 &&
        Math.abs(u.y - drawY) < proximityThreshold + u.iconSize / 2
      );
      const pinAlpha = nearUnit ? 0.15 : 1.0;

      // outer glow ring
      ctx.globalAlpha = 0.3 * pinAlpha;
      ctx.beginPath();
      ctx.arc(drawX, drawY, diamondSize + 7, 0, Math.PI * 2);
      ctx.fillStyle = this.playerColor;
      ctx.fill();

      // diamond pin in player color
      ctx.globalAlpha = 0.9 * pinAlpha;
      Drawing.drawDiamond(ctx, drawX, drawY, diamondSize, this.playerColor, '#000');

      // skill icon centered in diamond
      ctx.globalAlpha = 1.0 * pinAlpha;
      Drawing.drawImageCircle(
        ctx,
        this[`spell-${levelRecord.slot}`],
        drawX,
        drawY,
        iconSize
      );

      // level badge at bottom-right
      const badgeX = drawX + diamondSize;
      const badgeY = drawY + diamondSize;
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, 13, 0, Math.PI * 2);
      ctx.fillStyle = '#111';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = this.playerColor;
      ctx.stroke();

      ctx.font = 'bold 16px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#FFF';
      ctx.globalAlpha = pinAlpha;
      ctx.fillText(levelRecord.newLevel, badgeX, badgeY + 1);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    });

    ctx.globalAlpha = 1;
  }

  isUprootedAt (gameTime) {
    if (!this.uprootStream || !this.uprootStream.length) return false;
    let state = false;
    for (let i = 0; i < this.uprootStream.length; i++) {
      const entry = this.uprootStream[i];
      if (entry.gameTime > gameTime) break;
      state = !!entry.isUprooted;
    }
    return state;
  }

  preRender (frameData, ctx, buildingCtx, transform, gameTime, xScale, yScale, viewOptions) {
    if (gameTime < this.readyTime) {
      return;
    }

    if (this._destroyed) {
      return;
    }

    // Hide units currently loaded inside a transport
    if (this._loadedWindows.length && this._isLoadedAt(gameTime)) {
      return;
    }

    const uprooted = this.isBuilding && this.isUprootedAt(gameTime);

    if (this.isBuilding && !uprooted) {
      this.renderBuilding(buildingCtx, frameData, transform, xScale, yScale, viewOptions);
    } else {
      this._renderingUprooted = uprooted;
      this.renderUnit(ctx, frameData, transform, gameTime, xScale, yScale, viewOptions);
      this._renderingUprooted = false;
    }
  }

  // find the nearest tree to a screen position from the tree index
  static _findNearestTree (treeIndex, x, y) {
    if (!treeIndex) return null;
    const { grid, cellSize } = treeIndex;
    const cx = Math.floor(x / cellSize);
    const cy = Math.floor(y / cellSize);

    let best = null;
    let bestDist = Infinity;

    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const trees = grid[(cx + dx) + ',' + (cy + dy)];
        if (!trees) continue;
        for (let i = 0; i < trees.length; i++) {
          const t = trees[i];
          const tdx = x - t.x;
          const tdy = y - t.y;
          const dist = tdx * tdx + tdy * tdy;
          if (dist < bestDist) {
            bestDist = dist;
            best = t;
          }
        }
      }
    }

    return best;
  }
}

// Static helpers for other subsystems (e.g. PathTrailRenderer3D) that need to
// segment a unit path identically to how the client interpolates it.
ClientUnit.isPathGap = isPathGap;
ClientUnit.PATH_DECAY_TIME = pathDecayTime;

window.ClientUnit = ClientUnit;
