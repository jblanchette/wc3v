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
const idleDecayTime = 1000 * 2;

const ClientUnit = class {
  constructor (unitData, playerId, playerColor, isNeutralPlayer) {
    const dataFields = [ 
      "displayName", "itemId", "itemId1", "itemId2",
      "objectId1", "objectId2", "isRegistered", "isUnit",
      "isBuilding", "isIllusion", "level", "lastPosition",
      "path", "meta", "items", "spawnTime", "trainedTime",
      "spawnPosition", "levelStream", "spellList",
      "neutralGroupId", "xpStream", "uuid",
      "collisionSize", "isInferred", "destroyedAt", "isSummon",
      "isTransport", "loadEvents", "loadedInto", "isMercenary",
      "destroyedByBuilding", "sacrificed", "scoutInfo",
      "constructionStartTime"
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

    this.loaders.concat(this.loadIcon());

    if (this.meta.hero) {
      this.loaders.concat(this.loadSpellIcons());
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
        console.log("img error: ", e);
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

  setup () {
    this.recordIndexes = {
      move: -1,
      level: -1,
      path: -1
    };

    this._prevDrawX = null;
    this._prevDrawY = null;

    this.decayLevel = 1;

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

    this._prevDrawX = null;
    this._prevDrawY = null;

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
      return;
    }

    // destroyed summons should not render after their expiry
    if (this.destroyedAt && gameTime >= this.destroyedAt) {
      this._destroyed = true;
      return;
    }

    // permanently consumed wisps (NE ancients) — old replays may lack destroyedAt
    // when destroyedAt IS set, the time-based check above handles it (wisp paths back first)
    if (this.destroyedByBuilding && !this.destroyedAt) {
      this._destroyed = true;
      return;
    }

    this._destroyed = false;

    // checks and updates current level record, setting this.fullName
    this.getCurrentLevelRecord(gameTime);

    // early exit for buildings
    if (this.isBuilding) {
      return;
    }

    const currentMoveRecord = this.getCurrentMovePath(gameTime);

    // scout lifecycle: unit moved well after scout event = no longer scouting
    if (this.scoutInfo && !this._scoutEnded) {
      if (currentMoveRecord && currentMoveRecord.gameTime > this.scoutInfo.gameTime + 10000) {
        this._scoutEnded = true;
      }
    }

    const isActiveScout = this.scoutInfo && !this._scoutEnded && gameTime >= this.scoutInfo.gameTime;

    if (currentMoveRecord) {
      if ((gameTime - currentMoveRecord.gameTime) > idleDecayTime) {
        if (isActiveScout) {
          // active scouts fade gradually but never fully disappear
          const scoutAge = gameTime - this.scoutInfo.gameTime;
          const fadeProgress = Math.min(1, scoutAge / 30000);
          this.decayLevel = Math.max(0.6 - fadeProgress * 0.3, this.decayLevel);
          return;
        }

        // idle detected, increment the decay level
        this.decay();
        return;
      }
    }

    // we have an active record so reset the units visual decay
    this.resetDecay();
  }

  renderBuilding (ctx, frameData, transform, xScale, yScale) {
    const { x, y } = this.lastPosition;

    // round to integers for pixel-perfect grid alignment
    const drawX = Math.round(xScale(x) + wc3v.gameScaler.middleX);
    const drawY = Math.round(yScale(y) + wc3v.gameScaler.middleY);

    // size building to match its WC3 placement grid footprint
    const footprintTiles = getBuildingFootprintTiles(this.itemId, this.collisionSize);
    const iconSize = Math.round(footprintTiles * 128 * wc3v.gameScaler.pxPerUnit);

    const halfIcon = Math.round(iconSize / 2);

    ctx.globalAlpha = buildingAlpha;
    ctx.drawImage(this.icon, drawX - halfIcon, drawY - halfIcon, iconSize, iconSize);

    ctx.strokeStyle = "#FFFC01";
    ctx.strokeRect(drawX - halfIcon, drawY - halfIcon, iconSize, iconSize);
    ctx.strokeStyle = "#000000";
    ctx.globalAlpha = 1.0;

    frameData.buildingPositions.push({
      x: drawX,
      y: drawY,
      halfSize: halfIcon,
      playerId: this.playerId
    });
  }

  renderUnit (ctx, frameData, transform, gameTime, xScale, yScale, viewOptions) {
    if (this.highlightMode === HighlightModes.none) {
      return;
    }

    if (!this.currentX || !this.currentY) {
      return;
    }

    if (this.isNeutralPlayer && this.isNeutralGroupHidden) {
      return;
    }

    if (this.isIllusion) {
      return;
    }

    const pathNode = this.path[this.recordIndexes.path];

    let currentX = pathNode && pathNode.x;
    let currentY = pathNode && pathNode.y;

    // active scouts: use scout target position when path data is stale
    const isActiveScout = this.scoutInfo && !this._scoutEnded && gameTime >= this.scoutInfo.gameTime;
    if (isActiveScout && this.scoutInfo.position) {
      const pathAge = pathNode ? (gameTime - pathNode.gameTime) : Infinity;
      if (pathAge > 5000 || isNaN(currentX) || isNaN(currentY)) {
        currentX = this.scoutInfo.position.x;
        currentY = this.scoutInfo.position.y;
      }
    }

    if (isNaN(currentX) || isNaN(currentY)) {
      return;
    }


    let drawX = xScale(currentX) + wc3v.gameScaler.middleX;
    let drawY = yScale(currentY) + wc3v.gameScaler.middleY;

    // jitter dead band: suppress sub-pixel oscillations between adjacent path records
    const JITTER_THRESHOLD_SQ = 2.5 * 2.5;
    if (this._prevDrawX !== null) {
      const jdx = drawX - this._prevDrawX;
      const jdy = drawY - this._prevDrawY;
      if (jdx * jdx + jdy * jdy < JITTER_THRESHOLD_SQ) {
        drawX = this._prevDrawX;
        drawY = this._prevDrawY;
      }
    }
    this._prevDrawX = drawX;
    this._prevDrawY = drawY;

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
    const iconSize = Math.max(this.iconSize, minimumIconSize);

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
  }

  renderPath (ctx, transform, gameTime, xScale, yScale, viewOptions) {
    const self = this;
    const path = this.path;
    if (!path.length || gameTime < this.readyTime) {
      return;
    }

    let levelRecordIndex = -1;

    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 4;
    ctx.strokeStyle = this.playerColor;
    ctx.fillStyle = "#FFF";

    ctx.beginPath();

    let lastX = 0,
        lastY = 0,
        lastGT = 0;

    /**
     * gaps -
     *  min: if there is a large distance delta and a small time delta
     *  max: if there is a small distance delta and a large time delta
     */

    
    const minTimeGap = (5 * 1000);   // small time delta     - 5 seconds
    const minGapThreshold = 1500;    // large distance delta - 1500 units

    const maxTimeGap = (300 * 1000); // large time delta     - 500 seconds
    const maxGapThreshold = 500;     // small distance delta - 500 units

    const idleGapTime = (10 * 1000); // any time gap > 10s is treated as idle (no connecting line)

    path.forEach((item, ind) => {
      if (item.gameTime > gameTime) {
        return;
      }

      if (ind > this.recordIndexes.path) {
        return;
      }

      if (viewOptions.decayEffects) {
        const delta = (gameTime - item.gameTime);

        if (delta > pathDecayTime) {
          return;
        }
      }

      const { x, y, isJump } = item;

      const drawX = xScale(x) + wc3v.gameScaler.middleX;
      const drawY = yScale(y) + wc3v.gameScaler.middleY;

      const spotDiffs = {
        dist: Helpers.distance(x, y, lastX, lastY),
        timeDelta: (item.gameTime - lastGT)
      };

      const isMinDistanceGap = (spotDiffs.dist > minGapThreshold);
      const isMaxDistanceGap = (spotDiffs.dist > maxGapThreshold);

      const isGap = (isMinDistanceGap && spotDiffs.timeDelta < minTimeGap) ||
                    (isMaxDistanceGap && spotDiffs.timeDelta > maxTimeGap) ||
                    (spotDiffs.timeDelta > idleGapTime);

      if (ind === 0 || isJump || isGap) {
        ctx.moveTo(drawX, drawY);        
      } else {
        ctx.lineTo(drawX, drawY);
      }

      lastX = x;
      lastY = y;
      lastGT = item.gameTime;
    });

    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1.0;
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

      const drawX = xScale(x) + wc3v.gameScaler.middleX;
      const drawY = yScale(y) + wc3v.gameScaler.middleY;

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

    if (this.isBuilding) {
      this.renderBuilding(buildingCtx, frameData, transform, xScale, yScale, viewOptions);
    } else {
      this.renderUnit(ctx, frameData, transform, gameTime, xScale, yScale, viewOptions);
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

window.ClientUnit = ClientUnit;
