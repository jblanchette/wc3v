/**
 * ReplayGuide.js — auto-generated "guided walkthrough" of a replay.
 *
 * buildGuide(followed, opp, opts) → { followedName, oppName, followedColor,
 *   oppColor, followedRace, oppRace, gameLengthMs, intro, steps: [...] }
 *   followed / opp: objects with { name|displayName, race, playerColor,
 *     eventStream } (the viewer passes ClientPlayer instances; tools/preview-
 *     guide.js builds plain objects from a parsed .wc3v). gameTime is in MS.
 *   steps: ordered [{ gameTimeMs, key, title, iconId, action, contrast, why,
 *     takeaway, eventTimes:{followed:[ms],opp:[ms]} }]
 *     — STRUCTURED content (the viewer renders each field into its own DOM
 *     slot; preview-guide.js prints them as labelled sections). Voice is
 *     coaching: "we"/"our" = the followed player, opp called by name. Each
 *     step jumps playback to gameTimeMs and highlights BO rows at
 *     `eventTimes`. Cap ~MAX_STEPS, sorted by time. `iconId`, `contrast`,
 *     `why`, `takeaway` are all optional (null when not applicable).
 *
 * Quality bar (by design): grounded and factual, not deep coaching — the "why"
 * lines come from a small fixed knowledge base; the rest is the actual game.
 * UMD: module.exports in Node, window.ReplayGuide in the browser. No deps.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.ReplayGuide = mod;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const MAX_STEPS = 12;
  const WORKER_IDS = new Set(['opeo', 'hpea', 'uaco', 'ewsp']);
  // Some summons aren't reliably flagged isSummon in the parsed data — same
  // safety net as BuildOrderData.CONFIG.summonUnitIds on the client.
  const KNOWN_SUMMON_IDS = new Set(['uske', 'hwat', 'hwt2', 'hwt3', 'efon', 'osw1', 'osw2', 'osw3', 'ucs1']);
  const RACE_LABELS = { H: 'Human', O: 'Orc', E: 'Night Elf', U: 'Undead' };

  // ── Camera / emphasis directives ─────────────────────────────────────
  // Each step carries an OPTIONAL, purely symbolic `focus` directive — the
  // viewer (app.js) resolves it to actual map coordinates at step time using
  // ClientPlayer data (this module only sees event streams, no positions).
  // The set of `kind`s is deliberately small and fixed:
  //   base      — zoom to the player's starting base; ring `highlight` building types there
  //   hero      — follow the player's first hero; ring it
  //   army      — frame the player's living army; ring `highlight` unit types in it
  //   expansion — zoom to + ring the player's expansion town hall
  //   compare   — fit BOTH players' armies in one view
  //   creepTour — guided tour of the camps the player creeped (viewer resolves it)
  //   map       — reset to the full playable extent (default / fallback)
  const FOCUS_KINDS = new Set(['base', 'hero', 'army', 'expansion', 'compare', 'creepTour', 'map']);
  function normFocus(f) {
    if (!f || !FOCUS_KINDS.has(f.kind)) return { kind: 'map', player: 'followed', highlight: null };
    const player = (f.player === 'opp') ? 'opp' : 'followed';
    let highlight = null;
    if (Array.isArray(f.highlight)) {
      const ids = f.highlight.filter(id => typeof id === 'string' && id);
      if (ids.length) highlight = ids;
    }
    return { kind: f.kind, player, highlight };
  }

  // ── Knowledge base ────────────────────────────────────────────────────
  // Short, factual "why it matters" lines and a small, deliberately-
  // conservative counter table. Plain prose, no dashes, no filler.
  const PRINCIPLES = {
    creepEarly:    "A hero on the field is killing creeps for XP and gold; one parked at home is doing neither.",
    techLead:      "Reaching a tier first means a stretch where you have that tier's units and upgrades and the opponent doesn't. That stretch is the entire return on teching early; if you don't spend it, you paid for nothing.",
    techOptional:  "Plenty of games end before anyone reaches Tier 3. You go there for the top-tier units and upgrades, and only when the game runs long enough to need them.",
    expansionRisk: "An expansion is gold spent on a town hall instead of army, plus a second base to defend. It pays for itself later; for now it just makes you thinner and harder to hold.",
    upgradeArmy:   "A weapon or armor level, or an ability upgrade, applies to every unit of that type, including the ones you haven't built yet. It's cheap, it never expires, and it's the easiest thing to skip by accident."
  };

  // (HERO_SPIKE inline copy was moved into HeroAbilityStats.js as structured
  // per-spell stat rows, which the heroSpike step renders visually.)

  // Counters: when the followed player makes one of `byIds`, and the opponent
  // has >= `threshold` units from `vsIds` made by then, emit a step. Kept small
  // on purpose: accuracy over coverage.
  const COUNTERS = [
    {
      byIds: ['ubsp'], byName: 'Destroyers',
      vsIds: ['hmpr', 'hsor', 'oshm', 'unec', 'uban', 'edry', 'edot'],
      vsName: 'a caster-heavy army', threshold: 3,
      why: "Destroyers' Devour Magic eats enemy buffs, debuffs, and summons and turns the mana into armor for the Destroyer. Against a caster line they remove the spells before they land."
    },
    {
      byIds: ['hspt'], byName: 'Spell Breakers',
      vsIds: ['hmpr', 'hsor', 'oshm', 'unec', 'uban', 'edry', 'edot'],
      vsName: 'a caster-heavy army', threshold: 3,
      why: "Spell Breakers have Spell Immunity, so enemy spells just don't affect them, and Control Magic, which steals the opponent's summons. They turn a caster army's main strength into a liability."
    }
  ];

  // Siege units worth a callout on their own (no opponent condition needed).
  const SIEGE = { hmtm: 'Mortar Teams', emtl: 'Glaive Throwers', odem: 'Demolishers', umtw: 'Meat Wagons' };

  // ── Small helpers ─────────────────────────────────────────────────────
  function fmt(ms) {
    const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function pname(p, fallback) {
    const n = p && (p.name || p.displayName);
    // Narrative text shows the official pro name (PlayerNames.js).
    const canon = (typeof n === 'string' && typeof PlayerNames !== 'undefined') ? PlayerNames.canonical(n) : (typeof n === 'string' ? n.trim() : '');
    return (canon && canon.trim()) ? canon.trim() : (fallback || 'the opponent');
  }
  function evStream(p) { return (p && Array.isArray(p.eventStream)) ? p.eventStream : []; }
  // Pluralize a WC3 unit display name. Handles "-man"→"-men" (Footman/Rifleman,
  // but NOT Shaman), "-s/-ss/-x/-ch/-sh"→"+es" (Sorceress→Sorceresses), and
  // "X of the Y"→"Xs of the Y" (Druid of the Claw → Druids of the Claw).
  function pluralize(name, n) {
    if (Number(n) === 1) return String(name);
    name = String(name);
    const m = name.match(/^(.+?) of the (.+)$/);
    if (m) return pluralize(m[1], 2) + ' of the ' + m[2];
    // "man"→"men" (Footman→Footmen) but NOT "...aman" (Shaman stays Shaman).
    // Avoids a lookbehind regex literal, which throws a SyntaxError at parse
    // time in older Safari and would take this whole file down.
    if (/man$/.test(name) && !/aman$/.test(name)) return name.replace(/man$/, 'men');
    if (/(s|x|z|ch|sh)$/i.test(name)) return name + 'es';
    return name + 's';
  }
  function nOf(n, name) { return `${n} ${pluralize(name, n)}`; }

  // addUnit events for real army units (not workers / summons / heroes / things
  // that are also buildings, e.g. Orc Burrow).
  function armyEvents(stream) {
    return stream.filter(e => e && e.key === 'addUnit' && e.unit
      && e.unit.isUnit && !e.unit.isBuilding && !e.unit.isHero && !e.unit.isSummon
      && !WORKER_IDS.has(e.unit.itemId) && !KNOWN_SUMMON_IDS.has(e.unit.itemId));
  }
  function buildingEvents(stream) { return stream.filter(e => e && e.key === 'addBuilding' && e.building); }
  function heroTrainEvents(stream) { return stream.filter(e => e && e.key === 'addUnit' && e.unit && e.unit.isHero); }
  function heroLevelEvents(stream) { return stream.filter(e => e && e.key === 'HeroLevel' && e.unit); }
  function researchEvents(stream) { return stream.filter(e => e && e.key === 'research'); }
  function expansionEvents(stream) { return stream.filter(e => e && e.key === 'addBuilding' && e.isExpansion === true); }

  // Time the player started upgrading to `tier` (2 or 3), or Infinity.
  function tierTimeMs(stream, tier) {
    let best = Infinity;
    for (const e of stream) {
      if (e && e.key === 'tierUpgrade' && e.building && Number(e.building.tierTarget) === tier) {
        if (e.gameTime < best) best = e.gameTime;
      }
    }
    return best;
  }

  // The followed player's first hero: { itemId, name, trainTime } or null.
  function firstHero(stream) {
    const trains = heroTrainEvents(stream).slice().sort((a, b) => a.gameTime - b.gameTime);
    if (!trains.length) return null;
    const e = trains[0];
    return { itemId: e.unit.itemId, name: e.unit.displayName || 'the hero', trainTime: e.gameTime };
  }

  // A hero's level at time `ms` (max newLevel among its HeroLevel events <= ms).
  function heroLevelAt(stream, heroItemId, ms) {
    let lvl = 0;
    for (const e of heroLevelEvents(stream)) {
      if (e.unit.itemId === heroItemId && e.gameTime <= ms) {
        const nl = Number(e.newLevel != null ? e.newLevel : e.level) || 0;
        if (nl > lvl) lvl = nl;
      }
    }
    return lvl;
  }
  // Time the followed hero first reaches `target` level, or Infinity.
  function heroReachesLevelMs(stream, heroItemId, target) {
    let best = Infinity;
    for (const e of heroLevelEvents(stream)) {
      if (e.unit.itemId === heroItemId) {
        const nl = Number(e.newLevel != null ? e.newLevel : e.level) || 0;
        if (nl >= target && e.gameTime < best) best = e.gameTime;
      }
    }
    return best;
  }

  // The first N hero skill picks (in chronological order) for `heroItemId`.
  // Each entry: { spellItemId, displayName, level, atMs } — level is the
  // spell's level AFTER this pick (1 for a fresh skill, 2 if doubled, etc.).
  // Used by buildHeroSpike to render the "level 3 spike" step's pick row.
  function firstNHeroPicks(stream, heroItemId, n) {
    const out = [];
    const evts = heroLevelEvents(stream)
      .filter(e => e.unit.itemId === heroItemId)
      .sort((a, b) => a.gameTime - b.gameTime);
    for (const e of evts) {
      if (out.length >= n) break;
      if (!e.spellItemId) continue;
      const spLvl = Number(e.spell && e.spell.level) || 0;
      out.push({
        spellItemId: String(e.spellItemId),
        displayName: String((e.spell && e.spell.displayName) || ''),
        level: spLvl,
        atMs: Math.max(0, Number(e.gameTime) || 0)
      });
    }
    return out;
  }
  // The spellItemId of the doubled-up pick (a basic skill brought to level 2)
  // among the first three picks, or null if no double-up happened.
  function pickedDoubleUp(picks) {
    if (!Array.isArray(picks)) return null;
    for (const p of picks) if (p && p.level === 2) return p.spellItemId;
    return null;
  }
  // Pack one hero's side of the spike comparison.
  function heroSpikeRow(hero, picks, doubledSpellId) {
    const last = picks[picks.length - 1];
    return {
      heroItemId: hero.itemId,
      heroName: hero.name,
      level: picks.length,
      levelAtMs: last ? last.atMs : null,
      picks: picks.map(p => ({
        spellItemId: p.spellItemId,
        displayName: p.displayName,
        level: p.level,
        isSpike: !!(doubledSpellId && p.spellItemId === doubledSpellId && p.level === 2)
      }))
    };
  }
  // Resolve HeroAbilityStats both in-browser (window.HeroAbilityStats) and in
  // node (preview tool: require it lazily so this module stays dep-free in
  // contexts that don't need it). Returns {} if not available.
  function getAbilityStats() {
    if (typeof HeroAbilityStats !== 'undefined') return HeroAbilityStats || {};
    if (typeof require === 'function') {
      try { return require('./HeroAbilityStats') || {}; } catch (e) { /* fall through */ }
    }
    return {};
  }
  // Build the level-3 skill-spike payload: each side's three picks + L1→L2
  // stats for whichever pick the followed player doubled up. Returns null
  // when the followed hero's first three level-up events don't carry skill
  // data (older replays missing spellItemId), so the caller skips the step
  // rather than render an empty card.
  function buildHeroSpike(fStream, fh, oStream, oh) {
    const myPicks = firstNHeroPicks(fStream, fh.itemId, 3);
    if (!myPicks || myPicks.length < 3) return null;
    const oppPicks = oh ? firstNHeroPicks(oStream, oh.itemId, 3) : null;
    const doubled = pickedDoubleUp(myPicks);
    const oppDoubled = (oppPicks && oppPicks.length === 3) ? pickedDoubleUp(oppPicks) : null;
    const HAS = getAbilityStats();
    const stats = (doubled && HAS[doubled]) || null;
    return {
      followed: heroSpikeRow(fh, myPicks, doubled),
      opp:      (oh && oppPicks && oppPicks.length === 3) ? heroSpikeRow(oh, oppPicks, oppDoubled) : null,
      doubledSpellId: doubled,
      oppDoubledSpellId: oppDoubled,
      stats
    };
  }

  // Count of army units (by itemId) made up to time `ms` — a rough "they've got
  // N of X by now" (ignores deaths; fine for "they've committed to casters").
  function armyCountUpTo(stream, ms) {
    const out = {};
    for (const e of armyEvents(stream)) {
      if (e.gameTime <= ms) {
        const id = e.unit.itemId, nm = e.unit.displayName || id;
        if (!out[id]) out[id] = { name: nm, n: 0 };
        out[id].n++;
      }
    }
    return out;
  }
  function countOf(armyCount, ids) {
    let n = 0;
    for (const id of ids) if (armyCount[id]) n += armyCount[id].n;
    return n;
  }
  // Collapse an armyCountUpTo() map (keyed by itemId) into { displayName: total },
  // so units that share a name (e.g. Headhunter / Berserker after the morph
  // upgrade) don't show up twice as "12 X, 3 X".
  function mergeByName(armyCount) {
    const out = {};
    for (const id of Object.keys(armyCount)) {
      const { name, n } = armyCount[id];
      out[name] = (out[name] || 0) + n;
    }
    return out;
  }
  // "6 Crypt Fiends, 2 Obsidian Statues, 1 Death Knight..." for the top units.
  function compString(stream, ms, max) {
    const ac = mergeByName(armyCountUpTo(stream, ms == null ? Infinity : ms));
    const items = Object.keys(ac).map(name => ({ name, n: ac[name] }))
      .sort((a, b) => b.n - a.n).slice(0, max || 4);
    if (!items.length) return 'no army built yet';
    return items.map(it => nOf(it.n, it.name)).join(', ');
  }
  // itemId of the most-produced army unit up to `ms` (null/Infinity = ever) —
  // used as the icon for the "compare armies" steps, which have no single
  // building/unit of their own. Falls back to the player's first hero.
  function topUnitId(stream, ms) {
    const ac = armyCountUpTo(stream, ms == null ? Infinity : ms);
    let bestId = null, bestN = 0;
    for (const id of Object.keys(ac)) if (ac[id].n > bestN) { bestN = ac[id].n; bestId = id; }
    if (bestId) return bestId;
    const fh = firstHero(stream);
    return fh ? fh.itemId : null;
  }
  // "Crypt Fiends and Obsidian Statues" / "Riflemen, Priests and Sorceresses" — top unit NAMES, no counts.
  function topNames(stream, max) {
    const ac = mergeByName(armyCountUpTo(stream, Infinity));
    const items = Object.keys(ac).map(name => ({ name, n: ac[name] })).sort((a, b) => b.n - a.n).slice(0, max || 2);
    if (!items.length) return 'a small army';
    const names = items.map(it => pluralize(it.name, 2));
    if (names.length === 1) return names[0];
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }
  function maxTierOf(stream) {
    if (tierTimeMs(stream, 3) !== Infinity) return 3;
    if (tierTimeMs(stream, 2) !== Infinity) return 2;
    return 1;
  }

  // Parenthetical appended to the upgrade step's action line, e.g.
  // "We research Steel Melee at 5:55 (a weapon level: +attack on the whole army)."
  function upgradeBlurb(re) {
    const cat = re && re.category;
    if (cat === 'attack') return ' (a weapon level: +attack on the whole army)';
    if (cat === 'defense') return ' (an armor level: +armor on the whole army)';
    return ''; // ability upgrades: the name plus the "why" line say enough
  }
  function gameEndMs(stream) {
    let t = 0;
    for (const e of stream) if (e && typeof e.gameTime === 'number' && e.gameTime > t) t = e.gameTime;
    return t;
  }

  // The 2-sentence "what this build is" blurb shown on the intro screen
  // (the viewer pairs it with the curated build name as the headline, plus a
  // contents list of the steps). Plain prose, no dashes.
  function buildIntro(F, O, fName, oName) {
    const fStream = evStream(F), oStream = evStream(O);
    const fh = firstHero(fStream);
    const heroName = fh ? fh.name : 'a hero';
    const fRace = RACE_LABELS[F && F.race] || (F && F.race) || '';
    const oRace = RACE_LABELS[O && O.race] || (O && O.race) || '';
    const art = /^[aeiou]/i.test(fRace) ? 'an' : 'a';
    const haveOpp = !!(oName && oName !== 'the opponent');
    const tier = maxTierOf(fStream);
    const heroLvl3 = !!(fh && heroReachesLevelMs(fStream, fh.itemId, 3) !== Infinity);
    const oppExp = expansionEvents(oStream).length > 0;
    // Sentence 1: which build, whose, and against whom.
    let s1 = `${fName}'s ${heroName} build`;
    if (fRace && haveOpp) s1 += `, ${art} ${fRace} game against ${oName}${oRace ? ` (${oRace})` : ''}`;
    else if (fRace) s1 += `, ${art} ${fRace} game`;
    else if (haveOpp) s1 += ` against ${oName}${oRace ? ` (${oRace})` : ''}`;
    s1 += '.';
    // Sentence 2: the shape of it.
    let s2 = `${fName} ${heroLvl3 ? 'levels the hero by creeping, then ' : ''}reaches Tier ${tier} and finishes mostly on ${topNames(fStream, 2)}`;
    if (oppExp && haveOpp) s2 += `, while ${oName} expands along the way`;
    s2 += '.';
    return `${s1} ${s2}`;
  }

  // ── Step builders ─────────────────────────────────────────────────────
  // Each step pushes a STRUCTURED object — the renderer maps fields into
  // distinct DOM slots (action row → opp contrast row → "Why it matters"
  // callout → "Try in your games" takeaway). `iconId` is the wc3icons asset
  // name (no extension). Pass null where a section doesn't apply.
  function buildSteps(F, O, fName, oName) {
    const fStream = evStream(F), oStream = evStream(O);
    const steps = [];
    const push = (s) => {
      if (!s || !s.action) return;
      steps.push({
        gameTimeMs: Math.max(0, Math.round(Number(s.gameTimeMs) || 0)),
        key: s.key,
        title: s.title || '',
        iconId: s.iconId || null,
        action: s.action,
        contrast: s.contrast || null,
        why: s.why || null,
        takeaway: s.takeaway || null,
        focus: normFocus(s.focus),
        // Optional ordered breakdown — the step's "do this, in this order" list
        // (currently only the opening). Each item: { label, timeMs, iconId,
        // kind: 'building'|'unit'|'hero' }. The viewer renders it as a big
        // numbered list with icons — the focal block of that step.
        list: (Array.isArray(s.list) && s.list.length)
          ? s.list.slice(0, 14).map(it => ({
              label: String((it && it.label) || ''),
              timeMs: Math.max(0, Math.round(Number(it && it.timeMs) || 0)),
              iconId: (it && typeof it.iconId === 'string') ? it.iconId : null,
              kind: (it && (it.kind === 'building' || it.kind === 'hero' || it.kind === 'worker')) ? it.kind : 'unit',
              count: Math.max(1, Math.round(Number(it && it.count) || 1))
            }))
          : null,
        // Optional level-3 skill-spike payload (the heroSpike step only).
        // Renderer-defined shape; passed through verbatim by the allowlist so
        // the renderer's helpers can lay out the per-hero pick rows + the
        // L1→L2 stat table. Null on every other step.
        spike: (s.spike && typeof s.spike === 'object') ? s.spike : null,
        eventTimes: { followed: (s.fTimes || []).slice(), opp: (s.oTimes || []).slice() }
      });
    };

    // 1. The opening — the build order's first ~12 production moves, IN COMMAND
    //    ORDER. The two sources are deliberate:
    //      • buildings come from the build-COMMAND log (player.buildingAttempts:
    //        when the player clicked to place it) — NOT the addBuilding event,
    //        which fires when construction *starts* (after the worker has
    //        walked there) and so lags the command by a couple of seconds;
    //      • units / workers / the first hero come from addUnit events, which
    //        fire when the unit enters its training queue (= the queue command),
    //        not when it pops out — so "queue 3 acolytes" shows at the moment
    //        they were queued, in order, even though they finish one at a time.
    //    A run of the same worker/unit collapses into a "×N" item. The starting
    //    batch of 5 workers every race begins with isn't in the stream (only
    //    trained units emit addUnit), so no time filter is needed. For a real
    //    build the worker count interleaved with the buildings *is* the build —
    //    that ordering is the whole point.
    {
      const isW = (id) => WORKER_IDS.has(id);

      // Buildings: the build-command log (drop ones cancelled / re-placed —
      // mis-clicks, repositions — so only buildings that actually went down).
      const attempts = (F && Array.isArray(F.buildingAttempts)) ? F.buildingAttempts : null;
      let buildingMoves;
      if (attempts && attempts.length) {
        buildingMoves = attempts
          .filter(a => a && a.displayName && a.status !== 'cancelled' && a.status !== 'replaced')
          .map(a => ({ t: Math.max(0, Number(a.gameTime) || 0), label: a.displayName, iconId: a.itemId || null, kind: 'building' }));
      } else {
        // Fallback for older .wc3v files without buildingAttempts: addBuilding
        // events (construction-start time — slightly late, but the best we have).
        buildingMoves = buildingEvents(fStream)
          .filter(e => e.building && e.building.displayName)
          .map(e => ({ t: e.gameTime, label: e.building.displayName, iconId: e.building.itemId || null, kind: 'building' }));
      }

      // Units / workers / first hero — addUnit events (training-start = queue).
      const unitMoves = fStream
        .filter(e => e && e.key === 'addUnit' && e.unit && (
          e.unit.isHero
          || (e.unit.isUnit && !e.unit.isBuilding && !e.unit.isSummon && !KNOWN_SUMMON_IDS.has(e.unit.itemId))
        ))
        .map(e => ({
          t: e.gameTime,
          label: e.unit.displayName,
          iconId: e.unit.itemId || null,
          kind: e.unit.isHero ? 'hero' : (isW(e.unit.itemId) ? 'worker' : 'unit')
        }))
        .filter(m => m.label);

      const moves = buildingMoves.concat(unitMoves).sort((a, b) => a.t - b.t);

      let iconId = null;
      const openingBuildingIds = [];
      const list = [];   // [{ label, timeMs, iconId, kind, count }]
      for (const m of moves) {
        const last = list[list.length - 1];
        if (last && last.label === m.label) {
          // A run of the same thing: count it (workers/units) — but for
          // buildings & heroes a back-to-back dup is almost always a parser
          // artifact, not "2 altars", so just drop it.
          if (m.kind === 'worker' || m.kind === 'unit') last.count = (last.count || 1) + 1;
          continue;
        }
        if (list.length >= 12) break;                                   // hard cap
        if (list.length >= 6 && m.t > 180000) break;                    // …and don't drag the "opening" past ~3:00 once it's substantial
        if (!iconId && m.iconId && m.kind !== 'worker') iconId = m.iconId;                 // step icon = first non-worker (the opener building / hero)
        if (m.kind === 'building' && m.iconId && !openingBuildingIds.includes(m.iconId)) openingBuildingIds.push(m.iconId);
        list.push({ label: m.label, timeMs: m.t, iconId: m.iconId, kind: m.kind, count: 1 });
      }
      if (!iconId && list.length) iconId = list[0].iconId;  // workers-only edge case
      if (list.length >= 3) {
        const t0 = (list[0] && list[0].timeMs) || 0;
        const lastT = (list[list.length - 1] && list[list.length - 1].timeMs) || t0;
        // Objective benchmarks this opening hits — the numbers, not advice.
        const openHero = firstHero(fStream);
        const openT2 = tierTimeMs(fStream, 2);
        let nWorkers = 5;                                  // every race starts with 5 workers
        for (const it of list) if (it.kind === 'worker') nWorkers += (it.count || 1);
        const bench = [`${nWorkers} workers by ${fmt(lastT)}`];
        if (openHero) bench.push(`${openHero.name} out at ${fmt(openHero.trainTime)}`);
        if (openT2 !== Infinity) bench.push(`Tier 2 by ${fmt(openT2)}`);
        push({
          gameTimeMs: t0, key: 'opening', title: 'The opening', iconId,
          action: `Copy this order, top to bottom. The worker count and the building sequence are the build.`,
          contrast: null,
          why: `The opening barely reacts to what the opponent does, so it's almost the same in every game. That makes it the part of the build worth copying exactly. What this one hits: ${bench.join(', ')}.`,
          takeaway: `Run it a few times in a single-player game against an easy AI. Two or three clean reps is usually enough for the order to stick.`,
          list,
          focus: { kind: 'base', player: 'followed', highlight: openingBuildingIds.length ? openingBuildingIds : null },
          fTimes: list.map(it => it.timeMs), oTimes: []
        });
      }
    }

    // 2a. The creep route to level 3 — which camps the hero cleared, in order.
    //     The "why level 3 matters" half of the old XP race step lives in 2b
    //     below as its own step, where we have room to render the picks visually.
    {
      const fh = firstHero(fStream);
      if (fh) {
        const oh = firstHero(oStream);
        const lvl3 = heroReachesLevelMs(fStream, fh.itemId, 3);
        const at = (lvl3 !== Infinity) ? lvl3 : fh.trainTime;
        const ourLvl = (lvl3 !== Infinity) ? 3 : heroLevelAt(fStream, fh.itemId, at);
        const ourHeroTimes = heroLevelEvents(fStream).filter(e => e.unit.itemId === fh.itemId && e.gameTime <= at).map(e => e.gameTime).concat([fh.trainTime]);
        const oppHeroTimes = oh ? heroLevelEvents(oStream).filter(e => e.unit.itemId === oh.itemId && e.gameTime <= at).map(e => e.gameTime).concat([oh.trainTime]) : [];
        const action = (lvl3 !== Infinity)
          ? `${fh.name} reaches level ${ourLvl} by ${fmt(at)}. These are the camps it cleared to get there, in order:`
          : `${fh.name} comes out at ${fmt(fh.trainTime)} and goes straight to creep. The camps it took, in order:`;
        push({
          gameTimeMs: fh.trainTime, key: 'hero', title: 'The route to level 3', iconId: fh.itemId,
          action,
          contrast: null,                                                          // moved into the spike step
          why: PRINCIPLES.creepEarly,                                              // skill-spike copy moved into spike step
          takeaway: `When your hero pops, the first move is a creep camp, not the opponent's base. Keep it creeping between fights.`,
          // The viewer turns this into a guided creep tour — it has the map /
          // camp data; here we just flag it. (Falls back to following the hero
          // if it can't resolve the camps.)
          focus: { kind: 'creepTour', player: 'followed', highlight: null },
          fTimes: ourHeroTimes, oTimes: oppHeroTimes
        });

        // 2b. The level 3 skill-spike — only when the followed hero actually
        //     hits L3 AND the parsed events include skill-pick data on each
        //     level-up (older .wc3v outputs may lack it).
        if (lvl3 !== Infinity) {
          const spike = buildHeroSpike(fStream, fh, oStream, oh);
          if (spike) {
            const fSpell = spike.doubledSpellId;
            const fSpellName = fSpell ? (spike.followed.picks.find(p => p.spellItemId === fSpell) || {}).displayName : null;
            const oppHasL3 = !!(spike.opp && spike.opp.level === 3);
            const oppSpell = spike.oppDoubledSpellId;
            const oppSpellName = oppSpell ? (spike.opp.picks.find(p => p.spellItemId === oppSpell) || {}).displayName : null;

            // Action line is a short framing sentence — the visual block does
            // the heavy lifting. Cover the four shapes the data can take:
            // followed doubled / didn't, opp present / absent, opp reached L3 / not.
            let action2;
            if (fSpell && oppHasL3 && oppSpell) {
              const fTime = spike.followed.levelAtMs, oTime = spike.opp.levelAtMs;
              const delta = Math.round(Math.abs(fTime - oTime) / 1000);
              const sameWindow = delta <= 30;
              action2 = sameWindow
                ? `Both heroes hit level 3 in the same window — neither side pulls ahead on hero levels. What matters is what each player spent that third point on.`
                : (fTime < oTime
                    ? `We hit level 3 about ${delta}s before ${oName}, both doubling up a basic skill.`
                    : `${oName} hits level 3 about ${delta}s before we do, both doubling up a basic skill.`);
            } else if (fSpell && oppHasL3 && !oppSpell) {
              action2 = `We double up ${fSpellName} at level 3. ${oName} reaches level 3 too but spreads points across three skills.`;
            } else if (fSpell && !oppHasL3) {
              action2 = `We double up ${fSpellName} at level 3 — the first time the same skill can take two points.`;
            } else if (!fSpell && oppHasL3 && oppSpell) {
              action2 = `We reach level 3 but spread points across three skills. ${oName} doubles up ${oppSpellName} instead.`;
            } else {
              action2 = `We reach level 3 having spent one point on each basic skill — no double-up taken here.`;
            }
            push({
              gameTimeMs: lvl3, key: 'heroSpike', title: 'The level 3 spike', iconId: fh.itemId,
              action: action2,
              contrast: null, why: null, takeaway: null,
              spike,
              focus: { kind: 'compare', player: 'followed' },
              fTimes: [lvl3], oTimes: oppHasL3 ? [spike.opp.levelAtMs] : []
            });
          }
        }
      }
    }

    // 3. Tier 2 (and 3) timing, vs the opponent's.
    [2, 3].forEach(tier => {
      const fT = tierTimeMs(fStream, tier);
      if (fT === Infinity) return;
      const oT = tierTimeMs(oStream, tier);
      const fEvts = fStream.filter(e => e.key === 'tierUpgrade' && e.building && Number(e.building.tierTarget) === tier);
      const oEvts = oStream.filter(e => e.key === 'tierUpgrade' && e.building && Number(e.building.tierTarget) === tier);
      const fTimes = fEvts.map(e => e.gameTime);
      const oTimes = oEvts.map(e => e.gameTime);
      const tierIcon = (fEvts[0] && fEvts[0].building && fEvts[0].building.itemId) || null;
      const ahead = (oT === Infinity) || (fT < oT);
      const delta = (oT === Infinity) ? null : Math.round(Math.abs(oT - fT) / 1000);
      const near = (oT !== Infinity) && delta != null && delta <= 4;   // within a few seconds: call it even

      let why, takeaway;
      if (tier === 2) {
        why = near
          ? `We and ${oName} hit Tier 2 at about the same time, so neither side gets the "I have T2 units and you don't" window. The early game gets decided somewhere else here.`
          : ahead ? PRINCIPLES.techLead
            : `Being later to a tier usually means the gold went somewhere else: more army now, an expansion, or harass. That can be the right call, it just isn't free.`;
        takeaway = near
          ? `Tier timing is even here, so don't count on a tech window. The edge has to come from hero levels or just winning the fights.`
          : ahead
            ? `Reaching T2 first only matters if you build the T2 units before they catch up. Queue them now, while they're still on T1.`
            : `Behind on tech means your current army has to do the work before theirs upgrades. If you're going to fight, fight before their new tier lands.`;
      } else {
        const earlyT3 = fT < 420000;
        why = earlyT3
          ? `Going T3 this early means the gold and lumber for those buildings isn't going into army right now. It's a bet that the T3 units arrive before that thin patch gets punished.`
          : PRINCIPLES.techOptional;
        takeaway = earlyT3
          ? `Fast T3 only works if the thin window doesn't get punished. Have your defence up (a tower or two, a tight base) before you start the upgrade.`
          : `Don't go T3 on autopilot. Go when a specific T3 unit or upgrade answers something the opponent is actually doing.`;
      }
      const contrast = (oT === Infinity)
        ? `${oName} never reaches Tier ${tier} this game.`
        : near
          ? `${oName} reaches Tier ${tier} at ${fmt(oT)}, essentially the same time as us.`
          : `${oName} reaches Tier ${tier} at ${fmt(oT)}, about ${delta}s ${ahead ? 'after us' : 'before us'}.`;
      push({
        gameTimeMs: fT, key: 'tier' + tier, title: `Tier ${tier} timing`, iconId: tierIcon,
        action: `We start the upgrade to Tier ${tier} at ${fmt(fT)}.`,
        contrast, why, takeaway,
        focus: { kind: 'base', player: 'followed', highlight: tierIcon ? [tierIcon] : null },
        fTimes, oTimes
      });
    });

    // 4. Expansion — whoever takes one.
    {
      const fExp = expansionEvents(fStream).slice().sort((a, b) => a.gameTime - b.gameTime)[0];
      const oExp = expansionEvents(oStream).slice().sort((a, b) => a.gameTime - b.gameTime)[0];
      if (fExp) {
        const icon = fExp.building && fExp.building.itemId;
        push({
          gameTimeMs: fExp.gameTime, key: 'expansion', title: 'Our expansion', iconId: icon,
          action: `We take an expansion at ${fmt(fExp.gameTime)}.`,
          contrast: oExp ? `${oName} expands too, at ${fmt(oExp.gameTime)}. Both economies are scaling, so this turns into a macro game.`
            : `${oName} hasn't expanded, so for a while they'll have the smaller but more concentrated army.`,
          why: PRINCIPLES.expansionRisk,
          takeaway: `For the first minute or so after the town hall goes down, keep the army home and a tower or two up at the expo. The extra income only counts if the expo lives.`,
          focus: { kind: 'expansion', player: 'followed', highlight: icon ? [icon] : null },
          fTimes: [fExp.gameTime], oTimes: []
        });
      } else if (oExp) {
        const icon = oExp.building && oExp.building.itemId;
        push({
          gameTimeMs: oExp.gameTime, key: 'oppExpansion', title: 'They expand', iconId: icon,
          action: `${oName} takes an expansion at ${fmt(oExp.gameTime)}. That's the greedy line; the second base isn't paying off yet.`,
          contrast: `Right now we're on one base with the army to match, while their gold is tied up in a town hall instead of units.`,
          why: PRINCIPLES.expansionRisk,
          takeaway: `An expansion is at its weakest the minute it goes down. Push with what you have now, before that town hall starts paying for itself.`,
          focus: { kind: 'expansion', player: 'opp', highlight: icon ? [icon] : null },
          fTimes: [], oTimes: [oExp.gameTime]
        });
      }
    }

    // 5. First notable army upgrade we research.
    {
      const res = researchEvents(fStream).slice().sort((a, b) => a.gameTime - b.gameTime);
      const notable = res.find(e => e.category === 'attack' || e.category === 'defense')
        || res.find(e => e.category === 'ability');
      if (notable) {
        // Has the opponent matched this exact upgrade (or its category) by then?
        const oppRes = researchEvents(oStream);
        const oppHas = oppRes.some(e => (e.itemId === notable.itemId || (notable.category !== 'ability' && e.category === notable.category)) && e.gameTime <= notable.gameTime);
        const blurb = upgradeBlurb(notable);
        const resBld = notable.building && notable.building.itemId;
        push({
          gameTimeMs: notable.gameTime, key: 'upgrade', title: 'Army upgrade',
          iconId: notable.icon || notable.itemId,
          action: `We research ${notable.displayName || 'an upgrade'} at ${fmt(notable.gameTime)}${blurb}.`,
          contrast: oppHas
            ? `${oName} has the same category researched by now, so it's a wash.`
            : `${oName} hasn't matched it yet, so it's a small but real edge for us until they do.`,
          why: PRINCIPLES.upgradeArmy,
          takeaway: `Whenever you're back at a production building or a smithy, check whether the next weapon or armor level is queued. It's cheap, and it's the first thing that slips once a real game gets busy.`,
          focus: { kind: 'base', player: 'followed', highlight: resBld ? [resBld] : null },
          fTimes: [notable.gameTime], oTimes: []
        });
      }
    }

    // 6. Counters — when we make a unit that answers what they've built.
    {
      const fArmy = armyEvents(fStream).slice().sort((a, b) => a.gameTime - b.gameTime);
      for (const c of COUNTERS) {
        const firstSuch = fArmy.find(e => c.byIds.includes(e.unit.itemId));
        if (!firstSuch) continue;
        const t = firstSuch.gameTime;
        const oppCount = armyCountUpTo(oStream, t);
        const n = countOf(oppCount, c.vsIds);
        if (n < c.threshold) continue;
        const list = c.vsIds.filter(id => oppCount[id]).map(id => nOf(oppCount[id].n, oppCount[id].name)).join(', ');
        const oTimes = armyEvents(oStream).filter(e => c.vsIds.includes(e.unit.itemId) && e.gameTime <= t).map(e => e.gameTime);
        push({
          gameTimeMs: t, key: 'counter', title: 'Countering casters',
          iconId: firstSuch.unit.itemId,
          action: `We add our first ${c.byName} at ${fmt(t)}.`,
          contrast: `${oName} has ${n} casters out by now (${list}).`,
          why: c.why,
          takeaway: `When the opponent has 3 or more casters on the field, start mixing in ${c.byName}. You don't need many for it to matter.`,
          focus: { kind: 'army', player: 'followed', highlight: c.byIds.slice() },
          fTimes: [t], oTimes
        });
      }
      // Siege callout (no opponent condition).
      const firstSiege = fArmy.find(e => SIEGE[e.unit.itemId]);
      if (firstSiege) {
        push({
          gameTimeMs: firstSiege.gameTime, key: 'siege', title: 'Siege',
          iconId: firstSiege.unit.itemId,
          action: `We get our first ${SIEGE[firstSiege.unit.itemId]} at ${fmt(firstSiege.gameTime)}.`,
          contrast: null,
          why: `Siege units do bonus damage to buildings and fortified targets, with splash. They're how you crack a tower line, an expansion, or an army that's bunched up. On their own, up close, they die fast.`,
          takeaway: `Keep siege behind the front line and move it with the army, never ahead of it. The moment it gets focused down, you've lost the trade.`,
          focus: { kind: 'army', player: 'followed', highlight: [firstSiege.unit.itemId] },
          fTimes: [firstSiege.gameTime], oTimes: []
        });
      }
    }

    // 7. Midgame composition check — around our last tier transition + buffer, or ~10:00.
    {
      const lastTier = Math.max(tierTimeMs(fStream, 2), tierTimeMs(fStream, 3) === Infinity ? 0 : tierTimeMs(fStream, 3));
      let at = (isFinite(lastTier) && lastTier > 0) ? lastTier + 120000 : 600000;
      const end = gameEndMs(fStream);
      if (at > end - 60000) at = Math.max(0, end - 60000); // not too close to the end
      if (at > 240000) { // only if the game's long enough to be interesting
        push({
          gameTimeMs: at, key: 'midgame', title: 'Midgame check', iconId: topUnitId(fStream, at),
          action: `By ${fmt(at)} we'd built: ${compString(fStream, at, 4)}.`,
          contrast: `${oName} had built: ${compString(oStream, at, 4)}.`,
          why: `These counts are everything each side has trained, not what's currently alive (deaths aren't subtracted). It's a rough read on who's been out-producing whom up to this point.`,
          takeaway: `If one side is clearly bigger here, that gap usually only grows. The player ahead should be looking for the fight; the player behind should be dodging it and catching up.`,
          focus: { kind: 'compare', player: 'followed', highlight: null },
          fTimes: [], oTimes: []
        });
      }
    }

    // 8. Final composition.
    {
      const end = Math.max(gameEndMs(fStream), gameEndMs(oStream));
      push({
        gameTimeMs: end, key: 'final', title: 'How it ended up', iconId: topUnitId(fStream, null),
        action: `By the end we'd built: ${compString(fStream, null, 5)}.`,
        contrast: `${oName} built: ${compString(oStream, null, 5)}.`,
        why: `Look back at step 1's opening: the build is the route from that to this. Almost everything in between was about getting here without falling behind.`,
        takeaway: null,
        focus: { kind: 'compare', player: 'followed', highlight: null },
        fTimes: [], oTimes: []
      });
    }

    // Sort by time; de-dupe near-identical timestamps lightly; cap.
    steps.sort((a, b) => a.gameTimeMs - b.gameTimeMs || (a.key < b.key ? -1 : 1));
    // Pin heroSpike immediately after the hero (route) step. The spike step's
    // gameTimeMs is the L3-reached time (so its clock + timeline-jump land on
    // the actual moment the spike happened), but in the narrative it belongs
    // with the hero arc, not sandwiched between T2 and T3 by chronology.
    {
      const heroIdx = steps.findIndex(s => s.key === 'hero');
      const spikeIdx = steps.findIndex(s => s.key === 'heroSpike');
      if (heroIdx !== -1 && spikeIdx !== -1 && spikeIdx !== heroIdx + 1) {
        const [spike] = steps.splice(spikeIdx, 1);
        const insertAt = (spikeIdx < heroIdx) ? heroIdx : heroIdx + 1;
        steps.splice(insertAt, 0, spike);
      }
    }
    let out = steps;
    if (out.length > MAX_STEPS) {
      // Always keep opening + final; trim from the middle, lowest-priority first.
      const PRI = { opening: 0, hero: 0, tier2: 1, counter: 1, final: 0, expansion: 2, oppExpansion: 2, upgrade: 3, tier3: 3, siege: 4, midgame: 4 };
      const keep = out.slice().sort((a, b) => (PRI[a.key] ?? 5) - (PRI[b.key] ?? 5)).slice(0, MAX_STEPS);
      const keepSet = new Set(keep);
      out = out.filter(s => keepSet.has(s));
    }
    return out;
  }

  // ── Public API ────────────────────────────────────────────────────────
  function buildGuide(followed, opp, opts) {
    opts = opts || {};
    const names = opts.names || {};
    const canon = (s, fb) => (typeof s === 'string' && s.trim() && typeof PlayerNames !== 'undefined') ? PlayerNames.canonical(s) : (s || fb);
    const fName = canon(names.followed, null) || pname(followed, 'this player');
    const oName = canon(names.opp, null) || pname(opp, 'the opponent');
    const steps = (followed && opp) ? buildSteps(followed, opp, fName, oName) : [];
    const fHero0 = followed ? firstHero(evStream(followed)) : null;
    const fRaceLabel = (RACE_LABELS[followed && followed.race] || (followed && followed.race) || '');
    return {
      followedName: fName,
      oppName: oName,
      followedColor: (followed && followed.playerColor) || null,
      oppColor: (opp && opp.playerColor) || null,
      followedRace: (followed && followed.race) || null,
      oppRace: (opp && opp.race) || null,
      // Fallback headline for the intro screen when the viewer has no curated
      // build name (e.g. a W3C replay not in the builds library).
      buildTitle: fHero0 ? `${fHero0.name} build` : (fRaceLabel ? `${fRaceLabel} build` : 'Walkthrough'),
      gameLengthMs: Math.max(gameEndMs(evStream(followed)), gameEndMs(evStream(opp))),
      intro: (followed && opp && steps.length) ? buildIntro(followed, opp, fName, oName) : '',
      steps
    };
  }

  return { buildGuide, MAX_STEPS, PRINCIPLES };
});
