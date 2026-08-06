/**
 * build-hero-webp.js — assemble homepage hero pillar media (client/assets/hero/).
 *
 * Why: the homepage hero's "replay simulator" pillar needs a few seconds of
 * real motion (build order panel + minimap) without shipping a heavy video.
 * No ffmpeg/cwebp binary is available on this machine, so this builds the
 * animated WebP directly with sharp: each captured frame is normalized to
 * identical dimensions, stacked into one raw pixel buffer, and encoded as a
 * multi-page WebP via sharp's documented `raw` + `pageHeight` mechanism for
 * animated output. A single chosen frame is separately encoded as the static
 * poster used on mobile / prefers-reduced-motion, where the animated asset is
 * never requested at all (see the <picture> sources in client/index.html).
 *
 * Hard budget (the whole point of doing this instead of a real video
 * capture): animated <= 300KB, poster <= 20KB. This warns loudly, not
 * silently, when either is exceeded — tune --width/--quality/--delay against
 * the warning, the same way tools/optimize-terrain.js's cap/quality were
 * dialed in by eyeballing output size against the source.
 *
 * Usage:
 *   Frame-sequence mode (Pillar 2 — replay simulator loop):
 *     node tools/build-hero-webp.js --in=tools/hero-frames --out=client/assets/hero/simulator-loop.webp \
 *       --poster-out=client/assets/hero/simulator-poster.webp --poster-frame=6 \
 *       --width=800 --height=500 --quality=68 --poster-quality=62 --delay=180
 *
 *   Single-image mode (Pillar 3 — desktop app screenshot, or any one-off crop):
 *     node tools/build-hero-webp.js --single=tools/hero-frames/desktop-raw.png \
 *       --out=client/assets/hero/desktop-preview.webp --width=800 --height=500 --quality=70
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

const WIDTH = parseInt(args.width, 10) || 800;
const HEIGHT = parseInt(args.height, 10) || 500;
const QUALITY = parseInt(args.quality, 10) || 68;
const POSTER_QUALITY = parseInt(args['poster-quality'], 10) || QUALITY;
const DELAY = parseInt(args.delay, 10) || 160;

const ANIMATED_BUDGET = 300 * 1024;
const POSTER_BUDGET = 20 * 1024;

// --crop=x,y,w,h in SOURCE pixels, applied before the resize. A full-page
// capture squeezed into a short wide tile is unreadable at tile size (that is
// exactly what user testing called "not previews, texture"), and `fit: cover`
// only ever center-crops. This picks the region that actually carries the
// story — the build order beside the map, one legible build card — instead.
const CROP = (() => {
  if (typeof args.crop !== 'string') return null;
  const p = args.crop.split(',').map(n => parseInt(n, 10));
  if (p.length !== 4 || p.some(n => !Number.isFinite(n))) {
    console.error('--crop must be x,y,w,h in source pixels');
    process.exit(1);
  }
  return { left: p[0], top: p[1], width: p[2], height: p[3] };
})();

const fmtKB = (n) => (n / 1024).toFixed(1) + ' KB';

/** sharp pipeline for one source image: optional extract, then resize. */
function framePipeline (input, width, height) {
  let img = sharp(input);
  if (CROP) img = img.extract(CROP);
  return img.resize(width, height, { fit: 'cover' });
}

function warnBudget (label, bytes, budget) {
  const kb = fmtKB(bytes);
  if (bytes > budget) {
    console.warn(`  ⚠ ${label}: ${kb} EXCEEDS the ${fmtKB(budget)} budget — lower --width/--quality, or fewer frames.`);
  } else {
    console.log(`  ${label}: ${kb} (budget ${fmtKB(budget)})`);
  }
}

async function buildSingle (inputPath, outPath, width, height, quality) {
  const buf = await framePipeline(inputPath, width, height)
    .webp({ quality })
    .toBuffer();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return buf.length;
}

async function buildAnimated (inDir, outPath, posterOutPath, posterFrameIndex, width, height, quality, posterQuality, delayMs, stride) {
  let files = fs.readdirSync(inDir)
    .filter(f => /^frame-\d+\.png$/i.test(f))
    .sort();
  if (!files.length) throw new Error(`No frame-NNN.png files found in ${inDir}`);
  if (stride > 1) files = files.filter((_, i) => i % stride === 0);

  // Every frame normalized to identical dimensions — `join` requires it.
  const frameBufs = await Promise.all(
    files.map(f => framePipeline(path.join(inDir, f), width, height).png().toBuffer())
  );

  const delays = new Array(files.length).fill(delayMs);

  // `join: { animated: true }` is what actually pages the frames. Stacking
  // raw bytes and hoping a pageHeight option splits them does NOT work:
  // pageHeight is ignored on .webp() output, and ignored again as a raw-input
  // option, and either way you get one tall image with the frames stacked.
  // That still writes, still looks correct inside any fixed-height
  // object-fit box, and only reveals itself as a filmstrip once something
  // renders it at its natural height. Hence the assertion below — the
  // failure is completely invisible at the point it happens.
  const animatedBuf = await sharp(frameBufs, { join: { animated: true } })
    .webp({ loop: 0, delay: delays, quality })
    .toBuffer();

  const meta = await sharp(animatedBuf, { animated: true }).metadata();
  if ((meta.pages || 1) !== files.length) {
    throw new Error(
      `Wrote a ${meta.pages || 1}-page WebP from ${files.length} frames — not animated. ` +
      'Frames were stacked into one tall image instead of paged.'
    );
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, animatedBuf);
  console.log(`  ${files.length} frames, ${delayMs}ms/frame (~${(files.length * delayMs / 1000).toFixed(1)}s loop) -> ${path.relative(ROOT, outPath)}`);
  console.log(`  verified: ${meta.pages} pages, ${meta.width}x${meta.pageHeight}`);
  warnBudget('animated', animatedBuf.length, ANIMATED_BUDGET);

  if (posterOutPath) {
    const posterIndex = Math.min(Math.max(posterFrameIndex, 0), files.length - 1);
    const posterFile = path.join(inDir, files[posterIndex]);
    const posterBytes = await buildSingle(posterFile, posterOutPath, width, height, posterQuality);
    console.log(`  poster frame ${files[posterIndex]} -> ${path.relative(ROOT, posterOutPath)}`);
    warnBudget('poster', posterBytes, POSTER_BUDGET);
  }
}

async function main () {
  if (args.single) {
    const inputPath = path.resolve(ROOT, String(args.single));
    const outPath = path.resolve(ROOT, String(args.out || 'client/assets/hero/output.webp'));
    const bytes = await buildSingle(inputPath, outPath, WIDTH, HEIGHT, QUALITY);
    console.log(`${path.relative(ROOT, inputPath)} -> ${path.relative(ROOT, outPath)}`);
    warnBudget('image', bytes, POSTER_BUDGET);
    return;
  }

  if (args.in) {
    const inDir = path.resolve(ROOT, String(args.in));
    const outPath = path.resolve(ROOT, String(args.out || 'client/assets/hero/loop.webp'));
    const posterOutPath = args['poster-out'] ? path.resolve(ROOT, String(args['poster-out'])) : null;
    const posterFrameIndex = parseInt(args['poster-frame'], 10) || 0;
    const stride = parseInt(args.stride, 10) || 1;
    await buildAnimated(inDir, outPath, posterOutPath, posterFrameIndex, WIDTH, HEIGHT, QUALITY, POSTER_QUALITY, DELAY, stride);
    return;
  }

  console.error('Usage:');
  console.error('  node tools/build-hero-webp.js --in=DIR --out=FILE [--poster-out=FILE] [--poster-frame=N] [--width=800] [--height=500] [--quality=68] [--poster-quality=62] [--delay=160] [--stride=1] [--crop=x,y,w,h]');
  console.error('  node tools/build-hero-webp.js --single=FILE --out=FILE [--width=800] [--height=500] [--quality=70] [--crop=x,y,w,h]');
  process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
