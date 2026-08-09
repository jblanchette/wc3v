// The dominance panel: the viewer's own dominance chart, driven by a summary.
//
// This module owns NO chart code. `DominanceChart` is the class
// client/viewer.html mounts, shipped into js/vendor by
// tools/build-desktop-client.js, drawn by the stylesheet viewer.html loads. If
// this file ever starts drawing a line, the mount seam has leaked and the
// desktop has begun telling a different story about the same game — which is
// the whole failure the shared-module rule exists to prevent.
//
// **The tug-of-war gauge (`DominanceBar`) is deliberately not here.** It was,
// in the report frame, and it went: 58px of chrome with its own chassis, its
// own identity caps and its own impact-FX engine, all of it designed for a game
// being watched live under a match header. In a finished-game report the one
// thing it added over the chart was the pair of numbers, and those are a
// readout, not a fixture. `DominanceBar.js` is no longer shipped to the desktop
// at all.
//
// What is different from the viewer, and why:
//
//   • The viewer drives the chart off playback. There is no playback in a
//     post-game report, so this is SCRUBBABLE instead: dragging replays the
//     game's momentum through the cursor and the readout. Double-clicking
//     opens the real viewer there, the same handoff every other mark on this
//     screen uses.
//   • It opens at the END of the game, with the whole plot drawn. Progressive
//     draw is a no-spoilers rule for a game being watched; a finished game has
//     nothing left to spoil.
//   • Player colours are the warm race ramp rather than the in-game player
//     colours. the token layer forbids saturated colour on warm surfaces and the
//     desktop has no player-colour field in a summary anyway.

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

  window.DominancePanel = {
    // Why this game has no dominance, in the caller's words. Kept apart from
    // build() so the Story tab can decide between a re-read prompt and silence
    // without building anything first.
    //
    // Returns null when it IS available.
    unavailable (summary) {
      if (!window.SeriesExtract || !window.DominanceChart) {
        return 'Dominance is unavailable in this build.';
      }
      if (!summary.dominance) {
        // Two very different reasons, and they need different words. A summary
        // stored before v4 never had the block; one stored under v4 with a
        // null block is a replay the dominance gate refused, and re-reading it
        // a second time will refuse it again.
        return (summary.schemaVersion || 1) < 4
          ? 'stale'
          : 'No dominance read for this game.';
      }
      const tracked = Object.keys(summary.dominance.players || {}).length;
      if (tracked < 2) {
        return 'Dominance needs two players.';
      }
      // Dominance is a 1v1 instrument and refuses to pretend otherwise.
      //
      // DominanceSeries splits 100 points across everyone in the game, so in a
      // 3v3 the six shares sit around 16 and nobody can ever reach the "50 =
      // even" line the chart is built around. Picking two of the six to plot
      // then draws two near-flat lines crushed against the bottom of the axis
      // under a reference line neither can touch, which reads as a broken chart
      // rather than as the meaningless question it actually is.
      //
      // A team version would have to score TEAMS, not seats, which is a change
      // to lib/DominanceSeries.js and the stored series, not to this panel.
      if (summary.gameMode && summary.gameMode !== '1v1') {
        return 'Dominance is a 1v1 read. Team games are not scored.';
      }
      if (tracked > 2) {
        return 'Dominance is a 1v1 read. This game had more players.';
      }
      return null;
    },

    // summary, seat ('0'|'1'|null), opts: { onWatch(summary, moment) }
    //
    // Returns a handle carrying one detached element (`chart`), or null when
    // `unavailable()` would have returned a reason. Whoever mounts it owns
    // calling `destroy()`, because DominanceChart registers a ResizeObserver.
    build (summary, seat, opts) {
      if (this.unavailable(summary)) return null;
      const o = opts || {};

      const packed = summary.dominance;
      // Own seat FIRST, always, so the readout reads "me against them" and the
      // pair of numbers does not swap sides from one game to the next.
      const slots = Object.keys(packed.players);
      slots.sort((a, b) => (a === seat ? -1 : b === seat ? 1 : a.localeCompare(b)));

      const infos = [];
      for (const slot of slots.slice(0, 2)) {
        const series = window.SeriesExtract.rehydrateDominance(packed, slot);
        if (!series || !series.samples.length) return null;
        const p = summary.players[slot] || {};
        infos.push({
          id: slot,
          color: colorFor(p.race),
          // Battle-tag suffixes are noise in a readout beside a chart.
          name: String(p.name || `Player ${slot}`).replace(/#.*$/, ''),
          race: p.race || '',
          samples: series.samples,
          events: series.events
        });
      }
      if (infos.length < 2) return null;

      const endT = Math.max(
        infos[0].samples[infos[0].samples.length - 1].t,
        infos[1].samples[infos[1].samples.length - 1].t
      );
      if (endT <= 0) return null;

      const chartWrap = node('section', 'dom-panel');
      const chartHost = node('div', 'dom-panel-chart');
      chartWrap.appendChild(chartHost);

      const chart = new window.DominanceChart(null);
      chart.setContainer(chartHost);
      chart.setPlayers(infos);
      // Trim the flat opening. The score eases out from an even 50/50 over the
      // engine's early ramp (150s), which is real but is a fixed slice of every
      // plot spent drawing a straight line — about 15% of the width on a
      // 17-minute game. The axis labels its own start, so a plot beginning at
      // 2:30 never reads as a game that began late.
      const startT = chart.firstMoveT(1);
      chart.setStart(startT);
      chart.build();

      // ── The readout ──────────────────────────────────────────────────────
      //
      // The two numbers, and the only thing the deleted gauge carried that the
      // plot does not. It rides the chart's own title row, which already exists
      // and already says "Dominance · 50 = even", so it costs no height at all.
      //
      // Each number takes its player's line colour, which is what makes the
      // plot and the readout one instrument rather than two things about the
      // same game.
      const title = chartHost.querySelector('.dmc-title');
      const readout = node('span', 'dom-readout');
      const scoreEls = infos.map((p, i) => {
        if (i) readout.appendChild(node('i', 'dom-readout-sep', '–'));
        const el = node('b', 'dom-readout-v');
        el.style.color = p.color;
        el.title = p.name;
        readout.appendChild(el);
        return el;
      });
      const clock = node('span', 'dom-readout-t');
      readout.appendChild(clock);
      if (title) title.appendChild(readout);

      const settle = (t) => {
        chart.setCursor(t);
        const scores = chart.scoresAt(t);
        infos.forEach((p, i) => {
          scoreEls[i].textContent = scores[i] === null ? '—' : String(Math.round(scores[i]));
        });
        clock.textContent = t >= endT ? 'final' : window.CompareCharts.fmtMs(t);
      };
      settle(endT);

      // ── Scrubbing ───────────────────────────────────────────────────────
      //
      // A pointer across the chart replays the game's momentum. It is a
      // pointer capture rather than mouse listeners on the document, so a drag
      // that leaves the window still ends cleanly.
      let scrubbing = false;
      let lastT = endT;

      // Screen X back to game time. The plot does not start at the element's
      // left edge — there is a y-axis gutter — so the mapping goes through the
      // chart's own published geometry rather than assuming the full width.
      // Getting this wrong puts the cursor a minute or two off, which reads as
      // the data being wrong rather than the arithmetic.
      const G = window.DominanceChart.GEOMETRY;
      const leftF = G.marginLeft / G.width;
      const innerF = (G.width - G.marginLeft - G.marginRight) / G.width;

      const timeAt = (e) => {
        const r = chartHost.getBoundingClientRect();
        if (r.width <= 0) return lastT;
        const f = (e.clientX - r.left) / r.width;
        const inner = Math.max(0, Math.min(1, (f - leftF) / innerF));
        // Across the DRAWN span. The plot no longer starts at 0:00, and
        // treating the left edge as zero would put every scrub and every seek
        // early by however much was trimmed.
        return Math.round(startT + inner * (endT - startT));
      };

      chartHost.classList.add('is-scrubbable');
      chartHost.tabIndex = 0;
      chartHost.setAttribute('role', 'slider');
      chartHost.setAttribute('aria-label',
        'Dominance over time. Drag to scrub, press Enter to open the viewer here.');
      chartHost.setAttribute('aria-valuetext', 'end of game');
      chartHost.setAttribute('aria-valuemin', String(Math.round(startT / 1000)));
      chartHost.setAttribute('aria-valuemax', String(Math.round(endT / 1000)));

      const seekTo = (t) => {
        lastT = t;
        settle(t);
        chartHost.setAttribute('aria-valuenow', String(Math.round(t / 1000)));
        // Built from the score elements, not from `readout.textContent`, which
        // already ends in the clock and would announce the time twice.
        const pair = scoreEls.map((el, i) => `${infos[i].name} ${el.textContent}`).join(', ');
        chartHost.setAttribute('aria-valuetext', t >= endT
          ? `end of game, ${pair}`
          : `${window.CompareCharts.fmtMs(t)}, ${pair}`);
      };

      chartHost.addEventListener('pointerdown', (e) => {
        scrubbing = true;
        // Seek FIRST. setPointerCapture throws NotFoundError for a pointer id
        // the browser is not tracking, and with the capture call ahead of the
        // seek that throw took the whole click with it — the cursor simply did
        // not move. Capture is a nicety that keeps a drag alive past the
        // element's edge; the seek is the feature.
        seekTo(timeAt(e));
        try { chartHost.setPointerCapture(e.pointerId); } catch (err) { /* not tracked */ }
      });
      chartHost.addEventListener('pointermove', (e) => {
        if (scrubbing) seekTo(timeAt(e));
      });
      const endScrub = (e) => {
        if (!scrubbing) return;
        scrubbing = false;
        try { chartHost.releasePointerCapture(e.pointerId); } catch (err) { /* already gone */ }
      };
      chartHost.addEventListener('pointerup', endScrub);
      chartHost.addEventListener('pointercancel', endScrub);

      // Leaving the chart puts the game back where it ended. A readout left at
      // 14:20 because that is where the pointer happened to exit is a readout
      // reporting the wrong result for the game.
      chartHost.addEventListener('pointerleave', () => {
        if (!scrubbing) seekTo(endT);
      });

      chartHost.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 60000 : 10000;
        if (e.key === 'ArrowRight') { seekTo(Math.min(endT, lastT + step)); e.preventDefault(); }
        else if (e.key === 'ArrowLeft') { seekTo(Math.max(startT, lastT - step)); e.preventDefault(); }
        else if (e.key === 'Home') { seekTo(startT); e.preventDefault(); }
        else if (e.key === 'End') { seekTo(endT); e.preventDefault(); }
        else if ((e.key === 'Enter' || e.key === ' ') && o.onWatch) {
          o.onWatch(summary, { t: lastT, tf: window.CompareCharts.fmtMs(lastT) });
          e.preventDefault();
        }
      });

      // A double click is the "take me there" gesture. A single click is a
      // scrub, and making it navigate would make the chart impossible to read
      // without leaving the screen.
      if (o.onWatch) {
        chartHost.addEventListener('dblclick', (e) => {
          o.onWatch(summary, { t: timeAt(e), tf: window.CompareCharts.fmtMs(timeAt(e)) });
        });
        chartHost.title = 'Drag to scrub. Double-click to open the viewer here.';
      } else {
        chartHost.title = 'Drag to scrub.';
      }

      return {
        chart: chartWrap,
        seekTo,
        endT,
        destroy () { chart.destroy(); }
      };
    }
  };
})();
