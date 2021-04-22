const path = require('path'),
      fs   = require('fs'),
      os   = require('os'),
      zlib = require('zlib');

const ActionParser = require('../node_modules/w3gjs/dist/lib/parsers/ActionParser').default;

const config = require("../config/config");
const Player = require("./Player"),
      World = require("./World"),
      EventTimer = require("./EventTimer");

const logManager = require("../helpers/logManager");

const MissingMapError = require("../helpers/errors/MissingMapError");

const ActionBlock = require("./ActionBlock");
const ActionBlockNames = ActionBlock.ActionBlockNames;

const { mapDataByFile } = require("../helpers/mappings");

const WPMFile = require("./parsers/WPMFile"),
      DOOFile = require("./parsers/DOOFile"),
      JASSFile = require("./parsers/JASSFile");

const PlayerManager = class {
  constructor () {
    this.meta = null;
    this.gridData = null;

    this.players = {};
    this.eventTimer = new EventTimer();
    this.world = new World(this.eventTimer);

    this.lastActions = {};
  }

  setMetaData (meta) {
    meta.slotRecords.forEach(slot => {
      // fix night elf race from the dumb N to E
      if (slot.raceFlag === 'N') {
        slot.raceFlag = 'E';
      }
    });


    let rawMapName = meta.map.mapName;

    if (path.sep === "/") {
      rawMapName = rawMapName.split("\\").join("/");
    }

    meta.map.mapName = rawMapName;

    this.meta = meta;
    this.setGridData(meta);
  }

  setGridData (meta) {
    // detect map path and grab data

    const mapName = path.basename(meta.map.mapName).toLowerCase();
    const mapDataName = mapDataByFile[mapName] ? 
      mapName : Object.keys(mapDataByFile).find(mapItem => {
      const searchName = mapDataByFile[mapItem].name.toLowerCase();

      if (mapName.indexOf(searchName) !== -1) {
        return mapItem;
      }
    });

    const mapData = mapDataByFile[mapDataName];
    if (!mapData) {
      console.log("unable to find map: ", mapName, mapDataName, meta.mapName);

      throw new MissingMapError("missing-map-data", {
        mapName, mapDataName, metaMapName: meta.mapName
      });
    }

    const gridFileRoot = os.platform() === "win32" ?
      `${__dirname}\\..\\mapdata\\${mapData.name}\\` :
      `${__dirname}/../mapdata/${mapData.name}/`;

    const gridFileClientRoot = os.platform() === "win32" ?
      `${__dirname}\\..\\client\\maps\\${mapData.name}\\` :
      `${__dirname}/../client/maps/${mapData.name}/`;

    const wpm = new WPMFile(`${gridFileRoot}war3map.wpm`, mapData);
    const doo = new DOOFile(`${gridFileRoot}war3map.doo`);
    const jass = new JASSFile(`${gridFileRoot}war3map.j`);

    const wpmPath = `${gridFileClientRoot}wpm.json`;
    const dooPath = `${gridFileClientRoot}doo.json`;

    if (!fs.existsSync(wpmPath)) {
      wpm.write(wpmPath);

      // zip and unlink raw file
      this.zipGameFile(wpmPath);
    }

    if (!fs.existsSync(dooPath)) {
      doo.write(dooPath);
      this.zipGameFile(dooPath);
    }

    const gridData = {
      wpm,
      doo,
      mapData
    };

    this.world.setGridData(gridData);
  }

  zipGameFile (outputPath) {
    const gzip = zlib.createGzip();
    const inputFile = fs.createReadStream(outputPath);
    const outputFile = fs.createWriteStream(`${outputPath}.gz`, { autoClose: true });
    console.logger("writing gzipped file: ", `${outputPath}.gz`);
    
    inputFile.pipe(gzip)
      .on('error', (e) => {
        console.logger("file write error for: ", outputPath, e);
      })
      .pipe(outputFile)
      .on('error', (e) => {
        console.logger("file write error for: ", outputPath, e);
      })
      .on('finish', () => {
        try {
          fs.unlinkSync(outputPath);
        } catch (e) {
          // do nothing
        }
      });
  }

  makePlayer (id) {
    let playerSlot = this.meta.slotRecords.find(slot => { 
      return slot.playerId === id;
    });

    let player = new Player(id, playerSlot, this.meta, this.eventTimer, this.world);
    this.players[id] = player;
    this.world.addPlayerData(player);

    player.setupInitialUnits();
  }

  checkCreatePlayer (actionBlock) {
    const playerId = actionBlock.playerId;

    if (!this.players[playerId]) {
      this.makePlayer(playerId);
    }
  }

  processTick (gameTime) {
    this.eventTimer.process(gameTime);
  }

  fixItemIds (action) {
    if (action.itemId) {
      // this is in an object now...
      // just unpack it

      action.itemId = action.itemId.value;
    }

    if (action.itemId1) {
      action.itemId1 = action.itemId1.value;
    }

    if (action.itemId2) {
      action.itemId2 = action.itemId2.value;
    }

    if (action.actions) {
      action.actions.forEach(subAction => {
        subAction.itemId1 = subAction.itemId1.value;
        subAction.itemId2 = subAction.itemId2.value;
      });
    }

    return action;
  }

  handleAction (actionBlock, action) {
    const self = this;
    const actionName = ActionBlockNames[action.id];
    const player = this.players[actionBlock.playerId];

    if (!actionName) {
      console.logger("FATAL: unknown action: ", action);
      throw new Error("unknown action name");
    }

    const logEnabledForPlayer = (config.debugPlayer === null || player.id === config.debugPlayer);

    // enable or disable all logging based on debugPlayer setting
    logManager.setDisabledState(!logEnabledForPlayer);

    if (config.debugActions) {
      const { gameTime } = this.eventTimer.timer;
      const timerDate = new Date(Math.round(gameTime * 1000) / 1000);

      console.logger("========================================================================");
      console.logger(`ActionName: ${actionName} PID: ${player.id}`);
      console.logger(`Action:`, action);
      console.logger(`Game Timer: ${gameTime}`);
      console.logger(`Game Clock: ${timerDate.getUTCMinutes()}:${timerDate.getUTCSeconds()}`);
      console.logger("========================================================================");
    }

    // todo: roll this up. switch became unnessicary
    switch (actionName) {
      case "ChangeSelectionAction":
        player.changeSelection(action);
      break;
      case "UpdateSubgroup":
        player.updateSubgroup(action);
      break;
      case "SelectSubgroupAction":
        player.selectSubgroup(action);
      break;
      case "UnitBuildingAbilityActionNoParams":
        player.useAbilityNoTarget(action);
      break;  
      case "UnitBuildingAbilityActionTargetPosition":
        player.useAbilityWithTarget(action);
      break;
      case "UnitBuildingAbilityActionTargetPositionTargetObjectId":
        player.useAbilityWithTargetAndObjectId(action);
      break;
      case "EnterBuildingSubmenu":
        player.chooseBuilding(action);
      break;
      case "AssignGroupHotkeyAction":
        player.assignGroupHotkey(action);
      break;
      case "SelectGroupHotkeyAction":
        player.selectGroupHotkey(action);
      break;
      case "GiveItemToUnitAciton":
        player.giveOrDropItem(action);
      break;
      case "UnitBuildingAbilityActionTwoTargetPositions":
        player.useAbilityTwoTargets(action);
      break;
    }
  }
};

module.exports = PlayerManager;
