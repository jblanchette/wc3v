// Stub os for the browser bundle. Only os.platform() is used in the parser
// closure (PlayerManager + PathFinder, both for path-separator detection).
// In browser mode the cached-path branch is taken, so this is dead code —
// but bundling it anyway keeps the import resolution clean.

module.exports = {
  platform: () => 'browser'
};
