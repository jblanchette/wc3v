
// install allSettled polyfill

if (!Promise.allSettled) {
  Promise.allSettled = promises =>
    Promise.all(
      promises.map((promise, i) =>
        promise
          .then(value => ({
            status: "fulfilled",
            value,
          }))
          .catch(reason => ({
            status: "rejected",
            reason,
          }))
      )
    );
}

const distance = (pX, pY, qX, qY) => {
  return Math.sqrt(
    Math.pow(qX - pX, 2) +
    Math.pow(qY - pY, 2)
  );
};

////
// finds the unit closest to a given point from a list of units
// and and optional filter function
////

const closestToPoint = (x, y, units, filterFn) => {
  if (filterFn) {
    units = units.filter(filterFn);
  }

  let positions = units.map(unit => {
    return {
      unit: unit,
      distance: distance(
        x, y,
        unit.x, unit.y
      )
    };
  });

  positions.sort((a, b) => {
    return a.distance - b.distance;
  });

  const winner = positions[0];
  return winner || null;
};

////
// check if two [itemId] lists are equal
////

const isEqualItemId = (itemIdA, itemIdB) => {
  let isEqual = false;

  if (itemIdA === null && itemIdB === null) {
    // both null
    return true;
  } else if (itemIdA === null || itemIdB === null) {
    // one is null and one isn't
    return false;
  }

  // check to ensure each position in the list is equal
  for (let i = 0; i < itemIdA.length; i++) {
    if (itemIdA[i] !== itemIdB[i]) {
      return false;
    }
  }

  return true;
};


////
// helper to check if two given Unit's have equal itemId1 / itemId2 lists
////

const isEqualUnitItemId = (unitA, unitB) => {
  if (!unitA || !unitB) {
    return false;
  }
  
  return isEqualItemId(unitA.itemId1, unitB.itemId1) &&
         isEqualItemId(unitA.itemId2, unitB.itemId2);
};

////
// creates a string hash of the itemId1-2 arrays 
////

const makeItemIdHash = (itemId1, itemId2) => {
  return `[${itemId1.toString()}]-[${itemId2.toString()}]`;
};

////
// check rectangle collision
////

const isBoxCollision = (boxA, boxB) => {
  return (boxA.x < boxB.x + boxB.width  &&
          boxA.x + boxA.width > boxB.x  &&
          boxA.y < boxB.y + boxB.height &&
          boxA.y + boxA.height > boxB.y);
};

const findIndexFrom = (arr, fn, start = 0, gameTime = 0) => {
  start = Math.max(0, start);

  for (let i = start; i < arr.length; i++) {
    const curNode = arr[i];
    const nextNode = (i < arr.length - 1) ? arr[i + 1] : null;

    if (fn(curNode, nextNode, gameTime)) {
      return i;
    }
  }

  return -1;
};

const StandardStreamSearch = (record, nextRecord, gameTime) => {
  // is the gameTime before the next record in the sequence
  let isBeforeNextStep;

  if (!nextRecord) {
    // there is no next record, so this one is always our last valid one
    isBeforeNextStep = true;
  } else {
    isBeforeNextStep = (gameTime < nextRecord.gameTime);
  }

  if (gameTime >= record.gameTime && isBeforeNextStep) {
    return record;
  }
};

// Uniform Catmull-Rom interpolation between p1 and p2 with neighbors p0 and p3.
// t in [0,1]. Each point is {x, y}. Returns {x, y}.
const catmullRomXY = (p0, p1, p2, p3, t) => {
  const t2 = t * t;
  const t3 = t2 * t;
  const x = 0.5 * (
    (2 * p1.x) +
    (-p0.x + p2.x) * t +
    (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
    (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
  );
  const y = 0.5 * (
    (2 * p1.y) +
    (-p0.y + p2.y) * t +
    (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
    (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
  );
  return { x, y };
};

const Helpers = {
  distance,
  closestToPoint,
  isEqualItemId,
  isEqualUnitItemId,
  makeItemIdHash,
  isBoxCollision,
  findIndexFrom,
  StandardStreamSearch,
  catmullRomXY,

  // constants
  MS_TO_SECONDS: 0.001,
  SECONDS_TO_MS: 1000
};

window.Helpers = Helpers;
