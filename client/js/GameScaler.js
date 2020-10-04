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

  setup (mapInfo, mapImage, canvas, cameraRatio) {
    const { bounds } = mapInfo;

    this.mapInfo = mapInfo;
    this.mapImage = mapImage;
    this.canvas = canvas;
    this.cameraRatio = cameraRatio;

    this.mapExtent = {
      x: bounds.map[0],
      y: bounds.map[1]
    };

    this.cameraExtent = {
      x: bounds.camera[0],
      y: bounds.camera[1]
    };

    this.cameraBox = {
      left:   bounds.map[0][0],
      right:  bounds.map[0][1],
      top:    bounds.map[1][0],
      bottom: bounds.map[1][1],
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
    const { cameraRatio } = this;
    const { bounds } = this.mapInfo;

    this.viewWidth  = this.mapImage.width;
    this.viewHeight = this.mapImage.height;

    this.sceneWidth  = this.mapImage.width * cameraRatio.x;
    this.sceneHeight = this.mapImage.height * cameraRatio.y;

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

    const { innerBox } = cameraBox;

    this.xScale = _d3.scaleLinear()
      .domain(mapExtent.x)
      .range(mapRange.x);

    this.yScale = _d3.scaleLinear()
      .domain(mapExtent.y)
      .range(mapRange.y);

    this.unitXScale = _d3.scaleLinear()
      .range([ cameraBox.left, cameraBox.right ])
      .domain(cameraRange.x);

    this.unitYScale = _d3.scaleLinear()
      .range([ cameraBox.top, cameraBox.bottom ])
      .domain(cameraRange.y);

    this.gridXScale = _d3.scaleLinear()
      .domain([ 0, Math.abs(innerBox.left) + Math.abs(innerBox.right) ])
      .range([ innerBox.left, innerBox.right ]);

    this.gridYScale = _d3.scaleLinear()
      .domain([ 0, Math.abs(innerBox.top) + Math.abs(innerBox.bottom) ])
      .range([ innerBox.top, innerBox.bottom ]);
  }

  setupMiddle () {
    this.middleX = (this.canvas.width / 2);
    this.middleY = (this.canvas.height / 2);
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
