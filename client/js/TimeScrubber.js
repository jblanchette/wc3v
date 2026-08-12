const ScrubSpeeds = {
  '1/4x': 0.25,
  '1/2x': 0.5,
  '1x': 1,
  '2x': 2,
  '3x': 3,
  '5x': 5,
  '10x': 10,
  '20x': 20,
  '40x': 40
};

const TimeScrubber = class {
  constructor (wrapperId, canvasId) {
    this.isDev = (window.location.hostname === "127.0.0.1");
    this.wrapperId = wrapperId;
    this.canvasId = canvasId;
    this.svgCache = {};

    // AUTO (dynamic time-scale) is only offered in 1v1 — the viewer flips this
    // on via setAutoAvailable() once the game mode is known (after parse).
    this.autoAvailable = false;
    this.isAuto = false;

    const startingSpeed = '3x';
    this.speedKey = startingSpeed;
    this.setSpeed(startingSpeed);

    this.timeStep = this.getTimeStep();

    this.wrapperEl = null;
    this.trackerEl = null;
    this.domEl = null;
    this.canvas = null;
    this.ctx = null;

    this.onZoomChange = null;
    this.zoomLabelEl = null;
    this.zoomSliderEl = null;
  }

  init () {
    const { wrapperId, canvasId, speedKey } = this;

    this.wrapperEl = document.getElementById(wrapperId);
    this.canvas = document.getElementById(canvasId);

    const existingDomEl = document.getElementById(`${wrapperId}-scrubber`);

    if (existingDomEl) {
      existingDomEl.remove();
    }

    // remove any placeholder content
    this.wrapperEl.innerHTML = '';

    const scrubSpeeds = this._speedListHtml();

    this.domEl = document.createElement("div");
    this.domEl.setAttribute("id", `${wrapperId}-scrubber`);
    this.domEl.className = "time-scrubber";

    this.domEl.innerHTML = `
    <div id="${wrapperId}-play" class="time-scrubber-control play-button"></div>
    <div id="${wrapperId}-speed" class="time-scrubber-control speed-button">
      <span id="${wrapperId}-speed-key">${speedKey}</span>

      <div id="${wrapperId}-speed-modal" class="speed-modal">
        <ul>${scrubSpeeds}</ul>
      </div>
    </div>
    <div id="${wrapperId}-track" class="time-scrubber-track">
      <div id="${wrapperId}-tracker" class="time-scrubber-tracker"></div>
    </div>
    <div class="zoom-control">
      <span id="${wrapperId}-zoom-label" class="zoom-label">100%</span>
      <div id="${wrapperId}-zoom-out" class="zoom-btn">−</div>
      <input id="${wrapperId}-zoom-slider" class="zoom-slider" type="range"
        min="100" max="300" step="5" value="100" />
      <div id="${wrapperId}-zoom-in" class="zoom-btn">+</div>
    </div>
    <div id="${wrapperId}-fullscreen" class="time-scrubber-control fullscreen-button">
      <div id="${wrapperId}-fullscreen-icon" class="fullscreen-icon-wrap"></div>
    </div>
    <div id="${wrapperId}-settings" class="time-scrubber-control settings-button">
      <div id="${wrapperId}-settings-icon" class="settings-icon-wrap"></div>
      <div id="${wrapperId}-settings-modal" class="settings-modal"></div>
    </div>`;

    this.wrapperEl.append(this.domEl);
    this.trackerEl = document.getElementById(`${wrapperId}-tracker`);

    this.loadSvg(`#${wrapperId}-play`, 'play-icon');
    this.loadSvg(`#${wrapperId}-play`, 'pause-icon', false);
    this.loadSvg(`#${wrapperId}-play`, 'stop-icon', false);
    this.loadSvg(`#${wrapperId}-settings-icon`, 'settings-icon');
    this.loadSvg(`#${wrapperId}-fullscreen-icon`, 'fullscreen-icon');
    this.loadSvg(`#${wrapperId}-fullscreen-icon`, 'fullscreen-exit-icon', false);

    this.zoomLabelEl = document.getElementById(`${wrapperId}-zoom-label`);
    this.zoomSliderEl = document.getElementById(`${wrapperId}-zoom-slider`);

    const zoomSlider = this.zoomSliderEl;
    const zoomOut = document.getElementById(`${wrapperId}-zoom-out`);
    const zoomIn = document.getElementById(`${wrapperId}-zoom-in`);

    zoomSlider.addEventListener('input', () => {
      const k = parseInt(zoomSlider.value, 10) / 100;
      this.zoomLabelEl.textContent = zoomSlider.value + '%';
      if (this.onZoomChange) this.onZoomChange(k);
    });

    zoomOut.addEventListener('click', (e) => {
      e.stopPropagation();
      const step = parseInt(zoomSlider.step, 10);
      zoomSlider.value = Math.max(parseInt(zoomSlider.min, 10), parseInt(zoomSlider.value, 10) - step);
      zoomSlider.dispatchEvent(new Event('input'));
    });

    zoomIn.addEventListener('click', (e) => {
      e.stopPropagation();
      const step = parseInt(zoomSlider.step, 10);
      zoomSlider.value = Math.min(parseInt(zoomSlider.max, 10), parseInt(zoomSlider.value, 10) + step);
      zoomSlider.dispatchEvent(new Event('input'));
    });
  }

  getTimeStep () {
    return (1000 / 60);
  }

  // List of <li> options for the speed modal. AUTO is prepended only when the
  // viewer has enabled it (1v1). Defined as a helper so setAutoAvailable() can
  // rebuild the list after the game mode is known.
  _speedListHtml () {
    const keys = this.autoAvailable ? ['AUTO', ...Object.keys(ScrubSpeeds)] : Object.keys(ScrubSpeeds);
    return keys
      .map(speed => `<li onClick="wc3v.scrubber.setSpeed('${speed}');">${speed}</li>`)
      .join("\n");
  }

  // Enable/disable the AUTO option (1v1 only). Rebuilds the dropdown and falls
  // back to a fixed speed if AUTO is removed while selected.
  setAutoAvailable (avail) {
    this.autoAvailable = !!avail;
    const ul = document.querySelector(`#${this.wrapperId}-speed-modal ul`);
    if (ul) ul.innerHTML = this._speedListHtml();
    if (!this.autoAvailable && this.isAuto) this.setSpeed('3x');
  }

  setSpeed (speedKey) {
    this.speedKey = speedKey;
    this.isAuto = (speedKey === 'AUTO');
    this._lastAutoLabel = null;

    // In AUTO the AutoDirector overwrites .speed each frame; seed a sane
    // baseline so anything reading .speed before the first director tick works.
    this.speed = this.isAuto ? (this.speed || ScrubSpeeds['3x']) : ScrubSpeeds[speedKey];

    // The AUTO readout ("AUTO 8×") is wider than a fixed speed — let the button
    // grow for it via a class toggle (see .speed-button.is-auto in main.css).
    const speedBtnEl = document.getElementById(`${this.wrapperId}-speed`);
    if (speedBtnEl) speedBtnEl.classList.toggle('is-auto', this.isAuto);

    const speedKeyEl = document.getElementById(`${this.wrapperId}-speed-key`);

    // don't worry about setting this during init since we already do
    if (speedKeyEl) {
      speedKeyEl.innerHTML = speedKey;
    }
  }

  // Live AUTO readout — the main loop calls this each frame with the director's
  // current multiplier so the speed button shows e.g. "AUTO 8×".
  updateAutoReadout (mult) {
    if (!this.isAuto) return;
    // Diff on the QUANTIZED number, before any string is built — this runs
    // every frame and the old check still paid a toFixed + template string
    // per frame just to discover nothing changed.
    const q = (mult >= 9.95) ? 100 : Math.round(mult * 10);
    if (q === this._lastAutoQ) return;
    this._lastAutoQ = q;
    const label = `AUTO ${q === 100 ? '10' : (q / 10).toFixed(1)}×`;
    let el = this._speedKeyEl;
    if (!el || !el.isConnected) el = this._speedKeyEl = document.getElementById(`${this.wrapperId}-speed-key`);
    if (el) el.textContent = label;
  }

  setupControls (domMap) {
    Object.keys(domMap).forEach(ctrlName => {
      const el = document.getElementById(`${this.wrapperId}-${ctrlName}`);
      el.addEventListener("click", domMap[ctrlName]);
    });
  }

  findTrackerPosition (e, matchEndTime) {
    const width = e.target.scrollWidth;
    const trackPosition = e.offsetX === 0 ? 0 : (e.offsetX / width);

    return {
      gameTime: Math.floor(matchEndTime * trackPosition),
      matchPercentage: (trackPosition * 100).toPrecision(2)
    };
  }

  moveTracker (matchPercentDone) {
    // Defensive: render() can fire from a zoom event before init() has run
    // in some load orderings. Skip silently rather than crash the loop.
    if (!this.trackerEl) return;
    // Quantize to 0.01% — style.left was written unconditionally every frame,
    // and sub-hundredth movement is invisible at any scrubber width.
    const q = Math.round(matchPercentDone * 100) / 100;
    if (q === this._lastTrackerPct) return;
    this._lastTrackerPct = q;
    this.trackerEl.style.left = `${q}%`;
  }

  updateZoomDisplay (k) {
    if (!this.zoomLabelEl || !this.zoomSliderEl) return;
    const pct = Math.round(k * 100);
    // The broadcast camera re-applies its transform every frame, and the d3
    // zoom handler forwards every one of those here — two unconditional DOM
    // writes per frame for a number that changes maybe once a second.
    if (pct === this._lastZoomPct) return;
    this._lastZoomPct = pct;
    this.zoomLabelEl.textContent = pct + '%';
    this.zoomSliderEl.value = pct;
  }

  loadSvg(selector, svgFile, updateDom = true) {
    let target = document.querySelector(selector);
    if (this.svgCache[svgFile] && updateDom) {
      target.innerHTML = this.svgCache[svgFile].responseText;

      return;
    }

    // Request the SVG file
    const ajax = new XMLHttpRequest();
    ajax.open("GET", `/assets/${svgFile}.svg`, true);
    ajax.send();

    // Append the SVG to the target
    ajax.onload = (e) => {
      this.svgCache[svgFile] = {
        responseText: ajax.responseText
      };

      if (updateDom) {
        target = document.querySelector(selector);
        if (target) {
          target.innerHTML = ajax.responseText;
        }
      }
    }
  }

  render (gameTime, matchEndTime) {
    const matchPercentDone = Math.min(100, (gameTime / matchEndTime) * 100);
    this.moveTracker(matchPercentDone);
  }

  // Battle chevrons — small clickable marks above the scrubber track for every
  // detected battle. Mirrors the DOM-driven nature of the rest of the scrubber
  // (track is a <div>, not a canvas) so we use absolute-positioned DOM nodes.
  // Called once per replay load from Wc3vViewer.setupBattleMarkers.
  setBattleMarkers (battles, matchEndTime, onClick) {
    const trackEl = document.getElementById(`${this.wrapperId}-track`);
    if (!trackEl) return;

    // Wipe any previous markers (e.g. on replay-switch reload).
    const old = trackEl.querySelectorAll('.battle-marker');
    old.forEach(n => n.remove());

    if (!battles || !battles.length || !matchEndTime) return;

    for (const b of battles) {
      const startPct = Math.max(0, Math.min(100, (b.startTime / matchEndTime) * 100));
      const widthPct = Math.max(0.4, Math.min(100, ((b.endTime - b.startTime) / matchEndTime) * 100));
      const color = (window.BattleCategoryColor && window.BattleCategoryColor[b.category]) || '#FFD166';
      const el = document.createElement('div');
      el.className = `battle-marker battle-marker-${b.category}`;
      el.style.left  = `${startPct}%`;
      el.style.width = `${widthPct}%`;
      el.style.backgroundColor = color;
      el.title = `${b.category}  ${Math.floor(b.startTime/60000)}:${String(Math.floor((b.startTime%60000)/1000)).padStart(2,'0')}` +
                 `  (${(b.durationMs/1000).toFixed(0)}s)`;
      el.dataset.battleId = b.id;
      if (typeof onClick === 'function') {
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          onClick(b);
        });
      }
      trackEl.appendChild(el);
    }
  }

  // Quarter-time guide markers — subtle ticks at 1/4, 1/2, 3/4 of the match with
  // a pie-fill icon and minute label below the track. Read-only references; do not
  // intercept clicks. Called once per replay load from Wc3vViewer setup.
  setTimeGuides (matchEndTime) {
    const trackEl = document.getElementById(`${this.wrapperId}-track`);
    if (!trackEl) return;

    const old = trackEl.querySelectorAll('.scrubber-tg-marker');
    old.forEach(n => n.remove());

    if (!matchEndTime || matchEndTime < 240000) return;

    const guides = [
      { pct: 25, fill: 0.25 },
      { pct: 50, fill: 0.5 },
      { pct: 75, fill: 0.75 }
    ];

    for (const g of guides) {
      const minutes = Math.round((matchEndTime * g.pct / 100) / 60000);
      const marker = document.createElement('div');
      marker.className = 'scrubber-tg-marker';
      marker.style.left = `${g.pct}%`;
      marker.innerHTML = `
        <div class="scrubber-tg-tick"></div>
        <div class="scrubber-tg-icon" style="--fill: ${g.fill}"></div>
        <div class="scrubber-tg-label">${minutes}m</div>
      `;
      trackEl.appendChild(marker);
    }
  }
};

window.TimeScrubber = TimeScrubber;
