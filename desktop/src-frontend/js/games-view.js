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

  // The small pieces: node, buildIcon, raceMark, nameLink, mapName, fmtDur,
  // playerTitle and sectionHead. They were private to this file, which was fine
  // while the report was the only thing that drew a player name or a unit icon.
  // The Library draws both, and a second copy of the CDN base and its id
  // whitelist is a security control that can drift.
  const {
    node, buildIcon, raceMark, nameLink, mapName, fmtDur
  } = window.UIBits;

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

  // Parse-failure codes as a person would say them. The codes come from the
  // parser (client/js/parser/parserEntry.js) and from the backfill's own
  // watchdog; anything unrecognised prints as itself rather than vanishing.
  const FAILURE_REASONS = {
    missing_map: 'on a map WC3V does not know',
    missing_map_cache: 'on a map whose data could not be downloaded',
    timeout: 'took too long to read',
    parse_error: 'unreadable'
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

    // Every account that is you. `identityNames` is the multi-account list;
    // `identityName` is the fallback for a harness that only wires one name.
    const myNames = () => {
      const list = deps.identityNames ? deps.identityNames() : null;
      return (list && list.length) ? list : [deps.identityName()].filter(Boolean);
    };

    // The user's own slot, or null when they were not in the game at all. A
    // downloaded replay, an observed game, a smurf name and an unset identity
    // all land here.
    //
    // Kept apart from viewOf deliberately. viewOf falls back to the first seat
    // so the game still renders, and reading that fallback as "you" made the
    // moment list say "Your Tier 2" directly under a header reading "You were
    // not in this game".
    const seatOf = (summary) => {
      const keys = PA().identityKeys(myNames());
      if (!keys.length) return null;
      for (const slot of Object.keys(summary.players || {})) {
        if (keys.indexOf(PA().normName(summary.players[slot].name)) !== -1) return slot;
      }
      return null;
    };

    const viewOf = (summary) => {
      const mine = myNames();
      if (mine.length) {
        const v = PA().gameView(summary, mine);
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

    // Whether the open game is the one somebody clicked, rather than whichever
    // game a repaint happened to open. Only a click sets it.
    let pickedByHand = false;

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
      //
      // "Survives" means the person put it there. The corpus now paints in
      // batches as it loads off disk, and the batches arrive in store order
      // rather than by date, so the first batch's newest game is very unlikely
      // to be the newest game — and holding on to it would leave somebody
      // looking at a game from March instead of the one they just played.
      const keep = pickedByHand && activeKey && games.some(g => g.key === activeKey);
      select(keep ? activeKey : games[0].key, { byHand: pickedByHand });
    };

    // ── Quick nav ───────────────────────────────────────────────────────────
    //
    // The last few games as chips in the top band, so the common move — step
    // back through this session — never opens the drawer at all. Built from
    // the FILTERED list, because a quick nav that ignores the filter you just
    // set is a quick nav to somewhere you did not ask to go.

    const QUICK = 8;

    // Games being parsed right now, keyed by file name, in queue order. On a
    // fresh install the feed is empty for as long as the first parses take, and
    // an empty window is indistinguishable from a broken one. These sit in the
    // quick nav where the games themselves will land, so the row fills in place
    // rather than appearing all at once out of nowhere.
    let parsing = [];

    // A replay file name as something worth putting on a chip. Autosaves are
    // `Replay_2026_08_06_1423.w3g`; ladder files carry the players. The
    // extension and the `Replay_` prefix are noise on every one of them.
    const parseLabel = (file) => String(file || '')
      .replace(/\.w3g$/i, '')
      .replace(/^replay[_-]/i, '')
      .replace(/_/g, ' ');

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

      // Pending first: they are the newest games, which is where they will sit
      // once they resolve, so nothing jumps when they do.
      for (const item of parsing) {
        if (item.phase === 'done') continue;
        const chip = node('span', 'qn-chip is-parsing');
        chip.dataset.phase = item.phase;
        const mark = node('span', 'qn-spin');
        mark.setAttribute('aria-hidden', 'true');
        chip.appendChild(mark);
        chip.appendChild(node('span', 'qn-name', parseLabel(item.file)));
        chip.title = item.phase === 'failed'
          ? `${item.file} could not be read`
          : `Reading ${item.file}`;
        bar.appendChild(chip);
      }
      const room = Math.max(0, QUICK - bar.children.length);
      for (const summary of games.slice(0, room)) {
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
        chip.addEventListener('click', () => select(summary.key, { byHand: true }));
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

    const filters = { text: '', result: 'any', race: 'any', folder: '' };

    const applyFilters = () => {
      render(deps.store.filterCorpus(allGames, {
        ...filters,
        identityName: deps.identityName(),
        identityNames: myNames(),
        // Which folder a game came from is the folder module's to answer;
        // the store only compares paths it is handed.
        folderOf: deps.folders ? deps.folders.folderOf : null
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
      el('feed-folder').addEventListener('change', (e) => {
        filters.folder = e.target.value;
        e.target.classList.toggle('is-set', !!filters.folder);
        applyFilters();
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
      // The OPPONENT's race keys the row, not yours. Your own race is the same
      // on most rows and would tint the whole feed one colour; what a scan down
      // the feed is looking for is who you played.
      if (v && v.opponent && v.opponent.race) row.dataset.race = v.opponent.race;

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

      row.addEventListener('click', () => select(summary.key, { byHand: true }));
      return row;
    };

    // `opts.byHand` is a click. Anything else is a repaint choosing for you,
    // and the next repaint is free to choose again — see `pickedByHand`.
    const select = (key, opts) => {
      activeKey = key;
      if (opts && opts.byHand) pickedByHand = true;
      for (const n of document.querySelectorAll('.game, .qn-chip')) {
        n.classList.toggle('is-active', n.dataset.key === key);
      }
      // Picking a game is the reason the drawer was open, so it closes. A
      // drawer left up over the report you just asked to see would make the
      // click look like it did nothing.
      //
      // Only a CLICK, though. Every repaint runs through here — a keystroke in
      // the search box, a folder switched, each batch of the corpus as it
      // loads — and closing the drawer on those took the search box away from
      // under the person typing in it.
      if (drawerOpen && opts && opts.byHand) setDrawer(false);
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

    // There is no tab state any more. The report is one panel: the chart, then
    // the builds. What used to be remembered across game selections was which
    // of four, then two, tabs you were on, and the answer now is the only one
    // there is.

    // DominanceChart registers a ResizeObserver, so the chart panel from the
    // previous render is torn down before the column is emptied rather than
    // orphaned holding an observer on a detached element. The panel keeps every
    // mode it has built, so this is the only place that has to know.
    let mountedChart = null;
    const dropChart = () => {
      if (mountedChart) {
        try { mountedChart.destroy(); } catch (e) { /* already gone */ }
        mountedChart = null;
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

      // Head: who, how strong, where. Its own ng- classes: it BORROWED the
      // report's verdict-band chrome until the band stopped existing.
      const band = node('div', 'ng-band');
      const head = node('div', 'ng-head');
      head.appendChild(node('span', 'ng-live', 'Live'));
      const vs = node('span', 'ng-vs');
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
          row.addEventListener('click', () => { mode = 'last'; select(g.key, { byHand: true }); });
          list.appendChild(row);
        }
      }
      host.appendChild(list);
    };

    // ── Batching ────────────────────────────────────────────────────────────
    //
    // A live game landing used to redraw this column three times: the live card
    // coming down, the corpus re-render re-selecting the OLD key, and finally
    // the new game. Two of those three paint the game the user is about to be
    // moved off, and each one tears down and remounts DominanceChart with its
    // ResizeObserver — so the previous game visibly flashed twice before the new
    // report appeared.
    //
    // Depth-counted rather than a flag, so a nested caller cannot end somebody
    // else's batch. The deferred paint reads whatever `activeKey` settled on,
    // which is the point: intermediate selections cost nothing.
    let batchDepth = 0;
    let batchWanted = false;

    const renderDetail = (summary) => {
      if (batchDepth > 0) { batchWanted = true; return; }
      paintDetail(summary);
    };

    const paintDetail = (summary) => {
      const host = el('detail');
      dropChart();
      host.dataset.mode = live ? mode : 'last';

      // The two paths that draw their own column empty the host themselves. The
      // report path does NOT: GameReportView.render empties it, so appending a
      // mode switch here would be wiped by the renderer a line later. It takes
      // the switch as `before` instead.
      if (live && mode === 'next') {
        host.innerHTML = '';
        host.appendChild(modeSwitch());
        nextGamePanel();
        return;
      }

      if (!summary) {
        host.innerHTML = '';
        if (live) host.appendChild(modeSwitch());
        const e = node('div', 'detail-empty');
        e.appendChild(node('p', null, 'Pick a game.'));
        host.appendChild(e);
        return;
      }

      // Corpus entries are a projection now: enough for this list, the grade
      // rail and Coach, and nowhere near enough to draw a report. Fetch the
      // whole game before rendering one.
      //
      // The old view stays on screen while that happens rather than blanking.
      // A stored summary is a few KB of gzip off local disk, so the gap is not
      // perceptible, and a flash of empty would be worse than a beat of stale.
      if (summary.__slim) {
        const wantKey = summary.key;
        deps.store.readFull(wantKey).then((full) => {
          // The pointer moved on while this was in flight. Whatever it landed
          // on has painted or is painting; do not overwrite it.
          if (activeKey !== wantKey) return;
          paintDetail(full);
        }).catch(() => {
          if (activeKey !== wantKey) return;
          // Falling back to the slim record draws a report with holes in it,
          // so say what happened instead.
          host.innerHTML = '';
          const e = node('div', 'detail-empty');
          e.appendChild(node('p', null, 'Could not read that game from disk.'));
          host.appendChild(e);
        });
        return;
      }

      // One screen. No tabs at all.
      //
      // It was four (Review, Story, Build, Economy), then two, and the last two
      // were a chart with a dashboard bolted under it and the builds one click
      // away. A game is one thing. What was on the two tabs and is not here:
      //
      //   • The tile grid. Six numbers under the chart, each a different kind
      //     of thing measured a different way, which is a dashboard rather than
      //     a reading of a game. The comparative ones moved into the verdict
      //     band where they sit beside the result they explain.
      //   • The timeline. Every hero, unit, upgrade and fight in order, which
      //     is genuinely the record of the game and genuinely too long to sit
      //     above the thing people open this screen for. It is recoverable from
      //     git if it should come back as something you opt into.
      //
      // What is here is the chart and the builds, which is the question
      // "how did that go, and what did we make".
      //
      // `mountedChart` is the handle the renderer hands back; dropChart() is
      // what releases the ResizeObserver DominanceChart holds.
      mountedChart = window.GameReportView.render(host, summary, {
        seat: seatOf(summary),
        identityName: deps.identityName(),
        identityNames: myNames(),
        corpus: deps.store.corpus,
        isStale: (s) => deps.store.isStale(s),
        onWatch: deps.onWatch,
        onReparse: deps.onReparse,
        onOpenProfile: deps.onOpenProfile,
        tags: deps.tags,
        folderLabel: deps.folders ? deps.folders.labelFor(summary.key) : null,
        before: live ? modeSwitch() : null
      });
    };

    // The report itself lives in js/game-report-view.js. It was ~490 lines
    // here, which was right while this was the only screen that could show a
    // game. The Library shows games you were not in, and two implementations
    // of "what did these two players build" is two products inside one window.

    // A summary written under an older schema is missing something only a full
    // parse can supply: moments before v2, the combat ledger before v3, the
    // dominance and resource series before v4. The chart panel is where you
    // notice the gap, so the offer to fix it is shared.
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

    wireFilters();

    return {
      // The corpus changed. Everything else goes through the filter.
      render (corpus) {
        allGames = corpus || [];
        // Folder options carry a game count each, so they follow the corpus.
        if (deps.folders) deps.folders.fillSelect(el('feed-folder'), allGames);
        applyFilters();
      },
      select,
      showLoading,

      // ── What is on disk but not in the list ─────────────────────────────
      //
      // "I played two games against him and only one is here" has to have an
      // answer, and it always does: the folder is off, the 1v1 filter passed
      // it over, the read failed, or nothing has read it yet. Silence made
      // every one of those look like the app losing games.
      //
      // `stats` is { onDisk, parsed, failed, filtered1v1 }. onDisk counts only
      // the folders that are switched on, because a game in a folder somebody
      // turned off is not missing.
      renderUnread (stats, onRead) {
        const row = el('unread');
        const text = el('unread-text');
        const btn = el('unread-read');
        if (!row || !stats) return;
        const s = stats;
        const unread = Math.max(0, (s.onDisk || 0) - (s.parsed || 0) - (s.failed || 0));
        if (!unread && !s.failed) { row.hidden = true; return; }

        const bits = [];
        if (unread) {
          bits.push(`${unread.toLocaleString()} replay${unread === 1 ? '' : 's'} ` +
            'in your folders have not been read yet');
        }
        if (s.failed) {
          // With the reasons, because "could not be read" is a dead end and
          // "on a map WC3V has no data for" is not.
          const why = Object.entries(s.reasons || {})
            .sort((a, b) => b[1] - a[1])
            .map(([code, n]) => `${n} ${FAILURE_REASONS[code] || code}`)
            .join(', ');
          bits.push(`${s.failed.toLocaleString()} could not be read` + (why ? ` (${why})` : ''));
        }
        if (s.filtered1v1) {
          bits.push('the 1v1 filter is on, so team, FFA and custom games are skipped');
        }
        text.textContent = bits.join(' · ') + '.';
        row.hidden = false;

        btn.hidden = !unread || !onRead;
        btn.onclick = onRead ? () => { btn.disabled = true; onRead(); } : null;
        btn.disabled = false;
      },

      // ── First-boot catch-up ─────────────────────────────────────────────
      //
      // The backfill engine calls these while it reads the newest games. They
      // only touch the quick nav, so the feed and the report underneath keep
      // working normally throughout.
      // Hold the report column still until endBatch. Everything between the two
      // is free to re-select and re-render; the column paints once, at the end,
      // from whatever the selection settled on.
      beginBatch () { batchDepth += 1; },
      endBatch () {
        batchDepth = Math.max(0, batchDepth - 1);
        if (batchDepth > 0 || !batchWanted) return;
        batchWanted = false;
        paintDetail(games.find(g => g.key === activeKey) || null);
      },

      setParseQueue (files) {
        parsing = (files || []).map(file => ({ file, phase: 'queued' }));
        renderQuickNav();
      },
      setParseProgress (file, phase) {
        const item = parsing.find(p => p.file === file);
        if (item) item.phase = phase;
        else parsing.push({ file, phase });
        renderQuickNav();
      },
      clearParseQueue () {
        if (!parsing.length) return;
        parsing = [];
        renderQuickNav();
      },

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
