// Minimal zlib shim for the browser parser bundle. Backed by pako.
//
// Why not browserify-zlib: it ships its own stream-based async pipeline that
// conflicts with native streams under Node's vm sandbox and is much heavier
// (300KB vs pako's 45KB). The parser only needs `inflate` (callback-style)
// and the `Z_*` constants, so we expose just those.

const pako = require('pako');

const constants = {
  Z_NO_FLUSH: 0,
  Z_PARTIAL_FLUSH: 1,
  Z_SYNC_FLUSH: 2,
  Z_FULL_FLUSH: 3,
  Z_FINISH: 4,
  Z_BLOCK: 5,
  Z_TREES: 6,
  Z_OK: 0,
  Z_STREAM_END: 1,
  Z_DEFLATED: 8
};

// Async-callback signature, sync underneath. w3gjs awaits a promise wrapping
// this — pako runs in a single tick so we keep the callback contract.
//
// w3gjs passes { finishFlush: Z_SYNC_FLUSH } because .w3g blocks are deflate
// streams that end with a SYNC_FLUSH marker rather than Z_FINISH. pako's
// chunked Inflate class tolerates that; the high-level inflate() does not.
// Async-callback signature, sync underneath. pako 1.x runs in a single tick
// so the callback contract is preserved.
const inflate = (buffer, options, callback) => {
  if (typeof options === 'function') { callback = options; options = {}; }
  try {
    const input = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const result = pako.inflate(input);
    callback(null, Buffer.from(result));
  } catch (e) {
    callback(e instanceof Error ? e : new Error(String(e)));
  }
};

const inflateRaw = (buffer, options, callback) => {
  if (typeof options === 'function') { callback = options; options = {}; }
  try {
    const input = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const result = pako.inflateRaw(input);
    callback(null, Buffer.from(result));
  } catch (e) {
    callback(e);
  }
};

const gunzip = (buffer, options, callback) => {
  if (typeof options === 'function') { callback = options; options = {}; }
  try {
    const input = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const result = pako.ungzip(input);
    callback(null, Buffer.from(result));
  } catch (e) {
    callback(e);
  }
};

// Exported sync variants too — used by some libs.
const inflateSync = (buffer) => Buffer.from(pako.inflate(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)));
const gunzipSync = (buffer) => Buffer.from(pako.ungzip(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)));

// Stub stream APIs — parser closure includes call sites (zipGameFile,
// PathFinder debug grid) but those are gated to CLI mode and never run in
// browser. Stubs throw to surface accidental use.
const notInBrowser = (name) => () => {
  throw new Error(`zlib.${name} is not available in the browser parser bundle`);
};

module.exports = {
  constants,
  inflate,
  inflateRaw,
  gunzip,
  inflateSync,
  gunzipSync,
  // legacy / sync alternatives expected by some libs
  ...constants,
  createGzip: notInBrowser('createGzip'),
  createGunzip: notInBrowser('createGunzip'),
  createInflate: notInBrowser('createInflate')
};
