// The game report, as a mountable renderer.
//
// This was ~490 lines inside games-view.js, which was correct while there was
// one screen that could show a game. The Library shows games you were not in,
// and a second implementation of "what did these two players build" would be
// two products' worth of drift inside one window.
//
// `render(host, summary, opts)` owns everything below the feed: the tab row
// with the viewer button, the Overview header (result, record, benchmarks),
// the chart panel, the build cards and the record. It returns a handle whose
// `destroy()` releases the chart, because DominanceChart holds a
// ResizeObserver and dropping the node is not enough.
//
// ── Two presentations, one renderer ─────────────────────────────────────────
//
// PERSONAL is the game you played. It orients everything from your seat: your
// build card first, a Victory or a Defeat, your record against this opponent,
// and the comparison block, which only means anything about a seat that is
// yours.
//
// SYMMETRIC is somebody else's game. There is no "you", so there is no verdict
// to claim, no seat to put first and nothing to benchmark. The result is stated
// as one player beating another, the seats stay in slot order, and the header
// says who won rather than how it went for the reader. Selected automatically:
// no seat means symmetric.
//
// The fold rule holds in both. `.report-body` is the only element that may
// scroll; the tab row above it is fixed.

(function () {
  'use strict';

  const U = () => window.UIBits;
  const PA = () => window.ProfileAggregate;


  // A baseline is only quoted at this many samples. "vs your median (n=2)" is
  // not a benchmark, and a confident-looking delta built on two games is worse
  // than no delta.
  const MIN_BENCH_N = 5;

  // Past this many seats a full card each is a document rather than a report,
  // and the per-player detail that makes a 1v1 readable is noise across six.
  const TEAM_THRESHOLD = 2;

  // Remembered across game selections, the same as the chart panel's mode.
  // Somebody stepping through last night's games comparing creep routes should
  // not be put back on Overview at every click.
  let lastTab = 'overview';

  window.GameReportView = {
    MIN_BENCH_N,
    TEAM_THRESHOLD,

    /**
     * @param host    the element to render into. Emptied first.
     * @param summary a stored game summary
     * @param opts {
     *   seat            your slot in this game, or null. null selects SYMMETRIC.
     *   identityName    your name, for the baselines. Unused when symmetric.
     *   corpus          every stored summary, for the baselines and the record.
     *   isStale(s)      whether this summary predates the current schema
     *   onWatch(s, m)   open in the viewer
     *   onReparse(s)    re-read the replay
     *   onOpenProfile(name)
     *   before          optional element placed above the band (the mode switch)
     * }
     * @returns { destroy() }
     */
    render (host, summary, opts) {
      const o = opts || {};
      const { node, buildIcon, raceMark, mapName, fmtDur, matchupMarks,
        playerTitle, sectionHead } = U();

      host.innerHTML = '';
      if (o.before) host.appendChild(o.before);

      const seat = o.seat === undefined ? null : o.seat;
      const symmetric = seat === null;
      const corpus = o.corpus || null;

      // ── Open in WC3V Viewer ─────────────────────────────────────────────
      //
      // The one control in this app that leaves it. Everything else here reads
      // a file on your machine; this hands a replay to the real 3D viewer over
      // loopback, and it is the single most important thing a report can offer,
      // so it does not look like the other buttons.
      //
      // It carries the canonical wordmark, the same lockup as the app bar and
      // `.site-wordmark` on the site, because the button is a promise about
      // where you are going and the destination has a name. The mark is built as
      // elements rather than as a string so `.btn-viewer` cannot be styled into
      // looking like an ordinary primary button by accident: it is the only
      // thing in the app allowed to wear this. The treatment lives in
      // css/controls.css. Nothing else may use that class or that wordmark
      // inside a control.
      const viewerButton = (moment) => {
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
        b.addEventListener('click', () => o.onWatch && o.onWatch(summary, moment || null));
        return b;
      };

      const reparseBtn = (label) => {
        const btn = node('button', 'btn', label);
        btn.type = 'button';
        btn.addEventListener('click', () => {
          btn.disabled = true;
          btn.textContent = 'Reading the replay…';
          if (o.onReparse) o.onReparse(summary);
        });
        return btn;
      };

      // ── Three numbers, two baselines ────────────────────────────────────
      //
      // Dominance is how much of the game you held. APM is how fast you played
      // it. Hero kills is what you got out of the fights. Each against your own
      // recent games, and against the other players of that race in your own
      // history.
      //
      // Why the race column is the people you faced rather than a published
      // average: see ProfileAggregate.raceBaseline. Both alternatives were
      // measured over the repo corpus and both are dead. Dominance is a share of
      // 100 between two players, so any population average of it is 50 by
      // construction. Effective APM belongs to the bracket, not the race.
      const benchCell = (baseline, key) => {
        const cell = baseline && baseline[key];
        return (cell && cell.n >= MIN_BENCH_N && cell.median !== null) ? cell.median : null;
      };

      const benchStrip = () => {
        const GM = window.GameMetrics;
        // SYMMETRIC has nothing to benchmark: the seats are strangers and the
        // baselines are all built out of the reader's own games.
        if (!GM || symmetric) return null;

        // 1v1 only, the same rule the result and the per-player record are
        // under. Every baseline this block can reach is built from duels, and a
        // 3v3 seat measured against them is a category error: it rendered a team
        // game's 102 APM as "−462.5" against the 1v1 sample.
        if (summary.gameMode !== '1v1') return null;

        const m = GM.forSeat(summary, seat);
        if (!m) return null;

        const v = PA().gameView(summary, PA().normName(o.identityName));
        const mine = corpus
          ? PA().baseline(corpus, o.identityName,
            { matchup: v && v.matchup, excludeKey: summary.key })
          : null;
        const race = window.RaceBaselines
          ? window.RaceBaselines.resolve(corpus, m.race,
            { excludeName: o.identityName, excludeKey: summary.key })
          : null;

        const rows = [];
        for (const spec of GM.METRICS) {
          const value = m[spec.key];
          // A metric with no value at all is not a row. Dominance is absent from
          // any pre-v4 summary and from every team game; the hero ledger is
          // absent before v3. An empty row would read as a zero.
          if (value === null || value === undefined) continue;

          const you = benchCell(mine, spec.key);
          const theirs = benchCell(race, spec.key);

          const row = node('div', 'gb-row');
          row.appendChild(node('span', 'gb-k', spec.label));

          const val = node('span', 'gb-v', GM.format(spec.key, value));
          const band = GM.band(spec.key, value, you);
          if (band) val.dataset.band = band;
          row.appendChild(val);

          // Both delta cells are ALWAYS emitted, even empty. The rows are
          // `display: contents` so their cells join one four-column grid, and a
          // row contributing three cells pulls the next row's label into its
          // last column. The readout shears into nonsense from the first game
          // with no baseline, which is every first game.
          const vsYou = GM.formatDelta(spec.key, value, you);
          const vsRace = GM.formatDelta(spec.key, value, theirs);
          row.appendChild(node('span', 'gb-d', vsYou));
          row.appendChild(node('span', 'gb-d', vsRace));

          // Both deltas in words, because under 1040px the block turns on its
          // side and the race column is hidden rather than allowed to grow the
          // frame. The tooltip is where that number lives at every width.
          const raceName = window.RaceBaselines && race
            ? (window.RaceBaselines.RACE_NAME[race.race] || race.race)
            : 'the race';
          row.title = `${spec.label}: ${GM.format(spec.key, value)}. ` +
            `vs your recent games ${vsYou}, vs ${raceName} ${vsRace}.`;
          rows.push(row);
        }
        if (!rows.length) return null;

        // No column-head row: `.gb-head` had been display:none for two
        // releases and its labels live in each row's tooltip.
        const wrap = node('div', 'gb');
        for (const r of rows) wrap.appendChild(r);
        return wrap;
      };

      // ── Your history against the player you just faced ──────────────────
      //
      // No website can tell you this, because it came out of your own games.
      // Personal only: a record between two strangers is not the reader's.
      const h2hData = (v) => {
        if (symmetric || !v || !v.opponent || !corpus) return null;

        const meKey = PA().normName(o.identityName);
        const oppKey = PA().normName(v.opponent.name);
        const shared = corpus.filter(g => {
          const names = Object.values(g.players || {}).map(p => PA().normName(p.name));
          return names.indexOf(meKey) !== -1 && names.indexOf(oppKey) !== -1;
        });
        if (shared.length < 2) return null;   // one game is not a head-to-head

        let wins = 0;
        let losses = 0;
        for (const g of shared) {
          const mine = PA().gameView(g, meKey);
          if (mine && mine.result === 'win') wins++;
          else if (mine && mine.result === 'loss') losses++;
        }
        return { games: shared.length, wins, losses };
      };

      // ── Tags ────────────────────────────────────────────────────────────
      //
      // Free text somebody typed: "grand final", "random hero", "study this".
      // They drive the Library's filter and the casting overlay's badge, and
      // they are stored in a sidecar rather than on the summary so a re-parse
      // cannot eat them. See js/game-tags.js.
      //
      // Editing is inline and immediate. A dialog for adding one word is three
      // clicks for a thing that should be one.
      const tagStrip = () => {
        const T = o.tags;
        if (!T) return null;

        const strip = node('span', 'tag-strip');

        const draw = () => {
          strip.innerHTML = '';
          for (const t of T.get(summary.key)) {
            const chip = node('span', 'tag');
            chip.appendChild(node('span', null, t));
            const x = node('button', 'tag-x', '×');
            x.type = 'button';
            x.title = `Remove "${t}"`;
            x.setAttribute('aria-label', `Remove tag ${t}`);
            x.addEventListener('click', async () => {
              await T.remove(summary.key, t);
              draw();
              if (o.onTagsChanged) o.onTagsChanged();
            });
            chip.appendChild(x);
            strip.appendChild(chip);
          }

          const add = node('button', 'tag-add', '+ tag');
          add.type = 'button';
          add.title = 'Label this game';
          add.addEventListener('click', () => {
            const field = node('input', 'tag-input');
            field.type = 'text';
            field.maxLength = T.MAX_LEN;
            field.placeholder = 'grand final';
            field.setAttribute('aria-label', 'New tag');
            const commit = async (save) => {
              const value = field.value;
              field.replaceWith(add);
              if (save && value.trim()) {
                await T.add(summary.key, value);
                draw();
                if (o.onTagsChanged) o.onTagsChanged();
              }
            };
            field.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') commit(true);
              if (e.key === 'Escape') commit(false);
            });
            // Blur commits rather than discards. Clicking away from a field you
            // just typed into and losing it is the wrong default.
            field.addEventListener('blur', () => commit(true));
            add.replaceWith(field);
            field.focus();
          });
          strip.appendChild(add);
        };

        draw();
        return strip;
      };

      // ── The Overview header ─────────────────────────────────────────────
      //
      // The verdict band, re-homed. It was a fixed row above the tabs, which
      // billed every game's report ~60px of frame before a single tab drew;
      // now it is the first thing on the Overview tab and scrolls with it.
      // The viewer button it used to carry rides the tab row instead.
      //
      // Facts only, same rule as always: no hero-opener verdicts, no
      // archetype guesses, no graded sentences.
      const overviewHeader = () => {
        const wrap = node('div', 'ov-head');
        const grid = node('div', 'ov-grid');
        const main = node('div', 'ov-main');
        const head = node('div', 'ov-claim');

        const slots = Object.keys(summary.players || {});
        const v = symmetric ? null : PA().gameView(summary, PA().normName(o.identityName));
        const h2h = h2hData(v);

        if (symmetric) {
          // Somebody else's game. The result is a fact about two strangers, so
          // it is stated as one beating the other rather than as a Victory,
          // which is a word about the reader.
          const winSlot = (summary.winner && typeof summary.winner.playerId === 'number')
            ? String(summary.winner.playerId) : null;
          const winner = winSlot && summary.players[winSlot];
          // "A beat B" is a two-seat sentence. With six seats, "the loser" is
          // whichever of the other five sorts first, and the line would state
          // a 3v3 as a duel between two of its players.
          const loserSlot = (winner && slots.length === 2)
            ? slots.filter(s => s !== winSlot)[0] : null;
          const loser = loserSlot && summary.players[loserSlot];

          if (winner && loser) {
            const line = node('span', 'verdict-vs vs-symmetric');
            const w = node('span', 'won');
            w.appendChild(U().nameLink(winner.name, o.onOpenProfile));
            w.appendChild(raceMark(winner.race));
            line.appendChild(w);
            line.appendChild(node('span', 'beat', 'beat'));
            const l = node('span', 'lost');
            l.appendChild(U().nameLink(loser.name, o.onOpenProfile));
            l.appendChild(raceMark(loser.race));
            line.appendChild(l);
            head.appendChild(line);
          } else {
            // No readable winner, or more than two seats. Name everybody and
            // claim nothing.
            const line = node('span', 'verdict-vs vs-symmetric');
            slots.forEach((s, i) => {
              if (i) line.appendChild(node('span', 'beat', 'v'));
              const cell = node('span');
              cell.appendChild(U().nameLink(summary.players[s].name, o.onOpenProfile));
              cell.appendChild(raceMark(summary.players[s].race));
              line.appendChild(cell);
            });
            head.appendChild(line);
          }
        } else {
          // Reasons a game has no verdict, with different fixes. Collapsing
          // them into "Result unclear" sends people hunting a parser bug when
          // the real answer is "you never said who you are".
          //
          // A team game gets NO placeholder: the meta line already says
          // "3v3", and a sentence explaining that team games carry no result
          // was the loudest thing on a screen it explained nothing about.
          const result = v && v.result ? v.result : 'none';
          let unresolved = null;
          if (!o.identityName) unresolved = 'Tell WC3V who you are to score this';
          else if (summary.gameMode === '1v1') unresolved = 'Could not tell who won';

          if (result !== 'none' || unresolved) {
            const word = node('span', 'verdict-word',
              result === 'win' ? 'Victory' : result === 'loss' ? 'Defeat' : unresolved);
            word.dataset.v = result;
            head.appendChild(word);
          }

          if (v && v.opponent) {
            const vs = node('span', 'verdict-vs');
            vs.appendChild(node('span', null, 'vs '));
            vs.appendChild(U().nameLink(v.opponent.name, o.onOpenProfile));
            vs.appendChild(raceMark(v.opponent.race));
            head.appendChild(vs);

            // The record chip. No website can show this number, because it came
            // out of your own games. Clicking it opens their book in Coach,
            // where it is read against their whole history.
            if (h2h) {
              const chip = node('button', 'h2h-chip', `${h2h.wins}–${h2h.losses} all time`);
              chip.type = 'button';
              chip.title = `Your record against ${v.opponent.name}. Opens their book.`;
              chip.addEventListener('click', () => o.onOpenProfile && o.onOpenProfile(v.opponent.name));
              head.appendChild(chip);
            }
          }
        }

        main.appendChild(head);

        // Map, races, length. One line, and it has to stay one line at 612px.
        const meta = node('p', 'detail-meta');
        if (symmetric) {
          const a = summary.players[slots[0]];
          const b = slots[1] && summary.players[slots[1]];
          if (a) meta.appendChild(matchupMarks(a.race, b && b.race));
        } else if (v) {
          meta.appendChild(matchupMarks(v.race, v.opponent && v.opponent.race));
        }
        const bits = [mapName(summary), fmtDur(summary.durationMs)];
        if (summary.gameMode && summary.gameMode !== '1v1') bits.push(summary.gameMode);
        meta.appendChild(node('span', null, bits.join(' · ')));

        // The folder the replay sits in, as the person labelled it. Same chip
        // shape as a tag, since it is a label they chose, but it is read-only
        // here: folders are renamed in Settings, where the whole tree is.
        if (o.folderLabel) {
          const chip = node('span', 'tag tag-folder', o.folderLabel);
          chip.title = 'Replay folder';
          meta.appendChild(chip);
        }

        // Tags ride the fact line rather than getting a row of their own. Most
        // games have none, and a permanently empty band is furniture.
        const tags = tagStrip();
        if (tags) meta.appendChild(tags);
        main.appendChild(meta);

        grid.appendChild(main);
        const bench = benchStrip();
        if (bench) grid.appendChild(bench);
        wrap.appendChild(grid);
        return wrap;
      };

      // Own seat first, everywhere a per-player grid renders. It is the column
      // being read. Symmetric has no such column, so slot order stands.
      const slotsFor = () => {
        const slots = Object.keys(summary.players || {});
        if (symmetric) return slots;
        slots.sort((a, b) => (a === seat ? -1 : b === seat ? 1 : 0));
        return slots;
      };

      const titleFor = (p, slot) =>
        playerTitle(p, { isYou: !symmetric && slot === seat, onOpenProfile: o.onOpenProfile });

      // ── The Build tab: the cards, then the order ────────────────────────
      //
      // What the three shared tabs do NOT cover. Army shows units and buildings
      // grouped by tier and Economy shows what was bought, but neither shows a
      // build in the order it happened, and nothing anywhere else shows a
      // player's whole build as one card.
      //
      // "Buildings by tier" and "Upgrades and mercenaries" used to live here
      // and are gone: the Army and Economy tabs are those sections, drawn from
      // the same data by the shared renderer.
      const reportPanel = () => {
        const panel = node('section', 'report-pane');
        const stale = o.isStale ? o.isStale(summary) : false;
        const slots = slotsFor();
        const team = slots.length > TEAM_THRESHOLD;

        const grid = node('div', 'bc-grid' + (team ? ' is-compact' : ''));
        for (const slot of slots) {
          const p = summary.players[slot];
          grid.appendChild(window.BuildCard.build(p, {
            icon: buildIcon,
            title: titleFor(p, slot),
            compact: team
          }));
        }
        panel.appendChild(grid);

        const staleRow = () => {
          const row = node('div', 'row');
          row.appendChild(node('p', 'hint', 'Parsed under an older format.'));
          row.appendChild(reparseBtn('Re-read'));
          return row;
        };

        // Everything below is the per-player record, and it is 1v1 only.
        if (team) {
          if (stale) panel.appendChild(staleRow());
          return panel;
        }

        // ── Build order ───────────────────────────────────────────────────
        // ONE chronology, both players interleaved, each row wearing its
        // player's race ink and the reader's own rows at full ink. It reads
        // as the game's actual sequence — "he made his altar while I was
        // still on the mill" — instead of two parallel lists the reader has
        // to zip by eye. Was two columns per player until the Aug 2026
        // mock round.
        panel.appendChild(sectionHead('time', 'Build order'));
        const merged = [];
        for (const slot of slots) {
          const p = summary.players[slot];
          for (const b of (p.buildPreview || [])) {
            merged.push({ b, slot, race: p.race, mine: !symmetric && slot === seat });
          }
        }
        merged.sort((x, y) => (x.b.gameTimeMs || 0) - (y.b.gameTimeMs || 0));
        const list = node('ul', 'build-list build-merged');
        if (!symmetric) list.classList.add('has-mine');
        for (const { b, slot, race, mine } of merged) {
          const li = node('li');
          li.dataset.type = b.type || '';
          if (race) li.dataset.race = race;
          if (mine) li.dataset.mine = '1';
          li.appendChild(node('span', 't', b.gameTimeFormatted || ''));
          li.appendChild(node('span', 'who',
            String((summary.players[slot].name || '?')).replace(/#.*$/, '').slice(0, 10)));
          li.appendChild(buildIcon(b.itemId));
          li.appendChild(node('span', 'n', b.name || ''));
          list.appendChild(li);
        }
        if (!list.children.length) panel.appendChild(node('p', 'hint', 'No build recorded.'));
        else panel.appendChild(list);

        if (stale) panel.appendChild(staleRow());
        return panel;
      };

      // ── The shared screen ───────────────────────────────────────────────
      //
      // Three tabs drawn by client/js/MatchSummaryView.js, the viewer's own
      // Match Summary. This file supplies the model (js/summary-model.js), the
      // icon resolver and the teardown, and draws none of it.
      //
      // Art is fetched from the CDN by id, which is why the resolver is injected
      // rather than the renderer holding a base URL. `asset` is separate because
      // the combat-type marks are file names with mixed extensions rather than
      // item ids.
      const viewOpts = () => ({
        icon: buildIcon,
        asset: (file) => U().ICON_BASE + file,
        // The Overview tab leaves a slot; mountDominance fills it below.
        wantsDominance: !!(window.DominancePanel &&
          !window.DominancePanel.unavailable(summary)),
        // Same arrangement for the creep-route map: Overview and Economy each
        // leave a slot, mountRoute fills it.
        wantsRoute: !!(window.CreepRouteMap &&
          !window.CreepRouteMap.unavailable(summary))
      });

      const model = window.SummaryModel
        ? window.SummaryModel.build(summary, symmetric ? null : seat)
        : null;

      // Said in full, once, where the tabs would have been. `unavailable()`
      // separates the two cases that need different words: a summary stored
      // before schema v5 is fixed by re-reading it, and a summary stored under
      // v5 that still has no build block will not be.
      const upgradeNotice = () => {
        const reason = window.SummaryModel
          ? window.SummaryModel.unavailable(summary)
          : 'The match summary is unavailable in this build.';
        const row = node('div', 'st-upgrade');
        if (reason === 'stale') {
          row.appendChild(node('p', 'hint',
            'This game was read before the match summary existed. ' +
            'Re-read it for the unit roster, the creep route, the upgrades and the charts.'));
          if (o.onReparse) row.appendChild(reparseBtn('Re-read this game'));
        } else {
          row.appendChild(node('p', 'hint', reason || 'No match summary for this game.'));
        }
        return row;
      };

      // Live handles that outlast a tab switch, because each registers a
      // ResizeObserver and none is released by dropping its node.
      let domHandle = null;
      let cp = null;
      let routeHandle = null;

      const mountDominance = (host) => {
        const slot = host.querySelector('.ms-dom-slot');
        if (!slot || !window.DominancePanel) return;
        if (domHandle && domHandle.destroy) {
          try { domHandle.destroy(); } catch (e) { /* already gone */ }
        }
        // The scrubbable panel, not a bare chart. This is the "1:1 plus"
        // part: the viewer draws the plot static because it has playback of
        // its own, and a finished game has nothing left to spoil, so here
        // dragging it replays the momentum and a double-click opens the
        // viewer at that moment.
        domHandle = window.DominancePanel.build(summary, seat, { onWatch: o.onWatch });
        if (domHandle) slot.appendChild(domHandle.chart);
      };

      // Both players' creep routes, on the map they were walked on.
      //
      // The map image comes straight off the CDN as an <img>, which the app's
      // CSP already permits (img-src includes cdn.wc3v.com) — the same route
      // every unit portrait on this screen takes.
      //
      // Nothing is FETCHED: connect-src does not include the CDN, so the
      // neutral-building layer the site overlays is deliberately absent here.
      // Gold mines and shops are already drawn on the minimap art itself; the
      // site's overlay sharpens them, and the route reads without it.
      const mountRoute = (host) => {
        const slot = host.querySelector('.ms-route-slot');
        if (!slot || !window.CreepRouteMap) return;
        if (routeHandle && routeHandle.destroy) {
          try { routeHandle.destroy(); } catch (e) { /* already gone */ }
        }
        routeHandle = window.CreepRouteMap.build(summary, {
          size: parseInt(slot.dataset.size, 10) || 340,
          // A total per player and the contested count. The levels/first/XP
          // lines belong to the site's compare drawer, where measuring your
          // clear against somebody else's is the whole job; here they are
          // three extra lines nobody asked the map for.
          detail: 'camps',
          colorFor: (slotKey) => {
            const p = model.players.find(x => x.slot === slotKey);
            return (p && p.color) || '#8a8378';
          },
          // The stored summary carries raw battle tags; every other name on this
          // screen is the model's cleaned one.
          nameFor: (slotKey) => {
            const p = model.players.find(x => x.slot === slotKey);
            return p ? p.name : null;
          },
          mapAsset: (folder, file) =>
            `${U().MAP_BASE}${encodeURIComponent(folder)}/${file}`
        });
        if (routeHandle) slot.appendChild(routeHandle.el);
      };

      // The desktop's own Resources and Army plots, under the shared four at
      // the foot of the Economy tab. Dominance is omitted from the chips
      // because the Overview band carries it, and two dominance plots on one
      // screen is a question about which one is right.
      //
      // This used to hang off a Charts tab. Charts was folded into Economy
      // when the six tabs became three; the panel follows the charts it
      // belongs beside rather than getting a tab of its own back.
      const chartsPanel = (content) => {
        if (!window.ChartPanel) return content;
        if (cp && cp.destroy) { try { cp.destroy(); } catch (e) { /* already gone */ } }
        cp = window.ChartPanel.build(summary, seat, {
          onWatch: o.onWatch,
          onReparse: (label) => reparseBtn(label),
          omit: ['dominance']
        });
        if (cp) content.appendChild(cp.el);
        return content;
      };

      // ── Mount ───────────────────────────────────────────────────────────
      //
      // The frame is one row: the tab strip on the left, Open in WC3V Viewer
      // on the right. The tabbar renders for EVERY game — including one the
      // renderer cannot draw, where the tabs are absent but the viewer button
      // is not, because that button is the single most important control on
      // the screen and none of what it needs comes from the missing block.
      const tabbar = node('div', 'report-tabbar');
      const strip = node('div', 'ms-tabs');

      const body = node('div', 'report-body scroll');

      // ── A game the renderer cannot draw shows NOTHING but the reason ─────
      //
      // Not a partial report. A summary stored under an older schema still has
      // enough in it to draw build cards and a build order, and drawing them
      // was the obvious kindness — but the result is a report that looks
      // complete and silently omits the roster, the creep route, the upgrades
      // and every chart. A reader cannot tell that screen from a game where
      // those things genuinely did not happen.
      //
      // So: the header (result, map, length — none of which comes from the
      // missing block) and the reason. The data is not gone; it is one
      // re-read away, and the app is usually already doing it.
      if (!model) {
        tabbar.appendChild(viewerButton());
        host.appendChild(tabbar);
        body.appendChild(overviewHeader());
        body.appendChild(upgradeNotice());
        host.appendChild(body);
        return { destroy () {} };
      }

      const TABS = window.MatchSummaryView.TABS.concat([{ key: 'build', label: 'Build' }]);

      let active = TABS.some(t => t.key === lastTab) ? lastTab : TABS[0].key;

      const showTab = (key) => {
        active = key;
        lastTab = key;
        for (const btn of strip.children) {
          const on = btn.dataset.tab === key;
          btn.classList.toggle('ms-tab-active', on);
          btn.setAttribute('aria-selected', String(on));
        }
        body.innerHTML = '';
        if (key === 'build') { body.appendChild(reportPanel()); return; }

        const content = node('div', 'ms-tab-content');
        const rendered = window.MatchSummaryView.render(key, model, viewOpts());
        if (rendered) content.appendChild(rendered);
        if (key === 'overview') {
          // The header rides the ov-band's right column, over the tier bars,
          // beside the dominance plot: the result and the shape of the game
          // in one glance, and it scrolls with the tab instead of taxing
          // every other tab's frame. A band-less game (no shared render,
          // never on this path) would take the row form instead.
          const band = content.querySelector('.ms-ov-band');
          const hdr = overviewHeader();
          if (band) { hdr.classList.add('ov-in-band'); band.appendChild(hdr); }
          else content.insertBefore(hdr, content.firstChild);
        }
        if (key === 'economy') chartsPanel(content);
        body.appendChild(content);
        if (key === 'overview') mountDominance(content);
        // After the append: the canvas sizes itself against devicePixelRatio and
        // checks isConnected before painting.
        mountRoute(content);
      };

      if (TABS.length > 1) {
        strip.setAttribute('role', 'tablist');
        for (const t of TABS) {
          const btn = node('button', 'ms-tab', t.label);
          btn.type = 'button';
          btn.dataset.tab = t.key;
          btn.setAttribute('role', 'tab');
          btn.addEventListener('click', () => showTab(t.key));
          strip.appendChild(btn);
        }
        tabbar.appendChild(strip);
      }
      tabbar.appendChild(viewerButton());
      // Above .report-body, so the row is part of the fixed frame and the
      // fold rule still has exactly one scroller.
      host.appendChild(tabbar);

      host.appendChild(body);
      showTab(active);

      return {
        destroy () {
          // Each holds a ResizeObserver (chart-panel keeps parked modes alive
          // too), so dropping the node is not enough.
          if (cp && cp.destroy) { try { cp.destroy(); } catch (e) { /* already gone */ } }
          if (domHandle && domHandle.destroy) {
            try { domHandle.destroy(); } catch (e) { /* already gone */ }
          }
          if (routeHandle && routeHandle.destroy) {
            try { routeHandle.destroy(); } catch (e) { /* already gone */ }
          }
          cp = null;
          domHandle = null;
          routeHandle = null;
        }
      };
    }
  };
})();
