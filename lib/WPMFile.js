const fs = require('fs');


const flagTable = {
  'NoWalk':  2,  // 1=no walk, 0=walk ok
  'NoFly':   4,  // 1=no fly, 0=fly ok
  'NoBuild': 8,  // 1=no build, 0=build ok

  'Blight':  20,  // 1=blight, 0=normal
  'NoWater': 40,  // 1=no water, 0=water
  'Unknown': 80   // 1=unknown, 0=normal
};

const WPMFile = class {
  constructor (filePath) {
    this.filePath = filePath;
    this.buffer = fs.readFileSync('../client/maps/ConcealedHill/war3map.wpm');
    
    this.read();
  }

  read () {
    const { buffer } = this;

    this.header    = buffer.slice(0, 4);

    this.version   = buffer.readUIntLE(4 * 1, 4);
    this.mapWidth  = buffer.readUIntLE(4 * 2, 4);
    this.mapHeight = buffer.readUIntLE(4 * 3, 4);

    console.log(`header: ${this.header} version: ${this.version}`);
    console.log(`map width: ${this.mapWidth} height: ${this.mapHeight}`);

    const pathBuffer = buffer.slice(4 * 4);
    let offset = 0;

    this.grid = [];

    console.log(`path buffer len: ${pathBuffer.length}`);

    while (offset < pathBuffer.length) {
      const flagBytes = pathBuffer.slice(offset, offset + 4);
      const flags = {};

      Object.keys(flagTable).forEach(flagName => {
        const flag = flagTable[flagName];
        console.log('flag: ', flag);

        if (flag & flagBytes === flag) {
          console.log("found one: ", flagName, flagBytes, bitValue, i);
        }

        flags[flagName] = flagBytes & flag === flag;
      });
      
      
      offset += 4;
      this.grid.push(flags);
    }

    console.log(`grid len: ${this.grid.length}`);
  }
};

const test = new WPMFile();

module.exports = WPMFile;
