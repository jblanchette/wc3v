# Selection Fixtures — recording protocol

Four short replays you record yourself, to pin down how the parser must turn
`ChangeSelection` / `AssignGroupHotkey` / `SelectGroupHotkey` actions into a
selection. This is the input side of the movement simulator: whatever the
selection says, every subsequent order goes to those units, so a selection bug
shows up as units teleporting across the map.

Unlike `docs/ENGINE_TRUTH_CAPTURE.md`, truth here does not come from watching a
replay back. It comes from **the script you followed while recording**. You know
which units were selected because you were told exactly which ones to click. So
these are `meta.source: "designed-map"` fixtures: legitimate, non-circular, and
counted by `fidelity-report`.

## Why these four

`tools/order-trace.js --selcheck` already grades the parser against a free
oracle: `Ctrl+N` assigns whatever is currently selected and the replay lists
those units, so every control-group assignment is a labelled sample. That oracle
says the parser is wrong on 20–46% of samples depending on the replay. What it
cannot tell us is **which rule is right**, because a bare `selectMode=1` action
is ambiguous: it is emitted both for "add these to my selection" (shift-click)
and, at least sometimes, for "my selection is now exactly these" (drag-select).
These four recordings resolve that ambiguity by construction.

## Setup (all four)

- Melee map, any 1v1 ladder map is fine. **Single player vs an AI, or a custom
  game vs nobody.** No opponent interaction is needed and it keeps the action
  stream clean.
- Play the scenario, then leave. Keep each recording **under 3 minutes**.
- Grab the `.w3g` from your replay folder. On Reforged that is
  `Warcraft III\BattleNet\<accountId>\Replays\Autosaved\Multiplayer\`, not
  `Documents\Warcraft III\Replays` (see the note in the memory index; the path
  in ENGINE_TRUTH_CAPTURE.md is stale).
- Drop it in `replays/` named `sel-<scenario>.w3g`, then:
  ```
  node wc3v.js --replay=sel-<scenario> --debug
  node tools/order-trace.js --replay=sel-<scenario> --selcheck
  node tools/order-trace.js --replay=sel-<scenario>          # full trace
  ```

**Say the clock time out loud in chat** (`Enter`, type `mark`, `Enter`) right
before each numbered step. Chat lands in the action stream as `PlayerMessage`,
so it timestamps the step precisely and costs nothing.

---

## The one rule that makes these readable

**Every observation starts from rest.** Before each numbered step that issues a
move, all units must be standing still. If a unit is still walking off a
previous order, "did it move?" cannot be answered — a unit that was dropped
from the selection keeps executing its OLD order and still walks somewhere,
which looks identical to it having received the new one.

So: after every move, **wait until everything has stopped** before the next
step. That is the whole reason these scripts are slower than they look.

Pick destinations that are far apart and in **different directions**. If two
destinations are near each other, a unit heading to the wrong one still ends up
roughly right, and the fixture proves nothing.

---

## 1. Shift-add selection  →  `sel-shiftadd.w3g`

**The bug this pins down.** This is the exact failure in
`1129305842_Leon_Lucifer_AutumnLeaves20`: a shift-click added two units, the
parser treated the action as a replace, the Death Knight fell out of the
selection, and every order for the next several seconds missed it.

Record with a hero and two clearly-distinguishable units (Human: Archmage +
2 Footmen is ideal — the hero is unmistakable in the output). Call them
**H**, **A** and **B**.

Setup: park H, A and B in three separate spots roughly a screen apart, then
**let them all come to a complete stop**. Nothing below works if they are still
walking. Do not assign any control group yet.

1. `mark`. Left-click **H alone**. Right-click a destination to the **north**.
   Wait until H stops walking.
2. `mark`. Left-click **H alone** again (H is now at the northern spot).
3. **Shift-click A.** Selection is now H + A. Click nothing else.
4. **Shift-click B.** Selection is now H + A + B.
5. `mark`. **With all three still selected**, right-click ONE destination to the
   **south**, far from every unit's current position.
6. Wait until all three have stopped.
7. `Ctrl+1`.

**Ground truth.** Step 5 is the only order any of these units has outstanding,
and it goes to all three. H, A and B all walk south and arrive at that one
destination. The `Ctrl+1` at step 7 states the selection independently, so
`--selcheck` can grade it even if the positions are ambiguous.

**How it fails today.** The shift-click at step 3 replaces the selection instead
of adding to it, so H is evicted. H has no outstanding order (step 1 completed
and it stopped), so at step 5 it **stays at the northern spot** while A and B
walk south. The north/south split is what makes that readable — H sitting still
in the north cannot be confused with H heading south.

This is why step 1's move must finish before step 2. In the earlier draft H was
still walking when the shift-clicks happened, so a dropped H kept walking to its
old destination and the failure was invisible.

---

## 2. Deselect variants  →  `sel-deselect.w3g`

**The bug this pins down.** Once a unit enters the selection wrongly, WC3 never
names it in a deselect (the game does not think it is selected), so under a
naive always-merge rule it sticks for the rest of the game and collects every
order the player issues. Measured at ~6% of samples on
`1499624326_Ugly_TH000_Hammerfall`. These steps produce every clearing gesture
so we can see which one the parser must treat as a resync.

Record with 5 footmen. Number them **1–5** by position so you can tell them
apart in the output; a rough line works well.

Setup: park all 5 together and let them stop.

1. `mark`. Drag-select all 5. Right-click **north**. Wait for all 5 to stop.
2. `mark`. Drag-select all 5 again, then **shift-click footman 3 to REMOVE it**
   (selection is now 1,2,4,5). Right-click **east**. Wait for all to stop.
   → 1, 2, 4, 5 move east. **3 stays where it stopped in step 1.**
3. `mark`. Left-click **footman 3 alone** (plain click, no shift). Right-click
   **south**. Wait for it to stop.
   → 3 moves south. **1, 2, 4, 5 stay where they stopped in step 2.**
4. `mark`. Drag-select all 5, then shift-click **2 and 4** out. Right-click
   **west**. Wait for all to stop.
   → 1, 3, 5 move west. **2 and 4 stay put.**
5. `mark`. `Ctrl+2` to store the current selection, press `Esc`, then `2` to
   re-select the group, then right-click **north-east**.
   → the same 1, 3, 5 move. **2 and 4 stay put.**

**Ground truth.** At every step, the units you removed have NO outstanding order
and must not move at all. Because each step waits for a full stop first, a unit
that moves when it shouldn't is unambiguous evidence the parser kept it in the
selection.

**How it fails today.** A stale unit that drifted into the parser's selection
picks up each subsequent order, so the exported path shows 2 or 4 walking
north-east at step 5 when they physically never left their step-2 position.

---

## 3. Stop / Hold / Burrow  →  `sel-stophold.w3g`

**What this pins down.** Stop and Hold are mapped and appear to work, but they
are rare in pro replays (2 stops, 1 hold in a 16-minute game), so they are
effectively untested. Burrow / Unburrow (`0xD0235` / `0xD0236`) are **not
mapped at all** and currently do nothing, which means a burrowed crypt fiend
keeps walking in the simulation.

Undead is the cleanest race here (crypt fiends burrow). If you would rather not
play UD, skip step 5–6 and record the rest with any race.

This is the one scenario where the unit is deliberately mid-walk, because
interrupting a walk is the thing being tested. The discipline still applies at
the boundaries: each step begins from a standstill.

1. `mark`. Select one unit at rest. Right-click a destination roughly 3000
   units away — far enough that 1 second of walking covers only a small
   fraction of it.
2. About 1 second in, press **`S`**. `mark`. Note roughly where it stopped.
3. Wait 10 seconds without touching anything.
4. `mark`. Right-click a new destination in a **different direction**. About
   1 second in, press **`H`**. `mark`. Wait 10 seconds.
5. (UD) `mark`. Select a crypt fiend at rest, right-click a far destination,
   and about 1 second in press **burrow**. `mark`. Wait 10 seconds.
6. (UD) `mark`. Unburrow, wait for the animation to finish, then right-click a
   different destination and let it arrive.

**Ground truth.** At steps 2, 4 and 5 the unit stops within roughly one second
of walking from where it started, and **never reaches the commanded
destination**. That "never reaches" is the assertion — it is unambiguous
precisely because the destination was 3000 units away, so a unit that ignored
the stop ends up nowhere near where a unit that obeyed it does.

Write the fixture as a `unitPosition` 8 seconds after each stop, at the spot you
noted, tolerance 320. Add a second `unitPosition` at the same time for the
**commanded destination with the unit NOT there** — if the parser ignored the
stop, that is where it will be.

**How it fails today.** Burrow is unmapped, so at step 5 the crypt fiend keeps
walking underground all the way to the destination.

---

## 4. Control group churn  →  `sel-groups.w3g`

**What this pins down.** The target replay reassigns control groups 166 times.
Assign, select, add-to, and reassign-while-moving all interact with the
selection rule, and `assignGroupHotkey` currently overwrites the live selection
with the group contents, which is a correction most of the time and a
corruption some of the time.

Record with a hero **H** and three footmen **A**, **B**, **C**. Park them all
and let them stop.

1. `mark`. Select H alone. `Ctrl+1`.
2. `mark`. Drag-select A, B, C. `Ctrl+2`.
3. `mark`. Press `1`. Right-click **north**. Wait for H to stop.
   → H alone moves. **A, B, C stay put.**
4. `mark`. Press `2`. Right-click **east**. Wait for all three to stop.
   → A, B, C move. **H stays at the northern spot.**
5. `mark`. Press `1` (H alone), **shift-click A**, then `Ctrl+1`.
   Group 1 is now H + A; A is in BOTH groups. Nothing moves in this step.
6. `mark`. Press `1`. Right-click **south**. Wait for both to stop.
   → exactly H and A move. **B and C stay at their eastern spot.**
7. `mark`. Press `2`. Right-click **west**. Wait for all to stop.
   → A, B and C move west. A abandons the southern spot; **H stays south.**
   This is the double-membership case and the one the current code most often
   gets wrong.
8. `mark`. Press `1`, then `Ctrl+3` (copy group 1 to 3). Press `3`, right-click
   **north-east**. Wait for all to stop.
   → H and A move. **B and C stay west.**

**Ground truth.** Every step names exactly which units move and which must not,
and each begins from a full stop, so a unit that moves out of turn is direct
evidence the parser has it in the wrong group. Step 7 is the interesting one:
A must take the newer order even though it is still a member of group 1.

**Why the waits matter here.** Step 7 originally read "while those are mid-walk"
— that made A's position at step 7 depend on how far it had travelled under the
step-6 order, so no fixed assertion could be written for it. Letting step 6
finish first means A's expected position is just "the step-7 destination", full
stop.

---

## Turning a recording into a fixture

```
node tools/order-trace.js --replay=sel-shiftadd            # read the trace
node tools/capture-plan.js --replay=sel-shiftadd --out=client/data/engine-truth/sel-shiftadd.json
```

Then hand-edit the fixture. For every `mark`, write a `unitPosition` observation
for each unit that **should** have moved and each that **should not**, using the
destination you clicked (not a value read out of the parser):

```json
{
  "type": "unitPosition",
  "t": "1:24",
  "who": { "player": 1, "unitType": "Archmage" },
  "pos": { "x": 0, "y": 0 },
  "tolerance": 320,
  "note": "step 5 — shift-added units must ALL arrive here"
}
```

Set `meta.source` to `"designed-map"` and `meta.author` to yourself. Do **not**
set `_circular`. Verify with:

```
node tools/validate-engine-truth.js --replay=sel-shiftadd --verbose
```
