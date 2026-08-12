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

## 1. Shift-add selection  →  `sel-shiftadd.w3g`

**The bug this pins down.** This is the exact failure in
`1129305842_Leon_Lucifer_AutumnLeaves20`: a shift-click added two units, the
parser treated the action as a replace, the Death Knight fell out of the
selection, and every order for the next several seconds missed it.

Record with a hero and two clearly-distinguishable units (Human: Archmage +
2 Footmen is ideal, the hero is unmistakable in the output).

1. Move the hero and the 2 footmen to three visibly separate spots, at least a
   screen apart. **Do not group them.**
2. Left-click the hero alone. Right-click a spot far away. Let it walk 3 seconds.
3. **Shift-click footman A.** Do not click anything else.
4. **Shift-click footman B.**
5. Right-click a single distant destination. `mark` first.
6. Wait 10 seconds without touching anything.
7. `Ctrl+1`.

**Ground truth:** after step 5 **all three units** walk to that one destination
and arrive. The `Ctrl+1` at step 7 confirms the selection independently.

**Fails today** if the hero is left standing where it was at step 2, or if it
appears somewhere it was never ordered to go.

---

## 2. Deselect variants  →  `sel-deselect.w3g`

**The bug this pins down.** Once a unit enters the selection wrongly, WC3 never
names it in a deselect (the game does not think it is selected), so under a
naive always-merge rule it sticks for the rest of the game and collects every
order the player issues. Measured at ~6% of samples on
`1499624326_Ugly_TH000_Hammerfall`. These steps produce every clearing gesture
so we can see which one the parser must treat as a resync.

Record with 5 footmen, spread out, plus your hero.

1. Drag-select all 5 footmen. `mark`. Right-click a destination.
2. **Shift-click one footman to REMOVE it.** `mark`. Right-click a *different*
   destination.
3. Left-click one single footman (plain click, no shift). `mark`. Right-click a
   third destination.
4. Drag-select all 5 again, then shift-click 2 of them out. `mark`. Right-click
   a fourth destination.
5. `Ctrl+2`, then press `Esc`, then `Ctrl+2` again, then right-click a fifth
   destination.

**Ground truth:** at each `mark`, exactly the units you left selected move, and
the removed ones **stay put**. Step 3 in particular: 1 unit moves, 4 do not.

---

## 3. Stop / Hold / Burrow  →  `sel-stophold.w3g`

**What this pins down.** Stop and Hold are mapped and appear to work, but they
are rare in pro replays (2 stops, 1 hold in a 16-minute game), so they are
effectively untested. Burrow / Unburrow (`0xD0235` / `0xD0236`) are **not
mapped at all** and currently do nothing, which means a burrowed crypt fiend
keeps walking in the simulation.

Undead is the cleanest race here (crypt fiends burrow). If you would rather not
play UD, skip step 5–6 and record the rest with any race.

1. Select one unit. Right-click a destination roughly 3000 units away. `mark`.
2. At about 1 second into the walk, press **`S`**. `mark`.
3. Wait 10 seconds.
4. Right-click a new destination. At about 1 second in, press **`H`**. `mark`.
   Wait 10 seconds.
5. (UD) Select a crypt fiend, right-click a far destination, and at about
   1 second in press **burrow**. `mark`. Wait 10 seconds.
6. (UD) Unburrow. `mark`. Right-click a different destination.

**Ground truth:** at each of steps 2, 4 and 5 the unit stops **where it was when
you pressed the key** and does not continue to the original destination. Note
roughly where that was; the fixture asserts a `unitPosition` there 8 seconds
later with a 320u tolerance.

---

## 4. Control group churn  →  `sel-groups.w3g`

**What this pins down.** The target replay reassigns control groups 166 times.
Assign, select, add-to, and reassign-while-moving all interact with the
selection rule, and `assignGroupHotkey` currently overwrites the live selection
with the group contents, which is a correction most of the time and a
corruption some of the time.

Record with a hero and 4+ units.

1. Select hero. `Ctrl+1`. `mark`.
2. Select 3 footmen (drag). `Ctrl+2`. `mark`.
3. Press `1`. Right-click a far destination. `mark`.
4. Press `2`. Right-click a *different* far destination. `mark`.
5. Press `1`, then **shift-click a footman that is in group 2**, then `Ctrl+1`
   (reassign group 1 to hero + that footman). `mark`.
6. Press `1`. Right-click a third destination. `mark`.
7. While those are mid-walk, press `2` and right-click a fourth destination.
   `mark`.
8. Press `1` and `Ctrl+3` to copy the group. Press `3`, right-click a fifth
   destination.

**Ground truth:** step 6 moves exactly 2 units (hero + the one footman). Step 7
moves the 3 footmen from group 2, **and one of them is also in group 1** — it
takes the newer order and abandons the step-6 destination. That double-membership
case is what the current code gets wrong most often.

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
