// Stub fs for the browser bundle. The hot parse path doesn't reach fs
// (PlayerManager.setGridData uses the injected mapDataCache). What remains
// are dead branches in CLI-only utilities (e.g. zipGameFile, write methods)
// that get bundled but never called. Stub them as no-ops; an accidental call
// will fail loudly on the missing return value, which is what we want.

const noop = () => {};
const throwInBrowser = (name) => () => {
  throw new Error(`fs.${name} is not available in the browser parser bundle`);
};

module.exports = {
  readFileSync: throwInBrowser('readFileSync'),
  writeFileSync: noop,
  existsSync: () => false,
  unlinkSync: noop,
  createReadStream: throwInBrowser('createReadStream'),
  createWriteStream: throwInBrowser('createWriteStream')
};
