
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
    
    console.log("img src: ", imgSrc, this.race);
    this.icon = null;

    img.src = imgSrc;
    img.onload = () => {
      this.icon = img;
    };
  }

  update (gameTime, dt) {
    this.units.forEach(unit => unit.update(gameTime, dt));
  }

  renderPlayerIcon (ctx, gameTime, xScale, yScale, middleX, middleY) {
    // check if it isn't loaded yet
    if (!this.icon) {
      return;
    }

    const iconSize = 45;
    const halfIconSize = iconSize / 2;

    const minXExtent = wc3v.xExtent[0];
    const minYExtent = wc3v.yExtent[0];

    const padding = 5;
    const yMargin = 20;
    const slotOffset = (this.slot * (iconSize + yMargin)) + halfIconSize;

    const drawX = xScale(minXExtent) + middleX + halfIconSize + padding;
    const drawY = yScale(minYExtent) + middleY + slotOffset + padding;

    ctx.strokeStyle = "#FFFC01";
    ctx.globalAlpha = this.decayLevel;

    // clip our initial circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(drawX, drawY, halfIconSize, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.clip();

    // draw the icons
    ctx.drawImage(
      this.icon, 
      (drawX - halfIconSize), 
      (drawY - halfIconSize), 
      iconSize, 
      iconSize
    );

    // draw the icon ring
    ctx.beginPath();
    ctx.arc(drawX, drawY, halfIconSize, 0, Math.PI * 2, true);
    ctx.stroke();
    ctx.closePath();

    ctx.restore();

    // adjust text by length, ensure we don't go out of the map bounds
    const drawTextX = Math.max(
      xScale(minXExtent) + middleX, 
      (drawX - (this.displayName.length * 2.5))
    );
    const drawTextY = (drawY + halfIconSize + 10);

    ctx.strokeText(this.displayName, drawTextX, drawTextY);

    ctx.strokeStyle = "#000000";
    ctx.globalAlpha = 1;
  }

  render (ctx, gameTime, xScale, yScale, middleX, middleY) {
    this.renderPlayerIcon(ctx, gameTime, xScale, yScale, middleX, middleY);
    this.units.forEach(unit => 
      unit.render(ctx, gameTime, xScale, yScale, middleX, middleY));
  }
}

window.ClientPlayer = ClientPlayer;
