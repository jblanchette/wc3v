// Resources: what the trades cost, and whether you outgrew them.
//
// Two plots, both from `CompareCharts`, both derivations of the stored resource
// series that no viewer chart draws:
//
//   Trade balance   their cumulative losses minus yours, on a zero midline
//   Food            supply used against the cap it is pressing on
//
// ── Why this stopped mounting the viewer's ResourceCharts ────────────────────
//
// It used to, and that was the right instinct: the mount-seam rule in
// `dominance-panel.js` says borrow the viewer's class rather than redraw it.
// ResourceCharts stacks three plots — food, gold lost, lumber lost — one line
// per player each, sized for the viewer's ~320px insights panel.
//
// Measured over 80 games (`node tools/analyse-resource-series.js`):
//
//   series        flat head (median)   worst    the two lines differ by
//   food used            1%             4%              9%
//   gold lost           27%            77%             39%
//   lumber lost         43%           100%             57%
//
// So gold lost draws a flat floor for a quarter of the game before it starts,
// lumber lost for nearly half and sometimes for all of it, and food draws four
// lines (used and cap, per player) of which the two that matter sit 9% apart
// and trace each other. Widened to a 1200px desktop panel, three of those
// stacked is three 21:1 strips.
//
// The rule was never "mount the viewer's class whatever it draws" — it is "do
// not draw a second version of a chart the viewer already has". A cumulative
// loss curve and its difference are not the same chart. Army has always been
// here for the same reason: a summary-only derivation with no viewer class to
// borrow. `ResourceCharts` is no longer shipped to the desktop.

(function () {
  'use strict';

  const node = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  };

  const KEYS = ['goldLost', 'lumberLost', 'foodUsed', 'foodMax'];

  // Lumber is worth roughly what gold is in a trade, and the parser prices both
  // in the same units, so the balance is one number rather than two charts that
  // have to be read against each other. `lumberWeight` mirrors the 1.0 in
  // helpers/dominanceConfig.json, where the same call was already made.
  const LUMBER_WEIGHT = 1.0;
  const lost = (s) => (s.goldLost || 0) + (s.lumberLost || 0) * LUMBER_WEIGHT;

  window.EconomyPanel = {
    // Whether the stored summary carries the resource series at all. False for
    // anything stored before schema v4.
    hasResources (summary) {
      return !!(window.CompareCharts && window.SeriesExtract && summary &&
        summary.resources && Object.keys(summary.resources.players || {}).length);
    },

    // summary, seat, opts: { onWatch(summary, moment) }
    //
    // Returns a detached element, or null when there is nothing to draw.
    build (summary, seat, opts) {
      if (!this.hasResources(summary)) return null;
      const o = opts || {};
      const CC = window.CompareCharts;

      const packed = summary.resources;
      const slots = Object.keys(packed.players);
      slots.sort((a, b) => (a === seat ? -1 : b === seat ? 1 : a.localeCompare(b)));

      const infos = [];
      for (const slot of slots) {
        const series = window.SeriesExtract.rehydrateResources(packed, slot);
        if (!series || series.length < 2) continue;
        const p = summary.players[slot] || {};
        infos.push({
          id: slot,
          name: String(p.name || `Player ${slot}`).replace(/#.*$/, ''),
          series
        });
      }
      if (!infos.length) return null;

      const me = infos[0];
      // Two seats get a balance. Anything else charts the viewed seat's food
      // alone, because "their losses" has no single owner in an FFA.
      const them = infos.length === 2 ? infos[1] : null;

      const markers = (summary.moments || [])
        .filter(m => m.type === 'heroKill' || m.type === 'heroTrade' || m.type === 'wipe')
        .map(m => ({ gameTimeMs: m.t, label: `${m.tf} · ${m.label || 'fight'}` }));

      // Authored for the box it actually gets, which is a HALF-width column
      // here, not the full one the army plot uses. `xMidYMid meet` plus
      // `height: auto` means the rendered height is width ÷ aspect, so a
      // 1200x200 viewBox in a 420px column draws 70px tall — 6:1, the same
      // skinny strip this pass exists to kill. 560x200 is 2.8:1, and at the
      // 420-594px these columns actually measure it renders 150-212px.
      //
      // Keeping the viewBox width near the rendered width also keeps the axis
      // text near its authored size; see `.ci-diverging .ci-chart-axis`.
      const CHART_BOX = { width: 560, height: 200 };
      const wrap = node('div', 'rc-panel');

      // Each plot records the second it starts at. Both trim their own dead
      // head independently, so a click at the same x on two plots is a
      // different moment, and the seek has to read the span its own plot drew.
      const plot = (svg, startMs, label, head3, hint, aria) => {
        if (!svg) return;
        const block = node('div', 'chart-block');
        const head = node('div', 'rc-head');
        head.appendChild(node('span', 'rc-title', label));
        for (const el of head3) if (el) head.appendChild(el);
        block.appendChild(head);
        const holder = node('div', 'chart-holder');
        holder.dataset.startMs = String(startMs || 0);
        holder.setAttribute('role', 'img');
        holder.setAttribute('aria-label', aria || label);
        holder.innerHTML = svg;   // our own factory output, never replay text
        block.appendChild(holder);
        if (hint) block.appendChild(node('p', 'hint', hint));
        wrap.appendChild(block);
      };

      // ── Trade balance ────────────────────────────────────────────────────
      if (them) {
        // Aligned by index: SeriesExtract rehydrates both seats off the same
        // fixed grid, so sample i is the same instant for both.
        const n = Math.min(me.series.length, them.series.length);
        const balance = [];
        for (let i = 0; i < n; i++) {
          balance.push({
            gameTimeMs: me.series[i].t,
            value: Math.round(lost(them.series[i]) - lost(me.series[i]))
          });
        }
        const startMs = CC.firstChangeMs(balance, 'value');
        const final = balance[balance.length - 1].value;
        let peak = 0;
        for (const b of balance) if (Math.abs(b.value) > Math.abs(peak)) peak = b.value;

        const sign = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString()}`;
        const readout = node('b', 'rc-v', sign(final));
        readout.dataset.band = final > 0 ? 'good' : final < 0 ? 'poor' : '';

        plot(
          CC.divergingChart(balance, { markers, startMs, zeroLabel: 'even', ...CHART_BOX }),
          startMs,
          'Trade balance',
          [readout, node('span', 'rc-sub', peak !== final ? `peak ${sign(peak)}` : '')],
          // Sign convention stated once. "+1,240" on a chart with no stated
          // direction is a number somebody has to guess the meaning of.
          'Their losses minus yours. Above the line you came out ahead on trades.',
          `Trade balance. You ended ${final >= 0 ? 'up' : 'down'} ${Math.abs(final)} resources on trades.`
        );
      }

      // ── Food ─────────────────────────────────────────────────────────────
      const n = them ? Math.min(me.series.length, them.series.length) : me.series.length;
      const food = [];
      for (let i = 0; i < n; i++) {
        food.push({
          gameTimeMs: me.series[i].t,
          userValue: me.series[i].foodUsed || 0,
          userMax: me.series[i].foodMax || 0,
          proValue: them ? (them.series[i].foodUsed || 0) : 0,
          proMax: them ? (them.series[i].foodMax || 0) : 0
        });
      }
      const foodStart = CC.firstChangeMs(food, ['userValue', 'proValue']);
      const lastFood = food[food.length - 1];
      plot(
        CC.capChart(food, { markers, startMs: foodStart, omitPro: !them, ...CHART_BOX }),
        foodStart,
        'Food',
        [node('b', 'rc-v', `${lastFood.userValue}/${lastFood.userMax}`),
          node('span', 'rc-sub', them ? `them ${lastFood.proValue}/${lastFood.proMax}` : '')],
        null,
        'Supply used against the cap it is pressing on.'
      );

      if (!wrap.children.length) return null;

      // Who is who. The band and the line share a hue per side, so one legend
      // covers both plots.
      const legend = node('div', 'chart-legend');
      const mine = node('span', 'legend-item legend-you');
      mine.appendChild(node('i', 'legend-swatch'));
      mine.appendChild(node('span', null, seat !== null && me.id === seat ? 'You' : me.name));
      legend.appendChild(mine);
      if (them) {
        const theirs = node('span', 'legend-item legend-opp');
        theirs.appendChild(node('i', 'legend-swatch'));
        theirs.appendChild(node('span', null, them.name));
        legend.appendChild(theirs);
      }
      wrap.insertBefore(legend, wrap.firstChild);

      // Double-click to seek, the same gesture every other plot on this screen
      // takes. The x mapping goes through the chart's own padding rather than
      // the element width, because the plot starts after a y-axis gutter, and
      // it reads each holder's own `startMs` because the two plots trim
      // independently — the same x on both is a different second.
      const endT = me.series[me.series.length - 1].t;
      if (o.onWatch && endT > 0) {
        const G = CC.GEOMETRY;
        const leftF = G.marginLeft / G.width;
        const innerF = (G.width - G.marginLeft - G.marginRight) / G.width;
        for (const holder of wrap.querySelectorAll('.chart-holder')) {
          holder.title = 'Double-click to open the viewer at that moment.';
          holder.addEventListener('dblclick', (e) => {
            const r = holder.getBoundingClientRect();
            if (r.width <= 0) return;
            const start = Number(holder.dataset.startMs || 0);
            const f = (e.clientX - r.left) / r.width;
            const inner = Math.max(0, Math.min(1, (f - leftF) / innerF));
            const t = Math.round(start + inner * (endT - start));
            o.onWatch(summary, { t, tf: CC.fmtMs(t) });
          });
        }
      }

      return wrap;
    }
  };
})();
