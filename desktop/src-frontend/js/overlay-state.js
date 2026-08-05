// Overlay state: session W/L/streak plus the last finished game, published to
// the Rust loopback server, which relays it to OBS over SSE. (ROADMAP §4)
//
// Raw summaries get kept and views derived at publish time, so changing the
// profile name re-orients past session games instead of freezing verdicts
// computed under the old name. Only live games enter the session, meaning ones
// the watcher caught while the app was running. A streamer browsing old
// replays must never scramble their on-stream score.

(function () {
  'use strict';

  // A stream ticker has to be glanceable. Five lines is already pushing it at
  // broadcast distance.
  const OVERLAY_MOMENTS = 5;

  window.createOverlayState = (deps) => {
    // deps: invoke, log, corpus(), the stored history used for head-to-head
    const PA = window.ProfileAggregate;
    const st = {
      userName: localStorage.getItem('wc3v-user-name') || null,
      session: [],    // summaries of live games, in arrival order
      lastGame: null, // summary shown in the game panel (live only, or boot seed)
      demo: false     // showing the labelled stand-in game for OBS setup
    };

    // Orient a summary from the profile player's seat. When they are not in
    // the game at all, from observing or a smurf name, fall back to the first
    // seat so the overlay still shows it, with an 'unknown' verdict.
    const viewFor = (summary) => {
      if (!summary) return null;
      if (st.userName) {
        const v = PA.gameView(summary, PA.normName(st.userName));
        if (v) { v.mine = true; return v; }
      }
      const firstSlot = Object.keys(summary.players || {})[0];
      if (firstSlot === undefined) return null;
      const v = PA.gameView(summary, PA.normName(summary.players[firstSlot].name));
      // `mine` stops the fallback seat being read as the user's. Without it the
      // overlay narrates a stranger's game in the first person: "you lost 2
      // heroes" under a card that cannot name a winner.
      if (v) { v.result = null; v.mine = false; }
      return v;
    };

    const streakOf = (views) => {
      let kind = null;
      let count = 0;
      for (let i = views.length - 1; i >= 0; i--) {
        const r = views[i] && views[i].result;
        if (!r) continue;
        if (!kind) kind = r;
        if (r !== kind) break;
        count++;
      }
      return kind ? { kind, count } : null;
    };

    // The same numbers the overlay shows, for the app bar. Derived rather than
    // stored, so the two can never drift.
    const sessionSummary = () => {
      const views = st.session.map(viewFor).filter(Boolean);
      return {
        games: views.length,
        wins: views.filter(v => v.result === 'win').length,
        losses: views.filter(v => v.result === 'loss').length,
        streak: streakOf(views)
      };
    };

    // Head-to-head against the player in the last game, from local history. No
    // website could tell a streamer this, because it was learned from their own
    // games.
    //
    // Counted over the whole corpus. "You're 3–2 against this guy all time" is
    // the interesting number, and the session module already carries today's.
    const h2hFor = (summary, v) => {
      if (!v || !v.opponent || !st.userName) return null;
      const corpus = deps.corpus && deps.corpus();
      if (!corpus || !corpus.length) return null;

      const meKey = PA.normName(st.userName);
      const oppKey = PA.normName(v.opponent.name);
      let wins = 0;
      let losses = 0;
      let games = 0;
      for (const g of corpus) {
        const names = Object.values(g.players || {}).map(p => PA.normName(p.name));
        if (names.indexOf(meKey) === -1 || names.indexOf(oppKey) === -1) continue;
        games++;
        const mine = PA.gameView(g, meKey);
        if (mine && mine.result === 'win') wins++;
        else if (mine && mine.result === 'loss') losses++;
      }
      if (!games) return null;
      return { name: v.opponent.name, games, wins, losses };
    };

    // Moments get phrased here, where the user's seat is known, so the overlay
    // stays a pure consumer and the app and the broadcast word the same fight
    // the same way.
    const momentsFor = (summary, v) => {
      const list = (summary && summary.moments) || [];
      if (!list.length || !window.MomentsExtract) return [];
      const nameFor = (slot) => (summary.players[slot] && summary.players[slot].name) || 'They';
      const seat = v && v.mine ? v.slot : null;
      return list
        .slice()
        .sort((a, b) => b.importance - a.importance)
        .slice(0, OVERLAY_MOMENTS)
        .sort((a, b) => a.t - b.t)
        .map(m => ({
          time: m.tf,
          text: window.MomentsExtract.phrase(m, seat, nameFor),
          hero: m.type === 'heroKill' || m.type === 'heroTrade' || m.type === 'heroLostToCreeps'
        }));
    };

    // The one-line read of a game, from the same grader the Review tab uses.
    // Only ever claimed for the user's own seat. "Economy lagged" said about a
    // stranger's game that the overlay is showing as a fallback would judge
    // somebody who is not there.
    const readFor = (summary, v) => {
      if (!summary || !v || !v.mine || !window.GameReport) return null;
      const corpus = deps.corpus && deps.corpus();
      const base = corpus && corpus.length
        ? PA.baseline(corpus, st.userName, { matchup: v.matchup, excludeKey: summary.key })
        : null;
      const report = window.GameReport.grade(summary, v.slot, base);
      return report ? report.headline : null;
    };

    const gamePayload = () => {
      const v = viewFor(st.lastGame);
      if (!v) return null;
      const me = st.lastGame.players[v.slot] || {};
      return {
        // Stable identity of the game being shown. The overlay's reveal mode
        // needs to tell "a new game finished" from "the same game published
        // again" (an identity change or a reconnect republishes everything),
        // and a timestamp cannot: every publish has a new one.
        gameId: st.lastGame.key || null,
        // The same sentence the app's Review tab shows. One wording source
        // feeds the window, the toast and the broadcast.
        read: readFor(st.lastGame, v),
        // The display name. The stored `map` is
        // "12_w3c_251104_0950_TurtleRock_v2.0.w3x", which nobody should put on
        // a broadcast.
        map: window.SummaryExtract.cleanMapName(st.lastGame.mapRaw || v.map) || v.map,
        mode: v.mode,
        h2h: h2hFor(st.lastGame, v),
        moments: momentsFor(st.lastGame, v),
        verdict: v.result || 'unknown',
        durationMs: v.durationMs,
        user: { name: v.name, race: v.race },
        opponent: v.opponent,
        heroOpener: v.heroOpener,
        timings: {
          t2: v.t2 !== null ? PA.fmtMs(v.t2) : null,
          t3: v.t3 !== null ? PA.fmtMs(v.t3) : null,
          expansion: v.expansion !== null ? PA.fmtMs(v.expansion) : null,
          firstTower: v.firstTower !== null ? PA.fmtMs(v.firstTower) : null
        },
        build: (me.buildPreview || []).slice(0, 12).map(b => ({
          type: b.type,
          name: b.name,
          time: b.gameTimeFormatted
        }))
      };
    };

    // The one-sentence version of a game, for the desktop notification.
    //
    // It lives here next to the overlay's phrasing for the same reason the
    // moments do: the toast, the app and the broadcast must never word the same
    // game differently. Returns null when there is nothing worth interrupting
    // anyone for, since an unreadable seat says nothing useful.
    const toastFor = (summary) => {
      const v = viewFor(summary);
      if (!v) return null;

      const opp = v.opponent && v.opponent.name;
      const title = v.result === 'win' ? (opp ? `Victory vs ${opp}` : 'Victory')
        : v.result === 'loss' ? (opp ? `Defeat vs ${opp}` : 'Defeat')
          : 'Game finished';

      const map = window.SummaryExtract.cleanMapName(summary.mapRaw || v.map) || v.map;
      const line = [map, PA.fmtMs(v.durationMs)].filter(Boolean).join(' · ');

      const h2h = h2hFor(summary, v);
      const record = h2h ? `all time ${h2h.wins}–${h2h.losses}` : '';

      // The single biggest beat, phrased from the user's seat. Taken off the
      // ranked list rather than momentsFor(), which re-sorts its top five into
      // time order for the overlay. Reading [0] off that gives the earliest of
      // the five.
      const ranked = ((summary && summary.moments) || [])
        .slice()
        .sort((a, b) => b.importance - a.importance);
      let beat = null;
      if (ranked.length && window.MomentsExtract) {
        const nameFor = (slot) =>
          (summary.players[slot] && summary.players[slot].name) || 'They';
        const seat = v.mine ? v.slot : null;
        beat = {
          time: ranked[0].tf,
          text: window.MomentsExtract.phrase(ranked[0], seat, nameFor)
        };
      }

      // The read goes on the toast too. "You won" is the headline. "Economy
      // lagged" is the reason to open the app.
      const read = readFor(summary, v);

      return {
        title,
        body: [line, record].filter(Boolean).join(' · ') +
          (read ? `\n${read}` : '') +
          (beat ? `\n${beat.time} ${beat.text}` : '')
      };
    };

    // Human players in a summary, the candidates for "which one is you".
    const candidatesIn = (summary) => Object.keys(summary && summary.players || {})
      .map(k => summary.players[k].name)
      .filter(Boolean);

    const buildPayload = () => {
      const views = st.session.map(viewFor).filter(Boolean);
      return {
        updatedAt: Date.now(),
        user: st.userName,
        // Without an identity no verdict can be attributed to a seat, so the
        // overlay says so instead of showing a bare "Game over" forever.
        needsIdentity: !st.userName,
        candidates: st.userName ? [] : candidatesIn(st.lastGame),
        session: {
          wins: views.filter(v => v.result === 'win').length,
          losses: views.filter(v => v.result === 'loss').length,
          unknown: views.filter(v => !v.result).length,
          streak: streakOf(views)
        },
        game: gamePayload()
      };
    };

    const send = async (payload) => {
      try {
        await deps.invoke('publish_overlay_state', { stateJson: JSON.stringify(payload) });
      } catch (e) {
        deps.log(`overlay publish failed: ${(e && e.message) || e}`, 'warn');
      }
    };

    const publish = async () => {
      st.demo = false;
      await send(buildPayload());
    };

    // A stand-in game, so a streamer can size and position the Browser Source
    // in OBS before ever playing one. It is labelled on the overlay itself,
    // because an unlabelled fake result on a live stream is indefensible.
    const DEMO = {
      updatedAt: 0,
      user: 'You',
      demo: true,
      needsIdentity: false,
      candidates: [],
      session: { wins: 2, losses: 1, unknown: 0, streak: { kind: 'win', count: 2 } },
      game: {
        gameId: 'demo',
        map: 'Echo Isles',
        mode: '1v1',
        verdict: 'win',
        read: 'Hero play led it; economy lagged.',
        durationMs: 14 * 60 * 1000,
        user: { name: 'You', race: 'H' },
        opponent: { name: 'Opponent', race: 'O' },
        heroOpener: 'Archmage',
        timings: { t2: '5:40', t3: null, expansion: '9:41', firstTower: null },
        h2h: { name: 'Opponent', games: 5, wins: 3, losses: 2 },
        moments: [
          { time: '6:12', text: 'You expanded', hero: false },
          { time: '8:42', text: 'You killed Blademaster', hero: true },
          { time: '11:58', text: 'Fight at the expansion, you came out ahead', hero: false }
        ],
        build: [
          { type: 'building', name: 'Altar of Kings', time: '0:12' },
          { type: 'building', name: 'Barracks', time: '0:31' },
          { type: 'hero', name: 'Archmage', time: '1:05' },
          { type: 'unit', name: 'Footman', time: '1:22' },
          { type: 'expansion', name: 'Town Hall', time: '6:12' }
        ]
      }
    };

    return {
      publish,
      sessionSummary,
      toastFor,
      // What the OBS source is showing right now, for the in-window preview.
      previewState: () => (st.demo ? DEMO : buildPayload()),
      async publishDemo () {
        st.demo = true;
        await send(DEMO);
      },
      get isDemo () { return !!st.demo; },
      recordGame (summary) {
        st.session.push(summary);
        st.lastGame = summary;
        publish();
      },
      // Boot seeding. Show the most recent stored game instead of an empty
      // card, without letting it count toward the session score.
      seedLastGame (summary) {
        if (st.lastGame || !summary) return;
        st.lastGame = summary;
        publish();
      },
      setUserName (name) {
        st.userName = (name || '').trim() || null;
        if (st.userName) localStorage.setItem('wc3v-user-name', st.userName);
        publish();
      },
      get userName () { return st.userName; },
      // Names in the most recent game, for the "which one are you" prompt.
      get lastGameCandidates () { return candidatesIn(st.lastGame); }
    };
  };
})();
