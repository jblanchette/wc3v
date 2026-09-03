/**
 * HeroStage.js — the homepage's race picker, as four animated heroes.
 *
 * The four buttons in #hero-stage are the real control: they carry the
 * pressed state, the labels and the portraits, and they filter the build
 * library whether or not a single model ever arrives. This subsystem draws
 * animated 3D heroes into the canvas behind them and, per slot, hides that
 * slot's portrait once its model is standing there.
 *
 * NOTHING here is on the critical path. three.js and GLBLoader are injected
 * after first paint, only when the band is near the viewport, and the models
 * load strictly one at a time so the first hero appears while the rest are
 * still downloading. Any of these leaves the portraits in place, permanently
 * and silently: reduced motion, a data-saver connection, a phone-width
 * viewport, no WebGL, a blocked CDN, a lost context, a 404 on a .glb.
 *
 * Usage (index.html):
 *   const stage = new HeroStage({
 *     host: document.getElementById('hero-stage'),
 *     assetVersion: window.__WC3V_ASSET_VERSION__,
 *     initialRace: selectedRace
 *   });
 *   stage.setSelected('O');   // page -> stage
 *
 * The page owns the race state AND the slot clicks: index.html binds them
 * and calls its own setRace(), which is what keeps the picker working when
 * this file never loads. setSelected is the one way state comes back in.
 *
 * DOM contract (index.html + client/css/home.css):
 *   #hero-stage[data-state]     fallback | loading | ready | off
 *   #hero-stage[data-reason]    why, when state is off
 *   #hero-stage[data-selected]  H | O | E | U | ''
 *   .hp-stage-canvas            what this draws into
 *   .hp-stage-slot[data-race]   the buttons; .is-selected / .is-loaded
 */

(function () {
  'use strict';

  // Same build viewer.html pins. Never 'latest': GLBLoader reads THREE at
  // parse time and its materials need forceSinglePass (r155+).
  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';

  // Keep equal to MODEL_ASSET_VERSION in js/UnitModelRenderer.js. It is a
  // closure const there, not an export, so this is a copy, and
  // tools/test-hero-stage.js is what stops the two drifting apart.
  const MODEL_ASSET_VERSION = '20260809a';

  // Colours are the --race-* values in css/tokens.css. Read from a table
  // rather than from CSS: this runs before the band has been laid out, and
  // resolving a custom property per instance is not worth a reflow.
  // `yaw` turns each hero slightly toward the centre of the row.
  const HEROES = [
    { race: 'H', id: 'Hamg', model: 'heroarchmage',    color: '#4488FF', yaw:  0.30 },
    { race: 'O', id: 'Obla', model: 'heroblademaster', color: '#FF4444', yaw:  0.10 },
    { race: 'E', id: 'Edem', model: 'herodemonhunter', color: '#44DD88', yaw: -0.10 },
    { race: 'U', id: 'Udea', model: 'herodeathknight', color: '#AA66FF', yaw: -0.30 }
  ];

  // The frame is stated as fractions of the canvas rather than as a camera
  // distance, because the band is wide and short and a distance picked for
  // the height alone puts four thumbnails in a letterbox.
  //
  // FIGURE_H is a hero in world units (measured: 155-196 across the four
  // bind poses). FIGURE_FRAC is how much of the canvas height one should
  // fill, FEET_FRAC is where the ground line sits, high enough that the
  // slot labels along the bottom edge do not collide with a pair of boots.
  // MIN_COLUMN is the floor on a slot's width in world units, so a wide
  // weapon never crosses into the next hero.
  const FIGURE_H = 175;
  const FIGURE_FRAC = 0.66;
  const FEET_FRAC = 0.76;
  const MIN_COLUMN = 150;
  const FOV = 22;
  const PITCH = 8 * Math.PI / 180;   // looking down, a little above eye level

  // Below this the canvas is not drawn at all: the slots are a plain row of
  // portrait buttons and a megabyte of models would buy nothing.
  const MIN_WIDTH = 640;
  // Stop drawing after this long with no input on the page. The last frame
  // stays on the canvas; the next interaction resumes it.
  const IDLE_STOP_MS = 120000;

  const log = function () {
    if (window.WC3V_CONFIG && WC3V_CONFIG.log) {
      WC3V_CONFIG.log.apply(WC3V_CONFIG, ['heroStage'].concat([].slice.call(arguments)));
    }
  };

  class HeroStage {
    constructor (opts) {
      opts = opts || {};
      this.host = opts.host;
      if (!this.host) throw new Error('HeroStage needs a host element');
      this.assetVersion = opts.assetVersion || null;

      this.canvas = this.host.querySelector('.hp-stage-canvas');
      this.slots = Array.prototype.slice.call(this.host.querySelectorAll('.hp-stage-slot'));
      this.selected = '';
      this.state = 'fallback';
      this.instances = [];
      this._raf = null;
      this._running = false;
      this._visible = true;
      this._lastInput = Date.now();
      this._disposed = false;

      this._wireSlots();
      this.setSelected(opts.initialRace || '');

      const gate = this._gate();
      if (gate) { this._off(gate); return; }
      this._armTrigger();
    }

    // ── public ──────────────────────────────────────────────────────────

    getSelected () { return this.selected; }

    // Page -> stage. The page has already decided; this paints the answer.
    setSelected (key) {
      this.selected = HEROES.some(h => h.race === key) ? key : '';
      this.host.dataset.selected = this.selected;
      for (const btn of this.slots) {
        const on = btn.dataset.race === this.selected;
        btn.classList.toggle('is-selected', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      this._applySelection();
    }

    destroy () {
      if (this._disposed) return;
      this._disposed = true;
      this._stopLoop();
      if (this._io) this._io.disconnect();
      if (this._ro) this._ro.disconnect();
      document.removeEventListener('visibilitychange', this._onVisibility);
      for (const ev of ['pointermove', 'pointerdown', 'keydown', 'touchstart', 'scroll']) {
        document.removeEventListener(ev, this._onInput);
      }
      for (const inst of this.instances) {
        if (inst.mixer) inst.mixer.stopAllAction();
        if (inst.root && inst.root.parent) inst.root.parent.remove(inst.root);
        if (inst.ring) {
          if (inst.ring.parent) inst.ring.parent.remove(inst.ring);
          if (inst.ring.material) inst.ring.material.dispose();
        }
        for (const m of (inst.meshes || [])) {
          if (m.geometry) m.geometry.dispose();
          const mat = m.material;
          if (mat) {
            if (mat.uniforms && mat.uniforms.map && mat.uniforms.map.value) mat.uniforms.map.value.dispose();
            mat.dispose();
          }
        }
      }
      this.instances = [];
      if (this._ringGeo) this._ringGeo.dispose();
      if (this.renderer) {
        this.renderer.dispose();
        // Frees the GL context immediately rather than at the next GC. A
        // homepage left open in a background tab should not hold one.
        if (this.renderer.forceContextLoss) this.renderer.forceContextLoss();
      }
      this.renderer = this.scene = this.camera = null;
    }

    // ── gates and trigger ───────────────────────────────────────────────

    // Every reason not to draw, decided once, synchronously, before anything
    // is fetched. Returning a string here means the portraits are the picker
    // for this visit and nothing further happens.
    _gate () {
      if (window.WC3V_CONFIG && WC3V_CONFIG.perf && WC3V_CONFIG.perf.heroStage === false) return 'killswitch';
      try {
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'reduced-motion';
      } catch (e) { /* no matchMedia: fall through and try */ }
      const conn = navigator.connection;
      if (conn && conn.saveData) return 'save-data';
      if (window.innerWidth < MIN_WIDTH) return 'narrow';
      if (!window.WebGLRenderingContext) return 'no-webgl';
      if (!this.canvas) return 'no-canvas';
      return null;
    }

    // Load only after the page has painted AND the band is worth drawing.
    // `load` is the signal; the 2.5s cap is so one slow image cannot starve
    // the stage forever. The observer is what keeps a deep link that lands
    // scrolled past the hero from paying for it at all.
    _armTrigger () {
      const idle = (fn) => (window.requestIdleCallback
        ? window.requestIdleCallback(fn, { timeout: 1500 })
        : setTimeout(fn, 300));

      let fired = false;
      const go = () => {
        if (fired || this._disposed) return;
        fired = true;
        idle(() => { if (!this._disposed) this._inject(); });
      };

      const afterPaint = () => {
        if (!('IntersectionObserver' in window)) { go(); return; }
        this._io = new IntersectionObserver((entries) => {
          for (const e of entries) {
            this._visible = e.isIntersecting;
            if (e.isIntersecting) go();
          }
          this._syncRunning();
        }, { rootMargin: '200px' });
        this._io.observe(this.host);
      };

      if (document.readyState === 'complete') afterPaint();
      else {
        let done = false;
        const once = () => { if (done) return; done = true; afterPaint(); };
        window.addEventListener('load', once, { once: true });
        setTimeout(once, 2500);
      }
    }

    // ── script injection ────────────────────────────────────────────────

    // Ordered-async, the same shape viewer.html uses: the two download in
    // parallel but execute in insertion order, because GLBLoader touches
    // THREE at module scope. `defer` has no effect on injected scripts.
    _inject () {
      if (this.state !== 'fallback') return;
      this._setState('loading');
      const urls = [];
      if (!window.THREE) urls.push(THREE_URL);
      if (!window.GLBLoader) {
        urls.push('/js/GLBLoader.js' + (this.assetVersion ? '?v=' + this.assetVersion : ''));
      }
      if (!urls.length) { this._boot(); return; }

      let pending = urls.length;
      let failed = false;
      const done = () => {
        if (--pending > 0 || this._disposed) return;
        if (failed || !window.THREE || !window.GLBLoader) { this._off('cdn'); return; }
        this._boot();
      };
      for (const src of urls) {
        const el = document.createElement('script');
        el.src = src;
        el.async = false;
        el.onload = done;
        el.onerror = () => { failed = true; log('script failed', src); done(); };
        document.head.appendChild(el);
      }
    }

    // ── renderer ────────────────────────────────────────────────────────

    _boot () {
      try {
        this.renderer = new THREE.WebGLRenderer({
          canvas: this.canvas,
          alpha: true,
          antialias: true,
          powerPreference: 'low-power'
        });
      } catch (e) {
        log('no webgl context', e && e.message);
        this._off('no-webgl');
        return;
      }
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      if (THREE.SRGBColorSpace) this.renderer.outputColorSpace = THREE.SRGBColorSpace;

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(FOV, 1, 10, 5000);
      // No lights: the WC3 skinned material in GLBLoader is self-lit through
      // its own uLightDir / uAmbient uniforms, and the ground rings are
      // MeshBasicMaterial.
      this._zupToYup = new THREE.Quaternion(-0.70710678, 0, 0, 0.70710678);
      this._up = new THREE.Vector3(0, 1, 0);
      this._ringGeo = new THREE.RingGeometry(0.82, 1, 48);
      this._clock = new THREE.Clock();

      this.canvas.addEventListener('webglcontextlost', () => {
        log('context lost');
        this._off('context-lost');
      });

      if ('ResizeObserver' in window) {
        this._ro = new ResizeObserver(() => this._layout());
        this._ro.observe(this.host);
      } else {
        window.addEventListener('resize', () => this._layout());
      }

      this._onVisibility = () => this._syncRunning();
      document.addEventListener('visibilitychange', this._onVisibility);
      this._onInput = () => {
        this._lastInput = Date.now();
        if (!this._running) this._syncRunning();
      };
      for (const ev of ['pointermove', 'pointerdown', 'keydown', 'touchstart', 'scroll']) {
        document.addEventListener(ev, this._onInput, { passive: true });
      }

      this._layout();
      this._syncRunning();
      this._loadSequential();
    }

    // ── loading ─────────────────────────────────────────────────────────

    // One at a time, in row order, so the leftmost hero is standing there
    // while the rest are still on the wire. A failure resolves like a
    // success: that slot keeps its portrait and the row carries on.
    async _loadSequential () {
      for (const hero of HEROES) {
        if (this._disposed || this.state === 'off') return;
        await this._loadOne(hero);
      }
    }

    _loadOne (hero) {
      return new Promise((resolve) => {
        const url = '/assets/models/units/' + hero.model + '.glb?v=' + MODEL_ASSET_VERSION;
        let loader;
        try { loader = new GLBLoader(); } catch (e) { resolve(); return; }
        loader.load(url, (res) => {
          if (this._disposed || this.state === 'off') { resolve(); return; }
          if (!res || !res.isSkinnedResult) { log('not a skinned result', hero.model); resolve(); return; }
          try { this._mount(hero, res); } catch (e) { log('mount failed', hero.model, e && e.message); }
          resolve();
        }, undefined, (err) => {
          log('glb failed', hero.model, err && (err.message || err));
          resolve();
        });
      });
    }

    _mount (hero, res) {
      const inst = {
        hero,
        root: res.root,
        node: res.placementNode,
        meshes: res.skinnedMeshes || [],
        mixer: null,
        idle: null,
        attack: null,
        ring: null,
        yaw: hero.yaw,
        targetYaw: hero.yaw
      };

      // Two-form models ship both bodies in one GLB. The Demon Hunter's
      // Metamorphosis mesh would otherwise draw straight through the elf.
      for (const m of inst.meshes) {
        const tag = m.userData && m.userData.wc3Form;
        if (tag && tag !== 'both') m.visible = (tag === 'base');
      }

      // Team colour on the geosets that carry it: the tabard, the glow.
      // GLBLoader tags them through material.userData.wc3.
      const col = new THREE.Color(hero.color);
      for (const m of inst.meshes) {
        const mat = m.material;
        const wc3 = mat && mat.userData && mat.userData.wc3;
        if (wc3 && (wc3.replaceableId || wc3.teamBlend) && mat.uniforms && mat.uniforms.uTeamColor) {
          mat.uniforms.uTeamColor.value.copy(col);
        }
      }

      // Clip names inside the GLB are the canonical categories, NOT the
      // manifest's source-MDX names ("Stand 1", "Attack - 1"). Look them up
      // the way UnitModelRenderer._bindFormActions does.
      const byName = {};
      for (const c of (res.animations || [])) byName[c.name] = c;
      if (res.animations && res.animations.length) {
        inst.mixer = new THREE.AnimationMixer(res.root);
        const idleClip = byName.idle || res.animations[0];
        inst.idle = inst.mixer.clipAction(idleClip);
        inst.idle.setLoop(THREE.LoopRepeat, Infinity);
        inst.idle.play();
        // Desync, so four heroes do not breathe in lockstep.
        inst.idle.time = Math.random() * (idleClip.duration || 1);
        if (byName.attack) {
          inst.attack = inst.mixer.clipAction(byName.attack);
          inst.attack.setLoop(THREE.LoopOnce, 1);
        }
        inst.mixer.addEventListener('finished', (e) => {
          if (!inst.attack || e.action !== inst.attack) return;
          inst.idle.enabled = true;
          inst.idle.setEffectiveWeight(1);
          inst.attack.crossFadeTo(inst.idle, 0.2, false);
          const btn = this._slotFor(hero.race);
          if (btn) btn.classList.remove('is-attacking');
        });
      }

      // The ground ring, in the race's own colour. Flat on the floor, in the
      // scene rather than in the facing wrapper so it never rotates.
      inst.ring = new THREE.Mesh(this._ringGeo, new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        side: THREE.DoubleSide,
        forceSinglePass: true
      }));
      inst.ring.rotation.x = -Math.PI / 2;
      inst.ring.scale.setScalar(54);

      this.scene.add(res.root);
      this.scene.add(inst.ring);
      this.instances.push(inst);

      this._place(inst);
      this._applySelection();

      const btn = this._slotFor(hero.race);
      if (btn) btn.classList.add('is-loaded');
      try { performance.mark('wc3v:hero-stage:model:' + hero.race); } catch (e) {}

      if (this.state !== 'ready') {
        this._setState('ready');
        try { performance.mark('wc3v:hero-stage:first-model'); } catch (e) {}
      }
      this._syncRunning();
      this._render();
    }

    // ── layout ──────────────────────────────────────────────────────────

    // Frame the row so each hero's projected centre lands on its slot's
    // column centre (12.5 / 37.5 / 62.5 / 87.5% of the canvas). The buttons
    // are a 4-column grid over the same box, so they line up by construction
    // and nothing has to be positioned per frame. Change one, change both.
    _layout () {
      if (!this.renderer || this._disposed) return;
      const w = this.host.clientWidth;
      const h = this.host.clientHeight;
      if (!w || !h) return;

      this.renderer.setSize(w, h, false);
      const aspect = w / h;
      this.camera.aspect = aspect;

      const halfFov = Math.tan((FOV * Math.PI / 180) / 2);
      // How much world the canvas shows, top to bottom: enough for a hero to
      // fill FIGURE_FRAC of it, and never so little that four slots stop
      // clearing MIN_COLUMN each.
      const viewH = Math.max(FIGURE_H / FIGURE_FRAC, MIN_COLUMN * 4 / aspect);
      const d = viewH / (2 * halfFov);
      this._halfWidth = viewH * aspect / 2;

      // Put the ground line at FEET_FRAC down the canvas. The camera aims at
      // the point that puts it there, so raising FEET_FRAC drops the heroes
      // and lowering it lifts them off the labels.
      const aimY = FEET_FRAC * viewH - viewH / 2;
      this.camera.position.set(0, aimY + d * Math.sin(PITCH), d * Math.cos(PITCH));
      this.camera.lookAt(0, aimY, 0);
      this.camera.updateProjectionMatrix();

      for (const inst of this.instances) this._place(inst);
      this._render();
    }

    _place (inst) {
      const i = HEROES.indexOf(inst.hero);
      const x = (-0.375 + 0.25 * i) * 2 * (this._halfWidth || 400);
      inst.x = x;
      if (inst.node) {
        inst.node.position.set(x, 0, 0);
        this._faceNode(inst);
      }
      if (inst.ring) inst.ring.position.set(x, 1, 0);
    }

    // Model forward is +X and the camera sits on +Z, so -PI/2 squares a hero
    // to the viewer; the per-hero yaw turns them slightly inward.
    _faceNode (inst) {
      inst.node.quaternion
        .setFromAxisAngle(this._up, -Math.PI / 2 + inst.yaw)
        .multiply(this._zupToYup);
    }

    // ── selection ───────────────────────────────────────────────────────

    // The selected hero stands square to the viewer with a lit ring; the
    // other three step back rather than the selected one lighting up. uColor
    // is the shader's base tint, so dimming costs no transparency pass.
    _applySelection () {
      if (!this.instances.length) return;
      const any = !!this.selected;
      for (const inst of this.instances) {
        const on = inst.hero.race === this.selected;
        const dim = any && !on ? 0.62 : 1;
        for (const m of inst.meshes) {
          const u = m.material && m.material.uniforms;
          if (u && u.uColor) u.uColor.value.setScalar(dim);
        }
        if (inst.ring) inst.ring.material.opacity = !any ? 0.35 : (on ? 0.95 : 0.12);
        inst.targetYaw = on ? 0 : inst.hero.yaw;
      }
      this._syncRunning();
    }

    // ── interaction ─────────────────────────────────────────────────────

    _slotFor (race) {
      for (const b of this.slots) if (b.dataset.race === race) return b;
      return null;
    }

    // Clicks belong to the page, NOT to this file. index.html's wireRacePicker
    // binds them and calls its own setRace(), which is what makes the picker
    // work when this subsystem never loads at all. Binding here as well gave
    // every slot two handlers that toggled each other, so a click selected a
    // race and then immediately cleared it.
    //
    // What IS ours: the hover swing, which only means anything once a model
    // is standing there.
    _wireSlots () {
      for (const btn of this.slots) {
        btn.addEventListener('pointerenter', (e) => {
          if (e.pointerType && e.pointerType !== 'mouse') return;
          this._swing(btn.dataset.race);
        });
      }
    }

    // Hover swings the hero's weapon once, then falls back to idle.
    _swing (race) {
      const inst = this.instances.find(i => i.hero.race === race);
      if (!inst || !inst.attack || !inst.idle) return;
      if (inst.attack.isRunning()) return;
      inst.attack.reset();
      inst.attack.play();
      inst.idle.crossFadeTo(inst.attack, 0.15, false);
      const btn = this._slotFor(race);
      if (btn) btn.classList.add('is-attacking');
      this._syncRunning();
    }

    // ── loop ────────────────────────────────────────────────────────────

    // Draw only when it is worth drawing: on screen, tab in front, wide
    // enough to have a canvas, and somebody has touched the page recently.
    _syncRunning () {
      const want = !this._disposed &&
        !!this.renderer &&
        (this.state === 'loading' || this.state === 'ready') &&
        this._visible &&
        !document.hidden &&
        window.innerWidth >= MIN_WIDTH &&
        (Date.now() - this._lastInput) < IDLE_STOP_MS;
      if (want && !this._running) this._startLoop();
      else if (!want && this._running) this._stopLoop();
    }

    _startLoop () {
      this._running = true;
      // Reset the delta so a resumed loop does not replay the pause.
      if (this._clock) this._clock.getDelta();
      const tick = () => {
        if (!this._running || this._disposed) return;
        this._raf = requestAnimationFrame(tick);
        const dt = this._clock.getDelta();
        let moving = false;
        for (const inst of this.instances) {
          if (inst.mixer) inst.mixer.update(dt);
          const delta = inst.targetYaw - inst.yaw;
          if (Math.abs(delta) > 1e-3) {
            inst.yaw += delta * Math.min(1, dt * 6);
            this._faceNode(inst);
            moving = true;
          }
        }
        this._render();
        if (!moving && (Date.now() - this._lastInput) >= IDLE_STOP_MS) this._syncRunning();
      };
      this._raf = requestAnimationFrame(tick);
    }

    _stopLoop () {
      this._running = false;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = null;
    }

    _render () {
      if (this.renderer && this.scene && this.camera) this.renderer.render(this.scene, this.camera);
    }

    // ── state ───────────────────────────────────────────────────────────

    _setState (state) {
      this.state = state;
      this.host.dataset.state = state;
      if (state !== 'off') delete this.host.dataset.reason;
    }

    // Terminal. The portraits come back, the buttons keep working, and the
    // reason is on the element for anyone debugging a live page.
    _off (reason) {
      log('off:', reason);
      this._setState('off');
      this.host.dataset.reason = reason;
      for (const btn of this.slots) btn.classList.remove('is-loaded');
      this._stopLoop();
    }
  }

  HeroStage.HEROES = HEROES;
  HeroStage.MODEL_ASSET_VERSION = MODEL_ASSET_VERSION;
  HeroStage.THREE_URL = THREE_URL;

  window.HeroStage = HeroStage;
})();
