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

const ViewModes = {
  gameplay: 0,
  buildOrder: 1
};

const BuildView = {
  live: 0,
  static: 1
};

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

      const cookieData = document.cookie;

      if (cookieData && cookieData.indexOf("shownTutorial=1") != -1) {
        console.log("not showing tutorial");
        this.hideTutorial();
      } else {
        // if we have no match to load show the tutorial
        this.tutorialWindow.style.display = "block";
      }

      if (!this.isDev) {
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const localReplay = params.get('r');

      if (localReplay) {
        console.log('loading local replay: ', encodeURI(localReplay));
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
    this.tutorialBackdrop = document.getElementById("modal-backdrop");

    this.emptyGameWrapper = document.getElementById("empty-game-wrapper");
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

  showSidePanel (id) {
    this.hideSidePanels();

    const el = document.getElementById(id);
    const headerEl = document.getElementById(`${id}-header`);
    
    el.style.display = "flex";
    headerEl.classList.add("shown-header");
  }

  hideSidePanels () {
    const panels = [
      "pro-replays",
      "about-wc3v",
      "recent-replays"
    ];

    panels.forEach(id => {
      const el = document.getElementById(id);
      const headerEl = document.getElementById(`${id}-header`);

      el.style.display = "none";
      headerEl.classList.remove("shown-header");
    });
  }

  showTutorial() {
    this.advanceTutorial(1);
    this.tutorialWindow.style.display = "block";
    this.tutorialBackdrop.style.display = "block";
  }

  hideTutorial() {
    this.tutorialWindow.style.display = "none";
    this.tutorialBackdrop.style.display = "none";

    console.log("setting do-not-show cookie");
    document.cookie = "shownTutorial=1; path=/; expires=Tue, 19 Jan 2038 03:14:07 GMT";
  }

  advanceTutorial (nextSlide) {
    for (let i = 1; i <= 6; i++) {
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

    this.emptyGameWrapper.style.display = "none";

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

            const formattedMapFile = encodeURI(match.mapFile)
              .replace("%20", " ")
              .substring(0, 22);

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
           <th>type</th>
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
          x: 1, //(camera[0][xBoundIndex] / map[0][xBoundIndex]),
          y: 1, //(camera[1][yBoundIndex] / map[1][yBoundIndex])
        };

        const mapWidth = self.mapImage.width;// * self.cameraRatio.x;
        const mapHeight = self.mapImage.height;// * self.cameraRatio.y;

        resolve();
      }, false);
      
    });
  }

  loadGridFile () {
    const self = this;
    const { name } = this.mapInfo;

    // return new Promise((resolve, reject) => {
    //   this.loadFile(`../maps/${name}/wpm.json`, (res) => {
    //     try {
    //       const { target } = res;
    //       const jsonData = JSON.parse(target.responseText);
            
    //       console.log("grid: ", jsonData);
    //       self.gridData = jsonData.grid;
    //     } catch (e) {
    //       console.log("no grid: ", e);
    //       self.gridData = [];
    //     }

    //     resolve(true);
    //   });
    // })
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

    this.emptyGameWrapper.style.display = "none";

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

  setViewType (tab) {
    const el = document.getElementById(`${tab}-toggle`);
    const oldList = Array.from(document.getElementsByClassName("view-type-toggle selected"));

    oldList.forEach(oldEl => oldEl.classList.remove('selected'));
    el.classList.add('selected');

    this.viewMode = (tab == 'gameplay') ? ViewModes.gameplay : ViewModes.buildOrder;

    this.buildWrapper.style.display = (this.viewMode == ViewModes.buildOrder) ? 'block' : 'none';

    if (!this.gameLoaded) {
      return;
    }

    this.render();
  }

  setBuildView (tab) {
    // note that we render it first because the controls are added by the render
    this.buildViewMode = (tab == 'live') ? BuildView.live : BuildView.static;
    this.renderBuildOrder();

    const el = document.getElementById(`build-order-control-${tab}`);
    const oldList = Array.from(document.getElementsByClassName("build-order-control selected"));

    oldList.forEach(oldEl => oldEl.classList.remove('selected'));
    el.classList.add('selected');

    if (!this.gameLoaded) {
      return;
    }
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

    const params = new URLSearchParams(window.location.search);
    const hasBuildParam = params.has('showBuildOrder');

    this.viewMode = hasBuildParam ? ViewModes.buildOrder : ViewModes.gameplay;
    this.buildViewMode = BuildView.live;

    // reference to which players build order we are viewing
    this.buildOrderPlayers = [];

    this.setStatusTab('heroes');
    this.setupViewOptions();

    this.setupPlayers();
    this.setupMap();

    this.buildWrapper = document.getElementById("build-wrapper");
    this.mainWrapper = document.getElementById("main-wrapper");

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
      this.setupBuildOrder();

      if (hasBuildParam) {
        this.setViewType('build-order');
      }

      this.render();
    });
  }

  setupBuildOrder () {
    const buildOrderPlayersWrapper = document.getElementById("build-content-players");

    this.players.forEach(player => {
      const { playerId, playerColor, isNeutralPlayer, icon } = player;
      if (isNeutralPlayer) {
        return;
      }

      const wrapper = document.createElement("div");
      const content = document.createElement("div");
      const colorIcon = document.createElement("span");

      const newIcon = new Image();

      wrapper.classList.add('player-selector');
      content.classList.add('player-selector-content');
      colorIcon.classList.add('player-selector-color-icon');

      content.innerHTML = `<span class="player-selector-color-icon" style="background: ${playerColor};"></span>${player.displayName}`;

      newIcon.src = icon.src;
      wrapper.id = `player-selector-id-${playerId}`;

      wrapper.append(newIcon);
      wrapper.append(content);


      wrapper.addEventListener('click', (e) => {
        const el = document.getElementById(`player-selector-id-${playerId}`);
        const toggled = el.classList.toggle('selected');

        if (toggled) {
          this.buildOrderPlayers.push(player);
        } else {
          this.buildOrderPlayers = this.buildOrderPlayers.filter(buildPlayer => {
            return buildPlayer.playerId != playerId;
          });
        }

        this.renderBuildOrder();
      });

      buildOrderPlayersWrapper.append(wrapper);
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
      displayWaterGrid: false,
      displayCreepRoute: false
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
        eventStream,
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
        isNeutralPlayer,
        eventStream
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
    

    // player ui toggle offsets
    this.playerSlotOffset = 0;
    // how far the camera will zoom
    const zoomScaleExtent = [ 1.0, 1.75 ];
    // camera transform
    this.transform = { x: 0.0, y: 0.0, k: 1.0 };

    this.gameScaler = new GameScaler();
    this.gameScaler.addDependency('_d3', d3);
    this.gameScaler.setup(this.mapInfo);

    const mapWidth = this.gameScaler.mapImage.width;
    const mapHeight = this.gameScaler.mapImage.height;

    self.canvas.width = mapWidth;
    self.canvas.height = mapHeight;

    self.canvas.style.width = mapWidth + "px";
    self.canvas.style.height = mapHeight + "px";

    self.buildWrapper.style.width = mapWidth + "px";
    self.buildWrapper.style.height = (mapHeight - 38) + "px";
    
    self.playerCanvas.width = mapWidth;
    self.playerCanvas.height = mapHeight;

    self.utilityCanvas.width = mapWidth;
    self.utilityCanvas.height = mapHeight;

    const { width, height } = this.canvas;

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

    const offsetX = 0;//(viewWidth - sceneWidth) / 2;
    const offsetY = 0;//(viewHeight - sceneHeight) / 2;

    ctx.drawImage(
      bgImage, 
      offsetX,               // sourceX
      offsetY,               // sourceY
      viewWidth,           // sourceWidth
      viewHeight,          // sourceHeight
      drawX + offsetX,           // destX
      drawY + offsetY,           // destY
      viewWidth * k,       // destWidth
      viewHeight * k       // destHeight
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

    const treeSize = (6 * transform.k);
    const treeRadius = Math.min(8, Math.max(3.5, treeSize));

    const oldFillStyle = ctx.fillStyle;
    const oldAlpha = ctx.globalAlpha;

    ctx.fillStyle = "#013f01";
    ctx.strokeStyle = "#906739";
    ctx.globalAlpha = 0.65;

    doodadData.forEach((tree, treeIndex) => {
      const { flags, position, scale } = tree;
      const { solid, visible } = flags;
      const { x, y } = position;

      // drawing algo:
      // x = GameScaler.xScale(x) + middleX
      // y = GameScaler.yScale(y) + middleY
      // finally -
      // (x * transform.k) + transform.x
      // (y * transform.k) + transform.y

      const scaledSize = (8 * scale[0]) * transform.k;
      const halfSize = scaledSize / 2;

      const drawX = ((xScale(x) + middleX) * transform.k) + transform.x;
      const drawY = ((yScale(y) + middleY) * transform.k) + transform.y;

      //ctx.fillRect(drawX, drawY, scaledSize, scaledSize);

      ctx.beginPath();
      ctx.arc(drawX + halfSize, drawY + halfSize, scaledSize, 0, Math.PI * 2, true);
      ctx.fill();
      ctx.stroke();
    });

    ctx.fillStyle = oldFillStyle;
    ctx.globalAlpha = oldAlpha;
  }

  renderNeutralGroups (ctx, gameTime) {
    const { transform, mapData, viewOptions } = this;
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

    groups.forEach((neutralGroup, campNumber) => {
      const { bounds, claimState, claimTime, claimOwnerId, uuid, order } = neutralGroup;

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

      if (claimState > 0 && claimColorFill) {
        Drawing.drawBoxedLevel(ctx, `${order}`, drawX - 8, drawY - 24, 30, 30, 20, 20);
      }
    });

    if (!viewOptions.displayCreepRoute) {
      return;
    }

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

    return;

    const { gridSize } = this.mapInfo;
    const { full, playable } = gridSize;

    const gridHeight = this.gridData.length;
    const gridWidth  = this.gridData[0].length;

    const { width, height } = this.canvas;

    const tileHeight = (height / gridHeight) * transform.k;
    const tileWidth  = (width  / gridWidth)  * transform.k;

    ctx.lineWidth = 1;

    let rCol = gridHeight - 1;

    ctx.globalAlpha = 1;

    for (let col = 0; col < gridHeight; col++) {
      for (let row = 0; row < gridWidth; row++) {
        const data = this.gridData[rCol][row];
        const { 
          NoWater, 
          NoWalk,
          NoFly,
          NoBuild,
          Blight,
          x,
          y
        } = data;

        const drawX = (row * tileWidth) + transform.x;
        const drawY = (col * tileHeight) + transform.y;

        const canWalk = (!NoWalk && NoBuild) || NoWater || Blight;

        if (viewOptions.displayWalkGrid && canWalk) {
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

  renderBuildOrder () {
    const { 
      buildOrderPlayers,
      buildViewMode,
      players
    } = this;

    const allPlayers = players.filter(player => !player.isNeutralPlayer);
    const buildPlayerData = {};

    const isStaticView = buildViewMode == BuildView.static;

    const modeKeyFilters = {};
    modeKeyFilters[BuildView.live] = ['addBuilding'];
    modeKeyFilters[BuildView.static] = ['addBuilding', 'addUnit'];

    const filterKeys = modeKeyFilters[buildViewMode];

    let maxEventCount = 0;
    
    buildOrderPlayers.forEach(player => {
      const { eventStream, tierStream } = player;

      const rawBuildingEvents = eventStream.reduce((acc, item) => {

        if (filterKeys.includes(item.key)) {
          const { gameTime } = item;
          let displayName, itemId, isUnit;

          if (item.key == 'addBuilding') {
            const { building } = item;
            displayName = building.displayName;
            itemId = building.itemId;

            isUnit = false;
          } else {
            const { unit } = item;

            if (unit.isHero || unit.isIllusion || (unit.isSummon != false)) {
              // bail out
              return acc;
            }

            displayName = unit.displayName;
            itemId = unit.itemId;

            isUnit = true;
          }

          const imgSrc = `/assets/wc3icons/${itemId}.jpg`;

          acc.push({
            itemId,
            displayName,
            gameTime,
            isUnit,
            count: 1,
            bucketOffset: 0,
            imgSrc: imgSrc
          });
        }

        return acc;
      }, []);


      //
      // Algorithm to group units of the same itemId together and show a multiplier text
      //

      let buildingEvents;
      if (isStaticView) {
        let lastUnit;
        buildingEvents = [];

        for (let i = 0; i < rawBuildingEvents.length; i++) {
          const item = rawBuildingEvents[i];

          if (!item.isUnit) {
            if (lastUnit) {
              buildingEvents.push(lastUnit);
              lastUnit = null;
            }

            buildingEvents.push(item);
            continue;
          }

          if (lastUnit) {
            if (lastUnit.itemId == item.itemId) {
              lastUnit.count += 1;

              continue;
            }

            // we have a lastUnit but it doenst match, so push it in
            buildingEvents.push(lastUnit);
          }

          // now assign the new lastUnit
          lastUnit = item;
          continue;
        
          // end of lastUnit for loop
        }

        if (lastUnit) {
          // we had a remaining unit at the end
          buildingEvents.push(lastUnit);
        }

        // add the tier icons
        tierStream.forEach(tierItem => {
          if (tierItem.tier != 1 && tierItem.tier != 4) {
            buildingEvents.push({
              itemId: 'asdf',
              displayName: `Tier ${tierItem.tier}`,
              gameTime: tierItem.gameTime,
              isUnit: false,
              count: 1,
              bucketOffset: 0,
              imgSrc: player.icon.src
            });
          }
        });

        buildingEvents = buildingEvents.sort((a, b) => {
          return a.gameTime - b.gameTime;
        });

      } else {
        // no need for processing, just use raw
        buildingEvents = rawBuildingEvents;
      }

      const d3Data = buildingEvents.map((item, ind) => {
        return { date: new Date(item.gameTime), value: 0, data: item };
      });

      const tierData = tierStream.reduce((acc, item) => {
        if (item.tier != 1 && item.tier != 4) {
          acc.push({ 
            date: new Date(item.gameTime), 
            value: item.tier 
          });
        }

        return acc;
      }, []);

      const totalEvents = buildingEvents.length + tierData.length;
      if (totalEvents > maxEventCount) {
        maxEventCount = totalEvents;
      }

      buildPlayerData[player.playerId] = {
        buildingEvents,
        d3Data,
        tierData
      };
    });

    const chartProperties = {
      height: this.gameScaler.mapImage.height - 200,
      width: this.gameScaler.mapImage.width - 60,
      axisMargin: 50,
      yMargin: 20,
      xMargin: 10,
      padding: 50,
      playerLanePadding: 10,
      tierBandHeight: 40
    };

    const iconSizes = {
      building: isStaticView ? 75 : 50
    };

    const computedChartSize = {
      left:   chartProperties.xMargin + chartProperties.axisMargin, 
      right:  chartProperties.width - chartProperties.xMargin,
      top:    chartProperties.yMargin,
      bottom: chartProperties.height - chartProperties.yMargin
    };

    const wrapper = document.getElementById('build-order-wrapper');
    wrapper.style.maxHeight = `${chartProperties.height}px`;

    wrapper.innerHTML = `<div id='build-order-controls'>
      <div 
        id='build-order-control-live' 
        onClick='wc3v.setBuildView("live")' 
        class='build-order-control ${isStaticView ? "" : "selected"}'>Live Timing
      </div>
      <div 
        id='build-order-control-static' 
        onClick='wc3v.setBuildView("static")' 
        class='build-order-control ${isStaticView ? "selected" : ""}'>Static
      </div>
    </div>`;

    const MIN_IN_MS = (60 * 1000);

    // how many 5 minute slices do we have in our game
    const gameSlices = (this.matchEndTime <= 0) ? 1 : Math.ceil(this.matchEndTime / (5 * MIN_IN_MS));

    // ensure the early game is always stepped out and visually clear
    const yDomainPreset = [ 0, 0.25, 0.5, 1, 2.5 ];
    const yDomain = [].concat(yDomainPreset);

    for (let i = 1; i <= gameSlices; i++) {
      yDomain.push(5 * i);
    }

    if (gameSlices > 1) {
      yDomain.push((gameSlices + 1) * 5);
    }

    let yScale;

    if (isStaticView) {
      yScale = d3.scaleLinear()
        .domain([0, Math.max(this.matchEndTime, 10 * MIN_IN_MS)])
        .range([computedChartSize.top, maxEventCount * iconSizes.building]);
    } else {
      yScale = d3.scalePow()
        .exponent(0.5)
        .domain([
          0,
          1.5 * MIN_IN_MS,
          Math.max(this.matchEndTime, 10 * MIN_IN_MS)
        ])
        .rangeRound([ 
          computedChartSize.top, 
          computedChartSize.bottom * 0.35,
          computedChartSize.bottom
        ]);
    }

    const xScale = d3.scaleLinear()
      .domain([0, allPlayers.length])
      .range([ 
        computedChartSize.left,
        computedChartSize.right
      ]);

    // TODO: remove this in favor of xScale now that we dont need it
    const xPlayerScale = d3.scaleLinear()
      .domain([0, allPlayers.length])
      .range([
        computedChartSize.left,
        computedChartSize.right
      ]);

    const computedChartHeight = isStaticView ? (maxEventCount * iconSizes.building) : chartProperties.height;

    const parent = d3.create("div")
      .append("svg")
      .attr("width", chartProperties.width)
      .attr("height", computedChartHeight);

    // render yAxis and tick labels

    if (!isStaticView) {
      parent
        .append("g")
        .attr("class", "y axis")
        .attr("transform", `translate(${computedChartSize.left}, 0)`)
        .call(
          d3
            .axisLeft(yScale)
            .tickFormat((d, i) => {
              const timerDate = new Date(Math.round(d * 1000) / 1000);
              // ensure leading zero
              const gameSecondsPrefix = timerDate.getUTCSeconds() < 10 ? '0' : '';

              return `${timerDate.getUTCMinutes()}:${gameSecondsPrefix}${timerDate.getUTCSeconds()}`;
            })
        );
    }

    ////
    // Player drawing routines
    ////

    //
    // draw background color rects
    //

    const bgData = buildOrderPlayers.map(player => { 
      return { date: 0, value: player.slot, playerColor: player.playerColor }
    });

    // render bg rects
    parent
        .append('g')
        .selectAll("rect")
        .data(bgData)
        .enter()
          .append("rect")
          .attr("class", "player-bg-rect")
          .attr("x", d => xPlayerScale(d.value))
          .attr("width", d => xPlayerScale(d.value + 1) - xPlayerScale(d.value))
          .attr("y", d => yScale(d.date))
          .attr("height", isStaticView ? computedChartHeight : computedChartSize.bottom - chartProperties.yMargin)
          .attr("fill", d => d.playerColor);

    //
    // x and y grid lines
    //

    const yAxisGrid = d3
      .axisLeft(yScale)
      // each tick is the full width of the chart
      .tickSize(-computedChartSize.right + computedChartSize.left)
      .tickFormat('')
      .ticks(15);

    const xAxisGrid = d3
      .axisBottom(xScale)
      // each tick is the full height of the chart
      .tickSize(-computedChartSize.bottom + computedChartSize.top)
      .tickFormat('')
      .ticks(15);

    parent.append('g')
      .attr('class', 'y axis-grid')
      // translate left to clear the yAxis and tick labels
      .attr('transform', `translate(${computedChartSize.left}, 0)`)
      .call(yAxisGrid);

    if (!isStaticView) {
      parent.append('g')
        .attr('class', 'x axis-grid')
        // translate to the bottom  to render back upward to the origin
        .attr('transform', `translate(0, ${computedChartSize.bottom})`)
        .call(xAxisGrid);
    }

    //
    // bucket generation
    //
    // how WC3V draws buildings 'staggered' so buildings that were made
    // close together can be easily seen
    // -------------------------------------------------------------------------
    //
    // utilizes d3 historgram and its bin algorithm to
    // group buildings that are close together on the yScale
    // using its ticks as the thresholds for the histogram bins
    // so that we keep the properties of the sqrt scale
    //
    // every building that is in a group gets a `bucketOffset`
    // index added to its data record for use in a localized
    // `xBucketScale` to give horizontal visual clearence
    // to buildings
    //

    const bucketGenerator = d3.histogram()
      .value(function(d) { return d.data.gameTime; })
      .thresholds(yScale.ticks(15)); // then the numbers of bins

    const bucketCounts = [];

    buildOrderPlayers.forEach((buildPlayer, ind) => {
      const { playerId } = buildPlayer;
      const data = buildPlayerData[playerId].d3Data;
      const buckets = [];

      bucketGenerator(data).forEach(bucket => {
        bucket.forEach((item, ind) => {
          item.data.bucketOffset = ind;
        });

        bucketCounts.push(bucket.length);

        const { x0, x1 } = bucket;
        if (bucket.length) {
          buckets.push({
            x0,
            x1
          });
        }
      });

      buildPlayerData[playerId].buckets = buckets;
    });

    const playerSlotPadding = (xPlayerScale(1) - xPlayerScale(0)) - 
                              (iconSizes.building) - 
                              chartProperties.playerLanePadding;

    const tooltip = d3.select("body")
      .append("div") 
      .attr("class", "tooltip")       
      .style("opacity", 0);

    const TierColors = {
      2: "#21a5e3",
      3: "#FFFF33"
    };

    buildOrderPlayers.forEach((buildPlayer, ind) => {
      const { playerId, slot } = buildPlayer;
      const data = buildPlayerData[playerId];

      if (!isStaticView) {
        const tierBar = parent
          .append('g')
          .selectAll('rect')
          .data(data.tierData)
          .enter()
            .append('g');

        tierBar
          .append('rect')
          .attr("x", d => xPlayerScale(slot))
          .attr("width", d => xPlayerScale(1) - xPlayerScale(0))
          .attr("y", d => yScale(d.date))
          .attr("height", chartProperties.tierBandHeight)
          .attr("fill", d => TierColors[d.value])
        
        tierBar.append('text')
              .attr('x', d => xPlayerScale(slot + 1) - 50)
              .attr('y', d => yScale(d.date) + chartProperties.tierBandHeight - 4)
              .text(d => `Tier ${d.value}`);
      }

      const maxBucketSlot = d3.max(data.d3Data.map(d => d.data.bucketOffset));

      const bucketRange = isStaticView ? [0, 0] : [chartProperties.playerLanePadding, playerSlotPadding];
      const xBucketScale = d3.scaleLinear()
        .domain([0, maxBucketSlot])
        .range(bucketRange);

      parent
        .append('g')
        .selectAll("dot")
        .data(data.d3Data)
        .enter()
          .append("image")
          .attr("xlink:href", d => d.data.imgSrc)
          .attr("x", d => {
            if (isStaticView) {
              return xPlayerScale(slot) + (xPlayerScale(1) - xPlayerScale(0)) / 2 - (iconSizes.building / 2);
            } else {
              return xPlayerScale(slot) + xBucketScale(d.data.bucketOffset);
            }
          })
          .attr("y", (d, i) => {
            if (isStaticView) {
              return computedChartSize.top + (i * iconSizes.building);
            } else {
              return yScale(d.date) - (iconSizes.building / 2);  
            }
          })
          .attr("width", iconSizes.building)
          .attr("height", iconSizes.building)
          .on("mouseover", d => {    
            tooltip.transition()    
                .duration(200)    
                .style("opacity", 0.95);


            const timerDate = new Date(Math.round(d.date * 1000) / 1000);
            // ensure leading zero
            const gameSecondsPrefix = timerDate.getUTCSeconds() < 10 ? '0' : '';
            const timeStr = `${timerDate.getUTCMinutes()}:${gameSecondsPrefix}${timerDate.getUTCSeconds()}`;

            tooltip.html(`<div class='tooltip-header'>${d.data.displayName}</div>
              <div class='tooltip-timer'>${timeStr}</div>`)  
                .style("left", (d3.event.pageX) + "px")   
                .style("top", (d3.event.pageY - 28) + "px");  
          })          
          .on("mouseout", d => {   
              tooltip.transition()    
                  .duration(500)    
                  .style("opacity", 0); 
          });
      
      if (!isStaticView) {
        return;
      }

      const groupTexts = parent
        .selectAll("dot")
        .data(data.d3Data)
        .enter()
          .append("g");

      groupTexts
          .append("rect")
          .attr("fill", "#FFFFFF")
          .attr("height", "22")
          .attr("width", "22")
          .attr("display", d => {
            return d.data.count > 1 ? "block" : "none";
          })
          .attr("x", d => {
            return xPlayerScale(slot) + (xPlayerScale(1) - xPlayerScale(0)) / 2 - 
              (iconSizes.building / 2) + iconSizes.building - 22;
          })
          .attr("y", (d, i) => {
            return computedChartSize.top + (i * iconSizes.building) + iconSizes.building - 22;
          });

      groupTexts
          .append("text")
          .attr("class", "build-order-static-text")
          .attr("display", d => {
            return d.data.count > 1 ? "block" : "none";
          })
          .attr("x", d => {
            return xPlayerScale(slot) + (xPlayerScale(1) - xPlayerScale(0)) / 2 - 
              (iconSizes.building / 2) + iconSizes.building - 20;
          })
          .attr("y", (d, i) => {
            return computedChartSize.top + (i * iconSizes.building) + iconSizes.building - 2;
          })
          .text(d => {
            return `x${d.data.count}`;
          });

    // end of buildOrderPlayers loop
    });
    
    wrapper.append(parent.node());
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
      unitDrawPositions: [],
      drawnUnits: {}
    };

    this.renderMapGrid(utilityCtx);
    this.renderMapTrees(utilityCtx);
    this.renderNeutralGroups(utilityCtx, gameTime);

    players.forEach(player => {
      player.preRender(
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
