# Handoff — creep camps: credit timing, then leash simulation

Paste this whole file as the opening prompt of a fresh session.

---

## What this project is

WC3V parses Warcraft III `.w3g` replays (Node, `lib/`) into `.wc3v` JSON and
renders them in a browser viewer (`client/`, plain JS, no bundler for the
viewer itself). Read `CLAUDE.md`, `lib/CLAUDE.md` and `client/CLAUDE.md` first.

Replays record **orders and selections, not positions or attacks**. Everything
the viewer shows between orders is simulation. That is the central constraint.

Reference replay for everything below:
`1129305842_Leon_Lucifer_AutumnLeaves20` (Leon = Human p1, Lucifer = Undead p2).

---

## Context: what was just fixed, so you do not redo it

A long session fixed a chain of "units are standing around doing nothing" bugs.
The user's standing rule, which turned out right every time:

> **A pro player's units are never just standing around. If a unit is idle
> through a fight, we missed an order — the player did not idle it.**

Shipped, in order:

1. **Selection tracking** (`config.selectionRule = 'merge-resync'`). A shift-add
   `ChangeSelection` was treated as a replace, evicting already-selected units.
   Graded against the AssignGroupHotkey oracle: exact match 65.6% → 83.6%.
2. **Anchor snaps** (`config.anchorSnapFar = false`). Corrections over 1500wu
   were emitted as `isJump` and rendered as teleports. Now skipped.
3. **Static-pose LOD** only freezes units that are standing still. It used to
   decide on screen size alone, so small on-screen walkers slid in a frozen
   idle pose.
4. **Call to Arms / Back to Work** (`0xD0067/8/9`, `0xD02AB`) were unmapped —
   19 of 20 orders did nothing. Now route through `Unit.morphTo`, with a 45s
   `EventTimer` auto-expiry (militia reverts with NO replay action) and a
   `militia` order + `UnitBehavior.ORDER_WINDOWS.militia` for combat licence.
5. **repair / resumeharvesting / burrow / unburrow** mapped and handled.
6. **Creeps stayed hidden during fights.** `MapRenderer` hid a camp's creeps
   the moment any team touched it, so armies were drawn swinging at empty
   ground. Now gated on `isCleared`.
7. **Militia were flagged `worker: true`** in `helpers/mappings.js`, which put
   them through the viewer's worker declutter. Now `false`, plus
   `ClientUnit.workerAt(gameTime)` so a peasant that is *currently* a militia
   is judged by the form it is in, not its final form.

---

## TASK 1 — camp credit clears camps far too fast

**Symptom (user-reported, confirmed):** creeps disappear way too early. The
camp is marked cleared while the fight is visibly still going.

**Evidence.** Camp 1 in the reference replay is Lv12, so required work is
`12 × 2400ms = 28,800ms`. It is credited as cleared at **2:38** after
engagement started at **2:18** — 20 seconds of real time. The fight there
actually ran to ~3:47 (`battle-0000`, 3:44–3:47, and the Death Knight was
harassing that camp throughout).

```
node inspect-replay.js --replay=1129305842_Leon_Lucifer_AutumnLeaves20 --show=camps-credit
node inspect-replay.js --replay=1129305842_Leon_Lucifer_AutumnLeaves20 --show=camps-debug
```

**Root cause — confirmed, in `lib/NeutralGroup.js`.** The accrual formula is:

```js
const timeAdded = (timeDiff * claimers[teamId].multiplier * attackSize.factor);
```

`claimers[teamId].multiplier` is a **team-level accumulator that only ever
grows**:

```js
claimers[teamId].multiplier += boost * (Math.max(heroes.length, 1));
// CAMP_INTERACTION_BOOST = 0.225, CAMP_HERO_INTERACTION_BOOST = 0.275
```

The three places that look like they reset it set **`currentClaim.multiplier = 1`**
— a *different object*. Nothing ever resets the value actually used in the
formula. **The reset is dead code.** Verify this before changing anything; it
is the single highest-value finding here.

Compounding it, `attackSize.factor` scales with `lastSeenCount`:

```js
const AttackSizes = {
  solo:   { size: 1,  factor: 1.0  },
  small:  { size: 3,  factor: 1.35 },
  medium: { size: 4,  factor: 1.55 },
  group:  { size: 6,  factor: 1.95 },
  army:   { size: 10, factor: 2.75 }
};
```

The user's hypothesis, which fits: militia inflate the selected-unit count past
10, so a Human calling militia to creep jumps straight to the `army` factor.

Worked example for camp 1: 6 interactions with a hero → multiplier
`1 + 6 × 0.275 = 2.65`; `attackSize.factor = 2.75`; product **≈ 7.3× real
time**. 20 real seconds credits ~146s against a 28.8s requirement.

**What to do.**

- Decide what the multiplier is *for* and bound it. An interaction boost that
  compounds without limit and never decays is not modelling anything real.
  Consider: cap it, decay it over time, or apply it per-segment (which is what
  `currentClaim.multiplier` was presumably meant to do).
- Check whether `attackSize` should count only units that can actually damage
  creeps, and whether it should be capped when combined with the multiplier.
- `MAX_CREDIT_PER_EVENT_MS = 10000` caps a single event's `timeDiff` but not
  the product.

**How to validate — do not tune by eye.** `tools/validate-camp-credit.js`
exists for exactly this and needs known-outcome replays. Ground truth for a
camp clear is genuinely available in several forms:

- `lib/SettlementClear.js` — a building placed inside a camp proves the camp
  was cleared before that time (camp 2 in the reference replay is a settled
  clear at 6:12).
- Hero XP / level-up timing (`--show=events --filter=HeroLevel`) brackets when
  camp XP actually landed.
- The battle detector's window for a camp fight (`--show=battles`).

A correct fix moves `clearedTime` LATER, toward the end of the observed fight,
without pushing settled-clear camps past their building placement.

**Constants live in `lib/NeutralGroup.js`:** `CAMP_CREDIT` (`PER_LEVEL_MS 2400`,
`INTERACTION_BOOST_MS 650`, `HERO_BOOST_FACTOR 1.20`, …), `AttackSizes`,
`CAMP_INTERACTION_BOOST 0.225`, `CAMP_HERO_INTERACTION_BOOST 0.275`,
`IN_CAMP_PADDING 256`, `COMBAT_CAMP_DISTANCE_SQ 700²`, `ENGAGEMENT_MARGIN 1500`,
`MAX_CREDIT_PER_EVENT_MS 10000`.

---

## TASK 2 — simulate creep aggro, chase and leash-back

**This is not invented motion.** WC3 creep guard behaviour is deterministic and
documented, and the engine constant is already in the codebase. Reconstructing
it is exactly as legitimate as reconstructing a unit's walk between two orders,
which the parser already does everywhere.

**The behaviour to model.**

1. Creeps stand at their spawn point until an enemy enters acquisition range.
2. On acquisition they attack the nearest valid target.
3. They chase it, but never beyond `creepGuardReturnDistance` from their
   **spawn point** (their guard position).
4. Once the target is out of that radius — or dead — they walk back to the
   spawn point and resume guarding. In the real game they also regenerate to
   full HP on the way back; we have no HP, so that part is not modelled.
5. Camps do not wander between camps. The leash circle is hard.

**The constant already exists.** `helpers/mappings.js`:

```js
const CREEP_GUARD_RETURN_DISTANCE = 1000;
function resolveCampLeash (gameConstants) {
  const v = gameConstants && gameConstants.creepGuardReturnDistance;
  if (typeof v === 'number' && isFinite(v) && v > 0) {
    return { distance: v, source: 'mapConstants' };
  }
  return { distance: CREEP_GUARD_RETURN_DISTANCE, source: 'wc3Default' };
}
```

It is already resolved per replay and surfaced in `--show=camps-credit`
(`leash=1000(wc3Default)`), and the camp-credit model already uses the leash to
separate "in camp" from "creep pull". Nothing consumes it for **movement**.

**What exists to build on.**

- Neutral player is id `1042`. Its units carry `neutralGroupId` linking them to
  a camp in `world.neutralGroups`.
- Each camp has `unitBounds` (tight) and `bounds` (padded), plus `clearedTime`.
- **Creeps currently have single-sample paths.** `ClientUnit` never advances
  the neutral player's path cursor, and `UnitModelRenderer` says so explicitly:
  *"camp creeps have single-sample paths … so they cannot move in this data
  model. The old walk branch was dead code."* That is the thing to change.
- `client/js/UnitModelRenderer.js` already has a full creep pipeline:
  `creepInstances`, `_createCreep`, `_parkCreep`, `_animateCreepState`, camp
  phases (`disturbed` / `engaged` / `cleared`), and per-creep target resolution
  at each creep's own range. It has idle and attack states and **no walk
  branch** — add one once creeps have positions.
- `client/js/UnitBehavior.js` is the authority for animation state. Creeps
  currently resolve to `idle reason=no-target`. Check `a.isCamp`.

**Where the simulation belongs.** Prefer the parser (`lib/`) so the movement is
baked into the exported path and every consumer — viewer, battle detector,
anchor audit — sees the same thing. A post-parse pass alongside
`lib/DeathInference.js` / `lib/HideInference.js` is the natural shape: it can
see the finished player paths and therefore knows when an enemy was in range of
each camp.

**How to verify.** A creep's simulated path must never exceed the leash radius
from its spawn point — that is a hard, checkable invariant, and worth a tool
(`tools/creep-leash-check.js`) that asserts it across the corpus. Beyond that,
the camp fight in the reference replay at 2:18–2:38 is the visual case: the
trolls should advance on Leon's army and fall back, not stand rooted.

Do not let creeps drift outside `unitBounds + leash`. Do not animate a creep
walking after `clearedTime` — it is dead.

---

## Tools you will want

```
node inspect-replay.js --replay=R --show=camps-credit|camps-debug|camps|behavior|pathdump
node tools/order-trace.js --replay=R --player=N --summary     # unmapped/dropped orders
node tools/validate-camp-credit.js                            # camp credit harness
node tools/anchor-audit.js --replay=R --holdout               # position error
node tools/check-determinism.js --replay=R
node tools/validate-output.js --replay=R
```

`order-trace`'s `DROPPED` label is a **heuristic** over the effects it probes,
not a verdict — an action whose only effect is a flag it does not watch reads
as DROPPED while working fine. `UNMAPPED_ORDER` is the reliable signal.

## Ship checklist (any `lib/` or `helpers/` change)

```
node tools/reparse-all.js --jobs=6        # ~12-15 min, 202 replays, MUST finish
node tools/import-replays.js --regen-summaries
node tools/sync-manifest-fingerprints.js
npm run build:parser                      # parser runs client-side too
node tools/verify-bundle-parity.js --replay=R
npm run build:site && npm run test:seo
node tools/deploy-replays.js              # R2; replays and code ship together
git push
```

Never edit `lib/` while a reparse is running — each replay is parsed in its own
child process and you will get an inconsistent corpus.

## House rules

- Trunk-based: commit straight to master.
- No inline `node -e` scripts; use `inspect-replay.js` or a real tool in `tools/`.
- Never start the dev server; the user runs it.
- Never read/grep `.wc3v` files directly — they are 1M+ lines.
- Measure before shipping, and check what it LOOKS like, not just what the
  metric says. Two changes this session improved a metric and made the viewer
  visibly worse.
