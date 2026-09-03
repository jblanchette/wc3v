/**
 * home-probe.js — measure the homepage's fold, band by band.
 *
 * page-audit.js answers "does the page still obey its rules". This answers
 * "where is everything", which is the question a layout pass actually has:
 * the height of each band above the grid, the top of the first card row, and
 * whether a named element rendered at all.
 *
 * Two ways to reach the page. By default it serves client/ off disk through
 * request interception, the way page-audit.js does, so it never needs a
 * server. Pass --base to point it at one that is already running instead:
 * that exercises the real serving path, including the redirects and MIME
 * types interception papers over.
 *
 * Usage:
 *   node tools/home-probe.js
 *   node tools/home-probe.js --base=http://127.0.0.1:8080
 *   node tools/home-probe.js --width=1920x1080
 *   node tools/home-probe.js --sel=.hp-drop,.hp-stage
 *   node tools/home-probe.js --gl          # software WebGL, for the hero stage
 *   node tools/home-probe.js --shot=client/review/home/probe.png
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

// The bands the fold is made of, top to bottom, plus the things inside them
// a redesign is most likely to break.
const DEFAULT_SEL = [
  '#site-nav', '.tos-banner', '.hp-hero', '.hp-hero-inner', '.hp-hero-tagline',
  '.hp-hero-sub', '.hp-drop', '#hero-upload-card', '.hp-hero-bands', '.hp-stage',
  '.hp-stage-slots', '.hp-stage-slot', '.hp-stage-plate', 'main.site-content',
  '.site-pros-head', '.hp-toolbar', '#all-builds-grid', '.site-build-card',
  '.hp-pillars', '.site-mine'
];

(async () => {
  const [w, h] = String(args.width || '1280x800').split('x').map(Number);
  const sels = args.sel ? String(args.sel).split(',') : DEFAULT_SEL;

  const flags = ['--no-sandbox', '--disable-dev-shm-usage'];
  // Headless Chrome reports no WebGL by default, so the hero stage would sit
  // in its fallback. Software GL renders the same pixels on any machine.
  if (args.gl) flags.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');

  const browser = await puppeteer.launch({
    executablePath: BROWSERS.find(p => fs.existsSync(p)),
    headless: true,
    args: flags
  });
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });

  const missing = [];
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const base = args.base ? String(args.base).replace(/\/$/, '') : null;
  if (base) {
    // A real server is answering, so anything that 404s is a real 404.
    page.on('response', (r) => { if (r.status() >= 400) missing.push(new URL(r.url()).pathname + ' HTTP ' + r.status()); });
  } else {
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.hostname === 'wc3v.local') {
        const rel = decodeURIComponent(u.pathname).replace(/^\//, '') || 'index.html';
        const file = path.join(CLIENT, rel);
        if (fs.existsSync(file) && fs.statSync(file).isFile()) {
          return r.respond({
            status: 200,
            contentType: MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
            body: fs.readFileSync(file)
          });
        }
        missing.push(rel);
        return r.respond({ status: 404, body: 'not found' });
      }
      r.continue();
    });
  }

  const url = (base || 'https://wc3v.local') + '/' + String(args.page || 'index.html');
  console.log('\n  ' + url);
  await page.goto(url, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, Number(args.wait || 1200)));

  const rows = await page.evaluate((selectors) => {
    return selectors.map(sel => {
      const el = document.querySelector(sel);
      if (!el) return { sel, state: 'ABSENT' };
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        sel,
        state: (cs.display === 'none' ? 'display:none' : (r.width && r.height ? 'ok' : 'zero-size')),
        top: Math.round(r.top + window.scrollY),
        h: Math.round(r.height),
        w: Math.round(r.width),
        n: document.querySelectorAll(sel).length
      };
    });
  }, sels);

  // A DOMStringMap does not survive evaluate(), so read the attributes.
  const page_ = await page.evaluate(() => {
    const st = document.getElementById('hero-stage');
    return {
      height: document.documentElement.scrollHeight,
      state: st ? st.getAttribute('data-state') : null,
      reason: st ? st.getAttribute('data-reason') : null,
      selected: st ? st.getAttribute('data-selected') : null,
      loaded: document.querySelectorAll('.hp-stage-slot.is-loaded').length,
      firstModelMs: (performance.getEntriesByName('wc3v:hero-stage:first-model')[0] || {}).startTime || null
    };
  });

  console.log('\n  ' + w + 'x' + h + '   page ' + page_.height + 'px' +
              (page_.state
                ? '   stage=' + page_.state + (page_.reason ? '/' + page_.reason : '') +
                  '  models=' + page_.loaded + '/4' +
                  (page_.firstModelMs ? '  first=' + Math.round(page_.firstModelMs) + 'ms' : '') +
                  (page_.selected ? '  race=' + page_.selected : '')
                : ''));
  console.log('  ' + 'selector'.padEnd(24) + 'top'.padStart(6) + 'height'.padStart(8) +
              'width'.padStart(7) + '  n  state');
  for (const r of rows) {
    if (r.state === 'ABSENT') { console.log('  ' + r.sel.padEnd(24) + '     -       -      -  0  ABSENT'); continue; }
    const fold = r.top < h ? '' : '   (below fold)';
    console.log('  ' + r.sel.padEnd(24) + String(r.top).padStart(6) + String(r.h).padStart(8) +
                String(r.w).padStart(7) + String(r.n).padStart(3) + '  ' + r.state + fold);
  }
  if (missing.length) console.log('\n  missing assets: ' + [...new Set(missing)].slice(0, 12).join(', '));
  if (errors.length) console.log('\n  page errors:\n    ' + [...new Set(errors)].slice(0, 8).join('\n    '));

  if (args.shot) {
    const dest = path.resolve(ROOT, String(args.shot));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await page.screenshot({ path: dest, fullPage: !!args.full });
    console.log('\n  wrote ' + path.relative(ROOT, dest));
  }
  await browser.close();
})();
