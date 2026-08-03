// Overlay state — session W/L/streak plus the last finished game, published
// to the Rust loopback server, which relays it to OBS over SSE. (ROADMAP §4)
//
// Raw summaries are kept and views derived at publish time, so changing the
// profile name re-orients past session games instead of freezing verdicts
// computed under the old name. Only LIVE games (watcher-detected while the
// app runs) enter the session; clicking through history does not — a
// streamer browsing old replays must not scramble their on-stream score.

(function () {
  'use strict';

  window.createOverlayState = (deps) => {
    // deps: invoke, log
    const PA = window.ProfileAggregate;
    const st = {
      userName: localStorage.getItem('wc3v-user-name') || null,
      session: [],   // summaries of live games, in arrival order
      lastGame: null // summary shown in the game panel (live only, or boot seed)
    };

    // Orient a summary from the profile player's seat; if they are not in
    // the game (observing, smurf name), fall back to the first seat so the
    // overlay still shows the game — with an honest 'unknown' verdict.
    const viewFor = (summary) => {
      if (!summary) return null;
      if (st.userName) {
        const v = PA.gameView(summary, PA.normName(st.userName));
        if (v) return v;
      }
      const firstSlot = Object.keys(summary.players || {})[0];
      if (firstSlot === undefined) return null;
      const v = PA.gameView(summary, PA.normName(summary.players[firstSlot].name));
      if (v) v.result = null;
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

    const gamePayload = () => {
      const v = viewFor(st.lastGame);
      if (!v) return null;
      const me = st.lastGame.players[v.slot] || {};
      return {
        map: v.map,
        mode: v.mode,
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

    const publish = async () => {
      const views = st.session.map(viewFor).filter(Boolean);
      const payload = {
        updatedAt: Date.now(),
        user: st.userName,
        session: {
          wins: views.filter(v => v.result === 'win').length,
          losses: views.filter(v => v.result === 'loss').length,
          unknown: views.filter(v => !v.result).length,
          streak: streakOf(views)
        },
        game: gamePayload()
      };
      try {
        await deps.invoke('publish_overlay_state', { stateJson: JSON.stringify(payload) });
      } catch (e) {
        deps.log(`overlay publish failed: ${(e && e.message) || e}`, 'warn');
      }
    };

    return {
      publish,
      recordGame (summary) {
        st.session.push(summary);
        st.lastGame = summary;
        publish();
      },
      // Boot seeding: show the most recent stored game instead of an empty
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
      get userName () { return st.userName; }
    };
  };
})();
