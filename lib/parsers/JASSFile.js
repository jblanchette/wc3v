const fs = require('fs');

const METHOD_HEADERS = {
  'neutralHostiles': 'function CreateNeutralHostile takes nothing returns nothing',
  'neutralPassiveBuildings': 'function CreateNeutralPassiveBuildings takes nothing returns nothing',
  'neutralPassive': 'function CreateNeutralPassive takes nothing returns nothing'
};

const METHOD_CREATE = 'CreateUnit';
const METHOD_END = 'endfunction';

const JASSFile = class {
  constructor (filePath, mapData) {
    this.read(filePath, mapData);
  }

  write (outPath) {
    // write the grid as json

    fs.writeFileSync(
      outPath, JSON.stringify({ "grid": this.grid }, null, 2) , 'utf-8');
  }

  read (filePath, mapData) {
    const buffer = fs.readFileSync(filePath, 'utf-8');
    const methodKeys = Object.keys(METHOD_HEADERS);
    const lines = buffer.split(/\r?\n/);

    let isSectionOpen = false;
    let openSection = null;

    const methodMap = methodKeys.reduce((acc, key) => {
      acc[key] = null;

      return acc;
    }, {});

    lines.forEach((rawLine, lineIndex) => {
      const line = rawLine.trim();

      methodKeys.forEach(methodKey => {
        const methodText = METHOD_HEADERS[methodKey];
        
        // ending sections
        if (line.startsWith(METHOD_END)) {
          if (openSection && methodMap[openSection]) {
            methodMap[openSection].end = lineIndex;

            isSectionOpen = false;
            openSection = null;
          }
        }

        // starting sections
        if (line.startsWith(methodText)) {
          if (isSectionOpen) {
            console.error("error in JASS file, missing ending block section.", openSection);
            throw new Error("JASS file error");
          }

          isSectionOpen = true;
          openSection = methodKey;

          methodMap[methodKey] = {
            start: lineIndex,
            end: null,
            units: []
          };
        }

        // units

        if (isSectionOpen && methodMap[openSection]) {
          if (line.includes(METHOD_CREATE)) {
            methodMap[openSection].units.push(line);
          }
        }
      });
    });

    console.log("jass method map: ", methodMap);

  }
};

module.exports = JASSFile;
