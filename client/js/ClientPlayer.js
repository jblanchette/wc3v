
const ClientPlayer = class {
  constructor (slot, playerId, startingPosition, units, displayName, race, playerColor) {
    this.slot = slot;
    this.playerId = playerId;
    this.startingPosition = startingPosition;
    this.displayName = displayName;
    this.race = race;
    this.playerColor = playerColor;

    // make new ClientUnit instances
    this.units = units.map(unitData => new ClientUnit(unitData, playerColor));
    
    const sortedUnits = this.units.sort((a, b) => {
      return a.spawnTime - b.spawnTime;
    });

    this.setup();
  }

  setup () {
    const starterMap = {
      'O': 'ogre',
      'H': 'htow',
      'N': 'etol',
      'U': 'unpl'
    };

    const img = new Image();
    const imgSrc = `/assets/wc3icons/${starterMap[this.race]}.jpg`;
    
    this.icon = null;
    img.src = imgSrc;
    img.onload = () => {
      this.icon = img;
    };
  }

  update (gameTime, dt) {
    this.units.forEach(unit => unit.update(gameTime, dt));
  }

  renderSelectedUnit () {
    
  }

  renderPlayerIcon (ctx, transform, gameTime, xScale, yScale, mapX, mapY) {
    // check if it isn't loaded yet
    if (!this.icon) {
      return;
    }

    const iconSize = Math.min(25 * (2.0 - transform.k), 30);
    const halfIconSize = iconSize / 2;

    const minXExtent = wc3v.xExtent[0];
    const minYExtent = wc3v.yExtent[0];

    const padding = 5;
    const yMargin = 20;
    const slotOffset = (this.slot * (iconSize + yMargin)) + halfIconSize;

    const drawX = (transform.x + xScale(minXExtent) + wc3v.middleX);
    const drawY = (transform.y + yScale(minYExtent) + wc3v.middleY + slotOffset);

    ctx.strokeStyle = "#FFFC01";
    ctx.globalAlpha = this.decayLevel;

    // clip our initial circle
    Drawing.drawImageCircle(ctx, this.icon, drawX, drawY, iconSize);

    // adjust text by length, ensure we don't go out of the map bounds
    const drawTextX = drawX;
    const drawTextY = (drawY + halfIconSize + 10);

    ctx.strokeText(this.displayName, drawTextX, drawTextY);

    ctx.strokeStyle = "#000000";
    ctx.globalAlpha = 1;
  }

  render (ctx, transform, gameTime, xScale, yScale, mapX, mapY) {
    this.renderPlayerIcon(ctx, transform, gameTime, xScale, yScale, mapX, mapY);
    this.units.forEach(unit => 
      unit.render(ctx, transform, gameTime, xScale, yScale, mapX, mapY));
  }
}

window.ClientPlayer = ClientPlayer;
