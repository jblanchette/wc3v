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

  // Split-screen zoom: bbox-driven, clamped to playable viewExtent. The half is
  // short (ch/2) so the bbox height is what binds the zoom — keep the cluster
  // bbox TIGHT (small symmetric padding below) so a typical army frames at a
  // readable k≈3–5 instead of bottoming out at the floor with empty margins.
  const SPLIT_MIN_ZOOM = 3.0;
  const SPLIT_MAX_ZOOM = 8.0;
  const SPLIT_FILL = 0.9;        // fraction of the half-viewport the bbox occupies
  const SPLIT_PAD_FRAC = 0.18;   // breathing room around the force (fraction of extent)
  const SPLIT_PAD_MIN = 240;     // … with this world-unit floor (SYMMETRIC — no tilt band)
  const SPLIT_FOG_INSET = 384;   // world units kept inside viewExtent edge so the
                                 // FogOfWar feather (256 units) never bleeds in.
  const SPLIT_BBOX_MAX_FRAC = 0.42;  // safety cap on bbox extent vs viewExtent — an
                                     // unusually strung-out force is capped + pulled
                                     // back toward its centroid rather than zooming out.
  // Base/build-area framing (the opening: no mobile force yet → split on the two
  // bases). Bound the ACTUAL buildings + nearby workers so all the structures show
  // and the frame hugs them — a fixed box was far bigger than an early base's real
  // footprint, so it framed mostly empty terrain on a big (~16k-unit) map.
  const BASE_INCLUDE_RADIUS = 2200;  // include buildings/workers within this of the start (skip far expo/scout)
  const SPLIT_BASE_MIN_EXTENT = 1500; // floor on the base bbox so a 1-building base doesn't over-zoom

  // Intrusion / territory: when one player's unit reaches the ENEMY base region
  // (scouting, a proxy, an early all-in), that interaction is the story — break
  // the split and cut to it in single-view. Both-creep-own-camps stays split.
  // IMPORTANT: an intrusion is a FALLBACK story, not an override. A lone harasser
  // (a single skeleton poking the mining line) must NEVER steal the frame from a
  // real fight or from a hero leading an army on the field — when such field
  // action exists the intrusion is demoted (see _shouldShowIntrusion) and the
  // normal camera shows the army. The actual skirmish, if it happens, is picked
  // up by battle detection and framed/tagged as a battle in its own right.
  const INTRUSION_RADIUS = 2800;   // a unit within this of an enemy base counts as "in their territory"
  const INTRUSION_MIN_ZOOM = 3.2;  // single-view zoom floor when framing the intrusion
  const INTRUSION_MAX_ZOOM = 6.5;
  const INTRUSION_HARASS_WORKER_RADIUS = 750; // an intruder this close to an enemy worker = active harass (else a scout)
  // A field force that demotes a (hero-less) intrusion: a player's main anchor
  // with a hero AND at least this many units with it. Below this we treat the
  // map as "no real field action" and a base intrusion can still take the cut.
  const FIELD_ARMY_MIN_UNITS = 2;

  // Live activity measure (feeds AutoDirector's activityCap). We count the mobile
  // COMBAT units near the camera's current focus; more units on screen = more is
  // happening = slow the time-scale down. Tuned so a small skirmish/scout reads
  // as "some activity" and a full army clash saturates it.
  const ACTIVITY_RADIUS = 2600;    // world units around the focus we sample
  const ACTIVITY_FULL_UNITS = 9;   // this many mobile combat units near focus → activity 1.0

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

  // Split justification / stability (all in GAME time, ms). Together these stop
  // the split from flickering in for a fraction of a second:
  //   - DEBOUNCE: the want-condition must persist before we commit to a split.
  //   - MIN_DWELL: once split, hold at least this long (unless a fight erupts).
  //   - ENTER_LOOKAHEAD: don't open a split that a known-upcoming fight will cut
  //     short — if combat starts within this window, stay single and lead in.
  const SPLIT_ENTER_DEBOUNCE_MS = 800;
  const SPLIT_MIN_DWELL_MS = 6000;
  const SPLIT_ENTER_LOOKAHEAD_MS = 6000;

  // Per-player "main fighting force" used for BOTH the split decision (separation)
  // and the per-half framing. We cluster a player's mobile combat + hero units
  // and frame the single highest-value cluster — so a lone scout/worker straying
  // toward base or a fountain neither triggers a split nor steals the frame, and
  // (per design) a player with no real force isn't split at all (no base shots).
  const MAIN_FORCE_MERGE_DIST = 1300; // units within this of each other cluster together
  const HERO_GROUP_WEIGHT = 4;        // a hero ≈ 4 combat units when scoring clusters — a hero
                                      // WITH its army wins easily, but a lone idle hero loses to
                                      // a real army out on the map (show the action, not the base)
  const MIN_GROUP_UNITS = 2;          // a hero-less cluster needs ≥ this many to be "worth showing"

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
      this._separation = Infinity;     // min cross-player distance (main groups)
      this._lastGameTime = 0;          // for rewind detection
      this._speedFactor = 1;           // current playback speed (calm-when-fast)
      this._splitWantSince = null;     // gameTime the split want-condition began (entry debounce)
      this._splitEnteredAt = null;     // gameTime the split was committed (min-dwell)
      this._intrusionTarget = null;    // single-view focus when a player is in enemy territory
      this._intrusionKind = null;      // 'harass' | 'scout' — drives the on-screen tag
      this._activityLevel = 0;         // 0–1 on-screen unit activity for the last frame (feeds the time-scale)

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
      this._splitWantSince = null;
      this._splitEnteredAt = null;
      this._intrusionTarget = null;
      this._intrusionKind = null;
      this._activityLevel = 0;
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

    /** Whether the single view is currently framing a scout/intrusion interaction. */
    get isFramingIntrusion () {
      return !!this._intrusionTarget && this.mode === CameraMode.ACTION_FOCUS;
    }

    /** 'harass' | 'scout' | null — what the current intrusion cut is, for tagging. */
    get intrusionKind () {
      return this.isFramingIntrusion ? this._intrusionKind : null;
    }

    /**
     * Live 0–1 measure of on-screen unit activity for the last computed frame.
     * Fed to AutoDirector so the time-scale slows whenever units are actually
     * doing things in frame (army maneuvers, harass, creeping), not only during
     * a formally-detected battle.
     */
    get activityLevel () {
      return this._activityLevel;
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

      // Seek/rewind detection: a big jump in gameTime means the user scrubbed,
      // so reset the split entry-debounce / dwell timers — otherwise stale
      // timestamps from elsewhere in the match would make the split snap open or
      // refuse to close right after a jump. (Normal playback, even at 40x, never
      // advances this much in one frame.)
      if (this._lastGameTime != null && Math.abs(gameTime - this._lastGameTime) > 2500) {
        this._splitWantSince = null;
        this._splitEnteredAt = null;
      }

      // Per-player anchors: the main fighting force when one exists, else the
      // base (opening). Drive BOTH the split decision (separation) and the
      // per-half framing, so a lone scout/worker never triggers or steals a split.
      const anchors = this._computeAnchors(players, gameTime);
      this._separation = this._anchorSeparation(anchors);
      this._lastGameTime = gameTime;

      // ----- Auto-split decision (a sub-state of AUTO) -----
      // Reversible, but stabilized: enter only when the players are clearly apart
      // with a sustained lull (debounce + look-ahead so a split is actually worth
      // it), then hold a minimum dwell so it doesn't flicker. A live or imminent
      // fight always forces us out (and overrides the dwell) — show the action.
      // Territory: a unit in the enemy's base region (scout / proxy / all-in) is
      // the story — break the split and cut to it. Both-do-their-own-thing → no
      // intrusion → stay split. Stored for the single-view target (_actionFocus).
      // But an intrusion is a FALLBACK, not an override: _shouldShowIntrusion
      // demotes a lone harasser when a real fight or a hero-led field army is
      // happening (that action wins; the harass, if it matters, becomes a
      // battle). Only a surviving intrusion sets _intrusionTarget / the tag.
      const rawIntrusion = this._intrusionFocus(players, gameTime);
      if (this._shouldShowIntrusion(rawIntrusion, players, gameTime, anchors)) {
        this._intrusionTarget = rawIntrusion;
        this._intrusionKind = rawIntrusion.kind;
      } else {
        this._intrusionTarget = null;
        this._intrusionKind = null;
      }

      const wantSplit = !this._intrusionTarget &&
        this._evaluateAutoSplit(players, gameTime, this._separation, anchors);
      // What forces us out of a split even mid-dwell: a live/imminent fight, the
      // two heroes clustering (a clash starting), or a player intruding on the
      // enemy base (scout) — all override the dwell to cut to the interaction.
      const fightNow = !!(this._activeBattleBbox() || this._imminentBattle(gameTime) ||
        this._hasEngagedCluster(players) || this._intrusionTarget);

      // Track how long the want-condition has held (entry debounce, game time).
      if (wantSplit) {
        if (this._splitWantSince == null) this._splitWantSince = gameTime;
      } else {
        this._splitWantSince = null;
      }

      if (this.mode !== CameraMode.SPLIT_SCREEN) {
        const heldLongEnough = this._splitWantSince != null &&
          (gameTime - this._splitWantSince) >= SPLIT_ENTER_DEBOUNCE_MS;
        if (wantSplit && heldLongEnough) {
          this.setMode(CameraMode.SPLIT_SCREEN);     // begins entry animation
          this._splitEnteredAt = gameTime;
          this._logSplitEvent(gameTime, 'ENTER split');
        }
      } else if (wantSplit) {
        if (this._splitExiting) {
          this._splitExiting = false;                // reverse a partial exit
          this._splitEntering = true;
        }
      } else if (!this._splitExiting) {
        // Want to leave. Honor the minimum dwell UNLESS a fight is pulling us out
        // or the players have truly converged (both halves would frame the same
        // spot — no point holding the split, and a clash is likely next).
        const dwellSatisfied = this._splitEnteredAt == null ||
          (gameTime - this._splitEnteredAt) >= SPLIT_MIN_DWELL_MS;
        const converged = this._separation < SPLIT_EXIT_DISTANCE * 0.6;
        if (fightNow || converged || dwellSatisfied) {
          this._splitExiting = true;                 // begin exit animation
          this._splitEntering = false;
          this._logSplitEvent(gameTime,
            'EXIT split — ' + (fightNow ? 'fight/intrusion' : converged ? 'converged' : 'dwell-done'));
        }
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

      // Live activity for the time-scale: how busy the players' main forces are
      // (anchor-based, so a wide two-army overview reads as active even though
      // its centroid is empty midmap). Drives AutoDirector's activityCap so we
      // slow down whenever units are doing things, not only during a battle.
      this._activityLevel = this._forceActivityLevel(players, anchors);

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
      // Keep the last valid framing if a side momentarily has no framable force
      // (e.g. during the exit transition right after a wipe) so rendering never
      // breaks on a null target mid-animation.
      const t = this._splitScreenTargets(players, this.viewer.gameTime);
      if (t) this.splitTargets = t;
      this._initialized = true;
    }

    /**
     * Per-side camera target for the horizontal top/bottom split.
     *
     * For each player: bbox over its MAIN FIGHTING FORCE (the best cluster from
     * _playerAnchor — hero + army), pad it with a small SYMMETRIC margin, fit it
     * into the half-height viewport (cw × ch/2), then bake a vertical world offset
     * so it sits centered in that half. The center is clamped to gs.viewExtent so
     * fog never bleeds in. No base/opening framing, no scouts, no far buildings —
     * just the force, framed tight enough to actually read.
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
        const anchor = this._playerAnchor(player, gameTime);
        if (!anchor) return null;

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        const include = (x, y) => {
          if (x == null || isNaN(x) || y == null || isNaN(y)) return;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        };

        let baseN = 0;   // diagnostics: how many buildings/workers the base box bounded
        let chw = 0, chh = 0;   // real content half-extents (pre-floor/pad) for the centre-bias
        if (anchor.isBase || !anchor.group || !anchor.group.length) {
          // Opening / no force — bound the ACTUAL base: built buildings + nearby
          // workers within BASE_INCLUDE_RADIUS of the start, so all the structures
          // show and the frame hugs them (not a big empty fixed box). A far
          // expansion/scout is skipped by the radius.
          const sx = anchor.x, sy = anchor.y;
          const r2 = BASE_INCLUDE_RADIUS * BASE_INCLUDE_RADIUS;
          for (const u of (player.units || [])) {
            if (!u || u.currentX == null || isNaN(u.currentX)) continue;
            if (u.destroyedAt != null && gameTime != null && gameTime >= u.destroyedAt) continue;
            if (u.readyTime != null && gameTime != null && gameTime < u.readyTime) continue;
            if (u.isBuilding && u.isSummon) continue;
            const dx = u.currentX - sx, dy = u.currentY - sy;
            if (dx * dx + dy * dy > r2) continue;
            include(u.currentX, u.currentY);
            baseN++;
          }
          include(sx, sy);   // always anchor on the start (covers t≈0, nothing built yet)
          chw = (maxX - minX) / 2; chh = (maxY - minY) / 2;   // real building spread (pre-floor)

          // Floor the extent so a 1–2 building base doesn't over-zoom.
          const bcx = (minX + maxX) / 2, bcy = (minY + maxY) / 2;
          if (maxX - minX < SPLIT_BASE_MIN_EXTENT) { minX = bcx - SPLIT_BASE_MIN_EXTENT / 2; maxX = bcx + SPLIT_BASE_MIN_EXTENT / 2; }
          if (maxY - minY < SPLIT_BASE_MIN_EXTENT) { minY = bcy - SPLIT_BASE_MIN_EXTENT / 2; maxY = bcy + SPLIT_BASE_MIN_EXTENT / 2; }
        } else {
          for (const u of anchor.group) include(u.currentX, u.currentY);
          chw = (maxX - minX) / 2; chh = (maxY - minY) / 2;
        }
        if (minX === Infinity) return null;

        // Small SYMMETRIC padding so the force fills the half with a little
        // breathing room. (The old asymmetric south padding — for the main view's
        // 3D tilt — is what produced the big empty band below the units.)
        const padX = Math.max((maxX - minX) * SPLIT_PAD_FRAC, SPLIT_PAD_MIN);
        const padY = Math.max((maxY - minY) * SPLIT_PAD_FRAC, SPLIT_PAD_MIN);
        minX -= padX; maxX += padX;
        minY -= padY; maxY += padY;

        let cx = (minX + maxX) / 2;
        let cy = (minY + maxY) / 2;
        let w  = maxX - minX;
        let h  = maxY - minY;

        // Safety cap for an unusually strung-out force: cap the extent and pull
        // the center back toward the force CENTROID (not the base) so we stay
        // zoomed in on the bulk of it rather than zooming way out to fit a tail.
        const maxW = viewWorldW * SPLIT_BBOX_MAX_FRAC;
        const maxH = viewWorldH * SPLIT_BBOX_MAX_FRAC;
        if (w > maxW) { const t = maxW / w; cx = anchor.x + (cx - anchor.x) * t; w = maxW; }
        if (h > maxH) { const t = maxH / h; cy = anchor.y + (cy - anchor.y) * t; h = maxH; }

        return { cx, cy, w, h, anchor, baseN, chw, chh };
      };

      const box0 = buildBox(nonNeutral[0]);
      const box1 = buildBox(nonNeutral[1]);
      if (!box0 || !box1) return null;

      // Which player goes on top: the more-northern STARTING position (higher WC3
      // Y) takes the top half. Keyed off the start (not the live force centroid)
      // so a player keeps a stable half as their army roams — only the layout
      // slot is base-derived; the framing itself is force-based.
      const slotY = (p, box) => (p.startingPosition && p.startingPosition.y != null)
        ? p.startingPosition.y : box.cy;
      const topIdx = slotY(nonNeutral[0], box0) >= slotY(nonNeutral[1], box1) ? 0 : 1;
      const botIdx = 1 - topIdx;
      const boxes = [box0, box1];

      const vx0 = gs.viewExtent.x[0];
      const vx1 = gs.viewExtent.x[1];
      const vyN = gs.viewExtent.y[0];  // north (high Y in WC3)
      const vyS = gs.viewExtent.y[1];  // south (low Y)

      // Contested centre = midpoint of the two starts (≈ where the action heads).
      // Each half biases its framing toward it, so we show the playable/approach
      // side of the map instead of the dead corner behind the base. Falls back to
      // the viewExtent centre if a start is missing.
      const sp0 = nonNeutral[0].startingPosition, sp1 = nonNeutral[1].startingPosition;
      const contestedCx = (sp0 && sp1 && sp0.x != null && sp1.x != null)
        ? (sp0.x + sp1.x) / 2 : (vx0 + vx1) / 2;
      const contestedCy = (sp0 && sp1 && sp0.y != null && sp1.y != null)
        ? (sp0.y + sp1.y) / 2 : (vyN + vyS) / 2;

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

        // Centre-bias (base/opening framing only — a mobile force is its own
        // focus and is usually out toward the centre already). Shift toward the
        // contested centre by as much spare room as we have (keeping the actual
        // content + a SPLIT_PAD_MIN margin in frame), capped so we never overshoot
        // the centre. This pushes the base to its edge-side of the half and fills
        // the rest with the playable/approach map — no more framing the dead
        // corner behind the base.
        if (box.anchor && box.anchor.isBase) {
          const spareX = Math.max(0, halfVisW - box.chw - SPLIT_PAD_MIN);
          const spareY = Math.max(0, halfVisH - box.chh - SPLIT_PAD_MIN);
          const toCx = contestedCx - cx, toCy = contestedCy - cy;
          cx += Math.sign(toCx) * Math.min(Math.abs(toCx), spareX);
          cy += Math.sign(toCy) * Math.min(Math.abs(toCy), spareY);
        }

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

      const topTarget = computeTarget(boxes[topIdx], 'top');
      const botTarget = computeTarget(boxes[botIdx], 'bottom');

      // Debug: throttled per-side framing decision so a bad split (e.g. zoomed
      // onto a near-empty base) can be diagnosed from the console. Off unless
      // WC3V_CONFIG.logging.splitCamera is set.
      if (this._shouldLogSplit(gameTime)) {
        this._logSplit(gameTime,
          { side: 'TOP', player: nonNeutral[topIdx], box: boxes[topIdx], target: topTarget },
          { side: 'BOT', player: nonNeutral[botIdx], box: boxes[botIdx], target: botTarget });
      }

      return {
        top:     topTarget,
        bottom:  botTarget,
        players: [nonNeutral[topIdx], nonNeutral[botIdx]]
      };
    }

    // --- Split-screen debug logging (throttled by game time) ---

    _shouldLogSplit (gameTime) {
      const cfg = (typeof window !== 'undefined') && window.WC3V_CONFIG;
      if (!cfg || !cfg.logging || !cfg.logging.splitCamera) return false;
      if (this._lastSplitLogGt == null || Math.abs((gameTime || 0) - this._lastSplitLogGt) >= 600) {
        this._lastSplitLogGt = gameTime || 0;
        return true;
      }
      return false;
    }

    _splitSideDesc (side, player, box, target) {
      const a = box && box.anchor;
      const name = (player && player.displayName) || '?';
      let kind;
      if (!a) kind = 'null';
      else if (a.isBase) kind = `base(n=${box.baseN != null ? box.baseN : '?'})`;
      else kind = `force(n=${a.group ? a.group.length : 0},hero=${a.hasHero ? 'Y' : 'N'})`;
      const w = box ? Math.round(box.w) : 0;
      const h = box ? Math.round(box.h) : 0;
      const k = target ? target.k.toFixed(2) : '-';
      const cx = box ? Math.round(box.cx) : 0;
      const cy = box ? Math.round(box.cy) : 0;
      return `${side} ${name} ${kind} box=${w}x${h} k=${k} c=(${cx},${cy})`;
    }

    _logSplit (gameTime, top, bot) {
      const cfg = window.WC3V_CONFIG;
      const t = (gameTime / 1000).toFixed(1);
      const sep = isFinite(this._separation) ? Math.round(this._separation) : '∞';
      cfg.log('splitCamera',
        `[splitCam ${t}s] sep=${sep} | ${this._splitSideDesc(top.side, top.player, top.box, top.target)}` +
        ` | ${this._splitSideDesc(bot.side, bot.player, bot.box, bot.target)}`);
    }

    _logSplitEvent (gameTime, event) {
      const cfg = (typeof window !== 'undefined') && window.WC3V_CONFIG;
      if (!cfg || !cfg.logging || !cfg.logging.splitCamera) return;
      const sep = isFinite(this._separation) ? Math.round(this._separation) : '∞';
      cfg.log('splitCamera', `[splitCam ${(gameTime / 1000).toFixed(1)}s] ${event} (sep=${sep})`);
    }

    /**
     * Each non-neutral player's MAIN FIGHTING FORCE for this frame: cluster the
     * player's mobile combat + hero units by proximity, score each cluster
     * (heroes weighted heavily, plus combat count) and return the best one. This
     * is what both the split decision (separation) and the per-half framing use.
     *
     * Generalized — frame what the player is actually doing:
     *   - hero + army together  → one cluster, framed together
     *   - hero idle at base while the army is out → the army cluster can win
     *     (bigger score) so we follow the action, not the parked hero
     *   - a lone scout/worker drifting off → its own tiny cluster, loses the
     *     score, excluded from the frame
     *   - NO real force yet (the opening: just workers building) → fall back to
     *     the BASE/build area (isBase), so the early game splits on the two bases
     */
    _playerAnchor (player, gameTime) {
      if (!player || player.isNeutralPlayer) return null;

      const baseAnchor = () => {
        const sp = player.startingPosition;
        if (!sp || sp.x == null || isNaN(sp.x)) return null;
        return {
          x: sp.x, y: sp.y, playerId: player.playerId,
          hasHero: false, group: null, isBase: true, score: 0, showable: true
        };
      };

      // Mobile fighting units only — no workers, no buildings.
      const pts = [];
      const seen = new Set();
      const consider = (u, forceHero) => {
        if (!u || u.currentX == null || isNaN(u.currentX) || u.isBuilding) return;
        if (u.destroyedAt != null && gameTime != null && gameTime >= u.destroyedAt) return;
        if (u.readyTime != null && gameTime != null && gameTime < u.readyTime) return;
        const hero = forceHero || !!(u.meta && u.meta.hero);
        // Skip economy units — `meta.worker` (acolyte/peon/peasant/wisp) AND any
        // unit assigned a gold/lumber harvest role. The latter is the LUMBER
        // GHOUL: a fighting unit (meta.worker=false) doing economy at the tree
        // line. Without this, a pair of harvesting ghouls reads as a "force" and
        // the split zooms onto the trees (bug at ~1:10). Army ghouls have no
        // harvest role → still counted. _isHarvester() covers both cases.
        const isEconomy = (u.meta && u.meta.worker) ||
          (typeof u._isHarvester === 'function' && u._isHarvester());
        if (!hero && isEconomy) return;
        if (seen.has(u)) return;
        seen.add(u);
        pts.push({ x: u.currentX, y: u.currentY, hero, u });
      };
      for (const u of (player.units || [])) consider(u, false);
      for (const h of (player.heroes || [])) consider(h, true);  // heroes may live here too
      if (!pts.length) return baseAnchor();   // no mobile force → frame the base (opening)

      // Cluster by proximity (union-find; merge within MAIN_FORCE_MERGE_DIST).
      const parent = pts.map((_, i) => i);
      const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
      const md2 = MAIN_FORCE_MERGE_DIST * MAIN_FORCE_MERGE_DIST;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
          if (dx * dx + dy * dy <= md2) parent[find(i)] = find(j);
        }
      }
      const groups = {};
      for (let i = 0; i < pts.length; i++) {
        const r = find(i);
        (groups[r] || (groups[r] = [])).push(pts[i]);
      }

      // Score each cluster (heroes weighted) and keep the best = the main force.
      let best = null, bestScore = -1;
      for (const k in groups) {
        const g = groups[k];
        let heroes = 0;
        for (const p of g) if (p.hero) heroes++;
        const score = heroes * HERO_GROUP_WEIGHT + (g.length - heroes);
        if (score > bestScore) { bestScore = score; best = g; }
      }
      if (!best) return baseAnchor();

      let cx = 0, cy = 0, heroes = 0;
      for (const p of best) { cx += p.x; cy += p.y; if (p.hero) heroes++; }
      cx /= best.length; cy /= best.length;
      const combat = best.length - heroes;

      // A real force (a hero, or a multi-unit army) → frame it. Just one lone
      // straggler isn't worth framing as a "force" — show the base instead.
      if (heroes === 0 && combat < MIN_GROUP_UNITS) return baseAnchor();

      return {
        x: cx, y: cy, playerId: player.playerId,
        hasHero: heroes > 0, group: best.map(p => p.u), isBase: false,
        score: bestScore, showable: true
      };
    }

    _computeAnchors (players, gameTime) {
      const out = [];
      for (const player of players) {
        const a = this._playerAnchor(player, gameTime);
        if (a) out.push(a);
      }
      return out;
    }

    _anchorSeparation (anchors) {
      let minDist = Infinity;
      for (let i = 0; i < anchors.length; i++) {
        for (let j = i + 1; j < anchors.length; j++) {
          if (anchors[i].playerId === anchors[j].playerId) continue;
          const dx = anchors[i].x - anchors[j].x;
          const dy = anchors[i].y - anchors[j].y;
          minDist = Math.min(minDist, Math.sqrt(dx * dx + dy * dy));
        }
      }
      return minDist;
    }

    /**
     * Territory check: when a player has a unit inside the ENEMY base region
     * (a scout reaching the base, a proxy, an early all-in) that interaction is
     * a candidate story. Returns a descriptor of the raw intrusion (focus box +
     * makeup) or null when nobody is in enemy territory. This only DESCRIBES the
     * intrusion — whether it actually takes the camera is decided separately by
     * _shouldShowIntrusion (significance + demotion vs. real field action).
     *
     * Returned shape: { wx, wy, k, count, hasHero, hasNonSummon, kind } where
     * kind is 'harass' (an intruder is in among the enemy's workers) or 'scout'.
     * 1v1 — two players, two bases.
     */
    _intrusionFocus (players, gameTime) {
      const gs = this.viewer.gameScaler;
      if (!gs || !gs.viewExtent) return null;

      const nonNeutral = players.filter(p => p && !p.isNeutralPlayer);
      const bases = [];
      for (const p of nonNeutral) {
        const sp = p.startingPosition;
        if (sp && sp.x != null && !isNaN(sp.x)) bases.push({ id: p.playerId, x: sp.x, y: sp.y, owner: p });
      }
      if (bases.length < 2) return null;

      const R2 = INTRUSION_RADIUS * INTRUSION_RADIUS;
      const HW2 = INTRUSION_HARASS_WORKER_RADIUS * INTRUSION_HARASS_WORKER_RADIUS;
      const alive = (u) => u && u.currentX != null && !isNaN(u.currentX) && !u.isBuilding &&
        !(u.destroyedAt != null && gameTime != null && gameTime >= u.destroyedAt) &&
        !(u.readyTime != null && gameTime != null && gameTime < u.readyTime);

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let count = 0, hasHero = false, hasNonSummon = false, harass = false;
      const inc = (x, y) => {
        if (x == null || isNaN(x)) return;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      };

      for (const p of nonNeutral) {
        const enemies = bases.filter(b => b.id !== p.playerId);
        if (!enemies.length) continue;
        const seen = new Set();
        const scan = (u, forceHero) => {
          if (!alive(u) || seen.has(u)) return;
          // Nearest enemy base; counts as an intrusion if within the radius.
          let near = null, nearD2 = Infinity;
          for (const eb of enemies) {
            const d2 = (u.currentX - eb.x) * (u.currentX - eb.x) + (u.currentY - eb.y) * (u.currentY - eb.y);
            if (d2 < nearD2) { nearD2 = d2; near = eb; }
          }
          if (!near || nearD2 > R2) return;
          seen.add(u);
          inc(u.currentX, u.currentY);   // the intruder
          inc(near.x, near.y);           // the base it's poking (for context)
          count++;
          if (forceHero || (u.meta && u.meta.hero)) hasHero = true;
          if (!u.isSummon) hasNonSummon = true;
          // Active harass = an enemy (the base owner's) worker right next to the
          // intruder. Otherwise it's a scout just looking around the base region.
          if (!harass && near.owner) {
            for (const w of (near.owner.units || [])) {
              if (!alive(w) || !(w.meta && w.meta.worker)) continue;
              const dx = w.currentX - u.currentX, dy = w.currentY - u.currentY;
              if (dx * dx + dy * dy <= HW2) { harass = true; break; }
            }
          }
        };
        for (const u of (p.units || [])) scan(u, false);
        for (const h of (p.heroes || [])) scan(h, true);
      }
      if (!count) return null;

      // Fit the intrusion bbox to the full canvas (single-view), with padding.
      const padX = Math.max((maxX - minX) * 0.25, 500);
      const padY = Math.max((maxY - minY) * 0.25, 500);
      minX -= padX; maxX += padX; minY -= padY; maxY += padY;

      const focusX = (minX + maxX) / 2;
      const focusY = (minY + maxY) / 2;
      const viewWorldW = gs.viewExtent.x[1] - gs.viewExtent.x[0];
      const viewWorldH = Math.abs(gs.viewExtent.y[1] - gs.viewExtent.y[0]);
      const kX = viewWorldW / Math.max(1, maxX - minX);
      const kY = viewWorldH / Math.max(1, maxY - minY);
      const k = Math.max(INTRUSION_MIN_ZOOM, Math.min(INTRUSION_MAX_ZOOM, Math.min(kX, kY)));

      return { wx: focusX, wy: focusY, k, count, hasHero, hasNonSummon, kind: harass ? 'harass' : 'scout' };
    }

    /**
     * Decide whether a raw intrusion should actually take the camera this frame.
     * An intrusion is a fallback story, never an override:
     *   - Significance: the ONE thing that doesn't earn a cut is a single
     *     summoned unit just present in the base region (a lone skeleton). A real
     *     unit (incl. an opening worker scout), a squad, an active harasser, or a
     *     hero all qualify.
     *   - Demotion: even a qualifying intrusion loses to a live/imminent fight
     *     (which the battle path frames + tags) and to a hero leading an army on
     *     the field (show the army; the harass, if it matters, becomes a battle).
     *     A hero personally diving the base is itself the story and is exempt.
     */
    _shouldShowIntrusion (intr, players, gameTime, anchors) {
      if (!intr) return false;
      // Intrusion framing is a 1v1 story — team games / FFA use fit-all framing
      // and never cut to it, so don't set the target (or the tag) there.
      if (this.viewer.isNonOneVsOne && this.viewer.isNonOneVsOne()) return false;

      const loneSummon = intr.count === 1 && !intr.hasNonSummon && intr.kind !== 'harass';
      if (loneSummon) return false;

      // A hero personally diving is the story (and usually a battle too).
      if (intr.hasHero) return true;

      // A live or imminent fight outranks a base poke — let the battle path own it.
      if (this._activeBattleBbox() || this._imminentBattle(gameTime)) return false;

      // Real field action — a hero leading an army anywhere on the map — outranks
      // a lone harasser. Demote so the normal camera frames that army instead.
      for (const an of (anchors || [])) {
        if (an && !an.isBase && an.hasHero && an.group && an.group.length >= FIELD_ARMY_MIN_UNITS) {
          return false;
        }
      }
      return true;
    }

    /**
     * Live activity level (0–1) near a focus point: the count of mobile COMBAT
     * units (heroes + army + summons, NOT workers/buildings) within
     * ACTIVITY_RADIUS, normalized by ACTIVITY_FULL_UNITS. Fed to AutoDirector so
     * the time-scale eases down whenever units are doing things on screen.
     */
    _activityNear (players, fx, fy) {
      if (fx == null || isNaN(fx)) return 0;
      const r2 = ACTIVITY_RADIUS * ACTIVITY_RADIUS;
      const gt = this.viewer.gameTime;
      const alive = (u) => u && u.currentX != null && !isNaN(u.currentX) && !u.isBuilding &&
        !(u.destroyedAt != null && gt != null && gt >= u.destroyedAt) &&
        !(u.readyTime != null && gt != null && gt < u.readyTime);
      let count = 0;
      const seen = new Set();
      for (const p of players) {
        if (!p || p.isNeutralPlayer) continue;
        const scan = (u, isHero) => {
          if (!alive(u) || seen.has(u)) return;
          if (!isHero && u.meta && u.meta.worker) return;   // a mining line isn't "action"
          const dx = u.currentX - fx, dy = u.currentY - fy;
          if (dx * dx + dy * dy <= r2) { seen.add(u); count++; }
        };
        for (const u of (p.units || [])) scan(u, false);
        for (const h of (p.heroes || [])) scan(h, true);
      }
      return Math.max(0, Math.min(1, count / ACTIVITY_FULL_UNITS));
    }

    /** Overall force activity: the busier of the players' main forces. */
    _forceActivityLevel (players, anchors) {
      let best = 0;
      for (const a of (anchors || [])) {
        if (!a) continue;
        best = Math.max(best, this._activityNear(players, a.x, a.y));
      }
      return best;
    }

    _hasEngagedCluster (players) {
      const clusters = this._clusterHeroes(players);
      return clusters.some(c => c.playerIds.size > 1);
    }

    /**
     * Decide whether AUTO should be in its split sub-state this frame.
     * 1v1 only; never over a fight (active OR imminent); hysteresis band so it
     * doesn't flip-flop when separation hovers near the threshold. Entering
     * additionally requires a sustained lull (no fight within the look-ahead) and
     * both halves being worth showing (a hero or a real army, or the opening).
     */
    _evaluateAutoSplit (players, gameTime, separation, anchors) {
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

      const entering = this.mode !== CameraMode.SPLIT_SCREEN;

      // BOTH players must have a real fighting force to show — otherwise there is
      // nothing to put in one of the halves (no base/opening shots anymore). This
      // is required to stay split too: if a side's force is wiped, we fall out.
      const a = anchors || [];
      if (a.length < 2 || !a[0].showable || !a[1].showable) return false;

      // Look ahead on entry: don't open a split a known fight will cut short —
      // lead in single-view instead. (Replay = the future is known.)
      if (entering && this._battleStartsWithin(gameTime, SPLIT_ENTER_LOOKAHEAD_MS)) return false;

      // Hysteresis: harder to enter than to leave.
      const threshold = entering ? SPLIT_ENTER_DISTANCE : SPLIT_EXIT_DISTANCE;
      return separation > threshold;
    }

    // True if any detected battle STARTS within windowMs of gameTime (not yet
    // active). Generalizes _imminentBattle for the longer split-entry look-ahead.
    _battleStartsWithin (gameTime, windowMs) {
      const pb = this.viewer && this.viewer.processedBattles;
      if (!pb || !pb.battles || gameTime == null) return false;
      for (const b of pb.battles) {            // sorted ascending by startTime
        const dt = b.startTime - gameTime;
        if (dt <= 0) continue;
        if (dt > windowMs) break;
        return true;
      }
      return false;
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

      // Intrusion (a scout/proxy in the enemy base) is the single-view story
      // when there's no live fight — it's also what just broke the split, so the
      // camera glides onto the interaction instead of going blank in the opening.
      if (this._intrusionTarget && !this._activeBattleBbox()) {
        return this._intrusionTarget;
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
