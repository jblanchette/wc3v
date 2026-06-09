const _iconCache = {};

const HighlightModes = {
  'all': 0,
  'single': 1,
  'group': 2,
  'none': 3
};

////
// drawing sizes
//
// Main-map in-world unit rendering is driven by WC3 collisionSize (world
// units) × pxPerUnit (canvas pixels per world unit). This intentionally
// REMOVES the old hardcoded IconSizes / readability minimum clamps — a
// Footman now renders at ~16 WU diameter, a Tauren at ~48 WU diameter,
// etc. (the same sizes WC3 uses for actual collision).
//
// NOTE: per CLAUDE.md "no icon below 36px on desktop" is intentionally
// violated here for non-hero units. User opted in; will tune if needed.
//
// Battle banners, BO chips, scrubber popups, nameplate text are UI
// elements and keep their hardcoded readability sizes (see BattleRenderer,
// BuildOrderRenderer, TimeScrubber).
////

// Fallback collision radii (world units) for ancient replays that don't
// have collisionSize exported. Mirrors UnitBalance.json typical values.
const FALLBACK_COLLISION_WU = {
  hero: 32, worker: 16, unit: 24, building: 96
};

const minFontSize         = 13,
      maxFontSize         = 18;

// Building footprint comes from the server-exported `footprint` field
// (derived from WC3's pathing.tga manifest). No client-side fallback.

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
// How long (game time, after `since`) a `possiblyLost` unit takes to settle
// from full opacity down to its stale floor. A one-way ramp — NEVER a pulse.
// Oscillating opacity on a live unit reads as "the engine is unsure it's
// there", which is exactly the bug this fade revamp removes.
const POSSIBLY_LOST_FADE_MS = 4000;
// Presumed-lost cleanup: a NON-HERO unit that goes idle/possiblyLost (its last
// activity trailed off and never resumed) fades fully out over this window
// after `since`, then stops drawing entirely. Declutters units the player lost
// in a fight that the parser couldn't pin to a confirmed death. `since` is the
// unit's last activity, so nothing happens after it — removing is safe.
const LOST_REMOVE_FADE_MS = 6000;
// Worker visibility: workers are hidden while harvesting/idle in base. They
// only draw when relevant — outside the base, pulled into a fight, or given a
// direct attack order. BASE_RADIUS is world units from the nearest base anchor
// (start location + own town halls). COMBAT window keeps a pulled worker
// visible for a stretch after its attack order.
const WORKER_BASE_RADIUS = 2000;
const WORKER_COMBAT_VISIBLE_MS = 12 * 1000;
// Stale fade floor — a unit that is silent past IDLE_GRACE but not yet
// confidently dead fades to this alpha (per type) and holds. Heroes hold the
// highest floor: the main hero is the single most identity-critical icon on
// the map and must never read as "maybe gone" just because its owner stopped
// issuing orders for a stretch.
const STALE_DECAY_FLOOR = { hero: 0.78, worker: 0.65, transport: 0.45, default: 0.55 };
// Resting opacity for illusions (Mirror Image, etc.) — faintly ghosted so
// they read as "not the real unit" even before you spot the (I) marker.
const ILLUSION_BASE_ALPHA = 0.82;
// Fallback for illusions with no parser-stamped destroyedAt: fade out this long
// after the image's last movement record.
const ILLUSION_SILENCE_FADE_MS = 8 * 1000;

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
      "collisionSize", "footprint", "isInferred", "destroyedAt", "isSummon",
      "lostState", "hiddenStream", "combatOrderTimes", "primaryRole",
      "isTransport", "loadEvents", "loadedInto", "isMercenary",
      "destroyedByBuilding", "sacrificed", "scoutInfo",
      "constructionStartTime", "uprootStream"
    ];

    dataFields.forEach(field => {
      this[field] = unitData[field] || null;
    });

    // Scouting attribution (label, fade lifecycle, broadcast-camera focus,
    // BO/floating-text "SCOUTING" tags) is 1v1-only. The detection keys off
    // 2-player heuristics and mis-credits in team/FFA games — drop it entirely.
    if (this.scoutInfo && window.wc3v && typeof window.wc3v.isNonOneVsOne === 'function'
        && window.wc3v.isNonOneVsOne()) {
      this.scoutInfo = null;
    }

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
        if (window.WC3V_CONFIG) window.WC3V_CONFIG.log('app', "img error: ", imgSrc);
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
    if (!this.spellList || !this.spellList.length) return [];
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
    // Both spawnPosition and lastPosition come through `unitData[field] || null`,
    // so a unit with neither leaves lastPosition === null — destructuring that
    // throws and aborts the whole player's unit construction. renderUnit()
    // already early-returns on null currentX/currentY, so a position-less unit
    // simply doesn't draw instead of crashing playback.
    const initialPos = this.spawnPosition || this.lastPosition;
    if (initialPos) {
      this.currentX = initialPos.x;
      this.currentY = initialPos.y;
    } else {
      this.currentX = null;
      this.currentY = null;
    }

    //
    // setup defaults for different unit / building types
    //
    // collisionRadiusWU is the WC3 collision radius in WORLD UNITS. Render
    // sizing converts to pixels at draw time via gameScaler.pxPerUnit.
    // Legacy `iconSize` is also set as a pixel-space approximation for any
    // UI subsystem that still reads it (decoration layout, sort helpers).
    //

    const fallback = this.meta.hero ? FALLBACK_COLLISION_WU.hero
                    : this.isBuilding ? FALLBACK_COLLISION_WU.building
                    : this.meta.worker ? FALLBACK_COLLISION_WU.worker
                    : FALLBACK_COLLISION_WU.unit;
    this.collisionRadiusWU = (this.collisionSize > 0) ? this.collisionSize : fallback;
    // ~0.25 px/WU is a typical default; subsystems that care about real
    // pixel size should consult gameScaler.pxPerUnit directly.
    this.iconSize = Math.max(8, this.collisionRadiusWU * 2 * 0.25);

    if (this.isNeutralPlayer) {
      this.minDecayLevel = 0.75;
      this.decayLevel = 0.75;
      return;
    }

    if (this.meta.hero) {
      this.minDecayLevel = 0.0;
    } else if (this.isBuilding) {
      this.decayLevel = 0.475;
    } else if (this.meta.worker) {
      // don't fully decay workers, since they often idle
      this.minDecayLevel = 0.475;
    } else if (this.isTransport) {
      this.minDecayLevel = 0.3;
    } else {
      this.minDecayLevel = 0.0;
    }
  }

  // A "harvester" for declutter purposes: true workers (acolyte/peon/peasant/
  // wisp), plus units assigned a gold/lumber role — notably the lumber GHOUL,
  // which is a fighting unit (meta.worker=false) doing economy. Army ghouls
  // have no harvest role, so they're never hidden.
  _isHarvester () {
    if (this.meta && this.meta.worker) return true;
    return this.primaryRole === 'lumber' || this.primaryRole === 'gold';
  }

  // Is this worker worth drawing on the tactical map right now? Hidden while it
  // harvests/idles in base; shown when it matters. Mirrors WC3 micro: a pulled
  // acolyte or a scouting peon is relevant; the mining workforce is noise.
  _isWorkerRelevant (gameTime, frameData, isInBattle) {
    if (this.scoutInfo) return true;          // flagged scout — already surfaced
    if (isInBattle) return true;              // caught in / pulled to a fight
    // a direct attack order was given to this worker recently
    if (this.combatOrderTimes && this.combatOrderTimes.length) {
      for (let i = 0; i < this.combatOrderTimes.length; i++) {
        const t = this.combatOrderTimes[i];
        if (gameTime >= t && gameTime <= t + WORKER_COMBAT_VISIBLE_MS) return true;
      }
    }
    // outside the base (scouting, expanding, harvassing forward, pulled away)
    const anchors = frameData && frameData.baseAnchors;
    if (anchors && anchors.length) {
      const r2 = WORKER_BASE_RADIUS * WORKER_BASE_RADIUS;
      for (let i = 0; i < anchors.length; i++) {
        const dx = this.currentX - anchors[i].x, dy = this.currentY - anchors[i].y;
        if ((dx * dx + dy * dy) <= r2) return false;   // inside a base → hide
      }
      return true;   // far from every base anchor → relevant
    }
    return false;     // no base info — default to hiding harvesters
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

  // World-space facing (radians, 0=+X, CCW) baked by lib/FacingInference, sampled
  // by gameTime with shortest-arc interpolation (mirrors getInterpolatedPosition;
  // seek-safe). Returns null for replays parsed before facing existed — the caller
  // (UnitModelRenderer) then falls back to velocity-derived facing.
  getInterpolatedFacing (gameTime) {
    const path = this.path;
    const i = this.recordIndexes.path;
    if (i < 0 || !path || !path[i]) return null;
    const a = path[i];
    if (a.facing == null) return null; // pre-facing replay → caller falls back
    const b = path[i + 1];
    if (!b || b.facing == null || gameTime >= b.gameTime || gameTime < a.gameTime || isPathGap(a, b)) {
      return a.facing;
    }
    const dt = b.gameTime - a.gameTime;
    const t = dt > 0 ? Math.min(1, Math.max(0, (gameTime - a.gameTime) / dt)) : 0;
    let d = b.facing - a.facing;            // shortest arc
    if (d > Math.PI) d -= Math.PI * 2;
    else if (d < -Math.PI) d += Math.PI * 2;
    return a.facing + d * t;
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

    // Illusions (e.g. Blademaster Mirror Image) ARE rendered now, with a
    // distinct ghostly look (see Drawing.drawUnit), and they track their REAL
    // movement from the replay (each image has its own object handle). Lifetime:
    // hold a faint baseline while active, fade out at the end, then stop
    // drawing. End time is `destroyedAt` (cast + spell duration) when the parser
    // set one; otherwise fall back to a short fade after the image's last known
    // movement (covers illusions surfaced by the legacy duplicate-detection
    // path, which doesn't stamp a duration).
    if (this.isIllusion) {
      this.getCurrentMovePath(gameTime);  // keep path index current
      this._deathFxStartTime = null;
      this._deathFxActive = false;

      let endTime = this.destroyedAt;
      if (!endTime) {
        const lastPath = (this.path && this.path.length)
          ? this.path[this.path.length - 1] : null;
        const lastSeen = lastPath && typeof lastPath.gameTime === 'number'
          ? lastPath.gameTime : this.spawnTime;
        endTime = lastSeen + ILLUSION_SILENCE_FADE_MS;
      }

      if (gameTime >= endTime) {
        const fxAge = gameTime - endTime;
        if (fxAge < DEATH_FX_DURATION_MS) {
          this.decayLevel = Math.max(0, ILLUSION_BASE_ALPHA * (1 - fxAge / DEATH_FX_DURATION_MS));
          this._destroyed = false;
        } else {
          this._destroyed = true;
        }
        return;
      }
      this._destroyed = false;
      this.decayLevel = ILLUSION_BASE_ALPHA;
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

    // Hidden (NE shadowmeld heuristic) — wins over lostState/heuristic so
    // the unit reads as "ghosted" while a server-detected hide window is active.
    this._isHiddenNow = false;
    if (this.hiddenStream && this.hiddenStream.length) {
      for (let i = 0; i < this.hiddenStream.length; i++) {
        const w = this.hiddenStream[i];
        if (gameTime >= w.start && gameTime <= w.end) {
          this._isHiddenNow = true;
          this.decayLevel = 0.32;       // very faint
          this._deathFxActive = false;
          this._deathFxStartTime = null;
          return;
        }
      }
    }

    // Server-supplied 4-state lost tracking (parser's DeathInference pass).
    // Wins over the heuristic fallback when available. State semantics — ALL
    // gated on the unit's own `since` time so a verdict never applies before
    // the moment the parser anchored it:
    //   active       — normal render
    //   idle         — standing around; full/near-full opacity, small dot cue
    //   possiblyLost — one-way settle to floor and hold (no pulse)
    //   lost         — one-shot death FX at `since` time, then ghosted out
    if (this.lostState && this.lostState.state) {
      const ls = this.lostState;
      const since = ls.since || 0;
      const t = since;
      const elapsed = gameTime - t;

      if (ls.state === 'lost') {
        if (gameTime < t) {
          // Scrubbed back before death — clear FX, render normal.
          this._lostFxFired = false;
          this._deathFxStartTime = null;
          this._deathFxActive = false;
          this.resetDecay();
          return;
        }
        if (elapsed < DEATH_FX_DURATION_MS) {
          const floor = this._staleFadeFloor();
          this.decayLevel = Math.max(0, floor * (1 - elapsed / DEATH_FX_DURATION_MS));
          this._deathFxStartTime = t;
          this._deathFxActive = true;
          // Mark for one-shot FX emission in renderUnit.
          this._lostFxPending = !this._lostFxFired;
          return;
        }
        // Past FX window — stop drawing entirely.
        this._destroyed = true;
        this._deathFxActive = false;
        return;
      }

      // possiblyLost / idle are END-OF-TIMELINE verdicts: the parser computes
      // them from how a unit's *final* activity trails off. They must only
      // affect the unit at/after `since` — applying them globally (the old
      // bug) smeared a unit's last-minute fate across its entire on-screen
      // life, e.g. pulsing a 16-minute-alive main hero from the moment it
      // spawned. Before `since`, fall through to the normal full-opacity path.
      if (gameTime >= since) {
        // Presumed-lost cleanup: a NON-HERO unit that trailed off into
        // idle/possiblyLost and never came back is almost always a unit lost
        // in a fight the parser couldn't pin to a confirmed death. Fade it out
        // and remove it instead of leaving it lingering on the map. Heroes are
        // exempt (they stay readable); confirmed 'lost' already has its own FX
        // path above. Workers are included — a dead/abandoned worker shouldn't
        // linger either; live in-base workers are hidden separately in
        // renderUnit, and a live worker that acts again has a later `since`.
        const isHero = !!(this.meta && this.meta.hero);
        if (!isHero && (ls.state === 'possiblyLost' || ls.state === 'idle')) {
          const k = Math.min(1, (gameTime - since) / LOST_REMOVE_FADE_MS);
          this.decayLevel = 1 - k;          // full → 0
          this._deathFxActive = false;
          this._deathFxStartTime = null;
          if (k >= 1) this._destroyed = true;   // fully faded — stop drawing
          return;
        }

        if (ls.state === 'possiblyLost') {
          // One-way settle from full opacity to the stale floor, then hold.
          // Reads as "probably gone, unconfirmed" — dimmed, never oscillating.
          const floor = this._staleFadeFloor();
          const k = Math.min(1, (gameTime - since) / POSSIBLY_LOST_FADE_MS);
          this.decayLevel = 1 - (1 - floor) * k;
          this._deathFxActive = false;
          this._deathFxStartTime = null;
          return;
        }

        if (ls.state === 'idle') {
          // Idle means "standing around", NOT uncertainty. Identity-critical
          // units (heroes, workers) stay fully readable; everything else dims
          // a hair. The small idle dot (renderUnit) carries the real cue.
          const idleAlpha = (this.meta && (this.meta.hero || this.meta.worker)) ? 1.0 : 0.9;
          this.decayLevel = idleAlpha;
          this._deathFxActive = false;
          this._deathFxStartTime = null;
          return;
        }
      }

      // active, or pre-`since` idle/possiblyLost — fall through to the normal
      // pipeline (resets decay to full below).
    }

    // Lifetime-aware fade. _lastActivityTime is the latest gameTime we have
    // any signal that this unit was alive (path / moveHistory / selection).
    // Replay is fully parsed up front, so silence past PROBABLY_GONE_MS is a
    // high-confidence death signal, not a guess.
    //
    // Workers, transports, and HEROES opt out of the heuristic *death*
    // pipeline (snap-destroy + death FX). They still get the gentle stale
    // fade, but silence alone never makes them vanish:
    //   - workers/transports routinely go silent (mining, parked);
    //   - heroes are the map's identity anchors and "die" only via an explicit
    //     lostState='lost' (revive-elsewhere/destroyed) — a player who simply
    //     stops microing the hero must never erase it from the map.
    // Genuine deaths for these are covered by the explicit server signals
    // above (destroyedAt / destroyedByBuilding / lostState).
    const skipDeathFx = !!(this.meta && this.meta.worker) || !!this.isTransport
                        || !!this.isInferred || !!(this.meta && this.meta.hero);
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
    if (!_proj) return;  // building is outside the camera frustum
    const drawX = Math.round(_proj.x + wc3v.gameScaler.middleX);
    const drawY = Math.round(_proj.y + wc3v.gameScaler.middleY);

    // Server-exported footprint (from WC3 pathing.tga manifest). Required.
    if (!this.footprint) {
      throw new Error('Building missing footprint field: ' + this.itemId +
                      ' — re-parse replay with current parser.');
    }
    const widthTiles  = this.footprint.widthTiles;
    const heightTiles = this.footprint.heightTiles;
    const offsetX     = this.footprint.offsetX || 0;
    const offsetY     = this.footprint.offsetY || 0;
    const pxPerWU     = wc3v.gameScaler.pxPerUnit;
    const halfWidthPx  = Math.round(widthTiles * 128 * pxPerWU / 2);
    const halfHeightPx = Math.round(heightTiles * 128 * pxPerWU / 2);
    // Apply walk-bbox offset (in world units) — the bbox may not be centered
    // on the building origin for asymmetric pathing textures.
    const centerX = drawX + Math.round(offsetX * pxPerWU);
    const centerY = drawY + Math.round(offsetY * pxPerWU);
    // halfSize is the worker-overlap-hide scalar — use the larger dim so
    // workers inside a non-square footprint stay hidden along its long axis.
    const halfIcon = Math.max(halfWidthPx, halfHeightPx);

    frameData.buildingPositions.push({
      x: centerX,
      y: centerY,
      halfSize: halfIcon,
      halfWidth: halfWidthPx,
      halfHeight: halfHeightPx,
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
    if (!_projCur) return;  // unit is outside the camera frustum
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

    // True WC3 collision diameter in canvas pixels. No readability floor —
    // a Footman (collisionSize=16) at typical zoom (pxPerUnit~0.125) draws
    // at ~4px diameter; a Tauren (48) at ~12px; heroes (32) at ~8px. Apply
    // d3-zoom transform.k so units scale with the user's zoom level.
    // _renderingUprooted: NE ancient that has uprooted — use the unit
    // fallback so the icon doesn't shrink to its tiny center-collision.
    const radiusWU = this._renderingUprooted
      ? FALLBACK_COLLISION_WU.unit
      : this.collisionRadiusWU;
    const zoomK = (transform && transform.k) ? transform.k : 1;
    const pxPerUnit = (wc3v.gameScaler && wc3v.gameScaler.pxPerUnit) || 0.125;
    const iconSize = Math.max(2, Math.round(radiusWU * 2 * pxPerUnit * zoomK));

    // Half is the true geometric half — old /2.5 was a readability hack.
    const halfIconSize = iconSize / 2;

    // Font keeps a readability floor independent of icon size: even tiny
    // unit icons need legible labels.
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

    // Spotlight: brighten the player-color halo on units that are currently
    // participating in an active detected battle. Set is pre-computed once
    // per frame by app.js from processedBattles.activeAt(gameTime).
    const isInBattle = !!(frameData &&
      frameData.activeBattleParticipants &&
      frameData.activeBattleParticipants.has(this.uuid));

    // Worker declutter: harvesting / idle-in-base workers are hidden. A worker
    // only draws when it's actually relevant — pulled into a fight, given a
    // direct attack order, scouting, or out of the base entirely. Keeps the
    // economy off the tactical map while still surfacing a defending acolyte or
    // a pulled peon. (Buildings/heroes are never workers.)
    if (this._isHarvester() && !this._isWorkerRelevant(gameTime, frameData, isInBattle)) {
      return;
    }

    // Visible outer radius — the unit's COLOURED HALO (drawn in
    // Drawing.drawUnit at halfIconSize + 6, or +9 for transports). The
    // server-side collision is based on bare collisionSize, but the
    // client renders the halo OUTSIDE that radius, so two units packed
    // at collisionSize tangent have halos that overlap. CollisionResolver
    // uses this `visualRadius` for the push math so visible halos touch
    // but never overlap.
    const visualRadius = halfIconSize + (this.isTransport ? 9 : 6);

    unitDrawPositions.push({
      uuid: this.uuid,
      itemId: this.itemId,
      fullName: this.fullName,
      playerId: this.playerId,
      playerColor: this.playerColor,
      icon: this.icon,
      iconSize: iconSize,
      halfIconSize: halfIconSize,
      visualRadius: visualRadius,
      fontSize: fontSize,
      decayLevel: this.decayLevel,
      isHero: this.meta.hero,
      isWorker: this.meta.worker,
      isIllusion: !!this.isIllusion,
      isHidden: !!this._isHiddenNow,
      isNeutralPlayer: this.isNeutralPlayer,
      isMainHero: this.isMainHero,
      heroRank: this.heroRank,
      spawnTime: this.spawnTime,
      isTransport: !!this.isTransport,
      cargoCount: cargoCount,
      cargoItems: cargoItems,
      scoutLabel: scoutLabel,
      isInBattle: isInBattle,
      x: drawX,
      y: drawY,
      count: 1,
      drawSlots: []
    });

    // Death FX: queue a one-shot ring + label at the unit's last known
    // position while the FX window is active. Drawn after the unit pass so
    // the ring renders on top of the icon's resting alpha.
    if (this._deathFxActive && this._deathFxStartTime != null && frameData.deathFx) {
      // Server-driven "lost" units get a richer treatment: red overlay
      // flash + green XP popup. Heuristic deaths (no lostState) use the
      // legacy plain ring.
      const ls = this.lostState;
      const richDeath = !!(ls && ls.state === 'lost');
      const fx = {
        x: drawX,
        y: drawY,
        ageMs: gameTime - this._deathFxStartTime,
        durationMs: DEATH_FX_DURATION_MS,
        iconSize: iconSize,
        playerColor: this.playerColor,
        label: this._deathFxLabel(),
        isHero: !!(this.meta && this.meta.hero),
        richDeath: richDeath,
        xpAwarded: (richDeath && ls.xpAwarded > 0) ? ls.xpAwarded : null
      };
      frameData.deathFx.push(fx);
      this._lostFxFired = true;
      this._lostFxPending = false;
    }

    // Idle indicator: small subtle dot above the unit when state is 'idle'.
    // Communicates "I see this unit, it's just standing" — distinct from
    // possiblyLost (settled fade) and active (no marker). Gated on `since` so
    // it only appears once the unit actually goes idle, not for its whole life.
    if (this.lostState && this.lostState.state === 'idle' && frameData.idleMarkers
        && gameTime >= (this.lostState.since || 0)) {
      frameData.idleMarkers.push({
        x: drawX,
        y: drawY - (iconSize / 2) - 6,
        playerColor: this.playerColor
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
      if (!_projL) return;  // continue level-stream scan; pin is off-screen
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
