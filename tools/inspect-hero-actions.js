// Temporary tool: dump raw w3gjs actions for hero skill learning
const ReplayParser = require('../node_modules/w3gjs/dist/lib/parsers/ReplayParser').default;
const utils = require('../helpers/utils');
const mappings = require('../helpers/mappings');
const fs = require('fs');
const path = require('path');

const replayName = process.argv.find(a => a.startsWith('--replay='));
if (!replayName) {
  console.log('Usage: node tools/inspect-hero-actions.js --replay=NAME');
  process.exit(1);
}

const name = replayName.split('=')[1];
let file = path.join(__dirname, '..', 'replays', `${name}.w3g`);
if (!fs.existsSync(file)) {
  console.log('Not found at:', file);
  process.exit(1);
}

const buffer = fs.readFileSync(file);
const parser = new ReplayParser();

let globalTime = 0;
const LEARN_SKILL_FLAG = 0x42; // abilityFlagNames.LearnSkillOrTrain

parser.on("gamedatablock", (block) => {
  const commandBlocks = block.commandBlocks || [];

  if (block.timeIncrement) {
    globalTime += block.timeIncrement;
  }

  commandBlocks.forEach((actionBlock) => {
    const actions = actionBlock.actions || [];
    actions.forEach(action => {
      action = utils.normalizeAction(action);
      action = utils.fixBrokenActionFormat(action);

      // action id 0x10 = UnitBuildingAbilityActionNoParams
      if (action.id === 0x10) {
        const itemId = Array.isArray(action.itemId) ? action.itemId : utils.fixItemId(action.itemId);
        const flags = action.abilityFlags;

        // Check if it's a hero spell
        const isSpell = !Array.isArray(itemId) && mappings.heroAbilities[itemId];
        const isLearnFlag = flags === LEARN_SKILL_FLAG;

        if (isSpell || isLearnFlag) {
          const ms = globalTime;
          const sec = Math.floor(ms / 1000);
          const min = Math.floor(sec / 60);
          const s = sec % 60;
          const spellName = isSpell ? mappings.heroAbilities[itemId].displayName : '???';
          console.log(`[${min}:${String(s).padStart(2,'0')}] (raw=${ms}ms) PID=${actionBlock.playerId} action=0x10 flags=0x${flags.toString(16)} itemId=${itemId} spell=${spellName}`);
          console.log(`  raw:`, JSON.stringify(action));
        }
      }
    });
  });
});

(async () => {
  try {
    await parser.parse(buffer);
  } catch (e) {
    console.error('Parse error (partial):', e.message);
  }
  console.log('\nDone.');
})();
