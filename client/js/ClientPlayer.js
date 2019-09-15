
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
    
    // sort buildings first so they get drawn first
    this.units = this.units.sort((a, b) => {
      // magical js
      return b.isBuilding - a.isBuilding;
    });

    this.heroes = this.units.filter(unit => {
      return unit.meta.hero && !unit.isIllusion;
    }).sort((a, b) => {
      return a.spawnTime - b.spawnTime;
    })

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

  renderPlayerIcon (ctx, playerStatusCtx, transform, gameTime, xScale, yScale) {
    if (!this.icon) {
      return;
    }

    const yMargin = 20;
    const xPadding = 6;
    const yPadding = 25;

    const boxHeight = 100 + wc3v.playerSlotOffset;

    const drawX = xPadding;
    const drawY = yMargin + this.slot * (yPadding + boxHeight);

    const iconSize = 30;
    const halfIconSize = iconSize / 2;
    const iconPadding = 2;

    playerStatusCtx.fillRect(drawX, drawY, 75, boxHeight);

    const drawIconX = drawX + iconPadding + halfIconSize;
    const drawIconY = drawY + iconPadding + halfIconSize;

    Drawing.drawImageCircle(
      playerStatusCtx, 
      this.icon, 
      drawIconX,
      drawIconY,
      iconSize
    );

    const drawTextX = drawIconX - halfIconSize;
    const drawTextY = (drawIconY + halfIconSize + 10);

    playerStatusCtx.strokeText(this.displayName, drawTextX, drawTextY);

    const boxTextOffset = 10;
    this.renderHeroBox(playerStatusCtx, drawTextX, drawTextY + boxTextOffset);
  }

  renderHeroBox (playerStatusCtx, offsetX, offsetY) {
    const boxHeight = 65;
    const subBoxWidth = 45;
    const boxWidth = subBoxWidth * 3;

    const skillBoxHeight = 20;
    const skillBoxOffset = offsetY + (boxHeight - skillBoxHeight);

    for (let heroSlot = 0; heroSlot < this.heroes.length; heroSlot++) {
      const boxX = offsetX + (subBoxWidth * heroSlot);
      const hero = this.heroes[heroSlot];

      if (hero) {
        playerStatusCtx.strokeRect(boxX, offsetY, subBoxWidth, boxHeight);
        playerStatusCtx.drawImage(hero.icon, boxX, offsetY, subBoxWidth, (boxHeight - skillBoxHeight));
      }
    }

    playerStatusCtx.beginPath();
    playerStatusCtx.moveTo(offsetX, skillBoxOffset);
    playerStatusCtx.lineTo(offsetX + (this.heroes.length * subBoxWidth), skillBoxOffset);
    playerStatusCtx.stroke();
  }

  render (ctx, playerStatusCtx, transform, gameTime, xScale, yScale) {
    this.renderPlayerIcon(ctx, playerStatusCtx, transform, gameTime, xScale, yScale);
    this.units.forEach(unit => 
      unit.render(ctx, transform, gameTime, xScale, yScale));
  }
}

window.ClientPlayer = ClientPlayer;
