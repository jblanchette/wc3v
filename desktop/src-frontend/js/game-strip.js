// The game strip: one band that draws the shape of a game.
//
// It replaces a 157px panel that listed six timings as label-and-number pairs.
// Everything that panel said is here, positioned in time instead of tabulated,
// which is the difference between reading a game and looking at one.
//
// Four rows. Your lane, the fight axis, their lane, a time ruler. Each lane
// carries a workers area behind it and a tick for tier 2, tier 3, the
// expansion and the first tower. The axis carries one mark per fight, sized by
// the gold that changed hands and coloured by who came out ahead.
//
// Every mark opens the viewer at that second. That is the point: the app has
// had a moment-accurate handoff to the 3D viewer for a while, buried behind
// per-row Watch buttons inside a scroller you could see one row of.
//
// Positioning is percentage-based, so there is no viewBox arithmetic and no
// distortion at any column width. The only SVG is the workers area, one path
// with preserveAspectRatio="none", the same technique profile-view.js uses for
// its sparklines.

(function () {
  'use strict';

  // Marks sit on a track inset by half a hit box, so a mark at 0:00 or at the
  // final second still has its full 36px target inside the strip. Without the
  // inset the strip overflows and the fold audit fails on scrollWidth.
  const HIT = 36;
  const INSET = HIT / 2;

  // Fights worth a mark on the axis. Everything else belongs to a lane.
  const FIGHT_TYPES = new Set([
    'fight', 'wipe', 'heroKill', 'heroTrade', 'baseRaid',
    'towerDive', 'expansionFight', 'harass'
  ]);

  const node = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  };

  const fmt = (ms) => {
    const total = Math.round((ms || 0) / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  };

  // Workers over time as a filled area. economyTrack is 30s samples and stops
  // at ECONOMY_MAX_DURATION_MS, so draw only across its own extent and leave
  // the tail bare rather than stretching the last sample across it.
  const workersArea = (track, durationMs) => {
    const pts = (track || []).filter(s => s && typeof s.gameTimeMs === 'number');
    if (pts.length < 2 || !durationMs) return null;

    const peak = Math.max(...pts.map(s => s.totalWorkers || 0), 1);
    const W = 1000;
    const H = 100;
    const x = (t) => (t / durationMs) * W;
    const y = (v) => H - (v / peak) * H;

    let d = `M${x(pts[0].gameTimeMs).toFixed(1)} ${H}`;
    for (const s of pts) {
      d += ` L${x(s.gameTimeMs).toFixed(1)} ${y(s.totalWorkers || 0).toFixed(1)}`;
    }
    d += ` L${x(pts[pts.length - 1].gameTimeMs).toFixed(1)} ${H} Z`;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'gs-area');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    return { svg, peak };
  };

  window.GameStrip = {
    // summary, seat ('0'|'1'|null), opts: { onWatch(summary, moment), viewSlot }
    build (summary, seat, opts) {
      const o = opts || {};
      const duration = summary.durationMs || 0;
      const wrap = node('section', 'gs');
      wrap.setAttribute('role', 'group');
      wrap.setAttribute('aria-label', 'Game timeline');

      if (!duration) {
        wrap.appendChild(node('p', 'gs-empty', 'No timeline for this game.'));
        return wrap;
      }

      const pct = (t) => `${Math.max(0, Math.min(1, t / duration)) * 100}%`;

      // A positioned button with a 36px target and a small visible mark. The
      // 10px mark is a chart mark under the same exemption .spark-dot already
      // has; the TARGET is what has to clear the 36px floor, and it does.
      const mark = (cls, t, label, moment) => {
        const b = node('button', `gs-mark ${cls}`);
        b.type = 'button';
        b.style.left = pct(t);
        b.title = label;
        b.setAttribute('aria-label', `${fmt(t)} ${label}. Open the viewer here.`);
        b.appendChild(node('i', 'gs-dot'));
        if (o.onWatch) {
          b.addEventListener('click', () => o.onWatch(summary, { t, tf: fmt(t) }));
        }
        return b;
      };

      const slots = Object.keys(summary.players || {});
      const mine = seat !== null && summary.players[seat] ? seat : (o.viewSlot || slots[0]);
      const theirs = slots.find(s => s !== mine);

      const lane = (slot, isMine) => {
        const p = summary.players[slot];
        const row = node('div', 'gs-lane');
        if (!p) return row;

        const head = node('div', 'gs-lane-head');
        if (window.RaceIcons) head.appendChild(window.RaceIcons.mark(p.race));
        head.appendChild(node('b', null, isMine && seat !== null ? 'You' : (p.name || 'Player')));
        row.appendChild(head);

        const track = node('div', 'gs-track');
        track.dataset.side = isMine ? 'me' : 'them';

        const area = workersArea(p.economyTrack, duration);
        if (area) {
          track.appendChild(area.svg);
          track.title = `Workers, peak ${area.peak}`;
        }

        const tick = (t, cls, label) => {
          if (t === null || t === undefined) return;
          // Past 70% the label would run off the end of the track, so it flips
          // to the left of its own tick.
          const late = t / duration > 0.7;
          track.appendChild(mark(`gs-tick ${cls}`, t, `${label} ${fmt(t)}`, null));
          // The label is a sibling of the mark rather than a child of it. A
          // 36px button cannot contain a 40px word without reporting overflow,
          // and the fold audit counts that.
          const lab = node('span', `gs-tick-label${late ? ' is-late' : ''}`, label);
          lab.style.left = pct(t);
          track.appendChild(lab);
        };
        tick(p.tier2Time, 'is-t2', 'T2');
        tick(p.tier3Time, 'is-t3', 'T3');
        tick(p.expansionTime, 'is-exp', 'Expo');
        tick(p.firstTowerTime, 'is-tower', 'Tower');

        row.appendChild(track);
        return row;
      };

      wrap.appendChild(lane(mine, true));

      // ── The fight axis ────────────────────────────────────────────────────
      const axis = node('div', 'gs-axis');
      const axisTrack = node('div', 'gs-track gs-axis-track');
      axisTrack.appendChild(node('i', 'gs-rule'));

      const fights = (summary.moments || []).filter(m => FIGHT_TYPES.has(m.type));
      const swings = fights.map(m => m.swing || 0);
      const maxSwing = Math.max(...swings, 1);

      for (const m of fights) {
        // Who came out ahead, from the user's seat. An unowned trade and a
        // fight nobody won read the same, which is honest: both are even.
        let side = 'even';
        if (seat !== null && Array.isArray(m.winnerSlots) && m.winnerSlots.length) {
          side = m.winnerSlots.indexOf(seat) !== -1 ? 'win' : 'loss';
        }
        const swing = m.swing || 0;
        const scale = 0.6 + 0.4 * Math.min(1, swing / maxSwing);
        const label = m.label + (swing ? `, ${swing}g swing` : '');
        const b = mark('gs-fight', m.t, label, m);
        b.dataset.side = side;
        b.dataset.kind = m.type;
        b.firstChild.style.transform = `scale(${scale.toFixed(2)})`;
        axisTrack.appendChild(b);
      }
      axis.appendChild(axisTrack);
      wrap.appendChild(axis);

      if (theirs) wrap.appendChild(lane(theirs, false));

      // ── Time ruler ────────────────────────────────────────────────────────
      const ruler = node('div', 'gs-ruler');
      const rulerTrack = node('div', 'gs-track');
      // Every 2 minutes up to 20, every 4 after, so a 45-minute game does not
      // print 22 labels into a 16px band.
      const stepMs = duration > 20 * 60000 ? 4 * 60000 : 2 * 60000;
      for (let t = 0; t <= duration; t += stepMs) {
        // Past 92% the final tick already covers this ground, and a centred
        // label that close to the end hangs off the track. An 18:01 game was
        // drawing "18:00" fifteen pixels past its own right edge.
        if (t > 0 && t / duration > 0.92) continue;
        // The first label anchors by its own left edge for the same reason.
        const edge = t === 0 ? ' is-first' : '';
        const tk = node('span', `gs-rule-tick${edge}`, fmt(t));
        tk.style.left = pct(t);
        rulerTrack.appendChild(tk);
      }
      const end = node('span', 'gs-rule-tick is-last', fmt(duration));
      end.style.left = '100%';
      rulerTrack.appendChild(end);
      ruler.appendChild(rulerTrack);
      wrap.appendChild(ruler);

      return wrap;
    },

    INSET
  };
})();
