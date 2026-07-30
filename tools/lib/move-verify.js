//
// move-verify.js — the ground-truth movement check from tools/path-debug.js
// --verify, extracted so fidelity-report.js can pool it without shelling out.
//
// Ground truth = the replay's own commanded move target X/Y (captured into
// player.moveTrace by `node wc3v.js --replay=R --move-trace`). NOT
// self-referential — it checks the sim against the replay.
//
// Pure aside from the optional --samples append (path-sweep.js depends on it).
// No console output; the CLI owns printing. Returns null when the .wc3v has
// no moveTrace for the player.
//
const fs = require('fs');
const mappings = require('../../helpers/mappings');

const msOf = (itemId) => { const m = mappings.getUnitInfo(itemId); return (m && m.meta && m.meta.movespeed) || 270; };

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

/**
 * Cross-reference every traced command for player `pid` against where/when
 * the unit actually ends up on its exported path.
 *
 * opts: {
 *   tol=160, minspeed=600, combat=false,
 *   samples: file path to append JSONL samples (path-sweep protocol),
 *   dump: N — collect the first N strict-move traces as printable lines,
 *   replayName: label used in samples/dump output
 * }
 * Returns { buckets: { move, other }, dumpLines, tol } or null (no moveTrace).
 */
function verify (data, pid, opts) {
  opts = opts || {};
  const pdata = (data.players || {})[String(pid)];
  if (!pdata) return null;
  const trace = pdata.moveTrace;
  if (!trace || !trace.length) return null;

  const byUuid = {};
  (pdata.units || []).forEach(u => { if (u.path) byUuid[u.uuid] = u; });

  // per-uuid ordered list of command times (to detect redirects)
  const cmdsByUuid = {};
  trace.forEach(c => (c.units || []).forEach(uu => {
    (cmdsByUuid[uu] = cmdsByUuid[uu] || []).push(c.gameTime);
  }));
  Object.values(cmdsByUuid).forEach(a => a.sort((x, y) => x - y));

  const TOL = opts.tol ? +opts.tol : 160;     // ~1.25 tiles
  // bucket metrics by command kind: 'move' = strict point-move (must reach);
  // 'other' = attack/smart/harvest (early stop is correct, informational).
  const B = () => ({ cmds: 0, evaluable: 0, converged: 0, posErr: [], timeRatio: [], netSpeedRatio: [] });
  const buckets = { move: B(), other: B() };
  const dumpLines = [];

  trace.forEach(c => {
    const bk = (c.kind === 'move') ? buckets.move : buckets.other;
    (c.units || []).forEach(uu => {
      const u = byUuid[uu];
      if (!u || u.path.length < 2) return;
      if (opts.combat) { const m = mappings.getUnitInfo(u.itemId); if (m && m.meta && m.meta.worker) return; }
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
      const SPEED_MIN = opts.minspeed ? +opts.minspeed : 600;
      const speedEligible = straight >= SPEED_MIN;
      if (opts.samples && best <= TOL && bestT != null) {
        const travel = bestT - c.gameTime;
        if (travel > 0) {
          fs.appendFileSync(String(opts.samples), JSON.stringify({
            replay: opts.replayName, pid: String(pid), kind: c.kind, straight: Math.round(straight),
            conv: 1, pos: Math.round(best),
            timeRatio: travel / ideal, netSpeed: (straight / (travel / 1000)) / ms,
            speedEligible
          }) + '\n');
        }
      } else if (opts.samples) {
        fs.appendFileSync(String(opts.samples), JSON.stringify({
          replay: opts.replayName, pid: String(pid), kind: c.kind, straight: Math.round(straight),
          conv: 0, pos: Math.round(best)
        }) + '\n');
      }
      if (opts.dump && c.kind === 'move' && bk.evaluable <= +opts.dump) {
        const lastT = u.path[u.path.length - 1].gameTime;
        dumpLines.push(`  [dump] t0=${c.gameTime} start=(${start.x|0},${start.y|0}) tgt=(${c.targetX|0},${c.targetY|0}) ` +
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

  return { buckets, dumpLines, tol: TOL };
}

/** Compact summary of a verify() bucket for scorecard consumption. */
function summarize (b) {
  if (!b || !b.evaluable) return null;
  return {
    cmds: b.cmds,
    evaluable: b.evaluable,
    converged: b.converged,
    convergencePct: 100 * b.converged / b.evaluable,
    posErrMedian: pctl(b.posErr, 0.5),
    posErrP90: pctl(b.posErr, 0.9),
    timeRatioMedian: pctl(b.timeRatio, 0.5),
    netSpeedMedian: pctl(b.netSpeedRatio, 0.5)
  };
}

module.exports = { verify, summarize, posAt, pctl, msOf };
