const utils = require("../helpers/utils");
const rbush = require("rbush");

const TREE_HITBOX_SIZE = 312; // approx unit size to always collide with neighbors

const ClaimTimings = {
  contested: 12 * 1000,
  claimed:   24 * 1000
};

const ClaimStates = {
  nobody: 0,
  contested: 1,
  claimed: 2
};

//
// define different attack 'sizes' which roughly represent
// and attacking force.  when a player has more units
// attacking a camp we increase the timings by that sizes factor
//
const AttackSizes = {
  solo:  {  size: 1,  factor: 1.0 },
  small: {  size: 3,  factor: 1.35 },
  group: {  size: 6,  factor: 1.85 },
  army:  {  size: 10, factor: 2.55 }
};

//
// if we detect an interaction with a neutral in the group
// then increase the timing multiplier by this much each time
//
const CAMP_INTERACTION_BOOST = 0.225;

const CAMP_HERO_INTERACTION_BOOST = 0.275;

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
      playerId: player.id,
      teamId: player.teamId
    });
  }

  addPlayerEvent (player, selectedUnits) {
    const gameTime = player.eventTimer.timer.gameTime;

    this.playerEventStream.push({
      gameTime,
      type: 'player',
      playerId: player.id,
      teamId: player.teamId,
      selectedUnits
    });
  }

  findAttackSize (selectedUnitCount) {
    if (!selectedUnitCount) {
      return AttackSizes.solo;
    }

    const attackSize = Object.keys(AttackSizes).reverse().find(sizeKey => {
      const attack = AttackSizes[sizeKey];

      if (selectedUnitCount >= attack.size) {
        return attack;
      }
    });

    if (attackSize) {
      return AttackSizes[attackSize];
    }

    // default to solo if unregistered group
    return AttackSizes.solo;
  }

  calculateClaims () {
    const allEvents = this.playerEventStream
     .concat(this.locationStream)
     .sort((a, b) => {
      return (a.gameTime - b.gameTime);
     });

    // initial structure
    const claimers = allEvents.reduce((acc, e) => {
      if (acc[e.teamId]) {
        return acc;
      }

      acc[e.teamId] = {
        active: false,
        lastSeenCount: 0,
        lastTimer: 0,
        timeClaimed: 0,
        players: {},
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
      const { type, gameTime, teamId, playerId, selectedUnits } = e;
      const isHero = selectedUnits && selectedUnits.find(unit => {
        return unit.meta.hero;
      }) || false;

      const currentClaim = claimers[teamId];
      if (!currentClaim) {
        return;
      }

      if (currentClaim.players[playerId] == null) {
        currentClaim.players[playerId] = 0;
      }

      if (!currentClaim.active) {
        if (type == 'entered' || type == 'player' || type == 'within') {
          currentClaim.active = true;
          currentClaim.lastTimer = gameTime;

          if (selectedUnits) {
            currentClaim.lastSeenCount = selectedUnits.length;
          }
        }
      } else {
        if (type == 'player') {          
          claimers[teamId].multiplier += isHero ? CAMP_HERO_INTERACTION_BOOST : CAMP_INTERACTION_BOOST;
        }

        if (type == 'exited' || type == 'within') {
          const timeDiff = (gameTime - currentClaim.lastTimer);

          // always at least one unit attacking
          const attackSize = this.findAttackSize(currentClaim.lastSeenCount);
          const timeAdded = (timeDiff * claimers[teamId].multiplier * attackSize.factor);
          claimers[teamId].timeClaimed += timeAdded;

          claimers[teamId].players[playerId] += timeAdded;
          
          const isFullClaim = Object.keys(ClaimTimings).find(claimState => {
            const claimTiming = ClaimTimings[claimState];

            if (claimers[teamId].timeClaimed >= claimTiming) {

              //
              // NOTE: doing a side effect to assign the winner in this loop
              //       bit of lazy coding, can clean this up later
              //
              this.claimState = ClaimStates[claimState];
              this.claimTime = gameTime;
              this.claimOwnerId = teamId;

              if (this.claimState == ClaimStates.claimed) {
                // has been claimed, all done
                return true;
              }
            }

            return false;
          });

          //
          // if there was a full claim we check for any other contesting teams
          // before exiting the claim calculation
          //
          if (isFullClaim) {
            const otherClaims = Object.keys(claimers).reduce((acc, claimTeamId) => {
              const claim = claimers[claimTeamId];
              if (+teamId !== +claimTeamId) {
                acc.push(claim);
              }

              return acc;
            }, []);

            const isContested = otherClaims.find(claim => {
              return (claim.timeClaimed >= ClaimStates.contested);
            });

            if (isContested) {
              this.claimState = ClaimStates.contested;
            }

            return true;
          }

          currentClaim.active = false;
          currentClaim.lastTimer = gameTime;
          currentClaim.multiplier = 1;
        }
      }
    });

    this.claimers = claimers;
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
