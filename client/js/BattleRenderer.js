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

    // Dashed rectangle.
    ctx.setLineDash([6, 4]);
    ctx.globalAlpha = 0.45 * alpha;
    ctx.lineWidth = (battle.category === 'pitched-battle') ? 2.5 : 1.6;
    ctx.strokeStyle = color;
    ctx.strokeRect(x, y, w, h);

    // Faint interior tint so the box reads on busy minimap.
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.06 * alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);

    // Label chip in upper-left. Category + duration; creep-jack flag uses ★.
    const dur = (battle.durationMs / 1000).toFixed(1);
    const cj = battle.creepJack ? ' ★' : '';
    const label = `${battle.category}${cj}  ${dur}s`;
    ctx.font = 'bold 11px Arial, sans-serif';
    const textW = ctx.measureText(label).width;
    const padX = 5, padY = 2;
    const chipW = textW + padX * 2;
    const chipH = 14 + padY * 2;
    const chipX = x;
    const chipY = Math.max(0, y - chipH - 2);

    ctx.globalAlpha = 0.78 * alpha;
    ctx.fillStyle = 'rgba(10, 14, 20, 0.92)';
    ctx.fillRect(chipX, chipY, chipW, chipH);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(chipX, chipY, 3, chipH);  // category-color accent strip
    ctx.fillStyle = '#e8eaed';
    ctx.fillText(label, chipX + padX, chipY + chipH - padY - 3);
  }
};

window.BattleRenderer = BattleRenderer;
