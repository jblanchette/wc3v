/**
 * RazedBuildingInference — conservative detection of buildings destroyed by
 * enemy attack.
 *
 * WC3 replays carry no destruction events; until this pass, NOTHING in the
 * pipeline could mark a building as razed (destroyed/destroyedAt is reserved
 * for summon expiry / sacrifice / illusions, and DeathInference skips
 * buildings entirely). Consequence: a player whose base burned down kept full
 * standing-building value in downstream analysis (dominance Tech component,
 * expansion bonuses).
 *
 * Evidence combined per (battle, engaged building):
 *   1. Hostile pressure — enemy attack signals explicitly TARGETING the
 *      building's uuid, sustained over a minimum span. Attack orders are
 *      ground truth intent; sustained targeting means the attack wasn't a
 *      poke that got peeled.
 *   2. Owner-quiet — the owner never demonstrably uses the building again
 *      (selection of its type, training completions, path movement for
 *      uprooted ancients). Type-level selection matching is deliberately
 *      conservative: selecting ANY same-type building blocks the raze.
 *   3. Terminality — the game ends soon after, or a later battle engages
 *      deeper into the same base (the raid succeeded and rolled on).
 *
 * Output: building.razedState = { razed, at, confidence, battleId,
 * signalCount }. `destroyed/destroyedAt` are NOT touched — their semantics
 * drive other systems. Confidence is 'high' or 'medium' only; when in doubt
 * this pass emits NOTHING (a false raze is worse than a missed one).
 *
 * Runs after BattleDetector (needs battles/signals/engagedBuildings), before
 * DeathInference/BattleSummary in the wc3v.js pipeline.
 */

const MIN_SIGNALS_MEDIUM = 3;      // hostile signals targeting the building
const MIN_SIGNALS_HIGH = 6;
const MIN_ATTACK_SPAN_MS = 4000;   // first→last targeting signal
const OWNER_QUIET_GRACE_MS = 5000; // owner activity allowed this soon after battle
const END_PROXIMITY_MS = 8 * 60 * 1000;  // "game ended soon after"
const SAME_BASE_RADIUS = 2000;     // later battle within this = raid went deeper

class RazedBuildingInference {
  constructor (playerManager) {
    this.playerManager = playerManager;
    this.world = playerManager.world;
    this.battles = (this.world && this.world.battles) || [];
    this.stats = { buildingsScanned: 0, razedHigh: 0, razedMedium: 0 };
  }

  run () {
    const players = this.playerManager.players || {};
    const gameEnd = this._computeGameEnd(players);
    if (gameEnd <= 0 || !this.battles.length) return this.stats;

    // uuid → { building, owner } for every real player building.
    const buildingsByUuid = new Map();
    for (const player of Object.values(players)) {
      if (player.isNeutralPlayer) continue;
      for (const u of (player.units || [])) {
        if (u.isBuilding && u.uuid) buildingsByUuid.set(u.uuid, { building: u, owner: player });
      }
    }

    const battles = [...this.battles].sort((a, b) => (a.endTime || 0) - (b.endTime || 0));

    for (const battle of battles) {
      const teams = new Set((battle.participants || [])
        .map(p => p.teamId).filter(t => t != null));
      if (teams.size < 2) continue;   // PvP only

      for (const eb of (battle.engagedBuildings || [])) {
        const entry = buildingsByUuid.get(eb.uuid);
        if (!entry) continue;
        const { building, owner } = entry;

        this.stats.buildingsScanned++;
        if (building.razedState) continue;                     // first battle wins
        if (building.isInferred) continue;
        if (building.destroyed && building.destroyedAt != null) continue;
        const builtAt = (building.spawnTime != null) ? building.spawnTime
                      : (building.constructionStartTime != null) ? building.constructionStartTime
                      : null;
        if (builtAt == null || builtAt > (battle.endTime || 0)) continue;

        // 1. Hostile pressure.
        const hostileSignals = (battle.signals || []).filter(s =>
          s.targetUnitUuid === building.uuid &&
          s.hostile &&
          this._isEnemyOf(players, s.playerId, owner));
        if (hostileSignals.length < MIN_SIGNALS_MEDIUM) continue;
        const first = Math.min(...hostileSignals.map(s => s.gameTime || 0));
        const last = Math.max(...hostileSignals.map(s => s.gameTime || 0));
        if (last - first < MIN_ATTACK_SPAN_MS) continue;

        // 2. Owner-quiet.
        const lastUse = this._lastUse(owner, building);
        if (lastUse != null && lastUse > (battle.endTime || 0) + OWNER_QUIET_GRACE_MS) continue;

        // 3. Terminality.
        const nearEnd = gameEnd - (battle.endTime || 0) <= END_PROXIMITY_MS;
        const raidWentDeeper = this._laterBattleInSameBase(battles, battle, owner, building);
        if (!nearEnd && !raidWentDeeper) continue;

        const trackedInUse = lastUse != null || building.isSpawnedAtStart;
        const confidence = (hostileSignals.length >= MIN_SIGNALS_HIGH && trackedInUse)
          ? 'high' : 'medium';

        building.razedState = {
          razed: true,
          at: battle.endTime || 0,
          confidence,
          battleId: battle.id,
          signalCount: hostileSignals.length
        };
        if (confidence === 'high') this.stats.razedHigh++;
        else this.stats.razedMedium++;
      }
    }

    return this.stats;
  }

  _computeGameEnd (players) {
    let end = 0;
    for (const p of Object.values(players)) {
      const ev = p.eventStream || [];
      if (ev.length) end = Math.max(end, ev[ev.length - 1].gameTime || 0);
      for (const u of (p.units || [])) {
        if (u.path && u.path.length) end = Math.max(end, u.path[u.path.length - 1].gameTime || 0);
      }
    }
    return end;
  }

  _isEnemyOf (players, signalPlayerId, owner) {
    const signalPlayer = players[signalPlayerId];
    if (!signalPlayer) return false;
    return signalPlayer.teamId != null && signalPlayer.teamId !== owner.teamId;
  }

  // Latest demonstrable use of the building by its owner:
  //   - selection of its TYPE (itemId1/itemId2 pair) in selectionStream —
  //     type-level, so any same-type sibling blocks the raze (conservative);
  //   - training completions out of this building;
  //   - path samples (uprooted ancients move — a moving building is alive).
  _lastUse (owner, building) {
    let lastUse = null;
    const consider = (t) => { if (t != null && (lastUse == null || t > lastUse)) lastUse = t; };

    const id1 = building.itemId1 && String(building.itemId1);
    const id2 = building.itemId2 && String(building.itemId2);
    for (const rec of (owner.selectionStream || [])) {
      const units = (rec.selection && rec.selection.units) || [];
      for (const su of units) {
        const su1 = su.itemId1 && String(su.itemId1);
        const su2 = su.itemId2 && String(su.itemId2);
        if (id1 != null && su1 === id1 && su2 === id2) { consider(rec.gameTime); break; }
      }
    }
    for (const trained of (building.trainedUnits || [])) {
      const unit = trained && trained.unit ? trained.unit : trained;
      if (!unit) continue;
      consider(unit.trainedTime != null ? unit.trainedTime : unit.spawnTime);
    }
    if (building.path && building.path.length) {
      consider(building.path[building.path.length - 1].gameTime);
    }
    return lastUse;
  }

  _laterBattleInSameBase (battles, battle, owner, building) {
    const bx = building.currentX, by = building.currentY;
    if (bx == null || by == null) return false;
    for (const later of battles) {
      if ((later.endTime || 0) <= (battle.endTime || 0) || later.id === battle.id) continue;
      for (const eb of (later.engagedBuildings || [])) {
        if (eb.ownerPlayerId !== owner.id || eb.uuid === building.uuid) continue;
        const other = (owner.units || []).find(u => u.uuid === eb.uuid);
        if (!other || other.currentX == null) continue;
        const dx = other.currentX - bx, dy = other.currentY - by;
        if (Math.sqrt(dx * dx + dy * dy) <= SAME_BASE_RADIUS) return true;
      }
    }
    return false;
  }
}

module.exports = RazedBuildingInference;
