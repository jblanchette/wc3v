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
  }


  setupView () {
    const { bounds, gridSize } = this.mapInfo;
    const { playable, full } = gridSize;

    this.pixelsPerTile = 2;

    this.mapImage = {
      width:  (full[0] * 4) * this.pixelsPerTile,
      height: (full[1] * 4) * this.pixelsPerTile
    };

    this.sceneImage = {
      width:  (playable[0] * 4) * this.pixelsPerTile,
      height: (playable[1] * 4) * this.pixelsPerTile
    };

    // makes it easier to read/use
    this.viewWidth  = this.mapImage.width;
    this.viewHeight = this.mapImage.height;

    this.sceneWidth  = this.sceneImage.width;
    this.sceneHeight = this.sceneImage.height;

    ////
    // map range is the full sized range of map image
    ////

    this.mapRange = {
      x: [ -(this.viewWidth / 2),  (this.viewWidth / 2)  ],
      y: [ -(this.viewHeight / 2), (this.viewHeight / 2) ]
    };

    ////
    // camera range is the restricted inner camera range 
    // always <= than map range
    ////

    this.cameraRange = {
      x: [ -(this.sceneWidth / 2),  (this.sceneWidth / 2)  ],
      y: [ -(this.sceneHeight / 2), (this.sceneHeight / 2) ]
    };
  }

  setupScales () {
    const { 
      cameraExtent,
      cameraRange,
      cameraBox,
      mapExtent,
      mapRange,
      _d3
    } = this;

    //
    // in wc3 map formats the 'map' bounds are the full size and the 'camera' bounds
    // are in the inner in-game view box
    // 

    //
    // map the full [-x, x] map range of the map to scenes
    // broken apart quadrants [ -(viewWidth / 2) , (viewWidth / 2) ]
    // to map wc3 coordinates to our on screen coordinates
    //

    this.xScale = _d3.scaleLinear()
      .domain(mapExtent.x)
      .range(mapRange.x);

    //
    // same for [-y, y] map range
    //

    this.yScale = _d3.scaleLinear()
      .domain(mapExtent.y)
      .range(mapRange.y);

    this.gridXScale = _d3.scaleLinear()
      .domain([ 0, Math.abs(cameraBox.left) + Math.abs(cameraBox.right) ])
      .range([ cameraBox.left, cameraBox.right ]);

    this.gridYScale = _d3.scaleLinear()
      .domain([ 0, Math.abs(cameraBox.top) + Math.abs(cameraBox.bottom) ])
      .range([ cameraBox.top, cameraBox.bottom ]);
  }

  setupMiddle () {
    this.middleX = (this.mapImage.width / 2);
    this.middleY = (this.mapImage.height / 2);
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
