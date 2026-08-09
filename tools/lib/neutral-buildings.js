/**
 * Build the client-side neutralBuildings.json entry for one raw war3mapUnits.doo
 * unit. Shared by tools/regen-maps.js and tools/regen-neutral-buildings.js so the
 * two exporters cannot drift.
 *
 * `rotation` and `scale` are parsed by lib/parsers/UNITFile.js and were present in
 * the map data all along, but neither exporter wrote them out — so every gold
 * mine, tavern, merc camp and fountain in the viewer rendered unrotated at scale
 * 1, while client/js/ThreeMapRenderer.js was already reading `nb.rotation` and
 * `nb.scale` and getting undefined.
 */

// Defaults that mean "the map author changed nothing". Omitting them keeps the
// per-map JSON small — these files are fetched by every viewer session.
const DEFAULT_SCALE = 1;

function neutralBuildingEntry (rawUnit, info) {
  const entry = { type: rawUnit.type, x: rawUnit.position[0], y: rawUnit.position[1] };
  if (info.isGoldmine && rawUnit.gold > 0) entry.gold = rawUnit.gold;

  // Radians, same convention the doodad path uses (`dummy.rotation.set(0, angle, 0)`).
  if (Number.isFinite(rawUnit.rotation) && rawUnit.rotation !== 0) {
    entry.rotation = +rawUnit.rotation.toFixed(4);
  }

  // war3map.doo stores XYZ scale; WC3 places units uniformly, so the X component
  // is the scale. Written only when it differs from 1.
  const s = rawUnit.scale && rawUnit.scale[0];
  if (Number.isFinite(s) && Math.abs(s - DEFAULT_SCALE) > 1e-4) {
    entry.scale = [+s.toFixed(4), +s.toFixed(4), +s.toFixed(4)];
  }

  return entry;
}

module.exports = { neutralBuildingEntry };
