/**
 * BattleSummary — per-battle situational analysis for the Battle Report UI.
 *
 * Runs after DeathInference (which already attached lostState to every unit).
 * For each battle, derives:
 *
 *   • Loss aggregates per player + per confidence bucket (definite/estimated)
 *   • Engagement type — classified from battle metadata
 *       'campClear'  — friendly creep camp clear (no PvP)
 *       'creepJack'  — interrupt enemy creeping (creepJack flag)
 *       'baseRaid'   — buildings involved, attacker far from home
 *       'defense'    — buildings involved, defender at home
 *       'heroSnipe'  — short fight where a hero died
 *       'wipe'       — one side lost 5+ units
 *       'harass'     — short, low-loss skirmish
 *       'skirmish'   — generic mid-field fight
 *   • Trip aggregates per player — derived from battle.unitTrips:
 *       { fountain, shop, base, expansion, moonwell, disengage, reengage }
 *     Each count = how many units of that player took that kind of trip.
 *   • Hero events — deaths (already in heroDeaths) + survivors who tripped
 *     to fountain (took heavy damage, likely traded hp).
 *   • Duration ms.
 *
 * Client uses this to render the Battle Report tab in the Insights panel
 * (icons, type chips, trip indicators).
 */

const mappings = require('../helpers/mappings');

function isHeroUnit (unit) {
  return !!(unit && unit.meta && unit.meta.hero);
}

function unitCost (unit) {
  const bi = unit && unit.balanceInfo;
  if (!bi) return { gold: 0, lumber: 0, food: 0 };
  return {
    gold:   bi.goldCost   || 0,
    lumber: bi.lumberCost || 0,
    food:   bi.foodUsed   || 0
  };
}

class BattleSummary {
  constructor (playerManager) {
    this.playerManager = playerManager;
    this.world = playerManager.world;
    this.battles = (this.world && this.world.battles) || [];
    this.stats = {
      battlesScanned: 0,
      withLosses: 0,
      withHeroDeath: 0,
      totalDefinite: 0,
      totalEstimated: 0
    };
  }

  run () {
    // Build a uuid → unit index across all players for cheap lookups.
    const uuidToUnit = new Map();
    const uuidToPlayer = new Map();
    for (const player of Object.values(this.playerManager.players || {})) {
      for (const u of (player.units || [])) {
        if (u.uuid) {
          uuidToUnit.set(u.uuid, u);
          uuidToPlayer.set(u.uuid, player);
        }
      }
      for (const u of (player.destroyedSummons || [])) {
        if (u.uuid) {
          uuidToUnit.set(u.uuid, u);
          uuidToPlayer.set(u.uuid, player);
        }
      }
    }

    for (const battle of this.battles) {
      this.stats.battlesScanned++;
      battle.summary = this._summarizeBattle(battle, uuidToUnit, uuidToPlayer);
      if (battle.summary.hasLosses) this.stats.withLosses++;
      if (battle.summary.hasHeroDeath) this.stats.withHeroDeath++;
    }

    return this.stats;
  }

  _summarizeBattle (battle, uuidToUnit, uuidToPlayer) {
    const perPlayer = {};
    const ensure = (playerId, player) => {
      if (perPlayer[playerId]) return perPlayer[playerId];
      const entry = {
        playerId,
        playerColor: (player && player.color) || null,
        race: (player && player.race) || null,
        teamId: (player && player.teamId != null) ? player.teamId : null,
        definite:  { count: 0, food: 0, gold: 0, lumber: 0, units: [] },
        estimated: { count: 0, food: 0, gold: 0, lumber: 0, units: [] },
        heroDeaths: []
      };
      perPlayer[playerId] = entry;
      return entry;
    };

    let hasLosses = false;
    let hasHeroDeath = false;

    for (const o of (battle.unitOutcomes || [])) {
      const unit = uuidToUnit.get(o.unitUuid);
      if (!unit) continue;
      const player = uuidToPlayer.get(o.unitUuid);
      if (!player) continue;

      // Determine bucket: this battle only "counts" the loss if either:
      //   • the unit's lostState points at THIS battle as the killer
      //     (DeathInference picked this battle as the death anchor)
      //   • OR status is 'expired' with no battle-anchored lostState
      //     (summon expired during/near this battle)
      const ls = unit.lostState;
      const isLostHere = ls && ls.killedInBattleId === battle.id;
      const isPossibleHere = (o.status === 'possiblyDead' || o.status === 'expired') && !isLostHere;

      if (!isLostHere && !isPossibleHere) continue;

      const bucket = isLostHere ? 'definite' : 'estimated';
      if (bucket === 'definite') this.stats.totalDefinite++;
      else this.stats.totalEstimated++;

      const entry = ensure(player.id, player);
      const cost = unitCost(unit);
      const target = entry[bucket];
      target.count++;
      target.food += cost.food;
      target.gold += cost.gold;
      target.lumber += cost.lumber;

      const isHero = isHeroUnit(unit);
      hasLosses = true;
      if (isHero) {
        hasHeroDeath = true;
        entry.heroDeaths.push({
          itemId: unit.itemId,
          displayName: unit.displayName,
          level: unit.knownLevel || 1,
          confidence: bucket
        });
      }

      // Roll up by itemId in the units list.
      const list = target.units;
      const existing = list.find(u => u.itemId === unit.itemId);
      if (existing) {
        existing.count++;
      } else {
        list.push({
          itemId: unit.itemId,
          displayName: unit.displayName,
          count: 1,
          isHero
        });
      }
    }

    // Banner position: centre of the battle bbox.
    const bb = battle.outerBbox || { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    const center = {
      x: (bb.minX + bb.maxX) / 2,
      y: (bb.minY + bb.maxY) / 2
    };

    // Trip aggregation per player — derived from battle.unitTrips[].
    // We collapse per-tag counts so the UI shows "2× fountain, 1× retreat".
    const trips = this._aggregateTrips(battle, uuidToPlayer);

    // Engagement type from battle metadata + loss profile.
    const engagementType = this._classify(battle, perPlayer);

    return {
      battleId: battle.id,
      startTime: battle.startTime,
      endTime: battle.endTime,
      durationMs: (battle.endTime || 0) - (battle.startTime || 0),
      engagementType,
      perPlayer,
      trips,
      center,
      hasLosses,
      hasHeroDeath
    };
  }

  _aggregateTrips (battle, uuidToPlayer) {
    const perPlayer = {};
    for (const t of (battle.unitTrips || [])) {
      const player = uuidToPlayer.get(t.unitUuid);
      if (!player) continue;
      let bucket = perPlayer[player.id];
      if (!bucket) {
        bucket = perPlayer[player.id] = {
          fountain: 0, shop: 0, base: 0, expansion: 0,
          moonwell: 0, disengage: 0, reengage: 0
        };
        perPlayer[player.id] = bucket;
      }
      // Map trip tags / destination kinds → buckets.
      const kind = t.destinationKind || '';
      const tag = t.tag || '';
      if (kind === 'fountain-heal' || kind === 'fountain-mana') bucket.fountain++;
      else if (kind === 'shop') bucket.shop++;
      else if (kind === 'moonwell') bucket.moonwell++;
      else if (kind === 'base') bucket.base++;
      else if (kind === 'expansion') bucket.expansion++;
      else if (tag === 'trip-disengage') bucket.disengage++;
      else if (tag === 'trip-reengage') bucket.reengage++;
    }
    return perPlayer;
  }

  _classify (battle, perPlayer) {
    if (battle.creepJack) return 'creepJack';
    if (battle.campUuid) return 'campClear';

    const duration = (battle.endTime || 0) - (battle.startTime || 0);
    const involvesBuildings = (battle.engagedBuildings || []).length > 0;
    let totalLosses = 0;
    let heroDied = false;
    let maxOneSide = 0;
    for (const p of Object.values(perPlayer)) {
      const total = p.definite.count + p.estimated.count;
      totalLosses += total;
      if (total > maxOneSide) maxOneSide = total;
      if (p.heroDeaths.length > 0) heroDied = true;
    }

    if (heroDied) return 'heroSnipe';
    if (involvesBuildings) {
      // Base raid vs defense: ambiguous without homePlayer signal. Default
      // to baseRaid — the perspective is "buildings were involved".
      return 'baseRaid';
    }
    if (maxOneSide >= 5) return 'wipe';
    if (duration < 8000 && totalLosses <= 1) return 'harass';
    return 'skirmish';
  }
}

module.exports = BattleSummary;
