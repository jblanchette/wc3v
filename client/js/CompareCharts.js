// CompareCharts — SVG chart factories for the compare modal drill-downs.
//
// Each builder takes already-aligned (you, pro) sample arrays and returns
// an SVG string. No DOM manipulation — pure markup. The CompareInline
// renderer drops the result into the page.

(function () {
  'use strict';

  const CHART_W = 720;
  const CHART_H = 200;
  const PAD = { l: 36, r: 16, t: 12, b: 24 };

  function fmtMs (ms) {
    const m = Math.floor((ms || 0) / 60000);
    const s = Math.floor(((ms || 0) % 60000) / 1000);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  // ── Generic dual-line chart ─────────────────────────────────────────────────
  // Series item: { gameTimeMs, userValue, proValue }
  function dualLineChart (series, opts) {
    opts = opts || {};
    if (!series || !series.length) return '';
    const W = opts.width || CHART_W;
    const H = opts.height || CHART_H;
    const innerW = W - PAD.l - PAD.r;
    const innerH = H - PAD.t - PAD.b;
    const maxT = series[series.length - 1].gameTimeMs || 0;
    if (maxT <= 0) return '';
    let yMax = 1;
    for (const s of series) {
      if ((s.userValue || 0) > yMax) yMax = s.userValue;
      if ((s.proValue || 0) > yMax) yMax = s.proValue;
    }
    yMax = Math.ceil(yMax * 1.1);
    const xFor = (t) => PAD.l + (t / maxT) * innerW;
    const yFor = (v) => PAD.t + innerH - ((v || 0) / yMax) * innerH;
    const buildPath = (key) => {
      const pts = series.map(s => `${xFor(s.gameTimeMs).toFixed(1)},${yFor(s[key]).toFixed(1)}`);
      return 'M' + pts.join(' L');
    };
    // Time gridlines every 2 minutes.
    const gridX = [];
    for (let t = 0; t <= maxT; t += 120000) {
      const x = xFor(t);
      gridX.push(`<line x1="${x}" y1="${PAD.t}" x2="${x}" y2="${PAD.t + innerH}" class="ci-chart-grid"/>` +
                 `<text x="${x}" y="${PAD.t + innerH + 14}" text-anchor="middle" class="ci-chart-axis">${Math.floor(t/60000)}:00</text>`);
    }
    const gridY = [];
    for (let i = 0; i <= 4; i++) {
      const v = yMax * i / 4;
      const y = yFor(v);
      gridY.push(`<line x1="${PAD.l}" y1="${y}" x2="${PAD.l + innerW}" y2="${y}" class="ci-chart-grid"/>` +
                 `<text x="${PAD.l - 6}" y="${y + 3}" text-anchor="end" class="ci-chart-axis">${Math.round(v)}</text>`);
    }
    const title = opts.title ? `<text x="${PAD.l}" y="${PAD.t - 2}" class="ci-chart-title">${escapeHtml(opts.title)}</text>` : '';
    return `
      <svg class="ci-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(opts.title || 'comparison chart')}">
        ${title}
        ${gridX.join('')}
        ${gridY.join('')}
        <path d="${buildPath('userValue')}" class="ci-chart-line ci-chart-you"/>
        <path d="${buildPath('proValue')}" class="ci-chart-line ci-chart-pro"/>
      </svg>
    `;
  }

  // Supply over time — convenience wrapper.
  function supplyChart (uTrack, pTrack, opts) {
    if (!uTrack || !pTrack || !uTrack.length || !pTrack.length) return '';
    const series = alignTracks(uTrack, pTrack, 'supplyUsed');
    return dualLineChart(series, Object.assign({ title: 'Supply over time' }, opts || {}));
  }

  function workersChart (uTrack, pTrack, opts) {
    if (!uTrack || !pTrack || !uTrack.length || !pTrack.length) return '';
    const series = alignTracks(uTrack, pTrack, 'totalWorkers');
    return dualLineChart(series, Object.assign({ title: 'Workers over time' }, opts || {}));
  }

  // Idle headroom chart — derived from supplyMax - supplyUsed.
  function idleHeadroomChart (uTrack, pTrack, opts) {
    if (!uTrack || !pTrack || !uTrack.length || !pTrack.length) return '';
    const series = [];
    const endMs = Math.min(
      uTrack[uTrack.length - 1].gameTimeMs,
      pTrack[pTrack.length - 1].gameTimeMs
    );
    for (let t = 0; t <= endMs; t += 30_000) {
      const us = sampleAt(uTrack, t);
      const ps = sampleAt(pTrack, t);
      if (!us || !ps) continue;
      series.push({
        gameTimeMs: t,
        userValue: Math.max(0, (us.supplyMax || 0) - (us.supplyUsed || 0)),
        proValue: Math.max(0, (ps.supplyMax || 0) - (ps.supplyUsed || 0))
      });
    }
    return dualLineChart(series, Object.assign({ title: 'Idle supply headroom (lower is better)' }, opts || {}));
  }

  // Combat units chart from combatUnitsTrack.
  function combatUnitsChart (uTrack, pTrack, opts) {
    if (!uTrack || !pTrack || !uTrack.length || !pTrack.length) return '';
    const series = alignTracks(uTrack, pTrack, 'count');
    return dualLineChart(series, Object.assign({ title: 'Combat units over time' }, opts || {}));
  }

  // Tier-progression segmented bar — one row per side. Renders T1/T2/T3
  // segments proportional to the time spent in each tier.
  function tierProgressionRow (label, tier2Time, tier3Time, totalMs, accentColor) {
    if (!totalMs) return '';
    const t2 = tier2Time != null ? Math.min(totalMs, tier2Time) : totalMs;
    const t3 = tier3Time != null ? Math.min(totalMs, tier3Time) : totalMs;
    const t1Pct = (t2 / totalMs) * 100;
    const t2Pct = ((t3 - t2) / totalMs) * 100;
    const t3Pct = 100 - t1Pct - t2Pct;
    const fmt = (ms) => ms != null ? fmtMs(ms) : '—';
    const acc = accentColor || '#6cc080';
    return `
      <div class="ci-tier-row">
        <div class="ci-tier-row-label">${escapeHtml(label)}</div>
        <div class="ci-tier-bar" style="--tier-accent:${acc};">
          <div class="ci-tier-seg ci-tier-seg-t1" style="width:${t1Pct.toFixed(2)}%;" title="T1 → T2 at ${fmt(tier2Time)}"></div>
          <div class="ci-tier-seg ci-tier-seg-t2" style="width:${t2Pct.toFixed(2)}%;" title="T2 → T3 at ${fmt(tier3Time)}"></div>
          <div class="ci-tier-seg ci-tier-seg-t3" style="width:${t3Pct.toFixed(2)}%;"></div>
        </div>
        <div class="ci-tier-row-times">
          <span>T2 ${fmt(tier2Time)}</span>
          <span>T3 ${fmt(tier3Time)}</span>
        </div>
      </div>
    `;
  }

  // (upgradeTimeline removed — replaced by CompareInline._renderUpgradeTrack
  // which lays events out per-category on a horizontal time axis with
  // collision-aware vertical stacking. Keeping the chart factories pure.)

  // Tiny inline SVG sparkline (no axes / labels). Used by Top Fix cards to
  // show the gap visually next to the headline. Series shape matches
  // dualLineChart input — { gameTimeMs, userValue, proValue }.
  function sparkline (series, opts) {
    opts = opts || {};
    if (!series || !series.length) return '';
    const W = opts.width || 88;
    const H = opts.height || 28;
    const PAD = 2;
    const innerW = W - PAD * 2;
    const innerH = H - PAD * 2;
    const maxT = series[series.length - 1].gameTimeMs || 1;
    let yMax = 1;
    for (const s of series) {
      if ((s.userValue || 0) > yMax) yMax = s.userValue;
      if ((s.proValue || 0) > yMax) yMax = s.proValue;
    }
    yMax = Math.max(yMax * 1.05, 1);
    const xFor = (t) => PAD + (t / maxT) * innerW;
    const yFor = (v) => PAD + innerH - ((v || 0) / yMax) * innerH;
    const buildPath = (key) => series.map(s => `${xFor(s.gameTimeMs).toFixed(1)},${yFor(s[key]).toFixed(1)}`).join(' L');
    return `
      <svg class="ci-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <path d="M${buildPath('proValue')}" class="ci-spark-pro"/>
        <path d="M${buildPath('userValue')}" class="ci-spark-you"/>
      </svg>
    `;
  }

  // Helpers
  function alignTracks (uTrack, pTrack, key) {
    const out = [];
    const endMs = Math.min(
      uTrack[uTrack.length - 1].gameTimeMs,
      pTrack[pTrack.length - 1].gameTimeMs
    );
    for (let t = 0; t <= endMs; t += 30_000) {
      const us = sampleAt(uTrack, t);
      const ps = sampleAt(pTrack, t);
      if (!us || !ps) continue;
      out.push({ gameTimeMs: t, userValue: us[key] || 0, proValue: ps[key] || 0 });
    }
    return out;
  }

  function sampleAt (track, t) {
    let pick = null;
    for (const s of track) {
      if (s.gameTimeMs <= t) pick = s;
      else break;
    }
    return pick;
  }

  function escapeHtml (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  const api = {
    dualLineChart,
    supplyChart,
    workersChart,
    idleHeadroomChart,
    combatUnitsChart,
    tierProgressionRow,
    sparkline,
    fmtMs
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.CompareCharts = api;
})();
