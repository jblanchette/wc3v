// Content key → the .w3g file it came from.
//
// The feed is built from stored SUMMARIES, which are keyed by content
// (`<size>-<xxh3>`) and deliberately carry no filesystem path, because this
// aimed at streamers and paths contain the user's account name. But two
// features need the actual file back: re-parsing an old summary to upgrade its
// schema, and handing the replay to the viewer.
//
// Resolving is cheap because the key's own prefix IS the file size: narrow to
// the handful of files with that exact size, then confirm with `replay_key`
// (one hash) until one matches. Usually there is exactly one candidate.
//
// The scan loads lazily and once, so nothing pays for it until the user
// clicks something that needs a file.

(function () {
  'use strict';

  window.createReplayIndex = (deps) => {
    // deps: invoke, log
    let bySize = null;
    let loading = null;
    const resolved = new Map();  // key -> path (or null when known-missing)

    const load = () => {
      if (bySize) return Promise.resolve(bySize);
      if (loading) return loading;
      loading = (async () => {
        const { replays } = await deps.invoke('scan_all');
        const map = new Map();
        for (const r of replays) {
          if (!r.interesting) continue;
          const list = map.get(r.size) || [];
          list.push(r.path);
          map.set(r.size, list);
        }
        bySize = map;
        return map;
      })();
      loading.catch(() => { loading = null; });
      return loading;
    };

    // Returns a path, or null when the replay is no longer on disk. Callers
    // must handle null, because a user can move or delete replays at any time
    // the store outlives the files.
    const pathFor = async (key) => {
      if (resolved.has(key)) return resolved.get(key);

      const size = Number(String(key).split('-')[0]);
      if (!Number.isFinite(size)) return null;

      const map = await load();
      const candidates = map.get(size) || [];
      for (const path of candidates) {
        try {
          const rk = await deps.invoke('replay_key', { path });
          resolved.set(rk.key, path);          // cache every hash we pay for
          if (rk.key === key) return path;
        } catch (e) { /* locked or moved; try the next candidate */ }
      }
      resolved.set(key, null);
      return null;
    };

    return {
      pathFor,
      // Called when a live game is parsed: its path is already known, so
      // record it instead of making the first click re-derive it.
      remember: (key, path) => resolved.set(key, path)
    };
  };
})();
