/**
 * MomentsExtract.js — the "big moments" of a game, ranked and capped.
 *
 * Answers one question: if you had to jump to six places in this replay, where
 * would they be? Fights where a hero died, fights that swung the game, the
 * expansion, the tech timings. Each moment carries a `t` that a viewer can seek
 * straight to.
 *
 * Single source of truth used by:
 *   - desktop/src-frontend/js/app.js  → stored in every parsed game's summary
 *   - tools/moments-report.js         → judge the ranking against a real game
 *
 * Self-contained — no imports, no DOM, no fs, no unit-id tables. Both runtimes
 * load it as a plain script: Node via `require`, browser via `<script>` tag.
 *
 * INPUT is the full parsed .wc3v object, because fights only exist there:
 * `out.battles` (from lib/BattleDetector + lib/BattleSummary) is NOT part of
 * the per-player SummaryExtract shape. That is the whole reason this module
 * exists.
 *
 * Stored moments are deliberately SEAT-AGNOSTIC: the label never says "you".
 * `slot` / `againstSlot` carry who did what, and `phrase()` turns a moment into
 * a sentence for a given seat. One game, two players, two readings of the same
 * stored data — and a summary stored before the user fixed their identity does
 * not have to be rewritten.
 */

(function () {
  'use strict';

  // Keep the stored array small — this rides along in every game's summary.
  const DEFAULT_LIMIT = 24;

  // Gold-equivalent swing of losing a hero. Deliberately the same number
  // client/js/BattleReportRenderer.js uses (HERO_DEATH_VALUE) so a fight the
  // viewer calls "decisive" is never called "even" here.
  const HERO_DEATH_VALUE = 350;
  const DECISIVE_RATIO = 0.40;
  const FAVORABLE_RATIO = 0.72;

  // A fight has to cost somebody real resources before it is a moment. One
  // straggler dying is not a fight worth rewatching, and calling it "decisive"
  // because the other side lost literally nothing overclaims badly — most
  // single-unit losses are INFERRED (`possiblyDead`), not observed. Roughly
  // three units' worth.
  const MIN_FIGHT_VALUE = 400;

  // Scouting is only interesting while it still decides something.
  const EARLY_GAME_CUTOFF_MS = 5 * 60 * 1000;

  const HERO_ULT_LEVEL = 6;

  function formatMs (ms) {
    const m = Math.floor((ms || 0) / 60000);
    const s = Math.floor(((ms || 0) % 60000) / 1000);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  // ── Sides and verdicts ──────────────────────────────────────────────────────

  // Group a battle's human participants into sides by team, and value each side
  // by what it lost. Mirrors BattleReportRenderer._collectSides /
  // _computeVerdict, but reads battle.participants + battle.summary.perPlayer
  // instead of the viewer's player metadata, which does not exist outside the
  // browser.
  //
  // Sides are seeded from PARTICIPANTS, not from perPlayer: perPlayer only
  // contains players who lost something, so a side that lost nothing — i.e. the
  // side that won the fight outright — would otherwise not exist, leaving the
  // most lopsided fights in the game with no verdict at all.
  function sidesOf (battle, summary, humanSlots, teamOf) {
    const groups = new Map();
    const ensure = (pid) => {
      const teamId = teamOf(pid);
      const key = (teamId != null) ? `T${teamId}` : `P${pid}`;
      let g = groups.get(key);
      if (!g) {
        g = { key, teamId, slots: [], gold: 0, lumber: 0, heroes: 0, units: 0 };
        groups.set(key, g);
      }
      if (g.slots.indexOf(String(pid)) === -1) g.slots.push(String(pid));
      return g;
    };

    for (const p of (battle.participants || [])) {
      if (humanSlots.has(String(p.playerId))) ensure(String(p.playerId));
    }
    for (const pid of Object.keys(summary.perPlayer || {})) {
      if (!humanSlots.has(String(pid))) continue;  // creeps are not a side
      const p = summary.perPlayer[pid];
      const g = ensure(String(pid));
      g.gold += (p.definite.gold + p.estimated.gold);
      g.lumber += (p.definite.lumber + p.estimated.lumber);
      g.units += (p.definite.count + p.estimated.count);
      g.heroes += (p.heroDeaths || []).length;
    }

    const sides = [...groups.values()];
    for (const s of sides) s.value = s.gold + s.lumber + s.heroes * HERO_DEATH_VALUE;
    return sides;
  }

  // The side that lost less wins the trade; how lopsided decides the tier.
  // Returns null when there is nothing to compare (one side, or no losses).
  function verdictOf (sides) {
    if (sides.length < 2) return null;
    const sorted = sides.slice().sort((a, b) => a.value - b.value);
    const winner = sorted[0];
    const loser = sorted[sorted.length - 1];
    if (loser.value === 0) return null;

    let tier;
    // Grading how lopsided a trade was only means something once the trade is
    // big enough to grade. Below that the honest answer is "a fight happened".
    if (loser.value < MIN_FIGHT_VALUE) tier = 'even';
    else if (winner.value === 0) tier = 'decisive';
    else {
      const ratio = winner.value / loser.value;
      if (ratio <= DECISIVE_RATIO) tier = 'decisive';
      else if (ratio <= FAVORABLE_RATIO) tier = 'favorable';
      else tier = 'even';
    }
    return { winnerSlots: winner.slots, loserSlots: loser.slots, tier, margin: loser.value - winner.value };
  }

  // ── Fights ──────────────────────────────────────────────────────────────────

  // At most ONE moment per battle. A hero dying in a fight is the same event as
  // the fight; emitting both would spend two of the 24 slots on one moment.
  function fightMoments (out, humanSlots, teamOf) {
    const moments = [];

    for (const battle of (out.battles || [])) {
      const summary = battle && battle.summary;
      if (!summary || !summary.hasLosses) continue;

      const sides = sidesOf(battle, summary, humanSlots, teamOf);
      const totalValue = sides.reduce((a, s) => a + s.value, 0);
      const verdict = verdictOf(sides);
      const center = summary.center || null;

      // Who lost heroes, and which ones.
      const heroes = [];
      for (const pid of Object.keys(summary.perPlayer || {})) {
        for (const h of (summary.perPlayer[pid].heroDeaths || [])) {
          heroes.push({
            slot: String(pid),
            name: h.displayName || 'Hero',
            level: h.level || 1,
            likely: h.confidence === 'estimated'
          });
        }
      }

      const base = {
        t: battle.startTime || 0,
        battleId: battle.id,
        endT: battle.endTime || null,
        x: center ? Math.round(center.x) : null,
        y: center ? Math.round(center.y) : null
      };
      if (verdict) {
        base.winnerSlots = verdict.winnerSlots;
        base.tier = verdict.tier;
        // Gold-equivalent the losing side is down by. The UI spends this on
        // "you won that by 620" — a fight is much easier to judge with a number
        // than with an adjective.
        base.swing = Math.round(verdict.margin);
      }

      if (heroes.length) {
        // Heroes can go down on BOTH sides in the same fight. Treating the
        // first entry as "the" victim would report a 2-for-1 trade as "you lost
        // 3 heroes" to the player who lost two of them — so group by owner and
        // only claim a one-sided kill when it actually was one.
        const byVictim = new Map();
        for (const h of heroes) {
          if (!byVictim.has(h.slot)) byVictim.set(h.slot, []);
          byVictim.get(h.slot).push(h);
        }
        const victimSlots = [...byVictim.keys()];
        const traded = victimSlots.length > 1;

        const level = Math.max(...heroes.map(h => h.level));
        let importance = Math.min(95, 78 + level * 2);
        if (verdict && verdict.tier === 'decisive') importance += 5;
        if (heroes.length > 1) importance += 4;
        if (heroes.every(h => h.likely)) importance -= 8;  // inferred, not proven
        // Without this every hero death in a game scores the same and the cap
        // drops them in arbitrary order. The fight that cost more matters more.
        if (base.swing) importance += Math.min(8, Math.round(base.swing / 300));

        if (traded) {
          // Nobody "won" a hero trade outright, so neither slot owns it — the
          // sentence is built from the per-owner counts instead.
          const even = victimSlots.every(s => byVictim.get(s).length === byVictim.get(victimSlots[0]).length);
          moments.push(Object.assign({}, base, {
            type: 'heroTrade',
            label: 'Hero trade',
            slot: null,
            againstSlot: null,
            heroes,
            importance: Math.round(importance - (even ? 6 : 0))
          }));
          continue;
        }

        // One-sided. A hero lost with nobody hostile on the far side died to
        // creeps — its own kind of moment, so it is kept rather than dropped.
        const victimSlot = victimSlots[0];
        const victimTeam = teamOf(victimSlot);
        const killers = [...humanSlots].filter(s => teamOf(s) !== victimTeam &&
          (battle.participants || []).some(p => String(p.playerId) === s));

        moments.push(Object.assign({}, base, {
          type: killers.length ? 'heroKill' : 'heroLostToCreeps',
          label: heroes.length === 1
            ? `${heroes[0].name} killed`
            : `${heroes.length} heroes killed`,
          slot: killers.length === 1 ? killers[0] : null,
          againstSlot: victimSlot,
          heroes,
          importance: Math.round(importance)
        }));
        continue;
      }

      if (totalValue < MIN_FIGHT_VALUE) continue;

      // No hero died — categorise from what the parser already decided rather
      // than re-deriving it. The two fields answer different questions:
      // `category` says WHERE the fight happened (at the expansion, in a base,
      // under a tower), `engagementType` says WHAT the losses looked like (a
      // wipe, a creep jack, harass). Location wins when it has one, because
      // "fight at his expansion" is a better cue than "skirmish".
      const shape = LOCATION_SHAPES[battle.category] ||
                    OUTCOME_SHAPES[summary.engagementType] ||
                    GENERIC_SHAPES[battle.category] ||
                    GENERIC_SHAPES.skirmish;
      const scaled = Math.min(30, Math.round(totalValue / 40));

      moments.push(Object.assign({}, base, {
        type: shape.type,
        label: shape.label,
        slot: verdict ? verdict.winnerSlots[0] : null,
        againstSlot: verdict ? verdict.loserSlots[0] : null,
        importance: shape.base + scaled
      }));
    }

    return moments;
  }

  // Fight labelling. `battle.category` (BattleDetector) says WHERE a fight
  // happened; `summary.engagementType` (BattleSummary) says what the LOSSES
  // looked like. They overlap on generic names, so they get separate tables and
  // an explicit precedence: a specific location beats an outcome, an outcome
  // beats a generic location, and anything unrecognised still becomes "a fight"
  // rather than vanishing from the list.
  const LOCATION_SHAPES = {
    'expansion-fight': { type: 'expansionFight', label: 'Fight at the expansion', base: 34 },
    'base-defense':    { type: 'baseRaid',       label: 'Base under attack',      base: 34 },
    'tower-dive':      { type: 'towerDive',      label: 'Tower dive',             base: 30 }
  };

  const OUTCOME_SHAPES = {
    wipe:      { type: 'wipe',      label: 'An army got wiped',     base: 40 },
    baseRaid:  { type: 'baseRaid',  label: 'Fight in the base',     base: 32 },
    creepJack: { type: 'creepJack', label: 'Caught while creeping', base: 30 },
    campClear: { type: 'campClear', label: 'Creep camp cleared',    base: 8  },
    harass:    { type: 'harass',    label: 'Harassment',            base: 12 }
  };

  const GENERIC_SHAPES = {
    'pitched-battle':  { type: 'fight', label: 'Pitched battle', base: 24 },
    'creep-fight':     { type: 'campClear', label: 'Creeping',   base: 8  },
    'unknown-combat':  { type: 'fight', label: 'A fight',        base: 18 },
    engagement:        { type: 'fight', label: 'A fight',        base: 20 },
    skirmish:          { type: 'fight', label: 'A fight',        base: 20 }
  };

  // ── Macro beats ─────────────────────────────────────────────────────────────

  // Tech, expansions, ultimates, scouts. All derived from streams that every
  // parse carries — deliberately no unit-id tables, so this module stays
  // self-contained and cannot drift from mappings.js.
  function macroMoments (out) {
    const moments = [];

    for (const slot of Object.keys(out.players || {})) {
      const p = out.players[slot];
      if (!p || p.isNeutralPlayer) continue;

      let t2 = null;
      let t3 = null;
      for (const tier of (p.tierStream || [])) {
        if (tier.tier === 2 && (t2 === null || tier.gameTime < t2)) t2 = tier.gameTime;
        if (tier.tier === 3 && (t3 === null || tier.gameTime < t3)) t3 = tier.gameTime;
      }
      if (t2 !== null) {
        moments.push({ t: t2, type: 'tier2', label: 'Tier 2', slot, importance: 38 });
      }
      if (t3 !== null) {
        moments.push({ t: t3, type: 'tier3', label: 'Tier 3', slot, importance: 46 });
      }

      let expansions = 0;
      let scouted = false;
      for (const ev of (p.eventStream || [])) {
        if (ev.key === 'addBuilding' && ev.isExpansion) {
          expansions++;
          moments.push({
            t: ev.gameTime,
            type: 'expansion',
            label: expansions === 1 ? 'Expanded' : `Expansion #${expansions}`,
            slot,
            x: ev.x != null ? Math.round(ev.x) : null,
            y: ev.y != null ? Math.round(ev.y) : null,
            importance: expansions === 1 ? 44 : 34
          });
        } else if (ev.key === 'scout' && !scouted && ev.gameTime < EARLY_GAME_CUTOFF_MS) {
          scouted = true;
          moments.push({
            t: ev.gameTime,
            type: 'scout',
            label: ev.isLumberScout ? 'Sent a wisp to scout' : 'Scouted',
            slot,
            importance: 22
          });
        } else if (ev.key === 'hireMercenary') {
          const name = (ev.unit && ev.unit.displayName) || 'Mercenary';
          moments.push({
            t: ev.gameTime, type: 'merc', label: `Hired ${name}`, slot, importance: 20
          });
        }
      }

      // Hero hits 6 — the ultimate is available, which is a real cue point.
      for (const u of (p.units || [])) {
        if (!u || !u.meta || !u.meta.hero) continue;
        for (const le of (u.levelStream || [])) {
          if (le && le.newLevel === HERO_ULT_LEVEL && le.gameTime != null) {
            moments.push({
              t: le.gameTime,
              type: 'heroUlt',
              label: `${u.displayName || 'Hero'} hit 6`,
              slot,
              importance: 42
            });
            break;
          }
        }
      }
    }

    return moments;
  }

  // ── Public ──────────────────────────────────────────────────────────────────

  /**
   * @param out   the parsed .wc3v object
   * @param opts  { limit } — how many moments survive the cut (default 24)
   * @returns Moment[] sorted by time:
   *   { t, tf, type, label, slot, againstSlot?, importance, battleId?, endT?,
   *     x?, y?, heroes?, winnerSlots?, tier? }
   */
  function extractMoments (out, opts) {
    if (!out) return [];
    const limit = (opts && opts.limit) || DEFAULT_LIMIT;

    const humanSlots = new Set();
    const teams = {};
    for (const slot of Object.keys(out.players || {})) {
      const p = out.players[slot];
      if (!p || p.isNeutralPlayer) continue;
      humanSlots.add(String(slot));
      teams[String(slot)] = p.teamId;
    }
    const teamOf = (slot) => teams[String(slot)];

    const all = fightMoments(out, humanSlots, teamOf).concat(macroMoments(out));

    // Rank, cut, then put back in game order — the list is read as a timeline,
    // but it is *chosen* by importance.
    all.sort((a, b) => (b.importance - a.importance) || (a.t - b.t));
    const kept = all.slice(0, limit);
    kept.sort((a, b) => a.t - b.t);
    for (const m of kept) m.tf = formatMs(m.t);
    return kept;
  }

  /**
   * Turn a stored moment into a sentence from one seat's point of view.
   * Both the desktop list and the OBS overlay ticker call this, so the two can
   * never word the same moment differently.
   *
   * @param m       a moment from extractMoments
   * @param mySlot  the viewer's slot, or null when identity is unknown
   * @param nameFor (slot) => display name
   */
  function phrase (m, mySlot, nameFor) {
    const name = (slot) => (nameFor && nameFor(slot)) || 'They';
    const me = mySlot != null ? String(mySlot) : null;
    const mine = (slot) => me !== null && String(slot) === me;

    if (m.type === 'heroKill') {
      const hero = m.heroes && m.heroes.length === 1 ? m.heroes[0].name : `${(m.heroes || []).length} heroes`;
      if (mine(m.slot)) return `You killed ${hero}`;
      if (mine(m.againstSlot)) return `You lost ${hero}`;
      if (m.slot) return `${name(m.slot)} killed ${hero}`;
      return `${hero} went down`;
    }
    if (m.type === 'heroTrade') {
      // Names when it is small enough to name, counts when it is not.
      const mineLost = (m.heroes || []).filter(h => mine(h.slot));
      const theirs = (m.heroes || []).filter(h => !mine(h.slot));
      if (me === null || !mineLost.length) {
        return `Hero trade — ${(m.heroes || []).map(h => h.name).join(', ')}`;
      }
      const side = (list) => list.length === 1 ? list[0].name : `${list.length} heroes`;
      return `Hero trade — you lost ${side(mineLost)}, they lost ${side(theirs)}`;
    }
    if (m.type === 'heroLostToCreeps') {
      const hero = m.heroes && m.heroes[0] ? m.heroes[0].name : 'A hero';
      return mine(m.againstSlot) ? `You lost ${hero} to creeps` : `${hero} died to creeps`;
    }

    // Fights: say who won it, since that is the part worth rewatching. An
    // 'even' tier means the trade was too close (or too small) to grade —
    // claiming somebody "came out ahead" off a 50-gold margin is a lie the
    // viewer's own battle report would not tell.
    if (m.winnerSlots && m.winnerSlots.length) {
      if (m.tier === 'even') return `${m.label} — an even trade`;
      const how = m.tier === 'decisive' ? ' decisively' : '';
      if (me !== null) {
        if (m.winnerSlots.some(mine)) return `${m.label} — you came out ahead${how}`;
        if (humanKnown(m, me)) return `${m.label} — you came out behind${how}`;
      }
      return `${m.label} — ${name(m.winnerSlots[0])} came out ahead${how}`;
    }

    // Macro beats belong to one player.
    if (m.slot != null) {
      if (mine(m.slot)) {
        if (m.type === 'tier2' || m.type === 'tier3') return `Your ${m.label}`;
        if (m.type === 'expansion') return `You ${m.label.toLowerCase()}`;
        return `You: ${m.label}`;
      }
      if (m.type === 'tier2' || m.type === 'tier3') return `${name(m.slot)} — ${m.label}`;
      return `${name(m.slot)}: ${m.label}`;
    }
    return m.label;
  }

  // Only claim "you came out behind" when the seat was actually in the fight —
  // otherwise a fight between two other players in a 2v2 reads as the user's loss.
  function humanKnown (m, me) {
    if (m.againstSlot != null) return String(m.againstSlot) === me;
    return false;
  }

  const api = { extractMoments, phrase, formatMs, HERO_DEATH_VALUE, DEFAULT_LIMIT };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.MomentsExtract = api;
  }
})();
