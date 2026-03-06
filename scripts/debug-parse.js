/**
 * Debug script to test FLO replay parsing and output writing.
 * Usage: node scripts/debug-parse.js --replay=NAME
 */
const logManager = require('../helpers/logManager');
logManager.setLogger('debug-parse');
logManager.getLogger().init();

const { doParsing } = require('../wc3v');
const utils = require('../helpers/utils');
const config = require('../config/config');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const replayArg = args.find(a => a.startsWith('--replay='));
if (!replayArg) {
  console.error('Usage: node scripts/debug-parse.js --replay=NAME');
  process.exit(1);
}
const replayName = replayArg.split('=')[1];
const replayPath = `./replays/${replayName}.w3g`;

config.debugOutput = true;

doParsing(replayPath).then(result => {
  const { replay, players, world } = result;
  const real = Object.values(players).filter(p => !p.isNeutralPlayer);

  console.log('\n=== PARSE RESULT ===');
  console.log('Players:', real.length);
  for (const p of real) {
    const rec = replay.metadata.playerRecords.find(r => r.playerId === p.id);
    console.log(`  ID:${p.id} Name:${rec ? rec.playerName : '?'} Race:${p.race} Team:${p.teamId} Units:${p.units.length} Events:${p.eventStream.length}`);
  }

  console.log('\n=== WRITE OUTPUT ===');
  try {
    utils.writeOutput(replayPath, null, replay, players, world, 4);
  } catch (e) {
    console.log('writeOutput threw:', e.message);
  }

  const outPath = path.join(__dirname, '..', 'client', 'replays', `${replayName}.wc3v`);
  console.log('Checking:', outPath);
  const exists = fs.existsSync(outPath);
  console.log('Exists immediately:', exists);
  if (exists) {
    console.log('Size:', fs.statSync(outPath).size);
  }

  // wait for gzip stream
  setTimeout(() => {
    const existsLater = fs.existsSync(outPath);
    const gzExists = fs.existsSync(outPath + '.gz');
    console.log('After 2s - .wc3v:', existsLater, '.wc3v.gz:', gzExists);
    if (gzExists) {
      console.log('.gz size:', fs.statSync(outPath + '.gz').size);
    }
  }, 2000);
}).catch(err => {
  console.log('doParsing FAILED:', err.message);
});
