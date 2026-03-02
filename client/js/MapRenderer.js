const MapRenderer = class {
  constructor () {}

  renderMapBackground (ctx, transform, viewOptions, gameScaler, mapImage, gridMapImage) {
    const {
      mapExtent,
      middleX,
      middleY,
      xScale,
      yScale,
      viewWidth,
      viewHeight,
      sceneWidth,
      sceneHeight
    } = gameScaler;

    const { width, height } = mapImage;
    const { x, y, k } = transform;

    const drawX = (transform.x + xScale(mapExtent.x[0]) + middleX);
    const drawY = (transform.y + yScale(mapExtent.y[0]) + middleY);

    const bgImage = viewOptions.displayMapGrid ?
      gridMapImage : mapImage;

    const offsetX = 0;//(viewWidth - sceneWidth) / 2;
    const offsetY = 0;//(viewHeight - sceneHeight) / 2;

    ctx.drawImage(
      bgImage,
      offsetX,               // sourceX
      offsetY,               // sourceY
      viewWidth,           // sourceWidth
      viewHeight,          // sourceHeight
      drawX + offsetX,           // destX
      drawY + offsetY,           // destY
      viewWidth * k,       // destWidth
      viewHeight * k       // destHeight
    );
  }

  renderMapTrees (ctx, transform, viewOptions, doodadData, gameScaler) {
    const {
      middleX,
      middleY,
      xScale,
      yScale
    } = gameScaler;

    if (!viewOptions.displayTreeGrid) {
      return;
    }

    const treeSize = (6 * transform.k);
    const treeRadius = Math.min(8, Math.max(3.5, treeSize));

    const oldFillStyle = ctx.fillStyle;
    const oldAlpha = ctx.globalAlpha;

    ctx.fillStyle = "#013f01";
    ctx.strokeStyle = "#906739";
    ctx.globalAlpha = 0.65;

    doodadData.forEach((tree, treeIndex) => {
      const { flags, position, scale } = tree;
      const { solid, visible } = flags;
      const { x, y } = position;

      // drawing algo:
      // x = GameScaler.xScale(x) + middleX
      // y = GameScaler.yScale(y) + middleY
      // finally -
      // (x * transform.k) + transform.x
      // (y * transform.k) + transform.y

      const scaledSize = (8 * scale[0]) * transform.k;
      const halfSize = scaledSize / 2;

      const drawX = ((xScale(x) + middleX) * transform.k) + transform.x;
      const drawY = ((yScale(y) + middleY) * transform.k) + transform.y;

      //ctx.fillRect(drawX, drawY, scaledSize, scaledSize);

      ctx.beginPath();
      ctx.arc(drawX + halfSize, drawY + halfSize, scaledSize, 0, Math.PI * 2, true);
      ctx.fill();
      ctx.stroke();
    });

    ctx.fillStyle = oldFillStyle;
    ctx.globalAlpha = oldAlpha;
  }

  // Note: this method mutates neutralGroup.isHidden and unit.isNeutralGroupHidden
  // on the data objects passed via mapData and players (by-reference side effects).
  renderNeutralGroups (ctx, gameTime, transform, mapData, viewOptions, gameScaler, players, teamColorMap) {
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

    const iconSize = (14 * transform.k);

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

      const drawX = ((xScale(bounds.minX) + middleX) * transform.k) + transform.x;
      const drawY = ((yScale(bounds.minY) + middleY) * transform.k) + transform.y;

      let claimColor = colorMap[0];
      let claimColorFill = null;

      if (gameTime >= claimTime) {

        if (!neutralGroup.isHidden) {
          // hide the units from rendering now that its been claimed
          neutralGroup.isHidden = true;
          neutralPlayer.units.forEach(unit => {
            if (unit.neutralGroupId === uuid) {
              unit.isNeutralGroupHidden = true;
            }
          });
        }

        claimColor = campColorMap[claimState];

        if (claimState == 1) {
          claimColorFill = campColorMap[claimState];
        }

        if (claimState > 1) {
          claimColorFill = teamColorMap[claimOwnerId];

          claimPaths[claimOwnerId].push({
            claimTime,
            drawX,
            drawY,
            rectWidth,
            rectHeight
          });
        }
      }

      ctx.strokeStyle = claimColor;

      ctx.beginPath();
      ctx.strokeRect(drawX, drawY, rectWidth, rectHeight);
      if (claimColorFill) {
        ctx.fillStyle = claimColorFill;
        ctx.fillRect(drawX, drawY, rectWidth, rectHeight);
      }
      ctx.fill();
      ctx.stroke();

      if (claimState > 0 && claimColorFill) {
        Drawing.drawBoxedLevel(ctx, `${order}`, drawX - 8, drawY - 24, 30, 30, 20, 20);
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

    const tileHeight = (height / gridHeight) * transform.k;
    const tileWidth  = (width  / gridWidth)  * transform.k;

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

        const drawX = (row * tileWidth) + transform.x;
        const drawY = (col * tileHeight) + transform.y;

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
