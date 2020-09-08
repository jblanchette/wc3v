const GameScaler = class {
  constructor () {
    this.xScale = null;
    this.yScale = null;

    this.cameraRatio = { x: 1, y: 1 };
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
      mapExtent,
      mapRange,
      _d3
    } = this;

    this.xScale = _d3.scaleLinear()
      .domain(mapExtent.x)
      .range(mapRange.x);

    this.yScale = _d3.scaleLinear()
      .domain(mapExtent.y)
      .range(mapRange.y);

    this.unitXScale = _d3.scaleLinear()
      .domain(cameraExtent.x)
      .range(cameraRange.x);

    this.unitYScale = _d3.scaleLinear()
      .domain(cameraExtent.y)
      .range(cameraRange.y);
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
