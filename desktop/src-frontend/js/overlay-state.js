// Overlay state: session W/L/streak plus the last finished game, published to
// the Rust loopback server, which relays it to OBS over SSE.
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

  // A baseline is only quoted at this many samples. Same reasoning as every
  // other guard in this codebase: "vs your median (n=2)" is not a benchmark,
  // and a stream is the worst place to put one.
  const MIN_BENCH_N = 5;

  // Points in the dominance sparkline. The series is not on a fixed grid —
  // DominanceSeries emits a pre/post pair around every momentum event — so this
  // is a count, not an interval. Forty is more than a 240px-wide curve can
  // resolve and small enough that the payload does not grow noticeably.
  const CURVE_POINTS = 40;

  // ── Build categorization ────────────────────────────────────────────────
  //
  // The overlay cannot draw BuildCard.build() directly — that reads icons off
  // a CDN, and the overlay page opens no network request but its own SSE
  // stream. These mirror BuildCard's private grouping logic (heroesOf, the
  // stack() idiom for repeat purchases) down to plain text, so the broadcast
  // gets the same categories the app's Build tab shows, not a flat 12-line
  // chronological dump.

  // Richest variant per hero itemId. Mirror Image illusions share the real
  // hero's itemId at level 1, so keeping the highest level is how the real
  // one wins instead of whichever was recorded first.
  const heroesFor = (p) => {
    const best = new Map();
    for (const h of (p.heroBuilds || [])) {
      if (!h || !h.itemId) continue;
      const prev = best.get(h.itemId);
      if (!prev || (h.finalLevel || 1) > (prev.finalLevel || 1)) best.set(h.itemId, h);
    }
    return Array.from(best.values()).map(h => ({ name: h.name || 'Hero', level: h.finalLevel || 1 }));
  };

  // Distinct combat units, opening tier plus whatever t2Units/t3Units add,
  // heroes excluded — a hero trained at tier 2 shows up in t2Units too.
  const unitsFor = (p) => {
    const heroIds = new Set();
    for (const h of (p.heroBuilds || [])) { if (h && h.itemId) heroIds.add(h.itemId); }
    const seen = new Set();
    const out = [];
    const take = (b) => {
      if (!b || !b.itemId || seen.has(b.itemId) || heroIds.has(b.itemId)) return;
      seen.add(b.itemId);
      out.push({ name: b.name || '', time: b.gameTimeFormatted || null });
    };
    for (const b of (p.buildPreview || [])) { if (b.type === 'unit') take(b); }
    for (const u of (p.t2Units || [])) take(u);
    for (const u of (p.t3Units || [])) take(u);
    return out.slice(0, 10);
  };

  const upgradesFor = (p) => {
    const best = new Map();
    for (const u of (p.upgradeTimeline || [])) {
      if (!u || !u.itemId) continue;
      const level = u.level || 1;
      const prev = best.get(u.itemId);
      if (!prev || level > prev.level) best.set(u.itemId, { name: u.name || 'Upgrade', level });
    }
    return Array.from(best.values());
  };

  // One entry per itemId with a count — six potions is one decision repeated,
  // not six lines. Same idiom as BuildCard.stack().
  const stackFor = (rows) => {
    const byId = new Map();
    for (const r of (rows || [])) {
      if (!r || !r.itemId) continue;
      let e = byId.get(r.itemId);
      if (!e) { e = { itemId: r.itemId, name: r.name || 'Item', count: 0 }; byId.set(r.itemId, e); }
      e.count++;
    }
    return Array.from(byId.values());
  };

  const richBuildFor = (p) => {
    if (!p) return null;
    const heroes = heroesFor(p);
    const units = unitsFor(p);
    const upgrades = upgradesFor(p);
    const bought = stackFor(p.itemPurchases);
    const IC = window.ItemClasses;
    const isConsumed = (e) => !!(IC && IC.isConsumed(e.itemId));
    const drop = (e) => ({ name: e.name, count: e.count });
    const kept = bought.filter(e => !isConsumed(e)).map(drop);
    const used = bought.filter(isConsumed).map(drop);
    const mercs = stackFor(p.mercenariesHired).map(drop);

    if (!heroes.length && !units.length && !upgrades.length &&
        !kept.length && !used.length && !mercs.length) return null;
    return { heroes, units, upgrades, kept, used, mercs };
  };

  window.createOverlayState = (deps) => {
    // deps: invoke, log, corpus(), the stored history used for head-to-head
    const PA = window.ProfileAggregate;
    const CAST_KEY = 'wc3v-cast';
    const readCast = () => {
      try {
        const raw = JSON.parse(localStorage.getItem(CAST_KEY) || 'null');
        if (!raw) return null;
        // The last game shown under the scoreboard is NOT restored. It is a
        // summary object, and rehydrating one out of localStorage would be a
        // second store nobody asked for. It refills the moment a game lands.
        raw.summary = null;
        return raw;
      } catch (e) { return null; }
    };
    const writeCast = (c) => {
      try {
        if (!c) localStorage.removeItem(CAST_KEY);
        else localStorage.setItem(CAST_KEY, JSON.stringify({ ...c, summary: null }));
      } catch (e) { /* a full quota costs the scoreboard a restart, not the app */ }
    };

    const st = {
      userName: localStorage.getItem('wc3v-user-name') || null,
      session: [],    // summaries of live games, in arrival order
      lastGame: null, // summary shown in the game panel (live only, or boot seed)
      scout: null,    // the live opponent, from scout.js, while a match is on
      demo: false,    // showing the labelled stand-in game for OBS setup
      // The casting scoreboard, typed in Stream → Casting. Persisted to
      // localStorage rather than to the store: it is the state of a broadcast
      // that is happening now, and it has to survive an app restart mid-series
      // without ever becoming a record of a game.
      cast: readCast()
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
          // The raw type rides along so the overlay can put the same mark on a
          // moment that the app's timeline does. Glyphs.forMoment owns the
          // type-to-glyph mapping; a second copy of it in the renderer would be
          // a second thing to keep in step.
          type: m.type || null,
          hero: m.type === 'heroKill' || m.type === 'heroTrade' || m.type === 'heroLostToCreeps'
        }));
    };

    // Hero name → itemId, learned from this machine's own replays.
    //
    // ProfileAggregate groups a player's openings by NAME, because a name is
    // what a profile is readable by, and an icon needs the id. Widening that
    // module for the overlay's benefit would change a file the client viewer
    // shares, so the two get put back together here instead: one pass over the
    // corpus that is already loaded for head-to-head.
    const heroIconIndex = () => {
      const idx = new Map();
      const corpus = (deps.corpus && deps.corpus()) || [];
      for (const g of corpus) {
        const players = g.players || {};
        for (const slot of Object.keys(players)) {
          for (const h of (players[slot].heroBuilds || [])) {
            if (h && h.name && h.itemId && !idx.has(h.name)) idx.set(h.name, h.itemId);
          }
        }
      }
      return idx;
    };

    // The three numbers, against the two baselines, for the user's own seat.
    //
    // This replaced a rail of pillar grades and a list of named mistakes. Five
    // integers on an invented 0-100 scale said nothing anybody could act on,
    // and a sentence about somebody's play does not belong on their stream.
    // Dominance, APM and hero kills are facts, and the comparison is what makes
    // them mean something.
    //
    // Only ever claimed for the user's own seat, the same rule the grader was
    // under: a benchmark shown against a stranger's game that the overlay is
    // rendering as a fallback would be measuring somebody who is not there.
    const metricsFor = (summary, v) => {
      if (!summary || !v || !v.mine) return null;
      // 1v1 only. Every baseline behind these deltas is built from duels, so a
      // team seat measured against them reads as a catastrophic deficit that is
      // really just a different game mode.
      if (summary.gameMode !== '1v1') return null;
      const GM = window.GameMetrics;
      if (!GM) return null;

      const m = GM.forSeat(summary, v.slot);
      if (!m) return null;

      const corpus = (deps.corpus && deps.corpus()) || null;
      const mine = (corpus && corpus.length)
        ? PA.baseline(corpus, st.userName, { matchup: v.matchup, excludeKey: summary.key })
        : null;
      // The race of the seat being measured, benchmarked against the OTHER
      // players of that race in this corpus. See ProfileAggregate.raceBaseline
      // for why it is the people you played rather than a published average.
      const race = window.RaceBaselines
        ? window.RaceBaselines.resolve(corpus, m.race,
          { excludeName: st.userName, excludeKey: summary.key })
        : null;

      const pick = (b, key) => {
        const cell = b && b[key];
        return (cell && cell.n >= MIN_BENCH_N && cell.median !== null) ? cell.median : null;
      };

      const rows = [];
      for (const spec of GM.METRICS) {
        const value = m[spec.key];
        if (value === null || value === undefined) continue;
        const you = pick(mine, spec.key);
        const theirs = pick(race, spec.key);
        rows.push({
          key: spec.key,
          label: spec.label,
          value: GM.format(spec.key, value),
          vsYou: GM.formatDelta(spec.key, value, you),
          vsRace: GM.formatDelta(spec.key, value, theirs),
          band: GM.band(spec.key, value, you)
        });
      }
      if (!rows.length) return null;

      return {
        rows,
        raceHead: window.RaceBaselines ? window.RaceBaselines.head(race) : 'VS RACE'
      };
    };

    // How the game actually went, from the same packed dominance/resource
    // series Home charts.
    //
    // This used to read the series down to numbers only, on the grounds that no
    // chart is legible on a small Browser Source. That was true of a CHART —
    // axes, ticks, a legend, four series. It is not true of one filled curve
    // against a midline, which is the one shape a viewer can read in half a
    // second from the sofa: above the line was your game, below it was theirs.
    // So the numbers stay and the curve comes with them.
    const momentumFor = (summary, v) => {
      if (!summary || !v || !v.mine) return null;

      // Control comes from GameMetrics, which weights the series by TIME. This
      // counted samples, and the series is not on a fixed grid: DominanceSeries
      // emits a pre/post pair around every momentum event, so a game with six
      // hero deaths had twelve samples clustered on twelve seconds carrying the
      // same weight as the minutes between them.
      let control = null;
      let lead = null;
      let leadAt = null;
      const GM = window.GameMetrics;
      const stats = GM ? GM.dominanceStats(summary, v.slot) : null;
      if (stats && stats.control !== null) control = Math.round(stats.control * 100);

      let curve = null;
      const dom = summary.dominance && summary.dominance.players && summary.dominance.players[v.slot];
      if (dom && dom.score && dom.score.length) {
        let best = 0;
        let bestAt = null;
        for (let i = 0; i < dom.score.length; i++) {
          if (dom.score[i] - 50 > best) { best = dom.score[i] - 50; bestAt = dom.t[i]; }
        }
        if (best > 0) { lead = Math.round(best); leadAt = PA.fmtMs(bestAt); }

        // Evenly spaced by INDEX, not by time. The curve is drawn with
        // preserveAspectRatio="none" across a fixed width, so what a viewer
        // reads off it is the shape of the game, and the clustered samples
        // around each momentum event are exactly the shape.
        const n = dom.score.length;
        const take = Math.min(CURVE_POINTS, n);
        curve = [];
        for (let i = 0; i < take; i++) {
          const at = take === 1 ? 0 : Math.round((i * (n - 1)) / (take - 1));
          curve.push(Math.round(dom.score[at]));
        }
      }

      let trade = null;
      const res = summary.resources && summary.resources.players;
      if (res && res[v.slot]) {
        const oppSlot = Object.keys(summary.players || {}).find(k => k !== v.slot);
        const mine = res[v.slot];
        const theirs = oppSlot ? res[oppSlot] : null;
        if (mine.goldLost && mine.goldLost.length && theirs &&
            theirs.goldLost && theirs.goldLost.length) {
          const myLoss = (mine.goldLost[mine.goldLost.length - 1] || 0) +
            (mine.lumberLost[mine.lumberLost.length - 1] || 0);
          const theirLoss = (theirs.goldLost[theirs.goldLost.length - 1] || 0) +
            (theirs.lumberLost[theirs.lumberLost.length - 1] || 0);
          // Positive means they lost more than you did.
          trade = Math.round(theirLoss - myLoss);
        }
      }

      let combat = null;
      const p = summary.players && summary.players[v.slot];
      const c = p && p.combat;
      if (c) {
        combat = {
          heroKills: (c.heroKills || []).length,
          heroDeaths: (c.heroDeaths || []).length,
          wipesFor: c.wipesFor || 0,
          wipesAgainst: c.wipesAgainst || 0,
          biggestSwing: c.biggestSwing
            ? { won: c.biggestSwing.won, swing: c.biggestSwing.swing, tf: c.biggestSwing.tf }
            : null
        };
      }

      if (control === null && trade === null && !combat) return null;
      return { control, curve, lead, leadAt, trade, combat };
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
        // The display name. The stored `map` is
        // "12_w3c_251104_0950_TurtleRock_v2.0.w3x", which nobody should put on
        // a broadcast.
        map: window.SummaryExtract.cleanMapName(st.lastGame.mapRaw || v.map) || v.map,
        mode: v.mode,
        h2h: h2hFor(st.lastGame, v),
        moments: momentsFor(st.lastGame, v),
        // Module key kept as `report` on purpose. Renaming it would silently
        // drop the panel from every overlay URL already pasted into an OBS
        // source, because shell.html filters unknown module names out.
        report: metricsFor(st.lastGame, v),
        momentum: momentumFor(st.lastGame, v),
        verdict: v.result || 'unknown',
        durationMs: v.durationMs,
        user: { name: v.name, race: v.race },
        opponent: v.opponent,
        heroOpener: v.heroOpener,
        // The id behind that name, for the portrait. ProfileAggregate reduces
        // heroOpener to a bare name and is shared with the client viewer, so
        // the id is read straight off the raw player here rather than widening
        // a module two products depend on.
        heroOpenerIcon: (me.heroOpener && me.heroOpener.itemId) || null,
        timings: {
          t2: v.t2 !== null ? PA.fmtMs(v.t2) : null,
          t3: v.t3 !== null ? PA.fmtMs(v.t3) : null,
          expansion: v.expansion !== null ? PA.fmtMs(v.expansion) : null,
          firstTower: v.firstTower !== null ? PA.fmtMs(v.firstTower) : null,
          apm: me.apm && me.apm.effectiveAverage ? String(Math.round(me.apm.effectiveAverage)) : null
        },
        build: richBuildFor(me)
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

      // A generated sentence about how you played used to sit here. The beat
      // below replaced it: a timestamp and a thing that happened is a reason to
      // open the app, and "economy lagged" is an opinion delivered by a
      // notification.
      return {
        title,
        body: [line, record].filter(Boolean).join(' · ') +
          (beat ? `\n${beat.time} ${beat.text}` : '')
      };
    };

    // Human players in a summary, the candidates for "which one is you".
    const candidatesIn = (summary) => Object.keys(summary && summary.players || {})
      .map(k => summary.players[k].name)
      .filter(Boolean);

    // Career-wide context the running session score can't carry by itself:
    // recent form over your last 10 decided games, and your record in the
    // matchup the last game was. Sample-size guarded the same way
    // ProfileAggregate gates its own coach sentences.
    const trendSummary = () => {
      const corpus = deps.corpus && deps.corpus();
      if (!corpus || !corpus.length || !st.userName) return null;
      const profile = PA.buildProfile(corpus, st.userName);
      if (!profile.games) return null;

      const recentForm = profile.recentForm.n >= 6 ? profile.recentForm : null;

      const v = viewFor(st.lastGame);
      const mu = v && v.matchup ? profile.matchups.find(m => m.matchup === v.matchup) : null;
      const matchup = mu && mu.games >= 8
        ? { key: mu.matchup, wins: mu.wins, losses: mu.losses, winRate: mu.winRate, games: mu.games }
        : null;

      if (!recentForm && !matchup) return null;
      return { recentForm, matchup };
    };

    // ── The casting overlay's block ─────────────────────────────────────────
    //
    // Everything else in this payload is derived from replays. This is the one
    // part somebody types, in Stream → Casting, and it is live state rather than
    // stored metadata for a reason: a series score needs ordered games and a
    // running total, which free tags cannot express, and a caster changes it
    // between games anyway.
    //
    // The stat bar under it is symmetric. Two columns of the same numbers, no
    // deltas and no baselines, because every baseline this app has is built out
    // of ONE person's history and on a broadcast neither player is that person.
    const castGamePayload = () => {
      const summary = st.cast && st.cast.summary;
      const GM = window.GameMetrics;
      if (!summary || !GM) return null;

      const slots = Object.keys(summary.players || {});
      if (slots.length < 2) return null;

      const a = GM.forSeat(summary, slots[0]);
      const b = GM.forSeat(summary, slots[1]);
      if (!a || !b) return null;

      const rows = [];
      for (const spec of GM.METRICS) {
        if (a[spec.key] === null && b[spec.key] === null) continue;
        // Which side leads, decided here rather than in the renderer, because
        // "higher is better" is a property of the metric. APM is deliberately
        // never marked: it says how fast somebody's hands moved, and on a
        // broadcast that is not a verdict to hand out.
        let lead = null;
        if (spec.banded && a[spec.key] !== null && b[spec.key] !== null && a[spec.key] !== b[spec.key]) {
          lead = a[spec.key] > b[spec.key] ? 'a' : 'b';
        }
        rows.push({
          label: spec.label,
          a: GM.format(spec.key, a[spec.key]),
          b: GM.format(spec.key, b[spec.key]),
          lead
        });
      }

      return {
        map: window.SummaryExtract.cleanMapName(summary.mapRaw || summary.map) || summary.map,
        durationMs: summary.durationMs,
        seats: [
          { name: a.name, race: a.race },
          { name: b.name, race: b.race }
        ],
        rows
      };
    };

    const castPayload = () => {
      const c = st.cast;
      if (!c) return null;
      // A cast block with nothing in it is not a block. The overlay would draw
      // an empty scoreboard on somebody's stream.
      if (!c.event && !c.round && !c.badge && !(c.a && c.a.name) && !(c.b && c.b.name)) return null;
      return {
        event: c.event || null,
        round: c.round || null,
        badge: c.badge || null,
        a: c.a || null,
        b: c.b || null,
        scoreA: c.scoreA || 0,
        scoreB: c.scoreB || 0,
        game: castGamePayload()
      };
    };

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
        scout: st.scout,
        trend: trendSummary(),
        game: gamePayload(),
        cast: castPayload()
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
    //
    // It is also the only way the redesign gets looked at before a real game
    // lands, so it has to exercise every surface the card can draw: hero
    // portraits on both sides, a dominance curve with a real shape, and banded
    // report rows, since an unbanded row renders nothing at all.
    const DEMO = {
      updatedAt: 0,
      user: 'You',
      demo: true,
      needsIdentity: false,
      candidates: [],
      session: { wins: 2, losses: 1, unknown: 0, streak: { kind: 'win', count: 2 } },
      trend: {
        recentForm: { n: 10, wins: 6, losses: 4 },
        matchup: { key: 'HvO', wins: 18, losses: 11, winRate: 62, games: 29 }
      },
      scout: {
        opponent: { name: 'NextOpponent', race: 'U' },
        map: 'Turtle Rock',
        ladder: { rank: 42, mmr: 1850, games: 120, wins: 66, losses: 54 },
        h2h: { games: 4, wins: 3, losses: 1 },
        openers: [
          { name: 'Death Knight', itemId: 'Udea' },
          { name: 'Crypt Lord', itemId: 'Ucrl' }
        ],
        t2You: '5:12',
        t2Them: '5:40',
        expansionRate: 62
      },
      game: {
        gameId: 'demo',
        map: 'Echo Isles',
        mode: '1v1',
        verdict: 'win',
        durationMs: 14 * 60 * 1000,
        user: { name: 'You', race: 'H' },
        opponent: { name: 'Opponent', race: 'O' },
        heroOpener: 'Archmage',
        heroOpenerIcon: 'Hamg',
        timings: { t2: '5:40', t3: null, expansion: '9:41', firstTower: null, apm: '187' },
        h2h: { name: 'Opponent', games: 5, wins: 3, losses: 2 },
        report: {
          raceHead: 'VS HUMAN',
          rows: [
            { key: 'dominanceAvg', label: 'Dominance', value: '58', vsYou: '+6', vsRace: '+4', band: 'good' },
            { key: 'apmEffective', label: 'APM', value: '187', vsYou: '−12', vsRace: '+31', band: null },
            { key: 'heroKills', label: 'Hero kills', value: '2', vsYou: '+0.5', vsRace: '—', band: 'good' }
          ]
        },
        momentum: {
          control: 63, lead: 24, leadAt: '14:02', trade: 1850,
          // A game that was even, went behind, and was won late. A flat line
          // would have looked like a working sparkline while hiding every way
          // the drawing can be wrong.
          curve: [50, 49, 52, 48, 45, 43, 47, 52, 55, 53, 58,
            62, 60, 57, 64, 70, 68, 73, 79, 85, 88],
          combat: { heroKills: 2, heroDeaths: 1, wipesFor: 1, wipesAgainst: 0,
            biggestSwing: { won: true, swing: 1200, tf: '11:58' } }
        },
        moments: [
          { time: '6:12', text: 'You expanded', type: 'expansion', hero: false },
          { time: '8:42', text: 'You killed Blademaster', type: 'heroKill', hero: true },
          { time: '11:58', text: 'Fight at the expansion, you came out ahead', type: 'fight', hero: false }
        ],
        build: {
          heroes: [{ name: 'Archmage', level: 4 }],
          units: [
            { name: 'Footman', time: '1:22' },
            { name: 'Rifleman', time: '4:40' },
            { name: 'Sorceress', time: '6:55' }
          ],
          upgrades: [{ name: 'Iron Forged Swords', level: 2 }],
          kept: [{ name: 'Claws of Attack +12', count: 1 }],
          used: [{ name: 'Healing Salve', count: 3 }],
          mercs: []
        }
      }
    };

    return {
      publish,
      sessionSummary,
      toastFor,

      // ── Casting ───────────────────────────────────────────────────────────
      //
      // The Stream screen's Casting panel owns this. Every setter republishes,
      // because the point of a caster's control is that the change is on screen
      // before they let go of the mouse.
      get cast () { return st.cast; },
      setCast (next) {
        // The last finished game is carried forward rather than taken from the
        // caller. The panel edits names and scores; which replay the stat bar
        // is showing is decided by the watcher landing one.
        const summary = st.cast && st.cast.summary;
        st.cast = next ? { ...next, summary: next.summary || summary || null } : null;
        writeCast(st.cast);
        publish();
        return st.cast;
      },

      // What the OBS source is showing right now, for the in-window preview.
      previewState: () => (st.demo ? DEMO : buildPayload()),
      async publishDemo () {
        st.demo = true;
        await send(DEMO);
      },
      get isDemo () { return !!st.demo; },
      // The opponent scout.js just found, or null when the match ended or was
      // never found. This is the one thing the overlay can show before a
      // replay exists at all, since it comes from polling the ladder API
      // rather than reading the game.
      publishScout (match, ladder, book) {
        const opp = match && match.opponents && match.opponents[0];
        const icons = opp && book ? heroIconIndex() : null;
        const next = opp ? {
          opponent: { name: opp.name, race: opp.race },
          map: window.SummaryExtract.cleanMapName(match.map) || match.map,
          ladder: ladder ? {
            rank: ladder.rank, mmr: ladder.mmr,
            games: ladder.games, wins: ladder.wins, losses: ladder.losses
          } : null,
          h2h: (book && book.h2h) || null,
          // Name plus the id of its portrait. The name is the data; the icon is
          // recognition, and a viewer who cannot read a 0.8rem hero name from
          // the sofa knows the Death Knight on sight.
          openers: book
            ? book.openers.map(o => ({ name: o.hero, itemId: (icons && icons.get(o.hero)) || null }))
            : [],
          t2You: book && book.t2You !== null && book.t2You !== undefined ? PA.fmtMs(book.t2You) : null,
          t2Them: book && book.t2Them !== null && book.t2Them !== undefined ? PA.fmtMs(book.t2Them) : null,
          expansionRate: book ? book.expansionRate : null
        } : null;
        if (!next && !st.scout) return;
        st.scout = next;
        send(buildPayload());
      },
      recordGame (summary) {
        st.session.push(summary);
        st.lastGame = summary;
        // The casting stat bar follows the newest game too. A caster running a
        // series watches each game finish and land under the scoreboard without
        // touching anything.
        if (st.cast) { st.cast.summary = summary; }
        publish();
      },
      // Boot seeding. Show the most recent stored game instead of an empty
      // card, without letting it count toward the session score.
      seedLastGame (summary) {
        if (st.lastGame || !summary) return;
        st.lastGame = summary;
        if (st.cast && !st.cast.summary) st.cast.summary = summary;
        publish();
      },
      // A caster picking a specific replay to show under the scoreboard, rather
      // than waiting for one to finish. Used by the Library.
      setCastGame (summary) {
        if (!st.cast) return;
        st.cast.summary = summary || null;
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
