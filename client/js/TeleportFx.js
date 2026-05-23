/*
 * TeleportFx — canvas overlay rendering teleport-scroll-class casts as a
 * cinematic moment on the map.
 *
 * Reads each player's `teleportEvents[]` (populated by the parser's
 * Player._applyTeleport). For each event we draw three phases against the
 * current gameTime:
 *
 *   1. CHANNEL (cast → apply)
 *      A pulsing yellow ring at the caster's origin (NOT their interpolated
 *      path position — during the channel the parser's path may show false
 *      walking samples; the cast origin is the truthful anchor). A second,
 *      smaller ring on each grabbed unit's origin position.
 *      Above the caster: a "⚡ TELEPORT SCROLL" banner with the ability name
 *      and a count of grabbed units.
 *
 *   2. ARRIVAL FLASH (apply → apply+800ms)
 *      A bright expanding circle at the destination, fades quickly. Conveys
 *      "this is where they landed".
 *
 *   3. POST (apply+800 → apply+3000ms)
 *      A faint trail line origin→destination, fading out. Helps the eye trace
 *      what happened if the user scrubs past quickly.
 *
 * Cancelled casts (cancellable abilities interrupted by stun/silence) get the
 * channel ring but no arrival flash; a red "✕ CANCELLED" tag replaces the
 * normal banner near the end of the channel window.
 *
 * Drawn on `#utility-canvas` (same layer as BattleRenderer + camp rings).
 */
const TeleportFx = class {
  constructor () {
    // Reuse the same icons BattleRenderer loaded (no duplicate fetches).
    // The actual lookup happens at render time via window.wc3v.battleRenderer._icons.
  }

  // gameTime in ms, gameScaler: standard, processedBattles: optional but we
  // don't strictly need it. players is the array of ClientPlayer used by
  // Wc3vViewer.
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
      const tps = (player.raw && player.raw.teleportEvents) || player.teleportEvents || [];
      if (!tps.length) continue;
      for (const tp of tps) {
        // Visibility window: cast time → apply (+postroll) for normal, or
        // cast → cast+channel for cancelled.
        const cast = tp.gameTime;
        const apply = tp.appliedAt != null ? tp.appliedAt : (tp.gameTime + tp.channelMs);
        const fadeEnd = (tp.cancelled ? (cast + tp.channelMs) : apply) + POSTROLL_MS;
        if (gameTime < cast - 200) continue;
        if (gameTime > fadeEnd) continue;
        this._drawTeleport(utilityCtx, gameScaler, gameTime, tp);
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

  _drawTeleport (ctx, gameScaler, gameTime, tp) {
    const middleX = gameScaler.middleX;
    const middleY = gameScaler.middleY;
    const proj = (x, y) => {
      const p = gameScaler.projectXY(x, y);
      return { x: p.x + middleX, y: p.y + middleY };
    };

    const cast = tp.gameTime;
    const apply = tp.appliedAt != null ? tp.appliedAt : (tp.gameTime + tp.channelMs);
    const channelMs = Math.max(1, apply - cast);

    const inChannel = gameTime >= cast && gameTime < apply;
    const postApply = gameTime >= apply;
    const cancelled = !!tp.cancelled;

    const oPx = proj(tp.origin.x, tp.origin.y);
    const dPx = proj(tp.destination.x, tp.destination.y);

    // --- Channel ring at origin --------------------------------------------
    if (inChannel || (cancelled && gameTime < cast + tp.channelMs)) {
      const t = Math.min(1, (gameTime - cast) / channelMs);
      // Pulsing radius: 38px ± a bit of breathing.
      const r = 32 + 6 * Math.sin((gameTime - cast) / 80);
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 3;
      ctx.strokeStyle = cancelled ? '#FF6B6B' : '#FFD24A';
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(oPx.x, oPx.y, r, 0, Math.PI * 2);
      ctx.stroke();
      // Inner fill — fills as channel progresses (winds up like an hourglass).
      ctx.globalAlpha = 0.15 + 0.25 * t;
      ctx.fillStyle = cancelled ? '#FF6B6B' : '#FFD24A';
      ctx.beginPath();
      ctx.arc(oPx.x, oPx.y, r * 0.75, 0, Math.PI * 2);
      ctx.fill();

      // Banner above the caster.
      this._drawBanner(ctx, oPx.x, oPx.y - r - 6, tp, cancelled, t);
    }

    // --- Arrival flash at destination --------------------------------------
    if (postApply && !cancelled) {
      const since = gameTime - apply;
      const FLASH_MS = 800;
      if (since <= FLASH_MS) {
        const tf = since / FLASH_MS;          // 0 → 1
        const r = 16 + 56 * tf;
        ctx.globalAlpha = 0.85 * (1 - tf);
        ctx.lineWidth = 4 * (1 - tf * 0.5);
        ctx.strokeStyle = '#FFE072';
        ctx.beginPath();
        ctx.arc(dPx.x, dPx.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.5 * (1 - tf);
        ctx.fillStyle = '#FFE072';
        ctx.beginPath();
        ctx.arc(dPx.x, dPx.y, r * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // --- Faint trail line origin → destination ---------------------------
      const POST_TAIL_MS = 3000;
      if (since <= POST_TAIL_MS) {
        const tt = since / POST_TAIL_MS;       // 0 → 1
        ctx.globalAlpha = 0.4 * (1 - tt);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#FFD24A';
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(oPx.x, oPx.y);
        ctx.lineTo(dPx.x, dPx.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  _drawBanner (ctx, ax, ay, tp, cancelled, t) {
    const label = cancelled
      ? `✕ ${tp.abilityDisplayName.toUpperCase()} CANCELLED`
      : `⚡ ${tp.abilityDisplayName.toUpperCase()}`;
    const sub = tp.grabbedCount > 0
      ? `+${tp.grabbedCount} unit${tp.grabbedCount === 1 ? '' : 's'}`
      : '';

    ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    const labelW = ctx.measureText(label).width;
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    const subW = sub ? ctx.measureText(sub).width : 0;

    const padX = 8, padY = 4;
    const gap = sub ? 8 : 0;
    const w = padX * 2 + labelW + gap + subW;
    const h = 17 + padY * 2;
    const x = ax - w / 2;
    const y = ay - h;

    ctx.globalAlpha = 0.95;
    ctx.fillStyle = 'rgba(8, 12, 18, 0.96)';
    ctx.fillRect(x, y, w, h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = cancelled ? '#FF6B6B' : '#FFD24A';
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    ctx.textBaseline = 'middle';
    ctx.fillStyle = cancelled ? '#FF8E8E' : '#FFE072';
    ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    ctx.fillText(label, x + padX, y + h / 2);
    if (sub) {
      ctx.fillStyle = '#cbd1d8';
      ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
      ctx.fillText(sub, x + padX + labelW + gap, y + h / 2);
    }
    ctx.textBaseline = 'alphabetic';
  }
};

window.TeleportFx = TeleportFx;
