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

  // The scalar layer. Resolved per call rather than once at load: in the
  // browser these are plain scripts and a wrong tag order would otherwise bake
  // a null in here at parse time and fail silently everywhere downstream.
  const gm = () =>
    (typeof window !== 'undefined' && window.GameMetrics) ||
    (typeof require === 'function' ? require('./GameMetrics.js') : null);

  // Minimum sample sizes before a statement is allowed to make a claim.
  const MIN_MATCHUP = 8;
  const MIN_OPENING = 5;
  const MIN_SPLIT = 5;   // per side of a win/loss comparison
  const MIN_MAP = 8;
  // Trend windows. TREND_WINDOW games per point, and a change is only claimed
  // when BOTH ends carry at least MIN_TREND decided games — "n overall" is not
  // the same as "n at each end", and conflating them is how a two-game blip
  // gets announced as improvement.
  const TREND_WINDOW = 20;
  const MIN_TREND = 8;

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

    // Every scalar comes from GameMetrics. Workers at 5:00 was computed inline
    // here, again in GameReport and again in the Story tiles, and the three
    // implementations were free to drift.
    const m = gm().forSeat(summary, slot) || {};

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
      t2: m.t2 ?? null,
      t3: m.t3 ?? null,
      expansion: m.expansion ?? null,
      firstTower: m.firstTower ?? null,
      expansionMade: !!m.expansionMade,
      workersAt5m: m.workersAt5m ?? null,
      apmEffective: m.apmEffective ?? null,
      // The three the report compares. Dominance is 1v1-only and absent from
      // any summary written before schema v4; the hero ledger arrived in v3.
      // Both are null rather than zero on a summary that never carried them,
      // so a stale corpus lowers a sample size instead of dragging a median.
      dominanceAvg: m.dominanceAvg ?? null,
      heroKills: m.heroKills ?? null,
      heroDeaths: m.heroDeaths ?? null
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
      recentForm: recentForm(views),
      trend: trend(views)
    };
    profile.trendDelta = trendDelta(profile.trend);

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

  // ── Trend over time ────────────────────────────────────────────────────────
  //
  // Everything above answers "what are you like". This answers "what are you
  // like NOW, compared with then" — which is the question a lifetime average
  // is structurally incapable of answering. A player who has fixed their
  // opening still carries every game they played before they fixed it.
  //
  // Buckets are fixed-size windows of GAMES, not calendar weeks: someone who
  // plays 40 games one week and 2 the next would otherwise get two points that
  // look equally trustworthy. `views` arrives oldest-first.
  //
  // Tiled from the MOST RECENT game backwards, so the newest window is always
  // full and any short one is the oldest. Tiling forwards instead leaves the
  // remainder at the recent end, where a 3-game trailing window would fail the
  // sample guard and silence the trend for every corpus whose size is not a
  // multiple of the window.
  function trend (views, windowSize) {
    const size = windowSize || TREND_WINDOW;

    // Boundaries walked back from the newest game, then flipped to
    // oldest-first for the caller.
    const bounds = [];
    for (let end = views.length; end > 0; end -= size) {
      bounds.unshift([Math.max(0, end - size), end]);
    }

    const out = [];
    for (const [start, end] of bounds) {
      const slice = views.slice(start, end);
      const b = bucket();
      const t2 = [];
      const expansion = [];
      const workers = [];
      const dominance = [];
      const apm = [];
      const heroKills = [];
      let from = null;
      let to = null;
      for (const v of slice) {
        feed(b, v.result);
        if (v.t2 !== null) t2.push(v.t2);
        if (v.expansion !== null) expansion.push(v.expansion);
        if (v.workersAt5m !== null) workers.push(v.workersAt5m);
        if (v.dominanceAvg !== null) dominance.push(v.dominanceAvg);
        if (v.apmEffective !== null) apm.push(v.apmEffective);
        if (v.heroKills !== null) heroKills.push(v.heroKills);
        if (v.playedAt) {
          from = from === null ? v.playedAt : Math.min(from, v.playedAt);
          to = to === null ? v.playedAt : Math.max(to, v.playedAt);
        }
      }
      out.push({
        games: b.games,
        wins: b.wins,
        losses: b.losses,
        decided: b.wins + b.losses,
        winRate: winRate(b),
        t2Median: median(t2),
        t2N: t2.length,
        expansionMedian: median(expansion),
        expansionN: expansion.length,
        workersAt5mMedian: median(workers),
        workersAt5mN: workers.length,
        // The comparison set, tracked over time as well as against a median.
        // The report says where one game sits; these say which way the player
        // is moving, and they have to be the same three numbers or the two
        // screens are measuring different things.
        dominanceAvgMedian: median(dominance),
        dominanceAvgN: dominance.length,
        apmMedian: median(apm),
        apmN: apm.length,
        heroKillsMedian: median(heroKills),
        heroKillsN: heroKills.length,
        from,
        to
      });
    }
    return out;
  }

  // The change claim: first window vs last. Deliberately NOT "this window vs
  // the lifetime average" — the lifetime average CONTAINS the window, so any
  // such comparison is partly a number against itself.
  //
  // Every field carries the n of BOTH ends. A trend claim needs a real sample
  // at each end; enough games overall is not the same thing and is exactly how
  // a two-game "improvement" gets announced.
  function trendDelta (windows) {
    if (!windows || windows.length < 2) return null;
    // Skip a short leading window when a full one follows: the oldest bucket
    // is the remainder, and comparing "your first 3 games" against your last
    // 20 is a comparison of nothing against something.
    const start = (windows.length >= 3 && windows[0].games < windows[1].games) ? 1 : 0;
    const first = windows[start];
    const last = windows[windows.length - 1];
    if (first === last) return null;
    const pair = (key, nKey) => ({
      from: first[key],
      to: last[key],
      fromN: first[nKey],
      toN: last[nKey],
      delta: (first[key] === null || last[key] === null) ? null : last[key] - first[key]
    });
    return {
      windows: windows.length,
      winRate: {
        from: first.winRate,
        to: last.winRate,
        fromN: first.decided,
        toN: last.decided,
        delta: last.winRate - first.winRate
      },
      t2: pair('t2Median', 't2N'),
      expansion: pair('expansionMedian', 'expansionN'),
      workersAt5m: pair('workersAt5mMedian', 'workersAt5mN'),
      dominanceAvg: pair('dominanceAvgMedian', 'dominanceAvgN'),
      apmEffective: pair('apmMedian', 'apmN'),
      heroKills: pair('heroKillsMedian', 'heroKillsN')
    };
  }

  // ── Per-game benchmark baseline ────────────────────────────────────────────
  //
  // "How does this game compare with what I normally do" — the rolling
  // last-N same-matchup medians the game review grades against. Benchmarks
  // against YOURSELF, deliberately: an absolute target belongs to whoever
  // invented it, but "your median over the last 20 OvH games" is a fact.
  //
  // Falls back from the matchup scope to all games when the matchup is thin
  // (below MIN_BASELINE) — a claim against 3 games is worse than a claim
  // against all of them, and `scope` says which one was used. Pass
  // `excludeKey` with the reviewed game's key: the game under review must
  // never be inside its own baseline.
  const MIN_BASELINE = 5;

  function baseline (games, name, opts) {
    const o = opts || {};
    const nameLower = normName(name);
    const windowSize = o.window || TREND_WINDOW;

    const views = [];
    for (const g of games || []) {
      if (o.excludeKey && g.key === o.excludeKey) continue;
      const v = gameView(g, nameLower);
      if (v) views.push(v);
    }
    views.sort((a, b) => (a.playedAt || 0) - (b.playedAt || 0));

    let scoped = o.matchup ? views.filter(v => v.matchup === o.matchup) : views;
    let scope = o.matchup ? 'matchup' : 'all';
    if (o.matchup && scoped.length < MIN_BASELINE) {
      scoped = views;
      scope = 'all';
    }
    const recent = scoped.slice(-windowSize);

    const pick = (sel) => {
      const xs = recent.map(sel).filter(x => x !== null && x !== undefined);
      return { median: median(xs), n: xs.length };
    };

    return {
      scope,
      matchup: scope === 'matchup' ? o.matchup : null,
      games: recent.length,
      t2: pick(v => v.t2),
      expansion: pick(v => v.expansion),
      workersAt5m: pick(v => v.workersAt5m),
      apmEffective: pick(v => v.apmEffective),
      // The comparison set. Each carries its own n, because a corpus can be
      // twenty games deep on APM and four deep on dominance at the same time:
      // the series only exists on v4 summaries and only on 1v1s.
      dominanceAvg: pick(v => v.dominanceAvg),
      heroKills: pick(v => v.heroKills),
      expansionRate: recent.length
        ? pct(recent.filter(v => v.expansionMade).length, recent.length)
        : 0
    };
  }

  // ── Per-race baseline: the players of this race you have actually faced ────
  //
  // Everything above reads one named player's seats. This reads EVERY OTHER
  // seat in the corpus and keeps the ones playing the race asked for, so a
  // Human game is measured against the other Humans in your history.
  //
  // Why other people's seats rather than a published race average, and why
  // yours are excluded: both were measured over the repo's 334-replay corpus
  // before this was built.
  //
  //   Dominance is a share of 100 split between two players, so ANY population
  //   average of it lands on 50 by construction. Measured: 48 to 52 across all
  //   four races. A delta against that says "did you beat your opponent", which
  //   the result already says.
  //
  //   Effective APM is a property of the bracket, not the race. The repo's
  //   corpus is professional games and medians 395 to 565; a ladder player at
  //   74 would be told they are 490 behind Orc, which is a wall rather than a
  //   comparison.
  //
  // Matchmaking is what fixes both: the people you play are near your own
  // level, so their numbers are a comparison you can act on. Your own seats
  // come out because they are already the other column, and leaving them in
  // would pull the benchmark toward the thing being benchmarked.
  //
  // Returns null below MIN_RACE_N so the caller can fall back to the shipped
  // sample rather than quote a median of four. Nothing leaves the machine.
  const MIN_RACE_N = 12;

  function raceBaseline (games, race, opts) {
    if (!race) return null;
    const o = opts || {};
    const skip = o.excludeName ? normName(o.excludeName) : null;

    const seats = [];
    for (const g of games || []) {
      if (o.excludeKey && g.key === o.excludeKey) continue;
      // 1v1 only. Dominance is a share of 100 split across the whole game, so a
      // team seat is not the same measurement and must not be averaged in with
      // a duel's.
      if (g.gameMode !== '1v1') continue;
      for (const slot of Object.keys(g.players || {})) {
        const p = g.players[slot];
        if (p.race !== race) continue;
        if (skip && normName(p.name) === skip) continue;
        const m = gm().forSeat(g, slot);
        if (m) seats.push(m);
      }
    }
    if (seats.length < MIN_RACE_N) return null;

    const pick = (sel) => {
      const xs = seats.map(sel).filter(x => x !== null && x !== undefined);
      return { median: median(xs), n: xs.length };
    };

    return {
      source: 'local',
      race,
      seats: seats.length,
      dominanceAvg: pick(m => m.dominanceAvg),
      apmEffective: pick(m => m.apmEffective),
      heroKills: pick(m => m.heroKills)
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

    // Change over time. Guarded on BOTH ends independently — a player with 300
    // lifetime games can still have a 3-game window, and "your T2 is 40s later
    // than it used to be (n=3)" is worse than saying nothing.
    const d = p.trendDelta;
    if (d) {
      if (d.winRate.fromN >= MIN_TREND && d.winRate.toN >= MIN_TREND &&
          Math.abs(d.winRate.delta) >= 10) {
        say('trend',
          `Win rate has gone ${d.winRate.delta > 0 ? 'up' : 'down'} — ` +
          `${d.winRate.from}% over your first ${d.winRate.fromN} decided games, ` +
          `${d.winRate.to}% over your last ${d.winRate.toN}.`);
      }

      const t2 = d.t2;
      if (t2.delta !== null && t2.fromN >= MIN_TREND && t2.toN >= MIN_TREND &&
          Math.abs(t2.delta) >= 15000) {
        say('trend',
          `Your T2 has got ${t2.delta < 0 ? 'faster' : 'slower'} — ` +
          `${fmtMs(t2.from)} early on (n=${t2.fromN}), ` +
          `${fmtMs(t2.to)} lately (n=${t2.toN}).`);
      }

      const w5 = d.workersAt5m;
      if (w5.delta !== null && w5.fromN >= MIN_TREND && w5.toN >= MIN_TREND &&
          Math.abs(w5.delta) >= 2) {
        say('trend',
          `Workers at 5:00 have gone ${w5.delta > 0 ? 'up' : 'down'} — ` +
          `median ${w5.from} early on (n=${w5.fromN}), ${w5.to} lately (n=${w5.toN}).`);
      }
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

  const api = {
    gameView, buildProfile, baseline, raceBaseline,
    knownNames, detectPrimaryName, normName, fmtMs,
    MIN_RACE_N
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.ProfileAggregate = api;
  }
})();
