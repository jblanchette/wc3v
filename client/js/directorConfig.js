/**
 * directorConfig.js — runtime-tunable constants for the AUTO broadcast camera
 * and the pacing director.
 *
 * These used to be ~50 module-local `const`s split across BroadcastCamera.js and
 * AutoDirector.js, so tuning the feel of a shot meant editing two files and
 * reloading. They are the numbers most likely to need adjusting by eye, and
 * "by eye" means changing them while watching a replay:
 *
 *     WC3V_DIRECTOR.shot.holdMs = 4000
 *
 * Shape mirrors clientConfig.js (IIFE + window + module.exports fallback) — the
 * client has no module system, and this is NOT the helpers/*.json pattern, which
 * is require()d server-side and unreachable from the browser.
 *
 * Anything not listed here is deliberately still a code constant: values that
 * encode a structural invariant rather than a taste judgement.
 */
(function () {
  var config = {
    // --- shot sequencing (AutoDirector) -------------------------------------
    // A shot change is an event with a beginning and an end. Speed resolves
    // FIRST, then the camera moves, so the two never fight each other.
    shot: {
      triggerDelta: 0.9,   // |change in target speed| that counts as a new shot
      decelMs: 250,        // speed resolves within this, camera held
      moveTimeoutMs: 1500, // give up waiting for "arrived" after this
      holdMs: 2500         // minimum dwell before another shot may fire
    },

    // --- pacing envelope (AutoDirector) -------------------------------------
    pacing: {
      minSpeed: 1.0,       // battles and key moments
      maxSpeed: 6.0,       // truly dead time
      activeSpeed: 3.0,    // busy macro
      activitySpeed: 2.0,  // floor when the frame is full of active units
      slowdownRate: 4.0,   // per-second convergence downward
      speedupRate: 3.0,    // ...and upward (transitions are announced, so this
                           //    no longer needs to creep to stay unnoticed)
      maxSlewPerS: 6.0
    },

    // --- camera smoothing (BroadcastCamera) ---------------------------------
    // Expressed as the per-frame fraction that felt right at 60fps; the camera
    // converts them to per-second time constants, so they behave identically at
    // any frame rate.
    camera: {
      panRateMin: 0.055,
      panRateMax: 0.17,
      zoomRateMin: 0.045,
      zoomRateMax: 0.11,
      panDeadzonePx: 3.5,
      hysteresisMs: 500    // a new cluster must keep winning this long to take over
    },

    // --- shot latching (BroadcastCamera) ------------------------------------
    // Keeps a held shot actually still. Past these thresholds a moving target is
    // treated as a new shot rather than as drift.
    latch: {
      recutPx: 420,
      recutZoomFrac: 0.35,
      followTc: 1.6        // seconds to absorb a small target move once settled
    }
  };

  if (typeof window !== 'undefined') window.WC3V_DIRECTOR = config;
  if (typeof module !== 'undefined' && module.exports) module.exports = config;
})();
