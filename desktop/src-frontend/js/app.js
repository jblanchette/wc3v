// Phase 0 spike UI: discover replay folders, scan them, parse a replay with
// the existing browser parser bundle, show the result.
//
// The point of this screen is to prove the thesis end to end — that the
// committed parser bundle runs unmodified inside the Tauri webview, reading
// replays and map data from local disk with no server involved. It is not the
// product UI.

// Tauri v2 does NOT expose window.__TAURI__ unless `app.withGlobalTauri` is
// true in tauri.conf.json — the default assumes you import @tauri-apps/api
// through a bundler. This project has no bundler, so we rely on the global.
// Reading it at module scope without checking means a config regression throws
// here and takes the whole script with it, leaving a blank window and no clue
// why; surface it instead.
const el = (id) => document.getElementById(id);

if (!window.__TAURI__) {
  document.addEventListener('DOMContentLoaded', () => {
    el('status').textContent = 'Tauri API unavailable';
    el('result').textContent =
      'window.__TAURI__ is undefined.\n\n' +
      'Set "withGlobalTauri": true under "app" in\n' +
      'desktop/src-tauri/tauri.conf.json, then restart.';
  });
  throw new Error('window.__TAURI__ is undefined');
}

const invoke = window.__TAURI__.core.invoke;
const listen = window.__TAURI__.event.listen;
const fmtSize = (n) => `${(n / 1024).toFixed(0)} KB`;
const fmtDate = (ms) => new Date(ms).toLocaleString();

const state = {
  roots: [],
  replays: [],
  mapCacheDir: '',
  shown: [],
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

// Never render a filesystem path. These contain the user's account name, and
// this window is aimed at streamers — it will be on camera. Folders get a
// stable index instead; the raw path stays in state and is only ever sent
// back to Rust.
const labelFor = (path) => {
  const i = state.roots.findIndex(r => r.path === path);
  return i === -1 ? 'Replay folder' : `Replay folder ${i + 1}`;
};

const renderRoots = () => {
  // Index, not path — keeps the raw path out of the DOM as well as off screen.
  el('roots').innerHTML = state.roots.map((r, i) => `
    <div class="root" data-idx="${i}">
      <div class="root-path">Replay folder ${i + 1}</div>
      <div class="root-meta">${r.replay_count} replays</div>
    </div>`).join('') || '<div class="empty">No Warcraft III replay folders found.</div>';

  document.querySelectorAll('.root').forEach(node => {
    node.addEventListener('click', () => scan(state.roots[+node.dataset.idx].path));
  });
};

const renderReplays = () => {
  state.shown = state.replays.slice(0, 200);
  el('replays').innerHTML = state.shown.map((r, i) => `
    <div class="replay ${r.interesting ? '' : 'dim'}" data-idx="${i}">
      <div class="replay-name">${r.file_name}</div>
      <div class="replay-meta">
        ${fmtSize(r.size)} · ${fmtDate(r.modified_ms)}
        ${r.autosaved ? ' · autosaved' : ''}
        ${r.interesting ? '' : ' · aborted'}
      </div>
    </div>`).join('');

  document.querySelectorAll('.replay').forEach(node => {
    node.addEventListener('click', () => run(state.shown[+node.dataset.idx].path));
  });
};

const scan = async (root) => {
  const label = labelFor(root);
  el('status').textContent = `scanning ${label}…`;
  const t0 = performance.now();
  state.replays = await invoke('scan_replays', { root });
  log(`scanned ${label} in ${Math.round(performance.now() - t0)} ms`);
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
      log(`parse failed: ${errText(err)}`, 'err');
    }
  }
};

// Output shape (helpers/utils.js buildOutputObject):
//   out.gameMode / out.winner          — top level, NOT under out.replay
//   out.replay.players[id]             — { name, raceDetected, teamId }
//   out.players[id]                    — the rich per-player data
// `winner` is only computed for 1v1, so null on a team game means
// "not applicable", not "unknown". There is no duration field on out.replay;
// the last event time is the honest stand-in.
const RACE = { O: 'Orc', H: 'Human', U: 'Undead', E: 'Night Elf', R: 'Random' };

const showResult = (out, ms) => {
  const slots = out.replay?.players || {};
  const rich = out.players || {};

  const lastEvent = Object.values(rich).reduce((max, p) => {
    const ev = (p && p.eventStream) || [];
    const t = ev.length ? ev[ev.length - 1].gameTime || 0 : 0;
    return Math.max(max, t);
  }, 0);

  const byTeam = new Map();
  for (const [id, s] of Object.entries(slots)) {
    if (rich[id]?.isNeutralPlayer || /\(ai\)$/.test(s.name || '')) continue;
    if (!byTeam.has(s.teamId)) byTeam.set(s.teamId, []);
    byTeam.get(s.teamId).push(
      `    ${s.name}  (${RACE[s.raceDetected] || s.raceDetected})`);
  }

  const teams = [...byTeam.entries()]
    .map(([tid, rows]) => `  team ${tid}\n${rows.join('\n')}`)
    .join('\n');

  el('result').textContent = [
    `map:      ${(out.replay?.metadata?.map?.mapName || '?').split(/[\\/]/).pop()}`,
    `mode:     ${out.gameMode || '?'}`,
    `length:   ~${Math.round(lastEvent / 60000)} min`,
    `winner:   ${out.winner ? JSON.stringify(out.winner) : (out.gameMode === '1v1' ? 'unknown' : 'n/a (1v1 only)')}`,
    `parsed:   ${ms} ms`,
    '',
    teams
  ].join('\n');
};

// ── Boot ────────────────────────────────────────────────────────────────────

const boot = async () => {
  const info = await invoke('init');
  state.roots = info.roots;
  state.mapCacheDir = info.map_cache_dir;
  // Path deliberately not rendered — see labelFor().
  el('cache-dir').textContent = 'local app data';
  renderRoots();

  const watched = await invoke('start_watching');
  log(`watching ${watched} replay folder(s)`, 'ok');

  await listen('replay-detected', (event) => {
    const r = event.payload;
    log(`new game: ${r.fileName} (${fmtSize(r.size)})`, 'ok');
    if (r.interesting) run(r.path);
  });

  await listen('watcher-error', (event) => log(`watcher: ${event.payload}`, 'err'));

  // Scanning is the slow step (it hashes every file), and a failure here
  // should not take the rest of the app down with it.
  if (state.roots.length) {
    const first = state.roots[0].path;
    scan(first).catch(e => {
      el('status').textContent = 'scan failed';
      log(`scan failed in ${labelFor(first)}: ${errText(e)}`, 'err');
    });
  }
};

// Tauri command rejections arrive as plain strings, not Errors, so `e.message`
// is undefined for exactly the failures we most need to read.
const errText = (e) =>
  (e && e.message) || (typeof e === 'string' ? e : JSON.stringify(e));

el('pick-folder').addEventListener('click', async () => {
  const dir = await window.__TAURI__.dialog.open({ directory: true });
  if (!dir) return;
  const root = await invoke('add_root', { path: dir });
  state.roots.push(root);
  renderRoots();
  scan(root.path);
});

boot().catch(e => log(`boot failed: ${errText(e)}`, 'err'));
