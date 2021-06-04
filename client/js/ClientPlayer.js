
const StatusTabs = {
  heroes: 1,
  units: 2,
  groups: 3
};

const TierColors = {
  1: "#FFFFFF",
  2: "#21a5e3",
  3: "#FFFF33"
};

const TeamColors = {

};

const ClientPlayer = class {
  constructor (slot, teamColor, playerId, startingPosition, units, displayName, race, selectionStream, tierStream, playerColor, isNeutralPlayer) {
    this.slot = slot;
    this.teamColor = teamColor;
    this.playerId = playerId;
    this.startingPosition = startingPosition;
    this.displayName = displayName;
    this.race = race;
    this.selectionStream = selectionStream;
    this.tierStream = tierStream;
    this.playerColor = playerColor;
    this.isNeutralPlayer = isNeutralPlayer;

    this.assetsLoaded = false;
    this.tab = StatusTabs.heroes;

    this.tier = 1;

    this.recordIndexes = {
      selection: -1,
      tier: -1
    };

    this.currentGroup = null;
    this.setupUnits(units);

    console.log("setup player: ", this);
  }

  setupUnits (rawUnits) {
    // make new ClientUnit instances
    this.units = rawUnits.map(unitData => 
      new ClientUnit(unitData, this.playerId, this.playerColor, this.isNeutralPlayer));
    
    // drawing sort order: buildings, heroes, units
    this.units = this.units
    .sort((a, b) => {
      return b.isBuilding - a.isBuilding;
    });

    this.units = this.units
    .sort((a, b) => {
      return a.meta.hero - b.meta.hero;
    });

    this.unitsByItemId = this.units.reduce((acc, unit) => {
      const { itemIdHash } = unit;
      
      if (itemIdHash === "unregistered") {
        return acc;
      }

      acc[itemIdHash] = unit;
      return acc;
    }, {});

    this.heroes = this.units.filter(unit => {
      return unit.meta.hero && !unit.isIllusion;
    }).sort((a, b) => {
      return a.spawnTime - b.spawnTime;
    });
  }

  getCurrentTier (gameTime) {
    const { tierStream } = this;

    const index = Helpers.findIndexFrom(
      tierStream, 
      Helpers.StandardStreamSearch, 
      this.recordIndexes.tier,
      gameTime
    );

    if (index === -1) {
      return null;
    }

    this.recordIndexes.path = index;

    // return back the new record
    return tierStream[index];
  }

  getSelectionRecord (gameTime) {
    const { selectionStream } = this;

    const index = Helpers.findIndexFrom(
      selectionStream, 
      Helpers.StandardStreamSearch, 
      this.recordIndexes.selection,
      gameTime
    );

    if (index === -1) {
      return null;
    }

    if (this.recordIndexes.selection !== index) {
      this.enrichSelectionGroup();
      this.recordIndexes.selection = index;
    }

    // return back the new record
    return selectionStream[index];
  }

  enrichSelectionGroup () {
    const item = this.selectionStream[this.recordIndexes.selection];
    if (!item) {
      return;
    }

    const { selection } = item;

    this.currentGroup = selection.units.reduce((acc, unit) => {
      const { itemId1, itemId2 } = unit;
      if (!itemId1 || !itemId2) {
        return acc;
      }

      const itemIdHash = Helpers.makeItemIdHash(itemId1, itemId2);

      if (!this.unitsByItemId[itemIdHash]) {
        // some units don't end up registered at all
        return acc;
      }

      acc.push(this.unitsByItemId[itemIdHash]);
      return acc;
    }, []);
  }

  setStatusTab (tab) {
    this.tab = StatusTabs[tab];
  }

  setup () {
    const starterMap = {
      'O': 'ogre',
      'H': 'htow',
      'E': 'etol',
      'U': 'unpl'
    };

    let unitLoaders = this.units.reduce((acc, unit) => {
      acc.concat(unit.loaders);

      return acc;
    }, []);

    let firstHero = null;
    let heroes = [];

    this.units.forEach(unit => {
      if (!unit.meta.hero || unit.isIllusion) {
        return;
      }

      heroes.push(unit);

      if (!firstHero) {
        firstHero = unit;
      }

      if (unit.spawnTime < firstHero.spawnTime) {
        firstHero = unit;
      }
    });

    heroes = heroes.sort(hero => hero.spawnTime);
    heroes.forEach((hero, ind) => { hero.heroRank = ind + 1; });

    if (firstHero) {
      firstHero.isMainHero = true;
    }

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
      this.assetsLoaded = true;

      return true;
    });
  }

  update (gameTime, dt) {
    this.units.forEach(unit => {
      unit.update(gameTime, dt);
    });
    
    const tierEvent = this.getCurrentTier(gameTime);
    if (tierEvent) {
      this.tier = Math.min(3, tierEvent.tier);
    }

    // parser apparently is skipping the needed block for this

    this.getSelectionRecord(gameTime);
  }

  moveTracker (gameTime) {
    this.units.forEach(unit => {
      // reset a units record indexes, decay status, full name
      unit.jump(gameTime);

      // update the unit at the new gameTime to prepare for rendering
      unit.update(gameTime, 1);
    });

    this.getSelectionRecord(gameTime);
  }

  renderPlayerIcon (playerStatusCtx, transform, gameTime, xScale, yScale, viewOptions) {
    if (this.isNeutralPlayer) {
      return;
    }

    if (!this.icon) {
      return;
    }

    const yMargin = 50;
    const xPadding = 10;
    const yPadding = 35;

    const boxHeight = 120 + wc3v.playerSlotOffset;

    const drawX = 40 + xPadding; // leave room for tier + status
    const drawY = yMargin + this.slot * (yPadding + boxHeight);

    const drawBoxWidth = 265; // should match #player-status-wrapper width
    const drawBoxHeight = 115;

    const iconSize = 30;
    const halfIconSize = iconSize / 2;
    const iconPadding = 2;

    const drawIconX = drawX + iconPadding + halfIconSize;
    const drawIconY = drawY + iconPadding + halfIconSize;

    const drawBoxX = drawX;
    const drawBoxY = drawY + iconPadding + iconSize + 4;

    if (!this.icon) {
      console.error("missing icon for unit: ", this);
    }

    if (this.slot === 0) {
      playerStatusCtx.fillStyle = "#5fa5cb";
      playerStatusCtx.fillRect(0, 0, drawBoxWidth, drawY);
    }

    ////
    // draw player color box
    ////
    playerStatusCtx.fillStyle = this.playerColor;
    playerStatusCtx.fillRect(drawX, drawBoxY, drawBoxWidth, drawBoxHeight);

    ////
    // draw team color box
    ////
    playerStatusCtx.fillStyle = this.teamColor;
    playerStatusCtx.fillRect(0, drawBoxY, drawX, drawBoxHeight);

    ////
    // border lines between boxes
    ////
    playerStatusCtx.lineWidth = 2;
    playerStatusCtx.beginPath();

    // border between team color and player color
    playerStatusCtx.moveTo(drawBoxX, drawBoxY);
    playerStatusCtx.lineTo(drawBoxX, drawBoxY + drawBoxHeight);
    
    // top border of player color
    playerStatusCtx.moveTo(0, drawBoxY);
    playerStatusCtx.lineTo(drawBoxWidth, drawBoxY);

    // bottom border of player color
    playerStatusCtx.moveTo(0, drawBoxY + drawBoxHeight);
    playerStatusCtx.lineTo(drawBoxWidth, drawBoxY + drawBoxHeight);

    playerStatusCtx.stroke();
    playerStatusCtx.lineWidth = 1;

    Drawing.drawImageCircle(
      playerStatusCtx, 
      this.icon, 
      drawIconX,
      drawIconY,
      iconSize
    );

    const boxTextOffset = 5;
    const drawTextX = drawIconX + halfIconSize + xPadding;
    const drawTextY = drawIconY + (halfIconSize / 2);

    const statusXOffset = 80;

    const oldFont = playerStatusCtx.font;
    const oldStyle = playerStatusCtx.strokeStyle;
    const oldFill = playerStatusCtx.fillStyle;

    // player name
    playerStatusCtx.font = `16px Arial`;
    playerStatusCtx.strokeText(this.displayName, drawTextX, drawTextY);

    // which tier
    playerStatusCtx.strokeStyle = TierColors[this.tier];
    playerStatusCtx.font = `12px Arial`;
    playerStatusCtx.strokeText(`Tier ${this.tier}`, drawTextX - statusXOffset, drawTextY - 4);

    // box around tier
    playerStatusCtx.strokeRect(drawTextX - statusXOffset - 2, drawTextY - 16, 34, 18);

    playerStatusCtx.font = oldFont;
    playerStatusCtx.strokeStyle = oldStyle;
    playerStatusCtx.fillStyle = oldFill;

    if (this.tab === StatusTabs.heroes) {
      this.renderHeroBox(
        playerStatusCtx, 
        gameTime,
        (drawIconX - halfIconSize), 
        (drawIconY + halfIconSize + boxTextOffset)
      );
    } else if (this.tab === StatusTabs.units) {
      this.renderUnitsBox(
        playerStatusCtx, 
        gameTime,
        (drawIconX - halfIconSize), 
        (drawIconY + halfIconSize + boxTextOffset)
      );
    } else {
      playerStatusCtx.fillStyle = "#FFF";
      playerStatusCtx.fillText("Coming Soon", drawIconX, drawIconY + 40);
      playerStatusCtx.fillStyle = "#000";
    }
  }

  renderUnitsBox (playerStatusCtx, gameTime, offsetX, offsetY) {
    if (!this.currentGroup) {
      return;
    } 

    const iconSize = 32;
    const maxRow = 6;

    let c = 0, row = 0;

    const xPadding = 4;
    const yPadding = 6;

    this.currentGroup.forEach(unit => {
      const drawX = xPadding + offsetX + (c * iconSize);
      const drawY = yPadding + offsetY + (row * iconSize);

      playerStatusCtx.drawImage(unit.icon, drawX, drawY, iconSize, iconSize);
      c++;

      if (c === maxRow) {
        c = 0;
        row++;
      }
    });
  }

  renderHeroBox (playerStatusCtx, gameTime, offsetX, offsetY) {

    offsetY += 7.5;
    offsetX += 5;

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
        ////
        // draw the main hero icon and box outline
        ////

        playerStatusCtx.globalAlpha = (hero.spawnTime <= gameTime) ? 1.0 : 0.35;
        playerStatusCtx.strokeRect(boxX, offsetY, subBoxWidth, boxHeight + skillBoxHeight);
        playerStatusCtx.drawImage(hero.icon, boxX, offsetY, subBoxWidth, (boxHeight - skillBoxHeight));

        // draw team color square


        const heroLevelRecord = hero.getHeroLevelRecord();
        const heroLevel = heroLevelRecord ? heroLevelRecord.newLevel : 1;

        ////
        // draw hero level box
        ////

        Drawing.drawBoxedLevel(playerStatusCtx, heroLevel, boxX, offsetY, subBoxWidth, (boxHeight - skillBoxHeight));

        ////
        // draw hero spell boxes
        ////

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

          if (heroLevelRecord) {
            const skillRecord = heroLevelRecord.learnedSkills[spellId];
            
            if (!skillRecord) {
              // unlearned skill, no level box to draw
              return;
            }  

            // draw skill level box
            Drawing.drawBoxedLevel(
              playerStatusCtx, 
              skillRecord.level,
              spellX + spellRowOffsetX + 1,
              skillBoxOffset + spellRowOffsetY + 1,
              skillSubBoxWidth,
              skillBoxHeight
            );
          }
          
        });

        playerStatusCtx.globalAlpha = 1.0;
      }
    }
  }

  renderDrawnUnits (frameData, ctx) {
    const { isNeutralPlayer } = this;
    const { nameplateTree, unitTree, unitDrawPositions } = frameData;

    const drawBoxes = unitDrawPositions.reduce((acc, item) => {
      const { 
        x, 
        y,
        icon,
        iconSize, 
        halfIconSize, 
        fontSize, 
        heroRank,
        isHero,
        isMainHero,
        fullName, 
        decayLevel, 
        itemId,
        playerId,
        count,
        drawSlots
      } = item;

      // don't draw decayed unit nameplates
      if (decayLevel < 0.65) {
        return acc;
      }

      const unitBox = {
        minX:     x - (iconSize / 2),
        maxX:     x + (iconSize / 2),
        minY:     y - (iconSize / 2),
        maxY:     y + (iconSize / 2),
        drawX:    x,
        drawY:    y,
        icon,
        iconSize,
        halfIconSize,
        heroRank,
        isHero,
        isMainHero,
        itemId,
        playerId,
        count,
        drawSlots,
        decayLevel
      };

      acc.push(unitBox);
      return acc;
    }, []);

    unitTree.load(drawBoxes);

    const treeItems = unitTree.all();
    treeItems.forEach((unitBox, ind) => {
      const { 
        drawX, 
        drawY, 
        minX, 
        minY, 
        maxX, 
        maxY,
        isHero,
        isMainHero,
        itemId,
        playerId,
        heroRank,
        drawSlots,
        decayLevel
      } = unitBox;

      if (isNeutralPlayer) {
        Drawing.drawUnit(ctx, unitBox);

        return;
      }

      const collisions = unitTree.search(unitBox);
      if (!isMainHero && collisions.length > 1) {
        const mainHero = collisions.find(collision => {
          return collision.isMainHero;
        });

        if (mainHero) {
          const drawSlot = Drawing.assignDrawSlot(mainHero, mainHero.drawSlots, itemId, isHero, heroRank);
          if (!drawSlot) {
            // some error or overlap
            return;
          }

          unitBox = { 
            ...unitBox, 
            ...Drawing.getUnitBounds(mainHero, drawSlot.xOffset, drawSlot.yOffset) 
          };
        } else {
          // did with collide with another hero?
          const otherHero = collisions.find(collision => {
            return collision.isHero;
          });

          if (!isHero && otherHero) {
            // don't draw because we're a unit who is colliding with a non-main hero
            // somewhere outside of the main pack
            return;
          }
        }
      }

      Drawing.drawUnit(ctx, unitBox);
    });
  }

  renderNameplates (frameData, ctx) {
    const { nameplateTree, unitDrawPositions } = frameData;
    
    const nameplateBoxes = unitDrawPositions.reduce((acc, item) => {
      const { x, y, iconSize, fontSize, isHero, fullName, decayLevel, count } = item;

      // don't draw decayed unit nameplates
      if (decayLevel < 0.65) {
        return acc;
      }

      ctx.font = `${Math.ceil(fontSize)}px Arial`;
      ctx.textAlign = 'center';

      const nameStr = count === 1 ? fullName : `${fullName} [${count}]`;
      const textMetrics = ctx.measureText(nameStr);

      const { actualBoundingBoxLeft, width } = textMetrics;
      const drawY = (y + iconSize);

      const nameBox = {
        minX:     (x - actualBoundingBoxLeft),
        maxX:     (x - actualBoundingBoxLeft) + width,
        minY:     y - (iconSize / 2),
        maxY:     drawY,
        drawX:    x,
        drawY:    drawY,
        nameStr:  nameStr,
        fontSize: fontSize,
        iconSize: iconSize,
        isHero:   isHero,
        count:    count
      };

      acc.push(nameBox);
      return acc;
    }, []);

    // bulk load our nameplate boxes
    nameplateTree.load(nameplateBoxes);

    ////
    // heroes are drawn first, 
    // check nameplate collisions last
    ////

    const treeItems = nameplateTree.all().reverse();

    treeItems.forEach(nameBox => {
      const { 
        drawX, 
        drawY, 
        minX, 
        minY, 
        maxX, 
        maxY, 
        nameStr,
        iconSize,
        fontSize 
      } = nameBox;

      const textPadding = 2;

      const searchBox = {
        minX,
        minY: drawY - fontSize,
        maxX,
        maxY
      };

      const collisions = nameplateTree.search(searchBox);
      if (collisions.length > 1) {
        return;
      }

      Drawing.drawCenteredText (
        ctx, drawX, drawY, nameStr, fontSize, this.playerColor);
    });
  }

  render (frameData, mainCtx, playerCtx, utilityCtx, playerStatusCtx, transform, gameTime, xScale, yScale, viewOptions) {
    ////
    // render player status 
    ////

    this.renderPlayerIcon(
      playerStatusCtx, transform, gameTime, xScale, yScale, viewOptions);

    ////
    // render main game
    ////

    // draw units / buildings
    this.units.forEach(unit => 
      unit.render(frameData, playerCtx, mainCtx, transform, gameTime, xScale, yScale, viewOptions));

    this.renderDrawnUnits(frameData, playerCtx);

    ////
    // render optional details
    ////

    if (viewOptions.displayText) {
      this.renderNameplates(frameData, playerCtx);
    }

    if (viewOptions.displayPath) {
      this.heroes.forEach(hero => 
        hero.renderPath(utilityCtx, transform, gameTime, xScale, yScale, viewOptions));
    }

    if (viewOptions.displayLeveLDots) {
      this.heroes.forEach(hero => 
        hero.renderLevelDots(utilityCtx, transform, gameTime, xScale, yScale, viewOptions));
    }
  }
}

window.ClientPlayer = ClientPlayer;
