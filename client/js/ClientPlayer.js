
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
  constructor (slot, teamColor, playerId, startingPosition, units, displayName, race, selectionStream, tierStream, playerColor, isNeutralPlayer, eventStream, itemStream, apmData) {
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
    this.itemStream = itemStream || null;
    this.apmData = apmData || null;

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

    // Build loaded-windows for transport passengers
    this._buildTransportWindows();

    // Bump each unit's lifetime activity from the selection stream. Selection
    // is a strong "still alive" signal: a player can't select a dead unit.
    // This compensates for units whose `path` records go silent while the
    // unit is still active (e.g. heroes hold-positioning, units being kept
    // in a control group). Over-attributing alive across instances of the
    // same itemIdHash is the safer error mode for the fade fix.
    this._stampActivityFromSelectionStream();
  }

  _stampActivityFromSelectionStream () {
    const stream = this.selectionStream;
    if (!stream || !stream.length) return;
    for (let i = 0; i < stream.length; i++) {
      const entry = stream[i];
      const t = entry && entry.gameTime;
      const sel = entry && entry.selection;
      if (typeof t !== 'number' || !sel || !sel.units) continue;
      for (let j = 0; j < sel.units.length; j++) {
        const u = sel.units[j];
        if (!u || !u.itemId1 || !u.itemId2) continue;
        const hash = Helpers.makeItemIdHash(u.itemId1, u.itemId2);
        const unit = this.unitsByItemId[hash];
        if (unit && typeof unit.recordActivity === 'function') {
          unit.recordActivity(t);
        }
      }
    }
  }

  _buildTransportWindows () {
    const transports = this.units.filter(u => u.isTransport && u.loadEvents && u.loadEvents.length);
    if (!transports.length) return;

    const unitsByUuid = {};
    this.units.forEach(u => { if (u.uuid) unitsByUuid[u.uuid] = u; });

    transports.forEach(transport => {
      const openLoads = {};
      transport.loadEvents.forEach(evt => {
        if (evt.action === 'load') {
          openLoads[evt.unitId] = evt.gameTime;
        } else if (evt.action === 'unload') {
          const loadTime = openLoads[evt.unitId];
          if (loadTime !== undefined) {
            const passenger = unitsByUuid[evt.unitId];
            if (passenger) {
              passenger._loadedWindows.push({
                loadTime,
                unloadTime: evt.gameTime,
                transportId: transport.uuid
              });
            }
            delete openLoads[evt.unitId];
          }
        }
      });
      // Any still-open loads (unit never unloaded) — extend to end of replay
      Object.entries(openLoads).forEach(([unitId, loadTime]) => {
        const passenger = unitsByUuid[unitId];
        if (passenger) {
          passenger._loadedWindows.push({
            loadTime,
            unloadTime: Infinity,
            transportId: transport.uuid
          });
        }
      });
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
      this.recordIndexes.selection = index;
      this.enrichSelectionGroup();
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
      acc.push(...unit.loaders);

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
    heroes.forEach((hero, ind) => {
      hero.heroRank = ind + 1;
      // True-size rendering: all heroes use their WC3 collision size.
      // Secondary heroes used to be ~4px smaller for visual distinction —
      // dropped because it doesn't fit the 1:1 sizing doctrine. Reintroduce
      // as a heroRank-driven render-time scale if user wants it back.
    });

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
      img.onerror = () => {
        console.log("img error: ", imgSrc);
        return resolve(false);
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
    // findIndexFrom (Helpers.js) is forward-only — it scans from the cursor
    // and never rewinds. On a backward jump the cursor is past the target
    // gameTime, so without resetting we'd retain end-of-match selection/tier.
    this.recordIndexes.selection = -1;
    this.recordIndexes.tier = -1;
    this.currentGroup = null;
    this.tier = 1;

    this.units.forEach(unit => {
      // reset a units record indexes, decay status, full name
      unit.jump(gameTime);

      // update the unit at the new gameTime to prepare for rendering
      unit.update(gameTime, 1);
    });

    const tierEvent = this.getCurrentTier(gameTime);
    if (tierEvent) {
      this.tier = Math.min(3, tierEvent.tier);
    }

    this.getSelectionRecord(gameTime);
  }

  renderPlayerIcon (playerStatusCtx, transform, gameTime, xScale, yScale, viewOptions) {
    // app.js drives this into a throttled offscreen buffer and passes null
    // through the per-frame player.render() path so the panel isn't redrawn
    // (and can't force a reflow) on every animation frame.
    if (!playerStatusCtx) {
      return;
    }

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

    // player name — show the official pro name (PlayerNames.js)
    playerStatusCtx.font = `16px Arial`;
    playerStatusCtx.strokeText(PlayerNames.canonical(this.displayName), drawTextX, drawTextY);

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

      if (unit.icon) {
        playerStatusCtx.drawImage(unit.icon, drawX, drawY, iconSize, iconSize);
      }
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
        if (hero.icon) {
          playerStatusCtx.drawImage(hero.icon, boxX, offsetY, subBoxWidth, (boxHeight - skillBoxHeight));
        }

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

          const spellIcon = hero[`spell-${spellSlot}`];
          if (spellIcon) {
            playerStatusCtx.drawImage(
              spellIcon,
              spellX + spellRowOffsetX,
              skillBoxOffset + spellRowOffsetY,
              skillSubBoxWidth,
              skillBoxHeight
            );
          }

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

  resolveUnitPositions (frameData, forceMode, skipBloom = false) {
    const { isNeutralPlayer } = this;
    const { unitDrawPositions } = frameData;

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
        playerColor,
        count,
        drawSlots,
        isWorker,
        isNeutralPlayer,
        isTransport,
        cargoCount,
        cargoItems,
        scoutLabel
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
        playerId,
        playerColor,
        heroRank,
        spawnTime,
        isWorker,
        isNeutralPlayer,
        decayLevel,
        isTransport: isTransport || false,
        cargoCount: cargoCount || 0,
        cargoItems: cargoItems || null,
        scoutLabel: scoutLabel || null,
        isHidden: item.isHidden || false
      };

      acc.push(unitBox);
      return acc;
    }, []);

    // non-heroes first (drawn behind), heroes last (drawn on top), main hero topmost
    const sortedDrawTree = drawBoxes.sort((a, b) => {
      if (a.isHero !== b.isHero) return a.isHero - b.isHero;
      if (a.isHero && b.isHero) {
        if (a.isMainHero) return 1;
        if (b.isMainHero) return -1;
        return a.spawnTime - b.spawnTime;
      }
      return (a.uuid < b.uuid) ? -1 : 1;
    });

    // separate workers and neutrals — they always draw at true position
    const armyUnits = [];
    const alwaysDrawSlots = [];

    sortedDrawTree.forEach(unitBox => {
      if (isNeutralPlayer || unitBox.isWorker) {
        alwaysDrawSlots.push(unitBox);
      } else {
        armyUnits.push(unitBox);
      }
    });

    //
    // RAW POSITION MODE. The parser output is authoritative and correct
    // (smoothed A* paths, walk-clock timing, command coalescing — all
    // ground-truth verified), so the client renders units at their TRUE
    // projected positions. The legacy client repositioning stack
    // (clusterArmyUnits / bloomResolve / formationLayout / cross-collision /
    // offset-smoothing / displacement caps) is intentionally disabled — it
    // was the source of the visible "spring/reposition" jitter. Every army
    // unit is its own representative drawn exactly where the parser puts it.
    //
    const representatives = armyUnits;
    const collapsed = [];
    representatives.forEach(u => {
      u.clusterCount = 1;
      u._origX = u.drawX;
      u._origY = u.drawY;
    });
    this._resolved = { representatives, collapsed, alwaysDrawSlots };
  }

  drawResolvedUnits (frameData, ctx) {
    if (!this._resolved) return;

    const { unitDrawPositions } = frameData;
    const { representatives, collapsed, alwaysDrawSlots } = this._resolved;

    // draw formation tethers — dashed lines from displaced non-hero units to nearest hero
    const heroReps = representatives.filter(r => r.isHero);
    if (heroReps.length > 0 && representatives.length > 1) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.35;

      representatives.forEach(unitBox => {
        if (unitBox.isHero) return;
        if (!unitBox._origX) return;

        const bloomDx = unitBox.drawX - unitBox._origX;
        const bloomDy = unitBox.drawY - unitBox._origY;
        if (bloomDx * bloomDx + bloomDy * bloomDy < 25) return; // < 5px displacement

        let nearestHero = heroReps[0];
        let nearestDist = Infinity;
        heroReps.forEach(h => {
          const dx = h.drawX - unitBox.drawX;
          const dy = h.drawY - unitBox.drawY;
          const d = dx * dx + dy * dy;
          if (d < nearestDist) { nearestDist = d; nearestHero = h; }
        });

        ctx.strokeStyle = unitBox.playerColor;
        ctx.beginPath();
        ctx.moveTo(nearestHero.drawX, nearestHero.drawY);
        ctx.lineTo(unitBox.drawX, unitBox.drawY);
        ctx.stroke();
      });

      ctx.restore();
    }

    // draw representatives and count badges
    representatives.forEach(unitBox => {
      Drawing.drawUnit(ctx, unitBox);

      if (unitBox.clusterCount > 1) {
        const badgeX = unitBox.drawX + unitBox.halfIconSize;
        const badgeY = unitBox.drawY + unitBox.halfIconSize;
        Drawing.drawCountBadge(ctx, unitBox.clusterCount, badgeX, badgeY, unitBox.playerColor);
      }

      const udpEntry = unitDrawPositions.find(u => u.uuid === unitBox.uuid);
      if (udpEntry) {
        udpEntry.x = unitBox.drawX;
        udpEntry.y = unitBox.drawY;
        udpEntry.count = unitBox.clusterCount || 1;
      }
    });

    // hide collapsed units from nameplates
    collapsed.forEach(unitBox => {
      const udpEntry = unitDrawPositions.find(u => u.uuid === unitBox.uuid);
      if (udpEntry) {
        udpEntry.hideNameplate = true;
      }
    });

    // consolidate neutral creep nameplates by itemId + proximity
    const neutralSlots = alwaysDrawSlots.filter(u => u.isNeutralPlayer);
    const neutralGroups = [];
    const neutralAssigned = new Set();

    neutralSlots.forEach(unit => {
      if (neutralAssigned.has(unit.uuid)) return;
      const group = [unit];
      neutralAssigned.add(unit.uuid);

      neutralSlots.forEach(other => {
        if (neutralAssigned.has(other.uuid)) return;
        if (other.itemId !== unit.itemId) return;
        const dist = Math.abs(other.drawX - unit.drawX) + Math.abs(other.drawY - unit.drawY);
        if (dist < unit.iconSize * 4) {
          group.push(other);
          neutralAssigned.add(other.uuid);
        }
      });

      if (group.length > 1) neutralGroups.push(group);
    });

    neutralGroups.forEach(group => {
      const avgX = group.reduce((sum, u) => sum + u.drawX, 0) / group.length;
      const avgY = group.reduce((sum, u) => sum + u.drawY, 0) / group.length;
      const repUdp = unitDrawPositions.find(u => u.uuid === group[0].uuid);
      if (repUdp) {
        repUdp.count = group.length;
        repUdp.x = avgX;
        repUdp.y = avgY;
      }
      for (let i = 1; i < group.length; i++) {
        const udp = unitDrawPositions.find(u => u.uuid === group[i].uuid);
        if (udp) udp.hideNameplate = true;
      }
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

      // scout label badge below the unit icon
      if (unitBox.scoutLabel) {
        const lx = unitBox.drawX;
        const ly = unitBox.drawY + unitBox.halfIconSize + 16;
        ctx.globalAlpha = Math.max(unitBox.decayLevel, 0.5);
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const tw = ctx.measureText(unitBox.scoutLabel).width + 10;
        const th = 18;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(lx - tw / 2, ly - th / 2, tw, th);

        ctx.fillStyle = '#44DDBB';
        ctx.fillText(unitBox.scoutLabel, lx, ly);
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
      }
    });
  }

  // Draw and drain all queued death FX entries into the given context. Called
  // once per frame from app.js after every player has rendered, so FX from
  // all players are flushed in a single pass on top of unit icons.
  static drawDeathFxQueue (frameData, ctx) {
    if (!frameData) return;
    if (frameData.deathFx && frameData.deathFx.length) {
      for (let i = 0; i < frameData.deathFx.length; i++) {
        Drawing.drawDeathFx(ctx, frameData.deathFx[i]);
      }
      frameData.deathFx.length = 0;
    }
    // Idle markers: small player-coloured dot above units in 'idle' state.
    if (frameData.idleMarkers && frameData.idleMarkers.length) {
      for (let i = 0; i < frameData.idleMarkers.length; i++) {
        const m = frameData.idleMarkers[i];
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = m.playerColor || '#999';
        ctx.beginPath();
        ctx.arc(m.x, m.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      frameData.idleMarkers.length = 0;
    }
  }

  static isValidBox (box) {
    return Number.isFinite(box.minX) && Number.isFinite(box.maxX) &&
           Number.isFinite(box.minY) && Number.isFinite(box.maxY);
  }

  static buildNameplateBoxes (frameData, ctx) {
    const { unitDrawPositions } = frameData;

    return unitDrawPositions.reduce((acc, item) => {
      const { x, y, iconSize, fontSize, isHero, heroRank, fullName, decayLevel, count, isNeutralPlayer, playerColor } = item;

      if (item.hideNameplate) {
        return acc;
      }

      // hide all neutral/creep nameplates
      if (isNeutralPlayer) {
        return acc;
      }

      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(iconSize)) {
        return acc;
      }

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
        count:    count,
        playerColor: playerColor
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

    const validObstacles = obstacles.filter(o => ClientPlayer.isValidBox(o));
    nameplateTree.load(validObstacles);

    // helper: check for real collisions (ignoring this unit's own icon obstacle)
    const hasRealCollision = (box, ownerX, ownerY) => {
      const hits = nameplateTree.search(box);
      return hits.some(h => !(h.isObstacle && h.ownerX === ownerX && h.ownerY === ownerY));
    };

    allBoxes.forEach(nameBox => {
      const { drawX, baseY, nameStr, iconSize, fontSize, isHero, playerColor } = nameBox;
      let { minX, maxX, minY, maxY, drawY } = nameBox;

      const collisionAbove = hasRealCollision({ minX, minY, maxX, maxY }, drawX, baseY);

      // Slightly more opaque background than before so the player-color
      // stripe along the bottom has a stable dark band to sit on.
      let bgAlpha = isHero ? 0.85 : 0.75;
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
        } else {
          return; // both blocked — hide entirely
        }
      }

      // register this nameplate in the tree so later ones see it
      const placedBox = { minX, minY, maxX, maxY };
      if (!ClientPlayer.isValidBox(placedBox)) return;
      nameplateTree.insert(placedBox);

      // draw rounded background
      const padX = 7;
      const padY = 3;
      const textW = maxX - minX;
      const textH = fontSize;
      const bgX = drawX - (textW / 2) - padX;
      const bgY = drawY - textH - padY;
      const bgW = textW + padX * 2;
      const bgH = textH + padY * 2;
      const radius = 5;

      const traceRoundedRect = () => {
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
      };

      // Dark base fill.
      ctx.globalAlpha = bgAlpha;
      ctx.fillStyle = '#0d0d10';
      traceRoundedRect();
      ctx.fill();

      // Faint full-area playerColor tint diffused into the dark background —
      // the color is everywhere, not on a single edge. Mirrors WC3 selection-
      // circle / faction-tint idiom on the entire plate.
      if (playerColor) {
        ctx.globalAlpha = 0.20 * bgAlpha;
        ctx.fillStyle = playerColor;
        traceRoundedRect();
        ctx.fill();

        // Full-perimeter playerColor outline. Symmetric, so it doesn't read
        // as a single-edge accent — the color goes all the way around at
        // equal weight. 1.5px is enough to scan from a glance without
        // overwhelming the text.
        ctx.globalAlpha = 0.95;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = playerColor;
        traceRoundedRect();
        ctx.stroke();
      }

      // text
      ctx.globalAlpha = textAlpha;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.font = `bold ${Math.ceil(fontSize)}px Arial`;
      ctx.fillStyle = '#FFF';
      ctx.fillText(nameStr, drawX, drawY);
      ctx.textAlign = 'left';
    });

    ctx.globalAlpha = 1;
  }

  preRender (frameData, mainCtx, playerCtx, utilityCtx, playerStatusCtx, transform, gameTime, xScale, yScale, viewOptions) {
    // draw units and buildings on playerCtx (z=3, above trees)
    this.units.forEach(unit =>
      unit.preRender(frameData, playerCtx, playerCtx, transform, gameTime, xScale, yScale, viewOptions));
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

    this.drawResolvedUnits(frameData, playerCtx);

    ////
    // render optional details
    ////

    // nameplates rendered globally in app.js after all players

    // Hero path trails moved to the 3D scene; see PathTrailRenderer3D.

    if (viewOptions.displayLevelPins) {
      this.heroes.forEach(hero =>
        hero.renderLevelPins(utilityCtx, transform, gameTime, xScale, yScale, viewOptions, frameData));
    }
  }
}

window.ClientPlayer = ClientPlayer;
