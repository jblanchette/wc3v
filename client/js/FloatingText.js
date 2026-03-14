
const FloatingText = class {

  constructor () {
    this.entries = [];
    this.processedKeys = new Set();
    this.lastGameTime = 0;
    this.MAX_ENTRIES = 20;
    this.iconCache = {};
  }

  _getIcon (iconId) {
    if (!iconId) return null;
    if (this.iconCache[iconId]) return this.iconCache[iconId];

    const img = new Image();
    img.src = `/assets/wc3icons/${iconId}.jpg`;
    img._loaded = false;
    img.onload = () => { img._loaded = true; };
    this.iconCache[iconId] = img;
    return img;
  }

  // style: { color, fontSize, bold, duration, icon }
  addText (text, x, y, gameTime, style = {}) {
    if (this.entries.length >= this.MAX_ENTRIES) {
      this.entries.shift();
    }

    this.entries.push({
      text,
      x,
      y,
      spawnTime: gameTime,
      duration: style.duration || 2000,
      color: style.color || '#FFFFFF',
      fontSize: style.fontSize || 13,
      bold: style.bold !== false,
      icon: style.icon ? this._getIcon(style.icon) : null
    });
  }

  reset () {
    this.entries = [];
    this.processedKeys.clear();
    this.lastGameTime = 0;
  }

  update (players, gameTime) {
    // backwards scrub — reset everything
    if (gameTime < this.lastGameTime - 500) {
      this.reset();
    }
    this.lastGameTime = gameTime;

    // expire old entries
    this.entries = this.entries.filter(e => gameTime - e.spawnTime < e.duration);

    // scan player event streams for new events to spawn
    players.forEach((player, pIdx) => {
      if (player.isNeutralPlayer) return;

      this._scanEventStream(player.eventStream, pIdx, gameTime);
      this._scanTierStream(player.tierStream, pIdx, gameTime);
    });
  }

  _scanEventStream (eventStream, playerIndex, gameTime) {
    if (!eventStream) return;

    for (let i = 0; i < eventStream.length; i++) {
      const event = eventStream[i];
      if (event.gameTime > gameTime) break;
      if (gameTime - event.gameTime > 5000) continue;

      const eventKey = `${playerIndex}-${i}`;
      if (this.processedKeys.has(eventKey)) continue;
      this.processedKeys.add(eventKey);

      this._spawnFromEvent(event);
    }
  }

  _scanTierStream (tierStream, playerIndex, gameTime) {
    if (!tierStream) return;

    for (let i = 0; i < tierStream.length; i++) {
      const tier = tierStream[i];
      if (tier.gameTime > gameTime) break;
      if (gameTime - tier.gameTime > 5000) continue;
      if (tier.tier <= 1) continue;

      const tierKey = `tier-${playerIndex}-${i}`;
      if (this.processedKeys.has(tierKey)) continue;
      this.processedKeys.add(tierKey);

      const pos = tier.position;
      if (!pos) continue;

      this.addText(`TIER ${tier.tier}`, pos.x, pos.y, tier.gameTime, {
        color: '#FFFFFF',
        fontSize: 16,
        bold: true,
        duration: 5000
      });
    }
  }

  _spawnFromEvent (event) {
    const pos = this._resolvePosition(event);
    if (!pos) return;

    const config = FloatingText.EVENT_STYLES[event.key];
    if (!config) return;

    let text = config.text;
    if (typeof text === 'function') {
      text = text(event);
    }
    if (!text) return;

    let icon = null;
    if (config.icon) {
      icon = typeof config.icon === 'function' ? config.icon(event) : config.icon;
    }

    this.addText(text, pos.x, pos.y, event.gameTime, {
      color: config.color,
      fontSize: config.fontSize,
      bold: config.bold,
      duration: config.duration,
      icon: icon
    });
  }

  _resolvePosition (event) {
    if (event.spot) return event.spot;
    // prefer caster position over target for spells (text floats above hero)
    if (event.unit && event.unit.lastPosition) return event.unit.lastPosition;
    if (event.targetPosition) return event.targetPosition;
    if (event.building && event.building.lastPosition) return event.building.lastPosition;
    return null;
  }

  render (ctx, transform, gameTime, xScale, yScale) {
    if (!this.entries.length) return;

    ctx.save();
    ctx.textBaseline = 'middle';

    this.entries.forEach(entry => {
      const elapsed = gameTime - entry.spawnTime;
      const progress = Math.min(1, elapsed / entry.duration);

      // ease-out for smooth deceleration
      const easedProgress = 1 - Math.pow(1 - progress, 2);

      // hold full alpha for first 60%, then fade out over remaining 40%
      const fadeStart = 0.6;
      const alpha = progress < fadeStart ? 1 : 1 - ((progress - fadeStart) / (1 - fadeStart));
      if (alpha <= 0) return;

      const floatY = -35 * easedProgress;

      const drawX = xScale(entry.x) + wc3v.gameScaler.middleX;
      const drawY = yScale(entry.y) + wc3v.gameScaler.middleY + floatY;

      ctx.globalAlpha = Math.max(0, alpha);
      const weight = entry.bold ? 'bold ' : '';
      ctx.font = `${weight}${entry.fontSize}px Arial`;

      const hasIcon = entry.icon && entry.icon._loaded;
      const iconSize = entry.fontSize + 4;
      const iconGap = 3;

      // measure text to center icon+text together
      const textWidth = ctx.measureText(entry.text).width;
      const totalWidth = hasIcon ? iconSize + iconGap + textWidth : textWidth;
      const startX = drawX - totalWidth / 2;

      // draw icon if available
      if (hasIcon) {
        ctx.save();
        ctx.beginPath();
        const iconX = startX;
        const iconY = drawY - iconSize / 2;
        const iconR = iconSize / 2;
        ctx.arc(iconX + iconR, drawY, iconR, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(entry.icon, iconX, iconY, iconSize, iconSize);
        ctx.restore();
        ctx.globalAlpha = Math.max(0, alpha);
      }

      // text position (shifted right if icon present)
      const textX = hasIcon ? startX + iconSize + iconGap + textWidth / 2 : drawX;
      ctx.textAlign = 'center';

      // rounded dark background
      const padX = 5;
      const padY = 3;
      const bgW = totalWidth + padX * 2;
      const bgH = entry.fontSize + padY * 2;
      const bgX = startX - padX;
      const bgY = drawY - entry.fontSize / 2 - padY;
      const radius = 3;

      ctx.globalAlpha = Math.max(0, alpha * 0.55);
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

      ctx.globalAlpha = Math.max(0, alpha);

      // colored fill
      ctx.fillStyle = entry.color;
      ctx.fillText(entry.text, textX, drawY);
    });

    ctx.restore();
  }
};

FloatingText.EVENT_STYLES = {
  'HeroLevel': {
    text: (e) => e.spell ? e.spell.displayName : 'LEVEL UP',
    icon: (e) => e.spellItemId || null,
    color: '#FFD700',
    fontSize: 14,
    bold: true,
    duration: 5000
  },
  'heroRevive': {
    text: 'REVIVED',
    color: '#00FF88',
    fontSize: 14,
    bold: true,
    duration: 4000
  },
  'expansion': {
    text: 'EXPANSION',
    color: '#FFD700',
    fontSize: 14,
    bold: true,
    duration: 5000
  },
  'spellCast': {
    text: (e) => e.spellName || null,
    icon: (e) => e.spellItemId || null,
    color: '#88CCFF',
    fontSize: 13,
    bold: true,
    duration: 3600
  },
  'research': {
    text: (e) => e.displayName || null,
    icon: (e) => e.icon || null,
    color: '#BB88FF',
    fontSize: 12,
    bold: false,
    duration: 4000
  }
};

window.FloatingText = FloatingText;
