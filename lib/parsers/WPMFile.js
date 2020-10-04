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

    this.processTiles(mapData, tiles);
  }

  calculateCameraOffsets (bounds) {
    const { camera, map } = bounds;

    // the outer camera box for the whole map (larger)
    const mapBox = {
      left:   bounds.map[0][0],
      right:  bounds.map[0][1],
      top:    bounds.map[1][0],
      bottom: bounds.map[1][1]
    };

    // the inner camera box for the play area (smaller)
    const camBox = {
      left:   bounds.camera[0][0],
      right:  bounds.camera[0][1],
      top:    bounds.camera[1][0],
      bottom: bounds.camera[1][1]
    };

    return {
      leftOffset:    Math.abs(mapBox.left - camBox.left)     / 32,
      rightOffset:   Math.abs(mapBox.right - camBox.right)   / 32,
      topOffset:     Math.abs(mapBox.top - camBox.top)       / 32,
      bottomOffset:  Math.abs(mapBox.bottom - camBox.bottom) / 32
    };
  }

  processTiles (mapData, tiles) {
    ////
    // the grid size and map height/width 
    // are defined in 'large' grid size.
    // we multiply by the `gridFactor` to work
    // in 'small' grid tile sizes which matches the `wpmGrid`
    ////

    const gridFactor = 4;

    const { full, playable } = mapData.gridSize;

    // difference in number of gridData slots that the full grid
    // has but playable does not. defined in 'small' grid tile size 
    const offsets = this.calculateCameraOffsets(mapData.bounds);

    let c = 0;
  
    // fill the tiles out into rawGrid
    // to be easier to access mirrored + flipped

    this.rawGrid = [];
    for (let col = 0; col < this.mapHeight * 4; col++) {
      this.rawGrid.push([[]]);

      for (let row = 0; row < this.mapWidth * 4; row++) {
        
        this.rawGrid[col][row] = tiles[c];
        c++;
      }
    }

    // precompute constants
    const rawGridHeight = this.mapHeight * gridFactor;
    const rawGridWidth = this.mapWidth * gridFactor;

    // internal row counter to handle index differences
    // from the non-included portions
    let rCol = 0;
    let rRow = 0;

    // fill the output grid
    this.grid = [];

    for (let col = 0; col < rawGridHeight; col++) {
      if (col < offsets.topOffset || 
          col > (rawGridHeight - offsets.bottomOffset)) {
        continue;
      }

      this.grid.push([[]]);

      for (let row = 0; row < rawGridWidth; row++) {
        if (row < offsets.leftOffset || 
            row > (rawGridWidth - offsets.rightOffset)) {
          continue;
        }

        this.grid[rCol][rRow] = this.rawGrid[col][row];
        rRow++;
      }

      rRow = 0;
      rCol++;
    }
  }
};

module.exports = WPMFile;
