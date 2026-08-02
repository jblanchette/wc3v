// Desktop parser worker — hosts the wc3v parser bundle in an isolated Worker.
//
// Same reasoning as the web client's client/js/parser-worker.js: the parser
// handles untrusted binary data, so it runs off the main thread where a
// malformed replay can be hard-killed with worker.terminate().
//
// The one difference from the web version is map data. In the browser the
// parser's default loader fetches /maps/<name>/{wpm,doo,unit}.json.gz over
// HTTP. Here the files live on local disk behind a Tauri command, and Tauri's
// IPC is not reachable from a Worker. Rather than move the map peek onto the
// main thread (which would split the parse into two code paths), we use the
// parser's injectable `mapDataLoader` hook and bounce the request back to the
// main thread over postMessage.
//
// Protocol
//   main → worker  { type: 'parse', buffer, id }
//                  { type: 'map-data', reqId, cache | error }
//   worker → main  { type: 'need-map', reqId, mapDataName }
//                  { type: 'progress', evt }
//                  { type: 'done', id, result }
//                  { type: 'error', id, message, code?, rawMapName?, mapDataName? }

(function () {
  // The bundled parser and its vendored w3gjs log liberally while parsing —
  // noisy on every game, louder on malformed input, and never actionable for
  // an end user. Silence it before the bundle loads unless explicitly asked.
  if (!/[?&]log=1(?:&|$)/.test(self.location.search || '')) {
    var noop = function () {};
    ['log', 'info', 'debug', 'warn', 'error'].forEach(function (m) {
      try { console[m] = noop; } catch (e) {}
    });
  }
})();

importScripts('./vendor/wc3v-parser.bundle.js');

// Pending map-data requests, keyed by an id we hand to the main thread.
var _mapReqId = 0;
var _mapPending = new Map();

const requestMapData = (mapDataName) => new Promise((resolve, reject) => {
  const reqId = ++_mapReqId;
  _mapPending.set(reqId, { resolve, reject });
  self.postMessage({ type: 'need-map', reqId: reqId, mapDataName: mapDataName });
});

// Matches the shape of client/js/parser/browserMapLoader.js — returns null on
// a miss so the parser raises its own clean "missing map cache" error.
const desktopMapLoader = {
  async fetchCache (mapDataName) {
    try {
      return await requestMapData(mapDataName);
    } catch (e) {
      return null;
    }
  }
};

self.onmessage = async (e) => {
  const msg = e && e.data;
  if (!msg) return;

  if (msg.type === 'map-data') {
    const pending = _mapPending.get(msg.reqId);
    if (!pending) return;
    _mapPending.delete(msg.reqId);
    if (msg.error) pending.reject(new Error(msg.error));
    else pending.resolve(msg.cache);
    return;
  }

  if (msg.type !== 'parse') return;

  const parser = self.Wc3vParser;
  if (!parser || typeof parser.parseToWc3v !== 'function') {
    self.postMessage({
      type: 'error',
      id: msg.id,
      message: 'parser bundle did not expose parseToWc3v'
    });
    return;
  }

  try {
    const result = await parser.parseToWc3v(msg.buffer, {
      mapDataLoader: desktopMapLoader,
      onProgress: (evt) => self.postMessage({ type: 'progress', id: msg.id, evt: evt })
    });
    self.postMessage({ type: 'done', id: msg.id, result: result });
  } catch (err) {
    self.postMessage({
      type: 'error',
      id: msg.id,
      message: (err && err.message) || String(err),
      code: err && err.code,
      rawMapName: err && err.rawMapName,
      mapDataName: err && err.mapDataName
    });
  }
};
