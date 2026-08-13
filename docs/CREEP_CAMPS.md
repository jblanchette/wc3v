# Creep camps: when they die, and how they fight

Two things about neutral creep camps are reconstructed rather than recorded:
**when a camp was cleared** and **where its creeps were standing**. The replay
format contains neither. This is what each is built from, what grades it, and
which parts are honestly still guesses.

---

## 1. Clear time

### Where it comes from

`clearedTime` is produced by **`lib/CampCreditModel.js`** (called from
`NeutralGroup._computePlayerCredit`), then upper-bounded by
`lib/SettlementClear.js`.

**It does NOT come from `NeutralGroup.calculateClaims`.** That function's
`multiplier` accumulator and `AttackSizes` table are the *legacy team path*:
they drive `claimState`, `contributions` and `progressTimeline` only. If you are
chasing a wrong clear time, `calculateClaims` is the wrong file.

(For the record, because it has been mis-read before: the
`currentClaim.multiplier = 1` resets in `calculateClaims` are **not** dead code.
`currentClaim` is assigned `claimers[teamId]` — the same object, not a copy.)

### The one hard fact in the data

`PlayerActions.doAbilityWithTargetAndObjectId` raises a camp interaction only
when a right-click resolves to a **live** neutral. You cannot issue an order
against a dead creep. So:

> An `interact-creep` event at time T, issued by a hero or combat unit standing
> within the creep leash, **proves** a creep of that camp was alive at T.

This is ground truth, and it outranks the work estimate. `CampCreditModel`
clamps `clearedTime` to it (`CLAMP_TO_PROOF_OF_LIFE`), and `SettlementClear`
rejects a "settling" building placed *before* it — on some maps an opening
building lands inside a camp footprint at ~0:20 and used to prove the camp was
cleared before the game started.

Clicks are restricted to in-zone fighters on purpose. Ordering an attack from
across the map is a legal order that resolves to a live creep but is not a
fight, and out-of-zone clicks are also where mis-resolved targets concentrate.

### The model

Work accrues while a team's fighters are engaged at the camp, and the camp needs
`PER_LEVEL_MS` per point of creep level. Four rules, each measured:

| Rule | Why |
|---|---|
| Work never accrues faster than the clock | Nothing kills a camp faster than real time. Hero speed belongs in the requirement, not in a >1 time multiplier. |
| Clicking is not killing (`INTERACTION_BOOST_CAP`) | Pros click constantly; an uncapped per-click bonus let click-spam clear a camp in seconds. |
| Presence is not clearing (`INTERACTION_WINDOW_MS`) | Standing near a camp kills nothing. Time counts only near a creep click. Without this, armies cleared camps by walking past repeatedly. |
| Enemies do not co-clear (`PER_TEAM_POOLS`) | Two armies colliding at a camp are mostly fighting each other. Pooling both sides cleared contested camps at ~2x the true rate. |

### What is NOT calibrated, and why

`PER_LEVEL_MS` is **pinned to the pre-existing effective value (2000/level)**,
not tuned.

The harness can grade *when* a camp cleared, because the replay proves creeps
were alive at specific moments. It cannot grade *whether* a camp cleared:
nothing distinguishes "poked it and left" from "killed it". There are no creep
deaths, and — measured — **zero `interact-item` events exist in the corpus**, so
the loot signal that would settle it is unavailable (see
`docs/PHASE0_FIXTURES.md`).

Consequently every audit metric improves monotonically as `PER_LEVEL_MS` falls,
down to absurd values that clear a camp the instant anyone hits it. That is the
metric running out of information, not evidence for a low value. Move this
constant only with real ground truth (creep deaths from a 1:1 re-sim, or hero
XP/level-up timing), never on the audit's error alone.

### Grading it

```
node tools/camp-clear-audit.js --reparsed            # fleet
node tools/camp-clear-audit.js --replay=ID           # per-camp detail
node tools/camp-clear-audit.js --reparsed --sweep    # compare model variants
node tools/camp-clear-audit.js --reparsed --grid=PER_LEVEL_MS
```

The harness imports `lib/CampCreditModel.js` and re-runs it over the exported
event log, so it always grades the model that ships. `--reparsed` restricts to
the last `reparse-all` run — 132 replays have no source `.w3g` and keep whatever
parser produced them, and mixing two parsers' output invalidates a comparison.

Scoring is two-sided against the bracket `[last proof of life .. end of the
fight]`, because a model that cleared every camp at the end of the game would
satisfy the proof-of-life bound perfectly and be useless.

**Result of this pass** (202 replays, 2135 gradable camps):

| | before | after |
|---|---|---|
| mean error vs bracket | 84.7s | 2.4s |
| cleared too early | 38.0% | **0.0%** |
| cleared too late | 26.2% | 1.0% |
| settle-bound violations | 0 | 0 |

The 17 remaining late camps are ones re-engaged repeatedly across a long game,
where work finally completes minutes after the last real fight.

---

## 2. A resolution bug that was corrupting all of it

When a right-click's object handles did not resolve to a known neutral, the
parser bound **the nearest unregistered neutral within 500wu of the click** to
those handles, permanently. One bad guess against an enemy unit standing near a
camp aliased that enemy to a creep for the rest of the replay.

Measured before the fix: **68 camps absorbed 85% of every creep interaction in
the corpus**, ~95% of them issued from outside the leash. One camp took 3713
"creep clicks" across 30 minutes. Each injected fake clearing work.

It was also stealing real orders: a neutral hit short-circuits the
enemy/own-building handling below it, so repair, burrow and tree-harvest
detection were skipped for every aliased click.

Two guards, in `World.isPlausibleNeutralTarget` and `PlayerActions`:

1. Neutrals are static, so a click resolving to one must land within
   `leash + slop` of it. A binding can be wrong; a position cannot.
2. Never guess when the handles already belong to a registered player unit.

Suspect click volume dropped from 85% of all interactions to 26%.

---

## 3. Creep movement

`lib/CreepGuardSim.js` reconstructs WC3 guard behaviour and bakes it into each
creep's exported `path`:

1. Creeps hold their spawn point until an enemy enters acquisition range.
2. A camp defends as a group — pull one troll and the camp comes.
3. Each creep chases its own nearest enemy, leashed to **its own** spawn.
4. Past the leash, or with the target gone, it walks home and resumes guarding.

This is reconstruction of deterministic engine behaviour, the same kind the
movement simulator already does for player units — not invented motion. The
leash comes from map constants when present, else the documented WC3 default,
surfaced with its source.

### Invariants (asserted, not assumed)

```
node tools/creep-leash-check.js
```

Leash respected, no motion at/after `clearedTime`, no drift into a camp the
creep's own leash cannot reach, samples time-ordered. Run it after any change
here. Current corpus: 9528 creeps with simulated motion, 461699 samples, **0
violations**. (55 "adjacent-camp overlap" hits are camps closer together than
one leash, whose guard circles genuinely overlap — map layout, not misbehaviour.)

### Estimated, and stated as such

- Acquisition range is a documented WC3 default, not a per-map value.
- Creep motion is only as good as the player paths that provoked it.
- No HP, damage or death order is modelled. This produces where a creep **was**,
  not how the fight went.

### Pass ordering

`CreepGuardSim` runs in `helpers/utils.buildOutputObject`, after claims and
`SettlementClear`, because it needs both finished player paths (the Anchor and
Kinematic passes have already rewritten them) and each camp's `clearedTime`.

**Known limitation:** that is *after* `BattleDetector`, so the battle detector
still sees static creeps. Moving it earlier is not possible without
`clearedTime`.

### Client

`ClientUnit.update` advances the neutral path cursor (it used to return early
for neutrals, which is why creeps could not move), `UnitBehavior` resolves creep
motion to `walk`, and `UnitModelRenderer` has a walk branch with stride-locking.
A walking creep is exempt from static-pose LOD — freezing a walker is what makes
units slide along in an idle pose.
