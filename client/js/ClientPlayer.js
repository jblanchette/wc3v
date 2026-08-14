
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
    this.currentGroupT = null;   // gameTime the current selection was recorded at
    this.setupUnits(units);

    if (window.WC3V_CONFIG) window.WC3V_CONFIG.log('app', "setup player: ", this);
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

    // Advance the TIER cursor (was mistakenly writing to a non-existent
    // `.path` field, so the cursor never moved and every call re-scanned
    // tierStream from the start).
    this.recordIndexes.tier = index;

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

    // When this selection was made. The stream holds a record until the next
    // one, with no explicit clear, so consumers that draw a live selection cue
    // (UnitModelRenderer's hoops) need the age to stop showing the final
    // selection of the match forever.
    this.currentGroupT = item.gameTime;

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

  // `onTick` (optional) is called once per settled asset loader — the viewer's
  // LoadingScreen turns these into a live "Unit icons n / total" counter.
  setup (onTick) {
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
        if (window.WC3V_CONFIG) window.WC3V_CONFIG.log('app', "img error: ", imgSrc);
        return resolve(false);
      };
    });

    unitLoaders.push(iconPromise);

    if (onTick) {
      // Observe settles without altering the loaders the allSettled below
      // consumes; icon loaders resolve(false) on error, but tick both sides
      // anyway so a rejecting loader can't stall the counter.
      unitLoaders.forEach(p => Promise.resolve(p).then(() => onTick(), () => onTick()));
    }

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
    this.currentGroupT = null;
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

    // NOTE: unitDrawPositions holds EVERY player's units, and this runs once per
    // player — so the rejection test has to come before the destructure, not
    // after. Destructuring 24 fields for units we're about to drop cost P×N
    // field reads per frame (3 players × 150 units ≈ 10k reads) for nothing.
    const drawBoxes = [];
    for (let i = 0; i < unitDrawPositions.length; i++) {
      const item = unitDrawPositions[i];
      if (item.decayLevel < 0.45 || item.playerId != owningPlayerId) continue;  // eslint-disable-line eqeqeq

      const {
        uuid,
        x,
        y,
        icon,
        iconSize,
        halfIconSize,
        heroRank,
        spawnTime,
        isHero,
        isMainHero,
        fullName,
        decayLevel,
        itemId,
        playerId,
        playerColor,
        isWorker,
        isNeutralPlayer,
        isTransport,
        cargoCount,
        cargoItems,
        scoutLabel,
        isIllusion
      } = item;

      // Pooled draw box — a 30-key literal per unit per frame otherwise. The
      // pool is per-player and indexed by position in this frame's pass, so a
      // box is only ever live for one frame at a time.
      //
      // EVERY field must be written here, including the ones assigned later in
      // the pipeline (_origX/_origY/clusterCount, set only for cluster
      // representatives at the bloom step). A stale _origX surviving on a
      // recycled box would make the bloom-line test below think a
      // non-representative had been displaced, and draw a leader line from a
      // position two frames old.
      if (!this._boxPool) this._boxPool = [];
      const pool = this._boxPool;
      const slot = drawBoxes.length;
      let unitBox = pool[slot];
      if (!unitBox) unitBox = pool[slot] = {};

      const groupPad = halfIconSize * 0.4;
      unitBox.uuid = uuid;
      unitBox.minX = x - halfIconSize - groupPad;
      unitBox.maxX = x + halfIconSize + groupPad;
      unitBox.minY = y - halfIconSize - groupPad;
      unitBox.maxY = y + halfIconSize + groupPad;
      unitBox.drawX = x;
      unitBox.drawY = y;

      unitBox.fullName = fullName;
      unitBox.icon = icon;
      unitBox.iconSize = iconSize;
      unitBox.halfIconSize = halfIconSize;
      unitBox.isHero = isHero;
      unitBox.isMainHero = isMainHero;
      unitBox.isIllusion = isIllusion || false;
      unitBox.itemId = itemId;
      unitBox.playerId = playerId;
      unitBox.playerColor = playerColor;
      unitBox.heroRank = heroRank;
      unitBox.spawnTime = spawnTime;
      unitBox.isWorker = isWorker;
      unitBox.isNeutralPlayer = isNeutralPlayer;
      unitBox.decayLevel = decayLevel;
      unitBox.isTransport = isTransport || false;
      unitBox.cargoCount = cargoCount || 0;
      unitBox.cargoItems = cargoItems || null;
      unitBox.scoutLabel = scoutLabel || null;
      unitBox.isHidden = item.isHidden || false;

      // Reset the late-assigned cluster fields (see note above).
      unitBox.clusterCount = 1;
      unitBox._origX = 0;
      unitBox._origY = 0;

      drawBoxes.push(unitBox);
    }

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

  drawResolvedUnits (frameData, ctx, viewOptions) {
    if (!this._resolved) return;

    const { unitDrawPositions } = frameData;
    const { representatives, collapsed, alwaysDrawSlots } = this._resolved;

    // uuid -> entry index, built once per frame by Wc3vViewer.render(). Falls
    // back to a linear scan only if a caller drives us outside the render path.
    const udpByUuid = frameData.udpByUuid;
    const findUdp = udpByUuid
      ? (uuid) => udpByUuid.get(uuid)
      : (uuid) => unitDrawPositions.find(u => u.uuid === uuid);

    // Units shown as 3D models this frame skip their 2D icon (UnitModelRenderer
    // publishes the set on viewOptions._rendered3D). Hybrid: others stay 2D.
    const rendered3D = viewOptions && viewOptions._rendered3D;
    const skip3D = (u) => rendered3D && rendered3D.has(u.uuid);
    const all3D = viewOptions && viewOptions.display3DUnits;

    // draw formation tethers — dashed lines from displaced non-hero units to nearest hero
    const heroReps = representatives.filter(r => r.isHero);
    if (heroReps.length > 0 && representatives.length > 1 && !all3D) {
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
      if (!skip3D(unitBox)) Drawing.drawUnit(ctx, unitBox);

      if (!skip3D(unitBox) && unitBox.clusterCount > 1) {
        const badgeX = unitBox.drawX + unitBox.halfIconSize;
        const badgeY = unitBox.drawY + unitBox.halfIconSize;
        Drawing.drawCountBadge(ctx, unitBox.clusterCount, badgeX, badgeY, unitBox.playerColor);
      }

      const udpEntry = findUdp(unitBox.uuid);
      if (udpEntry) {
        udpEntry.x = unitBox.drawX;
        udpEntry.y = unitBox.drawY;
        udpEntry.count = unitBox.clusterCount || 1;
      }
    });

    // hide collapsed units from nameplates
    collapsed.forEach(unitBox => {
      const udpEntry = findUdp(unitBox.uuid);
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
      const repUdp = findUdp(group[0].uuid);
      if (repUdp) {
        repUdp.count = group.length;
        repUdp.x = avgX;
        repUdp.y = avgY;
      }
      for (let i = 1; i < group.length; i++) {
        const udp = findUdp(group[i].uuid);
        if (udp) udp.hideNameplate = true;
      }
    });

    // always draw any unit in this list (neutrals fade when player units overlap)
    alwaysDrawSlots.forEach(unitBox => {
      if (skip3D(unitBox)) return; // shown as a 3D model
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

  // 2D selection markers. Covers everything the 3D hoop pass did NOT draw:
  //
  //   - BUILDINGS, always. UnitModelRenderer.update skips isBuilding outright
  //     (they are instanced meshes owned by ThreeMapRenderer with no per-
  //     building ring descriptor), so this is the only selection cue a
  //     selected hall ever gets — and selecting a hall to queue workers is
  //     one of the most common things a WC3 player does.
  //   - Settings → 3D Units off.
  //   - The window right after a spawn while that unit's GLB is still parsing
  //     (instance === 'pending').
  //
  // Anything already ringed in 3D is skipped via viewOptions._rendered3D, so a
  // unit never gets two rings.
  //
  // Units read frameData.udpByUuid, which app.js already builds once per
  // frame. Buildings need a linear scan of buildingPositions (no uuid index
  // exists and one selected building doesn't justify building one) — guarded
  // so it only runs when a building is actually selected.
  static renderSelectionMarkers (frameData, ctx, players, gameScaler, viewOptions) {
    if (!frameData || !ctx || !players) return;
    if (viewOptions && viewOptions.displaySelectionRings === false) return;
    if (window.WC3V_CONFIG && window.WC3V_CONFIG.perf &&
        window.WC3V_CONFIG.perf.selectionRings === false) return;
    const udp = frameData.udpByUuid;
    if (!udp) return;
    const rendered3D = viewOptions && viewOptions._rendered3D;

    // Constant on-screen line weight regardless of map image size — the same
    // canvasMetrics().sx ratio BaseNameplateRenderer uses. Served from the
    // per-frame cache, so no layout read.
    let ratio = 1;
    if (gameScaler && gameScaler.canvasMetrics) {
      const m = gameScaler.canvasMetrics(ctx.canvas);
      if (m && m.ok) ratio = m.sx;
    }

    let saved = false;
    for (let p = 0; p < players.length; p++) {
      const player = players[p];
      if (!player || player.isNeutralPlayer) continue;
      const group = player.currentGroup;
      if (!group || !group.length) continue;

      for (let i = 0; i < group.length; i++) {
        const unit = group[i];
        if (!unit || unit._destroyed) continue;
        if (rendered3D && rendered3D.has(unit.uuid)) continue;

        let cx, cy, rx, ry, alpha = 0.95;
        if (unit.isBuilding) {
          const b = ClientPlayer._findBuildingBox(frameData, unit.uuid);
          if (!b) continue;
          cx = b.x; cy = b.y;
          // WC3 rings a building too; size it to the footprint so it reads as
          // "this structure", not "a unit standing here".
          rx = b.halfWidth * 1.18;
          ry = b.halfHeight * 1.18;
        } else {
          const box = udp.get(unit.uuid);
          if (!box || !Number.isFinite(box.iconSize)) continue;
          cx = box.x; cy = box.y;
          rx = ry = box.iconSize * 0.62;
          if (box.decayLevel != null) alpha *= box.decayLevel;
        }
        if (!Number.isFinite(cx) || !Number.isFinite(cy) ||
            !Number.isFinite(rx) || !Number.isFinite(ry)) continue;

        if (!saved) {
          ctx.save();
          ctx.lineWidth = Math.max(2, 2 * ratio);
          saved = true;
        }
        ctx.strokeStyle = player.playerColor || '#FFF';
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (saved) ctx.restore();
  }

  // Linear scan of this frame's building boxes. Only ever called for a
  // SELECTED building (0-2 per frame), against a list of a few dozen, so a
  // uuid index would cost more to maintain than this costs to run.
  static _findBuildingBox (frameData, uuid) {
    const list = frameData.buildingPositions;
    if (!list) return null;
    for (let i = 0; i < list.length; i++) {
      if (list[i].uuid === uuid) return list[i];
    }
    return null;
  }

  static isValidBox (box) {
    return Number.isFinite(box.minX) && Number.isFinite(box.maxX) &&
           Number.isFinite(box.minY) && Number.isFinite(box.maxY);
  }

  // Canvas font shorthand for an integer size, memoized. The template string
  // was being rebuilt for every unit on every frame, in two places.
  static _nameplateFont (size) {
    let cache = ClientPlayer._fontCache;
    if (!cache) cache = ClientPlayer._fontCache = new Map();
    let s = cache.get(size);
    if (s === undefined) {
      s = `bold ${size}px Arial`;
      cache.set(size, s);
    }
    return s;
  }

  // measureText is one of the more expensive 2D calls and it also allocates a
  // TextMetrics object — it was running once per named unit per frame for
  // strings that almost never change. Width depends only on (font size, text).
  static _measureNameWidth (ctx, size, str) {
    let cache = ClientPlayer._textWidthCache;
    if (!cache) cache = ClientPlayer._textWidthCache = new Map();
    const key = size + '|' + str;
    let w = cache.get(key);
    if (w === undefined) {
      // Unit names are a bounded set, but cluster counts ("Ghoul [12]") and
      // zoom-driven font sizes can widen it — cap and evict wholesale.
      if (cache.size > 2000) cache.clear();
      w = ctx.measureText(str).width;
      cache.set(key, w);
    }
    return w;
  }

  static buildNameplateBoxes (frameData, ctx) {
    const { unitDrawPositions } = frameData;

    // Pooled result records — a 13-key literal per named unit per frame.
    // Consumed within the frame by renderAllNameplates (sorted, then drawn)
    // and never retained past it.
    if (!frameData._namePool) frameData._namePool = [];
    const namePool = frameData._namePool;

    // Reuse the result array too — the caller overwrites
    // frameData.allNameplateBoxes with whatever comes back, so the previous
    // frame's array is garbage the moment this returns.
    if (!frameData._nameBoxes) frameData._nameBoxes = [];
    frameData._nameBoxes.length = 0;

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

      const fontPx = Math.ceil(fontSize);
      ctx.font = ClientPlayer._nameplateFont(fontPx);
      ctx.textAlign = 'center';

      const nameStr = count === 1 ? fullName : `${fullName} [${count}]`;
      const textWidth = ClientPlayer._measureNameWidth(ctx, fontPx, nameStr);
      const halfWidth = textWidth / 2;
      const drawY = y - iconSize;

      const priority = isHero ? (100 - (heroRank || 0)) : 0;

      let nb = namePool[acc.length];
      if (!nb) nb = namePool[acc.length] = {};
      nb.minX = x - halfWidth;
      nb.maxX = x + halfWidth;
      nb.minY = drawY - fontSize;
      nb.maxY = drawY;
      nb.drawX = x;
      nb.drawY = drawY;
      nb.baseY = y;
      nb.nameStr = nameStr;
      nb.fontSize = fontSize;
      nb.iconSize = iconSize;
      nb.isHero = isHero;
      nb.priority = priority;
      nb.count = count;
      nb.playerColor = playerColor;
      acc.push(nb);

      return acc;
    }, frameData._nameBoxes);
  }

  static renderAllNameplates (frameData, ctx) {
    const { nameplateTree, unitDrawPositions } = frameData;

    // Insert unit icon bounds as obstacles so nameplates avoid other units'
    // icons. Pooled on frameData (already the per-frame reuse container): the
    // old map+filter pair allocated one object AND two arrays per frame,
    // scaling with unit count. The tree is cleared every frame in app.js, so
    // recycling the entries it indexed last frame is safe.
    if (!frameData._obstaclePool) frameData._obstaclePool = [];
    if (!frameData._validObstacles) frameData._validObstacles = [];
    const pool = frameData._obstaclePool;
    const validObstacles = frameData._validObstacles;
    validObstacles.length = 0;

    for (let i = 0; i < unitDrawPositions.length; i++) {
      const item = unitDrawPositions[i];
      const halfIcon = item.iconSize / 2;
      let o = pool[i];
      if (!o) o = pool[i] = { minX: 0, maxX: 0, minY: 0, maxY: 0, isObstacle: true, ownerX: 0, ownerY: 0 };
      o.minX = item.x - halfIcon;
      o.maxX = item.x + halfIcon;
      o.minY = item.y - halfIcon;
      o.maxY = item.y + halfIcon;
      o.ownerX = item.x;
      o.ownerY = item.y;
      if (ClientPlayer.isValidBox(o)) validObstacles.push(o);
    }

    const allBoxes = frameData.allNameplateBoxes || [];
    allBoxes.sort((a, b) => b.priority - a.priority);

    nameplateTree.load(validObstacles);

    // helper: check for real collisions (ignoring this unit's own icon obstacle)
    // Query box is a reused scratch — rbush.search only reads it.
    if (!frameData._queryBox) frameData._queryBox = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    const queryBox = frameData._queryBox;
    const hasRealCollision = (bMinX, bMinY, bMaxX, bMaxY, ownerX, ownerY) => {
      queryBox.minX = bMinX; queryBox.minY = bMinY;
      queryBox.maxX = bMaxX; queryBox.maxY = bMaxY;
      const hits = nameplateTree.search(queryBox);
      for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        if (!(h.isObstacle && h.ownerX === ownerX && h.ownerY === ownerY)) return true;
      }
      return false;
    };

    if (!frameData._placedPool) frameData._placedPool = [];
    const placedPool = frameData._placedPool;

    allBoxes.forEach((nameBox, boxIdx) => {
      const { drawX, baseY, nameStr, iconSize, fontSize, isHero, playerColor } = nameBox;
      let { minX, maxX, minY, maxY, drawY } = nameBox;

      const collisionAbove = hasRealCollision(minX, minY, maxX, maxY, drawX, baseY);

      // Slightly more opaque background than before so the player-color
      // stripe along the bottom has a stable dark band to sit on.
      let bgAlpha = isHero ? 0.85 : 0.75;
      let textAlpha = 1;

      if (collisionAbove) {
        // try below the unit instead
        const belowY = baseY + iconSize / 2 + fontSize + 4;
        const collisionBelow = hasRealCollision(minX, belowY - fontSize, maxX, belowY, drawX, baseY);

        if (!collisionBelow) {
          drawY = belowY;
          minY = belowY - fontSize;
          maxY = belowY;
        } else {
          return; // both blocked — hide entirely
        }
      }

      // Register this nameplate in the tree so later ones see it. Pooled, but
      // unlike the query scratch this one is RETAINED by the tree for the rest
      // of the frame, so each nameplate needs its own slot — hence the index.
      let placedBox = placedPool[boxIdx];
      if (!placedBox) placedBox = placedPool[boxIdx] = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      placedBox.minX = minX; placedBox.minY = minY;
      placedBox.maxX = maxX; placedBox.maxY = maxY;
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

      // Dark base fill. (Drawing.roundedRectPath rather than a local closure —
      // this loop runs per nameplate per frame and the closure was allocated
      // every time just to re-trace the same shape two or three times.)
      ctx.globalAlpha = bgAlpha;
      ctx.fillStyle = '#0d0d10';
      Drawing.roundedRectPath(ctx, bgX, bgY, bgW, bgH, radius);
      ctx.fill();

      // Faint full-area playerColor tint diffused into the dark background —
      // the color is everywhere, not on a single edge. Mirrors WC3 selection-
      // circle / faction-tint idiom on the entire plate.
      if (playerColor) {
        ctx.globalAlpha = 0.20 * bgAlpha;
        ctx.fillStyle = playerColor;
        Drawing.roundedRectPath(ctx, bgX, bgY, bgW, bgH, radius);
        ctx.fill();

        // Full-perimeter playerColor outline. Symmetric, so it doesn't read
        // as a single-edge accent — the color goes all the way around at
        // equal weight. 1.5px is enough to scan from a glance without
        // overwhelming the text.
        ctx.globalAlpha = 0.95;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = playerColor;
        Drawing.roundedRectPath(ctx, bgX, bgY, bgW, bgH, radius);
        ctx.stroke();
      }

      // text
      ctx.globalAlpha = textAlpha;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.font = ClientPlayer._nameplateFont(Math.ceil(fontSize));
      ctx.fillStyle = '#FFF';
      ctx.fillText(nameStr, drawX, drawY);
      ctx.textAlign = 'left';
    });

    ctx.globalAlpha = 1;
  }

  // World-space anchors that define "the base": the start location plus every
  // own town hall (covers expansions). Workers are hidden unless they leave
  // this radius (or get pulled to fight). Computed once — halls don't move.
  getBaseAnchors () {
    if (this._baseAnchors) return this._baseAnchors;
    const anchors = [];
    if (this.startingPosition) {
      anchors.push({ x: this.startingPosition.x, y: this.startingPosition.y });
    }
    for (const u of this.units) {
      if (!u.isBuilding) continue;
      if (!ClientPlayer.HALL_IDS.has(u.itemId)) continue;
      const pos = u.lastPosition || (u.path && u.path[0]) || u.spawnPosition;
      if (pos && pos.x != null) anchors.push({ x: pos.x, y: pos.y });
    }
    this._baseAnchors = anchors;
    return this._baseAnchors;
  }

  preRender (frameData, mainCtx, playerCtx, utilityCtx, playerStatusCtx, transform, gameTime, xScale, yScale, viewOptions) {
    // Per-player base anchors for worker-visibility gating in ClientUnit. Set
    // before this player's unit loop so each unit reads its OWN player's base.
    frameData.baseAnchors = this.isNeutralPlayer ? null : this.getBaseAnchors();

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

    this.drawResolvedUnits(frameData, playerCtx, viewOptions);

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

// Town-hall itemIds per race (main + tier upgrades). Used to anchor the
// "base" region for worker-visibility gating. Expansions reuse the base hall
// id, so an expo hall counts too.
ClientPlayer.HALL_IDS = new Set([
  'htow', 'hkee', 'hcas',   // Human: Town Hall / Keep / Castle
  'ogre', 'ostr', 'ofrt',   // Orc: Great Hall / Stronghold / Fortress
  'etol', 'etoa', 'etoe',   // Night Elf: Tree of Life / Ages / Eternity
  'unpl', 'unp1', 'unp2'    // Undead: Necropolis / Halls of the Dead / Black Citadel
]);

window.ClientPlayer = ClientPlayer;
