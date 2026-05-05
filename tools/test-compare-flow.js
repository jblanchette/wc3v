// End-to-end test of the compare-to-pro flow:
//   1. Stage a parsed user replay in IndexedDB (via the bundle + UploadManager)
//   2. Load CompareView, build a user summary from the parsed JSON
//   3. Fetch a pro summary from the static summaries dir
//   4. Run ReplayAnalyzer.compare() and print the report card
//
// Validates: build summary derivation in CompareView matches what
// generate-summary.js produces (so the same parsed replay scored against
// itself yields ~100), plus archetype detection + guards work end-to-end.

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const REPLAY = process.argv[2] || '1342775468_Kaho_Happy_Hammerfall';
const REPLAY_W3G = path.resolve(ROOT, 'replays', `${REPLAY}.w3g`);
const SUMMARY_FILE = path.resolve(ROOT, 'client/data/summaries', `${REPLAY}.json`);
const MAPS_ROOT = path.resolve(ROOT, 'client/maps');

// Reuse the IDB stub and File polyfill from test-upload-flow.
const buildIdbStub = () => {
  const stores = {};
  return {
    open: () => {
      const req = {};
      setImmediate(() => {
        const db = {
          objectStoreNames: { contains: (n) => !!stores[n] },
          createObjectStore: (n, opts) => {
            stores[n] = { keyPath: opts.keyPath, data: new Map(), indexes: {} };
            return { createIndex: (idxName, key) => { stores[n].indexes[idxName] = key; } };
          },
          transaction: (storeName) => {
            const store = stores[storeName];
            const tx = { oncomplete: null, onerror: null, onabort: null };
            let pending = 0, done = false;
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
                    const all = [...store.data.values()].sort((a, b) => (b[key] || 0) - (a[key] || 0));
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

class File {
  constructor (buffer, name) { this._buf = buffer; this.name = name; this.size = buffer.length; }
  async arrayBuffer () { return this._buf.buffer.slice(this._buf.byteOffset, this._buf.byteOffset + this._buf.length); }
}

const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate,
  queueMicrotask, TextEncoder, TextDecoder, Uint8Array, Buffer,
  crypto: { getRandomValues: (arr) => { const buf = require('crypto').randomBytes(arr.length); for (let i = 0; i < arr.length; i++) arr[i] = buf[i]; return arr; } },
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  indexedDB: buildIdbStub(),
  File,
  globalThis: null, window: {}
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

sandbox.fetch = async (url) => {
  const mapsM = url.match(/^\/client\/maps\/([^/]+)\/(wpm|doo|unit)\.json(\.gz)?$/);
  if (mapsM) {
    const dir = decodeURIComponent(mapsM[1]);
    const which = mapsM[2];
    const gz = !!mapsM[3];
    const tryFiles = gz ? [`${which}.json.gz`, `${which}.json`] : [`${which}.json`, `${which}.json.gz`];
    for (const fname of tryFiles) {
      const fpath = path.join(MAPS_ROOT, dir, fname);
      if (!fs.existsSync(fpath)) continue;
      const buf = fs.readFileSync(fpath);
      const data = fname.endsWith('.gz') ? zlib.gunzipSync(buf) : buf;
      return { ok: true, status: 200, json: async () => JSON.parse(data.toString('utf8')) };
    }
    return { ok: false, status: 404, json: async () => null };
  }
  // Static data files: builds-manifest.json, summaries
  const dataM = url.match(/^\/data\/(.+)$/);
  if (dataM) {
    const fpath = path.resolve(ROOT, 'client/data', dataM[1]);
    if (fs.existsSync(fpath)) {
      const data = fs.readFileSync(fpath, 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(data) };
    }
    return { ok: false, status: 404, json: async () => null };
  }
  return { ok: false, status: 404, json: async () => null };
};

const loadIntoSandbox = (relPath) => {
  const src = fs.readFileSync(path.resolve(ROOT, relPath), 'utf8');
  vm.runInContext(src, sandbox);
};

vm.createContext(sandbox);
loadIntoSandbox('client/js/vendor/wc3v-parser.bundle.js');
loadIntoSandbox('client/js/MyReplays.js');
loadIntoSandbox('client/js/UploadManager.js');
loadIntoSandbox('client/js/ReplayAnalyzer.js');
loadIntoSandbox('client/js/CompareView.js');

const main = async () => {
  console.log('--- Wiring:');
  console.log('  Wc3vParser:', typeof sandbox.window.Wc3vParser);
  console.log('  ReplayAnalyzer:', typeof sandbox.window.ReplayAnalyzer);
  console.log('  CompareView:', typeof sandbox.window.CompareView);

  // Stage: parse a real replay into IndexedDB.
  const fileBuf = fs.readFileSync(REPLAY_W3G);
  const file = new File(fileBuf, `${REPLAY}.w3g`);
  const my = new sandbox.window.MyReplays();
  const uploader = new sandbox.window.UploadManager({ myReplays: my });
  const t0 = Date.now();
  console.log(`\n--- Parsing replay into IDB (${(file.size / 1024).toFixed(0)} KB)...`);
  const upload = await uploader.parseFile(file);
  console.log(`  upload ok in ${Date.now() - t0}ms, id=${upload.id}`);

  // Build a CompareView and ask it to derive a user summary.
  const view = new sandbox.window.CompareView();
  view.userRecords = [{
    id: upload.record.id,
    race: upload.record.race,
    mapName: upload.record.mapName,
    durationMs: upload.record.durationMs,
    players: upload.record.players,
    parsedJson: upload.record.parsedJson
  }];
  const userSummary = view._buildUserSummary(view.userRecords[0]);
  console.log('\n--- User summary derived:');
  console.log('  map:', userSummary.map);
  console.log('  durationMs:', userSummary.durationMs);
  console.log('  player slots:', Object.keys(userSummary.players).join(','));
  for (const slot of Object.keys(userSummary.players)) {
    const p = userSummary.players[slot];
    console.log(`  slot ${slot}: ${p.name} (${p.race}) archetype=${p.archetype} t2=${p.tier2Time} eco-samples=${p.economyTrack.length}`);
  }

  // Compare against the canonical pro summary.
  const proSummary = JSON.parse(fs.readFileSync(SUMMARY_FILE, 'utf8'));
  console.log(`\n--- Comparing user-parsed slot 2 (UD) to pro summary slot 2 (UD)...`);
  const report = sandbox.window.ReplayAnalyzer.compare({
    userSummary, userSlot: '2',
    proSummary, proSlot: '2',
    proResult: 'win'
  });
  console.log(`  overall: ${report.overall.score}/100 (${report.overall.grade})`);
  console.log(`  guards: ${JSON.stringify(report.guards)}`);
  for (const w of report.warnings) console.log(`  warning: ${w}`);
  for (const [k, v] of Object.entries(report.categories)) {
    console.log(`  ${k}: ${v.available ? `${v.score}/100 (${v.grade})` : `N/A — ${v.reason}`}`);
    for (const f of (v.findings || [])) console.log(`    - ${f.severity}: ${f.text}`);
  }

  if (report.overall.score < 95) {
    console.log('\nUNEXPECTED: self-compare scored below 95. Investigate summary derivation drift.');
    process.exit(1);
  }
  console.log('\n--- OK: end-to-end compare flow works; self-compare scored A.');
};

const keepalive = setInterval(() => {}, 1000);
main().then(() => clearInterval(keepalive)).catch(e => {
  clearInterval(keepalive);
  console.error('FAIL:', e.message);
  console.error(e.stack);
  process.exit(1);
});
