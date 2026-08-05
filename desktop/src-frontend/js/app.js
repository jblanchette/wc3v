// Coordinator. Owns the parser workers, the map cache, the view switch and
// boot; every screen and every piece of state lives in its own module and is
// handed exactly the dependencies it needs.
//
// What this app is for, in one line: your replays are already on disk, so
// finishing a game should be all it takes to see how it went.

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
    el('detail').textContent =
      'window.__TAURI__ is undefined.\n\n' +
      'Set "withGlobalTauri": true under "app" in\n' +
      'desktop/src-tauri/tauri.conf.json, then restart.';
  });
  throw new Error('window.__TAURI__ is undefined');
}

const invoke = window.__TAURI__.core.invoke;
const listen = window.__TAURI__.event.listen;

const state = {
  roots: [],
  replays: [],
  worker: null,
  jobId: 0,
  jobs: new Map()
};

// Tauri command rejections arrive as plain strings, not Errors, so `e.message`
// is undefined for exactly the failures we most need to read.
const errText = (e) =>
  (e && e.message) || (typeof e === 'string' ? e : JSON.stringify(e));

const setStatus = (text, kind = '') => {
  el('status').textContent = text;
  el('status').dataset.kind = kind;
};

const log = (msg, kind = '') => {
  const line = document.createElement('div');
  line.className = `log-line ${kind}`;
  line.textContent = msg;
  el('log').prepend(line);
};

// When something the user just CLICKED fails, say so where they are looking.
// Sending it only to log() put the reason in the Activity drawer, which is
// collapsed by default — so a failed primary action looked like a dead button.
const failed = (msg) => {
  setStatus(msg, 'err');
  log(msg, 'err');
  openActivity(true);
};

// ── Parser workers ──────────────────────────────────────────────────────────
//
// One shared wiring for every parser worker — the interactive one and the
// backfill pool. Job ids come from a single counter, so all workers can share
// the one jobs map.

const wireWorker = (w) => {
  w.onmessage = async (e) => {
    const msg = e.data;

    // The worker cannot reach Tauri IPC, so it asks us for map data.
    if (msg.type === 'need-map') {
      try {
        const cache = await loadMapCacheCached(msg.mapDataName);
        w.postMessage({ type: 'map-data', reqId: msg.reqId, cache });
      } catch (err) {
        w.postMessage({ type: 'map-data', reqId: msg.reqId, error: err.message });
      }
      return;
    }

    const job = state.jobs.get(msg.id);
    if (!job) return;

    if (msg.type === 'progress') {
      // Backfill jobs are quiet — the status line belongs to the user's own
      // interactive parse, not to whichever background game is mid-flight.
      if (job.quiet) return;
      const p = msg.evt || {};
      setStatus(`${p.phase || 'reading the replay'} ${Math.round(p.percent || 0)}% ${p.detail || ''}`);
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

  // A crashed worker never answers again; fail its outstanding jobs so callers
  // (the backfill loop especially) can respawn and move on instead of hanging
  // forever on a promise nobody will settle.
  w.onerror = (ev) => {
    log(`worker crashed: ${ev.message}`, 'err');
    w._dead = true;
    for (const [id, job] of [...state.jobs]) {
      if (job.worker === w) {
        state.jobs.delete(id);
        job.reject(new Error(`worker crashed: ${ev.message}`));
      }
    }
  };
  return w;
};

const makeWorker = () => wireWorker(new Worker('./js/parser-worker.js'));

const ensureWorker = () => {
  if (state.worker && !state.worker._dead) return state.worker;
  state.worker = makeWorker();
  return state.worker;
};

// Map data lives on local disk under the app data dir. Files are gzipped JSON,
// exactly as the site serves them.
//
// The installer bundles the ladder pool, so the common case never leaves the
// machine. Anything else — a custom map, an older season, a map added after
// this build was cut — is fetched once from the CDN and then cached like any
// other. Before that path existed, those games simply failed.
const loadMapCache = async (mapDataName) => {
  const read = async (file) => {
    const bytes = await invoke('read_map_file', { map: mapDataName, file });
    return new Uint8Array(bytes);
  };
  const readOrFetch = async (file) => {
    try {
      return await read(file);
    } catch (e) {
      // Only a cache MISS is worth a download. A path or permission failure
      // would fail again identically after one.
      if (!String(errText(e)).startsWith('not cached')) throw e;
      log(`downloading map data for "${mapDataName}"…`);
      await invoke('fetch_map', { map: mapDataName });
      return read(file);
    }
  };
  // wpm first and alone: it is the file every map has, so one round trip
  // settles whether this map exists at all, and fetch_map has by then pulled
  // all three — leaving the other two as plain cache reads.
  const wpm = await readOrFetch('wpm.json.gz').then(store.gunzipJson);
  const [doo, unit] = await Promise.all([
    readOrFetch('doo.json.gz').then(store.gunzipJson),
    readOrFetch('unit.json.gz').then(store.gunzipJson).catch(() => ({ units: [] }))
  ]);
  return { wpm, doo, unit };
};

// Backfill parses hundreds of games on the same handful of ladder maps; a small
// LRU stops the same wpm/doo/unit files being re-read and re-gunzipped for
// every game. Values are promises, so two workers asking for the same map at
// once share a single load. Deliberately small — entries are multi-MB JSON.
const mapCacheLru = new Map();
const MAP_CACHE_MAX = 6;
const loadMapCacheCached = (mapDataName) => {
  if (mapCacheLru.has(mapDataName)) {
    const hit = mapCacheLru.get(mapDataName);
    mapCacheLru.delete(mapDataName);
    mapCacheLru.set(mapDataName, hit); // refresh recency
    return hit;
  }
  const p = loadMapCache(mapDataName);
  // A failed load must not stay cached, or one transient error poisons the map.
  p.catch(() => mapCacheLru.delete(mapDataName));
  mapCacheLru.set(mapDataName, p);
  while (mapCacheLru.size > MAP_CACHE_MAX) {
    mapCacheLru.delete(mapCacheLru.keys().next().value);
  }
  return p;
};

const parseReplayWith = async (worker, path, opts = {}) => {
  const bytes = await invoke('read_replay', { path });
  const buffer = new Uint8Array(bytes).buffer;
  const id = ++state.jobId;
  return new Promise((resolve, reject) => {
    state.jobs.set(id, { resolve, reject, worker, quiet: !!opts.quiet });
    worker.postMessage(
      { type: 'parse', id, buffer, options: opts.parserOptions || null },
      [buffer]
    );
  });
};

// Header-only read: player names, no game parse. ~50 ms per replay.
const peekPlayers = async (worker, path) => {
  const bytes = await invoke('read_replay', { path });
  const buffer = new Uint8Array(bytes).buffer;
  const id = ++state.jobId;
  return new Promise((resolve, reject) => {
    state.jobs.set(id, { resolve, reject, worker, quiet: true });
    worker.postMessage({ type: 'peek', id, buffer }, [buffer]);
  });
};

// ── Modules ─────────────────────────────────────────────────────────────────

const store = window.createStore({ invoke, log });
const replayIndex = window.createReplayIndex({ invoke, log });
const overlayState = window.createOverlayState({
  invoke,
  log,
  // Head-to-head on the overlay is counted over the whole stored history, not
  // just this session.
  corpus: () => store.corpus
});

const identity = window.createIdentity({
  log,
  makeWorker,
  peekPlayers,
  overlayState,
  replays: () => state.replays,
  onChange: () => {
    // Every verdict in the app is scored from this seat, so the feed, the open
    // game and anything already on stream all have to be re-read when it
    // changes.
    renderSession();
    if (store.corpus) gamesView.render(store.corpus);
    if (currentView === 'stream') streamView.renderPreview();
  }
});

const gamesView = window.createGamesView({
  log,
  store,
  identityName: () => identity.name,
  onWatch: (summary, moment) => watchMoment(summary, moment),
  onReparse: (summary) => reparse(summary),
  // The first-run card's only call to action — parsing your history lives on
  // the Settings screen, so send the user there rather than duplicating it.
  onGoToSettings: () => showView('settings')
});

const profileView = window.createProfileView({
  log,
  store,
  identityName: () => identity.name
});

const streamView = window.createStreamView({ invoke, log, errText, overlayState });

const backfill = window.createBackfill({
  invoke,
  log,
  makeWorker,
  // Fast profile mode: summaries are never rendered, the one case where
  // skipPathfinding is allowed. Quiet keeps the status line for the user's own
  // interactive parse.
  parseOn: (worker, path) =>
    parseReplayWith(worker, path, { quiet: true, parserOptions: { skipPathfinding: true } }),
  persistSummary: store.persistSummary,
  isStored: (key) => store.has(key),
  status: (text) => {
    el('backfill-status').textContent = text;
    el('backfill-text').textContent = text;
  },
  progress: (done, total) => {
    el('backfill-fill').style.width = total ? `${(done / total) * 100}%` : '0';
  },
  onIdleChange: (running) => {
    el('backfill-toggle').textContent = running ? 'Pause' : 'Parse all replays';
    el('backfill-bar').hidden = !running;
    settingsView.syncRetryButton();
    // A finished run has usually added games; show them without a restart.
    if (!running && store.corpus) gamesView.render(store.corpus);
  }
});

// Whether the app speaks up when a game finishes. Declared here rather than
// beside notifyGameFinished() because settingsView reads it while it is being
// constructed, and a `const` below that point would still be in its temporal
// dead zone.
const NOTIFY_KEY = 'wc3v-notify-games';
const notifyEnabled = () => localStorage.getItem(NOTIFY_KEY) !== '0';

// Update checking. Default on: nobody opens a Settings screen to ask whether
// their replay parser is current, so an update behind a button is an update
// nobody takes. Applying one stays a decision — see settings-view.js.
const AUTOUPDATE_KEY = 'wc3v-autoupdate';
const autoUpdateEnabled = () => localStorage.getItem(AUTOUPDATE_KEY) !== '0';
// Six hours. Releases do not arrive faster than that, and this process may be
// alive for a week — a tight interval would be a request to a CDN every few
// minutes for the entire time, forever, for nothing.
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const settingsView = window.createSettingsView({
  invoke,
  log,
  errText,
  backfill: () => backfill,
  roots: () => state.roots,
  addRoot: (root) => state.roots.push(root),
  onScan: (path) => scan(path),
  notifyEnabled,
  setNotifyEnabled: (on) => localStorage.setItem(NOTIFY_KEY, on ? '1' : '0'),
  autoUpdateEnabled,
  setAutoUpdateEnabled: (on) => localStorage.setItem(AUTOUPDATE_KEY, on ? '1' : '0'),
  onUpdateAvailable: (version) => showUpdateChip(version)
});

// The app bar's update indicator. Settings owns the decision and the notes;
// this is only how you find out there is one without going looking.
const showUpdateChip = (version) => {
  el('update-chip-text').textContent = `Update to ${version}`;
  el('update-chip').hidden = false;
};

el('update-chip').addEventListener('click', () => {
  showView('settings');
  el('check-update').scrollIntoView({ block: 'center' });
  el('check-update').focus();
});

// ── Views ───────────────────────────────────────────────────────────────────

let currentView = 'games';

const showView = (name) => {
  currentView = name;
  for (const section of document.querySelectorAll('.view')) {
    const active = section.dataset.view === name;
    section.classList.toggle('is-active', active);
    section.hidden = !active;
  }
  for (const btn of document.querySelectorAll('.nav-item')) {
    const active = btn.dataset.view === name;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  }
  if (name === 'profile') profileView.show(el('profile-name').value);
  if (name === 'stream') streamView.build();
};

for (const btn of document.querySelectorAll('.nav-item')) {
  btn.addEventListener('click', () => showView(btn.dataset.view));
}

// ── Caption controls ────────────────────────────────────────────────────────
//
// The window is undecorated (tauri.conf.json), so the app bar is the title bar
// and these are its buttons. Close calls the window's ordinary close, which
// main.rs intercepts and turns into hide-to-tray — the behaviour stays defined
// in one place rather than being reimplemented here.

const appWindow = window.__TAURI__.window.getCurrentWindow();
el('win-min').addEventListener('click', () => appWindow.minimize());
el('win-max').addEventListener('click', () => appWindow.toggleMaximize());
el('win-close').addEventListener('click', () => appWindow.close());

const openActivity = (open) => {
  el('log').hidden = !open;
  el('activity').dataset.open = open ? '1' : '0';
  el('activity-toggle').setAttribute('aria-expanded', String(open));
};

el('activity-toggle').addEventListener('click', () => openActivity(el('log').hidden));

const renderSession = () => {
  const s = overlayState.sessionSummary();
  const box = el('session');
  box.hidden = s.games === 0;
  el('session-w').textContent = s.wins;
  el('session-l').textContent = s.losses;
  el('session-streak').textContent =
    s.streak && s.streak.count >= 2
      ? `${s.streak.kind === 'win' ? 'W' : 'L'}${s.streak.count} streak`
      : '';
};

// ── Post-game notification ──────────────────────────────────────────────────
//
// The whole premise is that you finish a game and do not have to go looking.
// Most of the time the window is behind Warcraft, so the app has to be the one
// that speaks. Only ever for a WATCHER-DETECTED game: firing this from the
// backfill would mean one toast per replay, thousands of them.
//
// Wording comes from overlayState so the toast, the app and the broadcast can
// never describe the same game differently.

const notifyGameFinished = async (summary) => {
  if (!notifyEnabled()) return;
  try {
    const n = window.__TAURI__.notification;
    let granted = await n.isPermissionGranted();
    if (!granted) granted = (await n.requestPermission()) === 'granted';
    if (!granted) return;

    const toast = overlayState.toastFor(summary);
    if (!toast) return;
    await n.sendNotification({ title: toast.title, body: toast.body });
  } catch (e) {
    // A notification that cannot be shown is not worth interrupting anything
    // over — the game is already on screen behind it.
    log(`could not show a notification: ${errText(e)}`, 'warn');
  }
};

// ── Parsing a game ──────────────────────────────────────────────────────────

// opts.live marks a watcher-detected game: it enters the overlay session.
// Clicking through history never does — a streamer browsing old replays must
// not scramble their on-stream score.
const run = async (path, opts = {}) => {
  setStatus('reading…');
  const fileName = path.split(/[\\/]/).pop();
  const started = performance.now();
  try {
    // Canonical identity first — a game already summarised is shown from the
    // store instead of being re-parsed. The key is content-based, so the same
    // game under another path (a copied file) also hits.
    const { key, modifiedMs } = await invoke('replay_key', { path });
    replayIndex.remember(key, path);
    let summary = null;

    if (store.has(key) && !opts.force) {
      summary = await store.read(key);
      setStatus('already parsed');
    } else {
      const out = await parseReplayWith(ensureWorker(), path);
      const ms = Math.round(performance.now() - started);
      setStatus(`read in ${(ms / 1000).toFixed(1)} s`);
      try {
        summary = await store.persistSummary(out, key, modifiedMs);
      } catch (e) {
        log(`could not save that game: ${errText(e)}`, 'warn');
      }
    }

    if (summary) {
      // Keep the corpus authoritative even for a game opened out of band.
      const corpus = store.corpus;
      if (corpus && !corpus.some(g => g.key === key)) {
        corpus.push(summary);
        corpus.sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0));
      }
      if (opts.live) {
        overlayState.recordGame(summary);
        renderSession();
        if (currentView === 'stream') streamView.renderPreview();
        identity.resolve();
        notifyGameFinished(summary);
      }
      gamesView.render(store.corpus || [summary]);
      gamesView.select(key);
      // A game that finished while the user was reading something else should
      // pull them to it — that is the whole promise. Browsing history and
      // clicking a game does not (opts.live is false there).
      if (opts.live) showView('games');
    }
    return summary;
  } catch (err) {
    setStatus('could not read that replay');
    if (err.code === 'missing_map' || err.code === 'missing_map_cache') {
      log(`no local map data for "${err.mapDataName || err.rawMapName}" — this game ` +
          `is on a map WC3V has not seen yet`, 'warn');
    } else {
      log(`could not read ${fileName}: ${errText(err)}`, 'err');
    }
    return null;
  }
};

// Re-read a game stored before the summary schema gained moments. The file has
// to be found again first — summaries carry a content key, never a path.
const reparse = async (summary) => {
  setStatus('finding the replay file…');
  const path = await replayIndex.pathFor(summary.key).catch(() => null);
  if (!path) {
    failed('WC3V could not find that replay file any more — it may have been ' +
           'moved or deleted since it was parsed');
    gamesView.select(summary.key);
    return;
  }
  await run(path, { force: true });
};

// Open a game — or one moment inside it — in the viewer on wc3v.com.
//
// The replay leaves this process only over loopback, into the browser the user
// already has. There is no upload and no account; the site parses it locally
// exactly as it would a file the user dragged in.
const watchMoment = async (summary, moment) => {
  setStatus('finding the replay file…');
  let path;
  try {
    path = await replayIndex.pathFor(summary.key);
  } catch (e) {
    failed(`could not search your replay folders: ${errText(e)}`);
    return;
  }
  if (!path) {
    failed('WC3V could not find that replay file any more — it may have been ' +
           'moved or deleted since it was parsed');
    return;
  }
  setStatus('opening your browser…');
  try {
    await invoke('open_in_viewer', {
      path,
      atMs: moment ? Math.max(0, moment.t) : null,
      key: summary.key
    });
    setStatus(moment
      ? `opening the viewer at ${moment.tf} — finish in your browser`
      : 'opening the viewer — finish in your browser');
    log(moment
      ? `opening the viewer at ${moment.tf}: your browser will show one button to confirm`
      : 'opening this game in the viewer: your browser will show one button to confirm', 'ok');
  } catch (e) {
    failed(`could not open the viewer: ${errText(e)}`);
  }
};

// ── Scanning ────────────────────────────────────────────────────────────────

const scan = async (root) => {
  setStatus('looking for replays…');
  const { replays, stats } = await invoke('scan_replays', { root });
  state.replays = replays;
  log(`found ${replays.length.toLocaleString()} replay files ` +
      `(${stats.files_seen.toLocaleString()} seen, ${stats.walk_ms} ms)`);
  setStatus(idleStatus());
};

// What the status line says when nothing is happening. The app's whole promise
// is "finish a game and it shows up", so the resting state should say that.
const idleStatus = () => store.size
  ? 'Watching for new games'
  : 'Watching — play a game, or parse your history in Settings';

// ── Boot ────────────────────────────────────────────────────────────────────

const boot = async () => {
  const info = await invoke('init');
  state.roots = info.roots;
  settingsView.renderRoots();
  settingsView.syncAutostart();

  // An unreadable store just means everything re-parses; not fatal.
  try {
    const n = await store.init();
    if (n) log(`${n.toLocaleString()} game(s) already parsed`, 'ok');
  } catch (e) {
    log(`the game store is unavailable: ${errText(e)}`, 'warn');
  }
  await backfill.init();
  settingsView.syncRetryButton();
  if (store.size) {
    el('backfill-status').textContent =
      `${store.size.toLocaleString()} game(s) parsed so far`;
  }

  const watched = await invoke('start_watching');
  log(`watching ${watched} replay folder(s) — finish a game and it appears here`, 'ok');
  setStatus(idleStatus());

  await listen('replay-detected', (event) => {
    const r = event.payload;
    log(`new game: ${r.fileName}`, 'ok');
    if (r.interesting) run(r.path, { live: true });
  });

  await listen('watcher-error', (event) => log(`watcher: ${event.payload}`, 'err'));

  // Dedupe finished behind the rendered list.
  await listen('scan-deduped', (event) => {
    const { replays, stats } = event.payload;
    state.replays = replays;
    log(`${replays.length.toLocaleString()} unique replays ` +
        `(${stats.duplicates.toLocaleString()} duplicates collapsed, ${stats.total_ms} ms)`);
  });

  // Scanning is the slow step (it hashes every file), and a failure here should
  // not take the rest of the app down with it.
  if (state.roots.length) {
    const first = state.roots[0].path;
    scan(first)
      // Identity detection reads replay headers, so it needs the scan's list
      // first. Runs behind the rendered UI; nothing waits on it.
      .then(() => identity.resolve())
      .catch(e => {
        log(`could not read Replay folder 1: ${errText(e)}`, 'err');
      });
  }

  // Updates. On launch, then on a long interval — this app is meant to sit in
  // the tray for days at a time, so "at launch" alone would mean a machine
  // that never reboots never hears about anything. Quiet on failure.
  if (autoUpdateEnabled()) {
    settingsView.checkQuietly();
    setInterval(() => {
      if (autoUpdateEnabled()) settingsView.checkQuietly();
    }, UPDATE_CHECK_INTERVAL_MS);
  }

  // Overlay: publish the empty session immediately so an OBS source that is
  // already connected shows the waiting card rather than nothing.
  overlayState.publish();
  identity.render();
  renderSession();

  // Background: load the stored games, then paint the feed, seed the overlay's
  // last game and fill the name autocomplete. Placeholders go up first —
  // loadCorpus reads every stored summary over IPC one at a time, so at a few
  // thousand games there is a real wait behind this.
  gamesView.showLoading();
  store.loadCorpus().then((corpus) => {
    gamesView.render(corpus);
    if (!corpus.length) return;
    overlayState.seedLastGame(corpus[0]);   // corpus is newest-first
    // Autocomplete covers every name ever seen; identity is a separate,
    // explicit choice and does not come from this box.
    const names = window.ProfileAggregate.knownNames(corpus).slice(0, 200);
    el('known-names').innerHTML = '';
    for (const n of names) {
      const opt = document.createElement('option');
      opt.value = n.name;
      el('known-names').appendChild(opt);
    }
    log(`${corpus.length.toLocaleString()} game(s) in your history`, 'ok');
  }).catch(e => log(`could not load your history: ${errText(e)}`, 'warn'));
};

boot().catch(e => log(`WC3V could not start: ${errText(e)}`, 'err'));
