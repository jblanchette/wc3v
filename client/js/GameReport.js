/**
 * GameReport.js — the narrated review of one game from one seat.
 *
 * Turns a stored summary (schema v3) into the thing a coach would actually
 * say: a one-line headline, five named pillar grades, the (at most) three
 * concrete mistakes worth fixing, and a couple of things that went right.
 * Every claim carries a timestamp where one exists, so the UI can open the
 * viewer at that second.
 *
 * Grading philosophy, in order:
 *   1. Benchmark against YOURSELF first — `baseline` is ProfileAggregate's
 *      rolling same-matchup medians. 50 means "your normal game".
 *   2. Where no baseline exists, wide absolute anchors are used and the note
 *      says so. Anchors are deliberately generous: a wrong absolute claim is
 *      worse than a soft one.
 *   3. A pillar with no usable signal scores null and says why, rather than
 *      inventing a number. Estimated data is graded like observed data but
 *      never named in a mistake without its hedge.
 *
 * Self-contained, dual-runtime (Node require / browser <script>), no DOM,
 * no fs — same contract as SummaryExtract and ProfileAggregate.
 *
 * Used by:
 *   - desktop/src-frontend/js/games-view.js  → the Review tab
 *   - desktop/src-frontend/js/overlay-state.js → headline in toast + overlay
 *   - tools/test-game-report.js               → assertions
 */

(function () {
  'use strict';

  // A baseline metric is only trusted at this many samples — same reasoning
  // as ProfileAggregate's guards: "vs your median (n=2)" is not a benchmark.
  const MIN_BASE_N = 5;

  // Mistake trigger thresholds. Calibrate these against real games the way
  // chess.com retunes "Blunder": a label that fires every game means nothing.
  const LATE_T2_MS = 45 * 1000;         // slower than your median by this much
  const WORKER_DEFICIT = 3;             // workers under your median at 5:00
  const LATE_SECOND_HERO_MS = 9 * 60 * 1000;
  const NO_EXPAND_GAME_MS = 14 * 60 * 1000;
  // Gold-equivalent of a fight worth naming. 700 was the first guess and the
  // corpus pass showed it firing on 31% of seats — near-tautological, since
  // most games contain one decisive trade and somebody has to lose it.
  const BIG_LOST_SWING = 1200;
  const SUPPLY_BLOCK_MIN_SAMPLES = 2;   // 30s samples spent capped

  const MS = { min: 60 * 1000 };

  function formatMs (ms) {
    const m = Math.floor((ms || 0) / 60000);
    const s = Math.floor(((ms || 0) % 60000) / 1000);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  // Linear 0–100 between a "worst" and "best" anchor.
  const scale = (value, worst, best) =>
    clamp(Math.round(((value - worst) / (best - worst)) * 100), 0, 100);

  const baseMetric = (baseline, key) => {
    const m = baseline && baseline[key];
    return (m && m.n >= MIN_BASE_N && m.median !== null) ? m.median : null;
  };

  // ── Per-signal extraction ───────────────────────────────────────────────────

  function workersAt5m (p) {
    let w = null;
    for (const s of (p.economyTrack || [])) {
      if (s.gameTimeMs > 5 * MS.min) break;
      w = s.totalWorkers;
    }
    return w;
  }

  // 30s samples spent at the supply cap while the cap could still be raised.
  // supplyMax >= 90 is excluded — sitting at 100/100 late is a choice, not a
  // block — and so is the first 2:00, where 4/10-style starts read as capped.
  function supplyBlocks (p) {
    const blocked = [];
    for (const s of (p.economyTrack || [])) {
      if (s.gameTimeMs < 2 * MS.min) continue;
      if (!s.supplyMax || s.supplyMax >= 90) continue;
      if (s.supplyUsed >= s.supplyMax) blocked.push(s.gameTimeMs);
    }
    return blocked;
  }

  // Longest mid-game run of 30s samples with no new combat unit, between 5:00
  // and the earlier of (duration − 1:00) and the track cap. Null when the
  // player fields no combat units at all — a grade needs an army to grade.
  function productionStall (p, durationMs) {
    const track = p.combatUnitsTrack || [];
    if (!track.length || !track[track.length - 1].count) return null;
    const from = 5 * MS.min;
    const to = Math.min((durationMs || Infinity) - MS.min, track[track.length - 1].gameTimeMs);
    if (to <= from) return null;

    let longest = 0;
    let longestAt = null;
    let run = 0;
    let runStart = null;
    let prev = null;
    for (const s of track) {
      if (s.gameTimeMs < from || s.gameTimeMs > to) { prev = s.count; continue; }
      if (prev !== null && s.count === prev) {
        if (!run) runStart = s.gameTimeMs - 30 * 1000;
        run++;
        if (run > longest) { longest = run; longestAt = runStart; }
      } else {
        run = 0;
      }
      prev = s.count;
    }
    return { stallMs: longest * 30 * 1000, at: longestAt };
  }

  function mainHero (p) {
    const heroes = p.heroBuilds || [];
    if (!heroes.length) return null;
    return heroes.reduce((a, b) => ((b.finalLevel || 0) > (a.finalLevel || 0) ? b : a));
  }

  function campsBefore (p, cutoffMs) {
    let n = 0;
    for (const h of (p.heroBuilds || [])) {
      for (const c of (h.camps || [])) {
        if ((c.gameTimeMs || 0) <= cutoffMs) n++;
      }
    }
    return n;
  }

  // ── The grader ──────────────────────────────────────────────────────────────

  /**
   * @param summary  the stored game summary (wrapper: durationMs, winner,
   *                 gameMode, players)
   * @param slot     the seat being reviewed (string or number key into
   *                 summary.players)
   * @param baseline optional ProfileAggregate.baseline() result
   * @returns { result, headline, grades, mistakes, highlights, benchmarks,
   *            baselineScope } — or null when the seat does not exist.
   */
  function grade (summary, slot, baseline) {
    const p = summary && summary.players && summary.players[slot];
    if (!p) return null;

    const durationMs = summary.durationMs || 0;
    const is1v1 = summary.gameMode === '1v1';
    let result = null;
    if (is1v1 && summary.winner && typeof summary.winner.playerId === 'number') {
      result = summary.winner.playerId === +slot ? 'win' : 'loss';
    }

    const combat = p.combat || null;
    const w5 = workersAt5m(p);
    const blocks = supplyBlocks(p);
    const stall = productionStall(p, durationMs);
    const hero = mainHero(p);
    const secondHero = (p.heroBuilds || [])[1] || null;
    const earlyCamps = campsBefore(p, Math.min(12 * MS.min, durationMs));
    const minutes = durationMs / MS.min;

    const baseW5 = baseMetric(baseline, 'workersAt5m');
    const baseT2 = baseMetric(baseline, 't2');
    const baseExp = baseMetric(baseline, 'expansion');
    const baseApm = baseMetric(baseline, 'apmEffective');
    const expansionRate = baseline && baseline.games >= MIN_BASE_N ? baseline.expansionRate : null;

    // ── Pillars ──────────────────────────────────────────────────────────────

    const grades = [];
    const push = (key, label, score, note) =>
      grades.push({ key, label, score: score === null ? null : Math.round(clamp(score, 0, 100)), note });

    // Each pillar is a base score plus penalties, NOT a blend of independent
    // sub-scores. Blending pulls every game toward whatever constant the
    // "nothing went wrong" term carries, and the corpus pass showed exactly
    // that: economy compressed into a 54–62 band with no spread left to read.

    // Economy: workers vs your median (each worker ±6), minus supply blocks.
    {
      let score = null;
      let note;
      if (w5 !== null) {
        score = baseW5 !== null ? 50 + (w5 - baseW5) * 5 : scale(w5, 8, 26);
        note = baseW5 !== null
          ? `${w5} workers at 5:00 — your median is ${baseW5}`
          : `${w5} workers at 5:00`;
      } else {
        note = 'no worker count in this game’s data';
      }
      if (blocks.length) {
        // One 30s sample at the cap is how WC3 is played — you build up TO the
        // cap and then raise it. Penalising it dragged the median game below
        // 50, which cannot be right for a benchmark against yourself.
        if (score !== null) score -= Math.min(20, Math.max(0, blocks.length - 1) * 6);
        note += `; supply-capped for ~${Math.round(blocks.length * 0.5)} min`;
      }
      push('economy', 'Economy', score, note);
    }

    // Army: how the fights traded, minus production downtime.
    {
      let score = null;
      const notes = [];
      if (combat) {
        score = 62 + combat.wipesFor * 12 - combat.wipesAgainst * 18;
        if (combat.biggestSwing) {
          score += (combat.biggestSwing.won ? 1 : -1) *
            Math.min(20, Math.round(combat.biggestSwing.swing / 100));
        }
        if (combat.wipesAgainst) notes.push(`lost an army ${combat.wipesAgainst}×`);
        if (combat.wipesFor) notes.push(`wiped theirs ${combat.wipesFor}×`);
      }
      if (stall !== null) {
        if (score === null) score = 62;
        // A minute without a new unit is teching or saving, not idling. Only
        // real downtime should cost; the first version charged for all of it
        // and pushed the median game to 39.
        score -= Math.min(28, Math.max(0, stall.stallMs / MS.min - 1) * 8);
        if (stall.stallMs >= 2 * MS.min) {
          notes.push(`production stalled ~${Math.round(stall.stallMs / MS.min)} min around ${formatMs(stall.at)}`);
        } else {
          notes.push('production kept moving');
        }
      } else if (score === null) {
        notes.push('no combat units to grade');
      }
      push('army', 'Army', score, notes.join('; '));
    }

    // Hero: the kill/death trade, adjusted by the level curve. The level
    // anchor is deliberately shallow — heroes past 5 need creeps that are no
    // longer there, so a steep curve marks every long game as a hero failure,
    // which the corpus pass showed it doing (hero was the scapegoat in 43% of
    // headlines).
    {
      let score = null;
      const notes = [];
      if (combat) {
        const kills = combat.heroKills.length;
        const deaths = combat.heroDeaths.length;
        const creeped = combat.heroDeaths.filter(h => h.toCreeps).length;
        score = 55 + (kills - deaths) * 12 - creeped * 10;
        if (kills || deaths) notes.push(`hero trade ${kills}–${deaths}`);
        if (creeped) notes.push(`${creeped} lost to creeps`);
      }
      if (hero && minutes >= 6) {
        const expected = Math.min(6, 3 + (minutes - 6) / 6);
        const delta = ((hero.finalLevel || 1) - expected) * 6;
        score = score === null ? 50 + delta : score + clamp(delta, -12, 12);
        notes.push(`${hero.name} ended level ${hero.finalLevel || 1}`);
      }
      push('hero', 'Hero', score, notes.join('; ') || 'no hero data in this game');
    }

    // Map control: creeping tempo, adjusted by the expansion. The camp anchor
    // runs to 10 — six camps by 12:00 is a normal game, not a perfect one, and
    // capping there pinned 11% of the corpus at 100.
    {
      let score = null;
      const notes = [];
      if (durationMs >= 8 * MS.min) {
        score = scale(earlyCamps, 0, 10);
        notes.push(`${earlyCamps} camp${earlyCamps === 1 ? '' : 's'} by 12:00`);
      }
      if (p.expansionTime !== null && p.expansionTime !== undefined) {
        const bonus = (baseExp !== null && p.expansionTime < baseExp) ? 15 : 8;
        score = score === null ? 50 + bonus : score + bonus;
        notes.push(`expanded at ${formatMs(p.expansionTime)}`);
      } else if (durationMs >= NO_EXPAND_GAME_MS) {
        score = score === null ? 40 : score - 12;
        notes.push('never expanded');
      }
      push('mapControl', 'Map control', score,
        notes.join('; ') || 'too short to grade');
    }

    // Mechanics: effective APM vs your median, adjusted by how much of the raw
    // APM was real. The absolute anchor spans beginner (~40) to pro (~220) —
    // the first version topped out at 70 and pinned every pro replay at 100.
    {
      let score = null;
      let note;
      const eapm = p.apm ? p.apm.effectiveAverage : null;
      const raw = p.apm ? p.apm.rawAverage : null;
      if (eapm) {
        score = baseApm !== null ? 50 + (eapm - baseApm) / 3 : scale(eapm, 40, 320);
        note = baseApm !== null
          ? `${Math.round(eapm)} effective APM — your median is ${Math.round(baseApm)}`
          : `${Math.round(eapm)} effective APM`;
        // Spam ratio nudges, never decides: a player with fewer, better
        // actions is not mechanically worse than one who spams.
        if (raw) score += clamp((eapm / raw - 0.5) * 40, -10, 10);
      } else {
        note = 'no APM data in this game';
      }
      push('mechanics', 'Mechanics', score, note);
    }

    // ── Mistakes — at most three, ranked, each with a seekable time ──────────

    const candidates = [];
    const flag = (weight, t, text, kind) =>
      candidates.push({ weight, t, tf: t !== null ? formatMs(t) : null, text, kind });

    if (combat) {
      for (const h of combat.heroDeaths) {
        if (h.toCreeps) {
          flag(90, h.t, `Lost ${h.name}${h.likely ? ' (likely)' : ''} to creeps`, 'creepDeath');
        }
      }
      const down = combat.heroDeaths.length - combat.heroKills.length;
      if (down >= 2) {
        const last = combat.heroDeaths[combat.heroDeaths.length - 1];
        flag(80, last.t, `Came out ${down} heroes down across the fights`, 'heroDeficit');
      }
      if (combat.biggestSwing && !combat.biggestSwing.won &&
          combat.biggestSwing.swing >= BIG_LOST_SWING) {
        flag(75, combat.biggestSwing.t,
          `Lost the big fight — down ${combat.biggestSwing.swing}g in one trade`, 'lostFight');
      }
    }
    if (baseT2 !== null && p.tier2Time !== null && p.tier2Time !== undefined &&
        p.tier2Time - baseT2 >= LATE_T2_MS) {
      flag(70, p.tier2Time,
        `Tier 2 at ${formatMs(p.tier2Time)} — your median is ${formatMs(baseT2)}`, 'lateT2');
    }
    if (baseW5 !== null && w5 !== null && baseW5 - w5 >= WORKER_DEFICIT) {
      flag(65, 5 * MS.min,
        `${w5} workers at 5:00 — your median is ${baseW5}`, 'workerDeficit');
    }
    if (blocks.length >= SUPPLY_BLOCK_MIN_SAMPLES) {
      flag(55, blocks[0],
        `Supply-capped around ${formatMs(blocks[0])} for ~${Math.round(blocks.length * 0.5)} min`, 'supplyBlock');
    }
    if (stall && stall.stallMs >= 3 * MS.min) {
      flag(50, stall.at,
        `No combat units for ~${Math.round(stall.stallMs / MS.min)} min from ${formatMs(stall.at)}`, 'prodStall');
    }
    if (secondHero && secondHero.spawnTimeMs && secondHero.spawnTimeMs >= LATE_SECOND_HERO_MS) {
      flag(45, secondHero.spawnTimeMs,
        `Second hero at ${formatMs(secondHero.spawnTimeMs)}`, 'lateSecondHero');
    }
    if ((p.expansionTime === null || p.expansionTime === undefined) &&
        durationMs >= NO_EXPAND_GAME_MS &&
        expansionRate !== null && expansionRate >= 40) {
      flag(40, null,
        `Never expanded in a ${formatMs(durationMs)} game — you usually do (${expansionRate}%)`, 'noExpand');
    }

    candidates.sort((a, b) => b.weight - a.weight);
    const mistakes = candidates.slice(0, 3).map(({ weight, ...m }) => m);

    // ── Highlights — what went right, at most two ────────────────────────────

    const highs = [];
    if (combat) {
      if (combat.biggestSwing && combat.biggestSwing.won &&
          combat.biggestSwing.swing >= BIG_LOST_SWING) {
        highs.push({
          t: combat.biggestSwing.t, tf: combat.biggestSwing.tf,
          text: `Won the big fight — up ${combat.biggestSwing.swing}g in one trade`, kind: 'wonFight'
        });
      }
      const up = combat.heroKills.length - combat.heroDeaths.length;
      if (up >= 2) {
        const last = combat.heroKills[combat.heroKills.length - 1];
        highs.push({ t: last.t, tf: last.tf, text: `Came out ${up} heroes up across the fights`, kind: 'heroLead' });
      }
    }
    if (baseT2 !== null && p.tier2Time !== null && p.tier2Time !== undefined &&
        baseT2 - p.tier2Time >= LATE_T2_MS) {
      highs.push({
        t: p.tier2Time, tf: formatMs(p.tier2Time),
        text: `Tier 2 at ${formatMs(p.tier2Time)} — well ahead of your ${formatMs(baseT2)} median`, kind: 'fastT2'
      });
    }
    if (baseW5 !== null && w5 !== null && w5 - baseW5 >= WORKER_DEFICIT) {
      highs.push({
        t: 5 * MS.min, tf: '5:00',
        text: `${w5} workers at 5:00 — above your ${baseW5} median`, kind: 'workerLead'
      });
    }
    const highlights = highs.slice(0, 2);

    // ── Benchmarks — the timing strip's colouring, vs yourself ──────────────
    // dir: 'ahead' | 'behind' | null (null = no claim). Lower is ahead for
    // times; higher is ahead for workers. APM carries no direction — faster
    // hands are not automatically better play.

    const benchmarks = [];
    const bench = (key, label, value, valueText, base, baseText, lowerIsBetter) => {
      let dir = null;
      if (value !== null && base !== null && value !== base) {
        dir = (value < base) === lowerIsBetter ? 'ahead' : 'behind';
      }
      benchmarks.push({ key, label, value, valueText, base, baseText, dir });
    };
    bench('t2', 'tier 2',
      p.tier2Time ?? null, p.tier2Time != null ? formatMs(p.tier2Time) : null,
      baseT2, baseT2 !== null ? formatMs(baseT2) : null, true);
    bench('expansion', 'expansion',
      p.expansionTime ?? null, p.expansionTime != null ? formatMs(p.expansionTime) : null,
      baseExp, baseExp !== null ? formatMs(baseExp) : null, true);
    bench('workersAt5m', 'workers @5:00',
      w5, w5 !== null ? String(w5) : null,
      baseW5, baseW5 !== null ? String(baseW5) : null, false);
    const eapm = p.apm ? Math.round(p.apm.effectiveAverage) : null;
    benchmarks.push({
      key: 'apmEffective', label: 'effective APM',
      value: eapm, valueText: eapm !== null ? String(eapm) : null,
      base: baseApm !== null ? Math.round(baseApm) : null,
      baseText: baseApm !== null ? String(Math.round(baseApm)) : null,
      dir: null
    });

    // ── Headline — one sentence, reused by the tab, the toast and the overlay.

    const scored = grades.filter(g => g.score !== null);
    let headline;
    if (!scored.length) {
      headline = 'Not enough data to grade this one.';
    } else {
      const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
      const worst = scored.reduce((a, b) => (b.score < a.score ? b : a));
      if (best.score - worst.score >= 20) {
        headline = `${best.label} led it; ${worst.label.toLowerCase()} lagged.`;
      } else if (worst.score >= 60) {
        headline = 'A clean one — nothing lagged.';
      } else if (best.score <= 45) {
        headline = 'A rough one across the board.';
      } else {
        headline = `An even game — ${best.label.toLowerCase()} the bright spot.`;
      }
    }

    return {
      result,
      headline,
      grades,
      mistakes,
      highlights,
      benchmarks,
      baselineScope: baseline && baseline.games >= MIN_BASE_N ? baseline.scope : null
    };
  }

  // ── Module export (Node) + window export (browser) ─────────────────────────

  const api = { grade, formatMs, MIN_BASE_N };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.GameReport = api;
  }
})();
