/**
 * DominanceSeries — deterministic per-player "dominance" score over game time.
 *
 * One number per player per tick answering "who is ahead?". Computed ONLY from
 * confident replay-derived state via a versioned formula (helpers/
 * dominanceConfig.json). Same replay in → same numbers out, forever.
 *
 * Model (all values in gold+lumber-equivalent, "GLE"):
 *
 *   S_p(t)     = seed + w·Army + w·Hero + w·Econ + w·Research + w·Buildings + w·Exp
 *   M_p(t)     = Σ impulse_e × 2^(−(t − t_e)/halfLife)      (confident events only)
 *   S_eff_p(t) = max(0, S_p + M_p)
 *   score_p(t) = 100 × S_eff_p / Σ_q S_eff_q               (1v1: sums to 100)
 *
 * Confidence rules (the engine can't know everything — see DeathInference):
 *   • Army losses subtract only for lostState 'lost', or 'possiblyLost' with
 *     confidence ≥ possiblyLostConfidenceMin. More conservative than
 *     ResourceSeries, which charts *threatened* losses.
 *   • Mid-game hero deaths come from explicit heroRevive actions (a revive is
 *     ground truth the hero WAS dead) — lostState alone can't see them because
 *     it is an end-of-game verdict and revived heroes read active again.
 *     End-of-game hero deaths come from lostState 'lost' (battle-anchored).
 *   • Battle momentum swings use only the summary's 'definite' loss bucket.
 *   • Camp momentum requires credited playerCredit at high confidence.
 *   • Degraded parses (low parseConfidence / supply bumps) export NO series at
 *     all (available=false) rather than a misleading number.
 *
 * Sampling: fixed 10s grid PLUS a pre/post sample pair at every momentum event
 * and hero death/revive boundary, so discontinuities render as honest vertical
 * steps under client linear interpolation instead of 10-second ramps.
 *
 * Output: player.dominanceSeries = { version, samples[], events[] } and a
 * shared meta block for the top-level `dominance` key (see helpers/utils.js).
 * Determinism: no clocks, no randomness; players walked in ascending id order;
 * all event lists sorted by (t, insertion index).
 */

const mappings = require('../helpers/mappings');

class DominanceSeries {
  constructor (players, world, config, validation = null) {
    this.playersMap = players || {};
    this.world = world || {};
    this.config = config;
    this.validation = validation;
    this.stats = { players: 0, samplesTotal: 0, available: false, reason: null };
    this.meta = {
      version: config.version,
      available: false,
      reason: null,
      componentsUsed: null
    };
  }

  run () {
    const cfg = this.config;
    const players = Object.values(this.playersMap)
      .filter(p => p && !p.isNeutralPlayer && (p.units || []).length)
      .sort((a, b) => (+a.id) - (+b.id));

    if (players.length < 2) return this._unavailable('fewer than two active players');

    // Gate: ReplayValidator's calibrated per-player confidence (the same
    // number the UI reports). Deliberately NOT gated on the raw
    // Player.parseConfidence tracker (sits at 0.3-0.6 on cleanly-parsed pro
    // replays) nor on supply-bump counts (fire benignly on UD when a ziggurat
    // completes moments after the supply tick) — genuinely broken parses
    // already depress the validator confidence via critical/major issues.
    const vConf = (this.validation && this.validation.playerConfidence) || null;
    for (const p of players) {
      const vc = vConf ? vConf[p.id] : null;
      if (vc != null && vc < cfg.availability.validatorConfidenceMin) {
        return this._unavailable(`player ${p.id} validator confidence ${vc.toFixed(2)} below ${cfg.availability.validatorConfidenceMin}`);
      }
    }

    const gameEnd = this._computeGameEnd(players);
    if (gameEnd <= 0) return this._unavailable('no game timeline');

    // Component availability is decided match-wide (symmetric): a component
    // missing for ONE player would bias the ratio, so it drops for ALL.
    const componentsUsed = {
      army: true,
      hero: true,
      econ: players.every(p => (p.eventStream || []).some(e => e.workers && e.workers.totalWorkers != null)),
      tech: true,
      exp: true
    };

    // Per-player timelines (state deltas + momentum impulses).
    const perPlayer = new Map();
    for (const p of players) perPlayer.set(p, this._collectStateEvents(p));
    this._collectHeroDeaths(players, perPlayer);
    this._collectMomentumEvents(players, perPlayer);

    const ticks = this._buildTickList(gameEnd, players, perPlayer);

    // Evaluate every player at every tick with walking cursors, then normalize
    // per tick into scores.
    // Normalization uses a contrast exponent (>1) so leads read looser than
    // the raw strength share — raw shares hug 50/50 because both players
    // always hold a large common baseline (seed + standing army + econ).
    // score = 100 × S^k / Σ S^k keeps the sum at 100 and close games close,
    // while a real ratio advantage spreads visibly.
    const k = cfg.contrastExponent || 1;
    // Early ramp: with strength = growth-since-start, the first minute's tiny
    // spend differences would read as 60/40 swings over a seed-only base.
    // Ease the displayed score out from even over earlyRampMs — by the first
    // creep clears the signal is fully live.
    const even = 100 / players.length;
    const rampMs = cfg.earlyRampMs || 0;
    const evals = players.map(p => this._evaluateSeries(p, perPlayer.get(p), ticks, componentsUsed));
    for (let i = 0; i < ticks.length; i++) {
      let total = 0;
      for (const ev of evals) total += Math.pow(ev.samples[i].sEff, k);
      const ramp = rampMs > 0 ? Math.min(1, ticks[i] / rampMs) : 1;
      for (const ev of evals) {
        const s = ev.samples[i];
        const raw = total > 0 ? (100 * Math.pow(s.sEff, k) / total) : even;
        s.score = Math.round((even + (raw - even) * ramp) * 10) / 10;
      }
    }

    players.forEach((p, idx) => {
      const ev = evals[idx];
      p.dominanceSeries = {
        version: cfg.version,
        samples: ev.samples.map(s => ({
          t: s.t,
          str: Math.round(s.sEff),
          score: s.score,
          mom: Math.round(s.mom),
          c: {
            army: Math.round(s.c.army),
            hero: Math.round(s.c.hero),
            econ: Math.round(s.c.econ),
            tech: Math.round(s.c.tech),
            exp: Math.round(s.c.exp)
          }
        })),
        events: perPlayer.get(p).momentum.map(m => ({
          t: m.t,
          kind: m.kind,
          delta: Math.round(m.delta),
          ...(m.battleId != null ? { battleId: m.battleId } : {})
        }))
      };
      this.stats.players++;
      this.stats.samplesTotal += p.dominanceSeries.samples.length;
    });

    this.stats.available = true;
    this.meta.available = true;
    this.meta.componentsUsed = componentsUsed;
    return this.stats;
  }

  _unavailable (reason) {
    this.stats.available = false;
    this.stats.reason = reason;
    this.meta.available = false;
    this.meta.reason = reason;
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

  // ------------------------------------------------------------------ pricing

  _gle (gold, lumber) {
    return (gold || 0) + this.config.lumberWeight * (lumber || 0);
  }

  // unitCosts first (has the incremental tier-hall/tower overrides — the
  // balanceInfo values are CUMULATIVE for those, see helpers/mappings.js),
  // balanceInfo as fallback.
  _unitGLE (unit) {
    const byId = unit.itemId ? mappings.unitCosts[unit.itemId] : null;
    if (byId) return this._gle(byId.gold, byId.lumber);
    const bi = unit.balanceInfo;
    if (bi) return this._gle(bi.goldCost, bi.lumberCost);
    return 0;
  }

  _heroValue (level) {
    const cfg = this.config;
    return cfg.heroBaseValue * (1 + cfg.heroLevelFactor * (Math.max(1, level) - 1));
  }

  _heroLevelAt (hero, t) {
    let level = 1;
    for (const ev of (hero.levelStream || [])) {
      if ((ev.gameTime || 0) <= t) level = ev.newLevel || level;
      else break;
    }
    return level;
  }

  // -------------------------------------------------------------- state walk

  // Classify a unit's loss time under the confidence gate, or null if we are
  // not confident it died. Heroes are handled separately (never via lostState
  // 'possiblyLost' — identity guards keep them at idle anyway).
  _confidentLossTime (unit) {
    if (unit.destroyed && unit.destroyedAt != null) return unit.destroyedAt;
    const ls = unit.lostState;
    if (!ls) return null;
    if (ls.state === 'lost') return ls.since;
    if (ls.state === 'possiblyLost' && (ls.confidence || 0) >= this.config.possiblyLostConfidenceMin) {
      return ls.since;
    }
    return null;
  }

  _collectStateEvents (player) {
    const cfg = this.config;
    const data = {
      army: [],        // {t, delta} GLE steps
      buildings: [],
      research: [],
      expBonus: [],
      econ: [],        // {t, value} step-hold snapshots (not deltas)
      heroes: [],      // {t, delta} hero synthetic value steps
      heroDeaths: [],  // {t, level, killers[], battleId, reviveAt|null} — filled later
      momentum: []     // {t, kind, delta, battleId?} — filled later
    };

    for (const u of (player.units || [])) {
      if (u.isIllusion || u.isItem) continue;
      // Backfilled buildings (BuildingBackfill / SupplyBuildingBackfill) are
      // plausible but carry fabricated timestamps — often gameTime 0 — which
      // fabricates early-game strength leads. Confident-signals rule: skip
      // them; the real units they produced still count via their own costs.
      if (u.isInferred) continue;
      const isHero = !!(u.meta && u.meta.hero);
      const isWorker = !!(u.meta && u.meta.worker);
      const isSummon = !!u.summonDuration;
      if (isHero || isWorker || isSummon) continue;   // heroes: synthetic value; workers: econ term; summons: free
      if (!u.isBuilding && !u.isUnit) continue;

      const cost = this._unitGLE(u);
      if (cost <= 0) continue;

      // Starting assets (isSpawnedAtStart: equal object ids = existed at game
      // start) get spawnTime stamped when FIRST SELECTED, which varies by
      // seconds between players — price them at t=0 so a player who touches
      // their town hall late doesn't open the game "behind".
      const spendT = u.isSpawnedAtStart ? 0
                   : (u.spawnTime != null) ? u.spawnTime
                   : (u.constructionStartTime != null) ? u.constructionStartTime
                   : null;
      if (spendT == null) continue;

      const list = u.isBuilding ? data.buildings : data.army;
      list.push({ t: spendT, delta: cost });
      const lossT = this._confidentLossTime(u);
      if (lossT != null && lossT > spendT) list.push({ t: lossT, delta: -cost });
    }

    for (const r of (player.researchStream || [])) {
      const cost = this._gle(r.goldCost, r.lumberCost);
      if (cost > 0) data.research.push({ t: r.gameTime || 0, delta: cost });
    }

    for (const e of (player.eventStream || [])) {
      if (e.key === 'addBuilding' && e.isExpansion) {
        data.expBonus.push({ t: e.gameTime || 0, delta: cfg.expansionBonus });
      }
      if (e.workers && e.workers.totalWorkers != null) {
        const w = e.workers;
        data.econ.push({
          t: e.gameTime || 0,
          value: ((w.onGold || 0) + (w.onLumber || 0)) * cfg.workerEconValue +
                 (w.ghoulsOnLumber || 0) * cfg.workerEconValue * cfg.ghoulEconFactor
        });
      }
    }

    for (const list of [data.army, data.buildings, data.research, data.expBonus, data.econ]) {
      list.sort((a, b) => a.t - b.t);
    }
    return data;
  }

  // -------------------------------------------------------- hero death model

  _collectHeroDeaths (players, perPlayer) {
    const cfg = this.config;
    const battles = (this.world.battles || []);

    for (const player of players) {
      const data = perPlayer.get(player);
      const heroes = (player.units || []).filter(u => u.meta && u.meta.hero && !u.isIllusion);

      for (const hero of heroes) {
        if (hero.spawnTime == null) continue;

        // Base synthetic value: appears at spawn, steps on each level-up.
        data.heroes.push({ t: hero.spawnTime, delta: this._heroValue(1) });
        let prevLevel = 1;
        for (const lv of (hero.levelStream || [])) {
          const newLevel = lv.newLevel || prevLevel;
          if (newLevel > prevLevel) {
            data.heroes.push({
              t: lv.gameTime || 0,
              delta: this._heroValue(newLevel) - this._heroValue(prevLevel)
            });
            prevLevel = newLevel;
          }
        }

        // Mid-game deaths: every heroRevive for this hero proves a death.
        // Anchor the death at the latest preceding battle in which this hero
        // went possiblyDead (within the match window); killers = opposing
        // participants. No anchor → the death registers at the revive itself.
        let searchFrom = hero.spawnTime;
        const revives = (player.eventStream || []).filter(e =>
          e.key === 'heroRevive' && e.hero && e.hero.uuid === hero.uuid);
        for (const rev of revives) {
          const tRev = rev.gameTime || 0;
          let anchor = null;
          for (const b of battles) {
            const endT = b.endTime || 0;
            if (endT < searchFrom || endT > tRev) continue;
            if (tRev - endT > cfg.momentum.heroReviveMatchWindowMs) continue;
            const outcome = (b.unitOutcomes || []).find(o =>
              o.unitUuid === hero.uuid && (o.status === 'possiblyDead' || o.status === 'expired'));
            if (!outcome) continue;
            if (!anchor || endT > (anchor.endTime || 0)) anchor = b;
          }
          const deadAt = anchor ? Math.min(anchor.endTime, tRev) : tRev;
          const killers = anchor
            ? (anchor.participants || [])
                .filter(part => part.teamId !== player.teamId && part.playerId !== player.id)
                .map(part => part.playerId)
            : [];
          data.heroDeaths.push({
            t: deadAt,
            level: this._heroLevelAt(hero, deadAt),
            killers,
            battleId: anchor ? anchor.id : null,
            reviveAt: tRev
          });
          // Zero the synthetic value while dead.
          const v = this._heroValue(this._heroLevelAt(hero, deadAt));
          if (tRev > deadAt) {
            data.heroes.push({ t: deadAt, delta: -v });
            data.heroes.push({ t: tRev, delta: v });
          }
          searchFrom = tRev;
        }

        // End-of-game death: lostState 'lost' is battle-anchored ground truth
        // for heroes (identity guards forbid inferred hero deaths).
        const ls = hero.lostState;
        if (ls && ls.state === 'lost') {
          const deadAt = ls.since;
          data.heroDeaths.push({
            t: deadAt,
            level: this._heroLevelAt(hero, deadAt),
            killers: ls.killerPlayerIds || [],
            battleId: ls.killedInBattleId != null ? ls.killedInBattleId : null,
            reviveAt: null
          });
          data.heroes.push({ t: deadAt, delta: -this._heroValue(this._heroLevelAt(hero, deadAt)) });
        }
      }

      data.heroes.sort((a, b) => a.t - b.t);
      data.heroDeaths.sort((a, b) => a.t - b.t);
    }
  }

  // ------------------------------------------------------------- momentum

  _collectMomentumEvents (players, perPlayer) {
    const cfg = this.config.momentum;
    // Id sources differ in type across the codebase (camp credit keys are
    // strings, battle participants are numbers) — index both forms.
    const byId = new Map();
    for (const p of players) {
      byId.set(p.id, p);
      byId.set(String(p.id), p);
      byId.set(+p.id, p);
    }

    // Hero deaths → victim penalty + killer credit.
    for (const player of players) {
      const data = perPlayer.get(player);
      for (const death of data.heroDeaths) {
        data.momentum.push({
          t: death.t, kind: 'heroDeath', delta: cfg.heroDeathVictim,
          ...(death.battleId != null ? { battleId: death.battleId } : {})
        });
        for (const killerId of death.killers) {
          const killer = byId.get(killerId);
          if (!killer) continue;
          perPlayer.get(killer).momentum.push({
            t: death.t, kind: 'heroKill', delta: cfg.heroDeathKiller,
            ...(death.battleId != null ? { battleId: death.battleId } : {})
          });
        }
      }

      // Expansions and tier-ups.
      for (const e of (player.eventStream || [])) {
        if (e.key === 'addBuilding' && e.isExpansion) {
          data.momentum.push({ t: e.gameTime || 0, kind: 'expansion', delta: cfg.expansion });
        }
      }
      for (const tier of (player.tierStream || [])) {
        if ((tier.tier || 0) >= 2) {
          data.momentum.push({ t: tier.gameTime || 0, kind: 'tierUp', delta: cfg.tierUp });
        }
      }
    }

    // Camp clears with confident credit.
    const groups = Object.values(this.world.neutralGroups || {});
    for (const group of groups) {
      if (group.clearedTime == null) continue;
      const credits = group.playerCredit || {};
      for (const pid of Object.keys(credits)) {
        const credit = credits[pid];
        if (!credit || !credit.credited) continue;
        if ((credit.confidence || 0) < cfg.campCreditConfidenceMin) continue;
        const player = byId.get(+pid);
        if (!player) continue;
        perPlayer.get(player).momentum.push({
          t: group.clearedTime,
          kind: 'campClear',
          delta: Math.min(cfg.campCap, cfg.campPerLevel * (group.totalLevel || 1))
        });
      }
    }

    // Definite battle swings — unit losses only (hero deaths have their own
    // impulse above; subtract definite hero cost so one death can't fire two
    // overlapping penalties).
    for (const battle of (this.world.battles || [])) {
      const summary = battle.summary;
      if (!summary || !summary.perPlayer) continue;

      const teamLoss = {};
      const teamsInvolved = new Set();
      for (const part of (battle.participants || [])) {
        if (part.teamId != null) teamsInvolved.add(part.teamId);
      }
      if (teamsInvolved.size < 2) continue;   // camp clear / no PvP — no swing
      for (const teamId of teamsInvolved) teamLoss[teamId] = 0;

      for (const pid of Object.keys(summary.perPlayer)) {
        const entry = summary.perPlayer[pid];
        if (entry.teamId == null || !(entry.teamId in teamLoss)) continue;
        let loss = this._gle(entry.definite.gold, entry.definite.lumber);
        for (const hd of (entry.heroDeaths || [])) {
          if (hd.confidence !== 'definite') continue;
          const info = mappings.getUnitInfo(hd.itemId);
          const bi = info && info.balanceInfo;
          if (bi) loss -= this._gle(bi.goldCost, bi.lumberCost);
        }
        teamLoss[entry.teamId] += Math.max(0, loss);
      }

      for (const player of players) {
        const part = (battle.participants || []).find(x => x.playerId === player.id);
        if (!part || part.teamId == null) continue;
        const otherTeams = [...teamsInvolved].filter(tid => tid !== part.teamId);
        if (!otherTeams.length) continue;
        const otherLoss = otherTeams.reduce((acc, tid) => acc + teamLoss[tid], 0) / otherTeams.length;
        const swing = otherLoss - teamLoss[part.teamId];
        if (Math.abs(swing) < cfg.battleSwingMin) continue;
        const magnitude = Math.min(cfg.battleSwingCap, cfg.battleSwingFactor * Math.abs(swing));
        perPlayer.get(player).momentum.push({
          t: battle.endTime || 0,
          kind: 'battleSwing',
          delta: Math.sign(swing) * magnitude,
          battleId: battle.id
        });
      }
    }

    for (const player of players) {
      perPlayer.get(player).momentum.sort((a, b) => a.t - b.t || a.kind.localeCompare(b.kind));
    }
  }

  // ------------------------------------------------------------- sampling

  _buildTickList (gameEnd, players, perPlayer) {
    const cfg = this.config;
    const eventTimes = new Set();
    for (const player of players) {
      const data = perPlayer.get(player);
      for (const m of data.momentum) eventTimes.add(m.t);
      for (const d of data.heroDeaths) {
        eventTimes.add(d.t);
        if (d.reviveAt != null) eventTimes.add(d.reviveAt);
      }
    }

    const ticks = new Set([0, gameEnd]);
    for (const t of eventTimes) {
      if (t <= 0 || t > gameEnd) continue;
      ticks.add(t - 1);   // pre-event value → honest vertical step on lerp
      ticks.add(t);
    }

    const sortedEvents = [...eventTimes].sort((a, b) => a - b);
    const nearEvent = (t) => {
      // binary search for nearest event time
      let lo = 0, hi = sortedEvents.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (sortedEvents[mid] < t) lo = mid + 1;
        else hi = mid - 1;
      }
      const cands = [sortedEvents[lo - 1], sortedEvents[lo]];
      return cands.some(e => e != null && Math.abs(e - t) <= cfg.eventSampleMergeMs);
    };

    for (let t = 0; t <= gameEnd; t += cfg.sampleIntervalMs) {
      if (!nearEvent(t)) ticks.add(t);   // grid yields to event samples
    }

    return [...ticks].sort((a, b) => a - b);
  }

  _evaluateSeries (player, data, ticks, componentsUsed) {
    const cfg = this.config;
    const w = cfg.weights;
    const halfLife = cfg.momentum.halfLifeMs;
    const cutoff = halfLife * cfg.momentum.cutoffHalfLives;

    const cursors = { army: 0, buildings: 0, research: 0, expBonus: 0, econ: 0, heroes: 0, momStart: 0 };
    const acc = { army: 0, buildings: 0, research: 0, expBonus: 0, heroes: 0 };
    // Workers exist from game start but the first snapshot only lands with the
    // player's first action — backfill the step-hold with the first observed
    // value so a 1-second head start in acting doesn't read as an econ lead.
    let econValue = data.econ.length ? data.econ[0].value : 0;

    const samples = [];
    for (const t of ticks) {
      for (const key of ['army', 'buildings', 'research', 'expBonus', 'heroes']) {
        const list = data[key];
        while (cursors[key] < list.length && list[cursors[key]].t <= t) {
          acc[key] += list[cursors[key]].delta;
          cursors[key]++;
        }
      }
      while (cursors.econ < data.econ.length && data.econ[cursors.econ].t <= t) {
        econValue = data.econ[cursors.econ].value;
        cursors.econ++;
      }

      let mom = 0;
      while (cursors.momStart < data.momentum.length && data.momentum[cursors.momStart].t + cutoff < t) {
        cursors.momStart++;
      }
      for (let i = cursors.momStart; i < data.momentum.length; i++) {
        const m = data.momentum[i];
        if (m.t > t) break;
        mom += m.delta * Math.pow(2, -(t - m.t) / halfLife);
      }

      const c = {
        army: componentsUsed.army ? Math.max(0, acc.army) : 0,
        hero: componentsUsed.hero ? Math.max(0, acc.heroes) : 0,
        econ: componentsUsed.econ ? econValue : 0,
        tech: componentsUsed.tech ? Math.max(0, acc.research + acc.buildings) : 0,
        exp: componentsUsed.exp ? acc.expBonus : 0
      };
      const struct =
        w.army * c.army +
        w.hero * c.hero +
        w.econ * c.econ +
        (componentsUsed.tech ? (w.techResearch * Math.max(0, acc.research) + w.techBuildings * Math.max(0, acc.buildings)) : 0) +
        w.exp * c.exp;

      samples.push({ t, struct, mom, c, score: 0, sEff: 0 });
    }

    // Strength = growth since game start. Races start with different-priced
    // kits (5 peons vs 3 acolytes + ghoul + haunted mine ...) even though the
    // game is balanced by design — subtracting each player's own t=0 baseline
    // makes the opening exactly even for every matchup, and losing part of
    // the starting kit later still reads as (correctly) falling behind.
    const baseline = samples.length ? samples[0].struct : 0;
    for (const s of samples) {
      s.sEff = Math.max(0, cfg.seedStrength + (s.struct - baseline) + s.mom);
      delete s.struct;
    }
    return { samples };
  }
}

module.exports = DominanceSeries;
