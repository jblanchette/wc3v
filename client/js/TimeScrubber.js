const ScrubSpeeds = {
  '1/4x': 0.25,
  '1/2x': 0.5,
  '1x': 1,
  '2x': 2,
  '3x': 3,
  '4x': 4,
  '5x': 10
};

const TimeScrubber = class {
  constructor (wrapperId, canvasId) {
    this.wrapperId = wrapperId;
    this.canvasId = canvasId;
    this.svgCache = {};

    const startingSpeed = '1x';
    this.speedKey = startingSpeed;
    this.setSpeed(startingSpeed);

    this.timeStep = this.getTimeStep();

    this.wrapperEl = null;
    this.trackerEl = null;
    this.domEl = null;
    this.canvas = null;
    this.ctx = null;
  }

  init () {
    const { wrapperId, canvasId, speedKey } = this;

    this.wrapperEl = document.getElementById(wrapperId);
    this.canvas = document.getElementById(canvasId);

    const existingDomEl = document.getElementById(`${wrapperId}-scrubber`);

    if (existingDomEl) {
      existingDomEl.remove();
    }

    const scrubSpeeds = Object
      .keys(ScrubSpeeds)
      .map(speed => { return `<li onClick="wc3v.scrubber.setSpeed('${speed}');">${speed}</li>` })
      .join("\n");

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
    <div class="time-scrubber-track">
      <div id="${wrapperId}-tracker" class="time-scrubber-tracker"></div>
    </div>`;

    this.wrapperEl.append(this.domEl);
    this.trackerEl = document.getElementById(`${wrapperId}-tracker`);

    this.loadSvg(`#${wrapperId}-play`, 'play-icon');
    this.loadSvg(`#${wrapperId}-play`, 'pause-icon', false);
    this.loadSvg(`#${wrapperId}-play`, 'stop-icon', false);
  }

  getTimeStep () {
    return (1000 / 60);
  }

  setSpeed (speedKey) {
    this.speedKey = speedKey;
    this.speed = ScrubSpeeds[speedKey];

    const speedKeyEl = document.getElementById(`${this.wrapperId}-speed-key`);

    // don't worry about setting this during init since we already do
    if (speedKeyEl) {
      speedKeyEl.innerHTML = speedKey;
    }
  }

  setupControls (domMap) {
    Object.keys(domMap).forEach(ctrlName => {
      const el = document.getElementById(`${this.wrapperId}-${ctrlName}`);
      el.addEventListener("click", domMap[ctrlName]);
    });
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
        target.innerHTML = ajax.responseText;
      }
    }
  }

  render (gameTime, matchEndTime) {
    const scrubberBox = this.wrapperEl.getBoundingClientRect();
    const { width } = scrubberBox;
    const matchPercentDone = (gameTime / matchEndTime) * 100;

    this.trackerEl.style.left = `${matchPercentDone}%`;
  }
};

window.TimeScrubber = TimeScrubber;
