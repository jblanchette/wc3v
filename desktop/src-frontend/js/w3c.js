// Client for the W3Champions ladder API.
//
// Every call resolves to null when anything goes wrong. The API is
// undocumented and unversioned, so callers have to survive a response shape
// nobody has seen before. Callers render null as "no online data".
//
// The Rust side (src-tauri/src/w3c.rs) owns the host, the allowlist and the
// opt-in check. This file only builds paths and reads what comes back.

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

    const get = async (path) => {
      if (!on) return null;
      let text;
      try {
        text = await deps.invoke('w3c_lookup', { path });
      } catch (e) {
        // A 404 on an ongoing match means you are simply not in a game, which
        // is the state this app is in nearly all the time. Anything else gets
        // said once per session so the Activity drawer stays quiet.
        const msg = String((e && e.message) || e || '');
        if (msg.indexOf('not found') === -1 && !complained) {
          complained = true;
          deps.log(`W3Champions unavailable: ${msg}`, 'warn');
        }
        return null;
      }
      try {
        return JSON.parse(text);
      } catch (e) {
        return null;
      }
    };

    const q = (tag) => encodeURIComponent(String(tag || '').trim());

    return {
      isTag,
      get enabled () { return on; },
      setEnabled (value) {
        on = !!value;
        if (on) complained = false;
      },
      async ongoing (tag) {
        if (!isTag(tag)) return null;
        return asMatch(await get(`/api/matches/ongoing/${q(tag)}`), tag);
      },
      async stats (tag) {
        if (!isTag(tag)) return null;
        return asStats(await get(`/api/players/${q(tag)}/game-mode-stats`));
      }
    };
  };
})();
