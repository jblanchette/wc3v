// ReplayAnalyzer — pure scoring function over two summary JSONs.
//
// Inputs are summaries (the small JSON in client/data/summaries/{id}.json,
// not the full .wc3v.gz). Output is a ReportCard with per-category scores,
// letter grades, an overall grade, and a list of itemised findings.
//
// Hard guardrails come first — duration mismatch, race mismatch, map
// mismatch, pro-result, archetype mismatch — and decide which categories are
// scored vs marked N/A. Without these, scoring 3-min losses against 25-min
// pro wins produces meaningless letter grades.
//
// Each scored category exposes a `detail` payload alongside its score so the
// compare modal can drill in (sample-by-sample charts, per-event timelines,
// specific divergence moments) without re-running the analyzer.

const ReplayAnalyzer = (() => {
  // 15-tier letter grade scale: A+ A A- B+ B B- C+ C C- D+ D D- F+ F F-.
  const GRADE_THRESHOLDS = [
    { min: 97, grade: 'A+' },
    { min: 93, grade: 'A'  },
    { min: 90, grade: 'A-' },
    { min: 87, grade: 'B+' },
    { min: 83, grade: 'B'  },
    { min: 80, grade: 'B-' },
    { min: 77, grade: 'C+' },
    { min: 73, grade: 'C'  },
    { min: 70, grade: 'C-' },
    { min: 67, grade: 'D+' },
    { min: 63, grade: 'D'  },
    { min: 60, grade: 'D-' },
    { min: 50, grade: 'F+' },
    { min: 30, grade: 'F'  },
    { min: 0,  grade: 'F-' }
  ];
  const gradeFor = (s) => {
    for (const t of GRADE_THRESHOLDS) if (s >= t.min) return t.grade;
    return 'F-';
  };

  // Default weights for the overall score. Each is dropped from the average
  // when its category is unavailable. With 9 dimensions, single weights are
  // smaller — one missing category doesn't throw the overall off badly.
  const DEFAULT_WEIGHTS = {
    macro:           0.20,
    tech:            0.18,
    buildAdherence:  0.15,
    production:      0.10,
    expansion:       0.07,
    heroSkillBuild:  0.10,
    upgrades:        0.10,
    itemEconomy:     0.05,
    idleResources:   0.05
  };

  // Tolerance windows in ms.
  const TIER_TOLERANCE_MS      = 60 * 1000;
  const HERO_TOLERANCE_MS      = 90 * 1000;
  const EXPANSION_TOLERANCE_MS = 120 * 1000;
  const UPGRADE_TOLERANCE_MS   = 90 * 1000;

  // ===== Public surface =====

  const compare = ({ userSummary, userSlot, proSummary, proSlot, proResult = 'unknown' }) => {
    if (!userSummary || !proSummary) {
      throw new Error('compare requires userSummary and proSummary');
    }
    const u = userSummary.players && userSummary.players[String(userSlot)];
    const p = proSummary.players && proSummary.players[String(proSlot)];
    if (!u || !p) {
      throw new Error('player slots not found in summaries');
    }

    const guards = computeGuards({ userSummary, proSummary, u, p, proResult });
    const warnings = [];
    if (!guards.durationOk) warnings.push('Game ended too early to compare meaningfully');
    if (!guards.matchupCompatible) warnings.push('Different matchups — build adherence not scored');
    if (!guards.mapCompatible) warnings.push('Different maps — expansion timing not scored');
    if (!guards.archetypeCompatible) warnings.push(`Different archetypes (${u.archetype || '?'} vs ${p.archetype || '?'}) — build adherence falls back to general timing`);
    if (proResult === 'loss') warnings.push('This pro lost — take advice with a grain of salt');

    let categories;
    if (!guards.durationOk) {
      const tooShort = () => ({
        score: 0, grade: 'N/A', findings: [], available: false,
        reason: 'Game ended too early to compare meaningfully',
        detail: null
      });
      categories = {
        macro:          tooShort(),
        tech:           tooShort(),
        expansion:      tooShort(),
        buildAdherence: tooShort(),
        production:     tooShort(),
        heroSkillBuild: tooShort(),
        upgrades:       tooShort(),
        itemEconomy:    tooShort(),
        idleResources:  tooShort()
      };
    } else {
      categories = {
        macro:          scoreMacro(u, p, guards),
        tech:           scoreTech(u, p, guards),
        expansion:      scoreExpansion(u, p, guards),
        buildAdherence: scoreBuildAdherence(u, p, guards),
        production:     scoreProduction(u, p, guards),
        heroSkillBuild: scoreHeroSkillBuild(u, p, guards),
        upgrades:       scoreUpgrades(u, p, guards),
        itemEconomy:    scoreItemEconomy(u, p, guards),
        idleResources:  scoreIdleResources(u, p, guards)
      };
    }

    if (proResult === 'loss') {
      for (const k of Object.keys(categories)) {
        if (categories[k].available) {
          categories[k].score = Math.round(categories[k].score * 0.7);
          categories[k].grade = gradeFor(categories[k].score);
        }
      }
    }

    let weightedSum = 0;
    let totalWeight = 0;
    for (const k of Object.keys(categories)) {
      const cat = categories[k];
      if (!cat.available) continue;
      const w = DEFAULT_WEIGHTS[k] || 0;
      weightedSum += cat.score * w;
      totalWeight += w;
    }
    const overallScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;

    return {
      overall: { score: overallScore, grade: totalWeight > 0 ? gradeFor(overallScore) : 'N/A' },
      categories,
      guards,
      compatibility: buildCompatibilityChecklist({ userSummary, proSummary, u, p, guards, proResult }),
      warnings,
      meta: {
        userPlayer: { slot: userSlot, name: u.name, race: u.race, archetype: u.archetype },
        proPlayer: { slot: proSlot, name: p.name, race: p.race, archetype: p.archetype },
        userMap: userSummary.map,
        proMap: proSummary.map,
        userDuration: userSummary.durationMs,
        proDuration: proSummary.durationMs
      }
    };
  };

  const buildCompatibilityChecklist = ({ userSummary, proSummary, u, p, guards, proResult }) => {
    const out = [];
    const fmtRaces = (s) => playerRaces(s).filter(r => r !== 'R').sort().join('v');

    out.push({
      key: 'race',
      label: 'Same race',
      status: u.race === p.race ? 'match' : 'mismatch',
      detail: u.race === p.race ? `Both ${u.race}` : `You: ${u.race} · Pro: ${p.race}`
    });

    const userMu = fmtRaces(userSummary), proMu = fmtRaces(proSummary);
    out.push({
      key: 'matchup',
      label: 'Same matchup',
      status: guards.matchupCompatible ? 'match' : 'mismatch',
      detail: guards.matchupCompatible ? `${userMu || u.race}` : `You: ${userMu} · Pro: ${proMu}`
    });

    out.push({
      key: 'archetype',
      label: 'Same build archetype',
      status: guards.archetypeCompatible
        ? 'match'
        : (u.archetype === 'unknown' || p.archetype === 'unknown' ? 'unknown' : 'partial'),
      detail: guards.archetypeCompatible
        ? prettyArchetype(u.archetype)
        : `You: ${prettyArchetype(u.archetype)} · Pro: ${prettyArchetype(p.archetype)}`
    });

    const userMapPretty = prettyMap(userSummary.map);
    const proMapPretty = prettyMap(proSummary.map);
    out.push({
      key: 'map',
      label: 'Same map',
      status: guards.mapCompatible ? 'match' : 'partial',
      detail: guards.mapCompatible ? userMapPretty : `You: ${userMapPretty || '?'} · Pro: ${proMapPretty || '?'}`
    });

    out.push({
      key: 'duration',
      label: 'Comparable game length',
      status: guards.durationOk ? 'match' : 'mismatch',
      detail: guards.durationOk
        ? `Yours ${formatMs(userSummary.durationMs)}, pro ${formatMs(proSummary.durationMs)}`
        : `Your replay was much shorter (${formatMs(userSummary.durationMs)} vs ${formatMs(proSummary.durationMs)})`
    });

    if (proResult === 'loss') {
      out.push({
        key: 'pro_result',
        label: 'Pro won this game',
        status: 'partial',
        detail: 'This pro lost — take advice with a grain of salt'
      });
    }

    return out;
  };

  const prettyArchetype = (a) => {
    const map = {
      'fast-expand': 'Fast Expand',
      '1-base-t2':   '1-base T2',
      'tower-rush':  'Tower Rush',
      'tech':        'Fast Tech',
      'unknown':     'Unclassified'
    };
    return map[a] || a || 'Unknown';
  };

  // ===== Guardrails =====

  const computeGuards = ({ userSummary, proSummary, u, p, proResult }) => {
    const userDur = userSummary.durationMs || 0;
    const proDur = proSummary.durationMs || 0;

    const ratio = (proDur > 0 && userDur > 0)
      ? Math.min(userDur, proDur) / Math.max(userDur, proDur)
      : 0;
    const durationOk = ratio >= 0.6 && Math.min(userDur, proDur) >= 90_000;

    const userRaces = playerRaces(userSummary).sort().join('');
    const proRaces = playerRaces(proSummary).sort().join('');
    const matchupCompatible = u.race === p.race && userRaces === proRaces;

    const mapCompatible = sameMap(userSummary.map, proSummary.map);

    const archetypeCompatible = u.archetype && p.archetype && u.archetype !== 'unknown' && u.archetype === p.archetype;

    return {
      durationOk,
      matchupCompatible,
      mapCompatible,
      archetypeCompatible,
      proWon: proResult === 'win',
      proResult
    };
  };

  // ===== Per-category scorers =====

  // Detect supply-block runs in the user's economyTrack: contiguous samples
  // where supplyUsed >= supplyMax (and supplyMax > 0 so initial/zero state
  // doesn't count). Returns the worst run + total blocked duration.
  const detectSupplyBlocks = (track) => {
    const blocks = [];
    let cur = null;
    for (const s of (track || [])) {
      const blocked = s.supplyMax > 0 && s.supplyUsed >= s.supplyMax;
      if (blocked && !cur) cur = { startMs: s.gameTimeMs, endMs: s.gameTimeMs, supplyMax: s.supplyMax };
      else if (blocked && cur) cur.endMs = s.gameTimeMs;
      else if (cur) { blocks.push({ ...cur, durationMs: cur.endMs - cur.startMs }); cur = null; }
    }
    if (cur) blocks.push({ ...cur, durationMs: cur.endMs - cur.startMs });
    let worst = null;
    let total = 0;
    for (const b of blocks) {
      total += b.durationMs;
      if (!worst || b.durationMs > worst.durationMs) worst = b;
    }
    return { blocks, worst, totalMs: total };
  };

  // Macro: integrate worker + supply gap over the economyTrack samples plus
  // detect supply-blocks. Findings are action-oriented (headline = imperative
  // verb, text = explanation, optional metric + viz hint).
  const scoreMacro = (u, p, guards) => {
    if (!u.economyTrack || !p.economyTrack || !u.economyTrack.length || !p.economyTrack.length) {
      return na('no economy data');
    }
    const findings = [];

    const endMs = Math.min(
      u.economyTrack[u.economyTrack.length - 1].gameTimeMs,
      p.economyTrack[p.economyTrack.length - 1].gameTimeMs
    );
    if (endMs <= 0) return na('overlapping time too short');

    let supplyDeltaSum = 0;
    let supplyMaxRefSum = 0;
    let workerDeltaSum = 0;
    let samples = 0;
    const series = [];
    let worstGap = { gameTimeMs: 0, supplyDelta: 0, workerDelta: 0 };
    let earlyWorker = null; // gap at ~5:00 if available
    for (let t = 30_000; t <= endMs; t += 30_000) {
      const us = sampleAt(u.economyTrack, t);
      const ps = sampleAt(p.economyTrack, t);
      if (!us || !ps) continue;
      const supplyDelta = Math.max(0, ps.supplyUsed - us.supplyUsed);
      const workerDelta = Math.max(0, (ps.totalWorkers || 0) - (us.totalWorkers || 0));
      supplyDeltaSum += supplyDelta;
      supplyMaxRefSum += Math.max(1, ps.supplyUsed);
      workerDeltaSum += workerDelta;
      samples += 1;
      series.push({
        gameTimeMs: t,
        userSupply: us.supplyUsed,
        proSupply: ps.supplyUsed,
        userWorkers: us.totalWorkers || 0,
        proWorkers: ps.totalWorkers || 0,
        supplyDelta, workerDelta
      });
      if (t === 300_000 || (t >= 270_000 && t <= 330_000 && !earlyWorker)) {
        earlyWorker = {
          gameTimeMs: t,
          userWorkers: us.totalWorkers || 0,
          proWorkers: ps.totalWorkers || 0
        };
      }
      const combined = supplyDelta + workerDelta;
      if (combined > (worstGap.supplyDelta + worstGap.workerDelta)) {
        worstGap = { gameTimeMs: t, supplyDelta, workerDelta };
      }
    }
    if (samples === 0) return na('no overlapping samples');

    const supplyRatio = supplyDeltaSum / supplyMaxRefSum;
    const supplyScore = Math.max(0, Math.min(1, 1 - supplyRatio * 1.5));
    const workerDeltaAvg = workerDeltaSum / samples;
    const workerScore = Math.max(0, Math.min(1, 1 - workerDeltaAvg / 10));
    const score = Math.round((0.6 * supplyScore + 0.4 * workerScore) * 100);

    // ── Action-oriented findings ──

    // 1. Supply-block detection (highest priority macro lesson)
    const blocks = detectSupplyBlocks(u.economyTrack);
    if (blocks.worst && blocks.worst.durationMs >= 30_000) {
      const dur = Math.round(blocks.worst.durationMs / 1000);
      findings.push({
        severity: 'warn',
        headline: "Don't supply-block",
        text: `Hit supply max at ${formatMs(blocks.worst.startMs)} and stalled production for ${dur}s. Build farms before they fill.`,
        metric: { label: `${dur}s blocked` },
        vizType: 'supply',
        vizData: series
      });
    }

    // 2. Workers behind early — most teachable single number
    const supplyAvg = supplyDeltaSum / samples;
    if (earlyWorker && (earlyWorker.proWorkers - earlyWorker.userWorkers) >= 3) {
      const gap = earlyWorker.proWorkers - earlyWorker.userWorkers;
      findings.push({
        severity: 'warn',
        headline: 'Pump workers continuously',
        text: `Pro had ${earlyWorker.proWorkers} workers at ${formatMs(earlyWorker.gameTimeMs)}, you had ${earlyWorker.userWorkers}. Train one every time your hall frees up.`,
        metric: { label: `${gap} behind at ${formatMs(earlyWorker.gameTimeMs)}` },
        vizType: 'workers',
        vizData: series
      });
    } else if (workerDeltaAvg > 2) {
      findings.push({
        severity: 'warn',
        headline: 'Pump workers continuously',
        text: `Averaged ${workerDeltaAvg.toFixed(1)} workers behind. Queue a worker as soon as your hall is free — never let it idle.`,
        metric: { label: `${workerDeltaAvg.toFixed(1)} avg behind` },
        vizType: 'workers',
        vizData: series
      });
    }

    // 3. Worst combined gap (if it's clearly worse than averages and not
    // already covered by the worker finding above)
    if (worstGap.gameTimeMs > 0 && (worstGap.supplyDelta + worstGap.workerDelta) >= 8
        && !findings.some(f => f.headline === 'Pump workers continuously')) {
      findings.push({
        severity: 'info',
        headline: 'Close the snowball gap',
        text: `Biggest gap at ${formatMs(worstGap.gameTimeMs)}: ${worstGap.supplyDelta} supply and ${worstGap.workerDelta} workers behind.`,
        metric: { label: `${formatMs(worstGap.gameTimeMs)}` }
      });
    }

    return {
      score, grade: gradeFor(score), findings, available: true,
      detail: { series, worstGap, supplyAvgBehind: supplyAvg, workerAvgBehind: workerDeltaAvg, blocks }
    };
  };

  // Tech: average of weighted ratios for {T2, T3, hero L2/L3/L5}. Findings
  // emit one action per significantly-late milestone (≥ tolerance/2 late).
  const scoreTech = (u, p, guards) => {
    if (!guards.matchupCompatible) return na('different matchups');
    const findings = [];
    const checks = [
      { key: 'T2',      ut: u.tier2Time,           pt: p.tier2Time,           tol: TIER_TOLERANCE_MS, headline: 'Reach Tier 2 faster',     advice: 'Start the upgrade as soon as you have the gold and a free hall.' },
      { key: 'T3',      ut: u.tier3Time,           pt: p.tier3Time,           tol: TIER_TOLERANCE_MS, headline: 'Tier up to Tier 3 faster', advice: 'Don\'t let lumber pile up before T3 — start the upgrade the moment you can afford it.' },
      { key: 'Hero L2', ut: u.firstHeroLevel2Time, pt: p.firstHeroLevel2Time, tol: HERO_TOLERANCE_MS, headline: 'Get Hero L2 faster',      advice: 'Take a green camp early — your hero is dramatically stronger at L2.' },
      { key: 'Hero L3', ut: u.firstHeroLevel3Time, pt: p.firstHeroLevel3Time, tol: HERO_TOLERANCE_MS, headline: 'Get Hero L3 faster',      advice: 'Chain creep camps. L3 unlocks your second skill rank — huge power spike.' },
      { key: 'Hero L5', ut: u.firstHeroLevel5Time, pt: p.firstHeroLevel5Time, tol: HERO_TOLERANCE_MS, headline: 'Reach Hero L5 faster',    advice: 'Keep creeping into mid-game. L5 = ultimate, the biggest tempo lever you have.' }
    ];
    let count = 0, sum = 0;
    const milestones = [];
    for (const c of checks) {
      const { key, ut, pt, tol, headline, advice } = c;
      if (pt == null) continue;
      count += 1;
      if (ut == null) {
        sum += 0;
        findings.push({
          severity: 'warn',
          headline,
          text: `Pro reached ${key} at ${formatMs(pt)}; you didn't reach it. ${advice}`,
          metric: { label: `pro ${formatMs(pt)}` }
        });
        milestones.push({ label: key, userMs: null, proMs: pt, deltaSec: null });
        continue;
      }
      const deltaSec = (ut - pt) / 1000;
      const norm = Math.max(0, Math.min(1, 1 - Math.abs(ut - pt) / tol));
      sum += norm;
      milestones.push({ label: key, userMs: ut, proMs: pt, deltaSec });
      if (deltaSec > tol / 1000 / 2) {
        findings.push({
          severity: 'warn',
          headline,
          text: `Pro hit ${key} at ${formatMs(pt)}; you took until ${formatMs(ut)} (${Math.abs(deltaSec).toFixed(0)}s late). ${advice}`,
          metric: { label: `${Math.round(deltaSec)}s late` }
        });
      } else if (deltaSec < -tol / 1000 / 2) {
        findings.push({
          severity: 'good',
          headline: `${key} ahead of pro`,
          text: `${key} at ${formatMs(ut)} vs pro ${formatMs(pt)} — nice tempo.`,
          metric: { label: `${Math.abs(Math.round(deltaSec))}s early` }
        });
      }
    }
    if (count === 0) return na('no tech timings to compare');
    const score = Math.round((sum / count) * 100);
    return { score, grade: gradeFor(score), findings, available: true, detail: { milestones } };
  };

  const scoreExpansion = (u, p, guards) => {
    if (!guards.mapCompatible) return na('different maps');
    if (p.expansionTime == null) return na('pro did not expand');
    const findings = [];
    if (u.expansionTime == null) {
      findings.push({
        severity: 'warn',
        headline: 'Take an expansion',
        text: `Pro expanded at ${formatMs(p.expansionTime)} on this map. A second hall funds upgrades and tier-up production.`,
        metric: { label: `pro at ${formatMs(p.expansionTime)}` }
      });
      return {
        score: 30, grade: gradeFor(30), findings, available: true,
        detail: { userMs: null, proMs: p.expansionTime, deltaSec: null }
      };
    }
    const deltaSec = (u.expansionTime - p.expansionTime) / 1000;
    const norm = Math.max(0, Math.min(1, 1 - Math.abs(u.expansionTime - p.expansionTime) / EXPANSION_TOLERANCE_MS));
    const score = Math.round(norm * 100);
    if (deltaSec > 30) {
      findings.push({
        severity: 'warn',
        headline: 'Expand earlier',
        text: `Pro took an expansion at ${formatMs(p.expansionTime)}; yours came at ${formatMs(u.expansionTime)} (${Math.round(deltaSec)}s late). Earlier expansions snowball into more production.`,
        metric: { label: `${Math.round(deltaSec)}s late` }
      });
    } else if (deltaSec < -30) {
      findings.push({
        severity: 'good',
        headline: 'Expansion ahead of pro',
        text: `You expanded at ${formatMs(u.expansionTime)} vs pro ${formatMs(p.expansionTime)} — nice initiative.`,
        metric: { label: `${Math.abs(Math.round(deltaSec))}s early` }
      });
    }
    return {
      score, grade: gradeFor(score), findings, available: true,
      detail: { userMs: u.expansionTime, proMs: p.expansionTime, deltaSec }
    };
  };

  const scoreBuildAdherence = (u, p, guards) => {
    if (!guards.matchupCompatible) return na('different matchups');
    if (!u.buildPreview || !p.buildPreview) return na('no build preview');

    if (!guards.archetypeCompatible) {
      const userIds = new Set((u.buildPreview || []).map(b => b.itemId));
      const overlap = (p.buildPreview || []).filter(b => userIds.has(b.itemId)).length;
      const score = Math.round(Math.min(1, overlap / Math.max(1, p.buildPreview.length)) * 100 * 0.7);
      return {
        score, grade: gradeFor(score),
        findings: [{
          severity: 'info',
          headline: 'Try the pro\'s archetype',
          text: `You played ${u.archetype}; pro played ${p.archetype}. Build-order grading uses set-overlap when archetypes differ.`
        }],
        available: true,
        reason: 'archetype-degraded',
        detail: { setOverlapCount: overlap, userPreview: u.buildPreview, proPreview: p.buildPreview, divergencePoint: null }
      };
    }

    const userSeq = (u.buildPreview || []).map(b => b.itemId);
    const proSeq = (p.buildPreview || []).map(b => b.itemId);
    const lcsLen = lcs(userSeq, proSeq);
    const score = Math.round((lcsLen / Math.max(1, proSeq.length)) * 100);

    // Find the first divergence point (earliest index where the two sequences
    // disagree). The Top Fixes finding names the specific buildings.
    let divergencePoint = null;
    const divLen = Math.min(userSeq.length, proSeq.length);
    for (let i = 0; i < divLen; i++) {
      if (userSeq[i] !== proSeq[i]) {
        divergencePoint = { index: i, userBuilding: u.buildPreview[i], proBuilding: p.buildPreview[i] };
        break;
      }
    }

    const findings = [];
    if (divergencePoint) {
      const ub = divergencePoint.userBuilding;
      const pb = divergencePoint.proBuilding;
      findings.push({
        severity: 'warn',
        headline: `Open with ${pb.name}, not ${ub.name}`,
        text: `Builds matched through event ${divergencePoint.index}. At ${formatMs(ub.gameTimeMs)} you built ${ub.name}; pros build ${pb.name} first in this opener.`,
        metric: { label: `event ${divergencePoint.index + 1}` }
      });
    } else if (lcsLen < proSeq.length * 0.5) {
      findings.push({
        severity: 'warn',
        headline: 'Match the pro opening order',
        text: `Only ${lcsLen}/${proSeq.length} of the pro's first 20 events matched. Walk through the Build tab to see the divergence.`,
        metric: { label: `${lcsLen}/${proSeq.length} match` }
      });
    }

    return {
      score, grade: gradeFor(score), findings, available: true,
      detail: { lcsLen, proLen: proSeq.length, divergencePoint, userPreview: u.buildPreview, proPreview: p.buildPreview }
    };
  };

  // Production: per-minute combat-unit count across the 5–15 minute window.
  // Uses combatUnitsTrack when present (newer summaries); falls back to the
  // single-snapshot 10:00 count from buildPreview.
  const scoreProduction = (u, p, guards) => {
    const FIVE_MIN = 5 * 60 * 1000;
    const FIFTEEN_MIN = 15 * 60 * 1000;
    if (u.combatUnitsTrack && p.combatUnitsTrack && u.combatUnitsTrack.length && p.combatUnitsTrack.length) {
      const findings = [];
      const samples = [];
      let userArea = 0, proArea = 0, n = 0;
      const endMs = Math.min(
        u.combatUnitsTrack[u.combatUnitsTrack.length - 1].gameTimeMs,
        p.combatUnitsTrack[p.combatUnitsTrack.length - 1].gameTimeMs,
        FIFTEEN_MIN
      );
      for (let t = FIVE_MIN; t <= endMs; t += 30_000) {
        const us = sampleAt(u.combatUnitsTrack, t);
        const ps = sampleAt(p.combatUnitsTrack, t);
        if (!us || !ps) continue;
        userArea += us.count;
        proArea += ps.count;
        n += 1;
        samples.push({ gameTimeMs: t, userCount: us.count, proCount: ps.count });
      }
      if (n === 0 || proArea === 0) {
        // Fall through to legacy single-snapshot scoring.
      } else {
        const ratio = Math.min(1, userArea / proArea);
        const score = Math.round(ratio * 100);
        const userAvg = Math.round(userArea / n);
        const proAvg = Math.round(proArea / n);
        if (userArea < proArea * 0.7) {
          findings.push({
            severity: 'warn',
            headline: 'Keep production halls firing',
            text: `Averaged ${userAvg} combat units vs pro ${proAvg} between 5:00–15:00. Don't let your barracks/altar/etc idle — queue the next unit the moment one finishes.`,
            metric: { label: `${userAvg} vs ${proAvg}` }
          });
        }
        return { score, grade: gradeFor(score), findings, available: true, detail: { samples, userAvg: userArea/n, proAvg: proArea/n } };
      }
    }
    // Fallback: legacy 10:00 snapshot from buildPreview.
    if (!u.buildPreview || !p.buildPreview) return na('no build preview');
    const TEN_MIN = 10 * 60 * 1000;
    const countUnits = (preview) => preview.filter(e => e.type === 'unit' && e.gameTimeMs <= TEN_MIN).length;
    const userU = countUnits(u.buildPreview);
    const proU = countUnits(p.buildPreview);
    if (proU === 0) return na('pro produced no units in window');
    const ratio = Math.min(1, userU / proU);
    const score = Math.round(ratio * 100);
    const findings = [];
    if (userU < proU) {
      findings.push({
        severity: 'warn',
        headline: 'Keep production halls firing',
        text: `${userU} combat units in the first 10:00 vs pro ${proU}. Queue your next unit as soon as a hall frees up.`,
        metric: { label: `${userU} vs ${proU}` }
      });
    }
    return { score, grade: gradeFor(score), findings, available: true, detail: { userCount: userU, proCount: proU, snapshot: '10:00' } };
  };

  // ===== NEW SCORERS =====

  // Hero skill build: same hero (matchup + race assumed). Compares the
  // ordered skillOrder arrays of the FIRST hero on each side. Each pick is
  // a (heroLevel, skillName) tuple; score = #matching picks / #pro picks.
  const scoreHeroSkillBuild = (u, p, guards) => {
    if (!guards.matchupCompatible) return na('different matchups');
    const userHero = (u.heroBuilds || [])[0];
    const proHero = (p.heroBuilds || [])[0];
    if (!userHero || !proHero) return na('hero data missing');
    if (userHero.itemId !== proHero.itemId) {
      return na(`different heroes (you: ${userHero.name}, pro: ${proHero.name})`);
    }
    const userPicks = userHero.skillOrder || [];
    const proPicks = proHero.skillOrder || [];
    if (proPicks.length === 0) return na('pro hero never leveled');

    // Compare aligned picks (level by level). The first divergence drives the
    // headline finding — that's the most teachable single moment.
    const findings = [];
    const aligned = [];
    let matches = 0;
    const limit = Math.min(proPicks.length, 7); // first 7 picks (up to L7)
    let firstDivergence = null;
    for (let i = 0; i < limit; i++) {
      const userP = userPicks[i] || null;
      const proP = proPicks[i];
      const isMatch = userP && userP.skillName === proP.skillName;
      if (isMatch) matches += 1;
      aligned.push({ heroLevel: proP.heroLevel, userPick: userP, proPick: proP, match: isMatch });
      if (!isMatch && !firstDivergence) firstDivergence = { proP, userP };
    }
    if (firstDivergence) {
      const { proP, userP } = firstDivergence;
      const heroLabel = (proHero.name || 'Hero');
      findings.push({
        severity: 'warn',
        headline: `Pick ${proP.skillName} at Hero L${proP.heroLevel}`,
        text: userP
          ? `At ${heroLabel} L${proP.heroLevel} pros learn ${proP.skillName}; you picked ${userP.skillName}. The pro pick is the standard for this matchup.`
          : `At ${heroLabel} L${proP.heroLevel} pros learn ${proP.skillName}; you didn't level your hero by then.`,
        metric: { label: `L${proP.heroLevel} pick` }
      });
    }
    const score = Math.round((matches / limit) * 100);
    return {
      score, grade: gradeFor(score), findings, available: true,
      detail: {
        heroName: proHero.name,
        heroItemId: proHero.itemId,
        userPicks, proPicks, aligned
      }
    };
  };

  // Upgrades: compares attack / defense / ability research.
  // Score = avg of timing-closeness for each upgrade the pro got, where
  // missing-but-pro-got = 0 for that upgrade.
  const scoreUpgrades = (u, p, guards) => {
    if (!guards.matchupCompatible) return na('different matchups');
    const userUpg = u.upgradeTimeline || [];
    const proUpg = p.upgradeTimeline || [];
    if (proUpg.length === 0) return na('pro researched nothing');

    const userByKey = {};
    for (const r of userUpg) {
      const key = `${r.itemId}@${r.level}`;
      if (!userByKey[key]) userByKey[key] = r;
    }

    const findings = [];
    const matched = [];
    let sum = 0, count = 0;
    for (const proR of proUpg) {
      count += 1;
      const key = `${proR.itemId}@${proR.level}`;
      const userR = userByKey[key];
      const lvlSuffix = proR.level > 1 ? ` L${proR.level}` : '';
      if (!userR) {
        sum += 0;
        matched.push({ pro: proR, user: null, deltaSec: null });
        findings.push({
          severity: 'warn',
          headline: `Research ${proR.name}${lvlSuffix}`,
          text: `Pro had this at ${formatMs(proR.gameTimeMs)}; you didn't research it. ${categoryAdvice(proR.category)}`,
          metric: { label: `pro ${formatMs(proR.gameTimeMs)}` }
        });
        continue;
      }
      const deltaMs = userR.gameTimeMs - proR.gameTimeMs;
      const norm = Math.max(0, Math.min(1, 1 - Math.abs(deltaMs) / UPGRADE_TOLERANCE_MS));
      sum += norm;
      matched.push({ pro: proR, user: userR, deltaSec: deltaMs / 1000 });
      if (deltaMs > UPGRADE_TOLERANCE_MS / 2) {
        findings.push({
          severity: 'warn',
          headline: `Get ${proR.name}${lvlSuffix} earlier`,
          text: `Pro at ${formatMs(proR.gameTimeMs)}; yours at ${formatMs(userR.gameTimeMs)} (${Math.round(deltaMs/1000)}s late). ${categoryAdvice(proR.category)}`,
          metric: { label: `${Math.round(deltaMs/1000)}s late` }
        });
      } else if (deltaMs < -UPGRADE_TOLERANCE_MS / 2) {
        findings.push({
          severity: 'good',
          headline: `${proR.name}${lvlSuffix} ahead of pro`,
          text: `${formatMs(userR.gameTimeMs)} vs pro ${formatMs(proR.gameTimeMs)} — strong upgrade tempo.`,
          metric: { label: `${Math.abs(Math.round(deltaMs/1000))}s early` }
        });
      }
    }
    const score = Math.round((sum / count) * 100);
    return {
      score, grade: gradeFor(score), findings, available: true,
      detail: { matched, userTimeline: userUpg, proTimeline: proUpg }
    };
  };

  // Generic per-category advice snippet for upgrade findings. Kept short
  // and matchup-agnostic — better to be useful than over-specific.
  const categoryAdvice = (cat) => {
    if (cat === 'attack') return 'Attack upgrades win army-vs-army fights — they pay off the moment you finish them.';
    if (cat === 'defense') return 'Defense upgrades drastically reduce hero damage taken in early skirmishes.';
    return 'Critical research often gates your strongest mid-game options.';
  };

  // Item economy: compares hero items purchased. Race-compatible only (item
  // catalog is largely shared but heroes carry items differently). Score is
  // set-overlap weighted by gold cost — pros usually buy specific items
  // (boots of speed, scroll of regen, talisman of evasion) at specific times.
  const scoreItemEconomy = (u, p, guards) => {
    if (u.race !== p.race) return na('different races');
    const userItems = u.itemPurchases || [];
    const proItems = p.itemPurchases || [];
    if (proItems.length === 0 && userItems.length === 0) return na('neither side bought items');

    const userIds = {};
    let userGold = 0;
    for (const it of userItems) {
      userIds[it.itemId] = (userIds[it.itemId] || 0) + 1;
      userGold += (it.goldCost || 0);
    }
    const proIds = {};
    let proGold = 0;
    for (const it of proItems) {
      proIds[it.itemId] = (proIds[it.itemId] || 0) + 1;
      proGold += (it.goldCost || 0);
    }

    // Match score: of each item type the pro bought, did the user buy it too?
    const findings = [];
    const missing = [];
    const matchedByType = [];
    let proTypes = 0, matchedTypes = 0;
    // Sort missing items by earliest pro purchase time so the most teachable
    // (earliest) item leads the headline.
    const missingByTime = [];
    for (const id of Object.keys(proIds)) {
      proTypes += 1;
      if (userIds[id]) {
        matchedTypes += 1;
        matchedByType.push({ itemId: id, userCount: userIds[id], proCount: proIds[id] });
      } else {
        const proRef = proItems.find(x => x.itemId === id);
        missing.push(proRef);
        missingByTime.push(proRef);
      }
    }
    missingByTime.sort((a, b) => (a.gameTimeMs || 0) - (b.gameTimeMs || 0));
    if (missingByTime.length) {
      const first = missingByTime[0];
      findings.push({
        severity: 'warn',
        headline: `Buy ${first.name} early`,
        text: `Pro picked up ${first.name} at ${formatMs(first.gameTimeMs)}. Items keep your hero alive in skirmishes and creep camps.`,
        metric: { label: `pro ${formatMs(first.gameTimeMs)}` }
      });
      // Up to 2 more, lighter severity.
      for (const it of missingByTime.slice(1, 3)) {
        findings.push({
          severity: 'info',
          headline: `Pro also bought ${it.name}`,
          text: `Pro bought ${it.name} at ${formatMs(it.gameTimeMs)}.`,
          metric: { label: `pro ${formatMs(it.gameTimeMs)}` }
        });
      }
    }
    const typeScore = proTypes ? matchedTypes / proTypes : 1;
    const goldRatio = proGold > 0 ? Math.min(1, userGold / proGold) : 1;
    const score = Math.round((0.7 * typeScore + 0.3 * goldRatio) * 100);
    return {
      score, grade: gradeFor(score), findings, available: true,
      detail: { userItems, proItems, missing, matchedByType, userGold, proGold }
    };
  };

  // Idle resources: derived proxy. Average supplyMax - supplyUsed (idle
  // headroom) over economyTrack. High avg headroom = you built farms but
  // didn't train units = wasted gold. Low = healthy production.
  // Score = 100 - clamp((userAvg - proAvg) / 6, 0, 1) × 100.
  const scoreIdleResources = (u, p, guards) => {
    if (!u.economyTrack || !p.economyTrack || !u.economyTrack.length || !p.economyTrack.length) {
      return na('no economy data');
    }
    const endMs = Math.min(
      u.economyTrack[u.economyTrack.length - 1].gameTimeMs,
      p.economyTrack[p.economyTrack.length - 1].gameTimeMs
    );
    if (endMs < 90_000) return na('overlapping time too short');

    const series = [];
    let userSum = 0, proSum = 0, samples = 0;
    let worstUser = { gameTimeMs: 0, headroom: 0 };
    for (let t = 60_000; t <= endMs; t += 30_000) {
      const us = sampleAt(u.economyTrack, t);
      const ps = sampleAt(p.economyTrack, t);
      if (!us || !ps) continue;
      const uHead = Math.max(0, (us.supplyMax || 0) - (us.supplyUsed || 0));
      const pHead = Math.max(0, (ps.supplyMax || 0) - (ps.supplyUsed || 0));
      userSum += uHead;
      proSum += pHead;
      samples += 1;
      series.push({ gameTimeMs: t, userHeadroom: uHead, proHeadroom: pHead });
      if (uHead > worstUser.headroom) worstUser = { gameTimeMs: t, headroom: uHead };
    }
    if (samples === 0) return na('no overlapping samples');
    const userAvg = userSum / samples;
    const proAvg = proSum / samples;
    const gap = Math.max(0, userAvg - proAvg);
    const score = Math.round(Math.max(0, Math.min(1, 1 - gap / 6)) * 100);
    const findings = [];
    if (userAvg - proAvg > 2) {
      findings.push({
        severity: 'warn',
        headline: 'Spend gold faster',
        text: `Avg ${userAvg.toFixed(1)} unused supply across the game (pro ${proAvg.toFixed(1)}). Floating supply room means floating gold — train units sooner or expand.`,
        metric: { label: `${userAvg.toFixed(1)} avg unused` }
      });
    }
    if (worstUser.headroom >= 10 && worstUser.gameTimeMs >= 120_000) {
      findings.push({
        severity: 'info',
        headline: 'Train into the headroom you build',
        text: `${worstUser.headroom} supply unused at ${formatMs(worstUser.gameTimeMs)} — that\'s a full production hall doing nothing.`,
        metric: { label: `${worstUser.headroom} unused @ ${formatMs(worstUser.gameTimeMs)}` }
      });
    }
    return {
      score, grade: gradeFor(score), findings, available: true,
      detail: { series, userAvg, proAvg, worstUser }
    };
  };

  // ===== helpers =====

  const na = (reason) => ({ score: 0, grade: 'N/A', findings: [], available: false, reason, detail: null });

  const sameMap = (a, b) => {
    if (!a || !b) return false;
    const ca = prettyMap(a), cb = prettyMap(b);
    if (!ca || !cb) return false;
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
    return norm(ca) === norm(cb) || norm(ca).includes(norm(cb)) || norm(cb).includes(norm(ca));
  };

  const prettyMap = (raw) => {
    if (!raw) return '';
    let n = String(raw).replace(/^.*[/\\]/, '');
    n = n.replace(/\.(w3x|w3m)$/i, '');
    n = n.replace(/^\(\d+\)\s*/, '');
    n = n.replace(/^\d+_w3c_\d+_\d+_/, '');
    n = n.replace(/^w3c_\d+_\d+_/, '');
    n = n.replace(/^w3c_/, '');
    n = n.replace(/_w3c_\d+_\d+(_\d+)?$/, '');
    n = n.replace(/^\dv\d_/, '');
    n = n.replace(/_v[\d.-]+$/, '');
    n = n.replace(/([a-z])([A-Z])/g, '$1 $2');
    n = n.replace(/[_]/g, ' ').replace(/\s+/g, ' ').trim();
    return n;
  };

  const playerRaces = (summary) => {
    const out = [];
    for (const k of Object.keys(summary.players || {})) {
      out.push(summary.players[k].race || 'R');
    }
    return out;
  };

  const sampleAt = (track, t) => {
    let pick = null;
    for (const s of track) {
      if (s.gameTimeMs <= t) pick = s;
      else break;
    }
    return pick;
  };

  const lcs = (a, b) => {
    const n = a.length, m = b.length;
    if (!n || !m) return 0;
    const dp = new Array(m + 1).fill(0);
    for (let i = 1; i <= n; i++) {
      let prev = 0;
      for (let j = 1; j <= m; j++) {
        const tmp = dp[j];
        if (a[i - 1] === b[j - 1]) dp[j] = prev + 1;
        else dp[j] = Math.max(dp[j], dp[j - 1]);
        prev = tmp;
      }
    }
    return dp[m];
  };

  const formatMs = (ms) => {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const gradeClass = (grade) => {
    if (!grade) return 'grade-NA';
    if (grade === 'N/A') return 'grade-NA';
    return 'grade-' + grade.replace('+', 'plus').replace('-', 'minus');
  };

  return { compare, gradeFor, gradeClass, prettyArchetype, formatMs, sameMap, prettyMap };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReplayAnalyzer;
}
if (typeof window !== 'undefined') {
  window.ReplayAnalyzer = ReplayAnalyzer;
}
