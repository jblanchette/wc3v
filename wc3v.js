const W3GReplay = require('./node_modules/w3gjs');
const { ActionBlockList } = require('./node_modules/w3gjs/parsers/actions');
const Parser = new W3GReplay();

const UnitManager = require("./UnitManager");

let unitManager;
let actionCount = 0;
let hasParsedMeta = false;


/*
* For now - configure the replay files to parse here in the `paths`
*           list.
*           
* To enable verbose debugging, configure the UnitManager.js debugActions
* flag - or use player specific ID debugging.
*/
const paths = [
  {
    'file': 'replays/test-unit-upgrade.w3g'
  }
];

W3GReplay.prototype.processTimeSlot = function (timeSlotBlock) {
  if (!hasParsedMeta) {
    unitManager.setMetaData(this.gameMetaDataDecoded.meta);
    hasParsedMeta = true;
  }

  if (this.leaveEvents.length) {
    console.log("###");
    console.log("Found leave event:", this.leaveEvents);
    console.log("###");
  }

  timeSlotBlock.actions.forEach(actionBlock => {
  	// try {
      unitManager.checkCreatePlayer(actionBlock);

	  	ActionBlockList.parse(actionBlock.actions).forEach(action => {
        actionCount++;

        // console.log("================================");
        // console.log(`Action ${actionCount} Player ${actionBlock.playerId}`);
        // console.log("================================");

        unitManager.handleAction(actionBlock, action);
	  	});
  	// } catch (ex) {
   //  	console.error(ex);
  	// }

    this.processCommandDataBlock(actionBlock);
  });
};

paths.forEach(path => {
  const {file} = path;

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
    console.log(`Unregistered units: ${players[playerId].unregisteredUnitCount}`);

    console.log(units.map(unit => { 
      if (unit.meta.hero) {
        return `${unit.displayName} - (${unit.knownLevel})`;
      } else if (unit.isBuilding) {
        return `Building - ${unit.displayName}`;
      } else {
        return unit.displayName;   
      }
    }));

    return;
    units.forEach(unit => {
      console.log("================================");
      console.log("Unit: ", unit.displayName);
      console.log("Path: ", unit.path);
      console.log("================================");
    });
    console.log("******************************");
  });
});
