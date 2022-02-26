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
    const firstPass = this.doParsing(filePath, mapData, false);
    if (firstPass) {
      this.units = firstPass;

      return;
    }

    this.units = this.doParsing(filePath, mapData, true);

    if (!this.units) {
      console.log("ERROR: unable to parse UNITFile on either pass");
      return;
    }
  }


  doParsing (filePath, mapData, useUnknown = false) {
    const buffer = fs.readFileSync(filePath);
    const outBufferToJSON = new W3Buffer(buffer);

    // char(4) File id = "W3do"
    // int File version = 0x8 (8)
    // int File subversion = 0x0B (11)
    // int Number of units

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

        // char(4) Unit id
        unit.type = outBufferToJSON.readChars(4); // (iDNR = random item, uDNR = random unit)
        // int Variation
        unit.variation = outBufferToJSON.readInt();
        
        // float Position X
        // float Position Y
        // float Position Z

        unit.position = [outBufferToJSON.readFloat(), outBufferToJSON.readFloat(), outBufferToJSON.readFloat()]; // X Y Z coords
        
        // float Rotation
        unit.rotation = outBufferToJSON.readFloat();

        // float Scale X
        // float Scale Y
        // float Scale Z
        unit.scale = [outBufferToJSON.readFloat(), outBufferToJSON.readFloat(), outBufferToJSON.readFloat()]; // X Y Z scaling

        // byte Flags
        unit.flags = outBufferToJSON.readByte();

        //if (fileVersion >= 8) {
          
        // unknown(4)

        if (useUnknown) {
          outBufferToJSON.readInt();
        }
        
        //}

        // int Owning player (0=Player1, 1=Player2, ...)
        unit.player = outBufferToJSON.readInt(); // (player1 = 0, 16=neutral passive); note: wc3 patch now has 24 max players

        //if (fileVersion >= 8) {
        
        // unknown(1)
        outBufferToJSON.readByte();
        // unknown(1)
        outBufferToJSON.readByte();
        
        // } else {
        //   unit.unknown1 = outBufferToJSON.readShort(); // unknown
        // }

        // int Hitpoints
        unit.hitpoints = outBufferToJSON.readInt(); // -1 = use default
        
        // int Mana
        unit.mana = outBufferToJSON.readInt(); // -1 = use default, 0 = unit doesn't have mana

        //if (fileVersion > 7) {
        
        // int Dropped item set pointer
        unit.droppedItemTable = outBufferToJSON.readInt();
        
        //}

        unit.droppedItemSets = [];

        // int Number of dropped item sets
        for (let i = 0, l = outBufferToJSON.readInt(); i < l; i++) {
          // int Number of dropped items
          for (let x = 0, y = outBufferToJSON.readInt(); x < y; x++) {
            //console.log(`number of droppable items: ${y}`);
            
            const item = {
              // char(4) Item id
              itemId: outBufferToJSON.readChars(4),
              // int Drop chance %
              chance: outBufferToJSON.readInt()
            };

            unit.droppedItemSets.push(item);
          }
        }

        // int Gold (for goldmines only)
        unit.gold = outBufferToJSON.readInt();
        // float Target acquisition (-1 = normal, -2 = camp)
        unit.targetAcquisition = outBufferToJSON.readFloat(); // (-1 = normal, -2 = camp)

        unit.hero = {
          // int Hero level
          level: outBufferToJSON.readInt(), // non-hero units = 1
        };

        //if (fileVersion > 7) {

        // int Strength
        unit.hero.str = outBufferToJSON.readInt();
        // int Agility
        unit.hero.agi = outBufferToJSON.readInt();
        // int Intelligence
        unit.hero.int = outBufferToJSON.readInt();
        
        //}
        
        // int Number of items in inventory
        for (let i = 0, l = outBufferToJSON.readInt(); i < l; i++) {
          unit.inventory.push({
            // int Slot # (0-based)
            slot: outBufferToJSON.readInt() + 1, // the int is 0-based, but json format wants 1-6
            // char(4) Item id
            type: outBufferToJSON.readChars(4) // Item ID
          });
        }

        // int Number of modified abilities
        for (let i = 0, l = outBufferToJSON.readInt(); i < l; i++) {
          unit.abilities.push({
            // char(4) Ability id
            ability: outBufferToJSON.readChars(4), // Ability ID
            // int Autocast active
            active: !!outBufferToJSON.readInt(), // autocast active? 0=no, 1=active
            // int level
            level: outBufferToJSON.readInt()
          });
        }

        // int Random flag
        const randFlag = outBufferToJSON.readInt(); // random unit/item flag "r" (for uDNR units and iDNR items)
      
        if (randFlag === 0) {
            // 0 = Any neutral passive building/item, in this case we have
            //   byte[3]: level of the random unit/item,-1 = any (this is actually interpreted as a 24-bit number)
            //   byte: item class of the random item, 0 = any, 1 = permanent ... (this is 0 for units)
            //   r is also 0 for non random units/items so we have these 4 bytes anyway (even if the id wasnt uDNR or iDNR)
            
            // byte Level of the random unit/item, -1 = any
            // byte
            // byte
            // byte Item class of the random item (0 = any, 1 = permanent)
            outBufferToJSON.readByte();
            outBufferToJSON.readByte();
            outBufferToJSON.readByte();
            outBufferToJSON.readByte();
          } else if (randFlag === 1) {
            // 1 = random unit from random group (defined in the w3i), in this case we have
            //   int: unit group number (which group from the global table)
            //   int: position number (which column of this group)
            //   the column should of course have the item flag set (in the w3i) if this is a random item

            // int Unit group number (which group from the table)
            // int Position number (which column of this group)
            outBufferToJSON.readInt();
            outBufferToJSON.readInt();
          } else if (randFlag === 2) {
            // 2 = random unit from custom table, in this case we have
            //   int: number "n" of different available units
            //   then we have n times a random unit structure

            // int Number of available units
            for (let i = 0, l = outBufferToJSON.readInt(); i < l; i++) {
              // char(4) Unit id
              outBufferToJSON.readChars(4); // Unit ID
              // int Percent chance
              outBufferToJSON.readInt(); // % chance
            }
          }
        
        // int Unit color
        unit.color = outBufferToJSON.readInt();
        // int Waygate
        outBufferToJSON.readInt(); // UNSUPPORTED: waygate (-1 = deactivated, else its the creation number of the target rect as in war3map.w3r)
        
        // int Unit id
        unit.id = outBufferToJSON.readInt();
        
        result.push(unit);
      }

    } catch (e) {
      return null;
    }

    return result;
  }
};

module.exports = UNITFile;
