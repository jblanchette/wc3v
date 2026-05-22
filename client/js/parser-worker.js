// parser-worker — runs the wc3v parser bundle in an isolated Web Worker.
//
// Why: the parser handles untrusted .w3g binary data. A malformed file can
// trigger unbounded loops or massive allocations inside the bundled w3gjs
// library, which would freeze or crash the main tab. Hosting the parser in
// a worker lets the page stay responsive and lets us hard-kill the parse
// (worker.terminate) on timeout without leaking memory.
//
// Protocol:
//   main → worker:  { type: 'parse', buffer: ArrayBuffer }   (transferable)
//   worker → main:  { type: 'progress', evt: {...} }
//                   { type: 'done', result: {...} }
//                   { type: 'error', message, code?, rawMapName?, mapDataName? }
//
// Console hygiene: the bundled wc3v + vendored w3gjs code emits raw
// console.log/warn/error while parsing — noisy on every upload, and louder
// on malformed or hostile replays (w3gjs prints "Unknown chunk detected",
// "unknown action id", etc. for any bytes it doesn't recognise). None of it
// is actionable for an end user. It is not a security issue — a Worker has
// no DOM, and console output is rendered as inert text, never executed —
// but it is noise we don't want in a production console. We no-op the
// console here before the bundle loads; pass the `?log=1` worker URL param
// (UploadManager does this when WC3V_CONFIG.logging.parser is on) to keep it.

(function () {
  var keepLogs = /[?&]log=1(?:&|$)/.test(self.location && self.location.search || '');
  if (keepLogs) return;
  var noop = function () {};
  ['log', 'info', 'debug', 'warn', 'error'].forEach(function (method) {
    try { console[method] = noop; } catch (e) {}
  });
})();

importScripts('/js/vendor/wc3v-parser.bundle.js');

self.onmessage = async (e) => {
  const msg = e && e.data;
  if (!msg || msg.type !== 'parse') return;

  const parser = self.Wc3vParser;
  if (!parser || typeof parser.parseToWc3v !== 'function') {
    self.postMessage({
      type: 'error',
      message: 'Wc3vParser bundle did not expose parseToWc3v in worker scope'
    });
    return;
  }

  try {
    const result = await parser.parseToWc3v(msg.buffer, {
      onProgress: (evt) => {
        // Forward parser progress to the main thread. These are plain
        // objects (phase, percent, gameTimeMs, etc.) — structured-cloneable.
        self.postMessage({ type: 'progress', evt });
      }
    });
    self.postMessage({ type: 'done', result });
  } catch (err) {
    // Strip down to plain fields so the structured clone doesn't fail on
    // exotic Error subclasses. Preserve the codes UploadManager already
    // surfaces (missing_map / missing_map_cache).
    self.postMessage({
      type: 'error',
      message: (err && err.message) || String(err),
      code: err && err.code,
      rawMapName: err && err.rawMapName,
      mapDataName: err && err.mapDataName
    });
  }
};
