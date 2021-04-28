const fs = require("fs");

const Slk = class {
  constructor () {
    const buffer = fs.readFileSync("./UnitBalance.slk", "utf-8");

    this.rows = [];
    this.output = {};
    this.load(buffer);
  }

  write () {
    fs.writeFileSync(
      './UnitBalance.json', JSON.stringify({ "output": this.output }, null, 2) , 'utf-8');
  }

  // from wc3.rivsoft.net
  load(buffer) {
    if (!buffer.startsWith('ID')) {
      throw new Error('WrongMagicNumber');
    }

    let rows = this.rows;
    let x = 0;
    let y = 0;

    for (let line of buffer.split('\n')) {
      if (line[0] !== 'B') {
        for (let token of line.split(';')) {
          let op = token[0];
          let valueString = token.substring(1).trim();
          let value;

          if (op === 'X') {
            x = parseInt(valueString, 10) - 1;
          } else if (op === 'Y') {
            y = parseInt(valueString, 10) - 1;
          } else if (op === 'K') {
            if (!rows[y]) {
              rows[y] = [];
            }

            if (valueString[0] === '"') {
              value = valueString.substring(1, valueString.length - 1);
            } else if (valueString === 'TRUE') {
              value = true;
            } else if (valueString === 'FALSE') {
              value = false;
            } else {
              value = parseFloat(valueString);
            }

            rows[y][x] = value;
          } else if (op === 'A') {
            if (!this.comments) {
              this.comments = [];
            }
            if (!this.comments[y]) {
              this.comments[y] = [];
            }
            this.comments[y][x] = valueString;
          }
        }
      }
    }

    this.cols = this.rows.reduce((m, r) => Math.max(m, r.length), 0);
    
    this.parse();
    this.write();
  }

  // wc3v parsing of slk data
  parse () {
    const headerRow = this.rows[0];
    const fields = {
      'itemId': 'unitBalanceID',
      'level': 'level',
      'goldCost': 'goldcost',
      'lumberCost': 'lumbercost',
      'hp': 'HP',
      'hpRegen': 'regenHP',
      'mana': 'mana0',
      'collisionSize': 'collision',
      'displayName': 'comment(s)',
      'defense': 'def',
      'armorType': 'defType',
      'dayVisionRange': 'sight',
      'nightVisionRange': 'nsight',
      'str': 'STR',
      'int': 'INT',
      'agi': 'AGI',
      'primaryStat': 'Primary'
    };

    const stringFields = [
      'itemId',
      'displayName',
      'armorType',
      'primaryStat'
    ];
    
    const mappings = headerRow.reduce((acc, item, ind) => {
      const foundField = Object.keys(fields).find(field => {
        return (fields[field] === item);
      });

      if (foundField) {
        acc.push({
          key: foundField,
          slot: ind
        });
      }

      return acc;
    }, []);

    for (let i = 1; i < this.rows.length; i++) {
      const val = this.rows[i];
      const result = {};

      mappings.forEach(mapping => {
        const raw = val[mapping.slot];
        const isStringField = stringFields.includes(mapping.key);
        
        let formattedValue;

        if (isStringField) {
          formattedValue = raw;
        } else {
          formattedValue = Number.isInteger(raw) ? raw : null;
        }

        result[mapping.key] = formattedValue;
      });

      this.output[result.itemId] = result;
    }
  }
};

const slk = new Slk();
