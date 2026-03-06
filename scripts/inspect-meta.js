/**
 * Quick script to inspect replay metadata (slots, players, etc.)
 * Usage: node scripts/inspect-meta.js --replay=NAME
 */
const W3GReplay = require('w3gjs').default;
const args = process.argv.slice(2);
const replayArg = args.find(a => a.startsWith('--replay='));
if (!replayArg) {
  console.error('Usage: node scripts/inspect-meta.js --replay=NAME');
  process.exit(1);
}
const replayName = replayArg.split('=')[1];
const replayPath = `replays/${replayName}.w3g`;

const parser = new W3GReplay();

parser.on('basic_replay_information', (info) => {
  console.log('=== Player Records ===');
  console.log(JSON.stringify(info.metadata.playerRecords, null, 2));
  console.log('\n=== Slot Records ===');
  console.log(JSON.stringify(info.metadata.slotRecords, null, 2));
  console.log('\n=== Game Name ===');
  console.log(info.metadata.gameName || '(none)');
  console.log('\n=== Map ===');
  console.log(info.metadata.map || '(none)');
});

let commandPlayerIds = new Set();
parser.on('gamedatablock', (block) => {
  const commandBlocks = block.commandBlocks || [];
  commandBlocks.forEach(cb => {
    if (cb.playerId !== undefined) commandPlayerIds.add(cb.playerId);
  });
});

parser.on('gameover', () => {
  console.log('\n=== Player IDs seen in commands ===');
  console.log([...commandPlayerIds].sort((a, b) => a - b));
});

parser.parse(replayPath);
