const _iconCache = {};

const IconSizes = {
  'hero': 40,
  'unit': 30,
  'worker': 10,
  'building': 16
};

const minimumIconSize = 15,
      maximumBuildingSize = 20,
      minimumUnitSize = 10;

const buildingAlpha = 0.65;

const ClientUnit = class {
  constructor (unitData, playerColor) {
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

    this.playerColor = playerColor;
    this.setup();

    this.loadIcon();

    if (this.meta.hero) {
      this.loadSpellIcons();
    }
  }

  loadAsset (imgSrc, prop) {
    const img = new Image();
    
    this[prop] = null;

    if (_iconCache[imgSrc]) {
      this[prop] = _iconCache[imgSrc];
      return;
    }

    img.src = imgSrc;
    img.onload = () => {
      if (!_iconCache[imgSrc]) {
        _iconCache[imgSrc] = img;
      }

      this[prop] = img;
    };
  }

  loadIcon () {
    const imgSrc = `/assets/wc3icons/${this.itemId}.jpg`;
    this.loadAsset(imgSrc, 'icon');
  }

  loadSpellIcons () {
    this.spellList.forEach((spellId, index) => {
      const imgSrc = `/assets/wc3icons/${spellId.toLowerCase()}.jpg`;
      this.loadAsset(imgSrc, `spell-${index}`);
    });
  }

  setup () {
    // figure out initial position

    if (this.spawnPosition) {
      const { x, y } = this.spawnPosition;

      this.currentX = x;
      this.currentY = y;
    } else {
      const { x, y } = this.lastPosition;

      this.currentX = x;
      this.currentY = y;
    }

    this.recordIndexes = {
      move: -1,
      level: -1
    };

    this.decayLevel = 1;

    if (this.meta.hero) {
      this.iconSize = IconSizes.hero;
    } else if (this.isBuilding) {
      this.iconSize = IconSizes.building;
    } else if (this.meta.worker) {
      this.iconSize = IconSizes.worker;
    } else {
      this.iconSize = IconSizes.unit;
    }

    this.fullName = this.getFullName();
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

  getHeroLevel () {
    const levelRecord = this.levelStream && this.levelStream[this.recordIndexes.level];
    const heroLevel = levelRecord ? levelRecord.newLevel : 1;    

    return heroLevel;
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

  getCurrentLevelRecord (gameTime) {
    if (!this.meta.hero) {
      return;
    }

    const index = this.levelStream.findIndex(record => {
      return record.gameTime >= gameTime;
    });

    if (index === -1) {
      return;
    }

    if (this.recordIndexes.level !== index) {
      this.recordIndexes.level = index;
      this.fullName = this.getFullName();
    }
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

  decay (dt) {
    this.decayLevel -= this.meta.hero ? 0.0005 : 0.0025;

    if (this.meta.worker) {
      // don't fully decay workers, since they often idle
      this.decayLevel = Math.max(0.2, this.decayLevel);
    } else if (this.isBuilding) {
      this.decayLevel = Math.max(0.4, this.decayLevel);
    } else {
      this.decayLevel = Math.max(0.0, this.decayLevel);
    }
  }

  update (gameTime, dt) {
    if (gameTime < this.spawnTime) {
      return;
    }

    const hasRecord = this.getCurrentMoveRecord(gameTime);
    if (this.isBuilding || !hasRecord) {
      this.decay();

      return;
    }

    // checks and updates current level record, setting this.fullName
    this.getCurrentLevelRecord(gameTime);

    const secondsPassed = (dt * Helpers.MS_TO_SECONDS);
    const {
      xDirection,
      yDirection,
      xVelocity,
      yVelocity
    } = this.moveInfo;

    // direction vector * velocity * time delta

    const xDelta = (xDirection * xVelocity * secondsPassed);
    const yDelta = (yDirection * yVelocity * secondsPassed);

    // update the postion

    this.currentX += xDelta;
    this.currentY += yDelta;
  }

  renderBuilding (ctx, transform, xScale, yScale) {
    const { x, y } = this.lastPosition;

    const inverseK = (2.0 - transform.k);

    // (x * scale) + transform.x
    // (y * scale) + transform.y

    const drawX = ((xScale(x) + wc3v.middleX) * transform.k) + transform.x;
    const drawY = ((yScale(y) + wc3v.middleY) * transform.k) + transform.y;

    const dynamicSize = this.iconSize * inverseK; // inverse zoom scale
    const iconSize = Math.max(dynamicSize, minimumIconSize);

    ctx.globalAlpha = buildingAlpha;
    ctx.drawImage(this.icon, drawX, drawY, iconSize, iconSize); 

    ctx.strokeStyle = "#FFFC01";
    ctx.strokeRect(drawX, drawY, iconSize, iconSize);
    ctx.strokeStyle = "#000000";
    ctx.globalAlpha = 1.0;
  }

  renderUnit (ctx, transform, gameTime, xScale, yScale) {
    if (!this.currentX || !this.currentY) {
      return;
    }

    // (x * scale) + transform.x
    // (y * scale) + transform.y

    const { currentX, currentY } = this;
    const drawX = ((xScale(currentX) + wc3v.middleX) * transform.k) + transform.x;
    const drawY = ((yScale(currentY) + wc3v.middleY) * transform.k) + transform.y;

    const inverseK = (2.0 - transform.k);
    const dynamicSize = (this.iconSize * inverseK); // inverse zoom scale
    const iconSize = Math.max(dynamicSize, minimumIconSize); // minimum scaling
    const halfIconSize = iconSize / 2;
    
    const fontSize = halfIconSize;
    // draw code

    ctx.strokeStyle = "#FFFC01";
    ctx.globalAlpha = this.decayLevel;

    Drawing.drawImageCircle(ctx, this.icon, drawX, drawY, iconSize);

    // todo: optimize to not use fillText
    Drawing.drawCenteredText(ctx, drawX, drawY + iconSize, this.fullName, fontSize);
    
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colorMap.black;
  }

  render (ctx, transform, gameTime, xScale, yScale) {
    if (gameTime < this.spawnTime) {
      return;
    }

    if (this.isBuilding) {
      this.renderBuilding(ctx, transform, xScale, yScale);
    } else {
      this.renderUnit(ctx, transform, gameTime, xScale, yScale);
    }
  }
}

window.ClientUnit = ClientUnit;
