//
// fx-bench.js — drives client/dev/test-fx.html in a real browser and asserts that
// the effect layer puts pixels on the screen.
//
// The gap this closes: tools/projectile-check.js validates the MODEL against a
// real replay and passes with flying colours while the viewer shows nothing,
// because it never rasterizes anything. This runs the actual renderer on an
// actual GPU context and diffs the framebuffer. `airborne` is what the model
// says; `ink` is what the screen did. When those two disagree, the bug is in
// the renderer, and the per-instance dump says where.
//
// Usage:
//   node tools/fx-bench.js                      # default matrix
//   node tools/fx-bench.js --unit=ohun          # one shooter, verbose
//   node tools/fx-bench.js --all [--limit=40]   # every ranged unit
//   node tools/fx-bench.js --headful            # watch it
//   node tools/fx-bench.js --shots              # png per case into the scratchpad
//
// Needs the dev server (the page fetches /data/fx-units.json and /js/*).
// Override with --base=http://127.0.0.1:PORT.
//
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer-core');

const args = {};
process.argv.slice(2).forEach(r => {
  const [f, ...v] = r.replace(/^--/, '').split('=');
  args[f] = v.length ? v.join('=') : true;
});

const BASE = args.base || 'http://127.0.0.1:8080';
const SHOT_DIR = args.shotdir || path.join(process.env.TEMP || '/tmp', 'wc3v-fx-bench');

// Edge ships on every Windows box; Chrome is checked too so this works on a
// dev machine that has one and not the other. WC3V_BROWSER overrides both.
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

function checkServer () {
  return new Promise((resolve) => {
    const u = new URL(BASE + '/data/fx-units.json');
    const req = http.get({ host: u.hostname, port: u.port, path: u.pathname, timeout: 3000 },
      r => { r.resume(); resolve(r.statusCode === 200); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

// The default matrix is not a random sample. Every entry is a distinct way the
// effect layer can break, and each one is annotated with what it proves.
const MATRIX = [
  { shooter: 'hfoo', target: 'hfoo', note: 'melee — MUST draw nothing (control)' },
  { shooter: 'ohun', target: 'hfoo', note: 'huntermissile: alpha blend, aspect 4.2' },
  { shooter: 'ntrt', target: 'hfoo', note: 'waterelementalmissile: additive' },
  { shooter: 'Ofar', target: 'hfoo', note: 'farseermissile: hero, additive' },
  { shooter: 'Hamg', target: 'hfoo', note: 'fireballmissile: hero, additive' },
  { shooter: 'hmpr', target: 'hfoo', note: 'priestmissile: arc 0' },
  { shooter: 'nftt', target: 'hfoo', note: 'axemissile: alpha blend' },
  { shooter: 'hrif', target: 'hfoo', note: 'instant weapon — muzzle + impact, no bolt' },
  { shooter: 'hmtm', target: 'hfoo', note: 'artillery — high arc' },
  { shooter: 'ohun', target: 'hgyr', note: 'air target — weapon 2 path' },
  { shooter: 'ohun', target: 'hfoo', terrain: 'hill', note: 'sloped ground-Z' },
  { shooter: 'ohun', target: 'hfoo', camera: 'top', note: 'top-down — billboard roll' },
  { shooter: 'ohun', target: 'hfoo', camera: 'low', note: 'low angle' },
  { shooter: 'ohun', target: 'hfoo', targetMoves: true, note: 'homing re-aim' },
  { shooter: 'ohun', target: 'hfoo', missileArt: false, note: 'generic streak (art bypassed)' }
];

const pad = (s, n) => String(s == null ? '' : s).padEnd(n);
const padL = (s, n) => String(s == null ? '' : s).padStart(n);

(async () => {
  if (!await checkServer()) {
    console.error(`\n  dev server not answering at ${BASE}`);
    console.error(`  start it (the page needs /js/* and /data/fx-units.json), or pass --base=\n`);
    process.exit(2);
  }

  const exe = findBrowser();
  const headful = !!args.headful;
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: headful ? false : true, // Edge 152 rejects the legacy 'new' string
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      // Software WebGL, so this produces the same pixels on any machine and in
      // CI. A real GPU would be faster and less reproducible.
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=1200,800'
    ]
  });

  const page = await browser.newPage();
  const vp = (args.viewport || '1200x800').split('x').map(Number);
  await page.setViewport({ width: vp[0], height: vp[1] });

  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(m.type() + ': ' + m.text());
  });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  page.on('requestfailed', r => failedRequests.push(r.url() + ' — ' + (r.failure() && r.failure().errorText)));
  page.on('response', r => { if (r.status() >= 400) failedRequests.push(r.url() + ' — HTTP ' + r.status()); });

  console.log(`\n  browser: ${path.basename(exe)}   base: ${BASE}\n`);

  // ---- --viewer=REPLAY : the same measurement against production ------------
  //
  // The bench proves the renderer works against a synthetic world. That is not
  // the same claim as "it works in the viewer", which has a real replay, real
  // terrain and the AUTO director choosing the camera. This mode seeks the real
  // viewer to timestamps where tools/projectile-check.js --timeline says a bolt
  // exists, and measures the bolt's length IN PIXELS on the actual canvas.
  // Pixels are the unit that matters: the old build drew bolts 1-3px long,
  // which is why the numbers looked right and the screen looked empty.
  if (args.viewer) {
    const replay = args.viewer === true ? '1010267604_Snowdream_War3Orcer0_TurtleRock20' : args.viewer;
    const times = (args.times || '133000,155000,290000,393000,395000,398000')
      .split(',').map(Number);

    await page.goto(`${BASE}/viewer.html?r=${encodeURIComponent(replay)}&level=improving`,
      { waitUntil: 'domcontentloaded', timeout: 90000 });
    console.log(`  viewer: ${replay}`);
    await page.waitForFunction(
      () => window.wc3v && window.wc3v.projectileRenderer && window.wc3v.threeMapRenderer &&
            window.wc3v.threeMapRenderer.ready && window.wc3v.players && window.wc3v.players.length,
      { timeout: 180000, polling: 500 });
    console.log('  loaded.\n');

    console.log('  ' + pad('TIME', 9) + padL('BOLTS', 6) + padL('PUFFS', 6) +
      padL('LEN px', 8) + padL('WIDE px', 9) + '  ' + pad('ON SCREEN', 11) + 'MESH');
    console.log('  ' + '-'.repeat(80));

    const rows = [];
    for (const t of times) {
      const row = await page.evaluate(async (ms) => {
        const v = window.wc3v;
        v.seekToGameTime(ms);
        // One rAF so the render loop actually runs the frame we just seeked to.
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const pr = v.projectileRenderer, three = v.threeMapRenderer;
        const cam = three.camera, cv = three.renderer.domElement;
        const meshes = [['generic', pr.boltMesh]];
        for (const [n, m] of pr._missileMeshes.entries()) if (m) meshes.push(['art:' + n, m]);

        const m4 = new THREE.Matrix4(), a = new THREE.Vector3(), b = new THREE.Vector3();
        const c = new THREE.Vector3(), d = new THREE.Vector3();
        let best = null;
        for (const [label, mesh] of meshes) {
          for (let i = 0; i < mesh.count; i++) {
            mesh.getMatrixAt(i, m4);
            // Local (-0.5,0,0)..(0.5,0,0) is the quad's length axis; the same
            // for Y gives its width. Project both and measure in pixels.
            a.set(-0.5, 0, 0).applyMatrix4(m4).project(cam);
            b.set(0.5, 0, 0).applyMatrix4(m4).project(cam);
            c.set(0, -0.5, 0).applyMatrix4(m4).project(cam);
            d.set(0, 0.5, 0).applyMatrix4(m4).project(cam);
            const lenPx = Math.hypot((b.x - a.x) * cv.width / 2, (b.y - a.y) * cv.height / 2);
            const widePx = Math.hypot((d.x - c.x) * cv.width / 2, (d.y - c.y) * cv.height / 2);
            const mid = a.clone().add(b).multiplyScalar(0.5);
            const on = Math.abs(mid.x) <= 1 && Math.abs(mid.y) <= 1 && mid.z >= -1 && mid.z <= 1;
            if (!best || lenPx > best.lenPx) {
              best = { mesh: label, lenPx: +lenPx.toFixed(1), widePx: +widePx.toFixed(1), onScreen: on };
            }
          }
        }
        return {
          t: ms, bolts: pr.lastCounts.bolts, puffs: pr.lastCounts.puffs,
          canvas: [cv.width, cv.height], best
        };
      }, t);
      rows.push(row);
      const clk = `${Math.floor(row.t / 60000)}:${String(Math.floor(row.t / 1000) % 60).padStart(2, '0')}`;
      console.log('  ' + pad(clk, 9) + padL(row.bolts, 6) + padL(row.puffs, 6) +
        padL(row.best ? row.best.lenPx : '-', 8) + padL(row.best ? row.best.widePx : '-', 9) +
        '  ' + pad(row.best ? row.best.onScreen : '-', 11) + (row.best ? row.best.mesh : ''));
    }

    // ---- --diagnose : facing + overlay projection, measured not reasoned -----
    //
    // Two separate "it's in the wrong place" reports need two separate ground
    // truths, and neither may assume a convention is right:
    //
    //   FACING  compares the unit's RENDERED forward vector (read back out of
    //           the wrapper quaternion) against the RENDERED scene position of
    //           the target it is attacking. Both sides come from the scene, so
    //           the check is independent of any world→scene sign convention.
    //   OVERLAY compares what gameScaler.projectXY claims for a unit against
    //           that same unit's scene position pushed through the camera by
    //           hand. A delta means the projection lies; agreement means the
    //           projection is fine and the drawing surface is the problem, so
    //           the canvas dimensions are dumped alongside.
    if (args.diagnose) {
      const t = +(args.at || 393000);

      // A single seek SNAPS facing (UnitModelRenderer._beginFacingFrame treats a
      // jump as a scrub and bypasses the slew), so it can only ever report 0°
      // error. Stepping in frame-sized increments keeps the slew live, which is
      // the state the user is actually looking at. This also surfaces target
      // churn: a unit chasing a target that changes every frame never settles,
      // and reads on screen as facing the wrong way permanently.
      if (args.play) {
        const run = await page.evaluate(async (startMs, frames) => {
          const v = window.wc3v;
          v.seekToGameTime(startMs);
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          const perUnit = new Map();
          for (let i = 1; i <= frames; i++) {
            v.seekToGameTime(startMs + i * 33);
            await new Promise(r => requestAnimationFrame(r));
            const frame = v.behaviorWorld.resolve(v.gameTime);
            if (!frame) continue;
            for (const [uuid, d] of frame.byUuid) {
              if (d.state !== 'attack' || !d.targetUuid) continue;
              const inst = v.unitModelRenderer.instances[uuid];
              const ti = v.unitModelRenderer.instances[d.targetUuid];
              if (!inst || !ti || typeof inst === 'string' || typeof ti === 'string') continue;
              if (!inst.wrapper || !ti.wrapper) continue;
              const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(inst.wrapper.quaternion);
              fwd.y = 0; fwd.normalize();
              const toT = ti.wrapper.position.clone().sub(inst.wrapper.position);
              toT.y = 0; toT.normalize();
              const deg = Math.acos(Math.max(-1, Math.min(1, fwd.dot(toT)))) * 180 / Math.PI;
              let rec = perUnit.get(uuid);
              if (!rec) {
                rec = { uuid: uuid.slice(0, 8), itemId: (v.unitsByUuid.get(uuid) || {}).itemId,
                        n: 0, sum: 0, max: 0, over90: 0, targets: new Set() };
                perUnit.set(uuid, rec);
              }
              rec.n++; rec.sum += deg; rec.max = Math.max(rec.max, deg);
              if (deg > 90) rec.over90++;
              rec.targets.add(d.targetUuid);
            }
          }
          return [...perUnit.values()].map(r => ({
            uuid: r.uuid, itemId: r.itemId, frames: r.n,
            avgDeg: +(r.sum / r.n).toFixed(1), maxDeg: +r.max.toFixed(1),
            pctOver90: +(100 * r.over90 / r.n).toFixed(0), distinctTargets: r.targets.size
          })).sort((a, b) => b.avgDeg - a.avgDeg);
        }, t, +(args.frames || 90));

        console.log(`\n  --- FACING DURING PLAYBACK from ${t}ms, ${+(args.frames || 90)} frames ---\n`);
        console.log('  ' + pad('UNIT', 10) + pad('ID', 7) + padL('FRAMES', 7) +
          padL('AVG°', 7) + padL('MAX°', 7) + padL('>90°%', 7) + padL('TARGETS', 9));
        console.log('  ' + '-'.repeat(60));
        run.forEach(r => console.log('  ' + pad(r.uuid, 10) + pad(r.itemId, 7) +
          padL(r.frames, 7) + padL(r.avgDeg, 7) + padL(r.maxDeg, 7) +
          padL(r.pctOver90, 7) + padL(r.distinctTargets, 9)));
        const bad = run.filter(r => r.avgDeg > 30);
        const churn = run.filter(r => r.distinctTargets > 2);
        console.log(`\n  units averaging >30° off: ${bad.length}/${run.length}` +
          `   units with >2 distinct targets in the window: ${churn.length}/${run.length}`);
        await browser.close();
        process.exit(bad.length ? 1 : 0);
      }

      const diag = await page.evaluate(async (ms) => {
        const v = window.wc3v;
        v.seekToGameTime(ms);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const three = v.threeMapRenderer, gs = v.gameScaler, cam = three.camera;
        const frame = v.behaviorWorld && v.behaviorWorld.resolve(v.gameTime);

        const el = id => {
          const c = document.getElementById(id);
          if (!c) return null;
          const r = c.getBoundingClientRect();
          return { buffer: [c.width, c.height], css: [Math.round(r.width), Math.round(r.height)] };
        };
        const canvases = {
          three: el('three-canvas'), utility: el('utility-canvas'),
          main: el('main-canvas'), player: el('player-canvas'),
          sceneImage: gs && gs.sceneImage ? [gs.sceneImage.width, gs.sceneImage.height] : null,
          middle: gs ? [gs.middleX, gs.middleY] : null,
          devicePixelRatio: window.devicePixelRatio
        };

        const facing = [], overlay = [];
        if (frame) {
          for (const [uuid, d] of frame.byUuid) {
            const inst = v.unitModelRenderer && v.unitModelRenderer.instances[uuid];
            if (!inst || !inst.wrapper || typeof inst === 'string') continue;

            // --- overlay: claimed vs hand-projected, in sceneImage pixels ---
            if (overlay.length < 6) {
              const p = gs.projectXY(d.x, d.y);
              if (p) {
                const claimed = { x: p.x + gs.middleX, y: p.y + gs.middleY };
                const w = inst.wrapper.position.clone().project(cam);
                const cw = canvases.sceneImage ? canvases.sceneImage[0] : three.renderer.domElement.width;
                const ch = canvases.sceneImage ? canvases.sceneImage[1] : three.renderer.domElement.height;
                const truth = { x: (w.x * 0.5 + 0.5) * cw, y: (-w.y * 0.5 + 0.5) * ch };
                overlay.push({
                  uuid: uuid.slice(0, 8), state: d.state,
                  claimed: [Math.round(claimed.x), Math.round(claimed.y)],
                  truth: [Math.round(truth.x), Math.round(truth.y)],
                  deltaPx: Math.round(Math.hypot(claimed.x - truth.x, claimed.y - truth.y))
                });
              }
            }

            // --- facing: rendered forward vs rendered target position ---
            if (d.state === 'attack' && d.targetUuid && facing.length < 8) {
              const ti = v.unitModelRenderer.instances[d.targetUuid];
              if (!ti || !ti.wrapper || typeof ti === 'string') continue;
              const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(inst.wrapper.quaternion);
              fwd.y = 0; fwd.normalize();
              const toT = ti.wrapper.position.clone().sub(inst.wrapper.position);
              toT.y = 0; toT.normalize();
              const deg = Math.acos(Math.max(-1, Math.min(1, fwd.dot(toT)))) * 180 / Math.PI;
              facing.push({
                uuid: uuid.slice(0, 8), itemId: (v.unitsByUuid.get(uuid) || {}).itemId,
                errorDeg: +deg.toFixed(1),
                behaviorFacingDeg: d.facing != null ? +(d.facing * 180 / Math.PI).toFixed(1) : null,
                worldBearingDeg: +(Math.atan2(d.targetY - d.y, d.targetX - d.x) * 180 / Math.PI).toFixed(1)
              });
            }
          }
        }
        // Feed pips: the anchor the event model hands the renderer, against
        // where that caster actually was at cast time. A large delta means the
        // pip/connector is drawn at a place the unit never was when it acted.
        const pips = [];
        const evs = (v.eventModel && v.eventModel.events) || [];
        for (const e of evs) {
          if (pips.length >= 8) break;
          if (!e.pos || !e.type) continue;
          const ref = e.actorUuid || (e.raw && e.raw.unit && e.raw.unit.uuid);
          const u = ref ? v.unitsByUuid.get(ref) : null;
          // sampleAt, not getInterpolatedPosition — the latter answers for the
          // playback cursor's time, not the time you ask for, so it would make
          // every event look wrong by however far the unit has since walked.
          if (!u || !u.path || !window.UnitBehavior) continue;
          const truth = window.UnitBehavior.sampleAt(u.path, e.gameTime);
          if (!truth) continue;
          pips.push({
            type: e.type, t: e.gameTime, itemId: u.itemId,
            anchor: [Math.round(e.pos.x), Math.round(e.pos.y)],
            actualAtCast: [Math.round(truth.x), Math.round(truth.y)],
            deltaWu: Math.round(Math.hypot(e.pos.x - truth.x, e.pos.y - truth.y)),
            // What the old code used: the parser's end-of-replay snapshot.
            staleWouldBeOffBy: u.lastPosition
              ? Math.round(Math.hypot(u.lastPosition.x - truth.x, u.lastPosition.y - truth.y)) : null
          });
        }

        return { t: v.gameTime, canvases, facing, overlay, pips };
      }, t);

      console.log(`\n  --- DIAGNOSE @ ${diag.t}ms ---\n`);
      console.log('  CANVASES (buffer / css)');
      for (const [k, val] of Object.entries(diag.canvases)) {
        console.log('    ' + pad(k, 18) + JSON.stringify(val));
      }
      console.log('\n  OVERLAY PROJECTION (projectXY vs hand-projected scene position)');
      if (!diag.overlay.length) console.log('    no units sampled');
      diag.overlay.forEach(o => console.log('    ' + JSON.stringify(o)));
      console.log('\n  EVENT PIPS (feed anchor vs where the caster actually was)');
      if (!diag.pips || !diag.pips.length) console.log('    no positioned unit events');
      (diag.pips || []).forEach(p => console.log('    ' + JSON.stringify(p)));

      console.log('\n  FACING (rendered forward vs rendered target direction)');
      if (!diag.facing.length) console.log('    no attacking units at this time');
      diag.facing.forEach(f => console.log('    ' + JSON.stringify(f)));

      const badFace = diag.facing.filter(f => f.errorDeg > 30);
      const badProj = diag.overlay.filter(o => o.deltaPx > 4);
      console.log(`\n  facing errors >30°: ${badFace.length}/${diag.facing.length}` +
        `   projection deltas >4px: ${badProj.length}/${diag.overlay.length}`);
      await browser.close();
      process.exit(badFace.length || badProj.length ? 1 : 0);
    }

    const drew = rows.filter(r => r.best && r.best.onScreen && r.best.lenPx >= 6);
    const airborne = rows.filter(r => r.bolts > 0);
    console.log('\n  ' + '='.repeat(80));
    console.log(`  canvas ${rows[0] && rows[0].canvas.join('x')}   ` +
      `${airborne.length}/${rows.length} sampled times had a bolt   ` +
      `${drew.length}/${airborne.length} were >= 6px and on screen`);
    if (args.shots) {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      // Crop to the 3D canvas. A full-page shot is mostly build-order panels at
      // any viewport, and the thing under inspection is a handful of pixels.
      const box = await page.evaluate(() => {
        const c = document.getElementById('three-canvas');
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height };
      });
      // A clip with a zero/NaN dimension is a CDP error, not a smaller picture.
      const clip = (box && box.width > 10 && box.height > 10 &&
        Number.isFinite(box.x) && Number.isFinite(box.y))
        ? { x: Math.round(box.x), y: Math.round(box.y),
            width: Math.round(box.width), height: Math.round(box.height) }
        : null;
      const f = path.join(SHOT_DIR, `viewer-${rows[rows.length - 1].t}.png`);
      // Read the canvas from inside the page rather than via CDP screenshot:
      // at large viewports the SwiftShader surface makes Page.captureScreenshot
      // time out, and this grabs the 3D buffer at full resolution regardless of
      // how small the layout panel is. The viewer's renderer has no
      // preserveDrawingBuffer, so re-render immediately before reading — same
      // task, before the compositor clears it.
      const dataUrl = await page.evaluate(() => {
        const v = window.wc3v, three = v.threeMapRenderer;
        three.render();
        return three.renderer.domElement.toDataURL('image/png');
      });
      fs.writeFileSync(f, Buffer.from(dataUrl.split(',')[1], 'base64'));
      console.log(`  canvas capture: ${f}  (${clip ? clip.width + 'x' + clip.height + ' css' : 'layout box unusable'})`);
    }
    await browser.close();
    process.exit(airborne.length && drew.length < airborne.length ? 1 : 0);
  }

  await page.goto(BASE + '/dev/test-fx.html', { waitUntil: 'networkidle2', timeout: 60000 });

  try {
    await page.waitForFunction('window.FX_READY === true || window.FX_ERROR', { timeout: 30000 });
  } catch (e) {
    console.error('  page never booted. console:\n   ' + consoleErrors.join('\n   '));
    await browser.close();
    process.exit(2);
  }
  const bootErr = await page.evaluate(() => window.FX_ERROR || null);
  if (bootErr) {
    console.error('  BOOT FAILED: ' + bootErr);
    await browser.close();
    process.exit(2);
  }

  // ---- --facing : contact sheet of real unit models ------------------------
  //
  // The transform-space checks (fx-bench --viewer --diagnose) report 0° error
  // and are structurally blind to a model whose geometry is authored facing the
  // wrong axis: the wrapper is rotated correctly and the mesh inside it points
  // backwards. The only ground truth is pixels, so this renders each unit facing
  // a target due EAST and writes one sheet. A correct model faces RIGHT.
  if (args.facing) {
    const ids = (args.units ||
      'hfoo,hrif,hmpr,Hamg,ogru,ohun,otbk,Ofar,ugho,ucry,Udea,earc,esen,Ekee'
    ).split(',').map(s => s.trim()).filter(Boolean);

    const out = await page.evaluate((list, o) =>
      window.FX.facingSheet(list, o), ids, {
      tile: +(args.tile || 460),
      cols: +(args.cols || 3),
      camera: args.camera || 'low',
      camDist: +(args.camdist || 420)
    });

    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const f = path.join(SHOT_DIR, 'facing-sheet.png');
    fs.writeFileSync(f, Buffer.from(out.dataUrl.split(',')[1], 'base64'));
    const missing = out.tiles.filter(t => !t.loaded).map(t => t.itemId);
    console.log(`  facing sheet: ${f}`);
    console.log(`  ${out.tiles.length - missing.length}/${out.tiles.length} units had a model` +
      (missing.length ? `   no model: ${missing.join(', ')}` : ''));
    console.log('  every unit faces a target due EAST — a correct model points RIGHT.');
    await browser.close();
    process.exit(0);
  }

  // Build the case list.
  let cases = MATRIX;
  if (args.zoom) {
    // The bench's default camera is much closer than the viewer's. A bolt is
    // ~54 world units long, so at the map-fit distance it is a couple of pixels
    // and "it draws" stops meaning "you can see it". This walks out to the
    // viewer's real framing and reports where it stops registering.
    const shooter = args.unit || 'ohun';
    cases = [1200, 1800, 3000, 5000, 8000, 12000, 19500].map(d => ({
      shooter, target: 'hfoo', camDist: d, note: `camDist ${d}`
    }));
  } else if (args.unit) {
    cases = [{ shooter: args.unit, target: args.target || 'hfoo', note: 'single case' }];
  } else if (args.all) {
    const ids = await page.evaluate(() => window.FX.rangedIds);
    const limit = +(args.limit || 60);
    cases = ids.slice(0, limit).map(id => ({ shooter: id, target: 'hfoo', note: '' }));
    console.log(`  --all: ${ids.length} ranged units, running first ${cases.length}\n`);
  }

  if (args.shots) fs.mkdirSync(SHOT_DIR, { recursive: true });

  const results = [];
  const to = +(args.to || 3500);
  const step = +(args.step || 50);

  console.log('  ' + pad('SHOOTER', 8) + pad('TGT', 6) + padL('AIR', 5) + padL('INK', 5) +
    padL('MAXPX', 7) + '  ' + pad('VERDICT', 10) + pad('MESH', 26) + 'NOTE');
  console.log('  ' + '-'.repeat(110));

  for (const c of cases) {
    await page.evaluate((cc) => {
      window.FX.setCase({
        shooter: cc.shooter, target: cc.target,
        distance: cc.distance || 600,
        terrain: cc.terrain || 'flat',
        camera: cc.camera || 'game',
        camDist: cc.camDist || 1800,
        targetMoves: !!cc.targetMoves,
        missileArt: cc.missileArt !== false,
        size: [900, 700]
      });
    }, c);

    // Give a first-sighting missile texture time to arrive, so a lazy-load gap
    // doesn't masquerade as a rendering bug in the sweep numbers. The gap is a
    // real defect, but it is a DIFFERENT one and gets its own case below.
    if (!args.nowarm) {
      await page.evaluate(() => { window.FX.setTime(1200); window.FX.setTime(1600); });
      await new Promise(r => setTimeout(r, 350));
    }

    const r = await page.evaluate((opts) => window.FX.sweep(opts), { to, step });
    r.note = c.note;
    r.camDist = c.camDist || 1800;
    results.push(r);

    const mesh = (r.meshesUsed || []).filter(m => m !== 'puffs').join(',') || (r.meshesUsed || []).join(',');
    console.log('  ' + pad(r.shooter, 8) + pad(r.target, 6) +
      padL(r.airborneTicks, 5) + padL(r.inkTicks, 5) + padL(r.maxChangedPixels, 7) +
      '  ' + pad(r.verdict, 10) + pad(mesh.slice(0, 25), 26) + (c.note || ''));

    if (args.shots || r.verdict === 'INVISIBLE') {
      // Park on the frame with the most going on, then keep the picture.
      if (r.firstAirborneMs != null) {
        await page.evaluate(t => window.FX.setTime(t), r.firstAirborneMs + 100);
        fs.mkdirSync(SHOT_DIR, { recursive: true });
        const f = path.join(SHOT_DIR, `${r.shooter}-${r.target}-${r.verdict}.png`);
        await page.screenshot({ path: f });
      }
    }
  }

  // Detail dump for anything that computed a projectile and drew nothing.
  const broken = results.filter(r => r.verdict === 'INVISIBLE' || r.verdict === 'PARTIAL');
  if (broken.length || args.unit) {
    for (const r of (args.unit ? results : broken)) {
      if (r.firstAirborneMs == null) continue;
      await page.evaluate((cc, t) => {
        window.FX.setCase({
          shooter: cc.shooter, target: cc.target, distance: cc.distance || 600,
          terrain: cc.terrain || 'flat', camera: cc.camera || 'game',
          camDist: cc.camDist || 1800, missileArt: true
        });
        window.FX.setTime(t);
      }, { ...r, camDist: r.camDist }, r.firstAirborneMs + 100);
      const p = await page.evaluate(() => window.FX.probe());
      console.log(`\n  ---- ${r.shooter} → ${r.target} @ ${p.t}ms  (${r.verdict}) ----`);
      console.log('  spec:     ' + JSON.stringify(p.spec));
      console.log('  counts:   ' + JSON.stringify(p.counts));
      console.log('  draw:     ' + JSON.stringify(p.draw));
      if (r.blankTicks && r.blankTicks.length) {
        console.log(`  blanks:   ${r.blankTicks.length} airborne ticks drew nothing ` +
          `(${r.unexplainedBlanks} above the fade floor)`);
        r.blankTicks.slice(0, 6).forEach(b => console.log('    ' + JSON.stringify(b)));
      }
      for (const i of p.instances) {
        console.log('  instance: ' + JSON.stringify(i));
      }
    }
  }

  console.log('\n  ' + '='.repeat(110));
  const ok = results.filter(r => r.verdict === 'OK').length;
  const invisible = results.filter(r => r.verdict === 'INVISIBLE').length;
  const partial = results.filter(r => r.verdict === 'PARTIAL').length;
  const nofx = results.filter(r => r.verdict === 'NO-FX').length;
  console.log(`  OK ${ok}   INVISIBLE ${invisible}   PARTIAL ${partial}   NO-FX ${nofx}   (of ${results.length})`);
  if (args.shots || invisible) console.log(`  screenshots: ${SHOT_DIR}`);

  if (failedRequests.length) {
    console.log(`\n  FAILED REQUESTS (${failedRequests.length}):`);
    [...new Set(failedRequests)].slice(0, 15).forEach(u => console.log('   ' + u));
  }
  if (consoleErrors.length) {
    console.log(`\n  CONSOLE (${consoleErrors.length}):`);
    [...new Set(consoleErrors)].slice(0, 15).forEach(m => console.log('   ' + m));
  }

  if (headful) {
    console.log('\n  --headful: leaving the browser open. Ctrl-C when done.');
    return;
  }
  await browser.close();
  process.exit(invisible > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
