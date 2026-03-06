const fs = require('fs');
const ReplayParser = require('w3gjs/dist/lib/parsers/ReplayParser').default;
const utils = require('../helpers/utils');

const parser = new ReplayParser();
const Building = require('../lib/Building');

parser.on('gamedatablock', (block) => {
  const cmds = block.commandBlocks || [];
  cmds.forEach(cb => {
    if (cb.playerId !== 2) return;
    const actions = cb.actions || [];
    actions.forEach(a => {
      a = utils.normalizeAction(a);
      a = utils.fixBrokenActionFormat(a);

      // Check action 0x10 (UseAbilityNoTarget) with abilityFlags=70 (TrainUnit)
      if (a.id === 16 && a.abilityFlags === 70) {
        console.log('\n=== Action 0x10 TrainUnit ===');
        console.log('  itemId:', a.itemId);
        console.log('  abilityFlags:', a.abilityFlags);
      }
    });
  });
});

const buffer = fs.readFileSync('./replays/happy-vs-life-echo-isles.w3g');
parser.parse(buffer).then(() => {
  console.log('\nDone');
}).catch(e => console.error(e));
