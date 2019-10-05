
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

const Helpers = {
  distance,
  closestToPoint,
  isEqualItemId,
  isEqualUnitItemId,
  makeItemIdHash,
  isBoxCollision,

  // constants
  MS_TO_SECONDS: 0.001,
  SECONDS_TO_MS: 1000
};

window.Helpers = Helpers;
