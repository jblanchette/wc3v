const domMap = {
  "mapInputFieldId": "input-map-file",
  "playerListId": "player-list",
  "unitListId": "unit-list",
  "unitInfoId": "unit-info"
};

window.colorMap = {
  "black": "#000000",
  "buildingOutline": "#00FF00",
  "unitPath": "#00FFFF"
};

const ScrubStates = {
  stopped: 0,
  paused: 1,
  playing: 2,
  finished: 3
};

const Wc3vViewer = class extends LegacyApp {
  constructor () {
    super();

    this.canvas = null;
    this.ctx = null;
    this.scrubber = new window.TimeScrubber("main-wrapper", "main-canvas");

    this.mapData = null;
    this.mapImage = null;

    this.xScale = null;
    this.yScale = null;

    this.state = ScrubStates.stopped;

    this.gameTime = 0;

    this.lastFrameId = null;
    this.lastFrameDelta = 0;
    this.lastFrameTimestamp = 0;

    this.players = [];
  }

  load () {
    const filename = document.getElementById(domMap.mapInputFieldId).value;
    console.log('1 loading wc3v replay: ', filename);

    this.pause();

    this.loadFile(filename);
    this.scrubber.init();
    this.scrubber.setupControls({
      "play": (e) => { this.togglePlay(e); }
    });
  }

  loadFile (filename) {
    const self = this;
    const req = new XMLHttpRequest();

    req.addEventListener("load", (res) => {
      try {
        const { target } = res;
        const jsonData = JSON.parse(target.responseText);
        
        self.mapData = jsonData;
        // setup the map units
        self.setup();
      } catch (e) {
        console.error("Error loading wc3v replay: ", e);

        reject(e);
      }
    });

    const url = `http://localhost:8080/replays/${filename}`;

    this.setupLinks(filename, url);

    req.open("GET", url);
    req.send();
  }

  loadMapFile () {
    const self = this;
    const { name } = this.mapInfo;

    return new Promise((resolve, reject) => {
      self.mapImage = new Image();   // Create new img element
      self.mapImage.src = `./maps/${name}/map.jpg`; // Set source path

      self.mapImage.addEventListener('load', () => {
        resolve();
      }, false);
      
    });
  }

  togglePlay () {
    switch (this.state) {
      case ScrubStates.playing:
        this.pause();
      break;
      default:
        this.play();
      break;
    }
  }

  play () {
    this.scrubber.loadSvg(`#${this.scrubber.wrapperId}-play`, 'pause-icon');
    this.state = ScrubStates.playing;

    this.startRenderLoop();
  }

  pause () {
    this.scrubber.loadSvg(`#${this.scrubber.wrapperId}-play`, 'play-icon');
    this.state = ScrubStates.paused;

    this.stopRenderLoop();
  }

  setup () {
    super.setup();
    ///

    this.gameTime = 0;

    this.setupPlayers();
    this.setupMap();

    this.canvas = document.getElementById("main-canvas");
    this.ctx = this.canvas.getContext("2d");

    // finishes the setup promise
    return this.loadMapFile().then(() => {
      this.setupDrawing();
      this.clearCanvas();
      this.renderMapBackground();
    });
  }

  setupPlayers () {
    Object.keys(this.mapData.players).forEach(playerId => {
      const { startingPosition, units } = this.mapData.players[playerId];

      this.players.push(new ClientPlayer(playerId, startingPosition, units));
    });
  }

  setupMap () {
    const { maps } = window.gameData;

    // extract map info from replay data
    const { map } = this.mapData.replay;
    const { file } = map;
    const mapParts = file.split("/");

    this.mapName = mapParts[mapParts.length - 1].toLowerCase();
    
    const foundMapName =  maps[this.mapName] ? this.mapName : Object.keys(maps).find(mapItem => {
      const searchName = maps[mapItem].name.toLowerCase();

      if (this.mapName.indexOf(searchName) !== -1) {
        return mapItem;
      }
    });

    this.mapInfo = maps[foundMapName];
  }

  setupDrawing () {
    this.viewWidth = this.mapImage.width;
    this.viewHeight = this.mapImage.height;

    this.middleX = (this.canvas.width / 2);
    this.middleY = (this.canvas.height / 2);

    this.viewXRange = [ -(this.viewWidth / 2),  (this.viewWidth / 2)  ];
    this.viewYRange = [ -(this.viewHeight / 2), (this.viewHeight / 2) ];

    const { xExtent, yExtent } = this.mapInfo;

    this.xExtent = xExtent;
    this.yExtent = yExtent;

    this.xScale = d3.scaleLinear()
      .domain(this.xExtent)
      .range(this.viewXRange);

    this.yScale = d3.scaleLinear()
      .domain(this.yExtent)
      .range(this.viewYRange);
  }

  clearCanvas () {
    const { ctx, canvas } = this;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  renderMapBackground () {
    const { ctx } = this;

    const mapX = (this.middleX - (this.mapImage.width / 2));
    const mapY = (this.middleY - (this.mapImage.height / 2));
    
    ctx.drawImage(this.mapImage, mapX, mapY);
  }

  startRenderLoop () {
    this.lastFrameTimestamp = 0;
    this.lastFrameId = requestAnimationFrame(this.mainLoop.bind(this));
  }

  stopRenderLoop () {
    cancelAnimationFrame(this.lastFrameId);
  }

  mainLoop(timestamp) {
    const timeStep = this.scrubber.getTimeStep();

    if (this.lastFrameTimestamp === 0) {
      this.lastFrameTimestamp = timestamp;
    }

    this.lastFrameDelta += timestamp - this.lastFrameTimestamp; 
    this.lastFrameTimestamp = timestamp;
 
    while (this.lastFrameDelta >= timeStep) {
        this.update(timeStep);
        this.lastFrameDelta -= timeStep;
    }

    this.render();
    this.lastFrameId = requestAnimationFrame(this.mainLoop.bind(this));
  }

  update (dt) {
    this.gameTime += dt;
  }

  render () {
    const { 
      ctx,
      gameTime, 
      xScale, 
      yScale,
      middleX,
      middleY
    } = this;

    this.clearCanvas();
    this.renderMapBackground();

    this.players.forEach(player => {
      player.render(ctx, this.gameTime, xScale, yScale, middleX, middleY);
    });

    const gt = this.gameTime.toFixed(2);
    ctx.fillText(`Game Time: ${gt}`, 10, 10);
  }
};

window.wc3v = new Wc3vViewer();
