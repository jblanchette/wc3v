 const Wc3vViewer = class {
  constructor () {
    this.reset();
  }

  bootstrap () {
    this.setupControls();

    const urlParams = new URLSearchParams(window.location.search);
    const replay    = urlParams.get('r');
    const buildId   = urlParams.get('buildId');
    if (buildId)     this.renderBuildContext(buildId);

    const hrefPath = window.location.href;
    const re = new RegExp('replay/(.*)', 'i');
    const match = re.exec(hrefPath);

    if (match) {
      // Legacy path-based URL: /replay/name
      setTimeout(() => {
        this.load(`${encodeURI(match[1])}.wc3v`);
      });
    } else if (replay) {
      // Query-param URL: /viewer?r=name  (works in both dev and production)
      setTimeout(() => {
        this.load(`${encodeURI(replay)}.wc3v`);
      });
    } else {
      // No replay specified — redirect to browse page
      window.location.href = '/builds';
    }
  }

  // Render rich build context bar: back link, matchup badges, build name, match info, replay switcher pills
  async renderBuildContext (buildId) {
    const bar = document.getElementById('viewer-breadcrumb');
    if (!bar) return;

    const urlParams = new URLSearchParams(window.location.search);
    const currentReplayId = urlParams.get('r');

    const RACE_COLORS = { H: '#4488FF', O: '#FF4444', E: '#44DD88', U: '#AA66FF' };
    const RACE_ABBR   = { H: 'HU',     O: 'ORC',     E: 'NE',      U: 'UD'      };

    try {
      const res = await fetch('/data/builds-manifest.json');
      const manifest = await res.json();
      const build = (manifest.builds || []).find(b => b.id === buildId);
      if (!build) return;

      // Load summary for current replay
      let summary = null;
      try {
        const sr = await fetch(`/data/summaries/${currentReplayId}.json`);
        summary = await sr.json();
      } catch (e) { /* non-critical */ }

      const currentReplay = (build.replays || []).find(r => r.replayId === currentReplayId);
      const otherReplays  = (build.replays || []).filter(r => r.replayId !== currentReplayId);

      const rc = RACE_COLORS[build.race] || '#888';

      // Match summary line
      let matchLine = '';
      if (currentReplay) {
        const map = (summary && summary.map) || currentReplay.map || '';
        const dur = (summary && summary.durationFormatted) ? ' · ' + summary.durationFormatted : '';
        matchLine = `${currentReplay.playerName} vs ${currentReplay.opponentName}${map ? ' · ' + map : ''}${dur}`;
      }

      // Other replay switcher pills
      const otherHtml = otherReplays.map(r => {
        const url = `/viewer?r=${r.replayId}&buildId=${build.id}`;
        return `<a class="vbc-replay-pill" href="${url}">${r.playerName}</a>`;
      }).join('');

      bar.style.display = 'flex';
      bar.innerHTML = `
        <a class="vbc-back" href="/">← Builds</a>
        <div class="vbc-sep"></div>
        <span class="vbc-badge" style="--rc:${rc}">${RACE_ABBR[build.race] || build.race}</span>
        <span class="vbc-name">${build.name}</span>
        ${matchLine ? `<div class="vbc-sep"></div><span class="vbc-match">${matchLine}</span>` : ''}
        ${otherReplays.length ? `<div class="vbc-sep"></div><span class="vbc-also">Also:</span>${otherHtml}` : ''}
      `;
    } catch (e) {
      // breadcrumb is non-critical — fail silently
    }
  }

  setupControls () {
    const self = this;

    this.tutorialWindow  = document.getElementById("tutorial-wrapper");
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

    this.scrubber = new window.TimeScrubber("scrubber-bar", "main-canvas");

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

    this.layoutMode = LayoutMode.liveBuildOrder;
    this.boData = new BuildOrderData();
    this.mapRenderer = new MapRenderer();
    this.displayScale = 1.0;

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
    if (!uploadWrapperEl) return;

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
    if (!this.tutorialWindow || !this.tutorialBackdrop) { return; }
    this.advanceTutorial(1);
    this.tutorialWindow.style.display = "block";
    this.tutorialBackdrop.style.display = "block";
  }

  hideTutorial() {
    if (!this.tutorialWindow || !this.tutorialBackdrop) { return; }
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
      if (el) el.style.display = "none";
    });
  }

  showUploadContents (which, optText = null, data = null) {
    if (!document.getElementById("upload-wrapper")) return;
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

    // Use absolute URL for dev (with port), relative for production to avoid mixed-content issues
    const url = this.isDev
      ? `http://127.0.0.1:8080/replays/${filename}`
      : `/replays/${filename}`;

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

    // make sure mega play button and match complete banner are hidden
    this.toggleMegaPlayButton(false);
    this.hideMatchCompleteBanner();

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
    const viewerControlsPanel = document.getElementById("viewer-controls");

    this.emptyGameWrapper.style.display = "none";

    loadingIcon.style.display = isLoading ? "block" : "none";

    isLoading ?
      viewerControlsPanel.classList.add("disabled") :
      viewerControlsPanel.classList.remove("disabled");
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
    this.hideMatchCompleteBanner();
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

  restart () {
    this.hideMatchCompleteBanner();
    this.gameTime = 0;
    this.scrubber.moveTracker(0);

    this.players.forEach(player => {
      player.moveTracker(0);
    });

    this.play();
  }

  showMatchCompleteBanner () {
    const el = document.getElementById('match-complete-banner');
    if (el) el.style.display = 'flex';
  }

  hideMatchCompleteBanner () {
    const el = document.getElementById('match-complete-banner');
    if (el) el.style.display = 'none';
  }

  setLayoutMode (mode) {
    if (mode === 'default') {
      this.layoutMode = LayoutMode.liveBuildOrder;
    } else if (mode === 'build') {
      this.layoutMode = LayoutMode.staticBuildOrder;
    } else if (mode === 'replay') {
      this.layoutMode = LayoutMode.gameplay;
    }

    this.applyLayoutMode();
  }

  setViewType (tab) {
    if (tab === 'gameplay') {
      this.layoutMode = LayoutMode.gameplay;
    } else if (tab === 'build-order') {
      this.layoutMode = LayoutMode.staticBuildOrder;
    }

    this.applyLayoutMode();
  }

  setBuildView (tab) {
    if (tab === 'live') {
      this.layoutMode = LayoutMode.liveBuildOrder;
    } else {
      this.layoutMode = LayoutMode.staticBuildOrder;
    }

    this.applyLayoutMode();
  }

  applyLayoutMode () {
    const app = document.getElementById('app');

    // Remove all layout mode classes
    app.classList.remove('layout-mode-gameplay', 'layout-mode-static-bo', 'layout-mode-live-bo');

    // Apply current mode
    app.classList.add(`layout-mode-${this.layoutMode}`);

    // Update mode switcher button states
    const oldModes = Array.from(document.getElementsByClassName("mode-btn selected"));
    oldModes.forEach(el => el.classList.remove('selected'));

    if (this.layoutMode === LayoutMode.liveBuildOrder) {
      const el = document.getElementById('mode-default');
      if (el) el.classList.add('selected');
    } else if (this.layoutMode === LayoutMode.staticBuildOrder) {
      const el = document.getElementById('mode-build');
      if (el) el.classList.add('selected');
    } else if (this.layoutMode === LayoutMode.gameplay) {
      const el = document.getElementById('mode-replay');
      if (el) el.classList.add('selected');
    }

    // Keep old viewMode/buildViewMode in sync for any code still reading them
    this.viewMode = (this.layoutMode === LayoutMode.gameplay) ? ViewModes.gameplay : ViewModes.buildOrder;
    this.buildViewMode = (this.layoutMode === LayoutMode.liveBuildOrder) ? BuildView.live : BuildView.static;

    // Handle render loop — stop RAF when canvas is not visible
    if (this.layoutMode === LayoutMode.staticBuildOrder) {
      if (this.state === ScrubStates.playing) {
        this.pause();
      }
    }

    // In live mode, scale the canvases via CSS to fit the half-viewport
    if (this.layoutMode === LayoutMode.liveBuildOrder) {
      this.scaleLiveModeCanvas();
    } else if (this.gameScaler) {
      this.resetCanvasScale();
    }

    // Re-render build order if in a BO mode
    if (this.layoutMode !== LayoutMode.gameplay && this.gameLoaded) {
      this.boRenderer.renderBuildOrder();
    } else if (this.timelineSpline) {
      this.timelineSpline.destroy();
    }

    // Re-render canvas if visible
    if (this.layoutMode !== LayoutMode.staticBuildOrder && this.gameLoaded) {
      this.render();
    }
  }

  scaleLiveModeCanvas () {
    if (!this.gameScaler) return;

    const gameplayArea = document.getElementById('gameplay-area');
    if (!gameplayArea) return;

    requestAnimationFrame(() => {
      const availableWidth = gameplayArea.clientWidth;
      const availableHeight = gameplayArea.clientHeight;

      const mapWidth = this.gameScaler.mapImage.width;
      const mapHeight = this.gameScaler.mapImage.height;

      const scaleX = availableWidth / mapWidth;
      const scaleY = availableHeight / mapHeight;
      const scale = Math.min(scaleX, scaleY, 1.0);

      const displayWidth = Math.floor(mapWidth * scale);
      const displayHeight = Math.floor(mapHeight * scale);

      this.canvas.style.width = displayWidth + 'px';
      this.canvas.style.height = displayHeight + 'px';
      this.playerCanvas.style.width = displayWidth + 'px';
      this.playerCanvas.style.height = displayHeight + 'px';
      this.utilityCanvas.style.width = displayWidth + 'px';
      this.utilityCanvas.style.height = displayHeight + 'px';

      this.displayScale = scale;

      if (this.gameLoaded) {
        this.render();
      }
    });
  }

  resetCanvasScale () {
    if (!this.gameScaler) return;

    const mapWidth = this.gameScaler.mapImage.width;
    const mapHeight = this.gameScaler.mapImage.height;

    this.canvas.style.width = mapWidth + 'px';
    this.canvas.style.height = mapHeight + 'px';
    this.playerCanvas.style.width = mapWidth + 'px';
    this.playerCanvas.style.height = mapHeight + 'px';
    this.utilityCanvas.style.width = mapWidth + 'px';
    this.utilityCanvas.style.height = mapHeight + 'px';

    this.displayScale = 1.0;
  }

  seekToGameTime (gameTime) {
    if (!this.gameLoaded) return;

    this.toggleMegaPlayButton(false);
    this.hideMatchCompleteBanner();
    this.gameTime = gameTime;

    const matchPercentage = ((gameTime / this.matchEndTime) * 100).toPrecision(2);
    this.scrubber.moveTracker(matchPercentage);

    this.players.forEach(player => {
      player.moveTracker(gameTime);
    });

    this.render();
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

    this.layoutMode = hasBuildParam ? LayoutMode.staticBuildOrder : LayoutMode.liveBuildOrder;
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

    // Mode switcher is in the menu bar now; no title text needed

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
      this.timelineSpline = new TimelineSpline(this);
      this.boRenderer = new BuildOrderRenderer(this);
      this.setupBuildOrder();

      this.timelineSpline.observeResize();

      this.applyLayoutMode();

      this.render();
    });
  }

  setupBuildOrder () {
    this.boRenderer.setupBuildOrder();
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

    self.playerCanvas.width = mapWidth;
    self.playerCanvas.height = mapHeight;

    self.utilityCanvas.width = mapWidth;
    self.utilityCanvas.height = mapHeight;

    const { width, height } = this.canvas;

    this.gameDisplayBox = new GameDisplayBox(this.teamColorMap, this.assignedPlayerColors);
    this.gameDisplayBox.setData(
      world.neutralGroups, GameDisplayBox.neutralCampHandler(this.gameScaler, this.transform));

    this.canvas.addEventListener('mousedown', (e) => {
      if (self.layoutMode === LayoutMode.liveBuildOrder) return;
      self.gameDisplayBox.handleMouse(e, 'down', self.transform);
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (self.layoutMode === LayoutMode.liveBuildOrder) return;
      self.gameDisplayBox.handleMouse(e, 'move', self.transform);
    });

    this.toggleMegaPlayButton(true);
    this.gameLoaded = true;

    this.zoomContainer = d3.select("#main-canvas");

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
        this.scrubber.updateZoomDisplay(transform.k);

        this.render();
      });

    this.zoomContainer
      .call(this.zoom);

    this.scrubber.onZoomChange = (k) => {
      this.zoomContainer.call(this.zoom.scaleTo, k);
    };

    // ResizeObserver for live mode canvas rescaling
    const gameplayArea = document.getElementById('gameplay-area');
    if (gameplayArea && typeof ResizeObserver !== 'undefined') {
      let resizeTimeout;
      new ResizeObserver(() => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
          if (self.layoutMode === LayoutMode.liveBuildOrder) {
            self.scaleLiveModeCanvas();
          }
        }, 100);
      }).observe(gameplayArea);
    }
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
    if (this.layoutMode === LayoutMode.staticBuildOrder) {
      this.stopRenderLoop();
      return;
    }

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
      this.stop();
      this.showMatchCompleteBanner();
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



  render () {
    // No canvas rendering needed in static BO mode
    if (this.layoutMode === LayoutMode.staticBuildOrder) {
      return;
    }

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

    this.mapRenderer.renderMapBackground(ctx, transform, viewOptions, this.gameScaler, this.mapImage, this.gridMapImage);

    // stored data about each frame
    let frameData = {
      nameplateTree: new rbush(),
      unitDrawPositions: [],
      drawnUnits: {}
    };

    this.mapRenderer.renderMapGrid(utilityCtx, transform, viewOptions, this.gameScaler, this.mapInfo, this.gridData, this.canvas);
    this.mapRenderer.renderMapTrees(utilityCtx, transform, viewOptions, this.doodadData, this.gameScaler);
    this.mapRenderer.renderNeutralGroups(utilityCtx, gameTime, transform, this.mapData, viewOptions, this.gameScaler, this.players, this.teamColorMap);

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

    this.boRenderer.updateLiveBoHighlight();
  }

};

window.wc3v = new Wc3vViewer();
