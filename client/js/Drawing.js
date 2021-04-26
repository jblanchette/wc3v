
const DRAW_SPOTS_PER_UNIT = 4;

const Drawing = class {

  static drawBoxedLevel (ctx, textStr, boxX, boxY, boxWidth, boxHeight, size = 10, fontSize = 10) {
    const padding = 4;
    const drawX = (boxX + boxWidth) - size - padding;
    const drawY = (boxY + boxHeight) - size - padding;

    ctx.fillStyle = "#FFF";
    ctx.strokeStyle = "#000";
    ctx.fillRect(drawX, drawY, size, size);
    ctx.strokeRect(drawX, drawY, size, size);

    ctx.fillStyle = "#000";
    ctx.font = `${fontSize}px Arial`;
    ctx.fillText(textStr, drawX + 3, drawY + size - 1.5);

    ctx.strokeStyle = "#FFF";
  }

  static drawCenteredText (ctx, drawX, drawY, textStr, fontSize = 12, fontColor) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#FFF";
      ctx.font = `${Math.ceil(fontSize)}px Arial`;
      ctx.fillText(textStr, drawX, drawY);
      ctx.font = `12px Arial`;
      ctx.fillStyle = "#000";
      ctx.textAlign = "left";
  }

  static drawImageCircle (ctx, icon, drawX, drawY, iconSize) {
    const halfIconSize = (iconSize / 2);

    if (!icon) {
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(drawX, drawY, halfIconSize, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.clip();

    // draw the icons
    ctx.drawImage(
      icon, 
      (drawX - halfIconSize), 
      (drawY - halfIconSize), 
      iconSize, 
      iconSize
    );

    // draw the icon ring
    ctx.beginPath();
    ctx.arc(drawX, drawY, halfIconSize, 0, Math.PI * 2, true);
    ctx.stroke();
    ctx.closePath();
    ctx.restore();
  }

  static drawUnit (ctx, unit) {
    const { 
      drawX, 
      drawY, 
      iconSize, 
      halfIconSize, 
      decayLevel, 
      icon, 
      playerColor 
    } = unit;

    ctx.strokeStyle = "#FFFC01";
    ctx.globalAlpha = decayLevel;

    ctx.fillStyle = playerColor;
    ctx.beginPath();
    ctx.arc(drawX, drawY, halfIconSize + 2, 0, Math.PI * 2, true);
    ctx.fill();
    ctx.fillStyle = "#000";

    if (!icon) {
      console.error("missing icon for unit: ", unit);
      return;
    }
    
    Drawing.drawImageCircle(ctx, icon, drawX, drawY, iconSize);

    ctx.globalAlpha = 1;
    ctx.strokeStyle = colorMap.black;
  }

  static getUnitBounds (unit, offsetX = 0, offsetY = 0) {
    let {
      drawX,
      drawY,
      iconSize
    } = unit;

    drawX += offsetX;
    drawY += offsetY;

    return {
      minX:     drawX - (iconSize / 2),
      maxX:     drawX + (iconSize / 2),
      minY:     drawY - (iconSize / 2),
      maxY:     drawY + (iconSize / 2),
      drawX:    drawX,
      drawY:    drawY
    };
  }

  static assignDrawSlot (unit, drawSlots, newItemId, isHero, heroRank) {
    let spot = -1;

    for (let i = 0; i <= DRAW_SPOTS_PER_UNIT; i++) {
      // found an empty slot in order
      if (!drawSlots[i]) {
        drawSlots[i] = {
          count: 1,
          itemId: newItemId
        };

        spot = i;
        break;
      }

      // found a slot with this unit
      if (drawSlots[i].itemId === newItemId) {
        drawSlots[i].count = drawSlots[i].count + 1;

        spot = i;
        break;
      }
    }

    if (spot === -1) {
      return null;
    }

    const { iconSize, halfIconSize } = unit;

    if (isHero) {
      // heroes are always drawn left + right of main hero
      return {
        xOffset: (heroRank > 2) ? iconSize : -(iconSize),
        yOffset: 0,
        spot: null
      };
    }

    // units are in one of 5 slots.  this could be a loop but i'm lazy
    // note: they are intentionally mixed order indexes so it draws the
    //       two 'inner' slots first


    /*********************************************************************
     *   drawing layout -
     *
     *                  [ 2 ] [ 1 ] [ 0 ] [ 3 ] [ 5 ]
     *
     *             ( alt hero)  ( main hero ) ( alt hero )
     *
     *********************************************************************/

    const spotMap = {
      2: { spot, xOffset: -(iconSize),                yOffset: -(iconSize) },
      1: { spot, xOffset: -(iconSize) + halfIconSize, yOffset: -(iconSize) },
      0: { spot, xOffset: 0,                          yOffset: -(iconSize) },
      3: { spot, xOffset:  (iconSize) + halfIconSize, yOffset: -(iconSize) },
      4: { spot, xOffset: -(iconSize),                yOffset: -(iconSize) }
    };

    return spotMap[spot];
  }

  static rescaleX (x, transform) {
    const range = x.range().map(transform.invertX, transform),
        domain = range.map(x.invert, x);
    return x.copy().domain(domain);
  }

  static rescaleY (y, transform) {
    const range = y.range().map(transform.invertY, transform),
        domain = range.map(y.invert, y);
    return y.copy().domain(domain);
  }
};

window.Drawing = Drawing;
