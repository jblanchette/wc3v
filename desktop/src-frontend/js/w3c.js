// Client for the W3Champions ladder API.
//
// Most calls resolve to null when anything goes wrong. The API is undocumented
// and unversioned, so callers have to survive a response shape nobody has seen
// before. Callers render null as "no online data".
//
// `ongoing` is the exception, and it is the important one. It returns
// { state, match } where state is:
//
//   'live'    — the ladder says this player is in a match, and here it is.
//   'none'    — the ladder ANSWERED and there is no match. Definite.
//   'unknown' — nobody answered: timeout, offline, 500, junk body.
//
// A null return conflated the last two, and the cost was concrete: one dropped
// request looked exactly like a game ending, so a single five-second timeout
// cleared the live card, reset the report column and told the overlay the game
// was over. 'unknown' is the state that must never move anything.
//
// The Rust side (src-tauri/src/w3c.rs) owns the host, the allowlist and the
// opt-in check, and tags every error `code: sentence`. This file only builds
// paths, reads what comes back, and maps those codes.

(function () {
  'use strict';

  // W3Champions race ids.
  const RACE = { 0: 'R', 1: 'H', 2: 'O', 4: 'E', 8: 'U' };

  // Ladder identities look like name#1234. A replay saved outside W3Champions
  // carries a bare name, and the ladder has nothing to say about one.
  const TAG = /^[^#\s][^#]*#\d+$/;
  const isTag = (name) => typeof name === 'string' && TAG.test(name.trim());

  const num = (...vals) => {
    for (const v of vals) if (typeof v === 'number' && isFinite(v)) return v;
    return null;
  };

  const seatOf = (p) => {
    const tag = String(p.battleTag);
    return {
      tag,
      name: tag.split('#')[0],
      race: RACE[p.rndRace] || RACE[p.race] || null,
      random: p.race === 0,
      mmr: num(p.oldMmr, p.currentMmr, p.mmr)
    };
  };

  // When the ladder created this match. It is the queue pop rather than the
  // first frame, so it runs a little ahead of the in-game clock, which is why
  // the overlay labels what it draws from this "live" and never "game time".
  //
  // The field has been an ISO string and epoch millis at different points in
  // this API's life, so both are read.
  const startedAt = (raw) => {
    const v = raw.startTime !== undefined ? raw.startTime : raw.startedAt;
    let ms = null;
    if (typeof v === 'number' && isFinite(v)) ms = v < 1e12 ? v * 1000 : v;
    else if (typeof v === 'string') {
      const t = Date.parse(v);
      if (isFinite(t)) ms = t;
    }
    if (ms === null) return null;
    // A clock counting up from the wrong zero is worse on a broadcast than no
    // clock at all. In the future, or older than any WC3 game, is not this one.
    const age = Date.now() - ms;
    if (age < -60000 || age > 3 * 3600 * 1000) return null;
    return ms;
  };

  const asMatch = (raw, meTag) => {
    if (!raw || typeof raw !== 'object') return null;
    const seats = [];
    for (const team of (Array.isArray(raw.teams) ? raw.teams : [])) {
      for (const p of (Array.isArray(team && team.players) ? team.players : [])) {
        if (p && typeof p.battleTag === 'string') seats.push(p);
      }
    }
    const meKey = String(meTag).toLowerCase();
    const me = seats.find(p => p.battleTag.toLowerCase() === meKey);
    const them = seats.filter(p => p.battleTag.toLowerCase() !== meKey);
    if (!me || !them.length) return null;
    return {
      id: raw.id || raw.matchId || null,
      map: raw.mapName || raw.map || null,
      mode: num(raw.gameMode),
      startedAt: startedAt(raw),
      me: seatOf(me),
      opponents: them.map(seatOf)
    };
  };

  // game-mode-stats comes back as one row per mode and race. Take the busiest
  // 1v1 row rather than looking for a particular race id, which has moved
  // before.
  const asStats = (raw) => {
    if (!Array.isArray(raw)) return null;
    let best = null;
    for (const row of raw) {
      if (!row || row.gameMode !== 1) continue;
      if (!best || (num(row.games) || 0) > (num(best.games) || 0)) best = row;
    }
    if (!best) return null;
    return {
      mmr: num(best.mmr),
      rank: num(best.rank),
      quantile: num(best.quantile),
      games: num(best.games),
      wins: num(best.wins),
      losses: num(best.losses)
    };
  };

  window.createW3c = (deps) => {
    // deps: invoke, log
    let on = false;
    let complained = false;

    // One lookup, as { ok, body, code }. `code` is the Rust side's error token,
    // and the codes that mean "the server answered" are the only ones a caller
    // may treat as fact.
    const fetchOne = async (path) => {
      if (!on) return { ok: false, code: 'off' };
      let text;
      try {
        text = await deps.invoke('w3c_lookup', { path });
      } catch (e) {
        // Errors arrive as `code: sentence`. Split once; anything without a
        // recognised code is treated as unreachable, which is the safe side —
        // an unknown failure must never be read as a definite answer.
        const msg = String((e && e.message) || e || '');
        const cut = msg.indexOf(': ');
        const code = cut > 0 ? msg.slice(0, cut) : '';
        const said = cut > 0 ? msg.slice(cut + 2) : msg;
        // A 404 on an ongoing match means you are simply not in a game, which
        // is the state this app is in nearly all the time. Anything else gets
        // said once per session so the Activity drawer stays quiet.
        if (code !== 'notfound' && !complained) {
          complained = true;
          deps.log(`W3Champions unavailable: ${said}`, 'warn');
        }
        return { ok: false, code: code === 'notfound' ? 'notfound' : (code || 'unreachable') };
      }
      try {
        return { ok: true, body: JSON.parse(text) };
      } catch (e) {
        // 200 with a body that is not JSON. The socket worked, the API did not,
        // so this is junk rather than an answer.
        return { ok: false, code: 'badbody' };
      }
    };

    // The old shape, for the callers that genuinely only want "data or nothing".
    const get = async (path) => {
      const r = await fetchOne(path);
      return r.ok ? r.body : null;
    };

    const q = (tag) => encodeURIComponent(String(tag || '').trim());

    return {
      isTag,
      get enabled () { return on; },
      setEnabled (value) {
        on = !!value;
        if (on) complained = false;
      },

      // { state: 'live' | 'none' | 'unknown', match }
      //
      // 'none' is claimed on exactly two grounds, both of which are the server
      // answering: a 404, or a 200 whose body carries no match for this tag.
      // Everything else — timeout, offline, 5xx, junk, feature switched off —
      // is 'unknown', and the scout holds its current state on 'unknown'.
      async ongoing (tag) {
        if (!isTag(tag)) return { state: 'unknown', match: null };
        const r = await fetchOne(`/api/matches/ongoing/${q(tag)}`);
        if (!r.ok) {
          return { state: r.code === 'notfound' ? 'none' : 'unknown', match: null };
        }
        const match = asMatch(r.body, tag);
        return match ? { state: 'live', match } : { state: 'none', match: null };
      },

      async stats (tag) {
        if (!isTag(tag)) return null;
        return asStats(await get(`/api/players/${q(tag)}/game-mode-stats`));
      }
    };
  };
})();
