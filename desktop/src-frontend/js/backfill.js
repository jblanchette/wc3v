// Backfill engine: parse every playable replay on disk, in the background,
// resumable.
//
// Decisions on record:
//   • 2 workers, and no detection of whether WC3 is running. No process
//     enumeration, ever. The engine stays light enough that it never matters.
//   • skipPathfinding, which is fast profile mode at roughly 3x. The output is
//     summaries that never get rendered, the one case that mode is safe for.
//   • Progress is the parse store. A game is done when its content key has a
//     summary or a failure marker. No separate queue file exists to corrupt or
//     drift, so restarting the app and pressing the button again resumes
//     exactly where it stopped.
//
// Queue order is newest-first, since the scan sorts by mtime. Recent games are
// the ones the profile layer cares most about.
//
// The same engine runs the first-boot catch-up: `start({ limit: 10 })` takes
// the ten newest and stops. A fresh install otherwise shows an empty feed until
// the user finds the "Parse all replays" button in Settings, and an empty feed
// is indistinguishable from a broken one. Ten is enough to make the app worth
// looking at without holding a first launch hostage to a 3,000-game history.

(function () {
  'use strict';

  const WORKERS = 2;

  window.createBackfill = (deps) => {
    // deps: invoke, log, makeWorker, parseOn(worker, path), persistSummary(out, key),
    //       isCurrent(key), status(text), onIdleChange(running),
    //       progress(done, total) [optional]
    const st = {
      running: false,
      queue: [],
      claimed: new Set(),   // keys taken this run, so two paths of one game can't race
      failedKeys: new Set(),
      counts: null,
      liveWorkers: 0,
      durations: [],        // recent parse wall-times, ms (rolling window)
      startedAt: 0,
      // Per-run, set by start(). The full backfill leaves them null: a progress
      // chip per replay is right for ten games and absurd for three thousand.
      onProgress: null,
      limited: false,
      // What a resume should repeat. `toggle()` used to call start() bare,
      // which reset onProgress to null — so a paused migration came back with
      // a strip that never moved again.
      lastOpts: null
    };

    const report = (file, phase) => {
      if (st.onProgress) {
        try { st.onProgress(file, phase); } catch (e) { /* UI must not stop a parse */ }
      }
    };

    const fmtDur = (ms) => {
      const min = ms / 60000;
      if (min < 1) return `${Math.round(ms / 1000)} s`;
      if (min < 90) return `${Math.round(min)} min`;
      return `${(min / 60).toFixed(1)} h`;
    };

    const median = (xs) => {
      const s = [...xs].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };

    const processed = () => {
      const c = st.counts;
      return c.parsed + c.skipped + c.failed + c.unreadable;
    };

    // No ETA until enough parses have been measured, and it says "rough" even
    // then. Extrapolations in this project have been wrong three times.
    const update = () => {
      const c = st.counts;
      let line = `${processed().toLocaleString()} / ${c.total.toLocaleString()}`;
      if (c.parsed) line += ` · ${c.parsed.toLocaleString()} parsed`;
      if (c.skipped) line += ` · ${c.skipped.toLocaleString()} already done`;
      if (c.failed) line += ` · ${c.failed.toLocaleString()} failed`;
      if (c.unreadable) line += ` · ${c.unreadable.toLocaleString()} unreadable`;
      if (st.durations.length >= 5) {
        const per = median(st.durations);
        line += ` · ${(per / 1000).toFixed(1)} s/replay`;
        const left = st.queue.length + st.liveWorkers;
        line += ` · ~${fmtDur((per * left) / WORKERS)} left (rough)`;
      } else if (st.running) {
        line += ' · measuring rate…';
      }
      deps.status(line);
      if (deps.progress) deps.progress(processed(), c.total);
    };

    const workerLoop = async () => {
      let w = deps.makeWorker();
      st.liveWorkers++;
      try {
        while (st.running) {
          const item = st.queue.shift();
          if (!item) break;

          // Canonical content key. The scan's lazy `<size>-u` keys are not
          // stable, so identity is always re-derived here.
          let key = null;
          let playedAt = 0;
          try {
            const rk = await deps.invoke('replay_key', { path: item.path });
            key = rk.key;
            playedAt = rk.modifiedMs;
          } catch (e) {
            st.counts.unreadable++; // locked or moved; unmarked, retries next run
            report(item.file_name, 'failed');
            update();
            continue;
          }
          // isCurrent, not isStored: a game stored under an older schema is
          // work this run still has to do. See store.js isCurrent().
          if (deps.isCurrent(key) || st.failedKeys.has(key) || st.claimed.has(key)) {
            st.counts.skipped++;
            report(item.file_name, 'done');
            update();
            continue;
          }
          st.claimed.add(key);
          if (w._dead) w = deps.makeWorker();

          report(item.file_name, 'parsing');
          const t0 = performance.now();
          try {
            const out = await deps.parseOn(w, item.path);
            await deps.persistSummary(out, key, playedAt);
            st.counts.parsed++;
            st.durations.push(performance.now() - t0);
            if (st.durations.length > 20) st.durations.shift();
            report(item.file_name, 'done', key);
          } catch (err) {
            st.counts.failed++;
            st.failedKeys.add(key);
            report(item.file_name, 'failed');
            try {
              await deps.invoke('save_parse_failure', {
                key,
                code: String(err.code || 'parse_error'),
                message: String((err && err.message) || err).slice(0, 300)
              });
            } catch (e2) { /* marker write failed; it simply retries next run */ }
          }
          update();
        }
      } finally {
        st.liveWorkers--;
        w.terminate();
        if (st.liveWorkers === 0) finish();
      }
    };

    const finish = () => {
      const c = st.counts;
      const wall = performance.now() - st.startedAt;
      // A limited run is the first-boot catch-up. It reports as itself rather
      // than claiming "backfill done", which would imply the whole history was
      // read when ten games were.
      if (st.limited) {
        st.running = false;
        st.onProgress = null;
        st.limited = false;
        deps.log(`caught up: ${c.parsed} recent game(s) parsed` +
          (c.failed ? `, ${c.failed} failed` : ''), 'ok');
        // The Settings status line is left alone. It reports the size of the
        // whole store, and "done: 10 parsed" there would read as the history
        // being fully read when it has not been touched.
        deps.onIdleChange(false, true);
        return;
      }
      if (st.running && st.queue.length === 0) {
        st.running = false;
        // The measured end-to-end rate. The roadmap wants this number before
        // anyone quotes one.
        deps.log(
          `backfill done: ${c.parsed.toLocaleString()} parsed, ` +
          `${c.skipped.toLocaleString()} already done, ${c.failed.toLocaleString()} failed ` +
          `in ${fmtDur(wall)}` +
          (c.parsed ? `, measured ${((wall / 1000) / c.parsed).toFixed(1)} s/replay end-to-end` : ''),
          'ok'
        );
        deps.status(`done: ${c.parsed.toLocaleString()} parsed, ${c.failed.toLocaleString()} failed`);
      } else {
        deps.status(`paused at ${processed().toLocaleString()} / ${c.total.toLocaleString()}. Safe to close; it resumes here.`);
      }
      deps.onIdleChange(false);
    };

    // opts: { limit, onQueue(files), onProgress(file, phase, key) }
    //
    // `limit` takes the newest N and stops, which is the first-boot catch-up.
    // Without it this is the full backfill and behaves exactly as before.
    const start = async (opts) => {
      if (st.running) return;
      const o = opts || {};
      st.lastOpts = o;
      st.running = true;
      st.limited = !!o.limit;
      st.onProgress = o.onProgress || null;
      deps.onIdleChange(true, st.limited);
      deps.status('scanning…');

      const { replays } = await deps.invoke('scan_all');
      st.failedKeys = new Set(await deps.invoke('list_parse_failures'));
      // LastReplay.w3g is a second encoding of a game whose autosave is also
      // in the queue. Parsing it would double-count that game in the profile.
      st.queue = replays.filter(r =>
        r.interesting && !/^lastreplay\.w3g$/i.test(r.file_name));
      // Newest first is already the scan's order, so a limit is a slice.
      if (o.limit) st.queue = st.queue.slice(0, o.limit);
      st.claimed = new Set();
      st.counts = { total: st.queue.length, parsed: 0, skipped: 0, failed: 0, unreadable: 0 };
      st.durations = [];
      st.startedAt = performance.now();

      if (o.onQueue) {
        try { o.onQueue(st.queue.map(r => r.file_name)); } catch (e) { /* UI only */ }
      }

      deps.log(st.limited
        ? `catching up on your ${st.counts.total} most recent game(s)`
        : `backfill: ${st.counts.total.toLocaleString()} playable replays queued, ` +
          `${st.failedKeys.size} known-bad skipped`, 'ok');
      update();
      for (let i = 0; i < WORKERS; i++) workerLoop();
    };

    const pause = () => {
      if (!st.running) return;
      st.running = false; // loops exit after their current item
      deps.status('pausing after current replays…');
    };

    const retryFailed = async () => {
      if (st.running) return;
      const n = await deps.invoke('clear_parse_failures');
      st.failedKeys = new Set();
      deps.log(`cleared ${n} failure marker(s); those replays get retried`, 'ok');
      start();
    };

    // Idle summary for boot: how much of the corpus is already covered.
    const init = async () => {
      try {
        const failed = await deps.invoke('list_parse_failures');
        st.failedKeys = new Set(failed);
      } catch (e) { /* store unavailable; counts start blank */ }
      return { failedCount: st.failedKeys.size };
    };

    return {
      init,
      // The full backfill. app.js drives the "Updating your history" strip with
      // this and its onProgress; it was NOT exported until Aug 2026, so every
      // call threw `backfill.start is not a function` and the migration sat at
      // its opening count forever. Anything added here needs a caller check.
      start,
      // Pause, or resume the run that was paused — with the options it was
      // started with, so the progress callback survives the round trip.
      toggle: () => (st.running ? pause() : start(st.lastOpts || {})),
      // First-boot catch-up. Same engine, same dedupe, same failure markers,
      // just the newest N and a per-file callback for the quick-nav chips.
      catchUp: (limit, hooks) => start({ limit, ...(hooks || {}) }),
      retryFailed,
      get running () { return st.running; },
      get failedCount () { return st.failedKeys.size; }
    };
  };
})();
