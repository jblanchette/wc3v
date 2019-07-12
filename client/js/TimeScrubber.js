
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
  '5x': 5
};

const TImeScrubber = class {
  constructor () {
    this.time = 0;

    this.startTime = 0;
    this.endTime = 0;

    this.speed = ScrubSpeeds.1x;
    this.state = ScrubStates.stopped;
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
