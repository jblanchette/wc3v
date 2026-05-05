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

const ReplayAnalyzer = (() => {
  // 15-tier letter grade scale: A+ A A- B+ B B- C+ C C- D+ D D- F+ F F-.
  // Thresholds chosen so a "perfect" replay (self-compare) lands at A+,
  // an average replay sits around C, and a clearly poor performance is F.
  // Each tier is ~3 points wide above 60; below 60 we coarsen since
  // distinctions there are noise.
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
  // when its category is unavailable.
  const DEFAULT_WEIGHTS = {
    macro: 0.30,
    tech: 0.25,
    buildAdherence: 0.20,
    production: 0.15,
    expansion: 0.10
  };

  // Tolerance windows in ms for tier-timing scoring. Each second past the pro
  // timing erodes 1/window of the score; capped between 0 and 1.
  const TIER_TOLERANCE_MS = 60 * 1000;        // 60s tolerance
  const HERO_TOLERANCE_MS = 90 * 1000;
  const EXPANSION_TOLERANCE_MS = 120 * 1000;

  // ===== Public surface =====

  // compare({ userSummary, userSlot, proSummary, proSlot, proResult })
  // userSummary / proSummary are the top-level summary JSON.
  // userSlot / proSlot are the player keys ("1", "2", etc).
  // proResult is optional: 'win' | 'loss' | 'unknown'.
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

    // Score each category (or mark unavailable). When the duration guard
    // fails we still populate all five categories with a clear reason so
    // the UI can render tile-level explanations instead of an empty section.
    let categories;
    if (!guards.durationOk) {
      const tooShort = (label) => ({
        score: 0, grade: 'N/A', findings: [], available: false,
        reason: 'Game ended too early to compare meaningfully'
      });
      categories = {
        macro:          tooShort('Macro'),
        tech:           tooShort('Tech'),
        expansion:      tooShort('Expansion'),
        buildAdherence: tooShort('Build Adherence'),
        production:     tooShort('Production')
      };
    } else {
      categories = {
        macro:          scoreMacro(u, p, guards),
        tech:           scoreTech(u, p, guards),
        expansion:      scoreExpansion(u, p, guards),
        buildAdherence: scoreBuildAdherence(u, p, guards),
        production:     scoreProduction(u, p, guards)
      };
    }

    // Pro-result penalty: if pro lost, dampen each available score by 30%.
    if (proResult === 'loss') {
      for (const k of Object.keys(categories)) {
        if (categories[k].available) {
          categories[k].score = Math.round(categories[k].score * 0.7);
          categories[k].grade = gradeFor(categories[k].score);
        }
      }
    }

    // Weighted overall over available categories.
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

  // Compatibility checklist — each item has { label, status, detail }.
  // status ∈ 'match' | 'partial' | 'mismatch' | 'unknown'. The UI renders
  // these as ✓/⚠/✗ rows so users see at a glance why a comparison is or
  // isn't a great fit.
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

    // Duration: replays should be within a 60% length ratio of each other and
    // both at least 90s. Symmetric so a 27-min user vs 13-min pro is flagged
    // the same way as the inverse.
    const ratio = (proDur > 0 && userDur > 0)
      ? Math.min(userDur, proDur) / Math.max(userDur, proDur)
      : 0;
    const durationOk = ratio >= 0.6 && Math.min(userDur, proDur) >= 90_000;

    // Matchup: same race, and opponent races match (we approximate using
    // available player slots in each summary).
    const userRaces = playerRaces(userSummary).sort().join('');
    const proRaces = playerRaces(proSummary).sort().join('');
    const matchupCompatible = u.race === p.race && userRaces === proRaces;

    // Map: same canonical name (case-insensitive substring match).
    const mapCompatible = sameMap(userSummary.map, proSummary.map);

    // Archetype: both classified the same.
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

  // Macro: integrate (proSupplyUsed - userSupplyUsed) / proSupplyUsed over
  // the economyTrack. A perfect match scores 100; falling 1 supply behind
  // for the whole game scores roughly 95; staying 5+ behind scores < 70.
  const scoreMacro = (u, p, guards) => {
    if (!u.economyTrack || !p.economyTrack || !u.economyTrack.length || !p.economyTrack.length) {
      return { score: 0, grade: 'N/A', findings: [], available: false, reason: 'no economy data' };
    }
    const findings = [];

    // Sample on the shared time window.
    const endMs = Math.min(
      u.economyTrack[u.economyTrack.length - 1].gameTimeMs,
      p.economyTrack[p.economyTrack.length - 1].gameTimeMs
    );
    if (endMs <= 0) {
      return { score: 0, grade: 'N/A', findings: [], available: false, reason: 'overlapping time too short' };
    }

    let supplyDeltaSum = 0;
    let supplyMaxRefSum = 0;
    let workerDeltaSum = 0;
    let samples = 0;
    for (let t = 30_000; t <= endMs; t += 30_000) {
      const us = sampleAt(u.economyTrack, t);
      const ps = sampleAt(p.economyTrack, t);
      if (!us || !ps) continue;
      supplyDeltaSum += Math.max(0, ps.supplyUsed - us.supplyUsed);
      supplyMaxRefSum += Math.max(1, ps.supplyUsed);
      workerDeltaSum += Math.max(0, (ps.totalWorkers || 0) - (us.totalWorkers || 0));
      samples += 1;
    }
    if (samples === 0) {
      return { score: 0, grade: 'N/A', findings: [], available: false, reason: 'no overlapping samples' };
    }

    // Convert ratio to 0..100. We use 1 - (delta/ref) and clamp.
    const supplyRatio = supplyDeltaSum / supplyMaxRefSum;
    const supplyScore = Math.max(0, Math.min(1, 1 - supplyRatio * 1.5));

    // Worker delta scaled — 5 workers behind on average ≈ 0.5.
    const workerDeltaAvg = workerDeltaSum / samples;
    const workerScore = Math.max(0, Math.min(1, 1 - workerDeltaAvg / 10));

    const score = Math.round((0.6 * supplyScore + 0.4 * workerScore) * 100);

    // Findings: average gap rounded.
    const supplyAvgBehind = (supplyDeltaSum / samples).toFixed(1);
    if (supplyAvgBehind > 1) {
      findings.push({ severity: 'info', text: `Average ${supplyAvgBehind} supply behind ${p.name}` });
    }
    if (workerDeltaAvg > 1) {
      findings.push({ severity: 'info', text: `Average ${workerDeltaAvg.toFixed(1)} workers behind` });
    }

    return { score, grade: gradeFor(score), findings, available: true };
  };

  // Tech: average of weighted ratios for {T2, T3, hero level 2, hero level 3}.
  const scoreTech = (u, p, guards) => {
    if (!guards.matchupCompatible) {
      return { score: 0, grade: 'N/A', findings: [], available: false, reason: 'different matchups' };
    }
    const findings = [];
    const checks = [
      ['T2',         u.tier2Time,           p.tier2Time,           TIER_TOLERANCE_MS],
      ['T3',         u.tier3Time,           p.tier3Time,           TIER_TOLERANCE_MS],
      ['Hero L2',    u.firstHeroLevel2Time, p.firstHeroLevel2Time, HERO_TOLERANCE_MS],
      ['Hero L3',    u.firstHeroLevel3Time, p.firstHeroLevel3Time, HERO_TOLERANCE_MS]
    ];
    let count = 0, sum = 0;
    for (const [label, ut, pt, tol] of checks) {
      if (pt == null) continue; // pro didn't reach it; skip
      count += 1;
      if (ut == null) {
        sum += 0; // didn't reach what the pro did
        findings.push({ severity: 'warn', text: `${label}: not reached (pro at ${formatMs(pt)})` });
        continue;
      }
      const deltaSec = (ut - pt) / 1000;
      const norm = Math.max(0, Math.min(1, 1 - Math.abs(ut - pt) / tol));
      sum += norm;
      if (Math.abs(deltaSec) > tol / 1000 / 2) {
        const sign = deltaSec > 0 ? 'late' : 'early';
        findings.push({ severity: deltaSec > 0 ? 'warn' : 'good',
          text: `${label} at ${formatMs(ut)} vs pro ${formatMs(pt)} — ${Math.abs(deltaSec).toFixed(0)}s ${sign}` });
      }
    }
    if (count === 0) return { score: 0, grade: 'N/A', findings, available: false, reason: 'no tech timings to compare' };
    const score = Math.round((sum / count) * 100);
    return { score, grade: gradeFor(score), findings, available: true };
  };

  // Expansion: binary did-you-expand × timing closeness.
  const scoreExpansion = (u, p, guards) => {
    if (!guards.mapCompatible) {
      return { score: 0, grade: 'N/A', findings: [], available: false, reason: 'different maps' };
    }
    if (p.expansionTime == null) {
      return { score: 0, grade: 'N/A', findings: [], available: false, reason: 'pro did not expand' };
    }
    const findings = [];
    if (u.expansionTime == null) {
      findings.push({ severity: 'warn', text: `Did not expand (pro expanded at ${formatMs(p.expansionTime)})` });
      return { score: 30, grade: gradeFor(30), findings, available: true };
    }
    const deltaSec = (u.expansionTime - p.expansionTime) / 1000;
    const norm = Math.max(0, Math.min(1, 1 - Math.abs(u.expansionTime - p.expansionTime) / EXPANSION_TOLERANCE_MS));
    const score = Math.round(norm * 100);
    if (Math.abs(deltaSec) > 30) {
      const sign = deltaSec > 0 ? 'late' : 'early';
      findings.push({ severity: deltaSec > 0 ? 'warn' : 'good',
        text: `Expansion at ${formatMs(u.expansionTime)} vs pro ${formatMs(p.expansionTime)} — ${Math.abs(deltaSec).toFixed(0)}s ${sign}` });
    }
    return { score, grade: gradeFor(score), findings, available: true };
  };

  // Build adherence: longest common subsequence of the first N events'
  // itemIds. Suppressed if archetypes mismatch.
  const scoreBuildAdherence = (u, p, guards) => {
    if (!guards.matchupCompatible) {
      return { score: 0, grade: 'N/A', findings: [], available: false, reason: 'different matchups' };
    }
    if (!u.buildPreview || !p.buildPreview) {
      return { score: 0, grade: 'N/A', findings: [], available: false, reason: 'no build preview' };
    }
    if (!guards.archetypeCompatible) {
      // Fall back to general-timing: use number of common itemIds without ordering.
      const userIds = new Set((u.buildPreview || []).map(b => b.itemId));
      const overlap = (p.buildPreview || []).filter(b => userIds.has(b.itemId)).length;
      const score = Math.round(Math.min(1, overlap / Math.max(1, p.buildPreview.length)) * 100 * 0.7);
      return {
        score, grade: gradeFor(score),
        findings: [{ severity: 'info', text: `Different archetypes — using set overlap (${overlap} matching items)` }],
        available: true,
        reason: 'archetype-degraded'
      };
    }
    const userSeq = (u.buildPreview || []).map(b => b.itemId);
    const proSeq = (p.buildPreview || []).map(b => b.itemId);
    const lcsLen = lcs(userSeq, proSeq);
    const score = Math.round((lcsLen / Math.max(1, proSeq.length)) * 100);
    const findings = [];
    if (lcsLen < proSeq.length * 0.5) {
      findings.push({ severity: 'warn', text: `Only ${lcsLen}/${proSeq.length} of pro's opening order matched` });
    }
    return { score, grade: gradeFor(score), findings, available: true };
  };

  // Production: rough units-per-minute parity in the first 10 min.
  const scoreProduction = (u, p, guards) => {
    if (!u.buildPreview || !p.buildPreview) {
      return { score: 0, grade: 'N/A', findings: [], available: false, reason: 'no build preview' };
    }
    const TEN_MIN = 10 * 60 * 1000;
    const countUnits = (preview) => preview.filter(e => e.type === 'unit' && e.gameTimeMs <= TEN_MIN).length;
    const userU = countUnits(u.buildPreview);
    const proU = countUnits(p.buildPreview);
    if (proU === 0) return { score: 0, grade: 'N/A', findings: [], available: false, reason: 'pro produced no units in window' };
    const ratio = Math.min(1, userU / proU);
    const score = Math.round(ratio * 100);
    const findings = [];
    if (userU < proU) {
      findings.push({ severity: 'warn', text: `${userU} combat units in first 10:00 vs pro ${proU}` });
    }
    return { score, grade: gradeFor(score), findings, available: true };
  };

  // ===== helpers =====

  const sameMap = (a, b) => {
    if (!a || !b) return false;
    // Compare on the cleaned (display) name so two different W3C-prefixed
    // copies of "Hammerfall" still match.
    const ca = prettyMap(a), cb = prettyMap(b);
    if (!ca || !cb) return false;
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
    return norm(ca) === norm(cb) || norm(ca).includes(norm(cb)) || norm(cb).includes(norm(ca));
  };

  // Strip W3C / version / extension noise from a map name for display.
  // Mirrors tools/import-replays.js cleanMapName().
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

  // Pick the most recent track snapshot at or before time t.
  const sampleAt = (track, t) => {
    let pick = null;
    for (const s of track) {
      if (s.gameTimeMs <= t) pick = s;
      else break;
    }
    return pick;
  };

  // Longest common subsequence length over arrays of strings.
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

  // CSS class for a letter grade — UI uses these to color tiles. Mirrors
  // the .grade-A / .grade-B etc rules in main.css.
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
