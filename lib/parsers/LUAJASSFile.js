const fs = require('fs');

const LUAJASSFile = class {
  constructor (filePath, mapData) {
    this.read(filePath, mapData);
  }

  write (outPath) {

  }

  read (filePath, mapData) {
    const buffer = fs.readFileSync(filePath, 'utf-8');

    this.startingPositions = LUAJASSFile.findStartLocations(buffer);
  }

  // Every DefineStartLocation(spot, x, y) call in a war3map.j or war3map.lua,
  // keyed by spot id.
  //
  // Matched call by call, not line by line: minified Lua maps (the copies
  // hosted under hashed names in Maps/dz/) put the whole script on one line,
  // and a greedy "(...)" over that line read from the first parenthesis of
  // the file to the last, giving one spot named "_ENV" at (null, null).
  // Optimised JASS (several ATR maps) writes a space after the sign,
  // "- 1280.0", which parseFloat read as NaN. Every game on those maps then
  // stopped at its first move order, where the start position is placed.
  static findStartLocations (script) {
    // optimised JASS writes a space after the sign: "- 1280.0"
    const number = '([-+]?\\s*(?:\\d+(?:\\.\\d*)?|\\.\\d+))';
    const pattern = new RegExp(
      `DefineStartLocation\\s*\\(\\s*(\\d+)\\s*,\\s*${number}\\s*,\\s*${number}\\s*\\)`, 'g');

    const output = {};
    let match;

    while ((match = pattern.exec(script)) !== null) {
      const [ , spotId, x, y ] = match;

      // add the starting position to the output object with the key as the spot id
      output[spotId] = {
        x: parseFloat(x.replace(/\s+/g, '')),
        y: parseFloat(y.replace(/\s+/g, ''))
      };
    }

    return output;
  }
};

module.exports = LUAJASSFile;
