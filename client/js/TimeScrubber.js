
const svgCache = {};

const ScrubStates = {
  stopped: 0,
  paused: 1,
  playing: 2,
  finished: 3
};

const ScrubSpeeds = {
  '1/4x': 0.25,
  '1/2x': 0.5,
  '1x': 1,
  '2x': 2,
  '3x': 3,
  '4x': 4,
  '5x': 5,
  get: (speed) => {
    return ScrubSpeeds[speed];
  }
};

const TimeScrubber = class {
  constructor (wrapperId, canvasId) {
    this.wrapperId = wrapperId;
    this.canvasId = canvasId;
    this.time = 0;

    this.startTime = 0;
    this.endTime = 0;

    this.speed = ScrubSpeeds.get('1x');
    this.state = ScrubStates.stopped;

    this.wrapperEl = null;
    this.domEl = null;
    this.canvas = null;
    this.ctx = null;
  }

  init () {
    this.wrapperEl = document.getElementById(this.wrapperId);
    this.canvas = document.getElementById(this.canvasId);

    if (this.domEl) {
      // clear out the old one
      this.domEl.remove();
    }

    this.domEl = document.createElement("div");
    this.domEl.setAttribute("id", `${this.wrapperId}-scrubber`);
    this.domEl.className = "time-scrubber";

    this.domEl.innerHTML = `
    <div id="${this.wrapperId}-play" class="time-scrubber-control play-button"></div>
    <div id="${this.wrapperId}-speed" class="time-scrubber-control speed-button">1x</div>
    <div class="time-scrubber-track">
      <div id="${this.wrapperId}-tracker" class="time-scrubber-tracker"></div>
    </div>`;

    this.wrapperEl.append(this.domEl);
    this.loadSvg(`#${this.wrapperId}-play`, 'play-icon');
    this.loadSvg(`#${this.wrapperId}-play`, 'pause-icon', false);

    this.setupControls();
  }

  setupControls () {
    const domMap = {
      "play": (e) => { this.togglePlay(e); }
    };

    Object.keys(domMap).forEach(ctrlName => {
      const el = document.getElementById(`${this.wrapperId}-${ctrlName}`);
      el.addEventListener("click", domMap[ctrlName]);
    });
  }

  loadSvg(selector, svgFile, updateDom = true) {
    const target = document.querySelector(selector);
    if (svgCache[svgFile] && updateDom) {
      target.innerHTML = svgCache[svgFile].responseText;

      return;
    }

    // Request the SVG file
    const ajax = new XMLHttpRequest();
    ajax.open("GET", `/assets/${svgFile}.svg`, true);
    ajax.send();

    // Append the SVG to the target
    ajax.onload = (e) => {
      svgCache[svgFile] = {
        responseText: ajax.responseText
      };

      if (updateDom) {
        target.innerHTML = ajax.responseText;
      }
    }
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

  play () {
    this.loadSvg(`#${this.wrapperId}-play`, 'pause-icon');
    this.state = ScrubStates.playing;
  }

  pause () {
    this.loadSvg(`#${this.wrapperId}-play`, 'play-icon');
    this.state = ScrubStates.paused;
  }


  renderScrubber () {
    
  }

  render () {
    
  }
};

window.TimeScrubber = TimeScrubber;
