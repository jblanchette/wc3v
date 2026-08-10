/**
 * DominanceChart — dominance-over-time line chart for the Insights panel.
 *
 * One chart, fixed 0-100 Y axis with a 50 midline, one line per player in
 * their player color, momentum-event dots, and a yellow "now" cursor.
 * Progressive draw model copied from ResourceCharts: lines and dots only
 * exist up to the current playback time (no spoilers), the cursor moves
 * smoothly every frame, and redraws are skipped unless the visible sample
 * window changed.
 *
 * Source: player.dominanceSeries (see lib/DominanceSeries.js). Same strict
 * gate as DominanceBar — app.js only registers the tab for available 1v1s.
 */

(function () {
  const CHART_W = 320;
  const CHART_H = 96;
  const CHART_MARGIN = { top: 12, right: 6, bottom: 14, left: 30 };
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function createSvg (tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  class DominanceChart {
    constructor (viewer) {
      this.viewer = viewer;
      this._el = null;
      this._players = [];      // [{id, color, samples, events}]
      this._totalT = 0;
      this._startT = 0;        // left edge of the x-axis; see setStart()
      this._chart = null;
      // The viewBox this instance draws into. Authored size unless a consumer
      // asks for responsive; see setResponsive().
      this._w = CHART_W;
      this._h = CHART_H;
      this._responsive = false;
      this._cursorT = 0;
      this._yMin = 35;
      this._yMax = 65;
    }

    setContainer (containerEl) {
      this._el = containerEl;
      this._el.classList.add('dmc-chart-wrap');
    }

    setPlayers (playerInfos) {
      this._players = (playerInfos || []).filter(p =>
        p && p.samples && p.samples.length);
      let end = 0;
      for (const p of this._players) {
        const last = p.samples[p.samples.length - 1];
        if (last && last.t > end) end = last.t;
      }
      this._totalT = end;
    }

    // Left edge of the x-axis, in game ms. Default 0, so the viewer is
    // unchanged unless it opts in.
    //
    // The score eases out from an even 50/50 over `earlyRampMs` (150s in
    // helpers/dominanceConfig.json), because strength is growth since game
    // start and the first minute is noise. That opening is real, but it is a
    // flat line taking a fixed slice of every plot, and on a 17-minute game it
    // is 15% of the width spent saying "nothing had happened yet".
    //
    // Call before build(). Clamped so a start past the end can never collapse
    // the plot to a point.
    setStart (startT) {
      this._startT = Math.max(0, Math.min(startT || 0, Math.max(0, this._totalT - 1)));
    }

    // Draw into a viewBox the size of the rendered element instead of the
    // authored 320x96.
    //
    // preserveAspectRatio is "none", which is what lets the plot fill any
    // panel. In the viewer's ~320px insights panel the viewBox is close to the
    // pixels and nothing distorts. Anywhere wider it does not: a 1100px report
    // column stretches each horizontal unit 3.4x while the vertical stays at
    // 1x, and the result reads as a chart that has been zoomed into rather than
    // drawn — the 30-unit y-axis gutter becomes a 103px trench, every slope
    // shears flat, and the momentum dots have to be scaled back by hand
    // (_fitDots) to stop being lozenges.
    //
    // Responsive mode measures the element and matches the viewBox to it, so
    // one unit is one pixel in both axes and the margins mean what they say.
    // Call before build(). The size is re-measured whenever the element
    // resizes; changing the viewBox does not change the rendered size, so this
    // cannot feed back into the ResizeObserver.
    setResponsive (on) {
      this._responsive = on !== false;
    }

    // The plot area of THIS instance, in its own viewBox units. The static
    // GEOMETRY below is only right for a chart drawn at the authored size.
    geometry () {
      return {
        width: this._w,
        marginLeft: CHART_MARGIN.left,
        marginRight: CHART_MARGIN.right
      };
    }

    // The first moment any player's score leaves the even line by more than
    // `epsilon` points. Exposed so a consumer can trim to it without
    // reimplementing the walk over samples this class owns.
    firstMoveT (epsilon) {
      const eps = epsilon == null ? 1 : epsilon;
      let earliest = null;
      for (const p of this._players) {
        for (const s of p.samples) {
          if (Math.abs((s.score || 50) - 50) > eps) {
            if (earliest === null || s.t < earliest) earliest = s.t;
            break;
          }
        }
      }
      return earliest === null ? 0 : earliest;
    }

    build () {
      if (!this._el || this._players.length < 2) return;
      this._el.innerHTML = '';

      const wrapper = document.createElement('div');
      wrapper.className = 'dmc-chart';
      const titleEl = document.createElement('div');
      titleEl.className = 'dmc-title';
      const titleLabel = document.createElement('span');
      titleLabel.className = 'dmc-title-label';
      titleLabel.textContent = 'Dominance';
      const titleHint = document.createElement('span');
      titleHint.className = 'dmc-title-hint';
      titleHint.textContent = '50 = even';
      titleEl.appendChild(titleLabel);
      titleEl.appendChild(titleHint);
      wrapper.appendChild(titleEl);

      const svg = createSvg('svg', {
        viewBox: '0 0 ' + this._w + ' ' + this._h,
        preserveAspectRatio: 'none',
        class: 'dmc-svg'
      });
      wrapper.appendChild(svg);

      // Y range: fixed for the whole playback (no rescale jumps) but fitted
      // to the series — real games live in the 40-60 band and a hard 0-100
      // axis flattens the story. Padded, symmetric-ish around 50, min span 30.
      // Held on the instance because it depends on the data, not the box, and
      // _applyGeometry() rebuilds yOf without re-walking every sample.
      let lo = 50, hi = 50;
      for (const p of this._players) {
        for (const s of p.samples) {
          if (s.score < lo) lo = s.score;
          if (s.score > hi) hi = s.score;
        }
      }
      this._yMin = Math.max(0, Math.min(35, Math.floor(lo - 5)));
      this._yMax = Math.min(100, Math.max(65, Math.ceil(hi + 5)));

      // Stroke attributes below are fallbacks; the .dmc-* classes in
      // dominance.css own the chrome look (widths, dashes, non-scaling
      // strokes). Every coordinate is placed by _applyGeometry(), which is the
      // one function that knows how big the box is.
      const axisColor = 'rgba(255,255,255,0.18)';
      const axisY = createSvg('line', { class: 'dmc-axis', stroke: axisColor });
      const axisX = createSvg('line', { class: 'dmc-axis', stroke: axisColor });
      // 50 midline — the "even game" reference.
      const mid50 = createSvg('line', {
        class: 'dmc-mid50',
        stroke: 'rgba(255,255,255,0.25)', 'stroke-dasharray': '4 4'
      });
      svg.appendChild(axisY);
      svg.appendChild(axisX);
      svg.appendChild(mid50);
      // No SVG text labels — preserveAspectRatio:none would distort glyphs.
      // The dashed midline + the "50 = even" title carry the scale.

      const playerLines = this._players.map(p => {
        const line = createSvg('polyline', {
          class: 'dmc-line',
          fill: 'none', stroke: p.color || '#888', 'stroke-width': '1.6', points: ''
        });
        svg.appendChild(line);
        // Momentum-event dots — hidden until playback reaches them. The ring
        // color is data (white = gain, red = loss) and stays an attribute.
        const dots = (p.events || []).map(e => {
          const dot = createSvg('circle', {
            class: 'dmc-dot',
            cx: 0, cy: 0, r: 2.6,
            fill: p.color || '#888',
            stroke: e.delta < 0 ? 'rgba(255,80,80,0.9)' : 'rgba(255,255,255,0.7)',
            'stroke-width': '0.8',
            visibility: 'hidden'
          });
          const tip = createSvg('title', {});
          tip.textContent = e.kind + ' ' + (e.delta >= 0 ? '+' : '') + e.delta;
          dot.appendChild(tip);
          svg.appendChild(dot);
          return { data: e, el: dot };
        });
        return { player: p, line, dots, lastEnd: -2, lastDots: -1 };
      });

      const cursor = createSvg('line', {
        class: 'dmc-cursor',
        stroke: '#FFD43B', 'stroke-width': '1.5'
      });
      svg.appendChild(cursor);

      this._el.appendChild(wrapper);
      this._chart = {
        svg, cursor, playerLines, wrapper, axisY, axisX, mid50,
        xOf: (t) => t, yOf: (s) => s
      };
      this._applyGeometry(true);

      // In responsive mode the viewBox tracks the element, so the observer is
      // what keeps the two in step. Otherwise it only compensates the dots:
      // preserveAspectRatio="none" stretches them with the box, and while lines
      // are immune via non-scaling-stroke, a circle is a shape.
      if (typeof ResizeObserver !== 'undefined') {
        this._ro = new ResizeObserver(() => this._applyGeometry(false));
        this._ro.observe(svg);
      }
    }

    // Places every coordinate in the plot from the current box size. Called on
    // build and on every resize, so nothing else in this class may hardcode a
    // margin against CHART_W or CHART_H.
    _applyGeometry (force) {
      const c = this._chart;
      if (!c) return;

      let w = CHART_W;
      let h = CHART_H;
      if (this._responsive) {
        const r = c.svg.getBoundingClientRect();
        // A detached or collapsed element measures zero. Keep the authored box
        // rather than dividing by it; the observer fires again on attach.
        if (r.width >= 40 && r.height >= 20) {
          w = Math.round(r.width);
          h = Math.round(r.height);
        }
      }
      if (!force && w === this._w && h === this._h) { this._fitDots(); return; }

      this._w = w;
      this._h = h;
      c.svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);

      const innerW = Math.max(1, w - CHART_MARGIN.left - CHART_MARGIN.right);
      const innerH = Math.max(1, h - CHART_MARGIN.top - CHART_MARGIN.bottom);
      const startT = this._startT || 0;
      const span = Math.max(1, this._totalT - startT);
      const yMin = this._yMin;
      const yMax = this._yMax;

      c.xOf = (t) => CHART_MARGIN.left + ((t - startT) / span) * innerW;
      c.yOf = (score) => {
        const clamped = Math.max(yMin, Math.min(yMax, score));
        return CHART_MARGIN.top + innerH - ((clamped - yMin) / (yMax - yMin)) * innerH;
      };

      const left = CHART_MARGIN.left;
      const top = CHART_MARGIN.top;
      const right = left + innerW;
      const bottom = top + innerH;

      c.axisY.setAttribute('x1', left); c.axisY.setAttribute('x2', left);
      c.axisY.setAttribute('y1', top); c.axisY.setAttribute('y2', bottom);
      c.axisX.setAttribute('x1', left); c.axisX.setAttribute('x2', right);
      c.axisX.setAttribute('y1', bottom); c.axisX.setAttribute('y2', bottom);
      c.mid50.setAttribute('x1', left); c.mid50.setAttribute('x2', right);
      c.mid50.setAttribute('y1', c.yOf(50)); c.mid50.setAttribute('y2', c.yOf(50));
      c.cursor.setAttribute('y1', top); c.cursor.setAttribute('y2', bottom);

      // Everything the cursor pass draws is invalidated: the polylines are
      // rebuilt only when the visible sample window changes, and the box
      // changing is not a window change.
      for (const pl of c.playerLines) {
        pl.lastEnd = -2;
        pl.lastDots = -1;
        for (const d of pl.dots) {
          d.el.setAttribute('cx', c.xOf(d.data.t));
          d.positioned = false;
        }
      }

      this._fitDots();
      this.setCursor(this._cursorT);
    }

    _fitDots () {
      const c = this._chart;
      if (!c) return;
      const r = c.svg.getBoundingClientRect();
      if (!r.width || !r.height) return;
      // How much wider each viewBox unit renders horizontally than vertically.
      // Exactly 1 in responsive mode, which is the point of it.
      const stretch = (r.width / this._w) / (r.height / this._h);
      c.wrapper.style.setProperty('--dmc-dot-xc', (1 / stretch).toFixed(4));
    }

    // Callers that tear the chart down own this. Only the ResizeObserver
    // outlives the DOM, and only because nothing else was holding it.
    destroy () {
      if (this._ro) { this._ro.disconnect(); this._ro = null; }
      this._chart = null;
      if (this._el) this._el.innerHTML = '';
    }

    _sampleIdxAt (samples, t) {
      if (!samples.length || t < samples[0].t) return -1;
      let lo = 0, hi = samples.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (samples[mid].t <= t) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    }

    // Interpolated score per player at t, in setPlayers order. Null for a
    // player with no samples.
    //
    // Consumers that show the numbers beside the plot need them from whatever
    // owns the series, and that is this class. The desktop app reads them for
    // the readout on its chart title, where the tug-of-war gauge used to be the
    // only thing carrying them.
    //
    // Event pairs (t-1, t) in the series make real discontinuities survive
    // interpolation as steps rather than being smoothed into slopes — the same
    // property DominanceBar's own lerp relies on.
    scoresAt (gameTime) {
      const t = Math.max(0, Math.min(this._totalT, gameTime));
      return this._players.map((p) => {
        const s = p.samples;
        if (!s || !s.length) return null;
        if (t <= s[0].t) return s[0].score;
        const last = s[s.length - 1];
        if (t >= last.t) return last.score;
        const i = this._sampleIdxAt(s, t);
        const a = s[i];
        const b = s[i + 1];
        if (!b) return a.score;
        const span = b.t - a.t;
        if (span <= 0) return b.score;
        return a.score + (b.score - a.score) * ((t - a.t) / span);
      });
    }

    setCursor (gameTime) {
      const c = this._chart;
      if (!c) return;
      // Clamped to the DRAWN span, not to the game. With a trimmed start,
      // clamping to 0 lets the cursor be dragged into territory the plot does
      // not cover, where it renders left of the y axis.
      const startT = this._startT || 0;
      const t = Math.max(startT, Math.min(this._totalT, gameTime));
      // Remembered so a resize can redraw the plot where the reader left it.
      this._cursorT = t;

      const x = c.xOf(t);
      c.cursor.setAttribute('x1', x);
      c.cursor.setAttribute('x2', x);

      for (const pl of c.playerLines) {
        const samples = pl.player.samples;
        const end = this._sampleIdxAt(samples, t);
        if (end !== pl.lastEnd) {
          pl.lastEnd = end;
          if (end < 0) {
            pl.line.setAttribute('points', '');
          } else {
            // Samples before the start are skipped rather than plotted at a
            // negative x, and the one straddling it is kept so the line enters
            // from the left edge instead of beginning in mid-air.
            const pts = [];
            for (let i = 0; i <= end; i++) {
              if (samples[i].t < startT && !(samples[i + 1] && samples[i + 1].t > startT)) continue;
              pts.push(c.xOf(Math.max(samples[i].t, startT)) + ',' + c.yOf(samples[i].score));
            }
            pl.line.setAttribute('points', pts.join(' '));
          }
        }

        // Reveal dots up to t (scrubbing back re-hides them). A dot before the
        // trimmed start belongs to ground the plot does not draw.
        let visible = 0;
        for (const d of pl.dots) { if (d.data.t <= t) visible++; else break; }
        if (visible !== pl.lastDots) {
          pl.lastDots = visible;
          for (let i = 0; i < pl.dots.length; i++) {
            const d = pl.dots[i];
            const show = i < visible && d.data.t >= startT;
            d.el.setAttribute('visibility', show ? 'visible' : 'hidden');
            if (show && !d.positioned) {
              // Anchor dot to the score at its own timestamp (post-event sample).
              const idx = this._sampleIdxAt(pl.player.samples, d.data.t);
              const s = pl.player.samples[Math.max(0, idx)];
              d.el.setAttribute('cy', c.yOf(s.score));
              d.positioned = true;
            }
          }
        }
      }
    }
  }

  // The plot area of a chart drawn at the AUTHORED size, as viewBox units.
  // Published because a consumer that turns a pointer position into a game time
  // (the desktop app scrubs this chart) would otherwise hardcode the margins
  // and drift when they change.
  //
  // A responsive instance re-authors its own viewBox, so this is no longer the
  // right answer for one. Ask the instance: chart.geometry().
  DominanceChart.GEOMETRY = {
    width: CHART_W,
    marginLeft: CHART_MARGIN.left,
    marginRight: CHART_MARGIN.right
  };

  window.DominanceChart = DominanceChart;
})();
