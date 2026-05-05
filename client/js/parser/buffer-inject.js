// Injected at the top of the bundle. Re-exports globals that the parser
// closure expects but the browser does not provide natively.
const _bufferModule = require('buffer');
const _processModule = require('process');
module.exports = {
  Buffer: _bufferModule.Buffer,
  process: _processModule
};
