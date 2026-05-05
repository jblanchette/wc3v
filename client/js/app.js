const Wc3vViewer = class {
  constructor () {
    this.reset();
  }

  bootstrap () {
    this.setupControls();

    const urlParams = new URLSearchParams(window.location.search);
    const replay    = urlParams.get('r');
    const localId   = urlParams.get('local');
    const buildId   = urlParams.get('buildId');
    this.renderBuildContext(buildId);

    const hrefPath = window.location.href;
    const re = new RegExp('replay/(.*)', 'i');
    const match = re.exec(hrefPath);

    if (localId) {
      // User-uploaded replay parsed in-browser, stored in IndexedDB.
      const safeId = /^[A-Za-z0-9_-]{10}$/.test(localId) ? localId : null;
      if (!safeId) {
        console.error('Invalid local replay id');
        window.location.href = '/builds';
        return;
      }
      // Surface the overlay synchronously so the user sees feedback before
      // the deferred loadLocal call kicks off the heavy setup work.
      const overlay = document.getElementById('local-loading-overlay');
      if (overlay) overlay.style.display = 'flex';
      setTimeout(() => { this.loadLocal(safeId); });
    } else if (match) {
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

    if (this.minimapPip) this.minimapPip.destroy();
    this.minimapPip = null;

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

    this._renderPending = false;
    this._lastRenderedGameTime = -1;

    this.teamColorMap = {};

    this.layoutMode = LayoutMode.liveBuildOrder;
    this.boFilters = {
      buildings: true,
      units:     true,
      upgrades:  true,
      research:  true,
      items:     true,
      summaries: true
    };
    this.boData = new BuildOrderData();
    this.mapRenderer = new MapRenderer();
    this.threeMapRenderer = null; // created in setupCanvas once #three-canvas exists
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

        self.setup().then(() => {
          // removing loading status indicator only after full setup completes
          self.setLoadingStatus(false);
        });
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

  // Load a user-uploaded replay from IndexedDB (parsed in-browser via the
  // wc3v-parser bundle). Mirrors load() but skips the XHR — the parsed JSON
  // is already cached locally.
  //
  // Critical ordering: scrubber.init() + setupControls must run BEFORE
  // setup(). setup() kicks off setupDrawing, which fires zoom events, which
  // call render() → scrubber.render() → moveTracker(). If the scrubber DOM
  // hasn't been built yet, that path throws "null.style". The regular
  // load() avoids this because the XHR callback defers setup() to a later
  // tick, after scrubber.init() has run synchronously.
  async loadLocal (id) {
    const self = this;
    this.pause();
    this.reset();
    this.setLoadingStatus(true);

    // Show the loading overlay (in viewer.html) while we hydrate from IDB
    // and finish setup. Hidden inside the try once setup() resolves.
    const overlay = document.getElementById('local-loading-overlay');
    if (overlay) overlay.style.display = 'flex';

    this.scrubber.init();
    this.scrubber.setupControls({
      "play": (e) => { this.togglePlay(e); },
      "speed": (e) => { this.toggleSpeed(e); },
      "track": (e) => { this.moveTracker(e); },
      "fullscreen": (e) => { this.toggleFullscreen(e); },
      "settings": (e) => { this.toggleSettings(e); }
    });

    try {
      const my = new window.MyReplays();
      const record = await my.get(id);
      if (!record || !record.parsedJson) {
        // Most common cause: someone shared a `?local=ID` link, but the
        // recipient doesn't have the replay in their browser. Show a
        // friendly explanation instead of bouncing them to /builds.
        console.warn(`Local replay not found: ${id}`);
        if (overlay) overlay.style.display = 'none';
        const missing = document.getElementById('missing-replay-overlay');
        if (missing) {
          missing.style.display = 'flex';
        } else {
          window.location.href = '/';
        }
        this.setLoadingStatus(false);
        return;
      }
      this.replayId = `local-${id}`;
      this.mapData = record.parsedJson;
      await this.setup();
      this.setLoadingStatus(false);
      if (overlay) overlay.style.display = 'none';
    } catch (e) {
      console.error(`Failed to load local replay ${id}: ${e.message}`);
      this.setLoadingStatus(false);
      if (overlay) overlay.style.display = 'none';
    }
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
      // optText is internal status copy; treat as text, not HTML.
      document.getElementById("upload-progress-opt-text").textContent = optText;
    }

    if (data) {
      // mapName comes from a replay's metadata — escape before display.
      const safeMapName = Security.escapeHtml(Security.sanitizeUserText(data.error.data.mapName, { maxLen: 80 }));
      const missingMapText = `Missing map: ${safeMapName}`;
      document.getElementById(`${which}-opt`).innerHTML = `WC3V does not (yet) support this map, sorry. ${missingMapText}`;
    }
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
    // mapInfo.name is set in mapDataSearch() to a key from the bundled
    // `maps[]` whitelist (or undefined if the replay's map isn't shipped).
    // Anything that didn't match the whitelist falls through to a 404
    // — never an arbitrary path. Keep it that way: do NOT use the raw
    // replay-supplied map name for URL construction.
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

  setup3DTerrain () {
    if (!this.threeMapRenderer) return Promise.resolve();
    const { name } = this.mapInfo;
    return this.threeMapRenderer.loadHeights(name).then(heights => {
      const tilesetChar = (this.mapInfo.tileset || 'L')[0];
      // Load baked terrain texture + cliff palette textures in parallel
      return Promise.all([
        this.threeMapRenderer.loadTerrainTexture(name),
        this.threeMapRenderer.loadPaletteTextures(tilesetChar, heights.paletteCodes, heights.cliffPaletteCodes)
      ]).then(([terrainTex]) => {
        this.threeMapRenderer.setupTerrain(heights, terrainTex, this.mapInfo, this.gameScaler);
        if (this.gameScaler && this.gameScaler.setThreeRenderer) {
          this.gameScaler.setThreeRenderer(this.threeMapRenderer);
        }
        // Load real WC3 cliff + tree mesh models (converted MDX → glTF)
        this.threeMapRenderer.setupCliffModels();
        // Load doodad textures before placing models so they render textured
        this.updateLoadingStatus('Loading doodads...');
        return this.threeMapRenderer.loadDoodadTextures(tilesetChar).then(() => {
          if (this.doodadData) {
            this.threeMapRenderer.setupDoodadModels(this.doodadData);
          }
          // Load building model manifest, then place buildings
          // (textures are now embedded in the GLB files)
          this.updateLoadingStatus('Loading buildings...');
          return this.threeMapRenderer.loadBuildingManifests().then(() => {
            const promises = [];
            if (this.neutralBuildings) {
              promises.push(this.threeMapRenderer.setupNeutralBuildingModels(this.neutralBuildings));
            }
            if (this.players) {
              promises.push(this.threeMapRenderer.setupPlayerBuildingModels(this.players));
            }
            return Promise.all(promises).then(() => {
              this._setupBuildingSubsystems();
            });
          });
        });
      });
    }).catch(err => {
      console.warn('3D terrain setup failed:', err);
    });
  }

  _setupBuildingSubsystems () {
    if (!this.threeMapRenderer) return;

    const buildings = this.threeMapRenderer.playerBuildings;

    // Construction progress bars
    if (window.BuildingProgressBar) {
      this.buildingProgressBar = new BuildingProgressBar(this.threeMapRenderer);
      this.buildingProgressBar.setup(buildings, this.unitBalance);
    }

    // Building ground splats
    if (window.BuildingSplats) {
      this.buildingSplats = new BuildingSplats(this.threeMapRenderer);
      this.buildingSplats.setup(buildings, this.neutralBuildings);
    }

    // Building hover tooltip
    if (window.BuildingInfoTooltip && window.BuildingHoverLabel) {
      this.buildingInfoTooltip = new BuildingInfoTooltip();
      this.buildingHoverLabel = new BuildingHoverLabel(this.buildingInfoTooltip, this.canvas);
    }

    // 3D hero path trails (replaces the old 2D ClientUnit.renderPath)
    if (window.PathTrailRenderer3D) {
      this.pathTrailRenderer = new PathTrailRenderer3D(this.threeMapRenderer);
    }
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

    // Manual scrub: collapse split-screen back to action focus so the camera
    // re-evaluates against the new game time instead of staying stuck.
    if (this.broadcastCamera && this.broadcastCamera.mode === CameraMode.SPLIT_SCREEN) {
      this.broadcastCamera.setMode(CameraMode.ACTION_FOCUS);
    }

    this.render();
  }

  ////
  // show / hide loading indicators
  ////
  setLoadingStatus (isLoading, statusText) {
    const loadingIcon = document.getElementById("loading-icon");
    const loadingOverlay = document.getElementById("loading-overlay");
    const loadingStatusEl = document.getElementById("loading-status");
    const matchHeader = document.getElementById("match-header");

    this.emptyGameWrapper.style.display = "none";

    // Use new overlay when available, fall back to old icon
    if (loadingOverlay) {
      if (isLoading) {
        loadingOverlay.classList.add('active');
      } else {
        loadingOverlay.classList.remove('active');
      }
      if (statusText && loadingStatusEl) {
        loadingStatusEl.textContent = statusText;
      }
    }
    loadingIcon.style.display = isLoading ? "block" : "none";

    if (matchHeader) {
      matchHeader.style.display = isLoading ? "none" : "";
    }
  }

  updateLoadingStatus (statusText) {
    const el = document.getElementById("loading-status");
    if (el) el.textContent = statusText;
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

  _setupCameraToolbar () {
    const container = document.getElementById('map-container');
    if (!container) return;
    const bc = this.broadcastCamera;

    const toolbar = document.createElement('div');
    toolbar.id = 'camera-toolbar';
    toolbar.className = 'camera-toolbar';

    toolbar.innerHTML = [
      '<button class="cam-btn cam-btn-active" data-mode="auto">AUTO</button>',
      '<button class="cam-btn" data-mode="split">SPLIT</button>',
      '<button class="cam-btn" data-mode="p1">P1</button>',
      '<button class="cam-btn" data-mode="p2">P2</button>',
      '<button class="cam-btn" data-mode="free">FREE</button>'
    ].join('');
    container.appendChild(toolbar);

    toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-mode]');
      if (btn) this._handleCameraButton(btn.dataset.mode);
    });

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (!this.broadcastCamera) return;
      switch (e.key.toLowerCase()) {
        case 'a': this._handleCameraButton('auto'); break;
        case 's': this._handleCameraButton('split'); break;
        case '1': this._handleCameraButton('p1'); break;
        case '2': this._handleCameraButton('p2'); break;
        case 'f': this._handleCameraButton('free'); break;
      }
    });
  }

  _handleCameraButton (mode) {
    if (!this.broadcastCamera) return;
    switch (mode) {
      case 'auto':  this.broadcastCamera.setMode(CameraMode.ACTION_FOCUS); break;
      case 'split':
        this.broadcastCamera._manualSplit = true;
        this.broadcastCamera.setMode(CameraMode.SPLIT_SCREEN);
        break;
      case 'p1':    this.broadcastCamera.setMode(CameraMode.FOLLOW_HERO, 0); break;
      case 'p2':    this.broadcastCamera.setMode(CameraMode.FOLLOW_HERO, 1); break;
      case 'free':  this.broadcastCamera.setMode(CameraMode.FREE); break;
    }
    // Kick render loop if paused so camera transition is visible
    if (this.state === ScrubStates.paused && mode !== 'free') {
      this.startRenderLoop();
    }
  }

  _updateCameraToolbar (activeMode) {
    // Toolbar button highlight
    const toolbar = document.getElementById('camera-toolbar');
    if (toolbar) {
      const modeMap = {
        action_focus: 'auto',
        split_screen: 'split',
        follow_hero: this.broadcastCamera._followPlayerId === 0 ? 'p1' : 'p2',
        free: 'free'
      };
      const btnMode = modeMap[activeMode] || 'free';
      toolbar.querySelectorAll('.cam-btn').forEach(btn => {
        btn.classList.toggle('cam-btn-active', btn.dataset.mode === btnMode);
      });
    }

    const isSplit = activeMode === 'split_screen';

    // Show/hide "SPLIT VIEW" label near map name
    this._setSplitViewLabel(isSplit);

    // Switch units/production panel to split-view floating cards
    const upPanel = document.getElementById('up-panel');
    if (upPanel) {
      upPanel.classList.toggle('up-split-mode', isSplit);
      if (this.unitsProductionPanel) {
        this.unitsProductionPanel._updateSizing();
        if (isSplit && this.broadcastCamera.splitTargets) {
          this.unitsProductionPanel.setSplitPositions(
            this.broadcastCamera.splitTargets.players);
        } else {
          this.unitsProductionPanel.clearSplitPositions();
        }
      }
    }

    // Player panel camera indicators
    if (this.unitsProductionPanel) {
      if (activeMode === 'action_focus') {
        this.unitsProductionPanel.setCameraHighlight(null, 'auto');
      } else if (activeMode === 'split_screen') {
        this.unitsProductionPanel.setCameraHighlight(null, 'auto');
      } else if (activeMode === 'follow_hero') {
        this.unitsProductionPanel.setCameraHighlight(this.broadcastCamera._followPlayerId, 'follow');
      } else {
        this.unitsProductionPanel.setCameraHighlight(null, null);
      }
    }
  }

  _setSplitViewLabel (show) {
    let label = document.getElementById('split-view-label');
    if (show && !label) {
      label = document.createElement('div');
      label.id = 'split-view-label';
      label.textContent = 'SPLIT VIEW';
      const mapName = document.getElementById('map-name-overlay');
      if (mapName && mapName.parentNode) {
        mapName.parentNode.insertBefore(label, mapName.nextSibling);
      }
    }
    if (label) {
      label.classList.toggle('split-label-visible', show);
    }
  }

  _updateSplitButtonState () {
    if (!this.broadcastCamera) return;
    const splitBtn = document.querySelector('.cam-btn[data-mode="split"]');
    if (!splitBtn) return;
    const isSplit = this.broadcastCamera.mode === CameraMode.SPLIT_SCREEN;
    const tooClose = this.broadcastCamera._heroDistance < 2500 && !isSplit;
    splitBtn.classList.toggle('cam-btn-unavailable', tooClose);
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

    this.placementViewer.show(playerData.baseGrid, playerData.baseSnapshots, player.playerColor, this.neutralBuildings, this.mapImage, this.gameScaler, player.displayName, player.race, this.threeMapRenderer);
  }

  cyclePathTrailStyle () {
    const styles = (window.PathTrailRenderer3D && PathTrailRenderer3D.STYLES) || ['tube'];
    const current = this.viewOptions.pathTrailStyle || 'tube';
    const idx = Math.max(0, styles.indexOf(current));
    const next = styles[(idx + 1) % styles.length];
    this.viewOptions.pathTrailStyle = next;

    // Force a teardown of all hero trail entries so the new style starts clean.
    if (this.pathTrailRenderer) {
      for (const entry of this.pathTrailRenderer._pool.values()) {
        this.pathTrailRenderer._tearDownStyle(entry);
        entry.style = null;
      }
    }

    document.querySelectorAll('.mega-hint[data-option="pathTrailStyle"], #viewer-option-pathTrailStyle')
      .forEach(el => {
        const lbl = el.querySelector('.mega-hint-label');
        const text = `Trail: ${next.charAt(0).toUpperCase() + next.slice(1)}`;
        if (lbl) lbl.textContent = text;
        else el.firstChild && (el.firstChild.nodeValue = text);
      });

    if (this.gameLoaded) this.render();
  }

  toggleViewOption (optionKey) {
    this.viewOptions[optionKey] = !this.viewOptions[optionKey];
    const isOn = this.viewOptions[optionKey];

    // sync all matching toggle elements (toolbar + mega-hint)
    const els = document.querySelectorAll(
      `#viewer-option-${optionKey}, .mega-hint[data-option="${optionKey}"]`
    );
    els.forEach(el => isOn ? el.classList.add('on') : el.classList.remove('on'));

    // Sync auto-split preference to broadcast camera
    if (optionKey === 'autoSplitScreen' && this.broadcastCamera) {
      this.broadcastCamera._autoSplitEnabled = isOn;
      if (!isOn && this.broadcastCamera.mode === CameraMode.SPLIT_SCREEN) {
        this.broadcastCamera.setMode(CameraMode.ACTION_FOCUS);
      }
    }

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

    // Keep render loop alive if broadcast camera needs to animate
    if (!this.broadcastCamera || !this.broadcastCamera.enabled) {
      this.stopRenderLoop();
    }
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
    if (!this.gameLoaded) return;

    this.hideMatchCompleteBanner();

    if (this.state === ScrubStates.playing) {
      this.stopRenderLoop();
    }
    this.state = ScrubStates.stopped;
    this.hasBeenPlayedOnce = false;
    this.lastFrameDelta = 0;
    this.lastFrameTimestamp = 0;

    if (this.gameDisplayBox) this.gameDisplayBox.hide();
    if (this.buildingHoverLabel) this.buildingHoverLabel.hide();

    this.gameTime = 0;
    if (this.scrubber) this.scrubber.moveTracker(0);

    if (this.mapData && this.mapData.world && this.mapData.world.neutralGroups) {
      Object.values(this.mapData.world.neutralGroups).forEach(g => { g.isHidden = false; });
    }
    const neutralPlayer = this.players.find(p => p.playerId === "1042");
    if (neutralPlayer) {
      neutralPlayer.units.forEach(u => { u.isNeutralGroupHidden = false; });
    }

    this.players.forEach(p => p.moveTracker(0));

    if (this.floatingText) this.floatingText.reset();
    if (this.pathTrailRenderer) this.pathTrailRenderer.clear();
    if (this.broadcastCamera) this.broadcastCamera.reset();

    if (this._initialZoomTransform && this.zoomContainer && this.zoom) {
      this.zoomContainer.call(this.zoom.transform, this._initialZoomTransform);
      if (this.scrubber) this.scrubber.updateZoomDisplay(this._initialZoomTransform.k);
    }

    this.toggleMegaPlayButton(true);

    if (this.scrubber) {
      this.scrubber.loadSvg(`#${this.scrubber.wrapperId}-play`, 'play-icon');
    }

    this.render();
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
      this.requestRender();
    }
  }

  setBuildOrderFilter (category, enabled) {
    if (!(category in this.boFilters)) return;
    this.boFilters[category] = !!enabled;
    if (this.gameLoaded && this.layoutMode !== LayoutMode.gameplay) {
      this.boRenderer.renderBuildOrder();
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
      if (this.threeCanvas) {
        this.threeCanvas.style.width = displayWidth + 'px';
        this.threeCanvas.style.height = displayHeight + 'px';
      }

      this.displayScale = scale;

      if (this.minimapPip) this.minimapPip.resize();

      if (this.gameLoaded) {
        this.requestRender();
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

    if (this.broadcastCamera && this.broadcastCamera.mode === CameraMode.SPLIT_SCREEN) {
      this.broadcastCamera.setMode(CameraMode.ACTION_FOCUS);
    }

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

    // initialize the 3D terrain renderer on #three-canvas
    this.threeCanvas = document.getElementById("three-canvas");
    if (this.threeCanvas && window.THREE && window.ThreeMapRenderer) {
      try {
        this.threeMapRenderer = new window.ThreeMapRenderer(this.threeCanvas, this);
      } catch (err) {
        console.warn('ThreeMapRenderer init failed:', err);
        this.threeMapRenderer = null;
      }
    }

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

    // finishes the setup promise — load independent data in parallel
    this.updateLoadingStatus('Loading map data...');
    return Promise.all([
      this.loadMapFile(),
      this.loadMapFile("grid"),
      this.loadDoodadFile(),
      this.loadWalkmap(),
      this.loadNeutralBuildings(),
      this.loadGridFile(),
      this.loadUnitBalance(),
      ...playerLoadedPromiseList
    ])
    .then(() => {
      this.updateLoadingStatus('Building terrain...');
      this.setupDrawing();
      return this.setup3DTerrain();
    })
    .then(() => {
      this.updateLoadingStatus('Preparing UI...');
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

      // Sync camera highlight to current broadcast mode
      if (this.broadcastCamera) {
        this._updateCameraToolbar(this.broadcastCamera.mode);
      }

      // Synchronous initial scale — ensure canvases fit viewport before first paint
      // so the map terrain is visible behind the mega-play overlay
      if (this.layoutMode === LayoutMode.liveBuildOrder && this.gameScaler) {
        const mw = document.getElementById('main-wrapper');
        if (mw) {
          const scale = Math.min(
            mw.clientWidth / this.gameScaler.mapImage.width,
            mw.clientHeight / this.gameScaler.mapImage.height
          );
          const dw = Math.floor(this.gameScaler.mapImage.width * scale) + 'px';
          const dh = Math.floor(this.gameScaler.mapImage.height * scale) + 'px';
          [this.canvas, this.playerCanvas, this.utilityCanvas].forEach(c => {
            c.style.width = dw;
            c.style.height = dh;
          });
          if (this.threeCanvas) {
            this.threeCanvas.style.width = dw;
            this.threeCanvas.style.height = dh;
          }
          this.displayScale = scale;
        }
      }

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
      pathTrailStyle: 'combo',
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
      displayNeutralBuildings: true,
      autoSplitScreen: true
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
        { key: 'pathTrailStyle', label: 'Trail Style', cycle: true },
        { key: 'displayLevelPins', label: 'Level Pins' },
        { key: 'displayFloatingText', label: 'Action Text' },
        { key: 'displayText', label: 'Unit Names' },
        { key: 'decayEffects', label: 'Fade FX' },
        { key: 'displayTreeGrid', label: 'Tree Grid' },
        { key: 'autoSplitScreen', label: 'Split Screen' }
      ];

      settingsModalEl.innerHTML = '';

      buttons.forEach(btn => {
        const el = document.createElement('div');
        el.classList.add('vc-btn');
        if (btn.featured) el.classList.add('vc-featured');
        el.id = `viewer-option-${btn.key}`;

        if (btn.cycle && btn.key === 'pathTrailStyle') {
          const current = this.viewOptions.pathTrailStyle || 'tube';
          el.textContent = `${btn.label}: ${current.charAt(0).toUpperCase() + current.slice(1)}`;
          el.classList.add('on');
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            this.cyclePathTrailStyle();
            const next = this.viewOptions.pathTrailStyle;
            el.textContent = `${btn.label}: ${next.charAt(0).toUpperCase() + next.slice(1)}`;
          });
        } else {
          el.textContent = btn.label;
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleViewOption(btn.key);
          });
          if (this.viewOptions[btn.key]) el.classList.add('on');
        }

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
    // camera transform — updated by CameraController each frame
    // Compute zoom so the playable area (viewExtent) fills the viewport,
    // rather than showing the full map extent with non-playable margins.
    this.gameScaler = new GameScaler();
    this.gameScaler.addDependency('_d3', d3);
    this.gameScaler.setup(this.mapInfo);

    const _gs = this.gameScaler;
    const fullW = _gs.mapExtent.x[1] - _gs.mapExtent.x[0];
    const fullH = Math.abs(_gs.mapExtent.y[1] - _gs.mapExtent.y[0]);
    const viewW = _gs.viewExtent.x[1] - _gs.viewExtent.x[0];
    const viewH = Math.abs(_gs.viewExtent.y[1] - _gs.viewExtent.y[0]);
    // Ratio of full map to playable area × the 1.12 padding factor from ThreeMapRenderer
    const INITIAL_ZOOM = Math.max(1.0, Math.min(6.0,
      Math.min(fullW / viewW, fullH / viewH) * 1.12));
    this.transform = { x: 0.0, y: 0.0, k: INITIAL_ZOOM };

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

    if (self.threeCanvas) {
      self.threeCanvas.width = mapWidth;
      self.threeCanvas.height = mapHeight;
      self.threeCanvas.style.width = mapWidth + "px";
      self.threeCanvas.style.height = mapHeight + "px";
      if (self.threeMapRenderer) self.threeMapRenderer.resize();
    }

    this.gameDisplayBox = new GameDisplayBox(this.teamColorMap, this.assignedPlayerColors);
    this.gameDisplayBox.setData(
      world.neutralGroups, GameDisplayBox.neutralCampHandler(this.gameScaler, this.transform));

    console.log('[CampSetup] gameDisplayBox created, data set, tree items:', this.gameDisplayBox.data.tree.all().length);
    console.log('[CampSetup] transform at setup:', JSON.stringify(this.transform));
    console.log('[CampSetup] canvas element:', this.canvas.id, this.canvas.width, 'x', this.canvas.height);

    this.toggleMegaPlayButton(true);
    this.gameLoaded = true;

    this.zoomContainer = d3.select("#canvas-group");

    const zoomScaleExtent = [1.0, 6.0];

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
        if (this.buildingHoverLabel) this.buildingHoverLabel.hide();
        this.scrubber.updateZoomDisplay(this.transform.k);

        // Don't render directly — coalesce into one RAF to avoid 3-10x
        // renders per frame from zoom + broadcastCamera + mainLoop
        this.requestRender();
      });

    this.zoomContainer
      .call(this.zoom);

    // Apply initial zoom — center the map at INITIAL_ZOOM level.
    // Stash the transform so restart() can return to the same framing.
    let initialT;
    if (INITIAL_ZOOM > 1.0) {
      const ds = this.displayScale || 1;
      const cx = (mapWidth * ds) / 2;
      const cy = (mapHeight * ds) / 2;
      initialT = d3.zoomIdentity.translate(cx, cy).scale(INITIAL_ZOOM).translate(-cx, -cy);
      this.zoomContainer.call(this.zoom.transform, initialT);
    } else {
      initialT = d3.zoomIdentity;
    }
    this._initialZoomTransform = initialT;

    // camp + building hover
    this.zoomContainer.on('mousemove.camphover', () => {
      if (self.state === ScrubStates.stopped) return;

      // Building hover takes priority — if a building is hovered, skip camp hover
      if (self.buildingHoverLabel && self.buildingHoverLabel.handleMouse(d3.event, self.transform)) {
        if (self.gameDisplayBox.hoveredCampUuid) {
          self.gameDisplayBox.hoveredCampUuid = null;
          self.gameDisplayBox.hide();
        }
        return;
      }

      // Fall through to camp hover
      if (self.buildingHoverLabel) self.buildingHoverLabel.hide();
      self.gameDisplayBox.handleMouse(d3.event, self.transform);
    });

    this.scrubber.onZoomChange = (k) => {
      this.zoomContainer.call(this.zoom.scaleTo, k);
    };

    // Broadcast camera — automatic camera modes driven through D3 zoom
    if (window.BroadcastCamera) {
      this.broadcastCamera = new BroadcastCamera(this);
      this.broadcastCamera.attachToZoom(this.zoom, this.zoomContainer);
      this.broadcastCamera._autoSplitEnabled = this.viewOptions.autoSplitScreen;
      this.broadcastCamera.onModeChange = (mode) => {
        this._updateCameraToolbar(mode);
      };
      this._setupCameraToolbar();
    }

    // Minimap pip — camera viewport indicator
    if (window.MinimapPip) {
      this.minimapPip = new MinimapPip(this);
      this.minimapPip.setup();
    }

    // reset zoom on window resize — d3.zoom's internal state becomes stale
    // when canvas dimensions change, causing pan to escape bounds
    const resetZoomOnResize = () => {
      if (!self.gameLoaded) return;
      self.transform = { x: 0, y: 0, k: 1.0 };
      self.zoomContainer.call(self.zoom.transform, d3.zoomIdentity);
      self.scrubber.updateZoomDisplay(1.0);
      // Re-engage broadcast camera after resize
      if (self.broadcastCamera && self.broadcastCamera.enabled) {
        self.broadcastCamera._initialized = false;
      }
      if (self.state !== ScrubStates.stopped) {
        self.requestRender();
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

        // Re-engage broadcast camera after fullscreen resize
        if (self.broadcastCamera && self.broadcastCamera.enabled) {
          self.broadcastCamera._initialized = false;
          self.startRenderLoop();
        }
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

    const w = canvas.width;
    const h = canvas.height;
    playerStatusCtx.setTransform(1, 0, 0, 1, 0, 0);
    playerStatusCtx.clearRect(0, 0, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    playerCtx.setTransform(1, 0, 0, 1, 0, 0);
    playerCtx.clearRect(0, 0, w, h);
    utilityCtx.setTransform(1, 0, 0, 1, 0, 0);
    utilityCtx.clearRect(0, 0, w, h);
  }

  // Coalesced render request — multiple calls per frame collapse into one RAF
  requestRender () {
    if (this._renderPending) return;
    this._renderPending = true;
    requestAnimationFrame(() => {
      this._renderPending = false;
      if (this.gameLoaded) this.render();
    });
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

    // Broadcast camera: drive D3 zoom toward computed target each frame
    if (this.broadcastCamera && this.broadcastCamera.enabled) {
      this.broadcastCamera.update(this.gameTime, this.players);
    }

    // Update SPLIT button availability based on hero distance
    this._updateSplitButtonState();

    this._renderPending = false;  // mainLoop owns the render — cancel any queued requestRender
    this.render();

    if (this.gameTime >= this.matchEndTime) {
      this.stop();
      this.showMatchCompleteBanner();
      return;
    }

    // If paused and camera has settled, stop the loop to save CPU
    if (this.state === ScrubStates.paused &&
        this.broadcastCamera && this.broadcastCamera.settled) {
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

  /**
   * Compute a canvas transform {x, y, k} that centers a world point
   * at the canvas center at the given zoom level.
   * Produces a transform compatible with syncTransform / D3 zoom.
   */
  _worldToTransform (wx, wy, k) {
    const gs = this.gameScaler;
    if (!gs || !gs.xScale) return { x: 0, y: 0, k: 1 };

    // World coord → canvas pixel (unzoomed space)
    const canvasX = gs.xScale(wx) + gs.middleX;
    const canvasY = gs.yScale(wy) + gs.middleY;

    // Canvas center
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;

    return {
      x: cx - k * canvasX,
      y: cy - k * canvasY,
      k
    };
  }

  /**
   * Render in split-screen mode: two diagonal halves, each showing
   * a different player's area at higher zoom.
   *
   * Renders the full pipeline twice — once per camera position. The 3D
   * terrain is rendered to three-canvas normally, then copied to
   * main-canvas (2D) via drawImage within a diagonal clip. Unit overlays
   * on playerCtx/utilityCtx are drawn within their own diagonal clips.
   * three-canvas is hidden so only the composited main-canvas is visible.
   */
  renderSplitScreen () {
    const bc = this.broadcastCamera;
    if (!bc || !bc.splitTargets) return;

    const { left, right } = bc.splitTargets;
    if (!left || !right) { this.render(); return; }

    const {
      ctx,
      players,
      playerCtx,
      playerStatusCtx,
      utilityCtx,
      gameTime,
      matchEndTime,
      viewOptions
    } = this;

    const gs = this.gameScaler;
    const { xScale, yScale } = gs;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // Targets already include the triangle-centroid corner shift and a
    // clamp to gs.viewExtent (computed inside BroadcastCamera) so the
    // visible camera rect stays within the playable area.
    const transformL = this._worldToTransform(left.wx,  left.wy,  left.k);
    const transformR = this._worldToTransform(right.wx, right.wy, right.k);

    // Transition animation: diagonal slides in (entry) or out (exit).
    // splitEntryProgress: 0 = not started, 1 = fully split
    // Smoothstep easing for cinematic feel
    const rawP = bc.splitEntryProgress || 0;
    const eased = rawP * rawP * (3 - 2 * rawP); // smoothstep
    // At eased=0: diagonal is off-screen (no split visible)
    // At eased=1: diagonal is at normal position (full split)
    const offscreen = 1 - eased;
    const diagTopX = cw + cw * offscreen;
    const diagBotX = 0 - cw * offscreen;

    this.clearCanvas();

    // Hide three-canvas — we composite 3D terrain onto main-canvas instead
    if (this.threeCanvas) {
      this.threeCanvas.style.opacity = '0';
    }

    // Hide minimap pip in split mode (cleaner full-bleed split layout)
    if (this.minimapPip && this.minimapPip.container) {
      this.minimapPip.container.style.display = 'none';
    }

    const halves = [
      { target: left,  transform: transformL, side: 'left' },
      { target: right, transform: transformR, side: 'right' }
    ];

    for (const half of halves) {
      const t = half.transform;

      // --- Diagonal clip on all 2D canvases ---
      ctx.save();
      playerCtx.save();
      utilityCtx.save();

      for (const c of [ctx, playerCtx, utilityCtx]) {
        c.beginPath();
        if (half.side === 'left') {
          c.moveTo(0, 0);
          c.lineTo(diagTopX, 0);
          c.lineTo(diagBotX, ch);
          c.lineTo(0, ch);
        } else {
          c.moveTo(diagTopX, 0);
          c.lineTo(cw, 0);
          c.lineTo(cw, ch);
          c.lineTo(diagBotX, ch);
        }
        c.closePath();
        c.clip();
      }

      // --- Swap transform so downstream code uses this half's view ---
      const savedTransform = this.transform;
      this.transform = t;

      // --- 3D terrain: render, then copy to main-canvas within the clip ---
      if (this.threeMapRenderer) {
        this.threeMapRenderer.updatePlayerBuildings(gameTime);
        if (this.buildingProgressBar) this.buildingProgressBar.update(gameTime);
        if (this.buildingSplats) this.buildingSplats.updateVisibility(gameTime);
        if (this.pathTrailRenderer) {
          this.pathTrailRenderer.update(gameTime, this.players, this.viewOptions);
        }

        // Force camera resync and render
        this.threeMapRenderer._lastSyncK = null;
        this.threeMapRenderer._lastSyncX = null;
        this.threeMapRenderer._lastSyncY = null;
        this.threeMapRenderer.render(t);

        // Copy WebGL canvas to 2D main-canvas (respects the diagonal clip)
        ctx.drawImage(this.threeCanvas, 0, 0);
      }

      // --- Frame data ---
      if (!this._frameData) {
        this._frameData = {
          nameplateTree: new rbush(),
          unitDrawPositions: [],
          buildingPositions: [],
          drawnUnits: {},
          gameTime: 0
        };
      }
      const frameData = this._frameData;
      frameData.nameplateTree.clear();
      frameData.unitDrawPositions.length = 0;
      frameData.buildingPositions.length = 0;
      for (const k in frameData.drawnUnits) delete frameData.drawnUnits[k];
      frameData.gameTime = gameTime;

      // --- Map overlays ---
      this.mapRenderer.renderNeutralGroups(utilityCtx, gameTime, t, this.mapData, viewOptions, gs, players, this.teamColorMap, null);
      this.mapRenderer.renderNeutralBuildings(utilityCtx, t, viewOptions, this.neutralBuildings, gs);

      // --- Units: projectXY uses the 3D camera just positioned ---
      players.forEach(player => {
        player.preRender(frameData, ctx, playerCtx, utilityCtx, playerStatusCtx, t, gameTime, xScale, yScale, viewOptions);
      });

      // Skip bloom in split mode
      players.forEach(player => {
        player.resolveUnitPositions(frameData, null, true);
      });

      players.forEach(player => {
        player.render(frameData, ctx, playerCtx, utilityCtx, playerStatusCtx, t, gameTime, xScale, yScale, viewOptions);
      });

      // Nameplates
      if (viewOptions.displayText) {
        frameData.allNameplateBoxes = ClientPlayer.buildNameplateBoxes(frameData, playerCtx);
        ClientPlayer.renderAllNameplates(frameData, playerCtx);
      }

      this.transform = savedTransform;

      ctx.restore();
      playerCtx.restore();
      utilityCtx.restore();
    }

    // --- Diagonal divider ---
    this._drawSplitDivider(playerCtx, cw, ch, diagTopX, diagBotX, bc.splitTargets.players);

    // --- HUD (not split) ---
    if (this.hasBeenPlayedOnce) {
      this.renderGameClock();
    }
    this.scrubber.render(gameTime, matchEndTime);

    if (this.boRenderer) this.boRenderer.updateLiveBoHighlight();
    if (this.unitsProductionPanel) this.unitsProductionPanel.update(gameTime);
  }

  /**
   * Draw the diagonal split divider — glowing line with player name labels.
   */
  _drawSplitDivider (ctx, cw, ch, topX, botX, splitPlayers) {
    ctx.save();

    // Diagonal line angle (for rotating labels to follow the line)
    const angle = Math.atan2(ch, botX - topX);

    // Main divider line — white with glow
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 8;

    ctx.beginPath();
    ctx.moveTo(topX, 0);
    ctx.lineTo(botX, ch);
    ctx.stroke();
    ctx.shadowBlur = 0;

    if (splitPlayers && splitPlayers.length >= 2) {
      const p1Color = splitPlayers[0].teamColor || '#ff0000';
      const p2Color = splitPlayers[1].teamColor || '#0000ff';
      const p1Name = splitPlayers[0].displayName || 'Player 1';
      const p2Name = splitPlayers[1].displayName || 'Player 2';

      // Color accent bars at each end of the diagonal
      ctx.lineWidth = 4;
      ctx.strokeStyle = p2Color;
      ctx.beginPath();
      ctx.moveTo(topX, 0);
      ctx.lineTo(topX - 25, 18);
      ctx.stroke();

      ctx.strokeStyle = p1Color;
      ctx.beginPath();
      ctx.moveTo(botX, ch);
      ctx.lineTo(botX + 25, ch - 18);
      ctx.stroke();

      // Player name labels along the diagonal line.
      // The diagonal goes top-right → bottom-left. We want text to read
      // left-to-right going DOWN the diagonal (bottom-left direction),
      // so rotate by the line angle + π to flip it right-side up.
      const labelAngle = angle + Math.PI;
      const fontSize = Math.max(14, Math.round(cw * 0.028));
      ctx.font = `600 ${fontSize}px Arial, sans-serif`;
      ctx.textBaseline = 'middle';

      const drawLabel = (t, name, color, perpOffset) => {
        const lx = topX + (botX - topX) * t;
        const ly = ch * t;
        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(labelAngle);
        ctx.translate(0, perpOffset);

        // Background pill
        const textW = ctx.measureText(name).width;
        const padX = fontSize * 0.5;
        const padY = fontSize * 0.35;
        const pillW = textW + padX * 2 + 6; // +6 for color bar
        const pillH = fontSize + padY * 2;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.fillRect(-padX, -pillH / 2, pillW, pillH);

        // Color accent bar on left edge
        ctx.fillStyle = color;
        ctx.fillRect(-padX, -pillH / 2, 4, pillH);

        // Player name
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.fillText(name, 2, 1);

        ctx.restore();
      };

      // P1 label — 30% along diagonal, offset into left/top half
      drawLabel(0.30, p1Name, p1Color, -(fontSize * 1.2));
      // P2 label — 70% along diagonal, offset into right/bottom half
      drawLabel(0.70, p2Name, p2Color, fontSize * 1.2);
    }

    ctx.restore();
  }

  render () {
    // No canvas rendering needed in static BO mode
    if (this.layoutMode === LayoutMode.staticBuildOrder) {
      return;
    }

    // Split-screen mode: render two diagonal halves
    if (this.broadcastCamera && this.broadcastCamera.isSplitActive) {
      this.renderSplitScreen();
      return;
    }

    // Restore 3D terrain visibility when exiting split-screen
    if (this.threeCanvas && this.threeCanvas.style.opacity === '0') {
      this.threeCanvas.style.opacity = '1';
    }

    // Restore minimap pip when exiting split-screen
    if (this.minimapPip && this.minimapPip.container &&
        this.minimapPip.container.style.display === 'none') {
      this.minimapPip.container.style.display = '';
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

    // With 3D projection, coords are absolute canvas pixels — no ctx transform.
    // Save/restore preserves any state touched by downstream draw calls.
    ctx.save();
    playerCtx.save();
    utilityCtx.save();

    // 3D terrain renders on #three-canvas underneath the 2D overlays
    if (this.threeMapRenderer) {
      // When CameraController is active, it directly positions the camera
      // each frame — don't pass the d3 transform to syncTransform.
      this.threeMapRenderer.updatePlayerBuildings(gameTime);
      if (this.buildingProgressBar) this.buildingProgressBar.update(gameTime);
      if (this.buildingSplats) this.buildingSplats.updateVisibility(gameTime);
      if (this.pathTrailRenderer) {
        this.pathTrailRenderer.update(gameTime, this.players, this.viewOptions);
      }
      this.threeMapRenderer.render(transform);
    }

    // stored data about each frame — reuse objects to avoid GC pressure
    if (!this._frameData) {
      this._frameData = {
        nameplateTree: new rbush(),
        unitDrawPositions: [],
        buildingPositions: [],
        drawnUnits: {},
        gameTime: 0
      };
    }
    const frameData = this._frameData;
    frameData.nameplateTree.clear();
    frameData.unitDrawPositions.length = 0;
    frameData.buildingPositions.length = 0;
    for (const k in frameData.drawnUnits) delete frameData.drawnUnits[k];
    frameData.gameTime = gameTime;

    this.mapRenderer.renderMapGrid(utilityCtx, transform, viewOptions, this.gameScaler, this.mapInfo, this.gridData, this.canvas);
    // Trees deferred to Phase 2 (3D billboard sprites); flat green circles looked out of place on the 3D terrain.
    // this.mapRenderer.renderMapTrees(utilityCtx, transform, viewOptions, this.doodadData, this.gameScaler, this.mapInfo);
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

    // skip bloom when gameTime hasn't changed (e.g. panning while paused)
    const skipBloom = (gameTime === this._lastResolveGameTime);

    // single-pass resolve: use PREVIOUS frame's engagement state as forceMode
    players.forEach(player => {
      if (!player.isNeutralPlayer) {
        player.resolveUnitPositions(frameData, player._wasEngaged ? 'engaged' : null, skipBloom);
      } else {
        player.resolveUnitPositions(frameData, null, skipBloom);
      }
    });

    // always build allReps (needed by terrain clamp below even when skipBloom)
    const allReps = [];
    players.forEach(player => {
      if (!player.isNeutralPlayer && player._resolved) {
        player._resolved.representatives.forEach(rep => allReps.push(rep));
      }
    });

    if (!skipBloom) {
      // compute engagement for NEXT frame (hysteretic thresholds)
      const armyPlayers = players.filter(p => !p.isNeutralPlayer && p._armyMeta);
      armyPlayers.forEach(p => { p._willEngage = false; });
      for (let i = 0; i < armyPlayers.length; i++) {
        for (let j = i + 1; j < armyPlayers.length; j++) {
          const metaA = armyPlayers[i]._armyMeta;
          const metaB = armyPlayers[j]._armyMeta;
          const dx = metaA.centroidX - metaB.centroidX;
          const dy = metaA.centroidY - metaB.centroidY;
          const distSq = dx * dx + dy * dy;
          // hysteretic: enter engaged < 120px, exit > 180px
          const threshold = (armyPlayers[i]._wasEngaged || armyPlayers[j]._wasEngaged) ? 180 : 120;
          if (distSq < threshold * threshold) {
            armyPlayers[i]._willEngage = true;
            armyPlayers[j]._willEngage = true;
          }
        }
      }
      armyPlayers.forEach(p => { p._wasEngaged = p._willEngage; });

      // cross-player collision — push apart units from different players
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
      const maxFinalDispSq = maxFinalDisp * maxFinalDisp;
      allReps.forEach(u => {
        if (!u._origX) return;
        const dx = u.drawX - u._origX;
        const dy = u.drawY - u._origY;
        const distSq = dx * dx + dy * dy;
        if (distSq > maxFinalDispSq) {
          const scale = maxFinalDisp / Math.sqrt(distSq);
          u.drawX = u._origX + dx * scale;
          u.drawY = u._origY + dy * scale;
        }
      });

      this._lastResolveGameTime = gameTime;
    }

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

    // Rebuild building hover spatial index from this frame's building positions
    if (this.buildingHoverLabel) {
      this.buildingHoverLabel.buildIndex(frameData.buildingPositions);
    }

    if (this.hasBeenPlayedOnce) {
      this.renderGameClock();
    }

    this.scrubber.render(gameTime, matchEndTime);

    if (this.boRenderer) this.boRenderer.updateLiveBoHighlight();

    if (this.unitsProductionPanel) {
      this.unitsProductionPanel.update(gameTime);
    }

    if (this.minimapPip) this.minimapPip.update();
  }


};

window.wc3v = new Wc3vViewer();
