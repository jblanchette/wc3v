# Positional Anchors: Error Report and Judgement

**Date:** 2026-08-09. **Tool:** `tools/anchor-audit.js`. **Corpus:** 334 exported
replays in `client/replays/*.wc3v.gz`, measured offline with zero parser changes
and zero reparses.

> **Stage 1 correction: ADOPTED 2026-08-09.** `lib/AnchorExtract.js` +
> `lib/AnchorCorrection.js` run between HideInference and KinematicResim,
> consuming even-parity anchors only (`config.anchorCorrection`, default on).
> Graded on the 19,408 odd-parity holdout anchors the correction never saw:
> median err 346 → 252 (−27%), p90 1,688 → 1,088 (−36%), blatant share
> 52.6% → 43.0%; worst staleness band p90 3,234 → 1,807, tail 14.6% → 9.2%.
> Fidelity diff vs `debug/fidelity-base.json`: dead flat (334/334 unchanged,
> invariants 0, speed violations 0 on the modern corpus). Determinism and
> bundle parity verified. The plan's aspirational holdout target (p90 < 320)
> was NOT met and cannot be: the measured ~400wu in-fight sim floor binds
> everything between anchors. Sections below describe the pre-correction
> corpus that motivated the change.

## The question

WC3 replays record orders, not positions. `lib/KinematicResim.js` turns the order
stream into a physically valid path, but between orders a unit's position is a
guess, and for enemy units nobody is ordering, the guess goes stale. Certain
replay actions prove a unit was at a known point at a known time. How wrong are
the shipped paths against those proofs, and is a correction pass worth building?

## What an anchor is

When a player attack-clicks, right-clicks, or casts a spell on an enemy unit,
the replay records the target's object id AND the coordinates of the click. The
cursor was over the target's model, so the click point is the target's true
position at that instant, within selection-circle slop. The parser resolves the
identity (`targetUuid` in exported battle signals) but discards the position: it
never touches the target unit's path. That discarded coordinate is the anchor.

Anchors are parser-derived. They cross-check the parser's internal consistency
and are NOT a substitute for engine-truth fixtures, whose expectations must come
from watching real WC3 (`tools/validate-engine-truth.js`). Do not conflate the
two; the fidelity harness stays non-circular only if that line holds.

## Method

Three disjoint sets, split by what they can prove:

- **Measurement** (38,745 anchors): clicks whose subject is an enemy of the
  clicker. Sources: battle signals with `targetUuid` (kinds `attack-unit`,
  `right-click-enemy`, `spell-target-unit`; synthetic `proximity` signals are
  path-derived and hard-excluded as circular) plus eventStream `spellCast`
  events on uniquely resolvable enemy heroes.
- **Calibration** (1,414): the same click anchors on own/ally units whose path
  the sim was actively tracking (live lerp bracket, span <= 5s). Intended as the
  click-noise floor. The data reinterpreted it; see finding 4.
- **Construction** (135,513): teleport origins/destinations, item pickups, creep
  interactions. The parser already baked these coordinates into paths, so they
  prove only that extraction and path sampling work. Expected ~0 error.

Error = distance from the subject's exported `path[]` (gap-aware sampling, the
shared `isPathGap` rule from `tools/lib/kinematics-audit.js`) to the anchor
point, minus a radius allowance (sensitivity set 0/64/128/256; headline at 128).

Guards found necessary during hand-verification:

- **Staleness is actor-side only.** Being clicked does not update the parser's
  path, so it must not reset staleness. Staleness = time since the subject last
  ACTED in any exported signal/cast/teleport. It is a proxy: true per-unit order
  times do not survive export (`combatOrderTimes` is workers-only,
  `moveHistory` is always empty).
- **pathEnded segregation.** Hero deaths carry no `destroyedAt` (heroes revive),
  so anchors more than 60s past a subject's final path sample are counted
  separately, not scored. Scoring a cast against a corpse's resting position is
  not a path error.
- **Self-consistency check.** Two anchors on one subject closer in time than any
  unit could bridge the distance flag an extraction bug. Fleet total: 16 flags
  in 38,745 anchors (0.04%).

## Fleet results

Enemy-subject anchors, err = max(0, dist − r):

| radius | n | median | p90 | p99 | max | >320u |
|---|---|---|---|---|---|---|
| r=0 | 38,745 | 471 | 1,760 | 7,866 | 12,410 | 66.8% |
| **r=128** | 38,745 | **343** | **1,632** | **7,738** | **12,282** | **52.3%** |
| r=256 | 38,745 | 215 | 1,504 | 7,610 | 12,154 | 40.8% |

Error vs staleness at r=128 (median / p90 / %>2000u):

| <2s | 2-10s | 10-30s | 30-60s | 60-180s | >180s |
|---|---|---|---|---|---|
| 297 / 1216 / 7.0% | 345 / 1374 / 7.7% | 410 / 1771 / 8.8% | 372 / 1918 / 9.8% | 379 / **3079** / **13.9%** | 311 / 1211 / 6.1% |

By class at r=128: heroes med 309, p90 1,014 (48.8% >320u); army med 424, p90
2,701 (59.0%); workers med 170 (34.7%).

Reference distributions: calibration p50 411 / p90 1,157; own/ally anchors
without a live bracket p50 1,099 / p90 6,715; construction p50 6 / p90 58.

Coverage: 191/334 replays have uuid-bearing signals; 202/334 are modern-vintage
exports (have the `teleportEvents` key). Old-vintage exports contribute ZERO
anchors, so the effective corpus is the modern ~200. The motivating case
(Storm Bolt at 10:01 in `1129305842_Leon_Lucifer_AutumnLeaves20`, Pit Lord
path 2,548wu from the click) reproduces from exported data alone and is a
built-in sanity assertion in the tool.

## Findings

1. **The error is large and pervasive.** Half of all enemy-click anchors
   (52.3%) exceed the 320wu blatant threshold even after a 128wu allowance.
   The viewer draws the clicked unit somewhere else in one of every two
   fight-relevant moments it could be checked.
2. **The catastrophic tail is real and staleness-driven.** p90 doubles and the
   >2000wu share doubles from fresh to the 60-180s staleness band. Worst
   offenders reach 8-12kwu: summons spawned at stale summoner positions,
   units repeatedly clicked at a place the parser never learned about.
3. **The staleness curve reverses past 3 minutes.** Units idle >180s genuinely
   do not move; their last known position is right more often (med 311, tail
   6.1%). Staleness hurts most for recently active, mid-map units.
4. **Own units in fights are ~400wu off too.** The calibration set (own/ally
   targets with an actively tracked path) shows p50 411. This broke the plan's
   assumption that own paths are accurate: in-fight positions are approximate
   for everyone, and battle scenes as a whole are drawn displaced. The
   construction tier (p90 58) proves this is not extraction noise.
5. **Extraction is sound.** Construction p90 = 58wu, self-consistency flags
   0.04%. The measurement machinery can be trusted.
6. **Anchor coverage is dense enough to act on.** In 65.5% of the 145
   hero-bearing replays, enemy heroes have a median inter-anchor gap <= 60s
   after minute 10.

## Decision gate

Pre-registered gate (from the approved plan): magnitude PASS (52.3% >= 10%);
staleness-causality FAIL as written (median curve not monotonic because of the
>180s reversal, and calib p90 1,157 > 160 because calib measures own-unit sim
error, not click noise); fixability PASS (65.5% >= 50%).

The staleness clause was revised after fleet data showed both of its
sub-assumptions were wrong for stated, mechanistic reasons (findings 3 and 4).
Revised clause: extraction soundness moves to the construction tier
(p90 <= 160 AND self-consistency < 0.5%: PASS at 58 / 0.04%) and causality is
tested on the tail over the range where staleness can matter (p90 and %>2000u
rising from <2s to 60-180s: PASS, 1216 → 3079 and 7.0% → 13.9%). The original
clause is still computed and printed by the tool under `preRegistered` so the
revision stays auditable.

**Verdict: CORRECTION JUSTIFIED**, with calibrated expectations:

- It will kill the catastrophic tail (the 8-14% of stale-band anchors more than
  2000wu off, the Storm Bolt class of error) and pin fights to their true
  locations for BOTH armies, since in a 1v1 each side's units are anchored by
  the opponent's clicks.
- It will NOT push positional error below roughly 300-400wu, because that is
  the sim's in-fight floor for actively tracked units (finding 4). Fixing that
  floor is a simulation problem (formation, engagement positioning), not an
  anchor problem.

## What anchors cannot fix

- Units that never act and are never clicked have no anchors, ever. An
  unengaged army sitting in base is unconstrained.
- Anchors bound points, not routes. Between anchors the path remains the sim's
  guess.
- The ~132 old-vintage exports contribute nothing until re-parsed.
- Non-hero `spellCast` targets carry no uuid in the eventStream and are only
  usable via battle signals.
- Per-battle signals are capped at 400 at export and orphan clusters are
  dropped; parse-time extraction (Phase 1b/3) sees more than this audit does.
- The accuracy floor is the click itself: ~64-128wu of selection slop, plus the
  ~400wu in-fight sim floor documented above.
- Anchors reveal where fog-hidden units really were. That is the point, but it
  changes what the viewer shows for units the observed player could not see.

## Recommended next steps (in order)

1. **Corpus reparse at HEAD: DONE 2026-08-09, and it was a no-op.**
   `tools/reparse-all.js` succeeded 202/202; the other 132 replays are orphans
   (source `.w3g` missing) and can never be reparsed. The post-reparse audit is
   byte-identical to the pre-reparse one: the reparseable exports were already
   current. Offline anchor coverage is therefore at its ceiling (202 replays,
   38,745 enemy anchors). Any further coverage requires parse-time extraction.
2. **Stage 1 correction** per the approved plan: `lib/AnchorExtract.js` +
   `lib/AnchorCorrection.js` as a pass between HideInference and KinematicResim,
   anchors become recorded samples the resim ghost tracks, speed/turn caps
   still bind. Adoption gate: even/odd anchor holdout
   (`anchor-audit --holdout` measures the half the correction never consumed),
   `fidelity-report --json` base vs `--diff`, `check-determinism`,
   `verify-bundle-parity`, fx-bench spot check on the Storm Bolt replay.
3. **Not in scope for anchors:** the ~400wu in-fight floor. If it matters, it
   needs engine-truth captures and sim work, tracked separately.

## Running it

```
node tools/anchor-audit.js                 # fleet report + gate
node tools/anchor-audit.js --replay=ID     # single replay detail
node tools/anchor-audit.js --json          # machine-readable snapshot
node tools/anchor-audit.js --holdout       # odd-parity anchors only
node tools/anchor-audit.js --dumpcalib     # calibration rows, for debugging
```
