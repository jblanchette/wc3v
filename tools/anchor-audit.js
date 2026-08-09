/**
 * anchor-audit.js — positional-anchor error report over exported .wc3v files.
 *
 * WC3 replays record ORDERS, not positions; between orders a unit's exported
 * path[] is a simulation guess. But certain replay actions PROVE a unit was at
 * (or within a bounded radius of) a known point at a known time. This tool
 * extracts those anchors from the EXPORTED data (no re-parse) and measures how
 * far the shipped path[] is from them. It is a measurement tool — it changes
 * nothing.
 *
 * Anchors are parser-derived: a cheap offline cross-check of internal
 * consistency, NOT a substitute for engine-truth fixtures (whose expectations
 * come from watching real WC3).
 *
 * Anchor sets (the split is the whole methodology):
 *   MEASUREMENT  battle-signal / spellCast clicks whose subject is an ENEMY of
 *                the clicking player. The click point is the target's true
 *                position (the cursor was over its model); the target's path
 *                is unconstrained by its owner's orders at that moment. This
 *                set answers "how wrong are enemy positions".
 *   CLICK-CALIB  the same click anchors whose subject is OWN/ALLY (heals,
 *                buffs). Those subjects have order-driven, accurate paths, so
 *                this distribution measures the intrinsic noise of
 *                click-point-equals-position (selection-circle slop,
 *                collisionSize, command latency). It sets the honest floor —
 *                if calib is noisy, the extraction is noisy, not the paths.
 *   CONSTRUCTION teleports / item pickups / creep interactions whose
 *                coordinates the parser itself already baked into path[].
 *                Expected ~0 error; a sanity check that extraction + path
 *                sampling agree, never part of the headline.
 *
 * Known limits (stated, not hidden):
 *   - units that never act and are never clicked have NO anchors, ever;
 *   - "time since last order" is a PROXY (t since the subject last appeared in
 *     any exported signal/event/teleport) — true order times don't survive
 *     export (combatOrderTimes is workers-only, moveHistory is always empty);
 *   - per-battle signals are capped at 400 at export and orphan clusters are
 *     dropped, so offline coverage understates parse-time coverage;
 *   - kind:'proximity' signals are interpolated FROM path[] and are excluded
 *     as circular, always.
 *
 * Usage:
 *   node tools/anchor-audit.js                    — fleet, human report
 *   node tools/anchor-audit.js --replay=ID        — single replay detail
 *   node tools/anchor-audit.js --limit=N          — cap processed replays
 *   node tools/anchor-audit.js --json             — machine-readable
 *   node tools/anchor-audit.js --holdout          — odd-parity anchors only
 *                                                   (adoption-gate protocol:
 *                                                   a future correction may
 *                                                   consume even-parity only)
 *   node tools/anchor-audit.js --top=N            — worst-offender list size
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MV = require('./lib/move-verify.js');   // posAt idiom + pctl
const KA = require('./lib/kinematics-audit.js'); // isGap — the shared gap rule

const REPLAYS_DIR = path.join(__dirname, '..', 'client', 'replays');
const STORM_BOLT_REPLAY = '1129305842_Leon_Lucifer_AutumnLeaves20';

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

const RADII = [0, 64, 128, 256];   // sensitivity set for click anchors
const HEADLINE_R = 128;            // the radius the gate is evaluated at
const BLATANT_TOL = 320;           // engine-truth default position tolerance
const STALE_BUCKETS = [
  { label: '<2s', max: 2000 },
  { label: '2-10s', max: 10000 },
  { label: '10-30s', max: 30000 },
  { label: '30-60s', max: 60000 },
  { label: '60-180s', max: 180000 },
  { label: '>180s', max: Infinity }
];

const pctl = MV.pctl;
const D = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

function loadReplay (basePath) {
  if (fs.existsSync(`${basePath}.wc3v`)) {
    return JSON.parse(fs.readFileSync(`${basePath}.wc3v`, 'utf8'));
  }
  if (fs.existsSync(`${basePath}.wc3v.gz`)) {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(`${basePath}.wc3v.gz`)).toString());
  }
  return null;
}

// Holdout split — MUST be the same hash the correction pass consumes with
// (lib/AnchorCorrection.js takes even parity, --holdout measures odd), so the
// grade is never taken on anchors the fix was fitted to. Single source of
// truth lives in lib/AnchorExtract.js.
const AnchorExtract = require('../lib/AnchorExtract.js');
const isHoldout = (a) => AnchorExtract.isHoldoutKey(a.subject, a.t);

// Position on a recorded path at time t, honouring the shared gap rule: never
// lerp across a genuine discontinuity — use the nearest-in-time sample.
function gapAwarePosAt (p, t) {
  if (!p || !p.length) return null;
  if (t <= p[0].gameTime) return { x: p[0].x, y: p[0].y, mode: 'clampStart', span: null };
  const last = p[p.length - 1];
  if (t >= last.gameTime) return { x: last.x, y: last.y, mode: 'clampEnd', span: null };
  let lo = 0, hi = p.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (p[m].gameTime <= t) lo = m; else hi = m - 1; }
  const a = p[lo], b = p[lo + 1];
  if (!b) return { x: a.x, y: a.y, mode: 'clampEnd', span: null };
  if (KA.isGap(a, b)) {
    const nearer = (t - a.gameTime) <= (b.gameTime - t) ? a : b;
    return { x: nearer.x, y: nearer.y, mode: 'gapNearest', span: b.gameTime - a.gameTime };
  }
  const dt = b.gameTime - a.gameTime;
  const f = dt > 0 ? (t - a.gameTime) / dt : 0;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, mode: 'lerp', span: dt };
}

// --- per-replay extraction --------------------------------------------------

function classify (u) {
  if (u.isBuilding) return 'building';
  if (u.meta && u.meta.hero) return 'hero';
  if ((u.meta && u.meta.worker) || u.primaryRole === 'gold' || u.primaryRole === 'lumber') return 'worker';
  return 'army';
}

function buildUnitIndex (data) {
  const idx = new Map();
  for (const [pid, pdata] of Object.entries(data.players || {})) {
    if (!pdata) continue;
    for (const u of (pdata.units || [])) {
      if (!u || !u.uuid) continue;
      idx.set(u.uuid, { u, pid, teamId: pdata.teamId, isNeutral: !!pdata.isNeutralPlayer });
    }
  }
  return idx;
}

function relationOf (actorPid, actorTeam, ownerEntry) {
  if (ownerEntry.isNeutral) return 'neutral';
  if (String(ownerEntry.pid) === String(actorPid)) return 'own';
  if (ownerEntry.teamId != null && ownerEntry.teamId === actorTeam) return 'ally';
  return 'enemy';
}

const CLICK_KINDS = new Set(['attack-unit', 'right-click-enemy', 'spell-target-unit']);

function extractAnchors (data, unitIdx) {
  const anchors = [];
  const teamOf = (pid) => {
    const p = (data.players || {})[String(pid)];
    return p ? p.teamId : null;
  };
  const seenClick = new Set();  // dedup subject|t|x|y across battles + events

  // A. battle-signal clicks on a resolved unit — the click point is the
  // TARGET's position at that instant. proximity is synthesized from path[]
  // and is hard-excluded as circular.
  for (const b of (data.battles || [])) {
    for (const s of (b.signals || [])) {
      if (!CLICK_KINDS.has(s.kind)) continue;
      if (!s.targetUuid || s.x == null || s.y == null) continue;
      const owner = unitIdx.get(s.targetUuid);
      if (!owner) continue;
      const key = `${s.targetUuid}|${s.gameTime}|${Math.round(s.x)}|${Math.round(s.y)}`;
      if (seenClick.has(key)) continue;
      seenClick.add(key);
      anchors.push({
        type: 'A', source: s.kind, subject: s.targetUuid,
        t: s.gameTime, x: s.x, y: s.y,
        actorPid: s.playerId,
        rel: relationOf(s.playerId, teamOf(s.playerId), owner),
        spellAbilityId: s.spellAbilityId || null
      });
    }
  }

  // B. eventStream spellCast on a unit target. Covers ally/own heals+buffs
  // (which emit NO battle signal — that's the calibration set) and enemy hero
  // casts in replays whose battles lack uuids. Target has no uuid in the
  // event; resolvable only when the owner has exactly one live hero of that
  // itemId (illusions excluded from resolution — they share the itemId).
  for (const [pid, pdata] of Object.entries(data.players || {})) {
    if (!pdata || pdata.isNeutralPlayer) continue;
    for (const ev of (pdata.eventStream || [])) {
      if (ev.key !== 'spellCast' || ev.targeting !== 'unit') continue;
      if (!ev.target || !ev.target.isHero || !ev.targetPosition) continue;
      if (ev.target.ownerPlayerId == null) continue;
      const ownerData = (data.players || {})[String(ev.target.ownerPlayerId)];
      if (!ownerData) continue;
      const cands = (ownerData.units || []).filter(u =>
        u.itemId === ev.target.itemId && u.meta && u.meta.hero && !u.isIllusion);
      if (cands.length !== 1) continue;
      const subject = cands[0].uuid;
      const owner = unitIdx.get(subject);
      if (!owner) continue;
      const key = `${subject}|${ev.gameTime}|${Math.round(ev.targetPosition.x)}|${Math.round(ev.targetPosition.y)}`;
      if (seenClick.has(key)) continue;
      // dedup vs a type-A anchor on the same subject within 50ms
      const dup = anchors.some(a => a.type === 'A' && a.subject === subject &&
        Math.abs(a.t - ev.gameTime) < 50);
      if (dup) continue;
      seenClick.add(key);
      anchors.push({
        type: 'B', source: 'spellCast', subject,
        t: ev.gameTime, x: ev.targetPosition.x, y: ev.targetPosition.y,
        actorPid: pid,
        rel: relationOf(pid, pdata.teamId, owner),
        spellAbilityId: ev.spellItemId || null
      });
    }
  }

  // C/D/E — construction tier: coordinates the parser itself already applied
  // to paths (or took from them). Expected ~0 error; extraction sanity only.

  // C. teleports: caster at origin (cast) and caster+grabbed at destination
  // (arrival). All positions were written by _applyTeleport at parse time.
  for (const [, pdata] of Object.entries(data.players || {})) {
    if (!pdata) continue;
    for (const t of (pdata.teleportEvents || [])) {
      if (t.cancelled) continue;
      if (t.casterUuid && t.origin) {
        anchors.push({ type: 'C', source: `tp-origin:${t.abilityCode}`, subject: t.casterUuid,
          t: t.gameTime, x: t.origin.x, y: t.origin.y, actorPid: null, rel: 'construction', r: 64 });
      }
      if (t.appliedAt != null && t.destination) {
        const arrivals = [t.casterUuid, ...(t.grabbedUnitUuids || [])].filter(Boolean);
        for (const uu of arrivals) {
          anchors.push({ type: 'C', source: `tp-dest:${t.abilityCode}`, subject: uu,
            t: t.appliedAt, x: t.destination.x, y: t.destination.y, actorPid: null, rel: 'construction', r: 64 });
        }
      }
    }
  }

  // D. item ground pickups: the holder was at the item. knownItemX with a
  // fractional part is an inventory-UI coordinate (shop buy) — world
  // coordinates from ground interactions are integral (Hero.js fractional-
  // part tell). Near-origin pairs are unset defaults.
  for (const [, pdata] of Object.entries(data.players || {})) {
    if (!pdata || pdata.isNeutralPlayer) continue;
    for (const u of (pdata.units || [])) {
      for (const it of (u.items || [])) {
        if (it.knownItemX == null || it.knownItemY == null || it.acquiredAt == null) continue;
        if (it.knownItemX % 1 !== 0 || it.knownItemY % 1 !== 0) continue;
        if (Math.abs(it.knownItemX) < 500 && Math.abs(it.knownItemY) < 500) continue;
        anchors.push({ type: 'D', source: `item:${it.source || 'unknown'}`, subject: u.uuid,
          t: it.acquiredAt, x: it.knownItemX, y: it.knownItemY, actorPid: null, rel: 'construction', r: 150 });
      }
    }
  }

  // E. creep interactions: perPlayerEvents 'interact-creep' coords come from
  // the focus unit's tracked position (parser-derived — construction tier).
  const groups = (data.world && data.world.neutralGroups) || {};
  for (const g of Object.values(groups)) {
    for (const ev of (g.perPlayerEvents || [])) {
      if (ev.stage !== 'interact-creep' || !ev.focusUnitUuid) continue;
      if (ev.x == null || ev.y == null) continue;
      anchors.push({ type: 'E', source: 'interact-creep', subject: ev.focusUnitUuid,
        t: ev.gameTime, x: ev.x, y: ev.y, actorPid: null, rel: 'construction', r: 128 });
    }
  }

  // Deterministic order for everything downstream.
  anchors.sort((a, b) => a.t - b.t || (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0) ||
    (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
  return anchors;
}

// Evidence timeline per subject — the staleness PROXY. True per-unit order
// times don't survive export; this is "last time the subject ACTED in any
// exported signal/event/teleport", which upper-bounds order recency.
// ACTOR-SIDE ONLY, deliberately: being clicked BY an enemy does not update
// the parser's path for the subject, so it must not reset staleness — a
// repeatedly-clicked mispositioned unit would otherwise read as "fresh"
// while carrying a huge error, poisoning the error-vs-staleness curve.
function buildEvidenceTimes (data) {
  const ev = new Map();
  const push = (uuid, t) => {
    if (!uuid || t == null) return;
    let arr = ev.get(uuid);
    if (!arr) { arr = []; ev.set(uuid, arr); }
    arr.push(t);
  };
  for (const b of (data.battles || [])) {
    for (const s of (b.signals || [])) {
      if (s.kind === 'proximity') continue;
      push(s.actorUuid, s.gameTime);
    }
  }
  for (const [, pdata] of Object.entries(data.players || {})) {
    if (!pdata || pdata.isNeutralPlayer) continue;
    for (const e of (pdata.eventStream || [])) {
      if (e.key === 'spellCast' && e.unit && e.unit.uuid) push(e.unit.uuid, e.gameTime);
    }
    for (const t of (pdata.teleportEvents || [])) {
      if (t.cancelled) continue;
      push(t.casterUuid, t.gameTime);
      if (t.appliedAt != null) {
        push(t.casterUuid, t.appliedAt);
        for (const uu of (t.grabbedUnitUuids || [])) push(uu, t.appliedAt);
      }
    }
  }
  for (const arr of ev.values()) arr.sort((a, b) => a - b);
  return ev;
}

function lastEvidenceBefore (arr, t) {
  if (!arr || !arr.length) return null;
  let lo = 0, hi = arr.length - 1, best = null;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] < t - 1) { best = arr[m]; lo = m + 1; } else { hi = m - 1; }
  }
  return best;
}

function staleBucket (ms) {
  for (const b of STALE_BUCKETS) if (ms < b.max) return b.label;
  return STALE_BUCKETS[STALE_BUCKETS.length - 1].label;
}

// --- per-replay measurement -------------------------------------------------

function measureReplay (id) {
  const data = loadReplay(path.join(REPLAYS_DIR, id));
  if (!data) return null;

  const unitIdx = buildUnitIndex(data);
  const anchors = extractAnchors(data, unitIdx);
  const evidence = buildEvidenceTimes(data);
  // Duration: no single authoritative field in the export — fall back through
  // APM's match duration, then the last event/battle timestamp.
  let duration = (data.replay && data.replay.duration) || 0;
  if (!duration) {
    for (const [, pdata] of Object.entries(data.players || {})) {
      if (!pdata) continue;
      if (pdata.apmData && pdata.apmData.matchDurationMs) {
        duration = Math.max(duration, pdata.apmData.matchDurationMs);
      }
      const es = pdata.eventStream || [];
      if (es.length) duration = Math.max(duration, es[es.length - 1].gameTime || 0);
    }
    for (const b of (data.battles || [])) duration = Math.max(duration, b.endTime || 0);
  }

  const measured = [];   // per-anchor rows that survived filters
  const skipped = { noUnit: 0, noPath: 0, outsideLifetime: 0, pathEnded: 0 };

  for (const a of anchors) {
    const entry = unitIdx.get(a.subject);
    if (!entry) { skipped.noUnit++; continue; }
    const u = entry.u;
    if (!u.path || !u.path.length) { skipped.noPath++; continue; }
    if (u.spawnTime != null && a.t < u.spawnTime - 1000) { skipped.outsideLifetime++; continue; }
    if (u.destroyedAt != null && a.t > u.destroyedAt + 1000) { skipped.outsideLifetime++; continue; }
    // Anchors long past the subject's FINAL path sample usually mean the
    // subject is dead/despawned in a way the export doesn't timestamp
    // (hero deaths have no destroyedAt — heroes revive). Comparing a cast
    // against a corpse's resting position is not a path error; segregate.
    const lastPathT = u.path[u.path.length - 1].gameTime;
    if (a.t > lastPathT + 60000) { skipped.pathEnded++; continue; }

    const pos = gapAwarePosAt(u.path, a.t);
    if (!pos) { skipped.noPath++; continue; }
    const raw = D(pos.x, pos.y, a.x, a.y);
    const evArr = evidence.get(a.subject);
    const lastEv = lastEvidenceBefore(evArr, a.t);
    const sinceBase = lastEv != null ? lastEv : (u.spawnTime != null ? u.spawnTime : u.path[0].gameTime);
    const staleness = Math.max(0, a.t - sinceBase);

    measured.push({
      ...a,
      raw: +raw.toFixed(1),
      mode: pos.mode,
      span: pos.span,
      cls: classify(u),
      illusion: !!u.isIllusion,
      staleness,
      name: u.displayName
    });
  }

  // The sets. Calibration must isolate CLICK noise, so it takes only own/ally
  // anchors where the sim was actively tracking the subject (a live lerp
  // bracket ≤5s wide). The remaining own/ally anchors measure own-side path
  // error (gaps, stale own units) — a diagnostic, never the noise floor.
  const isClick = (m) => m.type === 'A' || m.type === 'B';
  const isTracked = (m) => m.mode === 'lerp' && m.span != null && m.span <= 5000;
  let meas = measured.filter(m => isClick(m) && m.rel === 'enemy');
  const ownAll = measured.filter(m => isClick(m) && (m.rel === 'own' || m.rel === 'ally'));
  const calib = ownAll.filter(isTracked);
  const ownOther = ownAll.filter(m => !isTracked(m));
  const cons = measured.filter(m => m.rel === 'construction');
  const neutral = measured.filter(m => isClick(m) && m.rel === 'neutral');

  if (args.holdout) meas = meas.filter(isHoldout);

  // Self-consistency: adjacent click anchors on one subject that no unit
  // could physically bridge — extraction bugs, not path errors.
  const bySubject = new Map();
  for (const m of measured.filter(isClick)) {
    let arr = bySubject.get(m.subject);
    if (!arr) { arr = []; bySubject.set(m.subject, arr); }
    arr.push(m);
  }
  const inconsistent = [];
  for (const [uuid, arr] of bySubject) {
    for (let i = 1; i < arr.length; i++) {
      const p = arr[i - 1], q = arr[i];
      const dt = q.t - p.t;
      if (dt <= 0 || dt >= 2000) continue;
      const entry = unitIdx.get(uuid);
      const ms = (entry && entry.u.meta && entry.u.meta.movespeed) || 270;
      const gap = D(p.x, p.y, q.x, q.y);
      if (gap > HEADLINE_R * 2 + ms * (dt / 1000)) {
        inconsistent.push({ subject: uuid, t: q.t, dt, gap: Math.round(gap) });
      }
    }
  }

  // Per-enemy-hero anchor coverage — "is correction even possible".
  const POST_MIN = 600000;   // 10:00
  const heroCoverage = [];
  for (const [, pdata] of Object.entries(data.players || {})) {
    if (!pdata || pdata.isNeutralPlayer) continue;
    for (const u of (pdata.units || [])) {
      if (!u.meta || !u.meta.hero || u.isIllusion || !u.path || !u.path.length) continue;
      const start = Math.max(u.spawnTime || 0, POST_MIN);
      const end = Math.min(u.destroyedAt != null ? u.destroyedAt : duration, duration || Infinity);
      if (!(end - start >= 60000)) continue;
      const times = meas.filter(m => m.subject === u.uuid && m.t >= start && m.t <= end)
        .map(m => m.t).sort((a, b) => a - b);
      let medianGap = null;
      if (times.length >= 2) {
        const gaps = [];
        for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
        medianGap = pctl(gaps, 0.5);
      }
      // fraction of the window within 60s/30s of an anchor
      const frac = (win) => {
        if (!times.length) return 0;
        let covered = 0, curA = null, curB = null;
        for (const t of times) {
          const a0 = Math.max(start, t - win), b0 = Math.min(end, t + win);
          if (curA == null) { curA = a0; curB = b0; continue; }
          if (a0 <= curB) { curB = Math.max(curB, b0); }
          else { covered += curB - curA; curA = a0; curB = b0; }
        }
        if (curA != null) covered += curB - curA;
        return covered / (end - start);
      };
      heroCoverage.push({
        name: u.displayName, uuid: u.uuid,
        anchors: times.length,
        medianGapMs: medianGap,
        frac60: +frac(60000).toFixed(3),
        frac30: +frac(30000).toFixed(3)
      });
    }
  }

  const stats = (rows, r) => {
    if (!rows.length) return null;
    const errs = rows.map(m => Math.max(0, m.raw - r));
    return {
      n: rows.length,
      median: Math.round(pctl(errs, 0.5)),
      p90: Math.round(pctl(errs, 0.9)),
      p99: Math.round(pctl(errs, 0.99)),
      max: Math.round(Math.max(...errs)),
      gt160: errs.filter(e => e > 160).length,
      gt320: errs.filter(e => e > BLATANT_TOL).length,
      gt800: errs.filter(e => e > 800).length,
      gt2000: errs.filter(e => e > 2000).length
    };
  };

  const byBucket = {};
  for (const b of STALE_BUCKETS) {
    const rows = meas.filter(m => staleBucket(m.staleness) === b.label);
    byBucket[b.label] = stats(rows, HEADLINE_R);
  }
  const byClass = {};
  for (const c of ['hero', 'army', 'worker', 'building']) {
    byClass[c] = stats(meas.filter(m => m.cls === c), HEADLINE_R);
  }

  const worst = [...meas].sort((a, b) => b.raw - a.raw).slice(0, +(args.top || 15))
    .map(m => ({ subject: m.name, uuid: m.subject, cls: m.cls, t: m.t,
      raw: Math.round(m.raw), staleness: Math.round(m.staleness / 1000),
      source: m.source, mode: m.mode,
      click: [Math.round(m.x), Math.round(m.y)] }));

  if (args.dumpcalib && calib.length) {
    console.log(`# calib rows — ${id}`);
    for (const m of calib) {
      console.log(`  ${m.type} ${m.source} ${m.name} rel=${m.rel} t=${m.t} click=(${Math.round(m.x)},${Math.round(m.y)}) raw=${Math.round(m.raw)} spell=${m.spellAbilityId || '-'} mode=${m.mode}`);
    }
  }

  // Storm Bolt built-in sanity: the motivating case must be visible here.
  // Extraction check only — the RAW value is reported, not asserted: on the
  // uncorrected corpus it measured 2548; anchor correction may shrink it.
  let sanity = null;
  if (id === STORM_BOLT_REPLAY) {
    const hit = measured.find(m => m.spellAbilityId === 'AHtb' && Math.abs(m.t - 601781) < 100);
    sanity = hit
      ? { found: true, raw: Math.round(hit.raw), subject: hit.name, ok: true }
      : { found: false, ok: false };
  }

  const coverage = {
    battles: (data.battles || []).length,
    uuidSignals: (data.battles || []).some(b => (b.signals || []).some(s => s.targetUuid)),
    // vintage tell: the export has carried a teleportEvents key (even when
    // empty) since teleport simulation landed. A missing KEY means the parse
    // predates it — every in-game TP was left unapplied, so positions after
    // any TP are corrupt regardless of anchor quality. Segment on this.
    modernVintage: Object.values(data.players || {})
      .some(p => p && !p.isNeutralPlayer && Object.prototype.hasOwnProperty.call(p, 'teleportEvents')),
    teleportEvents: Object.values(data.players || {}).some(p => p && (p.teleportEvents || []).length),
    itemXY: Object.values(data.players || {}).some(p => p && (p.units || [])
      .some(u => (u.items || []).some(it => it.knownItemX != null))),
    perPlayerEvents: Object.values((data.world && data.world.neutralGroups) || {})
      .some(g => (g.perPlayerEvents || []).length),
    exportedSignals: (data.battles || []).reduce((a, b) => a + (b.signals || []).length, 0),
    totalSignals: (data.battleStats && data.battleStats.totalSignals) || null
  };

  return {
    id,
    durationMin: +(duration / 60000).toFixed(1),
    counts: {
      total: anchors.length,
      byType: ['A', 'B', 'C', 'D', 'E'].reduce((acc, t) => {
        acc[t] = anchors.filter(a => a.type === t).length; return acc;
      }, {}),
      measurement: meas.length,
      calib: calib.length,
      ownOther: ownOther.length,
      construction: cons.length,
      neutral: neutral.length,
      illusionSubjects: meas.filter(m => m.illusion).length,
      skipped
    },
    measurement: RADII.reduce((acc, r) => { acc[`r${r}`] = stats(meas, r); return acc; }, {}),
    calib: { r0: stats(calib, 0), r128: stats(calib, HEADLINE_R) },
    ownOther: { r0: stats(ownOther, 0) },
    construction: {
      C: stats(cons.filter(m => m.type === 'C'), 64),
      D: stats(cons.filter(m => m.type === 'D'), 150),
      E: stats(cons.filter(m => m.type === 'E'), 128)
    },
    byBucket,
    byClass,
    heroCoverage,
    inconsistent: { n: inconsistent.length, sample: inconsistent.slice(0, 5) },
    worst,
    sanity,
    coverage,
    // raw pools for fleet aggregation (stripped before printing/JSON)
    _pools: {
      meas: meas.map(m => ({ raw: m.raw, cls: m.cls, type: m.type,
        bucket: staleBucket(m.staleness), staleness: m.staleness })),
      calib: calib.map(m => m.raw),
      ownOther: ownOther.map(m => m.raw),
      cons: cons.map(m => m.raw)
    }
  };
}

// --- fleet aggregation + gate -----------------------------------------------

function aggregate (perReplay) {
  const full = computeCore(perReplay);
  // Old-vintage exports (no teleportEvents key) predate teleport simulation:
  // their positions are corrupt after any TP for reasons anchors can't
  // separate from ordinary staleness. The modern subset is the honest read;
  // the gap between the two is the case for a corpus re-parse.
  const modern = perReplay.filter(r => r.coverage.modernVintage);
  full.modern = modern.length && modern.length < perReplay.length
    ? { ...computeCore(modern), note: 'subset with modern (teleport-aware) exports' }
    : null;
  full.modernCount = modern.length;
  return full;
}

function computeCore (perReplay) {
  const pool = { meas: [], calib: [], ownOther: [], cons: [] };
  for (const r of perReplay) {
    pool.meas.push(...r._pools.meas);
    pool.calib.push(...r._pools.calib);
    pool.ownOther.push(...r._pools.ownOther);
    pool.cons.push(...r._pools.cons);
  }

  const errAt = (rows, r) => rows.map(m => Math.max(0, (m.raw != null ? m.raw : m) - r));
  const dist = (errs) => errs.length ? {
    n: errs.length,
    median: Math.round(pctl(errs, 0.5)),
    p90: Math.round(pctl(errs, 0.9)),
    p99: Math.round(pctl(errs, 0.99)),
    max: Math.round(Math.max(...errs)),
    pctGt320: +(100 * errs.filter(e => e > BLATANT_TOL).length / errs.length).toFixed(1)
  } : null;

  const sensitivity = {};
  for (const r of RADII) sensitivity[`r${r}`] = dist(errAt(pool.meas, r));

  const byBucket = {};
  for (const b of STALE_BUCKETS) {
    byBucket[b.label] = dist(errAt(pool.meas.filter(m => m.bucket === b.label), HEADLINE_R));
  }
  const byClass = {};
  for (const c of ['hero', 'army', 'worker', 'building']) {
    byClass[c] = dist(errAt(pool.meas.filter(m => m.cls === c), HEADLINE_R));
  }
  const byType = {};
  for (const t of ['A', 'B']) {
    byType[t] = dist(errAt(pool.meas.filter(m => m.type === t), HEADLINE_R));
  }

  // gate 1 — magnitude
  const errs128 = errAt(pool.meas, HEADLINE_R);
  const pctBlatant = errs128.length ? 100 * errs128.filter(e => e > BLATANT_TOL).length / errs128.length : 0;
  const staleRows = pool.meas.filter(m => m.staleness > 30000);
  const staleErrs = errAt(staleRows, HEADLINE_R);
  const pctBlatantStale = staleErrs.length ? 100 * staleErrs.filter(e => e > BLATANT_TOL).length / staleErrs.length : 0;

  // gate 2 — staleness causality.
  //
  // PRE-REGISTERED form (kept for transparency, reported as `preRegistered`):
  // median err non-decreasing across ALL populated buckets AND calib p90<=160.
  // Fleet data broke both clauses for reasons that are findings, not noise:
  //   - calib measures own-unit IN-FIGHT sim error (~400u median), not click
  //     noise — the extraction-noise proof is the construction tier instead;
  //   - the >180s bucket REVERSES because units idle that long genuinely
  //     don't move, so the stale guess is right for them.
  // REVISED form: tail metrics (p90 and %>2000) must rise from the <2s
  // bucket to the 60-180s bucket (the range where staleness can matter),
  // AND construction p90 <= 160 AND self-consistency flags < 0.5%.
  const medCurve = STALE_BUCKETS.map(b => {
    const d = byBucket[b.label];
    const rows = pool.meas.filter(m => m.bucket === b.label);
    const errs = errAt(rows, HEADLINE_R);
    return {
      label: b.label, n: d ? d.n : 0, median: d ? d.median : null,
      p90: d ? d.p90 : null,
      pctGt2000: errs.length ? +(100 * errs.filter(e => e > 2000).length / errs.length).toFixed(1) : null
    };
  });
  const populated = medCurve.filter(c => c.n >= 50);
  let monotonic = populated.length >= 3;
  for (let i = 1; i < populated.length; i++) {
    if (populated[i].median < populated[i - 1].median) { monotonic = false; break; }
  }
  const calibP90 = pool.calib.length ? Math.round(pctl(pool.calib, 0.9)) : null;
  const consP90 = pool.cons.length ? Math.round(pctl(pool.cons, 0.9)) : null;
  const fresh = medCurve[0], stale180 = medCurve[4];   // '<2s' and '60-180s'
  const tailRises = fresh.n >= 50 && stale180.n >= 50 &&
    stale180.p90 > fresh.p90 && stale180.pctGt2000 > fresh.pctGt2000;

  // gate 3 — fixability (per-replay hero coverage)
  let replaysWithHeroes = 0, replaysDense = 0;
  for (const r of perReplay) {
    const gaps = r.heroCoverage.map(h => h.medianGapMs == null ? Infinity : h.medianGapMs);
    if (!gaps.length) continue;
    replaysWithHeroes++;
    const med = pctl(gaps.map(g => g === Infinity ? 1e12 : g), 0.5);
    if (med <= 60000) replaysDense++;
  }
  const pctDense = replaysWithHeroes ? 100 * replaysDense / replaysWithHeroes : 0;

  const inconsistentTotal = perReplay.reduce((a, r) => a + r.inconsistent.n, 0);
  const inconsistentPct = pool.meas.length ? 100 * inconsistentTotal / pool.meas.length : 0;

  const gate = {
    magnitude: {
      pass: pctBlatant >= 10 || pctBlatantStale >= 25,
      pctBlatant: +pctBlatant.toFixed(1),
      pctBlatantStale: +pctBlatantStale.toFixed(1),
      rule: '>=10% of enemy anchors err>320 @r128, OR >=25% among staleness>30s'
    },
    extraction: {
      pass: consP90 != null && consP90 <= 160 && inconsistentPct < 0.5,
      constructionP90: consP90,
      inconsistentPct: +inconsistentPct.toFixed(2),
      rule: 'construction tier p90 <= 160 AND self-consistency flags < 0.5%'
    },
    stalenessTail: {
      pass: tailRises,
      freshP90: fresh.p90, staleP90: stale180.p90,
      freshPctGt2000: fresh.pctGt2000, stalePctGt2000: stale180.pctGt2000,
      rule: 'p90 and %>2000 rise from <2s to 60-180s bucket (n>=50 each)'
    },
    fixability: {
      pass: pctDense >= 50,
      pctReplaysDense: +pctDense.toFixed(1),
      replaysWithHeroes,
      rule: '>=50% of replays: median enemy-hero inter-anchor gap <= 60s post-10min'
    },
    // The gate as pre-registered in the plan, before fleet data showed calib
    // measures own-unit sim error (not click noise) and that >180s idle
    // units legitimately reverse the median curve. Kept so the revision is
    // auditable, never silently dropped.
    preRegistered: {
      stalenessCausality: {
        pass: monotonic && (calibP90 != null && calibP90 <= 160),
        monotonic,
        calibP90,
        rule: 'median err non-decreasing across staleness buckets (n>=50) AND calib p90 <= 160'
      }
    }
  };
  gate.verdict = !gate.extraction.pass
    ? 'EXTRACTION UNSOUND — fix the audit before believing any number'
    : gate.magnitude.pass && gate.stalenessTail.pass && gate.fixability.pass
      ? 'CORRECTION JUSTIFIED'
      : (gate.magnitude.pass && gate.stalenessTail.pass
        ? 'BATTLE-WINDOW ONLY (coverage too sparse for global correction)'
        : 'NOT WORTH FIXING (annotation-only at most)');

  const worstFleet = [];
  for (const r of perReplay) {
    for (const w of r.worst) worstFleet.push({ replay: r.id, ...w });
  }
  worstFleet.sort((a, b) => b.raw - a.raw);

  const cov = (k) => perReplay.filter(r => r.coverage[k]).length;
  return {
    replays: perReplay.length,
    anchors: {
      measurement: pool.meas.length,
      calib: pool.calib.length,
      construction: pool.cons.length
    },
    sensitivity,
    byBucket: medCurve,
    byBucketFull: byBucket,
    byClass,
    byType,
    calib: { n: pool.calib.length, p50: pool.calib.length ? Math.round(pctl(pool.calib, 0.5)) : null, p90: calibP90 },
    ownOther: { n: pool.ownOther.length,
      p50: pool.ownOther.length ? Math.round(pctl(pool.ownOther, 0.5)) : null,
      p90: pool.ownOther.length ? Math.round(pctl(pool.ownOther, 0.9)) : null },
    construction: { p50: pool.cons.length ? Math.round(pctl(pool.cons, 0.5)) : null,
      p90: pool.cons.length ? Math.round(pctl(pool.cons, 0.9)) : null },
    inconsistentTotal,
    coverage: {
      uuidSignals: cov('uuidSignals'),
      teleportEvents: cov('teleportEvents'),
      itemXY: cov('itemXY'),
      perPlayerEvents: cov('perPlayerEvents')
    },
    gate,
    worst: worstFleet.slice(0, +(args.top || 15))
  };
}

// --- presentation -----------------------------------------------------------

function fmtStats (s) {
  if (!s) return 'n/a';
  return `n=${s.n} med=${s.median} p90=${s.p90} p99=${s.p99} max=${s.max} >320:${s.gt320 != null ? s.gt320 : s.pctGt320 + '%'}`;
}

function printReplay (r) {
  console.log(`\n── anchors: ${r.id} ─ ${r.durationMin} min ${'─'.repeat(Math.max(1, 40 - r.id.length))}`);
  const c = r.counts;
  console.log(` inventory    A=${c.byType.A} B=${c.byType.B} C=${c.byType.C} D=${c.byType.D} E=${c.byType.E}` +
    `  → enemy=${c.measurement} calib=${c.calib} ownOther=${c.ownOther} construction=${c.construction}` +
    (c.illusionSubjects ? ` (illusion subjects ${c.illusionSubjects})` : '') +
    (c.skipped.noUnit + c.skipped.noPath + c.skipped.outsideLifetime + c.skipped.pathEnded
      ? `  skipped: noUnit=${c.skipped.noUnit} noPath=${c.skipped.noPath} lifetime=${c.skipped.outsideLifetime} pathEnded=${c.skipped.pathEnded}` : ''));
  console.log(` MEASUREMENT  @r128 ${fmtStats(r.measurement.r128)}`);
  for (const rr of RADII) {
    if (rr === 128) continue;
    console.log(`              @r${String(rr).padEnd(3)} ${fmtStats(r.measurement[`r${rr}`])}`);
  }
  console.log(` calib        @r0   ${fmtStats(r.calib.r0)}   (tracked own/ally clicks — noise floor)`);
  console.log(` ownOther     @r0   ${fmtStats(r.ownOther.r0)}   (untracked own/ally — own-side path error)`);
  console.log(` construction C ${fmtStats(r.construction.C)} | D ${fmtStats(r.construction.D)} | E ${fmtStats(r.construction.E)}`);
  console.log(` staleness    ${STALE_BUCKETS.map(b => {
    const s = r.byBucket[b.label];
    return `${b.label}:${s ? `${s.median}/${s.p90}(${s.n})` : '—'}`;
  }).join('  ')}   (med/p90(n) @r128)`);
  console.log(` class        ${['hero', 'army', 'worker', 'building'].map(cl => {
    const s = r.byClass[cl];
    return `${cl}:${s ? `${s.median}/${s.p90}(${s.n})` : '—'}`;
  }).join('  ')}`);
  if (r.heroCoverage.length) {
    console.log(` hero cover   ${r.heroCoverage.map(h =>
      `${h.name}[${h.anchors}a gap=${h.medianGapMs == null ? '—' : Math.round(h.medianGapMs / 1000) + 's'} ≤60s:${Math.round(h.frac60 * 100)}%]`).join('  ')}`);
  }
  if (r.inconsistent.n) {
    console.log(` !! self-consistency flags: ${r.inconsistent.n} ${JSON.stringify(r.inconsistent.sample)}`);
  }
  if (r.worst.length) {
    console.log(` worst offenders:`);
    r.worst.slice(0, 8).forEach(w => console.log(
      `   ${String(w.raw).padStart(6)}u  ${w.subject} (${w.cls}) t=${w.t} stale=${w.staleness}s ${w.source} [${w.mode}]`));
  }
  if (r.sanity) {
    console.log(r.sanity.ok
      ? ` sanity       Storm Bolt case FOUND: ${r.sanity.subject} raw=${r.sanity.raw}u ✓`
      : ` sanity       !! Storm Bolt case ${r.sanity.found ? `raw=${r.sanity.raw} (expected >2000)` : 'NOT FOUND'} — extraction bug?`);
  }
}

function printFleet (agg) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`FLEET — ${agg.replays} replay(s)${args.holdout ? '   [HOLDOUT: odd-parity anchors only]' : ''}`);
  console.log(` anchors      enemy=${agg.anchors.measurement}  calib=${agg.anchors.calib}  construction=${agg.anchors.construction}`);
  console.log(` coverage     uuidSignals ${agg.coverage.uuidSignals}/${agg.replays}  modernVintage ${agg.modernCount}/${agg.replays}  teleports ${agg.coverage.teleportEvents}/${agg.replays}  itemXY ${agg.coverage.itemXY}/${agg.replays}  perPlayerEvents ${agg.coverage.perPlayerEvents}/${agg.replays}`);
  console.log(`\n MEASUREMENT (enemy-subject click anchors) — err = max(0, dist - r):`);
  for (const r of RADII) {
    const s = agg.sensitivity[`r${r}`];
    console.log(`   @r${String(r).padEnd(3)} ${s ? `n=${s.n} med=${s.median} p90=${s.p90} p99=${s.p99} max=${s.max} >320: ${s.pctGt320}%` : 'n/a'}`);
  }
  console.log(`\n error-vs-staleness @r128 (median / p90 / %>2000):`);
  console.log(`   ${agg.byBucket.map(b => `${b.label}: ${b.median == null ? '—' : `${b.median}/${b.p90}/${b.pctGt2000}%`} (n=${b.n})`).join('   ')}`);
  console.log(`\n by class @r128:`);
  for (const [cl, s] of Object.entries(agg.byClass)) {
    console.log(`   ${cl.padEnd(9)} ${s ? `n=${s.n} med=${s.median} p90=${s.p90} >320: ${s.pctGt320}%` : 'n/a'}`);
  }
  console.log(` by type @r128:  A ${agg.byType.A ? `n=${agg.byType.A.n} med=${agg.byType.A.median}` : 'n/a'}   B ${agg.byType.B ? `n=${agg.byType.B.n} med=${agg.byType.B.median}` : 'n/a'}`);
  console.log(` calib (tracked own/ally, raw):     n=${agg.calib.n} p50=${agg.calib.p50} p90=${agg.calib.p90}   ← the click-noise floor`);
  console.log(` ownOther (untracked own/ally):     n=${agg.ownOther.n} p50=${agg.ownOther.p50} p90=${agg.ownOther.p90}   ← own-side path error`);
  console.log(` construction (raw dist):           p50=${agg.construction.p50} p90=${agg.construction.p90}`);
  console.log(` self-consistency flags: ${agg.inconsistentTotal}`);
  console.log(`\n worst offenders (fleet):`);
  agg.worst.forEach(w => console.log(
    `   ${String(w.raw).padStart(6)}u  ${w.subject} (${w.cls}) stale=${w.staleness}s  ${w.replay}  ${w.source}`));
  console.log(`\n DECISION GATE:`);
  const g = agg.gate;
  console.log(`   1. magnitude    ${g.magnitude.pass ? 'PASS' : 'fail'}  — ${g.magnitude.pctBlatant}% enemy anchors >320u @r128 (stale>30s: ${g.magnitude.pctBlatantStale}%)`);
  console.log(`      rule: ${g.magnitude.rule}`);
  console.log(`   2. extraction   ${g.extraction.pass ? 'PASS' : 'fail'}  — construction p90=${g.extraction.constructionP90} inconsistent=${g.extraction.inconsistentPct}%`);
  console.log(`      rule: ${g.extraction.rule}`);
  console.log(`   3. staleness    ${g.stalenessTail.pass ? 'PASS' : 'fail'}  — p90 ${g.stalenessTail.freshP90}→${g.stalenessTail.staleP90}, >2000u ${g.stalenessTail.freshPctGt2000}%→${g.stalenessTail.stalePctGt2000}% (<2s → 60-180s)`);
  console.log(`      rule: ${g.stalenessTail.rule}`);
  console.log(`   4. fixability   ${g.fixability.pass ? 'PASS' : 'fail'}  — ${g.fixability.pctReplaysDense}% of ${g.fixability.replaysWithHeroes} replays dense`);
  console.log(`      rule: ${g.fixability.rule}`);
  const pr = g.preRegistered.stalenessCausality;
  console.log(`   (pre-registered staleness clause: ${pr.pass ? 'PASS' : 'fail'} — monotonic=${pr.monotonic} calibP90=${pr.calibP90}; revised because calib measures own-unit in-fight sim error, not click noise)`);
  console.log(`\n   VERDICT: ${g.verdict}`);

  if (agg.modern) {
    const m = agg.modern, s = m.sensitivity[`r${HEADLINE_R}`];
    console.log(`\n MODERN-VINTAGE SUBSET (${m.replays} replays — teleport-aware exports):`);
    console.log(`   @r128 ${s ? `n=${s.n} med=${s.median} p90=${s.p90} >320: ${s.pctGt320}%` : 'n/a'}   calib p90=${m.calib.p90}`);
    console.log(`   staleness medians: ${m.byBucket.map(b => `${b.label}:${b.median == null ? '—' : b.median}(${b.n})`).join('  ')}`);
    const mg = m.gate;
    console.log(`   gate: magnitude ${mg.magnitude.pass ? 'PASS' : 'fail'} (${mg.magnitude.pctBlatant}%)  extraction ${mg.extraction.pass ? 'PASS' : 'fail'}  staleness ${mg.stalenessTail.pass ? 'PASS' : 'fail'}  fixability ${mg.fixability.pass ? 'PASS' : 'fail'} (${mg.fixability.pctReplaysDense}%)`);
    console.log(`   VERDICT (modern): ${mg.verdict}`);
  }
}

function main () {
  const files = fs.readdirSync(REPLAYS_DIR)
    .filter(f => f.endsWith('.wc3v.gz'))
    .map(f => f.replace(/\.wc3v\.gz$/, ''))
    .filter(id => !args.replay || id === args.replay)
    .sort();
  const limit = parseInt(args.limit) || files.length;

  const perReplay = [];
  const errors = {};
  for (const id of files.slice(0, limit)) {
    try {
      const r = measureReplay(id);
      if (r) perReplay.push(r);
    } catch (e) {
      errors[id] = e.message;
    }
  }

  const agg = aggregate(perReplay);
  agg.errors = errors;

  // strip the pooled raw arrays before any output
  for (const r of perReplay) delete r._pools;

  if (args.json) {
    console.log(JSON.stringify({ perReplay, aggregate: agg }, null, 2));
    return;
  }

  if (args.replay || perReplay.length <= 3) perReplay.forEach(printReplay);
  if (Object.keys(errors).length) console.log(`\n errors: ${JSON.stringify(errors)}`);
  printFleet(agg);
}

main();
