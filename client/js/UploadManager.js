// UploadManager — orchestrates browser-side replay parsing.
//
// Flow:
//   1. User picks a .w3g (file picker or drop)
//   2. Validate size + magic bytes locally
//   3. Read as ArrayBuffer, hand to window.Wc3vParser.parseToWc3v(buffer)
//   4. On success: generate id, persist parsed JSON to IndexedDB via
//      MyReplays, navigate to /viewer?local={id}
//   5. On error: surface a specific message (missing map / parse fail / etc)
//
// This subsystem replaces the server-coupled upload code that used to live
// in app.js. No network calls except the map cache fetches that the parser
// itself makes during parse.

// Gated debug logging for the upload pipeline — see clientConfig.js. Silent
// in production; flip WC3V_CONFIG.logging.parser to surface the trace.
const _parserLogEnabled = () => {
  const cfg = (typeof window !== 'undefined') && window.WC3V_CONFIG;
  return !!(cfg && cfg.logging && cfg.logging.parser);
};
const _log = (...args) => {
  if (_parserLogEnabled()) console.log('[UploadManager]', ...args);
};

const UploadManager = class {
  constructor (options = {}) {
    this.maxBytes = options.maxBytes || 5 * 1024 * 1024;
    this.viewerPath = options.viewerPath || '/viewer';
    this.myReplays = options.myReplays || (window.MyReplays ? new window.MyReplays() : null);
    if (!this.myReplays) {
      throw new Error('UploadManager requires MyReplays subsystem');
    }
    this.onProgress = options.onProgress || (() => {});
    this.onError = options.onError || ((msg) => console.error('Upload error:', msg));
    // Parser timeouts. The parser emits a progress message ~every 100ms
    // during a healthy parse, so we don't use a flat wall-clock (it kills
    // legitimately long parses — big 2v2/3v3/4v4/FFA games have far more
    // actions than a 1v1). Instead:
    //   - idle watchdog: abort only if NO progress for parseIdleTimeoutMs
    //     (a true hang / unbounded loop in w3gjs on a malformed file).
    //   - hard cap: absolute ceiling so a parser stuck in a tight loop that
    //     still dribbles progress can't run forever.
    // `parseTimeoutMs` is accepted for back-compat and maps to the idle
    // watchdog.
    this.parseIdleTimeoutMs = options.parseIdleTimeoutMs || options.parseTimeoutMs || 30000;
    this.parseHardCapMs = options.parseHardCapMs || 5 * 60 * 1000;
    // The worker can't read WC3V_CONFIG (separate global scope), so when
    // parser logging is on we pass it through as a URL param the worker
    // checks before silencing the bundle's console output.
    let workerPath = options.workerPath || '/js/parser-worker.js';
    if (_parserLogEnabled() && workerPath.indexOf('log=1') === -1) {
      workerPath += (workerPath.indexOf('?') === -1 ? '?' : '&') + 'log=1';
    }
    this.workerPath = workerPath;
  }

  // Warm the HTTP cache for the parser worker + its ~1 MB bundle so the
  // first actual upload doesn't pay the download. Safe to call repeatedly;
  // injects low-priority <link rel="prefetch"> once. Callers should invoke
  // this on first user intent (drag-enter / button hover / focus).
  static prefetchParser () {
    if (UploadManager._parserPrefetched) return;
    UploadManager._parserPrefetched = true;
    ['/js/parser-worker.js', '/js/vendor/wc3v-parser.bundle.js'].forEach((href) => {
      try {
        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.as = 'script';
        link.href = href;
        document.head.appendChild(link);
      } catch (e) {}
    });
  }

  // Trigger a file picker. Resolves with { id } on success or null if user
  // cancelled. Rejects on parse failure.
  //
  // The input must be appended to the DOM in some browsers (notably Safari)
  // for `onchange` to fire reliably. We attach hidden, click, then remove on
  // any terminal event.
  pickAndParse () {
    _log('pickAndParse: opening file picker');
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.w3g,.nwg';
      input.style.display = 'none';
      document.body.appendChild(input);

      const cleanup = () => {
        try { input.remove(); } catch {}
      };

      input.onchange = async () => {
        const file = input.files && input.files[0];
        _log('file picker change, file =', file && file.name, 'size =', file && file.size);
        cleanup();
        if (!file) return resolve(null);
        try {
          const result = await this.parseFile(file);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      };
      // 'cancel' fires in Chrome 113+ when the user dismisses the picker.
      input.addEventListener('cancel', () => {
        _log('file picker cancelled');
        cleanup();
        resolve(null);
      });

      input.click();
    });
  }

  // Parse a File / Blob. Returns { id, record } on success.
  async parseFile (file) {
    _log('parseFile start:', file && file.name);
    if (!file) throw new Error('no file');
    if (file.size > this.maxBytes) {
      const err = new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB > ${(this.maxBytes / 1024 / 1024).toFixed(0)} MB)`);
      err.code = 'too_large';
      throw err;
    }

    this.onProgress({ phase: 'reading', percent: 0 });
    const arrayBuffer = await file.arrayBuffer();
    _log('file read into ArrayBuffer:', arrayBuffer.byteLength, 'bytes');

    // Magic bytes: "Warcraft III recorded game\x1a\x00" (28 bytes)
    if (!checkW3gMagic(new Uint8Array(arrayBuffer))) {
      const err = new Error('Not a Warcraft III replay (invalid header)');
      err.code = 'unsupported_media';
      throw err;
    }

    this.onProgress({ phase: 'parsing', percent: 0 });

    _log('dispatching parse to worker...');
    let parsed;
    try {
      parsed = await this._parseInWorker(arrayBuffer);
      _log('parser returned, top-level keys:', parsed && Object.keys(parsed));
    } catch (e) {
      _log('parse failed:', e);
      // Map-not-in-library is the most common user-facing error. Preserve
      // the code so the UI can give a precise message.
      if (e && e.code === 'missing_map') {
        const err = new Error(`Map not in our library: ${e.rawMapName || ''}`);
        err.code = 'missing_map';
        err.rawMapName = e.rawMapName;
        throw err;
      }
      if (e && e.code === 'missing_map_cache') {
        const err = new Error(`Map data unavailable for: ${e.mapDataName || ''}`);
        err.code = 'missing_map_cache';
        err.mapDataName = e.mapDataName;
        throw err;
      }
      if (e && e.code === 'parse_timeout') {
        throw e;
      }
      const err = new Error(`Parse failed: ${e.message || e}`);
      err.code = 'parse_failed';
      throw err;
    }

    // Categorize the game. Non-1v1 formats (2v2/3v3/4v4/FFA/custom) are now
    // viewable — they get a single-player build order and a restricted camera
    // in the viewer, plus a "not available for pro analysis" notice. We only
    // hard-reject replays with no opposing players to show.
    const humans = Object.values(parsed.players || {})
      .filter(p => p && !p.isNeutralPlayer);
    let gameMode = (parsed && typeof parsed.gameMode === 'string') ? parsed.gameMode : null;
    if (!gameMode) {
      // Legacy / pre-rebuild bundle fallback. STRICT — must match
      // helpers/utils.js computeGameMode and Wc3vViewer.getGameMode.
      const byTeam = {};
      humans.forEach(p => { byTeam[p.teamId] = (byTeam[p.teamId] || 0) + 1; });
      const counts = Object.values(byTeam);
      const n = humans.length, tc = counts.length;
      if (n < 2) gameMode = 'custom';
      else if (n === 2 && tc === 2) gameMode = '1v1';
      else if (tc === 2 && counts[0] === counts[1]) gameMode = ({ 2: '2v2', 3: '3v3', 4: '4v4' })[counts[0]] || 'custom';
      else if (n >= 3 && tc === n) gameMode = 'ffa';
      else gameMode = 'custom';
    }
    if (humans.length < 2) {
      const err = new Error('This replay has no opposing players to display.');
      err.code = 'no_players';
      throw err;
    }

    this.onProgress({ phase: 'storing', percent: 90 });

    const id = generateId();
    const summary = summariseParsed(parsed);
    const record = {
      id,
      parsedJson: parsed,
      uploadedAt: Date.now(),
      race: summary.race,
      mapName: summary.mapName,
      durationMs: summary.durationMs,
      players: summary.players,
      gameMode,
      originalFilename: file.name
    };

    await this.myReplays.put(record);
    this.onProgress({ phase: 'done', percent: 100 });
    return { id, record };
  }

  // Convenience: pick + parse + navigate.
  async pickParseAndOpen () {
    const result = await this.pickAndParse();
    if (!result) return null;
    window.location.href = `${this.viewerPath}?local=${encodeURIComponent(result.id)}`;
    return result;
  }

  // Run the parser inside a Web Worker with a wall-clock timeout. The
  // worker contains crashes (memory blowup or unbounded loops in w3gjs)
  // and lets us hard-kill via terminate() on timeout.
  //
  // Returns the parsed wc3v object on success. Rejects with a coded error
  // on parser-emitted failure (missing_map, missing_map_cache, …) or with
  // code 'parse_timeout' on an idle stall or the absolute hard cap.
  _parseInWorker (arrayBuffer) {
    const idleMs = this.parseIdleTimeoutMs;
    const hardCapMs = this.parseHardCapMs;
    const workerPath = this.workerPath;
    const onProgress = (evt) => this.onProgress(evt);

    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new Worker(workerPath);
      } catch (e) {
        const err = new Error(`Failed to start parser worker: ${e.message || e}`);
        err.code = 'worker_failed';
        return reject(err);
      }

      let settled = false;
      const finish = (fn) => {
        if (settled) return;
        settled = true;
        clearTimeout(idleTimer);
        clearTimeout(hardTimer);
        try { worker.terminate(); } catch {}
        fn();
      };

      // Idle watchdog: rearmed on every worker message (see onmessage).
      // Fires only if the parser goes silent — a genuine hang.
      let idleTimer;
      const armIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          finish(() => {
            const err = new Error(`Parser stalled — no progress for ${(idleMs / 1000).toFixed(0)}s. The replay may be malformed.`);
            err.code = 'parse_timeout';
            reject(err);
          });
        }, idleMs);
      };
      armIdle();

      // Absolute ceiling regardless of progress.
      const hardTimer = setTimeout(() => {
        finish(() => {
          const err = new Error(`Parse exceeded the ${Math.round(hardCapMs / 60000)} min limit — replay is unusually large or malformed.`);
          err.code = 'parse_timeout';
          reject(err);
        });
      }, hardCapMs);

      worker.onmessage = (e) => {
        const msg = e && e.data;
        if (!msg || !msg.type) return;
        // Any sign of life from the worker rearms the idle watchdog.
        armIdle();
        if (msg.type === 'progress') {
          if (msg.evt) onProgress(msg.evt);
          return;
        }
        if (msg.type === 'done') {
          finish(() => resolve(msg.result));
          return;
        }
        if (msg.type === 'error') {
          finish(() => {
            const err = new Error(msg.message || 'Parse failed');
            if (msg.code) err.code = msg.code;
            if (msg.rawMapName) err.rawMapName = msg.rawMapName;
            if (msg.mapDataName) err.mapDataName = msg.mapDataName;
            reject(err);
          });
        }
      };

      worker.onerror = (ev) => {
        finish(() => {
          const err = new Error(`Parser worker crashed: ${ev.message || 'unknown error'}`);
          err.code = 'parse_failed';
          reject(err);
        });
      };

      // Transfer ownership of the ArrayBuffer (no copy). After this the
      // main thread can't read arrayBuffer; that's fine, we don't.
      try {
        worker.postMessage({ type: 'parse', buffer: arrayBuffer }, [arrayBuffer]);
      } catch (e) {
        finish(() => {
          const err = new Error(`Failed to send buffer to worker: ${e.message || e}`);
          err.code = 'worker_failed';
          reject(err);
        });
      }
    });
  }
};

const W3G_MAGIC_28 = [
  0x57, 0x61, 0x72, 0x63, 0x72, 0x61, 0x66, 0x74, 0x20, 0x49, 0x49, 0x49, 0x20,
  0x72, 0x65, 0x63, 0x6f, 0x72, 0x64, 0x65, 0x64, 0x20, 0x67, 0x61, 0x6d, 0x65,
  0x1a, 0x00
];
const checkW3gMagic = (u8) => {
  if (u8.length < W3G_MAGIC_28.length) return false;
  for (let i = 0; i < W3G_MAGIC_28.length; i++) {
    if (u8[i] !== W3G_MAGIC_28[i]) return false;
  }
  return true;
};

const generateId = () => {
  // 10 chars base64url, ~60 bits entropy. Matches the ID format we'd have
  // used server-side, just generated locally.
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let s = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return s.slice(0, 10);
};

// Pull a small subset out of the full parsed wc3v JSON. The full JSON lives
// in IndexedDB; the summary fields make rendering cards fast without
// re-reading the blob.
const summariseParsed = (parsed) => {
  const result = { race: null, mapName: null, durationMs: null, players: [] };
  if (!parsed) return result;
  if (parsed.replay) {
    if (parsed.replay.metadata && parsed.replay.metadata.map) {
      result.mapName = parsed.replay.metadata.map.mapName || null;
    }
    if (parsed.replay.subheader && typeof parsed.replay.subheader.replayLengthMS === 'number') {
      result.durationMs = parsed.replay.subheader.replayLengthMS;
    }
  }
  if (parsed.players) {
    for (const slot of Object.keys(parsed.players)) {
      const p = parsed.players[slot];
      if (!p || p.isNeutralPlayer) continue;
      const name = (parsed.replay && parsed.replay.players && parsed.replay.players[slot] && parsed.replay.players[slot].name) || `Player ${slot}`;
      result.players.push({ slot: parseInt(slot, 10), name, race: p.race });
      if (!result.race) result.race = p.race;
    }
  }
  return result;
};

if (typeof window !== 'undefined') {
  window.UploadManager = UploadManager;
}
