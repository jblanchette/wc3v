/**
 * css-swatch.js — render one component against the real stylesheets, with no
 * replay and no dev server.
 *
 * Checking a card in the viewer normally means loading a replay and waiting
 * for a simulation, which is a lot of machinery to look at a border. This
 * builds a page that loads the site's actual CSS, drops a fixture of the
 * markup into it, and screenshots just that element. What renders is what
 * main.css says, because it IS main.css.
 *
 * Fixtures live in FIXTURES below, keyed by name. Add one when you need to
 * see a component in isolation; keep the markup a faithful copy of what the
 * renderer emits, or the shot is a picture of something that does not exist.
 *
 * Usage:
 *   node tools/css-swatch.js --fixture=mh-player
 *   node tools/css-swatch.js --fixture=mh-player --out=client/review/mh.png
 *   node tools/css-swatch.js --list
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
  '.webp': 'image/webp', '.svg': 'image/svg+xml'
};

const FIXTURES = {
  // The two player cards above the viewer canvas (js/MatchHeader.js
  // renderPlayerCard). Trimmed to the header row, which is where the card's
  // own chrome shows; the tech/upgrade sections below it are their own
  // components and only add height.
  'mh-player': {
    // The rail these sit on, so the card is judged against its real backdrop.
    wrap: 'background: var(--vc-rail, #1e1b16); padding: 14px; width: 1180px;',
    css: ['css/tokens.css', 'css/main.css'],
    html: `
      <div class="mh-matchup">
        <div class="mh-player mh-player-left">
          <div class="mh-player-header">
            <div class="mh-player-header-text">
              <div class="mh-player-name" style="color:#4488FF">Happy</div>
              <div class="mh-build-name">DK Destroyer</div>
            </div>
          </div>
          <div class="mh-expand-all">expand all</div>
        </div>
        <div class="mh-vs">VS</div>
        <div class="mh-player mh-player-right">
          <div class="mh-player-header">
            <div class="mh-player-header-text">
              <div class="mh-player-name" style="color:#FF4444">Grubby</div>
              <div class="mh-build-name">BM Wind Rider</div>
            </div>
          </div>
          <div class="mh-expand-all">expand all</div>
        </div>
      </div>`,
    shot: '.mh-matchup'
  }
};

(async () => {
  if (args.list) {
    console.log('\nfixtures: ' + Object.keys(FIXTURES).join(', ') + '\n');
    return;
  }
  const name = String(args.fixture || 'mh-player');
  const fx = FIXTURES[name];
  if (!fx) { console.error('no fixture "' + name + '". Try --list.'); process.exit(2); }

  const links = fx.css.map(c => '<link rel="stylesheet" href="/' + c + '">').join('\n');
  const page_ = `<!DOCTYPE html><html><head><meta charset="utf-8">${links}
    <style>body{margin:0;background:#0b0805;} .swatch{${fx.wrap || ''}}</style>
    </head><body><div class="swatch">${fx.html}</div></body></html>`;

  const browser = await puppeteer.launch({
    executablePath: BROWSERS.find(p => fs.existsSync(p)),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 400, deviceScaleFactor: 2 });
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.hostname !== 'wc3v.local') return r.continue();
    const rel = decodeURIComponent(u.pathname).replace(/^\//, '');
    if (rel === 'swatch.html') return r.respond({ status: 200, contentType: 'text/html', body: page_ });
    const file = path.join(CLIENT, rel);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      return r.respond({
        status: 200,
        contentType: MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        body: fs.readFileSync(file)
      });
    }
    return r.respond({ status: 404, body: 'not found' });
  });
  await page.goto('https://wc3v.local/swatch.html', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 400));

  // Report the computed edges, so "no single-edge accent" is measured rather
  // than eyeballed off the picture.
  const edges = await page.evaluate((sel) => {
    const out = [];
    for (const el of document.querySelectorAll(sel + ' > *')) {
      const cs = getComputedStyle(el);
      out.push({
        cls: el.className,
        borders: ['Top', 'Right', 'Bottom', 'Left'].map(s =>
          parseFloat(cs['border' + s + 'Width']) + (cs['border' + s + 'Style'] === 'none' ? '' : ' ' + cs['border' + s + 'Style'])).join(' | '),
        shadow: cs.boxShadow === 'none' ? 'none' : cs.boxShadow.slice(0, 96)
      });
    }
    return out;
  }, fx.shot);

  console.log('\n  ' + name + '   (border widths: top | right | bottom | left)');
  for (const e of edges) {
    console.log('  ' + String(e.cls || '(no class)').padEnd(26) + e.borders);
    console.log('  ' + ' '.repeat(26) + 'shadow: ' + e.shadow);
  }

  const out = path.resolve(ROOT, String(args.out || ('client/review/swatch-' + name + '.png')));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const el = await page.$(fx.shot);
  await el.screenshot({ path: out });
  console.log('\n  wrote ' + path.relative(ROOT, out) + '\n');
  await browser.close();
})();
