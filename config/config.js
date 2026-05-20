
const config = {
  logToConsole: false,
	debugActions: false,
	debugPlayer: null,
	debugWorkers: false,
	debugOutput: false,
	// when true, capture authoritative replay move-command targets
	// (gameTime, targetX/Y, unit uuids) into player.moveTrace for the
	// path-verification harness. Opt-in via `--move-trace`; not exported
	// in normal runs.
	moveTrace: false
};

module.exports = config;
