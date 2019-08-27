
const ClientPlayer = class {
  constructor (playerId, startingPosition, units) {
    this.playerId = playerId;
    this.startingPosition = startingPosition;
    this.units = units.map(unitData => new ClientUnit(unitData));

    const sortedUnits = this.units.sort((a, b) => {
      return a.spawnTime - b.spawnTime;
    });

    console.log("sorted: ", sortedUnits
      .filter(u => { return u.isBuilding })
      .map(u => u.spawnTime));
  }

  update (dt) {
    units.forEach(unit => unit.update(dt));
  }

  render (ctx, gameTime, xScale, yScale, middleX, middleY) {
    this.units.forEach(unit => 
      unit.render(ctx, gameTime, xScale, yScale, middleX, middleY));
  }
}

window.ClientPlayer = ClientPlayer;
