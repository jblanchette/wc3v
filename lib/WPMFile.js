const fs = require('fs');


const flagTable = {
  'NoWalk':  0x02,  // 1=no walk, 0=walk ok
  'NoFly':   0x04,  // 1=no fly, 0=fly ok
  'NoBuild': 0x08,  // 1=no build, 0=build ok

  'Blight':  0x20,  // 1=blight, 0=normal
  'NoWater': 0x40,  // 1=no water, 0=water
  'Unknown': 0x80   // 1=unknown, 0=normal
};

const WPMFile = class {
  constructor (filePath) {
    this.filePath = filePath;
    this.buffer = fs.readFileSync('../client/maps/ConcealedHill/echo.wpm');
    
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
      for (let i = 0; i < 4; i++) {
        const flagBytes = pathBuffer.readUIntLE(offset, 1);

        const flags = {};
        const flagHex = parseInt(flagBytes, 16);

        flags['bytes'] = flagBytes;
        flags['hex'] = flagHex;
        flags['str'] = flagBytes.toString(16).padStart(2, '0');

        Object.keys(flagTable).forEach((flagName, ind) => {
          const flag = flagTable[flagName];

          flags[flagName] = (flagHex & flag) == flag;
        });

        this.grid.push(flags);
        offset += 1;
      }
    }

    console.log(`grid len: ${this.grid.length}`);
  }
};

const test = new WPMFile();

module.exports = WPMFile;
