/**
 * GameMetrics.js — one stored game, one seat, as scalars.
 *
 * Everything else in this codebase reads a summary and derives its own numbers
 * at the point of use. That is how "workers at 5:00" ended up implemented three
 * times, and how the overlay and the report could describe the same game with
 * different figures. This module is the one place a summary becomes numbers.
 *
 * Self-contained, dual-runtime (Node require / browser <script>), no DOM and no
 * fs, the same contract as SummaryExtract, SeriesExtract and ProfileAggregate.
 *
 * A metric with no signal is null. Never a zero, never an anchor, never a
 * guess. Callers render null as the no-data placeholder and move on.
 *
 * Read by:
 *   client/js/ProfileAggregate.js              baselines, trends, race averages
 *   desktop/src-frontend/js/games-view.js      the report's comparison block
 *   desktop/src-frontend/js/overlay-state.js   the OBS readout
 *   tools/build-race-baselines.js              the shipped ladder sample
 */

(function () {
  'use strict';

  const MS_MIN = 60 * 1000;

  // DominanceSeries hands each seat a share of 100, so 50 is an even game.
  // Published because three call sites compare against it.
  const EVEN = 50;

  // U+2212, not a hyphen. It is the same width as the plus, so a column of
  // deltas stays aligned under tabular figures.
  const MINUS = '−';

  // ── Dominance ─────────────────────────────────────────────────────────────
  //
  // The stored series is NOT on a fixed grid. SeriesExtract keeps an explicit
  // `t` per sample precisely because DominanceSeries emits a pre/post pair
  // around each momentum event, so a hero death reads as a step rather than a
  // ten-second slope. A plain mean over those samples therefore weights the few
  // seconds around every death as heavily as the minutes between them, and a
  // game with six deaths comes out meaningfully wrong.
  //
  // So: trapezoid over t, divided by the span actually covered. The result is
  // "the average share of the game this player held", which is the number the
  // comparison block claims to be showing.

  const packedFor = (summary, slot) => {
    const d = summary && summary.dominance;
    if (!d || !d.players) return null;
    const p = d.players[String(slot)];
    if (!p || !p.t || p.t.length < 1) return null;
    return p;
  };

  // Dominance is a share of 100 split across every seat, so it only means
  // anything at two seats. A 3v3 puts everybody near 16 against an even line
  // they can never reach, which reads as six players all losing.
  function dominanceUsable (summary) {
    if (!summary || summary.gameMode !== '1v1') return false;
    const d = summary.dominance;
    return !!(d && d.players && Object.keys(d.players).length);
  }

  function dominanceStats (summary, slot) {
    const none = { avg: null, peak: null, control: null };
    if (!dominanceUsable(summary)) return none;
    const p = packedFor(summary, slot);
    if (!p) return none;

    const t = p.t;
    const s = p.score;
    const n = Math.min(t.length, s.length);
    if (!n) return none;
    if (n === 1) return { avg: s[0], peak: s[0], control: s[0] > EVEN ? 1 : 0 };

    let area = 0;
    let span = 0;
    let above = 0;
    let peak = s[0];

    for (let i = 1; i < n; i++) {
      const dt = t[i] - t[i - 1];
      const a = s[i - 1];
      const b = s[i];
      if (b > peak) peak = b;
      // A pre/post pair sits at the same timestamp on purpose. Zero width
      // contributes nothing to a mean, which is exactly right: the step is an
      // instant, and its effect is carried by the interval that follows it.
      if (dt <= 0) continue;

      area += dt * (a + b) / 2;
      span += dt;

      // Time spent ahead, with the crossing interpolated rather than rounded to
      // whichever end happened to be sampled.
      const aUp = a > EVEN;
      const bUp = b > EVEN;
      if (aUp && bUp) above += dt;
      else if (aUp !== bUp) {
        const frac = (EVEN - a) / (b - a);
        above += dt * (aUp ? frac : 1 - frac);
      }
    }

    if (span <= 0) return { avg: s[0], peak, control: s[0] > EVEN ? 1 : 0 };
    return {
      avg: Math.round((area / span) * 10) / 10,
      peak: Math.round(peak * 10) / 10,
      control: Math.round((above / span) * 1000) / 1000
    };
  }

  // ── Economy ───────────────────────────────────────────────────────────────

  // The last 30s economy sample at or before 5:00. This lived in three places:
  // ProfileAggregate.gameView, GameReport and the Story tiles. It lives here.
  function workersAt5m (p) {
    let w = null;
    for (const s of ((p && p.economyTrack) || [])) {
      if (s.gameTimeMs > 5 * MS_MIN) break;
      w = s.totalWorkers;
    }
    return w === undefined ? null : w;
  }

  // ── The seat ──────────────────────────────────────────────────────────────

  /**
   * @param summary a stored game summary (the store.js wrapper shape)
   * @param slot    a key into summary.players
   * @returns the scalar set, or null when that seat does not exist
   */
  function forSeat (summary, slot) {
    const players = (summary && summary.players) || {};
    const p = players[String(slot)];
    if (!p) return null;

    const dom = dominanceStats(summary, slot);

    // The hero ledger is schema v3. An older summary has no combat block at
    // all, which is a different thing from a game where nobody died, so it
    // reports null rather than zero.
    const combat = p.combat || null;
    const kills = combat ? (combat.heroKills || []).length : null;
    const deaths = combat ? (combat.heroDeaths || []).length : null;

    const apm = p.apm || null;

    return {
      slot: String(slot),
      name: p.name || '',
      race: p.race || null,

      dominanceAvg: dom.avg,
      dominancePeak: dom.peak,
      dominanceControl: dom.control,

      heroKills: kills,
      heroDeaths: deaths,
      heroNet: (kills === null || deaths === null) ? null : kills - deaths,

      apmEffective: apm ? apm.effectiveAverage : null,
      apmRaw: apm ? apm.rawAverage : null,

      t2: p.tier2Time == null ? null : p.tier2Time,
      t3: p.tier3Time == null ? null : p.tier3Time,
      expansion: p.expansionTime == null ? null : p.expansionTime,
      firstTower: p.firstTowerTime == null ? null : p.firstTowerTime,
      expansionMade: p.expansionTime !== null && p.expansionTime !== undefined,
      workersAt5m: workersAt5m(p)
    };
  }

  // ── The comparison set ────────────────────────────────────────────────────
  //
  // The three metrics the report and the overlay compare, described once so
  // neither has to invent a label, a rounding rule or a sign convention. Order
  // is render order.
  //
  // `banded` is whether a delta may be coloured good or bad. APM is not: the
  // number says how fast somebody's hands moved, and faster hands are not
  // automatically better play. That judgement predates this module and it still
  // holds.
  const METRICS = [
    { key: 'dominanceAvg', label: 'Dominance', decimals: 0, banded: true },
    { key: 'apmEffective', label: 'APM', decimals: 0, banded: false },
    { key: 'heroKills', label: 'Hero kills', decimals: 0, banded: true }
  ];

  const metricByKey = (key) => METRICS.filter(m => m.key === key)[0] || null;

  const round = (value, decimals) => {
    const f = Math.pow(10, decimals || 0);
    return Math.round(value * f) / f;
  };

  // A value as it goes on screen. Null is the em dash, which is the one use of
  // that glyph this codebase keeps: it means "no data", not punctuation.
  function format (key, value) {
    if (value === null || value === undefined) return '—';
    const m = metricByKey(key);
    return String(round(value, m ? m.decimals : 0));
  }

  // A gap against a baseline. Medians of an even sample land on a half, so a
  // delta gets one more decimal than its value: +0.5 is real and +1 is a lie.
  function formatDelta (key, value, base) {
    if (value === null || value === undefined) return '—';
    if (base === null || base === undefined) return '—';
    const m = metricByKey(key);
    const d = round(value - base, (m ? m.decimals : 0) + 1);
    if (d === 0) return '0';
    return (d > 0 ? '+' : MINUS) + String(Math.abs(d));
  }

  // Which way a gap reads. Null for an unbanded metric, and null when there is
  // nothing to compare against, so a caller can never colour a missing number.
  function band (key, value, base) {
    const m = metricByKey(key);
    if (!m || !m.banded) return null;
    if (value === null || value === undefined) return null;
    if (base === null || base === undefined) return null;
    if (value === base) return null;
    return value > base ? 'good' : 'poor';
  }

  const api = {
    forSeat,
    dominanceStats,
    dominanceUsable,
    workersAt5m,
    METRICS,
    metricByKey,
    format,
    formatDelta,
    band,
    EVEN
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.GameMetrics = api;
})();
