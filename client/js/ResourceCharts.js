/**
 * ResourceCharts — broadcast-style line charts for resource flow.
 *
 * Three stacked mini-charts: food usage, gold lost, lumber lost.
 * Per-player coloured lines. Yellow vertical "now" cursor tracks gameTime.
 *
 * Progressive draw model:
 *   • Lines extend as gameTime advances — at t=2min the chart only shows
 *     samples up to 2min, with the Y axis scaled to that visible range
 *     (so early-game values aren't dwarfed by late-game peaks).
 *   • The cursor moves smoothly every frame; the lines only redraw when
 *     gameTime crosses a sample boundary (every 10s). Cheap.
 *   • Scrubbing backward shrinks the visible range; everything rescales.
 *
 * Source: each player.resourceSeries (see lib/ResourceSeries.js).
 * Not interactive — chart is a passive readout, scrubber drives playback.
 */

(function () {
  const CHART_W = 320;       // viewBox width — SVG stretches to panel width
  const CHART_H = 70;
  const CHART_MARGIN = { top: 14, right: 6, bottom: 16, left: 38 };
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function fmtK (n) {
    if (n >= 10000) return (n / 1000).toFixed(0) + 'k';
    if (n >= 1000)  return (n / 1000).toFixed(1) + 'k';
    return String(Math.round(n));
  }

  function createSvg (tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  class ResourceCharts {
    constructor (viewer) {
      this.viewer = viewer;
      this._chartsEl = null;
      this._players = [];
      this._totalT = 0;
      this._charts = [];
    }

    // Container the charts will render inside. Provided by BottomPanel as
    // a tab content element.
    setContainer (containerEl) {
      this._chartsEl = containerEl;
      this._chartsEl.classList.add('rcp-charts');
    }

    setPlayers (playerInfos) {
      this._players = (playerInfos || []).filter(p => p && p.resourceSeries && p.resourceSeries.length);
      if (!this._players.length) return;
      let end = 0;
      for (const p of this._players) {
        const last = p.resourceSeries[p.resourceSeries.length - 1];
        if (last && last.t > end) end = last.t;
      }
      this._totalT = end;
    }

    build () {
      if (!this._chartsEl || !this._players.length) return;
      this._chartsEl.innerHTML = '';

      const specs = [
        { kind: 'food',   title: 'Food',        valueFn: (s) => s.foodUsed, maxFn: (s) => s.foodMax },
        { kind: 'gold',   title: 'Gold lost',   valueFn: (s) => s.goldLost,   maxFn: null },
        { kind: 'lumber', title: 'Lumber lost', valueFn: (s) => s.lumberLost, maxFn: null }
      ];
      this._charts = specs.map(spec => this._buildChart(spec));
      // Initial render at t=0.
      this.setCursor(0);
    }

    _buildChart (spec) {
      const wrapper = document.createElement('div');
      wrapper.className = 'rcp-chart';
      const titleEl = document.createElement('div');
      titleEl.className = 'rcp-chart-title';
      titleEl.textContent = spec.title;
      wrapper.appendChild(titleEl);

      const svg = createSvg('svg', {
        viewBox: '0 0 ' + CHART_W + ' ' + CHART_H,
        preserveAspectRatio: 'none',
        class: 'rcp-chart-svg'
      });
      wrapper.appendChild(svg);

      const innerW = CHART_W - CHART_MARGIN.left - CHART_MARGIN.right;
      const innerH = CHART_H - CHART_MARGIN.top - CHART_MARGIN.bottom;
      const xOf = (t) => CHART_MARGIN.left + (t / Math.max(1, this._totalT)) * innerW;

      const axisColor = 'rgba(255,255,255,0.18)';
      svg.appendChild(createSvg('line', {
        x1: CHART_MARGIN.left, x2: CHART_MARGIN.left,
        y1: CHART_MARGIN.top,  y2: CHART_MARGIN.top + innerH,
        stroke: axisColor
      }));
      svg.appendChild(createSvg('line', {
        x1: CHART_MARGIN.left,          x2: CHART_MARGIN.left + innerW,
        y1: CHART_MARGIN.top + innerH,  y2: CHART_MARGIN.top + innerH,
        stroke: axisColor
      }));

      // Empty polylines — populated by _refreshChart per tick.
      const playerLines = this._players.map(p => {
        const line = createSvg('polyline', {
          fill: 'none',
          stroke: p.color || '#888',
          'stroke-width': '1.6',
          points: ''
        });
        svg.appendChild(line);
        let maxLine = null;
        if (spec.maxFn) {
          maxLine = createSvg('polyline', {
            fill: 'none',
            stroke: p.color || '#888',
            'stroke-width': '1',
            'stroke-dasharray': '3 3',
            opacity: '0.7',
            points: ''
          });
          svg.appendChild(maxLine);
        }
        return { player: p, line, maxLine };
      });

      // Now-cursor — moved by setCursor each frame.
      const cursor = createSvg('line', {
        y1: CHART_MARGIN.top, y2: CHART_MARGIN.top + innerH,
        stroke: '#FFD43B', 'stroke-width': '1.5',
        x1: CHART_MARGIN.left, x2: CHART_MARGIN.left
      });
      svg.appendChild(cursor);

      this._chartsEl.appendChild(wrapper);

      return {
        spec, titleEl, cursor, playerLines, xOf, innerH,
        lastMax: -1
      };
    }

    // Returns the largest sample index where sample.t <= t. -1 if before first.
    _sampleIdxAt (player, t) {
      const arr = player.resourceSeries;
      if (!arr.length || t < arr[0].t) return -1;
      // Linear with cached hint would be faster but ~180 samples = trivial.
      let lo = 0, hi = arr.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (arr[mid].t <= t) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    }

    _refreshChart (chart, gameTime) {
      // Visible index window per player, reused scratch (this runs per chart
      // per frame while the economy tab is open).
      const perPlayerEnd = chart._endScratch || (chart._endScratch = []);
      perPlayerEnd.length = this._players.length;
      // Skip BEFORE the max scan: the visible window only grows when a new
      // sample crosses `gameTime` (~once per game-second), but the old order
      // rescanned every player's full history down to index 0 on every frame
      // just to recompute an unchanged max. Compared element-wise (not a sum)
      // so a seek that shifts two players' windows in opposite directions
      // can't alias as "unchanged".
      const lastEnds = chart._lastEnds || (chart._lastEnds = []);
      let changed = lastEnds.length !== this._players.length;
      for (let pi = 0; pi < this._players.length; pi++) {
        const end = (perPlayerEnd[pi] = this._sampleIdxAt(this._players[pi], gameTime));
        if (lastEnds[pi] !== end) changed = true;
        lastEnds[pi] = end;
      }
      if (!changed) return;

      // Rescale Y to the max across ANY player's value up through `gameTime`.
      let maxV = 1;
      for (let pi = 0; pi < this._players.length; pi++) {
        const end = perPlayerEnd[pi];
        if (end < 0) continue;
        const arr = this._players[pi].resourceSeries;
        for (let i = 0; i <= end; i++) {
          const v = chart.spec.valueFn(arr[i]);
          if (v > maxV) maxV = v;
          if (chart.spec.maxFn) {
            const m = chart.spec.maxFn(arr[i]);
            if (m > maxV) maxV = m;
          }
        }
      }
      chart.lastMax = maxV;

      // Refresh title.
      chart.titleEl.textContent = chart.spec.title + ' · peak ' + fmtK(maxV);

      const yOf = (v) => CHART_MARGIN.top + chart.innerH - (v / maxV) * chart.innerH;
      const xOf = chart.xOf;

      for (let pi = 0; pi < chart.playerLines.length; pi++) {
        const pl = chart.playerLines[pi];
        const end = perPlayerEnd[pi];
        if (end < 0) {
          pl.line.setAttribute('points', '');
          if (pl.maxLine) pl.maxLine.setAttribute('points', '');
          continue;
        }
        const arr = pl.player.resourceSeries;
        const pts = [];
        for (let i = 0; i <= end; i++) {
          pts.push(xOf(arr[i].t) + ',' + yOf(chart.spec.valueFn(arr[i])));
        }
        pl.line.setAttribute('points', pts.join(' '));
        if (pl.maxLine && chart.spec.maxFn) {
          const pts2 = [];
          for (let i = 0; i <= end; i++) {
            pts2.push(xOf(arr[i].t) + ',' + yOf(chart.spec.maxFn(arr[i])));
          }
          pl.maxLine.setAttribute('points', pts2.join(' '));
        }
      }
    }

    setCursor (gameTime) {
      if (!this._charts.length) return;
      const t = Math.max(0, Math.min(this._totalT, gameTime));
      for (const c of this._charts) {
        // Smooth cursor every frame.
        const x = c.xOf(t);
        c.cursor.setAttribute('x1', x);
        c.cursor.setAttribute('x2', x);
        // Refresh lines + Y scale (skips when nothing changed).
        this._refreshChart(c, t);
      }
    }
  }

  // The plot area as fractions of the rendered width — see the same block in
  // DominanceChart.js. preserveAspectRatio is "none", so these hold at any
  // element size, and a consumer mapping a pointer position back to a game time
  // does not have to hardcode the margins.
  ResourceCharts.GEOMETRY = {
    width: CHART_W,
    marginLeft: CHART_MARGIN.left,
    marginRight: CHART_MARGIN.right
  };

  window.ResourceCharts = ResourceCharts;
})();
