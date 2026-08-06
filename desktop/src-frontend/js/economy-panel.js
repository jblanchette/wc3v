// The economy panel: the viewer's own resource charts, driven by a summary.
//
// Same rule as dominance-panel.js — this file owns no chart code.
// `ResourceCharts` is the class client/viewer.html mounts in its insights
// panel: three stacked plots (food, gold lost, lumber lost), one coloured line
// per player, drawn from `player.resourceSeries`. SeriesExtract packs that
// series into the stored summary at parse time and unpacks it here.
//
// Army size stays on `CompareCharts.combatUnitsChart`, because there is no
// viewer chart for it — combat-unit count is a summary-only derivation
// (SummaryExtract.extractCombatUnitsTrack) and the compare modal is where it
// already lives.
//
// The standalone workers chart is deliberately gone. The game strip in the
// report frame already draws both players' worker curves as its lane
// backgrounds, so the tab was a second, larger copy of a thing already on
// screen.

(function () {
  'use strict';

  const RACE_COLOR = {
    H: '--race-warm-H', O: '--race-warm-O', E: '--race-warm-E',
    U: '--race-warm-U', R: '--race-warm-R', N: '--race-warm-N'
  };

  const node = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  };

  const colorFor = (race) => {
    const token = RACE_COLOR[race] || RACE_COLOR.N;
    const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    return v || '#8a8378';
  };

  window.EconomyPanel = {
    // Whether the stored summary carries the viewer's resource series at all.
    // False for anything stored before schema v4.
    hasResources (summary) {
      return !!(window.ResourceCharts && window.SeriesExtract && summary &&
        summary.resources && Object.keys(summary.resources.players || {}).length);
    },

    // The three viewer plots. Returns a detached element with a `_charts`
    // handle carrying `setCursor`, or null when there is nothing to draw.
    //
    // summary, seat, opts: { onWatch(summary, moment) }
    build (summary, seat, opts) {
      if (!this.hasResources(summary)) return null;
      const o = opts || {};

      const packed = summary.resources;
      const slots = Object.keys(packed.players);
      // Own seat first, so the legend order matches every other per-player
      // grid in the report.
      slots.sort((a, b) => (a === seat ? -1 : b === seat ? 1 : a.localeCompare(b)));

      const infos = [];
      for (const slot of slots) {
        const series = window.SeriesExtract.rehydrateResources(packed, slot);
        if (!series || !series.length) continue;
        const p = summary.players[slot] || {};
        infos.push({
          id: slot,
          color: colorFor(p.race),
          name: String(p.name || `Player ${slot}`).replace(/#.*$/, ''),
          resourceSeries: series
        });
      }
      if (!infos.length) return null;

      const wrap = node('div', 'rc-panel');

      // ResourceCharts draws no legend — in the viewer the player colours are
      // already established by the match header above it. Nothing has
      // established them here, so the panel says who is who.
      const legend = node('div', 'chart-legend');
      for (const p of infos) {
        const item = node('span', 'legend-item');
        const sw = node('i', 'legend-swatch');
        sw.style.background = p.color;
        item.appendChild(sw);
        item.appendChild(node('span', null,
          seat !== null && p.id === seat ? 'You' : p.name));
        legend.appendChild(item);
      }
      wrap.appendChild(legend);

      const host = node('div', 'rc-host');
      wrap.appendChild(host);

      const charts = new window.ResourceCharts(null);
      charts.setContainer(host);
      charts.setPlayers(infos);
      charts.build();

      // Progressive draw means the lines only exist up to the cursor. In the
      // viewer that is a no-spoilers rule for a game being watched; a finished
      // game has nothing left to spoil, so the whole game is drawn.
      const endT = Math.max(...infos.map(p =>
        p.resourceSeries[p.resourceSeries.length - 1].t));
      charts.setCursor(endT);

      if (o.onWatch && endT > 0) {
        // Through the chart's published geometry, not the element width: the
        // plot starts after a y-axis gutter, and treating the gutter as time
        // puts every seek a minute or two early.
        const G = window.ResourceCharts.GEOMETRY;
        const leftF = G.marginLeft / G.width;
        const innerF = (G.width - G.marginLeft - G.marginRight) / G.width;
        host.title = 'Double-click to open the viewer at that moment.';
        host.addEventListener('dblclick', (e) => {
          const r = host.getBoundingClientRect();
          if (r.width <= 0) return;
          const f = (e.clientX - r.left) / r.width;
          const t = Math.round(Math.max(0, Math.min(1, (f - leftF) / innerF)) * endT);
          o.onWatch(summary, { t, tf: window.CompareCharts.fmtMs(t) });
        });
      }

      wrap._charts = charts;
      return wrap;
    }
  };
})();
