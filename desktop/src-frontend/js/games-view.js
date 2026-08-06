// The games feed and the game report: the two screens this app exists to show.
// Folders, backfill and the log are machinery that got out of the way.
//
// Reads stored summaries and never parses. Orientation ("did I win") always
// goes through ProfileAggregate.gameView, so the feed, the report and the OBS
// overlay can never disagree about a result.

(function () {
  'use strict';

  const el = (id) => document.getElementById(id);
  const PA = () => window.ProfileAggregate;
  const ME = () => window.MomentsExtract;

  const RACE = { O: 'Orc', H: 'Human', U: 'Undead', E: 'Night Elf', R: 'Random', N: 'Neutral' };
  const RACE_SHORT = { O: 'OC', H: 'HU', U: 'UD', E: 'NE', R: 'RD', N: 'NT' };

  // Inline SVG rather than an icon font or image files. The app ships no
  // external assets, and the carved look wants flat hard-edged marks.
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

  // Raw map names are ladder filenames like
  // "12_w3c_251104_0950_TurtleRock_v2.0.w3x", long enough to wrap a feed row
  // onto three lines. SummaryExtract owns the display form.
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

  // The site's own unit and building icons, so a build order reads the same in
  // both products. They come from the CDN rather than the installer, because
  // the full set is 7.5 MB of jpgs that LZMA cannot compress, and shipping a
  // subset means guessing which ids a stranger's replay will contain.
  //
  // The id is whitelisted the same way client/js/BuildOrderRenderer.js does
  // it. It came out of a replay a stranger made and it is going into a URL.
  // Anything else renders as no icon.
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

  // A race as a mark. race-icons.js owns the glyph and the fallback so the
  // feed, the report and the scout card all draw the same chip. The two-letter
  // version here covers the icon module failing to load, because data must
  // never vanish with a script.
  const raceMark = (race, tile) => {
    if (window.RaceIcons) return window.RaceIcons.mark(race, tile);
    const n = node('span', tile ? 'race-mark race-tile' : 'race-mark');
    n.textContent = RACE_SHORT[race] || '??';
    if (race) n.dataset.race = race;
    n.title = RACE[race] || 'Unknown race';
    n.setAttribute('aria-label', RACE[race] || 'Unknown race');
    return n;
  };

  // A player name that opens their book. Record, habits and head-to-head all
  // live one click away, which is why the Coach view accepts a name.
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

    // The user's own slot, or null when they were not in the game at all. A
    // downloaded replay, an observed game, a smurf name and an unset identity
    // all land here.
    //
    // Kept apart from viewOf deliberately. viewOf falls back to the first seat
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
      // Not our game. Show it from the first seat so it still renders, and
      // claim no result for a seat nobody picked.
      const first = Object.keys(summary.players || {})[0];
      if (first === undefined) return null;
      const v = PA().gameView(summary, PA().normName(summary.players[first].name));
      if (v) v.result = null;
      return v;
    };

    // ── Feed ────────────────────────────────────────────────────────────────

    // A backfilled corpus is thousands of games at ~10 nodes a row. Pages get
    // appended as the feed is scrolled, so the first paint costs the same
    // whether the history is 40 games or 4,000.
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
        // A fresh install is the normal way to arrive here. It gets the detail
        // column, where the eye already is, and a way forward.
        el('feed-count').textContent = '';
        feed.appendChild(node('div', 'empty', 'No games yet.'));
        renderQuickNav();
        renderFirstRun();
        return;
      }

      // Games exist and the filter matched none of them. That must not read
      // like an empty history.
      el('feed-count').textContent = games.length === allGames.length
        ? `${games.length.toLocaleString()} parsed`
        : `${games.length.toLocaleString()} of ${allGames.length.toLocaleString()}`;

      if (!games.length) {
        feed.appendChild(node('div', 'empty', 'No games match those filters.'));
        renderQuickNav();
        return;
      }

      appendPage();
      renderQuickNav();

      // Keep the current selection when it survives the filter. Otherwise open
      // the newest game, which is what somebody who just finished one wants.
      const keep = activeKey && games.some(g => g.key === activeKey);
      select(keep ? activeKey : games[0].key);
    };

    // ── Quick nav ───────────────────────────────────────────────────────────
    //
    // The last few games as chips in the top band, so the common move — step
    // back through this session — never opens the drawer at all. Built from
    // the FILTERED list, because a quick nav that ignores the filter you just
    // set is a quick nav to somewhere you did not ask to go.

    const QUICK = 8;

    // The edge fade says "the row continues". It has to come off when it does
    // not, or the last chip in a short list looks permanently half-lit.
    const syncQuickNavFade = () => {
      const bar = el('quicknav');
      const atEnd = bar.scrollLeft + bar.clientWidth >= bar.scrollWidth - 2;
      bar.classList.toggle('is-end', atEnd);
    };

    const renderQuickNav = () => {
      const bar = el('quicknav');
      bar.innerHTML = '';
      bar.scrollLeft = 0;
      for (const summary of games.slice(0, QUICK)) {
        const v = viewOf(summary);
        const chip = node('button', 'qn-chip');
        chip.type = 'button';
        chip.dataset.key = summary.key;

        const verdict = v && v.result ? v.result : 'none';
        const tile = node('span', 'qn-v', verdict === 'win' ? 'W' : verdict === 'loss' ? 'L' : '·');
        tile.dataset.v = verdict;
        chip.appendChild(tile);

        if (v && v.race) chip.appendChild(raceMark(v.race));
        if (v && v.opponent) {
          chip.appendChild(node('span', 'qn-name', v.opponent.name));
          chip.appendChild(raceMark(v.opponent.race));
        } else {
          chip.appendChild(node('span', 'qn-name', mapName(summary)));
        }

        chip.title = `${mapName(summary)} · ${fmtDur(summary.durationMs)}${
          summary.playedAt ? ` · ${new Date(summary.playedAt).toLocaleString()}` : ''}`;
        chip.addEventListener('click', () => select(summary.key));
        bar.appendChild(chip);
      }
      syncQuickNavFade();
    };

    // ── The drawer ──────────────────────────────────────────────────────────
    //
    // Opens down over the report rather than beside it. Deliberately not a
    // modal: nothing behind it is disabled, the report keeps its scroll
    // position, and closing it is the same click that opened it.

    let drawerOpen = false;

    const setDrawer = (open) => {
      drawerOpen = open;
      const drawer = el('games-drawer');
      const toggle = el('games-toggle');
      drawer.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.classList.toggle('is-open', open);
      if (open) {
        // The search box is why most people open this. Focus goes there rather
        // than to the first row, which arrow keys can reach anyway.
        el('feed-search').focus();
      }
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
    // keystroke, and short enough that the list still feels live.
    let filterTimer = null;
    const scheduleFilter = () => {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(applyFilters, 140);
    };

    const wireFilters = () => {
      // The race filter buttons ship as text (HU/OC/…) and get their glyphs
      // stamped in here, so the markup carries no second copy of a mark. The
      // letters stay when the icon module is missing.
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

      el('quicknav').addEventListener('scroll', syncQuickNavFade);
      // A narrower window turns a list that fitted into one that does not.
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(syncQuickNavFade).observe(el('quicknav'));
      }

      el('games-toggle').addEventListener('click', () => setDrawer(!drawerOpen));

      // Escape closes it from anywhere on the screen, including from inside
      // the search box, where it would otherwise only clear the field.
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && drawerOpen) {
          setDrawer(false);
          el('games-toggle').focus();
        }
      });

      // A click on the report underneath means "I am done with the list". The
      // listener is on the column rather than the document so the toggle and
      // the drawer itself are not fighting it.
      el('detail').addEventListener('pointerdown', () => {
        if (drawerOpen) setDrawer(false);
      });
    };

    // Placeholder rows while the stored corpus loads. The feed used to stay
    // empty until every summary had come back over IPC, which at a few
    // thousand games is a blank window that reads as broken.
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
        'Finish a match and it shows up here on its own.'));
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

      // The clock time had a column of its own, which cost ~54px of a 264px
      // row and wrapped the meta line onto two. The day header already says
      // which day, so the exact minute rides the tooltip.
      if (summary.playedAt) {
        row.title = new Date(summary.playedAt).toLocaleString();
      }

      row.addEventListener('click', () => select(summary.key));
      return row;
    };

    const select = (key) => {
      activeKey = key;
      for (const n of document.querySelectorAll('.game, .qn-chip')) {
        n.classList.toggle('is-active', n.dataset.key === key);
      }
      // Picking a game is the reason the drawer was open, so it closes. A
      // drawer left up over the report you just asked to see would make the
      // click look like it did nothing.
      if (drawerOpen) setDrawer(false);
      renderDetail(games.find(g => g.key === key) || null);
    };

    // ── Detail: the game report ─────────────────────────────────────────────
    //
    // The fold rule shapes everything here. The report's frame (verdict,
    // timings, tab strip) is fixed and always fits the window, and the body of
    // whichever tab is active is the one scroller. A grid of panels was tried
    // on paper first: at the 580px detail width a narrow window allows, six
    // panels become postage stamps, and collapsibles recreate the 2,400px
    // column this replaced.

    // Remembered across game selections. Somebody stepping through last
    // night's games comparing economies should not get bounced back to the
    // default on every click.
    //
    // Story is where a game opens. Review used to be, on the argument that
    // "so what?" comes before the evidence — but the five grades that were
    // Review's answer now live in the frame above every tab, so opening on
    // Review meant opening on a restatement. What Story opens on instead is
    // the dominance gauge: who was ahead, when that changed, and by how much.
    let activeTab = 'story';

    // DominanceChart registers a ResizeObserver, so the panel from the previous
    // render is torn down before the column is emptied rather than orphaned
    // holding an observer on a detached element.
    let mountedDominance = null;
    const dropDominance = () => {
      if (mountedDominance) {
        try { mountedDominance.destroy(); } catch (e) { /* already gone */ }
        mountedDominance = null;
      }
    };

    // ── Next game ───────────────────────────────────────────────────────────
    //
    // A live W3Champions match takes the whole report column and the column
    // grows a mode switch. It used to be a band pinned above both columns,
    // which pushed the report down by 77px and read as an announcement rather
    // than a part of the app. Nothing here exists when no match is running,
    // which is nearly always, so the fold budget is untouched in the normal
    // case. That property is the reason the band was ever a band.

    let live = null;      // { match, ladder, book }
    let mode = 'last';    // 'last' | 'next'
    let latchedId = null; // opens on Next once per match, then respects clicks

    const modeSwitch = () => {
      const strip = node('div', 'seg mode-seg');
      const add = (key, label) => {
        const b = node('button', 'seg-btn' + (mode === key ? ' is-on' : ''), label);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(mode === key));
        b.addEventListener('click', () => {
          mode = key;
          renderDetail(games.find(g => g.key === activeKey) || null);
        });
        strip.appendChild(b);
      };
      add('next', 'Next game');
      add('last', 'Last game');
      return strip;
    };

    const bar = (label, value, max, note) => {
      const row = node('div', 'ng-bar');
      row.appendChild(node('span', 'ng-bar-k', label));
      const track = node('span', 'ng-bar-track');
      const fill = node('i');
      fill.style.width = `${Math.round((value / Math.max(max, 1)) * 100)}%`;
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(node('span', 'ng-bar-v', note));
      return row;
    };

    const nextGamePanel = () => {
      const host = el('detail');
      const m = live.match;
      const ladder = live.ladder;
      const book = live.book;
      const opp = m.opponents[0];

      // Head: who, how strong, where.
      const band = node('div', 'verdict-band');
      const head = node('div', 'verdict-head');
      head.appendChild(node('span', 'ng-live', 'Live'));
      const vs = node('span', 'verdict-vs');
      vs.appendChild(node('span', null, 'vs '));
      vs.appendChild(nameLink(opp.name, () => deps.onOpenProfile(opp.tag)));
      vs.appendChild(raceMark(opp.race));
      if (m.opponents.length > 1) {
        vs.appendChild(node('span', 'hint', `+${m.opponents.length - 1} more`));
      }
      head.appendChild(vs);

      const bits = [];
      const mmr = (ladder && ladder.mmr) || opp.mmr;
      if (mmr) bits.push(`${Math.round(mmr)} MMR`);
      if (ladder && ladder.rank) bits.push(`#${ladder.rank}`);
      if (mmr && m.me.mmr) {
        const d = Math.round(mmr - m.me.mmr);
        bits.push(d >= 0 ? `+${d} on you` : `${d} on you`);
      }
      if (bits.length) head.appendChild(node('span', 'ng-ladder', bits.join(' · ')));
      band.appendChild(head);

      const meta = node('p', 'detail-meta');
      const metaBits = [];
      if (m.map) metaBits.push(m.map);
      if (book && book.yourMap && book.yourMap.games >= 2) {
        metaBits.push(`you are ${book.yourMap.wins}–${book.yourMap.losses} here`);
      }
      if (book && book.recentForm && book.recentForm.n >= 3) {
        metaBits.push(`they are ${book.recentForm.wins}–${book.recentForm.losses} in their last ${book.recentForm.n}`);
      }
      meta.appendChild(node('span', null, metaBits.join(' · ')));
      band.appendChild(meta);

      if (book && book.h2h) {
        const line = node('p', 'ng-h2h');
        const chip = node('b', 'ng-h2h-score', `${book.h2h.wins}–${book.h2h.losses}`);
        chip.dataset.v = book.h2h.wins > book.h2h.losses ? 'win'
          : book.h2h.wins < book.h2h.losses ? 'loss' : 'even';
        line.appendChild(chip);
        line.appendChild(node('span', null, ` to you in ${book.h2h.games} game${book.h2h.games === 1 ? '' : 's'}`));
        band.appendChild(line);
      } else {
        band.appendChild(node('p', 'ng-h2h', book
          ? `${book.profileGames} games of theirs in your history, none against you`
          : 'First time against them'));
      }
      host.appendChild(band);

      // The book: three cells, all from games on this machine.
      const cells = node('div', 'ng-book');

      const openers = node('section', 'ng-cell');
      openers.appendChild(node('h3', null, book && book.matchup
        ? `Opener, ${book.matchup.key}` : 'Opener'));
      if (book && book.openers.length) {
        const top = book.openers[0].games;
        for (const o of book.openers) {
          openers.appendChild(bar(o.hero, o.games, top, `${o.games}`));
        }
      } else {
        openers.appendChild(node('p', 'hint', 'Not enough games.'));
      }
      cells.appendChild(openers);

      const t2 = node('section', 'ng-cell');
      t2.appendChild(node('h3', null, 'Tier 2'));
      if (book && book.t2Them !== null && book.t2Them !== undefined) {
        const g = node('div', 'ng-pair');
        g.appendChild(node('span', 'ng-pair-k', 'them'));
        g.appendChild(node('b', null, PA().fmtMs(book.t2Them)));
        t2.appendChild(g);
        if (book.t2You !== null && book.t2You !== undefined) {
          const y = node('div', 'ng-pair');
          y.appendChild(node('span', 'ng-pair-k', 'you'));
          y.appendChild(node('b', null, PA().fmtMs(book.t2You)));
          t2.appendChild(y);
        }
        t2.appendChild(node('p', 'hint', `n=${book.t2ThemN}`));
      } else {
        t2.appendChild(node('p', 'hint', 'Not enough games.'));
      }
      cells.appendChild(t2);

      const exp = node('section', 'ng-cell');
      exp.appendChild(node('h3', null, 'Expansion'));
      if (book && book.expansionRate !== null && book.expansionRate !== undefined) {
        exp.appendChild(node('b', 'ng-big', `${book.expansionRate}%`));
        exp.appendChild(node('p', 'hint', `of their ${book.profileGames} games`));
      } else {
        exp.appendChild(node('p', 'hint', 'Not enough games.'));
      }
      cells.appendChild(exp);
      host.appendChild(cells);

      // Every game the two of you have played. The one scroller on the screen.
      const listHead = node('div', 'ng-list-head');
      listHead.appendChild(node('h3', null, 'Your games against them'));
      host.appendChild(listHead);

      const list = node('div', 'ng-list scroll');
      const shared = (book && book.shared) || [];
      if (!shared.length) {
        list.appendChild(node('p', 'hint', 'None yet.'));
      } else {
        for (const g of shared) {
          const gv = viewOf(g);
          const row = node('button', 'game');
          row.type = 'button';
          const verdict = gv && gv.result ? gv.result : 'none';
          const tile = node('span', 'verdict-tile', verdict === 'win' ? 'W' : verdict === 'loss' ? 'L' : '·');
          tile.dataset.v = verdict;
          row.appendChild(tile);
          const main = node('span', 'game-main');
          main.appendChild(node('span', 'game-vs',
            g.playedAt ? new Date(g.playedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Undated'));
          const mline = node('span', 'game-meta');
          if (gv && gv.race && gv.opponent) {
            const mu = node('span', 'matchup');
            mu.appendChild(raceMark(gv.race));
            mu.appendChild(node('i', null, 'v'));
            mu.appendChild(raceMark(gv.opponent.race));
            mline.appendChild(mu);
          }
          mline.appendChild(node('span', null, ` · ${mapName(g)} · ${fmtDur(g.durationMs)}`));
          main.appendChild(mline);
          row.appendChild(main);
          // Opening one is a decision to look at the past, so the column
          // switches back with it.
          row.addEventListener('click', () => { mode = 'last'; select(g.key); });
          list.appendChild(row);
        }
      }
      host.appendChild(list);
    };

    const renderDetail = (summary) => {
      const host = el('detail');
      dropDominance();
      host.innerHTML = '';
      host.dataset.mode = live ? mode : 'last';

      if (live) host.appendChild(modeSwitch());
      if (live && mode === 'next') {
        nextGamePanel();
        return;
      }

      if (!summary) {
        const e = node('div', 'detail-empty');
        e.appendChild(node('p', null, 'Pick a game.'));
        host.appendChild(e);
        return;
      }

      const v = viewOf(summary);
      const seat = seatOf(summary);
      const h2h = h2hData(summary, v, seat);
      const report = reportFor(summary, seat);

      host.appendChild(verdictHead(summary, v, seat, h2h, report));

      // The frame is the verdict band, the grade rail and the tab strip, and
      // nothing else. The game strip used to sit here (114px) and moved to Full
      // details; the dominance gauge replaced it for one revision and was cut
      // too. Both were chrome drawing a timeline above a screen whose default
      // tab already draws one, and the frame is 166px now instead of 310.
      //
      // The dominance panel is still built here rather than inside storyPanel,
      // because `mountedDominance` is what renderDetail tears down and the
      // teardown has to be reachable whichever tab happens to be open.
      let dom = null;
      if (window.DominancePanel && !window.DominancePanel.unavailable(summary)) {
        dom = window.DominancePanel.build(summary, seat, { onWatch: deps.onWatch });
        if (dom) mountedDominance = dom;
      }

      // The five pillars are the only thing on this screen no website could
      // produce, and they were small grey text inside a scroller you could see
      // one row of. They go in the frame.
      if (report) host.appendChild(gradeRail(report));

      // Four tabs, and Story is both first and the default.
      //
      // Review is gone. It was five grades with a sentence each, a benchmark
      // strip and two lists of prose cues — and the grades have been in the
      // frame since the Home redesign, so the tab was mostly restating what
      // was already above it. The benchmarks were the part worth keeping, and
      // they are numbers rather than paragraphs, so they moved into Story's
      // tile grid where they read against the rest of the game's numbers.
      const tabs = [
        { key: 'story', label: 'Story', build: () => storyPanel(summary, v, seat, report, dom) },
        { key: 'build', label: 'Build', build: () => buildPanel(summary, seat) },
        { key: 'economy', label: 'Economy', build: () => economyPanel(summary, v, seat) },
        { key: 'details', label: 'Full details', build: () => detailsPanel(summary, seat) }
      ];

      // A tab remembered from before the merge, from the deleted Review, or
      // from a game that had a Head to head tab and this one does not.
      if (activeTab === 'heroes' || activeTab === 'builds') activeTab = 'build';
      if (activeTab === 'review' || activeTab === 'moments') activeTab = 'story';
      if (!tabs.some(t => t.key === activeTab)) activeTab = tabs[0].key;

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

    // ── Open in WC3V Viewer ─────────────────────────────────────────────────
    //
    // The one control in this app that leaves it. Everything else here reads a
    // file on your machine; this hands a replay to the real 3D viewer over
    // loopback (ROADMAP §10), and it is the single most important thing a
    // report can offer, so it does not look like the other buttons.
    //
    // It carries the canonical wordmark — `WC<span>3</span>V`, the same lockup
    // as the app bar and `.site-wordmark` on the site — because the button is
    // a promise about where you are going, and the destination has a name. The
    // mark is built as elements rather than as a string so `.btn-viewer`
    // cannot be styled into looking like an ordinary primary button by
    // accident: it is the only thing in the app allowed to wear this.
    //
    // The reserved treatment lives in app.css under `.btn-viewer`. Nothing
    // else may use that class, and nothing else may use the wordmark inside a
    // control.
    const viewerButton = (summary, moment) => {
      const b = node('button', 'btn-viewer');
      b.type = 'button';
      b.title = moment
        ? `Open this game in the WC3V viewer at ${moment.tf}`
        : 'Open this game in the WC3V viewer';

      b.appendChild(node('span', 'btn-viewer-lead', 'Open in'));

      const mark = node('span', 'btn-viewer-mark');
      mark.appendChild(node('span', null, 'WC'));
      mark.appendChild(node('span', 'btn-viewer-three', '3'));
      mark.appendChild(node('span', null, 'V'));
      mark.setAttribute('aria-hidden', 'true');
      b.appendChild(mark);

      b.appendChild(node('span', 'btn-viewer-tail', 'Viewer'));

      // The mark is decorative to a screen reader, so the accessible name is
      // spelled out rather than assembled from three spans.
      b.setAttribute('aria-label', moment
        ? `Open in WC3V Viewer at ${moment.tf}`
        : 'Open in WC3V Viewer');

      b.addEventListener('click', () => deps.onWatch(summary, moment || null));
      return b;
    };

    const verdictHead = (summary, v, seat, h2h, report) => {
      const wrap = node('div', 'verdict-band');
      const head = node('div', 'verdict-head');

      // Four reasons a game has no verdict, with four different fixes.
      // Collapsing them into "Result unclear" sends people hunting a parser
      // bug when the real answer is "you never said who you are".
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

        // The record chip. No website can show this number, because it came
        // out of your own games. Clicking it opens the full tab.
        // The tab this used to open is gone. Three facts did not earn a tab
        // that appears and disappears depending on the game, and the depth now
        // lives in Coach, where it is read against their whole history.
        if (h2h) {
          const chip = node('button', 'h2h-chip', `${h2h.wins}–${h2h.losses} all time`);
          chip.type = 'button';
          chip.title = `Your record against ${v.opponent.name}. Opens their book.`;
          chip.addEventListener('click', () => deps.onOpenProfile(v.opponent.name));
          head.appendChild(chip);
        }
      }

      // Watching is an action on the game, so it lives on the header. It sat
      // at the bottom of the moments list once, behind two early returns, and
      // a game with no moments could not be opened at all.
      head.appendChild(viewerButton(summary));
      wrap.appendChild(head);

      // One line, and it has to stay one line at 612px. What used to be here
      // and is not any more: `1v1`, which it always is; the full datetime,
      // which the feed row's tooltip and the day header both carry; and APM,
      // which moved into the Mechanics grade note where it means something.
      // The opener and the 5:00 worker count arrived from the timings panel
      // the game strip replaced.
      const meta = node('p', 'detail-meta');
      if (v && v.race) meta.appendChild(raceMark(v.race));
      const me = v && v.slot != null ? summary.players[v.slot] : null;
      const bits = [mapName(summary), fmtDur(summary.durationMs)];
      if (summary.gameMode && summary.gameMode !== '1v1') bits.push(summary.gameMode);
      if (v && v.heroOpener) bits.push(v.heroOpener);
      if (me && ARCHETYPE[me.archetype]) bits.push(ARCHETYPE[me.archetype]);
      if (v && v.workersAt5m != null) bits.push(`${v.workersAt5m} workers @5:00`);
      meta.appendChild(node('span', null, bits.join(' · ')));
      wrap.appendChild(meta);

      // The one-line read, above the fold. Clicking it opens the tab that
      // justifies it, because a claim you cannot interrogate is an assertion.
      // That used to be Review; Review's numbers are now Story's tile grid.
      if (report) {
        const line = node('button', 'verdict-read', report.headline);
        line.type = 'button';
        line.title = 'Open the numbers behind this';
        line.addEventListener('click', () => { activeTab = 'story'; renderDetail(summary); });
        wrap.appendChild(line);
      }
      return wrap;
    };

    // ── Review: the narrated read of the game ────────────────────────────────
    //
    // The tab that answers "so what?". Grades run against your own rolling
    // median for this matchup (GameReport + ProfileAggregate.baseline) rather
    // than an invented absolute. Every mistake carries the second it happened,
    // so it can open the viewer there.

    const reportFor = (summary, seat) => {
      if (seat === null || !window.GameReport) return null;
      const corpus = deps.store.corpus;
      const v = viewOf(summary);
      // A first run with no corpus still grades. It grades without benchmarks
      // rather than showing nothing.
      const base = corpus
        ? PA().baseline(corpus, deps.identityName(),
          { matchup: v && v.matchup, excludeKey: summary.key })
        : null;
      return window.GameReport.grade(summary, seat, base);
    };

    const gradeRail = (report) => {
      const rail = node('div', 'grade-rail');
      for (const g of report.grades) {
        const cell = node('div', 'grade-cell');
        cell.title = g.note || '';
        cell.appendChild(node('span', 'grade-k', g.label));
        const val = node('span', 'grade-v', g.score === null ? '—' : String(g.score));
        if (g.score === null) val.classList.add('is-none');
        else val.dataset.band = g.score >= 65 ? 'good' : g.score >= 40 ? 'mid' : 'poor';
        cell.appendChild(val);
        rail.appendChild(cell);
      }
      return rail;
    };

    // A summary written under an older schema is missing something only a full
    // parse can supply: moments before v2, the combat ledger before v3, the
    // dominance and resource series before v4. Story and Full details are both
    // places you can notice the gap, so the offer to fix it is shared.
    const reparseBtn = (summary, label) => {
      const btn = node('button', 'btn', label);
      btn.type = 'button';
      btn.addEventListener('click', () => {
        btn.disabled = true;
        btn.textContent = 'Reading the replay…';
        deps.onReparse(summary);
      });
      return btn;
    };

    // ── Story: the shape of the game, in numbers ────────────────────────────
    //
    // The default tab, and the reason to open this app after a game. Two
    // things, in this order: the viewer's own dominance gauge and chart, then
    // every number the game produced as a tile, each read against your own
    // median where there is one.
    //
    // What is deliberately not here:
    //
    //   • Prose. The copy pass already took roughly 70% of this app's words
    //     out. "3 / 5" under HERO K/D is read faster than a sentence saying
    //     the same thing, and a number cannot be subtly wrong the way a
    //     generated sentence can.
    //   • The moments list. It is a timeline, it is long, and it is the one
    //     thing on this screen that genuinely wants a table. It moved to Full
    //     details whole, buttons included.
    //   • The map. It drew camps as terrain and located the 126 of 402 moments
    //     across the preview corpus that carry coordinates, which makes it a
    //     picture of the map rather than a picture of the game.
    //
    // The benchmark tiles are what survived the deleted Review tab. Its grades
    // were already in the frame; its benchmarks were numbers, and numbers
    // belong in a grid of numbers.

    const fmtSecs = (ms) => {
      const total = Math.round(Math.abs(ms) / 1000);
      return total >= 60
        ? `${Math.floor(total / 60)}m${total % 60 ? ` ${total % 60}s` : ''}`
        : `${total}s`;
    };

    // One tile. `band` colours the value — 'good' | 'poor' | undefined — and
    // is only ever set from a real comparison. Colouring a bare number by a
    // guessed threshold is how a dashboard starts lying.
    const tile = (label, value, sub, band) => {
      const t = node('div', 'st-tile');
      t.appendChild(node('span', 'st-k', label));
      const v = node('span', 'st-v', value === null || value === undefined ? '—' : String(value));
      if (value === null || value === undefined) v.classList.add('is-none');
      else if (band) v.dataset.band = band;
      t.appendChild(v);
      // The sub-line holds its space whether or not it has text, so a grid of
      // tiles keeps its rows level when only some carry a baseline.
      t.appendChild(node('span', 'st-sub', sub || ''));
      return t;
    };

    // GameReport's labels are written for a sentence ("effective APM",
    // "workers @5:00") and this grid is eight columns wide at the 900px
    // minimum, where a label that wraps to two lines drags every tile in the
    // row down with it. Short forms here rather than in GameReport, because the
    // overlay and the toast want the long ones.
    // "Workers 5:00" was the one label in the set that wrapped at eight
    // columns, and because grid stretches a row to its tallest cell, that one
    // wrap added 19px to all seven tiles. The timing is not lost: the verdict
    // band's meta line already reads "10 workers @5:00" two rows above, and the
    // tile's own tooltip carries the full wording.
    const BENCH_LABEL = {
      t2: 'Tier 2',
      expansion: 'Expo',
      workersAt5m: 'Workers',
      apmEffective: 'APM'
    };

    // A benchmark as a tile: the value, coloured by direction, and the gap to
    // your own median as a bare signed token underneath.
    //
    // It used to read "14s later than usual", which is three wrapped lines in a
    // 104px column and 100px-tall tiles. The words were carrying nothing the
    // rest of the tile does not already say: the label names the metric, the
    // colour says ahead or behind, and the line under the grid states what the
    // comparison is against. `+14s` is the only part that was information.
    const benchTile = (b) => {
      if (!b || b.valueText === null) return null;
      let sub = '';
      if (b.base !== null && b.base !== undefined && b.value !== null) {
        const d = b.value - b.base;
        const sign = d > 0 ? '+' : '−';
        sub = d === 0 ? 'your usual'
          : (b.key === 't2' || b.key === 'expansion')
            ? `${sign}${fmtSecs(d)}`
            : `${sign}${Math.abs(d)}`;
      }
      const band = b.dir === 'ahead' ? 'good' : b.dir === 'behind' ? 'poor' : null;
      const t = tile(BENCH_LABEL[b.key] || b.label, b.valueText, sub, band);
      // The full wording survives on the tile itself, so nothing is lost to
      // somebody who wants it.
      if (b.baseText !== null && b.baseText !== undefined) {
        t.title = `${b.label}: ${b.valueText}, and you usually ${b.baseText}`;
      }
      return t;
    };

    const peakOf = (track, key) => {
      let peak = null;
      let at = null;
      for (const s of (track || [])) {
        const v = s[key];
        if (typeof v !== 'number') continue;
        if (peak === null || v > peak) { peak = v; at = s.gameTimeMs; }
      }
      return peak === null ? null : { peak, at };
    };

    const storyPanel = (summary, v, seat, report, dom) => {
      const panel = node('section', 'report-pane story-pane');

      // ── The chart ────────────────────────────────────────────────────────
      //
      // `dom` is the handle renderDetail built, so the teardown it registered
      // stays reachable from there whichever tab is open.
      const domReason = window.DominancePanel
        ? window.DominancePanel.unavailable(summary)
        : 'Dominance is unavailable in this build.';

      if (!domReason) {
        if (dom) panel.appendChild(dom.chart);
      } else if (domReason === 'stale') {
        // The one case where re-reading actually changes the answer. A game
        // stored under v4 whose gate refused it will refuse it again, so that
        // one gets a statement instead of a button.
        const row = node('div', 'st-upgrade');
        row.appendChild(node('p', 'hint', 'Parsed before dominance was recorded.'));
        row.appendChild(reparseBtn(summary, 'Re-read this game'));
        panel.appendChild(row);
      } else {
        panel.appendChild(node('p', 'hint', domReason));
      }

      // ── The numbers ──────────────────────────────────────────────────────
      const me = v && v.slot != null ? summary.players[v.slot] : null;
      const combat = me && me.combat;
      const grid = node('div', 'st-grid');
      const add = (t) => { if (t) grid.appendChild(t); };

      // Every sub-line here is one short token. The label names the metric and
      // the colour carries the judgement, so a sentence underneath is a third
      // statement of the same thing — and at eight columns it wraps and takes
      // the whole row's height with it. What a sub-line is FOR is the one fact
      // the value cannot hold: when it happened, or the gap to your median.
      if (combat) {
        const kills = (combat.heroKills || []).length;
        const deaths = (combat.heroDeaths || []).length;
        // Not a ratio. A 3/5 game and a 6/10 game are different games, and a
        // 0-death game divides by nothing.
        add(tile('Hero K/D', `${kills} / ${deaths}`, 'kills / deaths',
          deaths > kills ? 'poor' : kills > deaths ? 'good' : null));

        add(tile('Wipes', `${combat.wipesFor || 0} / ${combat.wipesAgainst || 0}`,
          'for / against',
          (combat.wipesAgainst || 0) > (combat.wipesFor || 0) ? 'poor'
            : (combat.wipesFor || 0) > (combat.wipesAgainst || 0) ? 'good' : null));

        const swing = combat.biggestSwing;
        const swingTile = tile('Swing',
          swing ? `${swing.swing.toLocaleString()}g` : null,
          swing ? swing.tf : '',
          swing ? (swing.won ? 'good' : 'poor') : null);
        if (swing) {
          swingTile.title = `Biggest single trade: ${swing.swing.toLocaleString()} gold ` +
            `${swing.won ? 'your way' : 'their way'} at ${swing.tf}`;
        }
        add(swingTile);
      }

      // The benchmark strip from the deleted Review tab: tier 2, expansion,
      // workers at 5:00, effective APM.
      if (report) {
        for (const b of report.benchmarks) add(benchTile(b));
      }

      // Peak army is the last tile, and the tile budget stops here.
      //
      // Peak workers, tier 3 and first tower were tiles too, and they took the
      // grid to a second row that did not fit at 900x600 — Story overflowed its
      // scroller by 189px, which on the app's default tab is the whole point of
      // the fold rule being missed. None of the three is lost: tier 3 and first
      // tower are chips on the Build card, and all three are on the game strip
      // in Full details, positioned in time, which is a better reading of them
      // than a number anyway.
      if (me) {
        const army = peakOf(me.combatUnitsTrack, 'count');
        add(tile('Peak army', army ? army.peak : null,
          army && army.at ? `at ${fmtDur(army.at)}` : ''));
      }

      if (grid.children.length) {
        panel.appendChild(grid);
      } else {
        panel.appendChild(node('p', 'lead', seat === null
          ? 'Set your name up top to get a read on this game.'
          : 'Not enough in this game to read.'));
      }

      // Graded against what. The grade rail in the frame is a set of numbers
      // with no stated reference otherwise, and this is the one line of text
      // on the tab because leaving it out would make the frame dishonest.
      if (report) {
        panel.appendChild(node('p', 'hint', report.baselineScope === 'matchup'
          ? 'Graded against your own recent games in this matchup.'
          : report.baselineScope === 'all'
            ? 'Graded against your own recent games.'
            : 'Graded on general anchors until you have played more.'));
      }

      return panel;
    };

    // Your history against the player you just faced. No website can tell you
    // this, because it came out of your own games. Computed once per render,
    // and read by both the verdict band's chip and the Head-to-head tab.
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

    // Own seat first, everywhere a per-player grid renders. It is the column
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
      if (isYou) title.appendChild(node('span', 'you-tag', 'you'));
      return title;
    };

    // ── Icon strips ─────────────────────────────────────────────────────────
    //
    // The game's own art from the CDN. Knowing which skill, which upgrade and
    // which item is exactly what the art is for.

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

    // ── Build: what they built ──────────────────────────────────────────────
    //
    // The site's own build-card shape (js/build-card.js), one card per seat.
    // It used to be a hero-card stack followed by a 16-row chronological list
    // per player, which is the same build stated twice, roughly two screens
    // tall, inside a scroller ~150px high. The site packs the whole thing into
    // a card ~280px wide and it is the better instrument.
    //
    // The chronological list was not the problem and is not deleted — it moved
    // to Full details, which is the tab for "in exactly what order".

    const buildPanel = (summary, seat) => {
      const panel = node('section', 'report-pane');
      const grid = node('div', 'bc-grid');
      for (const slot of slotsFor(summary, seat)) {
        const p = summary.players[slot];
        grid.appendChild(window.BuildCard.build(p, {
          icon: buildIcon,
          title: playerTitle(p, slot === seat)
        }));
      }
      panel.appendChild(grid);
      return panel;
    };

    // ── Economy: the viewer's own resource charts ───────────────────────────
    //
    // Food, gold lost and lumber lost, drawn by client/js/ResourceCharts.js —
    // the class the viewer's insights panel mounts — from the resource series
    // SeriesExtract packs into the summary at parse time. Then army size, on
    // the CompareCharts factory the site's compare modal uses, because combat
    // unit count is a summary-only derivation with no viewer chart.
    //
    // The standalone workers chart is gone. The game strip in the frame above
    // already draws both players' worker curves as its lane backgrounds, so
    // the tab was a second and larger copy of something already on screen.

    const economyPanel = (summary, v, seat) => {
      const panel = node('section', 'report-pane economy-pane');
      const slots = slotsFor(summary, seat);
      const meSlot = v && v.slot != null ? String(v.slot) : slots[0];
      const me = summary.players[meSlot];
      // Two players get a duel chart. Anything else charts the viewed seat
      // alone, because inventing a "versus" line in an FFA lies about who it
      // was against.
      const oppSlot = slots.length === 2 ? slots.find(s => s !== meSlot) : null;
      const opp = oppSlot != null ? summary.players[oppSlot] : null;

      const rc = window.EconomyPanel.build(summary, seat, { onWatch: deps.onWatch });
      if (rc) {
        panel.appendChild(rc);
      } else if ((summary.schemaVersion || 1) < 4) {
        const row = node('div', 'st-upgrade');
        row.appendChild(node('p', 'hint', 'Parsed before resources were recorded.'));
        row.appendChild(reparseBtn(summary, 'Re-read this game'));
        panel.appendChild(row);
      }

      // Army size. Fights land as vertical markers, which is what makes "my
      // army never recovered from that" read straight off the chart.
      //
      // The viewBox is authored wide on purpose. CompareCharts defaults to
      // 720x200 with `preserveAspectRatio="xMidYMid meet"`, and the holder
      // renders it at `width:100%; height:auto` — so in this column it drew
      // **336px tall** at 1280 and scaled its 12px axis text to 20px along with
      // it. A chart three times the height it needs, with oversized labels, for
      // no reason but the default aspect. At 1200x200 the same plot is ~200px
      // and the axis text lands at its authored size.
      const CHART_BOX = { width: 1200, height: 200 };
      const CC = window.CompareCharts;
      const markers = (summary.moments || [])
        .filter(m => m.type === 'heroKill' || m.type === 'heroTrade' || m.type === 'wipe')
        .map(m => ({ gameTimeMs: m.t, label: `${m.tf} · ${m.label || 'fight'}` }));

      const armySvg = CC && me
        ? (opp && (opp.combatUnitsTrack || []).length
          ? CC.combatUnitsChart(me.combatUnitsTrack || [], opp.combatUnitsTrack || [],
            { markers, title: 'Army size', ...CHART_BOX })
          : CC.dualLineChart(
            (me.combatUnitsTrack || []).map(s => ({ gameTimeMs: s.gameTimeMs, userValue: s.count || 0 })),
            { title: 'Army size', markers, omitPro: true, ...CHART_BOX }))
        : '';

      if (armySvg) {
        const block = node('div', 'chart-block');
        const legend = node('div', 'chart-legend');
        const mine = node('span', 'legend-item legend-you');
        mine.appendChild(node('i', 'legend-swatch'));
        mine.appendChild(node('span', null, seat !== null ? 'You' : (me.name || 'Player')));
        legend.appendChild(mine);
        if (opp) {
          const theirs = node('span', 'legend-item legend-opp');
          theirs.appendChild(node('i', 'legend-swatch'));
          theirs.appendChild(nameLink(opp.name, deps.onOpenProfile));
          legend.appendChild(theirs);
        }
        block.appendChild(legend);
        const holder = node('div', 'chart-holder');
        holder.innerHTML = armySvg;   // our own factory output, never replay text
        block.appendChild(holder);
        panel.appendChild(block);
      }

      if (!panel.children.length) {
        panel.appendChild(node('p', 'lead', 'No economy samples.'));
      }
      return panel;
    };

    // ── Full details: everything, in order ──────────────────────────────────
    //
    // The tab for a question the other three deliberately refuse: what
    // happened, exactly, and when. Story is a dashboard and Build is a card,
    // and both of those are readings of the game. This is the record.
    //
    // Three sections, each its own table:
    //   Events      — the ranked moments, with the Watch button on every row
    //   Build order — the chronological build, per player, the list that used
    //                 to be the bottom half of the Build tab
    //   Upgrades    — the research timeline with its times, per player
    //
    // It is the one tab allowed to be long, because it is the one tab you
    // arrive at already intending to scroll.

    const detailsPanel = (summary, seat) => {
      const panel = node('section', 'report-pane details-pane');
      const nameFor = (slot) => (summary.players[slot] && summary.players[slot].name) || 'They';
      const stale = deps.store.isStale(summary);

      // ── The game strip ───────────────────────────────────────────────────
      //
      // Four rows that draw the shape of the game: your lane, a fight axis,
      // their lane, a time ruler, with every mark opening the viewer at that
      // second. It was in the report frame, where the dominance gauge now is,
      // and it belongs here: it is the event list with a time axis, sitting
      // directly above the event list without one.
      panel.appendChild(node('h3', 'dt-h', 'Timeline'));
      panel.appendChild(window.GameStrip.build(summary, seat, {
        onWatch: deps.onWatch,
        viewSlot: seat
      }));

      // ── Events ───────────────────────────────────────────────────────────
      const moments = summary.moments || [];
      panel.appendChild(node('h3', 'dt-h', 'Events'));

      if (!moments.length) {
        panel.appendChild(node('p', 'hint', stale
          ? 'Parsed before moments were recorded.'
          : 'Nothing stood out in this game.'));
        if (stale) panel.appendChild(reparseBtn(summary, 'Find moments'));
      } else {
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
      }

      // ── Build order ──────────────────────────────────────────────────────
      panel.appendChild(node('h3', 'dt-h', 'Build order'));
      const orders = node('div', 'builds');
      for (const slot of slotsFor(summary, seat)) {
        const p = summary.players[slot];
        const col = node('div', 'build-col');
        col.appendChild(playerTitle(p, slot === seat));
        const list = node('ul', 'build-list');
        for (const b of (p.buildPreview || [])) {
          const li = node('li');
          li.dataset.type = b.type || '';
          li.appendChild(node('span', 't', b.gameTimeFormatted || ''));
          li.appendChild(buildIcon(b.itemId));
          li.appendChild(node('span', 'n', b.name || ''));
          list.appendChild(li);
        }
        if (!list.children.length) col.appendChild(node('p', 'hint', 'No build recorded.'));
        else col.appendChild(list);
        orders.appendChild(col);
      }
      panel.appendChild(orders);

      // ── Buildings by tier ────────────────────────────────────────────────
      //
      // What the tier upgrades actually bought. SummaryExtract records the
      // distinct buildings and units that first appeared inside each tier,
      // which no other tab shows.
      const tierRows = [];
      for (const slot of slotsFor(summary, seat)) {
        const p = summary.players[slot];
        if (!(p.t2Buildings || []).length && !(p.t3Buildings || []).length) continue;
        const col = node('div', 'build-col');
        col.appendChild(playerTitle(p, slot === seat));
        const strip = (label, entries) => {
          if (!entries.length) return;
          col.appendChild(iconStrip(label, entries.map(e => ({
            itemId: e.itemId, title: e.name || ''
          }))));
        };
        strip('Tier 2', p.t2Buildings || []);
        strip('Tier 3', p.t3Buildings || []);
        tierRows.push(col);
      }
      if (tierRows.length) {
        panel.appendChild(node('h3', 'dt-h', 'Buildings by tier'));
        const grid = node('div', 'builds');
        for (const c of tierRows) grid.appendChild(c);
        panel.appendChild(grid);
      }

      // ── Upgrades and mercenaries ─────────────────────────────────────────
      //
      // The money that never became units. The Build card shows which; this
      // shows when.
      const upRows = [];
      for (const slot of slotsFor(summary, seat)) {
        const p = summary.players[slot];
        const ups = (p.upgradeTimeline || []);
        const mercs = (p.mercenariesHired || []);
        if (!ups.length && !mercs.length) continue;
        const col = node('div', 'build-col');
        col.appendChild(playerTitle(p, slot === seat));
        const list = node('ul', 'build-list');
        const row = (t, itemId, text) => {
          const li = node('li');
          li.appendChild(node('span', 't', t || ''));
          li.appendChild(buildIcon(itemId));
          li.appendChild(node('span', 'n', text));
          list.appendChild(li);
        };
        for (const u of ups) {
          row(u.gameTimeFormatted, u.itemId,
            `${u.name || 'Upgrade'}${u.level > 1 ? ` ${u.level}` : ''}`);
        }
        for (const m of mercs) {
          row(m.gameTimeFormatted, m.itemId,
            `${m.name || 'Mercenary'}${m.goldCost ? ` · ${m.goldCost}g` : ''}`);
        }
        col.appendChild(list);
        upRows.push(col);
      }
      if (upRows.length) {
        panel.appendChild(node('h3', 'dt-h', 'Upgrades and mercenaries'));
        const grid = node('div', 'builds');
        for (const c of upRows) grid.appendChild(c);
        panel.appendChild(grid);
      }

      // ── Items ────────────────────────────────────────────────────────────
      const itemRows = [];
      for (const slot of slotsFor(summary, seat)) {
        const p = summary.players[slot];
        const bought = (p.itemPurchases || []);
        const found = (p.itemPickups || []);
        if (!bought.length && !found.length) continue;
        const col = node('div', 'build-col');
        col.appendChild(playerTitle(p, slot === seat));
        if (bought.length) {
          col.appendChild(iconStrip('Bought', bought.map(i => ({
            itemId: i.itemId,
            title: `${i.name || 'Item'} · ${i.gameTimeFormatted || ''}${i.goldCost ? ` · ${i.goldCost}g` : ''}`
          }))));
        }
        if (found.length) {
          col.appendChild(iconStrip('Found', found.map(i => ({
            itemId: i.itemId,
            title: `${i.name || 'Item'} · ${i.gameTimeFormatted || ''}`
          }))));
        }
        itemRows.push(col);
      }
      if (itemRows.length) {
        panel.appendChild(node('h3', 'dt-h', 'Items'));
        const grid = node('div', 'builds');
        for (const c of itemRows) grid.appendChild(c);
        panel.appendChild(grid);
      }

      if (stale && moments.length) {
        const row = node('div', 'row');
        row.appendChild(node('p', 'hint', 'Parsed under an older format.'));
        row.appendChild(reparseBtn(summary, 'Re-read'));
        panel.appendChild(row);
      }
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
      // A live game just landed. Pull it to the top and open it, because the
      // person who just alt-tabbed wants exactly that game.
      showLatest (key) {
        activeKey = key;
        allGames = deps.store.corpus || allGames;
        applyFilters();
      },
      // A live match arrived, changed, or ended. Opening on Next game latches
      // once per match id, the same rule the overlay's reveal uses, so a
      // re-poll or a corpus reload cannot yank the column out from under
      // somebody who chose to look at last night's game.
      setLiveMatch (match, ladder, book) {
        live = match ? { match, ladder, book } : null;
        if (!live) {
          mode = 'last';
          latchedId = null;
        } else if (match.id !== latchedId) {
          latchedId = match.id;
          mode = 'next';
        }
        renderDetail(games.find(g => g.key === activeKey) || null);
      },
      get activeKey () { return activeKey; }
    };
  };
})();
