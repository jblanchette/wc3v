const fs = require('fs');

const DOOFile = class {
  constructor (filePath) {
    this.read(filePath);
  }

  write (outPath) {
    // write the grid as json

    fs.writeFileSync(
      outPath, JSON.stringify({ "grid": this.grid }, null, 2) , 'utf-8');
  }

  read (filePath) {
    const buffer = fs.readFileSync(filePath);

    this.header    = buffer.slice(0, 4);

    this.version   = buffer.readUIntLE(4 * 1, 4);
    this.subversion  = buffer.readUIntLE(4 * 2, 4);
    this.treeCount = buffer.readUIntLE(4 * 3, 4);

    if (this.version !== 7) {
      console.logger("WARNING - non-version 7 doo file.  version=", this.version, this.subversion);

      this.grid = [];
      return;
    }

    const dataBuffer = buffer.slice(4 * 4);
    let offset = 0;

    this.grid = [];

    for (let index = 0; index < this.treeCount; index++) {
      const treeBuffer = dataBuffer.slice(offset, offset + 42);

      const item = {
        x:       treeBuffer.readFloatLE(4 * 2).toFixed(4),
        y:       treeBuffer.readFloatLE(4 * 3).toFixed(4),
        z:       treeBuffer.readFloatLE(4 * 4).toFixed(4),
        angle:   treeBuffer.readFloatLE(4 * 5).toFixed(4),
        xScale:  treeBuffer.readFloatLE(4 * 6).toFixed(4),
        yScale:  treeBuffer.readFloatLE(4 * 7).toFixed(4),
        zScale:  treeBuffer.readFloatLE(4 * 8).toFixed(4),
        flags:   treeBuffer.readUIntLE(4 * 9, 1),
        life:    treeBuffer.readUIntLE(4 * 10, 1)
      };

      this.grid.push(item);
      offset += 50;
    }
  }
};

module.exports = DOOFile;
