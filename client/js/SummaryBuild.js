/**
 * SummaryBuild.js — a full parse in, one stored summary out.
 *
 * This shape existed twice: once in desktop/src-frontend/js/store.js for the
 * app, and once in tools/desktop-preview.js for the harness, with a comment in
 * the tool admitting the duplication. Two copies of a schema is two schemas,
 * and the version number sitting in only one of them meant the preview could
 * quietly build v4 summaries after the app had moved on.
 *
 * SCHEMA_VERSION lives here now. Bump it here and both follow.
 *
 * Dual-runtime (Node require / browser <script>), no DOM and no fs. The three
 * extractors it needs are resolved the same way, so neither runtime needs a
 * shim for the other.
 *
 * ── The rule this file exists to enforce ────────────────────────────────────
 *
 * `moments`, per-player `combat`, `dominance`, `resources` and `build` all come
 * out of a FULL parse and cannot be recovered from a stored summary afterwards.
 * They are extract-at-parse-time-or-never. Anything added with that property has
 * to be added here AND bump SCHEMA_VERSION, or the history backfill will write
 * thousands of games missing a block that only a re-parse can restore.
 */

(function () {
  'use strict';

  // Bump when a stored summary gains a field the UI cannot derive from an older
  // one. v2 added `moments`, which needs the full parse because battles are not
  // part of SummaryExtract, so a v1 game offers a re-parse instead of showing a
  // silently empty list. v3 added per-player `combat`: the complete hero kill
  // and death ledger, wipes, biggest swing. Same source, same reason. v4 added
  // `dominance` and `resources`, the two time series lib/DominanceSeries.js and
  // lib/ResourceSeries.js produce inside buildOutputObject, which is what lets
  // the desktop draw the viewer's own dominance chart and resource charts.
  // v5 added the `build` block: what BuildOrderData derives from a player's
  // event stream (production, per-tier production, the closing snapshot).
  //
  // It is stored rather than re-derived because the desktop's game report is
  // the viewer's Match Summary screen, and both now read the SAME numbers from
  // the SAME class. The alternative was a second extractor in SummaryExtract
  // reimplementing the grouping and the cost accumulation, which is two
  // implementations of "what did this player build" and two answers the first
  // time one of them is edited.
  //
  // v6 is the first bump that adds no field. Map resolution used to scan the
  // map library in declaration order and take the first name that appeared in
  // the replay's filename, so every map whose name is a prefix of another one
  // resolved to the shorter entry: Echo Isles S2 parsed as classic Echo Isles,
  // AutumnLeaves v2.0 as v2-0, Tidehunters v1.2 as Tidehunters. Those games
  // parsed and rendered normally against another map's terrain, creep camps
  // and starting positions — on Echo Isles S2 the bases were 1536 units out.
  //
  // A stored summary carries the consequences and no marker, and every field
  // in it is already at its newest shape, so staleness is the only mechanism
  // that can reach the games already on disk. helpers/mapResolver.js is the
  // fix; this bump is what makes an installed app re-read them.
  // v7 adds `mapInfo`: the map's world extent and its folder name, which is
  // everything needed to plot a world coordinate onto the map image. Without it
  // a stored summary carries where every creep camp is and where both players
  // started, and no way to draw any of it — see client/js/CreepRouteMap.js.
  //
  // ~160 bytes gzipped per game. The bump exists so games already on disk get
  // re-read; nothing else about them changes.
  const SCHEMA_VERSION = 7;

  // Resolved per call rather than once at load: in the browser these are plain
  // scripts, and a wrong tag order would otherwise bake nulls in here at parse
  // time and fail silently.
  const mod = (name) =>
    (typeof window !== 'undefined' && window[name]) ||
    (typeof require === 'function' ? require('./' + name + '.js') : null);

  // What BuildOrderData derives, minus everything a stored summary must not
  // carry. Kept small on purpose: this is paid for once per game, thousands of
  // times over.
  //
  //   tiers      every grouped event in the game.
  //   snapshots  the whole game state restated at each tier boundary.
  // Together they dwarf the rest of the summary, and they exist for the
  // viewer's live build-order panel, which has the full parse in hand and never
  // reads a summary.
  //
  //   production  {buildings, units} deduped across the whole game. Redundant:
  //               `finalSnapshot.army` is the same units with the same counts
  //               and the same combat types, and the per-tier buildings are in
  //               `tierProduction`. Nothing renders it.
  //
  //   playerColor an in-game colour. The desktop draws this data on warm
  //               surfaces where the token layer refuses saturated colour, so
  //               storing it would only invite the two apps to disagree.
  function extractBuild (BuildOrderData, playerData) {
    if (!BuildOrderData) return null;
    let bo;
    try {
      bo = new BuildOrderData().processBuildOrderData(playerData);
    } catch (e) {
      // A truncated or malformed stream (no tierStream, above all) must cost
      // this block and not the entire summary.
      return null;
    }
    return {
      tierProduction: bo.tierProduction,
      finalSnapshot: bo.finalSnapshot,
      hasExpansion: bo.hasExpansion
    };
  }

  const dig = (obj, path) => {
    let cur = obj;
    for (const key of path) {
      if (cur === null || cur === undefined) return null;
      cur = cur[key];
    }
    return cur === undefined ? null : cur;
  };

  // The mode, when the parser did not say. Older bundles emit no
  // out.gameMode, and storing null there split the desktop against itself:
  // the report frame treats a non-'1v1' as a team game while the feed treats
  // a falsy mode as a duel, so the same 4v4 was both at once.
  //
  // STRICT — must match helpers/utils.js computeGameMode, Wc3vViewer
  // .getGameMode and the identical fallback in UploadManager.js. Teams are
  // counted over non-neutral human seats only, the same seats buildSummary
  // itself keeps.
  // The map's bounds, for anything that has to place a world coordinate.
  //
  // `mapDataByFile` is an 84KB table that lives in helpers/mappings.js, i.e. in
  // the parser bundle, i.e. in the WORKER — and buildSummary runs on the main
  // thread. Both runtimes already publish a slim copy of it on the window: the
  // site fetches /data/map-folders.json, the desktop vendors the same file. So
  // that global is the source, and a runtime without it stores null rather than
  // failing, which is the contract every other extractor here is under.
  function mapInfoFor (SE, rawMap) {
    if (!SE || !rawMap) return null;
    // globalThis rather than window, so the same lookup works in a browser and
    // in the Node tools that build summaries offline (tools/desktop-preview.js
    // sets it from client/data/map-folders.json, which is the same file the
    // site serves and the desktop vendors).
    const g = typeof globalThis !== 'undefined' ? globalThis : null;
    const table = (g && g.__mapFoldersManifest) || null;
    if (!table) return null;
    try {
      return SE.slimMapInfo(SE.resolveMapFolder(rawMap, table)) || null;
    } catch (e) {
      return null;
    }
  }

  function deriveGameMode (out) {
    const byTeam = {};
    let n = 0;
    for (const slot of Object.keys(out.players || {})) {
      const pd = out.players[slot];
      const rpd = dig(out, ['replay', 'players', slot]);
      if (!pd || !rpd || pd.isNeutralPlayer) continue;
      if (rpd.teamId >= 1000) continue;
      byTeam[rpd.teamId] = (byTeam[rpd.teamId] || 0) + 1;
      n++;
    }
    const counts = Object.values(byTeam);
    const tc = counts.length;
    if (n < 2) return 'custom';
    if (n === 2 && tc === 2) return '1v1';
    if (tc === 2 && counts[0] === counts[1]) {
      return ({ 2: '2v2', 3: '3v3', 4: '4v4' })[counts[0]] || 'custom';
    }
    if (n >= 3 && tc === n) return 'ffa';
    return 'custom';
  }

  /**
   * @param out      the parser's output object (a full parse)
   * @param key      the content key this game is stored under
   * @param playedAt when the game was played, from the replay file mtime
   */
  function buildSummary (out, key, playedAt) {
    const SE = mod('SummaryExtract');
    const ME = mod('MomentsExtract');
    const SS = mod('SeriesExtract');
    // The viewer's own build-order derivation. Optional: a runtime that has not
    // loaded it stores summaries without the block rather than failing, the
    // same contract every other extractor here is under.
    const BO = mod('BuildOrderData');

    const rawMap = dig(out, ['replay', 'metadata', 'map', 'mapName']) || '';
    const durationMs = dig(out, ['replay', 'subheader', 'replayLengthMS']) || 0;
    const worldNeutralGroups = dig(out, ['world', 'neutralGroups']);

    const summary = {
      key,
      schemaVersion: SCHEMA_VERSION,
      savedAt: Date.now(),
      // When the game was PLAYED, which is what the profile layer buckets by.
      // savedAt is when the backfill happened to get to it, and the two are
      // years apart on an imported history.
      playedAt: playedAt || null,
      patchVersion: dig(out, ['replay', 'subheader', 'version']),
      map: rawMap.split(/[\\/]/).pop(),
      mapRaw: rawMap,
      // Name, world bounds and grid size for the resolved map, or null when the
      // map is not in the library or the bounds table was not loaded. Read from
      // the same window global the site's compare drawer uses, so both runtimes
      // resolve a map exactly once and the same way.
      mapInfo: mapInfoFor(SE, rawMap),
      gameMode: out.gameMode || deriveGameMode(out),
      winner: out.winner || null,
      durationMs,
      neutralCamps: SE.extractNeutralCamps(worldNeutralGroups),
      // The fights. Neither of these can be recovered from a stored summary
      // later, because world.battles exists only in a full parse. Moments is the
      // capped highlight reel; combat is the complete per-seat ledger.
      moments: ME.extractMoments(out),
      // The two time series the viewer's own charts are drawn from. Null when
      // the dominance gate refused the replay, which is a real answer about the
      // game rather than a missing field.
      dominance: SS.extractDominance(out),
      resources: SS.extractResources(out),
      players: {}
    };

    const combat = ME.extractCombat(out);
    for (const slot of Object.keys(out.players || {})) {
      const pd = out.players[slot];
      const rpd = dig(out, ['replay', 'players', slot]);
      if (!pd || !rpd || pd.isNeutralPlayer) continue;
      if (rpd.teamId >= 1000) continue;   // AI and neutral teams
      summary.players[slot] = SE.extractPlayerSummary(pd, rpd, durationMs, worldNeutralGroups);
      // teamId is not part of the shared summary shape, because the site's
      // compare modal never groups by team. The desktop views do, so carry it.
      summary.players[slot].teamId = rpd.teamId;
      summary.players[slot].combat = combat[slot] || null;
      // Extract-at-parse-time-or-never, like the four blocks above it.
      summary.players[slot].build = extractBuild(BO, pd);
    }
    return summary;
  }

  // A summary written under an older schema is missing something only a full
  // parse can supply. One definition, so the app and every tool agree on what
  // counts as out of date.
  const isStale = (summary) => (summary && summary.schemaVersion || 1) < SCHEMA_VERSION;

  const api = { SCHEMA_VERSION, buildSummary, isStale };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SummaryBuild = api;
})();
