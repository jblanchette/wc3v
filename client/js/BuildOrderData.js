const BuildOrderData = class {
  constructor () {}

  static CONFIG = {
    // Units that are always summons — filter from build order even if server missed isSummon flag
    summonUnitIds: {
      'uske': true,                          // Skeleton Warrior (Rod of Necromancy)
      'hwat': true, 'hwt2': true, 'hwt3': true, // Water Elemental (Archmage / item)
      'efon': true,                          // Treant (Keeper of the Grove)
      'osw1': true, 'osw2': true, 'osw3': true, // Spirit Wolf (Far Seer)
      'ucs1': true,                          // Carrion Beetle (Crypt Lord)
    },
    workerIds: { 'opeo': true, 'hpea': true, 'ewsp': true, 'uaco': true, 'ugho': true },
    // UD ghouls beyond this count are treated as attack units, not lumber workers
    maxGhoulWorkers: 4,
    workerForRace: { 'O': 'opeo', 'H': 'hpea', 'E': 'ewsp', 'U': 'uaco' },
    workerNames: { 'O': 'Peon', 'H': 'Peasant', 'E': 'Wisp', 'U': 'Acolyte' },
    raceStarterIcons: { 'O': 'ogre', 'H': 'htow', 'E': 'etol', 'U': 'unpl' },
    defaultStartWorkers: { 'O': 5, 'H': 5, 'E': 5, 'U': 4 },
    defaultStartSupply: { 'O': { used: 5, max: 11 }, 'H': { used: 5, max: 12 }, 'E': { used: 5, max: 10 }, 'U': { used: 4, max: 10 } },
    heroBuildTime: 55,
    tierUpgradeIds: {
      'ostr': 2, 'ofrt': 3, 'hkee': 2, 'hcas': 3,
      'unp1': 2, 'unp2': 3, 'etoa': 2, 'etoe': 3
    },
    tierUpgradeCosts: {
      'ostr': { gold: 315, lumber: 190 }, 'ofrt': { gold: 325, lumber: 190 },
      'hkee': { gold: 320, lumber: 210 }, 'hcas': { gold: 320, lumber: 210 },
      'unp1': { gold: 320, lumber: 210 }, 'unp2': { gold: 325, lumber: 230 },
      'etoa': { gold: 320, lumber: 180 }, 'etoe': { gold: 330, lumber: 200 }
    },
    expansionBuildingIds: { 'H': 'htow', 'O': 'ogre', 'E': 'etol', 'U': 'ugol' },
    verbs: { building: 'Build', unit: 'Train', workerAssign: 'Train' },
    assignLabels: { gold: 'Gold', lumber: 'Lumber', build: 'Build' },
    assignClasses: { gold: 'assign-gold', lumber: 'assign-lumber', build: 'assign-build' }
  };

  static createBoEvent (type, gameTime, supplyUsed, supplyMax, workers, extra) {
    return {
      type,
      displayName: '',
      itemId: '',
      gameTime,
      goldCost: 0, lumberCost: 0, foodCost: 0, foodProvided: 0,
      supplyUsed: supplyUsed || 0,
      supplyMax: supplyMax || 0,
      workersOnGold: (workers && workers.onGold) || 0,
      workersOnLumber: (workers && workers.onLumber) || 0,
      workersBuilding: (workers && workers.onBuild) || 0,
      consumedByBuildings: (workers && workers.consumedByBuildings) || 0,
      ghoulsOnLumber: (workers && workers.ghoulsOnLumber) || 0,
      ...extra
    };
  }

  extractBoEvents (player) {
    const cfg = BuildOrderData.CONFIG;
    const create = BuildOrderData.createBoEvent;
    const { eventStream, race } = player;
    const events = [];

    // initial worker assignment — use race defaults (first event snapshot is post-training)
    const first = eventStream[0];
    if (first) {
      const w = first.workers || {};
      const defaults = cfg.defaultStartSupply[race] || { used: 5, max: 10 };
      const startWorkers = cfg.defaultStartWorkers[race] || 5;
      events.push(create('workerAssign', 0, defaults.used, defaults.max, w, {
        displayName: 'Initial Workers',
        itemId: cfg.workerForRace[race],
        isInitialWorkers: true,
        count: 1,
        totalWorkers: startWorkers
      }));
    }

    let ghoulCount = 0; // track UD ghouls to detect attack ghouls vs lumber workers

    eventStream.forEach(event => {
      const { key, gameTime, supplyUsed, supplyMax, workers } = event;
      const w = workers || {};

      if (key === 'addBuilding') {
        const { building, isExpansion } = event;
        if (!building) return;

        if (isExpansion) {
          events.push(create('expansion', gameTime, supplyUsed, supplyMax, w, {
            displayName: building.displayName,
            itemId: building.itemId,
            goldCost: building.goldCost,
            lumberCost: building.lumberCost
          }));
          return;
        }

        const tierTarget = cfg.tierUpgradeIds[building.itemId];
        const costOvr = cfg.tierUpgradeCosts[building.itemId];
        const isSupply = building.foodMade > 0;
        events.push(create(tierTarget ? 'tierUpgrade' : 'building', gameTime, supplyUsed, supplyMax, w, {
          displayName: building.displayName,
          itemId: building.itemId,
          goldCost: costOvr ? costOvr.gold : building.goldCost,
          lumberCost: costOvr ? costOvr.lumber : building.lumberCost,
          foodCost: building.foodUsed,
          foodProvided: building.foodMade,
          isSupplyBuilding: isSupply,
          isShop: !!building.isPlayerShop,
          tierTarget: tierTarget || null,
          buildMechanic: building.buildMechanic || null,
          consumedWorkerCount: w.consumedByBuildings || 0
        }));

        // Supply completion event — synthetic row at buildTime offset
        if (isSupply && !tierTarget) {
          const buildTime = building.buildTime || 60;
          events.push(create('supplyComplete', gameTime + buildTime, supplyUsed, supplyMax, w, {
            displayName: building.displayName,
            itemId: building.itemId,
            foodProvided: building.foodMade,
            buildingStartTime: gameTime
          }));
        }

      } else if (key === 'addUnit') {
        const { unit } = event;
        if (!unit || unit.isIllusion || unit.isSummon) return;
        if (cfg.summonUnitIds[unit.itemId]) return;

        // training queue metadata
        const isTraining = unit.isTraining || false;
        const isQueued = isTraining; // if still training at event time, it's queued or actively training

        if (cfg.workerIds[unit.itemId]) {
          // UD ghouls beyond maxGhoulWorkers are attack units, not lumber workers
          if (unit.itemId === 'ugho') {
            ghoulCount++;
            if (ghoulCount > cfg.maxGhoulWorkers) {
              events.push(create('unit', gameTime, supplyUsed, supplyMax, w, {
                displayName: unit.displayName, itemId: unit.itemId,
                goldCost: unit.goldCost, lumberCost: unit.lumberCost,
                foodCost: unit.foodUsed, armorType: unit.armorType, attackType: unit.attackType
              }));
              // skip worker assignment path — these are army ghouls
              return;
            }
          }

          // assignTarget computed server-side; fallback for old replays
          const assignTarget = unit.assignTarget || 'gold';
          // Server snapshot excludes training units — include the new worker
          const adjW = { ...w };
          if (isTraining) {
            if (unit.itemId === 'ugho') {
              adjW.ghoulsOnLumber = (adjW.ghoulsOnLumber || 0) + 1;
            } else if (assignTarget === 'lumber') {
              adjW.onLumber = (adjW.onLumber || 0) + 1;
            } else {
              adjW.onGold = (adjW.onGold || 0) + 1;
            }
          }
          events.push(create('workerAssign', gameTime, supplyUsed, supplyMax, adjW, {
            displayName: unit.displayName, itemId: unit.itemId,
            goldCost: unit.goldCost, lumberCost: unit.lumberCost,
            foodCost: unit.foodUsed, assignTarget, isInitialWorkers: false,
            isTraining, isQueued
          }));
        } else if (unit.isHero) {
          // Skip if a makeTavernHero event exists for this hero at the same gameTime
          // (backward compat for old replays parsed before the server fix)
          const isDuplicateTavern = eventStream.some(evt =>
            evt.key === 'makeTavernHero' &&
            evt.gameTime === gameTime &&
            evt.unit && evt.unit.itemId === unit.itemId
          );
          if (!isDuplicateTavern) {
            const buildTime = unit.buildTime || cfg.heroBuildTime;
            // Combined training card at click time (portrait + costs + badge)
            events.push(create('heroTraining', gameTime, supplyUsed, supplyMax, w, {
              displayName: unit.displayName, itemId: unit.itemId,
              goldCost: unit.goldCost, lumberCost: unit.lumberCost,
              foodCost: unit.foodUsed, isTavern: false, buildTime,
              spawnTime: gameTime + buildTime, level: 1
            }));
            // Hero complete banner at spawn time (like supplyComplete)
            events.push(create('heroComplete', gameTime + buildTime, supplyUsed, supplyMax, w, {
              displayName: unit.displayName, itemId: unit.itemId,
              foodCost: unit.foodUsed, isTavern: false,
              trainingStartTime: gameTime
            }));
          }
        } else {
          events.push(create('unit', gameTime, supplyUsed, supplyMax, w, {
            displayName: unit.displayName, itemId: unit.itemId,
            goldCost: unit.goldCost, lumberCost: unit.lumberCost,
            foodCost: unit.foodUsed, armorType: unit.armorType, attackType: unit.attackType
          }));
        }

      } else if (key === 'makeTavernHero') {
        const { unit } = event;
        if (!unit) return;
        const buildTime = 0;  // Tavern heroes appear instantly
        // Combined hiring card at click time (portrait + costs + badge)
        events.push(create('heroTraining', gameTime, supplyUsed, supplyMax, w, {
          displayName: unit.displayName, itemId: unit.itemId,
          goldCost: unit.goldCost, lumberCost: unit.lumberCost,
          foodCost: unit.foodUsed, isTavern: true, buildTime,
          spawnTime: gameTime + buildTime, level: 1
        }));
        // Hero complete banner at spawn time (like supplyComplete)
        events.push(create('heroComplete', gameTime + buildTime, supplyUsed, supplyMax, w, {
          displayName: unit.displayName, itemId: unit.itemId,
          foodCost: unit.foodUsed, isTavern: true,
          trainingStartTime: gameTime
        }));

      } else if (key === 'HeroLevel') {
        const { unit, newLevel, spell, spellItemId, learnedSkills, spellList } = event;
        if (!unit) return;
        events.push(create('heroLevel', gameTime, supplyUsed, supplyMax, w, {
          displayName: unit.displayName, itemId: unit.itemId,
          level: newLevel, spell, spellItemId, learnedSkills, spellList: spellList || []
        }));

      } else if (key === 'research') {
        const category = event.category || 'ability';
        let type;
        if (category === 'attack') type = 'attackUpgrade';
        else if (category === 'defense') type = 'defenseUpgrade';
        else type = 'research';

        events.push(create(type, gameTime, supplyUsed, supplyMax, w, {
          displayName: event.displayName,
          itemId: event.itemId,
          goldCost: event.goldCost || 0,
          lumberCost: event.lumberCost || 0,
          level: event.level || 1,
          icon: event.icon || '',
          category,
          building: event.building
        }));
      }

    });

    events.sort((a, b) => a.gameTime - b.gameTime);

    // --- Adjust supplyMax: defer supply from buildings under construction ---
    // Server pre-counts supply when building starts; we defer it to completion.
    const supplyWindows = events
      .filter(e => e.type === 'supplyComplete')
      .map(e => ({ startTime: e.buildingStartTime, endTime: e.gameTime, food: e.foodProvided }));

    for (const event of events) {
      const snap = event.type === 'supplyComplete' ? event.buildingStartTime : event.gameTime;
      let pending = 0;
      for (const w of supplyWindows) {
        if (w.startTime <= snap && w.endTime > event.gameTime) pending += w.food;
      }
      if (pending > 0) event.supplyMax = Math.max(0, event.supplyMax - pending);
    }

    // --- Fold level 1 heroLevel events into heroTraining cards ---
    // Show the first skill choice on the hero training card instead of a separate row
    const heroTrainings = events.filter(e => e.type === 'heroTraining');
    const removedLevels = new Set();
    heroTrainings.forEach(ht => {
      const firstSkill = events.find(e =>
        e.type === 'heroLevel' && e.itemId === ht.itemId && e.level === 1 && !removedLevels.has(e)
      );
      if (firstSkill) {
        ht.firstSkill = firstSkill.spell;
        ht.firstSkillItemId = firstSkill.spellItemId;
        ht.firstSkillList = firstSkill.spellList;
        ht.firstLearnedSkills = firstSkill.learnedSkills;
        removedLevels.add(firstSkill);
      }
    });

    return removedLevels.size > 0 ? events.filter(e => !removedLevels.has(e)) : events;
  }

  groupConsecutiveEvents (events) {
    const grouped = [];
    let pending = null;

    const canGroup = (a, b) => {
      if (a.type === 'unit' && b.type === 'unit' && a.itemId === b.itemId) return true;
      if (a.type === 'workerAssign' && b.type === 'workerAssign' &&
          !a.isInitialWorkers && !b.isInitialWorkers &&
          a.itemId === b.itemId && a.assignTarget === b.assignTarget) return true;
      return false;
    };

    events.forEach(event => {
      if (pending && canGroup(pending, event)) {
        pending.count = (pending.count || 1) + 1;
        // track training vs queued within the batch
        pending.trainingCount = (pending.trainingCount || 0) + (event.isTraining ? 0 : 1);
        pending.queuedCount = (pending.queuedCount || 0) + (event.isTraining ? 1 : 0);
        return;
      }
      if (pending) grouped.push(pending);

      const groupable = event.type === 'unit' ||
        (event.type === 'workerAssign' && !event.isInitialWorkers);
      pending = groupable ? { ...event, count: 1, trainingCount: event.isTraining ? 0 : 1, queuedCount: event.isTraining ? 1 : 0 } : null;
      if (!groupable) grouped.push(event);
    });

    if (pending) grouped.push(pending);
    return grouped;
  }

  bucketByTier (grouped, tier2Time, tier3Time) {
    const getTier = (t) => t >= tier3Time ? 3 : t >= tier2Time ? 2 : 1;
    const tiers = {
      1: { events: [], startSupply: null, startTime: 0 },
      2: { events: [], startSupply: null, startTime: tier2Time },
      3: { events: [], startSupply: null, startTime: tier3Time }
    };

    grouped.forEach(event => {
      const tier = getTier(event.gameTime);
      tiers[tier].events.push(event);
      if (!tiers[tier].startSupply) {
        tiers[tier].startSupply = { used: event.supplyUsed, max: event.supplyMax };
      }
    });

    if (grouped.length && !tiers[1].startSupply) {
      tiers[1].startSupply = { used: grouped[0].supplyUsed, max: grouped[0].supplyMax };
    }
    return tiers;
  }

  buildTierSnapshots (grouped, tier2Time, tier3Time) {
    const buildSnapshot = (upToTime) => {
      const army = {};
      const heroStatus = {};
      const workerState = { onGold: 0, onLumber: 0, onBuild: 0, total: 0 };
      const economy = { goldSpent: 0, lumberSpent: 0 };
      let lastSupply = { used: 0, max: 0 };

      grouped.forEach(event => {
        if (event.gameTime > upToTime) return;
        lastSupply = { used: event.supplyUsed, max: event.supplyMax };
        workerState.onGold = event.workersOnGold;
        workerState.onLumber = event.workersOnLumber;
        workerState.onBuild = event.workersBuilding;

        // Economy tracking
        const count = event.count || 1;
        economy.goldSpent += (event.goldCost || 0) * count;
        economy.lumberSpent += (event.lumberCost || 0) * count;

        // Hero status tracking
        if (event.type === 'heroTraining') {
          heroStatus[event.itemId] = {
            displayName: event.displayName, itemId: event.itemId,
            level: 0, status: 'training'
          };
        }
        if (event.type === 'heroComplete') {
          heroStatus[event.itemId] = {
            displayName: event.displayName, itemId: event.itemId,
            level: 1, status: 'alive'
          };
        }
        if (event.type === 'heroLevel' && heroStatus[event.itemId]) {
          heroStatus[event.itemId].level = event.level;
        }

        // Army (non-hero units only)
        if (event.type === 'unit') {
          if (!army[event.itemId]) {
            army[event.itemId] = { displayName: event.displayName, itemId: event.itemId, count: 0, armorType: event.armorType, attackType: event.attackType };
          }
          army[event.itemId].count += count;
        }
        if (event.type === 'workerAssign') {
          workerState.onLumber = event.workersOnLumber + event.ghoulsOnLumber;
          workerState.total = event.workersOnGold + workerState.onLumber + event.workersBuilding;
        }
      });

      return {
        army: Object.values(army),
        heroes: Object.values(heroStatus),
        workers: workerState,
        supply: lastSupply,
        economy
      };
    };

    const snapshots = {};
    if (tier2Time !== Infinity) snapshots[2] = buildSnapshot(tier2Time);
    if (tier3Time !== Infinity) snapshots[3] = buildSnapshot(tier3Time);
    const lastEvent = grouped[grouped.length - 1];
    const finalSnapshot = lastEvent ? buildSnapshot(Infinity) : null;
    return { snapshots, finalSnapshot };
  }

  buildProductionSummary (grouped) {
    const buildings = [];
    const units = {};
    const seen = new Set();

    grouped.forEach(event => {
      if (event.type === 'building' && !seen.has(event.itemId)) {
        seen.add(event.itemId);
        buildings.push({ itemId: event.itemId, displayName: event.displayName });
      }
      if (event.type === 'unit') {
        const c = event.count || 1;
        if (!units[event.itemId]) units[event.itemId] = { displayName: event.displayName, itemId: event.itemId, count: 0, armorType: event.armorType, attackType: event.attackType };
        units[event.itemId].count += c;
      }
      if (event.type === 'heroComplete') {
        units[event.itemId] = { displayName: event.displayName, itemId: event.itemId, count: 1, isHero: true, level: 1 };
      }
    });

    return { buildings, units: Object.values(units) };
  }

  buildTierProductionSummary (tiers, grouped) {
    const cfg = BuildOrderData.CONFIG;
    const heroes = [];
    const heroSeen = {};

    // First pass: collect heroes, track max level, and collect final spell state
    grouped.forEach(event => {
      if (event.type === 'heroComplete' && !heroSeen[event.itemId]) {
        heroSeen[event.itemId] = true;
        heroes.push({
          itemId: event.itemId,
          displayName: event.displayName,
          level: 1,
          gameTime: event.gameTime,
          isTavern: event.isTavern || false,
          spellList: [],
          learnedSkills: {}
        });
      }
      if (event.type === 'heroLevel' && heroSeen[event.itemId]) {
        const h = heroes.find(h => h.itemId === event.itemId);
        if (h && event.level > h.level) h.level = event.level;
        // Keep latest learnedSkills snapshot (cumulative) and spellList
        if (h && event.learnedSkills) h.learnedSkills = event.learnedSkills;
        if (h && event.spellList && event.spellList.length) h.spellList = event.spellList;
      }
    });

    // Second pass: per-tier buildings and units
    const tierProd = {};
    [1, 2, 3].forEach(tierNum => {
      const tierData = tiers[tierNum];
      const buildings = [];
      const units = {};
      const buildingSeen = new Set();

      if (!tierData || !tierData.events) {
        tierProd[tierNum] = { buildings: [], units: [] };
        return;
      }

      tierData.events.forEach(event => {
        if (event.type === 'building' && !buildingSeen.has(event.itemId)) {
          buildingSeen.add(event.itemId);
          buildings.push({
            itemId: event.itemId,
            displayName: event.displayName,
            isSupply: event.isSupplyBuilding || false,
            isShop: event.isShop || false
          });
        }

        if (event.type === 'unit') {
          const count = event.count || 1;
          if (!units[event.itemId]) {
            units[event.itemId] = {
              displayName: event.displayName,
              itemId: event.itemId,
              count: 0,
              firstTime: event.gameTime,
              armorType: event.armorType,
              attackType: event.attackType
            };
          }
          units[event.itemId].count += count;
        }
      });

      const sortedUnits = Object.values(units).sort((a, b) => a.firstTime - b.firstTime);
      tierProd[tierNum] = { buildings, units: sortedUnits };
    });

    return { heroes, tierProd };
  }

  tagSupplyChanges (grouped) {
    if (!grouped.length) return;
    let runUsed = grouped[0].supplyUsed || 0;
    let runMax = grouped[0].supplyMax || 0;
    let lastUsed = -1, lastMax = -1;

    for (const event of grouped) {
      runMax = Math.max(runMax, event.supplyMax || 0);

      const count = event.count || 1;
      if (event.type === 'unit' || event.type === 'heroTraining' ||
          (event.type === 'workerAssign' && !event.isInitialWorkers)) {
        runUsed += (event.foodCost || 0) * count;
      }

      event.displaySupplyUsed = runUsed;
      event.displaySupplyMax = runMax;
      event.supplyChanged = runUsed !== lastUsed || runMax !== lastMax;
      lastUsed = runUsed;
      lastMax = runMax;
    }
  }

  processBuildOrderData (player) {
    const { tierStream, race, displayName, playerColor } = player;
    const raceInfo = RaceLabels[race] || { label: '??', accent: '#8B949E' };

    const tier2Event = tierStream.find(t => t.tier === 2);
    const tier3Event = tierStream.find(t => t.tier === 3);
    const tier2Time = tier2Event ? tier2Event.gameTime : Infinity;
    const tier3Time = tier3Event ? tier3Event.gameTime : Infinity;

    const events = this.extractBoEvents(player);
    const grouped = this.groupConsecutiveEvents(events);
    this.tagSupplyChanges(grouped);
    const tiers = this.bucketByTier(grouped, tier2Time, tier3Time);
    const { snapshots, finalSnapshot } = this.buildTierSnapshots(grouped, tier2Time, tier3Time);
    const production = this.buildProductionSummary(grouped);
    const tierProduction = this.buildTierProductionSummary(tiers, grouped);

    // Expansion detection
    const hasExpansion = grouped.some(e => e.type === 'expansion');

    return { race, raceInfo, displayName, playerColor, tiers, snapshots, finalSnapshot, production, tierProduction, tier2Time, tier3Time, hasExpansion };
  }
};

window.BuildOrderData = BuildOrderData;
