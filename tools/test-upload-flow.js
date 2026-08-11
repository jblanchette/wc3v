// End-to-end test of the browser upload flow:
//   File buffer → UploadManager.parseFile → MyReplays IndexedDB store →
//   loadLocal-equivalent retrieval → output matches canonical (UUID-stripped).
//
// Runs in Node with a minimal browser shim. Validates that the full
// integration (parser bundle + UploadManager + MyReplays) works without a
// real browser.
//
// Real browser smoke is still required for UI correctness (drag-and-drop,
// progress UI, navigation), but this catches all logic errors.

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const REPLAY = process.argv[2] || '1342775468_Kaho_Happy_Hammerfall';
const REPLAY_W3G = path.resolve(ROOT, 'replays', `${REPLAY}.w3g`);
const REPLAY_WC3V = path.resolve(ROOT, 'client/replays', `${REPLAY}.wc3v.gz`);
const MAPS_ROOT = path.resolve(ROOT, 'client/maps');

// In-memory IndexedDB stub (just enough surface for MyReplays). Each tx
// tracks its outstanding requests and only fires tx.oncomplete after all
// pending requests have resolved AND any cursor traversal has finished.
const buildIdbStub = () => {
  const stores = {};
  return {
    open: (name) => {
      const req = {};
      setImmediate(() => {
        const db = {
          objectStoreNames: { contains: (n) => !!stores[n] },
          createObjectStore: (n, opts) => {
            stores[n] = { keyPath: opts.keyPath, data: new Map(), indexes: {} };
            return {
              createIndex: (idxName, key) => {
                stores[n].indexes[idxName] = key;
              }
            };
          },
          transaction: (storeName) => {
            const store = stores[storeName];
            const tx = { oncomplete: null, onerror: null, onabort: null };
            let pending = 0;
            let done = false;

            const begin = () => { pending += 1; };
            const finish = () => {
              pending -= 1;
              if (pending === 0 && !done) {
                done = true;
                setImmediate(() => { if (tx.oncomplete) tx.oncomplete(); });
              }
            };

            tx.objectStore = () => ({
              put: (record) => {
                const r = {};
                begin();
                setImmediate(() => {
                  store.data.set(record[store.keyPath], record);
                  if (r.onsuccess) r.onsuccess();
                  finish();
                });
                return r;
              },
              get: (key) => {
                const r = {};
                begin();
                setImmediate(() => {
                  r.result = store.data.get(key) || null;
                  if (r.onsuccess) r.onsuccess({ target: r });
                  finish();
                });
                return r;
              },
              delete: (key) => {
                const r = {};
                begin();
                setImmediate(() => {
                  store.data.delete(key);
                  if (r.onsuccess) r.onsuccess();
                  finish();
                });
                return r;
              },
              index: (idxName) => ({
                openCursor: () => {
                  const r = {};
                  begin();
                  setImmediate(() => {
                    const key = store.indexes[idxName];
                    const all = [...store.data.values()];
                    all.sort((a, b) => (b[key] || 0) - (a[key] || 0));  // 'prev' direction
                    let i = 0;
                    const stepCursor = () => {
                      if (i >= all.length) {
                        r.result = null;
                        if (r.onsuccess) r.onsuccess({ target: r });
                        finish();
                        return;
                      }
                      const item = all[i++];
                      r.result = { value: item, continue: () => setImmediate(stepCursor) };
                      if (r.onsuccess) r.onsuccess({ target: r });
                    };
                    stepCursor();
                  });
                  return r;
                }
              })
            });
            // A tx has at least one implicit phase. Add a minimal request so
            // empty-tx case still completes. (Not actually used by MyReplays.)
            return tx;
          }
        };
        if (req.onupgradeneeded) req.onupgradeneeded({ target: { result: db } });
        if (req.onsuccess) req.onsuccess({ target: { result: db } });
      });
      return req;
    }
  };
};

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  setImmediate,
  queueMicrotask,
  TextEncoder,
  TextDecoder,
  Uint8Array,
  Buffer,
  crypto: {
    getRandomValues: (arr) => {
      const buf = require('crypto').randomBytes(arr.length);
      for (let i = 0; i < arr.length; i++) arr[i] = buf[i];
      return arr;
    }
  },
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  indexedDB: buildIdbStub(),
  globalThis: null,
  window: {}
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

sandbox.fetch = async (url) => {
  const m = url.match(/^\/client\/maps\/([^/]+)\/(wpm|doo|unit)\.json(\.gz)?$/);
  if (!m) return { ok: false, status: 404, json: async () => null };
  const dir = decodeURIComponent(m[1]);
  const which = m[2];
  const gz = !!m[3];
  const tryFiles = gz ? [`${which}.json.gz`, `${which}.json`] : [`${which}.json`, `${which}.json.gz`];
  for (const fname of tryFiles) {
    const fpath = path.join(MAPS_ROOT, dir, fname);
    if (!fs.existsSync(fpath)) continue;
    const buf = fs.readFileSync(fpath);
    const data = fname.endsWith('.gz') ? zlib.gunzipSync(buf) : buf;
    return { ok: true, status: 200, json: async () => JSON.parse(data.toString('utf8')) };
  }
  return { ok: false, status: 404, json: async () => null };
};

// Minimal File polyfill for UploadManager.parseFile().
class File {
  constructor (buffer, name) {
    this._buf = buffer;
    this.name = name;
    this.size = buffer.length;
  }
  async arrayBuffer () { return this._buf.buffer.slice(this._buf.byteOffset, this._buf.byteOffset + this._buf.length); }
}
sandbox.File = File;

// Load the parser bundle, MyReplays, UploadManager into the sandbox.
const loadIntoSandbox = (relPath) => {
  const src = fs.readFileSync(path.resolve(ROOT, relPath), 'utf8');
  vm.runInContext(src, sandbox);
};

vm.createContext(sandbox);
loadIntoSandbox('client/js/vendor/wc3v-parser.bundle.js');
// Security first: MyReplays destructures Security.escapeAttr at load time,
// and viewer.html loads it the same way round.
loadIntoSandbox('client/js/Security.js');
loadIntoSandbox('client/js/MyReplays.js');
loadIntoSandbox('client/js/UploadManager.js');

const main = async () => {
  console.log('--- Wiring check:');
  console.log('  Wc3vParser:', typeof sandbox.window.Wc3vParser);
  console.log('  MyReplays:', typeof sandbox.window.MyReplays);
  console.log('  UploadManager:', typeof sandbox.window.UploadManager);

  if (!sandbox.window.UploadManager) throw new Error('UploadManager not exposed');

  // Build the same instance the homepage will build.
  const my = new sandbox.window.MyReplays();
  const uploader = new sandbox.window.UploadManager({ myReplays: my });

  console.log('--- Upload flow:');
  const fileBuf = fs.readFileSync(REPLAY_W3G);
  const file = new File(fileBuf, `${REPLAY}.w3g`);
  console.log(`  file built (${file.size} bytes)`);

  // Wire onProgress so we see phase transitions during the hang.
  uploader.onProgress = (p) => console.log(`  progress: ${JSON.stringify(p)}`);

  const t0 = Date.now();
  console.log('  calling parseFile...');
  const result = await uploader.parseFile(file);
  const t1 = Date.now();
  console.log(`  parseFile ok in ${t1 - t0}ms, id=${result.id}`);

  // Pull the record back out the way loadLocal does.
  const stored = await my.get(result.id);
  if (!stored || !stored.parsedJson) throw new Error('Stored record missing parsedJson');
  console.log(`  IndexedDB roundtrip ok, parsedJson keys: ${Object.keys(stored.parsedJson).join(',')}`);

  // List shows the record.
  const list = await my.list();
  console.log(`  my.list() returned ${list.length} record(s); first id: ${list[0] && list[0].id}`);

  // Compare against canonical.
  if (!fs.existsSync(REPLAY_WC3V)) {
    console.warn('  No canonical .wc3v.gz to compare against. Upload flow succeeded.');
    return;
  }
  const canonical = JSON.parse(zlib.gunzipSync(fs.readFileSync(REPLAY_WC3V)).toString('utf8'));
  const stripVolatile = (o) => JSON.stringify(o)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID')
    .replace(/"(ground|cliff|water|shallowWater|tree)Color":"[^"]*"/g, '"$1Color":"X"')
    .replace(/"treeStroke":"[^"]*"/g, '"treeStroke":"X"')
    .replace(/\\\\/g, '/');
  const a = stripVolatile(canonical);
  const b = stripVolatile(stored.parsedJson);
  console.log(`  canonical len: ${a.length}, stored len: ${b.length}, identical: ${a === b}`);
  if (a !== b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    console.log(`  first diff at ${i}: canonical="${a.slice(Math.max(0, i - 30), i + 50)}" stored="${b.slice(Math.max(0, i - 30), i + 50)}"`);
    process.exit(1);
  }
  console.log('--- OK: full upload flow + storage + retrieval matches canonical output.');
};

// Keep the event loop alive while the parser's microtask chain runs.
// Without this, the queueMicrotask-driven parser yields control with no
// pending macrotask and the process exits cleanly mid-parse.
const keepalive = setInterval(() => {}, 1000);

main()
  .then(() => clearInterval(keepalive))
  .catch(e => {
    clearInterval(keepalive);
    console.error('FAIL:', e.message);
    console.error(e.stack);
    process.exit(1);
  });
