// seeded pseudo-random for deterministic per-tree variation
function tileHash (a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) & 0xFF) / 255.0;
}

function hexToRgb (hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ];
}

const MapRenderer = class {
  constructor () {
    this._neutralIcons = {};
    this._neutralIconsLoaded = false;

    const iconTypes = ['ngol', 'nfoh', 'nmoo', 'nmer', 'ntav', 'ngme', 'ngad', 'nmrk'];
    let loaded = 0;

    iconTypes.forEach(type => {
      const img = new Image();
      img.onload = () => {
        this._neutralIcons[type] = img;
        loaded++;
        if (loaded === iconTypes.length) {
          this._neutralIconsLoaded = true;
        }
      };
      img.onerror = () => {
        loaded++;
        if (loaded === iconTypes.length) {
          this._neutralIconsLoaded = true;
        }
      };
      img.src = `/assets/wc3icons/${type}.jpg`;
    });
  }

  renderMapBackground (ctx, transform, viewOptions, gameScaler, mapImage, gridMapImage) {
    const {
      cropOffset,
      sceneWidth,
      sceneHeight
    } = gameScaler;

    const bgImage = viewOptions.displayMapGrid ?
      gridMapImage : mapImage;

    // canvas context already has translate + scale applied
    // draw at (0,0) in canvas-space; context transform handles zoom/pan
    ctx.drawImage(
      bgImage,
      cropOffset.x,        // sourceX: where camera starts in full map image
      cropOffset.y,        // sourceY
      sceneWidth,          // sourceWidth: camera area size
      sceneHeight,         // sourceHeight
      0,                   // destX: canvas-space origin
      0,                   // destY
      sceneWidth,          // destWidth
      sceneHeight          // destHeight
    );
  }

  renderMapTrees (ctx, transform, viewOptions, doodadData, gameScaler, mapInfo) {
    const {
      middleX,
      middleY,
      xScale,
      yScale
    } = gameScaler;

    if (!viewOptions.displayTreeGrid) {
      return;
    }

    const oldFillStyle = ctx.fillStyle;
    const oldAlpha = ctx.globalAlpha;

    const treeRgb = hexToRgb((mapInfo && mapInfo.treeColor) || '#064006');

    doodadData.forEach((tree) => {
      const { position, scale } = tree;
      const tx = Math.round(parseFloat(position.x));
      const ty = Math.round(parseFloat(position.y));

      // per-tree seeded variation
      const h1 = tileHash(tx, ty);
      const h2 = tileHash(ty, tx);

      // brightness: +/-15%
      const bright = 1 + (h1 * 0.3 - 0.15);
      const cr = Math.max(0, Math.min(255, Math.round(treeRgb[0] * bright)));
      const cg = Math.max(0, Math.min(255, Math.round(treeRgb[1] * bright)));
      const cb = Math.max(0, Math.min(255, Math.round(treeRgb[2] * bright)));
      ctx.fillStyle = 'rgb(' + cr + ',' + cg + ',' + cb + ')';

      // opacity: 0.7 to 0.9
      ctx.globalAlpha = 0.7 + h2 * 0.2;

      // size: +/-20%
      const sizeVar = 1 + (h2 * 0.4 - 0.2);
      const scaledSize = 8 * scale[0] * sizeVar;

      // position jitter
      const jitterX = (h1 * 6 - 3);
      const jitterY = (h2 * 6 - 3);

      const drawX = xScale(position.x) + middleX + jitterX;
      const drawY = yScale(position.y) + middleY + jitterY;

      ctx.beginPath();
      ctx.arc(drawX, drawY, scaledSize, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = oldFillStyle;
    ctx.globalAlpha = oldAlpha;
  }

  // binary search: find the latest snapshot where gameTime <= target
  _findProgress (timeline, gameTime) {
    if (!timeline || !timeline.length) return null;
    if (gameTime < timeline[0].gameTime) return null;
    if (gameTime >= timeline[timeline.length - 1].gameTime) return timeline[timeline.length - 1];

    let lo = 0, hi = timeline.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (timeline[mid].gameTime <= gameTime) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return timeline[lo];
  }

  // Note: this method mutates neutralGroup.isHidden and unit.isNeutralGroupHidden
  // on the data objects passed via mapData and players (by-reference side effects).
  renderNeutralGroups (ctx, gameTime, transform, mapData, viewOptions, gameScaler, players, teamColorMap, hoveredCampUuid, campHitOut) {
    const { world } = mapData;

    const {
      middleX,
      middleY,
      xScale,
      yScale
    } = gameScaler;

    ctx.save();

    const neutralPlayer = players.find(player => {
      return player.playerId === "1042";
    });

    if (!neutralPlayer) {
      ctx.restore();
      return;
    }

    const PI2 = Math.PI * 2;
    const START_ANGLE = -Math.PI / 2; // 12 o'clock
    const RING_PAD = 4;

    if (campHitOut) campHitOut.length = 0;

    const groups = Object.values(world.neutralGroups);
    const claimPaths = {};

    groups.forEach((neutralGroup) => {
      const {
        claimState, claimTime, claimOwnerId, uuid, order,
        teamOrders, progressTimeline
      } = neutralGroup;

      // use tight unitBounds for rendering (falls back to padded bounds)
      const b = neutralGroup.unitBounds || neutralGroup.bounds;

      // Project the 4 bbox corners through the 3D camera and take the screen-
      // space AABB so camp rings land on the correct terrain surface.
      const _gs = window.wc3v && window.wc3v.gameScaler;
      const _c1 = _gs.projectXY(b.minX, b.minY);
      const _c2 = _gs.projectXY(b.maxX, b.minY);
      const _c3 = _gs.projectXY(b.minX, b.maxY);
      const _c4 = _gs.projectXY(b.maxX, b.maxY);
      const _minPX = Math.min(_c1.x, _c2.x, _c3.x, _c4.x);
      const _maxPX = Math.max(_c1.x, _c2.x, _c3.x, _c4.x);
      const _minPY = Math.min(_c1.y, _c2.y, _c3.y, _c4.y);
      const _maxPY = Math.max(_c1.y, _c2.y, _c3.y, _c4.y);
      const rectWidth = _maxPX - _minPX;
      const rectHeight = _maxPY - _minPY;
      const drawX = _minPX + middleX;
      const drawY = _minPY + middleY;

      // ring geometry
      const centerX = drawX + rectWidth / 2;
      const centerY = drawY + rectHeight / 2;
      const radius = Math.max(rectWidth, rectHeight) / 2 + RING_PAD;

      // Publish what we just drew so the hit-test uses the exact same numbers.
      if (campHitOut) {
        campHitOut.push({ rawGroup: neutralGroup, cx: centerX, cy: centerY, r: radius });
      }

      // look up current progress from timeline
      const snapshot = this._findProgress(progressTimeline, gameTime);
      const currentTeams = snapshot ? snapshot.teams : null;
      const maxProgress = currentTeams
        ? Math.max(...Object.values(currentTeams))
        : 0;

      const hasCampProgress = maxProgress > 0.02;
      const isCleared = maxProgress >= 0.85;

      // hide neutral units once any team has interacted with the camp
      if (hasCampProgress) {
        if (!neutralGroup.isHidden) {
          neutralGroup.isHidden = true;
          neutralPlayer.units.forEach(unit => {
            if (unit.neutralGroupId === uuid) {
              unit.isNeutralGroupHidden = true;
            }
          });
        }
      } else if (neutralGroup.isHidden) {
        neutralGroup.isHidden = false;
        neutralPlayer.units.forEach(unit => {
          if (unit.neutralGroupId === uuid) {
            unit.isNeutralGroupHidden = false;
          }
        });
      }

      // collect route paths — add to each team that has progress
      if (hasCampProgress && claimTime != null && gameTime >= claimTime && currentTeams) {
        Object.entries(currentTeams).forEach(([teamId, progress]) => {
          if (progress <= 0.005) return;
          if (!claimPaths[teamId]) {
            claimPaths[teamId] = [];
          }
          claimPaths[teamId].push({ claimTime, drawX, drawY, rectWidth, rectHeight });
        });
      }

      const isHovered = (uuid === hoveredCampUuid);

      if (maxProgress > 0.02 && currentTeams) {
        //
        // camp has been interacted with — solid fill
        //
        const teamsWithProgress = Object.entries(currentTeams)
          .filter(([, v]) => v > 0.005)
          .sort((a, b) => b[1] - a[1]);

        if (teamsWithProgress.length === 1) {
          // single team: solid filled circle
          const color = teamColorMap[teamsWithProgress[0][0]] || '#FFF';

          // black border
          ctx.beginPath();
          ctx.arc(centerX, centerY, radius + 2, 0, PI2);
          ctx.fillStyle = '#000';
          ctx.globalAlpha = 0.7;
          ctx.fill();

          // team color fill
          ctx.beginPath();
          ctx.arc(centerX, centerY, radius, 0, PI2);
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.75;
          ctx.fill();
        } else {
          // multiple teams: equal split wedges
          const wedgeAngle = PI2 / teamsWithProgress.length;

          // black border behind
          ctx.beginPath();
          ctx.arc(centerX, centerY, radius + 2, 0, PI2);
          ctx.fillStyle = '#000';
          ctx.globalAlpha = 0.7;
          ctx.fill();

          let angle = START_ANGLE;
          teamsWithProgress.forEach(([teamId]) => {
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, radius, angle, angle + wedgeAngle);
            ctx.closePath();
            ctx.fillStyle = teamColorMap[teamId] || '#FFF';
            ctx.globalAlpha = 0.75;
            ctx.fill();
            angle += wedgeAngle;
          });

          // divider lines between wedges
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 2;
          ctx.globalAlpha = 0.6;
          angle = START_ANGLE;
          for (let i = 0; i < teamsWithProgress.length; i++) {
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(
              centerX + Math.cos(angle) * radius,
              centerY + Math.sin(angle) * radius
            );
            ctx.stroke();
            angle += wedgeAngle;
          }
        }

        // white outline on top
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, PI2);
        ctx.strokeStyle = isHovered ? '#FFF' : 'rgba(255,255,255,0.5)';
        ctx.lineWidth = isHovered ? 3 : 1.5;
        ctx.globalAlpha = isHovered ? 0.9 : 0.6;
        ctx.stroke();

      } else {
        // untouched: thin white circle
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, PI2);
        ctx.strokeStyle = '#FFF';
        ctx.lineWidth = isHovered ? 3 : 1.5;
        ctx.globalAlpha = isHovered ? 0.8 : 0.35;
        ctx.stroke();
      }

      // camp order badges — one per team that participated
      if (maxProgress > 0.02 && claimTime != null && gameTime >= claimTime && teamOrders) {
        const teamIds = Object.keys(teamOrders);
        teamIds.forEach((tid, idx) => {
          const teamOrder = teamOrders[tid];
          if (!teamOrder) return;

          // position badges around the circle edge, spaced apart for multi-team
          const baseAngle = Math.PI / 4;
          const angleOffset = teamIds.length > 1 ? (idx - 0.5) * 0.6 : 0;
          const badgeAngle = baseAngle + angleOffset;
          const badgeX = centerX + Math.cos(badgeAngle) * (radius + 12);
          const badgeY = centerY + Math.sin(badgeAngle) * (radius + 12);
          const badgeColor = teamColorMap[tid] || '#FFF';
          Drawing.drawCampOrderBadge(ctx, `${teamOrder}`, badgeX, badgeY, badgeColor, teamIds.length > 1 ? 0.8 : 1);
        });
      }
    });

    // creep route lines
    if (!viewOptions.displayCreepRoute) {
      ctx.restore();
      return;
    }

    Object.keys(claimPaths).forEach(teamClaimId => {
      const claimPath = claimPaths[teamClaimId].sort((a, b) => {
        return a.claimTime - b.claimTime;
      });

      ctx.strokeStyle = teamColorMap[teamClaimId] || '#FFF';
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.7;
      ctx.setLineDash([]);

      for (let i = 1; i < claimPath.length; i++) {
        const prev = claimPath[i - 1];
        const step = claimPath[i];

        const prevMidX = prev.drawX + (prev.rectWidth / 2);
        const prevMidY = prev.drawY + (prev.rectHeight / 2);
        const stepMidX = step.drawX + (step.rectWidth / 2);
        const stepMidY = step.drawY + (step.rectHeight / 2);

        ctx.beginPath();
        ctx.moveTo(prevMidX, prevMidY);
        ctx.lineTo(stepMidX, stepMidY);
        ctx.stroke();
      }
    });

    ctx.setLineDash([]);
    ctx.restore();
  }

  renderNeutralBuildings (ctx, transform, viewOptions, neutralBuildings, gameScaler) {
    // 3D building models handle neutral building rendering now (ThreeMapRenderer).
    return;
    if (!viewOptions.displayNeutralBuildings || !neutralBuildings || !neutralBuildings.length) {
      return;
    }

    const {
      middleX,
      middleY,
      xScale,
      yScale
    } = gameScaler;

    const oldFillStyle = ctx.fillStyle;
    const oldStrokeStyle = ctx.strokeStyle;
    const oldAlpha = ctx.globalAlpha;
    const oldLineWidth = ctx.lineWidth;

    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.5;

    const iconSize = nb_type => {
      if (nb_type === 'ngol') return 22;
      return 18;
    };

    neutralBuildings.forEach(nb => {
      const _projNB = window.wc3v.gameScaler.projectXY(nb.x, nb.y);
      const drawX = _projNB.x + middleX;
      const drawY = _projNB.y + middleY;
      const icon = this._neutralIcons[nb.type];
      const size = iconSize(nb.type);
      const half = size / 2;

      if (icon) {
        ctx.drawImage(icon, drawX - half, drawY - half, size, size);
      } else {
        // fallback: colored square if icon not loaded
        ctx.fillStyle = nb.type === 'ngol' ? '#d4a017' : '#9966cc';
        ctx.fillRect(drawX - half, drawY - half, size, size);
      }
    });

    ctx.fillStyle = oldFillStyle;
    ctx.strokeStyle = oldStrokeStyle;
    ctx.globalAlpha = oldAlpha;
    ctx.lineWidth = oldLineWidth;
  }

  renderMapGrid (ctx, transform, viewOptions, gameScaler, mapInfo, gridData, canvas) {
    const { gridXScale, gridYScale, xScale, yScale, middleX, middleY } = gameScaler;

    if (!viewOptions.displayWalkGrid  &&
        !viewOptions.displayWaterGrid &&
        !viewOptions.displayBuildGrid) {
      return;
    }

    return;

    const { gridSize } = mapInfo;
    const { full, playable } = gridSize;

    const gridHeight = gridData.length;
    const gridWidth  = gridData[0].length;

    const { width, height } = canvas;

    const tileHeight = (height / gridHeight);
    const tileWidth  = (width  / gridWidth);

    ctx.lineWidth = 1;

    let rCol = gridHeight - 1;

    ctx.globalAlpha = 1;

    for (let col = 0; col < gridHeight; col++) {
      for (let row = 0; row < gridWidth; row++) {
        const data = gridData[rCol][row];
        const {
          NoWater,
          NoWalk,
          NoFly,
          NoBuild,
          Blight,
          x,
          y
        } = data;

        const drawX = (row * tileWidth);
        const drawY = (col * tileHeight);

        const canWalk = (!NoWalk && NoBuild) || NoWater || Blight;

        if (viewOptions.displayWalkGrid && canWalk) {
          ctx.strokeStyle = "#FFF";
          ctx.strokeRect(drawX, drawY, tileWidth, tileHeight);
        }

        if (viewOptions.displayWaterGrid && !NoWater) {
          ctx.strokeStyle = "#0000AA";
          ctx.strokeRect(drawX, drawY, tileWidth, tileHeight);
        }

        if (viewOptions.displayBuildGrid && NoBuild) {
          ctx.strokeStyle = "#00AA00";
          ctx.strokeRect(drawX, drawY, tileWidth, tileHeight);
        }
      }

      rCol--;
    }
  }
};

window.MapRenderer = MapRenderer;
