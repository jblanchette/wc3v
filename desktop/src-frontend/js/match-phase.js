// What the app is doing right now, in one place.
//
// There used to be no answer to that question. "Phase" was an emergent property
// of five independent booleans in five modules across three processes —
// scout.js's `match`, games-view.js's `live`/`mode`/`latchedId`,
// overlay-state.js's `st.scout`/`st.lastGame`, shell.html's `data-phase` derived
// separately inside OBS, and stream-view.js's manual `previewAt`. Nothing
// arbitrated between them, so the app window and the broadcast could disagree
// about whether a game was on, and routinely did.
//
// Three states:
//
//   idle  Nothing has happened yet. A fresh install, no games on disk, no match
//         on the ladder. This is the ONLY state that says "nothing to show", and
//         it is reachable only from a cold start.
//   live  A match is on. The ladder said so and the id is one we have not
//         already seen end.
//   post  A game finished, or a live match ended. The last game stays on screen.
//
// The rule that matters, and the reason this file exists: **once anything has
// been seen, idle is unreachable.** Between two games the app sits in `post`
// holding the previous game, because that is what somebody who just finished a
// match wants to look at, and because a broadcast that blanks between games
// looks broken. Going back to idle was the complaint.
//
// Nothing here polls, renders or times anything out. It is told what happened
// and it tells its subscribers what that means.

(function () {
  'use strict';

  const IDLE = 'idle';
  const LIVE = 'live';
  const POST = 'post';

  const createMatchPhase = (deps = {}) => {
    const log = deps.log || (() => {});

    let phase = IDLE;
    // The match on the ladder right now: { match, ladder, book }.
    let live = null;
    // Whether a game has ever been on screen this session, seeded or played.
    // This is what makes idle a one-way door out of.
    let seen = false;
    // Why we are in post, when the answer is not "a game finished". Surfaced so
    // a parse failure reads as a parse failure rather than as an empty screen.
    let note = null;

    const subs = [];

    const snapshot = () => ({ phase, live, note });

    const emit = () => {
      const snap = snapshot();
      for (const fn of subs) {
        try { fn(snap); } catch (e) { /* a bad subscriber must not stop the rest */ }
      }
    };

    // Settle on a phase and tell everyone, but only when something actually
    // moved. Every subscriber here tears down and remounts a chart or repaints a
    // broadcast, so a no-op transition is not free.
    const to = (next, nextNote) => {
      const noteChanged = (nextNote || null) !== note;
      if (phase === next && !noteChanged) return false;
      phase = next;
      note = nextNote || null;
      emit();
      return true;
    };

    // Where to land when there is no live match. `post` whenever there is
    // anything to hold, which after boot is essentially always: app.js seeds the
    // newest stored game before the first poll runs.
    const resting = (nextNote) => to(seen ? POST : IDLE, nextNote);

    return {
      IDLE,
      LIVE,
      POST,

      get phase () { return phase; },
      get live () { return live; },
      get note () { return note; },
      snapshot,

      // Returns an unsubscribe, and fires once immediately so a subscriber
      // never has to ask what it missed.
      subscribe (fn) {
        subs.push(fn);
        try { fn(snapshot()); } catch (e) { /* as above */ }
        return () => {
          const i = subs.indexOf(fn);
          if (i !== -1) subs.splice(i, 1);
        };
      },

      // A game is on screen without having been played this session: the newest
      // stored game, read at boot. Enough to make idle unreachable, and
      // deliberately NOT a phase change on its own — a seeded game is the resting
      // card, not an event.
      seedGame () {
        if (seen) return false;
        seen = true;
        return resting(null);
      },

      // The ladder reports a match. Only a genuinely new one moves the app.
      setLive (match, ladder, book) {
        if (!match) return false;
        if (live && live.match && live.match.id && live.match.id === match.id) {
          // Same match, refreshed detail. Update in place; do not re-announce,
          // or every 60-second poll would remount the report column.
          live = { match, ladder, book };
          return false;
        }
        live = { match, ladder, book };
        return to(LIVE, null);
      },

      // The ladder is certain there is no match. Not a timeout — scout.js holds
      // its state on those and never calls this.
      clearLive () {
        if (!live && phase !== LIVE) return false;
        live = null;
        return resting(null);
      },

      // A replay landed and parsed. This, not the ladder, is the authoritative
      // end of a game: the file exists, so the match is over whatever the ladder
      // still says.
      gameLanded () {
        live = null;
        seen = true;
        return to(POST, null);
      },

      // A replay landed and could NOT be read. Without this the app sat in
      // `live` forever on a bad file, because the only thing that cleared the
      // live card was a successful parse.
      parseFailed (why) {
        live = null;
        log(`could not read that game: ${why || 'unknown reason'}`, 'warn');
        return resting(why || 'That replay could not be read.');
      }
    };
  };

  if (typeof window !== 'undefined') window.createMatchPhase = createMatchPhase;
  // Also a module, so tools/lifecycle-sim.js can drive it without a browser.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createMatchPhase, IDLE, LIVE, POST };
  }
})();
