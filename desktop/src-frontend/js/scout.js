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
// battle tag, or nobody can see the answer.
//
// A failed lookup used to clear the panel. It no longer does anything at all,
// which is the single most important rule in this file. w3c.ongoing now answers
// 'live' / 'none' / 'unknown', and only 'none' — the server saying so, twice in
// a row — ends a match. One five-second timeout is not a game ending.
//
// The other rule: a match id that has already ended cannot come back. The ladder
// keeps reporting a finished match for a little while after the replay has
// already been written to disk, and the app used to re-latch it and jump the
// report column off the game you just played onto a scouting panel for that same
// finished game. `ended` is what stops that.
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

  // How many times in a row the ladder has to say "no match" before a live card
  // comes down. Two, so a single clean-but-wrong answer during the seconds
  // around a game ending cannot flip the screen on its own. At LIVE_MS that is
  // about two minutes, and it only ever matters on a disconnect: a normal game
  // ends when its replay lands, which is immediate and does not wait for this.
  const MISSES_TO_CLEAR = 2;

  // A failed stats lookup used to be cached forever, so an opponent whose
  // request timed out once showed no rank for the rest of the session even if
  // you played them again. Successes still never expire — rank does not move
  // during a game.
  const MISS_TTL_MS = 120000;

  // How many finished match ids to remember. Only needs to outlive the window
  // where the ladder still reports a match whose replay is already on disk,
  // which is seconds; a handful covers a long session of back-to-back games.
  const ENDED_MAX = 16;

  const createScout = (deps) => {
    // deps: w3c, store, identityName(), watched(), log,
    //       onMatch(match, ladder, book) with null for "no live match"
    //       onLadder(mine) with your own rank, mmr and climb, or null

    let timer = null;
    let match = null;
    // Consecutive definite "no match" answers. Reset by anything else.
    let misses = 0;
    // Ids of matches known to be over. The ladder lags the replay write, so
    // without this the app re-latches a game it has already reported on.
    const ended = [];

    const isEnded = (id) => id !== null && id !== undefined && ended.indexOf(id) !== -1;
    const markEnded = (id) => {
      if (id === null || id === undefined || isEnded(id)) return;
      ended.push(id);
      if (ended.length > ENDED_MAX) ended.shift();
    };

    // Ladder stats per battle tag, for this session. Rank does not move during
    // a game.
    const stats = new Map();

    const statsFor = async (tag) => {
      const hit = stats.get(tag);
      // A miss is worth retrying later; an answer is not.
      if (hit && (hit.value !== null || Date.now() - hit.at < MISS_TTL_MS)) return hit.value;
      const s = await deps.w3c.stats(tag);
      stats.set(tag, { value: s, at: Date.now() });
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
        openedAt = null;
        mine = null;
      }
      const s = await deps.w3c.stats(tag);
      // Claimed only once the lookup came back. Setting it before the await made
      // a single failed first request permanent: `mineTag` already matched, so
      // the gate in tick() never fired again and the overlay had no rank or MMR
      // for the whole session.
      mineTag = tag;
      if (!s || s.mmr === null) return;
      // The climb baseline is where this session started, and it survives a
      // restart so a streamer who reopens the app mid-session keeps their real
      // number instead of dropping to +0.
      if (openedAt === null) {
        const saved = deps.readBaseline ? deps.readBaseline(tag) : null;
        openedAt = (typeof saved === 'number' && isFinite(saved)) ? saved : s.mmr;
        if (deps.writeBaseline) deps.writeBaseline(tag, openedAt);
      }
      mine = { rank: s.rank, mmr: s.mmr, climb: s.mmr - openedAt };
      deps.onLadder(mine);
    };

    // What this machine knows about them. Returns null when they have never
    // been played, which the panel says outright.
    //
    // The ladder always has a full battle tag. A stored summary carries
    // whatever the replay wrote, which for a W3Champions game is the tag and
    // for anything else is the bare name, so both get tried.
    // Three buildProfile passes plus a full-corpus filter with a nested
    // Object.values().map() per game. At a few thousand games that is a visible
    // hitch on the UI thread, and it lands at the exact moment the loading
    // screen is up. Memoized per opponent for the session; `refresh()` drops the
    // cache when the corpus changes underneath it.
    const books = new Map();
    const bookOn = (opp, myRace, mapName) => {
      const cacheKey = `${opp.tag}|${myRace || ''}|${mapName || ''}`;
      if (books.has(cacheKey)) return books.get(cacheKey);
      const built = buildBook(opp, myRace, mapName);
      books.set(cacheKey, built);
      return built;
    };

    const buildBook = (opp, myRace, mapName) => {
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
    // Take the live card down. `remember` is false only for a teardown that is
    // not a game ending (the feature being switched off), where recording the id
    // as finished would stop a real match being picked up on the way back.
    const clear = (remember) => {
      const had = match;
      if (had && remember !== false) markEnded(had.id);
      match = null;
      misses = 0;
      if (had) deps.onMatch(null);
    };

    const tick = async () => {
      const me = deps.identityName();
      if (!deps.w3c.enabled || !deps.w3c.isTag(me)) {
        clear(false);
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

      const res = (await deps.w3c.ongoing(me)) || { state: 'unknown', match: null };

      // Nobody answered. This is not information, and it must not move anything
      // — not the card, not the miss counter. The whole flapping problem was
      // this branch being indistinguishable from the one below it.
      if (res.state === 'unknown') return;

      if (res.state === 'none') {
        misses += 1;
        if (!match || misses < MISSES_TO_CLEAR) return;
        // A game ended without a replay landing, which means a disconnect. This
        // is also the one moment your own MMR moves.
        clear();
        await refreshMine(me).catch(() => {});
        return;
      }

      const found = res.match;
      misses = 0;

      // Already reported on. The ladder keeps serving a finished match for a
      // while after its replay has been written, and re-latching it here is what
      // used to throw the report column back onto a scouting panel for a game
      // the user had just finished reading about.
      if (isEnded(found.id)) return;

      // Same match, already drawn.
      if (match && found.id && match.id === found.id) return;

      match = found;
      const opp = found.opponents[0];
      const ladder = await statsFor(opp.tag);
      const book = found.opponents.length === 1
        ? bookOn(opp, found.me.race, found.map)
        : null;
      // A second tick, or a replay landing, may have moved on while the stats
      // call was in flight.
      if (!match || match.id !== found.id || isEnded(found.id)) return;
      deps.onMatch(found, ladder, book);
      deps.log(`live game against ${opp.name}`, 'ok');
    };

    // One tick in flight at a time. `start()` is called on every identity change
    // as well as from the settings toggle, and two overlapping ticks mutate the
    // same `match`.
    let running = false;
    const tickOnce = async () => {
      if (running) return;
      running = true;
      try { await tick(); } catch (e) { /* a poll must never throw */ }
      running = false;
    };

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        await tickOnce();
        schedule();
      }, match ? LIVE_MS : IDLE_MS);
    };

    return {
      // Awaited before scheduling, so the interval is chosen from what the tick
      // actually found rather than from the state it started in — which was
      // always IDLE_MS, even mid-game.
      async start () {
        clearTimeout(timer);
        await tickOnce();
        schedule();
      },
      stop () {
        clearTimeout(timer);
        timer = null;
        clear(false);
      },
      // The stored history finished loading. A card drawn before that said
      // "first time against them" about somebody with a record.
      //
      // Drops the book cache and re-reads the CURRENT match rather than nulling
      // it: clearing `match` here meant a game that ended during the corpus load
      // skipped the end-of-game branch entirely and stranded a live card on the
      // broadcast until the next match started.
      refresh () {
        if (!timer) return;
        books.clear();
        if (match) {
          const opp = match.opponents[0];
          const book = match.opponents.length === 1
            ? bookOn(opp, match.me.race, match.map)
            : null;
          deps.onMatch(match, stats.has(opp.tag) ? stats.get(opp.tag).value : null, book);
        }
        tickOnce();
      },
      // The watcher just picked up a finished replay, so whatever was live is
      // over and the report below is the better thing to look at. The id is
      // remembered, which is what stops the ladder handing it back.
      dismiss (matchId) {
        if (matchId !== undefined && matchId !== null) markEnded(matchId);
        clear();
      },
      // Testing seam for tools/lifecycle-sim.js.
      get liveMatch () { return match; }
    };
  };

  if (typeof window !== 'undefined') window.createScout = createScout;
  if (typeof module !== 'undefined' && module.exports) module.exports = { createScout };
})();
