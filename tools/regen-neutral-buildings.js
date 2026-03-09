const UNITFile = require('../lib/parsers/UNITFile');
const mappings = require('../helpers/mappings');
const fs = require('fs');
const zlib = require('zlib');

const dirs = fs.readdirSync('mapdata').filter(d => fs.existsSync('mapdata/' + d + '/war3mapUnits.doo'));
let updated = 0;

dirs.forEach(dir => {
  const uf = new UNITFile('mapdata/' + dir + '/war3mapUnits.doo');
  const neutralBuildings = [];

  uf.units.forEach(u => {
    const info = mappings.getUnitInfo(u.type);
    if (info.isGoldmine || info.isFountain || info.isInteractiveShop) {
      const entry = { type: u.type, x: u.position[0], y: u.position[1] };
      if (info.isGoldmine && u.gold > 0) entry.gold = u.gold;
      neutralBuildings.push(entry);
    }
  });

  if (neutralBuildings.length > 0) {
    const mapDir = 'client/maps/' + dir;
    if (!fs.existsSync(mapDir)) {
      console.log('skip', dir, '- no client dir');
      return;
    }
    const nbPath = mapDir + '/neutralBuildings.json';
    fs.writeFileSync(nbPath, JSON.stringify(neutralBuildings), 'utf-8');
    const compressed = zlib.gzipSync(fs.readFileSync(nbPath));
    fs.writeFileSync(nbPath + '.gz', compressed);
    updated++;
    console.log('  ' + dir + ': ' + neutralBuildings.length + ' buildings');
  }
});

console.log('Updated ' + updated + ' maps');
