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
//   main → worker:  { type: 'parse', text: string }
//   worker → main:  { type: 'done', result: <parsed object> }
//                   { type: 'error', message: string }

self.onmessage = (e) => {
  const msg = e && e.data;
  if (!msg || msg.type !== 'parse') return;

  try {
    const result = JSON.parse(msg.text);
    self.postMessage({ type: 'done', result });
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: (err && err.message) || String(err)
    });
  }
};
