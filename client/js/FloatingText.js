
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
      duration: style.duration || 3000,
      color: style.color || '#FFFFFF',
      fontSize: style.fontSize || 13,
      bold: style.bold !== false,
      icon: style.icon ? this._getIcon(style.icon) : null,
      label: style.label || null,
      labelColor: style.labelColor || style.color || '#FFFFFF',
      borderColor: style.borderColor || null,
      borderWidth: style.borderWidth || 1.5,
      bgTint: style.bgTint || null,
      fadeStart: style.fadeStart || 0.65
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
      if (gameTime - event.gameTime > 8000) continue;

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
      if (gameTime - tier.gameTime > 8000) continue;
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
        duration: 7000,
        label: 'UPGRADE',
        labelColor: '#AAAAAA',
        borderColor: '#FFFFFF',
        fadeStart: 0.70
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

    // resolve icon: prefer event.icon (real FourCC), fall back to spellItemId
    let icon = null;
    if (config.icon) {
      icon = typeof config.icon === 'function' ? config.icon(event) : config.icon;
    }

    let label = config.label || null;
    if (typeof label === 'function') {
      label = label(event);
    }

    this.addText(text, pos.x, pos.y, event.gameTime, {
      color: config.color,
      fontSize: config.fontSize,
      bold: config.bold,
      duration: config.duration,
      icon: icon,
      label: label,
      labelColor: config.labelColor || config.color,
      borderColor: config.borderColor || config.color,
      borderWidth: config.borderWidth || 1.5,
      bgTint: config.bgTint || null,
      fadeStart: config.fadeStart || 0.65
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

  _roundRect (ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  render (ctx, transform, gameTime, xScale, yScale) {
    if (!this.entries.length) return;

    ctx.save();

    this.entries.forEach(entry => {
      const elapsed = gameTime - entry.spawnTime;
      const progress = Math.min(1, elapsed / entry.duration);

      // ease-out for smooth deceleration
      const easedProgress = 1 - Math.pow(1 - progress, 2);

      // per-entry fade start
      const fadeStart = entry.fadeStart || 0.65;
      const alpha = progress < fadeStart ? 1 : 1 - ((progress - fadeStart) / (1 - fadeStart));
      if (alpha <= 0) return;

      const floatY = -40 * easedProgress;

      const drawX = xScale(entry.x) + wc3v.gameScaler.middleX;
      const drawY = yScale(entry.y) + wc3v.gameScaler.middleY + floatY;

      ctx.globalAlpha = Math.max(0, alpha);

      const hasLabel = !!entry.label;
      const hasIcon = entry.icon && entry.icon._loaded;

      // --- measure dimensions ---
      const labelFontSize = 10;
      const mainWeight = entry.bold ? 'bold ' : '';
      ctx.font = `${mainWeight}${entry.fontSize}px Arial`;
      const mainTextWidth = ctx.measureText(entry.text).width;

      const iconSize = entry.fontSize + 6;
      const iconGap = 5;
      const mainRowWidth = hasIcon ? iconSize + iconGap + mainTextWidth : mainTextWidth;

      let labelWidth = 0;
      if (hasLabel) {
        ctx.font = `bold ${labelFontSize}px Arial`;
        labelWidth = ctx.measureText(entry.label).width;
      }

      const contentWidth = Math.max(mainRowWidth, labelWidth);
      const padX = 8;
      const padY = hasLabel ? 5 : 4;
      const labelGap = hasLabel ? 2 : 0;
      const labelHeight = hasLabel ? labelFontSize + 2 : 0;
      const mainHeight = entry.fontSize;

      const bgW = padX + contentWidth + padX;
      const bgH = padY + labelHeight + labelGap + mainHeight + padY;
      const bgX = drawX - bgW / 2;
      const bgY = drawY - bgH / 2;
      const radius = 4;

      // --- dark background pill ---
      ctx.globalAlpha = Math.max(0, alpha * 0.65);
      ctx.fillStyle = '#111';
      this._roundRect(ctx, bgX, bgY, bgW, bgH, radius);
      ctx.fill();

      // --- colored background tint (level-ups, etc.) ---
      if (entry.bgTint) {
        ctx.globalAlpha = Math.max(0, alpha * 0.2);
        ctx.fillStyle = entry.bgTint;
        this._roundRect(ctx, bgX, bgY, bgW, bgH, radius);
        ctx.fill();
      }

      // --- full border ---
      if (entry.borderColor) {
        ctx.globalAlpha = Math.max(0, alpha * 0.7);
        ctx.strokeStyle = entry.borderColor;
        ctx.lineWidth = entry.borderWidth || 1.5;
        this._roundRect(ctx, bgX, bgY, bgW, bgH, radius);
        ctx.stroke();
      }

      ctx.globalAlpha = Math.max(0, alpha);
      const contentX = bgX + padX;

      // --- label line (small uppercase) ---
      if (hasLabel) {
        ctx.font = `bold ${labelFontSize}px Arial`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = entry.labelColor;
        ctx.fillText(entry.label, contentX, bgY + padY);
      }

      // --- main row (icon + text) ---
      const mainY = bgY + padY + labelHeight + labelGap + mainHeight / 2;
      ctx.font = `${mainWeight}${entry.fontSize}px Arial`;
      ctx.textBaseline = 'middle';

      if (hasIcon) {
        ctx.save();
        ctx.beginPath();
        const iconX = contentX;
        const iconY = mainY - iconSize / 2;
        const iconR = iconSize / 2;
        ctx.arc(iconX + iconR, mainY, iconR, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(entry.icon, iconX, iconY, iconSize, iconSize);
        ctx.restore();
        ctx.globalAlpha = Math.max(0, alpha);

        ctx.textAlign = 'left';
        ctx.fillStyle = entry.color;
        ctx.fillText(entry.text, contentX + iconSize + iconGap, mainY);
      } else {
        ctx.textAlign = 'left';
        ctx.fillStyle = entry.color;
        ctx.fillText(entry.text, contentX, mainY);
      }
    });

    ctx.restore();
  }
};

FloatingText.EVENT_STYLES = {
  'HeroLevel': {
    text: (e) => {
      const spellName = e.spell ? e.spell.displayName : 'Skill';
      const level = e.spell ? e.spell.level : '';
      return level ? `${spellName} [${level}]` : spellName;
    },
    label: (e) => `SKILL LEARNED — LEVEL ${e.newLevel || ''}`,
    icon: (e) => e.spellItemId || null,
    color: '#FFD700',
    labelColor: '#FFD700',
    borderColor: '#FFD700',
    borderWidth: 2,
    bgTint: '#FFD700',
    fontSize: 14,
    bold: true,
    duration: 6500,
    fadeStart: 0.70
  },
  'heroRevive': {
    text: 'REVIVED',
    label: 'HERO',
    color: '#00FF88',
    labelColor: '#00DD77',
    borderColor: '#00FF88',
    fontSize: 14,
    bold: true,
    duration: 5500,
    fadeStart: 0.65
  },
  'expansion': {
    text: 'EXPANSION',
    label: 'BASE',
    color: '#FFD700',
    labelColor: '#DDAA00',
    borderColor: '#FFD700',
    fontSize: 14,
    bold: true,
    duration: 6500,
    fadeStart: 0.70
  },
  'spellCast': {
    text: (e) => e.spellName || (e.unit ? e.unit.displayName : null),
    label: (e) => e.isUnitSpell ? 'ABILITY' : 'SPELL CAST',
    icon: (e) => e.icon || e.spellItemId || null,
    color: '#88CCFF',
    labelColor: '#6699CC',
    borderColor: '#88CCFF',
    fontSize: 13,
    bold: true,
    duration: 5000,
    fadeStart: 0.65
  },
  'research': {
    text: (e) => e.displayName || null,
    label: (e) => {
      if (e.category === 'attack') return 'ATTACK UPGRADE';
      if (e.category === 'defense') return 'DEFENSE UPGRADE';
      return 'RESEARCH';
    },
    icon: (e) => e.icon || null,
    color: '#BB88FF',
    labelColor: '#9966DD',
    borderColor: '#BB88FF',
    fontSize: 12,
    bold: false,
    duration: 5500,
    fadeStart: 0.65
  },
  'autocastToggle': {
    text: (e) => e.spellName || null,
    label: (e) => e.state === 'on' ? 'AUTOCAST ON' : 'AUTOCAST OFF',
    icon: (e) => e.icon || e.spellItemId || null,
    color: '#FFAA44',
    labelColor: '#CC8833',
    borderColor: '#FFAA44',
    fontSize: 12,
    bold: false,
    duration: 3500,
    fadeStart: 0.60
  },
  'addUnit': {
    text: (e) => (!e.unit || !e.unit.isHero) ? null : e.unit.displayName,
    label: 'TRAINING HERO',
    icon: (e) => e.unit ? e.unit.itemId : null,
    color: '#FFD700',
    labelColor: '#DDAA00',
    borderColor: '#FFD700',
    fontSize: 13,
    bold: true,
    duration: 5000,
    fadeStart: 0.65
  },
  'formToggle': {
    text: (e) => {
      const name = e.spellName || 'Form Change';
      return e.state === 'off' ? `${name} OFF` : name;
    },
    label: 'FORM CHANGE',
    icon: (e) => e.icon || e.spellItemId || null,
    color: '#44DDAA',
    labelColor: '#33AA88',
    borderColor: '#44DDAA',
    fontSize: 12,
    bold: false,
    duration: 3500,
    fadeStart: 0.60
  }
};

window.FloatingText = FloatingText;
