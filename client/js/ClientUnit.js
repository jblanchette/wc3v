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
  'hero': 36,
  'unit': 22,
  'worker': 14,
  'building': 16
};

const minimumUnitSize     = 12,
      minimumBuildingSize = 12,
      minimumHeroIconSize = 22;
      
const maximumBuildingSize = 20,
      minFontSize         = 8,
      maxFontSize         = 11;

//// 
// drawing constants
////

const buildingAlpha = 0.55;
const minNeighborDrawDistance = 20;
const pathDecayTime = 1000 * 100;

const ClientUnit = class {
  constructor (unitData, playerId, playerColor) {
    const dataFields = [ 
      "displayName", "itemId", "itemId1", "itemId2",
      "objectId1", "objectId2", "isRegistered", "isUnit",
      "isBuilding", "isIllusion", "level", "lastPosition",
      "path", "moveHistory", "meta", "items", "spawnTime",
      "spawnPosition", "levelStream", "spellList"
    ];

    dataFields.forEach(field => {
      this[field] = unitData[field] || null;
    });

    this.playerId = playerId;
    this.playerColor = playerColor;

    this.highlightMode = HighlightModes.all;

    this.setup();

    this.loaders = [];

    this.loaders.concat(this.loadIcon());

    if (this.meta.hero) {
      this.loaders.concat(this.loadSpellIcons());
    }
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

    if (this.meta.hero) {
      this.iconSize = IconSizes.hero;
      this.minDecayLevel = 0.0;
    } else if (this.isBuilding) {
      this.iconSize = IconSizes.building;
      this.decayLevel = 0.4;
    } else if (this.meta.worker) {
      this.iconSize = IconSizes.worker;

      // don't fully decay workers, since they often idle
      this.minDecayLevel = 0.325;
    } else {
      this.iconSize = IconSizes.unit;
      this.minDecayLevel = 0.0;
    }
  }

  getFullName () {
    if (!this.meta.hero) {
      return this.displayName;
    } else {
      if (this.isIllusion) {
        return `${this.displayName} (I)`;
      }

      const levelRecord = this.levelStream && this.levelStream[this.recordIndexes.level];
      const heroLevel = levelRecord ? levelRecord.newLevel : 1;

      return `${this.displayName} (${heroLevel})`;
    }
  }

  getHeroLevelRecord () {
    const levelRecord = this.levelStream && this.levelStream[this.recordIndexes.level];

    return levelRecord || null;
  }

  getCurrentMoveRecord (gameTime) {
    const index = this.moveHistory.findIndex(record => {
      const { startTime, endTime } = record.timerData;

      if (gameTime >= startTime && gameTime <= endTime) {
        return record;
      }
    });

    if (index === -1) {
      return false;
    }

    if (this.recordIndexes.move !== index) {
      this.initMove(index);
    }

    this.recordIndexes.move = index;
    return true;
  }

  getCurrentMovePath (gameTime) {
    const { path } = this;

    let index = -1;
    for (let i = 0; i < path.length; i++) {
      const record = path[i];

      if (record.gameTime > gameTime) {
        break;
      }
      
      index = i;
    }

    if (index === -1) {
      return false;
    }

    this.recordIndexes.path = index;
    return true;
  }

  getCurrentLevelRecord (gameTime, verbose = false) {
    if (!this.meta.hero) {
      return;
    }

    const { levelStream } = this;

    let index = -1;
    for (let i = 0; i < levelStream.length; i++) {
      const record = levelStream[i];

      if (record.gameTime > gameTime) {
        break;
      }
      
      index = i;
    }

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
    // calculate decay
    this.getCurrentLevelRecord(gameTime);
    this.getCurrentMovePath(gameTime);

    const hasMoveRecord = this.getCurrentMoveRecord(gameTime);
    if (!hasMoveRecord) {
      this.decayLevel = 0;

      return;
    }    

    const moveRecord = this.moveHistory[this.recordIndexes.move];
    const { timerData, startX, startY } = moveRecord;
    const moveJumpDelta = (gameTime - timerData.startTime);

    this.currentX = startX;
    this.currentY = startY;

    this.update(gameTime, moveJumpDelta);
  }

  initMove (index) {
    const { targetX, targetY } = this.moveHistory[index];

    const pathDistance = Helpers.distance(
      this.currentX, this.currentY,
      targetX, targetY
    );

    const ms = (this.meta.movespeed || 250);
    const pathTime = (pathDistance / ms);

    this.decayLevel = 1;
    this.moveInfo = {
      startX: this.currentX,
      startY: this.currentY,
      targetX: targetX,
      targetY: targetY,
      xDirection: (targetX > this.currentX) ? 1 : -1,
      yDirection: (targetY > this.currentY) ? 1 : -1,
      pathDistance: pathDistance,
      pathTime: pathTime,
      xVelocity: (Math.abs(targetX - this.currentX) / pathTime),
      yVelocity: (Math.abs(targetY - this.currentY) / pathTime)
    };
  }

  decay (dt = 1.0) {
    const amount = this.meta.hero ? 0.0015 : 0.0035;
    this.decayLevel = Math.max(this.minDecayLevel, this.decayLevel - (amount * dt));
  }

  update (gameTime, dt) {
    if (gameTime < this.spawnTime) {
      return;
    }

    // checks and updates current level record, setting this.fullName
    this.getCurrentLevelRecord(gameTime);
    const hasRecord = this.getCurrentMovePath(gameTime);
    
    this.getCurrentMoveRecord(gameTime);
    if (this.isBuilding || !hasRecord) {
      this.decay();

      return;
    }
  }

  renderBuilding (ctx, transform, xScale, yScale) {
    const { x, y } = this.lastPosition;

    const inverseK = (2.0 - transform.k);

    const drawX = ((xScale(x) + wc3v.gameScaler.middleX) * transform.k) + transform.x;
    const drawY = ((yScale(y) + wc3v.gameScaler.middleY) * transform.k) + transform.y;

    const dynamicSize = this.iconSize * inverseK; // inverse zoom scale
    const iconSize = Math.max(dynamicSize, minimumBuildingSize);

    ctx.globalAlpha = buildingAlpha;
    ctx.drawImage(this.icon, drawX, drawY, iconSize, iconSize); 

    ctx.strokeStyle = "#FFFC01";
    ctx.strokeRect(drawX, drawY, iconSize, iconSize);
    ctx.strokeStyle = "#000000";
    ctx.globalAlpha = 1.0;
  }

  renderUnit (ctx, frameData, transform, gameTime, xScale, yScale, viewOptions) {
    if (this.highlightMode === HighlightModes.none) {
      return;
    }

    if (!this.currentX || !this.currentY) {
      return;
    }

    // (x * scale) + transform.x
    // (y * scale) + transform.y

    const pathNode = this.path[this.recordIndexes.path];

    const currentX = pathNode && pathNode.x;
    const currentY = pathNode && pathNode.y;

    let drawX = ((xScale(currentX) + wc3v.gameScaler.middleX) * transform.k) + transform.x;
    let drawY = ((yScale(currentY) + wc3v.gameScaler.middleY) * transform.k) + transform.y;

    const { unitDrawPositions } = frameData;

    const inverseK = (2.0 - transform.k);
    const dynamicSize = (this.iconSize * inverseK); // inverse zoom scale

    const minimumIconSize = this.meta.hero ? 
      minimumHeroIconSize : minimumUnitSize;
    const iconSize = (dynamicSize < minimumIconSize) ?
      minimumIconSize : dynamicSize;

    const halfIconSize = iconSize / 2.5;
    
    const fontSize = Math.max(Math.min(halfIconSize, maxFontSize), minFontSize);
    const neighbor = this.hasDrawingNeighbor(unitDrawPositions, drawX, drawY);

    if (!this.meta.hero) {  
      if (neighbor && neighbor.unit.itemId === this.itemId) {        
        neighbor.unit.count += 1;

        return;
      }
    } else {
      if (neighbor) {
        drawX -= iconSize * (neighbor.unit.count - 1);
        neighbor.unit.count += 1;
      }
    }

    // add unit to draw frame unit positions
    unitDrawPositions.push({ 
      itemId: this.itemId,
      fullName: this.fullName,
      playerId: this.playerId,
      iconSize: iconSize,
      fontSize: fontSize,
      decayLevel: this.decayLevel,
      isHero: this.meta.hero,
      x: drawX, 
      y: drawY,
      count: 1
    });

    // draw code

    ctx.strokeStyle = "#FFFC01";
    ctx.globalAlpha = this.decayLevel;

    ctx.fillStyle = this.playerColor;
    ctx.beginPath();
    ctx.arc(drawX, drawY, halfIconSize + 2, 0, Math.PI * 2, true);
    ctx.fill();
    ctx.fillStyle = "#000";

    if (!this.icon) {
      console.error("missing icon for unit: ", this);
    }
    
    Drawing.drawImageCircle(ctx, this.icon, drawX, drawY, iconSize);

    ctx.globalAlpha = 1;
    ctx.strokeStyle = colorMap.black;
  }

  renderPath (ctx, transform, gameTime, xScale, yScale, viewOptions) {
    const self = this;
    const path = this.path;
    if (!path.length || gameTime < this.spawnTime) {
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

    path.forEach((item, ind) => {
      if (item.gameTime > gameTime) {
        return;
      }

      if (viewOptions.decayEffects) {
        const delta = (gameTime - item.gameTime);

        if (delta > pathDecayTime) {
          return;
        }
      }

      const { x, y, isJump } = item;

      const drawX = ((xScale(x) + wc3v.gameScaler.middleX) * transform.k) + transform.x;
      const drawY = ((yScale(y) + wc3v.gameScaler.middleY) * transform.k) + transform.y;

      const spotDiffs = {
        dist: Helpers.distance(x, y, lastX, lastY),
        timeDelta: (item.gameTime - lastGT)
      };

      const isMinDistanceGap = (spotDiffs.dist > minGapThreshold);
      const isMaxDistanceGap = (spotDiffs.dist > maxGapThreshold);

      const isGap = (isMinDistanceGap && spotDiffs.timeDelta < minTimeGap) ||
                    (isMaxDistanceGap && spotDiffs.timeDelta > maxTimeGap);

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

  renderLevelDots (ctx, transform, gameTime, xScale, yScale, viewOptions) {
    const drawPadding = 4;

    ctx.globalAlpha = 0.75;

    this.levelStream.some(levelRecord => {
      if (gameTime < levelRecord.gameTime) {
        return true;
      }

      const { x, y } = levelRecord.position;

      const drawX = ((xScale(x) + wc3v.gameScaler.middleX) * transform.k) + transform.x;
      const drawY = ((yScale(y) + wc3v.gameScaler.middleY) * transform.k) + transform.y;

      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.arc(drawX, drawY, 10, 0, Math.PI * 2, true);
      ctx.fillStyle = "#FFF";
      ctx.fill();
      
      ctx.font = `bold 12px Arial`;
      ctx.fillStyle = "#000";
      ctx.fillText(levelRecord.newLevel, drawX - drawPadding, drawY + drawPadding);
      
      ctx.globalAlpha = 1.0;
        
      // draw which spell was leveled up
      Drawing.drawImageCircle(
        ctx, 
        this[`spell-${levelRecord.slot}`],
        drawX + 10,
        drawY + 10,
        12
      );
    });

    ctx.globalAlpha = 1;
  }

  render (frameData, ctx, buildingCtx, transform, gameTime, xScale, yScale, viewOptions) {
    if (gameTime < this.spawnTime) {
      return;
    }

    if (this.isBuilding) {
      this.renderBuilding(buildingCtx, transform, xScale, yScale, viewOptions);
    } else {
      this.renderUnit(ctx, frameData, transform, gameTime, xScale, yScale, viewOptions);
    }
  }
}

window.ClientUnit = ClientUnit;
