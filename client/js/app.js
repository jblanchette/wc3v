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

const TeamColorList = [
  "#FF0000",
  "#1CE6B9",
  "#0042FF",
  "#FFFC01"
];

const Wc3vViewer = class {
  constructor () {
    this.reset();
  }

  bootstrap () {
    this.setupControls();

    const urlParams = new URLSearchParams(window.location.search);
    const replay = urlParams.get('r');

    const hrefPath = window.location.href;
    const re = new RegExp('replay/(.*)', 'i');

    const match = re.exec(hrefPath);
    if (match) {
      setTimeout(() => {
        this.load(`${encodeURI(match[1])}.wc3v`);
      });
    } else {
      if (!this.isDev) {
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const localReplay = params.get('r');

      if (localReplay) {
        console.log('loading local replay: ', localReplay);
        setTimeout(() => {
          this.load(`${encodeURI(localReplay)}.wc3v`);
        });
      }
    }
  }

  setupControls () {
    const self = this;
    const menuPanel = document.getElementById("panel");
    const menuTarget = document.getElementById("menu-target");

    const searchButton = document.getElementById("search-submit");

    // call out to get wc3v
    this.loadInfo();

    menuTarget.addEventListener("click", (e) => {
      menuPanel.style.display = (menuPanel.style.display === "none") ? "block" : "none";
    });

    searchButton.addEventListener("click", (e) => {
      const searchText = document.getElementById("main-search").value;

      if (searchText && searchText.trim().length > 0) {
        const replayId = searchText.trim();
        const urlPath = this.isDev ? `:8080?r=${replayId}` : `/replay/${replayId}`;
        const url = `http://${window.location.hostname}${urlPath}`;

        window.location.href = url;
      }
    });

    const proGames = [
      {
        id: "happy-vs-grubby",
        map: "Concealed Hills",
        players: [["Happy"], ["Grubby"]]
      },
      {
        id: "grubby-vs-thorzain",
        map: "Concealed Hills",
        players: [["Grubby"], ["Thorzain"]]
      },
      {
        id: "cash-vs-foggy",
        map: "Concealed Hills",
        players: [["Cash"], ["Foggy"]]
      },
      {
        id: "happy-vs-lucifer",
        map: "Echo Isles",
        players: [["Happy"], ["lucifer"]]
      },
      {
        id: "foggy-vs-cash-2",
        map: "Echo Isles",
        players: [["Foggy"], ["Cash"]]
      },
      {
        id: "terenas-stand-lv_sonik-vs-tgw",
        map: "Terenas Stand",
        players: [["Sonik"], ["TGW"]]
      },
      {
        id: "2v2-synergy",
        map: "2v2-synergy",
        players: [["Thorzain", "Starshaped"], ["KNOIF", "LILD.C"]]
      },
      {
        id: "insup-vs-kiwi",
        map: "Concealed Hills",
        players: [["INSUPERABLE"], ["KiWiKaKi"]]
      }
    ];

    const proGamesTable = document.getElementById("pro-replays-table");

    proGames.forEach((game) => {
      const row = document.createElement("tr");

      const playersStr = game.players.map(team => {
        return team.join(", ");
      }).join(" vs ");

      const replayId = game.id;
      const urlPath = this.isDev ? `:8080?r=${replayId}` : `/replay/${replayId}`;
      const url = `http://${window.location.hostname}${urlPath}`;

      row.innerHTML = `
       <td>${playersStr}</td>
       <td>${game.map}</td>
       <td><a href="${url}">link</a></td>
      `;

      proGamesTable.append(row);
    });

    this.tutorialWindow = document.getElementById("tutorial-wrapper");
    this.tutorialWindow.style.display = "block";
  }

  reset () {
    this.players = [];

    this.canvas = null;
    this.ctx = null;

    this.playerStatusCanvas = null;
    this.playerStatusCtx = null;

    this.playerCanvas = null;
    this.playerCtx = null;

    this.utilityCanvas = null;
    this.utilityCtx = null;

    this.scrubber = new window.TimeScrubber("main-wrapper", "main-canvas");

    this.replayId = null;

    this.mapData = null;
    this.mapImage = null;

    this.state = ScrubStates.stopped;

    this.gameLoaded = false;
    this.gameTime = 0;

    this.lastFrameId = null;
    this.lastFrameDelta = 0;
    this.lastFrameTimestamp = 0;

    this.teamColorMap = {};

    this.isDev = (window.location.hostname === "127.0.0.1");
  }

  load (mapId = null) {
    const self = this;
    const rawFile = mapId || document.getElementById(domMap.mapInputFieldId).value;
    const filename = mapId || rawFile.replace('.wc3v', '.w3g.wc3v');

    this.pause();
    this.reset();

    this.setLoadingStatus(true);

    this.loadFile(filename, (res) => {
      try {

        if (res.target.status >= 300) {
          self.showUploadContents("upload-error");

          return;
        }

        const { target } = res;
        const jsonData = JSON.parse(target.responseText);
        
        self.replayId = filename;
        self.mapData = jsonData;

        self.setup(); 
        // removing loading status indicator
        self.setLoadingStatus(false);
      } catch (e) {
        console.log("raw: ", res);
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
    const port = this.isDev ? ":8085" : "";
    const url = `http://${window.location.hostname}${port}/ticket`;

    this.hideTutorial();

    req.addEventListener("load", (res) => {
      const { target } = res;
      const ticketData = JSON.parse(target.responseText);

      try {
        const { claimed, ticket } = ticketData;

        if (!claimed) {
          self.showUploadContents("upload-no-ticket");

          return;
        }

        self.showUpload(ticket.id);
      } catch (err) {
        console.log("ticket error: ", err);
        self.showUploadContents("upload-error");
      }
    });

    req.open("GET", url);
    req.send();
  }

  toggleUploadWrapper (isOpen) {
    const uploadWrapperEl = document.getElementById("upload-wrapper");

    uploadWrapperEl.style.display = isOpen ? "block" : "none";
  }

  toggleSidePanel (id, isOpen) {
    this.hideSidePanels();

    const el = document.getElementById(id);
    const currentDisplay = window.getComputedStyle(el).display;

    el.style.display = currentDisplay === "block" ? "none" : "block";
  }

  showSidePanel (id) {
    this.hideSidePanels();

    const el = document.getElementById(id);

    el.style.display = "block";
  }

  hideSidePanels () {
    const panels = [
      "pro-replays",
      "about-wc3v",
      "recent-replays"
    ];

    panels.forEach(id => {
      const el = document.getElementById(id);

      el.style.display = "none";
    });
  }

  hideTutorial() {
    console.log(this.tutorialWindow);

    this.tutorialWindow.style.display = "none";
  }

  advanceTutorial (nextSlide) {
    for (let i = 1; i <= 4; i++) {
      const items = document.getElementsByClassName(`slide-${i}`);
      const el = items[0];

      if (!el) {
        return;
      }

      el.style.display = (nextSlide == i) ? "flex" : "none";
    }
  }

  hideUploadContents () {
    const uploadContentIds = [
      "upload-finished",
      "upload-error",
      "upload-no-ticket",
      "upload-progress-loader",
      "upload-not-found",
      "upload-not-supported"
    ];

    uploadContentIds.forEach(id => {
      const el = document.getElementById(id);

      el.style.display = "none";
    });
  }

  showUploadContents (which, optText = null, data = null) {
    this.hideUploadContents();
    this.toggleUploadWrapper(true);
    
    document.getElementById(which).style.display = "flex";

    if (optText) {
      document.getElementById("upload-progress-opt-text").innerHTML = optText;
    }

    if (data) {
      const missingMapText = `Missing map: ${encodeURI(data.error.data.mapName)}`;
      document.getElementById(`${which}-opt`).innerHTML = `WC3V does not (yet) support this map, sorry. ${missingMapText}`;
    }
  }

  showUploadLink (replayId) {
    const el = document.getElementById("upload-finished-text");

    const urlPath = this.isDev ? `:8080?r=${replayId}` : `/replay/${replayId}`;
    const url = `http://${window.location.hostname}${urlPath}`;

    el.innerHTML = `<a href="${url}">view replay</a>`;
  }

  showUpload (ticketId) {
    const self = this;
    const inputFile = document.createElement("input");

    inputFile.setAttribute("type", "file");
    inputFile.setAttribute("accept", ".w3g,.nwg")
    inputFile.click();

    inputFile.onchange = () => {
      const { size } = inputFile.files[0];

      self.showUploadContents("upload-progress-loader", "Uploading replay... 0%");

      const port = window.location.hostname === "127.0.0.1" ? ":8085" : "";
      const req = new XMLHttpRequest();
      req.open('POST', `http://${window.location.hostname}${port}/upload`, true);
      
      req.setRequestHeader("ticketid", ticketId);
      req.setRequestHeader("Content-Type", "application/octet-stream");
      req.setRequestHeader("Content-Disposition", "attachment");
      
      const uploadStart = new Date();

      req.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percentage = Math.ceil((e.loaded / e.total) * 100);

          // kb / (245 kb/min)
          const estTimeLeft = ((e.total / 1024) / 245).toFixed(2);
          const optText = percentage === 100 ? 
            `Parsing... (est ~${estTimeLeft} min)` :
            `Uploading replay... ${percentage}%`;

          self.showUploadContents("upload-progress-loader", optText);
        }
      };

      req.addEventListener("load", (res) => {
        const { target } = res;

        if (target.status >= 300) {
          console.log("upload error: ", target.status, target.statusText);
          
          let data = null;
          const { responseText } = target;

          if (responseText && responseText != "") {
            try { 
              data = JSON.parse(responseText);
            } catch (err) {
              data = null;
            }
          }

          switch (target.status) {
            case 404:
              self.showUploadContents("upload-not-found");
            break;

            case 406:
              self.showUploadContents("upload-not-supported", null, data);
            break;

            default:
              self.showUploadContents("upload-error");
            break;
          }

          return;
        }

        const jsonData = JSON.parse(target.responseText);
        const { replayId, timer } = jsonData;

        self.showUploadContents("upload-finished");
        self.showUploadLink(replayId);
      });

      req.addEventListener('error', (err) => {
        console.log("req error: ", err);
        showUploadContents("upload-error");
      });

      req.send(inputFile.files[0]);
    };
  }

  loadInfo () {
    const req = new XMLHttpRequest();

    req.addEventListener("load", (res) => {
      const { target } = res;

      try {
        if (target.status === 200) {
          const data = JSON.parse(target.responseText);
          const { recentMatches, replayCount } = data;

          const titleCount = document.getElementById("wc3v-title-count");
          titleCount.innerHTML = `Replays Uploaded: ${replayCount}`;

          const tableStr = recentMatches.reduce((acc, match) => {
            const duration = parseInt(match.duration || 0) / (60 * 1000);

            acc += `
             <tr>
              <td><a href="/replay/${match.replayHash}">link</a></td>
              <td>${Math.round(duration)} min</td>
              <td>${encodeURI(match.mapFile)}</td>
              <td>${match.matchup}</td>
              <td>${match.matchupType}</td>
             </tr>`;

            return acc;
          }, "");

          document.getElementById("recent-replays-data").innerHTML = `<table>
           <th></th>
           <th>duration</th>
           <th>map</th>
           <th>matchup</th>
           <th>matchup type</th>
           ${tableStr}</table>`;
        }
      } catch (e) {
        console.log("error loading wc3v info stats");
      }
    });

    const port = this.isDev ? ":8085" : "";
    const url = `http://${window.location.hostname}${port}/info`;

    req.open("GET", url);
    req.send();
  }

  loadFile (filename, cb) {
    const req = new XMLHttpRequest();

    req.addEventListener("load", cb);

    const port = this.isDev ? ":8080" : "";
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
        self.gridMapImage.src = `/maps/${name}/gridmap.jpg`;

        self.gridMapImage.addEventListener('load', () => {
          resolve();
        }, false);
      });
    }

    return new Promise((resolve, reject) => {
      self.mapImage = new Image();   // Create new img element
      self.mapImage.src = `/maps/${name}/map.jpg`; // Set source path

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

        self.canvas.style.width = mapWidth + "px";
        self.canvas.style.height = mapHeight + "px";
        
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
        try {
          const { target } = res;
          const jsonData = JSON.parse(target.responseText);
            
          self.gridData = jsonData.grid;
        } catch (e) {
          self.gridData = [];
        }

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

    this.players.forEach(player => {
      // jump + update
      player.moveTracker(gameTime);
    });

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
    const self = this;

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

    document.getElementById("wc3v-title").innerHTML = `current replay: ${this.replayId}`;

    // player-status-toggles + player boxes
    this.playerStatusCanvas.height = 50 + (this.players.length * 140);

    // this.playerStatusCanvas.addEventListener('mousemove', (e) => {
    //   this.players.forEach(player => {
    //     player.handleStatusMouse(e);
    //   });
    // });

    this.playerStatusCtx.lineWidth = 1;
    this.playerStatusCtx.fillStyle = "#29373E";
    this.playerStatusCtx.strokeStyle = "#FFF";
    this.playerStatusCtx.font = '12px Arial';

    const playerLoadedPromiseList = this.players.map(player => {
      return player.setup();
    });

    this.hideTutorial();
    this.clearCanvas();

    // finishes the setup promise
    return this.loadMapFile()
    .then(() => { return this.loadMapFile("grid"); })
    .then(() => { return this.loadDoodadFile(); })
    .then(() => { return this.loadGridFile(); })
    .then(playerLoadedPromiseList)
    .then(() => {
      this.setupDrawing();
      this.render();
    });
  }

  setupViewOptions () {
    this.viewOptions = {
      displayPath: true,
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
    this.playerColorMap = [
      "#FF0303",
      "#0042FF",
      "#1CE6B9",
      "#540081",
      "#FFFC01",
      "#fEBA0E",
      "#20C000",
      "#E55BB0",
      "#959697",
      "#7EBFF1",
      "#106246",
      "#4E2A04"
    ];

    this.assignedPlayerColors = [];

    const teamIdList = [];
    const playerList = Object.keys(this.mapData.players).sort((a, b) => {
      const playerA = this.mapData.players[a];
      const playerB = this.mapData.players[b];

      return playerA.teamId - playerB.teamId;
    });

    let slotCounter = 0;

    playerList.forEach((playerId, index) => {
      const { 
        startingPosition, 
        units, 
        selectionStream,
        tierStream,
        teamId,
        isNeutralPlayer 
      } = this.mapData.players[playerId];

      const { raceDetected, name } = this.mapData.replay.players[playerId];

      if (!teamIdList.includes(teamId)) {
        teamIdList.push(teamId);
        this.teamColorMap[teamId] = TeamColorList.shift();
      }

      const player = new ClientPlayer(
        slotCounter,
        this.teamColorMap[teamId],
        playerId, 
        startingPosition, 
        units, 
        name,
        raceDetected,
        selectionStream,
        tierStream,
        this.playerColorMap[index],
        isNeutralPlayer
      );

      this.assignedPlayerColors[playerId] = this.playerColorMap[index];

      slotCounter++;

      this.players.push(player);
    });
  }

  setupMap () {
    const { maps } = window.gameData;

    // extract map info from replay data
    
    const { map, metadata, subheader } = this.mapData.replay;

    let file = metadata.map.mapName;

    file = file.trim();
    file = file.replace(new RegExp(' ', 'g'), "");

    console.log("map name: ", encodeURI(file));

    const mapParts = file.split("/");

    this.matchEndTime = subheader.replayLengthMS;

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
    const self = this;
    const { world } = this.mapData;
    const { bounds } = this.mapInfo;
    const { width, height } = this.canvas;

    // player ui toggle offsets
    this.playerSlotOffset = 0;
    // how far the camera will zoom
    const zoomScaleExtent = [ 1.0, 1.75 ];
    // camera transform
    this.transform = { x: 0.0, y: 0.0, k: 1.0 };

    this.gameScaler = new GameScaler();
    this.gameScaler.addDependency('_d3', d3);
    this.gameScaler.setup(this.mapInfo, this.mapImage, this.canvas, this.cameraRatio);

    this.gameDisplayBox = new GameDisplayBox(this.teamColorMap, this.assignedPlayerColors);
    this.gameDisplayBox.setData(
      world.neutralGroups, GameDisplayBox.neutralCampHandler(this.gameScaler, this.transform));

    this.canvas.addEventListener('mousedown', (e) => {
      self.gameDisplayBox.handleMouse(e, 'down', self.transform);
    });

    this.canvas.addEventListener('mousemove', (e) => {
      self.gameDisplayBox.handleMouse(e, 'move', self.transform);
    });

    this.toggleMegaPlayButton(true);
    this.gameLoaded = true;

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

        this.gameDisplayBox.hide();

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
        if (this.state === ScrubStates.playing) {
          this.update(timeStep * speed);
        }
        
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
      viewOptions
    } = this;

    const {
      mapExtent, 
      middleX, 
      middleY, 
      xScale, 
      yScale,
      viewWidth,
      viewHeight,
      sceneWidth,
      sceneHeight
    } = this.gameScaler;

    const { width, height } = this.mapImage;
    const { x, y, k } = transform;

    const drawX = (transform.x + xScale(mapExtent.x[0]) + middleX);
    const drawY = (transform.y + yScale(mapExtent.y[0]) + middleY);

    const bgImage = viewOptions.displayMapGrid ? 
      this.gridMapImage : this.mapImage;

    const offsetX = (viewWidth - sceneWidth) / 2;
    const offsetY = (viewHeight - sceneHeight) / 2;

    ctx.drawImage(
      bgImage, 
      offsetX,               // sourceX
      offsetY,               // sourceY
      sceneWidth,           // sourceWidth
      sceneHeight,          // sourceHeight
      drawX + offsetX,           // destX
      drawY + offsetY,           // destY
      sceneWidth * k,       // destWidth
      sceneHeight * k       // destHeight
    );
  }

  renderMapTrees (ctx) {
    const { transform, viewOptions, doodadData } = this;
    const {
      middleX, 
      middleY, 
      xScale, 
      yScale
    } = this.gameScaler;

    if (!viewOptions.displayTreeGrid) {
      return;
    }

    const treeSize = (4 * transform.k);
    const treeRadius = Math.min(5, Math.max(1.5, treeSize));

    const oldFillStyle = ctx.fillStyle;
    const oldAlpha = ctx.globalAlpha;

    ctx.fillStyle = "#FFF";
    ctx.strokeStyle = "#333";
    ctx.globalAlpha = 0.75;

    doodadData.forEach((tree, treeIndex) => {
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

      // drawing algo:
      // x = GameScaler.xScale(x) + middleX
      // y = GameScaler.yScale(y) + middleY
      // finally -
      // (x * transform.k) + transform.x
      // (y * transform.k) + transform.y

      const drawX = ((xScale(x) + middleX) * transform.k) + transform.x;
      const drawY = ((yScale(y) + middleY) * transform.k) + transform.y;

      ctx.beginPath();
      ctx.arc(drawX, drawY, treeRadius, 0, Math.PI * 2, true);
      ctx.fill();
      ctx.stroke();
    });

    ctx.fillStyle = oldFillStyle;
    ctx.globalAlpha = oldAlpha;
  }

  renderNeutralGroups (ctx, gameTime) {
    const { transform, mapData } = this;
    const { world } = mapData;
    
    const {
      middleX, 
      middleY, 
      xScale, 
      yScale
    } = this.gameScaler;

    const campColorMap = {
      0: '#FFF',
      1: '#eaff00'
    };

    const iconSize = (14 * transform.k);

    const oldFillStyle = ctx.fillStyle;
    const oldAlpha = ctx.globalAlpha;
    const oldWidth = ctx.lineWidith;

    ctx.fillStyle = "#FFF";
    ctx.strokeStyle = "#FFF";
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2.5;

    const neutralPlayer = this.players.find(player => {
      return player.playerId === "1042";
    });

    if (!neutralPlayer) {
      return;
    }

    const groups = Object.values(world.neutralGroups);
    const claimPaths = groups.reduce((acc, group) => {
      if (group.claimOwnerId == null) {
        return acc;
      }

      acc[group.claimOwnerId] = [];

      return acc;
    }, {});

    groups.forEach((neutralGroup) => {
      const { bounds, claimState, claimTime, claimOwnerId, uuid } = neutralGroup;

      const rectWidth = (xScale(bounds.maxX) - xScale(bounds.minX));
      const rectHeight = (yScale(bounds.maxY) - yScale(bounds.minY));

      const drawX = ((xScale(bounds.minX) + middleX) * transform.k) + transform.x;
      const drawY = ((yScale(bounds.minY) + middleY) * transform.k) + transform.y;

      let claimColor = colorMap[0];
      let claimColorFill = null;

      if (gameTime >= claimTime) {

        if (!neutralGroup.isHidden) {
          // hide the units from rendering now that its been claimed
          neutralGroup.isHidden = true;
          neutralPlayer.units.forEach(unit => {
            if (unit.neutralGroupId === uuid) {
              unit.isNeutralGroupHidden = true;
            }
          });
        }

        claimColor = campColorMap[claimState];

        if (claimState == 1) {
          claimColorFill = campColorMap[claimState];
        }

        if (claimState > 1) {
          claimColorFill = this.teamColorMap[claimOwnerId];

          claimPaths[claimOwnerId].push({
            claimTime,
            drawX,
            drawY,
            rectWidth,
            rectHeight
          });
        }
      }

      ctx.strokeStyle = claimColor;

      ctx.beginPath();
      ctx.strokeRect(drawX, drawY, rectWidth, rectHeight);
      if (claimColorFill) {
        ctx.fillStyle = claimColorFill;
        ctx.fillRect(drawX, drawY, rectWidth, rectHeight);
      }
      ctx.fill();
      ctx.stroke();
    });

    ctx.beginPath();
    Object.keys(claimPaths).forEach(teamClaimId => {
      const claimPath = claimPaths[teamClaimId].sort((a, b) => {
        return a.claimTime - b.claimTime;
      })

      claimPath.forEach((step, ind) => {
        const midX = (step.drawX + (step.rectWidth / 2));
        const midY = (step.drawY + (step.rectHeight / 2));
        
        if (ind == 0) {
          ctx.moveTo(midX, midY);
          
          return;
        }

        ctx.lineTo(midX, midY);
      });
    });
    ctx.stroke();

    ctx.fillStyle = oldFillStyle;
    ctx.globalAlpha = oldAlpha;
    ctx.lineWidth = oldWidth;
  }

  renderMapGrid (ctx) {
    const { transform, viewOptions, gameScaler} = this;
    const { gridXScale, gridYScale, xScale, yScale, middleX, middleY } = gameScaler;

    if (!viewOptions.displayWalkGrid  &&
        !viewOptions.displayWaterGrid &&
        !viewOptions.displayBuildGrid) {
      return;
    }

    const { gridSize } = this.mapInfo;
    const { full, playable } = gridSize;

    const gridHeight = this.gridData.length;
    const gridWidth  = this.gridData[0].length;

    const { width, height } = this.canvas;

    const tileHeight = (height / gridHeight) * transform.k;
    const tileWidth  = (width  / gridWidth)  * transform.k;

    ctx.lineWidth = 1;

    let rCol = gridHeight - 1;
    let rRow = gridWidth - 1;

    ctx.globalAlpha = 1;

    for (let col = 0; col < gridHeight; col++) {
      rRow = gridWidth - 1;

      for (let row = 0; row < gridWidth; row++) {
        const data = this.gridData[rCol][row];

        const gridPosition = {
          x: gridXScale(row * 32),
          y: gridYScale(col * 32),
        };

        const drawX = ((xScale(gridPosition.x) + middleX) * transform.k) + transform.x;
        const drawY = ((yScale(gridPosition.y) + middleY) * transform.k) + transform.y;

        rRow--;

        if (!data) {
          console.error("bad grid data: ", col, rRow);
          return;
        }

        const { 
          NoWater, 
          NoWalk,
          NoFly,
          NoBuild,
          Blight
        } = data;

        const canWalk = (!NoWalk && NoBuild) || NoWater || Blight;

        if (viewOptions.displayWalkGrid && !canWalk) {
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

      rCol--;
    }
  }

  render () {
    const { 
      ctx,
      players,
      playerCtx,
      playerStatusCtx,
      utilityCtx,
      transform,
      gameTime,
      matchEndTime,
      viewOptions
    } = this;

    const {
      xScale, 
      yScale,
      unitXScale,
      unitYScale,
      middleX,
      middleY,
    } = this.gameScaler;

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
    let frameData = { 
      nameplateTree: new rbush(),
      unitTree: new rbush(),
      unitDrawPositions: []
    };

    this.renderMapGrid(utilityCtx);
    this.renderMapTrees(utilityCtx);
    this.renderNeutralGroups(utilityCtx, gameTime);

    players.forEach(player => {
      player.render(
        frameData,
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
