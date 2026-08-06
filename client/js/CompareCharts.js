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

  // ── Where a series stops being flat ────────────────────────────────────────
  //
  // Cumulative series (gold lost, lumber lost, units trained) sit at their
  // opening value until the first thing happens, and a chart that starts at
  // 0:00 spends that whole stretch drawing a straight line along the floor.
  // Measured over 80 games (`tools/analyse-resource-series.js`): gold lost is
  // flat for a median 27% of the x-axis and lumber lost for 43%, worst case the
  // entire game.
  //
  // Returns the timestamp of the first sample where ANY of `keys` differs from
  // its own opening value, or 0 when nothing ever moves — a chart with no
  // movement should draw its whole span rather than collapse to a point.
  //
  // `epsilon` exists for series that ease rather than step: dominance leaves
  // 50/50 gradually over its early ramp, so "different from the opening value"
  // has to mean "different enough to see".
  function firstChangeMs (series, keys, epsilon) {
    if (!series || series.length < 2) return 0;
    const eps = epsilon || 0;
    const ks = Array.isArray(keys) ? keys : [keys];
    const base = {};
    for (const k of ks) base[k] = series[0][k] || 0;
    for (const s of series) {
      for (const k of ks) {
        if (Math.abs((s[k] || 0) - base[k]) > eps) return s.gameTimeMs || 0;
      }
    }
    return 0;
  }

  // Round a maximum up to something a person would choose: 1, 2 or 5 times a
  // power of ten. Raw `Math.ceil(peak * 1.15)` gives axes labelled 1173 / 587 /
  // -586 / -1173, where the two middles are the same number rounded in
  // different directions and none of them is a value anybody would pick.
  function niceCeil (v) {
    if (!(v > 0)) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  }

  // Axis labels short enough for the 36px y-gutter. "-2000" at the diverging
  // chart's authored type is ~45px and its leading sign was being clipped off
  // the left of the viewBox, so the negative ticks read as positive.
  function fmtCompact (v) {
    const a = Math.abs(v);
    const sign = v > 0 ? '+' : v < 0 ? '−' : '';
    if (a >= 1000) {
      const k = a / 1000;
      return `${sign}${k >= 10 ? Math.round(k) : (Math.round(k * 10) / 10)}k`;
    }
    return `${sign}${Math.round(a)}`;
  }

  // Vertical event lines, clipped to the drawn span.
  function eventMarkers (marks, startT, maxT, xFor, innerH) {
    const out = [];
    for (const m of (marks || [])) {
      if (!m || m.gameTimeMs == null || m.gameTimeMs < startT || m.gameTimeMs > maxT) continue;
      const x = xFor(m.gameTimeMs);
      out.push(`<line x1="${x.toFixed(1)}" y1="${PAD.t}" x2="${x.toFixed(1)}" y2="${PAD.t + innerH}" class="ci-chart-marker"${m.label ? ` data-label="${escapeHtml(m.label)}"` : ''}><title>${escapeHtml(m.label || '')}</title></line>`);
    }
    return out;
  }

  // Shared time axis. `startT` is the left edge, which is not always 0 — see
  // firstChangeMs. The start is ALWAYS labelled, because an axis that begins at
  // 6:00 with no mark there reads as a game that began late.
  function timeAxis (startT, maxT, xFor, innerH) {
    // Every 2 minutes, stretched to every 4 on long games — a 40-minute game at
    // 2:00 steps is 21 labels shoulder to shoulder.
    const span = maxT - startT;
    const stepMs = span > 20 * 60000 ? 240000 : 120000;
    const out = [];
    const tick = (t, label) => {
      const x = xFor(t);
      out.push(`<line x1="${x.toFixed(1)}" y1="${PAD.t}" x2="${x.toFixed(1)}" y2="${PAD.t + innerH}" class="ci-chart-grid"/>` +
        `<text x="${x.toFixed(1)}" y="${PAD.t + innerH + 14}" text-anchor="middle" class="ci-chart-axis">${label}</text>`);
    };
    if (startT > 0) tick(startT, fmtMs(startT));
    // First whole step strictly after the start, so the start label never has a
    // gridline printed on top of it.
    const first = Math.ceil((startT + 1) / stepMs) * stepMs;
    for (let t = first; t <= maxT; t += stepMs) tick(t, `${Math.floor(t / 60000)}:00`);
    return out;
  }

  // ── Generic dual-line chart ─────────────────────────────────────────────────
  // Series item: { gameTimeMs, userValue, proValue }
  //
  // opts.omitPro  — draw only the user line. For consumers whose "second
  //                 side" does not exist (the desktop app charts an FFA seat
  //                 alone rather than inventing a comparison).
  // opts.markers  — [{ gameTimeMs, label? }] vertical event lines (the
  //                 desktop marks battles on the economy chart). Ignored when
  //                 absent, so every existing call site is unchanged.
  // opts.startMs  — left edge of the x-axis. Defaults to 0, so every existing
  //                 call site is unchanged.
  function dualLineChart (series, opts) {
    opts = opts || {};
    if (!series || !series.length) return '';
    const W = opts.width || CHART_W;
    const H = opts.height || CHART_H;
    const innerW = W - PAD.l - PAD.r;
    const innerH = H - PAD.t - PAD.b;
    const maxT = series[series.length - 1].gameTimeMs || 0;
    if (maxT <= 0) return '';
    // Never trim away the whole plot: a start at or past the end means the
    // series never moved, and the honest drawing of that is the flat line.
    const startT = Math.max(0, Math.min(opts.startMs || 0, maxT - 1));
    // The sample straddling the start is kept so the line enters from the left
    // edge rather than beginning in mid-air.
    const kept = series.filter((s, i) =>
      s.gameTimeMs >= startT || (series[i + 1] && series[i + 1].gameTimeMs > startT));
    if (kept.length < 2) return '';
    let yMax = 1;
    for (const s of kept) {
      if ((s.userValue || 0) > yMax) yMax = s.userValue;
      if (!opts.omitPro && (s.proValue || 0) > yMax) yMax = s.proValue;
    }
    yMax = Math.ceil(yMax * 1.1);
    const xFor = (t) => PAD.l + ((t - startT) / (maxT - startT)) * innerW;
    const yFor = (v) => PAD.t + innerH - ((v || 0) / yMax) * innerH;
    const buildPath = (key) => {
      const pts = kept.map(s => `${xFor(s.gameTimeMs).toFixed(1)},${yFor(s[key]).toFixed(1)}`);
      return 'M' + pts.join(' L');
    };
    const gridX = timeAxis(startT, maxT, xFor, innerH);
    const gridY = [];
    for (let i = 0; i <= 4; i++) {
      const v = yMax * i / 4;
      const y = yFor(v);
      gridY.push(`<line x1="${PAD.l}" y1="${y}" x2="${PAD.l + innerW}" y2="${y}" class="ci-chart-grid"/>` +
                 `<text x="${PAD.l - 6}" y="${y + 3}" text-anchor="end" class="ci-chart-axis">${Math.round(v)}</text>`);
    }
    const markers = eventMarkers(opts.markers, startT, maxT, xFor, innerH);
    const title = opts.title ? `<text x="${PAD.l}" y="${PAD.t - 2}" class="ci-chart-title">${escapeHtml(opts.title)}</text>` : '';
    const proPath = opts.omitPro ? '' : `<path d="${buildPath('proValue')}" class="ci-chart-line ci-chart-pro"/>`;
    return `
      <svg class="ci-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(opts.title || 'comparison chart')}">
        ${title}
        ${gridX.join('')}
        ${gridY.join('')}
        ${markers.join('')}
        <path d="${buildPath('userValue')}" class="ci-chart-line ci-chart-you"/>
        ${proPath}
      </svg>
    `;
  }

  // ── Diverging chart ─────────────────────────────────────────────────────────
  // Series item: { gameTimeMs, value }, where the sign is the whole point.
  //
  // Built for the desktop's trade balance: their cumulative losses minus yours.
  // Above the midline you are winning the trades, below you are bleeding.
  //
  // Two cumulative loss curves cannot show this. Both climb monotonically, both
  // spend the opening flat on the floor, and "who is ahead" is the gap between
  // them — which is the one thing a reader has to do arithmetic to get. The
  // difference IS the answer, so plot the difference.
  //
  // The y range is symmetric about zero so the midline sits in the middle and a
  // swing of the same size reads the same size whichever way it went.
  //
  // opts.startMs, opts.markers, opts.width, opts.height as dualLineChart.
  // opts.zeroLabel — what the midline means, printed against it.
  function divergingChart (series, opts) {
    opts = opts || {};
    if (!series || series.length < 2) return '';
    const W = opts.width || CHART_W;
    const H = opts.height || CHART_H;
    const innerW = W - PAD.l - PAD.r;
    const innerH = H - PAD.t - PAD.b;
    const maxT = series[series.length - 1].gameTimeMs || 0;
    if (maxT <= 0) return '';
    const startT = Math.max(0, Math.min(opts.startMs || 0, maxT - 1));
    const kept = series.filter((s, i) =>
      s.gameTimeMs >= startT || (series[i + 1] && series[i + 1].gameTimeMs > startT));
    if (kept.length < 2) return '';

    let mag = 1;
    for (const s of kept) mag = Math.max(mag, Math.abs(s.value || 0));
    // Nice, so the half-ticks are whole numbers and the axis reads +2000 / +1000
    // / -1000 / -2000 rather than +1173 / +587 / -586 / -1173.
    mag = niceCeil(mag * 1.05);

    const xFor = (t) => PAD.l + ((t - startT) / (maxT - startT)) * innerW;
    const yFor = (v) => PAD.t + innerH / 2 - ((v || 0) / mag) * (innerH / 2);
    const zeroY = yFor(0);

    const pts = kept.map(s => `${xFor(s.gameTimeMs).toFixed(1)},${yFor(s.value).toFixed(1)}`);
    const line = 'M' + pts.join(' L');
    // Filled back to the midline. The area is what makes the sign legible at a
    // glance; the line alone reads as an ordinary plot that happens to cross a
    // rule. One path with a clip per side, so the fill above and the fill below
    // can carry different colours without splitting the series.
    const area = `M${xFor(kept[0].gameTimeMs).toFixed(1)},${zeroY.toFixed(1)} L` +
      pts.join(' L') +
      ` L${xFor(kept[kept.length - 1].gameTimeMs).toFixed(1)},${zeroY.toFixed(1)} Z`;

    const gridX = timeAxis(startT, maxT, xFor, innerH);
    const gridY = [];
    for (const v of [mag, mag / 2, -mag / 2, -mag]) {
      const y = yFor(v);
      gridY.push(`<line x1="${PAD.l}" y1="${y.toFixed(1)}" x2="${PAD.l + innerW}" y2="${y.toFixed(1)}" class="ci-chart-grid"/>` +
        `<text x="${PAD.l - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" class="ci-chart-axis">${fmtCompact(v)}</text>`);
    }
    const markers = eventMarkers(opts.markers, startT, maxT, xFor, innerH);
    const title = opts.title ? `<text x="${PAD.l}" y="${PAD.t - 2}" class="ci-chart-title">${escapeHtml(opts.title)}</text>` : '';
    const zeroLabel = opts.zeroLabel
      ? `<text x="${PAD.l + innerW}" y="${(zeroY - 4).toFixed(1)}" text-anchor="end" class="ci-chart-axis">${escapeHtml(opts.zeroLabel)}</text>`
      : '';

    // Unique per render: two of these on one page would otherwise share a clip.
    const uid = `dv${Math.abs(Math.round(maxT + mag + kept.length))}`;

    return `
      <svg class="ci-chart ci-diverging" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(opts.title || 'balance over time')}">
        <defs>
          <clipPath id="${uid}-up"><rect x="${PAD.l}" y="${PAD.t}" width="${innerW}" height="${(zeroY - PAD.t).toFixed(1)}"/></clipPath>
          <clipPath id="${uid}-dn"><rect x="${PAD.l}" y="${zeroY.toFixed(1)}" width="${innerW}" height="${(PAD.t + innerH - zeroY).toFixed(1)}"/></clipPath>
        </defs>
        ${title}
        ${gridX.join('')}
        ${gridY.join('')}
        ${markers.join('')}
        <path d="${area}" class="ci-dv-fill ci-dv-up" clip-path="url(#${uid}-up)"/>
        <path d="${area}" class="ci-dv-fill ci-dv-down" clip-path="url(#${uid}-dn)"/>
        <line x1="${PAD.l}" y1="${zeroY.toFixed(1)}" x2="${PAD.l + innerW}" y2="${zeroY.toFixed(1)}" class="ci-dv-zero"/>
        ${zeroLabel}
        <path d="${line}" class="ci-chart-line ci-dv-line"/>
      </svg>
    `;
  }

  // ── Value against a cap ─────────────────────────────────────────────────────
  // Series item: { gameTimeMs, userValue, userMax, proValue, proMax }.
  //
  // Built for food. Four lines (used and cap, per player) is what
  // ResourceCharts drew, and over 80 games the two USED curves sit a median 9%
  // apart — they trace each other, so half the ink is two lines fighting over
  // the same pixels while the caps add two more. The cap is not a series you
  // compare, it is the ceiling the other line is pressing against, so it is
  // drawn as a band behind rather than a line among.
  function capChart (series, opts) {
    opts = opts || {};
    if (!series || series.length < 2) return '';
    const W = opts.width || CHART_W;
    const H = opts.height || CHART_H;
    const innerW = W - PAD.l - PAD.r;
    const innerH = H - PAD.t - PAD.b;
    const maxT = series[series.length - 1].gameTimeMs || 0;
    if (maxT <= 0) return '';
    const startT = Math.max(0, Math.min(opts.startMs || 0, maxT - 1));
    const kept = series.filter((s, i) =>
      s.gameTimeMs >= startT || (series[i + 1] && series[i + 1].gameTimeMs > startT));
    if (kept.length < 2) return '';

    let yMax = 1;
    for (const s of kept) {
      for (const k of ['userValue', 'userMax', 'proValue', 'proMax']) {
        if (opts.omitPro && k.indexOf('pro') === 0) continue;
        if ((s[k] || 0) > yMax) yMax = s[k];
      }
    }
    // No headroom and no rounding up: `userValue` can never exceed `userMax`,
    // so the cap is the ceiling by construction and it is already a round
    // number in game terms. niceCeil took a 100-food game to a 200 axis and
    // drew the whole curve in the bottom half.

    const xFor = (t) => PAD.l + ((t - startT) / (maxT - startT)) * innerW;
    const yFor = (v) => PAD.t + innerH - ((v || 0) / yMax) * innerH;
    const path = (key) => 'M' + kept.map(s =>
      `${xFor(s.gameTimeMs).toFixed(1)},${yFor(s[key]).toFixed(1)}`).join(' L');

    // The cap steps rather than slopes — supply arrives in whole buildings — so
    // the band is drawn with square corners. A diagonal between two supply
    // levels claims a moment that never happened.
    const capBand = (key) => {
      const pts = [];
      let prevY = null;
      for (const s of kept) {
        const x = xFor(s.gameTimeMs).toFixed(1);
        const y = yFor(s[key]).toFixed(1);
        if (prevY !== null) pts.push(`${x},${prevY}`);
        pts.push(`${x},${y}`);
        prevY = y;
      }
      const x0 = xFor(kept[0].gameTimeMs).toFixed(1);
      const xN = xFor(kept[kept.length - 1].gameTimeMs).toFixed(1);
      const floor = (PAD.t + innerH).toFixed(1);
      return `M${x0},${floor} L` + pts.join(' L') + ` L${xN},${floor} Z`;
    };

    const gridX = timeAxis(startT, maxT, xFor, innerH);
    const gridY = [];
    for (let i = 0; i <= 4; i++) {
      const v = yMax * i / 4;
      const y = yFor(v);
      gridY.push(`<line x1="${PAD.l}" y1="${y.toFixed(1)}" x2="${PAD.l + innerW}" y2="${y.toFixed(1)}" class="ci-chart-grid"/>` +
        `<text x="${PAD.l - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" class="ci-chart-axis">${Math.round(v)}</text>`);
    }
    const markers = eventMarkers(opts.markers, startT, maxT, xFor, innerH);
    const title = opts.title ? `<text x="${PAD.l}" y="${PAD.t - 2}" class="ci-chart-title">${escapeHtml(opts.title)}</text>` : '';
    const pro = opts.omitPro ? '' :
      `<path d="${capBand('proMax')}" class="ci-cap-band ci-cap-pro"/>` +
      `<path d="${path('proValue')}" class="ci-chart-line ci-chart-pro"/>`;

    return `
      <svg class="ci-chart ci-capchart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(opts.title || 'usage against cap')}">
        ${title}
        ${gridX.join('')}
        ${gridY.join('')}
        <path d="${capBand('userMax')}" class="ci-cap-band ci-cap-you"/>
        ${pro}
        ${markers.join('')}
        <path d="${path('userValue')}" class="ci-chart-line ci-chart-you"/>
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

  // The plot area as fractions of the authored viewBox, published for the same
  // reason DominanceChart and ResourceCharts publish theirs: a consumer turning
  // a pointer position back into a game time must go through the y-axis gutter
  // or every seek lands early. `width` is the default; a caller that overrides
  // it scales all three together, so the fractions still hold.
  const GEOMETRY = { width: CHART_W, marginLeft: PAD.l, marginRight: PAD.r };

  const api = {
    dualLineChart,
    divergingChart,
    capChart,
    firstChangeMs,
    GEOMETRY,
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
