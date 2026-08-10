// Parse store: the app's memory of every game it has ever parsed.
//
// Retention decision. The full .wc3v parse is not persisted,
// because thousands of them is gigabytes. What survives is one gzipped summary
// per unique game, a few KB, keyed by content, under
// <app_data>/replays/<size>-<xxh3>.summary.json.gz. The raw .w3g on disk stays
// the source of truth and a full parse is redone on demand.
//
// The corpus (every stored summary, loaded once per session) is what the
// profile layer, the head-to-head card and the overlay all aggregate over.

(function () {
  'use strict';

  // The summary shape and its version number live in client/js/SummaryBuild.js,
  // shared with tools/desktop-preview.js and tools/build-race-baselines.js.
  // This file used to own both, and the preview harness carried a hand-copied
  // duplicate that was free to disagree about what a v4 summary contains.
  const SB = () => window.SummaryBuild;

  window.createStore = (deps) => {
    // deps: invoke, log
    const invoke = deps.invoke;

    // Keys of games whose summary is already on disk.
    const stored = new Set();
    // Of those, the ones written under an older schema. Populated when the
    // corpus loads (the version is only knowable by reading the summary) and
    // cleared per key as each is re-read. See isCurrent().
    const staleKeys = new Set();
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

    const persistSummary = async (out, key, playedAt) => {
      const summary = SB().buildSummary(out, key, playedAt);
      const bytes = await gzipText(JSON.stringify(summary));
      await invoke('save_parse', { key, bytes: Array.from(bytes) });
      stored.add(key);
      staleKeys.delete(key);   // just rewritten under the current schema
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

    // A summary stored before SummaryBuild learned to derive the mode carries
    // gameMode: null, and the views disagree about null — the report frame
    // reads "not 1v1" as a team game while the feed reads falsy as a duel.
    // The mode is fully derivable from the stored teamIds (same STRICT table
    // as SummaryBuild.deriveGameMode), so this is a read-time repair, not a
    // schema matter: bumping the schema over a microsecond-computable field
    // would mark every summary on disk stale and trigger a full re-read wave.
    const repairGameMode = (summary) => {
      if (!summary || summary.gameMode || !summary.players) return summary;
      const byTeam = {};
      let n = 0;
      for (const p of Object.values(summary.players)) {
        const t = (p && p.teamId !== undefined && p.teamId !== null) ? p.teamId : 0;
        byTeam[t] = (byTeam[t] || 0) + 1;
        n++;
      }
      const counts = Object.values(byTeam);
      const tc = counts.length;
      let mode = 'custom';
      if (n < 2) mode = 'custom';
      else if (n === 2 && tc === 2) mode = '1v1';
      else if (tc === 2 && counts[0] === counts[1]) {
        mode = ({ 2: '2v2', 3: '3v3', 4: '4v4' })[counts[0]] || 'custom';
      } else if (n >= 3 && tc === n) mode = 'ffa';
      summary.gameMode = mode;
      return summary;
    };

    const read = async (key) =>
      repairGameMode(await gunzipJson(new Uint8Array(await invoke('read_parse', { key }))));

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
        for (const g of out) if (g && g.key && SB().isStale(g)) staleKeys.add(g.key);
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
      get SCHEMA_VERSION () { return SB().SCHEMA_VERSION; },
      gunzipJson,
      buildSummary: (out, key, playedAt) => SB().buildSummary(out, key, playedAt),
      persistSummary,
      read,
      loadCorpus,
      filterCorpus,
      has: (key) => stored.has(key),
      // "Already done", which is NOT the same question as has().
      //
      // After a SCHEMA_VERSION bump every stored summary is the wrong shape,
      // and a backfill that skips on presence alone leaves the corpus on the
      // old schema forever. The per-game "Re-read" offer is a repair for one
      // game, not a migration path for three thousand of them, so the backfill
      // skips on this instead.
      //
      // Before the corpus has loaded, staleKeys is empty and this is exactly
      // has() — the version cannot be known without reading the summary, and
      // the backfill must not block on that.
      isCurrent: (key) => stored.has(key) && !staleKeys.has(key),
      // How many stored games are behind the schema. Zero until the corpus
      // loads. Surfaced so Settings can say what a backfill would actually do.
      get staleCount () { return staleKeys.size; },
      get size () { return stored.size; },
      get corpus () { return corpus; },
      // Boot: the on-disk key list, so an already-parsed game is recognised
      // before the much slower corpus load finishes.
      async init () {
        const keys = await invoke('list_parses');
        for (const k of keys) stored.add(k);
        return stored.size;
      },
      // A summary written under an older schema, missing moments before v2, the
      // combat ledger before v3 or the two series before v4. The UI offers a
      // re-parse rather than pretending the game had none of them.
      isStale: (summary) => !summary || SB().isStale(summary)
    };
  };
})();
