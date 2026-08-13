
const config = {
  logToConsole: false,
	debugActions: false,
	debugPlayer: null,
	debugWorkers: false,
	debugOutput: false,
	// when true, prints HeroItemN dispatch context (slot, opcode, items[slot],
	// targetUnit) at every targeted/no-target item use. Diagnostic for
	// slot-drift investigations (phantom TP detection). Pairs with
	// `debugPlayer` to scope to one player.
	debugItemDispatch: false,
	// when true, capture authoritative replay move-command targets
	// (gameTime, targetX/Y, unit uuids) into player.moveTrace for the
	// path-verification harness. Opt-in via `--move-trace`; not exported
	// in normal runs.
	moveTrace: false,
	// when true, capture combat-formation resolution context (per attack order:
	// resolved slots, unit roles/ranges, enemy count, focus point, stop-vs-range
	// error) into player.formationTrace for tools/formation-check.js. Opt-in via
	// `--formation-trace`; not exported in normal runs.
	debugFormation: false,
	// Kinematic re-simulation of unit paths (move speed + turn rate + propulsion
	// window) — lib/KinematicResim.js. Default ON. Set false to fall back to the
	// legacy facing-only bake (lib/FacingInference.js) for A/B debugging.
	kinematicResim: true,
	// How a selectMode=1 ChangeSelection combines with the current selection.
	// The replay protocol has no "replace": a click sends DESELECT then SELECT,
	// a shift-add sends SELECT alone. Which of those a bare SELECT is cannot be
	// read off the action, so the rule is empirical — grade candidates against
	// the AssignGroupHotkey oracle with
	//   node tools/order-trace.js --replay=R --selcheck --rule=NAME
	//
	//   'legacy'       replace unless the previous change shared this gameTime.
	//                  Evicts already-selected units on every shift-add.
	//   'merge'        always add. Fixes shift-add, but drift never clears.
	//   'merge-resync' add, except a SELECT directly after a DESELECT in the
	//                  same tick replaces (click-to-reselect resync).
	//   'add-single'   add only when the SELECT names a single unit (a
	//                  shift-click); a multi-unit SELECT is the complete new
	//                  selection and replaces.
	selectionRule: 'merge-resync',
	// Block a tree doodad's pathing square CENTRED on the doodad position
	// instead of growing it +x/-y from that point. The doodad position is a
	// centre (the renderer draws the canopy there), so the old box sat half a
	// tile off the tree and units stood where the viewer draws foliage.
	// Measure with `node tools/tree-overlap.js --replay=R`.
	//
	// OFF pending its own reparse. The offset is a genuine defect and centring
	// does help, but only modestly — on
	// 1129305842_Leon_Lucifer_AutumnLeaves20, samples drawn inside a canopy go
	// 5.6% -> 4.8% and samples inside the tree's own tile 0.8% -> 0.6%. It is
	// not the cause of "units stuck in trees": the worst offenders report
	// pathBlocked=yes, i.e. they are placed inside already-blocked tiles by
	// collision separation / formation slots / anchor inserts, all of which run
	// downstream of this grid. Turning it on perturbs every path on every map,
	// so it wants a dedicated reparse and a look, not a ride-along.
	centredTreeBlocks: false,
	// Emit anchor corrections larger than AnchorCorrection's JUMP_DIST (1500wu)
	// as isJump snaps. The client renders those as a unit teleporting across
	// the map, which reads as a bug; false skips those anchors instead, so
	// corrected paths stay continuous and the only snaps left are real in-game
	// teleports. Small corrections — where the measured accuracy gain lives —
	// are unaffected either way.
	anchorSnapFar: false,
	// Positional anchor correction — lib/AnchorCorrection.js. Pulls recorded
	// paths onto enemy-click anchors (even-parity only; odd half is the
	// tools/anchor-audit.js --holdout grading set). Default ON. Set false to
	// A/B against uncorrected paths.
	anchorCorrection: true
};

module.exports = config;
