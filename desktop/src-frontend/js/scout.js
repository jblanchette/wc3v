// Who you are playing right now, and what your own games say about them.
//
// A replay cannot answer this. It only exists after the match, and by then the
// question has been settled. W3Champions publishes the ongoing match for a
// battle tag, so the app can put the opponent on screen while the loading
// screen is still up.
//
// The ladder half is the hook. The half nobody else has is the book: the record
// and the habits come from games on this machine, so the panel says things no
// website could tell you about this particular opponent.
//
// This module renders nothing. It polls, reads the corpus, and hands the answer
// to onMatch. games-view.js draws it as a mode of the report column, which is
// what stops it reading as a band bolted onto the top of the screen.
//
// Polling stops the moment the feature is switched off, the identity has no
// battle tag, or nobody can see the answer. A failed lookup clears the panel
// and says nothing.
//
// "Nobody can see the answer" is NOT the same as "the window is hidden", which
// is what this used to test. Closing WC3V hides it to the tray — that is what
// the close button does, and what autostart-at-login does — so a streamer who
// starts the app and gets it out of the way had the live match card freeze on
// their broadcast for the entire session. The overlay is a second consumer that
// outlives the window, and `watched()` is the question that covers both.

(function () {
  'use strict';

  const PA = () => window.ProfileAggregate;

  // Between games. Queue times are minutes, so this is fast enough to catch a
  // match before the loading screen ends.
  const IDLE_MS = 20000;
  // A match is already on screen. All this catches now is the match ending
  // without a replay landing, which happens on a disconnect.
  const LIVE_MS = 60000;

  window.createScout = (deps) => {
    // deps: w3c, store, identityName(), watched(), log,
    //       onMatch(match, ladder, book) with null for "no live match"
    //       onLadder(mine) with your own rank, mmr and climb, or null

    let timer = null;
    let match = null;
    // Ladder stats per battle tag, for this session. Rank does not move during
    // a game.
    const stats = new Map();

    const statsFor = async (tag) => {
      if (stats.has(tag)) return stats.get(tag);
      const s = await deps.w3c.stats(tag);
      stats.set(tag, s);
      return s;
    };

    // Your own standing, and how far it has moved since the app opened. Rank
    // and MMR are what every ladder stream puts on screen, and the climb is the
    // part that makes a session worth watching rather than a scoreboard.
    //
    // Deliberately not on the `stats` cache, which never expires: this is the
    // one tag whose numbers change while the app is running. Refreshed only
    // when the match state flips rather than on every tick, because MMR moves
    // when a game ends, so it costs two lookups a game and the idle poll stays
    // a single request.
    let mine = null;
    let openedAt = null;
    // Which tag the two above describe. A seat change makes them somebody
    // else's numbers, and a climb measured from a different player's MMR is a
    // wrong number rather than a missing one.
    let mineTag = null;

    const refreshMine = async (tag) => {
      if (tag !== mineTag) {
        mineTag = tag;
        openedAt = null;
        mine = null;
      }
      const s = await deps.w3c.stats(tag);
      if (!s || s.mmr === null) return;
      if (openedAt === null) openedAt = s.mmr;
      mine = { rank: s.rank, mmr: s.mmr, climb: s.mmr - openedAt };
      deps.onLadder(mine);
    };

    // What this machine knows about them. Returns null when they have never
    // been played, which the panel says outright.
    //
    // The ladder always has a full battle tag. A stored summary carries
    // whatever the replay wrote, which for a W3Champions game is the tag and
    // for anything else is the bare name, so both get tried.
    const bookOn = (opp, myRace, mapName) => {
      const corpus = deps.store.corpus;
      const me = deps.identityName();
      if (!corpus || !corpus.length || !me) return null;

      let p = PA().buildProfile(corpus, opp.tag);
      if (!p.games) p = PA().buildProfile(corpus, opp.name);
      if (!p.games) return null;

      const meKey = PA().normName(me);
      const oppKey = PA().normName(p.name);
      const seen = p.opponents.find(o => PA().normName(o.name) === meKey);
      // Their record against me, read back from my side.
      const h2h = seen ? { games: seen.games, wins: seen.losses, losses: seen.wins } : null;

      // Their habits in the exact matchup about to be played.
      const mu = opp.race && myRace
        ? p.matchups.find(m => m.matchup === `${opp.race}v${myRace}`)
        : null;

      // Their tier 2 against my own, so the number has something to mean.
      const medianOf = (t) => {
        if (!t) return null;
        const v = t.winMedian !== null && t.winMedian !== undefined ? t.winMedian : t.lossMedian;
        return v === undefined ? null : v;
      };
      const mine = PA().buildProfile(corpus, me);
      const myMu = myRace && opp.race
        ? mine.matchups.find(m => m.matchup === `${myRace}v${opp.race}`)
        : null;

      // Every game the two of us have played, newest first, for the list.
      const shared = corpus.filter((g) => {
        const names = Object.values(g.players || {}).map(x => PA().normName(x.name));
        return names.indexOf(meKey) !== -1 && names.indexOf(oppKey) !== -1;
      });

      return {
        name: p.name,
        profileGames: p.games,
        h2h,
        recentForm: p.recentForm,
        matchup: mu ? { key: mu.matchup, games: mu.games } : null,
        // Capped at three. An unbounded list in a fixed band breaks the fold.
        openers: mu ? mu.openings.slice(0, 3) : [],
        t2Them: mu ? medianOf(mu.t2) : null,
        t2ThemN: mu ? mu.t2.winN + mu.t2.lossN : 0,
        t2You: myMu ? medianOf(myMu.t2) : null,
        expansionRate: p.habits ? p.habits.expansionRate : null,
        // Your own record on the map about to be played. Knowable without them.
        yourMap: mapName && mine.maps
          ? mine.maps.find(m => m.map === mapName) || null
          : null,
        shared
      };
    };

    // This module owns no DOM. It polls, it reads the local corpus, and it
    // hands the answer to whoever asked. The report column renders it, so the
    // live opponent reads as a section of the product rather than a band
    // floating above one.
    const clear = () => {
      const had = !!match;
      match = null;
      if (had) deps.onMatch(null);
    };

    const tick = async () => {
      const me = deps.identityName();
      if (!deps.w3c.enabled || !deps.w3c.isTag(me)) {
        clear();
        return;
      }
      // Hidden to the tray AND not on a broadcast. Leave whatever is on screen
      // alone and wait.
      if (!(await deps.watched())) return;

      // First look of the session, so the climb has a zero to count from.
      //
      // Gated on having ASKED, not on having an answer. A tag with no ladder
      // record answers null forever, and gating on the result would put a
      // second request on every idle poll for the rest of the session.
      if (mineTag !== me) await refreshMine(me).catch(() => {});

      const found = await deps.w3c.ongoing(me);
      if (!found) {
        if (match) {
          // A game just ended. This is the one moment your own MMR moves.
          clear();
          await refreshMine(me).catch(() => {});
        }
        return;
      }
      // Same match, already drawn.
      if (match && found.id && match.id === found.id) return;

      match = found;
      const opp = found.opponents[0];
      const ladder = await statsFor(opp.tag);
      const book = found.opponents.length === 1
        ? bookOn(opp, found.me.race, found.map)
        : null;
      // A second tick may have cleared it while the stats call was in flight.
      if (!match || match.id !== found.id) return;
      deps.onMatch(found, ladder, book);
      deps.log(`live game against ${opp.name}`, 'ok');
    };

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        await tick().catch(() => {});
        schedule();
      }, match ? LIVE_MS : IDLE_MS);
    };

    return {
      start () {
        clearTimeout(timer);
        tick().catch(() => {});
        schedule();
      },
      stop () {
        clearTimeout(timer);
        timer = null;
        clear();
      },
      // The stored history finished loading. A card drawn before that said
      // "first time against them" about somebody with a record.
      refresh () {
        if (!timer) return;
        match = null;
        tick().catch(() => {});
      },
      // The watcher just picked up a finished replay, so whatever was live is
      // over and the report below is the better thing to look at.
      dismiss: clear
    };
  };
})();
