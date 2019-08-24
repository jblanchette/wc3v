
const ScrubStates = {
  stopped: 0,
  paused: 1,
  playing: 1,
  finished: 2
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
    <div id="${this.wrapperId}-play" class="time-scrubber-control speed-button">1x</div>
    <div class="time-scrubber-track">
      <div id="${this.wrapperId}-tracker" class="time-scrubber-tracker"></div>
    </div>`;

    this.wrapperEl.append(this.domEl);
  }


  play () {

  }

  pause () {

  }


  renderScrubber () {
    
  }

  render () {
    
  }
};

window.TimeScrubber = TimeScrubber;
