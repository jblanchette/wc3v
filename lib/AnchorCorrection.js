/**
 * AnchorCorrection — pull recorded paths onto the replay's positional anchors.
 *
 * Runs in wc3v.js BETWEEN HideInference and KinematicResim: Death/Hide keep
 * their raw-path contract, and the resim then physically smooths the corrected
 * stream — an inserted anchor sample is just another recorded sample its ghost
 * tracks, so move-speed and turn-rate caps still bind. No resim change needed.
 *
 * Measured motivation (docs/POSITIONAL_ANCHORS.md, Aug 2026): 52% of enemy
 * click anchors sit >320wu from the shipped path; p90 1.6k; tail to 12k.
 *
 * Per anchor (subject alive, time order, EVEN-parity only — the odd half is
 * the audit's holdout and must never be consumed):
 *   1. Sample the raw path at anchor time (gap-aware, shared isPathGap rule).
 *      Within r+64 of the anchor → agree, no-op.
 *   2. Otherwise insert a sample at the nearest point of the radius-r circle
 *      (minimal displacement; the unit was somewhere within r of the click).
 *      Displacements over 1500wu are marked isJump — the client snaps a gap,
 *      it must not render a cross-map sprint.
 *   3. Forward-reachability prune: recorded samples within the next 10s that
 *      the unit could not physically reach from the corrected point would
 *      drag the resim ghost straight back to the stale track — drop them
 *      until the first reachable sample. Beyond 10s the shared gap rule
 *      already starts a new run, so the prune never needs to reach further.
 *      Explicit jumps (teleports) are never pruned.
 *
 * Anchors that fall after a subject's final path sample are skipped: the
 * export carries no death time for heroes, and extending a possibly-dead
 * unit's path would draw corpses walking.
 *
 * Provenance: one informational rollup claim per corrected unit
 * (`p<id>.positionAnchor.<uuid>`) in the owner's claim registry — exported
 * via players[pid].claims, visible in inspect-replay --show=claims.
 */

const AnchorExtract = require('./AnchorExtract');
const { isPathGap } = require('./KinematicResim');

const AGREE_SLACK = 64;          // within r + slack, the path already agrees
const JUMP_DIST = 1500;          // beyond this, the correction is a snap, not a walk
const PRUNE_WINDOW_MS = 10000;   // gap rule starts a new run past this — never prune further
const PRUNE_SPEED_SLACK = 200;   // wu of forgiveness in the reachability test
const MIN_ANCHOR_SPACING_MS = 250; // click spam: one correction per burst is enough
const DEFAULT_MOVESPEED = 250;

const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

class AnchorCorrection {
  constructor (playerManager) {
    this.playerManager = playerManager;
    this.stats = {
      anchors: 0, consumed: 0, heldOut: 0, throttled: 0,
      agreed: 0, applied: 0, jumps: 0, pruned: 0,
      skippedLifetime: 0, skippedPathEnd: 0, skippedNoUnit: 0,
      unitsCorrected: 0, maxShift: 0
    };
  }

  run () {
    const anchors = AnchorExtract.extract(this.playerManager);
    this.stats.anchors = anchors.length;

    // uuid → { unit, player } across all players (summons included — same
    // coverage rule as KinematicResim.run()).
    const idx = new Map();
    const players = Object.values(this.playerManager.players || {});
    for (const player of players) {
      const units = (player.units || []).concat(player.destroyedSummons || []);
      for (const unit of units) {
        if (unit && unit.uuid) idx.set(unit.uuid, { unit, player });
      }
    }

    // Group per subject, preserving global time order.
    const bySubject = new Map();
    for (const a of anchors) {
      if (AnchorExtract.isHoldoutKey(a.subjectUuid, a.gameTime)) { this.stats.heldOut++; continue; }
      this.stats.consumed++;
      let arr = bySubject.get(a.subjectUuid);
      if (!arr) { arr = []; bySubject.set(a.subjectUuid, arr); }
      arr.push(a);
    }

    for (const [uuid, list] of bySubject) {
      const entry = idx.get(uuid);
      if (!entry) { this.stats.skippedNoUnit += list.length; continue; }
      this._correctUnit(entry.unit, entry.player, list);
    }
    return this.stats;
  }

  _correctUnit (unit, player, anchors) {
    if (unit.isBuilding) return;
    const path = unit.path;
    if (!path || !path.length) return;

    const moveSpeed = (unit.meta && unit.meta.movespeed > 0) ? unit.meta.movespeed : DEFAULT_MOVESPEED;
    let applied = 0, agreed = 0, pruned = 0, maxShift = 0;
    let lastAppliedT = -Infinity;
    let firstT = null, lastT = null;

    for (const a of anchors) {
      const t = a.gameTime;
      if (unit.spawnTime != null && t < unit.spawnTime - 1000) { this.stats.skippedLifetime++; continue; }
      if (unit.destroyedAt != null && t > unit.destroyedAt + 1000) { this.stats.skippedLifetime++; continue; }
      if (t > path[path.length - 1].gameTime) { this.stats.skippedPathEnd++; continue; }
      if (t - lastAppliedT < MIN_ANCHOR_SPACING_MS) { this.stats.throttled++; continue; }

      const pos = this._sampleAt(path, t);
      if (!pos) { this.stats.skippedPathEnd++; continue; }
      const d = dist(pos.x, pos.y, a.x, a.y);
      if (d <= a.r + AGREE_SLACK) { agreed++; lastAppliedT = t; continue; }

      // Minimal displacement: the point of the radius-r circle nearest the
      // current path position — never claim more than the click proves.
      const f = a.r / d;
      const cx = +(a.x + (pos.x - a.x) * f).toFixed(2);
      const cy = +(a.y + (pos.y - a.y) * f).toFixed(2);
      const shift = d - a.r;
      const isJump = shift > JUMP_DIST;

      // Insert after every sample with gameTime <= t.
      let i = this._indexAfter(path, t);
      const sample = { x: cx, y: cy, gameTime: Math.round(t) };
      if (isJump) { sample.isJump = true; this.stats.jumps++; }
      path.splice(i, 0, sample);
      i++;

      // Forward-reachability prune (bounded by the gap rule's own horizon).
      while (i < path.length) {
        const s = path[i];
        if (s.isJump) break;
        const dt = s.gameTime - t;
        if (dt > PRUNE_WINDOW_MS) break;
        if (dist(cx, cy, s.x, s.y) <= moveSpeed * (dt / 1000) + PRUNE_SPEED_SLACK) break;
        path.splice(i, 1);
        pruned++;
      }

      applied++;
      lastAppliedT = t;
      if (firstT == null) firstT = t;
      lastT = t;
      if (shift > maxShift) maxShift = shift;
    }

    this.stats.agreed += agreed;
    this.stats.applied += applied;
    this.stats.pruned += pruned;
    if (maxShift > this.stats.maxShift) this.stats.maxShift = Math.round(maxShift);

    if (applied > 0) {
      this.stats.unitsCorrected++;
      this._recordClaim(unit, player, { applied, agreed, pruned, maxShift: Math.round(maxShift), firstT, lastT });
    }
  }

  // Position on the raw path at time t: lerp, but never across a gap — the
  // nearest-in-time sample stands in on a discontinuity.
  _sampleAt (p, t) {
    if (t <= p[0].gameTime) return { x: p[0].x, y: p[0].y };
    const last = p[p.length - 1];
    if (t >= last.gameTime) return { x: last.x, y: last.y };
    let lo = 0, hi = p.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (p[m].gameTime <= t) lo = m; else hi = m - 1; }
    const a = p[lo], b = p[lo + 1];
    if (!b) return { x: a.x, y: a.y };
    if (isPathGap(a, b)) {
      return (t - a.gameTime) <= (b.gameTime - t) ? { x: a.x, y: a.y } : { x: b.x, y: b.y };
    }
    const dt = b.gameTime - a.gameTime;
    const f = dt > 0 ? (t - a.gameTime) / dt : 0;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }

  _indexAfter (p, t) {
    let lo = 0, hi = p.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (p[m].gameTime <= t) lo = m + 1; else hi = m; }
    return lo;
  }

  // Informational provenance — one rollup claim per corrected unit, on the
  // OWNER's registry. No evidence, no strategies: geometry is deterministic.
  _recordClaim (unit, player, summary) {
    if (!player) return;
    if (!player._claimRegistry) {
      const ClaimRegistry = require('./inference/ClaimRegistry');
      player._claimRegistry = new ClaimRegistry();
    }
    player._claimRegistry.addClaim({
      id: `p${player.id}.positionAnchor.${unit.uuid}`,
      subject: `p${player.id}.positionAnchor.${unit.uuid}`,
      predicate: 'is',
      value: {
        unitItemId: unit.itemId,
        applied: summary.applied,
        agreed: summary.agreed,
        pruned: summary.pruned,
        maxShiftWu: summary.maxShift
      },
      source: 'anchor-correction',
      confidence: 'confirmed',
      createdAt: { pass: 0, gameTime: summary.lastT },
      payload: { firstT: summary.firstT, lastT: summary.lastT }
    });
  }
}

module.exports = AnchorCorrection;
