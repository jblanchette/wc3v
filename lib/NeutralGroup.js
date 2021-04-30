const utils = require("../helpers/utils");
const rbush = require("rbush");

const TREE_HITBOX_SIZE = 312; // approx unit size to always collide with neighbors

const ClaimTimings = {
  contested: 10 * 1000,
  claimed:   24 * 1000
};

const ClaimStates = {
  nobody: 0,
  contested: 1,
  claimed: 2
};
  
// if we detect an interaction with a neutral in the group
// then increase the timing multiplier by this much each time
const CAMP_INTERACTION_BOOST = 0.225;

const NeutralGroup = class {
  constructor (bounds, units) {
    this.uuid = utils.uuidv4();
    this.bounds = bounds;
    this.units = units;

    this.totalLevel = units.reduce((acc, unit) => {
      return acc + unit.balanceInfo.level;
    }, 0);

    this.locationStream = [];
    this.playerEventStream = [];

    this.claimState = ClaimStates.nobody;
    this.claimTime = null;
    this.claimOwnerId = null;
  }

  addLocationEvent (player, type) {
    const gameTime = player.eventTimer.timer.gameTime;
    console.logger(`player ${player.id} ${type} group at ${gameTime}`);

    this.locationStream.push({
      gameTime,
      type,
      playerId: player.id
    });
  }

  addPlayerEvent (player, focusUnit) {
    const gameTime = player.eventTimer.timer.gameTime;
    console.logger(`unit ${focusUnit.displayName} interacted with group at ${gameTime}`);

    this.playerEventStream.push({
      gameTime,
      type: 'player',
      playerId: player.id,
      focusUnit: focusUnit.displayName,
      focusUnitId: focusUnit.uuid
    });
  }

  calculateClaims () {
    const allEvents = this.playerEventStream
     .concat(this.locationStream)
     .sort((a, b) => {
      return (a.gameTime - b.gameTime);
     });

    // initial structure
    const claimers = allEvents.reduce((acc, e) => {
      if (acc[e.playerId]) {
        return acc;
      }

      acc[e.playerId] = {
        active: false,
        lastTimer: 0,
        timeClaimed: 0,
        multiplier: 1
      };

      return acc;
    }, {});

    const numClaimers = Object.keys(claimers).length;
    if (!numClaimers) {
      this.claimState = ClaimStates.nobody;

      return;
    }

    allEvents.find(e => {
      const { type, gameTime, playerId } = e;
      const currentClaim = claimers[playerId];

      if (!currentClaim) {
        return;
      }

      if (!currentClaim.active) {
        if (type == 'entered' || type == 'player' || type == 'within') {
          currentClaim.active = true;
          currentClaim.lastTimer = gameTime;
        }
      } else {
        if (type == 'player') {          
          claimers[playerId].multiplier += CAMP_INTERACTION_BOOST;
        }

        if (type == 'exited' || type == 'within') {
          const timeDiff = (gameTime - currentClaim.lastTimer);

          claimers[playerId].timeClaimed += (timeDiff * claimers[playerId].multiplier);
          
          const isFullClaim = Object.keys(ClaimTimings).find(claimState => {
            const claimTiming = ClaimTimings[claimState];

            if (claimers[playerId].timeClaimed >= claimTiming) {
              this.claimState = ClaimStates[claimState];
              this.claimTime = gameTime;
              this.claimOwnerId = playerId;

              if (this.claimState == ClaimStates.claimed) {
                // has been claimed, all done
                return true;
              }
            }

            return false;
          });

          if (isFullClaim) {
            return true;
          }

          currentClaim.active = false;
          currentClaim.lastTimer = gameTime;
          currentClaim.multiplier = 1;
        }
      }
    });
  }

  static getGroupTree (groups) {
    const tree = new rbush();

    const groupBoxes = groups.map(group => {
      const item = group.bounds;
      item.uuid = group.uuid;

      return item;
    });

    tree.load(groupBoxes);
    return tree;
  }

  static groupNeutralUnits (neutralUnits) {
    const treeSize = TREE_HITBOX_SIZE; 
    const tree = new rbush();
    const groups = [];

    neutralUnits.forEach(unit => {
      if (!unit.isUnit || unit.isBuilding || unit.isCritter) {
        return;
      }

      const x = unit.currentX;
      const y = unit.currentY;

      const unitBox = {
        x,
        y,
        unit,
        minX: (x - treeSize),
        minY: (y - treeSize),
        maxX: (x + treeSize),
        maxY: (y + treeSize)
      };

      if (!groups.length) {
        groups.push([ unitBox ]);

        return;
      }

      let foundGroup = false;

      for (let i = 0; i < groups.length; i++) {
        const groupTree = new rbush();
        groupTree.load(groups[i]);

        if (groupTree.collides(unitBox)) {
          foundGroup = true;
          groups[i].push(unitBox);

          break;
        }
      }

      if (!foundGroup) {
        groups.push([ unitBox ]);
      }
    });

    // now found the bounding coordinates for the group of units
    // so we can use them for camp detection and visuals

    return groups
      .map(group => {
        const bounds = {
          minX: null,
          minY: null,
          maxX: null,
          maxY: null
        };

        group.forEach(unitBox => {
          if (!bounds.minX || unitBox.minX < bounds.minX) {
            bounds.minX = unitBox.minX;
          }

          if (!bounds.minY || unitBox.minY < bounds.minY) {
            bounds.minY = unitBox.minY;
          }

          if (!bounds.maxX || unitBox.maxX > bounds.maxX) {
            bounds.maxX = unitBox.maxX;
          }

          if (!bounds.maxY || unitBox.maxY > bounds.maxY) {
            bounds.maxY = unitBox.maxY;
          }
        });

        return new NeutralGroup(bounds, group.map(item => item.unit));
      });
  }
};

module.exports = NeutralGroup;
