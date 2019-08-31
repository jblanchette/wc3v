const ClientUnit = class {
  constructor (unitData) {
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

    this.setup();
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
  }

  getCurrentMoveRecord (gameTime) { 
    const record = this.moveHistory.find(record => {
      const { startTime, endTime } = record.timerData;

      if (gameTime >= startTime && gameTime <= endTime) {
        return record;
      }
    });

    if (!record) {
      return false;
    }

    const { targetX, targetY } = record;

    const pathDistance = Helpers.distance(
      this.currentX, this.currentY,
      targetX, targetY
    );

    const ms = (this.meta.movespeed || 250);
    const pathTime = (pathDistance / ms);

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

    return true;
  }

  update (gameTime, dt) {
    if (gameTime < this.spawnTime) {
      return;
    }

    const hasRecord = this.getCurrentMoveRecord(gameTime);
    if (!hasRecord) {
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

  renderBuilding (ctx, xScale, yScale, middleX, middleY) {
    ctx.strokeStyle = colorMap.buildingOutline;

    const { x, y } = this.lastPosition;
    const drawX = xScale(x) + middleX;
    const drawY = yScale(y) + middleY;

    ctx.strokeRect(drawX, drawY, 10, 10);
    ctx.strokeStyle = colorMap.black;
  }

  renderUnit (ctx, gameTime, xScale, yScale, middleX, middleY) {
    if (!this.currentX || !this.currentY) {
      return;
    }

    const { currentX, currentY } = this;
    const drawX = xScale(currentX) + middleX;
    const drawY = yScale(currentY) + middleY;

    // draw code

    ctx.strokeStyle = colorMap.unitPath;

    ctx.beginPath();
    ctx.arc(drawX, drawY, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    ctx.strokeStyle = colorMap.black;

    ctx.fillStyle = "#FFF";
    ctx.fillText(this.displayName, drawX, drawY);
    ctx.fillStyle = "#000";
  }

  render (ctx, gameTime, xScale, yScale, middleX, middleY) {
    if (gameTime < this.spawnTime) {
      return;
    }

    if (this.isBuilding) {
      this.renderBuilding(ctx, xScale, yScale, middleX, middleY);
    } else {
      this.renderUnit(ctx, gameTime, xScale, yScale, middleX, middleY);
    }
  }
}

window.ClientUnit = ClientUnit;
