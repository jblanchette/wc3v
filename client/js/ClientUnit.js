const ClientUnit = class {
  constructor (unitData) {
    const dataFields = [ 
      "displayName", "itemId", "itemId1", "itemId2",
      "objectId1", "objectId2", "isRegistered", "isUnit",
      "isBuilding", "isIllusion", "level", "lastPosition",
      "path", "moveHistory", "meta", "items", "spawnTime"
    ];

    dataFields.forEach(field => {
      this[field] = unitData[field] || null;
    });
  }

  update (dt) {

  }

  renderBuilding (ctx, xScale, yScale, middleX, middleY) {
    ctx.strokeStyle = colorMap.buildingOutline;

    const { x, y } = this.lastPosition;
    const drawX = xScale(x) + middleX;
    const drawY = yScale(y) + middleY;

    ctx.strokeRect(drawX, drawY, 10, 10);
    ctx.strokeStyle = colorMap.black;
  }

  render (ctx, gameTime, xScale, yScale, middleX, middleY) {
    if (gameTime < this.spawnTime) {
      return;
    }

    if (this.isBuilding) {
      this.renderBuilding(ctx, xScale, yScale, middleX, middleY);
    }
  }
}

window.ClientUnit = ClientUnit;
