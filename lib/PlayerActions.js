const path = require("path");

const utils = require("../helpers/utils"),
      mappings = require("../helpers/mappings");
const config = require("../config/config");
const { getAcquisitionRange } = require("../helpers/effectiveRange");
const CombatFormation = require("./CombatFormation");

//
// WC3-faithful move-command coalescing. Players spam-click; in WC3 the first
// click pathfinds and subsequent clicks to ~the same destination do NOT
// re-route the unit (the early path is unchanged) — at most the final
// precision point shifts. Re-pathing on every spam click is what produced the
// visible "spring/reposition" jitter in clusters/battles. So: if a unit is
// already walking toward a destination and the new command targets within
// this radius of it, we DON'T cancel+repath — we keep the in-flight movement
// and only refine the final point. Tuned against tools/path-sweep.js (must
// not regress ground-truth convergence).
//
const MOVE_COALESCE_RADIUS = 250;

//
// Battle reality: pros issue many move/right-click-ground orders per second
// while dancing/surrounding — far faster than a unit meaningfully changes
// course. WC3 doesn't visibly re-route on every one. So a unit already
// walking that gets another ground-move within MOVE_DEBOUNCE_MS of its last
// real repath, and whose new target is NOT a major course change (within
// MOVE_DEBOUNCE_RADIUS of where it's already heading), keeps its current
// movement and just refines the endpoint — no cancel/repath/spring. A
// genuinely large redirect always re-routes. Tuned vs tools/path-sweep.js
// (ground-truth convergence must stay ≥ ~88%).
//
const MOVE_DEBOUNCE_MS = 300;
const MOVE_DEBOUNCE_RADIUS = 900;

const { isWorkerUnit, WorkerRole, WorkerTask, BURROW_ID, BuildMechanic, GHOUL_ID } = mappings;

const Unit = require("./Unit"),
      Building = require("./Building");

const SubGroup = require("./SubGroup");

const { 
  abilityActions,
  abilityFlagNames,
  mapStartPositions,
  commonMapNames,
  mapDataByFile,
  specialBuildings
} = mappings;

// Formation offset spacing (units). WC3 uses ~48-64 unit spacing for standard units.
const FORMATION_SPACING = 56;

// Compute ring offsets around a center point for formation movement.
// Returns array of {x, y} offsets. First position is center (0,0).
function computeFormationOffsets (count) {
  if (count <= 1) return [{ x: 0, y: 0 }];

  const offsets = [{ x: 0, y: 0 }];
  let placed = 1;
  let ring = 1;

  while (placed < count) {
    const ringCount = ring * 6; // hexagonal rings: 6, 12, 18...
    const radius = FORMATION_SPACING * ring;

    for (let i = 0; i < ringCount && placed < count; i++) {
      const angle = (2 * Math.PI * i) / ringCount;
      offsets.push({
        x: Math.round(radius * Math.cos(angle)),
        y: Math.round(radius * Math.sin(angle))
      });
      placed++;
    }
    ring++;
  }

  return offsets;
}

const PlayerActions = class {

  static setItemCooldown (player, item) {
    item.setCooldownState(true);

    player.eventTimer.addEvent(
      item.cooldown * utils.SECONDS_TO_MS,
      () => { /* no-op */ },
      () => { item.setCooldownState(false); }
    );
  }

  static moveSelectedUnits (
    player,
    targetX,
    targetY,
    opts = {}
  ) {
    const { world } = player;
    const units = player.getSelectionUnits();

    // Ground-truth capture: the replay's exact commanded target + which
    // (registered) units got the order, at this gameTime. Opt-in; consumed
    // by tools/path-debug.js --verify to check simulated position/timing
    // against the authoritative replay coordinates.
    if (config.moveTrace) {
      if (!player.moveTrace) player.moveTrace = [];
      player.moveTrace.push({
        gameTime: player.eventTimer.timer.gameTime,
        targetX, targetY,
        kind: opts.kind || 'smart',   // 'move' = strict point-move; else early-stop ok
        units: units.filter(u => u && u.uuid).map(u => u.uuid)
      });
    }

    if (!player.startingPosition) {
      PlayerActions.findStartPosition(player, targetX, targetY);
    }

    // check if we have unregistered units that need actions backfilled
    if (units.length !== player.selection.units.length) {
      console.logger("checking backfill?");
      PlayerActions.backfillMoveSelection(player, targetX, targetY);
    }

    // move our registered units normally
    // units in the same position are moved as a 'group'
    // to avoid pathfinding the same route twice

    // fix units stuck at origin before pathfinding — snap to a nearby selected
    // unit's position (e.g., the hero that summoned them) or starting position
    units.forEach(unit => {
      if (unit.isBuilding) return;
      if (unit.currentX !== 0 || unit.currentY !== 0) return;
      if (unit.spawnPosition && (unit.spawnPosition.x !== 0 || unit.spawnPosition.y !== 0)) return;

      const nearby = units.find(u => u !== unit && (u.currentX !== 0 || u.currentY !== 0));
      if (nearby) {
        unit.setSpawnPosition(nearby.currentX, nearby.currentY);
      } else if (player.startingPosition) {
        unit.setSpawnPosition(player.startingPosition.x, player.startingPosition.y);
      }
    });

    // Coalesce inconsequential repeat clicks: a unit already walking toward a
    // destination within MOVE_COALESCE_RADIUS of the new target keeps its
    // current path (no cancel/repath/spring) — we only refine where it ends
    // so the latest precise click is still honoured (matches WC3 + keeps
    // ground-truth convergence). Non-move 'kinds' (attack/smart on a unit)
    // are never coalesced — those genuinely change behaviour.
    // Coalesce regardless of command kind: for an 'attack'/smart right-click
    // the attack/ability was already dispatched (doAbilityWithTargetAndObjectId)
    // BEFORE this call — here we only merge the redundant FOLLOW-UP positional
    // move so the unit doesn't snap/spring on every battle click. A genuine
    // far retarget still re-routes (fails the same-spot/debounce test below).
    const nowGT = player.eventTimer.timer.gameTime;
    const coalesced = new Set();
    {
      units.forEach(unit => {
        if (unit.isBuilding || unit.state !== 'walking') return;
        const mt = unit._moveTarget;
        if (!mt) return;
        const ddx = targetX - mt.x, ddy = targetY - mt.y;
        const distSq = (ddx * ddx) + (ddy * ddy);

        // (a) inconsequential repeat click to ~the same destination, OR
        // (b) debounced battle spam: another ground-move very soon after the
        //     last real repath that isn't a major course change.
        const sameSpot = distSq <= (MOVE_COALESCE_RADIUS * MOVE_COALESCE_RADIUS);
        const recent = unit._lastRepathTime != null &&
          (nowGT - unit._lastRepathTime) < MOVE_DEBOUNCE_MS;
        const minorChange = distSq <= (MOVE_DEBOUNCE_RADIUS * MOVE_DEBOUNCE_RADIUS);
        if (!sameSpot && !(recent && minorChange)) return;

        // keep moving; just retarget the final point to the newest click
        if (unit.walkPath && unit.walkPath.length) {
          const last = unit.walkPath[unit.walkPath.length - 1];
          unit.walkPath[unit.walkPath.length - 1] = { x: targetX, y: targetY, weight: last.weight };
        } else if (unit.moveInfo) {
          unit.moveInfo.targetX = targetX;
          unit.moveInfo.targetY = targetY;
        }
        unit._moveTarget = { x: targetX, y: targetY };
        coalesced.add(unit);
      });
    }

    const moveUnits = coalesced.size ? units.filter(u => !coalesced.has(u)) : units;

    // spring evidence: a repath issued to an already-walking unit is a
    // potential visible snap/reposition. Coalescing should cut these hard.
    if (config.moveTrace) {
      const s = player._mvStats || (player._mvStats = { total: 0, coalesced: 0, redirectMoving: 0 });
      s.total++;
      s.coalesced += coalesced.size;
      s.redirectMoving += moveUnits.filter(u => !u.isBuilding && u.state === 'walking').length;
    }

    const groups = moveUnits.reduce((acc, unit) => {
      const { currentX, currentY } = unit;
      if (currentX == null || currentY == null) {
        return acc;
      }

      // Group key. Quantise position to a coarse cell so a selected army —
      // whose units now have CONTINUOUS, slightly-different positions
      // (Project A) instead of identical stale node coords — still groups
      // into one pathfind + formation offsets + shared groupId (pack
      // movement). Exact-float keying broke packs after accurate positions.
      // Transport/air units keep a per-unit key (separate flight paths).
      const MOVE_GROUP_CELL = 256; // ~3 unit-widths; tight armies share a cell
      const posStr = unit.isTransport
        ? `air-${unit.uuid}`
        : `${Math.round(currentX / MOVE_GROUP_CELL)}-${Math.round(currentY / MOVE_GROUP_CELL)}`;

      if (!acc[posStr]) {
        // Air/transport units bypass ground pathfinder — fly direct with interpolated steps
        let walkInfo;
        if (unit.isTransport) {
          const dx = targetX - currentX;
          const dy = targetY - currentY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const stepSize = 64;  // same granularity as ground pathfinder grid cells
          const steps = Math.max(1, Math.ceil(dist / stepSize));
          const walkPath = [];
          for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            walkPath.push({ x: currentX + dx * t, y: currentY + dy * t, weight: 15 });
          }
          walkInfo = { isDifferentSpot: true, walkPath };
        } else {
          walkInfo = world.pathFinder.findPath(currentX, currentY, targetX, targetY);
        }

        acc[posStr] = {
          groupUnits: [],
          walkInfo,
          startBox: {
            minX: currentX,
            maxX: currentX,
            minY: currentY,
            maxY: currentY
          },
          endBox: {
            minX: targetX,
            maxX: targetX,
            minY: targetY,
            maxY: targetY
          }
        };
      }

      acc[posStr].groupUnits.push(unit);
      return acc;
    }, {});

    const { neutralDetectionTree, neutralGroups } = player.world;

    // ---- Combat formation (range-aware, concave, focus-fire) --------------
    //
    // For an attack order — either an attack/right-click on an enemy UNIT
    // (kind 'attack') or an attack-move to GROUND (kind 'attackground') — we
    // reconstruct where the engine would settle each unit: melee at the front,
    // ranged hanging back at their attack range on a concave that wraps the
    // enemy. Computed ONCE over the whole selected army (not per pathfinding
    // cell) so a spread-out army still forms a single coherent line.
    //
    // Critically this is gated on actually finding nearby enemies: an
    // attack-move across empty ground with no enemy in acquisition range
    // produces NO slots and falls through to the normal point-move below, so
    // strict MoveCommands and empty-map advances are completely unchanged.
    const combatOrder = (opts.kind === 'attack' || opts.kind === 'attackground');
    let attackSlots = null;
    if (combatOrder) {
      attackSlots = PlayerActions._resolveCombatFormation(
        player, world, moveUnits, targetX, targetY, opts
      );

      // Record the combat order on EVERY selected unit, not just workers.
      //
      // This used to be workers-only, which meant the client's `order`
      // corroboration source was dead for every real combat unit — measured at
      // `order 0` across an 8-replay sweep. An army that the BattleDetector
      // didn't cluster into a battle had no way to be seen as fighting, no
      // matter how plainly the player had told it to attack.
      //
      // CRITICAL: only count it when an ENEMY is actually near the target. A
      // worker right-clicking its own/neutral gold mine to harvest is ALSO a
      // RightClick-on-a-unit ('attack' kind) — without this enemy check, every
      // "go mine" order would read as "pulled to fight" and the worker would
      // never hide. isWorkerUnit covers true workers AND ghouls (lumber, but
      // not meta.worker).
      const orderSel = units.filter(u => u && !u.isBuilding);
      if (orderSel.length && world && typeof world.findEnemyUnitsNear === 'function') {
        const enemiesNear = world.findEnemyUnitsNear(
          targetX, targetY, 900, player.id, player.teamId
        );
        if (enemiesNear.length) {
          const nowGT = player.eventTimer.timer.gameTime;
          for (const u of orderSel) {
            // orderKind keeps the A-click / right-click distinction the movement
            // `kind` collapses away ('attack' vs 'smartunit', 'attackground' vs
            // 'smartground'). The client weighs them differently: clicking an
            // enemy is unambiguous, walking near one is not.
            u.recordOrder(nowGT, opts.orderKind || opts.kind, {
              x: targetX, y: targetY, targetUuid: opts.targetUuid || null
            });
            // combatOrderTimes stays worker-only and keeps its own meaning: the
            // client's declutter shows a pulled worker for 12s, a different
            // window from the attack license, so the two must not be merged.
            if (!isWorkerUnit(u)) continue;
            if (!u.combatOrderTimes) u.combatOrderTimes = [];
            const lastT = u.combatOrderTimes[u.combatOrderTimes.length - 1];
            if (lastT == null || (nowGT - lastT) > 1000) u.combatOrderTimes.push(nowGT);
          }
        }
      }
    }

    //
    // pick the closest camp when multiple tight-bounds match a point
    //
    const closestCamp = (hits, px, py) => {
      if (!hits.length) return null;
      if (hits.length === 1) return hits[0];

      let best = hits[0];
      let bestDist = Infinity;
      hits.forEach(hit => {
        const cx = (hit.minX + hit.maxX) / 2;
        const cy = (hit.minY + hit.maxY) / 2;
        const dx = px - cx;
        const dy = py - cy;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          best = hit;
        }
      });
      return best;
    };

    Object.values(groups).forEach(group => {
      const { walkInfo, groupUnits, startBox, endBox } = group;

      const startHits = neutralDetectionTree.search(startBox);
      const endHits = neutralDetectionTree.search(endBox);

      const startHit = closestCamp(startHits, startBox.minX, startBox.minY);
      const endHit = closestCamp(endHits, endBox.minX, endBox.minY);

      if (!startHit && endHit) {
        const endingGroup = neutralGroups[endHit.uuid];
        if (endingGroup) {
          endingGroup.addLocationEvent(player, 'entered');
        }
      } else if (startHit && endHit) {
        const endingGroup = neutralGroups[endHit.uuid];
        if (endingGroup) {
          endingGroup.addLocationEvent(player, 'within');
        }
      } else if (startHit && !endHit) {
        const startingGroup = neutralGroups[startHit.uuid];
        if (startingGroup) {
          startingGroup.addLocationEvent(player, 'exited');
        }
      }

      // tag units with shared groupId when moving as a group
      const groupId = groupUnits.length > 1 ? player.nextMoveGroupId() : null;

      // Combat formation slots (range-aware concave) were resolved once over
      // the whole army above; each unit either has a slot (attack orders with
      // enemies nearby) or falls through to the normal move/formation path.

      // Send a unit to its formation slot. CRITICAL: when the pathfinder
      // returns an empty route — which happens precisely when the unit is
      // ALREADY at/near its slot (a ranged unit already at range) — we must
      // NOT fall back to the group path to the raw target. That path heads
      // straight at the enemy and would drag every in-range ranged unit into
      // melee, silently defeating the whole feature. Instead: hold if already
      // there, else issue a short direct hop to the slot.
      const moveToSlot = (unit, slot) => {
        const wi = world.pathFinder.findPath(unit.currentX, unit.currentY, slot.x, slot.y);
        if (wi.walkPath.length) {
          unit.moveTo(world, wi, slot.x, slot.y);
          return;
        }
        const dx = slot.x - unit.currentX, dy = slot.y - unit.currentY;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (config.debugFormation) {
          const s = player._formApply || (player._formApply = { applied: 0, emptyPath: 0 });
          s.emptyPath++;
        }
        if (d < 16) return;   // already at the slot — hold position
        unit.moveTo(world, { isDifferentSpot: true, walkPath: [{ x: slot.x, y: slot.y, weight: 15 }] },
          slot.x, slot.y);
      };

      if (groupUnits.length <= 1 || groupUnits[0].isTransport) {
        // single unit or air unit — use shared walkInfo directly
        groupUnits.forEach(unit => {
          unit.currentGroupId = groupId;
          if (attackSlots && attackSlots.has(unit)) {
            if (config.debugFormation) {
              const s = player._formApply || (player._formApply = { applied: 0, emptyPath: 0 });
              s.applied++;
            }
            moveToSlot(unit, attackSlots.get(unit));
          } else {
            unit.moveTo(world, walkInfo, targetX, targetY);
          }
        });
      } else {
        // multiple ground units — apply formation offsets so they fan out
        const offsets = computeFormationOffsets(groupUnits.length);
        groupUnits.forEach((unit, idx) => {
          unit.currentGroupId = groupId;
          // Attack-kind: per-unit slot from the concave arc (range-aware).
          if (attackSlots && attackSlots.has(unit)) {
            if (config.debugFormation) {
              const s = player._formApply || (player._formApply = { applied: 0, emptyPath: 0 });
              s.applied++;
            }
            moveToSlot(unit, attackSlots.get(unit));
            return;
          }
          if (idx === 0) {
            // lead unit takes the original path
            unit.moveTo(world, walkInfo, targetX, targetY);
          } else {
            const offset = offsets[idx];
            const offsetTargetX = targetX + offset.x;
            const offsetTargetY = targetY + offset.y;
            let unitWalkInfo = world.pathFinder.findPath(
              unit.currentX, unit.currentY, offsetTargetX, offsetTargetY
            );
            // fall back to shared path if offset target produced empty path
            if (!unitWalkInfo.walkPath.length && walkInfo.walkPath.length) {
              unitWalkInfo = { isDifferentSpot: walkInfo.isDifferentSpot, walkPath: walkInfo.walkPath.slice() };
            }
            unit.moveTo(world, unitWalkInfo, offsetTargetX, offsetTargetY);
          }
        });
      }
    });

    // detect workers being sent outside the base area (scouting)
    if (!opts.skipScoutDetection) {
      units.forEach(unit => {
        if (isWorkerUnit(unit)) {
          player.checkScoutDetection(unit, targetX, targetY);
        }
      });
    }
  }

  // guess the players starting position
  // based on the closest one to their first movement

  static findStartPosition (player, targetX, targetY) {
    const { mapName } = player.gameDataMap;
    let baseMapName = path.basename(mapName);

    baseMapName = baseMapName.trim();
    baseMapName = baseMapName.replace(new RegExp(' ', 'g'), "");

    // strip W3C numbered prefix pattern: "{num}_w3c_{date}_{time}_" → just the map name
    const w3cPrefixMatch = baseMapName.match(/^\d+_w3c_\d+_\d+_(.+)$/);
    const strippedMapName = w3cPrefixMatch ? w3cPrefixMatch[1] : baseMapName;

    let startPositions;

    if (mapStartPositions[baseMapName]) {
      startPositions = mapStartPositions[baseMapName];
    } else if (strippedMapName !== baseMapName && mapStartPositions[strippedMapName]) {
      startPositions = mapStartPositions[strippedMapName];
    } else {
      // auto detect the map name from common names for the map
      // TODO: probably move this into setup / init

      console.logger("auto detecting common map name from detected baseMapName: ", baseMapName);

      const searchTarget = strippedMapName.toLowerCase();

      const commonMapName = Object.keys(commonMapNames).find(mapKey => {
        const mapItemLower = commonMapNames[mapKey].toLowerCase();

        if (searchTarget.indexOf(mapItemLower) !== -1) {
          return mapKey;
        }
      });

      startPositions = mapStartPositions[commonMapName];

      // fallback: match against mapDataByFile names (handles versioned FLO/W3C filenames)
      if (!startPositions) {
        const mapDataKey = Object.keys(mapDataByFile).find(key => {
          const searchName = mapDataByFile[key].name.toLowerCase();
          if (searchTarget.indexOf(searchName) !== -1) {
            return true;
          }
          // try base name without version suffix
          const baseSearchName = searchName.replace(/[_-]v[\d._-]+$/, '');
          const baseTarget = searchTarget.replace('.w3x', '').replace(/[_-]v[\d._-]+$/, '');
          return baseSearchName.length > 3 && baseTarget === baseSearchName;
        });

        if (mapDataKey) {
          startPositions = mapStartPositions[mapDataKey];
        }
      }
      console.logger("auto detect result: ", commonMapName, "start pos: ", startPositions);
    }
      
    if (!startPositions) {
      console.error("unrecognized map: unable to register start positions", baseMapName);
      throw Error("unrecognized map");
    }

    let positions = Object.keys(startPositions).map(spotId => {
      const startPosition = startPositions[spotId];
      const { x, y } = startPosition;

      return {
        startPosition: startPosition,
        distance: utils.distance(
          targetX, targetY,
          x, y
        )
      };
    });

    positions.sort((a, b) => {
      return a.distance - b.distance;
    });

    const winner = positions[0];
    const { startPosition } = winner;
    const { x, y } = startPosition;

    player.startingPosition = startPosition;

    // Place + stamp starting buildings (the town hall) FIRST, before the
    // starting workers take their spawn positions, so snap-to-free pushes the
    // workers out of the hall footprint. Starting buildings are added with
    // ignoreEvent=true (Player.setupInitialUnits), which skips the
    // addPlayerBuilding stamp, and melee WPM data does NOT bake the town-hall
    // footprint — without this, A* gives workers line-of-sight straight through
    // the hall (e.g. an acolyte clipping through the Necropolis on its way back
    // to the gold mine).
    player.units.forEach(unit => {
      if (!unit.isBuilding) return;
      unit.setSpawnPosition(x, y);
      player.stampBuildingIntoWorld(unit);
    });
    player.units.forEach(unit => {
      if (unit.isBuilding) return;
      unit.setSpawnPosition(x, y);
    });
  }

  static backfillMoveSelection (
    player,
    targetX,
    targetY
  ) {
    const { gameTime } = player.eventTimer.timer;
    let backfillUnits = player.getSelectionUnits(true);

    player.possibleSelectList = player.possibleSelectList.filter(possibleUnit => {

      const removedUnit = backfillUnits.find(backfillUnit => {
        if (utils.isEqualItemId(backfillUnit.itemId1, possibleUnit.itemId1) &&
            utils.isEqualItemId(backfillUnit.itemId2, possibleUnit.itemId2)) {

            possibleUnit.backfill.push({
              action: "moveTo",
              target: {
                x: targetX,
                y: targetY
              },
              gameTime: gameTime
            });

            // filter out of the backfill unit list now that we've found the unit
            return true;
        }

        // keep searching for the unit to backfill
        return false;
      });

      return removedUnit ? false : true;
    });
  }

  static destroyUnit (
    player,
    destroyedUnit
  ) {
    // preserve destroyed summons for client playback
    if (destroyedUnit.summonDuration && destroyedUnit.summonDuration > 0) {
      destroyedUnit.destroyedAt = player.eventTimer.timer.gameTime;
      player.destroyedSummons.push(destroyedUnit);
    }

    // Drop from cross-player registry so BattleDetector won't resolve stale ids.
    if (player.world) {
      player.world.unregisterUnit(destroyedUnit);
    }

    player.units = player.units.filter(unit => {
      return !(destroyedUnit.uuid === unit.uuid);
    });

    player.possibleSelectList = player.possibleSelectList.filter(possibleUnit => {
      const unit = { itemId1: possibleUnit.itemId1, itemId2: possibleUnit.itemId2 };
      return !utils.isEqualUnitItemId(destroyedUnit, unit);
    });

    const selectionStartLen = player.selection.units.length;
    player.selection.units = player.selection.units.filter(unit => {
      return !utils.isEqualUnitItemId(unit, destroyedUnit);
    });

    if (selectionStartLen !== player.selection.units.length) {
      player.selection.hasDestroyedSummon = true;
    }

    Object.keys(player.groupSelections).forEach(groupId => {
      if (!player.groupSelections[groupId]) {
        return;
      }
      
      const group = player.groupSelections[groupId];
      const groupStartLen = group.units.length;
      group.units = group.units.filter(unit => {
        return !utils.isEqualUnitItemId(unit, destroyedUnit);
      });

      if (groupStartLen !== group.units.length) {
        group.hasDestroyedSummon = true;
        group.destroyedUnits.push(destroyedUnit);
      }
    });
  }

  static handleSummonDestroy (
    player,
    summonUnit,
    snapshot
  ) {
    return () => {
      if (summonUnit.itemId1 === null && summonUnit.objectId1 === null) {
        player.reduceParseConfidence('Major');

        const currentTime = player.eventTimer.timer.gameTime;
        const targetSpawnTime = currentTime - (summonUnit.summonDuration * utils.SECONDS_TO_MS);
        const currentSnapshot = player.getUnitSnapshot();

        const freshUnits = currentSnapshot.units.filter(unit => {
          if (unit.isRegistered) {
            return false;
          }

          if (unit.itemId !== summonUnit.itemId) {
            return false;
          }

          const inOtherGroup = snapshot.units.find(snapUnit => {
            return utils.isEqualUnitItemId(unit, snapUnit);
          });

          return (inOtherGroup === null || inOtherGroup === undefined);
        });

        const timeBuffer = (summonUnit.summonDuration * utils.SECONDS_TO_MS);
        const timeCandidates = freshUnits.sort((a, b) => {
          return (a.spawnTime - targetSpawnTime) -
                 (b.spawnTime - targetSpawnTime);
        })
        .filter(unit => {
          return Math.abs(unit.spawnTime - targetSpawnTime) < timeBuffer;
        });

        if (timeCandidates.length) {
          const choice = timeCandidates[0];

          summonUnit.itemId1 = choice.itemId1;
          summonUnit.itemId2 = choice.itemId2;

          PlayerActions.destroyUnit(player, summonUnit);
          return;
        } else if (timeCandidates.length === 0) {
          console.logger("WARNING - no unreg summon time candidates... assume this unit never did anything");

          player.reduceParseConfidence('Minor');
        } else {
          console.logger("CRITICAL - unable to find any units when destroying");
          player.reduceParseConfidence('Critical');
        }
      }

      PlayerActions.destroyUnit(player, summonUnit);
    }
  }

  static doAbilityWithTargetAndObjectId (
    player,
    focusUnit,
    objectId1,
    objectId2,
    targetX,
    targetY
  ) {

    if (objectId1 == 4294967295 && objectId2 == 4294967295) {
      // clicked ground
      console.logger(`unit ${focusUnit.displayName} clicked/casted/attacked on GROUND`);
      //focusUnit.clearMoveInfo();
      return;
    }

    if (objectId1 != objectId2) {
      console.logger(`unit ${focusUnit.displayName} clicked/casted/attacked other unit`);
      return;
    }

    let foundUnit = player.world.findNeutralByObjectIds(objectId1, objectId2);
    if (!foundUnit) {
      const potentialUnit = player.world.findPossibleNeutralUnitByPosition(targetX, targetY);
      if (potentialUnit) {
        console.logger(`registering neutral unit ${potentialUnit.displayName} to object ids [ ${objectId1}, ${objectId2}]`);
        potentialUnit.registerObjectIds(objectId1, objectId2);

        // reset ref for shared logic below
        foundUnit = potentialUnit;
      }
    }
      
    // found neutral unit always registered at this point
    if (foundUnit) {
      console.logger(`unit ${focusUnit.displayName} right clicked neutral ${foundUnit.displayName}`);

      if (foundUnit.neutralGroupId) {
        const neutralGroup = player.world.neutralGroups[foundUnit.neutralGroupId];

        if (neutralGroup) {
          neutralGroup.addPlayerEvent(player, player.getSelectionUnits(), focusUnit);
        }
      }

      // track workers being sent to gold mine (per-unit state; aggregates are computed)
      // note: only meta.worker units can mine gold (ghouls cannot)
      if (foundUnit.isGoldmine) {
        const { gameTime } = player.eventTimer.timer;
        const workers = player.getSelectionUnits().filter(u => u.meta.worker);
        workers.forEach(unit => {
          unit.setWorkerRole(WorkerRole.GOLD, gameTime, true);
        });
      }

      if (foundUnit.isBuilding) {
        console.logger(`unit ${focusUnit.displayName} interacted with building ${foundUnit.displayName}`);
      }
    }

    // check if target is player's own building (for burrow/repair detection)
    if (!foundUnit) {
      const ownUnit = player.findUnitByObjectId(objectId1, objectId2);
      if (!ownUnit && player.world.findTreeNear && player.world.findTreeNear(targetX, targetY)) {
        // Worker right-click on a TREE — a static destructable, not a neutral
        // unit, so every lookup above misses it. This is a lumber-harvest order,
        // the one common harvest command the parser used to drop. Acolytes can't
        // harvest lumber; ghouls + meta.worker units (peon/peasant/wisp) can.
        // Mark confident so the viewer shows/animates them — a spawn-default
        // lumber role (e.g. an idle ghoul) stays unconfident and hidden.
        const { gameTime } = player.eventTimer.timer;
        const harvesters = player.getSelectionUnits().filter(u =>
          (u.meta && u.meta.worker && u.itemId !== 'uaco') || u.itemId === GHOUL_ID);
        harvesters.forEach(unit => unit.setWorkerRole(WorkerRole.LUMBER, gameTime, true));
      } else if (ownUnit && ownUnit.isBuilding) {
        const selectedWorkers = player.getSelectionUnits().filter(u => isWorkerUnit(u));
        if (ownUnit.itemId === BURROW_ID) {
          // Orc peon entering burrow — temporary state, primaryRole unchanged
          selectedWorkers.forEach(unit => {
            player._traceTask(unit, WorkerTask.BURROW, 'burrow');
            unit.currentTask = WorkerTask.BURROW;
          });
        } else if (selectedWorkers.length > 0 && selectedWorkers[0].itemId === 'hpea') {
          if (ownUnit.buildState === 1 && ownUnit.builderWorkers) {
            // Human peasant joining building under construction
            selectedWorkers.forEach(unit => {
              if (!ownUnit.builderWorkers.includes(unit)) {
                unit.consumeForBuilding(ownUnit, BuildMechanic.BUILDER);
                ownUnit.builderWorkers.push(unit);
              }
              player._traceTask(unit, WorkerTask.BUILD, 'peasantJoinBuild');
              unit.currentTask = WorkerTask.BUILD;
              // visible on-site builder — closed by the building's onComplete
              // forEach (it iterates builderWorkers, which now includes joiners)
              unit.openBuildWindow(player.eventTimer.timer.gameTime);
            });
          } else {
            // Human peasant repairing building — temporary state, primaryRole unchanged
            selectedWorkers.forEach(unit => {
              player._traceTask(unit, WorkerTask.REPAIR, 'repair');
              unit.currentTask = WorkerTask.REPAIR;
            });
            // Stamp the ORDER on the building being repaired, so the viewer can
            // show a repair marker over it. Order timestamps, not a start/end
            // window: repair runs until the building is full or the worker is
            // re-tasked, and the replay records neither, so inventing an `end`
            // would be a guess dressed up as data. The client renders a fixed
            // window after each order, the same convention combatOrderTimes and
            // UnitBehavior's ORDER_WINDOW_MS already use. Deduped at 1s like
            // combatOrderTimes — a repair order is usually several clicks.
            if (selectedWorkers.length > 0) {
              const nowGT = player.eventTimer.timer.gameTime;
              if (!ownUnit.repairOrderTimes) ownUnit.repairOrderTimes = [];
              const lastT = ownUnit.repairOrderTimes[ownUnit.repairOrderTimes.length - 1];
              if (lastT == null || (nowGT - lastT) > 1000) ownUnit.repairOrderTimes.push(nowGT);
            }
          }
        }
      }
    }

  }

  static checkUnitBackfill (
    player,
    backfillUnit
  ) {
    player.possibleSelectList = player.possibleSelectList.filter(possibleUnit => {
      if (utils.isEqualUnitItemId(backfillUnit, possibleUnit)) {
        const { backfill } = possibleUnit;

        backfillUnit.performBackfill(backfill);
        return false; // remove from list
      }

      return true;
    });
  } 

  static selectSubGroupWithNoKnownsUnregistered (
    unregisteredUnit,
    player,
    fixedItemId, 
    itemId1, 
    itemId2,
    objectId1,
    objectId2
  ) {
    // re-assign the objectIds1-2 / itemIds1-2
    // because we're now certain for at least this unit
    let existingUnits = player.units.filter(unit => {
      return unit.itemId === fixedItemId &&
             unit.objectId1 === null;
    });

    // only one of these units is known to exist
    // so we know to update it
    if (existingUnits.length === 1) {
      let existingUnit = existingUnits[0];
      existingUnit.registerUnit(fixedItemId, objectId1, objectId2);
      existingUnit.registerItemIds(itemId1, itemId2);

      PlayerActions.checkUnitBackfill(player, existingUnit);
    } else if (existingUnits.length > 1) {

      // multiple units found
      // if we found a hero, check illusions
      // if we found a non-hero unit, register

      existingUnits.forEach(eu => {
        eu.printUnit();
      });

      if (unregisteredUnit.meta.hero) {
        let heroUnits = player.units.filter(unit => {
          return (
            unit.itemId === fixedItemId &&
            unit.isIllusion === unregisteredUnit.isIllusion
          );
        });

        console.logger("CRITICAL - found unregistered hero unit with select sub and no knowns");
        player.reduceParseConfidence('Critical');
        return;
      }

      if (unregisteredUnit.isUnit || unregisteredUnit.isBuilding) {
        unregisteredUnit.registerUnit(fixedItemId, objectId1, objectId2);
        unregisteredUnit.registerItemIds(itemId1, itemId2);
        unregisteredUnit.spawning = false;
        unregisteredUnit.selected = true;
        PlayerActions.checkUnitBackfill(player, unregisteredUnit);
      } else {
        console.logger("CRITICAL - did nothing????");
        player.reduceParseConfidence('Critical');
        return;
      }

    } else {
      console.logger("WARNING: registering unit with unknown fixedItemId: ", fixedItemId);
      player.reduceParseConfidence('Major');

      unregisteredUnit.registerUnit(fixedItemId, objectId1, objectId2);
      unregisteredUnit.registerItemIds(itemId1, itemId2);
      unregisteredUnit.spawning = false;
      unregisteredUnit.selected = true;

      PlayerActions.checkUnitBackfill(player, unregisteredUnit);
      player.unregisteredUnitCount--;
    }
    
    player.assignKnownUnits();
    player.updatingSubgroup = false;
  }

  //
  // Materialise an illusion instance (Mirror Image, etc.). Called from
  // selectSubgroup when a NEW instance handle of a hero type appears and that
  // hero has an open illusion window (see Player.registerIllusionCast). Returns
  // the created illusion unit, or null if this isn't an illusion case.
  //
  // The illusion is a fully registered unit with its own object handle, so its
  // movement/path build from the ordinary move-order flow — we are NOT faking
  // a position. It just carries isIllusion so the client renders it distinctly
  // and the combat/supply/BO layers skip it.
  //
  static tryResolveIllusion (player, fixedItemId, itemId1, itemId2, objectId1, objectId2) {
    const unitInfo = mappings.getUnitInfo(fixedItemId);
    if (!unitInfo || !unitInfo.meta || !unitInfo.meta.hero) return null;
    if (!player.hasActiveIllusionWindow(fixedItemId)) return null;

    // Require a real, alive, registered instance of this hero type with a
    // DIFFERENT handle. If the only instance is this very handle, it's the real
    // hero (or a legitimate revive) — never an illusion.
    const realHero = player.units.find(u =>
      u && u.itemId === fixedItemId && u.isRegistered && !u.isIllusion && !u._destroyed &&
      (u.objectId1 !== objectId1 || u.objectId2 !== objectId2)
    );
    if (!realHero) return null;

    const window = player._illusionWindows[fixedItemId];

    const illusion = new Unit(player.eventTimer, null, null, fixedItemId, false);
    illusion.isIllusion = true;
    illusion.registerItemIds(itemId1, itemId2);
    illusion.registerUnit(fixedItemId, objectId1, objectId2);
    illusion.spawning = false;
    illusion.selected = true;

    player.addPlayerUnit(illusion);
    player.unregisteredUnitCount++;

    // addPlayerUnit assigns a hero spellList from the type — clear it: an
    // illusion owns no abilities and the client hero spell-icon loader would
    // otherwise preload icons it never shows.
    illusion.spellList = [];
    illusion.levelStream = [];

    // Spawn the image on the caster (where Mirror Image creates them). Its real
    // path then builds from the orders that follow. Guard against an unpinned
    // hero (currentX/Y still 0) so we don't anchor it at the map origin.
    if (realHero.currentX !== 0 || realHero.currentY !== 0) {
      illusion.setSpawnPosition(realHero.currentX, realHero.currentY);
    }

    // Expire ~duration after we first see the image. We can't attribute each
    // image to a specific cast when casts overlap, and the player controls an
    // image right after casting, so the image's first-observed time is the best
    // available anchor — and it keeps the lifespan positive and ~correct.
    const durationMs = (window && window.durationMs) || 60000;
    illusion.destroyedAt = illusion.spawnTime + durationMs;

    player._consumeIllusionSlot(fixedItemId);

    PlayerActions.checkUnitBackfill(player, illusion);

    // Make this instance the active selection so subsequent orders attribute
    // to the illusion, not the real hero.
    if (!utils.isItemIdInList(player.selection.units, itemId1, itemId2)) {
      player.selection.addUnit(itemId1, itemId2);
    }
    PlayerActions.setSelectionByItemId(player, itemId1, itemId2);

    console.logger("resolved illusion instance:", fixedItemId,
      "obj", objectId1, objectId2, "remaining slots:", window ? window.slots : 0);

    return illusion;
  }

  static selectSubGroupWithNoKnowns (
    player,
    fixedItemId,
    itemId1,
    itemId2,
    objectId1,
    objectId2
  ) {
    // look for a unit by the itemId to maybe register
    let unregisteredUnit = player.findUnregisteredUnitByItemId(fixedItemId);
    if (unregisteredUnit) {
      // subGroup 2
      PlayerActions.selectSubGroupWithNoKnownsUnregistered(
        unregisteredUnit,
        player,
        fixedItemId, 
        itemId1, 
        itemId2,
        objectId1,
        objectId2
      );

      PlayerActions.setSelectionByItemId(player, itemId1, itemId2);
      return;
    }

    const unitInfo = mappings.getUnitInfo(fixedItemId);
    let existingUnits = player.units.filter(unit => {
      return unit.itemId === fixedItemId;
    });

    const heroIllusionCheck = (unitInfo.meta.hero && existingUnits.length > 1);

    // only one of these units is known to exist
    // so we know to update it
    if (existingUnits.length === 1 || heroIllusionCheck) {
      let existingUnit = existingUnits[0];
      if (existingUnit.meta.hero) {
        if (heroIllusionCheck) {
          // multiple heroes of same type exist — this is a true illusion
          console.logger("WARNING - Illusion of hero detected.");

          player.printUnits();

          let newUnit = new Unit(player.eventTimer, null, null, fixedItemId, false);
          newUnit.registerUnit(fixedItemId, objectId1, objectId2);
          newUnit.registerItemIds(itemId1, itemId2);

          newUnit.isIllusion = true;

          // illusions spawn at the original hero's location
          const originalHero = existingUnits[0];
          if (originalHero.currentX !== 0 || originalHero.currentY !== 0) {
            newUnit.setSpawnPosition(originalHero.currentX, originalHero.currentY);
          }

          PlayerActions.checkUnitBackfill(player, newUnit);

          player.addPlayerUnit(newUnit);
          player.unregisteredUnitCount++;

          PlayerActions.setSelectionByItemId(player, itemId1, itemId2);
          return;
        }

        // single hero with changed net tag (revived hero gets new IDs) — re-register
        console.logger("Re-registering hero with new net tag:", existingUnit.displayName);
        existingUnit.registerUnit(fixedItemId, objectId1, objectId2);
        existingUnit.registerItemIds(itemId1, itemId2);

        PlayerActions.checkUnitBackfill(player, existingUnit);
        PlayerActions.setSelectionByItemId(player, itemId1, itemId2);
        return;
      }

      // if existing unit already has different objectIds, this is a distinct unit of the same type
      // (e.g., a second ziggurat) — create a new one instead of re-registering
      if (existingUnit.isRegistered &&
          (existingUnit.objectId1 !== objectId1 || existingUnit.objectId2 !== objectId2)) {
        if (unitInfo.isBuilding) {
          let building = new Building(player.eventTimer, null, null, fixedItemId, false);
          building.registerUnit(fixedItemId, objectId1, objectId2);
          building.registerItemIds(itemId1, itemId2);

          player.estimateBuildingPosition(building);
          PlayerActions.checkUnitBackfill(player, building);
          player.addPlayerBuilding(building);
          PlayerActions.setSelectionByItemId(player, itemId1, itemId2);
        } else {
          let newUnit = new Unit(player.eventTimer, null, null, fixedItemId, false);
          newUnit.registerUnit(fixedItemId, objectId1, objectId2);
          newUnit.registerItemIds(itemId1, itemId2);

          player.addPlayerUnit(newUnit);
          player.unregisteredUnitCount++;

          PlayerActions.checkUnitBackfill(player, newUnit);
          PlayerActions.setSelectionByItemId(player, itemId1, itemId2);
        }
      } else {
        existingUnit.registerUnit(fixedItemId, objectId1, objectId2);
        existingUnit.registerItemIds(itemId1, itemId2);

        PlayerActions.checkUnitBackfill(player, existingUnit);
        PlayerActions.setSelectionByItemId(player, itemId1, itemId2);
      }
    } else {
      // possibly spawned unit was selected?
      const possibleUnit = mappings.getUnitInfo(fixedItemId);
      if (possibleUnit.isUnit) {
        console.logger(1, "Selected a spawned unit", possibleUnit.displayName);

        if (possibleUnit.meta.hero) {
          console.logger("WARNING - for some reason a hero is bad here?");
          console.logger(`WARNING - existing unit length: ${existingUnits.length} illu check: ${heroIllusionCheck}`);
          console.logger(`WARNING - existing units: ${existingUnits}`);
          player.printUnits();

          player.reduceParseConfidence('Minor');
        }

        let newUnit = new Unit(player.eventTimer, null, null, fixedItemId, false);
        newUnit.registerItemIds(itemId1, itemId2);
        newUnit.registerUnit(fixedItemId, objectId1, objectId2);

        player.addPlayerUnit(newUnit);
        player.unregisteredUnitCount++;

        PlayerActions.checkUnitBackfill(player, newUnit);
        PlayerActions.setSelectionByItemId(player, itemId1, itemId2);
      } else if (possibleUnit.isBuilding) {
        let building = new Building(player.eventTimer, null, null, fixedItemId, false);
        building.registerUnit(fixedItemId, objectId1, objectId2);
        building.registerItemIds(itemId1, itemId2);

        if (fixedItemId === specialBuildings.Tavern) {
          // set the tavern to a unique position to avoid false positives on other checks
          building.currentX = -1.11;
          building.currentY = 1.11;
        } else {
          player.estimateBuildingPosition(building);
        }

        PlayerActions.checkUnitBackfill(player, building);
        player.addPlayerBuilding(building);
        PlayerActions.setSelectionByItemId(player, itemId1, itemId2);
      } else {
        console.logger("WARNING - Unknown action performed: ", fixedItemId);
        player.reduceParseConfidence('Minor');
      }
    }
  }
 
  static registerSubGroupFocusUnit (
    player, 
    unit, 
    fixedItemId, 
    itemId1, 
    itemId2,
    objectId1,
    objectId2
  ) {
    PlayerActions.setSelectionByItemId(player, itemId1, itemId2);

    if (unit.isRegistered) {
      if (unit.objectId1 !== objectId1 || unit.objectId2 !== objectId2) {
        // we tried to registered the wrong objectId1-2 pairs
        player.reduceParseConfidence('Critical');
        return;
      }

      player.possibleSelectList = player.possibleSelectList.filter(selectionUnit => {
        const foundSelectionUnit = (
          utils.isEqualItemId(selectionUnit.itemId1, itemId1) &&
          utils.isEqualItemId(selectionUnit.itemId2, itemId2)
        );

        return !foundSelectionUnit;
      });

      return;
    }

    unit.registerUnit(fixedItemId, objectId1, objectId2);
    unit.registerItemIds(itemId1, itemId2);
    unit.spawning = false;
    unit.selected = true;

    PlayerActions.checkUnitBackfill(player, unit);

    player.updatingSubgroup = false;
    player.assignKnownUnits();
  }

  static registerTabSwitch (
    player,
    firstGroupUnit,
    newlyRegisteredUnit,
    fixedItemId,
    itemId1,
    itemId2,
    objectId1,
    objectId2
  ) {
    const badlyDestroyedUnitIndex = player.selection.destroyedUnits.findIndex(dunit => {
      return (dunit.objectId1 === objectId1 &&
              dunit.objectId2 === objectId2);
    });
    const badlyDestroyedUnit = player.selection.destroyedUnits[badlyDestroyedUnitIndex];

    if (badlyDestroyedUnit) {
      console.logger("WARNING - found badlyDestroyedUnit");
      player.reduceParseConfidence('Minor');

      const unregSwitchUnit = player.findUnregisteredUnitByItemId(fixedItemId);
      if (unregSwitchUnit) {
        // detected badly switched unit... reg with old values
        unregSwitchUnit.registerItemIds(badlyDestroyedUnit.itemId1, badlyDestroyedUnit.itemId2);
        unregSwitchUnit.registerUnit(fixedItemId, badlyDestroyedUnit.objectId1, badlyDestroyedUnit.objectId2);
        
        // update selection artifically
        player.selection.addUnit(
          unregSwitchUnit.itemId1,
          unregSwitchUnit.itemId2
        );

        PlayerActions.destroyUnit(player, badlyDestroyedUnit);
        player.selection.setSelectionIndex(0);

        return;
      } else {
        console.logger("WARNING - unable to find unreg itemId for badlyDestroyedUnit");
        player.reduceParseConfidence('Major');
      }
    }

    const unitInfo = mappings.getUnitInfo(fixedItemId);
    const switchedUnit = player.findUnitByObjectId(objectId1, objectId2);

    if (switchedUnit && switchedUnit.isRegistered) {
      if (!utils.isItemIdInList(player.selection.units, switchedUnit.itemId1, switchedUnit.itemId2)) {
        
        // we switched to a known unit but it wasn't in the selection for some reason,
        // artifically assign it in the selection and reduce confidence
        player.selection.clearGroup();
        player.selection.addUnit(switchedUnit.itemId1, switchedUnit.itemId2);

        PlayerActions.setSelectionByItemId(
          player, 
          switchedUnit.itemId1,
          switchedUnit.itemId2
        );

        player.reduceParseConfidence('Major');
        return;
      }
    }

    let finalSwitchedUnit;
    const { setFromHotkey, hasDestroyedSummon } = player.selection;

    if (switchedUnit) {
      switchedUnit.registerObjectIds(objectId1, objectId2);
      finalSwitchedUnit = switchedUnit;
    } else {
      const switchUnitByItemIds = player.findUnregisteredUnitByItemIds(itemId1, itemId2);
      if (switchUnitByItemIds && switchUnitByItemIds.itemId === fixedItemId) {
        switchUnitByItemIds.registerUnit(fixedItemId, objectId1, objectId2);
        finalSwitchedUnit = switchUnitByItemIds;

        player.reduceParseConfidence('Minor');
      } else {

        if (!newlyRegisteredUnit) {
          // try to find a unit by itemId
          const switchUnitByItemId = player.findUnregisteredUnitByItemId(fixedItemId);

          if (switchUnitByItemId) {
            let detectedUnregistered = false;
            if (switchUnitByItemId.itemId1 === null &&
              player.selection.units.length === 1) {
              const selectionUnit = player.selection.units[0];
              const existingBadUnit = player.findUnit(selectionUnit.itemId1, selectionUnit.itemId2);

              if (existingBadUnit) {
                existingBadUnit.unregisterItemIds();
                existingBadUnit.unregisterObjectIds();
              }

              detectedUnregistered = true;
              switchUnitByItemId.registerItemIds(selectionUnit.itemId1, selectionUnit.itemId2);
            }

            const possibleSelectItems = player.selection.units.filter(rawUnit => {
              if (player.findUnit(rawUnit.itemId1, rawUnit.itemId2)) {
                return false;
              }

              return !utils.isEqualUnitItemId(rawUnit, {itemId1, itemId2});
            });

            if (!detectedUnregistered) {
              if (!possibleSelectItems.length) {
                player.printSelectionUnits();
                player.printUnits();

                const firstUnreg = player.getFirstUnregisteredUnitFromSelection();
                if (firstUnreg) {
                  switchUnitByItemId.registerItemIds(firstUnreg.itemId1, firstUnreg.itemId1);
                  switchUnitByItemId.registerObjectIds(objectId1, objectId2);
                  return;
                }

                console.logger("CRITICAL - couldn't handle this selection");
                player.reduceParseConfidence('Critical');
                return;
              }

              if (possibleSelectItems.length === 1) {
                const newItem = possibleSelectItems[0];
                switchUnitByItemId.registerItemIds(newItem.itemId1, newItem.itemId2);

                player.reduceParseConfidence('Minor');
              } else {
                const newItem = possibleSelectItems[0];

                console.logger(
                  "WARNING -found multi one unknown itemId in selection:", 
                  newItem.itemId1,
                  newItem.itemId2
                );

                player.reduceParseConfidence('Major');
                switchUnitByItemId.registerItemIds(newItem.itemId1, newItem.itemId2);
              }
            }

            switchUnitByItemId.registerUnit(fixedItemId, objectId1, objectId2);
            switchUnitByItemId.printUnit();

            finalSwitchedUnit = switchUnitByItemId;
          } else {
            const badUnit = player.findUnitByItemId(fixedItemId);
            if (badUnit) {
              // unregister this unit since we know it was wrong
              badUnit.unregisterObjectIds();
              badUnit.registerObjectIds(objectId1, objectId2);
              finalSwitchedUnit = badUnit;
            } else {
              if (unitInfo.meta.permanent) {
                console.logger("CRITICAL - unable to find tab switch permanent unit."); 
                player.reduceParseConfidence('Critical');
              } else {
                console.logger("WARNING - unable to find table switch non-perm unit");
                player.reduceParseConfidence('Major');
                return;
              }
            }
          }
        } else {
          // register our newly registered unit 
          finalSwitchedUnit = newlyRegisteredUnit;  
        }
        
        
      }
    }

    if (!finalSwitchedUnit) {
      console.logger("CRITICAL - unable to find tab switch final switch unit.");  
      player.reduceParseConfidence('Critical');
      return;
    }

    PlayerActions.setSelectionByItemId(
      player, 
      finalSwitchedUnit.itemId1,
      finalSwitchedUnit.itemId2
    );

    return;
  }

  static setSelectionByItemId (player, itemId1, itemId2, mustFind = false) {
    const targetUnit = { itemId1, itemId2 };
    const unitSelectionIndex = player.selection.units.findIndex(selectionUnit => {
      return utils.isEqualItemId(selectionUnit.itemId1, targetUnit.itemId1) &&
             utils.isEqualItemId(selectionUnit.itemId2, targetUnit.itemId2)
    });

    if (unitSelectionIndex === -1) {
      console.logger("CRITICAL - unable to find unit to set selection");
      player.reduceParseConfidence('Critial');
    }

    player.selection.setSelectionIndex(unitSelectionIndex);
    player.printSelectionUnits();
  }

  // ---- Combat formation resolution ------------------------------------------
  //
  // Gathers the engagement context for an attack order and delegates the
  // geometry to CombatFormation.resolveFormation. Returns Map<unit,{x,y}> of
  // stop positions, or null when no formation applies (no attacking units, or
  // an attack-move with no enemy in acquisition range — the caller then does a
  // plain point-move, leaving non-combat movement untouched).
  //
  //   kind 'attack'       — attack/right-click on a specific enemy unit. The
  //                         clicked (targetX,targetY) is that enemy's position,
  //                         a reliable focus point even if the unit isn't in
  //                         the registry yet.
  //   kind 'attackground' — attack-move to ground. We only form up if real
  //                         enemies sit within the army's acquisition envelope
  //                         of the destination; otherwise return null.
  static _resolveCombatFormation (player, world, moveUnits, targetX, targetY, opts) {
    // Attacking units only: no buildings, no workers, must be positioned.
    const units = moveUnits.filter(u =>
      u && !u.isBuilding && !isWorkerUnit(u) &&
      u.currentX != null && u.currentY != null
    );
    if (!units.length) return null;
    if (!world || typeof world.findEnemyUnitsNear !== 'function') return null;

    // Search radius: the widest acquisition range in the army (so a long-sight
    // unit can pull the formation) plus a margin for the spread of the enemy
    // cluster. Floor keeps short-sighted melee-only armies from missing a
    // clearly-engaged enemy.
    let maxAcq = 0;
    for (const u of units) {
      maxAcq = Math.max(maxAcq, getAcquisitionRange(u.itemId, player) || 0);
    }
    const searchRadius = Math.max(maxAcq, 600) + 400;

    const enemyHits = world.findEnemyUnitsNear(
      targetX, targetY, searchRadius, player.id, player.teamId
    );

    if (!enemyHits.length) {
      // No enemy near the destination.
      //  - attack-move: this is just an advance → no formation (plain move).
      //  - attack-on-unit: the target exists but isn't registry-visible; still
      //    give ranged units a range stop around the clicked point so they
      //    don't walk on top of it.
      if (opts.kind === 'attack') {
        return CombatFormation.resolveFormation(
          units, { x: targetX, y: targetY }, [], player
        );
      }
      return null;
    }

    const enemyUnits = enemyHits.map(h => h.unit);

    // Focus point = the enemy nearest the army's centre of mass (the enemy
    // "front"), so ranged standoff is measured from the part of the enemy line
    // the army actually faces — not the far edge of a deep cluster.
    let acx = 0, acy = 0;
    for (const u of units) { acx += u.currentX; acy += u.currentY; }
    acx /= units.length; acy /= units.length;

    let front = enemyUnits[0];
    let bestD2 = Infinity;
    for (const e of enemyUnits) {
      const dx = e.currentX - acx, dy = e.currentY - acy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; front = e; }
    }
    const focus = { x: front.currentX, y: front.currentY };

    const slots = CombatFormation.resolveFormation(units, focus, enemyUnits, player, opts);
    if (config.debugFormation) {
      PlayerActions._recordFormationTrace(player, units, focus, enemyUnits, slots, opts);
    }
    return slots;
  }

  // Diagnostic capture for tools/formation-check.js. Records, per attack order,
  // each unit's role/range, its resolved stop distance from the focus point,
  // and the stop-vs-range error — so the validator can confirm ranged units
  // actually settle at their attack range behind the melee line. No-op unless
  // config.debugFormation. Never affects simulation.
  static _recordFormationTrace (player, units, focus, enemyUnits, slots, opts) {
    if (!slots || !slots.size) return;
    if (!player.formationTrace) player.formationTrace = [];

    const entries = [];
    for (const u of units) {
      const slot = slots.get(u);
      if (!slot) continue;
      const { role, range } = CombatFormation.classifyRole(u, player);
      const dx = slot.x - focus.x, dy = slot.y - focus.y;
      const stop = Math.sqrt(dx * dx + dy * dy);
      entries.push({
        uuid: u.uuid,
        itemId: u.itemId,
        role,
        range: Math.round(range),
        stop: Math.round(stop),
        stopErr: Math.round(stop - Math.max(64, range))
      });
    }

    player.formationTrace.push({
      gameTime: player.eventTimer.timer.gameTime,
      kind: opts.kind,
      focus: { x: Math.round(focus.x), y: Math.round(focus.y) },
      enemyCount: enemyUnits.length,
      units: entries
    });
  }
};

module.exports = PlayerActions;
