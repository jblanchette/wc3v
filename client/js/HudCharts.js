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
  // Plate geometry. The panel is a cast slab with a channel cut per row —
  // see client/js/ForgedPanel.js for the material and why it looks like this.
  const PAD_X = 11;
  const PAD_Y = 9;
  // 106: "DOMINANCE" set in tracked Georgia is ~95px at 12.8 and was landing
  // on the housing. Measured, not guessed.
  const LABEL_W = 106;     // left gutter: engraved row wordmark
  const VALUE_W = 74;      // right gutter: readouts
  const ROW_H = 40;        // bronze housing; the cut channel is LIP smaller
  const ROW_GAP = 10;
  const CHAMFER = 10;
  // Visible bronze lip between the housing edge and the channel floor. This
  // is the whole reason the plot reads as cut into metal rather than painted
  // onto it — see .dom-track's note about 2px vanishing.
  const LIP = 4;

  const TITLE_PX = 12.8;   // the project's minimum readable size, exactly
  const VALUE_PX = 15;

  // Below this the label gutter is dropped and wordmarks draw over the well;
  // below the second, the HUD hides rather than render something unreadable.
  const NARROW_W = 470;
  const MIN_W = 360;

  const FAINT_ALPHA = 0.20;   // the not-yet-played portion of every line

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
      if (Math.abs(cssW - this._cssW) < 0.5 && Math.abs(cssH - this._cssH) < 0.5) return;
      this._cssW = cssW;
      this._cssH = cssH;
      // A collapsed or hidden box reports 0. Drop the built state rather than
      // keeping a stale bitmap alive against a size that no longer exists —
      // CSS hides the element below the fit threshold, but the observer still
      // fires and this must not be left claiming it is built.
      this._built = false;
      this._dirty = true;
      if (!(cssW > 0) || !(cssH > 0)) {
        this._bmpChrome = null;
        this._bmpBright = null;
        this._rows.length = 0;
      }
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

      // The housing spans the gutters; the plot is the channel inside it.
      const labelW = cssW < NARROW_W ? 0 : LABEL_W;
      const frameX = PAD_X + labelW;
      const frameW = Math.max(40 + LIP * 2, cssW - frameX - VALUE_W - PAD_X);
      const plotX = frameX + LIP;
      const plotW = frameW - LIP * 2;

      // Time domain — shared by both rows so the two cursors line up.
      this._endT = this._matchEnd();
      if (!(this._endT > this._startT)) this._endT = this._startT + 1;

      this._rows.length = 0;
      let y = PAD_Y;
      const geom = (fy) => ({
        fx: frameX, fy, fw: frameW, fh: ROW_H,            // bronze housing
        x: plotX, y: fy + LIP, w: plotW, h: ROW_H - LIP * 2,  // cut channel = the plot
        labelW
      });
      if (this._dom) {
        this._rows.push(this._buildDomRow(geom(y)));
        y += ROW_H + ROW_GAP;
      }
      if (this._food) {
        this._rows.push(this._buildFoodRow(geom(y)));
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

    _buildDomRow (g) {
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
      return Object.assign({}, g, {
        kind: 'dom', title: 'DOMINANCE',
        yMin, yMax,
        series: this._dom.map(p => ({ color: p.color, pts: p.samples, key: 'score' })),
        // No numeric readout — DominanceBar above owns the current split, and
        // the same number twice on one screen is noise. The right gutter names
        // the reference groove instead, so it reads as labelled, not empty.
        readout: false,
        gutterMark: { text: 'EVEN', v: 50 },
        guides: [{ v: 50, strong: true }]
      });
    }

    _buildFoodRow (g) {
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
      if (max > UPKEEP_LOW) guides.push({ v: UPKEEP_LOW });
      if (max > UPKEEP_HIGH) guides.push({ v: UPKEEP_HIGH, strong: true });
      return Object.assign({}, g, {
        kind: 'food', title: 'FOOD',
        yMin: 0, yMax: max,
        series: this._food.map(p => ({ color: p.color, pts: p.series, key: 'foodUsed' })),
        readout: true,
        guides
      });
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

    // Chrome carries the plate, the cut channels, the engraved wordmarks, the
    // etched reference grooves AND both series at low alpha; bright carries
    // ONLY the series at full strength on a transparent background. The split
    // is load-bearing: the reveal clip is applied to the bright blit alone, so
    // it can never brighten a wordmark or a stud.
    _paintBitmaps (cssW, cssH, dpr) {
      const F = window.ForgedPanel;
      const chrome = this._newBitmap(cssW, cssH, dpr);
      const bright = this._newBitmap(cssW, cssH, dpr);
      const g = chrome.ctx;

      F.chassis(g, 0, 0, cssW, cssH, { chamfer: CHAMFER });

      // Mounting studs inside the chamfers, same as the gauge's rail.
      const sr = 2.5;
      const si = CHAMFER + 3;
      F.stud(g, si, si, sr);
      F.stud(g, cssW - si, si, sr);
      F.stud(g, si, cssH - si, sr);
      F.stud(g, cssW - si, cssH - si, sr);

      for (const row of this._rows) {
        // Bronze housing, then the channel cut into it. The LIP between the
        // two is what makes this read as metal rather than a painted band.
        F.frame(g, row.fx, row.fy, row.fw, row.fh, 7);
        F.well(g, row.x, row.y, row.w, row.h, 4);
        // Mounting studs on the housing lip, as on the gauge's rail.
        F.stud(g, row.fx + LIP / 2 + 1, row.fy + row.fh / 2, 1.8);
        F.stud(g, row.fx + row.fw - LIP / 2 - 1, row.fy + row.fh / 2, 1.8);

        // Engraved wordmark in the left gutter. When the gutter is dropped it
        // goes over the channel's top-left — still engraved, just tighter.
        if (row.labelW > 0) {
          F.engrave(g, row.title, PAD_X, row.fy + row.fh / 2, TITLE_PX, { tracking: 0.10 });
        } else {
          F.engrave(g, row.title, row.x + 6, row.y + 9, TITLE_PX * 0.86, { tracking: 0.06 });
        }

        // Right gutter: name the reference groove on rows with no readout.
        if (row.gutterMark) {
          F.engrave(g, row.gutterMark.text,
                    cssW - PAD_X, this._yOf(row, row.gutterMark.v),
                    TITLE_PX * 0.86, { tracking: 0.16, align: 'right' });
        }

        // Minute grid, etched into the channel floor. Without it the plot is
        // a curve floating in a black box with no sense of pace; with it the
        // reveal reads against real elapsed time. Interval picked to land
        // 4-8 divisions across whatever span this match actually has.
        const span = this._endT - this._startT;
        const step = [60, 120, 180, 300, 600, 900]
          .find(s => span / (s * 1000) <= 8) || 1200;
        g.save();
        F.path(g, row.x, row.y, row.w, row.h, 4);
        g.clip();
        for (let t = Math.ceil(this._startT / (step * 1000)) * step * 1000;
             t < this._endT; t += step * 1000) {
          const gx = Math.round(this._xOf(row, t)) + 0.5;
          g.fillStyle = 'rgba(0, 0, 0, 0.55)';
          g.fillRect(gx - 1, row.y, 1, row.h);
          g.fillStyle = 'rgba(201, 187, 150, 0.07)';
          g.fillRect(gx, row.y, 1, row.h);
        }
        g.restore();

        // Reference grooves, cut into the channel floor (the 50 midline; the
        // 50/80 upkeep thresholds). Drawn as horizontal etch: a dark cut with
        // a struck highlight under it.
        for (const guide of row.guides) {
          const gy = Math.round(this._yOf(row, guide.v)) + 0.5;
          g.save();
          F.path(g, row.x, row.y, row.w, row.h, 4);
          g.clip();
          g.strokeStyle = 'rgba(0, 0, 0, 0.75)';
          g.lineWidth = 1;
          g.beginPath(); g.moveTo(row.x, gy); g.lineTo(row.x + row.w, gy); g.stroke();
          g.strokeStyle = guide.strong
            ? 'rgba(201, 187, 150, 0.26)' : 'rgba(201, 187, 150, 0.13)';
          g.beginPath(); g.moveTo(row.x, gy + 1); g.lineTo(row.x + row.w, gy + 1); g.stroke();
          g.restore();
        }

        // Series. Faint into chrome, full strength into bright — each with a
        // filled body beneath it so the curve reads as something poured into
        // the channel rather than a hairline floating in it.
        for (const s of row.series) {
          this._strokeSeries(g, row, s, FAINT_ALPHA, 1.4, false);
          this._strokeSeries(bright.ctx, row, s, 1, 2, true);
        }

        // Glass over the channel, last, so it sits on the fills.
        F.glass(g, row.x, row.y, row.w, row.h, 4);
      }

      this._bmpChrome = chrome.canvas;
      this._bmpBright = bright.canvas;
    }

    // One series. `body` fills the area between the curve and its baseline —
    // the dominance row fills back to the 50 line (so a lead reads as mass on
    // one side of even), the food row fills to the floor. Fill is shaded top
    // light / bottom dark like .dom-seg: a flat slab of colour reads as paint
    // no matter how good the hue is.
    _strokeSeries (g, row, s, alpha, width, body) {
      const pts = s.pts;
      if (!pts || pts.length < 2) return;
      const key = s.key;
      const baseY = row.kind === 'dom'
        ? this._yOf(row, 50)
        : row.y + row.h;

      // Trace once into a reusable path array so the fill and the stroke can
      // share it without walking the samples twice.
      let first = true, lastX = 0;
      g.save();
      // Everything this series draws stays inside its own channel.
      window.ForgedPanel.path(g, row.x, row.y, row.w, row.h, 4);
      g.clip();
      g.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (p.t < this._startT) continue;
        const px = this._xOf(row, p.t);
        const py = this._yOf(row, p[key]);
        if (first) { g.moveTo(px, py); first = false; }
        else g.lineTo(px, py);
        lastX = px;
      }
      if (first) { g.restore(); return; }

      if (body) {
        // Close down to the baseline and fill.
        g.lineTo(lastX, baseY);
        g.lineTo(this._xOf(row, this._startT), baseY);
        g.closePath();
        // Shaded like .dom-seg — bright where the light hits, deep at the
        // bottom. A flat wash of colour reads as paint no matter how good the
        // hue is, and at low alpha over a near-black channel it vanishes.
        const grad = g.createLinearGradient(0, row.y, 0, row.y + row.h);
        grad.addColorStop(0, this._rgba(s.color, 0.60));
        grad.addColorStop(0.55, this._rgba(s.color, 0.32));
        grad.addColorStop(1, this._rgba(s.color, 0.10));
        g.fillStyle = grad;
        g.fill();
      }

      // Re-trace for the stroke (the fill closed the path).
      g.beginPath();
      first = true;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (p.t < this._startT) continue;
        const px = this._xOf(row, p.t);
        const py = this._yOf(row, p[key]);
        if (first) { g.moveTo(px, py); first = false; }
        else g.lineTo(px, py);
      }
      g.lineJoin = 'round';
      g.lineCap = 'round';
      // Hard black backing under the curve — the in-game way to seat a bright
      // line on a dark field. No glow anywhere.
      if (body) {
        g.globalAlpha = 0.85;
        g.strokeStyle = '#000';
        g.lineWidth = width + 2;
        g.stroke();
      }
      g.globalAlpha = alpha;
      g.strokeStyle = s.color || '#888';
      g.lineWidth = width;
      g.stroke();
      g.restore();
    }

    // '#rrggbb' -> 'rgba(r,g,b,a)'. Memoized per (color, alpha) pair; this
    // runs only at build time but the parse is pure waste to repeat.
    _rgba (hex, a) {
      const key = hex + '|' + a;
      if (!this._rgbaCache) this._rgbaCache = new Map();
      let out = this._rgbaCache.get(key);
      if (out === undefined) {
        const h = String(hex || '#888888').replace('#', '');
        const n = h.length === 3
          ? h.split('').map(c => parseInt(c + c, 16))
          : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
        out = 'rgba(' + (n[0] | 0) + ',' + (n[1] | 0) + ',' + (n[2] | 0) + ',' + a + ')';
        this._rgbaCache.set(key, out);
      }
      return out;
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

      const F = window.ForgedPanel;
      const row0 = this._rows[0];
      const cursorX = this._xOf(row0, gameTime);

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, cursorX, H);
      ctx.clip();
      ctx.drawImage(this._bmpBright, 0, 0, W, H);
      ctx.restore();

      // Playback cursor — a struck bone groove, not a bright rule. Three
      // 1px fillRects (shadow / cut / highlight), so still no path building.
      const cx = Math.round(cursorX);
      for (let i = 0; i < this._rows.length; i++) {
        const row = this._rows[i];
        if (cx < row.x || cx > row.x + row.w) continue;
        F.groove(ctx, cx, row.y + 1, row.h - 2, F.COLORS.bone);
      }

      // Readouts, set as in-game numerals: tabular mono with a hard black
      // backing. Player colour is data and stays.
      const rx = W - PAD_X;
      for (let i = 0; i < this._rows.length; i++) {
        const row = this._rows[i];
        if (!row.readout) continue;
        let ty = row.y + row.h / 2 - (row.series.length - 1) * 10;
        for (let si = 0; si < row.series.length; si++) {
          const s = row.series[si];
          const v = this._valueAt(row, s, gameTime);
          if (v != null) {
            const n = Math.round(v);
            F.numeral(ctx, n >= 0 && n <= 200 ? this._nums[n] : '-',
                      rx, ty, VALUE_PX, s.color || F.COLORS.ink);
          }
          ty += 20;
        }
      }
    }
  }

  window.HudCharts = HudCharts;
})();
