/**
 * TimelineSpline — Adaptive SVG overlay for the build order panel.
 *
 * This is a pure overlay: it reads DOM positions from already-rendered
 * event elements, builds an adaptive time->Y mapping, then draws:
 *   - A vertical spine line (with glow) in or beside the #bo-timeline-gap
 *   - Time markers (1:00, 2:00, ...) with diamond shapes and label pills
 *   - Directional arrow nodes at each event's position on the spine
 *   - Connector arms (dashed beziers) from each event to the spine
 *
 * The spine adapts to event density — it stretches where events are
 * dense and compresses where they're sparse, so connector arms stay
 * roughly horizontal.
 *
 * Works in both multi-player (spine centered in gap) and single-player
 * (spine positioned to the left of the column) modes.
 */

const TimelineSpline = class {
  constructor (viewer) {
    this.viewer = viewer;
    this.svg = null;
    this._isSinglePlayer = false;
    this._resizeObserver = null;
    this._resizeTimeout = null;
  }

  /**
   * Main entry — called after renderBuildOrder() finishes.
   * Uses requestAnimationFrame to ensure DOM layout is settled.
   */
  compute () {
    requestAnimationFrame(() => this._render());
  }

  _render () {
    // The spline maps two builds onto a shared time spine — pointless for
    // non-1v1 (single-player BO) games. Bail here too so a build-area resize
    // (via observeResize → recompute) can't resurrect it. 1v1 is unchanged.
    if (this.viewer && this.viewer.isNonOneVsOne && this.viewer.isNonOneVsOne()) {
      this.destroy();
      return;
    }

    const columnsEl = document.getElementById('bo-columns');
    const gap = document.getElementById('bo-timeline-gap');
    if (!columnsEl) return;

    // Remove previous SVG
    if (this.svg && this.svg.parentElement) {
      this.svg.parentElement.removeChild(this.svg);
      this.svg = null;
    }

    // Harvest anchors relative to #bo-columns
    const anchors = this._harvestAnchors(columnsEl);
    if (anchors.length < 2) return;

    // Build adaptive control points
    const controlPoints = this._buildControlPoints(anchors);
    if (controlPoints.length < 2) return;

    // Compute spine X position relative to #bo-columns
    const columnsRect = columnsEl.getBoundingClientRect();
    const isSinglePlayer = !gap || gap.style.display === 'none' || gap.offsetWidth === 0;
    this._isSinglePlayer = isSinglePlayer;

    let spineX;
    if (isSinglePlayer) {
      // Single-player: place spine to the left of the column
      const leftSide = columnsEl.querySelector('.bo-side-left');
      if (leftSide) {
        const sideRect = leftSide.getBoundingClientRect();
        spineX = sideRect.left - columnsRect.left - 24;
      } else {
        spineX = 24;
      }
    } else {
      // Multi-player: center in the gap
      const gapRect = gap.getBoundingClientRect();
      spineX = gapRect.left + gapRect.width / 2 - columnsRect.left;
    }

    const svgHeight = Math.max(
      columnsRect.height,
      controlPoints[controlPoints.length - 1].y + 20
    );

    // Create SVG and add reusable defs — parent is #bo-columns so it
    // tracks centering (max-width / margin:auto) at any viewport width
    this.svg = this._createSvg(columnsRect.width, svgHeight);
    this._addDefs();
    columnsEl.appendChild(this.svg);

    // Draw spine (with glow)
    this._renderSpine(spineX, controlPoints);

    // Draw connector arms with arrow nodes (before time markers so labels sit on top)
    this._renderConnectors(anchors, spineX, controlPoints);

    // Draw time markers last so label pills are never occluded
    const maxTime = Math.max(...anchors.map(a => a.gameTime));
    this._renderTimeMarkers(spineX, controlPoints, maxTime);
  }

  /**
   * Collect all [data-gametime] elements, recording their Y center
   * and inner edge X relative to #bo-content.
   */
  _harvestAnchors (container) {
    const containerRect = container.getBoundingClientRect();
    const elements = container.querySelectorAll('[data-gametime]');
    const anchors = [];

    elements.forEach(el => {
      const gt = parseFloat(el.dataset.gametime);
      if (isNaN(gt)) return;

      const rect = el.getBoundingClientRect();
      const yCenter = (rect.top + rect.bottom) / 2 - containerRect.top;
      const side = this._determineSide(el);

      // Inner edge = the edge closest to the spine
      const edgeX = side === 'left'
        ? rect.right - containerRect.left
        : rect.left - containerRect.left;

      anchors.push({ gameTime: gt, yCenter, edgeX, side, el });
    });

    anchors.sort((a, b) => a.gameTime - b.gameTime);
    return anchors;
  }

  /**
   * Determine which side of the spine an element is on.
   * In single-player mode, the spine is left of the column,
   * so all events are on the 'right' side.
   */
  _determineSide (el) {
    if (this._isSinglePlayer) return 'right';
    if (el.closest('.bo-side-left')) return 'left';
    if (el.closest('.bo-side-right')) return 'right';
    return 'left';
  }

  /**
   * Group anchors into 2-second time buckets, compute weighted-average Y.
   * Enforce monotonicity so the spine always goes downward.
   */
  _buildControlPoints (anchors) {
    const BUCKET_SIZE = 2000; // 2 seconds in ms (gameTime is milliseconds)
    const buckets = {};

    anchors.forEach(a => {
      const key = Math.round(a.gameTime / BUCKET_SIZE);
      if (!buckets[key]) buckets[key] = { times: [], ys: [] };
      buckets[key].times.push(a.gameTime);
      buckets[key].ys.push(a.yCenter);
    });

    const points = Object.keys(buckets)
      .sort((a, b) => a - b)
      .map(key => {
        const b = buckets[key];
        const avgTime = b.times.reduce((s, t) => s + t, 0) / b.times.length;
        const avgY = b.ys.reduce((s, y) => s + y, 0) / b.ys.length;
        return { time: avgTime, y: avgY };
      });

    // Enforce monotonicity (each point must be below the previous)
    for (let i = 1; i < points.length; i++) {
      if (points[i].y < points[i - 1].y + 1) {
        points[i].y = points[i - 1].y + 1;
      }
    }

    return points;
  }

  /**
   * Interpolate Y for a given game time using the control points.
   */
  _getSplineY (gameTime, controlPoints) {
    const cps = controlPoints;
    if (!cps.length) return 0;
    if (gameTime <= cps[0].time) return cps[0].y;
    if (gameTime >= cps[cps.length - 1].time) return cps[cps.length - 1].y;

    // Binary search
    let lo = 0;
    let hi = cps.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (cps[mid].time <= gameTime) lo = mid;
      else hi = mid;
    }

    const p0 = cps[lo];
    const p1 = cps[hi];
    if (p1.time === p0.time) return p0.y;
    const t = (gameTime - p0.time) / (p1.time - p0.time);
    return p0.y + t * (p1.y - p0.y);
  }

  // ── SVG creation ──

  _createSvg (width, height) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'bo-timeline-svg';
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    return svg;
  }

  _addDefs () {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

    // Glow filter for the spine line
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', 'bo-spine-glow');
    filter.setAttribute('x', '-50%');
    filter.setAttribute('y', '-10%');
    filter.setAttribute('width', '200%');
    filter.setAttribute('height', '120%');

    const blur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
    blur.setAttribute('in', 'SourceGraphic');
    blur.setAttribute('stdDeviation', '2');
    blur.setAttribute('result', 'blur');
    filter.appendChild(blur);

    const merge = document.createElementNS('http://www.w3.org/2000/svg', 'feMerge');
    const mn1 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
    mn1.setAttribute('in', 'blur');
    merge.appendChild(mn1);
    const mn2 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
    mn2.setAttribute('in', 'SourceGraphic');
    merge.appendChild(mn2);
    filter.appendChild(merge);
    defs.appendChild(filter);

    this.svg.appendChild(defs);
  }

  // ── Spine ──

  _renderSpine (spineX, controlPoints) {
    if (controlPoints.length < 2) return;
    const y1 = controlPoints[0].y - 8;
    const y2 = controlPoints[controlPoints.length - 1].y + 8;

    // Glow layer behind the main spine
    const glow = this._svgLine(spineX, y1, spineX, y2, 'bo-spline-glow');
    glow.setAttribute('filter', 'url(#bo-spine-glow)');

    // Main spine line
    this._svgLine(spineX, y1, spineX, y2, 'bo-spline-line');
  }

  // ── Time markers — hierarchical ruler/clock aesthetic ──

  _renderTimeMarkers (spineX, controlPoints, maxTime) {
    let lastMajorLabelY = -Infinity;
    let lastMinuteLabelY = -Infinity;

    // Short game fallback: label every minute if game is under 5 minutes
    const majorLabelInterval = maxTime < 300000 ? 60000 : 300000;

    // Step every 30 seconds for sub-tick granularity
    for (let t = 30000; t <= maxTime; t += 30000) {
      const y = this._getSplineY(t, controlPoints);
      const secs = t / 1000;
      const isMinute = secs % 60 === 0;
      const is5Min = secs % 300 === 0;
      const is10Min = secs % 600 === 0;

      const minutes = Math.floor(secs / 60);
      const sec = secs % 60;
      const label = minutes + ':' + (sec < 10 ? '0' : '') + sec;

      if (is10Min) {
        // ── 10-minute: wide background bar + bold label pill + diamond + ring ──
        this._svgRect(spineX - 26, y - 2, 52, 4, 0, 'bo-tick-bar-10m');
        this._svgRect(spineX - 28, y - 17, 56, 18, 5, 'bo-time-label-bg-10m');
        const text = this._svgText(spineX, y - 5, label, 'bo-time-label-10m');
        text.setAttribute('text-anchor', 'middle');
        this._svgDiamond(spineX, y, 8, 'bo-marker-10m');
        this._svgCircle(spineX, y, 14, 'bo-marker-10m-ring');
        lastMajorLabelY = y;
        lastMinuteLabelY = y;

      } else if (is5Min) {
        // ── 5-minute: background bar + label pill + diamond ──
        this._svgRect(spineX - 22, y - 1.5, 44, 3, 0, 'bo-tick-bar-5m');
        if (y - lastMajorLabelY > 30) {
          this._svgRect(spineX - 24, y - 16, 48, 16, 4, 'bo-time-label-bg-5m');
          const text = this._svgText(spineX, y - 5, label, 'bo-time-label-5m');
          text.setAttribute('text-anchor', 'middle');
          lastMajorLabelY = y;
        }
        this._svgDiamond(spineX, y, 6, 'bo-marker-5m');
        lastMinuteLabelY = y;

      } else if (isMinute) {
        // ── 1-minute: visible tick + label pill ──
        this._svgLine(spineX - 12, y, spineX + 12, y, 'bo-tick-1m');
        this._svgCircle(spineX, y, 3, 'bo-marker-1m');
        if (y - lastMinuteLabelY > 22) {
          this._svgRect(spineX - 20, y - 15, 40, 15, 4, 'bo-time-label-bg-1m');
          const text = this._svgText(spineX, y - 5, label, 'bo-time-label-1m');
          text.setAttribute('text-anchor', 'middle');
          lastMinuteLabelY = y;
        }

      } else {
        // ── 30-second: subtle but visible tick ──
        this._svgLine(spineX - 7, y, spineX + 7, y, 'bo-tick-30s');
      }
    }
  }

  // ── Connector arms ──

  _renderConnectors (anchors, spineX, controlPoints) {
    anchors.forEach(anchor => {
      const spineY = this._getSplineY(anchor.gameTime, controlPoints);
      const cardY = anchor.yCenter;
      const cardEdgeX = anchor.edgeX;

      const dy = cardY - spineY;
      const dx = cardEdgeX - spineX;
      let d;

      if (Math.abs(dy) < 3) {
        // Nearly horizontal — straight line
        d = `M ${spineX},${spineY} L ${cardEdgeX},${cardY}`;
      } else {
        // Flowing S-curve: control points at 70% horizontal spread
        // to keep tangents mostly horizontal at both endpoints
        const cpOffset = Math.abs(dx) * 0.7;
        const sign = dx > 0 ? 1 : -1;
        const cp1x = spineX + sign * cpOffset;
        const cp2x = cardEdgeX - sign * cpOffset;
        d = `M ${spineX},${spineY} C ${cp1x},${spineY} ${cp2x},${cardY} ${cardEdgeX},${cardY}`;
      }

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.classList.add('bo-connector');
      this.svg.appendChild(path);

      // Arrow node on the spine pointing toward the event
      const pointsRight = cardEdgeX > spineX;
      this._svgArrowNode(spineX, spineY, pointsRight, 'bo-spine-node');
    });
  }

  // ── SVG helpers ──

  _svgLine (x1, y1, x2, y2, className) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    el.setAttribute('x1', x1);
    el.setAttribute('y1', y1);
    el.setAttribute('x2', x2);
    el.setAttribute('y2', y2);
    if (className) el.setAttribute('class', className);
    this.svg.appendChild(el);
    return el;
  }

  _svgText (x, y, text, className) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    el.setAttribute('x', x);
    el.setAttribute('y', y);
    el.textContent = text;
    if (className) el.setAttribute('class', className);
    this.svg.appendChild(el);
    return el;
  }

  _svgCircle (cx, cy, r, className) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    el.setAttribute('cx', cx);
    el.setAttribute('cy', cy);
    el.setAttribute('r', r);
    if (className) el.setAttribute('class', className);
    this.svg.appendChild(el);
    return el;
  }

  _svgDiamond (cx, cy, size, className) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    const points = `${cx},${cy - size} ${cx + size},${cy} ${cx},${cy + size} ${cx - size},${cy}`;
    el.setAttribute('points', points);
    if (className) el.setAttribute('class', className);
    this.svg.appendChild(el);
    return el;
  }

  _svgRect (x, y, w, h, rx, className) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    el.setAttribute('x', x);
    el.setAttribute('y', y);
    el.setAttribute('width', w);
    el.setAttribute('height', h);
    if (rx) el.setAttribute('rx', rx);
    if (className) el.setAttribute('class', className);
    this.svg.appendChild(el);
    return el;
  }

  _svgArrowNode (cx, cy, pointsRight, className) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    const size = 4;
    let points;
    if (pointsRight) {
      points = `${cx - size},${cy - size} ${cx + size},${cy} ${cx - size},${cy + size}`;
    } else {
      points = `${cx + size},${cy - size} ${cx - size},${cy} ${cx + size},${cy + size}`;
    }
    el.setAttribute('points', points);
    if (className) el.setAttribute('class', className);
    this.svg.appendChild(el);
    return el;
  }

  // ── Resize handling ──

  recompute () {
    if (this._resizeTimeout) clearTimeout(this._resizeTimeout);
    this._resizeTimeout = setTimeout(() => {
      this._resizeTimeout = null;
      this.compute();
    }, 150);
  }

  observeResize () {
    if (this._resizeObserver) return;
    const buildArea = document.getElementById('build-area');
    if (!buildArea || typeof ResizeObserver === 'undefined') return;

    this._resizeObserver = new ResizeObserver(() => this.recompute());
    this._resizeObserver.observe(buildArea);
  }

  destroy () {
    if (this.svg && this.svg.parentElement) {
      this.svg.parentElement.removeChild(this.svg);
    }
    this.svg = null;
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }
};

window.TimelineSpline = TimelineSpline;
