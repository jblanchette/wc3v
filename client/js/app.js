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

    this.cameraRatio = { x: 1, y: 1 };

    this.state = ScrubStates.stopped;

    this.gameLoaded = false;
    this.gameTime = 0;

    this.lastFrameId = null;
    this.lastFrameDelta = 0;
    this.lastFrameTimestamp = 0;

    this.players = [];
  }

  load () {
    const self = this;
    const rawFile = document.getElementById(domMap.mapInputFieldId).value;
    const filename = rawFile.replace('.wc3v', '.w3g.wc3v');

    this.pause();
    this.reset();

    this.setLoadingStatus(true);

    this.loadFile(filename, (res) => {
      try {
        const { target } = res;
        const jsonData = JSON.parse(target.responseText);
        
        self.mapData = jsonData;
        self.setup();
      } catch (e) {
        console.error("Error loading wc3v replay: ", e);
      }
    });

    this.scrubber.init();
    this.scrubber.setupControls({
      "play": (e) => { this.togglePlay(e); },
      "speed": (e) => { this.toggleSpeed(e); },
      "track": (e) => { this.moveTracker(e); }
    });
  }

  claimUploadTicket () {
    const self = this;
    const req = new XMLHttpRequest();
    const port = window.location.hostname === "10.0.0.81" ? ":8085" : "";
    const url = `http://${window.location.hostname}${port}/ticket`;

    req.addEventListener("load", (res) => {
      const { target } = res;
      const ticketData = JSON.parse(target.responseText);

      try {
        const { claimed, ticket } = ticketData;

        if (!claimed) {
          self.showTickedFailed();

          return;
        }

        self.showUpload(ticket.id);
      } catch (err) {
        self.showTickedFailed();
      }
    });

    req.open("GET", url);
    req.send();
  }

  showTickedFailed () {
    console.log("show ticked failed here");
  }

  showUpload (ticketId) {
    const inputFile = document.createElement("input");

    inputFile.setAttribute("type", "file");
    inputFile.setAttribute("accept", ".w3g")
    inputFile.click();

    inputFile.onchange = () => {
      const form = document.createElement("form");
      form.setAttribute("enctype", "multipart/form-data");
      form.setAttribute("action", "http://10.0.0.81:8085/upload");

      const formData = new FormData(form);
      formData.append("file", inputFile);

      const req = new XMLHttpRequest();
      req.open('POST', form.getAttribute('action'), true);
      req.setRequestHeader("ticketid", ticketId);
      
      req.send(formData);
    };
  }

  loadFile (filename, cb) {
    const req = new XMLHttpRequest();

    req.addEventListener("load", cb);

    const port = window.location.hostname === "localhost" ? ":8080" : "";
    const url = `http://${window.location.hostname}${port}/replays/${filename}`;

    req.open("GET", url);
    req.send();
  }

  loadMapFile (mapType) {
    const self = this;
    const { name } = this.mapInfo;

    if (mapType === "grid") {
      return new Promise((resolve, reject) => {
        self.gridMapImage = new Image();
        self.gridMapImage.src = `./maps/${name}/gridmap.jpg`;

        self.gridMapImage.addEventListener('load', () => {
          resolve();
        }, false);
      });
    }

    return new Promise((resolve, reject) => {
      self.mapImage = new Image();   // Create new img element
      self.mapImage.src = `./maps/${name}/map.jpg`; // Set source path

      self.mapImage.addEventListener('load', () => {
        const { bounds } = this.mapInfo;
        const { map, camera } = bounds;

        /*
          bound index selection - 
          not all camera grids are centered in the map grid,
          try to adjust so we show the lower ratio so enough
          of the actual map is shown
         */

        const xBoundIndex = (map[0][0] < camera[0][1]) ? 0 : 1;
        const yBoundIndex = (map[1][0] < camera[1][1]) ? 0 : 1;

        self.cameraRatio =  {
          x: (camera[0][xBoundIndex] / map[0][xBoundIndex]),
          y: (camera[1][yBoundIndex] / map[1][yBoundIndex])
        };

        const mapWidth = self.mapImage.width * self.cameraRatio.x;
        const mapHeight = self.mapImage.height * self.cameraRatio.y;

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

  loadGridFile () {
    const self = this;
    const { name } = this.mapInfo;

    return new Promise((resolve, reject) => {
      this.loadFile(`../maps/${name}/wpm.json`, (res) => {
        const { target } = res;
        const jsonData = JSON.parse(target.responseText);
          
        self.gridData = jsonData.grid;

        resolve(true);
      });
    })
  }

  loadDoodadFile () {
    const self = this;
    const { name } = this.mapInfo;

    return new Promise((resolve, reject) => {
      this.loadFile(`../maps/${name}/doo.json`, (res) => {
        const { target } = res;
        const jsonData = JSON.parse(target.responseText);
          
        self.doodadData = jsonData.grid;
        resolve(true);
      });
    })
  }

  ////
  // handle click event on time scrubber tracker
  ////
  moveTracker (e) {
    if (!this.gameLoaded) {
      return;
    }

    // make sure mega play button is hidden
    this.toggleMegaPlayButton(false);
    
    const trackerPosition = this.scrubber.findTrackerPosition(e, this.matchEndTime);
    const { gameTime, matchPercentage } = trackerPosition;

    this.gameTime = gameTime;
    this.scrubber.moveTracker(matchPercentage);

    this.players.forEach(player => player.moveTracker(gameTime));
    this.render();
  }

  ////
  // show / hide loading indicators
  ////
  setLoadingStatus (isLoading) {
    const loadingIcon = document.getElementById("loading-icon");
    const logoIcon = document.getElementById("player-status-bg-icon");
    const viewerOptionsPanel = document.getElementById("viewer-options");
    const mapOptionsPanel = document.getElementById("map-options");

    loadingIcon.style.display = isLoading ? "block" : "none";
    logoIcon.style.display = isLoading ? "block" : "none";

    isLoading ? 
      viewerOptionsPanel.classList.add("disabled") :
      viewerOptionsPanel.classList.remove("disabled");

    isLoading ? 
      mapOptionsPanel.classList.add("disabled") :
      mapOptionsPanel.classList.remove("disabled");
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
    const { wrapperId } = this.scrubber;

    this.scrubber.loadSvg(`#${wrapperId}-play`, 'pause-icon');
    this.state = ScrubStates.playing;

    this.toggleMegaPlayButton(false);
    this.startRenderLoop();
  }

  pause () {
    const { wrapperId } = this.scrubber;

    this.scrubber.loadSvg(`#${wrapperId}-play`, 'play-icon');
    this.state = ScrubStates.paused;

    this.stopRenderLoop();
  }

  stop () {
    const { wrapperId } = this.scrubber;

    this.scrubber.loadSvg(`#${wrapperId}-play`, 'stop-icon');
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

    const playerLoadedPromiseList = this.players.map(player => {
      return player.setup();
    });

    this.clearCanvas();

    // finishes the setup promise
    return this.loadMapFile()
    .then(() => { return this.loadMapFile("grid"); })
    .then(() => { return this.loadGridFile(); })
    .then(() => { return this.loadDoodadFile(); })
    .then(playerLoadedPromiseList)
    .then(() => {
      this.setupDrawing();
      this.render();
    });
  }

  setupViewOptions () {
    this.viewOptions = {
      displayPath: false,
      displayLeveLDots: true,
      decayEffects: true,
      displayText: true,

      displayMapGrid: false,
      displayTreeGrid: false,
      displayWalkGrid: false,
      displayBuildGrid: false,
      displayWaterGrid: false
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
      "#7EBFF1",
      "#1CE6B9",
      "#0042FF",
      "#540081",
      "#FFFC01",
      "#FF0303",
      "#fEBA0E",
      "#20C000",
      "#E55BB0",
      "#106246",
      "#4E2A04"
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
    const { cameraRatio } = this;
    const { x, y, k } = this.transform;
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
      mapRange
    } = this;

    this.xScale = d3.scaleLinear()
      .domain(mapExtent.x)
      .range(mapRange.x);

    this.yScale = d3.scaleLinear()
      .domain(mapExtent.y)
      .range(mapRange.y);

    this.unitXScale = d3.scaleLinear()
      .domain(cameraExtent.x)
      .range(cameraRange.x);

    this.unitYScale = d3.scaleLinear()
      .domain(cameraExtent.y)
      .range(cameraRange.y);
  }

  setupMiddle () {
    this.middleX = (this.canvas.width / 2);
    this.middleY = (this.canvas.height / 2);
  }

  setupDrawing () {
    const { bounds } = this.mapInfo;
    const { width, height } = this.canvas;

    this.mapExtent = {
      x: bounds.map[0],
      y: bounds.map[1]
    };

    this.cameraExtent = {
      x: bounds.camera[0],
      y: bounds.camera[1]
    };
    
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
      .translateExtent([[0, 0], [width, height]])
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

    this.render();
    
    if (this.gameTime >= this.matchEndTime) {
      console.log("match replay completed.");

      this.stop();
      return;
    }

    this.lastFrameId = requestAnimationFrame(this.mainLoop.bind(this));
  }

  update (dt) {
    this.gameTime += dt;

    this.players.forEach(player => {
      player.update(this.gameTime, dt);
    });
  }

  renderMapBackground () {
    const { 
      ctx, 
      transform, 
      mapExtent, 
      middleX, 
      middleY, 
      xScale, 
      yScale,
      viewOptions
    } = this;

    const { width, height } = this.mapImage;
    const { x, y, k } = transform;

    const drawX = (transform.x + xScale(mapExtent.x[0]) + middleX);
    const drawY = (transform.y + yScale(mapExtent.y[0]) + middleY);

    const bgImage = viewOptions.displayMapGrid ? 
      this.gridMapImage : this.mapImage;

    const offsetX = (this.viewWidth - this.sceneWidth) / 2;
    const offsetY = (this.viewHeight - this.sceneHeight) / 2;

    ctx.drawImage(
      bgImage, 
      offsetX,               // sourceX
      offsetY,               // sourceY
      this.sceneWidth,           // sourceWidth
      this.sceneHeight,          // sourceHeight
      drawX + offsetX,           // destX
      drawY + offsetY,           // destY
      this.sceneWidth * k,       // destWidth
      this.sceneHeight * k       // destHeight
    );
  }

  renderMapTrees (ctx) {
    const { transform, middleX, middleY, xScale, yScale, viewOptions } = this;
    if (!viewOptions.displayTreeGrid) {
      return;
    }

    const treeSize = (4 * transform.k);

    ctx.strokeStyle = "#FFF";
    this.doodadData.forEach(tree => {
      const { x, y, flags } = tree;

      /*
        flags :
          0 = invisible and non-solid tree
          1 = visible but non-solid tree
          2 = normal tree (visible and solid)
       */

      if (flags === 0) {
        return;
      }

      // (x * transform.k) + transform.x
      // (y * transform.k) + transform.y

      const drawX = ((xScale(x) + middleX) * transform.k) + transform.x;
      const drawY = ((yScale(y) + middleY) * transform.k) + transform.y;

      ctx.beginPath();
      ctx.arc(drawX, drawY, treeSize * tree.yScale, 0, Math.PI * 2, true);
      ctx.stroke();
    });
  }

  renderMapGrid (ctx) {
    const { transform, viewOptions } = this;


    if (!viewOptions.displayWalkGrid  &&
        !viewOptions.displayWaterGrid &&
        !viewOptions.displayBuildGrid) {
      return;
    }

    const gridHeight = this.gridData.length    / 4;
    const gridWidth  = this.gridData[0].length / 4;

    const { width, height } = this.canvas;

    const tileHeight = (height / gridHeight) * transform.k;
    const tileWidth  = (width  / gridWidth)  * transform.k;

    
    ctx.lineWidth = 1;

    for (let col = 0; col < gridHeight; col++) {
      for (let row = 0; row < gridWidth; row++) {
        const data = this.gridData[col][row];
        const drawX = (row * tileWidth)  + transform.x;
        const drawY = (col * tileHeight) + transform.y;

        if (!data) {
          console.error("bad grid data: ", col, row);
          return;
        }

        const { 
          NoWater, 
          NoWalk, 
          NoBuild
        } = data;

        if (viewOptions.displayWalkGrid && !NoWalk) {
          ctx.strokeStyle = "#FFF";
          ctx.strokeRect(drawX, drawY, tileWidth, tileHeight);
        }

        if (viewOptions.displayWaterGrid && !NoWater) {
          ctx.strokeStyle = "#0000AA";
          ctx.strokeRect(drawX, drawY, tileWidth, tileHeight);
        }

        if (viewOptions.displayBuildGrid && NoBuild) {
          ctx.strokeStyle = "#00AA00";
          ctx.strokeRect(drawX, drawY, tileWidth, tileHeight);
        }
      }
    }
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
      unitXScale,
      unitYScale,
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

    // stored data about each frame
    let frameData = { nameplateTree: new rbush(), unitDrawPositions: [] };

    this.players.forEach(player => {
      player.render(
        frameData,
        ctx,
        playerCtx,
        utilityCtx,
        playerStatusCtx, 
        transform, 
        gameTime, 
        unitXScale, 
        unitYScale,
        viewOptions
      );
    });

    this.renderMapGrid(utilityCtx);
    this.renderMapTrees(utilityCtx);

    ctx.restore();
    playerCtx.restore();
    utilityCtx.restore();

    this.scrubber.render(gameTime, matchEndTime);
  }
};

window.wc3v = new Wc3vViewer();
