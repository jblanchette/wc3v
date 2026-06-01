const GameScaler = class {
  constructor () {
    this.xScale = null;
    this.yScale = null;

    this.gridXScale = null;
    this.gridYScale = null;

    this.cameraRatio = { x: 1, y: 1 };
    this.cameraBox = {};
    this.canvas = null;

    // dependencies
    this._d3 = null;
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
    const three = this.threeMapRenderer;
    if (three && three.ready) {
      const p = three.projectToCanvas(wx, wy);
      // null = point is behind camera or outside frustum; the d3 fallback
      // would invent a flat-scale pixel that has no relationship to where
      // the 3D camera is actually looking, so propagate the null instead.
      return p ? { x: p.x - this.middleX, y: p.y - this.middleY } : null;
    }
    return { x: this.xScale(wx), y: this.yScale(wy) };
  }

  // Canonical projector for HTML/CSS overlay elements (camp icons, hover
  // labels, etc). Returns CSS pixel coords plus two flags:
  //   valid    — projection succeeded (point is inside the camera frustum)
  //   onScreen — pixel is inside the canvas CSS box, honouring `inset`
  // Callers typically gate visibility on onScreen but may still want valid
  // pixels (e.g. to measure a ring radius from an off-canvas edge point).
  // `canvas` is any of the four 2D canvases — they share a CSS box.
  projectToCssPixels (wx, wy, canvas, inset = 0) {
    const p = this.projectXY(wx, wy);
    if (!p) return { cssX: 0, cssY: 0, valid: false, onScreen: false };
    const cssW = canvas.clientWidth  || canvas.width;
    const cssH = canvas.clientHeight || canvas.height;
    const sx = canvas.width  / cssW;
    const sy = canvas.height / cssH;
    if (!sx || !sy || !isFinite(sx) || !isFinite(sy)) {
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
