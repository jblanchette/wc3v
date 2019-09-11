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

const Wc3vViewer = class {
  constructor () {
    this.reset();
  }

  reset () {
    this.canvas = null;
    this.ctx = null;
    this.scrubber = new window.TimeScrubber("main-wrapper", "main-canvas");

    this.mapData = null;
    this.mapImage = null;

    this.xScale = null;
    this.yScale = null;

    this.k = 1.0;

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
    this.reset();

    this.loadFile(filename);
    this.scrubber.init();
    this.scrubber.setupControls({
      "play": (e) => { this.togglePlay(e); },
      "speed": (e) => { this.toggleSpeed(e); }
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
        self.setup();
      } catch (e) {
        console.error("Error loading wc3v replay: ", e);
      }
    });

    console.log("host: ", window.location.hostname);
    const url = window.location.hostname.indexOf("ngrok") !== -1 ? 
      `http://3d393e0b.ngrok.io/replays/${filename}` : `http://localhost:8080/replays/${filename}`;

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

  toggleSpeed () {
    const speedModal = document.getElementById(`${this.scrubber.wrapperId}-speed-modal`);
    speedModal.style.display = speedModal.style.display !== "block" ? "block" : "none";
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

  stop () {
    this.scrubber.loadSvg(`#${this.scrubber.wrapperId}-play`, 'stop-icon');
    this.state = ScrubStates.stopped;

    this.stopRenderLoop();
  }

  setup () {
    this.gameTime = 0;

    this.setupPlayers();
    this.setupMap();

    this.canvas = document.getElementById("main-canvas");
    this.ctx = this.canvas.getContext("2d");

    // finishes the setup promise
    return this.loadMapFile().then(() => {
      this.setupDrawing();
      this.render();
    });
  }

  setupPlayers () {
    const colorMap = [
      "#959697",
      "#4E2A04",
      "#1CE6B9",
      "#0042FF",
      "#7EBFF1",
      "#540081",
      "#FFFC01",
      "#FF0303",
      "#fEBA0E",
      "#20C000",
      "#E55BB0",
      "#106246"
    ];

    Object.keys(this.mapData.players).forEach((playerId, index) => {
      const { startingPosition, units } = this.mapData.players[playerId];
      const { race, name } = this.mapData.replay.players[playerId];

      const player = new ClientPlayer(
        index,
        playerId, 
        startingPosition, 
        units, 
        name,
        race,
        colorMap[index]
      );

      this.players.push(player);
    });
  }

  setupMap () {
    const { maps } = window.gameData;

    // extract map info from replay data
    const { map } = this.mapData.replay;
    const { file } = map;
    const mapParts = file.split("/");

    this.matchEndTime = this.mapData.replay.duration;
    this.mapName = mapParts[mapParts.length - 1].toLowerCase();
    
    const foundMapName =  maps[this.mapName] ? this.mapName : Object.keys(maps).find(mapItem => {
      const searchName = maps[mapItem].name.toLowerCase();

      if (this.mapName.indexOf(searchName) !== -1) {
        return mapItem;
      }
    });

    this.mapInfo = maps[foundMapName];
  }

  setupView () {
    const { x, y, k } = this.transform;

    this.viewWidth = this.mapImage.width * k;
    this.viewHeight = this.mapImage.height * k;

    this.viewXRange = [ -(this.viewWidth / 2),  (this.viewWidth / 2) ];
    this.viewYRange = [ -(this.viewHeight / 2), (this.viewHeight / 2) ];
  }

  setupScales () {
    this.xScale = d3.scaleLinear()
      .domain(this.xExtent)
      .range(this.viewXRange);

    this.yScale = d3.scaleLinear()
      .domain(this.yExtent)
      .range(this.viewYRange);
  }

  setupMiddle () {
    this.middleX = (this.canvas.width / 2);
    this.middleY = (this.canvas.height / 2);
  }

  setupDrawing () {
    const { xExtent, yExtent } = this.mapInfo;
    const { width, height } = this.canvas;

    this.xExtent = xExtent;
    this.yExtent = yExtent;
    
    // camera transform
    this.transform = { x: 0.0, y: 0.0, k: 1.0 };

    this.setupView();
    this.setupScales();
    this.setupMiddle();

    const drawX = (this.xScale(xExtent[0]));
    const drawY = (this.yScale(yExtent[0]));

    this.zoom = d3.zoom()
      .on("zoom", () => {
        if (!this.ctx) {
          return;
        }

        this.transform = d3.event.transform;

        this.setupView();
        this.setupScales();

        this.render();
      });

    d3.select("#main-wrapper")
      .call(this.zoom);
  }

  clearCanvas () {
    const { ctx, canvas } = this;
    
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
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
    const { speed } = this.scrubber;

    if (this.lastFrameTimestamp === 0) {
      this.lastFrameTimestamp = timestamp;
    }

    this.lastFrameDelta += timestamp - this.lastFrameTimestamp; 
    this.lastFrameTimestamp = timestamp;
 
    while (this.lastFrameDelta >= timeStep) {
        this.update(timeStep * speed);
        this.lastFrameDelta -= timeStep;
    }

    if (this.gameTime >= this.matchEndTime) {
      console.log("match replay completed.");

      this.stop();
      return;
    }

    this.render();
    this.lastFrameId = requestAnimationFrame(this.mainLoop.bind(this));
  }

  update (dt) {
    this.gameTime += dt;

    this.players.forEach(player => {
      player.update(this.gameTime, dt);
    });
  }

  renderMapBackground () {
    const { ctx, transform, xExtent, yExtent, middleX, middleY, xScale, yScale } = this;
    const { width, height } = this.mapImage;
    const { x, y, k } = transform;

    const mapX = (this.middleX - (width / 2));
    const mapY = (this.middleY - (height / 2));

    const minXExtent = xExtent[0];
    const minYExtent = yExtent[0];

    const drawX = (transform.x + xScale(minXExtent) + middleX);
    const drawY = (transform.y + yScale(minYExtent) + middleY);

    ctx.drawImage(
      this.mapImage, 
      0,               // sourceX
      0,               // sourceY
      width,           // sourceWidth
      height,          // sourceHeight
      drawX,            // destX
      drawY,            // destY
      width * k,       // destWidth
      height * k       // destHeight
    );
  }

  render () {
    const { 
      ctx,
      transform,
      gameTime,
      matchEndTime, 
      xScale, 
      yScale,
      middleX,
      middleY
    } = this;

    this.clearCanvas();

    const { width, height } = this.mapImage;
    const { xExtent, yExtent } = this;

    const mapX = (this.middleX - (width / 2));
    const mapY = (this.middleY - (height / 2));

    const x = mapX + transform.x;
    const y = mapY + transform.y;
    const w = xScale(xExtent[1] - xExtent[0]);
    const h = yScale(yExtent[1] - yExtent[0]);

    this.renderMapBackground();

    this.ctx.globalAlpha = 0.4;
    //this.ctx.fillRect(x, y, w, h);
    this.ctx.globalAlpha = 1.0;

    this.players.forEach(player => {
      player.render(ctx, transform, gameTime, xScale, yScale, mapX, mapY);
    });

    this.scrubber.render(gameTime, matchEndTime);
  }
};

window.wc3v = new Wc3vViewer();
