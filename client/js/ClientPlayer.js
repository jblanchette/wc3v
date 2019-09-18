
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

    const yMargin = 10;
    const xPadding = 10;
    const yPadding = 15;

    const boxHeight = 120 + wc3v.playerSlotOffset;

    const drawX = xPadding;
    const drawY = yMargin + this.slot * (yPadding + boxHeight);

    const iconSize = 30;
    const halfIconSize = iconSize / 2;
    const iconPadding = 2;

    const drawIconX = drawX + iconPadding + halfIconSize;
    const drawIconY = drawY + iconPadding + halfIconSize;

    Drawing.drawImageCircle(
      playerStatusCtx, 
      this.icon, 
      drawIconX,
      drawIconY,
      iconSize
    );

    const drawTextX = drawIconX + halfIconSize + xPadding;
    const drawTextY = drawIconY + (halfIconSize / 2);

    playerStatusCtx.strokeText(this.displayName, drawTextX, drawTextY);

    const boxTextOffset = 5;
    this.renderHeroBox(
      playerStatusCtx, 
      gameTime,
      (drawIconX - halfIconSize), 
      (drawIconY + halfIconSize + boxTextOffset)
    );
  }

  renderHeroBox (playerStatusCtx, gameTime, offsetX, offsetY) {
    const boxHeight = 75;
    const subBoxWidth = 50;
    const boxWidth = subBoxWidth * 3;

    const skillBoxHeight = 20;
    const skillBoxOffset = offsetY + (boxHeight - skillBoxHeight);

    const skillSubBoxWidth = (subBoxWidth / 2);

    for (let heroSlot = 0; heroSlot < this.heroes.length; heroSlot++) {
      const boxX = offsetX + (subBoxWidth * heroSlot);
      const hero = this.heroes[heroSlot];

      if (hero) {

        playerStatusCtx.globalAlpha = (hero.spawnTime <= gameTime) ? 1.0 : 0.25;
        playerStatusCtx.strokeRect(boxX, offsetY, subBoxWidth, boxHeight + skillBoxHeight);
        playerStatusCtx.drawImage(hero.icon, boxX, offsetY, subBoxWidth, (boxHeight - skillBoxHeight));

        Drawing.drawBoxedLevel(playerStatusCtx, hero.getHeroLevel(), boxX, offsetY, subBoxWidth, (boxHeight - skillBoxHeight));

        hero.spellList.forEach((spellId, spellSlot) => {
          const spellX = boxX + (skillSubBoxWidth * spellSlot);

          const spellRowOffsetY = (spellSlot > 1) ? skillBoxHeight : 0;
          const spellRowOffsetX = (spellSlot > 1) ? -(skillSubBoxWidth * 2) : 0;

          playerStatusCtx.drawImage(
            hero[`spell-${spellSlot}`], 
            spellX + spellRowOffsetX,
            skillBoxOffset + spellRowOffsetY,
            skillSubBoxWidth,
            skillBoxHeight
          );
        });

        playerStatusCtx.globalAlpha = 1.0;
      }
    }
  }

  render (ctx, playerStatusCtx, transform, gameTime, xScale, yScale) {
    this.renderPlayerIcon(ctx, playerStatusCtx, transform, gameTime, xScale, yScale);
    this.units.forEach(unit => 
      unit.render(ctx, transform, gameTime, xScale, yScale));
  }
}

window.ClientPlayer = ClientPlayer;
