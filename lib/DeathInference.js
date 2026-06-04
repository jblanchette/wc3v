/**
 * DeathInference — post-pass that backfills "lost state" onto every Unit.
 *
 * Runs after BattleDetector. BattleDetector emits per-battle outcomes
 * (`'alive' | 'possiblyDead' | 'expired' | 'possiblyLoaded'` × `'high' |
 * 'medium' | 'low'`) into `battle.unitOutcomes[]`. We fold all of those
 * (a unit can appear in multiple battles), pick the latest meaningful
 * verdict, and emit a single `lostState` per unit:
 *
 *   {
 *     state:       'active' | 'idle' | 'possiblyLost' | 'lost',
 *     since:       gameTime,
 *     confidence:  0..100,
 *     source:      'battle' | 'expired' | 'pathSilence' | 'destroyed' | 'unknown',
 *     killedInBattleId:  number | null,
 *     killerPlayerIds:   number[] | null,
 *     xpAwarded:         number   | null,  // XP credited to nearby heroes
 *   }
 *
 * State semantics (client renders accordingly):
 *   active       — recently seen / moving / in a battle as a participant
 *   idle         — path silent ≥ IDLE_MS, no battle context (just standing around)
 *   possiblyLost — silent after a battle, status='possiblyDead' with low/medium
 *   lost         — high confidence death (summon expired, hero revived elsewhere,
 *                  or possiblyDead with medium+ confidence and corroborating
 *                  signal). One-shot death FX plays once on the client.
 *
 * Heroes: never "lost" unless they have a revive-elsewhere signal (they'd
 * just be `idle`). Buildings/illusions/inferred units: skipped entirely.
 */

// Tunables (ms unless noted).
const IDLE_MS = 30 * 1000;          // path silent this long → idle
const POSSIBLY_LOST_MS = 60 * 1000; // silent + battle context → possiblyLost
const LOST_MS = 120 * 1000;         // silent this long → lost (last resort)

// Rough XP table (WC3 doesn't give big XP for non-creep PvP kills).
function estimateXpReward (unit) {
  if (!unit) return 0;
  if (unit.meta && unit.meta.hero) {
    const lvl = unit.knownLevel || 1;
    return 100 + lvl * 50;             // big bounty
  }
  // From mappings/balance: foodUsed correlates well with XP value.
  const food = (unit.balanceInfo && unit.balanceInfo.foodUsed) || 2;
  return Math.round(20 + food * 8);    // 20-100ish for typical units
}

class DeathInference {
  constructor (playerManager) {
    this.playerManager = playerManager;
    this.world = playerManager.world;
    this.battles = (this.world && this.world.battles) || [];
    this.stats = {
      unitsScanned: 0,
      active: 0, idle: 0, possiblyLost: 0, lost: 0
    };
  }

  run () {
    // Pre-index battles by id for cheap lookup.
    const battlesById = new Map();
    for (const b of this.battles) battlesById.set(b.id, b);

    // Build uuid → all outcomes across battles, sorted by battle endTime.
    const outcomesByUuid = new Map();
    for (const battle of this.battles) {
      if (!battle.unitOutcomes) continue;
      for (const o of battle.unitOutcomes) {
        let arr = outcomesByUuid.get(o.unitUuid);
        if (!arr) { arr = []; outcomesByUuid.set(o.unitUuid, arr); }
        arr.push({ outcome: o, battle });
      }
    }

    // Walk every player's units.
    const allPlayers = Object.values(this.playerManager.players || {});
    for (const player of allPlayers) {
      const units = (player.units || []).concat(player.destroyedSummons || []);
      for (const unit of units) {
        if (!unit) continue;
        if (unit.isBuilding) continue;
        if (unit.isIllusion) continue;
        if (unit.isInferred) continue;
        this.stats.unitsScanned++;

        unit.lostState = this._inferLostState(unit, outcomesByUuid.get(unit.uuid));
        this.stats[unit.lostState.state]++;
      }
    }

    return this.stats;
  }

  _inferLostState (unit, battleEntries) {
    const raw = this._inferRaw(unit, battleEntries);
    return this._applyIdentityGuards(unit, raw);
  }

  // Heroes and workers are the two unit classes a viewer most needs to trust.
  // Both are routinely mis-flagged by silence/battle heuristics:
  //   - Heroes get microed in bursts; a player who stops issuing orders for a
  //     minute leaves the hero "silent" even though it is alive and central.
  //     A hero is only ever truly gone via an explicit destroy/revive signal,
  //     so we never let an *inferred* verdict push a hero past `idle`.
  //   - Workers mine/stand for long stretches with zero path records. Pure
  //     path-silence must NOT read as "possibly dead" for them — only a real
  //     battle outcome (they were caught and killed) may.
  // This is the single choke point so the client can trust lostState directly.
  _applyIdentityGuards (unit, ls) {
    if (!ls) return ls;
    const isHero = !!(unit.meta && unit.meta.hero);
    const isWorker = !!(unit.meta && unit.meta.worker);

    // Explicit destroyed/expired death always stands (summon expiry, etc.).
    const explicitDeath = ls.source === 'destroyed' || ls.source === 'expired';

    if (isHero && !explicitDeath && (ls.state === 'possiblyLost' || ls.state === 'lost')) {
      return { ...ls, state: 'idle', confidence: 0, xpAwarded: null, _downgradedFrom: ls.state };
    }
    if (isWorker && ls.state === 'possiblyLost' && ls.source === 'pathSilence') {
      return { ...ls, state: 'idle', confidence: 0, xpAwarded: null, _downgradedFrom: ls.state };
    }
    return ls;
  }

  _inferRaw (unit, battleEntries) {
    // 1. Explicit death markers win immediately.
    if (unit.destroyed && unit.destroyedAt != null) {
      return {
        state: 'lost',
        since: unit.destroyedAt,
        confidence: 100,
        source: unit.summonDuration ? 'expired' : 'destroyed',
        killedInBattleId: null,
        killerPlayerIds: null,
        xpAwarded: estimateXpReward(unit)
      };
    }

    const lastSample = (unit.path && unit.path.length)
      ? unit.path[unit.path.length - 1]
      : null;
    const lastActivity = lastSample ? lastSample.gameTime : (unit.spawnTime || 0);
    const gameEnd = this._gameEndTime();
    const silentFor = gameEnd - lastActivity;

    // 2. Was this unit in any battle? If yes, take the LATEST meaningful outcome.
    let bestOutcome = null;
    let bestBattle = null;
    if (battleEntries && battleEntries.length) {
      // Sort by battle endTime descending.
      battleEntries.sort((a, b) => (b.battle.endTime || 0) - (a.battle.endTime || 0));
      for (const { outcome, battle } of battleEntries) {
        if (outcome.status === 'possiblyDead' || outcome.status === 'expired') {
          bestOutcome = outcome;
          bestBattle = battle;
          break;
        }
        if (!bestOutcome && outcome.status === 'alive') {
          bestOutcome = outcome;
          bestBattle = battle;
        }
      }
    }

    // 3. If the latest battle marked them possiblyDead/expired AND they're
    //    still silent at game end, they're lost.
    if (bestOutcome && (bestOutcome.status === 'possiblyDead' || bestOutcome.status === 'expired')) {
      const confWeight = bestOutcome.confidence === 'high' ? 90
                       : bestOutcome.confidence === 'medium' ? 70
                       : 45;

      // Still silent? Lost. Path resumed after the battle? Active (they got away).
      const lastSeen = bestOutcome.lastSeenTime || lastActivity;
      const stillSilent = silentFor >= POSSIBLY_LOST_MS && lastActivity <= lastSeen + 5000;

      const killerPlayerIds = this._killersFor(bestBattle, unit);
      const xpAwarded = estimateXpReward(unit);

      if (stillSilent && confWeight >= 70) {
        return {
          state: 'lost',
          since: lastSeen,
          confidence: confWeight,
          source: bestOutcome.status === 'expired' ? 'expired' : 'battle',
          killedInBattleId: bestBattle ? bestBattle.id : null,
          killerPlayerIds,
          xpAwarded
        };
      }
      if (stillSilent) {
        return {
          state: 'possiblyLost',
          since: lastSeen,
          confidence: confWeight,
          source: 'battle',
          killedInBattleId: bestBattle ? bestBattle.id : null,
          killerPlayerIds,
          xpAwarded: null
        };
      }
      // Got away — still moving after.
    }

    // 4. No battle context — pure path-silence heuristic.
    if (silentFor >= LOST_MS) {
      return {
        state: 'possiblyLost',  // never "lost" without a battle anchor
        since: lastActivity,
        confidence: 40,
        source: 'pathSilence',
        killedInBattleId: null, killerPlayerIds: null, xpAwarded: null
      };
    }
    if (silentFor >= IDLE_MS) {
      return {
        state: 'idle',
        since: lastActivity,
        confidence: 0,
        source: 'pathSilence',
        killedInBattleId: null, killerPlayerIds: null, xpAwarded: null
      };
    }
    return {
      state: 'active',
      since: lastActivity,
      confidence: 0,
      source: 'unknown',
      killedInBattleId: null, killerPlayerIds: null, xpAwarded: null
    };
  }

  _gameEndTime () {
    if (this._cachedEnd != null) return this._cachedEnd;
    const players = Object.values(this.playerManager.players || {});
    let end = 0;
    for (const p of players) {
      for (const u of (p.units || [])) {
        if (u.path && u.path.length) {
          const t = u.path[u.path.length - 1].gameTime || 0;
          if (t > end) end = t;
        }
      }
    }
    this._cachedEnd = end;
    return end;
  }

  // Who killed this unit? The enemy players who participated in the battle.
  _killersFor (battle, unit) {
    if (!battle || !battle._participantsByPlayer) return null;
    const myPlayer = unit._registryOwnerPlayerId;
    const myTeam = unit._registryOwnerTeamId;
    const killers = [];
    for (const playerId of Object.keys(battle._participantsByPlayer)) {
      const pid = Number(playerId);
      if (pid === myPlayer) continue;
      // teamId comparison: same team can't kill.
      const otherTeam = this._teamOf(pid);
      if (otherTeam != null && myTeam != null && otherTeam === myTeam) continue;
      killers.push(pid);
    }
    return killers.length ? killers : null;
  }

  _teamOf (playerId) {
    const p = this.playerManager.players && this.playerManager.players[playerId];
    return (p && p.teamId != null) ? p.teamId : null;
  }
}

module.exports = DeathInference;
