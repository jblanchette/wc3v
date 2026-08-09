// The casting overlay's renderer. ES5 on purpose, same as overlay-render.js:
// this file is inlined into a page served to an OBS Browser Source, which is a
// Chromium nobody controls the version of.
//
// Reads two things off the published state:
//
//   state.cast   what the caster typed into the Stream panel: the event line,
//                the two players, the running score and a format badge. Live
//                control, not stored metadata, because a series score needs
//                ordered games and a tracked total and tags are free text.
//
//   state.game   the last finished game, for the stat bar. Symmetric: two
//                columns of the same measurements, framed as neither player.
//
// Nothing here is ever about the person running the app. That is the whole
// difference between this file and overlay-render.js.

(function () {
  'use strict';

  var ALL_MODULES = ['series', 'stats', 'badge'];

  var RACE = { O: 'Orc', H: 'Human', U: 'Undead', E: 'Night Elf', R: 'Random', N: '' };

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== null && text !== undefined) n.textContent = text;
    return n;
  }

  function fmtDur(ms) {
    var total = Math.round((ms || 0) / 1000);
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  }

  // ── The scoreboard ────────────────────────────────────────────────────────
  //
  // Event line, both players with their race, and the running score. The thing
  // a caster puts at the top of the screen and leaves there.
  function seriesModule(c) {
    if (!c || (!c.a && !c.b && !c.event)) return null;
    var box = el('div', 'mod series');

    if (c.event || c.round) {
      var head = el('div', 'ev');
      if (c.event) head.appendChild(el('span', 'ev-name', c.event));
      if (c.round) head.appendChild(el('span', 'ev-round', c.round));
      box.appendChild(head);
    }

    var row = el('div', 'score');
    var side = function (who, score, right) {
      var s = el('div', 'side' + (right ? ' right' : ''));
      var name = el('div', 'nm', (who && who.name) || '?');
      if (who && who.race) name.dataset.race = who.race;
      var race = el('div', 'rc', (who && RACE[who.race]) || '');
      s.appendChild(name);
      s.appendChild(race);
      // A leading side is stated once, on the name, rather than by colouring
      // the number: the score is the number, and two coloured things competing
      // to be the score is how a scoreboard stops being readable.
      return s;
    };
    row.appendChild(side(c.a, c.scoreA, false));

    var mid = el('div', 'tally');
    mid.appendChild(el('span', 'n', String(c.scoreA || 0)));
    mid.appendChild(el('span', 'dash', '–'));
    mid.appendChild(el('span', 'n', String(c.scoreB || 0)));
    row.appendChild(mid);

    row.appendChild(side(c.b, c.scoreB, true));
    box.appendChild(row);
    return box;
  }

  // ── The format badge ──────────────────────────────────────────────────────
  //
  // "Random hero", "Showmatch", "Grand final". Free text the caster set, held
  // until they change it. It has no meaning to the app and is not supposed to.
  function badgeModule(c) {
    if (!c || !c.badge) return null;
    var box = el('div', 'mod badge');
    box.appendChild(el('span', 'bdg', c.badge));
    return box;
  }

  // ── The stat bar ──────────────────────────────────────────────────────────
  //
  // The last finished game as two columns of the same measurements. No deltas
  // and no baselines: those are built out of one person's history, and on a
  // broadcast neither player is that person.
  function statsModule(g) {
    if (!g || !g.seats || g.seats.length < 2) return null;
    var box = el('div', 'mod stats');

    var head = el('div', 'ghead');
    head.appendChild(el('span', 'map', g.map || ''));
    head.appendChild(el('span', 'dur', fmtDur(g.durationMs)));
    box.appendChild(head);

    var grid = el('div', 'sgrid');
    var a = g.seats[0];
    var b = g.seats[1];

    var namerow = el('div', 'srow names');
    var an = el('span', 'nm', a.name || '?');
    if (a.race) an.dataset.race = a.race;
    var bn = el('span', 'nm', b.name || '?');
    if (b.race) bn.dataset.race = b.race;
    namerow.appendChild(an);
    namerow.appendChild(el('span', 'k', ''));
    namerow.appendChild(bn);
    grid.appendChild(namerow);

    // Rows are built from whatever the publisher sent, in its order, so adding
    // a measurement upstream does not need a change here.
    (g.rows || []).forEach(function (r) {
      var row = el('div', 'srow');
      var va = el('span', 'v', r.a === null || r.a === undefined ? '—' : String(r.a));
      var vb = el('span', 'v', r.b === null || r.b === undefined ? '—' : String(r.b));
      // The better of the two, where "better" is a fact about the metric rather
      // than an opinion. The publisher decides; this only paints it.
      if (r.lead === 'a') va.classList.add('lead');
      if (r.lead === 'b') vb.classList.add('lead');
      row.appendChild(va);
      row.appendChild(el('span', 'k', r.label || ''));
      row.appendChild(vb);
      grid.appendChild(row);
    });

    box.appendChild(grid);
    return box;
  }

  window.CastRender = {
    ALL_MODULES: ALL_MODULES,

    render: function (root, state, want) {
      root.innerHTML = '';
      root.className = 'wc3v-cast';

      var on = {};
      (want || ALL_MODULES).forEach(function (m) { on[m] = true; });

      var c = state.cast || null;
      var g = state.cast && state.cast.game ? state.cast.game : (state.castGame || null);

      var parts = [
        on.series && seriesModule(c),
        on.badge && badgeModule(c),
        on.stats && statsModule(g)
      ].filter(Boolean);

      // Nothing set yet. Say so on the panel view, where somebody is looking at
      // it to configure; stay invisible on the OBS view, where an instruction
      // would go to air.
      if (!parts.length) {
        if (document.body.dataset.view === 'panel') {
          root.appendChild(el('div', 'mod waiting', 'Set up a match in WC3V → Stream → Casting.'));
        }
        return;
      }
      parts.forEach(function (p) { root.appendChild(p); });
    }
  };
})();
