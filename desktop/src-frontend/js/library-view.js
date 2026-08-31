// Library: everybody else's games.
//
// Watching, studying and casting other people's replays is most of how this
// game is consumed, and the app had no answer for it. A downloaded replay
// landed in the same feed as your own ladder games and opened a report that
// apologised for itself: "You were not in this game", no result claimed, no
// comparison, your build card first even though neither seat was yours.
//
// This is that use case as a screen. A list of games you are NOT in, and the
// same report renderer Home mounts, in its symmetric presentation: no "you", no
// verdict about the reader, seats in slot order, and the result stated as one
// player beating another.
//
// It reads the same corpus. A replay only has to be inside a registered replay
// root to appear here, which is what "Open a replay…" arranges.

(function () {
  'use strict';

  const el = (id) => document.getElementById(id);
  const PA = () => window.ProfileAggregate;

  const RACES = [
    { key: 'any', label: 'All' },
    { key: 'H', label: 'Human' },
    { key: 'O', label: 'Orc' },
    { key: 'U', label: 'Undead' },
    { key: 'E', label: 'Night Elf' }
  ];

  window.createLibraryView = (deps) => {
    // deps: log, store, identityName(), onWatch(summary, moment),
    //       onReparse(summary), onOpenProfile(name), onOpenReplay()
    const { node, buildIcon, raceMark, mapName, fmtDur, matchupMarks } = window.UIBits;

    let all = [];        // every game in the corpus you are not in
    let shown = [];      // what the filter left
    let activeKey = null;
    let mounted = null;  // the report handle, for its chart teardown

    const filters = { text: '', race: 'any' };

    // A game belongs here when no seat is yours. That is the whole rule: it
    // covers a downloaded pro replay, a game you observed, and a friend's
    // replay you were sent, without any of them needing to be marked.
    //
    // With no identity set NOTHING is yours, so the Library would be your entire
    // history. That reads as the app losing your games. Empty is the honest
    // answer until the app knows who you are.
    const notMine = (summary) => {
      const me = deps.identityName();
      if (!me) return false;
      const key = PA().normName(me);
      for (const slot of Object.keys(summary.players || {})) {
        if (PA().normName(summary.players[slot].name) === key) return false;
      }
      return true;
    };

    const tagsOf = (summary) => (deps.tags ? deps.tags.get(summary.key) : []) || [];

    const matches = (summary) => {
      if (filters.race !== 'any') {
        const races = Object.values(summary.players || {}).map(p => p.race);
        if (races.indexOf(filters.race) === -1) return false;
      }
      if (!filters.text) return true;
      const hay = [
        mapName(summary),
        ...Object.values(summary.players || {}).map(p => p.name || ''),
        ...tagsOf(summary)
      ].join(' ').toLowerCase();
      return hay.indexOf(filters.text) !== -1;
    };

    // ── The list ────────────────────────────────────────────────────────────
    //
    // Symmetric rows: both players, both races, and who won. No verdict tile,
    // because a W or an L is a claim about the reader and neither seat is.
    const row = (summary) => {
      const btn = node('button', 'lib-row');
      btn.type = 'button';
      btn.dataset.key = summary.key;

      const slots = Object.keys(summary.players || {});
      const winSlot = (summary.winner && typeof summary.winner.playerId === 'number')
        ? String(summary.winner.playerId) : null;

      const names = node('span', 'lib-names');
      slots.slice(0, 2).forEach((s, i) => {
        const p = summary.players[s];
        if (i) names.appendChild(node('i', null, 'v'));
        const cell = node('span', 'lib-name');
        if (p.race) cell.dataset.race = p.race;
        if (winSlot && s === winSlot) cell.classList.add('is-winner');
        cell.appendChild(raceMark(p.race));
        cell.appendChild(node('b', null, p.name || '?'));
        names.appendChild(cell);
      });
      btn.appendChild(names);

      const meta = node('span', 'lib-meta');
      const bits = [mapName(summary), fmtDur(summary.durationMs)];
      if (summary.gameMode && summary.gameMode !== '1v1') bits.push(summary.gameMode);
      meta.appendChild(node('span', null, bits.join(' · ')));
      btn.appendChild(meta);

      const tags = tagsOf(summary);
      if (tags.length) {
        const strip = node('span', 'lib-tags');
        for (const t of tags) strip.appendChild(node('span', 'tag', t));
        btn.appendChild(strip);
      }

      if (summary.playedAt) btn.title = new Date(summary.playedAt).toLocaleString();
      btn.addEventListener('click', () => select(summary.key));
      return btn;
    };

    const renderList = () => {
      const list = el('lib-list');
      list.innerHTML = '';
      el('lib-count').textContent = shown.length === all.length
        ? `${shown.length.toLocaleString()} replays`
        : `${shown.length.toLocaleString()} of ${all.length.toLocaleString()}`;

      if (!all.length) {
        // Three different reasons for an empty Library, three different fixes.
        // "No replays" for all of them sends somebody hunting a bug when the
        // answer is that they never told the app their name.
        const why = !deps.identityName()
          ? 'Set your player name first. Until WC3V knows who you are it cannot tell your games from anybody else\'s.'
          : 'Nothing here yet. Add a folder of replays, or open one.';
        const empty = node('div', 'empty');
        empty.appendChild(node('p', null, why));
        list.appendChild(empty);
        return;
      }
      if (!shown.length) {
        list.appendChild(node('div', 'empty', 'No replays match those filters.'));
        return;
      }
      for (const s of shown) list.appendChild(row(s));
      syncActive();
    };

    const syncActive = () => {
      for (const n of el('lib-list').querySelectorAll('.lib-row')) {
        n.classList.toggle('is-active', n.dataset.key === activeKey);
      }
    };

    // ── The report ──────────────────────────────────────────────────────────
    const dropReport = () => {
      if (mounted && mounted.destroy) { try { mounted.destroy(); } catch (e) { /* gone */ } }
      mounted = null;
    };

    const renderDetail = (summary) => {
      const host = el('lib-detail');
      dropReport();

      if (!summary) {
        host.innerHTML = '';
        const e = node('div', 'detail-empty');
        e.appendChild(node('p', null, 'Pick a replay.'));
        host.appendChild(e);
        return;
      }

      // Corpus entries are a projection and cannot draw a report. Same
      // re-read as the Home column, same reason.
      if (summary.__slim) {
        const wantKey = summary.key;
        deps.store.readFull(wantKey).then((full) => {
          if (activeKey !== wantKey) return;
          renderDetail(full);
        }).catch(() => {
          if (activeKey !== wantKey) return;
          host.innerHTML = '';
          const e = node('div', 'detail-empty');
          e.appendChild(node('p', null, 'Could not read that replay from disk.'));
          host.appendChild(e);
        });
        return;
      }

      // seat: null is what selects the symmetric presentation. Passed
      // explicitly rather than left to default, because it is the whole
      // difference between this screen and Home.
      mounted = window.GameReportView.render(host, summary, {
        seat: null,
        identityName: deps.identityName(),
        corpus: deps.store.corpus,
        isStale: (s) => deps.store.isStale(s),
        onWatch: deps.onWatch,
        onReparse: deps.onReparse,
        onOpenProfile: deps.onOpenProfile,
        tags: deps.tags,
        // A tag change reorders nothing but does change what the filter matches
        // and what each row shows, so the list redraws with it.
        onTagsChanged: () => { renderList(); }
      });
    };

    const select = (key) => {
      activeKey = key;
      syncActive();
      renderDetail(shown.find(g => g.key === key) || null);
    };

    const applyFilters = () => {
      shown = all.filter(matches);
      renderList();
      const keep = activeKey && shown.some(g => g.key === activeKey);
      if (shown.length) select(keep ? activeKey : shown[0].key);
      else { activeKey = null; renderDetail(null); }
    };

    // ── Wiring ──────────────────────────────────────────────────────────────
    let filterTimer = null;
    const wire = () => {
      const seg = el('lib-race');
      seg.innerHTML = '';
      for (const r of RACES) {
        const b = node('button', 'seg-btn' + (r.key === 'any' ? ' is-on' : ''), r.label);
        b.type = 'button';
        if (r.key !== 'any') b.dataset.race = r.key;
        b.addEventListener('click', () => {
          filters.race = r.key;
          for (const other of seg.querySelectorAll('.seg-btn')) other.classList.remove('is-on');
          b.classList.add('is-on');
          applyFilters();
        });
        seg.appendChild(b);
      }

      el('lib-search').addEventListener('input', (e) => {
        filters.text = String(e.target.value || '').trim().toLowerCase();
        clearTimeout(filterTimer);
        filterTimer = setTimeout(applyFilters, 120);
      });

      // Opening a file has to REGISTER its folder as a replay root rather than
      // reach past the scoped-read guard. `read_replay` canonicalises its
      // argument and refuses anything outside a registered root, and that guard
      // is load-bearing: it is the reason the webview has no arbitrary
      // filesystem primitive.
      el('lib-open').addEventListener('click', () => deps.onOpenReplay && deps.onOpenReplay());
    };

    wire();

    return {
      render (corpus) {
        all = (corpus || []).filter(notMine);
        applyFilters();
      },
      select,
      get activeKey () { return activeKey; },
      // The Library holds a chart of its own. Leaving the screen has to release
      // it, for the same reason Home does: DominanceChart keeps a
      // ResizeObserver and a parked mode stays alive until it is told not to.
      suspend: dropReport
    };
  };
})();
