/*
 * BattleRenderer — canvas overlay for detected battles.
 *
 * Mirrors MapRenderer's stateless pattern: every render() takes all deps as
 * parameters; instance carries no per-frame state.
 *
 * Draws on `#utility-canvas` (same layer as creep camp rings) AFTER neutrals
 * so the dashed bbox sits on top of camps it overlaps with. Time-varying
 * tracker boxes are interpolated by BattleData.trackerBoxAt; we then project
 * the corners through gameScaler.projectXY (which queries the 3D scene's
 * current camera, so the box stays glued to the action under pan/zoom).
 */
const BattleRenderer = class {
  constructor () {}

  // Single-pass renderer. processedBattles is the object returned by
  // BattleData.processBattles. teamColorMap is the same { teamId: color } the
  // rest of the viewer uses, but we mostly use category color for the box.
  render (utilityCtx, transform, gameTime, viewOptions, gameScaler, processedBattles, teamColorMap) {
    if (!viewOptions || !viewOptions.displayBattles) return;
    if (!processedBattles || !processedBattles.activeAt) return;

    const active = processedBattles.activeAt(gameTime);
    if (!active.length) return;

    utilityCtx.save();
    const oldDash = utilityCtx.getLineDash();
    const oldAlpha = utilityCtx.globalAlpha;
    const oldStroke = utilityCtx.strokeStyle;
    const oldFill = utilityCtx.fillStyle;
    const oldFont = utilityCtx.font;
    const oldLineWidth = utilityCtx.lineWidth;

    for (const battle of active) {
      const box = processedBattles.trackerBoxAt(battle, gameTime);
      if (!box) continue;
      this._drawTrackerBox(utilityCtx, gameScaler, processedBattles, battle, box, gameTime);
    }

    utilityCtx.setLineDash(oldDash);
    utilityCtx.globalAlpha = oldAlpha;
    utilityCtx.strokeStyle = oldStroke;
    utilityCtx.fillStyle = oldFill;
    utilityCtx.font = oldFont;
    utilityCtx.lineWidth = oldLineWidth;
    utilityCtx.restore();
  }

  // Time envelope: fade in pre-start (PREROLL), full alpha during battle,
  // linear fade out POSTROLL. Keeps the overlay from snapping in/out.
  _envelope (battle, gameTime, processed) {
    const PRE = processed.PREROLL_MS;
    const POST = processed.POSTROLL_MS;
    if (gameTime < battle.startTime) {
      // pre-roll fade-in
      const t = 1 - (battle.startTime - gameTime) / PRE;
      return Math.max(0, Math.min(1, t));
    }
    if (gameTime > battle.endTime) {
      // post-roll fade-out
      const t = 1 - (gameTime - battle.endTime) / POST;
      return Math.max(0, Math.min(1, t));
    }
    return 1;
  }

  _drawTrackerBox (ctx, gameScaler, processed, battle, box, gameTime) {
    const middleX = gameScaler.middleX;
    const middleY = gameScaler.middleY;

    // Project the two corners. projectXY samples 3D terrain height, so under
    // perspective the box gets the same parallax the unit icons do — they
    // stay aligned even on tilted terrain.
    const a = gameScaler.projectXY(box.minX, box.minY);
    const c = gameScaler.projectXY(box.maxX, box.maxY);
    const sx = a.x + middleX, sy = a.y + middleY;
    const ex = c.x + middleX, ey = c.y + middleY;
    const x = Math.min(sx, ex);
    const y = Math.min(sy, ey);
    const w = Math.abs(ex - sx);
    const h = Math.abs(ey - sy);
    if (w < 8 || h < 8) return;   // degenerate; skip

    const alpha = this._envelope(battle, gameTime, processed);
    if (alpha <= 0.01) return;

    const color = (window.BattleCategoryColor && window.BattleCategoryColor[battle.category])
      || '#FFD166';

    // Dashed rectangle. Higher contrast than the original draft — user
    // feedback was that the box was too subtle / too faded to read on 3D
    // terrain.
    ctx.setLineDash([7, 5]);
    ctx.globalAlpha = 0.95 * alpha;
    ctx.lineWidth = (battle.category === 'pitched-battle') ? 3.2 : 2.2;
    ctx.strokeStyle = color;
    ctx.strokeRect(x, y, w, h);

    // Interior tint — lifts the box off the terrain without obscuring units.
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.12 * alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);

    // Battle banner — anchored to the top edge of the tracker box.
    //   ⚔  PITCHED-BATTLE  33.7s  ● ●     (side dots = participant team colors)
    // Side-color dots replace the forbidden single-edge category accent stripe;
    // the category itself is encoded in the dashed border + text color of the
    // banner heading. No unit icons in the banner — those live in the floating
    // info panel (bottom-right). Putting per-unit chrome over busy 3D terrain
    // competes with the gameplay; per-user feedback we keep the banner spare.
    this._drawBanner(ctx, battle, x, y, color, alpha);
  }

  _drawBanner (ctx, battle, x, y, color, alpha) {
    const dur = (battle.durationMs / 1000).toFixed(1);
    const cj = battle.creepJack ? ' ★' : '';
    const category = battle.category.toUpperCase().replace('-', ' ');
    const headLabel = `⚔ ${category}${cj}`;
    const timeLabel = `${dur}s`;

    ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    const headW = ctx.measureText(headLabel).width;

    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    const timeW = ctx.measureText(timeLabel).width;

    // Team-color dots — one per distinct teamId in participants. Distinct
    // colors taken from the global teamColorMap on Wc3vViewer; fallback to
    // neutral gray.
    const teamColors = this._participantTeamColors(battle);
    const dotR = 4;
    const dotSpacing = 4;
    const dotsW = teamColors.length > 0
      ? teamColors.length * (dotR * 2) + (teamColors.length - 1) * dotSpacing
      : 0;

    const padX = 8, padY = 5;
    const gapMid = 10;     // between head and time
    const gapDots = teamColors.length ? 10 : 0;
    const bannerW = headW + gapMid + timeW + gapDots + dotsW + padX * 2;
    const bannerH = 13 + padY * 2 + 2;
    const bannerX = x;
    const bannerY = Math.max(0, y - bannerH - 3);

    // Background — opaque enough to read on grass/forest/cliff alike.
    ctx.globalAlpha = 0.92 * alpha;
    ctx.fillStyle = 'rgba(8, 12, 18, 0.96)';
    ctx.fillRect(bannerX, bannerY, bannerW, bannerH);

    // 1px outline of category color around the banner (full border, not a
    // single-edge stripe).
    ctx.globalAlpha = 0.9 * alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(bannerX + 0.5, bannerY + 0.5, bannerW - 1, bannerH - 1);

    // Head text in category color.
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(headLabel, bannerX + padX, bannerY + bannerH / 2);

    // Duration text in muted white.
    ctx.fillStyle = '#cbd1d8';
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    ctx.fillText(timeLabel, bannerX + padX + headW + gapMid, bannerY + bannerH / 2);

    // Side-color dots.
    if (teamColors.length) {
      let dx = bannerX + padX + headW + gapMid + timeW + gapDots + dotR;
      const dy = bannerY + bannerH / 2;
      for (const tc of teamColors) {
        ctx.fillStyle = tc;
        ctx.beginPath();
        ctx.arc(dx, dy, dotR, 0, Math.PI * 2);
        ctx.fill();
        dx += dotR * 2 + dotSpacing;
      }
    }

    ctx.textBaseline = 'alphabetic';   // restore default for any later draws
  }

  // Distinct participant team colors, ordered by teamId for determinism.
  // Reads from window.wc3v.teamColorMap (the same source the rest of the
  // viewer uses). Falls back to a neutral chip if the map isn't ready.
  _participantTeamColors (battle) {
    if (!battle.participants || !battle.participants.length) return [];
    const seen = new Set();
    const teamIds = [];
    for (const p of battle.participants) {
      if (p.teamId == null) continue;
      if (seen.has(p.teamId)) continue;
      seen.add(p.teamId);
      teamIds.push(p.teamId);
    }
    teamIds.sort((a, b) => a - b);
    const map = (window.wc3v && window.wc3v.teamColorMap) || {};
    return teamIds.map(tid => map[tid] || '#888');
  }
};

window.BattleRenderer = BattleRenderer;
