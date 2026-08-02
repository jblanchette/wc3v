/**
 * gzip-walkmaps.js — write walkmap.json.gz beside every client/maps/X/walkmap.json.
 *
 * Why: the viewer fetches the walkmap to build its terrain index (blocked
 * cells for bloom/formation), but walkmap.json was never deployed to R2 —
 * deploy-assets.js's maps groups only match heights.bin.gz / *.json.gz /
 * *.jpg — so production 404'd and silently lost all WPM blocked-cell data.
 * Gzipping them makes the existing `maps-mutable-json` group (glob
 * "star/star.json.gz") pick them up automatically, with
 * Content-Encoding: gzip on upload.
 *
 * Usage:
 *   node tools/gzip-walkmaps.js            — gzip stale/missing outputs only
 *   node tools/gzip-walkmaps.js --force    — regenerate all
 *
 * Deploy afterwards with: node tools/deploy-assets.js --only=maps-mutable-json
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MAPS = path.join(__dirname, '..', 'client', 'maps');
const force = process.argv.includes('--force');

let written = 0, upToDate = 0, absent = 0;
for (const entry of fs.readdirSync(MAPS, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const src = path.join(MAPS, entry.name, 'walkmap.json');
  if (!fs.existsSync(src)) { absent++; continue; }
  const out = src + '.gz';
  if (!force && fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs) {
    upToDate++;
    continue;
  }
  fs.writeFileSync(out, zlib.gzipSync(fs.readFileSync(src), { level: 9 }));
  written++;
}

console.log(`walkmap.json.gz: ${written} written, ${upToDate} up-to-date, ${absent} maps have no walkmap.json`);
