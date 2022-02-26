 const fs = require('fs');
 const W3Buffer = require('./W3Buffer');

 // NOTE:  this is buggy but it does the job

 const LISTFile = class {
  constructor (filePath, mapData) {
    this.read(filePath, mapData);
  }

  write (outPath) {
    // write the grid as json

    fs.writeFileSync(
      outPath, JSON.stringify({ "files": this.files }, null, 2) , 'utf-8');
  }

  read (filePath, mapData) {
    this.files = this.doParsing(filePath, mapData, true);
  }

  doParsing (filePath, mapData, useUnknown = false) {
    const buffer = fs.readFileSync(filePath);
    const outBuffer = new W3Buffer(buffer);

    let currentString = "",
        result = [];

    const fullBufferSize = outBuffer._buffer.length;

    while (!outBuffer.isExhausted()) {
      const rawChar = outBuffer.readCharsRaw(1);
      const newChar = String.fromCharCode(rawChar[0]);
      const charCode = newChar.charCodeAt(0);

      if (charCode == 13) {
        continue;
      } else if (charCode == 10) {
        result.push(currentString);
        currentString = "";  
      } else {
        currentString += newChar;
      }
    }

    if (currentString != "") {
      result.push(currentString);
    }

    return result;
  }
};

module.exports = LISTFile;
