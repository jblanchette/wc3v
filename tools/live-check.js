/**
 * live-check.js — walk the site on a server that is already running and
 * report what a browser actually complains about.
 *
 * The interception-based tools serve client/ off disk, which papers over
 * anything that only goes wrong on a real server: a 404 on a path that
 * exists but is not routed, a redirect, a wrong MIME type. This drives the
 * real thing and reports, per page: console errors, uncaught exceptions,
 * every request that came back 400 or worse, the page height, and whether
 * the fold carries its h1.
 *
 * It never starts a server. Point it at one that is up.
 *
 * Usage:
 *   node tools/live-check.js
 *   node tools/live-check.js --base=http://127.0.0.1:8080
 *   node tools/live-check.js --pages=index.html,about.html --width=1920x1080
 *   node tools/live-check.js --shots=client/review/home/live
 *
 * Exit 1 if any page logged an error or served a 4xx/5xx.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');

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

const BASE = String(args.base || 'http://127.0.0.1:8080').replace(/\/$/, '');
const PAGES = String(args.pages || 'index.html,about.html,download.html,learn.html,community.html,replays.html')
  .split(',').filter(Boolean);
const [W, H] = String(args.width || '1280x800').split('x').map(Number);

// Noise a healthy page still produces: a favicon the dev server does not
// carry, and the icon 404s that every card's onerror already handles.
const IGNORE = [/favicon/i];

const fails = [];

(async () => {
  const exe = BROWSERS.find(p => fs.existsSync(p));
  if (!exe) { console.error('no Chrome or Edge found'); process.exit(2); }

  // Software GL so the hero stage renders headless, the same flags
  // tools/fx-bench.js uses.
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage',
           '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });

  console.log('\n  ' + BASE + '   ' + W + 'x' + H + '\n');

  for (const p of PAGES) {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });

    const errors = [];
    const badResponses = [];
    page.on('pageerror', e => errors.push('uncaught: ' + e.message));
    page.on('console', m => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (IGNORE.some(re => re.test(t))) return;
      errors.push('console: ' + t);
    });
    page.on('requestfailed', r => {
      const u = r.url();
      if (IGNORE.some(re => re.test(u))) return;
      badResponses.push(u + ' — ' + (r.failure() && r.failure().errorText));
    });
    page.on('response', r => {
      if (r.status() < 400) return;
      const u = r.url();
      if (IGNORE.some(re => re.test(u))) return;
      badResponses.push(new URL(u).pathname + ' HTTP ' + r.status());
    });

    let nav = null;
    try {
      await page.goto(BASE + '/' + p, { waitUntil: 'networkidle2', timeout: 45000 });
    } catch (e) { nav = e.message; }
    await new Promise(r => setTimeout(r, Number(args.wait || 6000)));

    const shape = nav ? null : await page.evaluate((vh) => {
      const h1 = document.querySelector('h1');
      const r = h1 && h1.getBoundingClientRect();
      const stage = document.getElementById('hero-stage');
      return {
        height: document.documentElement.scrollHeight,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        h1: h1 ? h1.textContent.trim().slice(0, 54) : null,
        h1InFold: !!(r && r.top < vh && r.bottom > 0),
        stage: stage ? stage.getAttribute('data-state') + (stage.getAttribute('data-reason') ? '/' + stage.getAttribute('data-reason') : '') : null,
        models: document.querySelectorAll('.hp-stage-slot.is-loaded').length
      };
    }, H);

    const uniqErr = [...new Set(errors)];
    const uniqBad = [...new Set(badResponses)];
    const clean = !nav && !uniqErr.length && !uniqBad.length;
    console.log('  ' + (clean ? 'ok   ' : 'FAIL ') + p.padEnd(18) +
      (nav ? 'navigation failed: ' + nav
           : shape.height + 'px' +
             (shape.overflow ? '  H-OVERFLOW' : '') +
             (shape.h1 ? '  h1' + (shape.h1InFold ? ' in fold' : ' BELOW FOLD') : '  NO H1') +
             (shape.stage ? '  stage=' + shape.stage + ' ' + shape.models + '/4' : '')));
    for (const e of uniqErr.slice(0, 6)) console.log('         ' + e);
    for (const b of uniqBad.slice(0, 8)) console.log('         ' + b);
    if (!clean) fails.push(p);

    if (args.shots && !nav) {
      const dir = path.resolve(ROOT, String(args.shots));
      fs.mkdirSync(dir, { recursive: true });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(dir, p.replace(/\.html$/, '') + '-' + W + '-fold.png') });
    }
    await page.close();
  }

  await browser.close();
  console.log('\n  ' + (fails.length ? fails.length + ' page(s) with problems: ' + fails.join(', ')
                                     : 'every page clean'));
  process.exit(fails.length ? 1 : 0);
})();
