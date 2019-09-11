const _iconCache = {};

const IconSizes = {
  'hero': 30,
  'unit': 20,
  'worker': 10,
  'building': 16
};

const minimumIconSize = 20,
      maximumBuildingSize = 20,
      minimumTextZoom = 0.75;

const ClientUnit = class {
  constructor (unitData, playerColor) {
    const dataFields = [ 
      "displayName", "itemId", "itemId1", "itemId2",
      "objectId1", "objectId2", "isRegistered", "isUnit",
      "isBuilding", "isIllusion", "level", "lastPosition",
      "path", "moveHistory", "meta", "items", "spawnTime",
      "spawnPosition"
    ];

    dataFields.forEach(field => {
      this[field] = unitData[field] || null;
    });

    this.playerColor = playerColor;
    this.setup();

    this.loadIcon();
  }

  loadIcon () {
    const img = new Image();
    const imgSrc = `/assets/wc3icons/${this.itemId}.jpg`;
    
    this.icon = null;

    if (_iconCache[imgSrc]) {
      this.icon = _iconCache[imgSrc];
      return;
    }

    img.src = imgSrc;
    img.onload = () => {
      if (!_iconCache[imgSrc]) {
        _iconCache[imgSrc] = img;
      }

      this.icon = img;
    };
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

    this.currentMoveRecordIndex = -1;
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

    if (this.currentMoveRecordIndex !== index) {
      this.initMove(index);
    }

    this.currentMoveRecordIndex = index;
    return true;
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
      this.decayLevel = Math.max(0.2, this.decayLevel);
    } else {
      this.decayLevel = Math.max(0.0, this.decayLevel);
    }
  }

  update (gameTime, dt) {
    if (gameTime < this.spawnTime) {
      return;
    }

    const hasRecord = this.getCurrentMoveRecord(gameTime);
    if (!hasRecord) {
      this.decay();

      return;
    }

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

  renderBuilding (ctx, transform, xScale, yScale, mapX, mapY) {
    const { x, y } = this.lastPosition;

    const inverseK = (2.0 - transform.k);

    const drawX = (transform.x + xScale(x) + wc3v.middleX);
    const drawY = (transform.y + yScale(y) + wc3v.middleY);

    const dynamicSize = this.iconSize * (2.0 - transform.k); // inverse zoom scale
    const iconSize = Math.min(maximumBuildingSize, Math.max(minimumIconSize, dynamicSize)); // bounds

    ctx.drawImage(this.icon, drawX, drawY, iconSize, iconSize);

    ctx.strokeStyle = "#FFFC01";
    ctx.strokeRect(drawX, drawY, iconSize, iconSize);
    ctx.strokeStyle = "#000000";
  }

  renderUnit (ctx, transform, gameTime, xScale, yScale, mapX, mapY) {
    if (!this.currentX || !this.currentY) {
      return;
    }

    const { currentX, currentY } = this;

    const drawX = (transform.x + xScale(currentX) + wc3v.middleX);
    const drawY = (transform.y + yScale(currentY) + wc3v.middleY);

    const inverseK = (2.0 - transform.k);
    const dynamicSize = this.iconSize * inverseK; // inverse zoom scale
    const iconSize = Math.min(maximumBuildingSize, Math.max(minimumIconSize, dynamicSize)); // minimum scaling
    const halfIconSize = iconSize / 2;
    
    const fontSize = halfIconSize;
    // draw code

    ctx.strokeStyle = "#FFFC01";
    ctx.globalAlpha = this.decayLevel;

    Drawing.drawImageCircle(ctx, this.icon, drawX, drawY, iconSize);

    const drawTextX = drawX - (this.displayName.length * 2);
    const drawTextY = drawY + iconSize;

    if (inverseK > minimumTextZoom) {
      ctx.fillStyle = "#FFF";
      ctx.font = `${Math.ceil(fontSize)}px Arial`;
      ctx.fillText(this.displayName, drawTextX, drawTextY );
      ctx.font = `12px Arial`;
      ctx.fillStyle = "#000";
    }

    ctx.globalAlpha = 1;
    ctx.strokeStyle = colorMap.black;
  }

  render (ctx, transform, gameTime, xScale, yScale, mapX, mapY) {
    if (gameTime < this.spawnTime) {
      return;
    }

    if (this.isBuilding) {
      this.renderBuilding(ctx, transform, xScale, yScale, mapX, mapY);
    } else {
      this.renderUnit(ctx, transform, gameTime, xScale, yScale, mapX, mapY);
    }
  }
}

window.ClientUnit = ClientUnit;
