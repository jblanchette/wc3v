// A stored summary, as the Match Summary screen's model.
//
// The other half of the seam. `client/js/MatchSummaryView.js` draws three tabs
// and knows about neither app; the viewer feeds it from live parse objects and
// this feeds it from a summary on disk. Neither app draws a tab.
//
// This module owns NO rendering, the same rule dominance-panel.js and
// chart-panel.js are under. If it ever grows a `document.createElement`, the
// seam has leaked.
//
// ── Why this is thin ────────────────────────────────────────────────────────
//
// Schema v5 stores what BuildOrderData produces, so `tierProduction` and
// `finalSnapshot` pass straight through: the same class derived them, on the
// same event stream, as the viewer is looking at. Only the things that live
// OUTSIDE BuildOrderData need converting, and all of those are shape changes
// rather than recalculations:
//
//   items and mercs   stored one row per transaction, wanted stacked per id
//   research          `upgradeTimeline` field names
//   APM               no stored peak; it is the max of the per-minute series
//   the two tracks    a sampled economyTrack, wanted as {t, v} points
//   camps             `claimOwnerTeamId` → `ownerTeamId`, and so on
//
// ── Colour ──────────────────────────────────────────────────────────────────
//
// The warm race ramp, not in-game player colours, matching the dominance chart
// on the same screen. The token layer forbids saturated colour on warm
// surfaces, and a stored summary has no player-colour field anyway: schema v5
// drops it on purpose rather than inviting the two apps to disagree.

(function () {
  'use strict';

  const RACE_COLOR = {
    H: '--race-warm-H', O: '--race-warm-O', E: '--race-warm-E',
    U: '--race-warm-U', R: '--race-warm-R', N: '--race-warm-N'
  };

  // The viewer's RaceLabels, which live in ClientPlayer.js and are not shipped
  // here. Four entries is not worth a module.
  const RACE_LABEL = { O: 'ORC', H: 'HU', U: 'UD', E: 'NE', R: 'RND', N: 'NEU' };

  const colorFor = (race) => {
    const token = RACE_COLOR[race] || RACE_COLOR.N;
    const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    return v || '#8a8378';
  };

  // Battle-tag suffixes are noise beside a portrait, the same call the
  // dominance readout makes.
  const cleanName = (name) => String(name || 'Player').replace(/#.*$/, '');

  const stack = (rows) => (window.BuildCard && window.BuildCard.stack)
    ? window.BuildCard.stack(rows).map(e =>
      ({ itemId: e.itemId, name: e.name, count: e.count, gold: e.gold }))
    : [];

  const apmOf = (p) => {
    const apm = p.apm;
    if (!apm) return null;
    const perMinute = apm.effectivePerMinute || [];
    return {
      perMinute,
      // Not stored: it is the max of a series the summary already carries, and
      // a derived scalar in the schema is one more thing to keep in step.
      peak: perMinute.length ? Math.max.apply(null, perMinute) : 0,
      average: apm.effectiveAverage || 0,
      categories: apm.categories || {}
    };
  };

  const trackOf = (p, valueFn) =>
    (p.economyTrack || []).map(s => ({ t: s.gameTimeMs, v: valueFn(s) }));

  window.SummaryModel = {
    // Why this summary cannot draw the screen, in the caller's words, or null
    // when it can. Kept apart from build() so the frame can choose between a
    // re-read offer and the old report without building anything first.
    unavailable (summary) {
      if (!window.MatchSummaryView) return 'The match summary is unavailable in this build.';
      const slots = Object.keys((summary && summary.players) || {});
      if (!slots.length) return 'No players in this game.';
      if (slots.some(s => !summary.players[s].build)) {
        return (summary.schemaVersion || 1) < 5 ? 'stale' : 'No build data for this game.';
      }
      return null;
    },

    // Returns the MatchSummaryView model, or null when unavailable() has a
    // reason. `seat` puts the reader's own column first, the same rule the
    // build cards and the dominance readout follow.
    build (summary, seat) {
      if (this.unavailable(summary)) return null;

      const slots = Object.keys(summary.players);
      slots.sort((a, b) => (a === seat ? -1 : b === seat ? 1 : a.localeCompare(b)));

      const raceIcons = (window.BuildOrderData && window.BuildOrderData.CONFIG &&
        window.BuildOrderData.CONFIG.raceStarterIcons) || {};

      const players = slots.map(slot => {
        const p = summary.players[slot];
        const build = p.build;
        const color = colorFor(p.race);
        return {
          name: cleanName(p.name),
          race: p.race,
          raceLabel: RACE_LABEL[p.race] || '??',
          // One colour, used for the name, the race label, the lines and the
          // bars. The viewer separates the two because it has a player colour
          // AND a race accent; here they are the same warm hue.
          raceAccent: color,
          raceIconId: raceIcons[p.race] || '',
          color,
          teamId: p.teamId === undefined ? null : p.teamId,
          // The reader's own seat, marked on the screen rather than only
          // sorted first. This is a desktop-only claim: the app asks who you
          // are once and remembers it, and the viewer, which loads replays of
          // strangers, has no seat to point at. The shared renderer treats the
          // flag as optional for exactly that reason.
          isYou: seat !== null && seat !== undefined && slot === seat,

          tierProduction: build.tierProduction,
          finalSnapshot: build.finalSnapshot,
          hasExpansion: build.hasExpansion,
          tier2Time: p.tier2Time === undefined ? null : p.tier2Time,
          tier3Time: p.tier3Time === undefined ? null : p.tier3Time,

          apm: apmOf(p),
          itemPurchases: stack(p.itemPurchases),
          itemUses: stack(p.itemUses),
          mercenaries: stack(p.mercenariesHired),
          researchTimeline: (p.upgradeTimeline || []).map(u => ({
            itemId: u.itemId,
            name: u.name || u.itemId || '',
            level: u.level || 0,
            timeFormatted: u.gameTimeFormatted || ''
          })),
          // heroesOf, not heroBuilds raw: a Blademaster's Mirror Image
          // illusions are hero-flagged units carrying his own itemId, and the
          // dedupe for that lives in BuildCard.
          heroInventories: (window.BuildCard ? window.BuildCard.heroesOf(p) : [])
            .map(h => ({ name: h.name, items: (h.items || []).filter(i => i.itemId) })),

          supplyTrack: trackOf(p, s => s.supplyUsed || 0),
          workerTrack: trackOf(p, s => s.totalWorkers || 0)
        };
      });

      return {
        matchEndMs: summary.durationMs || 0,
        players,
        camps: (summary.neutralCamps || []).map(c => ({
          groupId: c.groupId,
          totalLevel: c.totalLevel || 0,
          claimState: c.claimState || 0,
          ownerTeamId: c.claimOwnerTeamId === undefined ? null : c.claimOwnerTeamId,
          order: c.order || 0,
          timeFormatted: c.claimTimeFormatted || '',
          units: c.units || [],
          heroXp: c.heroXp || []
        }))
      };
    }
  };
})();
