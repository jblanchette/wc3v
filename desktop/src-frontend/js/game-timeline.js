// The game timeline: the match's moments on one time axis.
//
// A summary carries up to 24 typed, importance-ranked moments — hero kills,
// wipes, base raids, tier-ups, expansions, scouts — and until now the report
// showed three of those types as unlabelled dots on two charts while the
// stream overlay got the full list. This strip is the report's own reading:
// every mark is a moment, positioned in time, and every mark opens the viewer
// at that second — the same handoff every chart on this screen already has.
//
// The idiom is the deleted game-strip.js (recoverable at 57e1b92): percentage
// positioning so there is no viewBox arithmetic at any width, marks on a
// track inset by half a hit box so a moment at 0:00 keeps its full 36px
// target inside the strip, and a ruler that stops printing labels where they
// would hang off the end.
//
// This is a desktop adapter, deliberately NOT part of the shared
// MatchSummaryView: moments are a desktop-summary block the viewer derives
// differently, and the mount-seam rule keeps app-specific claims out of the
// shared renderer.
//
// `lanes: 2` splits the marks into yours / theirs — by seat in a duel, by
// TEAM in a team game, because six lanes is a document. `lanes: 1` is one
// shared axis.

(function () {
  'use strict';

  const HIT = 36;

  // The visible dot budget: one mark per this many pixels of track before the
  // strip starts hiding the least important. 14px keeps neighbours legible
  // without the strip ever refusing a mark on a wide window.
  const PX_PER_MARK = 14;

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

  window.GameTimeline = {
    HIT,

    // summary, seat ('0'|'1'|null), opts: { onWatch(summary, moment), lanes }
    // Returns { el, destroy } or null when there is nothing to draw.
    build (summary, seat, opts) {
      const o = opts || {};
      const duration = summary.durationMs || 0;
      const moments = summary.moments || [];
      // No moments is a real answer (a 40-second fixture), not an error, and
      // an empty ruler explains nothing. The strip is simply absent.
      if (!duration || !moments.length) return null;

      const lanes = o.lanes === 2 ? 2 : 1;
      const ME = window.MomentsExtract;
      const G = window.Glyphs;

      const pct = (t) => `${Math.max(0, Math.min(1, t / duration)) * 100}%`;
      const nameFor = (slot) => {
        const p = summary.players[slot];
        return p ? String(p.name || 'Player').replace(/#.*$/, '') : 'Player';
      };

      // Which lane a moment belongs to, when there are two. Team, not seat:
      // in a 3v3 "yours" is your half of the map. A moment with no slot (a
      // neutral fight) rides lane 0 — the top lane is the shared one.
      const myTeam = seat !== null && summary.players[seat]
        ? summary.players[seat].teamId : null;
      const laneOf = (m) => {
        if (lanes === 1) return 0;
        const p = m.slot !== undefined && m.slot !== null ? summary.players[m.slot] : null;
        if (!p || myTeam === null || p.teamId === undefined || p.teamId === null) return 0;
        return p.teamId === myTeam ? 0 : 1;
      };

      const wrap = node('section', 'gt' + (lanes === 2 ? ' gt-2' : ''));
      wrap.setAttribute('role', 'group');
      wrap.setAttribute('aria-label', 'Game timeline');

      const tracks = [];
      for (let i = 0; i < lanes; i++) {
        const row = node('div', 'gt-lane');
        if (lanes === 2) {
          row.appendChild(node('span', 'gt-lane-k', i === 0
            ? (seat !== null ? 'You' : 'Team 1') : 'Them'));
        }
        const track = node('div', 'gt-track');
        track.appendChild(node('i', 'gt-rule'));
        row.appendChild(track);
        wrap.appendChild(row);
        tracks.push(track);
      }

      // Marks, in time order. Importance decides who survives crowding, and
      // that is settled by the observer below, not at build time — the strip
      // does not know its width yet.
      const marks = [];
      const sorted = moments.slice().sort((a, b) => (a.t || 0) - (b.t || 0));
      for (const m of sorted) {
        const b = node('button', 'gt-mark');
        b.type = 'button';
        b.style.left = pct(m.t || 0);
        b.dataset.kind = m.type || '';
        // Yours / theirs / nobody's, for the ink. In one lane this is the
        // only thing separating your tier-up from theirs.
        const lane = laneOf(m);
        if (m.slot !== undefined && m.slot !== null && myTeam !== null) {
          const p = summary.players[m.slot];
          b.dataset.side = p && p.teamId === myTeam ? 'me' : 'them';
        }
        const phrase = ME && ME.phrase
          ? ME.phrase(m, seat, nameFor)
          : (m.label || m.type || '');
        b.title = `${m.tf || fmt(m.t)} · ${phrase}`;
        b.setAttribute('aria-label',
          `${m.tf || fmt(m.t)} ${phrase}. Open the viewer here.`);
        if (G) b.appendChild(G.mark(G.forMoment(m.type), { className: 'gt-glyph' }));
        else b.appendChild(node('i', 'gt-dot'));
        if (o.onWatch) {
          b.addEventListener('click', () =>
            o.onWatch(summary, { t: m.t, tf: m.tf || fmt(m.t) }));
        }
        tracks[lane].appendChild(b);
        marks.push({ el: b, importance: m.importance || 0, lane });
      }

      // ── Time ruler ──────────────────────────────────────────────────────
      const ruler = node('div', 'gt-ruler');
      const rulerTrack = node('div', 'gt-track gt-ruler-track');
      const stepMs = duration > 20 * 60000 ? 4 * 60000 : 2 * 60000;
      for (let t = 0; t <= duration; t += stepMs) {
        if (t > 0 && t / duration > 0.92) continue;
        const tk = node('span', 'gt-tick' + (t === 0 ? ' is-first' : ''), fmt(t));
        tk.style.left = pct(t);
        rulerTrack.appendChild(tk);
      }
      const end = node('span', 'gt-tick is-last', fmt(duration));
      end.style.left = '100%';
      rulerTrack.appendChild(end);
      ruler.appendChild(rulerTrack);
      wrap.appendChild(ruler);

      // ── Crowding ────────────────────────────────────────────────────────
      // The width affords so many marks per lane; beyond that the least
      // important hide rather than overlap into an unreadable smear. Hidden,
      // not removed: a resize brings them back.
      let ro = null;
      const fit = () => {
        const w = tracks[0].getBoundingClientRect().width;
        if (!w) return;
        const budget = Math.max(4, Math.floor(w / PX_PER_MARK));
        for (let lane = 0; lane < lanes; lane++) {
          const inLane = marks.filter(mk => mk.lane === lane);
          const keep = new Set(inLane.slice()
            .sort((a, b) => b.importance - a.importance)
            .slice(0, budget));
          for (const mk of inLane) mk.el.hidden = !keep.has(mk);
        }
      };
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(fit);
        ro.observe(wrap);
      }
      fit();

      return {
        el: wrap,
        destroy () { if (ro) { ro.disconnect(); ro = null; } }
      };
    }
  };
})();
