/**
 * NOTICE: 
 * translated to js from https://github.com/ChiefOfGxBxL/WC3MapTranslator/blob/016425a85fc7682e1883e662f4357dae1e65269a/lib/W3Buffer.ts
 * used for researching and learning purposes only.  all copyright andd rights reserved to the owner under MIT license.
 **/

const W3Buffer = class {
    constructor(buffer) {
        this._offset = 0;
        this._buffer = buffer;
    }

    readInt() {
        const num = this._buffer.readInt32LE(this._offset, 4);
        this._offset += 4;
        return num;
    }

    readShort() {
        const num = this._buffer.readInt16LE(this._offset);
        this._offset += 2;
        return num;
    }

    readFloat() {
        const num = this._buffer.readFloatLE(this._offset);
        this._offset += 4;
        return num;
    }

    readString() {
        const string = [];

        while (this._buffer[this._offset] !== 0x00) {
            string.push(this._buffer[this._offset]);
            this._offset += 1;
        }
        this._offset += 1; // consume the \0 end-of-string delimiter

        return string.map((ch) => {
            return String.fromCharCode(ch);
        }).join('');
    }

    readChars(len = 1) {
        const string = [];
        const numCharsToRead = len || 1;

        for (let i = 0; i < numCharsToRead; i++) {
            string.push(this._buffer[this._offset]);
            this._offset += 1;
        }

        return string.map((ch) => {
            if (ch === 0x0) return '0';
            return String.fromCharCode(ch);
        }).join('');
    }

    readByte() {
      const val = this._buffer.readUInt8(this._offset, 1);
      this._offset += 1;
      return val;
    }

    isExhausted() {
        return this._offset === this._buffer.length;
    }
};

module.exports = W3Buffer;
