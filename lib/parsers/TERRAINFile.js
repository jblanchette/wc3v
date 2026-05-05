const fs = require('fs');
const W3Buffer = require('./W3Buffer');

const TERRAINFile = class {
  constructor (filePath, mapData) {
    this.read(filePath, mapData);
  }

  write (outPath) {

  }

  read (filePath, mapData) {
    const buffer = fs.readFileSync(filePath);
    const outBuffer = new W3Buffer(buffer);

    outBuffer.readChars(4);  // "W3E!"
    const w3eVersion = outBuffer.readInt();
    outBuffer.readChars(1);  // tileset char
    outBuffer.readInt();     // custom tileset flag

    this.w3eVersion = w3eVersion;

    const numTilePalettes = outBuffer.readInt();
    const tilePalettes = [];
    for (let i = 0; i < numTilePalettes; i++) {
        tilePalettes.push(outBuffer.readChars(4));
    }

    const numCliffTilePalettes = outBuffer.readInt();
    const cliffPalettes = [];
    for (let i = 0; i < numCliffTilePalettes; i++) {
        const cliffPalette = outBuffer.readChars(4);
        cliffPalettes.push(cliffPalette);
    }

    this.tilePalettes = tilePalettes;
    this.cliffPalettes = cliffPalettes;

    // determine tileset from first char of palette codes
    // e.g. 'L'=Lordaeron Summer, 'N'=Northrend, 'A'=Ashenvale, etc.
    this.tileset = tilePalettes.length > 0 ? tilePalettes[0][0] : 'L';

    /**
     * map dimensions
     */
    const width = outBuffer.readInt() - 1;
    const height = outBuffer.readInt() - 1;

    this.map = { width, height, offset: { x: 0, y: 0 } };

    const offsetX = outBuffer.readFloat();
    const offsetY = outBuffer.readFloat();
    this.map.offset = { x: offsetX, y: offsetY };

    // Per-corner record layout (HiveWE wiki / terrain.ixx):
    //
    // v11 (7 bytes per corner):
    //   groundHeight(2)      — int16 raw, baseline 0x2000
    //   waterAndEdge(2)      — low 14 bits = waterLevel, bit 14 = map edge
    //   textureAndFlags(1)   — LOW 4 bits = palette index, HIGH 4 bits = flags
    //                          (bit4=ramp, bit5=blight, bit6=water, bit7=boundary)
    //   variation(1)         — LOW 5 bits = ground variation (0-31),
    //                          HIGH 3 bits = cliff variation (0-7)
    //   misc(1)              — LOW 4 bits = layer height (0-15, "ground" = 2),
    //                          HIGH 4 bits = cliff texture palette index
    //
    // v12+ (8 bytes per corner):
    //   groundHeight(2)      — int16 raw, baseline 0x2000
    //   waterAndEdge(2)      — low 14 bits = waterLevel, bit 14 = map edge
    //   textureAndFlags(2)   — uint16: LOW 6 bits = palette index,
    //                          bit6=ramp, bit7=blight, bit8=water, bit9=boundary
    //   variation(1)         — LOW 5 bits = ground variation, HIGH 3 bits = cliff variation
    //   misc(1)              — LOW 4 bits = layer height, HIGH 4 bits = cliff texture
    //
    // Canonical world-unit height formula (HiveWE wiki):
    //   worldY = ((groundHeight - 0x2000) + (layer - 2) * 0x0200) / 4
    //   waterWorldY = (waterLevel - 0x2000) / 4 - 89.6
    // 1 cliff layer = 128 world units of vertical rise.
    const tileGrid = [];

    for (let y = 0; y <= height; y++) {
      const row = [];
      for (let x = 0; x <= width; x++) {
        if (outBuffer.isExhausted()) break;

        const groundHeight = outBuffer.readShort();
        const waterAndEdge = outBuffer.readShort();
        const waterLevel = waterAndEdge & 0x3FFF;

        let paletteIndex, flagsByte, variation, cliffVariation;

        if (w3eVersion >= 12) {
          // v12+: textureAndFlags is uint16 (2 bytes)
          const textureAndFlags = outBuffer.readShort() & 0xFFFF;
          paletteIndex = textureAndFlags & 0x3F;          // LOW 6 bits
          flagsByte = (textureAndFlags >> 4) & 0xF0;      // shift bits 6-9 → bits 4-7
          // Reconstruct a flags byte compatible with v11 bit positions:
          // bit6 ramp → 0x10, bit7 blight → 0x20, bit8 water → 0x40, bit9 boundary → 0x80
          flagsByte = ((textureAndFlags & 0x0040) ? 0x10 : 0) |  // ramp
                      ((textureAndFlags & 0x0080) ? 0x20 : 0) |  // blight
                      ((textureAndFlags & 0x0100) ? 0x40 : 0) |  // water
                      ((textureAndFlags & 0x0200) ? 0x80 : 0);   // boundary
        } else {
          // v11: textureAndFlags is uint8 (1 byte)
          const textureAndFlags = outBuffer.readByte();
          paletteIndex = textureAndFlags & 0x0F;           // LOW 4 bits
          flagsByte = textureAndFlags & 0xF0;              // HIGH 4 bits as flags
        }

        const variationByte = outBuffer.readByte();
        variation = variationByte & 0x1F;                  // LOW 5 bits (0-31)
        cliffVariation = (variationByte >> 5) & 0x07;      // HIGH 3 bits (0-7)

        const miscByte = outBuffer.readByte();
        const layer = miscByte & 0x0F;                     // LOW 4 bits
        const cliffTexture = (miscByte >> 4) & 0x0F;       // HIGH 4 bits

        const palette = paletteIndex < tilePalettes.length ? tilePalettes[paletteIndex] : null;
        const hasWater = (flagsByte & 0x40) !== 0;
        const isRamp = (flagsByte & 0x10) !== 0;
        const isBoundary = (flagsByte & 0x80) !== 0;

        row.push({
          paletteIndex, palette, variation, cliffVariation,
          groundHeight, waterLevel,
          flags: flagsByte, layer, cliffTexture,
          hasWater, isRamp, isBoundary
        });
      }
      tileGrid.push(row);
    }

    this.tileGrid = tileGrid;
  }
};

module.exports = TERRAINFile;
