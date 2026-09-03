/**
 * desktop-ui-shots.js — screenshot the desktop chrome that report-shots.js
 * never reaches.
 *
 * report-shots.js walks the game REPORT: every game, every tab, at both fold
 * sizes. Everything around it — the Settings sheet, the folder tree, the "You"
 * popover, the strip that says what is on disk but unread — is never opened by
 * that walk, so a change to any of it ships unseen.
 *
 * Same harness idiom: the real frontend, against the preview page, driven
 * headless. Each stop opens one surface and saves a PNG.
 *
 * Usage:
 *   node tools/desktop-preview.js --games=40 --me="Jeef#1496"
 *   node tools/desktop-ui-shots.js
 *   node tools/desktop-ui-shots.js --page=preview.html --size=1280x820
 *   node tools/desktop-ui-shots.js --setup     the first-run screen instead
 */

'use strict';

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const PREVIEW_DIR = path.join(ROOT, 'desktop', 'preview');

const args = {};
process.argv.slice(2).forEach((raw) => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
];
const findBrowser = () => {
  if (process.env.WC3V_BROWSER) return process.env.WC3V_BROWSER;
  for (const p of BROWSERS) if (fs.existsSync(p)) return p;
  throw new Error('no Chrome/Edge found — set WC3V_BROWSER=/path/to/browser');
};

const outDir = args['shots-dir'] || process.env.WC3V_SHOTS_DIR ||
  path.join(ROOT, '.report-shots');
const pageFile = String(args.page || (args.setup ? 'preview-setup.html' : 'preview.html'));
const [W, H] = String(args.size || '1280x820').split('x').map(Number);

// The first-run screen's own stops, with --setup. Its folder tree is the same
// renderer Settings mounts, so a change to one shows up on both.
const SETUP_STOPS = [
  {
    name: 'setup-folders',
    what: 'First run, step 2: the folder tree',
    open: () => {
      const rail = [...document.querySelectorAll('.wiz-step')].find(b => b.dataset.step === 'folders');
      if (rail) rail.click();
      const next = document.getElementById('setup-next');
      // The rail only goes backwards, so step 1 has to be satisfied first.
      const box = document.getElementById('setup-accept');
      if (box && !box.checked) { box.checked = true; box.dispatchEvent(new Event('change')); }
      if (next) next.click();
      return !document.getElementById('setup-step-folders').hidden;
    }
  },
  {
    name: 'setup-history',
    what: 'First run, step 4: only new games, or read the history too',
    open: () => {
      const next = document.getElementById('setup-next');
      for (let i = 0; i < 3; i++) if (next && !next.hidden) next.click();
      return !document.getElementById('setup-step-history').hidden;
    }
  }
];

// Each stop: open a surface, wait for it, shoot it. `open` runs in the page.
const STOPS = [
  {
    name: 'feed-search',
    what: 'The feed drawer, still open with a search typed into it',
    open: () => {
      const toggle = document.getElementById('games-toggle');
      if (toggle && document.getElementById('games-drawer').hidden) toggle.click();
      const box = document.getElementById('feed-search');
      if (box) { box.value = 'e'; box.dispatchEvent(new Event('input')); }
      return true;
    },
    // The filter is debounced; the assertion is what the drawer is AFTER it runs.
    settleMs: 500,
    check: () => !document.getElementById('games-drawer').hidden
  },
  {
    name: 'settings-folders',
    what: 'Settings, with the folder tree and its whole-tree switch',
    open: () => {
      const sheet = document.getElementById('settings-sheet');
      if (sheet) sheet.hidden = false;
      const t = document.getElementById('folders');
      if (t) t.scrollTop = 0;
      return !!document.querySelector('#folders .frow');
    }
  },
  {
    name: 'identity-accounts',
    what: 'The You popover, with the other-accounts section',
    open: () => {
      const sheet = document.getElementById('settings-sheet');
      if (sheet) sheet.hidden = true;
      const btn = document.getElementById('identity-btn');
      if (btn) btn.click();
      return !document.getElementById('identity-pop').hidden;
    }
  },
  {
    name: 'feed-unread',
    what: 'The feed drawer, with the line for what is on disk but unread',
    open: () => {
      const pop = document.getElementById('identity-pop');
      if (pop) pop.hidden = true;
      const toggle = document.getElementById('games-toggle');
      // Idempotent: an earlier stop may have opened it, and `click` toggles.
      if (toggle && document.getElementById('games-drawer').hidden) toggle.click();
      // The preview has no Rust behind it, so the strip is filled by hand with
      // the shape app.js hands it.
      const views = window.__WC3V_VIEWS__;
      if (views && views.gamesView && views.gamesView.renderUnread) {
        views.gamesView.renderUnread(
          { onDisk: 1318, parsed: 131, failed: 3, filtered1v1: true,
            reasons: { missing_map: 2, timeout: 1 } },
          () => {}
        );
      }
      const row = document.getElementById('unread');
      return !document.getElementById('games-drawer').hidden && !!row && !row.hidden;
    }
  }
];

(async () => {
  const file = path.join(PREVIEW_DIR, pageFile);
  if (!fs.existsSync(file)) {
    console.error(`missing preview page: ${path.relative(ROOT, file)} — build it with tools/desktop-preview.js`);
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: true,
    args: ['--no-sandbox', '--allow-file-access-from-files']
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.goto('file:///' + file.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 600));

  const saved = [];
  for (const stop of (args.setup ? SETUP_STOPS : STOPS)) {
    let ok = false;
    try { ok = await page.evaluate(stop.open); } catch (e) { ok = false; }
    await new Promise(r => setTimeout(r, stop.settleMs || 350));
    // A stop can assert something that is only true once the page settles.
    if (ok && stop.check) {
      try { ok = await page.evaluate(stop.check); } catch (e) { ok = false; }
    }
    const out = path.join(outDir, `ui-${stop.name}.png`);
    await page.screenshot({ path: out });
    saved.push({ name: stop.name, ok, out });
    console.log(`${ok ? '  ok  ' : ' MISS '} ${stop.name.padEnd(20)} ${stop.what}`);
  }

  await browser.close();

  if (errors.length) {
    console.log('\npage errors:');
    for (const e of [...new Set(errors)]) console.log('  ' + e);
  }
  console.log(`\n${saved.length} shot(s) → ${outDir}`);
  // A stop that could not open its surface is a wiring break, not a bad photo.
  if (saved.some(s => !s.ok)) process.exitCode = 1;
})();
