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

const COMBAT_CAMP_DISTANCE_SQ = 700 * 700;
const ENGAGEMENT_MARGIN = 1500;
const MAX_CREDIT_PER_EVENT_MS = 10000;

//
// ── Project C: per-player credit ─────────────────────────────────────────
//
// We ship ONE credit determination per player per camp — never two models
// presented as guesswork. Internally there are two scoring models so the
// behaviour can be evidence-tuned offline (tools/validate-camp-credit.js);
// only the ACTIVE one is ever evaluated and exported. All constants are
// named and tunable from that harness.
//
// Model A — "time-threshold": simple, maximally explainable.
// Model B — "weighted multi-criterion" (default): keeps engine nuance
//           (interaction count, hero presence, share) while still
//           collapsing to a flat, displayable checklist.
//
const CAMP_CREDIT_MODELS = {
  A: {
    PER_LEVEL_MS:     2200,   // required engaged ms per creep level
    REQUIRE_HERO:     true,
    MIN_INTERACTIONS: 1,
    PULL_TIME_WEIGHT: 0.6     // creep-pull time counts at 60%
  },
  B: {
    PER_LEVEL_MS:        2400,
    FOUNTAIN_FACTOR:     1.75, // fountain-of-health camps take longer
    REQUIRE_HERO:        true,
    MIN_INTERACTIONS:    1,
    PULL_TIME_WEIGHT:    0.65,
    INTERACTION_BOOST_MS: 650, // each creep interaction adds effective ms
    HERO_BOOST_FACTOR:   1.20,
    CREDIT_FRACTION:     0.80, // need 80% of required effective ms
    CONTEST_SHARE_FLOOR: 0.25  // below this share (while another leads) = assist, not credit
  }
};
const ACTIVE_CREDIT_MODEL = 'B';

// A camp's effective fighting footprint is larger than the exact creep spawn
// points (attackers stand at the camp edge, creeps wander within aggro). The
// 'in-camp' test expands the tight unit bounds by this much; beyond it (out to
// the leash) is 'creep-pull'. Tunable via the evidence harness (Project C6).
const IN_CAMP_PADDING = 256;

// presence accounting
const MAX_SEGMENT_GAP_MS = 12000; // gap between a player's events that still counts as continuous presence
const CONTEST_WINDOW_MS  = 8000;  // another player active within this of an event => 'contested'

// confidence (0..1): start at 1, deduct for explicit uncertainty factors,
// clamp to [0,1]. Below UNCERTAIN_THRESHOLD the camp is shown as "uncertain"
// with the reasons listed — we never present a shaky call as definitive.
const UNCERTAIN_THRESHOLD = 0.55;
const CONF_DEDUCT = {
  fewEvents:        0.20, // very thin evidence (< 4 events)
  shortEngagement:  0.15, // total engaged window < 4s
  contested:        0.20, // another player overlapped significantly
  mostlyPull:       0.15, // > 60% of engaged time was creep-pull (leash heuristic)
  approxLeash:      0.10, // leash boundary is the WC3 default, not map-exact
  nearThreshold:    0.15  // effective ms within ±10% of the credit threshold
};

const isCombatUnit = (unit) => {
  if (!unit) return false;
  if (!unit.isRegistered) return false;
  if (unit.isIllusion) return false;
  if (unit.meta && unit.meta.worker) return false;
  if (unit.isUnit) return true;
  if (unit.isBuilding && unit.isUprooted) return true;
  return false;
};

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

    //
    // Project C: per-player INDEPENDENT event log. Each entry is one
    // observed camp interaction by one player, with the *accurate* position
    // (Project A) at event time so zone tagging (in-camp / creep-pull) is
    // trustworthy. `zone` is set here from the camp's true unit bounds + the
    // resolved leash; `labels` (incl. cross-player 'contested') and the
    // single credit determination are finalized in calculateClaims().
    //
    this.perPlayerEvents = [];
    this.leashDistance = null;  // resolved from world.campLeash at first event
    this.leashSource = null;    // 'mapConstants' | 'wc3Default'
  }

  //
  // Zone of a world point relative to THIS camp's original tight unit bounds:
  //   'in-camp'    — inside the camp's real footprint
  //   'creep-pull' — outside the camp but within the creep leash (the camp was
  //                  dragged / engaged from beyond its natural bounds)
  //   'out'        — beyond the leash (not attributable to this camp)
  //
  _classifyZone (x, y, leashDistance) {
    const ub = this.unitBounds;
    if (x == null || y == null || !ub) {
      return 'out';
    }
    // 'in-camp' = inside the camp's effective footprint (tight unit bounds
    // expanded by IN_CAMP_PADDING, since attackers fight from the edge).
    if (x >= ub.minX - IN_CAMP_PADDING && x <= ub.maxX + IN_CAMP_PADDING &&
        y >= ub.minY - IN_CAMP_PADDING && y <= ub.maxY + IN_CAMP_PADDING) {
      return 'in-camp';
    }
    // distance from the point to the (unpadded) camp AABB; within the creep
    // leash it's a pull, beyond it the interaction isn't this camp's.
    const dx = (x < ub.minX) ? (ub.minX - x) : (x > ub.maxX ? x - ub.maxX : 0);
    const dy = (y < ub.minY) ? (ub.minY - y) : (y > ub.maxY ? y - ub.maxY : 0);
    const distToCamp = Math.sqrt((dx * dx) + (dy * dy));
    return (distToCamp <= leashDistance) ? 'creep-pull' : 'out';
  }

  //
  // The player's hero (preferred) or combat unit physically closest to this
  // camp, with its accurate current position. Used to anchor location events
  // (which are issued for a move group, not a single unit) to a real spot.
  //
  _closestRelevantUnitPos (player) {
    const cx = (this.unitBounds.minX + this.unitBounds.maxX) / 2;
    const cy = (this.unitBounds.minY + this.unitBounds.maxY) / 2;

    let best = null;
    let bestDistSq = Infinity;
    let bestIsHero = false;

    player.units.forEach(unit => {
      if (!unit || unit.isTraining || !unit.isRegistered) return;
      const isHero = !!(unit.meta && unit.meta.hero);
      const isCombat = isCombatUnit(unit);
      if (!isHero && !isCombat) return;
      if (unit.currentX == null || unit.currentY == null) return;

      const ddx = unit.currentX - cx;
      const ddy = unit.currentY - cy;
      const dsq = (ddx * ddx) + (ddy * ddy);

      // prefer a hero even if a non-hero combat unit is marginally closer
      if ((isHero && !bestIsHero) ||
          (isHero === bestIsHero && dsq < bestDistSq)) {
        best = unit;
        bestDistSq = dsq;
        bestIsHero = isHero;
      }
    });

    if (!best) return null;
    return {
      x: best.currentX,
      y: best.currentY,
      uuid: best.uuid,
      hasHero: bestIsHero,
      isCombat: isCombatUnit(best)
    };
  }

  //
  // Resolve (once) and cache the creep leash for this camp from the world.
  // Falls back to the documented WC3 default — see helpers/mappings.
  //
  _resolveLeash (player) {
    if (this.leashDistance != null) {
      return this.leashDistance;
    }
    const worldLeash = player && player.world && player.world.campLeash;
    if (worldLeash && typeof worldLeash.distance === 'number') {
      this.leashDistance = worldLeash.distance;
      this.leashSource = worldLeash.source || 'wc3Default';
    } else {
      const fallback = require("../helpers/mappings").resolveCampLeash(null);
      this.leashDistance = fallback.distance;
      this.leashSource = fallback.source;
    }
    return this.leashDistance;
  }

  //
  // Record one normalized per-player camp event with accurate position +
  // zone. `stage` ∈ enter | within | exit | interact-creep | interact-item.
  //
  _pushPerPlayerEvent (player, stage, pos, extra) {
    const leash = this._resolveLeash(player);
    const x = pos ? pos.x : null;
    const y = pos ? pos.y : null;
    const zone = this._classifyZone(x, y, leash);

    this.perPlayerEvents.push(Object.assign({
      gameTime: player.eventTimer.timer.gameTime,
      playerId: player.id,
      teamId: player.teamId,
      stage,
      x: (x != null) ? +x.toFixed(1) : null,
      y: (y != null) ? +y.toFixed(1) : null,
      zone,                    // 'in-camp' | 'creep-pull' | 'out'
      labels: [zone],          // 'contested' appended in calculateClaims()
      focusUnitUuid: pos ? (pos.uuid || null) : null
    }, extra || {}));
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

  combatUnitsNearCamp (player) {
    const ub = this.unitBounds;

    return player.units.some(unit => {
      if (!isCombatUnit(unit)) return false;
      if (unit.isTraining) return false;

      if (unit.currentX >= ub.minX && unit.currentX <= ub.maxX &&
          unit.currentY >= ub.minY && unit.currentY <= ub.maxY) {
        return true;
      }

      return this.units.some(neutralUnit => {
        const dx = unit.currentX - neutralUnit.currentX;
        const dy = unit.currentY - neutralUnit.currentY;
        return (dx * dx + dy * dy) <= COMBAT_CAMP_DISTANCE_SQ;
      });
    });
  }

  addLocationEvent (player, type) {
    const gameTime = player.eventTimer.timer.gameTime;
    console.logger(`player ${player.id} ${type} group at ${gameTime}`);

    const hasHero = (type !== 'entered') ? this.heroNearCamp(player) : false;
    const hasCombatUnit = (type !== 'entered') ? this.combatUnitsNearCamp(player) : false;

    this.locationStream.push({
      gameTime,
      type,
      playerId: player.id,
      teamId: player.teamId,
      hasHero,
      hasCombatUnit
    });

    // additive per-player record (Project C) — does not affect legacy team path
    const stageMap = { entered: 'enter', within: 'within', exited: 'exit' };
    const pos = this._closestRelevantUnitPos(player);
    this._pushPerPlayerEvent(player, stageMap[type] || type, pos, {
      hasHero: hasHero || false,
      hasCombatUnit: hasCombatUnit || false
    });
  }

  addPlayerEvent (player, selectedUnits, focusUnit) {
    const gameTime = player.eventTimer.timer.gameTime;

    // hasHero is based on the unit doing the right-click (focusUnit),
    // NOT the full selection which may include heroes elsewhere on the map.
    const isHeroInteraction = focusUnit && focusUnit.meta && focusUnit.meta.hero;
    const isCombatInteraction = isCombatUnit(focusUnit);

    if (!this.engaged) {
      this.engaged = true;
      this.engagedBounds = {
        minX: this.unitBounds.minX - ENGAGEMENT_MARGIN,
        minY: this.unitBounds.minY - ENGAGEMENT_MARGIN,
        maxX: this.unitBounds.maxX + ENGAGEMENT_MARGIN,
        maxY: this.unitBounds.maxY + ENGAGEMENT_MARGIN
      };
      if (player.world && typeof player.world.expandNeutralDetection === 'function') {
        player.world.expandNeutralDetection(this);
      }
    }

    this.playerEventStream.push({
      gameTime,
      type: 'player',
      playerId: player.id,
      teamId: player.teamId,
      selectedUnits,
      hasHero: isHeroInteraction || false,
      isCombatInteraction
    });

    // additive per-player record (Project C). focusUnit is the unit that
    // actually issued the right-click; its position is accurate (Project A),
    // so the in-camp vs creep-pull zone here is trustworthy.
    const pos = (focusUnit && focusUnit.currentX != null)
      ? { x: focusUnit.currentX, y: focusUnit.currentY, uuid: focusUnit.uuid }
      : this._closestRelevantUnitPos(player);
    this._pushPerPlayerEvent(player, 'interact-creep', pos, {
      hasHero: isHeroInteraction || false,
      hasCombatUnit: isCombatInteraction || false,
      selectedUnitCount: Array.isArray(selectedUnits) ? selectedUnits.length : 0
    });
  }

  //
  // A unit selected/picked up a ground item near this camp.
  //
  // HONEST LIMITATION: the replay's SelectGroundItemAction carries the item
  // *instance* objectIds but NO position and NO reliable type for random
  // creep drops. We therefore record only what is actually knowable: that a
  // specific player's unit interacted with *an* item near this camp at time
  // T. itemIdentity is resolved when the itemId is known, otherwise flagged
  // explicitly so the UI can say "unknown / random drop" rather than guess.
  //
  addItemEvent (player, selectingUnit, x, y, itemId) {
    const resolved = itemId
      ? resolveDropItem(itemId)
      : { itemId: null, displayName: 'Unknown item', isRandom: true };

    const pos = (x != null && y != null)
      ? { x, y, uuid: selectingUnit ? selectingUnit.uuid : null }
      : this._closestRelevantUnitPos(player);

    this._pushPerPlayerEvent(player, 'interact-item', pos, {
      hasHero: !!(selectingUnit && selectingUnit.meta && selectingUnit.meta.hero),
      hasCombatUnit: isCombatUnit(selectingUnit),
      itemId: resolved.itemId,
      itemName: resolved.displayName,
      itemIdentityKnown: !resolved.isRandom && !!resolved.itemId
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
      const hasCombatUnit = (type !== 'player')
        ? (e.hasCombatUnit || false)
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
          currentClaim.segmentHasInteraction =
            (type == 'player' && (e.hasHero || e.isCombatInteraction));

          openInterval(teamId, playerId, gameTime, unitCount, hasHero);
        }
      } else {

        // mark arrived once we get a 'within', 'exited', or 'player' event
        if (type !== 'entered') currentClaim.arrivedInCamp = true;
        if (type == 'player' && (e.hasHero || e.isCombatInteraction) && !currentClaim.segmentHasInteraction) {
          currentClaim.segmentHasInteraction = true;
          // reset timer so only post-engagement time is credited
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

        // 'player' events also tick the timer so pulled-camp clears (no
        // 'within'/'exited' nearby) still accrue credit per right-click.
        if (type == 'exited' || type == 'within' || type == 'player') {
          const rawTimeDiff = (gameTime - currentClaim.lastTimer);
          const timeDiff = Math.min(rawTimeDiff, MAX_CREDIT_PER_EVENT_MS);

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
          if (!currentClaim.segmentHasInteraction && !hasHero && !hasCombatUnit) {
            currentClaim.active = false;
            currentClaim.lastTimer = gameTime;
            currentClaim.multiplier = 1;
            if (type == 'exited') {
              closeInterval(teamId, playerId, gameTime);
            }
            return;
          }

          // Stop crediting once this team has cleared — late wander-bys must not inflate.
          if (claimers[teamId].timeClaimed >= expectedClearTime) {
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

    // Backfill credit from the longest contiguous engagement run only —
    // non-contiguous intervals would inflate the claim across the whole game.
    const HERO_INTERVAL_GAP_MS = 15000;
    Object.keys(claimers).forEach(teamId => {
      const teamHeroIntervals = this.presenceIntervals
        .filter(iv => +iv.teamId === +teamId && (iv.hasHero || iv.hasCombatUnit))
        .sort((a, b) => a.enterTime - b.enterTime);
      if (!teamHeroIntervals.length) return;

      let bestSpan = 0;
      let runStart = teamHeroIntervals[0].enterTime;
      let runEnd = teamHeroIntervals[0].exitTime;
      for (let i = 1; i < teamHeroIntervals.length; i++) {
        const iv = teamHeroIntervals[i];
        if (iv.enterTime - runEnd <= HERO_INTERVAL_GAP_MS) {
          runEnd = Math.max(runEnd, iv.exitTime);
        } else {
          bestSpan = Math.max(bestSpan, runEnd - runStart);
          runStart = iv.enterTime;
          runEnd = iv.exitTime;
        }
      }
      bestSpan = Math.max(bestSpan, runEnd - runStart);

      const heroSpan = Math.min(bestSpan, expectedClearTime);
      if (heroSpan > claimers[teamId].timeClaimed) {
        claimers[teamId].timeClaimed = heroSpan;
      }
      if (heroSpan > 0) emitSnapshot(runEnd);
    });

    // firstInteractionTime: first hero or combat-unit presence (drives when the camp visually appears).
    const engagedIntervals = this.presenceIntervals.filter(iv => iv.hasHero || iv.hasCombatUnit);
    if (engagedIntervals.length) {
      this.firstInteractionTime = engagedIntervals.reduce((min, iv) => {
        return iv.enterTime < min ? iv.enterTime : min;
      }, Infinity);
    } else if (this.presenceIntervals.length) {
      // fallback: use first interval of any kind
      this.firstInteractionTime = this.presenceIntervals.reduce((min, iv) => {
        return iv.enterTime < min ? iv.enterTime : min;
      }, Infinity);
    }

    //
    // strip timeline entries from before any real engagement (hero or
    // combat unit) was at the camp. peon-only proximity still doesn't
    // generate visible progress.
    //
    const firstEngagementIntervalTime = engagedIntervals.length
      ? Math.min(...engagedIntervals.map(iv => iv.enterTime))
      : Infinity;

    const engagedPlayerEvents = allEvents.filter(e =>
      e.type === 'player' && (e.hasHero || e.isCombatInteraction)
    );
    const firstEngagementPlayerTime = engagedPlayerEvents.length
      ? Math.min(...engagedPlayerEvents.map(e => e.gameTime))
      : Infinity;

    const firstEngagementPresence = Math.min(firstEngagementIntervalTime, firstEngagementPlayerTime);

    if (firstEngagementPresence < Infinity) {
      while (progressTimeline.length && progressTimeline[0].gameTime < firstEngagementPresence) {
        progressTimeline.shift();
      }
    } else {
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

    const teamFirstEngagementTime = {};
    teamsWithCredit.forEach(tid => {
      const teamEngagedIntervals = this.presenceIntervals.filter(iv =>
        +iv.teamId === +tid && (iv.hasHero || iv.hasCombatUnit)
      );
      const teamEngagedPlayers = allEvents.filter(e =>
        e.type === 'player' && +e.teamId === +tid && (e.hasHero || e.isCombatInteraction)
      );
      const times = [
        ...teamEngagedIntervals.map(iv => iv.enterTime),
        ...teamEngagedPlayers.map(e => e.gameTime)
      ];
      if (!times.length) {
        const anyTeamInterval = this.presenceIntervals.find(iv => +iv.teamId === +tid);
        if (anyTeamInterval) times.push(anyTeamInterval.enterTime);
      }
      teamFirstEngagementTime[tid] = times.length ? Math.min(...times) : lastEventTime;
    });

    if (teamsWithCredit.length > 1) {
      // Cleared by the top team unless the runner-up has >= CONTEST_FRACTION share.
      const runnerUpContribution = sortedTeams.length > 1 ? (this.contributions[sortedTeams[1]] || 0) : 0;
      const claimTime = Math.min(...teamsWithCredit.map(tid => teamFirstEngagementTime[tid]));
      if (topContribution >= MAJORITY_FRACTION && runnerUpContribution < CONTEST_FRACTION) {
        this.assignClaim(ClaimStates.cleared, teamFirstEngagementTime[topTeamId], +topTeamId);
      } else {
        this.assignClaim(ClaimStates.contested, claimTime, +topTeamId);
      }
    } else if (teamsWithCredit.length === 1) {
      const tid = teamsWithCredit[0];
      this.assignClaim(ClaimStates.cleared, teamFirstEngagementTime[tid], +tid);
    } else {
      this.claimState = ClaimStates.untouched;
    }

    this.progressTimeline = progressTimeline;
    this.claimers = claimers;

    // Project C: derive the per-player credit determination. Additive — the
    // legacy team computation above is untouched so map rings, order badges
    // and helpers/utils XP keep working unchanged.
    this._computePlayerCredit();
  }

  //
  // Score one player's measured signals with the given (internal) model.
  // Returns the single determination + a flat, displayable checklist.
  //
  _scoreCreditModel (m, modelName) {
    const cfg = CAMP_CREDIT_MODELS[modelName] || CAMP_CREDIT_MODELS.B;
    const lvl = this.totalLevel || 1;
    const criteria = [];
    let effectiveMs, requiredMs;

    if (modelName === 'A') {
      effectiveMs = m.inCampMs + (cfg.PULL_TIME_WEIGHT * m.pullMs);
      requiredMs  = cfg.PER_LEVEL_MS * lvl;
    } else {
      effectiveMs = (m.inCampMs +
                     (cfg.PULL_TIME_WEIGHT * m.pullMs) +
                     (cfg.INTERACTION_BOOST_MS * m.interactionCount)) *
                    (m.heroPresent ? cfg.HERO_BOOST_FACTOR : 1);
      requiredMs  = cfg.PER_LEVEL_MS * lvl * (this.hasFountain ? cfg.FOUNTAIN_FACTOR : 1);
    }

    const needMs   = (modelName === 'B') ? requiredMs * cfg.CREDIT_FRACTION : requiredMs;
    const heroOk   = !cfg.REQUIRE_HERO || m.heroPresent;
    const intOk    = m.interactionCount >= cfg.MIN_INTERACTIONS;
    const timeOk   = effectiveMs >= needMs;
    const shareOk  = (modelName === 'B') ? (m.share >= cfg.CONTEST_SHARE_FLOOR) : true;

    criteria.push({ key: 'heroPresent', label: 'Hero / combat unit present',
      pass: heroOk, measured: m.heroPresent ? 1 : 0, required: cfg.REQUIRE_HERO ? 1 : 0 });
    criteria.push({ key: 'interactions', label: 'Creep interactions',
      pass: intOk, measured: m.interactionCount, required: cfg.MIN_INTERACTIONS });
    criteria.push({ key: 'effectiveTime', label: 'Effective interaction time',
      pass: timeOk, measured: Math.round(effectiveMs), required: Math.round(needMs), unit: 'ms' });
    if (modelName === 'B') {
      criteria.push({ key: 'share', label: 'Contribution share',
        pass: shareOk, measured: +m.share.toFixed(2), required: cfg.CONTEST_SHARE_FLOOR });
    }

    const credited = heroOk && intOk && timeOk && shareOk;

    let whyNot = null;
    if (!credited) {
      const fail = criteria.find(c => !c.pass);
      if (fail) {
        if (fail.key === 'heroPresent') {
          whyNot = 'No hero or combat unit was at this camp — only workers/scouts were seen.';
        } else if (fail.key === 'interactions') {
          whyNot = `No direct creep interaction recorded (needed ${fail.required}).`;
        } else if (fail.key === 'effectiveTime') {
          whyNot = `Only ${(fail.measured / 1000).toFixed(1)}s of the ${(fail.required / 1000).toFixed(1)}s ` +
                   `required effective interaction time — left the camp too early.`;
        } else if (fail.key === 'share') {
          whyNot = `Contributed only ${Math.round(fail.measured * 100)}% of the camp effort ` +
                   `(needed ${Math.round(fail.required * 100)}%) — another player did most of it.`;
        }
      }
    }

    return { effectiveMs, requiredMs: needMs, credited, criteria, whyNot };
  }

  //
  // Accumulate one player's measured signals from their sorted events.
  // Time is credited between consecutive events while present (not 'out'),
  // capped per step so a long idle gap can't inflate a camp.
  //
  _measureFromEvents (events) {
    let inCampMs = 0, pullMs = 0, interactionCount = 0, itemInteractions = 0;
    let heroPresent = false, combatPresent = false;
    let firstEngagementTime = null, lastEventTime = null;

    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.hasHero) heroPresent = true;
      if (e.hasCombatUnit) combatPresent = true;
      if (e.stage === 'interact-creep') interactionCount++;
      if (e.stage === 'interact-item') itemInteractions++;
      if (e.zone !== 'out') {
        if (firstEngagementTime == null) firstEngagementTime = e.gameTime;
        lastEventTime = e.gameTime;
      }
      if (i > 0) {
        const prev = events[i - 1];
        const dt = e.gameTime - prev.gameTime;
        if (prev.zone !== 'out' && dt > 0 && dt <= MAX_SEGMENT_GAP_MS) {
          const add = Math.min(dt, MAX_CREDIT_PER_EVENT_MS);
          if (prev.zone === 'in-camp') inCampMs += add;
          else if (prev.zone === 'creep-pull') pullMs += add;
        }
      }
    }
    return {
      inCampMs, pullMs, interactionCount, itemInteractions,
      heroPresent, combatPresent, firstEngagementTime, lastEventTime,
      eventCount: events.length
    };
  }

  //
  // Single per-player credit determination + honest confidence + evidence +
  // a playback timeline (so the client never re-derives the formula).
  //
  _computePlayerCredit () {
    this.playerCredit = {};
    this.playerCreditTimeline = [];

    const all = (this.perPlayerEvents || []).slice().sort((a, b) => a.gameTime - b.gameTime);
    if (!all.length) return;

    // group by player
    const byPlayer = {};
    all.forEach(e => {
      (byPlayer[e.playerId] = byPlayer[e.playerId] || []).push(e);
    });

    // 'contested' label: another player active within CONTEST_WINDOW_MS
    all.forEach(e => {
      const overlap = all.some(o =>
        o !== e && o.playerId !== e.playerId && o.zone !== 'out' &&
        Math.abs(o.gameTime - e.gameTime) <= CONTEST_WINDOW_MS);
      if (overlap && e.labels.indexOf('contested') === -1) {
        e.labels.push('contested');
      }
    });

    // measure + score each player
    const measures = {};
    const scores = {};
    let effSum = 0;
    Object.keys(byPlayer).forEach(pid => {
      const m = this._measureFromEvents(byPlayer[pid]);
      m.share = 0; // filled after we know the total
      measures[pid] = m;
    });
    // provisional effective totals (share-independent) to derive shares
    Object.keys(measures).forEach(pid => {
      const m = measures[pid];
      const provisional = this._scoreCreditModel(m, ACTIVE_CREDIT_MODEL).effectiveMs;
      m._provEff = provisional;
      effSum += provisional;
    });
    Object.keys(measures).forEach(pid => {
      const m = measures[pid];
      m.share = effSum > 0 ? (m._provEff / effSum) : (Object.keys(measures).length === 1 ? 1 : 0);
      scores[pid] = this._scoreCreditModel(m, ACTIVE_CREDIT_MODEL);
    });

    Object.keys(byPlayer).forEach(pid => {
      const m = measures[pid];
      const s = scores[pid];
      const evs = byPlayer[pid];
      const engagedWindow = (m.firstEngagementTime != null && m.lastEventTime != null)
        ? (m.lastEventTime - m.firstEngagementTime) : 0;
      const totalEngaged = m.inCampMs + m.pullMs;
      const pullFrac = totalEngaged > 0 ? (m.pullMs / totalEngaged) : 0;
      const contestedOverlap = evs.some(e => e.labels.indexOf('contested') !== -1);

      // honest confidence
      const reasons = [];
      let conf = 1.0;
      if (m.eventCount < 4)      { conf -= CONF_DEDUCT.fewEvents;       reasons.push('very few events recorded'); }
      if (engagedWindow < 4000)  { conf -= CONF_DEDUCT.shortEngagement; reasons.push('engagement window under 4s'); }
      if (contestedOverlap)      { conf -= CONF_DEDUCT.contested;       reasons.push('another player overlapped this camp'); }
      if (pullFrac > 0.6)        { conf -= CONF_DEDUCT.mostlyPull;      reasons.push('mostly creep-pull (leash heuristic)'); }
      if (this.leashSource === 'wc3Default') { conf -= CONF_DEDUCT.approxLeash; reasons.push('pull boundary uses the standard WC3 default leash, not a map-exact value'); }
      const ratio = s.requiredMs > 0 ? (s.effectiveMs / s.requiredMs) : 0;
      if (ratio > 0.9 && ratio < 1.1) { conf -= CONF_DEDUCT.nearThreshold; reasons.push('effective time is right at the credit threshold'); }
      conf = Math.max(0, Math.min(1, conf));

      // a few representative events as evidence
      const evidence = [];
      const firstInteract = evs.find(e => e.stage === 'interact-creep');
      const firstItem = evs.find(e => e.stage === 'interact-item');
      const lastExit = [...evs].reverse().find(e => e.stage === 'exit');
      const firstContested = evs.find(e => e.labels.indexOf('contested') !== -1);
      [firstInteract, firstItem, firstContested, lastExit].forEach(e => {
        if (e && !evidence.some(x => x.gameTime === e.gameTime && x.stage === e.stage)) {
          evidence.push({ gameTime: e.gameTime, stage: e.stage, zone: e.zone, labels: e.labels.slice() });
        }
      });

      this.playerCredit[pid] = {
        playerId: +pid,
        teamId: evs[0] ? evs[0].teamId : null,
        credited: s.credited,
        confidence: +conf.toFixed(2),
        uncertain: conf < UNCERTAIN_THRESHOLD,
        confidenceReasons: reasons,
        model: ACTIVE_CREDIT_MODEL,
        criteria: s.criteria,
        measured: {
          inCampMs: Math.round(m.inCampMs),
          pullMs: Math.round(m.pullMs),
          effectiveMs: Math.round(s.effectiveMs),
          requiredMs: Math.round(s.requiredMs),
          interactionCount: m.interactionCount,
          itemInteractions: m.itemInteractions,
          share: +m.share.toFixed(3),
          engagedWindowMs: Math.round(engagedWindow)
        },
        whyNot: s.whyNot,
        leashSource: this.leashSource,
        firstEngagementTime: m.firstEngagementTime,
        lastEventTime: m.lastEventTime,
        evidence
      };
    });

    // playback timeline: replay events in time order, recompute each player's
    // measured up to t, emit a compact snapshot when credited flips or
    // effective ms moves >= 1% of required. Client just looks up <= gameTime.
    const seenByPlayer = {};
    const lastEmit = {};
    let lastCreditedKey = '';
    all.forEach(e => {
      (seenByPlayer[e.playerId] = seenByPlayer[e.playerId] || []).push(e);
      const snap = { gameTime: e.gameTime, players: {} };
      let creditedKey = '';
      let changed = false;
      Object.keys(seenByPlayer).forEach(pid => {
        const mm = this._measureFromEvents(seenByPlayer[pid]);
        mm.share = measures[pid] ? measures[pid].share : 0; // final share (stable for UI)
        const ss = this._scoreCreditModel(mm, ACTIVE_CREDIT_MODEL);
        snap.players[pid] = {
          credited: ss.credited,
          effectiveMs: Math.round(ss.effectiveMs),
          requiredMs: Math.round(ss.requiredMs),
          inCampMs: Math.round(mm.inCampMs),
          pullMs: Math.round(mm.pullMs),
          interactionCount: mm.interactionCount
        };
        creditedKey += `${pid}:${ss.credited ? 1 : 0};`;
        const prev = lastEmit[pid];
        if (!prev || Math.abs(ss.effectiveMs - prev) >= (ss.requiredMs * 0.01)) {
          changed = true;
          lastEmit[pid] = ss.effectiveMs;
        }
      });
      if (changed || creditedKey !== lastCreditedKey) {
        lastCreditedKey = creditedKey;
        this.playerCreditTimeline.push(snap);
      }
    });
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
      unitBounds,
      perPlayerEvents,
      playerCredit,
      playerCreditTimeline,
      leashSource,
      leashDistance
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
      unitBounds: unitBounds || bounds,

      // Project C — per-player tracking (additive; legacy fields unchanged)
      perPlayerEvents: perPlayerEvents || [],
      playerCredit: playerCredit || {},
      playerCreditTimeline: playerCreditTimeline || [],
      creditModel: ACTIVE_CREDIT_MODEL,
      leashSource: leashSource || null,
      leashDistance: leashDistance || null
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
      // Hold a back-reference so World can swap in engaged bounds without
      // having to re-derive the box at expand time.
      group._detectionBox = item;
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
