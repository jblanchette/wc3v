const MatchHeader = class {
  constructor (viewer) {
    this.viewer = viewer;
    this.boData = new BuildOrderData();
    this.el = document.getElementById('match-header');
  }

  render () {
    if (!this.el) return;

    this.renderMapInfo();
    this.renderMatchup();
    this.renderViewerControls();

    this.el.style.display = '';
  }

  cleanMapName (raw) {
    return raw
      .replace(/\.w3[xm]$/i, '')           // strip extension
      .replace(/_/g, ' ')                    // underscores to spaces
      .replace(/[-\s]v\d+[-.]?\d*/gi, '')    // strip version suffixes like -v2-0, v1.3
      .replace(/\s+\d+$/, '')                // strip trailing numbers
      .replace(/([a-z])([A-Z])/g, '$1 $2')  // camelCase to spaces
      .trim();
  }

  renderMapInfo () {
    const nameEl = this.el.querySelector('.mh-map-name');
    const raw = (this.viewer.mapInfo && this.viewer.mapInfo.name) || this.viewer.mapName || '';
    nameEl.textContent = this.cleanMapName(raw);

  }

  renderMatchup () {
    const { buildOrderPlayers } = this.viewer;
    if (!buildOrderPlayers || buildOrderPlayers.length < 2) return;

    const leftEl = this.el.querySelector('.mh-player-left');
    const rightEl = this.el.querySelector('.mh-player-right');

    const leftData = this.boData.processBuildOrderData(buildOrderPlayers[0]);
    const rightData = this.boData.processBuildOrderData(buildOrderPlayers[1]);

    leftEl.innerHTML = this.renderPlayerCard(leftData, buildOrderPlayers[0]);
    rightEl.innerHTML = this.renderPlayerCard(rightData, buildOrderPlayers[1]);
  }

  _sectionToggle (uid, sectionKey, label, extraToggleClass) {
    const toggleId = `mh-${sectionKey}-toggle-${uid}`;
    const contentId = `mh-${sectionKey}-content-${uid}`;
    const cls = `mh-section-toggle ${extraToggleClass || ''}`.trim();
    const toggle = `<div class="${cls}" id="${toggleId}" onclick="document.getElementById('${contentId}').classList.toggle('mh-hidden');this.classList.toggle('mh-open')">${label}</div>`;
    const contentOpen = `<div class="mh-section-content mh-hidden" id="${contentId}">`;
    return { toggle, contentOpen, contentClose: '</div>' };
  }

  renderPlayerCard (boData, player) {
    const { race, raceInfo, displayName, playerColor, tierProduction, tier2Time, tier3Time, hasExpansion, finalSnapshot } = boData;
    const uid = displayName.replace(/\W/g, '');

    // Build name from build context (if this player's slot has a matching build)
    let buildNameHtml = '';
    const ctxBySlot = this.viewer.buildContextBySlot;
    if (ctxBySlot && player) {
      const ctx = ctxBySlot[String(player.playerId)];
      if (ctx) {
        buildNameHtml = `<div class="mh-build-name">${ctx.name}</div>`;
      }
    }

    const raceIconId = BuildOrderData.CONFIG.raceStarterIcons[race] || '';
    let html = `<div class="mh-player-header">
      <div class="mh-player-header-text">
        <div class="mh-player-name" style="color:${playerColor}">${displayName}</div>${buildNameHtml}
      </div>
      <img class="mh-race-icon-lg" src="/assets/wc3icons/${raceIconId}.jpg" title="${raceInfo.label}" style="border-color:${raceInfo.accent}" />
    </div>`;

    // Expand / Collapse all sections button
    html += `<div class="mh-expand-all" onclick="(function(btn){var card=btn.closest('.mh-player');var cs=card.querySelectorAll('.mh-section-content');var ts=card.querySelectorAll('.mh-section-toggle:not(.mh-expand-all)');var allOpen=[].every.call(cs,function(c){return !c.classList.contains('mh-hidden')});cs.forEach(function(c){allOpen?c.classList.add('mh-hidden'):c.classList.remove('mh-hidden')});ts.forEach(function(t){allOpen?t.classList.remove('mh-open'):t.classList.add('mh-open')});btn.textContent=allOpen?'Show All':'Hide All'})(this)">Show All</div>`;

    // 1. HERO SUMMARY — collapsible
    const { heroes } = tierProduction;
    if (heroes && heroes.length) {
      const sec = this._sectionToggle(uid, 'hero', 'Hero Summary', 'mh-hero-toggle');
      html += sec.toggle + sec.contentOpen;

      let heroHtml = '';
      heroes.forEach(hero => {
        let spellsHtml = '';
        if (hero.spellList && hero.spellList.length) {
          hero.spellList.forEach(spell => {
            const learned = hero.learnedSkills && hero.learnedSkills[spell.itemId];
            if (!learned || learned.level === 0) return;
            spellsHtml += `<span class="mh-spell" title="${spell.displayName} Lv${learned.level}">
              <img class="mh-spell-icon" src="/assets/wc3icons/${spell.itemId}.jpg" /><span class="mh-spell-level">${learned.level}</span></span>`;
          });
        }

        heroHtml += `<div class="mh-hero">
          <div class="mh-hero-portrait-wrap">
            <img class="mh-hero-portrait" src="/assets/wc3icons/${hero.itemId}.jpg" title="${hero.displayName}" />
            <span class="mh-hero-level">${hero.level}</span>
          </div>
          <div class="mh-hero-spells">${spellsHtml}</div>
        </div>`;
      });
      html += `<div class="mh-heroes">${heroHtml}</div>`;

      html += sec.contentClose;
    }

    // 2. UPGRADE SUMMARY — collapsible
    {
      const sec = this._sectionToggle(uid, 'upgrade', 'Upgrade Summary', 'mh-upgrade-toggle');
      html += sec.toggle + sec.contentOpen;

      // Status row: expansion marker + max tier badge
      const maxTier = tier3Time !== Infinity ? 3 : tier2Time !== Infinity ? 2 : 1;
      const expoHtml = hasExpansion
        ? `<div class="mh-expansion-marker mh-expanded" title="Expanded">\u2714 Expo</div>`
        : `<div class="mh-expansion-marker mh-no-expo" title="No expansion">\u2718 No Expo</div>`;
      html += `<div class="mh-status-row">${expoHtml}<span class="mh-tier-max t${maxTier}">T${maxTier}</span></div>`;

      // Upgrades row + atk/def types row
      if (finalSnapshot) {
        let upgLine = '';
        const upgrades = finalSnapshot.upgrades;
        const hasAtk = upgrades && Object.keys(upgrades.attack).length > 0;
        const hasDef = upgrades && Object.keys(upgrades.defense).length > 0;
        const hasRes = upgrades && upgrades.researched.length > 0;
        if (hasAtk || hasDef || hasRes) {
          Object.values(upgrades.attack).forEach(upg => {
            const iconSrc = upg.icon ? `/assets/wc3icons/${upg.icon}.jpg` : '';
            upgLine += `<span class="mh-info-badge atk" title="${upg.displayName} ${upg.level}"><img class="mh-info-icon" src="${iconSrc}" onerror="this.style.display='none'" /><span class="mh-upgrade-level">${upg.level}</span></span>`;
          });
          Object.values(upgrades.defense).forEach(upg => {
            const iconSrc = upg.icon ? `/assets/wc3icons/${upg.icon}.jpg` : '';
            upgLine += `<span class="mh-info-badge def" title="${upg.displayName} ${upg.level}"><img class="mh-info-icon" src="${iconSrc}" onerror="this.style.display='none'" /><span class="mh-upgrade-level">${upg.level}</span></span>`;
          });
          upgrades.researched.forEach(r => {
            const iconSrc = r.icon ? `/assets/wc3icons/${r.icon}.jpg` : `/assets/wc3icons/${r.itemId}.jpg`;
            const lvl = r.level > 1 ? ` ${r.level}` : '';
            upgLine += `<span class="mh-info-upgrade"><img class="mh-info-icon" src="${iconSrc}" title="${r.displayName}${lvl}" onerror="this.style.display='none'" /></span>`;
          });
          html += `<div class="mh-info-row"><span class="mh-info-segment"><span class="mh-info-label">UPG</span>${upgLine}</span></div>`;
        }

        // Collect atk/def types from all tier units
        const atkSet = {};
        const defSet = {};
        const { tierProd } = tierProduction;
        [1, 2, 3].forEach(t => {
          if (tierProd[t] && tierProd[t].units) {
            tierProd[t].units.forEach(u => {
              if (u.attackType && ATTACK_TYPES[u.attackType]) atkSet[u.attackType] = 1;
              if (u.armorType && ARMOR_TYPES[u.armorType]) defSet[u.armorType] = 1;
            });
          }
        });

        let typeLine = '';
        const atkIcons = Object.keys(atkSet).map(k => `<img class="mh-info-icon" src="${ATTACK_TYPES[k].icon}" title="${ATTACK_TYPES[k].label} attack" />`).join('');
        if (atkIcons) typeLine += `<span class="mh-info-segment"><span class="mh-info-label">ATK</span>${atkIcons}</span>`;
        const defIcons = Object.keys(defSet).map(k => `<img class="mh-info-icon" src="${ARMOR_TYPES[k].icon}" title="${ARMOR_TYPES[k].label} armor" />`).join('');
        if (defIcons) typeLine += `<span class="mh-info-segment"><span class="mh-info-label">DEF</span>${defIcons}</span>`;
        if (typeLine) html += `<div class="mh-info-row">${typeLine}</div>`;
      }

      html += sec.contentClose;
    }

    // 3. UNIT SUMMARY — collapsible
    {
      const sec = this._sectionToggle(uid, 'unit', 'Unit Summary', 'mh-unit-toggle');
      html += sec.toggle + sec.contentOpen;
      html += '<div class="mh-unit-flat">';

      if (finalSnapshot && finalSnapshot.army && finalSnapshot.army.length) {
        finalSnapshot.army.forEach(u => {
          const countBadge = u.count > 1 ? `<span class="mh-unit-count">${u.count}</span>` : '';
          html += `<span class="mh-icon-wrap">
            <span class="mh-portrait-wrap"><img class="mh-tech-icon" src="/assets/wc3icons/${u.itemId}.jpg" title="${u.displayName}" />${countBadge}</span>
          </span>`;
        });
      } else {
        html += '<span class="mh-tier-empty">\u2014 No units</span>';
      }

      html += '</div>';
      html += sec.contentClose;
    }

    return html;
  }

  renderViewerControls () {
    const togglesEl = document.getElementById('mh-viewer-toggles');
    if (!togglesEl) return;

    const buttons = [
      { key: 'displayCreepRoute', label: 'Creep Routes', featured: true },
      { key: 'displayPath', label: 'Hero Paths' },
      { key: 'displayLevelPins', label: 'Level Pins' },
      { key: 'displayFloatingText', label: 'Action Text' },
      { key: 'displayText', label: 'Unit Names' },
      { key: 'decayEffects', label: 'Fade FX' },
      { key: 'displayTreeGrid', label: 'Tree Grid' }
    ];

    togglesEl.innerHTML = '';

    buttons.forEach(btn => {
      const el = document.createElement('div');
      el.classList.add('vc-btn');
      if (btn.featured) el.classList.add('vc-featured');
      el.id = `viewer-option-${btn.key}`;
      el.textContent = btn.label;
      el.addEventListener('click', () => wc3v.toggleViewOption(btn.key));

      if (this.viewer.viewOptions && this.viewer.viewOptions[btn.key]) {
        el.classList.add('on');
      }

      togglesEl.append(el);
    });
  }

  updateLayoutMode (mode) {
    if (!this.el) return;
    const toolbar = this.el.querySelector('.mh-toolbar');
    if (toolbar) {
      toolbar.style.display = (mode === LayoutMode.staticBuildOrder) ? 'none' : '';
    }
  }
};

window.MatchHeader = MatchHeader;
