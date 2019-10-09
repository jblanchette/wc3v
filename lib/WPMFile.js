const fs = require('fs');



const WPMFile = class {
  constructor (filePath) {
    this.filePath = filePath;
    this.buffer = fs.readFileSync('client/maps/ConcealedHill/war3map.wpm')
  
    this.read();
  }

  read () {
    const offsets = {
      'version':    4,
      'mapHeight':  4 * 2,
      'mapWidth':   4 * 3,
      'pathing':    4 * 4
    };

    this.version   = buffer.readUIntLE(offsets.version, 4);
    this.mapHeight = buffer.readUIntLE(offsets.mapHeight, 4);
    this.mapWidth  = buffer.readUIntLE(offsets.mapWidth, 4);

    this.size = (this.mapHeight * this.mapWidth);

    this.pathing = [];
    let offset = offsets.pathing;

    while(offset <= size) {
      pathing.push(buffer.readUIntLE(offset, 4));

      offset += 4;
    }
  }
};

module.exports = WPMFile;
