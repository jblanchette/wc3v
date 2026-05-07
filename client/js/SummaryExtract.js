/**
 * summaryExtract.js — Shared per-player summary extractor.
 *
 * Single source of truth used by both:
 *   - scripts/generate-summary.js (Node)        → client/data/summaries/*.json
 *   - client/js/CompareInline.js  (browser)     → user-summary built at upload
 *
 * Input:  playerData      — the per-player object inside a parsed .wc3v JSON
 *         replayPlayerData — the player record from replay.players[id]
 * Output: a summary-shaped object (see fields list at bottom of this file)
 *
 * Self-contained — no other helpers/ imports, no DOM, no fs. Both runtimes
 * load it as a plain script: Node via `require`, browser via `<script>` tag.
 */

(function () {
  'use strict';

  // ── Constants (mirror BuildOrderData.CONFIG / mappings.js) ──────────────────

  const SUMMON_UNIT_IDS = {
    uske: 1, hwat: 1, hwt2: 1, hwt3: 1,
    efon: 1, osw1: 1, osw2: 1, osw3: 1, ucs1: 1
  };
  const WORKER_IDS = { opeo: 1, hpea: 1, ewsp: 1, uaco: 1, ugho: 1 };
  const TOWER_IDS = {
    hgtw: 1, hgt1: 1, hgt2: 1, hwtw: 1,  // Human
    owtw: 1,                              // Orc
    unpl: 1,                              // UD
    etrp: 1, etol: 1                      // NE (etol is also town hall)
  };
  // Tier-2/3 buildings — used to filter parser leakage in buildPreview where
  // a tier-2 building appears in the stream before its tier upgrade time.
  const T2_BUILDING_IDS = { eaow: 1, osld: 1, obea: 1, utod: 1, usep: 1, uslh: 1, hars: 1, hwtw: 1 };
  const T3_BUILDING_IDS = { edos: 1, otrb: 1, ubon: 1, hgra: 1 };

  const ECONOMY_SAMPLE_INTERVAL_MS = 30 * 1000;
  const ECONOMY_MAX_DURATION_MS = 30 * 60 * 1000; // cap at 30min

  // ── Helpers ────────────────────────────────────────────────────────────────

  // Resolve a raw replay map name to the matching `mapDataByFile` entry.
  // Mirrors the algorithm in lib/PlayerManager.js setGridData() — same loops,
  // same fallbacks. Accepts mapDataByFile as a parameter so both Node (which
  // requires it from helpers/mappings) and browser (which fetches a slim
  // manifest at runtime) can share the function.
  function resolveMapFolder (rawMapName, mapDataByFile) {
    if (!rawMapName || !mapDataByFile) return null;
    let mapName = String(rawMapName).split(/[\\/]/).pop().toLowerCase().trim();
    mapName = mapName.replace(/ /g, '');
    const w3cPrefixMatch = mapName.match(/^\d+_w3c_\d+_\d+_(.+)$/);
    const strippedMapName = w3cPrefixMatch ? w3cPrefixMatch[1] : mapName;

    if (mapDataByFile[mapName]) return mapDataByFile[mapName];
    for (const key of Object.keys(mapDataByFile)) {
      const entry = mapDataByFile[key];
      const searchName = (entry.name || '').toLowerCase();
      if (!searchName) continue;
      if (mapName.indexOf(searchName) !== -1) return entry;
      if (strippedMapName !== mapName && strippedMapName.indexOf(searchName) !== -1) return entry;
      const baseSearchName = searchName.replace(/[_-]v[\d._-]+$/, '');
      const baseMapName = strippedMapName.replace('.w3x', '').replace(/[_-]v[\d._-]+$/, '');
      if (baseSearchName.length > 3 && baseMapName === baseSearchName) return entry;
    }
    return null;
  }

  // Slim copy of a mapDataByFile entry for inclusion in summary.mapInfo —
  // keeps only what the Creeps tab needs (name + bounds + gridSize).
  function slimMapInfo (entry) {
    if (!entry) return null;
    return {
      name: entry.name || null,
      bounds: entry.bounds || null,
      gridSize: entry.gridSize || null
    };
  }

  function formatMs (ms) {
    const m = Math.floor((ms || 0) / 60000);
    const s = Math.floor(((ms || 0) % 60000) / 1000);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function heroRaceFromItemId (itemId) {
    if (!itemId) return null;
    const c = String(itemId).charAt(0);
    if (c === 'H' || c === 'O' || c === 'E' || c === 'U' || c === 'N') return c;
    return null;
  }

  // Same-name dedupe: a single creep camp emits multiple xpStream entries (one
  // per creep killed). Group entries that fall within `window` of each other
  // into a single "camp" event with summed XP.
  function groupCreepXpIntoCamps (xpStream, windowMs) {
    if (!xpStream || !xpStream.length) return [];
    const sorted = xpStream.slice().sort((a, b) => (a.gameTime || 0) - (b.gameTime || 0));
    const camps = [];
    let cur = null;
    for (const ev of sorted) {
      const t = ev.gameTime || 0;
      if (!cur || t - cur.endMs > windowMs) {
        if (cur) camps.push(cur);
        cur = { startMs: t, endMs: t, totalXp: 0, kills: 0 };
      }
      cur.endMs = t;
      cur.totalXp += (ev.xpGained || 0);
      cur.kills += 1;
    }
    if (cur) camps.push(cur);
    return camps;
  }

  // ── Sub-extractors ─────────────────────────────────────────────────────────

  function extractTierTimes (tierStream) {
    let tier2Time = null, tier3Time = null;
    for (const t of (tierStream || [])) {
      if (t.tier === 2 && tier2Time === null) tier2Time = t.gameTime;
      if (t.tier === 3 && tier3Time === null) tier3Time = t.gameTime;
    }
    return { tier2Time, tier3Time };
  }

  function extractHeroOpener (eventStream, race) {
    for (const ev of (eventStream || [])) {
      // Tavern heroes ride a 'makeTavernHero' event, not 'addUnit'.
      const isHeroEvent = ev.unit && (
        (ev.key === 'addUnit' && ev.unit.isHero) ||
        ev.key === 'makeTavernHero'
      );
      if (!isHeroEvent) continue;
      const heroRace = heroRaceFromItemId(ev.unit.itemId);
      // Skip race-mismatched heroes (parser leakage).
      if (heroRace && heroRace !== 'N' && race && heroRace !== race) continue;
      return {
        name: ev.unit.displayName,
        itemId: ev.unit.itemId || '',
        gameTimeMs: ev.gameTime,
        gameTimeFormatted: formatMs(ev.gameTime)
      };
    }
    return null;
  }

  function extractFirsts (eventStream) {
    let firstTowerTime = null;
    let firstUnitTime = null;
    let expansionTime = null;
    let firstHeroLevel2Time = null;
    let firstHeroLevel3Time = null;
    let firstHeroLevel5Time = null;
    for (const ev of (eventStream || [])) {
      if (firstTowerTime === null && ev.key === 'addBuilding' && ev.building && TOWER_IDS[ev.building.itemId]) {
        firstTowerTime = ev.gameTime;
      }
      if (firstUnitTime === null && ev.key === 'addUnit' && ev.unit && !ev.unit.isHero
          && !WORKER_IDS[ev.unit.itemId] && !ev.unit.isSummon && !SUMMON_UNIT_IDS[ev.unit.itemId]) {
        firstUnitTime = ev.gameTime;
      }
      if (expansionTime === null && ev.isExpansion) {
        expansionTime = ev.gameTime;
      }
      // The hero level event key is 'HeroLevel' (capital H) — the original
      // generate-summary.js looked for 'heroLevel' (lowercase) and so always
      // got null. Fix here applies to both Node and browser.
      if (ev.key === 'HeroLevel') {
        if (firstHeroLevel2Time === null && (ev.newLevel === 2 || ev.level === 2)) firstHeroLevel2Time = ev.gameTime;
        if (firstHeroLevel3Time === null && (ev.newLevel === 3 || ev.level === 3)) firstHeroLevel3Time = ev.gameTime;
        if (firstHeroLevel5Time === null && (ev.newLevel === 5 || ev.level === 5)) firstHeroLevel5Time = ev.gameTime;
      }
    }
    return { firstTowerTime, firstUnitTime, expansionTime, firstHeroLevel2Time, firstHeroLevel3Time, firstHeroLevel5Time };
  }

  function extractBuildPreview (eventStream, race, tier2Time, tier3Time, limit) {
    const out = [];
    const max = limit || 20;
    for (const ev of (eventStream || [])) {
      if (out.length >= max) break;
      if (ev.key === 'addBuilding' && ev.building) {
        const id = ev.building.itemId || '';
        // Filter parser leakage where T2/T3 buildings appear pre-tier.
        if (T2_BUILDING_IDS[id] && (tier2Time === null || ev.gameTime < tier2Time)) continue;
        if (T3_BUILDING_IDS[id] && (tier3Time === null || ev.gameTime < tier3Time)) continue;
        out.push({
          type: ev.isExpansion ? 'expansion' : 'building',
          name: ev.building.displayName,
          itemId: id,
          gameTimeMs: ev.gameTime,
          gameTimeFormatted: formatMs(ev.gameTime)
        });
      } else if (ev.key === 'addUnit' && ev.unit) {
        if (WORKER_IDS[ev.unit.itemId]) continue;
        if (ev.unit.isSummon || SUMMON_UNIT_IDS[ev.unit.itemId]) continue;
        if (ev.unit.isHero) {
          const heroRace = heroRaceFromItemId(ev.unit.itemId);
          if (heroRace && heroRace !== 'N' && race && heroRace !== race) continue;
        }
        out.push({
          type: ev.unit.isHero ? 'hero' : 'unit',
          name: ev.unit.displayName,
          itemId: ev.unit.itemId || '',
          gameTimeMs: ev.gameTime,
          gameTimeFormatted: formatMs(ev.gameTime)
        });
      }
    }
    return out;
  }

  function extractTierComposition (eventStream, tier2Time, tier3Time) {
    const t2Buildings = [];
    const t2Units = [];
    const t3Buildings = [];
    const t3Units = [];
    const t2BuildingIds = {};
    const t3BuildingIds = {};
    const t2UnitIds = {};
    const t3UnitIds = {};
    for (const ev of (eventStream || [])) {
      const inT2 = tier2Time !== null && ev.gameTime >= tier2Time && (tier3Time === null || ev.gameTime < tier3Time);
      const inT3 = tier3Time !== null && ev.gameTime >= tier3Time;
      if (ev.key === 'addBuilding' && ev.building && ev.building.itemId) {
        const id = ev.building.itemId;
        if (inT2 && !t2BuildingIds[id]) {
          t2BuildingIds[id] = 1;
          t2Buildings.push({ name: ev.building.displayName, itemId: id });
        } else if (inT3 && !t3BuildingIds[id]) {
          t3BuildingIds[id] = 1;
          t3Buildings.push({ name: ev.building.displayName, itemId: id });
        }
      } else if (ev.key === 'addUnit' && ev.unit && ev.unit.itemId) {
        if (WORKER_IDS[ev.unit.itemId]) continue;
        if (ev.unit.isSummon || SUMMON_UNIT_IDS[ev.unit.itemId]) continue;
        const id = ev.unit.itemId;
        if (inT2 && !t2UnitIds[id]) {
          t2UnitIds[id] = 1;
          t2Units.push({ name: ev.unit.displayName, itemId: id });
        } else if (inT3 && !t3UnitIds[id]) {
          t3UnitIds[id] = 1;
          t3Units.push({ name: ev.unit.displayName, itemId: id });
        }
      }
    }
    return { t2Buildings, t2Units, t3Buildings, t3Units };
  }

  function extractEconomyTrack (eventStream) {
    const out = [];
    let nextSampleAt = 0;
    let lastSnap = null;
    for (const ev of (eventStream || [])) {
      if (typeof ev.gameTime !== 'number') continue;
      if (typeof ev.supplyUsed === 'number') {
        const w = ev.workers || {};
        lastSnap = {
          gameTimeMs: ev.gameTime,
          supplyUsed: ev.supplyUsed,
          supplyMax: ev.supplyMax || 0,
          workersOnGold: w.onGold || 0,
          // UD ghouls on lumber are tracked separately — always sum both.
          workersOnLumber: (w.onLumber || 0) + (w.ghoulsOnLumber || 0),
          totalWorkers: w.totalWorkers || 0
        };
      }
      while (lastSnap && ev.gameTime >= nextSampleAt && nextSampleAt <= ECONOMY_MAX_DURATION_MS) {
        out.push({ ...lastSnap, gameTimeMs: nextSampleAt });
        nextSampleAt += ECONOMY_SAMPLE_INTERVAL_MS;
      }
    }
    return out;
  }

  // Combat-units count over the same time grid as economyTrack. A combat unit
  // is any non-worker, non-summon, non-hero, non-building addUnit.
  function extractCombatUnitsTrack (eventStream, durationMs) {
    const SAMPLE = ECONOMY_SAMPLE_INTERVAL_MS;
    const cap = Math.min(durationMs || ECONOMY_MAX_DURATION_MS, ECONOMY_MAX_DURATION_MS);
    // Build cumulative counts per sample
    const samplePoints = [];
    for (let t = 0; t <= cap; t += SAMPLE) samplePoints.push({ gameTimeMs: t, count: 0 });
    let cumulative = 0;
    let cursor = 0;
    for (const ev of (eventStream || [])) {
      if (ev.key !== 'addUnit' || !ev.unit) continue;
      if (ev.unit.isHero) continue;
      if (WORKER_IDS[ev.unit.itemId]) continue;
      if (ev.unit.isSummon || SUMMON_UNIT_IDS[ev.unit.itemId]) continue;
      // Walk samplePoints up to this event's time, capturing the running total.
      while (cursor < samplePoints.length && samplePoints[cursor].gameTimeMs <= ev.gameTime) {
        samplePoints[cursor].count = cumulative;
        cursor++;
      }
      cumulative += 1;
    }
    while (cursor < samplePoints.length) {
      samplePoints[cursor].count = cumulative;
      cursor++;
    }
    return samplePoints;
  }

  // Build per-hero camp lists by joining `world.neutralGroups[]` against each
  // hero's uuid via `heroClaimRecords`. Returns a map { heroUuid: [camps] }
  // where each camp has position (from group bounds center), the bounding
  // rectangle (for accurate canvas circle drawing), gameTime, xpGained for
  // THIS hero, and total camp level. Only camps where the hero contributed
  // XP appear.
  function buildHeroCampsByUuid (worldNeutralGroups) {
    const out = {};
    if (!worldNeutralGroups) return out;
    const groups = Array.isArray(worldNeutralGroups)
      ? worldNeutralGroups
      : Object.values(worldNeutralGroups);
    for (const g of groups) {
      if (!g) continue;
      const records = g.heroClaimRecords || [];
      const xpByHero = {};
      for (const r of records) {
        if (!r || !r.uuid) continue;
        xpByHero[r.uuid] = (xpByHero[r.uuid] || 0) + (r.xpGained || 0);
      }
      const heroUuids = Object.keys(xpByHero);
      if (!heroUuids.length) continue;
      // Prefer unitBounds (tight, what the viewer renders) over bounds
      // (padded for spatial queries).
      const b = g.unitBounds || g.bounds || null;
      if (!b) continue;
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      const slimBounds = {
        minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY
      };
      const gameTime = (typeof g.claimTime === 'number' && g.claimTime > 0)
        ? g.claimTime
        : (records[0] && records[0].gameTime) || 0;
      for (const uuid of heroUuids) {
        if (!out[uuid]) out[uuid] = [];
        out[uuid].push({
          gameTimeMs: gameTime,
          gameTimeFormatted: formatMs(gameTime),
          xpGained: xpByHero[uuid],
          totalLevel: g.totalLevel || 0,
          x: cx,
          y: cy,
          bounds: slimBounds,
          groupId: g.uuid
        });
      }
    }
    for (const k of Object.keys(out)) {
      out[k].sort((a, b) => (a.gameTimeMs || 0) - (b.gameTimeMs || 0));
    }
    return out;
  }

  // Top-level: every neutral group on the map (whether claimed or not) with
  // just enough data for the Creeps tab to draw white outline rings — what
  // the viewer does in MapRenderer.renderNeutralGroups for untouched camps.
  function extractNeutralCamps (worldNeutralGroups) {
    const out = [];
    if (!worldNeutralGroups) return out;
    const groups = Array.isArray(worldNeutralGroups)
      ? worldNeutralGroups
      : Object.values(worldNeutralGroups);
    for (const g of groups) {
      if (!g) continue;
      const b = g.unitBounds || g.bounds || null;
      if (!b) continue;
      out.push({
        groupId: g.uuid,
        totalLevel: g.totalLevel || 0,
        bounds: { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY },
        hasFountain: !!g.hasFountain
      });
    }
    return out;
  }

  // Hero builds — one entry per hero unit. Pulls from units[] (filtered to
  // heroes). Uses the per-hero levelStream which already records skill picks
  // at each level-up.
  function extractHeroBuilds (units, race, worldNeutralGroups) {
    const out = [];
    const campsByUuid = buildHeroCampsByUuid(worldNeutralGroups);
    for (const u of (units || [])) {
      if (!u || !u.meta || !u.meta.hero) continue;
      // Skip race-mismatched (parser leakage). Allow neutral (N) heroes.
      const heroRace = heroRaceFromItemId(u.itemId);
      if (heroRace && heroRace !== 'N' && race && heroRace !== race) continue;

      const skillOrder = [];
      const levelMilestones = [];
      const ls = u.levelStream || [];
      const spellList = u.spellList || [];
      for (const le of ls) {
        if (le && le.gameTime != null) {
          levelMilestones.push({
            level: le.newLevel,
            gameTimeMs: le.gameTime,
            gameTimeFormatted: formatMs(le.gameTime)
          });
        }
        if (le && le.newSkill && le.newSkill.displayName) {
          // Recover the abilityId from spellList[slot]. Hero.addLevelEvent
          // stores `slot = spellList.indexOf(spellId)`, so the reverse lookup
          // gives us the FourCC ability id needed for icon rendering.
          const abilityId = (typeof le.slot === 'number' && le.slot >= 0)
            ? (spellList[le.slot] || null) : null;
          skillOrder.push({
            heroLevel: le.newLevel,
            abilityId,
            skillName: le.newSkill.displayName,
            skillLevel: le.newSkill.level,
            gameTimeMs: le.gameTime,
            gameTimeFormatted: formatMs(le.gameTime)
          });
        }
      }

      // Final inventory at end of match. Items array is on the exported unit.
      const items = (u.items || [])
        .filter(slot => slot && slot.itemId)
        .map(slot => ({
          slot: slot.slot,
          itemId: slot.itemId,
          name: slot.displayName || slot.itemId
        }));

      // Camps (with positions) joined from world.neutralGroups by hero uuid.
      // Falls back to time-clustering of xpStream when world data isn't
      // available (defensive — shouldn't happen in practice).
      let camps;
      if (campsByUuid[u.uuid]) {
        camps = campsByUuid[u.uuid];
      } else {
        const xpStream = u.xpStream || [];
        camps = groupCreepXpIntoCamps(xpStream, 5000).map(c => ({
          gameTimeMs: c.startMs,
          gameTimeFormatted: formatMs(c.startMs),
          xpGained: c.totalXp,
          totalLevel: 0,
          x: null, y: null,
          groupId: null
        }));
      }
      const totalCreepXp = camps.reduce((s, c) => s + (c.xpGained || 0), 0);

      out.push({
        uuid: u.uuid,
        name: u.displayName,
        itemId: u.itemId || '',
        spawnTimeMs: u.spawnTime || u.trainedTime || null,
        finalLevel: u.level || (levelMilestones.length ? levelMilestones[levelMilestones.length - 1].level : 1),
        levelMilestones,
        skillOrder,
        items,
        totalCreepXp,
        camps
      });
    }
    return out;
  }

  // Item purchases (from shops) — already emitted as 'itemPurchase' events on
  // the eventStream by Building.js when a hero buys at a shop.
  function extractItemPurchases (eventStream) {
    const out = [];
    for (const ev of (eventStream || [])) {
      if (ev.key !== 'itemPurchase' || !ev.item) continue;
      out.push({
        itemId: ev.item.itemId || '',
        name: ev.item.displayName || ev.item.itemId || '',
        gameTimeMs: ev.gameTime,
        gameTimeFormatted: formatMs(ev.gameTime),
        goldCost: ev.goldCost || 0,
        isNeutralShop: !!ev.isNeutralShop,
        heroUuid: ev.unit && ev.unit.uuid
      });
    }
    return out;
  }

  // Item uses (consumables — salves, scrolls, tomes).
  function extractItemUses (eventStream) {
    const out = [];
    for (const ev of (eventStream || [])) {
      if (ev.key !== 'itemUse' || !ev.item) continue;
      out.push({
        itemId: ev.item.itemId || '',
        name: ev.item.displayName || ev.item.itemId || '',
        gameTimeMs: ev.gameTime,
        gameTimeFormatted: formatMs(ev.gameTime),
        heroUuid: ev.unit && ev.unit.uuid
      });
    }
    return out;
  }

  function extractMercenaries (eventStream) {
    const out = [];
    for (const ev of (eventStream || [])) {
      // The hired mercenary unit lives on `ev.unit` (it's the unit added to
      // the player). `ev.building` is the merc-camp name string.
      if (ev.key !== 'hireMercenary' || !ev.unit) continue;
      out.push({
        itemId: ev.unit.itemId || '',
        name: ev.unit.displayName || ev.unit.itemId || '',
        gameTimeMs: ev.gameTime,
        gameTimeFormatted: formatMs(ev.gameTime),
        goldCost: ev.goldCost || 0,
        lumberCost: ev.lumberCost || 0,
        building: ev.building || ''
      });
    }
    return out;
  }

  // Upgrade timeline — chronological, from the player's researchStream.
  function extractUpgradeTimeline (researchStream) {
    const out = [];
    for (const r of (researchStream || [])) {
      out.push({
        itemId: r.itemId,
        name: r.displayName || r.itemId,
        level: r.level || 1,
        category: r.category || 'research',
        icon: r.icon || '',
        gameTimeMs: r.gameTime,
        gameTimeFormatted: formatMs(r.gameTime)
      });
    }
    out.sort((a, b) => (a.gameTimeMs || 0) - (b.gameTimeMs || 0));
    return out;
  }

  // De-duped researched list (highest level per itemId) — kept for
  // backwards compatibility with the previous summary shape.
  function extractResearched (researchStream) {
    const map = {};
    for (const r of (researchStream || [])) {
      if (!map[r.itemId] || r.level > map[r.itemId].level) {
        map[r.itemId] = {
          itemId: r.itemId,
          name: r.displayName,
          level: r.level,
          category: r.category,
          icon: r.icon,
          gameTimeMs: r.gameTime,
          gameTimeFormatted: formatMs(r.gameTime)
        };
      }
    }
    return Object.values(map);
  }

  // ── Archetype classifier ───────────────────────────────────────────────────

  function classifyArchetype (tier2Time, expansionTime, firstTowerTime) {
    const SIX_MIN = 6 * 60 * 1000;
    const EIGHT_MIN = 8 * 60 * 1000;
    const FOUR_MIN = 4 * 60 * 1000;
    const TWO_MIN = 2 * 60 * 1000;

    if (firstTowerTime !== null && firstTowerTime < FOUR_MIN) return 'tower-rush';
    if (expansionTime !== null) {
      if (tier2Time === null) return 'fast-expand';
      if (expansionTime < tier2Time) return 'fast-expand';
      if (expansionTime - tier2Time < TWO_MIN) return 'fast-expand';
    }
    if (tier2Time !== null && tier2Time < SIX_MIN
        && (expansionTime === null || expansionTime > EIGHT_MIN)) {
      return '1-base-t2';
    }
    return 'unknown';
  }

  // ── Main entry point ───────────────────────────────────────────────────────

  // `worldNeutralGroups` (optional) is the parsed `world.neutralGroups` object
  // from the .wc3v JSON. When provided, hero camps come back with positions
  // joined by hero uuid. When omitted, falls back to time-clustering xpStream.
  function extractPlayerSummary (playerData, replayPlayerData, durationMs, worldNeutralGroups) {
    const eventStream = playerData.eventStream || [];
    const tierStream = playerData.tierStream || [];
    const researchStream = playerData.researchStream || [];
    const units = playerData.units || [];
    const apmData = playerData.apmData || null;
    const race = playerData.race || (replayPlayerData && replayPlayerData.raceDetected) || null;
    const startingPosition = playerData.startingPosition
      ? { x: playerData.startingPosition.x, y: playerData.startingPosition.y }
      : null;

    const { tier2Time, tier3Time } = extractTierTimes(tierStream);
    const heroOpener = extractHeroOpener(eventStream, race);
    const firsts = extractFirsts(eventStream);
    const buildPreview = extractBuildPreview(eventStream, race, tier2Time, tier3Time, 20);
    const tierComp = extractTierComposition(eventStream, tier2Time, tier3Time);
    const economyTrack = extractEconomyTrack(eventStream);
    const combatUnitsTrack = extractCombatUnitsTrack(eventStream, durationMs);
    const heroBuilds = extractHeroBuilds(units, race, worldNeutralGroups);
    const itemPurchases = extractItemPurchases(eventStream);
    const itemUses = extractItemUses(eventStream);
    const mercenariesHired = extractMercenaries(eventStream);
    const upgradeTimeline = extractUpgradeTimeline(researchStream);
    const researched = extractResearched(researchStream);

    const archetype = classifyArchetype(tier2Time, firsts.expansionTime, firsts.firstTowerTime);

    const result = {
      name: replayPlayerData ? replayPlayerData.name : null,
      race,
      startingPosition,
      heroOpener,
      tier2Time,
      tier2TimeFormatted: tier2Time !== null ? formatMs(tier2Time) : null,
      tier3Time,
      tier3TimeFormatted: tier3Time !== null ? formatMs(tier3Time) : null,
      expansionTime: firsts.expansionTime,
      expansionTimeFormatted: firsts.expansionTime !== null ? formatMs(firsts.expansionTime) : null,
      firstTowerTime: firsts.firstTowerTime,
      firstTowerTimeFormatted: firsts.firstTowerTime !== null ? formatMs(firsts.firstTowerTime) : null,
      firstUnitTime: firsts.firstUnitTime,
      firstUnitTimeFormatted: firsts.firstUnitTime !== null ? formatMs(firsts.firstUnitTime) : null,
      firstHeroLevel2Time: firsts.firstHeroLevel2Time,
      firstHeroLevel2TimeFormatted: firsts.firstHeroLevel2Time !== null ? formatMs(firsts.firstHeroLevel2Time) : null,
      firstHeroLevel3Time: firsts.firstHeroLevel3Time,
      firstHeroLevel3TimeFormatted: firsts.firstHeroLevel3Time !== null ? formatMs(firsts.firstHeroLevel3Time) : null,
      firstHeroLevel5Time: firsts.firstHeroLevel5Time,
      firstHeroLevel5TimeFormatted: firsts.firstHeroLevel5Time !== null ? formatMs(firsts.firstHeroLevel5Time) : null,
      archetype,
      economyTrack,
      buildPreview,
      t2Buildings: tierComp.t2Buildings,
      t2Units: tierComp.t2Units,
      t3Buildings: tierComp.t3Buildings,
      t3Units: tierComp.t3Units,
      researched,
      // ── New richer fields used by the redesigned compare modal ──
      heroBuilds,
      itemPurchases,
      itemUses,
      mercenariesHired,
      upgradeTimeline,
      combatUnitsTrack,
      // APM is opt-in (null when the parser didn't compute it).
      apm: apmData ? {
        rawAverage: (apmData.raw && apmData.raw.average) || 0,
        effectiveAverage: (apmData.effective && apmData.effective.average) || 0,
        effectivePerMinute: (apmData.effective && apmData.effective.perMinute) || [],
        categories: apmData.categories || {}
      } : null
    };

    return result;
  }

  // ── Module export (Node) + window export (browser) ─────────────────────────

  const api = {
    extractPlayerSummary,
    extractNeutralCamps,
    resolveMapFolder,
    slimMapInfo,
    classifyArchetype,
    formatMs,
    // Constants exposed for callers that want to mirror the same filtering
    // (e.g., ReplayAnalyzer when classifying eventStream tail events).
    SUMMON_UNIT_IDS,
    WORKER_IDS,
    TOWER_IDS,
    T2_BUILDING_IDS,
    T3_BUILDING_IDS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.SummaryExtract = api;
  }
})();
