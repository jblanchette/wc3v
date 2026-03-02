const assert = require('assert');
const path = require('path');

// initialize logging (console.logger must exist before parsing)
const logManager = require('../helpers/logManager');
logManager.setTestMode();
logManager.setLogger('build-order-events-test');

const { doParsing } = require('../wc3v');
const { getBuildTime, WORKER_IDS, WorkerRole, GHOUL_ID } = require('../helpers/mappings');

const REPLAY_PATH = path.join(__dirname, '..', 'replays', 'happy-vs-grubby.w3g');

// ---------------------------------------------------------------------------
// Replicate the client-side BO_CONFIG and event extraction logic for testing.
// This mirrors client/js/app.js so tests can run in Node without a browser.
// ---------------------------------------------------------------------------

const BO_CONFIG = {
  workerIds: { 'opeo': true, 'hpea': true, 'ewsp': true, 'uaco': true, 'ugho': true },
  workerForRace: { 'O': 'opeo', 'H': 'hpea', 'E': 'ewsp', 'U': 'uaco' },
  workerNames: { 'O': 'Peon', 'H': 'Peasant', 'E': 'Wisp', 'U': 'Acolyte' },
  defaultStartWorkers: { 'O': 5, 'H': 5, 'E': 5, 'U': 4 },
  defaultStartSupply: { used: 5, max: 10 },
  heroBuildTime: 55,
  tierUpgradeIds: {
    'ostr': 2, 'ofrt': 3, 'hkee': 2, 'hcas': 3,
    'unp1': 2, 'unp2': 3, 'etoa': 2, 'etoe': 3
  },
  tierUpgradeCosts: {
    'ostr': { gold: 175, lumber: 100 }, 'ofrt': { gold: 325, lumber: 190 },
    'hkee': { gold: 320, lumber: 210 }, 'hcas': { gold: 360, lumber: 210 },
    'unp1': { gold: 320, lumber: 210 }, 'unp2': { gold: 325, lumber: 230 },
    'etoa': { gold: 320, lumber: 180 }, 'etoe': { gold: 330, lumber: 200 }
  }
};

function createBoEvent (type, gameTime, supplyUsed, supplyMax, workers, extra) {
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

// Mirrors extractBoEvents from app.js — just the building + supplyComplete logic
function extractBoEvents (eventStream, race) {
  const create = createBoEvent;
  const events = [];

  // initial worker assignment
  const first = eventStream[0];
  if (first) {
    const w = first.workers || {};
    const defaults = BO_CONFIG.defaultStartSupply;
    const startWorkers = BO_CONFIG.defaultStartWorkers[race] || 5;
    events.push(create('workerAssign', 0, defaults.used, defaults.max, w, {
      displayName: 'Initial Workers',
      itemId: BO_CONFIG.workerForRace[race],
      isInitialWorkers: true,
      count: 1,
      totalWorkers: startWorkers
    }));
  }

  eventStream.forEach(event => {
    const { key, gameTime, supplyUsed, supplyMax, workers } = event;
    const w = workers || {};

    if (key === 'addBuilding') {
      const { building } = event;
      if (!building) return;
      const tierTarget = BO_CONFIG.tierUpgradeIds[building.itemId];
      const costOvr = BO_CONFIG.tierUpgradeCosts[building.itemId];
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

      if (BO_CONFIG.workerIds[unit.itemId]) {
        const assignTarget = unit.assignTarget || 'gold';
        const isTraining = unit.isTraining || false;
        // Server snapshot excludes training units — include the new worker
        const adjW = { ...w };
        if (isTraining) {
          if (unit.itemId === GHOUL_ID) {
            adjW.ghoulsOnLumber = (adjW.ghoulsOnLumber || 0) + 1;
          } else if (assignTarget === WorkerRole.LUMBER) {
            adjW.onLumber = (adjW.onLumber || 0) + 1;
          } else {
            adjW.onGold = (adjW.onGold || 0) + 1;
          }
        }
        events.push(create('workerAssign', gameTime, supplyUsed, supplyMax, adjW, {
          displayName: unit.displayName, itemId: unit.itemId,
          goldCost: unit.goldCost, lumberCost: unit.lumberCost,
          foodCost: unit.foodUsed, assignTarget, isInitialWorkers: false,
          isTraining
        }));
      } else if (unit.isHero) {
        const buildTime = unit.buildTime || BO_CONFIG.heroBuildTime;
        events.push(create('heroTraining', gameTime, supplyUsed, supplyMax, w, {
          displayName: unit.displayName, itemId: unit.itemId,
          goldCost: unit.goldCost, lumberCost: unit.lumberCost,
          foodCost: unit.foodUsed, isTavern: false, buildTime
        }));
        events.push(create('hero', gameTime + buildTime, supplyUsed, supplyMax, w, {
          displayName: unit.displayName, itemId: unit.itemId,
          foodCost: unit.foodUsed, level: 1, isTavern: false
        }));
      } else {
        events.push(create('unit', gameTime, supplyUsed, supplyMax, w, {
          displayName: unit.displayName, itemId: unit.itemId,
          goldCost: unit.goldCost, lumberCost: unit.lumberCost,
          foodCost: unit.foodUsed
        }));
      }
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

  return events;
}

// Mirrors groupConsecutiveEvents from app.js
function groupConsecutiveEvents (events) {
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
      return;
    }
    if (pending) grouped.push(pending);

    const groupable = event.type === 'unit' ||
      (event.type === 'workerAssign' && !event.isInitialWorkers);
    pending = groupable ? { ...event, count: 1 } : null;
    if (!groupable) grouped.push(event);
  });

  if (pending) grouped.push(pending);
  return grouped;
}

// =========================================================================
// Unit tests with mock data (no replay parsing needed)
// =========================================================================

function testCreateBoEvent () {
  console.log('Test: createBoEvent basic shape');

  const event = createBoEvent('building', 1000, 5, 10,
    { onGold: 3, onLumber: 2, onBuild: 1 },
    { displayName: 'Orc Burrow', itemId: 'otrb', foodProvided: 10 }
  );

  assert.strictEqual(event.type, 'building');
  assert.strictEqual(event.gameTime, 1000);
  assert.strictEqual(event.supplyUsed, 5);
  assert.strictEqual(event.supplyMax, 10);
  assert.strictEqual(event.workersOnGold, 3);
  assert.strictEqual(event.workersOnLumber, 2);
  assert.strictEqual(event.workersBuilding, 1);
  assert.strictEqual(event.displayName, 'Orc Burrow');
  assert.strictEqual(event.itemId, 'otrb');
  assert.strictEqual(event.foodProvided, 10);

  console.log('  createBoEvent shape correct ✓');
}

function testCreateBoEventDefaults () {
  console.log('Test: createBoEvent null/missing defaults');

  const event = createBoEvent('unit', 500, null, null, null, {});

  assert.strictEqual(event.supplyUsed, 0);
  assert.strictEqual(event.supplyMax, 0);
  assert.strictEqual(event.workersOnGold, 0);
  assert.strictEqual(event.workersOnLumber, 0);
  assert.strictEqual(event.workersBuilding, 0);

  console.log('  Null workers/supply default to 0 ✓');
}

function testSupplyCompleteMock () {
  console.log('Test: supply completion events generated for supply buildings');

  const mockEventStream = [
    {
      key: 'addBuilding',
      gameTime: 500,
      supplyUsed: 6,
      supplyMax: 20,
      workers: { onGold: 4, onLumber: 1, onBuild: 1 },
      building: {
        displayName: 'Orc Burrow',
        itemId: 'otrb',
        goldCost: 160,
        lumberCost: 40,
        foodUsed: 0,
        foodMade: 10,
        buildTime: 50,
        buildMechanic: 'consumed_temporary',
        isPlayerShop: false
      }
    }
  ];

  const events = extractBoEvents(mockEventStream, 'O');

  // Should have: initialWorkers + building + supplyComplete
  const building = events.find(e => e.type === 'building');
  const completion = events.find(e => e.type === 'supplyComplete');

  assert(building, 'Expected a building event');
  assert(completion, 'Expected a supplyComplete event');

  // building event at build start time (supplyMax adjusted: 20 - 10 pending = 10)
  assert.strictEqual(building.gameTime, 500);
  assert.strictEqual(building.displayName, 'Orc Burrow');
  assert.strictEqual(building.isSupplyBuilding, true);
  assert.strictEqual(building.foodProvided, 10);
  assert.strictEqual(building.supplyMax, 10,
    'Building start supplyMax should be 10 (deferred supply)');

  // completion event at start + buildTime
  assert.strictEqual(completion.gameTime, 500 + 50, 'supplyComplete should be at gameTime + buildTime');
  assert.strictEqual(completion.displayName, 'Orc Burrow');
  assert.strictEqual(completion.itemId, 'otrb');
  assert.strictEqual(completion.foodProvided, 10);
  assert.strictEqual(completion.buildingStartTime, 500);

  console.log('  Supply building creates completion event at correct time ✓');
}

function testSupplyNotPremature () {
  console.log('Test: supplyMax must NOT increase until completion event');

  // Server pre-counts supply: supplyMax jumps to 20 when burrow starts at t=500
  // But the build order display should show 10 until the completion at t=550
  const mockEventStream = [
    {
      key: 'addBuilding',
      gameTime: 500,
      supplyUsed: 6,
      supplyMax: 20,  // server already counted the +10
      workers: { onGold: 4, onLumber: 1, onBuild: 1 },
      building: {
        displayName: 'Orc Burrow',
        itemId: 'otrb',
        goldCost: 160, lumberCost: 40,
        foodUsed: 0, foodMade: 10, buildTime: 50,
        isPlayerShop: false
      }
    },
    {
      key: 'addUnit',
      gameTime: 520,
      supplyUsed: 9,
      supplyMax: 20,  // server still shows 20 (burrow under construction)
      workers: { onGold: 4, onLumber: 1, onBuild: 1 },
      unit: {
        displayName: 'Grunt',
        itemId: 'ogru',
        goldCost: 200, lumberCost: 0, foodUsed: 3, foodMade: 0,
        isHero: false, isSummon: false, isIllusion: false
      }
    },
    {
      key: 'addUnit',
      gameTime: 560,
      supplyUsed: 12,
      supplyMax: 20,
      workers: { onGold: 4, onLumber: 1, onBuild: 0 },
      unit: {
        displayName: 'Grunt',
        itemId: 'ogru',
        goldCost: 200, lumberCost: 0, foodUsed: 3, foodMade: 0,
        isHero: false, isSummon: false, isIllusion: false
      }
    }
  ];

  const events = extractBoEvents(mockEventStream, 'O');

  const building = events.find(e => e.type === 'building');
  const grunt520 = events.find(e => e.type === 'unit' && e.gameTime === 520);
  const completion = events.find(e => e.type === 'supplyComplete');
  const grunt560 = events.find(e => e.type === 'unit' && e.gameTime === 560);

  // Before completion: supplyMax should be 10 (not 20)
  assert.strictEqual(building.supplyMax, 10,
    `Building start should show supplyMax=10 (pre-construction), got ${building.supplyMax}`);
  assert.strictEqual(grunt520.supplyMax, 10,
    `Grunt at t=520 (during construction) should show supplyMax=10, got ${grunt520.supplyMax}`);

  // At completion: supplyMax should be 20
  assert.strictEqual(completion.supplyMax, 20,
    `Completion event should show supplyMax=20, got ${completion.supplyMax}`);

  // After completion: supplyMax should stay 20
  assert.strictEqual(grunt560.supplyMax, 20,
    `Grunt at t=560 (after completion) should show supplyMax=20, got ${grunt560.supplyMax}`);

  console.log('  supplyMax stays at 10 during construction, jumps to 20 at completion ✓');
}

function testSupplyNotPrematureMultipleBuildings () {
  console.log('Test: multiple supply buildings stagger correctly');

  // Two burrows: first starts at t=500 (completes t=550), second at t=530 (completes t=580)
  // Server pre-counts both immediately
  const mockEventStream = [
    {
      key: 'addBuilding',
      gameTime: 500,
      supplyUsed: 6, supplyMax: 20, // first burrow counted
      workers: { onGold: 4, onLumber: 1, onBuild: 1 },
      building: {
        displayName: 'Orc Burrow', itemId: 'otrb',
        goldCost: 160, lumberCost: 40,
        foodUsed: 0, foodMade: 10, buildTime: 50,
        isPlayerShop: false
      }
    },
    {
      key: 'addBuilding',
      gameTime: 530,
      supplyUsed: 8, supplyMax: 30, // both burrows counted
      workers: { onGold: 3, onLumber: 1, onBuild: 2 },
      building: {
        displayName: 'Orc Burrow', itemId: 'otrb',
        goldCost: 160, lumberCost: 40,
        foodUsed: 0, foodMade: 10, buildTime: 50,
        isPlayerShop: false
      }
    }
  ];

  const events = extractBoEvents(mockEventStream, 'O');

  const buildings = events.filter(e => e.type === 'building');
  const completions = events.filter(e => e.type === 'supplyComplete');

  // t=500 building: both burrows pending -> supplyMax = 20 - 10 = 10? No, second not started yet.
  // At t=500: only first burrow is pending -> supplyMax = 20 - 10 = 10
  assert.strictEqual(buildings[0].supplyMax, 10,
    `First burrow start (t=500) should show supplyMax=10, got ${buildings[0].supplyMax}`);

  // t=530 building: first burrow pending + second burrow pending -> supplyMax = 30 - 10 - 10 = 10
  assert.strictEqual(buildings[1].supplyMax, 10,
    `Second burrow start (t=530) should show supplyMax=10, got ${buildings[1].supplyMax}`);

  // t=550 first completion: only second burrow still pending -> supplyMax = 30 - 10 = 20
  // (server snapshot on completion was from t=500, supplyMax=20, but needs interpolation)
  // Actually the completion event uses the building-start snapshot. After adjustment:
  // t=550: second burrow pending (530+50=580), so subtract 10. Server had 20 at t=500.
  // Hmm, the completion event's raw supplyMax is 20 (from build start). After adjustment
  // at t=550 the second burrow (ends t=580) is still pending, but the completion event's
  // raw supplyMax only reflects the first burrow (20). The second burrow isn't in that snapshot.
  // So completion supplyMax = 20 - 0 = 20. That's actually correct!
  assert.strictEqual(completions[0].supplyMax, 20,
    `First completion (t=550) should show supplyMax=20, got ${completions[0].supplyMax}`);

  // t=580 second completion: no pending -> supplyMax should be 30
  // But raw supplyMax on this event is 30 (from t=530 snapshot). After adjustment: 30 - 0 = 30
  assert.strictEqual(completions[1].supplyMax, 30,
    `Second completion (t=580) should show supplyMax=30, got ${completions[1].supplyMax}`);

  console.log('  Multiple buildings stagger supply correctly ✓');
}

function testNoSupplyCompleteForNonSupply () {
  console.log('Test: no supplyComplete for non-supply buildings');

  const mockEventStream = [
    {
      key: 'addBuilding',
      gameTime: 300,
      supplyUsed: 5,
      supplyMax: 10,
      workers: { onGold: 5, onLumber: 0, onBuild: 0 },
      building: {
        displayName: 'Barracks',
        itemId: 'obar',
        goldCost: 180,
        lumberCost: 50,
        foodUsed: 0,
        foodMade: 0,
        buildTime: 60,
        isPlayerShop: false
      }
    }
  ];

  const events = extractBoEvents(mockEventStream, 'O');

  const completions = events.filter(e => e.type === 'supplyComplete');
  assert.strictEqual(completions.length, 0,
    'Non-supply buildings should not generate supplyComplete events');

  console.log('  Non-supply building produces no completion event ✓');
}

function testNoSupplyCompleteForTierUpgrade () {
  console.log('Test: no supplyComplete for tier upgrade buildings');

  // Town halls provide supply but tier upgrades should NOT create supplyComplete
  // (they are tracked as tierUpgrade events instead)
  const mockEventStream = [
    {
      key: 'addBuilding',
      gameTime: 5000,
      supplyUsed: 30,
      supplyMax: 40,
      workers: { onGold: 5, onLumber: 3, onBuild: 0 },
      building: {
        displayName: 'Stronghold',
        itemId: 'ostr',
        goldCost: 315,
        lumberCost: 190,
        foodUsed: 0,
        foodMade: 15,
        buildTime: 140,
        isPlayerShop: false
      }
    }
  ];

  const events = extractBoEvents(mockEventStream, 'O');

  const completions = events.filter(e => e.type === 'supplyComplete');
  assert.strictEqual(completions.length, 0,
    'Tier upgrade buildings should not generate supplyComplete events');

  const upgrades = events.filter(e => e.type === 'tierUpgrade');
  assert.strictEqual(upgrades.length, 1, 'Should have 1 tierUpgrade event');

  console.log('  Tier upgrade building skips supplyComplete ✓');
}

function testSupplyCompleteOrdering () {
  console.log('Test: supplyComplete sorted correctly among other events');

  const mockEventStream = [
    {
      key: 'addBuilding',
      gameTime: 500,
      supplyUsed: 6, supplyMax: 20,
      workers: { onGold: 4, onLumber: 1, onBuild: 1 },
      building: {
        displayName: 'Orc Burrow',
        itemId: 'otrb',
        goldCost: 160, lumberCost: 40,
        foodUsed: 0, foodMade: 10, buildTime: 50,
        isPlayerShop: false
      }
    },
    {
      key: 'addUnit',
      gameTime: 520,
      supplyUsed: 9, supplyMax: 20,
      workers: { onGold: 4, onLumber: 1, onBuild: 1 },
      unit: {
        displayName: 'Grunt',
        itemId: 'ogru',
        goldCost: 200, lumberCost: 0, foodUsed: 3, foodMade: 0,
        isHero: false, isSummon: false, isIllusion: false
      }
    },
    {
      key: 'addUnit',
      gameTime: 560,
      supplyUsed: 12, supplyMax: 20,
      workers: { onGold: 4, onLumber: 1, onBuild: 0 },
      unit: {
        displayName: 'Grunt',
        itemId: 'ogru',
        goldCost: 200, lumberCost: 0, foodUsed: 3, foodMade: 0,
        isHero: false, isSummon: false, isIllusion: false
      }
    }
  ];

  const events = extractBoEvents(mockEventStream, 'O');

  // supplyComplete at 500 + 50 = 550, so order should be:
  // initial (0), building (500), grunt (520), supplyComplete (550), grunt (560)
  const types = events.map(e => `${e.type}@${e.gameTime}`);
  const completionIdx = events.findIndex(e => e.type === 'supplyComplete');
  const grunt520Idx = events.findIndex(e => e.type === 'unit' && e.gameTime === 520);
  const grunt560Idx = events.findIndex(e => e.type === 'unit' && e.gameTime === 560);

  assert(completionIdx > grunt520Idx,
    `supplyComplete (t=550) should come after grunt (t=520): [${types.join(', ')}]`);
  assert(completionIdx < grunt560Idx,
    `supplyComplete (t=550) should come before grunt (t=560): [${types.join(', ')}]`);

  console.log('  Supply completion sorted at correct position ✓');
}

function testSupplyCompleteNotGrouped () {
  console.log('Test: supplyComplete events are not grouped with other events');

  const events = [
    createBoEvent('building', 500, 6, 20, null, {
      displayName: 'Orc Burrow', itemId: 'otrb', isSupplyBuilding: true
    }),
    createBoEvent('supplyComplete', 550, 6, 20, null, {
      displayName: 'Orc Burrow', itemId: 'otrb', foodProvided: 10
    }),
    createBoEvent('building', 600, 8, 20, null, {
      displayName: 'Orc Burrow', itemId: 'otrb', isSupplyBuilding: true
    }),
    createBoEvent('supplyComplete', 650, 8, 20, null, {
      displayName: 'Orc Burrow', itemId: 'otrb', foodProvided: 10
    })
  ];

  const grouped = groupConsecutiveEvents(events);

  const completions = grouped.filter(e => e.type === 'supplyComplete');
  assert.strictEqual(completions.length, 2,
    `Expected 2 separate supplyComplete events, got ${completions.length}`);

  // Buildings should also not be grouped (they're not in canGroup)
  const buildings = grouped.filter(e => e.type === 'building');
  assert.strictEqual(buildings.length, 2,
    `Expected 2 separate building events, got ${buildings.length}`);

  console.log('  supplyComplete events stay ungrouped ✓');
}

function testSupplyDataOnEvents () {
  console.log('Test: supply data (supplyUsed/supplyMax) available on all events');

  const mockEventStream = [
    {
      key: 'addBuilding',
      gameTime: 300,
      supplyUsed: 7, supplyMax: 20,
      workers: { onGold: 4, onLumber: 2, onBuild: 0 },
      building: {
        displayName: 'Ziggurat',
        itemId: 'uzig',
        goldCost: 150, lumberCost: 50,
        foodUsed: 0, foodMade: 10, buildTime: 50,
        isPlayerShop: false
      }
    },
    {
      key: 'addUnit',
      gameTime: 400,
      supplyUsed: 10, supplyMax: 30,
      workers: { onGold: 3, onLumber: 1, onBuild: 0 },
      unit: {
        displayName: 'Crypt Fiend',
        itemId: 'ucry',
        goldCost: 215, lumberCost: 40, foodUsed: 3, foodMade: 0,
        isHero: false, isSummon: false, isIllusion: false
      }
    }
  ];

  const events = extractBoEvents(mockEventStream, 'U');

  for (const event of events) {
    assert(typeof event.supplyUsed === 'number',
      `Event ${event.type}@${event.gameTime} missing supplyUsed`);
    assert(typeof event.supplyMax === 'number',
      `Event ${event.type}@${event.gameTime} missing supplyMax`);
    assert(event.supplyUsed >= 0, `Negative supplyUsed on ${event.type}`);
    assert(event.supplyMax >= 0, `Negative supplyMax on ${event.type}`);
  }

  // The building event at t=300 should have supplyUsed=7, supplyMax=10 (adjusted: 20-10 pending)
  const building = events.find(e => e.type === 'building');
  assert.strictEqual(building.supplyUsed, 7);
  assert.strictEqual(building.supplyMax, 10);

  // The unit event at t=400 should have supplyUsed=10, supplyMax=30
  const unit = events.find(e => e.type === 'unit');
  assert.strictEqual(unit.supplyUsed, 10);
  assert.strictEqual(unit.supplyMax, 30);

  console.log('  Supply data present and correct on all events ✓');
}

function testGetBuildTime () {
  console.log('Test: getBuildTime returns valid times for supply buildings');

  // Known supply buildings
  const supplyBuildings = [
    { id: 'otrb', name: 'Orc Burrow' },
    { id: 'uzig', name: 'Ziggurat' },
    { id: 'emow', name: 'Moon Well' },
    { id: 'hhou', name: 'Farm' }
  ];

  for (const b of supplyBuildings) {
    const time = getBuildTime(b.id);
    assert(typeof time === 'number', `getBuildTime('${b.id}') should return a number`);
    assert(time > 0, `getBuildTime('${b.id}') should be positive, got ${time}`);
    assert(time < 300, `getBuildTime('${b.id}') seems too high: ${time}s`);
    console.log(`  ${b.name} (${b.id}): ${time}s ✓`);
  }
}

// =========================================================================
// Integration test with real replay data
// =========================================================================

async function testWithReplay () {
  console.log('\n--- Integration: real replay data ---');
  console.log('Parsing happy-vs-grubby.w3g ...');
  const { players } = await doParsing(REPLAY_PATH);

  for (const id of Object.keys(players)) {
    const player = players[id];
    if (!player || player.isNeutralPlayer) continue;

    const { eventStream, race, displayName } = player;
    console.log(`\nPlayer: ${displayName} (${race})`);

    const events = extractBoEvents(eventStream, race);
    const grouped = groupConsecutiveEvents(events);

    // Count event types
    const typeCounts = {};
    for (const e of events) {
      typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
    }
    console.log('  Event types:', JSON.stringify(typeCounts));

    // TEST: Every supply building should have a matching completion
    const supplyBuildings = events.filter(e =>
      e.type === 'building' && e.isSupplyBuilding
    );
    const supplyCompletions = events.filter(e => e.type === 'supplyComplete');

    assert.strictEqual(supplyBuildings.length, supplyCompletions.length,
      `Supply buildings (${supplyBuildings.length}) != completions (${supplyCompletions.length}) for ${displayName}`);
    console.log(`  Supply buildings: ${supplyBuildings.length}, completions: ${supplyCompletions.length} ✓`);

    // TEST: Each completion's buildingStartTime matches a building event
    for (const comp of supplyCompletions) {
      const matchingBuild = supplyBuildings.find(b =>
        b.gameTime === comp.buildingStartTime && b.itemId === comp.itemId
      );
      assert(matchingBuild,
        `supplyComplete at t=${comp.gameTime} (${comp.displayName}) has no matching ` +
        `building at startTime=${comp.buildingStartTime}`);
    }
    console.log('  All completions link back to their building ✓');

    // TEST: Completion time > start time
    for (const comp of supplyCompletions) {
      assert(comp.gameTime > comp.buildingStartTime,
        `supplyComplete t=${comp.gameTime} should be after start t=${comp.buildingStartTime}`);
    }
    console.log('  All completions come after their builds ✓');

    // TEST: Supply data present on every event
    for (const e of events) {
      assert(typeof e.supplyUsed === 'number', `Missing supplyUsed on ${e.type}@${e.gameTime}`);
      assert(typeof e.supplyMax === 'number', `Missing supplyMax on ${e.type}@${e.gameTime}`);
    }
    console.log('  Supply data present on all events ✓');

    // TEST: supplyComplete not consumed by grouping
    const groupedCompletions = grouped.filter(e => e.type === 'supplyComplete');
    assert.strictEqual(groupedCompletions.length, supplyCompletions.length,
      `Grouping consumed some supplyComplete events: ` +
      `${supplyCompletions.length} -> ${groupedCompletions.length}`);
    console.log('  supplyComplete events survive grouping ✓');

    // TEST: Events are sorted by gameTime
    for (let i = 1; i < events.length; i++) {
      assert(events[i].gameTime >= events[i - 1].gameTime,
        `Events not sorted: ${events[i - 1].type}@${events[i - 1].gameTime} > ${events[i].type}@${events[i].gameTime}`);
    }
    console.log('  Events sorted by gameTime ✓');
  }
}

// =========================================================================
// Run all tests
// =========================================================================

async function runTests () {
  console.log('=== Build Order Event Tests ===\n');

  // Unit tests (mock data, no parsing)
  console.log('--- Unit tests (mock data) ---');
  testCreateBoEvent();
  testCreateBoEventDefaults();
  testSupplyCompleteMock();
  testNoSupplyCompleteForNonSupply();
  testNoSupplyCompleteForTierUpgrade();
  testSupplyCompleteOrdering();
  testSupplyCompleteNotGrouped();
  testSupplyNotPremature();
  testSupplyNotPrematureMultipleBuildings();
  testSupplyDataOnEvents();
  testGetBuildTime();

  // Integration tests (real replay)
  await testWithReplay();

  console.log('\n=== ALL BUILD ORDER EVENT TESTS PASSED ===');
}

runTests().catch(err => {
  console.error('\n=== TEST FAILED ===');
  console.error(err.message);
  process.exit(1);
});
