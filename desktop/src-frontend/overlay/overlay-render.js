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
  var ALL_MODULES = ['scout', 'session', 'verdict', 'heroes', 'army', 'report',
    'momentum', 'route', 'h2h', 'moments', 'build'];

  // What a newly copied URL gets.
  //
  // `heroes` and `army` join the defaults, and they are the point of this pass:
  // the card was a verdict word, three metric rows, two sentences and a record,
  // while the app's own report of the same game leads with portraits. A viewer
  // reads a Death Knight at level 6 and eleven Riflemen instantly and reads a
  // number never.
  //
  // `route` is off by default: it is a canvas that pulls one image off the CDN,
  // which is the only module on this page that can be affected by the machine
  // being offline, and it wants more height than a default card should take.
  // Key moments and the build list stay off for the reason they always were —
  // player detail wearing a viewer-facing card.
  var DEFAULT_MODULES = ['scout', 'session', 'verdict', 'heroes', 'army',
    'report', 'momentum', 'h2h'];

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
    //
    // The element is REPLACED rather than emptied. Blanking it in place left an
    // <img> that had already failed, and a browser keeps painting its own
    // broken-image mark on one of those however the src attribute is edited
    // afterwards. Swapping in the same blank span the invalid-id path above
    // returns is the only version of this that is actually blank.
    img.addEventListener('error', function () {
      var blank = el('span', 'portrait is-blank');
      if (img.parentNode) img.parentNode.replaceChild(blank, img);
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

  // ── The live clock ───────────────────────────────────────────────────────
  //
  // The card is redrawn only when the published state changes, which while a
  // match is on is every 20 to 60 seconds. A clock that advanced only then
  // would sit still for a minute and jump, which reads as broken, so it ticks
  // itself off the one absolute instant in the payload.
  //
  // One interval for the module, restarted by every render and cleared as soon
  // as a redraw leaves no clock on the card. Both consumers are one page
  // holding one card, so a module-level handle is the whole bookkeeping.
  var clockTimer = null;

  function fmtClock (ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  function tickClocks (root) {
    // The WC3V window renders the preview into a host it throws away when the
    // user leaves the Stream screen. In the Browser Source this is never true;
    // there, the card is the page.
    var nodes = root.isConnected ? root.querySelectorAll('[data-since]') : [];
    if (!nodes.length) {
      clearInterval(clockTimer);
      clockTimer = null;
      return false;
    }
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = fmtClock(Date.now() - Number(nodes[i].dataset.since));
    }
    return true;
  }

  function startClocks (root) {
    if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
    if (!tickClocks(root)) return;
    clockTimer = setInterval(function () { tickClocks(root); }, 1000);
  }

  // The match happening RIGHT NOW: who is on the other side, how long it has
  // been going, and what this machine's own replays say about them.
  //
  // This is the only module that is not a game this machine parsed. It is
  // scout.js polling the public W3Champions endpoint for an ongoing ladder
  // match: that a match exists, who is in it, and when the ladder created it.
  // Nothing about the game in progress, which no replay can answer until it
  // ends. The source line says exactly that, permanently.
  //
  // It carries the card while a game is on. Before this existed the whole
  // stream card was the LAST game's verdict, which during a match is a result
  // for a game that finished, sitting on a broadcast under a player who is
  // visibly still playing.
  //
  // The module key stays `scout` after the panel became the live card, for the
  // same reason `report` kept its: shell.html drops module names it does not
  // recognise, so a rename silently blanks the panel in every OBS source
  // already pointed at this app.
  function scoutModule (scout) {
    if (!scout || !scout.opponent) return null;
    var box = el('div', 'mod scout');

    // The one row that says a game is happening. A muted dot rather than a
    // saturated light: this sits beside gameplay footage, and the overlay's
    // whole art direction is earthy and unlit.
    var head = el('div', 'live-head');
    head.appendChild(el('span', 'dot'));
    head.appendChild(el('span', 'lbl', 'live'));
    if (scout.startedAt) {
      // Counted from the ladder's match-created time, which is the queue pop
      // and runs a little ahead of the first frame. That is why this is
      // labelled `live` and never presented as the in-game timer.
      var clk = el('span', 'clk');
      clk.dataset.since = String(scout.startedAt);
      clk.textContent = fmtClock(Date.now() - scout.startedAt);
      head.appendChild(clk);
    }
    if (scout.map) head.appendChild(el('span', 'where', scout.map));
    box.appendChild(head);

    var vs = el('div', 'scout-vs');
    vs.appendChild(crest(scout.opponent.race, 'tile'));
    var who = el('div', 'who');
    who.appendChild(el('b', null, scout.opponent.name || '?'));
    var sub = [RACE[scout.opponent.race] || scout.opponent.race || null];
    if (scout.ladder && scout.ladder.rank) {
      sub.push('rank ' + scout.ladder.rank);
      if (scout.ladder.mmr) sub.push(scout.ladder.mmr + ' mmr');
    }
    who.appendChild(el('div', 'meta', sub.filter(Boolean).join(' · ')));
    vs.appendChild(who);
    box.appendChild(vs);
    box.appendChild(el('div', 'src', 'public W3Champions ladder data'));

    // Everything below this line was learned from replays parsed on this
    // machine, which is a different claim from the ladder lookup above and is
    // labelled as one.
    box.appendChild(el('div', 'bd-label', 'from your replays'));

    // Two records side by side: against this person, and on this map. The map
    // one is knowable without them and it is the only line here a viewer can
    // act on before anything has happened.
    var recs = el('div', 'recs');
    var record = function (label, wins, losses) {
      var r = el('div', 'rec-cell');
      r.appendChild(el('span', 'k', label));
      var rec = el('span', 'rec');
      rec.appendChild(el('span', 'w', String(wins)));
      rec.appendChild(el('span', null, '–'));
      rec.appendChild(el('span', 'l', String(losses)));
      r.appendChild(rec);
      return r;
    };
    if (scout.h2h && scout.h2h.games) {
      recs.appendChild(record('all time', scout.h2h.wins, scout.h2h.losses));
    } else {
      var first = el('div', 'rec-cell');
      first.appendChild(el('span', 'k', 'all time'));
      first.appendChild(el('span', 'rec dim', 'first meeting'));
      recs.appendChild(first);
    }
    if (scout.yourMap) {
      recs.appendChild(record('this map', scout.yourMap.wins, scout.yourMap.losses));
    }
    box.appendChild(recs);

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

  // How many games of the night the form rail draws. A long session runs past
  // any width this card has, and the last dozen is the part anybody watching
  // now was here for.
  var FORM_MAX = 12;

  // The night as a row of struck notches, oldest first.
  //
  // A score says 3–1 and nothing else; three wins then a loss and one loss then
  // three wins are the same score and a completely different night. It is also
  // the only thing on a resting card whose SHAPE changes as the session goes,
  // which is most of what stops an idle overlay reading as a graphic that has
  // frozen on somebody's scene.
  function formRail (results) {
    var list = (results || []).slice(-FORM_MAX);
    if (!list.length) return null;
    var rail = el('div', 'form');
    var wins = 0;
    var losses = 0;
    list.forEach(function (r) {
      if (r === 'win') wins++;
      else if (r === 'loss') losses++;
      rail.appendChild(el('span', 'pip ' + (r === 'win' ? 'w' : r === 'loss' ? 'l' : 'u')));
    });
    rail.setAttribute('aria-label', 'last ' + list.length + ' games, ' +
      wins + ' won, ' + losses + ' lost');
    return rail;
  }

  // The footer, and between games the whole card.
  //
  // Session score, the night's form, where you are on the ladder, and the last
  // result — the things that are still true when no game is on. When the reveal
  // hold expires this is what the card collapses TO, so it is built to be
  // looked at on its own rather than to be a strip under something else.
  //
  // `live` is passed rather than read off the state, because the one line here
  // that is about a finished game only belongs on a card that is not currently
  // showing a match in progress.
  function sessionModule (s, live) {
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

    var rail = formRail(sess.results);
    if (rail) box.appendChild(rail);

    // Where you actually are on the ladder, and how far today has moved it.
    //
    // Every ladder stream on the platform carries this and the card never has.
    // It is also the only number here that keeps meaning something between
    // games, which is most of a session.
    var L = s.ladder;
    if (L && (L.rank || L.mmr)) {
      var line = el('div', 'sess-ladder');
      if (L.rank) line.appendChild(el('span', null, 'rank ' + L.rank));
      if (L.mmr) line.appendChild(el('span', 'mmr', L.mmr + ' mmr'));
      // Zero is not shown. "+0 today" is the same information as no line at
      // all, wearing the styling of a result.
      if (L.climb) {
        line.appendChild(el('span', L.climb > 0 ? 'up' : 'down',
          (L.climb > 0 ? '+' : '') + L.climb + ' today'));
      }
      box.appendChild(line);
    }

    // The last result, as ONE labelled line: the resting card's stand-in for
    // the verdict panel it collapsed.
    //
    // Not a stale verdict. That rule is about a finished result presented as
    // the current one, and a line that says "last" is the opposite claim — it
    // is also the difference between a resting card and an empty one. It comes
    // off during a live match anyway, where the live block is the better use of
    // the row and the ambiguity is real.
    //
    // Gated TWICE, because the two gates answer different questions. Here:
    // is a match on. In overlay.css, on `data-board`: is the verdict panel
    // itself on screen, which the renderer cannot know because the reveal
    // phase settles it after this has drawn. Without the second gate a full
    // card says "Victory vs Opponent" three times.
    var g = s.game;
    if (!live && g && (g.verdict === 'win' || g.verdict === 'loss')) {
      var lastLine = el('div', 'sess-last');
      lastLine.appendChild(el('span', 'k', 'last'));
      lastLine.appendChild(el('span', 'r ' + g.verdict,
        g.verdict === 'win' ? 'Victory' : 'Defeat'));
      if (g.opponent && g.opponent.name) {
        lastLine.appendChild(el('span', 'vs', 'vs ' + g.opponent.name));
        if (g.opponent.race) lastLine.appendChild(crest(g.opponent.race, 'sm'));
      }
      box.appendChild(lastLine);
    }

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

  function clampPct (n) { return Math.max(0, Math.min(100, n || 0)); }

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
    var bits = [g.map, g.mode, fmtDur(g.durationMs), g.heroOpener].filter(Boolean);
    box.appendChild(el('div', 'meta', bits.join(' · ')));

    // The timings, as a RAIL rather than the five-cell grid that used to sit
    // here. The grid died because it was the widest, least-read thing on the
    // card: five labelled boxes a viewer has to read left to right to learn
    // anything. A rail is one line, and the ticks sit where in the game each
    // thing happened, so the SHAPE says "fast expand, late tower" before a
    // single label is read.
    var rail = timingRail(t, g.durationMs);
    if (rail) box.appendChild(rail);
    return box;
  }

  var TIMING_MARKS = [
    { key: 't2', label: 'T2' },
    { key: 't3', label: 'T3' },
    { key: 'expansion', label: 'exp' },
    { key: 'firstTower', label: 'twr' }
  ];

  // "12:34" back to milliseconds.
  //
  // The payload pre-formats every timing on purpose, because the app owns the
  // phrasing and the overlay must never word a game differently. Placing a tick
  // needs the number back, so it is recovered rather than added to the payload
  // twice.
  function msOf (text) {
    var m = /^(\d+):(\d\d)$/.exec(String(text || ''));
    return m ? (+m[1] * 60 + +m[2]) * 1000 : null;
  }

  function timingRail (t, durationMs) {
    var span = durationMs || 0;
    var marks = [];
    for (var i = 0; i < TIMING_MARKS.length; i++) {
      var def = TIMING_MARKS[i];
      var at = msOf(t[def.key]);
      if (at === null || !span) continue;
      marks.push({ label: def.label, value: t[def.key], pct: clampPct((at / span) * 100) });
    }
    if (!marks.length) return null;

    marks.sort(function (a, b) { return a.pct - b.pct; });

    var wrap = el('div', 'rail');
    var track = el('div', 'rail-track');
    wrap.appendChild(track);
    var tags = el('div', 'rail-tags');
    marks.forEach(function (m) {
      var tick = el('span', 'rail-tick');
      tick.style.left = m.pct + '%';
      track.appendChild(tick);
      var tag = el('span', 'rail-tag');
      tag.style.left = m.pct + '%';
      tag.appendChild(el('b', null, m.label));
      tag.appendChild(el('span', null, m.value));
      m.el = tag;
      tags.appendChild(tag);
    });
    wrap.appendChild(tags);

    // Labels sit under their ticks, and ticks are where the events happened —
    // which in a long game with an early tower puts two of them on top of each
    // other. Measured and spread AFTER layout rather than guessed at: the label
    // widths depend on the theme's font and on the scale param, so any constant
    // here would be wrong at three of the four sizes the card offers.
    spreadLabels(tags, marks);
    return wrap;
  }

  // Push overlapping labels apart, left to right, then back from the right edge
  // if the pass ran out of room. Ticks never move: the tick is the fact, the
  // label is the annotation, and it is the annotation that gives way.
  function spreadLabels (host, marks) {
    if (marks.length < 2) return;
    // Deferred one frame: the card is built detached and appended by render(),
    // so widths are zero until it is in the document.
    var run = function () {
      var W = host.clientWidth;
      if (!W) return;
      var GAP = 6;
      var boxes = marks.map(function (m) {
        var w = m.el.offsetWidth;
        return { el: m.el, w: w, x: (m.pct / 100) * W - w / 2 };
      });
      for (var i = 1; i < boxes.length; i++) {
        var min = boxes[i - 1].x + boxes[i - 1].w + GAP;
        if (boxes[i].x < min) boxes[i].x = min;
      }
      var last = boxes[boxes.length - 1];
      if (last.x + last.w > W) {
        var over = last.x + last.w - W;
        for (var j = boxes.length - 1; j >= 0; j--) {
          boxes[j].x -= over;
          if (j > 0) {
            var room = boxes[j].x - (boxes[j - 1].x + boxes[j - 1].w + GAP);
            if (room >= 0) break;
            over = -room;
          }
        }
      }
      if (boxes[0].x < 0) boxes[0].x = 0;
      boxes.forEach(function (b) {
        b.el.style.left = b.x + 'px';
        b.el.style.transform = 'none';
      });
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else run();
  }

  // The heroes, as art.
  //
  // The card showed ONE portrait, the opener, and said the level of nothing.
  // The app's own report of the same game leads with every hero, their level
  // and what they were carrying, and that is the most recognizable information
  // in Warcraft: a viewer places a level 6 Death Knight instantly and reads a
  // number never.
  function heroesModule (g) {
    var list = g.heroes || [];
    if (!list.length) return null;
    var box = el('div', 'mod heroes');
    box.appendChild(el('h2', null, 'heroes'));
    var row = el('div', 'hero-row');
    list.forEach(function (h) {
      var cell = el('div', 'hero');
      var art = el('div', 'hero-art');
      art.appendChild(portrait(h.itemId));
      art.appendChild(el('span', 'hero-lvl', String(h.level || 1)));
      cell.appendChild(art);
      cell.appendChild(el('span', 'hero-name', h.name || ''));
      if (h.items && h.items.length) {
        var inv = el('div', 'hero-items');
        h.items.forEach(function (id) { inv.appendChild(portrait(id)); });
        cell.appendChild(inv);
      }
      row.appendChild(cell);
    });
    box.appendChild(row);
    return box;
  }

  // What both sides fielded, biggest first.
  //
  // The app's unit roster with the attack and armour tables taken off: those
  // are a table, and a table is the thing this card is not. Theirs sits under
  // yours and dimmed, so the comparison is one glance down a column rather than
  // two lists to hold in your head.
  function armySide (units, label, cls) {
    if (!units || !units.length) return null;
    var row = el('div', 'army-row' + (cls ? ' ' + cls : ''));
    row.appendChild(el('span', 'army-who', label));
    var strip = el('div', 'army-strip');
    units.forEach(function (u) {
      var cell = el('div', 'unit');
      cell.appendChild(portrait(u.itemId));
      cell.appendChild(el('span', 'unit-n', String(u.count)));
      cell.title = u.name + ' x' + u.count;
      strip.appendChild(cell);
    });
    row.appendChild(strip);
    return row;
  }

  function armyModule (g) {
    var a = g.army;
    if (!a || (!(a.mine || []).length && !(a.theirs || []).length)) return null;
    var box = el('div', 'mod army');
    box.appendChild(el('h2', null, 'army'));
    var mine = armySide(a.mine, 'you', null);
    var theirs = armySide(a.theirs, 'them', 'army-them');
    if (mine) box.appendChild(mine);
    if (theirs) box.appendChild(theirs);
    return box;
  }

  // Both creep routes on the map they were walked on.
  //
  // The one module that draws rather than lists, and the only thing on this page
  // that reaches the network for anything but its own SSE stream: the map image
  // is a CDN <img>. That is why it is off the default set. A failed image leaves
  // the routes on a plain dark field rather than an empty box.
  var ROUTE_PX = 240;
  var ROUTE_MINE = '#5fa5cb';
  var ROUTE_THEIRS = '#c8683f';
  var MAP_BASE = 'https://cdn.wc3v.com/maps/';
  // A map FOLDER, not an item id: these carry dots and hyphens
  // ("TurtleRock_v2.0", "Autumn-Leaves"). Same principle as SAFE_ICON_ID, which
  // is that a name out of a stranger's replay is whitelisted before it reaches a
  // URL, never escaped after.
  var SAFE_MAP_FOLDER = /^[A-Za-z0-9_.-]+$/;

  function routeModule (g) {
    var r = g.route;
    if (!r || !r.bounds || !r.bounds.map || !r.sides || !r.sides.length) return null;

    var box = el('div', 'mod route');
    box.appendChild(el('h2', null, 'creep routes'));
    var canvas = document.createElement('canvas');
    canvas.className = 'route-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Creep routes');
    box.appendChild(canvas);

    var legend = el('div', 'route-key');
    if (r.sides.filter(function (s) { return s.mine; })[0]) {
      legend.appendChild(keyPip('you', 'you'));
    }
    if (r.sides.filter(function (s) { return !s.mine; })[0]) {
      legend.appendChild(keyPip('them', 'them'));
    }
    box.appendChild(legend);

    drawRoute(canvas, r);
    return box;
  }

  function keyPip (label, cls) {
    var n = el('span', 'route-k route-k-' + cls);
    n.appendChild(el('i'));
    n.appendChild(el('span', null, label));
    return n;
  }

  // The same projection client/js/CreepRouteMap.js uses, cropped to the playable
  // extent, at a size where camp rings and ordinals would be noise: dots and
  // lines only.
  function drawRoute (canvas, r) {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var W = ROUTE_PX;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(W * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var b = r.bounds.camera || r.bounds.map;
    var xMin = b[0][0], yMax = b[0][1], xMax = b[1][0], yMin = b[1][1];
    var mapB = r.bounds.map;
    var mapXMin = mapB[0][0], mapYMax = mapB[0][1];
    var mapXMax = mapB[1][0], mapYMin = mapB[1][1];
    if (xMax - xMin <= 0 || yMax - yMin <= 0) return;

    var w2c = function (x, y) {
      return {
        x: ((x - xMin) / (xMax - xMin)) * W,
        y: ((yMax - y) / (yMax - yMin)) * W
      };
    };

    var paint = function (img) {
      ctx.clearRect(0, 0, W, W);
      if (img) {
        var fx = img.naturalWidth / (mapXMax - mapXMin);
        var fy = img.naturalHeight / (mapYMax - mapYMin);
        ctx.drawImage(img,
          (xMin - mapXMin) * fx, (mapYMax - yMax) * fy,
          (xMax - xMin) * fx, (yMax - yMin) * fy,
          0, 0, W, W);
        ctx.fillStyle = 'rgba(0,0,0,0.30)';
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
      }
      ctx.fillRect(0, 0, W, W);

      // Every camp, so the ones nobody touched still read.
      ctx.fillStyle = 'rgba(255,255,255,0.34)';
      (r.camps || []).forEach(function (c) {
        var p = w2c(c.x, c.y);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fill();
      });

      // Theirs first, so yours reads on top.
      r.sides.slice().sort(function (a, c) {
        return (a.mine ? 1 : 0) - (c.mine ? 1 : 0);
      }).forEach(function (side) {
        var color = side.mine ? ROUTE_MINE : ROUTE_THEIRS;
        var pts = (side.points || []).map(function (p) { return w2c(p.x, p.y); });
        if (side.start) pts.unshift(w2c(side.start.x, side.start.y));
        if (!pts.length) return;

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 2;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
        ctx.shadowBlur = 0;

        if (side.start) {
          ctx.fillStyle = color;
          ctx.fillRect(pts[0].x - 3, pts[0].y - 3, 6, 6);
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(pts[0].x - 3, pts[0].y - 3, 6, 6);
        }
        for (var j = side.start ? 1 : 0; j < pts.length; j++) {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(pts[j].x, pts[j].y, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.75)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      });
    };

    paint(null);
    if (!r.folder || !SAFE_MAP_FOLDER.test(String(r.folder))) return;
    var img = new Image();
    img.onload = function () { paint(img); };
    img.src = MAP_BASE + encodeURIComponent(r.folder) + '/map.jpg';
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

    // The gold trade, as a two-sided bar.
    //
    // It has been in the payload since this module was written and has never
    // been drawn. It is also the one number here that answers "did the fighting
    // go your way" independently of who ended up ahead, which is exactly the
    // thing a viewer who tuned in mid-game wants. A bar rather than a figure:
    // ±3,400 gold means nothing at broadcast distance, and a bar leaning one way
    // means everything.
    if (m.trade) {
      var swung = el('div', 'trade');
      swung.appendChild(el('span', 'trade-k', 'gold traded'));
      var bar = el('span', 'trade-bar');
      var fill = el('span', 'trade-fill' + (m.trade > 0 ? ' up' : ' down'));
      // Against the biggest swing that fits the bar rather than against the
      // game's own total: this is a comparison of the two sides, not a fraction
      // of anything, and 4k is a decisive trade in any game length.
      fill.style.width = clampPct(Math.abs(m.trade) / 4000 * 50) + '%';
      bar.appendChild(fill);
      swung.appendChild(bar);
      swung.appendChild(el('span', 'trade-v' + (m.trade > 0 ? ' up' : ' down'),
        (m.trade > 0 ? '+' : '') + m.trade.toLocaleString()));
      box.appendChild(swung);
    }

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

    // A match is on AND the live card is on this source, so the last game's
    // verdict comes off. A finished result under a player who is visibly still
    // playing is the single most confusing thing this card could show, and the
    // live block is the better use of the same space.
    //
    // Gated on the live card actually rendering. A source composed WITHOUT it
    // (`modules=verdict`) would otherwise go blank mid-game with nothing in its
    // place, so that selection keeps the last game exactly as it always did.
    var live = !!scoutEl;

    if (g && !live) {
      [want.verdict && verdictModule(s, g), want.heroes && heroesModule(g),
        want.army && armyModule(g), want.report && reportModule(g),
        want.momentum && momentumModule(g), want.route && routeModule(g),
        want.h2h && h2hModule(g), want.moments && momentsModule(g),
        want.build && buildModule(g)]
        .forEach(function (mod) {
          if (!mod) return;
          mod.classList.add('post');
          card.appendChild(mod);
        });
    } else if (!scoutEl) {
      // The scout card already said a game is on, so a second "waiting"
      // line under it would just repeat itself.
      //
      // A plate rather than a sentence. This is what a machine that has never
      // parsed a replay puts on a broadcast, and one line of dim 14px text in
      // a corner does not read as "nothing has happened yet", it reads as the
      // overlay having broken.
      //
      // Tagged `post` because it stands in for the last game: it is the empty
      // state of the block above, not part of the board. Without the tag a
      // single-panel reveal source would sit on a broadcast showing "Waiting
      // for a game" instead of getting out of the way.
      var wait = el('div', 'mod waiting post');
      var waitMark = glyph('scout');
      if (waitMark) wait.appendChild(waitMark);
      wait.appendChild(el('span', null, 'Waiting for a game'));
      card.appendChild(wait);
    }

    // Last, because it is the footer and because between games it is the whole
    // card: everything above it is either hidden or was never there.
    if (want.session) card.appendChild(sessionModule(s, live));

    root.appendChild(card);
    startClocks(root);
  }

  window.OverlayRender = {
    render: render,
    ALL_MODULES: ALL_MODULES,
    DEFAULT_MODULES: DEFAULT_MODULES
  };
})();
