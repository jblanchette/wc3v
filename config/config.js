
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
	// Positional anchor correction — lib/AnchorCorrection.js. Pulls recorded
	// paths onto enemy-click anchors (even-parity only; odd half is the
	// tools/anchor-audit.js --holdout grading set). Default ON. Set false to
	// A/B against uncorrected paths.
	anchorCorrection: true
};

module.exports = config;
