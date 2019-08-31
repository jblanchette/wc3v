
const distance = (pX, pY, qX, qY) => {
  return Math.sqrt(
    Math.pow(qX - pX, 2) +
    Math.pow(qY - pY, 2)
  );
};

const Helpers = {
  distance: distance,

  // constants
  MS_TO_SECONDS: 0.001,
  SECONDS_TO_MS: 1000
};

window.Helpers = Helpers;
