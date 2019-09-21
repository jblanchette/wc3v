
const StatusTabs = {
  heroes: 1,
  units: 2,
  groups: 3
};

const ClientPlayer = class {
  constructor (slot, playerId, startingPosition, units, displayName, race, playerColor) {
    this.slot = slot;
    this.playerId = playerId;
    this.startingPosition = startingPosition;
    this.displayName = displayName;
    this.race = race;
    this.playerColor = playerColor;

    this.assetsLoaded = false;

    this.tab = StatusTabs.heroes;

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
    });
  }

  setup () {
    const starterMap = {
      'O': 'ogre',
      'H': 'htow',
      'N': 'etol',
      'U': 'unpl'
    };

    let unitLoaders = this.units.reduce((acc, unit) => {
      acc.concat(unit.loaders);

      return acc;
    }, []);

    const img = new Image();
    const imgSrc = `/assets/wc3icons/${starterMap[this.race]}.jpg`;
    
    const iconPromise = new Promise((resolve, reject) => {
      this.icon = null;
      img.src = imgSrc;
      img.onload = () => {
        this.icon = img;

        return resolve(true);
      };
    });

    unitLoaders.push(iconPromise);

    return Promise.allSettled(unitLoaders).then((e) => {
      console.log("player assets loaded: ", this.playerId);
      this.assetsLoaded = true;

      return true;
    });
  }

  update (gameTime, dt) {
    this.units.forEach(unit => unit.update(gameTime, dt));
  }

  renderPlayerIcon (ctx, playerStatusCtx, transform, gameTime, xScale, yScale) {
    if (!this.icon) {
      return;
    }

    const yMargin = 50;
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

    if (this.tab === StatusTabs.heroes) {
      const boxTextOffset = 5;
      this.renderHeroBox(
        playerStatusCtx, 
        gameTime,
        (drawIconX - halfIconSize), 
        (drawIconY + halfIconSize + boxTextOffset)
      );
    }
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
