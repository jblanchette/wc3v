 const fs = require('fs');
 const W3Buffer = require('./W3Buffer');

 // note: only reads enough of the file for what we need

 const INFOFile = class {
  constructor (filePath, mapData) {
    this.read(filePath, mapData);
  }

  write (outPath) {
    // write the grid as json

    fs.writeFileSync(
      outPath, JSON.stringify({ info: this.info }, null, 2) , 'utf-8');
  }

  read (filePath, mapData) {
    this.info = this.doParsing(filePath, mapData, false);
  }


  doParsing (filePath, mapData, useUnknown = false) {
    const buffer = fs.readFileSync(filePath);
    const outBuffer = new W3Buffer(buffer);

    outBuffer.readInt();
    outBuffer.readInt(); // saves
    outBuffer.readInt(); // editor
    outBuffer.readInt(); // major
    outBuffer.readInt(); // minor
    outBuffer.readInt(); // patch
    outBuffer.readInt(); // build

    outBuffer.readString(); // name

    outBuffer.readString(); // author
    outBuffer.readString(); // desc
    outBuffer.readString(); // rec

    // Camera bounds (8 floats total)
    const cameraBounds = [];

    for (let cbIndex = 0; cbIndex < 8; cbIndex++) {
        cameraBounds.push(outBuffer.readFloat()); // cam bounds
    }

    // Camera complements (4 floats total)
    for (let ccIndex = 0; ccIndex < 4; ccIndex++) {
        outBuffer.readInt();
    }

    const playableWidth = outBuffer.readInt();
    const playableHeight = outBuffer.readInt();

    return {
      bounds: {
        camera: [
          [ cameraBounds[4], cameraBounds[5] ],
          [ cameraBounds[6], cameraBounds[7] ] 
        ],
        map: [
          [ cameraBounds[0], cameraBounds[1] ],
          [ cameraBounds[2], cameraBounds[3] ]
        ]
      },
      gridSize: {
        playable: [ playableWidth, playableHeight ]
      }
    };
  }
};

module.exports = INFOFile;
