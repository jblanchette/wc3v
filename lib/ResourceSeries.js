/**
 * ResourceSeries — per-player time series of resource activity.
 *
 * Samples every SAMPLE_INTERVAL_MS and emits:
 *   { gameTime,
 *     foodUsed, foodMax,                  // current state at this tick
 *     goldSpent, lumberSpent,             // cumulative training/building cost
 *     goldLost,  lumberLost, foodLost     // cumulative loss values (definite + estimated)
 *   }
 *
 * Output attached as `player.resourceSeries = [...]`. Client renders broadcast-
 * style line charts.
 *
 * Cost basis:
 *   spent = unit cost when training started (spawnTime/trainedTime/spawnPosition signal)
 *   lost  = unit cost when its lostState.since fires
 * "Lost" counts both 'lost' and 'possiblyLost' states — the chart visualises
 * the threat of losses, not just confirmed ones.
 */

const SAMPLE_INTERVAL_MS = 10 * 1000;   // 10-second buckets

function unitCost (unit) {
  const bi = unit && unit.balanceInfo;
  if (!bi) return { gold: 0, lumber: 0, food: 0 };
  return {
    gold:   bi.goldCost   || 0,
    lumber: bi.lumberCost || 0,
    food:   bi.foodUsed   || 0
  };
}

class ResourceSeries {
  constructor (playerManager) {
    this.playerManager = playerManager;
    this.stats = { players: 0, samplesTotal: 0 };
  }

  run () {
    const players = Object.values(this.playerManager.players || {});
    const gameEnd = this._computeGameEnd(players);
    if (gameEnd <= 0) return this.stats;
    const sampleCount = Math.ceil(gameEnd / SAMPLE_INTERVAL_MS) + 1;

    for (const player of players) {
      if (player.isNeutralPlayer) continue;
      this.stats.players++;
      player.resourceSeries = this._buildPlayerSeries(player, sampleCount);
      this.stats.samplesTotal += player.resourceSeries.length;
    }
    return this.stats;
  }

  _computeGameEnd (players) {
    let end = 0;
    for (const p of players) {
      const ev = p.eventStream || [];
      if (ev.length) end = Math.max(end, ev[ev.length - 1].gameTime || 0);
      for (const u of (p.units || [])) {
        if (u.path && u.path.length) {
          end = Math.max(end, u.path[u.path.length - 1].gameTime || 0);
        }
      }
    }
    return end;
  }

  _buildPlayerSeries (player, sampleCount) {
    // Build a sorted list of (gameTime, deltaGold, deltaLumber, deltaFood)
    // events for spending and losses; then walk samples accumulating.
    const spendEvents = [];   // when units/buildings were committed
    const lossEvents  = [];   // when units were lost

    for (const u of (player.units || [])) {
      const cost = unitCost(u);
      if (cost.gold === 0 && cost.lumber === 0 && cost.food === 0) continue;

      // Spend event = when the unit was committed to training.
      const spendT = (u.spawnTime != null) ? u.spawnTime
                   : (u.constructionStartTime != null) ? u.constructionStartTime
                   : null;
      if (spendT != null) {
        spendEvents.push({ t: spendT, gold: cost.gold, lumber: cost.lumber, food: cost.food });
      }

      // Loss event = when lostState.since fires (lost or possiblyLost).
      const ls = u.lostState;
      if (ls && (ls.state === 'lost' || ls.state === 'possiblyLost')) {
        lossEvents.push({ t: ls.since, gold: cost.gold, lumber: cost.lumber, food: cost.food });
      } else if (u.destroyed && u.destroyedAt != null) {
        lossEvents.push({ t: u.destroyedAt, gold: cost.gold, lumber: cost.lumber, food: cost.food });
      }
    }

    spendEvents.sort((a, b) => a.t - b.t);
    lossEvents.sort((a, b) => a.t - b.t);

    // Build supply state lookup from eventStream (each event carries
    // supplyUsed/supplyMax). Binary-search-ready by scanning sorted.
    const supplyTimeline = [];
    for (const e of (player.eventStream || [])) {
      if (e.supplyUsed == null) continue;
      supplyTimeline.push({
        t: e.gameTime || 0,
        used: e.supplyUsed,
        max: e.supplyMax
      });
    }
    supplyTimeline.sort((a, b) => a.t - b.t);

    // Walk samples.
    const series = [];
    let goldSpent = 0, lumberSpent = 0;
    let goldLost = 0, lumberLost = 0, foodLost = 0;
    let spendI = 0, lossI = 0, supplyI = 0;
    let currentSupply = { used: 0, max: 0 };

    for (let s = 0; s < sampleCount; s++) {
      const t = s * SAMPLE_INTERVAL_MS;

      while (spendI < spendEvents.length && spendEvents[spendI].t <= t) {
        goldSpent   += spendEvents[spendI].gold;
        lumberSpent += spendEvents[spendI].lumber;
        spendI++;
      }
      while (lossI < lossEvents.length && lossEvents[lossI].t <= t) {
        goldLost   += lossEvents[lossI].gold;
        lumberLost += lossEvents[lossI].lumber;
        foodLost   += lossEvents[lossI].food;
        lossI++;
      }
      while (supplyI < supplyTimeline.length && supplyTimeline[supplyI].t <= t) {
        currentSupply = supplyTimeline[supplyI];
        supplyI++;
      }

      series.push({
        t,
        foodUsed: currentSupply.used,
        foodMax: currentSupply.max,
        goldSpent, lumberSpent,
        goldLost, lumberLost, foodLost
      });
    }
    return series;
  }
}

module.exports = ResourceSeries;
