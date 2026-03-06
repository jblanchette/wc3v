const fs = require('fs');
const ReplayParser = require('w3gjs/dist/lib/parsers/ReplayParser').default;
const utils = require('../helpers/utils');

const parser = new ReplayParser();
let count = 0;
parser.on('gamedatablock', (block) => {
  const cmds = block.commandBlocks || [];
  cmds.forEach(cb => {
    if (cb.playerId !== 2) return;
    const actions = cb.actions || [];
    actions.forEach(a => {
      a = utils.normalizeAction(a);
      // action 0x12 = UseAbilityWithTargetAndObjectId
      if (a.id === 18 && count < 20) {
        console.log('Action 0x12: itemId type=' + typeof a.itemId + ' isArray=' + Array.isArray(a.itemId) + ' val=' + JSON.stringify(a.itemId));
        count++;
      }
    });
  });
});

const buffer = fs.readFileSync('./replays/happy-vs-grubby.w3g');
parser.parse(buffer).then(() => console.log('done')).catch(e => console.error(e));
