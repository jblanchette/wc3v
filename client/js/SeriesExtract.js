// SeriesExtract — the two time series a stored summary cannot derive later.
//
// `lib/DominanceSeries.js` and `lib/ResourceSeries.js` run inside
// `utils.buildOutputObject`, so their output exists ONLY in a full parse. The
// desktop app keeps summaries rather than parses, which means the
// same rule `moments` and `combat` already live under applies here: extract at
// parse time while the parse is in hand, or the data is gone until somebody
// re-reads the replay.
//
// This exists so the desktop can draw the viewer's OWN dominance bar, dominance
// chart and resource charts — the real classes, not lookalikes — from a few KB
// of stored summary.
//
// Dual-runtime and DOM-free, the same contract as SummaryExtract,
// ProfileAggregate, MomentsExtract and GameReport.
//
// ── Storage shape ──────────────────────────────────────────────────────────
//
// Both series are stored as PARALLEL ARRAYS rather than arrays of objects. A
// 40-minute game is ~240 samples per player per series, and `{"t":600000,
// "score":52.4}` costs 26 bytes where `600000,52.4` costs 11. Rehydration back
// into the shape the viewer classes expect is `rehydrate*()` below, so no
// consumer ever handles the packed form directly.
//
// What is deliberately dropped: the dominance `str`/`mom`/`c{}` component
// breakdown (the bar and the chart read `score` only) and the resource
// `foodLost` series (nothing charts it). Anything wanted back needs a re-parse,
// which is the same trade every field in a summary is under.

(function () {
  'use strict';

  // Guard against a pathological replay turning a few-KB summary into a
  // few-hundred-KB one. At the 10s sample interval this is 3 hours of game.
  const MAX_SAMPLES = 1200;

  // ── Dominance ─────────────────────────────────────────────────────────────

  // Samples are NOT on a fixed grid: DominanceSeries emits pre/post pairs
  // around momentum events so a hero death reads as an instant step rather
  // than a ten-second slope. So `t` is stored explicitly.
  //
  // Returns null when the replay has no business showing dominance UI. The
  // `available` gate is the validator-confidence one described in
  // lib/DominanceSeries.js; when it is false NO player carries a series at all,
  // so an absent block and a failed gate are the same thing to a consumer.
  function extractDominance (out) {
    const meta = out && out.dominance;
    if (!meta || !meta.available) return null;

    const players = {};
    let any = false;
    for (const slot of Object.keys((out && out.players) || {})) {
      const series = out.players[slot] && out.players[slot].dominanceSeries;
      const samples = series && series.samples;
      if (!samples || !samples.length) continue;

      const t = [];
      const score = [];
      for (const s of samples.slice(0, MAX_SAMPLES)) {
        t.push(s.t);
        // Already rounded to 1dp by the engine; round again so a config change
        // upstream cannot start writing 14 significant figures into a summary.
        score.push(Math.round((s.score || 0) * 10) / 10);
      }

      players[slot] = {
        t,
        score,
        // Momentum events are what the chart's dots and the bar's impact FX are
        // driven by. There are a handful per game, so they stay as objects.
        events: (series.events || []).map(e => ({
          t: e.t,
          kind: e.kind,
          delta: e.delta
        }))
      };
      any = true;
    }
    if (!any) return null;

    return {
      version: meta.version != null ? meta.version : null,
      players
    };
  }

  // Back into the `{ id, samples: [{t, score}], events }` shape
  // DominanceChart.setPlayers and DominanceBar.mount both take.
  function rehydrateDominance (packed, slot) {
    const p = packed && packed.players && packed.players[slot];
    if (!p || !p.t || !p.t.length) return null;
    const samples = [];
    for (let i = 0; i < p.t.length; i++) {
      samples.push({ t: p.t[i], score: p.score[i] });
    }
    return { samples, events: (p.events || []).slice() };
  }

  // ── Resources ─────────────────────────────────────────────────────────────

  // ResourceSeries samples on a fixed grid (`t = s * SAMPLE_INTERVAL_MS`), so
  // the timestamps are the sample index times one constant and are not stored.
  // The uniformity is VERIFIED rather than assumed: if that ever stops being
  // true upstream, the block is written with explicit timestamps instead of
  // silently mis-timing every chart drawn from it.
  const RESOURCE_KEYS = [
    'foodUsed', 'foodMax', 'goldSpent', 'lumberSpent', 'goldLost', 'lumberLost'
  ];

  function extractResources (out) {
    // Two passes, because uniformity is a property of the whole block: one
    // ragged seat has to put timestamps on every seat, and deciding that while
    // already writing columns would leave the seats read before it without.
    const raw = {};
    let intervalMs = null;
    for (const slot of Object.keys((out && out.players) || {})) {
      const series = out.players[slot] && out.players[slot].resourceSeries;
      if (!series || series.length < 2) continue;
      const samples = series.slice(0, MAX_SAMPLES);
      const step = (samples[1].t || 0) - (samples[0].t || 0);
      if (step <= 0) continue;
      if (intervalMs === null) intervalMs = step;
      raw[slot] = samples;
    }
    const slots = Object.keys(raw);
    if (!slots.length) return null;

    let uniform = true;
    for (const slot of slots) {
      for (let i = 0; i < raw[slot].length; i++) {
        if (raw[slot][i].t !== i * intervalMs) { uniform = false; break; }
      }
      if (!uniform) break;
    }

    const players = {};
    for (const slot of slots) {
      const cols = {};
      for (const k of RESOURCE_KEYS) cols[k] = raw[slot].map(s => Math.round(s[k] || 0));
      if (!uniform) cols.t = raw[slot].map(s => s.t || 0);
      players[slot] = cols;
    }

    return { intervalMs: uniform ? intervalMs : null, players };
  }

  // Back into the `[{ t, foodUsed, foodMax, ... }]` shape
  // ResourceCharts.setPlayers takes as `resourceSeries`.
  function rehydrateResources (packed, slot) {
    const p = packed && packed.players && packed.players[slot];
    if (!p || !p.foodUsed || !p.foodUsed.length) return null;
    const out = [];
    for (let i = 0; i < p.foodUsed.length; i++) {
      const s = { t: p.t ? p.t[i] : i * (packed.intervalMs || 10000) };
      for (const k of RESOURCE_KEYS) s[k] = p[k] ? p[k][i] : 0;
      // Nothing charts foodLost and it is not stored; ResourceCharts never
      // reads it, but a 0 keeps the sample shape honest for anything that does.
      s.foodLost = 0;
      out.push(s);
    }
    return out;
  }

  const api = {
    extractDominance,
    rehydrateDominance,
    extractResources,
    rehydrateResources,
    RESOURCE_KEYS,
    MAX_SAMPLES
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SeriesExtract = api;
})();
