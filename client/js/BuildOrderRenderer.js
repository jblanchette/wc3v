// Replay-derived strings (player names, hero names, unit displayNames,
// itemIds) reach this file via the parsed wc3v JSON. Everything that
// flows into innerHTML must go through these helpers — see Security.js.
//   _esc  — sanitize + HTML-escape, for text in element bodies
//   _attr — sanitize + attr-escape, for title="…" / alt="…"
//   _icon — strict whitelist for /assets/wc3icons/{id}.jpg path segments;
//           returns '' if the id has any character that could escape the
//           src attribute or traverse the path.
const _esc  = (s) => Security.escapeHtml(Security.sanitizeUserText(s));
const _attr = (s) => Security.escapeAttr(Security.sanitizeUserText(s));
const _icon = (id) => /^[A-Za-z0-9_\-]{1,32}$/.test(String(id == null ? '' : id)) ? id : '';
// For OUR authored prose only (the beginner-view callouts) — escapes the text
// and wraps known jargon in glossary tooltips when Glossary.js is loaded.
const _gloss = (s) => (window.Glossary && window.Glossary.linkifyText)
  ? window.Glossary.linkifyText(String(s == null ? '' : s))
  : _esc(s);

// Build-order filter preset used in "Beginner view": the skeleton only —
// buildings + tier transitions, units / heroes / worker moves, and tier
// composition summaries. Upgrades, research, and items are hidden (switch to
// "Full detail" for those). Same shape as viewer.boFilters.
const LEARNER_BO_FILTERS = { buildings: true, units: true, upgrades: false, research: false, items: false, summaries: true };

const BO_FILTER_CATEGORIES = [
  { id: 'buildings', label: 'Bldg',  title: 'Buildings',        types: ['building', 'tierUpgrade', 'expansion', 'supplyComplete'] },
  { id: 'units',     label: 'Unit',  title: 'Units & Workers',  types: ['unit', 'heroTraining', 'heroComplete', 'heroLevel', 'workerAssign'] },
  { id: 'upgrades',  label: 'Upg',   title: 'Attack/Def Upgrades', types: ['attackUpgrade', 'defenseUpgrade'] },
  { id: 'research',  label: 'Res',   title: 'Research',         types: ['research'] },
  { id: 'items',     label: 'Item',  title: 'Items & Mercs',    types: ['itemPurchase', 'hireMercenary'] },
  { id: 'summaries', label: 'Sum',   title: 'Tier Summaries',   types: ['tierComplete', 'scout'] }
];

const BO_EVENT_TYPE_TO_CATEGORY = (() => {
  const map = {};
  BO_FILTER_CATEGORIES.forEach(cat => {
    cat.types.forEach(t => { map[t] = cat.id; });
  });
  return map;
})();

const BuildOrderRenderer = class {
  constructor (viewer) {
    this.viewer = viewer;
    this.boData = new BuildOrderData();
    this.liveBoEventElements = [];
    this.currentLiveBoEvent = null;
    this._responsiveObserver = null;
    this._responsiveTimeout = null;
    // Mobile-only: which player's BO is currently shown. Persisted between
    // page loads in sessionStorage so navigating away and back lands on the
    // same player. Index into viewer.buildOrderPlayers.
    this.activeMobilePlayerIdx = 0;
  }

  _updateResponsiveClass () {
    const wrapper = document.getElementById('build-wrapper');
    if (!wrapper) return;
    const w = wrapper.offsetWidth;
    wrapper.classList.remove('bo-wide', 'bo-medium', 'bo-narrow');
    if (w > 600) wrapper.classList.add('bo-wide');
    else if (w > 400) wrapper.classList.add('bo-medium');
    else wrapper.classList.add('bo-narrow');
  }

  _observeResponsive () {
    if (this._responsiveObserver) return;
    const wrapper = document.getElementById('build-wrapper');
    if (!wrapper || typeof ResizeObserver === 'undefined') return;

    this._responsiveObserver = new ResizeObserver(() => {
      if (this._responsiveTimeout) clearTimeout(this._responsiveTimeout);
      this._responsiveTimeout = setTimeout(() => {
        this._responsiveTimeout = null;
        this._updateResponsiveClass();
      }, 80);
    });
    this._responsiveObserver.observe(wrapper);
  }

  setupBuildOrder () {
    // Auto-select all non-neutral players
    this.viewer.buildOrderPlayers = [];
    this.viewer.players.forEach(player => {
      if (player.isNeutralPlayer) return;
      this.viewer.buildOrderPlayers.push(player);
    });

    // Restore last-viewed mobile player for this replay, if any.
    if (this.viewer.mobileMode) {
      try {
        const key = `wc3v.mobileBoPlayerIdx.${this.viewer.replayId || 'default'}`;
        const stored = parseInt(sessionStorage.getItem(key), 10);
        if (Number.isFinite(stored) && stored >= 0 && stored < this.viewer.buildOrderPlayers.length) {
          this.activeMobilePlayerIdx = stored;
        } else {
          this.activeMobilePlayerIdx = 0;
        }
      } catch (e) {
        this.activeMobilePlayerIdx = 0;
      }
    }

    this._wireBeginnerHandlers();
    this.renderBuildOrder();
  }

  // One-time wiring for the dynamically-rendered beginner-view affordances
  // (player pick gate, "switch player" link, "show full detail" link inside
  // the opp summary, walkthrough CTA). Also warms the jargon glossary so
  // beginner-view callouts get tooltips on the first render. The site-wide
  // skill-band switch itself (Beginner / Full detail) is handled by
  // BandSwitcher.js — no per-page wiring needed.
  _wireBeginnerHandlers () {
    if (!this._beginnerHandlersWired) {
      this._beginnerHandlersWired = true;
      document.addEventListener('click', (e) => {
        const t = e.target;
        if (!t || !t.closest) return;
        const pickOpt = t.closest('.bo-pick-opt[data-bo-pick-slot]');
        if (pickOpt) { e.preventDefault(); this.viewer.setBeginnerPick(pickOpt.dataset.boPickSlot); return; }
        if (t.closest('[data-bo-switch-player]'))    { e.preventDefault(); this.viewer.clearBeginnerPick(); return; }
        if (t.closest('[data-bo-show-full-opp]'))    {
          // The "show full detail" link inside the beginner-view opp summary
          // exits beginner view by switching the site band to pro. This is
          // the only path in the viewer that mutates the band programmatically.
          e.preventDefault();
          if (window.BandSwitcher) window.BandSwitcher.setBand('pro', { persist: true });
          return;
        }
        if (t.closest('[data-bo-start-walkthrough]')) { e.preventDefault(); this.viewer.enterGuideMode(this.viewer._getBeginnerPickedPlayer()); return; }
      });
    }
    if (this.viewer.setupGuide) this.viewer.setupGuide();
    if (window.Glossary && window.Glossary.load) { try { window.Glossary.load(); } catch (e) {} }
  }

  // A plain-language callout shown only in Beginner view. `kind`: 'opening'
  // (top of Tier 1) or 'tier' (after a tier-upgrade card, with `tierTarget`).
  renderLearnerCallout (kind, tierTarget) {
    let tag, body;
    if (kind === 'opening') {
      tag = 'The opening';
      body = "Copy the order of these first buildings and units more than the exact times — the sequence is what makes the build work.";
    } else if (kind === 'tier' && Number(tierTarget) === 2) {
      tag = 'Tier 2';
      body = "Usually the build's biggest timing — reaching it on schedule unlocks your main army and key upgrades.";
    } else if (kind === 'tier' && Number(tierTarget) === 3) {
      tag = 'Tier 3';
      body = "Often optional — many games are decided before this. Tech here for top-tier units and upgrades if the game runs long.";
    } else {
      return null;
    }
    const el = document.createElement('div');
    el.classList.add('bo-learn-callout');
    el.innerHTML = `<b class="bo-learn-callout-tag">${_esc(tag)}</b> ${_gloss(body)}`;
    return el;
  }

  // ── Beginner view: pick gate / walkthrough CTA / opp summary ─────────
  _renderBeginnerPickGate (panelEl, players) {
    if (!panelEl) return;
    panelEl.innerHTML = '';
    const head = document.createElement('div');
    head.classList.add('bo-pick-head');
    head.innerHTML =
      '<h2 class="bo-pick-title">Whose game do you want to learn from?</h2>'
      + '<p class="bo-pick-sub">The build order is shown from this player’s point of view; the opponent’s build becomes a short summary on the side.</p>';
    panelEl.append(head);
    const opts = document.createElement('div');
    opts.classList.add('bo-pick-opts');
    players.forEach(p => {
      const raceLabel = (typeof RaceLabels !== 'undefined' && RaceLabels[p.race] && RaceLabels[p.race].label) || p.race || '';
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'bo-pick-opt';
      card.dataset.boPickSlot = String(p.playerId != null ? p.playerId : p.slot);
      card.style.setProperty('--p-color', p.playerColor || '#888');
      card.innerHTML =
        '<span class="bo-pick-opt-color" aria-hidden="true"></span>'
        + '<span class="bo-pick-opt-text">'
        + '<span class="bo-pick-opt-name">' + _esc(PlayerNames.canonical(p.displayName)) + '</span>'
        + '<span class="bo-pick-opt-race">' + _esc(raceLabel) + '</span>'
        + '</span>';
      opts.append(card);
    });
    panelEl.append(opts);
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'bo-pick-skip';
    skip.dataset.boShowFullOpp = '1';
    skip.textContent = 'Just show me both builds — switch to Full detail';
    panelEl.append(skip);
  }

  // Beginner-view CTA strip: just the button (the walkthrough HUD itself
  // carries the explanation; a paragraph here is redundant). When the
  // walkthrough is currently open the button is disabled, not hidden — so
  // the control stays where the user expects it. `syncWalkthroughCta` flips
  // that disabled state and is called by app.js on enter/exit guide mode.
  _renderWalkthroughCta (ctaEl, mePlayer) {
    if (!ctaEl) return;
    const ok = (typeof ReplayGuide !== 'undefined') && (this.viewer.buildOrderPlayers || []).filter(p => p && !p.isNeutralPlayer).length >= 2;
    if (!ok) { ctaEl.innerHTML = ''; ctaEl.hidden = true; return; }
    const label = this.viewer._guideOpenedOnce ? '▶ Re-open the walkthrough' : '▶ Start the walkthrough';
    ctaEl.innerHTML = '<button type="button" class="bo-walkthrough-cta-btn" data-bo-start-walkthrough>' + label + '</button>';
    this.syncWalkthroughCta();
  }

  // Disable the "Start/Re-open the walkthrough" button while the walkthrough
  // HUD is open (it's already on screen — re-launching would be a no-op /
  // confusing). Safe to call any time; no-op if the CTA isn't rendered.
  syncWalkthroughCta () {
    const btn = document.querySelector('#bo-walkthrough-cta .bo-walkthrough-cta-btn');
    if (!btn) return;
    const open = !!(this.viewer && this.viewer.guideMode);
    btn.disabled = open;
    btn.classList.toggle('is-disabled', open);
    btn.title = open ? 'The walkthrough is open below — use Exit there to close it' : '';
  }

  // Beginner view: in place of the opponent's full BO column, a PURE-DATA
  // "you vs them" scoreboard — objective milestones a new player can read to
  // gauge how fast they're going. No jargon, no strategy advice. The XP race
  // (hero out / hero levels) is the headline block because out-leveling on
  // creeps is the single biggest early advantage in WC3.
  _renderRaceComparison (mePlayer, oppPlayer) {
    const fmtT = (typeof formatGameTime === 'function')
      ? formatGameTime
      : (ms) => { const s = Math.max(0, Math.round((ms || 0) / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
    const meStream  = (mePlayer  && mePlayer.eventStream)  || [];
    const oppStream = (oppPlayer && oppPlayer.eventStream) || [];

    const WORKERS = new Set(['opeo', 'hpea', 'uaco', 'ewsp']);
    const SUMMONS = new Set(['uske', 'hwat', 'hwt2', 'hwt3', 'efon', 'osw1', 'osw2', 'osw3', 'ucs1']);
    // Spellcaster ARMY units (not heroes — every hero casts). Used for the
    // "did you build spellcasters?" comparison row.
    const CASTERS = new Set(['hmpr', 'hsor', 'oshm', 'odoc', 'ospm', 'ospw', 'unec', 'uban', 'edot', 'efdr']);

    // ── stream readers ──────────────────────────────────────────────────
    const firstHero = (s) => { for (const e of s) if (e && e.key === 'addUnit' && e.unit && e.unit.isHero) return { itemId: e.unit.itemId, name: e.unit.displayName || 'hero', at: e.gameTime }; return null; };
    const heroLevelTime = (s, id, lvl) => { for (const e of s) { if (e && e.key === 'HeroLevel' && e.unit && e.unit.itemId === id) { const nl = Number(e.newLevel != null ? e.newLevel : e.level) || 0; if (nl >= lvl) return e.gameTime; } } return Infinity; };
    const heroMaxLevel = (s, id) => { let m = 0; for (const e of s) { if (e && e.key === 'HeroLevel' && e.unit && e.unit.itemId === id) { const nl = Number(e.newLevel != null ? e.newLevel : e.level) || 0; if (nl > m) m = nl; } } return m; };
    const tierTime = (s, t) => { for (const e of s) if (e && e.key === 'tierUpgrade' && e.building && Number(e.building.tierTarget) === t) return e.gameTime; return Infinity; };
    const expansionTime = (s) => { for (const e of s) if (e && e.key === 'addBuilding' && e.isExpansion === true) return e.gameTime; return Infinity; };
    // supplyUsed & workers ride along on every event, so a first-crossing scan
    // is a fine (slightly coarse) "when did they hit N" measure.
    const supplyReach = (s, n) => { for (const e of s) if (e && typeof e.supplyUsed === 'number' && e.supplyUsed >= n) return e.gameTime; return Infinity; };
    const workerCount = (e) => { const w = e && e.workers; if (!w) return 0; return (Number(w.totalWorkers) || 0) + (Number(w.ghoulsOnLumber) || 0); };
    // Worker count from the last event at or before `ms` (null = no data yet).
    const workersAt = (s, ms) => { let v = null; for (const e of s) { if (!e || typeof e.gameTime !== 'number') continue; if (e.gameTime > ms) break; if (e.workers) v = workerCount(e); } return v; };
    const armyUnits = (s) => {
      const counts = Object.create(null);
      for (const e of s) {
        if (!e || e.key !== 'addUnit' || !e.unit) continue;
        const u = e.unit;
        if (!u.isUnit || u.isBuilding || u.isHero || u.isSummon) continue;
        if (WORKERS.has(u.itemId) || SUMMONS.has(u.itemId)) continue;
        if (!counts[u.itemId]) counts[u.itemId] = { itemId: u.itemId, name: u.displayName || u.itemId, n: 0, attackType: u.attackType || null, armorType: u.armorType || null };
        counts[u.itemId].n++;
      }
      return Object.values(counts).sort((a, b) => b.n - a.n);
    };
    const plural = (name, n) => { if (Number(n) === 1) return name; name = String(name); const m = name.match(/^(.+?) of the (.+)$/); if (m) return plural(m[1], 2) + ' of the ' + m[2]; if (/(?<!a)man$/.test(name)) return name.replace(/man$/, 'men'); if (/(s|x|z|ch|sh)$/i.test(name)) return name + 'es'; return name + 's'; };

    // ── who's ahead on a row ────────────────────────────────────────────
    // Rather than a verbose "you · 6s sooner" badge crammed into its own
    // column (overflows; reads as filler), we just colour the winning side's
    // value and tuck a tiny delta after it. cmp* return { side, delta, na }.
    // Render a second-gap compactly: "42s" up to 90s, then "1m 30s".
    const gapStr = (d) => d < 90 ? d + 's' : Math.floor(d / 60) + 'm' + (d % 60 ? ' ' + (d % 60) + 's' : '');
    const cmpTime = (meT, themT) => {
      if (meT === Infinity && themT === Infinity) return { side: null, na: true };
      if (meT === Infinity)   return { side: 'them' };       // only they reached it
      if (themT === Infinity) return { side: 'me' };         // only you reached it
      const d = Math.round(Math.abs(meT - themT) / 1000);
      if (d <= 5) return { side: null };                     // ≈ same
      return { side: meT < themT ? 'me' : 'them', delta: '−' + gapStr(d) };  // faster = winner; delta = how much sooner
    };
    const cmpNum = (meV, themV) => {
      const a = Number(meV) || 0, b = Number(themV) || 0;
      if (a === b) return { side: null, na: !a && !b };
      return { side: a > b ? 'me' : 'them', delta: '+' + Math.abs(a - b) };
    };
    const tCell = (t) => t === Infinity ? '<span class="bo-cmp-na">—</span>' : _esc(fmtT(t));

    // ── gather ──────────────────────────────────────────────────────────
    const meHero = firstHero(meStream), themHero = firstHero(oppStream);
    const meHeroId = meHero ? meHero.itemId : null, themHeroId = themHero ? themHero.itemId : null;
    const meHeroOut = meHero ? meHero.at : Infinity, themHeroOut = themHero ? themHero.at : Infinity;
    const meHeroMax = meHeroId ? heroMaxLevel(meStream, meHeroId) : 0;
    const themHeroMax = themHeroId ? heroMaxLevel(oppStream, themHeroId) : 0;
    const meHeroL3 = meHeroId ? heroLevelTime(meStream, meHeroId, 3) : Infinity;
    const themHeroL3 = themHeroId ? heroLevelTime(oppStream, themHeroId, 3) : Infinity;
    const meHeroL5 = meHeroId ? heroLevelTime(meStream, meHeroId, 5) : Infinity;
    const themHeroL5 = themHeroId ? heroLevelTime(oppStream, themHeroId, 5) : Infinity;

    const meArmy = armyUnits(meStream), themArmy = armyUnits(oppStream);
    // Merge by displayName: Headhunter / Berserker share a name but differ in
    // itemId after morph, so the same name otherwise lists twice. Keep the
    // first itemId we saw for the icon — they look the same anyway.
    const mergeByName = (arr) => {
      const byName = Object.create(null);
      for (const it of arr) {
        const k = it.name;
        if (!byName[k]) byName[k] = { itemId: it.itemId, name: it.name, n: 0, attackType: it.attackType, armorType: it.armorType };
        byName[k].n += it.n;
      }
      return Object.values(byName).sort((a, b) => b.n - a.n);
    };
    const meArmyMerged = mergeByName(meArmy), themArmyMerged = mergeByName(themArmy);
    const typeTally = (arr, field) => { const t = Object.create(null); for (const it of arr) { const k = it[field]; if (!k) continue; t[k] = (t[k] || 0) + it.n; } return Object.entries(t).sort((a, b) => b[1] - a[1]); };
    const atkLabel = (k) => (typeof ATTACK_TYPES !== 'undefined' && ATTACK_TYPES[k] && ATTACK_TYPES[k].label) || (k === 'hero' ? 'Hero' : k);
    const armLabel = (k) => (typeof ARMOR_TYPES !== 'undefined' && ARMOR_TYPES[k] && ARMOR_TYPES[k].label) || (k === 'hero' ? 'Hero' : k);
    const atkIcon = (k) => (typeof ATTACK_TYPES !== 'undefined' && ATTACK_TYPES[k] && ATTACK_TYPES[k].icon) || '';
    const armIcon = (k) => (typeof ARMOR_TYPES !== 'undefined' && ARMOR_TYPES[k] && ARMOR_TYPES[k].icon) || '';
    const meAtkTally = typeTally(meArmy, 'attackType'),  themAtkTally = typeTally(themArmy, 'attackType');
    const meArmTally = typeTally(meArmy, 'armorType'),   themArmTally = typeTally(themArmy, 'armorType');

    // Combat rule blurbs — shown as native tooltips on each type chip so we
    // don't need a wall-of-text legend underneath.
    const ATK_NOTE = {
      normal: 'Normal attack — extra damage to Medium armor.',
      pierce: 'Pierce attack — extra damage to flyers and Light armor; weak vs Heavy armor.',
      siege:  'Siege attack — extra damage to buildings; weak vs most units.',
      magic:  'Magic attack — extra damage to Heavy armor; weak vs Medium armor.',
      chaos:  'Chaos attack — full damage to every armor type.'
    };
    const ARM_NOTE = {
      large:  'Heavy armor — tough vs Normal and Pierce; takes extra from Magic.',
      medium: 'Medium armor — takes extra from Normal; tough vs Pierce, Siege and Magic.',
      small:  'Light armor — takes extra from Pierce and Magic.',
      none:   'Unarmored — takes extra damage from almost everything.'
    };

    // Icon-chip builders for the Army block — icon + count, tooltip carries
    // the details (attack/armor types for units; combat-rules blurb for type
    // chips). Replaces the long comma-separated text rows that wouldn't fit.
    const unitChipHtml = (it) => {
      const id = _icon(it.itemId);
      const parts = [plural(it.name, it.n) + ' ×' + it.n];
      if (it.attackType) parts.push(atkLabel(it.attackType) + ' attack');
      if (it.armorType)  parts.push(armLabel(it.armorType) + ' armor');
      const isCaster = CASTERS.has(it.itemId);
      const cls = 'bo-cmp-unit-chip' + (isCaster ? ' bo-cmp-unit-chip-caster' : '');
      return '<span class="' + cls + '" title="' + _attr(parts.join(' · ')) + '">'
        +    (id ? '<img loading="lazy" src="/assets/wc3icons/' + id + '.jpg" alt="" onerror="this.style.visibility=\'hidden\'"/>' : '<span class="bo-cmp-chip-noicon"></span>')
        +    '<b class="bo-cmp-chip-n">×' + it.n + '</b>'
        +    (isCaster ? '<span class="bo-cmp-chip-mark" title="Spellcaster" aria-label="Spellcaster">✨</span>' : '')
        + '</span>';
    };
    const unitsStripHtml = (arr) => {
      if (!arr.length) return '<span class="bo-cmp-na">none built</span>';
      return '<span class="bo-cmp-iconstrip">' + arr.slice(0, 8).map(unitChipHtml).join('') + '</span>';
    };
    // Whitelist: only allow icons we ship under /assets/wc3icons/ — defang any
    // unexpected path that might come from ATTACK_TYPES / ARMOR_TYPES.
    const safeTypeIcon = (path) => /^\/assets\/wc3icons\/[A-Za-z0-9_\-]+\.(jpg|svg|png)$/.test(String(path || '')) ? path : '';
    const typeChipHtml = (k, n, kind) => {
      const label = (kind === 'atk' ? atkLabel : armLabel)(k);
      const note  = (kind === 'atk' ? ATK_NOTE : ARM_NOTE)[k] || label;
      const icon  = safeTypeIcon((kind === 'atk' ? atkIcon : armIcon)(k));
      return '<span class="bo-cmp-type-chip" title="' + _attr(note) + '">'
        +    (icon ? '<img loading="lazy" src="' + icon + '" alt="" onerror="this.style.visibility=\'hidden\'"/>' : '')
        +    '<b class="bo-cmp-chip-n">×' + n + '</b>'
        + '</span>';
    };
    const typeStripHtml = (tally, kind) => {
      if (!tally.length) return '<span class="bo-cmp-na">—</span>';
      return '<span class="bo-cmp-iconstrip">' + tally.map(([k, n]) => typeChipHtml(k, n, kind)).join('') + '</span>';
    };

    // ── verdicts — one factual sentence per block ───────────────────────
    const xpVerdict = (() => {
      if (!meHero && !themHero) return 'Neither player trained a hero in this game.';
      if (meHero && !themHero) return 'You had a hero; they didn\'t.';
      if (!meHero && themHero) return 'They had a hero; you didn\'t — a big early disadvantage.';
      if (meHeroL3 !== Infinity && themHeroL3 !== Infinity) {
        const d = Math.round(Math.abs(meHeroL3 - themHeroL3) / 1000);
        if (d <= 5) return 'Both heroes reached level 3 at about the same time.';
        return meHeroL3 < themHeroL3
          ? 'Your hero reached level 3 about ' + gapStr(d) + ' sooner.'
          : 'Their hero reached level 3 about ' + gapStr(d) + ' sooner — that\'s the kind of gap that decides early fights.';
      }
      if (meHeroL3 !== Infinity) return 'Your hero reached level 3; theirs never did.';
      if (themHeroL3 !== Infinity) return 'Their hero reached level 3; yours never did — a clear XP gap.';
      const d = Math.round(Math.abs(meHeroOut - themHeroOut) / 1000);
      if (d <= 5) return 'Both heroes came out at about the same time, and neither hit level 3.';
      return meHeroOut < themHeroOut
        ? 'Your hero came out about ' + gapStr(d) + ' sooner (neither reached level 3).'
        : 'Their hero came out about ' + gapStr(d) + ' sooner (neither reached level 3).';
    })();
    const econVerdict = (() => {
      // Judge on the biggest food milestone both sides actually reached
      // (food is race-fair — every army fills the same supply).
      for (const n of [50, 30, 20]) {
        const a = supplyReach(meStream, n), b = supplyReach(oppStream, n);
        if (a === Infinity || b === Infinity) continue;
        const d = Math.round(Math.abs(a - b) / 1000);
        if (d <= 10) return 'Your economies kept pace with each other (both hit ' + n + ' food around the same time).';
        return a < b
          ? 'You hit ' + n + ' food about ' + gapStr(d) + ' sooner — you were ahead on economy.'
          : 'They hit ' + n + ' food about ' + gapStr(d) + ' sooner — they out-developed you.';
      }
      const a20 = supplyReach(meStream, 20), b20 = supplyReach(oppStream, 20);
      if (a20 !== Infinity && b20 === Infinity) return 'You reached 20 food; they never did this game.';
      if (b20 !== Infinity && a20 === Infinity) return 'They reached 20 food; you never did.';
      return 'Not enough economy data to compare.';
    })();
    const techVerdict = (() => {
      const meT2 = tierTime(meStream, 2), themT2 = tierTime(oppStream, 2);
      const meExp = expansionTime(meStream), themExp = expansionTime(oppStream);
      const expBit = (meExp !== Infinity && themExp !== Infinity) ? ' Both of you took a second base.'
        : (meExp !== Infinity) ? ' You took a second base at ' + fmtT(meExp) + '.'
        : (themExp !== Infinity) ? ' They took a second base at ' + fmtT(themExp) + '.'
        : ' Neither of you expanded.';
      if (meT2 === Infinity && themT2 === Infinity) return 'Neither player upgraded past Tier 1.' + expBit;
      if (meT2 === Infinity) return 'They reached Tier 2; you stayed on Tier 1.' + expBit;
      if (themT2 === Infinity) return 'You reached Tier 2; they stayed on Tier 1.' + expBit;
      const d = Math.round(Math.abs(meT2 - themT2) / 1000);
      if (d <= 5) return 'You both reached Tier 2 at about the same time.' + expBit;
      return (meT2 < themT2
        ? 'You reached Tier 2 about ' + gapStr(d) + ' sooner — a window to press your T2 units.'
        : 'They reached Tier 2 about ' + gapStr(d) + ' sooner — expect their T2 units on the field first.') + expBit;
    })();

    // ── row builders ────────────────────────────────────────────────────
    // 3-column row: label | you | them. The winning side's value is coloured
    // and gets a small inline delta (− = "this much sooner", + = "this many
    // more") — no separate "flag" column to overflow / vanish on narrow widths.
    const decorate = (html, win, delta) => win
      ? '<span class="bo-cmp-win">' + html + (delta ? ' <span class="bo-cmp-delta">' + delta + '</span>' : '') + '</span>'
      : html;
    const row = (label, meHtml, themHtml, cmp) => {
      cmp = cmp || {};
      return '<div class="bo-cmp-row">'
        + '<span class="bo-cmp-rlabel">' + label + '</span>'
        + '<span class="bo-cmp-rme">'   + decorate(meHtml,   cmp.side === 'me',   cmp.delta) + '</span>'
        + '<span class="bo-cmp-rthem">' + decorate(themHtml, cmp.side === 'them', cmp.delta) + '</span>'
        + '</div>';
    };
    // Time row, auto-hidden when neither side reached the milestone.
    const tRow = (label, meT, themT) => {
      const c = cmpTime(meT, themT);
      if (c.na) return '';
      return row(label, tCell(meT), tCell(themT), c);
    };
    // Two-line label: "Early army" + "20 food" beneath it. Lets us give the
    // economy milestones beginner-friendly names without dropping the raw food
    // number new players actually see on their resource bar.
    const labelSub = (top, sub) => '<span class="bo-cmp-rlabel-stack">' + top
      + (sub ? '<span class="bo-cmp-rlabel-sub">' + sub + '</span>' : '') + '</span>';
    // Stacked row for the Army block — each side gets its own full-width row
    // of icons (You on top, Them under) so a long army roster reflows naturally
    // instead of being squished into a ~80px column.
    const stackRow = (label, meHtml, themHtml) =>
      '<div class="bo-cmp-row-stack">'
      + '<div class="bo-cmp-stack-label">' + label + '</div>'
      + '<div class="bo-cmp-stack-side"><span class="bo-cmp-stack-tag bo-cmp-stack-tag-me">You</span>'   + meHtml   + '</div>'
      + '<div class="bo-cmp-stack-side"><span class="bo-cmp-stack-tag bo-cmp-stack-tag-them">Them</span>' + themHtml + '</div>'
      + '</div>';
    const naCell = (s) => '<span class="bo-cmp-na">' + s + '</span>';

    const meName = _esc((mePlayer && PlayerNames.canonical(mePlayer.displayName)) || 'You');
    const themName = _esc((oppPlayer && PlayerNames.canonical(oppPlayer.displayName)) || 'Opponent');
    const themRace = _esc((typeof RaceLabels !== 'undefined' && RaceLabels[oppPlayer && oppPlayer.race] && RaceLabels[oppPlayer.race].label) || (oppPlayer && oppPlayer.race) || '');
    const heroCell = (h, lvl) => h ? _esc(h.name) + (lvl ? ' <span class="bo-cmp-sub">lvl ' + lvl + '</span>' : '') : naCell('none');

    const aside = document.createElement('aside');
    aside.classList.add('bo-cmp');
    aside.style.setProperty('--me-color', (mePlayer && mePlayer.playerColor) || '#6fc18a');
    aside.style.setProperty('--them-color', (oppPlayer && oppPlayer.playerColor) || '#9ca3b8');
    aside.innerHTML =
      '<div class="bo-cmp-head">'
      +   '<div class="bo-cmp-players">'
      +     '<span class="bo-cmp-chip bo-cmp-chip-me"><i class="bo-cmp-dot" aria-hidden="true"></i>You · ' + meName + '</span>'
      +     '<span class="bo-cmp-vs">vs</span>'
      +     '<span class="bo-cmp-chip bo-cmp-chip-them"><i class="bo-cmp-dot" aria-hidden="true"></i>' + themName + (themRace ? ' <i class="bo-cmp-race">' + themRace + '</i>' : '') + '</span>'
      +   '</div>'
      +   '<button type="button" class="bo-cmp-fulllink" data-bo-show-full-opp>See their full build →</button>'
      + '</div>'
      + '<div class="bo-cmp-colhead"><span></span><span>You</span><span>Them</span></div>'

      // ── XP race — the headline block ──
      + '<section class="bo-cmp-block bo-cmp-block-xp">'
      +   '<div class="bo-cmp-block-head"><span class="bo-cmp-bolt" aria-hidden="true">⚔</span>The XP race<span class="bo-cmp-block-sub">— the biggest early lead in the game</span></div>'
      +   row('Hero', heroCell(meHero, meHeroMax), heroCell(themHero, themHeroMax), cmpNum(meHeroMax, themHeroMax))
      +   tRow('On the field', meHeroOut, themHeroOut)
      +   tRow('Reached lvl 3', meHeroL3, themHeroL3)
      +   tRow('Reached lvl 5', meHeroL5, themHeroL5)
      +   '<p class="bo-cmp-verdict">' + xpVerdict + '</p>'
      + '</section>'

      // ── Economy ──
      // Beginner-friendly milestone names ("Early army" etc.) with the raw
      // food count beneath — new players still see the food number on their
      // resource bar, but the label now says what hitting it MEANS. Race
      // caveat lives in the section-head tooltip, not as a long subtitle.
      + '<section class="bo-cmp-block">'
      +   '<div class="bo-cmp-block-head" title="Food = the supply your army takes (you see this on your resource bar). It\'s a race-fair yardstick. Raw worker counts are not — Undead plays on fewer workers by design.">Economy<span class="bo-cmp-block-sub">how fast each side scaled up</span></div>'
      +   tRow(labelSub('Early army',    '20 food'), supplyReach(meStream, 20), supplyReach(oppStream, 20))
      +   tRow(labelSub('Standing army', '30 food'), supplyReach(meStream, 30), supplyReach(oppStream, 30))
      +   tRow(labelSub('Maxed army',    '50 food'), supplyReach(meStream, 50), supplyReach(oppStream, 50))
      +   (function () { const a = workersAt(meStream, 300000), b = workersAt(oppStream, 300000); return row(labelSub('Workers', 'at 5:00'),  a == null ? naCell('—') : String(a), b == null ? naCell('—') : String(b), null); })()
      +   (function () { const a = workersAt(meStream, 600000), b = workersAt(oppStream, 600000); return row(labelSub('Workers', 'at 10:00'), a == null ? naCell('—') : String(a), b == null ? naCell('—') : String(b), null); })()
      +   '<p class="bo-cmp-verdict">' + econVerdict + '</p>'
      + '</section>'

      // ── Teching up ──
      + '<section class="bo-cmp-block">'
      +   '<div class="bo-cmp-block-head">Teching up</div>'
      +   tRow('Tier 2', tierTime(meStream, 2), tierTime(oppStream, 2))
      +   tRow('Tier 3', tierTime(meStream, 3), tierTime(oppStream, 3))
      +   row('Second base', (expansionTime(meStream) === Infinity ? naCell('no') : tCell(expansionTime(meStream))), (expansionTime(oppStream) === Infinity ? naCell('no') : tCell(expansionTime(oppStream))), null)
      +   '<p class="bo-cmp-verdict">' + techVerdict + '</p>'
      + '</section>'

      // ── Army built ──
      // Icon strips instead of comma-soup text. Each side gets its own full-
      // width row (You on top, Them under) so a roster of 5+ unit types isn't
      // crammed into ~80px. Type info (attack/armor) lives on chip tooltips,
      // so we don't need a wall-of-text legend underneath either.
      + '<section class="bo-cmp-block">'
      +   '<div class="bo-cmp-block-head" title="Everything trained over the whole game — deaths are not subtracted. Hover any icon for the unit name, attack type, and armor type.">Army built<span class="bo-cmp-block-sub">hover an icon for details</span></div>'
      +   stackRow('Units built',  unitsStripHtml(meArmyMerged),     unitsStripHtml(themArmyMerged))
      +   stackRow('Attack types', typeStripHtml(meAtkTally, 'atk'), typeStripHtml(themAtkTally, 'atk'))
      +   stackRow('Armor types',  typeStripHtml(meArmTally, 'arm'), typeStripHtml(themArmTally, 'arm'))
      + '</section>';
    return aside;
  }

  _persistMobilePlayerIdx () {
    try {
      const key = `wc3v.mobileBoPlayerIdx.${this.viewer.replayId || 'default'}`;
      sessionStorage.setItem(key, String(this.activeMobilePlayerIdx));
    } catch (e) { /* sessionStorage may be disabled */ }
  }

  // Renders a sticky chip bar above the BO columns when in mobile mode.
  // One chip per non-neutral player; tapping a chip swaps which player's
  // BO is rendered. The unused side container is hidden via CSS.
  _renderMobilePlayerSwitch () {
    const content = document.getElementById('bo-content');
    if (!content) return;

    let bar = document.getElementById('bo-mobile-player-switch');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'bo-mobile-player-switch';
      bar.classList.add('bo-mobile-player-switch');
      const columns = document.getElementById('bo-columns');
      content.insertBefore(bar, columns || content.firstChild);
    }

    bar.innerHTML = '';

    this.viewer.buildOrderPlayers.forEach((player, idx) => {
      const raceMeta = (typeof RaceLabels !== 'undefined' && RaceLabels[player.race]) || null;
      const raceLabel = raceMeta ? raceMeta.label : (player.race || '');
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.classList.add('bo-mobile-chip');
      if (idx === this.activeMobilePlayerIdx) chip.classList.add('bo-mobile-chip-active');
      chip.style.setProperty('--chip-color', player.playerColor || '#666');

      const nameEl = document.createElement('span');
      nameEl.classList.add('bo-mobile-chip-name');
      nameEl.textContent = Security.sanitizeUserText(PlayerNames.canonical(player.displayName) || `Player ${idx + 1}`);

      const raceEl = document.createElement('span');
      raceEl.classList.add('bo-mobile-chip-race');
      raceEl.textContent = raceLabel;

      chip.append(nameEl, raceEl);

      chip.addEventListener('click', () => {
        if (this.activeMobilePlayerIdx === idx) return;
        this.activeMobilePlayerIdx = idx;
        this._persistMobilePlayerIdx();
        this.renderBuildOrder();
        // Reset scroll to top of new player
        const buildArea = document.getElementById('build-area');
        if (buildArea) buildArea.scrollTop = 0;
      });

      bar.append(chip);
    });
  }

  applyRaceTheme (element, race) {
    const theme = typeof RaceTheme !== 'undefined' ? RaceTheme[race] : null;
    if (!theme) return;
    element.style.setProperty('--race-bg', theme.bg);
    element.style.setProperty('--race-bg-grad', theme.bgGrad);
    element.style.setProperty('--race-border', theme.border);
    element.style.setProperty('--race-accent', theme.accent);
    element.style.setProperty('--race-text', theme.text);
    element.style.setProperty('--race-tier-label', theme.tierLabel);
    element.style.setProperty('--race-muted', theme.muted);
    element.style.setProperty('--race-row-building', theme.rowBuilding);
    element.style.setProperty('--race-row-unit', theme.rowUnit);
    element.style.setProperty('--race-row-hero', theme.rowHero);
  }

  renderBuildOrder () {
    const allPlayers = this.viewer.buildOrderPlayers;

    const columnsEl = document.getElementById('bo-columns');
    const emptyEl = document.getElementById('bo-empty');
    if (!columnsEl || !emptyEl) return;

    // Beginner-view state — used throughout: a simpler filter preset, no
    // per-column filter chips, plain-language callouts, a CSS hook. Driven
    // by the site-wide skill band (BandSwitcher; band === 'new' → beginner).
    const learnerMode = !!this.viewer.boLearnerMode;
    const effFilters = learnerMode ? LEARNER_BO_FILTERS : (this.viewer.boFilters || {});

    // Beginner mode: pick a "Me" player. Without a pick, the BO area is taken
    // over by a full-panel chooser. With a pick, the panel renders Me's BO on
    // the left and a small opponent summary on the right (the full opp BO is
    // not shown). Pro mode is unchanged.
    const nonNeutral = (allPlayers || []).filter(p => p && !p.isNeutralPlayer);
    const mePlayer = learnerMode ? this.viewer._getBeginnerPickedPlayer() : null;
    const pickPanelEl = document.getElementById('bo-pick-panel');
    const ctaEl = document.getElementById('bo-walkthrough-cta');
    const showPickGate = learnerMode && !mePlayer && nonNeutral.length >= 2;

    if (showPickGate) {
      if (pickPanelEl) { this._renderBeginnerPickGate(pickPanelEl, nonNeutral); pickPanelEl.hidden = false; }
      if (columnsEl) columnsEl.style.display = 'none';
      if (emptyEl) emptyEl.style.display = 'none';
      if (ctaEl) { ctaEl.hidden = true; ctaEl.innerHTML = ''; }
      const ls = columnsEl && columnsEl.querySelector('.bo-side-left');
      const rs = columnsEl && columnsEl.querySelector('.bo-side-right');
      if (ls) ls.innerHTML = '';
      if (rs) rs.innerHTML = '';
      if (this.viewer.timelineSpline) this.viewer.timelineSpline.destroy();
      return;
    }
    if (pickPanelEl) pickPanelEl.hidden = true;
    if (ctaEl) {
      if (learnerMode && mePlayer) { this._renderWalkthroughCta(ctaEl, mePlayer); ctaEl.hidden = false; }
      else { ctaEl.hidden = true; ctaEl.innerHTML = ''; }
    }

    // Mobile: render the player switcher and narrow the visible set to the
    // active player. In beginner-with-pick mode we lock to Me and suppress
    // the switcher entirely (the per-column "ME" header carries the label).
    let buildOrderPlayers = allPlayers;
    if (this.viewer.mobileMode) {
      const sw = document.getElementById('bo-mobile-player-switch');
      if (learnerMode && mePlayer) {
        if (sw) sw.hidden = true;
        buildOrderPlayers = [mePlayer];
      } else {
        if (sw) sw.hidden = false;
        this._renderMobilePlayerSwitch();
        const idx = Math.max(0, Math.min(this.activeMobilePlayerIdx, allPlayers.length - 1));
        buildOrderPlayers = allPlayers.length ? [allPlayers[idx]] : [];
      }
    } else if (learnerMode && mePlayer) {
      buildOrderPlayers = [mePlayer];
    }

    // Clear side containers (not the structural elements)
    const leftSide = columnsEl.querySelector('.bo-side-left');
    const rightSide = columnsEl.querySelector('.bo-side-right');
    if (leftSide) leftSide.innerHTML = '';
    if (rightSide) rightSide.innerHTML = '';

    // Clear any existing spline SVG
    if (this.viewer.timelineSpline) {
      this.viewer.timelineSpline.destroy();
    }

    if (!buildOrderPlayers.length) {
      emptyEl.style.display = 'flex';
      columnsEl.style.display = 'none';
      return;
    }

    emptyEl.style.display = 'none';
    columnsEl.style.display = 'flex';

    const timelineGap = document.getElementById('bo-timeline-gap');

    // In beginner-with-pick mode the right side carries the opp summary, so
    // it's a two-visual-column layout even though we only render Me's column.
    const visualSingle = (buildOrderPlayers.length === 1) && !(learnerMode && mePlayer);
    if (visualSingle) {
      columnsEl.classList.add('bo-single');
      if (timelineGap) timelineGap.style.display = 'none';
    } else {
      columnsEl.classList.remove('bo-single');
      if (timelineGap) timelineGap.style.display = '';
    }

    // Build team-to-side mapping: first team seen -> left, rest -> right
    // For FFA (all unique teams), split evenly. Beginner-with-pick: force Me
    // to the left (regardless of team) so the opp summary lands on the right.
    const teamSideMap = {};
    if (learnerMode && mePlayer) {
      teamSideMap[mePlayer.teamColor] = 'left';
    } else {
      let firstTeam = null;
      let leftCount = 0;
      let rightCount = 0;
      const totalPlayers = buildOrderPlayers.filter(p => !p.isNeutralPlayer).length;
      const halfPoint = Math.ceil(totalPlayers / 2);
      buildOrderPlayers.forEach(player => {
        if (player.isNeutralPlayer) return;
        const team = player.teamColor;
        if (firstTeam === null) {
          firstTeam = team;
          teamSideMap[team] = 'left';
        } else if (!(team in teamSideMap)) {
          // Check if all unique teams (FFA) — split evenly
          teamSideMap[team] = (leftCount < halfPoint) ? 'left' : 'right';
        }
        if (teamSideMap[team] === 'left') leftCount++;
        else rightCount++;
      });
    }

    const cfg = BuildOrderData.CONFIG;

    // Render dispatcher — maps event type to render function
    // Note: workerAssign, building, and unit are handled explicitly in the event loop below
    const renderers = {
      heroTraining:  (event, pc) => this.renderHeroTrainingCard(event, pc),
      heroLevel:     (event, pc) => this.renderHeroLevelCard(event, pc),
      tierUpgrade:   (event)     => this.renderTierUpgradeCard(event),
      expansion:     (event)     => this.renderExpansionCard(event),
      scout:         (event)     => this.renderScoutCard(event),
      attackUpgrade: (event)     => this.renderUpgradeCard(event),
      defenseUpgrade:(event)     => this.renderUpgradeCard(event),
      research:      (event)     => this.renderResearchCard(event),
      itemPurchase:  (event)     => this.renderItemPurchaseCard(event),
      hireMercenary: (event)     => this.renderMercHireCard(event)
    };

    buildOrderPlayers.forEach((player, playerIdx) => {
      const boData = this.boData.processBuildOrderData(player);
      const { race, raceInfo, displayName, playerColor, tiers, snapshots, finalSnapshot, tierProduction, tier2Time, tier3Time } = boData;
      const liveMode = this.viewer.layoutMode === LayoutMode.liveBuildOrder;

      const column = document.createElement('div');
      column.classList.add('bo-column');
      column.style.setProperty('--player-color', playerColor);
      this.applyRaceTheme(column, race);
      const isMe = !!(learnerMode && mePlayer && player === mePlayer);
      if (isMe) column.classList.add('bo-me-column');

      // --- Player Header (name + build name + tier + race) ---
      const header = document.createElement('div');
      header.classList.add('bo-player-header');

      const maxTier = tier3Time !== Infinity ? 3 : (tier2Time !== Infinity ? 2 : 1);

      // Look up build name for this player by their playerId
      const bcSlots = this.viewer.buildContextBySlot || {};
      const bc = bcSlots[String(player.playerId)];
      // bc.name comes from buildContextBySlot \u2014 looked up against our
      // own builds dictionary, not from replay metadata. Still escape
      // defensively in case the dictionary grows.
      const buildLabel = bc ? `<span class="bo-hdr-build-name">\u2014 ${_esc(bc.name)}</span>` : '';

      if (bc && bc.selected) {
        header.classList.add('bo-hdr-selected');
      }

      // Beginner mode: a "ME" badge on the picked column + a "switch player"
      // link that re-opens the picker.
      const meTag = isMe ? `<span class="bo-hdr-me-tag" title="You're learning from this player's game">ME</span>` : '';
      const switchLink = isMe ? `<button type="button" class="bo-hdr-switch-player" data-bo-switch-player>switch player</button>` : '';

      const toggleBar = document.createElement('div');
      toggleBar.classList.add('bo-hdr-toggle');
      toggleBar.innerHTML = `
        ${meTag}
        <span class="bo-hdr-player-name" style="color:${_attr(playerColor)}">${_esc(displayName)}${buildLabel}</span>
        <span class="bo-hdr-tier-badge t${Number(maxTier) || 1}">T${Number(maxTier) || 1}</span>
        <span class="bo-hdr-race-badge">${_esc(raceInfo.label)}</span>
        ${switchLink}`;

      // Base Layout button
      const baseBtn = document.createElement('span');
      baseBtn.classList.add('bo-hdr-base-btn');
      baseBtn.title = 'View base layout';
      baseBtn.textContent = 'Base';
      baseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.viewer.showPlacementViewer(player.playerId);
      });
      toggleBar.append(baseBtn);

      header.append(toggleBar);

      column.append(header);

      // --- Chapter Quick-Jump ---
      if (this.viewer.chapterMarkers) {
        const jumpRow = this.viewer.chapterMarkers.renderBoQuickJump(playerIdx);
        if (jumpRow) column.append(jumpRow);
      }

      // --- Filter bar ---
      if (learnerMode) column.classList.add('bo-learner');
      else column.append(this.renderBoFilterBar());

      // --- Column header (sticky icon labels) ---
      const colHeader = document.createElement('div');
      colHeader.classList.add('bo-col-header');
      colHeader.innerHTML = `
        <span class="bo-col-h-desc">ACTION</span>
        <span class="bo-col-h-supply" title="Food supply (used / max)">SUPPLY</span>`;
      column.append(colHeader);

      // --- Tier Sections ---
      let lastArmySummary = null;

      const seenUnitTypes = {};
      // Beginner-with-pick: dedupe building/unit events across ALL tiers so we
      // show only the first appearance of each type (landmarks, not repetition).
      const landmarkMode = !!(learnerMode && mePlayer);
      const seenBuilding = new Set();
      const seenUnit = new Set();

      [1, 2, 3].forEach(tierNum => {
        const tierData = tiers[tierNum];
        if (!tierData.events.length && tierNum > 1) return;

        const tierSection = document.createElement('div');
        tierSection.classList.add('bo-tier-section', `tier-${tierNum}`);

        // Tier headers removed — tier transitions are shown via inline
        // tierUpgrade (start) and tierComplete (finish + summary) cards

        // Beginner view: lead Tier 1 with a "the opening" callout.
        if (learnerMode && tierNum === 1) {
          const intro = this.renderLearnerCallout('opening');
          if (intro) tierSection.append(intro);
        }

        // Events — dispatched by type
        tierData.events.forEach(event => {

          // Filter bar: skip events whose category is toggled off
          const filterCat = BO_EVENT_TYPE_TO_CATEGORY[event.type];
          if (filterCat && effFilters[filterCat] === false) return;

          // Beginner-with-pick: keep only landmark moments. Worker assignments,
          // supply-building completions, scout calls, and the noisy hero-train
          // event are dropped. Building/unit events keep only the first
          // occurrence of each itemId across the whole game.
          if (landmarkMode) {
            if (event.type === 'workerAssign' || event.type === 'supplyComplete'
                || event.type === 'scout' || event.type === 'heroTraining') return;
            if (event.type === 'building' && event.building && event.building.itemId) {
              if (seenBuilding.has(event.building.itemId)) return;
              seenBuilding.add(event.building.itemId);
            }
            if (event.type === 'unit' && event.unit && event.unit.itemId) {
              if (seenUnit.has(event.unit.itemId)) return;
              seenUnit.add(event.unit.itemId);
            }
          }

          const isCard = event.type === 'heroLevel' || event.type === 'heroTraining';

          // Worker dot data from event's snapshot (available on all event types)
          // Include ghoulsOnLumber in the lumber count (UD ghouls tracked separately)
          const workerDots = {
            onGold: event.workersOnGold || 0,
            onLumber: (event.workersOnLumber || 0) + (event.ghoulsOnLumber || 0),
            onBuild: event.workersBuilding || 0
          };

          const supply = event.supplyChanged && tierNum <= 2
            ? { used: event.displaySupplyUsed, max: event.displaySupplyMax }
            : null;

          let el;
          if (event.type === 'tierComplete') {
            const snap = snapshots[event.tierTarget];
            el = this.renderTierCompleteCard(event, snap);
          } else if (event.type === 'workerAssign' || event.type === 'building' || event.type === 'unit' || event.type === 'supplyComplete' || event.type === 'heroComplete') {
            el = this.renderBoRow(event, race, workerDots, supply, tierNum, seenUnitTypes);
          } else {
            const renderer = renderers[event.type];
            if (!renderer) return;
            el = renderer(event, isCard ? playerColor : race);
          }
          el.dataset.gametime = event.gameTime;
          if (liveMode) el.addEventListener('click', () => this.viewer.seekToGameTime(event.gameTime));

          tierSection.append(el);

          // Beginner view: explain the tier transition right after its card.
          if (learnerMode && event.type === 'tierUpgrade') {
            const note = this.renderLearnerCallout('tier', event.tierTarget);
            if (note) tierSection.append(note);
          }
        });

        // Final composition summary at end of tier 3 only
        // (tier 1/2 summaries are now shown inline via tierComplete events)
        if (tierNum === 3 && finalSnapshot && effFilters.summaries !== false) {
          const summary = this.renderArmySummary(finalSnapshot, 'Final Composition');
          tierSection.append(summary);
          lastArmySummary = summary;
        }

        column.append(tierSection);
      });

      if (lastArmySummary) lastArmySummary.classList.add('sticky');

      // Final economy summary card
      if (finalSnapshot && effFilters.summaries !== false) {
        column.append(this.renderEconomySummary(finalSnapshot));
      }

      // Append to correct side based on team
      const side = teamSideMap[player.teamColor] || 'right';
      const sideEl = side === 'left' ? leftSide : rightSide;
      if (sideEl) {
        sideEl.append(column);
      } else {
        columnsEl.append(column);
      }
    });

    // Beginner-with-pick: where the opponent's full BO would have gone, render
    // a pure-data "you vs them" scoreboard instead.
    if (learnerMode && mePlayer) {
      const oppPlayer = nonNeutral.find(p => p !== mePlayer);
      if (oppPlayer && rightSide) {
        rightSide.append(this._renderRaceComparison(mePlayer, oppPlayer));
      }
    }

    // Cache event elements for live mode highlighting
    if (this.viewer.layoutMode === LayoutMode.liveBuildOrder) {
      this.cacheLiveBoEventElements();
    }

    // Trigger timeline spline computation (after DOM layout)
    if (this.viewer.timelineSpline && buildOrderPlayers.length >= 1) {
      this.viewer.timelineSpline.compute();
    }
  }

  // --- Inline cost string (e.g. "180g 50w +10f") ---
  buildInlineCost (event, count = 1) {
    const parts = [];
    const g = event.goldCost * count;
    const l = event.lumberCost * count;
    const fp = (event.foodProvided || 0) * count;
    const f = (event.foodCost || 0) * count;
    if (g) parts.push(`<span class="bo-gold">${g}g</span>`);
    if (l) parts.push(`<span class="bo-lumber">${l}w</span>`);
    if (fp) parts.push(`<span class="bo-food-provide">+${fp}f</span>`);
    else if (f) parts.push(`<span class="bo-food">${f}f</span>`);
    return parts.join(' ');
  }

  // --- Icon with inline cost badge underneath ---
  buildIconWithCost (iconSrc, gold, lumber, onerror) {
    const errAttr = onerror ? ' onerror="this.style.display=\'none\'"' : '';
    let costHtml = '';
    if (gold || lumber) {
      const gSpan = gold ? `<span class="bo-cost-gold">${gold}</span>` : '';
      const sep = (gold && lumber) ? `<span class="bo-icon-cost-sep">/</span>` : '';
      const lSpan = lumber ? `<span class="bo-cost-lumber">${lumber}</span>` : '';
      costHtml = `<span class="bo-icon-cost">${gSpan}${sep}${lSpan}</span>`;
    }
    return `<div class="bo-icon-wrap"><img class="bo-row-icon" src="${iconSrc}"${errAttr} />${costHtml}</div>`;
  }

  // --- Tier header ---
  renderTierHeader (tierNum, tierData) {
    const header = document.createElement('div');
    header.classList.add('bo-tier-header', `tier-${tierNum}`);

    let leftHtml = `TIER ${tierNum}`;
    if (tierNum > 1 && tierData.startTime !== Infinity) {
      leftHtml += ` <span class="bo-tier-time-badge">[${formatGameTime(tierData.startTime)}]</span>`;
    }

    const supplyStr = tierData.startSupply
      ? `${tierData.startSupply.used}/${tierData.startSupply.max}`
      : '';

    header.innerHTML = `<span>${leftHtml}</span><span class="bo-tier-supply">${supplyStr}</span>`;
    return header;
  }

  // --- Tier upgrade card (inline in build order timeline) ---
  renderTierUpgradeCard (event) {
    const card = document.createElement('div');
    const tierTarget = Number(event.tierTarget) || 0;
    card.classList.add('bo-row', 'bo-tier-upgrade-card', `tier-${tierTarget}`);

    const gold = event.goldCost || 0;
    const lumber = event.lumberCost || 0;
    const iconHtml = this.buildIconWithCost(`/assets/wc3icons/${_icon(event.itemId)}.jpg`, gold, lumber);

    card.innerHTML = `
      <div class="bo-row-desc">
        ${iconHtml}
        <span class="bo-row-text">Upgrade to Tier ${tierTarget} started</span>
      </div>`;
    return card;
  }

  // --- Tier complete card (upgrade finished, now on new tier) ---
  renderTierCompleteCard (event, snapshot) {
    const card = document.createElement('div');
    const tierTarget = Number(event.tierTarget) || 0;
    card.classList.add('bo-tier-complete-card', `tier-${tierTarget}`);
    const timeStr = formatGameTime(event.gameTime);

    card.innerHTML = `
      <div class="bo-tier-complete-header">
        <img class="bo-tier-complete-icon" src="/assets/wc3icons/${_icon(event.itemId)}.jpg" />
        <span class="bo-tier-complete-label">TIER ${tierTarget} COMPLETE</span>
        <span class="bo-tier-complete-time">${_esc(timeStr)}</span>
      </div>`;

    // Append army summary snapshot if available
    if (snapshot) {
      const summary = this.renderArmySummary(snapshot, `Tier ${event.tierTarget} Summary`);
      card.append(summary);
    }

    return card;
  }

  // --- Filter chip bar (Buildings / Units / Upgrades / Research / Items / Summaries) ---
  renderBoFilterBar () {
    const bar = document.createElement('div');
    bar.classList.add('bo-filter-bar');

    const icon = document.createElement('span');
    icon.classList.add('bo-filter-icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h12l-4.5 6v4l-3 1.5v-5.5L2 3z"/></svg>';
    bar.append(icon);

    const filters = this.viewer.boFilters || {};

    BO_FILTER_CATEGORIES.forEach(cat => {
      const chip = document.createElement('span');
      chip.classList.add('bo-filter-chip');
      if (filters[cat.id] !== false) chip.classList.add('selected');
      chip.dataset.filter = cat.id;
      chip.title = cat.title;
      chip.textContent = cat.label;
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = !chip.classList.contains('selected');
        this.viewer.setBuildOrderFilter(cat.id, next);
      });
      bar.append(chip);
    });

    return bar;
  }

  // --- Expansion Made bar (second town hall / haunt placed at a new gold mine) ---
  renderExpansionCard (event) {
    const bar = document.createElement('div');
    bar.classList.add('bo-expansion-bar');
    const costStr = this.buildInlineCost(event);
    bar.innerHTML = `
      <img class="bo-expansion-icon" src="/assets/wc3icons/${_icon(event.itemId)}.jpg" />
      <span class="bo-expansion-label">EXPANSION MADE</span>
      ${costStr ? `<span class="bo-expansion-cost">${costStr}</span>` : ''}`;
    return bar;
  }

  // --- Scout card (worker sent outside base) ---
  renderScoutCard (event) {
    const bar = document.createElement('div');
    bar.classList.add('bo-scout-card');
    const safeId = _icon(event.itemId);
    const iconSrc = safeId ? `/assets/wc3icons/${safeId}.jpg` : '';
    const label = _esc(String(event.displayName == null ? '' : event.displayName).toUpperCase());
    bar.innerHTML = `
      ${iconSrc ? `<img class="bo-expansion-icon" src="${iconSrc}" onerror="this.style.display='none'" />` : ''}
      <span class="bo-scout-label">${label}</span>`;
    return bar;
  }

  // --- Attack/Defense upgrade bar ---
  renderUpgradeCard (event) {
    const bar = document.createElement('div');
    const isAttack = event.category === 'attack';
    bar.classList.add('bo-research-bar', isAttack ? 'bo-attack-upgrade' : 'bo-defense-upgrade');
    const iconId = _icon(event.icon || event.itemId);
    const iconSrc = iconId ? `/assets/wc3icons/${iconId}.jpg` : '';
    const label = isAttack ? 'ATK' : 'DEF';
    const level = Number(event.level) || 0;

    const gold = event.goldCost || 0;
    const lumber = event.lumberCost || 0;
    const iconHtml = this.buildIconWithCost(iconSrc, gold, lumber, true);

    bar.innerHTML = `
      <div class="bo-row-desc">
        ${iconHtml}
        <span class="bo-research-badge ${isAttack ? 'atk' : 'def'}">${label} ${level}</span>
        <span class="bo-research-name">${_esc(event.displayName)}</span>
      </div>`;
    return bar;
  }

  // --- Research / ability upgrade card ---
  renderResearchCard (event) {
    const bar = document.createElement('div');
    bar.classList.add('bo-research-bar', 'bo-ability-research');
    const iconId = _icon(event.icon || event.itemId);
    const iconSrc = iconId ? `/assets/wc3icons/${iconId}.jpg` : '';
    const level = Number(event.level) || 0;
    const levelStr = level > 1 ? ` Lv${level}` : '';

    const gold = event.goldCost || 0;
    const lumber = event.lumberCost || 0;
    const iconHtml = this.buildIconWithCost(iconSrc, gold, lumber, true);

    bar.innerHTML = `
      <div class="bo-row-desc">
        ${iconHtml}
        <span class="bo-research-label">RESEARCH</span>
        <span class="bo-research-name">${_esc(event.displayName)}${levelStr}</span>
      </div>`;
    return bar;
  }

  // --- Item purchase bar ---
  renderItemPurchaseCard (event) {
    const bar = document.createElement('div');
    bar.classList.add('bo-item-bar');
    if (event.confidence === 'low') bar.classList.add('bo-item-uncertain');

    const iconSrc = `/assets/wc3icons/${_icon(event.itemId)}.jpg`;
    const gold = event.goldCost || 0;
    const iconHtml = this.buildIconWithCost(iconSrc, gold, 0, true);
    const count = Number(event.count) || 1;
    const countStr = count > 1 ? ` x${count}` : '';
    const shopLabel = event.isNeutralShop ? 'LOOT' : 'ITEM';

    bar.innerHTML = `
      <div class="bo-row-desc">
        ${iconHtml}
        <span class="bo-item-label">${shopLabel}</span>
        <span class="bo-item-name">${_esc(event.displayName)}${countStr}</span>
      </div>`;
    return bar;
  }

  // --- Mercenary hire bar ---
  renderMercHireCard (event) {
    const bar = document.createElement('div');
    bar.classList.add('bo-merc-bar');

    const iconSrc = `/assets/wc3icons/${_icon(event.itemId)}.jpg`;
    const gold = event.goldCost || 0;
    const lumber = event.lumberCost || 0;
    const iconHtml = this.buildIconWithCost(iconSrc, gold, lumber, true);
    const count = Number(event.count) || 1;
    const countStr = count > 1 ? ` x${count}` : '';
    const buildingLabel = event.building === 'Goblin Laboratory' ? 'GOBLIN' : 'MERC';

    bar.innerHTML = `
      <div class="bo-row-desc">
        ${iconHtml}
        <span class="bo-merc-label">${buildingLabel}</span>
        <span class="bo-merc-name">${_esc(event.displayName)}${countStr}</span>
      </div>`;
    return bar;
  }

  // --- Combined hero training card (portrait + badge + costs + first skill, shown at click-time) ---
  renderHeroTrainingCard (event, playerColor) {
    const card = document.createElement('div');
    card.classList.add('bo-hero-training-card');
    card.style.borderLeftColor = playerColor;

    const heroLevel = Number(event.level) || 1;
    const badgeText = event.isTavern ? 'TAVERN' : `Lv ${heroLevel}`;
    const badgeClass = event.isTavern ? 'tavern' : '';
    const badgeBg = event.isTavern ? '' : `style="background:${_attr(playerColor)}"`;

    const gold = Number(event.goldCost) || 0;
    const lumber = Number(event.lumberCost) || 0;
    const goldHtml = gold ? `<span class="bo-row-gold"><span class="bo-cost-dot gold-dot"></span>${gold}</span>` : '';
    const lumberHtml = lumber ? `<span class="bo-row-lumber"><span class="bo-cost-dot lumber-dot"></span>${lumber}</span>` : '';
    const costHtml = (goldHtml || lumberHtml) ? `<div class="bo-training-costs">${goldHtml}${lumberHtml}</div>` : '';

    // First skill choice bar (folded from level 1 heroLevel event)
    let skillsHtml = '';
    if (event.firstSkillList && event.firstSkillList.length) {
      skillsHtml = '<div class="bo-training-skills">';
      event.firstSkillList.forEach(spellInfo => {
        const sid = _icon(spellInfo.itemId);
        const learned = event.firstLearnedSkills && event.firstLearnedSkills[spellInfo.itemId];
        const isActive = spellInfo.itemId === event.firstSkillItemId;
        const level = learned ? Number(learned.level) || 0 : 0;
        const name = learned ? learned.displayName : spellInfo.displayName;

        const classes = ['bo-skill', 'bo-skill-lg'];
        if (isActive) classes.push('active');
        if (learned) classes.push('learned');
        const dimClass = !learned ? 'dimmed' : '';
        const levelHidden = level === 0 ? ' hidden' : '';

        skillsHtml += `<span class="${classes.join(' ')}" title="${_attr(name)}">
          <img class="bo-skill-icon ${dimClass}" src="/assets/wc3icons/${sid}.jpg" />
          <span class="bo-skill-level${levelHidden}">${level || ''}</span>
        </span>`;
      });
      skillsHtml += '</div>';
    } else if (event.firstSkillItemId) {
      const skillName = event.firstSkill ? (event.firstSkill.displayName || '') : '';
      skillsHtml = `<div class="bo-training-skills">
        <span class="bo-skill bo-skill-lg active" title="${_attr(skillName)}">
          <img class="bo-skill-icon" src="/assets/wc3icons/${_icon(event.firstSkillItemId)}.jpg" />
          <span class="bo-skill-level">1</span>
        </span>
      </div>`;
    }

    card.innerHTML = `
      <div class="bo-hero-portrait-col">
        <img class="bo-hero-portrait" src="/assets/wc3icons/${_icon(event.itemId)}.jpg"
          style="border-color:${_attr(playerColor)}" />
        <span class="bo-hero-card-badge ${badgeClass}" ${badgeBg}>${badgeText}</span>
      </div>
      <div class="bo-hero-card-info">
        <span class="bo-hero-card-name">${_esc(event.displayName)}</span>
        ${skillsHtml}
      </div>
      ${costHtml}`;
    return card;
  }

  // renderHeroCard removed — hero spawn card replaced by heroComplete banner row

  // --- Hero level-up card with skill bar ---
  renderHeroLevelCard (event, playerColor) {
    const card = document.createElement('div');
    card.classList.add('bo-hero-level-card');
    card.style.borderLeftColor = playerColor;

    // Build skill bar from spellList + learnedSkills
    let skillsHtml = '';
    if (event.spellList && event.spellList.length) {
      event.spellList.forEach(spellInfo => {
        const sid = _icon(spellInfo.itemId);
        const learned = event.learnedSkills && event.learnedSkills[spellInfo.itemId];
        const isActive = spellInfo.itemId === event.spellItemId;
        const level = learned ? Number(learned.level) || 0 : 0;
        const name = learned ? learned.displayName : spellInfo.displayName;

        // Classes: active = just leveled this card, learned = has points, dimmed = untrained
        const classes = ['bo-skill'];
        if (isActive) classes.push('active');
        if (learned) classes.push('learned');
        const dimClass = !learned ? 'dimmed' : '';
        const levelHidden = level === 0 ? ' hidden' : '';

        skillsHtml += `<span class="${classes.join(' ')}" title="${_attr(name)}">
          <img class="bo-skill-icon ${dimClass}" src="/assets/wc3icons/${sid}.jpg" />
          <span class="bo-skill-level${levelHidden}">${level || ''}</span>
        </span>`;
      });
    } else if (event.spell) {
      // Fallback if no spellList data (older replays)
      const name = event.spell.displayName || '??';
      const lvl = Number(event.spell.level) || 0;
      skillsHtml = `<span class="bo-skill active" title="${_attr(name)}">
        <span class="bo-skill-level">${lvl || '?'}</span>
      </span>`;
    }

    const heroLevel = Number(event.level) || 0;
    card.innerHTML = `
      <img class="bo-level-portrait" src="/assets/wc3icons/${_icon(event.itemId)}.jpg" />
      <div class="bo-level-info">
        <span class="bo-level-title">${_esc(event.displayName)} -> Lv ${heroLevel}</span>
        <div class="bo-level-skills">${skillsHtml}</div>
      </div>`;
    return card;
  }

  // --- Standard build order row (5-column grid: time | desc | workers | cost | supply) ---
  renderBoRow (event, race, workerDots, supply, tierNum, seenUnitTypes) {
    const cfg = BuildOrderData.CONFIG;
    const { type, itemId } = event;
    const count = event.count || 1;

    const row = document.createElement('div');
    row.classList.add('bo-row');

    // Supply column — WC3-style upkeep coloring
    const sUsed = supply ? Number(supply.used) || 0 : 0;
    const sMax = supply ? Number(supply.max) || 0 : 0;
    const upkeepCls = sUsed <= 50 ? 'bo-upkeep-none' : (sUsed <= 80 ? 'bo-upkeep-low' : 'bo-upkeep-high');
    const upkeepLabel = sUsed <= 50 ? '' : (sUsed <= 80 ? 'low' : 'high');
    const upkeepHtml = upkeepLabel ? `<span class="bo-supply-upkeep">${upkeepLabel}</span>` : '';
    const supplyHtml = (sUsed || sMax)
      ? `<div class="bo-row-supply ${upkeepCls}" title="Food: ${sUsed}/${sMax}${upkeepLabel ? ' — ' + upkeepLabel + ' upkeep' : ''}">` +
        `<span class="bo-supply-nums">` +
        `<span class="bo-supply-used">${sUsed}</span>` +
        `<span class="bo-supply-sep">/</span>` +
        `<span class="bo-supply-cap">${sMax}</span>` +
        `</span>${upkeepHtml}</div>`
      : '';

    // Determine if this row type should show inline cost under the icon
    const gold = event.goldCost || 0;
    const lumber = event.lumberCost || 0;
    const showCost = type !== 'workerAssign' && type !== 'heroComplete' && type !== 'supplyComplete';

    let descText;

    const safeName = _esc(event.displayName);
    const safeCount = Number(count) || 1;

    if (type === 'heroComplete') {
      row.classList.add('hero-complete-row');
      descText = `<span class="bo-hero-complete-text">${safeName} Training Complete</span>`;
    } else if (type === 'supplyComplete') {
      row.classList.add('supply-complete-row');
      const foodProvided = Number(event.foodProvided) || 0;
      const foodStr = foodProvided ? `+${foodProvided}` : '';
      descText = `<span class="bo-supply-complete-text">${safeName} Complete</span>` +
        `<span class="bo-supply-badge">${foodStr} supply</span>`;
    } else if (type === 'workerAssign') {
      const assignClass = cfg.assignClasses[event.assignTarget] || 'assign-gold';
      row.classList.add('worker-row', assignClass);
      const workerName = cfg.workerNames[race] || 'Worker';

      if (event.isInitialWorkers) {
        const ghoulsLumber = Number(event.ghoulsOnLumber) || 0;
        const totalWorkers = Number(event.totalWorkers) || 0;
        const goldWorkers = totalWorkers - ghoulsLumber;
        const parts = [];
        if (goldWorkers > 0) {
          parts.push(`${goldWorkers} ${_esc(workerName)} <span class="bo-assign-tag tag-gold">gold</span>`);
        }
        if (ghoulsLumber > 0) {
          parts.push(`${ghoulsLumber} Ghoul <span class="bo-assign-tag tag-lumber">lumber</span>`);
        }
        descText = parts.join(' ');
      } else {
        const tagClass = event.assignTarget === 'lumber' ? 'tag-lumber' : (event.assignTarget === 'build' ? 'tag-build' : 'tag-gold');
        const tagLabel = cfg.assignLabels[event.assignTarget] || 'Gold';
        const countPrefix = safeCount > 1 ? `<span class="bo-unit-count">${safeCount}x</span> ` : '';
        descText = `${countPrefix}${safeName} <span class="bo-assign-tag ${tagClass}">${_esc(tagLabel)}</span>`;
      }
    } else if (type === 'building') {
      row.classList.add('building-row');
      if (event.isShop) row.classList.add('shop-row');
      if (event.isSupplyBuilding) row.classList.add('supply-row');
      const verb = cfg.verbs[type] || 'Build';
      descText = `${_esc(verb)} ${safeName}`;

    } else {
      const verb = cfg.verbs[type] || 'Train';
      row.classList.add('unit-row');
      if (event.isShop) row.classList.add('shop-row');
      const countPrefix = safeCount > 1 ? `<span class="bo-unit-count">${safeCount}x</span> ` : '';
      let typeIcons = '';
      if (seenUnitTypes && !seenUnitTypes[itemId]) {
        seenUnitTypes[itemId] = true;
        const atkInfo = ATTACK_TYPES[event.attackType];
        const defInfo = ARMOR_TYPES[event.armorType];
        // icon paths come from ATTACK_TYPES/ARMOR_TYPES (Constants.js) — trusted,
        // so use them raw. Routing them through _attr() would truncate at 32
        // chars + "…" and break the longer ones (e.g. def-unarmored.jpg → 404).
        if (atkInfo) typeIcons += `<img class="bo-row-type-icon" src="${atkInfo.icon}" title="${_attr(atkInfo.label)} attack" />`;
        if (defInfo) typeIcons += `<img class="bo-row-type-icon" src="${defInfo.icon}" title="${_attr(defInfo.label)} armor" />`;
      }
      descText = `${countPrefix}${_esc(verb)} ${safeName}${typeIcons}`;
    }

    // Column order: desc | supply (cost inlined under icon)
    const safeItemId = _icon(itemId);
    const iconHtml = showCost
      ? this.buildIconWithCost(`/assets/wc3icons/${safeItemId}.jpg`, gold, lumber)
      : `<img class="bo-row-icon" src="/assets/wc3icons/${safeItemId}.jpg" />`;
    row.innerHTML = `
      <div class="bo-row-desc">
        ${iconHtml}
        <span class="bo-row-text">${descText}</span>
      </div>${supplyHtml}`;
    return row;
  }

  // --- Army summary at tier end ---
  renderArmySummary (snapshot, label) {
    const { army, heroes, workers, supply, economy } = snapshot;
    const el = document.createElement('div');
    el.classList.add('bo-army-summary');

    // Summary header
    const headerHtml = label
      ? `<div class="bo-summary-header">${_esc(label)}</div>`
      : '';

    // Heroes section
    let heroesHtml = '';
    if (heroes && heroes.length) {
      let heroItems = '';
      heroes.forEach(h => {
        const statusClass = h.status === 'training' ? 'training' : 'alive';
        const lvl = Number(h.level) || 1;
        const itemLabel = h.status === 'training'
          ? 'Training...'
          : `Lv${lvl}`;
        heroItems += `<span class="bo-summary-hero ${statusClass}">
          <img class="bo-summary-icon hero" src="/assets/wc3icons/${_icon(h.itemId)}.jpg" title="${_attr(h.displayName)}" />
          <span class="bo-summary-hero-label">${itemLabel}</span>
        </span>`;
      });
      heroesHtml = `<div class="bo-summary-section">
        <span class="bo-summary-label">HEROES</span>
        <div class="bo-summary-items">${heroItems}</div>
      </div>`;
    }

    // Army section (non-hero units)
    let armyHtml = '';
    if (army.length) {
      let armyItems = '';
      army.forEach(unit => {
        const c = Number(unit.count) || 0;
        const countStr = c > 1 ? `<span class="bo-army-count">x${c}</span>` : '';
        armyItems += `<span class="bo-summary-unit">
          <img class="bo-summary-icon" src="/assets/wc3icons/${_icon(unit.itemId)}.jpg" title="${_attr(unit.displayName)}" />${countStr}
        </span>`;
      });

      armyHtml = `<div class="bo-summary-section">
        <span class="bo-summary-label">ARMY</span>
        <div class="bo-summary-items">${armyItems}</div>
      </div>`;
    }

    // Upgrades section
    let upgradesHtml = '';
    const upgrades = snapshot.upgrades;
    const hasAtk = upgrades && Object.keys(upgrades.attack).length > 0;
    const hasDef = upgrades && Object.keys(upgrades.defense).length > 0;
    const hasRes = upgrades && upgrades.researched.length > 0;
    if (hasAtk || hasDef || hasRes) {
      let upgradeItems = '';
      Object.values(upgrades.attack).forEach(upg => {
        const iconId = _icon(upg.icon);
        const iconSrc = iconId ? `/assets/wc3icons/${iconId}.jpg` : '';
        const upgLvl = Number(upg.level) || 0;
        upgradeItems += `<span class="bo-summary-upgrade atk"><img class="bo-summary-icon" src="${iconSrc}" title="${_attr(upg.displayName)} ${upgLvl}" onerror="this.style.display='none'" /><span class="bo-upgrade-badge atk">${upgLvl}</span></span>`;
      });
      Object.values(upgrades.defense).forEach(upg => {
        const iconId = _icon(upg.icon);
        const iconSrc = iconId ? `/assets/wc3icons/${iconId}.jpg` : '';
        const upgLvl = Number(upg.level) || 0;
        upgradeItems += `<span class="bo-summary-upgrade def"><img class="bo-summary-icon" src="${iconSrc}" title="${_attr(upg.displayName)} ${upgLvl}" onerror="this.style.display='none'" /><span class="bo-upgrade-badge def">${upgLvl}</span></span>`;
      });
      upgrades.researched.forEach(r => {
        const iconId = _icon(r.icon || r.itemId);
        const iconSrc = iconId ? `/assets/wc3icons/${iconId}.jpg` : '';
        const rLvl = Number(r.level) || 0;
        const lvl = rLvl > 1 ? ` ${rLvl}` : '';
        upgradeItems += `<span class="bo-summary-upgrade ability">
          <img class="bo-summary-icon" src="${iconSrc}" title="${_attr(r.displayName)}" onerror="this.style.display='none'" /><span class="bo-upgrade-name">${_esc(r.displayName)}${lvl}</span>
        </span>`;
      });
      upgradesHtml = `<div class="bo-summary-section">
        <span class="bo-summary-label">UPGRADES</span>
        <div class="bo-summary-items upgrades">${upgradeItems}</div>
      </div>`;
    }

    el.innerHTML = `${headerHtml}${heroesHtml}${armyHtml}${upgradesHtml}`;
    return el;
  }

  // --- Final economy summary card at bottom of player column ---
  renderEconomySummary (snapshot) {
    const { workers, supply, economy } = snapshot;
    const el = document.createElement('div');
    el.classList.add('bo-econ-summary');

    const sUsed = supply ? Number(supply.used) || 0 : 0;
    const sMax = supply ? Number(supply.max) || 0 : 0;
    const supplyStr = supply ? `${sUsed}/${sMax}` : '';
    const goldSpent = Number(economy && economy.goldSpent) || 0;
    const lumberSpent = Number(economy && economy.lumberSpent) || 0;

    el.innerHTML = `
      <span class="bo-summary-label">FINAL ECONOMY</span>
      <div class="bo-econ-detail">
        <span class="bo-econ-group">
          <span class="bo-summary-label">SUPPLY</span>
          <span class="bo-summary-supply">${supplyStr}</span>
        </span>
        <span class="bo-econ-group">
          <span class="bo-summary-label">SPENT</span>
          <span class="bo-summary-spent">
            <span class="bo-cost-dot gold-dot"></span><span class="bo-gold">${goldSpent}</span>
            <span class="bo-cost-dot lumber-dot"></span><span class="bo-lumber">${lumberSpent}</span>
          </span>
        </span>
      </div>`;
    return el;
  }

  updateLiveBoHighlight () {
    if (this.viewer.layoutMode !== LayoutMode.liveBuildOrder) return;
    if (!this.liveBoEventElements.length) return;

    const { gameTime } = this.viewer;

    // Skip if gameTime hasn't changed (e.g. panning while paused)
    if (gameTime === this._lastHighlightGameTime) return;
    this._lastHighlightGameTime = gameTime;

    // Remove previous highlight
    if (this.currentLiveBoEvent) {
      this.currentLiveBoEvent.classList.remove('bo-live-active');
    }

    // Find the latest event at or before current gameTime (binary search)
    const events = this.liveBoEventElements;
    let lo = 0, hi = events.length - 1, activeEl = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (events[mid].gameTime <= gameTime) {
        activeEl = events[mid].el;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    if (activeEl) {
      activeEl.classList.add('bo-live-active');
      this.currentLiveBoEvent = activeEl;
    }
  }

  cacheLiveBoEventElements () {
    this.liveBoEventElements = [];

    const rows = document.querySelectorAll('#bo-columns .bo-row[data-gametime], #bo-columns .bo-hero-training-card[data-gametime], #bo-columns .bo-hero-level-card[data-gametime], #bo-columns .bo-upgrade-bar[data-gametime]');
    rows.forEach(row => {
      const gt = parseFloat(row.dataset.gametime);
      if (!isNaN(gt)) {
        this.liveBoEventElements.push({ el: row, gameTime: gt });
      }
    });
  }
};

window.BuildOrderRenderer = BuildOrderRenderer;
