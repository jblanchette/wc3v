/*
  Compute playable-area margins from WPM walkability data.
  Scans each map's wpm.json to find where walkable tiles start/end,
  then writes margins [left, right, bottom, top] (in W3E tiles) to mapConfiguration.json.

  The WPM parser stores data with Y inverted: grid[0] = bottom of map (despite
  its y-label saying top). So "first walkable row" from grid[0] = bottom margin.

  Usage:
    node tools/compute-margins.js              # all maps
    node tools/compute-margins.js --map=NAME   # single map
    node tools/compute-margins.js --dry-run    # show margins without writing
*/

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CONFIG_PATH = 'helpers/mapConfiguration.json';
const MAPS_DIR = 'client/maps';

function loadJson (filePath) {
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
  const gzPath = filePath + '.gz';
  if (fs.existsSync(gzPath)) {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(gzPath)).toString());
  }
  return null;
}

function computeMargins (mapName) {
  const wpmPath = path.join(MAPS_DIR, mapName, 'wpm.json');
  const wpm = loadJson(wpmPath);
  if (!wpm) return null;
  const grid = wpm.grid;
  if (!grid || !grid.length || !grid[0].length) return null;

  const rows = grid.length;
  const cols = grid[0].length;

  function isWalkable (tile) {
    return !(tile.NoWalk && tile.NoFly);
  }

  // Scan multiple columns/rows for robustness (boundary might have isolated walkable tiles)
  // Use majority vote across sample lines

  // Find first/last walkable ROW (scanning middle columns)
  const sampleCols = [];
  for (let c = Math.floor(cols * 0.2); c < cols * 0.8; c += Math.max(1, Math.floor(cols / 20))) {
    sampleCols.push(c);
  }

  let firstWalkableRows = [];
  let lastWalkableRows = [];
  for (const c of sampleCols) {
    for (let r = 0; r < rows; r++) {
      if (isWalkable(grid[r][c])) { firstWalkableRows.push(r); break; }
    }
    for (let r = rows - 1; r >= 0; r--) {
      if (isWalkable(grid[r][c])) { lastWalkableRows.push(r); break; }
    }
  }

  // Find first/last walkable COL (scanning middle rows)
  const sampleRows = [];
  for (let r = Math.floor(rows * 0.2); r < rows * 0.8; r += Math.max(1, Math.floor(rows / 20))) {
    sampleRows.push(r);
  }

  let firstWalkableCols = [];
  let lastWalkableCols = [];
  for (const r of sampleRows) {
    for (let c = 0; c < cols; c++) {
      if (isWalkable(grid[r][c])) { firstWalkableCols.push(c); break; }
    }
    for (let c = cols - 1; c >= 0; c--) {
      if (isWalkable(grid[r][c])) { lastWalkableCols.push(c); break; }
    }
  }

  if (!firstWalkableRows.length || !firstWalkableCols.length) return null;

  // Use the minimum first-walkable (most generous boundary — accounts for maps with
  // walkable features at different depths on different columns)
  const firstRow = Math.min(...firstWalkableRows);
  const lastRow = Math.max(...lastWalkableRows);
  const firstCol = Math.min(...firstWalkableCols);
  const lastCol = Math.max(...lastWalkableCols);

  // Convert WPM tiles to W3E tiles (divide by 4)
  // WPM Y is inverted: grid[0] = bottom of map, so firstRow = bottom margin
  const left = Math.round(firstCol / 4);
  const right = Math.round((cols - lastCol - 1) / 4);
  const bottom = Math.round(firstRow / 4);    // grid[0] = bottom
  const top = Math.round((rows - lastRow - 1) / 4);  // grid[end] = top

  return [left, right, bottom, top];
}

function main () {
  const args = process.argv.slice(2);
  let targetMap = null;
  let dryRun = false;

  args.forEach(arg => {
    if (arg.startsWith('--map=')) targetMap = arg.split('=')[1];
    if (arg === '--dry-run') dryRun = true;
  });

  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  const maps = cfg.maps;

  // Build lookup from map name to config key
  const nameToKey = {};
  Object.keys(maps).forEach(key => {
    const name = maps[key].info && maps[key].info.name;
    if (name) nameToKey[name] = key;
  });

  const mapDirs = targetMap
    ? [targetMap]
    : fs.readdirSync(MAPS_DIR).filter(f => {
        try { return fs.statSync(path.join(MAPS_DIR, f)).isDirectory(); }
        catch (e) { return false; }
      });

  let updated = 0;
  let skipped = 0;

  mapDirs.forEach(mapName => {
    const margins = computeMargins(mapName);
    if (!margins) {
      skipped++;
      return;
    }

    const configKey = nameToKey[mapName];
    if (!configKey) {
      console.log(`  SKIP ${mapName} — not in mapConfiguration.json`);
      skipped++;
      return;
    }

    const gs = maps[configKey].info.gridSize;
    const expectedX = gs.full[0] - gs.playable[0];
    const expectedY = gs.full[1] - gs.playable[1];
    const actualX = margins[0] + margins[1];
    const actualY = margins[2] + margins[3];

    const xOk = actualX === expectedX;
    const yOk = actualY === expectedY;
    const status = (xOk && yOk) ? 'OK' : 'MISMATCH';

    console.log(`  ${mapName}: [${margins}] (${status})` +
      (!xOk ? ` X: ${actualX} vs ${expectedX}` : '') +
      (!yOk ? ` Y: ${actualY} vs ${expectedY}` : ''));

    if (!dryRun) {
      maps[configKey].info.gridSize.margins = margins;
      updated++;
    }
  });

  if (!dryRun && updated > 0) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
    console.log(`\nUpdated ${updated} maps in ${CONFIG_PATH}`);
  } else if (dryRun) {
    console.log(`\n[DRY RUN] Would update ${mapDirs.length - skipped} maps`);
  }

  console.log(`Processed: ${mapDirs.length - skipped}, Skipped: ${skipped}`);
}

main();
