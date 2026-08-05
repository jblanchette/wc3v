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

  // The site's own unit/building icons, so a build order reads the same in
  // both products. They come from the CDN rather than the installer: the full
  // set is 7.5 MB of jpgs that LZMA cannot compress, and shipping a subset
  // means guessing which ids a stranger's replay will contain.
  //
  // The id is whitelisted the same way client/js/BuildOrderRenderer.js does it
  // — it comes out of a replay a stranger made, and it is being pasted into a
  // URL. Anything else renders as no icon at all.
  const ICON_BASE = 'https://cdn.wc3v.com/assets/wc3icons/';
  const SAFE_ICON_ID = /^[A-Za-z0-9_-]+$/;

  const buildIcon = (itemId) => {
    const id = String(itemId || '');
    if (!SAFE_ICON_ID.test(id)) return node('span', 'build-icon is-blank');
    const img = document.createElement('img');
    img.className = 'build-icon';
    img.loading = 'lazy';
    img.alt = '';
    img.src = ICON_BASE + id + '.jpg';
    // Offline, or an id the site has no art for. An empty box in the row is
    // better than a broken-image glyph.
    img.addEventListener('error', () => { img.classList.add('is-blank'); img.removeAttribute('src'); });
    return img;
  };

  // A race as a mark. The glyph is one of our own heraldic SVGs
  // (race-icons.js), tinted by the chip's --race-warm-* rule; the race NAME
  // rides on title/aria-label. Falls back to the old two-letter chip if the
  // icon module ever fails to load — data must never vanish with a script.
  const raceMark = (race, tile) => {
    const glyph = window.RaceIcons && window.RaceIcons[race];
    const n = node('span', tile ? 'race-mark race-tile' : 'race-mark');
    if (glyph) n.innerHTML = glyph;             // our own constant, never replay text
    else n.textContent = RACE_SHORT[race] || '??';
    if (race) n.dataset.race = race;
    n.title = RACE[race] || 'Unknown race';
    n.setAttribute('aria-label', RACE[race] || 'Unknown race');
    return n;
  };

  // A player name that opens their book. Everything the app knows about a
  // name — record, habits, head-to-head — lives one click away, which is the
  // whole reason the Coach view accepts a name.
  const nameLink = (name, onOpen) => {
    if (!name || !onOpen) return node('b', null, name || '');
    const b = node('button', 'name-link', name);
    b.type = 'button';
    b.title = `Open ${name} in Coach`;
    b.addEventListener('click', (e) => { e.stopPropagation(); onOpen(name); });
    return b;
  };

  window.createGamesView = (deps) => {
    // deps: log, store, identityName(), onWatch(summary, moment),
    //       onReparse(summary), onGoToSettings(), onOpenProfile(name)
    //
    // allGames is the whole stored history; games is what the filter bar has
    // left of it and is the only thing the feed ever renders.
    let allGames = [];
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

    // A fully backfilled corpus is thousands of games, and each row is ~10
    // nodes. Rows are appended a page at a time as the feed is scrolled, so
    // the first paint costs the same whether the history is 40 games or 4,000.
    const PAGE = 120;
    let shown = 0;
    let lastDay = null;

    const appendPage = () => {
      const feed = el('feed');
      const end = Math.min(shown + PAGE, games.length);
      for (; shown < end; shown++) {
        const summary = games[shown];
        const label = dayLabel(summary.playedAt);
        if (label !== lastDay) {
          lastDay = label;
          feed.appendChild(node('div', 'feed-day', label));
        }
        feed.appendChild(feedRow(summary));
      }
    };

    const render = (corpus) => {
      games = corpus || [];
      const feed = el('feed');
      feed.innerHTML = '';
      feed.scrollTop = 0;
      shown = 0;
      lastDay = null;

      if (!allGames.length) {
        // Nothing parsed yet is the normal state of a fresh install, not a
        // failure — so it gets the detail column (where the eye already is)
        // and a way forward, rather than a grey line in the rail.
        el('feed-count').textContent = '';
        feed.appendChild(node('div', 'empty',
          'Nothing here yet. Finish a match and it appears on its own.'));
        renderFirstRun();
        return;
      }

      // Games exist, but none match the filter — a different situation from an
      // empty history, and it must not read like one.
      el('feed-count').textContent = games.length === allGames.length
        ? `${games.length.toLocaleString()} parsed`
        : `${games.length.toLocaleString()} of ${allGames.length.toLocaleString()}`;

      if (!games.length) {
        feed.appendChild(node('div', 'empty',
          'No games match. Try a different name, or clear the filters.'));
        return;
      }

      appendPage();

      // Keep the current selection if it is still in the list; otherwise open
      // the newest game, which is what somebody who just finished one wants.
      const keep = activeKey && games.some(g => g.key === activeKey);
      select(keep ? activeKey : games[0].key);
    };

    // ── Filtering ───────────────────────────────────────────────────────────

    const filters = { text: '', result: 'any', race: 'any' };

    const applyFilters = () => {
      render(deps.store.filterCorpus(allGames, {
        ...filters,
        identityName: deps.identityName()
      }));
    };

    // Held so a fast typist does not re-filter thousands of games per
    // keystroke; short enough that the list still feels live.
    let filterTimer = null;
    const scheduleFilter = () => {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(applyFilters, 140);
    };

    const wireFilters = () => {
      // The race filter buttons ship as text (HU/OC/…) and get their glyphs
      // here, so the markup carries no second copy of any mark. The letters
      // stay when the icon module is missing.
      if (window.RaceIcons) {
        for (const btn of document.querySelectorAll('#feed-race .seg-race')) {
          const glyph = window.RaceIcons[btn.dataset.race];
          if (glyph) btn.innerHTML = glyph;   // our own constant
        }
      }

      el('feed-search').addEventListener('input', (e) => {
        filters.text = e.target.value;
        scheduleFilter();
      });
      for (const group of ['feed-result', 'feed-race']) {
        el(group).addEventListener('click', (e) => {
          const btn = e.target.closest('.seg-btn');
          if (!btn) return;
          for (const b of el(group).querySelectorAll('.seg-btn')) {
            b.classList.toggle('is-on', b === btn);
          }
          filters[group === 'feed-result' ? 'result' : 'race'] =
            btn.dataset.result || btn.dataset.race;
          applyFilters();
        });
      }
      el('feed').addEventListener('scroll', (e) => {
        const f = e.target;
        if (shown < games.length && f.scrollTop + f.clientHeight > f.scrollHeight - 400) {
          appendPage();
        }
      });
    };

    // Placeholder rows while the stored corpus loads. The feed used to ship
    // empty and stay empty until every summary had come back over IPC, which
    // at a few thousand games is a blank window that reads as broken.
    const showLoading = () => {
      const feed = el('feed');
      feed.innerHTML = '';
      const skel = node('div', 'skeleton');
      for (let i = 0; i < 6; i++) skel.appendChild(node('div', 'skeleton-row'));
      feed.appendChild(skel);
    };

    const renderFirstRun = () => {
      activeKey = null;
      const detail = el('detail');
      detail.innerHTML = '';
      const box = node('div', 'first-run');
      box.appendChild(node('h2', null, 'No games yet'));
      box.appendChild(node('p', null,
        'WC3V is watching your replay folders. Finish a match and it shows up ' +
        'here on its own — the verdict, how the game went, and both build orders.'));
      box.appendChild(node('p', null,
        'Every game you have already played is on disk too. Parsing that history ' +
        'is what makes the profile, the coaching and head-to-head records real.'));
      const go = node('button', 'btn btn-primary', 'Parse my history');
      go.type = 'button';
      go.addEventListener('click', () => deps.onGoToSettings && deps.onGoToSettings());
      box.appendChild(go);
      detail.appendChild(box);
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

    // ── Detail: the game report ─────────────────────────────────────────────
    //
    // The fold rule shapes everything here. The report's frame — verdict,
    // timings, the tab strip — is fixed and always fits the window; the body
    // of whichever tab is active is the ONE scroller. A grid of panels was
    // tried on paper first: at the 580px detail width the narrow window
    // allows, six panels become postage stamps, and collapsibles just
    // recreate the 2,400px column this replaced.

    // Remembered across game selections: someone stepping through last
    // night's games comparing economies should not be bounced back to Story
    // on every click.
    let activeTab = 'story';

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
      const h2h = h2hData(summary, v, seat);

      host.appendChild(verdictHead(summary, v, seat, h2h));
      host.appendChild(timingsPanel(v, seat));

      // Tabs are conditional: one that would be empty is not offered.
      const tabs = [
        { key: 'story', label: 'Story', build: () => momentsPanel(summary, seat) },
        { key: 'heroes', label: 'Heroes', build: () => heroesPanel(summary, seat) },
        { key: 'economy', label: 'Economy', build: () => economyPanel(summary, v, seat) },
        { key: 'builds', label: 'Builds', build: () => buildsPanel(summary, seat) }
      ];
      if (h2h) tabs.push({ key: 'h2h', label: 'Head to head', build: () => h2hPane(h2h, v) });

      if (!tabs.some(t => t.key === activeTab)) activeTab = 'story';

      const strip = node('div', 'report-tabs seg');
      const body = node('div', 'report-body scroll');
      for (const t of tabs) {
        const btn = node('button', 'seg-btn' + (t.key === activeTab ? ' is-on' : ''), t.label);
        btn.type = 'button';
        btn.dataset.tab = t.key;
        btn.addEventListener('click', () => {
          activeTab = t.key;
          for (const b of strip.children) b.classList.toggle('is-on', b === btn);
          for (const pane of body.children) pane.hidden = pane.dataset.tab !== t.key;
          body.scrollTop = 0;
        });
        strip.appendChild(btn);

        const pane = t.build();
        pane.dataset.tab = t.key;
        pane.hidden = t.key !== activeTab;
        body.appendChild(pane);
      }
      host.appendChild(strip);
      host.appendChild(body);
    };

    const ARCHETYPE = {
      'tower-rush': 'Tower rush',
      'fast-expand': 'Fast expand',
      '1-base-t2': 'One-base tech'
    };

    const verdictHead = (summary, v, seat, h2h) => {
      const wrap = node('div', 'verdict-band');
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
        vs.appendChild(nameLink(v.opponent.name, deps.onOpenProfile));
        vs.appendChild(raceMark(v.opponent.race));
        head.appendChild(vs);

        // The record chip: the one number no website can show, because it
        // came out of your own games. Clicking it opens the full tab.
        if (h2h) {
          const chip = node('button', 'h2h-chip', `${h2h.wins}–${h2h.losses} all time`);
          chip.type = 'button';
          chip.title = `Your record against ${v.opponent.name}`;
          chip.addEventListener('click', () => { activeTab = 'h2h'; renderDetail(summary); });
          head.appendChild(chip);
        }
      }

      // Watching the game is a primary action on the GAME, so it lives on the
      // header. It once sat at the bottom of the moments list, behind two
      // early returns — a game with no moments could not be opened at all.
      const open = node('button', 'btn btn-primary', 'Open in viewer');
      open.type = 'button';
      open.title = 'Opens this game in the 3D viewer on wc3v.com';
      open.addEventListener('click', () => deps.onWatch(summary, null));
      head.appendChild(open);
      wrap.appendChild(head);

      const meta = node('p', 'detail-meta');
      if (v && v.race) meta.appendChild(raceMark(v.race));
      const bits = [mapName(summary), summary.gameMode || '?', fmtDur(summary.durationMs)];
      const me = v && v.slot != null ? summary.players[v.slot] : null;
      if (me && ARCHETYPE[me.archetype]) bits.push(ARCHETYPE[me.archetype]);
      if (me && me.apm && me.apm.rawAverage) {
        bits.push(`${Math.round(me.apm.rawAverage)} APM` +
          (me.apm.effectiveAverage ? ` (${Math.round(me.apm.effectiveAverage)} eff)` : ''));
      }
      if (summary.playedAt) bits.push(new Date(summary.playedAt).toLocaleString());
      meta.appendChild(node('span', null, bits.join(' · ')));
      wrap.appendChild(meta);
      return wrap;
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

    // Tab panes carry no headings of their own — the tab button IS the label,
    // and a pane that repeats it burns a line of the one scroller.
    const momentsPanel = (summary, seat) => {
      const panel = node('section', 'report-pane');

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

    // Your history against the player you just faced — the thing no website
    // can tell you, because it came out of your own games. Computed once per
    // render; the verdict band's record chip and the Head-to-head tab both
    // read from it.
    const h2hData = (summary, v, seat) => {
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
      return { games: shared.length, wins, losses, openers, t2s, expanded, expandKnown };
    };

    const h2hPane = (h2h, v) => {
      const panel = node('section', 'report-pane');

      const who = node('p', 'h2h-who');
      who.appendChild(node('span', null, 'Against '));
      who.appendChild(nameLink(v.opponent.name, deps.onOpenProfile));
      panel.appendChild(who);

      const score = node('p', 'h2h-score');
      score.appendChild(node('b', 'w', String(h2h.wins)));
      score.appendChild(node('span', null, '–'));
      score.appendChild(node('b', 'l', String(h2h.losses)));
      score.appendChild(node('span', null, `  in ${h2h.games} game${h2h.games === 1 ? '' : 's'}`));
      panel.appendChild(score);

      const lines = node('ul', 'h2h-lines');
      const say = (text) => lines.appendChild(node('li', null, text));

      const topOpener = [...h2h.openers.entries()].sort((a, b) => b[1] - a[1])[0];
      if (topOpener && topOpener[1] >= 2) {
        say(`Opens ${topOpener[0]} in ${topOpener[1]} of ${h2h.games} games against you.`);
      }
      if (h2h.t2s.length >= 3) {
        const sorted = [...h2h.t2s].sort((a, b) => a - b);
        say(`Usual tier 2: ${PA().fmtMs(sorted[Math.floor(sorted.length / 2)])} (n=${h2h.t2s.length}).`);
      }
      if (h2h.expandKnown >= 3) {
        say(h2h.expanded === 0
          ? `Never expands against you (n=${h2h.expandKnown}).`
          : `Expands in ${h2h.expanded} of ${h2h.expandKnown} games against you.`);
      }
      if (lines.children.length) panel.appendChild(lines);
      return panel;
    };

    // Own seat first, everywhere a per-player grid renders — it is the column
    // being read.
    const slotsFor = (summary, seat) => {
      const slots = Object.keys(summary.players || {});
      slots.sort((a, b) => (a === seat ? -1 : b === seat ? 1 : 0));
      return slots;
    };

    const playerTitle = (p, isYou) => {
      const title = node('h3', 'player-title');
      title.appendChild(raceMark(p.race));
      title.appendChild(nameLink(p.name, deps.onOpenProfile));
      if (isYou) title.appendChild(node('span', 'you-tag', '— you'));
      return title;
    };

    const buildsPanel = (summary, seat) => {
      const panel = node('section', 'report-pane');
      const grid = node('div', 'builds');
      for (const slot of slotsFor(summary, seat)) {
        const p = summary.players[slot];
        const col = node('div', 'build-col');
        col.appendChild(playerTitle(p, slot === seat));

        const list = node('ul', 'build-list');
        for (const b of (p.buildPreview || []).slice(0, 16)) {
          const li = node('li');
          li.dataset.type = b.type || '';
          li.appendChild(node('span', 't', b.gameTimeFormatted || ''));
          li.appendChild(buildIcon(b.itemId));
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

    // ── Heroes: levels, skill order, final items ────────────────────────────
    //
    // All of it has been in the stored summary since day one — heroBuilds
    // carries the ability ids precisely so icons could be drawn — and none of
    // it was shown. The icons are the game's own art from the CDN; identity
    // (which skill, which item) genuinely needs it.

    const iconStrip = (label, entries) => {
      const wrap = node('div', 'icon-strip');
      wrap.appendChild(node('span', 'strip-label', label));
      const row = node('div', 'strip-icons');
      for (const e of entries) {
        const ic = buildIcon(e.itemId);
        if (e.title) ic.title = e.title;
        row.appendChild(ic);
      }
      wrap.appendChild(row);
      return wrap;
    };

    const heroCard = (h) => {
      const card = node('div', 'hero-card');
      const head = node('div', 'hero-head');
      const portrait = buildIcon(h.itemId);
      portrait.classList.add('hero-portrait');
      head.appendChild(portrait);
      const id = node('div', 'hero-id');
      id.appendChild(node('b', null, h.name || 'Hero'));
      id.appendChild(node('span', 'hint', `Level ${h.finalLevel || 1}`));
      head.appendChild(id);
      card.appendChild(head);

      if ((h.skillOrder || []).length) {
        card.appendChild(iconStrip('Skills', h.skillOrder.map(s => ({
          itemId: s.abilityId,
          title: `${s.skillName || 'Skill'}${s.skillLevel ? ` ${s.skillLevel}` : ''} — ${s.gameTimeFormatted || ''}`
        }))));
      }
      if ((h.items || []).length) {
        card.appendChild(iconStrip('Items', h.items.map(it => ({
          itemId: it.itemId,
          title: it.name || ''
        }))));
      }
      return card;
    };

    const heroesPanel = (summary, seat) => {
      const panel = node('section', 'report-pane');
      const grid = node('div', 'heroes');
      let any = false;
      for (const slot of slotsFor(summary, seat)) {
        const p = summary.players[slot];
        const col = node('div', 'hero-col');
        col.appendChild(playerTitle(p, slot === seat));
        for (const h of (p.heroBuilds || [])) {
          any = true;
          col.appendChild(heroCard(h));
        }
        if (!(p.heroBuilds || []).length) col.appendChild(node('p', 'hint', 'No heroes.'));
        grid.appendChild(col);
      }
      if (!any) {
        panel.appendChild(node('p', 'lead', 'No heroes were made in this game.'));
        return panel;
      }
      panel.appendChild(grid);
      return panel;
    };

    // ── Economy: the race behind the fights ─────────────────────────────────
    //
    // Drawn by the same CompareCharts factory the site's compare modal uses —
    // one chart source of truth. Fights land as vertical markers, so "my
    // workers flatlined right after that battle" reads off the chart.

    const economyPanel = (summary, v, seat) => {
      const panel = node('section', 'report-pane');
      const CC = window.CompareCharts;
      const slots = slotsFor(summary, seat);
      const meSlot = v && v.slot != null ? String(v.slot) : slots[0];
      const me = summary.players[meSlot];
      // Two players → a duel chart. Anything else charts the viewed seat
      // alone; inventing a "versus" line in an FFA would be a lie about who
      // it was against.
      const oppSlot = slots.length === 2 ? slots.find(s => s !== meSlot) : null;
      const opp = oppSlot != null ? summary.players[oppSlot] : null;

      if (!CC || !me || !(me.economyTrack || []).length) {
        panel.appendChild(node('p', 'lead',
          'No economy samples were recorded for this game.'));
        return panel;
      }

      const markers = (summary.moments || [])
        .filter(m => m.type === 'heroKill' || m.type === 'heroTrade' || m.type === 'wipe')
        .map(m => ({ gameTimeMs: m.t, label: `${m.tf} — ${m.label || 'fight'}` }));

      const legend = () => {
        const row = node('div', 'chart-legend');
        const mine = node('span', 'legend-item legend-you');
        mine.appendChild(node('i', 'legend-swatch'));
        mine.appendChild(node('span', null, seat !== null ? 'You' : (me.name || 'Player')));
        row.appendChild(mine);
        if (opp) {
          const theirs = node('span', 'legend-item legend-opp');
          theirs.appendChild(node('i', 'legend-swatch'));
          theirs.appendChild(nameLink(opp.name, deps.onOpenProfile));
          row.appendChild(theirs);
        }
        return row;
      };

      const chart = (title, svgString) => {
        if (!svgString) return;
        const block = node('div', 'chart-block');
        block.appendChild(legend());
        const holder = node('div', 'chart-holder');
        holder.innerHTML = svgString;   // our own factory output, never replay text
        block.appendChild(holder);
        panel.appendChild(block);
      };

      const single = (track, key, title) => CC.dualLineChart(
        (track || []).map(s => ({ gameTimeMs: s.gameTimeMs, userValue: s[key] || 0 })),
        { title, markers, omitPro: true });

      if (opp && (opp.economyTrack || []).length) {
        chart('workers', CC.workersChart(me.economyTrack, opp.economyTrack, { markers, title: 'Workers' }));
        chart('army', CC.combatUnitsChart(me.combatUnitsTrack || [], opp.combatUnitsTrack || [], { markers, title: 'Army size' }));
      } else {
        chart('workers', single(me.economyTrack, 'totalWorkers', 'Workers'));
        chart('army', single(me.combatUnitsTrack, 'count', 'Army size'));
      }

      // Upgrades and mercenaries under the charts — the money that did not
      // become units.
      const strips = node('div', 'builds');
      let anyStrip = false;
      for (const slot of slots) {
        const p = summary.players[slot];
        const ups = (p.upgradeTimeline || []).map(u => ({
          itemId: u.itemId,
          title: `${u.name || 'Upgrade'}${u.level ? ` L${u.level}` : ''} — ${u.gameTimeFormatted || ''}`
        }));
        const mercs = (p.mercenariesHired || []).map(m => ({
          itemId: m.itemId,
          title: `${m.name || 'Mercenary'} — ${m.gameTimeFormatted || ''}${m.goldCost ? ` · ${m.goldCost}g` : ''}`
        }));
        if (!ups.length && !mercs.length) continue;
        anyStrip = true;
        const col = node('div', 'build-col');
        col.appendChild(playerTitle(p, slot === seat));
        if (ups.length) col.appendChild(iconStrip('Upgrades', ups));
        if (mercs.length) col.appendChild(iconStrip('Mercs', mercs));
        strips.appendChild(col);
      }
      if (anyStrip) panel.appendChild(strips);
      return panel;
    };

    wireFilters();

    return {
      // The corpus changed. Everything else goes through the filter.
      render (corpus) {
        allGames = corpus || [];
        applyFilters();
      },
      select,
      showLoading,
      // A live game just landed: pull it to the top and open it, because the
      // person who just alt-tabbed wants exactly that game.
      showLatest (key) {
        activeKey = key;
        allGames = deps.store.corpus || allGames;
        applyFilters();
      },
      get activeKey () { return activeKey; }
    };
  };
})();
