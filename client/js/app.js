const Wc3vViewer = class {
  constructor () {
    this.reset();
    // Subscribe to the site-wide skill-band switch (BandSwitcher.js). Beginner
    // view = band 'new'. The onChange callback fires on same-page mutations
    // (clicks on .skill-band-card anywhere); the storage listener catches
    // cross-tab changes. Both route through _applyBand().
    if (window.BandSwitcher) {
      window.BandSwitcher.onChange((band) => this._applyBand(band));
    }
    window.addEventListener('storage', (e) => {
      if (e.key === 'wc3v.level') this._applyBand(e.newValue);
    });
  }

  // Recompute beginner-view state from the current band, toggle the
  // `is-beginner` chrome class, and re-render the build-order panel if a
  // game is loaded. Called by BandSwitcher.onChange and the cross-tab
  // storage listener.
  _applyBand (band) {
    // Non-1v1 replays are full-detail only — the skill-band switch must not
    // re-enable beginner view here even if the user flips it mid-session.
    const on = (band === 'new') && !this._proFeaturesDisabled;
    if (this.boLearnerMode === on) return;
    this.boLearnerMode = on;
    const app = document.getElementById('app');
    if (app) app.classList.toggle('is-beginner', on);
    if (this.gameLoaded && this.boRenderer && this.layoutMode !== LayoutMode.gameplay) {
      this.boRenderer.renderBuildOrder();
    }
  }

  bootstrap () {
    // True phone sizes only. Tablets (641-1023px) keep the existing
    // tablet-fallback CSS that hides the canvas and shows both players'
    // build orders side-by-side; only at ≤640px do we go all the way to
    // skipping the map/canvas/3D loads and the single-player switcher.
    const mql = window.matchMedia('(max-width: 640px)');
    this.mobileMode = mql.matches;

    // If the user resizes across the breakpoint mid-session, the cleanest
    // way to swap modes is a full reload — initialization paths diverge so
    // far (canvas + 3D init only happen on desktop) that an in-place
    // transition would be much more code for a rare action.
    if (mql.addEventListener) {
      mql.addEventListener('change', () => window.location.reload());
    } else if (mql.addListener) {
      mql.addListener(() => window.location.reload());
    }

    if (this.mobileMode) {
      this.layoutMode = LayoutMode.mobileBuildOrder;
      document.body.classList.add('viewer-mobile-mode');
      const appEl = document.getElementById('app');
      if (appEl) {
        appEl.classList.remove('layout-mode-gameplay', 'layout-mode-static-bo', 'layout-mode-live-bo');
        appEl.classList.add('layout-mode-mobile-bo');
      }
      // The #loading-overlay lives inside #gameplay-area which is
      // display:none in mobile mode — hoist it to body so the loading state
      // remains visible while the replay JSON is fetched.
      const overlay = document.getElementById('loading-overlay');
      if (overlay && overlay.parentNode !== document.body) {
        document.body.appendChild(overlay);
      }
    }

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
    // L5 ACTION INDICATORS — teleport cinematics + future big-event callouts.
    // Topmost canvas (CSS z-index 4). See client/docs/Z_INDEX.md.
    this.actionCanvas = null;
    this.actionCtx = null;

    if (this.unitsProductionPanel) this.unitsProductionPanel.destroy();
    this.unitsProductionPanel = new window.UnitsProductionPanel(this);

    if (this.minimapPip) this.minimapPip.destroy();
    this.minimapPip = null;

    // Unified event pipeline (replaces FloatingText). The model is built once
    // when players load; EventFeed draws the right-edge feed + caster pips.
    this.eventModel = new window.EventModel();
    if (!this.eventFeed) {
      this.eventFeed = new window.EventFeed(this);
      this.eventFeed.setup();
    }
    this.eventFeed.setModel(this.eventModel);
    if (this.placementViewer && typeof this.placementViewer.destroy === 'function') this.placementViewer.destroy();
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
    // "Beginner view" of the build-order panel: a simplified skeleton + plain-
    // language callouts (see BuildOrderRenderer). Driven by the site-wide
    // skill band (BandSwitcher.js) — band === 'new' means beginner view.
    // Live-synced via the BandSwitcher.onChange / 'storage' listeners wired
    // below in this constructor.
    this.boLearnerMode = (window.BandSwitcher && window.BandSwitcher.getBand() === 'new');
    // Guided walkthrough (auto replay coaching — see ReplayGuide.js). When
    // active, a corner HUD steps you through key moments and each step drives
    // the replay camera (zoom to the relevant base / army / unit) — see
    // _guideApplyFocus / _renderGuideHighlights.
    this.guideMode = false;
    this.guide = null;            // { followedName, oppName, intro, steps: [...] }
    this.guideStepIdx = 0;        // -1 = the "what this build is" intro screen
    this.guideFollowedPlayer = null;
    this.guideBuildName = null;   // curated build name (from buildContextBySlot), if known
    this._guideOpenedOnce = false; // once the walkthrough has been opened (or auto-opened) we don't pop it again on re-render
    this._guideHighlight = null;   // { units:[ClientUnit], typeIds, typePlayer, worldPoints, color, fade } — resolved by _renderGuideHighlights into an in-scene 3D glow (unit emissive + ground-glow halos)
    this._guideHighlightStartTime = 0; // performance.now() when the current step's highlight was applied — drives the loud→calm pulse (shared by both renderers)
    this._guidePrevCameraMode = null; // BroadcastCamera mode to restore when the walkthrough exits
    this._guidePlayUntil = null;   // while set, playback auto-parks at this gameTime (the end of the current step's play-out window)
    this._guideSegmentEnd = null;  // the FULL end of the current segment (what "Watch the rest" plays to)
    this._guideParkMode = null;    // what to do when _guidePlayUntil is reached: 'auto' (3-2-1 countdown → next step) | 'stay' (just pause)
    if (this._guideCountdown && this._guideCountdown.timer) clearTimeout(this._guideCountdown.timer);
    this._guideCountdown = null;   // { timer, gen } for the active auto-advance countdown, or null
    this._guideCountdownGen = (this._guideCountdownGen || 0) + 1;   // monotonic id; a tick whose gen != this is stale and bails
    this._guideStepListEls = null; // cached NodeList of the current step's .gh-sl-item rows (the build-sequence list), or null
    this._guideStepListIdx = -2;   // last "active" index applied to the step list (-2 = not applied yet) — so we only touch the DOM on a change
    this._guideCreepTour = null;   // { camps:[{wx,wy,rWorld,startMs,clearMs,label,levelStr,iconId,boundsRect}], idx, summaryShown } — the hero step's camp tour, or null
    this._guidePrevCreepRoute = null; // saved viewOptions.displayCreepRoute so the tour can flip it on for the summary and restore it after
    this._guideCreepStepShownAt = 0; // performance.now() when the current creep-tour camp was first framed — enforces a minimum on-screen time before hopping

    // Beginner view of the build-order panel is opinionated: you pick a player
    // ("Me") and the panel hides the opponent's full BO in favour of a small
    // summary. The pick sticks per replay (sessionStorage) so reloads don't
    // re-ask. Restored / overridden by ?player= in the load .then.
    this.beginnerPickedSlot = null;
    this.boData = new BuildOrderData();
    this.mapRenderer = new MapRenderer();
    this.battleData = new BattleData();         // pure pipeline (BattleDetector output → indexed)
    this.battleRenderer = new BattleRenderer(); // utility-canvas overlay (dashed tracker boxes)
    this.bottomPanel = (window.BottomPanel) ? new window.BottomPanel() : null;
    this.battleReportRenderer = (window.BattleReportRenderer)
      ? new window.BattleReportRenderer(this) : null;
    this.insightsEventLog = (window.InsightsEventLog)
      ? new window.InsightsEventLog(this) : null;
    this.resourceCharts = (window.ResourceCharts)
      ? new window.ResourceCharts(this) : null;
    this.dominanceBar = (window.DominanceBar)
      ? new window.DominanceBar(this) : null;      // tug-of-war widget under the match header (1v1 only)
    this.dominanceChart = (window.DominanceChart)
      ? new window.DominanceChart(this) : null;    // Dominance insights tab (1v1 only)
    this.teleportFx = new TeleportFx();         // teleport cast/arrival cinematic
    this.processedBattles = null;               // populated by setup() once mapData is available
    // Release the prior WebGL context + GPU resources before dropping the
    // reference; setup() builds a fresh renderer on every load and browsers
    // cap live contexts (~16), so a bare null here leaks a context per reload.
    if (this.threeMapRenderer && typeof this.threeMapRenderer.dispose === 'function') {
      try { this.threeMapRenderer.dispose(); } catch (e) { /* never block reset */ }
    }
    this.threeMapRenderer = null; // re-created in setup() once #three-canvas exists
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

    this.loadFile(filename, (buf, fetchErr) => {
      if (fetchErr || !buf) {
        self.showUploadContents("upload-error");
        return;
      }

      // Offload both the UTF-8 decode and the multi-MB JSON.parse to a worker so
      // neither freezes the main thread. The setup() chain (which IS main-thread
      // / DOM) resumes on the worker's 'done' message — a later tick, exactly
      // like the old synchronous-parse-in-XHR-callback path, so scrubber.init()
      // (called synchronously below) still runs first.
      const byteLength = buf.byteLength;
      const fail = (msg) => {
        console.error(`Failed to load replay "${filename}" (response size: ${byteLength} bytes): ${msg}`);
        console.error('If JSON is truncated, re-parse with: node wc3v.js --replay=NAME --debug');
      };

      let worker, timer, done = false;
      const finish = () => {
        done = true;
        clearTimeout(timer);
        if (worker) worker.terminate();
      };

      try {
        worker = new Worker('/js/replay-json-worker.js');
      } catch (e) {
        // Worker unavailable (very old browser / blocked) — fall back to a
        // synchronous decode + parse so the viewer still works.
        try {
          self.replayId = filename;
          self.mapData = JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(buf)));
          self.setup().then(() => { self.setLoadingStatus(false); });
        } catch (e2) {
          fail(e2.message);
        }
        return;
      }

      // Hard timeout mirrors UploadManager's parser-worker guard.
      timer = setTimeout(() => {
        if (done) return;
        finish();
        fail('JSON parse timed out');
      }, 30000);

      worker.onmessage = (ev) => {
        if (done) return;
        const m = ev && ev.data;
        if (!m) return;
        if (m.type === 'done') {
          finish();
          try {
            self.replayId = filename;
            self.mapData = m.result;
            self.setup().then(() => {
              // removing loading status indicator only after full setup completes
              self.setLoadingStatus(false);
            });
          } catch (e) {
            fail(e.message);
          }
        } else if (m.type === 'error') {
          finish();
          fail(m.message);
        }
      };
      worker.onerror = (err) => {
        if (done) return;
        finish();
        fail((err && err.message) || 'worker error');
      };

      // Transfer (not copy) the buffer — ownership moves to the worker.
      worker.postMessage({ type: 'parseBuffer', buffer: buf }, [buf]);
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
      // MyReplays.js (56 KB) is only reachable from this ?local=ID path, so it's
      // fetched here rather than on every viewer load.
      if (!window.MyReplays && typeof window.wc3vLazy === 'function') {
        await window.wc3vLazy('MyReplays');
      }
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

    if (window.WC3V_CONFIG) window.WC3V_CONFIG.log('app', "setting do-not-show cookie");
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

  // Fetch a .wc3v(.gz) as raw bytes. `cb` receives an ArrayBuffer, which the
  // caller hands to replay-json-worker as a transferable — so the multi-MB
  // payload is never materialized as a string on the main thread and is never
  // structured-clone copied. (gzip is decoded transparently by the browser via
  // Content-Encoding, same as with the old XHR.) `cb(null, err)` on failure.
  loadFile (filename, cb) {
    // Use absolute URL for dev (with port), relative for production to avoid mixed-content issues.
    // Dev appends a cache-buster: replays are re-parsed constantly while developing, and the
    // browser otherwise serves a stale .wc3v.gz (e.g. missing newly-added fields like hero
    // footprints) until a hard refresh. Production replays are immutable, so they stay cacheable.
    const url = this.isDev
      ? `http://127.0.0.1:8080/replays/${filename}?t=${Date.now()}`
      : `/replays/${filename}`;

    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then(buf => cb(buf, null))
      .catch(err => cb(null, err));
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
      return new Promise((resolve) => {
        self.gridMapImage = new Image();
        // Resolve (never reject) on error too: a missing/unshipped map image
        // is a documented production case. Without this the Promise.all in
        // setup() never settles and the loading overlay hangs forever. We keep
        // the errored Image object (rather than nulling it) so downstream reads
        // like gameScaler.mapImage.width return 0 instead of throwing.
        self.gridMapImage.addEventListener('load', () => resolve(), false);
        self.gridMapImage.addEventListener('error', () => resolve(), false);
        // src set AFTER the listeners — a cached image can fire load synchronously.
        self.gridMapImage.src = `/maps/${name}/gridmap.jpg`;
      });
    }

    return new Promise((resolve) => {
      self.mapImage = new Image();
      self.mapImage.addEventListener('load', () => resolve(), false);
      self.mapImage.addEventListener('error', () => resolve(), false);
      self.mapImage.src = `/maps/${name}/map.jpg`;
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
      this.threeMapRenderer.setBuildingSplats(this.buildingSplats);
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

    // 3D animated unit models (hybrid: replaces 2D unit icons where a model exists)
    if (window.UnitModelRenderer) {
      this.unitModelRenderer = new UnitModelRenderer(this.threeMapRenderer, this);
    }
  }

  // Walkmaps run ~800 KB on the bigger maps, so the decode+parse goes to the
  // same worker as the replay JSON rather than blocking the main thread during
  // load. Always resolves — a missing/!unparseable walkmap is a soft failure.
  loadWalkmap () {
    const { name } = this.mapInfo;
    const filePath = `../maps/${name}/walkmap.json`;

    return new Promise((resolve) => {
      this.loadFile(filePath, (buf, err) => {
        if (err || !buf) { this._walkmap = null; resolve(true); return; }
        this._parseJsonInWorker(buf)
          .then(obj => { this._walkmap = obj; })
          .catch(() => { this._walkmap = null; })
          .then(() => resolve(true));
      });
    });
  }

  // Decode + JSON.parse an ArrayBuffer off the main thread. The buffer is
  // TRANSFERRED, so the caller must not touch it afterwards. Falls back to a
  // main-thread parse when Workers are unavailable.
  _parseJsonInWorker (buf) {
    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new Worker('/js/replay-json-worker.js');
      } catch (e) {
        try { resolve(JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(buf)))); }
        catch (e2) { reject(e2); }
        return;
      }
      const finish = () => { try { worker.terminate(); } catch (e) {} };
      worker.onmessage = (ev) => {
        const m = ev && ev.data;
        finish();
        if (m && m.type === 'done') resolve(m.result);
        else reject(new Error((m && m.message) || 'parse failed'));
      };
      worker.onerror = (e) => { finish(); reject(e); };
      worker.postMessage({ type: 'parseBuffer', buffer: buf }, [buf]);
    });
  }

  // R2 serves `.json.gz` with `Content-Encoding: gzip`, so the browser
  // auto-decompresses transparently. Local dev servers usually don't set
  // that header, so we sniff the gzip magic and decompress manually as
  // a fallback — keeps `npx http-server client` working.
  async _fetchMapJson (name, file) {
    const buster = this.isDev ? `?t=${Date.now()}` : '';
    const url = `/maps/${encodeURIComponent(name)}/${file}.gz${buster}`;
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const ab = await r.arrayBuffer();
      const bytes = new Uint8Array(ab);
      if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
        if (typeof DecompressionStream !== 'function') return null;
        const stream = new Response(ab).body.pipeThrough(new DecompressionStream('gzip'));
        const text = await new Response(stream).text();
        return JSON.parse(text);
      }
      return JSON.parse(new TextDecoder('utf-8').decode(bytes));
    } catch (e) {
      return null;
    }
  }

  async loadDoodadFile () {
    const { name } = this.mapInfo;
    const jsonData = await this._fetchMapJson(name, 'doo.json');
    if (jsonData) {
      this.doodadData = jsonData.grid;
    } else {
      console.warn(`doodad file not found: /maps/${name}/doo.json(.gz)`);
      this.doodadData = null;
    }
    return true;
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
    if (window.WC3V_CONFIG) window.WC3V_CONFIG.log('map', `[terrain] walkmap loaded: ${!!this._walkmap}, blocked cells: ${blockedCount}, trees: ${this.doodadData ? this.doodadData.length : 0}`);

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

  async loadNeutralBuildings () {
    const { name } = this.mapInfo;
    const data = await this._fetchMapJson(name, 'neutralBuildings.json');
    this.neutralBuildings = data || [];
    return true;
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

    // Re-sync the auto time-scale to the scrubbed-to moment (no stale ramp).
    if (this.scrubber.isAuto && this.autoDirector) {
      this.autoDirector.update(gameTime, 0);
      this.autoDirector.snap();
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

    // Split is no longer a user-selectable mode — AUTO owns it as an automatic
    // sub-state (enters when the 1v1 players are far apart, exits on contact).
    // Non-1v1: per-player (P1/P2) cameras don't generalize past two players —
    // only Auto (fits all action) and Free are offered.
    toolbar.innerHTML = (this.isNonOneVsOne() ? [
      '<button class="cam-btn cam-btn-active" data-mode="auto">AUTO</button>',
      '<button class="cam-btn" data-mode="free">FREE</button>'
    ] : [
      '<button class="cam-btn cam-btn-active" data-mode="auto">AUTO</button>',
      '<button class="cam-btn" data-mode="p1">P1</button>',
      '<button class="cam-btn" data-mode="p2">P2</button>',
      '<button class="cam-btn" data-mode="free">FREE</button>'
    ]).join('');
    // Idempotent: _setupCameraToolbar runs on every load — drop any prior
    // toolbar so only one #camera-toolbar exists (also fixes highlight desync).
    // The toolbar's own click listener is bound to the fresh node, so it's
    // GC'd with the removed element — no leak there.
    const oldToolbar = document.getElementById('camera-toolbar');
    if (oldToolbar) oldToolbar.remove();
    container.appendChild(toolbar);

    toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-mode]');
      if (btn) this._handleCameraButton(btn.dataset.mode);
    });

    // Bind the document-level camera hotkeys exactly once — the handler reads
    // this.broadcastCamera/isNonOneVsOne() live, so a single binding works
    // across reloads. Re-binding per load would stack handlers.
    if (!this._cameraKeysWired) {
      this._cameraKeysWired = true;
      document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (!this.broadcastCamera) return;
        const non1v1 = this.isNonOneVsOne();
        switch (e.key.toLowerCase()) {
          case 'a': this._handleCameraButton('auto'); break;
          case '1': if (!non1v1) this._handleCameraButton('p1'); break;
          case '2': if (!non1v1) this._handleCameraButton('p2'); break;
          case 'f': this._handleCameraButton('free'); break;
        }
      });
    }
  }

  _handleCameraButton (mode) {
    if (!this.broadcastCamera) return;
    // Non-1v1: per-player cameras are unsupported.
    if (this.isNonOneVsOne() && (mode === 'p1' || mode === 'p2')) return;
    switch (mode) {
      case 'auto':  this.broadcastCamera.setMode(CameraMode.ACTION_FOCUS); break;
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
        split_screen: 'auto',  // split is an AUTO sub-state — keep AUTO highlighted
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

  // Per-frame: show a broadcast tag while the AUTO camera is framing a base
  // intrusion (a scout / harass cut), so a deliberate "cut to the base poke"
  // reads as intentional. Hidden whenever we're not framing one.
  _updateIntrusionTag () {
    const bc = this.broadcastCamera;
    const kind = (bc && bc.enabled) ? bc.intrusionKind : null;
    if (kind === this._intrusionTagKind) return;   // no change → no DOM churn
    this._intrusionTagKind = kind;
    this._setIntrusionTag(kind);
  }

  _setIntrusionTag (kind) {
    let tag = document.getElementById('intrusion-tag');
    if (kind && !tag) {
      tag = document.createElement('div');
      tag.id = 'intrusion-tag';
      const mapName = document.getElementById('map-name-overlay');
      if (mapName && mapName.parentNode) {
        mapName.parentNode.insertBefore(tag, mapName.nextSibling);
      } else {
        return;
      }
    }
    if (!tag) return;
    if (kind) {
      tag.textContent = kind === 'harass' ? '⚔ HARASS' : '👁 SCOUTING BASE';
      tag.classList.toggle('intrusion-tag-harass', kind === 'harass');
      tag.classList.toggle('intrusion-tag-scout', kind === 'scout');
    }
    tag.classList.toggle('intrusion-tag-visible', !!kind);
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

    this.placementViewer.show(playerData.baseGrid, playerData.baseSnapshots, player.playerColor, this.neutralBuildings, this.mapImage, this.gameScaler, PlayerNames.canonical(player.displayName), player.race, this.threeMapRenderer);
  }

  toggleViewOption (optionKey) {
    // Creep route detection is permanently off for non-1v1 (mis-credits teams).
    if (optionKey === 'displayCreepRoute' && this.isNonOneVsOne()) return;
    // Auto split view is 1v1-only — the toggle is locked for team games / FFA.
    if (optionKey === 'autoSplitScreen' && this.isNonOneVsOne()) return;
    this.viewOptions[optionKey] = !this.viewOptions[optionKey];
    const isOn = this.viewOptions[optionKey];

    // sync all matching toggle elements (toolbar + mega-hint)
    const els = document.querySelectorAll(
      `#viewer-option-${optionKey}, .mega-hint[data-option="${optionKey}"]`
    );
    els.forEach(el => {
      isOn ? el.classList.add('on') : el.classList.remove('on');
      if (el.tagName === 'BUTTON') el.setAttribute('aria-pressed', isOn ? 'true' : 'false');
    });

    // Action feed (events): hide/show the right-edge DOM feed with the toggle.
    if (optionKey === 'displayFloatingText' && this.eventFeed) {
      this.eventFeed.setEnabled(isOn);
    }

    // Sync auto-split preference to broadcast camera
    if (optionKey === 'autoSplitScreen' && this.broadcastCamera) {
      // Auto-split is permanently off for non-1v1 regardless of the toggle.
      this.broadcastCamera._autoSplitEnabled = isOn && !this.isNonOneVsOne();
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

    // A genuine user Play during the auto-advance countdown means "let me keep
    // watching" — cancel the nudge. (_guideWatchRest cancels before it calls
    // play(), so this only fires on real user input.)
    if (this._guideCountdown) this._cancelGuideAutoAdvance();

    // If the user hits Play after a walkthrough step's auto-play has parked at
    // its window end, let them watch freely (drop the auto-park). EXCEPT a 'stay'
    // park ("Watch the rest"): that's an explicit request to play to segmentEnd
    // and pause there — dropping it would let playback run past, so keep it.
    if (this._guideParkMode !== 'stay' && this._guidePlayUntil != null && this.gameTime >= this._guidePlayUntil - 100) this._guidePlayUntil = null;

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

    if (this.eventFeed) this.eventFeed.reset();
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
    app.classList.remove('layout-mode-gameplay', 'layout-mode-static-bo', 'layout-mode-live-bo', 'layout-mode-mobile-bo');

    // Apply current mode
    app.classList.add(`layout-mode-${this.layoutMode}`);

    // Beginner mode strips the viewer chrome (CSS targets #app.is-beginner).
    app.classList.toggle('is-beginner', !!this.boLearnerMode);

    // Keep old viewMode/buildViewMode in sync for any code still reading them
    this.viewMode = (this.layoutMode === LayoutMode.gameplay) ? ViewModes.gameplay : ViewModes.buildOrder;
    this.buildViewMode = (this.layoutMode === LayoutMode.liveBuildOrder) ? BuildView.live : BuildView.static;

    // Mobile mode: BO-only, no canvas, no playback. Render BO and exit.
    if (this.layoutMode === LayoutMode.mobileBuildOrder) {
      if (this.matchHeader) this.matchHeader.updateLayoutMode(this.layoutMode);
      if (this.gameLoaded && this.boRenderer) this.boRenderer.renderBuildOrder();
      return;
    }

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

  // ── Beginner-view "Me" pick ───────────────────────────────────────────
  // Per-replay sessionStorage key so a refresh keeps the pick but a different
  // replay re-asks.
  _beginnerPickKey () { return `wc3v.beginnerPlayer.${this.replayId || 'default'}`; }

  _getBeginnerPickedPlayer () {
    const slot = this.beginnerPickedSlot;
    if (slot == null) return null;
    const players = (this.buildOrderPlayers || []).filter(p => p && !p.isNeutralPlayer);
    return players.find(p => p.playerId == slot || p.slot == slot) || null;  // eslint-disable-line eqeqeq
  }

  setBeginnerPick (playerOrSlot) {
    let slot = null;
    if (playerOrSlot && typeof playerOrSlot === 'object') {
      slot = (playerOrSlot.playerId != null) ? playerOrSlot.playerId : playerOrSlot.slot;
    } else if (playerOrSlot != null) {
      slot = playerOrSlot;
    }
    this.beginnerPickedSlot = (slot != null) ? String(slot) : null;
    try { sessionStorage.setItem(this._beginnerPickKey(), this.beginnerPickedSlot || ''); } catch (e) {}
    if (this.gameLoaded && this.boRenderer) this.boRenderer.renderBuildOrder();
    // Picking a player no longer auto-opens the walkthrough — the beginner
    // landing overlay's two buttons ("Just Watch" / "Teach Me") are now the
    // explicit choice. (?guide=1 deep links still open it via _maybeAutoEnterGuide.)
  }

  clearBeginnerPick () {
    this.beginnerPickedSlot = null;
    try { sessionStorage.removeItem(this._beginnerPickKey()); } catch (e) {}
    if (this.gameLoaded && this.boRenderer) this.boRenderer.renderBuildOrder();
  }

  // Called from the load .then once the BO panel is set up. Restores any saved
  // pick for this replay; ?player=N overrides (deep links from build cards).
  _loadBeginnerPick () {
    let stored = null;
    try { stored = sessionStorage.getItem(this._beginnerPickKey()); } catch (e) {}
    let pick = stored && stored.trim() ? stored.trim() : null;
    try {
      const u = new URLSearchParams(window.location.search).get('player');
      if (u != null && u !== '') pick = u;
    } catch (e) {}
    this.beginnerPickedSlot = pick;
    if (pick && stored !== pick) { try { sessionStorage.setItem(this._beginnerPickKey(), pick); } catch (e) {} }
  }

  // ── Guided walkthrough ────────────────────────────────────────────────
  // Wires the HUD + player-pick DOM once (called from BuildOrderRenderer
  // ._wireBeginnerHandlers, which runs per replay load — guarded so it's a
  // no-op after the first call).
  setupGuide () {
    if (this._guideWired) return;
    this._guideWired = true;
    const $ = (id) => document.getElementById(id);
    if ($('guide-prev-btn')) $('guide-prev-btn').addEventListener('click', () => this.guidePrev());
    if ($('guide-next-btn')) $('guide-next-btn').addEventListener('click', () => this.guideNext());
    if ($('guide-ac-stay')) $('guide-ac-stay').addEventListener('click', () => this._guideWatchRest());
    if ($('guide-exit-btn')) $('guide-exit-btn').addEventListener('click', () => this.exitGuideMode());
    document.querySelectorAll('#guide-player-pick [data-guide-cancel]').forEach(el =>
      el.addEventListener('click', () => { const m = $('guide-player-pick'); if (m) m.hidden = true; }));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const pick = $('guide-player-pick');
        if (pick && !pick.hidden) { pick.hidden = true; return; }
        if (this.guideMode) this.exitGuideMode();
      }
    });
  }

  // For raw player names: 32-char default + "…" overflow is the right defense.
  _guideEsc (s) { return Security.escapeHtml(Security.sanitizeUserText(s)); }
  // For app-authored copy and generated narrative (TOC subtitles, camp-tour
  // sentences, step-list labels from our own unit table): control-char + bidi
  // scrub, but DO NOT truncate. Truncating to 32 chars chops every TOC subtitle
  // (40-60 chars) mid-word and stamps "…" on it — never do that to our own copy.
  _guideText (s) { return Security.escapeHtml(Security.sanitizeUserText(s, { maxLen: 4096, allowNewlines: true })); }
  _raceLabel (r) { return (typeof RaceLabels !== 'undefined' && RaceLabels[r] && RaceLabels[r].label) || r || ''; }

  // Open the guided walkthrough. `who` may be a ClientPlayer, a playerId, a
  // slot, or be omitted (then we show the "pick a player" gate when there's
  // more than one non-neutral player).
  // Async because ReplayGuide.js (58 KB) + HeroAbilityStats.js (137 KB) are
  // fetched on demand — the walkthrough is user-triggered, so neither sits on
  // the viewer's critical path. HeroAbilityStats must land FIRST: ReplayGuide
  // resolves it via `typeof HeroAbilityStats` at build time, and would silently
  // fall back to an empty table if it loaded second. Every call site is
  // fire-and-forget, so returning a promise changes nothing for them.
  async enterGuideMode (who, opts) {
    if (this._proFeaturesDisabled) return; // 1v1-only feature
    if (typeof window.wc3vLazy === 'function') {
      try {
        await window.wc3vLazy('HeroAbilityStats');
        await window.wc3vLazy('ReplayGuide');
      } catch (e) { return; } // couldn't fetch the guide modules — stay put
    }
    if (typeof ReplayGuide === 'undefined' || !ReplayGuide.buildGuide) return;
    const autoStart = !!(opts && opts.autoStart); // skip the intro/contents page, begin on step 0
    const players = (this.buildOrderPlayers || []).filter(p => p && !p.isNeutralPlayer);
    if (players.length < 2) return; // need two players to compare

    let followed = null;
    if (who && typeof who === 'object') followed = who;
    // `who` may be an id/slot as a string or number — match loosely.
    else if (who != null) followed = players.find(p => p.playerId == who || p.slot == who) || null;  // eslint-disable-line eqeqeq

    if (!followed) {
      // No player picked yet — pop the "whose game?" picker, carrying the
      // autoStart intent so the chosen player also begins the walkthrough.
      if (players.length > 1) { this._showGuidePlayerPick(autoStart); return; }
      followed = players[0];
    }
    const opp = players.find(p => p !== followed);
    if (!opp) return;

    let guide;
    try {
      guide = ReplayGuide.buildGuide(followed, opp, {
        // Battle detector output (mapData.battles, each with a .summary) lets
        // the guide call out the decisive fight. IDs match the battle
        // participants' playerId / summary.perPlayer keys.
        battles: (this.mapData && Array.isArray(this.mapData.battles)) ? this.mapData.battles : null,
        followedId: followed.playerId,
        oppId: opp.playerId
      });
    } catch (e) { return; }
    if (!guide || !guide.steps || !guide.steps.length) return;

    this.guide = guide;
    this.guideFollowedPlayer = followed;
    this.guideStepIdx = -1;       // start on the "what this build is" intro screen
    this.guideMode = true;
    this._guideOpenedOnce = true; // suppresses the auto-open from running again on the same load
    const bc = this.buildContextBySlot && (this.buildContextBySlot[String(followed.playerId)] || this.buildContextBySlot[String(followed.slot)]);
    this.guideBuildName = (bc && bc.name) || null;

    const pick = document.getElementById('guide-player-pick'); if (pick) pick.hidden = true;
    // Need playback + the BO panel both visible. (Mobile stays BO-only — the
    // walkthrough still steps through the rows, just without playback sync.)
    if (!this.mobileMode && this.layoutMode !== LayoutMode.liveBuildOrder) {
      this.layoutMode = LayoutMode.liveBuildOrder;
      this.applyLayoutMode();
    }
    // Pin the camera: the walkthrough drives it per step (zoom to base / army /
    // unit — see _guideApplyFocus). Remember what mode to restore on exit, then
    // freeze playback so the camera + commentary stay put, and keep one render
    // loop alive (mainLoop won't self-stop while guideMode — the highlight
    // rings pulse). Desktop only — the mobile viewer has no canvas.
    if (!this.mobileMode && this.broadcastCamera && typeof CameraMode !== 'undefined') {
      this._guidePrevCameraMode = this.broadcastCamera.mode;
      this.broadcastCamera.setMode(CameraMode.FREE);
    }
    // Clear any building hover that was up — the walkthrough suppresses it.
    if (this.buildingHoverLabel) this.buildingHoverLabel.hide();
    if (!this.mobileMode) this.pause();   // settle playback; each step decides whether to roll the tape (guideGoToStep)
    const hud = document.getElementById('guide-hud'); if (hud) hud.hidden = false;
    // autoStart begins on step 0 (rolls the tape); otherwise park on the
    // intro/contents page (-1) and wait for the user to hit Next.
    this.guideGoToStep(autoStart ? 0 : -1);
    if (this.boRenderer && this.boRenderer.syncWalkthroughCta) this.boRenderer.syncWalkthroughCta();
  }

  // Beginner overlay "Teach Me" button: dismiss the mega-play overlay and open
  // the guided walkthrough. enterGuideMode resolves the slot loosely and falls
  // back to the "whose game?" picker when no player is picked yet.
  startWalkthroughFromOverlay () {
    this.toggleMegaPlayButton(false);
    // autoStart: roll straight into the first step instead of parking on the
    // intro/contents page — the beginner explicitly asked to be taught, so begin
    // the walkthrough. (The contents page is still reachable via Back from step 1.)
    this.enterGuideMode(this.beginnerPickedSlot != null ? this.beginnerPickedSlot : undefined, { autoStart: true });
  }

  exitGuideMode () {
    this.guideMode = false;
    this.guide = null;
    this.guideFollowedPlayer = null;
    this._guideHighlight = null;
    this._clearGuideHighlight3D();         // render() won't call the applier once guideMode is false
    this._cancelGuideAutoAdvance();        // kill any running countdown
    this._guidePlayUntil = null;          // drop the per-step auto-park — watch freely now
    this._guideSegmentEnd = null;
    this._guideParkMode = null;
    this._guideStepListEls = null; this._guideStepListIdx = -2;
    this._guideCreepTour = null;
    // Put the creep-route view option back the way the user had it (the tour's
    // summary turns it on).
    if (this.viewOptions && this._guidePrevCreepRoute != null) this.viewOptions.displayCreepRoute = this._guidePrevCreepRoute;
    if (this.viewOptions) this.viewOptions.suppressCreepRings = false;
    this._guidePrevCreepRoute = null;
    const hud = document.getElementById('guide-hud'); if (hud) hud.hidden = true;
    document.querySelectorAll('#bo-columns .guide-highlight').forEach(el => el.classList.remove('guide-highlight'));
    // Hand the camera back to whatever mode it was in before the walkthrough
    // took over (default: the auto action-focus camera). setMode resets the
    // lerp so it glides to the new framing; restart the render loop so the
    // glide actually animates (it'll self-stop once the camera settles).
    if (!this.mobileMode && this.broadcastCamera && typeof CameraMode !== 'undefined') {
      this.broadcastCamera.setMode(this._guidePrevCameraMode || CameraMode.ACTION_FOCUS);
      this.stopRenderLoop(); this.startRenderLoop();
    }
    if (this.boRenderer && this.boRenderer.syncWalkthroughCta) this.boRenderer.syncWalkthroughCta();
  }

  guideNext () {
    if (!this.guideMode || !this.guide) return;
    if (this.guideStepIdx < 0) { this.guideGoToStep(0); return; }                                 // intro → step 1
    if (this.guideStepIdx >= this.guide.steps.length - 1) { this.exitGuideMode(); return; }        // last step → finish
    this.guideGoToStep(this.guideStepIdx + 1);
  }
  guidePrev () { if (this.guideMode) this.guideGoToStep(this.guideStepIdx - 1); }                  // step 0 → intro; intro stays

  // The step's content has played out (parked at autoAdvanceAt). Show a 3-2-1
  // nudge banner, then advance to the next step. Real-time timer (the replay is
  // paused here) so it ticks regardless of playback. No next step → no nudge.
  _startGuideAutoAdvance () {
    this._cancelGuideAutoAdvance();
    if (!this.guideMode || !this.guide) return;
    if (this.guideStepIdx >= this.guide.steps.length - 1) return;   // last step — nothing to advance to
    const banner = document.getElementById('guide-autocontinue');
    const countEl = document.getElementById('guide-ac-count');
    const stayBtn = document.getElementById('guide-ac-stay');
    // Offer "Watch the rest" only when _guideWatchRest would actually play
    // something (same threshold it uses), so the button never shows as a no-op.
    if (stayBtn) stayBtn.style.display = (this._guideSegmentEnd != null && this._guideSegmentEnd > (this.gameTime || 0) + 50) ? '' : 'none';
    // Generation token: any tick whose captured gen no longer matches the live
    // counter is stale (a newer countdown started, or we were cancelled / reset)
    // and bails immediately — so a queued setTimeout can never crash on a nulled
    // _guideCountdown or advance the wrong step.
    const gen = ++this._guideCountdownGen;
    let n = 3;
    if (banner) banner.hidden = false;
    if (countEl) countEl.textContent = String(n);
    const tick = () => {
      if (gen !== this._guideCountdownGen) return;   // superseded — drop this tick
      n -= 1;
      if (n <= 0) { this._cancelGuideAutoAdvance(); this.guideNext(); return; }
      if (countEl) countEl.textContent = String(n);
      this._guideCountdown = { timer: setTimeout(tick, 1000), gen };
    };
    this._guideCountdown = { timer: setTimeout(tick, 1000), gen };
  }

  _cancelGuideAutoAdvance () {
    if (this._guideCountdown && this._guideCountdown.timer) clearTimeout(this._guideCountdown.timer);
    this._guideCountdown = null;
    this._guideCountdownGen = (this._guideCountdownGen || 0) + 1;   // invalidate any already-queued tick
    const banner = document.getElementById('guide-autocontinue');
    if (banner) banner.hidden = true;
  }

  // "Watch the rest": cancel the auto-advance and play the remainder of the
  // segment, then auto-pause there (stay on this step). If there's nothing left
  // to watch, just cancel (the step stays paused; Next still advances manually).
  _guideWatchRest () {
    this._cancelGuideAutoAdvance();
    const end = this._guideSegmentEnd;
    if (end != null && end > (this.gameTime || 0) + 50) {
      this._guidePlayUntil = end;
      this._guideParkMode = 'stay';
      this.stopRenderLoop();
      this.play();
    }
  }

  guideGoToStep (idx) {
    if (!this.guideMode || !this.guide) return;
    this._cancelGuideAutoAdvance();   // changing steps cancels any running countdown
    // Reset the park state every transition so intro / mobile / creep-tour steps
    // (which don't set it) can never inherit a previous step's stop points.
    this._guidePlayUntil = null;
    this._guideSegmentEnd = null;
    this._guideParkMode = null;
    const steps = this.guide.steps;
    idx = Math.max(-1, Math.min(idx, steps.length - 1));
    this.guideStepIdx = idx;
    if (idx < 0) {                          // the intro screen — pull the camera back to a full-map overview
      this._highlightGuideStep(null);
      if (!this.mobileMode) { this._guidePlayUntil = null; this.pause(); }
      if (!this.mobileMode && this.gameLoaded) this._guideApplyFocus({ kind: 'map', player: 'followed', highlight: null });
      this._renderGuideHud();
      this._scheduleGuideFocusReassert(idx);
      return;
    }
    const step = steps[idx];
    if (!this.mobileMode && this.gameLoaded) {
      // It's a video player — *play out* the sequence rather than freeze on a
      // frame. The play-out window runs from ~1.5s before the action through
      // the step's content (its highlighted events + a 6s tail), capped at
      // ~60s of game time and clamped to the game; mainLoop parks playback at
      // the end (see the _guidePlayUntil check there).
      const evt = [].concat((step.eventTimes && step.eventTimes.followed) || [], (step.eventTimes && step.eventTimes.opp) || []).filter(Number.isFinite);
      const lo = Math.max(0, Math.min(step.gameTimeMs, evt.length ? Math.min(...evt) : step.gameTimeMs) - 1500);
      const lastEvt = evt.length ? Math.max(...evt) : step.gameTimeMs;
      // Two stop points. `autoAdvanceAt` = the content end (just past the last
      // event) — we DON'T sit through the long tail (e.g. all 6 ghouls trickling
      // out); once here the countdown nudges on to the next step. `segmentEnd` =
      // the full tail, what "Watch the rest" plays to before auto-pausing.
      const clamp = (t) => {
        t = Math.min(t, lo + 90000);          // cap a step's auto-play at ~90s of game time (≈30s at 3×)
        if (this.matchEndTime) t = Math.min(t, this.matchEndTime);
        return Math.max(t, lo + 3000);
      };
      const autoAdvanceAt = clamp(evt.length ? (lastEvt + 1500) : (step.gameTimeMs + 8000));
      const segmentEnd = Math.max(autoAdvanceAt, clamp(evt.length ? (lastEvt + 8000) : (step.gameTimeMs + 14000)));
      this.seekToGameTime(lo);                // jump to just before the action (camera untouched — it's FREE / FOLLOW_HERO)
      this._guideApplyFocus(step.focus);      // …frame the relevant base / army / unit (or follow the hero, or set up the creep tour)
      // The creep tour seeks itself to camp 1 and manages its own stop point;
      // every other step parks at the content end and offers the auto-advance.
      this._guidePlayUntil = this._guideCreepTour ? null : autoAdvanceAt;
      this._guideSegmentEnd = this._guideCreepTour ? null : segmentEnd;
      this._guideParkMode = 'auto';
      this.stopRenderLoop();                  // cancel any running loop so play()'s startRenderLoop doesn't double it
      this.play();                            // …and roll the tape
    }
    this._highlightGuideStep(step);
    this._renderGuideHud();
    this._scheduleGuideFocusReassert(idx);
  }

  // The layout and the live-mode canvas can still be settling for a frame or two
  // after the walkthrough opens (the BO panel renders, #gameplay-area resizes,
  // the canvas rescales) — long enough that the camera framing applied above can
  // be computed against stale viewport dimensions and land wrong (the on-and-off
  // "did it zoom in?" race). Re-assert it on the next couple of frames, once
  // those have settled. Bails if the walkthrough has moved on to another step.
  _scheduleGuideFocusReassert (idx) {
    if (this.mobileMode || !this.gameLoaded) return;
    let left = 2;
    const tick = () => {
      if (!this.guideMode || this.guideStepIdx !== idx || this.mobileMode) return;
      this._reapplyGuideFocus();
      if (--left > 0) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  _highlightGuideStep (step) {
    document.querySelectorAll('#bo-columns .guide-highlight').forEach(el => el.classList.remove('guide-highlight'));
    const et = step && step.eventTimes;
    const times = [].concat((et && et.followed) || [], (et && et.opp) || []);
    if (!times.length) return;
    const rows = document.querySelectorAll('#bo-columns [data-gametime]');
    rows.forEach(row => {
      const ms = Number(row.dataset.gametime);
      // Wide-ish window: a step's times can be the build-COMMAND time while the
      // BO row is timed at construction-start (a couple of seconds later).
      if (Number.isFinite(ms) && times.some(t => Math.abs(t - ms) < 2500)) row.classList.add('guide-highlight');
    });
    // Scroll the first highlighted row toward the TOP of the build panel — the
    // walkthrough HUD sits in the bottom-right corner, so the top of the panel
    // is the part that stays clear (block:'center' could tuck a row under it).
    const first = document.querySelector('#bo-columns .guide-highlight');
    if (first && first.scrollIntoView) { try { first.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {} }
  }

  // ── Walkthrough camera / emphasis ─────────────────────────────────────
  // Each step carries a `focus` directive (ReplayGuide.js — a small fixed set:
  // base / hero / army / expansion / compare / map). seekToGameTime has already
  // moved every player to the step's time, so here we resolve the directive to
  // a world-space rect from the players' current unit positions, frame it, and
  // remember which units/buildings to ring (_renderGuideHighlights pulses them
  // each frame). Desktop only — the mobile viewer has no canvas.
  _guideApplyFocus (focus) {
    if (this.mobileMode || !this.gameLoaded || !this.gameScaler || !this.gameScaler.viewExtent || !this.zoom || !this.zoomContainer) {
      this._guideHighlight = null;
      return;
    }
    const f = (focus && typeof focus === 'object' && focus.kind) ? focus : { kind: 'map', player: 'followed', highlight: null };
    // Leaving the creep tour (for another step / the intro): tear it down and
    // put the creep-route view option back the way the user had it.
    if (this._guideCreepTour && f.kind !== 'creepTour') {
      this._guideCreepTour = null;
      if (this.viewOptions && this._guidePrevCreepRoute != null) this.viewOptions.displayCreepRoute = this._guidePrevCreepRoute;
      if (this.viewOptions) this.viewOptions.suppressCreepRings = false;
      this._guidePrevCreepRoute = null;
    }
    const nonNeutral = (this.players || []).filter(p => p && !p.isNeutralPlayer);
    const followed = (this.guideFollowedPlayer && nonNeutral.indexOf(this.guideFollowedPlayer) !== -1) ? this.guideFollowedPlayer : nonNeutral[0];
    const opp  = nonNeutral.find(p => p !== followed) || null;
    const me   = (f.player === 'opp') ? opp : followed;
    const them = (f.player === 'opp') ? followed : opp;
    const gt = this.gameTime || 0;

    // The hero step is a guided creep tour — set it up and bail (it does its
    // own seeking / camera / highlight). Falls back to following the hero.
    if (f.kind === 'creepTour') {
      this._guideHighlight = null;
      if (this._setupGuideCreepTour(me)) return;
      const bc0 = this.broadcastCamera;
      if (bc0 && typeof CameraMode !== 'undefined' && me) {
        const i0 = (this.players || []).indexOf(me);
        if (i0 >= 0) { bc0.setMode(CameraMode.FOLLOW_HERO, i0); return; }
      }
      if (bc0 && typeof CameraMode !== 'undefined' && bc0.mode !== CameraMode.FREE) bc0.setMode(CameraMode.FREE);
      if (me && me.startingPosition) this._guideZoomToRect({ minX: me.startingPosition.x - 1600, maxX: me.startingPosition.x + 1600, minY: me.startingPosition.y - 1600, maxY: me.startingPosition.y + 1600 });
      return;
    }

    const hlIds = [];
    if (Array.isArray(f.highlight)) f.highlight.forEach(id => { if (typeof id === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(id) && hlIds.indexOf(id) === -1) hlIds.push(id); });

    const alive = (u) => !!u && Number.isFinite(u.currentX) && Number.isFinite(u.currentY)
      && ((u.readyTime || u.spawnTime || u.trainedTime || 0) <= gt) && (!u.destroyedAt || u.destroyedAt > gt);
    const isArmy = (u) => alive(u) && !u.isBuilding && !u.isSummon && !u.isIllusion && !(u.meta && (u.meta.hero || u.meta.worker));
    const isBldg = (u) => alive(u) && u.isBuilding;

    const bboxOf = (units) => {
      let n = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const u of units) { n++; if (u.currentX < minX) minX = u.currentX; if (u.currentX > maxX) maxX = u.currentX; if (u.currentY < minY) minY = u.currentY; if (u.currentY > maxY) maxY = u.currentY; }
      return n ? { minX, maxX, minY, maxY } : null;
    };
    const around = (pt, r) => (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) ? { minX: pt.x - r, maxX: pt.x + r, minY: pt.y - r, maxY: pt.y + r } : null;
    // The player's main base, framed TIGHT (the goal is "the base fills the
    // screen", split-screen-ish): a small box around the start location, grown
    // only to cover their close-in base buildings — the ones already standing,
    // plus the ones the build-command log says they'll drop within the step's
    // play-out window (so the opening's altar / crypt / etc. are already in
    // frame at game time 0). Anything past ~2200 units of the start (the
    // expansion, forward towers, far-flung stuff) is left out on purpose.
    const baseRectFor = (p) => {
      if (!p) return null;
      const sp = p.startingPosition;
      const attempts = (Array.isArray(p.buildingAttempts) && p.buildingAttempts.length) ? p.buildingAttempts : null;
      // With a build-command log we can frame TIGHT (a small floor, grown to the
      // close-in buildings the log says they place during this step's play-out
      // window); without one, use a wider floor so the base still reads.
      let r = around(sp, attempts ? 1000 : 1800);
      if (!r) return bboxOf((p.units || []).filter(isBldg));   // no known start location — best effort
      const cutoff = gt + 90000;   // build commands past the play-out window aren't this step's base
      const eat = (x, y) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        if (Number.isFinite(sp.x) && Math.hypot(x - sp.x, y - sp.y) > 2200) return;   // not the tight main base (expansion/forward towers excluded)
        if (x - 140 < r.minX) r.minX = x - 140;
        if (x + 140 > r.maxX) r.maxX = x + 140;
        if (y - 140 < r.minY) r.minY = y - 140;
        if (y + 140 > r.maxY) r.maxY = y + 140;
      };
      for (const u of (p.units || [])) if (isBldg(u)) eat(u.currentX, u.currentY);
      if (attempts) {
        for (const a of attempts) {
          if (a && a.status !== 'cancelled' && a.status !== 'replaced' && (Number(a.gameTime) || 0) <= cutoff) eat(a.x, a.y);
        }
      }
      return r;
    };

    let rect = null;
    const ringUnits = [];          // specific ClientUnit refs to ring (hero / expansion)
    let typePlayer = null;         // player whose units of `hlIds` types we ring (base / army)

    switch (f.kind) {
      case 'hero': {
        const h = (me && me.heroes && me.heroes[0]) ? me.heroes[0] : null;
        rect = (h && alive(h)) ? around({ x: h.currentX, y: h.currentY }, 1100) : (me ? around(me.startingPosition, 1600) : null);
        if (h && alive(h)) ringUnits.push(h);
        break;
      }
      case 'army': {
        rect = (me ? bboxOf((me.units || []).filter(isArmy)) : null) || baseRectFor(me);
        if (hlIds.length) typePlayer = me;
        break;
      }
      case 'expansion': {
        let best = null, bestD = -1;
        if (me) {
          const sp = me.startingPosition || null;
          (me.units || []).forEach(u => {
            if (!isBldg(u)) return;
            if (hlIds.length && hlIds.indexOf(u.itemId) === -1) return;
            const d = sp ? Math.hypot(u.currentX - sp.x, u.currentY - sp.y) : 0;
            if (d > bestD) { bestD = d; best = u; }
          });
        }
        if (best) { rect = around({ x: best.currentX, y: best.currentY }, 1700); ringUnits.push(best); }
        else rect = me ? around(me.startingPosition, 1700) : null;
        break;
      }
      case 'compare': {
        // The level-3 spike step compares hero progressions, not armies — if
        // both heroes are on the field, frame just the two of them (ring them
        // too). Falls through to the army-compare framing when a hero is
        // missing or dead.
        const curStep = (this.guide && this.guide.steps && this.guideStepIdx >= 0) ? this.guide.steps[this.guideStepIdx] : null;
        if (curStep && curStep.key === 'heroSpike') {
          const myHero = (me && me.heroes && me.heroes[0]) ? me.heroes[0] : null;
          const opHero = (them && them.heroes && them.heroes[0]) ? them.heroes[0] : null;
          const myA = (myHero && alive(myHero)) ? myHero : null;
          const opA = (opHero && alive(opHero)) ? opHero : null;
          if (myA || opA) {
            const heroBox = (() => {
              const xs = [], ys = [];
              if (myA) { xs.push(myA.currentX); ys.push(myA.currentY); }
              if (opA) { xs.push(opA.currentX); ys.push(opA.currentY); }
              const pad = 900;
              return { minX: Math.min(...xs) - pad, maxX: Math.max(...xs) + pad, minY: Math.min(...ys) - pad, maxY: Math.max(...ys) + pad };
            })();
            rect = heroBox;
            if (myA) ringUnits.push(myA);
            if (opA) ringUnits.push(opA);
            break;
          }
          // Fall through to the regular compare framing if neither hero is alive.
        }
        const a = (me ? bboxOf((me.units || []).filter(isArmy)) : null) || baseRectFor(me);
        const b = them ? ((bboxOf((them.units || []).filter(isArmy))) || baseRectFor(them)) : null;
        rect = (a && b)
          ? { minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX), minY: Math.min(a.minY, b.minY), maxY: Math.max(a.maxY, b.maxY) }
          : (a || b);
        break;
      }
      case 'base': {
        rect = baseRectFor(me);
        if (hlIds.length) typePlayer = me;
        break;
      }
      case 'map':
      default: {
        const ve = this.gameScaler.viewExtent;
        rect = { minX: Math.min(ve.x[0], ve.x[1]), maxX: Math.max(ve.x[0], ve.x[1]), minY: Math.min(ve.y[0], ve.y[1]), maxY: Math.max(ve.y[0], ve.y[1]) };
        break;
      }
    }

    this._guideHighlight = (ringUnits.length || (typePlayer && hlIds.length))
      ? { units: ringUnits.slice(), typeIds: hlIds.slice(), typePlayer, color: (me && me.playerColor) || '#6fc18a' }
      : null;
    this._guideHighlightStartTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    // For the hero step, hand the camera to BroadcastCamera's FOLLOW_HERO mode
    // so it actually *tracks* the hero as the replay plays the creeping out;
    // every other kind frames a (mostly static) world rect and the broadcast
    // camera stays out of it (FREE).
    const bc = this.broadcastCamera;
    if (f.kind === 'hero' && bc && typeof CameraMode !== 'undefined' && me) {
      const idx = (this.players || []).indexOf(me);
      if (idx >= 0) { bc.setMode(CameraMode.FOLLOW_HERO, idx); return; }
    }
    if (bc && typeof CameraMode !== 'undefined' && bc.mode !== CameraMode.FREE) bc.setMode(CameraMode.FREE);
    if (rect) this._guideZoomToRect(rect);
  }

  // ── Guided creep tour (the "XP race" step) ────────────────────────────
  // Build the camp tour from the parsed map data: the camps `player`'s team
  // cleared with the hero present, in per-team order, up to the one that took
  // the hero to level 3. Seeks to camp 1, frames + rings it, rolls the tape;
  // _advanceGuideCreepTour (called each frame) jumps camp→camp as each clears
  // and parks on a zoom-to-fit summary at the end. Returns false (no data) so
  // the caller can fall back to following the hero.
  _setupGuideCreepTour (player) {
    this._guideCreepTour = null;
    const md = this.mapData;
    const ngObj = md && md.world && md.world.neutralGroups;
    const pid = player && player.playerId;
    const pinfo = (md && md.players && pid != null) ? md.players[String(pid)] : null;
    const teamId = pinfo ? pinfo.teamId : null;
    if (!ngObj || teamId == null) return false;

    // The followed player's first hero + the level it actually reached, from
    // the event stream. The route is evidence-based: CreepRoute only includes
    // camps the HERO genuinely cleared (a dense run of in-camp/creep-pull hero
    // interactions ending at the camp's clearedTime), seeks to that real fight
    // window — NOT the old `windowStart` first-poke, which framed walk-throughs.
    const es = (player && player.eventStream) || [];
    let heroId = null;
    for (const e of es) { if (e && e.key === 'addUnit' && e.unit && e.unit.isHero) { heroId = e.unit.itemId; break; } }
    let reachedLevel = 0;
    for (const e of es) {
      if (e && e.key === 'HeroLevel' && e.unit && (heroId == null || e.unit.itemId === heroId)) {
        const nl = Number(e.newLevel != null ? e.newLevel : e.level) || 0;
        if (nl > reachedLevel) reachedLevel = nl;
      }
    }
    const levelTimeMs = (level) => {
      let best = Infinity;
      for (const e of es) {
        if (e && e.key === 'HeroLevel' && e.unit && (heroId == null || e.unit.itemId === heroId)) {
          const nl = Number(e.newLevel != null ? e.newLevel : e.level) || 0;
          if (nl >= level && e.gameTime < best) best = e.gameTime;
        }
      }
      return best;
    };

    const route = (typeof CreepRoute !== 'undefined')
      ? CreepRoute.buildCreepRoute(ngObj, pid, heroId, { reachedLevel, levelTimeMs })
      : { camps: [], targetLevel: null, reachedLevel };
    if (!route.camps.length) return false;   // hero barely creeped → fall back to following the hero
    // Map to the tour-camp shape. `startMs` is the SEEK anchor — now the real
    // fight start (route.fightStartMs), so the camera lands on the clearing
    // fight instead of an early walk-through.
    const camps = route.camps.map(c => ({
      wx: c.wx, wy: c.wy, rWorld: c.rWorld,
      startMs: c.fightStartMs, clearMs: c.clearMs,
      label: c.label, levelStr: c.levelStr, iconId: c.iconId,
      boundsRect: c.boundsRect
    }));
    // CreepRoute already orders by fight time and caps the count.

    let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity;
    camps.forEach(c => { if (c.wx - c.rWorld < mnX) mnX = c.wx - c.rWorld; if (c.wx + c.rWorld > mxX) mxX = c.wx + c.rWorld; if (c.wy - c.rWorld < mnY) mnY = c.wy - c.rWorld; if (c.wy + c.rWorld > mxY) mxY = c.wy + c.rWorld; });
    this._guideCreepTour = { camps, idx: 0, summaryShown: false, allRect: { minX: mnX, maxX: mxX, minY: mnY, maxY: mxY }, targetLevel: route.targetLevel, reachedLevel };
    if (this.viewOptions && this._guidePrevCreepRoute == null) this._guidePrevCreepRoute = !!this.viewOptions.displayCreepRoute;
    // Hide the per-camp ground rings (both the 3D mesh ring and the 2D track/arc)
    // for the duration of the tour — the gold focus halo marks the active camp.
    if (this.viewOptions) this.viewOptions.suppressCreepRings = true;

    // jump to camp 1, frame + ring it, roll the tape
    const bc = this.broadcastCamera;
    if (bc && typeof CameraMode !== 'undefined' && bc.mode !== CameraMode.FREE) bc.setMode(CameraMode.FREE);
    this._guidePlayUntil = null;   // the tour controller decides when playback stops, not the window mechanism
    const c0 = camps[0];
    this.seekToGameTime(Math.max(0, c0.startMs - 800));   // start just before the hero engages camp 1
    this._guideZoomToRect(c0.boundsRect);
    this._guideHighlight = { worldPoints: [{ wx: c0.wx, wy: c0.wy, rWorld: c0.rWorld }], color: (player && player.playerColor) || '#6fc18a', fade: true };
    const tNow = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    this._guideHighlightStartTime = tNow;
    this._guideCreepStepShownAt = tNow;
    return true;
  }

  // Called every frame in guideMode while a creep tour is active: play each camp
  // out, then freeze on it and hold a minimum on-screen beat before cutting to
  // the next one (no walk shown) / park on the zoom-to-fit summary at the end.
  _advanceGuideCreepTour () {
    const MIN_CAMP_DWELL_MS = 3000;   // keep each camp on screen at least this long (real time) so the hops aren't a blur
    const tour = this._guideCreepTour;
    if (!tour || tour.summaryShown) return;
    const cur = tour.camps[tour.idx];
    if (!cur) return;
    // Still playing this camp out (in game time)? — let it run.
    if (this.gameTime < cur.clearMs + 1500) return;
    // Camp's cleared: freeze on it so we never show the hero walking off, and
    // hold for at least MIN_CAMP_DWELL real seconds — a camp can die in two
    // game-seconds, which at playback speed is a blink. (pause() is safe here:
    // _advanceGuideCreepTour runs inside render()/mainLoop, which re-arms the
    // RAF on its own; calling play()/startRenderLoop() from here would double it,
    // so the un-freeze below just flips state directly.)
    if (this.state !== ScrubStates.paused) this.pause();
    const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (nowMs - (this._guideCreepStepShownAt || 0) < MIN_CAMP_DWELL_MS) return;

    tour.idx++;
    const next = tour.camps[tour.idx];
    if (next) {
      this.seekToGameTime(Math.max(this.gameTime, next.startMs - 600));   // hop forward to the next camp — skip the walk
      this._guideZoomToRect(next.boundsRect);
      this._guideHighlight = { worldPoints: [{ wx: next.wx, wy: next.wy, rWorld: next.rWorld }], color: (this.guideFollowedPlayer && this.guideFollowedPlayer.playerColor) || '#6fc18a', fade: true };
      this._guideHighlightStartTime = nowMs;
      this._guideCreepStepShownAt = nowMs;
      this._updateGuideCreepList(tour.idx);
      // resume playback so the next camp plays out (flip state directly — see note above)
      this.state = ScrubStates.playing;
      if (this.scrubber) this.scrubber.loadSvg(`#${this.scrubber.wrapperId}-play`, 'pause-icon');
    } else {
      // all camps done — the summary: zoom to fit them all + show the route lines
      tour.summaryShown = true;
      this.pause();
      if (this.viewOptions) this.viewOptions.displayCreepRoute = true;
      if (this.viewOptions) this.viewOptions.suppressCreepRings = false;  // reveal the full route (lines + rings) as the payoff
      this._guideHighlight = null;                            // the route badges + lines carry the summary
      this._guideZoomToRect(tour.allRect);
      this._updateGuideCreepList(tour.idx);                   // idx === camps.length → all done, none active
      this._renderGuideHud();                                 // re-render the body to swap in the summary line
    }
  }

  // Toggle the .gh-sl-active / .gh-sl-done classes on the camp list rows for an
  // explicit active index (the creep tour drives this directly rather than from
  // a per-row time, since "all done" isn't expressible as just a timestamp).
  _updateGuideCreepList (activeIdx) {
    const els = this._guideStepListEls;
    if (!els || !els.length) return;
    els.forEach((el, i) => {
      el.classList.toggle('gh-sl-done', i < activeIdx);
      el.classList.toggle('gh-sl-active', i === activeIdx);
    });
  }

  // The camp list shown in the HUD body for the creep-tour step — same .gh-sl-*
  // chrome as the opening's build list, one row per camp (order = the number
  // badge, the camp name, its total level, the time it was cleared).
  _guideCampList (camps) {
    if (!Array.isArray(camps) || !camps.length) return '';
    const fmt = (ms) => (typeof formatGameTime === 'function')
      ? formatGameTime(ms)
      : (() => { const s = Math.max(0, Math.round((Number(ms) || 0) / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); })();
    const items = camps.map((c, idx) => {
      const safeId = (c && typeof c.iconId === 'string' && /^[A-Za-z0-9_\-]{1,32}$/.test(c.iconId)) ? c.iconId : null;
      const ico = safeId
        ? `<img class="gh-sl-icon" src="/assets/wc3icons/${safeId}.jpg" alt="" onerror="this.style.visibility='hidden'" />`
        : `<span class="gh-sl-icon gh-sl-icon-empty" aria-hidden="true"></span>`;
      const lvl = (c && c.levelStr) ? `<span class="gh-sl-x">${this._guideText(c.levelStr)}</span>` : '';
      return `<li class="gh-sl-item gh-sl-creep">`
        + `<span class="gh-sl-n">${idx + 1}</span>`
        + ico
        + `<span class="gh-sl-label">${this._guideText((c && c.label) || 'Camp')}${lvl}</span>`
        + `<span class="gh-sl-time">${this._guideEsc(fmt(c && c.clearMs))}</span>`
        + `</li>`;
    }).join('');
    return `<ol class="gh-steplist gh-steplist-camps">${items}</ol>`;
  }

  // Re-apply the current walkthrough step's camera framing — used after a window
  // resize / fullscreen toggle, which reset the d3 zoom to identity (its
  // internal state goes stale when the canvas changes size). Without this the
  // camera just sits at full-map zoom for the rest of the walkthrough.
  _reapplyGuideFocus () {
    if (!this.guideMode || !this.guide || this.mobileMode) return;
    // Mid-creep-tour: don't rebuild the tour (that would restart it from camp
    // 1) — just re-frame the camp / summary we're on.
    if (this._guideCreepTour) {
      const t = this._guideCreepTour;
      const r = t.summaryShown ? t.allRect : (t.camps[t.idx] && t.camps[t.idx].boundsRect);
      if (r) this._guideZoomToRect(r);
      return;
    }
    if (this.guideStepIdx < 0) { this._guideApplyFocus({ kind: 'map', player: 'followed', highlight: null }); return; }
    const step = this.guide.steps[this.guideStepIdx];
    if (step) this._guideApplyFocus(step.focus);
  }

  // Frame a world-space rect: pad it, clamp to the playable extent, fit it into
  // the viewport at a sane zoom, and drive the d3 zoom there — the same
  // scaleTo + translateTo pair BroadcastCamera.update uses (it's in FREE mode
  // during the walkthrough, so it won't fight back). The walkthrough HUD sits
  // over the build-order panel, not the map, so the framed point is centred.
  // Padding is intentionally tight — this is "look at THIS", not a wide overview.
  _guideZoomToRect (rect) {
    const gs = this.gameScaler;
    if (!gs || !gs.viewExtent || !gs.xScale || !this.zoom || !this.zoomContainer) return;
    let { minX, maxX, minY, maxY } = rect;
    const ex = Math.max(0, maxX - minX), ey = Math.max(0, maxY - minY);
    // Same padding ratios BroadcastCamera uses for its tight cluster framing;
    // the difference is the zoom cap below (9× vs the auto-camera's 4×) — a
    // single base / hero / building should fill the screen, not float in it.
    const padX = Math.max(ex * 0.12, 280);
    const padTop = Math.max(ey * 0.12, 280);   // WC3 +Y = north = top of screen
    const padBot = Math.max(ey * 0.20, 420);   // a touch more south padding for the camera tilt
    minX -= padX; maxX += padX; maxY += padTop; minY -= padBot;
    const vx0 = Math.min(gs.viewExtent.x[0], gs.viewExtent.x[1]), vx1 = Math.max(gs.viewExtent.x[0], gs.viewExtent.x[1]);
    const vy0 = Math.min(gs.viewExtent.y[0], gs.viewExtent.y[1]), vy1 = Math.max(gs.viewExtent.y[0], gs.viewExtent.y[1]);
    minX = Math.max(minX, vx0); maxX = Math.min(maxX, vx1);
    minY = Math.max(minY, vy0); maxY = Math.min(maxY, vy1);
    const focusX = (minX + maxX) / 2, focusY = (minY + maxY) / 2;
    const extentX = Math.max(1, maxX - minX), extentY = Math.max(1, maxY - minY);
    const viewW = Math.max(1, vx1 - vx0), viewH = Math.max(1, vy1 - vy0);
    const k = Math.max(1.0, Math.min(9.0, Math.min(viewW / extentX, viewH / extentY)));
    const ds = this.displayScale || 1;
    const cssPx = (gs.xScale(focusX) + gs.middleX) * ds;
    const cssPy = (gs.yScale(focusY) + gs.middleY) * ds;
    if (!Number.isFinite(cssPx) || !Number.isFinite(cssPy) || !Number.isFinite(k)) return;
    const bc = this.broadcastCamera;
    try {
      if (bc) bc._isProgrammatic = true;
      this.zoomContainer.call(this.zoom.scaleTo, k);
      this.zoomContainer.call(this.zoom.translateTo, cssPx, cssPy);
    } catch (e) { /* d3 not ready — ignore */ }
    if (bc) bc._isProgrammatic = false;
  }

  // "Look HERE" focus for the current walkthrough step — now an IN-SCENE 3D
  // effect, not a 2D overlay. The old screen-space gold ring + spotlight dim was
  // drawn on the top canvas and inevitably covered the very buildings/units (and
  // the nameplates) it was pointing at. Instead we light the actual 3D objects:
  //   • units  → emissive gold pulse on the model + a brightened ground ring
  //               (UnitModelRenderer.setGuideHighlight),
  //   • buildings / creep-camp areas → a soft additive gold ground-glow halo laid
  //               flat on the terrain (ThreeMapRenderer.highlightGroundRings);
  //               the object renders in front of it, so nothing is occluded.
  // This runs every frame in guideMode but only RESOLVES targets when the step's
  // highlight changes (the renderers animate the pulse themselves). Resolution is
  // cheap to keep cheap — the per-building lookup is O(n) over playerBuildings.
  _renderGuideHighlights () {
    const hl = this._guideHighlight;
    const umr = this.unitModelRenderer, tmr = this.threeMapRenderer;
    if (!hl) { this._clearGuideHighlight3D(); return; }

    // Resolve EVERY frame (cheap): a step's targets are dynamic — buildings of
    // the highlighted type finish construction (and units spawn) DURING the
    // step's playback, so they must light up as they appear, not only on a step
    // change. The pulse stays anchored to _guideHighlightStartTime, so re-applying
    // the same targets each frame doesn't restart the loud→calm grab.
    const gt = this.gameTime || 0;
    const COLOR = '#ffce3a';                 // one consistent "look here" gold
    const unitUuids = new Set();
    const ringSpecs = [];
    const buildings = (tmr && tmr.playerBuildings) || [];

    // Light a building's halo from ~the build-command moment. A building's
    // readyTime is constructionStartTime, a couple seconds AFTER the command the
    // step jumps to — so the old `readyTime > gt` gate dropped the building for
    // the whole (paused) step. Gate buildings on readyTime minus a lead window
    // instead; the lower bound still prevents glowing when scrubbed back before
    // the building was placed. Non-buildings keep the strict spawn/train gate.
    const HALO_LEAD_MS = 2000;  // small look-ahead so the flash overlaps the mesh appearing (guide plays at 2x); larger fronts the flash onto bare terrain
    const consider = (u) => {
      if (!u || !Number.isFinite(u.currentX) || !Number.isFinite(u.currentY)) return;
      if (u.destroyedAt && u.destroyedAt <= gt) return;
      if (u.isBuilding) {
        if (((u.readyTime || u.spawnTime || 0) - HALO_LEAD_MS) > gt) return;
        // Buildings are instanced (shared material) → glow a ground halo at the
        // footprint, not the body. Prefer the baked record position; fall back
        // to the unit's live position if no record matches. `key` is stable per
        // building so the halo flashes once (when the building appears) and then
        // fades — see ThreeMapRenderer._updateGuideRings.
        let rec = null;
        for (const b of buildings) { if (b.unit && b.unit.uuid === u.uuid && b.destroyedAt == null) { rec = b; break; } }
        if (rec) ringSpecs.push({ key: u.uuid, wx: rec.wx, wy: rec.wy, itemId: rec.itemId, colorHex: COLOR });
        else ringSpecs.push({ key: u.uuid, wx: u.currentX, wy: u.currentY, itemId: u.itemId, colorHex: COLOR });
      } else {
        if ((u.readyTime || u.spawnTime || u.trainedTime || 0) > gt) return;  // unit not in play yet
        unitUuids.add(u.uuid);
      }
    };

    (hl.units || []).forEach(consider);
    if (hl.typePlayer && hl.typeIds && hl.typeIds.length) {
      const ids = hl.typeIds;
      (hl.typePlayer.units || []).forEach(u => { if (u && ids.indexOf(u.itemId) !== -1) consider(u); });
    }
    // Creep-camp areas have no single mesh — a ground halo scaled to the camp.
    (hl.worldPoints || []).forEach(wp => {
      if (!wp || !Number.isFinite(wp.wx) || !Number.isFinite(wp.wy)) return;
      ringSpecs.push({ key: 'wp' + Math.round(wp.wx) + '_' + Math.round(wp.wy), wx: wp.wx, wy: wp.wy, r: (Number(wp.rWorld) || 300) * 1.25, colorHex: COLOR });
    });

    if (umr) umr.setGuideHighlight(unitUuids, COLOR, this._guideHighlightStartTime);
    if (tmr) tmr.highlightGroundRings(ringSpecs, this._guideHighlightStartTime);
  }

  // Tear down the in-scene guide highlight (units + ground glows). Called when a
  // step has no highlight, and on guide exit (render() stops calling the applier
  // once guideMode is false, so the exit path must clear explicitly).
  _clearGuideHighlight3D () {
    if (this.unitModelRenderer) this.unitModelRenderer.setGuideHighlight(null);
    if (this.threeMapRenderer) this.threeMapRenderer.highlightGroundRings(null);
  }

  // Build the colour-chipped speaker row used for the per-step "action" and
  // "contrast" lines. The chip is a small dot + the player name in their team
  // colour; the text is glossary-linkified plain copy. Returns an HTML string
  // (caller drops it into the body container).
  _guideRow (variant, color, name, text) {
    const linkify = (txt) => (typeof Glossary !== 'undefined' && Glossary.linkifyText) ? Glossary.linkifyText(txt || '') : this._guideEsc(txt || '');
    const safeColor = (typeof color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(color)) ? color : '#888';
    const safeName = this._guideEsc(name || '');
    return `<div class="gh-row gh-row-${variant}">`
      + `<span class="gh-row-chip" style="--gh-chip-color:${safeColor}"><span class="gh-row-dot"></span><span class="gh-row-name">${safeName}</span></span>`
      + `<span class="gh-row-text">${linkify(text)}</span>`
      + `</div>`;
  }

  // The step's "do this, in order" list (e.g. the opening sequence) — rendered
  // big and scannable: a numbered <ol>, each item = number badge + unit/building
  // icon + name (+ "×N" for a run of the same worker) + the game time it
  // landed. This is the focal block of the step. data-guide-time on each row
  // lets _updateGuideStepList check rows off as the replay reaches them.
  _guideStepList (list) {
    if (!Array.isArray(list) || !list.length) return '';
    const fmt = (ms) => (typeof formatGameTime === 'function')
      ? formatGameTime(ms)
      : (() => { const s = Math.max(0, Math.round((Number(ms) || 0) / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); })();
    const items = list.map((it, idx) => {
      const safeId = (it && typeof it.iconId === 'string' && /^[A-Za-z0-9_\-]{1,32}$/.test(it.iconId)) ? it.iconId : null;
      const ico = safeId
        ? `<img class="gh-sl-icon" src="/assets/wc3icons/${safeId}.jpg" alt="" onerror="this.style.visibility='hidden'" />`
        : `<span class="gh-sl-icon gh-sl-icon-empty" aria-hidden="true"></span>`;
      const kind = (it && (it.kind === 'building' || it.kind === 'hero' || it.kind === 'worker')) ? it.kind : 'unit';
      const tMs = Math.max(0, Math.round(Number(it && it.timeMs) || 0));
      const n = (it && it.count > 1) ? `<span class="gh-sl-x">×${it.count}</span>` : '';
      return `<li class="gh-sl-item gh-sl-${kind}" data-guide-time="${tMs}">`
        + `<span class="gh-sl-n">${idx + 1}</span>`
        + ico
        + `<span class="gh-sl-label">${this._guideText((it && it.label) || '')}${n}</span>`
        + `<span class="gh-sl-time">${this._guideEsc(fmt(tMs))}</span>`
        + `</li>`;
    }).join('');
    return `<ol class="gh-steplist">${items}</ol>`;
  }

  // The hero-level-3 "spike" step's focal block: each hero's three skill
  // picks rendered as a row of icons (with overlaid level badges and spell
  // names underneath), then a single "why level 3 is the spike" callout
  // that pulls L1→L2 stats from HeroAbilityStats when available. The two
  // hero rows are stacked full-width (panel is narrow; side-by-side would
  // squeeze the labels). The spike pick gets a gold ring + ★ to read at a
  // glance.
  _guideSpikeBlock (spike) {
    if (!spike || !spike.followed) return '';
    const g = this.guide;
    const fName = (g && g.followedName) || 'Us';
    const oName = (g && g.oppName) || '';
    const fmt = (ms) => (typeof formatGameTime === 'function')
      ? formatGameTime(ms)
      : (() => { const s = Math.max(0, Math.round((Number(ms) || 0) / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); })();
    const raceLabel = (() => {
      const map = { H: 'Human', O: 'Orc', E: 'Night Elf', U: 'Undead' };
      return (r) => map[r] || '';
    })();
    const safeAssetId = (id) => (typeof id === 'string' && /^[A-Za-z0-9_\-]{1,32}$/.test(id)) ? id : null;

    // One hero block — colored header + 3 pick cells.
    const heroBlock = (row, variant, color, playerName, race, deltaTag) => {
      if (!row) return '';
      const safeColor = (typeof color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(color)) ? color : '#888';
      const heroIconId = safeAssetId(row.heroItemId);
      const heroIco = heroIconId
        ? `<img class="gh-spike-hero-icon" src="/assets/wc3icons/${heroIconId}.jpg" alt="" onerror="this.style.visibility='hidden'" />`
        : '';
      const picksHtml = (row.picks || []).map(p => {
        const sid = safeAssetId(p.spellItemId);
        const ico = sid
          ? `<img class="gh-spike-pick-icon" src="/assets/wc3icons/${sid}.jpg" alt="" onerror="this.style.visibility='hidden'" />`
          : `<span class="gh-spike-pick-icon gh-spike-pick-icon-empty" aria-hidden="true"></span>`;
        const lvlBadge = `<span class="gh-spike-pick-level">${p.isSpike ? 'L' + p.level + ' ★' : 'L' + p.level}</span>`;
        const cls = 'gh-spike-pick' + (p.isSpike ? ' gh-spike-pick-spike' : '');
        return `<div class="${cls}">`
          + `<span class="gh-spike-pick-icon-wrap">${ico}${lvlBadge}</span>`
          + `<span class="gh-spike-pick-name">${this._guideText(p.displayName || '')}</span>`
          + `</div>`;
      }).join('');
      const raceTag = race ? `<span class="gh-spike-hero-race">${this._guideEsc(race)}</span>` : '';
      const lvlTag = `<span class="gh-spike-hero-lvl">Lv ${row.level}</span>`;
      const atTag = row.levelAtMs != null
        ? `<span class="gh-spike-hero-at">${this._guideEsc(fmt(row.levelAtMs))}</span>`
        : '';
      const dTag = deltaTag ? `<span class="gh-spike-time-delta">${this._guideEsc(deltaTag)}</span>` : '';
      return `<div class="gh-spike-hero gh-spike-hero-${variant}" style="--gh-chip-color:${safeColor}">`
        + `<div class="gh-spike-hero-head">`
        +   `<span class="gh-row-dot"></span>`
        +   heroIco
        +   `<span class="gh-spike-hero-name">${this._guideEsc(playerName)}</span>`
        +   `<span class="gh-spike-hero-sep">·</span>`
        +   `<span class="gh-spike-hero-label">${this._guideText(row.heroName || '')}</span>`
        +   raceTag
        +   lvlTag
        +   atTag
        +   dTag
        + `</div>`
        + `<div class="gh-spike-picks">${picksHtml}</div>`
        + `</div>`;
    };

    // Time-delta annotation on the opp row when both reached L3.
    let oppDelta = '';
    if (spike.opp && spike.opp.levelAtMs != null && spike.followed.levelAtMs != null && spike.opp.level === 3) {
      const d = Math.round((spike.opp.levelAtMs - spike.followed.levelAtMs) / 1000);
      if (Math.abs(d) <= 30) oppDelta = '— wash';
      else if (d > 0) oppDelta = `+${d}s later`;
      else oppDelta = `${d}s earlier`;
    }

    const followedRace = (g && g.followedRace) || '';
    const oppRace = (g && g.oppRace) || '';
    const fBlock = heroBlock(spike.followed, 'followed', g && g.followedColor, fName, raceLabel(followedRace), '');
    const oBlock = spike.opp ? heroBlock(spike.opp, 'opp', g && g.oppColor, oName, raceLabel(oppRace), oppDelta) : '';

    // Explainer: stat table if we have one, otherwise generic copy. Falls back
    // gracefully when the followed player didn't double up (no doubledSpellId).
    const linkify = (txt) => (typeof Glossary !== 'undefined' && Glossary.linkifyText) ? Glossary.linkifyText(txt || '') : this._guideEsc(txt || '');
    const ruleCopy = "You can't put two skill points in the same skill back-to-back, so levels 1 and 2 force one point each into separate basics. Level 3 is the first chance to double up — and that second point in a basic skill is usually a bigger jump than the level itself.";

    // Build the table rows dynamically from the strict per-level data
    // (HeroAbilityStats is regenerated from CASC by tools/parse-ability-data.js).
    // Each row is included only if it actually changes between L1 and L2 —
    // we don't show "Cost: 75 → 75 (same)" rows because they're noise.
    const buildRows = (stats) => {
      if (!stats) return [];
      const rows = [];
      const push = (label, l1, l2, fmtVal, fmtDelta) => {
        if (l1 == null || l2 == null) return;
        if (l1 === l2) return;          // unchanged stat: skip (rule: only show what differs)
        const dn = (typeof fmtDelta === 'function') ? fmtDelta(l1, l2) : '';
        rows.push({ label, l1: fmtVal(l1), l2: fmtVal(l2), delta: dn });
      };
      const pct = (a, b) => {
        if (a === 0) return b > 0 ? '' : '';
        const p = Math.round(((b - a) / a) * 100);
        return (p > 0 ? '+' : '') + p + '%';
      };
      const sec = (v) => v + 's';
      const flat = (v) => String(v);
      // Compare level 1 → level 2 from the strict arrays.
      const get = (arr, i) => Array.isArray(arr) ? arr[i] : null;
      push('Mana cost',     get(stats.manaCost, 0),    get(stats.manaCost, 1),    flat, pct);
      push('Cooldown',      get(stats.cooldown, 0),    get(stats.cooldown, 1),    sec,  pct);
      push('Duration',      get(stats.duration, 0),    get(stats.duration, 1),    sec,  pct);
      push('Hero duration', get(stats.durationHero, 0),get(stats.durationHero, 1),sec,  pct);
      push('Area',          get(stats.area, 0),        get(stats.area, 1),        flat, pct);
      push('Cast range',    get(stats.castRange, 0),   get(stats.castRange, 1),   flat, pct);
      // Per-spell Data fields (from AbilityMetaData.slk, labelled by the
      // INTERNAL_ID_LABELS hand-map in the parse tool). Only included if
      // L1 and L2 differ — flat fields would just be noise.
      if (stats.data && stats.dataMeta) {
        const fmtByCode = {
          pct:  (v) => Math.round(v * 100) + '%',     // 0.10 → "10%"
          sec:  (v) => v + 's',
          mult: (v) => v + 'x',
          pps:  (v) => v + '/s',
          flat: (v) => String(v)
        };
        const pctDelta = (a, b) => {
          if (a === 0 || a == null || b == null) return '';
          const p = Math.round(((b - a) / a) * 100);
          return (p > 0 ? '+' : '') + p + '%';
        };
        const ppDelta = (a, b) => {   // pp delta for percent-encoded fields
          if (a == null || b == null) return '';
          const d = Math.round((b - a) * 100);
          return (d > 0 ? '+' : '') + d + 'pp';
        };
        for (const letter of Object.keys(stats.dataMeta)) {
          const meta = stats.dataMeta[letter];
          const arr = stats.data[letter];
          if (!meta || !meta.label || !Array.isArray(arr)) continue;
          const l1 = arr[0], l2 = arr[1];
          if (l1 == null || l2 == null || l1 === l2) continue;
          const fmt = fmtByCode[meta.format] || fmtByCode.flat;
          const delta = meta.format === 'pct' ? ppDelta(l1, l2) : pctDelta(l1, l2);
          rows.push({ label: meta.label, l1: fmt(l1), l2: fmt(l2), delta });
        }
      }
      // Ubertip-derived effect numbers (only present if the locale namespace
      // ever lands in tools/ability-data/). Tooltip order per level, paired
      // index-by-index. Skipped today; harmless when absent.
      const uberL1 = (stats.ubertipNumbers && stats.ubertipNumbers[0]) || null;
      const uberL2 = (stats.ubertipNumbers && stats.ubertipNumbers[1]) || null;
      if (uberL1 && uberL2 && uberL1.length === uberL2.length) {
        for (let i = 0; i < uberL1.length; i++) {
          push('Effect ' + (i + 1), uberL1[i], uberL2[i], flat, pct);
        }
      }
      return rows;
    };

    // For summon spells, the interesting per-level scaling is the SUMMONED
    // UNIT's stats (HP, dmg, abilities), not the spell-level fields. Render
    // an extra mini-table comparing L1 → L2 summoned unit stats when the
    // tool extracted them.
    const buildSummonRows = (stats) => {
      if (!stats || !Array.isArray(stats.summons) || stats.summons.length < 2) return [];
      const a = stats.summons[0], b = stats.summons[1];
      if (!a || !b) return [];
      const rows = [];
      const pct = (x, y) => {
        if (x === 0 || x == null || y == null) return '';
        const p = Math.round(((y - x) / x) * 100);
        return (p > 0 ? '+' : '') + p + '%';
      };
      const push = (label, l1, l2, fmt) => {
        if (l1 == null || l2 == null || l1 === l2) return;
        rows.push({ label, l1: fmt(l1), l2: fmt(l2), delta: pct(l1, l2) });
      };
      push('HP',         a.hp,        b.hp,        String);
      push('Damage avg', a.damageAvg, b.damageAvg, String);
      push('Armor',      a.armor,     b.armor,     String);
      push('Speed',      a.speed,     b.speed,     String);
      // Ability deltas: which abilities the L2 unit gained over the L1 unit.
      // (e.g. Spirit Wolves: L2 gains ACct = Critical Strike; L3 gains Apiv =
      // Permanent Invisibility — verified from unitabilities.slk.)
      const aAbs = new Set(a.abilities || []);
      const bAbs = (b.abilities || []).filter(x => !aAbs.has(x));
      if (bAbs.length) {
        const map = {
          'ACct': 'Critical Strike',
          'Apiv': 'Permanent Invisibility',
          'Aroc': 'Resistant Skin',
          'Aroa': 'Roar',
          'Aetf': 'Entangle',
          // Add more known creep ability IDs as needed; unknown ones fall
          // through as their raw ID.
        };
        const named = bAbs.map(id => map[id] || id).join(', ');
        rows.push({ label: 'Gains', l1: '—', l2: named, delta: 'unlock' });
      }
      return rows;
    };

    let tableHtml = '';
    let contextHtml = '';
    const derivedRows = buildRows(spike.stats).concat(buildSummonRows(spike.stats));
    if (spike.stats && derivedRows.length) {
      const rowsHtml = derivedRows.map(r => `<div class="gh-spike-stat-row">`
        + `<span class="gh-spike-stat-label">${this._guideText(r.label)}</span>`
        + `<span class="gh-spike-stat-l1">${this._guideText(r.l1)}</span>`
        + `<span class="gh-spike-stat-arrow" aria-hidden="true">→</span>`
        + `<span class="gh-spike-stat-l2">${this._guideText(r.l2)}</span>`
        + `<span class="gh-spike-stat-delta">${this._guideText(r.delta)}</span>`
        + `</div>`).join('');
      const spellName = this._guideText(spike.stats.name || '');
      tableHtml = `<div class="gh-spike-table">`
        + `<div class="gh-spike-table-head">${this._guideEsc(fName)} doubled <strong>${spellName}</strong></div>`
        + rowsHtml
        + `</div>`;
    } else if (spike.doubledSpellId) {
      // We know they doubled up but the spell isn't in our stats table.
      const doubledName = (spike.followed.picks.find(p => p.spellItemId === spike.doubledSpellId) || {}).displayName || 'their main skill';
      tableHtml = `<div class="gh-spike-fallback">${this._guideEsc(fName)} doubled <strong>${this._guideText(doubledName)}</strong> — the L2 of any basic skill is the real cost-per-effect jump, usually bigger than the third skill being unlocked at L1 would have been.</div>`;
    } else {
      // No double-up. Acknowledge the choice rather than implying it was wrong.
      tableHtml = `<div class="gh-spike-fallback">${this._guideEsc(fName)} skipped the level-3 double-up and put one point on each basic. That trades the L2 jump on the strongest skill for having a third skill available at L1 — sometimes the right call against a specific matchup, but the L2 of the strongest spell is usually the bigger return.</div>`;
    }

    // Opp "passed on the spike" note when only one side doubled up.
    let oppNote = '';
    if (spike.doubledSpellId && spike.opp && spike.opp.level === 3 && !spike.oppDoubledSpellId) {
      oppNote = `<p class="gh-spike-context">${this._guideEsc(oName)} spread points across three skills instead of doubling — passed on the spike.</p>`;
    } else if (!spike.doubledSpellId && spike.opp && spike.oppDoubledSpellId) {
      const oppName = (spike.opp.picks.find(p => p.spellItemId === spike.oppDoubledSpellId) || {}).displayName || '';
      oppNote = `<p class="gh-spike-context">${this._guideEsc(oName)} took the double-up on <strong>${this._guideText(oppName)}</strong> — the spike we passed on.</p>`;
    }

    const explainHtml = `<div class="gh-spike-explain">`
      + `<span class="gh-spike-explain-label">Why level 3 is the spike</span>`
      + `<p class="gh-spike-rule">${linkify(ruleCopy)}</p>`
      + tableHtml
      + contextHtml
      + oppNote
      + `</div>`;

    return fBlock + oBlock + explainHtml;
  }

  // Walk the build-sequence list (the .gh-sl-item rows in #guide-hud-body) as
  // the replay plays. This is a follow-along guide, so "active" is the NEXT
  // move to make — the first row whose command time the playhead hasn't reached
  // yet (highlight box). Every row before it has already been issued and shows
  // "done" (a slow grey/✓ fade — see the CSS transitions). Highlighting the
  // last *passed* row instead lagged a step behind the map ring: by the time a
  // building appears it's already going down, so the genuinely-next move is the
  // useful highlight. Cheap — caches the rows and only touches the DOM when the
  // active index changes.
  _updateGuideStepList (gameTime) {
    const els = this._guideStepListEls;
    if (!els || !els.length) return;
    const gt = Number(gameTime) || 0;
    let activeIdx = els.length;   // past the end → whole sequence done, none active
    for (let i = 0; i < els.length; i++) {
      if ((Number(els[i].dataset.guideTime) || 0) > gt) { activeIdx = i; break; }
    }
    if (activeIdx === this._guideStepListIdx) return;
    this._guideStepListIdx = activeIdx;
    els.forEach((el, i) => {
      el.classList.toggle('gh-sl-done', i < activeIdx);
      el.classList.toggle('gh-sl-active', i === activeIdx);
    });
  }

  // The walkthrough HUD is a *designed step card*, not a paragraph blob:
  //   eyebrow → big game-time + "step n/total" → step title with optional icon
  //   → structured body (us-row, opp-row, why-callout, takeaway-block)
  //   → back/dots/next
  // The intro screen uses the same chrome but drops the rows in favour of a
  // single .gh-intro block (synthesized "what this build is" copy). All
  // replay-derived strings go through linkify (escape + glossary wrap).
  _renderGuideHud () {
    if (!this.guideMode || !this.guide) return;
    const g = this.guide, n = g.steps.length, i = this.guideStepIdx;
    const linkify = (txt) => (typeof Glossary !== 'undefined' && Glossary.linkifyText) ? Glossary.linkifyText(txt || '') : this._guideEsc(txt || '');

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const eyebrow = document.getElementById('guide-hud-eyebrow');
    const body = document.getElementById('guide-hud-body');
    const titleText = document.getElementById('guide-hud-step-title-text');
    const iconImg = document.getElementById('guide-hud-step-icon');
    const dots = document.getElementById('guide-hud-dots');
    const prev = document.getElementById('guide-prev-btn');
    const next = document.getElementById('guide-next-btn');

    // Eyebrow uses colored dots so the "me vs opp" framing is visible at a
    // glance — same chip vocabulary as the per-step speaker rows below.
    if (eyebrow) {
      const fc = (typeof g.followedColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(g.followedColor)) ? g.followedColor : '#6fc18a';
      const oc = (typeof g.oppColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(g.oppColor)) ? g.oppColor : '#9ca3b8';
      eyebrow.innerHTML = `<span class="gh-eyebrow-label">Walkthrough</span>`
        + `<span class="gh-eyebrow-vs"><span class="gh-eyebrow-dot" style="background:${fc}"></span>${this._guideEsc(g.followedName)}</span>`
        + `<span class="gh-eyebrow-sep">vs</span>`
        + `<span class="gh-eyebrow-vs"><span class="gh-eyebrow-dot" style="background:${oc}"></span>${this._guideEsc(g.oppName)}</span>`;
    }

    // ── Intro screen: the build name + a one-line "what it is" + a contents
    //    list of the steps (so the first screen advertises what the walkthrough
    //    actually covers), then a quiet "how it works" footnote. ──
    if (i < 0) {
      set('guide-hud-time', '');
      set('guide-hud-progress', `Intro · ${n} step${n === 1 ? '' : 's'}`);
      if (titleText) titleText.textContent = this.guideBuildName || g.buildTitle || 'Walkthrough';
      if (iconImg) { iconImg.hidden = true; iconImg.removeAttribute('src'); }
      if (body) {
        // One line per step-type: what that step shows you.
        const TOPIC = {
          opening:      'the first build moves, in the order to do them',
          hero:         'which creep camps level the hero, and the order to take them',
          heroSpike:    'the level 3 skill spike, and the stat jump from doubling up',
          tier2:        'when to start Tier 2, and how the timing compared',
          tier3:        'Tier 3, and whether going for it that early paid off',
          expansion:    'taking a second base, and how to play safe around it',
          oppExpansion: 'what to do when the opponent expands first',
          upgrade:      'the weapon or armor upgrade that is easy to forget',
          counter:      'the unit that hard-counters a caster-heavy army',
          siege:        'siege units, and keeping them alive while they work',
          midgame:      'a supply check on where the two armies stand',
          final:        'the final army composition, and the one thing to take away'
        };
        const seenKeys = new Set();
        const tocRows = g.steps
          .filter(s => { if (seenKeys.has(s.key)) return false; seenKeys.add(s.key); return true; })
          .map((s, idx) => {
            const safeId = (typeof s.iconId === 'string' && /^[A-Za-z0-9_\-]{1,32}$/.test(s.iconId)) ? s.iconId : null;
            const ico = safeId
              ? `<img class="gh-toc-icon" src="/assets/wc3icons/${safeId}.jpg" alt="" onerror="this.classList.add('gh-toc-icon-empty');this.removeAttribute('src')" />`
              : `<span class="gh-toc-icon gh-toc-icon-empty" aria-hidden="true"></span>`;
            // TOC titles + subtitles are our own copy (the title from ReplayGuide.js's
            // hardcoded step.title, the sub from the TOPIC table just above) — use the
            // non-truncating escaper so they aren't chopped at 32 chars with a "…".
            const sub = TOPIC[s.key] ? `<span class="gh-toc-sub">${this._guideText(TOPIC[s.key])}</span>` : '';
            return `<li class="gh-toc-item"><span class="gh-toc-n">${idx + 1}</span>${ico}`
              + `<span class="gh-toc-text"><span class="gh-toc-title">${this._guideText(s.title || '')}</span>${sub}</span></li>`;
          }).join('');
        body.innerHTML = `<div class="gh-intro">${linkify(g.intro || '')}</div>`
          + `<div class="gh-toc"><span class="gh-toc-label">Walkthrough Step by Step</span><ol class="gh-toc-list">${tocRows}</ol></div>`
          + `<p class="gh-howto">Hit <strong>Next</strong> to begin. Each step jumps the replay to that moment and highlights the matching rows in the build order panel. You can exit and watch on your own at any time.</p>`;
      }
      this._guideStepListEls = null; this._guideStepListIdx = -2;
      if (dots) dots.innerHTML = '<span class="gh-dot gh-dot-active"></span>' + g.steps.map(() => '<span class="gh-dot"></span>').join('');
      if (prev) prev.disabled = true;
      if (next) next.textContent = 'Start the walkthrough →';
      return;
    }

    // ── Per-step screen ──
    const step = g.steps[i];
    set('guide-hud-time', (typeof formatGameTime === 'function') ? formatGameTime(step.gameTimeMs) : '');
    set('guide-hud-progress', `Step ${i + 1} of ${n}`);
    if (titleText) titleText.textContent = step.title || '';

    // Icon is optional. Whitelist the asset path so a stray itemId can't
    // smuggle anything past the static /assets/wc3icons/ namespace. If the
    // file 404s we just hide the <img> (no broken-image glyph).
    if (iconImg) {
      const safeId = (typeof step.iconId === 'string' && /^[A-Za-z0-9_\-]{1,32}$/.test(step.iconId)) ? step.iconId : null;
      if (safeId) {
        iconImg.hidden = false;
        iconImg.onerror = () => { iconImg.hidden = true; iconImg.onerror = null; };
        iconImg.src = `/assets/wc3icons/${safeId}.jpg`;
      } else {
        iconImg.hidden = true;
        iconImg.removeAttribute('src');
      }
    }

    const isCreepTour = !!(step.focus && step.focus.kind === 'creepTour' && this._guideCreepTour);
    const isSpike = step.key === 'heroSpike' && step.spike;
    if (body) {
      const parts = [];
      if (isSpike) {
        // The spike step has its own focal layout (per-hero pick rows + the
        // L1→L2 stat callout). The framing sentence is shown as a plain
        // caption above the block, not a speaker row — the "speaker" here is
        // the coach narrating both sides, not the followed player.
        if (step.action) {
          const linkify = (txt) => (typeof Glossary !== 'undefined' && Glossary.linkifyText) ? Glossary.linkifyText(txt || '') : this._guideEsc(txt || '');
          parts.push(`<p class="gh-spike-caption">${linkify(step.action)}</p>`);
        }
        parts.push(this._guideSpikeBlock(step.spike));
        body.innerHTML = parts.join('');
        this._guideStepListEls = null;
        this._guideStepListIdx = -2;
        if (dots) dots.innerHTML = '<span class="gh-dot"></span>' + g.steps.map((s, k) => `<span class="gh-dot${k === i ? ' gh-dot-active' : ''}"></span>`).join('');
        if (prev) prev.disabled = false;
        if (next) next.textContent = (i === n - 1) ? 'Finish' : 'Next →';
        return;
      }
      // "Me" speaker row — followed player's colour + their action.
      parts.push(this._guideRow('me', g.followedColor, g.followedName, step.action || ''));
      if (isCreepTour) {
        // The creep tour — its camp list IS the focal block; once the tour's
        // played through, a one-line "here's the route" summary above the why.
        const tour = this._guideCreepTour;
        parts.push(this._guideCampList(tour.camps));
        if (tour.summaryShown) {
          const names = tour.camps.map((c, i) => (i + 1) + '. ' + c.label.replace(/ camp$/, '')).join('  →  ');
          parts.push(`<div class="gh-why"><span class="gh-why-label">The route to level 3</span>`
            + `<span class="gh-why-text">${this._guideText(names)}. The numbers and the line on the map trace this route. Aim for roughly these camps, in this order, every game.</span></div>`);
        }
      } else if (step.list && step.list.length) {
        // Ordered breakdown (e.g. the opening sequence) — a big numbered list
        // with icons + timings, easy to glance + drill.
        parts.push(this._guideStepList(step.list));
      }
      // "Opp" speaker row only when there's a contrast sentence to show.
      if (step.contrast) parts.push(this._guideRow('opp', g.oppColor, g.oppName, step.contrast));
      // "Why it matters" — green-tinted callout. Pulls from PRINCIPLES.
      if (step.why) {
        parts.push(`<div class="gh-why">`
          + `<span class="gh-why-label">Why it matters</span>`
          + `<span class="gh-why-text">${linkify(step.why)}</span>`
          + `</div>`);
      }
      // "Try in your games" — gold-tinted takeaway, the part the learner
      // actually carries out of the step.
      if (step.takeaway) {
        parts.push(`<div class="gh-takeaway">`
          + `<span class="gh-takeaway-label">Try in your games</span>`
          + `<span class="gh-takeaway-text">${linkify(step.takeaway)}</span>`
          + `</div>`);
      }
      body.innerHTML = parts.join('');
      // Cache the list rows (build sequence OR camp tour) so the per-frame
      // updater can check them off; seed the initial state now (before the next
      // paint, so it doesn't fade in from "all upcoming").
      if (isCreepTour) {
        this._guideStepListEls = body.querySelectorAll('.gh-sl-item');
        this._updateGuideCreepList(this._guideCreepTour.idx);
      } else if (step.list && step.list.length) {
        this._guideStepListEls = body.querySelectorAll('.gh-sl-item[data-guide-time]');
        this._guideStepListIdx = -2;
        this._updateGuideStepList(this.gameTime);
      } else {
        this._guideStepListEls = null;
        this._guideStepListIdx = -2;
      }
    }

    if (dots) dots.innerHTML = '<span class="gh-dot"></span>' + g.steps.map((s, k) => `<span class="gh-dot${k === i ? ' gh-dot-active' : ''}"></span>`).join('');
    if (prev) prev.disabled = false; // Back from step 1 returns to the intro
    if (next) next.textContent = (i === n - 1) ? 'Finish' : 'Next →';
  }

  _showGuidePlayerPick (autoStart) {
    const players = (this.buildOrderPlayers || []).filter(p => p && !p.isNeutralPlayer);
    if (players.length < 2) return;
    const opts = document.getElementById('guide-player-pick-opts');
    if (!opts) { if (players[0]) this.enterGuideMode(players[0], { autoStart }); return; }
    opts.innerHTML = '';
    players.forEach(p => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'guide-player-pick-opt';
      btn.style.setProperty('--p-color', p.playerColor || '#888');
      btn.innerHTML = `<span class="gpp-name">${this._guideEsc(PlayerNames.canonical(p.displayName))}</span><span class="gpp-race">${this._guideEsc(this._raceLabel(p.race))}</span>`;
      btn.addEventListener('click', () => {
        const m = document.getElementById('guide-player-pick'); if (m) m.hidden = true;
        this.enterGuideMode(p, { autoStart });
      });
      opts.appendChild(btn);
    });
    const modal = document.getElementById('guide-player-pick'); if (modal) modal.hidden = false;
  }

  // ?guide=1 (optionally ?player=N) in the URL → open the guided walkthrough.
  // Deferred a tick so the rest of the load .then (layout apply, first render)
  // finishes first. If ?player is missing/unresolvable, enterGuideMode shows
  // the "whose game?" picker.
  _maybeAutoEnterGuide () {
    if (this._proFeaturesDisabled) return; // walkthrough is 1v1-only
    let params;
    try { params = new URLSearchParams(window.location.search); } catch (e) { return; }
    if (!params.get('guide')) return;
    const p = params.get('player');
    let who = (p != null && p !== '') ? (/^\d+$/.test(p) ? parseInt(p, 10) : p) : undefined;
    // Beginner mode owns the "pick a player" step in the BO panel — if no
    // player is specified and the user hasn't picked yet, don't pop the
    // walkthrough's own picker too. The CTA strip will let them launch the
    // walkthrough manually once they've picked.
    if (who == null && this.boLearnerMode && !this.beginnerPickedSlot) return;
    if (who == null && this.beginnerPickedSlot != null) who = this.beginnerPickedSlot;
    setTimeout(() => { try { this.enterGuideMode(who); } catch (e) {} }, 0);
  }

  scaleLiveModeCanvas () {
    if (this.mobileMode) return;
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
      if (this.actionCanvas) {
        this.actionCanvas.style.width = displayWidth + 'px';
        this.actionCanvas.style.height = displayHeight + 'px';
      }
      if (this.threeCanvas) {
        this.threeCanvas.style.width = displayWidth + 'px';
        this.threeCanvas.style.height = displayHeight + 'px';
      }

      this.displayScale = scale;

      if (this.minimapPip) this.minimapPip.resize();

      // The canvas just rescaled, so displayScale changed. If a walkthrough is
      // open, its camera framing was computed against the old scale (and the
      // open transition often switches layout, which lands here a frame later) —
      // re-assert the framing now that displayScale is current. This is the fix
      // for the "sometimes the first slide zooms in, sometimes it doesn't" race.
      if (this.guideMode && !this.mobileMode && this.gameLoaded) this._reapplyGuideFocus();

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

    // A user scrub during the auto-advance countdown cancels it (they've taken
    // control). Guide-internal seeks happen only when no countdown is running.
    if (this._guideCountdown) this._cancelGuideAutoAdvance();

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

    // After a jump, snap the auto time-scale to the new moment's target so it
    // doesn't ramp from a stale speed left over from elsewhere in the match.
    if (this.scrubber && this.scrubber.isAuto && this.autoDirector) {
      this.autoDirector.update(gameTime, 0);
      this.autoDirector.snap();
    }

    this.render();
  }

  setStatusTab (tab) {
    const el = document.getElementById(`${tab}-toggle`);
    const oldList = Array.from(document.getElementsByClassName("status-toggle selected"));

    oldList.forEach(oldEl => oldEl.classList.remove('selected'));
    if (el) el.classList.add('selected');
    // Reflect the active tab to assistive tech (these are <button aria-pressed>).
    document.querySelectorAll('#player-status-toggles .status-toggle').forEach(b => {
      b.setAttribute('aria-pressed', b === el ? 'true' : 'false');
    });

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

    if (this.mobileMode) {
      this.layoutMode = LayoutMode.mobileBuildOrder;
      this.viewMode = ViewModes.buildOrder;
      this.buildViewMode = BuildView.static;
    } else {
      this.layoutMode = hasBuildParam ? LayoutMode.staticBuildOrder : LayoutMode.liveBuildOrder;
      this.viewMode = hasBuildParam ? ViewModes.buildOrder : ViewModes.gameplay;
      this.buildViewMode = BuildView.live;
    }

    // reference to which players build order we are viewing
    this.buildOrderPlayers = [];

    if (!this.mobileMode) {
      this.setStatusTab('heroes');
      this.setupViewOptions();
    }

    this.setupPlayers();
    this.setupMap();

    // Build the unified event model now that players + their streams exist.
    if (this.eventModel) this.eventModel.build(this.players);

    // Process detected battles once mapData is available. Old replays parsed
    // before the BattleDetector landed simply have no `battles` array; the
    // pipeline produces an empty processed object and the overlay no-ops.
    this.processedBattles = this.battleData.processBattles(this.mapData);

    // Insights panel: tabbed container for Battle Report, Economy, Camp Key.
    if (this.bottomPanel) {
      this.bottomPanel.setup();
      // Chart cursors are skipped while their tab is hidden, so opening a tab
      // needs one frame to catch it up — and while paused the render loop has
      // stopped, so nothing would drive it.
      this.bottomPanel.onVisibilityChange = () => this.requestRender();

      // Battle Report tab.
      if (this.battleReportRenderer && this.mapData && Array.isArray(this.mapData.battles)) {
        this.battleReportRenderer.setBattles(this.mapData.battles);
        if (this.battleReportRenderer._battles.length > 0) {
          const tabContent = document.createElement('div');
          this.battleReportRenderer.setContainer(tabContent);
          this.battleReportRenderer.buildPanel();
          this.bottomPanel.addTab('battles', 'Battles', tabContent, {
            default: true,
            badge: this.battleReportRenderer._battles.length
          });
        }
      }

      // Events tab — full filterable action log (events + battle markers),
      // visually identical to the right-edge action feed.
      if (this.insightsEventLog && this.eventModel && this.eventModel.events.length) {
        const logContent = document.createElement('div');
        this.insightsEventLog.setContainer(logContent);
        this.insightsEventLog.setModel(this.eventModel);
        this.insightsEventLog.setBattles(
          (this.mapData && Array.isArray(this.mapData.battles)) ? this.mapData.battles : []
        );
        this.insightsEventLog.build();
        this.bottomPanel.addTab('events', 'Events', logContent, {
          default: !(this.battleReportRenderer && this.battleReportRenderer._battles.length),
          badge: this.eventModel.events.length || null
        });
      }

      // Economy tab.
      if (this.resourceCharts && this.mapData && this.mapData.players) {
        const playerInfos = [];
        for (const [pid, p] of Object.entries(this.mapData.players)) {
          if (p && p.resourceSeries && p.resourceSeries.length) {
            const cp = this.players.find(cp => String(cp.playerId) === String(pid));
            playerInfos.push({
              id: pid,
              color: (cp && cp.playerColor) || '#888',
              resourceSeries: p.resourceSeries
            });
          }
        }
        if (playerInfos.length) {
          const tabContent = document.createElement('div');
          this.resourceCharts.setContainer(tabContent);
          this.resourceCharts.setPlayers(playerInfos);
          this.resourceCharts.build();
          this.bottomPanel.addTab('economy', 'Economy', tabContent);
        }
      }

      // Dominance tab — strict gate: 1v1 + parser-emitted availability flag.
      // Degraded parses carry no dominanceSeries at all (see lib/DominanceSeries.js).
      if (this.dominanceChart && this.mapData && this.mapData.players &&
          this.mapData.dominance && this.mapData.dominance.available &&
          this.getGameMode() === '1v1') {
        const domInfos = [];
        for (const [pid, p] of Object.entries(this.mapData.players)) {
          if (p && p.dominanceSeries && p.dominanceSeries.samples &&
              p.dominanceSeries.samples.length) {
            const cp = this.players.find(cp => String(cp.playerId) === String(pid));
            domInfos.push({
              id: pid,
              color: (cp && cp.playerColor) || '#888',
              samples: p.dominanceSeries.samples,
              events: p.dominanceSeries.events || []
            });
          }
        }
        if (domInfos.length === 2) {
          const tabContent = document.createElement('div');
          this.dominanceChart.setContainer(tabContent);
          this.dominanceChart.setPlayers(domInfos);
          this.dominanceChart.build();
          this.bottomPanel.addTab('dominance', 'Dominance', tabContent);
        }
      }

      // Camp Key tab — adopt the existing #camp-legend element if present.
      const campLegend = document.getElementById('camp-legend');
      if (campLegend) {
        // Legend's own hidden attribute was for its standalone visibility;
        // inside a tabbed panel the tab controls visibility instead.
        campLegend.hidden = false;
        this.bottomPanel.addTab('camps', 'Camp Key', campLegend);
        // The legend's own <details> chrome is redundant inside the tab.
        const det = campLegend.querySelector('details');
        if (det) det.open = true;
      }
    }

    this.buildWrapper = document.getElementById("build-wrapper");

    if (!this.mobileMode) {
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
      this.actionCanvas = document.getElementById("action-canvas");
      this.actionCtx = this.actionCanvas && this.actionCanvas.getContext("2d");

      this.megaPlayButton = document.getElementById("mega-play-overlay");

      // player-status-toggles + player boxes
      this.playerStatusCanvas.height = 50 + (this.players.length * 140);

      this.playerStatusCtx.lineWidth = 1;
      this.playerStatusCtx.fillStyle = "#29373E";
      this.playerStatusCtx.strokeStyle = "#FFF";
      this.playerStatusCtx.font = '12px Arial';

      // Detached offscreen buffer for the player-status panel. It lives
      // outside the DOM, so the per-frame ctx.font/text work that used to
      // force "Recalculate Style" + "Layout" on the live canvas can't
      // trigger any style/layout recalc here. The panel is re-rendered into
      // this buffer only when its inputs change (see _refreshPlayerStatusPanel)
      // and blitted to the visible canvas with one drawImage each frame.
      this._psOffscreen = document.createElement("canvas");
      this._psOffscreen.width = this.playerStatusCanvas.width;
      this._psOffscreen.height = this.playerStatusCanvas.height;
      this._psOffscreenCtx = this._psOffscreen.getContext("2d");
      this._psOffscreenCtx.lineWidth = 1;
      this._psOffscreenCtx.fillStyle = "#29373E";
      this._psOffscreenCtx.strokeStyle = "#FFF";
      this._psOffscreenCtx.font = '12px Arial';
      this._psSig = null;
      this._psLastBucket = -1;
    }

    const playerLoadedPromiseList = this.players.map(player => {
      return player.setup();
    });

    this.hideTutorial();
    if (!this.mobileMode) this.clearCanvas();

    // Mobile mode skips all map / terrain / doodad / walkmap / grid / neutral
    // building loads. Only the per-player BO data + the lightweight unit
    // balance lookup are needed to render build orders.
    const heavyMapLoads = this.mobileMode ? [] : [
      this.loadMapFile(),
      this.loadMapFile("grid"),
      this.loadDoodadFile(),
      this.loadWalkmap(),
      this.loadNeutralBuildings(),
      this.loadGridFile()
    ];

    // finishes the setup promise — load independent data in parallel
    this.updateLoadingStatus('Loading map data...');
    return Promise.all([
      ...heavyMapLoads,
      this.loadUnitBalance(),
      ...playerLoadedPromiseList
    ])
    .then(() => {
      if (this.mobileMode) return;
      this.updateLoadingStatus('Building terrain...');
      this.setupDrawing();
      return this.setup3DTerrain();
    })
    .then(() => {
      this.updateLoadingStatus('Preparing UI...');

      // Non-1v1 games are full-detail only: pro-analysis features (beginner
      // view, guided walkthrough, Compare) are 1v1-only and don't generalize.
      // This is the single chokepoint — runs after setupPlayers() so
      // getGameMode() is resolvable, before any BO/guide/compare wiring.
      this._proFeaturesDisabled = this.isNonOneVsOne();
      if (this._proFeaturesDisabled) {
        this.boLearnerMode = false;
        const appEl = document.getElementById('app');
        if (appEl) {
          appEl.classList.remove('is-beginner');
          appEl.classList.add('is-non-1v1');
        }
      }

      this.boRenderer = new BuildOrderRenderer(this);
      this.matchHeader = new MatchHeader(this);
      this.matchSummary.setup();
      this._loadBeginnerPick();    // restore the "Me" pick (or take it from ?player=) BEFORE the first BO render
      this.setupBuildOrder();
      this._maybeAutoEnterGuide(); // ?guide=1 deep link → open the walkthrough once the BO panel is up
      // (No auto-open on landing — the beginner overlay's "Just Watch" / "Teach Me"
      //  buttons are the explicit choice. ?guide=1 deep links still auto-open above.)

      if (this.mobileMode) {
        // Skip canvas-bound subsystems entirely. BO renderer + match header
        // are sufficient for the mobile build-order-only experience.
        this.gameLoaded = true;
        this.matchHeader.render();
        this._renderNon1v1Banner();
        this.applyLayoutMode();
        return;
      }

      this.buildTerrainIndex();
      this.baseNameplateRenderer = new BaseNameplateRenderer();
      this.baseNameplateRenderer.computeAnchors(this.players, this.neutralBuildings, this.gameScaler, this.mapData);
      this.timelineSpline = new TimelineSpline(this);
      this.chapterMarkers = new ChapterMarkers(this);
      this.placementViewer.setup();
      this.matchHeader.render();
      this._renderNon1v1Banner();

      // Dominance bar — after matchHeader.render() so the card badges exist.
      // Self-gates on 1v1 + dominance.available.
      if (this.dominanceBar) this.dominanceBar.setup();

      this.chapterMarkers.detectChapters(this.players, this.matchEndTime);
      const cmTrack = document.getElementById('scrubber-bar-track');
      if (cmTrack) {
        this.chapterMarkers.renderScrubberMarkers(cmTrack, this.matchEndTime);
        this.chapterMarkers.renderHeatmap(cmTrack, this.players, this.matchEndTime);
      }

      // Battle scrubber markers — clickable chevrons over the track for every
      // detected battle. Click scrubs to the battle's start.
      if (this.processedBattles && this.scrubber && this.scrubber.setBattleMarkers) {
        this.scrubber.setBattleMarkers(
          this.processedBattles.battles,
          this.matchEndTime,
          (battle) => {
            this.gameTime = Math.max(0, battle.startTime - 1000);  // small pre-roll
            this.requestRender();
          }
        );
      }

      // Quarter-time guide markers — 1/4, 1/2, 3/4 reference ticks with minute labels.
      if (this.scrubber && this.scrubber.setTimeGuides) {
        this.scrubber.setTimeGuides(this.matchEndTime);
      }

      // Auto time-scale (AUTO speed) — 1v1 only. Build the pacing index now that
      // battles + chapters exist, expose AUTO in the speed picker, and make it
      // the default for 1v1. Other game modes keep a fixed manual speed.
      const autoPaceOk = !this.isNonOneVsOne();
      if (this.scrubber && this.scrubber.setAutoAvailable) {
        this.scrubber.setAutoAvailable(autoPaceOk);
      }
      if (this.autoDirector) {
        if (autoPaceOk) {
          this.autoDirector.build();
          if (this.scrubber) this.scrubber.setSpeed('AUTO');
        } else {
          this.autoDirector.reset();
        }
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
          [this.canvas, this.playerCanvas, this.utilityCanvas, this.actionCanvas].filter(Boolean).forEach(c => {
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
      displayBaseLabels: true,

      displayMapGrid: false,
      displayTreeGrid: true,
      displayWalkGrid: false,
      displayBuildGrid: false,
      displayWaterGrid: false,
      displayCreepRoute: true,
      suppressCreepRings: false,      // hide camp ground-rings during the guide creep tour (set by _setupGuideCreepTour); not a user toggle
      displayNeutralBuildings: true,
      displayBattles: true,           // BattleRenderer overlay (utility canvas)
      displayTeleports: true,         // TeleportFx cast/arrival cinematic
      // autoSplitScreen default ON: split is now a smart, reversible sub-state
      // of the AUTO camera — it slides into a diagonal split only when the 1v1
      // players are clearly apart with no fight active/imminent, and slides back
      // out the moment they converge or a battle starts. Toggle off to keep AUTO
      // single-viewport at all times. (1v1 only; forced off for non-1v1.)
      autoSplitScreen: true,
      display3DUnits: true            // 3D animated unit models are the default; toggle off for 2D icons
    };

    // Creep/spawn-camp route detection is keyed off 1v1 team heuristics and
    // mis-credits routes to red/blue aggregate teams in team/FFA games.
    // Force it off and lock the toggle for non-1v1.
    if (this.isNonOneVsOne()) {
      this.viewOptions.displayCreepRoute = false;
    }

    Object.keys(this.viewOptions).forEach(optionKey => {
      const el = document.getElementById(`viewer-option-${optionKey}`);
      if (!el) {
        return;
      }

      this.viewOptions[optionKey] ?
        el.classList.add('on') :
        el.classList.remove('on');
    });

    // Sync the mega-hint toggle buttons (and their aria-pressed) to the
    // current viewOptions in case the defaults ever drift from the HTML.
    document.querySelectorAll('.mega-hint[data-option]').forEach(el => {
      const on = !!this.viewOptions[el.dataset.option];
      el.classList.toggle('on', on);
      if (el.tagName === 'BUTTON') el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    // populate settings modal with view option toggles
    const settingsModalEl = document.getElementById(`${this.scrubber.wrapperId}-settings-modal`);
    if (settingsModalEl) {
      const buttons = [
        { key: 'displayCreepRoute', label: 'Creep Routes', featured: true },
        { key: 'displayPath', label: 'Unit Trails' },
        { key: 'displayLevelPins', label: 'Level Pins' },
        { key: 'displayFloatingText', label: 'Action Feed' },
        { key: 'displayText', label: 'Unit Names' },
        { key: 'displayBaseLabels', label: 'Base Labels' },
        { key: 'decayEffects', label: 'Fade FX' },
        { key: 'displayTreeGrid', label: 'Tree Grid' },
        { key: 'autoSplitScreen', label: 'Auto Split View' }
      ];

      settingsModalEl.innerHTML = '';

      const creepRouteLocked = this.isNonOneVsOne();
      const autoSplitLocked = this.isNonOneVsOne();

      buttons.forEach(btn => {
        const el = document.createElement('div');
        el.classList.add('vc-btn');
        if (btn.featured) el.classList.add('vc-featured');
        el.id = `viewer-option-${btn.key}`;

        const locked = (btn.key === 'displayCreepRoute' && creepRouteLocked) ||
                       (btn.key === 'autoSplitScreen' && autoSplitLocked);
        if (locked) {
          el.classList.add('vc-disabled');
          el.title = btn.key === 'autoSplitScreen'
            ? 'Auto split view is 1v1-only'
            : 'Creep route detection is 1v1-only';
        }

        el.textContent = btn.label;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          if (locked) return;
          this.toggleViewOption(btn.key);
        });
        if (this.viewOptions[btn.key] && !locked) el.classList.add('on');

        settingsModalEl.append(el);
      });
    }

    // close modals when clicking outside
    // Bind the outside-click dismiss handler once — setupViewOptions runs per
    // load but the handler resolves the scrubber/modal elements live on each
    // click, so a single binding stays correct across reloads.
    if (!this._viewOptionsClickWired) {
      this._viewOptionsClickWired = true;
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
  }

  // Game-mode categorization. Prefer the parser-emitted `gameMode` on the
  // .wc3v file; fall back to recomputing from raw player/team data so legacy
  // files (and pre-rebuild bundles) still classify correctly. STRICT rule —
  // must stay in sync with helpers/utils.js computeGameMode and the
  // UploadManager fallback.
  getGameMode () {
    if (this.mapData && typeof this.mapData.gameMode === 'string') {
      return this.mapData.gameMode;
    }
    const pmap = (this.mapData && this.mapData.players) || {};
    const humans = Object.values(pmap).filter(p => p && !p.isNeutralPlayer);
    const n = humans.length;
    if (n < 2) return 'custom';
    const byTeam = {};
    humans.forEach(p => { byTeam[p.teamId] = (byTeam[p.teamId] || 0) + 1; });
    const counts = Object.values(byTeam);
    const tc = counts.length;
    if (n === 2 && tc === 2) return '1v1';
    if (tc === 2 && counts[0] === counts[1]) {
      return ({ 2: '2v2', 3: '3v3', 4: '4v4' })[counts[0]] || 'custom';
    }
    if (n >= 3 && tc === n) return 'ffa';
    return 'custom';
  }

  isNonOneVsOne () {
    const m = this.getGameMode();
    return !!m && m !== '1v1';
  }

  // The nav skill-band (New / Ladder / Pro) does nothing in non-1v1 games —
  // pro comparison, guided walkthrough and beginner view are all 1v1-only.
  // So for non-1v1 we swap SiteNav's nav band for a static, non-interactive
  // "Viewing <mode> game" notice in the same spot. Idempotent.
  _renderNon1v1Banner () {
    if (!this.isNonOneVsOne()) return;
    const band = document.getElementById('skill-band-nav');
    if (!band || band.dataset.non1v1 === '1') return;

    const modeLabel = ({ '2v2': '2v2', '3v3': '3v3', '4v4': '4v4', ffa: 'FFA', custom: 'Custom' })[this.getGameMode()] || this.getGameMode().toUpperCase();

    band.dataset.non1v1 = '1';
    band.classList.add('skill-band--non1v1');
    band.removeAttribute('role');
    band.setAttribute('aria-label', `Viewing ${modeLabel} game`);

    const label = document.createElement('span');
    label.className = 'skill-band-non1v1-label';
    label.textContent = `Viewing ${modeLabel} game`;
    band.innerHTML = '';
    band.appendChild(label);
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
        buildingAttempts,
        teleportEvents,
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
      // The build-COMMAND log (when each building was ordered, not when
      // construction started) — ReplayGuide uses it so the opening reads in the
      // real command order. [{ itemId, displayName, gameTime, x, y, status }]
      player.buildingAttempts = Array.isArray(buildingAttempts) ? buildingAttempts : null;
      // Teleport events (TP Scroll / Mass Teleport / Blink) — TeleportFx
      // reads this to render the cast ring, banner, arrival flash, and trail.
      player.teleportEvents = Array.isArray(teleportEvents) ? teleportEvents : [];

      this.assignedPlayerColors[playerId] = this.playerColorMap[index];

      slotCounter++;

      player.teamId = teamId;
      this.players.push(player);
    });

    this.buildBehaviorWorld();
  }

  /**
   * Build the UnitBehavior world — the single authority for what each unit is
   * DOING (idle / walk / attack, and at what). The renderer consumes its
   * decisions instead of inferring animation state itself.
   *
   * Buildings are included as TARGET-ONLY actors: a footman hitting a Stronghold
   * is a real attack, and leaving buildings out would make those units resolve
   * no target and stand there.
   */
  buildBehaviorWorld () {
    if (!window.UnitBehavior) return;
    const units = [];
    for (const p of this.players) {
      const teamId = (p.teamId != null) ? p.teamId : (p.isNeutralPlayer ? 1046 : p.playerId);
      for (const u of (p.units || [])) {
        if (!u || !u.uuid) continue;
        u._playerId = p.playerId;
        u._teamId = teamId;
        u._isNeutral = !!p.isNeutralPlayer;
        units.push(u);
      }
    }
    this.behaviorWorld = window.UnitBehavior.createWorld({
      units,
      battles: (this.mapData && this.mapData.battles) || [],
      camps: (this.mapData && this.mapData.world && this.mapData.world.neutralGroups) || {}
    });
    if (this.unitModelRenderer) this.unitModelRenderer.behavior = this.behaviorWorld;
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

    if (self.actionCanvas) {
      self.actionCanvas.width = mapWidth;
      self.actionCanvas.height = mapHeight;
    }

    if (self.threeCanvas) {
      self.threeCanvas.width = mapWidth;
      self.threeCanvas.height = mapHeight;
      self.threeCanvas.style.width = mapWidth + "px";
      self.threeCanvas.style.height = mapHeight + "px";
      if (self.threeMapRenderer) self.threeMapRenderer.resize();
    }

    if (typeof CampPanel !== 'undefined') {
      // Tear down the prior panel first — it owns a perpetual rAF loop and
      // document listeners that would otherwise duplicate on every reload.
      if (this.campPanel && typeof this.campPanel.destroy === 'function') this.campPanel.destroy();
      this.campPanel = new CampPanel(this);
      this.campPanel.setData(world.neutralGroups);
    }

    this.toggleMegaPlayButton(true);
    this.gameLoaded = true;

    this.zoomContainer = d3.select("#canvas-group");

    const zoomScaleExtent = [1.0, 24.0];  // up to 24× so you can zoom in close on individual 3D unit models (camera ~1000u up)

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

    this.zoomContainer.on('mousemove.buildinghover', () => {
      // The guided walkthrough drives the camera itself — suppress the
      // building hover tooltip so it doesn't pop up on stale-pointer hits.
      // (Creep camps use the click-driven CampPanel, not hover.)
      if (self.guideMode) return;
      const ev = d3.event;
      if (self.buildingHoverLabel) self.buildingHoverLabel.handleMouse(ev, self.transform);
    });

    this.scrubber.onZoomChange = (k) => {
      this.zoomContainer.call(this.zoom.scaleTo, k);
    };

    // Broadcast camera — automatic camera modes driven through D3 zoom
    if (window.BroadcastCamera) {
      this.broadcastCamera = new BroadcastCamera(this);
      this.broadcastCamera.attachToZoom(this.zoom, this.zoomContainer);
      this.broadcastCamera._autoSplitEnabled = this.isNonOneVsOne() ? false : this.viewOptions.autoSplitScreen;
      this.broadcastCamera.onModeChange = (mode) => {
        this._updateCameraToolbar(mode);
      };
      this._setupCameraToolbar();
    }

    // Auto time-scale director — dynamic playback speed for the AUTO speed
    // mode (1v1 only). Built later in setup() once battles/chapters exist.
    if (window.AutoDirector) {
      this.autoDirector = new AutoDirector(this);
      // The director sequences camera + speed and announces the result, so it
      // needs a handle on both. Kept as explicit wiring (not lookups through the
      // viewer) so the director's dependencies are visible at a glance.
      this.autoDirector.camera = this.broadcastCamera || null;
      if (window.DirectorOverlay) {
        this.directorOverlay = new window.DirectorOverlay(this);
        this.directorOverlay.setup();
        this.autoDirector.overlay = this.directorOverlay;
      }
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
      // Walkthrough drives the camera itself — re-frame the current step so
      // it doesn't get stranded at full-map zoom after a resize.
      if (self.guideMode && !self.mobileMode) self._reapplyGuideFocus();
      if (self.state !== ScrubStates.stopped) {
        self.requestRender();
      }
    };

    // Bind page-level resize / fullscreen listeners exactly once. setupDrawing
    // runs on every replay load, but window/document/#gameplay-area persist for
    // the whole viewer lifetime and these handlers read live state through the
    // (reused) viewer instance — re-binding would stack a handler + observer
    // per reload. The flag is intentionally NOT cleared in reset().
    if (!this._drawingListenersBound) {
      this._drawingListenersBound = true;

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
          // …and re-frame the walkthrough step if one's active.
          if (self.guideMode && !self.mobileMode) self._reapplyGuideFocus();
        }
      });
    }
  }

  // Re-render the player-status panel into the detached offscreen buffer,
  // but only when something visible actually changed. Tier/tab/selection/
  // hero-count changes redraw immediately; continuously-ticking values
  // (unit counts, hero HP/mana) refresh at ~4Hz via a 250ms time bucket
  // instead of every frame. The caller blits _psOffscreen each frame.
  _refreshPlayerStatusPanel (transform, gameTime, xScale, yScale, viewOptions) {
    if (!this._psOffscreenCtx) return;

    let sig = '';
    for (const p of this.players) {
      if (p.isNeutralPlayer) continue;
      const sel = p.currentGroup ? p.currentGroup.length : 0;
      sig += p.tier + ':' + p.tab + ':' + sel + ':' + p.heroes.length + '|';
    }
    const bucket = Math.floor(gameTime / 250);
    if (sig === this._psSig && bucket === this._psLastBucket) return;
    this._psSig = sig;
    this._psLastBucket = bucket;

    const octx = this._psOffscreenCtx;
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, this._psOffscreen.width, this._psOffscreen.height);
    this.players.forEach(player => {
      player.renderPlayerIcon(octx, transform, gameTime, xScale, yScale, viewOptions);
    });
  }

  // Refresh (throttled) + blit the status panel onto the visible canvas.
  // One drawImage per frame; no text/font work touches the live DOM canvas.
  _drawPlayerStatusPanel (transform, gameTime, xScale, yScale, viewOptions) {
    if (!this._psOffscreen || !this.playerStatusCtx) return;
    this._refreshPlayerStatusPanel(transform, gameTime, xScale, yScale, viewOptions);
    this.playerStatusCtx.drawImage(this._psOffscreen, 0, 0);
  }

  clearCanvas () {
    if (this.mobileMode || !this.canvas) return;
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
    if (this.actionCtx) {
      this.actionCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.actionCtx.clearRect(0, 0, w, h);
    }
  }

  // Coalesced render request — multiple calls per frame collapse into one RAF
  requestRender () {
    if (this.mobileMode) return;
    if (this._renderPending) return;
    this._renderPending = true;
    requestAnimationFrame(() => {
      this._renderPending = false;
      if (this.gameLoaded) this.render();
    });
  }

  startRenderLoop () {
    if (this.mobileMode) return;
    this.lastFrameTimestamp = 0;
    // Bind once and reuse — mainLoop re-arms itself every frame, so binding
    // inline would allocate a new bound function on every animation frame.
    if (!this._boundMainLoop) this._boundMainLoop = this.mainLoop.bind(this);
    this.lastFrameId = requestAnimationFrame(this._boundMainLoop);
  }

  stopRenderLoop () {
    cancelAnimationFrame(this.lastFrameId);
  }

  mainLoop(timestamp) {
    if (this.layoutMode === LayoutMode.staticBuildOrder) {
      this.stopRenderLoop();
      return;
    }

    // FIRST thing in the frame: take the one canvas-geometry read, while layout
    // is still clean from the previous frame's paint. Everything after this
    // point (the intrusion tag, camera transforms, overlay positioning) writes
    // styles, and any layout read that lands after a write forces a synchronous
    // reflow. One clean read up front serves every projectToCssPixels caller.
    if (this.gameScaler && this.gameScaler.beginFrame && this.canvas) {
      this.gameScaler.beginFrame(this.canvas);
    }

    const timeStep = this.scrubber.getTimeStep();

    if (this.lastFrameTimestamp === 0) {
      this.lastFrameTimestamp = timestamp;
    }

    const realDelta = timestamp - this.lastFrameTimestamp;
    this.lastFrameDelta += realDelta;
    this.lastFrameTimestamp = timestamp;

    // Effective playback speed: AUTO mode (1v1) asks the director to dynamically
    // pace the replay (fast through dead time, ~1× for fights/key moments);
    // otherwise it's the fixed speed the user picked. The guided walkthrough
    // plays short curated windows, so AUTO is pinned to a gentle fixed pace
    // there rather than risk fast-forwarding past the content being taught.
    let speed = this.scrubber.speed;
    if (this.scrubber.isAuto && this.autoDirector) {
      if (this.guideMode) {
        speed = 2;
      } else {
        // Feed the camera's live on-screen activity (computed last frame) to the
        // director so the time-scale slows whenever units are doing things, not
        // only during a formal battle.
        const bc = this.broadcastCamera;
        const activity = (bc && typeof bc.activityLevel === 'number') ? bc.activityLevel : 0;
        // Split view (parallel macro) and the scout/intrusion cut are both
        // "showcase" moments — cap the time-scale so they're actually watchable
        // instead of flying past at the dead-time fast-forward rate.
        //
        // The cap is handed to the director as a CEILING rather than clamped on
        // the way out. Clamping the smoothed output stepped the speed instantly
        // (6.0 -> 4.0 -> 6.0 on entering/leaving a split), bypassing the
        // director's own slew limit and its shot sequencing — the one thing that
        // was guaranteed to look like a stutter.
        const showcase = !!(bc && (bc.isSplitActive || bc.isFramingIntrusion));
        this.autoDirector.speedCeiling = showcase ? 4 : null;
        speed = this.autoDirector.update(this.gameTime, realDelta, activity);
        this.scrubber.speed = speed;
        this.scrubber.updateAutoReadout(speed);
      }
    }

    // Feed the current speed to the camera so it widens/calms when fast-forwarding.
    if (this.broadcastCamera && this.broadcastCamera.setSpeedFactor) {
      this.broadcastCamera.setSpeedFactor(this.state === ScrubStates.playing ? speed : 1);
    }

    // Fixed-timestep catch-up, CLAMPED. lastFrameDelta accumulates real time,
    // so after a tab-switch, a GC pause, or a long GLB parse it can hold several
    // seconds — which uncapped would run hundreds of update() iterations in a
    // single frame, each walking every unit of every player, making the stall
    // worse than the thing that caused it. Past the cap we discard the backlog:
    // playback skips a beat, but the tab recovers on the very next frame.
    const maxIter = (window.WC3V_CONFIG && window.WC3V_CONFIG.perf &&
      window.WC3V_CONFIG.perf.maxCatchupIterations) || 5;
    let iter = 0;
    while (this.lastFrameDelta >= timeStep) {
        if (this.state === ScrubStates.playing) {
          this.update(timeStep * speed);
        }

        this.lastFrameDelta -= timeStep;
        if (++iter >= maxIter) { this.lastFrameDelta = 0; break; }
    }

    // Guided walkthrough: a step plays out from just before the action to the
    // end of its content window, then parks (the next step rolls the tape
    // again). Snap cleanly to the window end and pause; the loop keeps running
    // (guideMode) so the emphasis rings keep pulsing.
    if (this.guideMode && this._guidePlayUntil != null && this.gameTime >= this._guidePlayUntil) {
      const t = this._guidePlayUntil;
      const mode = this._guideParkMode;
      this._guidePlayUntil = null;
      this._guideParkMode = null;
      this.pause();
      this.seekToGameTime(t);
      // 'auto' parks (the step's content end) nudge on to the next step with a
      // 3-2-1 countdown; 'stay' parks (the user chose "Watch the rest") just hold.
      if (mode === 'auto') this._startGuideAutoAdvance();
    }

    // Broadcast camera: drive D3 zoom toward computed target each frame
    if (this.broadcastCamera && this.broadcastCamera.enabled) {
      this.broadcastCamera.update(this.gameTime, this.players);
    }

    // Tag the single-view harass/scout cut so a deliberate intrusion shot reads
    // as intentional rather than "why are we staring at a base?".
    this._updateIntrusionTag();

    this._renderPending = false;  // mainLoop owns the render — cancel any queued requestRender
    // Same for the 3D renderer's independent rAF: model loads / building spawns
    // call threeMapRenderer.requestRender() constantly during playback, and each
    // honoured request is a redundant full scene render on top of this one.
    if (this.threeMapRenderer) this.threeMapRenderer._pendingRender = false;
    this.render();

    if (this.gameTime >= this.matchEndTime) {
      this.stop();
      this.showMatchCompleteBanner();
      return;
    }

    // If paused and camera has settled, stop the loop to save CPU — but keep
    // it alive during the guided walkthrough so the emphasis rings can pulse.
    if (this.state === ScrubStates.paused && !this.guideMode &&
        this.broadcastCamera && this.broadcastCamera.settled) {
      return;
    }

    // Release the frame's cached canvas geometry. A resize or layout-mode change
    // between frames must not be served stale metrics; the next frame takes a
    // fresh clean read at the top of mainLoop.
    if (this.gameScaler) this.gameScaler._frameMetrics = null;

    if (!this._boundMainLoop) this._boundMainLoop = this.mainLoop.bind(this);
    this.lastFrameId = requestAnimationFrame(this._boundMainLoop);
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
   * Render in split-screen mode: two horizontal halves (top + bottom), each
   * showing a different player's area at higher zoom.
   *
   * Renders the full pipeline twice — once per camera position. The 3D
   * terrain is rendered to three-canvas normally, then copied to
   * main-canvas (2D) via drawImage within a top/bottom rectangular clip. Unit
   * overlays on playerCtx/utilityCtx are drawn within their own half clips.
   * three-canvas is hidden so only the composited main-canvas is visible.
   */
  renderSplitScreen () {
    const bc = this.broadcastCamera;
    if (!bc || !bc.splitTargets) return;

    const { top, bottom } = bc.splitTargets;
    if (!top || !bottom) { this.render(); return; }

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

    // Targets already bake in the half-viewport vertical offset and a clamp to
    // gs.viewExtent (computed inside BroadcastCamera) so the visible camera rect
    // for each half stays within the playable area.
    const transformTop = this._worldToTransform(top.wx,    top.wy,    top.k);
    const transformBot = this._worldToTransform(bottom.wx, bottom.wy, bottom.k);

    // Horizontal split: a fixed divider at the vertical midline. The two halves
    // cut in immediately (fast); only the divider line + name labels animate
    // (see _drawSplitDivider) — the line wipes out from the centre, names fade
    // in after it reaches the edges.
    const dividerY = ch * 0.5;

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
      { target: top,    transform: transformTop, side: 'top' },
      { target: bottom, transform: transformBot, side: 'bottom' }
    ];

    // View-INDEPENDENT world updates, hoisted out of the per-half loop.
    // These place things in world space and don't care where either camera is
    // looking, but they used to run once per half — so split-screen paid twice
    // for the unit-model update (including its collision-separation pass and,
    // now, the whole behavior resolve) on the single most expensive frame the
    // app has. Only the 3D render itself is genuinely per-view.
    if (this.threeMapRenderer) {
      this.threeMapRenderer.updatePlayerBuildings(gameTime);
      if (this.buildingProgressBar) this.buildingProgressBar.update(gameTime);
      if (this.buildingSplats) this.buildingSplats.updateVisibility(gameTime);
      if (this.pathTrailRenderer) {
        this.pathTrailRenderer.update(gameTime, this.players, this.viewOptions);
      }
      if (this.unitModelRenderer) {
        this.unitModelRenderer.update(gameTime, this.players, this.viewOptions);
      }
    }

    for (const half of halves) {
      const t = half.transform;

      // --- Top/bottom rectangular clip on all 2D canvases ---
      ctx.save();
      playerCtx.save();
      utilityCtx.save();

      for (const c of [ctx, playerCtx, utilityCtx]) {
        c.beginPath();
        if (half.side === 'top') {
          c.rect(0, 0, cw, dividerY);
        } else {
          c.rect(0, dividerY, cw, ch - dividerY);
        }
        c.clip();
      }

      // --- Swap transform so downstream code uses this half's view ---
      const savedTransform = this.transform;
      this.transform = t;

      // --- 3D terrain: render, then copy to main-canvas within the clip ---
      // (World updates were hoisted above — this half only re-aims the camera.)
      if (this.threeMapRenderer) {
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
          deathFx: [],
          gameTime: 0
        };
      }
      const frameData = this._frameData;
      frameData.nameplateTree.clear();
      frameData.unitDrawPositions.length = 0;
      frameData.buildingPositions.length = 0;
      if (!frameData.deathFx) frameData.deathFx = [];
      frameData.deathFx.length = 0;
      for (const k in frameData.drawnUnits) delete frameData.drawnUnits[k];
      frameData.gameTime = gameTime;
      this._refreshActiveBattleParticipants(frameData, gameTime);

      // --- Map overlays ---
      this.mapRenderer.renderNeutralGroups(utilityCtx, gameTime, t, this.mapData, viewOptions, gs, players, this.teamColorMap, null);
      this.mapRenderer.renderNeutralBuildings(utilityCtx, t, viewOptions, this.neutralBuildings, gs);

      // Position camp icons against THIS half's 3D camera (which is the one
      // threeMapRenderer.render(t) just synced). The diagonal-clip filter is
      // applied inside the panel so each camp's icon lands on the side that
      // actually shows its ring.
      if (this.campPanel && !this.guideMode) {
        this.campPanel.syncIcons({ side: half.side });
      }

      // --- Units: projectXY uses the 3D camera just positioned ---
      players.forEach(player => {
        player.preRender(frameData, ctx, playerCtx, utilityCtx, playerStatusCtx, t, gameTime, xScale, yScale, viewOptions);
      });

      // Per-frame collision pass — same purpose as in the main render path.
      if (window.CollisionResolver) {
        window.CollisionResolver.resolveFrame(frameData);
      }

      // Skip bloom in split mode
      players.forEach(player => {
        player.resolveUnitPositions(frameData, null, true);
      });

      players.forEach(player => {
        player.render(frameData, ctx, playerCtx, utilityCtx, null, t, gameTime, xScale, yScale, viewOptions);
      });

      this._drawPlayerStatusPanel(t, gameTime, xScale, yScale, viewOptions);

      // One-shot death FX (queued during the per-unit renderUnit pass) flushed
      // here so all players' FX render together on top of unit icons.
      ClientPlayer.drawDeathFxQueue(frameData, playerCtx);

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

    // Each half called syncIcons; finish the split pass so any camp neither
    // half claimed gets hidden, then refresh the camp detail panel content.
    if (this.campPanel && !this.guideMode) {
      this.campPanel.syncIconsSplitFinish();
      this.campPanel.update(gameTime);
    }

    // --- Horizontal divider (animated line wipe + name labels) ---
    this._drawSplitDivider(playerCtx, cw, ch, dividerY, bc.splitEntryProgress || 0, bc.splitTargets.players);

    // --- HUD (not split) ---
    if (this.hasBeenPlayedOnce) {
      this.renderGameClock();
    }
    this.scrubber.render(gameTime, matchEndTime);

    if (this.boRenderer) this.boRenderer.updateLiveBoHighlight();
    if (this.unitsProductionPanel) this.unitsProductionPanel.update(gameTime);
  }

  /**
   * Per-frame: refresh the set of unit uuids that are participating in a
   * currently-active detected battle. ClientUnit.renderUnit reads this from
   * frameData.activeBattleParticipants and flags isInBattle on the draw
   * descriptor so Drawing.drawUnit can brighten the player-color halo for
   * the fighters ("spotlight on the action").
   *
   * Strict-window gate: only the [startTime, endTime] range counts — we do
   * not spotlight during the BattleData PREROLL/POSTROLL fade envelopes,
   * since those are visual easing for the box, not active combat.
   */
  _refreshActiveBattleParticipants (frameData, gameTime) {
    if (!frameData._activeBattleParticipantsSet) {
      frameData._activeBattleParticipantsSet = new Set();
    }
    const set = frameData._activeBattleParticipantsSet;
    set.clear();
    if (this.processedBattles && this.processedBattles.activeAt) {
      const active = this.processedBattles.activeAt(gameTime);
      for (const b of active) {
        if (gameTime < b.startTime || gameTime > b.endTime) continue;
        const uuids = b._participantUuids;
        if (!uuids) continue;
        for (let i = 0; i < uuids.length; i++) set.add(uuids[i]);
      }
    }
    frameData.activeBattleParticipants = set;
  }

  /**
   * Draw the horizontal split divider — a glowing line that wipes out from the
   * centre of the screen, with player name labels (top player above the line on
   * the LEFT, bottom player below on the RIGHT) that fade in only AFTER the line
   * reaches the edges.
   *
   * `progress` is the camera's splitEntryProgress (0 → 1 on entry, 1 → 0 on
   * exit). The line owns the first 60% of the animation; the names the last 40%.
   */
  _drawSplitDivider (ctx, cw, ch, dividerY, progress, splitPlayers) {
    const smooth = (x) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };

    // Line wipes from centre outward over the first 60% of the transition.
    const lineP = smooth(progress / 0.6);
    // Names fade in over the final 40%, once the line has fully drawn.
    const nameAlpha = smooth((progress - 0.6) / 0.4);

    const halfW = (cw * 0.5) * lineP;
    if (halfW <= 0.5) return;

    ctx.save();

    // Main divider line — bright white with a soft glow, drawn centre-out.
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(80, 180, 255, 0.55)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(cw * 0.5 - halfW, dividerY);
    ctx.lineTo(cw * 0.5 + halfW, dividerY);
    ctx.stroke();

    // Bright leading caps at the growing ends while the line is still wiping.
    if (lineP < 1) {
      ctx.shadowBlur = 14;
      ctx.fillStyle = 'rgba(180, 225, 255, 0.95)';
      for (const ex of [cw * 0.5 - halfW, cw * 0.5 + halfW]) {
        ctx.beginPath();
        ctx.arc(ex, dividerY, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.shadowBlur = 0;

    if (nameAlpha > 0.01 && splitPlayers && splitPlayers.length >= 2) {
      const topColor = splitPlayers[0].teamColor || '#ff0000';
      const botColor = splitPlayers[1].teamColor || '#0000ff';
      const topName = PlayerNames.canonical(splitPlayers[0].displayName) || 'Player 1';
      const botName = PlayerNames.canonical(splitPlayers[1].displayName) || 'Player 2';

      const fontSize = Math.max(14, Math.round(cw * 0.024));
      ctx.font = `600 ${fontSize}px Arial, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = nameAlpha;

      // Name pills hug the divider vertically (`above` = top half) but sit at the
      // SIDES so they don't block the centre of the view: top player on the LEFT,
      // bottom player on the RIGHT, inset ~12% from the canvas edge. Slides a few
      // px toward its half as it fades in.
      const edgePad = cw * 0.12;
      const drawLabel = (name, color, above) => {
        const textW = ctx.measureText(name).width;
        const padX = fontSize * 0.55;
        const padY = fontSize * 0.32;
        const pillW = textW + padX * 2 + 6;
        const pillH = fontSize + padY * 2;
        const gap = 10 + (1 - nameAlpha) * 8; // eases toward the line
        const x = above ? edgePad : (cw - edgePad - pillW);
        const y = above ? (dividerY - gap - pillH) : (dividerY + gap);

        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(x, y, pillW, pillH);
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 4, pillH);     // race/team accent bar
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.fillText(name, x + 4 + padX, y + pillH / 2 + 1);
      };

      drawLabel(topName, topColor, true);
      drawLabel(botName, botColor, false);
    }

    ctx.restore();
  }

  render () {
    // No canvas rendering needed in static or mobile BO mode
    if (this.layoutMode === LayoutMode.staticBuildOrder ||
        this.layoutMode === LayoutMode.mobileBuildOrder) {
      return;
    }
    if (!this.canvas) return;

    // Normally mainLoop already primed this at the very top of the frame; this
    // covers a standalone requestRender() that isn't driven by the loop.
    if (this.gameScaler && this.gameScaler.beginFrame && !this.gameScaler._frameMetrics) {
      this.gameScaler.beginFrame(this.canvas);
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
      // Resolve/apply the guide highlight BEFORE the renderers' per-frame pulse
      // hooks (UnitModelRenderer._updateGuideHighlight runs at the end of
      // update(); ThreeMapRenderer._updateGuideRings runs inside render()), so
      // the glow applies same-frame — no lost opening pulse, no 1-frame lag.
      if (this.guideMode) this._renderGuideHighlights();
      if (this.unitModelRenderer) {
        this.unitModelRenderer.update(gameTime, this.players, this.viewOptions);
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
        deathFx: [],
        gameTime: 0
      };
    }
    const frameData = this._frameData;
    frameData.nameplateTree.clear();
    frameData.unitDrawPositions.length = 0;
    frameData.buildingPositions.length = 0;
    if (!frameData.deathFx) frameData.deathFx = [];
    frameData.deathFx.length = 0;
    if (!frameData.idleMarkers) frameData.idleMarkers = [];
    frameData.idleMarkers.length = 0;
    for (const k in frameData.drawnUnits) delete frameData.drawnUnits[k];
    frameData.gameTime = gameTime;
    this._refreshActiveBattleParticipants(frameData, gameTime);

    this.mapRenderer.renderMapGrid(utilityCtx, transform, viewOptions, this.gameScaler, this.mapInfo, this.gridData, this.canvas);
    // Trees deferred to Phase 2 (3D billboard sprites); flat green circles looked out of place on the 3D terrain.
    // this.mapRenderer.renderMapTrees(utilityCtx, transform, viewOptions, this.doodadData, this.gameScaler, this.mapInfo);
    // Camp rings draw on utilityCtx via MapRenderer. CampPanel positions its
    // HTML icons via the same projectXY path, so no hit buffer hand-off is
    // needed — both stay glued to the 3D camera under any mode.
    this.mapRenderer.renderNeutralGroups(utilityCtx, gameTime, transform, this.mapData, viewOptions, this.gameScaler, this.players, this.teamColorMap, null);
    // Sync the HTML icons here too in guideMode: the walkthrough drives the
    // camera with a single one-shot d3 zoom, and CampPanel's own rAF loop can
    // run before threeMapRenderer.syncTransform has moved the 3D camera — it
    // would then project the icons through the stale (pre-zoom) matrix and,
    // because the transform signature never changes again, leave them stuck in
    // the wrong place. render() always runs after the camera matrix is rebuilt
    // (and mainLoop never self-stops while guideMode), so positioning the icons
    // here keeps them glued to the fresh camera. `update()` no-ops unless the
    // camp detail panel is open, so it's safe to call during the walkthrough.
    if (this.campPanel) {
      this.campPanel.syncIcons(null);
      this.campPanel.update(gameTime);
    }
    this.mapRenderer.renderNeutralBuildings(utilityCtx, transform, viewOptions, this.neutralBuildings, this.gameScaler);

    // Battle overlay (dashed tracker boxes that follow the action). Drawn after
    // neutral buildings so the overlay sits on top of any camps it overlaps.
    // Banner above each box carries all the glance-value content (category,
    // duration, team-color dots, trip chips, possibly-dead) — no separate
    // floating panel.
    if (this.battleRenderer && this.processedBattles) {
      this.battleRenderer.render(utilityCtx, transform, gameTime, viewOptions, this.gameScaler, this.processedBattles, this.teamColorMap);
    }
    // Teleport cinematic — channel ring + destination mirror + banner + flash.
    // L5 ACTION INDICATORS layer (#action-canvas, z 4) so it stays above unit
    // nameplates which draw on #player-canvas (z 3). See client/docs/Z_INDEX.md.
    if (this.teleportFx && this.actionCtx) {
      this.teleportFx.render(this.actionCtx, transform, gameTime, viewOptions, this.gameScaler, this.players);
    }

    // Battle Report transient banner: same canvas (action-canvas) as the
    // teleport cinematic so it sits above unit icons. Also syncs the panel
    // active-row highlight.
    if (this.battleReportRenderer && this.actionCtx) {
      this.battleReportRenderer.render(this.actionCtx, gameTime, this.gameScaler);
      this.battleReportRenderer.syncPanel(gameTime);
    }
    if (this.insightsEventLog) {
      this.insightsEventLog.sync(gameTime);
    }
    // Chart cursors. Both rebuild SVG polyline point strings and rescan every
    // player's full sample array, so they're gated on their tab actually being
    // on screen — otherwise a collapsed panel still paid for two chart updates
    // every single frame. `perf.chartsWhenHidden` restores the old behaviour.
    const bp = this.bottomPanel;
    const chartsAlways = !!(window.WC3V_CONFIG && window.WC3V_CONFIG.perf &&
      window.WC3V_CONFIG.perf.chartsWhenHidden);
    const tabShowing = (id) => chartsAlways || !bp || !bp.isTabShowing || bp.isTabShowing(id);
    if (this.resourceCharts && tabShowing('economy')) {
      this.resourceCharts.setCursor(gameTime);
    }
    // Dominance chart now-cursor + progressive line reveal.
    if (this.dominanceChart && tabShowing('dominance')) {
      this.dominanceChart.setCursor(gameTime);
    }

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

    // STRICT NO-OVERLAP: per-frame collision pass. Parser snaps recorded
    // positions but client interpolates between samples — without this,
    // crossing units visually overlap during interpolation. Mutates
    // frameData.unitDrawPositions in place; downstream draws read resolved
    // positions. Also pushes units out of building rectangles.
    if (window.CollisionResolver) {
      window.CollisionResolver.resolveFrame(frameData);
    }

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

    // uuid -> unitDrawPositions entry, built ONCE per frame. drawResolvedUnits
    // used to `unitDrawPositions.find(u => u.uuid === ...)` inside four separate
    // per-unit loops, once per player — an O(players x units^2) scan every
    // frame. Reused (never reallocated) so this costs no garbage.
    if (!frameData.udpByUuid) frameData.udpByUuid = new Map();
    const udpIndex = frameData.udpByUuid;
    udpIndex.clear();
    for (let i = 0; i < frameData.unitDrawPositions.length; i++) {
      const u = frameData.unitDrawPositions[i];
      udpIndex.set(u.uuid, u);
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

    // RAW POSITION MODE: units render at their authoritative parser
    // positions. All client repositioning (engagement detection,
    // cross-player collision, offset smoothing, displacement caps,
    // terrain/tree clamp) has been removed — parser output is
    // ground-truth verified, so no client massaging is applied.
    this._lastResolveGameTime = gameTime;

    players.forEach(player => {
      player.render(
        frameData,
        ctx,
        playerCtx,
        utilityCtx,
        null, // status panel drawn separately via _drawPlayerStatusPanel
        transform,
        gameTime,
        xScale,
        yScale,
        viewOptions
      );
    });

    this._drawPlayerStatusPanel(transform, gameTime, xScale, yScale, viewOptions);

    // One-shot death FX (queued during the per-unit renderUnit pass) flushed
    // here so all players' FX render together on top of unit icons.
    ClientPlayer.drawDeathFxQueue(frameData, playerCtx);

    // Per-player base nameplates — drawn on the unit layer so live unit
    // nameplates / floating text (rendered just after) sit on top of them.
    if (this.baseNameplateRenderer) {
      this.baseNameplateRenderer.render(playerCtx, players, this.gameScaler, gameTime, viewOptions);
    }

    // global nameplate pass — all players' unit icons as obstacles in one tree
    if (viewOptions.displayText) {
      frameData.allNameplateBoxes = ClientPlayer.buildNameplateBoxes(frameData, playerCtx);
      ClientPlayer.renderAllNameplates(frameData, playerCtx);
    }

    if (viewOptions.displayFloatingText && this.eventFeed) {
      this.eventFeed.update(gameTime);
      this.eventFeed.renderPips(playerCtx, gameTime);
    }

    // Guided walkthrough: the step's emphasised units/buildings are lit IN the
    // 3D scene (emissive pulse + ground-glow halos) — applied earlier in this
    // frame via _renderGuideHighlights(), before the 3D renderers run. Here we
    // just advance the creep tour / check off the build-sequence list rows.
    if (this.guideMode) {
      if (this._guideCreepTour) this._advanceGuideCreepTour();   // hop camp→camp / land on the summary
      else this._updateGuideStepList(this.gameTime);
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

    // Dominance tug-of-war bar + match-header badges (self-throttled).
    if (this.dominanceBar) this.dominanceBar.update(gameTime);
  }


};

window.wc3v = new Wc3vViewer();
