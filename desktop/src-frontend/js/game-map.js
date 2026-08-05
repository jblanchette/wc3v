// Where the game happened.
//
// A stored summary carries coordinates and nothing has ever drawn them:
// `neutralCamps[].bounds` for every creep camp, `players[].startingPosition`
// for both seats, and x/y on the moments that have a position. Measured over
// the 40-game preview corpus: 16 to 26 camps per game, both start positions
// every time, and 126 of 402 moments carrying a position.
//
// What it deliberately does NOT draw: who cleared which camp. A summary has no
// per-player camp record, so tinting camps by owner would be an invention.
// Camps are terrain here, and the fights are the story.
//
// No tileset art. This process does not have one, and a fake one would be a
// lie about a real map.
//
// Extent comes from the data rather than from map metadata, because
// store.js buildSummary deliberately does not persist mapInfo. Y is flipped:
// WC3 world Y increases upward and screen Y increases downward.

(function () {
  'use strict';

  const SVG = 'http://www.w3.org/2000/svg';
  // Below this many distinct points there is no map worth drawing, and an
  // empty square is worse than no square.
  const MIN_POINTS = 3;
  const PAD = 0.08;

  const FIGHT_TYPES = new Set([
    'fight', 'wipe', 'heroKill', 'heroTrade', 'baseRaid',
    'towerDive', 'expansionFight', 'harass'
  ]);

  const svgEl = (tag, attrs) => {
    const n = document.createElementNS(SVG, tag);
    for (const k of Object.keys(attrs || {})) n.setAttribute(k, attrs[k]);
    return n;
  };

  window.GameMap = {
    // Returns null when the game has too few coordinates to be worth a map.
    build (summary, seat, opts) {
      const o = opts || {};
      const camps = (summary.neutralCamps || []).filter(c => c && c.bounds);
      const players = summary.players || {};
      const starts = Object.keys(players)
        .map(s => ({ slot: s, p: players[s].startingPosition, race: players[s].race }))
        .filter(x => x.p && typeof x.p.x === 'number');
      const fights = (summary.moments || [])
        .filter(m => FIGHT_TYPES.has(m.type) && typeof m.x === 'number' && typeof m.y === 'number');

      const pts = [];
      for (const c of camps) {
        pts.push({ x: (c.bounds.minX + c.bounds.maxX) / 2, y: (c.bounds.minY + c.bounds.maxY) / 2, camp: c });
      }
      for (const s of starts) pts.push({ x: s.p.x, y: s.p.y });
      for (const f of fights) pts.push({ x: f.x, y: f.y });
      if (pts.length < MIN_POINTS) return null;

      let minX = Math.min(...pts.map(p => p.x));
      let maxX = Math.max(...pts.map(p => p.x));
      let minY = Math.min(...pts.map(p => p.y));
      let maxY = Math.max(...pts.map(p => p.y));

      // Square it by growing the shorter axis, so the map is not stretched.
      const w = maxX - minX;
      const h = maxY - minY;
      const side = Math.max(w, h, 1) * (1 + PAD * 2);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      minX = cx - side / 2;
      minY = cy - side / 2;

      const X = (x) => ((x - minX) / side) * 100;
      // Flipped: world Y up, screen Y down.
      const Y = (y) => 100 - ((y - minY) / side) * 100;

      const svg = svgEl('svg', {
        class: 'gm',
        viewBox: '0 0 100 100',
        role: 'img',
        'aria-label': `Map of ${camps.length} creep camps and ${fights.length} located fights`
      });

      for (let i = 1; i < 4; i++) {
        svg.appendChild(svgEl('line', { class: 'gm-grid', x1: i * 25, y1: 0, x2: i * 25, y2: 100 }));
        svg.appendChild(svgEl('line', { class: 'gm-grid', x1: 0, y1: i * 25, x2: 100, y2: i * 25 }));
      }

      // Camps as hollow rings sized by total level, which is what the viewer's
      // own MapRenderer does for an untouched camp.
      for (const c of camps) {
        const bx = (c.bounds.minX + c.bounds.maxX) / 2;
        const by = (c.bounds.minY + c.bounds.maxY) / 2;
        const r = Math.max(1.4, Math.min(3.4, 1.2 + (c.totalLevel || 0) * 0.14));
        const ring = svgEl('circle', { class: 'gm-camp', cx: X(bx).toFixed(2), cy: Y(by).toFixed(2), r: r.toFixed(2) });
        if (c.hasFountain) ring.setAttribute('class', 'gm-camp is-fountain');
        const t = svgEl('title', {});
        t.textContent = `Creep camp, level ${c.totalLevel || '?'}${c.hasFountain ? ', fountain' : ''}`;
        ring.appendChild(t);
        svg.appendChild(ring);
      }

      for (const s of starts) {
        const g = svgEl('rect', {
          class: 'gm-start',
          x: (X(s.p.x) - 2.6).toFixed(2),
          y: (Y(s.p.y) - 2.6).toFixed(2),
          width: 5.2, height: 5.2, rx: 1
        });
        g.setAttribute('data-side', s.slot === seat ? 'me' : 'them');
        const t = svgEl('title', {});
        t.textContent = `${players[s.slot].name || 'Player'} started here`;
        g.appendChild(t);
        svg.appendChild(g);
      }

      const maxSwing = Math.max(...fights.map(f => f.swing || 0), 1);
      for (const f of fights) {
        const r = 1.8 + 2.2 * Math.min(1, (f.swing || 0) / maxSwing);
        let side = 'even';
        if (seat !== null && Array.isArray(f.winnerSlots) && f.winnerSlots.length) {
          side = f.winnerSlots.indexOf(seat) !== -1 ? 'win' : 'loss';
        }
        const dot = svgEl('circle', {
          class: 'gm-fight', cx: X(f.x).toFixed(2), cy: Y(f.y).toFixed(2), r: r.toFixed(2)
        });
        dot.setAttribute('data-side', side);
        const t = svgEl('title', {});
        t.textContent = `${f.tf} ${f.label}${f.swing ? `, ${f.swing}g swing` : ''}`;
        dot.appendChild(t);
        svg.appendChild(dot);
      }

      const wrap = document.createElement('div');
      wrap.className = 'gm-wrap';
      wrap.appendChild(svg);
      if (o.caption) {
        const cap = document.createElement('p');
        cap.className = 'hint gm-cap';
        cap.textContent = fights.length
          ? `${fights.length} located fight${fights.length === 1 ? '' : 's'}`
          : `${camps.length} creep camps`;
        wrap.appendChild(cap);
      }
      return wrap;
    }
  };
})();
