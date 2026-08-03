// Entry point for the browser parser bundle. Exposed as window.Wc3vParser.
//
// Two-phase orchestration is needed because the parser hot path
// (PlayerManager.setGridData) is synchronous, but loading map data in the
// browser requires async fetch:
//
//   1. Peek-parse the buffer to extract the map name. We abort early via
//      throw inside the basic_replay_information handler — this prevents
//      the gameDataParser from running, so peek cost is just block
//      decompression + metadata parse (~50ms typical).
//
//   2. Async-fetch the map data cache (wpm.json.gz, doo.json.gz,
//      unit.json.gz) using the browser map loader.
//
//   3. Real parse with mapDataCache provided. setGridData reads from the
//      cache instead of fs. Net cost: 1.05x a normal parse.

// Loading shims.js first installs Buffer + process + console.logger on
// globalThis. Free identifiers throughout the bundled closure resolve via
// the scope chain, so this is enough.
require('./shims');

const ReplayParser = require('../../../node_modules/w3gjs/dist/lib/parsers/ReplayParser').default;
const wc3v = require('../../../wc3v');
const utils = require('../../../helpers/utils');
const { mapDataByFile } = require('../../../helpers/mappings');
const { buildBrowserMapLoader } = require('./browserMapLoader');

// Sentinel exception used to abort the peek-parse once metadata is captured.
// Anything else thrown during peek is a real error and propagates.
const PEEK_DONE = Symbol('PEEK_DONE');

// Map-name resolution mirrors PlayerManager.setGridData: lowercase, strip
// spaces, strip the W3C numbered prefix, then look up via mapDataByFile.
// Returns the canonical mapData.name (used as the cache directory name) or
// null if no match.
const resolveMapDataName = (rawMapName) => {
  if (!rawMapName) return null;
  let mapName = rawMapName.split('\\').join('/');
  mapName = require('path').basename(mapName).toLowerCase();
  mapName = mapName.trim().replace(/ /g, '');

  const w3cPrefixMatch = mapName.match(/^\d+_w3c_\d+_\d+_(.+)$/);
  const strippedMapName = w3cPrefixMatch ? w3cPrefixMatch[1] : mapName;

  if (mapDataByFile[mapName]) return mapDataByFile[mapName].name;

  for (const key of Object.keys(mapDataByFile)) {
    const searchName = mapDataByFile[key].name.toLowerCase();
    if (mapName.indexOf(searchName) !== -1) return mapDataByFile[key].name;
    if (strippedMapName !== mapName && strippedMapName.indexOf(searchName) !== -1) {
      return mapDataByFile[key].name;
    }
    const baseSearchName = searchName.replace(/[_-]v[\d._-]+$/, '');
    const baseMapName = strippedMapName.replace('.w3x', '').replace(/[_-]v[\d._-]+$/, '');
    if (baseSearchName.length > 3 && baseMapName === baseSearchName) {
      return mapDataByFile[key].name;
    }
  }
  return null;
};

const peekMetadata = async (buffer) => {
  const peeker = new ReplayParser();
  let info = null;
  peeker.on('basic_replay_information', (i) => {
    info = i;
    throw PEEK_DONE;
  });
  try {
    await peeker.parse(buffer);
  } catch (e) {
    if (e !== PEEK_DONE) throw e;
  }
  return info;
};

// Phase budget shown to the UI. Each phase spans a percent range; the
// parser's own ticks fall inside 'parsing' (mapped 10..85% by doParsing).
//
//   peek      0..3   — w3gjs decompresses + reads metadata
//   fetch     3..8   — fetch map cache files (3 in parallel, ~0.2-1s)
//   parsing   10..85 — gamedatablock loop in wc3v.doParsing
//   postprocess 86..96 — backfill/dedup/validation passes
//   assemble  96..99 — buildOutputObject
//   done     100
const Wc3vParser = {
  version: '0.2.0',

  // Player names only, without parsing the game. Aborts as soon as the
  // header is read (~50 ms), so hundreds of replays can be sampled in the
  // time one full parse takes.
  //
  // Reforged carries the display name (with the #1234 tag) in
  // reforgedPlayerMetadata and the legacy name in playerRecords; prefer the
  // former and fall back, so both old and new replays yield something.
  async peekPlayers (input) {
    const info = await peekMetadata(Buffer.from(input));
    if (!info || !info.metadata) return { players: [], mapName: null };

    const byId = new Map();
    for (const p of (info.metadata.playerRecords || [])) {
      if (p && p.playerName) byId.set(p.playerId, p.playerName);
    }
    for (const p of (info.metadata.reforgedPlayerMetadata || [])) {
      if (p && p.name) byId.set(p.playerId, p.name);
    }

    // Observers and empty slots are not players; slotStatus 2 is "occupied
    // by a human", matching the rule buildOutputObject uses.
    const humanIds = new Set(
      (info.metadata.slotRecords || [])
        .filter(s => s && s.slotStatus === 2 && s.computerFlag === 0 && s.teamId !== 24)
        .map(s => s.playerId)
    );

    const players = [...byId.entries()]
      .filter(([id]) => humanIds.size === 0 || humanIds.has(id))
      .map(([playerId, name]) => ({ playerId, name }));

    return {
      players,
      mapName: (info.metadata.map && info.metadata.map.mapName) || null
    };
  },

  // Parse a .w3g replay buffer in the browser. Returns the inner shape
  // { replay, players, world, validation } that buildOutputObject expects.
  //
  // options.onProgress({ phase, percent, gameTimeMs?, durationMs?, detail? })
  // is called repeatedly during the parse — wire to a UI progress bar.
  async parse (input, options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const emit = (phase, percent, extra = {}) => {
      if (!onProgress) return;
      try { onProgress({ phase, percent: Math.max(0, Math.min(100, percent)), ...extra }); } catch (e) {}
    };

    const buffer = Buffer.from(input);

    emit('peek', 1, { detail: 'reading replay header' });
    const peek = await peekMetadata(buffer);
    if (!peek || !peek.metadata || !peek.metadata.map) {
      throw new Error('Replay header missing map data');
    }
    const rawMapName = peek.metadata.map.mapName;
    const mapDataName = resolveMapDataName(rawMapName);
    if (!mapDataName) {
      const err = new Error(`Map not in library: ${rawMapName}`);
      err.code = 'missing_map';
      err.rawMapName = rawMapName;
      throw err;
    }

    emit('fetch', 4, { detail: `loading map data: ${mapDataName}` });
    const loader = options.mapDataLoader || buildBrowserMapLoader();
    const cache = await loader.fetchCache(mapDataName);
    if (!cache) {
      const err = new Error(`Map cache not found for: ${mapDataName}`);
      err.code = 'missing_map_cache';
      err.mapDataName = mapDataName;
      throw err;
    }

    emit('parsing', 10, { detail: 'parsing replay events' });
    const result = await wc3v.doParsing(buffer, {
      mapDataCache: { [mapDataName]: cache },
      skipTerrainRead: true,
      // FAST PROFILE MODE passthrough (see wc3v.js doParsing). Bulk stat
      // extraction only — unit routes become straight lines, so output that
      // will ever be rendered must not set this.
      skipPathfinding: !!options.skipPathfinding,
      // doParsing emits its own 'metadata'/'parsing'/'postprocess'/'done'
      // events. Forward them; they overwrite the percent we set above.
      onProgress: (evt) => {
        if (!onProgress) return;
        try { onProgress(evt); } catch (e) {}
      }
    });
    return result;
  },

  // Convenience: parse + assemble the final wc3v JSON object (matches what
  // /replays/*.wc3v.gz contains).
  async parseToWc3v (input, options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const emit = (phase, percent, extra = {}) => {
      if (!onProgress) return;
      try { onProgress({ phase, percent, ...extra }); } catch (e) {}
    };
    const r = await Wc3vParser.parse(input, options);
    emit('assemble', 98, { detail: 'building output' });
    const output = utils.buildOutputObject(r.replay, r.players, r.world, r.validation);
    emit('done', 100);
    return output;
  }
};

module.exports = Wc3vParser;
