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
    'side': 'left',
    'file': 'replays/test-hero-2.w3g'
  }
];

paths.forEach(path => {
  const {side, file} = path;

  unitManager = new UnitManager();
  hasParsedMeta = false;
  
  console.log("Parsing file: ", file);
  
  const replay = Parser.parse(file);
  let players = unitManager.players;

  Object.keys(players).forEach(playerId => {
    console.log("******************************");
    console.log(`Inspecting player: ${playerId}`);

    // console.log(players[playerId]);

    let units = players[playerId].units;
    console.log(`Unit count: ${units.length}`);
    console.log(units.map(unit => { return unit.displayName; }));

    return;
    units.forEach(unit => {
      console.log("================================");
      console.log("Unit: ", unit.displayName);
      console.log("================================");
    });
    console.log("******************************");
  });
});
