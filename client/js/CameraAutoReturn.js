/**
 * CameraAutoReturn — grabbing the camera is a detour, not a decision.
 *
 * The viewer opens in AUTO and the broadcast camera runs the show. Any real
 * transform on the canvas demotes it to FREE (BroadcastCamera.attachToZoom) and
 * it stays there for the rest of the replay: one stray wheel tick silently ends
 * the broadcast, with nothing on screen to say so and no hint that clicking AUTO
 * is the way back.
 *
 * So a hand-driven demotion now expires. The toolbar grows a quiet line saying
 * when control comes back, counts it down, and hands over. Keep fiddling and the
 * deadline keeps moving; the countdown only runs down once you've stopped.
 *
 * Three rules give it its shape:
 *
 *   1. It returns to the mode you last CHOSE, not to AUTO. Click P1 then drag,
 *      and you get P1 back. Never clicked a button? The viewer's default, AUTO.
 *      Click FREE and you have chosen FREE — no countdown, ever, until you pick
 *      something else. Same for clicking the countdown itself, which is what
 *      makes it dismissible rather than merely informational.
 *
 *   2. It is armed by GESTURES, not by mode changes. Only the first frame of a
 *      drag changes the mode, so 'modechange' can't tell us the drag is still
 *      going. It's also why the guided walkthrough, seeking, and a split
 *      collapsing never arm it — those reach FREE through setMode() and raise no
 *      gesture, which is exactly right: they aren't the viewer's hands.
 *
 *   3. It counts PLAYBACK time, not wall time. Pausing to study a frame holds
 *      the countdown where it is. This also settles how it ticks: pause() stops
 *      the render loop whenever the camera is disabled, so in FREE + paused —
 *      precisely the state this targets — there is no rAF running at all and a
 *      frame-driven countdown would freeze permanently. Hence an interval, on
 *      the generation-token pattern the guide auto-advance already uses.
 */
(function () {
  // How often the notice repaints. Structural, not taste: fine enough that the
  // drain bar reads as continuous, coarse enough to be free. The two numbers
  // that ARE taste (hold duration, re-arm throttle) live in directorConfig.js.
  const TICK_MS = 50;

  // Camera-button mode → what it means to restore. 'free' is absent on purpose:
  // there is nothing to return to, so choosing it disarms outright.
  const RESTORE = {
    auto: { label: 'AUTO', playerId: undefined },
    p1:   { label: 'P1',   playerId: 0 },
    p2:   { label: 'P2',   playerId: 1 }
  };

  class CameraAutoReturn {
    constructor (viewer) {
      this.viewer = viewer;

      // The mode the viewer last picked deliberately. The toolbar starts on
      // AUTO, so that is the standing choice until a button says otherwise.
      this._explicitMode = 'auto';

      this._armed = false;
      this._remainingMs = 0;
      this._lastArmWall = 0;    // throttle gate for re-arming during a drag
      this._lastTickWall = 0;
      this._timer = null;
      this._shownCount = null;  // last digit painted, so we only touch the DOM on change
      this._held = null;        // last hold state painted

      this.root = null;
      this.countEl = null;
      this.targetEl = null;
      this.fillEl = null;

      this._onGesture = () => this.noteUserGesture();
      this._onModeChange = (mode) => this.handleModeChange(mode);
    }

    /**
     * Build the notice and start listening. `toolbarEl` is the live
     * `.camera-toolbar`, which app.js rebuilds on every replay load — so this
     * runs once per load and destroy() must run with it.
     */
    mount (toolbarEl) {
      if (!toolbarEl) return;

      // A <button>, not a <div>: "click to stay in FREE" is a real action and
      // should be keyboard-reachable. The toolbar's delegated click handler
      // looks for closest('[data-mode]'), which this isn't, so it stays inert
      // there and only our own handler sees it.
      const root = document.createElement('button');
      root.type = 'button';
      root.className = 'cam-return';
      root.hidden = true;
      root.title = 'Stay in free camera';
      // Fixed accessible name, and the ticking digits hidden from it — a button
      // that renames itself once a second is noise to read aloud, and what it
      // DOES never changes.
      root.setAttribute('aria-label', 'Stay in free camera');

      const text = document.createElement('span');
      text.className = 'cam-return-text';
      text.setAttribute('aria-hidden', 'true');
      this.targetEl = document.createElement('span');
      this.targetEl.className = 'cam-return-target';
      this.targetEl.textContent = 'AUTO';
      this.countEl = document.createElement('span');
      this.countEl.className = 'cam-return-count';
      this.countEl.textContent = '3';
      text.appendChild(this.targetEl);
      text.appendChild(document.createTextNode(' in '));
      text.appendChild(this.countEl);

      const bar = document.createElement('span');
      bar.className = 'cam-return-bar';
      this.fillEl = document.createElement('span');
      this.fillEl.className = 'cam-return-fill';
      bar.appendChild(this.fillEl);

      root.appendChild(text);
      root.appendChild(bar);
      root.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Dismissing IS a choice: FREE becomes explicit, so dragging around
        // afterwards no longer re-arms.
        this.setExplicitMode('free');
      });

      toolbarEl.appendChild(root);
      this.root = root;

      const bc = this.viewer.broadcastCamera;
      if (bc) {
        bc.on('usergesture', this._onGesture);
        bc.on('modechange', this._onModeChange);
      }
    }

    /**
     * The viewer picked a camera mode deliberately (button or hotkey). Record it
     * as the restore target and stand down — an explicit choice is never
     * something we need to hand back from.
     */
    setExplicitMode (btnMode) {
      if (RESTORE[btnMode] || btnMode === 'free') this._explicitMode = btnMode;
      this.disarm();
    }

    /** The viewer moved the camera by hand. Arm, or push the deadline back. */
    noteUserGesture () {
      if (!this.root) return;
      if (!this._canArm()) return;

      const now = performance.now();
      // Leading edge: the first gesture arms immediately. After that a drag is
      // firing this ~60×/s, so the deadline only moves once a second — enough
      // to keep the countdown honest, not so often that the bar never drains.
      if (this._armed && (now - this._lastArmWall) < this._cfg('rearmThrottleMs', 1000)) return;

      this._lastArmWall = now;
      this._lastTickWall = now;
      this._remainingMs = this._cfg('holdMs', 3000);

      if (!this._armed) {
        this._armed = true;
        this._shownCount = null;
        this._held = null;
        this.root.hidden = false;
        this._setFeedClearance(true);
        clearInterval(this._timer);
        this._timer = setInterval(() => this._tick(), TICK_MS);
      }
      this._paint();
    }

    /** Any programmatic mode change lands here; leaving FREE means we're done. */
    handleModeChange (mode) {
      if (mode !== CameraMode.FREE) this.disarm();
    }

    disarm () {
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      if (!this._armed) return;
      this._armed = false;
      this._remainingMs = 0;
      if (this.root) this.root.hidden = true;
      this._setFeedClearance(false);
    }

    destroy () {
      const bc = this.viewer.broadcastCamera;
      if (bc) {
        bc.off('usergesture', this._onGesture);
        bc.off('modechange', this._onModeChange);
      }
      this.disarm();
      if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
      this.root = null;
      this.countEl = this.targetEl = this.fillEl = null;
    }

    ////
    // internals
    ////

    _cfg (key, fallback) {
      // Read lazily so `WC3V_DIRECTOR.autoReturn.holdMs = 8000` works from the
      // console mid-replay, like the rest of the director's knobs.
      const c = (typeof WC3V_DIRECTOR !== 'undefined' && WC3V_DIRECTOR.autoReturn)
        ? WC3V_DIRECTOR.autoReturn : null;
      const v = c ? c[key] : undefined;
      return (typeof v === 'number' && isFinite(v) && v > 0) ? v : fallback;
    }

    _canArm () {
      const v = this.viewer;
      const bc = v.broadcastCamera;
      if (!bc || bc.mode !== CameraMode.FREE) return false;
      // FREE is what they asked for — leave them in it.
      if (this._explicitMode === 'free') return false;
      // The walkthrough drives the camera itself; it parks in FREE on purpose.
      if (v.guideMode) return false;
      if (v.state === ScrubStates.stopped || v.state === ScrubStates.finished) return false;
      return true;
    }

    _tick () {
      if (!this._armed) return;

      const now = performance.now();
      const dt = now - this._lastTickWall;
      this._lastTickWall = now;

      const v = this.viewer;
      if (!this._canArm()) { this.disarm(); return; }

      // Held: the countdown measures time the viewer spent WATCHING. Paused,
      // it sits still — you can stop and read the map without the camera
      // deciding you're done.
      if (v.state !== ScrubStates.playing) { this._paint(); return; }

      this._remainingMs -= dt;
      if (this._remainingMs <= 0) { this._fire(); return; }
      this._paint();
    }

    _paint () {
      if (!this.root) return;

      const total = this._cfg('holdMs', 3000);
      const remaining = Math.max(0, this._remainingMs);

      // Ceil, so the last second is shown as "1" and not "0" — the label counts
      // seconds LEFT, and zero is the moment it fires.
      const count = Math.max(1, Math.ceil(remaining / 1000));
      if (count !== this._shownCount) {
        this._shownCount = count;
        this.countEl.textContent = String(count);
      }

      const target = RESTORE[this._explicitMode] || RESTORE.auto;
      if (this.targetEl.textContent !== target.label) this.targetEl.textContent = target.label;

      // No CSS transition on this: a re-arm mid-drag SHOULD read as a visible
      // snap back to full. That is the timer telling you it noticed.
      this.fillEl.style.transform = 'scaleX(' + (remaining / total).toFixed(4) + ')';

      const held = this.viewer.state !== ScrubStates.playing;
      if (held !== this._held) {
        this._held = held;
        this.root.classList.toggle('cam-return-held', held);
      }
    }

    _fire () {
      const target = RESTORE[this._explicitMode] || RESTORE.auto;
      const v = this.viewer;
      this.disarm();

      const bc = v.broadcastCamera;
      if (!bc || typeof CameraMode === 'undefined') return;
      const mode = (target.playerId === undefined)
        ? CameraMode.ACTION_FOCUS : CameraMode.FOLLOW_HERO;
      bc.setMode(mode, target.playerId);
      // Same kick _handleCameraButton does: paused, the render loop is stopped,
      // so nothing would move the camera to where it just decided to go.
      if (v.state === ScrubStates.paused) v.startRenderLoop();
    }

    /**
     * #event-feed sits directly under the toolbar at a hand-computed `top` keyed
     * to the toolbar's exact height (see main.css). The notice grows the toolbar
     * while it's up, so the feed has to step down with it or the top card ends
     * up behind the buttons.
     */
    _setFeedClearance (open) {
      const wrapper = document.getElementById('main-wrapper');
      if (wrapper) wrapper.classList.toggle('cam-return-open', !!open);
    }
  }

  window.CameraAutoReturn = CameraAutoReturn;
})();
