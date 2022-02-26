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

    /**
     * map dimensions
     */
    const width = outBuffer.readInt() - 1;
    const height = outBuffer.readInt() - 1;
    
    this.map = { width, height, offset: { x: 0, y: 0 } };

    const offsetX = outBuffer.readFloat();
    const offsetY = outBuffer.readFloat();
    this.map.offset = { x: offsetX, y: offsetY };
  }
};

module.exports = TERRAINFile;
