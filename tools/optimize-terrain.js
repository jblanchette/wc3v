/**
 * optimize-terrain.js — write terrain.webp beside every client/maps/X/terrain.jpg.
 *
 * Why: terrain.jpg is the single largest download of a viewer session —
 * 2.4–110 MB per map (avg ~28 MB, 5.5 GB across 201 maps), and the biggest
 * maps (14336²) exceed MAX_TEXTURE_SIZE on many GPUs. This tool caps the
 * longest edge at --cap and re-encodes as WebP.
 *
 * Defaults (cap 6144, quality 78) were chosen by eyeballing simulated
 * closest-zoom crops of Springtime (8192² source): 6144/q78 is visually
 * near-identical to the source at 70% fewer bytes (36.3 -> 10.9 MB), while
 * 4096 (86% fewer) reads noticeably soft on grass detail. Quality barely
 * moves the size at a given resolution (q65 vs q80 at 8192 is ~1 MB) —
 * resolution is the lever. Mobile never loads 3D terrain, so mobile GPU
 * texture limits don't apply; 6144² also trims VRAM (~201 MB with mips
 * vs ~357 MB at 8192²).
 *
 * The client (ThreeMapRenderer.loadTerrainTexture) fetches terrain.webp
 * first and falls back to terrain.jpg, so this is safe to roll out
 * incrementally — maps without a .webp keep working.
 *
 * Usage:
 *   node tools/optimize-terrain.js                 — all maps, skip up-to-date outputs
 *   node tools/optimize-terrain.js --only=NAME     — a single map dir
 *   node tools/optimize-terrain.js --cap=6144      — max edge in px (default 6144)
 *   node tools/optimize-terrain.js --quality=78    — WebP quality (default 78)
 *   node tools/optimize-terrain.js --force         — regenerate even if up to date
 *
 * Deploy afterwards with: node tools/deploy-assets.js --only=maps-mutable-webp
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const MAPS = path.join(__dirname, '..', 'client', 'maps');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});
const CAP = parseInt(args.cap, 10) || 6144;
const QUALITY = parseInt(args.quality, 10) || 78;
const only = (args.only && args.only !== true) ? String(args.only) : null;
const force = !!args.force;

const fmtMB = (n) => (n / (1024 * 1024)).toFixed(2) + ' MB';

async function main () {
  const dirs = fs.readdirSync(MAPS, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .filter(name => !only || name === only);

  let done = 0, skipped = 0, absent = 0;
  let bytesIn = 0, bytesOut = 0;

  for (const name of dirs) {
    const src = path.join(MAPS, name, 'terrain.jpg');
    if (!fs.existsSync(src)) { absent++; continue; }
    const out = path.join(MAPS, name, 'terrain.webp');
    if (!force && fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs) {
      skipped++;
      continue;
    }

    const srcSize = fs.statSync(src).size;
    const img = sharp(src, { limitInputPixels: false });
    const meta = await img.metadata();
    const edge = Math.max(meta.width || 0, meta.height || 0);

    let pipeline = img;
    if (edge > CAP) pipeline = pipeline.resize({ width: CAP, height: CAP, fit: 'inside' });
    const buf = await pipeline.webp({ quality: QUALITY }).toBuffer();
    fs.writeFileSync(out, buf);

    bytesIn += srcSize;
    bytesOut += buf.length;
    done++;
    console.log(
      `${name}: ${meta.width}x${meta.height}${edge > CAP ? ` -> ${CAP}` : ''}  ` +
      `${fmtMB(srcSize)} -> ${fmtMB(buf.length)}`
    );
  }

  console.log(`\nterrain.webp: ${done} written, ${skipped} up-to-date, ${absent} maps without terrain.jpg`);
  if (done) console.log(`total: ${fmtMB(bytesIn)} jpg -> ${fmtMB(bytesOut)} webp (${Math.round((1 - bytesOut / bytesIn) * 100)}% smaller)`);
}

main().catch(err => { console.error(err); process.exit(1); });
