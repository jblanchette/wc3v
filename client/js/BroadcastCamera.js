/**
 * BroadcastCamera — automatic camera modes built on D3 zoom.
 *
 * Computes a desired view (center point + zoom level) each frame and
 * drives D3 zoom via scaleTo/translateTo. Does not touch the Three.js
 * camera directly — syncTransform handles that from the D3 transform.
 *
 * Modes:
 *   ACTION_FOCUS  — the "AUTO" broadcast camera. Cluster-based: finds the most
 *                   interesting hero cluster / active battle and frames it,
 *                   leading the camera toward imminent fights via look-ahead.
 *                   AUTO also owns SPLIT as an automatic SUB-STATE: when (1v1
 *                   only) the two players are far apart with no fight active or
 *                   imminent, it cuts into a horizontal top/bottom split and
 *                   cuts back the moment they converge or a battle begins. The
 *                   opening phase (no heroes yet, bases far apart) splits naturally.
 *   SPLIT_SCREEN  — internal rendering state driven BY AUTO (no manual button).
 *                   Horizontal top/bottom split showing each player's area at
 *                   high zoom (north base on top, south base on bottom).
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
  // Smoothing — distance-scaled so big cuts feel responsive while small settles
  // stay glassy. Per-axis rate eases from *_MIN (target nearly reached) up to
  // *_MAX (target far away). Pan and zoom are tuned separately because abrupt
  // zoom reads worse than abrupt pan on a broadcast.
  const PAN_RATE_MIN = 0.055;
  const PAN_RATE_MAX = 0.17;
  const ZOOM_RATE_MIN = 0.045;
  const ZOOM_RATE_MAX = 0.11;
  const PAN_RATE_REF_PX = 900;   // css-px pan distance at which pan rate hits MAX
  const ZOOM_RATE_REF = 0.9;     // |Δk|/k at which zoom rate hits MAX
  const PAN_DEADZONE_PX = 3.5;   // ignore sub-pixel target jitter (anti-drift)

  // Calm-when-fast: during fast-forward (auto time-scale or a high manual speed)
  // widen the frame and damp the pan so skimming dead time isn't disorienting.
  const CALM_SPEED_LO = 3.0;     // at/below this speed: normal framing
  const CALM_SPEED_HI = 9.0;     // at/above this speed: full widen + calm
  const CALM_WIDEN_FRAC = 0.32;  // max zoom-out fraction applied to target.k
  const CALM_PAN_DAMP = 0.45;    // pan rate scaled down by up to this fraction

  // Cluster detection
  const CLUSTER_MERGE_DISTANCE = 2500;
  const CLUSTER_UNIT_RANGE = 1500;
  const ENGAGEMENT_BONUS = 100;
  const HERO_SCORE = 10;

  // Hysteresis: require a new cluster to win for N frames before switching
  const HYSTERESIS_FRAMES = 30;

  // Zoom limits — tuned for 3D units (native model scale reads small, so the
  // broadcast camera sits much closer than it did for the old 2D icons).
  // Zoom floors. Close framing is reserved for an ACTIVE BATTLE (frame the clash
  // tightly); the no-battle cluster/overview keeps a LOW floor so spread heroes /
  // both bases still fit (otherwise the camera zooms into the empty map center).
  // Loosened deliberately — the broadcast read better a little wider, showing
  // more of the surrounding fight than a tight crop on the clash centroid.
  const MIN_ZOOM_BATTLE = 7.0;    // active detected fight — frame the clash, but loose
  const MIN_ZOOM_SINGLE = 3.5;    // one player's cluster, no fight
  const MIN_ZOOM_OVERVIEW = 1.8;  // multi-player overview, no fight — wide
  const MAX_ZOOM = 16.0;
  const FOLLOW_HERO_ZOOM = 6.0;

  // Battle framing: expand the detected clash bbox before fitting so the fight
  // has breathing room (units pushed to the edge of the tracker box, incoming
  // reinforcements, retreat lanes all stay visible).
  const BATTLE_VIEW_PAD_FRAC = 0.30;

  // Look-ahead: this is a replay, so upcoming battles are KNOWN. Lead the camera
  // toward an imminent fight before it actually starts so the clash doesn't snap
  // into frame. Also used to suppress split-screen right before an engagement.
  const LOOKAHEAD_MS = 3000;        // how far ahead a battle counts as "imminent"
  const LOOKAHEAD_LEAD = 0.6;       // max fraction to pre-pan toward the fight
  const LOOKAHEAD_ZOOM_LEAD = 0.5;  // max fraction to pre-tighten zoom toward it

  // Split-screen zoom: bbox-driven, clamped to playable viewExtent
  const SPLIT_MIN_ZOOM = 2.5;
  const SPLIT_MAX_ZOOM = 10.0;
  const SPLIT_FILL = 0.88;       // fraction of the half-viewport the bbox occupies
  const SPLIT_FOG_INSET = 384;   // world units kept inside viewExtent edge so the
                                 // FogOfWar feather (256 units) never bleeds in.
  const SPLIT_BBOX_MAX_FRAC = 0.45;  // soft cap on bbox extent vs viewExtent — far-
                                     // out buildings/scouts pull camera but don't
                                     // force zoom-out past ~half the playable map.

  // Padding (fraction of bounding box extent) — bumped up for a looser frame.
  const PAD_X_FRAC = 0.20;
  const PAD_Y_TOP_FRAC = 0.20;
  const PAD_Y_BOT_FRAC = 0.30;
  const PAD_X_MIN = 350;
  const PAD_Y_TOP_MIN = 350;
  const PAD_Y_BOT_MIN = 500;

  // Split-screen auto-transition thresholds. Wide hysteresis band (enter ≫ exit)
  // so the split doesn't flip-flop when separation hovers near the boundary.
  const SPLIT_ENTER_DISTANCE = 3200;  // players must be this far apart to enter split
  const SPLIT_EXIT_DISTANCE = 2400;   // once split, stay until they're this close
  const SPLIT_TRANSITION_FRAMES = 30;  // frames (~0.5s) for the quick line-wipe cut

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

      // Split-screen state. Split is an automatic SUB-STATE of AUTO (ACTION_FOCUS),
      // not a user-selectable mode — it enters/exits continuously based on player
      // separation, with hysteresis, and is suppressed by active/imminent battles.
      this.splitTargets = null;        // { left: {wx,wy,k}, right: {wx,wy,k} }
      this._splitTransition = 0;       // 0→1 for entry, 1→0 for exit
      this._splitEntering = false;     // true during entry animation
      this._splitExiting = false;      // true during exit animation
      this._autoSplitEnabled = true;   // allow AUTO to enter split when appropriate
      this._separation = Infinity;     // min cross-player distance (heroes, or starts)
      this._lastGameTime = 0;          // for rewind detection
      this._speedFactor = 1;           // current playback speed (calm-when-fast)

      // Multi-listener emitter for mode changes. Existing single-callback
      // `onModeChange` keeps working (still invoked by _emitModeChange) so
      // call sites that assign `bc.onModeChange = fn` don't need to migrate.
      this.onModeChange = null;
      this._modeListeners = [];
    }

    on (event, fn) {
      if (event !== 'modechange' || typeof fn !== 'function') return;
      this._modeListeners.push(fn);
    }

    off (event, fn) {
      if (event !== 'modechange') return;
      const i = this._modeListeners.indexOf(fn);
      if (i >= 0) this._modeListeners.splice(i, 1);
    }

    _emitModeChange () {
      for (const fn of this._modeListeners) fn(this.mode);
      if (this.onModeChange) this.onModeChange(this.mode);
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
      this._separation = Infinity;
      this._lastGameTime = 0;
      this._speedFactor = 1;
      this._emitModeChange();
    }

    /**
     * Current playback speed, fed each frame by the viewer. When it climbs
     * (auto time-scale fast-forward, or a high manual speed) the AUTO camera
     * widens and calms its pan so skimming dead time stays watchable.
     */
    setSpeedFactor (speed) {
      const s = +speed;
      this._speedFactor = (isFinite(s) && s > 0) ? s : 1;
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
      }

      this._emitModeChange();
    }

    attachToZoom (zoom) {
      zoom.on('zoom.broadcast', () => {
        if (d3.event.sourceEvent && !this._isProgrammatic) {
          if (this._enabled && this.mode !== CameraMode.FREE) {
            this.mode = CameraMode.FREE;
            this._enabled = false;
            this._splitExiting = false;
            this._splitTransition = 0;
            this._emitModeChange();
          }
        }
      });
    }

    /** Returns true if the camera lerp has settled (for paused-state render loop control) */
    get settled () {
      if (this.mode === CameraMode.SPLIT_SCREEN) {
        return this._initialized && !this._splitExiting && !this._splitEntering;
      }
      // Pan threshold matches the smoothing deadzone — once the camera is within
      // PAN_DEADZONE_PX it stops chasing, so "settled" must accept that band or
      // the paused render loop would never sleep.
      return this._initialized &&
        Math.abs(this._lerpK - this._targetK) < 0.01 &&
        Math.abs(this._lerpCssX - this._targetCssX) < PAN_DEADZONE_PX &&
        Math.abs(this._lerpCssY - this._targetCssY) < PAN_DEADZONE_PX;
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

      // Player separation drives auto-split. Uses hero positions when available,
      // and falls back to starting positions for any player without a hero yet —
      // so the opening phase (no units, bases far apart) reads as "split".
      this._separation = this._computeSeparation(players);
      this._lastGameTime = gameTime;

      // ----- Auto-split decision (a sub-state of AUTO) -----
      // Continuous + reversible: enter when the players are clearly apart with
      // nothing happening, exit the instant a fight is active/imminent or they
      // converge. Hysteresis (distinct enter/exit thresholds) prevents toggling.
      const wantSplit = this._evaluateAutoSplit(players, gameTime, this._separation);

      if (wantSplit) {
        if (this.mode !== CameraMode.SPLIT_SCREEN) {
          this.setMode(CameraMode.SPLIT_SCREEN);     // begins entry animation
        } else if (this._splitExiting) {
          this._splitExiting = false;                // reverse a partial exit
          this._splitEntering = true;
        }
      } else if (this.mode === CameraMode.SPLIT_SCREEN && !this._splitExiting) {
        this._splitExiting = true;                   // begin exit animation
        this._splitEntering = false;
      }

      // Animate split entry transition (divider line wipes out from centre)
      if (this._splitEntering) {
        this._splitTransition = Math.min(1, this._splitTransition + (1 / SPLIT_TRANSITION_FRAMES));
        if (this._splitTransition >= 1) {
          this._splitEntering = false;
          this._splitTransition = 1;
        }
      }

      // Animate split exit transition (divider line retracts to centre)
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

      let target = this._computeTarget(players);
      if (!target) return;

      // Replay look-ahead: if a battle is about to start, lead the camera toward
      // it (and pre-tighten zoom) so the clash doesn't snap into frame. Skipped
      // while a battle is already active — _actionFocus already frames that one.
      target = this._applyLookAhead(target, players, gameTime);

      const gs = this.viewer.gameScaler;
      if (!gs || !gs.xScale) return;

      const ds = this.viewer.displayScale || 1;
      const cssPx = (gs.xScale(target.wx) + gs.middleX) * ds;
      const cssPy = (gs.yScale(target.wy) + gs.middleY) * ds;

      // Calm-when-fast: only the single AUTO view widens/damps with speed —
      // a followed hero stays tight. fast ∈ [0,1] from the current playback speed.
      const fast = (this.mode === CameraMode.ACTION_FOCUS)
        ? Math.max(0, Math.min(1, (this._speedFactor - CALM_SPEED_LO) / (CALM_SPEED_HI - CALM_SPEED_LO)))
        : 0;
      let targetK = Math.max(1.0, Math.min(16.0, target.k)); // outer safety clamp (per-mode MIN/MAX govern)
      if (fast > 0) targetK = Math.max(1.0, targetK * (1 - CALM_WIDEN_FRAC * fast));

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

      // --- Distance-scaled pan smoothing (with anti-drift deadzone) ---
      const dPanX = cssPx - this._lerpCssX;
      const dPanY = cssPy - this._lerpCssY;
      const panDist = Math.hypot(dPanX, dPanY);
      if (panDist >= PAN_DEADZONE_PX) {
        let panRate = PAN_RATE_MIN +
          (PAN_RATE_MAX - PAN_RATE_MIN) * Math.min(1, panDist / PAN_RATE_REF_PX);
        panRate *= (1 - CALM_PAN_DAMP * fast);   // calmer pan when fast-forwarding
        this._lerpCssX += dPanX * panRate;
        this._lerpCssY += dPanY * panRate;
      }

      // --- Distance-scaled zoom smoothing (gentler than pan) ---
      const dk = targetK - this._lerpK;
      const zoomFrac = Math.abs(dk) / Math.max(0.0001, this._lerpK);
      const zoomRate = ZOOM_RATE_MIN +
        (ZOOM_RATE_MAX - ZOOM_RATE_MIN) * Math.min(1, zoomFrac / ZOOM_RATE_REF);
      this._lerpK += dk * zoomRate;

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
     * Per-side camera target for the horizontal top/bottom split.
     *
     * For each player: build a content bbox (startingPosition + heroes +
     * active scouts), pick a zoom that fits the bbox into the player's
     * half-height viewport (cw × ch/2), then bake a vertical world offset so
     * the content sits centered in that half (translateTo lands the target at
     * canvas center; we want it at ch/4 / 3·ch/4). The content center is first
     * clamped to gs.viewExtent so the dark fog mesh never bleeds into the half.
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

      // Anti-fog floor: at this zoom the visible HALF (cw × ch/2) maps exactly
      // to viewExtent on the limiting axis. Below this, fog is unavoidable
      // regardless of how we pan. Above this, the clamp can keep the visible
      // half inside viewExtent and no fog leaks into view. The half is only
      // ch/2 tall, so the vertical floor is half what a full-canvas view needs.
      const kAntiFog = Math.max(cw / sw, (ch * 0.5) / sh);

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

      // Horizontal split: the more-northern base (higher WC3 Y) goes on TOP,
      // the more-southern base on the BOTTOM — keeps the on-screen layout
      // spatially intuitive (matches where each player actually sits on the map).
      const baseY = (p, box) => (p.startingPosition && p.startingPosition.y != null)
        ? p.startingPosition.y : box.cy;
      const topIdx = baseY(nonNeutral[0], box0) >= baseY(nonNeutral[1], box1) ? 0 : 1;
      const botIdx = 1 - topIdx;
      const boxes = [box0, box1];

      const vx0 = gs.viewExtent.x[0];
      const vx1 = gs.viewExtent.x[1];
      const vyN = gs.viewExtent.y[0];  // north (high Y in WC3)
      const vyS = gs.viewExtent.y[1];  // south (low Y)

      const computeTarget = (box, side) => {
        // Fit the bbox into a half-height viewport (full width × ch/2) with a
        // fill margin so content isn't framed hard against the divider.
        const pxW = cw * SPLIT_FILL;
        const pxH = (ch * 0.5) * SPLIT_FILL;
        const kFitX = (pxW * worldPerPxX) / box.w;
        const kFitY = (pxH * worldPerPxY) / box.h;
        const kFloor = Math.max(SPLIT_MIN_ZOOM, kAntiFog);
        const k = Math.max(kFloor,
                  Math.min(SPLIT_MAX_ZOOM, Math.min(kFitX, kFitY)));

        // Visible half-region half-extents (the half is cw wide × ch/2 tall,
        // centered on the content). Clamp the content center so this region —
        // plus the fog inset — stays inside viewExtent: no fog in the half.
        const halfVisW = (cw * 0.5) * worldPerPxX / k;
        const halfVisH = (ch * 0.25) * worldPerPxY / k;
        const insetW = halfVisW + SPLIT_FOG_INSET;
        const insetH = halfVisH + SPLIT_FOG_INSET;

        let cx = box.cx;
        let cy = box.cy;
        if (insetW * 2 >= viewWorldW) cx = (vx0 + vx1) / 2;
        else cx = Math.max(vx0 + insetW, Math.min(vx1 - insetW, cx));
        if (insetH * 2 >= viewWorldH) cy = (vyN + vyS) / 2;
        else cy = Math.max(vyS + insetH, Math.min(vyN - insetH, cy));

        // d3 translateTo lands (wx,wy) at canvas CENTER (ch/2). To center the
        // content in the player's half we offset the target by ch/4 in world
        // units so it sits at ch/4 (top) or 3·ch/4 (bottom). Baking it into the
        // world target keeps the 3D terrain and 2D overlays perfectly aligned.
        const offWorldY = (ch * 0.25) * worldPerPxY / k;
        const wx = cx;
        const wy = (side === 'top') ? (cy - offWorldY) : (cy + offWorldY);

        return { wx, wy, k };
      };

      return {
        top:     computeTarget(boxes[topIdx], 'top'),
        bottom:  computeTarget(boxes[botIdx], 'bottom'),
        players: [nonNeutral[topIdx], nonNeutral[botIdx]]
      };
    }

    /**
     * Min cross-player separation. One representative point per non-neutral
     * player: its first valid hero if it has one, else its starting position.
     * The starting-position fallback is what makes the OPENING split — before
     * heroes exist the bases are (always, in 1v1) far apart.
     */
    _computeSeparation (players) {
      const pts = [];
      for (const player of players) {
        if (!player || player.isNeutralPlayer) continue;
        let pt = null;
        for (const hero of (player.heroes || [])) {
          if (hero.currentX != null && !isNaN(hero.currentX)) {
            pt = { x: hero.currentX, y: hero.currentY };
            break;
          }
        }
        if (!pt && player.startingPosition &&
            player.startingPosition.x != null && !isNaN(player.startingPosition.x)) {
          pt = { x: player.startingPosition.x, y: player.startingPosition.y };
        }
        if (pt) { pt.playerId = player.playerId; pts.push(pt); }
      }

      let minDist = Infinity;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          if (pts[i].playerId === pts[j].playerId) continue;
          const dx = pts[i].x - pts[j].x;
          const dy = pts[i].y - pts[j].y;
          minDist = Math.min(minDist, Math.sqrt(dx * dx + dy * dy));
        }
      }
      return minDist;
    }

    _hasEngagedCluster (players) {
      const clusters = this._clusterHeroes(players);
      return clusters.some(c => c.playerIds.size > 1);
    }

    /**
     * Decide whether AUTO should be in its split sub-state this frame.
     * 1v1 only; never over a fight (active OR imminent); hysteresis band so it
     * doesn't flip-flop when separation hovers near the threshold.
     */
    _evaluateAutoSplit (players, gameTime, separation) {
      if (!this._autoSplitEnabled) return false;
      // Split only makes sense between two players — never in team games / FFA.
      if (this.viewer.isNonOneVsOne && this.viewer.isNonOneVsOne()) return false;
      // Only AUTO (or its own split sub-state) drives split — not FOLLOW/FREE.
      if (this.mode !== CameraMode.ACTION_FOCUS && this.mode !== CameraMode.SPLIT_SCREEN) {
        return false;
      }
      // Don't split into or across a fight we're showing or about to show.
      if (this._activeBattleBbox()) return false;
      if (this._imminentBattle(gameTime)) return false;
      if (this._hasEngagedCluster(players)) return false;

      // Hysteresis: harder to enter than to leave.
      const threshold = (this.mode === CameraMode.SPLIT_SCREEN)
        ? SPLIT_EXIT_DISTANCE
        : SPLIT_ENTER_DISTANCE;
      return separation > threshold;
    }

    /**
     * The nearest battle that STARTS within LOOKAHEAD_MS of gameTime (i.e. not
     * yet active). Returns { battle, dt, box } or null. Used both to lead the
     * camera into a fight and to suppress split-screen just before one.
     */
    _imminentBattle (gameTime) {
      const pb = this.viewer && this.viewer.processedBattles;
      if (!pb || !pb.battles || gameTime == null) return null;
      for (const b of pb.battles) {            // sorted ascending by startTime
        const dt = b.startTime - gameTime;
        if (dt <= 0) continue;                 // already started (handled as active)
        if (dt > LOOKAHEAD_MS) break;          // sorted → nothing sooner past here
        const box = pb.trackerBoxAt(b, b.startTime);  // first sample of the clash
        if (!box) continue;
        return { battle: b, dt, box };
      }
      return null;
    }

    /**
     * Blend a computed AUTO target toward an imminent battle. The closer the
     * battle's start, the more the camera pre-pans toward it and tightens zoom.
     * No-op when a battle is already active (that's framed directly).
     */
    _applyLookAhead (target, players, gameTime) {
      if (!target) return target;
      // Only the AUTO camera anticipates fights — FOLLOW_HERO must strictly
      // track its hero, not drift toward a clash elsewhere on the map.
      if (this.mode !== CameraMode.ACTION_FOCUS) return target;
      if (this._activeBattleBbox()) return target;  // already on the live fight
      const imminent = this._imminentBattle(gameTime);
      if (!imminent) return target;

      const box = imminent.box;
      const bx = (box.minX + box.maxX) / 2;
      const by = (box.minY + box.maxY) / 2;

      // lead: 0 at the far edge of the look-ahead window → 1 right as it starts.
      let lead = (LOOKAHEAD_MS - imminent.dt) / LOOKAHEAD_MS;
      lead = Math.max(0, Math.min(1, lead));
      lead = lead * lead * (3 - 2 * lead);          // smoothstep

      const panT = lead * LOOKAHEAD_LEAD;
      const wx = target.wx + (bx - target.wx) * panT;
      const wy = target.wy + (by - target.wy) * panT;

      // Pre-tighten zoom toward the battle floor as the fight nears.
      const zoomT = lead * LOOKAHEAD_ZOOM_LEAD;
      const k = target.k + (Math.max(target.k, MIN_ZOOM_BATTLE) - target.k) * zoomT;

      return { wx, wy, k };
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

    // Non-1v1 auto camera: there's no single "main fight" to track across
    // 4-8 players, so frame ALL the action — every non-neutral player's
    // heroes and mobile units. Buildings are excluded so a lone far-flung
    // expansion doesn't force a permanent map-out. Lower zoom floor than the
    // 1v1 paths so widely-spread players still all fit.
    _fitAllNonNeutral (players) {
      const FIT_ALL_MIN_ZOOM = 1.0;
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let any = false;

      for (const player of players) {
        if (!player || player.isNeutralPlayer) continue;
        for (const hero of (player.heroes || [])) {
          if (hero.currentX == null || isNaN(hero.currentX)) continue;
          minX = Math.min(minX, hero.currentX); maxX = Math.max(maxX, hero.currentX);
          minY = Math.min(minY, hero.currentY); maxY = Math.max(maxY, hero.currentY);
          any = true;
        }
        for (const unit of (player.units || [])) {
          if (unit.currentX == null || unit.isBuilding) continue;
          minX = Math.min(minX, unit.currentX); maxX = Math.max(maxX, unit.currentX);
          minY = Math.min(minY, unit.currentY); maxY = Math.max(maxY, unit.currentY);
          any = true;
        }
      }
      if (!any) return null;

      // Battle-aware framing for non-1v1: union the active battle's tracker
      // box. In team games / FFA this guarantees the active fight stays
      // framed even when one player is idle far away (which would otherwise
      // pull the "fit-all" rectangle out to the map edges and shrink the
      // battle into a pinpoint).
      const bbox = this._activeBattleBbox();
      if (bbox) {
        minX = Math.min(minX, bbox.minX);
        maxX = Math.max(maxX, bbox.maxX);
        minY = Math.min(minY, bbox.minY);
        maxY = Math.max(maxY, bbox.maxY);
      }

      const padX = (maxX - minX) * PAD_X_FRAC || PAD_X_MIN;
      const padYTop = (maxY - minY) * PAD_Y_TOP_FRAC || PAD_Y_TOP_MIN;
      const padYBot = (maxY - minY) * PAD_Y_BOT_FRAC || PAD_Y_BOT_MIN;
      minX -= padX; maxX += padX;
      maxY += padYTop; minY -= padYBot;

      const focusX = (minX + maxX) / 2;
      const focusY = (minY + maxY) / 2;
      const extentX = maxX - minX;
      const extentY = maxY - minY;

      const gs = this.viewer.gameScaler;
      if (!gs || !gs.viewExtent) return { wx: focusX, wy: focusY, k: FIT_ALL_MIN_ZOOM };

      const viewWorldW = gs.viewExtent.x[1] - gs.viewExtent.x[0];
      const viewWorldH = Math.abs(gs.viewExtent.y[1] - gs.viewExtent.y[0]);
      const kX = viewWorldW / extentX;
      const kY = viewWorldH / extentY;
      const k = Math.max(FIT_ALL_MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(kX, kY)));

      return { wx: focusX, wy: focusY, k };
    }

    _actionFocus (players) {
      // Non-1v1: deterministic "fit everything" framing — bypass cluster
      // scoring/hysteresis entirely (a single steady bound reads better for
      // team games than hopping between fights). The update() lerp still
      // smooths the motion.
      if (this.viewer.isNonOneVsOne && this.viewer.isNonOneVsOne()) {
        const all = this._fitAllNonNeutral(players);
        if (all) return all;
      }

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
    // Returns the tracker-box (interpolated at current gameTime) of whichever
    // battle is active right now, or null. When multiple battles overlap we
    // pick the most-recently-started — matches what the info panel shows.
    _activeBattleBbox () {
      const pb = this.viewer && this.viewer.processedBattles;
      if (!pb || !pb.activeAt) return null;
      const gt = this.viewer.gameTime;
      if (gt == null) return null;
      const active = pb.activeAt(gt);
      if (!active || !active.length) return null;
      const battle = active.reduce((a, b) => (b.startTime > a.startTime ? b : a));
      return pb.trackerBoxAt(battle, gt);
    }

    _computeClusterBounds (cluster, players) {
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZoom;

      const battleBbox = this._activeBattleBbox();
      if (battleBbox) {
        // ACTIVE FIGHT — frame the clash bbox and zoom in, but loosely: expand
        // the tracker box so reinforcements / retreats / spell range stay in
        // view rather than cropping tight on the clash centroid. (Still don't
        // union the whole cluster's spread units — that's what kept it too far.)
        const ex = (battleBbox.maxX - battleBbox.minX) * BATTLE_VIEW_PAD_FRAC;
        const ey = (battleBbox.maxY - battleBbox.minY) * BATTLE_VIEW_PAD_FRAC;
        minX = battleBbox.minX - ex; maxX = battleBbox.maxX + ex;
        minY = battleBbox.minY - ey; maxY = battleBbox.maxY + ey;
        minZoom = MIN_ZOOM_BATTLE;
      } else {
        // NO FIGHT — frame the hero cluster + nearby units as a wider overview.
        // Low floor so spread heroes / both bases at the start still fit (else the
        // camera zooms into the empty midpoint between bases).
        for (const entry of cluster.heroes) {
          minX = Math.min(minX, entry.x); maxX = Math.max(maxX, entry.x);
          minY = Math.min(minY, entry.y); maxY = Math.max(maxY, entry.y);
        }
        const cx = cluster.centroid.x, cy = cluster.centroid.y;
        for (const player of players) {
          if (!player.units || player.isNeutralPlayer) continue;
          for (const unit of player.units) {
            if (unit.currentX == null || unit.meta.hero || unit.isBuilding) continue;
            const dx = unit.currentX - cx, dy = unit.currentY - cy;
            if (Math.sqrt(dx * dx + dy * dy) < CLUSTER_UNIT_RANGE) {
              minX = Math.min(minX, unit.currentX); maxX = Math.max(maxX, unit.currentX);
              minY = Math.min(minY, unit.currentY); maxY = Math.max(maxY, unit.currentY);
            }
          }
        }
        if (minX === Infinity) { minX = maxX = cx; minY = maxY = cy; } // heroes-only fallback
        minZoom = cluster.playerIds.size > 1 ? MIN_ZOOM_OVERVIEW : MIN_ZOOM_SINGLE;
      }

      const padX = (maxX - minX) * PAD_X_FRAC || PAD_X_MIN;
      const padYTop = (maxY - minY) * PAD_Y_TOP_FRAC || PAD_Y_TOP_MIN;
      const padYBot = (maxY - minY) * PAD_Y_BOT_FRAC || PAD_Y_BOT_MIN;
      minX -= padX; maxX += padX;
      maxY += padYTop;  // WC3 Y: positive = north = top of screen
      minY -= padYBot;  // extra south padding for camera tilt

      const focusX = (minX + maxX) / 2;
      const focusY = (minY + maxY) / 2;
      const extentX = maxX - minX;
      const extentY = maxY - minY;

      const gs = this.viewer.gameScaler;
      if (!gs || !gs.viewExtent) return { wx: focusX, wy: focusY, k: minZoom };

      const viewWorldW = gs.viewExtent.x[1] - gs.viewExtent.x[0];
      const viewWorldH = Math.abs(gs.viewExtent.y[1] - gs.viewExtent.y[0]);
      const kX = viewWorldW / extentX;
      const kY = viewWorldH / extentY;
      const k = Math.max(minZoom, Math.min(MAX_ZOOM, Math.min(kX, kY)));

      return { wx: focusX, wy: focusY, k };
    }
  }

  BroadcastCamera.CameraMode = CameraMode;
  window.BroadcastCamera = BroadcastCamera;
  window.CameraMode = CameraMode;
})();
