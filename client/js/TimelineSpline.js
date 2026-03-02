/**
 * TimelineSpline — Adaptive SVG overlay for the build order panel.
 *
 * This is a pure overlay: it reads DOM positions from already-rendered
 * event elements, builds an adaptive time→Y mapping, then draws:
 *   - A vertical spine line in the #bo-timeline-gap
 *   - Time markers (1:00, 2:00, …) along the spine
 *   - Connector arms from each event to the spine
 *
 * The spine adapts to event density — it stretches where events are
 * dense and compresses where they're sparse, so connector arms stay
 * roughly horizontal.
 */

const TimelineSpline = class {
  constructor (viewer) {
    this.viewer = viewer;
    this.svg = null;
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
    const boContent = document.getElementById('bo-content');
    const gap = document.getElementById('bo-timeline-gap');
    if (!boContent || !gap) return;

    // Remove previous SVG
    if (this.svg && this.svg.parentElement) {
      this.svg.parentElement.removeChild(this.svg);
      this.svg = null;
    }

    // Harvest anchors from rendered events
    const anchors = this._harvestAnchors(boContent);
    if (anchors.length < 2) return;

    // Build adaptive control points
    const controlPoints = this._buildControlPoints(anchors);
    if (controlPoints.length < 2) return;

    // Compute spine X from the gap element
    const contentRect = boContent.getBoundingClientRect();
    const gapRect = gap.getBoundingClientRect();
    const spineX = gapRect.left + gapRect.width / 2 - contentRect.left;
    const svgHeight = Math.max(
      contentRect.height,
      controlPoints[controlPoints.length - 1].y + 20
    );

    // Create SVG
    this.svg = this._createSvg(contentRect.width, svgHeight);
    boContent.appendChild(this.svg);

    // Draw spine
    this._renderSpine(spineX, controlPoints);

    // Draw time markers
    const maxTime = Math.max(...anchors.map(a => a.gameTime));
    this._renderTimeMarkers(spineX, controlPoints, maxTime);

    // Draw connector arms
    this._renderConnectors(anchors, spineX, controlPoints);
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
   */
  _determineSide (el) {
    if (el.closest('.bo-side-left')) return 'left';
    if (el.closest('.bo-side-right')) return 'right';
    return 'left';
  }

  /**
   * Group anchors into 2-second time buckets, compute weighted-average Y.
   * Enforce monotonicity so the spine always goes downward.
   */
  _buildControlPoints (anchors) {
    const BUCKET_SIZE = 2; // seconds
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

  // ── Spine ──

  _renderSpine (spineX, controlPoints) {
    if (controlPoints.length < 2) return;
    const y1 = controlPoints[0].y - 8;
    const y2 = controlPoints[controlPoints.length - 1].y + 8;
    this._svgLine(spineX, y1, spineX, y2, 'bo-spline-line');
  }

  // ── Time markers ──

  _renderTimeMarkers (spineX, controlPoints, maxTime) {
    let lastLabelY = -Infinity;

    for (let t = 60; t <= maxTime; t += 60) {
      const y = this._getSplineY(t, controlPoints);

      // Tick
      this._svgLine(spineX - 8, y, spineX + 8, y, 'bo-time-marker-tick');

      // Dot
      this._svgCircle(spineX, y, 2.5, 'bo-time-marker-dot');

      // Label (skip if too close to previous)
      if (y - lastLabelY > 18) {
        const minutes = Math.floor(t / 60);
        const secs = t % 60;
        const label = `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
        const text = this._svgText(spineX, y - 5, label, 'bo-time-marker-label');
        text.setAttribute('text-anchor', 'middle');
        lastLabelY = y;
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
      let d;

      if (Math.abs(dy) < 3) {
        // Nearly horizontal — straight line
        d = `M ${spineX},${spineY} L ${cardEdgeX},${cardY}`;
      } else {
        // Cubic bezier with horizontal tangents at both ends
        const midX = (spineX + cardEdgeX) / 2;
        d = `M ${spineX},${spineY} C ${midX},${spineY} ${midX},${cardY} ${cardEdgeX},${cardY}`;
      }

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.classList.add('bo-connector');
      this.svg.appendChild(path);

      // Small dot on the spine
      this._svgCircle(spineX, spineY, 1.5, 'bo-time-marker-dot');
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
