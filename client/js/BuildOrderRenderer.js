const BuildOrderRenderer = class {
  constructor (viewer) {
    this.viewer = viewer;
    this.boData = new BuildOrderData();
    this.liveBoEventElements = [];
    this.currentLiveBoEvent = null;
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

  renderHeaderHeroes (tierProduction) {
    const row = document.createElement('div');
    row.classList.add('bo-hdr-heroes');

    const { heroes } = tierProduction;
    if (!heroes || !heroes.length) return row;

    heroes.forEach(hero => {
      const shortName = hero.displayName.length > 8
        ? hero.displayName.substring(0, 7) + '\u2026'
        : hero.displayName;

      const heroEl = document.createElement('span');
      heroEl.classList.add('bo-hdr-hero');
      if (hero.isTavern) heroEl.classList.add('tavern');
      heroEl.innerHTML = `
        <img class="bo-hdr-hero-portrait" src="/assets/wc3icons/${hero.itemId}.jpg" title="${hero.displayName}" />
        <span class="bo-hdr-hero-level">${hero.level}</span>
        <span class="bo-hdr-hero-name" title="${hero.displayName}">${shortName}</span>`;
      row.append(heroEl);
    });

    return row;
  }

  renderHeaderTierProduction (tierProduction, tier2Time, tier3Time) {
    const container = document.createElement('div');
    container.classList.add('bo-hdr-tiers');

    const { tierProd } = tierProduction;

    [1, 2, 3].forEach(tierNum => {
      if (tierNum === 2 && tier2Time === Infinity) return;
      if (tierNum === 3 && tier3Time === Infinity) return;

      const data = tierProd[tierNum];
      const row = document.createElement('div');
      row.classList.add('bo-hdr-tier-row');

      const hasContent = data.buildings.length > 0 || data.units.length > 0;
      if (!hasContent) row.classList.add('empty');

      let labelHtml = `<span class="bo-hdr-tier-label t${tierNum}">T${tierNum}</span>`;

      let buildingsHtml = '<span class="bo-hdr-tier-buildings">';
      data.buildings.forEach(b => {
        buildingsHtml += `<img src="/assets/wc3icons/${b.itemId}.jpg" title="${b.displayName}" />`;
      });
      buildingsHtml += '</span>';

      const sepHtml = (data.buildings.length && data.units.length)
        ? '<span class="bo-hdr-tier-sep"></span>'
        : '';

      let unitsHtml = '<span class="bo-hdr-tier-units">';
      data.units.forEach(u => {
        const countStr = u.count > 1
          ? `<span class="bo-hdr-unit-count">\u00d7${u.count}</span>`
          : '';
        unitsHtml += `<span class="bo-hdr-unit-entry">
          <img class="bo-hdr-unit-icon" src="/assets/wc3icons/${u.itemId}.jpg" title="${u.displayName}" />${countStr}
        </span>`;
      });
      unitsHtml += '</span>';

      row.innerHTML = `${labelHtml}${buildingsHtml}${sepHtml}${unitsHtml}`;
      container.append(row);
    });

    return container;
  }

  renderHeaderEconomy (finalSnapshot) {
    const bar = document.createElement('div');
    bar.classList.add('bo-hdr-economy');

    if (!finalSnapshot) return bar;

    const { workers, supply, economy } = finalSnapshot;
    const cappedGold = Math.min(5, workers.onGold);

    bar.innerHTML = `
      <span class="bo-hdr-econ-workers">
        <span class="bo-assign-gold">${cappedGold}G</span>
        <span class="bo-assign-lumber">${workers.onLumber}L</span>
        <span class="bo-assign-build">${workers.onBuild}B</span>
      </span>
      <span class="bo-hdr-econ-supply">${supply.used}/${supply.max}</span>
      <span class="bo-hdr-econ-spent">
        <span class="bo-cost-dot gold-dot"></span><span class="bo-gold">${economy.goldSpent}</span>
        <span class="bo-cost-dot lumber-dot"></span><span class="bo-lumber">${economy.lumberSpent}</span>
      </span>`;
    return bar;
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

    // responsive class
    const wrapper = document.getElementById('build-wrapper');
    const wrapperWidth = wrapper ? wrapper.offsetWidth : 800;
    if (wrapper) {
      wrapper.classList.remove('bo-wide', 'bo-medium', 'bo-narrow');
      if (wrapperWidth > 600) wrapper.classList.add('bo-wide');
      else if (wrapperWidth > 400) wrapper.classList.add('bo-medium');
      else wrapper.classList.add('bo-narrow');
    }

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
      heroTraining: (event, pc) => this.renderHeroTrainingCard(event, pc),
      heroLevel:    (event, pc) => this.renderHeroLevelCard(event, pc)
    };

    buildOrderPlayers.forEach(player => {
      const boData = this.boData.processBuildOrderData(player);
      const { race, raceInfo, displayName, playerColor, tiers, snapshots, finalSnapshot, tierProduction, tier2Time, tier3Time } = boData;
      const liveMode = this.viewer.layoutMode === LayoutMode.liveBuildOrder;

      const column = document.createElement('div');
      column.classList.add('bo-column');
      column.style.setProperty('--player-color', playerColor);
      this.applyRaceTheme(column, race);

      // --- Player Header (collapsible: toggle bar + expandable body) ---
      const header = document.createElement('div');
      header.classList.add('bo-player-header');

      // Determine max tier reached
      const maxTier = tier3Time !== Infinity ? 3 : (tier2Time !== Infinity ? 2 : 1);

      // Toggle bar — always visible, shows name + tier + race + economy summary
      const toggleBar = document.createElement('div');
      toggleBar.classList.add('bo-hdr-toggle');

      const econSummary = this.renderHeaderEconomy(finalSnapshot);

      toggleBar.innerHTML = `
        <span class="bo-hdr-chevron"></span>
        <span class="bo-hdr-player-name" style="color:${playerColor}">${displayName}</span>
        <span class="bo-hdr-tier-badge t${maxTier}">T${maxTier}</span>
        <span class="bo-hdr-race-badge">${raceInfo.label}</span>`;
      toggleBar.append(econSummary);

      toggleBar.addEventListener('click', () => {
        header.classList.toggle('collapsed');
      });
      header.append(toggleBar);

      // Expandable body — hidden when collapsed
      const body = document.createElement('div');
      body.classList.add('bo-hdr-body');

      const main = document.createElement('div');
      main.classList.add('bo-hdr-main');

      main.append(this.renderHeaderHeroes(tierProduction));

      const right = document.createElement('div');
      right.classList.add('bo-hdr-right');
      right.append(this.renderHeaderTierProduction(tierProduction, tier2Time, tier3Time));
      main.append(right);

      body.append(main);
      header.append(body);

      column.append(header);

      // --- Column header (sticky icon labels) ---
      const colHeader = document.createElement('div');
      colHeader.classList.add('bo-col-header');
      colHeader.innerHTML = `
        <span class="bo-col-h-time">TIME</span>
        <span class="bo-col-h-desc">ACTION</span>
        <span class="bo-col-h-workers" title="Workers on gold / lumber">
          <img class="bo-col-h-icon" src="/assets/wc3icons/gold.jpg" alt="Gold" />
          <span class="bo-col-h-sep">/</span>
          <img class="bo-col-h-icon" src="/assets/wc3icons/lmbr.jpg" alt="Lumber" />
        </span>
        <span class="bo-col-h-cost" title="Gold / Lumber cost">
          <img class="bo-col-h-icon" src="/assets/wc3icons/gold.jpg" alt="Gold" />
          <img class="bo-col-h-icon" src="/assets/wc3icons/lmbr.jpg" alt="Lumber" />
        </span>
        <span class="bo-col-h-supply" title="Food supply (used / max)">SUPPLY</span>`;
      column.append(colHeader);

      // --- Tier Sections ---
      let prevWorkers = { onGold: -1, onLumber: -1 };
      let prevSupply = { used: -1, max: -1 };
      let lastArmySummary = null;

      [1, 2, 3].forEach(tierNum => {
        const tierData = tiers[tierNum];
        if (!tierData.events.length && tierNum > 1) return;

        const tierSection = document.createElement('div');
        tierSection.classList.add('bo-tier-section', `tier-${tierNum}`);

        // Skip TIER 1 header — everyone starts at tier 1, it's not useful
        if (tierNum > 1) {
          tierSection.append(this.renderTierHeader(tierNum, tierData));
        }

        // Tier upgrade bar (for tier 2/3)
        if (tierNum > 1) {
          const upgradeEvent = tierData.events.find(e => e.type === 'tierUpgrade');
          if (upgradeEvent) {
            const bar = this.renderUpgradeBar(upgradeEvent);
            bar.dataset.gametime = upgradeEvent.gameTime;
            if (liveMode) bar.addEventListener('click', () => this.viewer.seekToGameTime(upgradeEvent.gameTime));
            tierSection.append(bar);
          }
        }

        // Events — dispatched by type
        tierData.events.forEach(event => {
          if (event.type === 'tierUpgrade') return;

          const isCard = event.type === 'heroLevel' || event.type === 'heroTraining';

          // Worker dot data from event's snapshot (available on all event types)
          // Include ghoulsOnLumber in the lumber count (UD ghouls tracked separately)
          const workerDots = {
            onGold: event.workersOnGold || 0,
            onLumber: (event.workersOnLumber || 0) + (event.ghoulsOnLumber || 0),
            onBuild: event.workersBuilding || 0
          };

          const supply = { used: event.supplyUsed || 0, max: event.supplyMax || 0 };

          let el;
          if (event.type === 'workerAssign' || event.type === 'building' || event.type === 'unit' || event.type === 'supplyComplete' || event.type === 'heroComplete') {
            el = this.renderBoRow(event, race, workerDots, prevWorkers, supply, prevSupply, tierNum);
          } else {
            const renderer = renderers[event.type];
            if (!renderer) return;
            el = renderer(event, isCard ? playerColor : race);
          }
          // Update prev state so next row can detect changes
          prevWorkers = { onGold: workerDots.onGold, onLumber: workerDots.onLumber };
          prevSupply = { used: supply.used, max: supply.max };
          el.dataset.gametime = event.gameTime;
          if (liveMode) el.addEventListener('click', () => this.viewer.seekToGameTime(event.gameTime));

          tierSection.append(el);
        });

        // Army summary at tier end
        const snap = snapshots[tierNum + 1] || (tierNum === 3 ? finalSnapshot : null);
        if (snap) {
          const summary = this.renderArmySummary(snap);
          tierSection.append(summary);
          lastArmySummary = summary;
        }

        column.append(tierSection);
      });

      if (lastArmySummary) lastArmySummary.classList.add('sticky');

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

  // --- Upgrade bar (tier 2/3 transition) ---
  renderUpgradeBar (event) {
    const bar = document.createElement('div');
    bar.classList.add('bo-upgrade-bar', `tier-${event.tierTarget}`);
    const costStr = this.buildInlineCost(event);

    bar.innerHTML = `
      <img class="bo-upgrade-icon" src="/assets/wc3icons/${event.itemId}.jpg" />
      UPGRADE TO TIER ${event.tierTarget} ${costStr}`;
    return bar;
  }

  // --- Combined hero training card (portrait + badge + costs + first skill, shown at click-time) ---
  renderHeroTrainingCard (event, playerColor) {
    const card = document.createElement('div');
    card.classList.add('bo-hero-training-card');
    card.style.borderLeftColor = playerColor;

    const timeStr = formatGameTime(event.gameTime);
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
      <span class="bo-hero-card-badge ${badgeClass}" ${badgeBg}>${badgeText}</span>
      <img class="bo-hero-portrait" src="/assets/wc3icons/${event.itemId}.jpg"
        style="border-color:${playerColor}" />
      <div class="bo-hero-card-info">
        <span class="bo-hero-card-name">${event.displayName}</span>
        <span class="bo-hero-card-time">${timeStr}</span>
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

    const timeStr = formatGameTime(event.gameTime);

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
      </div>
      <span class="bo-level-time">${timeStr}</span>`;
    return card;
  }

  // --- Standard build order row (5-column grid: time | desc | workers | cost | supply) ---
  renderBoRow (event, race, workerDots, prevWorkers, supply, prevSupply, tierNum) {
    const cfg = BuildOrderData.CONFIG;
    const { type, itemId, gameTime } = event;
    const timeStr = formatGameTime(gameTime);
    const count = event.count || 1;

    const row = document.createElement('div');
    row.classList.add('bo-row');

    const timeCellHtml = `<div class="bo-row-time">${timeStr}</div>`;

    // Supply column
    const sUsed = supply ? supply.used : 0;
    const sMax = supply ? supply.max : 0;
    const supplyChanged = !prevSupply || prevSupply.used !== sUsed || prevSupply.max !== sMax;
    const supplyCls = supplyChanged ? '' : ' bo-supply-unchanged';
    const supplyHtml = (sUsed || sMax)
      ? `<div class="bo-row-supply${supplyCls}" title="Food: ${sUsed} used / ${sMax} max">${sUsed}/${sMax}</div>`
      : `<div class="bo-row-supply"></div>`;

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

      if (event.isInitialWorkers) {
        const ghoulsLumber = event.ghoulsOnLumber || 0;
        const goldWorkers = event.totalWorkers - ghoulsLumber;
        const parts = [];
        if (goldWorkers > 0) {
          const plural = goldWorkers > 1 ? 's' : '';
          parts.push(`Send <span class="bo-assign-gold">${goldWorkers} ${workerName}${plural} to Gold</span>`);
        }
        if (ghoulsLumber > 0) {
          const plural = ghoulsLumber > 1 ? 's' : '';
          parts.push(`Send <span class="bo-assign-lumber">${ghoulsLumber} Ghoul${plural} to Lumber</span>`);
        }
        descText = parts.join(', ');
      } else {
        const targetLabel = cfg.assignLabels[event.assignTarget] || 'Gold';
        const targetClass = cfg.assignClasses[event.assignTarget] || 'assign-gold';
        const countPrefix = count > 1 ? `<span class="bo-unit-count">${count}x</span> ` : '';
        descText = `${countPrefix}Train ${event.displayName} -> <span class="${targetClass}">${targetLabel}</span>`;
      }
    } else if (type === 'building') {
      row.classList.add('building-row');
      if (event.isShop) row.classList.add('shop-row');
      if (event.isSupplyBuilding) row.classList.add('supply-row');
      const verb = cfg.verbs[type] || 'Build';
      descText = `${verb} ${event.displayName}`;

      // consumed worker annotation
      const consumed = event.consumedByBuildings || event.consumedWorkerCount || 0;
      if (consumed > 0) {
        const mechanic = event.buildMechanic;
        let annotation = '';
        if (mechanic === 'consumed_permanent') {
          annotation = 'wisp consumed';
        } else if (mechanic === 'consumed_temporary') {
          annotation = race === 'O' ? 'peon inside' : 'wisp building';
        } else if (mechanic === 'builder') {
          annotation = consumed === 1 ? '1 peasant' : `${consumed} peasants`;
        }
        if (annotation) {
          descText += ` <span class="bo-consumed-note">(${annotation})</span>`;
        }
      }
    } else {
      const verb = cfg.verbs[type] || 'Train';
      row.classList.add('unit-row');
      if (event.isShop) row.classList.add('shop-row');
      const countPrefix = count > 1 ? `<span class="bo-unit-count">${count}x</span> ` : '';
      descText = `${countPrefix}${verb} ${event.displayName}`;
    }

    // Worker economy column — compact numeric display (tier 1 only, too spammy after)
    let workersHtml = '';
    if (tierNum > 1 || !workerDots) {
      workersHtml = '<div class="bo-row-workers"></div>';
    } else {
      const gCount = Math.min(5, workerDots.onGold || 0);
      const lCount = workerDots.onLumber || 0;
      const bCount = workerDots.onBuild || 0;
      const title = `Workers: ${gCount} on gold, ${lCount} on lumber` +
        (bCount > 0 ? `, ${bCount} building` : '');

      if (gCount === 0 && lCount === 0) {
        workersHtml = `<div class="bo-row-workers bo-wk-empty" title="${title}"><span class="bo-wk-dim">&mdash;</span></div>`;
      } else {
        const unchanged = prevWorkers &&
          prevWorkers.onGold === gCount &&
          prevWorkers.onLumber === lCount;
        const cls = unchanged ? ' bo-wk-unchanged' : '';
        workersHtml = `<div class="bo-row-workers${cls}" title="${title}">` +
          `<span class="bo-wk-gold">${gCount}</span>` +
          `<span class="bo-wk-sep">/</span>` +
          `<span class="bo-wk-lumber">${lCount}</span></div>`;
      }
    }

    // Column order: time | desc | workers | cost | supply
    row.innerHTML = `${timeCellHtml}
      <div class="bo-row-desc">
        <img class="bo-row-icon" src="/assets/wc3icons/${itemId}.jpg" />
        <span class="bo-row-text">${descText}</span>
      </div>${workersHtml}${costHtml}${supplyHtml}`;
    return row;
  }

  // --- Army summary at tier end ---
  renderArmySummary (snapshot) {
    const { army, heroes, workers, supply, economy } = snapshot;
    const el = document.createElement('div');
    el.classList.add('bo-army-summary');

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

    // Workers + Supply + Economy section
    const supplyStr = supply ? `${supply.used}/${supply.max}` : '';
    const cappedGold = Math.min(5, workers.onGold);
    const econHtml = `<div class="bo-summary-section economy">
      <span class="bo-summary-label">WORKERS</span>
      <span class="bo-summary-workers">
        <span class="bo-assign-gold">${cappedGold}G</span>
        <span class="bo-assign-lumber">${workers.onLumber}L</span>
        <span class="bo-assign-build">${workers.onBuild}B</span>
      </span>
      <span class="bo-summary-supply">${supplyStr}</span>
      <span class="bo-summary-spent">
        <span class="bo-cost-dot gold-dot"></span><span class="bo-gold">${economy.goldSpent}</span>
        <span class="bo-cost-dot lumber-dot"></span><span class="bo-lumber">${economy.lumberSpent}</span>
      </span>
    </div>`;

    el.innerHTML = `${heroesHtml}${armyHtml}${econHtml}`;
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

      // Auto-scroll the build area to keep active row visible
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
