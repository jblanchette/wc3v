// The scout card: who you are playing right now, and what your own games say
// about them.
//
// A replay cannot answer this. It only exists after the match, and by then the
// question has been settled. W3Champions publishes the ongoing match for a
// battle tag, so the app can put the opponent on screen while the loading
// screen is still up.
//
// The ladder half is the hook. The half nobody else has is underneath it: the
// record and the habits come from games on this machine, so the card says
// things no website could tell you about this particular opponent.
//
// Polling stops the moment the feature is switched off, the identity has no
// battle tag, or the window is hidden. A failed lookup clears the card and
// says nothing.

(function () {
  'use strict';

  const el = (id) => document.getElementById(id);
  const PA = () => window.ProfileAggregate;

  // Between games. Queue times are minutes, so this is fast enough to catch a
  // match before the loading screen ends.
  const IDLE_MS = 20000;
  // A match is already on screen. All this catches now is the match ending
  // without a replay landing, which happens on a disconnect.
  const LIVE_MS = 60000;

  const node = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  };

  window.createScout = (deps) => {
    // deps: w3c, store, identityName(), onOpenProfile(name), visible(), log

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

    // What this machine knows about them. Returns null when they have never
    // been played, which the card says outright.
    //
    // The ladder always has a full battle tag. A stored summary carries
    // whatever the replay wrote, which for a W3Champions game is the tag and
    // for anything else is the bare name, so both get tried.
    const bookOn = (opp, myRace) => {
      const corpus = deps.store.corpus;
      const me = deps.identityName();
      if (!corpus || !corpus.length || !me) return null;

      let p = PA().buildProfile(corpus, opp.tag);
      if (!p.games) p = PA().buildProfile(corpus, opp.name);
      if (!p.games) return null;

      const oppRace = opp.race;

      const meKey = PA().normName(me);
      const seen = p.opponents.find(o => PA().normName(o.name) === meKey);
      // Their record against me, read back from my side.
      const h2h = seen ? { games: seen.games, wins: seen.losses, losses: seen.wins } : null;

      const facts = [];
      const mu = oppRace && myRace
        ? p.matchups.find(m => m.matchup === `${oppRace}v${myRace}`)
        : null;

      const opener = mu && mu.openings.length ? mu.openings[0] : null;
      if (opener && opener.games >= 2) {
        facts.push(`Opens ${opener.hero} in ${opener.games} of ${mu.games}`);
      }

      const t2 = mu && mu.t2 ? (mu.t2.winMedian ?? mu.t2.lossMedian) : null;
      const t2n = mu ? mu.t2.winN + mu.t2.lossN : 0;
      if (t2 !== null && t2 !== undefined && t2n >= 3) {
        facts.push(`Tier 2 around ${PA().fmtMs(t2)}`);
      }

      if (facts.length < 2 && p.games >= 4 && p.habits) {
        const rate = p.habits.expansionRate;
        if (rate === 0) facts.push('Never expands');
        else if (rate >= 70) facts.push(`Expands in ${rate}% of games`);
      }

      return { profileGames: p.games, h2h, facts: facts.slice(0, 2) };
    };

    const clear = () => {
      match = null;
      const host = el('scout');
      host.innerHTML = '';
      host.hidden = true;
    };

    const render = (m, ladder, book) => {
      const host = el('scout');
      host.innerHTML = '';
      host.hidden = false;

      const opp = m.opponents[0];

      const head = node('div', 'scout-head');
      head.appendChild(node('span', 'scout-live', 'Live'));

      const vs = node('span', 'scout-vs');
      vs.appendChild(node('span', null, 'vs '));
      const link = node('button', 'name-link', opp.name);
      link.type = 'button';
      link.addEventListener('click', () => deps.onOpenProfile(opp.tag));
      vs.appendChild(link);
      if (window.RaceIcons) vs.appendChild(window.RaceIcons.mark(opp.race));
      if (m.opponents.length > 1) vs.appendChild(node('span', 'scout-more', `+${m.opponents.length - 1}`));
      head.appendChild(vs);

      const bits = [];
      const mmr = (ladder && ladder.mmr) || opp.mmr;
      if (mmr) bits.push(`${Math.round(mmr)} MMR`);
      if (ladder && ladder.rank) bits.push(`#${ladder.rank}`);
      if (mmr && m.me.mmr) {
        const d = Math.round(mmr - m.me.mmr);
        bits.push(d >= 0 ? `+${d} on you` : `${d} on you`);
      }
      if (bits.length) head.appendChild(node('span', 'scout-ladder', bits.join(' · ')));

      if (m.map) head.appendChild(node('span', 'scout-map', m.map));
      host.appendChild(head);

      const line = node('p', 'scout-book');
      if (!book) {
        line.appendChild(node('span', 'scout-first', 'First time against them'));
      } else {
        if (book.h2h) {
          const chip = node('span', 'scout-h2h', `${book.h2h.wins}–${book.h2h.losses} to you`);
          chip.dataset.v = book.h2h.wins > book.h2h.losses ? 'win'
            : book.h2h.wins < book.h2h.losses ? 'loss' : 'even';
          line.appendChild(chip);
        }
        for (const f of book.facts) line.appendChild(node('span', 'scout-fact', f));
        if (!book.h2h && !book.facts.length) {
          line.appendChild(node('span', 'scout-fact', `${book.profileGames} games in your history`));
        }
      }
      host.appendChild(line);
    };

    const tick = async () => {
      const me = deps.identityName();
      if (!deps.w3c.enabled || !deps.w3c.isTag(me)) {
        clear();
        return;
      }
      // Hidden to the tray. Leave whatever is on screen alone and wait.
      if (!(await deps.visible())) return;

      const found = await deps.w3c.ongoing(me);
      if (!found) {
        if (match) clear();
        return;
      }
      // Same match, already drawn.
      if (match && found.id && match.id === found.id) return;

      match = found;
      const opp = found.opponents[0];
      const ladder = await statsFor(opp.tag);
      const book = found.opponents.length === 1
        ? bookOn(opp, found.me.race)
        : null;
      // A second tick may have cleared it while the stats call was in flight.
      if (!match || match.id !== found.id) return;
      render(found, ladder, book);
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
