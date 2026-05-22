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

    // Per-area logging flags. Default off in production, on in dev.
    logging: {
      app:        isDev,
      three:      isDev,
      buildOrder: isDev,
      map:        isDev,
      net:        isDev,
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
