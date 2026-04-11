const MatchSummary = class {
  constructor (viewer) {
    this.viewer = viewer;
    this.boData = new BuildOrderData();
    this.modal = null;
    this.visible = false;
    this.activeTab = 'overview';
    this._playerData = [];
    this._neutralGroups = null;
    this._renderedTabs = {};
  }

  setup () {
    this.modal = document.getElementById('ms-modal');
    if (!this.modal) return;

    const closeBtn = this.modal.querySelector('.ms-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hide());
    }

    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.hide();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.visible) {
        this.hide();
      }
    });

    this.modal.querySelectorAll('.ms-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this._switchTab(tab.dataset.tab);
      });
    });

    this._createTriggerButton();
  }

  _createTriggerButton () {
    const scrubber = document.getElementById('scrubber-bar-scrubber');
    if (!scrubber) return;

    const btn = document.createElement('div');
    btn.className = 'ms-trigger-btn';
    btn.textContent = 'Summary';
    btn.addEventListener('click', () => {
      this.viewer.showMatchSummary();
    });

    scrubber.appendChild(btn);
  }

  _collectData () {
    this._playerData = [];
    this._renderedTabs = {};

    const { buildOrderPlayers } = this.viewer;
    if (!buildOrderPlayers || !buildOrderPlayers.length) return;

    buildOrderPlayers.forEach(player => {
      if (player.isNeutralPlayer) return;
      const boData = this.boData.processBuildOrderData(player);
      this._playerData.push({ boData, player });
    });

    this._neutralGroups = (this.viewer.mapData && this.viewer.mapData.world &&
      this.viewer.mapData.world.neutralGroups) || {};
  }

  show () {
    if (!this.viewer.gameLoaded || !this.modal) return;

    this._collectData();

    const mapNameEl = this.modal.querySelector('.ms-map-name');
    const durationEl = this.modal.querySelector('.ms-duration');

    if (mapNameEl) {
      const raw = (this.viewer.mapInfo && this.viewer.mapInfo.name) || this.viewer.mapName || '';
      mapNameEl.textContent = this._cleanMapName(raw);
    }

    if (durationEl && this.viewer.matchEndTime) {
      durationEl.textContent = formatGameTime(this.viewer.matchEndTime);
    }

    this._switchTab('overview');
    this.modal.style.display = 'flex';
    this.visible = true;
  }

  hide () {
    if (!this.modal) return;
    this.modal.style.display = 'none';
    this.visible = false;
  }

  _cleanMapName (raw) {
    return raw
      .replace(/\.w3[xm]$/i, '')
      .replace(/_/g, ' ')
      .replace(/[-\s]v\d+[-.]?\d*/gi, '')
      .replace(/\s+\d+$/, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .trim();
  }

  _switchTab (tabName) {
    this.activeTab = tabName;

    this.modal.querySelectorAll('.ms-tab').forEach(tab => {
      tab.classList.toggle('ms-tab-active', tab.dataset.tab === tabName);
    });

    this.modal.querySelectorAll('.ms-tab-content').forEach(el => {
      el.style.display = 'none';
    });

    const target = this.modal.querySelector(`.ms-tab-${tabName}`);
    if (target) {
      target.style.display = '';

      if (!this._renderedTabs[tabName]) {
        const renderers = {
          overview: () => this._renderOverview(),
          army: () => this._renderArmy(),
          economy: () => this._renderEconomy(),
          upgrades: () => this._renderUpgrades(),
          creeps: () => this._renderCreeps(),
          charts: () => this._renderCharts()
        };

        if (renderers[tabName]) {
          target.innerHTML = renderers[tabName]();
          this._renderedTabs[tabName] = true;
        }
      }
    }
  }

  // =============================================
  // Tab Renderers
  // =============================================

  _renderOverview () {
    // Per-player columns with flex layout for bottom-alignment
    let html = this._renderPlayerColumns((pd) => {
      const { boData, player } = pd;
      const { race, raceInfo, tierProduction, tier2Time, tier3Time, hasExpansion, finalSnapshot } = boData;

      // --- Top section: Player identity + heroes ---
      let top = '';
      const raceIconId = BuildOrderData.CONFIG.raceStarterIcons[race] || '';
      top += `<div class="ms-player-name">
        <img class="ms-race-icon" src="/assets/wc3icons/${raceIconId}.jpg" style="border-color:${raceInfo.accent}" onerror="this.style.display='none'" />
        <span style="color:${boData.playerColor}">${boData.displayName}</span>
        <span class="ms-race-label" style="color:${raceInfo.accent}">${raceInfo.label}</span>
      </div>`;

      if (tierProduction.heroes && tierProduction.heroes.length) {
        top += '<div class="ms-heroes-row">';
        tierProduction.heroes.forEach(hero => {
          top += `<div class="ms-hero-inline">
            <div class="ms-hero-portrait-wrap">
              <img class="ms-hero-portrait" src="/assets/wc3icons/${hero.itemId}.jpg" title="${hero.displayName}" onerror="this.style.display='none'" />
              <span class="ms-hero-level">${hero.level}</span>
            </div>
            <div class="ms-hero-spells-grid">${this._renderHeroSpells(hero)}</div>
          </div>`;
        });
        top += '</div>';
      }

      // --- Middle section: Combat types (inline unit-first layout) ---
      let mid = this._renderCombatTypesInline(pd);

      // --- APM line chart (with opponent as ghost line) ---
      let apmHtml = '';
      if (player.apmData && player.apmData.effective.perMinute && player.apmData.effective.perMinute.length > 1) {
        const pIdx = this._playerData.indexOf(pd);
        const oppPd = this._playerData[pIdx === 0 ? 1 : 0];
        const oppApm = oppPd && oppPd.player.apmData ? oppPd.player.apmData : null;
        const oppColor = oppPd ? oppPd.boData.playerColor : '#888';
        apmHtml += '<div class="ms-section-label">APM</div>';
        apmHtml += this._renderApmLineChart(player.apmData, tier2Time, tier3Time, boData.playerColor, oppApm, oppColor);
      }

      // --- Bottom section: Match stats (pinned to bottom) ---
      let bottom = '<div class="ms-section-label">Match Stats</div>';
      bottom += '<table class="ms-stats-table">';

      const maxTier = tier3Time !== Infinity ? 3 : tier2Time !== Infinity ? 2 : 1;
      bottom += `<tr><td>Max Tier</td><td><span class="ms-tier-badge t${maxTier}">T${maxTier}</span></td></tr>`;

      const expoLabel = hasExpansion ? '<span class="ms-expo-yes">Yes</span>' : '<span class="ms-expo-no">No</span>';
      bottom += `<tr><td>Expansion</td><td>${expoLabel}</td></tr>`;

      if (finalSnapshot) {
        const s = finalSnapshot.supply || {};
        bottom += `<tr><td>Supply</td><td>${s.used || 0} / ${s.max || 0}</td></tr>`;
        const w = finalSnapshot.workers || {};
        bottom += `<tr><td>Workers</td><td>
          <img class="ms-res-icon" src="/assets/wc3icons/gold.jpg" title="Gold" />${w.onGold || 0}
          <img class="ms-res-icon" src="/assets/wc3icons/lmbr.jpg" title="Lumber" />${w.onLumber || 0}
          <span class="ms-res-pip ms-res-build" title="Building"></span>${w.onBuild || 0}
        </td></tr>`;
        const eco = finalSnapshot.economy || {};
        bottom += `<tr><td>Gold Spent</td><td><img class="ms-res-icon" src="/assets/wc3icons/gold.jpg" /><span class="ms-gold">${eco.goldSpent || 0}</span></td></tr>`;
        bottom += `<tr><td>Lumber Spent</td><td><img class="ms-res-icon" src="/assets/wc3icons/lmbr.jpg" /><span class="ms-lumber">${eco.lumberSpent || 0}</span></td></tr>`;
      }

      if (player.apmData) {
        bottom += `<tr><td>Effective APM</td><td>${player.apmData.effective.average} avg</td></tr>`;
      }

      bottom += '</table>';

      return `<div class="ms-ov-top">${top}${mid}${apmHtml}</div><div class="ms-ov-bottom">${bottom}</div>`;
    });

    // Tier progression bar below per-player columns
    const seriesData = this._playerData.map(pd => ({
      color: pd.boData.playerColor,
      name: pd.boData.displayName,
      tier2Time: pd.boData.tier2Time,
      tier3Time: pd.boData.tier3Time
    }));
    const matchEnd = this.viewer.matchEndTime || 0;
    html += '<div class="ms-section-label" style="margin-top:0.5rem">Tier Progression</div>';
    html += this._renderTierComparison(seriesData, matchEnd);

    return html;
  }

  _collectUnitCombatInfo (tierProduction) {
    const units = {};
    [1, 2, 3].forEach(t => {
      const tp = tierProduction.tierProd[t];
      if (!tp || !tp.units) return;
      tp.units.forEach(u => {
        if (!u.attackType && !u.armorType) return;
        if (units[u.itemId]) {
          units[u.itemId].count += u.count || 1;
        } else {
          units[u.itemId] = { itemId: u.itemId, displayName: u.displayName, attackType: u.attackType, armorType: u.armorType, count: u.count || 1 };
        }
      });
    });
    return Object.values(units);
  }

  _renderCombatTypesInline (pd) {
    const pIdx = this._playerData.indexOf(pd);
    const oppIdx = pIdx === 0 ? 1 : 0;
    if (!this._playerData[oppIdx]) return '';

    const myUnits = this._collectUnitCombatInfo(pd.boData.tierProduction);
    const oppUnits = this._collectUnitCombatInfo(this._playerData[oppIdx].boData.tierProduction);
    if (!myUnits.length) return '';

    // Collect unique attack types (for matrix rows) and opponent armor types (for matrix columns)
    const myAtkTypes = {};
    myUnits.forEach(u => {
      if (u.attackType && ATTACK_TYPES[u.attackType]) {
        if (!myAtkTypes[u.attackType]) myAtkTypes[u.attackType] = [];
        myAtkTypes[u.attackType].push(u);
      }
    });

    const oppArmTypes = {};
    oppUnits.forEach(u => {
      if (u.armorType && (ARMOR_TYPES[u.armorType] || u.armorType === 'hero')) {
        if (!oppArmTypes[u.armorType]) oppArmTypes[u.armorType] = [];
        if (!oppArmTypes[u.armorType].find(x => x.itemId === u.itemId)) {
          oppArmTypes[u.armorType].push(u);
        }
      }
    });

    let html = '';

    // Unit roster — each unit shows portrait, attack label+icon, armor label+icon
    html += '<div class="ms-section-label">Unit Roster</div>';
    html += '<div class="ms-ct-list">';
    myUnits.forEach(u => {
      const atk = u.attackType && ATTACK_TYPES[u.attackType];
      const arm = u.armorType && (ARMOR_TYPES[u.armorType] || (u.armorType === 'hero' ? { label: 'Hero', icon: '' } : null));

      html += '<div class="ms-ct-unit">';
      html += `<span class="ms-ct-name">${u.displayName}${u.count > 1 ? ' x' + u.count : ''}</span>`;
      html += `<div class="ms-ct-portrait-wrap"><img class="ms-ct-unit-icon" src="/assets/wc3icons/${u.itemId}.jpg" title="${u.displayName}" onerror="this.style.display='none'" />${u.count > 1 ? `<span class="ms-ct-count">${u.count}</span>` : ''}</div>`;
      html += '<div class="ms-ct-type-col">';
      if (atk) {
        html += `<div class="ms-ct-typed"><img class="ms-ct-type-icon" src="${atk.icon}" onerror="this.style.display='none'" /><span class="ms-ct-type-lbl">${atk.label}</span></div>`;
      }
      if (arm) {
        const armIcon = arm.icon || '';
        html += `<div class="ms-ct-typed">`;
        if (armIcon) html += `<img class="ms-ct-type-icon" src="${armIcon}" onerror="this.style.display='none'" />`;
        html += `<span class="ms-ct-type-lbl">${arm.label}</span></div>`;
      }
      html += '</div></div>';
    });
    html += '</div>';

    // Matchup matrix — my attack types (rows) vs opponent armor types (columns)
    const atkKeys = Object.keys(myAtkTypes);
    const armKeys = Object.keys(oppArmTypes);
    if (atkKeys.length && armKeys.length) {
      html += '<div class="ms-section-label">Damage Matchup</div>';
      html += '<table class="ms-matrix">';

      // Header row: empty corner + opponent armor type columns
      html += '<tr><td class="ms-matrix-corner"></td>';
      armKeys.forEach(armKey => {
        const arm = ARMOR_TYPES[armKey] || (armKey === 'hero' ? { label: 'Hero', icon: '' } : null);
        if (!arm) return;
        const armIcon = arm.icon || '';
        const unitNames = oppArmTypes[armKey].map(u => u.displayName).join(', ');
        html += `<td class="ms-matrix-col-hdr" title="${unitNames}">`;
        html += `<span>${arm.label}</span>`;
        if (armIcon) html += `<img class="ms-matrix-hdr-icon" src="${armIcon}" onerror="this.style.display='none'" />`;
        html += `</td>`;
      });
      html += '</tr>';

      // One row per attack type
      atkKeys.forEach(atkType => {
        const atk = ATTACK_TYPES[atkType];
        if (!atk) return;
        const unitNames = myAtkTypes[atkType].map(u => u.displayName).join(', ');

        html += `<tr><td class="ms-matrix-row-hdr" title="${unitNames}">`;
        html += `<span>${atk.label}</span>`;
        html += `<img class="ms-matrix-hdr-icon" src="${atk.icon}" onerror="this.style.display='none'" />`;
        html += `</td>`;

        armKeys.forEach(armKey => {
          const matrixKey = ARMOR_MATRIX_KEY[armKey];
          if (!matrixKey) { html += '<td></td>'; return; }
          const mult = DAMAGE_MATRIX[atkType] && DAMAGE_MATRIX[atkType][matrixKey];
          if (mult === undefined) { html += '<td></td>'; return; }

          const pct = Math.round(mult * 100);
          let cls = 'ms-mx-neutral';
          if (mult > 1) cls = 'ms-mx-strong';
          else if (mult < 1) cls = 'ms-mx-weak';

          const armLabel = (ARMOR_TYPES[armKey] && ARMOR_TYPES[armKey].label) || armKey;
          const oppNames = oppArmTypes[armKey].map(u => u.displayName).join(', ');
          html += `<td class="ms-matrix-cell ${cls}" title="${atk.label} vs ${armLabel} (${oppNames}): ${pct}%">${pct}%</td>`;
        });
        html += '</tr>';
      });

      html += '</table>';
    }

    return html;
  }

  _renderArmy () {
    return this._renderPlayerColumns((pd) => {
      const { boData } = pd;
      const { tierProduction, finalSnapshot } = boData;
      let html = '';

      [1, 2, 3].forEach(tier => {
        const tp = tierProduction.tierProd[tier];
        if (!tp) return;
        const hasContent = (tp.buildings && tp.buildings.length) || (tp.units && tp.units.length);
        if (!hasContent) return;

        html += `<div class="ms-tier-label t${tier}">Tier ${tier}</div>`;

        if (tp.buildings && tp.buildings.length) {
          html += '<div class="ms-subsection">Buildings</div>';
          html += '<div class="ms-icon-grid">';
          tp.buildings.forEach(b => {
            html += this._renderIcon(b.itemId, b.displayName, b.count);
          });
          html += '</div>';
        }

        if (tp.units && tp.units.length) {
          html += '<div class="ms-subsection">Units</div>';
          html += '<div class="ms-icon-grid">';
          tp.units.forEach(u => {
            html += this._renderIcon(u.itemId, u.displayName, u.count);
          });
          html += '</div>';
        }
      });

      if (finalSnapshot && finalSnapshot.army && finalSnapshot.army.length) {
        html += '<div class="ms-section-label">All Made Units</div>';
        html += '<div class="ms-icon-grid">';
        finalSnapshot.army.forEach(u => {
          html += this._renderIcon(u.itemId, u.displayName, u.count);
        });
        html += '</div>';
      }

      return html;
    });
  }

  _renderEconomy () {
    return this._renderPlayerColumns((pd) => {
      const { boData, player } = pd;
      const { finalSnapshot } = boData;
      let html = '';

      if (finalSnapshot) {
        const eco = finalSnapshot.economy || {};
        html += '<div class="ms-section-label">Resources</div>';
        html += `<div class="ms-stat-row"><span>Gold Spent</span><span class="ms-stat-value ms-gold">${eco.goldSpent || 0}</span></div>`;
        html += `<div class="ms-stat-row"><span>Lumber Spent</span><span class="ms-stat-value ms-lumber">${eco.lumberSpent || 0}</span></div>`;
      }

      const itemStream = player.itemStream;
      if (itemStream && itemStream.purchases && itemStream.purchases.length) {
        const totalItemGold = itemStream.purchases.reduce((sum, p) => sum + (p.goldSpent || 0), 0);
        html += `<div class="ms-section-label">Item Purchases (${totalItemGold}g)</div>`;
        html += '<div class="ms-icon-grid">';
        itemStream.purchases.forEach(p => {
          const tip = `${p.displayName} x${p.count}${p.goldSpent ? ` (${p.goldSpent}g)` : ''}`;
          html += `<div class="ms-icon-wrap" title="${tip}">
            <img class="ms-icon" src="/assets/wc3icons/${p.itemId}.jpg" onerror="this.parentElement.style.display='none'" />
            ${p.count > 1 ? `<span class="ms-icon-count">${p.count}</span>` : ''}
          </div>`;
        });
        html += '</div>';
      }

      if (itemStream && itemStream.uses && itemStream.uses.length) {
        html += '<div class="ms-section-label">Item Uses</div>';
        html += '<div class="ms-icon-grid">';
        itemStream.uses.forEach(u => {
          html += `<div class="ms-icon-wrap" title="${u.displayName} x${u.count}">
            <img class="ms-icon" src="/assets/wc3icons/${u.itemId}.jpg" onerror="this.parentElement.style.display='none'" />
            ${u.count > 1 ? `<span class="ms-icon-count">${u.count}</span>` : ''}
          </div>`;
        });
        html += '</div>';
      }

      const mercEvents = (player.eventStream || []).filter(e => e.key === 'hireMercenary');
      if (mercEvents.length) {
        const mercCounts = {};
        let totalMercGold = 0;
        mercEvents.forEach(e => {
          const id = e.unit.itemId;
          if (!mercCounts[id]) mercCounts[id] = { itemId: id, displayName: e.unit.displayName, count: 0, goldSpent: 0 };
          mercCounts[id].count++;
          mercCounts[id].goldSpent += e.goldCost || 0;
          totalMercGold += e.goldCost || 0;
        });
        html += `<div class="ms-section-label">Mercenaries (${totalMercGold}g)</div>`;
        html += '<div class="ms-icon-grid">';
        Object.values(mercCounts).forEach(m => {
          html += this._renderIcon(m.itemId, `${m.displayName} x${m.count} (${m.goldSpent}g)`, m.count);
        });
        html += '</div>';
      }

      const heroes = player.heroes || [];
      if (heroes.length) {
        html += '<div class="ms-section-label">Hero Inventories</div>';
        heroes.forEach(hero => {
          const items = hero.items || [];
          if (!items.length) return;
          html += `<div class="ms-hero-inv-label">${hero.displayName}</div>`;
          html += '<div class="ms-icon-grid">';
          items.forEach(item => {
            if (!item.itemId) return;
            html += `<div class="ms-icon-wrap" title="${item.displayName || item.itemId}">
              <img class="ms-icon" src="/assets/wc3icons/${item.itemId}.jpg" onerror="this.parentElement.style.display='none'" />
            </div>`;
          });
          html += '</div>';
        });
      }

      return html;
    });
  }

  _renderUpgrades () {
    let html = '';

    // Per-player upgrades
    html += this._renderPlayerColumns((pd) => {
      const { boData, player } = pd;
      const { finalSnapshot } = boData;
      let phtml = '';

      if (!finalSnapshot || !finalSnapshot.upgrades) {
        return '<div class="ms-empty">No upgrades data</div>';
      }

      const upgrades = finalSnapshot.upgrades;

      const atkEntries = Object.values(upgrades.attack || {});
      if (atkEntries.length) {
        phtml += '<div class="ms-section-label ms-atk-label">Attack Upgrades</div>';
        phtml += '<div class="ms-upgrade-list">';
        atkEntries.forEach(upg => {
          const iconSrc = upg.icon ? `/assets/wc3icons/${upg.icon}.jpg` : `/assets/wc3icons/${upg.itemId}.jpg`;
          phtml += `<div class="ms-upgrade-row ms-atk">
            <img class="ms-upgrade-icon" src="${iconSrc}" onerror="this.style.display='none'" />
            <span class="ms-upgrade-name">${upg.displayName}</span>
            <span class="ms-upgrade-level">Lv ${upg.level}</span>
          </div>`;
        });
        phtml += '</div>';
      }

      const defEntries = Object.values(upgrades.defense || {});
      if (defEntries.length) {
        phtml += '<div class="ms-section-label ms-def-label">Defense Upgrades</div>';
        phtml += '<div class="ms-upgrade-list">';
        defEntries.forEach(upg => {
          const iconSrc = upg.icon ? `/assets/wc3icons/${upg.icon}.jpg` : `/assets/wc3icons/${upg.itemId}.jpg`;
          phtml += `<div class="ms-upgrade-row ms-def">
            <img class="ms-upgrade-icon" src="${iconSrc}" onerror="this.style.display='none'" />
            <span class="ms-upgrade-name">${upg.displayName}</span>
            <span class="ms-upgrade-level">Lv ${upg.level}</span>
          </div>`;
        });
        phtml += '</div>';
      }

      const researched = upgrades.researched || [];
      if (researched.length) {
        phtml += '<div class="ms-section-label ms-res-label">Research</div>';
        phtml += '<div class="ms-upgrade-list">';
        researched.forEach(r => {
          const iconSrc = r.icon ? `/assets/wc3icons/${r.icon}.jpg` : `/assets/wc3icons/${r.itemId}.jpg`;
          const lvl = r.level > 1 ? ` Lv ${r.level}` : '';
          phtml += `<div class="ms-upgrade-row ms-res">
            <img class="ms-upgrade-icon" src="${iconSrc}" onerror="this.style.display='none'" />
            <span class="ms-upgrade-name">${r.displayName}${lvl}</span>
          </div>`;
        });
        phtml += '</div>';
      }

      const researchEvents = (player.eventStream || []).filter(e => e.key === 'research');
      if (researchEvents.length) {
        phtml += '<div class="ms-section-label">Research Timeline</div>';
        researchEvents.forEach(e => {
          const iconSrc = e.icon ? `/assets/wc3icons/${e.icon}.jpg` : `/assets/wc3icons/${e.itemId}.jpg`;
          const lvl = e.level > 1 ? ` Lv ${e.level}` : '';
          phtml += `<div class="ms-timeline-mini">
            <span class="ms-timeline-time">${formatGameTime(e.gameTime)}</span>
            <img class="ms-timeline-icon" src="${iconSrc}" onerror="this.style.display='none'" />
            <span>${e.displayName}${lvl}</span>
          </div>`;
        });
      }

      if (!atkEntries.length && !defEntries.length && !researched.length) {
        phtml += '<div class="ms-empty">No upgrades researched</div>';
      }

      return phtml;
    });

    return html;
  }

  _renderCreeps () {
    const groups = this._neutralGroups;
    const groupList = Object.values(groups);
    if (!groupList.length) return '<div class="ms-empty">No creep camp data available</div>';

    const playerTeamIds = {};
    this._playerData.forEach(pd => {
      const pid = pd.player.playerId;
      groupList.forEach(g => {
        if (!g.claimers) return;
        Object.entries(g.claimers).forEach(([teamId, teamData]) => {
          if (teamData.players && teamData.players[pid]) {
            playerTeamIds[pid] = parseInt(teamId);
          }
        });
      });
    });

    const renderCampIcons = (g) => {
      let icons = '';
      (g.units || []).forEach(u => {
        const lvl = (u.balanceInfo && u.balanceInfo.level) || 0;
        icons += `<div class="ms-creep-icon-wrap" title="${u.displayName} Lv ${lvl}">
          <img class="ms-creep-icon" src="/assets/wc3icons/${u.itemId}.jpg" onerror="this.style.display='none'" />
          ${lvl ? `<span class="ms-creep-lvl">${lvl}</span>` : ''}
        </div>`;
      });
      return icons;
    };

    const campXp = (g) => {
      if (!g.heroStats) return 0;
      return Object.values(g.heroStats).reduce((sum, h) => sum + (h.total || 0), 0);
    };

    // Camp difficulty colors (matches GameDisplayBox.getDifficultyClass)
    const campDifficulty = (totalLevel) => {
      if (totalLevel <= 9) return { cls: 'green', label: 'Green Camp', color: '#00c850' };
      if (totalLevel <= 19) return { cls: 'orange', label: 'Orange Camp', color: '#ff8c00' };
      return { cls: 'red', label: 'Red Camp', color: '#e02020' };
    };

    let html = '';

    // --- Hero XP from Creeps (top, per-player) ---
    html += this._renderPlayerColumns((pd) => {
      const { boData, player } = pd;
      const teamId = playerTeamIds[player.playerId];
      const myCamps = groupList.filter(g => (g.claimState === 2) && g.claimOwnerId === teamId);

      const heroXpTotals = {};
      myCamps.forEach(g => {
        if (!g.heroClaimRecords) return;
        g.heroClaimRecords.forEach(r => {
          if (!heroXpTotals[r.uuid]) heroXpTotals[r.uuid] = { displayName: r.displayName, xp: 0 };
          heroXpTotals[r.uuid].xp += r.xpGained || 0;
        });
      });

      const heroEntries = Object.values(heroXpTotals).sort((a, b) => b.xp - a.xp);
      let phtml = '<div class="ms-section-label">Hero XP from Creeps</div>';
      if (heroEntries.length) {
        const maxXp = heroEntries[0].xp || 1;
        heroEntries.forEach(h => {
          const heroUnit = (player.heroes || []).find(u => u.displayName === h.displayName);
          const iconId = heroUnit ? heroUnit.itemId : '';
          const pct = (h.xp / maxXp * 100).toFixed(0);
          phtml += `<div class="ms-hero-xp-row">
            ${iconId ? `<img class="ms-hero-xp-icon" src="/assets/wc3icons/${iconId}.jpg" onerror="this.style.display='none'" />` : ''}
            <span class="ms-hero-xp-name">${h.displayName}</span>
            <div class="ms-hero-xp-bar-track"><div class="ms-hero-xp-bar" style="width:${pct}%;background:${boData.playerColor}"></div></div>
            <span class="ms-hero-xp-val">${h.xp}</span>
          </div>`;
        });
      } else {
        phtml += '<div class="ms-empty">No creep XP data</div>';
      }
      return phtml;
    });

    // --- Creep Score comparison bar ---
    const playerCamps = this._playerData.map(pd => {
      const teamId = playerTeamIds[pd.player.playerId];
      const cleared = groupList.filter(g => g.claimState === 2 && g.claimOwnerId === teamId);
      const partial = [];
      const camps = cleared;
      const totalLvl = camps.reduce((s, g) => s + (g.totalLevel || 0), 0);
      const totalXp = camps.reduce((s, g) => s + campXp(g), 0);
      const partialCount = partial.length;
      return { camps, count: camps.length, totalLvl, totalXp, color: pd.boData.playerColor, name: pd.boData.displayName, partialCount };
    });
    const totalCampsCount = playerCamps.reduce((s, p) => s + p.count, 0) || 1;

    html += '<div class="ms-section-label">Creep Score</div>';
    html += '<div class="ms-creep-score">';
    playerCamps.forEach(p => {
      html += `<div class="ms-creep-score-side">
        <span class="ms-creep-score-name" style="color:${p.color}">${p.name}</span>
        <span class="ms-creep-score-stat">${p.count} camps${p.partialCount ? ' + ' + p.partialCount + ' partial' : ''} &middot; Lv ${p.totalLvl}${p.totalXp ? ' &middot; ' + p.totalXp + ' XP' : ''}</span>
      </div>`;
    });
    html += '</div>';
    html += '<div class="ms-creep-bar">';
    playerCamps.forEach(p => {
      const pct = Math.max(2, p.count / totalCampsCount * 100);
      html += `<div class="ms-creep-bar-seg" style="width:${pct.toFixed(1)}%;background:${p.color}"></div>`;
    });
    html += '</div>';

    // --- Per-player Creep Route grouped by difficulty ---
    html += this._renderPlayerColumns((pd) => {
      const { boData, player } = pd;
      const teamId = playerTeamIds[player.playerId];

      const myCamps = groupList
        .filter(g => (g.claimState === 2 || g.claimState === 1) && g.claimOwnerId === teamId)
        .sort((a, b) => (a.order || 0) - (b.order || 0));

      let phtml = '<div class="ms-section-label">Creep Route</div>';

      if (!myCamps.length) {
        return phtml + '<div class="ms-empty">No camps claimed</div>';
      }

      // Group by difficulty
      const byDiff = { green: [], orange: [], red: [] };
      myCamps.forEach((g, i) => {
        const diff = campDifficulty(g.totalLevel || 0);
        byDiff[diff.cls].push({ camp: g, order: i + 1 });
      });

      ['green', 'orange', 'red'].forEach(diffKey => {
        const camps = byDiff[diffKey];
        if (!camps.length) return;
        const diff = campDifficulty(diffKey === 'green' ? 0 : diffKey === 'orange' ? 10 : 20);

        phtml += `<div class="ms-creep-diff-label" style="color:${diff.color}">${diff.label}s (${camps.length})</div>`;
        phtml += '<div class="ms-creep-route">';
        camps.forEach(({ camp: g, order }) => {
          const xp = campXp(g);
          const isPartial = false;
          const partialPct = isPartial ? Math.round((g.completionEstimate || 0) * 100) : null;
          const partialClass = isPartial ? ' ms-creep-step-partial' : '';
          phtml += `<div class="ms-creep-step${partialClass}">
            <span class="ms-creep-order" style="border-color:${diff.color};color:${diff.color}">${order}</span>
            <div class="ms-creep-camp">
              <div class="ms-creep-icons">${renderCampIcons(g)}</div>
              <div class="ms-creep-camp-info">
                <span class="ms-creep-meta">${formatGameTime(g.claimTime || g.firstInteractionTime)}</span>
                ${isPartial ? `<span class="ms-creep-partial">~${partialPct}%</span>` : ''}
                ${xp ? `<span class="ms-creep-xp">+${xp} XP</span>` : ''}
              </div>
            </div>
          </div>`;
        });
        phtml += '</div>';
      });

      return phtml;
    });

    // Contested/partial/untouched — simple summary
    const contested = groupList.filter(g => g.claimState === 1);
    const partialAll = [];
    const untouched = groupList.filter(g => g.claimState === 0);
    if (contested.length || partialAll.length || untouched.length) {
      let footer = '';
      if (contested.length) footer += `<span class="ms-creep-footer-item">${contested.length} contested</span>`;
      if (partialAll.length) footer += `<span class="ms-creep-footer-item">${partialAll.length} partial</span>`;
      if (untouched.length) footer += `<span class="ms-creep-footer-item">${untouched.length} untouched</span>`;
      html += `<div class="ms-creep-footer">${footer}</div>`;
    }

    return html;
  }

  _renderCharts () {
    let html = '';

    // Build time-series data from eventStream for each player
    const seriesData = this._playerData.map(pd => {
      const events = pd.player.eventStream || [];
      return {
        color: pd.boData.playerColor,
        name: pd.boData.displayName,
        events,
        tier2Time: pd.boData.tier2Time,
        tier3Time: pd.boData.tier3Time,
        apm: pd.player.apmData
      };
    });

    const matchEnd = this.viewer.matchEndTime || 0;

    // 1. Supply Over Time
    html += '<div class="ms-section-label">Supply Over Time</div>';
    html += this._renderAreaChart(seriesData, matchEnd, (e) => e.supplyUsed || 0, 100);

    // 2. Workers Over Time
    html += '<div class="ms-section-label">Workers Over Time</div>';
    html += this._renderAreaChart(seriesData, matchEnd, (e) => {
      const w = e.workers || {};
      return (w.totalWorkers || 0) + (w.ghoulsOnLumber || 0);
    }, null);

    // 3. APM Comparison
    if (seriesData.some(s => s.apm)) {
      html += '<div class="ms-section-label">APM Over Time</div>';
      html += this._renderApmComparisonChart(seriesData);
    }

    // 4. Action Category Breakdown
    html += '<div class="ms-section-label">Action Category Breakdown</div>';
    html += this._renderCategoryComparison(seriesData);

    return html;
  }

  _renderApmLineChart (apm, tier2Time, tier3Time, color, oppApm, oppColor) {
    const data = apm.effective.perMinute;
    const oppData = oppApm ? oppApm.effective.perMinute : [];
    const totalMin = Math.max(data.length, oppData.length);
    const w = 280;
    const h = 60;
    const padL = 24;
    const padR = 2;
    const padT = 10;
    const padB = 12;
    const cW = w - padL - padR;
    const cH = h - padT - padB;

    // Shared Y scale so both lines are comparable
    const myPeak = apm.effective.peak || 1;
    const oppPeak = oppApm ? (oppApm.effective.peak || 1) : 0;
    const peak = Math.max(myPeak, oppPeak);

    let svg = `<svg class="ms-apm-chart" viewBox="0 0 ${w} ${h}">`;

    // Tier event markers
    const matchMs = totalMin * 60000;
    if (tier2Time !== Infinity && tier2Time < matchMs) {
      const x = padL + (tier2Time / matchMs) * cW;
      svg += `<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + cH}" stroke="#21a5e3" stroke-width="1" stroke-dasharray="2,2" opacity="0.5" />`;
      svg += `<text x="${x}" y="${padT - 2}" class="ms-chart-label" text-anchor="middle" fill="#21a5e3" font-size="7">T2</text>`;
    }
    if (tier3Time !== Infinity && tier3Time < matchMs) {
      const x = padL + (tier3Time / matchMs) * cW;
      svg += `<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + cH}" stroke="#FFFF33" stroke-width="1" stroke-dasharray="2,2" opacity="0.4" />`;
      svg += `<text x="${x}" y="${padT - 2}" class="ms-chart-label" text-anchor="middle" fill="#FFFF33" font-size="7">T3</text>`;
    }

    // Y-axis grid
    [0.5, 1].forEach(frac => {
      const y = padT + cH * (1 - frac);
      const val = Math.round(peak * frac);
      svg += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="rgba(255,255,255,0.05)" />`;
      svg += `<text x="${padL - 3}" y="${y + 3}" class="ms-chart-label" text-anchor="end" font-size="7">${val}</text>`;
    });

    // Time axis labels
    const labelStep = Math.max(1, Math.ceil(totalMin / 5));
    for (let i = 0; i <= totalMin; i += labelStep) {
      const x = padL + (i / totalMin) * cW;
      svg += `<text x="${x}" y="${h - 1}" class="ms-chart-label" text-anchor="middle" font-size="7">${i}m</text>`;
    }

    // Helper to build area+line path
    const buildPath = (series) => {
      const pts = series.map((v, i) => ({
        x: padL + ((i + 0.5) / totalMin) * cW,
        y: padT + cH - (v / peak) * cH
      }));
      if (!pts.length) return null;
      const lineD = pts.map((p, i) => (i === 0 ? 'M' : 'L') + `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      const areaD = lineD + ` L${pts[pts.length - 1].x.toFixed(1)},${padT + cH} L${pts[0].x.toFixed(1)},${padT + cH} Z`;
      return { lineD, areaD };
    };

    // Opponent line (ghost, behind)
    if (oppData.length) {
      const opp = buildPath(oppData);
      if (opp) {
        svg += `<path d="${opp.areaD}" fill="${oppColor}" opacity="0.06" />`;
        svg += `<path d="${opp.lineD}" fill="none" stroke="${oppColor}" stroke-width="1" opacity="0.3" />`;
      }
    }

    // This player's line (foreground)
    const me = buildPath(data);
    if (me) {
      svg += `<path d="${me.areaD}" fill="${color}" opacity="0.15" />`;
      svg += `<path d="${me.lineD}" fill="none" stroke="${color}" stroke-width="1.5" />`;
    }

    // Baseline
    svg += `<line x1="${padL}" y1="${padT + cH}" x2="${w - padR}" y2="${padT + cH}" stroke="rgba(255,255,255,0.08)" />`;

    svg += '</svg>';
    return svg;
  }

  _renderAreaChart (seriesData, matchEnd, valueFn, maxVal) {
    const width = 500;
    const height = 120;
    const padL = 35;
    const padR = 5;
    const padT = 5;
    const padB = 20;
    const chartW = width - padL - padR;
    const chartH = height - padT - padB;

    // Sample events into time points
    let globalMax = maxVal || 0;
    const lines = seriesData.map(s => {
      const points = [];
      let lastVal = 0;
      s.events.forEach(e => {
        const v = valueFn(e);
        if (v !== undefined && v !== null) {
          lastVal = v;
          if (!maxVal && lastVal > globalMax) globalMax = lastVal;
          points.push({ t: e.gameTime, v: lastVal });
        }
      });
      if (points.length && points[points.length - 1].t < matchEnd) {
        points.push({ t: matchEnd, v: lastVal });
      }
      return { points, color: s.color };
    });

    if (!globalMax) globalMax = 10;

    let svg = `<svg class="ms-chart" viewBox="0 0 ${width} ${height}">`;

    // Grid lines
    const gridSteps = 4;
    for (let i = 0; i <= gridSteps; i++) {
      const y = padT + (chartH * i / gridSteps);
      const val = Math.round(globalMax * (1 - i / gridSteps));
      svg += `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="rgba(255,255,255,0.06)" />`;
      svg += `<text x="${padL - 4}" y="${y + 3}" class="ms-chart-label" text-anchor="end">${val}</text>`;
    }

    // Time labels
    const timeSteps = Math.min(5, Math.ceil(matchEnd / 60000));
    for (let i = 0; i <= timeSteps; i++) {
      const t = (matchEnd / timeSteps) * i;
      const x = padL + (t / matchEnd) * chartW;
      svg += `<text x="${x}" y="${height - 2}" class="ms-chart-label" text-anchor="middle">${formatGameTime(t)}</text>`;
    }

    // Lines
    lines.forEach(line => {
      if (!line.points.length) return;
      const pathParts = line.points.map((p, i) => {
        const x = padL + (p.t / matchEnd) * chartW;
        const y = padT + chartH - (p.v / globalMax) * chartH;
        return (i === 0 ? 'M' : 'L') + `${x.toFixed(1)},${y.toFixed(1)}`;
      });

      // Fill area
      const firstX = padL + (line.points[0].t / matchEnd) * chartW;
      const lastX = padL + (line.points[line.points.length - 1].t / matchEnd) * chartW;
      const baseY = padT + chartH;
      svg += `<path d="${pathParts.join(' ')} L${lastX.toFixed(1)},${baseY} L${firstX.toFixed(1)},${baseY} Z" fill="${line.color}" opacity="0.12" />`;
      svg += `<path d="${pathParts.join(' ')}" fill="none" stroke="${line.color}" stroke-width="2" />`;
    });

    svg += '</svg>';
    return svg;
  }

  _renderApmComparisonChart (seriesData) {
    const width = 500;
    const height = 120;
    const padL = 35;
    const padR = 5;
    const padT = 5;
    const padB = 20;
    const chartW = width - padL - padR;
    const chartH = height - padT - padB;

    let globalMax = 0;
    seriesData.forEach(s => {
      if (s.apm && s.apm.raw.peak > globalMax) globalMax = s.apm.raw.peak;
    });
    if (!globalMax) globalMax = 100;

    const totalMinutes = seriesData.reduce((max, s) => {
      return s.apm ? Math.max(max, s.apm.raw.perMinute.length) : max;
    }, 0);
    if (!totalMinutes) return '<div class="ms-empty">No APM data</div>';

    let svg = `<svg class="ms-chart" viewBox="0 0 ${width} ${height}">`;

    // Grid
    const gridSteps = 4;
    for (let i = 0; i <= gridSteps; i++) {
      const y = padT + (chartH * i / gridSteps);
      const val = Math.round(globalMax * (1 - i / gridSteps));
      svg += `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="rgba(255,255,255,0.06)" />`;
      svg += `<text x="${padL - 4}" y="${y + 3}" class="ms-chart-label" text-anchor="end">${val}</text>`;
    }

    // Bar groups
    const barGroupW = chartW / totalMinutes;
    const barW = Math.max(2, (barGroupW / seriesData.length) - 1);

    seriesData.forEach((s, si) => {
      if (!s.apm) return;
      s.apm.effective.perMinute.forEach((v, mi) => {
        const x = padL + mi * barGroupW + si * (barW + 1);
        const h = (v / globalMax) * chartH;
        const y = padT + chartH - h;
        svg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${s.color}" opacity="0.7" />`;
      });
    });

    // Time labels
    const labelInterval = Math.max(1, Math.floor(totalMinutes / 5));
    for (let i = 0; i < totalMinutes; i += labelInterval) {
      const x = padL + (i + 0.5) * barGroupW;
      svg += `<text x="${x}" y="${height - 2}" class="ms-chart-label" text-anchor="middle">${i + 1}m</text>`;
    }

    svg += '</svg>';
    return svg;
  }

  _renderTierComparison (seriesData, matchEnd) {
    let html = '<div class="ms-tier-compare">';

    seriesData.forEach(s => {
      html += `<div class="ms-tier-row">
        <span class="ms-tier-player" style="color:${s.color}">${s.name}</span>
        <div class="ms-tier-bar-track">`;

      const t2 = s.tier2Time !== Infinity ? s.tier2Time : matchEnd;
      const t3 = s.tier3Time !== Infinity ? s.tier3Time : matchEnd;
      const t2Pct = (Math.min(t2, matchEnd) / matchEnd * 100).toFixed(1);
      const t3Pct = (Math.min(t3, matchEnd) / matchEnd * 100).toFixed(1);

      html += `<div class="ms-tier-seg t1" style="width:${t2Pct}%" title="T1: 0:00 — ${formatGameTime(t2)}"></div>`;
      if (s.tier2Time !== Infinity) {
        const t2Width = ((Math.min(t3, matchEnd) - t2) / matchEnd * 100).toFixed(1);
        html += `<div class="ms-tier-seg t2" style="width:${t2Width}%" title="T2: ${formatGameTime(t2)} — ${s.tier3Time !== Infinity ? formatGameTime(t3) : 'end'}"></div>`;
      }
      if (s.tier3Time !== Infinity) {
        const t3Width = ((matchEnd - t3) / matchEnd * 100).toFixed(1);
        html += `<div class="ms-tier-seg t3" style="width:${t3Width}%" title="T3: ${formatGameTime(t3)} — end"></div>`;
      }

      html += `</div>
        <span class="ms-tier-times">`;
      if (s.tier2Time !== Infinity) html += `<span class="ms-tier-time t2">T2 ${formatGameTime(s.tier2Time)}</span>`;
      if (s.tier3Time !== Infinity) html += `<span class="ms-tier-time t3">T3 ${formatGameTime(s.tier3Time)}</span>`;
      html += '</span></div>';
    });

    html += '</div>';
    return html;
  }

  _renderCategoryComparison (seriesData) {
    const categories = ['move', 'select', 'ability', 'build', 'item', 'cancel'];
    let html = '<div class="ms-cat-compare">';

    categories.forEach(cat => {
      const values = seriesData.map(s => {
        return (s.apm && s.apm.categories[cat]) || 0;
      });
      const max = Math.max(...values, 1);

      html += `<div class="ms-cat-row">
        <span class="ms-cat-label">${cat}</span>
        <div class="ms-cat-bars">`;

      seriesData.forEach((s, i) => {
        const pct = (values[i] / max * 100).toFixed(1);
        html += `<div class="ms-cat-bar-row">
          <div class="ms-cat-bar" style="width:${pct}%;background:${s.color}"></div>
          <span class="ms-cat-val">${values[i]}</span>
        </div>`;
      });

      html += '</div></div>';
    });

    html += '</div>';
    return html;
  }

  // =============================================
  // Shared Helpers
  // =============================================

  _renderPlayerColumns (contentFn) {
    let html = '<div class="ms-players">';
    this._playerData.forEach(pd => {
      html += `<div class="ms-player-col">${contentFn(pd, this._playerData)}</div>`;
    });
    html += '</div>';
    return html;
  }

  _renderIcon (itemId, title, count) {
    const countBadge = (count && count > 1) ? `<span class="ms-icon-count">${count}</span>` : '';
    return `<div class="ms-icon-wrap" title="${title || itemId}">
      <img class="ms-icon" src="/assets/wc3icons/${itemId}.jpg" onerror="this.parentElement.style.display='none'" />
      ${countBadge}
    </div>`;
  }

  _renderHeroSpells (hero) {
    if (!hero.spellList || !hero.spellList.length) return '';
    let html = '';
    hero.spellList.forEach(spell => {
      const learned = hero.learnedSkills && hero.learnedSkills[spell.itemId];
      if (!learned || learned.level === 0) return;
      html += `<span class="ms-spell" title="${spell.displayName} Lv${learned.level}">
        <img class="ms-spell-icon" src="/assets/wc3icons/${spell.itemId}.jpg" onerror="this.style.display='none'" />
        <span class="ms-spell-level">${learned.level}</span>
      </span>`;
    });
    return html;
  }
};

window.MatchSummary = MatchSummary;
