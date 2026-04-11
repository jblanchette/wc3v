
const DRAW_SPOTS_PER_UNIT = 4;

// Icon cache for cargo orbit rendering
const _cargoIconCache = {};
function _getCargoIcon (itemId) {
  if (_cargoIconCache[itemId]) return _cargoIconCache[itemId];
  const img = new Image();
  img.src = `/assets/wc3icons/${itemId}.jpg`;
  img._loaded = false;
  img.onload = () => { img._loaded = true; };
  _cargoIconCache[itemId] = img;
  return img;
}

const Drawing = class {

  static drawBoxedLevel (ctx, textStr, boxX, boxY, boxWidth, boxHeight, size = 16, fontSize = 16) {
    const padding = 7;
    const drawX = (boxX + boxWidth) - size - padding;
    const drawY = (boxY + boxHeight) - size - padding;

    ctx.fillStyle = "#FFF";
    ctx.strokeStyle = "#000";
    ctx.fillRect(drawX, drawY, size, size);
    ctx.strokeRect(drawX, drawY, size, size);

    ctx.fillStyle = "#000";
    ctx.font = `${fontSize}px Arial`;
    ctx.fillText(textStr, drawX + 5, drawY + size - 1.5);

    ctx.strokeStyle = "#FFF";
  }

  static drawCampOrderBadge (ctx, order, centerX, centerY, teamColor, scale) {
    const radius = Math.max(15, 18 * scale);
    const fontSize = Math.max(15, 18 * scale);

    // outer glow ring
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + 5, 0, Math.PI * 2);
    ctx.fillStyle = teamColor || '#FFF';
    ctx.fill();

    // main circle
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#111';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = teamColor || '#FFF';
    ctx.stroke();

    // text
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#FFF';
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(order, centerX, centerY + 1);

    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  static drawDiamond (ctx, x, y, size, fillColor, strokeColor = '#000') {
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size, y);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = strokeColor;
    ctx.stroke();
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

    ctx.strokeStyle = playerColor || "#FFFC01";
    ctx.globalAlpha = decayLevel;

    // Transport outer ring
    if (unit.isTransport) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = playerColor || "#FFFC01";
      ctx.beginPath();
      ctx.arc(drawX, drawY, halfIconSize + 7, 0, Math.PI * 2, true);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    ctx.fillStyle = playerColor;
    ctx.beginPath();
    ctx.arc(drawX, drawY, halfIconSize + 3, 0, Math.PI * 2, true);
    ctx.fill();
    ctx.fillStyle = "#000";

    if (!icon) {
      return;
    }

    Drawing.drawImageCircle(ctx, icon, drawX, drawY, iconSize);

    // Cargo orbital icons for transports
    if (unit.isTransport && unit.cargoItems && unit.cargoItems.length) {
      const items = unit.cargoItems;
      const count = items.length;
      const orbitR = halfIconSize + 20;
      const cargoIconSize = 21;
      const cargoHalf = cargoIconSize / 2;
      // Start from top (-π/2), distribute evenly
      const angleStep = (Math.PI * 2) / Math.max(count, 1);
      const startAngle = -Math.PI / 2;

      ctx.globalAlpha = 1;

      for (let i = 0; i < count; i++) {
        const angle = startAngle + (i * angleStep);
        const cx = drawX + Math.cos(angle) * orbitR;
        const cy = drawY + Math.sin(angle) * orbitR;
        const cargoIcon = _getCargoIcon(items[i]);

        // Dark circle background
        ctx.fillStyle = '#000000';
        ctx.beginPath();
        ctx.arc(cx, cy, cargoHalf + 3, 0, Math.PI * 2);
        ctx.fill();

        // Draw circular icon
        if (cargoIcon && cargoIcon._loaded) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(cx, cy, cargoHalf, 0, Math.PI * 2, true);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(cargoIcon, cx - cargoHalf, cy - cargoHalf, cargoIconSize, cargoIconSize);
          ctx.restore();
        } else {
          // Fallback: colored dot
          ctx.fillStyle = playerColor || '#888';
          ctx.beginPath();
          ctx.arc(cx, cy, cargoHalf, 0, Math.PI * 2);
          ctx.fill();
        }

        // Player color border ring
        ctx.strokeStyle = playerColor || '#FFFC01';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, cargoHalf, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.globalAlpha = 1;
    ctx.strokeStyle = colorMap.black;
  }

  static drawCountBadge (ctx, count, centerX, centerY, playerColor) {
    if (count < 2) return;
    const radius = 11;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#111';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = playerColor || '#FFF';
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#FFF';
    ctx.font = 'bold 15px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(count, centerX, centerY + 0.5);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
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
