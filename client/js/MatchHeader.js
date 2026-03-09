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

    // Replay dropdown — insert into toolbar if build context has multiple replays
    const ctx = this.viewer.buildContext;
    if (ctx && ctx.allReplays && ctx.allReplays.length > 1) {
      const options = ctx.allReplays.map(r => {
        const label = `${r.map || 'Unknown Map'} — ${r.playerName}${r._dupLabel || ''}`;
        const url = `/viewer?r=${r.replayId}&buildId=${ctx.build.id}`;
        const selected = r.replayId === ctx.currentReplayId ? ' selected' : '';
        return `<option value="${url}"${selected}>${label}</option>`;
      }).join('');

      const mapInfo = this.el.querySelector('.mh-map-info');
      if (mapInfo) {
        const wrapper = document.createElement('div');
        wrapper.classList.add('mh-replay-select-wrap');
        wrapper.innerHTML = `
          <span class="mh-replay-label">Replays:</span>
          <select class="mh-replay-select" onchange="if(this.value) window.location.href=this.value">
            ${options}
          </select>`;
        mapInfo.appendChild(wrapper);
      }
    }
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

  renderPlayerCard (boData, player) {
    const { race, raceInfo, displayName, playerColor, tierProduction, tier2Time, tier3Time, hasExpansion, finalSnapshot } = boData;

    // Build name from build context (if this player's slot has a matching build)
    let buildNameHtml = '';
    const ctxBySlot = this.viewer.buildContextBySlot;
    if (ctxBySlot && player) {
      const ctx = ctxBySlot[String(player.playerId)];
      if (ctx) {
        buildNameHtml = `<div class="mh-build-name">${ctx.name}</div>`;
      }
    }

    let html = `<div class="mh-player-name" style="color:${playerColor}">
      ${displayName}
      <span class="mh-race-badge">${raceInfo.label}</span>
    </div>${buildNameHtml}`;

    // Heroes with spells
    const { heroes } = tierProduction;
    if (heroes && heroes.length) {
      let heroHtml = '';
      heroes.forEach(hero => {
        // Spell icons — only learned spells, inline horizontal
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
    }

    // Expansion marker (own line)
    if (hasExpansion) {
      html += `<div class="mh-expansion-marker mh-expanded" title="Expanded">\u2714 Expo</div>`;
    } else {
      html += `<div class="mh-expansion-marker mh-no-expo" title="No expansion">\u2718 No Expo</div>`;
    }

    // Upgrades row + atk/def types row
    if (finalSnapshot) {
      let upgLine = '';
      const upgrades = finalSnapshot.upgrades;
      if (upgrades && (upgrades.attack || upgrades.defense || upgrades.researched.length)) {
        if (upgrades.attack) upgLine += `<span class="mh-info-badge atk">ATK ${upgrades.attack}</span>`;
        if (upgrades.defense) upgLine += `<span class="mh-info-badge def">DEF ${upgrades.defense}</span>`;
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

    // Collapsible unit summary toggle
    const uid = displayName.replace(/\W/g, '');
    const toggleId = `mh-unit-toggle-${uid}`;
    const contentId = `mh-unit-content-${uid}`;
    html += `<div class="mh-unit-toggle" id="${toggleId}" onclick="document.getElementById('${contentId}').classList.toggle('mh-hidden');this.classList.toggle('mh-open')">Unit Summary</div>`;
    html += `<div class="mh-unit-content mh-hidden" id="${contentId}">`;

    // Tech rows — always show all 3 tiers, dim unreached ones
    const tierProdData = tierProduction.tierProd;
    [1, 2, 3].forEach(tierNum => {
      const reached = tierNum === 1 || (tierNum === 2 && tier2Time !== Infinity) || (tierNum === 3 && tier3Time !== Infinity);
      const data = tierProdData[tierNum];
      const dimClass = reached ? '' : ' mh-tier-unreached';

      let rowHtml = `<div class="mh-tech-row${dimClass}"><span class="mh-tech-tier t${tierNum}">T${tierNum}</span><div class="mh-tech-icons">`;

      if (reached && data && data.units.length) {
        data.units.forEach(u => {
          const countBadge = u.count > 1 ? `<span class="mh-unit-count">${u.count}</span>` : '';
          const atkInfo = ATTACK_TYPES[u.attackType];
          const defInfo = ARMOR_TYPES[u.armorType];
          let typeStack = '';
          if (atkInfo || defInfo) {
            let icons = '';
            if (atkInfo) icons += `<img class="mh-type-icon" src="${atkInfo.icon}" title="${atkInfo.label} attack" />`;
            if (defInfo) icons += `<img class="mh-type-icon" src="${defInfo.icon}" title="${defInfo.label} armor" />`;
            typeStack = `<span class="mh-type-stack">${icons}</span>`;
          }
          rowHtml += `<span class="mh-icon-wrap">
            <span class="mh-portrait-wrap"><img class="mh-tech-icon" src="/assets/wc3icons/${u.itemId}.jpg" title="${u.displayName}" />${countBadge}</span>${typeStack}
          </span>`;
        });
      } else if (!reached) {
        rowHtml += '<span class="mh-tier-empty">\u2014</span>';
      }

      rowHtml += '</div></div>';
      html += rowHtml;
    });
    html += '</div>'; // close mh-unit-content

    return html;
  }

  renderViewerControls () {
    const togglesEl = document.getElementById('mh-viewer-toggles');
    if (!togglesEl) return;

    const buttons = [
      { key: 'displayCreepRoute', label: 'Creep Routes', featured: true },
      { key: 'displayPath', label: 'Hero Paths' },
      { key: 'displayLeveLDots', label: 'Level Dots' },
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
