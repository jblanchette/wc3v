/**
 * page-audit.js — drive a site page in a real Chromium and assert its shape.
 *
 * The marketing pages are the one part of this repo with no test at all, and
 * download.html proved why that matters: it shipped at 6500px, eight screens
 * of prose, with a screenshot picker nobody recognised as a picker. None of
 * that is visible from reading the markup. It is only visible once a browser
 * has laid the page out and something has clicked on it.
 *
 * So this loads the page, walks it, CLICKS every tab and opens every
 * <details>, and fails on the things that regress: the fold losing the pitch
 * or the call to action, the page growing past its height budget, a tab that
 * does not swap the frame, text under the 12.8px floor, an icon under 36px.
 *
 * No server, per the project rule that the dev server is the user's to run:
 * client/ is served through request interception, the way tools/perf-bench.js
 * does it. Requests to anything else (cdn.wc3v.com, so the release manifest
 * is the real one) go out normally.
 *
 * Checks:
 *   fold        what is actually painted in the first viewport, and how much
 *               of the fold is text vs picture
 *   height      total page height against a budget
 *   tabs        every tab clicks, swaps the frame, and marks itself selected
 *   faq         every <details> opens and has an answer in it
 *   overflow    no horizontal scroll at any width
 *   floors      no rendered text below 12.8px, no icon below 36px
 *
 * Usage:
 *   node tools/page-audit.js
 *   node tools/page-audit.js --page=about.html --budget=4000
 *   node tools/page-audit.js --widths=1280x800 --shots
 *
 * Flags:
 *   --page=NAME        a file in client/, default download.html
 *   --widths=WxH,...   viewports, default 1280x800,1440x900,430x900
 *   --budget=N         max page height in px at desktop widths, default 3000
 *   --fit              instead of a budget, require the page NOT to scroll at
 *                      desktop widths. For a page laid out as one screen.
 *   --shots            also write the fold and full-page PNGs
 *   --shots-dir=PATH   default .page-shots (gitignored)
 *
 * Exit 1 when anything failed.
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

// Same browser discovery as tools/fx-bench.js and tools/perf-bench.js.
const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
];
const CLIENT = path.join(ROOT, 'client');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml'
};

// A brochure page that runs past this is telling instead of showing. It is a
// budget rather than a law: raise it deliberately with --budget when a page
// genuinely earns the room.
const HEIGHT_BUDGET = Number(args.budget || 3000);
const PAGE = String(args.page || 'download.html');
const SHOTS_DIR = path.resolve(ROOT, String(args['shots-dir'] || '.page-shots'));
const fails = [];
const ok = (label) => console.log('  ok    ' + label);
const bad = (label, detail) => { fails.push(label); console.log('  FAIL  ' + label + (detail ? '\n          ' + detail : '')); };

(async () => {
  const browser = await puppeteer.launch({
    executablePath: BROWSERS.find(p => fs.existsSync(p)),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  const widths = String(args.widths || '1280x800,1440x900,430x900').split(',');

  for (const wh of widths) {
    const [w, h] = wh.split('x').map(Number);
    console.log('\n── ' + w + 'x' + h + ' ' + '─'.repeat(40));

    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    const missing = [];

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

    await page.goto('https://wc3v.local/' + PAGE, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 900));

    // ── fold ───────────────────────────────────────────────────────────
    const fold = await page.evaluate((vh) => {
      const inFold = (el) => {
        const r = el.getBoundingClientRect();
        return r.top < vh && r.bottom > 0 && r.width > 0 && r.height > 0;
      };
      const seen = [];
      for (const sel of ['h1', 'h2', '.dl-cmd', '.dl-chip', '.dl-shot', '.dl-loop-step', '.dl-tab', '.dl-stage']) {
        for (const el of document.querySelectorAll(sel)) {
          if (inFold(el)) { seen.push(sel); break; }
        }
      }
      // How much of the fold is picture, as a share of the fold's area.
      let pic = 0;
      for (const img of document.querySelectorAll('.dl-shot img, .dl-stage')) {
        const r = img.getBoundingClientRect();
        const top = Math.max(0, r.top), bot = Math.min(vh, r.bottom);
        if (bot > top) pic += (bot - top) * r.width;
      }
      const present = ['h1', '.dl-cmd', '.dl-shot'].filter(sel => document.querySelector(sel));
      return {
        seen, present,
        h1: (document.querySelector('h1') || {}).textContent,
        picShare: Math.round(100 * pic / (window.innerWidth * vh))
      };
    }, h);
    console.log('        h1: "' + (fold.h1 || '').trim() + '"');
    console.log('        in fold: ' + fold.seen.join(' ') + '   picture ' + fold.picShare + '% of fold');
    // Every page owes the fold its h1. The command and the product shot are
    // only required of a page that HAS them, so this stays honest when
    // pointed at a page that is not download.html.
    // A phone fold owes the h1 and the call to action. Demanding a screenshot
    // up there too would be asking a 430px viewport to do something no good
    // mobile layout does.
    const wants = ['h1'].concat(fold.present.filter(sel =>
      sel === '.dl-cmd' || (sel === '.dl-shot' && w >= 1100)));
    const absent = wants.filter(sel => !fold.seen.includes(sel));
    if (!absent.length) ok('fold carries ' + wants.join(' + '));
    else bad('fold is missing ' + absent.join(' and '), 'in fold: ' + fold.seen.join(' '));

    // ── height + overflow ──────────────────────────────────────────────
    const m = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      screens: null
    }));
    m.screens = (m.height / h).toFixed(1);
    console.log('        page height ' + m.height + 'px (' + m.screens + ' screens)');
    if (m.overflow) bad('horizontal overflow'); else ok('no horizontal overflow');
    if (args.fit && w >= 1100) {
      // --fit is for a page laid out to BE the viewport. A few pixels of slack
      // absorbs sub-pixel rounding in the height arithmetic; anything more is
      // a scrollbar the layout was supposed to prevent.
      const over = m.height - h;
      if (over > 4) bad('page scrolls: ' + over + 'px past the viewport', m.height + ' > ' + h);
      else ok('page fits the viewport with no scroll (' + m.height + ' of ' + h + 'px)');
    } else if (w >= 1280 && m.height > HEIGHT_BUDGET) {
      bad('page taller than budget', m.height + ' > ' + HEIGHT_BUDGET);
    } else if (w >= 1280) {
      ok('page within height budget (' + HEIGHT_BUDGET + 'px)');
    }

    // ── walk the page so lazy images load and 404s can hide themselves ──
    await page.evaluate(async () => {
      const step = window.innerHeight;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise(r => setTimeout(r, 200));
      }
      window.scrollTo(0, 0);
    });
    await new Promise(r => setTimeout(r, 800));

    // ── columns: is anything hidden below the fold inside one? ─────────
    // A column that scrolls itself keeps the PAGE from scrolling, which is the
    // point, but content nobody can see without discovering a scrollbar inside
    // a card is content that is not on the page. This reports the overflow so
    // copy can be cut to fit rather than quietly clipped.
    if (w >= 1100) {
      const cols = await page.evaluate(() => [...document.querySelectorAll('.dl-col')].map((c, i) => {
        // [data-audit-optional] marks something folded away on purpose, such
        // as a collapsed accordion at the foot of a column. Its height is
        // reported but not counted as clipped, because content behind a
        // disclosure is hidden by design and content cut off by a column edge
        // is not.
        let optional = 0;
        for (const el of c.querySelectorAll('[data-audit-optional]')) {
          optional += el.getBoundingClientRect().height;
        }
        const hidden = Math.max(0, c.scrollHeight - c.clientHeight - optional);
        return {
          i: i + 1,
          visible: Math.round(c.clientHeight),
          content: Math.round(c.scrollHeight),
          optional: Math.round(optional),
          hidden: Math.round(hidden),
          // What the reader never reaches, so the fix is obvious.
          cut: [...c.children]
            .filter(el => el.getBoundingClientRect().bottom > c.getBoundingClientRect().bottom + 2)
            .map(el => (el.querySelector('.dl-h2') || {}).textContent || el.className)
        };
      }));
      for (const c of cols) {
        const line = 'column ' + c.i + ': ' + c.content + 'px of content in ' + c.visible + 'px' +
                     (c.optional ? ' (' + c.optional + 'px folded away on purpose)' : '');
        if (c.hidden > 8) bad(line + ', ' + c.hidden + 'px unreachable', 'clipped: ' + (c.cut.join(' / ') || '(mid-card)'));
        else ok(line);
      }
    }

    // ── tabs: click each one for real ──────────────────────────────────
    const tabSels = await page.evaluate(() =>
      [...document.querySelectorAll('.dl-tab')].filter(t => !t.hidden).map(t => t.dataset.shot));
    let tabsOk = true;
    for (const shot of tabSels) {
      await page.click('.dl-tab[data-shot="' + shot + '"]');
      await new Promise(r => setTimeout(r, 260));
      const state = await page.evaluate((s) => {
        const tab = document.querySelector('.dl-tab[data-shot="' + s + '"]');
        const on = [...document.querySelectorAll('.dl-stage img.is-on')].map(i => i.dataset.shot);
        const img = document.querySelector('.dl-stage img[data-shot="' + s + '"]');
        return {
          selected: tab.getAttribute('aria-selected'),
          on,
          painted: !!img && img.naturalWidth > 0,
          opacity: img ? getComputedStyle(img).opacity : null
        };
      }, shot);
      const good = state.selected === 'true' && state.on.length === 1 && state.on[0] === shot &&
                   state.painted && Number(state.opacity) > 0.9;
      if (!good) { tabsOk = false; bad('tab "' + shot + '" did not take', JSON.stringify(state)); }
    }
    if (tabsOk) ok('all ' + tabSels.length + ' tabs click, swap the frame and mark themselves: ' + tabSels.join(', '));
    if (tabSels.length < 5) console.log('        note: ' + (5 - tabSels.length) + ' tab(s) self-dropped (screenshot not on disk)');

    // ── FAQ: open each one for real ────────────────────────────────────
    const faq = await page.evaluate(async () => {
      const out = [];
      for (const d of document.querySelectorAll('.dl-faq details')) {
        const before = d.getBoundingClientRect().height;
        d.querySelector('summary').click();
        await new Promise(r => setTimeout(r, 60));
        const after = d.getBoundingClientRect().height;
        out.push({
          q: d.querySelector('summary').textContent.trim().slice(0, 40),
          grew: after > before + 20,
          words: (d.querySelector('p') || { textContent: '' }).textContent.trim().split(/\s+/).length
        });
        d.querySelector('summary').click();
      }
      return out;
    });
    const badFaq = faq.filter(f => !f.grew || f.words < 10);
    if (badFaq.length) bad('FAQ entries did not open or are empty', JSON.stringify(badFaq));
    else ok('all ' + faq.length + ' FAQ entries open with an answer');

    // ── floors: 12.8px text, 36px icons ────────────────────────────────
    const floors = await page.evaluate(() => {
      const small = [];
      for (const el of document.querySelectorAll('main *')) {
        if (!el.textContent.trim() || el.children.length) continue;
        const cs = getComputedStyle(el);
        const px = parseFloat(cs.fontSize);
        if (px && px < 12.79 && cs.display !== 'none') small.push(el.className + ' ' + px.toFixed(1) + 'px');
      }
      const tiny = [];
      for (const img of document.querySelectorAll('main img')) {
        const r = img.getBoundingClientRect();
        if (r.width && r.width < 36 && img.classList.contains('dl-mark')) tiny.push(img.src.split('/').pop() + ' ' + Math.round(r.width) + 'px');
      }
      return { small: [...new Set(small)], tiny };
    });
    if (floors.small.length) bad('text below the 12.8px floor', floors.small.join(', '));
    else ok('no text below 12.8px');
    if (floors.tiny.length) bad('icon below the 36px floor', floors.tiny.join(', '));
    else ok('no icon below 36px');

    if (missing.length) console.log('        missing assets: ' + [...new Set(missing)].join(', '));

    if (args.shots) {
      // The tab walk above left the stage on the last tab. Put it back on the
      // first so the shot is the state a visitor actually arrives at.
      if (tabSels.length) await page.click('.dl-tab[data-shot="' + tabSels[0] + '"]');
      await new Promise(r => setTimeout(r, 300));
      await page.evaluate(() => window.scrollTo(0, 0));
      fs.mkdirSync(SHOTS_DIR, { recursive: true });
      const stem = path.join(SHOTS_DIR, PAGE.replace(/\.html$/, '') + '-' + w);
      await page.screenshot({ path: stem + '-fold.png' });
      await page.screenshot({ path: stem + '-full.png', fullPage: true });
    }
    await page.close();
  }

  await browser.close();
  console.log('\n' + (fails.length ? fails.length + ' FAILED' : 'all checks passed'));
  process.exit(fails.length ? 1 : 0);
})();
