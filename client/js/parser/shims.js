// Browser shims for the wc3v parser bundle. parserEntry.js requires this
// FIRST so these globals exist before any other bundled module evaluates.
//
// Why each one:
//   1. console.logger — the wc3v CLI flow installs this on construction of
//      helpers/logManager Logger. The parser code calls it throughout. We
//      bypass that path in the browser, so install a no-op.
//   2. Buffer — Node's global. The buffer npm polyfill provides one; we
//      hoist it onto globalThis so free `Buffer` references throughout the
//      bundled wc3v + helpers + lib closure resolve via the scope chain.
//   3. process — same idea. Some helpers reference process.platform etc.

if (typeof console.logger !== 'function') {
  console.logger = () => {};
}

if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = require('buffer').Buffer;
}

if (typeof globalThis.process === 'undefined') {
  globalThis.process = require('process');
}

module.exports = {};
