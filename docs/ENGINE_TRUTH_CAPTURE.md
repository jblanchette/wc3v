# Engine-Truth Capture Protocol

How to produce ground-truth fixtures (`client/data/engine-truth/<replay-id>.json`)
by watching the REAL Warcraft III engine play a replay, side by side with the
wc3v viewer. These fixtures are the only measurement in the fidelity stack that
compares against the actual game rather than against our own rules — see
`tools/fidelity-report.js` for where they land.

**The one rule: expectations come from the game screen, never from parser or
viewer output.** A fixture value copied from the parser is circular and proves
nothing. The capture-plan skeleton pre-fills *where to look* (windows, areas);
every `VERIFY:` field is *what you saw*.

## Roles

- **You (human)**: launch the game and the dev server, control replay playback,
  answer the ground-truth questions ("who is attacking whom?").
- **Assistant (Claude)**: generates the capture plan, fires screenshots at the
  marks (`screen-capture-mcp` for the game, `chrome-devtools` for the viewer),
  walks the screenshot pairs with you afterwards, and fills the fixture JSON.
  The assistant never starts the game or the server.

Observation only — no memory reading, no injection, no game-file modification.

## Session workflow

### 1. Prepare

```
node tools/capture-plan.js --replay=ID
node tools/capture-plan.js --replay=ID --out=client/data/engine-truth/ID.json
```

The first prints the ordered game-clock marks (battles, camp clears, phantom
traps, position samples). The second writes the fixture skeleton (refuses to
overwrite). Marks flagged `⚠ PHANTOM TRAP` are the highest-value moments: the
viewer is suppressing more attack frames than it shows there, and only the real
game can say whether that suppression is right.

- Copy the source `.w3g` (from `replays/`) into
  `Documents\Warcraft III\Replay\`.
- Launch WC3 (Reforged), open the replay from the in-game **Replays** menu.
  W3Champions replays are 1.32+ format and play in Reforged; a version-mismatch
  error means that replay can't be captured on this client — pick another.
- Make sure the match clock is visible (observer UI). The visible clock is the
  timestamp authority — no OCR, no guessing.
- Start the dev server yourself; the assistant opens the same replay in the
  viewer via the browser MCP.

### 2. Capture (single forward pass — Reforged can speed up but not seek)

- Play at 4–8× between marks; drop to 1× ~15 s before each mark.
- At the mark, the assistant screenshots the game full-screen (clock in frame),
  then seeks the viewer to the same MM:SS (the viewer is seek-safe) and
  screenshots it.
- Missed a mark? Skip it — catch it on a second pass, or drop the stub. The
  fixture records only what was actually observed.
- Screenshots land in `debug/captures/<replay-id>/<mmss>-{game,viewer}.png`
  (gitignored). The committed artifact is the small fixture JSON.

### 3. Annotate

The assistant walks each screenshot pair with you and fills the skeleton:

- **engagement** — who was really attacking, roughly how many, of what type?
  If the real game showed *no* combat in that window/area, convert the stub to
  a `noCombat` observation — that is the direct phantom-combat catcher.
- **noCombat** — add one for every quiet stretch you noticed (army idling at a
  ramp, units standing in base). Highest-value observation type.
- **campClear** — the moment the last creep died and who did it. Use a ≥20 s
  window: derived camp times jitter ±10 s across re-parses.
- **unitPosition** — confirm on the *game* screenshot where the unit is, then
  read the world coordinate off the *viewer* at the same clock (hover/click).
  The game is trusted for *what is happening*; the viewer is trusted for
  *coordinates of things you confirmed exist*.
- **death** — unit type, count, window, and rough area from the game screen.

Trim every stub you didn't observe. Fill `meta` (date, WC3 build, speeds).
If the game clock and the replay clock disagree by a constant offset, measure
it once against an unambiguous event (first hero leaving the altar) and set
`meta.clockOffsetMs`.

### 4. Score

```
node tools/validate-engine-truth.js --replay=ID --verbose
node tools/fidelity-report.js --replay=ID
```

Failures here are findings, not harness bugs — they are exactly what the
correction-rule experiments (time-sliced battle corroboration, army
combatOrderTimes, melee-vs-air targeting, drift fixes) are measured against:
capture `fidelity-report --json` before a change, `--diff` after.

## Fixture format reference

See `tools/validate-engine-truth.js` header for the observation types and the
comparator grammar (`>=N`, `A..B`, `MM:SS..MM:SS`, ...).
`client/data/engine-truth/_selftest.json` is a `_circular` harness selftest —
it proves the machinery, not fidelity, and fidelity-report ignores it. Real
fixtures must never set `_circular`.
