
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
      playerColor,
      isHero,
      isInBattle
    } = unit;

    const safeColor = playerColor || "#FFFC01";
    const isIllusion = !!unit.isIllusion;
    ctx.globalAlpha = decayLevel;

    // Transport outer ring sits outside the identity halo.
    if (unit.isTransport) {
      ctx.lineWidth = 4;
      ctx.strokeStyle = safeColor;
      ctx.beginPath();
      ctx.arc(drawX, drawY, halfIconSize + 9, 0, Math.PI * 2, true);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // Player-color identity halo. Brighter when the unit is participating
    // in the currently-active detected battle — "spotlight on the fighters".
    const haloAlpha = (isInBattle ? 1.0 : 0.85) * decayLevel;
    ctx.globalAlpha = haloAlpha;
    ctx.fillStyle = safeColor;
    ctx.beginPath();
    ctx.arc(drawX, drawY, halfIconSize + 6, 0, Math.PI * 2, true);
    ctx.fill();

    // Illusions (Mirror Image, etc.) get a distinct cyan DASHED ring instead
    // of the gold hero ring — immediately legible as "not the real unit". The
    // real hero keeps its solid gold accent.
    if (isIllusion) {
      ctx.globalAlpha = Math.min(1, decayLevel + 0.15);
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = '#33E1FF';
      ctx.beginPath();
      ctx.arc(drawX, drawY, halfIconSize + 6.5, 0, Math.PI * 2, true);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    } else if (isHero) {
      // Heroes get a thin gold accent ring just outside the player-color halo.
      ctx.globalAlpha = decayLevel;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#FFD24A';
      ctx.beginPath();
      ctx.arc(drawX, drawY, halfIconSize + 6.5, 0, Math.PI * 2, true);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // Dark gasket kills the icon's anti-aliased edge bleeding into the
    // colored halo and gives the ring a crisp inner border.
    ctx.globalAlpha = decayLevel;
    ctx.fillStyle = '#0d0d10';
    ctx.beginPath();
    ctx.arc(drawX, drawY, halfIconSize + 2, 0, Math.PI * 2, true);
    ctx.fill();

    ctx.fillStyle = "#000";

    if (!icon) {
      return;
    }

    Drawing.drawImageCircle(ctx, icon, drawX, drawY, iconSize);

    // Illusion treatment: a translucent cyan wash over the icon (ghostly,
    // "not real") plus a bold "I" badge so it's unmistakable even at a glance
    // or when zoomed out. Drawn over the icon, under nameplates.
    if (isIllusion) {
      ctx.save();
      // cyan wash, clipped to the icon circle
      ctx.globalAlpha = 0.30 * decayLevel;
      ctx.beginPath();
      ctx.arc(drawX, drawY, halfIconSize, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.fillStyle = '#33E1FF';
      ctx.fillRect(drawX - halfIconSize, drawY - halfIconSize, iconSize, iconSize);
      ctx.restore();

      // "I" badge at the top-left of the icon.
      const badgeR = Math.max(8, halfIconSize * 0.62);
      const bx = drawX - halfIconSize - badgeR * 0.15;
      const by = drawY - halfIconSize - badgeR * 0.15;
      ctx.save();
      ctx.globalAlpha = decayLevel;
      ctx.beginPath();
      ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
      ctx.fillStyle = '#0A2A33';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#33E1FF';
      ctx.stroke();
      ctx.fillStyle = '#EAFBFF';
      ctx.font = `bold ${Math.round(badgeR * 1.5)}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('I', bx, by + 0.5);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.restore();
    }

    // Shadowmeld ghost overlay: dashed white outline + "HIDE" tag. Only
    // applies when server's HideInference flagged the unit hidden NOW.
    if (unit.isHidden) {
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#E8F4FF';
      ctx.beginPath();
      ctx.arc(drawX, drawY, halfIconSize + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // Small "HIDE" tag below the icon.
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillText('HIDE', drawX + 1, drawY + halfIconSize + 3);
      ctx.fillStyle = '#E8F4FF';
      ctx.fillText('HIDE', drawX, drawY + halfIconSize + 2);
      ctx.restore();
    }

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

  // One-shot death FX: an expanding player-colored ring + floating label
  // anchored at the unit's last known position. `ageMs` is gameTime since
  // the FX began, `durationMs` is the full window. ageMs may be slightly out
  // of [0, durationMs] under fast scrubbing; we clamp.
  static drawDeathFx (ctx, fx) {
    const {
      x, y, ageMs, durationMs, iconSize, playerColor, label, isHero,
      richDeath, xpAwarded
    } = fx;
    const t = Math.max(0, Math.min(1, ageMs / durationMs));
    const halfIcon = iconSize / 2;

    ctx.save();

    // Red flash overlay — only for richDeath (server-confirmed lost unit).
    // Brief burst that peaks early then fades. Communicates "this unit took
    // lethal damage" the way WC3's red hurt flash does.
    if (richDeath) {
      const flashAlpha = Math.max(0, (1 - t * 3)) * 0.75;
      if (flashAlpha > 0.01) {
        ctx.globalAlpha = flashAlpha;
        ctx.fillStyle = '#FF2A2A';
        ctx.beginPath();
        ctx.arc(x, y, halfIcon * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Expanding ring: starts at icon edge, grows ~1.5x icon size. Alpha
    // peaks mid-window then fades out. Rich death uses a thicker, redder ring.
    const ringR = halfIcon + (iconSize * (richDeath ? 1.1 : 0.85)) * t;
    const ringAlpha = (1 - Math.abs(t - 0.35) / 0.65) * 0.85;
    if (ringAlpha > 0.01) {
      ctx.globalAlpha = Math.max(0, Math.min(1, ringAlpha));
      ctx.lineWidth = isHero ? 5 : (richDeath ? 4 : 3);
      ctx.strokeStyle = richDeath ? '#FF5252' : (playerColor || '#FF5252');
      ctx.beginPath();
      ctx.arc(x, y, ringR, 0, Math.PI * 2);
      ctx.stroke();

      // Player-color inner ring so attribution is visible even on rich-death.
      if (richDeath && playerColor) {
        ctx.globalAlpha = Math.max(0, Math.min(1, ringAlpha * 0.6));
        ctx.lineWidth = 2;
        ctx.strokeStyle = playerColor;
        ctx.beginPath();
        ctx.arc(x, y, ringR * 0.7, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Inner darkening disc to imply the unit is "gone" — fades fastest.
      const discAlpha = (1 - t) * 0.35;
      if (discAlpha > 0.01) {
        ctx.globalAlpha = discAlpha;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(x, y, halfIcon, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Green XP popup — drifts up like WC3's "+N" text on hero kill. Only for
    // rich (server-confirmed) deaths so we don't spam every heuristic stale-fade.
    if (richDeath && xpAwarded > 0) {
      const drift = 36 * t;
      const xpY = y - halfIcon - 28 - drift;
      const xpAlpha = Math.max(0, 1 - t * 1.2);
      ctx.globalAlpha = xpAlpha;
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Black shadow for legibility on any background.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.fillText('+' + xpAwarded, x + 1, xpY + 1);
      ctx.fillStyle = '#33FF55';
      ctx.fillText('+' + xpAwarded, x, xpY);
    }

    // Floating label drifts upward and fades. Heroes use larger, redder text.
    if (label) {
      const drift = 24 * t;
      const labelY = y - halfIcon - 12 - drift;
      const labelAlpha = Math.max(0, 1 - t * 1.1);
      ctx.globalAlpha = labelAlpha;
      ctx.font = isHero ? 'bold 14px sans-serif' : 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const tw = ctx.measureText(label).width + 12;
      const th = isHero ? 20 : 18;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(x - tw / 2, labelY - th / 2, tw, th);

      ctx.fillStyle = isHero ? '#FF6B6B' : '#FFD7D7';
      ctx.fillText(label, x, labelY);
    }

    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  static drawCountBadge (ctx, count, centerX, centerY, playerColor) {
    if (count < 2) return;
    const radius = 11;
    ctx.save();

    // Solid player-color disc with a dark outline for legibility on any terrain.
    // Carries player identity onto stacked groups (Lich x3, Mortar Team x2)
    // which are the densest information in a battle.
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = playerColor || '#444';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0d0d10';
    ctx.stroke();

    // Number — white with a soft black shadow so it stays readable over the
    // lighter player colors (yellow, teal, light blue, pink).
    ctx.globalAlpha = 1;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 2;
    ctx.fillStyle = '#FFF';
    ctx.font = 'bold 15px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(count, centerX, centerY + 0.5);
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';

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
    // True-collision unit icons can shrink to ~4px for Footmen — using that
    // as the layout step would collapse hero rank decorations on top of each
    // other. LAYOUT_ICON_STEP is a fixed UI step that keeps the rank chips
    // visually separated even when the underlying unit icon is tiny.
    const LAYOUT_ICON_STEP = 36;
    const step = Math.max(iconSize, LAYOUT_ICON_STEP);
    const halfStep = step / 2;

    if (isHero) {
      // heroes are always drawn left + right of main hero
      return {
        xOffset: (heroRank > 2) ? step : -(step),
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
      2: { spot, xOffset: -(step),            yOffset: -(step) },
      1: { spot, xOffset: -(step) + halfStep, yOffset: -(step) },
      0: { spot, xOffset: 0,                  yOffset: -(step) },
      3: { spot, xOffset:  (step) + halfStep, yOffset: -(step) },
      4: { spot, xOffset: -(step),            yOffset: -(step) }
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
