const fs = require('fs');

const flagTable = {
  'NoWalk':  0x02,  // 1=no walk  , 0=walk ok
  'NoFly':   0x04,  // 1=no fly   , 0=fly ok
  'NoBuild': 0x08,  // 1=no build , 0=build ok

  'Blight':  0x20,  // 1=blight   , 0=normal
  'NoWater': 0x40,  // 1=no water , 0=water
  'Unknown': 0x80   // 1=unknown  , 0=normal
};

const WPMFile = class {
  constructor (filePath, mapData) {
    this.read(filePath, mapData);
  }

  write (outPath) {
    // write the grid as json

    fs.writeFileSync(
      outPath, JSON.stringify({ "grid": this.grid }, null, 2) , 'utf-8');
  }

  read (filePath, mapData) {
    const buffer = fs.readFileSync(filePath);

    this.header    = buffer.slice(0, 4);

    this.version   = buffer.readUIntLE(4 * 1, 4);
    this.mapWidth  = buffer.readUIntLE(4 * 2, 4) / 4;
    this.mapHeight = buffer.readUIntLE(4 * 3, 4) / 4;

    const pathBuffer = buffer.slice(4 * 4);

    let offset = 0;
    const tiles = [];

    while (offset < pathBuffer.length) {
        const flagBytes = pathBuffer.readUIntLE(offset, 1);

        const flags = {};
        const flagHex = parseInt(flagBytes, 16);

        Object.keys(flagTable).forEach((flagName, ind) => {
          const flag = flagTable[flagName];

          // check if the flag is set
          flags[flagName] = (flagHex & flag) == flag;
        });

        tiles.push(flags);
        offset += 1;
    }

    // todo: eventually roll into one loop
    //       this is just cleaner for now

    let c = 0;
    this.grid = [];
    this.rawGrid = [];

    for (let col = 0; col < this.mapHeight * 4; col++) {
      this.rawGrid.push([[]]);

      for (let row = 0; row < this.mapWidth * 4; row++) {
        
        this.rawGrid[col][row] = tiles[c];
        c++;
      }
    }

    const { full, playable } = mapData.gridSize;

    // difference in number of gridData slots that the full grid
    // has but playable does not.  
    const offsets = {
      width:  ((full[0] - playable[0]) * 4),
      height: ((full[1] - playable[1]) * 4)
    };

    offsets.halfWidth = offsets.width / 2;
    offsets.halfHeight = offsets.height / 2;

    const rawGridHeight = this.mapHeight * 4;
    const rawGridWidth = this.mapWidth * 4;

    let rCol = 0;
    let rRow = 0;

    let first = false;

    for (let col = 0; col < this.mapHeight * 4; col++) {
      if (col < offsets.halfHeight || 
          col > (rawGridHeight - offsets.halfHeight)) {
        continue;
      }

      this.grid.push([[]]);

      for (let row = 0; row < this.mapWidth * 4; row++) {
        if (row < offsets.halfWidth || 
            row > (rawGridWidth - offsets.halfWidth)) {
          continue;
        }

        this.grid[rCol][rRow] = this.rawGrid[col][row];

        rRow++;
        c++;
      }

      rRow = 0;
      rCol++;
    }
  }
};

module.exports = WPMFile;
