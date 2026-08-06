// One chart slot, three readings of the same game.
//
// Dominance, resources and army size were three charts on two tabs: the
// dominance plot sat at the top of Story and the other two were the whole of an
// Economy tab you had to leave Story to reach. They are the same game on the
// same time axis, and comparing them meant remembering the first one while
// looking at the second.
//
// So: one panel, one height, three toggle chips. Dominance is the default
// because it answers "who was ahead" before the other two answer "why".
//
// This file owns NO chart code, same rule as dominance-panel.js and
// economy-panel.js. It wraps them:
//
//   Dominance   DominancePanel.build   → the viewer's DominanceChart
//   Resources   EconomyPanel.build     → the viewer's ResourceCharts
//   Army        CompareCharts factory  → an SVG string, no class to mount
//
// Army is the odd one only because combat-unit count is a summary-only
// derivation with no viewer chart to borrow.
//
// Modes are built on first use and kept. Rebuilding the dominance chart on
// every chip click would churn its ResizeObserver for no gain, and the other
// two are static once drawn.

(function () {
  'use strict';

  const node = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  };

  // The army chart's viewBox is authored wide on purpose. CompareCharts
  // defaults to 720x200 with `preserveAspectRatio="xMidYMid meet"`, and the
  // holder renders it at `width:100%; height:auto` — so in this column it drew
  // 336px tall at 1280 and scaled its 12px axis text to 20px along with it. At
  // 1200x200 the same plot is ~200px and the axis text lands at its authored
  // size.
  const CHART_BOX = { width: 1200, height: 200 };

  // Remembered across game selections, like the active tab. Somebody stepping
  // through last night's games comparing food curves should not be put back on
  // dominance at every click.
  let mode = 'dominance';

  const armyChart = (summary, seat) => {
    const CC = window.CompareCharts;
    if (!CC) return null;

    const slots = Object.keys(summary.players || {});
    slots.sort((a, b) => (a === seat ? -1 : b === seat ? 1 : a.localeCompare(b)));
    const meSlot = seat != null && summary.players[seat] ? seat : slots[0];
    const me = summary.players[meSlot];
    if (!me || !(me.combatUnitsTrack || []).length) return null;

    // Two players get a duel chart. Anything else charts the viewed seat alone,
    // because inventing a "versus" line in an FFA lies about who it was against.
    const oppSlot = slots.length === 2 ? slots.find(s => s !== meSlot) : null;
    const opp = oppSlot != null ? summary.players[oppSlot] : null;

    const markers = (summary.moments || [])
      .filter(m => m.type === 'heroKill' || m.type === 'heroTrade' || m.type === 'wipe')
      .map(m => ({ gameTimeMs: m.t, label: `${m.tf} · ${m.label || 'fight'}` }));

    // No title inside the SVG. CompareCharts draws it at the plot's top-left,
    // which is where the top y-axis tick already is, and the chip above the
    // panel names the mode anyway. The holder carries the accessible name.
    //
    // Passed explicitly rather than omitted: `combatUnitsChart` supplies its
    // own default through `Object.assign`, so leaving the key out keeps it.
    // Cumulative production is 0 until the first unit walks out, so the plot
    // opens on a flat floor. Trim to where it starts moving; the axis labels
    // its own left edge, so it cannot read as a game that began late.
    const myTrack = (me.combatUnitsTrack || []).map(s =>
      ({ gameTimeMs: s.gameTimeMs, userValue: s.count || 0 }));
    const theirTrack = opp
      ? (opp.combatUnitsTrack || []).map(s => ({ gameTimeMs: s.gameTimeMs, userValue: s.count || 0 }))
      : [];
    const startMs = Math.min(
      CC.firstChangeMs(myTrack, 'userValue'),
      theirTrack.length ? CC.firstChangeMs(theirTrack, 'userValue') : Infinity
    );

    const svg = opp && (opp.combatUnitsTrack || []).length
      ? CC.combatUnitsChart(me.combatUnitsTrack || [], opp.combatUnitsTrack || [],
        { markers, title: '', startMs, ...CHART_BOX })
      : CC.dualLineChart(myTrack, { markers, title: '', omitPro: true, startMs, ...CHART_BOX });
    if (!svg) return null;

    const block = node('div', 'chart-block');

    const legend = node('div', 'chart-legend');
    const mine = node('span', 'legend-item legend-you');
    mine.appendChild(node('i', 'legend-swatch'));
    mine.appendChild(node('span', null,
      seat !== null && meSlot === seat ? 'You' : String(me.name || 'Player').replace(/#.*$/, '')));
    legend.appendChild(mine);
    if (opp) {
      const theirs = node('span', 'legend-item legend-opp');
      theirs.appendChild(node('i', 'legend-swatch'));
      theirs.appendChild(node('span', null, String(opp.name || 'Player').replace(/#.*$/, '')));
      legend.appendChild(theirs);
    }
    block.appendChild(legend);

    const holder = node('div', 'chart-holder');
    holder.setAttribute('role', 'img');
    holder.setAttribute('aria-label', 'Combat units trained over the game');
    holder.innerHTML = svg;   // our own factory output, never replay text
    block.appendChild(holder);

    // The count is cumulative production, not live army size — the track only
    // ever goes up. Saying so on the chart is cheaper than letting somebody
    // read a flat tail as "my army held".
    block.appendChild(node('p', 'hint', 'Units trained over the game. It counts production, not what was alive.'));
    return block;
  };

  window.ChartPanel = {
    // summary, seat, opts: { onWatch(summary, moment), onReparse(label) → button }
    //
    // Returns { el, destroy } or null when not one of the three modes has
    // anything to say. Whoever mounts it owns calling destroy(): the dominance
    // chart registers a ResizeObserver and it must be released even while the
    // panel is parked on another mode.
    build (summary, seat, opts) {
      const o = opts || {};

      // What each mode would draw, decided before anything is built so the
      // chips can be right on first paint.
      const domReason = window.DominancePanel
        ? window.DominancePanel.unavailable(summary)
        : 'Dominance is unavailable in this build.';
      const hasResources = window.EconomyPanel
        ? window.EconomyPanel.hasResources(summary)
        : false;
      const stale = (summary.schemaVersion || 1) < 4;

      const meSlot = seat != null && summary.players[seat]
        ? seat
        : Object.keys(summary.players || {})[0];
      const hasArmy = !!(meSlot != null && summary.players[meSlot] &&
        (summary.players[meSlot].combatUnitsTrack || []).length);

      const MODES = [
        { key: 'dominance', label: 'Dominance', ok: !domReason },
        { key: 'resources', label: 'Resources', ok: hasResources },
        { key: 'army', label: 'Army', ok: hasArmy }
      ];
      if (!MODES.some(m => m.ok)) {
        // Nothing to draw at all. A pre-v4 summary still gets the one offer
        // that changes the answer; anything else gets no panel and the tab
        // carries on to the tiles.
        if (!stale || !o.onReparse) return null;
      }

      const wrap = node('section', 'cp');

      const head = node('div', 'cp-head');
      const seg = node('div', 'seg cp-seg');
      head.appendChild(seg);
      wrap.appendChild(head);

      const body = node('div', 'cp-body');
      wrap.appendChild(body);

      // A game where the remembered mode has nothing falls to the first mode
      // that does, rather than opening on an explanation.
      let active = MODES.some(m => m.key === mode && m.ok)
        ? mode
        : (MODES.find(m => m.ok) || MODES[0]).key;

      // Only the modes that would draw something get a chip.
      //
      // `DominanceSeries` splits 100 points across everyone in the game, so it
      // refuses team games outright — and the panel was still offering a greyed
      // Dominance chip on every 2v2 and 3v3, which is a control whose only
      // outcome is a sentence explaining that there is no chart. A tab that
      // cannot answer is worse than no tab: it reads as the default and as
      // broken.
      //
      // The exception is a game where NOTHING can be drawn. There the chips are
      // the only place the explanation (and the re-read offer on a pre-v4
      // summary) can live, so they all stay.
      const anyOk = MODES.some(m => m.ok);
      const chips = anyOk ? MODES.filter(m => m.ok) : MODES;

      const built = new Map();   // key → { el, handle }

      // The one thing worth re-reading a replay for, offered once per panel and
      // not once per mode. A summary stored under v4 whose dominance gate
      // refused it will refuse it again, so that case gets a statement instead.
      const staleRow = (text) => {
        const row = node('div', 'st-upgrade');
        row.appendChild(node('p', 'hint', text));
        if (o.onReparse) row.appendChild(o.onReparse('Re-read this game'));
        return row;
      };

      const contentFor = (key) => {
        if (key === 'dominance') {
          if (!domReason) {
            const handle = window.DominancePanel.build(summary, seat, { onWatch: o.onWatch });
            if (handle) return { el: handle.chart, handle };
          }
          if (domReason === 'stale') return { el: staleRow('Parsed before dominance was recorded.') };
          return { el: node('p', 'hint', domReason || 'No dominance read for this game.') };
        }

        if (key === 'resources') {
          if (hasResources) {
            const rc = window.EconomyPanel.build(summary, seat, { onWatch: o.onWatch });
            if (rc) return { el: rc };
          }
          if (stale) return { el: staleRow('Parsed before resources were recorded.') };
          return { el: node('p', 'hint', 'No resource samples in this game.') };
        }

        const army = armyChart(summary, seat);
        return { el: army || node('p', 'hint', 'No production track in this game.') };
      };

      // `remember` is false for the automatic fallback. A game with no
      // dominance must not silently rewrite the preference for every game
      // opened after it.
      const show = (key, remember) => {
        active = key;
        if (remember) mode = key;
        if (!built.has(key)) {
          const made = contentFor(key);
          made.el.dataset.mode = key;
          body.appendChild(made.el);
          built.set(key, made);
        }
        for (const [k, made] of built) made.el.hidden = k !== key;
        for (const btn of seg.children) {
          const on = btn.dataset.mode === key;
          btn.classList.toggle('is-on', on);
          btn.setAttribute('aria-pressed', String(on));
        }
      };

      for (const m of chips) {
        const btn = node('button', 'seg-btn', m.label);
        btn.type = 'button';
        btn.dataset.mode = m.key;
        if (!m.ok) btn.classList.add('is-empty');
        btn.addEventListener('click', () => show(m.key, true));
        seg.appendChild(btn);
      }

      // One chip is a label, not a choice. The head goes with it: every mode
      // names itself inside its own chart, so a segmented control around a
      // single button is 38px spent on saying nothing.
      if (chips.length < 2) head.hidden = true;

      show(active, false);

      return {
        el: wrap,
        destroy () {
          for (const made of built.values()) {
            if (made.handle && made.handle.destroy) {
              try { made.handle.destroy(); } catch (e) { /* already gone */ }
            }
          }
          built.clear();
        }
      };
    }
  };
})();
