/**
 * mapResolver.js — raw replay map name → mapConfiguration key.
 *
 * A replay names its map by whatever path the host had it under, e.g.
 *
 *   (2)EchoIsles.w3x
 *   Maps/Download/10c797aa.../(2)EchoIsles_S2_v2.2.w3x
 *   59_w3c_251104_0950_ShatteredExile_v2.4.w3x
 *   1v1_EchoIsles_v2.2_w3c_260125_1357_1051.w3x
 *
 * All of those have to land on the right key in helpers/mapConfiguration.json,
 * because that key selects the terrain, the doodads, the neutral camps and the
 * starting positions. Pick the wrong one and the whole parse is wrong in a way
 * that still looks plausible — units walk on the wrong pathing, camps sit in
 * open water, bases spawn at the wrong Y.
 *
 * Two rules matter here, both learned the hard way:
 *
 *   1. Config keys carry their download directory ("10c797aa.../(2)Echo...")
 *      and their original case, so the exact-match index has to be built on
 *      the NORMALIZED basename or it silently never fires for those entries.
 *
 *   2. When several map names are substrings of the replay's filename, the
 *      LONGEST one wins. Map names nest — "echoisles" is a prefix of
 *      "echoisles_v2.2", "echoisles_s2_v2.2" and "echoisless3" — so a
 *      first-match scan returns whichever happened to be declared first in
 *      the config, which is the most generic entry, not the right one.
 *
 * Self-contained: no fs, no path, no DOM. Node loads it via require, the
 * browser via a <script> tag, and it is bundled into the browser parser.
 */

(function () {
  'use strict';

  // Basename, lowercased, spaces stripped. Matches the normalization the
  // parser has always applied to replay map names; the index is built with
  // the same function so both sides of a comparison agree.
  function normalize (raw) {
    if (!raw) return '';
    return String(raw).split(/[\\/]/).pop().toLowerCase().trim().replace(/ /g, '');
  }

  // "59_w3c_251104_0950_shatteredexile_v2.4.w3x" → "shatteredexile_v2.4.w3x"
  const W3C_PREFIX = /^\d+_w3c_\d+_\d+_(.+)$/;
  // "(2)echoisles.w3x" → "echoisles.w3x"
  const SLOT_PREFIX = /^\(\d+\)/;
  const MAP_EXT = /\.(w3x|w3m)$/;
  // Trailing version stamp: "_v2.2", "-v2-07", "_v1.4"
  const VERSION_SUFFIX = /[_-]v[\d._-]+$/;

  function stripDecorations (name) {
    return name.replace(SLOT_PREFIX, '').replace(MAP_EXT, '');
  }

  // Every spelling of the replay's map name worth testing, most literal first.
  function candidatesFor (rawMapName) {
    const base = normalize(rawMapName);
    if (!base) return [];

    const out = [base];
    const push = (v) => { if (v && out.indexOf(v) === -1) out.push(v); };

    const w3c = base.match(W3C_PREFIX);
    if (w3c) push(w3c[1]);

    // Slot prefix and extension stripped, for both spellings above.
    out.slice().forEach(v => push(stripDecorations(v)));

    return out;
  }

  // The index is derived purely from the map table, so it is cached against
  // the table object itself. Callers resolve one name per replay on the
  // server but one per row when rendering a replay list, and rebuilding a
  // 200-entry index per row showed up as jank.
  const indexCache = typeof WeakMap === 'function' ? new WeakMap() : null;

  function buildIndex (mapDataByFile) {
    const byFileName = Object.create(null);   // normalized config key  → key
    const byMapName  = Object.create(null);   // canonical name (lower) → key
    const searchable = [];                    // { key, name, baseName }

    Object.keys(mapDataByFile).forEach(key => {
      const entry = mapDataByFile[key] || {};
      const name = String(entry.name || '').toLowerCase();

      // Config keys may be full download paths with mixed case. Index the
      // normalized basename, and the decorated-stripped form beside it.
      const fileName = normalize(key);
      if (fileName && !(fileName in byFileName)) byFileName[fileName] = key;
      const bareFile = stripDecorations(fileName);
      if (bareFile && !(bareFile in byFileName)) byFileName[bareFile] = key;

      if (!name) return;
      if (!(name in byMapName)) byMapName[name] = key;
      searchable.push({ key, name, baseName: name.replace(VERSION_SUFFIX, '') });
    });

    // Longest name first: the most specific map that matches wins.
    searchable.sort((a, b) => b.name.length - a.name.length);

    return { byFileName, byMapName, searchable };
  }

  function getIndex (mapDataByFile) {
    if (!indexCache) return buildIndex(mapDataByFile);
    let idx = indexCache.get(mapDataByFile);
    if (!idx) {
      idx = buildIndex(mapDataByFile);
      indexCache.set(mapDataByFile, idx);
    }
    return idx;
  }

  /**
   * Resolve a raw replay map name to its mapConfiguration key.
   * Returns null when the map is not in the library.
   *
   * Passes run strongest-evidence-first, and every pass is decided before the
   * next one is tried:
   *
   *   1. exact filename  — the replay names the very file the config lists
   *   2. exact map name  — filename minus slot prefix and extension
   *   3. name substring  — longest map name contained in the filename
   *   4. versionless     — same map, different version stamp
   */
  function resolveMapKey (rawMapName, mapDataByFile) {
    if (!rawMapName || !mapDataByFile) return null;
    const candidates = candidatesFor(rawMapName);
    if (!candidates.length) return null;

    const { byFileName, byMapName, searchable } = getIndex(mapDataByFile);

    for (let i = 0; i < candidates.length; i++) {
      const key = byFileName[candidates[i]];
      if (key) return key;
    }

    for (let i = 0; i < candidates.length; i++) {
      const key = byMapName[candidates[i]];
      if (key) return key;
    }

    // searchable is sorted longest-name-first, so the first hit is the most
    // specific map whose name appears in the filename.
    for (let i = 0; i < searchable.length; i++) {
      const entry = searchable[i];
      for (let c = 0; c < candidates.length; c++) {
        if (candidates[c].indexOf(entry.name) !== -1) return entry.key;
      }
    }

    // Version drift: the library has ShatteredExile_v2-07, the replay is on
    // v2.4. Same map, newer stamp. Guarded by a length floor so short names
    // cannot swallow unrelated maps.
    for (let i = 0; i < searchable.length; i++) {
      const entry = searchable[i];
      if (entry.baseName.length <= 3) continue;
      for (let c = 0; c < candidates.length; c++) {
        const bare = stripDecorations(candidates[c]).replace(VERSION_SUFFIX, '');
        if (bare === entry.baseName) return entry.key;
      }
    }

    return null;
  }

  function resolveMapEntry (rawMapName, mapDataByFile) {
    const key = resolveMapKey(rawMapName, mapDataByFile);
    return key ? mapDataByFile[key] : null;
  }

  // The canonical name doubles as the map's cache directory
  // (client/maps/<name>/, cdn.wc3v.com/maps/<name>/).
  function resolveMapDataName (rawMapName, mapDataByFile) {
    const entry = resolveMapEntry(rawMapName, mapDataByFile);
    return entry && entry.name ? entry.name : null;
  }

  const api = {
    resolveMapKey,
    resolveMapEntry,
    resolveMapDataName,
    normalizeMapName: normalize,
    candidatesFor
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.MapResolver = api;
  }
})();
