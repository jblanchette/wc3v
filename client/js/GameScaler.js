const GameScaler = class {
  constructor () {
    this.xScale = null;
    this.yScale = null;

    this.gridXScale = null;
    this.gridYScale = null;

    this.cameraRatio = { x: 1, y: 1 };
    this.cameraBox = {};
    this.canvas = null;

    // Physical backing-store scale. The LOGICAL coordinate space (mapImage /
    // sceneImage / middleX / middleY / xScale / yScale) is always the map-image
    // size; renderScale only shrinks the pixels we rasterize into. 1 = the
    // legacy "buffer px == map-image px" sizing. See computeRenderScale.
    this.renderScale = 1;

    // dependencies
    this._d3 = null;
  }

  // --- Physical buffer sizing -------------------------------------------
  //
  // The five stacked canvases used to be sized to the MAP IMAGE
  // (playableTiles × 16px, i.e. 1568²–2240²) and then CSS-downscaled to fit
  // the viewport — 3-10× more pixels than the screen ever shows, rasterized
  // every frame, five times over. That is pure fill rate, and on integrated
  // GPUs it was the single biggest cost left after the Aug 12 CPU pass.
  //
  // The fix does NOT touch the coordinate system. Logical space stays exactly
  // as it was; the backing store shrinks by `renderScale` and each 2D context
  // carries a matching base transform, so every drawing callsite keeps working
  // in logical px and nothing changes size on screen (icon radii, font sizes
  // and line widths ride the CTM). The GL canvas gets the same factor via
  // renderer.setPixelRatio.
  //
  // The ladder is deliberately coarse: it makes the scale self-hysteretic, so
  // ordinary window resizes don't reallocate the GL backing store (expensive
  // and janky) for a 3% change in the ideal.
  static get SCALE_LADDER () {
    return [ 0.2, 0.25, 0.3, 0.35, 0.42, 0.5, 0.6, 0.7, 0.85, 1 ];
  }

  // Ideal = the pixels the display box actually resolves. Because it is
  // derived from the CSS box, the buffer never drops BELOW what the screen
  // shows — this removes supersampling nobody can see, it cannot introduce
  // blur relative to a 1:1 display.
  computeRenderScale (cssWidth) {
    const cfg = (typeof window !== 'undefined' && window.WC3V_CONFIG &&
                 window.WC3V_CONFIG.perf) || {};
    const setting = cfg.canvasRenderScale;

    // Explicit false / 1 restores the old map-image sizing.
    if (setting === false || setting === 1) return 1;

    if (typeof setting === 'number' && isFinite(setting) && setting > 0) {
      return Math.max(0.2, Math.min(1, setting));
    }

    // 'auto' (the default) — match the display box in device pixels.
    const logicalW = this.mapImage && this.mapImage.width;
    if (!logicalW || !cssWidth || !isFinite(cssWidth)) return 1;

    const dprCap = (typeof cfg.canvasRenderDprCap === 'number' && cfg.canvasRenderDprCap > 0)
      ? cfg.canvasRenderDprCap : 1;
    const dpr = Math.min(
      (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
      dprCap
    );

    const ideal = (cssWidth * dpr) / logicalW;
    const ladder = GameScaler.SCALE_LADDER;
    for (let i = 0; i < ladder.length; i++) {
      if (ladder[i] >= ideal) return ladder[i];
    }
    return 1;
  }

  // Logical (coordinate-space) size of the map canvases. Every callsite that
  // used to read `canvas.width` as "the map image width" must read this
  // instead — canvas.width is now the PHYSICAL buffer.
  get logicalWidth ()  { return this.mapImage ? this.mapImage.width  : 0; }
  get logicalHeight () { return this.mapImage ? this.mapImage.height : 0; }

  // Physical backing-store size for a given logical dimension.
  bufferPx (logicalPx) {
    return Math.max(1, Math.round(logicalPx * this.renderScale));
  }

  // Apply the base transform + clear for one map canvas context. Callers work
  // in logical px from here on.
  resetContext (ctx) {
    if (!ctx) return;
    const r = this.renderScale || 1;
    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx.clearRect(0, 0, this.logicalWidth, this.logicalHeight);
  }

  addDependency (which, dep) {
    // for now injects d3 to keep web/node env synced
    this[which] = dep;
  }

  setup (mapInfo) {
    const { bounds } = mapInfo;

    this.mapInfo = mapInfo;

    this.mapExtent = {
      x: bounds.map[0],
      y: bounds.map[1]
    };

    this.cameraExtent = {
      x: bounds.camera[0],
      y: bounds.camera[1]
    };

    // the full size of the map camera box
    this.cameraBox = {
      left:   bounds.map[0][0],
      right:  bounds.map[0][1],
      top:    bounds.map[1][0],
      bottom: bounds.map[1][1],

      // the camera box the game displays
      innerBox: {
        left:   bounds.camera[0][0],
        right:  bounds.camera[0][1],
        top:    bounds.camera[1][0],
        bottom: bounds.camera[1][1]
      }
    };

    this.setupView();
    this.setupScales();
    this.setupMiddle();
    this.setupCropOffsets();
  }


  setupView () {
    const { bounds, gridSize } = this.mapInfo;
    const { playable, full } = gridSize;

    this.pixelsPerTile = 4;

    // full map image dimensions (used for background image cropping)
    this.fullMapImage = {
      width:  (full[0] * 4) * this.pixelsPerTile,
      height: (full[1] * 4) * this.pixelsPerTile
    };

    // pixels-per-game-unit derived from full map
    const mapRangeX = this.mapExtent.x[1] - this.mapExtent.x[0];
    const mapRangeY = Math.abs(this.mapExtent.y[1] - this.mapExtent.y[0]);
    this.pxPerUnit = this.fullMapImage.width / mapRangeX;

    // playable area bounds — use margins (boundary tile counts per side) when available,
    // fall back to centered assumption for backward compatibility
    const margins = gridSize.margins;  // [left, right, bottom, top] in tiles
    let playableBounds;

    if (margins) {
      playableBounds = {
        x: [ this.mapExtent.x[0] + margins[0] * 128,
             this.mapExtent.x[1] - margins[1] * 128 ],
        y: [ this.mapExtent.y[0] - margins[3] * 128,    // top = mapTop - topMargin*128
             this.mapExtent.y[1] + margins[2] * 128 ]    // bottom = mapBottom + bottomMargin*128
      };
    } else {
      const mapCenterX = (this.mapExtent.x[0] + this.mapExtent.x[1]) / 2;
      const mapCenterY = (this.mapExtent.y[0] + this.mapExtent.y[1]) / 2;
      const playableUnitsX = playable[0] * 128;
      const playableUnitsY = playable[1] * 128;
      playableBounds = {
        x: [ mapCenterX - playableUnitsX / 2, mapCenterX + playableUnitsX / 2 ],
        y: [ mapCenterY + playableUnitsY / 2, mapCenterY - playableUnitsY / 2 ]
      };
    }

    // viewport = playable area clamped to map extent
    this.viewExtent = {
      x: [
        Math.max(playableBounds.x[0], this.mapExtent.x[0]),
        Math.min(playableBounds.x[1], this.mapExtent.x[1])
      ],
      y: [
        Math.min(playableBounds.y[0], this.mapExtent.y[0]),
        Math.max(playableBounds.y[1], this.mapExtent.y[1])
      ]
    };

    // scene dimensions from viewport extent
    const viewRangeX = this.viewExtent.x[1] - this.viewExtent.x[0];
    const viewRangeY = Math.abs(this.viewExtent.y[1] - this.viewExtent.y[0]);

    this.sceneImage = {
      width:  Math.round(viewRangeX * this.pxPerUnit),
      height: Math.round(viewRangeY * this.pxPerUnit)
    };

    // mapImage = active canvas size = viewport area
    this.mapImage = this.sceneImage;

    this.viewWidth  = this.sceneImage.width;
    this.viewHeight = this.sceneImage.height;

    this.sceneWidth  = this.sceneImage.width;
    this.sceneHeight = this.sceneImage.height;

    this.mapRange = {
      x: [ -(this.fullMapImage.width / 2),  (this.fullMapImage.width / 2)  ],
      y: [ -(this.fullMapImage.height / 2), (this.fullMapImage.height / 2) ]
    };

    this.cameraRange = {
      x: [ -(this.sceneWidth / 2),  (this.sceneWidth / 2)  ],
      y: [ -(this.sceneHeight / 2), (this.sceneHeight / 2) ]
    };
  }

  setupScales () {
    const {
      viewExtent,
      cameraRange,
      cameraBox,
      _d3
    } = this;

    // map viewport game-coordinate bounds to pixel range
    this.xScale = _d3.scaleLinear()
      .domain(viewExtent.x)
      .range(cameraRange.x);

    this.yScale = _d3.scaleLinear()
      .domain(viewExtent.y)
      .range(cameraRange.y);

    this.gridXScale = _d3.scaleLinear()
      .domain([ 0, Math.abs(cameraBox.left) + Math.abs(cameraBox.right) ])
      .range([ cameraBox.left, cameraBox.right ]);

    this.gridYScale = _d3.scaleLinear()
      .domain([ 0, Math.abs(cameraBox.top) + Math.abs(cameraBox.bottom) ])
      .range([ cameraBox.top, cameraBox.bottom ]);
  }

  setupMiddle () {
    this.middleX = (this.sceneImage.width / 2);
    this.middleY = (this.sceneImage.height / 2);
  }

  setupCropOffsets () {
    // pixel offset of viewport area within the full map background image
    this.cropOffset = {
      x: (this.viewExtent.x[0] - this.mapExtent.x[0]) * this.pxPerUnit,
      y: (this.mapExtent.y[0] - this.viewExtent.y[0]) * this.pxPerUnit
    };
  }

  // The 3D terrain renderer (ThreeMapRenderer) is set after map setup so that
  // projectXY can use the real perspective camera instead of the d3 top-down
  // linear scales. While null, projectXY falls back to the 2D scales.
  setThreeRenderer (threeMapRenderer) {
    this.threeMapRenderer = threeMapRenderer;
  }

  // Canonical world→canvas projection for every 2D unit overlay element.
  // Returns { x, y } relative to canvas center (pre-middleX/middleY offset)
  // so legacy callsites keep working: `projectXY(x, y).x + middleX` yields the
  // final pixel coordinate.
  //
  // When the 3D terrain is active, this samples terrain height at (wx, wy)
  // and projects through the Three.js perspective camera. Otherwise it falls
  // back to the top-down d3 linear scales so setup-phase code keeps working.
  projectXY (wx, wy) {
    return this.projectXYInto(wx, wy, { x: 0, y: 0 });
  }

  // Allocation-free variant: writes into `out` and returns it (or null, which
  // still means "not projectable" — check the return, not `out`). Callers on
  // the per-unit path should hold one scratch object and reuse it; projectXY
  // stays as the allocating wrapper so cold callsites need no changes.
  //
  // NOTE the null contract: a null return leaves `out` holding STALE values.
  // Never read `out` after a null.
  projectXYInto (wx, wy, out) {
    const three = this.threeMapRenderer;
    if (three && three.ready) {
      const p = three.projectToCanvas(wx, wy, out);
      // null = point is behind camera or outside frustum; the d3 fallback
      // would invent a flat-scale pixel that has no relationship to where
      // the 3D camera is actually looking, so propagate the null instead.
      if (!p) return null;
      out.x = p.x - this.middleX;
      out.y = p.y - this.middleY;
      return out;
    }
    out.x = this.xScale(wx);
    out.y = this.yScale(wy);
    return out;
  }

  // Canonical projector for HTML/CSS overlay elements (camp icons, hover
  // labels, etc). Returns CSS pixel coords plus two flags:
  //   valid    — projection succeeded (point is inside the camera frustum)
  //   onScreen — pixel is inside the canvas CSS box, honouring `inset`
  // Callers typically gate visibility on onScreen but may still want valid
  // pixels (e.g. to measure a ring radius from an off-canvas edge point).
  // `canvas` is any of the four 2D canvases — they share a CSS box.
  // Read a canvas's CSS box + device-pixel ratio ONCE. clientWidth/clientHeight
  // are layout reads: interleaved with style writes (as an overlay-positioning
  // loop inevitably does) each one forces a synchronous reflow. Callers that
  // project many points per frame should hoist this out of their loop and pass
  // the result to projectToCssPixels as `metrics`.
  canvasMetrics (canvas) {
    // Serve from the per-frame cache when possible. The read itself is cheap;
    // what's expensive is WHERE it happens — a clientWidth read after any style
    // write in the same frame forces a synchronous layout. beginFrame() takes
    // the one read up front, before the frame writes anything, so every later
    // caller gets it for free.
    //
    // The five stacked canvases (main/player/utility/action/three) share both
    // their backing-store size and their CSS box — scaleLiveModeCanvas writes
    // the same style to all of them — so the cached metrics are valid for ANY
    // canvas with the same buffer dimensions, not just the primed one.
    const c = this._frameMetrics;
    if (c && (c.canvas === canvas ||
              (c.ok && c.canvas.width === canvas.width && c.canvas.height === canvas.height))) {
      return c;
    }
    return this._readCanvasMetrics(canvas);
  }

  _readCanvasMetrics (canvas) {
    // sx/sy convert LOGICAL canvas px → CSS px, and must stay defined against
    // the logical size, not the physical backing store. Everything that holds
    // a constant on-screen size (BaseNameplateRenderer's plate scale, CampPanel
    // icon placement, BuildingHoverLabel hit-testing) divides by these — if
    // they tracked the buffer, right-sizing the buffer would silently shrink
    // every nameplate. Falls back to the physical size for any canvas that
    // isn't one of the map canvases.
    const isMapCanvas = !!(this.mapImage &&
      this.bufferPx(this.mapImage.width)  === canvas.width &&
      this.bufferPx(this.mapImage.height) === canvas.height);
    const logicalW = isMapCanvas ? this.mapImage.width  : canvas.width;
    const logicalH = isMapCanvas ? this.mapImage.height : canvas.height;

    const cssW = canvas.clientWidth  || logicalW;
    const cssH = canvas.clientHeight || logicalH;
    const sx = logicalW / cssW;
    const sy = logicalH / cssH;
    const ok = !!(sx && sy && isFinite(sx) && isFinite(sy));
    return { canvas, cssW, cssH, sx, sy, ok, logicalW, logicalH };
  }

  // Call once at the top of the frame, BEFORE any style writes.
  //
  // Measured (perf-bench, Aug 2026): re-reading clientWidth every frame cost
  // ~0.5ms/frame — the per-frame style writes (scrubber tracker, camp icon
  // transforms, event-feed fades) leave layout dirty, so even the one
  // frame-top read forced a synchronous reflow. The CSS box only actually
  // changes on resize / layout-mode / fullscreen transitions, all of which
  // call invalidateMetrics(). A 1s wall-clock refresh backstops any missed
  // invalidation path (worst case: overlay icons drift for under a second).
  beginFrame (canvas) {
    if (!canvas) { this._frameMetrics = null; return null; }
    const c = this._frameMetrics;
    const now = performance.now();
    if (c && c.canvas === canvas && c.ok &&
        (now - this._metricsReadAt) < 1000) {
      return c;
    }
    this._frameMetrics = this._readCanvasMetrics(canvas);
    this._metricsReadAt = now;
    return this._frameMetrics;
  }

  // Force the next beginFrame to take a fresh layout read. Call after anything
  // that can change the canvas CSS box: window resize, layout-mode switch,
  // fullscreen toggle, live-mode canvas rescale.
  invalidateMetrics () {
    this._frameMetrics = null;
    this._metricsReadAt = 0;
  }

  projectToCssPixels (wx, wy, canvas, inset = 0, metrics = null) {
    // Scratch for the projection itself; the returned record stays a fresh
    // object because callers hold onto it (and it's one per overlay element,
    // not one per unit).
    if (!this._cssScratch) this._cssScratch = { x: 0, y: 0 };
    const p = this.projectXYInto(wx, wy, this._cssScratch);
    if (!p) return { cssX: 0, cssY: 0, valid: false, onScreen: false };
    const m = metrics || this.canvasMetrics(canvas);
    const { cssW, cssH, sx, sy } = m;
    if (!m.ok) {
      return { cssX: 0, cssY: 0, valid: false, onScreen: false };
    }
    const cssX = (p.x + this.middleX) / sx;
    const cssY = (p.y + this.middleY) / sy;
    const onScreen = cssX >= inset && cssX <= cssW - inset
                  && cssY >= inset && cssY <= cssH - inset;
    return { cssX, cssY, valid: true, onScreen };
  }
}

// CommonJS export for Node CLI + bundlers (esbuild).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GameScaler;
}
// Browser global for the existing client (script-tag-loaded) usage.
if (typeof window !== 'undefined') {
  window.GameScaler = GameScaler;
}
