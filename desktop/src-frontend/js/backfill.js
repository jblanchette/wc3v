// Backfill engine — parse every playable replay on disk, in the background,
// resumable. (ROADMAP §2)
//
// Decisions on record:
//   • 2 workers, and NO detection of whether WC3 is running — no process
//     enumeration, ever. The engine just stays light enough that it never
//     matters.
//   • skipPathfinding — fast profile mode, ~3x. The output is summaries only
//     and is never rendered, which is the one case that mode is safe for.
//   • Progress IS the parse store: a game is done when its content key has a
//     summary (or a failure marker). There is no separate queue file to
//     corrupt or drift — restarting the app and pressing the button again
//     resumes exactly where it stopped, because everything stored is skipped.
//
// Queue order is newest-first (the scan sorts by mtime), so recent games —
// the ones the profile layer cares most about — gain value immediately.

(function () {
  'use strict';

  const WORKERS = 2;

  window.createBackfill = (deps) => {
    // deps: invoke, log, makeWorker, parseOn(worker, path), persistSummary(out, key),
    //       isStored(key), status(text), onIdleChange(running),
    //       progress(done, total) — optional
    const st = {
      running: false,
      queue: [],
      claimed: new Set(),   // keys taken this run, so two paths of one game can't race
      failedKeys: new Set(),
      counts: null,
      liveWorkers: 0,
      durations: [],        // recent parse wall-times, ms (rolling window)
      startedAt: 0
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

    // Honest about remaining time: no ETA until enough parses have actually
    // been measured, and even then it is labelled rough. Extrapolations in
    // this project have been wrong three times.
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
            st.counts.unreadable++; // locked/moved — not marked, retries next run
            update();
            continue;
          }
          if (deps.isStored(key) || st.failedKeys.has(key) || st.claimed.has(key)) {
            st.counts.skipped++;
            update();
            continue;
          }
          st.claimed.add(key);
          if (w._dead) w = deps.makeWorker();

          const t0 = performance.now();
          try {
            const out = await deps.parseOn(w, item.path);
            await deps.persistSummary(out, key, playedAt);
            st.counts.parsed++;
            st.durations.push(performance.now() - t0);
            if (st.durations.length > 20) st.durations.shift();
          } catch (err) {
            st.counts.failed++;
            st.failedKeys.add(key);
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
      if (st.running && st.queue.length === 0) {
        st.running = false;
        // The real, measured end-to-end rate — the number the roadmap wants
        // before anyone quotes one.
        deps.log(
          `backfill done: ${c.parsed.toLocaleString()} parsed, ` +
          `${c.skipped.toLocaleString()} already done, ${c.failed.toLocaleString()} failed ` +
          `in ${fmtDur(wall)}` +
          (c.parsed ? ` — measured ${((wall / 1000) / c.parsed).toFixed(1)} s/replay end-to-end` : ''),
          'ok'
        );
        deps.status(`done — ${c.parsed.toLocaleString()} parsed, ${c.failed.toLocaleString()} failed`);
      } else {
        deps.status(`paused at ${processed().toLocaleString()} / ${c.total.toLocaleString()} — safe to close, resumes where it left off`);
      }
      deps.onIdleChange(false);
    };

    const start = async () => {
      if (st.running) return;
      st.running = true;
      deps.onIdleChange(true);
      deps.status('scanning…');

      const { replays } = await deps.invoke('scan_all');
      st.failedKeys = new Set(await deps.invoke('list_parse_failures'));
      // LastReplay.w3g is a second encoding of a game whose autosave is also
      // in the queue — parsing it would double-count the game in the profile.
      st.queue = replays.filter(r =>
        r.interesting && !/^lastreplay\.w3g$/i.test(r.file_name));
      st.claimed = new Set();
      st.counts = { total: st.queue.length, parsed: 0, skipped: 0, failed: 0, unreadable: 0 };
      st.durations = [];
      st.startedAt = performance.now();

      deps.log(`backfill: ${st.counts.total.toLocaleString()} playable replays queued, ` +
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
      deps.log(`cleared ${n} failure marker(s) — those replays will be retried`, 'ok');
      start();
    };

    // Idle summary for boot: how much of the corpus is already covered.
    const init = async () => {
      try {
        const failed = await deps.invoke('list_parse_failures');
        st.failedKeys = new Set(failed);
      } catch (e) { /* store unavailable — counts just start blank */ }
      return { failedCount: st.failedKeys.size };
    };

    return {
      init,
      toggle: () => (st.running ? pause() : start()),
      retryFailed,
      get running () { return st.running; },
      get failedCount () { return st.failedKeys.size; }
    };
  };
})();
