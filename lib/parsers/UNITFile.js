/**
 * translated from https://github.com/ChiefOfGxBxL/WC3MapTranslator/blob/016425a85fc7682e1883e662f4357dae1e65269a/lib/translators/UnitsTranslator.ts
 * used for researching and learning purposes only.  all copyright andd rights reserved to the owner under MIT license.
 **/

 const fs = require('fs');
 const W3Buffer = require('./W3Buffer');

 const UNITFile = class {
  constructor (filePath, mapData) {
    this.read(filePath, mapData);
  }

  write (outPath) {
    // write the grid as json

    fs.writeFileSync(
      outPath, JSON.stringify({ "units": this.units }, null, 2) , 'utf-8');
  }

  read (filePath, mapData) {
    const buffer = fs.readFileSync(filePath);
    const outBufferToJSON = new W3Buffer(buffer);

    const fileId      = outBufferToJSON.readChars(4), // W3do for doodad file
          fileVersion = outBufferToJSON.readInt(),    // File version = 7
          subVersion  = outBufferToJSON.readInt(),    // 0B 00 00 00
          numUnits    = outBufferToJSON.readInt();    // # of units

    const result = [];

    try {
      for (let i = 0; i < numUnits; i++) {
        const unit = {
          type: '',
          variation: -1,
          position: [0, 0, 0],
          rotation: 0,
          scale: [0, 0, 0],
          hero: { level: 1, str: 1, agi: 1, int: 1 },
          inventory: [],
          abilities: [],
          player: 0,
          hitpoints: -1,
          mana: -1,
          gold: 0,
          targetAcquisition: -1,
          color: -1,
          id: -1
        };

        unit.type = outBufferToJSON.readChars(4); // (iDNR = random item, uDNR = random unit)
        unit.variation = outBufferToJSON.readInt();
        unit.position = [outBufferToJSON.readFloat(), outBufferToJSON.readFloat(), outBufferToJSON.readFloat()]; // X Y Z coords
        unit.rotation = outBufferToJSON.readFloat();
        unit.scale = [outBufferToJSON.readFloat(), outBufferToJSON.readFloat(), outBufferToJSON.readFloat()]; // X Y Z scaling

        unit.flags = outBufferToJSON.readByte();

        unit.player = outBufferToJSON.readInt(); // (player1 = 0, 16=neutral passive); note: wc3 patch now has 24 max players

        unit.unknown1 = outBufferToJSON.readShort(); // unknown

        unit.hitpoints = outBufferToJSON.readInt(); // -1 = use default
        unit.mana = outBufferToJSON.readInt(); // -1 = use default, 0 = unit doesn't have mana

        if (fileVersion > 7) {
          unit.droppedItemTable = outBufferToJSON.readInt();
        }

        unit.droppedItemSets = [];
        for (let i = 0, l = outBufferToJSON.readInt(); i < l; i++) {
          for (let x = 0, y = outBufferToJSON.readInt(); x < y; x++) {

            const item = {
              itemId: outBufferToJSON.readChars(4),
              chance: outBufferToJSON.readInt()
            };

            unit.droppedItemSets.push(item);
          }
        }

        unit.gold = outBufferToJSON.readInt();
        unit.targetAcquisition = outBufferToJSON.readFloat(); // (-1 = normal, -2 = camp)

        unit.hero = {
          level: outBufferToJSON.readInt(), // non-hero units = 1
        };

        if (fileVersion > 7) {
          unit.hero.str = outBufferToJSON.readInt();
          unit.hero.agi = outBufferToJSON.readInt();
          unit.hero.int = outBufferToJSON.readInt();
        }
        
        for (let i = 0, l = outBufferToJSON.readInt(); i < l; i++) {
          unit.inventory.push({
            slot: outBufferToJSON.readInt() + 1, // the int is 0-based, but json format wants 1-6
            type: outBufferToJSON.readChars(4) // Item ID
          });
        }

        for (let i = 0, l = outBufferToJSON.readInt(); i < l; i++) {
          unit.abilities.push({
            ability: outBufferToJSON.readChars(4), // Ability ID
            active: !!outBufferToJSON.readInt(), // autocast active? 0=no, 1=active
            level: outBufferToJSON.readInt()
          });
        }

        const randFlag = outBufferToJSON.readInt(); // random unit/item flag "r" (for uDNR units and iDNR items)
        
        if (randFlag === 0) {
            // 0 = Any neutral passive building/item, in this case we have
            //   byte[3]: level of the random unit/item,-1 = any (this is actually interpreted as a 24-bit number)
            //   byte: item class of the random item, 0 = any, 1 = permanent ... (this is 0 for units)
            //   r is also 0 for non random units/items so we have these 4 bytes anyway (even if the id wasnt uDNR or iDNR)
            outBufferToJSON.readByte();
            outBufferToJSON.readByte();
            outBufferToJSON.readByte();
            outBufferToJSON.readByte();
          } else if (randFlag === 1) {
            // 1 = random unit from random group (defined in the w3i), in this case we have
            //   int: unit group number (which group from the global table)
            //   int: position number (which column of this group)
            //   the column should of course have the item flag set (in the w3i) if this is a random item
            outBufferToJSON.readInt();
            outBufferToJSON.readInt();
          } else if (randFlag === 2) {
            // 2 = random unit from custom table, in this case we have
            //   int: number "n" of different available units
            //   then we have n times a random unit structure
            for (let i = 0, l = outBufferToJSON.readInt(); i < l; i++) {
              outBufferToJSON.readChars(4); // Unit ID
              outBufferToJSON.readInt(); // % chance
            }
          }

        unit.color = outBufferToJSON.readInt();
        outBufferToJSON.readInt(); // UNSUPPORTED: waygate (-1 = deactivated, else its the creation number of the target rect as in war3map.w3r)
        unit.id = outBufferToJSON.readInt();

        result.push(unit);
      }

    } catch (e) {
      console.log("detected issue with UNIT file. returning empty list.");
      this.units = [];

      return;
    }

    this.units = result;
  }
};

module.exports = UNITFile;
