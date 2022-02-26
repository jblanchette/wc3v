const fs = require('fs');

const LUAJASSFile = class {
  constructor (filePath, mapData) {
    this.read(filePath, mapData);
  }

  write (outPath) {

  }

  read (filePath, mapData) {
    const buffer = fs.readFileSync(filePath, 'utf-8');
    const lines = buffer.split(/\r?\n/);

    const searchTarget = 'DefineStartLocation';
    const targets = [];

    lines.forEach((rawLine, lineIndex) => {
      const line = rawLine.trim();

      if (line.indexOf(searchTarget) != -1) {
        targets.push(line);
      }
    });

    const output = {};
    const pattern = new RegExp(/\((.*)\)/, 'g');
    
    targets.forEach(target => {
      const matches = target.match(pattern);
      const trimmed = matches.map(match => {
        return match.substring(1, match.length - 1);
      });

      trimmed.forEach(item => {
        const arr = item.split(",");

        // add the starting position to the output object with the key as the spot id
        output[arr[0]] = { x: parseFloat(arr[1]), y: parseFloat(arr[2]) };
      });
    });

    this.startingPositions = output;
  }
};

module.exports = LUAJASSFile;
