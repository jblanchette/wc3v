/**
 * BroadcastCamera — automatic camera modes built on D3 zoom.
 *
 * Computes a desired view (center point + zoom level) each frame and
 * drives D3 zoom via scaleTo/translateTo. Does not touch the Three.js
 * camera directly — syncTransform handles that from the D3 transform.
 *
 * Modes:
 *   ACTION_FOCUS  — cluster-based: finds the most interesting hero cluster
 *                   and frames it tightly, ignoring distant idle heroes.
 *   SPLIT_SCREEN  — diagonal split showing each player's area at high zoom.
 *                   Auto-activates when heroes are far apart (early game).
 *   FOLLOW_HERO   — centers on a specific player's hero at fixed zoom.
 *   FREE          — manual user control, camera is not driven.
 */
(function () {
  const CameraMode = {
    FOLLOW_HERO:  'follow_hero',
    ACTION_FOCUS: 'action_focus',
    SPLIT_SCREEN: 'split_screen',
    FREE:         'free'
  };

  // --- Tuning constants ---
  const LERP_RATE = 0.05;

  // Cluster detection
  const CLUSTER_MERGE_DISTANCE = 2500;
  const CLUSTER_UNIT_RANGE = 1500;
  const ENGAGEMENT_BONUS = 100;
  const HERO_SCORE = 10;

  // Hysteresis: require a new cluster to win for N frames before switching
  const HYSTERESIS_FRAMES = 30;

  // Zoom limits
  const MIN_ZOOM_SINGLE = 2.0;   // single-player cluster — tight view
  const MIN_ZOOM_ENGAGED = 1.5;  // cross-player engagement — allow wider
  const MAX_ZOOM = 4.0;
  const FOLLOW_HERO_ZOOM = 2.5;

  // Split-screen zoom: bbox-driven, clamped to playable viewExtent
  const SPLIT_MIN_ZOOM = 1.5;
  const SPLIT_MAX_ZOOM = 3.5;
  const TRIANGLE_FILL = 0.85;    // fraction of half-canvas the bbox should occupy
  const SPLIT_FOG_INSET = 384;   // world units kept inside viewExtent edge so the
                                 // FogOfWar feather (256 units) never bleeds in.
  const SPLIT_BBOX_MAX_FRAC = 0.45;  // soft cap on bbox extent vs viewExtent — far-
                                     // out buildings/scouts pull camera but don't
                                     // force zoom-out past ~half the playable map.

  // Padding (fraction of bounding box extent)
  const PAD_X_FRAC = 0.15;
  const PAD_Y_TOP_FRAC = 0.15;
  const PAD_Y_BOT_FRAC = 0.25;
  const PAD_X_MIN = 350;
  const PAD_Y_TOP_MIN = 350;
  const PAD_Y_BOT_MIN = 500;

  // Split-screen auto-transition thresholds
  const SPLIT_ENTER_DISTANCE = 3000;  // heroes must be this far apart to enter split
  const SPLIT_EXIT_DISTANCE = 2500;   // heroes within this distance — exit split
  const SPLIT_TRANSITION_FRAMES = 150; // frames (~2.5s) for cinematic diagonal slide

  class BroadcastCamera {
    constructor (viewer) {
      this.viewer = viewer;
      this.mode = CameraMode.ACTION_FOCUS;
      this._followPlayerId = 0;
      this._enabled = true;
      this._isProgrammatic = false;

      this._lerpK = 1;
      this._lerpCssX = 0;
      this._lerpCssY = 0;
      this._initialized = false;

      // Cluster hysteresis state
      this._currentClusterKey = null;
      this._pendingClusterKey = null;
      this._switchCounter = 0;

      // Split-screen state
      this.splitTargets = null;        // { left: {wx,wy,k}, right: {wx,wy,k} }
      this._splitTransition = 0;       // 0→1 for entry, 1→0 for exit
      this._splitEntering = false;     // true during entry animation
      this._splitExiting = false;      // true during exit animation
      this._autoSplitEnabled = true;   // allow AUTO to enter split when appropriate
      this._manualSplit = false;       // true when user manually activated split
      this._hasAutoSplitFired = false; // true after first auto-split; prevents re-entry via AUTO
      this._heroDistance = Infinity;
      this._lastGameTime = 0;         // for rewind detection

      this.onModeChange = null;
    }

    reset () {
      this.mode = CameraMode.ACTION_FOCUS;
      this._followPlayerId = 0;
      this._enabled = true;
      this._isProgrammatic = false;
      this._lerpK = 1;
      this._lerpCssX = 0;
      this._lerpCssY = 0;
      this._initialized = false;
      this._currentClusterKey = null;
      this._pendingClusterKey = null;
      this._switchCounter = 0;
      this.splitTargets = null;
      this._splitTransition = 0;
      this._splitEntering = false;
      this._splitExiting = false;
      this._manualSplit = false;
      this._hasAutoSplitFired = false;
      this._heroDistance = Infinity;
      this._lastGameTime = 0;
      if (this.onModeChange) this.onModeChange(this.mode);
    }

    get enabled () { return this._enabled; }
    set enabled (v) {
      this._enabled = v;
      if (!v) this.mode = CameraMode.FREE;
    }

    setMode (mode, playerId) {
      const prevMode = this.mode;
      this.mode = mode;
      this._enabled = mode !== CameraMode.FREE;
      if (playerId !== undefined) this._followPlayerId = playerId;

      if (mode !== CameraMode.FREE) {
        this._initialized = false;
      }

      if (mode === CameraMode.SPLIT_SCREEN) {
        this._splitTransition = 0;
        this._splitEntering = true;
        this._splitExiting = false;
      }

      if (prevMode === CameraMode.SPLIT_SCREEN && mode !== CameraMode.SPLIT_SCREEN) {
        this._splitEntering = false;
        this._splitExiting = false;
        this._splitTransition = 0;
        this._manualSplit = false;
      }

      if (this.onModeChange) this.onModeChange(this.mode);
    }

    attachToZoom (zoom) {
      zoom.on('zoom.broadcast', () => {
        if (d3.event.sourceEvent && !this._isProgrammatic) {
          if (this._enabled && this.mode !== CameraMode.FREE) {
            this.mode = CameraMode.FREE;
            this._enabled = false;
            this._splitExiting = false;
            this._splitTransition = 0;
            if (this.onModeChange) this.onModeChange(this.mode);
          }
        }
      });
    }

    /** Returns true if the camera lerp has settled (for paused-state render loop control) */
    get settled () {
      if (this.mode === CameraMode.SPLIT_SCREEN) {
        return this._initialized && !this._splitExiting && !this._splitEntering;
      }
      return this._initialized &&
        Math.abs(this._lerpK - this._targetK) < 0.01 &&
        Math.abs(this._lerpCssX - this._targetCssX) < 0.5 &&
        Math.abs(this._lerpCssY - this._targetCssY) < 0.5;
    }

    /** Whether we are in split-screen mode (including transitions) */
    get isSplitActive () {
      return this.mode === CameraMode.SPLIT_SCREEN ||
        (this._splitExiting && this._splitTransition > 0);
    }

    /**
     * Split entry progress: 0 = not started, 1 = fully entered.
     * Split exit uses the reverse: 1 = full split, sliding toward 0.
     */
    get splitEntryProgress () {
      if (this._splitEntering) return this._splitTransition;
      if (this._splitExiting) return this._splitTransition;
      if (this.mode === CameraMode.SPLIT_SCREEN) return 1; // fully entered
      return 0;
    }

    update (gameTime, players) {
      if (!this._enabled || this.mode === CameraMode.FREE) return;

      // Compute hero distance for split-screen logic
      this._heroDistance = this._computeHeroDistance(players);

      // Rewind detection: if game time jumped backward, allow split to re-trigger
      if (gameTime < this._lastGameTime - 1000) {
        this._hasAutoSplitFired = false;
      }
      this._lastGameTime = gameTime;

      // Auto split-screen: only fires once after game starts (the initial entry).
      // After that, user must manually press SPLIT to re-enter.
      if (this.mode === CameraMode.ACTION_FOCUS && this._autoSplitEnabled &&
          this.viewer.hasBeenPlayedOnce && !this._hasAutoSplitFired) {
        if (this._heroDistance > SPLIT_ENTER_DISTANCE && !this._hasEngagedCluster(players)) {
          this._hasAutoSplitFired = true;
          this.setMode(CameraMode.SPLIT_SCREEN);
          // Fall through to split-screen update
        }
      }

      // Animate split entry transition (diagonal slides in)
      if (this._splitEntering) {
        this._splitTransition = Math.min(1, this._splitTransition + (1 / SPLIT_TRANSITION_FRAMES));
        if (this._splitTransition >= 1) {
          this._splitEntering = false;
          this._splitTransition = 1;
        }
      }

      // Handle split-screen exit when heroes converge (auto-split only)
      if (this.mode === CameraMode.SPLIT_SCREEN && !this._splitExiting &&
          !this._splitEntering && !this._manualSplit) {
        if (this._heroDistance < SPLIT_EXIT_DISTANCE) {
          this._splitExiting = true;
        }
      }

      // Animate split exit transition (diagonal slides out)
      if (this._splitExiting) {
        this._splitTransition = Math.max(0, this._splitTransition - (1 / SPLIT_TRANSITION_FRAMES));
        if (this._splitTransition <= 0) {
          this._splitExiting = false;
          this._splitTransition = 0;
          this.setMode(CameraMode.ACTION_FOCUS);
          // Continue with action focus this frame
        }
      }

      if (this.mode === CameraMode.SPLIT_SCREEN) {
        this._updateSplitScreen(players);
        return;
      }

      const target = this._computeTarget(players);
      if (!target) return;

      const gs = this.viewer.gameScaler;
      if (!gs || !gs.xScale) return;

      const ds = this.viewer.displayScale || 1;
      const cssPx = (gs.xScale(target.wx) + gs.middleX) * ds;
      const cssPy = (gs.yScale(target.wy) + gs.middleY) * ds;
      const targetK = Math.max(1.0, Math.min(6.0, target.k));

      // Store targets for settled check
      this._targetK = targetK;
      this._targetCssX = cssPx;
      this._targetCssY = cssPy;

      if (!this._initialized) {
        // Seed lerp values from the current viewer transform so the camera
        // glides from its current framing toward the target instead of snapping.
        // Falls back to target if d3 transform isn't available for any reason.
        this._lerpK = this.viewer.transform.k;
        const node = this.viewer.zoomContainer && this.viewer.zoomContainer.node();
        const curT = (node && window.d3 && d3.zoomTransform) ? d3.zoomTransform(node) : null;
        if (curT) {
          const rect = node.getBoundingClientRect();
          this._lerpCssX = curT.invertX(rect.width / 2);
          this._lerpCssY = curT.invertY(rect.height / 2);
        } else {
          this._lerpCssX = cssPx;
          this._lerpCssY = cssPy;
        }
        this._initialized = true;
      }

      this._lerpK += (targetK - this._lerpK) * LERP_RATE;
      this._lerpCssX += (cssPx - this._lerpCssX) * LERP_RATE;
      this._lerpCssY += (cssPy - this._lerpCssY) * LERP_RATE;

      this._isProgrammatic = true;
      this.viewer.zoomContainer.call(this.viewer.zoom.scaleTo, this._lerpK);
      this.viewer.zoomContainer.call(this.viewer.zoom.translateTo, this._lerpCssX, this._lerpCssY);
      this._isProgrammatic = false;
    }

    // ---------------------------------------------------------------
    //  Split-screen helpers
    // ---------------------------------------------------------------

    _updateSplitScreen (players) {
      this.splitTargets = this._splitScreenTargets(players, this.viewer.gameTime);
      this._initialized = true;
    }

    /**
     * Per-side camera target for diagonal split.
     *
     * For each player: build a content bbox (startingPosition + heroes +
     * active scouts), pick a zoom that fits the bbox into the player's
     * triangular half, apply a corner shift so the bbox sits in that half,
     * then clamp the visible rect to gs.viewExtent so the dark fog mesh
     * never bleeds inside the visible triangle.
     */
    _splitScreenTargets (players, gameTime) {
      const nonNeutral = players.filter(p => !p.isNeutralPlayer);
      if (nonNeutral.length < 2) return null;

      const gs = this.viewer.gameScaler;
      if (!gs || !gs.viewExtent) return null;

      const canvas = this.viewer.canvas;
      const cw = canvas && canvas.width;
      const ch = canvas && canvas.height;
      if (!cw || !ch) return null;

      // World↔canvas conversion: d3 xScale.range is gs.sceneImage (the playable
      // area's pixel size), NOT the canvas pixel buffer. When canvas is larger
      // than sceneImage, the extra pixels render fog from outside viewExtent —
      // mixing cw with viewWorldW underestimates how much world the camera
      // actually shows and the fog clamp comes up short.
      const sw = (gs.sceneImage && gs.sceneImage.width)  || cw;
      const sh = (gs.sceneImage && gs.sceneImage.height) || ch;
      const viewWorldW = gs.viewExtent.x[1] - gs.viewExtent.x[0];
      const viewWorldH = Math.abs(gs.viewExtent.y[1] - gs.viewExtent.y[0]);
      const worldPerPxX = viewWorldW / sw;
      const worldPerPxY = viewWorldH / sh;

      // Anti-fog floor: at this zoom, the canvas pixel buffer maps exactly
      // to viewExtent on the limiting axis. Below this, fog is unavoidable
      // regardless of how we pan. Above this, the clamp can keep the visible
      // rect inside viewExtent and no fog leaks into view.
      const kAntiFog = Math.max(cw / sw, ch / sh);

      const buildBox = (player) => {
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        const include = (x, y) => {
          if (x == null || isNaN(x) || y == null || isNaN(y)) return;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        };

        if (player.startingPosition) {
          include(player.startingPosition.x, player.startingPosition.y);
        }
        if (player.heroes) {
          for (const hero of player.heroes) include(hero.currentX, hero.currentY);
        }
        if (player.units && gameTime != null) {
          for (const unit of player.units) {
            const built = unit.readyTime == null || gameTime >= unit.readyTime;
            const dead  = unit.destroyedAt != null && gameTime >= unit.destroyedAt;

            // Buildings: include all alive non-summon constructions so far-out
            // builds (e.g. NE Ancient of War near a creep camp) pull the camera.
            // Position is fixed at spawn (update() early-exits for buildings),
            // so currentX/currentY is the construction location.
            if (unit.isBuilding && !unit.isSummon && built && !dead &&
                unit.currentX != null && !isNaN(unit.currentX)) {
              include(unit.currentX, unit.currentY);
            }

            // Active scouts (server-flagged, same predicate as the SCOUT badge)
            if (unit.scoutInfo && !unit._scoutEnded && gameTime >= unit.scoutInfo.gameTime) {
              if (unit.currentX != null && !isNaN(unit.currentX)) {
                include(unit.currentX, unit.currentY);
              } else if (unit.scoutInfo.position) {
                include(unit.scoutInfo.position.x, unit.scoutInfo.position.y);
              }
            }
          }
        }

        if (minX === Infinity) return null;

        const extentX = maxX - minX;
        const extentY = maxY - minY;
        const padX    = Math.max(extentX * PAD_X_FRAC,     PAD_X_MIN);
        const padYTop = Math.max(extentY * PAD_Y_TOP_FRAC, PAD_Y_TOP_MIN);
        const padYBot = Math.max(extentY * PAD_Y_BOT_FRAC, PAD_Y_BOT_MIN);
        minX -= padX;
        maxX += padX;
        maxY += padYTop;  // WC3 Y: positive = north (top of screen)
        minY -= padYBot;

        let cx = (minX + maxX) / 2;
        let cy = (minY + maxY) / 2;
        let w  = maxX - minX;
        let h  = maxY - minY;

        // Soft cap: when an outlier (creep-camp ancient, deep-map scout) blows
        // the bbox out, don't zoom out to fit it. Cap extent at SPLIT_BBOX_MAX_FRAC
        // of viewExtent and pull the center back toward the player's base, so
        // the camera pans toward the outlier but stays meaningfully zoomed.
        const maxW = viewWorldW * SPLIT_BBOX_MAX_FRAC;
        const maxH = viewWorldH * SPLIT_BBOX_MAX_FRAC;
        const baseX = player.startingPosition ? player.startingPosition.x : cx;
        const baseY = player.startingPosition ? player.startingPosition.y : cy;
        if (w > maxW) {
          const t = maxW / w;          // shrinkage factor
          cx = baseX + (cx - baseX) * t;
          w = maxW;
        }
        if (h > maxH) {
          const t = maxH / h;
          cy = baseY + (cy - baseY) * t;
          h = maxH;
        }

        return { cx, cy, w, h };
      };

      const box0 = buildBox(nonNeutral[0]);
      const box1 = buildBox(nonNeutral[1]);
      if (!box0 || !box1) return null;

      // Diagonal goes top-right → bottom-left:
      //   top-left half  = base more north-west (low x, high y → low x-y)
      //   bot-right half = base more south-east (high x, low y → high x-y)
      const score0 = box0.cx - box0.cy;
      const score1 = box1.cx - box1.cy;
      const topLeftIdx = score0 <= score1 ? 0 : 1;
      const botRightIdx = 1 - topLeftIdx;
      const boxes = [box0, box1];

      const computeTarget = (box, side) => {
        // Triangle effective viewport ≈ half-canvas with margin so units
        // near the diagonal divider aren't framed right at the edge.
        const triPxW = cw * 0.5 * TRIANGLE_FILL;
        const triPxH = ch * 0.5 * TRIANGLE_FILL;
        const kFitX = (triPxW * worldPerPxX) / box.w;
        const kFitY = (triPxH * worldPerPxY) / box.h;
        const kFloor = Math.max(SPLIT_MIN_ZOOM, kAntiFog);
        const k = Math.max(kFloor,
                  Math.min(SPLIT_MAX_ZOOM, Math.min(kFitX, kFitY)));

        // Corner shift: push focus into the player's triangle.
        // d3 translateTo puts the target world point at canvas center —
        // shifting the target away from the bbox center makes the bbox
        // appear off-center on the opposite side (into the player's half).
        const ofsX = (cw / 6) * worldPerPxX / k;
        const ofsY = (ch / 6) * worldPerPxY / k;
        let wx, wy;
        if (side === 'left') {
          wx = box.cx + ofsX;  // visible center east of bbox → bbox sits west
          wy = box.cy - ofsY;  // visible center south of bbox → bbox sits north
        } else {
          wx = box.cx - ofsX;
          wy = box.cy + ofsY;
        }

        // Clamp visible rect to viewExtent so fog never leaks inside the triangle.
        const halfVisW = (cw * worldPerPxX) / k / 2;
        const halfVisH = (ch * worldPerPxY) / k / 2;
        const vx0 = gs.viewExtent.x[0];
        const vx1 = gs.viewExtent.x[1];
        const vyN = gs.viewExtent.y[0];  // north (high Y in WC3)
        const vyS = gs.viewExtent.y[1];  // south (low Y)

        // Inset by SPLIT_FOG_INSET so the FogOfWar feather (256 world units
        // INTO viewExtent) doesn't darken the visible edge of the triangle.
        const insetW = halfVisW + SPLIT_FOG_INSET;
        const insetH = halfVisH + SPLIT_FOG_INSET;
        if (insetW * 2 >= viewWorldW) {
          wx = (vx0 + vx1) / 2;
        } else {
          wx = Math.max(vx0 + insetW, Math.min(vx1 - insetW, wx));
        }
        if (insetH * 2 >= viewWorldH) {
          wy = (vyN + vyS) / 2;
        } else {
          wy = Math.max(vyS + insetH, Math.min(vyN - insetH, wy));
        }

        return { wx, wy, k };
      };

      return {
        left:    computeTarget(boxes[topLeftIdx],  'left'),
        right:   computeTarget(boxes[botRightIdx], 'right'),
        players: [nonNeutral[topLeftIdx], nonNeutral[botRightIdx]]
      };
    }

    _computeHeroDistance (players) {
      const heroes = [];
      for (const player of players) {
        if (!player.heroes || player.isNeutralPlayer) continue;
        for (const hero of player.heroes) {
          if (hero.currentX != null && !isNaN(hero.currentX)) {
            heroes.push({ x: hero.currentX, y: hero.currentY, playerId: player.playerId });
          }
        }
      }
      // Find min distance between heroes of different players
      let minDist = Infinity;
      for (let i = 0; i < heroes.length; i++) {
        for (let j = i + 1; j < heroes.length; j++) {
          if (heroes[i].playerId === heroes[j].playerId) continue;
          const dx = heroes[i].x - heroes[j].x;
          const dy = heroes[i].y - heroes[j].y;
          minDist = Math.min(minDist, Math.sqrt(dx * dx + dy * dy));
        }
      }
      return minDist;
    }

    _hasEngagedCluster (players) {
      const clusters = this._clusterHeroes(players);
      return clusters.some(c => c.playerIds.size > 1);
    }

    // ---------------------------------------------------------------
    //  Target computation dispatch
    // ---------------------------------------------------------------

    _computeTarget (players) {
      if (this.mode === CameraMode.FOLLOW_HERO) return this._followHero(players);
      if (this.mode === CameraMode.ACTION_FOCUS) return this._actionFocus(players);
      return null;
    }

    _followHero (players) {
      const player = players[this._followPlayerId];
      if (!player || !player.heroes || !player.heroes.length) return null;

      const hero = player.heroes[0];
      if (hero.currentX == null || isNaN(hero.currentX)) return null;

      return { wx: hero.currentX, wy: hero.currentY, k: FOLLOW_HERO_ZOOM };
    }

    // ---------------------------------------------------------------
    //  Cluster-based ACTION_FOCUS
    // ---------------------------------------------------------------

    _actionFocus (players) {
      const clusters = this._clusterHeroes(players);
      if (clusters.length === 0) return null;

      // If any cluster has cross-player engagement, focus on that cluster.
      // Otherwise, frame ALL heroes together (wide overview).
      const hasEngagement = clusters.some(c => c.playerIds.size > 1);

      if (hasEngagement) {
        // Score each cluster and pick the best
        for (const cluster of clusters) {
          cluster.score = this._scoreCluster(cluster, players);
        }
        const best = this._selectBestCluster(clusters);
        if (!best) return null;
        return this._computeClusterBounds(best, players);
      }

      // No engagement — frame all heroes together with the wider zoom floor
      const allHeroes = { heroes: [], playerIds: new Set(), key: 'all' };
      for (const cluster of clusters) {
        for (const h of cluster.heroes) allHeroes.heroes.push(h);
        for (const pid of cluster.playerIds) allHeroes.playerIds.add(pid);
      }
      allHeroes.centroid = {
        x: allHeroes.heroes.reduce((s, h) => s + h.x, 0) / allHeroes.heroes.length,
        y: allHeroes.heroes.reduce((s, h) => s + h.y, 0) / allHeroes.heroes.length
      };
      return this._computeClusterBounds(allHeroes, players);
    }

    /**
     * Group heroes into clusters by proximity.
     * Two heroes within CLUSTER_MERGE_DISTANCE are merged into one cluster.
     */
    _clusterHeroes (players) {
      const heroEntries = [];
      for (const player of players) {
        if (!player.heroes || player.isNeutralPlayer) continue;
        for (const hero of player.heroes) {
          if (hero.currentX == null || isNaN(hero.currentX)) continue;
          heroEntries.push({
            x: hero.currentX,
            y: hero.currentY,
            playerId: player.playerId,
            hero
          });
        }
      }

      if (heroEntries.length === 0) return [];

      // Greedy merge: assign each hero to a cluster, merge clusters when
      // any pair of heroes from different clusters is within merge distance
      const clusterOf = heroEntries.map((_, i) => i); // union-find parent

      const find = (i) => {
        while (clusterOf[i] !== i) { clusterOf[i] = clusterOf[clusterOf[i]]; i = clusterOf[i]; }
        return i;
      };
      const union = (a, b) => { clusterOf[find(a)] = find(b); };

      for (let i = 0; i < heroEntries.length; i++) {
        for (let j = i + 1; j < heroEntries.length; j++) {
          const dx = heroEntries[i].x - heroEntries[j].x;
          const dy = heroEntries[i].y - heroEntries[j].y;
          if (Math.sqrt(dx * dx + dy * dy) < CLUSTER_MERGE_DISTANCE) {
            union(i, j);
          }
        }
      }

      // Group by root
      const groups = {};
      for (let i = 0; i < heroEntries.length; i++) {
        const root = find(i);
        if (!groups[root]) groups[root] = [];
        groups[root].push(heroEntries[i]);
      }

      // Build cluster objects
      return Object.values(groups).map(entries => {
        let cx = 0, cy = 0;
        const playerIds = new Set();
        for (const e of entries) {
          cx += e.x;
          cy += e.y;
          playerIds.add(e.playerId);
        }
        cx /= entries.length;
        cy /= entries.length;

        // Stable key: sorted by objectId1 for deterministic ordering
        const key = entries.map(e => e.hero.objectId1 || '').sort().join(',');

        return {
          heroes: entries,
          centroid: { x: cx, y: cy },
          playerIds,
          key,
          score: 0
        };
      });
    }

    /**
     * Score a cluster: engagement > unit density > hero count.
     */
    _scoreCluster (cluster, players) {
      let score = 0;

      // Cross-player engagement is always the most interesting
      if (cluster.playerIds.size > 1) {
        score += ENGAGEMENT_BONUS;
      }

      // Hero count
      score += cluster.heroes.length * HERO_SCORE;

      // Count nearby non-hero units
      const cx = cluster.centroid.x;
      const cy = cluster.centroid.y;
      for (const player of players) {
        if (!player.units || player.isNeutralPlayer) continue;
        for (const unit of player.units) {
          if (unit.currentX == null || unit.meta.hero || unit.isBuilding) continue;
          const dx = unit.currentX - cx;
          const dy = unit.currentY - cy;
          if (Math.sqrt(dx * dx + dy * dy) < CLUSTER_UNIT_RANGE) {
            score += 1;
          }
        }
      }

      return score;
    }

    /**
     * Pick best cluster with hysteresis to prevent flip-flopping.
     */
    _selectBestCluster (clusters) {
      if (clusters.length === 0) return null;
      if (clusters.length === 1) {
        this._currentClusterKey = clusters[0].key;
        this._pendingClusterKey = null;
        this._switchCounter = 0;
        return clusters[0];
      }

      // Find highest scoring cluster
      let best = clusters[0];
      for (let i = 1; i < clusters.length; i++) {
        if (clusters[i].score > best.score) best = clusters[i];
      }

      // If the best cluster is the current one, reset pending
      if (best.key === this._currentClusterKey) {
        this._pendingClusterKey = null;
        this._switchCounter = 0;
        return best;
      }

      // If this is the first frame (no current cluster), snap immediately
      if (!this._currentClusterKey) {
        this._currentClusterKey = best.key;
        return best;
      }

      // Hysteresis: require the new best to win for N consecutive frames
      if (best.key === this._pendingClusterKey) {
        this._switchCounter++;
      } else {
        this._pendingClusterKey = best.key;
        this._switchCounter = 1;
      }

      if (this._switchCounter >= HYSTERESIS_FRAMES) {
        this._currentClusterKey = best.key;
        this._pendingClusterKey = null;
        this._switchCounter = 0;
        return best;
      }

      // Stay with current cluster until hysteresis triggers
      const current = clusters.find(c => c.key === this._currentClusterKey);
      return current || best;
    }

    /**
     * Compute bounding box and zoom from the selected cluster + nearby units.
     */
    _computeClusterBounds (cluster, players) {
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;

      // Include all heroes in the selected cluster
      for (const entry of cluster.heroes) {
        minX = Math.min(minX, entry.x);
        maxX = Math.max(maxX, entry.x);
        minY = Math.min(minY, entry.y);
        maxY = Math.max(maxY, entry.y);
      }

      // Include nearby non-hero units within cluster range
      const cx = cluster.centroid.x;
      const cy = cluster.centroid.y;
      for (const player of players) {
        if (!player.units || player.isNeutralPlayer) continue;
        for (const unit of player.units) {
          if (unit.currentX == null || unit.meta.hero || unit.isBuilding) continue;
          const dx = unit.currentX - cx;
          const dy = unit.currentY - cy;
          if (Math.sqrt(dx * dx + dy * dy) < CLUSTER_UNIT_RANGE) {
            minX = Math.min(minX, unit.currentX);
            maxX = Math.max(maxX, unit.currentX);
            minY = Math.min(minY, unit.currentY);
            maxY = Math.max(maxY, unit.currentY);
          }
        }
      }

      // Tighter padding than the old approach
      const padX = (maxX - minX) * PAD_X_FRAC || PAD_X_MIN;
      const padYTop = (maxY - minY) * PAD_Y_TOP_FRAC || PAD_Y_TOP_MIN;
      const padYBot = (maxY - minY) * PAD_Y_BOT_FRAC || PAD_Y_BOT_MIN;
      minX -= padX;
      maxX += padX;
      maxY += padYTop;  // WC3 Y: positive = north = top of screen
      minY -= padYBot;  // extra south padding for camera tilt

      const focusX = (minX + maxX) / 2;
      const focusY = (minY + maxY) / 2;
      const extentX = maxX - minX;
      const extentY = maxY - minY;

      // Zoom relative to the camera view extent
      const gs = this.viewer.gameScaler;
      if (!gs || !gs.viewExtent) return { wx: focusX, wy: focusY, k: MIN_ZOOM_SINGLE };

      const viewWorldW = gs.viewExtent.x[1] - gs.viewExtent.x[0];
      const viewWorldH = Math.abs(gs.viewExtent.y[1] - gs.viewExtent.y[0]);
      const kX = viewWorldW / extentX;
      const kY = viewWorldH / extentY;

      // Use tighter min zoom for single-player clusters
      const minZoom = cluster.playerIds.size > 1 ? MIN_ZOOM_ENGAGED : MIN_ZOOM_SINGLE;
      const k = Math.max(minZoom, Math.min(MAX_ZOOM, Math.min(kX, kY)));

      return { wx: focusX, wy: focusY, k };
    }
  }

  BroadcastCamera.CameraMode = CameraMode;
  window.BroadcastCamera = BroadcastCamera;
  window.CameraMode = CameraMode;
})();
