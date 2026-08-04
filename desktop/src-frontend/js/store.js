// Parse store — the app's memory of every game it has ever parsed.
//
// Retention decision (ROADMAP §1): the full .wc3v parse is NOT persisted —
// thousands of them is gigabytes. What survives is one gzipped summary per
// unique game (a few KB), keyed by content, under
// <app_data>/replays/<size>-<xxh3>.summary.json.gz. The raw .w3g on disk stays
// the source of truth and a full parse is redone on demand.
//
// The corpus (every stored summary, loaded once per session) is what the
// profile layer, the head-to-head card and the overlay all aggregate over.

(function () {
  'use strict';

  // Bump when a stored summary gains a field the UI cannot derive from an
  // older one. v1 → v2 added `moments`, which needs the full parse (battles
  // are not part of SummaryExtract), so a v1 game offers a re-parse instead of
  // showing a silently empty moment list.
  const SCHEMA_VERSION = 2;

  window.createStore = (deps) => {
    // deps: invoke, log
    const invoke = deps.invoke;

    // Keys of games whose summary is already on disk.
    const stored = new Set();
    let corpus = null;
    let corpusLoading = null;

    // The platform's gzip, shared by the map cache reads and the parse store.
    // Deliberately not a second copy of pako.
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

    // Mirror of CompareInline.buildUserSummary(), with the slot-skip rules from
    // scripts/generate-summary.js. mapInfo needs the map-folder manifest the
    // site fetches at runtime; the desktop app has no consumer for it yet.
    const buildSummary = (out, key, playedAt) => {
      const SE = window.SummaryExtract;
      const rawMap = out.replay?.metadata?.map?.mapName || '';
      const durationMs = out.replay?.subheader?.replayLengthMS || 0;
      const worldNeutralGroups = out.world?.neutralGroups || null;
      const summary = {
        key,
        schemaVersion: SCHEMA_VERSION,
        savedAt: Date.now(),
        // When the game was PLAYED (replay file mtime) — what the profile
        // layer buckets by. savedAt is merely when the backfill reached it.
        playedAt: playedAt || null,
        patchVersion: out.replay?.subheader?.version ?? null,
        map: rawMap.split(/[\\/]/).pop(),
        mapRaw: rawMap,
        gameMode: out.gameMode || null,
        winner: out.winner || null,
        durationMs,
        neutralCamps: SE.extractNeutralCamps(worldNeutralGroups),
        // The fights. This is the ONE thing here that cannot be recovered from
        // a stored summary later — `out.battles` exists only in the full parse
        // — so it is extracted now, while the parse is still in hand.
        moments: window.MomentsExtract.extractMoments(out),
        players: {}
      };
      for (const slot of Object.keys(out.players || {})) {
        const pd = out.players[slot];
        const rpd = out.replay?.players?.[slot];
        if (!pd || !rpd || pd.isNeutralPlayer) continue;
        if (rpd.teamId >= 1000) continue; // AI / neutral teams
        summary.players[slot] = SE.extractPlayerSummary(pd, rpd, durationMs, worldNeutralGroups);
        // teamId is not part of the shared summary shape (the compare modal
        // never groups by team); the desktop views do, so carry it alongside.
        summary.players[slot].teamId = rpd.teamId;
      }
      return summary;
    };

    const persistSummary = async (out, key, playedAt) => {
      const summary = buildSummary(out, key, playedAt);
      const bytes = await gzipText(JSON.stringify(summary));
      await invoke('save_parse', { key, bytes: Array.from(bytes) });
      stored.add(key);
      if (corpus) {
        // Re-parsing an already-stored game (a schema upgrade) must REPLACE its
        // corpus entry, not append a second copy — the profile counts games,
        // and a duplicate would inflate every record it feeds.
        const at = corpus.findIndex(g => g.key === key);
        if (at === -1) corpus.push(summary);
        else corpus[at] = summary;
      }
      return summary;
    };

    const read = async (key) =>
      gunzipJson(new Uint8Array(await invoke('read_parse', { key })));

    // The whole store, loaded once per session and appended to as new games
    // persist.
    const loadCorpus = async () => {
      if (corpus) return corpus;
      if (corpusLoading) return corpusLoading;
      corpusLoading = (async () => {
        const keys = await invoke('list_parses');
        const out = [];
        let i = 0;
        let done = 0;
        const reader = async () => {
          while (i < keys.length) {
            const k = keys[i++];
            try {
              out.push(await read(k));
            } catch (e) { /* one corrupt entry must not sink the corpus */ }
            if (++done % 500 === 0) deps.log(`history: ${done}/${keys.length} games loaded`);
          }
        };
        await Promise.all(Array.from({ length: 8 }, reader));
        // Newest first is the order every view wants.
        out.sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0));
        corpus = out;
        return out;
      })();
      return corpusLoading;
    };

    return {
      SCHEMA_VERSION,
      gunzipJson,
      buildSummary,
      persistSummary,
      read,
      loadCorpus,
      has: (key) => stored.has(key),
      get size () { return stored.size; },
      get corpus () { return corpus; },
      // Boot: the on-disk key list, so an already-parsed game is recognised
      // before the (much slower) corpus load finishes.
      async init () {
        const keys = await invoke('list_parses');
        for (const k of keys) stored.add(k);
        return stored.size;
      },
      // A summary written before `moments` existed. The UI offers a re-parse
      // rather than pretending the game had no moments.
      isStale: (summary) => !summary || (summary.schemaVersion || 1) < SCHEMA_VERSION
    };
  };
})();
