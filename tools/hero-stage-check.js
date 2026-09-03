/**
 * hero-stage-check.js — drive the homepage's animated race picker for real.
 *
 * page-audit.js checks the page's shape and home-probe.js measures its bands.
 * This one asserts the two claims the hero stage actually makes:
 *
 *   1. It never costs the page anything. three.js is not in the HTML, and
 *      neither it nor a single .glb is requested until after first paint.
 *      The models then load one at a time, so the first hero is standing
 *      there while the rest are still on the wire.
 *   2. The picker is the buttons, not the canvas. Clicking or pressing Enter
 *      on a slot filters the build library, a second press clears it, and
 *      every way the stage can fail leaves those buttons working.
 *
 * By default client/ is served by request interception, the way page-audit.js
 * does it, so this needs no server. Pass --base to drive a server that is
 * already up instead, which exercises the real serving path. The CDN goes out
 * for real either way, because the whole point of check 1 is WHEN three.js is
 * fetched.
 *
 * Headless Chrome reports no WebGL unless it is asked for software GL, so
 * this launches with the same ANGLE/SwiftShader flags tools/fx-bench.js uses.
 * That is also why the timeouts are generous: SwiftShader is slow, and slow
 * is the point: it is the same pixels on every machine.
 *
 * Usage:
 *   node tools/hero-stage-check.js
 *   node tools/hero-stage-check.js --base=http://127.0.0.1:8080
 *   node tools/hero-stage-check.js --shots
 *   node tools/hero-stage-check.js --mode=narrow      # expect off/narrow
 *   node tools/hero-stage-check.js --mode=no-cdn      # expect off/cdn
 *   node tools/hero-stage-check.js --mode=reduced     # expect off/reduced-motion
 *   node tools/hero-stage-check.js --mode=all
 *
 * Exit 1 when anything failed.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const CLIENT = path.join(ROOT, 'client');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
];
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary'
};

const SHOTS_DIR = path.resolve(ROOT, String(args['shots-dir'] || 'client/review/home'));
// When a server is already up, drive that instead of intercepting.
const BASE = args.base ? String(args.base).replace(/\/$/, '') : null;
const PAGE_URL = (BASE || 'https://wc3v.local') + '/index.html';
const READY_MS = Number(args.timeout || 40000);

const fails = [];
const ok = (label) => console.log('  ok    ' + label);
const bad = (label, detail) => { fails.push(label); console.log('  FAIL  ' + label + (detail ? '\n          ' + detail : '')); };

function launch (extraFlags) {
  return puppeteer.launch({
    executablePath: BROWSERS.find(p => fs.existsSync(p)),
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      // Software WebGL: same pixels on any machine and in CI.
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader'
    ].concat(extraFlags || [])
  });
}

// Serve client/ off disk. `blockCdn` is how the "CDN is unreachable" mode is
// simulated: three.js fails to load and the stage has to fall back cleanly.
function serve (page, opts) {
  const seen = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (BASE) {
      seen.push({ url: r.url(), t: Date.now() });
      if (opts.blockCdn && /jsdelivr|cdnjs|unpkg/.test(u.hostname)) return r.abort();
      return r.continue();
    }
    if (u.hostname === 'wc3v.local') {
      const rel = decodeURIComponent(u.pathname).replace(/^\//, '') || 'index.html';
      const file = path.join(CLIENT, rel);
      seen.push({ url: rel, t: Date.now() });
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        return r.respond({
          status: 200,
          contentType: MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          body: fs.readFileSync(file)
        });
      }
      return r.respond({ status: 404, body: 'not found' });
    }
    seen.push({ url: r.url(), t: Date.now() });
    if (opts.blockCdn && /jsdelivr|cdnjs|unpkg/.test(u.hostname)) return r.abort();
    r.continue();
  });
  return seen;
}

// ── the full path: models load, the picker drives the library ──────────────
async function checkReady () {
  console.log('\n── ready ' + '─'.repeat(46));
  const browser = await launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // Record when the page first painted, so "after first paint" is measured
  // rather than assumed.
  await page.evaluateOnNewDocument(() => {
    window.__marks = { dcl: null };
    document.addEventListener('DOMContentLoaded', () => { window.__marks.dcl = performance.now(); });
  });

  await page.setRequestInterception(true);
  const seen = serve(page, {});

  // three.js must not be in the served HTML at all. With a server up, that
  // means what the SERVER sends, not what is on disk.
  const html = BASE
    ? await (await fetch(PAGE_URL)).text()
    : fs.readFileSync(path.join(CLIENT, 'index.html'), 'utf8');
  const staticThree = /<script[^>]+src="[^"]*three[^"]*"/i.test(html);
  if (staticThree) bad('three.js is a static <script> in index.html');
  else ok('three.js is not in the HTML');

  const t0 = Date.now();
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });

  let state = null;
  try {
    await page.waitForSelector('#hero-stage[data-state="ready"]', { timeout: READY_MS });
    await page.waitForFunction(
      () => document.querySelectorAll('.hp-stage-slot.is-loaded').length === 4,
      { timeout: READY_MS });
    state = 'ready';
  } catch (e) {
    state = await page.$eval('#hero-stage', el => el.getAttribute('data-state') + '/' + (el.getAttribute('data-reason') || ''));
  }

  const loaded = await page.$$eval('.hp-stage-slot.is-loaded', els => els.length);
  if (loaded === 4) ok('all 4 heroes on the canvas');
  else bad('only ' + loaded + ' of 4 heroes loaded', 'stage state: ' + state);

  // Timing: nothing 3D before first paint, and the .glb requests are serial.
  const timing = await page.evaluate(() => {
    const fcp = (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || null;
    const first = (performance.getEntriesByName('wc3v:hero-stage:first-model')[0] || {}).startTime || null;
    const three = performance.getEntriesByType('resource')
      .filter(r => /three(\.min)?\.js/.test(r.name))
      .map(r => r.startTime);
    const glbs = performance.getEntriesByType('resource')
      .filter(r => /\.glb/.test(r.name))
      .map(r => ({ name: r.name.split('/').pop().split('?')[0], start: r.startTime, end: r.responseEnd }))
      .sort((a, b) => a.start - b.start);
    return { fcp, first, three, glbs, dcl: window.__marks.dcl };
  });

  if (!timing.three.length) {
    bad('three.js was never requested', 'the stage cannot have rendered');
  } else if (timing.fcp && timing.three[0] > timing.fcp) {
    ok('three.js requested after first paint (' + Math.round(timing.fcp) + 'ms paint, ' +
       Math.round(timing.three[0]) + 'ms fetch)');
  } else {
    bad('three.js requested before first paint',
        'paint ' + Math.round(timing.fcp) + 'ms, fetch ' + Math.round(timing.three[0]) + 'ms');
  }

  if (timing.glbs.length >= 2) {
    // Serial means each fetch starts after the one before it finished. A
    // little slop, because a same-tick start is still serial in effect.
    const overlaps = timing.glbs.slice(1).filter((g, i) => g.start < timing.glbs[i].end - 50);
    if (!overlaps.length) ok('models load one at a time (' + timing.glbs.map(g => g.name.replace('.glb', '')).join(' -> ') + ')');
    else bad(overlaps.length + ' model(s) fetched in parallel', overlaps.map(o => o.name).join(', '));
  }
  if (timing.first) console.log('        first hero on screen at ' + Math.round(timing.first) + 'ms');
  console.log('        total ' + ((Date.now() - t0) / 1000).toFixed(1) + 's under software GL');

  // ── the picker ──────────────────────────────────────────────────────────
  const before = await page.$eval('#pfb-count', el => el.textContent.trim());
  await page.click('.hp-stage-slot[data-race="O"]');
  await new Promise(r => setTimeout(r, 400));
  const picked = await page.evaluate(() => ({
    pressed: document.querySelector('.hp-stage-slot[data-race="O"]').getAttribute('aria-pressed'),
    selected: document.getElementById('hero-stage').getAttribute('data-selected'),
    heroRace: document.querySelector('.hp-hero').getAttribute('data-race'),
    buildsRace: document.getElementById('builds').getAttribute('data-race'),
    agent: window.WC3VHome && window.WC3VHome.getRace(),
    count: document.getElementById('pfb-count').textContent.trim(),
    matchups: !document.getElementById('matchup-section').hidden
  }));
  const pickOk = picked.pressed === 'true' && picked.selected === 'O' &&
                 picked.agent === 'O' && picked.count !== before;
  if (pickOk) ok('clicking Orc filters the library and marks the slot (' + before + ' -> ' + picked.count + ')');
  else bad('clicking a hero did not filter', JSON.stringify(picked) + ' was "' + before + '"');

  if (picked.heroRace === 'O' && picked.buildsRace === 'O') ok('the race mood follows the pick');
  else bad('the race mood did not follow', 'hero=' + picked.heroRace + ' builds=' + picked.buildsRace);

  if (picked.matchups) ok('the matchup row appears with a race picked');
  else bad('the matchup row stayed hidden');

  // Keyboard, on a different slot, and the toggle-off.
  await page.focus('.hp-stage-slot[data-race="U"]');
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 300));
  const kb = await page.evaluate(() => window.WC3VHome.getRace());
  if (kb === 'U') ok('Enter on a focused slot picks that race');
  else bad('keyboard pick did not take', 'race is "' + kb + '"');

  await page.click('.hp-stage-slot[data-race="U"]');
  await new Promise(r => setTimeout(r, 300));
  const cleared = await page.evaluate(() => ({
    race: window.WC3VHome.getRace(),
    selected: document.getElementById('hero-stage').getAttribute('data-selected'),
    matchups: !document.getElementById('matchup-section').hidden
  }));
  if (cleared.race === '' && cleared.selected === '' && !cleared.matchups) ok('clicking the picked hero again clears the filter');
  else bad('the pick did not clear', JSON.stringify(cleared));

  if (errors.length) bad('page errors', [...new Set(errors)].slice(0, 4).join(' | '));
  else ok('no page errors');

  if (args.shots) {
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    const band = await page.$('#hero-stage');
    await band.screenshot({ path: path.join(SHOTS_DIR, 'stage-band.png') });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOTS_DIR, 'stage-fold.png') });
    console.log('        shots in ' + path.relative(ROOT, SHOTS_DIR));
  }

  await browser.close();
}

// ── the fallback paths: the picker still works, nothing 3D is fetched ──────
async function checkOff (label, opts) {
  console.log('\n── ' + label + ' ' + '─'.repeat(50 - label.length));
  const browser = await launch(opts.noGl ? [] : null);
  const page = await browser.newPage();
  await page.setViewport(opts.viewport || { width: 1280, height: 800, deviceScaleFactor: 1 });
  if (opts.reducedMotion) {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  }
  await page.setRequestInterception(true);
  serve(page, { blockCdn: !!opts.blockCdn });

  await page.goto(PAGE_URL, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, opts.wait || 4000));

  const st = await page.evaluate(() => {
    const el = document.getElementById('hero-stage');
    return {
      state: el.getAttribute('data-state'),
      reason: el.getAttribute('data-reason'),
      loaded: document.querySelectorAll('.hp-stage-slot.is-loaded').length,
      // The portraits are the picker in every one of these modes, so they
      // have to be painted, not merely present.
      portraits: [...document.querySelectorAll('.hp-stage-portrait')]
        .filter(i => i.getBoundingClientRect().width > 0).length,
      threeFetched: performance.getEntriesByType('resource').some(r => /three(\.min)?\.js/.test(r.name)),
      glbFetched: performance.getEntriesByType('resource').some(r => /\.glb/.test(r.name))
    };
  });

  if (st.state === 'off' && st.reason === opts.expect) ok('stage is off/' + st.reason);
  else bad('expected off/' + opts.expect, 'got ' + st.state + '/' + st.reason);

  if (st.portraits === 4) ok('all 4 portraits painted');
  else bad('only ' + st.portraits + ' of 4 portraits painted');

  if (!st.glbFetched) ok('no models fetched');
  else bad('models were fetched anyway');

  if (opts.expect !== 'cdn' && !st.threeFetched) ok('three.js not fetched');
  else if (opts.expect === 'cdn') ok('three.js attempted and failed, as set up');

  // The buttons still have to filter.
  const before = await page.$eval('#pfb-count', el => el.textContent.trim());
  await page.click('.hp-stage-slot[data-race="E"]');
  await new Promise(r => setTimeout(r, 400));
  const after = await page.evaluate(() => ({
    race: window.WC3VHome.getRace(),
    count: document.getElementById('pfb-count').textContent.trim()
  }));
  if (after.race === 'E' && after.count !== before) ok('the picker still filters (' + before + ' -> ' + after.count + ')');
  else bad('the picker stopped working in fallback', JSON.stringify(after));

  await browser.close();
}

(async () => {
  const mode = String(args.mode || 'ready');
  if (mode === 'ready' || mode === 'all') await checkReady();
  if (mode === 'narrow' || mode === 'all') {
    await checkOff('narrow', { expect: 'narrow', viewport: { width: 430, height: 900, deviceScaleFactor: 1 } });
  }
  if (mode === 'reduced' || mode === 'all') {
    await checkOff('reduced motion', { expect: 'reduced-motion', reducedMotion: true });
  }
  if (mode === 'no-cdn' || mode === 'all') {
    await checkOff('cdn blocked', { expect: 'cdn', blockCdn: true, wait: 6000 });
  }

  console.log('\n' + (fails.length ? fails.length + ' FAILED' : 'all checks passed'));
  process.exit(fails.length ? 1 : 0);
})();
