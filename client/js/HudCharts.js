/**
 * HudCharts — the always-on match graphs pinned to the bottom-centre of the
 * viewer, just above the scrubber. Two stacked rows:
 *
 *   1. Dominance — the 0-100 momentum split, as HISTORY. No numeric readout:
 *      DominanceBar (under the match header) owns the current value, and
 *      showing the same number twice on one screen is noise.
 *   2. Food — supply used per player, with the WC3 upkeep lines at 50 and 80.
 *
 * These used to be SVG charts inside a BottomPanel tab that is collapsed by
 * default and whose per-frame cursor updates were gated off whenever it was
 * hidden — so in practice nobody ever saw them.
 *
 * WHY ITS OWN CANVAS. The five map canvases work in LOGICAL space (the map
 * image, 1568-2240px) and are CSS-downscaled with object-fit:contain, so they
 * letterbox and their text needs an sx correction to stay legible. This canvas
 * is sized in REAL CSS PIXELS x DPR and positioned by CSS against #main-wrapper,
 * so 1 unit here is 1 CSS pixel, text is crisp, and "10px above the scrubber"
 * means exactly that. It is a sibling of #canvas-group, never a child — that
 * container carries the live-mode transform and the letterbox box.
 *
 * PER-FRAME COST. Everything static — panel chrome, axes, gridlines, row
 * titles, and BOTH players' full polylines — is rasterized once into two
 * offscreen bitmaps at build/resize time. A frame is:
 *
 *     clearRect, drawImage(chrome), clip, drawImage(bright), 2x fillRect, 2x fillText
 *
 * with zero allocations, zero measureText and zero layout reads. Progressive
 * reveal is a clip on the second blit, not a path rebuild.
 */

(function () {
  const PAD_X = 8;
  const PAD_Y = 6;
  // 88, not 66: "DOMINANCE" at bold 12.8px Arial measures ~78px and was
  // running into the plot. Sized to the longest title with a little slack.
  const LABEL_W = 88;      // left gutter: row title
  const VALUE_W = 76;      // right gutter: readouts
  const ROW_H = 38;
  const ROW_GAP = 8;

  const TITLE_PX = 12.8;   // the project's minimum readable size, exactly
  const VALUE_PX = 14;

  // Below this the label gutter is dropped and titles draw inline over the
  // plot; below the second, the HUD hides rather than render something unreadable.
  const NARROW_W = 460;
  const MIN_W = 360;

  // 0.94, not 0.90: at 0.90 the terrain reads through the plate enough to
  // fight the lines over the bright grass this map is mostly made of.
  const BG        = 'rgba(12, 12, 18, 0.94)';
  const BORDER    = 'rgba(255, 255, 255, 0.16)';
  const AXIS      = 'rgba(255, 255, 255, 0.16)';
  const GRID      = 'rgba(255, 255, 255, 0.10)';
  const MID       = 'rgba(255, 255, 255, 0.26)';
  const TITLE_COL = 'rgba(255, 255, 255, 0.62)';
  const CURSOR    = '#FFD43B';

  const FAINT_ALPHA = 0.22;   // the not-yet-played portion of every line

  // WC3 upkeep thresholds. Real reference lines, not decoration: crossing 50
  // costs 30% of gold income and crossing 80 costs 60%.
  const UPKEEP_LOW = 50;
  const UPKEEP_HIGH = 80;

  class HudCharts {
    constructor (viewer) {
      this.viewer = viewer;
      this.canvas = null;
      this.ctx = null;
      this._ro = null;

      this._dom = null;        // [{ id, color, samples }]
      this._food = null;       // [{ id, color, series }]
      this._startT = 0;
      this._endT = 0;

      this._rows = [];         // built layout, one entry per visible row
      this._bmpChrome = null;
      this._bmpBright = null;

      this._cssW = 0;
      this._cssH = 0;
      this._dpr = 1;
      this._built = false;
      this._dirty = true;
      this._visible = false;
      this._lastT = -1;

      // Zero-allocation integer formatting for the food readouts. Supply caps
      // at 100; 201 covers any oddity without a String() on the render path.
      this._nums = null;
    }

    // ------------------------------------------------------------------
    // Setup
    // ------------------------------------------------------------------

    mount () {
      // The wrapper owns the positioning; the canvas just fills it. Sizing a
      // <canvas> directly with left/right insets does not work — it is a
      // REPLACED element, so `width:auto` resolves from its intrinsic 300x150
      // ratio and the insets are dropped. See main.css #hud-charts.
      this.wrap = document.getElementById('hud-charts');
      this.canvas = document.getElementById('hud-charts-canvas');
      if (!this.canvas || !this.wrap) return false;
      this.ctx = this.canvas.getContext('2d');

      // ResizeObserver entries carry a POST-LAYOUT rect, so reading size here
      // never forces a reflow. This class must never touch clientWidth — see
      // GameScaler.beginFrame for what that costs mid-frame.
      if (typeof ResizeObserver !== 'undefined') {
        this._ro = new ResizeObserver(entries => {
          const e = entries[entries.length - 1];
          if (!e) return;
          const r = e.contentRect;
          this._resize(r.width, r.height);
        });
        this._ro.observe(this.canvas);
      }
      return true;
    }

    // dominanceInfos: [{ id, color, samples:[{t,score}] }] — pass null/[] to
    //   omit the dominance row (non-1v1, or no dominance data).
    // foodInfos: [{ id, color, series:[{t,foodUsed,foodMax}] }]
    setPlayers (dominanceInfos, foodInfos) {
      this._dom = (dominanceInfos && dominanceInfos.length >= 2) ? dominanceInfos : null;
      this._food = (foodInfos && foodInfos.length) ? foodInfos : null;
      this._built = false;
      this._dirty = true;
    }

    // Trim the flat opening so the interesting part of the match gets the width.
    setStart (tMs) {
      this._startT = tMs > 0 ? tMs : 0;
      this._built = false;
      this._dirty = true;
    }

    setVisible (on) {
      this._visible = !!on;
      if (this.wrap) this.wrap.classList.toggle('hud-on', this._visible);
      this._dirty = true;
    }

    invalidate () {
      this._built = false;
      this._dirty = true;
    }

    destroy () {
      if (this._ro) { this._ro.disconnect(); this._ro = null; }
      // The bitmaps are the only large allocation here and the viewer rebuilds
      // its subsystems on every replay load, so dropping them matters.
      this._bmpChrome = null;
      this._bmpBright = null;
      this._rows.length = 0;
      this._built = false;
      if (this.wrap) this.wrap.classList.remove('hud-on');
    }

    _resize (cssW, cssH) {
      if (!(cssW > 0) || !(cssH > 0)) return;
      if (Math.abs(cssW - this._cssW) < 0.5 && Math.abs(cssH - this._cssH) < 0.5) return;
      this._cssW = cssW;
      this._cssH = cssH;
      this._built = false;
      this._dirty = true;
    }

    // ------------------------------------------------------------------
    // Build — runs on first draw and on a real resize. Never per frame.
    // ------------------------------------------------------------------

    build () {
      const cssW = this._cssW, cssH = this._cssH;
      if (!this.ctx || !(cssW > 0) || !(cssH > 0)) return false;
      if (!this._dom && !this._food) return false;
      if (cssW < MIN_W) return false;

      const cfg = (window.WC3V_CONFIG && window.WC3V_CONFIG.perf) || {};
      // NOT canvasRenderDprCap (1.0). That cap exists because the five map
      // canvases are viewport-sized and rasterized every frame five times over,
      // where retina supersampling is pure fill-rate loss. This canvas is
      // <=600x96 CSS px and is rasterized ONCE into a bitmap; legibility is the
      // whole point of the feature. 2 rather than uncapped so a 3x phone panel
      // doesn't pay 2.25x for a difference nobody can see.
      const cap = (typeof cfg.hudChartsDpr === 'number' && cfg.hudChartsDpr > 0)
        ? cfg.hudChartsDpr : 2;
      const dpr = Math.min((window.devicePixelRatio || 1), cap);
      this._dpr = dpr;

      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);

      const labelW = cssW < NARROW_W ? 0 : LABEL_W;
      const plotX = PAD_X + labelW;
      const plotW = Math.max(40, cssW - plotX - VALUE_W - PAD_X);

      // Time domain — shared by both rows so the two cursors line up.
      this._endT = this._matchEnd();
      if (!(this._endT > this._startT)) this._endT = this._startT + 1;

      this._rows.length = 0;
      let y = PAD_Y;
      if (this._dom) {
        this._rows.push(this._buildDomRow(plotX, y, plotW, ROW_H, labelW));
        y += ROW_H + ROW_GAP;
      }
      if (this._food) {
        this._rows.push(this._buildFoodRow(plotX, y, plotW, ROW_H, labelW));
        y += ROW_H + ROW_GAP;
      }
      if (!this._rows.length) return false;

      if (!this._nums) {
        this._nums = new Array(201);
        for (let i = 0; i <= 200; i++) this._nums[i] = String(i);
      }
      this._paintBitmaps(cssW, cssH, dpr);
      this._built = true;
      this._dirty = true;
      return true;
    }

    _matchEnd () {
      let end = 0;
      if (this._dom) {
        for (const p of this._dom) {
          const s = p.samples;
          if (s && s.length) end = Math.max(end, s[s.length - 1].t);
        }
      }
      if (this._food) {
        for (const p of this._food) {
          const s = p.series;
          if (s && s.length) end = Math.max(end, s[s.length - 1].t);
        }
      }
      const mt = this.viewer && this.viewer.matchEndTime;
      if (mt > end) end = mt;
      return end;
    }

    _buildDomRow (x, y, w, h, labelW) {
      // Same fitted band DominanceChart uses (padded, symmetric-ish about 50,
      // min span 30) — a hard 0-100 axis flattens a game that lived in 40-60.
      let lo = 50, hi = 50;
      for (const p of this._dom) {
        for (const s of p.samples) {
          if (s.score < lo) lo = s.score;
          if (s.score > hi) hi = s.score;
        }
      }
      const yMin = Math.max(0, Math.min(35, Math.floor(lo - 5)));
      const yMax = Math.min(100, Math.max(65, Math.ceil(hi + 5)));
      return {
        kind: 'dom', title: 'DOMINANCE', x, y, w, h, labelW,
        yMin, yMax,
        series: this._dom.map(p => ({ color: p.color, pts: p.samples, key: 'score' })),
        readout: false,
        guides: [{ v: 50, color: MID, dash: true }]
      };
    }

    _buildFoodRow (x, y, w, h, labelW) {
      // Fixed to the WHOLE-GAME max, unlike the old ResourceCharts which
      // rescaled to the max up to the cursor. A pre-rendered bitmap can't
      // rescale — and a fixed axis is also the only way the curve is
      // comparable across the whole match. Early game reads flatter than it
      // used to; that is the trade, and it is deliberate.
      let max = 12;
      for (const p of this._food) {
        for (const s of p.series) {
          if (s.foodUsed > max) max = s.foodUsed;
        }
      }
      max = Math.ceil(max / 10) * 10;
      const guides = [];
      if (max > UPKEEP_LOW) guides.push({ v: UPKEEP_LOW, color: GRID, dash: true });
      if (max > UPKEEP_HIGH) guides.push({ v: UPKEEP_HIGH, color: GRID, dash: true });
      return {
        kind: 'food', title: 'FOOD', x, y, w, h, labelW,
        yMin: 0, yMax: max,
        series: this._food.map(p => ({ color: p.color, pts: p.series, key: 'foodUsed' })),
        readout: true,
        guides
      };
    }

    // ------------------------------------------------------------------
    // Bitmaps
    // ------------------------------------------------------------------

    _newBitmap (cssW, cssH, dpr) {
      const c = document.createElement('canvas');
      c.width = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { canvas: c, ctx: g };
    }

    // Chrome carries the panel, the axes, the titles AND both lines at low
    // alpha; bright carries ONLY the lines at full strength on a transparent
    // background. The split is load-bearing: the reveal clip is applied to the
    // bright blit alone, so it can never brighten a row title.
    _paintBitmaps (cssW, cssH, dpr) {
      const chrome = this._newBitmap(cssW, cssH, dpr);
      const bright = this._newBitmap(cssW, cssH, dpr);
      const g = chrome.ctx;

      g.fillStyle = BG;
      this._roundRect(g, 0.5, 0.5, cssW - 1, cssH - 1, 8);
      g.fill();
      g.strokeStyle = BORDER;
      g.lineWidth = 1;
      g.stroke();

      for (const row of this._rows) {
        // Title in the left gutter, or inline over the plot when narrow.
        g.font = 'bold ' + TITLE_PX + 'px Arial';
        g.fillStyle = TITLE_COL;
        g.textBaseline = 'middle';
        if (row.labelW > 0) {
          g.textAlign = 'left';
          g.fillText(row.title, PAD_X, row.y + row.h / 2);
        } else {
          g.textAlign = 'left';
          g.fillText(row.title, row.x + 2, row.y + TITLE_PX * 0.6);
        }

        // Guides + baseline.
        for (const guide of row.guides) {
          const gy = this._yOf(row, guide.v);
          g.strokeStyle = guide.color;
          g.lineWidth = 1;
          if (guide.dash) g.setLineDash([4, 4]);
          g.beginPath();
          g.moveTo(row.x, gy + 0.5);
          g.lineTo(row.x + row.w, gy + 0.5);
          g.stroke();
          g.setLineDash([]);
        }
        g.strokeStyle = AXIS;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(row.x + 0.5, row.y);
        g.lineTo(row.x + 0.5, row.y + row.h);
        g.moveTo(row.x, row.y + row.h + 0.5);
        g.lineTo(row.x + row.w, row.y + row.h + 0.5);
        g.stroke();

        // Lines — faint into chrome, full strength into bright.
        for (const s of row.series) {
          this._strokeSeries(g, row, s, FAINT_ALPHA, 1.4);
          this._strokeSeries(bright.ctx, row, s, 1, 1.8);
        }
      }

      this._bmpChrome = chrome.canvas;
      this._bmpBright = bright.canvas;
    }

    _strokeSeries (g, row, s, alpha, width) {
      const pts = s.pts;
      if (!pts || pts.length < 2) return;
      const key = s.key;
      g.save();
      g.globalAlpha = alpha;
      g.strokeStyle = s.color || '#888';
      g.lineWidth = width;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.beginPath();
      let started = false;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (p.t < this._startT) continue;
        const px = this._xOf(row, p.t);
        const py = this._yOf(row, p[key]);
        if (!started) { g.moveTo(px, py); started = true; }
        else g.lineTo(px, py);
      }
      if (started) g.stroke();
      g.restore();
    }

    _xOf (row, t) {
      const span = this._endT - this._startT;
      let u = span > 0 ? (t - this._startT) / span : 0;
      if (u < 0) u = 0; else if (u > 1) u = 1;
      return row.x + u * row.w;
    }

    _yOf (row, v) {
      const span = row.yMax - row.yMin;
      let u = span > 0 ? (v - row.yMin) / span : 0;
      if (u < 0) u = 0; else if (u > 1) u = 1;
      return row.y + row.h - u * row.h;
    }

    _roundRect (g, x, y, w, h, r) {
      g.beginPath();
      g.moveTo(x + r, y);
      g.lineTo(x + w - r, y);
      g.quadraticCurveTo(x + w, y, x + w, y + r);
      g.lineTo(x + w, y + h - r);
      g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      g.lineTo(x + r, y + h);
      g.quadraticCurveTo(x, y + h, x, y + h - r);
      g.lineTo(x, y + r);
      g.quadraticCurveTo(x, y, x + r, y);
      g.closePath();
    }

    // ------------------------------------------------------------------
    // Per frame
    // ------------------------------------------------------------------

    // Forward-only sample lookup, matching Helpers.findIndexFrom's shape. A
    // backward jump larger than one sample falls back to a binary search
    // (log2(240) ~ 8 steps) rather than rescanning from zero.
    _valueAt (row, s, t) {
      const pts = s.pts;
      if (!pts || !pts.length) return null;
      if (t < pts[0].t) return null;

      // Cursor lives on the series record, which is rebuilt by build() — so a
      // rebuild resets it for free and there is no keyed lookup per frame.
      let i = s._cur;
      if (i === undefined || i < 0 || i >= pts.length || pts[i].t > t) {
        // Binary search: largest index with pts[i].t <= t.
        let lo = 0, hi = pts.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (pts[mid].t <= t) lo = mid; else hi = mid - 1;
        }
        i = lo;
      } else {
        while (i + 1 < pts.length && pts[i + 1].t <= t) i++;
      }
      s._cur = i;

      if (row.kind === 'dom') {
        // Interpolate: dominance samples are pre/post pairs around events, not
        // a grid, so a step read would miss the swing.
        const a = pts[i];
        const b = pts[i + 1];
        if (!b || b.t === a.t) return a[s.key];
        const u = (t - a.t) / (b.t - a.t);
        return a[s.key] + (b[s.key] - a[s.key]) * u;
      }
      // Food is a step function — sample and hold.
      return pts[i][s.key];
    }

    render (gameTime) {
      if (!this._visible || !this.ctx) return;
      if (!this._built && !this.build()) return;
      if (gameTime === this._lastT && !this._dirty) return;
      this._lastT = gameTime;
      this._dirty = false;

      const ctx = this.ctx;
      const W = this._cssW, H = this._cssH;
      ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      // Required, not optional: the plate has rounded corners, so a bare
      // drawImage would leave the previous frame showing through them.
      ctx.clearRect(0, 0, W, H);

      ctx.drawImage(this._bmpChrome, 0, 0, W, H);

      const row0 = this._rows[0];
      const cursorX = this._xOf(row0, gameTime);

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, cursorX, H);
      ctx.clip();
      ctx.drawImage(this._bmpBright, 0, 0, W, H);
      ctx.restore();

      // Cursor — fillRect, not a stroked path, so no path building per frame.
      ctx.fillStyle = CURSOR;
      for (let i = 0; i < this._rows.length; i++) {
        const row = this._rows[i];
        ctx.fillRect(Math.round(cursorX), row.y, 1, row.h);
      }

      // Readouts.
      ctx.font = 'bold ' + VALUE_PX + 'px Arial';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const rx = W - PAD_X;
      for (let i = 0; i < this._rows.length; i++) {
        const row = this._rows[i];
        if (!row.readout) continue;
        let ty = row.y + row.h / 2 - (row.series.length - 1) * 9;
        for (let si = 0; si < row.series.length; si++) {
          const s = row.series[si];
          const v = this._valueAt(row, s, gameTime);
          if (v != null) {
            const n = Math.round(v);
            ctx.fillStyle = s.color || '#FFF';
            ctx.fillText(n >= 0 && n <= 200 ? this._nums[n] : '-', rx, ty);
          }
          ty += 18;
        }
      }
    }
  }

  window.HudCharts = HudCharts;
})();
