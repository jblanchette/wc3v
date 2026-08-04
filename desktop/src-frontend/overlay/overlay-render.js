// Overlay rendering — one implementation, two consumers.
//
//   • the OBS Browser Source / player view (overlay.html, assembled by
//     overlay.rs from this file + overlay.css + shell.html)
//   • the live preview inside the WC3V window
//
// Sharing the renderer is the point: the preview exists so a streamer can see
// what viewers will see BEFORE putting the URL into OBS, and a preview drawn by
// separate code is a preview that can lie.
//
// The overlay is a pure consumer. Every judgement — who won, whose seat, how a
// moment is worded — is made upstream in overlay-state.js and arrives already
// decided. Nothing here interprets a replay.
//
// All replay-derived strings go in via textContent. The only markup this file
// writes is its own.

(function () {
  'use strict';

  var RACE = { O: 'Orc', H: 'Human', U: 'Undead', E: 'Night Elf', R: 'Random', N: 'Neutral' };

  // Order is fixed: it is reading order on a stream, not a preference.
  var ALL_MODULES = ['session', 'verdict', 'h2h', 'moments', 'build'];

  function el (tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== null && text !== undefined) n.textContent = text;
    return n;
  }

  function fmtDur (ms) {
    var m = Math.round((ms || 0) / 60000);
    return m ? '~' + m + ' min' : '';
  }

  function sessionModule (s) {
    var sess = s.session || { wins: 0, losses: 0 };
    var box = el('div', 'mod session');
    box.appendChild(el('span', 'label', 'session'));
    var score = el('span', 'score');
    score.appendChild(el('span', 'w', String(sess.wins || 0)));
    score.appendChild(el('span', null, '–'));
    score.appendChild(el('span', 'l', String(sess.losses || 0)));
    box.appendChild(score);
    var st = sess.streak;
    if (st && st.count >= 2) {
      box.appendChild(el('span', 'streak', (st.kind === 'win' ? 'W' : 'L') + st.count + ' streak'));
    }
    return box;
  }

  function verdictModule (s, g) {
    var box = el('div', 'mod');
    var row = el('div', 'verdict');
    // A verdict cannot be attributed to a seat until the app knows which player
    // is the user. Say that, rather than implying the result was unreadable —
    // the two have completely different fixes.
    var word = el('span', 'word ' + (g.verdict || 'unknown'),
      g.verdict === 'win' ? 'Victory'
        : g.verdict === 'loss' ? 'Defeat'
        : s.needsIdentity ? 'Set your player name in WC3V'
        : 'Result unclear');
    row.appendChild(word);
    if (g.opponent) {
      var vs = el('span', 'vs');
      vs.appendChild(el('span', null, 'vs '));
      vs.appendChild(el('b', null, g.opponent.name || '?'));
      vs.appendChild(el('span', null, ' (' + (RACE[g.opponent.race] || g.opponent.race || '?') + ')'));
      row.appendChild(vs);
    }
    box.appendChild(row);

    var bits = [g.map, g.mode, fmtDur(g.durationMs)].filter(Boolean);
    box.appendChild(el('div', 'meta', bits.join(' · ')));

    var t = g.timings || {};
    var grid = el('div', 'timings');
    [['opener', g.heroOpener], ['tier 2', t.t2], ['expand', t.expansion], ['tower', t.firstTower]]
      .forEach(function (pair) {
        var cell = el('div', 'cell');
        cell.appendChild(el('div', 'k', pair[0]));
        cell.appendChild(el('div', 'v', pair[1] || '—'));
        grid.appendChild(cell);
      });
    box.appendChild(grid);
    return box;
  }

  function h2hModule (g) {
    var h = g.h2h;
    if (!h || !h.games) return null;
    var box = el('div', 'mod h2h');
    box.appendChild(el('span', 'label', 'all time'));
    box.appendChild(el('span', 'who', 'vs ' + h.name));
    var rec = el('span', 'rec');
    rec.appendChild(el('span', 'w', String(h.wins)));
    rec.appendChild(el('span', null, '–'));
    rec.appendChild(el('span', 'l', String(h.losses)));
    box.appendChild(rec);
    return box;
  }

  function momentsModule (g) {
    var list = g.moments || [];
    if (!list.length) return null;
    var box = el('div', 'mod moments');
    box.appendChild(el('h2', null, 'key moments'));
    var ol = el('ol');
    list.forEach(function (m) {
      var li = el('li', m.hero ? 'hero' : null);
      li.appendChild(el('span', 't', m.time || ''));
      li.appendChild(el('span', 'n', m.text || ''));
      ol.appendChild(li);
    });
    box.appendChild(ol);
    return box;
  }

  function buildModule (g) {
    var list = g.build || [];
    if (!list.length) return null;
    var box = el('div', 'mod build');
    box.appendChild(el('h2', null, 'build order'));
    var ol = el('ol');
    list.forEach(function (b) {
      var li = el('li', b.type || null);
      li.appendChild(el('span', 't', b.time || ''));
      li.appendChild(el('span', 'n', b.name || ''));
      ol.appendChild(li);
    });
    box.appendChild(ol);
    return box;
  }

  // root: the element to render into. state: the published payload.
  // modules: array of module names, defaulting to all of them in fixed order.
  function render (root, state, modules) {
    var s = state || {};
    var g = s.game;
    var want = {};
    (modules && modules.length ? modules : ALL_MODULES).forEach(function (m) { want[m] = true; });

    root.className = 'wc3v-ov';
    root.innerHTML = '';
    var card = el('div', 'card');

    if (s.demo) card.appendChild(el('div', 'demo', 'preview — not a real game'));
    if (want.session) card.appendChild(sessionModule(s));

    if (!g) {
      card.appendChild(el('div', 'mod waiting',
        'Waiting for a game — finish one and it appears here.'));
      root.appendChild(card);
      return;
    }

    if (want.verdict) card.appendChild(verdictModule(s, g));
    [want.h2h && h2hModule(g), want.moments && momentsModule(g), want.build && buildModule(g)]
      .forEach(function (mod) { if (mod) card.appendChild(mod); });

    root.appendChild(card);
  }

  window.OverlayRender = { render: render, ALL_MODULES: ALL_MODULES };
})();
