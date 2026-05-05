const fs = require('fs');
const path = require('path');
const sjs = require('@wowserhq/stormjs');
const { FS, MPQ } = sjs;
const TERRAINFile = require('./lib/parsers/TERRAINFile');

async function extractMap(mapPath, mapName) {
  const mapDir = path.dirname(mapPath);
  const fileName = path.basename(mapPath);
  
  FS.mkdir(`/tmpmap_${mapName}`);
  try { FS.unmount(`/tmpmap_${mapName}`); } catch(e) {}
  FS.mount(FS.filesystems.NODEFS, { root: mapDir }, `/tmpmap_${mapName}`);
  
  const mpq = await MPQ.open(`/tmpmap_${mapName}/${fileName}`, 'r');
  const file = mpq.openFile('war3map.w3e');
  const w3eData = file.read();
  file.close();
  
  const w3ePath = `/tmp/${mapName}.w3e`;
  fs.writeFileSync(w3ePath, Buffer.from(w3eData));
  
  const terrain = new TERRAINFile(w3ePath, {});
  mpq.close();
  
  return terrain;
}

async function main() {
  console.log('Comparing variation patterns in both test maps...\n');
  
  const grass = await extractMap('./tools/map-data/test-maps/32x32.all-grass.w3m', 'grass');
  const dirtcenter = await extractMap('./tools/map-data/test-maps/32x32.grass-dirt-center.w3m', 'dirtcenter');
  
  const rows = grass.tileGrid.length;
  const cols = grass.tileGrid[0].length;
  
  let differences = 0;
  const diffLocations = [];
  
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const gTile = grass.tileGrid[y][x];
      const dTile = dirtcenter.tileGrid[y][x];
      
      if (gTile.paletteIndex !== dTile.paletteIndex || gTile.variation !== dTile.variation) {
        differences++;
        diffLocations.push({
          y, x,
          grassPal: gTile.paletteIndex, grassVar: gTile.variation,
          dirtPal: dTile.paletteIndex, dirtVar: dTile.variation
        });
      }
    }
  }
  
  console.log(`Total differences: ${differences}`);
  console.log('\nDifferences by type:');
  
  const palOnlyDiff = diffLocations.filter(d => d.grassPal !== d.dirtPal && d.grassVar === d.dirtVar);
  const varOnlyDiff = diffLocations.filter(d => d.grassPal === d.dirtPal && d.grassVar !== d.dirtVar);
  const bothDiff = diffLocations.filter(d => d.grassPal !== d.dirtPal && d.grassVar !== d.dirtVar);
  
  console.log(`  Palette only: ${palOnlyDiff.length}`);
  console.log(`  Variation only: ${varOnlyDiff.length}`);
  console.log(`  Both: ${bothDiff.length}`);
  
  console.log('\nFirst 20 differences (variation only):');
  varOnlyDiff.slice(0, 20).forEach(d => {
    console.log(`  [${d.y},${d.x}]: grass=var${d.grassVar}, dirtcenter=var${d.dirtVar} (palette=${d.grassPal})`);
  });
  
  console.log('\nAll variation-only differences:');
  varOnlyDiff.forEach(d => {
    console.log(`  [${d.y},${d.x}]: grass=var${d.grassVar}, dirtcenter=var${d.dirtVar}`);
  });
}

main().catch(console.error);
