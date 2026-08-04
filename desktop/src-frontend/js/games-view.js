// The games feed and the game detail card — the two screens this app exists to
// show. Everything else (folders, backfill, the log) is machinery that got out
// of the way.
//
// Reads stored summaries only; never parses. Orientation ("did I win") always
// goes through ProfileAggregate.gameView so the feed, the detail card and the
// OBS overlay can never disagree about a result.

(function () {
  'use strict';

  const el = (id) => document.getElementById(id);
  const PA = () => window.ProfileAggregate;
  const ME = () => window.MomentsExtract;

  const RACE = { O: 'Orc', H: 'Human', U: 'Undead', E: 'Night Elf', R: 'Random', N: 'Neutral' };
  const RACE_SHORT = { O: 'OC', H: 'HU', U: 'UD', E: 'NE', R: 'RD', N: 'NT' };

  // Inline SVG rather than an icon font or image files: the app ships no
  // external assets and the carved look wants flat, hard-edged marks.
  const ICONS = {
    heroKill: '<svg viewBox="0 0 24 24"><path d="M4 3l6.5 9L9 14.5 3.5 6 4 3zm16 0l-.5 3-5.5 8.5L12.5 12 20 3zM9.5 15.5l2 2-3.5 4-2.5-2.5 4-3.5zm5 0l4 3.5L16 21.5l-3.5-4 2-2z"/></svg>',
    fight:    '<svg viewBox="0 0 24 24"><path d="M6 2l4 6-2 2-5-6.5L6 2zm12 0l3 1.5L16 10l-2-2 4-6zM11 12l1 1 1-1 6 7-2 3-5-6-5 6-2-3 6-7z"/></svg>',
    expansion:'<svg viewBox="0 0 24 24"><path d="M12 2l2.6 6.2 6.4.5-4.9 4.2 1.5 6.3L12 15.9 6.4 19.2l1.5-6.3L3 8.7l6.4-.5L12 2z"/></svg>',
    tier:     '<svg viewBox="0 0 24 24"><path d="M12 3l8 7h-4v11H8V10H4l8-7z"/></svg>',
    scout:    '<svg viewBox="0 0 24 24"><path d="M12 5C6.5 5 2.5 9.5 1 12c1.5 2.5 5.5 7 11 7s9.5-4.5 11-7c-1.5-2.5-5.5-7-11-7zm0 3.5A3.5 3.5 0 1 1 12 15.5a3.5 3.5 0 0 1 0-7z"/></svg>',
    merc:     '<svg viewBox="0 0 24 24"><path d="M12 2a4 4 0 0 1 4 4v2h1.5L19 21H5l1.5-13H8V6a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v2h4V6a2 2 0 0 0-2-2z"/></svg>',
    camp:     '<svg viewBox="0 0 24 24"><path d="M12 3l9 17H3l9-17zm0 5L7.5 18h9L12 8z"/></svg>'
  };

  const iconFor = (type) => {
    if (type === 'heroKill' || type === 'heroTrade' || type === 'heroLostToCreeps') return ICONS.heroKill;
    if (type === 'tier2' || type === 'tier3' || type === 'heroUlt') return ICONS.tier;
    if (type === 'expansion') return ICONS.expansion;
    if (type === 'scout') return ICONS.scout;
    if (type === 'merc') return ICONS.merc;
    if (type === 'campClear') return ICONS.camp;
    return ICONS.fight;
  };

  const fmtDur = (ms) => {
    const total = Math.round((ms || 0) / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  };

  // Raw map names are unreadable ladder filenames —
  // "12_w3c_251104_0950_TurtleRock_v2.0.w3x" — and they are long enough to
  // wrap a feed row onto three lines. SummaryExtract owns the display form.
  const mapName = (summary) =>
    window.SummaryExtract.cleanMapName(summary.mapRaw || summary.map) || 'Unknown map';

  const DAY = 86400000;
  const dayLabel = (ms) => {
    if (!ms) return 'Undated';
    const d = new Date(ms);
    const midnight = new Date().setHours(0, 0, 0, 0);
    if (ms >= midnight) return 'Today';
    if (ms >= midnight - DAY) return 'Yesterday';
    if (ms >= midnight - 6 * DAY) return d.toLocaleDateString(undefined, { weekday: 'long' });
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };

  // Every string below can come from a replay a stranger made. Build DOM with
  // textContent; the only innerHTML in this file is our own SVG constants.
  const node = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  };

  const raceMark = (race) => {
    const n = node('span', 'race-mark', RACE_SHORT[race] || '??');
    if (race) n.dataset.race = race;
    n.title = RACE[race] || 'Unknown race';
    return n;
  };

  window.createGamesView = (deps) => {
    // deps: log, store, identityName(), onWatch(summary, moment), onReparse(summary)
    let games = [];
    let activeKey = null;

    // The user's OWN slot in a game, or null when they were not in it (a
    // downloaded replay, an observed game, a smurf name, identity unset).
    //
    // Kept separate from viewOf on purpose: viewOf falls back to the first seat
    // so the game still renders, and reading that fallback as "you" made the
    // moment list say "Your Tier 2" directly under a header reading "You were
    // not in this game".
    const seatOf = (summary) => {
      const me = deps.identityName();
      if (!me) return null;
      const key = PA().normName(me);
      for (const slot of Object.keys(summary.players || {})) {
        if (PA().normName(summary.players[slot].name) === key) return slot;
      }
      return null;
    };

    const viewOf = (summary) => {
      const me = deps.identityName();
      if (me) {
        const v = PA().gameView(summary, PA().normName(me));
        if (v) return v;
      }
      // Not our game: show it from the first seat so it still renders, but
      // never claim a result for a seat we did not pick.
      const first = Object.keys(summary.players || {})[0];
      if (first === undefined) return null;
      const v = PA().gameView(summary, PA().normName(summary.players[first].name));
      if (v) v.result = null;
      return v;
    };

    // ── Feed ────────────────────────────────────────────────────────────────

    const render = (corpus) => {
      games = corpus || [];
      const feed = el('feed');
      feed.innerHTML = '';

      el('feed-count').textContent = games.length
        ? `${games.length.toLocaleString()} parsed`
        : '';

      if (!games.length) {
        const empty = node('div', 'empty');
        empty.appendChild(node('p', null,
          'No games parsed yet. Finish a match and it appears here on its own.'));
        empty.appendChild(node('p', null,
          'To bring in the games already on disk, open Settings and parse your history.'));
        feed.appendChild(empty);
        renderDetail(null);
        return;
      }

      let lastDay = null;
      for (const summary of games) {
        const label = dayLabel(summary.playedAt);
        if (label !== lastDay) {
          lastDay = label;
          feed.appendChild(node('div', 'feed-day', label));
        }
        feed.appendChild(feedRow(summary));
      }

      // Keep the current selection if it is still in the list; otherwise open
      // the newest game, which is what somebody who just finished one wants.
      const keep = activeKey && games.some(g => g.key === activeKey);
      select(keep ? activeKey : games[0].key);
    };

    const feedRow = (summary) => {
      const v = viewOf(summary);
      const row = node('button', 'game');
      row.type = 'button';
      row.dataset.key = summary.key;

      const verdict = v && v.result ? v.result : 'none';
      const tile = node('span', 'verdict-tile', verdict === 'win' ? 'W' : verdict === 'loss' ? 'L' : '·');
      tile.dataset.v = verdict;
      row.appendChild(tile);

      const main = node('span', 'game-main');
      const vs = node('span', 'game-vs');
      if (v && v.opponent) {
        vs.appendChild(node('span', null, 'vs '));
        vs.appendChild(node('b', null, v.opponent.name));
      } else {
        vs.textContent = summary.gameMode && summary.gameMode !== '1v1'
          ? summary.gameMode
          : (v ? v.name : 'Unknown game');
      }
      main.appendChild(vs);

      const meta = node('span', 'game-meta');
      if (v && v.opponent && v.race) {
        const mu = node('span', 'matchup');
        mu.appendChild(raceMark(v.race));
        mu.appendChild(node('i', null, 'v'));
        mu.appendChild(raceMark(v.opponent.race));
        meta.appendChild(mu);
        meta.appendChild(node('span', null, ` · ${mapName(summary)} · ${fmtDur(summary.durationMs)}`));
      } else {
        meta.appendChild(node('span', null, `${mapName(summary)} · ${fmtDur(summary.durationMs)}`));
      }
      main.appendChild(meta);
      row.appendChild(main);

      row.appendChild(node('span', 'game-when', summary.playedAt
        ? new Date(summary.playedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : ''));

      row.addEventListener('click', () => select(summary.key));
      return row;
    };

    const select = (key) => {
      activeKey = key;
      for (const n of document.querySelectorAll('.game')) {
        n.classList.toggle('is-active', n.dataset.key === key);
      }
      renderDetail(games.find(g => g.key === key) || null);
    };

    // ── Detail ──────────────────────────────────────────────────────────────

    const renderDetail = (summary) => {
      const host = el('detail');
      host.innerHTML = '';

      if (!summary) {
        const e = node('div', 'detail-empty');
        e.appendChild(node('p', null, 'Pick a game to see how it went.'));
        host.appendChild(e);
        return;
      }

      const v = viewOf(summary);
      const seat = seatOf(summary);
      host.appendChild(verdictHead(summary, v, seat));
      host.appendChild(detailActions(summary));
      host.appendChild(timingsPanel(v, seat));
      host.appendChild(momentsPanel(summary, seat));
      const h2h = h2hPanel(summary, v, seat);
      if (h2h) host.appendChild(h2h);
      host.appendChild(buildsPanel(summary, seat));
    };

    const verdictHead = (summary, v, seat) => {
      const wrap = node('div');
      const head = node('div', 'verdict-head');

      // Four different reasons a game has no verdict, with four different
      // fixes. Collapsing them into "Result unclear" sends people looking for
      // a parser bug when the real answer is "you haven't told it who you are".
      const result = v && v.result ? v.result : 'none';
      let unresolved;
      if (!deps.identityName()) unresolved = 'Tell WC3V who you are to score this';
      else if (seat === null) unresolved = 'You were not in this game';
      else if (summary.gameMode !== '1v1') unresolved = 'Team games carry no result';
      else unresolved = 'Could not tell who won';

      const word = node('span', 'verdict-word',
        result === 'win' ? 'Victory' : result === 'loss' ? 'Defeat' : unresolved);
      word.dataset.v = result;
      head.appendChild(word);

      if (v && v.opponent) {
        const vs = node('span', 'verdict-vs');
        vs.appendChild(node('span', null, 'vs '));
        vs.appendChild(node('b', null, v.opponent.name));
        vs.appendChild(node('span', null, ` (${RACE[v.opponent.race] || '?'})`));
        head.appendChild(vs);
      }
      wrap.appendChild(head);

      const bits = [];
      if (v && v.race) bits.push(RACE[v.race] || v.race);
      bits.push(mapName(summary));
      bits.push(summary.gameMode || '?');
      bits.push(fmtDur(summary.durationMs));
      if (summary.playedAt) bits.push(new Date(summary.playedAt).toLocaleString());
      wrap.appendChild(node('p', 'detail-meta', bits.join(' · ')));
      return wrap;
    };

    // Watching the game is a primary action on the GAME, so it lives with the
    // game's header. It used to sit at the bottom of the key-moments list,
    // which put it behind two early returns — a game with no moments, or one
    // stored before moments existed, could not be opened in the viewer at all.
    const detailActions = (summary) => {
      const row = node('div', 'detail-actions');

      const open = node('button', 'btn btn-primary', 'Open in viewer');
      open.type = 'button';
      open.title = 'Opens this game in the 3D viewer on wc3v.com';
      open.addEventListener('click', () => deps.onWatch(summary, null));
      row.appendChild(open);

      // Re-reading a pre-moments game stays in the key-moments panel, next to
      // the gap it fills. Two identical buttons a screen apart is clutter.
      return row;
    };

    const timingsPanel = (v, seat) => {
      const panel = node('section', 'panel');
      panel.appendChild(node('h2', null, seat === null
        ? `How ${(v && v.name) || 'they'} played it`
        : 'How you played it'));
      const grid = node('div', 'timings');
      const cell = (k, val) => {
        const c = node('div', 'timing');
        c.appendChild(node('span', 'timing-k', k));
        const value = node('span', 'timing-v', val == null ? 'never' : val);
        if (val == null) value.classList.add('is-none');
        c.appendChild(value);
        grid.appendChild(c);
      };
      cell('opener', v && v.heroOpener ? v.heroOpener : null);
      cell('tier 2', v && v.t2 != null ? PA().fmtMs(v.t2) : null);
      cell('tier 3', v && v.t3 != null ? PA().fmtMs(v.t3) : null);
      cell('expansion', v && v.expansion != null ? PA().fmtMs(v.expansion) : null);
      cell('first tower', v && v.firstTower != null ? PA().fmtMs(v.firstTower) : null);
      cell('workers @5:00', v && v.workersAt5m != null ? String(v.workersAt5m) : null);
      panel.appendChild(grid);
      return panel;
    };

    const momentsPanel = (summary, seat) => {
      const panel = node('section', 'panel');
      panel.appendChild(node('h2', null, 'Key moments'));

      // A summary written before moments existed cannot have them derived —
      // battles only exist in a full parse. Say so and offer the re-parse,
      // rather than showing an empty list that reads as "nothing happened".
      if (deps.store.isStale(summary)) {
        panel.appendChild(node('p', 'lead',
          'This game was parsed before moments were recorded. Re-reading it takes ' +
          'a few seconds and finds the fights.'));
        const btn = node('button', 'btn', 'Find moments');
        btn.type = 'button';
        btn.addEventListener('click', () => {
          btn.disabled = true;
          btn.textContent = 'Reading the replay…';
          deps.onReparse(summary);
        });
        panel.appendChild(btn);
        return panel;
      }

      const moments = summary.moments || [];
      if (!moments.length) {
        panel.appendChild(node('p', 'lead', 'Nothing stood out in this one.'));
        return panel;
      }

      const nameFor = (slot) => (summary.players[slot] && summary.players[slot].name) || 'They';

      const list = node('ul', 'moments');
      for (const m of moments) {
        const li = node('li', 'moment');
        li.dataset.kind = m.type;

        li.appendChild(node('span', 'moment-time', m.tf));

        const icon = node('span', 'moment-icon');
        icon.innerHTML = iconFor(m.type);   // our own constant, never replay text
        li.appendChild(icon);

        li.appendChild(node('span', 'moment-text', ME().phrase(m, seat, nameFor)));
        li.appendChild(node('span', 'moment-swing', m.swing ? `${m.swing}g swing` : ''));

        const watch = node('button', 'btn btn-sm', 'Watch');
        watch.type = 'button';
        watch.title = `Open the viewer at ${m.tf}`;
        watch.addEventListener('click', () => deps.onWatch(summary, m));
        li.appendChild(watch);

        list.appendChild(li);
      }
      panel.appendChild(list);
      return panel;
    };

    // Your history against the player you just faced — the thing no website can
    // tell you, because it came out of your own games.
    const h2hPanel = (summary, v, seat) => {
      if (!v || !v.opponent || seat === null) return null;
      const corpus = deps.store.corpus;
      if (!corpus) return null;

      const meKey = PA().normName(deps.identityName());
      const oppKey = PA().normName(v.opponent.name);
      const shared = corpus.filter(g => {
        const names = Object.values(g.players || {}).map(p => PA().normName(p.name));
        return names.indexOf(meKey) !== -1 && names.indexOf(oppKey) !== -1;
      });
      if (shared.length < 2) return null;   // one game is not a head-to-head

      let wins = 0;
      let losses = 0;
      const openers = new Map();
      const t2s = [];
      let expanded = 0;
      let expandKnown = 0;
      for (const g of shared) {
        const mine = PA().gameView(g, meKey);
        const theirs = PA().gameView(g, oppKey);
        if (mine && mine.result === 'win') wins++;
        else if (mine && mine.result === 'loss') losses++;
        if (theirs) {
          if (theirs.heroOpener) openers.set(theirs.heroOpener, (openers.get(theirs.heroOpener) || 0) + 1);
          if (theirs.t2 != null) t2s.push(theirs.t2);
          expandKnown++;
          if (theirs.expansionMade) expanded++;
        }
      }

      const panel = node('section', 'panel');
      panel.appendChild(node('h2', null, `Against ${v.opponent.name}`));

      const score = node('p', 'h2h-score');
      score.appendChild(node('b', 'w', String(wins)));
      score.appendChild(node('span', null, '–'));
      score.appendChild(node('b', 'l', String(losses)));
      score.appendChild(node('span', null, `  in ${shared.length} game${shared.length === 1 ? '' : 's'}`));
      panel.appendChild(score);

      const lines = node('ul', 'h2h-lines');
      const say = (text) => lines.appendChild(node('li', null, text));

      const topOpener = [...openers.entries()].sort((a, b) => b[1] - a[1])[0];
      if (topOpener && topOpener[1] >= 2) {
        say(`Opens ${topOpener[0]} in ${topOpener[1]} of ${shared.length} games against you.`);
      }
      if (t2s.length >= 3) {
        const sorted = [...t2s].sort((a, b) => a - b);
        say(`Usual tier 2: ${PA().fmtMs(sorted[Math.floor(sorted.length / 2)])} (n=${t2s.length}).`);
      }
      if (expandKnown >= 3) {
        say(expanded === 0
          ? `Never expands against you (n=${expandKnown}).`
          : `Expands in ${expanded} of ${expandKnown} games against you.`);
      }
      if (lines.children.length) panel.appendChild(lines);
      return panel;
    };

    const buildsPanel = (summary, seat) => {
      const panel = node('section', 'panel');
      panel.appendChild(node('h2', null, 'Build orders'));
      const grid = node('div', 'builds');

      // Own seat first — it is the one being read.
      const slots = Object.keys(summary.players || {});
      slots.sort((a, b) => (a === seat ? -1 : b === seat ? 1 : 0));

      for (const slot of slots) {
        const p = summary.players[slot];
        const col = node('div', 'build-col');
        const title = node('h3');
        title.appendChild(raceMark(p.race));
        title.appendChild(node('span', null, ` ${p.name}`));
        if (slot === seat) title.appendChild(node('span', null, ' — you'));
        col.appendChild(title);

        const list = node('ul', 'build-list');
        for (const b of (p.buildPreview || []).slice(0, 16)) {
          const li = node('li');
          li.dataset.type = b.type || '';
          li.appendChild(node('span', 't', b.gameTimeFormatted || ''));
          li.appendChild(node('span', 'n', b.name || ''));
          list.appendChild(li);
        }
        if (!list.children.length) col.appendChild(node('p', 'hint', 'No build recorded.'));
        else col.appendChild(list);
        grid.appendChild(col);
      }
      panel.appendChild(grid);
      return panel;
    };

    return {
      render,
      select,
      // A live game just landed: pull it to the top and open it, because the
      // person who just alt-tabbed wants exactly that game.
      showLatest (key) {
        activeKey = key;
        render(deps.store.corpus || games);
      },
      get activeKey () { return activeKey; }
    };
  };
})();
