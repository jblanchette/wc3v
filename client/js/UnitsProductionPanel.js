////
// UnitsProductionPanel.js
// DOM-based panel showing each player's army composition + production queue
// Replaces the old canvas-based player-status panel
////

// Static mapping: unit itemId → ability codes from unitAbilities in mappings.js
const UNIT_ABILITY_MAP = {
  // Human
  'hfoo': ['Udef'],                        // Footman: Defend
  'hprs': ['Uhea', 'Uifr', 'Udis'],        // Priest: Heal, Inner Fire, Dispel
  'hsor': ['Uslo', 'Upol', 'Uinv'],        // Sorceress: Slow, Polymorph, Invisibility
  'hspt': ['Usps', 'Ucmg', 'Ufla'],        // Spell Breaker: Spell Steal, Control Magic, Flare (mortar)
  'hmtm': ['Ufla'],                         // Mortar Team: Flare

  // Orc
  'orai': ['Uens'],                         // Raider: Ensnare
  'oshm': ['Ublu', 'Upur', 'Ulsh'],        // Shaman: Bloodlust, Purge, Lightning Shield
  'odoc': ['Uhww', 'Ustt', 'Usey'],        // Witch Doctor: Healing Ward, Stasis Trap, Sentry
  'ospw': ['Uspl', 'Udec', 'Uasp'],        // Spirit Walker: Spirit Link, Disenchant, Ancestral Spirit
  'okod': ['Udev'],                         // Kodo Beast: Devour
  'otrb': ['Uber'],                         // Troll Berserker: Berserk
  'ohun': ['Uber'],                         // Headhunter (pre-upgrade): Berserk

  // Night Elf
  'edoc': ['Uroa', 'Urej', 'Ubrf'],        // Druid of the Claw: Roar, Rejuvenation, Bear Form
  'edot': ['Uffi', 'Ucyc', 'Urvf'],        // Druid of the Talon: Faerie Fire, Cyclone, Raven Form
  'edry': ['Uadp'],                         // Dryad: Abolish Magic
  'emtg': ['Utau'],                         // Mountain Giant: Taunt
  'esen': ['Usen'],                         // Huntress: Sentinel
  'ewsp': ['Udet'],                         // Wisp: Detonate

  // Undead
  'unec': ['Ursd', 'Uufr', 'Ucrp'],        // Necromancer: Raise Dead, Unholy Frenzy, Cripple
  'uban': ['Ucrs', 'Uams', 'Upos'],        // Banshee: Curse, Anti-magic Shell, Possession
  'ucry': ['Uweb'],                         // Crypt Fiend: Web
  'ugar': ['Ustn'],                         // Gargoyle: Stone Form
  'ubsp': ['Urlf', 'Urlm'],                // Obsidian Statue: Replenish Life, Replenish Mana
  'uobs': ['Urlf', 'Urlm'],                // Obsidian Statue (alt): Replenish Life, Replenish Mana
  'udes': ['Udvm', 'Uabs'],                // Destroyer: Devour Magic, Absorb Mana
};

// Client-side reference to unitAbilities icon data
// We'll resolve these from the icon files directly: /assets/wc3icons/{abilityInfo.icon}.jpg
const UNIT_ABILITY_INFO = {
  'Udef': { displayName: 'Defend', icon: 'Adef' },
  'Uhea': { displayName: 'Heal', icon: 'Ahea' },
  'Uifr': { displayName: 'Inner Fire', icon: 'Ainf' },
  'Udis': { displayName: 'Dispel Magic', icon: 'Adis' },
  'Uslo': { displayName: 'Slow', icon: 'Aslo' },
  'Upol': { displayName: 'Polymorph', icon: 'Aply' },
  'Uinv': { displayName: 'Invisibility', icon: 'Aivs' },
  'Usps': { displayName: 'Spell Steal', icon: 'Asps' },
  'Ucmg': { displayName: 'Control Magic', icon: 'Acmg' },
  'Ufla': { displayName: 'Flare', icon: 'Afla' },
  'Ublu': { displayName: 'Bloodlust', icon: 'Ablo' },
  'Upur': { displayName: 'Purge', icon: 'Aprg' },
  'Ulsh': { displayName: 'Lightning Shield', icon: 'Alsh' },
  'Uhww': { displayName: 'Healing Ward', icon: 'Ahwd' },
  'Ustt': { displayName: 'Stasis Trap', icon: 'Asta' },
  'Usey': { displayName: 'Sentry Ward', icon: 'Aeye' },
  'Uspl': { displayName: 'Spirit Link', icon: 'Aspl' },
  'Udec': { displayName: 'Disenchant', icon: 'Adch' },
  'Uasp': { displayName: 'Ancestral Spirit', icon: 'Aast' },
  'Uens': { displayName: 'Ensnare', icon: 'Aens' },
  'Udev': { displayName: 'Devour', icon: 'Adev' },
  'Uber': { displayName: 'Berserk', icon: 'Absk' },
  'Uroa': { displayName: 'Roar', icon: 'Aroa' },
  'Urej': { displayName: 'Rejuvenation', icon: 'Arej' },
  'Ubrf': { displayName: 'Bear Form', icon: 'Abrf' },
  'Uffi': { displayName: 'Faerie Fire', icon: 'Afae' },
  'Ucyc': { displayName: 'Cyclone', icon: 'Acyc' },
  'Urvf': { displayName: 'Raven Form', icon: 'Arav' },
  'Uadp': { displayName: 'Abolish Magic', icon: 'Aadm' },
  'Utau': { displayName: 'Taunt', icon: 'Atau' },
  'Usen': { displayName: 'Sentinel', icon: 'Aesn' },
  'Udet': { displayName: 'Detonate', icon: 'Adtn' },
  'Ursd': { displayName: 'Raise Dead', icon: 'Arai' },
  'Uufr': { displayName: 'Unholy Frenzy', icon: 'Auhf' },
  'Ucrp': { displayName: 'Cripple', icon: 'Acri' },
  'Ucrs': { displayName: 'Curse', icon: 'Acrs' },
  'Uams': { displayName: 'Anti-magic Shell', icon: 'Aams' },
  'Upos': { displayName: 'Possession', icon: 'Apos' },
  'Uweb': { displayName: 'Web', icon: 'Aweb' },
  'Ustn': { displayName: 'Stone Form', icon: 'Astn' },
  'Udvm': { displayName: 'Devour Magic', icon: 'Advm' },
  'Uabs': { displayName: 'Absorb Mana', icon: 'Aabs' },
  'Urlf': { displayName: 'Replenish Life', icon: 'Arpl' },
  'Urlm': { displayName: 'Replenish Mana', icon: 'Arpm' },
};

const UnitsProductionPanel = class {
  constructor (viewer) {
    this.viewer = viewer;
    this.container = null;
    this._players = [];
    this._playerEls = [];
    this._unitsVisible = true;
    this._productionVisible = true;
    this._lastUpdateGameTime = -1;
    this._lastState = new Map(); // playerId -> { unitKey, prodKey }
    this._completedItems = new Set(); // track recently completed production uuids
  }

  setup (players) {
    this._players = players.filter(p => !p.isNeutralPlayer);

    // Overlay on top of the map canvas inside #main-wrapper
    const wrapper = document.getElementById('main-wrapper');
    if (!wrapper) return;

    // Remove any existing panel from a previous load
    const old = document.getElementById('up-panel');
    if (old) old.remove();

    const panel = document.createElement('div');
    panel.id = 'up-panel';

    // Toggle buttons
    const toggles = document.createElement('div');
    toggles.className = 'up-toggles';

    const unitsBtn = this._createToggle('UNITS', 'units', true);
    const prodBtn = this._createToggle('PRODUCTION', 'production', true);

    toggles.appendChild(unitsBtn);
    toggles.appendChild(prodBtn);
    panel.appendChild(toggles);

    // Per-player sections
    this._playerEls = [];
    this._players.forEach(player => {
      const playerEl = this._buildPlayerSection(player);
      this._playerEls.push(playerEl);
      panel.appendChild(playerEl.root);
    });

    wrapper.appendChild(panel);
    this.container = panel;

    // Responsive sizing: observe wrapper and update CSS custom properties
    this._resizeObserver = new ResizeObserver(() => this._updateSizing());
    this._resizeObserver.observe(wrapper);
    this._updateSizing();
  }

  _updateSizing () {
    if (!this.container) return;
    const wrapper = this.container.parentElement;
    if (!wrapper) return;

    const w = wrapper.clientWidth;
    const h = wrapper.clientHeight;
    const dim = Math.min(w, h);

    // Compact sizing when in split-screen mode
    const isSplit = this.container.classList.contains('up-split-mode');

    // Scale icon sizes relative to canvas dimension
    // Small canvas (~400px): icons 28px hero 34px  |  Large (~900px+): icons 36px hero 42px
    const baseUnitIcon = Math.round(Math.max(28, Math.min(36, dim * 0.045)));
    const unitIcon = isSplit ? Math.round(baseUnitIcon * 0.65) : baseUnitIcon;
    const heroIcon = Math.round(unitIcon * 1.18);
    const abilIcon = isSplit ? 10 : Math.round(Math.max(12, Math.min(16, dim * 0.02)));

    // Cell widths: just slightly wider than the portrait to allow ability overflow
    const cellW = unitIcon + (isSplit ? 3 : 6);
    const heroCellW = heroIcon + (isSplit ? 4 : 8);

    // Hero may span 2 grid columns if wide enough
    const heroSpan = isSplit ? 1 : (heroCellW > cellW * 1.4 ? 2 : 1);

    const s = this.container.style;
    s.setProperty('--up-icon', unitIcon + 'px');
    s.setProperty('--up-hero-icon', heroIcon + 'px');
    s.setProperty('--up-ability-icon', abilIcon + 'px');
    s.setProperty('--up-cell-w', cellW + 'px');
    s.setProperty('--up-hero-cell-w', heroCellW + 'px');
    s.setProperty('--up-hero-span', heroSpan);
  }

  /**
   * Assign split-screen positions based on BroadcastCamera split targets.
   * splitPlayers[0] = top half, splitPlayers[1] = bottom half.
   */
  setSplitPositions (splitPlayers) {
    if (!splitPlayers || splitPlayers.length < 2) return;
    this._playerEls.forEach(pEl => {
      const id = pEl.player.playerId;
      if (id === splitPlayers[0].playerId) {
        pEl.root.dataset.splitPos = 'top';
      } else if (id === splitPlayers[1].playerId) {
        pEl.root.dataset.splitPos = 'bottom';
      }
    });
  }

  clearSplitPositions () {
    this._playerEls.forEach(pEl => {
      delete pEl.root.dataset.splitPos;
    });
  }

  _createToggle (label, section, active) {
    const btn = document.createElement('div');
    btn.className = 'up-toggle' + (active ? ' up-active' : '');
    btn.dataset.section = section;
    btn.textContent = label;

    btn.addEventListener('click', () => {
      btn.classList.toggle('up-active');
      if (section === 'units') {
        this._unitsVisible = btn.classList.contains('up-active');
      } else {
        this._productionVisible = btn.classList.contains('up-active');
      }
      this._updateSectionVisibility();
    });

    return btn;
  }

  _updateSectionVisibility () {
    if (!this.container) return;
    const unitsSections = this.container.querySelectorAll('.up-units-section');
    const prodSections = this.container.querySelectorAll('.up-production-section');

    unitsSections.forEach(el => {
      el.style.display = this._unitsVisible ? '' : 'none';
    });
    prodSections.forEach(el => {
      el.style.display = this._productionVisible ? '' : 'none';
    });
  }

  _buildPlayerSection (player) {
    const root = document.createElement('div');
    root.className = 'up-player';
    root.dataset.playerId = player.playerId;
    root.style.setProperty('--player-color', player.playerColor);

    // Player header
    const header = document.createElement('div');
    header.className = 'up-player-header';

    const colorSwatch = document.createElement('span');
    colorSwatch.className = 'up-player-color';
    colorSwatch.style.background = player.playerColor;

    const name = document.createElement('span');
    name.className = 'up-player-name';
    name.textContent = PlayerNames.canonical(player.displayName);

    header.appendChild(colorSwatch);
    header.appendChild(name);
    root.appendChild(header);

    // Units section
    const unitsSection = document.createElement('div');
    unitsSection.className = 'up-section up-units-section';

    const unitsLabel = document.createElement('div');
    unitsLabel.className = 'up-section-label';
    unitsLabel.textContent = 'UNITS';

    const heroRow = document.createElement('div');
    heroRow.className = 'up-hero-row';

    const unitGrid = document.createElement('div');
    unitGrid.className = 'up-unit-grid';

    unitsSection.appendChild(unitsLabel);
    unitsSection.appendChild(heroRow);
    unitsSection.appendChild(unitGrid);
    root.appendChild(unitsSection);

    // Production section
    const prodSection = document.createElement('div');
    prodSection.className = 'up-section up-production-section';

    const prodLabel = document.createElement('div');
    prodLabel.className = 'up-section-label';
    prodLabel.textContent = 'PRODUCTION';

    const prodGrid = document.createElement('div');
    prodGrid.className = 'up-production-grid';

    prodSection.appendChild(prodLabel);
    prodSection.appendChild(prodGrid);
    root.appendChild(prodSection);

    return {
      root,
      heroRow,
      unitGrid,
      prodGrid,
      player
    };
  }

  update (gameTime) {
    if (!this.container || !this._players.length) return;

    const dt = gameTime - this._lastUpdateGameTime;
    const isSmallStep = dt >= 0 && dt < 200;
    let needsFullRecompute = !isSmallStep;

    // The full recompute tears down and rebuilds this panel's grids with
    // innerHTML, so it must not run every frame. The game-time test alone lets
    // it: at 16x one frame advances ~267ms of game time, so `dt >= 200` is true
    // on every frame. Add a wall-clock floor — a backward jump (scrub) still
    // rebuilds immediately, since that's a real content change.
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (needsFullRecompute && dt >= 0 && (now - (this._lastUpdateWall || 0)) < 200) {
      needsFullRecompute = false;
    }

    // Always update production progress bars (cheap)
    this._updateProductionBars(gameTime);

    if (!needsFullRecompute) return;

    this._lastUpdateWall = now;
    this._lastUpdateGameTime = gameTime;

    this._playerEls.forEach(pEl => {
      const units = this._computeLivingUnits(pEl.player, gameTime);
      const production = this._computeProductionQueue(pEl.player, gameTime);

      this._renderUnitsSection(pEl, units, gameTime);
      this._renderProductionSection(pEl, production, gameTime);
    });
  }

  _computeLivingUnits (player, gameTime) {
    const heroes = [];
    const unitGroups = {};

    player.units.forEach(unit => {
      if (!unit.isUnit || unit.isBuilding || unit.isIllusion) return;

      // Must be spawned/trained and alive
      const readyTime = unit.readyTime || unit.trainedTime || unit.spawnTime;
      if (!readyTime || gameTime < readyTime) return;
      if (unit.destroyedAt && gameTime >= unit.destroyedAt) return;

      // Skip units loaded into transports
      if (unit._loadedWindows && unit._loadedWindows.length) {
        const loaded = unit._loadedWindows.some(w =>
          gameTime >= w.loadTime && (!w.unloadTime || gameTime < w.unloadTime)
        );
        if (loaded) return;
      }

      if (unit.meta && unit.meta.hero) {
        // Get current hero level from levelStream
        let heroLevel = 1;
        let learnedSkills = {};
        if (unit.levelStream && unit.levelStream.length) {
          for (let i = unit.levelStream.length - 1; i >= 0; i--) {
            if (gameTime >= unit.levelStream[i].gameTime) {
              heroLevel = unit.levelStream[i].newLevel;
              learnedSkills = unit.levelStream[i].learnedSkills || {};
              break;
            }
          }
        }

        heroes.push({
          unit,
          itemId: unit.itemId,
          displayName: unit.displayName,
          isHero: true,
          level: heroLevel,
          spellList: unit.spellList || [],
          learnedSkills,
          spawnTime: unit.spawnTime
        });
      } else {
        const key = unit.itemId;
        if (!unitGroups[key]) {
          unitGroups[key] = {
            itemId: key,
            displayName: unit.displayName,
            isHero: false,
            count: 0,
            unit // keep a reference for icon loading
          };
        }
        unitGroups[key].count++;
      }
    });

    // Heroes sorted by spawn time (training order)
    heroes.sort((a, b) => (a.spawnTime || 0) - (b.spawnTime || 0));

    // Non-heroes sorted alphabetically
    const sortedGroups = Object.values(unitGroups)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    return { heroes, groups: sortedGroups };
  }

  _computeProductionQueue (player, gameTime) {
    const rawItems = [];
    const unitBalance = this.viewer.unitBalance;

    player.units.forEach(unit => {
      let startTime = null;
      let endTime = null;

      if (unit.isBuilding && unit.constructionStartTime) {
        // Building under construction
        startTime = unit.constructionStartTime;
        const bt = unitBalance && unitBalance[unit.itemId]
          ? unitBalance[unit.itemId].buildTime
          : 60;
        endTime = startTime + bt * 1000;
      } else if (!unit.isBuilding && unit.spawnTime && unit.trainedTime &&
                 unit.trainedTime > unit.spawnTime) {
        // Unit in training queue (spawnTime = order time, trainedTime = completion)
        startTime = unit.spawnTime;
        endTime = unit.trainedTime;
      }

      if (startTime === null || endTime === null) return;

      rawItems.push({
        uuid: unit.uuid,
        itemId: unit.itemId,
        displayName: unit.displayName,
        isBuilding: unit.isBuilding,
        startTime,
        endTime,
        unit
      });
    });

    // Fix sequential training: units queued at the same building get similar
    // spawnTime but sequential trainedTime. Group by itemId, sort by endTime,
    // and chain them so each unit's display start = previous unit's end.
    // Units from different buildings will have different enough spawnTimes (>5s)
    // to remain independent.
    const groups = {};
    rawItems.forEach(item => {
      if (item.isBuilding) return; // buildings don't queue
      const key = item.itemId;
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });

    for (const key in groups) {
      const group = groups[key];
      if (group.length <= 1) continue;

      // Sort by endTime to establish training order
      group.sort((a, b) => a.endTime - b.endTime);

      // Chain units that were queued together (spawnTime within 5s of each other)
      for (let i = 1; i < group.length; i++) {
        const prev = group[i - 1];
        const curr = group[i];
        // If queued around the same time and curr starts before prev ends,
        // this is a queued unit — its real training starts when prev finishes
        if (Math.abs(curr.startTime - prev.startTime) < 5000 &&
            curr.startTime < prev.endTime) {
          curr.startTime = prev.endTime;
        }
      }
    }

    // Now filter to items active at current gameTime and compute progress
    const items = [];
    rawItems.forEach(item => {
      if (gameTime < item.startTime || gameTime >= item.endTime) return;
      item.progress = Math.min(1, (gameTime - item.startTime) / (item.endTime - item.startTime));
      items.push(item);
    });

    items.sort((a, b) => a.startTime - b.startTime);
    return items;
  }

  _renderUnitsSection (pEl, units, gameTime) {
    const grid = pEl.unitGrid;
    const key = this._unitsKey(units);
    const prevState = this._lastState.get(pEl.player.playerId);

    if (prevState && prevState.unitKey === key) {
      // Only update hero levels (cheap text update)
      this._updateHeroLevels(pEl, units, gameTime);
      return;
    }

    this._lastState.set(pEl.player.playerId, {
      ...(prevState || {}),
      unitKey: key
    });

    pEl.heroRow.innerHTML = '';
    grid.innerHTML = '';

    // Render heroes on their own row
    units.heroes.forEach(hero => {
      pEl.heroRow.appendChild(this._buildHeroEl(hero, gameTime));
    });

    // Render unit groups below heroes
    units.groups.forEach(group => {
      grid.appendChild(this._buildUnitGroupEl(group));
    });
  }

  _updateHeroLevels (pEl, units, gameTime) {
    const heroEls = pEl.heroRow.querySelectorAll('.up-hero');
    units.heroes.forEach((hero, i) => {
      if (heroEls[i]) {
        const levelEl = heroEls[i].querySelector('.up-hero-level');
        if (levelEl) levelEl.textContent = hero.level;
      }
    });
  }

  _buildHeroEl (hero, gameTime) {
    const wrapper = document.createElement('div');
    wrapper.className = 'up-unit up-hero';

    // Portrait
    const portrait = document.createElement('div');
    portrait.className = 'up-portrait up-portrait-hero';

    const img = document.createElement('img');
    img.src = `/assets/wc3icons/${hero.itemId}.jpg`;
    img.alt = hero.displayName;
    img.title = hero.displayName;
    portrait.appendChild(img);

    const levelBadge = document.createElement('span');
    levelBadge.className = 'up-hero-level';
    levelBadge.textContent = hero.level;
    portrait.appendChild(levelBadge);

    wrapper.appendChild(portrait);

    // Abilities: learned spells in rows that fit the card width
    if (hero.spellList && hero.spellList.length) {
      const abilities = document.createElement('div');
      abilities.className = 'up-abilities';

      const icons = hero.spellList.map(spellId => {
        const learned = hero.learnedSkills[spellId];
        const level = learned ? learned.level : 0;
        const spellImg = document.createElement('img');
        spellImg.className = 'up-spell-icon' + (level === 0 ? ' up-spell-unlearned' : '');
        spellImg.src = `/assets/wc3icons/${spellId}.jpg`;
        const spellName = learned ? learned.displayName : spellId;
        spellImg.title = level > 0 ? `${spellName} (${level})` : spellId;
        return spellImg;
      });

      this._appendAbilityRows(abilities, icons, 2);
      wrapper.appendChild(abilities);
    }

    return wrapper;
  }

  _buildUnitGroupEl (group) {
    const wrapper = document.createElement('div');
    wrapper.className = 'up-unit';

    // Portrait
    const portrait = document.createElement('div');
    portrait.className = 'up-portrait';

    const img = document.createElement('img');
    img.src = `/assets/wc3icons/${group.itemId}.jpg`;
    img.alt = group.displayName;
    img.title = group.displayName;
    portrait.appendChild(img);

    if (group.count > 1) {
      const countBadge = document.createElement('span');
      countBadge.className = 'up-unit-count';
      countBadge.textContent = group.count;
      portrait.appendChild(countBadge);
    }

    wrapper.appendChild(portrait);

    // Abilities: attack/defense type + unit abilities, laid out in rows
    const icons = [];

    const unitBalance = this.viewer.unitBalance;
    const balance = unitBalance && unitBalance[group.itemId];
    if (balance) {
      const atkInfo = ATTACK_TYPES[balance.attackType];
      if (atkInfo) {
        const atkImg = document.createElement('img');
        atkImg.className = 'up-type-icon';
        atkImg.src = atkInfo.icon;
        atkImg.title = `${atkInfo.label} attack`;
        icons.push(atkImg);
      }

      const defInfo = ARMOR_TYPES[balance.armorType];
      if (defInfo) {
        const defImg = document.createElement('img');
        defImg.className = 'up-type-icon';
        defImg.src = defInfo.icon;
        defImg.title = `${defInfo.label} armor`;
        icons.push(defImg);
      }
    }

    const abilList = UNIT_ABILITY_MAP[group.itemId];
    if (abilList) {
      abilList.forEach(abilCode => {
        const info = UNIT_ABILITY_INFO[abilCode];
        if (!info) return;
        const abilImg = document.createElement('img');
        abilImg.className = 'up-ability-icon';
        abilImg.src = `/assets/wc3icons/${info.icon}.jpg`;
        abilImg.title = info.displayName;
        icons.push(abilImg);
      });
    }

    if (icons.length) {
      const abilities = document.createElement('div');
      abilities.className = 'up-abilities';
      this._appendAbilityRows(abilities, icons, 2);
      wrapper.appendChild(abilities);
    }

    return wrapper;
  }

  _renderProductionSection (pEl, production, gameTime) {
    const grid = pEl.prodGrid;
    const key = production.map(p => `${p.uuid}:${p.itemId}`).join(',');
    const prevState = this._lastState.get(pEl.player.playerId);

    if (prevState && prevState.prodKey === key) return;

    this._lastState.set(pEl.player.playerId, {
      ...(prevState || {}),
      prodKey: key
    });

    // Invalidate cached prod item list — will be rebuilt on next _updateProductionBars
    pEl._cachedProdItems = [];

    grid.innerHTML = '';

    if (!production.length) {
      const empty = document.createElement('div');
      empty.className = 'up-prod-empty';
      empty.textContent = '\u2014';
      grid.appendChild(empty);
      return;
    }

    production.forEach(item => {
      grid.appendChild(this._buildProdItemEl(item, gameTime));
    });
  }

  _buildProdItemEl (item, gameTime) {
    const wrapper = document.createElement('div');
    wrapper.className = 'up-prod-item';
    wrapper.dataset.uuid = item.uuid;

    const portrait = document.createElement('div');
    portrait.className = 'up-portrait';

    const img = document.createElement('img');
    img.src = `/assets/wc3icons/${item.itemId}.jpg`;
    img.alt = item.displayName;
    img.title = item.displayName;
    portrait.appendChild(img);

    wrapper.appendChild(portrait);

    const bar = document.createElement('div');
    bar.className = 'up-prod-bar';

    const fill = document.createElement('div');
    fill.className = 'up-prod-fill';
    fill.style.width = `${Math.round(item.progress * 100)}%`;
    bar.appendChild(fill);

    wrapper.appendChild(bar);
    return wrapper;
  }

  _updateProductionBars (gameTime) {
    if (!this.container) return;

    // Build uuid→unit lookup once if missing (avoids O(n) find per bar per frame)
    if (!this._unitsByUuid) this._unitsByUuid = new Map();

    this._playerEls.forEach(pEl => {
      // Use cached prod item list instead of querySelectorAll per frame
      if (!pEl._cachedProdItems) pEl._cachedProdItems = [];
      const prodItems = pEl._cachedProdItems;
      if (!prodItems.length && pEl.prodGrid) {
        pEl.prodGrid.querySelectorAll('.up-prod-item').forEach(el => prodItems.push(el));
      }

      for (let i = 0; i < prodItems.length; i++) {
        const el = prodItems[i];
        const uuid = el.dataset.uuid;

        let unit = this._unitsByUuid.get(uuid);
        if (!unit) {
          unit = pEl.player.units.find(u => u.uuid === uuid);
          if (unit) this._unitsByUuid.set(uuid, unit);
          else continue;
        }

        let startTime, endTime;
        const unitBalance = this.viewer.unitBalance;

        if (unit.isBuilding && unit.constructionStartTime) {
          startTime = unit.constructionStartTime;
          const bt = unitBalance && unitBalance[unit.itemId]
            ? unitBalance[unit.itemId].buildTime
            : 60;
          endTime = startTime + bt * 1000;
        } else if (unit.spawnTime && unit.trainedTime && unit.trainedTime > unit.spawnTime) {
          startTime = unit.spawnTime;
          endTime = unit.trainedTime;
        }

        if (startTime == null || endTime == null) continue;

        const progress = Math.min(1, (gameTime - startTime) / (endTime - startTime));
        // Cache fill element reference on the DOM node
        if (!el._fillEl) el._fillEl = el.querySelector('.up-prod-fill');
        const fill = el._fillEl;
        if (fill) {
          const pct = Math.round(progress * 100);
          if (fill._lastPct !== pct) {
            fill.style.width = pct + '%';
            fill._lastPct = pct;
          }
        }

        // Completion flash
        if (progress >= 1 && !this._completedItems.has(uuid)) {
          this._completedItems.add(uuid);
          el.classList.add('up-prod-complete');
          el.addEventListener('animationend', () => {
            el.classList.remove('up-prod-complete');
          }, { once: true });
        }
      }
    });
  }

  // Lay out ability icons in rows of `perRow` icons each
  _appendAbilityRows (container, icons, perRow) {
    let row = null;
    icons.forEach((icon, i) => {
      if (i % perRow === 0) {
        row = document.createElement('div');
        row.className = 'up-abilities-row';
        container.appendChild(row);
      }
      row.appendChild(icon);
    });
  }

  _unitsKey (units) {
    const heroPart = units.heroes.map(h => `${h.itemId}:${h.level}`).join(',');
    const groupPart = units.groups.map(g => `${g.itemId}:${g.count}`).join(',');
    return `${heroPart}|${groupPart}`;
  }

  destroy () {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    this._playerEls = [];
    this._lastState.clear();
    this._completedItems.clear();
    this._lastUpdateGameTime = -1;
  }

  /**
   * Show camera mode indicator on player panels.
   * @param {number|null} playerId — which player to highlight (null = all or none)
   * @param {string|null} mode — 'follow', 'auto', or null to clear
   */
  setCameraHighlight (playerId, mode) {
    if (!this._playerEls) return;
    this._playerEls.forEach((el, idx) => {
      const root = el.root;
      root.classList.remove('up-camera-follow', 'up-camera-auto');
      if (mode === 'auto') {
        root.classList.add('up-camera-auto');
      } else if (mode === 'follow' && idx === playerId) {
        root.classList.add('up-camera-follow');
      }
    });
  }
};

window.UnitsProductionPanel = UnitsProductionPanel;
