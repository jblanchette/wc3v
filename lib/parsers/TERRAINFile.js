const fs = require('fs');
const W3Buffer = require('./W3Buffer');

const TERRAINFile = class {
  constructor (filePath, mapData) {
    this.read(filePath, mapData);
  }

  write (outPath) {

  }

  read (filePath, mapData) {
    const buffer = fs.readFileSync(filePath);
    const outBuffer = new W3Buffer(buffer);

    outBuffer.readChars(4);
    outBuffer.readInt();
    outBuffer.readChars(1);
    outBuffer.readInt();

    const numTilePalettes = outBuffer.readInt();
    const tilePalettes = [];
    for (let i = 0; i < numTilePalettes; i++) {
        tilePalettes.push(outBuffer.readChars(4));
    }

    const numCliffTilePalettes = outBuffer.readInt();
    const cliffPalettes = [];
    for (let i = 0; i < numCliffTilePalettes; i++) {
        const cliffPalette = outBuffer.readChars(4);
        cliffPalettes.push(cliffPalette);
    }

    this.tilePalettes = tilePalettes;
    this.cliffPalettes = cliffPalettes;

    // determine tileset from first char of palette codes
    // e.g. 'L'=Lordaeron Summer, 'N'=Northrend, 'A'=Ashenvale, etc.
    this.tileset = tilePalettes.length > 0 ? tilePalettes[0][0] : 'L';

    /**
     * map dimensions
     */
    const width = outBuffer.readInt() - 1;
    const height = outBuffer.readInt() - 1;

    this.map = { width, height, offset: { x: 0, y: 0 } };

    const offsetX = outBuffer.readFloat();
    const offsetY = outBuffer.readFloat();
    this.map.offset = { x: offsetX, y: offsetY };

    // read per-tile data: each tile is 7 bytes
    // byte layout: groundHeight(2), waterLevel(2), flags(1), groundTexture(1), cliffTexture(1)
    // groundTexture lower 4 bits = index into tilePalettes
    const tileCount = (width + 1) * (height + 1);
    const tileGrid = [];

    for (let y = 0; y <= height; y++) {
      const row = [];
      for (let x = 0; x <= width; x++) {
        if (outBuffer.isExhausted()) break;

        outBuffer.readShort();  // ground height
        outBuffer.readShort();  // water level + flags
        const flags = outBuffer.readByte();
        const groundTextureByte = outBuffer.readByte();
        outBuffer.readByte();   // cliff texture + layer

        const paletteIndex = groundTextureByte & 0x0F;
        const palette = paletteIndex < tilePalettes.length ? tilePalettes[paletteIndex] : null;

        row.push({ paletteIndex, palette });
      }
      tileGrid.push(row);
    }

    this.tileGrid = tileGrid;
  }
};

module.exports = TERRAINFile;
