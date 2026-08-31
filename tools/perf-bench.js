//
// perf-bench.js — measures viewer frame cost in a real browser, no dev server.
//
// fx-bench proves pixels; this proves SPEED. It loads viewer.html against the
// working tree (request interception serves client/ straight off disk, so
// nothing listens on any port), seeks to mid-game, plays, and records:
//
//   - frame deltas from a rAF sampler        -> fps avg / p50 / p95 / worst
//   - a V8 CPU profile of the playback window -> top functions by SELF time
//   - renderer.info                           -> draw calls, tris, programs
//   - WC3V_PERF stage timers (if the build has them) -> ms per subsystem
//
// The point is A/B: run it, change one thing, run it again. Same replay, same
// seek, same seconds, fixed playback speed (AUTO director off) so two runs
// differ only by the code.
//
// Usage:
//   node tools/perf-bench.js                              # defaults below
//   node tools/perf-bench.js --replay=NAME --at=8:00 --seconds=15
//   node tools/perf-bench.js --headful                    # watch it
//   node tools/perf-bench.js --speed=4                    # playback speed
//   node tools/perf-bench.js --free                       # FREE camera (whole map)
//   node tools/perf-bench.js --json=out.json              # machine-readable dump
//   node tools/perf-bench.js --cpuprofile=out.cpuprofile  # open in DevTools
//   node tools/perf-bench.js --label=baseline             # tag the console/json output
//   node tools/perf-bench.js --view=displayTeleports:false # override viewOptions (feature A/B)
//
// Uses the REAL GPU (ANGLE/D3D) by default — this is a perf rig, not a
// reproducibility rig. --soft switches to SwiftShader if a machine needs it.
//
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const puppeteer = require('puppeteer-core');

const args = {};
process.argv.slice(2).forEach(r => {
  const [f, ...v] = r.replace(/^--/, '').split('=');
  args[f] = v.length ? v.join('=') : true;
});

const ROOT = path.join(__dirname, '..', 'client');
const ORIGIN = 'http://127.0.0.1:8080'; // never actually contacted — interception answers
const REPLAY = args.replay || '1129305842_Leon_Lucifer_AutumnLeaves20';
const SECONDS = Number(args.seconds || 15);
const SPEED = Number(args.speed || 4);
const LABEL = args.label || '';

// "8:00" or raw ms
function parseAt (raw) {
  if (raw == null) return 8 * 60 * 1000;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  const m = /^(\d+):([0-5]\d)$/.exec(raw);
  if (m) return (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * 1000;
  throw new Error('bad --at, want ms or m:ss');
}
const AT_MS = parseAt(args.at);

const BROWSERS = [
  process.env.WC3V_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean);

function findBrowser () {
  for (const p of BROWSERS) if (fs.existsSync(p)) return p;
  throw new Error('no Chrome/Edge found — set WC3V_BROWSER=/path/to/browser');
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.map': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.gz': 'application/gzip', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.txt': 'text/plain', '.xml': 'application/xml', '.wc3v': 'application/json'
};

// Map an intercepted URL to bytes from client/. The dev server (http-server -g)
// transparently serves `foo.gz` for `foo` with Content-Encoding, and the client
// relies on that for replays/walkmaps — emulate it by gunzipping in Node.
// Returns { file, body } or null so the caller can 404 a miss loudly.
function resolveFile (urlStr) {
  const u = new URL(urlStr);
  let p = decodeURIComponent(u.pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    return { file, body: fs.readFileSync(file) };
  }
  // extensionless page routes (/viewer, /builds) -> .html
  if (!path.extname(file) && fs.existsSync(file + '.html')) {
    return { file: file + '.html', body: fs.readFileSync(file + '.html') };
  }
  if (fs.existsSync(file + '.gz')) {
    return { file, body: zlib.gunzipSync(fs.readFileSync(file + '.gz')) };
  }
  return null;
}

// puppeteer's temp-profile cleanup races the browser process on Windows (a
// failed launch's breakaway Edge still holds the profile; close() unlinks
// while files are locked). The EBUSY lands as an unhandled rejection and
// would kill the bench after a completed run — ignore it, crash on the rest.
process.on('unhandledRejection', (e) => {
  if (e && e.code === 'EBUSY') return;
  throw e;
});

// A puppeteer.launch defeated by Edge's job-object breakaway leaves a
// detached headless Edge running on a puppeteer temp profile with no owner.
// Sweep those at exit (win32 only; matches only puppeteer temp profiles, so
// a user's real Edge session is never touched).
function sweepOrphanBrowsers () {
  if (process.platform !== 'win32') return;
  try {
    require('child_process').execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'msedge.exe\'\\" | ' +
      'Where-Object { $_.CommandLine -match \'puppeteer_dev_chrome_profile|wc3v-bench-profile\' } | ' +
      'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"',
      { stdio: 'ignore', timeout: 30000 });
  } catch (_) { /* best effort */ }
}

// Spawn the browser directly with --remote-debugging-port=0, wait for it to
// write DevToolsActivePort into the temp profile, and puppeteer.connect. Used
// only when puppeteer.launch's own child-process bookkeeping is defeated by
// Edge relaunching itself outside a job object (see call site).
async function connectFallback (exe, headful, launchArgs) {
  const os = require('os');
  const { spawn } = require('child_process');
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wc3v-bench-profile-'));
  const spawnArgs = launchArgs.concat([
    '--user-data-dir=' + profileDir,
    '--remote-debugging-port=0',
    '--no-first-run', '--no-default-browser-check',
    'about:blank'
  ]);
  if (!headful) spawnArgs.unshift('--headless');
  spawn(exe, spawnArgs, { stdio: 'ignore', detached: true }).unref();

  const portFile = path.join(profileDir, 'DevToolsActivePort');
  let wsEndpoint = null;
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 250));
    try {
      const lines = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
      if (lines.length >= 2 && Number(lines[0]) > 0) {
        wsEndpoint = 'ws://127.0.0.1:' + lines[0].trim() + lines[1].trim();
        break;
      }
    } catch (_) { /* not written yet */ }
  }
  if (!wsEndpoint) throw new Error('connectFallback: browser never wrote DevToolsActivePort');
  const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint, protocolTimeout: 180000 });
  // browser.close() over CDP shuts the browser down; the profile dir is
  // best-effort cleaned on exit (Windows can hold locks briefly).
  process.on('exit', () => { try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) {} });
  return browser;
}

(async () => {
  const exe = findBrowser();
  const headful = !!args.headful;
  const launchArgs = [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--window-size=1600,1000',
    // rAF must run at machine speed, not throttled or vsync-batched away.
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows'
  ];
  if (args.soft) launchArgs.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  // Headless "new" can silently fall back to SwANGLE (software GL), which
  // makes GL command overhead dominate and skews every measurement toward
  // fill/submission cost. --gpu forces the D3D11 hardware path.
  else launchArgs.push('--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist');

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: exe,
      // Edge 152 exits immediately (code 0, no stderr) when puppeteer passes the
      // legacy `--headless=new` string; `true` selects the same new headless mode
      // through the supported flag.
      headless: headful ? false : true,
      protocolTimeout: 180000,
      args: launchArgs
    });
  } catch (e) {
    // Under a job-object wrapper (CI, agent harnesses) Edge's initial process
    // breaks away: it relaunches the real browser detached and exits 0, which
    // puppeteer reports as "Failed to launch ... Code: 0". Fall back to
    // spawning Edge ourselves and connecting over CDP via DevToolsActivePort.
    if (!/Failed to launch/.test(String(e && e.message))) throw e;
    browser = await connectFallback(exe, headful, launchArgs);
  }

  const page = await browser.newPage();
  const vp = (args.viewport || '1600x900').split('x').map(Number);
  // --dsf=2 for --still shots of the CSS-pixel overlays (the HUD, the camera
  // toolbar). Those are ~600px wide at dpr 1, which is too small to judge
  // 11px engraved chrome in. Leave it at 1 for timing runs: it changes what
  // the rasterizer has to do.
  const dsf = Number(args.dsf || 1);
  await page.setViewport({ width: vp[0], height: vp[1], deviceScaleFactor: dsf });

  const misses = [];
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // --swap=<urlSubstring>=<localFile> — serve a local file for any request
  // whose URL contains the substring (CDN URLs included). Built for perf
  // experiments on vendored/CDN libraries: patch a copy, swap it in, measure.
  let swap = null;
  if (args.swap) {
    const i = String(args.swap).indexOf('=');
    if (i < 1) throw new Error('bad --swap, want urlSubstring=localFile');
    swap = { match: String(args.swap).slice(0, i), body: fs.readFileSync(String(args.swap).slice(i + 1)) };
    process.stdout.write(`  swap: URLs containing "${swap.match}" served from ${String(args.swap).slice(i + 1)}\n`);
  }

  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = req.url();
    if (swap && url.includes(swap.match)) {
      req.respond({ status: 200, contentType: 'text/javascript', body: swap.body });
      return;
    }
    if (!url.startsWith(ORIGIN)) { req.continue(); return; } // CDN etc. -> network
    const hit = resolveFile(url);
    if (!hit) {
      misses.push(new URL(url).pathname);
      req.respond({ status: 404, contentType: 'text/plain', body: 'perf-bench: no such file' });
      return;
    }
    req.respond({
      status: 200,
      contentType: MIME[path.extname(hit.file).toLowerCase()] || 'application/octet-stream',
      body: hit.body
    });
  });

  const cdp = await page.target().createCDPSession();

  const url = `${ORIGIN}/viewer.html?r=${encodeURIComponent(REPLAY)}&at=${AT_MS}&play=1`;
  process.stdout.write(`\n  perf-bench${LABEL ? ' [' + LABEL + ']' : ''}\n  ${REPLAY} @ ${(AT_MS / 60000).toFixed(1)}min, ${SECONDS}s sample, speed ${SPEED}\n  ${url}\n\n`);

  // --perf=key:value,key:value — override WC3V_CONFIG.perf switches before
  // any game code runs (e.g. --perf=staticPoseLOD:false to A/B the LOD).
  if (args.perf) {
    const overrides = {};
    for (const kv of String(args.perf).split(',')) {
      const [k, v] = kv.split(':');
      // Keep non-numeric strings as strings — some switches take word values
      // (e.g. canvasRenderScale:auto), and +v would turn those into NaN.
      overrides[k] = v === 'true' ? true
                   : v === 'false' ? false
                   : (v !== '' && !isNaN(+v)) ? +v
                   : v;
    }
    await page.evaluateOnNewDocument((ov) => {
      const apply = () => {
        if (window.WC3V_CONFIG && window.WC3V_CONFIG.perf) {
          Object.assign(window.WC3V_CONFIG.perf, ov);
        } else {
          setTimeout(apply, 5);
        }
      };
      apply();
    }, overrides);
    process.stdout.write(`  perf overrides: ${JSON.stringify(overrides)}\n`);
  }

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for the game to be loaded and actually playing.
  try {
    await page.waitForFunction(
      () => window.wc3v && window.wc3v.gameLoaded && window.wc3v.state === 2 /* ScrubStates.playing */,
      { timeout: 120000, polling: 250 }
    );
  } catch (e) {
    // Dump enough to see WHY it never started before bailing.
    const state = await page.evaluate(() => {
      const v = window.wc3v;
      return {
        hasViewer: !!v,
        gameLoaded: v && v.gameLoaded,
        state: v && v.state,
        loadingFailed: !!document.querySelector('.ls-failed, .ls-error'),
        loadingText: (document.querySelector('#boot-loading, .ls-wrap') || {}).textContent
      };
    }).catch(() => null);
    console.error('\n  never reached playing state:', JSON.stringify(state));
    if (misses.length) console.error('  404s:', [...new Set(misses)].slice(0, 20).join('\n        '));
    if (errors.length) console.error('  page errors:', [...new Set(errors)].slice(0, 10).join('\n        '));
    try { await browser.close(); } catch (e) { if (!e || e.code !== 'EBUSY') throw e; }
    process.exit(2);
  }

  // Deterministic playback: fixed speed, AUTO director off. Camera stays on
  // whatever the page picked (broadcast for 1v1) unless --free asked for the
  // whole-map view, which is the worst-case unit count.
  await page.evaluate((speed, free) => {
    const v = window.wc3v;
    try {
      if (v.scrubber) { v.scrubber.isAuto = false; v.scrubber.speed = speed; }
    } catch (e) {}
    if (free) {
      try {
        // Broadcast camera off -> d3 transform stays at the fitted whole-map view.
        if (v.broadcastCamera) v.broadcastCamera.enabled = false;
      } catch (e) {}
    }
  }, SPEED, !!args.free);

  // --view=key:value,key:value — override viewer viewOptions after load
  // (e.g. --view=displayTeleports:false,displayText:false) to A/B one
  // feature layer's frame cost. Same value parsing as --perf.
  if (args.view) {
    const vov = {};
    for (const kv of String(args.view).split(',')) {
      const [k, v] = kv.split(':');
      vov[k] = v === 'true' ? true
             : v === 'false' ? false
             : (v !== '' && !isNaN(+v)) ? +v
             : v;
    }
    await page.evaluate((ov) => {
      if (window.wc3v && window.wc3v.viewOptions) Object.assign(window.wc3v.viewOptions, ov);
    }, vov);
    process.stdout.write(`  viewOptions overrides: ${JSON.stringify(vov)}\n`);
  }

  // Let models/GLBs stream in, then re-seek to EXACTLY the requested game
  // time and restart playback. Without this the sampled game-time window
  // drifts run to run (the settle is wall-clock), and a teleport cinematic /
  // big fight landing inside one run's window but not the other's swamps the
  // effect being measured.
  await new Promise(r => setTimeout(r, 6000));
  await page.evaluate((at) => {
    const v = window.wc3v;
    v.pause();
    v.seekToGameTime(at);
  }, AT_MS);
  await new Promise(r => setTimeout(r, 1500)); // post-seek churn (mixers, camera snap)

  // --still: PAUSED shot of one exact game frame, then exit. This is the
  // pixel-verification path — a shot taken at the end of a playback window
  // lands on a different gameTime every run (the window is wall-clock), so it
  // can't be diffed against another build. Paused at AT_MS it can.
  // --shotclip=<selector> crops to an element (e.g. #canvas-group) so unit
  // icons, rings and nameplates can be compared close-up.
  // --split: force the split-screen render path. AUTO only splits when the
  // director decides two fights are far enough apart, which no fixed seek can
  // guarantee — but split-screen is its own render path (two clipped halves +
  // a drawImage composite of the GL canvas onto main-canvas) and needs
  // verifying on demand. Targets are the two players' main heroes.
  if (args.split) {
    const ok = await page.evaluate(() => {
      const v = window.wc3v;
      const bc = v && v.broadcastCamera;
      if (!bc || !window.CameraMode) return 'no broadcast camera';
      const live = v.players.filter(p => !p.isNeutralPlayer).slice(0, 2);
      if (live.length < 2) return 'need two players';
      const anchor = (p) => {
        const h = p.units.find(u => u.meta && u.meta.hero && u.currentX != null);
        const u = h || p.units.find(x => x.currentX != null);
        return u ? { wx: u.currentX, wy: u.currentY, k: 3 } : null;
      };
      const top = anchor(live[0]);
      const bottom = anchor(live[1]);
      if (!top || !bottom) return 'no anchor units';
      bc.setMode(window.CameraMode.SPLIT_SCREEN);
      bc.splitTargets = { top, bottom };
      bc._splitRawTargets = { top, bottom };
      v.render();
      return true;
    });
    process.stdout.write(`  split-screen: ${ok === true ? 'forced' : 'FAILED — ' + ok}\n`);
  }

  // --probe=<selector> — dump one element's computed geometry at the paused
  // frame. Overlay bugs ("it isn't drawing") are almost always a layout box of
  // the wrong size or in the wrong place, and a screenshot cannot tell you
  // which; this can. Also reports HudCharts' internal size state, since that
  // class deliberately never reads clientWidth and can only learn its box from
  // a ResizeObserver — a discrepancy here IS the bug.
  if (args.probe) {
    const info = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const out = { selector: sel, found: !!el };
      if (el) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        out.rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        out.display = cs.display;
        out.zIndex = cs.zIndex;
        out.classList = [...el.classList];
        if (el.tagName === 'CANVAS') out.backing = el.width + 'x' + el.height;
        const p = el.parentElement;
        if (p) {
          const pr = p.getBoundingClientRect();
          out.parent = (p.id || p.tagName) + ' ' + Math.round(pr.width) + 'x' + Math.round(pr.height);
        }
      }
      const v = window.wc3v;
      const hc = v && v.hudCharts;
      out.hudCharts = hc
        ? { cssW: hc._cssW, cssH: hc._cssH, built: hc._built, visible: hc._visible,
            rows: hc._rows.length, dpr: hc._dpr, hasDom: !!hc._dom, hasFood: !!hc._food }
        : 'null';

      const bc = v && v.battleCallout;
      if (bc) {
        const t = v.gameTime;
        const active = bc._models.filter(m => t >= m.t0 && t <= m.t1);
        out.battleCallout = {
          models: bc._models.length,
          activeNow: active.length,
          windows: bc._models.slice(0, 4).map(m => Math.round(m.t0 / 1000) + '-' + Math.round(m.t1 / 1000) + 's'),
          sample: active[0] ? active[0].lines.map(l => l.kind + ': ' + l.text) : null
        };
      } else out.battleCallout = 'null';

      // Selection: what each player holds at this instant, and how much of it
      // resolved to a unit the client actually knows about.
      const umr0 = v && v.unitModelRenderer;
      out.selection = (v && v.players || []).filter(p => !p.isNeutralPlayer).map(p => ({
        player: p.playerId,
        selected: p.currentGroup ? p.currentGroup.length : 0,
        atT: p.currentGroupT,
        // Why each selected unit did or didn't get a hoop. A silent zero here
        // is the difference between "nothing was selected" and "the ring pass
        // is skipping everything", and only this tells them apart.
        units: (p.currentGroup || []).map(u => {
          const inst = umr0 && umr0.instances[u.uuid];
          let why = 'drawn (3D hoop)';
          if (u.isBuilding) {
            const fd = v._frameData;
            const list = (fd && fd.buildingPositions) || [];
            const b = list.find(x => x.uuid === u.uuid);
            // Not drawn this frame is a legitimate outcome (off-camera, or
            // mid-morph) — the count says whether the list itself is healthy.
            why = b ? 'drawn (2D building ring)'
              : 'not rendered this frame (' + list.length + ' buildings drawn)';
          }
          else if (!inst) why = 'no instance';
          else if (typeof inst === 'string') why = 'instance=' + inst;
          else if (!inst.root || !inst.root.visible) why = 'root hidden';
          else if (inst.state === 'death') why = 'death';
          else if (inst._posFrame !== umr0._frameSeq) why = 'stale position (not placed this frame)';
          return (u.displayName || u.itemId) + ' -> ' + why;
        })
      }));
      const umr = v && v.unitModelRenderer;
      out.selectionPool = umr && umr._selectionPool
        ? { capacity: umr._selectionPool.capacity, drawn: umr._selectionPool.mesh.count }
        : 'null';
      return out;
    }, String(args.probe));
    process.stdout.write('  probe: ' + JSON.stringify(info, null, 2).replace(/\n/g, '\n  ') + '\n');
  }

  if (args.still) {
    const outPath = typeof args.still === 'string'
      ? args.still
      : path.join(process.env.TEMP || '/tmp', `wc3v-still-${LABEL || 'run'}.png`);
    // captureBeyondViewport must be off: with a clip, puppeteer's default
    // (true) asks for a full-surface capture, which never commits a frame on a
    // WebGL page and times the protocol call out.
    const opts = { path: outPath, captureBeyondViewport: false };
    if (args.shotclip) {
      const box = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }, String(args.shotclip));
      if (box && box.width > 0) opts.clip = box;
      else process.stdout.write(`  shotclip: no element matched ${args.shotclip}\n`);
    }
    const sizing = await page.evaluate(() => {
      const gs = window.wc3v && window.wc3v.gameScaler;
      const m = document.getElementById('main-canvas');
      if (!gs || !gs.mapImage || !m) return null;
      return {
        renderScale: gs.renderScale,
        logical: `${gs.mapImage.width}x${gs.mapImage.height}`,
        buffer: `${m.width}x${m.height}`,
        css: `${m.clientWidth}x${m.clientHeight}`
      };
    });
    await page.screenshot(opts);
    if (sizing) {
      process.stdout.write(`  renderScale ${sizing.renderScale}  logical ${sizing.logical}  buffer ${sizing.buffer}  css ${sizing.css}\n`);
    }
    process.stdout.write(`  still: ${outPath}\n`);
    if (errors.length) {
      process.stdout.write(`  page errors (${errors.length}):\n    ${[...new Set(errors)].slice(0, 8).join('\n    ')}\n`);
    }
    try { await browser.close(); } catch (e) { if (!e || e.code !== 'EBUSY') throw e; }
    return;
  }

  await page.evaluate(() => { window.wc3v.play(); });
  await new Promise(r => setTimeout(r, 500));

  // --- Sample window: rAF deltas + V8 CPU profile, same interval ---
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); // µs
  await cdp.send('Profiler.start');

  const frames = await page.evaluate((durMs) => new Promise(resolve => {
    const ds = [];
    let last = performance.now();
    const t0 = last;
    function tick (t) {
      ds.push(t - last);
      last = t;
      if (t - t0 < durMs) requestAnimationFrame(tick);
      else resolve(ds);
    }
    requestAnimationFrame(tick);
  }), SECONDS * 1000);

  const { profile } = await cdp.send('Profiler.stop');

  // --- Scene + renderer stats after the window ---
  const stats = await page.evaluate(() => {
    const v = window.wc3v;
    const out = { gameTime: v && v.gameTime };
    const three = v && v.threeMapRenderer;
    if (three && three.renderer) {
      const info = three.renderer.info;
      out.drawCalls = info.render.calls;
      out.triangles = info.render.triangles;
      out.programs = info.programs ? info.programs.length : null;
      out.geometries = info.memory.geometries;
      out.textures = info.memory.textures;
    }
    if (three && three.scene) {
      let objects = 0, skinned = 0, skinnedVisible = 0, bones = 0, meshes = 0;
      three.scene.traverse(o => {
        objects++;
        if (o.isBone) bones++;
        if (o.isMesh) meshes++;
        if (o.isSkinnedMesh) { skinned++; if (o.visible) skinnedVisible++; }
      });
      out.sceneObjects = objects;
      out.meshes = meshes;
      out.skinnedMeshes = skinned;
      out.skinnedVisible = skinnedVisible;
      out.bones = bones;
    }
    if (window.WC3V_PERF && window.WC3V_PERF.snapshot) {
      out.stages = window.WC3V_PERF.snapshot();
    }
    const dpr = window.devicePixelRatio;
    const c = document.getElementById('three-canvas');
    if (c) out.threeCanvas = { w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight, dpr };
    // Backing-store right-sizing (perf.canvasRenderScale): logical is the
    // coordinate space, buffer is what actually gets rasterized. If these are
    // equal the lever is off.
    const gs = v && v.gameScaler;
    const m = document.getElementById('main-canvas');
    if (gs && gs.mapImage) {
      out.canvasSizing = {
        renderScale: gs.renderScale,
        logical: `${gs.mapImage.width}x${gs.mapImage.height}`,
        buffer2d: m ? `${m.width}x${m.height}` : null,
        cssBox: m ? `${m.clientWidth}x${m.clientHeight}` : null,
        // Fill-rate multiple vs the displayed box, per canvas.
        overdraw: (m && m.clientWidth)
          ? +((m.width * m.height) / (m.clientWidth * m.clientHeight * dpr * dpr)).toFixed(2)
          : null
      };
    }
    return out;
  });

  if (args.shots) {
    const shot = path.join(process.env.TEMP || '/tmp', `wc3v-perf-${LABEL || 'run'}.png`);
    await page.screenshot({ path: shot });
    process.stdout.write(`  screenshot: ${shot}\n`);
  }

  // --eval=<expr> — evaluate an expression in the page AFTER the sampling
  // window and print the JSON result. For reading experiment counters left by
  // a --swap'd instrumented library, or any ad-hoc page state.
  if (args.eval) {
    try {
      const val = await page.evaluate((src) => {
        // eslint-disable-next-line no-eval
        return JSON.parse(JSON.stringify(eval(src)));
      }, String(args.eval));
      process.stdout.write(`  eval ${args.eval}:\n${JSON.stringify(val, null, 2)}\n`);
    } catch (e) {
      process.stdout.write(`  eval FAILED: ${e.message}\n`);
    }
  }

  try { await browser.close(); } catch (e) { if (!e || e.code !== 'EBUSY') throw e; }

  // --- Aggregate the CPU profile: self time per function, per file ---
  const nodeById = new Map();
  for (const n of profile.nodes) nodeById.set(n.id, n);
  const selfMicros = new Map(); // nodeId -> µs
  const samples = profile.samples || [];
  const deltas = profile.timeDeltas || [];
  for (let i = 0; i < samples.length; i++) {
    const id = samples[i];
    selfMicros.set(id, (selfMicros.get(id) || 0) + (deltas[i] || 0));
  }
  const totalMicros = deltas.reduce((a, b) => a + b, 0);

  function frameName (cf) {
    const fn = cf.functionName || '(anonymous)';
    if (!cf.url) return fn;
    const file = cf.url.split('/').pop().split('?')[0];
    return `${fn}  ${file}:${cf.lineNumber + 1}`;
  }

  const byFunc = new Map();
  const byFile = new Map();
  for (const [id, us] of selfMicros) {
    const n = nodeById.get(id);
    if (!n) continue;
    const cf = n.callFrame;
    const fnKey = frameName(cf);
    byFunc.set(fnKey, (byFunc.get(fnKey) || 0) + us);
    let fileKey = cf.url ? cf.url.split('/').pop().split('?')[0] : '(v8)';
    if (!fileKey) fileKey = '(page)';
    byFile.set(fileKey, (byFile.get(fileKey) || 0) + us);
  }
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

  // --- Frame stats (drop the first 5: profiler spin-up jitter) ---
  const ds = frames.slice(5).sort((a, b) => a - b);
  const pct = q => ds[Math.min(ds.length - 1, Math.floor(ds.length * q))];
  const avg = ds.reduce((a, b) => a + b, 0) / ds.length;
  const frameStats = {
    frames: ds.length,
    avgMs: +avg.toFixed(2),
    fpsAvg: +(1000 / avg).toFixed(1),
    p50Ms: +pct(0.5).toFixed(2),
    p95Ms: +pct(0.95).toFixed(2),
    p99Ms: +pct(0.99).toFixed(2),
    worstMs: +ds[ds.length - 1].toFixed(2)
  };

  const padL = (s, n) => String(s).padStart(n);
  process.stdout.write(`  frames ${frameStats.frames}   avg ${frameStats.avgMs}ms (${frameStats.fpsAvg} fps)   p50 ${frameStats.p50Ms}   p95 ${frameStats.p95Ms}   p99 ${frameStats.p99Ms}   worst ${frameStats.worstMs}\n`);
  if (stats.drawCalls != null) {
    process.stdout.write(`  draws ${stats.drawCalls}   tris ${(stats.triangles / 1000).toFixed(0)}k   programs ${stats.programs}   scene ${stats.sceneObjects} objs / ${stats.meshes} meshes / ${stats.skinnedVisible}/${stats.skinnedMeshes} skinned visible / ${stats.bones} bones\n`);
  }
  if (stats.threeCanvas) {
    const c = stats.threeCanvas;
    process.stdout.write(`  three-canvas ${c.w}x${c.h} buffer over ${c.cssW}x${c.cssH} css (dpr ${c.dpr})\n`);
  }
  if (stats.stages) {
    process.stdout.write('\n  WC3V_PERF stages (ms/frame avg):\n');
    for (const [k, v] of Object.entries(stats.stages)) {
      process.stdout.write(`    ${k.padEnd(22)} ${padL(typeof v === 'number' ? v.toFixed(2) : v, 8)}\n`);
    }
  }

  process.stdout.write('\n  top self-time by FILE (% of sampled time):\n');
  for (const [k, us] of top(byFile, 12)) {
    process.stdout.write(`    ${k.padEnd(34)} ${padL((100 * us / totalMicros).toFixed(1), 6)}%  ${padL((us / 1000).toFixed(0), 6)}ms\n`);
  }
  process.stdout.write('\n  top self-time by FUNCTION:\n');
  for (const [k, us] of top(byFunc, 25)) {
    process.stdout.write(`    ${k.padEnd(58)} ${padL((100 * us / totalMicros).toFixed(1), 6)}%  ${padL((us / 1000).toFixed(0), 6)}ms\n`);
  }

  if (misses.length) {
    const uniq = [...new Set(misses)];
    process.stdout.write(`\n  404s served by the bench (${uniq.length}):\n`);
    uniq.slice(0, 15).forEach(m => process.stdout.write(`    ${m}\n`));
  }
  if (errors.length) {
    process.stdout.write(`\n  page errors (${errors.length}):\n`);
    [...new Set(errors)].slice(0, 10).forEach(e => process.stdout.write(`    ${e.slice(0, 200)}\n`));
  }

  if (args.cpuprofile) {
    fs.writeFileSync(args.cpuprofile, JSON.stringify(profile));
    process.stdout.write(`\n  cpu profile: ${args.cpuprofile} (DevTools > Performance > load)\n`);
  }
  if (args.json) {
    fs.writeFileSync(args.json, JSON.stringify({
      label: LABEL, replay: REPLAY, atMs: AT_MS, seconds: SECONDS, speed: SPEED,
      free: !!args.free, frameStats, stats,
      topFiles: top(byFile, 20).map(([k, us]) => [k, +(us / 1000).toFixed(1)]),
      topFunctions: top(byFunc, 40).map(([k, us]) => [k, +(us / 1000).toFixed(1)])
    }, null, 2));
    process.stdout.write(`  json: ${args.json}\n`);
  }
  process.stdout.write('\n');
  sweepOrphanBrowsers();
})().catch(e => { console.error(e); sweepOrphanBrowsers(); process.exit(1); });
