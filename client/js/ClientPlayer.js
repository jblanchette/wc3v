
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

const RaceLabels = {
  'O': { label: 'ORC', accent: '#FF4444' },
  'H': { label: 'HU',  accent: '#4488FF' },
  'U': { label: 'UD',  accent: '#AA66FF' },
  'E': { label: 'NE',  accent: '#44DD88' }
};

const TeamColors = {

};

const ClientPlayer = class {
  constructor (slot, teamColor, playerId, startingPosition, units, displayName, race, selectionStream, tierStream, playerColor, isNeutralPlayer, eventStream) {
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
    this.eventStream = eventStream;

    this.assetsLoaded = false;
    this.tab = StatusTabs.heroes;

    this.tier = 1;

    this.recordIndexes = {
      selection: -1,
      tier: -1
    };

    this.currentGroup = null;
    this.formationCache = new Map(); // uuid → focusUuid, persists across frames
    this.lastFormationTime = 0;
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

    const yMargin = 100;
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
      const halfDrawY = (drawY / 2);

      playerStatusCtx.fillStyle = "#5F5F5F";
      playerStatusCtx.fillRect(0, 0, drawBoxWidth, halfDrawY);

      playerStatusCtx.fillStyle = "#5fa5cb";
      playerStatusCtx.fillRect(0, halfDrawY, drawBoxWidth, halfDrawY - 4);
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
    const { nameplateTree, unitDrawPositions } = frameData;

    const owningPlayerId = this.playerId;

    const drawBoxes = unitDrawPositions.reduce((acc, item) => {
      const {
        uuid,
        x,
        y,
        icon,
        iconSize,
        halfIconSize,
        fontSize,
        heroRank,
        spawnTime,
        isHero,
        isMainHero,
        fullName,
        decayLevel,
        itemId,
        playerId,
        count,
        drawSlots,
        isWorker,
        isNeutralPlayer
      } = item;

      if (decayLevel < 0.45 || playerId != owningPlayerId) {
        return acc;
      }

      const groupPad = halfIconSize * 0.4;
      const unitBox = {
        uuid,
        minX:     x - halfIconSize - groupPad,
        maxX:     x + halfIconSize + groupPad,
        minY:     y - halfIconSize - groupPad,
        maxY:     y + halfIconSize + groupPad,
        drawX:    x,
        drawY:    y,

        fullName,
        icon,
        iconSize,
        halfIconSize,
        uuid, 
        isHero,
        isMainHero,
        itemId,
        heroRank,
        spawnTime,
        isWorker,
        isNeutralPlayer,
        decayLevel
      };

      acc.push(unitBox);
      return acc;
    }, []);

    // sorted by units last, heroes first sorted by spawnTime desc
    const sortedDrawTree = drawBoxes.sort((a, b) => {
      if (a.isHero && b.isHero) {
        return a.spawnTime - b.spawnTime;
      }

      return b.isHero - a.isHero;
    });

    /*
      because we render the 'most visually important' units first, every unit
      that collides with a hero will be adjusted to offset of the 'focus' unit
    */

    const unitTree = new rbush();

    const drawSlots = [];
    const alwaysDrawSlots = [];
    const prevCache = this.formationCache;
    const nextCache = new Map();

    // reset cache on backward scrub
    if (frameData.gameTime !== undefined && frameData.gameTime < this.lastFormationTime - 500) {
      prevCache.clear();
    }

    const addDrawSlotParent = (unitBox) => {
      drawSlots.push({
        focusUnit: unitBox,
        unitList: [ unitBox.uuid ],
        spots: []
      });

      unitTree.insert(unitBox);
    };

    const findDrawSlotOrCreate = (unitBox, collisions) => {
      const drawSlot = drawSlots.find(slot => {
        const hasFocusCollision = collisions.find(collision => {
          return slot.unitList.includes(collision.uuid);
        });

        return hasFocusCollision;
      });

      if (drawSlot) {
        drawSlot.unitList.push(unitBox.uuid);
        drawSlot.spots.push(unitBox);

        unitTree.insert(unitBox);

        return;
      }

      // don't expect this to happen but here is a fallback... might bite us?
      addDrawSlotParent(unitBox);
    };

    // find slot by focus UUID (for hysteresis)
    const findSlotByFocus = (focusUuid) => {
      return drawSlots.find(slot => slot.focusUnit.uuid === focusUuid);
    };

    sortedDrawTree.forEach((unitBox, ind) => {
      const { isMainHero, isHero, isWorker } = unitBox;
      const collisions = unitTree.search(unitBox);

      if (isNeutralPlayer || isWorker) {
        alwaysDrawSlots.push(unitBox);

        return;
      }

      if (isMainHero) {
        addDrawSlotParent(unitBox);

        return;
      }

      if (!collisions.length) {
        // hysteresis: if this unit was in a formation last frame, try to stay
        const prevFocus = prevCache.get(unitBox.uuid);
        if (prevFocus) {
          const cachedSlot = findSlotByFocus(prevFocus);
          if (cachedSlot) {
            cachedSlot.unitList.push(unitBox.uuid);
            cachedSlot.spots.push(unitBox);
            unitTree.insert(unitBox);
            return;
          }
        }

        addDrawSlotParent(unitBox);

        return;
      }

      findDrawSlotOrCreate(unitBox, collisions);
    });

    // update formation cache for next frame
    drawSlots.forEach(slot => {
      const focusUuid = slot.focusUnit.uuid;
      slot.unitList.forEach(uuid => {
        if (uuid !== focusUuid) {
          nextCache.set(uuid, focusUuid);
        }
      });
    });
    this.formationCache = nextCache;
    if (frameData.gameTime !== undefined) {
      this.lastFormationTime = frameData.gameTime;
    }


    const spotOffset = [ -2, -1, 0, 1, 2 ];

    // draw our slots
    drawSlots.forEach(drawSlot => {
      const { spots, focusUnit } = drawSlot;

      Drawing.drawUnit(ctx, focusUnit);

      // separate hero spots from unit spots
      const heroSpots = [];
      const unitSpots = [];
      spots.forEach(s => (s.isHero ? heroSpots : unitSpots).push(s));

      // draw hero spots (side-by-side, no flip)
      let hasHeroSpot = false;
      heroSpots.forEach(spotUnit => {
        const drawSide = hasHeroSpot ? -1 : 1;
        spotUnit.drawX = focusUnit.drawX - (focusUnit.iconSize * drawSide);
        hasHeroSpot = true;

        const udpEntry = unitDrawPositions.find(u => u.uuid === spotUnit.uuid);
        if (udpEntry) { udpEntry.x = spotUnit.drawX; udpEntry.y = spotUnit.drawY; }

        Drawing.drawUnit(ctx, spotUnit);
      });

      if (!unitSpots.length) return;

      // compute default below positions
      const iconBufferSize = focusUnit.halfIconSize * 1.25;
      let spotCol = 0;
      let spotRow = 0;

      unitSpots.forEach(spotUnit => {
        spotUnit.drawY = focusUnit.drawY + (focusUnit.iconSize + (spotUnit.iconSize * spotCol));
        spotUnit.drawX = focusUnit.drawX + (iconBufferSize * spotOffset[spotRow]);
        spotRow++;
        if (spotRow > spotOffset.length) { spotRow = 0; spotCol++; }
      });

      // check if formation below overlaps any other-player unit icons
      const formMinX = Math.min(...unitSpots.map(s => s.drawX - s.halfIconSize));
      const formMaxX = Math.max(...unitSpots.map(s => s.drawX + s.halfIconSize));
      const formMinY = Math.min(...unitSpots.map(s => s.drawY - s.halfIconSize));
      const formMaxY = Math.max(...unitSpots.map(s => s.drawY + s.halfIconSize));

      const enemyOverlap = unitDrawPositions.some(u => {
        if (u.playerId == owningPlayerId || u.isNeutralPlayer) return false;
        const half = u.iconSize / 2;
        return u.x + half > formMinX && u.x - half < formMaxX &&
               u.y + half > formMinY && u.y - half < formMaxY;
      });

      // flip formation above hero if enemies below
      if (enemyOverlap) {
        spotCol = 0;
        spotRow = 0;
        unitSpots.forEach(spotUnit => {
          spotUnit.drawY = focusUnit.drawY - (focusUnit.iconSize + (spotUnit.iconSize * spotCol));
          spotUnit.drawX = focusUnit.drawX + (iconBufferSize * spotOffset[spotRow]);
          spotRow++;
          if (spotRow > spotOffset.length) { spotRow = 0; spotCol++; }
        });
      }

      // draw and sync positions
      unitSpots.forEach(spotUnit => {
        const udpEntry = unitDrawPositions.find(u => u.uuid === spotUnit.uuid);
        if (udpEntry) { udpEntry.x = spotUnit.drawX; udpEntry.y = spotUnit.drawY; }
        Drawing.drawUnit(ctx, spotUnit);
      });
    });

    // always draw any unit in this list (neutrals fade when player units overlap)
    alwaysDrawSlots.forEach(unitBox => {
      if (unitBox.isNeutralPlayer) {
        const halfIcon = unitBox.iconSize / 2;
        const overlapped = unitDrawPositions.some(u =>
          !u.isNeutralPlayer &&
          Math.abs(u.x - unitBox.drawX) < halfIcon + u.iconSize / 2 &&
          Math.abs(u.y - unitBox.drawY) < halfIcon + u.iconSize / 2
        );
        if (overlapped) {
          const saved = unitBox.decayLevel;
          unitBox.decayLevel = 0.12;
          Drawing.drawUnit(ctx, unitBox);
          unitBox.decayLevel = saved;
          return;
        }
      }
      Drawing.drawUnit(ctx, unitBox);
    });
  }

  static buildNameplateBoxes (frameData, ctx) {
    const { unitDrawPositions } = frameData;

    return unitDrawPositions.reduce((acc, item) => {
      const { x, y, iconSize, fontSize, isHero, heroRank, fullName, decayLevel, count, isNeutralPlayer } = item;

      // skip neutral unit nameplates when player units overlap them
      if (isNeutralPlayer) {
        const overlapped = unitDrawPositions.some(u =>
          !u.isNeutralPlayer &&
          Math.abs(u.x - x) < iconSize / 2 + u.iconSize / 2 &&
          Math.abs(u.y - y) < iconSize / 2 + u.iconSize / 2
        );
        if (overlapped) return acc;
      }

      if (decayLevel < 0.65) {
        return acc;
      }

      ctx.font = `bold ${Math.ceil(fontSize)}px Arial`;
      ctx.textAlign = 'center';

      const nameStr = count === 1 ? fullName : `${fullName} [${count}]`;
      const textWidth = ctx.measureText(nameStr).width;
      const halfWidth = textWidth / 2;
      const drawY = y - iconSize;

      const priority = isHero ? (100 - (heroRank || 0)) : 0;

      acc.push({
        minX:     x - halfWidth,
        maxX:     x + halfWidth,
        minY:     drawY - fontSize,
        maxY:     drawY,
        drawX:    x,
        drawY:    drawY,
        baseY:    y,
        nameStr:  nameStr,
        fontSize: fontSize,
        iconSize: iconSize,
        isHero:   isHero,
        priority: priority,
        count:    count
      });

      return acc;
    }, []);
  }

  static renderAllNameplates (frameData, ctx) {
    const { nameplateTree, unitDrawPositions } = frameData;

    // insert unit icon bounds as obstacles so nameplates avoid other units' icons
    const obstacles = unitDrawPositions.map(item => {
      const halfIcon = item.iconSize / 2;
      return {
        minX: item.x - halfIcon,
        maxX: item.x + halfIcon,
        minY: item.y - halfIcon,
        maxY: item.y + halfIcon,
        isObstacle: true,
        ownerX: item.x,
        ownerY: item.y
      };
    });

    const allBoxes = frameData.allNameplateBoxes || [];
    allBoxes.sort((a, b) => b.priority - a.priority);

    nameplateTree.load(obstacles);

    // helper: check for real collisions (ignoring this unit's own icon obstacle)
    const hasRealCollision = (box, ownerX, ownerY) => {
      const hits = nameplateTree.search(box);
      return hits.some(h => !(h.isObstacle && h.ownerX === ownerX && h.ownerY === ownerY));
    };

    allBoxes.forEach(nameBox => {
      const { drawX, baseY, nameStr, iconSize, fontSize, isHero } = nameBox;
      let { minX, maxX, minY, maxY, drawY } = nameBox;

      const collisionAbove = hasRealCollision({ minX, minY, maxX, maxY }, drawX, baseY);

      let bgAlpha = isHero ? 0.7 : 0.5;
      let textAlpha = 1;

      if (collisionAbove) {
        // try below the unit instead
        const belowY = baseY + iconSize / 2 + fontSize + 4;
        const belowBox = { minX, maxX, minY: belowY - fontSize, maxY: belowY };
        const collisionBelow = hasRealCollision(belowBox, drawX, baseY);

        if (!collisionBelow) {
          drawY = belowY;
          minY = belowY - fontSize;
          maxY = belowY;
        } else if (isHero) {
          bgAlpha = 0.3;
          textAlpha = 0.4;
        } else {
          return; // non-hero, both blocked — skip
        }
      }

      // register this nameplate in the tree so later ones see it
      const placedBox = { minX, minY, maxY, maxX };
      nameplateTree.insert(placedBox);

      // draw rounded background
      const padX = 4;
      const padY = 2;
      const textW = maxX - minX;
      const textH = fontSize;
      const bgX = drawX - (textW / 2) - padX;
      const bgY = drawY - textH - padY;
      const bgW = textW + padX * 2;
      const bgH = textH + padY * 2;
      const radius = 3;

      ctx.globalAlpha = bgAlpha;
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.moveTo(bgX + radius, bgY);
      ctx.lineTo(bgX + bgW - radius, bgY);
      ctx.quadraticCurveTo(bgX + bgW, bgY, bgX + bgW, bgY + radius);
      ctx.lineTo(bgX + bgW, bgY + bgH - radius);
      ctx.quadraticCurveTo(bgX + bgW, bgY + bgH, bgX + bgW - radius, bgY + bgH);
      ctx.lineTo(bgX + radius, bgY + bgH);
      ctx.quadraticCurveTo(bgX, bgY + bgH, bgX, bgY + bgH - radius);
      ctx.lineTo(bgX, bgY + radius);
      ctx.quadraticCurveTo(bgX, bgY, bgX + radius, bgY);
      ctx.closePath();
      ctx.fill();

      // text
      ctx.globalAlpha = textAlpha;
      ctx.textAlign = 'center';
      ctx.font = `bold ${Math.ceil(fontSize)}px Arial`;
      ctx.fillStyle = '#FFF';
      ctx.fillText(nameStr, drawX, drawY);
      ctx.textAlign = 'left';
    });

    ctx.globalAlpha = 1;
  }

  preRender (frameData, mainCtx, playerCtx, utilityCtx, playerStatusCtx, transform, gameTime, xScale, yScale, viewOptions) {
    // draw units / buildings
    this.units.forEach(unit => 
      unit.preRender(frameData, playerCtx, mainCtx, transform, gameTime, xScale, yScale, viewOptions));
  }

  render (frameData, mainCtx, playerCtx, utilityCtx, playerStatusCtx, transform, gameTime, xScale, yScale, viewOptions) {
    ////
    // render player status 
    ////

    this.renderPlayerIcon(
      playerStatusCtx, transform, gameTime, xScale, yScale, viewOptions);

    ////
    // render drawn units
    ////

    this.renderDrawnUnits(frameData, playerCtx);

    ////
    // render optional details
    ////

    // nameplates rendered globally in app.js after all players

    if (viewOptions.displayPath) {
      this.heroes.forEach(hero => 
        hero.renderPath(utilityCtx, transform, gameTime, xScale, yScale, viewOptions));
    }

    if (viewOptions.displayLevelPins) {
      this.heroes.forEach(hero =>
        hero.renderLevelPins(utilityCtx, transform, gameTime, xScale, yScale, viewOptions, frameData));
    }
  }
}

window.ClientPlayer = ClientPlayer;
