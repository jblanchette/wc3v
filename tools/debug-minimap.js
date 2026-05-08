/*
  Debug helper for the BLP-based minimap path.
  Decodes mapdata/{name}/war3mapMap.blp via war3-model and writes:
    - debug/{name}-blp-native.png   raw decoder output, original BLP resolution
    - debug/{name}-blp-rb-swap.png  same data but with R and B channels swapped
  Lets us verify whether war3-model returns RGBA or BGRA so we know if
  helpers/minimapRenderer.js needs a channel swap.

  Usage:
    node tools/debug-minimap.js --map=Springtime_v1.1
*/

const fs = require('fs');
const path = require('path');
const { createCanvas, ImageData } = require('canvas');
const { decodeBLP, getBLPImageData } = require('war3-model');

function args () {
  const out = {};
  process.argv.slice(2).forEach(a => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  });
  return out;
}

function main () {
  const { map } = args();
  if (!map) { console.error('--map=NAME required'); process.exit(1); }
  const blpPath = path.join('mapdata', map, 'war3mapMap.blp');
  if (!fs.existsSync(blpPath)) { console.error(`missing ${blpPath}`); process.exit(1); }

  const buf = fs.readFileSync(blpPath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const blp = decodeBLP(ab);
  const img = getBLPImageData(blp, 0);

  console.log(`BLP ${blpPath}: ${blp.width}x${blp.height}, mips=${blp.mipmaps.length}, dataLen=${img.data.length}`);
  console.log(`  expected pixels=${blp.width * blp.height * 4}, actual=${img.data.length}`);

  if (!fs.existsSync('debug')) fs.mkdirSync('debug');

  // Native order
  {
    const c = createCanvas(blp.width, blp.height);
    const data = new Uint8ClampedArray(img.data);
    c.getContext('2d').putImageData(new ImageData(data, blp.width, blp.height), 0, 0);
    const p = `debug/${map}-blp-native.png`;
    fs.writeFileSync(p, c.toBuffer('image/png'));
    console.log(`  wrote ${p}`);
  }

  // R/B swap (BGRA → RGBA test)
  {
    const swapped = new Uint8ClampedArray(img.data.length);
    for (let i = 0; i < img.data.length; i += 4) {
      swapped[i + 0] = img.data[i + 2];   // R ← B
      swapped[i + 1] = img.data[i + 1];
      swapped[i + 2] = img.data[i + 0];   // B ← R
      swapped[i + 3] = img.data[i + 3];
    }
    const c = createCanvas(blp.width, blp.height);
    c.getContext('2d').putImageData(new ImageData(swapped, blp.width, blp.height), 0, 0);
    const p = `debug/${map}-blp-rb-swap.png`;
    fs.writeFileSync(p, c.toBuffer('image/png'));
    console.log(`  wrote ${p}`);
  }
}

main();
