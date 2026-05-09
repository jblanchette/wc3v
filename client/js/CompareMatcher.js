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
  // myReplays (optional): a MyReplays instance. When provided, IDB records
  // flagged isReference=true are merged into the candidate pool alongside the
  // curated builds-manifest entries. Reference entries carry isUserReference=
  // true so the chooser UI can split them into their own column.
  constructor (myReplays = null) {
    this.proIndex = null;        // [{replayId, playerSlot, ...metadata}]
    this.summaryCache = new Map();
    this.manifestPromise = null;
    this.myReplays = myReplays;
    this.localSummaryById = new Map();  // 'local::<id>' → cachedSummary
  }

  // Bust the cached index — call after the user marks/unmarks a reference so
  // future rankCandidates calls see the new pool.
  invalidate () {
    this.proIndex = null;
    this.localSummaryById.clear();
  }

  // Lazy-load the builds-manifest and flatten its replays into a pro index.
  // Also pulls IDB records flagged isReference=true (when MyReplays was passed
  // to the constructor) and appends them with isUserReference=true.
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
        // Derive opponent race from the FIRST matchup string ("UvO" → "O").
        // Multi-matchup builds (e.g. ["UvO","UvH"]) lose nuance here, but
        // the chooser only needs a representative opponent race for the
        // visual chip; users picking between multi-matchup builds rely on
        // the dot pattern + build name for finer disambiguation.
        const firstMatchup = (b.matchups && b.matchups[0]) || '';
        const oppRace = firstMatchup.length === 3 ? firstMatchup.charAt(2) : null;
        index.push({
          replayId: r.replayId,
          playerSlot: String(r.playerSlot || '1'),
          playerName: r.playerName,
          opponentName: r.opponentName,
          opponentRace: oppRace,
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
          buildArmy: b.army,
          // Visual hooks for the chooser UI: heroes the build features and
          // the build description (1-line elevator pitch).
          heroItemIds: Array.isArray(b.heroItemIds) ? b.heroItemIds.slice(0, 3) : [],
          heroOpener: b.heroOpener || null,
          buildDescription: b.description || null,
          isUserReference: false
        });
      }
    }

    // Merge user-flagged references from IndexedDB. We expand each
    // reference replay into ONE ENTRY PER NON-NEUTRAL SLOT — both players
    // are pros (it's a pro-vs-pro replay), so both can be valid comparison
    // anchors. A Happy-vs-Moon reference indexes as both "Happy (UD)" and
    // "Moon (NE)"; the user uploading a UD replay sees Happy, a NE replay
    // sees Moon. This eliminates the "which slot is the pro?" prompt
    // entirely and means the user doesn't accidentally pick the wrong one.
    if (this.myReplays && typeof this.myReplays.list === 'function') {
      try {
        const records = await this.myReplays.list();
        for (const rec of records) {
          if (!rec || !rec.isReference) continue;
          // The list() result is the lightweight summary — fetch the full
          // record to get cachedSummary (unless an earlier call already did).
          let full = rec;
          if (!full.cachedSummary) {
            try { full = await this.myReplays.get(rec.id); } catch { full = rec; }
          }
          let cached = full && full.cachedSummary;
          // Lazy-recover: if cachedSummary is missing (old record, or
          // SummaryExtract wasn't loaded when the flag was set), compute
          // it now from parsedJson and write it back. This keeps newly
          // flagged references discoverable even if the original
          // setReferenceState call fell through silently.
          if (!cached && full && full.parsedJson && window.CompareInline && window.CompareInline.buildUserSummary) {
            try {
              if (window.CompareInline.ensureMapFoldersManifest) {
                await window.CompareInline.ensureMapFoldersManifest();
              }
              cached = window.CompareInline.buildUserSummary(full);
              if (cached) {
                full.cachedSummary = cached;
                try { await this.myReplays.put(full); } catch {}
              }
            } catch (e) {
              if (typeof console !== 'undefined') console.warn('[CompareMatcher] lazy summary build failed for', rec.id, e);
            }
          }
          if (!cached || !cached.players) continue;
          const replayId = `local::${full.id}`;
          this.localSummaryById.set(replayId, cached);
          // Index every non-neutral slot — the reference replay is a
          // pro-vs-pro game, both players are valid comparison anchors.
          for (const slot of Object.keys(cached.players)) {
            const proPlayer = cached.players[slot];
            if (!proPlayer || proPlayer.isNeutralPlayer) continue;
            if (!proPlayer.race || proPlayer.race === 'R') continue;
            const matchups = deriveMatchupsForSlot(cached, slot);
            const heroIds = (proPlayer.heroBuilds || []).map(h => h && h.itemId).filter(Boolean).slice(0, 3);
            index.push({
              replayId,
              playerSlot: String(slot),
              playerName: proPlayer.name || full.referenceLabel || 'Reference',
              opponentName: deriveOpponentName(cached, slot),
              opponentRace: deriveOpponentRace(cached, slot),
              map: cached.map || full.mapName,
              tournament: null,
              stage: null,
              fingerprint: cached.fingerprint || null,
              buildId: `${replayId}::${slot}`,
              buildName: full.referenceLabel || `Your reference · ${proPlayer.name || ''}`.trim(),
              buildRace: proPlayer.race,
              buildMatchups: matchups,
              buildOpener: null,
              buildGamePlan: null,
              buildArmy: null,
              heroItemIds: heroIds,
              heroOpener: null,
              buildDescription: null,
              isUserReference: true,
              sourceRecordId: full.id,
              referenceArchetype: proPlayer.archetype || null
            });
          }
        }
      } catch (e) {
        // Swallow — user references are a bonus, not load-bearing.
        if (typeof console !== 'undefined') console.warn('[CompareMatcher] failed to load references:', e);
      }
    }

    this.proIndex = index;
    return index;
  }

  // Fetch a pro replay's summary JSON. Cached. Local-reference replayIds
  // (prefix "local::") are served from this.localSummaryById, populated by
  // loadIndex(); never hit the network for those.
  async loadSummary (replayId) {
    if (replayId && replayId.startsWith && replayId.startsWith('local::')) {
      return this.localSummaryById.get(replayId) || null;
    }
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
    // For user references we have the real archetype on hand, so use it.
    if (u.archetype && u.archetype !== 'unknown') {
      const expected = proEntry.isUserReference
        ? proEntry.referenceArchetype
        : inferArchetypeFromBuild(proEntry);
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
    // User references are always retained regardless of metadata score —
    // they're a small curated set the USER assembled, and hiding one
    // because it doesn't share a race with the current replay is more
    // confusing than helpful (they just uploaded it; they expect to see
    // it). Curated entries keep the score > 0 filter so the chooser
    // doesn't get spammed with the full manifest on every imperfect match.
    const scored = index
      .map(entry => ({ entry, score: this.scoreCandidate(userSummary, userSlot, entry) }))
      .filter(c => c.score > 0 || c.entry.isUserReference)
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

  // Highest-level helper: pick the auto-match, return null if anything other
  // than a structurally exact match exists.
  //
  // Order:
  //   1. Fingerprint match → same .w3g, return it (synthetic perfect-fit).
  //   2. Iterate candidates and return the first one that is *exact*:
  //        - race correct      (proEntry.buildRace === user race)
  //        - matchup correct   (user matchup ∈ proEntry.buildMatchups)
  //        - archetype correct (user archetype matches and is not 'unknown')
  //        - grades            (analyzer duration gate passes)
  //        - non-divergent     (signature unit overlaps the pro's)
  //      Map can differ — same-map adds polish but isn't required for "exact"
  //      per product spec. The previous score≥85 heuristic was loose enough
  //      that race + matchup + map (no archetype match) qualified — players
  //      then complained the match wasn't really for their build.
  //   3. When both a curated and a reference replay are exact, prefer
  //      curated (vetted, builds-manifest data) over user-supplied. The
  //      candidate ranking already places ungraded last; among graded +
  //      same-build, curated comes ahead of references via this loop.
  //
  // Returns null when no candidate clears all five gates — the UI then
  // renders the chooser so the user can pick deliberately.
  async autoPick (userSummary, userSlot) {
    const fpHit = await this.findByFingerprint(userSummary);
    if (fpHit) return fpHit;

    const ranked = await this.rankCandidates(userSummary, userSlot, { limit: 8 });
    if (!ranked.length) return null;
    const userPlayer = userSummary.players[String(userSlot)] || {};
    const userMu = matchupString(userSummary, userSlot);

    // Two passes: prefer curated exact match before reference exact match,
    // but otherwise the same gate.
    const isExact = (c) => exactMatch(c, userPlayer, userMu);
    const curated = ranked.find(c => !c.entry.isUserReference && isExact(c));
    if (curated) return curated.entry;
    const ref = ranked.find(c => c.entry.isUserReference && isExact(c));
    if (ref) return ref.entry;
    return null;
  }
};

// Structural exact-match gate. All conditions must hold; map is intentionally
// not required (per product: map can differ, build/race/matchup must match).
const exactMatch = (annotated, userPlayer, userMu) => {
  if (!annotated || !annotated.entry) return false;
  if (!annotated.grades) return false;
  if (annotated.divergent) return false;
  const e = annotated.entry;
  if (!userPlayer.race || e.buildRace !== userPlayer.race) return false;
  if (!userMu || !(e.buildMatchups || []).includes(userMu)) return false;
  if (!userPlayer.archetype || userPlayer.archetype === 'unknown') return false;
  const expected = e.isUserReference
    ? e.referenceArchetype
    : inferArchetypeFromBuild(e);
  if (!expected || expected !== userPlayer.archetype) return false;
  return true;
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

// Build a [matchup] array for a reference entry: the pro slot's race vs
// the first non-neutral opponent in the cached summary. References don't
// have curated buildMatchups so we synthesize one from the cached summary.
const deriveMatchupsForSlot = (cachedSummary, proSlot) => {
  if (!cachedSummary || !cachedSummary.players) return [];
  const pro = cachedSummary.players[String(proSlot)];
  if (!pro || !pro.race) return [];
  const opp = Object.keys(cachedSummary.players)
    .filter(k => k !== String(proSlot))
    .map(k => cachedSummary.players[k])
    .find(p => p && !p.isNeutralPlayer && p.race && p.race !== 'R');
  if (!opp) return [];
  return [`${pro.race}v${opp.race}`];
};

const deriveOpponentName = (cachedSummary, proSlot) => {
  if (!cachedSummary || !cachedSummary.players) return null;
  const opp = Object.keys(cachedSummary.players)
    .filter(k => k !== String(proSlot))
    .map(k => cachedSummary.players[k])
    .find(p => p && !p.isNeutralPlayer);
  return (opp && opp.name) || null;
};

const deriveOpponentRace = (cachedSummary, proSlot) => {
  if (!cachedSummary || !cachedSummary.players) return null;
  const opp = Object.keys(cachedSummary.players)
    .filter(k => k !== String(proSlot))
    .map(k => cachedSummary.players[k])
    .find(p => p && !p.isNeutralPlayer && p.race);
  return (opp && opp.race) || null;
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CompareMatcher;
}
if (typeof window !== 'undefined') {
  window.CompareMatcher = CompareMatcher;
}
})();
