const fs = require('fs');
const path = require('path');
const sjs = require('@wowserhq/stormjs');
const { FS, MPQ } = sjs;
const TERRAINFile = require('./lib/parsers/TERRAINFile');

async function main() {
  const mapDir = './tools/map-data/test-maps';
  const fileName = '32x32.grass-dirt-center.w3m';
  
  try {
    FS.mkdir('/tmpmap3');
    try { FS.unmount('/tmpmap3'); } catch(e) {}
    FS.mount(FS.filesystems.NODEFS, { root: mapDir }, '/tmpmap3');
    
    const mpq = await MPQ.open(`/tmpmap3/${fileName}`, 'r');
    const file = mpq.openFile('war3map.w3e');
    const w3eData = file.read();
    file.close();
    
    const w3ePath = `/tmp/grass-dirt-center-check.w3e`;
    fs.writeFileSync(w3ePath, Buffer.from(w3eData));
    
    const terrain = new TERRAINFile(w3ePath, {});
    
    console.log('Palette codes:', terrain.tilePalettes);
    
    // Analyze all palette indices and their codes
    const paletteUsage = {};
    for (let y = 0; y < terrain.tileGrid.length; y++) {
      for (let x = 0; x < terrain.tileGrid[y].length; x++) {
        const tile = terrain.tileGrid[y][x];
        const idx = tile.paletteIndex;
        if (!paletteUsage[idx]) paletteUsage[idx] = { code: tile.palette, count: 0 };
        paletteUsage[idx].count++;
      }
    }
    
    console.log('\nPalette usage:');
    Object.entries(paletteUsage).forEach(([idx, {code, count}]) => {
      console.log(`  Index ${idx}: ${code || 'null'} (${count} tiles)`);
    });
    
    // Look at sample tiles
    console.log('\nSample tiles from center region:');
    for (let y = 10; y <= 12; y++) {
      for (let x = 10; x <= 12; x++) {
        const tile = terrain.tileGrid[y][x];
        console.log(`  [${y},${x}]: paletteIndex=${tile.paletteIndex}, palette="${tile.palette}", variation=${tile.variation}`);
      }
    }
    
    mpq.close();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main().catch(console.error);
