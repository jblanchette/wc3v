/**
 * gen-home-tiles.js — cut the homepage's ground tiles out of the real WC3
 * tileset textures.
 *
 * The homepage hero band is a patch of Warcraft III ground, and the four race
 * slots each stand on their own tileset. The source art for that already ships
 * with the site: client/assets/terrain/<tileset letter>/<id>.png, the same
 * textures the 3D map paints its terrain with.
 *
 * Those files are 512x256 atlases: an 8x4 grid of 64px cells. The LEFT four
 * columns are the blend/edge variants and carry transparent cutouts, so they
 * cannot tile. The RIGHT four columns are the plain terrain, each cell
 * individually seamless with itself. This takes one clean cell per tileset and
 * writes it as a small standalone tile the CSS can `repeat`.
 *
 * Output goes to client/assets/textures/home/, which is gitignored and shipped
 * to R2 like every other game texture:
 *
 *   node tools/gen-home-tiles.js
 *   node tools/deploy-assets.js --only=textures
 *
 * Flags:
 *   --size=N   output edge in px (default 128; the source cell is 64)
 *   --check    report what would be written, write nothing
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'client', 'assets', 'terrain');
const OUT = path.join(ROOT, 'client', 'assets', 'textures', 'home');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});
const SIZE = Number(args.size || 128);

// One tileset per race zone, picked for the mood the zone reads as rather than
// for what that race builds on in game: Lordaeron summer for Human, Barrens
// dirt for Orc, Ashenvale for Night Elf, Northrend snow for Undead. `cell` is
// [col,row] in the atlas's 8x4 grid; columns 4-7 are the tileable half.
const TILES = [
  { out: 'tile-h.png',    src: 'L/Lgrs.png', cell: [4, 0] },  // Lordaeron summer grass
  { out: 'tile-o.png',    src: 'B/Bdrt.png', cell: [4, 0] },  // Barrens dirt
  { out: 'tile-e.png',    src: 'A/Agrs.png', cell: [4, 0] },  // Ashenvale grass
  { out: 'tile-u.png',    src: 'N/Nsnw.png', cell: [4, 0] },  // Northrend snow
  { out: 'tile-base.png', src: 'L/Ldrt.png', cell: [4, 0] }   // neutral dirt, no race picked
];

const CELL = 64;

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error('no terrain textures on disk at ' + SRC);
    console.error('they are gitignored and R2-only. Pull them before running this.');
    process.exit(2);
  }
  if (!args.check) fs.mkdirSync(OUT, { recursive: true });

  for (const t of TILES) {
    const file = path.join(SRC, t.src);
    if (!fs.existsSync(file)) { console.log('  skip  ' + t.src + ' (not on disk)'); continue; }
    const meta = await sharp(file).metadata();
    if (meta.width !== 512 || meta.height !== 256) {
      console.log('  skip  ' + t.src + ' (' + meta.width + 'x' + meta.height + ', not an 8x4 atlas)');
      continue;
    }
    const buf = await sharp(file)
      .extract({ left: t.cell[0] * CELL, top: t.cell[1] * CELL, width: CELL, height: CELL })
      .resize(SIZE, SIZE, { kernel: 'lanczos3' })
      .png({ compressionLevel: 9, palette: true })
      .toBuffer();
    const dest = path.join(OUT, t.out);
    if (args.check) console.log('  would write ' + t.out + '  ' + Math.round(buf.length / 1024) + ' KB  from ' + t.src);
    else {
      fs.writeFileSync(dest, buf);
      console.log('  ' + t.out + '  ' + Math.round(buf.length / 1024) + ' KB  from ' + t.src);
    }
  }
  console.log('\n' + (args.check ? 'check only, nothing written' : 'written to client/assets/textures/home/'));
})();
