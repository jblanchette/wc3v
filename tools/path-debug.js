//
// path-debug.js — inspect / ground-truth-verify the position stream.
//
// Read-only. Three things:
//   (default)  per-unit + aggregate path stats incl. a JITTER metric
//              (sharp direction reversals in a tiny radius = the stutter).
//   --verify   GROUND TRUTH: cross-reference each replay move command's exact
//              target X/Y (captured via `node wc3v.js --replay=R --move-trace`)
//              against where/when the unit actually ends up. This is NOT
//              self-referential — it checks the sim against the replay.
//   --png=PATH render the actual paths to a PNG.
//
// Usage:
//   node wc3v.js --replay=happy-vs-grubby --move-trace        (capture truth)
//   node tools/path-debug.js --replay=happy-vs-grubby --player=1 --verify
//   node tools/path-debug.js --replay=happy-vs-grubby --player=1 --combat --png=C:/tmp/p.png
//
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const mappings = require('../helpers/mappings');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [f, ...r] = raw.replace(/^--/, '').split('=');
  args[f] = r.join('=') || true;
});

const base = path.join(__dirname, '..', 'client', 'replays', args.replay || '');
let data;
if (fs.existsSync(`${base}.wc3v`)) data = JSON.parse(fs.readFileSync(`${base}.wc3v`, 'utf8'));
else if (fs.existsSync(`${base}.wc3v.gz`)) data = JSON.parse(zlib.gunzipSync(fs.readFileSync(`${base}.wc3v.gz`)).toString());
else { console.error(`not found: ${base}.wc3v(.gz). Parse with: node wc3v.js --replay=${args.replay} --move-trace`); process.exit(1); }

const pid = String(args.player || '1');
const pdata = (data.players || {})[pid];
if (!pdata) { console.error(`no player ${pid}`); process.exit(1); }
const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
const msOf = (itemId) => { const m = mappings.getUnitInfo(itemId); return (m && m.meta && m.meta.movespeed) || 270; };

let units = (pdata.units || []).filter(u => u.path && u.path.length > 2 && !u.isBuilding);
if (args.unit) units = units.filter(u =>
  (u.displayName || '').toLowerCase().includes(String(args.unit).toLowerCase()) ||
  (u.itemId || '').toLowerCase() === String(args.unit).toLowerCase());
if (args.combat) units = units.filter(u => { const m = mappings.getUnitInfo(u.itemId); return !(m && m.meta && m.meta.worker); });
if (!units.length) { console.error('no matching units with paths'); process.exit(1); }

// position on a unit's recorded path at an arbitrary gameTime (lerp, no
// interpolation across jumps / idle gaps).
function posAt (p, t) {
  if (!p.length) return null;
  if (t <= p[0].gameTime) return { x: p[0].x, y: p[0].y };
  if (t >= p[p.length - 1].gameTime) return { x: p[p.length - 1].x, y: p[p.length - 1].y };
  let lo = 0, hi = p.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (p[m].gameTime <= t) lo = m; else hi = m - 1; }
  const a = p[lo], b = p[lo + 1];
  if (!b || b.isJump) return { x: a.x, y: a.y };
  const dt = b.gameTime - a.gameTime;
  const f = dt > 0 ? (t - a.gameTime) / dt : 0;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}
const D = (ax, ay, bx, by) => Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
const pctl = (arr, q) => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

// ---------- GROUND-TRUTH VERIFY ----------
if (args.verify) {
  const trace = pdata.moveTrace;
  if (!trace || !trace.length) {
    console.error(`No moveTrace in this .wc3v. Reparse with:\n  node wc3v.js --replay=${args.replay} --move-trace`);
    process.exit(1);
  }
  const byUuid = {};
  (pdata.units || []).forEach(u => { if (u.path) byUuid[u.uuid] = u; });

  // per-uuid ordered list of command times (to detect redirects)
  const cmdsByUuid = {};
  trace.forEach(c => (c.units || []).forEach(uu => {
    (cmdsByUuid[uu] = cmdsByUuid[uu] || []).push(c.gameTime);
  }));
  Object.values(cmdsByUuid).forEach(a => a.sort((x, y) => x - y));

  const TOL = args.tol ? +args.tol : 160;     // ~1.25 tiles
  // bucket metrics by command kind: 'move' = strict point-move (must reach);
  // 'other' = attack/smart/harvest (early stop is correct, informational).
  const B = () => ({ cmds: 0, evaluable: 0, converged: 0, posErr: [], timeRatio: [], netSpeedRatio: [] });
  const buckets = { move: B(), other: B() };

  trace.forEach(c => {
    const bk = (c.kind === 'move') ? buckets.move : buckets.other;
    (c.units || []).forEach(uu => {
      const u = byUuid[uu];
      if (!u || u.path.length < 2) return;
      if (args.combat) { const m = mappings.getUnitInfo(u.itemId); if (m && m.meta && m.meta.worker) return; }
      bk.cmds++;
      const ms = msOf(u.itemId);
      const start = posAt(u.path, c.gameTime);
      if (!start) return;
      const straight = D(start.x, start.y, c.targetX, c.targetY);
      if (straight < 64) return;                       // trivial / already there
      const ideal = (straight / ms) * 1000;            // straight-line ideal travel ms

      const after = (cmdsByUuid[uu] || []).filter(t => t > c.gameTime + 1);
      const tRedirect = after.length ? after[0] : Infinity;
      const tEnd = Math.min(tRedirect, c.gameTime + ideal * 3 + 4000,
                            u.path[u.path.length - 1].gameTime);

      let best = Infinity, bestT = null;
      for (let i = 0; i < u.path.length; i++) {
        const s = u.path[i];
        if (s.gameTime < c.gameTime) continue;
        if (s.gameTime > tEnd) break;
        const d = D(s.x, s.y, c.targetX, c.targetY);
        if (d < best) { best = d; bestT = s.gameTime; }
      }
      const hadTime = (tRedirect - c.gameTime) >= ideal * 0.8;
      if (!hadTime) return;
      bk.evaluable++;
      bk.posErr.push(best);
      // Speed/time ratios are only meaningful over a MEANINGFUL distance: a
      // short command issued while the unit is already in motion didn't start
      // from rest, so straight/travel over-reads speed. Convergence & posErr
      // are unaffected and kept for all distances.
      const SPEED_MIN = args.minspeed ? +args.minspeed : 600;
      const speedEligible = straight >= SPEED_MIN;
      if (args.samples && best <= TOL && bestT != null) {
        const travel = bestT - c.gameTime;
        if (travel > 0) {
          fs.appendFileSync(String(args.samples), JSON.stringify({
            replay: args.replay, pid, kind: c.kind, straight: Math.round(straight),
            conv: 1, pos: Math.round(best),
            timeRatio: travel / ideal, netSpeed: (straight / (travel / 1000)) / ms,
            speedEligible
          }) + '\n');
        }
      } else if (args.samples) {
        fs.appendFileSync(String(args.samples), JSON.stringify({
          replay: args.replay, pid, kind: c.kind, straight: Math.round(straight),
          conv: 0, pos: Math.round(best)
        }) + '\n');
      }
      if (args.dump && c.kind === 'move' && bk.evaluable <= +args.dump) {
        const lastT = u.path[u.path.length - 1].gameTime;
        console.log(`  [dump] t0=${c.gameTime} start=(${start.x|0},${start.y|0}) tgt=(${c.targetX|0},${c.targetY|0}) ` +
          `straight=${straight|0} idealMs=${ideal|0} bestDist=${best|0} bestT=${bestT} travel=${bestT-c.gameTime} ` +
          `pathSpan=[${u.path[0].gameTime}..${lastT}] tRedirect=${tRedirect===Infinity?'inf':tRedirect}`);
      }
      if (best <= TOL) {
        bk.converged++;
        const travel = bestT - c.gameTime;
        if (travel > 0 && speedEligible) {
          bk.timeRatio.push(travel / ideal);
          bk.netSpeedRatio.push((straight / (travel / 1000)) / ms);
        }
      }
    });
  });

  const rep = (name, b) => {
    if (!b.evaluable) { console.log(`  ${name}: (no evaluable commands)`); return null; }
    const conv = 100 * b.converged / b.evaluable;
    console.log(`  ${name}: cmds=${b.cmds} evaluable=${b.evaluable}`);
    console.log(`    converged ≤${TOL}u: ${b.converged}/${b.evaluable} = ${conv.toFixed(1)}%`);
    console.log(`    pos err  median=${Math.round(pctl(b.posErr, .5))}u p90=${Math.round(pctl(b.posErr, .9))}u worst=${Math.round(Math.max(0, ...b.posErr))}u`);
    console.log(`    time ratio median=${pctl(b.timeRatio, .5).toFixed(2)} p90=${pctl(b.timeRatio, .9).toFixed(2)}`);
    console.log(`    net-speed  median=${pctl(b.netSpeedRatio, .5).toFixed(2)} p10=${pctl(b.netSpeedRatio, .1).toFixed(2)} (1.00=correct)`);
    return { conv, speed: pctl(b.netSpeedRatio, .5), posMed: pctl(b.posErr, .5) };
  };
  const mv = pdata.mvStats;
  if (mv) {
    console.log(`\nspring/thrash: ${mv.total} move-cmds, coalesced=${mv.coalesced}, ` +
      `repath-while-moving=${mv.redirectMoving} (lower = less spring)`);
  }
  console.log(`\n──── GROUND-TRUTH vs replay move targets — ${args.replay} p${pid} ${args.combat ? '(combat)' : ''} ────`);
  console.log(`STRICT pure point-move (MoveCommand — unit MUST reach):`);
  const sm = rep('move', buckets.move);
  console.log(`smart/attack/harvest (early-stop is correct — informational):`);
  rep('other', buckets.other);
  if (sm && global.__sweep) global.__sweep.push({ replay: args.replay, pid, ...sm });
  process.exit(0);
}

// ---------- PER-UNIT STATS + JITTER ----------
let aggDist = 0, aggMoveMs = 0, aggExpMs = 0, aggSamples = 0, aggGroup = 0, aggJitter = 0, aggSeg = 0;
units.forEach(u => {
  const p = u.path, ms = msOf(u.itemId);
  let dist = 0, moveMs = 0, expMs = 0, grp = 0, seg = 0, jitter = 0;
  let pvx = 0, pvy = 0, havePrev = false;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i];
    if (b.groupId) grp++;
    if (b.isJump) { havePrev = false; continue; }
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const dt = b.gameTime - a.gameTime;
    if (d < 1 || dt <= 0 || dt > 8000) { havePrev = false; continue; }
    // jitter: sharp reversal (>90°) between consecutive short segments
    if (havePrev) {
      const dot = pvx * dx + pvy * dy;
      const lenOk = d < 96 && Math.sqrt(pvx * pvx + pvy * pvy) < 96;
      if (dot < 0 && lenOk) jitter++;
    }
    pvx = dx; pvy = dy; havePrev = true;
    dist += d; moveMs += dt; expMs += (d / ms) * 1000; seg++;
  }
  if (!seg) return;
  aggDist += dist; aggMoveMs += moveMs; aggExpMs += expMs;
  aggSamples += p.length; aggGroup += grp; aggJitter += jitter; aggSeg += seg;
  if (!args.quiet) console.log(
    `${(u.displayName || u.itemId).padEnd(18)} seg=${String(seg).padStart(4)} ` +
    `speed=${(dist / (moveMs / 1000)).toFixed(0)}/${ms} ` +
    `jitter=${String(jitter).padStart(4)} (${(100 * jitter / seg).toFixed(0)}%) ` +
    `grpCov=${(100 * grp / p.length).toFixed(0)}%`);
});
console.log(`\n──── AGGREGATE p${pid} (${units.length} units) ────`);
console.log(`self-consistent speed (NOT ground truth): ${(aggExpMs / aggMoveMs).toFixed(3)}`);
console.log(`JITTER (sharp reversals in <96u): ${aggJitter}/${aggSeg} segments = ${(100 * aggJitter / aggSeg).toFixed(1)}%  ← the stutter`);
console.log(`groupId coverage: ${(100 * aggGroup / aggSamples).toFixed(1)}%`);

if (args.png) {
  const { createCanvas } = require('canvas');
  const W = 1200, H = 1200, PAD = 24;
  let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity;
  units.forEach(u => u.path.forEach(s => { mnX = Math.min(mnX, s.x); mxX = Math.max(mxX, s.x); mnY = Math.min(mnY, s.y); mxY = Math.max(mxY, s.y); }));
  const sc = Math.min((W - 2 * PAD) / Math.max(1, mxX - mnX), (H - 2 * PAD) / Math.max(1, mxY - mnY));
  const TX = x => PAD + (x - mnX) * sc, TY = y => PAD + (y - mnY) * sc;
  const cv = createCanvas(W, H), c = cv.getContext('2d');
  c.fillStyle = '#0e1118'; c.fillRect(0, 0, W, H);
  const pal = ['#4fa3ff', '#ff7a59', '#5fd08a', '#e6c84f', '#c98bff', '#ff5fa2', '#5fe0d0'];
  units.forEach((u, ui) => {
    const p = u.path; c.strokeStyle = pal[ui % pal.length]; c.lineWidth = 1.3; c.globalAlpha = .8;
    c.beginPath(); let pen = false;
    for (let i = 0; i < p.length; i++) { const s = p[i]; if (s.isJump) { pen = false; continue; } const X = TX(s.x), Y = TY(s.y); if (!pen) { c.moveTo(X, Y); pen = true; } else c.lineTo(X, Y); }
    c.stroke();
    c.globalAlpha = .9;
    for (let i = 0; i < p.length; i++) { const s = p[i]; c.fillStyle = s.groupId ? '#39d353' : '#e0556b'; c.beginPath(); c.arc(TX(s.x), TY(s.y), 1.5, 0, 7); c.fill(); }
  });
  fs.writeFileSync(String(args.png), cv.toBuffer('image/png'));
  console.log(`PNG: ${args.png}`);
}
