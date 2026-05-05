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
    // Wall-clock cap on the parser. A malformed .w3g can trigger
    // unbounded loops in w3gjs; the worker also bounds memory blowup.
    this.parseTimeoutMs = options.parseTimeoutMs || 30000;
    this.workerPath = options.workerPath || '/js/parser-worker.js';
  }

  // Trigger a file picker. Resolves with { id } on success or null if user
  // cancelled. Rejects on parse failure.
  //
  // The input must be appended to the DOM in some browsers (notably Safari)
  // for `onchange` to fire reliably. We attach hidden, click, then remove on
  // any terminal event.
  pickAndParse () {
    console.log('[UploadManager] pickAndParse: opening file picker');
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
        console.log('[UploadManager] file picker change, file =', file && file.name, 'size =', file && file.size);
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
        console.log('[UploadManager] file picker cancelled');
        cleanup();
        resolve(null);
      });

      input.click();
    });
  }

  // Parse a File / Blob. Returns { id, record } on success.
  async parseFile (file) {
    console.log('[UploadManager] parseFile start:', file && file.name);
    if (!file) throw new Error('no file');
    if (file.size > this.maxBytes) {
      const err = new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB > ${(this.maxBytes / 1024 / 1024).toFixed(0)} MB)`);
      err.code = 'too_large';
      throw err;
    }

    this.onProgress({ phase: 'reading', percent: 0 });
    const arrayBuffer = await file.arrayBuffer();
    console.log('[UploadManager] file read into ArrayBuffer:', arrayBuffer.byteLength, 'bytes');

    // Magic bytes: "Warcraft III recorded game\x1a\x00" (28 bytes)
    if (!checkW3gMagic(new Uint8Array(arrayBuffer))) {
      const err = new Error('Not a Warcraft III replay (invalid header)');
      err.code = 'unsupported_media';
      throw err;
    }

    this.onProgress({ phase: 'parsing', percent: 0 });

    console.log('[UploadManager] dispatching parse to worker...');
    let parsed;
    try {
      parsed = await this._parseInWorker(arrayBuffer);
      console.log('[UploadManager] parser returned, top-level keys:', parsed && Object.keys(parsed));
    } catch (e) {
      console.error('[UploadManager] parse failed:', e);
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

    // Reject anything that isn't a 1v1. We only support 2 non-neutral players
    // on different teams; multi-player formats render incorrectly in the viewer.
    const humans = Object.values(parsed.players || {})
      .filter(p => p && !p.isNeutralPlayer);
    const teams = new Set(humans.map(p => p.teamId));
    if (humans.length !== 2 || teams.size !== 2) {
      const err = new Error('wc3v only supports 1v1 right now, please try a different replay.');
      err.code = 'not_1v1';
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
  // code 'parse_timeout' if we hit parseTimeoutMs.
  _parseInWorker (arrayBuffer) {
    const timeoutMs = this.parseTimeoutMs;
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
        clearTimeout(timer);
        try { worker.terminate(); } catch {}
        fn();
      };

      const timer = setTimeout(() => {
        finish(() => {
          const err = new Error(`Parse timed out after ${(timeoutMs / 1000).toFixed(0)}s — replay may be malformed`);
          err.code = 'parse_timeout';
          reject(err);
        });
      }, timeoutMs);

      worker.onmessage = (e) => {
        const msg = e && e.data;
        if (!msg || !msg.type) return;
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
