// Regenerate client/maps/{name}/unit.json.gz cache files for every map that
// has war3mapUnits.doo in mapdata/{name}/. The browser parser bundle reads
// these caches (along with wpm.json.gz and doo.json.gz) when fetching map
// data over the network, so every map a user might upload a replay for
// needs the unit cache populated.
//
// Usage: node tools/regen-unit-cache.js [--force]

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const UNITFile = require('../lib/parsers/UNITFile');

const MAPDATA = path.resolve(__dirname, '..', 'mapdata');
const MAPS = path.resolve(__dirname, '..', 'client', 'maps');
const force = process.argv.includes('--force');

// Stub the global console.logger that the parser code expects (would normally
// be installed by the CLI flow's logManager.Logger).
if (typeof console.logger !== 'function') console.logger = () => {};

const main = () => {
  const dirs = fs.readdirSync(MAPDATA);
  let written = 0;
  let skipped = 0;
  let missing = 0;
  let errored = 0;

  for (const name of dirs) {
    const src = path.join(MAPDATA, name, 'war3mapUnits.doo');
    const destDir = path.join(MAPS, name);
    const destGz = path.join(destDir, 'unit.json.gz');
    const destPlain = path.join(destDir, 'unit.json');

    if (!fs.existsSync(src)) {
      missing += 1;
      continue;
    }
    if (fs.existsSync(destGz) && !force) {
      skipped += 1;
      continue;
    }
    if (!fs.existsSync(destDir)) {
      // No maps/{name} dir means this map isn't deployed at all — skip.
      missing += 1;
      continue;
    }

    try {
      const unitFile = new UNITFile(src);
      const json = JSON.stringify({ units: unitFile.units || [] });
      const gz = zlib.gzipSync(json);
      fs.writeFileSync(destGz, gz);
      // Clean up any stale plain .json that the CLI might have left around.
      if (fs.existsSync(destPlain)) {
        try { fs.unlinkSync(destPlain); } catch {}
      }
      written += 1;
      process.stdout.write(`  ${name} (${(json.length / 1024).toFixed(1)} KB → ${(gz.length / 1024).toFixed(1)} KB gz)\n`);
    } catch (e) {
      errored += 1;
      console.error(`  ${name} FAILED: ${e.message}`);
    }
  }

  console.log(`\nDone. written=${written} skipped=${skipped} missing=${missing} errored=${errored}`);
};

main();
