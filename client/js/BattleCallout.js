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

  // Ink colours, pulled toward the viewer's warm carved register rather than
  // pure white / neon. Player and verdict colours are DATA and stay as-is.
  const COLOR_HERO    = '#E0B84A';   // tarnished gold, not #FFD43B neon
  const COLOR_SUB     = 'rgba(214, 200, 168, 0.72)';
  const COLOR_UNIT    = '#d9d2c0';
  const COLOR_EST     = 'rgba(214, 200, 168, 0.52)';
  const COLOR_STAT    = '#93A97B';   // moss, matching the --dom-green register

  // Per-line-kind metrics, as multiples of F. Kept as a lookup rather than a
  // switch so the layout pass is a flat loop. Every `size` is chosen so that
  // size * SCREEN_FONT_PX clears the project's 12.8px floor.
  //   size     — font size multiplier
  //   bold     — heavier sans weight
  //   serif    — engraved plate lettering instead of body sans
  //   tracking — letter-spacing in em
  //   lead     — line height multiplier
  //   indent   — left offset multiplier
  //   gap      — extra space ABOVE this line
  const KIND = {
    eyebrow: { size: 0.88, serif: true, tracking: 0.22, lead: 1.45, indent: 0.00, gap: 0.00 },
    title:   { size: 1.22, bold: true,  lead: 1.58, indent: 0.00, gap: 0.10 },
    sub:     { size: 0.88, bold: false, lead: 1.30, indent: 0.00, gap: 0.00 },
    side:    { size: 1.00, bold: true,  lead: 1.50, indent: 1.00, gap: 0.40 },
    hero:    { size: 1.00, bold: true,  lead: 1.34, indent: 0.95, gap: 0.00 },
    unit:    { size: 1.00, bold: false, lead: 1.34, indent: 0.95, gap: 0.00 },
    unitEst: { size: 1.00, bold: false, lead: 1.34, indent: 0.95, gap: 0.00 },
    more:    { size: 0.88, bold: false, lead: 1.28, indent: 0.95, gap: 0.00 },
    stat:    { size: 0.88, bold: false, lead: 1.34, indent: 0.95, gap: 0.00 }
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
      this._baked = [];         // LRU of models holding a baked plate bitmap
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
      for (const m of this._baked) { m._bmp = null; m._w.rq = -1; }
      this._baked.length = 0;
      for (const m of this._models) {
        m._solvedAt = -1;
        m._anchorX = 0; m._anchorY = 0;
        m._offX = 0; m._offY = 0;
        m._slideX = 0; m._slideY = 0;
        m._slideAt = -1;
      }
    }

    // ------------------------------------------------------------------
    // Layout — runs only when the canvas->CSS ratio changes (resize,
    // fullscreen, layout-mode switch), never per frame.
    // ------------------------------------------------------------------

    _layout (ctx, model, F, rq) {
      const w = model._w;
      if (w.rq === rq) return;

      const FP = window.ForgedPanel;
      const padX = Math.round(F * 0.85);
      const padY = Math.round(F * 0.62);

      let maxContent = 0;
      let y = padY;

      for (let i = 0; i < model.lines.length; i++) {
        const line = model.lines[i];
        const k = KIND[line.kind] || KIND.unit;
        const px = Math.ceil(F * k.size);
        const lead = Math.round(F * k.lead);
        const indent = Math.round(F * k.indent);
        const gap = i === 0 ? 0 : Math.round(F * k.gap);

        // Measured through the same helper that paints, so layout and paint
        // can never disagree about a serif or a tracked string.
        const tw = FP.measure(ctx, line.text, px, {
          serif: k.serif, tracking: k.tracking, weight: k.bold ? 800 : 500
        });
        if (indent + tw > maxContent) maxContent = indent + tw;

        // Cached per line; these objects already exist and are mutated in
        // place, not reallocated.
        line._px = px;
        line._bold = !!k.bold;
        line._indent = indent;
        line._y = y + gap + lead / 2;
        y += gap + lead;
      }

      const minW = F * 15, maxW = F * 27;
      w.rq = rq;
      w.padX = padX;
      w.padY = padY;
      w.w = Math.round(Math.max(minW, Math.min(maxW, padX * 2 + maxContent)));
      w.h = Math.round(y + padY);
      // Chamfer, not a corner radius — a cut corner reads as a machined plate.
      w.radius = Math.round(F * 0.62);
      w.border = Math.max(2, Math.round(F * 0.13));
      w.swatch = Math.round(F * 0.52);

      this._bake(model, F);
    }

    /**
     * Render the whole plate — chassis, studs, every line of type — into an
     * offscreen bitmap ONCE per (battle, ratio).
     *
     * The box's content never changes; only where it sits and how faded it is.
     * Baking means the carved material costs nothing per frame: a frame is one
     * drawImage plus the leader line, instead of a gradient fill, a pattern
     * fill, four radial gradients and ~20 fillText. It is also what keeps the
     * per-frame allocation count at zero — createLinearGradient and
     * createRadialGradient both allocate, and four studs per banner per frame
     * would have been ~360 short-lived gradient objects a second.
     */
    _bake (model, F) {
      const w = model._w;
      const FP = window.ForgedPanel;
      const cv = model._bmp || (model._bmp = document.createElement('canvas'));
      cv.width = w.w;
      cv.height = w.h;
      const g = cv.getContext('2d');
      g.clearRect(0, 0, w.w, w.h);

      // Cast plate. The verdict colour is carried by a FULL PERIMETER border
      // plus a full-area wash — a coloured bar along one edge is forbidden in
      // this project, canvas included.
      FP.chassis(g, 0, 0, w.w, w.h, {
        chamfer: w.radius,
        border: model.rim || '#6d5a35',
        borderWidth: w.border,
        // A warm wash, not a player-colour one — the plate is metal; the
        // fight's colour belongs on the verdict word and the side rivets.
        tint: model.rim || '#6d5a35',
        tintAlpha: 0.06
      });

      const sr = Math.max(1.6, F * 0.15);
      const si = w.radius + F * 0.20;
      FP.stud(g, si, si, sr);
      FP.stud(g, w.w - si, si, sr);
      FP.stud(g, si, w.h - si, sr);
      FP.stud(g, w.w - si, w.h - si, sr);

      const lines = model.lines;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const tx = w.padX + line._indent;
        const ty = line._y;

        if (line.kind === 'eyebrow') {
          FP.engrave(g, line.text, tx, ty, line._px, { tracking: 0.22 });
          // Hairline rule running out from the wordmark to the plate edge.
          const tw = FP.measure(g, line.text, line._px, { serif: true, tracking: 0.22 });
          const rx0 = tx + tw + F * 0.5;
          const rx1 = w.w - w.padX;
          if (rx1 > rx0) {
            g.fillStyle = 'rgba(0, 0, 0, 0.55)';
            g.fillRect(rx0, Math.round(ty), rx1 - rx0, 1);
            g.fillStyle = 'rgba(201, 187, 150, 0.13)';
            g.fillRect(rx0, Math.round(ty) + 1, rx1 - rx0, 1);
          }
        } else if (line.kind === 'side') {
          // Small leading rivet. A dot is the sanctioned alternative to the
          // forbidden edge stripe.
          FP.stud(g, w.padX + w.swatch / 2, ty, w.swatch / 2);
          FP.inked(g, line.text, tx, ty, line._px, line.color, { weight: 800, tracking: 0.02 });
        } else {
          FP.inked(g, line.text, tx, ty, line._px, line.color,
                   { weight: line._bold ? 800 : 500 });
        }
      }

      // Keep only the few most recently baked plates. A long match can detect
      // 30+ battles and each bitmap is a few hundred KB; at most two are ever
      // on screen at once.
      const lru = this._baked;
      const at = lru.indexOf(model);
      if (at >= 0) lru.splice(at, 1);
      lru.push(model);
      while (lru.length > 4) {
        const old = lru.shift();
        if (old !== model) { old._bmp = null; old._w.rq = -1; }
      }
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
      const FP = window.ForgedPanel;

      ctx.globalAlpha = alpha;

      // Leader line back to the fight — the box can be pushed well away from
      // its anchor now, so without this the link is lost. Drawn as a cut line
      // (black backing, bone over it) rather than a coloured beam.
      const lx = Math.max(x, Math.min(ax, x + w.w));
      const ly = Math.max(y, Math.min(ay, y + w.h));
      if (lx !== ax || ly !== ay) {
        ctx.lineCap = 'round';
        ctx.globalAlpha = alpha * 0.75;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = Math.max(2, F * 0.20);
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(ax, ay); ctx.stroke();
        ctx.globalAlpha = alpha * 0.55;
        ctx.strokeStyle = FP.COLORS.bone;
        ctx.lineWidth = Math.max(1, F * 0.09);
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(ax, ay); ctx.stroke();
        // Struck rivet at the fight itself.
        ctx.globalAlpha = alpha;
        FP.stud(ctx, ax, ay, Math.max(2, F * 0.24));
      }

      // The plate itself: one blit of the bitmap baked in _bake(). Everything
      // carved about it — chassis, grain, studs, engraved type — was drawn
      // once, at load or on a resize.
      if (model._bmp) ctx.drawImage(model._bmp, x, y);
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
