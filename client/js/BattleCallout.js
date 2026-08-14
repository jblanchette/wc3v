/**
 * BattleCallout — the transient on-canvas box that summarises a fight the
 * moment it ends. Draws on #action-canvas (L5), above unit icons and
 * nameplates. See client/docs/Z_INDEX.md.
 *
 * Split out of BattleReportRenderer, which keeps the persistent Battles-tab
 * panel and stays the ONE place that decides what a fight means: it hands us
 * a finished, immutable model per battle (verdict, engagement type, canonical
 * names, assembled strings) via setBattles(). Nothing here re-derives fight
 * semantics.
 *
 * Two things the old inline banner got wrong, both fixed here:
 *
 *  1. SIZE. #action-canvas works in LOGICAL space — the map image, 1568-2240px
 *     — which is then CSS-downscaled with object-fit:contain. Drawing "12px"
 *     there lands at ~4-6 CSS px on screen. Every dimension below derives from
 *     `F = SCREEN_FONT_PX * ratio` where ratio is canvasMetrics().sx, exactly
 *     as BaseNameplateRenderer._drawPlate does, so the box is a constant
 *     on-screen size on every map.
 *
 *  2. COST. The old banner rebuilt its whole layout every frame (~12 object
 *     literals + a dozen string concats + fresh font literals, 60fps, for 4
 *     seconds per fight). Here the content is built once at load, text widths
 *     are cached against a quantized ratio (so they recompute on resize only),
 *     and placement is solved on a 200ms tick with hysteresis. Steady state is
 *     zero allocations, zero measureText, zero layout reads per frame.
 */

(function () {
  // Window, relative to battle.endTime. Unchanged from the old banner.
  const DELAY_MS    = 600;
  const DURATION_MS = 4000;
  const FADE_MS     = 600;

  // On-screen type scale. 15 vs BaseNameplateRenderer's 11: a base label is
  // ambient chrome you read at leisure, a fight callout is a 4-second read.
  // Every derived size below keeps the project's 12.8px floor with headroom.
  const SCREEN_FONT_PX = 15;

  // Placement search. 6 directions x 3 distances, fixed order so the result is
  // deterministic (no Math.random anywhere on a render path).
  const DIR_X = [0, -0.85, 0.85, -1, 1, 0];
  const DIR_Y = [-1, -0.85, -0.85, 0, 0, 1];
  const DIST  = [1.0, 1.55, 2.2];

  // Re-solve placement at most this often; between solves the cached offset
  // just rides the anchor, so a camera pan costs no solver work at all.
  const SOLVE_INTERVAL_MS = 200;
  // ...unless the anchor jumped, in which case re-solve immediately.
  const SOLVE_MOVE_F = 1.5;      // multiples of F
  // Slide to a new solution rather than snapping to it.
  const SLIDE_MS = 180;

  // Cap the rbush hits we score per candidate. A dense base can put dozens of
  // icons under one box; the first two dozen already say "this is crowded".
  const MAX_HITS = 24;

  const EDGE_INSET = 8;

  const COLOR_BG      = 'rgba(12, 12, 18, 0.90)';
  const COLOR_BORDER  = 'rgba(255, 255, 255, 0.18)';
  const COLOR_HERO    = '#FFD43B';
  const COLOR_SUB     = 'rgba(255, 255, 255, 0.72)';
  const COLOR_UNIT    = '#FFFFFF';
  const COLOR_EST     = 'rgba(255, 255, 255, 0.58)';
  const COLOR_STAT    = '#8AE890';

  // Per-line-kind metrics, as multiples of F. Kept as a lookup rather than a
  // switch so the layout pass is a flat loop.
  //   size   — font size multiplier
  //   bold   — font weight
  //   lead   — line height multiplier
  //   indent — left offset multiplier
  //   gap    — extra space ABOVE this line
  const KIND = {
    title:   { size: 1.25, bold: true,  lead: 1.72, indent: 0.00, gap: 0.00 },
    sub:     { size: 0.88, bold: false, lead: 1.28, indent: 0.00, gap: 0.00 },
    side:    { size: 1.00, bold: true,  lead: 1.50, indent: 1.00, gap: 0.38 },
    hero:    { size: 1.00, bold: true,  lead: 1.34, indent: 0.90, gap: 0.00 },
    unit:    { size: 1.00, bold: false, lead: 1.34, indent: 0.90, gap: 0.00 },
    unitEst: { size: 1.00, bold: false, lead: 1.34, indent: 0.90, gap: 0.00 },
    more:    { size: 0.88, bold: false, lead: 1.28, indent: 0.90, gap: 0.00 },
    stat:    { size: 0.88, bold: false, lead: 1.34, indent: 0.90, gap: 0.00 }
  };

  class BattleCallout {
    constructor (viewer) {
      this.viewer = viewer;
      this._models = [];
      this._cursor = 0;
      this._lastT = -1;

      // Reused every frame — never reallocated.
      this._proj = { x: 0, y: 0 };
      this._queryBox = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      this._placed = [];        // pooled AABBs of banners drawn THIS frame
      this._placedN = 0;
      // Memoized `bold ${n}px Arial` / `${n}px Arial` strings. Font assignment
      // is one of the pricier 2D state changes and the old banner built a
      // fresh literal for it on every line of every frame.
      this._fontCache = new Map();
    }

    // Models come pre-built from BattleReportRenderer.setBattles — see the
    // shape documented there. Must be sorted by t0 ascending.
    setBattles (models) {
      this._models = models || [];
      this.reset();
    }

    reset () {
      this._cursor = 0;
      this._lastT = -1;
      for (const m of this._models) {
        m._solvedAt = -1;
        m._anchorX = 0; m._anchorY = 0;
        m._offX = 0; m._offY = 0;
        m._slideX = 0; m._slideY = 0;
        m._slideAt = -1;
      }
    }

    _font (px, bold) {
      const key = bold ? -px : px;
      let s = this._fontCache.get(key);
      if (s === undefined) {
        s = (bold ? 'bold ' : '') + px + 'px Arial';
        this._fontCache.set(key, s);
      }
      return s;
    }

    // ------------------------------------------------------------------
    // Layout — runs only when the canvas->CSS ratio changes (resize,
    // fullscreen, layout-mode switch), never per frame.
    // ------------------------------------------------------------------

    _layout (ctx, model, F, rq) {
      const w = model._w;
      if (w.rq === rq) return;

      const padX = Math.round(F * 0.80);
      const padY = Math.round(F * 0.55);
      const accentH = Math.round(F * 0.26);

      let maxContent = 0;
      let y = padY + accentH;

      for (let i = 0; i < model.lines.length; i++) {
        const line = model.lines[i];
        const k = KIND[line.kind] || KIND.unit;
        const px = Math.ceil(F * k.size);
        const lead = Math.round(F * k.lead);
        const indent = Math.round(F * k.indent);
        const gap = i === 0 ? 0 : Math.round(F * k.gap);

        ctx.font = this._font(px, k.bold);
        const tw = ctx.measureText(line.text).width;
        if (indent + tw > maxContent) maxContent = indent + tw;

        // Cached per line, parallel arrays would save nothing here — these
        // objects already exist and are mutated in place, not reallocated.
        line._px = px;
        line._bold = k.bold;
        line._indent = indent;
        line._y = y + gap + lead / 2;
        y += gap + lead;
      }

      const minW = F * 14, maxW = F * 26;
      w.rq = rq;
      w.padX = padX;
      w.padY = padY;
      w.accentH = accentH;
      w.w = Math.round(Math.max(minW, Math.min(maxW, padX * 2 + maxContent)));
      w.h = Math.round(y + padY);
      w.radius = Math.round(F * 0.42);
      w.border = Math.max(1, F * 0.13);
      w.swatch = Math.round(F * 0.60);
    }

    // ------------------------------------------------------------------
    // Placement
    // ------------------------------------------------------------------

    // Overlap cost of a box against this frame's obstacles. Unit icons count
    // 1x, already-placed nameplates 3x — covering a name is worse than
    // covering a sprite the player can still see around the edges of.
    _obstacleCost (frameData, x, y, w, h, viewOptions) {
      const q = this._queryBox;
      q.minX = x; q.minY = y; q.maxX = x + w; q.maxY = y + h;

      let cost = 0;
      const tree = frameData && frameData.nameplateTree;
      // The tree is only LOADED when unit names are on (app.js gates
      // buildNameplateBoxes/renderAllNameplates on viewOptions.displayText).
      // With names off it is empty, so fall back to a linear scan of the draw
      // positions — bounded by on-screen unit count, and only on a solve tick.
      const useTree = tree && viewOptions && viewOptions.displayText;

      if (useTree) {
        const hits = tree.search(q);
        const n = Math.min(hits.length, MAX_HITS);
        for (let i = 0; i < n; i++) {
          const hit = hits[i];
          const ow = Math.min(q.maxX, hit.maxX) - Math.max(q.minX, hit.minX);
          const oh = Math.min(q.maxY, hit.maxY) - Math.max(q.minY, hit.minY);
          if (ow <= 0 || oh <= 0) continue;
          cost += ow * oh * (hit.isObstacle ? 1 : 3);
        }
      } else if (frameData && frameData.unitDrawPositions) {
        const list = frameData.unitDrawPositions;
        for (let i = 0; i < list.length; i++) {
          const u = list[i];
          const r = u.iconSize / 2;
          const ow = Math.min(q.maxX, u.x + r) - Math.max(q.minX, u.x - r);
          const oh = Math.min(q.maxY, u.y + r) - Math.max(q.minY, u.y - r);
          if (ow > 0 && oh > 0) cost += ow * oh;
        }
      }

      // Banners already placed this frame.
      for (let i = 0; i < this._placedN; i++) {
        const p = this._placed[i];
        const ow = Math.min(q.maxX, p.maxX) - Math.max(q.minX, p.minX);
        const oh = Math.min(q.maxY, p.maxY) - Math.max(q.minY, p.minY);
        if (ow > 0 && oh > 0) cost += 1e5;
      }

      return cost;
    }

    // Solve an offset (relative to the anchor) for the box's top-left corner.
    // Writes model._offX/_offY.
    _solve (model, ax, ay, F, frameData, viewOptions, logicalW, logicalH) {
      const w = model._w;
      const stride = w.h + F * 2.4;

      let bestCost = Infinity;
      let bestX = -w.w / 2;
      let bestY = -w.h - F * 2.4;

      for (let d = 0; d < DIST.length; d++) {
        const reach = stride * DIST[d];
        for (let i = 0; i < DIR_X.length; i++) {
          const offX = DIR_X[i] * reach - w.w / 2;
          const offY = DIR_Y[i] * reach - w.h / 2;
          const x = ax + offX;
          const y = ay + offY;

          // Mild preference for the earliest candidate (straight up, close)
          // so near-ties don't wander between frames.
          let cost = 60 * (d * DIR_X.length + i);

          if (x < EDGE_INSET || y < EDGE_INSET ||
              x + w.w > logicalW - EDGE_INSET || y + w.h > logicalH - EDGE_INSET) {
            cost += 1e6;
          }
          cost += this._obstacleCost(frameData, x, y, w.w, w.h, viewOptions);

          if (cost < bestCost) {
            bestCost = cost;
            bestX = offX;
            bestY = offY;
            if (cost === 0) { d = DIST.length; break; }   // perfect fit, stop
          }
        }
      }

      model._offX = bestX;
      model._offY = bestY;
    }

    // ------------------------------------------------------------------
    // Per frame
    // ------------------------------------------------------------------

    render (ctx, gameTime, gameScaler, frameData, viewOptions) {
      const models = this._models;
      if (!models.length || !ctx || !gameScaler) return;

      // Forward-only cursor over models sorted by t0. Backward scrub rewinds.
      if (gameTime < this._lastT) this._cursor = 0;
      this._lastT = gameTime;
      while (this._cursor < models.length && models[this._cursor].t1 < gameTime) {
        this._cursor++;
      }

      // Same ratio derivation as BaseNameplateRenderer.render — served from
      // GameScaler's per-frame metrics cache, so no layout read here.
      let ratio = 1;
      const m = gameScaler.canvasMetrics ? gameScaler.canvasMetrics(ctx.canvas) : null;
      if (m && m.ok) {
        ratio = m.sx;
      } else {
        const cw = ctx.canvas.clientWidth;
        const lw = gameScaler.logicalWidth || ctx.canvas.width;
        if (cw > 0 && Number.isFinite(cw)) ratio = lw / cw;
      }

      const F = SCREEN_FONT_PX * ratio;
      // Quantized so ordinary sub-pixel jitter in the CSS box doesn't
      // invalidate the width cache.
      const rq = Math.round(ratio * 32) / 32;

      const logicalW = gameScaler.logicalWidth || ctx.canvas.width;
      const logicalH = gameScaler.logicalHeight || ctx.canvas.height;
      const now = (typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now();

      this._placedN = 0;

      let saved = false;
      for (let i = this._cursor; i < models.length; i++) {
        const model = models[i];
        if (model.t0 > gameTime) break;        // sorted — nothing later is active
        if (model.t1 < gameTime) continue;

        const age = gameTime - model.t0;
        let alpha = 1;
        if (age < FADE_MS) alpha = age / FADE_MS;
        else if (age > DURATION_MS - FADE_MS) alpha = (DURATION_MS - age) / FADE_MS;
        if (alpha < 0.02) continue;
        if (alpha > 1) alpha = 1;

        const proj = gameScaler.projectXYInto(model.cx, model.cy, this._proj);
        // null = behind the camera / outside the frustum. There is no honest
        // screen direction for such a point, so an edge arrow would point
        // confidently wrong — disappear instead. Merely off-canvas but
        // projectable anchors still get clamped in below.
        if (!proj) continue;
        const ax = proj.x + gameScaler.middleX;
        const ay = proj.y + gameScaler.middleY;
        if (!Number.isFinite(ax) || !Number.isFinite(ay)) continue;

        if (!saved) { ctx.save(); saved = true; }
        this._layout(ctx, model, F, rq);

        const moved = Math.abs(ax - model._anchorX) + Math.abs(ay - model._anchorY);
        if (model._solvedAt < 0 ||
            (now - model._solvedAt) > SOLVE_INTERVAL_MS ||
            moved > F * SOLVE_MOVE_F) {
          const prevX = model._offX, prevY = model._offY;
          this._solve(model, ax, ay, F, frameData, viewOptions, logicalW, logicalH);
          if (model._solvedAt >= 0 && (prevX !== model._offX || prevY !== model._offY)) {
            model._slideX = prevX; model._slideY = prevY;
            model._slideAt = now;
          }
          model._solvedAt = now;
        }
        model._anchorX = ax;
        model._anchorY = ay;

        // Slide toward a freshly-solved offset instead of snapping.
        let offX = model._offX, offY = model._offY;
        if (model._slideAt >= 0) {
          const u = (now - model._slideAt) / SLIDE_MS;
          if (u >= 1) model._slideAt = -1;
          else {
            const e = u * u * (3 - 2 * u);
            offX = model._slideX + (offX - model._slideX) * e;
            offY = model._slideY + (offY - model._slideY) * e;
          }
        }

        const w = model._w;
        let bx = Math.round(ax + offX);
        let by = Math.round(ay + offY);
        // Clamp fully into the canvas.
        if (bx < EDGE_INSET) bx = EDGE_INSET;
        if (by < EDGE_INSET) by = EDGE_INSET;
        if (bx + w.w > logicalW - EDGE_INSET) bx = logicalW - EDGE_INSET - w.w;
        if (by + w.h > logicalH - EDGE_INSET) by = logicalH - EDGE_INSET - w.h;

        this._draw(ctx, model, bx, by, ax, ay, alpha, F);

        // Register so later banners this frame avoid it.
        let rect = this._placed[this._placedN];
        if (!rect) rect = this._placed[this._placedN] = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        rect.minX = bx; rect.minY = by;
        rect.maxX = bx + w.w; rect.maxY = by + w.h;
        this._placedN++;
      }

      if (saved) ctx.restore();
    }

    _draw (ctx, model, x, y, ax, ay, alpha, F) {
      const w = model._w;
      const accent = model.accent;

      ctx.globalAlpha = alpha;

      // Leader line back to the fight — the box can be pushed well away from
      // its anchor now, so without this the link is lost.
      const lx = Math.max(x, Math.min(ax, x + w.w));
      const ly = Math.max(y, Math.min(ay, y + w.h));
      if (lx !== ax || ly !== ay) {
        ctx.globalAlpha = alpha * 0.45;
        ctx.strokeStyle = accent;
        ctx.lineWidth = Math.max(1, F * 0.13);
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(ax, ay);
        ctx.stroke();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(ax, ay, F * 0.22, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = alpha;
      }

      // Plate.
      ctx.fillStyle = COLOR_BG;
      Drawing.roundedRectPath(ctx, x, y, w.w, w.h, w.radius);
      ctx.fill();
      ctx.strokeStyle = COLOR_BORDER;
      ctx.lineWidth = w.border;
      Drawing.roundedRectPath(ctx, x + w.border / 2, y + w.border / 2,
                              w.w - w.border, w.h - w.border, w.radius);
      ctx.stroke();

      // Accent rule along the top — gold when a hero died, else the winning
      // side's colour. Clipped to the plate so it keeps the rounded corners.
      ctx.save();
      Drawing.roundedRectPath(ctx, x, y, w.w, w.h, w.radius);
      ctx.clip();
      ctx.fillStyle = accent;
      ctx.fillRect(x, y, w.w, w.accentH);
      ctx.restore();

      // Lines.
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const lines = model.lines;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        ctx.font = this._font(line._px, line._bold);
        const tx = x + w.padX + line._indent;
        const ty = y + line._y;

        if (line.kind === 'side') {
          // Colour swatch in the left gutter the indent reserves.
          ctx.fillStyle = line.color || '#888';
          const s = w.swatch;
          Drawing.roundedRectPath(ctx, x + w.padX, ty - s / 2, s, s, Math.max(1, s * 0.28));
          ctx.fill();
          ctx.fillStyle = line.color || '#FFF';
        } else {
          ctx.fillStyle = line.color;
        }
        ctx.fillText(line.text, tx, ty);
      }
    }
  }

  // Exposed so BattleReportRenderer builds models against the same window.
  BattleCallout.DELAY_MS = DELAY_MS;
  BattleCallout.DURATION_MS = DURATION_MS;
  BattleCallout.COLOR_HERO = COLOR_HERO;
  BattleCallout.COLOR_SUB = COLOR_SUB;
  BattleCallout.COLOR_UNIT = COLOR_UNIT;
  BattleCallout.COLOR_EST = COLOR_EST;
  BattleCallout.COLOR_STAT = COLOR_STAT;

  window.BattleCallout = BattleCallout;
})();
