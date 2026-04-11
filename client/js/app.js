const Wc3vViewer = class {
  constructor () {
    this.reset();
  }

  bootstrap () {
    this.setupControls();

    const urlParams = new URLSearchParams(window.location.search);
    const replay    = urlParams.get('r');
    const buildId   = urlParams.get('buildId');
    this.renderBuildContext(buildId);

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
    const urlParams = new URLSearchParams(window.location.search);
    const currentReplayId = urlParams.get('r');

    try {
      const res = await fetch('/data/builds-manifest.json');
      const manifest = await res.json();
      const build = buildId ? (manifest.builds || []).find(b => b.id === buildId) : null;

      // Find ALL builds that reference this replay (covers both players)
      this.buildContextBySlot = {};
      (manifest.builds || []).forEach(b => {
        (b.replays || []).forEach(r => {
          if (r.replayId === currentReplayId) {
            this.buildContextBySlot[r.playerSlot] = {
              name: b.name, race: b.race, buildId: b.id, selected: (b.id === buildId)
            };
          }
        });
      });

      if (!build) return;

      // Build replay list for dropdown — all replays for this build, sorted by map then player
      const allReplays = (build.replays || []).slice();
      allReplays.sort((a, b) => {
        const mapCmp = (a.map || '').localeCompare(b.map || '');
        if (mapCmp !== 0) return mapCmp;
        return (a.playerName || '').localeCompare(b.playerName || '');
      });

      // Tag duplicates with (#N)
      const seen = {};
      allReplays.forEach(r => {
        const key = `${r.map || ''}-${r.playerName || ''}`;
        seen[key] = (seen[key] || 0) + 1;
      });
      const counters = {};
      allReplays.forEach(r => {
        const key = `${r.map || ''}-${r.playerName || ''}`;
        if (seen[key] > 1) {
          counters[key] = (counters[key] || 0) + 1;
          r._dupLabel = ` (#${counters[key]})`;
        }
      });

      // Store for MatchHeader to use
      this.buildContext = { build, allReplays, currentReplayId };
    } catch (e) {
      // build context is non-critical — fail silently
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

    if (this.unitsProductionPanel) this.unitsProductionPanel.destroy();
    this.unitsProductionPanel = new window.UnitsProductionPanel(this);

    this.floatingText = new window.FloatingText();
    this.placementViewer = new window.BuildingPlacementViewer();
    this.matchSummary = new window.MatchSummary(this);

    if (this.chapterMarkers) this.chapterMarkers.destroy();

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
    this.hasBeenPlayedOnce = false;
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
        const size = res.target && res.target.responseText ? res.target.responseText.length : 0;
        console.error(`Failed to load replay "${filename}" (response size: ${size} chars): ${e.message}`);
        console.error('If JSON is truncated, re-parse with: node wc3v.js --replay=NAME --debug');
      }
    });

    this.scrubber.init();
    this.scrubber.setupControls({
      "play": (e) => { this.togglePlay(e); },
      "speed": (e) => { this.toggleSpeed(e); },
      "track": (e) => { this.moveTracker(e); },
      "fullscreen": (e) => { this.toggleFullscreen(e); },
      "settings": (e) => { this.toggleSettings(e); }
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
        resolve();
      }, false);

    });
  }

  loadGridFile () {
    this.gridData = [];
  }

  loadWalkmap () {
    const { name } = this.mapInfo;
    const filePath = `../maps/${name}/walkmap.json`;

    return new Promise((resolve) => {
      this.loadFile(filePath, (res) => {
        try {
          if (res.target.status < 300) {
            this._walkmap = JSON.parse(res.target.responseText);
          } else {
            this._walkmap = null;
          }
        } catch (e) {
          this._walkmap = null;
        }
        resolve(true);
      });
    });
  }

  loadDoodadFile () {
    const self = this;
    const { name } = this.mapInfo;
    const filePath = `../maps/${name}/doo.json`;

    return new Promise((resolve) => {
      this.loadFile(filePath, (res) => {
        try {
          if (res.target.status < 300) {
            const jsonData = JSON.parse(res.target.responseText);
            self.doodadData = jsonData.grid;
          } else {
            console.warn(`doodad file not found: ${filePath} (status ${res.target.status})`);
            self.doodadData = null;
          }
        } catch (e) {
          console.error(`Failed to parse ${filePath}: ${e.message}`);
          self.doodadData = null;
        }
        resolve(true);
      });
    })
  }

  // Build a canvas-space walkability bitmap from WPM pathing data + tree positions.
  // Used by bloom/formation to prevent pushing units into water, cliffs, or trees.
  buildTerrainIndex () {
    if (!this.gameScaler) {
      this._terrainIndex = null;
      this._treeIndex = null;
      return;
    }

    const { xScale, yScale, middleX, middleY } = this.gameScaler;

    // WPM-based blocked cells (water, cliffs, unwalkable terrain)
    const CELL_SIZE = 10; // canvas pixels per terrain cell
    const blocked = {};

    if (this._walkmap) {
      const { rows, cols, originX, originY, cellSize, walkable } = this._walkmap;
      for (let col = 0; col < rows; col++) {
        for (let row = 0; row < cols; row++) {
          const idx = col * cols + row;
          if (walkable[idx] === '1') continue; // walkable, skip

          const gameX = originX + (row * cellSize);
          const gameY = originY - (col * cellSize);
          const cx = xScale(gameX) + middleX;
          const cy = yScale(gameY) + middleY;
          const key = Math.floor(cx / CELL_SIZE) + ',' + Math.floor(cy / CELL_SIZE);
          blocked[key] = true;
        }
      }
    }

    const blockedCount = Object.keys(blocked).length;
    console.log(`[terrain] walkmap loaded: ${!!this._walkmap}, blocked cells: ${blockedCount}, trees: ${this.doodadData ? this.doodadData.length : 0}`);

    this._terrainIndex = { blocked, cellSize: CELL_SIZE };

    // also build tree index for point-based collision
    const treeGrid = {};
    if (this.doodadData) {
      const TREE_CELL = 40;
      this.doodadData.forEach(tree => {
        const { position, scale } = tree;
        const drawX = xScale(position.x) + middleX;
        const drawY = yScale(position.y) + middleY;
        const radius = 12 * scale[0];

        const cellX = Math.floor(drawX / TREE_CELL);
        const cellY = Math.floor(drawY / TREE_CELL);
        const key = cellX + ',' + cellY;

        if (!treeGrid[key]) treeGrid[key] = [];
        treeGrid[key].push({ x: drawX, y: drawY, r: radius });
      });
    }
    this._treeIndex = { grid: treeGrid, cellSize: 40 };
  }

  // Check if a canvas position is on non-walkable terrain (water, cliffs, etc.)
  static isBlockedTerrain (terrainIndex, x, y) {
    if (!terrainIndex) return false;
    const { blocked, cellSize } = terrainIndex;
    const key = Math.floor(x / cellSize) + ',' + Math.floor(y / cellSize);
    return !!blocked[key];
  }

  // Check if a canvas position collides with a tree sprite
  static treeCollisionCheck (treeIndex, x, y, unitRadius) {
    if (!treeIndex) return null;
    const { grid, cellSize } = treeIndex;
    const cx = Math.floor(x / cellSize);
    const cy = Math.floor(y / cellSize);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const trees = grid[(cx + dx) + ',' + (cy + dy)];
        if (!trees) continue;
        for (let i = 0; i < trees.length; i++) {
          const t = trees[i];
          const tdx = x - t.x;
          const tdy = y - t.y;
          const dist = Math.sqrt(tdx * tdx + tdy * tdy);
          const minDist = t.r + unitRadius;
          if (dist < minDist) {
            return { tree: t, dist, minDist };
          }
        }
      }
    }
    return null;
  }

  loadNeutralBuildings () {
    const { name } = this.mapInfo;

    return new Promise((resolve) => {
      this.loadFile(`../maps/${name}/neutralBuildings.json`, (res) => {
        try {
          if (res.target.status < 300) {
            this.neutralBuildings = JSON.parse(res.target.responseText);
          } else {
            this.neutralBuildings = [];
          }
        } catch (e) {
          this.neutralBuildings = [];
        }
        resolve(true);
      });
    });
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
    const matchHeader = document.getElementById("match-header");

    this.emptyGameWrapper.style.display = "none";

    loadingIcon.style.display = isLoading ? "block" : "none";

    if (matchHeader) {
      matchHeader.style.display = isLoading ? "none" : "";
    }
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

  toggleSpeed (e) {
    if (e) e.stopPropagation();
    const speedModal = document.getElementById(`${this.scrubber.wrapperId}-speed-modal`);
    const settingsModal = document.getElementById(`${this.scrubber.wrapperId}-settings-modal`);
    if (settingsModal) settingsModal.style.display = 'none';
    speedModal.style.display = speedModal.style.display !== "block" ?
      "block" : "none";
  }

  toggleSettings (e) {
    if (e) e.stopPropagation();
    const settingsModal = document.getElementById(`${this.scrubber.wrapperId}-settings-modal`);
    const speedModal = document.getElementById(`${this.scrubber.wrapperId}-speed-modal`);
    if (speedModal) speedModal.style.display = 'none';
    settingsModal.style.display = settingsModal.style.display !== "block" ?
      "block" : "none";
  }

  toggleFullscreen (e) {
    if (e) e.stopPropagation();

    const container = document.getElementById('map-container');
    if (!container) return;

    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen().catch(err => {
        console.warn('Fullscreen request failed:', err.message);
      });
    }
  }

  toggleMegaPlayButton (state) {
    if (state) {
      this.megaPlayButton.classList.remove('fading-out');
      this.megaPlayButton.style.display = "flex";
    } else {
      this.megaPlayButton.classList.add('fading-out');
      const el = this.megaPlayButton;
      const onEnd = () => {
        el.removeEventListener('transitionend', onEnd);
        el.style.display = "none";
        el.classList.remove('fading-out');
      };
      el.addEventListener('transitionend', onEnd);
    }
  }

  showPlacementViewer (playerId) {
    const player = this.players.find(p => p.playerId === String(playerId));
    if (!player) {
      console.warn('[PlacementViewer] player not found:', playerId);
      return;
    }

    const playerData = this.mapData.players[playerId];
    if (!playerData || !playerData.baseGrid) {
      console.warn('[PlacementViewer] no baseGrid data for player', playerId);
      return;
    }

    if (!playerData.baseSnapshots || !playerData.baseSnapshots.length) {
      console.warn('[PlacementViewer] no baseSnapshots for player', playerId);
      return;
    }

    this.placementViewer.show(playerData.baseGrid, playerData.baseSnapshots, player.playerColor, this.neutralBuildings, this.mapImage, this.gameScaler, player.displayName, player.race);
  }

  toggleViewOption (optionKey) {
    this.viewOptions[optionKey] = !this.viewOptions[optionKey];
    const isOn = this.viewOptions[optionKey];

    // sync all matching toggle elements (toolbar + mega-hint)
    const els = document.querySelectorAll(
      `#viewer-option-${optionKey}, .mega-hint[data-option="${optionKey}"]`
    );
    els.forEach(el => isOn ? el.classList.add('on') : el.classList.remove('on'));

    if (this.gameLoaded) {
      this.render();
    }
  }

  play () {
    const { wrapperId } = this.scrubber;

    this.scrubber.loadSvg(`#${wrapperId}-play`, 'pause-icon');
    this.state = ScrubStates.playing;
    this.hasBeenPlayedOnce = true;

    this.toggleMegaPlayButton(false);
    this.hideMatchCompleteBanner();
    this.startRenderLoop();
  }

  pause () {
    const { wrapperId } = this.scrubber;

    this.scrubber.loadSvg(`#${wrapperId}-play`, 'play-icon');
    this.state = ScrubStates.paused;

    this.stopRenderLoop();
    if (this.hasBeenPlayedOnce) this.renderGameClock();
  }

  stop () {
    const { wrapperId } = this.scrubber;

    this.scrubber.loadSvg(`#${wrapperId}-play`, 'stop-icon');
    this.state = ScrubStates.stopped;

    this.stopRenderLoop();
    if (this.hasBeenPlayedOnce) this.renderGameClock();
  }

  restart () {
    this.hideMatchCompleteBanner();
    this.gameTime = 0;
    this.scrubber.moveTracker(0);

    // Reset neutral camp visibility flags so hover works again
    if (this.mapData && this.mapData.world && this.mapData.world.neutralGroups) {
      Object.values(this.mapData.world.neutralGroups).forEach(group => {
        group.isHidden = false;
      });
    }
    const neutralPlayer = this.players.find(p => p.playerId === "1042");
    if (neutralPlayer) {
      neutralPlayer.units.forEach(unit => {
        unit.isNeutralGroupHidden = false;
      });
    }
    if (this.gameDisplayBox) {
      this.gameDisplayBox.hide();
    }

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

  showMatchSummary () {
    if (!this.gameLoaded || !this.matchSummary) return;
    this.matchSummary.show();
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

    // Update match header controls visibility
    if (this.matchHeader) {
      this.matchHeader.updateLayoutMode(this.layoutMode);
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

    const mainWrapper = document.getElementById('main-wrapper');
    if (!mainWrapper) return;

    requestAnimationFrame(() => {
      const availableWidth = mainWrapper.clientWidth;
      const availableHeight = mainWrapper.clientHeight;

      const mapWidth = this.gameScaler.mapImage.width;
      const mapHeight = this.gameScaler.mapImage.height;

      const scaleX = availableWidth / mapWidth;
      const scaleY = availableHeight / mapHeight;
      const scale = Math.min(scaleX, scaleY);

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

    this.scaleLiveModeCanvas();
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

    this.megaPlayButton = document.getElementById("mega-play-overlay");

    // Mode switcher is in the menu bar now; no title text needed

    // player-status-toggles + player boxes
    this.playerStatusCanvas.height = 50 + (this.players.length * 140);

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
    .then(() => { return this.loadWalkmap(); })
    .then(() => { return this.loadNeutralBuildings(); })
    .then(() => { return this.loadGridFile(); })
    .then(() => { return this.loadUnitBalance(); })
    .then(playerLoadedPromiseList)
    .then(() => {
      this.setupDrawing();
      this.buildTerrainIndex();
      this.timelineSpline = new TimelineSpline(this);
      this.boRenderer = new BuildOrderRenderer(this);
      this.chapterMarkers = new ChapterMarkers(this);
      this.matchHeader = new MatchHeader(this);
      this.placementViewer.setup();
      this.matchSummary.setup();
      this.setupBuildOrder();
      this.matchHeader.render();

      this.chapterMarkers.detectChapters(this.players, this.matchEndTime);
      const cmTrack = document.getElementById('scrubber-bar-track');
      if (cmTrack) {
        this.chapterMarkers.renderScrubberMarkers(cmTrack, this.matchEndTime);
        this.chapterMarkers.renderHeatmap(cmTrack, this.players, this.matchEndTime);
      }

      this.timelineSpline.observeResize();

      this.unitsProductionPanel.setup(this.players);

      this.applyLayoutMode();

      this.render();
    });
  }

  loadUnitBalance () {
    if (this.unitBalance) return Promise.resolve();
    return fetch('/data/unit-balance-lite.json')
      .then(res => res.json())
      .then(data => {
        this.unitBalance = data;
      })
      .catch(() => {
        this.unitBalance = {};
      });
  }

  setupBuildOrder () {
    this.boRenderer.setupBuildOrder();
  }

  setupViewOptions () {
    this.viewOptions = {
      displayPath: true,
      displayLevelPins: true,
      displayFloatingText: true,
      decayEffects: true,
      displayText: true,

      displayMapGrid: false,
      displayTreeGrid: true,
      displayWalkGrid: false,
      displayBuildGrid: false,
      displayWaterGrid: false,
      displayCreepRoute: true,
      displayNeutralBuildings: true
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

    // populate settings modal with view option toggles
    const settingsModalEl = document.getElementById(`${this.scrubber.wrapperId}-settings-modal`);
    if (settingsModalEl) {
      const buttons = [
        { key: 'displayCreepRoute', label: 'Creep Routes', featured: true },
        { key: 'displayPath', label: 'Hero Paths' },
        { key: 'displayLevelPins', label: 'Level Pins' },
        { key: 'displayFloatingText', label: 'Action Text' },
        { key: 'displayText', label: 'Unit Names' },
        { key: 'decayEffects', label: 'Fade FX' },
        { key: 'displayTreeGrid', label: 'Tree Grid' }
      ];

      settingsModalEl.innerHTML = '';

      buttons.forEach(btn => {
        const el = document.createElement('div');
        el.classList.add('vc-btn');
        if (btn.featured) el.classList.add('vc-featured');
        el.id = `viewer-option-${btn.key}`;
        el.textContent = btn.label;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          this.toggleViewOption(btn.key);
        });
        if (this.viewOptions[btn.key]) el.classList.add('on');
        settingsModalEl.append(el);
      });
    }

    // close modals when clicking outside
    document.addEventListener('click', (e) => {
      const settingsBtn = document.getElementById(`${this.scrubber.wrapperId}-settings`);
      const settingsModal = document.getElementById(`${this.scrubber.wrapperId}-settings-modal`);
      if (settingsModal && settingsModal.style.display === 'block') {
        if (!settingsBtn.contains(e.target)) {
          settingsModal.style.display = 'none';
        }
      }

      const speedBtn = document.getElementById(`${this.scrubber.wrapperId}-speed`);
      const speedModal = document.getElementById(`${this.scrubber.wrapperId}-speed-modal`);
      if (speedModal && speedModal.style.display === 'block') {
        if (!speedBtn.contains(e.target)) {
          speedModal.style.display = 'none';
        }
      }
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
        itemStream,
        apmData,
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
        eventStream,
        itemStream,
        apmData
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



    // split on both / and \ to handle W3C paths like "Maps/W3Champions\59_w3c_..."
    const mapParts = file.split(/[/\\]/);

    this.matchEndTime = subheader.replayLengthMS;

    this.mapName = mapParts[mapParts.length - 1].toLowerCase();

    // strip W3C numbered prefix: "{num}_w3c_{date}_{time}_" → just the map name
    const w3cPrefixMatch = this.mapName.match(/^\d+_w3c_\d+_\d+_(.+)$/);
    const strippedMapName = w3cPrefixMatch ? w3cPrefixMatch[1] : this.mapName;

    const foundMapName = maps[this.mapName] ? this.mapName : Object.keys(maps).find(mapItem => {
      const searchName = maps[mapItem].name.toLowerCase();

      if (this.mapName.indexOf(searchName) !== -1) {
        return mapItem;
      }

      if (strippedMapName !== this.mapName && strippedMapName.indexOf(searchName) !== -1) {
        return mapItem;
      }

      // match base map name without version for newer map versions
      const baseSearchName = searchName.replace(/[_-]v[\d._-]+$/, '');
      const baseMapName = strippedMapName.replace('.w3x', '').replace(/[_-]v[\d._-]+$/, '');
      if (baseSearchName.length > 3 && baseMapName === baseSearchName) {
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
    const zoomScaleExtent = [ 1.0, 3.0 ];
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

    this.gameDisplayBox = new GameDisplayBox(this.teamColorMap, this.assignedPlayerColors);
    this.gameDisplayBox.setData(
      world.neutralGroups, GameDisplayBox.neutralCampHandler(this.gameScaler, this.transform));

    console.log('[CampSetup] gameDisplayBox created, data set, tree items:', this.gameDisplayBox.data.tree.all().length);
    console.log('[CampSetup] transform at setup:', JSON.stringify(this.transform));
    console.log('[CampSetup] canvas element:', this.canvas.id, this.canvas.width, 'x', this.canvas.height);

    this.toggleMegaPlayButton(true);
    this.gameLoaded = true;

    this.zoomContainer = d3.select("#canvas-group");

    this.zoom = d3.zoom()
      .scaleExtent(zoomScaleExtent)
      .filter(() => {
        // allow wheel zoom always, but block mousedown drag at default zoom
        // (nothing to pan at k=1, and D3 drag kills mousemove for camp hover)
        if (d3.event.type === 'mousedown' && this.transform.k <= 1.0) {
          return false;
        }
        // default D3 filter: no ctrl key, no secondary button
        return !d3.event.ctrlKey && !d3.event.button;
      })
      .on("zoom", () => {
        if (!this.ctx) {
          return;
        }

        const { transform } = d3.event;

        // D3 computes mouse position in CSS display-space, but the canvas
        // render pipeline works in pixel-space. Convert translation by the
        // ratio between display size and pixel size.
        const ds = this.displayScale || 1;
        this.transform = {
          x: transform.x / ds,
          y: transform.y / ds,
          k: transform.k
        };

        // when zooming back to 1.0 with an offset, snap to origin
        if (this.transform.k <= 1.0 && (this.transform.x !== 0 || this.transform.y !== 0)) {
          this.transform.x = 0;
          this.transform.y = 0;
        }

        this.gameDisplayBox.hide();
        this.scrubber.updateZoomDisplay(this.transform.k);

        this.render();
      });

    this.zoomContainer
      .call(this.zoom);

    // camp hover
    this.zoomContainer.on('mousemove.camphover', () => {
      if (self.state === ScrubStates.stopped) return;
      self.gameDisplayBox.handleMouse(d3.event, self.transform);
    });

    this.scrubber.onZoomChange = (k) => {
      this.zoomContainer.call(this.zoom.scaleTo, k);
    };

    // reset zoom on window resize — d3.zoom's internal state becomes stale
    // when canvas dimensions change, causing pan to escape bounds
    const resetZoomOnResize = () => {
      if (!self.gameLoaded) return;
      self.transform = { x: 0, y: 0, k: 1.0 };
      self.zoomContainer.call(self.zoom.transform, d3.zoomIdentity);
      self.scrubber.updateZoomDisplay(1.0);
      if (self.state !== ScrubStates.stopped) {
        self.render();
      }
    };

    window.addEventListener('resize', resetZoomOnResize);

    // ResizeObserver — watch gameplay-area (its size only changes from window/layout, not canvas)
    const resizeTarget = document.getElementById('gameplay-area');
    if (resizeTarget && typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => {
        if (self.layoutMode === LayoutMode.liveBuildOrder) {
          self.scaleLiveModeCanvas();
        }
        resetZoomOnResize();
      }).observe(resizeTarget);
    }

    // Fullscreen change — rescale canvas and swap icon
    document.addEventListener('fullscreenchange', () => {
      const isFullscreen = !!document.fullscreenElement;

      self.scrubber.loadSvg(
        `#${self.scrubber.wrapperId}-fullscreen-icon`,
        isFullscreen ? 'fullscreen-exit-icon' : 'fullscreen-icon'
      );

      self.scaleLiveModeCanvas();

      if (self.gameLoaded && self.zoomContainer && self.zoom) {
        self.transform = { x: 0, y: 0, k: 1.0 };
        self.zoomContainer.call(self.zoom.transform, d3.zoomIdentity);
        self.scrubber.updateZoomDisplay(1.0);
      }
    });
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



  renderGameClock () {
    const { playerCtx, state, gameTime } = this;
    if (!playerCtx) return;

    const cw = this.canvas.width;
    const timeText = formatGameTime(gameTime);
    const isPlaying = state === ScrubStates.playing;

    const pillH    = 52;
    const pillPadX = 22;
    const iconSize = 22;
    const iconGap  = 11;
    const fontSize = 26;
    const topY     = 20;

    playerCtx.save();
    playerCtx.setTransform(1, 0, 0, 1, 0, 0);

    playerCtx.font = `bold ${fontSize}px Arial`;
    const textW = playerCtx.measureText(timeText).width;
    const pillW = pillPadX + iconSize + iconGap + textW + pillPadX;
    const pillX = Math.round(cw / 2 - pillW / 2);
    const pillY = topY;
    const radius = pillH / 2;

    // Semi-transparent pill background
    playerCtx.globalAlpha = 0.72;
    playerCtx.fillStyle = 'rgba(10, 14, 20, 0.78)';
    playerCtx.beginPath();
    playerCtx.moveTo(pillX + radius, pillY);
    playerCtx.lineTo(pillX + pillW - radius, pillY);
    playerCtx.quadraticCurveTo(pillX + pillW, pillY, pillX + pillW, pillY + radius);
    playerCtx.lineTo(pillX + pillW, pillY + pillH - radius);
    playerCtx.quadraticCurveTo(pillX + pillW, pillY + pillH, pillX + pillW - radius, pillY + pillH);
    playerCtx.lineTo(pillX + radius, pillY + pillH);
    playerCtx.quadraticCurveTo(pillX, pillY + pillH, pillX, pillY + pillH - radius);
    playerCtx.lineTo(pillX, pillY + radius);
    playerCtx.quadraticCurveTo(pillX, pillY, pillX + radius, pillY);
    playerCtx.closePath();
    playerCtx.fill();

    // Subtle border
    playerCtx.globalAlpha = 0.40;
    playerCtx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    playerCtx.lineWidth = 1;
    playerCtx.stroke();

    playerCtx.globalAlpha = 1.0;

    // Play/pause icon
    const iconX  = pillX + pillPadX;
    const iconCY = pillY + pillH / 2;
    playerCtx.fillStyle = isPlaying ? '#FFFFFF' : '#FFD740';

    if (isPlaying) {
      // Pause icon: two vertical bars
      const barW = 3.5, barH = iconSize * 0.7, gap = 3;
      const barsLeft = iconX + (iconSize - barW * 2 - gap) / 2;
      playerCtx.fillRect(Math.round(barsLeft), Math.round(iconCY - barH / 2), barW, barH);
      playerCtx.fillRect(Math.round(barsLeft + barW + gap), Math.round(iconCY - barH / 2), barW, barH);
    } else {
      // Play icon: right-pointing triangle
      const tw = iconSize * 0.6, th = iconSize * 0.65;
      const tx = iconX + (iconSize - tw) / 2;
      playerCtx.beginPath();
      playerCtx.moveTo(tx,      Math.round(iconCY - th / 2));
      playerCtx.lineTo(tx + tw, Math.round(iconCY));
      playerCtx.lineTo(tx,      Math.round(iconCY + th / 2));
      playerCtx.closePath();
      playerCtx.fill();
    }

    // Time text
    const textX = iconX + iconSize + iconGap;
    const textY = pillY + pillH / 2 + Math.round(fontSize * 0.36);
    playerCtx.fillStyle = '#FFFFFF';
    playerCtx.font = `bold ${fontSize}px Arial`;
    playerCtx.textBaseline = 'alphabetic';
    playerCtx.fillText(timeText, textX, textY);

    playerCtx.restore();
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
      buildingPositions: [],
      drawnUnits: {},
      gameTime: gameTime
    };

    this.mapRenderer.renderMapGrid(utilityCtx, transform, viewOptions, this.gameScaler, this.mapInfo, this.gridData, this.canvas);
    this.mapRenderer.renderMapTrees(utilityCtx, transform, viewOptions, this.doodadData, this.gameScaler, this.mapInfo);
    const hoveredCampUuid = this.gameDisplayBox ? this.gameDisplayBox.hoveredCampUuid : null;
    this.mapRenderer.renderNeutralGroups(utilityCtx, gameTime, transform, this.mapData, viewOptions, this.gameScaler, this.players, this.teamColorMap, hoveredCampUuid);
    this.mapRenderer.renderNeutralBuildings(utilityCtx, transform, viewOptions, this.neutralBuildings, this.gameScaler);

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

    // compute spawn bias angles once (lazy init)
    if (!this._spawnBiasComputed) {
      players.forEach(player => {
        if (!player.isNeutralPlayer && player.startingPosition) {
          const sx = xScale(player.startingPosition.x) + middleX;
          const sy = yScale(player.startingPosition.y) + middleY;
          player._spawnBiasAngle = Math.atan2(sy - middleY, sx - middleX);
        }
      });
      this._spawnBiasComputed = true;
    }

    // single-pass resolve: use PREVIOUS frame's engagement state as forceMode
    players.forEach(player => {
      if (!player.isNeutralPlayer) {
        player.resolveUnitPositions(frameData, player._wasEngaged ? 'engaged' : null);
      } else {
        player.resolveUnitPositions(frameData);
      }
    });

    // compute engagement for NEXT frame (hysteretic thresholds)
    const armyPlayers = players.filter(p => !p.isNeutralPlayer && p._armyMeta);
    armyPlayers.forEach(p => { p._willEngage = false; });
    for (let i = 0; i < armyPlayers.length; i++) {
      for (let j = i + 1; j < armyPlayers.length; j++) {
        const metaA = armyPlayers[i]._armyMeta;
        const metaB = armyPlayers[j]._armyMeta;
        const dx = metaA.centroidX - metaB.centroidX;
        const dy = metaA.centroidY - metaB.centroidY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // hysteretic: enter engaged < 120px, exit > 180px
        const threshold = (armyPlayers[i]._wasEngaged || armyPlayers[j]._wasEngaged) ? 180 : 120;
        if (dist < threshold) {
          armyPlayers[i]._willEngage = true;
          armyPlayers[j]._willEngage = true;
        }
      }
    }
    armyPlayers.forEach(p => { p._wasEngaged = p._willEngage; });

    // cross-player collision — push apart units from different players
    const allReps = [];
    players.forEach(player => {
      if (!player.isNeutralPlayer && player._resolved) {
        player._resolved.representatives.forEach(rep => allReps.push(rep));
      }
    });
    ClientPlayer.crossPlayerCollision(allReps, 3, 25, this._treeIndex);

    // smooth cross-player collision displacements
    players.forEach(player => {
      if (!player._resolved || player.isNeutralPlayer) return;
      if (!player._crossCollisionCache) player._crossCollisionCache = new Map();

      const ccLerp = 0.3;
      player._resolved.representatives.forEach(rep => {
        const ccDx = rep.drawX - (rep._preCollisionX || rep.drawX);
        const ccDy = rep.drawY - (rep._preCollisionY || rep.drawY);
        const prev = player._crossCollisionCache.get(rep.uuid);
        if (prev) {
          const sx = prev.ox + (ccDx - prev.ox) * ccLerp;
          const sy = prev.oy + (ccDy - prev.oy) * ccLerp;
          rep.drawX = (rep._preCollisionX || rep.drawX) + sx;
          rep.drawY = (rep._preCollisionY || rep.drawY) + sy;
          player._crossCollisionCache.set(rep.uuid, { ox: sx, oy: sy });
        } else {
          player._crossCollisionCache.set(rep.uuid, { ox: ccDx, oy: ccDy });
        }
      });
    });

    // absolute displacement cap after ALL modifications — 35px max from true position
    const maxFinalDisp = 35;
    allReps.forEach(u => {
      if (!u._origX) return;
      const dx = u.drawX - u._origX;
      const dy = u.drawY - u._origY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxFinalDisp) {
        const scale = maxFinalDisp / dist;
        u.drawX = u._origX + dx * scale;
        u.drawY = u._origY + dy * scale;
      }
    });

    // terrain + tree clamp
    if (this._terrainIndex || this._treeIndex) {
      allReps.forEach(u => {
        if (Wc3vViewer.isBlockedTerrain(this._terrainIndex, u.drawX, u.drawY)) {
          u.drawX = u._origX;
          u.drawY = u._origY;
          return;
        }
        const hit = Wc3vViewer.treeCollisionCheck(this._treeIndex, u.drawX, u.drawY, u.halfIconSize);
        if (hit) {
          const tdx = u.drawX - hit.tree.x;
          const tdy = u.drawY - hit.tree.y;
          const d = hit.dist || 0.01;
          const push = hit.minDist - d;
          u.drawX += (tdx / d) * push;
          u.drawY += (tdy / d) * push;
        }
      });
    }

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

    // global nameplate pass — all players' unit icons as obstacles in one tree
    if (viewOptions.displayText) {
      frameData.allNameplateBoxes = ClientPlayer.buildNameplateBoxes(frameData, playerCtx);
      ClientPlayer.renderAllNameplates(frameData, playerCtx);
    }

    if (viewOptions.displayFloatingText && this.floatingText) {
      this.floatingText.update(players, gameTime);
      this.floatingText.render(playerCtx, transform, gameTime, xScale, yScale);
    }

    ctx.restore();
    playerCtx.restore();
    utilityCtx.restore();

    if (this.hasBeenPlayedOnce) {
      this.renderGameClock();
    }

    this.scrubber.render(gameTime, matchEndTime);

    this.boRenderer.updateLiveBoHighlight();

    if (this.unitsProductionPanel) {
      this.unitsProductionPanel.update(gameTime);
    }
  }

  debugPathingDump () {
    const gt = this.gameTime;
    const { xScale, yScale, middleX, middleY } = this.gameScaler;

    console.log('=== DEBUG PATHING DUMP at gameTime:', gt, '(' + (gt / 1000).toFixed(1) + 's) ===');
    console.log('terrainIndex:', !!this._terrainIndex, 'treeIndex:', !!this._treeIndex);

    this.players.forEach(player => {
      if (player.isNeutralPlayer) return;
      console.log(`\n--- Player ${player.playerId}: ${player.name} ---`);

      player.units.forEach(unit => {
        if (unit.isBuilding || !unit.path || !unit.path.length) return;
        if (unit.decayLevel < 0.3) return; // skip decayed/invisible

        const pathIdx = unit.recordIndexes.path;
        const pathNode = unit.path[pathIdx];
        if (!pathNode) return;

        const nextNode = unit.path[pathIdx + 1] || null;

        // where the path data says the unit is
        const pathX = pathNode.x;
        const pathY = pathNode.y;
        const pathDrawX = xScale(pathX) + middleX;
        const pathDrawY = yScale(pathY) + middleY;

        // where the unit was actually rendered (with dead band)
        const renderedX = unit._prevDrawX;
        const renderedY = unit._prevDrawY;

        // check terrain at both positions
        const pathBlocked = Wc3vViewer.isBlockedTerrain(this._terrainIndex, pathDrawX, pathDrawY);
        const renderedBlocked = renderedX !== null ? Wc3vViewer.isBlockedTerrain(this._terrainIndex, renderedX, renderedY) : null;
        const treeHitPath = Wc3vViewer.treeCollisionCheck(this._treeIndex, pathDrawX, pathDrawY, 10);
        const treeHitRendered = renderedX !== null ? Wc3vViewer.treeCollisionCheck(this._treeIndex, renderedX, renderedY, 10) : null;

        // find bloom-resolved position if available
        let bloomX = null, bloomY = null;
        if (player._resolved && player._resolved.representatives) {
          const rep = player._resolved.representatives.find(r => r.uuid === unit.uuid);
          if (rep) { bloomX = rep.drawX; bloomY = rep.drawY; }
        }

        const dt = nextNode ? (nextNode.gameTime - pathNode.gameTime) : null;
        const dist = nextNode ? Math.sqrt((nextNode.x - pathNode.x) ** 2 + (nextNode.y - pathNode.y) ** 2).toFixed(0) : null;

        console.log(
          `  ${unit.displayName} (${unit.itemId})`,
          `| pathIdx: ${pathIdx}/${unit.path.length}`,
          `| pathPos: (${pathX}, ${pathY})`,
          `| pathDraw: (${pathDrawX.toFixed(1)}, ${pathDrawY.toFixed(1)})`,
          pathBlocked ? '⛔BLOCKED' : '',
          treeHitPath ? '🌲TREE' : '',
          `| rendered: ${renderedX !== null ? `(${renderedX.toFixed(1)}, ${renderedY.toFixed(1)})` : 'null'}`,
          renderedBlocked ? '⛔BLOCKED' : '',
          treeHitRendered ? '🌲TREE' : '',
          bloomX !== null ? `| bloom: (${bloomX.toFixed(1)}, ${bloomY.toFixed(1)})` : '',
          `| nextDt: ${dt}ms nextDist: ${dist}`
        );
      });
    });
  }

};

window.wc3v = new Wc3vViewer();
