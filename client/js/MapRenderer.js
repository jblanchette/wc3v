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

  // Note: this method mutates neutralGroup.isHidden and unit.isNeutralGroupHidden
  // on the data objects passed via mapData and players (by-reference side effects).
  renderNeutralGroups (ctx, gameTime, transform, mapData, viewOptions, gameScaler, players, teamColorMap, hoveredCampUuid) {
    const { world } = mapData;

    const {
      middleX,
      middleY,
      xScale,
      yScale
    } = gameScaler;

    const campColorMap = {
      0: '#FFF',
      1: '#eaff00'
    };

    const iconSize = 14;

    const oldFillStyle = ctx.fillStyle;
    const oldAlpha = ctx.globalAlpha;
    const oldWidth = ctx.lineWidith;

    ctx.fillStyle = "#FFF";
    ctx.strokeStyle = "#FFF";
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2.5;

    const neutralPlayer = players.find(player => {
      return player.playerId === "1042";
    });

    if (!neutralPlayer) {
      return;
    }

    const groups = Object.values(world.neutralGroups);
    const claimPaths = groups.reduce((acc, group) => {
      if (group.claimOwnerId == null) {
        return acc;
      }

      acc[group.claimOwnerId] = [];

      return acc;
    }, {});

    groups.forEach((neutralGroup, campNumber) => {
      const { bounds, claimState, claimTime, claimOwnerId, uuid, order } = neutralGroup;

      const rectWidth = (xScale(bounds.maxX) - xScale(bounds.minX));
      const rectHeight = (yScale(bounds.maxY) - yScale(bounds.minY));

      const drawX = xScale(bounds.minX) + middleX;
      const drawY = yScale(bounds.minY) + middleY;

      let claimColor = '#FFF';
      let claimColorFill = null;

      if (claimTime != null && gameTime >= claimTime) {

        if (!neutralGroup.isHidden) {
          // hide the units from rendering now that its been claimed
          neutralGroup.isHidden = true;
          neutralPlayer.units.forEach(unit => {
            if (unit.neutralGroupId === uuid) {
              unit.isNeutralGroupHidden = true;
            }
          });
        }

        if (claimState == 1) {
          claimColor = campColorMap[claimState];
          claimColorFill = campColorMap[claimState];
        }

        if (claimState > 1) {
          claimColor = teamColorMap[claimOwnerId];
          claimColorFill = teamColorMap[claimOwnerId];

          claimPaths[claimOwnerId].push({
            claimTime,
            drawX,
            drawY,
            rectWidth,
            rectHeight
          });
        }
      } else if (neutralGroup.isHidden) {
        // unhide units when scrubbing backward before claim time
        neutralGroup.isHidden = false;
        neutralPlayer.units.forEach(unit => {
          if (unit.neutralGroupId === uuid) {
            unit.isNeutralGroupHidden = false;
          }
        });
      }

      const isHovered = (uuid === hoveredCampUuid);

      if (isHovered) {
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#FFF';
      } else {
        ctx.strokeStyle = claimColor;
        if (claimColorFill) {
          ctx.globalAlpha = 0.8;
        }
      }

      ctx.beginPath();
      ctx.strokeRect(drawX, drawY, rectWidth, rectHeight);
      if (claimColorFill) {
        ctx.fillStyle = claimColorFill;
        ctx.fillRect(drawX, drawY, rectWidth, rectHeight);
      }
      ctx.fill();
      ctx.stroke();

      if (isHovered || claimColorFill) {
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 2.5;
      }

      if (claimState > 0 && claimColorFill && order) {
        const badgeX = drawX + rectWidth + 4;
        const badgeY = drawY + rectHeight + 4;
        const badgeColor = (claimState > 1) ? teamColorMap[claimOwnerId] : '#eaff00';
        Drawing.drawCampOrderBadge(ctx, `${order}`, badgeX, badgeY, badgeColor, 1);
      }
    });

    if (!viewOptions.displayCreepRoute) {
      return;
    }

    ctx.beginPath();
    Object.keys(claimPaths).forEach(teamClaimId => {
      const claimPath = claimPaths[teamClaimId].sort((a, b) => {
        return a.claimTime - b.claimTime;
      })

      claimPath.forEach((step, ind) => {
        const midX = (step.drawX + (step.rectWidth / 2));
        const midY = (step.drawY + (step.rectHeight / 2));

        if (ind == 0) {
          ctx.moveTo(midX, midY);

          return;
        }

        ctx.lineTo(midX, midY);
      });
    });
    ctx.stroke();

    ctx.fillStyle = oldFillStyle;
    ctx.globalAlpha = oldAlpha;
    ctx.lineWidth = oldWidth;
  }

  renderNeutralBuildings (ctx, transform, viewOptions, neutralBuildings, gameScaler) {
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
      const drawX = xScale(nb.x) + middleX;
      const drawY = yScale(nb.y) + middleY;
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
