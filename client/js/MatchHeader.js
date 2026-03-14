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
    const nameEl = document.getElementById('map-name-overlay');
    if (!nameEl) return;
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
    const ctxBySlot = this.viewer.buildContextBySlot;
    const ctx = (ctxBySlot && player) ? ctxBySlot[String(player.playerId)] : null;
    const buildLabel = (ctx && ctx.name) ? ctx.name : 'Off Meta';
    const buildNameHtml = `<div class="mh-build-name">${buildLabel}</div>`;

    const raceIconId = BuildOrderData.CONFIG.raceStarterIcons[race] || '';
    let html = `<div class="mh-player-header">
      <div class="mh-player-header-text">
        <div class="mh-player-name" style="color:${playerColor}">${displayName}</div>${buildNameHtml}
      </div>
      <img class="mh-race-icon-lg" src="/assets/wc3icons/${raceIconId}.jpg" title="${raceInfo.label}" style="border-color:${raceInfo.accent}" />
    </div>`;

    // Hero + Upgrade inline row (always visible)
    const { heroes } = tierProduction;
    html += '<div class="mh-hero-upgrades">';

    if (heroes && heroes.length) {
      html += '<div class="mh-heroes">';
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

        html += `<div class="mh-hero">
          <div class="mh-hero-portrait-wrap">
            <img class="mh-hero-portrait" src="/assets/wc3icons/${hero.itemId}.jpg" title="${hero.displayName}" />
            <span class="mh-hero-level">${hero.level}</span>
          </div>
          <div class="mh-hero-spells">${spellsHtml}</div>
        </div>`;
      });
      html += '</div>';
      html += '<div class="mh-hu-divider"></div>';
    }

    {
      html += '<div class="mh-upgrades-inline">';
      const maxTier = tier3Time !== Infinity ? 3 : tier2Time !== Infinity ? 2 : 1;
      const expoHtml = hasExpansion
        ? `<span class="mh-expansion-marker mh-expanded" title="Expanded">\u2714 Expo</span>`
        : `<span class="mh-expansion-marker mh-no-expo" title="No expansion">\u2718 No Expo</span>`;
      html += `<div class="mh-status-compact">${expoHtml}<span class="mh-tier-max t${maxTier}">T${maxTier}</span></div>`;

      if (finalSnapshot) {
        const upgrades = finalSnapshot.upgrades;
        const hasAtk = upgrades && Object.keys(upgrades.attack).length > 0;
        const hasDef = upgrades && Object.keys(upgrades.defense).length > 0;
        const hasRes = upgrades && upgrades.researched.length > 0;
        if (hasAtk || hasDef || hasRes) {
          let rowHtml = '';
          if (hasAtk) {
            let atkBadges = '';
            Object.values(upgrades.attack).forEach(upg => {
              const iconSrc = upg.icon ? `/assets/wc3icons/${upg.icon}.jpg` : '';
              atkBadges += `<span class="mh-info-badge atk" title="${upg.displayName} ${upg.level}"><img class="mh-info-icon" src="${iconSrc}" onerror="this.style.display='none'" /><span class="mh-upgrade-level">${upg.level}</span></span>`;
            });
            rowHtml += `<span class="mh-info-segment"><span class="mh-info-label">ATK</span>${atkBadges}</span>`;
          }
          if (hasDef) {
            let defBadges = '';
            Object.values(upgrades.defense).forEach(upg => {
              const iconSrc = upg.icon ? `/assets/wc3icons/${upg.icon}.jpg` : '';
              defBadges += `<span class="mh-info-badge def" title="${upg.displayName} ${upg.level}"><img class="mh-info-icon" src="${iconSrc}" onerror="this.style.display='none'" /><span class="mh-upgrade-level">${upg.level}</span></span>`;
            });
            rowHtml += `<span class="mh-info-segment"><span class="mh-info-label">DEF</span>${defBadges}</span>`;
          }
          if (hasRes) {
            let resBadges = '';
            upgrades.researched.forEach(r => {
              const iconSrc = r.icon ? `/assets/wc3icons/${r.icon}.jpg` : `/assets/wc3icons/${r.itemId}.jpg`;
              const lvl = r.level > 1 ? ` ${r.level}` : '';
              resBadges += `<span class="mh-info-upgrade"><img class="mh-info-icon" src="${iconSrc}" title="${r.displayName}${lvl}" onerror="this.style.display='none'" /></span>`;
            });
            rowHtml += `<span class="mh-info-segment"><span class="mh-info-label">RES</span>${resBadges}</span>`;
          }
          html += `<div class="mh-info-row">${rowHtml}</div>`;
        }

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
      html += '</div>';
    }

    html += '</div>';

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

  updateLayoutMode (mode) {
    // no-op — toolbar removed, map name overlay hidden via CSS in static-bo mode
  }
};

window.MatchHeader = MatchHeader;
