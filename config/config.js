
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
	moveTrace: false
};

module.exports = config;
