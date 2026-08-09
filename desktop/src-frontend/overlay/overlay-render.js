// Overlay rendering: one implementation, two consumers.
//
//   • the OBS Browser Source / player view (overlay.html, assembled by
//     overlay.rs from this file + overlay.css + shell.html + the two icon
//     modules)
//   • the live preview inside the WC3V window
//
// Sharing the renderer is the point: the preview exists so a streamer can see
// what viewers will see BEFORE putting the URL into OBS, and a preview drawn by
// separate code is a preview that can lie.
//
// The overlay is a pure consumer. Who won, whose seat it was, how a moment is
// worded: all of that gets decided upstream in overlay-state.js and arrives
// decided. Nothing here interprets a replay.
//
// The card is drawn rather than printed. Structure is inline SVG from
// race-icons.js and glyphs.js, stitched into the page so there is one copy of
// every mark in the product. Hero portraits are the one remote asset on the
// whole card: an <img> per portrait against cdn.wc3v.com, id whitelisted, blank
// on error. No scripts, no fonts, no stylesheets, one optional image origin —
// an OBS machine with no internet at all still draws the entire layout.
//
// All replay-derived strings go in via textContent. The only markup this file
// writes is its own.

(function () {
  'use strict';

  var RACE = { O: 'Orc', H: 'Human', U: 'Undead', E: 'Night Elf', R: 'Random', N: 'Neutral' };
  var RACE_SHORT = { O: 'OC', H: 'HU', U: 'UD', E: 'NE', R: 'RD', N: 'NT' };

  // Order is fixed: it is reading order on a stream, not a preference. All
  // eight stay valid forever, because shell.html filters against this list and
  // dropping a name here silently blanks a panel in an OBS scene somebody
  // built months ago.
  var ALL_MODULES = ['scout', 'session', 'verdict', 'report', 'momentum', 'h2h', 'moments', 'build'];

  // What a newly copied URL gets. Key moments and the build list are player
  // detail wearing a viewer-facing card: both stay available, neither is on by
  // default. A URL with no `modules` param still means all eight.
  var DEFAULT_MODULES = ['scout', 'session', 'verdict', 'report', 'momentum', 'h2h'];

  // Which report row gets which mark. GameMetrics owns the keys.
  var METRIC_GLYPH = { dominanceAvg: 'dominance', apmEffective: 'apm', heroKills: 'heroKills' };

  function el (tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== null && text !== undefined) n.textContent = text;
    return n;
  }

  // A race crest. RaceIcons.mark() would build this, but it returns a chip in
  // the app's own classes, which this page has no styles for. The glyph is
  // taken raw and dressed here instead. Every string in that file is our own
  // constant, so this innerHTML never sees replay text.
  function crest (race, className) {
    var n = el('span', 'crest' + (className ? ' ' + className : ''));
    var glyph = window.RaceIcons && window.RaceIcons[race];
    if (glyph) n.innerHTML = glyph;
    else n.textContent = RACE_SHORT[race] || '??';
    if (race) n.dataset.race = race;
    n.setAttribute('aria-label', RACE[race] || 'Unknown race');
    return n;
  }

  // A section mark. Same deal: our own constant, never replay text.
  function glyph (name) {
    var html = name && window.Glyphs && window.Glyphs.markup(name);
    if (!html) return null;
    var n = el('span', 'gly');
    n.innerHTML = html;
    n.setAttribute('aria-hidden', 'true');
    return n;
  }

  // Ported from UIBits.buildIcon, whitelist and blank-on-error intact. This
  // page cannot import ui-bits.js, and a stitch placeholder carrying fifteen
  // lines would be worse than the copy.
  //
  // The id came out of a replay a stranger made and it is going into a URL.
  // Anything outside [A-Za-z0-9_-] draws an empty tile and opens no request.
  var ICON_BASE = 'https://cdn.wc3v.com/assets/wc3icons/';
  var SAFE_ICON_ID = /^[A-Za-z0-9_-]+$/;

  function portrait (itemId) {
    var id = String(itemId || '');
    if (!SAFE_ICON_ID.test(id)) return el('span', 'portrait is-blank');
    var img = document.createElement('img');
    img.className = 'portrait';
    img.alt = '';
    img.src = ICON_BASE + id + '.jpg';
    // Offline, or an id the site has no art for. A blank tile holds the
    // layout; a broken-image glyph on a live broadcast does not.
    img.addEventListener('error', function () {
      img.classList.add('is-blank');
      img.removeAttribute('src');
    });
    return img;
  }

  // The same wordmark the app and the site carry, as a corner badge rather
  // than a footer line — a viewer glancing at the card should see whose
  // numbers these are without hunting for it. First child of every card
  // regardless of which modules are selected, so a solo single-module
  // Browser Source still carries it.
  function markStrip () {
    var strip = el('div', 'mark');
    var w = el('span', 'wordmark');
    w.appendChild(document.createTextNode('WC'));
    w.appendChild(el('span', null, '3'));
    w.appendChild(document.createTextNode('V'));
    strip.appendChild(w);
    return strip;
  }

  function fmtDur (ms) {
    var m = Math.round((ms || 0) / 60000);
    return m ? '~' + m + ' min' : '';
  }

  // The live opponent, before a replay of this game exists at all.
  //
  // This is the one module on the card that is not a game this machine parsed.
  // It is scout.js polling the public W3Champions endpoint for an ongoing
  // ladder match: that a match exists, and who is on the other side. The same
  // thing any viewer could look up on the W3Champions site, and nothing about
  // the game in progress. The heading and the source line say exactly that,
  // permanently, rather than implying the app can see into a live match.
  function scoutModule (scout) {
    if (!scout || !scout.opponent) return null;
    var box = el('div', 'mod scout');
    box.appendChild(el('h2', null, 'scouting'));
    // Unconditional. This used to appear only when a rank came back, which
    // meant the provenance was missing exactly when the panel was thinnest.
    box.appendChild(el('div', 'src', 'public W3Champions ladder data'));

    var head = el('div', 'scout-vs');
    head.appendChild(crest(scout.opponent.race, 'tile'));
    var who = el('div', 'who');
    who.appendChild(el('b', null, scout.opponent.name || '?'));
    var sub = [RACE[scout.opponent.race] || scout.opponent.race || null];
    if (scout.ladder && scout.ladder.rank) {
      sub.push('rank ' + scout.ladder.rank);
      if (scout.ladder.mmr) sub.push(scout.ladder.mmr + ' mmr');
    }
    if (scout.map) sub.push(scout.map);
    who.appendChild(el('div', 'meta', sub.filter(Boolean).join(' · ')));
    head.appendChild(who);
    box.appendChild(head);

    // Everything below this line was learned from replays parsed on this
    // machine, which is a different claim from the ladder lookup above and is
    // labelled as one.
    box.appendChild(el('div', 'bd-label', 'from your replays'));
    if (scout.h2h && scout.h2h.games) {
      var h2h = el('div', 'scout-h2h');
      h2h.appendChild(el('span', null, 'all time'));
      var rec = el('span', 'rec');
      rec.appendChild(el('span', 'w', String(scout.h2h.wins)));
      rec.appendChild(el('span', null, '–'));
      rec.appendChild(el('span', 'l', String(scout.h2h.losses)));
      h2h.appendChild(rec);
      box.appendChild(h2h);
    } else {
      box.appendChild(el('div', 'scout-h2h dim', 'first time against them'));
    }

    if (scout.openers && scout.openers.length) {
      var ops = el('div', 'openers');
      ops.appendChild(el('span', 'lead', 'opens'));
      scout.openers.forEach(function (o) {
        var chip = el('span', 'op');
        if (o.itemId) chip.appendChild(portrait(o.itemId));
        chip.appendChild(el('span', null, o.name || ''));
        ops.appendChild(chip);
      });
      box.appendChild(ops);
    }
    if (scout.t2Them) {
      var t2 = 'their tier 2 ' + scout.t2Them + (scout.t2You ? ' · yours ' + scout.t2You : '');
      box.appendChild(el('div', 'note', t2));
    }
    return box;
  }

  // The footer. Session score plus career context, and the one thing on the
  // card that survives the post-game hold: when the reveal expires the card
  // collapses to this and the scout strip rather than vanishing.
  function sessionModule (s) {
    var sess = s.session || { wins: 0, losses: 0 };
    var box = el('div', 'mod session');
    var top = el('div', 'sess-top');
    top.appendChild(el('span', 'label', 'session'));
    var score = el('span', 'score');
    score.appendChild(el('span', 'w', String(sess.wins || 0)));
    score.appendChild(el('span', null, '–'));
    score.appendChild(el('span', 'l', String(sess.losses || 0)));
    top.appendChild(score);
    var st = sess.streak;
    if (st && st.count >= 2) {
      top.appendChild(el('span', 'streak', (st.kind === 'win' ? 'W' : 'L') + st.count + ' streak'));
    }
    box.appendChild(top);

    // Career context under the session line: recent form is not matchup
    // specific, so both can be true at once and both are worth a viewer's
    // half-second, unlike a pillar score this is narrative, not coaching.
    var tr = s.trend;
    if (tr) {
      var bits = [];
      if (tr.recentForm) {
        bits.push('career ' + tr.recentForm.wins + '–' + tr.recentForm.losses +
          ' last ' + tr.recentForm.n);
      }
      if (tr.matchup) {
        bits.push(tr.matchup.key + ' ' + tr.matchup.winRate + '% (' + tr.matchup.games + 'g)');
      }
      if (bits.length) box.appendChild(el('div', 'sess-trend', bits.join(' · ')));
    }
    return box;
  }

  // The story, first, in one band: who you beat and what it took.
  //
  // The banner wears the OPPONENT's race material, because the thing a viewer
  // has to place in the first half second is who the other person was. The
  // five-cell timings grid that used to sit under this is gone: expand, tower
  // and APM are review detail, and they were the widest, least-read thing on
  // the card. What survives is folded into the meta line.
  function verdictModule (s, g) {
    var box = el('div', 'mod verdict');
    var oppRace = (g.opponent && g.opponent.race) || null;

    var banner = el('div', 'banner');
    if (oppRace) banner.dataset.race = oppRace;
    banner.appendChild(crest(oppRace, 'big'));

    var col = el('div', 'vcol');
    // A verdict cannot be attributed to a seat until the app knows which player
    // is the user. Say that rather than implying the result was unreadable,
    // the two have completely different fixes.
    col.appendChild(el('div', 'word ' + (g.verdict || 'unknown'),
      g.verdict === 'win' ? 'Victory'
        : g.verdict === 'loss' ? 'Defeat'
        : s.needsIdentity ? 'Set your player name in WC3V'
        : 'Result unclear'));
    if (g.opponent) {
      var vs = el('div', 'vs');
      vs.appendChild(el('span', null, 'vs '));
      vs.appendChild(el('b', null, g.opponent.name || '?'));
      col.appendChild(vs);
    }
    banner.appendChild(col);

    // The hero you opened on, as art. One image, the most recognizable thing
    // in the game, at the smallest possible cost.
    if (g.heroOpenerIcon) banner.appendChild(portrait(g.heroOpenerIcon));
    box.appendChild(banner);

    var t = g.timings || {};
    var bits = [g.map, g.mode, fmtDur(g.durationMs), g.heroOpener,
      t.t2 ? 'T2 ' + t.t2 : null].filter(Boolean);
    box.appendChild(el('div', 'meta', bits.join(' · ')));
    return box;
  }

  // What stood out, and nothing else.
  //
  // This was a four-column table of every metric against two baselines. On a
  // stream that is a spreadsheet: a viewer reads at most three numbers off a
  // card and they should be the three that were unusual. So only BANDED rows
  // survive — the ones GameMetrics called good or poor against your own
  // history — capped at three, and if nothing was unusual the module renders
  // nothing at all rather than a table of averages.
  //
  // The race baseline leaves the card with the table. It needed a column head
  // to mean anything, and a column head is the thing that made this a
  // spreadsheet. It is still in the payload and still in the app.
  function reportModule (g) {
    var r = g.report;
    if (!r || !r.rows || !r.rows.length) return null;
    var rows = r.rows.filter(function (row) { return !!row.band; }).slice(0, 3);
    if (!rows.length) return null;

    var box = el('div', 'mod report');
    box.appendChild(el('h2', null, 'this game'));
    var wrap = el('div', 'callouts');
    rows.forEach(function (row) {
      var co = el('div', 'co');
      var mark = glyph(METRIC_GLYPH[row.key]);
      if (mark) co.appendChild(mark);
      var body = el('div', 'co-b');
      body.appendChild(el('div', 'co-k', row.label));
      var line = el('div', 'co-v');
      line.appendChild(el('span', row.band, row.value));
      // No pill, no column. The value carries the colour and the delta is one
      // small phrase after it, which is the standing rule for comparisons.
      if (row.vsYou && row.vsYou !== '—') {
        line.appendChild(el('span', 'co-d', row.vsYou + ' vs you'));
      }
      body.appendChild(line);
      co.appendChild(body);
      wrap.appendChild(co);
    });
    box.appendChild(wrap);
    return box;
  }

  function clampPct (n) { return Math.max(0, Math.min(100, n || 0)); }

  // The dominance curve, filled against the 50% midline.
  //
  // String-built in the CompareCharts idiom: a viewBox, preserveAspectRatio
  // and nothing else, so the whole drawing is one innerHTML of numbers this
  // function computed. The argument against a chart here was legibility, and
  // it held for a chart — axes, ticks, a legend, four series. One curve above
  // and below a line is the opposite: it says who was winning and when,
  // without a viewer reading a single digit.
  var SPARK_W = 240;
  var SPARK_H = 46;
  var SPARK_PAD = 2;

  function sparkline (curve) {
    var n = curve.length;
    var innerW = SPARK_W - SPARK_PAD * 2;
    var innerH = SPARK_H - SPARK_PAD * 2;
    var xFor = function (i) { return SPARK_PAD + (n < 2 ? innerW : (i / (n - 1)) * innerW); };
    var yFor = function (v) { return SPARK_PAD + innerH - (clampPct(v) / 100) * innerH; };

    var pts = [];
    for (var i = 0; i < n; i++) pts.push(xFor(i).toFixed(1) + ',' + yFor(curve[i]).toFixed(1));
    var line = 'M' + pts.join(' L');
    var floor = (SPARK_H - SPARK_PAD).toFixed(1);
    var area = line + ' L' + xFor(n - 1).toFixed(1) + ',' + floor +
      ' L' + xFor(0).toFixed(1) + ',' + floor + ' Z';
    var mid = yFor(50).toFixed(1);

    var wrap = el('div', 'sk');
    wrap.innerHTML =
      '<svg viewBox="0 0 ' + SPARK_W + ' ' + SPARK_H + '" preserveAspectRatio="none" ' +
      'aria-hidden="true">' +
      '<path class="sk-a" d="' + area + '"/>' +
      '<line class="sk-m" x1="' + SPARK_PAD + '" y1="' + mid + '" ' +
      'x2="' + (SPARK_W - SPARK_PAD) + '" y2="' + mid + '"/>' +
      '<path class="sk-l" d="' + line + '"/>' +
      '</svg>';
    return wrap;
  }

  // How the game went: the share of it you were ahead, the shape of it, and at
  // most two lines of why.
  //
  // Two, by priority. Every line here is true and a viewer reads none of them
  // if there are five: the fight that decided it beats the hero ledger beats
  // the size of the lead. Wipes and the gold trade stay in the payload and
  // stay in the app.
  function momentumModule (g) {
    var m = g.momentum;
    if (!m) return null;
    var box = el('div', 'mod momentum');
    box.appendChild(el('h2', null, 'the game'));

    if (m.control !== null && m.control !== undefined) {
      var row = el('div', 'domstat');
      var track = el('span', 'track');
      var fill = el('span', 'fill');
      fill.style.width = clampPct(m.control) + '%';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('span', 'v', m.control + '% in control'));
      box.appendChild(row);
    }

    if (m.curve && m.curve.length > 1) box.appendChild(sparkline(m.curve));

    var lines = [];
    var c = m.combat;
    if (c && c.biggestSwing) {
      lines.push((c.biggestSwing.won ? 'Won' : 'Lost') + ' the big fight, ' +
        (c.biggestSwing.won ? '+' : '-') + c.biggestSwing.swing + 'g' +
        (c.biggestSwing.tf ? ' at ' + c.biggestSwing.tf : ''));
    }
    if (c && (c.heroKills || c.heroDeaths)) {
      lines.push('hero trade ' + c.heroKills + '–' + c.heroDeaths);
    }
    if (m.lead) lines.push('biggest lead +' + m.lead + (m.leadAt ? ' at ' + m.leadAt : ''));
    lines.slice(0, 2).forEach(function (line) { box.appendChild(el('div', 'note', line)); });
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

  // A secondary panel now, not part of the default card: three beats rather
  // than five, each led by the same mark the app's timeline puts on it.
  function momentsModule (g) {
    var list = g.moments || [];
    if (!list.length) return null;
    var box = el('div', 'mod moments');
    box.appendChild(el('h2', null, 'key moments'));
    var ol = el('ol');
    list.slice(0, 3).forEach(function (m) {
      var li = el('li', m.hero ? 'hero' : null);
      var mark = window.Glyphs ? glyph(window.Glyphs.forMoment(m.type)) : null;
      if (mark) li.appendChild(mark);
      li.appendChild(el('span', 't', m.time || ''));
      li.appendChild(el('span', 'n', m.text || ''));
      ol.appendChild(li);
    });
    box.appendChild(ol);
    return box;
  }

  // Categorized the way the app's Build tab groups it, in text: heroes with
  // their level, the units that defined the army, upgrades taken, what got
  // kept vs. spent from the shop, and mercs.
  //
  // Text, and deliberately left that way. A unit-by-unit list is player-facing
  // detail on a viewer-facing card, and it was the widest block on the layout,
  // so this module is off the default set. It stays valid for every URL already
  // naming it and renders exactly as it always has. No portraits here: forty
  // icons is a build order, not a broadcast graphic.
  function buildModule (g) {
    var b = g.build;
    if (!b) return null;
    var box = el('div', 'mod build');
    box.appendChild(el('h2', null, 'build'));

    var addRow = function (label, items, fmt) {
      if (!items || !items.length) return;
      box.appendChild(el('div', 'bd-label', label));
      var row = el('div', 'bd-row');
      items.forEach(function (it) { row.appendChild(el('span', 'bd-chip', fmt(it))); });
      box.appendChild(row);
    };

    addRow('heroes', b.heroes, function (h) { return h.name + ' ' + h.level; });
    addRow('units', b.units, function (u) { return u.name + (u.time ? ' ' + u.time : ''); });
    addRow('upgrades', b.upgrades, function (u) { return u.name + (u.level > 1 ? ' ' + u.level : ''); });
    addRow('bought', (b.kept || []).concat(b.used || []),
      function (e) { return e.name + (e.count > 1 ? ' ×' + e.count : ''); });
    addRow('mercs', b.mercs, function (m) { return m.name + (m.count > 1 ? ' ×' + m.count : ''); });

    return box;
  }

  // root: the element to render into. state: the published payload.
  // modules: array of module names, defaulting to all of them in fixed order.
  //
  // Everything about the last game is tagged `post`. That class is what the
  // reveal mode hides when the hold expires, which is how the full card
  // collapses to the scout-and-session strip instead of disappearing.
  function render (root, state, modules) {
    var s = state || {};
    var g = s.game;
    var want = {};
    (modules && modules.length ? modules : ALL_MODULES).forEach(function (m) { want[m] = true; });

    root.className = 'wc3v-ov';
    root.innerHTML = '';
    var card = el('div', 'card');
    card.appendChild(markStrip());

    if (s.demo) card.appendChild(el('div', 'demo', 'preview, not a real game'));
    var scoutEl = want.scout ? scoutModule(s.scout) : null;
    if (scoutEl) card.appendChild(scoutEl);

    if (g) {
      [want.verdict && verdictModule(s, g), want.report && reportModule(g),
        want.momentum && momentumModule(g), want.h2h && h2hModule(g),
        want.moments && momentsModule(g), want.build && buildModule(g)]
        .forEach(function (mod) {
          if (!mod) return;
          mod.classList.add('post');
          card.appendChild(mod);
        });
    } else if (!scoutEl) {
      // The scout card already said a game is on, so a second "waiting"
      // line under it would just repeat itself.
      //
      // Tagged `post` because it stands in for the last game: it is the empty
      // state of the block above, not part of the strip. Without the tag a
      // single-panel reveal source would sit on a broadcast showing "Waiting
      // for a game." instead of getting out of the way.
      card.appendChild(el('div', 'mod waiting post', 'Waiting for a game.'));
    }

    // Last, because it is the footer and because it is what stays on screen
    // when everything above it is hidden.
    if (want.session) card.appendChild(sessionModule(s));

    root.appendChild(card);
  }

  window.OverlayRender = {
    render: render,
    ALL_MODULES: ALL_MODULES,
    DEFAULT_MODULES: DEFAULT_MODULES
  };
})();
