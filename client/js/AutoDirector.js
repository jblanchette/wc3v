/**
 * AutoDirector — dynamic playback time-scale for the "AUTO" speed mode.
 *
 * 1v1 ONLY. When the scrubber speed is set to AUTO, the main loop asks this
 * director for a playback multiplier each frame instead of using a fixed speed.
 * The director speeds the replay up through dead time and ramps it back toward
 * 1× as something worth watching approaches — a broadcast "highlight pacing".
 *
 * Pacing model (the slowest applicable cap wins, so any reason to slow down
 * takes precedence):
 *   battleCap    — 1× inside a detected battle; ramps in over a pre-roll window
 *                  (lead the fight) and eases back out over a short post-roll.
 *   eventCap     — eases toward ~1× around MAJOR chapter moments (hero deaths,
 *                  expansions, tier-ups, key teleports/town attacks).
 *   densityCap   — between those, base speed comes from macro-event density:
 *                  busy build/tech periods play a touch slower than idle ones.
 *   activityCap  — a LIVE signal fed in each frame (from the camera): when units
 *                  are actually on screen doing things — armies maneuvering,
 *                  harassing, creeping — we slow down even with no formal battle
 *                  or macro event. This is what keeps the replay from skimming
 *                  past everything that isn't a pitched fight.
 * Truly dead time (no battle, no major moment, no macro events, nothing on
 * screen) runs at the fast ceiling. The output is smoothed with an asymmetric
 * response: slow down faster than we speed back up (don't clip the start of a
 * fight), but both eased enough that the time-scale glides rather than snaps.
 *
 * Everything is precomputed from data already on the viewer (processedBattles,
 * chapterMarkers.chapters, players[].eventStream), so per-frame cost is O(1).
 */
(function () {
  // --- Pacing envelope (the "Broadcast" profile) ---
  // Deliberately compressed vs. the original 1–10× range: the old ceiling felt
  // like a jump-cut and the gap between fast and slow was jarring. A lower top
  // speed plus the live activityCap below means we sit near "watchable" far more
  // of the time and only sprint through genuinely empty stretches.
  const MIN_SPEED      = 1.0;   // battles & key moments
  const MAX_SPEED      = 6.0;   // truly dead time — nothing on screen, no events
  const ACTIVE_SPEED   = 3.0;   // busy macro (lots of build/tech events)
  const ACTIVITY_SPEED = 2.0;   // floor when the frame is full of active units

  // Battle windows
  const BATTLE_PRE_MS  = 4000;  // start easing toward 1× this long before a fight
  const BATTLE_POST_MS = 2500;  // hold slow this long after a fight ends
  const BATTLE_PRE_SPEED  = 2.0; // speed at the far edge of the pre-roll
  const BATTLE_POST_SPEED = 2.5; // speed reached at the end of the post-roll

  // Major-moment windows
  const EVENT_PRE_MS   = 1800;
  const EVENT_POST_MS  = 2600;
  const EVENT_MIN      = 1.25;  // slowest the camera goes for a (non-battle) moment
  const EVENT_EDGE     = 4.0;   // speed at the edge of the moment window

  // Macro-density mapping
  const BUCKET_MS      = 1000;  // activity histogram resolution
  const DENSITY_WIN_MS = 2500;  // ± window used to smooth events/sec
  const DENSE_EPS      = 1.4;   // events/sec at/above which we're at ACTIVE_SPEED

  // Smoothing (per-second exponential rates; asymmetric but both eased so the
  // readout glides). Slow-down stays quicker than speed-up — we never want to
  // clip the start of a fight — but the old 9.0 slam read as an abrupt cut, so
  // it's pulled way down. A per-second slew clamp (below) bounds the worst case.
  const SLOWDOWN_RATE  = 4.0;   // converge down toward a slower target
  // Raised from 1.3. With transitions now SEQUENCED and announced (see the
  // shot state machine below), ramping back up is a deliberate, visible event
  // lasting a fraction of a second — not something to hide by creeping. The old
  // slow ramp was also what made the zoom target drift for seconds after every
  // fight, because the camera's calm-widen factor keyed off this live value.
  const SPEEDUP_RATE   = 3.0;
  const MAX_SLEW_PER_S = 6.0;   // hard ceiling on |Δspeed|/s, so no single frame jumps far

  // --- Shot sequencing -----------------------------------------------------
  // A shot change is an EVENT, not a continuous drift. When the pacing target
  // moves enough to matter we run a strict sequence:
  //
  //   IDLE --(target moved)--> DECELERATING --(speed settled)--> MOVING
  //        --(camera arrived)--> HOLDING --(dwell done)--> IDLE
  //
  // The camera and the time-scale never change at the same time. Playback speed
  // resolves FIRST (fast), then the camera executes its move at a now-stable
  // speed. That ordering is the fix for the reported symptom: the old code did
  // both at once, so a slow zoom into a fight was accompanied by the time-scale
  // sliding underneath it, and the combination read as the client lagging.
  const SHOT_TRIGGER_DELTA = 0.9;   // |Δ target speed| that counts as a new shot
  const DECEL_MS           = 250;   // speed resolves within this
  const HOLD_MS            = 2500;  // minimum dwell before another shot can fire
  const ARRIVE_EPS         = 0.05;  // |speed - target| considered "settled"

  class AutoDirector {
    constructor (viewer) {
      this.viewer = viewer;
      this.built = false;

      this._battles = [];        // [{start, end}] sorted by start
      this._majors = [];         // [t] sorted — major chapter moment times
      this._prefix = null;       // prefix sums over activity buckets
      this._bucketCount = 0;

      this.speed = ACTIVE_SPEED; // current smoothed multiplier
      this.targetSpeed = ACTIVE_SPEED;

      // Shot sequencing state (see SHOT_* constants above).
      this.shotState = 'idle';   // 'idle' | 'decelerating' | 'moving' | 'holding'
      this._shotElapsed = 0;     // ms in the current state (real time)
      this._shotFromSpeed = ACTIVE_SPEED;
      this._shotToSpeed = ACTIVE_SPEED;
      this.overlay = null;       // DirectorOverlay, assigned by the viewer
      this.camera = null;        // BroadcastCamera, assigned by the viewer
    }

    // Human-readable name for the shot we're cutting to, taken from whatever the
    // camera is actually framing. Used for the on-screen card.
    //
    // `slowing` matters: with no more specific reason, the honest label depends
    // on which way the pacing is going. A shot that slows down is arriving at
    // something; only a shot that speeds up is skipping.
    _shotLabel (gameTime, slowing) {
      const bc = this.camera;
      if (bc) {
        if (bc.isSplitActive) return { icon: '⛶', label: 'SPLIT · BOTH BASES' };
        if (bc.isFramingIntrusion) {
          return (bc._intrusionKind === 'harass')
            ? { icon: '⚔', label: 'HARASS' }
            : { icon: '👁', label: 'SCOUTING BASE' };
        }
      }
      if (this._inBattleWindow(gameTime)) return { icon: '⚔', label: 'BATTLE' };
      if (this._nearMajor(gameTime)) return { icon: '★', label: 'KEY MOMENT' };
      return slowing
        ? { icon: '◉', label: 'ACTION' }
        : { icon: '▸', label: 'SKIPPING AHEAD' };
    }

    _inBattleWindow (gameTime) {
      for (const w of this._battles) {
        if (gameTime >= w.start && gameTime <= w.end) return true;
        if (gameTime < w.start) break;
      }
      return false;
    }

    _nearMajor (gameTime) {
      for (const t of this._majors) {
        const dt = gameTime - t;
        if (dt < -EVENT_PRE_MS) break;
        if (dt <= EVENT_POST_MS) return true;
      }
      return false;
    }

    /**
     * Build the pacing index from the viewer's loaded replay. Safe to call
     * once after setup (processedBattles + chapterMarkers populated).
     */
    build () {
      const v = this.viewer;
      this.built = false;
      this._battles = [];
      this._majors = [];
      this._prefix = null;

      // Battle windows (already sorted ascending by start in BattleData).
      const pb = v && v.processedBattles;
      if (pb && Array.isArray(pb.battles)) {
        for (const b of pb.battles) {
          if (b && b.startTime != null && b.endTime != null) {
            this._battles.push({ start: b.startTime, end: b.endTime });
          }
        }
      }

      // Major chapter moments.
      const chapters = (v && v.chapterMarkers && v.chapterMarkers.chapters) || [];
      for (const ch of chapters) {
        if (ch && ch.severity === 'major' && ch.gameTime != null) {
          this._majors.push(ch.gameTime);
        }
      }
      this._majors.sort((a, b) => a - b);

      // Macro-event density histogram from every non-neutral eventStream.
      const matchEnd = (v && v.matchEndTime) || 0;
      const nBuckets = Math.max(1, Math.ceil((matchEnd + BUCKET_MS) / BUCKET_MS));
      const counts = new Float32Array(nBuckets);
      const players = (v && v.players) || [];
      for (const p of players) {
        if (!p || p.isNeutralPlayer || !Array.isArray(p.eventStream)) continue;
        for (const ev of p.eventStream) {
          if (!ev || ev.gameTime == null) continue;
          if (!this._isMacroEvent(ev.key)) continue;
          const idx = Math.floor(ev.gameTime / BUCKET_MS);
          if (idx >= 0 && idx < nBuckets) counts[idx] += 1;
        }
      }
      // Prefix sums for O(1) windowed lookups.
      const prefix = new Float32Array(nBuckets + 1);
      for (let i = 0; i < nBuckets; i++) prefix[i + 1] = prefix[i] + counts[i];
      this._prefix = prefix;
      this._bucketCount = nBuckets;

      this.built = true;
      this.speed = ACTIVE_SPEED;
      this.targetSpeed = ACTIVE_SPEED;
    }

    // Build-order / macro events that signal "the player is doing something."
    // Combat is handled separately via battle windows, so this is macro only.
    _isMacroEvent (key) {
      switch (key) {
        case 'addBuilding':
        case 'addUnit':
        case 'research':
        case 'makeTavernHero':
        case 'heroRevive':
        case 'scout':
        case 'transportLoad':
        case 'upgradeTier':
          return true;
        default:
          return false;
      }
    }

    /** Snap the smoothed speed to its target — used after a seek/scrub. */
    snap () {
      this.speed = this.targetSpeed;
      // A seek is not a shot. Abandon any in-flight transition so the camera
      // isn't left held and the overlay isn't left announcing a move that the
      // jump already invalidated.
      this.shotState = 'idle';
      this._shotElapsed = 0;
      if (this.camera && this.camera.setTransitionHold) this.camera.setTransitionHold(false);
      if (this.overlay) this.overlay.clear();
    }

    reset () {
      this.built = false;
      this._battles = [];
      this._majors = [];
      this._prefix = null;
      this.speed = ACTIVE_SPEED;
      this.targetSpeed = ACTIVE_SPEED;
    }

    /**
     * Compute and return the playback multiplier for this frame.
     * @param {number} gameTime    current game time (ms)
     * @param {number} realDeltaMs wall-clock ms since the previous frame
     * @param {number} [activity]  live 0–1 measure of on-screen unit activity
     *                             (from the camera). Higher → slower. Defaults
     *                             to 0 (treat as dead time) for seek/snap calls.
     */
    update (gameTime, realDeltaMs, activity) {
      if (!this.built) return this.speed;

      const target = this._targetFor(gameTime, activity);
      this._advanceShot(gameTime, target, realDeltaMs);
      this.targetSpeed = target;

      // Asymmetric exponential smoothing toward the target.
      const dt = Math.max(0, Math.min(100, realDeltaMs || 16.7)) / 1000;
      const rate = (target < this.speed) ? SLOWDOWN_RATE : SPEEDUP_RATE;
      const k = 1 - Math.exp(-rate * dt);
      let next = this.speed + (target - this.speed) * k;

      // Slew clamp: regardless of the exponential, never move the displayed
      // speed more than MAX_SLEW_PER_S per real second — bounds the one-frame
      // jump when a target appears/vanishes so the pacing always glides.
      const maxStep = MAX_SLEW_PER_S * dt;
      next = Math.max(this.speed - maxStep, Math.min(this.speed + maxStep, next));
      this.speed = next;

      // Guard against tiny residuals so the readout reads cleanly.
      if (Math.abs(this.speed - target) < 0.02) this.speed = target;
      return this.speed;
    }

    /**
     * Drive the shot state machine. Called once per frame BEFORE the speed is
     * smoothed, so `this.speed` is still the pre-change value when a shot fires.
     *
     * The camera is told to hold still during DECELERATING (via
     * `camera.setTransitionHold`), so the two changes never overlap: speed
     * resolves, THEN the camera moves. That is the whole point.
     */
    _advanceShot (gameTime, target, realDeltaMs) {
      const dtMs = Math.max(0, Math.min(100, realDeltaMs || 16.7));
      this._shotElapsed += dtMs;

      const bc = this.camera;
      const setHold = (on) => { if (bc && bc.setTransitionHold) bc.setTransitionHold(on); };

      switch (this.shotState) {
        case 'idle': {
          // A big enough change in pacing target means something worth
          // announcing is starting or ending. Small drifts are not shots.
          if (Math.abs(target - this.speed) >= SHOT_TRIGGER_DELTA) {
            this.shotState = 'decelerating';
            this._shotElapsed = 0;
            this._shotFromSpeed = this.speed;
            this._shotToSpeed = target;
            setHold(true);                       // freeze the camera while speed moves
            if (this.overlay) {
              const { icon, label } = this._shotLabel(gameTime, target < this._shotFromSpeed);
              this.overlay.beginTransition(label, icon, this._shotFromSpeed, target);
            }
          }
          break;
        }
        case 'decelerating': {
          // Speed has resolved (or we've waited long enough) — release the
          // camera and let it execute the move.
          const settled = Math.abs(this.speed - target) <= ARRIVE_EPS;
          if (settled || this._shotElapsed >= DECEL_MS) {
            this.shotState = 'moving';
            this._shotElapsed = 0;
            setHold(false);
          }
          break;
        }
        case 'moving': {
          // The camera reports when it has arrived. Cap the wait so a target
          // that keeps moving can't strand us in this state forever.
          const arrived = !bc || bc.settled;
          if (arrived || this._shotElapsed >= 1500) {
            this.shotState = 'holding';
            this._shotElapsed = 0;
            if (this.overlay) this.overlay.endTransition();
          }
          break;
        }
        case 'holding': {
          if (this._shotElapsed >= HOLD_MS) {
            this.shotState = 'idle';
            this._shotElapsed = 0;
          }
          break;
        }
      }
    }

    // The instantaneous target speed at gameTime = slowest applicable cap.
    _targetFor (gameTime, activity) {
      let cap = MAX_SPEED;

      const b = this._battleCap(gameTime);
      if (b < cap) cap = b;

      const e = this._eventCap(gameTime);
      if (e < cap) cap = e;

      const d = this._densityCap(gameTime);
      if (d < cap) cap = d;

      const a = this._activityCap(activity);
      if (a < cap) cap = a;

      // External ceiling (split view / intrusion cut). Applied HERE, as part of
      // the target, so it flows through the same smoothing + slew clamp + shot
      // sequencing as every other cap instead of stepping the output.
      if (this.speedCeiling != null && this.speedCeiling < cap) cap = this.speedCeiling;

      return Math.max(MIN_SPEED, Math.min(MAX_SPEED, cap));
    }

    // Live on-screen activity → speed ceiling. activity is 0 (nothing happening
    // in frame) → MAX_SPEED, easing down to ACTIVITY_SPEED when the frame is
    // full of active units. Smoothstep so the cap itself doesn't ramp linearly.
    _activityCap (activity) {
      const a = Math.max(0, Math.min(1, activity || 0));
      const s = a * a * (3 - 2 * a);
      return MAX_SPEED + (ACTIVITY_SPEED - MAX_SPEED) * s;
    }

    // 1× inside a battle; ramps in over the pre-roll, eases out over post-roll.
    _battleCap (gameTime) {
      let cap = Infinity;
      for (const w of this._battles) {
        if (gameTime >= w.start && gameTime <= w.end) return MIN_SPEED;
        if (gameTime < w.start) {
          const dt = w.start - gameTime;
          if (dt <= BATTLE_PRE_MS) {
            const f = dt / BATTLE_PRE_MS; // 0 at start → 1 at far edge
            cap = Math.min(cap, MIN_SPEED + (BATTLE_PRE_SPEED - MIN_SPEED) * f);
          }
          // battles are sorted; the first future one is the nearest start
          break;
        } else {
          const dt = gameTime - w.end;
          if (dt <= BATTLE_POST_MS) {
            const f = dt / BATTLE_POST_MS; // 0 just after → 1 at far edge
            cap = Math.min(cap, MIN_SPEED + (BATTLE_POST_SPEED - MIN_SPEED) * f);
          }
        }
      }
      return cap;
    }

    // Eases toward EVENT_MIN around the nearest major moment.
    _eventCap (gameTime) {
      let cap = Infinity;
      // Linear scan is fine — majors are few (tens per match).
      for (const t of this._majors) {
        const dt = gameTime - t;
        if (dt < -EVENT_PRE_MS) break;          // sorted: nothing closer ahead
        if (dt > EVENT_POST_MS) continue;       // already well past this one
        const win = dt < 0 ? EVENT_PRE_MS : EVENT_POST_MS;
        const f = Math.min(1, Math.abs(dt) / win); // 0 at the moment → 1 at edge
        cap = Math.min(cap, EVENT_MIN + (EVENT_EDGE - EVENT_MIN) * f);
      }
      return cap;
    }

    // Macro-event density → base speed (busy macro slower than idle).
    _densityCap (gameTime) {
      if (!this._prefix) return MAX_SPEED;
      const lo = Math.max(0, Math.floor((gameTime - DENSITY_WIN_MS) / BUCKET_MS));
      const hi = Math.min(this._bucketCount, Math.ceil((gameTime + DENSITY_WIN_MS) / BUCKET_MS));
      if (hi <= lo) return MAX_SPEED;
      const count = this._prefix[hi] - this._prefix[lo];
      const seconds = ((hi - lo) * BUCKET_MS) / 1000;
      const perSec = seconds > 0 ? count / seconds : 0;
      const f = Math.min(1, perSec / DENSE_EPS); // 0 idle → 1 dense
      return MAX_SPEED + (ACTIVE_SPEED - MAX_SPEED) * f;
    }
  }

  window.AutoDirector = AutoDirector;
})();
