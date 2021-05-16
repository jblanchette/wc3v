const utils = require("../helpers/utils");
const rbush = require("rbush");

const TREE_HITBOX_SIZE = 312; // approx unit size to always collide with neighbors

const ClaimTimings = {
  contested: 13 * 1000,
  claimed:   21 * 1000
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
  solo:   {  size: 1,  factor: 1.0  },
  small:  {  size: 3,  factor: 1.35 },
  medium: {  size: 4,  factor: 1.55 },
  group:  {  size: 6,  factor: 1.95 },
  army:   {  size: 10, factor: 2.75 }
};

//
// if we detect an interaction with a neutral in the group
// then increase the timing multiplier by this much each time
//
const CAMP_INTERACTION_BOOST = 0.225;

const CAMP_HERO_INTERACTION_BOOST = 0.275;

const XP_TABLE_KILLING_UNITS = {
  1:  25,
  2:  40,
  3:  60,
  4:  85,
  5:  115,
  6:  150,
  7:  150,
  8:  150,
  9:  150,
  10: 150
};

const XP_TABLE_KILLING_HERO = {
  1:  100,
  2:  120,
  3:  160,
  4:  220,
  5:  300,
  6:  400,
  7:  500,
  8:  600,
  9:  700,
  10: 800
};

const XP_TABLE_HERO_REDUCTION = {
  1:  0.8,
  2:  0.7,
  3:  0.6,
  4:  0.5,
  5:  0,
  6:  0,
  7:  0,
  8:  0,
  9:  0,
  10: 0
};

// if only one hero is owned you gain this xp boost multiplier for the given tier
const XP_TABLE_TIER_BOOST = {
  1: 1.0,  // 0%  boost tier 1
  2: 1.15, // 15% boost tier 2
  3: 1.30  // 30% boost tier 3
};

// no xp is gained from creeps beyond this level
const XP_CREEPING_LEVEL_MAX = 5; 

const NeutralGroup = class {
  constructor (bounds, units) {
    this.uuid = utils.uuidv4();
    this.bounds = bounds;
    this.units = units;

    this.totalLevel = units.reduce((acc, unit) => {
      return acc + unit.balanceInfo.level;
    }, 0);

    this.hasFountain = units.some(unit => {
      return unit.isFountain;
    }) || false;

    this.locationStream = [];
    this.playerEventStream = [];

    this.claimState = ClaimStates.nobody;
    this.claimTime = null;
    this.claimOwnerId = null;

    this.heroClaimRecords = []; // set after claims are calculated
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

  isClaimed () {
    return this.claimState === ClaimStates.claimed;
  }

  isContested () {
    return this.claimState === ClaimStates.contested;
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
    const { hasFountain } = this;

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
        multiplier: 1,
        xpGained: 0
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
      const heroes = selectedUnits && selectedUnits.filter(unit => {
        return unit.meta.hero;
      }) || [];

      const currentClaim = claimers[teamId];
      if (!currentClaim) {
        return;
      }

      if (currentClaim.players[playerId] == null) {
        currentClaim.players[playerId] = {
          timeClaimed: 0,
          units: []
        };
      }

      if (selectedUnits) {
        const nonSeenUnits = selectedUnits.filter(selUnit => {
          return !claimers[teamId].players[playerId].units.find(unit => {
            return unit.uuid == selUnit.uuid;
          });
        });

        // add any not already seen unit to the claim list
        claimers[teamId].players[playerId].units = claimers[teamId].players[playerId].units.concat(nonSeenUnits);
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


        ////
        // a player action happened when already inside of a neutral camp,
        // determine which type of multiplier boost to add to for the team.
        //
        // two types of boost multipliers depending on if a hero particpiates or not
        // 
        // each hero in the camp seen list increases the multiplier by another factor
        ////

        if (type == 'player') {
          const boost = heroes.length ? 
            CAMP_HERO_INTERACTION_BOOST : CAMP_INTERACTION_BOOST; 

          claimers[teamId].multiplier += boost * (Math.max(heroes.length, 1));
        }

        if (type == 'exited' || type == 'within') {
          const timeDiff = (gameTime - currentClaim.lastTimer);

          
          ////
          // determine the size of the attack to apply a secondary scaling factor.
          // this attempts to mimic warcraft balancing logic by appling the same
          // 'attack size force' scalar factor.
          //
          // this can be thought of as the 'avg' unit size
          // needed to take on different camps which helps balance out the time needed
          // to take a camp.
          ///

          const attackSize = this.findAttackSize(currentClaim.lastSeenCount);

          ////
          // time added for an interaction with a neutral camp:
          //  
          //
          // (amount of time in camp) * (boost multiplier for interactions) * (attack size factor)
          //
          ////

          const timeAdded = (timeDiff * claimers[teamId].multiplier * attackSize.factor);
          
          //
          // credit the team and the individual player for timeClaimed
          //
          claimers[teamId].timeClaimed += timeAdded;
          claimers[teamId].players[playerId].timeClaimed += timeAdded;


          ////
          // when a neutral camp contains a fountain we adjust the claim timings to be boosted
          // to offset the likelyhood of pro players using the fountains to heal
          ////
          const adjustedClaimTimings = Object.keys(ClaimTimings).reduce((acc, claimState) => {
            const fountainBoostFactor = hasFountain ? 1.75 : 1.0;

            acc[claimState] = ClaimTimings[claimState] * fountainBoostFactor;
            return acc;
          }, {});

          //
          // determine if this claim is now 'fully claimed' in order
          // to stop calculating the results and determine if it was
          // possibly contested
          //
          const isFullClaim = Object.keys(adjustedClaimTimings).find(claimState => {
            const claimTiming = adjustedClaimTimings[claimState];

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
          // if there was a full claim check for other contesting teams
          // before exiting the claim calculation
          //
          if (isFullClaim) {
            const otherClaims = Object.keys(claimers).reduce((acc, claimTeamId) => {
              const claim = claimers[claimTeamId];
              // NOTE: string to int type coercion with `+` here
              if (+teamId !== +claimTeamId) {
                acc.push(claim);
              }

              return acc;
            }, []);

            //
            // determine if any of the other team claims for
            // this spot are above the contested threshold
            //
            const isContested = otherClaims.find(claim => {
              return (claim.timeClaimed >= ClaimStates.contested);
            });

            if (isContested) {
              this.claimState = ClaimStates.contested;

              return true;
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

  experienceGivenForUnit (slainUnit, playerRecord) {
    const { tier, level, heroCount } = playerRecord;

    // level of creep that has been slain
    const slainUnitLevel = slainUnit.balanceInfo.level;
    // base xp for killing a creep of this level
    const baseXp = XP_TABLE_KILLING_UNITS[slainUnitLevel] || 0;
    
    // tier boost multiplier for having a single hero, none otherwise
    const tierBoost = (heroCount === 1) ? XP_TABLE_TIER_BOOST[tier] : 1.0;

    // percent to reduce XP gained based on hero level
    const levelReduction = XP_TABLE_HERO_REDUCTION[level];

    ////
    // WC3 Experience logic:
    //
    // ( base xp gained * tier boost multiplier * level reduction multiplier) / hero count
    ////
    
    return Math.floor((baseXp * tierBoost * levelReduction) / heroCount);
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
      const shouldGroup = (unit.isUnit || unit.isFountain) && !unit.isCritter;
      if (!shouldGroup) {
        // ignore non-units, buildings that aren't fountains, critters

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
