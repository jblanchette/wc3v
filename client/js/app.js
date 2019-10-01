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

    this.playerStatusCanvas = null;
    this.playerStatusCtx = null;

    this.playerCanvas = null;
    this.playerCtx = null;

    this.utilityCanvas = null;
    this.utilityCtx = null;

    this.scrubber = new window.TimeScrubber("main-wrapper", "main-canvas");

    this.mapData = null;
    this.mapImage = null;

    this.xScale = null;
    this.yScale = null;

    this.k = 1.0;

    this.state = ScrubStates.stopped;

    this.gameLoaded = false;
    this.gameTime = 0;

    this.lastFrameId = null;
    this.lastFrameDelta = 0;
    this.lastFrameTimestamp = 0;

    this.players = [];
  }

  load () {
    const filename = document.getElementById(domMap.mapInputFieldId).value;

    this.pause();
    this.reset();

    this.setLoadingStatus(true);

    this.loadFile(filename);
    this.scrubber.init();
    this.scrubber.setupControls({
      "play": (e) => { this.togglePlay(e); },
      "speed": (e) => { this.toggleSpeed(e); },
      "track": (e) => { this.moveTracker(e); }
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

    const port = window.location.hostname === "localhost" ? ":8080" : "";
    const url = `http://${window.location.hostname}${port}/replays/${filename}`;

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

        const mapWidth = self.mapImage.width;
        const mapHeight = self.mapImage.height;

        self.canvas.width = mapWidth;
        self.canvas.height = mapHeight;

        self.playerCanvas.width = mapWidth;
        self.playerCanvas.height = mapHeight;

        self.utilityCanvas.width = mapWidth;
        self.utilityCanvas.height = mapHeight;

        resolve();
      }, false);
      
    });
  }

  moveTracker (e) {
    if (!this.gameLoaded) {
      return;
    }
    
    const trackerPosition = this.scrubber.findTrackerPosition(e, this.matchEndTime);
    const { gameTime, matchPercentage } = trackerPosition;

    this.gameTime = gameTime;
    this.scrubber.moveTracker(matchPercentage);

    this.players.forEach(player => player.moveTracker(gameTime));
    this.render();
  }

  setLoadingStatus (isLoading) {
    const loadingIcon = document.getElementById("loading-icon");
    const viewerOptionsPanel = document.getElementById("viewer-options");

    loadingIcon.style.display = isLoading ? "block" : "none";
    isLoading ? 
      viewerOptionsPanel.classList.add("disabled") :
      viewerOptionsPanel.classList.remove("disabled");
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
    speedModal.style.display = speedModal.style.display !== "block" ? 
      "block" : "none";
  }

  toggleMegaPlayButton (state) {
    this.megaPlayButton.style.display = state ? "block" : "none";
  }

  toggleViewOption (optionKey) {
    this.viewOptions[optionKey] = !this.viewOptions[optionKey];

    const el = document.getElementById(`viewer-option-${optionKey}`);
    if (!el) {
      return;
    }

    this.viewOptions[optionKey] ?
      el.classList.add('on') :
      el.classList.remove('on');

    if (this.gameLoaded) {
      this.render();
    }
  }

  play () {
    this.scrubber.loadSvg(`#${this.scrubber.wrapperId}-play`, 'pause-icon');
    this.state = ScrubStates.playing;

    this.toggleMegaPlayButton(false);
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

  setStatusTab (tab) {
    const el = document.getElementById(`${tab}-toggle`);
    const oldList = Array.from(document.getElementsByClassName("status-toggle selected"));

    oldList.forEach(oldEl => oldEl.classList.remove('selected'));
    el.classList.add('selected');

    this.players.forEach(player => player.setStatusTab(tab));

    if (!this.gameLoaded) {
      return;
    }

    this.render();
  }

  setup () {
    this.gameTime = 0;

    this.setStatusTab('heroes');
    this.setupViewOptions();

    this.setupPlayers();
    this.setupMap();

    this.canvas = document.getElementById("main-canvas");
    this.ctx = this.canvas.getContext("2d");

    this.playerStatusCanvas = document.getElementById("player-status-canvas");
    this.playerStatusCtx = this.playerStatusCanvas.getContext("2d");

    this.playerCanvas = document.getElementById("player-canvas");
    this.playerCtx = this.playerCanvas.getContext("2d");

    this.utilityCanvas = document.getElementById("utility-canvas");
    this.utilityCtx = this.utilityCanvas.getContext("2d");

    this.megaPlayButton = document.getElementById("mega-play-button");

    // player-status-toggles + player boxes
    this.playerStatusCanvas.height = 50 + (this.players.length * 140);

    this.playerStatusCtx.lineWidth = 1;
    this.playerStatusCtx.fillStyle = "#29373E";
    this.playerStatusCtx.strokeStyle = "#FFF";
    this.playerStatusCtx.font = '12px Arial';

    const playerLoaders = this.players.map(player => {
      return player.setup();
    });

    this.clearCanvas();

    // finishes the setup promise
    return this.loadMapFile()
    .then(playerLoaders)
    .then(() => {
      this.setupDrawing();
      this.render();
    });
  }

  setupViewOptions () {
    this.viewOptions = {
      displayText: true,
      displayPath: true,
      decayEffects: true
    };    

    Object.keys(this.viewOptions).forEach(optionKey => {
      const el = document.getElementById(`viewer-option-${optionKey}`);
      if (!el) {
        return;
      }

      this.viewOptions[optionKey] ?
        el.classList.add('on') :
        el.classList.remove('on');
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
      const { startingPosition, units, selectionStream } = this.mapData.players[playerId];
      const { race, name } = this.mapData.replay.players[playerId];

      const player = new ClientPlayer(
        index,
        playerId, 
        startingPosition, 
        units, 
        name,
        race,
        selectionStream,
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

    this.viewWidth = this.mapImage.width;
    this.viewHeight = this.mapImage.height;

    this.viewXRange = [ -(this.viewWidth / 2), (this.viewWidth / 2) ];
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
    // player ui toggle offsets
    this.playerSlotOffset = 0;
    // how far the camera will zoom
    const zoomScaleExtent = [ 1.0, 1.75 ];

    this.setupView();
    this.setupScales();
    this.setupMiddle();

    this.toggleMegaPlayButton(true);
    this.gameLoaded = true;

    this.setLoadingStatus(false);

    const zoomContainer = d3.select("#main-canvas");

    this.zoom = d3.zoom()
      .scaleExtent(zoomScaleExtent)
      .on("zoom", () => {
        if (!this.ctx) {
          return;
        }

        const { transform } = d3.event;
        // update our transform object from the zoom
        this.transform = transform;
        this.render();
      });

    zoomContainer
      .call(this.zoom);
  }

  clearCanvas () {
    const { 
      ctx, 
      playerCtx,
      playerStatusCtx,
      utilityCtx,
      canvas
    } = this;
    
    playerStatusCtx.save();
    playerStatusCtx.setTransform(1, 0, 0, 1, 0, 0);
    playerStatusCtx.clearRect(0, 0, canvas.width, canvas.height);
    playerStatusCtx.restore();

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    playerCtx.save();
    playerCtx.setTransform(1, 0, 0, 1, 0, 0);
    playerCtx.clearRect(0, 0, canvas.width, canvas.height);
    playerCtx.restore();

    utilityCtx.save();
    utilityCtx.setTransform(1, 0, 0, 1, 0, 0);
    utilityCtx.clearRect(0, 0, canvas.width, canvas.height);
    utilityCtx.restore();
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

    const drawX = (transform.x + xScale(xExtent[0]) + middleX);
    const drawY = (transform.y + yScale(yExtent[0]) + middleY);

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
      playerCtx,
      playerStatusCtx,
      utilityCtx,
      transform,
      gameTime,
      matchEndTime, 
      xScale, 
      yScale,
      middleX,
      middleY,
      viewOptions
    } = this;

    const { width, height } = this.mapImage;

    this.clearCanvas();

    ctx.save();    
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    playerCtx.save();    
    playerCtx.translate(transform.x, transform.y);
    playerCtx.scale(transform.k, transform.k);

    utilityCtx.save();    
    utilityCtx.translate(transform.x, transform.y);
    utilityCtx.scale(transform.k, transform.k);

    this.renderMapBackground();

    this.players.forEach(player => {
      player.render(
        ctx,
        playerCtx,
        utilityCtx,
        playerStatusCtx, 
        transform, 
        gameTime, 
        xScale, 
        yScale,
        viewOptions
      );
    });
    
    ctx.restore();
    playerCtx.restore();
    utilityCtx.restore();

    this.scrubber.render(gameTime, matchEndTime);
  }
};

window.wc3v = new Wc3vViewer();
