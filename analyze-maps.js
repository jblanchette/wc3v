const fs = require('fs');
const path = require('path');
const sjs = require('@wowserhq/stormjs');
const { FS, MPQ } = sjs;
const TERRAINFile = require('./lib/parsers/TERRAINFile');

async function extractAndAnalyzeMap(mapPath, outputDir, mapName) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`ANALYZING: ${mapName}`);
  console.log(`${'='.repeat(70)}`);

  try {
    // Open MPQ archive - mount the directory first
    const mapDir = path.dirname(mapPath);
    const fileName = path.basename(mapPath);
    
    // Mount the directory for stormjs to read
    try { FS.mkdir('/tmpmap2'); } catch(e) {}
    try { FS.unmount('/tmpmap2'); } catch(e) {}
    FS.mount(FS.filesystems.NODEFS, { root: mapDir }, '/tmpmap2');
    
    // Open the MPQ from the mounted location
    const mpq = await MPQ.open(`/tmpmap2/${fileName}`, 'r');
    
    // Extract war3map.w3e
    const file = mpq.openFile('war3map.w3e');
    const w3eData = file.read();
    file.close();
    
    // Save to disk temporarily
    const w3ePath = path.join(outputDir, `${mapName}.w3e`);
    if (fs.existsSync(w3ePath)) fs.unlinkSync(w3ePath);
    fs.writeFileSync(w3ePath, Buffer.from(w3eData));
    console.log(`Extracted: ${w3ePath}`);
    
    // Parse with TERRAINFile
    const terrain = new TERRAINFile(w3ePath, {});
    
    // Report tile palettes
    console.log(`\nTILE PALETTES: ${terrain.tilePalettes.length} total`);
    terrain.tilePalettes.forEach((code, idx) => {
      console.log(`  [${idx}] ${code}`);
    });
    
    // Report grid dimensions
    const rows = terrain.tileGrid.length;
    const cols = rows > 0 ? terrain.tileGrid[0].length : 0;
    console.log(`\nGRID DIMENSIONS: ${cols} cols x ${rows} rows (${cols * rows} total corners)`);
    
    // Report tile data
    console.log(`\nTILE DATA (paletteIndex, variation, palette code):`);
    for (let y = 0; y < rows; y++) {
      const row = terrain.tileGrid[y];
      for (let x = 0; x < cols; x++) {
        const tile = row[x];
        const paletteCode = tile.palette || 'null';
        console.log(`  [${y},${x}]: paletteIndex=${tile.paletteIndex}, variation=${tile.variation}, palette="${paletteCode}"`);
      }
    }
    
    // For grass-dirt-center map, identify tile types and variation patterns
    if (mapName.includes('grass-dirt-center')) {
      console.log(`\n${'='.repeat(70)}`);
      console.log(`GRASS-DIRT CENTER ANALYSIS`);
      console.log(`${'='.repeat(70)}`);
      
      // Map corner positions and classify them
      const tileTypes = [];
      for (let y = 0; y < rows; y++) {
        const rowTypes = [];
        for (let x = 0; x < cols; x++) {
          const tile = terrain.tileGrid[y][x];
          const code = tile.palette || '';
          const isGrass = code.includes('grs') || code.includes('grr');
          const isDirt = code.includes('drt') || code.includes('dro');
          rowTypes.push({ isGrass, isDirt, code, variation: tile.variation });
        }
        tileTypes.push(rowTypes);
      }
      
      console.log(`\nTile classification (G=grass, D=dirt, ?=other):`);
      for (let y = 0; y < rows; y++) {
        let line = `  Row ${y}: `;
        for (let x = 0; x < cols; x++) {
          const t = tileTypes[y][x];
          if (t.isGrass) line += 'G';
          else if (t.isDirt) line += 'D';
          else line += '?';
        }
        console.log(line);
      }
      
      console.log(`\nVariation values by position:`);
      for (let y = 0; y < rows; y++) {
        let line = `  Row ${y}: `;
        for (let x = 0; x < cols; x++) {
          const v = tileTypes[y][x].variation;
          line += `${v}`;
        }
        console.log(line);
      }
      
      console.log(`\nGrass tiles and their neighbors:`);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const t = tileTypes[y][x];
          if (!t.isGrass) continue;
          
          // Check if adjacent to dirt
          let nearDirt = false;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dy === 0 && dx === 0) continue;
              const ny = y + dy, nx = x + dx;
              if (ny >= 0 && ny < rows && nx >= 0 && nx < cols) {
                if (tileTypes[ny][nx].isDirt) nearDirt = true;
              }
            }
          }
          
          const location = nearDirt ? 'GRASS AT BOUNDARY' : 'GRASS INTERIOR';
          console.log(`    [${y},${x}] variation=${t.variation} (${location})`);
        }
      }
    }
    
    mpq.close();
    
  } catch (err) {
    console.error(`ERROR processing ${mapName}:`, err.message);
    console.error(err.stack);
  }
}

async function main() {
  const baseDir = './tools/map-data/test-maps';
  const outputDir = './tools/map-data/test-maps';
  
  const maps = [
    { path: path.resolve(baseDir, '32x32.grass-dirt-center.w3m'), name: 'grass-dirt-center' }
  ];
  
  for (const map of maps) {
    await extractAndAnalyzeMap(map.path, outputDir, map.name);
  }
  
  console.log(`\n${'='.repeat(70)}`);
  console.log('Analysis complete');
  console.log(`${'='.repeat(70)}\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
