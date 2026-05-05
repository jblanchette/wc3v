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

      const toggleBar = document.createElement('div');
      toggleBar.classList.add('bo-hdr-toggle');
      toggleBar.innerHTML = `
        <span class="bo-hdr-player-name" style="color:${_attr(playerColor)}">${_esc(displayName)}${buildLabel}</span>
        <span class="bo-hdr-tier-badge t${Number(maxTier) || 1}">T${Number(maxTier) || 1}</span>
        <span class="bo-hdr-race-badge">${_esc(raceInfo.label)}</span>`;

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
      column.append(this.renderBoFilterBar());

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

      [1, 2, 3].forEach(tierNum => {
        const tierData = tiers[tierNum];
        if (!tierData.events.length && tierNum > 1) return;

        const tierSection = document.createElement('div');
        tierSection.classList.add('bo-tier-section', `tier-${tierNum}`);

        // Tier headers removed — tier transitions are shown via inline
        // tierUpgrade (start) and tierComplete (finish + summary) cards

        const boFilters = this.viewer.boFilters || {};

        // Events — dispatched by type
        tierData.events.forEach(event => {

          // Filter bar: skip events whose category is toggled off
          const filterCat = BO_EVENT_TYPE_TO_CATEGORY[event.type];
          if (filterCat && boFilters[filterCat] === false) return;

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
        if (tierNum === 3 && finalSnapshot && boFilters.summaries !== false) {
          const summary = this.renderArmySummary(finalSnapshot, 'Final Composition');
          tierSection.append(summary);
          lastArmySummary = summary;
        }

        column.append(tierSection);
      });

      if (lastArmySummary) lastArmySummary.classList.add('sticky');

      // Final economy summary card
      if (finalSnapshot && this.viewer.boFilters?.summaries !== false) {
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
    const badgeText = event.isTavern ? 'TAVERN' : `HERO Lv ${heroLevel}`;
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
      <div class="bo-hero-card-left">
        <span class="bo-hero-card-badge ${badgeClass}" ${badgeBg}>${badgeText}</span>
        ${costHtml}
      </div>
      <img class="bo-hero-portrait" src="/assets/wc3icons/${_icon(event.itemId)}.jpg"
        style="border-color:${_attr(playerColor)}" />
      <div class="bo-hero-card-info">
        <span class="bo-hero-card-name">${_esc(event.displayName)}</span>
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
        if (atkInfo) typeIcons += `<img class="bo-row-type-icon" src="${_attr(atkInfo.icon)}" title="${_attr(atkInfo.label)} attack" />`;
        if (defInfo) typeIcons += `<img class="bo-row-type-icon" src="${_attr(defInfo.icon)}" title="${_attr(defInfo.label)} armor" />`;
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
