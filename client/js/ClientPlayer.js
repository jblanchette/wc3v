
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
      if (ind > 0) hero.iconSize = IconSizes.secondaryHero;
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
        scoutLabel: scoutLabel || null
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

    // cluster same-type army units by proximity — reduces bloom input count
    const { representatives, collapsed } = ClientPlayer.clusterArmyUnits(armyUnits);

    // when gameTime hasn't changed (e.g. panning while paused), reuse cached
    // bloom offsets instead of re-running the non-deterministic bloom algorithm
    if (skipBloom && this._bloomCache && this._bloomCache.size > 0) {
      // set _origX from fresh screen-projected positions
      representatives.forEach(rep => {
        rep._origX = rep.drawX;
        rep._origY = rep.drawY;
        const cached = this._bloomCache.get(rep.uuid);
        if (cached) {
          rep.drawX = rep._origX + cached.ox;
          rep.drawY = rep._origY + cached.oy;
        }
      });

      // apply cross-collision cached offsets
      if (this._crossCollisionCache) {
        representatives.forEach(rep => {
          rep._preCollisionX = rep.drawX;
          rep._preCollisionY = rep.drawY;
          const cc = this._crossCollisionCache.get(rep.uuid);
          if (cc) {
            rep.drawX += cc.ox;
            rep.drawY += cc.oy;
          }
        });
      }

      // displacement cap
      const maxDisp = 35;
      representatives.forEach(u => {
        const dx = u.drawX - u._origX;
        const dy = u.drawY - u._origY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > maxDisp) {
          const scale = maxDisp / dist;
          u.drawX = u._origX + dx * scale;
          u.drawY = u._origY + dy * scale;
        }
      });

      this._resolved = { representatives, collapsed, alwaysDrawSlots };
      return;
    }

    // detect army mode (pack vs scattered) and choose layout strategy
    this._armyMeta = ClientPlayer.computeArmyMeta(representatives);

    // hysteretic mode determination — dead band prevents flip-flopping
    let mode;
    if (forceMode) {
      mode = forceMode;
    } else if (this._armyMeta.spread <= 60) {
      mode = 'pack';
    } else if (this._armyMeta.spread > 100) {
      mode = 'scattered';
    } else {
      mode = this._prevArmyMode || 'scattered';
    }
    this._armyMeta.mode = mode;

    if (!this._bloomCache) this._bloomCache = new Map();
    this._prevArmyMode = mode;

    // identify units without cache entries (new to bloom) for symmetry breaking
    const newUuids = new Set();
    representatives.forEach(rep => {
      if (!this._bloomCache.has(rep.uuid)) newUuids.add(rep.uuid);
    });

    if (mode === 'pack') {
      // structured formation layout — replaces bloom when army is tightly packed
      ClientPlayer.formationLayout(representatives, this._spawnBiasAngle || 0, wc3v._treeIndex);
    } else {
      // normal bloom + directional bias for scattered/engaged armies
      ClientPlayer.bloomResolve(representatives, 3, 0.6, newUuids, wc3v._treeIndex);

      // bias nudge — apply to BOTH _origX and drawX so offset calc stays clean
      if (this._spawnBiasAngle !== undefined) {
        const biasStrength = 4;
        const bx = Math.cos(this._spawnBiasAngle) * biasStrength;
        const by = Math.sin(this._spawnBiasAngle) * biasStrength;
        representatives.forEach(rep => {
          if (!rep.isHero) {
            rep._origX += bx;
            rep._origY += by;
            rep.drawX += bx;
            rep.drawY += by;
          }
        });
      }
    }

    // temporal smoothing — smooth the bloom OFFSET (not absolute position)
    const currentGameTime = frameData.gameTime || 0;

    // clear caches on backward scrub
    if (currentGameTime < (this._lastBloomTime || 0) - 500) {
      this._bloomCache.clear();
      if (this._crossCollisionCache) this._crossCollisionCache.clear();
    }
    this._lastBloomTime = currentGameTime;

    const lerp = 0.2;
    const activeUuids = new Set();
    representatives.forEach(unitBox => {
      activeUuids.add(unitBox.uuid);

      const bloomOffsetX = unitBox.drawX - unitBox._origX;
      const bloomOffsetY = unitBox.drawY - unitBox._origY;

      const prev = this._bloomCache.get(unitBox.uuid);
      if (prev) {
        const smoothX = prev.ox + (bloomOffsetX - prev.ox) * lerp;
        const smoothY = prev.oy + (bloomOffsetY - prev.oy) * lerp;
        unitBox.drawX = unitBox._origX + smoothX;
        unitBox.drawY = unitBox._origY + smoothY;
        this._bloomCache.set(unitBox.uuid, { ox: smoothX, oy: smoothY });
      } else {
        this._bloomCache.set(unitBox.uuid, { ox: bloomOffsetX, oy: bloomOffsetY });
      }
    });

    // prune dead/collapsed units from cache
    this._bloomCache.forEach((_, uuid) => {
      if (!activeUuids.has(uuid)) this._bloomCache.delete(uuid);
    });

    // hard displacement cap AFTER temporal smoothing — no unit can be more than
    // 35px from its true path position regardless of cached offsets
    const maxFinalDisplacement = 35;
    representatives.forEach(u => {
      const dx = u.drawX - u._origX;
      const dy = u.drawY - u._origY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxFinalDisplacement) {
        const scale = maxFinalDisplacement / dist;
        u.drawX = u._origX + dx * scale;
        u.drawY = u._origY + dy * scale;
        // also clamp the cached offset so it doesn't keep inflating
        this._bloomCache.set(u.uuid, {
          ox: (u.drawX - u._origX),
          oy: (u.drawY - u._origY)
        });
      }
    });

    // terrain + tree clamp after displacement cap
    const treeIdx = wc3v._treeIndex;
    const terrainIdx = wc3v._terrainIndex;
    if (treeIdx || terrainIdx) {
      representatives.forEach(u => {
        if (Wc3vViewer.isBlockedTerrain(terrainIdx, u.drawX, u.drawY)) {
          u.drawX = u._origX;
          u.drawY = u._origY;
          this._bloomCache.set(u.uuid, { ox: 0, oy: 0 });
          return;
        }
        const hit = Wc3vViewer.treeCollisionCheck(treeIdx, u.drawX, u.drawY, u.halfIconSize);
        if (hit) {
          const tdx = u.drawX - hit.tree.x;
          const tdy = u.drawY - hit.tree.y;
          const d = hit.dist || 0.01;
          const push = hit.minDist - d;
          u.drawX += (tdx / d) * push;
          u.drawY += (tdy / d) * push;
        }
      });
    }

    // store resolved data for cross-player collision + draw phase
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
        ctx.globalAlpha = 1;
      }
    });
  }

  static bloomResolve (units, iterations = 3, springStrength = 0.6, newUuids = null, treeIndex = null) {
    const len = units.length;

    // save original positions (needed by temporal smoothing even for solo units)
    for (let i = 0; i < len; i++) {
      units[i]._origX = units[i].drawX;
      units[i]._origY = units[i].drawY;
    }

    if (len < 2) return;

    // symmetry breaking — jitter coincident non-hero units onto a small circle
    // only for NEW units (no cache entry) to avoid per-frame micro-motion
    for (let i = 0; i < len; i++) {
      if (units[i].isHero) continue;
      if (newUuids && !newUuids.has(units[i].uuid)) continue;

      let coincidentCount = 0;
      let coincidentIndex = 0;

      for (let j = 0; j < len; j++) {
        if (i === j) continue;
        if (Math.abs(units[i].drawX - units[j].drawX) < 0.5 &&
            Math.abs(units[i].drawY - units[j].drawY) < 0.5) {
          coincidentCount++;
          if (j < i) coincidentIndex++;
        }
      }

      if (coincidentCount > 0) {
        const total = coincidentCount + 1;
        const angle = (2 * Math.PI * coincidentIndex) / total;
        units[i].drawX += Math.cos(angle) * 3;
        units[i].drawY += Math.sin(angle) * 3;
      }
    }

    for (let iter = 0; iter < iterations; iter++) {
      // push overlapping pairs apart
      for (let i = 0; i < len; i++) {
        const a = units[i];
        for (let j = i + 1; j < len; j++) {
          const b = units[j];

          // use actual drawn circle radius (halfIconSize + 2) plus 2px visual gap
          const minDist = (a.halfIconSize + 2) + (b.halfIconSize + 2) + 2;

          let dx = b.drawX - a.drawX;
          let dy = b.drawY - a.drawY;
          let dist = Math.sqrt(dx * dx + dy * dy);

          // deterministic fallback for still-coincident pairs
          if (dist < 0.01) {
            const angle = ((i * 7 + j * 13) % 37) / 37 * Math.PI * 2;
            dx = Math.cos(angle);
            dy = Math.sin(angle);
            dist = 0.01;
          }

          if (dist < minDist) {
            const overlap = (minDist - dist) / 2;
            const nx = dx / dist;
            const ny = dy / dist;

            // heroes are anchored — only the non-hero moves (full overlap, not doubled)
            if (a.isHero && !b.isHero) {
              b.drawX += nx * overlap;
              b.drawY += ny * overlap;
            } else if (b.isHero && !a.isHero) {
              a.drawX -= nx * overlap;
              a.drawY -= ny * overlap;
            } else {
              a.drawX -= nx * overlap;
              a.drawY -= ny * overlap;
              b.drawX += nx * overlap;
              b.drawY += ny * overlap;
            }
          }
        }
      }

      // spring-pull back toward originals
      for (let i = 0; i < len; i++) {
        const u = units[i];
        const spring = u.isHero ? 0.9 : springStrength;
        u.drawX += (u._origX - u.drawX) * spring;
        u.drawY += (u._origY - u.drawY) * spring;
      }

      // terrain + tree collision clamping — prevent bloom from pushing units into unpathable areas
      if (treeIndex) {
        for (let i = 0; i < len; i++) {
          const u = units[i];
          // check WPM terrain (water, cliffs) — snap back to original if blocked
          if (Wc3vViewer.isBlockedTerrain(wc3v._terrainIndex, u.drawX, u.drawY)) {
            u.drawX = u._origX;
            u.drawY = u._origY;
            continue;
          }
          // check tree sprites — push out along tree→unit vector
          const hit = Wc3vViewer.treeCollisionCheck(treeIndex, u.drawX, u.drawY, u.halfIconSize);
          if (hit) {
            const tdx = u.drawX - hit.tree.x;
            const tdy = u.drawY - hit.tree.y;
            const d = hit.dist || 0.01;
            const push = hit.minDist - d;
            u.drawX += (tdx / d) * push;
            u.drawY += (tdy / d) * push;
          }
        }
      }
    }

    // hard cap — no unit can be displaced more than 35px from its true position
    const maxDisplacement = 35;
    for (let i = 0; i < len; i++) {
      const u = units[i];
      const dx = u.drawX - u._origX;
      const dy = u.drawY - u._origY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxDisplacement) {
        const scale = maxDisplacement / dist;
        u.drawX = u._origX + dx * scale;
        u.drawY = u._origY + dy * scale;
      }
    }
  }

  static computeArmyMeta (representatives) {
    if (!representatives.length) {
      return { centroidX: 0, centroidY: 0, spread: Infinity, mode: 'scattered' };
    }

    let cx = 0, cy = 0, total = 0;
    for (let i = 0; i < representatives.length; i++) {
      const w = representatives[i].clusterCount || 1;
      cx += representatives[i].drawX * w;
      cy += representatives[i].drawY * w;
      total += w;
    }
    cx /= total;
    cy /= total;

    let spreadSum = 0;
    for (let i = 0; i < representatives.length; i++) {
      const w = representatives[i].clusterCount || 1;
      const dx = representatives[i].drawX - cx;
      const dy = representatives[i].drawY - cy;
      spreadSum += Math.sqrt(dx * dx + dy * dy) * w;
    }
    const spread = spreadSum / total;

    return {
      centroidX: cx,
      centroidY: cy,
      spread
    };
  }

  static formationLayout (representatives, biasAngle = 0, treeIndex = null) {
    const len = representatives.length;
    if (len < 1) return;

    // save originals for temporal smoothing
    for (let i = 0; i < len; i++) {
      representatives[i]._origX = representatives[i].drawX;
      representatives[i]._origY = representatives[i].drawY;
    }

    if (len < 2) return;

    // compute centroid
    let cx = 0, cy = 0, total = 0;
    for (let i = 0; i < len; i++) {
      const w = representatives[i].clusterCount || 1;
      cx += representatives[i].drawX * w;
      cy += representatives[i].drawY * w;
      total += w;
    }
    cx /= total;
    cy /= total;

    const mainHero = representatives.find(u => u.isMainHero);
    const secondaryHeroes = representatives.filter(u => u.isHero && !u.isMainHero);
    const nonHeroes = representatives.filter(u => !u.isHero);

    // main hero at centroid
    if (mainHero) {
      mainHero.drawX = cx;
      mainHero.drawY = cy;
    }

    // ring 1: secondary heroes
    const ring1Radius = 22;
    secondaryHeroes.forEach((unit, i) => {
      const angle = biasAngle + (2 * Math.PI * i / Math.max(secondaryHeroes.length, 1));
      unit.drawX = cx + Math.cos(angle) * ring1Radius;
      unit.drawY = cy + Math.sin(angle) * ring1Radius;
    });

    // ring 2: non-hero reps
    const ring2Radius = 38;
    nonHeroes.forEach((unit, i) => {
      const angle = biasAngle + (2 * Math.PI * i / Math.max(nonHeroes.length, 1));
      unit.drawX = cx + Math.cos(angle) * ring2Radius;
      unit.drawY = cy + Math.sin(angle) * ring2Radius;
    });

    // terrain + tree collision clamping
    if (treeIndex) {
      for (let i = 0; i < len; i++) {
        const u = representatives[i];
        if (Wc3vViewer.isBlockedTerrain(wc3v._terrainIndex, u.drawX, u.drawY)) {
          u.drawX = u._origX;
          u.drawY = u._origY;
          continue;
        }
        const hit = Wc3vViewer.treeCollisionCheck(treeIndex, u.drawX, u.drawY, u.halfIconSize);
        if (hit) {
          const tdx = u.drawX - hit.tree.x;
          const tdy = u.drawY - hit.tree.y;
          const d = hit.dist || 0.01;
          const push = hit.minDist - d;
          u.drawX += (tdx / d) * push;
          u.drawY += (tdy / d) * push;
        }
      }
    }
  }

  static crossPlayerCollision (allReps, iterations = 3, maxDisplacement = 25, treeIndex = null) {
    const len = allReps.length;
    if (len < 2) return;

    for (let i = 0; i < len; i++) {
      allReps[i]._preCollisionX = allReps[i].drawX;
      allReps[i]._preCollisionY = allReps[i].drawY;
    }

    for (let iter = 0; iter < iterations; iter++) {
      for (let i = 0; i < len; i++) {
        const a = allReps[i];
        for (let j = i + 1; j < len; j++) {
          const b = allReps[j];

          // only resolve cross-player overlaps
          if (a.playerId === b.playerId) continue;

          const minDist = (a.halfIconSize + 2) + (b.halfIconSize + 2) + 2;

          let dx = b.drawX - a.drawX;
          let dy = b.drawY - a.drawY;
          let dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 0.01) {
            const angle = ((i * 7 + j * 13) % 37) / 37 * Math.PI * 2;
            dx = Math.cos(angle);
            dy = Math.sin(angle);
            dist = 0.01;
          }

          if (dist < minDist) {
            const overlap = (minDist - dist) / 2;
            const nx = dx / dist;
            const ny = dy / dist;

            a.drawX -= nx * overlap;
            a.drawY -= ny * overlap;
            b.drawX += nx * overlap;
            b.drawY += ny * overlap;
          }
        }
      }
    }

    // terrain + tree collision clamping
    if (treeIndex) {
      for (let i = 0; i < len; i++) {
        const u = allReps[i];
        if (Wc3vViewer.isBlockedTerrain(wc3v._terrainIndex, u.drawX, u.drawY)) {
          u.drawX = u._preCollisionX;
          u.drawY = u._preCollisionY;
          continue;
        }
        const hit = Wc3vViewer.treeCollisionCheck(treeIndex, u.drawX, u.drawY, u.halfIconSize);
        if (hit) {
          const tdx = u.drawX - hit.tree.x;
          const tdy = u.drawY - hit.tree.y;
          const d = hit.dist || 0.01;
          const push = hit.minDist - d;
          u.drawX += (tdx / d) * push;
          u.drawY += (tdy / d) * push;
        }
      }
    }

    // cap displacement from post-bloom position
    for (let i = 0; i < len; i++) {
      const u = allReps[i];
      const dx = u.drawX - u._preCollisionX;
      const dy = u.drawY - u._preCollisionY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxDisplacement) {
        const scale = maxDisplacement / dist;
        u.drawX = u._preCollisionX + dx * scale;
        u.drawY = u._preCollisionY + dy * scale;
      }
    }
  }

  static clusterArmyUnits (armyUnits, clusterRadius = 35) {
    const representatives = [];
    const collapsed = [];

    const heroes = [];
    const nonHeroes = [];
    armyUnits.forEach(u => (u.isHero ? heroes : nonHeroes).push(u));

    heroes.forEach(h => representatives.push(h));

    // group non-heroes by itemId
    const byItemId = {};
    nonHeroes.forEach(u => {
      if (!byItemId[u.itemId]) byItemId[u.itemId] = [];
      byItemId[u.itemId].push(u);
    });

    // within each type, cluster by proximity
    Object.values(byItemId).forEach(group => {
      if (group.length === 1) {
        representatives.push(group[0]);
        return;
      }

      const assigned = new Set();

      for (let i = 0; i < group.length; i++) {
        const unit = group[i];
        if (assigned.has(unit.uuid)) continue;

        const cluster = [unit];
        assigned.add(unit.uuid);

        for (let j = i + 1; j < group.length; j++) {
          const other = group[j];
          if (assigned.has(other.uuid)) continue;
          const dx = other.drawX - unit.drawX;
          const dy = other.drawY - unit.drawY;
          if (Math.sqrt(dx * dx + dy * dy) <= clusterRadius) {
            cluster.push(other);
            assigned.add(other.uuid);
          }
        }

        const rep = cluster[0];
        rep.clusterCount = cluster.length;

        if (cluster.length > 1) {
          let avgX = 0, avgY = 0;
          for (let k = 0; k < cluster.length; k++) {
            avgX += cluster[k].drawX;
            avgY += cluster[k].drawY;
          }
          rep.drawX = avgX / cluster.length;
          rep.drawY = avgY / cluster.length;
        }

        representatives.push(rep);

        for (let k = 1; k < cluster.length; k++) {
          collapsed.push(cluster[k]);
        }
      }
    });

    return { representatives, collapsed };
  }

  static isValidBox (box) {
    return Number.isFinite(box.minX) && Number.isFinite(box.maxX) &&
           Number.isFinite(box.minY) && Number.isFinite(box.maxY);
  }

  static buildNameplateBoxes (frameData, ctx) {
    const { unitDrawPositions } = frameData;

    return unitDrawPositions.reduce((acc, item) => {
      const { x, y, iconSize, fontSize, isHero, heroRank, fullName, decayLevel, count, isNeutralPlayer } = item;

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

    const validObstacles = obstacles.filter(o => ClientPlayer.isValidBox(o));
    nameplateTree.load(validObstacles);

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
