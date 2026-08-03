/**
 * ProfileAggregate.js — pure aggregation over stored game summaries.
 *
 * Input is an array of summary wrappers as the desktop app persists them
 * (see desktop/src-frontend/js/app.js buildSummary): per-player shapes come
 * from SummaryExtract, wrapped with { map, gameMode, winner, durationMs,
 * playedAt, players: { slot: summary + teamId } }.
 *
 * A "profile" is just a name: buildProfile(games, 'Grubby') works the same
 * whether the name is the user's or an opponent being looked up — both are
 * views over the same local history. No APIs, no scraping.
 *
 * Self-contained, no DOM, no fs — dual-runtime like SummaryExtract. All
 * claims carry sample sizes; statements refuse to fire below minimum n
 * rather than dress small samples up as insight.
 */

(function () {
  'use strict';

  // Minimum sample sizes before a statement is allowed to make a claim.
  const MIN_MATCHUP = 8;
  const MIN_OPENING = 5;
  const MIN_SPLIT = 5;   // per side of a win/loss comparison
  const MIN_MAP = 8;

  // ── Small stats helpers ────────────────────────────────────────────────────

  const median = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };

  const fmtMs = (ms) => {
    if (ms === null || ms === undefined) return '?';
    const total = Math.round(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  };

  const pct = (num, den) => (den ? Math.round((num / den) * 100) : 0);

  const normName = (s) => String(s || '').toLowerCase().trim();

  // ── Single-game view from one player's seat ────────────────────────────────

  // Everything downstream (profile buckets, overlay, session tracker) shares
  // this one extraction, so "did I win" can never disagree between features.
  function gameView (summary, nameLower) {
    const players = summary.players || {};
    let slot = null;
    for (const k of Object.keys(players)) {
      if (normName(players[k].name) === nameLower) { slot = k; break; }
    }
    if (slot === null) return null;

    const me = players[slot];
    const is1v1 = summary.gameMode === '1v1';

    let opponent = null;
    if (is1v1) {
      for (const k of Object.keys(players)) {
        if (k !== slot) { opponent = players[k]; break; }
      }
    }

    // winner.playerId is the winning SLOT; only computed for 1v1. A missing
    // winner on a 1v1 means "couldn't tell", never "draw".
    let result = null;
    if (is1v1 && summary.winner && typeof summary.winner.playerId === 'number') {
      result = summary.winner.playerId === +slot ? 'win' : 'loss';
    }

    // Workers at the 5:00 economy sample (the closest one at or before it).
    let workersAt5m = null;
    for (const s of (me.economyTrack || [])) {
      if (s.gameTimeMs > 5 * 60 * 1000) break;
      workersAt5m = s.totalWorkers;
    }

    return {
      key: summary.key,
      slot,
      name: me.name,
      race: me.race || null,
      map: summary.map || '?',
      mode: summary.gameMode || '?',
      playedAt: summary.playedAt || null,
      patchVersion: summary.patchVersion ?? null,
      durationMs: summary.durationMs || 0,
      result,
      resultConfidence: summary.winner ? summary.winner.confidence : null,
      opponent: opponent ? { name: opponent.name, race: opponent.race || null } : null,
      matchup: (is1v1 && me.race && opponent && opponent.race)
        ? `${me.race}v${opponent.race}`
        : null,
      heroOpener: me.heroOpener ? me.heroOpener.name : null,
      t2: me.tier2Time ?? null,
      t3: me.tier3Time ?? null,
      expansion: me.expansionTime ?? null,
      firstTower: me.firstTowerTime ?? null,
      expansionMade: me.expansionTime !== null && me.expansionTime !== undefined,
      workersAt5m,
      apmEffective: me.apm ? me.apm.effectiveAverage : null
    };
  }

  // ── Corpus-level name discovery ────────────────────────────────────────────

  function knownNames (games) {
    const counts = new Map();
    for (const g of games) {
      for (const k of Object.keys(g.players || {})) {
        const raw = g.players[k].name;
        const key = normName(raw);
        if (!key) continue;
        const cur = counts.get(key) || { name: raw, games: 0 };
        cur.games++;
        counts.set(key, cur);
      }
    }
    return [...counts.values()].sort((a, b) => b.games - a.games);
  }

  // The account owner appears in nearly every replay they saved; nobody else
  // comes close. That signal is the auto-detected default profile.
  //
  // Returns null when the signal is absent rather than guessing. With a single
  // game every player is tied at one appearance, and nothing in the replay
  // format identifies which seat saved it — so there is genuinely no way to
  // tell the account owner from their opponent. Callers must ask instead.
  function detectPrimaryName (games) {
    const names = knownNames(games);
    if (!names.length) return null;
    if (names.length > 1 && names[0].games === names[1].games) return null;
    return names[0];
  }

  // ── Profile aggregation ────────────────────────────────────────────────────

  const bucket = () => ({ games: 0, wins: 0, losses: 0 });
  const feed = (b, result) => {
    b.games++;
    if (result === 'win') b.wins++;
    else if (result === 'loss') b.losses++;
  };
  const winRate = (b) => pct(b.wins, b.wins + b.losses);

  function buildProfile (games, name) {
    const nameLower = normName(name);
    const views = [];
    for (const g of games) {
      const v = gameView(g, nameLower);
      if (v) views.push(v);
    }
    views.sort((a, b) => (a.playedAt || 0) - (b.playedAt || 0));

    const overall = bucket();
    const races = new Map();
    const matchups = new Map();
    const maps = new Map();
    const opponents = new Map();
    const patches = new Map();
    const split = () => ({ win: [], loss: [] });
    const timing = { t2: split(), expansion: split(), firstTower: split(), workersAt5m: split() };
    const expand = { with: bucket(), without: bucket() };
    let displayName = name;

    for (const v of views) {
      displayName = v.name || displayName;
      feed(overall, v.result);

      if (v.race) races.set(v.race, (races.get(v.race) || 0) + 1);

      if (v.matchup) {
        if (!matchups.has(v.matchup)) {
          matchups.set(v.matchup, { ...bucket(), openings: new Map(), t2: split() });
        }
        const m = matchups.get(v.matchup);
        feed(m, v.result);
        if (v.heroOpener) {
          if (!m.openings.has(v.heroOpener)) m.openings.set(v.heroOpener, bucket());
          feed(m.openings.get(v.heroOpener), v.result);
        }
        if (v.t2 !== null && v.result) m.t2[v.result].push(v.t2);
      }

      if (!maps.has(v.map)) maps.set(v.map, bucket());
      feed(maps.get(v.map), v.result);

      if (v.opponent && v.opponent.name) {
        const ok = normName(v.opponent.name);
        if (!opponents.has(ok)) {
          opponents.set(ok, { ...bucket(), name: v.opponent.name, lastPlayedAt: null });
        }
        const o = opponents.get(ok);
        feed(o, v.result);
        if (v.playedAt) o.lastPlayedAt = Math.max(o.lastPlayedAt || 0, v.playedAt);
      }

      if (v.patchVersion !== null) {
        if (!patches.has(v.patchVersion)) patches.set(v.patchVersion, bucket());
        feed(patches.get(v.patchVersion), v.result);
      }

      if (v.result) {
        if (v.t2 !== null) timing.t2[v.result].push(v.t2);
        if (v.expansion !== null) timing.expansion[v.result].push(v.expansion);
        if (v.firstTower !== null) timing.firstTower[v.result].push(v.firstTower);
        if (v.workersAt5m !== null) timing.workersAt5m[v.result].push(v.workersAt5m);
        feed(v.expansionMade ? expand.with : expand.without, v.result);
      }
    }

    const timingSplit = (t) => ({
      winMedian: median(t.win),
      lossMedian: median(t.loss),
      winN: t.win.length,
      lossN: t.loss.length
    });

    const profile = {
      name: displayName,
      games: views.length,
      decided: overall.wins + overall.losses,
      wins: overall.wins,
      losses: overall.losses,
      winRate: winRate(overall),
      unknownResults: views.length - overall.wins - overall.losses,
      firstPlayedAt: views.length ? views[0].playedAt : null,
      lastPlayedAt: views.length ? views[views.length - 1].playedAt : null,
      races: [...races.entries()]
        .map(([race, n]) => ({ race, games: n }))
        .sort((a, b) => b.games - a.games),
      matchups: [...matchups.entries()]
        .map(([matchup, m]) => ({
          matchup,
          games: m.games,
          wins: m.wins,
          losses: m.losses,
          winRate: winRate(m),
          openings: [...m.openings.entries()]
            .map(([hero, b]) => ({ hero, ...b, winRate: winRate(b) }))
            .sort((a, b) => b.games - a.games),
          t2: timingSplit(m.t2)
        }))
        .sort((a, b) => b.games - a.games),
      maps: [...maps.entries()]
        .map(([map, b]) => ({ map, ...b, winRate: winRate(b) }))
        .sort((a, b) => b.games - a.games),
      opponents: [...opponents.values()]
        .map((o) => ({ ...o, winRate: winRate(o) }))
        .sort((a, b) => b.games - a.games)
        .slice(0, 25),
      patches: [...patches.entries()]
        .map(([version, b]) => ({ version, ...b, winRate: winRate(b) }))
        .sort((a, b) => b.version - a.version),
      timings: {
        t2: timingSplit(timing.t2),
        expansion: timingSplit(timing.expansion),
        firstTower: timingSplit(timing.firstTower)
      },
      habits: {
        expansionRate: pct(views.filter(v => v.expansionMade).length, views.length),
        expandRecord: {
          with: { ...expand.with, winRate: winRate(expand.with) },
          without: { ...expand.without, winRate: winRate(expand.without) }
        },
        workersAt5m: timingSplit(timing.workersAt5m)
      },
      recentForm: recentForm(views)
    };

    profile.statements = statements(profile);
    return profile;
  }

  function recentForm (views) {
    const decided = views.filter(v => v.result);
    const last = decided.slice(-10);
    return {
      n: last.length,
      wins: last.filter(v => v.result === 'win').length,
      losses: last.filter(v => v.result === 'loss').length
    };
  }

  // ── Coach statements ───────────────────────────────────────────────────────
  //
  // Plain sentences a human would actually say, every one carrying its n.
  // A statement that cannot meet its minimum sample simply is not made.

  function statements (p) {
    const out = [];
    const say = (topic, text) => out.push({ topic, text });

    if (p.decided) {
      say('record',
        `Record: ${p.wins}–${p.losses} over ${p.decided} decided 1v1s (${p.winRate}%).` +
        (p.unknownResults ? ` ${p.unknownResults} game(s) had no readable result.` : ''));
    }

    if (p.recentForm.n >= 6) {
      say('form', `Recent form: ${p.recentForm.wins}–${p.recentForm.losses} over the last ${p.recentForm.n} decided games.`);
    }

    for (const m of p.matchups.filter(m => m.games >= MIN_MATCHUP).slice(0, 4)) {
      say('matchup', `${m.matchup}: ${m.wins}–${m.losses} (${m.winRate}%) over ${m.games} games.`);

      const opens = m.openings.filter(o => o.games >= MIN_OPENING);
      if (opens.length >= 2) {
        const [a, b] = opens;
        if (Math.abs(a.winRate - b.winRate) >= 10) {
          say('opening',
            `${m.matchup}: ${a.hero} opener wins ${a.winRate}% (n=${a.games}) vs ` +
            `${b.hero} ${b.winRate}% (n=${b.games}).`);
        }
      } else if (opens.length === 1 && opens[0].games >= MIN_OPENING) {
        const o = opens[0];
        say('opening',
          `${m.matchup}: you open ${o.hero} in ${pct(o.games, m.games)}% of games, winning ${o.winRate}%.`);
      }

      const t2 = m.t2;
      if (t2.winN >= MIN_SPLIT && t2.lossN >= MIN_SPLIT &&
          Math.abs(t2.winMedian - t2.lossMedian) >= 15000) {
        const slowerInLosses = t2.lossMedian > t2.winMedian;
        say('timing',
          `${m.matchup}: your T2 lands at ${fmtMs(t2.winMedian)} in wins vs ` +
          `${fmtMs(t2.lossMedian)} in losses (n=${t2.winN}/${t2.lossN})` +
          (slowerInLosses ? ' — slower tech tracks with losses.' : ' — faster tech tracks with losses.'));
      }
    }

    const ex = p.habits.expandRecord;
    if (ex.with.games >= MIN_MATCHUP && ex.without.games >= MIN_MATCHUP &&
        Math.abs(ex.with.winRate - ex.without.winRate) >= 8) {
      say('expansion',
        `You expand in ${p.habits.expansionRate}% of games; expanding games win ` +
        `${ex.with.winRate}% (n=${ex.with.games}) vs ${ex.without.winRate}% without (n=${ex.without.games}).`);
    }

    const w5 = p.habits.workersAt5m;
    if (w5.winN >= MIN_SPLIT && w5.lossN >= MIN_SPLIT &&
        Math.abs(w5.winMedian - w5.lossMedian) >= 2) {
      say('economy',
        `Workers at 5:00 — median ${w5.winMedian} in wins vs ${w5.lossMedian} in losses ` +
        `(n=${w5.winN}/${w5.lossN}).`);
    }

    const bigMaps = p.maps.filter(m => m.games >= MIN_MAP && (m.wins + m.losses) >= MIN_MAP);
    if (bigMaps.length >= 2) {
      const best = [...bigMaps].sort((a, b) => b.winRate - a.winRate)[0];
      const worst = [...bigMaps].sort((a, b) => a.winRate - b.winRate)[0];
      if (best.map !== worst.map && best.winRate - worst.winRate >= 10) {
        say('maps',
          `Best map: ${best.map} ${best.winRate}% (n=${best.games}); ` +
          `worst: ${worst.map} ${worst.winRate}% (n=${worst.games}).`);
      }
    }

    return out;
  }

  // ── Module export (Node) + window export (browser) ─────────────────────────

  const api = { gameView, buildProfile, knownNames, detectPrimaryName, normName, fmtMs };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.ProfileAggregate = api;
  }
})();
