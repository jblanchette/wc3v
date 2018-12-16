const W3GReplay = require('./node_modules/w3gjs');
const { ActionBlockList } = require('./node_modules/w3gjs/parsers/actions');
const Parser = new W3GReplay();

const UnitManager = require("./UnitManager");

let unitManager;
let actionCount = 0;
let hasParsedMeta = false;

W3GReplay.prototype.processTimeSlot = function (timeSlotBlock) {
  if (!hasParsedMeta) {
    unitManager.setMetaData(this.gameMetaDataDecoded.meta);
    hasParsedMeta = true;
  }

  timeSlotBlock.actions.forEach(actionBlock => {
  	try {
      unitManager.checkCreatePlayer(actionBlock);

	  	ActionBlockList.parse(actionBlock.actions).forEach(action => {
        actionCount++;

        // console.log("================================");
        // console.log(`Action ${actionCount} Player ${actionBlock.playerId}`);
        // console.log("================================");

        unitManager.handleAction(actionBlock, action);
	  	});
  	} catch (ex) {
    	console.error(ex)
  	}

    this.processCommandDataBlock(actionBlock);
  });
};


const paths = [
  {
    'side': 'right',
    'file': 'replays/test-square.w3g'
  }
  // {
  //   'side': 'left',
  //   'file': 'replays/test-bnet-echoisles-left.w3g'
  // },
  // {
  //   'side': 'left',
  //   'file': 'replays/test-bnet-echoisles-left2.w3g'
  // }
];

paths.forEach(path => {
  const {side, file} = path;

  unitManager = new UnitManager();
  hasParsedMeta = false;
  
  const replay = Parser.parse(file);

  console.log("UnitMgr: ", unitManager.players['1'].units);

  console.log("===============================");
});
