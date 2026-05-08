(function () {
// CompareMatcher — given a user's replay summary, finds the best pro
// replay to compare against. Tiered match preference, compatibility
// scoring, lazy summary loading.
//
// The user's replay is the "needle"; pros are the "haystack". We want:
//   1. Auto-pick a pro that's a good fit (race + matchup + archetype + map)
//   2. Surface the next-best alternatives as switcher chips
//   3. If nothing is a great fit, return the closest matches anyway and
//      let the UI explain why each one isn't a perfect match
//   4. Let users with detected-but-not-matched archetypes pick their own
//      build via an "advanced" view
//
// "Build" detection: today we just use archetype. Future: try to identify
// which named build the user attempted (DK Fiend Standard etc) by looking
// at hero opener + key buildings + key units.

const CompareMatcher = class {
  constructor () {
    this.proIndex = null;        // [{replayId, playerSlot, ...metadata}]
    this.summaryCache = new Map();
    this.manifestPromise = null;
  }

  // Lazy-load the builds-manifest and flatten its replays into a pro index.
  async loadIndex () {
    if (this.proIndex) return this.proIndex;
    if (!this.manifestPromise) {
      this.manifestPromise = fetch('/data/builds-manifest.json', { credentials: 'omit' })
        .then(r => r.ok ? r.json() : { builds: [] })
        .catch(() => ({ builds: [] }));
    }
    const manifest = await this.manifestPromise;

    const seen = new Set();
    const index = [];
    for (const b of (manifest.builds || [])) {
      for (const r of (b.replays || [])) {
        if (!r.replayId) continue;
        const key = `${r.replayId}::${r.playerSlot}`;
        if (seen.has(key)) continue;
        seen.add(key);
        index.push({
          replayId: r.replayId,
          playerSlot: String(r.playerSlot || '1'),
          playerName: r.playerName,
          opponentName: r.opponentName,
          map: r.map,
          tournament: r.tournamentId,
          stage: r.stage,
          fingerprint: r.fingerprint || null,
          buildId: b.id,
          buildName: b.name,
          buildRace: b.race,           // user race in the build (H/O/E/U)
          buildMatchups: b.matchups || [],  // ['UvO','UvH']
          buildOpener: b.opener,
          buildGamePlan: b.gamePlan,
          buildArmy: b.army
        });
      }
    }
    this.proIndex = index;
    return index;
  }

  // Fetch a pro replay's summary JSON. Cached.
  async loadSummary (replayId) {
    if (this.summaryCache.has(replayId)) return this.summaryCache.get(replayId);
    const promise = fetch(`/data/summaries/${encodeURIComponent(replayId)}.json`, { credentials: 'omit' })
      .then(r => r.ok ? r.json() : null)
      .catch(() => null);
    this.summaryCache.set(replayId, promise);
    return promise;
  }

  // Score a pro entry's compatibility with a user replay (no analyzer run
  // required). Returns 0..100; higher is better. Used to rank candidates.
  scoreCandidate (userSummary, userSlot, proEntry) {
    const u = userSummary.players[String(userSlot)];
    if (!u) return 0;
    let score = 0;

    // Race match is the floor — without it nothing else matters much.
    if (proEntry.buildRace === u.race) score += 50;

    // Matchup match: derive user matchup from summary races.
    const userMu = matchupString(userSummary, userSlot);
    if (userMu && proEntry.buildMatchups && proEntry.buildMatchups.includes(userMu)) {
      score += 25;
    }

    // Same map (canonical name substring) bumps score.
    if (proEntry.map && userSummary.map) {
      const a = canon(proEntry.map), b = canon(userSummary.map);
      if (a && b && (a.includes(b) || b.includes(a))) score += 10;
    }

    // Archetype match — needs the pro's summary, but we can use opener/
    // gamePlan hints from the build manifest as a cheap proxy first.
    // (Real archetype check happens after summary is loaded.)
    if (u.archetype && u.archetype !== 'unknown') {
      const expected = inferArchetypeFromBuild(proEntry);
      if (expected && expected === u.archetype) score += 15;
    }

    return score;
  }

  // Find candidates ranked by compatibility score. Returns top N candidates,
  // each annotated with two boolean flags:
  //   `grades`     — passes the analyzer's duration gate (60% min ratio,
  //                  both >= 90s). Without this, a perfect metadata match
  //                  can be auto-picked against a pro whose game length
  //                  doesn't overlap with the user's, producing zero graded
  //                  categories.
  //   `divergent`  — user's primary trained unit differs sharply from the
  //                  pro's (top-1 mismatch + low Jaccard). Without this, a
  //                  HU footman user can be auto-picked against a HU rifle
  //                  pro and receive an A+ on a bogus comparison.
  //
  // Final sort, descending preference:
  //   1. graded + same-build  (the ideal match)
  //   2. graded + divergent build
  //   3. ungraded + same-build
  //   4. ungraded + divergent build
  // Ties within each tier broken by metadata score.
  async rankCandidates (userSummary, userSlot, { limit = 10 } = {}) {
    const index = await this.loadIndex();
    const scored = index
      .map(entry => ({ entry, score: this.scoreCandidate(userSummary, userSlot, entry) }))
      .filter(c => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const userDur = (userSummary && userSummary.durationMs) || 0;
    const userPlayer = userSummary && userSummary.players && userSummary.players[String(userSlot)];
    const compute = (typeof window !== 'undefined' && window.ReplayAnalyzer)
      ? window.ReplayAnalyzer.computeCompositionSimilarity
      : null;

    const annotated = await Promise.all(scored.map(async (c) => {
      const summary = await this.loadSummary(c.entry.replayId);
      const proDur = (summary && summary.durationMs) || 0;
      const grades = this._durationOk(userDur, proDur);
      let composition = null;
      if (compute && summary && userPlayer) {
        const proPlayer = summary.players && summary.players[String(c.entry.playerSlot)];
        if (proPlayer) composition = compute(userPlayer, proPlayer);
      }
      const divergent = !!(composition && composition.divergent);
      return Object.assign({}, c, { grades, composition, divergent });
    }));

    annotated.sort((a, b) => {
      // Tier 1: graded vs ungraded
      if (a.grades !== b.grades) return a.grades ? -1 : 1;
      // Tier 2: same-build vs divergent (within graded class)
      if (a.divergent !== b.divergent) return a.divergent ? 1 : -1;
      // Tier 3: metadata score
      return b.score - a.score;
    });
    return annotated;
  }

  // Mirrors the duration gate in ReplayAnalyzer.compare(). Kept in sync
  // intentionally — if the analyzer's gate changes, this must too.
  _durationOk (userDur, proDur) {
    if (!userDur || !proDur) return false;
    const min = Math.min(userDur, proDur);
    const max = Math.max(userDur, proDur);
    if (min < 90_000) return false;
    return (min / max) >= 0.6;
  }

  // Self-match short-circuit. If the user re-uploaded a replay that's already
  // in our pro library, the content fingerprint will match a manifest entry
  // exactly — so the user sees the canonical pro card with 100/100. Returns
  // null if no fingerprint is set or no entry matches.
  async findByFingerprint (userSummary) {
    if (!userSummary || !userSummary.fingerprint) return null;
    const index = await this.loadIndex();
    const fp = userSummary.fingerprint;
    return index.find(e => e.fingerprint && e.fingerprint === fp) || null;
  }

  // Heuristic: did the user upload a pro tournament replay we don't have
  // indexed? Catches the case where the player name in the user's selected
  // slot matches a known pro in our manifest but the fingerprint doesn't
  // match any entry (different game we haven't catalogued). Used by the UI
  // to warn that pro-vs-unknown comparisons won't grade meaningfully.
  async detectProInUpload (userSummary, userSlot) {
    await this.loadIndex();
    const player = userSummary && userSummary.players && userSummary.players[String(userSlot)];
    const userName = player && player.name ? String(player.name).trim() : '';
    if (!userName) return null;
    const lower = userName.toLowerCase();
    const hit = this.proIndex.find(e => e.playerName && String(e.playerName).toLowerCase() === lower);
    if (!hit) return null;
    return { proName: hit.playerName, uploadedName: userName };
  }

  // Highest-level helper: pick the auto-match, return null if no candidate
  // clears the "good enough" bar. Order:
  //   1. Fingerprint match → that's the same .w3g, return it.
  //   2. Otherwise, the top candidate must clear THREE bars:
  //      - metadata score ≥ 85
  //      - grades (analyzer duration gate passes)
  //      - non-divergent build (signature unit matches OR enough overlap)
  //   Failing any of those, return null and let the UI fall back to a
  //   labelled lower-confidence state instead of greenlighting a bad match.
  async autoPick (userSummary, userSlot) {
    const fpHit = await this.findByFingerprint(userSummary);
    if (fpHit) return fpHit;

    const ranked = await this.rankCandidates(userSummary, userSlot, { limit: 5 });
    if (!ranked.length) return null;
    const top = ranked[0];
    if (top.grades && !top.divergent && top.score >= 85) return top.entry;
    return null;
  }
};

// Helpers (file-local).

const canon = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

const matchupString = (summary, userSlot) => {
  if (!summary || !summary.players) return null;
  const user = summary.players[String(userSlot)];
  if (!user) return null;
  // Find an opponent (any non-user, non-neutral, slot < 24).
  const opponents = Object.keys(summary.players)
    .filter(k => k !== String(userSlot))
    .map(k => summary.players[k])
    .filter(p => !p.isNeutralPlayer && p.race && p.race !== 'R');
  if (!opponents.length) return null;
  // Use the first opponent's race for now. Multi-opponent (FFA) gets the
  // first one — fine for v1.
  return `${user.race}v${opponents[0].race}`;
};

const inferArchetypeFromBuild = (entry) => {
  // Cheap mapping: build manifest tags → archetype.
  if (entry.buildOpener === 'expand') return 'fast-expand';
  if (entry.buildOpener === 'fast-tech') return 'tech';
  if (entry.buildOpener === 'rush' && entry.buildArmy === 'ground') return '1-base-t2';
  if (entry.buildOpener === 'standard') return '1-base-t2';
  return null;
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CompareMatcher;
}
if (typeof window !== 'undefined') {
  window.CompareMatcher = CompareMatcher;
}
})();
