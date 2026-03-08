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

    this.pixelsPerTile = 2;

    // full map image dimensions (used for background image cropping)
    this.fullMapImage = {
      width:  (full[0] * 4) * this.pixelsPerTile,
      height: (full[1] * 4) * this.pixelsPerTile
    };

    // pixels-per-game-unit derived from full map
    const mapRangeX = this.mapExtent.x[1] - this.mapExtent.x[0];
    const mapRangeY = Math.abs(this.mapExtent.y[1] - this.mapExtent.y[0]);
    this.pxPerUnit = this.fullMapImage.width / mapRangeX;

    // the playable area is defined by the playable tile count, centered in the full map
    // this is separate from camera bounds (which define where the camera center can scroll)
    const mapCenterX = (this.mapExtent.x[0] + this.mapExtent.x[1]) / 2;
    const mapCenterY = (this.mapExtent.y[0] + this.mapExtent.y[1]) / 2;
    const playableUnitsX = playable[0] * 128;
    const playableUnitsY = playable[1] * 128;

    const playableBounds = {
      x: [ mapCenterX - playableUnitsX / 2, mapCenterX + playableUnitsX / 2 ],
      y: [ mapCenterY + playableUnitsY / 2, mapCenterY - playableUnitsY / 2 ]  // Y: top is positive
    };

    // viewport extent = union of playable area and camera bounds
    // camera can extend beyond playable in some axes, playable extends beyond camera in others
    this.viewExtent = {
      x: [
        Math.min(playableBounds.x[0], this.cameraExtent.x[0]),
        Math.max(playableBounds.x[1], this.cameraExtent.x[1])
      ],
      y: [
        Math.max(playableBounds.y[0], this.cameraExtent.y[0]),
        Math.min(playableBounds.y[1], this.cameraExtent.y[1])
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
}

try {
  if (window) {
    window.GameScaler = GameScaler;
  }
} catch (e) {
  // noop
  module.exports = GameScaler;
}
