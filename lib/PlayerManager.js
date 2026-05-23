const path = require('path'),
      fs   = require('fs'),
      os   = require('os'),
      zlib = require('zlib'),
      rbush = require('rbush');

const ActionParser = require('../node_modules/w3gjs/dist/lib/parsers/ActionParser').default;

const config = require("../config/config");
const Player = require("./Player"),
      World = require("./World"),
      EventTimer = require("./EventTimer");

const Unit = require("./Unit"),
      Building = require("./Building"),
      NeutralGroup = require("./NeutralGroup");

const logManager = require("../helpers/logManager");

const MissingMapError = require("../helpers/errors/MissingMapError");

const ActionBlock = require("./ActionBlock");
const ActionBlockNames = ActionBlock.ActionBlockNames;

const { 
  mapDataByFile, 
  getUnitInfo, 
  NEUTRAL_PLAYER_ID,
  NEUTRAL_PLAYER_SLOT,
  NEUTRAL_PLAYER_TEAM 
} = require("../helpers/mappings");

const WPMFile = require("./parsers/WPMFile"),
      DOOFile = require("./parsers/DOOFile"),
      UNITFile = require("./parsers/UNITFile");

const ABILITY_DEDUP_WINDOW_MS = 250;
// 50 game units ≈ 1.5 tiles. Targets within this radius of a same-signature
// action in the last 250ms are treated as the same cast (retransmits sometimes
// jitter the target by a few units); larger spreads are real distinct intent.
const ABILITY_DEDUP_TOLERANCE_SQ = 50 * 50;
const ABILITY_ACTION_NAMES = new Set([
  'UnitBuildingAbilityActionNoParams',
  'UnitBuildingAbilityActionTargetPosition',
  'UnitBuildingAbilityActionTargetPositionTargetObjectId',
  'UnitBuildingAbilityActionTwoTargetPositions'
]);

const PlayerManager = class {
  constructor () {
    this.meta = null;
    this.gridData = null;

    this.players = {};
    this.neutrals = {};
    this.eventTimer = new EventTimer();
    this.world = new World(this.eventTimer);

    this.lastActions = {};

    this.isFloReplay = false;
    this._nextFloTeamId = 0;
    this._nextFloColor = 0;
  }

  setMetaData (meta, options = {}) {
    // detect FLO/W3Champions replays — slotRecords are empty
    this.isFloReplay = meta.slotRecords.length === 0;

    // FLO replays have duplicate playerRecords with shared object refs
    // which causes circular reference errors during JSON serialization
    if (this.isFloReplay) {
      const seen = new Set();
      meta.playerRecords = meta.playerRecords.filter(r => {
        if (seen.has(r.playerId)) return false;
        seen.add(r.playerId);
        return true;
      });
    }

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

    // create fake records for neutral player
    // that has all shops, goldmines, fountains, critters, ect

    const neutralRecord = {
      playerId: NEUTRAL_PLAYER_ID,
      playerName: "Neutral Player (ai)"
    };

    const neutralSlot = {
      playerId: NEUTRAL_PLAYER_ID,
      slotStatus: 2,
      computerFlag: 0,
      teamId: NEUTRAL_PLAYER_TEAM,
      color: 6,
      raceFlag: 66, // has no effect
      aiStrength: 0,
      handicapFlag: 100
    };

    meta.playerRecords.push(neutralRecord);
    meta.slotRecords.push(neutralSlot);

    this.meta = meta;
    this.setGridData(meta, options);
  }

  setGridData (meta, options = {}) {
    // detect map path and grab data

    let mapName = path.basename(meta.map.mapName).toLowerCase();

    mapName = mapName.trim();
    mapName = mapName.replace(new RegExp(' ', 'g'), "");

    // strip W3C numbered prefix pattern: "{num}_w3c_{date}_{time}_" → just the map name
    // e.g. "59_w3c_251104_0950_shatteredexile_v2.4.w3x" → "shatteredexile_v2.4.w3x"
    const w3cPrefixMatch = mapName.match(/^\d+_w3c_\d+_\d+_(.+)$/);
    const strippedMapName = w3cPrefixMatch ? w3cPrefixMatch[1] : mapName;

    const mapDataName = mapDataByFile[mapName] ?
      mapName : Object.keys(mapDataByFile).find(mapItem => {
      const searchName = mapDataByFile[mapItem].name.toLowerCase();

      // try original name and stripped name
      if (mapName.indexOf(searchName) !== -1) {
        return mapItem;
      }

      if (strippedMapName !== mapName && strippedMapName.indexOf(searchName) !== -1) {
        return mapItem;
      }

      // try matching base map name (without version) for newer map versions
      // e.g. "shatteredexile" from "shatteredexile_v2.4.w3x" matches "ShatteredExile_v2-07"
      const baseSearchName = searchName.replace(/[_-]v[\d._-]+$/, '');
      const baseMapName = strippedMapName.replace('.w3x', '').replace(/[_-]v[\d._-]+$/, '');
      if (baseSearchName.length > 3 && baseMapName === baseSearchName) {
        return mapItem;
      }
    });

    const mapData = mapDataByFile[mapDataName];
    if (!mapData) {
      console.log("unable to find map: ", mapName, "Map data name: ", mapDataName, "meta mapName:", meta.mapName);
      console.log("raw meta map: ", meta.map);

      throw new MissingMapError("missing-map-data", {
        mapName, mapDataName, metaMapName: meta.mapName
      });
    }

    let wpm, doo, unitFile;

    // Browser path: pre-loaded cache provided. Skip all fs reads, skip the
    // cache-write side effect. options.mapDataCache shape:
    //   { [mapData.name]: { wpm: {grid}, doo: {grid}, unit: {units} } }
    const cached = options.mapDataCache && options.mapDataCache[mapData.name];
    if (cached) {
      wpm = WPMFile.fromCache(cached.wpm, mapData);
      doo = DOOFile.fromCache(cached.doo);
      unitFile = UNITFile.fromCache(cached.unit);
    } else {
      // Node CLI path: read binary map files from disk. Lazy-write JSON
      // cache for the next run.
      const gridFileRoot = os.platform() === "win32" ?
        `${__dirname}\\..\\mapdata\\${mapData.name}\\` :
        `${__dirname}/../mapdata/${mapData.name}/`;

      const gridFileClientRoot = os.platform() === "win32" ?
        `${__dirname}\\..\\client\\maps\\${mapData.name}\\` :
        `${__dirname}/../client/maps/${mapData.name}/`;

      wpm = new WPMFile(`${gridFileRoot}war3map.wpm`, mapData);
      doo = new DOOFile(`${gridFileRoot}war3map.doo`);
      unitFile = new UNITFile(`${gridFileRoot}war3mapUnits.doo`);

      const wpmPath = `${gridFileClientRoot}wpm.json`;
      const dooPath = `${gridFileClientRoot}doo.json`;
      const unitPath = `${gridFileClientRoot}unit.json`;

      if (!fs.existsSync(wpmPath)) {
        wpm.write(wpmPath);
        this.zipGameFile(wpmPath);
      }

      if (!fs.existsSync(dooPath)) {
        doo.write(dooPath);
        this.zipGameFile(dooPath);
      }

      // Browser parser path needs unit.json.gz too — without it, neutral
      // creep camps aren't reconstructable from cache and xp attribution
      // breaks. Cheap to write; gz cache handles repeat runs.
      if (!fs.existsSync(`${unitPath}.gz`)) {
        unitFile.write(unitPath);
        this.zipGameFile(unitPath);
      }
    }

    const gridData = {
      wpm,
      doo,
      unitFile,
      mapData
    };

    this.setupUnitFileData(unitFile);
    this.world.setGridData(gridData);
  }

  setupUnitFileData (unitFile) {
    const { eventTimer } = this;

    // add the neutral player to the worldd
    this.makePlayer(NEUTRAL_PLAYER_ID, true);
    const neutralPlayer = this.players[NEUTRAL_PLAYER_ID];

    if (!neutralPlayer) {
      throw new Error("Error creating neutral player.");
    }

    unitFile.units.forEach(rawUnit => {
      let neutralUnit;
      const { type, position, inventory, droppedItemSets } = rawUnit;
      const [ x, y ] = position;

      const unitInfo = getUnitInfo(type);

      if (unitInfo.isBuilding && !unitInfo.isFountain) {
        neutralUnit = new Building(eventTimer, null, null, type, true, null);
        neutralUnit.setSpawnPosition(x, y);

        neutralPlayer.addPlayerBuilding(neutralUnit);
      } else if (unitInfo.isUnit || unitInfo.isFountain) {
        neutralUnit = new Unit(eventTimer, null, null, type, true, null);
        neutralUnit.setSpawnPosition(x, y);

        neutralPlayer.addPlayerUnit(neutralUnit);
      }

      if (neutralUnit && droppedItemSets && droppedItemSets.length) {
        neutralUnit.droppedItemSets = droppedItemSets;
      }
    });

    this.groupNeutralUnits();
  }

  groupNeutralUnits () {
    const neutralPlayer = this.players[NEUTRAL_PLAYER_ID];
    if (!neutralPlayer) {
      return;
    }

    const neutralGroups = NeutralGroup.groupNeutralUnits(neutralPlayer.units);
    neutralGroups.forEach(group => {
      group.units.forEach(unit => {
        unit.setNeutralGroupId(group.uuid);

        const unitRef = neutralPlayer.units.find(nUnit => {
          return nUnit.uuid == unit.uuid;
        });

        if (unitRef) {
          unitRef.setNeutralGroupId(group.uuid);
        }
      });
    });

    const tree = NeutralGroup.getGroupTree(neutralGroups);
    const detectionTree = NeutralGroup.getDetectionTree(neutralGroups);
    this.world.setNeutralGroups(neutralGroups, tree, detectionTree);
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

  makePlayer (id, isNeutralPlayer = false) {
    let playerSlot = this.meta.slotRecords.find(slot => {
      return slot.playerId === id;
    });

    // FLO/W3Champions replays have empty slotRecords — synthesize one
    if (!playerSlot && !isNeutralPlayer) {
      playerSlot = {
        playerId: id,
        slotStatus: 2,
        computerFlag: 0,
        teamId: this._nextFloTeamId++,
        color: this._nextFloColor++,
        raceFlag: 0,       // unknown → getRaceFromFlag returns 'R', detected later via selectSubgroup
        aiStrength: 0,
        handicapFlag: 100
      };

      this.meta.slotRecords.push(playerSlot);
    }

    let player = new Player(id, playerSlot, this.meta, this.eventTimer, this.world, isNeutralPlayer);
    this.players[id] = player;
    this.world.addPlayerData(player);

    if (!isNeutralPlayer) {
      player.setupInitialUnits();
    }
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

  handleAction (actionBlock, action) {
    const self = this;
    const actionName = ActionBlockNames[action.id];
    const player = this.players[actionBlock.playerId];

    // track action type counts for debug summary
    if (!this._actionCounts) {
      this._actionCounts = {};
      this._unknownActions = [];
      this._unhandledActions = {};
    }

    if (!actionName) {
      const hexId = `0x${action.id.toString(16).padStart(2, '0')}`;
      if (config.debugActions) {
        const { gameTime } = this.eventTimer.timer;
        console.logger(`[UNKNOWN ACTION] id=${action.id} (${hexId}) PID: ${actionBlock.playerId} time: ${gameTime}`);
        console.logger(`  raw action:`, JSON.stringify(action));
      }
      this._unknownActions.push({ id: action.id, hexId, playerId: actionBlock.playerId });
      return;
    }

    this._actionCounts[actionName] = (this._actionCounts[actionName] || 0) + 1;

    // record action for APM tracking
    const { gameTime } = this.eventTimer.timer;

    // W3Champions / FLO replays retransmit ability actions within ~150ms; the WC3
    // client dedupes them but the parser sees both, causing double summons,
    // double autocast toggles, and duplicate spell-cast overlays. Drop the second
    // arrival when it matches the previous ability action on this player.
    if (this._isDuplicateAbilityAction(player, actionName, action, gameTime)) {
      this._actionCounts.__dedupedAbility = (this._actionCounts.__dedupedAbility || 0) + 1;
      return;
    }

    player.recordAction(actionName, action, gameTime);

    const logEnabledForPlayer = (config.debugPlayer === null || player.id === config.debugPlayer);

    // enable or disable all logging based on debugPlayer setting
    logManager.setDisabledState(!logEnabledForPlayer);

    if (config.debugActions) {
      const { gameTime } = this.eventTimer.timer;
      const timerDate = new Date(Math.round(gameTime * 1000) / 1000);

      console.logger("\n\n");
      console.logger("========================================================================");
      console.logger(`ActionName: ${actionName} (id=${action.id}/0x${action.id.toString(16)}) PID: ${player.id}`);
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
      case "SelectGroundItemAction":
        player.selectGroundItem(action);
      break;
      case "UnitBuildingAbilityActionTwoTargetPositions":
        player.useAbilityTwoTargets(action);
      break;
      case "PreSubselection":
        // Handled implicitly — transport unloads detected via selection changes
      break;
      default:
        // named but not dispatched — log as unhandled
        this._unhandledActions[actionName] = (this._unhandledActions[actionName] || 0) + 1;
        if (config.debugActions) {
          console.logger(`[UNHANDLED] ${actionName} (id=${action.id}) — known but no handler`);
        }
      break;
    }
  }

  _isDuplicateAbilityAction (player, actionName, action, gameTime) {
    if (!player) return false;
    if (!ABILITY_ACTION_NAMES.has(actionName)) return false;

    // Track recent ability actions by signature (not just the last one): the
    // retransmit isn't always immediately adjacent — a move/right-click can
    // arrive between the original and the retransmit. Target coordinates
    // sometimes drift by a few units between the original and the retransmit,
    // so we keep them out of the signature and match on position with a small
    // tolerance below.
    let recent = player._recentAbilityActions;
    if (!recent) {
      recent = player._recentAbilityActions = new Map();
    }

    const cutoff = gameTime - ABILITY_DEDUP_WINDOW_MS;
    for (const [k, v] of recent) {
      if (v.gameTime < cutoff) recent.delete(k);
    }

    const sig = this._abilityActionSignature(actionName, action);
    const prev = recent.get(sig);
    if (prev && this._abilityTargetsMatch(prev, action)) {
      return true;
    }

    recent.set(sig, {
      gameTime,
      targetX: action.targetX,
      targetY: action.targetY,
      targetA: action.targetA,
      targetB: action.targetB
    });
    return false;
  }

  _abilityActionSignature (actionName, action) {
    // Identify the action by what it does (handler + spell/order + target unit),
    // not where it does it. See _abilityTargetsMatch for the position check.
    const itemKey = Array.isArray(action.itemId) ? action.itemId.join(',') : action.itemId;
    const parts = [actionName, itemKey, action.abilityFlags];
    if (action.objectId1 !== undefined) parts.push(action.objectId1);
    if (action.objectId2 !== undefined) parts.push(action.objectId2);
    return parts.join('|');
  }

  _abilityTargetsMatch (prev, action) {
    const dx = (action.targetX || 0) - (prev.targetX || 0);
    const dy = (action.targetY || 0) - (prev.targetY || 0);
    if (dx * dx + dy * dy > ABILITY_DEDUP_TOLERANCE_SQ) return false;
    if (prev.targetA !== undefined || action.targetA !== undefined) {
      const da = (action.targetA || 0) - (prev.targetA || 0);
      const db = (action.targetB || 0) - (prev.targetB || 0);
      if (da * da + db * db > ABILITY_DEDUP_TOLERANCE_SQ) return false;
    }
    return true;
  }

  getActionSummary () {
    return {
      handled: this._actionCounts || {},
      unhandled: this._unhandledActions || {},
      unknown: this._unknownActions || []
    };
  }
};

module.exports = PlayerManager;
