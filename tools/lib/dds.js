/**
 * dds.js — WC3 DDS texture decoding, shared by every asset tool.
 *
 * Extracted verbatim from tools/convert-mdx-to-gltf-skinned.js, which carried a
 * note asking for exactly this once a second consumer appeared. That consumer is
 * tools/build-missile-atlas.js. The decode logic is UNCHANGED — the unit
 * exporter's output was verified byte-identical across the move.
 *
 * Handles DXT1 / DXT3 / DXT5 and uncompressed 32-bit BGRA, which covers every
 * texture Reforged ships in the SD tree.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { createCanvas, ImageData } = require('canvas');

function rgb565to888 (c) {
  const r = (c >> 11) & 0x1F, g = (c >> 5) & 0x3F, b = c & 0x1F;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}
function decodeDxt1Block (data, offset, out, width, height, px0, py0, dxt3or5) {
  const c0 = data.readUInt16LE(offset), c1 = data.readUInt16LE(offset + 2);
  const indices = data.readUInt32LE(offset + 4);
  const col0 = rgb565to888(c0), col1 = rgb565to888(c1);
  let col2, col3, alpha3 = 255;
  if (c0 > c1 || dxt3or5) {
    col2 = [Math.round((2 * col0[0] + col1[0]) / 3), Math.round((2 * col0[1] + col1[1]) / 3), Math.round((2 * col0[2] + col1[2]) / 3)];
    col3 = [Math.round((col0[0] + 2 * col1[0]) / 3), Math.round((col0[1] + 2 * col1[1]) / 3), Math.round((col0[2] + 2 * col1[2]) / 3)];
  } else {
    col2 = [Math.round((col0[0] + col1[0]) / 2), Math.round((col0[1] + col1[1]) / 2), Math.round((col0[2] + col1[2]) / 2)];
    col3 = [0, 0, 0]; alpha3 = 0;
  }
  const palette = [col0, col1, col2, col3];
  for (let py = 0; py < 4; py++) {
    const yy = py0 + py; if (yy >= height) continue;
    for (let px = 0; px < 4; px++) {
      const xx = px0 + px; if (xx >= width) continue;
      const idx = (indices >>> ((py * 4 + px) * 2)) & 0x3, c = palette[idx], dst = (yy * width + xx) * 4;
      out[dst] = c[0]; out[dst + 1] = c[1]; out[dst + 2] = c[2];
      if (!dxt3or5) out[dst + 3] = (idx === 3) ? alpha3 : 255;
    }
  }
}
function decodeDxt5AlphaBlock (data, offset, out, width, height, px0, py0) {
  const a0 = data[offset], a1 = data[offset + 1];
  const pal = new Array(8); pal[0] = a0; pal[1] = a1;
  if (a0 > a1) { for (let i = 1; i < 7; i++) pal[i + 1] = Math.round(((7 - i) * a0 + i * a1) / 7); }
  else { for (let i = 1; i < 5; i++) pal[i + 1] = Math.round(((5 - i) * a0 + i * a1) / 5); pal[6] = 0; pal[7] = 255; }
  const lo = data[offset + 2] | (data[offset + 3] << 8) | (data[offset + 4] << 16);
  const hi = data[offset + 5] | (data[offset + 6] << 8) | (data[offset + 7] << 16);
  for (let i = 0; i < 16; i++) {
    const py = i >> 2, px = i & 3, yy = py0 + py, xx = px0 + px;
    if (yy >= height || xx >= width) continue;
    const idx = i < 8 ? (lo >> (i * 3)) & 7 : (hi >> ((i - 8) * 3)) & 7;
    out[(yy * width + xx) * 4 + 3] = pal[idx];
  }
}
function decodeDds (buf) {
  if (buf.length < 128 || buf.toString('ascii', 0, 4) !== 'DDS ') throw new Error('bad DDS');
  const width = buf.readUInt32LE(16), height = buf.readUInt32LE(12);
  const fourcc = buf.toString('ascii', 84, 88), rgbBitCount = buf.readUInt32LE(88);
  const out = new Uint8ClampedArray(width * height * 4);
  const data = buf.slice(128);
  if (fourcc === 'DXT1') {
    let off = 0; for (let by = 0; by < height; by += 4) for (let bx = 0; bx < width; bx += 4) { decodeDxt1Block(data, off, out, width, height, bx, by, false); off += 8; }
    return { width, height, rgba: out };
  }
  if (fourcc === 'DXT5') {
    let off = 0; for (let by = 0; by < height; by += 4) for (let bx = 0; bx < width; bx += 4) { decodeDxt5AlphaBlock(data, off, out, width, height, bx, by); decodeDxt1Block(data, off + 8, out, width, height, bx, by, true); off += 16; }
    return { width, height, rgba: out };
  }
  if (fourcc === 'DXT3') {
    let off = 0; for (let by = 0; by < height; by += 4) for (let bx = 0; bx < width; bx += 4) {
      for (let py = 0; py < 4; py++) { const yy = by + py; if (yy >= height) continue; const rowBytes = data.readUInt16LE(off + py * 2); for (let px = 0; px < 4; px++) { const xx = bx + px; if (xx >= width) continue; const a4 = (rowBytes >> (px * 4)) & 0xF; out[(yy * width + xx) * 4 + 3] = (a4 << 4) | a4; } }
      decodeDxt1Block(data, off + 8, out, width, height, bx, by, true); off += 16;
    }
    return { width, height, rgba: out };
  }
  if (rgbBitCount === 32) {
    for (let i = 0; i < width * height; i++) { const px = data.readUInt32LE(i * 4); out[i * 4] = (px >> 16) & 0xFF; out[i * 4 + 1] = (px >> 8) & 0xFF; out[i * 4 + 2] = px & 0xFF; out[i * 4 + 3] = (px >> 24) & 0xFF; }
    return { width, height, rgba: out };
  }
  throw new Error('unsupported DDS: ' + fourcc);
}
function ddsToPngBuffer (ddsPath) {
  const { width, height, rgba } = decodeDds(fs.readFileSync(ddsPath));
  const canvas = createCanvas(width, height);
  canvas.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas.toBuffer('image/png');
}

// Index every .dds under the given dirs by lowercase basename. First match wins,
// so pass the most specific directory first.
function buildDdsIndex (dirs) {
  const index = {};
  function walk (dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else if (entry.name.toLowerCase().endsWith('.dds')) {
        const base = entry.name.slice(0, -4).toLowerCase();
        if (!index[base]) index[base] = path.join(dir, entry.name);
      }
    }
  }
  for (const d of dirs) walk(d);
  return index;
}

module.exports = { rgb565to888, decodeDds, ddsToPngBuffer, buildDdsIndex };
