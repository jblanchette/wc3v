// replay-json-worker — parses an already-decompressed .wc3v JSON string in an
// isolated Web Worker so the multi-MB JSON.parse doesn't block the main tab.
//
// Why: server-served pro replays (.wc3v.gz) decompress to many MB of JSON.
// Parsing that synchronously on the main thread (the old app.js load() path)
// froze the page for hundreds of ms. The parse itself is pure CPU and has no
// DOM deps, so it moves cleanly into a worker. (This is NOT the .w3g binary
// parser — that's parser-worker.js.)
//
// Protocol:
//   main → worker:  { type: 'parse',       text: string }        (legacy)
//   main → worker:  { type: 'parseBuffer', buffer: ArrayBuffer }  (preferred)
//   worker → main:  { type: 'done', result: <parsed object> }
//                   { type: 'error', message: string }
//
// Prefer 'parseBuffer': the main thread hands over the raw response bytes as a
// TRANSFERABLE, so there is no multi-MB string on the main thread and no
// structured-clone copy on the way in. UTF-8 decoding happens here too.

self.onmessage = (e) => {
  const msg = e && e.data;
  if (!msg) return;

  try {
    let text;
    if (msg.type === 'parseBuffer') {
      text = new TextDecoder('utf-8').decode(new Uint8Array(msg.buffer));
    } else if (msg.type === 'parse') {
      text = msg.text;
    } else {
      return;
    }
    const result = JSON.parse(text);
    self.postMessage({ type: 'done', result });
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: (err && err.message) || String(err)
    });
  }
};
