const utils = require("../helpers/utils");
const { resolveDropItem } = require("../helpers/mappings");
const rbush = require("rbush");

const TREE_HITBOX_SIZE = 312; // approx unit size to always collide with neighbors

const ClaimStates = {
  untouched: 0,
  contested: 1,
  cleared: 2,
  partial: 3
};

//
// expected effective time (ms) per total creep level to fully clear a camp.
// a level-6 camp expects ~21s effective time, matching prior "claimed" threshold.
//
const BASE_CLEAR_TIME_PER_LEVEL = 3500;

//
// completion thresholds for state assignment
//
const CLEARED_THRESHOLD = 0.85;

//
// if a single team has this fraction or more of total contribution, they are the majority owner
//
const MAJORITY_FRACTION = 0.60;
const CONTEST_FRACTION = 0.25;

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
  constructor (bounds, unitBounds, units) {
    this.uuid = utils.uuidv4();
    this.bounds = bounds;
    this.unitBounds = unitBounds;
    this.units = units;
    this.order = 0;
    this.xpSnapshot = {};

    this.totalLevel = units.reduce((acc, unit) => {
      return acc + unit.balanceInfo.level;
    }, 0);

    this.hasFountain = units.some(unit => {
      return unit.isFountain;
    }) || false;

    this.locationStream = [];
    this.playerEventStream = [];

    this.claimState = ClaimStates.untouched;
    this.claimTime = null;
    this.claimOwnerId = null;

    this.presenceIntervals = [];
    this.contributions = {};
    this.completionEstimate = 0;
    this.uncontested = false;
    this.firstInteractionTime = null;

    this.heroClaimRecords = []; // set after claims are calculated
  }

  heroNearCamp (player) {
    const HERO_CAMP_DISTANCE_SQ = 700 * 700;
    const ub = this.unitBounds;

    return player.units.some(hero => {
      if (!hero.meta || !hero.meta.hero) return false;
      if (hero.isTraining || !hero.isRegistered) return false;

      // check 1: hero inside the camp's tight unitBounds
      if (hero.currentX >= ub.minX && hero.currentX <= ub.maxX &&
          hero.currentY >= ub.minY && hero.currentY <= ub.maxY) {
        return true;
      }

      // check 2: hero within 700 units of any neutral unit in the camp
      return this.units.some(neutralUnit => {
        const dx = hero.currentX - neutralUnit.currentX;
        const dy = hero.currentY - neutralUnit.currentY;
        return (dx * dx + dy * dy) <= HERO_CAMP_DISTANCE_SQ;
      });
    });
  }

  addLocationEvent (player, type) {
    const gameTime = player.eventTimer.timer.gameTime;
    console.logger(`player ${player.id} ${type} group at ${gameTime}`);

    // check if any of this player's heroes are physically inside the camp bounds
    const hasHero = (type !== 'entered') ? this.heroNearCamp(player) : false;

    this.locationStream.push({
      gameTime,
      type,
      playerId: player.id,
      teamId: player.teamId,
      hasHero
    });
  }

  addPlayerEvent (player, selectedUnits, focusUnit) {
    const gameTime = player.eventTimer.timer.gameTime;

    // hasHero is based on the unit doing the right-click (focusUnit),
    // NOT the full selection which may include heroes elsewhere on the map.
    const isHeroInteraction = focusUnit && focusUnit.meta && focusUnit.meta.hero;

    this.playerEventStream.push({
      gameTime,
      type: 'player',
      playerId: player.id,
      teamId: player.teamId,
      selectedUnits,
      hasHero: isHeroInteraction || false
    });
  }

  isClaimed () {
    return this.claimState === ClaimStates.cleared;
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
    const { hasFountain, totalLevel } = this;

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
      this.claimState = ClaimStates.untouched;
      this.claimers = claimers;

      return;
    }

    //
    // track open presence intervals per team+player
    //
    const openIntervals = {};

    const openInterval = (teamId, playerId, gameTime, unitCount, hasHero) => {
      const key = `${teamId}_${playerId}`;
      if (openIntervals[key]) {
        return; // already open
      }
      openIntervals[key] = {
        teamId: +teamId,
        playerId: +playerId,
        enterTime: gameTime,
        exitTime: null,
        unitCount: unitCount || 0,
        hasHero: hasHero || false
      };
    };

    const closeInterval = (teamId, playerId, gameTime) => {
      const key = `${teamId}_${playerId}`;
      const interval = openIntervals[key];
      if (!interval) {
        return;
      }
      interval.exitTime = gameTime;
      this.presenceIntervals.push(interval);
      delete openIntervals[key];
    };

    //
    // max time a single presence interval can span before being auto-closed.
    //
    const MAX_INTERVAL_MS = 45 * 1000;

    const fountainFactor = hasFountain ? 1.75 : 1.0;
    const expectedClearTime = totalLevel * BASE_CLEAR_TIME_PER_LEVEL * fountainFactor;


    //
    // progressive timeline: snapshots of per-team completion at each event.
    // the client uses this to render camps progressively during playback.
    //
    const progressTimeline = [];
    let lastSnapshotCompletion = -1;

    const emitSnapshot = (gameTime) => {
      const teams = {};
      let anyProgress = false;
      Object.keys(claimers).forEach(tid => {
        const completion = expectedClearTime > 0
          ? Math.min(1.0, claimers[tid].timeClaimed / expectedClearTime)
          : 0;
        if (completion > 0) anyProgress = true;
        teams[tid] = completion;
      });

      if (!anyProgress) return;

      // only emit if total progress changed by at least 1%
      const totalCompletion = Math.max(...Object.values(teams));
      if (Math.abs(totalCompletion - lastSnapshotCompletion) >= 0.01) {
        progressTimeline.push({ gameTime, teams: { ...teams } });
        lastSnapshotCompletion = totalCompletion;
      }
    };

    //
    // process all events to accumulate time and build presence intervals
    //
    allEvents.forEach(e => {
      const { type, gameTime, teamId, playerId, selectedUnits } = e;
      const unitCount = e.unitCount || (selectedUnits ? selectedUnits.length : 0);

      // for location events, hasHero comes from the units actually moving near the camp.
      // for 'player' events (right-click), selectedUnits is the player's full selection
      // which may include heroes far from the camp — so we DON'T use it for hasHero.
      const hasHero = (type !== 'player')
        ? (e.hasHero || false)
        : false;

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

        claimers[teamId].players[playerId].units = claimers[teamId].players[playerId].units.concat(nonSeenUnits);
      }

      if (!currentClaim.active) {
        if (type == 'entered' || type == 'player' || type == 'within') {
          //
          // close any stale interval left open from a previous activity period.
          //
          closeInterval(teamId, playerId, currentClaim.lastTimer || gameTime);

          currentClaim.active = true;
          currentClaim.lastTimer = gameTime;
          currentClaim.lastSeenCount = unitCount;

          //
          // 'entered' means the unit was commanded to move INTO the camp
          // but hasn't arrived yet. don't credit time until a 'within' or
          // 'player' event confirms the unit is actually there.
          //
          currentClaim.arrivedInCamp = (type !== 'entered');
          currentClaim.segmentHasInteraction = (type == 'player' && e.hasHero);

          openInterval(teamId, playerId, gameTime, unitCount, hasHero);
        }
      } else {

        // mark arrived once we get a 'within', 'exited', or 'player' event
        if (type !== 'entered') currentClaim.arrivedInCamp = true;
        if (type == 'player' && e.hasHero && !currentClaim.segmentHasInteraction) {
          currentClaim.segmentHasInteraction = true;
          // reset timer so only time AFTER hero engagement gets credited,
          // not the entire duration since the segment started
          currentClaim.lastTimer = gameTime;
        }

        ////
        // a player action happened when already inside of a neutral camp,
        // determine which type of multiplier boost to add to for the team.
        //
        // two types of boost multipliers depending on if a hero participates or not
        //
        // each hero in the camp seen list increases the multiplier by another factor
        ////

        if (type == 'player') {
          const heroes = selectedUnits ? selectedUnits.filter(u => u.meta && u.meta.hero) : [];
          const boost = heroes.length ?
            CAMP_HERO_INTERACTION_BOOST : CAMP_INTERACTION_BOOST;

          claimers[teamId].multiplier += boost * (Math.max(heroes.length, 1));
        }

        if (type == 'exited' || type == 'within') {
          const timeDiff = (gameTime - currentClaim.lastTimer);

          ////
          // determine the size of the attack to apply a secondary scaling factor.
          // this attempts to mimic warcraft balancing logic by applying the same
          // 'attack size force' scalar factor.
          ////

          const attackSize = this.findAttackSize(currentClaim.lastSeenCount);

          ////
          // time added for an interaction with a neutral camp:
          //
          // (amount of time in camp) * (boost multiplier for interactions) * (attack size factor)
          //
          // if this activity segment has no hero and no direct player interaction,
          // the unit is just nearby — apply heavy discount.
          ////

          //
          // engagement check:
          // - hero right-click on neutral (segmentHasInteraction): full credit
          // - hero moving through camp (segmentHasHero only): credit but cap time
          //   to 15s per chunk to prevent stale hero-in-area from runaway accumulation
          // - no hero at all: zero credit
          //
          //
          // credit time if:
          // - a hero right-clicked a neutral in this camp (segmentHasInteraction), OR
          // - THIS specific event has a hero (the hero is currently at the camp)
          //
          // non-hero location events (peons nearby) never credit time.
          //
          if (!currentClaim.segmentHasInteraction && !hasHero) {
            currentClaim.active = false;
            currentClaim.lastTimer = gameTime;
            currentClaim.multiplier = 1;
            if (type == 'exited') {
              closeInterval(teamId, playerId, gameTime);
            }
            return;
          }

          const timeAdded = (timeDiff * claimers[teamId].multiplier * attackSize.factor);

          //
          // for large time chunks, emit interpolated progress snapshots
          // so the client sees gradual fill-up instead of a single jump.
          //
          if (timeAdded > 0 && timeDiff > 5000) {
            const steps = Math.min(20, Math.ceil(timeDiff / 3000));
            const stepTime = timeDiff / steps;
            const stepCredit = timeAdded / steps;
            for (let s = 1; s < steps; s++) {
              claimers[teamId].timeClaimed += stepCredit;
              claimers[teamId].players[playerId].timeClaimed += stepCredit;
              emitSnapshot(currentClaim.lastTimer + (stepTime * s));
            }
            // credit the remainder
            const remainder = timeAdded - (stepCredit * (steps - 1));
            claimers[teamId].timeClaimed += remainder;
            claimers[teamId].players[playerId].timeClaimed += remainder;
          } else {
            claimers[teamId].timeClaimed += timeAdded;
            claimers[teamId].players[playerId].timeClaimed += timeAdded;
          }

          // emit progress snapshot after time credit
          emitSnapshot(gameTime);

          if (type == 'exited') {
            closeInterval(teamId, playerId, gameTime);
          } else {
            //
            // 'within' event: close and reopen long intervals.
            //
            const key = `${teamId}_${playerId}`;
            if (openIntervals[key] && (gameTime - openIntervals[key].enterTime) > MAX_INTERVAL_MS) {
              closeInterval(teamId, playerId, gameTime);
              openInterval(teamId, playerId, gameTime, unitCount, hasHero);
            }
          }

          currentClaim.active = false;
          currentClaim.lastTimer = gameTime;
          currentClaim.multiplier = 1;
        }
      }
    });

    //
    // close any intervals still open at end of event stream
    //
    const lastEventTime = allEvents.length ? allEvents[allEvents.length - 1].gameTime : 0;
    Object.keys(openIntervals).forEach(key => {
      const interval = openIntervals[key];
      interval.exitTime = lastEventTime;
      this.presenceIntervals.push(interval);
    });

    //
    // post-process: ensure teams with hero presence get credit for the
    // actual time span their hero was at the camp. the per-event time deltas
    // can be zero when events fire at the same game tick, but the hero
    // was physically there for the duration between first and last hero interval.
    //
    Object.keys(claimers).forEach(teamId => {
      const teamHeroIntervals = this.presenceIntervals.filter(
        iv => +iv.teamId === +teamId && iv.hasHero
      );
      if (!teamHeroIntervals.length) return;

      const heroStart = Math.min(...teamHeroIntervals.map(iv => iv.enterTime));
      const heroEnd = Math.max(...teamHeroIntervals.map(iv => iv.exitTime));
      const heroSpan = heroEnd - heroStart;

      // if the event loop credited less than the hero's actual time span,
      // bump it up — the hero was genuinely at the camp for this duration
      if (heroSpan > claimers[teamId].timeClaimed) {
        claimers[teamId].timeClaimed = heroSpan;
      }

      // also ensure at least one timeline snapshot exists for this team
      if (heroSpan > 0) {
        emitSnapshot(heroEnd);
      }
    });

    //
    // compute firstInteractionTime from hero presence intervals only.
    // passive non-hero proximity shouldn't determine when a camp visually appears.
    //
    const heroIntervals = this.presenceIntervals.filter(iv => iv.hasHero);
    if (heroIntervals.length) {
      this.firstInteractionTime = heroIntervals.reduce((min, iv) => {
        return iv.enterTime < min ? iv.enterTime : min;
      }, Infinity);
    } else if (this.presenceIntervals.length) {
      // fallback: use first interval of any kind if no hero intervals exist
      this.firstInteractionTime = this.presenceIntervals.reduce((min, iv) => {
        return iv.enterTime < min ? iv.enterTime : min;
      }, Infinity);
    }

    //
    // strip timeline entries from before any hero was at the camp.
    // this prevents peon-only proximity from generating visible progress.
    //
    const firstHeroTime = heroIntervals.length
      ? Math.min(...heroIntervals.map(iv => iv.enterTime))
      : Infinity;

    // also check for hero 'player' events (right-click on creep)
    const heroPlayerEvents = allEvents.filter(e => e.type === 'player' && e.hasHero);
    const firstHeroPlayerTime = heroPlayerEvents.length
      ? Math.min(...heroPlayerEvents.map(e => e.gameTime))
      : Infinity;

    const firstHeroPresence = Math.min(firstHeroTime, firstHeroPlayerTime);

    if (firstHeroPresence < Infinity) {
      while (progressTimeline.length && progressTimeline[0].gameTime < firstHeroPresence) {
        progressTimeline.shift();
      }
    } else {
      // no hero ever at this camp — clear all timeline entries
      progressTimeline.length = 0;
    }

    //
    // compute per-team contribution percentages
    //
    const totalTime = Object.values(claimers).reduce((sum, c) => sum + c.timeClaimed, 0);
    this.contributions = {};
    Object.keys(claimers).forEach(teamId => {
      this.contributions[teamId] = totalTime > 0
        ? claimers[teamId].timeClaimed / totalTime
        : 0;
    });

    //
    // compute completionEstimate based on totalLevel and effective time
    //
    const maxTeamTime = Math.max(...Object.values(claimers).map(c => c.timeClaimed));
    this.completionEstimate = Math.min(1.0, expectedClearTime > 0 ? maxTeamTime / expectedClearTime : 0);

    //
    // uncontested: only one team ever interacted with this camp
    //
    this.uncontested = numClaimers === 1;

    //
    // determine claim state from completionEstimate and contributions
    //
    const teamIds = Object.keys(this.contributions);
    const sortedTeams = teamIds.sort((a, b) => this.contributions[b] - this.contributions[a]);
    const topTeamId = sortedTeams[0];
    const topContribution = this.contributions[topTeamId] || 0;

    //
    // claimTime: the first moment a hero was at this camp for the owning team.
    // this determines when the camp visually appears and its position in the creep order.
    //
    const teamsWithCredit = teamIds.filter(tid => claimers[tid].timeClaimed > 0);

    // find first hero presence per team (from intervals or player events)
    const teamFirstHeroTime = {};
    teamsWithCredit.forEach(tid => {
      const teamHeroIntervals = this.presenceIntervals.filter(iv => +iv.teamId === +tid && iv.hasHero);
      const teamHeroPlayers = allEvents.filter(e => e.type === 'player' && e.hasHero && +e.teamId === +tid);
      const times = [
        ...teamHeroIntervals.map(iv => iv.enterTime),
        ...teamHeroPlayers.map(e => e.gameTime)
      ];
      teamFirstHeroTime[tid] = times.length ? Math.min(...times) : lastEventTime;
    });

    if (teamsWithCredit.length > 1) {
      const claimTime = Math.min(...teamsWithCredit.map(tid => teamFirstHeroTime[tid]));
      this.assignClaim(ClaimStates.contested, claimTime, +topTeamId);
    } else if (teamsWithCredit.length === 1) {
      const tid = teamsWithCredit[0];
      this.assignClaim(ClaimStates.cleared, teamFirstHeroTime[tid], +tid);
    } else {
      this.claimState = ClaimStates.untouched;
    }

    this.progressTimeline = progressTimeline;
    this.claimers = claimers;
  }

  assignClaim (claimState, claimTime, claimOwnerId) {
    this.claimState = claimState;
    this.claimTime = claimTime;
    this.claimOwnerId = claimOwnerId;
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

  static exportNeutralUnit (unit) {
    const exported = {
      displayName: unit.displayName,
      itemId: unit.itemId,
      balanceInfo: { level: (unit.balanceInfo && unit.balanceInfo.level) || 0 }
    };

    if (unit.droppedItemSets && unit.droppedItemSets.length) {
      exported.droppedItemSets = unit.droppedItemSets.map(drop => {
        const resolved = resolveDropItem(drop.itemId);
        return {
          itemId: drop.itemId,
          chance: drop.chance,
          displayName: resolved.displayName,
          isRandom: resolved.isRandom
        };
      });
    }

    return exported;
  }

  exportGroup () {
    const {
      bounds,
      uuid,
      units,
      totalLevel,
      claimOwnerId,
      claimState,
      claimTime,
      claimers,
      hasFountain,
      heroClaimRecords,
      heroStats,
      order,
      teamOrders,
      xpSnapshot,
      presenceIntervals,
      contributions,
      completionEstimate,
      uncontested,
      firstInteractionTime,
      progressTimeline,
      unitBounds
    } = this;

    // sanitize claimers to avoid circular references from raw Unit/Building objects
    const safeClaimers = claimers ? Object.keys(claimers).reduce((acc, teamId) => {
      const claim = claimers[teamId];
      acc[teamId] = {
        ...claim,
        players: Object.keys(claim.players).reduce((pAcc, playerId) => {
          const player = claim.players[playerId];
          pAcc[playerId] = {
            ...player,
            units: player.units.map(unit => {
              if (typeof unit.exportUnitReference === 'function') {
                return unit.exportUnitReference();
              }
              return unit;
            })
          };
          return pAcc;
        }, {})
      };
      return acc;
    }, {}) : null;

    return {
      bounds,
      uuid,
      units: units.map(u => NeutralGroup.exportNeutralUnit(u)),
      totalLevel,
      claimOwnerId,
      claimState,
      claimTime,
      claimers: safeClaimers,
      hasFountain,
      heroClaimRecords,
      heroStats,
      order,
      teamOrders: teamOrders || {},
      xpSnapshot,
      presenceIntervals: presenceIntervals || [],
      contributions: contributions || {},
      completionEstimate: completionEstimate || 0,
      uncontested: uncontested || false,
      firstInteractionTime: firstInteractionTime || null,
      progressTimeline: progressTimeline || [],
      unitBounds: unitBounds || bounds
    }
  }

  static getGroupTree (groups) {
    const tree = new rbush();

    const groupBoxes = groups.map(group => {
      const item = { ...group.bounds };
      item.uuid = group.uuid;

      return item;
    });

    tree.load(groupBoxes);
    return tree;
  }

  static getDetectionTree (groups) {
    const tree = new rbush();

    const groupBoxes = groups.map(group => {
      const item = { ...group.unitBounds };
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

    const DETECTION_MARGIN = 50;

    return groups
      .map(group => {
        // padded bounds for grouping (existing behavior)
        const bounds = {
          minX: null,
          minY: null,
          maxX: null,
          maxY: null
        };

        // tight bounds from actual unit positions for detection
        const unitBounds = {
          minX: Infinity,
          minY: Infinity,
          maxX: -Infinity,
          maxY: -Infinity
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

          // raw unit positions (no TREE_HITBOX_SIZE padding)
          if (unitBox.x < unitBounds.minX) unitBounds.minX = unitBox.x;
          if (unitBox.y < unitBounds.minY) unitBounds.minY = unitBox.y;
          if (unitBox.x > unitBounds.maxX) unitBounds.maxX = unitBox.x;
          if (unitBox.y > unitBounds.maxY) unitBounds.maxY = unitBox.y;
        });

        // add gameplay margin so units near the camp edge still register
        unitBounds.minX -= DETECTION_MARGIN;
        unitBounds.minY -= DETECTION_MARGIN;
        unitBounds.maxX += DETECTION_MARGIN;
        unitBounds.maxY += DETECTION_MARGIN;

        return new NeutralGroup(bounds, unitBounds, group.map(item => item.unit));
      });
  }
};

module.exports = NeutralGroup;
