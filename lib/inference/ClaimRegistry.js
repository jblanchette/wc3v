/*
 * ClaimRegistry — append-only registry of Claims with subject and reverse-
 * dependency indexes for O(1) updates and incremental fixpoint walks.
 *
 * One registry per Player. Strategies and the passes orchestrator read /
 * write through this; nothing pokes Player.* state directly during the
 * inference phase.
 *
 * Indexes:
 *   - byId          : Map<claimId, Claim>
 *   - bySubject     : Map<subject, Set<claimId>>     — fast lookup for
 *                     "what claims exist about p2.hero.Udea.slot.1.item?"
 *   - dependents    : Map<dependencyClaimId, Set<dependentClaimId>>
 *                     reverse-dependency index. Updating a claim's
 *                     confidence enqueues its dependents for re-evaluation.
 *
 * Dirty tracking: any addClaim / updateClaim / addEvidence call marks
 * the claim's id (and via dependents map, its downstream chain) as dirty.
 * The fixpoint pass consumes the dirty set, re-runs strategies for those
 * claims only, then clears.
 */

const {
  makeClaim,
  makeEvidence,
  aggregateScore,
  scoreToConfidence,
  isValidConfidence,
  compareConfidence
} = require('./Claim');

class ClaimRegistry {
  constructor () {
    this.byId       = new Map();
    this.bySubject  = new Map();
    this.dependents = new Map();
    this.dirty      = new Set();
  }

  // Add or replace a claim. If id already exists, merges evidence and
  // dependencies; otherwise stores fresh. Returns the stored claim.
  addClaim (opts) {
    const existing = opts.id ? this.byId.get(opts.id) : null;
    if (existing) {
      // Merge path: append evidence, union dependencies, keep history.
      if (Array.isArray(opts.evidence)) {
        for (const e of opts.evidence) existing.evidence.push(e);
      }
      if (Array.isArray(opts.dependencies)) {
        for (const d of opts.dependencies) {
          if (!existing.dependencies.includes(d)) existing.dependencies.push(d);
          this._linkDependency(d, existing.id);
        }
      }
      if (opts.payload && !existing.payload) existing.payload = opts.payload;
      this._markDirty(existing.id);
      return existing;
    }
    const claim = makeClaim(opts);
    this.byId.set(claim.id, claim);
    if (!this.bySubject.has(claim.subject)) {
      this.bySubject.set(claim.subject, new Set());
    }
    this.bySubject.get(claim.subject).add(claim.id);
    for (const d of claim.dependencies) {
      this._linkDependency(d, claim.id);
    }
    this._markDirty(claim.id);
    return claim;
  }

  // Add evidence to an existing claim. Does NOT recompute confidence here
  // — the fixpoint pass owns that. Marks the claim dirty.
  addEvidence (claimId, evidenceOpts) {
    const claim = this.byId.get(claimId);
    if (!claim) return null;
    const ev = makeEvidence(evidenceOpts);
    claim.evidence.push(ev);
    this._markDirty(claimId);
    return ev;
  }

  // Recompute confidence from current evidence + thresholds. Returns the
  // new confidence label (unchanged or updated). If confidence changes,
  // history is appended and all dependents are marked dirty.
  recomputeConfidence (claimId, thresholds, ctx) {
    const claim = this.byId.get(claimId);
    if (!claim) return null;
    const score = aggregateScore(claim.evidence);
    const newConfidence = scoreToConfidence(score, thresholds);
    if (newConfidence !== claim.confidence) {
      const prev = claim.confidence;
      claim.confidence = newConfidence;
      const at = (ctx && ctx.pass != null)
        ? { pass: ctx.pass, gameTime: ctx.gameTime != null ? ctx.gameTime : -1 }
        : { pass: -1, gameTime: -1 };
      claim.lastChangedAt = at;
      claim.history.push({
        pass: at.pass,
        gameTime: at.gameTime,
        confidence: newConfidence,
        from: prev,
        score,
        source: (ctx && ctx.source) || 'recompute',
        note: (ctx && ctx.note) || null
      });
      // Cascade: dependents need re-evaluation.
      const downstream = this.dependents.get(claimId);
      if (downstream) {
        for (const did of downstream) this._markDirty(did);
      }
    }
    return newConfidence;
  }

  getClaim (claimId) {
    return this.byId.get(claimId) || null;
  }

  findClaimsBySubject (subject) {
    const ids = this.bySubject.get(subject);
    if (!ids) return [];
    const out = [];
    for (const id of ids) {
      const c = this.byId.get(id);
      if (c) out.push(c);
    }
    return out;
  }

  // Iterate ALL claims. Strategies use this to scan for candidates;
  // bySubject is the hot path when the subject is known.
  *iterate () {
    for (const c of this.byId.values()) yield c;
  }

  // Best claim per subject by confidence (then by recency on tie). Used
  // by the commit pass to decide which value to materialize.
  bestForSubject (subject) {
    const claims = this.findClaimsBySubject(subject);
    if (!claims.length) return null;
    let best = claims[0];
    for (let i = 1; i < claims.length; i++) {
      const c = claims[i];
      const cmp = compareConfidence(c.confidence, best.confidence);
      if (cmp > 0) { best = c; continue; }
      if (cmp === 0) {
        const a = c.lastChangedAt && c.lastChangedAt.pass || 0;
        const b = best.lastChangedAt && best.lastChangedAt.pass || 0;
        if (a > b) best = c;
      }
    }
    return best;
  }

  takeDirty () {
    const out = this.dirty;
    this.dirty = new Set();
    return out;
  }

  size () {
    return this.byId.size;
  }

  // Export a serializable snapshot for inspect-replay / validator. Keeps
  // the full history so we can explain confidence changes after the fact.
  // Payload is included with circular refs (recordRef, eventStreamRefs)
  // stripped — the snapshot is read-only diagnostic data.
  toJSON () {
    const out = [];
    for (const c of this.byId.values()) {
      const safePayload = c.payload ? this._stripPayload(c.payload) : null;
      out.push({
        id:            c.id,
        subject:       c.subject,
        predicate:     c.predicate,
        value:         c.value,
        source:        c.source,
        confidence:    c.confidence,
        dependencies:  c.dependencies.slice(),
        evidence:      c.evidence.map(e => ({
          kind: e.kind, source: e.source, weight: e.weight,
          ref:  e.ref,  detail: e.detail
        })),
        createdAt:     c.createdAt,
        lastChangedAt: c.lastChangedAt,
        history:       c.history.slice(),
        payload:       safePayload
      });
    }
    return out;
  }

  _stripPayload (p) {
    const out = {};
    for (const k of Object.keys(p)) {
      // recordRef points back at _teleportEvents which is already
      // serialised separately; including it would deep-clone unbounded
      // structures.
      if (k === 'recordRef' || k === 'eventStreamRefs') continue;
      out[k] = p[k];
    }
    return out;
  }

  _linkDependency (depId, dependentId) {
    if (!this.dependents.has(depId)) this.dependents.set(depId, new Set());
    this.dependents.get(depId).add(dependentId);
  }

  _markDirty (claimId) {
    this.dirty.add(claimId);
  }
}

module.exports = ClaimRegistry;
