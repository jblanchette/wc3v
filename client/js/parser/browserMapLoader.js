// Fetches the static map data cache files (already deployed alongside the
// client) and returns them in the shape PlayerManager.setGridData expects.
//
// The static client serves /maps/{name}/{wpm,doo,unit}.json.gz — these
// files exist on disk at client/maps/... and are exposed at /maps/... by
// the Vercel rewrite (and by `npx http-server client`).
//
// We do NOT rely on Content-Encoding: gzip from the host (Vercel doesn't
// set that header on /maps/ and local dev servers don't either). Instead
// we fetch as ArrayBuffer and inflate with pako, which is already in the
// bundle for w3g decompression.

const pako = require('pako');

const SAFE_MAP_NAME = /^[A-Za-z0-9_\-. ]+$/;

const fetchGzJson = async (url) => {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) return null;
  const ab = await res.arrayBuffer();
  if (!ab || ab.byteLength === 0) return null;
  // pako.ungzip handles the gzip wrapper. If the host already decompressed
  // (Content-Encoding: gzip auto-strip), the bytes look like raw JSON and
  // pako will throw — fall back to JSON.parse on the raw bytes in that case.
  try {
    const inflated = pako.ungzip(new Uint8Array(ab));
    return JSON.parse(new TextDecoder('utf-8').decode(inflated));
  } catch (e) {
    try {
      return JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(ab)));
    } catch (e2) {
      console.warn(`[browserMapLoader] failed to parse ${url}:`, e2.message);
      return null;
    }
  }
};

const fetchPlainJson = async (url) => {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
};

const buildBrowserMapLoader = ({ mapsRoot = '/maps' } = {}) => {
  return {
    // Returns null on miss so the caller can surface a clean "missing map"
    // error rather than relying on the parser's MissingMapError later.
    async fetchCache (mapDataName) {
      if (!SAFE_MAP_NAME.test(mapDataName)) {
        throw new Error(`Unsafe map name: ${mapDataName}`);
      }
      const base = `${mapsRoot}/${encodeURIComponent(mapDataName)}`;
      console.log(`[browserMapLoader] fetching ${base}/{wpm,doo,unit}.json.gz`);

      // Try gzipped JSON first (production), fall back to plain JSON (dev).
      const [wpm, doo, unit] = await Promise.all([
        fetchGzJson(`${base}/wpm.json.gz`).then(v => v || fetchPlainJson(`${base}/wpm.json`)),
        fetchGzJson(`${base}/doo.json.gz`).then(v => v || fetchPlainJson(`${base}/doo.json`)),
        fetchGzJson(`${base}/unit.json.gz`).then(v => v || fetchPlainJson(`${base}/unit.json`))
      ]);

      console.log(`[browserMapLoader] fetched: wpm=${!!wpm} doo=${!!doo} unit=${!!unit}`);
      if (!wpm || !doo) return null;
      return { wpm, doo, unit: unit || { units: [] } };
    }
  };
};

module.exports = { buildBrowserMapLoader, SAFE_MAP_NAME };
