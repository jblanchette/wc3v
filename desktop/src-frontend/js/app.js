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
  jobs: new Map(),
  // Keys (`<size>-<xxh3>`) of games whose summary is already stored on disk.
  stored: new Set(),
  // All stored summaries, loaded lazily for the profile layer.
  corpus: null,
  corpusLoading: null
};

// The platform's gzip, shared by the map cache reads and the parse store.
// Same reasoning as loadMapCache had: don't ship a second copy of pako.
const gunzipJson = async (bytes) => {
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return JSON.parse(await new Response(stream).text());
};
const gzipText = async (text) => {
  const cs = new CompressionStream('gzip');
  const stream = new Blob([text]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const log = (msg, kind = '') => {
  const line = document.createElement('div');
  line.className = `log-line ${kind}`;
  line.textContent = msg;
  el('log').prepend(line);
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

  // A crashed worker never answers again; fail its outstanding jobs so
  // callers (the backfill loop especially) can respawn and move on instead
  // of hanging forever on a promise nobody will settle.
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

// Map data lives on local disk under the app data dir. Files are gzipped
// JSON, exactly as the site serves them.
const loadMapCache = async (mapDataName) => {
  const read = async (file) => {
    const bytes = await invoke('read_map_file', { map: mapDataName, file });
    return new Uint8Array(bytes);
  };

  const [wpm, doo, unit] = await Promise.all([
    read('wpm.json.gz').then(gunzipJson),
    read('doo.json.gz').then(gunzipJson),
    read('unit.json.gz').then(gunzipJson).catch(() => ({ units: [] }))
  ]);
  return { wpm, doo, unit };
};

// Backfill parses hundreds of games on the same handful of ladder maps; a
// small LRU stops the same wpm/doo/unit files being re-read and re-gunzipped
// for every game. Values are promises, so two workers asking for the same map
// at once share a single load. Deliberately small — entries are multi-MB JSON.
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

const parseReplay = (path) => parseReplayWith(ensureWorker(), path);

// ── Parse store ─────────────────────────────────────────────────────────────
//
// Retention decision (ROADMAP §1): the full parse is NOT persisted — 3,072
// replays of .wc3v JSON is gigabytes. What survives is one gzipped summary per
// unique game: the same per-player shape the site's compare modal builds via
// SummaryExtract, a few KB each. The raw .w3g on disk stays the source of
// truth, and a full parse is redone on demand when a game needs full viewing.

// Mirror of CompareInline.buildUserSummary(), with the slot-skip rules from
// scripts/generate-summary.js. mapInfo needs the map-folder manifest the site
// fetches at runtime; the desktop app has no consumer for it yet, so null.
const buildSummary = (out, key, playedAt) => {
  const SE = window.SummaryExtract;
  const rawMap = out.replay?.metadata?.map?.mapName || '';
  const durationMs = out.replay?.subheader?.replayLengthMS || 0;
  const worldNeutralGroups = out.world?.neutralGroups || null;
  const summary = {
    key,
    savedAt: Date.now(),
    // When the game was PLAYED (replay file mtime) — what the profile layer
    // buckets by. savedAt is merely when the backfill reached it.
    playedAt: playedAt || null,
    patchVersion: out.replay?.subheader?.version ?? null,
    map: rawMap.split(/[\\/]/).pop(),
    mapRaw: rawMap,
    gameMode: out.gameMode || null,
    winner: out.winner || null,
    durationMs,
    neutralCamps: SE.extractNeutralCamps(worldNeutralGroups),
    players: {}
  };
  for (const slot of Object.keys(out.players || {})) {
    const pd = out.players[slot];
    const rpd = out.replay?.players?.[slot];
    if (!pd || !rpd || pd.isNeutralPlayer) continue;
    if (rpd.teamId >= 1000) continue; // AI / neutral teams
    summary.players[slot] = SE.extractPlayerSummary(pd, rpd, durationMs, worldNeutralGroups);
    // teamId is not part of the shared summary shape (the compare modal never
    // groups by team); the stored-result view does, so carry it alongside.
    summary.players[slot].teamId = rpd.teamId;
  }
  return summary;
};

const persistSummary = async (out, key, playedAt) => {
  const summary = buildSummary(out, key, playedAt);
  const bytes = await gzipText(JSON.stringify(summary));
  await invoke('save_parse', { key, bytes: Array.from(bytes) });
  state.stored.add(key);
  if (state.corpus) state.corpus.push(summary);
  return summary;
};

const loadStoredSummary = async (key) =>
  gunzipJson(new Uint8Array(await invoke('read_parse', { key })));

// The whole store, loaded once per session and appended to as new games
// persist. This is what the profile layer and overlay seeding aggregate over.
const loadCorpus = async () => {
  if (state.corpus) return state.corpus;
  if (state.corpusLoading) return state.corpusLoading;
  state.corpusLoading = (async () => {
    const keys = await invoke('list_parses');
    const out = [];
    let i = 0;
    let done = 0;
    const reader = async () => {
      while (i < keys.length) {
        const k = keys[i++];
        try {
          out.push(await loadStoredSummary(k));
        } catch (e) { /* one corrupt entry must not sink the corpus */ }
        if (++done % 500 === 0) log(`profile corpus: ${done}/${keys.length} loaded`);
      }
    };
    await Promise.all(Array.from({ length: 8 }, reader));
    state.corpus = out;
    return out;
  })();
  return state.corpusLoading;
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
  const { replays, stats } = await invoke('scan_replays', { root });
  const wall = Math.round(performance.now() - t0);

  // Phase 1 result: every file, duplicates not yet collapsed. Render it now —
  // dedupe arrives on the `scan-deduped` event and quietly replaces the list.
  state.replays = replays;
  showCounts(replays, ' · deduping…');
  log(`listed ${label} in ${wall} ms — ` +
      `walk ${stats.walk_ms} / stat ${stats.stat_ms} ms, ${stats.files_seen} files`);
  renderReplays();
};

const showCounts = (list, suffix = '') => {
  const interesting = list.filter(r => r.interesting).length;
  el('status').textContent =
    `${list.length} replays (${interesting} playable, ` +
    `${list.length - interesting} aborted)${suffix}`;
};

// opts.live marks a watcher-detected game: it enters the overlay session.
// Clicking through history never does — a streamer browsing old replays must
// not scramble their on-stream score.
const run = async (path, opts = {}) => {
  el('result').textContent = '';
  el('status').textContent = 'reading...';
  const fileName = path.split(/[\\/]/).pop();
  const started = performance.now();
  try {
    // Canonical identity first — a game already summarised is shown from the
    // store instead of being re-parsed. The key is content-based, so the same
    // game under another path (a copied file) also hits.
    const { key, modifiedMs } = await invoke('replay_key', { path });
    let summary = null;

    if (state.stored.has(key)) {
      summary = await loadStoredSummary(key);
      el('status').textContent = 'loaded from store';
      showSummary(summary);
      log(`${fileName} already parsed — loaded stored summary`, 'ok');
    } else {
      const out = await parseReplay(path);
      const ms = Math.round(performance.now() - started);
      el('status').textContent = `parsed in ${ms} ms`;
      showResult(out, ms);
      log(`parsed ${fileName} in ${ms} ms`, 'ok');

      // Persistence failing should never take the shown result down with it.
      try {
        summary = await persistSummary(out, key, modifiedMs);
        log(`summary saved (${state.stored.size} games in store)`, 'ok');
      } catch (e) {
        log(`summary save failed: ${errText(e)}`, 'warn');
      }
    }

    if (opts.live && summary) {
      overlayState.recordGame(summary);
      resolveIdentity();
    }
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

// A stored summary has no eventStream, so length comes from durationMs and
// the roster from the summary players (name/race/teamId carried per slot).
const showSummary = (sum) => {
  const byTeam = new Map();
  for (const p of Object.values(sum.players || {})) {
    const team = p.teamId ?? 0;
    if (!byTeam.has(team)) byTeam.set(team, []);
    const opener = p.heroOpener?.name ? ` — ${p.heroOpener.name} @ ${p.heroOpener.gameTimeFormatted}` : '';
    byTeam.get(team).push(`    ${p.name}  (${RACE[p.race] || p.race})${opener}`);
  }

  const teams = [...byTeam.entries()]
    .map(([tid, rows]) => `  team ${tid}\n${rows.join('\n')}`)
    .join('\n');

  el('result').textContent = [
    `map:      ${sum.map || '?'}`,
    `mode:     ${sum.gameMode || '?'}`,
    `length:   ~${Math.round((sum.durationMs || 0) / 60000)} min`,
    `winner:   ${sum.winner ? JSON.stringify(sum.winner) : (sum.gameMode === '1v1' ? 'unknown' : 'n/a (1v1 only)')}`,
    `stored:   ${fmtDate(sum.savedAt)}`,
    '',
    teams
  ].join('\n');
};

// ── Profile (ROADMAP §3) ────────────────────────────────────────────────────

const fmtMonth = (ms) => (ms ? new Date(ms).toISOString().slice(0, 7) : '?');
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Text render into the result panel — the spike aesthetic; §5 owns design.
const renderProfile = (p) => {
  const lines = [];
  const pad = (s, n) => String(s).padEnd(n);
  lines.push(`PROFILE — ${p.name}`);
  lines.push(
    `${p.games} games · ${fmtMonth(p.firstPlayedAt)} → ${fmtMonth(p.lastPlayedAt)}` +
    (p.decided ? ` · ${p.wins}–${p.losses} (${p.winRate}%)` : '') +
    (p.unknownResults ? ` · ${p.unknownResults} without result` : ''));
  if (p.races.length) {
    lines.push('races:   ' + p.races.map(r => `${RACE[r.race] || r.race} ${r.games}`).join(' · '));
  }

  if (p.statements.length) {
    lines.push('', 'COACH');
    for (const s of p.statements) lines.push(`• ${s.text}`);
  }

  if (p.matchups.length) {
    lines.push('', 'MATCHUPS');
    for (const m of p.matchups.slice(0, 6)) {
      lines.push(`  ${pad(m.matchup, 6)} ${pad(m.games + ' games', 11)}` +
        (m.wins + m.losses ? ` ${m.wins}–${m.losses} (${m.winRate}%)` : ''));
    }
  }

  if (p.maps.length) {
    lines.push('', 'MAPS');
    for (const m of p.maps.slice(0, 8)) {
      lines.push(`  ${pad(m.map, 24)} ${pad(m.games + ' games', 11)}` +
        (m.wins + m.losses ? ` ${m.winRate}%` : ''));
    }
  }

  // Opponent buckets are fed with the PROFILE player's result, so this reads
  // "their record against that opponent".
  if (p.opponents.length) {
    lines.push('', 'MOST FACED');
    for (const o of p.opponents.slice(0, 10)) {
      lines.push(`  ${pad(o.name, 20)} ${pad(o.games + ' games', 11)}` +
        (o.wins + o.losses ? ` ${o.wins}–${o.losses} (${o.winRate}%)` : ''));
    }
  }

  el('result').textContent = lines.join('\n');
};

// ── Boot ────────────────────────────────────────────────────────────────────

const boot = async () => {
  const info = await invoke('init');
  state.roots = info.roots;
  state.mapCacheDir = info.map_cache_dir;
  // Path deliberately not rendered — see labelFor().
  el('cache-dir').textContent = 'local app data';
  renderRoots();

  // An unreadable store just means everything re-parses; not fatal.
  try {
    state.stored = new Set(await invoke('list_parses'));
    if (state.stored.size) log(`${state.stored.size} parsed game(s) in store`, 'ok');
  } catch (e) {
    log(`parse store unavailable: ${errText(e)}`, 'warn');
  }
  await backfill.init();
  syncRetryButton();

  // Reflect the real OS setting rather than assuming a default.
  invoke('get_autostart')
    .then(on => { el('autostart-toggle').checked = on; })
    .catch(() => { el('autostart-toggle').disabled = true; });
  if (state.stored.size) {
    el('backfill-status').textContent =
      `idle — ${state.stored.size.toLocaleString()} game(s) already parsed`;
  }

  const watched = await invoke('start_watching');
  log(`watching ${watched} replay folder(s)`, 'ok');

  await listen('replay-detected', (event) => {
    const r = event.payload;
    log(`new game: ${r.fileName} (${fmtSize(r.size)})`, 'ok');
    if (r.interesting) run(r.path, { live: true });
  });

  await listen('watcher-error', (event) => log(`watcher: ${event.payload}`, 'err'));

  // Dedupe finished behind the rendered list.
  await listen('scan-deduped', (event) => {
    const { replays, stats } = event.payload;
    state.replays = replays;
    showCounts(replays);
    // Surface the cost breakdown. Hashing is size-gated and index-cached, so a
    // repeat scan should report 0 hashed and all index hits — if that ever
    // stops being true it shows up here instead of just feeling slow.
    log(`deduped in ${stats.total_ms} ms — ${stats.duplicates} duplicates removed · ` +
        `hashed ${stats.hashed} (${(stats.bytes_hashed / 1048576).toFixed(0)} MB), ` +
        `index hits ${stats.index_hits}`, 'ok');
    renderReplays();
  });

  // Scanning is the slow step (it hashes every file), and a failure here
  // should not take the rest of the app down with it.
  if (state.roots.length) {
    const first = state.roots[0].path;
    scan(first).catch(e => {
      el('status').textContent = 'scan failed';
      log(`scan failed in ${labelFor(first)}: ${errText(e)}`, 'err');
    });
  }

  // Overlay: publish the empty session immediately so an OBS source that is
  // already connected shows the waiting card rather than nothing.
  overlayState.publish();

  // Background: load the summary corpus, then seed the overlay's last game,
  // the default profile identity, and the name autocomplete.
  loadCorpus().then((corpus) => {
    if (!corpus.length) return;
    const PA = window.ProfileAggregate;
    const latest = [...corpus].sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0))[0];
    overlayState.seedLastGame(latest);
    el('known-names').innerHTML = PA.knownNames(corpus).slice(0, 60)
      .map(n => `<option value="${escAttr(n.name)}">`).join('');
    log(`profile corpus ready: ${corpus.length} game(s)`, 'ok');
    resolveIdentity();
    if (!el('profile-name').value) el('profile-name').value = overlayState.userName || '';
  }).catch(e => log(`corpus load failed: ${errText(e)}`, 'warn'));
};

// Tauri command rejections arrive as plain strings, not Errors, so `e.message`
// is undefined for exactly the failures we most need to read.
const errText = (e) =>
  (e && e.message) || (typeof e === 'string' ? e : JSON.stringify(e));

// ── Backfill wiring ─────────────────────────────────────────────────────────

const backfill = window.createBackfill({
  invoke,
  log,
  makeWorker,
  // Fast profile mode: summaries are never rendered, the one case where
  // skipPathfinding is allowed. Quiet keeps the status line for the user's
  // own interactive parse.
  parseOn: (worker, path) =>
    parseReplayWith(worker, path, { quiet: true, parserOptions: { skipPathfinding: true } }),
  persistSummary,
  isStored: (key) => state.stored.has(key),
  status: (text) => { el('backfill-status').textContent = text; },
  onIdleChange: (running) => {
    el('backfill-toggle').textContent = running ? 'Pause' : 'Parse all replays';
    syncRetryButton();
  }
});

// Work out which player is "you", or ask.
//
// Nothing in the .w3g format marks which seat saved the replay, so identity
// comes from frequency: across a real history the account owner is in every
// game and nobody else is close. That needs more than one game — with a
// single replay both players are tied at one appearance and guessing would be
// a coin flip that silently mislabels every Victory as a Defeat. So when the
// signal is absent, ask instead of guessing.
const resolveIdentity = () => {
  if (overlayState.userName) return;

  const corpus = state.corpus;
  if (corpus && corpus.length) {
    const primary = window.ProfileAggregate.detectPrimaryName(corpus);
    if (primary) {
      overlayState.setUserName(primary.name);
      el('profile-name').value = primary.name;
      log(`identified you as ${primary.name} (in ${primary.games} of ${corpus.length} games)`, 'ok');
      return;
    }
  }

  const names = overlayState.lastGameCandidates;
  if (!names.length) return;
  // Prefill with the first candidate so "This is me" is one click away, and
  // put both in the datalist so the other is one keystroke away.
  el('profile-name').value = el('profile-name').value || names[0];
  el('known-names').innerHTML = names.map(n => `<option value="${escAttr(n)}">`).join('');
  log(`Which player are you — ${names.join(' or ')}? ` +
      `Pick one in the Profile box and click "This is me" so wins and losses ` +
      `can be scored. (Parsing more of your history sorts this out on its own.)`, 'warn');
};

const syncRetryButton = () => {
  const btn = el('backfill-retry');
  const n = backfill.failedCount;
  btn.hidden = backfill.running || n === 0;
  if (n) btn.textContent = `Retry ${n} failed`;
};

el('backfill-toggle').addEventListener('click', () => backfill.toggle());
el('backfill-retry').addEventListener('click', () => backfill.retryFailed());

// ── Overlay + profile wiring ────────────────────────────────────────────────

const overlayState = window.createOverlayState({ invoke, log });

el('profile-view').addEventListener('click', async () => {
  const corpus = await loadCorpus();
  if (!corpus.length) {
    log('no parsed games in store yet — run the backfill first', 'warn');
    return;
  }
  const PA = window.ProfileAggregate;
  const name = el('profile-name').value.trim() || (PA.detectPrimaryName(corpus) || {}).name;
  if (!name) return;
  const profile = PA.buildProfile(corpus, name);
  if (!profile.games) {
    el('result').textContent = `No games with "${name}" in the local history.`;
    return;
  }
  renderProfile(profile);
  el('status').textContent = `profile: ${profile.name} — ${profile.games} games`;
});

el('profile-setme').addEventListener('click', () => {
  const name = el('profile-name').value.trim();
  if (!name) return;
  overlayState.setUserName(name);
  log(`overlay identity set — games are scored from ${name}'s seat`, 'ok');
});

el('copy-obs-url').addEventListener('click', async () => {
  try {
    const info = await invoke('overlay_info');
    await navigator.clipboard.writeText(info.url);
    // The URL stays out of the log on purpose: it carries the access token
    // and this window may be on stream.
    log('OBS URL copied — add a Browser Source, suggested 460×640. ' +
        'Keep the URL off stream; it contains your access token.', 'ok');
  } catch (e) {
    log(`overlay URL unavailable: ${errText(e)}`, 'err');
  }
});

el('open-player-view').addEventListener('click', () =>
  invoke('open_player_view').catch(e => log(`player view failed: ${errText(e)}`, 'err')));

// ── Shell: autostart + updates ──────────────────────────────────────────────

el('autostart-toggle').addEventListener('change', async (e) => {
  const wanted = e.target.checked;
  try {
    // Trust the OS, not the click: re-read the real state afterwards, so a
    // silently-refused registry write cannot leave the box lying.
    const actual = await invoke('set_autostart', { enabled: wanted });
    e.target.checked = actual;
    log(actual ? 'WC3V will start with Windows' : 'startup entry removed', 'ok');
  } catch (err) {
    e.target.checked = !wanted;
    log(`could not change startup setting: ${errText(err)}`, 'err');
  }
});

const runUpdateCheck = async (install) => {
  const out = el('update-status');
  out.textContent = 'checking…';
  try {
    const r = await invoke('check_for_update', { install });
    if (r.status === 'current') {
      out.textContent = 'up to date';
    } else if (r.status === 'unconfigured') {
      // A dev build, or one shipped without an update endpoint. Say so
      // rather than implying the app is current.
      out.textContent = 'updates not configured for this build';
    } else if (r.status === 'available') {
      out.textContent = `version ${r.version} available`;
      log(`update ${r.version} available — click again to install`, 'ok');
      el('check-update').textContent = `Install ${r.version}`;
      el('check-update').dataset.install = '1';
    } else if (r.status === 'installed') {
      out.textContent = `installed ${r.version} — restart to apply`;
      log(`update ${r.version} installed; restart WC3V to apply it`, 'ok');
    }
  } catch (err) {
    out.textContent = 'update check failed';
    log(`update check failed: ${errText(err)}`, 'err');
  }
};

el('check-update').addEventListener('click', (e) =>
  runUpdateCheck(e.currentTarget.dataset.install === '1'));

el('pick-folder').addEventListener('click', async () => {
  const dir = await window.__TAURI__.dialog.open({ directory: true });
  if (!dir) return;
  const root = await invoke('add_root', { path: dir });
  state.roots.push(root);
  renderRoots();
  scan(root.path);
});

boot().catch(e => log(`boot failed: ${errText(e)}`, 'err'));
