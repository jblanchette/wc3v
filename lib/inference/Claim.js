/*
 * Claim — an inferred fact the parser is asserting about replay state.
 *
 * Every "guess" the parser makes (auto-grant placement, item-slot binding,
 * teleport detection, summon attribution, target resolution, expansion
 * detection) lives as a Claim. Claims have signed Evidence supporting or
 * refuting them, a confidence rung, and a dependency graph so a downstream
 * claim's confidence updates when an upstream claim's confidence changes.
 *
 * Claims never get deleted — a rejected claim stays on the registry so the
 * validator can surface it and the inspect-replay tool can explain why.
 *
 * Confidence rungs (from strongest to weakest):
 *   confirmed > likely > possible > unlikely > rejected
 *
 * Signed evidence weights ∈ [-1, +1] sum to a score; thresholds in
 * helpers/claimThresholds.json (a labeling table, not magic numbers in
 * code) map score → rung. Per-claim-type tuning, easy to audit.
 */

const CONFIDENCE_LADDER = Object.freeze([
  'rejected', 'unlikely', 'possible', 'likely', 'confirmed'
]);

const CONFIDENCE_INDEX = Object.freeze(
  CONFIDENCE_LADDER.reduce((acc, c, i) => { acc[c] = i; return acc; }, {})
);

const isValidConfidence = (c) => CONFIDENCE_INDEX[c] != null;

// Compare two confidence labels: returns negative if a<b, positive if a>b, 0 if equal.
const compareConfidence = (a, b) => (CONFIDENCE_INDEX[a] || 0) - (CONFIDENCE_INDEX[b] || 0);

// Predicate kinds the registry understands. New kinds get added here as
// new claim subjects are migrated to the framework (Phase B / C).
const PREDICATES = Object.freeze({
  is:        'is',          // subject IS value (e.g. slot.item)
  occurred:  'occurred',    // event occurred (e.g. teleport@T)
  targets:   'targets',     // action targeted X
  resolves:  'resolves'     // ambiguous reference resolves to X
});

// Evidence is a signed observation contributing to a claim's score.
// `weight` ∈ [-1, +1]. Positive = supports the claim, negative = refutes.
//
// `kind` is one of:
//   - observation   : direct event/fact from the action stream
//   - absence       : the lack of an expected event (e.g. "no purchase before use")
//   - contradiction : explicit conflict with another claim
//   - correlation   : co-occurrence pattern (e.g. skeleton spawn + Rod use)
const EVIDENCE_KINDS = Object.freeze({
  observation:   'observation',
  absence:       'absence',
  contradiction: 'contradiction',
  correlation:   'correlation'
});

function makeEvidence (opts) {
  const e = {
    kind:   opts.kind   || 'observation',
    source: opts.source || 'unknown',
    weight: Number.isFinite(opts.weight) ? clamp(opts.weight, -1, 1) : 0,
    ref:    opts.ref    || null,
    detail: opts.detail || null
  };
  if (!EVIDENCE_KINDS[e.kind]) {
    throw new Error(`Claim/Evidence: invalid kind "${e.kind}"`);
  }
  return e;
}

function clamp (x, lo, hi) {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

// Build a fresh Claim. Required: id, subject, predicate, value, source.
// Optional: confidence (defaults 'possible'), evidence[], dependencies[].
function makeClaim (opts) {
  if (!opts || !opts.id || !opts.subject || !opts.predicate) {
    throw new Error('Claim: id, subject, and predicate are required');
  }
  if (!PREDICATES[opts.predicate]) {
    throw new Error(`Claim: invalid predicate "${opts.predicate}"`);
  }
  const confidence = opts.confidence || 'possible';
  if (!isValidConfidence(confidence)) {
    throw new Error(`Claim: invalid confidence "${confidence}"`);
  }
  const createdAt = opts.createdAt || { pass: 0, gameTime: -1 };
  return {
    id:            opts.id,
    subject:       opts.subject,
    predicate:     opts.predicate,
    value:         opts.value,
    source:        opts.source || 'unknown',
    confidence,
    evidence:      Array.isArray(opts.evidence) ? opts.evidence.slice() : [],
    dependencies:  Array.isArray(opts.dependencies) ? opts.dependencies.slice() : [],
    createdAt,
    lastChangedAt: opts.lastChangedAt || createdAt,
    // append-only audit trail; every confidence change pushes an entry.
    history: opts.history || [{
      pass: createdAt.pass,
      gameTime: createdAt.gameTime,
      confidence,
      source: opts.source || 'unknown',
      note: 'created'
    }],
    // optional payload for commit-time logic. Strategies and the commit
    // pass can stash anything here that's needed when the claim resolves
    // (e.g. the structured teleport record we'd otherwise commit immediately).
    payload: opts.payload || null
  };
}

// Score → rung. Given a thresholds object of shape:
//   { confirmed: 0.85, likely: 0.5, possible: 0.0, unlikely: -0.5 }
// any score ≤ rejected-cutoff (< unlikely cutoff) is 'rejected'.
function scoreToConfidence (score, thresholds) {
  if (!thresholds) thresholds = {};
  if (score >= (thresholds.confirmed != null ? thresholds.confirmed :  0.85)) return 'confirmed';
  if (score >= (thresholds.likely    != null ? thresholds.likely    :  0.5))  return 'likely';
  if (score >= (thresholds.possible  != null ? thresholds.possible  :  0.0))  return 'possible';
  if (score >= (thresholds.unlikely  != null ? thresholds.unlikely  : -0.5))  return 'unlikely';
  return 'rejected';
}

// Aggregate signed evidence into a single score ∈ [-1, +1]. Simple sum,
// clamped. Strategies can weight their evidence to express how strongly
// they update the claim; a single strong refutation (weight=-1) and a
// weak support (weight=0.1) yield score=-0.9 → rejected. That's intended.
function aggregateScore (evidence) {
  if (!Array.isArray(evidence) || !evidence.length) return 0;
  let sum = 0;
  for (const e of evidence) sum += (e.weight || 0);
  return clamp(sum, -1, 1);
}

module.exports = {
  makeClaim,
  makeEvidence,
  scoreToConfidence,
  aggregateScore,
  isValidConfidence,
  compareConfidence,
  CONFIDENCE_LADDER,
  CONFIDENCE_INDEX,
  PREDICATES,
  EVIDENCE_KINDS
};
