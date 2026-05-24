/*
 * TeleportFx — cinematic teleport renderer.
 *
 * Reads each player's `teleportEvents[]` (populated by the parser's
 * Player._applyTeleport) and draws a multi-layer visual against the current
 * gameTime:
 *
 *   1. GRAB RADIUS — faint dashed circle at the actual game-unit grab radius
 *      around the caster. Shows what's eligible to be pulled. (Skipped for
 *      grabRadius === 0 abilities like Blink and Staff.)
 *
 *   2. HERO RING — bright primary ring at the caster's origin (NOT
 *      path-interpolated; during the channel the parser's path may show false
 *      walking samples — the cast origin is the truthful anchor).
 *      Surrounded by a radial glow gradient. A channel-progress arc fills
 *      clockwise outside the main ring as the 3s channel completes.
 *
 *   3. UNIT RINGS — smaller secondary rings on each grabbed unit's origin.
 *      Looked up by uuid via ClientUnit.getInterpolatedPosition(castTime).
 *      Synced pulse with the hero ring so the user sees the WHOLE squad is
 *      being teleported, not just the hero.
 *
 *   4. BANNER — "⚡ SCROLL OF TOWN PORTAL  +N units" centered above the ring.
 *      Red and "✕ CANCELLED" when cancellable cast was interrupted.
 *
 *   5. ARRIVAL FLASH — at apply: a bright expanding shockwave ring at the
 *      destination + a brief inner solid flash. Bigger than v1.
 *
 *   6. TRAIL — faint dashed origin → destination line, fading over 3s post.
 *
 * Drawn on #utility-canvas (same layer as BattleRenderer + camp rings).
 */
const TeleportFx = class {
  constructor () {
    // Preload the WC3 ability/item icons used by the cinematic banner so they
    // render the first time a teleport fires (without this the banner shows
    // a missing-image gap for the first ~50ms). Mirrors MapRenderer's pattern.
    this._icons = {};
    this._iconsReady = false;
    const types = ['stwp', 'stel', 'AHmt', 'AEbl'];
    let loaded = 0;
    types.forEach(type => {
      const img = new Image();
      img.onload = () => {
        this._icons[type] = img;
        if (++loaded === types.length) this._iconsReady = true;
      };
      img.onerror = () => {
        if (++loaded === types.length) this._iconsReady = true;
      };
      img.src = `/assets/wc3icons/${type}.jpg`;
    });
  }

  render (utilityCtx, transform, gameTime, viewOptions, gameScaler, players) {
    if (!viewOptions || viewOptions.displayTeleports === false) return;
    if (!players || !players.length) return;

    const POSTROLL_MS = 3000;

    utilityCtx.save();
    const restore = {
      alpha: utilityCtx.globalAlpha,
      stroke: utilityCtx.strokeStyle,
      fill: utilityCtx.fillStyle,
      font: utilityCtx.font,
      lw: utilityCtx.lineWidth,
      dash: utilityCtx.getLineDash()
    };

    for (const player of players) {
      const tps = player.teleportEvents || [];
      if (!tps.length) continue;
      for (const tp of tps) {
        const cast = tp.gameTime;
        const apply = tp.appliedAt != null ? tp.appliedAt : (tp.gameTime + tp.channelMs);
        const fadeEnd = (tp.cancelled ? (cast + tp.channelMs) : apply) + POSTROLL_MS;
        if (gameTime < cast - 200) continue;
        if (gameTime > fadeEnd) continue;
        this._drawTeleport(utilityCtx, gameScaler, gameTime, tp, players);
      }
    }

    utilityCtx.setLineDash(restore.dash);
    utilityCtx.globalAlpha = restore.alpha;
    utilityCtx.strokeStyle = restore.stroke;
    utilityCtx.fillStyle = restore.fill;
    utilityCtx.font = restore.font;
    utilityCtx.lineWidth = restore.lw;
    utilityCtx.restore();
  }

  // Project a game-space point to canvas pixels — same recipe MapRenderer +
  // BattleRenderer use (projectXY samples 3D terrain height, then add middleX/Y).
  _proj (gameScaler, x, y) {
    const p = gameScaler.projectXY(x, y);
    return { x: p.x + gameScaler.middleX, y: p.y + gameScaler.middleY };
  }

  // Convert a game-unit radius into screen pixels at the caster's location.
  // Uses two projected points to capture per-perspective distortion correctly.
  _radiusPx (gameScaler, originX, originY, gameRadius) {
    if (!gameRadius || gameRadius <= 0) return 0;
    const a = gameScaler.projectXY(originX, originY);
    const b = gameScaler.projectXY(originX + gameRadius, originY);
    return Math.max(8, Math.abs(b.x - a.x));
  }

  // Look up a grabbed unit's position at castTime via ClientUnit's path.
  // Returns null if the unit isn't found (cross-player ID collision shouldn't
  // happen but we guard).
  _grabbedUnitPos (players, uuid, castTime) {
    for (const player of players) {
      if (!player.units) continue;
      for (const u of player.units) {
        if (u.uuid !== uuid) continue;
        if (typeof u.getInterpolatedPosition === 'function') {
          return u.getInterpolatedPosition(castTime);
        }
        // Fallback: nearest path sample by gameTime.
        const path = u.path || [];
        if (!path.length) return null;
        let best = path[0];
        let bestD = Math.abs(path[0].gameTime - castTime);
        for (const s of path) {
          const d = Math.abs(s.gameTime - castTime);
          if (d < bestD) { best = s; bestD = d; }
        }
        return { x: best.x, y: best.y };
      }
    }
    return null;
  }

  _drawTeleport (ctx, gameScaler, gameTime, tp, players) {
    const cast = tp.gameTime;
    const apply = tp.appliedAt != null ? tp.appliedAt : (tp.gameTime + tp.channelMs);
    const channelMs = Math.max(1, apply - cast);
    const inChannel = gameTime >= cast && gameTime < apply;
    const postApply = gameTime >= apply;
    const cancelled = !!tp.cancelled;

    const oPx = this._proj(gameScaler, tp.origin.x, tp.origin.y);
    const dPx = this._proj(gameScaler, tp.destination.x, tp.destination.y);

    // Grab radius from the registry (defaults below cover Scroll/MT/Blink).
    const grabRadius = tp.abilityCode === 'stwp' ? 900
                     : tp.abilityCode === 'AHmt' ? 800
                     : 0;
    const grabPx = this._radiusPx(gameScaler, tp.origin.x, tp.origin.y, grabRadius);

    // ────────────────────────────────────────────────────────────────────
    // CHANNEL phase
    // ────────────────────────────────────────────────────────────────────
    if (inChannel || (cancelled && gameTime < cast + tp.channelMs)) {
      const tProg = Math.min(1, (gameTime - cast) / channelMs);
      const color = cancelled ? '#FF6B6B' : '#FFD24A';
      const colorBright = cancelled ? '#FF8E8E' : '#FFE072';

      // 1) GRAB RADIUS — faint dashed circle showing eligibility footprint.
      if (grabPx > 30 && !cancelled) {
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = color;
        ctx.setLineDash([6, 8]);
        ctx.beginPath();
        ctx.arc(oPx.x, oPx.y, grabPx, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 2) RADIAL GLOW around the caster — soft halo that grows over the channel.
      const mainR = 60;
      const glowR = mainR * (1.6 + 0.2 * tProg);
      const glow = ctx.createRadialGradient(
        oPx.x, oPx.y, mainR * 0.4,
        oPx.x, oPx.y, glowR
      );
      glow.addColorStop(0, cancelled ? 'rgba(255, 107, 107, 0.45)' : 'rgba(255, 210, 74, 0.55)');
      glow.addColorStop(0.6, cancelled ? 'rgba(255, 107, 107, 0.15)' : 'rgba(255, 210, 74, 0.18)');
      glow.addColorStop(1, 'rgba(255, 210, 74, 0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(oPx.x, oPx.y, glowR, 0, Math.PI * 2);
      ctx.fill();

      // 3) PRIMARY RING — bold, bright.
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = 4;
      ctx.strokeStyle = colorBright;
      ctx.beginPath();
      ctx.arc(oPx.x, oPx.y, mainR, 0, Math.PI * 2);
      ctx.stroke();

      // 4) CHANNEL PROGRESS ARC — fills clockwise from 12 o'clock around the
      //    primary ring as the 3-second channel completes.
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 7;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(oPx.x, oPx.y, mainR + 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * tProg);
      ctx.stroke();

      // 5) PER-UNIT RINGS — small synced ring on each grabbed unit.
      const pulse = 0.7 + 0.3 * Math.sin((gameTime - cast) / 90);
      ctx.globalAlpha = 0.9 * pulse;
      ctx.lineWidth = 3;
      ctx.strokeStyle = colorBright;
      ctx.setLineDash([]);
      for (const uuid of (tp.grabbedUnitUuids || [])) {
        const pos = this._grabbedUnitPos(players, uuid, cast);
        if (!pos) continue;
        const gp = this._proj(gameScaler, pos.x, pos.y);
        // Skip if the unit ring would overlap the caster ring (visual clutter).
        const dx = gp.x - oPx.x;
        const dy = gp.y - oPx.y;
        if ((dx * dx + dy * dy) < (mainR * mainR * 0.5)) continue;
        ctx.beginPath();
        ctx.arc(gp.x, gp.y, 24, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 6) BANNER above the ring.
      this._drawBanner(ctx, oPx.x, oPx.y - mainR - 14, tp, cancelled);
    }

    // ────────────────────────────────────────────────────────────────────
    // ARRIVAL phase
    // ────────────────────────────────────────────────────────────────────
    if (postApply && !cancelled) {
      const since = gameTime - apply;

      // FLASH — bright expanding shockwave at destination. Multi-ring so it
      // reads as an impact, not just a single circle.
      const FLASH_MS = 1000;
      if (since <= FLASH_MS) {
        const tf = since / FLASH_MS;

        // Outer shockwave
        const ringR = 30 + 90 * tf;
        ctx.globalAlpha = 0.85 * (1 - tf);
        ctx.lineWidth = 5 * (1 - tf * 0.7);
        ctx.strokeStyle = '#FFE072';
        ctx.beginPath();
        ctx.arc(dPx.x, dPx.y, ringR, 0, Math.PI * 2);
        ctx.stroke();

        // Inner solid burst
        const innerR = 18 + 30 * tf;
        ctx.globalAlpha = 0.6 * (1 - tf);
        ctx.fillStyle = '#FFE072';
        ctx.beginPath();
        ctx.arc(dPx.x, dPx.y, innerR, 0, Math.PI * 2);
        ctx.fill();

        // Bright pinprick at center for first 250ms
        if (since < 250) {
          const tfp = since / 250;
          ctx.globalAlpha = 1 - tfp;
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(dPx.x, dPx.y, 12 * (1 - tfp * 0.4), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // TRAIL — dashed origin→destination, fading over 3s.
      const POST_TAIL_MS = 3000;
      if (since <= POST_TAIL_MS) {
        const tt = since / POST_TAIL_MS;
        ctx.globalAlpha = 0.5 * (1 - tt);
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = '#FFD24A';
        ctx.setLineDash([5, 7]);
        ctx.beginPath();
        ctx.moveTo(oPx.x, oPx.y);
        ctx.lineTo(dPx.x, dPx.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  // Larger label with a 48px WC3 icon left of the text. Two-line layout:
  //   [icon]  HEADING (cancellable status + ability name)
  //           subline (grabbed count, channel/instant)
  _drawBanner (ctx, ax, ay, tp, cancelled) {
    const iconKey = tp.abilityCode || null;
    const icon = (iconKey && this._icons[iconKey]) || null;

    const headingPrefix = cancelled ? '✕' : '⚡';
    const headingMain = tp.abilityDisplayName.toUpperCase() + (cancelled ? ' — CANCELLED' : '');
    const subLine = (() => {
      const parts = [];
      if (tp.grabbedCount > 0) {
        parts.push(`+${tp.grabbedCount} unit${tp.grabbedCount === 1 ? '' : 's'}`);
      }
      if (tp.channelMs > 0) parts.push(`${(tp.channelMs / 1000).toFixed(1)}s channel`);
      else                  parts.push('instant');
      if (tp.invulnerable && !cancelled) parts.push('invulnerable');
      return parts.join(' · ');
    })();

    const iconSize = 48;
    const headFont = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    const subFont  = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';

    ctx.font = headFont;
    const headPrefixW = ctx.measureText(headingPrefix + ' ').width;
    const headMainW   = ctx.measureText(headingMain).width;
    const headW = headPrefixW + headMainW;
    ctx.font = subFont;
    const subW = ctx.measureText(subLine).width;
    const textW = Math.max(headW, subW);

    const padX = 12, padY = 8, iconGap = 10;
    const innerH = iconSize;
    const w = padX * 2 + (icon ? iconSize + iconGap : 0) + textW;
    const h = innerH + padY * 2;
    const x = ax - w / 2;
    const y = ay - h;

    // Background block.
    ctx.globalAlpha = 0.97;
    ctx.fillStyle = 'rgba(8, 12, 18, 0.97)';
    ctx.fillRect(x, y, w, h);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = cancelled ? '#FF6B6B' : '#FFD24A';
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    // Icon — large, with a soft border so it pops on any background.
    const textX = x + padX + (icon ? iconSize + iconGap : 0);
    if (icon) {
      const ix = x + padX;
      const iy = y + padY;
      ctx.globalAlpha = cancelled ? 0.55 : 1;
      ctx.drawImage(icon, ix, iy, iconSize, iconSize);
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 2;
      ctx.strokeStyle = cancelled ? '#FF6B6B' : '#FFD24A';
      ctx.strokeRect(ix - 1, iy - 1, iconSize + 2, iconSize + 2);
    }

    // Heading line — gold/red prefix glyph then white-ish heading.
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'middle';
    ctx.font = headFont;
    const headY = y + padY + iconSize / 2 - 8;
    ctx.fillStyle = cancelled ? '#FF8E8E' : '#FFE072';
    ctx.fillText(headingPrefix + ' ', textX, headY);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(headingMain, textX + headPrefixW, headY);

    // Sub line — muted detail.
    ctx.font = subFont;
    ctx.fillStyle = '#9aa6b0';
    ctx.fillText(subLine, textX, y + padY + iconSize / 2 + 12);

    ctx.textBaseline = 'alphabetic';
  }
};

window.TeleportFx = TeleportFx;
