// Phase 0 spike UI: discover replay folders, scan them, parse a replay with
// the existing browser parser bundle, show the result.
//
// The point of this screen is to prove the thesis end to end — that the
// committed parser bundle runs unmodified inside the Tauri webview, reading
// replays and map data from local disk with no server involved. It is not the
// product UI.

const invoke = window.__TAURI__.core.invoke;
const listen = window.__TAURI__.event.listen;

const el = (id) => document.getElementById(id);
const fmtSize = (n) => `${(n / 1024).toFixed(0)} KB`;
const fmtDate = (ms) => new Date(ms).toLocaleString();

const state = {
  roots: [],
  replays: [],
  mapCacheDir: '',
  worker: null,
  jobId: 0,
  jobs: new Map()
};

const log = (msg, kind = '') => {
  const line = document.createElement('div');
  line.className = `log-line ${kind}`;
  line.textContent = msg;
  el('log').prepend(line);
};

// ── Parser worker ───────────────────────────────────────────────────────────

const ensureWorker = () => {
  if (state.worker) return state.worker;
  const w = new Worker('./js/parser-worker.js');

  w.onmessage = async (e) => {
    const msg = e.data;

    // The worker cannot reach Tauri IPC, so it asks us for map data.
    if (msg.type === 'need-map') {
      try {
        const cache = await loadMapCache(msg.mapDataName);
        w.postMessage({ type: 'map-data', reqId: msg.reqId, cache });
      } catch (err) {
        w.postMessage({ type: 'map-data', reqId: msg.reqId, error: err.message });
      }
      return;
    }

    const job = state.jobs.get(msg.id);
    if (!job) return;

    if (msg.type === 'progress') {
      const p = msg.evt || {};
      el('status').textContent = `${p.phase || 'parsing'} ${Math.round(p.percent || 0)}% ${p.detail || ''}`;
      return;
    }
    if (msg.type === 'done') {
      state.jobs.delete(msg.id);
      job.resolve(msg.result);
      return;
    }
    if (msg.type === 'error') {
      state.jobs.delete(msg.id);
      job.reject(Object.assign(new Error(msg.message), {
        code: msg.code, rawMapName: msg.rawMapName, mapDataName: msg.mapDataName
      }));
    }
  };

  w.onerror = (ev) => log(`worker crashed: ${ev.message}`, 'err');
  state.worker = w;
  return w;
};

// Map data lives on local disk under the app data dir. Files are gzipped
// JSON, exactly as the site serves them, so we inflate with the same DecompressionStream
// the platform provides rather than shipping a second copy of pako.
const loadMapCache = async (mapDataName) => {
  const read = async (file) => {
    const bytes = await invoke('read_map_file', { map: mapDataName, file });
    return new Uint8Array(bytes);
  };
  const gunzipJson = async (bytes) => {
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return JSON.parse(await new Response(stream).text());
  };

  const [wpm, doo, unit] = await Promise.all([
    read('wpm.json.gz').then(gunzipJson),
    read('doo.json.gz').then(gunzipJson),
    read('unit.json.gz').then(gunzipJson).catch(() => ({ units: [] }))
  ]);
  return { wpm, doo, unit };
};

const parseReplay = async (path) => {
  const w = ensureWorker();
  const bytes = await invoke('read_replay', { path });
  const buffer = new Uint8Array(bytes).buffer;
  const id = ++state.jobId;

  return new Promise((resolve, reject) => {
    state.jobs.set(id, { resolve, reject });
    w.postMessage({ type: 'parse', id, buffer }, [buffer]);
  });
};

// ── UI ──────────────────────────────────────────────────────────────────────

const renderRoots = () => {
  el('roots').innerHTML = state.roots.map(r => `
    <div class="root" data-path="${r.path}">
      <div class="root-path">${r.path}</div>
      <div class="root-meta">account ${r.account_id} · ${r.replay_count} replays</div>
    </div>`).join('') || '<div class="empty">No Warcraft III replay folders found.</div>';

  document.querySelectorAll('.root').forEach(node => {
    node.addEventListener('click', () => scan(node.dataset.path));
  });
};

const renderReplays = () => {
  const shown = state.replays.slice(0, 200);
  el('replays').innerHTML = shown.map(r => `
    <div class="replay ${r.interesting ? '' : 'dim'}" data-path="${r.path}">
      <div class="replay-name">${r.file_name}</div>
      <div class="replay-meta">
        ${fmtSize(r.size)} · ${fmtDate(r.modified_ms)}
        ${r.autosaved ? ' · autosaved' : ''}
        ${r.interesting ? '' : ' · aborted'}
      </div>
    </div>`).join('');

  document.querySelectorAll('.replay').forEach(node => {
    node.addEventListener('click', () => run(node.dataset.path));
  });
};

const scan = async (root) => {
  el('status').textContent = `scanning ${root}...`;
  state.replays = await invoke('scan_replays', { root });
  const interesting = state.replays.filter(r => r.interesting).length;
  el('status').textContent =
    `${state.replays.length} unique replays (${interesting} playable, ` +
    `${state.replays.length - interesting} aborted)`;
  renderReplays();
};

const run = async (path) => {
  el('result').textContent = '';
  el('status').textContent = 'reading...';
  const started = performance.now();
  try {
    const out = await parseReplay(path);
    const ms = Math.round(performance.now() - started);
    el('status').textContent = `parsed in ${ms} ms`;
    showResult(out, ms);
    log(`parsed ${path.split(/[\\/]/).pop()} in ${ms} ms`, 'ok');
  } catch (err) {
    el('status').textContent = 'failed';
    if (err.code === 'missing_map' || err.code === 'missing_map_cache') {
      log(`no local map data for "${err.mapDataName || err.rawMapName}" — ` +
          `copy client/maps/<name>/{wpm,doo,unit}.json.gz into the map cache`, 'warn');
    } else {
      log(`parse failed: ${err.message}`, 'err');
    }
  }
};

const showResult = (out, ms) => {
  const players = Object.values(out.players || {})
    .filter(p => p && p.playerName)
    .map(p => `  ${p.playerName} (${p.race || '?'})  apm ${p.apm || '-'}`)
    .join('\n');

  el('result').textContent = [
    `map:      ${out.replay?.metadata?.map?.mapName || '?'}`,
    `duration: ${Math.round((out.replay?.duration || 0) / 1000)}s`,
    `mode:     ${out.replay?.gameMode || '?'}`,
    `winner:   ${JSON.stringify(out.replay?.winner ?? null)}`,
    `parsed:   ${ms} ms`,
    '',
    'players:',
    players
  ].join('\n');
};

// ── Boot ────────────────────────────────────────────────────────────────────

const boot = async () => {
  const info = await invoke('init');
  state.roots = info.roots;
  state.mapCacheDir = info.map_cache_dir;
  el('cache-dir').textContent = info.map_cache_dir;
  renderRoots();

  const watched = await invoke('start_watching');
  log(`watching ${watched} replay folder(s)`, 'ok');

  await listen('replay-detected', (event) => {
    const r = event.payload;
    log(`new game: ${r.fileName} (${fmtSize(r.size)})`, 'ok');
    if (r.interesting) run(r.path);
  });

  await listen('watcher-error', (event) => log(`watcher: ${event.payload}`, 'err'));

  if (state.roots.length) scan(state.roots[0].path);
};

el('pick-folder').addEventListener('click', async () => {
  const dir = await window.__TAURI__.dialog.open({ directory: true });
  if (!dir) return;
  const root = await invoke('add_root', { path: dir });
  state.roots.push(root);
  renderRoots();
  scan(root.path);
});

boot().catch(e => log(`boot failed: ${e.message}`, 'err'));
