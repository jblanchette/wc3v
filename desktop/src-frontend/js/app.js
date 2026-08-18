// Coordinator. Owns the parser workers, the map cache, the view switch and
// boot. Every screen and every piece of state lives in its own module and gets
// handed the dependencies it needs.
//
// The premise: your replays are already on disk, so finishing a game should be
// all it takes to see how it went.

// Tauri v2 hides window.__TAURI__ unless `app.withGlobalTauri` is true in
// tauri.conf.json, because the default assumes @tauri-apps/api through a
// bundler. This project has no bundler. Reading the global without checking
// means a config regression throws here and takes the whole script down,
// leaving a blank window and no clue why.
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
const appWindow = window.__TAURI__.window.getCurrentWindow();

// Hidden to the tray still counts as running, so anything on a timer has to
// ask before it does work nobody can see.
const windowVisible = async () => {
  try {
    return await appWindow.isVisible();
  } catch (e) {
    return !document.hidden;
  }
};

// Can ANYBODY see what the ladder poll would answer?
//
// Two consumers, and only one of them is this window. The other is an OBS
// Browser Source that stays on a live broadcast after WC3V is out of the way —
// and getting it out of the way means the TRAY, because that is what the close
// button does and what starting at login does. Gating the poll on the window
// alone froze the live match card on a streamer's scene for a whole session,
// which is the one place this app is watched by other people.
//
// Errs toward yes: a failed count is treated as "somebody might be", because
// the cost of guessing wrong that way is one HTTP request per poll and the cost
// of guessing wrong the other way is a broadcast graphic that stops updating.
const overlayWatched = async () => {
  if (await windowVisible()) return true;
  try {
    return (await invoke('overlay_clients')) > 0;
  } catch (e) {
    return true;
  }
};

const state = {
  roots: [],
  replays: [],
  worker: null,
  jobId: 0,
  jobs: new Map()
};

// Tauri command rejections arrive as plain strings rather than Errors, so
// `e.message` is undefined for exactly the failures worth reading.
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

// When something the user just clicked fails, say so where they are looking.
// Sending it only to log() buried the reason in the Activity drawer, which is
// collapsed by default, so a failed primary action looked like a dead button.
const failed = (msg) => {
  setStatus(msg, 'err');
  log(msg, 'err');
  openActivity(true);
};

// ── Parser workers ──────────────────────────────────────────────────────────
//
// One wiring covers the interactive worker and the backfill pool. Job ids come
// from a single counter, so every worker shares the one jobs map.

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
      // The status line belongs to whatever the user just clicked. A backfill
      // running behind it would overwrite that every few seconds.
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

  // A crashed worker never answers again. Fail its outstanding jobs so callers
  // can respawn and move on. The backfill loop would otherwise hang forever on
  // a promise nobody will settle.
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

// Map data lives under the app data dir as gzipped JSON, byte for byte what
// the site serves.
//
// The installer bundles the ladder pool, so the common case never leaves the
// machine. A custom map, an older season, or a map added after this build was
// cut gets fetched once from the CDN and cached like any other. Those games
// used to fail outright.
const loadMapCache = async (mapDataName) => {
  const read = async (file) => {
    const bytes = await invoke('read_map_file', { map: mapDataName, file });
    return new Uint8Array(bytes);
  };
  const readOrFetch = async (file) => {
    try {
      return await read(file);
    } catch (e) {
      // Only a cache miss is worth a download. A path or permission failure
      // would fail again identically afterwards.
      if (!String(errText(e)).startsWith('not cached')) throw e;
      log(`downloading map data for "${mapDataName}"…`);
      await invoke('fetch_map', { map: mapDataName });
      return read(file);
    }
  };
  // wpm first and alone. Every map has it, so one round trip settles whether
  // this map exists. By then fetch_map has pulled all three, leaving the other
  // two as plain cache reads.
  const wpm = await readOrFetch('wpm.json.gz').then(store.gunzipJson);
  const [doo, unit] = await Promise.all([
    readOrFetch('doo.json.gz').then(store.gunzipJson),
    readOrFetch('unit.json.gz').then(store.gunzipJson).catch(() => ({ units: [] }))
  ]);
  return { wpm, doo, unit };
};

// A backfill parses hundreds of games on the same handful of ladder maps. This
// LRU stops the same wpm/doo/unit files being re-read and re-gunzipped every
// time. Values are promises, so two workers asking for the same map share one
// load. It stays small because entries are multi-MB JSON.
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
  // A failed load must not stay cached, or one blip poisons the map for good.
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

// Any player name anywhere in the app is a door to their book. This is the
// whole reason Coach accepts a name.
const openProfile = (name) => {
  el('profile-name').value = name || '';
  showView('profile');
};

const store = window.createStore({ invoke, log });
const replayIndex = window.createReplayIndex({ invoke, log });
const overlayState = window.createOverlayState({
  invoke,
  log,
  // Head-to-head on the overlay counts the whole stored history. The session
  // module already carries today's numbers.
  corpus: () => store.corpus
});

const w3c = window.createW3c({ invoke, log });

const identity = window.createIdentity({
  log,
  makeWorker,
  peekPlayers,
  overlayState,
  replays: () => state.replays,
  onChange: () => {
    // Every verdict is scored from this seat, so the feed, the open game and
    // anything already on stream get re-read when it changes.
    renderSession();
    if (store.corpus) gamesView.render(store.corpus);
    if (currentView === 'stream') streamView.renderPreview();
    // A different seat means a different battle tag to ask the ladder about,
    // and a different answer to whether that tag can be asked about at all.
    settingsView.syncW3c();
  }
});

// What the app is doing: idle, live, or post. One owner, subscribed to by
// everything that draws a phase, so the window and the broadcast cannot
// disagree. See js/match-phase.js for why that used to be possible.
const matchPhase = window.createMatchPhase({ log });
// Subscribed further down, once the views it drives exist. subscribe() fires
// immediately so a subscriber never has to ask what it missed, which means it
// cannot be attached before gamesView and streamView are constructed.

// Who you are playing right now, from W3Champions, over your own record
// against them. Idle until the feature is switched on in Settings, and it
// renders nothing itself: the report column is the surface.
const scout = window.createScout({
  w3c,
  store,
  log,
  identityName: () => identity.name,
  watched: overlayWatched,
  onMatch: (match, ladder, book) => {
    if (match) matchPhase.setLive(match, ladder, book);
    else matchPhase.clearLive();
  },
  // Your own standing. Overlay only: the app already shows this on Profile,
  // and a second copy in the report column would be the same number twice.
  onLadder: (mine) => overlayState.publishLadder(mine),
  // The climb is measured from where this session started, and a streamer who
  // restarts the app mid-session should not drop to +0 on air.
  readBaseline: (tag) => overlayState.readMmrBaseline(tag),
  writeBaseline: (tag, mmr) => overlayState.writeMmrBaseline(tag, mmr)
});

// Free tags on a game, in a sidecar the schema cannot eat. See js/game-tags.js.
const gameTags = window.createGameTags({ invoke, log, errText });

const gamesView = window.createGamesView({
  log,
  store,
  identityName: () => identity.name,
  onWatch: (summary, moment) => watchMoment(summary, moment),
  onReparse: (summary) => reparse(summary),
  // Parsing your history lives on the Settings screen, so the first-run card
  // sends you there instead of carrying a second copy of the button.
  onGoToSettings: () => openSettings(),
  onOpenProfile: openProfile,
  tags: gameTags
});

const profileView = window.createProfileView({
  log,
  store,
  identityName: () => identity.name
});

// Everybody else's games. Same corpus, same report renderer, no "you".
const libraryView = window.createLibraryView({
  log,
  store,
  identityName: () => identity.name,
  onWatch: (summary, moment) => watchMoment(summary, moment),
  onReparse: (summary) => reparse(summary),
  onOpenProfile: openProfile,
  onOpenReplay: () => addReplayFolder(),
  tags: gameTags
});

const streamView = window.createStreamView({ invoke, log, errText, overlayState });

// Which screen is up. Declared here rather than beside showView because the
// phase subscriber below reads it, and subscribe() fires immediately.
let currentView = 'games';

// Everything that draws a phase, driven from the one owner.
//
// Attached HERE, below the views, because subscribe() fires immediately — a
// subscriber should never have to ask what it missed, and that means it cannot
// be attached before the things it calls exist.
//
// Three consumers that used to be pushed at separately and could disagree: the
// report column, the broadcast, and the Stream tab's preview of the broadcast.
matchPhase.subscribe((snap) => {
  const live = snap.live;
  gamesView.setLiveMatch(
    live ? live.match : null,
    live ? live.ladder : null,
    live ? live.book : null
  );
  overlayState.publishPhase(snap);
  // The preview used to redraw only when some other code path remembered to ask
  // for it, and nothing in the scout path did — so it sat frozen while a match
  // started in front of the person watching it.
  if (currentView === 'stream') streamView.renderPreview();
});

const backfill = window.createBackfill({
  invoke,
  log,
  makeWorker,
  // Fast profile mode. Nothing here gets rendered, which is the one case where
  // skipPathfinding is allowed. Quiet leaves the status line alone.
  parseOn: (worker, path) =>
    parseReplayWith(worker, path, { quiet: true, parserOptions: { skipPathfinding: true } }),
  persistSummary: store.persistSummary,
  isCurrent: (key) => store.isCurrent(key),
  status: (text) => {
    el('backfill-status').textContent = text;
    el('backfill-text').textContent = text;
  },
  progress: (done, total) => {
    el('backfill-fill').style.width = total ? `${(done / total) * 100}%` : '0';
  },
  onIdleChange: (running, limited) => {
    // The first-boot catch-up is not the "Parse all replays" button running, so
    // it must not relabel that button or raise its progress bar. It reports
    // through the quick nav instead.
    if (!limited) {
      el('backfill-toggle').textContent = running ? 'Pause' : 'Parse all replays';
      el('backfill-bar').hidden = !running;
    }
    // The migration strip goes up and down with any run, because any run
    // re-reads stale games: pressing "Parse all replays" while a migration is
    // pending is the same work under a different button.
    syncMigrateStrip(running);
    settingsView.syncRetryButton();
    // A finished run has usually added games; show them without a restart.
    if (!running && store.corpus) {
      gamesView.render(store.corpus);
      if (currentView === 'library') libraryView.render(store.corpus);
      if (limited) gamesView.clearParseQueue();
    }
  }
});

// Ten, on a fresh install only. Enough that the app is worth looking at the
// first time it opens, and short enough that a first launch is not held hostage
// to a three-thousand-game history. The full read stays a deliberate choice in
// Settings.
const CATCH_UP_LIMIT = 10;

// Whether the app speaks up when a game finishes. Declared up here because
// settingsView reads it while being constructed, and a `const` below that
// point would still be in its temporal dead zone.
const NOTIFY_KEY = 'wc3v-notify-games';
const notifyEnabled = () => localStorage.getItem(NOTIFY_KEY) !== '0';

// Update checking, on by default. Nobody opens a settings screen to ask
// whether their replay parser is current, so an update behind a button is an
// update nobody takes. Applying one stays a decision (settings-view.js).
const AUTOUPDATE_KEY = 'wc3v-autoupdate';
const autoUpdateEnabled = () => localStorage.getItem(AUTOUPDATE_KEY) !== '0';
// Six hours. Releases do not arrive faster than that, and this process can be
// alive for a week, so a tight interval would hammer a CDN for nothing.
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const settingsView = window.createSettingsView({
  invoke,
  log,
  errText,
  backfill: () => backfill,
  roots: () => state.roots,
  addRoot: (root) => state.roots.push(root),
  onScan: (path) => scan(path),
  identityName: () => identity.name,
  notifyEnabled,
  setNotifyEnabled: (on) => localStorage.setItem(NOTIFY_KEY, on ? '1' : '0'),
  autoUpdateEnabled,
  setAutoUpdateEnabled: (on) => localStorage.setItem(AUTOUPDATE_KEY, on ? '1' : '0'),
  onUpdateAvailable: (version) => showUpdateChip(version),
  // Rust owns the real setting. This fires with whatever it says, so the
  // poller can never outlive a refusal.
  onW3cChange: (on) => {
    w3c.setEnabled(on);
    if (on) scout.start(); else scout.stop();
  }
});

// Shown once, on a machine that has never been set up. Every control it offers
// also lives in Settings, so nothing here is a decision anybody is stuck with.
const firstRun = window.createFirstRun({
  invoke,
  log,
  errText,
  roots: () => state.roots,
  addRoot: (root) => state.roots.push(root),
  onScan: (path) => scan(path),
  // Typing your own name is a confirmation, so auto-detection never overrides
  // it afterwards.
  setIdentity: (name) => identity.confirm(name),
  startBackfill: () => backfill.toggle(),
  onW3cChange: (on) => {
    w3c.setEnabled(on);
    if (on) scout.start(); else scout.stop();
  },
  onDone: () => identity.render()
});

// ── Bringing somebody else's replay in ──────────────────────────────────────
//
// The Library's "Open a replay…" button. It takes a FILE and registers the
// folder that holds it, then scans that folder.
//
// Registering rather than reading directly is not a detail. `read_replay`
// canonicalises its argument and refuses anything outside a registered replay
// root, and that refusal is the reason the webview has no arbitrary-filesystem
// primitive. A "just read this one path" command would hand it one. So the file
// picker's job is to widen the registered set, in the open, through the same
// `add_root` the Settings folder picker uses.
const addReplayFolder = async () => {
  let picked;
  try {
    picked = await window.__TAURI__.dialog.open({
      multiple: false,
      filters: [{ name: 'Warcraft III replay', extensions: ['w3g'] }]
    });
  } catch (e) {
    log(`could not open the file picker: ${errText(e)}`, 'err');
    return;
  }
  if (!picked) return;

  const dir = String(picked).replace(/[\\/][^\\/]*$/, '');
  if (!dir) { log('could not work out which folder that replay is in', 'err'); return; }

  try {
    const root = await invoke('add_root', { path: dir });
    state.roots.push(root);
    // Everything in that folder, not only the file that was clicked. Somebody
    // pointing at one downloaded replay almost always has the rest beside it,
    // and scanning the folder is already the path every other replay takes in.
    log(`watching ${root.path}`, 'ok');
    scan(root.path);
  } catch (e) {
    log(`could not add that folder: ${errText(e)}`, 'err');
  }
};

// The app bar's update indicator. Settings owns the decision and the notes.
// This is how you find out there is one without going looking.
const showUpdateChip = (version) => {
  el('update-chip-text').textContent = `Update to ${version}`;
  el('update-chip').hidden = false;
};

el('update-chip').addEventListener('click', () => {
  openSettings();
  // Inside the sheet's own scroller now, so `nearest` keeps the head and the
  // trademark line where they are instead of scrolling the whole grid.
  el('check-update').scrollIntoView({ block: 'nearest' });
  el('check-update').focus();
});

// ── Views ───────────────────────────────────────────────────────────────────

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
  if (name === 'library' && store.corpus) libraryView.render(store.corpus);
  // Leaving the Library releases its chart. DominanceChart holds a
  // ResizeObserver and chart-panel keeps parked modes alive, so a hidden view
  // with a mounted chart is a live observer on a element nobody can see.
  if (name !== 'library') libraryView.suspend();
};

for (const btn of document.querySelectorAll('.nav-item')) {
  btn.addEventListener('click', () => showView(btn.dataset.view));
}

// ── Settings sheet ──────────────────────────────────────────────────────────
//
// A sheet over the current screen rather than a fourth view. Settings is
// maintenance, and taking the whole window away to change a checkbox loses
// whatever the user was looking at.

const settingsOpen = () => !el('settings-sheet').hidden;

const openSettings = () => {
  el('settings-sheet').hidden = false;
  el('settings-btn').classList.add('is-active');
  el('settings-btn').setAttribute('aria-expanded', 'true');
  el('settings-close').focus();
};

const closeSettings = (returnFocus) => {
  el('settings-sheet').hidden = true;
  el('settings-btn').classList.remove('is-active');
  el('settings-btn').setAttribute('aria-expanded', 'false');
  if (returnFocus) el('settings-btn').focus();
};

el('settings-btn').addEventListener('click', () => {
  if (settingsOpen()) closeSettings(true); else openSettings();
});
el('settings-close').addEventListener('click', () => closeSettings(true));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && settingsOpen()) closeSettings(true);
});

// ── Caption controls ────────────────────────────────────────────────────────
//
// The window is undecorated (tauri.conf.json), so the app bar is the title bar
// and these are its buttons. Close calls the window's ordinary close, which
// main.rs intercepts and turns into hide-to-tray, keeping that behaviour
// defined in one place.

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
// You finish a game and do not have to go looking. The window is behind
// Warcraft most of the time, so the app has to speak first.
//
// Watcher-detected games only. Firing this from the backfill would mean one
// toast per replay, thousands of them.
//
// Wording comes from overlayState, so the toast, the app and the broadcast can
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
    // over. The game is already on screen behind it.
    log(`could not show a notification: ${errText(e)}`, 'warn');
  }
};

// ── Parsing a game ──────────────────────────────────────────────────────────

// opts.live marks a watcher-detected game, which is the only kind that enters
// the overlay session. A streamer browsing old replays must never scramble
// their on-stream score.
const run = async (path, opts = {}) => {
  setStatus('reading…');
  const fileName = path.split(/[\\/]/).pop();
  const started = performance.now();
  // The parse is two to five seconds during which the report column keeps
  // showing the PREVIOUS game and nothing says why. The quick-nav parse chips
  // already exist for exactly this and were wired only to the first-boot
  // backfill, so a live game got no indication at all.
  if (opts.live) gamesView.setParseProgress(fileName, 'reading');
  try {
    // Canonical identity first. A game already summarised renders from the
    // store instead of re-parsing. The key is content-based, so a copy of the
    // same file under another path hits too.
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
      // Everything below re-selects and re-renders; the report column paints
      // ONCE, at the end, on the game that actually won. Without the batch a
      // live game landing drew three reports — the live card coming down, the
      // corpus render re-selecting the OLD key, then the new key — so the
      // previous game flashed twice, each time remounting DominanceChart and
      // its ResizeObserver.
      gamesView.beginBatch();
      try {
        if (opts.live) {
          // Whatever the scout card was showing has just ended, and the report
          // underneath it is the better thing to look at.
          //
          // The id goes with it: the ladder keeps reporting a finished match
          // for a while after its replay is on disk, and without the id the
          // next poll treated it as a brand new game and threw the column back
          // onto a scouting panel for a game already reported on.
          const liveId = matchPhase.live && matchPhase.live.match
            ? matchPhase.live.match.id
            : null;
          scout.dismiss(liveId);
          matchPhase.gameLanded();
          overlayState.recordGame(summary);
          renderSession();
          identity.resolve();
          notifyGameFinished(summary);
          gamesView.clearParseQueue();
        }
        gamesView.render(store.corpus || [summary]);
        if (currentView === 'library') libraryView.render(store.corpus || []);
        gamesView.select(key);
      } finally {
        gamesView.endBatch();
      }
      // A game that finished while the user was reading something else pulls
      // them to it. That is the promise. Clicking through history does not,
      // because opts.live is false there.
      if (opts.live) showView('games');
    }
    return summary;
  } catch (err) {
    setStatus('could not read that replay');
    if (err.code === 'missing_map' || err.code === 'missing_map_cache') {
      log(`no local map data for "${err.mapDataName || err.rawMapName}"`, 'warn');
    } else {
      log(`could not read ${fileName}: ${errText(err)}`, 'err');
    }
    // A live game whose replay could not be read still ENDED. Without this the
    // app stayed in `live` on a bad file — the only thing that ever cleared the
    // card was a successful parse — and sat there showing a scouting panel for a
    // match that was long over.
    if (opts.live) {
      gamesView.clearParseQueue();
      const liveId = matchPhase.live && matchPhase.live.match
        ? matchPhase.live.match.id
        : null;
      scout.dismiss(liveId);
      matchPhase.parseFailed(`${fileName} could not be read`);
    }
    return null;
  }
};

// Re-read a game stored before the summary schema gained moments. The file has
// to be found again first, because summaries carry a content key and no path.
const reparse = async (summary) => {
  setStatus('finding the replay file…');
  const path = await replayIndex.pathFor(summary.key).catch(() => null);
  if (!path) {
    failed('That replay file is gone. It was moved or deleted since parsing.');
    gamesView.select(summary.key);
    return;
  }
  await run(path, { force: true });
};

// Open a game, or one moment inside it, in the viewer on wc3v.com.
//
// The replay leaves this process over loopback and goes into the browser the
// user already has. No upload, no account. The site parses it locally exactly
// as it would a file dragged in.
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
    failed('That replay file is gone. It was moved or deleted since parsing.');
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
      ? `opening the viewer at ${moment.tf}. Finish in your browser.`
      : 'opening the viewer. Finish in your browser.');
    log('your browser will show one button to confirm', 'ok');
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

// What the status line says at rest. The promise is "finish a game and it
// shows up", so the resting state says that.
const idleStatus = () => store.size
  ? 'Watching for new games'
  : 'Watching. Play a game, or parse your history in Settings.';

// ── Boot ────────────────────────────────────────────────────────────────────

// The newest few games, read on a fresh install. Failures here are not fatal
// and are not worth a red line in the log: the watcher is still running, the
// Settings button still exists, and the next game the user plays still lands.
const catchUpOnRecentGames = () => {
  if (backfill.running) return;
  backfill.catchUp(CATCH_UP_LIMIT, {
    onQueue: (files) => gamesView.setParseQueue(files),
    onProgress: (file, phase) => {
      gamesView.setParseProgress(file, phase);
      // Repaint the feed as each one lands, so the games appear one at a time
      // instead of all together when the run finishes.
      //
      // `persistSummary` appends to the corpus but does not order it, and two
      // workers finish out of order, so the sort belongs here. The feed and the
      // overlay both read this list as newest-first.
      if (phase === 'done' && store.corpus) {
        store.corpus.sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0));
        gamesView.render(store.corpus);
      if (currentView === 'library') libraryView.render(store.corpus);
      }
    }
  }).catch(e => log(`could not read your recent games: ${errText(e)}`, 'warn'));
};

// ── Schema migration ────────────────────────────────────────────────────────
//
// The full backfill, started by the app rather than by a person, with its own
// indicator so it is not invisible work. The engine already does exactly the
// right thing: it walks every replay newest-first and skips whatever
// `store.isCurrent(key)` says is already current, so a run re-reads the stale
// games and nothing else.
//
// It reports here rather than through the Settings progress bar, which belongs
// to the "Parse all replays" button, and it stays out of the quick-nav parse
// chips, which are for ten games and not for three thousand.
const migrateEl = () => el('migrate');

const syncMigrateStrip = (running) => {
  const strip = migrateEl();
  if (!strip) return;
  const left = store.staleCount;
  // Gone the moment there is nothing left behind, whether this run finished it
  // or a re-read of the last one did.
  strip.hidden = !left && !running;
  el('migrate-toggle').textContent = running ? 'Pause' : 'Resume';
};

const startMigration = () => {
  const total = store.staleCount;
  log(`${total.toLocaleString()} game(s) were read under an older format. ` +
    'Re-reading them now; newest first.', 'warn');
  syncMigrateStrip(true);
  el('migrate-text').textContent =
    `Updating your history · ${total.toLocaleString()} to go`;
  backfill.start({
    onProgress: () => {
      const left = store.staleCount;
      const done = Math.max(0, total - left);
      el('migrate-text').textContent = left
        ? `Updating your history · ${done.toLocaleString()} of ${total.toLocaleString()}`
        : 'History up to date';
      el('migrate-fill').style.width = total ? `${(done / total) * 100}%` : '100%';
      // Repaint as each one lands, so a game becomes readable the moment it is
      // current rather than when the whole run ends.
      if (store.corpus) {
        gamesView.render(store.corpus);
        if (currentView === 'library') libraryView.render(store.corpus);
      }
    }
  }).catch(e => log(`could not update your history: ${errText(e)}`, 'warn'));
};

// Pause and resume. The work is resumable by construction — a game is done
// when its summary is current, so a restart picks up exactly where it stopped
// — which is what makes it safe to offer a pause at all.
el('migrate-toggle').addEventListener('click', () => {
  if (backfill.running) backfill.toggle();
  else startMigration();
});

// Every map's world bounds, as the site serves at /data/map-folders.json and
// tools/build-desktop-client.js vendors in here.
//
// SummaryBuild reads this off the window to stamp `mapInfo` onto a stored
// summary, which is what lets a creep camp or a starting position be placed on
// the map image at all. It has to be up before the first parse, so it is
// awaited in boot rather than fetched lazily — it is ~40 KB off local disk.
//
// A failure is not fatal: summaries store mapInfo: null and the route map falls
// back to a self-scaled plot, which loses the terrain and keeps the shape.
const loadMapBounds = async () => {
  try {
    const r = await fetch('./data/map-folders.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    window.__mapFoldersManifest = await r.json();
  } catch (e) {
    log(`map bounds unavailable, route maps will be approximate: ${errText(e)}`, 'warn');
  }
};

const boot = async () => {
  await loadMapBounds();
  const info = await invoke('init');
  state.roots = info.roots;
  settingsView.renderRoots();
  settingsView.syncAutostart();
  settingsView.syncW3c();

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
  log(`watching ${watched} replay folder(s)`, 'ok');
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

  // Updates: on launch, then on a long interval. This app sits in the tray for
  // days, so checking only at launch would mean a machine that never reboots
  // never hears about anything. Quiet on failure.
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

  // Background: load the stored games, paint the feed, seed the overlay's last
  // game, fill the name autocomplete. Placeholders go up first, because
  // loadCorpus reads every stored summary over IPC one at a time and a few
  // thousand games is a real wait.
  gamesView.showLoading();

  // Tags before the corpus. It is one small file against thousands of IPC
  // reads, and the Library filters on tags, so loading it after would mean the
  // first list drawn cannot match one.
  gameTags.load();

  // The first-run screen, on a machine that has never been set up. It goes up
  // OVER the loading feed rather than instead of it, so discovery, scanning and
  // the corpus read all carry on behind it and the app is ready by the time
  // somebody clicks Start.
  firstRun.maybeShow();

  store.loadCorpus().then((corpus) => {
    gamesView.render(corpus);
    // The scout card may already be up, drawn before there was any history to
    // read the opponent's record out of.
    scout.refresh();
    if (!corpus.length) {
      // Nothing parsed yet, which on a fresh install is every launch until the
      // first game is read. Take the newest few so the window has something in
      // it, rather than showing an empty feed that looks like a failure and
      // waiting for the user to find a button in Settings.
      //
      // Gated on an empty corpus rather than a "first run" flag: that is what
      // "first boot" actually means here, and it self-heals if somebody clears
      // their store.
      catchUpOnRecentGames();
      return;
    }

    // A store behind SCHEMA_VERSION is not a state to leave somebody in.
    //
    // The blocks a new schema adds come out of a full parse and nothing else,
    // so a summary written under the old one cannot be upgraded in place — and
    // a report drawn from it quietly says less than the same report about the
    // game played after the update. That is worse than an empty screen: it is
    // wrong in a way nobody can see.
    //
    // So the app re-reads the history itself, rather than leaving it behind a
    // button in Settings that nobody has a reason to look for. Newest first
    // (the scan sorts by mtime), so the games most likely to be opened come
    // back first, and in the background, because holding the window hostage to
    // three thousand replays to look at last night's game is its own bad
    // trade.
    if (store.staleCount) startMigration();

    // A restart mid-session puts the board back exactly as it was: the score,
    // the form rail and the game under it. Only when there is no session to
    // resume does the newest stored game get seeded as a resting card, because
    // a seeded game deliberately does not count toward the score.
    if (!overlayState.restoreSession(corpus)) {
      overlayState.seedLastGame(corpus[0]);   // corpus is newest-first
    }
    // Something is on screen, so idle is now unreachable and the app rests in
    // `post` between games instead of blanking.
    if (corpus.length) matchPhase.seedGame();
    // Autocomplete covers every name ever seen. Identity is a separate and
    // explicit choice that never comes out of this box.
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

// The preview harness (tools/desktop-preview.js) stubs the IPC bridge but
// cannot run a real parse, because there are no .w3g files behind its
// summaries. Anything normally driven by a parse has to be driven by hand
// there, so the views it exists to exercise are reachable. Never set in a real
// build: `__WC3V_PREVIEW__` only exists on the generated preview page.
if (window.__WC3V_PREVIEW__) {
  window.__WC3V_VIEWS__ = { gamesView, store, backfill, catchUpOnRecentGames };
}

boot().catch(e => log(`WC3V could not start: ${errText(e)}`, 'err'));
