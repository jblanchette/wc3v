/**
 * clientConfig.js — global client-side config object.
 *
 * Loaded first on every HTML page (before Helpers.js / any subsystem) so the
 * rest of the client can read `window.WC3V_CONFIG` synchronously. The server
 * has its own `config/config.js`; this is the browser counterpart.
 *
 * Keep client `console.log` calls gated behind `WC3V_CONFIG.logging.*`.
 */
(function () {
  var hostname = (typeof window !== 'undefined' && window.location && window.location.hostname) || '';
  var isDev = (hostname === '127.0.0.1' || hostname === 'localhost');

  var config = {
    isDev: isDev,

    // Stable cache-buster for immutable assets (building GLBs, textures, SVGs).
    // Bump this string whenever those assets are regenerated/redeployed so the
    // browser + CDN refetch — using Date.now() instead defeats caching on every
    // single load (every map re-downloads all building models). In dev we keep
    // the always-fresh behaviour so local asset edits show up without a bump.
    assetVersion: '1',

    // Render-performance switches. Each one gates a single optimization so it
    // can be flipped at runtime (`WC3V_CONFIG.perf.instancedRings = false`) to
    // A/B a regression without a rebuild. Defaults are the FAST path — turning
    // one off restores the older, slower behaviour.
    perf: {
      // Max fixed-timestep catch-up iterations per animation frame. Without a
      // cap, a tab-switch or GC stall accumulates unbounded simulated time and
      // drains it in one frame (spiral of death). Dropping the excess is the
      // correct trade for a viewer: playback jumps, but the tab recovers.
      maxCatchupIterations: 5,
      // Draw unit selection rings + ground shadows as two InstancedMeshes
      // instead of two Meshes per unit (~2 draw calls + 2 materials per unit).
      instancedRings: true,
      // Let Three cull off-screen skinned units, and skip their AnimationMixer
      // ticks. Safe because animation state is a pure function of gameTime, so
      // a unit re-entering the frustum poses correctly with no catch-up.
      frustumCull: true,
      // Run the economy / dominance chart cursor updates even when their
      // bottom-panel tab is hidden. Off = skip the work nobody can see.
      chartsWhenHidden: false
    },

    // Per-area logging flags. Default off in production, on in dev.
    logging: {
      app:        isDev,
      three:      isDev,
      buildOrder: isDev,
      map:        isDev,
      net:        isDev,
      // Split-screen camera decisions (per-side anchor / bbox / zoom, throttled).
      // On in dev — toggle at runtime with `WC3V_CONFIG.logging.splitCamera = false`.
      splitCamera: isDev,
      // Parser + upload pipeline. Also propagated into the parser Web
      // Worker via a `?log=1` URL param, since the worker runs in its own
      // global scope and can't read this object.
      parser:     isDev
    }
  };

  // Light helper so callers can write `WC3V_CONFIG.log('three', ...)` without
  // sprinkling `if (...)` everywhere. No-op when the area flag is off.
  config.log = function (area /* , ...args */) {
    if (!config.logging || !config.logging[area]) return;
    var args = Array.prototype.slice.call(arguments, 1);
    // eslint-disable-next-line no-console
    console.log.apply(console, args);
  };

  if (typeof window !== 'undefined') {
    window.WC3V_CONFIG = config;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = config;
  }
})();
