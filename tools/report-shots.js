/**
 * report-shots.js — walk the desktop preview headless: fold audit + screenshots.
 *
 * The fold rule ("only .report-body scrolls, every frame fits 900x600") is
 * checked mechanically in desktop/README.md with a console snippet run by
 * hand, per game, per tab, per size, per preview page. That ritual is exactly
 * the kind that gets skipped. This tool runs it — the same assertions,
 * verbatim — across every page of the audit matrix in one command, and
 * screenshots every stop so a layout round can be judged side by side.
 *
 * Usage:
 *   node tools/desktop-preview.js --mix=audit --out=preview-mix.html
 *   node tools/report-shots.js --pages=preview-mix.html
 *   node tools/report-shots.js --pages=preview-mix.html,preview-anon.html --audit-only
 *   node tools/report-shots.js --pages=preview-mix.html --mock=ov-a,ov-b,ov-c
 *
 * Flags:
 *   --pages=a.html,b.html   preview pages in desktop/preview/ (default preview.html)
 *   --sizes=900x600,1280x820  viewports (that default IS the fold contract)
 *   --shots-dir=PATH        where PNGs + gallery.html + audit.json land.
 *                           Default: the WC3V_SHOTS_DIR env var, else
 *                           tools/../.report-shots (gitignored). Shots are
 *                           session artifacts, never committed.
 *   --audit-only            no screenshots, just the fold audit
 *   --mock=a,b,c            re-walk the page once per variant with
 *                           #mock=<name> set (see game-report-view.js's
 *                           preview-only MOCK switch during a mock round)
 *
 * Exit 1 when the audit found anything. audit.json carries the details.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const PREVIEW_DIR = path.join(ROOT, 'desktop', 'preview');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

// Same discovery as tools/fx-bench.js.
const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
];
function findBrowser () {
  if (process.env.WC3V_BROWSER) return process.env.WC3V_BROWSER;
  for (const p of BROWSERS) if (fs.existsSync(p)) return p;
  throw new Error('no Chrome/Edge found — set WC3V_BROWSER=/path/to/browser');
}

const pages = String(args.pages || 'preview.html').split(',').map(s => s.trim()).filter(Boolean);
const sizes = String(args.sizes || '900x600,1280x820').split(',').map(s => {
  const [w, h] = s.trim().split('x').map(Number);
  return { w, h };
});
const mocks = typeof args.mock === 'string'
  ? args.mock.split(',').map(s => s.trim()).filter(Boolean)
  : [null];
const auditOnly = !!args['audit-only'];

const shotsDir = typeof args['shots-dir'] === 'string'
  ? path.resolve(args['shots-dir'])
  : (process.env.WC3V_SHOTS_DIR || path.join(ROOT, '.report-shots'));
fs.mkdirSync(shotsDir, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// One stop of the walk: the README's fold assertions, verbatim in spirit —
// page/body must not scroll, no visible .detail-col may scroll. Returns the
// list of violations at this stop.
const FOLD_CHECK = () => {
  const bad = [];
  const doc = document.documentElement;
  if (doc.scrollHeight > doc.clientHeight + 1) bad.push('page scrolls');
  if (document.body.scrollHeight > document.body.clientHeight + 1) bad.push('body scrolls');
  const cols = [...document.querySelectorAll('.detail-col')]
    .filter(c => c.offsetParent !== null);
  for (const col of cols) {
    if (col.scrollHeight > col.clientHeight + 1) bad.push('detail-col scrolls');
  }
  return bad;
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files']
  });
  const page = await browser.newPage();

  const audit = [];
  const shots = [];   // { file, page, size, mock, game, tab }
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(String(e.message)));

  for (const pg of pages) {
    const file = path.join(PREVIEW_DIR, pg);
    if (!fs.existsSync(file)) {
      console.error(`missing preview page: ${path.relative(ROOT, file)} — build it with tools/desktop-preview.js --out=${pg}`);
      process.exit(2);
    }
    const url = 'file:///' + file.replace(/\\/g, '/');

    for (const mock of mocks) {
      for (const size of sizes) {
        await page.setViewport({ width: size.w, height: size.h });
        // goto + reload: a hash-only change does not re-run the page, and the
        // MOCK switch is read once at load.
        await page.goto(url + (mock ? `#mock=${mock}` : ''), { waitUntil: 'networkidle0' });
        await page.reload({ waitUntil: 'networkidle0' });
        await sleep(1200);

        const games = await page.$$eval('.qn-chip', els => els.length);
        for (let g = 0; g < games; g++) {
          const gameLabel = await page.evaluate((n) => {
            const chip = document.querySelectorAll('.qn-chip')[n];
            chip.click();
            return (chip.textContent || '').trim().slice(0, 40);
          }, g);
          await sleep(150);

          // Tabs may be absent (a stale game has no strip) — that is a legal
          // state, walked as one stop named 'none'.
          const tabs = await page.$$eval('.ms-tabs .ms-tab',
            els => els.map(e => (e.textContent || '').trim()));
          const stops = tabs.length ? tabs : ['none'];

          for (let t = 0; t < stops.length; t++) {
            if (tabs.length) {
              await page.evaluate((n) => {
                document.querySelectorAll('.ms-tabs .ms-tab')[n].click();
              }, t);
              await sleep(150);
            }

            // Every chart mode is audited; only the default is screenshotted,
            // or the gallery drowns.
            const modes = await page.$$eval('.cp-seg .seg-btn', els => els.length);
            for (let m = 0; m < Math.max(1, modes); m++) {
              if (modes) {
                await page.evaluate((n) => {
                  document.querySelectorAll('.cp-seg .seg-btn')[n].click();
                }, m);
                await sleep(120);
              }
              const bad = await page.evaluate(FOLD_CHECK);
              for (const issue of bad) {
                audit.push({ page: pg, size: `${size.w}x${size.h}`, mock, game: gameLabel, tab: stops[t], mode: m, issue });
              }
              if (m === 0 && !auditOnly) {
                const name = [
                  pg.replace(/\.html$/, ''), `${size.w}x${size.h}`,
                  `g${g}`, stops[t].toLowerCase(), mock
                ].filter(Boolean).join('--') + '.png';
                await page.screenshot({ path: path.join(shotsDir, name) });
                shots.push({ file: name, page: pg, size: `${size.w}x${size.h}`, mock, game: gameLabel, tab: stops[t] });
              }
              if (modes && m === 0) {
                // walked the rest for the audit; return to default afterwards
              }
            }
            if (modes) {
              await page.evaluate(() => {
                const first = document.querySelector('.cp-seg .seg-btn');
                if (first) first.click();
              });
            }
          }
        }
        console.log(`${pg} ${size.w}x${size.h}${mock ? ' #' + mock : ''}: ${games} games walked`);
      }
    }
  }

  fs.writeFileSync(path.join(shotsDir, 'audit.json'),
    JSON.stringify({ audit, consoleErrors }, null, 2));

  if (!auditOnly) {
    // A static gallery: rows per (page, size, game, tab), one column per
    // variant, filters up top. It is generated, disposable, and lives with
    // the shots — never in the repo.
    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const rowKey = (s) => [s.page, s.size, s.game, s.tab].join('|');
    const rows = new Map();
    for (const s of shots) {
      if (!rows.has(rowKey(s))) rows.set(rowKey(s), { meta: s, byMock: {} });
      rows.get(rowKey(s)).byMock[s.mock || 'base'] = s.file;
    }
    const cols = mocks.map(m => m || 'base');
    const tabSet = [...new Set(shots.map(s => s.tab))];
    const sizeSet = [...new Set(shots.map(s => s.size))];

    const html = `<!doctype html><meta charset="utf-8"><title>report shots</title>
<style>
  body { font: 13px system-ui; background: #16130d; color: #d8d0c0; margin: 0; padding: 12px; }
  .bar { position: sticky; top: 0; background: #16130d; padding: 8px 0; display: flex; gap: 12px; }
  select { background: #221d14; color: inherit; border: 1px solid #3a3020; padding: 4px; }
  .row { margin: 18px 0; }
  .cap { color: #9a8f7d; margin-bottom: 4px; }
  .imgs { display: flex; gap: 10px; align-items: flex-start; overflow-x: auto; }
  .cell b { display:block; color: #c8b070; margin-bottom: 3px; }
  img { max-width: ${cols.length > 1 ? '640px' : '1000px'}; border: 1px solid #3a3020; display: block; }
</style>
<div class="bar">
  <label>tab <select id="ftab"><option value="">all</option>${tabSet.map(t => `<option>${esc(t)}</option>`).join('')}</select></label>
  <label>size <select id="fsize"><option value="">all</option>${sizeSet.map(t => `<option>${esc(t)}</option>`).join('')}</select></label>
</div>
${[...rows.values()].map(r => `
<div class="row" data-tab="${esc(r.meta.tab)}" data-size="${esc(r.meta.size)}">
  <div class="cap">${esc(r.meta.page)} · ${esc(r.meta.size)} · ${esc(r.meta.game)} · <b style="display:inline;color:#c8b070">${esc(r.meta.tab)}</b></div>
  <div class="imgs">${cols.map(c => r.byMock[c]
    ? `<div class="cell"><b>${esc(c)}</b><img loading="lazy" src="${esc(r.byMock[c])}"></div>` : '').join('')}</div>
</div>`).join('')}
<script>
  const apply = () => {
    const t = document.getElementById('ftab').value;
    const s = document.getElementById('fsize').value;
    for (const row of document.querySelectorAll('.row')) {
      row.style.display = (!t || row.dataset.tab === t) && (!s || row.dataset.size === s) ? '' : 'none';
    }
  };
  document.getElementById('ftab').onchange = apply;
  document.getElementById('fsize').onchange = apply;
</script>`;
    fs.writeFileSync(path.join(shotsDir, 'gallery.html'), html);
  }

  await browser.close();

  if (consoleErrors.length) {
    console.error(`\n${consoleErrors.length} page error(s):`);
    for (const e of [...new Set(consoleErrors)].slice(0, 10)) console.error('  ' + e);
  }
  if (audit.length) {
    console.error(`\nFOLD AUDIT FAILED — ${audit.length} violation(s), see ${path.join(shotsDir, 'audit.json')}`);
    for (const a of audit.slice(0, 12)) {
      console.error(`  ${a.page} ${a.size}${a.mock ? ' #' + a.mock : ''} · ${a.game} · ${a.tab}: ${a.issue}`);
    }
    process.exit(1);
  }
  console.log(`\naudit clean · ${shots.length} shot(s) → ${shotsDir}`);
})();
