const BuildOrderRenderer = class {
  constructor (viewer) {
    this.viewer = viewer;
    this.boData = new BuildOrderData();
    this.liveBoEventElements = [];
    this.currentLiveBoEvent = null;
    this._responsiveObserver = null;
    this._responsiveTimeout = null;
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

    this.renderBuildOrder();
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
    const { buildOrderPlayers } = this.viewer;

    const columnsEl = document.getElementById('bo-columns');
    const emptyEl = document.getElementById('bo-empty');
    if (!columnsEl || !emptyEl) return;

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

    if (buildOrderPlayers.length === 1) {
      columnsEl.classList.add('bo-single');
      if (timelineGap) timelineGap.style.display = 'none';
    } else {
      columnsEl.classList.remove('bo-single');
      if (timelineGap) timelineGap.style.display = '';
    }

    // Build team-to-side mapping: first team seen -> left, rest -> right
    // For FFA (all unique teams), split evenly
    const teamSideMap = {};
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

    const cfg = BuildOrderData.CONFIG;

    // Render dispatcher — maps event type to render function
    // Note: workerAssign, building, and unit are handled explicitly in the event loop below
    const renderers = {
      heroTraining:  (event, pc) => this.renderHeroTrainingCard(event, pc),
      heroLevel:     (event, pc) => this.renderHeroLevelCard(event, pc),
      tierUpgrade:   (event)     => this.renderTierUpgradeCard(event),
      expansion:     (event)     => this.renderExpansionCard(event),
      attackUpgrade: (event)     => this.renderUpgradeCard(event),
      defenseUpgrade:(event)     => this.renderUpgradeCard(event),
      research:      (event)     => this.renderResearchCard(event)
    };

    buildOrderPlayers.forEach(player => {
      const boData = this.boData.processBuildOrderData(player);
      const { race, raceInfo, displayName, playerColor, tiers, snapshots, finalSnapshot, tierProduction, tier2Time, tier3Time } = boData;
      const liveMode = this.viewer.layoutMode === LayoutMode.liveBuildOrder;

      const column = document.createElement('div');
      column.classList.add('bo-column');
      column.style.setProperty('--player-color', playerColor);
      this.applyRaceTheme(column, race);

      // --- Player Header (name + build name + tier + race) ---
      const header = document.createElement('div');
      header.classList.add('bo-player-header');

      const maxTier = tier3Time !== Infinity ? 3 : (tier2Time !== Infinity ? 2 : 1);

      // Look up build name for this player by their playerId
      const bcSlots = this.viewer.buildContextBySlot || {};
      const bc = bcSlots[String(player.playerId)];
      const buildLabel = bc ? `<span class="bo-hdr-build-name">\u2014 ${bc.name}</span>` : '';

      if (bc && bc.selected) {
        header.classList.add('bo-hdr-selected');
      }

      const toggleBar = document.createElement('div');
      toggleBar.classList.add('bo-hdr-toggle');
      toggleBar.innerHTML = `
        <span class="bo-hdr-player-name" style="color:${playerColor}">${displayName}${buildLabel}</span>
        <span class="bo-hdr-tier-badge t${maxTier}">T${maxTier}</span>
        <span class="bo-hdr-race-badge">${raceInfo.label}</span>`;
      header.append(toggleBar);

      column.append(header);

      // --- Column header (sticky icon labels) ---
      const colHeader = document.createElement('div');
      colHeader.classList.add('bo-col-header');
      colHeader.innerHTML = `
        <span class="bo-col-h-desc">ACTION</span>
        <span class="bo-col-h-cost" title="Gold / Lumber cost">
          <img class="bo-col-h-icon" src="/assets/wc3icons/gold.jpg" alt="Gold" />
          <img class="bo-col-h-icon" src="/assets/wc3icons/lmbr.jpg" alt="Lumber" />
        </span>
        <span class="bo-col-h-supply" title="Food supply (used / max)">SUPPLY</span>`;
      column.append(colHeader);

      // --- Tier Sections ---
      let lastArmySummary = null;

      const seenUnitTypes = {};

      [1, 2, 3].forEach(tierNum => {
        const tierData = tiers[tierNum];
        if (!tierData.events.length && tierNum > 1) return;

        const tierSection = document.createElement('div');
        tierSection.classList.add('bo-tier-section', `tier-${tierNum}`);

        // Tier headers removed — tier transitions are shown via inline
        // tierUpgrade (start) and tierComplete (finish + summary) cards

        // Events — dispatched by type
        tierData.events.forEach(event => {

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
        });

        // Final composition summary at end of tier 3 only
        // (tier 1/2 summaries are now shown inline via tierComplete events)
        if (tierNum === 3 && finalSnapshot) {
          const summary = this.renderArmySummary(finalSnapshot, 'Final Composition');
          tierSection.append(summary);
          lastArmySummary = summary;
        }

        column.append(tierSection);
      });

      if (lastArmySummary) lastArmySummary.classList.add('sticky');

      // Final economy summary card
      if (finalSnapshot) {
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
    card.classList.add('bo-row', 'bo-tier-upgrade-card', `tier-${event.tierTarget}`);

    const gold = event.goldCost || 0;
    const lumber = event.lumberCost || 0;
    const gLine = gold ? `<span class="bo-cost-gold">${gold}</span>` : '';
    const lLine = lumber ? `<span class="bo-cost-lumber">${lumber}</span>` : '';
    const costHtml = `<div class="bo-row-cost">${gLine}${lLine}</div>`;

    card.innerHTML = `
      <div class="bo-row-desc">
        <img class="bo-row-icon" src="/assets/wc3icons/${event.itemId}.jpg" />
        <span class="bo-row-text">Upgrade to Tier ${event.tierTarget} started</span>
      </div>${costHtml}`;
    return card;
  }

  // --- Tier complete card (upgrade finished, now on new tier) ---
  renderTierCompleteCard (event, snapshot) {
    const card = document.createElement('div');
    card.classList.add('bo-tier-complete-card', `tier-${event.tierTarget}`);
    const timeStr = formatGameTime(event.gameTime);

    card.innerHTML = `
      <div class="bo-tier-complete-header">
        <img class="bo-tier-complete-icon" src="/assets/wc3icons/${event.itemId}.jpg" />
        <span class="bo-tier-complete-label">TIER ${event.tierTarget} COMPLETE</span>
        <span class="bo-tier-complete-time">${timeStr}</span>
      </div>`;

    // Append army summary snapshot if available
    if (snapshot) {
      const summary = this.renderArmySummary(snapshot, `Tier ${event.tierTarget} Summary`);
      card.append(summary);
    }

    return card;
  }

  // --- Expansion Made bar (second town hall / haunt placed at a new gold mine) ---
  renderExpansionCard (event) {
    const bar = document.createElement('div');
    bar.classList.add('bo-expansion-bar');
    const costStr = this.buildInlineCost(event);
    bar.innerHTML = `
      <img class="bo-expansion-icon" src="/assets/wc3icons/${event.itemId}.jpg" />
      <span class="bo-expansion-label">EXPANSION MADE</span>
      ${costStr ? `<span class="bo-expansion-cost">${costStr}</span>` : ''}`;
    return bar;
  }

  // --- Attack/Defense upgrade bar ---
  renderUpgradeCard (event) {
    const bar = document.createElement('div');
    const isAttack = event.category === 'attack';
    bar.classList.add('bo-research-bar', isAttack ? 'bo-attack-upgrade' : 'bo-defense-upgrade');
    const iconSrc = event.icon ? `/assets/wc3icons/${event.icon}.jpg` : `/assets/wc3icons/${event.itemId}.jpg`;
    const label = isAttack ? 'ATK' : 'DEF';

    const gold = event.goldCost || 0;
    const lumber = event.lumberCost || 0;
    const gLine = gold ? `<span class="bo-cost-gold">${gold}</span>` : '';
    const lLine = lumber ? `<span class="bo-cost-lumber">${lumber}</span>` : '';
    const costHtml = `<div class="bo-row-cost">${gLine}${lLine}</div>`;

    bar.innerHTML = `
      <div class="bo-row-desc">
        <img class="bo-row-icon" src="${iconSrc}" onerror="this.style.display='none'" />
        <span class="bo-research-badge ${isAttack ? 'atk' : 'def'}">${label} ${event.level}</span>
        <span class="bo-research-name">${event.displayName}</span>
      </div>${costHtml}`;
    return bar;
  }

  // --- Research / ability upgrade card ---
  renderResearchCard (event) {
    const bar = document.createElement('div');
    bar.classList.add('bo-research-bar', 'bo-ability-research');
    const iconSrc = event.icon ? `/assets/wc3icons/${event.icon}.jpg` : `/assets/wc3icons/${event.itemId}.jpg`;
    const levelStr = event.level > 1 ? ` Lv${event.level}` : '';

    const gold = event.goldCost || 0;
    const lumber = event.lumberCost || 0;
    const gLine = gold ? `<span class="bo-cost-gold">${gold}</span>` : '';
    const lLine = lumber ? `<span class="bo-cost-lumber">${lumber}</span>` : '';
    const costHtml = `<div class="bo-row-cost">${gLine}${lLine}</div>`;

    bar.innerHTML = `
      <div class="bo-row-desc">
        <img class="bo-row-icon" src="${iconSrc}" onerror="this.style.display='none'" />
        <span class="bo-research-label">RESEARCH</span>
        <span class="bo-research-name">${event.displayName}${levelStr}</span>
      </div>${costHtml}`;
    return bar;
  }

  // --- Combined hero training card (portrait + badge + costs + first skill, shown at click-time) ---
  renderHeroTrainingCard (event, playerColor) {
    const card = document.createElement('div');
    card.classList.add('bo-hero-training-card');
    card.style.borderLeftColor = playerColor;

    const badgeText = event.isTavern ? 'TAVERN' : `HERO Lv ${event.level || 1}`;
    const badgeClass = event.isTavern ? 'tavern' : '';
    const badgeBg = event.isTavern ? '' : `style="background:${playerColor}"`;

    const gold = event.goldCost || 0;
    const lumber = event.lumberCost || 0;
    const goldHtml = gold ? `<span class="bo-row-gold"><span class="bo-cost-dot gold-dot"></span>${gold}</span>` : '';
    const lumberHtml = lumber ? `<span class="bo-row-lumber"><span class="bo-cost-dot lumber-dot"></span>${lumber}</span>` : '';
    const costHtml = (goldHtml || lumberHtml) ? `<div class="bo-training-costs">${goldHtml}${lumberHtml}</div>` : '';

    // First skill choice bar (folded from level 1 heroLevel event)
    let skillsHtml = '';
    if (event.firstSkillList && event.firstSkillList.length) {
      skillsHtml = '<div class="bo-training-skills">';
      event.firstSkillList.forEach(spellInfo => {
        const sid = spellInfo.itemId;
        const learned = event.firstLearnedSkills && event.firstLearnedSkills[sid];
        const isActive = sid === event.firstSkillItemId;
        const level = learned ? learned.level : 0;
        const name = learned ? learned.displayName : spellInfo.displayName;

        const classes = ['bo-skill', 'bo-skill-lg'];
        if (isActive) classes.push('active');
        if (learned) classes.push('learned');
        const dimClass = !learned ? 'dimmed' : '';
        const levelHidden = level === 0 ? ' hidden' : '';

        skillsHtml += `<span class="${classes.join(' ')}" title="${name}">
          <img class="bo-skill-icon ${dimClass}" src="/assets/wc3icons/${sid}.jpg" />
          <span class="bo-skill-level${levelHidden}">${level || ''}</span>
        </span>`;
      });
      skillsHtml += '</div>';
    } else if (event.firstSkillItemId) {
      const skillName = event.firstSkill ? (event.firstSkill.displayName || '') : '';
      skillsHtml = `<div class="bo-training-skills">
        <span class="bo-skill bo-skill-lg active" title="${skillName}">
          <img class="bo-skill-icon" src="/assets/wc3icons/${event.firstSkillItemId}.jpg" />
          <span class="bo-skill-level">1</span>
        </span>
      </div>`;
    }

    card.innerHTML = `
      <div class="bo-hero-card-left">
        <span class="bo-hero-card-badge ${badgeClass}" ${badgeBg}>${badgeText}</span>
        ${costHtml}
      </div>
      <img class="bo-hero-portrait" src="/assets/wc3icons/${event.itemId}.jpg"
        style="border-color:${playerColor}" />
      <div class="bo-hero-card-info">
        <span class="bo-hero-card-name">${event.displayName}</span>
        ${skillsHtml}
      </div>`;
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
        const sid = spellInfo.itemId;
        const learned = event.learnedSkills && event.learnedSkills[sid];
        const isActive = sid === event.spellItemId;
        const level = learned ? learned.level : 0;
        const name = learned ? learned.displayName : spellInfo.displayName;

        // Classes: active = just leveled this card, learned = has points, dimmed = untrained
        const classes = ['bo-skill'];
        if (isActive) classes.push('active');
        if (learned) classes.push('learned');
        const dimClass = !learned ? 'dimmed' : '';
        const levelHidden = level === 0 ? ' hidden' : '';

        skillsHtml += `<span class="${classes.join(' ')}" title="${name}">
          <img class="bo-skill-icon ${dimClass}" src="/assets/wc3icons/${sid}.jpg" />
          <span class="bo-skill-level${levelHidden}">${level || ''}</span>
        </span>`;
      });
    } else if (event.spell) {
      // Fallback if no spellList data (older replays)
      const name = event.spell.displayName || '??';
      skillsHtml = `<span class="bo-skill active" title="${name}">
        <span class="bo-skill-level">${event.spell.level || '?'}</span>
      </span>`;
    }

    card.innerHTML = `
      <img class="bo-level-portrait" src="/assets/wc3icons/${event.itemId}.jpg" />
      <div class="bo-level-info">
        <span class="bo-level-title">${event.displayName} -> Lv ${event.level}</span>
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
    const sUsed = supply ? supply.used : 0;
    const sMax = supply ? supply.max : 0;
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

    // Cost column (stacked gold / lumber)
    const gold = event.goldCost || 0;
    const lumber = event.lumberCost || 0;
    let costHtml;
    if (gold || lumber) {
      const gLine = gold ? `<span class="bo-cost-gold">${gold}</span>` : '';
      const lLine = lumber ? `<span class="bo-cost-lumber">${lumber}</span>` : '';
      costHtml = `<div class="bo-row-cost">${gLine}${lLine}</div>`;
    } else {
      costHtml = `<div class="bo-row-cost"></div>`;
    }

    let descText;

    if (type === 'heroComplete') {
      row.classList.add('hero-complete-row');
      descText = `<span class="bo-hero-complete-text">${event.displayName} Training Complete</span>`;
    } else if (type === 'supplyComplete') {
      row.classList.add('supply-complete-row');
      const foodStr = event.foodProvided ? `+${event.foodProvided}` : '';
      descText = `<span class="bo-supply-complete-text">${event.displayName} Complete</span>` +
        `<span class="bo-supply-badge">${foodStr} supply</span>`;
    } else if (type === 'workerAssign') {
      const assignClass = cfg.assignClasses[event.assignTarget] || 'assign-gold';
      row.classList.add('worker-row', assignClass);
      const workerName = cfg.workerNames[race] || 'Worker';

      const gCount = workerDots ? workerDots.onGold : 0;
      const lCount = workerDots ? workerDots.onLumber : 0;
      const wkInline = `<span class="bo-wk-inline"><span class="bo-wk-g">${gCount}G</span> / <span class="bo-wk-l">${lCount}L</span></span>`;

      if (event.isInitialWorkers) {
        const ghoulsLumber = event.ghoulsOnLumber || 0;
        const goldWorkers = event.totalWorkers - ghoulsLumber;
        const parts = [];
        if (goldWorkers > 0) {
          parts.push(`${goldWorkers} ${workerName} <span class="bo-assign-tag tag-gold">gold</span>`);
        }
        if (ghoulsLumber > 0) {
          parts.push(`${ghoulsLumber} Ghoul <span class="bo-assign-tag tag-lumber">lumber</span>`);
        }
        descText = parts.join(' ') + ` ${wkInline}`;
      } else {
        const tagClass = event.assignTarget === 'lumber' ? 'tag-lumber' : (event.assignTarget === 'build' ? 'tag-build' : 'tag-gold');
        const tagLabel = cfg.assignLabels[event.assignTarget] || 'Gold';
        const countPrefix = count > 1 ? `<span class="bo-unit-count">${count}x</span> ` : '';
        descText = `${countPrefix}${event.displayName} <span class="bo-assign-tag ${tagClass}">${tagLabel}</span> ${wkInline}`;
      }
    } else if (type === 'building') {
      row.classList.add('building-row');
      if (event.isShop) row.classList.add('shop-row');
      if (event.isSupplyBuilding) row.classList.add('supply-row');
      const verb = cfg.verbs[type] || 'Build';
      descText = `${verb} ${event.displayName}`;

    } else {
      const verb = cfg.verbs[type] || 'Train';
      row.classList.add('unit-row');
      if (event.isShop) row.classList.add('shop-row');
      const countPrefix = count > 1 ? `<span class="bo-unit-count">${count}x</span> ` : '';
      let typeIcons = '';
      if (seenUnitTypes && !seenUnitTypes[itemId]) {
        seenUnitTypes[itemId] = true;
        const atkInfo = ATTACK_TYPES[event.attackType];
        const defInfo = ARMOR_TYPES[event.armorType];
        if (atkInfo) typeIcons += `<img class="bo-row-type-icon" src="${atkInfo.icon}" title="${atkInfo.label} attack" />`;
        if (defInfo) typeIcons += `<img class="bo-row-type-icon" src="${defInfo.icon}" title="${defInfo.label} armor" />`;
      }
      descText = `${countPrefix}${verb} ${event.displayName}${typeIcons}`;
    }

    // Column order: desc | cost | supply
    row.innerHTML = `
      <div class="bo-row-desc">
        <img class="bo-row-icon" src="/assets/wc3icons/${itemId}.jpg" />
        <span class="bo-row-text">${descText}</span>
      </div>${costHtml}${supplyHtml}`;
    return row;
  }

  // --- Army summary at tier end ---
  renderArmySummary (snapshot, label) {
    const { army, heroes, workers, supply, economy } = snapshot;
    const el = document.createElement('div');
    el.classList.add('bo-army-summary');

    // Summary header
    const headerHtml = label
      ? `<div class="bo-summary-header">${label}</div>`
      : '';

    // Heroes section
    let heroesHtml = '';
    if (heroes && heroes.length) {
      let heroItems = '';
      heroes.forEach(h => {
        const statusClass = h.status === 'training' ? 'training' : 'alive';
        const label = h.status === 'training'
          ? 'Training...'
          : `Lv${h.level || 1}`;
        heroItems += `<span class="bo-summary-hero ${statusClass}">
          <img class="bo-summary-icon hero" src="/assets/wc3icons/${h.itemId}.jpg" title="${h.displayName}" />
          <span class="bo-summary-hero-label">${label}</span>
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
        const countStr = unit.count > 1 ? `<span class="bo-army-count">x${unit.count}</span>` : '';
        armyItems += `<span class="bo-summary-unit">
          <img class="bo-summary-icon" src="/assets/wc3icons/${unit.itemId}.jpg" title="${unit.displayName}" />${countStr}
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
        const iconSrc = upg.icon ? `/assets/wc3icons/${upg.icon}.jpg` : '';
        upgradeItems += `<span class="bo-summary-upgrade atk"><img class="bo-summary-icon" src="${iconSrc}" title="${upg.displayName} ${upg.level}" onerror="this.style.display='none'" /><span class="bo-upgrade-badge atk">${upg.level}</span></span>`;
      });
      Object.values(upgrades.defense).forEach(upg => {
        const iconSrc = upg.icon ? `/assets/wc3icons/${upg.icon}.jpg` : '';
        upgradeItems += `<span class="bo-summary-upgrade def"><img class="bo-summary-icon" src="${iconSrc}" title="${upg.displayName} ${upg.level}" onerror="this.style.display='none'" /><span class="bo-upgrade-badge def">${upg.level}</span></span>`;
      });
      upgrades.researched.forEach(r => {
        const iconSrc = r.icon ? `/assets/wc3icons/${r.icon}.jpg` : `/assets/wc3icons/${r.itemId}.jpg`;
        const lvl = r.level > 1 ? ` ${r.level}` : '';
        upgradeItems += `<span class="bo-summary-upgrade ability">
          <img class="bo-summary-icon" src="${iconSrc}" title="${r.displayName}" onerror="this.style.display='none'" /><span class="bo-upgrade-name">${r.displayName}${lvl}</span>
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

    const supplyStr = supply ? `${supply.used}/${supply.max}` : '';

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
            <span class="bo-cost-dot gold-dot"></span><span class="bo-gold">${economy.goldSpent}</span>
            <span class="bo-cost-dot lumber-dot"></span><span class="bo-lumber">${economy.lumberSpent}</span>
          </span>
        </span>
      </div>`;
    return el;
  }

  updateLiveBoHighlight () {
    if (this.viewer.layoutMode !== LayoutMode.liveBuildOrder) return;
    if (!this.liveBoEventElements.length) return;

    const { gameTime } = this.viewer;

    // Remove previous highlight
    if (this.currentLiveBoEvent) {
      this.currentLiveBoEvent.classList.remove('bo-live-active');
    }

    // Find the latest event at or before current gameTime
    let activeEl = null;
    for (let i = this.liveBoEventElements.length - 1; i >= 0; i--) {
      if (this.liveBoEventElements[i].gameTime <= gameTime) {
        activeEl = this.liveBoEventElements[i].el;
        break;
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
