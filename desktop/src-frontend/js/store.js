// Parse store: the app's memory of every game it has ever parsed.
//
// Retention decision (ROADMAP §1). The full .wc3v parse is not persisted,
// because thousands of them is gigabytes. What survives is one gzipped summary
// per unique game, a few KB, keyed by content, under
// <app_data>/replays/<size>-<xxh3>.summary.json.gz. The raw .w3g on disk stays
// the source of truth and a full parse is redone on demand.
//
// The corpus (every stored summary, loaded once per session) is what the
// profile layer, the head-to-head card and the overlay all aggregate over.

(function () {
  'use strict';

  // Bump when a stored summary gains a field the UI cannot derive from an
  // older one. v2 added `moments`, which needs the full parse because battles
  // are not part of SummaryExtract, so a v1 game offers a re-parse instead of
  // showing a silently empty list. v3 added per-player `combat`: the complete
  // hero kill and death ledger, wipes, biggest swing. Same source, same
  // reason. v4 added `dominance` and `resources`, the two time series
  // lib/DominanceSeries.js and lib/ResourceSeries.js produce inside
  // buildOutputObject, which is what lets the desktop draw the viewer's own
  // dominance bar, dominance chart and resource charts.
  //
  // Every one of these is extract-at-parse-time-or-never, and the version must
  // be current before the history backfill runs, or thousands of games get
  // stored without a block only a re-parse can recover.
  const SCHEMA_VERSION = 4;

  window.createStore = (deps) => {
    // deps: invoke, log
    const invoke = deps.invoke;

    // Keys of games whose summary is already on disk.
    const stored = new Set();
    let corpus = null;
    let corpusLoading = null;

    // The platform's gzip, shared by the map cache reads and the parse store,
    // instead of a second copy of pako.
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
        // When the game was played, from the replay file mtime. This is what
        // the profile layer buckets by. savedAt is when the backfill got to it.
        playedAt: playedAt || null,
        patchVersion: out.replay?.subheader?.version ?? null,
        map: rawMap.split(/[\\/]/).pop(),
        mapRaw: rawMap,
        gameMode: out.gameMode || null,
        winner: out.winner || null,
        durationMs,
        neutralCamps: SE.extractNeutralCamps(worldNeutralGroups),
        // The fights. Neither moments nor combat can be recovered from a
        // stored summary later, because `out.battles` exists only in the full
        // parse, so both come out now while the parse is in hand. Moments are
        // the capped highlight reel. Combat is the complete per-seat ledger the
        // review layer grades from.
        moments: window.MomentsExtract.extractMoments(out),
        // The two time series the viewer's own charts are drawn from. Same
        // full-parse-only rule as moments and combat, and packed as parallel
        // arrays by SeriesExtract because they are the largest thing in a
        // summary. Null when the dominance gate refused the replay, which is a
        // real answer and not a missing field.
        dominance: window.SeriesExtract.extractDominance(out),
        resources: window.SeriesExtract.extractResources(out),
        players: {}
      };
      const combat = window.MomentsExtract.extractCombat(out);
      for (const slot of Object.keys(out.players || {})) {
        const pd = out.players[slot];
        const rpd = out.replay?.players?.[slot];
        if (!pd || !rpd || pd.isNeutralPlayer) continue;
        if (rpd.teamId >= 1000) continue; // AI / neutral teams
        summary.players[slot] = SE.extractPlayerSummary(pd, rpd, durationMs, worldNeutralGroups);
        // teamId is not part of the shared summary shape, because the compare
        // modal never groups by team. The desktop views do, so carry it.
        summary.players[slot].teamId = rpd.teamId;
        summary.players[slot].combat = combat[slot] || null;
      }
      return summary;
    };

    const persistSummary = async (out, key, playedAt) => {
      const summary = buildSummary(out, key, playedAt);
      const bytes = await gzipText(JSON.stringify(summary));
      await invoke('save_parse', { key, bytes: Array.from(bytes) });
      stored.add(key);
      if (corpus) {
        // Re-parsing an already-stored game, which is what a schema upgrade
        // does, has to replace its corpus entry. The profile counts games, and
        // a second copy would inflate every record it feeds.
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

    // Filtering the corpus. Pure, and here rather than in the renderer,
    // because "which games" is a question about the store and the feed renders
    // whatever list it is handed.
    //
    // Free-text matching only. Seat identity uses ProfileAggregate.normName,
    // the one definition of "same player" everything else shares. This looser
    // fold is for typing: it strips accents so a search for "jaeh" finds
    // "Jæhaerys", which normName does not do. The combining-diacritics range
    // is written as \u escapes because as raw bytes they are invisible in an
    // editor, and one bad save would turn accent folding off with nothing to
    // see.
    const searchFold = (s) => String(s || '')
      .normalize('NFKD').replace(new RegExp('[\u0300-\u036f]', 'g'), '').toLowerCase();

    const filterCorpus = (games, f) => {
      const PA = window.ProfileAggregate;
      const q = searchFold(f && f.text);
      const result = (f && f.result) || 'any';
      const race = (f && f.race) || 'any';
      const me = f && f.identityName ? PA.normName(f.identityName) : '';

      return (games || []).filter((g) => {
        const players = Object.values(g.players || {});

        // The map is matched on the name the feed shows. Summaries carry
        // `mapRaw` and `map`, which are file names with version suffixes, so
        // searching the raw form would mean typing something that appears
        // nowhere on screen.
        if (q) {
          const map = window.SummaryExtract.cleanMapName(g.mapRaw || g.map) || '';
          if (!players.some(p => searchFold(p.name).includes(q)) &&
              !searchFold(map).includes(q)) return false;
        }

        if (race !== 'any') {
          // The user's own race when the seat is known, and any seat before
          // that, so the filter still does something without an identity.
          const mine = me ? players.find(p => PA.normName(p.name) === me) : null;
          if (mine ? mine.race !== race : !players.some(p => p.race === race)) return false;
        }

        if (result !== 'any') {
          const v = me ? PA.gameView(g, me) : null;
          const r = v && v.result ? v.result : 'none';
          if (r !== result) return false;
        }

        return true;
      });
    };

    return {
      SCHEMA_VERSION,
      gunzipJson,
      buildSummary,
      persistSummary,
      read,
      loadCorpus,
      filterCorpus,
      has: (key) => stored.has(key),
      get size () { return stored.size; },
      get corpus () { return corpus; },
      // Boot: the on-disk key list, so an already-parsed game is recognised
      // before the much slower corpus load finishes.
      async init () {
        const keys = await invoke('list_parses');
        for (const k of keys) stored.add(k);
        return stored.size;
      },
      // A summary written under an older schema, missing moments before v2 or
      // the combat ledger before v3. The UI offers a re-parse rather than
      // pretending the game had neither.
      isStale: (summary) => !summary || (summary.schemaVersion || 1) < SCHEMA_VERSION
    };
  };
})();
